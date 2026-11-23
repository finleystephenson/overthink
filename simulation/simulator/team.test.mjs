// Tests for the team's work in the simulation and the connected business: tasks take real staff minutes, staff chat
// answers from the right person with real records, simulated reviews land in the records linked to their orders,
// review replies reach reputation, word of mouth, the twin stays exact with every plug-in, and one full customer journey.
// Run: node --test simulation/simulator/team.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLive } from "./live.mjs";
import { createSim } from "./core.mjs";
import { loadBusiness } from "./data.mjs";
import { loadPlugins } from "./plugins.mjs";
import { makeRich } from "./customers.mjs";
import { answerFor } from "./team-chat.mjs";
import { freshWorld, worldFromState, dataFor, DATA_DIR } from "../../infrastructure/server/world-data.mjs";

const biz = loadBusiness();
const products = dataFor("demo").products;
const makeWorld = (state) => worldFromState("demo", state);
const teamOnly = async () => (await loadPlugins({ only: ["events", "team"], products })).plugins;
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.data; };

test("a task takes real minutes from its assignee's day, is finished over days, and costs the business staff time", async () => {
  const world = freshWorld("demo");
  const live = createLive({ world, biz, seed: 4, makeWorld, plugins: await teamOnly() });
  const m = world.session({ role: "manager" });
  const kase = world.state.cases.find((k) => !["resolved", "closed"].includes(k.status) && k.customer_id);
  const t = ok(m.call("create_task", { title: "Call about the complaint", assignee: "S-07", minutes: 90, links: { case: kase.number } }));
  await live.advance(1);
  let now = ok(m.call("get_task", { task_id: t.id }));
  assert.ok(now.minutes_done > 0 && now.minutes_done < 90, `part done after one day (${now.minutes_done})`);
  assert.equal(now.status, "doing");
  const sam = world.state.staff_load.at(-1).people.find((p) => p.id === "S-07");
  assert.ok(sam.minutes >= now.minutes_done - 0.1, "the minutes show in Sam's day");
  await live.advance(10);
  now = ok(m.call("get_task", { task_id: t.id }));
  assert.equal(now.status, "done");
  assert.ok(world.state.cases.find((k) => k.number === kase.number).notes.some((n) => /Sam Weller finished a task: Call about the complaint/.test(n.text)), "the case says so");
  const imp = live.impact().measures;
  assert.ok(imp.staff_task_hours.difference > 1, `staff hours went up (${imp.staff_task_hours.difference})`);
  assert.ok(ok(m.call("get_workload", { days: 7 })).people.find((p) => p.id === "S-07").days_recorded > 0);
  assert.ok(world.state.chat_messages.some((c) => c.key === `team|task|${t.id}` && c.from === "S-07"), "Sam says it is done in chat");
});

test("staff chat answers a message from the colleague who owns the topic, quoting the real record", async () => {
  const world = freshWorld("demo");
  const live = createLive({ world, biz, seed: 4, makeWorld, plugins: await teamOnly() });
  const s = world.state;
  const o = s.orders.at(-1);
  const po = s.purchase_orders.at(-1);
  const m = world.session({ role: "manager" });
  const q1 = ok(m.call("send_chat_message", { channel: "orders", text: `Where is ${o.number}?` }));
  const q2 = ok(world.session({ role: "support_agent" }).call("send_chat_message", { channel: "orders", text: `Any news on ${po.number}?` }));
  const q3 = ok(m.call("send_chat_message", { to: "S-09", text: "Do we have enough socks?" }));
  await live.advance(1);
  const reply = (id) => s.chat_messages.find((c) => c.key === `team|answer|${id}`);
  const a1 = reply(q1.id);
  assert.equal(a1.from, "S-04", "dispatch answers about an order");
  assert.equal(a1.thread_parent, q1.id);
  assert.match(a1.text, new RegExp(`${o.number}.*${o.status.replace(/_/g, " ")}`));
  assert.equal(a1.links.order, o.number);
  const a2 = reply(q2.id);
  assert.equal(a2.from, "S-09", "the buyer answers about a purchase order, even in #orders");
  assert.match(a2.text, new RegExp(po.number));
  const a3 = reply(q3.id);
  assert.equal(a3.from, "S-09", "a private message is answered by the person it went to");
  assert.deepEqual(a3.dm, ["S-01", "S-09"]);
  assert.match(a3.text, /Spare Sock on the shelf/);
  // Answered once only.
  await live.advance(1);
  assert.equal(s.chat_messages.filter((c) => c.key === `team|answer|${q1.id}`).length, 1);
  // The same message always gets the same answer.
  assert.deepEqual(answerFor(s, s.chat_messages.find((c) => c.id === q1.id), 4, products), answerFor(s, s.chat_messages.find((c) => c.id === q1.id), 4, products));
});

test("the team talks about the day: a stock-out gets the stock room and the buyer", async () => {
  const world = freshWorld("demo");
  const live = createLive({ world, biz, seed: 4, makeWorld, plugins: await teamOnly() });
  await live.advance(25);
  const lines = world.state.chat_messages.filter((c) => c.team);
  const out = lines.find((c) => c.key.startsWith("team|stockout|") && !c.key.endsWith("|buyer"));
  assert.ok(out, `a stock-out was talked about (${lines.map((l) => l.key.split("|")[1]).join(",")})`);
  assert.equal(out.from, "S-05");
  const buyer = lines.find((c) => c.key === `${out.key}|buyer`);
  assert.equal(buyer.from, "S-09");
  assert.equal(buyer.thread_parent, out.id);
  assert.ok(buyer.links.po || buyer.links.supplier_id);
});

test("simulated reviews are written into the records, linked to a real order and its customer", async () => {
  const world = freshWorld("demo");
  const before = world.state.reviews.length;
  const live = createLive({ world, biz, seed: 4, makeWorld, plugins: [] });
  await live.advance(40);
  const added = world.state.reviews.slice(before);
  assert.ok(added.length > 0, "some reviews were written");
  for (const r of added) {
    const o = world.state.orders.find((x) => x.number === r.order_number);
    assert.ok(o, `${r.id} links to a real order`);
    assert.equal(r.customer_id, o.customer_id);
    assert.ok(r.rating >= 1 && r.rating <= 5 && r.text.length > 5);
  }
  assert.equal(new Set(world.state.reviews.map((r) => r.id)).size, world.state.reviews.length, "ids are unique");
  const seen = world.session({ role: "support_lead" }).call("list_reviews", { limit: 5 }).data.reviews;
  assert.ok(seen.some((r) => added.some((a) => a.id === r.id)), "the help desk sees them");
});

test("a helpful public reply to a poor review lifts reputation; with no reply it does not move", async () => {
  const run = async (reply) => {
    const world = freshWorld("demo");
    const sim = createSim({ world, biz, seed: 5, customerModel: "rich" });
    const bad = world.state.reviews.filter((r) => r.rating <= 2).at(-1);
    bad.date = world.state.now.slice(0, 10); // a fresh complaint
    if (reply) ok(world.session({ role: "support_lead" }).call("reply_to_review", { review_id: bad.id, text: "We are sorry. A replacement is on its way today and we have refunded the delivery." }));
    await sim.step();
    return sim.totals().reputation;
  };
  const without = await run(false), withReply = await run(true);
  assert.ok(withReply > without, `${withReply} > ${without}`);
});

test("word of mouth: a bad experience reaches the people a customer knows, the same way every time", () => {
  const population = biz.sim.customer_model.population;
  assert.ok(population, "business/data/population.json is loaded");
  const [key, person] = Object.entries(population.people).find(([, p]) => p.ties.length >= 2);
  const names = [person.name, ...person.ties.map(([k]) => population.people[k]?.name).filter(Boolean)];
  const make = () => names.map((name, i) => ({ id: `C-${9000 + i}`, name, email: `${key}.${i}@example.com`, kind: "regular", w: 1, s: 0 }));
  const spreadOnce = () => {
    const pop = make();
    const rich = makeRich({ pop, cfg: biz.sim.customer_model, kindWeight: {}, popSeed: 1, lambda0: 1 });
    let heard = 0;
    for (const d of ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]) heard += rich.spread(pop[0], -1, d);
    return { heard, s: pop.map((c) => c.s) };
  };
  const a = spreadOnce(), b = spreadOnce();
  assert.deepEqual(a, b, "the same draws every time (keyed by person and date)");
  assert.ok(a.heard > 0 && a.s.slice(1).some((x) => x < 0), "someone they know thinks a little less of the shop");
  assert.ok(a.s.slice(1).every((x) => x >= -4 * 0.35), "each hearing is a share of what the customer felt");
  const small = make();
  assert.equal(makeRich({ pop: small, cfg: biz.sim.customer_model, kindWeight: {}, popSeed: 1, lambda0: 1 }).spread(small[0], -0.2, "2026-12-01"), 0, "small things are not passed on");
});

test("with every plug-in on (team chat included) and nothing done, live and shadow stay exactly equal", async () => {
  const { plugins } = await loadPlugins({ dataDir: DATA_DIR, biz, products });
  assert.ok(plugins.some((p) => p.name === "team"));
  const world = freshWorld("demo");
  const live = createLive({ world, biz, seed: 9, makeWorld, plugins });
  await live.advance(15);
  const imp = live.impact();
  assert.deepEqual(Object.entries(imp.measures).filter(([, m]) => m.difference !== 0 && m.difference !== null).map(([k]) => k), []);
  const strip = (s) => JSON.stringify({ ...s, audit: [] });
  assert.equal(strip(world.state), strip(live.shadowWorld().state));
});

test("one customer's whole journey shows in every system", async () => {
  const world = freshWorld("demo");
  const s = world.state;
  const visitor = world.session({ role: "customer" });
  // 1. Finds a product.
  const found = ok(visitor.call("search_catalogue", { query: "sock" }));
  const product = found.results?.[0] || found.products?.[0];
  assert.ok(product, "the catalogue finds it");
  const sku = (product.variants || [])[0]?.sku || product.sku || "OT-SOCK";
  // 2. Signs up and buys.
  const me = ok(visitor.call("create_customer", { name: "Tess Journey", email: "tess.journey@example.com", address: { line1: "1 Lane", town: "Brookford", postcode: "AB1 2CD" } }));
  const onHand = s.stock[sku].on_hand;
  const order = ok(visitor.call("place_order", { items: [{ sku, qty: 1 }], delivery_method: "standard", payment: { method: "card", card_number: "4242424242424242" } }));
  const number = order.order_number || order.number;
  assert.equal(s.stock[sku].on_hand, onHand - 1, "stock moved");
  assert.ok(s.stock_movements.some((mv) => mv.reference === number && mv.sku === sku && mv.qty === -1), "the movement names the order");
  assert.ok(s.ledger.some((e) => e.reference === number && e.type === "sale"), "the sale is in the ledger");
  // 3. Gets in touch; support answers by email and on the case.
  const kase = ok(visitor.call("open_case", { subject: "When will it come?", category: "delivery", summary: "I would like to know when my socks arrive.", related: { order: number } }));
  const desk = world.session({ role: "support_agent" });
  const mail = ok(desk.call("send_email", { mailbox: "hello", to: ["tess.journey@example.com"], subject: "Your socks", body: `Hello Tess, ${number} goes out today and should reach you in two days.` }));
  kase.case_number ||= kase.number;
  ok(desk.call("resolve_case", { case_number: kase.case_number, note: "Told her the delivery date by email." }));
  // 4. The warehouse sends it and it arrives.
  const wh = world.session({ role: "warehouse" });
  for (const to of ["packed", "dispatched", "delivered"]) ok(wh.call("advance_order", { order_number: number, to }));
  // 5. She leaves a review, and the shop answers it.
  const review = ok(visitor.call("write_review", { order_number: number, rating: 5, text: "Warm feet. Quick answer when I asked." }));
  ok(world.session({ role: "support_lead" }).call("reply_to_review", { review_id: review.id, text: "Thank you, Tess. Enjoy them." }));
  // Every system reflects it.
  const page = ok(world.session({ role: "support_lead" }).call("get_customer_overview", { customer_id: me.id || me.customer_id }));
  assert.equal(page.orders.list[0].number, number);
  assert.equal(page.orders.list[0].status, "delivered");
  assert.ok(page.value.lifetime_value > 0);
  assert.equal(page.cases.list[0].number, kase.case_number);
  assert.equal(page.cases.list[0].status, "resolved");
  assert.ok(page.emails.list.some((e) => e.id === mail.id), "the email is on her page");
  assert.equal(page.reviews.list[0].id, review.id);
  assert.equal(page.reviews.list[0].reply.text, "Thank you, Tess. Enjoy them.");
  assert.equal(s.emails.find((e) => e.id === mail.id).links.customer_id, page.customer.id);
  const pub = ok(world.session({ role: "customer" }).call("list_reviews", { limit: 1 }));
  assert.equal(pub.reviews[0].id, review.id, "the world sees the review and the answer");
  assert.equal(pub.reviews[0].reply.text, "Thank you, Tess. Enjoy them.");
  // And the business moves on with her in it.
  const live = createLive({ world, biz, seed: 3, makeWorld, plugins: await teamOnly() });
  await live.advance(1);
  assert.ok(s.orders.some((o) => o.number === number));
});
