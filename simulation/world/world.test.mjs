// Tests for the wider world: organisations, competitors, economy, trends, opinion, supplier limits, the engine tools.
// Run: node --test simulation/world/world.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim, combineModifiers } from "../simulator/core.mjs";
import { createLive } from "../simulator/live.mjs";
import { loadBusiness } from "../simulator/data.mjs";
import { loadPlugins } from "../simulator/plugins.mjs";
import { freshWorld, worldFromState, dataFor } from "../../infrastructure/server/world-data.mjs";
import { worldPlugins } from "./plugins.mjs";
import { competitorEffects, competitorsAfterDay, decideWeek } from "./competitors.mjs";
import { economyEffects, nextRow, startRow } from "./economy.mjs";
import { trendEffects } from "./trends.mjs";
import { suppliersAfterDay } from "./suppliers.mjs";
import { ORGANISATIONS } from "./organisations.mjs";
import { economyHistory } from "./build-history.mjs";
import { checkSettings } from "./extension.js";

const biz = loadBusiness();
const products = dataFor("demo").products;
const CATS = [...new Set(products.map((p) => p.category))];
const makeWorld = (state) => worldFromState("demo", state);
const differences = (imp) => Object.entries(imp.measures).filter(([, m]) => m.difference !== 0 && m.difference !== null).map(([k]) => k);

async function runSim(days, { seed = 9, settings = null, scale = undefined } = {}) {
  const world = freshWorld("demo");
  if (settings) world.state.world_settings = settings;
  const sim = createSim({ world, biz, seed, scale, plugins: worldPlugins({ products }) });
  const lines = [];
  for (let i = 0; i < days; i++) lines.push(await sim.step());
  return { world, lines, totals: sim.totals().totals };
}

test("the same seed gives the same rivals' moves, economy, trends and opinion", async () => {
  const a = await runSim(40), b = await runSim(40);
  for (const k of ["competitor_moves", "economy", "trends", "opinion", "supplier_disruptions", "news"]) {
    assert.equal(JSON.stringify(a.world.state[k]), JSON.stringify(b.world.state[k]), k);
  }
  assert.ok(a.world.state.competitor_moves.length > 0, "rivals did something in 40 days (Black Friday falls inside)");
  assert.ok(a.world.state.economy.length >= 1, "a month's figures were published");
  const c = await runSim(40, { seed: 10 });
  assert.notEqual(JSON.stringify(c.world.state.trends), JSON.stringify(a.world.state.trends), "another seed, another world");
});

test("a live world with the world plug-ins and no actions shows exactly zero impact", async () => {
  const { plugins, skipped } = await loadPlugins({ only: ["events", "world"], products });
  assert.deepEqual(skipped, []);
  assert.ok(plugins.some((p) => p.name === "world-competitors"));
  const world = freshWorld("demo");
  const live = createLive({ world, biz, seed: 9, makeWorld, plugins });
  await live.advance(30);
  const imp = live.impact();
  assert.deepEqual(differences(imp), []);
  const strip = (s) => JSON.stringify({ ...s, audit: [] });
  assert.equal(strip(world.state), strip(live.shadowWorld().state));
});

test("a forced competitor price cut lowers Overthought's demand in that category, and only there", async () => {
  const settings = { competitor_moves: [{ competitor: "thriftwhistle", categories: ["everyday"], price_factor: 0.7, from: "2026-11-24", to: "2027-01-31" }] };
  const state = { world_settings: settings, competitor_moves: [] };
  const e = competitorEffects(ORGANISATIONS, state, "2026-12-01", CATS);
  assert.ok(e.categories.everyday < 0.95 && e.categories.everyday > 0.7, `everyday x${e.categories.everyday}`);
  assert.equal(e.categories.food, undefined);
  assert.match(e.why[0].because, /Thriftwhistle/);

  // Through the live twin: the same days, the shadow without the setting.
  const { plugins } = await loadPlugins({ only: ["world"], products });
  const world = freshWorld("demo");
  const live = createLive({ world, biz, seed: 9, makeWorld, plugins });
  assert.equal(world.session({ role: "world" }).call("set_world_settings", { settings }).ok, true);
  await live.advance(30);
  const sold = (w) => w.state.orders.filter((o) => o.placed_at >= "2026-11-24").flatMap((o) => o.items)
    .filter((l) => w.index.skus[l.sku]?.product.category === "everyday").reduce((n, l) => n + l.qty, 0);
  assert.ok(sold(world) < sold(live.shadowWorld()), `everyday units ${sold(world)} vs ${sold(live.shadowWorld())}`);
  assert.ok(live.impact().measures.orders.difference < 0);
  assert.ok(world.state.news.some((n) => /Thriftwhistle cuts prices/.test(n.headline)), "the move made the news");
});

test("an economy shock moves demand and costs the expected way", async () => {
  const at = "2026-12-20";
  const base = economyEffects({}, at);
  assert.equal(base.demand.all, 1, "an unchanged economy changes nothing");
  assert.equal(base.costs.goods, 1);
  assert.equal(base.price_sensitivity, 1);
  const shocked = economyEffects({ world_settings: { economy_shocks: [{ confidence_shift: -15, inflation_shift: 4, unemployment_shift: 2, from: "2026-12-01", to: "2027-03-01" }] } }, at);
  assert.ok(shocked.demand.all < 0.97, `demand x${shocked.demand.all}`);
  assert.ok(shocked.costs.goods > 1.01 && shocked.costs.carrier > shocked.costs.goods);
  assert.ok(shocked.price_sensitivity > 1.05);
  assert.equal(shocked.why.length, 3);

  // WHY full scale: the demo world sells a few orders a day, too few for a 6% change to show in three weeks.
  const calm = await runSim(21, { scale: 1 }), gloom = await runSim(21, { scale: 1, settings: { economy_shocks: [{ confidence_shift: -20, from: "2026-11-24" }] } });
  assert.ok(gloom.totals.orders < calm.totals.orders, `orders ${calm.totals.orders} -> ${gloom.totals.orders}`);
  assert.ok(gloom.lines[3].why.some((w) => w.source === "economy"), "the day says why");
});

test("monthly figures drift but stay believable, and Bank Rate moves in quarter points", () => {
  let row = startRow();
  const seen = [];
  for (let m = 1; m <= 120; m++) {
    const month = `${2026 + Math.floor((10 + m) / 12)}-${String(((10 + m) % 12) + 1).padStart(2, "0")}`;
    row = nextRow(row, month, 3);
    seen.push(row);
  }
  for (const r of seen) {
    assert.ok(r.cpi_inflation > -1 && r.cpi_inflation < 15);
    assert.ok(r.consumer_confidence >= -50 && r.consumer_confidence <= 5);
    assert.equal(Math.round(r.bank_rate * 4), r.bank_rate * 4);
  }
  const h = economyHistory(1);
  assert.equal(h.length, 61);
  assert.deepEqual([h.at(-1).cpi_inflation, h.at(-1).consumer_confidence, h.at(-1).bank_rate], [2.8, -19, 3.5], "the past ends at today's starting values");
  assert.deepEqual(economyHistory(1), h);
});

test("news is published for rivals, the monthly figures and viral trends", async () => {
  const { world } = await runSim(40);
  const sections = new Set(world.state.news.filter((n) => n.source).map((n) => n.section));
  assert.ok(sections.has("Business") && sections.has("Money"), [...sections].join(","));
  // WHY the date: the history's own news (world_news.json) is merged into the paper at load; this test is about news made during the run.
  const item = world.state.news.find((n) => n.section === "Money" && n.source && n.at >= "2026-11-23");
  assert.match(item.id, /^NW-\d{5}$/);
  assert.equal(item.at, "2026-12-15T09:30:00Z");
  assert.doesNotMatch(item.headline, /CM-|SUP-|NW-/, "plain words, no codes");
  const listed = world.session({ role: "manager" }).call("list_news", { section: "Money" }).data.news;
  assert.ok(listed.some((n) => n.id === item.id), "The Daily Overthinker shows it");
});

test("an undercutter follows Overthought's price cut after a delay", () => {
  const sock = products.find((p) => p.id === "spare-sock");
  const state = { price_history: [{ sku: sock.variants[0].sku, old_price: sock.variants[0].price, new_price: sock.variants[0].price * 0.6, date: "2026-11-25", reason: "test" }], competitor_moves: [] };
  const found = [];
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const m = decideWeek(ORGANISATIONS, state, "2026-11-30", seed, products).find((x) => x.kind === "price_match" && x.competitor === "thriftwhistle");
    if (m) found.push(m);
  }
  assert.ok(found.length >= 4, `followed in ${found.length} of 8 worlds (chance 75%)`);
  for (const m of found) {
    assert.ok(m.from > "2026-11-30" && m.price_factor < 1 && m.categories[0] === "everyday");
    assert.match(m.reason, /Overthought cut/);
  }
  // Without the cut, no one follows.
  assert.ok(!decideWeek(ORGANISATIONS, { price_history: [], competitor_moves: [] }, "2026-11-30", 1, products).some((x) => x.kind === "price_match"));
});

test("business roles see rivals' public face; only the world lens sees strategies", async () => {
  const { world } = await runSim(14);
  const manager = world.session({ role: "manager" }), assistant = world.session({ role: "assistant" }), lens = world.session({ role: "world" });
  for (const s of [manager, assistant]) {
    const o = s.call("get_organisation", { id: "thriftwhistle" });
    assert.equal(o.ok, true);
    for (const k of ["strategy", "strategy_in_words", "rules", "weights", "ad_budget_per_month"]) assert.equal(o.data[k], undefined, k);
    assert.match(o.data.prices_in_words, /cheaper/);
    for (const m of s.call("list_competitor_moves", {}).data.moves) assert.equal(m.reason, undefined);
    assert.equal(s.call("get_world_settings", {}).ok, false);
  }
  const full = lens.call("get_organisation", { id: "thriftwhistle" }).data;
  assert.equal(full.strategy, "undercutter");
  assert.ok(full.rules.follow_cuts);
  assert.ok(lens.call("get_economy", {}).data.effects_today);
  assert.equal(lens.call("list_customers", {}).ok, false, "the lens is not a business role");
  assert.equal(assistant.call("get_competitor_prices", { category: "tech" }).data.prices.length >= 2, true);
});

test("world settings are checked; a supplier disruption delays new orders with a reason", () => {
  assert.equal(checkSettings({ trend_boosts: [{ category: "tech", factor: 2 }] }), null);
  assert.match(checkSettings({ weather: [] }), /Unknown setting/);
  assert.match(checkSettings({ competitor_moves: [{ price_factor: 0.9 }] }), /competitor/);
  const po = (n, qty, at) => ({ number: n, supplier_id: "SUP-03", lines: [{ sku: "OT-SOCK", qty }], ordered_at: `${at}T17:30:00Z`, due_at: "2026-12-20", status: "ordered" });
  const state = { suppliers: [{ id: "SUP-03", name: "Beckside Mill" }], purchase_orders: [po("PO-1", 50, "2026-11-01"), po("PO-2", 50, "2026-12-01")],
    world_settings: { supplier_disruptions: [{ supplier: "SUP-03", capacity_factor: 0.5, extra_lead_days: 5, from: "2026-11-30", to: "2026-12-10" }] } };
  suppliersAfterDay(ORGANISATIONS.supplier_constraints, state, "2026-12-01", 1);
  assert.equal(state.purchase_orders[1].due_at, "2026-12-25");
  assert.match(state.purchase_orders[1].world_delay.because, /experiment/);
  assert.equal(state.purchase_orders[0].due_at, "2026-12-20", "older orders are left alone");
});

test("trend boosts raise demand for their category; modifiers carry price sensitivity and why", () => {
  const t = trendEffects({ world_settings: { trend_boosts: [{ category: "outdoors", factor: 2, from: "2026-12-01", to: "2026-12-31" }] } }, "2026-12-05", CATS);
  assert.ok(t.categories.outdoors > 1.25 && t.categories.outdoors < 1.4);
  const m = combineModifiers([{ price_sensitivity: 1.2, why: [{ source: "a" }] }, { price_sensitivity: 1.5, why: [{ source: "b" }] }, {}]);
  assert.equal(m.price_sensitivity, 1.2 * 1.5);
  assert.deepEqual(m.why.map((w) => w.source), ["a", "b"]);
  assert.equal(combineModifiers([]).price_sensitivity, 1);
});

test("moves are recorded once with plain-English news, even when decided days apart", () => {
  const state = { competitor_moves: [], news: [], counters: {} };
  competitorsAfterDay(ORGANISATIONS, state, "2026-11-23", 4, products);
  competitorsAfterDay(ORGANISATIONS, state, "2026-11-23", 4, products);
  const ids = state.competitor_moves.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(state.news.filter((n) => n.source?.startsWith("competitor_move:")).length, state.competitor_moves.filter((m) => m.newsworthy !== false).length);
});

test("a development set in the settings makes the news and acts with a reason", async () => {
  const settings = { developments: [{ id: "high-street-roadworks", from: "2026-11-24", to: "2026-12-07" }] };
  const { world, lines, totals } = await runSim(10, { settings, scale: 1 });
  const calm = await runSim(10, { scale: 1 });
  assert.ok(world.state.world_developments.some((w) => w.development === "high-street-roadworks" && w.news_id));
  assert.ok(world.state.news.some((n) => /digs up the road/.test(n.headline)));
  assert.ok(lines[2].why.some((w) => w.source === "developments" && /roadworks/.test(w.because)));
  assert.ok(totals.late_parcels > calm.totals.late_parcels, `late parcels ${calm.totals.late_parcels} -> ${totals.late_parcels}`);
  const seen = world.session({ role: "assistant" }).call("list_world_developments", {}).data.developments;
  assert.ok(seen.length >= 1 && seen[0].what_it_does && seen[0].effects === undefined);
});

test("rivals' moves also appear as their own posts on Mutter", async () => {
  const { world } = await runSim(14);
  const posts = world.state.social_posts.filter((p) => p.author?.kind === "organisation");
  assert.ok(posts.length >= 1);
  for (const p of posts) {
    assert.equal(p.network, "mutter");
    assert.match(p.id, /^SP-\d{6}$/);
    assert.doesNotMatch(p.text, /CM-|undefined|NaN/);
    assert.ok(world.state.competitor_moves.some((m) => m.post_id === p.id));
  }
});
