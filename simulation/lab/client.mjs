// Connecting an AI or tool under test, timed.
//
// The protocol is the simulator's (simulation/simulator/README.md, "The tool protocol"): one JSON message in, {"reply": "..."} out, one
// process (or one web address) for the whole run, every message carrying its own session_id. A tool may also return
// `cost_gbp` (what that reply cost it, e.g. model tokens) and `usage` ({ input_tokens, output_tokens }); the lab adds
// them up for the scorecard but never requires them. `version` and `model`, if sent, are recorded for reproducibility.
//
// WHY its own client and not simulation/simulator/tool.mjs: that one keeps only `reply`. This one keeps the timing of every reply and
// whatever cost the tool reports, which the scorecard needs. The wire format is the same, so any tool that works with
// `pnpm sim --tool-cmd` works here unchanged.
//
// Every payload also gets `mcp_url` (the shop's MCP address for the same key), so an AI built as an MCP client can
// reach the tools that way instead of the web API.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { checkOutboundUrl, guardedFetch } from "../../infrastructure/server/net-guard.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * @typedef {object} Connection
 * @property {string} kind "cmd" (a command speaking the protocol on stdin/stdout), "http" (a web address taking the
 *     protocol as a POST), or "none" (no tool: staff only).
 * @property {string=} cmd For "cmd".
 * @property {string=} url For "http".
 * @property {string=} label A plain name for reports.
 */

/**
 * Checks and tidies a connection description.
 * @param {*} c
 * @return {Connection}
 */
export function checkConnection(c) {
  const fail = (m) => { throw Object.assign(new Error(m), { code: "invalid_input" }); };
  if (!c || typeof c !== "object") fail('Say how to connect: { "kind": "cmd", "cmd": "node my-ai.mjs" }, { "kind": "http", "url": "https://..." } or { "kind": "none" }.');
  if (c.kind === "none") return { kind: "none", label: c.label || "No AI (staff only)" };
  if (c.kind === "cmd") {
    if (typeof c.cmd !== "string" || !c.cmd.trim()) fail('A "cmd" connection needs the command to start, in "cmd".');
    return { kind: "cmd", cmd: c.cmd, label: c.label || c.cmd };
  }
  if (c.kind === "http") {
    let u = null;
    // WHY the shared guard: on a hosted server it also refuses private and local addresses (infrastructure/server/net-guard.mjs).
    try { u = checkOutboundUrl(c.url); } catch (e) { fail(`An "http" connection needs your AI's web address, starting http:// or https://, in "url". ${e.message}`); }
    return { kind: "http", url: u.toString(), label: c.label || u.host };
  }
  return fail('"kind" must be "cmd", "http" or "none".');
}

/**
 * Opens a connection. Returns null for kind "none".
 * @param {Connection} conn
 * @param {{timeoutMs?: number, fetchImpl?: function}=} o
 * @return {?TimedClient}
 */
export function openClient(conn, { timeoutMs = 60000, fetchImpl = guardedFetch } = {}) {
  if (conn.kind === "none") return null;
  const raw = conn.kind === "http" ? httpTransport(conn.url, timeoutMs, fetchImpl) : cmdTransport(conn.cmd, timeoutMs);
  const log = [];
  return {
    connection: conn,
    log,
    /** The product's declared version and model, if it sends `version` / `model` with a reply. */
    declared: { version: null, model: null },
    /** One message, timed. Never throws: problems come back as { error }. */
    async call(payload) {
      const full = payload.api_url ? { ...payload, mcp_url: `${payload.api_url}/mcp` } : payload;
      const t0 = performance.now();
      const r = await raw.send(full);
      const ms = Math.round(performance.now() - t0);
      const entry = { session_id: payload.session_id, kind: payload.sim?.kind ?? null, ms, ok: !r.error, error: r.error ?? null,
        timeout: !!r.timeout, reply: r.reply ?? null, cost_gbp: num(r.cost_gbp), usage: r.usage ?? null };
      // What the product says it is (for reproducibility): kept from the first reply that says it.
      if (r.version && !this.declared.version) this.declared.version = String(r.version).slice(0, 80);
      if (r.model && !this.declared.model) this.declared.model = String(r.model).slice(0, 80);
      log.push(entry);
      return r.error ? { error: r.error } : { reply: r.reply };
    },
    close: () => raw.close(),
  };
}

/**
 * @typedef {object} TimedClient
 * @property {Connection} connection
 * @property {Array<object>} log One entry per message: session_id, kind, ms, ok, error, timeout, reply, cost_gbp, usage.
 * @property {function(object): Promise<{reply?: string, error?: string}>} call
 * @property {function(): Promise<void>} close
 */

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** Keeps the fields the lab reads from a tool's answer. */
function pick(body) {
  if (!body || typeof body.reply !== "string") return { error: 'the tool did not return {"reply": "..."}' };
  return { reply: body.reply, cost_gbp: body.cost_gbp, usage: body.usage && typeof body.usage === "object" ? body.usage : null, version: body.version, model: body.model };
}

function httpTransport(url, timeoutMs, fetchImpl) {
  return {
    async send(payload) {
      try {
        const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return { error: `the tool answered HTTP ${res.status}` };
        return pick(await res.json());
      } catch (e) {
        const timeout = e?.name === "TimeoutError";
        return { error: timeout ? `no reply in ${timeoutMs / 1000} seconds` : String(e.message || e), timeout };
      }
    },
    async close() {},
  };
}

function cmdTransport(cmd, timeoutMs) {
  let dead = null, chain = Promise.resolve();
  // WHY the project folder: commands in experiments are written relative to it ("node simulation/simulator/examples/...").
  const child = spawn(cmd, { shell: true, cwd: ROOT, stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  child.on("exit", (c) => { dead = `the tool's command stopped (exit code ${c})`; });
  child.on("error", (e) => { dead = `the tool's command could not start: ${e.message}`; });
  child.stdin.on("error", () => {});
  async function once(payload) {
    if (dead) return { error: dead };
    child.stdin.write(JSON.stringify(payload) + "\n");
    let timer;
    const timeout = new Promise((r) => { timer = setTimeout(() => r({ late: true }), timeoutMs); });
    try {
      const got = await Promise.race([lines.next(), timeout]);
      // WHY stop the process on a timeout: its next line could be the late answer to this message, and would then be
      // read as the answer to the next one.
      if (got.late) { dead = `the tool gave no reply in ${timeoutMs / 1000} seconds`; child.kill(); return { error: dead, timeout: true }; }
      if (got.done) return { error: dead || "the tool's command ended" };
      return pick(JSON.parse(got.value));
    } catch (e) {
      return { error: `the tool's answer was not JSON: ${String(e.message || e).slice(0, 80)}` };
    } finally { clearTimeout(timer); }
  }
  return {
    // One message at a time, in order, so replies cannot be mixed up.
    send(payload) { const p = chain.then(() => once(payload)); chain = p.catch(() => {}); return p; },
    async close() { try { child.stdin.end(); child.kill(); } catch {} },
  };
}
