/**
 * @fileoverview Persona panels: when the product publishes something, a panel of people actually reads it.
 *
 * A Mutter or Squint post, a newsletter sent through Megaphone, or a new or rewritten product page in Till is read by
 * a panel drawn across the simulated population. Each panel member reads it through the developer's model, from their
 * own circumstances and tastes, and decides one thing: ignore, like, reply (in their own words), share, visit, buy,
 * unsubscribe or complain. Code then holds each decision to what is possible, turns the panel's decisions into rates
 * and scales them to everyone the content reached. The maths is in docs/audiences.md; in short:
 *
 *   reach R          code decides it, exactly as the rules do (simulation/simulator/audience.mjs): followers, timing, fatigue, luck.
 *   panel share      n_d / N for each decision d, among N panel members who saw it.
 *   shrunk rate      r_d = (n_d + k * prior_d) / (N + k), with prior_d the rules' own rate and k = PRIOR_STRENGTH.
 *   plausible bound  r_d is clamped to [prior_d / BOUND, prior_d * BOUND]: content can do at most BOUND times better
 *                    or worse than ordinary on any one action.
 *   scaled count     R * r_d (and buy also counts as a visit, as on a real site).
 *
 * WHY a panel instead of one call that guesses totals: a model asked "how many people would like this?" invents a
 * number; a person asked "would you?" answers from a brief, and a spread of briefs gives a spread of answers.
 *
 * WHY behaviour never comes from identity: a panel member's brief holds their circumstances (money, time, how they
 * shop, what is going on in their life) and nothing about who they are. Names are never sent to the model; they are
 * used only to sign the reply records. A test changes every name and checks nothing else changes.
 */
import {createHash} from 'node:crypto';
import {ask, factLines, firstJson, tidyText} from './ask.ts';
import type {PeopleModel} from './ask.ts';

/** What a panel member can do after reading. One decision each: the strongest thing they would do. */
export const DECISIONS = [
  'ignore',
  'like',
  'reply',
  'share',
  'visit',
  'buy',
  'unsubscribe',
  'complain',
] as const;

/** One panel decision. */
export type Decision = (typeof DECISIONS)[number];

/**
 * The default panel size. With N = 40 and k = 40, the standard error of a 25% rate is about 3.4 points after
 * shrinkage (half of sqrt(0.25 * 0.75 / 40) = 6.8), and one member changing their mind moves a rate by
 * 1 / (N + k) = 1.25 points: stable enough to compare two versions of a post on a small local model, at 40 calls an
 * item. docs/audiences.md has the table for other sizes.
 */
export const DEFAULT_PANEL_SIZE = 40;

/** Pseudo-members at the rules' rate added to every panel (Bayesian shrinkage). Equal to the default panel size. */
export const PRIOR_STRENGTH = 40;

/** How far content can move any one rate from ordinary, either way. An assumption, documented in docs/audiences.md. */
export const BOUND = 5;

/** What was published. */
export interface Content {
  kind: 'post' | 'newsletter' | 'product_page';
  /** The record it is (a social post, an email, a product page change). */
  recordId: string;
  network: 'mutter' | 'squint' | null;
  /** Subject and body for a newsletter; headline and description for a product page. */
  text: string;
  image: string | null;
  productName: string | null;
  /** The product's price, for a product page. */
  price: number | null;
}

/** Someone the panel can be drawn from. Only circumstances are kept; the name signs records and nothing else. */
export interface PoolPerson {
  key: string;
  name: string;
  customerId: string | null;
  email: string | null;
  income: string | null;
  online: string | null;
  employment: string | null;
  household: string | null;
  area: string | null;
  circumstances: readonly string[];
}

/** A panel member: a pool person and the lines their brief is made of. */
export interface PanelMember {
  /** P01, P02 ...: the member's place in the panel. */
  slot: string;
  person: PoolPerson;
  lines: [string, string][];
}

/** One member's decision, after code has held it to what is possible. */
export interface PanelVerdict {
  slot: string;
  decision: Decision;
  /** Their words, when they replied or complained. */
  reply: string | null;
  /** What code changed, in plain words. */
  clamped: string[];
}

/** A panel's reading of one item, scaled. */
export interface PanelReading {
  contentHash: string;
  size: number;
  counts: Record<Decision, number>;
  rates: Record<Decision, number>;
  /** Everyone the content reached, times each rate. */
  scaled: Record<Decision, number>;
  verdicts: PanelVerdict[];
}

const MONEY: Readonly<Record<string, string>> = {
  Q1: 'money is tight; every purchase is weighed',
  Q2: 'careful with money',
  Q3: 'comfortable but not careless with money',
  Q4: 'has some spare money',
  Q5: 'money is not a worry',
};

const ONLINE: Readonly<Record<string, string>> = {
  never: 'almost never shops online',
  rarely: 'shops online now and then, unsure of it',
  monthly: 'shops online now and then',
  weekly_plus: 'shops online every week',
};

const LIFE: Readonly<Record<string, string>> = {
  new_parent: 'has a new baby and little spare time',
  carer: 'cares for someone and is often interrupted',
  moving_home: 'is moving home',
  student: 'is a student',
  new_job: 'has just started a new job',
  recently_retired: 'has recently retired and has time to read',
  works_from_home: 'works from home',
  keen_gardener: 'is a keen gardener',
};

const HOUSEHOLD: Readonly<Record<string, string>> = {
  single: 'lives alone',
  couple_no_children: 'lives with a partner',
  couple_with_children: 'lives with a partner and children',
  lone_parent: 'brings up children alone',
  other: 'shares a home',
};

/** The brief lines for a person: circumstances and tastes only. Exported so the identity rule can be tested. */
export function briefLines(p: PoolPerson): [string, string][] {
  const out: [string, string][] = [];
  if (p.income !== null) out.push(['money', MONEY[p.income] ?? 'ordinary means']);
  if (p.online !== null)
    out.push(['shopping_online', ONLINE[p.online] ?? 'shops online sometimes']);
  if (p.employment !== null) out.push(['work', p.employment.replace(/_/g, ' ')]);
  if (p.household !== null) out.push(['home', HOUSEHOLD[p.household] ?? 'shares a home']);
  if (p.area !== null) out.push(['area', `lives in a ${p.area.replace(/_/g, ' ')} area`]);
  const life = p.circumstances.map((c) => LIFE[c]).filter((x): x is string => x !== undefined);
  if (life.length > 0) out.push(['life', life.join('; ')]);
  out.push(['customer_of_the_shop', p.customerId !== null ? 'yes' : 'no']);
  return out;
}

/**
 * Draws a panel across the pool: stratified by money (income fifth) and how often people shop online, so every kind
 * of circumstance is in it in proportion (largest remainder), and within each group by a hash of `key` (the same
 * panel for the same key in every arm and every rerun, never the simulator's random streams).
 */
export function drawPanel(pool: readonly PoolPerson[], size: number, key: string): PanelMember[] {
  const groups = new Map<string, PoolPerson[]>();
  for (const p of pool) {
    const g = `${p.income ?? '-'}|${p.online ?? '-'}`;
    const list = groups.get(g) ?? [];
    list.push(p);
    groups.set(g, list);
  }
  const names = [...groups.keys()].sort();
  const want = apportion(
    names.map((g) => groups.get(g)?.length ?? 0),
    Math.min(size, pool.length),
  );
  const chosen: PoolPerson[] = [];
  names.forEach((g, i) => {
    const list = [...(groups.get(g) ?? [])].sort(
      (a, b) => unit(`${key}|${a.key}`) - unit(`${key}|${b.key}`) || a.key.localeCompare(b.key),
    );
    chosen.push(...list.slice(0, want[i] ?? 0));
  });
  chosen.sort((a, b) => unit(`order|${key}|${a.key}`) - unit(`order|${key}|${b.key}`));
  return chosen.map((person, i) => ({
    slot: `P${String(i + 1).padStart(2, '0')}`,
    person,
    lines: briefLines(person),
  }));
}

/** A short hash of what was published: the same words, picture and product always give the same hash. */
export function contentHash(c: Content): string {
  return createHash('sha256')
    .update(JSON.stringify([c.kind, c.network, c.text, c.image, c.productName, c.price]))
    .digest('hex')
    .slice(0, 16);
}

/** What is possible for each kind of content. */
export function allowedDecisions(kind: Content['kind']): readonly Decision[] {
  switch (kind) {
    case 'post':
      return ['ignore', 'like', 'reply', 'share', 'visit', 'buy', 'complain'];
    case 'newsletter':
      return ['ignore', 'reply', 'share', 'visit', 'buy', 'unsubscribe', 'complain'];
    case 'product_page':
      return ['ignore', 'visit', 'buy', 'complain'];
  }
}

/**
 * Holds a proposed decision to what this content allows. An unknown or impossible decision falls back to the
 * nearest possible one, and says so.
 */
export function clampDecision(
  raw: Record<string, unknown> | null,
  c: Content,
): Omit<PanelVerdict, 'slot'> {
  const clamped: string[] = [];
  const allowed = allowedDecisions(c.kind);
  const said = typeof raw?.['decision'] === 'string' ? raw['decision'].toLowerCase().trim() : '';
  let decision: Decision = 'ignore';
  if (raw === null) clamped.push('the model’s answer was not readable JSON');
  else if ((DECISIONS as readonly string[]).includes(said)) decision = said as Decision;
  else clamped.push(`"${said.slice(0, 20)}" is not a decision`);
  if (!allowed.includes(decision)) {
    const instead: Decision =
      decision === 'unsubscribe'
        ? 'ignore'
        : decision === 'like' || decision === 'reply'
          ? 'visit'
          : 'ignore';
    clamped.push(
      `${decision} is not possible on a ${c.kind.replace('_', ' ')}; counted as ${instead}`,
    );
    decision = allowed.includes(instead) ? instead : 'ignore';
  }
  // Buying needs something to buy: a post or newsletter that names no product sends people to the shop instead.
  if (decision === 'buy' && c.productName === null && c.kind !== 'newsletter') {
    clamped.push('nothing to buy in it; counted as a visit');
    decision = 'visit';
  }
  let reply: string | null = null;
  if (decision === 'reply' || decision === 'complain') {
    const words = tidyText(raw?.['reply'], c.network === 'mutter' ? 280 : 1000);
    if (words === '' && decision === 'reply') {
      clamped.push('a reply with no words; counted as a like');
      decision = allowed.includes('like') ? 'like' : 'ignore';
    } else reply = words === '' ? null : words;
  }
  return {decision, reply, clamped};
}

/** How a member is asked: who they are, then the content as they would meet it. */
export function panelRequest(m: PanelMember, c: Content): Parameters<typeof ask>[1] {
  const allowed = allowedDecisions(c.kind);
  const system = [
    'You are one ordinary person, described below, going about your day. You are not an assistant.',
    'Decide honestly what you would do on meeting this, as this person. Most people ignore most things.',
    '',
    factLines([...m.lines, ['content', c.kind]]),
    '',
    'Answer with one JSON object and nothing else:',
    `{"decision": ${allowed.map((d) => `"${d}"`).join('|')}, "reply": "your words if you reply or complain, else empty", "why": "a few words"}`,
  ].join('\n');
  return {
    purpose: 'panel',
    system,
    messages: [{role: 'user', content: contentAsSeen(c)}],
    maxTokens: 160,
    temperature: 0.7,
    json: true,
  };
}

/** The content as a person meets it: in their feed, their inbox, or on the shop's page. */
export function contentAsSeen(c: Content): string {
  switch (c.kind) {
    case 'post':
      return `In your ${c.network ?? 'social'} feed, a post from Overthought & Co. (@overthoughtco), a small online shop${c.image !== null ? ', with a product photo' : ''}:\n\n${c.text}`;
    case 'newsletter':
      return `In your email inbox, from Overthought & Co. (you bought from them once and agreed to hear from them):\n\n${c.text}`;
    case 'product_page':
      return `You are on Overthought & Co.'s website, looking at a product page${c.price !== null ? ` (price £${c.price.toFixed(2)})` : ''}:\n\n${c.text}`;
  }
}

/** Has every member read the content and decide. Calls are cached by their whole content. */
export async function readContent(
  model: PeopleModel,
  panel: readonly PanelMember[],
  c: Content,
): Promise<PanelVerdict[]> {
  const out: PanelVerdict[] = [];
  // One at a time: a local model serves one request at a time anyway, and the budget is checked before each call.
  for (const m of panel) {
    const text = await ask(model, panelRequest(m, c));
    out.push({slot: m.slot, ...clampDecision(firstJson(text), c)});
  }
  return out;
}

/** Counts of each decision. */
export function countDecisions(verdicts: readonly PanelVerdict[]): Record<Decision, number> {
  const counts = zero();
  for (const v of verdicts) counts[v.decision]++;
  return counts;
}

/** Shrinks the panel's shares toward the rules' rates and clamps them to the plausible bounds (see the file comment). */
export function estimateRates(
  counts: Record<Decision, number>,
  n: number,
  prior: Record<Decision, number>,
  k = PRIOR_STRENGTH,
): Record<Decision, number> {
  const rates = zero();
  for (const d of DECISIONS) {
    if (d === 'ignore') continue;
    const p = prior[d];
    const shrunk = (counts[d] + k * p) / (n + k);
    rates[d] = p > 0 ? Math.min(p * BOUND, Math.max(p / BOUND, shrunk)) : 0;
  }
  rates.ignore = Math.max(
    0,
    1 - DECISIONS.reduce((s, d) => s + (d === 'ignore' ? 0 : rates[d]), 0),
  );
  return rates;
}

/** Scales rates to everyone reached. A buyer also visited, so visits include them. */
export function scaleRates(
  rates: Record<Decision, number>,
  reach: number,
): Record<Decision, number> {
  const out = zero();
  for (const d of DECISIONS) out[d] = round3(rates[d] * reach);
  out.visit = round3((rates.visit + rates.buy) * reach);
  return out;
}

/** Reads, counts, estimates and scales: one panel's verdict on one item. */
export async function panelReading(o: {
  model: PeopleModel;
  panel: readonly PanelMember[];
  content: Content;
  prior: Record<Decision, number>;
  reach: number;
}): Promise<PanelReading> {
  const verdicts = await readContent(o.model, o.panel, o.content);
  const counts = countDecisions(verdicts);
  const rates = estimateRates(counts, verdicts.length, o.prior);
  return {
    contentHash: contentHash(o.content),
    size: verdicts.length,
    counts,
    rates,
    scaled: scaleRates(rates, o.reach),
    verdicts,
  };
}

/** All decisions at zero. */
export function zero(): Record<Decision, number> {
  return {ignore: 0, like: 0, reply: 0, share: 0, visit: 0, buy: 0, unsubscribe: 0, complain: 0};
}

/** Splits `total` over shares so the counts add up exactly (largest remainder; ties to the earlier share). */
export function apportion(shares: readonly number[], total: number): number[] {
  const sum = shares.reduce((a, b) => a + b, 0);
  if (sum === 0) return shares.map(() => 0);
  const raw = shares.map((s) => (s / sum) * total);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => [r - Math.floor(r), i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) {
    const idx = order[i]?.[1] ?? 0;
    out[idx] = (out[idx] ?? 0) + 1;
  }
  return out;
}

function unit(s: string): number {
  return parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16) / 2 ** 32;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
