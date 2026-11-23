// The supplier side: suppliers that write back. Each of the shop's suppliers has a contact person and a mailbox, and
// answers by rules, never by a model:
//   - new purchase orders: a supplier queries one that is under its minimum order value or bigger than it can make in a
//     week (and so later than asked), and confirms the rest when no one else has (the comms plug-in writes the routine
//     confirmations for history-style mail; this writes one only when that is missing);
//   - delays: when a disruption starts (simulation/world/suppliers.mjs, natural or set in world_settings), open orders due while
//     it lasts move by its extra days, and the supplier writes to say so, with the reason;
//   - the shop's emails (sent by a person or a connected AI with send_email to a supplier's address): on the next
//     working day (two when relations are cool) the supplier answers lead-time questions and agrees to or refuses
//     requests to bring an order forward (expedite), to take money off for a bigger order (volume discount) or to change
//     a quantity, by its capacity, its terms and how it has been treated. Agreed changes really change the purchase
//     order (amendPurchaseOrder, the same code as the engine tool apply_supplier_change).
//   - memory: a supplier remembers rude emails, bills paid late and how many changes it has already agreed to
//     (standingOf). Below a line it answers more slowly and offers half as much; further down it refuses changes.
// Every chance (only the time of day of a reply) uses rngFor keyed by supplier, purchase order, email and date, and
// everything else reads the records, so an untouched world and its shadow twin stay identical.
// Data: business/data/supplier-side.json (contacts, tone, what each will agree to). Records: state.supplier_requests (one per
// email handled or message sent, with the decision and the reason), purchase_orders[].amendments, and emails.
// Browser-safe: the JSON is imported, not read from disk.
import { rngFor } from "../../business/builder/world/rng.mjs";
import { activeSettings, addDays, daysBetween, dateWords, weekdayOf, round } from "./common.mjs";
import { disruptionsOn, usualOrder } from "./suppliers.mjs";
import SIDE from "../../business/data/supplier-side.json" with { type: "json" };

export const SUPPLIER_SIDE = SIDE;
const RULES = SIDE.rules;
const SHOP_DOMAIN = "overthought.example";
const OPEN_PO = ["ordered", "late"];
/** What a supplier says about a disruption set in world_settings (an experiment), which has no story of its own. */
const SET_REASON = "we are short of hands and materials at the moment";
/** How far back to look for the shop's own emails each day. WHY a bound: the mail list grows to tens of thousands. */
const SCAN_BACK = 4000;

// ---------------------------------------------------------------- who the supplier is

/** "Beckside Mill" → "beckside-mill", as business/builder/world/comms.mjs makes supplier addresses. */
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * A supplier's people and addresses.
 * @param {object} sup A record from state.suppliers.
 * @return {?{id: string, name: string, contact: object, tone: string, from: {name: string, address: string}, addresses: Array<string>, side: object}}
 */
export function supplierPeople(sup) {
  const side = SIDE.suppliers[sup?.id];
  if (!side) return null;
  const domain = `${slug(sup.name)}.example`;
  const address = `${side.box}@${domain}`;
  return {
    id: sup.id, name: sup.name, contact: side.contact, tone: side.tone, side,
    from: { name: `${side.contact.name}, ${sup.name}`, address },
    // WHY all three: history mail goes to the sales desk (orders@) and the accounts desk; the contact reads both.
    addresses: [address, `orders@${domain}`, `accounts@${domain}`],
  };
}

/** The supplier behind an email address, or null. */
export function supplierByAddress(state, address) {
  const a = String(address || "").toLowerCase();
  if (!a.endsWith(".example") || a.endsWith(`@${SHOP_DOMAIN}`)) return null;
  for (const sup of state.suppliers || []) if (supplierPeople(sup)?.addresses.includes(a)) return sup;
  return null;
}

// ---------------------------------------------------------------- reading the shop's email

const RUDE = /\b(useless|pathetic|incompetent|hopeless|rubbish|idiots?|stupid|disgrace(ful)?|shambles|clowns?|get a grip|sort it out|what is wrong with you|ridiculous|joke)\b/i;
const POLITE = /\b(please|thank(s| you)?|grateful|appreciate|kind regards|many thanks)\b/i;
const ASKS = {
  expedite: /\b(sooner|earlier|expedite|rush|hurry|bring (it |this |the order |po-\d+ )?forward|faster|quicker|as soon as (you )?can|urgent(ly)?|speed (it |this )?up)\b/i,
  discount: /\b(discount|cheaper|better price|lower (the )?price|price break|reduc(e|tion) (in |on |the )?(the )?price|volume (price|deal|discount)|money off|% off)\b/i,
  quantity: /\b((change|increase|raise|reduce|lower|cut|amend|up|bump) (the )?(quantity|qty|order|amount|number)|(make|change) it \d+|\d+ (units )?instead( of)?|(to|for) \d+ (units|pieces|of them|instead))\b/i,
  lead_time: /\b(lead[- ]?time|how long|when (will|can|could|would|do)|how soon|delivery date|arrival date|due date|when.*(arrive|deliver|ready))\b/i,
};

/** True when a message reads as shouting or insulting. WHY plain rules: a supplier reads tone from the words alone. */
export function isRude(text) {
  const t = String(text || "");
  const shouty = (t.match(/\b[A-Z]{4,}\b/g) || []).filter((w) => !["ASAP", "PLEASE", "URGENT"].includes(w)).length;
  return RUDE.test(t) || (t.match(/!/g) || []).length >= 3 || shouty >= 3;
}

/**
 * What a message asks for, and how it is said.
 * @param {string} text Subject and body.
 * @return {{asks: Array<string>, rude: boolean, polite: boolean, po: ?string, qty: ?number, sku: ?string}}
 */
export function readRequest(text) {
  const t = String(text || "");
  const asks = Object.keys(ASKS).filter((k) => ASKS[k].test(t));
  const qty = asks.includes("quantity") ? Number((t.match(/\b(?:to|make it|change it to|for)\s+(\d{1,5})\b/i) || t.match(/\b(\d{1,5})\s+(?:units\s+)?instead\b/i) || [])[1]) || null : null;
  return { asks, rude: isRude(t), polite: POLITE.test(t), po: (t.match(/\bPO-\d+\b/) || [])[0] || null, qty, sku: (t.match(/\bOT-[A-Z0-9-]+\b/) || [])[0] || null };
}

// ---------------------------------------------------------------- memory and capacity

/** Working days (Monday to Friday) after `from` up to and including `to`. */
export function workingDaysBetween(from, to) {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (![0, 6].includes(weekdayOf(d))) n++;
  return n;
}

/**
 * How a supplier feels about the shop today, from the records alone: rude emails and late payments in the last
 * memory_days, agreed changes beyond the free ones in the last changes_days, and polite thank-yous.
 * @return {{score: number, cool: boolean, no_favours: boolean, rude: number, late_payments: number, extra_changes: number, thanks: number, because: Array<string>}}
 */
export function standingOf(state, supplierId, date) {
  const S = RULES.standing, since = addDays(date, -RULES.memory_days), changesSince = addDays(date, -S.changes_days);
  const mine = (state.supplier_requests || []).filter((r) => r.supplier_id === supplierId && r.at.slice(0, 10) >= since && r.at.slice(0, 10) <= date);
  const rude = mine.filter((r) => r.tone === "rude").length;
  const thanks = mine.filter((r) => r.tone === "polite").length;
  const changes = mine.filter((r) => r.decision === "agreed" && ["expedite", "discount", "quantity"].includes(r.kind) && r.at.slice(0, 10) >= changesSince).length;
  const extra = Math.max(0, changes - S.changes_free);
  const late = latePayments(state, supplierId, since, date);
  const score = round(rude * S.rude + late * S.late_payment + extra * S.per_extra_change + Math.min(S.thanks_cap, thanks * S.thanks), 2);
  const because = [
    rude ? `${rude} rude email${rude > 1 ? "s" : ""}` : null,
    late ? `${late} bill${late > 1 ? "s" : ""} paid late` : null,
    extra ? `${changes} changes to orders in ${S.changes_days} days` : null,
  ].filter(Boolean);
  return { score, cool: score <= S.cool_at, no_favours: score <= S.no_favours_at, rude, late_payments: late, extra_changes: extra, thanks, because };
}

/** Bills (received purchase orders) paid, or still unpaid, more than the grace days after the supplier's terms. */
function latePayments(state, supplierId, since, date) {
  const sup = (state.suppliers || []).find((s) => s.id === supplierId);
  const terms = sup?.payment_terms_days ?? 30;
  let n = 0;
  for (const po of state.purchase_orders || []) {
    if (po.supplier_id !== supplierId || !po.received_at) continue;
    const due = addDays(po.received_at.slice(0, 10), terms + RULES.late_payment_grace_days);
    if (due < since || due > date) continue;
    if ((po.paid_at && po.paid_at.slice(0, 10) > due) || (!po.paid_at && date > due)) n++;
  }
  return n;
}

/**
 * How busy a supplier is with the shop's work: a week's capacity in units (its usual order size × capacity_multiple ×
 * any disruption's capacity factor, as simulation/world/suppliers.mjs) against the units on the shop's open orders with it.
 */
export function capacityOf(state, constraints, supplierId, date) {
  const c = constraints?.[supplierId] || { capacity_multiple: 3 };
  // WHY a plain reason for one set in the world settings: a supplier would never say "an experiment".
  const ds = disruptionsOn(state, supplierId, date).map((d) => (d.id ? d : { ...d, reason: SET_REASON }));
  const factor = ds.reduce((n, d) => n * d.capacity_factor, 1);
  const open = (state.purchase_orders || []).filter((p) => p.supplier_id === supplierId && OPEN_PO.includes(p.status));
  const load = open.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.qty, 0), 0);
  const usual = usualOrder(state, { supplier_id: supplierId, ordered_at: `${date}T23:59:59Z`, lines: [] }) || Math.max(1, load);
  const weekly = Math.max(1, usual * c.capacity_multiple * factor);
  return { weekly, load, usual, busy: load > weekly * RULES.busy_share, disruptions: ds };
}

// ---------------------------------------------------------------- changing a purchase order

/**
 * Applies an agreed change to a purchase order: an earlier or later date, a price factor on every line, or a new
 * quantity on one line. The one place the supplier side changes business records; the engine tool
 * apply_supplier_change (infrastructure/engine/suppliers-comms.js) calls it too. Writes po.amendments and an audit line.
 * @param {object} state Engine state.
 * @param {object} po The purchase order (state record).
 * @param {{due?: string, price_factor?: number, sku?: string, qty?: number}} change
 * @param {{at: string, by: string, request?: string, why?: string}} meta
 * @return {Array<string>} What changed, in words.
 */
export function amendPurchaseOrder(state, po, change, meta) {
  const notes = [];
  const field = po.status === "late" ? "expected_at" : "due_at";
  if (change.due && change.due !== po[field]) {
    const old = po[field];
    po[field] = change.due;
    // WHY: the shelf's "back in stock" date follows the order it is waiting for.
    for (const l of po.lines) { const s = state.stock?.[l.sku]; if (s && s.restock_date === old) s.restock_date = change.due; }
    notes.push(`purchase order ${po.number} ${field} ${old} → ${change.due}`);
  }
  if (change.price_factor && change.price_factor !== 1) {
    for (const l of po.lines) {
      const old = l.unit_cost;
      l.unit_cost = round(old * change.price_factor, 2);
      notes.push(`purchase order ${po.number} ${l.sku} unit_cost ${old} → ${l.unit_cost}`);
    }
  }
  if (change.sku && Number.isInteger(change.qty)) {
    const l = po.lines.find((x) => x.sku === change.sku);
    if (l && l.qty !== change.qty) { notes.push(`purchase order ${po.number} ${l.sku} qty ${l.qty} → ${change.qty}`); l.qty = change.qty; }
  }
  if (!notes.length) return notes;
  (po.amendments ||= []).push({ at: meta.at, by: meta.by, request: meta.request || null, why: meta.why || null, changes: notes });
  (state.audit ||= []).push({ at: meta.at, role: "world", customer_id: null, tool: "apply_supplier_change", input: { number: po.number, ...change }, ok: true, error_code: null, changes: notes });
  return notes;
}

// ---------------------------------------------------------------- deciding

const poQty = (po) => po.lines.reduce((n, l) => n + l.qty, 0);
const poValue = (po) => round(po.lines.reduce((n, l) => n + l.qty * l.unit_cost, 0), 2);
const money = (x) => `£${Number(x).toFixed(2)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Why a supplier will not do a favour, in its own words, or null. */
function noFavours(standing) {
  if (!standing.no_favours) return null;
  return `after ${standing.because.join(" and ") || "how things have gone lately"}, we can't make changes to your orders just now`;
}

/** Bring an order forward: needs a lead time worth shortening, spare capacity and goodwill. */
function decideExpedite(ctx, po) {
  const { side, standing, cap, date } = ctx;
  const field = po.status === "late" ? "expected_at" : "due_at";
  if (!OPEN_PO.includes(po.status)) return { decision: "refused", line: `${po.number} has already ${po.status === "received" ? "been delivered" : `been ${po.status.replace(/_/g, " ")}`}, so there is nothing to bring forward.`, reason: "not open" };
  const nf = noFavours(standing);
  if (nf) return { decision: "refused", line: `I'm sorry, but ${nf}. ${po.number} is still due on ${dateWords(po[field])}.`, reason: nf };
  if (!side.expedite_share) return { decision: "refused", line: `I'm afraid ${side.expedite_refusal}.`, reason: side.expedite_refusal };
  if (cap.disruptions.length) {
    const why = cap.disruptions[0].reason;
    return { decision: "refused", line: `I'm sorry, we can't bring ${po.number} forward: ${why}. It is still due on ${dateWords(po[field])}.`, reason: why };
  }
  if (cap.busy) {
    const why = `we are already making ${cap.load} units for you, which is a full week's work for us`;
    return { decision: "refused", line: `I'm sorry, we can't bring ${po.number} forward: ${why}. It is still due on ${dateWords(po[field])}.`, reason: why };
  }
  const lead = ctx.sup.lead_time_days || 7;
  const share = side.expedite_share * (standing.cool ? 0.5 : 1);
  const save = Math.max(1, Math.floor(lead * share));
  const due = [addDays(po[field], -save), addDays(date, 2)].sort().at(-1);
  if (due >= po[field]) return { decision: "refused", line: `${po.number} is already due as soon as we can get it to you, on ${dateWords(po[field])}.`, reason: "already as soon as possible" };
  const days = daysBetween(due, po[field]);
  return { decision: "agreed", change: { due }, line: `We have room this week, so we can bring ${po.number} forward to ${dateWords(due)} (${plural(days, "day")} sooner).`, reason: "spare capacity" };
}

/** Money off for a bigger order: only for orders well above the usual size, and only when relations are good. */
function decideDiscount(ctx, po) {
  const { side, standing, cap } = ctx;
  if (po.status !== "ordered") return { decision: "refused", line: `${po.number} is already ${po.status.replace(/_/g, " ")}, so its price is settled.`, reason: "not open" };
  if (po.amendments?.some((a) => a.request && a.changes.some((c) => c.includes("unit_cost")))) return { decision: "refused", line: `We have already taken money off ${po.number}.`, reason: "already discounted" };
  const nf = noFavours(standing);
  if (nf) return { decision: "refused", line: `I'm sorry, but ${nf}.`, reason: nf };
  const pct = side.volume_discount_percent * (standing.cool ? 0.5 : 1);
  const need = Math.ceil(cap.usual * side.volume_multiple);
  const qty = poQty(po);
  if (!pct || qty < need) {
    return { decision: "refused", line: `We keep our volume price for orders of ${need} units or more, and ${po.number} is ${qty}. If you raise it to ${need}, we can take ${pct}% off.`, reason: `order under ${need} units` };
  }
  const before = poValue(po), after = round(before * (1 - pct / 100), 2);
  return { decision: "agreed", change: { price_factor: 1 - pct / 100 }, line: `For an order this size we can take ${pct}% off: ${po.number} now comes to ${money(after)} (it was ${money(before)}).`, reason: `${qty} units is at least ${need}` };
}

/** A new quantity on one line: only while the order is not yet being made, at or above the minimum, within capacity. */
function decideQuantity(ctx, po, req) {
  const { side, standing, cap, date, sup } = ctx;
  if (po.status !== "ordered") return { decision: "refused", line: `${po.number} is already ${po.status.replace(/_/g, " ")}, so it can't be changed.`, reason: "not open" };
  const line = req.sku ? po.lines.find((l) => l.sku === req.sku) : po.lines.length === 1 ? po.lines[0] : null;
  if (!line) return { decision: "query", line: `${po.number} has ${po.lines.length} lines. Which product would you like to change (${po.lines.map((l) => l.sku).join(", ")})?`, reason: "which line" };
  if (!req.qty) return { decision: "query", line: `How many ${ctx.name(line.sku)} would you like on ${po.number}? It is ${line.qty} at the moment.`, reason: "no number" };
  const nf = noFavours(standing);
  if (nf) return { decision: "refused", line: `I'm sorry, but ${nf}. ${po.number} stays as it is.`, reason: nf };
  const age = daysBetween(po.ordered_at.slice(0, 10), date);
  if (age > side.change_window_days) return { decision: "refused", line: `${po.number} is already being made, so we can't change the quantity now. We can take any extra on a new order.`, reason: `ordered ${age} days ago` };
  if (req.qty < sup.min_order_qty) return { decision: "refused", line: `Our minimum is ${sup.min_order_qty} per line, so we can't take ${line.sku} down to ${req.qty}.`, reason: "under the minimum" };
  const extra = req.qty - line.qty;
  if (extra > 0 && cap.load + extra > cap.weekly) {
    return { decision: "refused", line: `We can't make ${extra} more ${ctx.name(line.sku)} in time for ${po.number}; we could send them on a separate order.`, reason: "no capacity for more" };
  }
  return { decision: "agreed", change: { sku: line.sku, qty: req.qty }, line: `We've changed ${ctx.name(line.sku)} on ${po.number} from ${line.qty} to ${req.qty}. It is still due on ${dateWords(po.due_at)}.`, reason: extra > 0 ? "room for more" : "not yet made" };
}

/** Lead time today: the usual one plus any disruption's extra days, and the order's own date when one is named. */
function answerLeadTime(ctx, po) {
  const extra = ctx.cap.disruptions.reduce((n, d) => n + d.extra_lead_days, 0);
  const base = ctx.sup.lead_time_days;
  const now = extra ? `New orders take about ${plural(base + extra, "day")} at the moment (normally ${base}), because ${ctx.cap.disruptions[0].reason}.` : `New orders take ${plural(base, "day")} from when we get them.`;
  const due = po ? ` ${po.number} is due with you on ${dateWords(po.status === "late" ? po.expected_at || po.due_at : po.due_at)}.` : "";
  return { decision: "answered", line: now + due, reason: extra ? "disruption" : "usual lead time" };
}

// ---------------------------------------------------------------- writing

const GREET = { warm: (n) => `Hello ${n},`, brisk: (n) => `${n},`, formal: (n) => `Dear ${n},`, plain: (n) => `Hi ${n},` };
const SIGN = { warm: "Best wishes,", brisk: "Regards,", formal: "Yours sincerely,", plain: "Thanks," };
const CIVIL = { warm: "I'd ask you to keep things friendly, please.", brisk: "Keep it civil, please.", formal: "I would ask you to keep your emails civil.", plain: "Please keep it polite." };

/** First name of a staff member ("Robinson Crusoe" → "Robinson"); a role or the shop gets a plain hello. */
function nameFor(party) {
  const n = String(party?.name || "");
  if (!n || /\(|&|Coordinator|assistant/i.test(n)) return null;
  return n.split(/\s+/)[0] === "Mr" || n.split(/\s+/)[0] === "Mrs" ? n : n.split(/\s+/)[0];
}

function letter(people, to, lines, { cool = false, civil = false } = {}) {
  const tone = people.tone;
  const n = nameFor(to);
  const open = n ? GREET[tone](n) : "Hello,";
  const body = [...lines, ...(civil ? [CIVIL[tone]] : [])].join("\n\n");
  // WHY no sign-off pleasantry when relations are cool: people write shorter when they are put out.
  return `${open}\n\n${body}\n\n${cool ? "" : `${SIGN[tone]}\n`}${people.contact.name}\n${people.name}`;
}

/** The next EM id, lifted to the highest id in the list first (the comms deriver adds mail without the counter). */
function nextEmailId(state) {
  state.counters ||= {};
  const highest = (state.emails || []).reduce((n, e) => Math.max(n, Number(String(e.id).split("-")[1]) || 0), 0);
  state.counters.EM = Math.max(state.counters.EM || 0, highest) + 1;
  return `EM-${String(state.counters.EM).padStart(6, "0")}`;
}

function nextRequestId(state) {
  state.counters ||= {};
  const highest = (state.supplier_requests || []).reduce((n, r) => Math.max(n, Number(String(r.id).split("-")[1]) || 0), 0);
  state.counters.SR = Math.max(state.counters.SR || 0, highest) + 1;
  return `SR-${String(state.counters.SR).padStart(5, "0")}`;
}

/** A time of day for a supplier's message, keyed by supplier, order, email and date (never a running count). */
function stampFor(seed, people, po, emailId, date) {
  const r = rngFor(seed, "supplier-reply", people.id, po || "-", emailId || "-", date);
  return `${date}T${String(r.int(9, 16)).padStart(2, "0")}:${String(r.int(0, 59)).padStart(2, "0")}:00Z`;
}

/** Puts the supplier's email in the shop's inbox and records what was decided. */
function send(state, { people, to, mailbox, thread, subject, body, at, po, request }) {
  const id = nextEmailId(state);
  (state.emails ||= []).push({
    id, key: `supplier|${request.id}`, thread_id: thread, mailbox, folder: "inbox", from: people.from,
    to: [{ name: to?.name || "Overthought & Co.", address: to?.address || `${mailbox}@${SHOP_DOMAIN}` }], cc: [],
    subject, body, at, read: false, by: null, links: { ...(po ? { po } : {}), supplier_id: people.id, supplier_request: request.id },
  });
  request.reply_id = id;
  return id;
}

function record(state, rec) {
  const r = { id: nextRequestId(state), ...rec };
  (state.supplier_requests ||= []).push(r);
  return r;
}

// ---------------------------------------------------------------- the day's work

/**
 * End of a working day: delay warnings for disruptions that have begun, answers to new purchase orders that need one,
 * and replies to the shop's emails that have waited long enough.
 * @param {object} constraints supplier_constraints from orgsFor(state).
 * @param {object} state Engine state.
 * @param {string} date YYYY-MM-DD.
 * @param {number} seed
 * @param {{products?: Array<object>}=} o The catalogue, for product names in letters.
 * @return {Array<object>} The supplier_requests written today.
 */
export function supplierSideAfterDay(constraints, state, date, seed, { products = null } = {}) {
  if ([0, 6].includes(weekdayOf(date))) return []; // suppliers work Monday to Friday
  state.supplier_requests ||= [];
  const before = state.supplier_requests.length;
  const names = nameMap(products);
  delayWarnings(constraints, state, date, seed);
  newOrderReplies(constraints, state, date, seed, names);
  answerShopMail(constraints, state, date, seed, names);
  return state.supplier_requests.slice(before);
}

function nameMap(products) {
  const m = {};
  for (const p of products || []) {
    for (const v of p.variants || []) m[v.sku] = p.name;
    for (const a of p.accessories || []) m[a.sku] = a.name || p.name;
  }
  return (sku) => m[sku] || sku;
}

function contextFor(constraints, state, sup, date, names) {
  const people = supplierPeople(sup);
  if (!people) return null;
  return { people, sup, side: people.side, date, name: names, standing: standingOf(state, sup.id, date), cap: capacityOf(state, constraints, sup.id, date) };
}

/** Disruptions in force today for a supplier, each with a key, the day it began, its extra days and its reason. */
function disruptionsStarted(state, supplierId, date) {
  const natural = (state.supplier_disruptions || []).filter((d) => d.supplier === supplierId && d.from <= date && d.to >= date)
    .map((d) => ({ key: `disruption|${d.id}`, start: d.from, extra: d.extra_lead_days, reason: d.reason }));
  const set = activeSettings(state, "supplier_disruptions", date).filter((s) => s.supplier === supplierId)
    .map((s) => ({ key: `settings|${supplierId}|${s.from || ""}|${s.to || ""}`, start: s.from || date, extra: s.extra_lead_days ?? 0, reason: SET_REASON }));
  return [...natural, ...set];
}

/**
 * Disruptions in force today that have not yet been written about: open orders raised before the trouble began and due
 * while it lasts move by its extra days, and the supplier says so. (Orders raised during it are moved by
 * simulation/world/suppliers.mjs when they are raised, and explained in newOrderReplies.)
 */
function delayWarnings(constraints, state, date, seed) {
  for (const sup of state.suppliers || []) {
    const people = supplierPeople(sup);
    if (!people) continue;
    for (const d of disruptionsStarted(state, sup.id, date)) {
      if (!d.extra) continue;
      for (const po of state.purchase_orders || []) {
        if (po.supplier_id !== sup.id || !OPEN_PO.includes(po.status) || po.ordered_at.slice(0, 10) >= d.start) continue;
        const field = po.status === "late" ? "expected_at" : "due_at";
        if (!po[field] || po[field] < date) continue;
        const tag = `${d.key}|${po.number}`;
        if (state.supplier_requests.some((r) => r.trigger === tag)) continue;
        const old = po[field], due = addDays(old, d.extra);
        const at = stampFor(seed, people, po.number, d.key, date);
        const req = record(state, { supplier_id: sup.id, po: po.number, kind: "delay_warning", decision: "informed", reason: d.reason, trigger: tag, at, email_id: null });
        amendPurchaseOrder(state, po, { due }, { at, by: people.from.name, request: req.id, why: d.reason });
        req.change = { [field]: { from: old, to: due } };
        const body = letter(people, null, [`I'm sorry to say ${d.reason}. ${po.number} will now come on ${dateWords(due)} instead of ${dateWords(old)}.`, "I'll let you know if anything changes."]);
        send(state, { people, mailbox: "suppliers", thread: `TH-${po.number}`, subject: `${po.number}: a delay`, body, at, po: po.number, request: req });
      }
    }
  }
}

/** Purchase orders raised in the last few days that the supplier has not answered: a query, or a confirmation if none came. */
function newOrderReplies(constraints, state, date, seed, names) {
  const from = addDays(date, -RULES.new_order_reply_days);
  const pos = state.purchase_orders || [];
  for (let i = pos.length - 1; i >= 0; i--) {
    const po = pos[i];
    const day = po.ordered_at?.slice(0, 10);
    if (!day || day < from) { if (day && day < addDays(from, -30)) break; continue; }
    if (po.status !== "ordered" || workingDaysBetween(day, date) < RULES.reply_after_working_days) continue;
    if (state.supplier_requests.some((r) => r.po === po.number && r.kind === "new_order")) continue;
    const sup = (state.suppliers || []).find((s) => s.id === po.supplier_id);
    const ctx = sup && contextFor(constraints, state, sup, date, names);
    if (!ctx) continue;
    const c = constraints?.[sup.id] || {};
    const lines = [], value = poValue(po);
    let decision = "confirmed";
    if (po.world_delay?.days) { lines.push(`Thank you for ${po.number}. We can't have it with you by the usual date: ${po.world_delay.because}. It will be with you on ${dateWords(po.due_at)}.`); decision = "query"; }
    // WHY once a quarter: a supplier mentions its minimum, then lets small orders through rather than nag every time.
    const remindedLately = state.supplier_requests.some((r) => r.supplier_id === sup.id && r.minimum_note && r.at.slice(0, 10) >= addDays(date, -90));
    if (c.minimum_order_value && value < c.minimum_order_value && !remindedLately) {
      lines.push(`${lines.length ? "Also, " : `Thank you for ${po.number}. `}it comes to ${money(value)} and our minimum order is ${money(c.minimum_order_value)}. We'll send it this time, but please keep future orders above that.`);
      decision = "query";
    }
    // WHY: the comms plug-in writes routine confirmations for most orders; a second one would be noise.
    const routine = (state.emails || []).some((e) => e.key === `po|${po.number}|sent` || e.key === `po|${po.number}|confirmed`);
    if (!lines.length && routine) continue;
    if (!lines.length) lines.push(`Thank you for ${po.number}. It is booked in and due with you on ${dateWords(po.due_at)}.`);
    const at = stampFor(seed, ctx.people, po.number, "new-order", date);
    const minimumNote = lines.some((l) => l.includes("our minimum order"));
    const req = record(state, { supplier_id: sup.id, po: po.number, kind: "new_order", decision, reason: decision === "query" ? lines.join(" ") : "confirmed", at, email_id: null, ...(minimumNote ? { minimum_note: true } : {}) });
    send(state, { people: ctx.people, mailbox: "suppliers", thread: `TH-${po.number}`, subject: `Re: ${po.number}`, body: letter(ctx.people, null, lines, { cool: ctx.standing.cool }), at, po: po.number, request: req });
  }
}

/** The shop's emails to a supplier (sent through the tools) that have waited long enough: read, decide, reply. */
function answerShopMail(constraints, state, date, seed, names) {
  const emails = state.emails || [];
  const handled = new Set(state.supplier_requests.filter((r) => r.email_id).map((r) => r.email_id));
  const waiting = [];
  for (let i = emails.length - 1, n = 0; i >= 0 && n < SCAN_BACK; i--, n++) {
    const e = emails[i];
    if (e.folder !== "sent" || !String(e.key || "").startsWith("tool|") || handled.has(e.id) || e.at.slice(0, 10) >= date) continue;
    const sup = [...(e.to || []), ...(e.cc || [])].map((p) => supplierByAddress(state, p.address)).find(Boolean);
    if (sup) waiting.push({ e, sup });
  }
  // WHY oldest first: a supplier reads its mail in the order it came.
  waiting.sort((a, b) => (a.e.at === b.e.at ? (a.e.id < b.e.id ? -1 : 1) : a.e.at < b.e.at ? -1 : 1));
  for (const { e, sup } of waiting) {
    const ctx = contextFor(constraints, state, sup, date, names);
    if (!ctx) continue;
    const delay = ctx.standing.cool ? RULES.slow_reply_after_working_days : RULES.reply_after_working_days;
    if (workingDaysBetween(e.at.slice(0, 10), date) < delay) continue;
    replyTo(state, ctx, e, seed);
  }
}

/** One reply to one email from the shop. */
function replyTo(state, ctx, e, seed) {
  const text = `${e.subject || ""}\n${e.body || ""}`;
  const req = readRequest(text);
  const tone = req.rude ? "rude" : req.polite ? "polite" : "plain";
  const poNo = req.po || e.links?.po || null;
  let po = poNo ? (state.purchase_orders || []).find((p) => p.number === poNo) : null;
  const open = (state.purchase_orders || []).filter((p) => p.supplier_id === ctx.sup.id && OPEN_PO.includes(p.status));
  if (!po && !poNo && open.length === 1) po = open[0]; // the only order open with them: that is the one meant
  const at = stampFor(seed, ctx.people, po?.number || poNo, e.id, ctx.date);
  const base = { supplier_id: ctx.sup.id, po: po?.number || poNo, email_id: e.id, tone, at };
  const results = [];
  if (poNo && (!po || po.supplier_id !== ctx.sup.id)) {
    results.push({ kind: "query", decision: "query", line: `I can't find ${poNo} among your orders with us. Could you check the number?`, reason: "not our order" });
  } else if (!req.asks.length) {
    if (req.polite && !req.rude && /thank/i.test(text) && text.length < 600) { record(state, { ...base, kind: "thanks", decision: "noted", reason: "a thank-you" }); return; }
    results.push({ kind: "query", decision: "query", line: `Thanks for your email${po ? ` about ${po.number}` : ""}. Could you tell me what you need: an earlier date, a different quantity, a price for a bigger order, or our lead times?`, reason: "unclear request" });
  } else {
    for (const ask of req.asks) {
      if (ask === "lead_time") { results.push({ kind: ask, ...answerLeadTime(ctx, po) }); continue; }
      if (!po) { results.push({ kind: ask, decision: "query", line: `Which order do you mean? You have ${plural(open.length, "open order")} with us${open.length ? ` (${open.map((p) => p.number).join(", ")})` : ""}.`, reason: "which order" }); continue; }
      const d = ask === "expedite" ? decideExpedite(ctx, po) : ask === "discount" ? decideDiscount(ctx, po) : decideQuantity(ctx, po, req);
      results.push({ kind: ask, ...d });
    }
  }
  const recs = [];
  for (const r of results) {
    const rec = record(state, { ...base, kind: r.kind, decision: r.decision, reason: r.reason });
    if (r.decision === "agreed" && po) {
      const notes = amendPurchaseOrder(state, po, r.change, { at, by: ctx.people.from.name, request: rec.id, why: r.reason });
      rec.change = r.change; rec.changes = notes;
    }
    recs.push(rec);
  }
  // Tone is counted once per email, on the first record (standingOf counts records).
  for (const r of recs.slice(1)) r.tone = "plain";
  const subject = /^re:/i.test(e.subject || "") ? e.subject : `Re: ${e.subject || po?.number || "your email"}`;
  const body = letter(ctx.people, e.from, results.map((r) => r.line), { cool: ctx.standing.cool || req.rude, civil: req.rude });
  const reply = { people: ctx.people, to: e.from, mailbox: e.mailbox, thread: e.thread_id, subject, body, at, po: po?.number || poNo, request: recs[0] };
  send(state, reply);
  for (const r of recs.slice(1)) r.reply_id = recs[0].reply_id;
}

// ---------------------------------------------------------------- for the simulator and the lab

/**
 * Supplier emails waiting for the shop: unread, written by the supplier side in the last three days.
 * @return {Array<{id: string, from: string, subject: string, po: ?string, at: string}>}
 */
export function supplierMailWaiting(state, date) {
  const from = addDays(date, -3), out = [];
  const emails = state.emails || [];
  for (let i = emails.length - 1, n = 0; i >= 0 && n < SCAN_BACK; i--, n++) {
    const e = emails[i];
    if (e.folder !== "inbox" || e.read || !String(e.key || "").startsWith("supplier|") || e.at.slice(0, 10) < from) continue;
    out.push({ id: e.id, mailbox: e.mailbox, from: e.from.name, subject: e.subject, po: e.links?.po || null, at: e.at });
  }
  return out.reverse();
}

/** The work message a connected buyer AI is sent when supplier mail is waiting. */
export function supplierMailMessage(date, waiting) {
  return `Supplier mail for ${date}: ${plural(waiting.length, "unread email")} from suppliers (list_emails with mailbox "suppliers" and unread true). Read each (get_email_thread), reply where it needs an answer (send_email with reply_to_id), and mark it read (mark_email). Suppliers answer on the next working day.`;
}
