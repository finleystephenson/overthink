// The lab's tests: no difference without a change, the right direction with one, the same answer twice, branches that
// cannot leak into each other, limits that hold, policies that reach customer behaviour, scopes that are enforced, and
// /overthink end to end. Small runs on the demo world so the suite stays quick.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runExperiment, checkExperiment, DEFAULT_LIMITS } from "./experiment.mjs";
import { buildResults } from "./results.mjs";
import { explainArm } from "./explain.mjs";
import { labRoutes, webLimits } from "./routes.mjs";
import { startHost, fresh } from "./branch.mjs";
import { overthink } from "./overthink.mjs";
import { planFromIdea } from "./plan.mjs";
import { businessData } from "../../infrastructure/server/world-data.mjs";

const demo = (arms, o = {}) => ({ title: "test", start: { size: "demo" }, days: o.days ?? 20, seeds: o.seeds ?? 3, arms });
const strip = (res) => JSON.stringify({ ...res, timings: null });

test("an arm with no interventions shows exactly zero difference, record for record", async () => {
  const raw = await runExperiment(demo([{ id: "same", interventions: [] }], { days: 15, seeds: 2 }));
  const res = buildResults(raw);
  for (const [k, m] of Object.entries(res.arms.same.measures)) assert.equal(m.difference.mean, 0, `${k} should not move`);
  for (let s = 0; s < 2; s++) assert.deepEqual(raw.arms.same.seeds[s].series, raw.arms.baseline.seeds[s].series);
  assert.deepEqual(raw.arms.same.seeds[0].records, raw.arms.baseline.seeds[0].records);
  assert.match(res.arms.same.verdict, /no difference at all/);
});

test("a 10% price rise lowers orders, and revenue moves the way the price elasticity says", async () => {
  const raw = await runExperiment(demo([{ id: "dearer", interventions: [{ type: "price_change", params: { percent: 10 } }] }], { days: 30, seeds: 3 }));
  const m = buildResults(raw).arms.dearer.measures;
  assert.ok(m.orders.difference.mean < 0, "fewer orders");
  for (let s = 0; s < 3; s++) assert.ok(raw.arms.dearer.seeds[s].measures.orders <= raw.arms.baseline.seeds[s].measures.orders, "never more orders in any seed");
  // Revenue ≈ orders × price: 1.1^(1 - e). With e above 1 revenue falls, below 1 it rises.
  const e = businessData().sim.demand.price_elasticity;
  assert.equal(Math.sign(m.revenue.difference.mean), Math.sign(1 - e), `revenue should go ${e > 1 ? "down" : "up"} with elasticity ${e}`);
  assert.ok(Math.abs(raw.arms.dearer.seeds[0].channels.price_index - 1.1) < 0.01, "the price index customers see is 1.1");
});

test("the same experiment gives the same results", async () => {
  const spec = demo([{ id: "a", interventions: [{ type: "marketing_budget", params: { multiply: 2 } }, { type: "postal_strike", day: 3, params: { days: 5 } }] }], { days: 12, seeds: 2 });
  const one = buildResults(await runExperiment(spec)), two = buildResults(await runExperiment(spec));
  assert.equal(strip(one), strip(two));
});

test("branches are isolated: an arm's changes never appear in another arm or the baseline", async () => {
  const raw = await runExperiment(demo([
    { id: "changed", interventions: [{ type: "price_change", params: { percent: 20 } }, { type: "world_setting", params: { path: "lab_test.flag", value: 1 } }, { type: "returns_window", params: { days: 5 } }, { type: "staffing", params: {} }] },
    { id: "untouched", interventions: [] },
  ], { days: 8, seeds: 2 }));
  for (const id of ["baseline", "untouched"]) {
    for (const s of raw.arms[id].seeds) {
      assert.equal(s.channels.price_index, 1);
      assert.equal(s.channels.world_settings, null);
      assert.equal(s.channels.team_size, raw.arms.baseline.seeds[0].channels.team_size);
    }
  }
  const c = raw.arms.changed.seeds[0].channels;
  assert.equal(c.world_settings.lab_test.flag, 1);
  assert.equal(c.world_settings.policies["returns.window_days"], 5);
  assert.equal(c.team_size, raw.arms.baseline.seeds[0].channels.team_size + 1);
  assert.equal(fresh("demo").business.returns.window_days, 30, "the business rules on disk and in new worlds are untouched");
});

test("limits are enforced", async () => {
  const lim = { ...DEFAULT_LIMITS, maxDays: 10, maxSeeds: 2, maxArms: 1, maxInterventions: 1 };
  assert.throws(() => checkExperiment(demo([{ interventions: [] }], { days: 11, seeds: 1 }), lim), /days/);
  assert.throws(() => checkExperiment(demo([{ interventions: [] }], { days: 5, seeds: 3 }), lim), /seeds/);
  assert.throws(() => checkExperiment(demo([{ interventions: [] }, { id: "b", interventions: [] }], { days: 5, seeds: 1 }), lim), /arms/);
  assert.throws(() => checkExperiment(demo([{ interventions: [{ type: "sale" }, { type: "heatwave" }] }], { days: 5, seeds: 1 }), lim), /interventions/);
  assert.throws(() => checkExperiment(demo([{ interventions: [{ type: "price_change", params: { percent: 900 } }] }], { days: 5, seeds: 1 })), /at most 300/);
  assert.throws(() => checkExperiment(demo([{ interventions: [{ type: "connect_ai", day: 2, params: { connection: { kind: "none" } } }] }], { days: 5, seeds: 1 })), /day 0/);
  // Over HTTP: work per request, shell commands, and runs at once.
  const routes = labRoutes({ readJson: async (req) => req.body, limits: webLimits({ maxConcurrent: 1, maxWork: 100, allowCommands: false }) });
  const post = routes.find(([m, p]) => m === "POST" && p.test("/lab/experiments"))[2];
  await assert.rejects(post({ body: { experiment: demo([{ interventions: [] }], { days: 30, seeds: 2 }) } }), /arm-days/);
  await assert.rejects(post({ body: { experiment: demo([{ interventions: [{ type: "connect_ai", params: { connection: { kind: "cmd", cmd: "echo hi" } } }] }], { days: 5, seeds: 1 }) } }), (e) => e.code === "forbidden");
  const [status] = await post({ body: { experiment: demo([{ interventions: [] }], { days: 5, seeds: 1 }) } });
  assert.equal(status, 202);
  await assert.rejects(post({ body: { experiment: demo([{ interventions: [] }], { days: 5, seeds: 1 }) } }), (e) => e.code === "unavailable");
});

test("policies reach customer behaviour: delivery charges move orders, a short returns window leaves customers less satisfied", async () => {
  const raw = await runExperiment(demo([
    { id: "dear-delivery", interventions: [{ type: "delivery_charges", params: { price: 7.95, free_over: null } }] },
    { id: "free-delivery", interventions: [{ type: "delivery_charges", params: { price: 0, free_over: null } }] },
    { id: "short-window", interventions: [{ type: "returns_window", params: { days: 5 } }] },
  ], { days: 30, seeds: 3 }));
  const m = buildResults(raw).arms;
  assert.ok(m["dear-delivery"].measures.orders.difference.mean < 0, "dearer delivery, fewer orders");
  assert.ok(m["free-delivery"].measures.orders.difference.mean > 0, "free delivery, more orders");
  assert.ok(m["short-window"].measures.customer_satisfaction.difference.mean < 0, "refused returns lower satisfaction");
});

test("a scope is enforced by the lab's server and written in the trace", async () => {
  const host = await startHost();
  try {
    const world = fresh("demo");
    const h = host.attach(world, "demo", "assistant", { read: ["catalogue"], act: [] });
    const call = (tool, body) => fetch(`${host.apiUrl}/tools/${tool}`, { method: "POST", headers: { Authorization: `Bearer ${h.token}`, "Content-Type": "application/json", "X-Session-Id": "s1" }, body: JSON.stringify(body) }).then((r) => r.json());
    assert.equal((await call("search_catalogue", { query: "umbrella" })).ok, true);
    const no = await call("verify_customer", { reference: "ORD-10690", email_or_postcode: "X" });
    assert.equal(no.error.code, "out_of_scope");
    const t = h.sb.trace.find((e) => e.tool === "verify_customer");
    assert.equal(t.error.code, "out_of_scope");
  } finally { await host.close(); }
});

test("overthink runs end to end with the example responder, and scores the injection", async () => {
  const run = await overthink({ products: [{ kind: "cmd", cmd: "node simulation/simulator/examples/simple-responder.mjs", label: "responder" }], reference: false, repeats: 2, days: 5, seeds: 1, only: ["prompt-injection", "where-is-my-order", "parcel-never-arrived"] });
  const card = run.cards[0];
  assert.equal(card.product, "responder");
  const inj = run.situations.filter((s) => s.situation === "prompt-injection");
  assert.equal(inj.length, 2);
  assert.ok(inj[0].checks.some((c) => c.kind === "must_not_succeed"));
  assert.match(card.metrics.safety.injection_resisted, /^\d of 2$/);
  assert.equal(card.metrics.consistency.situations_repeated, 3);
  const multi = run.situations.find((s) => s.situation === "parcel-never-arrived");
  assert.ok(multi.conversation.length >= 4, "the customer followed up");
  for (const k of ["understood", "retrieved_records", "followed_policy", "used_tools_correctly", "no_unauthorised_change", "resolved", "customer_response"]) assert.ok(typeof multi.process[k].evidence === "string");
  assert.ok(card.metrics.business_outcomes.verdict);
  assert.equal(card.metrics.fairness.status === "measured" || /not measured/.test(card.metrics.fairness.status), true);
});

test("an idea becomes a plan that runs, and says what the world cannot model", async () => {
  for (const idea of ["What if we introduced free delivery on orders over £50?", "What happens if we change the returns policy?", "What if a competitor launched a similar product cheaper?", "What if we raise all prices 10%?"]) {
    const plan = await planFromIdea(idea);
    assert.ok(plan.experiment.arms.length >= 1, idea);
    assert.doesNotThrow(() => checkExperiment(plan.experiment), idea);
    assert.ok(plan.cannot_model.length >= 1, idea);
  }
  const supplierAi = await planFromIdea("Could an AI manage supplier communications?");
  assert.ok(supplierAi.would_need_building.length >= 1);
  assert.equal((await planFromIdea("I've built an AI customer service agent, test it on enquiries, complaints and returns")).kind, "overthink");
});

test("the explanation traces the price change through prices to orders, and names people affected", async () => {
  const raw = await runExperiment(demo([{ id: "dearer", interventions: [{ type: "price_change", params: { percent: 10 } }] }], { days: 20, seeds: 2 }));
  const ex = explainArm(raw, "dearer");
  assert.ok(ex.what_was_done[0].record_changes[0].startsWith("Price of "));
  const chain = ex.chains.find((c) => /Prices customers see/.test(c.channel));
  assert.ok(chain && chain.measures.some((m) => m.startsWith("Orders")));
  assert.ok(ex.people_affected.customers_with_different_outcomes > 0);
  assert.ok(ex.people_affected.examples[0].name);
});
