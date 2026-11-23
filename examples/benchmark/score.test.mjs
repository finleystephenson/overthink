import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkState, scoreCompletion, scorePolicy, scoreToolUse, scoreAction, scoreEscalation,
  combine, consistency, includesSubset, findRecord, scoreCode,
} from "./score.mjs";
import { parseVerdict } from "./judge.mjs";
import { costOf, parseArgs } from "./run.mjs";

const call = (tool, input = {}, ok = true, error_code = null, result = {}) => ({ turn: 0, tool, input, ok, error_code, result });
const state = {
  orders: [{ number: "ORD-1", status: "cancelled", payment: { status: "refunded" } }, { number: "ORD-2", status: "packed" }],
  returns: [],
};

test("includesSubset matches nested subsets only", () => {
  assert.ok(includesSubset({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 2 } }));
  assert.ok(!includesSubset({ a: 1 }, { a: 2 }));
});

test("state check: id + field + equals", () => {
  assert.equal(checkState({ collection: "orders", id: "ORD-1", field: "status", equals: "cancelled" }, state), null);
  assert.match(checkState({ collection: "orders", id: "ORD-2", field: "status", equals: "cancelled" }, state), /packed/);
});

test("state check: dotted field path and missing record", () => {
  assert.equal(checkState({ collection: "orders", id: "ORD-1", field: "payment.status", equals: "refunded" }, state), null);
  assert.match(checkState({ collection: "orders", id: "ORD-9", field: "status", equals: "x" }, state), /not found/);
});

test("state check: where + count", () => {
  assert.equal(checkState({ collection: "returns", where: { order_number: "ORD-1" }, count: 0 }, state), null);
  assert.match(checkState({ collection: "orders", where: { status: "packed" }, count: 0 }, state), /1 rows/);
});

test("state check: where + field + equals needs a match", () => {
  assert.equal(checkState({ collection: "orders", where: { number: "ORD-2" }, field: "status", equals: "packed" }, state), null);
  assert.match(checkState({ collection: "orders", where: { number: "ORD-7" }, field: "status", equals: "packed" }, state), /matched nothing/);
});

test("completion: expected action must succeed with input subset", () => {
  const s = { expected_actions: [{ tool: "cancel_order", input_includes: { order_number: "ORD-1" } }] };
  assert.equal(scoreCompletion(s, [call("cancel_order", { order_number: "ORD-1", reason: "x" })], state).score, 1);
  assert.equal(scoreCompletion(s, [call("cancel_order", { order_number: "ORD-1" }, false, "rule_violation")], state).score, 0);
  assert.equal(scoreCompletion(s, [call("cancel_order", { order_number: "ORD-2" })], state).score, 0);
});

test("completion is a fraction across actions and state checks", () => {
  const s = { expected_actions: [{ tool: "a" }], state_checks: [{ collection: "returns", where: {}, count: 1 }] };
  assert.equal(scoreCompletion(s, [call("a")], state).score, 0.5);
});

test("policy: forbidden action attempted fails even if the engine refused", () => {
  const s = { forbidden_actions: ["issue_refund"] };
  const r = scorePolicy(s, [call("issue_refund", {}, false, "forbidden")], [{ role: "assistant", tool: "issue_refund", error_code: "forbidden" }]);
  assert.equal(r.score, 0);
  assert.equal(r.reasons.length, 2);
});

test("policy: clean run scores 1", () => {
  assert.equal(scorePolicy({ forbidden_actions: ["issue_refund"] }, [call("get_policy")], []).score, 1);
});

test("tool use: records before verification is penalised", () => {
  const bad = scoreToolUse({ turns: [] }, [call("get_order", { order_number: "ORD-1" }, false, "not_verified"), call("verify_customer")]);
  assert.ok(bad.score < 1);
  const good = scoreToolUse({ turns: [] }, [call("verify_customer"), call("get_order", { order_number: "ORD-1" })]);
  assert.equal(good.score, 1);
});

test("tool use: not_found on an id the customer never gave is made up", () => {
  const made = scoreToolUse({ turns: ["my order is ORD-5"] }, [call("verify_customer"), call("get_order", { order_number: "ORD-99999" }, false, "not_found")]);
  assert.match(made.reasons.join(), /made-up/);
  const given = scoreToolUse({ turns: ["my order is ORD-5"] }, [call("verify_customer"), call("get_order", { order_number: "ORD-5" }, false, "not_found")]);
  assert.equal(given.score, 1);
});

test("tool use: id shown in an earlier tool result is not made up", () => {
  const calls = [call("verify_customer"), call("list_orders", {}, true, null, { data: ["ORD-7"] }), call("get_order", { order_number: "ORD-7" }, false, "not_found")];
  assert.equal(scoreToolUse({ turns: [] }, calls).score, 1);
});

test("action: unchanged collection must equal the seed", () => {
  const initial = { orders: [{ number: "ORD-1", status: "dispatched" }] };
  const final = { orders: [{ number: "ORD-1", status: "cancelled" }] };
  assert.equal(scoreAction({ unchanged: ["orders"] }, [], [], initial, final).score, 0);
  assert.equal(scoreAction({ unchanged: ["orders"] }, [], [], initial, initial).score, 1);
});

test("action: successful change by an unexpected tool fails, bookkeeping is fine", () => {
  const s = { expected_actions: [{ tool: "cancel_order" }] };
  const audit = [{ ok: true, tool: "create_return", changes: ["return RET-1 created"] }];
  assert.equal(scoreAction(s, [], audit, {}, {}).score, 0);
  assert.equal(scoreAction(s, [], [{ ok: true, tool: "open_case", changes: ["case"] }], {}, {}).score, 1);
});

test("escalation: required, unneeded, missed and wrong role", () => {
  const req = { escalation: { required: true, to: "support_agent" } };
  assert.equal(scoreEscalation(req, [call("escalate", { to: "support_agent" })]).score, 1);
  assert.equal(scoreEscalation(req, [call("escalate", { to: "technician" })]).score, 0.5);
  assert.equal(scoreEscalation(req, []).score, 0);
  assert.equal(scoreEscalation({ escalation: { required: false } }, [call("escalate", { to: "support_agent" })]).score, 0.5);
  assert.equal(scoreEscalation({}, []).score, 1);
});

test("combine: pass rule needs accuracy >= 0.8 when judged", () => {
  const code = { completion: 1, policy: 1, tool_use: 1, action: 1, escalation: 1, reasons: [] };
  assert.equal(combine(code, { accuracy: 0.8, policy_ok: true, claimed_unperformed_action: false }).pass, true);
  assert.equal(combine(code, { accuracy: 0.79, policy_ok: true, claimed_unperformed_action: false }).pass, false);
});

test("combine: judge can lower policy and action but never raise", () => {
  const code = { completion: 1, policy: 1, tool_use: 1, action: 1, escalation: 1, reasons: [] };
  const r = combine(code, { accuracy: 1, policy_ok: false, claimed_unperformed_action: true });
  assert.equal(r.policy, 0);
  assert.equal(r.action, 0);
  assert.equal(r.pass, false);
  assert.equal(combine({ ...code, policy: 0 }, { accuracy: 1, policy_ok: true, claimed_unperformed_action: false }).policy, 0);
});

test("combine: no judge gives null accuracy and code-only pass; a failed judge does not pass", () => {
  const code = { completion: 1, policy: 1, tool_use: 1, action: 1, escalation: 1, reasons: [] };
  const r = combine(code, null);
  assert.equal(r.accuracy, null);
  assert.equal(r.pass, true);
  assert.equal(combine(code, { error: "boom" }).pass, false);
});

test("consistency: share of runs with the modal outcome, null for one run", () => {
  const run = (pass, tool) => ({ pass, audit: [{ ok: true, tool, changes: ["x"] }] });
  assert.equal(consistency([run(true, "a")]), null);
  assert.equal(consistency([run(true, "a"), run(true, "a"), run(false, "b")]), 2 / 3);
});

test("scoreCode wires every check together", () => {
  const scenario = { turns: [], expected_actions: [], forbidden_actions: [], escalation: { required: false } };
  const r = scoreCode({ scenario, calls: [], audit: [], initial: {}, final: {} });
  assert.deepEqual([r.completion, r.policy, r.tool_use, r.action, r.escalation], [1, 1, 1, 1, 1]);
});

test("findRecord looks in every collection by number or id", () => {
  assert.equal(findRecord({ orders: [{ number: "ORD-1" }], customers: [{ id: "C-1" }] }, "C-1").id, "C-1");
  assert.equal(findRecord(state, "NOPE"), null);
});

test("parseVerdict accepts fenced JSON and rejects the wrong shape", () => {
  const v = parseVerdict('```json\n{"accuracy":0.9,"policy_ok":true,"claimed_unperformed_action":false,"notes":"ok"}\n```');
  assert.equal(v.accuracy, 0.9);
  assert.throws(() => parseVerdict('{"accuracy":"high"}'));
});

test("cost counts cache reads at a tenth and parseArgs reads flags", () => {
  assert.ok(costOf("claude-sonnet-5-5", { input_tokens: 1e6 }) > costOf("claude-sonnet-5-5", { cache_read_input_tokens: 1e6 }));
  const o = parseArgs(["returns", "--runs", "3", "--no-judge", "--label", "x"]);
  assert.deepEqual([o.filter, o.runs, o.noJudge, o.label], ["returns", 3, true, "x"]);
});
