// The economy around the shop: monthly figures for prices, confidence, jobs, interest rates and pay.
//
// Each month (on the release day in business/data/economy.json) a new row is worked out from the last one:
//   next = now + reversion x (long-run - now) + noise
// so figures wander but drift back towards normal. Confidence's long-run level rises when pay grows faster than
// prices (people feel better off). Bank Rate moves in steps of 0.25 on decision months towards a simple rule
// (higher when inflation is above 2%, lower when unemployment is high), and not every time: central banks move slowly.
// Noise is drawn with rngFor keyed by the month and the figure, so the same seed gives the same economy.
//
// Effects reach the shop with a lag, measured against the starting values (so an unchanged economy changes nothing):
//   confidence -> demand.all;  inflation -> costs.goods and costs.carrier;  unemployment and Bank Rate -> price_sensitivity.
import cfgBundled from "../../business/data/economy.json" with { type: "json" };
import { rngFor } from "../../business/builder/world/rng.mjs";
import { activeSettings, clamp, monthOf, nextMonth, publishNews, round } from "./common.mjs";

export const ECONOMY = cfgBundled;
export const INDICATORS = ["cpi_inflation", "consumer_confidence", "unemployment", "bank_rate", "wage_growth"];
const SHIFTS = { cpi_inflation: "inflation_shift", consumer_confidence: "confidence_shift", unemployment: "unemployment_shift", bank_rate: "bank_rate_shift", wage_growth: "wage_growth_shift" };

/** The starting row, from business/data/economy.json. */
export function startRow(cfg = cfgBundled) {
  const row = { id: cfg.start.month, month: cfg.start.month, published: `${cfg.start.month}-${String(cfg.release_day).padStart(2, "0")}`, status: "assumption" };
  for (const k of INDICATORS) row[k] = cfg.start[k].value;
  return row;
}

/** The rows published on or before a date, oldest first; the starting row when the world has none. */
export function rowsUpTo(state, date, cfg = cfgBundled) {
  const rows = (state.economy || []).filter((r) => r.published <= date);
  return rows.length ? rows : [startRow(cfg)];
}

/** A standard normal draw from two uniforms (Box-Muller). */
export function normal(r) {
  const u = Math.max(r.next(), 1e-12), v = r.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * The next month's figures from this month's. Pure.
 * @param {object} prev The last row.
 * @param {string} month "YYYY-MM" of the new row.
 * @param {number} seed
 * @param {object=} cfg business/data/economy.json.
 * @return {object} The new row (without news).
 */
export function nextRow(prev, month, seed, cfg = cfgBundled) {
  const P = cfg.processes;
  const step = (k, longRun) => {
    const p = P[k];
    const z = normal(rngFor(seed, "economy", month, k));
    return round(clamp(prev[k] + p.reversion * (longRun - prev[k]) + p.noise * z, p.min, p.max), 2);
  };
  const row = { id: month, month, published: `${month}-${String(cfg.release_day).padStart(2, "0")}`, status: "simulated" };
  row.cpi_inflation = step("cpi_inflation", P.cpi_inflation.long_run);
  row.wage_growth = step("wage_growth", P.wage_growth.long_run);
  row.unemployment = step("unemployment", P.unemployment.long_run);
  const realPay = prev.wage_growth - prev.cpi_inflation;
  row.consumer_confidence = round(step("consumer_confidence", P.consumer_confidence.long_run + P.consumer_confidence.real_pay_weight * realPay), 1);
  row.bank_rate = nextBankRate(prev, month, seed, P.bank_rate);
  return row;
}

function nextBankRate(prev, month, seed, B) {
  if (!B.decision_months.includes(Number(month.slice(5, 7)))) return prev.bank_rate;
  const target = B.neutral + B.inflation_weight * (prev.cpi_inflation - 2) - B.unemployment_weight * (prev.unemployment - 4.5);
  const gap = target - prev.bank_rate;
  if (Math.abs(gap) < B.step || !rngFor(seed, "economy", month, "bank_rate_decision").chance(B.move_chance)) return prev.bank_rate;
  return round(clamp(prev.bank_rate + Math.sign(gap) * B.step, B.min, B.max), 2);
}

/** The news story for a month's figures. Section "Money". */
export function economyNews(row, prev) {
  const f = (x) => `${x.toFixed(1)}%`;
  let headline;
  if (row.bank_rate !== prev.bank_rate) {
    headline = `The Counting House ${row.bank_rate < prev.bank_rate ? "cuts" : "raises"} Bank Rate to ${row.bank_rate.toFixed(2)}%`;
  } else if (Math.abs(row.cpi_inflation - prev.cpi_inflation) >= 0.3) {
    headline = `Prices rising ${row.cpi_inflation > prev.cpi_inflation ? "faster" : "more slowly"}: inflation ${f(row.cpi_inflation)}`;
  } else if (Math.abs(row.consumer_confidence - prev.consumer_confidence) >= 4) {
    headline = `Shoppers feel ${row.consumer_confidence > prev.consumer_confidence ? "better" : "worse"} about their money`;
  } else {
    headline = `Prices rising at ${f(row.cpi_inflation)} a year, say the monthly figures`;
  }
  const story = `The Office for Plain Figures says prices are ${f(row.cpi_inflation)} higher than a year ago (last month ${f(prev.cpi_inflation)}). `
    + `Pay is up ${f(row.wage_growth)} and ${f(row.unemployment)} of people who want work cannot find it. `
    + `The Guild of Small Shopkeepers' confidence survey reads ${Math.round(row.consumer_confidence)} (last month ${Math.round(prev.consumer_confidence)}; below zero means more people feel worse off than better). `
    + `Bank Rate is ${row.bank_rate.toFixed(2)}%.`;
  return { headline, story };
}

/**
 * End of a day: on the release day, adds the month's row (once) and publishes it in the news.
 * @return {?object} The new row, or null.
 */
export function economyAfterDay(state, date, seed, cfg = cfgBundled) {
  if (Number(date.slice(8, 10)) !== cfg.release_day) return null;
  state.economy = state.economy || [];
  const month = monthOf(date);
  if (state.economy.some((r) => r.month === month)) return null;
  const prev = rowsUpTo(state, date, cfg).at(-1);
  if (prev.month >= month) return null;
  // WHY step month by month: a world restored after a gap still gets every month in between, in order.
  let last = prev, row = null;
  for (let m = nextMonth(prev.month); m <= month; m = nextMonth(m)) {
    row = nextRow(last, m, seed, cfg);
    if (m === month) {
      const shown = withShocks(row, state, date);
      const news = publishNews(state, { date, ...economyNews(shown, withShocks(last, state, date)), section: "Money", source: `economy:${month}`, hour: "09:30" });
      if (news) row.news_id = news.id;
    }
    state.economy.push(row);
    last = row;
  }
  return row;
}

/** A row with any active world_settings economy shocks added (what people would see on the day). */
export function withShocks(row, state, date) {
  const out = { ...row };
  const shocks = activeSettings(state, "economy_shocks", date);
  for (const k of INDICATORS) for (const s of shocks) if (typeof s[SHIFTS[k]] === "number") out[k] = round(out[k] + s[SHIFTS[k]], 2);
  return out;
}

/**
 * What the economy does to the shop on a date, with the reasons.
 * @return {{ demand: {all: number}, costs: {goods: number, carrier: number}, price_sensitivity: number, why: Array<object> }}
 */
export function economyEffects(state, date, cfg = cfgBundled) {
  const rows = rowsUpTo(state, date, cfg);
  const E = cfg.effects, ref = startRow(cfg);
  const lagged = (n) => withShocks(rows[Math.max(0, rows.length - 1 - n)], state, date);
  const why = [];

  const c = lagged(E.confidence.lag_months);
  const demand = clamp(1 + E.confidence.demand_per_point * (c.consumer_confidence - ref.consumer_confidence), E.confidence.min, E.confidence.max);
  if (Math.abs(demand - 1) >= 0.001) {
    why.push({ source: "economy", effect: `Overall demand ${pct(demand)}`, size: round(demand, 3),
      because: `Consumer confidence is ${Math.round(c.consumer_confidence)} against ${ref.consumer_confidence} when the business started. People who feel ${demand < 1 ? "worse" : "better"} off ${demand < 1 ? "put off" : "allow themselves"} small treats.` });
  }

  const i = lagged(E.inflation.lag_months);
  const gap = (i.cpi_inflation - ref.cpi_inflation) / 100;
  const goods = clamp(1 + E.inflation.goods_pass_through * gap, E.inflation.min, E.inflation.max);
  const carrier = clamp(1 + E.inflation.carrier_pass_through * gap, E.inflation.min, E.inflation.max);
  if (Math.abs(goods - 1) >= 0.001) {
    why.push({ source: "economy", effect: `Cost of goods ${pct(goods)}, delivery ${pct(carrier)}`, size: round(goods, 3),
      because: `Inflation is ${i.cpi_inflation.toFixed(1)}% against ${ref.cpi_inflation}% at the start; suppliers and carriers pass part of their own rising costs on.` });
  }

  const s = lagged(E.price_sensitivity.lag_months);
  const sens = clamp(1 + E.price_sensitivity.per_unemployment_point * (s.unemployment - ref.unemployment)
    + E.price_sensitivity.per_rate_point * (s.bank_rate - ref.bank_rate), E.price_sensitivity.min, E.price_sensitivity.max);
  if (Math.abs(sens - 1) >= 0.001) {
    why.push({ source: "economy", effect: `Shoppers ${sens > 1 ? "more" : "less"} sensitive to price (${pct(sens)})`, size: round(sens, 3),
      because: `Unemployment is ${s.unemployment.toFixed(1)}% and Bank Rate ${s.bank_rate.toFixed(2)}% (at the start ${ref.unemployment}% and ${ref.bank_rate}%). Worried or squeezed households compare prices harder.` });
  }
  return { demand: { all: demand }, costs: { goods, carrier }, price_sensitivity: sens, why };
}

const pct = (m) => (m >= 1 ? `up ${round((m - 1) * 100, 1)}%` : `down ${round((1 - m) * 100, 1)}%`);
