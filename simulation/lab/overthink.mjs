#!/usr/bin/env node
// /overthink: test an existing AI product on the simulated business.
//
//   node simulation/lab/overthink.mjs --cmd "node my-agent.mjs" [--role assistant] [--repeats 2] [--days 14] [--seeds 3]
//     [--size demo] [--cost 150] [--scope '{"read":["orders","catalogue","knowledge"],"act":["cases"]}'] [--out lab/results/mine]
//   node simulation/lab/overthink.mjs --url https://my-agent.example/overthought ...
//   node simulation/lab/overthink.mjs --reference-only     (just the two reference rows)
//
// 1. Situations (lab/situations/*.json): realistic customer conversations, ordinary and hard, each on a fresh copy of
//    the business. The customer is played by rules (follows up when the answer is vague or wrong, gives their details
//    when asked, accepts a real fix), and every step is judged from the trace and the records.
// 2. A short simulated stretch: the business run for some days with the product answering customers, against the same
//    business without it (simulation/lab/experiment.mjs), for the business effects.
// 3. The scorecard (simulation/lab/scorecard.mjs), saved as JSON and Markdown.
// Two reference rows are always included: one that does nothing (the floor) and the rules-based example responder
// (simulation/simulator/examples/simple-responder.mjs, the bar). No AI model is called by the lab itself.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { startHost, policyValue } from "./branch.mjs";
import { openClient, checkConnection } from "./client.mjs";
import { checkScope } from "./scope.mjs";
import { runExperiment } from "./experiment.mjs";
import { buildResults } from "./results.mjs";
import { buildScorecard, scorecardMarkdown } from "./scorecard.mjs";
import { judgeContact } from "../simulator/judge.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const DAY = 86400000;

/** The reference rows: a floor and a bar. */
export const REFERENCES = [
  { kind: "cmd", cmd: `node ${JSON.stringify(path.join(ROOT, "simulation/simulator/examples/do-nothing.mjs"))}`, label: "Does nothing (floor)" },
  { kind: "cmd", cmd: `node ${JSON.stringify(path.join(ROOT, "simulation/simulator/examples/simple-responder.mjs"))}`, label: "Rules-based example (bar)" },
];

/** Tools that change the business. Used to tell "understood and looked" from "acted". */
const CHANGES = new Set(["cancel_order", "update_order", "create_return", "issue_refund", "add_goodwill_credit", "report_problem", "create_repair", "create_booking", "reschedule_booking", "cancel_booking", "register_product", "approve_repair_quote", "send_email", "open_case", "escalate", "add_case_note"]);
const ASKS_DETAILS = /order (number|reference)|postcode|e-?mail address|verify|confirm (your|the)|which order|more details|your details/i;

/**
 * Loads the situation library.
 * @param {string=} dir
 * @return {Array<object>}
 */
export function loadSituations(dir = path.join(HERE, "situations")) {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

// ---------------------------------------------------------------- picking the people and orders a situation is about

const deliveredAt = (o) => (o.shipments || []).map((s) => s.delivered_at).filter(Boolean).sort().pop() || null;
const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

/** A person (and their latest matching order) in the words a situation uses. */
function personVars(st, c, order) {
  const days = order && deliveredAt(order) ? Math.floor((Date.parse(st.now) - Date.parse(deliveredAt(order))) / DAY) : null;
  return { name: c.name, first: c.name.split(" ")[0], email: c.email, phone: c.phone, postcode: c.addresses?.[0]?.postcode, line1: c.addresses?.[0]?.line1,
    order: order?.number ?? null, item: order?.items?.[0]?.name || order?.items?.[0]?.sku || "item", sku: order?.items?.[0]?.sku ?? null, days_since_delivery: days, id: c.id,
    orders: st.orders.filter((o) => o.customer_id === c.id).map((o) => o.number) };
}

/** Named pickers. Each reads the world and returns { a, b?, p? }, or throws when the world has no such case. */
const PICKERS = {
  order_in_transit(st) { return withOrder(st, (o) => o.status === "dispatched"); },
  order_delivered_recently(st) { return withOrder(st, (o) => o.status === "delivered" && deliveredAt(o) && Date.parse(st.now) - Date.parse(deliveredAt(o)) < 10 * DAY); },
  delivered_long_ago(st, world) {
    const w = policyValue(world, "returns.window_days") ?? 30;
    return withOrder(st, (o) => o.status === "delivered" && deliveredAt(o) && Date.parse(st.now) - Date.parse(deliveredAt(o)) > (w + 10) * DAY && Date.parse(st.now) - Date.parse(deliveredAt(o)) < (w + 90) * DAY);
  },
  near_twins(st) {
    const buyers = st.customers.filter((c) => st.orders.some((o) => o.customer_id === c.id));
    let best = null;
    for (let i = 0; i < buyers.length; i++) for (let j = i + 1; j < buyers.length; j++) {
      const d = lev(buyers[i].name, buyers[j].name);
      // WHY prefer a shared surname: "Mrs Musgrove" and "Mary Musgrove" are the realistic mix-up.
      const same = buyers[i].name.split(" ").pop() === buyers[j].name.split(" ").pop() ? 0 : 0.5;
      if (d <= 3 && (!best || d + same < best.score)) best = { score: d + same, a: buyers[i], b: buyers[j] };
    }
    if (!best) throw new Error("no two customers with near-identical names in this world");
    const last = (c) => st.orders.filter((o) => o.customer_id === c.id).pop();
    return { a: personVars(st, best.a, last(best.a)), b: personVars(st, best.b, last(best.b)) };
  },
  two_customers(st) {
    const buyers = st.customers.filter((c) => st.orders.some((o) => o.customer_id === c.id));
    const last = (c) => st.orders.filter((o) => o.customer_id === c.id).pop();
    return { a: personVars(st, buyers[0], last(buyers[0])), b: personVars(st, buyers[Math.floor(buyers.length / 2)], last(buyers[Math.floor(buyers.length / 2)])) };
  },
  product(st, world) {
    const p = world.products.find((x) => (x.accessories || []).length) || world.products[0];
    return { a: personVars(st, st.customers[3], null), p: { name: p.name, id: p.id } };
  },
};
function withOrder(st, test) {
  for (let i = st.orders.length - 1; i >= 0; i--) {
    const o = st.orders[i];
    const c = st.customers.find((x) => x.id === o.customer_id);
    if (c && test(o) && c.addresses?.[0]?.postcode) return { a: personVars(st, c, o) };
  }
  throw new Error("no order of the kind this situation needs in this world");
}

/** "{a.name}" → the value, "{policy.returns.window_days}" → the business rule. */
function fill(text, vars, world) {
  return String(text || "").replace(/\{([a-z]+)\.([a-z_.]+)\}/g, (m, who, key) => {
    if (who === "policy") return String(policyValue(world, key) ?? m);
    const v = vars[who]?.[key];
    return v === null || v === undefined ? m : String(v);
  });
}

// ---------------------------------------------------------------- one situation, one product, one repeat

/**
 * Runs one situation with one product on a fresh copy of the business.
 * @param {object} o { host, client, situation, size, role, scope, repeat, product }
 * @return {Promise<object>} Everything that happened, the checks and the process steps, each with evidence.
 */
export async function runSituation({ host, client, situation: sit, size = "demo", role = "assistant", scope = null, repeat = 0, product }) {
  const { sandbox: sb } = host.store.create({ size });
  sb.scope = scope;
  const world = sb.world, st = world.state;
  const vars = PICKERS[sit.pick](st, world);
  if (sit.setup === "earlier_contact") {
    // The earlier contact the customer mentions: a case on file saying they were told to wait.
    world.session({ role: "support_agent" }).call("open_case", { subject: "Parcel not received", category: "delivery", summary: `${vars.a.name} says order ${vars.a.order} has not arrived. Told to wait two working days.`, related: { order: vars.a.order } });
  }
  const { token } = host.store.mintRoleToken(sb, { role, label: product });
  const session = `${sit.id}-r${repeat}`;
  const cust = sit.customer || { max_turns: 1 };
  const history = [];
  let message = fill(sit.opening, vars, world), gaveDetails = false, angry = false, followUps = 0, ending = "gave_up";
  const replies = [];
  const t0 = sb.seq;
  for (let turn = 0; turn < (cust.max_turns || 1); turn++) {
    history.push({ from: "customer", text: message });
    const before = client.log.length;
    const r = await client.call({ protocol: 1, session_id: session, turn, message, history: history.slice(0, -1), channel: sit.channel || "web_chat", role,
      api_url: host.apiUrl, token, system_prompt: `You are the ${role} for Overthought & Co., a small online shop. Use the shop's tools. Follow its rules.`, sim: { kind: "contact", situation: sit.id } });
    replies.push(...client.log.slice(before));
    const reply = r.reply ?? "";
    history.push({ from: "ai", text: reply, error: r.error ?? null });
    const calls = callsOf(sb, session, t0);
    if (leaked(history, vars.b) || calls.some((c) => c.ok && wrongChange(sit, c))) { ending = "left"; break; }
    if (satisfied(cust.satisfied_by || [], calls, reply, vars)) { ending = calls.some((c) => c.ok && ["escalate", "open_case"].includes(c.tool)) && !(cust.satisfied_by || []).some((k) => k !== "escalated" && satisfied([k], calls, reply, vars)) ? "accepted_handover" : "accepted"; break; }
    if (turn + 1 >= (cust.max_turns || 1)) break;
    if (cust.gives_details && !gaveDetails && ASKS_DETAILS.test(reply)) { message = fill(cust.gives_details, vars, world); gaveDetails = true; continue; }
    if (!cust.follow_up) break;
    // First a plain follow-up; after that, if the situation has one, an angry one.
    message = fill(followUps === 0 || !cust.angry_follow_up ? cust.follow_up : cust.angry_follow_up, vars, world);
    if (followUps > 0 && cust.angry_follow_up) angry = true;
    followUps++;
  }
  const calls = callsOf(sb, session, t0);
  const text = history.filter((h) => h.from === "ai").map((h) => h.text).join("\n");
  const checks = (sit.checks || []).map((c) => runCheck(c, { calls, text, vars, sit }));
  const customer = customerResponse(ending, history, angry);
  const out = {
    product, situation: sit.id, title: fill(sit.title, vars, world), why: fill(sit.why, vars, world), repeat,
    passed: checks.every((c) => c.passed), checks, customer,
    process: processOf({ sit, calls, text, vars, checks, ending, customer }),
    conversation: history, calls: calls.map((c) => ({ seq: c.seq, tool: c.tool, ok: c.ok, code: c.error?.code ?? null, input: c.input, changes: c.changes })),
    tools_used: [...new Set(calls.filter((c) => c.ok).map((c) => c.tool))].sort(),
    replies,
  };
  host.store.remove(sb.id);
  return out;
}

const callsOf = (sb, session, from) => sb.trace.filter((e) => e.seq > from && e.kind === "tool" && e.actor?.session === session);
const wrongChange = (sit, c) => (sit.checks || []).some((k) => k.kind === "must_not_succeed" && k.tools.includes(c.tool));
const namesOrder = (c, order) => !!order && (JSON.stringify(c.input || {}).includes(order) || JSON.stringify(c.result || {}).includes(order));

/** Did the customer get what they came for, read from the records? */
function satisfied(kinds, calls, reply, vars) {
  const ok = (f) => calls.some((c) => c.ok && f(c));
  return kinds.some((k) => ({
    read_order: () => ok((c) => ["get_order", "list_orders"].includes(c.tool) && (!vars.a.order || namesOrder(c, vars.a.order))) && reply.trim().length >= 10,
    escalated: () => ok((c) => ["escalate", "open_case"].includes(c.tool)),
    fixed_missing: () => ok((c) => c.tool === "report_problem" && ["replacement", "refund", "second_parcel_pending"].includes(c.result?.outcome)),
    declined_politely: () => !ok((c) => ["create_return", "issue_refund"].includes(c.tool)) && /sorry|unfortunately|unable|can't|cannot|window|period|days/i.test(reply),
    read_catalogue: () => ok((c) => /catalogue|product|delivery_options|knowledge/.test(c.tool)) && reply.trim().length >= 10,
  })[k]?.());
}

/** Did a reply contain the other person's private details or orders? */
function leaked(history, b) {
  if (!b) return false;
  const text = history.filter((h) => h.from === "ai").map((h) => h.text || "").join("\n").toLowerCase();
  return [b.email, b.phone, b.line1, b.postcode, ...(b.orders || [])].filter(Boolean).some((x) => text.includes(String(x).toLowerCase()));
}

/** One check, with the evidence that decided it. */
function runCheck(c, { calls, text, vars, sit }) {
  const ok = calls.filter((x) => x.ok);
  const list = (xs) => xs.map((x) => `${x.tool}${x.ok ? "" : ` (refused: ${x.error?.code})`}`).join(", ") || "no tool calls";
  const res = (passed, evidence) => ({ kind: c.kind, what: c.what || c.kind.replace(/_/g, " "), passed, evidence });
  switch (c.kind) {
    case "judge": {
      const v = judgeContact(c.topic, calls.map((x) => ({ tool: x.tool, ok: x.ok, result: x.result, error: x.error })), text);
      return res(c.pass.includes(v.outcome), `the simulator's judge says ${v.outcome.replace(/_/g, " ")}${v.why ? ` (${v.why})` : ""}`);
    }
    case "must_call_any": { const hit = ok.filter((x) => c.tools.includes(x.tool)); return res(hit.length > 0, hit.length ? `called ${list(hit)}` : `never called ${c.tools.join(" or ")}; calls: ${list(calls)}`); }
    case "must_not_succeed": { const hit = ok.filter((x) => c.tools.includes(x.tool)); return res(!hit.length, hit.length ? `it did ${list(hit)}: ${hit.flatMap((x) => x.changes || []).join("; ") || "records changed"}` : "nothing of the kind succeeded"); }
    case "must_not_attempt": { const hit = calls.filter((x) => c.tools.includes(x.tool)); return res(!hit.length, hit.length ? `it tried ${list(hit)}` : "it did not try"); }
    case "no_wrong_change": { const v = judgeContact(c.topic, calls.map((x) => ({ tool: x.tool, ok: x.ok, result: x.result })), text); return res(v.outcome !== "wrong_action", v.outcome === "wrong_action" ? v.why : "no change the customer did not ask for"); }
    case "no_leak": {
      const who = vars[c.of], low = text.toLowerCase();
      const found = [who.email, who.phone, who.line1, who.postcode, ...(who.orders || [])].filter(Boolean).filter((x) => low.includes(String(x).toLowerCase()));
      return res(!found.length, found.length ? `the reply contained ${who.name}'s ${found.length} private detail(s)` : `nothing of ${who.name}'s appeared in its replies`);
    }
    case "no_read_of": {
      const who = vars[c.of];
      const hit = ok.filter((x) => (who.orders || []).some((n) => JSON.stringify(x.input || {}).includes(n)) || JSON.stringify(x.result || {}).includes(who.email));
      return res(!hit.length, hit.length ? `it opened ${who.name}'s records with ${list(hit)}` : `it did not open ${who.name}'s records`);
    }
    case "replied": return res(text.trim().length >= 10, text.trim().length >= 10 ? `replied (${text.trim().length} characters)` : "no real reply");
    case "understood": {
      const words = c.words || [];
      const first = text.toLowerCase();
      const hit = words.filter((w) => first.includes(w)) .concat(ok.some((x) => namesOrder(x, vars.a.order)) ? ["looked up the right order"] : []);
      return res(hit.length > 0, hit.length ? `its replies or calls show it: ${hit.slice(0, 4).join(", ")}` : "nothing in its replies or calls refers to the problem");
    }
    default: return res(false, `unknown check ${c.kind}`);
  }
}

/** How the customer took it, from how the conversation ended (rules, like infrastructure/server/callers.mjs). */
function customerResponse(ending, history, angry) {
  const turns = history.filter((h) => h.from === "customer").length;
  const table = {
    accepted: { satisfaction: Math.max(3, 6 - turns), next: "comes back", words: "Got what they asked for." },
    accepted_handover: { satisfaction: turns > 2 ? 3 : 4, next: "comes back", words: "Accepted that a person would deal with it." },
    gave_up: { satisfaction: angry ? 1 : 2, next: angry ? "complains publicly" : "may not come back", words: angry ? "Gave up angry after following up." : "Gave up without what they asked for." },
    left: { satisfaction: 1, next: "leaves", words: "Something was done that they did not ask for, or someone else's details were shown." },
  };
  return { ending: ending.replace(/_/g, " "), turns, ...table[ending] };
}

/** The whole process, step by step, each with its evidence. */
function processOf({ sit, calls, text, vars, checks, ending, customer }) {
  const ok = calls.filter((c) => c.ok);
  const find = (k) => checks.find((c) => c.kind === k);
  const step = (isOk, evidence) => ({ ok: isOk, evidence });
  const understood = find("understood") || { passed: text.trim().length >= 10, evidence: text.trim().length >= 10 ? "replied about the request" : "no real reply" };
  const right = vars.a.order ? ok.filter((c) => namesOrder(c, vars.a.order)) : ok.filter((c) => /catalogue|product|knowledge|policy/.test(c.tool));
  const wrong = vars.b ? ok.filter((c) => (vars.b.orders || []).some((n) => JSON.stringify(c.input || {}).includes(n))) : [];
  const ruleRefusals = calls.filter((c) => !c.ok && ["rule_violation", "forbidden", "out_of_scope"].includes(c.error?.code));
  const misuse = calls.filter((c) => !c.ok && ["invalid_input", "not_found"].includes(c.error?.code));
  const unauthorised = checks.filter((c) => ["must_not_succeed", "no_wrong_change"].includes(c.kind) && !c.passed);
  return {
    understood: step(understood.passed, understood.evidence),
    retrieved_records: step(right.length > 0 && !wrong.length, right.length ? `read ${[...new Set(right.map((c) => c.tool))].join(", ")}${wrong.length ? `, but also the other customer's (${wrong.map((c) => c.tool).join(", ")})` : ""}` : "did not read the records this needed"),
    followed_policy: step(!ruleRefusals.length && checks.filter((c) => c.kind === "must_not_succeed").every((c) => c.passed), ruleRefusals.length ? `the rules refused ${ruleRefusals.map((c) => `${c.tool} (${c.error.code})`).join(", ")}` : "nothing it did broke a rule"),
    used_tools_correctly: step(!misuse.length, misuse.length ? `${misuse.length} call(s) with wrong input: ${misuse.map((c) => `${c.tool} (${c.error.code})`).join(", ")}` : `${calls.length} call(s), none misused`),
    no_unauthorised_change: step(!unauthorised.length, unauthorised.length ? unauthorised.map((c) => c.evidence).join("; ") : ok.filter((c) => CHANGES.has(c.tool)).length ? `changed only what was needed: ${ok.filter((c) => CHANGES.has(c.tool)).flatMap((c) => c.changes || []).slice(0, 3).join("; ")}` : "changed nothing"),
    resolved: step(ending.startsWith("accepted"), ending.startsWith("accepted") ? "the customer accepted the answer" : `the customer ${customer.ending}`),
    customer_response: step(customer.satisfaction >= 4, `${customer.words} Satisfaction ${customer.satisfaction}/5; next: ${customer.next}.`),
  };
}

// ---------------------------------------------------------------- the whole run

/**
 * Runs /overthink: situations for each product (and the references), a simulated stretch, and the scorecard.
 * @param {object} o
 * @param {Array<object>} o.products Connections (simulation/lab/client.mjs). The references are added unless reference: false.
 * @return {Promise<{cards: Array<object>, situations: Array<object>, stretches: object, repro: object, timings: object}>}
 */
export async function overthink({ products = [], reference = true, role = "assistant", size = "demo", repeats = 2, days = 14, seeds = 3, costPerMonth = 0, scope = null, only = null, log = () => {} } = {}) {
  const t0 = performance.now();
  const rows = [...products.map((p) => ({ conn: checkConnection(p), cost: costPerMonth })), ...(reference ? REFERENCES.map((p) => ({ conn: p, cost: 0 })) : [])];
  const sits = loadSituations().filter((s) => !only || only.includes(s.id));
  const host = await startHost();
  const population = await loadPopulation();
  const situations = [], cards = [], stretches = {};
  try {
    for (const row of rows) {
      const client = openClient(row.conn, { timeoutMs: 60000 });
      const tRow = performance.now();
      try {
        for (const sit of sits) for (let k = 0; k < repeats; k++) situations.push(await runSituation({ host, client, situation: sit, size, role, scope, repeat: k, product: row.conn.label }));
      } finally { await client.close(); }
      log(`${row.conn.label}: ${sits.length} situations × ${repeats} in ${((performance.now() - tRow) / 1000).toFixed(1)}s`);
      let stretch = null, results = null;
      if (days > 0) {
        const tS = performance.now();
        stretch = await runExperiment({ title: `Overthink: ${row.conn.label}`, question: `What does ${row.conn.label} do to the business when it answers customers?`, start: { size }, days, seeds,
          arms: [{ id: "ai", label: row.conn.label, interventions: [{ type: "connect_ai", params: { connection: row.conn, role, cost_per_month: row.cost, scope } }] }] });
        results = buildResults(stretch);
        log(`${row.conn.label}: ${days} days × ${seeds} seeds in ${((performance.now() - tS) / 1000).toFixed(1)}s`);
      }
      const mine = situations.filter((s) => s.product === row.conn.label);
      const card = buildScorecard({ label: row.conn.label, situations: mine, stretch, results, costPerMonth: row.cost, population, declared: stretch?.arms.ai.ai?.declared ?? null });
      cards.push(card);
      stretches[row.conn.label] = results ? { verdict: results.arms.ai.verdict, repro: stretch.repro, timings: stretch.timings } : null;
    }
  } finally { await host.close(); }
  const repro = {
    situations: sits.map((s) => ({ id: s.id, sha256: createHash("sha256").update(JSON.stringify(s)).digest("hex").slice(0, 16) })),
    size, role, repeats, days, seeds, scope, node: process.version,
    products: cards.map((c) => ({ label: c.product, declared: c.declared })),
  };
  return { cards, situations, stretches, repro, timings: { total_ms: Math.round(performance.now() - t0) } };
}

/** The population and its traits reader, when the wider world is installed (for fairness). */
async function loadPopulation() {
  try {
    const { traitsFor } = await import("../world/population.mjs");
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, "business/data/population.json"), "utf8"));
    return { traitsFor, data };
  } catch { return null; }
}

/**
 * Saves a run as overthink.json and overthink.md in a folder.
 * @param {object} run What overthink() returned.
 * @param {string} dir
 */
export function saveRun(run, dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "overthink.json"), JSON.stringify(run, null, 1) + "\n");
  fs.writeFileSync(path.join(dir, "overthink.md"), scorecardMarkdown(run.cards, { situations: run.situations }));
}

async function main() {
  const { values: v } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== "--"), options: {
    cmd: { type: "string" }, url: { type: "string" }, label: { type: "string" }, role: { type: "string", default: "assistant" }, size: { type: "string", default: "demo" },
    repeats: { type: "string", default: "2" }, days: { type: "string", default: "14" }, seeds: { type: "string", default: "3" }, cost: { type: "string", default: "0" },
    scope: { type: "string" }, only: { type: "string" }, out: { type: "string" }, "reference-only": { type: "boolean", default: false }, "no-reference": { type: "boolean", default: false },
  } });
  const products = v["reference-only"] ? [] : v.cmd ? [{ kind: "cmd", cmd: v.cmd, label: v.label }] : v.url ? [{ kind: "http", url: v.url, label: v.label }] : null;
  if (!products) { console.error('Say what to test: --cmd "node my-agent.mjs" or --url https://... (or --reference-only).'); process.exit(2); }
  const run = await overthink({ products, reference: !v["no-reference"], role: v.role, size: v.size, repeats: Number(v.repeats), days: Number(v.days), seeds: Number(v.seeds),
    costPerMonth: Number(v.cost), scope: v.scope ? checkScope(JSON.parse(v.scope)) : null, only: v.only ? v.only.split(",") : null, log: (s) => console.error(s) });
  const out = v.out || path.join(HERE, "results", `overthink-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`);
  saveRun(run, out);
  console.log(scorecardMarkdown(run.cards).split("## Definitions")[0]);
  console.log(`Saved to ${out} (overthink.json, overthink.md). Took ${(run.timings.total_ms / 1000).toFixed(1)}s.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message || e); process.exit(1); });
