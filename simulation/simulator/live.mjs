// A live business: a world people and outside AIs act in at any moment, plus a shadow twin where nothing is done.
//
//   const live = createLive({ world, biz, seed, makeWorld });
//   ...anyone changes prices, stock, marketing, staffing through the engine's tools...
//   await live.advance(7);     // both worlds move on the same 7 days
//   live.impact();             // live minus shadow, for the headline measures, with a per-day series
//
// The shadow is a second world made from the same starting state, run with the same seed and the same plug-ins, that
// only ever has staff in it. Every chance in a day comes from streams keyed by business facts (common random
// numbers), so with no outside actions the two worlds stay identical and the impact is exactly zero. Whatever differs
// is what was done.
//
// WHY lazy: most sandboxes are poked at and never moved on in time. Nothing is built until the first advance; then the
// shadow world and both simulators are made from the starting state (see start()).
// Browser-safe: no Node APIs. The caller supplies makeWorld (how to turn a saved state into a world).
import { createSim, restoreSim, scaleFor } from "./core.mjs";
import { round2 } from "./lib.mjs";

/** The most days the per-day series keeps before it halves itself (so ten years still cost little memory). */
const SERIES_MAX = 4000;

/** Headline measures, worked out from a simulator's running totals. Each is a cumulative figure. */
const MEASURES = {
  revenue: (t) => t.revenue,
  gross_profit: (t) => t.revenue - t.refunds - t.cogs,
  net_profit: (t) => t.revenue - t.refunds - t.cogs - t.card_fees - t.delivery_costs - t.goodwill - t.packaging - t.staff_pay
    - t.overtime_pay - t.fixed_costs - t.marketing - t.outreach_cost,
  cash: (t) => t.cash_flow,
  orders: (t) => t.orders,
  refunds: (t) => t.refunds,
  complaints: (t) => t.complaints,
  reviews: (t) => t.reviews,
  lost_sales: (t) => t.lost_sales,
  stockouts: (t) => t.stockout_sku_days,
  staff_task_hours: (t) => t.task_minutes / 60,
};
/** Averages: a sum over a count, so a day's value is (change in sum) / (change in count). */
const AVERAGES = {
  customer_satisfaction: ["csat_sum", "csat_n"],
  first_response_minutes: ["frt_sum", "frt_n"],
};
const LABELS = {
  revenue: "Revenue (£)", gross_profit: "Gross profit (£)", net_profit: "Net profit (£)", cash: "Cash in the bank, change (£)",
  orders: "Orders", refunds: "Refunds (£)", complaints: "Complaints", reviews: "Reviews", lost_sales: "Lost sales (out of stock)",
  stockouts: "Stockouts (product-days)", staff_task_hours: "Staff task hours", customer_satisfaction: "Customer satisfaction (1 to 5)",
  first_response_minutes: "First response (working minutes, average)",
  social_reach: "Social reach from posts made here", followers: "Followers (both networks)", content_visits: "Shop visits from posts and mail",
  content_orders: "Orders from posts and mail (estimated)", content_revenue: "Revenue from posts and mail (estimated, £)",
  email_opens: "Marketing email opens", unsubscribes: "Unsubscribes",
};
/** Measures read from the records (what the audience plug-in wrote), not from the simulator's totals. */
const CONTENT = ["social_reach", "followers", "content_visits", "content_orders", "content_revenue", "email_opens", "unsubscribes"];

/**
 * Wraps a world in a live simulation with a shadow twin.
 * @param {object} o
 * @param {object} o.world The live world (the caller owns it; outside actions land here).
 * @param {object} o.biz The business files (simulation/simulator/data.mjs loadBusiness).
 * @param {function(string): object} o.makeWorld Builds a world from a saved state (JSON string). Used for the shadow.
 * @param {number=} o.seed Run seed (default 1).
 * @param {Array<object>=} o.plugins Plug-ins, given to both worlds.
 * @param {string=} o.startState The state the shadow starts from (JSON). Default: the world's state now.
 * @param {number=} o.popSeed, o.scale, o.customers Passed to createSim.
 * @return {Live}
 */
export function createLive(o) {
  return buildLive(o, null);
}

/**
 * Brings a saved live simulation back. `world` must hold the live state saved alongside it.
 * @param {object} saved What live.snapshot() returned.
 * @param {object} ctx { world, biz, makeWorld, plugins? }
 * @return {Live}
 */
export function restoreLive(saved, ctx) {
  return buildLive({ ...ctx, seed: saved.seed, popSeed: saved.popSeed, scale: saved.scale, customers: saved.customers, customerModel: saved.customerModel, startState: saved.startState }, saved);
}

/**
 * @typedef {object} Live
 * @property {function(number): Promise<{now: string, days: Array<object>}>} advance Moves both worlds on.
 * @property {function(): object} clock The simulated date, day number and seed.
 * @property {function(): object} impact Live minus shadow for the headline measures, with a per-day series.
 * @property {function(): object} snapshot JSON-safe; with the live world's state it restores everything.
 * @property {function(): boolean} started Whether the first advance has happened (and the shadow exists).
 * @property {function(): ?object} shadowWorld The shadow world, once built (for tests and inspection).
 */

function buildLive(o, saved) {
  const { world, biz, makeWorld, plugins = [] } = o;
  const seed = o.seed ?? 1;
  const popSeed = o.popSeed ?? 1;
  const customers = o.customers ?? null;
  // WHY rich by default: a live business is played with; its customers should behave like people (simulation/simulator/customers.mjs).
  const customerModel = o.customerModel ?? "rich";
  const scale = scaleFor(o.scale, world);
  let startState = o.startState ?? JSON.stringify(world.state);
  let liveSim = null, shadowSim = null, shadow = null;
  let series = { stride: 1, rows: [] };
  let chain = Promise.resolve();
  if (saved && saved.live) {
    shadow = makeWorld(saved.shadow.state);
    shadowSim = restoreSim(saved.shadow.sim, { world: shadow, biz, plugins });
    liveSim = restoreSim(saved.live, { world, biz, plugins, compact: false });
    series = saved.series;
    startState = null;
  }

  return {
    advance(days) {
      // One advance at a time: a second request waits for the first, so the two worlds never step out of turn.
      const run = chain.then(() => advanceNow(days));
      chain = run.catch(() => {});
      return run;
    },
    clock,
    impact,
    snapshot,
    between,
    started: () => !!liveSim,
    /** The simulator's running totals for both worlds (counts such as satisfied contacts and repeat contacts). */
    totals: () => (liveSim ? { live: liveSim.running(), shadow: shadowSim.running() } : null),
    shadowWorld: () => shadow,
  };

  /**
   * First advance: build the shadow from the starting state and run the simulator's set-up there, then carry the very
   * same set-up (population, recent orders, opening stock) over to the live world. WHY from the starting state and not
   * the live one: anything done before the first advance is an outside action, and must show as a difference.
   */
  function start() {
    shadow = makeWorld(startState);
    // If the engine's own clock was moved before the business went live (advance_day: parcels and bills, no customers),
    // the shadow lives through the same bare days, so both start the simulation on the same date.
    const manager = shadow.session({ role: "manager" });
    while (shadow.state.now < world.state.now) manager.call("advance_day", {});
    shadowSim = createSim({ world: shadow, biz, seed, popSeed, scale, customers, plugins, compact: false, customerModel });
    const first = shadowSim.snapshot();
    // The simulator defers the monthly money rows (lazySummary); set it before the opening counts, as the shadow did,
    // so both worlds keep their books the same way.
    world.lazySummary = true;
    const warehouse = world.session({ role: "warehouse" });
    for (const [sku, target] of first.opening || []) {
      const s = world.state.stock[sku];
      if (s && s.on_hand < target) warehouse.call("record_stock_count", { sku, counted_qty: target, note: "Opening stock for the simulation", adjust: true });
    }
    liveSim = restoreSim(first, { world, biz, plugins, compact: false });
    startState = null; // the shadow holds it now; no need to keep a second copy
  }

  async function advanceNow(days) {
    if (!Number.isInteger(days) || days < 1) throw Object.assign(new Error('"days" must be a whole number, 1 or more.'), { code: "invalid_input" });
    if (!liveSim) start();
    const out = [];
    for (let i = 0; i < days; i++) {
      const summary = await liveSim.step();
      const engine = liveSim.lastAdvance();
      await shadowSim.step();
      record(summary.date);
      out.push({ ...engine, summary });
    }
    return { now: world.state.now, days: out };
  }

  /** One row per day: each measure's cumulative value in both worlds. Thinned by half past SERIES_MAX rows. */
  function record(date) {
    const day = liveSim.day();
    if (day % series.stride !== 0) return;
    series.rows.push({ day, date, live: cumulative(liveSim.running(), world.state), shadow: cumulative(shadowSim.running(), shadow.state) });
    if (series.rows.length > SERIES_MAX) { series.rows = series.rows.filter((_, i) => i % 2 === 1); series.stride *= 2; }
  }

  function clock() {
    return { now: world.state.now, date: world.state.now.slice(0, 10), day: liveSim ? liveSim.day() : 0, seed, scale, started: !!liveSim };
  }

  /**
   * Live minus shadow. `measures` hold totals over every day compared (averages for satisfaction and response time);
   * `series` holds the same per day (or per `stride` days on very long runs) for charts.
   */
  function impact() {
    if (!liveSim) {
      return { days_compared: 0, from: null, to: world.state.now.slice(0, 10), note: "Nothing to compare yet: time has not moved. Advance at least one day.", measures: emptyMeasures(), series: { stride: 1, day: [], date: [], live: {}, shadow: {}, difference: {} } };
    }
    const a = cumulative(liveSim.running(), world.state), b = cumulative(shadowSim.running(), shadow.state);
    const measures = {};
    for (const k of Object.keys(LABELS)) measures[k] = { label: LABELS[k], live: value(a, k), shadow: value(b, k), difference: diff(value(a, k), value(b, k)) };
    return {
      days_compared: liveSim.day(), from: series.rows[0]?.date ?? null, to: world.state.now.slice(0, 10),
      note: "Live is this business with everything that was done in it. Shadow is the same business from the same start and the same luck, with nothing done. Difference is live minus shadow.",
      measures, series: perDay(),
    };
  }

  /** Per-day values from the cumulative rows: today's figure is the change since the previous kept row. */
  function perDay() {
    const keys = Object.keys(LABELS);
    const out = { stride: series.stride, day: [], date: [], live: {}, shadow: {}, difference: {} };
    for (const k of keys) { out.live[k] = []; out.shadow[k] = []; out.difference[k] = []; }
    let prev = null;
    for (const row of series.rows) {
      out.day.push(row.day); out.date.push(row.date);
      for (const k of keys) {
        const l = step(row.live, prev?.live, k), s = step(row.shadow, prev?.shadow, k);
        out.live[k].push(l); out.shadow[k].push(s); out.difference[k].push(diff(l, s));
      }
      prev = row;
    }
    return out;
  }

  /**
   * Live minus shadow for each measure, accumulated between two day numbers (0 = before the first day). Uses the
   * kept rows of the series, so on very long runs the ends snap to the nearest kept day.
   */
  function between(fromDay, toDay) {
    const at = (d) => {
      if (d <= 0) return null;
      let best = null;
      for (const r of series.rows) { if (r.day > d) break; best = r; }
      return best;
    };
    const a = at(fromDay), b = at(toDay);
    const out = {};
    for (const k of Object.keys(LABELS)) {
      if (AVERAGES[k]) continue;
      const d1 = b ? b.live[k] - b.shadow[k] : 0, d0 = a ? a.live[k] - a.shadow[k] : 0;
      out[k] = round2(d1 - d0);
    }
    return out;
  }

  function snapshot() {
    return {
      version: 1, seed, popSeed, scale, customers, customerModel, startState,
      live: liveSim ? liveSim.snapshot() : null,
      shadow: liveSim ? { state: JSON.stringify(shadow.state), sim: shadowSim.snapshot() } : null,
      series: JSON.parse(JSON.stringify(series)),
    };
  }
}

/** The raw sums each measure needs, from running totals and (for content) from the world's records. */
function cumulative(t, state) {
  const out = {};
  for (const [k, f] of Object.entries(MEASURES)) out[k] = f(t);
  Object.assign(out, contentFigures(state));
  for (const [k, [sum, n]] of Object.entries(AVERAGES)) { out[k + ":sum"] = t[sum]; out[k + ":n"] = t[n]; }
  return out;
}
/** What posts and mail made through the tools did, as the audience plug-in wrote it on the records; and followers. */
function contentFigures(state) {
  const out = Object.fromEntries(CONTENT.map((k) => [k, 0]));
  for (const list of [state.social_posts || [], state.emails || []]) {
    for (const x of list) {
      const s = x.audience?.so_far;
      if (!s) continue;
      out.social_reach += s.reach || 0; out.content_visits += s.visits || 0; out.content_orders += s.orders || 0;
      out.content_revenue += s.revenue || 0; out.email_opens += s.opens || 0;
      out.unsubscribes += x.audience.kind === "marketing_email" && x.audience.days_counted ? x.audience.unsubscribed : 0;
    }
  }
  const latest = {};
  for (const r of state.social_stats_daily || []) if (!latest[r.network] || r.date >= latest[r.network].date) latest[r.network] = r;
  out.followers = Object.values(latest).reduce((n, r) => n + (r.followers || 0), 0);
  return out;
}

function value(c, k) {
  if (AVERAGES[k]) return c[k + ":n"] ? round2(c[k + ":sum"] / c[k + ":n"]) : null;
  return round2(c[k]);
}
function step(now, before, k) {
  if (AVERAGES[k]) {
    const n = now[k + ":n"] - (before ? before[k + ":n"] : 0);
    return n ? round2((now[k + ":sum"] - (before ? before[k + ":sum"] : 0)) / n) : null;
  }
  return round2(now[k] - (before ? before[k] : 0));
}
function diff(a, b) { return a === null || b === null ? null : round2(a - b); }
function emptyMeasures() {
  return Object.fromEntries(Object.keys(LABELS).map((k) => [k, { label: LABELS[k], live: 0, shadow: 0, difference: 0 }]));
}

/**
 * The headline measures for one simulator's running totals and its world's state, as impact() counts them (the lab
 * compares many branches, not one live world and its shadow, so it needs the same figures without a Live).
 * @param {object} running sim.running()
 * @param {object} state world.state
 * @return {Object<string, ?number>}
 */
export function headlineMeasures(running, state) {
  const c = cumulative(running, state);
  return Object.fromEntries(Object.keys(LABELS).map((k) => [k, value(c, k)]));
}
/** Plain labels for the headline measures. */
export const MEASURE_LABELS = LABELS;
