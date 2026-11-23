// Calls this server makes to addresses other people give it: a job's "your AI's web address" (infrastructure/server/deliver.mjs) and
// the lab's "http" connections (simulation/lab/client.mjs).
//
// WHY a guard: on a shared server, an address typed by a stranger is a way to make the server reach places only it can
// reach (its own admin ports, the cloud's metadata service at 169.254.169.254, the private network). So when the server
// is shared (the policy says allowPrivate: false), this refuses loopback, private, link-local, multicast and other
// reserved addresses. The name is resolved first and the connection is made to the address that was checked (the
// check runs inside the socket's own lookup), so a name that answers differently a second later (DNS rebinding) cannot
// slip through. Redirects are never followed, answers are size-capped and every call is time-limited.
//
// On your own machine (the default, and whenever the server listens on 127.0.0.1) localhost addresses are allowed,
// because people run the AI they are testing on the same machine.
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";

/** The biggest answer read from an outside service: a reply is a few kilobytes of JSON. */
export const MAX_RESPONSE_BYTES = 1024 * 1024;
/** A hard ceiling on one call, for callers that pass no signal of their own. */
const DEFAULT_TIMEOUT_MS = 60000;

const BLOCKED = new net.BlockList();
for (const [addr, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) BLOCKED.addSubnet(addr, bits, "ipv4");
// IPv6: unspecified and loopback, unique local (fc00::/7), link-local, multicast, documentation, and the translation
// prefixes (NAT64, 6to4) that can carry a private IPv4 address inside. IPv4-mapped (::ffff:a.b.c.d) is checked
// against the IPv4 list by BlockList itself.
for (const [addr, bits] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32],
  ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["2002::", 16], ["100::", 64],
]) BLOCKED.addSubnet(addr, bits, "ipv6");

let policy = { allowPrivate: true };

/**
 * Sets who outside calls may reach. The server's start-up (infrastructure/server/main.mjs) turns private addresses off when it is
 * shared; everything else (tests, the lab on your machine) keeps the local default.
 * @param {{allowPrivate: boolean}} p
 */
export function setOutboundPolicy({ allowPrivate }) {
  policy = { allowPrivate: allowPrivate !== false };
}

/** @return {{allowPrivate: boolean}} */
export const outboundPolicy = () => ({ ...policy });

/**
 * Whether an IP address is one a shared server must not call. Anything that is not an IP address counts as blocked.
 * @param {string} ip
 * @return {boolean}
 */
export function isBlockedAddress(ip) {
  const bare = String(ip).replace(/^\[|\]$/g, "");
  const family = net.isIPv4(bare) ? "ipv4" : net.isIPv6(bare) ? "ipv6" : null;
  return !family || BLOCKED.check(bare, family);
}

const refuse = (message) => { throw Object.assign(new Error(message), { code: "invalid_input" }); };

/**
 * Checks an outside address before anything is sent: http or https, no user name or password in it, and, on a shared
 * server, not a literal private address or a localhost name. (Names are checked again when they are resolved.)
 * @param {*} url
 * @return {URL}
 */
export function checkOutboundUrl(url) {
  let u = null;
  try { u = new URL(String(url)); } catch {}
  if (!u || !["http:", "https:"].includes(u.protocol)) refuse("The address must start http:// or https://.");
  // WHY: "https://good.example@evil.example" reads like one place and goes to another; nobody's AI needs a password here.
  if (u.username || u.password) refuse("The address must not contain a user name or password.");
  if (!policy.allowPrivate) {
    // A trailing dot ("localhost.") names the same place; judge the name without it.
    const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) refuse("This shared server will not call a local or internal address. Give your AI's public web address.");
    if (net.isIP(host) && isBlockedAddress(host)) refuse("This shared server will not call a private, loopback or reserved address. Give your AI's public web address.");
  }
  return u;
}

/** dns.lookup that fails when any answer is a blocked address. Node connects to the address this returns. */
export function guardedLookup(hostname, options, callback) {
  const opts = typeof options === "object" && options ? options : { family: options };
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return callback(err);
    // WHY refuse when ANY answer is private, not just skip it: a name pointing at both is a probe, not a real service.
    const bad = addresses.find((a) => isBlockedAddress(a.address));
    if (bad || !addresses.length) return callback(Object.assign(new Error(`${hostname} points at a private or reserved address; this shared server will not call it`), { code: "EBLOCKED" }));
    if (opts.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

/**
 * A small fetch for outside services, with the answers the callers read (ok, status, json(), text()). It never
 * follows a redirect, reads at most `maxBytes`, and gives up after the caller's signal or a minute.
 * @param {string} url
 * @param {{method?: string, headers?: object, body?: string, signal?: AbortSignal}=} init
 * @param {{maxBytes?: number}=} o
 * @return {Promise<{ok: boolean, status: number, text: function(): Promise<string>, json: function(): Promise<*>}>}
 */
export function guardedFetch(url, init = {}, { maxBytes = MAX_RESPONSE_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = checkOutboundUrl(url); } catch (e) { reject(e); return; }
    const signal = init.signal || AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    if (signal.aborted) { reject(signal.reason); return; }
    const body = init.body === undefined || init.body === null ? null : Buffer.from(String(init.body));
    const headers = { ...(init.headers || {}), ...(body ? { "Content-Length": body.length } : {}) };
    // agent: false, so a connection made earlier (to whatever address) is never reused for this one.
    const req = (u.protocol === "https:" ? https : http).request(u, {
      method: init.method || "GET", headers, agent: false, lookup: policy.allowPrivate ? undefined : guardedLookup,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); reject(new Error(`the answer was bigger than ${maxBytes} bytes`)); return; }
        chunks.push(c);
      });
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const status = res.statusCode || 0;
        resolve({ ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) });
      });
      res.on("error", reject);
    });
    const onAbort = () => { req.destroy(); reject(signal.reason); };
    signal.addEventListener("abort", onAbort, { once: true });
    req.on("close", () => signal.removeEventListener("abort", onAbort));
    req.on("error", reject);
    req.end(body ?? undefined);
  });
}
