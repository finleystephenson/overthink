// Small statistics for the report: mean, median, percentiles, a 95% confidence interval for a mean, and the return-on-investment sum.
// No dependencies.

const T95 = [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
/** Two-sided 95% t value for df degrees of freedom (the normal 1.96 for large df). */
export const tCrit = (df) => (df < 1 ? NaN : df <= 30 ? T95[df] : df <= 60 ? 2.0 : df <= 120 ? 1.98 : 1.96);

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export function sd(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
/** Linear-interpolated percentile, p from 0 to 1. */
export function percentile(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
export const median = (xs) => percentile(xs, 0.5);
const r = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/**
 * Summary of paired differences (one number per seed: with-tool minus baseline).
 * ci95 is the t interval for the mean; `wide` is true when it still includes zero or is wider than the mean itself.
 */
export function summarise(diffs, d = 2) {
  const xs = diffs.filter((x) => Number.isFinite(x));
  const n = xs.length, m = mean(xs), s = sd(xs);
  let ci95 = null, wide = null;
  if (n >= 2) {
    const h = tCrit(n - 1) * s / Math.sqrt(n);
    ci95 = [r(m - h, d), r(m + h, d)];
    wide = ci95[0] <= 0 && ci95[1] >= 0 ? "includes zero" : h > Math.abs(m) ? "wider than the effect" : null;
  }
  return { n, mean: r(m, d), median: r(median(xs), d), p10: r(percentile(xs, 0.1), d), p90: r(percentile(xs, 0.9), d), sd: r(s, d), ci95, interval_note: n < 2 ? "needs at least 2 seeds" : wide };
}

/**
 * Return on investment = (change in net profit [+ staff time saved x pay, only when countTime] - tool cost) / tool cost.
 * Cash is the default: the money that actually changed. Returns the parts too. With a tool cost of 0 the ratio is null.
 */
export function roi({ cashChange, timeSavedValue = 0, countTime = false, toolCost }) {
  const value = cashChange + (countTime ? timeSavedValue : 0);
  return { value_created: r(value), cash_change: r(cashChange), time_saved_value: r(timeSavedValue), time_counted: !!countTime, tool_cost: r(toolCost), net_value: r(value - toolCost), roi: toolCost > 0 ? r((value - toolCost) / toolCost, 3) : null };
}

/** First day (1-based) on which cumulative value created exceeds cumulative tool cost, or null if it never does. */
export function paybackDay(cumValue, cumCost) {
  for (let i = 0; i < cumValue.length; i++) if (cumValue[i] > cumCost[i]) return i + 1;
  return null;
}
