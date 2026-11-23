/**
 * @fileoverview `overthink run --compare A B`: two products (or two versions, or one product with two access levels)
 * on the same seeds and the same people, with each one's own results and the paired differences between them.
 *
 * Each variant runs as a normal twin run, so each has its difference against the business without it. Because both
 * use the same seeds, the same population and the same cache, the arm without a product is identical for both, and
 * (B with) minus (A with) on the same seed is a paired difference: the luck cancels, as it does for with and without.
 *
 * WHY no verdict or advice: the file says what was measured; which product is better for someone depends on what
 * they care about.
 */
import type {LoadedAdapter} from '../../integrations/adapter/load.ts';
import {adapterLabel} from '../../integrations/adapter/load.ts';
import {MEASURES, buildResults, CAVEAT} from '../../observability/report/results.ts';
import type {MeasureDef, Results} from '../../observability/report/results.ts';
import {bootstrapMeanInterval, mean, round} from '../../observability/report/stats.ts';
import {runOverthink} from './run.ts';
import type {RawRun, RunOptions} from './run.ts';

/** The schema of compare.json. */
export const COMPARE_SCHEMA = 'overthink.compare/1';

/** One measure, B against A, paired by seed. */
export interface PairedMeasure extends MeasureDef {
  a: number | null;
  b: number | null;
  /** The mean over seeds of (B minus A). */
  difference: number | null;
  interval95: [number, number] | null;
  /** The interval leaves out zero. */
  clear: boolean;
  /** Seeds where B came out better, worse, the same (by the measure's `better` direction). */
  bBetterIn: number;
  bWorseIn: number;
  sameIn: number;
  perSeed: {seed: number; a: number; b: number; difference: number}[];
}

/** compare.json. */
export interface CompareResults {
  schema: typeof COMPARE_SCHEMA;
  config: {days: number; runs: number; size: string; job: string; seeds: number[]};
  variants: {
    id: 'A' | 'B';
    adapter: string;
    access: string | null;
    scope: {read: string[]; act: string[]} | null;
    channels: string[] | null;
    audience: string[];
    /** This variant's own results.json, relative to the compare folder. */
    results: string;
    /** Each measure: without (the same for both), with, and the mean paired difference against without. */
    measures: {
      key: string;
      without: number | null;
      with: number | null;
      difference: number | null;
      clear: boolean;
    }[];
    product: Results['product'];
    failures: number;
    securityBroke: number;
  }[];
  paired: PairedMeasure[];
  caveat: string;
}

/** Runs both variants and builds compare.json. Returns each variant's results too, for writing. */
export async function runCompare(
  a: LoadedAdapter,
  b: LoadedAdapter,
  o: Omit<RunOptions, 'adapter' | 'variant' | 'openTransport'>,
): Promise<{compare: CompareResults; raws: [RawRun, RawRun]; results: [Results, Results]}> {
  const rawA = await runOverthink({...o, adapter: a, variant: 'A'});
  const rawB = await runOverthink({...o, adapter: b, variant: 'B'});
  const resA = buildResults(rawA, 'A');
  const resB = buildResults(rawB, 'B');
  return {compare: compareResults([a, b], [resA, resB]), raws: [rawA, rawB], results: [resA, resB]};
}

/** compare.json from the two variants' results. Pure. */
export function compareResults(
  adapters: [LoadedAdapter, LoadedAdapter],
  r: [Results, Results],
): CompareResults {
  const [ra, rb] = r;
  const seeds = ra.reproducibility.seeds.filter((s) => rb.reproducibility.seeds.includes(s));
  const variant = (
    id: 'A' | 'B',
    ad: LoadedAdapter,
    res: Results,
  ): CompareResults['variants'][number] => ({
    id,
    adapter: adapterLabel(ad),
    access: ad.config.access ?? null,
    scope: ad.config.scope ?? null,
    channels: res.config.channels,
    audience: res.config.audience,
    results: `${id}/results.json`,
    measures: res.measures.map((m) => ({
      key: m.key,
      without: m.without,
      with: m.with,
      difference: m.difference.mean,
      clear: m.difference.clear,
    })),
    product: res.product,
    failures: res.failureCounts.reduce((n, c) => n + c.n, 0),
    securityBroke: res.security.broke,
  });
  return {
    schema: COMPARE_SCHEMA,
    config: {
      days: ra.config.days,
      runs: ra.config.runs,
      size: ra.config.size,
      job: ra.config.job,
      seeds,
    },
    variants: [variant('A', adapters[0], ra), variant('B', adapters[1], rb)],
    paired: MEASURES.map((m) => paired(m, ra, rb, seeds)),
    caveat: CAVEAT,
  };
}

function paired(m: MeasureDef, ra: Results, rb: Results, seeds: readonly number[]): PairedMeasure {
  const perSeed: PairedMeasure['perSeed'] = [];
  for (const seed of seeds) {
    const a = ra.seeds.find((s) => s.seed === seed)?.with[m.key];
    const b = rb.seeds.find((s) => s.seed === seed)?.with[m.key];
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    perSeed.push({seed, a, b, difference: b - a});
  }
  const diffs = perSeed.map((p) => p.difference);
  const interval = bootstrapMeanInterval(diffs);
  const sign = m.better === 'up' ? 1 : -1;
  return {
    ...m,
    a: round(mean(perSeed.map((p) => p.a))),
    b: round(mean(perSeed.map((p) => p.b))),
    difference: round(mean(diffs)),
    interval95: interval === null ? null : [round(interval[0]) ?? 0, round(interval[1]) ?? 0],
    clear: interval !== null && (interval[0] > 0 || interval[1] < 0),
    bBetterIn: diffs.filter((d) => d * sign > 1e-9).length,
    bWorseIn: diffs.filter((d) => d * sign < -1e-9).length,
    sameIn: diffs.filter((d) => Math.abs(d) <= 1e-9).length,
    perSeed,
  };
}

/** compare.md: the paired figures as a table a coding agent can paste. Facts only. */
export function compareMarkdown(c: CompareResults): string {
  const [a, b] = c.variants;
  const lines = [
    `# Overthink compare: B against A (${c.config.job}, ${c.config.days} days, ${c.config.seeds.length} paired runs)`,
    '',
    `- A: ${a?.adapter ?? ''}${a?.access !== null && a?.access !== undefined ? `, access ${a.access}` : ''}`,
    `- B: ${b?.adapter ?? ''}${b?.access !== null && b?.access !== undefined ? `, access ${b.access}` : ''}`,
    '',
    '| Measure | A | B | B − A | 95% interval | B better in |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const p of c.paired) {
    if (p.difference === null) continue;
    const iv = p.interval95 === null ? 'n/a' : `${p.interval95[0]} to ${p.interval95[1]}`;
    lines.push(
      `| ${p.label} | ${p.a ?? 'n/a'} | ${p.b ?? 'n/a'} | ${p.difference} | ${iv} | ${p.bBetterIn} of ${p.perSeed.length} |`,
    );
  }
  lines.push(
    '',
    `Failures found: A ${a?.failures ?? 0}, B ${b?.failures ?? 0}. Security attempts that broke: A ${a?.securityBroke ?? 0}, B ${b?.securityBroke ?? 0}.`,
    '',
    c.caveat,
    '',
  );
  return lines.join('\n');
}
