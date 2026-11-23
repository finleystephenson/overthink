// "How and why": for one arm against the baseline, a ranked chain from what was done to what moved.
//
//   intervention → what it changed in the records → which simulation channels moved → which measures moved
//
// Every step is read from data the run kept: the engine's answers to the intervention's tool calls, the levers at the
// end (prices, marketing, team), the plug-ins' own "why" lists day by day, the daily timeline, and the records of
// each customer. A link between two steps is only drawn when both moved AND the simulator has a rule that connects
// them (MECHANISMS, from docs/consequences.md and simulation/simulator/README.md); otherwise the step is listed on its own. Nothing here
// is a claim about the real world.
//
// Also here: follow one chain through the records ("follow this order", "follow this AI action").
import { buildResults, MEASURES, say } from "./results.mjs";
import { mean } from "../simulator/stats.mjs";

const r2 = (x) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

/**
 * The simulator's rules that connect a channel to the measures it can move. WHY a fixed table: these are the model's
 * own mechanics (business/data/sim.json, simulation/simulator/core.mjs); listing them keeps every drawn link checkable.
 */
const MECHANISMS = {
  price_index: { label: "Prices customers see (index, 1 = as planned)", rule: "Orders follow price to the power of minus the price elasticity (business/data/sim.json), and each customer weighs price against their own sensitivity.", moves: ["orders", "revenue", "visitors", "gross_profit", "net_profit"] },
  marketing_per_month: { label: "Marketing spend (£ a month)", rule: "Demand follows 1 + marketing elasticity × ln(spend ÷ plan); the spend is a daily cost.", moves: ["orders", "visitors", "revenue", "net_profit", "new_customers"] },
  team_weekly_hours: { label: "Team hours a week", rule: "Staff work the contact queue at their own speed; more hours shorten the wait and cost pay.", moves: ["first_response_minutes", "first_response_median_minutes", "customer_satisfaction", "share_satisfied", "abandoned_contacts", "net_profit", "staff_task_hours", "overtime_hours"] },
  events_added: { label: "World events added", rule: "An event's effects multiply demand, contacts, delays and costs while it runs (infrastructure/engine/events.js).", moves: ["orders", "contacts", "late_parcels", "complaints", "customer_satisfaction", "net_profit", "revenue"] },
  campaigns_added: { label: "Campaigns and sales added", rule: "A campaign's spend adds visitors; a code gives its discount to about a quarter of buyers (infrastructure/engine/campaigns.js).", moves: ["orders", "revenue", "visitors", "gross_profit", "net_profit"] },
  policies: { label: "Business rules changed", rule: "Delivery charges change what an order costs (demand follows); a return refused outside the window leaves the customer only partly helped.", moves: ["orders", "revenue", "customer_satisfaction", "share_satisfied", "complaints", "repeat_contacts", "net_profit"] },
  contacts_per_day: { label: "Customer contacts a day", rule: "Contacts are drawn per order and day by topic; late parcels and bad memories raise them.", moves: ["contacts", "staff_task_hours", "first_response_minutes", "complaints"] },
  reputation: { label: "Reputation (0 to 1)", rule: "A moving average of reviews; it feeds back into demand weeks later.", moves: ["orders", "revenue"] },
  ai: { label: "Contacts answered by the connected AI", rule: "The AI gets its role's work first; what it does not resolve goes to staff (simulation/simulator/judge.mjs decides from the records).", moves: ["first_response_minutes", "customer_satisfaction", "staff_task_hours", "wrong_actions", "share_satisfied"] },
};

/**
 * Explains one arm.
 * @param {object} raw runExperiment's result.
 * @param {string} armId
 * @param {{people?: number}=} o How many affected people to name (default 8).
 * @return {object} { arm, what_was_done, channels, measures, chains, people_affected, honesty }
 */
export function explainArm(raw, armId, { people = 8 } = {}) {
  const arm = raw.arms[armId], base = raw.arms.baseline;
  if (!arm || armId === "baseline") throw Object.assign(new Error(`No arm "${armId}" to explain (the baseline is what the others are compared with).`), { code: "not_found" });
  const res = buildResults(raw).arms[armId];
  const done = arm.applied.filter((a) => !a.seed).map((a) => ({ day: a.day, what: a.label, summary: a.summary, record_changes: a.changes.slice(0, 10), more: Math.max(0, a.changes.length - 10), refused: a.refused, not_done: a.error }));
  if (arm.ai) done.unshift({ day: 0, what: "Connect an AI or tool", summary: `${arm.ai.connection.label} answers as ${arm.ai.role}`, record_changes: [], more: 0, refused: [], not_done: null });
  const channels = channelMoves(base, arm);
  const measures = Object.entries(res.measures).filter(([, m]) => m.difference.mean)
    .map(([k, m]) => ({ key: k, label: m.label, difference: m.difference.mean, ci90: m.difference.ci90, clear: m.difference.clear, relative: m.relative, direction: m.direction, in_words: `${m.difference.mean > 0 ? "up" : "down"} ${say(MEASURES[k], m.difference.mean)}` }))
    .sort((a, b) => Number(b.clear) - Number(a.clear) || Math.abs(b.relative ?? 0) - Math.abs(a.relative ?? 0));
  const chains = [];
  for (const c of channels) {
    const mech = MECHANISMS[c.key] || MECHANISMS[c.mechanism];
    const moved = mech ? measures.filter((m) => mech.moves.includes(m.key)) : [];
    chains.push({ channel: c.label, change: c.in_words, rule: mech?.rule ?? c.because ?? null, measures: moved.map((m) => `${m.label}: ${m.in_words}${m.clear ? "" : " (not clear from luck)"}`), traced_from: c.traced_from });
  }
  return {
    arm: { id: armId, label: arm.label, verdict: res.verdict },
    what_was_done: done,
    channels,
    measures: measures.slice(0, 15),
    chains,
    records: recordDiff(base, arm),
    people_affected: peopleAffected(base, arm, people),
    honesty: "Each link is drawn only when the channel moved, the measure moved, and the simulator has a rule joining them. Measures marked 'not clear from luck' moved on average but their 90% interval includes zero.",
  };
}

/** Channels that differ between the arm and the baseline, ranked by relative size. */
function channelMoves(base, arm) {
  const out = [];
  const avg = (rows, f) => mean(rows.map(f).filter((x) => typeof x === "number"));
  const add = (key, b, a, traced, extra = {}) => {
    if (b === null || a === null || b === a) return;
    const d = a - b;
    out.push({ key, label: MECHANISMS[key]?.label ?? extra.label ?? key, baseline: r2(b), arm: r2(a), difference: r2(d), relative: b ? Math.abs(d / b) : Math.abs(d),
      in_words: `${r2(b)} → ${r2(a)}`, traced_from: traced, ...extra });
  };
  const last = (s) => s.channels;
  add("price_index", avg(base.seeds, (s) => last(s).price_index), avg(arm.seeds, (s) => last(s).price_index), "the price history at the end of the run, weighted like the simulator");
  add("marketing_per_month", avg(base.seeds, (s) => last(s).marketing_per_month), avg(arm.seeds, (s) => last(s).marketing_per_month), "the marketing lever (get_levers)");
  add("team_weekly_hours", avg(base.seeds, (s) => last(s).team_weekly_hours), avg(arm.seeds, (s) => last(s).team_weekly_hours), "the team (get_levers)");
  add("events_added", avg(base.seeds, (s) => last(s).events_added), avg(arm.seeds, (s) => last(s).events_added), "world events added during the run");
  add("campaigns_added", avg(base.seeds, (s) => last(s).campaigns_added), avg(arm.seeds, (s) => last(s).campaigns_added), "campaigns made during the run");
  const pol = (s) => Object.keys(last(s).world_settings?.policies || {}).length;
  add("policies", avg(base.seeds, pol), avg(arm.seeds, pol), "world_settings.policies");
  const perDay = (s, k) => mean(s.series[k].filter((x) => typeof x === "number"));
  add("contacts_per_day", avg(base.seeds, (s) => perDay(s, "contacts")), avg(arm.seeds, (s) => perDay(s, "contacts")), "the daily timeline");
  add("reputation", avg(base.seeds, (s) => s.measures.reputation), avg(arm.seeds, (s) => s.measures.reputation), "the simulator's reputation at the end");
  if (arm.ai) add("ai", 0, avg(arm.seeds, (s) => s.measures.contacts_given_to_ai), "contacts sent to the AI (the simulator's count)");
  // Plug-in "why" lists: the average size of each source's effect over the days, where it differs.
  const whyAvg = (rows) => {
    const sums = {};
    for (const s of rows) for (const day of s.why) for (const w of day || []) {
      // WHY strip numbers: plug-ins write the size into the words ("down 17%"), which changes day to day; the
      // channel is the same one, and its size is in w.size.
      const effect = String(w.effect).replace(/\s*(up|down)?\s*[-+]?\d+(\.\d+)?\s*%?/gi, "").replace(/\(\s*\)/g, "").trim();
      const k = `${w.source}|${effect}`;
      const e = (sums[k] ||= { source: w.source, effect, total: 0, because: null });
      e.total += typeof w.size === "number" ? w.size - (/delay_days/.test(w.effect) ? 0 : 1) : 0;
      e.because = w.because || e.because;
    }
    const n = rows.length * Math.max(1, rows[0]?.why.length || 1);
    for (const v of Object.values(sums)) v.mean = v.total / n;
    return sums;
  };
  const wb = whyAvg(base.seeds), wa = whyAvg(arm.seeds);
  for (const k of new Set([...Object.keys(wb), ...Object.keys(wa)])) {
    const b = wb[k]?.mean ?? 0, a = wa[k]?.mean ?? 0;
    if (Math.abs(a - b) < 1e-4) continue;
    const src = (wa[k] || wb[k]);
    out.push({ key: `why:${k}`, mechanism: src.effect.startsWith("demand") || src.effect === "visits" ? "events_added" : src.effect === "contact_rate" ? "contacts_per_day" : "events_added",
      label: `${src.source}: ${effectWords(src.effect)} (average effect a day)`, baseline: r2(b), arm: r2(a), difference: r2(a - b), relative: Math.abs(a - b),
      in_words: `${pct(b, src.effect)} → ${pct(a, src.effect)}`, because: src.because, traced_from: "the plug-ins' own day-by-day answers (why lists)" });
  }
  return out.sort((x, y) => y.relative - x.relative);
}
const effectWords = (e) => e.replace(/^demand\.all$/, "demand overall").replace(/^demand\.product\./, "demand for ").replace(/^demand\.category\./, "demand in ").replace(/_/g, " ").replace(/^costs\./, "cost of ");
const pct = (x, e) => (/delay_days/.test(e) ? `${r2(x)} days` : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);

/** How many records of each kind differ (first seed). */
function recordDiff(base, arm) {
  const b = base.seeds[0]?.records, a = arm.seeds[0]?.records;
  if (!a || !b) return [];
  return Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => ({ records: k.replace(/_/g, " "), baseline: b[k], arm: a[k], difference: a[k] - b[k] }));
}

/** Customers whose outcomes differ between the arm and the baseline (first seed), sampled with names. */
function peopleAffected(base, arm, n) {
  const pb = base.seeds[0]?.people || {}, pa = arm.seeds[0]?.people || {};
  const zero = { orders: 0, spend: 0, contacts: 0, unhappy_contacts: 0, outcomes: [] };
  const diffs = [];
  for (const name of new Set([...Object.keys(pb), ...Object.keys(pa)])) {
    const b = pb[name] || zero, a = pa[name] || zero;
    const d = { orders: a.orders - b.orders, spend: r2(a.spend - b.spend), contacts: a.contacts - b.contacts, unhappy: a.unhappy_contacts - b.unhappy_contacts };
    if (!d.orders && !d.contacts && !d.unhappy && !d.spend) continue;
    diffs.push({ name, ...d, baseline: b, arm: a, score: Math.abs(d.spend) + 30 * Math.abs(d.unhappy) + 10 * Math.abs(d.contacts) });
  }
  diffs.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
  const count = (f) => diffs.filter(f).length;
  return {
    seed: base.seeds[0]?.seed ?? null,
    customers_with_different_outcomes: diffs.length,
    bought_more: count((d) => d.orders > 0), bought_less: count((d) => d.orders < 0), spent_more: count((d) => d.spend > 0), spent_less: count((d) => d.spend < 0),
    more_unhappy_contacts: count((d) => d.unhappy > 0), fewer_unhappy_contacts: count((d) => d.unhappy < 0),
    examples: diffs.slice(0, n).map((d) => ({ name: d.name, in_words: personWords(d), baseline: { orders: d.baseline.orders, spend: d.baseline.spend, contacts: d.baseline.outcomes }, arm: { orders: d.arm.orders, spend: d.arm.spend, contacts: d.arm.outcomes } })),
  };
}
function personWords(d) {
  const bits = [];
  if (d.orders) bits.push(`${d.arm.orders} ${d.arm.orders === 1 ? "order" : "orders"} here against ${d.baseline.orders} in the baseline`);
  else if (d.spend) bits.push(`spent £${Math.abs(d.spend).toFixed(2)} ${d.spend > 0 ? "more" : "less"} on the same number of orders`);
  if (d.contacts) bits.push(`got in touch ${d.arm.contacts} ${d.arm.contacts === 1 ? "time" : "times"} against ${d.baseline.contacts}`);
  if (d.unhappy) bits.push(`${Math.abs(d.unhappy)} ${d.unhappy > 0 ? "more" : "fewer"} contacts that ended badly`);
  return `${d.name}: ${bits.join("; ")}.`;
}

// ---------------------------------------------------------------- following one chain through the records

/**
 * Follows one order through a world's records and a sandbox trace: who placed it, what happened to it, every contact,
 * return, refund, review and case that names it, and every tool call that touched it, in time order.
 * @param {object} state world.state
 * @param {string} orderNumber
 * @param {Array<object>=} trace A sandbox trace (store's sb.trace), optional.
 * @return {object}
 */
export function followOrder(state, orderNumber, trace = []) {
  const o = state.orders.find((x) => x.number === orderNumber);
  if (!o) throw Object.assign(new Error(`There is no order ${orderNumber} in these records.`), { code: "not_found" });
  const cust = state.customers.find((c) => c.id === o.customer_id);
  const events = [];
  const add = (at, kind, text, evidence) => events.push({ at, kind, text, evidence });
  add(o.placed_at, "order", `${cust?.name ?? "A customer"} placed the order: ${o.items.map((l) => `${l.qty} × ${l.name || l.sku}`).join(", ")}, £${o.totals.total.toFixed(2)}.`, { order: o.number });
  for (const h of o.history || []) add(h.at, "status", `${h.event || `Order ${h.status || "changed"}`}${h.note ? `: ${h.note}` : ""}`.replace(/\.?$/, "."), h);
  for (const s of o.shipments || []) if (s.delivered_at) add(s.delivered_at, "delivery", `Parcel delivered${s.delay_days ? `, ${s.delay_days} days late` : ""}.`, { shipment: s.id });
  for (const c of state.contacts || []) if (c.order === o.number) add(c.at, "contact", `${cust?.name ?? "The customer"} got in touch (${c.topic.replace(/_/g, " ")}) by ${c.channel.replace(/_/g, " ")}; ${c.handled_by ? `${c.handled_by.replace(/_/g, " ")} answered${c.first_reply_minutes !== null ? ` after ${c.first_reply_minutes} minutes` : ""}, ${c.outcome.replace(/_/g, " ")}` : "not answered yet"}.`, { contact: c.id });
  for (const r of state.returns || []) if (r.order_number === o.number || r.order === o.number) add(r.created_at || r.at, "return", `A return was opened (${r.reason || "no reason given"}), now ${r.status}.`, { return: r.number || r.id });
  for (const l of state.ledger || []) if (l.ref === o.number && ["refund", "goodwill_credit"].includes(l.type)) add(l.at, "money", `${l.type === "refund" ? "Refund" : "Goodwill"} of £${Math.abs(l.amount).toFixed(2)}.`, { ledger: l.type });
  for (const rv of state.reviews || []) if (rv.order === o.number || rv.order_number === o.number) add(rv.at || rv.date, "review", `Review: ${rv.rating} stars${rv.title ? `, "${rv.title}"` : ""}.`, { review: rv.id });
  for (const c of state.cases || []) if (c.related?.order === o.number) add(c.opened_at || c.created_at, "case", `Case opened: ${c.subject}${c.is_complaint ? " (a complaint)" : ""}, ${c.status}.`, { case: c.number });
  for (const t of trace) if (t.kind === "tool" && JSON.stringify(t.input || {}).includes(o.number)) add(t.sim_time, "tool_call", `${t.actor?.role?.replace(/_/g, " ") ?? "Someone"} called ${t.tool}: ${t.ok ? (t.changes?.length ? `changed ${t.changes.join("; ")}` : "looked") : `refused (${t.error?.code})`}.`, { seq: t.seq, tool: t.tool, ok: t.ok });
  events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return { order: o.number, customer: cust?.name ?? null, status: o.status, events };
}

/**
 * Follows one action from a sandbox trace: what the actor read before it in the same conversation, what it changed,
 * and what happened afterwards to the records it named (contacts, refunds, returns, reviews, cases).
 * @param {object} state world.state
 * @param {Array<object>} trace
 * @param {number} seq The trace entry's number.
 * @return {object}
 */
export function followAction(state, trace, seq) {
  const t = trace.find((e) => e.seq === seq);
  if (!t) throw Object.assign(new Error(`No action number ${seq} in this trace.`), { code: "not_found" });
  const same = trace.filter((e) => e.kind === "tool" && e.actor?.session === t.actor?.session && e.actor?.token === t.actor?.token);
  const read = same.filter((e) => e.seq < seq && e.ok && !(e.changes || []).length).map((e) => ({ seq: e.seq, tool: e.tool, input: e.input }));
  const orders = [...new Set((JSON.stringify(t.input || {}) + JSON.stringify(t.result || {})).match(/ORD-\d+/g) || [])];
  const after = orders.map((n) => { try { return followOrder(state, n, trace).events.filter((e) => String(e.at) >= String(t.sim_time)); } catch { return []; } }).flat();
  return {
    action: { seq, tool: t.tool, role: t.actor?.role, at: t.sim_time, ok: t.ok, input: t.input, error: t.error ?? null },
    read_first: read,
    changed: t.changes || [],
    then: after,
    in_words: `${t.actor?.role?.replace(/_/g, " ") ?? "Someone"} ${t.ok ? "used" : "tried"} ${t.tool}${read.length ? ` after reading with ${[...new Set(read.map((r) => r.tool))].join(", ")}` : " without reading anything first"}${t.ok ? (t.changes?.length ? `; it changed ${t.changes.length} record${t.changes.length > 1 ? "s" : ""}` : "; it changed nothing") : `; it was refused (${t.error?.code})`}.`,
  };
}
