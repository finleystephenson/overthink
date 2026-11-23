// People with real-world circumstances: the browser-safe half (no files read here).
// Traits live in business/data/population.json, built by simulation/world/build-population.mjs from UK statistics. This file turns a
// person into traits (traitsFor) and traits into hidden-behaviour multipliers for simulation/simulator/customers.mjs (behaviourFrom).
//
// THE RULE: behaviour comes from CIRCUMSTANCES (money, time, digital comfort), never from identity. A person's
// book, name, role in the story, or kind of character never reaches this file. Every effect below is a small,
// documented assumption with a reason, and every multiplier is clamped.
import { rngFor } from "../../business/builder/world/rng.mjs";

/** The stable key for a person: their name, lower-cased and dotted. Names are unique in business/data/characters.json
 * (checked by the build), and the same slug is what the world's e-mail addresses use. The simulator's own e-mail
 * for a character carries a position number (".x12") that changes with the population size, so it can't be the key. */
export function personKey(name) {
  return String(name).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
}

/**
 * Splits `total` people over shares so the counts add up exactly (largest remainder; ties go to the earlier item).
 * @param {number[]} shares Any positive numbers (they are normalised).
 * @param {number} total
 * @return {number[]} Whole counts summing to total.
 */
export function apportion(shares, total) {
  const sum = shares.reduce((a, b) => a + b, 0);
  const raw = shares.map((s) => (s / sum) * total);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) out[order[i][1]]++;
  return out;
}

/** A standard normal number from a random stream (Box-Muller). */
export function normalFrom(r) { return Math.sqrt(-2 * Math.log(Math.max(1e-12, r.next()))) * Math.cos(2 * Math.PI * r.next()); }

/** Income score: noise plus a small shift for employment and household. Ranking on it gives exact fifths. */
export function incomeScore(sources, employment, household, noise) {
  const s = sources.income_score_shift;
  return noise + (s.employment[employment] ?? 0) + (s.household[household] ?? 0);
}

/** Who is more likely to have a circumstance: the product of the weights that apply (0 means cannot). */
export function circumstanceWeight(spec, t) {
  if (spec.derived) return 0;
  let w = 1;
  for (const [trait, table] of Object.entries(spec.weights || {})) {
    const value = trait === "age" ? t.age : trait === "household" ? t.household : trait === "employment" ? t.employment : t.area;
    // The table says who CAN have it; a value with no entry gets the table's _default, or 0 (cannot) if none.
    w *= table[value] ?? table._default ?? 0;
  }
  return w;
}

/** Picks an index from shares with one uniform number. */
function pickShare(shares, u) {
  const sum = shares.reduce((a, b) => a + b, 0);
  let x = u * sum;
  for (let i = 0; i < shares.length; i++) { x -= shares[i]; if (x < 0) return i; }
  return shares.length - 1;
}

/**
 * Traits for someone who is not in the built population (a made-up extra customer): independent draws from the
 * same targets, so they look like the rest. Deterministic from the person's key. The marginals are only
 * approximate for a handful of extras (they are random draws, not quotas).
 * @param {string} key personKey(name)
 * @param {object} population The loaded business/data/population.json.
 * @return {object} Traits (same shape as a built person, with known: false).
 */
export function drawTraits(key, population) {
  const S = population.targets, r = rngFor(population.seed, "extra", key);
  const age = S.age.bands[pickShare(S.age.share, r.next())];
  const household = S.household.types[pickShare(S.household.by_age_share[age], r.next())];
  const employment = S.employment.statuses[pickShare(S.employment.by_age_share[age], r.next())];
  const area = S.area.types[pickShare(S.area.share, r.next())];
  const online = S.online_shopping.bands[pickShare(S.online_shopping.by_age_share[age], r.next())];
  const channel = S.channel.options[pickShare(S.channel.by_age_share[age], r.next())];
  const score = incomeScore(S, employment, household, normalFrom(r));
  let q = 0;
  while (q < population.income_cuts.length && score > population.income_cuts[q]) q++;
  const t = { age, household, income: S.income.quintiles[q], employment, area, online, channel, circumstances: [], known: false };
  for (const [name, spec] of Object.entries(S.circumstances)) {
    if (name.startsWith("_") || spec.derived) continue;
    const p = Math.min(1, (population.circumstance_scale[name] || 0) * circumstanceWeight(spec, t));
    if (r.next() < p) t.circumstances.push(name);
  }
  if (employment === "student") t.circumstances.push("student");
  return t;
}

/**
 * The traits of one person.
 * @param {{name: string}} person Anything with a name.
 * @param {?object} population The loaded business/data/population.json, or null.
 * @return {?object} Traits, or null when no population is loaded. Extras not in the file get drawn traits (known: false).
 */
export function traitsFor(person, population) {
  if (!population || !person?.name) return null;
  const key = personKey(person.name);
  const hit = population.people[key];
  if (hit) return hit;
  return drawTraits(key, population);
}

// ---------------------------------------------------------------------------------------------------------------
// Behaviour. Each rule: who it applies to, what it changes, by how much, and WHY.

/** Documented assumptions. Reported by the report script so nothing is hidden. */
export const BEHAVIOUR_ASSUMPTIONS = [
  { effect: "price sensitivity", rule: "income Q1 x1.25, Q2 x1.12, Q3 x1.00, Q4 x0.92, Q5 x0.85", why: "Less money left over means a price rise is felt more. Direction is well established; the size is ours." },
  { effect: "price sensitivity", rule: "lone parent x1.08, couple with children x1.05, unemployed or student x1.05", why: "More people to pay for, or an income gap, narrows the budget further." },
  { effect: "patience", rule: "retired x1.15, works from home x1.05, employed (not at home) x0.95", why: "Patience here is how long someone waits for an answer. Time at home and no deadline means longer; a day at work means shorter." },
  { effect: "patience", rule: "new parent x0.85, carer x0.9", why: "Little spare time and attention. Assumption." },
  { effect: "buying rate", rule: "online shopping: never x0.5, rarely x0.8, monthly x1.0, weekly or more x1.3", why: "Someone who rarely buys online buys from an online shop less often. Mild on purpose." },
  { effect: "channel", rule: "the preferred channel trait (email, chat, phone) passes straight through", why: "Drawn by age from channel table; older people lean to the phone." },
  { effect: "contact time", rule: "working away from home: 18:00 to 22:00; works from home: 09:00 to 17:00; retired: 09:00 to 13:00; student: 20:00 to 24:00; new parent: 20:00 to 23:00; otherwise 10:00 to 16:00", why: "People write when they have a spare moment, which follows their day." },
  { effect: "category demand", rule: "new parent: everyday x1.3, food x1.15; moving home: desk-home x1.4, everyday x1.2; carer: everyday x1.1, food x1.1; student: tech x1.2, desk-home x1.2, carry x1.2; new job: carry x1.3, desk-home x1.15; recently retired: outdoors x1.2, food x1.1; works from home: desk-home x1.35, tech x1.15; keen gardener: outdoors x1.5", why: "What a life event makes people need. Sizes are ours; categories are the shop's (carry, desk-home, everyday, food, outdoors, tech)." },
];

const PRICE_BY_INCOME = { Q1: 1.25, Q2: 1.12, Q3: 1.0, Q4: 0.92, Q5: 0.85 };
const RATE_BY_ONLINE = { never: 0.5, rarely: 0.8, monthly: 1.0, weekly_plus: 1.3 };
const CATEGORY_BOOST = {
  new_parent: { everyday: 1.3, food: 1.15 },
  moving_home: { "desk-home": 1.4, everyday: 1.2 },
  carer: { everyday: 1.1, food: 1.1 },
  student: { tech: 1.2, "desk-home": 1.2, carry: 1.2 },
  new_job: { carry: 1.3, "desk-home": 1.15 },
  recently_retired: { outdoors: 1.2, food: 1.1 },
  works_from_home: { "desk-home": 1.35, tech: 1.15 },
  keen_gardener: { outdoors: 1.5 },
};
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round3 = (x) => Math.round(x * 1000) / 1000;

/** The hours (24-hour clock) when this person usually writes or calls. */
function contactWindow(t, has) {
  if (has("new_parent")) return [20, 23];
  if (t.employment === "student") return [20, 24];
  if (t.employment === "retired") return [9, 13];
  if (has("works_from_home")) return [9, 17];
  if (t.employment === "employed" || t.employment === "self_employed") return [18, 22];
  return [10, 16];
}

/**
 * Multipliers on the hidden behaviour in simulation/simulator/customers.mjs. Pure: same traits, same answer. Never reads identity.
 * @param {?object} t Traits from traitsFor (null gives all-neutral).
 * @return {{price: number, patience: number, rate: number, channel: ?string, contact_window: number[], categories: object}}
 */
export function behaviourFrom(t) {
  if (!t) return { price: 1, patience: 1, rate: 1, channel: null, contact_window: [10, 16], categories: {} };
  const has = (c) => t.circumstances.includes(c);
  let price = PRICE_BY_INCOME[t.income] ?? 1;
  if (t.household === "lone_parent") price *= 1.08;
  if (t.household === "couple_children") price *= 1.05;
  if (t.employment === "unemployed" || t.employment === "student") price *= 1.05;
  let patience = 1;
  if (t.employment === "retired") patience *= 1.15;
  if (has("works_from_home")) patience *= 1.05;
  else if (t.employment === "employed") patience *= 0.95;
  if (has("new_parent")) patience *= 0.85;
  if (has("carer")) patience *= 0.9;
  const categories = {};
  for (const c of t.circumstances) for (const [cat, m] of Object.entries(CATEGORY_BOOST[c] || {})) categories[cat] = round3((categories[cat] ?? 1) * m);
  for (const cat of Object.keys(categories)) categories[cat] = clamp(categories[cat], 0.8, 2);
  return {
    price: round3(clamp(price, 0.7, 1.5)),
    patience: round3(clamp(patience, 0.7, 1.4)),
    rate: round3(clamp(RATE_BY_ONLINE[t.online] ?? 1, 0.5, 1.5)),
    channel: t.channel,
    contact_window: contactWindow(t, has),
    categories,
  };
}
