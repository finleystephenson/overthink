// Run: node --test infrastructure/engine/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorld, loadState, quoteBasket } from "./engine.js";

const business = JSON.parse(readFileSync(new URL("../../business/data/business.json", import.meta.url), "utf8"));
const NOW = "2026-11-23T10:00:00Z"; // a Monday, the anchor

// ------------------------------------------------------------ fixtures

const sockReturnable = { ok: true, note: "Standard 30-day return while still on its hanger card. Worn items: the refund can be reduced." };
const products = [
  {
    id: "spare-sock", name: "The Spare Sock", category: "everyday", status: "active",
    variants: [
      { sku: "SOCK-M", name: "Navy M", price: 7, stock: 40, restock_date: null },
      { sku: "SOCK-L", name: "Navy L", price: 7, stock: 10, restock_date: null },
      { sku: "SOCK-OUT", name: "Red S", price: 7, stock: 0, restock_date: "2026-12-01" },
    ],
    accessories: [{ sku: "SOCK-CLIP", name: "Sock Clips", kind: "accessory", price: 5, stock: 200, description: "Clips." }],
    compatibility: [{ with: "blip", works: false, note: "The sock does not fit the Blip." }],
    warranty: { months: 12 }, delivery: { methods: ["standard", "next-day"] }, returnable: sockReturnable,
    fix_club: { eligible: false, repairs: [] },
  },
  {
    id: "blip", name: "Blip", category: "tech", status: "active",
    variants: [{ sku: "BLIP-128", name: "128 GB", price: 129, stock: 5, restock_date: null }],
    warranty: { months: 24 }, delivery: { methods: ["standard", "next-day"] }, returnable: { ok: true, note: "30 days." },
    fix_club: { eligible: true, repairs: [{ code: "BLIP-SCREEN", name: "Screen", price: 89 }] },
  },
  {
    id: "emergency-sandwich", name: "The Emergency Sandwich", category: "food", status: "active",
    variants: [{ sku: "SAND-1", name: "Cheese", price: 6, stock: 999, restock_date: null }],
    warranty: { months: 0 }, delivery: { methods: ["chilled"] }, returnable: { ok: false, note: "Perishable." },
    fix_club: { eligible: false, repairs: [] },
  },
  {
    id: "wobble-kit", name: "Wobble Kit", category: "desk-home", status: "preorder", available_from: "2026-12-10",
    variants: [{ sku: "WOB-1", name: "Standard", price: 20, stock: 0, restock_date: "2026-12-10" }],
    warranty: { months: 12 }, delivery: { methods: ["standard"] }, returnable: { ok: true, note: "" },
  },
];

const services = [
  { id: "borrow-box", items: [
    { id: "BB-GAZEBO", name: "Gazebo", price_weekend: 45, price_week: 70, deposit: 60, units: 2, replacement_value: 220 },
    { id: "BB-LEAD", name: "Extension lead", price_weekend: 12, price_week: 20, deposit: 25, units: 3, replacement_value: 70 },
  ] },
  { id: "someone-to-clap",
    packages: [{ id: "CLAP-RIPPLE", name: "Polite Ripple", clappers: 3, minutes: 2, price: 60 }],
    add_ons: [{ id: "ADD-CHEER", name: "Light cheering", price: 15 }] },
  { id: "someone-to-queue", name: "Someone to Queue", slots: [],
    packages: [{ id: "QUEUE-1H", name: "One hour", price: 18, hours: 1 }, { id: "QUEUE-2H", name: "Two hours", price: 36, hours: 2 }, { id: "QUEUE-6H", name: "Six hours", price: 108, hours: 6 }, { id: "QUEUE-8H", name: "Eight hours", price: 144, hours: 8 }] },
  { id: "someone-to-hold", name: "Someone to Hold",
    packages: [{ id: "HOLD-CALL", name: "One call", price: 6, minutes: 60 }, { id: "HOLD-EXTRA", name: "Extra 30 minutes", price: 3, minutes: 30, note: "Added to a call as needed." }] },
  { id: "someone-to-wait-in", name: "Someone to Wait In", slots: ["08:00", "12:00"],
    packages: [{ id: "WAIT-HALF", name: "Half day", price: 45, hours: 4 }, { id: "WAIT-FULL", name: "Full day", price: 80, hours: 10 }] },
];

const addr = (postcode = "BF2 4LT") => ({ line1: "12 Tanner's Row", town: "Brookford", postcode });
const line = (sku, name, qty, unit_price) => ({ sku, name, qty, unit_price });
const ship = (id, skus, status, extra = {}) => ({ id, skus, status, carrier: "Swiftway Parcels", tracking: "T1", dispatched_at: null, eta: null, delivered_at: null, ...extra });
function order(n, cid, placed, status, items, shipments, delivery = 3.95, pc = "BF2 4LT") {
  const sum = items.reduce((t, l) => t + l.qty * l.unit_price, 0);
  return {
    number: `ORD-${n}`, customer_id: cid, placed_at: placed, status, items,
    totals: { items: sum, delivery, discount: 0, total: Math.round((sum + delivery) * 100) / 100 },
    payment: { status: "paid", method: "Test card ending 4242", refunded: 0 },
    delivery: { method: "standard", address: addr(pc) }, shipments, history: [],
  };
}
const booking = (n, cid, service, item_id, start, price, deposit = 0, party = 1) => ({
  number: `BKG-${n}`, customer_id: cid, service, item_id, start, end: start, party_size: party, add_ons: [], location: "Delivered and picked up",
  distance_miles: null, price, deposit, status: "confirmed", payment: { status: "paid", refunded: 0 }, reschedules: 0, created_at: "2026-11-01T09:00:00Z", note: "",
});

const seed = {
  customers: [
    { id: "C-1001", name: "Priya", email: "priya@example.com", phone: "1", addresses: [{ id: "A1", line1: "12 Tanner's Row", town: "Brookford", postcode: "BF2 4LT", default: true }], contact_preference: "email", marketing_opt_in: false, created_at: "2025-03-02T09:14:00Z", credit_balance: 0, notes: "" },
    { id: "C-1002", name: "Tom", email: "tom@example.com", phone: "2", addresses: [{ id: "A1", line1: "1 High St", town: "Brookford", postcode: "BF3 1AA", default: true }], contact_preference: "email", marketing_opt_in: false, created_at: "2025-03-02T09:14:00Z", credit_balance: 0, notes: "" },
  ],
  orders: [
    order(20001, "C-1001", "2026-11-22T10:00:00Z", "paid", [line("SOCK-M", "Sock", 1, 7), line("SOCK-L", "Sock L", 1, 7)], [ship("SHP-20001-1", ["SOCK-M", "SOCK-L"], "pending")]),
    order(20002, "C-1001", "2026-11-21T10:00:00Z", "packed", [line("SOCK-M", "Sock", 1, 7)], [ship("SHP-20002-1", ["SOCK-M"], "packed")]),
    order(20003, "C-1001", "2026-11-10T10:00:00Z", "delivered", [line("SOCK-M", "Sock", 1, 7), line("SOCK-CLIP", "Clips", 1, 5)],
      [ship("SHP-20003-1", ["SOCK-M", "SOCK-CLIP"], "delivered", { delivered_at: "2026-11-13T12:00:00Z" })]),
    order(20004, "C-1001", "2026-09-28T10:00:00Z", "delivered", [line("SOCK-M", "Sock", 1, 7)], [ship("SHP-20004-1", ["SOCK-M"], "delivered", { delivered_at: "2026-10-01T12:00:00Z" })]),
    order(20005, "C-1001", "2026-11-18T10:00:00Z", "part_dispatched", [line("BLIP-128", "Blip", 1, 129), line("SOCK-M", "Sock", 1, 7)], [
      ship("SHP-20005-1", ["BLIP-128"], "delivered", { delivered_at: "2026-11-20T09:00:00Z", dispatched_at: "2026-11-19T09:00:00Z" }),
      ship("SHP-20005-2", ["SOCK-M"], "in_transit", { dispatched_at: "2026-11-21T09:00:00Z", eta: "2026-11-24" })], 0),
    order(20006, "C-1001", "2026-11-18T10:00:00Z", "delivered", [line("SOCK-M", "Sock", 1, 7), line("SOCK-OUT", "Sock S", 1, 7)],
      [ship("SHP-20006-1", ["SOCK-M", "SOCK-OUT"], "delivered", { delivered_at: "2026-11-20T09:00:00Z" })]),
    order(20007, "C-1001", "2026-11-22T10:00:00Z", "delivered", [line("SAND-1", "Sandwich", 1, 6)], [ship("SHP-20007-1", ["SAND-1"], "delivered", { delivered_at: "2026-11-23T08:00:00Z" })], 8.95),
    order(20008, "C-1001", "2026-11-20T10:00:00Z", "delivered", [line("SAND-1", "Sandwich", 1, 6)], [ship("SHP-20008-1", ["SAND-1"], "delivered", { delivered_at: "2026-11-21T08:00:00Z" })], 8.95),
    order(20009, "C-1002", "2026-11-20T10:00:00Z", "paid", [line("SOCK-M", "Sock", 1, 7)], [ship("SHP-20009-1", ["SOCK-M"], "pending")], 3.95, "BF3 1AA"),
    order(20010, "C-1001", "2024-09-25T10:00:00Z", "delivered", [line("BLIP-128", "Blip", 1, 129)], [ship("SHP-20010-1", ["BLIP-128"], "delivered", { delivered_at: "2024-10-01T12:00:00Z" })], 0),
  ],
  repairs: [
    { number: "FIX-5001", customer_id: "C-1001", sku: "BLIP-128", registration_id: null, order_number: "ORD-20010", fault: "Cracked", in_warranty: false, created_at: "2026-11-10T10:00:00Z", status: "quote_sent", quote: { lines: [{ code: "BLIP-SCREEN", name: "Screen", price: 89 }], total: 89, sent_at: "2026-11-15T10:00:00Z", valid_until: "2026-11-29T10:00:00Z" }, promised_by: null, history: [] },
    { number: "FIX-5002", customer_id: "C-1001", sku: "BLIP-128", registration_id: null, order_number: "ORD-20010", fault: "Cracked", in_warranty: false, created_at: "2026-10-01T10:00:00Z", status: "quote_sent", quote: { lines: [], total: 89, sent_at: "2026-10-05T10:00:00Z", valid_until: "2026-10-19T10:00:00Z" }, promised_by: null, history: [] },
  ],
  bookings: [
    { ...booking(7001, "C-1002", "borrow-box", "BB-GAZEBO", "2026-11-27T10:00:00Z", 45, 60), end: "2026-11-30T12:00:00Z" },
    { ...booking(7002, "C-1002", "borrow-box", "BB-GAZEBO", "2026-11-27T10:00:00Z", 45, 60), end: "2026-11-30T12:00:00Z" },
    { ...booking(7003, "C-1001", "borrow-box", "BB-LEAD", "2026-11-24T10:00:00Z", 20, 25), end: "2026-11-30T12:00:00Z" },
    { ...booking(7004, "C-1001", "borrow-box", "BB-LEAD", "2026-12-04T10:00:00Z", 12, 25), end: "2026-12-07T12:00:00Z" },
    booking(7010, "C-1001", "someone-to-clap", "CLAP-RIPPLE", "2026-11-27T10:00:00Z", 60),
    booking(7011, "C-1001", "someone-to-clap", "CLAP-RIPPLE", "2026-11-25T13:00:00Z", 60),
    booking(7012, "C-1001", "someone-to-clap", "CLAP-RIPPLE", "2026-11-24T16:00:00Z", 60),
    booking(7013, "C-1001", "someone-to-clap", "CLAP-RIPPLE", "2026-11-23T19:00:00Z", 60),
    booking(7014, "C-1002", "someone-to-clap", "CLAP-RIPPLE", "2026-12-01T10:00:00Z", 60), booking(7015, "C-1002", "someone-to-clap", "CLAP-RIPPLE", "2026-12-01T10:00:00Z", 60),
    // Queue, Hold, Wait In. Now is Mon 23 Nov 10:00, so 7030/7040/7050 are 24+ hours away and 7031/7041/7051 are inside 24 hours.
    { ...booking(7030, "C-1001", "someone-to-queue", "QUEUE-2H", "2026-11-25T10:00:00Z", 36), end: "2026-11-25T12:00:00Z", location: "Post office", note: "Parcel drop" },
    { ...booking(7031, "C-1001", "someone-to-queue", "QUEUE-1H", "2026-11-24T09:00:00Z", 18), end: "2026-11-24T10:00:00Z", location: "Post office", note: "Parcel drop" },
    { ...booking(7040, "C-1001", "someone-to-hold", "HOLD-CALL", "2026-11-26T10:00:00Z", 6), end: "2026-11-26T11:00:00Z", location: "0300 000 0000", note: "Broadband refund" },
    { ...booking(7041, "C-1001", "someone-to-hold", "HOLD-CALL", "2026-11-24T09:00:00Z", 6), end: "2026-11-24T10:00:00Z", location: "0300 000 0001", note: "Council tax" },
    { ...booking(7050, "C-1001", "someone-to-wait-in", "WAIT-HALF", "2026-11-27T08:00:00Z", 45), end: "2026-11-27T12:00:00Z", location: "1 High St" },
    { ...booking(7051, "C-1001", "someone-to-wait-in", "WAIT-HALF", "2026-11-24T08:00:00Z", 45), end: "2026-11-24T12:00:00Z", location: "1 High St" },
    { ...booking(7052, "C-1002", "someone-to-wait-in", "WAIT-FULL", "2026-12-02T08:00:00Z", 80), end: "2026-12-02T18:00:00Z", location: "2 Low St" },
    { ...booking(7053, "C-1002", "someone-to-queue", "QUEUE-2H", "2026-12-01T09:00:00Z", 36), end: "2026-12-01T11:00:00Z", location: "Ticket office", note: "Tickets" },
  ],
};

const build = (now = NOW) => createWorld({ business, products, services, policies: [{ id: "returns", title: "Returns", body: "You have 30 days.\n\nPostage is deducted." }], help: [], seed, now });
function verified(world = build(), ref = "ORD-20001", proof = "priya@example.com") {
  const s = world.session({ role: "assistant" });
  assert.equal(s.call("verify_customer", { reference: ref, email_or_postcode: proof }).ok, true);
  return { world, s };
}
const err = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.error.code, code, r.error.message); return r.error; };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
const find = (w, coll, key, id) => w.state[coll].find((x) => x[key] === id);

// ------------------------------------------------------------ permissions and verification

test("assistant gets forbidden on issue_refund and the attempt is audited", () => {
  const { world, s } = verified();
  err(s.call("issue_refund", { order_number: "ORD-20001", amount: 5, reason: "x" }), "forbidden");
  const last = world.state.audit.at(-1);
  assert.deepEqual([last.tool, last.ok, last.error_code], ["issue_refund", false, "forbidden"]);
});

test("assistant cannot place orders (it sends people to the website)", () => {
  const { s } = verified();
  err(s.call("place_order", { items: [{ sku: "SOCK-M", qty: 1 }], delivery_method: "standard", card_number: "4242 4242 4242 4242" }), "forbidden");
});

test("unverified assistant gets not_verified on customer tools", () => {
  const s = build().session({ role: "assistant" });
  err(s.call("get_order", { order_number: "ORD-20001" }), "not_verified");
  err(s.call("list_orders", {}), "not_verified");
});

test("open tools work without verification", () => {
  const s = build().session({ role: "assistant" });
  assert.equal(ok(s.call("check_stock", { sku: "SOCK-OUT" })).in_stock, false);
  assert.equal(ok(s.call("search_catalogue", { query: "blip" })).results[0].id, "blip");
});

test("verify by order number plus postcode, spaces and case ignored", () => {
  const { s } = verified(build(), "ORD-20001", "bf24lt");
  assert.equal(ok(s.call("get_customer", {})).name, "Priya");
});

test("a verified session cannot see another customer's order: not_found", () => {
  const { s } = verified();
  const e = err(s.call("get_order", { order_number: "ORD-20009" }), "not_found");
  assert.doesNotMatch(e.message, /another|belongs|someone else/i);
  err(s.call("get_order", { order_number: "ORD-99999" }), "not_found");
});

test("three failed verifications lock the session with needs_human", () => {
  const s = build().session({ role: "assistant" });
  err(s.call("verify_customer", { reference: "ORD-20001", email_or_postcode: "no@x.com" }), "not_verified");
  err(s.call("verify_customer", { reference: "ORD-20001", email_or_postcode: "no@x.com" }), "not_verified");
  err(s.call("verify_customer", { reference: "ORD-20001", email_or_postcode: "no@x.com" }), "needs_human");
  err(s.call("verify_customer", { reference: "ORD-20001", email_or_postcode: "priya@example.com" }), "needs_human");
});

test("a customer session is always itself", () => {
  const s = build().session({ role: "customer", customer_id: "C-1002" });
  assert.equal(ok(s.call("get_order", { order_number: "ORD-20009" })).number, "ORD-20009");
  err(s.call("get_order", { order_number: "ORD-20001" }), "not_found");
});

test("escalate works unverified but needs a contact detail", () => {
  const { world } = verified();
  const s = world.session({ role: "assistant" });
  err(s.call("escalate", { to: "support_agent", reason: "wants a person", summary: "Angry" }), "invalid_input");
  const d = ok(s.call("escalate", { to: "support_agent", reason: "wants a person", summary: "Angry", contact: "a@b.com" }));
  assert.equal(find(world, "cases", "number", d.case_number).status, "escalated");
});

test("invalid input is rejected and nothing changes", () => {
  const { world, s } = verified();
  const before = JSON.stringify({ ...world.state, audit: [] });
  err(s.call("cancel_order", { order_number: 5 }), "invalid_input");
  assert.equal(JSON.stringify({ ...world.state, audit: [] }), before);
});

test("world.tools lists every tool with schema and roles", () => {
  const { tools } = build();
  assert.ok(tools.length >= 40);
  for (const t of tools) assert.ok(t.name && t.description && t.input_schema.type === "object" && t.roles.length);
  assert.deepEqual(tools.find((t) => t.name === "issue_refund").roles, ["support_agent", "support_lead"]);
});

// ------------------------------------------------------------ orders

test("cancel before packed refunds, restores stock and gives a refund date in working days", () => {
  const { world, s } = verified();
  const d = ok(s.call("cancel_order", { order_number: "ORD-20001", reason: "changed plans" }));
  assert.equal(d.refund_amount, 17.95);
  assert.equal(d.refund_expected_by, "2026-11-30"); // 5 working days after Monday 23 Nov
  const o = find(world, "orders", "number", "ORD-20001");
  assert.deepEqual([o.status, o.payment.status], ["cancelled", "refunded"]);
  assert.equal(world.state.stock["SOCK-M"].on_hand, 41);
  assert.match(world.state.audit.at(-1).changes.join("|"), /order ORD-20001 status paid → cancelled/);
});

test("cancel after packed is refused with the rule in plain English", () => {
  const { s } = verified();
  const e = err(s.call("cancel_order", { order_number: "ORD-20002", reason: "x" }), "rule_violation");
  assert.match(e.message, /packed/);
  assert.match(e.message, /cannot be stopped in the warehouse/);
  assert.match(e.message, /returning it once it arrives, within 14 days of delivery/);
  assert.doesNotMatch(e.message, /cannot be cancelled/);
});

test("warehouse packing an order stops the assistant cancelling it", () => {
  const { world, s } = verified();
  const w = world.session({ role: "warehouse" });
  ok(w.call("advance_order", { order_number: "ORD-20001", to: "packed" }));
  err(s.call("cancel_order", { order_number: "ORD-20001", reason: "x" }), "rule_violation");
});

test("address change before packed works; unreachable postcode is refused", () => {
  const { world, s } = verified();
  ok(s.call("update_order", { order_number: "ORD-20001", address: { line1: "5 New Rd", town: "Brookford", postcode: "BF5 5AA" } }));
  assert.equal(find(world, "orders", "number", "ORD-20001").delivery.address.line1, "5 New Rd");
  const e = err(s.call("update_order", { order_number: "ORD-20001", address: { line1: "1 Quay", town: "Belfast", postcode: "BT1 1AA" } }), "rule_violation");
  assert.match(e.message, /Northern Ireland/);
  err(s.call("update_order", { order_number: "ORD-20002", address: addr() }), "rule_violation");
});

test("delivery method change recalculates the delivery charge; chilled-only items refuse next-day", () => {
  const { world, s } = verified();
  ok(s.call("update_order", { order_number: "ORD-20001", delivery_method: "next-day" }));
  const o = find(world, "orders", "number", "ORD-20001");
  assert.deepEqual([o.totals.delivery, o.totals.total], [6.95, 20.95]);
  err(s.call("update_order", { order_number: "ORD-20001", delivery_method: "chilled" }), "rule_violation");
});

test("swap variant: same product and same price only, needs stock", () => {
  const { world, s } = verified();
  err(s.call("update_order", { order_number: "ORD-20001", swap: { from_sku: "SOCK-M", to_sku: "SOCK-OUT" } }), "out_of_stock");
  const o = find(world, "orders", "number", "ORD-20001");
  assert.equal(o.items[0].sku, "SOCK-M");
  err(s.call("update_order", { order_number: "ORD-20001", swap: { from_sku: "SOCK-M", to_sku: "BLIP-128" } }), "rule_violation");
});

test("swap succeeds when in stock and moves stock", () => {
  const { world, s } = verified();
  err(s.call("update_order", { order_number: "ORD-20002", swap: { from_sku: "SOCK-M", to_sku: "SOCK-L" } }), "rule_violation"); // packed
  ok(s.call("update_order", { order_number: "ORD-20001", swap: { from_sku: "SOCK-M", to_sku: "SOCK-L" } }));
  assert.equal(world.state.stock["SOCK-L"].on_hand, 9);
  assert.equal(world.state.stock["SOCK-M"].on_hand, 41);
});

// ------------------------------------------------------------ returns

test("return eligibility: in window gives the refund both ways", () => {
  const { s } = verified();
  const d = ok(s.call("check_return_eligibility", { order_number: "ORD-20003", sku: "SOCK-M" }));
  assert.equal(d.eligible, true);
  assert.equal(d.return_by, "2026-12-13");
  assert.equal(d.refund_if_change_of_mind.refund_amount, 4.05); // 7 - 2.95 postage, delivery kept
  assert.equal(d.refund_if_faulty.refund_amount, 10.95); // 7 + 3.95 delivery, no postage
});

test("return eligibility: out of window, not arrived, food and worn", () => {
  const { s } = verified();
  const out = ok(s.call("check_return_eligibility", { order_number: "ORD-20004", sku: "SOCK-M" }));
  assert.equal(out.code, "out_of_window");
  assert.match(out.message, /30 days/);
  assert.equal(ok(s.call("check_return_eligibility", { order_number: "ORD-20001", sku: "SOCK-M" })).code, "not_arrived");
  assert.equal(ok(s.call("check_return_eligibility", { order_number: "ORD-20007", sku: "SAND-1" })).code, "not_returnable");
});

test("worn return is allowed, marked for inspection, and promises no amount", () => {
  const { world, s } = verified();
  const e = ok(s.call("check_return_eligibility", { order_number: "ORD-20003", sku: "SOCK-M", worn: true }));
  assert.deepEqual([e.eligible, e.inspection_required, e.refund_amount, e.refund_amount_decided_after_inspection], [true, true, null, true]);
  assert.match(e.message, /person will inspect/);
  assert.match(e.message, /cannot be promised/);
  const r = ok(s.call("create_return", { order_number: "ORD-20003", items: [{ sku: "SOCK-M" }], reason: "change_of_mind", worn: true }));
  assert.deepEqual([r.inspection_required, r.refund_amount, r.refund_amount_decided_after_inspection], [true, null, true]);
  assert.match(r.message, /decides the refund/);
  assert.equal(world.state.returns.length, 1);
  // Faulty goods are always returnable and are not treated as used.
  assert.equal(ok(s.call("check_return_eligibility", { order_number: "ORD-20003", sku: "SOCK-M" })).inspection_required, undefined);
});

test("worn items are exempt-free: food stays exempt, opened tin and unsealed helmet follow the business rules", () => {
  const { s } = verified();
  assert.equal(ok(s.call("check_return_eligibility", { order_number: "ORD-20007", sku: "SAND-1", worn: true })).code, "not_returnable");
});

test("create_return: change of mind deducts postage; partial return keeps the delivery charge", () => {
  const { world, s } = verified();
  const d = ok(s.call("create_return", { order_number: "ORD-20003", items: [{ sku: "SOCK-M", qty: 1 }], reason: "change_of_mind" }));
  assert.deepEqual([d.number, d.status, d.postage_deducted, d.refund_amount], ["RET-1", "label_sent", 2.95, 4.05]);
  assert.equal(world.state.returns.length, 1);
  err(s.call("create_return", { order_number: "ORD-20003", items: [{ sku: "SOCK-M" }], reason: "change_of_mind" }), "rule_violation"); // already returned
});

test("create_return: whole order refunds the delivery charge too", () => {
  const { s } = verified();
  const d = ok(s.call("create_return", { order_number: "ORD-20003", items: [{ sku: "SOCK-M" }, { sku: "SOCK-CLIP" }], reason: "change_of_mind" }));
  assert.equal(d.refund_amount, 13); // 12 + 3.95 - 2.95
});

test("create_return: change of mind on the whole order refunds delivery only up to the Soon price", () => {
  const world = build();
  const o = find(world, "orders", "number", "ORD-20003");
  o.totals.delivery = 6.95; // paid for Sooner
  o.totals.total = 18.95;
  const s = verified(world).s;
  const d = ok(s.call("create_return", { order_number: "ORD-20003", items: [{ sku: "SOCK-M" }, { sku: "SOCK-CLIP" }], reason: "change_of_mind" }));
  assert.equal(d.delivery_refunded, 3.95); // Soon price, not the 6.95 paid
  assert.equal(d.refund_amount, 13); // 12 + 3.95 - 2.95
});

test("create_return: a faulty whole-order return still refunds all the delivery paid", () => {
  const world = build();
  const o = find(world, "orders", "number", "ORD-20003");
  o.totals.delivery = 6.95;
  o.totals.total = 18.95;
  const s = verified(world).s;
  const d = ok(s.call("create_return", { order_number: "ORD-20003", items: [{ sku: "SOCK-M" }, { sku: "SOCK-CLIP" }], reason: "faulty" }));
  assert.equal(d.delivery_refunded, 6.95);
});

test("create_return: faulty is free of postage and refunds delivery", () => {
  const { s } = verified();
  const d = ok(s.call("create_return", { order_number: "ORD-20003", items: [{ sku: "SOCK-M" }], reason: "faulty" }));
  assert.deepEqual([d.postage_deducted, d.refund_amount], [0, 10.95]);
});

test("create_return refuses out-of-window and worn items", () => {
  const { world, s } = verified();
  err(s.call("create_return", { order_number: "ORD-20004", items: [{ sku: "SOCK-M" }], reason: "change_of_mind" }), "rule_violation");
  err(s.call("create_return", { order_number: "ORD-20007", items: [{ sku: "SAND-1" }], reason: "change_of_mind" }), "rule_violation");
  assert.equal(world.state.returns.length, 0);
});

test("warehouse receiving a passed return releases the refund", () => {
  const { world, s } = verified();
  const r = ok(s.call("create_return", { order_number: "ORD-20003", items: [{ sku: "SOCK-M" }], reason: "change_of_mind" }));
  const w = world.session({ role: "warehouse" });
  const d = ok(w.call("receive_return", { return_number: r.number, passed: true }));
  assert.equal(d.refund_due_by, "2026-11-30");
  const o = find(world, "orders", "number", "ORD-20003");
  assert.deepEqual([o.payment.refunded, o.payment.status], [4.05, "part_refunded"]);
});

// ------------------------------------------------------------ report_problem

test("missing item with a second parcel still on its way: no replacement, says so", () => {
  const { world, s } = verified();
  const d = ok(s.call("report_problem", { order_number: "ORD-20005", sku: "SOCK-M", problem: "missing", resolution: "replacement" }));
  assert.equal(d.outcome, "second_parcel_pending");
  assert.equal(d.shipment, "SHP-20005-2");
  assert.equal(world.state.cases.length, 0);
});

test("damaged item up to £60 and in stock: replacement shipment, stock down, case created", () => {
  const { world, s } = verified();
  err(s.call("report_problem", { order_number: "ORD-20006", sku: "SOCK-M", problem: "damaged", resolution: "replacement" }), "rule_violation"); // needs photo
  const d = ok(s.call("report_problem", { order_number: "ORD-20006", sku: "SOCK-M", problem: "damaged", resolution: "replacement", has_photo: true }));
  assert.equal(d.outcome, "replacement");
  assert.equal(world.state.stock["SOCK-M"].on_hand, 39);
  assert.equal(find(world, "orders", "number", "ORD-20006").shipments.length, 2);
  assert.equal(find(world, "cases", "number", d.case_number).status, "resolved");
});

test("damaged item over £60: needs_human and an escalated case", () => {
  const { world, s } = verified();
  const e = err(s.call("report_problem", { order_number: "ORD-20005", sku: "BLIP-128", problem: "damaged", resolution: "replacement", has_photo: true }), "needs_human");
  assert.equal(find(world, "cases", "number", e.case_number).status, "escalated");
  assert.equal(world.state.stock["BLIP-128"].on_hand, 5);
});

test("replacement of an out-of-stock item: needs_human", () => {
  const { s } = verified();
  err(s.call("report_problem", { order_number: "ORD-20006", sku: "SOCK-OUT", problem: "wrong", resolution: "replacement" }), "needs_human");
});

test("assistant cannot refund a damaged item; spoiled food up to £30 within 24 hours is refunded", () => {
  const { world, s } = verified();
  err(s.call("report_problem", { order_number: "ORD-20006", sku: "SOCK-M", problem: "damaged", resolution: "refund", has_photo: true }), "needs_human");
  const d = ok(s.call("report_problem", { order_number: "ORD-20007", sku: "SAND-1", problem: "spoiled", resolution: "refund", has_photo: true }));
  assert.equal(d.refund_amount, 6);
  assert.equal(find(world, "orders", "number", "ORD-20007").payment.refunded, 6);
});

test("late problem report is not refused: it opens a case and goes to a person", () => {
  const { world, s } = verified();
  const e = err(s.call("report_problem", { order_number: "ORD-20008", sku: "SAND-1", problem: "spoiled", resolution: "refund", has_photo: true }), "needs_human");
  assert.match(e.message, /24 hours/);
  assert.match(e.message, /person will look at it/);
  assert.match(e.message, /legal rights still apply/);
  const e2 = err(s.call("report_problem", { order_number: "ORD-20004", sku: "SOCK-M", problem: "damaged", resolution: "replacement", has_photo: true }), "needs_human");
  assert.match(e2.message, /14 days/);
  assert.match(e2.message, /legal rights still apply/);
  const c = world.state.cases.find((x) => x.number === e2.case_number);
  assert.ok(c);
  assert.equal(c.status, "escalated");
  assert.equal(world.state.orders.find((o) => o.number === "ORD-20004").payment.refunded, 0);
});

// ------------------------------------------------------------ repairs and registration

test("create_repair works out in_warranty from the purchase date", () => {
  const { s } = verified();
  const inW = ok(s.call("create_repair", { sku: "BLIP-128", fault: "Dead", order_number: "ORD-20005" }));
  assert.deepEqual([inW.in_warranty, inW.number, inW.assessment_fee], [true, "FIX-5003", 0]);
  const out = ok(s.call("create_repair", { sku: "BLIP-128", fault: "Dead", order_number: "ORD-20010" }));
  assert.deepEqual([out.in_warranty, out.assessment_fee], [false, 15]);
  assert.equal(out.fixed_price_list[0].price, 89);
});

test("create_repair refuses non-eligible products and missing proof of purchase", () => {
  const { s } = verified();
  err(s.call("create_repair", { sku: "SAND-1", fault: "Stale", order_number: "ORD-20007" }), "rule_violation");
  err(s.call("create_repair", { sku: "BLIP-128", fault: "Dead" }), "invalid_input");
});

test("register_product sets warranty end; duplicates and no-warranty products are refused", () => {
  const { s } = verified();
  const d = ok(s.call("register_product", { sku: "SOCK-M", order_number: "ORD-20003" }));
  assert.equal(d.warranty_until, "2027-11-13");
  err(s.call("register_product", { sku: "SOCK-M", order_number: "ORD-20003" }), "rule_violation");
  err(s.call("register_product", { sku: "SAND-1", order_number: "ORD-20007" }), "rule_violation");
});

test("quote approval: valid quote is approved with a promised date; expired quote is refused", () => {
  const { world, s } = verified();
  const d = ok(s.call("approve_repair_quote", { repair_number: "FIX-5001" }));
  assert.equal(d.status, "approved");
  assert.equal(d.promised_by, "2026-12-07"); // 10 working days
  const e = err(s.call("approve_repair_quote", { repair_number: "FIX-5002" }), "rule_violation");
  assert.match(e.message, /ran out/);
  assert.equal(find(world, "repairs", "number", "FIX-5002").status, "quote_sent");
});

test("technician quote lasts the period in business.json", () => {
  const { world } = verified();
  const t = world.session({ role: "technician" });
  const r = ok(t.call("update_repair", { repair_number: "FIX-5002", status: "quote_sent", quote: { lines: [{ code: "X", name: "Fix", price: 30 }] } }));
  assert.equal(r.quote.valid_until, "2026-12-07");
  assert.equal(r.quote.total, 30);
});

// ------------------------------------------------------------ bookings: borrow box

test("borrow box: weekend booking takes price and deposit, fixes the times", () => {
  const { world, s } = verified();
  const d = ok(s.call("create_booking", { service: "borrow-box", item_id: "BB-GAZEBO", start: "2026-12-04" }));
  assert.deepEqual([d.start, d.end, d.price, d.deposit, d.number], ["2026-12-04T10:00:00Z", "2026-12-07T12:00:00Z", 45, 60, "BKG-7054"]);
  assert.equal(world.state.bookings.length, seed.bookings.length + 1);
});

test("borrow box: 24 hours notice and units are enforced", () => {
  const { s } = verified();
  const e = err(s.call("create_booking", { service: "borrow-box", item_id: "BB-LEAD", start: "2026-11-23" }), "rule_violation");
  assert.match(e.message, /24 hours/);
  err(s.call("create_booking", { service: "borrow-box", item_id: "BB-GAZEBO", start: "2026-11-27" }), "unavailable"); // both gazebos out
});

test("borrow box cancel: full refund 48+ hours ahead, 50% under 48 hours, deposit always back", () => {
  const { s } = verified();
  const early = ok(s.call("cancel_booking", { booking_number: "BKG-7004" }));
  assert.deepEqual([early.price_refund, early.deposit_refund, early.refund_amount], [12, 25, 37]);
  const late = ok(s.call("cancel_booking", { booking_number: "BKG-7003" }));
  assert.deepEqual([late.price_refund, late.deposit_refund, late.refund_amount], [10, 25, 35]);
});

test("borrow box reschedule is free 48+ hours ahead and refused inside 48 hours", () => {
  const { s } = verified();
  const d = ok(s.call("reschedule_booking", { booking_number: "BKG-7004", new_start: "2026-12-11" }));
  assert.equal(d.booking.start, "2026-12-11T10:00:00Z");
  err(s.call("reschedule_booking", { booking_number: "BKG-7003", new_start: "2026-12-11" }), "rule_violation");
});

// ------------------------------------------------------------ bookings: someone to clap

test("clap: package, add-on and mileage beyond the included area are priced", () => {
  const { s } = verified();
  assert.equal(ok(s.call("create_booking", { service: "someone-to-clap", item_id: "CLAP-RIPPLE", start: "2026-11-30T13:00:00Z", add_ons: ["ADD-CHEER"] })).price, 75);
  assert.equal(ok(s.call("create_booking", { service: "someone-to-clap", item_id: "CLAP-RIPPLE", start: "2026-11-30T16:00:00Z", distance_miles: 40 })).price, 70);
});

test("clap: notice, service area, slot, Sunday and full crews are enforced", () => {
  const { s } = verified();
  const e = err(s.call("create_booking", { service: "someone-to-clap", item_id: "CLAP-RIPPLE", start: "2026-11-25T13:00:00Z" }), "rule_violation");
  assert.match(e.message, /72 hours/);
  err(s.call("create_booking", { service: "someone-to-clap", item_id: "CLAP-RIPPLE", start: "2026-11-30T13:00:00Z", distance_miles: 61 }), "rule_violation");
  err(s.call("create_booking", { service: "someone-to-clap", item_id: "CLAP-RIPPLE", start: "2026-11-30T14:00:00Z" }), "invalid_input");
  err(s.call("create_booking", { service: "someone-to-clap", item_id: "CLAP-RIPPLE", start: "2026-11-29T13:00:00Z" }), "rule_violation");
  err(s.call("create_booking", { service: "someone-to-clap", item_id: "CLAP-RIPPLE", start: "2026-12-01T10:00:00Z" }), "unavailable");
});

test("clap cancel tiers: full, half, none", () => {
  const { s } = verified();
  assert.equal(ok(s.call("cancel_booking", { booking_number: "BKG-7010" })).refund_amount, 60);
  assert.equal(ok(s.call("cancel_booking", { booking_number: "BKG-7012" })).refund_amount, 30);
  assert.equal(ok(s.call("cancel_booking", { booking_number: "BKG-7013" })).refund_amount, 0);
});

test("clap reschedule: first free, second costs £15, inside 48 hours refused", () => {
  const { s } = verified();
  assert.equal(ok(s.call("reschedule_booking", { booking_number: "BKG-7010", new_start: "2026-12-02T10:00:00Z" })).fee, 0);
  assert.equal(ok(s.call("reschedule_booking", { booking_number: "BKG-7010", new_start: "2026-12-03T10:00:00Z" })).fee, 15);
  err(s.call("reschedule_booking", { booking_number: "BKG-7012", new_start: "2026-12-02T10:00:00Z" }), "rule_violation");
});

// ------------------------------------------------------------ bookings: queue, hold, wait in

const Q = { service: "someone-to-queue", item_id: "QUEUE-2H", location: "Town hall counter", note: "Planning permission" };

test("queue: priced from the package, ends after the package hours, needs place and purpose", () => {
  const { s } = verified();
  const b = ok(s.call("create_booking", { ...Q, start: "2026-11-30T09:00:00Z" }));
  assert.deepEqual([b.price, b.end, b.deposit], [36, "2026-11-30T11:00:00Z", 0]);
  err(s.call("create_booking", { service: Q.service, item_id: Q.item_id, start: "2026-11-30T14:00:00Z" }), "invalid_input");
  err(s.call("create_booking", { ...Q, start: "2026-11-30T09:30:00Z" }), "invalid_input"); // not on the hour
  err(s.call("create_booking", { ...Q, start: "2026-11-29T09:00:00Z" }), "rule_violation"); // Sunday
  err(s.call("create_booking", { ...Q, item_id: "QUEUE-8H", start: "2026-11-30T09:00:00Z" }), "rule_violation"); // over 6 hours
});

test("queue: too-short notice, taken slot and the will-not rule", () => {
  const { s } = verified();
  const e = err(s.call("create_booking", { ...Q, start: "2026-11-24T09:00:00Z" }), "rule_violation"); // 23 hours ahead
  assert.match(e.message, /24 hours/);
  err(s.call("create_booking", { ...Q, start: "2026-11-25T11:00:00Z" }), "unavailable"); // overlaps BKG-7030, 10:00 to 12:00
  ok(s.call("create_booking", { ...Q, start: "2026-11-25T12:00:00Z" })); // starts as 7030 ends
  const id = err(s.call("create_booking", { ...Q, start: "2026-11-30T09:00:00Z", note: "Collect my passport" }), "rule_violation");
  assert.match(id.message, /ID in the customer.s name/);
  const av = ok(s.call("check_availability", { service: "someone-to-queue", item_id: "QUEUE-2H", date: "2026-11-25" }));
  assert.equal(av.slots.find((x) => x.slot === "10:00").free, false);
  assert.equal(av.slots.find((x) => x.slot === "15:00").free, true);
});

test("hold: £6 a call, £3 per extra half hour, number and purpose needed, will-not lines refused", () => {
  const { s } = verified();
  const H = { service: "someone-to-hold", item_id: "HOLD-CALL", location: "0345 000 0000", note: "Energy bill", start: "2026-11-30T14:15:00Z" };
  assert.equal(ok(s.call("create_booking", H)).price, 6);
  const two = ok(s.call("create_booking", { ...H, start: "2026-12-01T14:15:00Z", add_ons: ["HOLD-EXTRA", "HOLD-EXTRA"] }));
  assert.deepEqual([two.price, two.end], [12, "2026-12-01T16:15:00Z"]);
  err(s.call("create_booking", { ...H, start: "2026-12-02T14:15:00Z", note: undefined }), "invalid_input");
  err(s.call("create_booking", { ...H, start: "2026-12-02T14:15:00Z", note: "My bank says my card is blocked (fraud team)" }), "rule_violation");
  err(s.call("create_booking", { ...H, start: "2026-11-24T09:00:00Z" }), "rule_violation"); // 23 hours ahead
  err(s.call("create_booking", H), "unavailable"); // same number, same time, same customer
});

test("wait in: half day from a listed start, full day 8 to 6, one waiter per day-part", () => {
  const { s } = verified();
  const W = { service: "someone-to-wait-in", location: "1 High St" };
  const half = ok(s.call("create_booking", { ...W, item_id: "WAIT-HALF", start: "2026-11-30T12:00:00Z" }));
  assert.deepEqual([half.price, half.end], [45, "2026-11-30T16:00:00Z"]);
  const full = ok(s.call("create_booking", { ...W, item_id: "WAIT-FULL", start: "2026-12-04T08:00:00Z" }));
  assert.deepEqual([full.price, full.end], [80, "2026-12-04T18:00:00Z"]);
  err(s.call("create_booking", { ...W, item_id: "WAIT-FULL", start: "2026-12-04T12:00:00Z" }), "invalid_input"); // full day starts at 08:00
  err(s.call("create_booking", { ...W, item_id: "WAIT-HALF", start: "2026-12-02T08:00:00Z" }), "unavailable"); // BKG-7052 holds that day
  err(s.call("create_booking", { ...W, item_id: "WAIT-HALF", start: "2026-12-05T10:00:00Z" }), "invalid_input");
});

test("queue, hold and wait in cancel: full refund 24+ hours ahead, nothing inside 24 hours", () => {
  const { world, s } = verified();
  for (const [full, late, price] of [["BKG-7030", "BKG-7031", 36], ["BKG-7040", "BKG-7041", 6], ["BKG-7050", "BKG-7051", 45]]) {
    const r = ok(s.call("cancel_booking", { booking_number: full }));
    assert.deepEqual([r.refund_amount, r.credit_amount], [price, 0]);
    assert.equal(find(world, "bookings", "number", full).payment.status, "refunded");
    assert.equal(ok(s.call("cancel_booking", { booking_number: late })).refund_amount, 0);
    err(s.call("cancel_booking", { booking_number: late }), "rule_violation");
  }
});

test("queue, hold and wait in reschedule: free 24+ hours ahead, refused inside 24 hours or onto a taken slot", () => {
  const { s } = verified();
  const moved = ok(s.call("reschedule_booking", { booking_number: "BKG-7030", new_start: "2026-12-03T10:00:00Z" }));
  assert.deepEqual([moved.fee, moved.booking.start, moved.booking.price], [0, "2026-12-03T10:00:00Z", 36]);
  ok(s.call("reschedule_booking", { booking_number: "BKG-7040", new_start: "2026-12-03T10:00:00Z" }));
  err(s.call("reschedule_booking", { booking_number: "BKG-7031", new_start: "2026-12-03T14:00:00Z" }), "rule_violation");
  err(s.call("reschedule_booking", { booking_number: "BKG-7050", new_start: "2026-12-02T08:00:00Z" }), "unavailable");
});

const iceWorld = () => {
  const world = createWorld({ business, products: [...products, { id: "ice-by-post", name: "Ice by Post", category: "food", status: "active", variants: [{ sku: "ICE-1", name: "Cubes", price: 8, stock: 9, restock_date: null }], delivery: { methods: ["chilled"] }, returnable: { ok: false, note: "" } }], services, policies: [], help: [], now: NOW,
    seed: { ...seed, orders: [...seed.orders, order(20050, "C-1001", "2026-11-22T10:00:00Z", "delivered", [line("ICE-1", "Ice by Post", 1, 8)], [ship("SHP-20050-1", ["ICE-1"], "delivered", { delivered_at: "2026-11-23T08:00:00Z" })], 8.95)] } });
  return world;
};

test("report_problem spoiled refuses Ice by Post with the business.json ice_note", () => {
  const world = iceWorld();
  const { s } = verified(world);
  const e = err(s.call("report_problem", { order_number: "ORD-20050", sku: "ICE-1", problem: "spoiled", resolution: "refund", has_photo: true }), "rule_violation");
  assert.equal(e.message, business.problems.ice_note);
  assert.match(e.message, /leaking, torn or contaminated/);
  assert.equal(world.state.cases.length, seed.cases?.length ?? 0); // no case opened, nothing refunded
});

test("report_problem damaged on Ice by Post (leak, tear, contamination) works like any faulty item", () => {
  const world = iceWorld();
  const { s } = verified(world);
  const d = ok(s.call("report_problem", { order_number: "ORD-20050", sku: "ICE-1", problem: "damaged", resolution: "replacement", has_photo: true }));
  assert.equal(d.outcome, "replacement");
  assert.ok(d.case_number);
});

// ------------------------------------------------------------ checkout, stock, delivery

test("create_customer makes a session into that customer and nothing else works before it", () => {
  const world = build();
  const s = world.session({ role: "customer" });
  err(s.call("get_customer", {}), "not_verified");
  assert.equal(ok(s.call("search_catalogue", { query: "sock" })).results.length > 0, true);
  const c = ok(s.call("create_customer", { name: "Sam", email: "sam@example.com", address: addr("BF9 9ZZ") }));
  assert.equal(c.id, "C-1003");
  assert.equal(ok(s.call("get_customer", {})).email, "sam@example.com");
  err(world.session({ role: "customer" }).call("create_customer", { name: "S", email: "SAM@example.com", address: addr() }), "rule_violation");
  err(world.session({ role: "assistant" }).call("create_customer", { name: "S", email: "q@example.com", address: addr() }), "forbidden");
});

test("place_order decrements stock, makes pending shipments and a history entry", () => {
  const world = build();
  const s = world.session({ role: "customer", customer_id: "C-1001" });
  const o = ok(s.call("place_order", { items: [{ sku: "SOCK-M", qty: 2 }], delivery_method: "standard", card_number: "4242 4242 4242 4242" }));
  assert.deepEqual([o.number, o.status, o.totals.total, o.shipments[0].status, o.history.length], ["ORD-20011", "paid", 17.95, "pending", 1]);
  assert.equal(world.state.stock["SOCK-M"].on_hand, 38);
  assert.match(world.state.audit.at(-1).changes.join("|"), /stock SOCK-M 40 → 38/);
});

test("place_order: free delivery over the threshold, out_of_stock, bad method, postcode area", () => {
  const world = build();
  const s = world.session({ role: "customer", customer_id: "C-1001" });
  const card = "4242 4242 4242 4242";
  assert.equal(ok(s.call("place_order", { items: [{ sku: "BLIP-128", qty: 1 }], delivery_method: "standard", card_number: card })).totals.delivery, 0);
  err(s.call("place_order", { items: [{ sku: "SOCK-OUT", qty: 1 }], delivery_method: "standard", card_number: card }), "out_of_stock");
  err(s.call("place_order", { items: [{ sku: "SAND-1", qty: 1 }], delivery_method: "standard", card_number: card }), "rule_violation");
  const e = err(s.call("place_order", { items: [{ sku: "SOCK-M", qty: 1 }], delivery_method: "standard", address: addr("BT1 1AA"), card_number: card }), "rule_violation");
  assert.match(e.message, /Northern Ireland/);
  assert.equal(world.state.stock["SOCK-M"].on_hand, 40);
});

test("place_order: declined card saves payment_failed and takes no stock", () => {
  const world = build();
  const s = world.session({ role: "customer", customer_id: "C-1001" });
  const e = err(s.call("place_order", { items: [{ sku: "SOCK-M", qty: 1 }], delivery_method: "standard", card_number: "4000 0000 0000 0002" }), "rule_violation");
  assert.match(e.message, /declined/); // the table's message for 0002
  assert.equal(find(world, "orders", "number", e.order_number).status, "payment_failed");
  assert.equal(world.state.stock["SOCK-M"].on_hand, 40);
});

test("place_order: every test card gives the outcome and message in business.json", () => {
  const cards = business.payments.test_cards;
  assert.ok(cards.length >= 11);
  assert.ok(cards.every((c) => c.number && c.brand && c.label && ["paid", "declined", "needs_check"].includes(c.result) && c.message));
  for (const c of cards) {
    const world = build();
    const s = world.session({ role: "customer", customer_id: "C-1001" });
    const r = s.call("place_order", { items: [{ sku: "SOCK-M", qty: 1 }], delivery_method: "standard", card_number: c.number.replace(/\s/g, "") }); // no spaces also works
    const last4 = c.number.replace(/\D/g, "").slice(-4);
    if (c.result === "paid") {
      const o = ok(r);
      assert.deepEqual([o.status, o.payment.brand, o.payment.last4], ["paid", c.brand, last4]);
    } else {
      const e = err(r, "rule_violation");
      assert.ok(e.message.startsWith(c.message), c.label);
      const o = find(world, "orders", "number", e.order_number);
      assert.deepEqual([o.status, o.payment.status, o.payment.brand, o.payment.last4], ["payment_failed", "declined", c.brand, last4]);
      assert.equal(world.state.stock["SOCK-M"].on_hand, 40);
    }
  }
  const world = build();
  err(world.session({ role: "customer", customer_id: "C-1001" }).call("place_order", { items: [{ sku: "SOCK-M", qty: 1 }], delivery_method: "standard", card_number: "1111 1111 1111 1111" }), "invalid_input");
});

test("place_order: chilled item ships as its own parcel and the order pays the chilled charge only", () => {
  const world = build();
  const s = world.session({ role: "customer", customer_id: "C-1001" });
  const o = ok(s.call("place_order", { items: [{ sku: "SAND-1", qty: 1 }, { sku: "SOCK-M", qty: 1 }], delivery_method: "chilled", card_number: "4242 4242 4242 4242" }));
  assert.equal(o.shipments.length, 2);
  assert.equal(o.totals.delivery, 8.95);
  assert.deepEqual(o.shipments.map((x) => x.skus), [["SAND-1"], ["SOCK-M"]]);
});

test("place_order: preorder items are allowed without stock", () => {
  const world = build();
  const s = world.session({ role: "customer", customer_id: "C-1001" });
  const o = ok(s.call("place_order", { items: [{ sku: "WOB-1", qty: 1 }], delivery_method: "standard", card_number: "4242 4242 4242 4242" }));
  assert.equal(o.status, "paid");
  assert.equal(o.payment.gift_card, undefined);
});

// ------------------------------------------------------------ ways to pay

const cust = (w) => w.session({ role: "customer", customer_id: "C-1001" });
const WOB = [{ sku: "WOB-1", qty: 1 }]; // a £20 pre-order: no stock needed, so many orders in a row work

test("payment_methods: open to everyone, cards first, every outcome listed, and why a method can't be used", () => {
  const w = build();
  const all = ok(w.session({ role: "assistant" }).call("payment_methods", {})).methods;
  assert.deepEqual(all.map((m) => [m.id, m.kind]), [["card", "card"], ["tap", "wallet"], ["paypost", "account"], ["later", "pay_later"]]);
  assert.ok(all.every((m) => m.name && m.explain && m.available && m.outcomes.length));
  assert.equal(all[0].outcomes.length, business.payments.test_cards.length);
  assert.ok(business.payments.methods.slice(1).every((m) => m.outcomes.every((o) => o.id && o.label && ["paid", "declined"].includes(o.result) && o.message && o.weight > 0)));
  const later = (input) => ok(w.session({ role: "assistant" }).call("payment_methods", input)).methods.find((m) => m.id === "later");
  assert.match(later({ basket_total: 7, skus: ["SOCK-M"] }).why_not, /£10 or more/);
  assert.match(later({ basket_total: 258, skus: ["BLIP-128"] }).why_not, /up to £250/);
  assert.match(later({ basket_total: 12, skus: ["SAND-1"] }).why_not, /fresh food that travels Cold/);
  assert.equal(later({ basket_total: 13, skus: ["SAND-1", "SOCK-M"] }).available, true); // not only Cold food
  assert.equal(later({ basket_total: 7, skus: ["SOCK-M"] }).due_in_days, 30);
  err(w.session({ role: "assistant" }).call("payment_methods", { skus: ["NOPE"] }), "not_found");
});

test("place_order: every outcome of every non-card method gives its result and message, by name", () => {
  for (const m of business.payments.methods.filter((x) => !x.outcomes_from)) {
    for (const out of m.outcomes) {
      const w = build();
      const r = cust(w).call("place_order", { items: [{ sku: "SOCK-M", qty: 2 }], delivery_method: "standard", payment: { method: m.id, outcome: out.id } });
      if (out.result === "paid") {
        const o = ok(r);
        assert.deepEqual([o.status, o.payment.method, o.payment.method_id, o.payment.method_name, o.payment.outcome], ["paid", m.name, m.id, m.name, out.id]);
        assert.equal(w.state.stock["SOCK-M"].on_hand, 38);
      } else {
        const e = err(r, "rule_violation");
        assert.ok(e.message.startsWith(out.message), `${m.id} ${out.id}`);
        const o = find(w, "orders", "number", e.order_number);
        assert.deepEqual([o.status, o.payment.status, o.payment.method_id, o.payment.outcome], ["payment_failed", "declined", m.id, out.id]);
        assert.equal(w.state.stock["SOCK-M"].on_hand, 40);
      }
    }
  }
});

test("place_order: old card_number still works, payment.card works, bad method or outcome is refused without using a number", () => {
  const w = build();
  const s = cust(w);
  const p = ok(s.call("place_order", { items: WOB, delivery_method: "standard", card_number: "4242424242424242" })).payment;
  assert.deepEqual([p.method_id, p.brand, p.last4], ["card", "Visa", "4242"]);
  assert.equal(ok(s.call("place_order", { items: WOB, delivery_method: "standard", payment: { method: "card", card_number: "5555 5555 5555 4444" } })).payment.brand, "Mastercard");
  err(s.call("place_order", { items: WOB, delivery_method: "standard", payment: { method: "cheque" } }), "invalid_input");
  err(s.call("place_order", { items: WOB, delivery_method: "standard", payment: { method: "tap", outcome: "maybe" } }), "invalid_input");
  err(s.call("place_order", { items: WOB, delivery_method: "standard" }), "invalid_input"); // no way to pay at all
  assert.equal(ok(s.call("place_order", { items: WOB, delivery_method: "standard", payment: { method: "tap", outcome: "paid" } })).number, "ORD-20013");
});

test("place_order: with no outcome named, outcomes follow the weights and are the same every run", () => {
  const run = () => {
    const w = build();
    const s = cust(w);
    const tally = {};
    for (let k = 0; k < 100; k++) {
      const r = s.call("place_order", { items: WOB, delivery_method: "standard", payment: { method: "tap" } });
      const id = r.ok ? r.data.payment.outcome : find(w, "orders", "number", r.error.order_number).payment.outcome;
      tally[id] = (tally[id] || 0) + 1;
    }
    return tally;
  };
  const tally = run();
  assert.deepEqual(tally, Object.fromEntries(business.payments.methods.find((m) => m.id === "tap").outcomes.map((o) => [o.id, o.weight])));
  assert.deepEqual(run(), tally);
});

test("pay later: approved orders go ahead with money due in 30 days; limits refuse with a plain reason and save nothing", () => {
  const w = build();
  const s = cust(w);
  const o = ok(s.call("place_order", { items: [{ sku: "SOCK-M", qty: 2 }], delivery_method: "standard", payment: { method: "later", outcome: "approved" } }));
  assert.deepEqual([o.status, o.payment.status, o.payment.due, o.payment.due_date, o.payment.method], ["paid", "due", 17.95, "2026-12-23", "Later"]);
  assert.match(o.history.at(-1).event, /£17.95 due on 2026-12-23/);
  const n = w.state.orders.length;
  assert.match(err(s.call("place_order", { items: [{ sku: "SOCK-M", qty: 1 }], delivery_method: "standard", payment: { method: "later" } }), "rule_violation").message, /£10 or more/);
  assert.match(err(s.call("place_order", { items: [{ sku: "SAND-1", qty: 2 }], delivery_method: "chilled", payment: { method: "later" } }), "rule_violation").message, /fresh food that travels Cold/);
  assert.match(err(s.call("place_order", { items: [{ sku: "BLIP-128", qty: 2 }], delivery_method: "standard", payment: { method: "later" } }), "rule_violation").message, /up to £250/);
  assert.equal(w.state.orders.length, n);
  ok(s.call("place_order", { items: [{ sku: "SAND-1", qty: 1 }, { sku: "SOCK-M", qty: 1 }], delivery_method: "chilled", payment: { method: "later", outcome: "approved" } }));
  const no = err(s.call("place_order", { items: WOB, delivery_method: "standard", payment: { method: "later", outcome: "said_no" } }), "rule_violation");
  assert.match(no.message, /said no this time/);
  assert.equal(find(w, "orders", "number", no.order_number).payment.due, undefined); // nothing is owed on a refused check
});

test("settle_pay_later: finance marks it paid; refunds before that take money off what is owed instead", () => {
  const w = build();
  const s = cust(w);
  const place = () => ok(s.call("place_order", { items: [{ sku: "SOCK-M", qty: 2 }], delivery_method: "standard", payment: { method: "later", outcome: "approved" } })).number;
  const fin = w.session({ role: "finance" });
  // Part refund before it is paid: the amount due goes down, nothing is sent back.
  const a = place();
  const r = ok(w.session({ role: "support_agent" }).call("issue_refund", { order_number: a, amount: 7, reason: "sock missing" }));
  assert.deepEqual([r.refunded, r.due_cancelled, r.still_due], [0, 7, 10.95]);
  assert.deepEqual([find(w, "orders", "number", a).payment.status, find(w, "orders", "number", a).payment.due], ["due", 10.95]);
  err(cust(w).call("settle_pay_later", { order_number: a }), "forbidden");
  err(w.session({ role: "assistant" }).call("settle_pay_later", { order_number: a }), "forbidden");
  const settled = ok(fin.call("settle_pay_later", { order_number: a }));
  assert.deepEqual([settled.paid, settled.payment_status], [10.95, "paid"]);
  err(fin.call("settle_pay_later", { order_number: a }), "rule_violation"); // already settled
  // After it is paid, a refund is real money back again.
  const after = ok(w.session({ role: "support_agent" }).call("issue_refund", { order_number: a, amount: 3, reason: "goodwill" }));
  assert.deepEqual([after.refunded, typeof after.refund_expected_by], [3, "string"]);
  // Cancelling before it is paid: nothing is owed, nothing to settle.
  const b = place();
  const c = ok(s.call("cancel_order", { order_number: b, reason: "changed my mind" }));
  assert.deepEqual([c.refund_amount, c.due_cancelled, find(w, "orders", "number", b).payment.status], [0, 17.95, "nothing_due"]);
  assert.match(err(fin.call("settle_pay_later", { order_number: b }), "rule_violation").message, /Nothing is owed/);
  // A card order is not pay later.
  const card = ok(s.call("place_order", { items: WOB, delivery_method: "standard", card_number: "4242 4242 4242 4242" })).number;
  assert.match(err(fin.call("settle_pay_later", { order_number: card }), "rule_violation").message, /not paid with pay later/);
});

test("quoteBasket and delivery_options share one calculation", () => {
  const world = build();
  const q = quoteBasket(world, { items: [{ sku: "SOCK-M", qty: 2 }], delivery_method: "standard", postcode: "BF2 4LT" });
  assert.deepEqual([q.items_total, q.delivery_charge, q.total], [14, 3.95, 17.95]);
  assert.deepEqual(q.methods.map((m) => m.id), ["standard", "next-day"]);
  const d = ok(world.session({ role: "assistant" }).call("delivery_options", { skus: ["SOCK-M", "SOCK-M"], postcode: "BF2 4LT" }));
  assert.deepEqual(d.methods, q.methods);
  assert.equal(quoteBasket(world, { items: [{ sku: "SOCK-M", qty: 2 }], delivery_method: "chilled", postcode: "BF2 4LT" }).total, null);
});

test("delivery dates use working days and the cutoffs", () => {
  const world = build();
  const m = (now, skus) => { world.setNow(now); return Object.fromEntries(ok(world.session({ role: "assistant" }).call("delivery_options", { skus, postcode: "BF2 4LT" })).methods.map((x) => [x.id, x])); };
  const mon = m("2026-11-23T10:00:00Z", ["SOCK-M"]);
  assert.deepEqual([mon.standard.earliest_date, mon.standard.latest_date, mon["next-day"].earliest_date], ["2026-11-25", "2026-11-26", "2026-11-24"]);
  assert.equal(m("2026-11-23T15:00:00Z", ["SOCK-M"])["next-day"].earliest_date, "2026-11-25"); // after the 2pm cutoff
  assert.equal(m("2026-11-27T10:00:00Z", ["SOCK-M"]).standard.earliest_date, "2026-12-01"); // Friday + 2 working days
  assert.equal(m("2026-11-27T10:00:00Z", ["SAND-1"]).chilled.earliest_date, "2026-12-01"); // chilled dispatches Monday
});

test("unreachable postcode leaves no delivery method", () => {
  const d = ok(build().session({ role: "assistant" }).call("delivery_options", { skus: ["SOCK-M"], postcode: "IV1 1AA" }));
  assert.deepEqual(d.methods, []);
});

// ------------------------------------------------------------ catalogue and knowledge

test("compatibility says no, yes-from-either-side and unknown", () => {
  const s = build().session({ role: "assistant" });
  assert.equal(ok(s.call("check_compatibility", { a: "SOCK-M", b: "blip" })).result, "no");
  assert.equal(ok(s.call("check_compatibility", { a: "BLIP-128", b: "spare-sock" })).result, "no"); // found from the other side
  assert.equal(ok(s.call("check_compatibility", { a: "blip", b: "wobble-kit" })).result, "unknown");
});

test("get_product shows live stock and search_knowledge finds passages", () => {
  const world = build();
  const s = world.session({ role: "assistant" });
  world.session({ role: "warehouse" }).call("adjust_stock", { sku: "SOCK-M", on_hand: 3 });
  assert.equal(ok(s.call("get_product", { id: "spare-sock" })).variants[0].stock, 3);
  assert.match(ok(s.call("search_knowledge", { query: "postage" })).results[0].passages[0], /Postage/);
});

// ------------------------------------------------------------ staff rules

test("refund and goodwill limits per role", () => {
  const world = build();
  const agent = world.session({ role: "support_agent" });
  err(agent.call("issue_refund", { order_number: "ORD-20005", amount: 101, reason: "x" }), "rule_violation");
  assert.equal(ok(agent.call("issue_refund", { order_number: "ORD-20005", amount: 100, reason: "x" })).refunded, 100);
  err(agent.call("add_goodwill_credit", { customer_id: "C-1001", amount: 16, reason: "x" }), "rule_violation");
  ok(world.session({ role: "support_lead" }).call("add_goodwill_credit", { customer_id: "C-1001", amount: 40, reason: "x" }));
  assert.equal(find(world, "customers", "id", "C-1001").credit_balance, 40);
});

// ------------------------------------------------------------ dates, determinism, state

test("dates shift by whole days when now differs from the anchor", () => {
  const world = build("2026-11-30T10:00:00Z");
  assert.equal(find(world, "orders", "number", "ORD-20003").shipments[0].delivered_at, "2026-11-20T12:00:00Z");
  assert.equal(world.state.stock["SOCK-OUT"].restock_date, "2026-12-08");
  assert.equal(world.products[0].variants[2].restock_date, "2026-12-08");
  assert.equal(find(world, "orders", "number", "ORD-20003").shipments[0].tracking, "T1");
  const { s } = verified(world); // rules still work relative to the shifted clock
  assert.equal(ok(s.call("check_return_eligibility", { order_number: "ORD-20003", sku: "SOCK-M" })).eligible, true);
});

test("same calls give identical state", () => {
  const run = () => {
    const { world, s } = verified();
    s.call("cancel_order", { order_number: "ORD-20001", reason: "x" });
    s.call("create_return", { order_number: "ORD-20003", items: [{ sku: "SOCK-M" }], reason: "faulty" });
    s.call("create_booking", { ...Q, start: "2026-12-01T09:00:00Z" });
    s.call("get_order", { order_number: "ORD-20009" });
    return JSON.stringify(world.state);
  };
  assert.equal(run(), run());
});

test("state is plain JSON and loadState restores it", () => {
  const { world, s } = verified();
  s.call("cancel_order", { order_number: "ORD-20001", reason: "x" });
  const saved = JSON.stringify(world.state);
  assert.equal(JSON.stringify(JSON.parse(saved)), saved);
  const fresh = build();
  loadState(fresh, saved);
  assert.equal(find(fresh, "orders", "number", "ORD-20001").status, "cancelled");
  const s2 = fresh.session({ role: "customer", customer_id: "C-1001" });
  assert.equal(ok(s2.call("create_booking", { ...Q, start: "2026-12-08T09:00:00Z" })).number, "BKG-7054");
});

test("audit records every call, including failures, with changes on success", () => {
  const { world, s } = verified();
  s.call("get_order", { order_number: "ORD-99999" });
  s.call("cancel_order", { order_number: "ORD-20001", reason: "x" });
  const [verify, bad, good] = world.state.audit;
  assert.equal(verify.tool, "verify_customer");
  assert.deepEqual([bad.ok, bad.error_code, bad.changes], [false, "not_found", []]);
  assert.deepEqual([good.ok, good.customer_id], [true, "C-1001"]);
  assert.ok(good.changes.length >= 3);
});

// ------------------------------------------------------------ back office on the generated demo world

import { loadData } from "./load.js";
const DATA = new URL("../../business/data", import.meta.url).pathname;
const demoData = loadData(DATA, { world: "demo", bench: true }); // the story world: these tests use story records
const demo = () => createWorld({ ...demoData, now: NOW });
const as = (w, role) => w.session({ role });
const BACK_OFFICE_TOOLS = ["get_company", "list_suppliers", "get_supplier", "list_purchase_orders", "get_purchase_order", "stock_history", "get_monthly_summary",
  "ledger_search", "add_ledger_correction", "list_campaigns", "web_sessions", "list_contacts", "search_documents", "get_document", "create_purchase_order",
  "approve_purchase_order", "receive_purchase_order", "record_stock_count", "advance_day", "approve_large_refund"];

test("loadData: no option reads business/data/seed; world option reads the generated world with its own stock", () => {
  const plain = loadData(DATA);
  assert.equal(plain.seed.suppliers, undefined);
  const w = demo();
  assert.ok(w.state.suppliers.length > 5 && w.state.ledger.length > 100 && w.state.company.name);
  assert.deepEqual(w.state.stock["OT-BLIP"], { on_hand: 0, restock_date: "2026-11-30" });
});

test("customer and customer-facing assistant get forbidden on every back-office tool", () => {
  const w = demo();
  for (const role of ["customer", "assistant"]) {
    const s = w.session({ role, customer_id: role === "customer" ? "C-1001" : null });
    for (const t of BACK_OFFICE_TOOLS) err(s.call(t, {}), "forbidden");
  }
});

test("roles: each back-office role reaches its own tools and not the others", () => {
  const w = demo();
  ok(as(w, "buyer").call("list_suppliers", {}));
  err(as(w, "buyer").call("ledger_search", {}), "forbidden");
  ok(as(w, "finance").call("ledger_search", { type: "rent" }));
  ok(as(w, "finance").call("get_monthly_summary", { month: "2026-10" }));
  err(as(w, "finance").call("create_purchase_order", { supplier_id: "SUP-04", lines: [] }), "forbidden");
  ok(as(w, "marketing").call("list_campaigns", {}));
  ok(as(w, "marketing").call("web_sessions", { from: "2026-11-01" }));
  err(as(w, "marketing").call("ledger_search", {}), "forbidden");
  err(as(w, "marketing").call("list_suppliers", {}), "forbidden");
  for (const t of ["ledger_search", "get_monthly_summary", "list_contacts", "list_campaigns"]) ok(as(w, "manager").call(t, {}));
  ok(as(w, "manager").call("get_customer", { customer_id: "C-1001" }));
  ok(as(w, "support_agent").call("list_contacts", { customer_id: "C-1022" }));
  assert.equal(ok(as(w, "warehouse").call("search_documents", { query: "price list" })).documents.length >= 2, true);
});

test("operations assistant reads stock, suppliers and purchase orders but never the ledger or customer details", () => {
  const w = demo();
  const s = as(w, "operations_assistant");
  ok(s.call("stock_history", { sku: "OT-BLIP" }));
  ok(s.call("get_supplier", { id: "SUP-05" }));
  assert.ok(ok(s.call("list_purchase_orders", { status: "late" })).total >= 1);
  for (const t of ["ledger_search", "get_monthly_summary", "add_ledger_correction", "list_contacts", "get_customer", "list_orders", "get_order", "approve_purchase_order", "receive_purchase_order", "advance_day"]) err(s.call(t, {}), "forbidden");
});

test("purchase orders: assistant drafts, buyer approves up to £2,000, manager above it", () => {
  const w = demo();
  const draft = ok(as(w, "operations_assistant").call("create_purchase_order", { supplier_id: "SUP-04", lines: [{ sku: "OT-PEN", qty: 50 }] }));
  assert.equal(draft.status, "draft");
  assert.equal(ok(as(w, "buyer").call("approve_purchase_order", { number: draft.number })).status, "ordered");
  const big = ok(as(w, "buyer").call("create_purchase_order", { supplier_id: "SUP-05", lines: [{ sku: "OT-BLIP", qty: 30 }] }));
  assert.equal(big.status, "awaiting_approval");
  assert.ok(big.total > 2000);
  err(as(w, "buyer").call("approve_purchase_order", { number: big.number }), "rule_violation");
  assert.equal(ok(as(w, "manager").call("approve_purchase_order", { number: big.number })).status, "ordered");
  err(as(w, "buyer").call("create_purchase_order", { supplier_id: "SUP-04", lines: [{ sku: "OT-BLIP", qty: 50 }] }), "rule_violation");
  err(as(w, "buyer").call("create_purchase_order", { supplier_id: "SUP-04", lines: [{ sku: "OT-PEN", qty: 1 }] }), "rule_violation");
});

test("receiving a purchase order and counting stock keep on hand equal to the sum of movements", () => {
  const w = demo();
  const po = w.state.purchase_orders.find((p) => p.status === "late" && p.lines[0].sku === "OT-BLIP");
  ok(as(w, "warehouse").call("receive_purchase_order", { number: po.number, lines: [{ sku: "OT-BLIP", qty_received: 15 }] }));
  assert.equal(po.status, "part_received");
  ok(as(w, "warehouse").call("record_stock_count", { sku: "OT-BLIP", counted_qty: 14, note: "One box crushed" }));
  const sum = w.state.stock_movements.filter((m) => m.sku === "OT-BLIP").reduce((n, m) => n + m.qty, 0);
  assert.equal(w.state.stock["OT-BLIP"].on_hand, 14);
  assert.equal(sum, 14);
  err(as(w, "warehouse").call("receive_purchase_order", { number: po.number }), "rule_violation");
});

test("advance_day: only the manager; parcels move, unpaid orders cancel, deliveries arrive or go late", () => {
  const w = demo();
  err(as(w, "buyer").call("advance_day", {}), "forbidden");
  const pen = ok(as(w, "buyer").call("create_purchase_order", { supplier_id: "SUP-04", lines: [{ sku: "OT-PEN", qty: 50 }] }));
  const blip = ok(as(w, "manager").call("create_purchase_order", { supplier_id: "SUP-05", lines: [{ sku: "OT-BLIP-CASE", qty: 20 }] }));
  const day1 = ok(as(w, "manager").call("advance_day", {}));
  assert.equal(day1.now, "2026-11-24T10:00:00Z");
  assert.ok(day1.cancelled.includes("ORD-20171")); // payment failed yesterday, held 24 hours
  assert.equal(find(w, "orders", "number", "ORD-20161").status, "delivered"); // eta was 24 Nov
  const trophyBefore = w.state.stock["OT-TROF"].on_hand;
  const waitingBlip = w.state.orders.filter((o) => o.shipments.some((s) => s.status === "pending" && s.note && s.skus.includes("OT-BLIP")));
  const lateBlip = w.state.purchase_orders.find((p) => p.status === "late" && p.lines[0].sku === "OT-BLIP");
  for (let d = 0; d < 21; d++) ok(as(w, "manager").call("advance_day", {}));
  assert.equal(find(w, "purchase_orders", "number", pen.number).status, "received");
  // Late or not is decided by the supplier's reliability, per purchase order; a late one has a new expected date.
  const b2 = find(w, "purchase_orders", "number", blip.number);
  assert.ok(b2.status === "received" || (b2.status === "late" && b2.expected_at > b2.due_at), JSON.stringify(b2));
  // The late Blip order arrived on its new date (30 Nov) and the paid orders waiting for it took their units and went out.
  assert.equal(w.state.stock["OT-BLIP"].on_hand, lateBlip.lines[0].qty - waitingBlip.reduce((n, o) => n + o.items.find((i) => i.sku === "OT-BLIP").qty, 0));
  for (const o of waitingBlip) assert.ok(["dispatched", "delivered"].includes(o.status), o.number);
  assert.ok(w.state.stock["OT-TROF"].on_hand > trophyBefore); // the Christmas trophies arrived 7 Dec
});

test("ledger corrections need finance or the manager and a reason; refunds over the lead's limit need the manager", () => {
  const w = demo();
  err(as(w, "finance").call("add_ledger_correction", { amount: -11.05, reference: "RET-3006", reason: "" }), "invalid_input");
  const e = ok(as(w, "finance").call("add_ledger_correction", { amount: 11.05, reference: "RET-3006", reason: "Refunded twice; reversing the duplicate" }));
  assert.equal(e.type, "correction");
  err(as(w, "marketing").call("add_ledger_correction", { amount: 1, reference: "x", reason: "because" }), "forbidden");
  const lead = err(as(w, "support_lead").call("issue_refund", { order_number: "ORD-20170", amount: 1001, reason: "x" }), "rule_violation");
  assert.match(lead.message, /manager/);
  ok(as(w, "manager").call("approve_large_refund", { order_number: "ORD-20170", amount: 5, reason: "goodwill" }));
});

// ------------------------------------------------------------ every action has recorded consequences (generated demo world)

const books = (w) => ok(as(w, "finance").call("check_books", {}));
const entries = (w, ref, type) => w.state.ledger.filter((e) => e.reference === ref && (!type || e.type === type));
const total = (list) => Math.round(list.reduce((n, e) => n + e.amount, 0) * 100) / 100;
const moves = (w, ref) => w.state.stock_movements.filter((m) => m.reference === ref);
/** A customer whose default address we deliver to, read from the data (names and postcodes change when the world is rebuilt). */
function shopper(w, k = 0) {
  const list = w.state.customers.filter((c) => ok(w.session({ role: "customer" }).call("delivery_options", { skus: ["OT-PEN"], postcode: c.addresses.find((a) => a.default).postcode })).reachable);
  return list[k % list.length].id;
}
/** Shelf SKUs (not food) with stock, cheapest first. */
const shelfSkus = (w) => Object.keys(w.state.stock).filter((k) => w.state.stock[k].on_hand >= 3 && !/SAND|ICE|JUNG|BISC/.test(k)).sort();
const CARD = { method: "card", card_number: "4242 4242 4242 4242" };
function buy(w, sku, cid = shopper(w), payment = CARD, qty = 1) {
  return w.session({ role: "customer", customer_id: cid }).call("place_order", { items: [{ sku, qty }], delivery_method: "standard", payment });
}
const days = (w, n) => { for (let k = 0; k < n; k++) ok(as(w, "manager").call("advance_day", {})); };

test("check_books: the generated world starts with no breaks and lists its planted findings", () => {
  const r = books(demo());
  assert.deepEqual(r.breaks, []);
  assert.ok(r.planted.some((p) => /refunded twice/.test(p)));
  assert.ok(r.planted.some((p) => /not adjusted/.test(p)));
  err(as(demo(), "support_lead").call("check_books", {}), "forbidden");
  err(build().session({ role: "finance" }).call("check_books", {}), "not_found"); // data/seed-style worlds keep no books
});

test("place_order records the sale, delivery income, card fee, stock movement and its cost, like the generator", () => {
  const w = demo();
  const sku = shelfSkus(w)[0], before = w.state.stock[sku].on_hand;
  const o = ok(buy(w, sku));
  assert.equal(total(entries(w, o.number, "sale")), o.totals.items);
  assert.equal(total(entries(w, o.number, "delivery_income")), o.totals.delivery);
  assert.equal(total(entries(w, o.number, "payment_fee")), -Math.round((o.totals.total * 0.015 + 0.2) * 100) / 100);
  assert.deepEqual(moves(w, o.number).map((m) => [m.sku, m.qty, m.reason]), [[sku, -1, "sold"]]);
  assert.match(moves(w, o.number)[0].id, /^MV-\d{6}$/);
  assert.match(entries(w, o.number)[0].id, /^LED-\d{6}$/);
  assert.ok(total(entries(w, o.number, "cost_of_goods")) < 0);
  assert.equal(w.state.stock[sku].on_hand, before - 1);
  assert.deepEqual(books(w).breaks, []);
});

test("a declined payment records nothing; cancelling reverses stock and refunds in full", () => {
  const w = demo();
  const sku = shelfSkus(w)[0], before = w.state.stock[sku].on_hand;
  const bad = buy(w, sku, shopper(w), { method: "card", card_number: "4000 0000 0000 0002" });
  assert.equal(bad.ok, false);
  assert.equal(entries(w, bad.error.order_number).length, 0);
  assert.equal(moves(w, bad.error.order_number).length, 0);
  ok(as(w, "support_agent").call("cancel_order", { order_number: bad.error.order_number, reason: "gave up" }));
  assert.equal(entries(w, bad.error.order_number).length, 0);
  const o = ok(buy(w, sku));
  ok(as(w, "support_agent").call("cancel_order", { order_number: o.number, reason: "changed mind" }));
  assert.equal(w.state.stock[sku].on_hand, before);
  assert.deepEqual(moves(w, o.number).map((m) => m.reason), ["sold", "released"]);
  assert.equal(total(entries(w, o.number, "refund")), -o.totals.total);
  assert.equal(total(entries(w, o.number, "cost_of_goods")), 0);
  assert.deepEqual(books(w).breaks, []);
});

test("returns: change of mind goes back on the shelf, faulty is scrapped, rejected pays nothing; refunds never exceed what was paid", () => {
  const w = demo();
  const [a, b] = shelfSkus(w).filter((k) => !/HELM/.test(k));
  const cid = shopper(w);
  const o = ok(w.session({ role: "customer", customer_id: cid }).call("place_order", { items: [{ sku: a, qty: 2 }, { sku: b, qty: 1 }], delivery_method: "standard", payment: CARD }));
  days(w, 10);
  assert.equal(find(w, "orders", "number", o.number).status, "delivered");
  assert.ok(total(entries(w, o.number, "delivery_cost")) < 0);
  const agent = as(w, "support_agent");
  const r1 = ok(agent.call("create_return", { order_number: o.number, items: [{ sku: a, qty: 1 }], reason: "change_of_mind" }));
  const r2 = ok(agent.call("create_return", { order_number: o.number, items: [{ sku: b, qty: 1 }], reason: "faulty" }));
  const r3 = ok(agent.call("create_return", { order_number: o.number, items: [{ sku: a, qty: 1 }], reason: "change_of_mind" }));
  const onA = w.state.stock[a].on_hand, onB = w.state.stock[b].on_hand;
  ok(as(w, "warehouse").call("receive_return", { return_number: r1.number, passed: true }));
  ok(as(w, "warehouse").call("receive_return", { return_number: r2.number, passed: true }));
  ok(as(w, "warehouse").call("receive_return", { return_number: r3.number, passed: false }));
  assert.equal(w.state.stock[a].on_hand, onA + 1);
  assert.equal(w.state.stock[b].on_hand, onB);
  assert.equal(total(entries(w, r1.number, "refund")), -r1.refund_amount);
  assert.equal(total(entries(w, r2.number, "refund")), -r2.refund_amount);
  assert.equal(entries(w, r3.number).length, 0);
  assert.equal(find(w, "returns", "number", r3.number).refund_amount, 0);
  // Money back through every path stops at what was paid.
  const lead = as(w, "support_lead");
  const left = Math.round((o.totals.total - find(w, "orders", "number", o.number).payment.refunded) * 100) / 100;
  err(lead.call("issue_refund", { order_number: o.number, amount: left + 1, reason: "too much" }), "rule_violation");
  ok(lead.call("issue_refund", { order_number: o.number, amount: left, reason: "everything else" }));
  const pb = lead.call("report_problem", { order_number: o.number, sku: a, problem: "damaged", resolution: "refund", has_photo: true });
  assert.equal(pb.ok ? pb.data.refund_amount : 0, 0);
  const paidBack = -(total(entries(w, o.number, "refund")) + total(entries(w, r1.number, "refund")) + total(entries(w, r2.number, "refund")));
  assert.equal(Math.round(paidBack * 100) / 100, o.totals.total);
  assert.deepEqual(books(w).breaks, []);
});

test("problems: a free replacement is a written-off unit with its cost, then a parcel with its carrier cost", () => {
  const w = demo();
  const sku = shelfSkus(w)[0];
  const o = ok(buy(w, sku));
  days(w, 8);
  const before = w.state.stock[sku].on_hand;
  const r = ok(as(w, "support_agent").call("report_problem", { order_number: o.number, sku, problem: "damaged", resolution: "replacement", has_photo: true }));
  assert.equal(w.state.stock[sku].on_hand, before - 1);
  assert.deepEqual(moves(w, o.number).map((m) => m.reason), ["sold", "written_off"]);
  const costs = entries(w, o.number, "delivery_cost").length;
  days(w, 3);
  assert.ok(find(w, "orders", "number", o.number).shipments.find((s) => s.id === r.replacement_shipment).dispatched_at);
  assert.equal(entries(w, o.number, "delivery_cost").length, costs + 1);
  assert.deepEqual(books(w).breaks, []);
});

test("goodwill credit is a cost against its case; refunds and goodwill show in the live monthly summary", () => {
  const w = demo();
  const month = w.state.now.slice(0, 7);
  const before = ok(as(w, "finance").call("get_monthly_summary", { month }));
  const c = w.state.cases.find((x) => x.customer_id);
  ok(as(w, "support_agent").call("add_goodwill_credit", { customer_id: c.customer_id, amount: 5, reason: "late parcel", case_number: c.number }));
  assert.equal(total(entries(w, c.number, "goodwill_credit")), -5);
  const o = ok(buy(w, shelfSkus(w)[0]));
  const after = ok(as(w, "finance").call("get_monthly_summary", { month }));
  assert.equal(after.operating_costs.goodwill_credit, Math.round((before.operating_costs.goodwill_credit + 5) * 100) / 100);
  assert.equal(after.revenue, Math.round((before.revenue + o.totals.total) * 100) / 100);
  assert.equal(after.orders, before.orders + 1);
  assert.deepEqual(books(w).breaks, []);
});

test("pay later: the sale counts now, cash comes in when settled; an amount taken off is a refund with no cash out", () => {
  const w = demo();
  const sku = shelfSkus(w).find((k) => w.state.stock[k].on_hand >= 3);
  const o = ok(buy(w, sku, shopper(w), { method: "later", outcome: "approved" }, 3));
  if (o.totals.items < 10) return; // too cheap for Later; nothing to test
  assert.equal(total(entries(w, o.number, "pay_later")), -o.totals.total);
  ok(as(w, "support_lead").call("issue_refund", { order_number: o.number, amount: 2, reason: "scuffed" }));
  assert.equal(total(entries(w, o.number, "pay_later")), -(o.totals.total - 2));
  ok(as(w, "finance").call("settle_pay_later", { order_number: o.number }));
  assert.equal(total(entries(w, o.number, "pay_later")), 0);
  assert.deepEqual(books(w).breaks, []);
});

test("pay later falls due on its date: settled, or deterministically overdue and flagged", () => {
  const run = () => {
    const w = demo();
    const sku = shelfSkus(w)[0];
    const placed = [];
    for (let k = 0; k < 6; k++) { const r = buy(w, sku, shopper(w, k), { method: "later", outcome: "approved" }, 2); if (r.ok) placed.push(r.data.number); }
    days(w, 31);
    return placed.map((n) => { const p = find(w, "orders", "number", n).payment; return [n, p.status, !!p.overdue]; });
  };
  const a = run();
  assert.deepEqual(a, run());
  for (const [, status, overdue] of a) assert.ok(status === "paid" || (status === "due" && overdue));
});

test("repairs: fee when received out of warranty, price and parts when repaired, fee back if unrepairable", () => {
  const w = demo();
  const tech = as(w, "technician");
  const fresh = (inWarranty) => { const r = w.state.repairs.find((x) => x.in_warranty === inWarranty && x.status === "requested" && !x.used); if (r) r.used = true; return r; };
  const out = fresh(false) || Object.assign(w.state.repairs[0], { status: "requested", in_warranty: false, quote: null });
  ok(tech.call("update_repair", { repair_number: out.number, status: "received" }));
  assert.equal(total(entries(w, out.number, "repair_income")), w.business.fix_club.assessment_fee);
  ok(tech.call("update_repair", { repair_number: out.number, status: "quote_sent", quote: { lines: [{ code: "X", name: "Fix", price: 40 }] } }));
  ok(tech.call("update_repair", { repair_number: out.number, status: "approved" }));
  ok(tech.call("update_repair", { repair_number: out.number, status: "repaired" }));
  ok(tech.call("update_repair", { repair_number: out.number, status: "returned" }));
  assert.equal(total(entries(w, out.number, "repair_income")), 40);
  assert.equal(total(entries(w, out.number, "repair_parts")), -16);
  const bad = w.state.repairs.find((x) => x !== out);
  Object.assign(bad, { status: "requested", in_warranty: false, charges: undefined });
  ok(tech.call("update_repair", { repair_number: bad.number, status: "received" }));
  ok(tech.call("update_repair", { repair_number: bad.number, status: "unrepairable" }));
  assert.equal(total(entries(w, bad.number)), 0);
  const month = ok(as(w, "finance").call("get_monthly_summary", { month: w.state.now.slice(0, 7) }));
  assert.ok(month.repair_income >= 40);
  assert.deepEqual(books(w).breaks, []);
});

test("purchase orders: received stock has no cost of goods; the supplier is paid on its terms; counts post their difference", () => {
  const w = demo();
  const po = ok(as(w, "buyer").call("create_purchase_order", { supplier_id: "SUP-04", lines: [{ sku: "OT-PEN", qty: 50 }] }));
  ok(as(w, "warehouse").call("receive_purchase_order", { number: po.number }));
  assert.equal(entries(w, po.number).length, 0);
  const terms = w.state.suppliers.find((s) => s.id === "SUP-04").payment_terms_days;
  days(w, terms - 1);
  assert.equal(entries(w, po.number, "supplier_payment").length, 0);
  days(w, 1);
  assert.equal(total(entries(w, po.number, "supplier_payment")), -po.total);
  assert.ok(find(w, "purchase_orders", "number", po.number).paid_at);
  const on = w.state.stock["OT-PEN"].on_hand;
  const count = ok(as(w, "warehouse").call("record_stock_count", { sku: "OT-PEN", counted_qty: on - 2 }));
  assert.equal(total(entries(w, count.id, "cost_of_goods")), -2 * w.state.suppliers.find((s) => s.id === "SUP-04").unit_cost["OT-PEN"]);
  ok(as(w, "warehouse").call("adjust_stock", { sku: "OT-PEN", on_hand: on }));
  assert.equal(w.state.stock_movements.at(-1).reason, "count_adjustment");
  assert.deepEqual(books(w).breaks, []);
});

test("advance_day: made-to-order food is made on its dispatch day; rent, software and wages are paid on their days", () => {
  const w = demo();
  const cid = shopper(w);
  const o = ok(w.session({ role: "customer", customer_id: cid }).call("place_order", { items: [{ sku: "OT-SAND-HAM-1", qty: 2 }], delivery_method: "chilled", payment: CARD }));
  assert.equal(moves(w, o.number).length, 0);
  days(w, 2);
  const m = moves(w, o.number);
  assert.deepEqual(m.map((x) => [x.reason, x.qty]), [["sold", -2]]);
  const mto = w.state.stock_movements.find((x) => x.reason === "received" && x.at === m[0].at && x.sku === "OT-SAND-HAM-1");
  assert.equal(find(w, "purchase_orders", "number", mto.reference).status, "received");
  days(w, 12); // to 7 December: rent on the 1st, software on the 3rd
  for (const t of ["RENT", "SOFTWARE"]) assert.equal(entries(w, `${t}-2026-12`).length, 1);
  assert.deepEqual(books(w).breaks, []);
});

test("product lifecycle: discontinue stops sales but keeps history, returns and waiting orders; launch and price changes", () => {
  const w = demo();
  const sku = shelfSkus(w)[0];
  const product = w.index.skus[sku].product.id;
  const o = ok(buy(w, sku));
  const mgr = as(w, "manager");
  err(as(w, "buyer").call("discontinue_product", { product_id: product, stock: "write_off" }), "forbidden");
  const d = ok(mgr.call("discontinue_product", { product_id: product, stock: "write_off", reason: "range review" }));
  assert.equal(w.state.stock[sku].on_hand, 0);
  assert.ok(d.written_off.length >= 1);
  assert.ok(total(entries(w, product, "cost_of_goods")) < 0);
  assert.equal(err(buy(w, sku), "rule_violation").message.includes("no longer sold"), true);
  assert.equal(ok(w.session({ role: "assistant" }).call("get_product", { id: product })).status, "discontinued");
  err(as(w, "buyer").call("create_purchase_order", { supplier_id: w.state.suppliers.find((s) => s.skus.includes(sku)).id, lines: [{ sku, qty: 100 }] }), "rule_violation");
  days(w, 8);
  ok(as(w, "support_agent").call("create_return", { order_number: o.number, items: [{ sku, qty: 1 }], reason: "faulty" }));
  ok(mgr.call("launch_product", { product_id: product, from: addDaysTo(w.state.now, 2) }));
  assert.equal(err(buy(w, sku), "rule_violation").message.includes("not on sale yet"), true);
  days(w, 2);
  ok(as(w, "warehouse").call("record_stock_count", { sku, counted_qty: 4 }));
  const price = ok(mgr.call("change_price", { sku, new_price: 99, reason: "test" }));
  const o2 = ok(buy(w, sku));
  assert.equal(o2.items[0].unit_price, 99);
  assert.notEqual(find(w, "orders", "number", o.number).items[0].unit_price, 99);
  assert.equal(w.state.price_history.at(-1).old_price, price.old_price);
  assert.deepEqual(books(w).breaks, []);
});
const addDaysTo = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);

test("dates shifted to another now still keep the books true", () => {
  const w = createWorld({ ...demoData, now: "2027-02-10T10:00:00Z" });
  assert.deepEqual(books(w).breaks, []);
  ok(buy(w, shelfSkus(w)[0]));
  assert.deepEqual(books(w).breaks, []);
});

// ------------------------------------------------------------ property test: long seeded runs of valid actions

/** mulberry32, seeded: the same seed gives the same run. */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: (l) => l[Math.floor(next() * l.length)] };
}

/** One random action across roles. Calls may be refused by the rules; that is fine, refusals must leave the books true too. */
function randomStep(w, r) {
  const st = w.state, pick = r.pick;
  const orders = (pred) => st.orders.filter(pred);
  const anyOrder = (pred) => { const l = orders(pred); return l.length ? pick(l) : null; };
  switch (r.int(0, 15)) {
    case 0: case 1: case 2: {
      const skus = Object.keys(st.stock).filter((k) => st.stock[k].on_hand > 0 && !/SAND|ICE|JUNG/.test(k));
      const items = [{ sku: pick(skus), qty: r.int(1, 2) }];
      if (r.next() < 0.3) items.push({ sku: pick(skus), qty: 1 });
      const pay = pick([CARD, CARD, CARD, { method: "card", card_number: "4000 0000 0000 0002" }, { method: "later" }, { method: "tap" }]);
      return w.session({ role: "customer", customer_id: pick(st.customers).id }).call("place_order", { items: items.filter((x, k) => items.findIndex((y) => y.sku === x.sku) === k), delivery_method: pick(["standard", "next-day"]), payment: pay });
    }
    case 3: { const o = anyOrder((x) => ["paid", "payment_failed"].includes(x.status)); return o && as(w, "support_agent").call("cancel_order", { order_number: o.number, reason: "random" }); }
    case 4: { const o = anyOrder((x) => x.status === "paid"); return o && as(w, "support_agent").call("update_order", { order_number: o.number, delivery_method: pick(["standard", "next-day"]) }); }
    case 5: {
      const o = anyOrder((x) => x.status === "delivered");
      if (!o) return;
      const res = as(w, "support_agent").call("create_return", { order_number: o.number, items: [{ sku: pick(o.items).sku, qty: 1 }], reason: pick(["change_of_mind", "faulty", "damaged", "wrong_item"]) });
      if (res.ok && r.next() < 0.8) as(w, "warehouse").call("receive_return", { return_number: res.data.number, passed: r.next() < 0.85 });
      return res;
    }
    // WHY: each refund tool goes to a role allowed to use it, so success does not hang on luck; refusals are case 14's job.
    case 6: { const o = anyOrder((x) => x.payment.status !== "declined"); const tool = pick(["issue_refund", "approve_large_refund"]); return o && as(w, tool === "issue_refund" ? pick(["support_agent", "support_lead"]) : "manager").call(tool, { order_number: o.number, amount: r.int(1, 60), reason: "random" }); }
    case 7: { const o = anyOrder((x) => x.status === "delivered"); return o && as(w, pick(["support_agent", "support_lead"])).call("report_problem", { order_number: o.number, sku: pick(o.items).sku, problem: pick(["damaged", "wrong", "missing"]), resolution: pick(["refund", "replacement"]), has_photo: true }); }
    case 8: { const c = pick(st.cases); return c.customer_id && as(w, "support_agent").call("add_goodwill_credit", { customer_id: c.customer_id, amount: r.int(1, 15), reason: "random", case_number: c.number }); }
    case 9: { const s = pick(st.suppliers); return as(w, pick(["buyer", "manager", "operations_assistant"])).call("create_purchase_order", { supplier_id: s.id, lines: [{ sku: pick(s.skus), qty: s.min_order_qty }] }); }
    case 10: {
      const po = st.purchase_orders.filter((p) => ["ordered", "late", "draft", "awaiting_approval"].includes(p.status)).at(-r.int(1, 3));
      if (!po) return;
      return ["draft", "awaiting_approval"].includes(po.status) ? as(w, "manager").call("approve_purchase_order", { number: po.number }) : as(w, "warehouse").call("receive_purchase_order", { number: po.number });
    }
    case 11: { const k = pick(Object.keys(st.stock)); return as(w, "warehouse").call(r.next() < 0.5 ? "record_stock_count" : "adjust_stock", r.next() < 0.5 ? { sku: k, counted_qty: Math.max(0, st.stock[k].on_hand + r.int(-2, 1)) } : { sku: k, on_hand: Math.max(0, st.stock[k].on_hand + r.int(-1, 2)) }); }
    case 12: { const o = anyOrder((x) => x.payment.status === "due"); return o && as(w, "finance").call("settle_pay_later", { order_number: o.number }); }
    case 13: { const f = pick(st.repairs); return as(w, "technician").call("update_repair", { repair_number: f.number, status: pick(["received", "quote_sent", "approved", "repaired", "returned", "unrepairable", "declined"]), quote: { lines: [{ code: "X", name: "Fix", price: r.int(10, 60) }] } }); }
    case 14: {
      const p = pick(w.products);
      const k = r.int(0, 9);
      if (k === 0) return as(w, "manager").call("discontinue_product", { product_id: p.id, stock: pick(["sell_through", "write_off"]) });
      if (k === 1) return as(w, "manager").call("launch_product", { product_id: p.id });
      if (k === 2) return as(w, "manager").call("change_price", { sku: pick(p.variants).sku, new_price: r.int(3, 90), reason: "random" });
      return as(w, "assistant").call("issue_refund", { order_number: st.orders[0].number, amount: 1, reason: "not allowed" });
    }
    default: return as(w, "manager").call("advance_day", {});
  }
}

/** Snapshot figures worked out independently, straight from the ledger, stock, suppliers and audit. */
function recompute(w) {
  const st = w.state, r2 = (x) => Math.round(x * 100) / 100;
  const sum = (types, list = st.ledger) => r2(list.filter((e) => types.includes(e.type)).reduce((n, e) => n + e.amount, 0));
  const revenue = sum(["sale", "delivery_income", "repair_income"]), refunds = -sum(["refund"]), cogs = -sum(["cost_of_goods", "repair_parts"]);
  const opex = -sum(["payment_fee", "delivery_cost", "wages", "rent", "software", "marketing_spend", "goodwill_credit"]);
  const cost = {};
  for (const s of st.suppliers) Object.assign(cost, s.unit_cost);
  return {
    revenue, refunds: r2(refunds), profit: r2(revenue - refunds - cogs - opex),
    cash: r2(st.company.opening_cash + st.ledger.filter((e) => !["cost_of_goods", "goodwill_credit"].includes(e.type)).reduce((n, e) => n + e.amount, 0)),
    stock_value: r2(Object.entries(st.stock).reduce((n, [k, v]) => n + Math.max(0, v.on_hand) * (cost[k] || 0), 0)),
    refused: st.audit.filter((a) => a.error_code === "forbidden").length,
  };
}

for (const seedNo of [1, 2, 3]) {
  test(`property: 600 seeded random actions (seed ${seedNo}) leave no new breaks, and the snapshot matches an independent recomputation`, () => {
    const w = demo();
    const start = books(w);
    const r = rng(seedNo);
    for (let k = 0; k < 600; k++) randomStep(w, r);
    const end = books(w);
    assert.deepEqual(end.breaks, [], end.breaks.join("\n"));
    assert.deepEqual(end.planted, start.planted);
    const snap = ok(as(w, "manager").call("business_snapshot", {}));
    const want = recompute(w);
    assert.equal(snap.since_start.revenue, want.revenue);
    assert.equal(snap.since_start.refunds, want.refunds);
    assert.ok(Math.abs(snap.since_start.profit - want.profit) < 0.05, `${snap.since_start.profit} vs ${want.profit}`);
    assert.equal(snap.cash, want.cash);
    assert.equal(snap.stock_value, want.stock_value);
    assert.equal(snap.refused_actions.total, want.refused);
    assert.equal(Math.round(Object.values(snap.refunds_by_reason).reduce((n, x) => n + x, 0) * 100) / 100, want.refunds);
    const used = new Set(w.state.audit.filter((a) => a.ok).map((a) => a.tool));
    for (const t of ["place_order", "cancel_order", "create_return", "receive_return", "issue_refund", "report_problem", "add_goodwill_credit", "create_purchase_order", "receive_purchase_order", "record_stock_count", "advance_day", "update_repair"]) assert.ok(used.has(t), `${t} never succeeded`);
  });
}

test("business_snapshot: managers and finance only; refused actions are counted", () => {
  const w = demo();
  err(as(w, "support_lead").call("business_snapshot", {}), "forbidden");
  err(w.session({ role: "assistant" }).call("issue_refund", { order_number: w.state.orders[0].number, amount: 1, reason: "x" }), "forbidden");
  const s = ok(as(w, "finance").call("business_snapshot", {}));
  assert.equal(s.refused_actions.total, 2);
  assert.equal(s.refused_actions.by_role.assistant, 1);
  assert.ok(s.cash !== undefined && s.stock_value > 0 && s.since_start.revenue > 0);
});

// ------------------------------------------------------------ prospects and outreach

test("list_prospects and get_prospect: sales roles only, and the simulator's private fields never show", () => {
  const w = demo();
  assert.ok(w.state.prospects.length >= 150);
  err(w.session({ role: "assistant" }).call("list_prospects", {}), "forbidden");
  err(as(w, "support_lead").call("list_prospects", {}), "forbidden");
  const r = ok(as(w, "marketing").call("list_prospects", { sector: "theatre" }));
  assert.ok(r.total >= 3 && r.prospects.every((p) => p.sector === "theatre" && p.private === undefined && p.needs.length));
  const one = ok(as(w, "manager").call("get_prospect", { prospect_id: r.prospects[0].id }));
  assert.equal(one.private, undefined);
  assert.deepEqual(one.outreach, []);
  err(as(w, "manager").call("get_prospect", { prospect_id: "PR-999" }), "not_found");
});

test("send_outreach: records the contact, and enforces the gap, the discount limit, declines and bad SKUs", () => {
  const w = demo();
  const m = as(w, "marketing");
  const id = w.state.prospects[0].id;
  err(w.session({ role: "operations_assistant" }).call("send_outreach", { prospect_id: id, channel: "email", message: "A long enough message here." }), "forbidden");
  err(m.call("send_outreach", { prospect_id: id, channel: "email", message: "short" }), "invalid_input");
  err(m.call("send_outreach", { prospect_id: id, channel: "carrier pigeon", message: "A long enough message here." }), "invalid_input");
  err(m.call("send_outreach", { prospect_id: id, channel: "email", message: "A long enough message here.", offer: { items: [{ sku: "OT-SAND-HAM-3", qty: 5 }], discount_percent: 15 } }), "rule_violation");
  err(m.call("send_outreach", { prospect_id: id, channel: "email", message: "A long enough message here.", offer: { items: [{ sku: "NOPE", qty: 5 }], discount_percent: 5 } }), "not_found");
  const rec = ok(m.call("send_outreach", { prospect_id: id, channel: "email", message: "Hello, we can supply your weekly sandwiches.", offer: { items: [{ sku: "OT-SAND-HAM-3", qty: 5 }], discount_percent: 8 } }));
  assert.equal(rec.by_role, "marketing");
  assert.equal(w.state.prospects[0].status, "contacted");
  assert.equal(w.state.outreach.length, 1);
  err(m.call("send_outreach", { prospect_id: id, channel: "letter", message: "Another message to the same firm." }), "rule_violation");
  ok(as(w, "manager").call("send_outreach", { prospect_id: w.state.prospects[1].id, channel: "phone", message: "Calling about trophies for your team.", offer: { items: [{ sku: "OT-TROF", qty: 10 }], discount_percent: 18 } }));
  // After a reply, or after the gap, they can be contacted again; after a no, never.
  w.state.prospects[0].status = "replied";
  ok(m.call("send_outreach", { prospect_id: id, channel: "email", message: "Thank you for replying, here is a quote." }));
  w.state.prospects[2].status = "declined";
  err(m.call("send_outreach", { prospect_id: w.state.prospects[2].id, channel: "email", message: "Please reconsider our offer." }), "rule_violation");
});

test("help desk: staff name the customer instead of verifying the session", () => {
  const w = demo();
  const st = w.state;
  const agent = w.session({ role: "support_agent" });
  const contact = st.contacts.find((c) => c.customer_id && !c.case_number);
  const opened = ok(agent.call("open_case", { customer_id: contact.customer_id, contact_id: contact.id, subject: "Asked about a parcel", category: "delivery", summary: "Logged from the help desk." }));
  assert.equal(opened.customer_id, contact.customer_id);
  assert.equal(contact.case_number, opened.number, "the contact now shows its case");
  err(agent.call("open_case", { subject: "x", category: "other", summary: "y" }), "invalid_input");
  const other = st.customers.find((c) => c.id !== contact.customer_id);
  err(agent.call("open_case", { customer_id: other.id, contact_id: contact.id, subject: "x", category: "other", summary: "y" }), "not_found");
  const up = ok(agent.call("escalate", { case_number: opened.number, to: "support_lead", reason: "Needs a decision", summary: "Over to the lead." }));
  assert.equal(up.status, "escalated");
  const recent = (x) => x.shipments.some((sh) => sh.delivered_at && Date.parse(NOW) - Date.parse(sh.delivered_at) < 20 * 864e5);
  const o = st.orders.find((x) => x.status === "delivered" && recent(x) && x.items.some((i) => !/^OT-(SAND|ICE|JUNG|BISC)/.test(i.sku)) && !st.returns.some((r) => r.order_number === x.number));
  const sku = o.items.find((i) => !/^OT-(SAND|ICE|JUNG|BISC)/.test(i.sku)).sku;
  err(agent.call("create_return", { order_number: o.number, customer_id: other.id, items: [{ sku }], reason: "faulty" }), "not_found");
  const ret = ok(agent.call("create_return", { order_number: o.number, customer_id: o.customer_id, items: [{ sku }], reason: "faulty" }));
  const listed = ok(agent.call("list_returns", { customer_id: o.customer_id }));
  assert.equal(listed.returns[0].number, ret.number);
  err(w.session({ role: "assistant" }).call("list_returns", {}), "forbidden");
});

test("get_conversation: staff read any conversation; a verified customer only their own", () => {
  const w = demo();
  const conv = w.state.conversations[0];
  assert.equal(ok(w.session({ role: "support_agent" }).call("get_conversation", { conversation_id: conv.id })).messages.length, conv.messages.length);
  const stranger = w.state.customers.find((c) => c.id !== conv.customer_id);
  err(w.session({ role: "customer", customer_id: stranger.id }).call("get_conversation", { conversation_id: conv.id }), "not_found");
});
