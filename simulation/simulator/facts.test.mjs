// Stylised facts: patterns the simulated business must show to be believable (pattern-oriented modelling, Grimm et
// al., https://www.jasss.org/27/1/11.html). Each says where its band comes from; "assumption" means our own judgement.
// Run: node --test simulation/simulator/facts.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim } from "./core.mjs";
import { createLive } from "./live.mjs";
import { loadBusiness } from "./data.mjs";
import { audiencePlugin } from "./audience.mjs";
import { eventsPlugin } from "../../infrastructure/engine/events.js";
import { instantiate } from "../../infrastructure/engine/events-core.js";
import library from "../../business/data/events/library.json" with { type: "json" };
import { freshWorld, worldFromState, dataFor } from "../../infrastructure/server/world-data.mjs";

const biz = loadBusiness();
const run = async (sim, days) => { const lines = []; for (let i = 0; i < days; i++) lines.push(await sim.step()); return lines; };
const net = (T) => T.revenue - T.refunds - T.cogs - T.card_fees - T.delivery_costs - T.goodwill - T.packaging - T.staff_pay - T.overtime_pay - T.fixed_costs - T.marketing - T.outreach_cost;
const manager = (w) => w.session({ role: "manager" });

// ---------------------------------------------------------------- a business left alone is ordinary, at any size

for (const [size, scale, days] of [["demo", 0.02, 365], ["standard", 0.2, 120], ["demo", 1, 90]]) {
  test(`left alone at scale ${scale} (${size}), the business is healthy and ordinary`, async () => {
    const sim = createSim({ world: freshWorld(size), biz, seed: 1, scale });
    await run(sim, days);
    const t = sim.totals(), T = t.totals;
    // 0.19 to 0.46 tickets per order across e-commerce categories (https://www.eesel.ai/blog/ecommerce-support-contact-rate);
    // a small, well-run shop sits at the low end. Band 0.1 to 0.4.
    const perOrder = T.contacts / T.orders;
    assert.ok(perOrder >= 0.1 && perOrder <= 0.4, `contacts per order ${perOrder.toFixed(2)}`);
    // The median first reply comes within the working day (510 working minutes; clock minutes here, so a little more).
    assert.ok(t.first_response_median_minutes <= 600, `median first reply ${t.first_response_median_minutes} minutes`);
    // Satisfaction around 4 out of 5 (assumption).
    const csat = T.csat_sum / T.csat_n;
    assert.ok(csat >= 3.5 && csat <= 4.5, `satisfaction ${csat.toFixed(2)}`);
    assert.equal(T.contacts_abandoned, 0, "nobody is left unanswered");
    // A modest profit over the run (assumption: the shop pays its way).
    assert.ok(net(T) > 0, `net profit ${net(T).toFixed(0)}`);
  });
}

// ---------------------------------------------------------------- the first simulated weeks look like the last historical ones

test("the first simulated weeks look like the last four weeks of history (standard world at its own scale)", async () => {
  const world = freshWorld("standard");
  const start = world.state.now.slice(0, 10);
  const cut = new Date(Date.parse(`${start}T00:00:00Z`) - 28 * 86400000).toISOString().slice(0, 10);
  const figures = (orders, contacts, reviews, days) => {
    const shipped = orders.flatMap((o) => o.shipments || []).filter((s) => s.status === "delivered");
    return {
      perDay: orders.length / days, aov: orders.reduce((n, o) => n + o.totals.total, 0) / orders.length,
      late: shipped.filter((s) => /after the estimated date|late|delay/i.test(s.note || "")).length / Math.max(1, shipped.length),
      contactsPerOrder: contacts / orders.length, reviewsPerOrder: reviews / orders.length,
    };
  };
  const st = world.state;
  const hist = figures(st.orders.filter((o) => o.placed_at.slice(0, 10) > cut && o.placed_at.slice(0, 10) <= start),
    st.contacts.filter((c) => c.at.slice(0, 10) > cut && c.at.slice(0, 10) <= start).length,
    st.reviews.filter((r) => r.date > cut && r.date <= start).length, 28);
  const sim = createSim({ world, biz, seed: 1 }); // no events: an ordinary month
  await run(sim, 35);
  const end = world.state.now.slice(0, 10);
  const simOrders = st.orders.filter((o) => o.placed_at.slice(0, 10) > start && o.placed_at.slice(0, 10) <= addDays(start, 28));
  const fresh = figures(simOrders, st.contacts.filter((c) => c.at.slice(0, 10) > start && c.at.slice(0, 10) <= addDays(start, 28)).length,
    sim.totals().totals.reviews * (28 / 35), 28);
  const within = (k, lo, hi) => assert.ok(fresh[k] / hist[k] >= lo && fresh[k] / hist[k] <= hi, `${k}: history ${hist[k].toFixed(3)}, simulated ${fresh[k].toFixed(3)}`);
  within("perDay", 0.6, 1.7); // late November runs into the December peak, so up to 1.7 (season_by_month)
  within("aov", 0.75, 1.33);
  within("contactsPerOrder", 0.5, 1.6);
  within("reviewsPerOrder", 0.4, 2.2);
  assert.ok(fresh.late <= 0.1 && Math.abs(fresh.late - hist.late) <= 0.05, `late share: history ${hist.late.toFixed(3)}, simulated ${fresh.late.toFixed(3)}`);
  assert.ok(end > start);
});

// ---------------------------------------------------------------- shape of demand

test("weekly and yearly seasonality show; repeat buyers are a believable share", async () => {
  const world = freshWorld("demo");
  const sim = createSim({ world, biz, seed: 2, scale: 1 });
  const lines = await run(sim, 365);
  const byDay = [0, 0, 0, 0, 0, 0, 0], nDay = [0, 0, 0, 0, 0, 0, 0], byMonth = {};
  for (const l of lines) {
    const wd = new Date(`${l.date}T00:00:00Z`).getUTCDay(); byDay[wd] += l.orders; nDay[wd]++;
    const m = l.date.slice(0, 7); byMonth[m] = byMonth[m] || [0, 0]; byMonth[m][0] += l.orders; byMonth[m][1]++;
  }
  const mean = (wd) => byDay[wd] / nDay[wd];
  // Weekday factors in business/data/sim.json (assumption): Monday is a busy day, Saturday a quiet one.
  assert.ok(mean(1) > mean(6) * 1.15, `Monday ${mean(1).toFixed(1)} vs Saturday ${mean(6).toFixed(1)}`);
  const m = (k) => byMonth[k][0] / byMonth[k][1];
  assert.ok(m("2026-12") > m("2027-02") * 1.4, `December ${m("2026-12").toFixed(1)} vs February ${m("2027-02").toFixed(1)} a day`);
  // Repeat buyers: share of the year's orders from customers who ordered more than once. Assumption band 0.3 to 0.85
  // (small gift shops sit low, regular-supply shops high).
  const simOrders = world.state.orders.filter((o) => o.placed_at >= "2026-11-24");
  const per = new Map();
  for (const o of simOrders) per.set(o.customer_id, (per.get(o.customer_id) || 0) + 1);
  const repeat = simOrders.filter((o) => per.get(o.customer_id) > 1).length / simOrders.length;
  assert.ok(repeat >= 0.3 && repeat <= 0.85, `repeat share ${repeat.toFixed(2)}`);
});

test("a price rise lowers units sold of that product", async () => {
  const units = async (act) => {
    const world = freshWorld("demo");
    const sim = createSim({ world, biz, seed: 3, scale: 1 });
    if (act) assert.equal(manager(world).call("change_price", { sku: "OT-SOCK", new_price: 12, reason: "test" }).ok, true);
    await run(sim, 30);
    return world.state.orders.filter((o) => o.placed_at >= "2026-11-24").flatMap((o) => o.items).filter((l) => l.sku === "OT-SOCK").reduce((n, l) => n + l.qty, 0);
  };
  const before = await units(false), after = await units(true);
  assert.ok(after < before, `socks ${before} -> ${after}`);
});

test("more marketing brings more orders, with diminishing returns per pound", async () => {
  const orders = async (times) => {
    const world = freshWorld("demo");
    const sim = createSim({ world, biz, seed: 4, scale: 1 });
    manager(world).call("set_marketing_budget", { monthly: biz.costs.marketing_per_month * times });
    await run(sim, 30);
    return sim.totals().totals.orders;
  };
  const [o1, o2, o4] = [await orders(1), await orders(2), await orders(4)];
  const plan = biz.costs.marketing_per_month;
  assert.ok(o2 > o1 && o4 > o2, `${o1}, ${o2}, ${o4}`);
  assert.ok((o2 - o1) / plan > (o4 - o2) / (2 * plan), "the second doubling buys fewer orders per pound");
});

test("a postal strike raises late parcels and contacts", async () => {
  const tpl = library.events.find((e) => e.id === "rs-postal-strike");
  const go = async (strike) => {
    const world = freshWorld("demo");
    world.state.world_events = strike ? [{ ...instantiate(tpl, "2026-11-25", 8), id: "WE-TEST", status: "scheduled" }] : [];
    const sim = createSim({ world, biz, seed: 5, scale: 1, plugins: [eventsPlugin] });
    await run(sim, 21);
    return sim.totals().totals;
  };
  const calm = await go(false), strike = await go(true);
  assert.ok(strike.late_parcels > calm.late_parcels * 2, `late parcels ${calm.late_parcels} -> ${strike.late_parcels}`);
  assert.ok(strike.contacts > calm.contacts, `contacts ${calm.contacts} -> ${strike.contacts}`);
});

// ---------------------------------------------------------------- consequences of what is done

test("a helpful, fast reply to a complaint raises that customer's later spend", async () => {
  const world = freshWorld("demo");
  // Forty customers complain in public on the first morning (the same in both twins: it is in the starting state).
  const cust = world.state.customers.slice(0, 40);
  world.state.social_posts.push(...cust.map((c, i) => ({ id: `SP-9${String(i).padStart(5, "0")}`, key: `test|complaint|${i}`, network: "mutter",
    author: { kind: "customer", name: c.name, handle: "x", customer_id: c.id }, kind: "post", text: "My parcel is late and nobody has said anything. Disappointed.",
    image: null, at: "2026-11-23T08:00:00Z", likes: 0, reposts: 0, parent: null, parent_key: null, thread: null, by: null, mentions_shop: true, links: { customer_id: c.id } })));
  const live = createLive({ world, biz, seed: 6, scale: 1, makeWorld: (s) => worldFromState("demo", s), customerModel: "rich" });
  const agent = world.session({ role: "support_agent" });
  for (let i = 0; i < 40; i++) assert.equal(agent.call("reply_social_post", { post_id: `SP-9${String(i).padStart(5, "0")}`, text: "I am so sorry. I have checked your order and asked the carrier to chase it today; I will message you with the tracking." }).ok, true);
  await live.advance(90);
  const spend = (st) => st.orders.filter((o) => o.placed_at >= "2026-11-24" && cust.some((c) => c.id === o.customer_id)).reduce((n, o) => n + o.totals.total, 0);
  const a = spend(world.state), b = spend(live.shadowWorld().state);
  assert.ok(a > b, `their spend: answered ${a.toFixed(0)} vs not answered ${b.toFixed(0)}`);
});

test("posting three times a day does worse per post than three times a week", async () => {
  const reachPerPost = async (perDay, everyDays) => {
    const world = freshWorld("demo");
    const plugin = audiencePlugin({ rates: biz.audience, products: dataFor("demo").products });
    const sim = createSim({ world, biz, seed: 7, plugins: [plugin] });
    const mk = world.session({ role: "marketing" });
    for (let d = 0; d < 14; d++) {
      if (d % everyDays === 0) for (let k = 0; k < perDay; k++) mk.call("create_social_post", { network: "mutter", text: `A plain note about the One Good Pen, number ${d}-${k}. It writes. It will not write your letters for you.`, product_id: "one-good-pen" });
      await sim.step();
    }
    const posts = world.state.social_posts.filter((p) => p.audience?.kind === "social_post");
    return posts.reduce((n, p) => n + p.audience.plan.reach, 0) / posts.length;
  };
  const spammy = await reachPerPost(3, 1), steady = await reachPerPost(1, 2);
  assert.ok(spammy < steady * 0.6, `reach per post: three a day ${spammy.toFixed(0)}, about three a week ${steady.toFixed(0)}`);
});

function addDays(s, n) { return new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10); }
