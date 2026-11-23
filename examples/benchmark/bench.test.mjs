// Tests for the benchmark plumbing: pass^k maths, AI-played customers, days steps, the scenario checker and the adapters.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { passMetrics } from "./passk.mjs";
import { scriptedCustomer, fakeCustomer, anthropicCustomer, converseWith, END } from "./customers.mjs";
import { stepsOf, flatten } from "./steps.mjs";
import { checkFacts, validateScenario, loadScenarioFiles } from "./check-scenarios.mjs";
import { callsFromTrace, httpAgent } from "./adapters.mjs";
import { loadData } from "../../infrastructure/engine/load.js";
import { parseArgs } from "./run.mjs";

const r = (id, category, pass) => ({ id, category, pass });

test("pass^k: all runs must pass; pass@1 is the average", () => {
  const m = passMetrics([
    r("a", "x", true), r("a", "x", true), r("a", "x", true),      // 3/3
    r("b", "x", true), r("b", "x", false), r("b", "x", true),     // 2/3
    r("c", "y", false), r("c", "y", false), r("c", "y", false),   // 0/3
  ]);
  assert.equal(m.k, 3);
  assert.equal(m.overall.pass_at_1, 5 / 9);
  assert.equal(m.overall.pass_hat_k, 1 / 3);
  assert.equal(m.categories.x.pass_at_1, 5 / 6);
  assert.equal(m.categories.x.pass_hat_k, 1 / 2);
  assert.equal(m.categories.y.pass_hat_k, 0);
});

test("pass^k equals pass@1 with a single run", () => {
  const m = passMetrics([r("a", "x", true), r("b", "x", false)]);
  assert.equal(m.k, 1);
  assert.equal(m.overall.pass_at_1, 0.5);
  assert.equal(m.overall.pass_hat_k, 0.5);
});

test("scripted customer plays its turns then stops", async () => {
  const c = scriptedCustomer(["a", "b"]);
  assert.equal((await c.next()).text, "a");
  assert.equal((await c.next()).text, "b");
  assert.equal((await c.next()).done, true);
});

test("converseWith: fake customer pushes back once, then ends; agent sees every message", async () => {
  const seen = [];
  const agent = { turn: async (t) => { seen.push(t); return { reply: "ok" }; } };
  const { added } = await converseWith({ customer: fakeCustomer(["hello"]), agent, history: [], maxTurns: 6 });
  assert.deepEqual(seen, ["hello", "Are you sure? Can I speak to a person?"]);
  assert.equal(added.length, 4);
});

test("converseWith stops at the turn limit", async () => {
  const forever = { next: async () => ({ text: "again", done: false }) };
  const { added } = await converseWith({ customer: forever, agent: { turn: async () => ({ reply: "no" }) }, history: [], maxTurns: 3 });
  assert.equal(added.filter((m) => m.role === "customer").length, 3);
});

test("anthropicCustomer: maps roles, never sees the expected answer, ends on [END]", async () => {
  const calls = [];
  const replies = ["Where is my order?", END];
  const client = { messages: { create: async (req) => { calls.push(req); return { content: [{ type: "text", text: replies.shift() }], usage: { input_tokens: 1, output_tokens: 1 } }; } } };
  const scenario = { setup: "Waiting for a parcel.", expected: { answer: "SECRET ANSWER" } };
  const c = anthropicCustomer({ client, model: "m", scenario, turns: ["Where is ORD-1?"] });
  const first = await c.next([]);
  assert.equal(first.text, "Where is my order?");
  const second = await c.next([{ role: "customer", text: first.text }, { role: "assistant", text: "It is on its way." }]);
  assert.equal(second.done, true);
  assert.equal(calls[1].messages[0].role, "assistant");   // the customer's own line
  assert.equal(calls[1].messages[1].role, "user");        // the shop assistant's reply
  assert.ok(!calls[0].system.includes("SECRET ANSWER"));
});

test("steps: plain scenarios are one step, days scenarios keep theirs, checks are tagged by step", () => {
  const plain = { turns: ["a"], expected_actions: [{ tool: "x" }], state_checks: [{ collection: "orders", id: "O", field: "status", equals: "a" }] };
  assert.equal(stepsOf(plain).length, 1);
  assert.equal(flatten(plain).state_checks.length, 1);
  const days = { days: [{ turns: ["a"], state_checks: [{ collection: "orders", id: "O", field: "s", equals: 1 }] }, { advance_days: 3, turns: ["b"], state_checks: [{ collection: "orders", id: "O", field: "s", equals: 2 }] }] };
  assert.deepEqual(flatten(days).state_checks.map((c) => c.step), [0, 1]);
  assert.equal(flatten(days).turns.length, 2);
});

test("facts check: amounts and dates must appear in the data", () => {
  assert.deepEqual(checkFacts(["£61.05", "11 December"], "refund 61.05 by 2026-12-11"), []);
  assert.equal(checkFacts(["£99"], "price 129").length, 1);
  assert.equal(checkFacts(["5 March"], "2026-12-11").length, 1);
});

test("checker rejects a scenario that points at nothing", () => {
  const data = loadData("business/data", { world: "demo", bench: true });
  const bad = { id: "t-1", category: "x", title: "t", difficulty: 1, setup: "s", turns: ["hi"], customer_id: "C-9999", records: ["ORD-99999"], expected: { must_say: [] }, expected_actions: [{ tool: "no_such_tool" }], escalation: { required: false } };
  const p = validateScenario(bad, data, "demo");
  assert.ok(p.some((x) => x.includes("C-9999")) && p.some((x) => x.includes("ORD-99999")) && p.some((x) => x.includes("no_such_tool")));
});

test("every scenario file matches the business (both sizes)", () => {
  for (const size of ["demo", "standard"]) {
    const data = loadData("business/data", { world: size, bench: true });
    const seen = new Set();
    for (const s of loadScenarioFiles()) assert.deepEqual(validateScenario(s, data, size, seen), [], `${size} ${s.id}`);
  }
});

test("callsFromTrace keeps only this agent's calls", () => {
  const trace = [
    { kind: "tool", actor: { role: "assistant", session: "s1" }, tool: "get_order", input: { a: 1 }, ok: true, result: { x: 1 } },
    { kind: "tool", actor: { role: "manager", session: "clock" }, tool: "advance_day", input: {}, ok: true, result: {} },
    { kind: "tool", actor: { role: "assistant", session: "s2" }, tool: "get_order", input: {}, ok: false, error: { code: "not_found" } },
  ];
  const c = callsFromTrace(trace, { role: "assistant", session: "s1" });
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].result, { ok: true, data: { x: 1 } });
});

test("httpAgent sends the protocol fields and returns the reply", async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ reply: "hi" }) }; };
  const a = httpAgent({ url: "http://x", base: { protocol: 1, session_id: "s" }, fetchImpl });
  assert.equal((await a.turn("hello")).reply, "hi");
  assert.deepEqual([sent.protocol, sent.session_id, sent.turn, sent.message], [1, "s", 0, "hello"]);
});

test("options: adapters and sizes", () => {
  assert.equal(parseArgs([]).agent, "anthropic");
  assert.equal(parseArgs(["--cmd", "x"]).agent, "cmd");
  assert.equal(parseArgs(["--http-url", "http://x"]).agent, "http");
  assert.throws(() => parseArgs(["--cmd", "x", "--http-url", "y"]));
  assert.throws(() => parseArgs(["--size", "huge"]));
});

test("end to end: the example agent over --cmd is scored from the sandbox trace", () => {
  const out = execFileSync("node", ["examples/benchmark/run.mjs", "--file", "examples/benchmark/fixtures/smoke.json", "--cmd", "node examples/benchmark/examples/scripted-agent.mjs", "--no-judge", "--label", "test-cmd"], { encoding: "utf8" });
  assert.match(out, /Agent cmd/);
  const path = out.match(/Saved (\S+)/)[1];
  const res = JSON.parse(readFileSync(path, "utf8"));
  const first = res.results.find((x) => x.id === "smoke-01");
  assert.ok(first.calls.some((c) => c.tool === "search_catalogue" && c.ok), "the tool call came from the sandbox trace");
  assert.equal(first.pass, true);
});
