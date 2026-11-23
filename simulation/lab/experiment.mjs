// An experiment: a question asked of the simulated business by changing it in several ways side by side.
//
//   {
//     "title": "Raise all prices 10%",
//     "question": "What if we raise all prices 10%?",
//     "start": { "size": "standard", "seed": 1 },        // the starting world; seed = the customer population's seed
//     "days": 30, "seeds": 5,                             // each repeat (seed) is new luck, the same for every arm
//     "arms": [ { "id": "dearer", "label": "10% dearer", "interventions": [ { "type": "price_change", "params": { "percent": 10 } } ] } ]
//   }
//
// The baseline arm (nothing done) is always added. How it runs: the start world is built once and one snapshot is
// taken (simulation/lab/branch.mjs). For each seed, every arm is restored from that snapshot as its own branch, its interventions
// are applied on their days, and all arms are moved on the same days with the same seed and the same plug-ins. Every
// chance is keyed by business facts (common random numbers), so an arm with no interventions is identical to the
// baseline, and any difference is caused by what the arm did. Repeating over seeds shows how much the answer depends
// on luck.
import { makeStart, openBranch, startHost } from "./branch.mjs";
import { checkIntervention, applyIntervention } from "./interventions.mjs";
import { openClient } from "./client.mjs";
import { headlineMeasures } from "../simulator/live.mjs";
import { addDays } from "../simulator/lib.mjs";
import { createHash } from "node:crypto";

const fail = (message) => { throw Object.assign(new Error(message), { code: "invalid_input" }); };

/** Limits for one experiment. A public server should keep these; the command line may raise them. */
export const DEFAULT_LIMITS = { maxDays: 365, maxSeeds: 30, maxArms: 8, maxInterventions: 30, allowAi: true };

/** Per-day figures kept for charts (from each day's timeline line). */
const DAY_KEYS = ["orders", "revenue", "net", "contacts", "lost_sales", "reputation", "task_hours", "csat"];

/**
 * Checks an experiment and fills in defaults. Throws invalid_input in plain words.
 * @param {*} spec
 * @param {object=} limits DEFAULT_LIMITS or tighter.
 * @return {object} The experiment as it will run.
 */
export function checkExperiment(spec, limits = DEFAULT_LIMITS) {
  if (!spec || typeof spec !== "object") fail("An experiment is a JSON object: { title, question, start, days, seeds, arms }.");
  const days = spec.days ?? 30, seeds = spec.seeds ?? 5;
  if (!Number.isInteger(days) || days < 1 || days > limits.maxDays) fail(`"days" must be a whole number from 1 to ${limits.maxDays}.`);
  if (!Number.isInteger(seeds) || seeds < 1 || seeds > limits.maxSeeds) fail(`"seeds" must be a whole number from 1 to ${limits.maxSeeds}.`);
  const start = { size: spec.start?.size ?? "standard", seed: spec.start?.seed ?? 1 };
  if (!["demo", "standard"].includes(start.size)) fail('"start.size" must be "demo" or "standard".');
  if (!Number.isInteger(start.seed) || start.seed < 0) fail('"start.seed" must be a whole number, 0 or more.');
  const firstSeed = spec.first_seed ?? 1;
  if (!Number.isInteger(firstSeed) || firstSeed < 0) fail('"first_seed" must be a whole number, 0 or more.');
  const arms = spec.arms ?? [];
  if (!Array.isArray(arms) || arms.length < 1) fail('Give at least one arm in "arms" (the baseline, with nothing done, is added for you).');
  if (arms.length > limits.maxArms) fail(`At most ${limits.maxArms} arms.`);
  const seen = new Set(["baseline"]);
  let total = 0;
  const checked = arms.map((a, i) => {
    const id = a?.id ?? `arm-${i + 1}`;
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(id)) fail(`Arm ${i + 1}: "id" is up to 40 letters, numbers, - or _.`);
    if (seen.has(id)) fail(`Two arms are called "${id}" (and "baseline" is taken).`);
    seen.add(id);
    const ivs = (a.interventions ?? []).map((iv) => checkIntervention(iv, days));
    total += ivs.length;
    const ai = ivs.filter((iv) => iv.type === "connect_ai");
    if (ai.length > 1) fail(`Arm "${id}": connect one AI per arm.`);
    if (ai.length && !limits.allowAi && ai[0].params.connection.kind !== "none") fail("Connecting an AI is not allowed on this server. Run the lab on your own machine (node simulation/lab/cli.mjs).");
    return { id, label: typeof a.label === "string" && a.label ? a.label.slice(0, 120) : id, interventions: ivs };
  });
  if (total > limits.maxInterventions) fail(`At most ${limits.maxInterventions} interventions in one experiment.`);
  const plugins = spec.plugins ?? null;
  if (plugins !== null && (!Array.isArray(plugins) || plugins.some((p) => typeof p !== "string"))) fail('"plugins" is a list of plug-in names, or leave it out for all of them.');
  return {
    title: String(spec.title || spec.question || "An experiment").slice(0, 200),
    question: String(spec.question || spec.title || "").slice(0, 500),
    start, days, seeds, first_seed: firstSeed, plugins,
    arms: [{ id: "baseline", label: "Baseline (nothing done)", interventions: [] }, ...checked],
  };
}

/**
 * Runs an experiment.
 * @param {*} spec The experiment (checked here).
 * @param {object=} o
 * @param {object=} o.limits
 * @param {function(object): void=} o.onProgress Called after each simulated day: { seed, seed_index, seeds, day, days, done }.
 * @param {function(): boolean=} o.shouldStop Stop early (results then cover the seeds that finished).
 * @param {boolean=} o.keepFirstSeed Keep each arm's world state and trace from the first seed, to follow one order or
 *     one action afterwards (simulation/lab/explain.mjs followOrder, followAction). Costs memory: a world each.
 * @return {Promise<object>} The raw run: per arm and seed, every figure the results, explanation and scorecard need.
 */
export async function runExperiment(spec, { limits = DEFAULT_LIMITS, onProgress = () => {}, shouldStop = () => false, keepFirstSeed = false } = {}) {
  const exp = checkExperiment(spec, limits);
  const t0 = performance.now();
  const start = await makeStart({ size: exp.start.size, popSeed: exp.start.seed, plugins: exp.plugins });
  const setupMs = Math.round(performance.now() - t0);
  const aiArms = exp.arms.filter((a) => aiOf(a) && aiOf(a).params.connection.kind !== "none");
  const host = aiArms.length ? await startHost() : null;
  // Customers' private details, to check whether an AI's replies gave one customer's details to another.
  const customers = aiArms.length ? customerDetails(JSON.parse(start.state).customers) : null;
  const clients = new Map();
  const out = {
    experiment: exp, start: { size: start.size, date: start.startDate, population_seed: exp.start.seed },
    plugins: start.plugins.map((p) => p.name), plugins_skipped: start.skipped,
    arms: Object.fromEntries(exp.arms.map((a) => [a.id, { id: a.id, label: a.label, interventions: a.interventions.map(publicIv), seeds: [], applied: [], ai: aiOf(a) ? aiInfo(aiOf(a)) : null }])),
    customers, repro: reproOf(exp, start), seeds_run: [], timings: { setup_ms: setupMs, per_seed_ms: [] }, stopped_early: false,
  };
  try {
    for (let s = 0; s < exp.seeds; s++) {
      if (shouldStop()) { out.stopped_early = true; break; }
      const seed = exp.first_seed + s;
      const ts = performance.now();
      const branches = exp.arms.map((arm) => openArm(start, arm, seed, host, clients));
      for (let d = 0; d < exp.days; d++) {
        for (const b of branches) {
          for (const iv of b.arm.interventions) {
            if (iv.day !== d || iv.type === "connect_ai") continue;
            const rec = applyIntervention(b.world, iv);
            if (s === 0) out.arms[b.arm.id].applied.push(rec);
            else if (rec.refused.length || rec.error) out.arms[b.arm.id].applied.push({ ...rec, seed });
          }
          const probe = b.probeMods ? modsBySource(start, b.world, seed) : null;
          const line = await b.sim.step();
          b.lines.push(line);
          // The plug-ins' own why lists (simulation/simulator/core.mjs puts them on the line), plus the plain effects of plug-ins that
          // give no reasons (engine events), so every source of a change is there every day.
          b.why.push([...(line.why || []), ...(probe || [])]);
        }
        onProgress({ seed, seed_index: s, seeds: exp.seeds, day: d + 1, days: exp.days, done: (s * exp.days + d + 1) / (exp.seeds * exp.days) });
        // Let other requests (and Ctrl-C) be heard during a long run.
        if (d % 5 === 4) await new Promise((r) => setImmediate(r));
      }
      for (const b of branches) out.arms[b.arm.id].seeds.push(collect(b, start, seed, s === 0));
      if (keepFirstSeed && s === 0) for (const b of branches) Object.defineProperty(out.arms[b.arm.id], "kept", { value: { state: b.world.state, trace: b.hosted ? b.hosted.sb.trace.slice() : [] }, enumerable: false });
      for (const b of branches) if (b.hosted) host.detach(b.hosted.sb);
      out.seeds_run.push(seed);
      out.timings.per_seed_ms.push(Math.round(performance.now() - ts));
    }
  } finally {
    for (const c of clients.values()) await c.close();
    if (host) await host.close();
  }
  out.timings.total_ms = Math.round(performance.now() - t0);
  for (const [id, c] of clients) out.arms[id].ai.declared = { ...c.declared };
  return out;
}

/**
 * What anyone needs to run this again and get the same numbers: a fingerprint of the starting state, the seeds, every
 * intervention with its parameters, and the settings. (The product under test adds its declared version and model.)
 */
function reproOf(exp, start) {
  return {
    start_state_sha256: createHash("sha256").update(start.state).digest("hex"),
    size: exp.start.size, population_seed: exp.start.seed, seeds: Array.from({ length: exp.seeds }, (_, i) => exp.first_seed + i), days: exp.days,
    plugins: start.plugins.map((p) => p.name), customer_model: "rich",
    arms: exp.arms.map((a) => ({ id: a.id, interventions: a.interventions.map(publicIv) })),
    node: process.version,
  };
}

const aiOf = (arm) => arm.interventions.find((iv) => iv.type === "connect_ai") || null;
const aiInfo = (iv) => ({ connection: { kind: iv.params.connection.kind, label: iv.params.connection.label }, role: iv.params.role, cost_per_month: iv.params.cost_per_month });
const publicIv = (iv) => ({ type: iv.type, day: iv.day, label: iv.label, params: iv.type === "connect_ai" ? { ...iv.params, connection: { kind: iv.params.connection.kind, label: iv.params.connection.label } } : iv.params });

/** Opens one arm's branch for a seed; an arm with an AI gets a sandbox on the local web door and a client. */
function openArm(start, arm, seed, host, clients) {
  const ai = aiOf(arm);
  const base = { arm, lines: [], why: [], probeMods: start.plugins.some((p) => typeof p.modifiers === "function") };
  if (!ai || ai.params.connection.kind === "none") return { ...base, ...openBranch(start, { seed }) };
  const world = start.makeWorld(start.state);
  const hosted = host.attach(world, start.size, ai.params.role, ai.params.scope);
  if (!clients.has(arm.id)) clients.set(arm.id, openClient(ai.params.connection, { timeoutMs: ai.params.timeout_seconds * 1000 }));
  const client = clients.get(arm.id);
  const logFrom = client.log.length;
  const b = openBranch(start, { seed, world, toolClient: client, tracer: hosted.tracer, toolEnv: hosted.toolEnv, role: ai.params.role });
  return { ...base, ...b, hosted, client, logFrom };
}

/**
 * What each plug-in says it will do to tomorrow, by source, when the day's timeline line has no `why` of its own.
 * WHY: the explanation needs "which channel moved, because of which source"; this reads the plug-ins' own answers
 * (the same call the simulator makes) without changing anything.
 */
function modsBySource(start, world, seed) {
  const date = addDays(world.state.now.slice(0, 10), 1);
  const out = [];
  for (const p of start.plugins) {
    if (typeof p.modifiers !== "function") continue;
    let m;
    try { m = p.modifiers({ state: world.state, date, seed, data: start.biz }); } catch { continue; }
    if (!m || Array.isArray(m.why)) continue; // it explains itself on the day's line
    const add = (effect, size, neutral) => { if (typeof size === "number" && size !== neutral) out.push({ source: p.name, effect, size }); };
    add("demand.all", m.demand?.all, 1);
    for (const [k, v] of Object.entries(m.demand?.products || {})) add(`demand.product.${k}`, v, 1);
    for (const [k, v] of Object.entries(m.demand?.categories || {})) add(`demand.category.${k}`, v, 1);
    add("visits", m.visits, 1); add("contact_rate", m.contact_rate, 1); add("carrier_delay_days", m.carrier_delay_days, 0);
    add("supplier_late_chance", m.supplier_late_chance, 1);
    for (const [k, v] of Object.entries(m.costs || {})) add(`costs.${k}`, v, 1);
  }
  return out;
}

/** Everything kept from one arm's run of one seed. The world itself is let go afterwards. */
function collect(b, start, seed, detailed) {
  const { sim, world } = b;
  const running = sim.running();
  const tot = sim.totals();
  const st = world.state;
  const measures = { ...headlineMeasures(running, st), ...extraMeasures(running, tot) };
  const series = Object.fromEntries(DAY_KEYS.map((k) => [k, b.lines.map((l) => l[k] ?? null)]));
  const row = {
    seed, measures, series, why: b.why, channels: channels(world, start), problems: b.lines.flatMap((l) => (l.problems || []).map((p) => ({ day: l.day, problem: p }))),
    notes: b.lines.flatMap((l) => (l.notes || []).map((n) => ({ day: l.day, note: n }))).slice(0, 200),
  };
  if (detailed) { row.records = recordCounts(st, start); row.people = peopleOf(st, start.startDate); }
  row.contact_outcomes = contactOutcomes(st, start.startDate);
  if (b.client) row.ai = aiTrace(b, st);
  return row;
}

/** Non-financial and supporting figures from the simulator's running totals. */
function extraMeasures(t, tot) {
  const per = (a, n) => (n ? Math.round((a / n) * 1000) / 1000 : null);
  return {
    contacts: t.contacts, repeat_contacts: t.repeat_contacts, abandoned_contacts: t.contacts_abandoned,
    share_satisfied: per(t.satisfied_n, t.csat_n), average_review: per(t.review_sum, t.reviews), bad_reviews: t.bad_reviews,
    first_response_median_minutes: tot.first_response_median_minutes, late_parcels: t.late_parcels,
    overtime_hours: Math.round((t.overtime_minutes / 60) * 100) / 100, new_customers: t.new_customers,
    visitors: Math.round(t.visitors || 0), reputation: tot.reputation,
    contacts_given_to_ai: t.tool_items, contacts_resolved_by_ai: t.contacts_tool - t.wrong_actions, contacts_handed_over_by_ai: t.contacts_handed_over,
    wrong_actions: t.wrong_actions, ai_errors: t.tool_errors, ai_tool_calls: t.tool_calls, ai_refused_calls: t.tool_refused, ai_failed_calls: t.tool_failed,
    rule_breaks: t.rule_breaks, lost_cash_low: tot.survival?.ran_out_of_cash ? 1 : 0,
  };
}

/** Levers a person can see at the end of the run: prices, marketing, team hours, events added. */
function channels(world, start) {
  const st = world.state;
  const weights = start.biz.sim.demand.product_weights;
  const today = st.now.slice(0, 10);
  let w = 0, sum = 0;
  for (const p of world.products) {
    const k = weights[p.id] || 0;
    if (!k) continue;
    const v = p.variants[0];
    let price = v.price, at = "";
    for (const h of st.price_history) if (h.sku === v.sku && h.date <= today && h.date >= at) { price = h.new_price; at = h.date; }
    w += k; sum += k * (price / v.price);
  }
  const plan = world.plan?.marketing_per_month ?? null;
  const team = world.session({ role: "manager" }).call("get_levers", {});
  return {
    price_index: w ? Math.round((sum / w) * 10000) / 10000 : 1,
    marketing_per_month: st.settings?.marketing_per_month ?? plan,
    team_weekly_hours: team.ok ? team.data.team.reduce((n, p) => n + (p.weekly_hours || 0), 0) : null,
    team_size: team.ok ? team.data.team.length : null,
    events_added: (st.world_events || []).filter((e) => e.origin === "added").length,
    campaigns_added: (st.campaigns || []).filter((c) => c.source === "tool").length,
    world_settings: st.world_settings ? structuredClone(st.world_settings) : null,
  };
}

/** How many records of each kind the run left (for "what changed in the records"). */
function recordCounts(st, start) {
  const lists = ["orders", "contacts", "reviews", "returns", "cases", "price_history", "campaigns", "world_events", "news", "purchase_orders", "emails", "social_posts", "conversations", "ledger"];
  return Object.fromEntries(lists.map((k) => [k, Array.isArray(st[k]) ? st[k].length : 0]));
}

/** Per customer, during the run: orders, money spent, contacts and how they ended. Keyed by name (what people read). */
function peopleOf(st, from) {
  const names = new Map(st.customers.map((c) => [c.id, c.name]));
  const people = {};
  const of = (id) => (people[names.get(id) || id] ||= { id, orders: 0, spend: 0, contacts: 0, unhappy_contacts: 0, outcomes: [] });
  for (const o of st.orders) {
    if (o.placed_at.slice(0, 10) <= from || o.status === "cancelled" || o.status === "payment_failed") continue;
    const p = of(o.customer_id);
    p.orders++; p.spend = Math.round((p.spend + o.totals.total) * 100) / 100;
  }
  for (const c of st.contacts) {
    if (c.at.slice(0, 10) <= from || !c.customer_id) continue;
    const p = of(c.customer_id);
    p.contacts++;
    if (UNHAPPY.has(c.outcome)) p.unhappy_contacts++;
    if (p.outcomes.length < 6) p.outcomes.push(`${c.topic.replace(/_/g, " ")}: ${c.outcome.replace(/_/g, " ")}`);
  }
  return people;
}
const UNHAPPY = new Set(["unresolved", "abandoned", "wrong_action", "partly_answered", "waiting"]);

/** Every contact during the run: who, and whether it ended well. For fairness across customer groups. */
function contactOutcomes(st, from) {
  return st.contacts.filter((c) => c.at.slice(0, 10) > from && c.customer_id).map((c) => ({ customer_id: c.customer_id, good: !UNHAPPY.has(c.outcome), by: c.handled_by }));
}

/** The details a customer would not want another customer to see. */
export function customerDetails(list) {
  return list.map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, line1: c.addresses?.[0]?.line1 ?? null, postcode: c.addresses?.[0]?.postcode ?? null }));
}

/** What the AI did in this branch, from the sandbox trace (the records) and the client's timings. */
function aiTrace(b, st) {
  const sbTrace = b.hosted.sb.trace.filter((e) => e.kind === "tool");
  const byCode = {}, byTool = {};
  for (const e of sbTrace) {
    byTool[e.tool] = (byTool[e.tool] || 0) + 1;
    if (!e.ok) byCode[e.error?.code || "error"] = (byCode[e.error?.code || "error"] || 0) + 1;
  }
  const log = b.client.log.slice(b.logFrom).map((x) => ({ ...x }));
  return { calls: sbTrace.length, refused_by_code: byCode, calls_by_tool: byTool, replies: log };
}
