// Talking to the tool under test. Same protocol style as examples/benchmark/README.md ("Score any AI"): a JSON message in, {"reply": "..."} out.
// Differences for the simulator: one process (or one URL) serves the whole run, so every message carries its own
// session_id (one per work item) and the tool must key any memory by it. Extra field `sim` says what kind of work this is.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export function makeToolClient({ cmd, http, timeoutMs = 60000, fetchImpl = fetch }) {
  if (http) {
    return {
      async call(payload) {
        try {
          const res = await fetchImpl(http, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
          if (!res.ok) return { error: `tool answered HTTP ${res.status}` };
          const body = await res.json();
          return typeof body.reply === "string" ? { reply: body.reply } : { error: 'tool did not return {"reply": "..."}' };
        } catch (e) { return { error: String(e.message || e) }; }
      },
      async close() {},
    };
  }
  let child = null, lines = null, dead = null, chain = Promise.resolve();
  const start = () => {
    child = spawn(cmd, { shell: true, stdio: ["pipe", "pipe", "inherit"] });
    lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    child.on("exit", (c) => { dead = `tool command exited (${c})`; });
    child.stdin.on("error", () => {});
  };
  start();
  const once = async (payload) => {
    if (dead) return { error: dead };
    child.stdin.write(JSON.stringify(payload) + "\n");
    let timer;
    const timeout = new Promise((r) => { timer = setTimeout(() => r({ timeout: true }), timeoutMs); });
    try {
      const got = await Promise.race([lines.next(), timeout]);
      if (got.timeout) { dead = `tool command gave no reply in ${timeoutMs / 1000}s`; child.kill(); return { error: dead }; }
      if (got.done) return { error: dead || "tool command ended" };
      const body = JSON.parse(got.value);
      return typeof body.reply === "string" ? { reply: body.reply } : { error: 'command did not print {"reply": "..."}' };
    } catch (e) { return { error: String(e.message || e) }; } finally { clearTimeout(timer); }
  };
  return {
    // Requests go one at a time, in order, so replies cannot be mixed up.
    call(payload) { const p = chain.then(() => once(payload)); chain = p.catch(() => {}); return p; },
    async close() { try { child.stdin.end(); child.kill(); } catch {} },
  };
}
