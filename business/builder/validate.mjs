// Checks a generated world against business.json, the product files and itself.
// Run: node business/builder/validate.mjs --size demo            (business/data/world/demo; or standard, large)
//      node business/builder/validate.mjs --size demo --bench    (business/data/world-bench/demo, the world with stories)
//      node business/builder/validate.mjs --dir <world folder>   (any folder)
// Exit code 0 means no errors. With stories, planted findings (deliberate mistakes) are listed separately;
// without stories there must be none.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FAKE_POSTCODE_AREAS } from "./world/customers.mjs";
import { SIM_DEMAND, expectedOrders, growth } from "./world/calendar.mjs";
import { activeEffects } from "../../infrastructure/engine/events-core.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const size = args.includes("--size") ? args[args.indexOf("--size") + 1] : "demo";
const DIR = args.includes("--dir") ? path.resolve(args[args.indexOf("--dir") + 1]) : path.join(ROOT, args.includes("--bench") ? "business/data/world-bench" : "business/data/world", size);
const ON_DISK = !args.includes("--dir");
const rd = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const W = (n) => JSON.parse(fs.readFileSync(path.join(DIR, n + ".json"), "utf8"));
const errs = [], planted = [];
const bad = (m) => errs.push(m);
const r2 = (x) => Math.round(x * 100) / 100;
const biz = rd("business/data/business.json");
const NOW = Date.parse(biz.sim.anchor_now);

// ---------------------------------------------------------------- catalogue
const sku = {}, products = {};
for (const f of fs.readdirSync(path.join(ROOT, "business/data/products"))) {
  const p = rd("business/data/products/" + f);
  products[p.id] = p;
  for (const v of [...(p.variants || []), ...(p.accessories || [])]) sku[v.sku] = { price: v.price, product: p.id, chilled: ["emergency-sandwich", "ice-by-post"].includes(p.id), plant: p.id === "pocket-jungle" && p.variants.includes(v), months: p.warranty?.months ?? 12 };
}
const MTO = ["emergency-sandwich", "ice-by-post"];

const w = {};
for (const n of ["company", "customers", "orders", "returns", "registrations", "repairs", "bookings", "cases", "conversations", "suppliers", "purchase_orders", "stock_movements", "stock_counts", "stock", "ledger", "monthly_summary", "campaigns", "web_sessions_daily", "contacts", "documents", "price_history", "reviews"]) w[n] = W(n);
// Newer collections: world events, news, mail, chat and social. Older worlds may not have them.
for (const n of ["world_events", "news", "emails", "chat_messages", "social_posts", "social_stats_daily"]) w[n] = fs.existsSync(path.join(DIR, n + ".json")) ? W(n) : [];
const STORIES = w.company.stories !== false;
const priceAt = (s, at) => { const ch = w.price_history.find((h) => h.sku === s); return ch && at < ch.date ? ch.old_price : sku[s]?.price; };

// ---------------------------------------------------------------- helpers
const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, dateRe = /^\d{4}-\d{2}-\d{2}$/;
const isoOk = (s) => typeof s === "string" && isoRe.test(s) && !isNaN(Date.parse(s));
const dateOk = (s) => typeof s === "string" && dateRe.test(s) && !isNaN(Date.parse(s));
const ids = (name, arr, key, fmt) => {
  const seen = new Set();
  for (const r of arr) { const v = r[key]; if (!fmt.test(v)) bad(`${name}: bad id format ${v}`); if (seen.has(v)) bad(`${name}: duplicate ${v}`); seen.add(v); }
  return seen;
};
const inSet = (name, v, set, what) => { if (!set.includes(v)) bad(`${name}: ${what} "${v}" not in [${set.join(", ")}]`); };
const checkDates = (name, o, keys) => { for (const k of keys) if (o[k] != null && !isoOk(o[k])) bad(`${name}: ${k} not ISO: ${o[k]}`); };
const future = (name, s) => { if (s && Date.parse(s) > NOW) bad(`${name}: date in the future ${s}`); };

// ---------------------------------------------------------------- customers and personal data
const cIds = ids("customer", w.customers, "id", /^C-\d{4,5}$/);
// Invented areas for the characters' places (see business/builder/world/characters.mjs), plus the old MH, QQ and ZZ used for venues.
const POSTAREAS = [...FAKE_POSTCODE_AREAS, "MH", "ZZ", "QQ"];
const emails = new Set();
for (const c of w.customers) {
  if (!/^[a-z0-9.]+@example\.com$/.test(c.email)) bad(`${c.id}: email not @example.com`);
  if (emails.has(c.email)) bad(`${c.id}: duplicate email`); emails.add(c.email);
  if (!/^07700 900\d{3}$/.test(c.phone)) bad(`${c.id}: phone format ${c.phone}`);
  inSet(c.id, c.contact_preference, ["email", "sms", "phone"], "contact_preference");
  if (!c.addresses?.length || c.addresses.filter((a) => a.default).length !== 1) bad(`${c.id}: needs exactly one default address`);
  for (const a of c.addresses) if (!POSTAREAS.includes(a.postcode.match(/^[A-Z]+/)?.[0])) bad(`${c.id}: postcode area ${a.postcode}`);
  checkDates(c.id, c, ["created_at"]);
  if (typeof c.credit_balance !== "number") bad(`${c.id}: credit_balance`);
}
// No real-looking personal data anywhere in the world: any email must be @example.com, any UK mobile must be 07700 900xxx.
const allText = fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => fs.readFileSync(path.join(DIR, f), "utf8")).join("\n");
// WHY: ".example" is a reserved domain (RFC 2606), so staff and supplier addresses such as hello@overthought.example are safe.
for (const m of new Set(allText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) || [])) if (!m.endsWith("@example.com") && !m.endsWith(".example")) bad(`real-looking email: ${m}`);
for (const m of allText.match(/\b07\d{3} ?\d{6}\b/g) || []) if (!/^07700 ?900\d{3}$/.test(m)) bad(`real-looking phone: ${m}`);

// ---------------------------------------------------------------- orders
const oIds = ids("order", w.orders, "number", /^ORD-\d{5}$/);
const oBy = Object.fromEntries(w.orders.map((o) => [o.number, o]));
const shipIds = new Set();
for (const o of w.orders) {
  const n = o.number;
  if (!cIds.has(o.customer_id)) bad(`${n}: unknown customer ${o.customer_id}`);
  inSet(n, o.status, biz.orders.statuses, "status");
  inSet(n, o.payment.status, biz.payments.statuses, "payment status");
  inSet(n, o.delivery.method, biz.delivery.methods.map((m) => m.id), "delivery method");
  checkDates(n, o, ["placed_at"]); future(n, o.placed_at);
  for (const h of o.history) { if (!isoOk(h.at)) bad(`${n}: history date ${h.at}`); future(n + " history", h.at); }
  let sub = 0;
  for (const i of o.items) {
    const c = sku[i.sku]; if (!c) { bad(`${n}: unknown SKU ${i.sku}`); continue; }
    if (priceAt(i.sku, o.placed_at.slice(0, 10)) !== i.unit_price) bad(`${n}: ${i.sku} price ${i.unit_price} is not the price on ${o.placed_at.slice(0, 10)}`);
    sub += i.qty * i.unit_price;
    if (c.chilled && o.delivery.method !== "chilled") bad(`${n}: chilled item needs chilled delivery`);
    if (c.plant && o.delivery.method !== "next-day") bad(`${n}: plant needs next-day delivery`);
  }
  sub = r2(sub);
  const m = biz.delivery.methods.find((x) => x.id === o.delivery.method);
  const dl = m.free_over != null && sub > m.free_over ? 0 : m.price;
  const t = o.totals;
  if (t.items !== sub) bad(`${n}: items total ${t.items} != ${sub}`);
  if (t.delivery !== dl) bad(`${n}: delivery ${t.delivery} != ${dl}`);
  if (t.total !== r2(t.items + t.delivery - t.discount)) bad(`${n}: total ${t.total} != items+delivery-discount`);
  if (o.discount_code && !w.campaigns.some((c) => c.code === o.discount_code)) bad(`${n}: unknown discount code`);
  if (o.payment.refunded > t.total + 0.001) bad(`${n}: refunded more than total`);
  if (o.status === "cancelled" && !["refunded", "declined", "nothing_due"].includes(o.payment.status)) bad(`${n}: cancelled but payment neither refunded nor declined`);
  if (o.status === "payment_failed" && o.payment.status !== "declined") bad(`${n}: payment_failed needs declined payment`);
  const orderSkus = new Set(o.items.map((i) => i.sku));
  for (const s of o.shipments) {
    if (!s.id.startsWith("SHP-" + n.slice(4) + "-")) bad(`${n}: shipment id ${s.id}`);
    if (shipIds.has(s.id)) bad(`${n}: duplicate shipment ${s.id}`); shipIds.add(s.id);
    inSet(s.id, s.status, ["pending", "packed", "in_transit", "delivered", "delayed", "lost"], "status");
    for (const k of s.skus) if (!orderSkus.has(k)) bad(`${s.id}: sku ${k} not on order`);
    checkDates(s.id, s, ["dispatched_at", "delivered_at"]); future(s.id, s.delivered_at); future(s.id, s.dispatched_at);
    if (s.eta && !dateOk(s.eta)) bad(`${s.id}: eta ${s.eta}`);
    if (s.status === "delivered" && !s.delivered_at) bad(`${s.id}: delivered without delivered_at`);
    if (["in_transit", "delayed", "lost"].includes(s.status) && !s.dispatched_at) bad(`${s.id}: no dispatched_at`);
    const c = s.skus.filter((k) => sku[k]?.chilled).length; if (c && c !== s.skus.length) bad(`${s.id}: chilled mixed with non-chilled`);
  }
  const live = o.shipments.filter((s) => s.status !== "lost");
  if (o.status === "delivered" && live.some((s) => s.status !== "delivered")) bad(`${n}: delivered but a shipment is not`);
  if (["packed", "dispatched", "delivered"].includes(o.status) && !o.shipments.length) bad(`${n}: ${o.status} with no shipments`);
  if (["dispatched", "delivered", "part_dispatched"].includes(o.status)) {
    const shipped = new Set(o.shipments.flatMap((s) => s.skus));
    for (const i of o.items) if (!shipped.has(i.sku) && !o.shipments.some((s) => s.note?.includes(i.sku))) bad(`${n}: ${i.sku} in no shipment and no note`);
  }
}
if (w.bookings.length) bad("bookings must be empty while services are hidden");

// ---------------------------------------------------------------- returns, registrations, repairs
const retBy = Object.fromEntries(w.returns.map((r) => [r.number, r]));
ids("return", w.returns, "number", /^RET-\d{4,5}$/);
for (const r of w.returns) {
  const o = oBy[r.order_number]; const n = r.number;
  if (!o) { bad(`${n}: unknown order ${r.order_number}`); continue; }
  if (o.customer_id !== r.customer_id) bad(`${n}: customer differs from order`);
  inSet(n, r.reason, ["change_of_mind", "faulty", "damaged", "wrong_item"], "reason");
  inSet(n, r.status, ["requested", "label_sent", "in_transit", "received", "refunded", "rejected"], "status");
  checkDates(n, r, ["created_at", "refunded_at"]); future(n, r.refunded_at); future(n, r.created_at);
  let sum = 0;
  for (const i of r.items) { const li = o.items.find((x) => x.sku === i.sku); if (!li) { bad(`${n}: ${i.sku} not on order`); continue; } if (i.qty > li.qty) bad(`${n}: qty too high`); sum += i.qty * li.unit_price; }
  const rej = r.status === "rejected";
  const ded = r.reason === "change_of_mind" && !rej ? biz.returns.change_of_mind_postage : 0;
  if (r.postage_deducted !== ded) bad(`${n}: postage_deducted ${r.postage_deducted} != ${ded}`);
  const paidShare = 1 - o.totals.discount / o.totals.items; // a discount code lowers what can be refunded
  if (r.refund_amount !== (rej ? 0 : r2(r2(sum * paidShare) - ded))) bad(`${n}: refund_amount ${r.refund_amount} wrong`);
  if ((r.status === "refunded") !== !!r.refunded_at) bad(`${n}: refunded_at mismatch`);
  const del = o.shipments.find((s) => s.delivered_at)?.delivered_at;
  if (!del) bad(`${n}: order not delivered`); else if (Date.parse(r.created_at) - Date.parse(del) > biz.returns.window_days * 864e5) bad(`${n}: created outside the 30-day window`);
}
const regIds = ids("registration", w.registrations, "id", /^REG-\d{4,5}$/);
const regBy = Object.fromEntries(w.registrations.map((r) => [r.id, r]));
for (const r of w.registrations) {
  if (!cIds.has(r.customer_id)) bad(`${r.id}: unknown customer`);
  const o = oBy[r.order_number]; if (!o) bad(`${r.id}: unknown order`); else { if (o.customer_id !== r.customer_id) bad(`${r.id}: order belongs to someone else`); if (!o.items.some((i) => i.sku === r.sku)) bad(`${r.id}: sku not on order`); }
  if (!dateOk(r.purchased_at) || !dateOk(r.warranty_until)) bad(`${r.id}: dates`);
  else { const d = new Date(r.purchased_at + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + (sku[r.sku]?.months ?? 12)); if (d.toISOString().slice(0, 10) !== r.warranty_until) bad(`${r.id}: warranty_until ${r.warranty_until} wrong`); }
}
const poBy = Object.fromEntries(w.purchase_orders.map((p) => [p.number, p]));
const fixIds = ids("repair", w.repairs, "number", /^FIX-\d{4,5}$/);
for (const r of w.repairs) {
  const n = r.number;
  if (!cIds.has(r.customer_id)) bad(`${n}: unknown customer`);
  const o = oBy[r.order_number]; if (!o) bad(`${n}: unknown order`); else if (o.customer_id !== r.customer_id) bad(`${n}: order belongs to someone else`);
  if (r.registration_id && regBy[r.registration_id]?.customer_id !== r.customer_id) bad(`${n}: registration missing or someone else's`);
  if (r.batch && !poBy[r.batch]?.lines.some((l) => l.sku === r.sku)) bad(`${n}: batch ${r.batch} did not supply ${r.sku}`);
  inSet(n, r.status, biz.fix_club.statuses, "status");
  checkDates(n, r, ["created_at"]); future(n, r.created_at);
  if (r.quote && r2(r.quote.lines.reduce((a, l) => a + l.price, 0)) !== r.quote.total) bad(`${n}: quote total`);
  if (["quote_sent", "approved"].includes(r.status) && !r.quote) bad(`${n}: ${r.status} needs a quote`);
}

// ---------------------------------------------------------------- cases, conversations, contacts, reviews
const caseIds = ids("case", w.cases, "number", /^CASE-\d{4,5}$/);
const caseBy = Object.fromEntries(w.cases.map((k) => [k.number, k]));
const refSets = { order: oIds, return: new Set(Object.keys(retBy)), repair: fixIds, booking: new Set() };
for (const k of w.cases) {
  const n = k.number;
  if (!cIds.has(k.customer_id)) bad(`${n}: unknown customer`);
  inSet(n, k.category, ["orders", "delivery", "returns", "repairs", "bookings", "product", "complaint", "account", "other"], "category");
  inSet(n, k.status, ["open", "waiting_customer", "escalated", "resolved", "closed"], "status");
  checkDates(n, k, ["opened_at"]);
  for (const x of k.notes) if (!isoOk(x.at)) bad(`${n}: note date`);
  for (const [t, v] of Object.entries(k.related)) {
    if (!refSets[t]?.has(v)) bad(`${n}: related ${t} ${v} not found`);
    else if (t === "order" && oBy[v].customer_id !== k.customer_id) bad(`${n}: order ${v} belongs to another customer`);
  }
  if (k.is_complaint && !k.complaint_stage) bad(`${n}: complaint without stage`);
  if (k.status === "escalated" && !k.escalated_to) bad(`${n}: escalated without escalated_to`);
}
ids("conversation", w.conversations, "id", /^CONV-\d{4,5}$/);
for (const v of w.conversations) {
  if (!cIds.has(v.customer_id)) bad(`${v.id}: unknown customer`);
  if (v.case_number && caseBy[v.case_number]?.customer_id !== v.customer_id) bad(`${v.id}: case missing or someone else's`);
  if (v.messages.length < 3 || v.messages.length > 8) bad(`${v.id}: ${v.messages.length} messages`);
  for (const m of v.messages) { if (!isoOk(m.at)) bad(`${v.id}: message date`); inSet(v.id, m.from, ["customer", "assistant", "support_agent"], "from"); }
}
ids("contact", w.contacts, "id", /^CT-\d{5}$/);
for (const c of w.contacts) {
  if (c.customer_id !== null && !cIds.has(c.customer_id)) bad(`${c.id}: unknown customer`);
  if (c.case_number && !caseBy[c.case_number]) bad(`${c.id}: unknown case`);
  inSet(c.id, c.channel, ["web_chat", "email", "phone", "text"], "channel");
  inSet(c.id, c.handled_by, ["assistant", "support_agent", "support_lead"], "handled_by");
  future(c.id, c.at);
}
for (const r of w.reviews) {
  const o = oBy[r.order_number];
  if (!o || o.customer_id !== r.customer_id || !o.items.some((i) => i.sku === r.sku)) bad(`${r.id}: order, customer or sku do not match`);
  if (!(r.rating >= 1 && r.rating <= 5)) bad(`${r.id}: rating`);
}

// ---------------------------------------------------------------- suppliers, purchase orders, stock
const supBy = Object.fromEntries(w.suppliers.map((s) => [s.id, s]));
for (const s of w.suppliers) for (const k of s.skus) if (!sku[k]) bad(`${s.id}: unknown sku ${k}`);
for (const p of w.purchase_orders) {
  if (!supBy[p.supplier_id]) bad(`${p.number}: unknown supplier`);
  inSet(p.number, p.status, ["ordered", "late", "part_received", "received", "cancelled"], "status");
  for (const l of p.lines) {
    if (!supBy[p.supplier_id]?.skus.includes(l.sku)) bad(`${p.number}: ${l.sku} not from this supplier`);
    if (l.qty_received > l.qty) bad(`${p.number}: received more than ordered`);
  }
  if (p.status === "received" && p.lines.some((l) => l.qty_received !== l.qty)) bad(`${p.number}: received but short`);
  if (p.status === "late" && p.due_at >= biz.sim.anchor_now.slice(0, 10)) bad(`${p.number}: late but not yet due`);
  future(p.number, p.received_at);
}
const countBy = Object.fromEntries(w.stock_counts.map((c) => [c.id, c]));
const balance = {}, zeroEvents = {};
const refOk = (m) => {
  if (m.reason === "received" || (m.reason === "written_off" && poBy[m.reference])) return !!poBy[m.reference]?.lines.some((l) => l.sku === m.sku);
  if (m.reason === "count_adjustment") return countBy[m.reference]?.sku === m.sku;
  if (m.reason === "returned_to_stock") return retBy[m.reference]?.items.some((i) => i.sku === m.sku) || oBy[m.reference]?.items.some((i) => i.sku === m.sku);
  return !!oBy[m.reference]?.items.some((i) => i.sku === m.sku);
};
let prev = "";
for (const m of w.stock_movements) {
  if (m.at < prev) bad(`${m.id}: movements out of time order`); prev = m.at;
  if (!refOk(m)) bad(`${m.id}: reference ${m.reference} does not match ${m.reason} of ${m.sku}`);
  balance[m.sku] = (balance[m.sku] || 0) + m.qty;
  if (balance[m.sku] < 0) bad(`${m.id}: ${m.sku} stock below zero`);
  if (balance[m.sku] === 0 && m.qty < 0 && !MTO.includes(sku[m.sku].product)) zeroEvents[m.sku] = (zeroEvents[m.sku] || 0) + 1;
}
for (const [k, v] of Object.entries(w.stock)) if ((balance[k] || 0) !== v.on_hand) bad(`stock ${k}: on hand ${v.on_hand} but movements sum to ${balance[k] || 0}`);
for (const c of w.stock_counts) {
  if (c.counted_qty - c.system_qty !== c.difference) bad(`${c.id}: difference does not add up`);
  if (c.difference !== 0 && !c.adjusted) planted.push(`${c.id}: count of ${c.sku} found ${c.difference} and was not adjusted`);
}

// ---------------------------------------------------------------- every paid order agrees with the ledger and stock
const ledgerBy = {};
for (const e of w.ledger) (ledgerBy[e.reference] ||= []).push(e);
const sumType = (ref, type) => r2((ledgerBy[ref] || []).filter((e) => e.type === type).reduce((n, e) => n + e.amount, 0));
const soldBy = {};
for (const m of w.stock_movements) if (["sold", "released"].includes(m.reason)) { const k = m.reference + "|" + m.sku; soldBy[k] = (soldBy[k] || 0) - m.qty; }
const retsByOrder = {};
for (const r of w.returns) (retsByOrder[r.order_number] ||= []).push(r);
for (const o of w.orders) {
  if (o.payment.status === "declined") { if (ledgerBy[o.number]) bad(`${o.number}: declined but in the ledger`); continue; }
  if (sumType(o.number, "sale") !== r2(o.totals.items - o.totals.discount)) bad(`${o.number}: ledger sale ${sumType(o.number, "sale")} != ${r2(o.totals.items - o.totals.discount)}`);
  if (sumType(o.number, "delivery_income") !== o.totals.delivery) bad(`${o.number}: ledger delivery income wrong`);
  if (!(sumType(o.number, "payment_fee") < 0)) bad(`${o.number}: no payment fee`);
  const want = {};
  for (const i of o.items) {
    const ship = o.shipments.find((s) => s.skus.includes(i.sku));
    const waiting = ship?.status === "pending" && ship.note;
    const notYet = MTO.includes(sku[i.sku].product) && !ship?.dispatched_at;
    want[i.sku] = (want[i.sku] || 0) + (o.status === "cancelled" || waiting || notYet ? 0 : i.qty);
  }
  for (const [k, expect] of Object.entries(want)) if ((soldBy[o.number + "|" + k] || 0) !== expect) bad(`${o.number}: ${k} stock moved ${soldBy[o.number + "|" + k] || 0}, expected ${expect}`);
  // refunds in the ledger match what the order says was refunded
  const refs = [o.number, ...(retsByOrder[o.number] || []).map((r) => r.number)];
  const refunded = r2(-refs.reduce((n, ref) => n + sumType(ref, "refund"), 0));
  if (refunded > o.totals.total + 0.001) bad(`${o.number}: ledger refunds ${refunded} exceed what was paid ${o.totals.total}`);
  for (const r of retsByOrder[o.number] || []) {
    const paidOut = -sumType(r.number, "refund");
    if (paidOut > r.refund_amount + 0.001) planted.push(`${r.number}: refunded ${r2(paidOut)} in the ledger for a ${r.refund_amount} return (refunded twice) on ${o.number}`);
  }
  const doubles = (retsByOrder[o.number] || []).reduce((n, r) => n + Math.max(0, -sumType(r.number, "refund") - r.refund_amount), 0);
  if (Math.abs(r2(refunded - doubles) - o.payment.refunded) > 0.001) bad(`${o.number}: ledger refunds ${refunded} != order refunded ${o.payment.refunded}`);
}
for (const e of w.ledger) {
  if (e.month !== e.at.slice(0, 7)) bad(`${e.id}: month field`);
  future(e.id, e.at);
  const known = ledgerBy[e.reference] && (oBy[e.reference] || retBy[e.reference] || poBy[e.reference] || caseBy[e.reference] || w.campaigns.some((c) => c.id === e.reference) || /^(WAGES|RENT|SOFTWARE)-\d{4}-\d{2}$/.test(e.reference) || countBy[e.reference]);
  if (!known) bad(`${e.id}: reference ${e.reference} not found`);
}

// ---------------------------------------------------------------- monthly summary equals the ledger
const OPEX = ["payment_fee", "delivery_cost", "wages", "rent", "software", "marketing_spend", "goodwill_credit"];
let cash = w.company.opening_cash;
for (const s of w.monthly_summary) {
  const es = w.ledger.filter((e) => e.month === s.month);
  const sum = (t) => r2(es.filter((e) => e.type === t).reduce((n, e) => n + e.amount, 0));
  const revenue = r2(sum("sale") + sum("delivery_income"));
  const opex = r2(OPEX.reduce((n, t) => n - sum(t), 0));
  const profit = r2(revenue + sum("refund") + sum("cost_of_goods") - opex);
  cash = r2(cash + es.filter((e) => !["cost_of_goods", "goodwill_credit"].includes(e.type)).reduce((n, e) => n + e.amount, 0));
  if (s.revenue !== revenue) bad(`${s.month}: summary revenue ${s.revenue} != ledger ${revenue}`);
  if (s.refunds !== -sum("refund")) bad(`${s.month}: summary refunds`);
  if (s.cost_of_goods !== -sum("cost_of_goods")) bad(`${s.month}: summary cost of goods`);
  for (const t of OPEX) if (s.operating_costs[t] !== -sum(t)) bad(`${s.month}: summary ${t}`);
  if (Math.abs(s.profit - profit) > 0.011) bad(`${s.month}: summary profit ${s.profit} != ledger ${profit}`);
  if (Math.abs(s.cash_at_month_end - cash) > 0.011) bad(`${s.month}: cash ${s.cash_at_month_end} != ledger ${cash}`);
}
if (w.ledger.some((e) => !w.monthly_summary.some((s) => s.month === e.month))) bad("ledger has a month with no summary");

// ---------------------------------------------------------------- documents
const current = (c) => {
  if (c.kind === "price") return sku[c.sku].price;
  if (c.kind === "returns_window") return biz.returns.window_days;
  if (c.kind === "lead_time") return supBy[c.supplier].lead_time_days;
  if (c.kind === "variant_count") return products[c.product].variants.length;
  if (c.kind === "product_text") return JSON.stringify(products[c.product]).toLowerCase().includes(c.says) ? c.says : "(not mentioned)";
  return undefined;
};
for (const d of w.documents) {
  if (d.status === "out_of_date" && !d.checks.length) bad(`${d.id}: out of date but says nothing checkable`);
  for (const c of d.checks) {
    const now = current(c);
    if (now === undefined) { bad(`${d.id}: unknown check ${c.kind}`); continue; }
    if (now === c.says) bad(`${d.id}: says ${c.kind} ${c.says}, which still matches current records`);
    else if (d.status === "current") planted.push(`${d.id} "${d.title}" is marked current but says ${c.sku || c.kind} is ${c.says}; records say ${now}`);
  }
}
const outOfDate = w.documents.filter((d) => d.status === "out_of_date").length;
if (outOfDate < 4) bad(`only ${outOfDate} out-of-date documents; need at least 4`);

// ---------------------------------------------------------------- size: history ends where the simulator starts
// Mean orders a day over the last 28 days of history must be within 25% of the simulator's demand formula
// (business/data/sim.json: base orders a day x scale x season x weekday x events) for those same days.
const scale = w.company.scale;
if (typeof scale !== "number" || !(scale > 0)) bad("company.scale missing");
else {
  if (Math.abs(w.company.orders_per_day_now - SIM_DEMAND.base_orders_per_day * scale) > 0.01) bad("company.orders_per_day_now does not match business/data/sim.json and the scale");
  let want = 0, got = 0;
  for (let k = 1; k <= 28; k++) {
    const t = Date.parse(biz.sim.anchor_now.slice(0, 10)) - k * 864e5;
    const date = new Date(t).toISOString().slice(0, 10);
    want += expectedOrders(t, scale) / growth(t) * activeEffects(w.world_events, date).demand.all;
    got += w.orders.filter((o) => o.placed_at.startsWith(date) && !/^ORD-20[12]\d\d$/.test(o.number)).length;
  }
  const ratio = got / want;
  if (Math.abs(ratio - 1) > 0.25) bad(`last 28 days: ${(got / 28).toFixed(2)} orders a day, the simulator's formula gives ${(want / 28).toFixed(2)} (off by ${Math.round((ratio - 1) * 100)}%)`);
  console.log(`Last 28 days: ${(got / 28).toFixed(2)} orders a day; the simulator's formula at scale ${scale} gives ${(want / 28).toFixed(2)} (${Math.round((ratio - 1) * 100)}%).`);
}
// business/data/seed is the public shop's own copy and is frozen (business/builder/build-world.mjs --write-seed is opt-in), so it is not compared.

// ---------------------------------------------------------------- planted stock stories hold in every size (stories only)
if (STORIES) {
  for (const [k, back] of [["OT-BLIP", "2026-11-30"], ["OT-TROF", "2026-12-07"]]) {
    if (w.stock[k].on_hand !== 0 || w.stock[k].restock_date !== back) bad(`story: ${k} should be empty until ${back}, is ${JSON.stringify(w.stock[k])}`);
  }
  const waiting = w.orders.filter((o) => o.status === "paid" && o.shipments.some((s) => s.status === "pending" && s.skus.includes("OT-BLIP")));
  if (waiting.length !== 6) bad(`story: expected 6 paid orders waiting for Blip, found ${waiting.length}`);
}

// ---------------------------------------------------------------- an ordinary business: nothing planted (no stories)
const staffNames = new Set(rd("business/data/staff.json").staff.map((p) => p.name));
// WHY: the hand-written stories predate the team list (four story customers share staff names, and story orders
// say "Test card"); the benchmark depends on those records, so these two checks apply to plain worlds only.
if (!STORIES) {
  for (const c of w.customers) if (staffNames.has(c.name)) bad(`${c.id}: ${c.name} is on the staff, not a customer`);
  if (/Test card/.test(allText)) bad("a record says \"Test card\"; card records should read like ordinary cards");
}
const inDateOrder = (name, list, idKey, dateKey) => {
  const sorted = [...list].sort((a, b) => a[idKey].localeCompare(b[idKey], "en", { numeric: true }));
  for (let i = 1; i < sorted.length; i++) if (sorted[i][dateKey] < sorted[i - 1][dateKey] && !STORIES) { bad(`${name}: ${sorted[i][idKey]} is dated before ${sorted[i - 1][idKey]}`); break; }
};
inDateOrder("repairs", w.repairs, "number", "created_at");
inDateOrder("reviews", w.reviews, "id", "date");
if (!STORIES) {
  if (fs.existsSync(path.join(DIR, "STORIES.md"))) bad("STORIES.md in a world without stories");
  if (w.orders.some((o) => /^ORD-20[12]\d\d$/.test(o.number) && Number(o.number.slice(4)) <= 20299 && Number(o.number.slice(4)) >= 20101 && o.note)) bad("a story order in a world without stories");
  if (w.contacts.some((c) => c.topic === "story" || c.topic === "order_request")) bad("a story contact in a world without stories");
  if (w.documents.some((d) => d.checks.some((c) => c.planted))) bad("a planted document in a world without stories");
  if (w.purchase_orders.some((p) => p.expected_at)) bad("a pinned (story) purchase order in a world without stories");
  if (w.stock_counts.some((c) => c.difference !== 0 && !c.adjusted)) bad("an unadjusted stock count in a world without stories");
}

// ---------------------------------------------------------------- world events, news, mail, chat and social link to real records
const eventIds = ids("world_event", w.world_events, "id", /^WE-\d{5}$/);
for (const e of w.world_events) {
  if (!(e.start <= e.end)) bad(`${e.id}: ends before it starts`);
  inSet(e.id, e.status, ["scheduled", "active", "over", "cancelled"], "status");
}
ids("news", w.news, "id", /^NW-\d{5}$/);
for (const n of w.news) { if (!eventIds.has(n.event)) bad(`${n.id}: event ${n.event} not found`); future(n.id, n.at); }
const ledgerIds = new Set(w.ledger.map((e) => e.id));
const contactIds = new Set(w.contacts.map((c) => c.id));
const convIds = new Set(w.conversations.map((v) => v.id));
const campaignIds = new Set(w.campaigns.map((c) => c.id));
const LINKS = { customer_id: cIds, order: oIds, case: caseIds, po: new Set(Object.keys(poBy)), supplier_id: new Set(Object.keys(supBy)),
  campaign_id: campaignIds, ledger_id: ledgerIds, contact_id: contactIds, conversation_id: convIds, product_id: new Set(Object.keys(products)) };
const checkLinks = (rec) => {
  for (const [k, v] of Object.entries(rec.links || {})) if (LINKS[k] && v != null && !LINKS[k].has(v)) bad(`${rec.id}: links.${k} ${v} not found`);
};
for (const [name, list, re] of [["emails", w.emails, /^EM-\d{6}$/], ["chat_messages", w.chat_messages, /^CH-\d{6}$/], ["social_posts", w.social_posts, /^SP-\d{6}$/]]) {
  ids(name, list, "id", re);
  for (const r of list) { checkLinks(r); future(r.id, r.at); }
}

// ---------------------------------------------------------------- one-screen summary
const paid = w.orders.filter((o) => o.payment.status !== "declined");
const byYear = {};
for (const s of w.monthly_summary) { const y = s.month.slice(0, 4); byYear[y] ||= { revenue: 0, profit: 0, orders: 0 }; byYear[y].revenue += s.revenue; byYear[y].profit += s.profit; byYear[y].orders += s.orders; }
const units = {};
for (const o of paid) for (const i of o.items) units[sku[i.sku].product] = (units[sku[i.sku].product] || 0) + i.qty * i.unit_price;
const delivered = w.orders.filter((o) => o.status === "delivered");
const returnable = delivered.filter((o) => o.items.some((i) => !sku[i.sku].chilled && !sku[i.sku].plant && !["biscuit-tin"].includes(sku[i.sku].product)));
const ships = w.orders.flatMap((o) => o.shipments);
const lostBaskets = w.web_sessions_daily.reduce((n, d) => n + d.baskets_lost_to_stockouts, 0);
const fmt = (n) => "£" + Math.round(n).toLocaleString("en-GB");
console.log(`World: ${path.basename(DIR)}. ${w.customers.length} customers, ${w.orders.length} orders (${paid.length} paid), ${w.suppliers.length} suppliers, ${w.purchase_orders.length} purchase orders, ${w.ledger.length} ledger entries.`);
console.log("Year   orders  revenue    profit");
for (const [y, v] of Object.entries(byYear)) console.log(`${y}  ${String(v.orders).padStart(6)}  ${fmt(v.revenue).padStart(9)}  ${fmt(v.profit).padStart(8)}`);
console.log("Top products by sales: " + Object.entries(units).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, v]) => `${p} ${fmt(v)}`).join(", "));
console.log(`Return rate: ${(w.returns.length / Math.max(1, returnable.length) * 100).toFixed(1)}% of delivered orders with a returnable item (${w.returns.length} returns). Late parcels ${(ships.filter((s) => s.note?.includes("after the estimated")).length / Math.max(1, ships.length) * 100).toFixed(1)}%, lost ${ships.filter((s) => s.status === "lost").length}.`);
console.log(`Stockouts: ${Object.values(zeroEvents).reduce((a, b) => a + b, 0)} times a shelf went empty (${Object.keys(zeroEvents).length} SKUs); ${lostBaskets} whole baskets lost to empty shelves. Empty now: ${Object.entries(w.stock).filter(([k, v]) => v.on_hand === 0 && !MTO.includes(sku[k].product)).map(([k, v]) => `${k}${v.restock_date ? " (back " + v.restock_date + ")" : ""}`).join(", ") || "none"}.`);
console.log(`Contacts ${w.contacts.length}, cases ${w.cases.length}, repairs ${w.repairs.length}, reviews ${w.reviews.length}. Cash now ${fmt(w.monthly_summary.at(-1).cash_at_month_end)}.`);
if (planted.length && !STORIES) bad("planted findings in a world without stories:\n- " + planted.join("\n- "));
else if (planted.length) console.log("\nPlanted findings (deliberate, listed in STORIES.md):\n- " + planted.join("\n- "));
const kb = (n) => Math.round(fs.statSync(path.join(DIR, n + ".json")).size / 1024);
console.log("New collections (KB): " + ["world_events", "news", "emails", "chat_messages", "social_posts", "social_stats_daily"].filter((n) => fs.existsSync(path.join(DIR, n + ".json"))).map((n) => `${n} ${kb(n)} (${w[n].length})`).join(", "));
console.log(errs.length ? "\n" + errs.slice(0, 60).join("\n") + `\n${errs.length} errors` : "\n0 errors");
process.exit(errs.length ? 1 : 0);
