// Tests for suppliers that talk (simulation/world/supplier-side.mjs, infrastructure/engine/suppliers-comms.js), product-level competition
// (simulation/world/competitors.mjs productCompetition) and basket top-up (simulation/simulator/top-up.mjs). Run: node --test simulation/world/supplier-side.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { freshWorld, worldFromState } from "../../infrastructure/server/world-data.mjs";
import { orgsFor } from "./organisations.mjs";
import { supplierSideAfterDay, standingOf, readRequest, supplierPeople } from "./supplier-side.mjs";
import { competitorEffects, productCompetition } from "./competitors.mjs";
import { worldPlugins } from "./plugins.mjs";
import { createLive } from "../simulator/live.mjs";
import { createSim } from "../simulator/core.mjs";
import { loadBusiness } from "../simulator/data.mjs";
import { topUpBasket } from "../simulator/top-up.mjs";
import { planFromIdea } from "../lab/plan.mjs";
import { checkExperiment } from "../lab/experiment.mjs";

const biz = loadBusiness();
const SEED = 5;
const TUE = "2026-11-24", WED = "2026-11-25";

/** A demo world with one fresh, small order to Beckside Mill (SUP-03, 14-day lead time) and nothing else open there. */
function withOrder() {
  const world = freshWorld("demo");
  for (const p of world.state.purchase_orders) if (p.supplier_id === "SUP-03" && ["ordered", "late"].includes(p.status)) p.status = "received";
  // WHY: the demo world's history has the mill in trouble that week; these tests set their own conditions.
  world.state.supplier_disruptions = world.state.supplier_disruptions.filter((d) => d.supplier !== "SUP-03");
  const sup = world.state.suppliers.find((s) => s.id === "SUP-03");
  const r = world.session({ role: "buyer" }).call("create_purchase_order", { supplier_id: "SUP-03", lines: [{ sku: sup.skus[0], qty: 12 }] });
  assert.equal(r.ok, true);
  return { world, sup, po: world.state.purchase_orders.find((p) => p.number === r.data.number) };
}

const email = (world, sup, body, subject = "Our order") =>
  world.session({ role: "buyer" }).call("send_email", { mailbox: "suppliers", to: [supplierPeople(sup).from.address], subject, body });
const day = (world, date) => supplierSideAfterDay(orgsFor(world.state).supplier_constraints, world.state, date, SEED, { products: world.products });
const replyTo = (world, emailId) => {
  const req = world.state.supplier_requests.find((r) => r.email_id === emailId);
  return req && world.state.emails.find((e) => e.id === req.reply_id);
};

test("reading a request: what is asked and how it is said", () => {
  const r = readRequest("Hello, could you bring PO-4001 forward please? Thank you.");
  assert.deepEqual(r.asks, ["expedite"]);
  assert.equal(r.po, "PO-4001");
  assert.equal(r.polite, true);
  assert.equal(r.rude, false);
  assert.equal(readRequest("This is ridiculous, sort it out!!!").rude, true);
  assert.equal(readRequest("Could you change the quantity on PO-1 to 40?").qty, 40);
});

test("supplier replies are deterministic and come on the next working day", () => {
  const runs = [withOrder(), withOrder()].map(({ world, sup, po }) => {
    const sent = email(world, sup, `Hello, could you bring ${po.number} forward, please? Thank you.`);
    day(world, "2026-11-23");
    assert.equal(replyTo(world, sent.data.id), undefined, "nothing on the same day");
    day(world, TUE);
    return { reply: replyTo(world, sent.data.id), requests: world.state.supplier_requests, po };
  });
  assert.ok(runs[0].reply, "a reply came");
  assert.deepEqual(runs[0].reply, runs[1].reply);
  assert.deepEqual(runs[0].requests, runs[1].requests);
  assert.deepEqual(runs[0].po, runs[1].po);
  assert.equal(runs[0].reply.from.name, "Mrs Glegg, Beckside Mill");
  assert.equal(runs[0].reply.links.po, runs[0].po.number);
  assert.equal(runs[0].reply.mailbox, "suppliers");
});

test("an expedite with spare capacity shortens the order's lead time; at capacity it is refused with a reason", () => {
  const a = withOrder();
  const due = a.po.due_at;
  const sent = email(a.world, a.sup, `Hello, could you bring ${a.po.number} forward, please?`);
  day(a.world, TUE);
  assert.ok(a.po.due_at < due, `${a.po.due_at} is before ${due}`);
  assert.equal(a.po.amendments.length, 1);
  assert.match(replyTo(a.world, sent.data.id).body, /bring PO-\d+ forward to \d+ \w+ \(\d+ days? sooner\)/);
  assert.equal(a.world.state.supplier_requests.find((r) => r.email_id === sent.data.id).decision, "agreed");

  const b = withOrder();
  // A big open order fills the mill's week.
  b.world.session({ role: "manager" }).call("create_purchase_order", { supplier_id: "SUP-03", lines: [{ sku: b.sup.skus[0], qty: 2000 }] });
  const due2 = b.po.due_at;
  const sent2 = email(b.world, b.sup, `Could you bring ${b.po.number} forward, please?`);
  day(b.world, TUE);
  assert.equal(b.po.due_at, due2, "unchanged");
  const req = b.world.state.supplier_requests.find((r) => r.email_id === sent2.data.id);
  assert.equal(req.decision, "refused");
  assert.match(req.reason, /full week's work/);
  assert.match(replyTo(b.world, sent2.data.id).body, /can't bring PO-\d+ forward: we are already making \d+ units/);

  const c = withOrder();
  c.world.state.world_settings = { supplier_disruptions: [{ supplier: "SUP-03", from: "2026-11-24", to: "2026-12-20", capacity_factor: 0.5, extra_lead_days: 5 }] };
  const sent3 = email(c.world, c.sup, `Could you bring ${c.po.number} forward, please?`);
  day(c.world, TUE);
  assert.match(replyTo(c.world, sent3.data.id).body, /short of hands and materials/);
});

test("rude emails and late payment make later replies slower and less flexible", () => {
  const { world, sup, po } = withOrder();
  assert.equal(standingOf(world.state, "SUP-03", TUE).score, 0);
  // Two rude emails, answered.
  for (const t of ["This is ridiculous. Sort it out!!!", "Your service is useless. Where is my order?"]) email(world, sup, `${t} ${po.number}`);
  day(world, TUE);
  const rudeReply = world.state.emails.filter((e) => e.key?.startsWith("supplier|")).at(-1);
  assert.match(rudeReply.body, /civil/);
  // A bill paid well after its terms.
  const old = world.state.purchase_orders.find((p) => p.supplier_id === "SUP-03" && p.received_at && p.paid_at);
  old.received_at = "2026-10-01T10:00:00Z"; old.paid_at = "2026-11-20T10:00:00Z";
  // The same polite request now waits two working days and is refused.
  const due = po.due_at;
  const sent = email(world, sup, `Hello, could you bring ${po.number} forward, please? Thank you.`);
  world.state.emails.find((e) => e.id === sent.data.id).at = `${TUE}T11:00:00Z`;
  day(world, WED);
  assert.equal(replyTo(world, sent.data.id), undefined, "a cool supplier takes two working days");
  // (The second rude email, already cool by then, was answered a day later too.)
  const st = standingOf(world.state, "SUP-03", WED);
  assert.equal(st.rude, 2);
  assert.equal(st.late_payments, 1);
  assert.equal(st.no_favours, true);
  day(world, "2026-11-26");
  const reply = replyTo(world, sent.data.id);
  assert.match(reply.body, /we can't make changes to your orders just now/);
  assert.match(reply.body, /2 rude emails and 1 bill paid late/);
  assert.equal(po.due_at, due);
});

test("an untouched live world and its twin stay identical with the supplier side on; an email to a supplier changes only the live one", async () => {
  const plugins = worldPlugins({ products: freshWorld("demo").products });
  assert.ok(plugins.some((p) => p.name === "world-supplier-side"));
  const make = () => { const world = freshWorld("demo"); return { world, live: createLive({ world, biz, seed: 9, makeWorld: (s) => worldFromState("demo", s), plugins }) }; };
  const a = make();
  await a.live.advance(15);
  const strip = (s) => JSON.stringify({ ...s, audit: [] });
  assert.equal(strip(a.world.state), strip(a.live.shadowWorld().state));

  const b = make();
  await b.live.advance(1);
  const open = b.world.state.purchase_orders.find((p) => p.status === "ordered" && supplierPeople(b.world.state.suppliers.find((s) => s.id === p.supplier_id))?.side.expedite_share > 0);
  assert.ok(open, "an open order to ask about");
  const sup = b.world.state.suppliers.find((s) => s.id === open.supplier_id);
  assert.equal(email(b.world, sup, `Hello, what is your lead time at the moment, and when will ${open.number} arrive? Thank you.`).ok, true);
  await b.live.advance(3);
  const req = b.world.state.supplier_requests.find((r) => r.email_id && r.po === open.number);
  assert.equal(req.kind, "lead_time");
  assert.ok(!b.live.shadowWorld().state.supplier_requests.some((r) => r.email_id), "the twin never had the email");
});

test("a rival's copy of one product moves that product's demand more than its siblings'", async () => {
  const world = freshWorld("demo");
  const defs = orgsFor(world.state);
  world.state.world_settings = { competitor_moves: [{ competitor: "gadgetry-goose", launch_category: "tech", product: "blip", price_factor: 0.8, from: "2026-11-24", to: "2027-01-31" }] };
  const p = productCompetition(defs, world.state, "2026-11-30", world.products);
  assert.ok(p.products.blip < 0.85, `blip × ${p.products.blip}`);
  assert.equal(p.products["boombox-mini"], undefined);
  assert.equal(competitorEffects(defs, world.state, "2026-11-30", ["tech"]).categories.tech, undefined, "not the whole category");
  assert.match(p.why[0].because, /cheaper copy of Blip/);

  // Through the simulator: fewer Blips sold than with no copy; the other tech product barely moves.
  const units = async (settings) => {
    const w = freshWorld("demo");
    if (settings) w.state.world_settings = settings;
    const sim = createSim({ world: w, biz, seed: 4, plugins: worldPlugins({ products: w.products }), compact: false });
    for (let i = 0; i < 40; i++) await sim.step();
    const n = { blip: 0, "boombox-mini": 0 };
    for (const o of w.state.orders) if (o.placed_at >= "2026-11-24") for (const l of o.items) { const id = w.index.skus[l.sku]?.product.id; if (id in n) n[id] += l.qty; }
    return n;
  };
  const base = await units(null), copied = await units(world.state.world_settings);
  const change = (k) => (copied[k] - base[k]) / Math.max(1, base[k]);
  assert.ok(change("blip") < -0.1, `blip ${base.blip} → ${copied.blip}`);
  assert.ok(Math.abs(change("boombox-mini")) < Math.abs(change("blip")), `boombox ${base["boombox-mini"]} → ${copied["boombox-mini"]}`);
});

test("basket top-up: near the threshold some shoppers add an item, only when a threshold applies", async () => {
  const methods = [{ id: "standard", price: 3.95, free_over: 50 }];
  const prices = { A: 35, B: 16, C: 9 };
  const base = { method: "standard", methods, priceOf: (s) => prices[s], products: [{ id: "x", variants: [{ sku: "B" }, { sku: "C" }] }], inStock: () => true, cfg: { rate: 0.3, near_share: 0.6 } };
  const draw = (...xs) => ({ next: () => xs.shift() });
  assert.equal(topUpBasket([{ sku: "A", qty: 1 }], { ...base, r: draw(0.1, 0.5) }).added, "B", "something that reaches £50");
  assert.equal(topUpBasket([{ sku: "A", qty: 1 }], { ...base, r: draw(0.5) }).added, null, "most do not");
  assert.equal(topUpBasket([{ sku: "C", qty: 1 }], { ...base, r: draw(0.1, 0.5) }).added, null, "too far below");
  assert.equal(topUpBasket([{ sku: "A", qty: 1 }], { ...base, methods: [{ id: "standard", price: 3.95, free_over: null }], r: draw(0.1, 0.5) }).added, null, "no threshold");
  assert.equal(topUpBasket([{ sku: "A", qty: 1 }], { ...base, method: "next-day", r: draw(0.1, 0.5) }).added, null, "only standard delivery");

  // Through the simulator: orders at or just over £50 with and without the top-up.
  const run = async (rate, freeOver) => {
    // WHY change the shared files in place and put them back: the business files are loaded once and shared.
    const w = freshWorld("standard");
    const std = w.business.delivery.methods.find((m) => m.id === "standard");
    const was = [biz.sim.demand.basket_top_up.rate, std.free_over];
    biz.sim.demand.basket_top_up.rate = rate; std.free_over = freeOver;
    const sim = createSim({ world: w, biz, seed: 2, compact: false });
    try { for (let i = 0; i < 30; i++) await sim.step(); } finally { [biz.sim.demand.basket_top_up.rate, std.free_over] = was; }
    const mine = w.state.orders.filter((o) => o.placed_at > "2026-11-23T10:00:00Z");
    return { atThreshold: mine.filter((o) => o.totals.items >= 50 && o.totals.items < 70).length, all: JSON.stringify(mine.map((o) => o.items)) };
  };
  const on = await run(0.3, 50), off = await run(0, 50);
  assert.ok(on.atThreshold > off.atThreshold, `${off.atThreshold} → ${on.atThreshold} orders at £50 to £70`);
  const noneOn = await run(0.3, null), noneOff = await run(0, null);
  assert.equal(noneOn.all, noneOff.all, "with no threshold the top-up never happens");
});

test("the lab plan for an AI managing supplier communications is runnable", async () => {
  const plan = await planFromIdea("Could an AI agent manage supplier communications?");
  assert.equal(plan.problem, undefined);
  assert.ok(!plan.cannot_model.some((c) => /no supplier emails/.test(c)));
  const ai = plan.experiment.arms.flatMap((a) => a.interventions).find((i) => i.type === "connect_ai");
  assert.equal(ai.params.role, "buyer");
  assert.ok(fs.existsSync(ai.params.connection.cmd.split(" ")[1]), "the example helper exists");
  checkExperiment(plan.experiment);
  for (const idea of ["What if we doubled marketing?", "What if we cut prices 5%?"]) {
    const p = await planFromIdea(idea);
    for (const a of p.experiment.arms) assert.match(a.id, /^[a-z0-9][a-z0-9_-]*$/i, a.id);
  }
});
