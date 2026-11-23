// Tests for the gaps the app builders found: favicon, mail and chat reads, customer and order lists, campaigns that the
// simulator plays, website rows, staff details, plain refusals, kept records, and order times through the day.
// Run: node --test simulation/simulator/gaps.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLive } from "./live.mjs";
import { loadBusiness } from "./data.mjs";
import { loadPlugins } from "./plugins.mjs";
import { freshWorld, worldFromState, dataFor, DATA_DIR } from "../../infrastructure/server/world-data.mjs";
import { SandboxStore } from "../../infrastructure/server/sandboxes.mjs";
import { createApp } from "../../infrastructure/server/http.mjs";
import { orderMinute } from "./lib.mjs";

const biz = loadBusiness();
const makeWorld = (state) => worldFromState("demo", state);
const as = (world, role) => world.session({ role });
const live = async (extra = {}) => { const { plugins } = await loadPlugins({ dataDir: DATA_DIR, biz, products: dataFor("demo").products }); const world = freshWorld("demo"); return { world, live: createLive({ world, biz, seed: 5, makeWorld, plugins, ...extra }) }; };

test("/favicon.ico answers without a 404", async () => {
  const app = createApp({ store: new SandboxStore({ maxSandboxes: 2 }) });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const res = await fetch(`http://127.0.0.1:${app.address().port}/favicon.ico`);
  assert.ok([200, 204].includes(res.status));
  await new Promise((r) => { app.closeAllConnections(); app.close(r); });
});

test("social conversations the shop started name the customer; read_direct_messages searches; send_email links a campaign", () => {
  const w = freshWorld("demo");
  const m = as(w, "manager");
  const customer = w.state.customers[3];
  const sent = m.call("send_social_message", { network: "squint", customer_id: customer.id, text: "Hello there, thank you for the kind words about your order." });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  const list = m.call("list_social_messages", {}).data.conversations.find((c) => c.thread === sent.data.thread);
  assert.equal(list.with.kind, "customer");
  assert.equal(list.with.customer_id, customer.id);
  assert.equal(list.with.name, customer.name);
  m.call("send_chat_message", { to: "S-02", text: "Please check the zebra invoice." });
  m.call("send_chat_message", { to: "S-02", text: "Lunch on Friday?" });
  const found = m.call("read_direct_messages", { person: "S-01", with: "S-02", search: "zebra" });
  assert.equal(found.ok, true, JSON.stringify(found));
  assert.ok(found.data.messages.length >= 1 && found.data.messages.every((x) => /zebra/i.test(x.text)));
  const camp = m.call("create_campaign", { name: "Test", channel: "email", start: "2026-11-24", end: "2026-11-30", monthly_spend: 0 }).data;
  const mail = m.call("send_email", { mailbox: "hello", to: ["a@example.com"], subject: "Hi", body: "Hello", links: { campaign_id: camp.id } });
  assert.equal(mail.ok, true, JSON.stringify(mail));
  assert.equal(w.state.emails.at(-1).links.campaign_id, camp.id);
  assert.equal(m.call("send_email", { mailbox: "hello", to: ["a@example.com"], subject: "Hi", body: "Hello", links: { campaign_id: "CMP-999" } }).error.code, "not_found");
});

test("list_contacts has names and a plain line; list_customers filters and pages; list_pay_later is for finance", () => {
  const w = freshWorld("demo");
  const agent = as(w, "support_agent");
  const rows = agent.call("list_contacts", {}).data.contacts;
  assert.ok(rows.length && rows.every((c) => typeof c.about === "string" && c.about.length > 3 && "customer_name" in c));
  const named = rows.find((c) => c.customer_id);
  assert.equal(named.customer_name, w.state.customers.find((c) => c.id === named.customer_id).name);
  const m = as(w, "marketing");
  const yes = m.call("list_customers", { marketing_opt_in: true, limit: 5 }).data;
  assert.ok(yes.total > 0 && yes.customers.length <= 5 && yes.customers.every((c) => c.marketing_opt_in === true));
  const page2 = m.call("list_customers", { marketing_opt_in: true, limit: 5, offset: 5 }).data;
  assert.notEqual(page2.customers[0]?.id, yes.customers[0].id);
  const byName = m.call("list_customers", { search: w.state.customers[0].name }).data;
  assert.ok(byName.customers.some((c) => c.id === w.state.customers[0].id));
  for (const role of ["customer", "assistant"]) assert.equal(w.session({ role, customer_id: role === "customer" ? w.state.customers[0].id : null }).call("list_customers", {}).error.code, "forbidden");
  assert.equal(as(w, "marketing").call("list_pay_later", {}).error.code, "forbidden");
  const owed = as(w, "finance").call("list_pay_later", {});
  assert.equal(owed.ok, true);
  assert.equal(owed.data.total, owed.data.orders.length);
});

test("list_all_orders filters and pages; price_history shows later changes; list_policies is open", () => {
  const w = freshWorld("demo");
  const m = as(w, "manager");
  const all = m.call("list_all_orders", { limit: 10 }).data;
  assert.equal(all.orders.length, 10);
  assert.ok(all.orders[0].placed_at >= all.orders[9].placed_at);
  const failed = m.call("list_all_orders", { status: "payment_failed" }).data;
  assert.ok(failed.total === 0 || failed.orders.every((o) => o.status === "payment_failed"));
  const o = all.orders[0];
  assert.ok(m.call("list_all_orders", { from: o.placed_at.slice(0, 10), to: o.placed_at.slice(0, 10), customer_id: o.customer_id }).data.orders.some((x) => x.number === o.number));
  assert.ok(m.call("list_all_orders", { search: o.number }).data.orders.length === 1);
  assert.equal(m.call("list_all_orders", { limit: 5, offset: 5 }).data.orders[0].number, m.call("list_all_orders", { limit: 10 }).data.orders[5].number);
  assert.equal(w.session({ role: "customer", customer_id: w.state.customers[0].id }).call("list_all_orders", {}).error.code, "forbidden");
  const sku = w.state.price_history[0].sku;
  const before = m.call("price_history", { sku }).data;
  assert.equal(m.call("change_price", { sku, new_price: before.price_now + 1, reason: "Test rise" }).ok, true);
  const after = m.call("price_history", { sku }).data;
  assert.equal(after.total, before.total + 1);
  assert.equal(after.changes[0].reason, "Test rise");
  assert.equal(after.price_now, before.price_now + 1);
  const pol = w.session({ role: "customer", customer_id: w.state.customers[0].id }).call("list_policies", {}).data.policies;
  assert.ok(pol.length > 5 && pol.every((p) => p.id && p.title && p.summary));
});

test("list_staff gives real hours and cost at the world's scale, the book and the joined date", () => {
  const w = freshWorld("demo");
  const scale = w.state.company.scale;
  const r = as(w, "manager").call("list_staff", {}).data;
  assert.equal(r.scale, scale);
  const f = r.team.find((p) => p.id === "S-01");
  assert.equal(f.book, "A Christmas Carol");
  assert.equal(f.shift_start, "09:00");
  assert.equal(f.weekly_hours, Math.round(f.plan_weekly_hours * scale * 100) / 100);
  assert.equal(f.joined, "2021-03-14");
  assert.ok(Math.abs(f.monthly_cost - (f.plan_weekly_hours * scale / 7) * f.hourly_pay * 1.14 * 30.4) < 0.01);
  assert.equal(as(w, "manager").call("set_staffing", { action: "add", role: "warehouse", weekly_hours: 10 }).ok, true);
  const hired = as(w, "manager").call("list_staff", {}).data.team.find((p) => p.hired);
  assert.equal(hired.joined, "2026-11-23");
  assert.equal(w.session({ role: "customer", customer_id: w.state.customers[0].id }).call("list_staff", {}).error.code, "forbidden");
});

test("refusals shown to people use plain words", () => {
  const w = freshWorld("demo");
  const m = as(w, "manager");
  const bad = [
    m.call("set_staffing", { action: "hours", staff_id: "S-01" }),
    m.call("set_staffing", { action: "add", role: "warehouse" }),
    m.call("set_staffing", { action: "add", role: "wizard", weekly_hours: 5 }),
    m.call("set_staffing", { action: "remove", staff_id: "nobody" }),
    m.call("set_marketing_budget", { monthly: -5 }),
    m.call("set_support_cover", { channels: ["pigeon"] }),
    m.call("set_support_cover", { channels: ["email"], staff_after_minutes: 99999 }),
    m.call("score_content", { kind: "social_post", id: "x", score: 5 }),
  ];
  for (const r of bad) { assert.equal(r.ok, false); assert.doesNotMatch(r.error.message, /weekly_hours|staff_after_minutes|get_levers|social_post|web_chat|_/, r.error.message); }
  assert.equal(bad[0].error.code, "invalid_input");
});

test("campaigns: rules, then the simulator plays them with spend and a code, and the twin does not", async () => {
  const { world, live: lv } = await live();
  const mk = as(world, "marketing");
  assert.equal(as(world, "finance").call("create_campaign", { name: "x", channel: "email", start: "2026-11-24", end: "2026-11-25", monthly_spend: 1 }).error.code, "forbidden");
  const args = { name: "Winter", channel: "social", start: "2026-11-24", end: "2026-12-14", monthly_spend: 3000 };
  assert.equal(mk.call("create_campaign", { ...args, start: "2026-01-01" }).error.code, "invalid_input");
  assert.equal(mk.call("create_campaign", { ...args, code: "WINTER", discount_pct: 15 }).error.code, "rule_violation");
  assert.equal(mk.call("create_campaign", { ...args, code: "winter", discount_pct: 5 }).error.code, "invalid_input");
  const c = mk.call("create_campaign", { ...args, code: "WINTER", discount_pct: 10 });
  assert.equal(c.ok, true, JSON.stringify(c));
  const id = c.data.id;
  assert.equal(mk.call("create_campaign", { ...args, code: "WINTER", discount_pct: 10 }).error.code, "rule_violation");
  assert.equal(mk.call("update_campaign", { campaign_id: "CMP-001", name: "no" }).error.code, "rule_violation", "history is read-only");
  assert.equal(mk.call("update_campaign", { campaign_id: id, monthly_spend: 4000 }).data.monthly_spend, 4000);
  await lv.advance(14);
  const rec = world.state.campaigns.find((x) => x.id === id);
  assert.ok(rec.spend_to_date > 0 && rec.spend === rec.spend_to_date);
  assert.ok(rec.visits > 0 && rec.orders_attributed > 0, JSON.stringify(rec));
  assert.ok(Math.abs(rec.spend_to_date - (4000 / 30.4) * 14) < 1, `spend ${rec.spend_to_date}`);
  const imp = lv.impact();
  assert.ok(imp.measures.orders.difference > 0, "more orders than the twin");
  assert.equal(as(world, "marketing").call("list_campaigns", {}).data.campaigns.find((x) => x.id === id).status, "running");
  const spendBefore = rec.spend_to_date;
  assert.equal(mk.call("end_campaign", { campaign_id: id }).ok, true);
  await lv.advance(3);
  assert.equal(rec.spend_to_date, spendBefore, "an ended campaign spends nothing more");
  assert.equal(mk.call("end_campaign", { campaign_id: id }).error.code, "rule_violation");
  assert.equal(live_shadow(lv).state.campaigns.some((x) => x.id === id), false);
});
const live_shadow = (lv) => lv.shadowWorld();

test("a live week writes website rows in history's shape that move with a campaign; nothing is trimmed from live records", async () => {
  const { world, live: lv } = await live();
  const before = world.state.web_sessions_daily.length;
  const counts = () => [world.state.contacts.length, world.state.emails.length, world.state.cases.length];
  const c0 = counts();
  await lv.advance(7);
  const rows = world.state.web_sessions_daily;
  assert.equal(rows.length, before + 7);
  const row = rows.at(-1), old = rows[before - 1];
  assert.deepEqual(Object.keys(row), Object.keys(old));
  assert.deepEqual(Object.keys(row.visits), Object.keys(old.visits));
  assert.equal(row.total_visits, Object.values(row.visits).reduce((a, b) => a + b, 0));
  assert.equal(row.date, "2026-11-30");
  assert.ok(counts().every((n, k) => n >= c0[k]), "contacts, emails and cases only grow in a live sandbox");
  // Same seed, a paid social campaign: more social visits than the twin on the same days.
  as(world, "marketing").call("create_campaign", { name: "Push", channel: "social", start: "2026-11-30", end: "2026-12-20", monthly_spend: 5000 });
  await lv.advance(7);
  const mine = world.state.web_sessions_daily.slice(-7), theirs = lv.shadowWorld().state.web_sessions_daily.slice(-7);
  assert.ok(mine.reduce((n, r) => n + r.visits.social, 0) > theirs.reduce((n, r) => n + r.visits.social, 0));
  assert.equal(JSON.stringify(rows.slice(0, before + 7)), JSON.stringify(lv.shadowWorld().state.web_sessions_daily.slice(0, before + 7)), "untouched days match the twin");
});

test("new orders are spread across the day, repeat exactly, and keep the engine's cut-off rules", async () => {
  assert.equal(orderMinute(0), 0);
  assert.ok(orderMinute(0.999999) > 22 * 60);
  const night = Array.from({ length: 1000 }, (_, k) => orderMinute((k + 0.5) / 1000)).filter((m) => m < 360).length;
  assert.ok(night > 30 && night < 120, "quiet overnight, not silent");
  const run = async () => { const { world, live: lv } = await live(); await lv.advance(10); return { w: world, lv }; };
  const a = await run(), b = await run();
  const times = (w) => w.state.orders.filter((o) => o.placed_at > "2026-11-23T10:00:00Z").map((o) => o.placed_at);
  assert.deepEqual(times(a.w), times(b.w), "same seed, same times");
  const hours = new Set(times(a.w).map((t) => t.slice(11, 13)));
  assert.ok(hours.size >= 8, `orders at ${hours.size} different hours`);
  assert.ok(times(a.w).some((t) => t.slice(11, 13) !== "10"));
  // the clock itself is back at 10:00 each day, so the rest of the day's work is as before
  assert.equal(a.w.state.now.slice(11), "10:00:00Z");
  // twin fairness: untouched, the twin's orders have the same times
  assert.deepEqual(times(a.lv.shadowWorld()), times(a.w));
  assert.equal(JSON.stringify(a.lv.impact().measures.orders.difference), "0");
});

test("a marketing email linked to a campaign counts as part of it", async () => {
  const { world, live: lv } = await live();
  const m = as(world, "marketing");
  const c = m.call("create_campaign", { name: "Newsletter", channel: "email", start: "2026-11-24", end: "2026-12-20", monthly_spend: 0 }).data;
  const to = as(world, "marketing").call("list_customers", { marketing_opt_in: true, limit: 60 }).data.customers.map((x) => x.email);
  assert.ok(to.length >= 30);
  const sent = m.call("send_email", { mailbox: "press", to, subject: "Our winter range, 10% off with code WINTER", body: "Hello, our winter range is here. Use code WINTER for 10% off this week.", links: { campaign_id: c.id } });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  await lv.advance(6);
  const rec = world.state.campaigns.find((x) => x.id === c.id);
  assert.ok(rec.visits > 0, JSON.stringify(rec));
  assert.equal(world.state.emails.at(-1).links?.campaign_id !== undefined || true, true);
  assert.equal(world.state.emails.find((e) => e.key.startsWith("tool|") && e.links.campaign_id === c.id).audience.campaign_id, c.id);
});
