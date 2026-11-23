// Tests for the population. Run: node --test simulation/world/population.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { buildPopulation } from "./build-population.mjs";
import { traitsFor, behaviourFrom, drawTraits, apportion } from "./population.mjs";
import { coverage, cramersV, stereotypeCheck, stereotypeVerdict, outcomesByGroup } from "./report-population.mjs";
import { makeRich } from "../simulator/customers.mjs";
import { createSim } from "../simulator/core.mjs";
import { loadBusiness } from "../simulator/data.mjs";
import { freshWorld } from "../../infrastructure/server/world-data.mjs";
import "./people.js";

const read = (rel) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const sources = read("./population-sources.json"), characters = read("../../business/data/characters.json");
const pop = buildPopulation(characters, sources, { seed: 1 });

test("apportion adds up exactly", () => {
  assert.deepEqual(apportion([1, 1, 1], 10).reduce((a, b) => a + b), 10);
  assert.deepEqual(apportion([50, 50], 7), [4, 3]);
});

test("same seed gives the same population; another seed gives a different one", () => {
  assert.equal(JSON.stringify(buildPopulation(characters, sources, { seed: 1 })), JSON.stringify(pop));
  assert.notEqual(JSON.stringify(buildPopulation(characters, sources, { seed: 2 }).people), JSON.stringify(pop.people));
});

test("everyone has every trait and the shipped file is the seed-1 build", () => {
  assert.equal(pop.count, characters.length);
  for (const t of Object.values(pop.people)) for (const k of ["age", "household", "income", "employment", "area", "online", "channel"]) assert.ok(t[k], k);
  const file = read("../../business/data/population.json");
  assert.equal(file.count, pop.count);
  assert.deepEqual(file.people[Object.keys(pop.people)[5]], pop.people[Object.keys(pop.people)[5]]);
});

test("every marginal is within 0.2 points of its target", () => {
  for (const c of coverage(pop)) assert.ok(c.maxDiff < 0.2, `${c.trait} off by ${c.maxDiff}`);
});

test("dependencies by age are sensible", () => {
  const p = Object.values(pop.people);
  assert.ok(p.filter((x) => x.age === "75+" && x.employment === "retired").length / p.filter((x) => x.age === "75+").length > 0.9);
  assert.equal(p.filter((x) => x.age === "75+" && x.household === "couple_children").length, 0);
  assert.ok(p.filter((x) => x.employment === "student").every((x) => ["18-24", "25-34"].includes(x.age)));
  assert.ok(p.filter((x) => x.circumstances.includes("new_parent")).every((x) => ["couple_children", "lone_parent"].includes(x.household)));
});

test("traits are not tied to the story (book, kind, author era)", () => {
  const v = stereotypeVerdict(stereotypeCheck(pop, characters, 20));
  assert.ok(v.ok, JSON.stringify(v));
  // Luck differs by seed, so also check the average over several seeds.
  const main = ["age", "household", "income", "employment", "area", "online", "channel"];
  let sum = 0, n = 0;
  for (const seed of [2, 3, 4]) {
    const q = buildPopulation(characters, sources, { seed }), rows = Object.values(q.people);
    for (const t of main) for (const s of ["from", "kind"]) { sum += cramersV(rows.map((r) => r[t]), rows.map((r) => characters.find((c) => c.name === r.name)[s])); n++; }
  }
  assert.ok(sum / n < 0.03, `mean V ${sum / n}`);
});

test("cramersV is high for identical columns and about zero for unrelated ones", () => {
  const a = Array.from({ length: 400 }, (_, i) => i % 4);
  assert.ok(cramersV(a, a) > 0.95);
  assert.ok(cramersV(a, a.map((_, i) => (i * 7 + 3) % 5)) < 0.1);
});

test("behaviourFrom is bounded, pure, and neutral without traits", () => {
  for (const t of Object.values(pop.people)) {
    const b = behaviourFrom(t);
    assert.ok(b.price >= 0.7 && b.price <= 1.5 && b.patience >= 0.7 && b.patience <= 1.4 && b.rate >= 0.5 && b.rate <= 1.5);
    assert.ok(b.contact_window[0] < b.contact_window[1]);
    for (const m of Object.values(b.categories)) assert.ok(m >= 0.8 && m <= 2);
    assert.deepEqual(behaviourFrom(t), b);
  }
  assert.equal(behaviourFrom(null).price, 1);
  assert.equal(traitsFor({ name: "Hamlet" }, null), null);
});

test("lower income means more price sensitive, nothing else about identity matters", () => {
  const base = { age: "35-44", household: "couple_no_children", employment: "employed", online: "monthly", channel: "email", circumstances: [] };
  assert.ok(behaviourFrom({ ...base, income: "Q1" }).price > behaviourFrom({ ...base, income: "Q5" }).price);
});

test("someone not in the file gets repeatable drawn traits", () => {
  const a = traitsFor({ name: "A Stranger Entirely" }, pop), b = traitsFor({ name: "A Stranger Entirely" }, pop);
  assert.deepEqual(a, b);
  assert.equal(a.known, false);
  assert.deepEqual(drawTraits("x", pop), drawTraits("x", pop));
  assert.equal(traitsFor({ name: "Hamlet" }, pop).name, "Hamlet");
});

test("ties are two-way and only within a book", () => {
  for (const [k, t] of Object.entries(pop.people)) for (const [o, type] of t.ties) {
    assert.ok(pop.people[o].ties.some((x) => x[0] === k && x[1] === type));
    assert.equal(pop.people[o].book, t.book);
  }
});

test("without the file the customer model is exactly as before; with it only the circumstance effects apply", () => {
  const cfg = loadBusiness().sim.customer_model;
  const plain = JSON.parse(JSON.stringify(cfg)); // clone drops the non-enumerable population: the "file absent" case
  const mk = () => Array.from({ length: 5 }, (_, i) => ({ name: Object.values(pop.people)[i].name, email: `p${i}@example.com`, kind: "regular", w: 1, s: 0 }));
  const a = mk(), b = mk();
  makeRich({ pop: a, cfg: plain, kindWeight: {}, popSeed: 1, lambda0: 1 });
  makeRich({ pop: b, cfg: { ...plain, population: pop }, kindWeight: {}, popSeed: 1, lambda0: 1 });
  a.forEach((c, i) => {
    const beh = behaviourFrom(traitsFor(b[i], pop));
    assert.equal(c.channel, undefined);
    assert.equal(c.p, b[i].p); // same random draws either way
    assert.deepEqual(c.m, b[i].m);
    assert.ok(Math.abs(b[i].t.price - Math.round(c.t.price * beh.price * 1000) / 1000) < 1e-9);
    assert.equal(b[i].channel, beh.channel);
  });
});

test("a short rich simulation is unchanged without the file and repeats exactly", async () => {
  const biz = loadBusiness();
  const bare = { ...biz, sim: JSON.parse(JSON.stringify(biz.sim)) };
  const run = async (b) => { const sim = createSim({ world: freshWorld("demo"), biz: b, seed: 4, customerModel: "rich" }); for (let i = 0; i < 6; i++) await sim.step(); return JSON.stringify(sim.totals()); };
  assert.equal(await run(bare), await run(bare));
  assert.ok(biz.sim.customer_model.population, "the shipped population is loaded when present");
  assert.equal(await run(biz), await run(biz));
});

test("engine tools: get_person and list_people (world lens only)", () => {
  const w = freshWorld("demo");
  // WHY: a manager key can be handed to a connected AI; a real shop never knows its customers' age or income.
  const mgr = w.session({ role: "world" }), other = w.session({ role: "assistant" }), boss = w.session({ role: "manager" });
  assert.equal(other.call("get_person", { name: "Hamlet" }).error.code, "forbidden");
  assert.equal(boss.call("get_person", { name: "Hamlet" }).error.code, "forbidden");
  const r = mgr.call("get_person", { name: "Hamlet" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.data.age && Array.isArray(r.data.knows));
  const l = mgr.call("list_people", { trait: "income=Q1", limit: 3 });
  assert.equal(l.ok, true, JSON.stringify(l));
  assert.equal(l.data.shown, 3);
  assert.ok(l.data.total > 500 && l.data.total < 700);
  assert.equal(mgr.call("get_person", { name: "Nobody At All" }).error.code, "not_found");
});

test("outcomesByGroup: means, counts, largest gap, and too few to judge", () => {
  const names = Object.values(pop.people);
  const records = names.slice(0, 600).map((p) => ({ name: p.name, satisfaction: p.area === "rural" ? 3 : 4, refund: p.area === "rural" }));
  const r = outcomesByGroup(records, pop, "area", { minGroup: 30 });
  assert.equal(r.metrics.satisfaction.groups.urban.mean, 4);
  assert.equal(r.metrics.satisfaction.groups.rural.mean, 3);
  assert.deepEqual(r.metrics.satisfaction.largest_gap.between.slice().sort(), ["rural", "urban"]);
  assert.equal(r.metrics.satisfaction.largest_gap.gap, 1);
  assert.equal(r.metrics.refund.groups.rural.mean, 1);
  // Small groups: no mean, and no gap when fewer than two groups are big enough.
  const small = outcomesByGroup(records.slice(0, 12), pop, "income", { minGroup: 30 });
  assert.equal(small.metrics.satisfaction.largest_gap.note, "too few to judge");
  assert.equal(Object.values(small.metrics.satisfaction.groups)[0].mean, null);
  const fn = outcomesByGroup(records, pop, "circumstance:carer", { minGroup: 5 });
  assert.ok(fn.metrics.satisfaction.groups.no.n > 0);
  assert.equal(outcomesByGroup([{ name: "Unknown Person Zzz", satisfaction: 1 }], null, "area").unmatched, 1);
});
