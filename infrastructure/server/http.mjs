// The web door: a plain node:http server over the sandbox store, plus the MCP streamable HTTP endpoint at /mcp.
// HTTP status says whether the server handled the request; `ok` in the body says what the business answered.
// So a tool the role may not use is HTTP 200 with { ok: false, error: { code: "forbidden" } }, exactly as the engine said it.
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./mcp.mjs";
import { openApi } from "./openapi.mjs";
import { listScenarios, scenarioNames } from "./scenarios.mjs";
import { listInbox, reply, push, viewMessage } from "./inbox.mjs";
import { freshWorld, ROLES } from "./world-data.mjs";
import { JOBS, publicJob, needJob, startJob, stopJob, jobsTaken, jobResult, applyCovers, connectionFor, callHelper, canMoveTime, HELPER_TOOLS } from "./jobs.mjs";
import { testService, DEFAULT_TIMEOUT_SECONDS } from "./deliver.mjs";
import { exploreRoutes } from "./explore.mjs";
import { activityRoutes, createActivityMcpServer } from "../../activity-generation/toolset.ts";
import { labRoutes } from "../../simulation/lab/routes.mjs";

const STATUS = { unauthorized: 401, forbidden: 403, not_found: 404, invalid_input: 400, rate_limited: 429, payload_too_large: 413, unavailable: 503, rule_violation: 409, method_not_allowed: 405 };
const fail = (code, message, status) => { throw Object.assign(new Error(message), { code, status }); };
// WHY no CORS unless asked for: the apps and the explorer are served from this same address and need none, and
// "Access-Control-Allow-Origin: *" would let any website a person visits drive their local server. Turn it on for one
// origin (or "*") with --cors-origin, e.g. for a browser-based MCP client on another address.
const CORS_BASE = {
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Role, X-Customer-Id, X-Session-Id, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};
// Sent on every answer. no-referrer: addresses here can carry ids, and nothing outside needs to see them.
const BASE_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
// JSON is never a page: nothing in it may load, run or be framed even if a browser is tricked into rendering it.
const JSON_CSP = "default-src 'none'; frame-ancestors 'none'";
const MAX_JSON_DEPTH = 32;
// WHY: these keys are how a JSON body reaches an object's prototype once code copies or merges it. No input here needs them.
const BANNED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// ---- static files: the apps (applications/) and the product pictures (business/site/img/), read-only, so one port serves everything.
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
// WHY the explorer lives under /apps/: it is one of the screens in applications/ and shares their lib/ by relative
// imports, so its address mirrors its folder. /explore/ still works and redirects there.
const STATIC = [
  { prefix: "/apps/", dir: join(ROOT, "applications") },
  { prefix: "/img/", dir: join(ROOT, "business", "site", "img") },
];
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
  ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2",
};

/**
 * The file for a static address, or null. Refuses anything outside its folder (.., encoded slashes, absolute paths),
 * hidden files, and server code; a folder gives its index.html or nothing (no listings).
 * @param {string} pathname
 * @return {Promise<?string>}
 */
export async function resolveStatic(pathname) {
  const route = STATIC.find((r) => pathname.startsWith(r.prefix));
  if (!route) return null;
  let rel;
  try { rel = decodeURIComponent(pathname.slice(route.prefix.length)); } catch { return null; }
  if (rel.includes("\0") || rel.includes("\\") || rel.split("/").some((part) => part.startsWith("."))) return null;
  const file = normalize(join(route.dir, rel));
  if (file !== route.dir && !file.startsWith(route.dir + sep)) return null;
  // WHY: applications/dev.mjs is a server script that happens to live among the pages; it is not a page.
  if (file === join(ROOT, "applications", "dev.mjs")) return null;
  try {
    const s = await stat(file);
    if (!s.isDirectory()) return s.isFile() ? file : null;
    const index = join(file, "index.html");
    return (await stat(index).catch(() => null))?.isFile() ? index : null;
  } catch {
    return null;
  }
}

/**
 * The Content-Security-Policy for one page. Scripts only from this server, plus the page's own inline scripts by hash
 * (the small theme snippet each page has), so a script tag smuggled into the page through the world's text never runs.
 * Styles allow inline (pages set CSS variables in style="..."); fonts come from Google Fonts; the explorer's "use your
 * own model" calls api.anthropic.com from the browser. frame-ancestors: this site, plus any origin the server's
 * owner allows (--frame-ancestors), e.g. a website that embeds the explorer.
 * @param {string} html
 * @param {Array<string>=} frameAncestors
 * @return {string}
 */
export function pageCsp(html, frameAncestors = []) {
  const hashes = [];
  for (const m of html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    hashes.push(`'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
  }
  return [
    "default-src 'self'", `script-src 'self'${hashes.length ? ` ${hashes.join(" ")}` : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:", "connect-src 'self' https://api.anthropic.com", "frame-src 'self'",
    `frame-ancestors 'self'${frameAncestors.length ? ` ${frameAncestors.join(" ")}` : ""}`,
    "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join("; ");
}

/**
 * Checks an origin given in the server's settings: scheme, host and optional port, nothing else (no paths, no spaces,
 * no quotes), so it cannot add its own rules to a header.
 * @param {string} o
 * @return {string}
 */
export function checkOrigin(o) {
  if (o === "*" || /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(o) || /^https?:\/\/\[[0-9a-f:]+\](:\d{1,5})?$/i.test(o)) return o;
  throw new Error(`"${o}" is not an origin like https://example.com`);
}

/**
 * Parses a JSON body, refusing what no honest input needs: nesting deeper than MAX_JSON_DEPTH and the keys
 * __proto__, constructor and prototype at any depth (prototype pollution).
 * @param {string} text
 * @return {*}
 */
export function parseSafeJson(text) {
  let depth = 0, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") { if (++depth > MAX_JSON_DEPTH) fail("invalid_input", `The body is nested more than ${MAX_JSON_DEPTH} deep.`); }
    else if (c === "}" || c === "]") depth--;
  }
  let value;
  try { value = JSON.parse(text); } catch { fail("invalid_input", "The body is not valid JSON."); }
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== "object") continue;
    for (const k of Object.keys(v)) {
      if (BANNED_KEYS.has(k)) fail("invalid_input", `The key "${k}" is not allowed.`);
      stack.push(v[k]);
    }
  }
  return value;
}

/** Serves a static GET or HEAD. Returns true when it answered. no-cache so an edited file shows on the next reload. */
async function serveStatic(req, res, url, frameAncestors) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  // A browser opening the root wants the front door, the sandbox desktop (applications/desktop/); an API client asking for JSON still gets the API's root.
  if (url.pathname === "/" && String(req.headers.accept || "").includes("text/html")) return redirect(res, 302, "/apps/desktop/");
  if (url.pathname === "/apps") return redirect(res, 301, "/apps/");
  if (url.pathname === "/explore" || url.pathname.startsWith("/explore/")) return redirect(res, 301, `/apps/explore/${url.pathname.slice("/explore/".length)}${url.search}`);
  // WHY: browsers always ask for /favicon.ico; answer it (or an empty 204) so the console shows no 404.
  if (url.pathname === "/favicon.ico") {
    for (const name of ["favicon.svg", "favicon.ico"]) {
      const body = await readFile(join(ROOT, "applications", name)).catch(() => null);
      if (!body) continue;
      res.writeHead(200, { ...BASE_HEADERS, "Content-Type": TYPES[extname(name)], "Cache-Control": "no-cache", "Content-Length": body.length });
      res.end(req.method === "HEAD" ? undefined : body);
      return true;
    }
    res.writeHead(204);
    res.end();
    return true;
  }
  if (!STATIC.some((r) => url.pathname.startsWith(r.prefix))) return false;
  const file = await resolveStatic(url.pathname);
  if (!file) {
    res.writeHead(404, { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Nothing here.");
    return true;
  }
  // A folder address without its slash would break the page's relative links.
  if (file.endsWith(`${sep}index.html`) && !url.pathname.endsWith("/") && !url.pathname.endsWith("index.html")) return redirect(res, 301, `${url.pathname}/${url.search}`);
  const body = await readFile(file);
  const type = TYPES[extname(file).toLowerCase()] || "application/octet-stream";
  const csp = type.startsWith("text/html") ? { "Content-Security-Policy": pageCsp(body.toString("utf8"), frameAncestors) } : {};
  res.writeHead(200, { ...BASE_HEADERS, ...csp, "Content-Type": type, "Cache-Control": "no-cache", "Content-Length": body.length });
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}

function redirect(res, status, location) {
  res.writeHead(status, { Location: location });
  res.end();
  return true;
}

function send(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { ...BASE_HEADERS, "Content-Security-Policy": JSON_CSP, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
}

/** Read a JSON body, refusing anything over the limit before it is all in memory. */
async function readJson(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) fail("payload_too_large", `Request body is over ${limit} bytes.`);
    chunks.push(c);
  }
  if (!size) return {};
  return parseSafeJson(Buffer.concat(chunks).toString("utf8"));
}

/** Token bucket per caller: `perMinute` requests, refilled smoothly. */
export class RateLimiter {
  constructor(perMinute, clock = () => Date.now()) { Object.assign(this, { perMinute, clock, buckets: new Map() }); }
  take(key) {
    const now = this.clock();
    const b = this.buckets.get(key) || { tokens: this.perMinute, at: now };
    b.tokens = Math.min(this.perMinute, b.tokens + ((now - b.at) * this.perMinute) / 60000);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
  sweep() { for (const [k, b] of this.buckets) if (this.clock() - b.at > 60000) this.buckets.delete(k); }
}

/**
 * @param {object} o
 * @param {?string=} o.corsOrigin Answer cross-origin browser requests from this origin ("*" for any). Default: none.
 * @param {Array<string>=} o.frameAncestors Origins (besides this one) allowed to put the pages in a frame.
 * @param {number=} o.ipRateLimit Requests a minute from one address, for every route (0 = off, the local default).
 * @param {boolean=} o.trustProxy Take the caller's address from X-Forwarded-For (only behind your own proxy).
 * @param {?object=} o.labLimits The lab's limits (simulation/lab/routes.mjs webLimits); default: from the environment.
 */
export function createApp({ store, rateLimit = 120, bodyLimit = 64 * 1024, allowedHosts = null, clock = () => Date.now(),
  corsOrigin = null, frameAncestors = [], ipRateLimit = 0, trustProxy = false, labLimits = null }) {
  if (corsOrigin) checkOrigin(corsOrigin);
  frameAncestors.forEach(checkOrigin);
  const limiter = new RateLimiter(rateLimit, clock);
  const ipLimiter = ipRateLimit > 0 ? new RateLimiter(ipRateLimit, clock) : null;
  // WHY sweep: one bucket per token and per address; without it the map only grows.
  setInterval(() => { limiter.sweep(); ipLimiter?.sweep(); }, 60000).unref();
  const addressOf = (req) => (trustProxy && req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]).split(",")[0].trim() : req.socket.remoteAddress);
  /** CORS headers for this request: only when the server's owner turned CORS on, and only for that origin. */
  const corsFor = (req) => {
    if (!corsOrigin) return {};
    if (corsOrigin === "*") return { ...CORS_BASE, "Access-Control-Allow-Origin": "*" };
    return req.headers.origin === corsOrigin ? { ...CORS_BASE, "Access-Control-Allow-Origin": corsOrigin, Vary: "Origin" } : { Vary: "Origin" };
  };
  /**
   * A browser request that changes something, sent by a page from another site, is refused (cross-site request
   * forgery: a "simple" form POST needs no CORS preflight). Browsers always send Origin on such requests; tools
   * like curl and MCP clients send none and are unaffected.
   */
  const crossSite = (req) => {
    const origin = req.headers.origin;
    if (!origin || ["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
    if (corsOrigin && (corsOrigin === "*" || origin === corsOrigin)) return false;
    try { return new URL(origin).host !== req.headers.host; } catch { return true; }
  };
  const mcpSessions = new Map();  // Mcp-Session-Id → { transport, sandboxId, principalId }
  const docWorld = freshWorld("demo");
  const openapi = openApi(docWorld, ROLES, scenarioNames);
  store.listeners.add((sandboxId) => {
    for (const [sid, s] of mcpSessions) if (s.sandboxId === sandboxId) { mcpSessions.delete(sid); s.transport.close().catch(() => {}); }
  });

  function auth(req) {
    const m = (req.headers.authorization || "").match(/^Bearer\s+(\S+)$/i);
    // WHY a key in the address, for /mcp only: several MCP clients (custom connectors, URL-only settings) cannot send
    // headers. Elsewhere a token in a URL would end up in logs for no gain.
    const url = new URL(req.url, "http://x");
    const key = m ? m[1] : url.pathname === "/mcp" || url.pathname === "/mcp/activity" ? url.searchParams.get("key") : null;
    const found = key && store.authenticate(key);
    if (!found) fail("unauthorized", "Send a sandbox token: Authorization: Bearer <token>. Create a sandbox with POST /sandboxes.");
    if (!limiter.take(`${found.sandbox.id}:${found.principal.id}`)) fail("rate_limited", `More than ${rateLimit} requests a minute from this token. Slow down.`);
    return found;
  }
  const ownerOf = (req, id) => {
    const a = auth(req);
    // A token for another sandbox looks the same as no sandbox, so ids cannot be probed.
    if (a.sandbox.id !== id) fail("not_found", `No sandbox ${id}.`);
    if (!a.principal.owner) fail("forbidden", "Only the sandbox owner token can do this.");
    return a;
  };
  const memberOf = (req, id) => {
    const a = auth(req);
    if (a.sandbox.id !== id) fail("not_found", `No sandbox ${id}.`);
    return a;
  };
  // Moving time and reading the impact are the business owner's decisions: the owner token or a manager token.
  const runnerOf = (req, id) => {
    const a = memberOf(req, id);
    if (!canMoveTime(a.principal, { role: a.principal.role })) fail("forbidden", "Only the owner token, a manager token or a job key allowed to move time can do this.");
    return a;
  };
  const actorFrom = (req, a, url, fallbackRole) => store.actAs(a.principal, {
    role: req.headers["x-role"] || url.searchParams.get("role") || (a.principal.owner ? fallbackRole : undefined),
    customer_id: req.headers["x-customer-id"] || url.searchParams.get("customer_id") || undefined,
  });
  const sessionKey = (req) => String(req.headers["x-session-id"] || "default").slice(0, 64);

  // ---- routes: [method, pattern, handler(req, url, params) → [status, body]]
  const routes = [
    ["GET", /^\/$/, () => [200, { name: "Overthought & Co. sandbox", docs: "docs/connect.md", openapi: "/openapi.json", mcp: "/mcp", create: "POST /sandboxes" }]],
    ["GET", /^\/health$/, () => [200, { ok: true, sandboxes: store.sandboxes.size }]],
    ["GET", /^\/scenarios$/, () => [200, { ok: true, data: listScenarios() }]],
    ["GET", /^\/jobs$/, () => [200, { ok: true, data: JOBS.map(publicJob) }]],
    ["GET", /^\/sandboxes\/([0-9a-f]{16})\/jobs$/, (req, url, [id]) => [200, { ok: true, data: jobsTaken(ownerOf(req, id).sandbox) }]],
    ["POST", /^\/sandboxes\/([0-9a-f]{16})\/jobs\/([a-z-]+)\/start$/, async (req, url, [id, jobId]) => {
      const { sandbox } = ownerOf(req, id);
      const b = await readJson(req, bodyLimit);
      const base = baseOf(req);
      const { job, token, cover } = startJob(store, sandbox, jobId, { can_move_time: b.can_move_time, staff_after_minutes: b.staff_after_minutes, url: b.url, timeout_seconds: b.timeout_seconds, api_url: base });
      return [201, { ok: true, data: { job: publicJob(job), role: job.role, cover, url: b.url ? sandbox.jobs[job.id].url : null,
        connect: connectionFor(base, token), note: "Keep this key secret; it is shown once. Anyone holding it acts as this job." } }];
    }],
    ["POST", /^\/sandboxes\/([0-9a-f]{16})\/jobs\/([a-z-]+)\/stop$/, (req, url, [id, jobId]) => {
      const { sandbox } = ownerOf(req, id);
      stopJob(store, sandbox, jobId);
      return [200, { ok: true, data: jobsTaken(sandbox).find((j) => j.id === jobId) }];
    }],
    ["POST", /^\/sandboxes\/([0-9a-f]{16})\/jobs\/([a-z-]+)\/test$/, async (req, url, [id, jobId]) => {
      const { sandbox } = ownerOf(req, id);
      const job = needJob(jobId);
      const b = await readJson(req, bodyLimit);
      const taken = sandbox.jobs?.[job.id];
      const target = b.url || taken?.url;
      if (!target) fail("invalid_input", 'Give "url" (your AI\'s web address), or start the job with one first.');
      // A key for the test alone, so the service can look things up; it stops working as soon as the test is over.
      const temp = store.mintRoleToken(sandbox, { role: job.role, label: `test:${job.id}` });
      let r;
      try {
        r = await testService({ url: target, timeoutSeconds: taken?.timeout_seconds || DEFAULT_TIMEOUT_SECONDS, message: typeof b.message === "string" ? b.message.slice(0, 2000) : undefined,
          channel: b.channel || (job.id === "reception" ? "phone" : "email"), role: job.role, apiUrl: baseOf(req), token: temp.token });
      } finally {
        sandbox.tokens.find((p) => p.id === temp.id).revoked = true;
      }
      return [200, { ok: !r.error, data: r, ...(r.error ? { error: { code: "unavailable", message: `Your AI did not answer properly: ${r.error}. Check the address is reachable from this server and returns {"reply": "..."}.` } } : {}) }];
    }],
    ["GET", /^\/sandboxes\/([0-9a-f]{16})\/jobs\/([a-z-]+)\/result$/, async (req, url, [id, jobId]) => {
      const a = memberOf(req, id);
      if (!a.principal.owner && a.principal.role !== "manager" && a.principal.job !== jobId) fail("forbidden", "Only the owner token, a manager token or this job's own key can read its result.");
      return [200, { ok: true, data: await jobResult(store, a.sandbox, jobId, { allVoices: url.searchParams.get("voices") === "all" }) }];
    }],
    ["GET", /^\/openapi\.json$/, () => [200, openapi]],
    ["POST", /^\/sandboxes$/, async (req) => {
      const b = await readJson(req, bodyLimit);
      const { sandbox, token } = store.create({ size: b.size, scenario: b.scenario, seed: b.seed, bench: b.bench });
      return [201, { ok: true, data: { ...store.describe(sandbox), token, note: "Keep this owner token secret; it is shown once." } }];
    }],
    ["GET", /^\/sandboxes\/([0-9a-f]{16})$/, (req, url, [id]) => [200, { ok: true, data: store.describe(ownerOf(req, id).sandbox) }]],
    ["DELETE", /^\/sandboxes\/([0-9a-f]{16})$/, (req, url, [id]) => { ownerOf(req, id); store.remove(id); return [200, { ok: true, data: { deleted: id } }]; }],
    ["POST", /^\/sandboxes\/([0-9a-f]{16})\/reset$/, (req, url, [id]) => {
      const { sandbox } = ownerOf(req, id);
      store.reset(sandbox);
      applyCovers(store, sandbox); // the jobs still taken need their cover back in the fresh world
      for (const [sid, s] of mcpSessions) if (s.sandboxId === id) { mcpSessions.delete(sid); s.transport.close().catch(() => {}); }
      return [200, { ok: true, data: store.describe(sandbox) }];
    }],
    ["POST", /^\/sandboxes\/([0-9a-f]{16})\/tokens$/, async (req, url, [id]) => {
      const { sandbox } = ownerOf(req, id);
      return [201, { ok: true, data: store.mintRoleToken(sandbox, await readJson(req, bodyLimit)) }];
    }],
    ["GET", /^\/sandboxes\/([0-9a-f]{16})\/trace$/, (req, url, [id]) => {
      const { sandbox } = ownerOf(req, id);
      const since = Number(url.searchParams.get("since") || 0);
      return [200, { ok: true, data: { sandbox: id, scenario: sandbox.scenario, calls: sandbox.trace.filter((t) => t.seq > since) } }];
    }],
    ["GET", /^\/sandboxes\/([0-9a-f]{16})\/diff$/, (req, url, [id]) => [200, { ok: true, data: store.diff(ownerOf(req, id).sandbox) }]],
    ["POST", /^\/sandboxes\/([0-9a-f]{16})\/advance$/, async (req, url, [id]) => {
      const { sandbox, principal } = runnerOf(req, id);
      const { days = 1 } = await readJson(req, bodyLimit);
      if (!Number.isInteger(days) || days < 1 || days > store.maxAdvanceDays) fail("invalid_input", `"days" must be a whole number from 1 to ${store.maxAdvanceDays}.`);
      // The business and its shadow twin move together (simulation/simulator/live.mjs). Each day: what the engine did, plus `summary`.
      const out = await store.advance(sandbox, principal, days);
      return [200, { ok: true, data: { ...out, clock: store.simClock(sandbox) } }];
    }],
    ["GET", /^\/sandboxes\/([0-9a-f]{16})\/clock$/, (req, url, [id]) => [200, { ok: true, data: store.simClock(memberOf(req, id).sandbox) }]],
    ["GET", /^\/sandboxes\/([0-9a-f]{16})\/impact$/, async (req, url, [id]) => [200, { ok: true, data: await store.impact(runnerOf(req, id).sandbox) }]],
    ["GET", /^\/sandboxes\/([0-9a-f]{16})\/inbox$/, (req, url, [id]) => {
      const { sandbox, principal } = memberOf(req, id);
      const status = url.searchParams.get("status") || "waiting";
      if (!["waiting", "replied", "all"].includes(status)) fail("invalid_input", '"status" must be waiting, replied or all.');
      return [200, { ok: true, data: listInbox(sandbox.inbox, { owner: principal.owner, status }) }];
    }],
    ["POST", /^\/sandboxes\/([0-9a-f]{16})\/inbox$/, async (req, url, [id]) => {
      const { sandbox, principal } = ownerOf(req, id);
      const msg = push(sandbox.world.state, sandbox.inbox, await readJson(req, bodyLimit));
      store.record(sandbox, { kind: "inbox.message", actor: { token: principal.id, role: null }, message: viewMessage(msg, { owner: true }) });
      return [201, { ok: true, data: viewMessage(msg, { owner: true }) }];
    }],
    ["POST", /^\/sandboxes\/([0-9a-f]{16})\/inbox\/(MSG-\d+)\/reply$/, async (req, url, [id, msgId]) => {
      const a = memberOf(req, id);
      const actor = actorFrom(req, a, url, "assistant");
      const { text } = await readJson(req, bodyLimit);
      const { message, next } = reply(a.sandbox.world.state, a.sandbox.inbox, msgId, { role: actor.role, text });
      const view = (m) => m && viewMessage(m, { owner: a.principal.owner });
      store.record(a.sandbox, { kind: "inbox.reply", actor: { token: a.principal.id, role: actor.role }, message_id: msgId, conversation_id: message.conversation_id, text, released: next ? viewMessage(next, { owner: true }) : null });
      return [200, { ok: true, data: { replied: view(message), next: view(next) } }];
    }],
    ["GET", /^\/tools$/, (req, url) => {
      const a = auth(req);
      const role = a.principal.owner && !req.headers["x-role"] && !url.searchParams.get("role") ? null : actorFrom(req, a, url).role;
      const tools = a.sandbox.world.tools.filter((t) => !role || t.roles.includes(role));
      return [200, { ok: true, data: { role: role ?? "(owner: all tools; send X-Role to filter)", tools } }];
    }],
    ["POST", /^\/tools\/([a-z_]+)$/, async (req, url, [name]) => {
      const a = auth(req);
      const input = await readJson(req, bodyLimit);
      if (typeof input !== "object" || Array.isArray(input)) fail("invalid_input", "The body must be a JSON object: the tool's input.");
      // The helper tools (get_started, whats_waiting, get_job_result) and advance_time work here too, so an agent on
      // the web API gets the same as one on MCP.
      if (HELPER_TOOLS[name]) return [200, await callHelper(store, a.sandbox, a.principal, actorFrom(req, a, url, "manager"), name, input)];
      if (name === "advance_time") {
        if (!canMoveTime(a.principal, { role: a.principal.role })) return [200, { ok: false, error: { code: "forbidden", message: "This key cannot move time." } }];
        if (!Number.isInteger(input.days) || input.days < 1 || input.days > store.maxAdvanceDays) fail("invalid_input", `"days" must be a whole number from 1 to ${store.maxAdvanceDays}.`);
        const out = await store.advance(a.sandbox, a.principal, input.days);
        return [200, { ok: true, data: { now: out.now, days: out.days.map((d) => d.summary), clock: store.simClock(a.sandbox) } }];
      }
      return [200, store.call(a.sandbox, a.principal, { ...actorFrom(req, a, url), session: sessionKey(req) }, name, input)];
    }],
    // Plain reads for exploring. They go through the same open engine tools, so they are traced too.
    ["GET", /^\/products$/, (req, url) => toolGet(req, url, "search_catalogue", { query: url.searchParams.get("q") || "" })],
    ["GET", /^\/products\/([A-Za-z0-9-]+)$/, (req, url, [id]) => toolGet(req, url, "get_product", { id })],
    ["GET", /^\/policies$/, (req) => {
      const a = auth(req);
      return [200, { ok: true, data: a.sandbox.world.policies.filter((p) => p.audience !== "internal").map(({ id, title, summary }) => ({ id, title, summary })) }];
    }],
    ["GET", /^\/policies\/([a-z0-9-]+)$/, (req, url, [id]) => toolGet(req, url, "get_policy", { id })],
    ["GET", /^\/help$/, (req) => [200, { ok: true, data: auth(req).sandbox.world.help }]],
    // The explorer's reads (infrastructure/server/explore.mjs): owner token only, because they show the world lens.
    ...exploreRoutes({ store, ownerOf }),
    // The activity toolset (activity-generation/toolset.ts): the owner creates people and activity, moves time, resets.
    ...activityRoutes({ store, ownerOf, readJson: (req) => readJson(req, bodyLimit) }),
    // The lab (simulation/lab/routes.mjs): experiments, plans and /overthink. No token; limited per request and in total.
    ...labRoutes({ readJson: (req) => readJson(req, bodyLimit), ...(labLimits ? { limits: labLimits } : {}) }),
  ];

  /** This server's address as the caller reached it, for connection details and for services to call back. */
  const baseOf = (req) => `${String(req.headers["x-forwarded-proto"] || "http").split(",")[0]}://${req.headers.host}`;

  function toolGet(req, url, tool, input) {
    const a = auth(req);
    // The owner reads as the assistant by default: these open tools show the same to every role.
    return [200, store.call(a.sandbox, a.principal, { ...actorFrom(req, a, url, "assistant"), session: sessionKey(req) }, tool, input)];
  }

  // ---- MCP over streamable HTTP. The bearer token picks the sandbox and the role.
  async function handleMcp(req, res, { activity = false } = {}) {
    const a = auth(req);
    // WHY owner only: the activity tools speak for people outside the company; a product's key must never reach them.
    if (activity && !a.principal.owner) fail("forbidden", "The activity tools need the sandbox owner key.");
    const sid = req.headers["mcp-session-id"];
    const body = req.method === "POST" ? await readJson(req, bodyLimit) : undefined;
    if (sid) {
      const s = mcpSessions.get(sid);
      // A session belongs to the token that opened it.
      if (!s || s.principalId !== a.principal.id || s.sandboxId !== a.sandbox.id) fail("not_found", "Unknown MCP session. Start a new one with initialize.");
      return s.transport.handleRequest(req, res, body);
    }
    if (req.method !== "POST" || !isInitializeRequest(body)) fail("invalid_input", "Start an MCP session with an initialize request (no Mcp-Session-Id header).");
    const url = new URL(req.url, "http://x");
    const actor = activity ? null : actorFrom(req, a, url);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => mcpSessions.set(id, { transport, sandboxId: a.sandbox.id, principalId: a.principal.id }),
      onsessionclosed: (id) => mcpSessions.delete(id),
    });
    const server = activity
      ? createActivityMcpServer({ store, sandbox: a.sandbox, principal: a.principal })
      : createMcpServer({ store, sb: a.sandbox, principal: a.principal, actor, session: `mcp-${randomUUID()}` });
    await server.connect(transport);
    return transport.handleRequest(req, res, body);
  }

  return createServer(async (req, res) => {
    try {
      // DNS-rebinding guard: when bound to this machine, only answer requests addressed to this machine.
      const host = String(req.headers.host || "").replace(/:\d+$/, "");
      if (allowedHosts && !allowedHosts.includes(host)) fail("forbidden", "Host not allowed.");
      for (const [k, v] of Object.entries(corsFor(req))) res.setHeader(k, v);
      if (req.method === "OPTIONS") { res.writeHead(204, BASE_HEADERS); return res.end(); }
      if (crossSite(req)) fail("forbidden", "Requests that change something are not accepted from other websites.");
      // On a shared server every address gets a budget, tokens or not (the lab and the pages need none).
      if (ipLimiter && !ipLimiter.take(addressOf(req))) fail("rate_limited", "Too many requests from this address. Slow down.");
      const url = new URL(req.url, "http://localhost");
      if (await serveStatic(req, res, url, frameAncestors)) return;
      if (url.pathname === "/mcp") return await handleMcp(req, res);
      if (url.pathname === "/mcp/activity") return await handleMcp(req, res, { activity: true });
      // Creating sandboxes needs no token, so it is limited per address instead.
      if (url.pathname === "/sandboxes" && req.method === "POST" && !limiter.take(`ip:${addressOf(req)}`)) fail("rate_limited", "Too many requests from this address.");
      let methodSeen = false;
      for (const [method, pattern, handler] of routes) {
        const m = url.pathname.match(pattern);
        if (!m) continue;
        methodSeen = true;
        if (method !== req.method) continue;
        const [status, body] = await handler(req, url, m.slice(1));
        return send(res, status, body);
      }
      fail(methodSeen ? "method_not_allowed" : "not_found", methodSeen ? `${req.method} is not allowed here.` : `Nothing at ${url.pathname}. See /openapi.json.`);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e.code && (STATUS[e.code] || e.status)) return send(res, e.status || STATUS[e.code], { ok: false, error: { code: e.code, message: e.message } });
      // Unexpected: log it here, never send the stack to the caller.
      console.error(e);
      send(res, 500, { ok: false, error: { code: "internal", message: "Something went wrong on the server. The call may not have completed." } });
    }
  });
}
