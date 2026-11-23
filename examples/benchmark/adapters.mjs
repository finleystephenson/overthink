// Agents the runner can score. Every agent has the same shape:
//   agent.turn(customerText) -> Promise<{ reply, usage? }>
//   agent.close() -> Promise<void>
// The runner never trusts what an agent says it did. It reads the sandbox's own trace and diff afterwards.
//
//  anthropic : the runner drives a Claude model through the SDK and runs its tool calls itself.
//  http      : POST each customer message to your URL. Your agent calls the shop's tools through the web API.
//  cmd       : the same message, as one JSON line on stdin of a command you give. Reply is one JSON line on stdout.
//
// Message sent to http / cmd agents on every turn (protocol 1):
//   { protocol: 1, session_id, turn, message, channel, role, api_url, token, system_prompt }
// Expected reply: { "reply": "text for the customer" }
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const MAX_TOOL_ROUNDS = 12;
const MAX_TOKENS = 1500;
const TIMEOUT_MS = 120000;
export const newUsage = () => ({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
const addUsage = (a, u) => { for (const k of Object.keys(a)) a[k] += u?.[k] || 0; };
const textOf = (content) => content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

/** The runner runs the tools itself. `calls` collects every call for scoring. */
export function anthropicAgent({ client, model, system, tools, session }) {
  const messages = [];
  const calls = [];
  const usage = newUsage();
  let turnNo = 0, hitLimit = false;
  return {
    calls, usage,
    get hitLimit() { return hitLimit; },
    turn: async (text) => {
      const turn = turnNo++;
      messages.push({ role: "user", content: text });
      let reply = "";
      for (let round = 0; ; round++) {
        if (round >= MAX_TOOL_ROUNDS) { hitLimit = true; break; }
        const res = await client.messages.create({ model, max_tokens: MAX_TOKENS, system, tools, messages });
        addUsage(usage, res.usage);
        messages.push({ role: "assistant", content: res.content });
        reply = textOf(res.content) || reply;
        const uses = res.content.filter((b) => b.type === "tool_use");
        if (res.stop_reason !== "tool_use" || !uses.length) break;
        const results = uses.map((u) => {
          const r = session.call(u.name, u.input);
          calls.push({ turn, tool: u.name, input: u.input, ok: r.ok, error_code: r.error?.code ?? null, result: r });
          return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(r), ...(r.ok ? {} : { is_error: true }) };
        });
        messages.push({ role: "user", content: results });
      }
      return { reply };
    },
    close: async () => {},
  };
}

/** An agent behind a URL. `base` is built by the runner (session id, token, api_url). */
export function httpAgent({ url, base, fetchImpl = fetch }) {
  let turn = 0;
  return {
    turn: async (message) => {
      const res = await fetchImpl(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...base, turn: turn++, message }), signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`agent at ${url} answered HTTP ${res.status}`);
      const body = await res.json();
      if (typeof body.reply !== "string") throw new Error(`agent at ${url} did not return {"reply": "..."}`);
      return { reply: body.reply };
    },
    close: async () => {},
  };
}

/** An agent as a command. One process per conversation, one JSON line in and one JSON line out per turn. */
export function cmdAgent({ command, base }) {
  const child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let turn = 0;
  return {
    turn: async (message) => {
      child.stdin.write(JSON.stringify({ ...base, turn: turn++, message }) + "\n");
      let timer;
      const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`command gave no reply in ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS); });
      try {
        const { value, done } = await Promise.race([lines.next(), timeout]);
        if (done) throw new Error("command exited before replying");
        const body = JSON.parse(value);
        if (typeof body.reply !== "string") throw new Error('command did not print {"reply": "..."}');
        return { reply: body.reply };
      } finally { clearTimeout(timer); }
    },
    close: async () => { child.stdin.end(); child.kill(); },
  };
}

/** Turn sandbox trace entries for one conversation into the "calls" the scorer reads. */
export function callsFromTrace(trace, { role, session }) {
  return trace
    .filter((t) => t.kind === "tool" && t.actor?.role === role && t.actor?.session === session)
    .map((t, i) => ({
      turn: i, tool: t.tool, input: t.input, ok: t.ok, error_code: t.error?.code ?? null,
      result: t.ok ? { ok: true, data: t.result } : { ok: false, error: t.error },
    }));
}
