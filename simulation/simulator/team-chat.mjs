// Staff chat that lives: a simulator plug-in whose afterDay has the team talk about the day's real events and answer
// what a person (or an AI) posted, by rules. No AI model: every line is a template filled from the records.
//
//   - stock-outs: the stock room says the last one went, and the buyer says what is on order (or that nothing is)
//   - escalated complaints: the help desk lead takes them
//   - parcels stuck with a carrier, and unusually big orders (unless the comms plug-in already wrote about them)
//   - a rival's move in the paper: marketing raises it, the manager answers
//   - tasks finished in the simulation: the person says so where the work belongs
//   - answers: a message posted through the tools gets a reply from the colleague who owns what it is about
//     (business/data/team.json "owns"), quoting the record: an order's status, a case, a purchase order, stock, the month's money
//
// Deterministic: every choice is drawn from rngFor(seed, purpose, date, record id), so a live world and its shadow
// twin write the same lines when nothing is done, and the same answer to the same message.
// Records written: state.chat_messages, with keys "team|..." so nothing is said twice.
import { rngFor } from "../../business/builder/world/rng.mjs";
import { ROSTER, canUseChannel } from "../../infrastructure/engine/comms.js";
import { ORG } from "../../infrastructure/engine/tasks.js";

const BIG_ORDER = 120;          // pounds: an order this big gets mentioned (about four times the usual basket)
const MAX_LATE_A_DAY = 3;       // stuck parcels mentioned per day, so the channel is not a log
const ANSWER_LOOKBACK_DAYS = 3; // messages posted this recently still get an answer

const person = (id) => ROSTER.find((p) => p.id === id);
const owners = (what) => ROSTER.filter((p) => (ORG[p.id]?.owns || []).includes(what));

/** HH:MM on a date plus minutes, as an ISO time; kept inside the date's working day. */
function timeAfter(iso, minutes) {
  const t = Date.parse(iso) + minutes * 60000;
  return new Date(t).toISOString().replace(".000Z", "Z");
}

function money(n) {
  return `£${Number(n).toFixed(2).replace(/\.00$/, "")}`;
}

/**
 * The plug-in.
 * @param {{products?: Array<object>}=} o The catalogue (business/data/products), so products can be named and found in messages.
 * @return {{name: string, afterDay: function(object): void}}
 */
export function teamChatPlugin({ products = [] } = {}) {
  return { name: "team", afterDay: (ctx) => afterDay({ ...ctx, products }) };
}

/**
 * Writes the day's lines into state.chat_messages.
 * @param {{state: object, date: string, seed: number, products: Array<object>}} ctx
 */
function afterDay({ state, date, seed, products }) {
  const chat = (state.chat_messages ||= []);
  const keys = new Set();
  let top = 0;
  for (const m of chat) { if (m.key) keys.add(m.key); top = Math.max(top, Number(String(m.id).split("-")[1]) || 0); }
  const say = (m) => {
    if (keys.has(m.key)) return null;
    const p = person(m.from);
    const rec = { id: `CH-${String(++top).padStart(6, "0")}`, key: m.key, channel: m.channel || null, dm: m.dm || null, from: p.id, from_name: p.name, text: m.text, at: m.at,
      parent_key: m.parent?.key || null, thread_parent: m.parent?.id || null, reactions: [], links: m.links || {}, team: true };
    keys.add(rec.key);
    chat.push(rec);
    return rec;
  };
  stockOuts(state, date, seed, say, products);
  escalations(state, date, seed, say);
  lateParcels(state, date, seed, say, keys);
  bigOrders(state, date, seed, say, keys);
  rivalNews(state, date, seed, say);
  finishedTasks(state, date, say);
  answers(state, date, seed, say, keys, products);
}

function stockOuts(state, date, seed, say, products) {
  const emptied = new Map();
  for (let i = (state.stock_movements || []).length - 1; i >= 0; i--) {
    const mv = state.stock_movements[i];
    if (mv.at.slice(0, 10) < date) break;
    if (mv.at.slice(0, 10) !== date || mv.qty >= 0 || (state.stock[mv.sku]?.on_hand ?? 1) > 0) continue;
    if (!emptied.has(mv.sku) || mv.at > emptied.get(mv.sku).at) emptied.set(mv.sku, mv);
  }
  for (const [sku, mv] of [...emptied.entries()].sort()) {
    const r = rngFor(seed, "team-chat-stockout", date, sku);
    const name = productName(products, sku);
    const waiting = state.orders.filter((o) => o.status !== "cancelled" && (o.shipments || []).some((s) => s.status === "pending" && s.note && s.skus.includes(sku)));
    const first = say({ key: `team|stockout|${sku}|${date}`, channel: "stockroom", from: "S-05", at: timeAfter(mv.at, r.int(5, 40)),
      text: `That was the last ${name} (${sku}) on the shelf.${waiting.length ? ` ${waiting.length} order${waiting.length === 1 ? " is" : "s are"} waiting for it, starting with ${waiting[0].number}.` : ""}`,
      links: { sku, ...(waiting[0] ? { order: waiting[0].number } : {}) } });
    if (!first) continue;
    const po = (state.purchase_orders || []).find((p) => ["ordered", "late", "awaiting_approval", "draft"].includes(p.status) && p.lines.some((l) => l.sku === sku && l.qty > (l.qty_received || 0)));
    const sup = (state.suppliers || []).find((s) => s.skus.includes(sku));
    const text = po ? `${po.number} has more coming from ${supplierName(state, po.supplier_id)}, due ${po.due_at}${po.status === "awaiting_approval" ? ", once it is approved" : ""}.`
      : sup ? `Nothing on order for it. ${sup.name} takes ${sup.lead_time_days} days and the smallest order is ${sup.min_order_qty}. I'll look at it.` : "Nobody supplies that one any more.";
    say({ key: `team|stockout|${sku}|${date}|buyer`, channel: "stockroom", from: "S-09", at: timeAfter(first.at, r.int(10, 90)), parent: first, text,
      links: { sku, ...(po ? { po: po.number } : {}), ...(sup ? { supplier_id: sup.id } : {}) } });
  }
}

function escalations(state, date, seed, say) {
  for (const k of state.cases || []) {
    if (k.status !== "escalated" || !(k.notes || []).some((n) => String(n.at).slice(0, 10) === date)) continue;
    const r = rngFor(seed, "team-chat-escalation", k.number);
    const c = state.customers.find((x) => x.id === k.customer_id);
    const note = (k.notes || []).at(-1);
    say({ key: `team|escalated|${k.number}`, channel: "customers", from: "S-06", at: timeAfter(note.at, r.int(5, 45)),
      text: `I've got ${k.number}${c ? ` (${c.name})` : ""}${k.is_complaint ? `, a complaint at stage ${k.complaint_stage || 1}` : ""}. ${k.related?.order ? `It is about ${k.related.order}. ` : ""}I'll answer today.`,
      links: { case: k.number, ...(c ? { customer_id: c.id } : {}), ...(k.related?.order ? { order: k.related.order } : {}) } });
  }
}

function lateParcels(state, date, seed, say, keys) {
  let n = 0;
  for (let i = state.orders.length - 1; i >= 0 && n < MAX_LATE_A_DAY; i--) {
    const o = state.orders[i];
    for (const s of o.shipments || []) {
      if (s.status !== "delayed" || keys.has(`chat|late|${s.id}`) || keys.has(`team|late|${s.id}`)) continue;
      const r = rngFor(seed, "team-chat-late", s.id);
      const c = state.customers.find((x) => x.id === o.customer_id);
      if (say({ key: `team|late|${s.id}`, channel: "orders", from: "S-04", at: `${date}T${String(r.int(10, 15)).padStart(2, "0")}:${String(r.int(0, 59)).padStart(2, "0")}:00Z`,
        text: `${o.number} is stuck with ${s.carrier || "the carrier"}${s.eta ? `; it was due ${s.eta}` : ""}. ${c ? `${c.name} may get in touch.` : ""} I'm chasing it.`, links: { order: o.number, ...(c ? { customer_id: c.id } : {}) } })) n++;
      if (n >= MAX_LATE_A_DAY) break;
    }
  }
}

function bigOrders(state, date, seed, say, keys) {
  for (let i = state.orders.length - 1; i >= 0; i--) {
    const o = state.orders[i];
    if (o.placed_at.slice(0, 10) < date) break;
    if (o.placed_at.slice(0, 10) !== date || o.status === "cancelled" || o.status === "payment_failed" || (o.totals?.total || 0) < BIG_ORDER) continue;
    if (keys.has(`chat|big|${o.number}`)) continue;
    const r = rngFor(seed, "team-chat-big", o.number);
    const c = state.customers.find((x) => x.id === o.customer_id);
    const units = o.items.reduce((n, l) => n + l.qty, 0);
    say({ key: `team|big|${o.number}`, channel: "orders", from: "S-04", at: timeAfter(o.placed_at, r.int(10, 120)),
      text: `Big one: ${o.number}, ${money(o.totals.total)} for ${units} thing${units === 1 ? "" : "s"}${c ? ` from ${c.name}` : ""}. I'll pack it first.`, links: { order: o.number, ...(c ? { customer_id: c.id } : {}) } });
  }
}

function rivalNews(state, date, seed, say) {
  for (const n of state.news || []) {
    if (String(n.at).slice(0, 10) !== date || !String(n.source || "").startsWith("competitor_move:")) continue;
    const moveId = n.source.split(":")[1];
    const move = (state.competitor_moves || []).find((m) => m.id === moveId);
    const r = rngFor(seed, "team-chat-rival", n.id);
    const first = say({ key: `team|rival|${n.id}`, channel: "marketing", from: "S-10", at: timeAfter(n.at, r.int(60, 180)),
      text: `In the paper: "${n.headline}". Do we answer it?`, links: { news: n.id, ...(move ? { organisation: move.competitor } : {}) } });
    if (!first) continue;
    const cut = move && (move.price_factor ?? 1) < 1;
    say({ key: `team|rival|${n.id}|boss`, channel: "marketing", from: "S-01", at: timeAfter(first.at, r.int(15, 120)), parent: first,
      text: cut ? r.pick(["Not on price. We say what ours does that theirs doesn't.", "Leave the prices. Tell people why ours last.", "No sale from us. Watch the orders for a week and tell me."])
        : r.pick(["Noted. Keep an eye on it.", "Let's see if anyone mentions it.", "Fine. Nothing changes for us yet."]),
      links: { news: n.id, ...(move ? { organisation: move.competitor } : {}) } });
  }
}

function finishedTasks(state, date, say) {
  for (const t of state.tasks || []) {
    if (t.status !== "done" || String(t.completed_at).slice(0, 10) !== date || !person(t.assignee)) continue;
    if (t.history?.at(-1)?.by !== t.assignee) continue; // marked done by hand: the person said so themselves
    const l = t.links || {};
    const channel = l.case || l.customer_id || l.review ? "customers" : l.order ? "orders" : l.po || l.supplier_id ? "stockroom" : "general";
    const by = canUseChannel(person(t.assignee).role, channel) ? channel : "general";
    say({ key: `team|task|${t.id}`, channel: by, from: t.assignee, at: t.completed_at, text: `Done: ${t.title}.`, links: { task: t.id, ...l } });
  }
}

// ---------------------------------------------------------------- answers to people

/** What a message is about, from the record numbers and words in it. */
function topicOf(products, text) {
  const ref = (re) => (text.match(re) || [])[0];
  const order = ref(/\bORD-\d+\b/i), kase = ref(/\bCASE-\d+\b/i), po = ref(/\bPO-\d+\b/i);
  if (order) return { what: "orders", order: order.toUpperCase() };
  if (kase) return { what: "case", case: kase.toUpperCase() };
  if (po) return { what: "po", po: po.toUpperCase() };
  const lower = text.toLowerCase();
  // A product is named by its last word ("sock" for The Spare Sock), so "socks" and "the spare sock" both find it.
  const product = products.find((p) => new RegExp(`\\b${p.name.toLowerCase().split(/\s+/).at(-1).replace(/[^a-z0-9]/g, "")}`).test(lower));
  if (product || /\b(stock|shelf|restock|supplier|deliver(y|ies) in)\b/.test(lower)) return { what: "stock", product };
  if (/\b(money|cash|takings|revenue|profit|invoice|bank|spend|costs?)\b/.test(lower)) return { what: "money" };
  if (/\b(campaign|post|posts|squint|mutter|newsletter|advert|marketing)\b/.test(lower)) return { what: "campaign" };
  if (/\b(complain|complaint|customer|review|refund)\w*/.test(lower)) return { what: "customers" };
  return { what: "general" };
}

/** The colleague who answers: whoever owns the topic and can read the channel, never the person who asked. */
function responder(topic, m) {
  const can = (p) => p.id !== m.from && (!m.channel || canUseChannel(p.role, m.channel));
  if (m.dm) {
    const other = m.dm.find((id) => id !== m.from);
    return person(other) || null;
  }
  const pool = [...owners(topic.what), ...owners(m.channel), ...owners("general")];
  return pool.find(can) || ROSTER.find(can) || null;
}

/**
 * The reply a colleague gives to a message, from the records. Exported for tests and for anyone who wants the rule.
 * @param {object} state
 * @param {object} m The message being answered.
 * @param {number} seed
 * @param {Array<object>=} products The catalogue.
 * @return {?{from: string, text: string, links: object}}
 */
export function answerFor(state, m, seed, products = []) {
  const topic = topicOf(products, m.text);
  const who = responder(topic, m);
  if (!who) return null;
  const r = rngFor(seed, "team-chat-answer", m.id);
  const opener = r.pick(["", "Checked: ", "Looked it up. ", "On it. "]);
  if (topic.order) {
    const o = state.orders.find((x) => x.number === topic.order);
    if (!o) return { from: who.id, text: `I can't find ${topic.order}. Is the number right?`, links: {} };
    const s = (o.shipments || [])[0];
    const c = state.customers.find((x) => x.id === o.customer_id);
    const where = s ? `${s.status.replace(/_/g, " ")}${s.carrier ? ` with ${s.carrier}` : ""}${s.eta ? `, due ${s.eta}` : ""}` : o.status.replace(/_/g, " ");
    return { from: who.id, text: `${opener}${o.number}${c ? ` for ${c.name}` : ""} is ${o.status.replace(/_/g, " ")}: ${where}.`, links: { order: o.number, ...(c ? { customer_id: c.id } : {}) } };
  }
  if (topic.case) {
    const k = (state.cases || []).find((x) => x.number === topic.case);
    if (!k) return { from: who.id, text: `There's no ${topic.case}. Wrong number?`, links: {} };
    const last = (k.notes || []).at(-1);
    return { from: who.id, text: `${opener}${k.number} is ${k.status.replace(/_/g, " ")}${k.is_complaint ? ` (complaint, stage ${k.complaint_stage || 1})` : ""}.${last ? ` Last note: "${String(last.text).slice(0, 120)}"` : ""}`, links: { case: k.number, ...(k.customer_id ? { customer_id: k.customer_id } : {}) } };
  }
  if (topic.po) {
    const p = (state.purchase_orders || []).find((x) => x.number === topic.po);
    if (!p) return { from: who.id, text: `No ${topic.po} on file.`, links: {} };
    return { from: who.id, text: `${opener}${p.number} from ${supplierName(state, p.supplier_id)} is ${p.status.replace(/_/g, " ")}${p.received_at ? `, arrived ${p.received_at.slice(0, 10)}` : p.due_at ? `, due ${p.due_at}` : ""}.`, links: { po: p.number, supplier_id: p.supplier_id } };
  }
  if (topic.what === "stock") {
    const out = Object.entries(state.stock || {}).filter(([, v]) => v.on_hand <= 0).map(([sku]) => sku);
    if (topic.product) {
      const lines = [...(topic.product.variants || []), ...(topic.product.accessories || [])].map((v) => `${v.name || v.sku}: ${state.stock[v.sku]?.on_hand ?? 0}`);
      return { from: who.id, text: `${opener}${topic.product.name} on the shelf: ${lines.slice(0, 4).join(", ")}.`, links: { product_id: topic.product.id } };
    }
    return { from: who.id, text: `${opener}${out.length ? `${out.length} line${out.length === 1 ? " is" : "s are"} out of stock right now, including ${out.slice(0, 3).join(", ")}.` : "Nothing is out of stock right now."}`, links: out[0] ? { sku: out[0] } : {} };
  }
  if (topic.what === "money") {
    const month = (state.monthly_summary || []).at(-1);
    return { from: who.id, text: month ? `${opener}${monthWords(month.month)} so far: ${month.orders} orders, ${money(month.revenue)} in, profit ${money(month.profit)}.` : "The month's figures aren't in yet.", links: {} };
  }
  if (topic.what === "campaign") {
    const on = (state.campaigns || []).filter((c) => c.status === "active" || c.status === "running");
    return { from: who.id, text: on.length ? `${opener}${on.length} campaign${on.length === 1 ? "" : "s"} running: ${on.slice(0, 3).map((c) => c.name).join(", ")}.` : "No campaigns running at the moment.", links: on[0] ? { campaign_id: on[0].id } : {} };
  }
  const open = (state.cases || []).filter((k) => !["resolved", "closed"].includes(k.status));
  if (topic.what === "customers") {
    const worst = open.find((k) => k.is_complaint) || open[0];
    return { from: who.id, text: `${opener}${open.length} case${open.length === 1 ? "" : "s"} open${worst ? `; the one to watch is ${worst.number}` : ""}.`, links: worst ? { case: worst.number } : {} };
  }
  const toSend = state.orders.filter((o) => ["paid", "processing", "packed"].includes(o.status)).length;
  return { from: who.id, text: r.pick([`Noted. ${count(toSend, "order")} to go out and ${count(open.length, "case")} open.`, `Thanks. For what it's worth: ${count(toSend, "parcel")} to pack, ${count(open.length, "open case")}.`]), links: {} };
}

function answers(state, date, seed, say, keys, products) {
  const from = new Date(Date.parse(`${date}T00:00:00Z`) - ANSWER_LOOKBACK_DAYS * 86400000).toISOString();
  for (let i = state.chat_messages.length - 1; i >= 0; i--) {
    const m = state.chat_messages[i];
    if (m.at < from) break;
    if (!String(m.key || "").startsWith("tool|") || keys.has(`team|answer|${m.id}`)) continue;
    const a = answerFor(state, m, seed, products);
    if (!a) continue;
    const r = rngFor(seed, "team-chat-answer-time", m.id);
    say({ key: `team|answer|${m.id}`, channel: m.channel, dm: m.dm, from: a.from, at: timeAfter(m.at, r.int(4, 55)), parent: m.channel ? m : null, text: a.text, links: a.links });
  }
}

function productName(products, sku) {
  for (const p of products) for (const v of [...(p.variants || []), ...(p.accessories || [])]) if (v.sku === sku) return p.name;
  return sku;
}

function supplierName(state, id) {
  return (state.suppliers || []).find((s) => s.id === id)?.name || "the supplier";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-11" as "November 2026". */
function monthWords(ym) {
  return `${MONTHS[Number(String(ym).slice(5, 7)) - 1] || ""} ${String(ym).slice(0, 4)}`.trim();
}

/** "1 order", "3 orders". */
function count(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
