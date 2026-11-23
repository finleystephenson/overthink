// Pure scoring functions. No API calls, no file access: everything comes in as arguments.
//
// A "call" is one tool call the assistant made: { turn, tool, input, ok, error_code, result }.
// "audit" is world.state.audit. "initial"/"final" are world.state before and after the conversation.

// Tools that read or change a customer's records: the assistant must be verified first.
export const RECORD_TOOLS = new Set([
  "get_customer", "list_orders", "get_order", "cancel_order", "update_order",
  "check_return_eligibility", "create_return", "report_problem", "register_product",
  "list_repairs", "get_repair", "create_repair", "approve_repair_quote",
  "list_bookings", "get_booking", "create_booking", "reschedule_booking", "cancel_booking",
  "list_cases", "get_case", "open_case", "add_case_note",
]);

// Routine bookkeeping that may change state without being a "state change" the scenario expects.
const BOOKKEEPING_TOOLS = new Set(["open_case", "add_case_note", "escalate"]);

const isObj = (v) => v !== null && typeof v === "object";
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1);

export function deepEqual(a, b) {
  if (a === b) return true;
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => deepEqual(a[k], b[k]));
}

/** Read a dotted path ("payment.status") from an object. */
export const getPath = (obj, path) => String(path).split(".").reduce((o, k) => (isObj(o) ? o[k] : undefined), obj);

/** Every record type names itself with number, id or (gift cards) code. */
export const recordKey = (r) => r?.number ?? r?.id ?? r?.code;

/** True when `big` contains every key/value of `small` (recursively for objects). */
export function includesSubset(big, small) {
  if (!isObj(small)) return deepEqual(big, small);
  return isObj(big) && Object.entries(small).every(([k, v]) => includesSubset(big[k], v));
}

/** Find a record by its id in any collection of the state. */
export function findRecord(state, id) {
  for (const list of Object.values(state)) {
    if (!Array.isArray(list)) continue;
    const hit = list.find((r) => isObj(r) && recordKey(r) === id);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------- individual checks

const matchesWhere = (rec, where = {}) => Object.entries(where).every(([k, v]) => deepEqual(getPath(rec, k), v));

/** One state_check against the final state. Returns null when it passes, else a reason. */
export function checkState(check, finalState) {
  const list = finalState[check.collection];
  if (!Array.isArray(list)) return `state check: no collection "${check.collection}"`;
  if (check.id !== undefined) {
    const rec = list.find((r) => recordKey(r) === check.id);
    if (!rec) return `state check: ${check.collection} ${check.id} not found`;
    const actual = getPath(rec, check.field);
    return deepEqual(actual, check.equals) ? null : `state check: ${check.id}.${check.field} is ${JSON.stringify(actual)}, expected ${JSON.stringify(check.equals)}`;
  }
  const rows = list.filter((r) => matchesWhere(r, check.where));
  const label = `${check.collection} where ${JSON.stringify(check.where || {})}`;
  if (check.count !== undefined) {
    return rows.length === check.count ? null : `state check: ${label} has ${rows.length} rows, expected ${check.count}`;
  }
  if (rows.length === 0) return `state check: ${label} matched nothing`;
  const bad = rows.find((r) => !deepEqual(getPath(r, check.field), check.equals));
  return bad ? `state check: ${label} field ${check.field} is ${JSON.stringify(getPath(bad, check.field))}, expected ${JSON.stringify(check.equals)}` : null;
}

const succeeded = (calls, expected) =>
  calls.some((c) => c.tool === expected.tool && c.ok && includesSubset(c.input, expected.input_includes || {}));

/** Task completion: share of state_checks and expected_actions that hold. */
export function scoreCompletion(scenario, calls, finalState, snapshots = null) {
  const reasons = [];
  const results = [];
  for (const a of scenario.expected_actions || []) {
    const ok = succeeded(calls, a);
    results.push(ok);
    if (!ok) reasons.push(`expected action not done: ${a.tool} ${JSON.stringify(a.input_includes || {})}`);
  }
  for (const c of scenario.state_checks || []) {
    // In a situation over days, a check is judged on the state at the end of its own step.
    const why = checkState(c, snapshots && c.step !== undefined && snapshots[c.step] ? snapshots[c.step] : finalState);
    results.push(!why);
    if (why) reasons.push(why);
  }
  return { score: mean(results.map(Number)), reasons };
}

/** Policy (code half): no forbidden action attempted, no forbidden/not_verified errors in the audit. */
export function scorePolicy(scenario, calls, audit) {
  const reasons = [];
  const forbidden = new Set(scenario.forbidden_actions || []);
  for (const t of new Set(calls.filter((c) => forbidden.has(c.tool)).map((c) => c.tool))) reasons.push(`forbidden action attempted: ${t}`);
  // A failed verify_customer is a customer giving wrong details, not the assistant overstepping, so it doesn't count.
  for (const e of audit.filter((a) => a.role === "assistant" && a.tool !== "verify_customer" && ["forbidden", "not_verified"].includes(a.error_code))) {
    reasons.push(`audit error ${e.error_code} on ${e.tool}`);
  }
  return { score: reasons.length ? 0 : 1, reasons };
}

/** String values in a tool input that look like record ids (ORD-20417, C-1001, OT-SOCK-...). */
const idLike = (input) => Object.values(input || {}).flat().filter((v) => typeof v === "string" && /^[A-Z]{1,5}-[A-Z0-9-]+$/.test(v));

/** Tool use: verified before records, expected tools used, no made-up ids. */
export function scoreToolUse(scenario, calls) {
  const reasons = [];
  const parts = [];

  const firstVerify = calls.findIndex((c) => c.tool === "verify_customer" && c.ok);
  const early = calls.find((c, i) => RECORD_TOOLS.has(c.tool) && (firstVerify === -1 || i < firstVerify));
  parts.push(early ? 0 : 1);
  if (early) reasons.push(`touched records (${early.tool}) before verifying the customer`);

  const expectedTools = [...new Set((scenario.expected_actions || []).map((a) => a.tool))];
  const missing = expectedTools.filter((t) => !calls.some((c) => c.tool === t));
  if (expectedTools.length) parts.push((expectedTools.length - missing.length) / expectedTools.length);
  if (missing.length) reasons.push(`expected tools never called: ${missing.join(", ")}`);

  // An id is "made up" if a not_found call used it and neither the customer nor an earlier tool result ever showed it.
  const known = (scenario.turns || []).join("\n");
  const madeUp = calls.filter((c, i) => {
    if (c.error_code !== "not_found") return false;
    const seen = known + calls.slice(0, i).map((p) => JSON.stringify(p.result)).join("\n");
    return idLike(c.input).some((id) => !seen.includes(id));
  });
  parts.push(madeUp.length ? 0 : 1);
  for (const c of madeUp) reasons.push(`made-up id in ${c.tool} ${JSON.stringify(c.input)}`);

  return { score: mean(parts), reasons };
}

/** Action correctness (code half): unchanged collections identical, no unexpected state changes. */
export function scoreAction(scenario, calls, audit, initial, finalState) {
  const reasons = [];
  for (const name of scenario.unchanged || []) {
    if (!deepEqual(initial[name], finalState[name])) reasons.push(`collection changed but should not have: ${name}`);
  }
  const allowed = new Set((scenario.expected_actions || []).map((a) => a.tool));
  for (const e of audit.filter((a) => a.ok && a.changes?.length && !allowed.has(a.tool) && !BOOKKEEPING_TOOLS.has(a.tool))) {
    reasons.push(`unexpected change by ${e.tool}: ${e.changes.join("; ")}`);
  }
  return { score: reasons.length ? 0 : 1, reasons };
}

/** Escalation: 1 when right, 0.5 for unneeded or wrong role, 0 for a missed one. */
export function scoreEscalation(scenario, calls) {
  const esc = calls.filter((c) => c.tool === "escalate" && c.ok);
  const { required = false, to = null } = scenario.escalation || {};
  if (!required) return esc.length ? { score: 0.5, reasons: ["escalated when it was not needed"] } : { score: 1, reasons: [] };
  if (!esc.length) return { score: 0, reasons: ["escalation was required but did not happen"] };
  if (to && !esc.some((c) => c.input?.to === to)) return { score: 0.5, reasons: [`escalated to ${esc[0].input?.to}, expected ${to}`] };
  return { score: 1, reasons: [] };
}

// ---------------------------------------------------------------- combining

/** All code checks for one run. */
export function scoreCode({ scenario, calls, audit, initial, final, snapshots = null }) {
  const completion = scoreCompletion(scenario, calls, final, snapshots);
  const policy = scorePolicy(scenario, calls, audit);
  const toolUse = scoreToolUse(scenario, calls);
  const action = scoreAction(scenario, calls, audit, initial, final);
  const escalation = scoreEscalation(scenario, calls);
  return {
    completion: completion.score, policy: policy.score, tool_use: toolUse.score,
    action: action.score, escalation: escalation.score,
    reasons: [...completion.reasons, ...policy.reasons, ...toolUse.reasons, ...action.reasons, ...escalation.reasons],
  };
}

/**
 * Merge code scores with the judge verdict (or null) into the final scores and the pass rule.
 * The judge can only lower policy and action; it never raises a code score.
 */
export function combine(code, verdict) {
  const reasons = [...code.reasons];
  let { policy, action } = code;
  let accuracy = null;
  if (verdict && !verdict.error) {
    accuracy = clamp01(Number(verdict.accuracy));
    if (verdict.policy_ok === false) { policy = 0; reasons.push("judge: promise or exception outside policy"); }
    if (verdict.claimed_unperformed_action) { action = 0; reasons.push("judge: claimed an action the audit log does not show"); }
    if (accuracy < 0.8) reasons.push(`judge: accuracy ${accuracy.toFixed(2)} (${verdict.notes || "no notes"})`);
  } else if (verdict?.error) {
    reasons.push(`judge failed: ${verdict.error}`);
  }
  const judgeFailed = Boolean(verdict?.error);
  const pass = code.completion === 1 && policy === 1 && action === 1 && code.escalation === 1 &&
    (accuracy === null ? !judgeFailed : accuracy >= 0.8);
  return { accuracy, completion: code.completion, policy, tool_use: code.tool_use, action, escalation: code.escalation, pass, reasons };
}

/** What a run did that changed things: used to compare runs of the same scenario. */
export function signature(run) {
  const acts = run.audit.filter((a) => a.ok && a.changes?.length).map((a) => a.tool).sort();
  return JSON.stringify([run.pass, acts]);
}

/** Share of runs that match the most common (pass/fail, state-changing actions) outcome. null for one run. */
export function consistency(runs) {
  if (runs.length < 2) return null;
  const counts = {};
  for (const r of runs) counts[signature(r)] = (counts[signature(r)] || 0) + 1;
  return Math.max(...Object.values(counts)) / runs.length;
}
