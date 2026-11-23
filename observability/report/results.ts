/**
 * @fileoverview results.json: the source of truth for a run. Every figure in summary.md and report.html comes from
 * here, and every figure here comes from the simulator's records.
 */
import {audienceResults} from './audiences.ts';
import type {AudienceResults} from './audiences.ts';
import type {RawRun, SeedRun} from '../../simulation/twin-run/run.ts';
import type {Transcript, TranscriptLine} from '../../simulation/twin-run/conversation.ts';
import {jobFor} from '../../simulation/twin-run/jobs.ts';
import {situations as situationDefs, PLAIN} from '../../activity-generation/people/personas.ts';
import {FAILURE_KINDS, checkConversation, heldOf} from './checks.ts';
import type {FailureKind, Held} from './checks.ts';
import {bootstrapMeanInterval, mean, passHatK, round} from './stats.ts';

/** A measure of the business the report compares. */
export interface MeasureDef {
  key: string;
  label: string;
  unit: '£' | '' | '/5' | 'min' | 'h' | 'share';
  better: 'up' | 'down';
}

/**
 * The measures, in the order the report shows them: money first, then customers, then the team. Keys are
 * simulation/simulator/report.mjs headline() fields.
 */
export const MEASURES: readonly MeasureDef[] = [
  {key: 'net_profit', label: 'Net profit', unit: '£', better: 'up'},
  {key: 'revenue', label: 'Revenue', unit: '£', better: 'up'},
  {key: 'refunds', label: 'Refunds', unit: '£', better: 'down'},
  {key: 'staff_task_cost', label: 'Staff time cost', unit: '£', better: 'down'},
  {key: 'orders', label: 'Orders', unit: '', better: 'up'},
  {key: 'customer_satisfaction', label: 'Customer satisfaction', unit: '/5', better: 'up'},
  {key: 'resolution_rate', label: 'Contacts resolved', unit: 'share', better: 'up'},
  {
    key: 'first_response_median_minutes',
    label: 'First response, median',
    unit: 'min',
    better: 'down',
  },
  {key: 'staff_task_hours', label: 'Staff hours on tasks', unit: 'h', better: 'down'},
  {key: 'complaints', label: 'Complaints', unit: '', better: 'down'},
  {key: 'abandoned_contacts', label: 'Contacts nobody answered', unit: '', better: 'down'},
  {key: 'bad_reviews', label: 'Bad reviews', unit: '', better: 'down'},
  {key: 'reputation', label: 'Reputation at the end', unit: '', better: 'up'},
];

/** One measure, with and without, and the paired difference. */
export interface MeasureResult extends MeasureDef {
  without: number | null;
  with: number | null;
  difference: {
    mean: number | null;
    /** Bootstrap 95% interval of the mean paired difference; null with one seed. */
    interval95: [number, number] | null;
    /** The interval leaves out zero. */
    clear: boolean;
    betterIn: number;
    worseIn: number;
    sameIn: number;
  };
  perSeed: {seed: number; difference: number}[];
  worstSeed: {seed: number; difference: number} | null;
}

/** How the product did with customers, from the conversations in the arm with it. */
export interface ProductResult {
  contacts: number;
  passed: number;
  resolvedAlone: number;
  handedOver: number;
  wrongActions: number;
  customersSatisfied: number;
  customersGaveUp: number;
  productErrors: number;
  toolCalls: number;
  refusedCalls: number;
  /** Conversations where a customer called it sorted and the records did not agree (code overruled them). */
  overruledCustomers: number;
  /** pass^k by kind of contact: the chance k such contacts in a row are all sorted. */
  passK: {
    topic: string;
    n: number;
    successes: number;
    pass1: number | null;
    passK: number | null;
    k: number;
  }[];
}

/** The same customer contact in both arms, for the side-by-side view. */
export interface TracePair {
  seed: number;
  key: string;
  topic: string;
  customer: string;
  with: Transcript;
  without: Transcript | null;
}

/** Where `overthink view` serves the apps by default; report links use it. */
export const VIEW_PORT = 8740;

/** The results.json schema name and version. Bump the number on any change that breaks a reader. */
export const RESULTS_SCHEMA = 'overthink.results/2';

/** One thing that went wrong, with everything needed to see it and fix it. */
export interface FailureRecord {
  /** Stable within the file: F1, F2 ... in report order. */
  id: string;
  kind: FailureKind;
  label: string;
  why: string;
  seed: number;
  session: string;
  date: string;
  topic: string;
  channel: string;
  customer: string;
  persona: Transcript['persona'];
  /** Where to see it in the company's apps (a path on the `overthink view` server). */
  link: string | null;
  /** The record it is about (a contact id), for `overthink view --json`. */
  record: string | null;
  /** The whole conversation: customer lines, product lines, tool calls, notes. */
  conversation: TranscriptLine[];
}

/** One attempt to break the product, and whether it held. */
export interface SecurityFinding {
  seed: number;
  session: string;
  situation: string;
  label: string;
  /** What the person tried, in their words. */
  attempt: string;
  held: Held;
  /** What the product did: its calls and its first reply. */
  calls: {name: string; ok: boolean; code: string | null}[];
  reply: string | null;
  failures: FailureKind[];
  link: string | null;
}

/** How each situation went over the run: did the run meet it, and how often did the product get it right. */
export interface SituationResult {
  id: string;
  label: string;
  kind: string;
  /** The assumed rate, from business/data/overthink/situations.json. */
  rate: number;
  contacts: number;
  withFailures: number;
}

/** results.json. */
export interface Results {
  /** The schema of this file (docs/results-schema.md). */
  schema: typeof RESULTS_SCHEMA;
  overthink: {version: string; contract: 1};
  headline: string;
  config: RawRun['options'];
  reproducibility: RawRun['reproducibility'];
  stopped: string | null;
  seconds: number;
  measures: MeasureResult[];
  product: ProductResult;
  tokens: RawRun['tokens'] & {cache_hits: number; cache_misses: number};
  seeds: {
    seed: number;
    without: Record<string, number | null>;
    with: Record<string, number | null>;
  }[];
  traces: TracePair[];
  /** Every failure, worst kinds first (capped at MAX_FAILURES with full conversations; counts are complete). */
  failures: FailureRecord[];
  failureCounts: {kind: FailureKind; label: string; n: number}[];
  security: {
    attempts: number;
    held: number;
    heldByRules: number;
    broke: number;
    findings: SecurityFinding[];
  };
  situations: SituationResult[];
  /** What staff, the public, buyers and suppliers did (observability/report/audiences.ts). */
  audiences: AudienceResults;
  /** How to open the business afterwards. Links in this file are paths on this server. */
  view: {command: string; base: string};
  caveat: string;
}

/** The line every report carries. */
export const CAVEAT = 'Simulated customers, not real ones. Check with real users.';

/** The k in pass^k. Three is small enough to have data in a short run and large enough to show unreliability. */
export const PASS_K = 3;

/** The most trace pairs kept: enough to read, small enough for one HTML file. */
const MAX_TRACES = 40;

/** The most failures kept with their whole conversations. */
const MAX_FAILURES = 80;

/** Builds results.json from a raw run. `outDir` goes into the `overthink view` command shown. */
export function buildResults(raw: RawRun, outDir = 'overthink-report'): Results {
  const measures = MEASURES.map((m) => measure(m, raw.seeds));
  const product = productOf(raw.seeds.flatMap((s) => s.with.client.transcripts));
  const review = reviewOf(raw);
  return {
    schema: RESULTS_SCHEMA,
    overthink: {version: raw.reproducibility.overthink_version, contract: 1},
    headline: brokenProductWarning(product) ?? headlineOf(measures, raw),
    config: raw.options,
    reproducibility: raw.reproducibility,
    stopped: raw.stopped,
    seconds: raw.seconds,
    measures,
    product,
    tokens: {...raw.tokens, cache_hits: raw.cache.hits, cache_misses: raw.cache.misses},
    seeds: raw.seeds.map((s) => ({
      seed: s.seed,
      without: flat(s.without.figures),
      with: flat(s.with.figures),
    })),
    traces: tracesOf(raw.seeds),
    ...review,
    audiences: audienceResults(raw),
    view: {command: `overthink view --run ${outDir}`, base: `http://127.0.0.1:${VIEW_PORT}`},
    caveat: CAVEAT,
  };
}

/** A path into the company's apps for a contact, on the `overthink view` server. */
export function linkFor(
  t: Transcript,
  seed: number,
  arm: 'with' | 'without' = 'with',
): string | null {
  if (t.contactId === null) return null;
  const at = `seed=${seed}&arm=${arm}`;
  if (t.channel === 'email')
    return `/apps/letterbox/?mailbox=hello&thread=${encodeURIComponent(t.contactId)}&${at}`;
  if (t.channel === 'mutter_dm' || t.channel === 'mutter_mention' || t.channel === 'squint_dm')
    return `/apps/${t.channel.startsWith('squint') ? 'squint' : 'mutter'}/?contact=${encodeURIComponent(t.contactId)}&${at}`;
  return `/apps/front-desk/?contact=${encodeURIComponent(t.contactId)}&${at}`;
}

/** Runs the checks over every conversation the product had, and gathers failures, security and situations. */
function reviewOf(
  raw: RawRun,
): Pick<Results, 'failures' | 'failureCounts' | 'security' | 'situations'> {
  const instructions = jobFor(raw.options.job).instructions;
  const failures: FailureRecord[] = [];
  const findings: SecurityFinding[] = [];
  const bySituation = new Map<string, {contacts: number; withFailures: number}>();
  for (const s of raw.seeds) {
    for (const t of s.with.client.transcripts) {
      if (t.ending === 'passed') continue;
      const found = checkConversation(t, instructions);
      const row = bySituation.get(t.persona.situation) ?? {contacts: 0, withFailures: 0};
      row.contacts++;
      if (found.length > 0) row.withFailures++;
      bySituation.set(t.persona.situation, row);
      const link = linkFor(t, s.seed);
      for (const f of found)
        failures.push({
          id: '',
          kind: f.kind,
          label: FAILURE_KINDS[f.kind],
          why: f.why,
          seed: s.seed,
          session: t.session,
          date: t.date,
          topic: t.topic,
          channel: t.channel,
          customer: t.customer,
          persona: t.persona,
          link,
          record: t.contactId,
          conversation: t.lines,
        });
      if (t.persona.kind === 'security') {
        const calls = t.lines.flatMap((l) => (l.call !== undefined ? [l.call] : []));
        findings.push({
          seed: s.seed,
          session: t.session,
          situation: t.persona.situation,
          label: t.persona.label,
          attempt: t.persona.probe.attack ?? t.lines[0]?.text.slice(0, 300) ?? '',
          held: heldOf(found, calls),
          calls: calls.map((c) => ({name: c.name, ok: c.ok, code: c.code})),
          reply: t.lines.find((l) => l.from === 'product')?.text ?? null,
          failures: found.map((f) => f.kind),
          link,
        });
      }
    }
  }
  const order = Object.keys(FAILURE_KINDS) as FailureKind[];
  failures.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.seed - b.seed);
  const counts = order
    .map((kind) => ({
      kind,
      label: FAILURE_KINDS[kind],
      n: failures.filter((f) => f.kind === kind).length,
    }))
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n);
  const kept = failures.slice(0, MAX_FAILURES).map((f, i) => ({...f, id: `F${i + 1}`}));
  const defs = [PLAIN, ...situationDefs()];
  return {
    failures: kept,
    failureCounts: counts,
    security: {
      attempts: findings.length,
      held: findings.filter((f) => f.held === 'held').length,
      heldByRules: findings.filter((f) => f.held === 'held_by_rules').length,
      broke: findings.filter((f) => f.held === 'broke').length,
      findings,
    },
    situations: defs.map((d) => ({
      id: d.id,
      label: d.label,
      kind: d.kind,
      rate: d.rate,
      contacts: bySituation.get(d.id)?.contacts ?? 0,
      withFailures: bySituation.get(d.id)?.withFailures ?? 0,
    })),
  };
}

function measure(def: MeasureDef, seeds: readonly SeedRun[]): MeasureResult {
  const perSeed: {seed: number; difference: number}[] = [];
  const withVals: number[] = [];
  const withoutVals: number[] = [];
  for (const s of seeds) {
    const a = num(s.with.figures[def.key]);
    const b = num(s.without.figures[def.key]);
    if (a === null || b === null) continue;
    withVals.push(a);
    withoutVals.push(b);
    perSeed.push({seed: s.seed, difference: a - b});
  }
  const diffs = perSeed.map((p) => p.difference);
  const interval = bootstrapMeanInterval(diffs);
  const sign = def.better === 'up' ? 1 : -1;
  const worst = perSeed.reduce<{seed: number; difference: number} | null>(
    (w, p) => (w === null || p.difference * sign < w.difference * sign ? p : w),
    null,
  );
  const roundedInterval: [number, number] | null =
    interval === null ? null : [round(interval[0]) ?? 0, round(interval[1]) ?? 0];
  return {
    ...def,
    without: round(mean(withoutVals)),
    with: round(mean(withVals)),
    difference: {
      mean: round(mean(diffs)),
      interval95: roundedInterval,
      clear: interval !== null && (interval[0] > 0 || interval[1] < 0),
      betterIn: diffs.filter((d) => d * sign > 0).length,
      worseIn: diffs.filter((d) => d * sign < 0).length,
      sameIn: diffs.filter((d) => d === 0).length,
    },
    perSeed: perSeed.map((p) => ({seed: p.seed, difference: round(p.difference) ?? 0})),
    worstSeed: worst === null ? null : {seed: worst.seed, difference: round(worst.difference) ?? 0},
  };
}

function productOf(ts: readonly Transcript[]): ProductResult {
  const handled = ts.filter((t) => t.ending !== 'passed');
  const byTopic = new Map<string, {n: number; c: number}>();
  for (const t of handled) {
    const row = byTopic.get(t.topic) ?? {n: 0, c: 0};
    row.n++;
    if (sorted(t)) row.c++;
    byTopic.set(t.topic, row);
  }
  const calls = handled.flatMap((t) =>
    t.lines.filter((l) => l.call !== undefined).map((l) => l.call),
  );
  return {
    contacts: handled.length,
    passed: ts.length - handled.length,
    resolvedAlone: handled.filter((t) => t.verdict === 'resolved').length,
    handedOver: handled.filter((t) => t.verdict === 'handed_over').length,
    wrongActions: handled.filter((t) => t.verdict === 'wrong_action').length,
    customersSatisfied: handled.filter((t) => t.ending === 'satisfied').length,
    customersGaveUp: handled.filter((t) => t.ending === 'gave_up').length,
    productErrors: handled.filter((t) => t.ending === 'product_error').length,
    toolCalls: calls.length,
    refusedCalls: calls.filter((c) => c?.refused === true).length,
    overruledCustomers: handled.filter((t) => t.lines.some((l) => l.overruled === true)).length,
    passK: [...byTopic.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([topic, {n, c}]) => ({
        topic,
        n,
        successes: c,
        pass1: round(passHatK(n, c, 1), 3),
        passK: round(passHatK(n, c, PASS_K), 3),
        k: PASS_K,
      })),
  };
}

/** A contact counts as sorted when the records say resolved or properly handed over and the customer stayed. */
function sorted(t: Transcript): boolean {
  return (
    (t.verdict === 'resolved' || t.verdict === 'handed_over') &&
    t.ending !== 'gave_up' &&
    t.ending !== 'product_error'
  );
}

/** Picks conversations worth reading: one of each kind first, then the ones that went wrong. */
function tracesOf(seeds: readonly SeedRun[]): TracePair[] {
  const all: TracePair[] = [];
  for (const s of seeds) {
    const without = new Map(s.without.client.transcripts.map((t) => [t.key, t]));
    for (const t of s.with.client.transcripts) {
      if (t.ending === 'passed') continue;
      all.push({
        seed: s.seed,
        key: t.key,
        topic: t.topic,
        customer: t.customer,
        with: t,
        without: without.get(t.key) ?? null,
      });
    }
  }
  const picked: TracePair[] = [];
  const seen = new Set<string>();
  const take = (p: TracePair): void => {
    if (picked.length < MAX_TRACES && !picked.includes(p)) picked.push(p);
  };
  for (const p of all) {
    if (!seen.has(p.topic)) {
      seen.add(p.topic);
      take(p);
    }
  }
  for (const p of all) if (!sorted(p.with)) take(p);
  for (const p of all) take(p);
  return picked;
}

/**
 * A headline that replaces the result when the product mostly failed to answer.
 * WHY: a product that errors on every contact changes nothing, and "no difference" would read as a fair verdict on it.
 */
function brokenProductWarning(p: {contacts: number; productErrors: number}): string | null {
  if (p.contacts === 0 || p.productErrors / p.contacts < 0.5) return null;
  return (
    `The product failed on ${p.productErrors} of ${p.contacts} contacts (it could not be reached or gave an answer ` +
    `Overthink could not read), so these results say nothing about it. Run "overthink check" and fix the adapter first.`
  );
}

/** One plain sentence that never claims more than the numbers show. */
function headlineOf(measures: readonly MeasureResult[], raw: RawRun): string {
  const n = raw.seeds.length;
  if (n === 0) return 'No run finished, so there is nothing to compare yet.';
  const get = (k: string): MeasureResult | undefined => measures.find((m) => m.key === k);
  const profit = get('net_profit');
  const csat = get('customer_satisfaction');
  const hours = get('staff_task_hours');
  const parts: string[] = [];
  const runs = `${n} ${n === 1 ? 'run' : 'runs'} of ${raw.options.days} days`;
  if (profit?.difference.mean != null) {
    const d = profit.difference.mean;
    if (profit.perSeed.every((p) => p.difference === 0)) {
      parts.push('exactly the same net profit in every run');
    } else {
      parts.push(
        profit.difference.clear
          ? `net profit ${d >= 0 ? 'rose' : 'fell'} by ${money(Math.abs(d))} on average`
          : `no clear change in net profit (${signedMoney(d)} on average, the interval includes zero)`,
      );
    }
  }
  if (csat?.difference.mean != null && csat.difference.clear) {
    parts.push(
      `customer satisfaction ${csat.difference.mean >= 0 ? 'rose' : 'fell'} by ${Math.abs(csat.difference.mean).toFixed(2)} on a 1 to 5 scale`,
    );
  }
  if (hours?.difference.mean != null && hours.difference.clear) {
    parts.push(
      `staff spent ${Math.abs(hours.difference.mean).toFixed(1)} ${hours.difference.mean < 0 ? 'fewer' : 'more'} hours on tasks`,
    );
  }
  const product = raw.options.adapter;
  return `With ${product}, over ${runs}: ${parts.join('; ')}.`;
}

/** Formats pounds. */
export function money(x: number): string {
  // Pence only where they matter: a short run on a small world moves profit by a few pounds.
  const digits = Math.abs(x) < 100 ? 2 : 0;
  return `£${Math.abs(x).toLocaleString('en-GB', {minimumFractionDigits: digits, maximumFractionDigits: digits})}`;
}

/** Formats a signed amount of pounds. */
export function signedMoney(x: number): string {
  return `${x < 0 ? '−' : '+'}${money(x)}`;
}

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

function flat(figures: Record<string, unknown>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const m of MEASURES) out[m.key] = num(figures[m.key]);
  return out;
}
