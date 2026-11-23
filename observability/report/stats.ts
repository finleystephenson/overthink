/**
 * @fileoverview The statistics in the report: paired differences, a bootstrap interval, and pass^k.
 *
 * WHY a bootstrap and not the t interval in simulation/lab/results.mjs: per-seed differences in money are often skewed (one
 * seed with a big refund), and with few seeds a percentile bootstrap makes fewer assumptions about their shape.
 * It is seeded, so the same results always give the same interval.
 */

/** Returns the mean, or null for no numbers. */
export function mean(xs: readonly number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Returns a percentile bootstrap interval for the mean, or null with fewer than two numbers.
 * @param level The share of resampled means inside the interval (0.95 for a 95% interval).
 */
export function bootstrapMeanInterval(
  xs: readonly number[],
  o: {level?: number; resamples?: number; seed?: number} = {},
): [number, number] | null {
  if (xs.length < 2) return null;
  const level = o.level ?? 0.95;
  const resamples = o.resamples ?? 4000;
  const rand = mulberry32(o.seed ?? 20261122);
  const means = new Float64Array(resamples);
  for (let b = 0; b < resamples; b++) {
    let sum = 0;
    for (let i = 0; i < xs.length; i++) sum += xs[Math.floor(rand() * xs.length)] ?? 0;
    means[b] = sum / xs.length;
  }
  means.sort();
  const tail = (1 - level) / 2;
  const at = (p: number): number =>
    means[Math.min(resamples - 1, Math.max(0, Math.floor(p * resamples)))] ?? 0;
  return [at(tail), at(1 - tail)];
}

/**
 * Returns pass^k: the chance that k tries at the same kind of situation all succeed, given n tries with c
 * successes (Yao et al., tau-bench, 2024). Unbiased: C(c, k) / C(n, k). Null when n is below k.
 */
export function passHatK(n: number, c: number, k: number): number | null {
  if (n < k || k < 1) return null;
  let p = 1;
  for (let i = 0; i < k; i++) p *= (c - i) / (n - i);
  return Math.max(0, p);
}

/** Rounds for display and JSON: money and minutes to 2 places is plenty. */
export function round(x: number | null, places = 2): number | null {
  if (x === null || !Number.isFinite(x)) return null;
  const f = 10 ** places;
  return Math.round(x * f) / f;
}

/** A small, fast, seeded random number generator (Mulberry32). Good enough for resampling. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
