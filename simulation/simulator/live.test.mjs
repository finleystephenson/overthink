// Tests for the live business and its shadow twin (simulation/simulator/live.mjs). Run: node --test simulation/simulator/live.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLive, restoreLive } from "./live.mjs";
import { createSim } from "./core.mjs";
import { loadBusiness } from "./data.mjs";
import { loadPlugins } from "./plugins.mjs";
import { freshWorld, worldFromState } from "../../infrastructure/server/world-data.mjs";

const biz = loadBusiness();
const makeWorld = (state) => worldFromState("demo", state);
const newLive = (extra = {}) => { const world = freshWorld("demo"); return { world, live: createLive({ world, biz, seed: 9, makeWorld, ...extra }) }; };
const asManager = (world) => world.session({ role: "manager" });
const differences = (imp) => Object.entries(imp.measures).filter(([, m]) => m.difference !== 0 && m.difference !== null).map(([k]) => k);

test("nothing is built until time first moves", async () => {
  const { world, live } = newLive();
  assert.equal(live.started(), false);
  assert.equal(live.shadowWorld(), null);
  assert.equal(live.impact().days_compared, 0);
  assert.deepEqual(live.clock(), { now: "2026-11-23T10:00:00Z", date: "2026-11-23", day: 0, seed: 9, scale: world.state.company.scale, started: false });
});

test("with no outside actions the impact is exactly zero, every day, with the plug-ins on", async () => {
  const { plugins } = await loadPlugins({ only: ["events"] });
  const { world, live } = newLive({ plugins });
  const out = await live.advance(20);
  assert.equal(out.days.length, 20);
  assert.equal(out.now, "2026-12-13T10:00:00Z");
  const imp = live.impact();
  assert.equal(imp.days_compared, 20);
  assert.deepEqual(differences(imp), []);
  for (const series of Object.values(imp.series.difference)) assert.ok(series.every((x) => x === 0 || x === null));
  assert.ok(imp.measures.orders.live > 0 && imp.measures.revenue.live > 0, "the business did trade");
  // Same state in both worlds, record for record (the audit log aside: it records who called what).
  const strip = (s) => JSON.stringify({ ...s, audit: [] });
  assert.equal(strip(world.state), strip(live.shadowWorld().state));
});

test("a price change through the engine shows as impact; the shadow never sees it", async () => {
  const { world, live } = newLive();
  await live.advance(2);
  const r = asManager(world).call("change_price", { sku: "OT-SOCK", new_price: 15, reason: "test" });
  assert.equal(r.ok, true);
  await live.advance(10);
  const imp = live.impact();
  assert.ok(differences(imp).includes("revenue") && differences(imp).includes("orders"), differences(imp).join(","));
  assert.ok(!live.shadowWorld().state.price_history.some((h) => h.reason === "test"));
  // The first two days, before the change, still match.
  assert.deepEqual(imp.series.difference.revenue.slice(0, 2), [0, 0]);
});

test("actions taken before the first advance count too", async () => {
  const { world, live } = newLive();
  assert.equal(asManager(world).call("set_marketing_budget", { monthly: 10000 }).ok, true);
  await live.advance(5);
  const m = live.impact().measures;
  assert.ok(m.orders.difference > 0, "more marketing: more orders");
  assert.ok(m.net_profit.difference !== 0, "and a different profit");
  assert.equal(live.shadowWorld().state.settings, undefined, "the shadow never had the change");
});

test("a saved live business carries on exactly as one that was never saved", async () => {
  const a = newLive(), b = newLive();
  for (const { world, live } of [a, b]) {
    await live.advance(3);
    asManager(world).call("change_price", { sku: "OT-PEN", new_price: 9, reason: "test" });
    await live.advance(2);
  }
  const saved = JSON.parse(JSON.stringify(b.live.snapshot()));
  const worldB = worldFromState("demo", JSON.stringify(b.world.state));
  const back = restoreLive(saved, { world: worldB, biz, makeWorld });
  assert.equal(back.started(), true);
  await a.live.advance(9);
  await back.advance(9);
  assert.deepEqual(back.impact(), a.live.impact());
  assert.equal(JSON.stringify(worldB.state), JSON.stringify(a.world.state));
});

test("advances wait their turn: two at once never interleave", async () => {
  const { live } = newLive();
  const [x, y] = await Promise.all([live.advance(3), live.advance(2)]);
  assert.deepEqual(x.days.map((d) => d.summary.day), [1, 2, 3]);
  assert.deepEqual(y.days.map((d) => d.summary.day), [4, 5]);
  await assert.rejects(live.advance(0), /whole number/);
});

test("a carrier delay from a plug-in makes parcels late, the same way in both worlds", async () => {
  const strike = { name: "strike", modifiers: ({ date }) => (date <= "2026-11-30" ? { carrier_delay_days: 3 } : {}) };
  const run = async (plugins) => { const sim = createSim({ world: freshWorld("demo"), biz, seed: 9, plugins, scale: 1 }); for (let i = 0; i < 14; i++) await sim.step(); return sim.totals().totals; };
  const calm = await run([]), late = await run([strike]);
  assert.ok(late.late_parcels > calm.late_parcels + 20, `late parcels ${calm.late_parcels} -> ${late.late_parcels}`);
  const { live } = newLive({ plugins: [strike] });
  await live.advance(14);
  assert.deepEqual(differences(live.impact()), []);
});
