// Builds five years of the wider world's past into a world folder: competitor moves, monthly economy figures, weekly
// trends, daily opinion, supplier disruptions, and the news they made. Deterministic from the seed.
//
//   node simulation/world/build-history.mjs <world folder> [--seed 2021] [--from 2021-11-22] [--to 2026-11-22]
//
// Writes NEW files only and refuses to overwrite any (data/world/* is never rebuilt in place):
//   organisations.json, competitor_moves.json, economy.json, trends.json, opinion.json, supplier_disruptions.json,
//   world_developments.json
//   (loaded by simulation/world/extension.js into the state lists of the same names), and world_news.json (news items in the
//   shape of news.json, ids carrying on after news.json's highest, ready to be merged into news.json when the world is
//   next rebuilt; the engine does not load it by itself).
//
// The past runs on the same rules as the live world (simulation/world/competitors.mjs, simulation/world/trends.mjs, simulation/world/suppliers.mjs),
// reading the folder's own records (reviews, cases, social posts, price changes, daily web figures) as they stood on
// each day. The one difference is the economy: the past passes through the dated anchors in business/data/economy.json
// (assumptions, labelled) along a seeded wobbly line, and ends exactly at the starting values the live world uses.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { rngFor } from "../../business/builder/world/rng.mjs";
import { ORGANISATIONS, toList } from "./organisations.mjs";
import { competitorsAfterDay } from "./competitors.mjs";
import { ECONOMY, INDICATORS, economyNews, normal } from "./economy.mjs";
import { opinionAfterDay, trendsAfterDay } from "./trends.mjs";
import { suppliersAfterDay } from "./suppliers.mjs";
import { developmentsAfterDay } from "./developments.mjs";
import { addDays, nextMonth, publishNews, round } from "./common.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OUTPUTS = ["organisations", "competitor_moves", "economy", "trends", "opinion", "supplier_disruptions", "world_developments", "world_news"];

/**
 * The monthly economy rows from the first anchor to the last: straight lines between anchors plus seeded noise that
 * is pinned to zero at each anchor (a Brownian bridge), so the line wobbles but passes through every anchor exactly.
 * Bank Rate moves only on decision months, in steps of 0.25. Pure.
 * @param {number} seed
 * @param {object=} cfg business/data/economy.json.
 * @return {Array<object>}
 */
export function economyHistory(seed, cfg = ECONOMY) {
  const pts = cfg.history_anchors.points;
  const rows = [];
  for (let a = 0; a < pts.length - 1; a++) {
    const months = [];
    for (let m = pts[a].month; m < pts[a + 1].month; m = nextMonth(m)) months.push(m);
    const n = months.length;
    const walk = {};
    for (const k of INDICATORS) {
      let w = 0;
      const steps = months.map((m) => (w += normal(rngFor(seed, "economy-history", m, k))));
      walk[k] = steps.map((x, i) => x - (steps[n - 1] * (i + 1)) / n); // pinned: zero again at the next anchor
    }
    months.forEach((m, i) => {
      const f = i / n;
      const row = { id: m, month: m, published: `${m}-${String(cfg.release_day).padStart(2, "0")}`, status: "history" };
      for (const k of INDICATORS) {
        const line = pts[a][k] + f * (pts[a + 1][k] - pts[a][k]);
        const noise = k === "bank_rate" ? 0 : (i === 0 ? 0 : walk[k][i - 1]) * cfg.processes[k].noise * 0.5;
        row[k] = round(line + noise, k === "consumer_confidence" ? 1 : 2);
      }
      rows.push(row);
    });
  }
  const last = pts.at(-1);
  rows.push({ id: last.month, month: last.month, published: `${last.month}-${String(cfg.release_day).padStart(2, "0")}`, status: "history",
    ...Object.fromEntries(INDICATORS.map((k) => [k, last[k]])) });
  // Bank Rate: hold between decision months, round to the 0.25 grid.
  const B = cfg.processes.bank_rate;
  for (let i = 1; i < rows.length; i++) {
    const decide = B.decision_months.includes(Number(rows[i].month.slice(5, 7))) || i === rows.length - 1;
    rows[i].bank_rate = decide ? Math.max(B.min, Math.round(rows[i].bank_rate / B.step) * B.step) : rows[i - 1].bank_rate;
  }
  return rows;
}

/** Reads a JSON file from the world folder, or a fallback. */
function readIn(dir, name, fallback = []) {
  const f = join(dir, `${name}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : fallback;
}

/** Records sorted by a date, for feeding into the state day by day. */
function feed(list, dateOf) {
  return list.filter((x) => dateOf(x)).sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : dateOf(a) > dateOf(b) ? 1 : 0));
}

/**
 * Runs the wider world over the past. Pure apart from reading the folder.
 * @param {string} dir The world folder (read only).
 * @param {{seed: number, from: string, to: string}} o
 * @return {Object<string, Array<object>>} The new files' contents, by name.
 */
export function buildHistory(dir, { seed, from, to }) {
  const products = readdirSync(join(ROOT, "business/data/products")).filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(readFileSync(join(ROOT, "business/data/products", f), "utf8")));
  const cats = [...new Set(products.map((p) => p.category))].sort();
  const existingNews = readIn(dir, "news");
  const company = readIn(dir, "company", {});
  // WHY a growing copy of each list: opinion reads "the last 30 days" from the end of each list, as it would live.
  const sources = {
    reviews: feed(readIn(dir, "reviews"), (r) => r.date),
    cases: feed(readIn(dir, "cases"), (c) => c.opened_at?.slice(0, 10)),
    social_posts: feed(readIn(dir, "social_posts"), (p) => p.at?.slice(0, 10)),
    web_sessions_daily: feed(readIn(dir, "web_sessions_daily"), (w) => w.date),
  };
  const keyDate = { reviews: (r) => r.date, cases: (c) => c.opened_at.slice(0, 10), social_posts: (p) => p.at.slice(0, 10), web_sessions_daily: (w) => w.date };
  const cursor = Object.fromEntries(Object.keys(sources).map((k) => [k, 0]));
  const state = {
    company, suppliers: readIn(dir, "suppliers"), price_history: readIn(dir, "price_history"), product_status: {},
    purchase_orders: [], // WHY empty: the past's purchase orders are already written; history never changes them.
    reviews: [], cases: [], social_posts: [], web_sessions_daily: [],
    news: existingNews.slice(), counters: {}, competitor_moves: [], economy: [], trends: [], opinion: [], supplier_disruptions: [], world_developments: [],
  };
  const firstNew = state.news.length;
  const econ = economyHistory(seed);
  let prevEcon = null;

  for (let date = from; date <= to; date = addDays(date, 1)) {
    for (const k of Object.keys(sources)) {
      const src = sources[k];
      while (cursor[k] < src.length && keyDate[k](src[cursor[k]]) <= date) state[k].push(src[cursor[k]++]);
    }
    const row = econ.find((r) => r.published === date);
    if (row) {
      const rec = { ...row };
      if (prevEcon && date >= from) {
        const news = publishNews(state, { date, ...economyNews(rec, prevEcon), section: "Money", source: `economy:${rec.month}`, hour: "09:30" });
        if (news) rec.news_id = news.id;
      }
      state.economy.push(rec);
      prevEcon = rec;
    }
    trendsAfterDay(state, date, seed, cats);
    competitorsAfterDay(ORGANISATIONS, state, date, seed, products, { posts: false }); // WHY no posts: the past's social records are already written
    suppliersAfterDay(ORGANISATIONS.supplier_constraints, state, date, seed);
    developmentsAfterDay(ORGANISATIONS, state, date, seed);
    opinionAfterDay(state, date);
  }
  // Rows published before the history starts (the opening month) still belong in the record, without news.
  const early = econ.filter((r) => r.published < from && !state.economy.some((e) => e.month === r.month));
  return {
    organisations: toList(ORGANISATIONS),
    competitor_moves: state.competitor_moves,
    economy: [...early, ...state.economy],
    trends: state.trends,
    opinion: state.opinion,
    supplier_disruptions: state.supplier_disruptions,
    world_developments: state.world_developments,
    world_news: state.news.slice(firstNew).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)),
  };
}

function main() {
  const { values: v, positionals } = parseArgs({ allowPositionals: true, options: {
    seed: { type: "string", default: "2021" }, from: { type: "string" }, to: { type: "string" },
  } });
  const dir = positionals[0];
  if (!dir || !existsSync(dir)) throw new Error("Usage: node simulation/world/build-history.mjs <world folder> [--seed 2021] [--from YYYY-MM-DD] [--to YYYY-MM-DD]");
  const taken = OUTPUTS.filter((n) => existsSync(join(dir, `${n}.json`)));
  // WHY refuse: world folders are built by business/builder/build-world.mjs; this adds beside them and never rewrites anything.
  if (taken.length) throw new Error(`Refusing to overwrite ${taken.map((n) => `${n}.json`).join(", ")} in ${dir}. Use a fresh copy.`);
  const company = readIn(dir, "company", {});
  const anchor = JSON.parse(readFileSync(join(ROOT, "business/data/business.json"), "utf8")).sim.anchor_now.slice(0, 10);
  const from = v.from || company.founded || "2021-11-22";
  const to = v.to || addDays(anchor, -1);
  const out = buildHistory(dir, { seed: Number(v.seed), from, to });
  for (const [name, list] of Object.entries(out)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(list, null, 1) + "\n");
  console.log(`Wrote ${Object.entries(out).map(([n, l]) => `${n}.json (${l.length})`).join(", ")} into ${dir} for ${from} to ${to}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
