// Scenario checker: `pnpm scenarios:check`. Fails when a scenario no longer matches the business.
//
// For each world size (demo and standard) and each scenario it checks:
//  1. Shape: required fields, unique ids, 1-4 turns (or `days` steps), a known category.
//  2. References: customer, records, SKUs, product ids, collections and roles all exist in the data.
//  3. Tools: every named tool exists, and the scenario's role is allowed to use the ones it expects.
//  4. The ideal run: the checker plays the "ideal" calls (or, without that field, the expected actions) on a fresh
//     world as the scenario's role. Every expected action must succeed, no forbidden tool may be used,
//     state checks and `unchanged` must hold, and escalation must match.
//  5. Facts: every money amount and date in expected.must_say must appear in the data the ideal run saw.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createWorld } from "../../infrastructure/engine/all.js";
import { loadData } from "../../infrastructure/engine/load.js";
import { checkState, includesSubset, deepEqual, findRecord, recordKey } from "./score.mjs";
import { stepsOf, flatten } from "./steps.mjs";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const REQUIRED = ["id", "category", "title", "difficulty", "setup", "expected", "escalation"];

export function loadScenarioFiles(dir = "examples/benchmark/scenarios") {
  return readdirSync(dir).filter((f) => /^\d.*\.json$/.test(f)).sort().flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")).map((s) => ({ ...s, _file: f })));
}

/** Everything a correct fact could be found in: the data files plus whatever the ideal run read. */
function corpusOf(data, resultsText) {
  return JSON.stringify([data.business, data.products, data.services]) + data.policies.map((p) => p.body).join("\n") + resultsText;
}

/** "£61.05" or "£24" present in the corpus? */
const hasAmount = (corpus, n) => new RegExp(`(?<![\\d.])${String(n).replace(".", "\\.")}(\\.0+)?(?![\\d])`).test(corpus);

/** "11 December" present, as words or as 2026-12-11? */
function hasDate(corpus, day, month) {
  const iso = `-${String(MONTHS.indexOf(month) + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return corpus.includes(iso) || new RegExp(`\\b${day}(st|nd|rd|th)? ${month}`, "i").test(corpus);
}

/** Facts in must_say that are money or dates: the only ones code can verify. */
export function checkFacts(mustSay, corpus) {
  const problems = [];
  for (const fact of mustSay || []) {
    for (const m of fact.matchAll(/£(\d[\d,]*(?:\.\d\d)?)/g)) {
      const n = m[1].replace(/,/g, "");
      if (!hasAmount(corpus, n)) problems.push(`must_say amount £${n} appears nowhere in the data or the ideal run`);
    }
    for (const m of fact.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)? (January|February|March|April|May|June|July|August|September|October|November|December)\b/gi)) {
      if (!hasDate(corpus, Number(m[1]), m[2].toLowerCase())) problems.push(`must_say date ${m[0]} appears nowhere in the data or the ideal run`);
    }
  }
  return problems;
}


// Tools that need a verified customer (same list the scorer uses).
import { RECORD_TOOLS } from "./score.mjs";

/**
 * The ideal calls for a step when the scenario gives no `ideal` list: its expected actions, with the plumbing
 * a real assistant would add filled in (verify the customer first; give escalate a reason and a summary).
 * This keeps `expected_actions` short. Write `ideal: [[tool, input], ...]` when a scenario needs exact calls.
 */
export function autoplan(step, sc, world, first) {
  const st = world.state;
  const cust = st.customers.find((c) => c.id === sc.customer_id);
  const owned = cust ? [...st.orders, ...st.returns, ...st.repairs, ...st.bookings].filter((r) => r.customer_id === cust.id).map(recordKey) : [];
  const ref = (sc.records || []).find((r) => owned.includes(r)) || owned[0];
  const plan = step.expected_actions.map((a) => ({ tool: a.tool, input: { ...(a.input_includes || {}) } }));
  for (const c of plan) {
    if (c.tool === "verify_customer" && cust) { c.input.reference ??= ref; c.input.email_or_postcode ??= cust.email; }
    if (c.tool === "escalate") {
      c.input.to ??= sc.escalation?.to || "support_agent";
      c.input.reason ??= "The customer needs a person";
      c.input.summary ??= `${sc.title}. Passed on by the assistant.`;
    }
  }
  const needsVerify = cust && plan.some((c) => RECORD_TOOLS.has(c.tool) || c.tool === "escalate");
  if (first && needsVerify && !plan.some((c) => c.tool === "verify_customer")) plan.unshift({ tool: "verify_customer", input: { reference: ref, email_or_postcode: cust.email } });
  // verify_customer must come before any record tool, wherever the scenario listed it
  plan.sort((a, b) => (b.tool === "verify_customer") - (a.tool === "verify_customer"));
  return plan;
}

/** Validate one scenario against one loaded data set. Returns a list of problem strings (empty = fine). */
export function validateScenario(sc, data, size, seenIds = new Set()) {
  const problems = [];
  const bad = (m) => problems.push(m);
  const mk = () => { const w = createWorld({ ...data, now: data.business.sim.anchor_now }); return w; };

  // 1. shape
  for (const k of REQUIRED) if (sc[k] === undefined) bad(`missing field "${k}"`);
  if (seenIds.has(sc.id)) bad("duplicate id");
  seenIds.add(sc.id);
  const steps = stepsOf(sc);
  const isDays = Array.isArray(sc.days);
  if (isDays ? steps.length < 2 : false) bad("a days scenario needs at least 2 steps");
  const turnCount = steps.reduce((n, s) => n + s.turns.length, 0);
  if (turnCount < 1 || (!isDays && turnCount > 4)) bad(`${turnCount} customer turns (need 1 to 4; days scenarios 1 or more in total)`);
  if (isDays && !steps.some((s) => s.advance_days > 0)) bad("a days scenario must advance the clock in at least one step");

  const world = mk();
  const st = world.state;
  const role = sc.role || "assistant";
  const toolByName = new Map(world.tools.map((t) => [t.name, t]));
  if (!data.business.roles[role]) bad(`role "${role}" is not in business.json`);

  // 2. references
  const exists = (id) => findRecord(st, id) || st.orders.some((o) => o.shipments?.some((s) => s.id === id));
  if (sc.customer_id && !st.customers.some((c) => c.id === sc.customer_id)) bad(`customer ${sc.customer_id} does not exist`);
  const skus = new Set(data.products.flatMap((p) => [p.id, ...p.variants.map((v) => v.sku), ...(p.accessories || []).map((a) => a.sku).filter(Boolean)]));
  const serviceIds = new Set(data.services.map((s) => s.id));
  for (const r of sc.records || []) if (!exists(r) && !skus.has(r) && !serviceIds.has(r) && !data.policies.some((p) => p.id === r)) bad(`record ${r} does not exist`);
  const whole = JSON.stringify(sc);
  for (const sku of new Set(whole.match(/\bOT-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g) || [])) if (!skus.has(sku)) bad(`SKU ${sku} is not in the catalogue`);
  for (const id of new Set(whole.match(/\b(?:ORD|RET|FIX|CASE|BKG|REG|SHP|PO|CONV|DOC|SC)-\d+(?:-\d+)?\b/g) || [])) if (!exists(id)) bad(`${id} does not exist in the ${size} world`);
  const flat = flatten(sc);
  for (const c of flat.state_checks) {
    if (!Array.isArray(st[c.collection])) bad(`state check names unknown collection "${c.collection}"`);
    else if (c.id !== undefined && !st[c.collection].some((r) => recordKey(r) === c.id) && !c.created) bad(`state check: ${c.collection} ${c.id} does not exist at the start`);
  }
  for (const col of sc.unchanged || []) if (!Array.isArray(st[col])) bad(`"unchanged" names unknown collection "${col}"`);
  if (sc.escalation?.required && !data.business.roles[sc.escalation.to]) bad(`escalation.to "${sc.escalation.to}" is not a role`);

  // 3. tools
  const named = [...flat.expected_actions.map((a) => a.tool), ...flat.forbidden_actions, ...steps.flatMap((s) => (s.ideal || []).map((c) => c[0]))];
  for (const t of new Set(named)) if (!toolByName.has(t)) bad(`tool "${t}" does not exist`);
  for (const a of flat.expected_actions) {
    const t = toolByName.get(a.tool);
    if (t && !t.roles.includes(role)) bad(`expected tool ${a.tool} is not allowed for role ${role}`);
  }
  if (problems.length) return problems;   // no point replaying a scenario that points at nothing

  // 4. the ideal run
  const initial = structuredClone(world.state);
  const manager = world.session({ role: "manager" });
  const session = world.session({ role });
  const calls = [];
  const snapshots = [];
  let resultsText = "";
  const go = (tool, input) => {
    const r = session.call(tool, input);
    calls.push({ tool, input, ok: r.ok, error_code: r.error?.code ?? null, result: r });
    resultsText += JSON.stringify(r);
    return r;
  };
  for (const [i, step] of steps.entries()) {
    for (let d = 0; d < step.advance_days; d++) manager.call("advance_day", {});
    const plan = step.ideal ? step.ideal.map(([tool, input]) => ({ tool, input })) : autoplan(step, sc, world, i === 0);
    for (const c of plan) {
      const r = go(c.tool, c.input);
      if (!r.ok && !step.ideal) bad(`step ${i + 1}: expected action ${c.tool} ${JSON.stringify(c.input)} fails: ${r.error.code}: ${r.error.message.slice(0, 140)}`);
      if (!r.ok && step.ideal && !c.input?._may_fail) bad(`step ${i + 1}: ideal call ${c.tool} ${JSON.stringify(c.input)} fails: ${r.error.code}: ${r.error.message.slice(0, 140)}`);
    }
    snapshots.push(structuredClone(world.state));
  }
  for (const a of flat.expected_actions) if (!calls.some((c) => c.tool === a.tool && c.ok && includesSubset(c.input, a.input_includes || {}))) bad(`expected action never satisfied by the ideal run: ${a.tool} ${JSON.stringify(a.input_includes || {})}`);
  for (const f of flat.forbidden_actions) if (calls.some((c) => c.tool === f && c.ok)) bad(`the ideal run uses forbidden tool ${f}`);
  for (const c of flat.state_checks) { const why = checkState(c, snapshots[c.step] || world.state); if (why) bad(`ideal run fails ${why}`); }
  for (const col of sc.unchanged || []) if (!deepEqual(initial[col], world.state[col])) bad(`the ideal run changes "${col}", which the scenario says must not change`);
  const escalated = calls.filter((c) => c.tool === "escalate" && c.ok);
  const req = sc.escalation?.required || false;
  if (req !== (escalated.length > 0)) bad(`escalation.required is ${req} but the ideal run ${escalated.length ? "escalates" : "does not escalate"}`);
  if (req && sc.escalation.to && !escalated.some((c) => c.input.to === sc.escalation.to)) bad(`ideal run does not escalate to ${sc.escalation.to}`);

  // 5. facts
  const extra = JSON.stringify((sc.records || []).map((r) => findRecord(st, r)).filter(Boolean)) + JSON.stringify(st.customers.filter((c) => c.id === sc.customer_id));
  for (const p of checkFacts(sc.expected?.must_say, corpusOf(data, resultsText + extra))) bad(p);
  for (const s of steps) for (const p of checkFacts(s.expected?.must_say, corpusOf(data, resultsText + extra))) bad(p);
  return problems;
}

export function checkAll({ sizes = ["demo", "standard"], scenarios = loadScenarioFiles(), quiet = false } = {}) {
  let failures = 0;
  for (const size of sizes) {
    const data = loadData("business/data", { world: size, bench: true });
    const seen = new Set();
    for (const sc of scenarios) {
      let problems;
      try { problems = validateScenario(sc, data, size, seen); } catch (e) { problems = [`checker crashed: ${e.message}`]; }
      for (const p of problems) { failures++; if (!quiet) console.log(`[${size}] ${sc.id}: ${p}`); }
    }
    if (!quiet) console.log(`${size}: ${scenarios.length} scenarios checked`);
  }
  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  let all = loadScenarioFiles();
  if (only.length) all = all.filter((s) => only.some((o) => s.id.includes(o) || s._file.includes(o)));
  const n = checkAll({ scenarios: all });
  console.log(n ? `\n${n} problem(s). Fix the scenarios (not the data) until this passes.` : "\nAll scenarios match the business.");
  process.exit(n ? 1 : 0);
}
