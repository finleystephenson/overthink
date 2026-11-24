// Tests for the customer page, reviews, tasks, the knowledge base and permissions by role
// (infrastructure/engine/customers.js, reviews.js, tasks.js, knowledge.js, and the channel rules in comms.js).
// Run: node --test infrastructure/engine/business.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createWorld } from "./all.js";
import { loadData } from "./load.ts";
import { CHANNEL_ROLES, ROSTER, SHARED_BOXES } from "./comms.js";

const dataDir = join(fileURLToPath(new URL("../../", import.meta.url)), "business", "data");
const loaded = loadData(dataDir, { world: "demo" });
const fresh = () => createWorld({ ...loaded });
const call = (w, role, tool, input = {}) => w.session({ role }).call(tool, input);
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.error)); return r.data; };
const refused = (r, code) => { assert.equal(r.ok, false, "should be refused"); assert.equal(r.error.code, code, r.error.message); };

// ---------------------------------------------------------------- the customer page

test("get_customer_overview gathers orders, contacts, cases, reviews, posts and value for one customer", () => {
  const w = fresh();
  const rv = w.state.reviews.find((r) => w.state.orders.some((o) => o.number === r.order_number));
  const d = ok(call(w, "support_agent", "get_customer_overview", { customer_id: rv.customer_id }));
  assert.equal(d.customer.id, rv.customer_id);
  const orders = w.state.orders.filter((o) => o.customer_id === rv.customer_id);
  assert.equal(d.orders.total, orders.length);
  assert.ok(d.reviews.list.some((r) => r.id === rv.id && r.order_number === rv.order_number), "their review, linked to its order");
  assert.ok(d.value.lifetime_value >= 0 && d.value.orders <= orders.length);
  assert.ok(Array.isArray(d.knows.favourite_products));
  // Mail only from boxes the role may open: support cannot see the accounts box.
  assert.ok(d.emails.list.every((e) => e.mailbox !== "accounts"));
  refused(call(w, "customer", "get_customer_overview", { customer_id: rv.customer_id }), "forbidden");
  refused(call(w, "warehouse", "get_customer_overview", { customer_id: rv.customer_id }), "forbidden");
  refused(call(w, "manager", "get_customer_overview", { customer_id: "C-0000" }), "not_found");
});

test("a customer's own posts appear on their page", () => {
  const w = fresh();
  const post = w.state.social_posts.find((p) => p.author?.kind === "customer" && p.kind === "post" && p.author.customer_id);
  const d = ok(call(w, "marketing", "get_customer_overview", { customer_id: post.author.customer_id }));
  assert.ok(d.social_posts.list.some((p) => p.id === post.id));
});

// ---------------------------------------------------------------- reviews

test("list_reviews filters, averages, and links each review to its order and customer for staff", () => {
  const w = fresh();
  const all = ok(call(w, "support_lead", "list_reviews", { limit: 200 }));
  assert.equal(all.total, w.state.reviews.length);
  const low = ok(call(w, "support_lead", "list_reviews", { max_rating: 2 }));
  assert.ok(low.reviews.every((r) => r.rating <= 2));
  const r = low.reviews[0];
  assert.ok(r.order_number && r.customer_id && r.product_name, "staff see the order and the customer");
  const one = ok(call(w, "support_lead", "get_review", { review_id: r.id }));
  assert.equal(one.order.number, r.order_number);
  const pub = ok(call(w, "customer", "list_reviews", { limit: 5 }));
  assert.ok(pub.reviews.every((x) => x.customer_id === undefined && x.order_number === undefined), "customers never see ids");
});

test("reply_to_review is public; a second reply is an edit; flag_review hides it from customers only", () => {
  const w = fresh();
  const id = w.state.reviews.find((r) => r.rating <= 2).id;
  refused(call(w, "warehouse", "reply_to_review", { review_id: id, text: "Hello" }), "forbidden");
  refused(call(w, "support_agent", "reply_to_review", { review_id: id, text: "   " }), "invalid_input");
  const a = ok(call(w, "support_agent", "reply_to_review", { review_id: id, text: "Sorry. We have sent a new one today." }));
  assert.equal(a.reply.by, "S-07");
  const seen = ok(call(w, "customer", "get_review", { review_id: id }));
  assert.equal(seen.reply.text, "Sorry. We have sent a new one today.", "a reply is visible to the world");
  const b = ok(call(w, "manager", "reply_to_review", { review_id: id, text: "A better answer.", as: "S-06" }));
  assert.equal(b.reply.edited, true);
  assert.equal(b.reply.by_name, "Mrs Hudson");
  refused(call(w, "support_agent", "flag_review", { review_id: id, reason: "fake" }), "forbidden");
  ok(call(w, "support_lead", "flag_review", { review_id: id, reason: "abusive", note: "Names a member of staff." }));
  refused(call(w, "customer", "get_review", { review_id: id }), "not_found");
  assert.ok(!ok(call(w, "assistant", "list_reviews", { limit: 200 })).reviews.some((r) => r.id === id));
  assert.ok(ok(call(w, "manager", "list_reviews", { flagged: true })).reviews.some((r) => r.id === id));
  ok(call(w, "support_lead", "flag_review", { review_id: id, clear: true }));
  ok(call(w, "customer", "get_review", { review_id: id }));
  assert.equal(ok(call(w, "support_lead", "list_reviews", { needs_reply: false })).reviews.some((r) => r.id === id), true);
});

test("write_review: a customer reviews a delivered order of their own, once", () => {
  const w = fresh();
  const o = w.state.orders.find((x) => x.status === "delivered" && !w.state.reviews.some((r) => r.order_number === x.number));
  const s = w.session({ role: "customer", customer_id: o.customer_id });
  const r = ok(s.call("write_review", { order_number: o.number, rating: 4, text: "Did what it said." }));
  assert.equal(w.state.reviews.at(-1).order_number, o.number);
  assert.equal(w.state.reviews.at(-1).customer_id, o.customer_id);
  assert.equal(r.rating, 4);
  refused(s.call("write_review", { order_number: o.number, rating: 4, text: "Again" }), "already_done");
  const other = w.state.orders.find((x) => x.customer_id !== o.customer_id);
  refused(s.call("write_review", { order_number: other.number, rating: 5, text: "Not mine" }), "not_found");
});

// ---------------------------------------------------------------- tasks

test("tasks: create with checked links, update, complete; refusals in plain words", () => {
  const w = fresh();
  const o = w.state.orders.at(-1);
  refused(call(w, "support_agent", "create_task", { title: "Ring them", assignee: "S-99" }), "not_found");
  refused(call(w, "support_agent", "create_task", { title: "Ring them", assignee: "S-07", links: { order: "ORD-1" } }), "not_found");
  refused(call(w, "support_agent", "create_task", { title: "Ring them", assignee: "S-07", minutes: 2 }), "invalid_input");
  refused(call(w, "customer", "create_task", { title: "x", assignee: "S-07" }), "forbidden");
  const t = ok(call(w, "support_lead", "create_task", { title: "Ring about the parcel", assignee: "S-07", minutes: 25, due: "2026-11-25", priority: "urgent", links: { order: o.number, customer_id: o.customer_id } }));
  assert.match(t.id, /^TASK-\d{4}$/);
  assert.equal(t.created_by, "S-06");
  assert.equal(t.assignee_name, "Sam Weller");
  assert.equal(ok(call(w, "manager", "list_tasks", { link: o.number })).tasks[0].id, t.id);
  const u = ok(call(w, "manager", "update_task", { task_id: t.id, assignee: "S-08", note: "Sam is off" }));
  assert.equal(u.assignee, "S-08");
  assert.match(u.history.at(-1).event, /Esther Summerson; note: Sam is off/);
  const d = ok(call(w, "support_agent", "complete_task", { task_id: t.id, note: "Spoke to them." }));
  assert.equal(d.status, "done");
  refused(call(w, "support_agent", "complete_task", { task_id: t.id }), "already_done");
  refused(call(w, "manager", "update_task", { task_id: t.id, title: "x" }), "rule_violation");
  assert.equal(ok(call(w, "manager", "list_tasks", {})).total, 0, "done tasks are not open");
  assert.equal(ok(call(w, "manager", "list_tasks", { status: "done" })).total, 1);
});

test("get_org_chart: everyone reports to someone who works here, except the manager", () => {
  const w = fresh();
  const people = ok(call(w, "warehouse", "get_org_chart")).people;
  assert.equal(people.length, ROSTER.length);
  const ids = new Set(people.map((p) => p.id));
  for (const p of people) {
    if (p.role === "manager") assert.equal(p.reports_to, null);
    else assert.ok(ids.has(p.reports_to), `${p.name} reports to someone here`);
    assert.ok(p.skills.length && p.why, `${p.name} has skills and a reason to be here`);
  }
});

// ---------------------------------------------------------------- knowledge base

test("the knowledge base is searchable by title and text, within each role's permissions", () => {
  const w = fresh();
  assert.ok(w.state.knowledge.length > 50, "generated documents are loaded");
  const buyer = ok(call(w, "buyer", "search_documents", { query: "supplier agreement" }));
  assert.ok(buyer.documents.length >= 5 && buyer.documents[0].kind === "supplier agreement", "title matches come first");
  const marketing = ok(call(w, "marketing", "search_documents", { query: "supplier agreement" }));
  assert.ok(!marketing.documents.some((d) => d.kind === "supplier agreement"), "marketing never sees what we pay suppliers");
  const id = buyer.documents[0].id;
  refused(call(w, "marketing", "get_document", { id }), "forbidden");
  assert.match(ok(call(w, "buyer", "get_document", { id })).body, /Prices we pay/);
  assert.ok(ok(call(w, "support_agent", "search_documents", { kind: "meeting note" })).total > 10);
  assert.ok(ok(call(w, "warehouse", "search_documents", { query: "price list" })).documents.length >= 2);
});

test("search_knowledge reads the same store: a customer's assistant finds product sheets, never supplier terms", () => {
  const w = fresh();
  const pub = ok(call(w, "assistant", "search_knowledge", { query: "blip battery" })).results;
  assert.ok(pub.some((r) => r.kind === "document" && /Product sheet/.test(r.title)));
  const sup = ok(call(w, "assistant", "search_knowledge", { query: "supplier agreement prices we pay" })).results;
  assert.ok(!sup.some((r) => /Supplier agreement/.test(r.title)));
  const staff = ok(call(w, "buyer", "search_knowledge", { query: "supplier agreement prices we pay" })).results;
  assert.ok(staff.some((r) => /Supplier agreement/.test(r.title)));
});

test("save_document writes and edits; only the manager publishes to customers", () => {
  const w = fresh();
  refused(call(w, "support_lead", "save_document", { title: "Public note", body: "Hello", access: "public" }), "forbidden");
  refused(call(w, "support_agent", "save_document", { title: "x", body: "y" }), "forbidden");
  const d = ok(call(w, "support_lead", "save_document", { title: "Zebra returns procedure", body: "Zebras go back to the zoo within 30 days.", kind: "procedure", access: "support_agent,support_lead" }));
  assert.deepEqual(d.access, ["support_agent", "support_lead"]);
  assert.ok(ok(call(w, "support_agent", "search_knowledge", { query: "zebras zoo" })).results.some((r) => r.id === d.id));
  assert.ok(!ok(call(w, "warehouse", "search_knowledge", { query: "zebras zoo" })).results.some((r) => r.id === d.id));
  ok(call(w, "support_lead", "save_document", { id: d.id, status: "out_of_date" }));
  assert.ok(!ok(call(w, "support_agent", "search_knowledge", { query: "zebras zoo" })).results.some((r) => r.id === d.id), "out of date is not quoted");
  const sheet = w.state.knowledge.find((k) => k.kind === "product sheet");
  refused(call(w, "support_lead", "save_document", { id: sheet.id, body: "changed" }), "forbidden");
  ok(call(w, "manager", "save_document", { id: sheet.id, body: `${sheet.body}\nNew line.` }));
});

// ---------------------------------------------------------------- permissions: mailboxes and channels

test("channels by role: #money is for finance and the manager; people outside a channel are refused", () => {
  const w = fresh();
  refused(call(w, "marketing", "read_channel", { channel: "money" }), "forbidden");
  refused(call(w, "support_agent", "send_chat_message", { channel: "money", text: "hi" }), "forbidden");
  refused(call(w, "buyer", "read_channel", { channel: "customers" }), "forbidden");
  refused(call(w, "technician", "read_channel", { channel: "orders" }), "forbidden");
  ok(call(w, "finance", "read_channel", { channel: "money" }));
  ok(call(w, "manager", "read_channel", { channel: "money" }));
  ok(call(w, "operations_assistant", "read_channel", { channel: "money" }));
  const names = ok(call(w, "marketing", "list_channels")).channels.map((c) => c.channel);
  assert.ok(!names.includes("money") && names.includes("marketing") && names.includes("general"));
  const msg = w.state.chat_messages.find((m) => m.channel === "money");
  refused(call(w, "marketing", "react_to_chat_message", { message_id: msg.id, mark: "thanks" }), "forbidden");
});

test("everyone who ever posted in a channel can still read it", () => {
  const w = fresh();
  const roleOf = new Map(ROSTER.map((p) => [p.id, p.role]));
  for (const m of w.state.chat_messages) {
    if (!m.channel || !roleOf.has(m.from)) continue;
    const role = roleOf.get(m.from);
    assert.ok(role === "manager" || CHANNEL_ROLES[m.channel].includes(role), `${m.from} (${role}) posted in #${m.channel}`);
  }
});

test("mailboxes by role: finance cannot open press or marketing's own box; marketing cannot open accounts", () => {
  const w = fresh();
  refused(call(w, "finance", "list_emails", { mailbox: "press" }), "forbidden");
  refused(call(w, "finance", "list_emails", { mailbox: "toad" }), "forbidden");
  refused(call(w, "marketing", "list_emails", { mailbox: "accounts" }), "forbidden");
  refused(call(w, "warehouse", "send_email", { mailbox: "accounts", to: ["x@example.com"], subject: "s", body: "b" }), "forbidden");
  ok(call(w, "finance", "list_emails", { mailbox: "accounts" }));
  ok(call(w, "marketing", "list_emails", { mailbox: "press" }));
  const boxes = ok(call(w, "finance", "list_mailboxes")).mailboxes.map((b) => b.mailbox);
  assert.ok(boxes.includes("accounts") && !boxes.includes("press") && !boxes.includes("hello"));
  assert.ok(!SHARED_BOXES.press.roles.includes("finance"));
});

// ---------------------------------------------------------------- news

test("the wider world's news history is in the paper, ids after news.json's, in date order", () => {
  const w = fresh();
  const n = w.state.news;
  assert.equal(n.length, loaded.seed.news.length + loaded.seed.world_news.length);
  assert.equal(new Set(n.map((x) => x.id)).size, n.length, "no id twice");
  for (let i = 1; i < n.length; i++) assert.ok(n[i - 1].at <= n[i].at);
  const rival = ok(call(w, "customer", "list_news", { section: "Business", limit: 100 })).news;
  assert.ok(rival.some((x) => String(x.source || "").startsWith("competitor_move:")));
});
