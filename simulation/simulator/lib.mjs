// Shared helpers for the simulator: dates, random streams, and the number of arrivals in a day.
import { rngFor } from "../../business/builder/world/rng.mjs";

export const DAY = 86400000;
export const dateOf = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (s, n) => dateOf(Date.parse(s + "T00:00:00Z") + n * DAY);
export const weekdayOf = (s) => new Date(s + "T00:00:00Z").getUTCDay(); // 0 = Sunday
export const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const round2 = (x) => Math.round(x * 100) / 100;

/**
 * One named random stream per purpose, from the run's seed tree: streams(seed)("arrivals", day) is always the same sequence.
 * Streams are keyed by business facts (day, customer, order key), never by "how many things happened before", so the
 * with-tool run draws the same numbers as the baseline for the same event. A tool's own behaviour never draws from them.
 */
export const makeStreams = (seed) => (purpose, ...keys) => rngFor(seed, purpose, ...keys);

/** Inverse normal CDF (Acklam's approximation), for large expected counts. */
export function normalQuantile(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - lo) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, t = q * q;
  return (((((a[0] * t + a[1]) * t + a[2]) * t + a[3]) * t + a[4]) * t + a[5]) * q / (((((b[0] * t + b[1]) * t + b[2]) * t + b[3]) * t + b[4]) * t + 1);
}

/**
 * Count of arrivals for expected rate lambda from ONE uniform u (so the same u gives a bigger count when lambda is bigger:
 * the baseline and with-tool runs stay coupled). Exact for small lambda, normal approximation above 60.
 */
export function poissonFromUniform(lambda, u) {
  if (lambda <= 0) return 0;
  if (lambda > 60) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normalQuantile(Math.min(1 - 1e-9, Math.max(1e-9, u)))));
  let k = 0, p = Math.exp(-lambda), cum = p;
  while (u > cum && k < 1000) { k++; p *= lambda / k; cum += p; }
  return k;
}

/** Keeps a list of the top-k items by score; memory stays bounded however long the run. */
export function topK(k, score) {
  const items = [];
  return { add(x) { items.push(x); items.sort((a, b) => score(b) - score(a)); if (items.length > k) items.pop(); }, items };
}

/**
 * Relative chance of an order in each hour of the day (UTC, as the clock runs). WHY this shape: online shops are quiet
 * overnight, build through the morning, peak at lunchtime and again in the evening (about 8 to 9pm). Rough figures
 * from the usual UK retail pattern; an assumption, not a measurement of this shop.
 */
export const ORDER_HOUR_WEIGHTS = [0.3, 0.2, 0.15, 0.1, 0.1, 0.2, 0.4, 0.8, 1.2, 1.4, 1.5, 1.6, 2.0, 2.0, 1.6, 1.4, 1.4, 1.5, 1.8, 2.3, 2.5, 2.2, 1.5, 0.8];

/**
 * Turns one uniform draw (0 to 1) into a minute of the day (0 to 1439) following ORDER_HOUR_WEIGHTS.
 * @param {number} u
 * @return {number}
 */
export function orderMinute(u) {
  const total = ORDER_HOUR_WEIGHTS.reduce((a, b) => a + b, 0);
  let x = Math.min(0.999999, Math.max(0, u)) * total;
  for (let h = 0; h < 24; h++) {
    if (x < ORDER_HOUR_WEIGHTS[h]) return Math.min(1439, h * 60 + Math.floor((x / ORDER_HOUR_WEIGHTS[h]) * 60));
    x -= ORDER_HOUR_WEIGHTS[h];
  }
  return 1439;
}
