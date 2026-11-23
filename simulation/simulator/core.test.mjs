// Tests for the steppable simulator (simulation/simulator/core.mjs). Run: node --test simulation/simulator/core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim, restoreSim, combineModifiers, scaleFor } from "./core.mjs";
import { runOnce } from "./run.mjs";
import { loadBusiness } from "./data.mjs";
import { SandboxStore } from "../../infrastructure/server/sandboxes.mjs";
import { freshWorld, worldFromState } from "../../infrastructure/server/world-data.mjs";

const biz = loadBusiness();
const stepDays = async (sim, n) => { const lines = []; for (let i = 0; i < n; i++) lines.push(await sim.step()); return lines; };
const manager = (world) => world.session({ role: "manager" });

test("step by step gives exactly what the batch run gives", async () => {
  const store = new SandboxStore();
  const batch = await runOnce({ biz, store, size: "demo", seed: 7, days: 12 });
  const sim = createSim({ world: freshWorld("demo"), biz, seed: 7 });
  await stepDays(sim, 12);
  const { sandbox, scale, ...rest } = batch;
  assert.deepEqual(sim.totals(), rest);
  assert.equal(sim.day(), 12);
});

test("snapshot and restore mid-run give the same future", async () => {
  const world = freshWorld("demo");
  const sim = createSim({ world, biz, seed: 3, warmup: 2 });
  await stepDays(sim, 9);
  const snap = sim.snapshot();
  const savedState = JSON.stringify(world.state);
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap, "the snapshot is plain JSON");
  const ahead = await stepDays(sim, 16); // crosses a compaction day (every 14)
  const again = restoreSim(JSON.parse(JSON.stringify(snap)), { world: worldFromState("demo", savedState), biz });
  const replay = await stepDays(again, 16);
  assert.deepEqual(replay, ahead);
  assert.deepEqual(again.totals(), sim.totals());
  assert.equal(JSON.stringify(again.world.state), JSON.stringify(world.state));
});

test("plug-in modifiers multiply together; delays add; nonsense is ignored", () => {
  const m = combineModifiers([
    { demand: { all: 2, products: { "indoor-helmet": 3 } }, visits: 1.5, costs: { carrier: 1.1 } },
    { demand: { all: 1.5, products: { "indoor-helmet": 2 }, categories: { food: 0.5 } }, carrier_delay_days: 2, supplier_late_chance: 2 },
    null, { carrier_delay_days: 1, contact_rate: -4, visits: "lots" },
  ]);
  assert.equal(m.demand.all, 3);
  assert.equal(m.demand.products["indoor-helmet"], 6);
  assert.equal(m.demand.categories.food, 0.5);
  assert.deepEqual([m.visits, m.contact_rate, m.carrier_delay_days, m.supplier_late_chance, m.costs.carrier, m.costs.goods], [1.5, 1, 3, 2, 1.1, 1]);
  assert.deepEqual(combineModifiers([]), combineModifiers([{}]));
});

test("plug-ins change the day: more demand, a dearer carrier, and afterDay runs once a day with the date", async () => {
  const plain = createSim({ world: freshWorld("demo"), biz, seed: 5 });
  await stepDays(plain, 8);
  const seen = [];
  const boom = { name: "boom", modifiers: () => ({ demand: { all: 2 }, costs: { carrier: 1.5 } }), afterDay: ({ date, state }) => seen.push([date, state.now.slice(0, 10)]) };
  const busy = createSim({ world: freshWorld("demo"), biz, seed: 5, plugins: [boom] });
  await stepDays(busy, 8);
  const a = plain.totals().totals, b = busy.totals().totals;
  assert.ok(b.orders > a.orders * 1.5, `orders ${a.orders} -> ${b.orders}`);
  assert.ok(b.delivery_costs / b.orders > (a.delivery_costs / a.orders) * 1.3, "carrier cost per order rose");
  assert.equal(seen.length, 8);
  assert.ok(seen.every(([d, now]) => d === now));
  // A neutral plug-in (every multiplier 1) changes nothing at all.
  const neutral = createSim({ world: freshWorld("demo"), biz, seed: 5, plugins: [{ name: "n", modifiers: () => ({ demand: { all: 1 }, visits: 1, costs: { carrier: 1, goods: 1, card_fee: 1 } }) }] });
  await stepDays(neutral, 8);
  assert.deepEqual(neutral.totals(), plain.totals());
  // A broken plug-in is noted on the day, not fatal.
  const broken = createSim({ world: freshWorld("demo"), biz, seed: 5, plugins: [{ name: "bad", afterDay() { throw new Error("oops"); } }] });
  const [line] = await stepDays(broken, 1);
  assert.match(line.problems[0], /bad afterDay failed: oops/);
});

test("a product multiplier moves sales towards that product", async () => {
  const count = async (plugins) => {
    const world = freshWorld("demo");
    const sim = createSim({ world, biz, seed: 11, plugins, scale: 1 }); // full-size demand, so ten days show the shift
    const before = world.state.orders.length;
    await stepDays(sim, 10);
    return world.state.orders.slice(before).flatMap((o) => o.items).filter((l) => l.sku.startsWith("OT-HELM")).length;
  };
  const sku = freshWorld("demo").products.find((p) => p.id === "indoor-helmet").variants[0].sku;
  assert.ok(sku.startsWith("OT-HELM"), sku);
  const base = await count([]), more = await count([{ name: "viral", modifiers: () => ({ demand: { products: { "indoor-helmet": 4 } } }) }]);
  assert.ok(more > base * 2, `helmets ${base} -> ${more}`);
});

test("scale comes from the world's company.scale unless an option says otherwise", async () => {
  const world = freshWorld("demo");
  assert.equal(scaleFor(null, world), world.state.company.scale, "the generated world carries its own scale");
  delete world.state.company.scale;
  assert.equal(scaleFor(null, world), 1, "no company.scale: today's behaviour");
  world.state.company = { ...(world.state.company || {}), scale: 0.25 };
  assert.equal(scaleFor(undefined, world), 0.25);
  assert.equal(scaleFor(2, world), 2, "an explicit option wins");
  const fromWorld = createSim({ world, biz, seed: 2 });
  assert.equal(fromWorld.scale, 0.25);
  await stepDays(fromWorld, 6);
  const other = freshWorld("demo");
  other.state.company = { ...(other.state.company || {}), scale: 0.25 };
  const explicit = createSim({ world: other, biz, seed: 2, scale: 0.25 });
  await stepDays(explicit, 6);
  assert.deepEqual(fromWorld.totals(), explicit.totals());
  const full = createSim({ world: freshWorld("demo"), biz, seed: 2, scale: 1 }); // the full-size business
  await stepDays(full, 6);
  assert.ok(fromWorld.totals().totals.orders < full.totals().totals.orders / 2, "a quarter-size business sells far less");
  assert.ok(fromWorld.totals().totals.staff_pay < full.totals().totals.staff_pay / 2, "and pays far less");
});

test("levers: the sim follows the marketing budget and the staffing settings from the next day", async () => {
  const run = async (act) => {
    const world = freshWorld("demo");
    const sim = createSim({ world, biz, seed: 4 });
    if (act) act(world);
    await stepDays(sim, 10);
    return sim.totals().totals;
  };
  const base = await run(null);
  const loud = await run((w) => assert.equal(manager(w).call("set_marketing_budget", { monthly: 26000 }).ok, true));
  assert.ok(loud.marketing > base.marketing * 9, "spend follows the budget");
  assert.ok(loud.orders > base.orders, "more spend brings more orders");
  const quiet = await run((w) => manager(w).call("set_marketing_budget", { monthly: 0 }));
  assert.equal(quiet.marketing, 0);
  assert.ok(quiet.orders < base.orders);
  const lean = await run((w) => {
    const team = manager(w).call("get_levers", {}).data.team;
    const agent = team.find((p) => p.role === "support_agent");
    assert.equal(manager(w).call("set_staffing", { action: "remove", staff_id: agent.id }).ok, true);
  });
  assert.ok(lean.staff_pay < base.staff_pay, "fewer people, less pay");
  const bigger = await run((w) => assert.equal(manager(w).call("set_staffing", { action: "add", role: "support_agent", weekly_hours: 37.5 }).ok, true));
  assert.ok(bigger.staff_pay > base.staff_pay);
  // A small shop already answers within the working day, so another agent can only help, never hurt.
  assert.ok(bigger.frt_sum / bigger.frt_n <= base.frt_sum / base.frt_n, "another agent is never slower");
  // Setting the plan's own numbers changes nothing at all.
  const same = await run((w) => manager(w).call("set_marketing_budget", { monthly: Math.round(biz.costs.marketing_per_month * w.state.company.scale * 100) / 100 }));
  assert.deepEqual(same, base);
});

test("catalogue: a launched product sells (more while new), and ending one moves part of its demand to its category", async () => {
  const { createWorld } = await import("../../infrastructure/engine/all.js");
  const { attachPlan } = await import("../../infrastructure/engine/levers.js");
  const { dataFor } = await import("../../infrastructure/server/world-data.mjs");
  const base = dataFor("demo");
  const pack = base.products.find((p) => p.id === "daypack");
  // A product the business files have never heard of (no weight in business/data/sim.json), ready to launch.
  const bag = { ...structuredClone(pack), id: "night-bag", name: "The Night Bag", status: "prepared", variants: [{ ...pack.variants[0], sku: "OT-NBAG", price: 99 }], accessories: [] };
  const make = () => {
    const w = attachPlan(createWorld({ ...base, products: [...base.products, bag] }), { staff: biz.staff.staff, marketing_per_month: 52 });
    w.state.stock["OT-NBAG"] = { on_hand: 400, restock_date: null };
    return w;
  };
  const sold = (w, sku, from, to) => w.state.orders.filter((o) => o.placed_at.slice(0, 10) >= from && o.placed_at.slice(0, 10) <= to).flatMap((o) => o.items).filter((l) => l.sku === sku).reduce((n, l) => n + l.qty, 0);
  const plain = make(), launched = make();
  const a = createSim({ world: plain, biz, seed: 8, scale: 1 }), b = createSim({ world: launched, biz, seed: 8, scale: 1 });
  assert.equal(manager(launched).call("launch_product", { product_id: "night-bag" }).ok, true);
  await stepDays(a, 70); await stepDays(b, 70);
  assert.equal(sold(plain, "OT-NBAG", "2026-11-24", "2027-12-31"), 0);
  const early = sold(launched, "OT-NBAG", "2026-11-24", "2026-12-07"), late = sold(launched, "OT-NBAG", "2027-01-19", "2027-02-01");
  assert.ok(early > 0, "the new product sells");
  assert.ok(early > late, `novelty fades: first fortnight ${early}, a fortnight two months on ${late}`);
  assert.ok(b.totals().totals.orders > a.totals().totals.orders, "a new product brings some new orders");
  // Ending the daypack: it stops selling, and part of its demand moves to the rest of its category (here: the night bag).
  const ended = make();
  const c = createSim({ world: ended, biz, seed: 8, scale: 1 });
  manager(ended).call("launch_product", { product_id: "night-bag" });
  await stepDays(c, 35);
  assert.equal(manager(ended).call("discontinue_product", { product_id: "daypack", stock: "sell_through" }).ok, true);
  await stepDays(c, 35);
  assert.equal(sold(ended, "OT-PACK", "2027-01-01", "2027-02-01"), 0, "an ended product no longer sells");
  assert.ok(sold(ended, "OT-NBAG", "2026-12-29", "2027-02-01") > sold(launched, "OT-NBAG", "2026-12-29", "2027-02-01"), "its category neighbour picks up some of its demand");
});

test("people the simulation adds are real, unused characters, never 'Customer N'", async () => {
  const world = freshWorld("demo");
  const before = new Set(world.state.customers.map((c) => c.name));
  const sim = createSim({ world, biz, seed: 6, scale: 1, customerModel: "rich" });
  await stepDays(sim, 30);
  const added = world.state.customers.filter((c) => !before.has(c.name));
  assert.ok(added.length > 5, `only ${added.length} new customers`);
  assert.ok(added.every((c) => !/^Customer \d+$/.test(c.name)), added.map((c) => c.name).join(", "));
  const names = world.state.customers.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, "no two customers share a name");
});
