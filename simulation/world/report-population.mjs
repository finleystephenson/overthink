// Coverage and bias report for the population. Run: node simulation/world/report-population.mjs
// Prints to the screen and writes simulation/world/population-report.md.
//  1. Coverage: each trait against its target, with the difference.
//  2. Stereotype check: how strongly each trait is tied to book, kind and author era (bias-corrected Cramer's V;
//     it should be near zero, because traits are dealt without looking at the story).
//  3. outcomesByGroup: for the lab's fairness check.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { traitsFor, BEHAVIOUR_ASSUMPTIONS } from "./population.mjs";
import { rngFor } from "../../business/builder/world/rng.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
export const STEREOTYPE_LIMIT = 0.08; // V at or above this is a failure; sampling noise alone gives about 0.0 to 0.05

/** Share (percent) of each value in a list. */
function shares(values, order) {
  const n = values.length, out = {};
  for (const v of order) out[v] = 0;
  for (const v of values) out[v] = (out[v] || 0) + 1;
  for (const v of Object.keys(out)) out[v] = (out[v] / n) * 100;
  return out;
}

const rows = (pop) => Object.values(pop.people);

/**
 * Target against actual for every trait. Targets for traits that depend on age are the age-weighted mix of the
 * conditional tables (so the check is "did the dealing match the tables"), not a separately published marginal.
 * @return {Array<{trait: string, status: string, rows: Array<{value: string, target: number, actual: number, diff: number}>, maxDiff: number}>}
 */
export function coverage(pop) {
  const S = pop.targets, people = rows(pop), n = people.length;
  const ageShare = Object.fromEntries(S.age.bands.map((a, i) => [a, S.age.share[i] / S.age.share.reduce((x, y) => x + y, 0)]));
  const mixed = (table, values) => values.map((v, j) => S.age.bands.reduce((s, a) => s + ageShare[a] * (table[a][j] / table[a].reduce((x, y) => x + y, 0)) * 100, 0));
  const flat = (arr) => arr.map((x) => (x / arr.reduce((a, b) => a + b, 0)) * 100);
  const specs = [
    ["age", S.age.bands, flat(S.age.share), S.age.status],
    ["household", S.household.types, mixed(S.household.by_age_share, S.household.types), S.household.status],
    ["income", S.income.quintiles, flat(S.income.share), S.income.status],
    ["employment", S.employment.statuses, mixed(S.employment.by_age_share, S.employment.statuses), S.employment.status],
    ["area", S.area.types, flat(S.area.share), S.area.status],
    ["online", S.online_shopping.bands, mixed(S.online_shopping.by_age_share, S.online_shopping.bands), S.online_shopping.status],
    ["channel", S.channel.options, mixed(S.channel.by_age_share, S.channel.options), S.channel.status],
  ];
  const out = specs.map(([trait, values, targets, status]) => {
    const act = shares(people.map((p) => p[trait]), values);
    const r = values.map((v, i) => ({ value: v, target: targets[i], actual: act[v], diff: act[v] - targets[i] }));
    return { trait, status, rows: r, maxDiff: Math.max(...r.map((x) => Math.abs(x.diff))) };
  });
  const circ = Object.entries(S.circumstances).filter(([k]) => !k.startsWith("_")).map(([name, spec]) => {
    const prev = spec.derived ? S.employment.by_age_share && out.find((o) => o.trait === "employment").rows.find((x) => x.value === "student").target : spec.prevalence * 100;
    const actual = (people.filter((p) => p.circumstances.includes(name)).length / n) * 100;
    return { value: name, target: prev, actual, diff: actual - prev };
  });
  out.push({ trait: "circumstances", status: "approximate", rows: circ, maxDiff: Math.max(...circ.map((x) => Math.abs(x.diff))) });
  return out;
}

/** Context checks against the headline figures the searches confirmed (not the table targets). */
export function headlineChecks(pop) {
  const people = rows(pop);
  const adults1864 = people.filter((p) => ["18-24", "25-34", "35-44", "45-54", "55-64"].includes(p.age));
  const emp = (adults1864.filter((p) => p.employment === "employed" || p.employment === "self_employed").length / adults1864.length) * 100;
  const shopper = (people.filter((p) => p.online !== "never").length / people.length) * 100;
  const lone = (people.filter((p) => p.household === "one_person").length / people.length) * 100;
  return [
    { what: "employment rate, ages 18 to 64 (ONS 16 to 64: 75.0%, Jul-Sep 2025, checked; 16-17s excluded here)", ours: emp, published: 75.0 },
    { what: "bought online in the last year (ONS 2020: 87%, second-hand)", ours: shopper, published: 87 },
    { what: "adults living alone (ONS: 29.5% of HOUSEHOLDS; adults living alone are a smaller share, so not comparable)", ours: lone, published: null },
  ];
}

/** Bias-corrected Cramer's V between two categorical lists (Bergsma 2013). 0 = unrelated, 1 = identical. */
export function cramersV(a, b) {
  const n = a.length, ra = [...new Set(a)], rb = [...new Set(b)];
  if (ra.length < 2 || rb.length < 2) return 0;
  const cell = new Map(), ca = new Map(), cb = new Map();
  for (let i = 0; i < n; i++) {
    const k = a[i] + "\u0000" + b[i];
    cell.set(k, (cell.get(k) || 0) + 1); ca.set(a[i], (ca.get(a[i]) || 0) + 1); cb.set(b[i], (cb.get(b[i]) || 0) + 1);
  }
  let chi = 0;
  for (const x of ra) for (const y of rb) {
    const e = (ca.get(x) * cb.get(y)) / n, o = cell.get(x + "\u0000" + y) || 0;
    chi += ((o - e) ** 2) / e;
  }
  const phi2 = chi / n, r = ra.length, k = rb.length;
  const phi2c = Math.max(0, phi2 - ((k - 1) * (r - 1)) / (n - 1));
  const rc = r - ((r - 1) ** 2) / (n - 1), kc = k - ((k - 1) ** 2) / (n - 1);
  return Math.sqrt(phi2c / Math.min(kc - 1, rc - 1));
}

const eraOf = (year) => (!year ? "unknown" : year < 1700 ? "before 1700" : year < 1800 ? "1700s" : year < 1850 ? "1800-49" : year < 1900 ? "1850-99" : "1900 on");

/**
 * The biggest V that shuffling the story column gives (the most chance alone produced in `perms` shuffles). Small groups
 * (a rare circumstance spread over 69 books) can show a V of 0.1 by luck, so "near zero" is judged against this too.
 */
function chanceLevel(values, story, perms, label) {
  const r = rngFor(1, "chance", label), s = story.slice();
  let max = 0;
  for (let k = 0; k < perms; k++) {
    for (let i = s.length - 1; i > 0; i--) { const j = r.int(0, i); [s[i], s[j]] = [s[j], s[i]]; }
    max = Math.max(max, cramersV(values, s));
  }
  return max;
}

/**
 * How strongly each trait is tied to the character's story (book, kind, author era).
 * @param {object} pop The population.
 * @param {Array<object>} characters business/data/characters.json (for kind and source_year).
 * @return {Array<{trait: string, book: number, kind: number, era: number, chance: object, pass: boolean}>}
 */
export function stereotypeCheck(pop, characters, perms = 100) {
  const byKey = new Map(characters.map((c) => [c.name, c]));
  const names = Object.values(pop.people).map((p) => p.name).filter((n) => byKey.has(n));
  const story = { book: names.map((n) => byKey.get(n).from), kind: names.map((n) => byKey.get(n).kind), era: names.map((n) => eraOf(byKey.get(n).source_year)) };
  const traits = ["age", "household", "income", "employment", "area", "online", "channel"];
  const lookup = new Map(Object.values(pop.people).map((p) => [p.name, p]));
  const col = (t) => names.map((n) => lookup.get(n)[t]);
  const circNames = Object.keys(pop.targets.circumstances).filter((k) => !k.startsWith("_"));
  const flagCol = (c) => names.map((n) => (lookup.get(n).circumstances.includes(c) ? "yes" : "no"));
  const cols = [...traits.map((t) => [t, col(t)]), ...circNames.map((c) => [c, flagCol(c)])];
  return cols.map(([trait, values]) => {
    const row = { trait, chance: {} };
    for (const s of ["book", "kind", "era"]) { row[s] = cramersV(values, story[s]); row.chance[s] = chanceLevel(values, story[s], perms, `${trait}|${s}`); }
    row.pass = ["book", "kind", "era"].every((s) => row[s] < Math.max(STEREOTYPE_LIMIT, row.chance[s]));
    return row;
  });
}

/**
 * Per-group outcome means for the lab's fairness check.
 * @param {Array<object>} records One per customer: who (key, name or email) and numbers or true/false values, e.g.
 *   { name, satisfaction: 4, response_minutes: 90, refund_approved: true }.
 * @param {object} population The loaded business/data/population.json.
 * @param {string|function} groupBy A trait ("income", "age", "household", "employment", "area", "online", "channel"),
 *   "circumstance:carer" (yes or no), or a function (traits) => group name.
 * @param {{minGroup?: number, metrics?: string[]}} [o] minGroup defaults to 30: smaller groups get no mean.
 * @return {{groupBy: string, minGroup: number, unmatched: number, metrics: object}} Per metric: groups { n, mean, enough },
 *   largest_gap { between, gap } or { note: "too few to judge" }.
 */
export function outcomesByGroup(records, population, groupBy, { minGroup = 30, metrics = null } = {}) {
  const label = typeof groupBy === "function" ? "custom" : groupBy;
  const groupOf = typeof groupBy === "function" ? groupBy
    : groupBy.startsWith("circumstance:") ? (t) => (t.circumstances.includes(groupBy.slice(13)) ? "yes" : "no")
    : (t) => t[groupBy];
  const skip = new Set(["key", "name", "email", "id", "person"]);
  const names = metrics || [...new Set(records.flatMap((r) => Object.keys(r)))].filter((k) => !skip.has(k) && records.some((r) => typeof r[k] === "number" || typeof r[k] === "boolean"));
  const by = {}; let unmatched = 0;
  for (const r of records) {
    const who = r.name ?? r.key ?? r.person ?? (r.email ? String(r.email).replace(/@.*/, "").replace(/\.x\d+$/, "") : null);
    const t = who && traitsFor({ name: who }, population);
    const g = t && groupOf(t);
    if (!g) { unmatched++; continue; }
    ((by[g] ??= []).push(r));
  }
  const out = {};
  for (const m of names) {
    const groups = {};
    for (const [g, list] of Object.entries(by)) {
      const vals = list.map((r) => r[m]).filter((v) => typeof v === "number" || typeof v === "boolean").map(Number);
      const enough = vals.length >= minGroup;
      groups[g] = { n: vals.length, mean: enough ? vals.reduce((a, b) => a + b, 0) / vals.length : null, enough, ...(enough ? {} : { note: "too few to judge" }) };
    }
    const judged = Object.entries(groups).filter(([, v]) => v.enough).sort((a, b) => a[1].mean - b[1].mean);
    const largest_gap = judged.length < 2 ? { note: "too few to judge" }
      : { between: [judged[0][0], judged[judged.length - 1][0]], gap: judged[judged.length - 1][1].mean - judged[0][1].mean };
    out[m] = { groups, largest_gap };
  }
  return { groupBy: label, minGroup, unmatched, metrics: out };
}

/** Overall verdict: a few lone flags are chance (many tests), many flags or a large V are not. */
export function stereotypeVerdict(st) {
  const tests = st.length * 3;
  const flagged = st.reduce((n, r) => n + ["book", "kind", "era"].filter((s) => r[s] >= Math.max(STEREOTYPE_LIMIT, r.chance[s])).length, 0);
  const worst = Math.max(...st.flatMap((r) => [r.book, r.kind, r.era]));
  return { tests, flagged, worst, ok: flagged <= 2 && worst < 0.2 };
}

const f1 = (x) => x.toFixed(1), f3 = (x) => x.toFixed(3);

/** The report as Markdown. */
export function reportText(pop, characters) {
  const L = [];
  const cov = coverage(pop), st = stereotypeCheck(pop, characters);
  L.push("# Population coverage and bias report", "", `${pop.count} people, seed ${pop.seed}. Generated by simulation/world/report-population.mjs from business/data/population.json. Do not edit by hand.`, "");
  L.push("## Coverage against targets", "", "Shares in percent. The target for traits that depend on age is the age-weighted mix of the source tables. Status is the sources file's: `approximate` means the table shares are NOT verified ONS figures.", "");
  for (const c of cov) {
    L.push(`### ${c.trait} (${c.status}), biggest difference ${f1(c.maxDiff)} points`, "", "| value | target | actual | diff |", "|---|---|---|---|");
    for (const r of c.rows) L.push(`| ${r.value} | ${f1(r.target)} | ${f1(r.actual)} | ${r.diff >= 0 ? "+" : ""}${f1(r.diff)} |`);
    L.push("");
  }
  L.push("## Checks against headline figures confirmed by search", "");
  for (const h of headlineChecks(pop)) L.push(`- ${h.what}: ours ${f1(h.ours)}%${h.published ? `, published ${h.published}%` : ""}`);
  L.push("", "## Stereotype check", "", `Bias-corrected Cramer's V between each trait and the character's book, kind and author era. 0 means no link. A trait passes when every V is under ${STEREOTYPE_LIMIT} or under the largest V that 100 random shuffles of the story column produced (the number in brackets), because a rare circumstance over 69 books shows some V by luck.`, "", "| trait | book (chance max) | kind (chance max) | author era (chance max) | result |", "|---|---|---|---|---|");
  for (const r of st) L.push(`| ${r.trait} | ${f3(r.book)} (${f3(r.chance.book)}) | ${f3(r.kind)} (${f3(r.chance.kind)}) | ${f3(r.era)} (${f3(r.chance.era)}) | ${r.pass ? "pass" : "FAIL"} |`);
  const worst = Math.max(...st.flatMap((r) => [r.book, r.kind, r.era]));
  const v = stereotypeVerdict(st);
  L.push("", `Largest V: ${f3(worst)}. Flagged (above chance max): ${v.flagged} of ${v.tests} tests. ${v.ok ? "Overall: pass." : "Overall: FAIL."}`, "", `Rule: with ${v.tests} tests, about one is expected to top the chance max by luck (a flag on a rare, spread-out circumstance such as \`student\` is usually that). The overall check fails if more than 2 tests are flagged or any V is 0.2 or more. A different seed reshuffles the luck; the test suite also checks the average V over several seeds.`, "");
  L.push("## Behaviour assumptions", "", "Behaviour comes from circumstances only. Every effect is an assumption.", "");
  for (const a of BEHAVIOUR_ASSUMPTIONS) L.push(`- **${a.effect}**: ${a.rule}. Why: ${a.why}`);
  L.push("", "## Limits", "", "- Household, employment, online and channel are each dealt by age; they are independent of each other given age (a lone parent is not made likelier to be unemployed). Income links to employment and household.", "- Circumstance prevalences are assumptions. Ties come from book and address.", "- Fairness checks need at least 30 people in a group (outcomesByGroup says \"too few to judge\" otherwise).", "");
  return L.join("\n");
}

function main() {
  const pop = JSON.parse(fs.readFileSync(path.join(ROOT, "business/data/population.json"), "utf8"));
  const characters = JSON.parse(fs.readFileSync(path.join(ROOT, "business/data/characters.json"), "utf8"));
  const text = reportText(pop, characters);
  fs.writeFileSync(path.join(HERE, "population-report.md"), text);
  console.log(text);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
