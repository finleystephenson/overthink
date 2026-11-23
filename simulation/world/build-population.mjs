// Gives every character real-world circumstances drawn from UK adult statistics, and links people who might know
// each other. Writes business/data/population.json. Run: node simulation/world/build-population.mjs [--seed 1]
//
// WHY QUOTAS, NOT DRAWS: with 3,077 people, independent random draws would drift a point or two from the targets.
// Instead each trait is dealt out by exact counts (largest remainder) from a shuffle, so the whole population
// matches the targets, and the dependencies (employment and household by age, income by employment and household)
// come from conditional tables.
//
// WHY INDEPENDENT OF THE STORY: every shuffle is ordered by a hash of (seed, trait, person key). Nothing about the
// character's book, name meaning, kind, author or era is read when dealing traits. So a villain is no more likely to
// be poor or old than a hero, and nobody's age comes from their story. The report checks this (Cramer's V).
// Only the links (household, neighbour, friend) use the book and address, because "who could know whom" is exactly
// what those say; they do not change anyone's traits.
//
// WHY THE KEY IS THE SLUG OF THE NAME: names are unique in business/data/characters.json (the build refuses duplicates) and
// stay the same when the population size changes; the simulator's e-mail for a character includes a position
// number, so it is not stable.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashString, rngFor } from "../../business/builder/world/rng.mjs";
import { personKey, apportion, normalFrom, incomeScore, circumstanceWeight } from "./population.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..", "..");
const MAX_TIES = 6;

/** Orders items by a hash of seed, trait and key: a repeatable shuffle that knows nothing about the character. */
function shuffled(items, seed, trait, keyOf) {
  return items.map((x) => [hashString(`${seed}|${trait}|${keyOf(x)}`), x]).sort((a, b) => a[0] - b[0] || (keyOf(a[1]) < keyOf(b[1]) ? -1 : 1)).map((p) => p[1]);
}

/** Deals `values` to `people` (already shuffled) with the exact counts the shares give. */
function deal(people, values, shares, assign) {
  const counts = apportion(shares, people.length);
  let i = 0;
  counts.forEach((n, v) => { for (let k = 0; k < n; k++) assign(people[i++], values[v]); });
}

/** Deals a trait whose shares depend on age band, inside each band. */
function dealByAge(people, seed, trait, values, tableByAge, setter) {
  for (const age of Object.keys(tableByAge)) {
    const inBand = shuffled(people.filter((p) => p.t.age === age), seed, trait, (p) => p.key);
    deal(inBand, values, tableByAge[age], (p, v) => setter(p.t, v));
  }
}

/**
 * Builds the population.
 * @param {Array<{name: string, from?: string, town?: string, address_line?: string, home?: string}>} characters
 * @param {object} sources simulation/world/population-sources.json
 * @param {{seed?: number}} o
 * @return {object} The business/data/population.json content.
 */
export function buildPopulation(characters, sources, { seed = 1 } = {}) {
  const people = characters.map((c) => ({ key: personKey(c.name), c, t: {} }));
  if (new Set(people.map((p) => p.key)).size !== people.length) throw new Error("Two characters share a person key; names must be unique.");
  const S = sources;

  deal(shuffled(people, seed, "age", (p) => p.key), S.age.bands, S.age.share, (p, v) => { p.t.age = v; });
  dealByAge(people, seed, "household", S.household.types, S.household.by_age_share, (t, v) => { t.household = v; });
  dealByAge(people, seed, "employment", S.employment.statuses, S.employment.by_age_share, (t, v) => { t.employment = v; });
  dealByAge(people, seed, "online", S.online_shopping.bands, S.online_shopping.by_age_share, (t, v) => { t.online = v; });
  dealByAge(people, seed, "channel", S.channel.options, S.channel.by_age_share, (t, v) => { t.channel = v; });
  deal(shuffled(people, seed, "area", (p) => p.key), S.area.types, S.area.share, (p, v) => { p.t.area = v; });

  const income_cuts = dealIncome(people, seed, S);
  const circumstance_scale = dealCircumstances(people, seed, S);
  addTies(people, seed);

  const out = {};
  for (const p of people) {
    out[p.key] = { name: p.c.name, book: p.c.from || null, town: p.c.town || null, ...p.t, ties: p.ties || [] };
  }
  return { version: 1, seed, count: people.length, generated_by: "simulation/world/build-population.mjs", targets: sources, income_cuts, circumstance_scale, people: out };
}

/** Income: rank everyone on a score (noise + small shifts), cut into exact fifths. Returns the 4 score cut points. */
function dealIncome(people, seed, S) {
  for (const p of people) p.score = incomeScore(S, p.t.employment, p.t.household, normalFrom(rngFor(seed, "income", p.key)));
  const ranked = people.slice().sort((a, b) => a.score - b.score || (a.key < b.key ? -1 : 1));
  const counts = apportion(S.income.share, ranked.length);
  const cuts = [];
  let i = 0;
  counts.forEach((n, q) => {
    for (let k = 0; k < n; k++) ranked[i++].t.income = S.income.quintiles[q];
    if (q < counts.length - 1) cuts.push((ranked[i - 1].score + ranked[i].score) / 2);
  });
  for (const p of people) delete p.score;
  return cuts.map((x) => Math.round(x * 1e6) / 1e6);
}

/** Circumstances: exactly round(prevalence x N) people each, chosen with weighted sampling (Efraimidis-Spirakis). */
function dealCircumstances(people, seed, S) {
  const scale = {};
  for (const p of people) p.t.circumstances = [];
  for (const [name, spec] of Object.entries(S.circumstances)) {
    if (name.startsWith("_")) continue;
    if (spec.derived) { for (const p of people) if (p.t.employment === "student") p.t.circumstances.push(name); continue; }
    const pool = people.map((p) => ({ p, w: circumstanceWeight(spec, p.t) })).filter((x) => x.w > 0);
    const want = Math.min(pool.length, Math.round(spec.prevalence * people.length));
    const sumW = pool.reduce((a, x) => a + x.w, 0);
    scale[name] = sumW ? want / sumW : 0;
    const keyed = pool.map((x) => ({ ...x, k: Math.pow(Math.max(1e-12, rngFor(seed, "circ", name, x.p.key).next()), 1 / x.w) }));
    keyed.sort((a, b) => b.k - a.k || (a.p.key < b.p.key ? -1 : 1));
    for (const x of keyed.slice(0, want)) x.p.t.circumstances.push(name);
  }
  return scale;
}

const street = (line) => String(line || "").replace(/^\s*\d+[a-z]?\s+/i, "").toLowerCase();

/** Household members (same address), neighbours (same street in the same book and town), friends (same book, similar age). */
function addTies(people, seed) {
  const link = (a, b, type) => {
    if (a === b) return;
    a.ties ??= []; b.ties ??= [];
    if (a.ties.length >= MAX_TIES || b.ties.length >= MAX_TIES || a.ties.some((t) => t[0] === b.key)) return;
    a.ties.push([b.key, type]); b.ties.push([a.key, type]);
  };
  const group = (keyFn) => { const m = new Map(); for (const p of people) { const k = keyFn(p); if (k) (m.get(k) || m.set(k, []).get(k)).push(p); } return m; };

  // Same door: a household if both live with others; otherwise the next best thing, neighbours.
  for (const list of group((p) => (p.c.home ? `${p.c.from}|${p.c.home}` : null)).values()) {
    if (list.length < 2 || list.length > 6) continue;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const both = list[i].t.household !== "one_person" && list[j].t.household !== "one_person";
      link(list[i], list[j], both ? "household" : "neighbour");
    }
  }
  // Same street: one neighbour each (links are two-way), chosen by a hash.
  for (const list of group((p) => (p.c.address_line ? `${p.c.from}|${p.c.town}|${street(p.c.address_line)}` : null)).values()) {
    if (list.length < 2) continue;
    for (const p of list) {
      const others = shuffled(list.filter((q) => q !== p), seed, `nb|${p.key}`, (q) => q.key);
      let n = 0;
      for (const q of others) { if (n >= 1) break; const before = p.ties?.length ?? 0; link(p, q, "neighbour"); if ((p.ties?.length ?? 0) > before) n++; }
    }
  }
  // Friends: same book, preferring people within one age band; one each (links are two-way, so about two on average).
  for (const list of group((p) => p.c.from).values()) {
    if (list.length < 3) continue;
    for (const p of list) {
      const ai = p.t.age;
      const others = shuffled(list.filter((q) => q !== p), seed, `fr|${p.key}`, (q) => q.key);
      const near = others.filter((q) => Math.abs(ageRank(q.t.age) - ageRank(ai)) <= 1);
      let n = 0;
      for (const q of near.concat(others)) { if (n >= 1) break; const before = p.ties?.length ?? 0; link(p, q, "friend"); if ((p.ties?.length ?? 0) > before) n++; }
    }
  }
}
const AGE_ORDER = ["18-24", "25-34", "35-44", "45-54", "55-64", "65-74", "75+"];
const ageRank = (a) => AGE_ORDER.indexOf(a);

/** Reads the sources and characters, builds, and writes business/data/population.json. */
export function main(argv = process.argv.slice(2)) {
  const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const seed = Number(arg("--seed", 1));
  const sources = JSON.parse(fs.readFileSync(path.join(HERE, "population-sources.json"), "utf8"));
  const characters = JSON.parse(fs.readFileSync(arg("--characters", path.join(ROOT, "business/data/characters.json")), "utf8"));
  const pop = buildPopulation(characters, sources, { seed });
  const out = arg("--out", path.join(ROOT, "business/data/population.json"));
  fs.writeFileSync(out, JSON.stringify(pop));
  console.log(`Wrote ${out}: ${pop.count} people, seed ${seed}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
