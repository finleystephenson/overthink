// The company's mail, staff chat and two social accounts, written from the business records.
//
// deriveComms(state, { from, to, seed, data }) is pure and repeatable:
//  - it reads the commerce records in `state` and the template banks in `data`;
//  - every message is drawn from a random stream keyed by the record it is about (an order number,
//    a purchase order, a date), never by a running count, so a window of five days gives the
//    same messages as the same five days inside the whole history;
//  - it only adds messages. It never changes a commerce record.
// There are no Node imports here, so it also runs in a browser.
import { rngFor, hashString } from "./rng.mjs";

const DOMAIN = "overthought.example";
const SHOP_NAME = "Overthought & Co.";
const SHARED_BOXES = ["hello", "orders", "suppliers", "accounts", "press"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_MS = 86400000;
/** How far back an event can start and still have messages inside a window (a late parcel, a slow reply). */
const LOOKBACK_DAYS = 75;

// ---------------------------------------------------------------- small helpers

const dayOf = (iso) => String(iso).slice(0, 10);
const msOf = (iso) => Date.parse(String(iso).length === 10 ? `${iso}T00:00:00Z` : iso);
const isoOfMs = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
// WHY: date arithmetic is the hottest thing in the deriver (every day looks back over dozens of days), so results are remembered.
const ADD_MEMO = new Map();
function addDays(date, n) {
  const key = `${date}|${n}`;
  let v = ADD_MEMO.get(key);
  if (v === undefined) {
    v = dayOf(isoOfMs(msOf(date) + n * DAY_MS));
    if (ADD_MEMO.size > 300000) ADD_MEMO.clear();
    ADD_MEMO.set(key, v);
  }
  return v;
}
const WEEKDAY_MEMO = new Map();
function weekday(date) {
  let v = WEEKDAY_MEMO.get(date);
  if (v === undefined) { v = new Date(`${date}T00:00:00Z`).getUTCDay(); WEEKDAY_MEMO.set(date, v); }
  return v;
}
const isWorkday = (date) => weekday(date) >= 1 && weekday(date) <= 5;
/** The one money formatter: £1,589.25 with pence, £1,589 without. Used wherever a figure is spoken in mail or chat. */
function money(n) {
  const cents = Math.round(Math.abs(Number(n)) * 100);
  const pounds = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const pence = cents % 100;
  return `${Number(n) < 0 ? "-" : ""}£${pounds}${pence ? `.${String(pence).padStart(2, "0")}` : ""}`;
}
const pad = (n) => String(n).padStart(2, "0");
const HONORIFICS = new Set(["Mr", "Mrs", "Miss", "Ms", "Dr", "Sir", "Lady", "Lord", "Professor", "Madame", "Monsieur", "Captain", "Count", "Countess", "Queen", "King", "Princess", "Prince", "Don", "Dame", "Saint", "Father", "Mother", "Brother", "Sister", "Uncle", "Aunt", "Old", "Baron", "Duke", "Duchess"]);
/** Kept with their surname when greeting: "Mr Toad", "Captain Hook". The royal ones take the name that follows: "Queen Medb" is "Medb". */
const PARTICLES = new Set(["de", "la", "le", "van", "von", "der", "den", "du", "di", "da", "del", "el", "al"]);
const KEEP_TITLE = new Set(["Mr", "Mrs", "Miss", "Ms", "Dr", "Sir", "Lady", "Lord", "Professor", "Madame", "Monsieur", "Captain", "Count", "Countess", "Baron", "Duke", "Duchess", "Dame", "Saint", "Father", "Mother", "Brother", "Sister", "Uncle", "Aunt", "Old"]);

/**
 * The short name to greet someone by. Handles titles ("Mrs Hudson"), royalty ("Queen Medb" -> "Medb"),
 * names that are a title and a place ("Queen of Hearts" stays whole) and "The ..." names.
 * @param {string} name A character's full name.
 * @returns {string} A greeting name, never empty and never ending in "of" or "the".
 */
export function shortName(name) {
  let parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "there";
  // WHY: "The Big Bad Wolf" is a title, not a first name and a surname.
  if (parts[0] === "The" && parts.length > 1) return parts.slice(1).join(" ");
  if (parts.length === 1) return parts[0];
  if (parts.slice(1).some((w) => w.toLowerCase() === "of")) return parts.join(" ");
  if (HONORIFICS.has(parts[0])) {
    let end = 1;
    while (end < parts.length - 1 && PARTICLES.has(parts[end].toLowerCase())) end++;
    if (KEEP_TITLE.has(parts[0])) return parts.slice(0, end + 1).join(" ");
    return parts[1];
  }
  return parts[0];
}
const firstWord = shortName;
const humanDate = (date) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

/** The next Monday-to-Friday date on or after `date`. WHY: staff do not chat or send mail at weekends. */
function workdayOn(date) {
  let d = date;
  while (!isWorkday(d)) d = addDays(d, 1);
  return d;
}

/** A time on `date` between two hours (decimal, e.g. 9.5 is 09:30), as an ISO string. */
function timeOn(date, rng, h0 = 9, h1 = 17) {
  const minutes = Math.floor(h0 * 60 + rng.next() * (h1 - h0) * 60);
  return `${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:${pad(rng.int(0, 59))}Z`;
}

const plusMinutes = (iso, n) => isoOfMs(msOf(iso) + n * 60000);

/** Moves a time into working hours (a weekday, 09:00 to 17:00). WHY: people write replies in the day, not at 2am. */
function inWorkHours(iso, rng) {
  const day = dayOf(iso), hour = Number(iso.slice(11, 13));
  if (isWorkday(day) && hour >= 9 && hour < 17) return iso;
  const target = isWorkday(day) && hour < 9 ? day : workdayOn(addDays(day, 1));
  return timeOn(target, rng, 9, 10.5);
}

/** "1 order", "3 orders". */
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Singular after a one: "1 days" becomes "1 day". WHY: slots are filled with plain numbers, so agreement is fixed here. */
const SINGULARS = { days: "day", items: "item", lines: "line", orders: "order", minutes: "minute", hours: "hour", visitors: "visitor", nights: "night", reviews: "review", subscribers: "subscriber", things: "thing", parcels: "parcel", weeks: "week" };
const fixPlurals = (text) => text.replace(/\b1 (days|items|lines|orders|minutes|hours|visitors|nights|reviews|subscribers|things|parcels|weeks)\b/g, (m, w) => `1 ${SINGULARS[w]}`);

/** Replaces {slot} with its value. A slot that is missing stays visible, so tests catch it. */
function fill(text, slots) {
  return fixPlurals(String(text).replace(/\{(\w+)\}/g, (m, k) => (slots[k] === undefined || slots[k] === null ? m : String(slots[k]))));
}

/** "The Spare Sock" -> "Spare Sock". WHY: customers write "a good Spare Sock", not "a good The Spare Sock". */
const plain = (name) => String(name).replace(/^The /, "");
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Dates from `from` to `to` inclusive. */
function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const tailNumber = (id) => Number(String(id).split("-").pop()) || 0;
const maxTail = (list) => (list || []).reduce((n, r) => Math.max(n, tailNumber(r.id)), 0);

// ---------------------------------------------------------------- people and addresses

/** The staff mailbox name: the last word of the name, lower case ("Mr Fezziwig" -> "fezziwig"). */
export function mailboxOf(staff) {
  return String(staff.name).split(" ").pop().toLowerCase();
}

const address = (box) => `${box}@${DOMAIN}`;
const shopParty = (box) => ({ name: SHOP_NAME, address: address(box) });

function staffParty(staff) {
  return { name: staff.name, address: address(mailboxOf(staff)) };
}

function customerParty(customer) {
  return { name: customer.name, address: customer.email };
}

function supplierParty(supplier, who = "Sales desk") {
  // WHY: the address must match who is writing: accounts mail comes from accounts@, orders from orders@, at the supplier's own made-up domain.
  return { name: `${who}, ${supplier.name}`, address: `${who === "Accounts" ? "accounts" : "orders"}@${slug(supplier.name)}.example` };
}

/** A social handle for a customer. WHY: the same customer always gets the same handle. */
function handleFor(customer, bits) {
  const parts = customer.name.toLowerCase().replace(/[^a-z ]/g, "").split(" ").filter(Boolean);
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  const h = hashString(customer.id);
  const first = unique[0] || "person";
  const last = unique[unique.length - 1];
  const bit = bits[h % bits.length];
  // WHY: a one-word name must not become "macbethmacbeth".
  const styles = unique.length > 1
    ? [`${first}${last}`, `${first}_${last}`, `${first}.${last}`, `${bit}${first}`, `${first}${last}${h % 90 + 10}`]
    : [first, `${bit}${first}`, `${first}${h % 90 + 10}`, `${first}_${bit}`, `the${first}`];
  return styles[(h >>> 4) % styles.length];
}

function indexBy(list, key) {
  const map = new Map();
  for (const r of list || []) map.set(r[key], r);
  return map;
}

// ---------------------------------------------------------------- the context every generator shares

// Everything built from the whole history is built once per state object and then only topped up, so a
// one-day call costs in proportion to that day's records. WHY: the simulator calls deriveComms every
// simulated day; scanning five years of orders each time was far too slow. Lists are assumed to grow by
// appending (records are changed in place but not removed), which is how the engine and simulator work.
const CACHES = new WeakMap();

function cacheFor(state) {
  let c = CACHES.get(state);
  if (!c) { c = { maps: {}, buckets: {}, seeds: new Map(), byCustomer: null, join: null, firstOrderDay: null, firstSale: new Map(), social: null, messages: {}, emailConvCases: null }; CACHES.set(state, c); }
  return c;
}

/** A Map of key -> record that only reads the records added since the last call. */
function mapIndex(cache, name, list, field) {
  let m = cache.maps[name];
  if (!m || m.list !== list) m = cache.maps[name] = { list, n: 0, map: new Map() };
  for (; m.n < list.length; m.n++) m.map.set(list[m.n][field], list[m.n]);
  return m.map;
}

/** Records grouped by day (or any key), topped up from the end of the list. */
function bucketIndex(cache, name, list, keyOf) {
  let b = cache.buckets[name];
  if (!b || b.list !== list) b = cache.buckets[name] = { list, n: 0, days: new Map() };
  for (; b.n < list.length; b.n++) {
    const k = keyOf(list[b.n]);
    if (!b.days.has(k)) b.days.set(k, []);
    b.days.get(k).push(list[b.n]);
  }
  return b.days;
}

/** Which list is bucketed by which date. Only records dated in the look-back window are ever visited. */
const BUCKETS = {
  orders: (o) => dayOf(o.placed_at), contacts: (c) => dayOf(c.at), conversations: (v) => dayOf(v.started_at),
  purchase_orders: (p) => dayOf(p.ordered_at), cases: (k) => dayOf(k.opened_at), reviews: (r) => r.date,
  returns: (r) => dayOf(r.created_at), stock_counts: (c) => dayOf(c.at),
};

/** The records of one list dated from the start of the look-back to the end of the window. */
function recentList(ctx, name, back = LOOKBACK_DAYS) {
  const days = bucketIndex(ctx.cache, name, ctx.state[name] || [], BUCKETS[name]);
  const out = [];
  for (let d = addDays(ctx.from, -back); d <= ctx.to; d = addDays(d, 1)) { const l = days.get(d); if (l) for (const r of l) out.push(r); }
  return out;
}

/** Records of a list for one day. */
function onDay(ctx, name, day) {
  return bucketIndex(ctx.cache, name, ctx.state[name] || [], BUCKETS[name]).get(day) || [];
}

/** Keeps the per-customer order lists, the join-date list, first sale dates and the first order day up to date. */
function syncOrderIndexes(ctx) {
  const c = ctx.cache, st = ctx.state;
  const orders = st.orders || [];
  if (!c.byCustomer || c.byCustomer.list !== orders) c.byCustomer = { list: orders, n: 0, map: new Map() };
  if (c.firstOrderDay === null || c.byCustomer.n === 0) { c.firstOrderDay = null; c.firstSale = new Map(); }
  for (; c.byCustomer.n < orders.length; c.byCustomer.n++) {
    const o = orders[c.byCustomer.n], day = dayOf(o.placed_at);
    if (!c.byCustomer.map.has(o.customer_id)) c.byCustomer.map.set(o.customer_id, []);
    const list = c.byCustomer.map.get(o.customer_id);
    let i = list.length;
    while (i > 0 && list[i - 1].placed_at > o.placed_at) i--;
    list.splice(i, 0, o);
    if (c.firstOrderDay === null || day < c.firstOrderDay) c.firstOrderDay = day;
    for (const item of o.items) { const id = ctx.productId(item); if (id && (!c.firstSale.has(id) || day < c.firstSale.get(id))) c.firstSale.set(id, day); }
  }
  const customers = st.customers || [];
  if (!c.join || c.join.list !== customers) c.join = { list: customers, n: 0, sorted: [] };
  for (; c.join.n < customers.length; c.join.n++) {
    const cu = customers[c.join.n], arr = c.join.sorted;
    let i = arr.length;
    while (i > 0 && arr[i - 1].created_at > cu.created_at) i--;
    arr.splice(i, 0, cu);
  }
  const convs = st.conversations || [];
  if (!c.emailConvCases || c.emailConvCases.list !== convs) c.emailConvCases = { list: convs, n: 0, set: new Set() };
  for (; c.emailConvCases.n < convs.length; c.emailConvCases.n++) if (convs[c.emailConvCases.n].channel === "email") c.emailConvCases.set.add(convs[c.emailConvCases.n].case_number);
}

/** Builds lookups for one call; the heavy ones come from the cache. */
function makeContext(state, { from, to, seed, data }) {
  const staff = data.staff;
  const cache = cacheFor(state);
  const ctx = {
    state, from, to, seed, data, cache,
    staffById: new Map(staff.map((s) => [s.id, s])),
    staffNames: new Set(staff.map((s) => s.name)),
    customers: mapIndex(cache, "customers", state.customers || [], "id"),
    orders: mapIndex(cache, "orders", state.orders || [], "number"),
    suppliers: mapIndex(cache, "suppliers", state.suppliers || [], "id"),
    campaigns: mapIndex(cache, "campaigns", state.campaigns || [], "id"),
    cases: mapIndex(cache, "cases", state.cases || [], "number"),
    contacts: mapIndex(cache, "contacts", state.contacts || [], "id"),
    ledger: mapIndex(cache, "ledger", state.ledger || [], "id"),
    pos: mapIndex(cache, "pos", state.purchase_orders || [], "number"),
    reviews: mapIndex(cache, "reviews", state.reviews || [], "id"),
    emails: [], chat: [], social: [], stats: [],
  };
  ctx.lowerFrom = addDays(from, -LOOKBACK_DAYS);
  ctx.productName = (item) => data.skuProduct?.[item.sku]?.name || String(item.name).split(",")[0];
  ctx.productId = (item) => data.skuProduct?.[item.sku]?.id || null;
  syncOrderIndexes(ctx);
  ctx.ordersByCustomer = cache.byCustomer.map;
  ctx.customersByJoin = cache.join.sorted;
  ctx.firstSale = cache.firstSale;
  ctx.staffRole = (id) => ctx.staffById.get(id)?.role;
  return ctx;
}

/** True when a message belongs in this window. Nothing is written for a time that has not happened yet. */
/** True for a time that has not happened yet, when the window runs over several days and ends on today's date. */
const isFuture = (ctx, iso) => {
  const now = ctx.state.now;
  return !!now && ctx.from < ctx.to && ctx.to === dayOf(now) && iso > now;
};
const inWindow = (ctx, iso) => dayOf(iso) >= ctx.from && dayOf(iso) <= ctx.to && !isFuture(ctx, iso);
const recent = (ctx, iso) => dayOf(iso) >= ctx.lowerFrom && dayOf(iso) <= ctx.to;

// ---------------------------------------------------------------- record makers

/** Adds one email. Records are filtered by the window and numbered at the end. */
function addEmail(ctx, r) {
  const rec = {
    key: r.key, thread_id: `TH-${r.thread}`, mailbox: r.mailbox, folder: r.folder,
    from: r.from, to: r.to, cc: r.cc || [], subject: r.subject, body: r.body, at: r.at,
    read: r.read !== false, by: r.by || null, links: r.links || {},
  };
  if (r.bundle) rec.bundle = r.bundle;
  if (inWindow(ctx, rec.at)) ctx.emails.push(rec);
}

/** Unread means a recent inbox mail. WHY: the newest day or two of an inbox is the only part still unread. */
function isUnread(ctx, at, rng, chance = 0.7) {
  const nowDay = dayOf(ctx.state.now || ctx.to);
  return msOf(nowDay) - msOf(dayOf(at)) <= DAY_MS && rng.chance(chance);
}

/** One mail between staff: a copy in the sender's sent folder and one in each recipient's inbox. */
function addInternalMail(ctx, { key, thread, from, to, cc = [], subject, body, at, links }) {
  const sender = ctx.staffById.get(from);
  const rng = rngFor(ctx.seed, "internal-read", key);
  addEmail(ctx, { key: `${key}|sent`, thread, mailbox: mailboxOf(sender), folder: "sent", from: staffParty(sender), to: to.map((id) => staffParty(ctx.staffById.get(id))), cc: cc.map((id) => staffParty(ctx.staffById.get(id))), subject, body, at, by: from, links });
  for (const id of [...to, ...cc]) {
    const person = ctx.staffById.get(id);
    addEmail(ctx, { key: `${key}|in|${id}`, thread, mailbox: mailboxOf(person), folder: "inbox", from: staffParty(sender), to: to.map((t) => staffParty(ctx.staffById.get(t))), cc: cc.map((t) => staffParty(ctx.staffById.get(t))), subject, body, at, read: !isUnread(ctx, at, rng), by: from, links });
  }
}

function chatRec(ctx, r) {
  return {
    key: r.key, channel: r.channel || null, dm: r.dm || null, from: r.from, from_name: ctx.staffById.get(r.from)?.name || r.from,
    text: r.text, at: r.at, parent_key: r.parent_key || null, reactions: r.reactions || [], links: r.links || {},
  };
}

function addChat(ctx, r) {
  const rec = chatRec(ctx, r);
  if (inWindow(ctx, rec.at)) ctx.chat.push(rec);
}

function socialRec(r) {
  return {
    key: r.key, network: r.network, author: r.author, kind: r.kind, text: r.text, image: r.image || null, at: r.at,
    likes: r.likes || 0, reposts: r.reposts || 0, parent_key: r.parent_key || null, thread: r.thread || null, by: r.by || (r.author.kind === "company" ? "S-10" : null),
    mentions_shop: !!r.mentions_shop, links: r.links || {},
  };
}

function addSocial(ctx, r) {
  const rec = socialRec(r);
  if (inWindow(ctx, rec.at)) ctx.social.push(rec);
}

// ---------------------------------------------------------------- mail: orders

const ORDER_CONFIRM_BIG = 60;
const ORDER_CONFIRM_SMALL_CHANCE = 0.12;
const DISPATCH_CHANCE_SPECIAL = 0.5;
const DISPATCH_CHANCE_PLAIN = 0.1;
const CANCEL_MAIL_CHANCE = 0.6;

function orderSlots(ctx, o, c) {
  const lines = o.items.map((i) => `  ${i.qty} x ${i.name}  ${money(i.unit_price * i.qty)}`).join("\n");
  const a = o.delivery?.address || {};
  return {
    first: firstWord(c.name), order: o.number, items: lines, total: money(o.totals.total),
    address: [a.line1, a.town, a.postcode].filter(Boolean).join(", "), name: c.name, email: c.email,
  };
}

function orderSign(rng, bank) {
  return `The orders desk\n${SHOP_NAME}\n\n${rng.pick(bank.footnotes)}`;
}

function isChilled(o) {
  return o.delivery?.method === "chilled";
}

function orderMails(ctx) {
  const bank = ctx.data.mail_system;
  for (const o of recentList(ctx, "orders")) {
    const c = ctx.customers.get(o.customer_id);
    if (!c || !c.email) continue;
    const rng = rngFor(ctx.seed, "mail-order", o.number);
    const slots = orderSlots(ctx, o, c);
    slots.sign = orderSign(rng, bank.order_confirmation);
    const links = { customer_id: c.id, order: o.number };
    const base = { thread: o.number, mailbox: "orders", folder: "sent", from: shopParty("orders"), to: [customerParty(c)], links };
    const special = isChilled(o) || o.totals.total >= ORDER_CONFIRM_BIG;
    if (o.status === "payment_failed") {
      const t = bank.payment_failed;
      addEmail(ctx, { ...base, key: `order|${o.number}|failed`, subject: fill(rng.pick(t.subjects), slots), body: fill(rng.pick(t.bodies), slots), at: plusMinutes(o.placed_at, rng.int(3, 30)) });
      continue;
    }
    if (special || rng.chance(ORDER_CONFIRM_SMALL_CHANCE)) {
      const t = bank.order_confirmation;
      addEmail(ctx, { ...base, key: `order|${o.number}|confirm`, subject: fill(rng.pick(t.subjects), slots), body: fill(rng.pick(t.bodies), slots), at: plusMinutes(o.placed_at, rng.int(2, 25)) });
    }
    if (o.status === "cancelled" && rng.chance(CANCEL_MAIL_CHANCE)) {
      const t = bank.order_cancelled;
      const ev = (o.history || []).find((h) => /cancel/i.test(h.event));
      addEmail(ctx, { ...base, key: `order|${o.number}|cancel`, subject: fill(rng.pick(t.subjects), slots), body: fill(rng.pick(t.bodies), slots), at: plusMinutes(ev ? ev.at : o.placed_at, rng.int(5, 60)) });
    }
    for (const s of o.shipments || []) {
      if (!s.dispatched_at) continue;
      if (!rng.chance(special ? DISPATCH_CHANCE_SPECIAL : DISPATCH_CHANCE_PLAIN)) continue;
      const t = bank.order_dispatch;
      const sl = { ...slots, carrier: s.carrier, tracking: s.tracking, eta: s.eta ? humanDate(s.eta) : "the date on your order page" };
      const bodies = isChilled(o) ? [...t.chilled, ...t.chilled, ...t.bodies] : t.bodies;
      addEmail(ctx, { ...base, key: `order|${o.number}|dispatch|${s.id}`, subject: fill(rng.pick(t.subjects), sl), body: fill(rng.pick(bodies), sl), at: plusMinutes(s.dispatched_at, rng.int(1, 40)) });
    }
  }
}

// ---------------------------------------------------------------- mail: customers writing in

/** "Customer reports X" becomes "I report X". Anything else is left out. */
function firstPerson(summary) {
  if (!summary) return "";
  const m = String(summary).match(/^Customer (says|reports|asks|wants|thinks|complains) (that )?(.*)$/i);
  if (!m) return "";
  const verb = { says: "say", reports: "report", asks: "ask", wants: "want", thinks: "think", complains: "complain" }[m[1].toLowerCase()];
  const rest = m[3].replace(/\bher\b/g, "my").replace(/\bhis\b/g, "my");
  return `I ${verb} ${/^(about|that)/.test(rest) ? "" : "that "}${rest}`.replace(/\s+/g, " ");
}

/** Which order a contact is about: the case's order, else the customer's latest before the contact. */
function orderForContact(ctx, contact) {
  const k = contact.case_number ? ctx.cases.get(contact.case_number) : null;
  if (k?.related?.order && ctx.orders.get(k.related.order)) return ctx.orders.get(k.related.order);
  const list = ctx.ordersByCustomer.get(contact.customer_id) || [];
  let found = null;
  for (const o of list) if (o.placed_at <= contact.at) found = o;
  return found || list[0] || null;
}

function replierFor(ctx, contact, rng) {
  if (contact.handled_by === "support_lead") return "S-06";
  if (contact.handled_by === "support_agent") return rng.pick(["S-07", "S-08"]);
  return "assistant";
}

function replyBody(ctx, topic, who, slots, rng) {
  const bank = ctx.data.mail_customer;
  const replies = bank.replies[topic] || bank.replies.default;
  const sign = who === "assistant" ? rng.pick(bank.signoffs.assistant) : rng.pick(bank.signoffs[who]);
  const quirk = bank.quirks[who] && rng.chance(0.3) ? `\n\n${rng.pick(bank.quirks[who])}` : "";
  return fill(`${rng.pick(bank.reply_greetings)}\n\n${rng.pick(replies)}${quirk}\n\n${sign}`, slots);
}

function customerMails(ctx) {
  const bank = ctx.data.mail_customer;
  const emailConvCases = ctx.cache.emailConvCases.set;
  for (const contact of recentList(ctx, "contacts")) {
    if (contact.channel !== "email") continue;
    if (contact.case_number && emailConvCases.has(contact.case_number)) continue;
    const c = ctx.customers.get(contact.customer_id);
    if (!c || !c.email) continue;
    const rng = rngFor(ctx.seed, "mail-contact", contact.id);
    const topic = bank.topics[contact.topic] ? contact.topic : "product_question";
    const t = bank.topics[topic];
    const o = orderForContact(ctx, contact);
    const days = o ? Math.max(1, Math.round((msOf(contact.at) - msOf(o.placed_at)) / DAY_MS)) : 3;
    const slots = {
      first: firstWord(c.name), name: c.name, email: c.email, days,
      order: o ? o.number : "my last order", product: o ? ctx.productName(o.items[0]) : "the thing I ordered",
    };
    const own = firstPerson(contact.summary);
    const parts = [rng.pick(bank.greetings), fill(rng.pick(t.bodies), slots)];
    if (own) parts.push(own + ".");
    if (rng.chance(0.4)) parts.push(fill(rng.pick(bank.extras), slots));
    parts.push(`${rng.pick(bank.closers)}\n${c.name}`);
    const links = { customer_id: c.id, contact_id: contact.id };
    if (o) links.order = o.number;
    if (contact.case_number) links.case = contact.case_number;
    const subject = fill(rng.pick(t.subjects), slots);
    addEmail(ctx, {
      key: `contact|${contact.id}|in`, thread: contact.id, mailbox: "hello", folder: "inbox", from: customerParty(c),
      to: [shopParty("hello")], subject, body: parts.join("\n\n"), at: contact.at, links,
      read: !isUnread(ctx, contact.at, rng),
    });
    if (contact.first_reply_minutes === null || contact.first_reply_minutes === undefined) continue;
    const who = replierFor(ctx, contact, rng);
    const sender = who === "assistant" ? { name: `${SHOP_NAME} customer care`, address: address("hello") } : { name: ctx.staffById.get(who).name, address: address("hello") };
    addEmail(ctx, {
      key: `contact|${contact.id}|reply`, thread: contact.id, mailbox: "hello", folder: "sent", from: sender,
      to: [customerParty(c)], subject: `Re: ${subject}`, body: replyBody(ctx, topic, who, slots, rng),
      at: who === "assistant" ? plusMinutes(contact.at, Math.max(3, contact.first_reply_minutes)) : inWorkHours(plusMinutes(contact.at, Math.max(3, contact.first_reply_minutes)), rng), by: who === "assistant" ? null : who, links,
    });
  }
}

/** Email conversations already hold their own words; they become threads as written. */
function conversationMails(ctx) {
  for (const v of recentList(ctx, "conversations")) {
    if (v.channel !== "email") continue;
    const c = ctx.customers.get(v.customer_id);
    if (!c || !c.email) continue;
    const k = v.case_number ? ctx.cases.get(v.case_number) : null;
    const subject = k ? k.subject : v.summary;
    const links = { customer_id: c.id, conversation_id: v.id };
    if (v.case_number) links.case = v.case_number;
    if (k?.related?.order && ctx.orders.get(k.related.order)) links.order = k.related.order;
    (v.messages || []).forEach((m, i) => {
      const fromCustomer = m.from === "customer";
      addEmail(ctx, {
        key: `conv|${v.id}|${i}`, thread: v.id, mailbox: "hello", folder: fromCustomer ? "inbox" : "sent",
        from: fromCustomer ? customerParty(c) : { name: `${SHOP_NAME} customer care`, address: address("hello") },
        to: fromCustomer ? [shopParty("hello")] : [customerParty(c)], subject: i === 0 ? subject : `Re: ${subject}`,
        body: m.text, at: m.at, links, read: true,
      });
    });
  }
}

// ---------------------------------------------------------------- mail: suppliers

function poTotal(po) {
  return Math.round(po.lines.reduce((n, l) => n + (l.qty_received ?? l.qty) * l.unit_cost, 0) * 100) / 100;
}

function poLines(ctx, po) {
  return po.lines.map((l) => `  ${l.qty} x ${ctx.data.skuProduct?.[l.sku]?.name || l.sku} (${l.sku}) at ${money(l.unit_cost)}`).join("\n");
}

function supplierMails(ctx) {
  const bank = ctx.data.mail_system.supplier;
  const buyer = ctx.staffById.get("S-09");
  for (const po of recentList(ctx, "purchase_orders", 150)) {
    if (dayOf(po.ordered_at) > ctx.to) continue;
    const sup = ctx.suppliers.get(po.supplier_id);
    if (!sup) continue;
    const rng = rngFor(ctx.seed, "mail-po", po.number);
    const slots = {
      po: po.number, supplier: sup.name, supplier_short: sup.name, due: humanDate(po.due_at), lines: poLines(ctx, po),
      amount: money(poTotal(po)), terms: sup.payment_terms_days || 30, inv: `INV-${(hashString(po.number) % 90000) + 10000}`,
      sign: rng.pick(bank.sign_buyer),
    };
    const links = { po: po.number, supplier_id: sup.id };
    const thread = po.number;
    const outBase = { thread, mailbox: "suppliers", folder: "sent", from: { name: buyer.name, address: address("suppliers") }, to: [supplierParty(sup)], by: "S-09", links };
    const inBase = { thread, mailbox: "suppliers", folder: "inbox", from: supplierParty(sup), to: [shopParty("suppliers")], links };
    const sentAt = inWorkHours(plusMinutes(po.ordered_at, rng.int(3, 30)), rng);
    addEmail(ctx, { ...outBase, key: `po|${po.number}|sent`, subject: fill(rng.pick(bank.po_sent.subjects), slots), body: fill(rng.pick(bank.po_sent.bodies), slots), at: sentAt });
    if (rng.chance(0.8)) {
      addEmail(ctx, { ...inBase, key: `po|${po.number}|confirmed`, subject: fill(rng.pick(bank.confirmed.subjects), slots), body: fill(rng.pick(bank.confirmed.bodies), slots), at: plusMinutes(sentAt, rng.int(90, 1500)), read: true });
    }
    const arrival = po.received_at || po.expected_at;
    const late = arrival && dayOf(arrival) > po.due_at;
    if (late) {
      const sl = { ...slots, new_date: humanDate(dayOf(arrival)) };
      const noticeDay = addDays(po.due_at, -rng.int(0, 2));
      addEmail(ctx, { ...inBase, key: `po|${po.number}|delay`, subject: fill(rng.pick(bank.delay.subjects), sl), body: fill(rng.pick(bank.delay.bodies), sl), at: timeOn(noticeDay > dayOf(po.ordered_at) ? noticeDay : dayOf(po.ordered_at), rng, 9, 16), read: true });
    }
    if (po.received_at && rng.chance(0.9)) {
      addEmail(ctx, {
        thread, mailbox: "accounts", folder: "inbox", from: supplierParty(sup, "Accounts"), to: [shopParty("accounts")], links,
        key: `po|${po.number}|invoice`, subject: fill(rng.pick(bank.invoice.subjects), slots), body: fill(rng.pick(bank.invoice.bodies), slots),
        at: plusMinutes(po.received_at, rng.int(120, 2900)), read: true,
      });
    }
    if (po.paid_at && rng.chance(0.7)) {
      addEmail(ctx, {
        thread, mailbox: "accounts", folder: "sent", from: { name: ctx.staffById.get("S-03").name, address: address("accounts") }, to: [supplierParty(sup, "Accounts")], by: "S-03", links,
        key: `po|${po.number}|remittance`, subject: fill(rng.pick(bank.remittance.subjects), slots), body: fill(rng.pick(bank.remittance.bodies), slots),
        at: inWorkHours(plusMinutes(po.paid_at, rng.int(30, 300)), rng),
      });
    }
  }
}

// ---------------------------------------------------------------- mail: newsletters, press, junk, pitches

function newsletterMails(ctx) {
  const bank = ctx.data.mail_system.newsletter;
  const toad = ctx.staffById.get("S-10");
  for (const cmp of ctx.state.campaigns || []) {
    if (!recent(ctx, cmp.start)) continue;
    const rng = rngFor(ctx.seed, "mail-newsletter", cmp.id);
    const isEmail = cmp.channel === "email";
    if (!isEmail && !(/^Launch/.test(cmp.name) && rng.chance(0.6))) continue;
    const hasCode = !!cmp.code;
    const offer = hasCode ? rng.pick([bank.offers[0], bank.offers[1], bank.offers[3], bank.offers[5]]) : rng.pick([bank.offers[2], bank.offers[4]]);
    const slots = { campaign: cmp.name, code: cmp.code || "", pct: cmp.discount_pct || 0, sign: `${toad.name}\nMarketing, ${SHOP_NAME}` };
    slots.offer = fill(offer, slots);
    addEmail(ctx, {
      key: `campaign|${cmp.id}|newsletter`, thread: cmp.id, mailbox: mailboxOf(toad), folder: "sent", from: staffParty(toad),
      to: [{ name: "Subscribers", address: address("subscribers") }], by: "S-10", links: { campaign_id: cmp.id },
      subject: fill(rng.pick(bank.subjects), slots), body: fill(rng.pick(bank.bodies), slots), at: timeOn(cmp.start, rng, 9, 11),
    });
  }
}

const PRESS_CHANCE = 0.035;
const PRESS_REPLY_CHANCE = 0.6;
const JUNK_CHANCE = 0.25;
const PITCH_CHANCE = 0.09;

function outsideMails(ctx) {
  const bank = ctx.data.mail_system;
  const toad = ctx.staffById.get("S-10");
  // WHY: a press reply goes out on the next working day, up to four days after the mail it answers.
  for (const date of datesBetween(addDays(ctx.from, -4), ctx.to)) {
    if (date < (ctx.firstDate || "0000")) continue;
    const rng = rngFor(ctx.seed, "mail-outside", date);
    if (isWorkday(date) && rng.chance(PRESS_CHANCE * 1.4)) {
      const item = rng.pick(bank.press.items);
      const who = rng.pick(bank.press.people), org = rng.pick(bank.press.orgs);
      const slots = { who, org };
      const at = timeOn(date, rng, 9, 16);
      const subject = fill(rng.pick(item.subjects), slots);
      const sender = { name: who, address: `${slug(who)}@${slug(org)}.example` };
      addEmail(ctx, { key: `press|${date}|in`, thread: `press-${date}`, mailbox: "press", folder: "inbox", from: sender, to: [shopParty("press")], subject, body: fill(rng.pick(item.bodies), slots), at, read: !isUnread(ctx, at, rng) });
      if (rng.chance(PRESS_REPLY_CHANCE)) {
        addEmail(ctx, { key: `press|${date}|reply`, thread: `press-${date}`, mailbox: "press", folder: "sent", from: { name: toad.name, address: address("press") }, to: [sender], by: "S-10", subject: `Re: ${subject}`, body: fill(rng.pick(item.reply), slots), at: timeOn(workdayOn(addDays(date, 1)), rng, 9, 16) });
      }
    }
    if (rng.chance(JUNK_CHANCE)) bundleMail(ctx, date, rng, true);
    if (isWorkday(date) && rng.chance(PITCH_CHANCE)) bundleMail(ctx, date, rng, false);
  }
}

/** One coherent junk or sales mail: sender, company, subject and body all come from the same bundle. */
function bundleMail(ctx, date, rng, junk) {
  const pool = ctx.data.junk.bundles.filter((b) => b.junk === junk);
  const b = rng.pick(pool);
  const slots = {
    sender: b.sender, company: b.company, shop: SHOP_NAME, ref: rng.int(100000, 999999), amount: rng.pick([15, 25, 40, 59, 75, 99, 120, 199, 250, 480, 900]),
    days: rng.int(2, 30), n: rng.int(3, 95), month: MONTH_NAMES[Number(date.slice(5, 7)) - 1],
  };
  const box = junk && rng.chance(0.2) ? "accounts" : "hello";
  const at = timeOn(date, rng, junk ? 0 : 9, junk ? 24 : 17);
  addEmail(ctx, {
    key: `${junk ? "junk" : "pitch"}|${date}|${b.id}`, thread: `${junk ? "junk" : "pitch"}-${date}-${b.id}`, mailbox: box, folder: junk ? "junk" : "inbox",
    from: { name: b.sender, address: `${slug(b.sender.split(" ")[0])}@${b.domain}` }, to: [shopParty(box)],
    subject: fill(rng.pick(b.subjects), slots), body: fill(rng.pick(b.bodies), slots) + (rng.chance(0.9) ? fill(rng.pick(["\n\nRef {ref}.", "\n\nOffer code {ref}, valid {days} days.", "\n\nSent from our {month} mailing, ref {ref}.", "\n\nTo stop receiving these, reply STOP (ref {ref})."]), slots) : ""), at, read: !junk, bundle: b.id,
  });
}

// ---------------------------------------------------------------- mail: between staff

function weekOrders(ctx, monday) {
  const start = addDays(monday, -7), end = addDays(monday, -1);
  let n = 0, revenue = 0, refunds = 0;
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(...onDay(ctx, "orders", d));
  for (const o of days) {
    if (o.status === "cancelled" || o.status === "payment_failed") continue;
    n += 1; revenue += o.totals.total; refunds += o.payment?.refunded || 0;
  }
  return { n, revenue, refunds, end };
}

const COST_LABELS = { supplier_payment: "a supplier payment", marketing_spend: "marketing spend", software: "software", rent: "the rent" };

function internalMails(ctx) {
  const bank = ctx.data.mail_system.internal;
  for (const date of datesBetween(addDays(ctx.from, -2), ctx.to)) {
    // Weekly figures: Bob Cratchit to Mr Fezziwig every Monday that follows a week with orders.
    if (weekday(date) === 1) {
      const w = weekOrders(ctx, date);
      if (w.n > 0) {
        const rng = rngFor(ctx.seed, "mail-weekly", date);
        const slots = { week: humanDate(w.end), orders: w.n, revenue: money(w.revenue), refunds: money(w.refunds) };
        const at = timeOn(date, rng, 9, 10);
        const key = `weekly|${date}`;
        const subject = fill(rng.pick(bank.weekly_figures.subjects), slots);
        addInternalMail(ctx, { key, thread: key, from: "S-03", to: ["S-01"], cc: ["S-02"], subject, body: fill(rng.pick(bank.weekly_figures.bodies), slots), at });
        if (rng.chance(0.6)) {
          addInternalMail(ctx, { key: `${key}|reply`, thread: key, from: "S-01", to: ["S-03"], cc: [], subject: `Re: ${subject}`, body: fill(rng.pick(bank.weekly_figures.replies), slots), at: plusMinutes(at, rng.int(30, 200)) });
        }
      }
    }
    // Scrooge queries one cost from last month, early in each month.
    // WHY: the first working day on or after the 4th, so it never falls on a weekend.
    if (date === workdayOn(`${date.slice(0, 7)}-04`)) costQuery(ctx, date, bank.cost_query);
  }
}

function costQuery(ctx, date, bank) {
  const month = addDays(`${date.slice(0, 7)}-01`, -1).slice(0, 7);
  const rng = rngFor(ctx.seed, "mail-cost", month);
  if (!rng.chance(0.65)) return;
  const wanted = (bucketIndex(ctx.cache, "ledger_month", ctx.state.ledger || [], (e) => e.month).get(month) || []).filter((e) => COST_LABELS[e.type]);
  if (!wanted.length) return;
  const e = wanted.slice().sort((a, b) => a.amount - b.amount).slice(0, 5)[rng.int(0, Math.min(4, wanted.length - 1))];
  const slots = { ref: e.id, amount: money(Math.abs(e.amount)), what: COST_LABELS[e.type] };
  const at = timeOn(date, rng, 9, 15);
  const key = `cost|${month}`;
  const subject = fill(rng.pick(bank.subjects), slots);
  const links = { ledger_id: e.id };
  if (/^PO-/.test(e.reference || "") && ctx.pos.get(e.reference)) links.po = e.reference;
  if (/^CMP-/.test(e.reference || "") && ctx.campaigns.get(e.reference)) links.campaign_id = e.reference;
  addInternalMail(ctx, { key, thread: key, from: "S-02", to: ["S-03"], cc: [], subject, body: fill(rng.pick(bank.bodies), slots), at, links });
  addInternalMail(ctx, { key: `${key}|reply`, thread: key, from: "S-03", to: ["S-02"], cc: [], subject: `Re: ${subject}`, body: fill(rng.pick(bank.replies), slots), at: plusMinutes(at, rng.int(40, 300)), links });
}

// ---------------------------------------------------------------- chat

const BIG_ORDER_TOTAL = 100;
const REACTION_CHANCE = 0.25;

/** Facts about a day, for lines that are written around them: yesterday's orders, last week's, the best seller, the weather. */
function dayFacts(ctx, date) {
  const dayCount = (d) => onDay(ctx, "orders", d).length;
  const dayProducts = (d) => {
    const memo = ctx.cache.dayProducts || (ctx.cache.dayProducts = new Map());
    if (!memo.has(d)) {
      const m = new Map();
      for (const o of onDay(ctx, "orders", d)) for (const i of o.items) m.set(ctx.productName(i), (m.get(ctx.productName(i)) || 0) + i.qty);
      memo.set(d, m);
    }
    return memo.get(d);
  };
  let prev = addDays(date, -1);
  while (!isWorkday(prev)) prev = addDays(prev, -1);
  const monday = addDays(date, -((weekday(date) + 6) % 7));
  let lastweek = 0, week = 0;
  for (let d = addDays(monday, -7); d < monday; d = addDays(d, 1)) lastweek += dayCount(d);
  for (let d = monday; d < date; d = addDays(d, 1)) week += dayCount(d);
  const totals = new Map();
  for (let k = 1; k <= 7; k++) for (const [name, q] of dayProducts(addDays(date, -k))) totals.set(name, (totals.get(name) || 0) + q);
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  const w = ctx.data.banter.weather[date.slice(5, 7)];
  const yday = dayCount(prev);
  return {
    yday, week, lastweek, yday_n: plural(yday, "order"), week_n: plural(week, "order"), lastweek_n: plural(lastweek, "order"), top: top ? top[0] : null,
    dayname: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday(date)],
    month: MONTH_NAMES[Number(date.slice(5, 7)) - 1], weather: w[hashString(date) % w.length],
  };
}

/** A line written around a fact can only be used on a day when the fact is worth saying. */
function usable(text, facts) {
  if (/\{yday_n\}/.test(text) && facts.yday < 3) return false;
  if (/\{week_n\}/.test(text) && facts.week < 3) return false;
  if (/\{lastweek_n\}/.test(text) && facts.lastweek < 3) return false;
  if (/\{top\}/.test(text) && !facts.top) return false;
  return true;
}

// ---- working hours

/** A person's working window in minutes, from business/data/staff.json: start time, and the day's length from weekly hours plus slack, never past 18:30. */
function windowOf(ctx, id) {
  const memo = ctx.cache.windows || (ctx.cache.windows = new Map());
  const key = `${id}`;
  if (!memo.has(key)) {
    const st = ctx.staffById.get(id);
    const [h, m] = String(st?.start || "09:00").split(":").map(Number);
    const start = h * 60 + m;
    memo.set(key, { start, end: Math.min(18 * 60 + 30, start + Math.max(240, (st?.weekly_hours || 20) / 5 * 60 + 120)) });
  }
  return memo.get(key);
}
const minuteOf = (iso) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
const clock = (date, minutes, rng) => `${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:${pad(rng.int(0, 59))}Z`;

/** A time on `date` inside the person's hours, preferably between two minute marks. */
function timeIn(ctx, id, date, rng, lo = 0, hi = 1440) {
  const w = windowOf(ctx, id);
  let a = Math.max(w.start, lo), b = Math.min(w.end, hi);
  if (a >= b) { a = w.start; b = w.end; }
  return clock(date, rng.int(a, b), rng);
}

/** Moves a message the person starts into their hours: later the same day if they have not arrived, else the next working morning. */
function fitPoster(ctx, id, iso, rng) {
  const w = windowOf(ctx, id), day = dayOf(iso), m = minuteOf(iso);
  if (isWorkday(day) && m >= w.start && m <= w.end) return iso;
  if (isWorkday(day) && m < w.start) return clock(day, rng.int(w.start, w.start + 60), rng);
  return clock(workdayOn(addDays(day, 1)), rng.int(w.start, w.start + 90), rng);
}

/** A reply time inside the replier's hours, or null when they have gone home (so there is no reply). */
function fitReply(ctx, id, iso, rng) {
  const w = windowOf(ctx, id), day = dayOf(iso), m = minuteOf(iso);
  if (!isWorkday(day) || m > w.end) return null;
  return m >= w.start ? iso : clock(day, rng.int(w.start, w.start + 45), rng);
}

// ---- parts that go with a line

const REF_PATTERNS = ["Re {ref}: ", "On {ref}: ", "{ref}: ", "About {ref}, "];

/** Ties an event reply to what it is about ("Re PO-3262: ..."). The reference is an id, never a product. */
function dressReply(text, slots, rng) {
  const refs = [slots.ref, slots.order, slots.po, slots.case, slots.campaign].filter(Boolean);
  if (!refs.length) return text;
  return rng.pick(REF_PATTERNS).replace("{ref}", refs[0]) + text;
}

const WORD = /[a-z']{4,}/g;
const STOP = new Set(["that", "this", "with", "have", "your", "will", "been", "they", "them", "what", "when", "were", "from", "than", "then", "here", "just", "very", "does", "into", "some", "also", "more", "such", "only", "each", "over", "well", "much", "even", "most", "make", "made", "many", "like", "time", "good", "back", "come", "came", "take", "there", "their", "would", "which", "about", "should", "please", "could", "thing", "things", "these", "those", "where", "other"]);
const wordsOf = (t) => new Set((String(t).toLowerCase().match(WORD) || []).filter((w) => !STOP.has(w)));
const CAREFUL = ["thank", "sorry", "hope", "please", "splendid", "noted", "fine"];

/** True when a sign-off, lead-in or address would repeat words already in the line. */
function repeats(line, extra) {
  const a = wordsOf(line), b = wordsOf(extra);
  for (const w of b) if (a.has(w)) return true;
  const l = line.toLowerCase(), e = extra.toLowerCase();
  if (l.includes(e.replace(/[.!?]+$/, ""))) return true;
  return CAREFUL.some((w) => l.includes(w) && e.includes(w));
}

/** Names a person is called by: "Sam", "Mrs Hudson". Some patterns start "Thank you" or "Yes", so they are skipped if the line does. */
function addressForms(ctx, toId, line) {
  const names = ctx.data.banter.names?.[toId];
  if (!names) return [];
  const out = [];
  for (const pat of ctx.data.banter.address_patterns) {
    if (/^(thank|yes|ah)/i.test(pat) && /^(thank|yes|ah|splendid|noted|fine|agreed)/i.test(line)) continue;
    for (const n of names) if (!repeats(line, n)) out.push(pat.replace("{name}", n));
  }
  return out;
}

/** The least-used text among candidates (ties broken by the day's random stream). WHY: lines come round evenly, so none is used often. */
function leastUsed(cs, rng, candidates) {
  let min = Infinity;
  for (const t of candidates) { const n = cs.counts.get(t) || 0; if (n < min) min = n; }
  const best = candidates.filter((t) => (cs.counts.get(t) || 0) === min);
  const text = rng.pick(best);
  cs.counts.set(text, min + 1);
  return text;
}

/** Writes one trigger line and up to two answers from named people, inside their working hours, in one chat thread. */
function chatThread(ctx, { key, situation, slots, at, links = {}, channel }) {
  const bank = ctx.data.chat.situations[situation];
  const rng = rngFor(ctx.seed, "chat", key);
  const day = workdayOn(dayOf(at));
  const facts = dayFacts(ctx, day);
  const all = { ...facts, ...slots };
  const posters = bank.posters.filter((p) => bank.lines[p]);
  const poster = rng.pick(posters);
  const start = fitPoster(ctx, poster, day === dayOf(at) ? at : `${day}T09:00:00Z`, rng);
  let opener = fill(rng.pick(bank.lines[poster]), all);
  const ids = [all.ref, all.order, all.po, all.case].filter(Boolean);
  if (ids.length && !ids.some((x) => opener.includes(x))) opener = dressReply(opener, all, rng);
  addChat(ctx, { key, channel: channel || bank.channel, from: poster, text: opener, at: start, links, reactions: reactions(ctx, rng, poster) });
  const answerers = bank.replyers.filter((p) => p !== poster && bank.replies[p]);
  const n = rng.weighted([[0, 0.3], [1, 0.45], [2, 0.25]]);
  let when = start;
  const used = [];
  for (let i = 0; i < n && answerers.length > used.length; i++) {
    let who;
    do { who = rng.pick(answerers); } while (used.includes(who));
    used.push(who);
    const t = fitReply(ctx, who, plusMinutes(when, rng.int(2, 40)), rng);
    if (!t) continue;
    when = t;
    let reply = dressReply(fill(rng.pick(bank.replies[who]), all), all, rng);
    const forms = rng.chance(0.3) ? addressForms(ctx, poster, reply) : [];
    if (forms.length) reply = rng.pick(forms) + reply;
    addChat(ctx, { key: `${key}|r${i}`, channel: channel || bank.channel, from: who, text: reply, at: t, parent_key: key, links, reactions: reactions(ctx, rng, who) });
  }
}

function reactions(ctx, rng, except) {
  if (!rng.chance(REACTION_CHANCE)) return [];
  const others = [...ctx.staffById.keys()].filter((id) => id !== except);
  return [{ by: rng.pick(others), mark: rng.pick(ctx.data.chat.reaction_words) }];
}

function poSlots(ctx, po, sup, rng) {
  const first = po.lines[0];
  return {
    po: po.number, supplier: sup.name, count: po.lines.length, date: humanDate(po.due_at),
    date2: humanDate(dayOf(po.received_at || po.expected_at || po.due_at)), amount: money(poTotal(po)),
    product: ctx.data.skuProduct?.[first.sku]?.name || first.sku, lines: po.lines.map((l) => `  ${l.qty} x ${ctx.data.skuProduct?.[l.sku]?.name || l.sku}`).join("\n"),
    time: `${pad(rng.int(8, 10))}:${pad(rng.int(0, 49))}`, time2: `${pad(rng.int(11, 12))}:${pad(rng.int(0, 59))}`,
    days: Math.max(1, Math.round((msOf(dayOf(po.received_at || po.expected_at || po.due_at)) - msOf(po.due_at)) / DAY_MS)),
  };
}

function orderChat(ctx) {
  for (const o of recentList(ctx, "orders")) {
    if (!recent(ctx, o.placed_at)) continue;
    const c = ctx.customers.get(o.customer_id);
    const rng = rngFor(ctx.seed, "chat-order", o.number);
    const links = { order: o.number, customer_id: o.customer_id };
    const qty = o.items.reduce((n, i) => n + i.qty, 0);
    if (o.totals.total >= BIG_ORDER_TOTAL && o.status !== "cancelled" && rng.chance(o.totals.total >= 200 ? 1 : 0.35)) {
      chatThread(ctx, { key: `chat|big|${o.number}`, situation: "big_order", at: plusMinutes(o.placed_at, rng.int(15, 150)), links, slots: { order: o.number, total: money(o.totals.total), count: qty, product: ctx.productName(o.items[0]) } });
    }
    for (const s of o.shipments || []) {
      if (!s.delivered_at || !s.eta || dayOf(s.delivered_at) <= s.eta) continue;
      const days = Math.round((msOf(dayOf(s.delivered_at)) - msOf(s.eta)) / DAY_MS);
      chatThread(ctx, { key: `chat|late|${s.id}`, situation: "late_delivery", at: plusMinutes(s.delivered_at, rng.int(30, 300)), links, slots: { order: o.number, days, date: humanDate(s.eta), name: c ? c.name : "the customer" } });
    }
  }
}

function stockChat(ctx) {
  for (const po of recentList(ctx, "purchase_orders")) {
    if (!recent(ctx, po.ordered_at)) continue;
    const sup = ctx.suppliers.get(po.supplier_id);
    if (!sup) continue;
    const rng = rngFor(ctx.seed, "chat-po", po.number);
    const links = { po: po.number, supplier_id: sup.id };
    const slots = poSlots(ctx, po, sup, rng);
    if (rng.chance(0.3)) chatThread(ctx, { key: `chat|po|${po.number}|raised`, situation: "po_raised", at: timeOn(workdayOn(dayOf(po.ordered_at)), rng, 9, 16), links, slots });
    if (po.received_at && rng.chance(0.4)) {
      const sit = "po_received";
      chatThread(ctx, { key: `chat|po|${po.number}|received`, situation: sit, at: plusMinutes(po.received_at, rng.int(20, 200)), links, slots });
    }
    const arrival = po.received_at || po.expected_at;
    if (arrival && dayOf(arrival) > po.due_at) {
      chatThread(ctx, { key: `chat|po|${po.number}|late`, situation: "po_late", at: timeOn(workdayOn(addDays(po.due_at, 1)), rng, 9, 12), links, slots });
    }
  }
  for (const sc of recentList(ctx, "stock_counts")) {
    if (!sc.difference || !recent(ctx, sc.at)) continue;
    const rng = rngFor(ctx.seed, "chat-count", sc.id);
    const sku = sc.sku;
    chatThread(ctx, { key: `chat|count|${sc.id}`, situation: "stock_count_diff", at: plusMinutes(sc.at, rng.int(10, 120)), slots: { ref: sc.id, product: ctx.data.skuProduct?.[sku]?.name || sku, count: Math.abs(sc.difference) } });
  }
  for (const r of recentList(ctx, "returns")) {
    if (r.reason !== "faulty" || !recent(ctx, r.created_at)) continue;
    const rng = rngFor(ctx.seed, "chat-faulty", r.id || r.order_number);
    if (!rng.chance(0.5)) continue;
    const o = ctx.orders.get(r.order_number);
    chatThread(ctx, { key: `chat|faulty|${r.id}`, situation: "faulty_return", at: plusMinutes(r.created_at, rng.int(600, 3000)), links: { order: r.order_number }, slots: { ref: r.id || r.order_number, product: o ? ctx.productName(o.items[0]) : "a unit" } });
  }
}

function customerChat(ctx) {
  for (const k of recentList(ctx, "cases")) {
    if (!k.is_complaint || !recent(ctx, k.opened_at)) continue;
    const rng = rngFor(ctx.seed, "chat-case", k.number);
    if (!rng.chance(0.9)) continue;
    const c = ctx.customers.get(k.customer_id);
    const links = { case: k.number, customer_id: k.customer_id };
    if (k.related?.order && ctx.orders.get(k.related.order)) links.order = k.related.order;
    chatThread(ctx, { key: `chat|case|${k.number}`, situation: "complaint", at: plusMinutes(k.opened_at, rng.int(10, 240)), links, slots: { case: k.number, name: c ? c.name : "A customer", order: k.related?.order || "their order" } });
  }
  for (const rv of recentList(ctx, "reviews")) {
    if (!recent(ctx, rv.date)) continue;
    const rng = rngFor(ctx.seed, "chat-review", rv.id);
    const good = rv.rating >= 4, bad = rv.rating <= 2;
    if (!((good && rng.chance(0.35)) || (bad && rng.chance(0.8)))) continue;
    const c = ctx.customers.get(rv.customer_id);
    const p = ctx.data.products.find((x) => x.id === rv.product);
    chatThread(ctx, { key: `chat|review|${rv.id}`, situation: good ? "good_review" : "bad_review", at: timeOn(workdayOn(rv.date), rng, 10, 16), links: { customer_id: rv.customer_id, order: rv.order_number, product_id: rv.product }, slots: { ref: rv.id, name: c ? c.name : "A customer", product: p ? p.name : rv.product, rating: rv.rating } });
  }
}

function moneyChat(ctx) {
  for (const m of ctx.state.monthly_summary || []) {
    const closeDay = workdayOn(addDays(`${m.month}-01`, 33).slice(0, 8) + "03");
    if (!recent(ctx, closeDay)) continue;
    const rng = rngFor(ctx.seed, "chat-month", m.month);
    const [y, mo] = m.month.split("-");
    chatThread(ctx, { key: `chat|month|${m.month}`, situation: "month_end", at: timeOn(closeDay, rng, 10, 16), slots: { ref: `${MONTH_NAMES[Number(mo) - 1]} ${y}`, month: `${MONTH_NAMES[Number(mo) - 1]} ${y}`, orders: m.orders, profit: money(m.profit), revenue: money(m.revenue) } });
  }
  for (const cmp of ctx.state.campaigns || []) {
    if (!recent(ctx, cmp.start)) continue;
    const rng = rngFor(ctx.seed, "chat-campaign", cmp.id);
    chatThread(ctx, { key: `chat|campaign|${cmp.id}`, situation: "campaign_start", at: timeOn(workdayOn(cmp.start), rng, 9, 11), links: { campaign_id: cmp.id }, slots: { campaign: cmp.name, amount: money(cmp.spend), time: "09:30" } });
  }
}

const BANTER_CHANCE = 0.3;
const MONDAY_CHANCE = 0.4;
const FRIDAY_CHANCE = 0.3;
const NOTICE_CHANCE = 0.05;
const DM_CHANCE = 0.06;
const REPLY_COUNTS = [[0, 0.3], [1, 0.45], [2, 0.25]];

/** Fisher-Yates with our own seeded stream. */
function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const habitsOf = (ctx, id) => ctx.data.banter.people[id]?.habits || [];

/**
 * One finished line from a base sentence and optional parts (address, lead-in, tail, sign-off habit).
 * A part that would repeat words already in the line is left out, and the least-used result wins.
 */
function composeLine(ctx, cs, rng, bases, opt = {}) {
  const build = (addr, habit, lead, tail) => {
    const out = [];
    for (const base of bases) {
      const addrs = addr ? addressForms(ctx, opt.addrTo, base) : [];
      const habits = habit ? habitsOf(ctx, opt.habitOf).filter((h) => !repeats(base, h)) : [];
      const leads = lead ? opt.leads.filter((l) => !repeats(base, l)) : [];
      const tails = tail ? opt.tails.filter((t) => !repeats(base, t)) : [];
      for (const a of addrs.length ? addrs : [""]) for (const l of leads.length ? leads : [""]) for (const t of tails.length ? tails : [""]) for (const h of habits.length ? habits : [""]) {
        out.push(`${a}${l ? `${l} ` : ""}${base}${t ? ` ${t}` : ""}${h ? ` ${h}` : ""}`);
      }
    }
    return out;
  };
  const flags = [
    !!opt.addrTo && rng.chance(opt.addrChance ?? 0), !!opt.habitOf && rng.chance(opt.habitChance ?? 0),
    !!opt.leads && rng.chance(opt.leadsChance ?? 0), !!opt.tails && rng.chance(opt.tailsChance ?? 0),
  ];
  let out = build(...flags);
  const used = (t) => cs.counts.get(t) || 0;
  // WHY: a plain line that has already been used twice is dressed up instead, so short lines stay under the limit.
  if (Math.min(...out.map(used)) >= 2) {
    const all = build(!!opt.addrTo, !!opt.habitOf, !!opt.leads, !!opt.tails);
    if (all.length) out = all;
  }
  return leastUsed(cs, rng, out);
}

/** The chat walk for one seed: kept between calls so each new day is one more step, as for company posts. */
function chatStore(ctx) {
  if (!ctx.cache.chatWalk) ctx.cache.chatWalk = new Map();
  const key = String(ctx.seed);
  let cs = ctx.cache.chatWalk.get(key);
  if (!cs || cs.data !== ctx.data || cs.first !== ctx.firstDate) {
    const people = ctx.data.banter.people;
    const pool = [];
    for (const [id, p] of Object.entries(people)) p.obs.forEach((o, i) => pool.push({ id, topic: o.topic, text: o.text, key: `${id}|${i}`, lo: o.lo, hi: o.hi, months: o.months }));
    const replies = {};
    for (const [id, byTopic] of Object.entries(ctx.data.banter.replies)) for (const [t, lines] of Object.entries(byTopic)) (replies[t] || (replies[t] = {}))[id] = lines;
    cs = { data: ctx.data, first: ctx.firstDate, last: null, counts: new Map(), base: new Map(), byDay: new Map(), pool, replies };
    ctx.cache.chatWalk.set(key, cs);
  }
  return cs;
}

/** The least-used base in a list of { key } entries. */
function leastUsedBase(cs, rng, entries) {
  let min = Infinity;
  for (const e of entries) { const n = cs.base.get(e.key) || 0; if (n < min) min = n; }
  const e = rng.pick(entries.filter((x) => (cs.base.get(x.key) || 0) === min));
  cs.base.set(e.key, min + 1);
  return e;
}

/** A thread of "what someone said" and answers written for it. replyFor(id) gives that person's lines, or null. */
function walkReplies(ctx, cs, rng, key, channel, poster, at, replyIds, replyFor, emit, extra = {}) {
  const n = rng.weighted(REPLY_COUNTS);
  let when = at, sent = 0;
  for (const who of shuffled(replyIds.filter((id) => id !== poster), rng)) {
    if (sent >= n) break;
    const lines = replyFor(who);
    if (!lines || !lines.length) continue;
    const t = fitReply(ctx, who, plusMinutes(when, rng.int(2, 40)), rng);
    if (!t) continue;
    when = t;
    const text = composeLine(ctx, cs, rng, lines, { addrTo: poster, addrChance: 0.5, habitOf: who, habitChance: 0.15 });
    emit({ key: `${key}|r${sent}`, channel, from: who, text, at: t, parent_key: key, ...extra });
    sent += 1;
  }
}

/** A general notice, Monday hello or Friday goodbye: a whole line, sometimes with a sentence after it. */
function generalThread(ctx, cs, rng, date, situation, key, emit, lo, hi) {
  const bank = ctx.data.chat.situations[situation];
  const facts = dayFacts(ctx, date);
  const entries = [];
  for (const id of bank.posters) (bank.lines[id] || []).forEach((text, i) => { if (usable(text, facts)) entries.push({ id, text, key: `${situation}|${id}|${i}` }); });
  if (!entries.length) return;
  const e = leastUsedBase(cs, rng, entries);
  const at = timeIn(ctx, e.id, date, rng, lo, hi);
  const text = composeLine(ctx, cs, rng, [fill(e.text, facts)], { tails: bank.tails, tailsChance: 0.85 });
  emit({ key, channel: bank.channel, from: e.id, text, at });
  walkReplies(ctx, cs, rng, key, bank.channel, e.id, at, bank.replyers, (id) => (bank.replies[id] || []).filter((l) => e.id === "S-01" || !/Mr Fezziwig/.test(l)).map((l) => fill(l, facts)), emit);
}

/** Ordinary office talk in #random. The reply set is the one written for the opener's topic; no topic, no reply. */
function banterThread(ctx, cs, rng, date, i, emit) {
  const facts = dayFacts(ctx, date);
  const bank = ctx.data.banter;
  const month = Number(date.slice(5, 7));
  const e = leastUsedBase(cs, rng, cs.pool.filter((x) => usable(x.text, facts) && (!x.months || x.months.includes(month))));
  const evening = bank.evening.people.includes(e.id) && rng.chance(bank.evening.chance);
  const at = evening ? clock(date, rng.int(18 * 60 + 30, 21 * 60 + 30), rng) : timeIn(ctx, e.id, date, rng, Math.max(540, e.lo || 0), e.hi || 1020);
  const leads = bank.lead_ins.any;
  const filled = fill(e.text, facts);
  const text = composeLine(ctx, cs, rng, [filled.charAt(0).toUpperCase() + filled.slice(1)], { leads, leadsChance: 0.2, habitOf: e.id, habitChance: 0.2 });
  const key = `chat|banter|${date}|${i}`;
  emit({ key, channel: "random", from: e.id, text, at, reactions: reactions(ctx, rng, e.id) });
  if (!e.topic) return;
  const byPerson = cs.replies[e.topic] || {};
  walkReplies(ctx, cs, rng, key, "random", e.id, at, Object.keys(byPerson), (id) => (byPerson[id] || []).map((l) => fill(l, facts)), emit);
}

/** A private exchange: the first person asks, the second answers with the line written for it. */
function dmThread(ctx, cs, rng, date, emit) {
  const entries = [];
  ctx.data.chat.dm.forEach((pair, pi) => pair.a_says.forEach((_, i) => entries.push({ pair, i, key: `dm|${pi}|${i}` })));
  const e = leastUsedBase(cs, rng, entries);
  const [a, b] = e.pair.pair, dm = [a, b].sort();
  const base = `chat|dm|${date}|${dm.join("")}`;
  const at = timeIn(ctx, a, date, rng, 540, 1000);
  emit({ key: `${base}|0`, dm, from: a, text: e.pair.a_says[e.i], at });
  const t = fitReply(ctx, b, plusMinutes(at, rng.int(2, 30)), rng);
  if (t) emit({ key: `${base}|1`, dm, from: b, text: e.pair.b_says[e.i], at: t, parent_key: `${base}|0` });
}

function walkDay(ctx, cs, date, emit) {
  const rng = rngFor(ctx.seed, "chat-walk", date);
  if (weekday(date) === 1 && rng.chance(MONDAY_CHANCE)) generalThread(ctx, cs, rng, date, "general_monday", `chat|monday|${date}`, emit, 540, 600);
  if (weekday(date) === 5 && rng.chance(FRIDAY_CHANCE)) generalThread(ctx, cs, rng, date, "general_friday", `chat|friday|${date}`, emit, 780, 900);
  if (rng.chance(NOTICE_CHANCE)) generalThread(ctx, cs, rng, date, "general_notice", `chat|notice|${date}`, emit, 540, 960);
  if (rng.chance(BANTER_CHANCE)) {
    const n = rng.weighted([[1, 0.7], [2, 0.25], [3, 0.05]]);
    for (let i = 0; i < n; i++) banterThread(ctx, cs, rng, date, i, emit);
  }
  if (rng.chance(DM_CHANCE)) dmThread(ctx, cs, rng, date, emit);
}

/** General notices, #random chat and private messages, walked day by day from the first day and cached. */
function everydayChat(ctx) {
  const cs = chatStore(ctx);
  const emit = (r) => {
    const rec = chatRec(ctx, r);
    const day = dayOf(rec.at);
    if (!cs.byDay.has(day)) cs.byDay.set(day, []);
    cs.byDay.get(day).push(rec);
  };
  for (const date of datesBetween(cs.last ? addDays(cs.last, 1) : ctx.firstDate, ctx.to)) {
    cs.last = date;
    if (isWorkday(date)) walkDay(ctx, cs, date, emit);
  }
  // Messages can land a day or two after the day that wrote them (a reply the next morning), so look back a little.
  for (let d = addDays(ctx.from, -3); d <= ctx.to; d = addDays(d, 1)) {
    for (const stored of cs.byDay.get(d) || []) {
      const rec = { ...stored };
      if (inWindow(ctx, rec.at)) ctx.chat.push(rec);
    }
  }
}

// ---------------------------------------------------------------- social

const FIRST_YEAR_SOCIAL_START_LAG = 0;
const SQUINT_POST_CHANCE = 0.26;
const MUTTER_POST_CHANCE = 0.38;
const WEEKEND_FACTOR = 0.35;
const CUSTOMER_POST_CHANCE = 0.035;
const CUSTOMER_POST_CHANCE_BIG = 0.06;
const DM_QUESTION_CHANCE = 0.05;

const companyAuthor = (data) => ({ kind: "company", name: SHOP_NAME, handle: data.social.shop_handle });
const customerAuthor = (data, c) => ({ kind: "customer", customer_id: c.id, name: c.name, handle: handleFor(c, data.social.handle_bits) });

/** First day anything happens: the earliest campaign or order. */
function firstActiveDate(ctx) {
  const days = (ctx.state.campaigns || []).map((c) => c.start);
  if (ctx.cache.firstOrderDay) days.push(ctx.cache.firstOrderDay);
  return days.length ? days.sort()[0] : "9999-12-31";
}

/** Followers per day for both networks, built up from orders, social visits and campaigns. Only new days are worked out. */
function followerSeries(ctx) {
  const key = String(ctx.seed);
  if (!ctx.cache.series) ctx.cache.series = new Map();
  let fs = ctx.cache.series.get(key);
  if (!fs || fs.first !== ctx.firstDate) { fs = { first: ctx.firstDate, last: null, squint: 12, mutter: 8, map: new Map() }; ctx.cache.series.set(key, fs); }
  const visits = mapIndex(ctx.cache, "web", ctx.state.web_sessions_daily || [], "date");
  const boost = new Map();
  for (const c of ctx.state.campaigns || []) boost.set(c.start, (boost.get(c.start) || 0) + (c.channel === "social" ? 3 + c.spend / 40 : 1));
  for (const date of datesBetween(fs.last ? addDays(fs.last, 1) : fs.first, ctx.to)) {
    const rng = rngFor(ctx.seed, "followers", date);
    const o = onDay(ctx, "orders", date).length, s = visits.get(date)?.visits?.social || 0, b = boost.get(date) || 0;
    const gain = (x) => Math.floor(x) + (rng.chance(x - Math.floor(x)) ? 1 : 0);
    fs.squint += gain(0.35 + 0.5 * o + 0.1 * s + 0.6 * b) - (rng.chance(0.12) ? 1 : 0);
    fs.mutter += gain(0.2 + 0.3 * o + 0.07 * s + 0.4 * b) - (rng.chance(0.1) ? 1 : 0);
    fs.map.set(date, { squint: Math.max(fs.squint, 0), mutter: Math.max(fs.mutter, 0) });
    fs.last = date;
  }
  return fs.map;
}

/** A customer who existed on `date`, chosen from the customers by creation date. */
function pickCustomer(ctx, rng, date) {
  const list = ctx.customersByJoin;
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (dayOf(list[mid].created_at) <= date) lo = mid + 1; else hi = mid; }
  if (!lo) return null;
  // WHY: a staff member's name must never appear as a customer, even if the world's customer list still holds one.
  for (let tries = 0; tries < 8; tries++) { const c = list[rng.int(0, lo - 1)]; if (!ctx.staffNames.has(c.name)) return c; }
  return null;
}

function launchedProducts(ctx, date) {
  return ctx.data.products.filter((p) => ctx.firstSale.has(p.id) && ctx.firstSale.get(p.id) <= date && ctx.data.images[p.id]?.length);
}

function likesFor(rng, followers, lo, hi) {
  return Math.max(0, Math.round(followers * rng.between(lo, hi)));
}

/** "from £7" or "£7": the price straight from the product record. */
function priceText(p) {
  return p.price === null || p.price === undefined ? null : `${p.multiple_prices ? "from " : ""}£${Number.isInteger(p.price) ? p.price : p.price.toFixed(2)}`;
}

const trimStop = (t) => String(t).trim().replace(/\.$/, "");

/**
 * Every caption a product can have for one kind of post. Facts (price, care, questions, features, specs)
 * come from the product record. WHY: a caption must never state something the record does not say.
 */
function captionsFor(ctx, type, p, date) {
  const social = ctx.data.social, variants = social.company_types[type];
  const price = priceText(p);
  const base = { product: p.name, tagline: p.tagline, summary: p.summary, price: price || "", price_line: price ? `It is ${price}.` : "" };
  if (!price && ["new", "back", "price"].includes(type) && /price/.test(variants.join(" "))) { /* variants without a price are still fine */ }
  const facts = {
    new: [{}], back: [{}], price: [{}],
    question: (p.faq || []).map((f) => ({ q: f.q, a: f.a })),
    made: (p.features || []).map((f) => ({ feature: f })),
    care: (p.care || []).map((c) => ({ care: c })),
    correction: (p.specs || []).filter(([, v]) => String(v).length < 140).map(([l, v]) => ({ label: l, value: trimStop(v) })),
    thanks: type === "thanks" ? [reviewFacts(ctx, p, date)] : [],
  }[type] || [];
  const out = [];
  facts.forEach((f, fi) => {
    if (!f || (type === "thanks" && f.n < 3)) return;
    variants.forEach((v, vi) => {
      if (!price && /\{price\}/.test(v)) return;
      const caveat = social.caveats[hashString(`${p.id}|${type}|${vi}|${fi}`) % social.caveats.length];
      out.push(fill(v, { ...base, ...f, caveat }).replace(/\s+/g, " ").trim());
    });
  });
  return out;
}

function reviewFacts(ctx, p, date) {
  const rs = (ctx.state.reviews || []).filter((r) => r.product === p.id && r.date <= date);
  return { n: rs.length, avg: rs.length ? (rs.reduce((n, r) => n + r.rating, 0) / rs.length).toFixed(1) : "0" };
}

const SQUINT_TYPES = [["question", 3], ["made", 3], ["care", 2], ["correction", 1], ["price", 1], ["thanks", 1]];
const MUTTER_TYPES = [["notice", 2], ["seasonal", 2], ["question", 2], ["made", 2], ["care", 1], ["price", 1], ["thanks", 1], ["correction", 1]];

/** Picks a caption nobody has used this year. Tries other products, then other kinds, before giving up. */
function pickCaption(ctx, rng, network, date, products, used) {
  const counts = ctx.captionCounts;
  const leastUsed = (texts) => { const m = Math.min(...texts.map((t) => counts.get(t) || 0)); return texts.filter((t) => (counts.get(t) || 0) === m); };
  const social = ctx.data.social;
  const limit = network === "squint" ? 2200 : 280;
  let types = network === "squint" ? SQUINT_TYPES : MUTTER_TYPES;
  // WHY: a product that is restocked every few days is not news, so "back in stock" needs a gap of three weeks.
  const back = products.filter((p) => ctx.gapToday.has(p.id));
  const tries = [];
  if (back.length && rng.chance(0.6)) tries.push(["back", back]);
  let pool = types.slice();
  while (pool.length) {
    const type = rng.weighted(pool);
    pool = pool.filter(([t]) => t !== type);
    tries.push([type, products]);
  }
  for (const [type, from] of tries) {
    if (type === "notice" || type === "seasonal") {
      const lines = type === "notice" ? social.notice : social.seasonal[date.slice(5, 7)];
      const p = rng.pick(products);
      const texts = lines.map((l) => fill(l, { product: p.name })).filter((t) => !used.has(t));
      if (texts.length) return { text: rng.pick(leastUsed(texts)), type, product: type === "seasonal" ? p : null };
      continue;
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const p = rng.pick(from);
      if (network === "squint" && !ctx.data.images[p.id]?.length) continue;
      const texts = captionsFor(ctx, type, p, date).filter((t) => t.length <= limit && !used.has(t));
      if (texts.length) return { text: rng.pick(leastUsed(texts)), type, product: p };
    }
  }
  return null;
}

/** The company-post walk for one seed, kept between calls so each new day is one more step. */
function companyStore(ctx) {
  if (!ctx.cache.company) ctx.cache.company = new Map();
  const key = String(ctx.seed);
  let cs = ctx.cache.company.get(key);
  if (!cs || cs.data !== ctx.data || cs.first !== ctx.firstDate) {
    cs = { data: ctx.data, first: ctx.firstDate, last: null, year: null, used: new Set(), counts: new Map(), lastSeen: new Map(), byDay: new Map() };
    ctx.cache.company.set(key, cs);
  }
  return cs;
}

/** Products whose goods arrived on `date`, but only if they had not been restocked in the last three weeks. */
function restockedOn(ctx, cs, date) {
  const ids = new Set();
  for (let d = addDays(date, -60); d <= date; d = addDays(d, 1)) {
    for (const po of onDay(ctx, "purchase_orders", d)) {
      if (!po.received_at || dayOf(po.received_at) !== date) continue;
      for (const l of po.lines) { const id = ctx.data.skuProduct?.[l.sku]?.id; if (id) ids.add(id); }
    }
  }
  const gap = new Set();
  for (const id of [...ids].sort()) {
    if (!cs.lastSeen.has(id) || (msOf(date) - msOf(cs.lastSeen.get(id))) / DAY_MS >= 21) gap.add(id);
    cs.lastSeen.set(id, date);
  }
  return gap;
}

/**
 * The company's own posts. Captions are never repeated within a calendar year and the least-used caption
 * across years is preferred, so the walk always runs from the first day in order. It is kept in the cache and
 * only the days since the last call are walked.
 */
function companyPosts(ctx, series) {
  const social = ctx.data.social;
  const author = companyAuthor(ctx.data);
  const cs = companyStore(ctx);
  ctx.captionCounts = cs.counts;
  const launchOf = new Map();
  for (const c of ctx.state.campaigns || []) {
    const m = c.name.match(/^Launch: (.*)$/);
    const p = m && ctx.data.products.find((x) => x.name.includes(m[1]) || m[1].includes(x.name));
    if (p) launchOf.set(`${c.start}|${p.id}`, c);
  }
  const emit = (r) => {
    const rec = socialRec(r);
    const day = dayOf(rec.at);
    if (!cs.byDay.has(day)) cs.byDay.set(day, []);
    cs.byDay.get(day).push(rec);
  };
  const useCaption = (t) => { cs.used.add(t); cs.counts.set(t, (cs.counts.get(t) || 0) + 1); };
  for (const date of datesBetween(cs.last ? addDays(cs.last, 1) : ctx.firstDate, ctx.to)) {
    if (cs.year !== date.slice(0, 4)) { cs.year = date.slice(0, 4); cs.used = new Set(); }
    const used = cs.used;
    ctx.gapToday = restockedOn(ctx, cs, date);
    cs.last = date;
    {
      const f = series.get(date) || { squint: 10, mutter: 8 };
      const rng = rngFor(ctx.seed, "social-company", date);
      const factor = isWorkday(date) ? 1 : WEEKEND_FACTOR;
      const products = launchedProducts(ctx, date);
      for (const [k, cmp] of launchOf) {
        if (!k.startsWith(`${date}|`)) continue;
        const p = ctx.data.products.find((x) => `${date}|${x.id}` === k);
        const texts = captionsFor(ctx, "new", p, date);
        for (const network of ["squint", "mutter"]) {
          const lr = rngFor(ctx.seed, "social-launch", cmp.id, network);
          const imgs = ctx.data.images[p.id] || [];
          const fresh = texts.filter((t) => !used.has(t));
          const text = lr.pick(fresh.length ? fresh : texts);
          useCaption(text);
          emit({ key: `social|${network}|launch|${cmp.id}`, network, author, kind: "post", at: timeOn(date, lr, 9, 11), text, image: network === "squint" && imgs.length ? lr.pick(imgs) : null, likes: likesFor(lr, f[network], 0.05, 0.12), reposts: network === "mutter" ? lr.int(0, 6) : 0, links: { product_id: p.id, campaign_id: cmp.id } });
        }
      }
      for (const cmp of ctx.state.campaigns || []) {
        if (cmp.start !== date || /^Launch/.test(cmp.name) || !rngFor(ctx.seed, "social-cmp", cmp.id).chance(0.7)) continue;
        const cr = rngFor(ctx.seed, "social-cmp-text", cmp.id);
        const text = fill(cr.pick(social.campaign), { campaign: cmp.name, caveat: cr.pick(social.caveats) });
        useCaption(text);
        emit({ key: `social|mutter|campaign|${cmp.id}`, network: "mutter", author, kind: "post", at: timeOn(date, cr, 9, 12), text, likes: likesFor(cr, f.mutter, 0.01, 0.04), reposts: cr.int(0, 5), links: { campaign_id: cmp.id } });
      }
      if (!products.length) continue;
      for (const [network, chance] of [["squint", SQUINT_POST_CHANCE], ["mutter", MUTTER_POST_CHANCE]]) {
        if (!rng.chance(chance * factor)) continue;
        const pick = pickCaption(ctx, rng, network, date, products, used);
        if (!pick) continue;
        useCaption(pick.text);
        const image = network === "squint" ? rng.pick(ctx.data.images[pick.product.id]) : null;
        emit({
          key: `social|${network}|${date}`, network, author, kind: "post", at: timeOn(date, rng, network === "squint" ? 10 : 9, network === "squint" ? 16 : 17), text: pick.text, image,
          likes: likesFor(rng, f[network], network === "squint" ? 0.03 : 0.01, network === "squint" ? 0.09 : 0.04), reposts: network === "mutter" ? rng.int(0, 5) : 0,
          links: pick.product ? { product_id: pick.product.id } : {},
        });
      }
    }
  }
  // Hand back the posts of the window, and the few days before it that comments and statistics hang off.
  ctx.companyPostCandidates = [];
  const wide = { ...ctx, from: addDays(ctx.from, -3) };
  for (let d = wide.from; d <= ctx.to; d = addDays(d, 1)) {
    for (const stored of cs.byDay.get(d) || []) {
      if (dayOf(stored.at) < wide.from || dayOf(stored.at) > ctx.to || isFuture(ctx, stored.at)) continue;
      // WHY: a copy, because numbering writes an id into the record and the cached original must stay unnumbered.
      const rec = { ...stored };
      ctx.companyPostCandidates.push(rec);
      if (inWindow(ctx, rec.at)) ctx.social.push(rec);
    }
  }
}

/** Comments from customers on the company's own posts. Anchored on the post, filtered by the window. */
function commentsOnCompanyPosts(ctx, series) {
  const bank = ctx.data.social;
  const keys = new Set();
  const posts = ctx.companyPostCandidates;
  for (const post of posts) {
    const rng = rngFor(ctx.seed, "social-comments", post.key);
    const date = dayOf(post.at);
    const n = rng.weighted([[0, 0.55], [1, 0.3], [2, 0.12], [3, 0.03]]);
    for (let i = 0; i < n; i++) {
      const who = pickCustomer(ctx, rng, date);
      if (!who) continue;
      const at = plusMinutes(post.at, rng.int(20, 2800));
      keys.add(`${post.key}|c${i}`);
      const prod = ctx.data.products.find((x) => x.id === post.links.product_id);
      const lines = bank.customer_comment.filter((l) => l.includes("{product}") === !!prod);
      let text = fill(rng.pick(lines), { product: prod ? plain(prod.name) : "this" });
      if (rng.chance(0.5)) text = rng.pick(bank.comment_openers) + text.charAt(0).toLowerCase() + text.slice(1);
      if (rng.chance(0.6)) text += ` ${rng.pick(bank.customer_extra)}`;
      addSocial(ctx, { key: `${post.key}|c${i}`, network: post.network, author: customerAuthor(ctx.data, who), kind: "comment", at, text, parent_key: post.key, likes: rng.int(0, 4), links: { ...post.links, customer_id: who.id } });
    }
  }
}

/** Customers who tag the shop after a delivery or a review, and the company's answers. */
function customerPosts(ctx) {
  const bank = ctx.data.social;
  const author = companyAuthor(ctx.data);
  const post = (key, rng, c, network, kind, text, at, links, answer) => {
    addSocial(ctx, { key, network, author: customerAuthor(ctx.data, c), kind: "post", text, at, likes: rng.int(0, 14), reposts: network === "mutter" ? rng.int(0, 3) : 0, mentions_shop: true, links: { ...links, customer_id: c.id } });
    if (!rng.chance(answer)) return;
    const bad = kind === "bad";
    const who = bad ? "S-06" : "S-10";
    addSocial(ctx, { key: `${key}|reply`, network, author, kind: "reply", at: plusMinutes(at, rng.int(60, 1200)), text: `${rng.chance(0.8) ? `@${handleFor(c, bank.handle_bits)} ` : ""}${rng.pick(bad ? bank.company_reply_bad : bank.company_reply_good)}${rng.chance(0.5) ? ` ${rng.pick(bank.dm_signoffs[who])}` : ""}`, parent_key: key, links: { ...links, customer_id: c.id }, reposts: 0, likes: rng.int(0, 5), by: who });
  };
  for (const o of recentList(ctx, "orders")) {
    if (!recent(ctx, o.placed_at)) continue;
    const c = ctx.customers.get(o.customer_id);
    if (!c || ctx.staffNames.has(c.name) || o.status === "cancelled") continue;
    for (const s of o.shipments || []) {
      if (!s.delivered_at) continue;
      const rng = rngFor(ctx.seed, "social-delivered", s.id);
      const late = s.eta && dayOf(s.delivered_at) > s.eta;
      const network = rng.chance(0.55) ? "squint" : "mutter";
      const links = { order: o.number, product_id: ctx.productId(o.items[0]) };
      const slots = { product: plain(ctx.productName(o.items[0])), days: Math.max(1, Math.round((msOf(s.delivered_at) - msOf(o.placed_at)) / DAY_MS)), shop: bank.shop_handle };
      const at = plusMinutes(s.delivered_at, rng.int(300, 3600));
      if (late && rng.chance(0.2)) {
        post(`social|${network}|late|${s.id}`, rng, c, network, "bad", fill(rng.pick(bank.customer_late), slots), at, links, 0.8);
      } else if (rng.chance(o.totals.total >= BIG_ORDER_TOTAL ? CUSTOMER_POST_CHANCE_BIG : CUSTOMER_POST_CHANCE)) {
        const ok = rng.chance(0.2);
        post(`social|${network}|got|${s.id}`, rng, c, network, "good", (rng.chance(0.7) ? `${fill(rng.pick(bank.customer_lead), slots)} ` : "") + fill(rng.pick(ok ? bank.customer_ok : bank.customer_good), slots) + (rng.chance(0.85) ? ` ${rng.pick(bank.customer_extra)}` : ""), at, links, 0.5);
      }
    }
  }
  for (const rv of recentList(ctx, "reviews")) {
    if (!recent(ctx, rv.date)) continue;
    const c = ctx.customers.get(rv.customer_id);
    const rng = rngFor(ctx.seed, "social-review", rv.id);
    if (!c || ctx.staffNames.has(c.name)) continue;
    const p = ctx.data.products.find((x) => x.id === rv.product);
    const slots = { product: plain(p ? p.name : rv.product), days: rng.int(3, 40), shop: bank.shop_handle };
    const at = timeOn(rv.date, rng, 10, 21);
    const links = { order: rv.order_number, product_id: rv.product };
    const network = rng.chance(0.5) ? "squint" : "mutter";
    if (rv.rating >= 4 && rng.chance(0.22)) post(`social|${network}|review|${rv.id}`, rng, c, network, "good", fill(rng.pick(bank.customer_good), slots), at, links, 0.5);
    else if (rv.rating <= 2 && rng.chance(0.35)) post(`social|mutter|review|${rv.id}`, rng, c, "mutter", "bad", fill(rng.pick(bank.customer_bad), slots), at, links, 0.8);
  }
}

/** Direct messages: a question from a customer and, usually, an answer the same day. */
function socialMessages(ctx) {
  const bank = ctx.data.social;
  const author = companyAuthor(ctx.data);
  // WHY: an answer can wait until the next working day, so the day that wrote it may be four days before the window.
  for (const date of datesBetween(addDays(ctx.from, -4), ctx.to)) {
    if (date < ctx.firstDate) continue;
    for (const network of ["squint", "mutter"]) {
      const rng = rngFor(ctx.seed, "social-dm", network, date);
      if (!rng.chance(DM_QUESTION_CHANCE)) continue;
      const c = pickCustomer(ctx, rng, date);
      if (!c) continue;
      const orders = (ctx.ordersByCustomer.get(c.id) || []).filter((o) => dayOf(o.placed_at) <= date);
      const o = orders[orders.length - 1];
      const products = launchedProducts(ctx, date);
      const p = products.length ? rng.pick(products) : null;
      // WHY: the answer is chosen by the question's topic, so a guarantee question never gets a delivery answer.
      const [, topic] = rng.pick(Object.entries(bank.dm_topics).filter(([, t]) => !t.needs_order || o));
      const slots = { product: plain(p ? p.name : "Spare Sock"), order: o ? o.number : "" };
      const thread = `dm-${network}-${c.id}-${date}`;
      const at = timeOn(date, rng, 9, 20);
      const links = { customer_id: c.id };
      if (o) links.order = o.number;
      const q = [rng.pick(bank.dm_greetings), fill(rng.pick(topic.q), slots), rng.pick(bank.dm_closers)].filter(Boolean).join(" ");
      addSocial(ctx, { key: `social|${network}|dm|${date}|in`, network, author: customerAuthor(ctx.data, c), kind: "dm", text: q, at, thread, links });
      if (rng.chance(0.85)) {
        const who = rng.pick(["S-06", "S-07", "S-08", "S-10"]);
        const a = [rng.chance(0.7) ? fill(rng.pick(bank.dm_answer_greetings), { first: firstWord(c.name) }) : "", fill(rng.pick(topic.a), slots), rng.chance(0.7) ? rng.pick(bank.dm_signoffs[who]) : ""].filter(Boolean).join(" ");
        addSocial(ctx, { key: `social|${network}|dm|${date}|out`, network, author, kind: "dm", text: a, at: fitPoster(ctx, who, plusMinutes(at, rng.int(10, 600)), rng), thread, links, by: who });
      }
    }
  }
}

function socialStats(ctx, series) {
  for (const date of datesBetween(ctx.from, ctx.to)) {
    const f = series.get(date);
    if (!f) continue;
    for (const network of ["squint", "mutter"]) {
      const rng = rngFor(ctx.seed, "social-stats", network, date);
      const followers = f[network];
      const posted = ctx.companyPostCandidates.filter((p) => p.network === network && dayOf(p.at) === date).length;
      const reach = Math.round(followers * rng.between(0.05, 0.12) + posted * followers * rng.between(0.08, 0.2));
      const engagement = Math.round(reach * rng.between(0.02, 0.07));
      ctx.stats.push({ key: `stats|${network}|${date}`, date, network, followers, reach, engagement, posts: posted });
    }
  }
}

// ---------------------------------------------------------------- putting it together

/** Keys, ids and the highest number of a list of messages, topped up from the end of the list. */
function messageIndex(ctx, name) {
  const list = ctx.state[name] || [];
  let m = ctx.cache.messages[name];
  if (!m || m.list !== list) m = ctx.cache.messages[name] = { list, n: 0, keys: new Set(), max: 0, ids: new Map() };
  for (; m.n < list.length; m.n++) {
    const r = list[m.n];
    m.keys.add(r.key); m.ids.set(r.key, r.id);
    const t = tailNumber(r.id);
    if (t > m.max) m.max = t;
  }
  return m;
}

/** Orders records by time and gives each a number that carries on from the highest already in the state. */
function numberRecords(list, index, prefix, width = 6) {
  const fresh = list.filter((r) => !index.keys.has(r.key)).sort((a, b) => (a.at === b.at ? (a.key < b.key ? -1 : 1) : a.at < b.at ? -1 : 1));
  let n = index.max;
  for (const r of fresh) r.id = `${prefix}-${String(++n).padStart(width, "0")}`;
  return fresh;
}

/** Turns parent_key into the parent's id when the parent is in this batch or already in the state. */
function resolveParents(list, index, field = "parent") {
  const batch = new Map(list.map((r) => [r.key, r.id]));
  for (const r of list) r[field] = r.parent_key ? batch.get(r.parent_key) || index.ids.get(r.parent_key) || null : null;
}

/**
 * Derives the new mail, chat and social records for things dated from..to (inclusive, "YYYY-MM-DD").
 * @param {object} state World state: commerce records, plus any emails, chat_messages, social_posts already there.
 * @param {{from: string, to: string, seed: (string|number), data: object}} opts `data` is loadCommsData's result.
 * @returns {{emails: object[], chat_messages: object[], social_posts: object[], social_stats_daily: object[]}}
 */
export function deriveComms(state, { from, to, seed, data }) {
  const ctx = makeContext(state, { from: dayOf(from), to: dayOf(to), seed, data });
  ctx.firstDate = firstActiveDate(ctx);
  orderMails(ctx);
  customerMails(ctx);
  conversationMails(ctx);
  supplierMails(ctx);
  newsletterMails(ctx);
  outsideMails(ctx);
  internalMails(ctx);
  orderChat(ctx);
  stockChat(ctx);
  customerChat(ctx);
  moneyChat(ctx);
  everydayChat(ctx);
  // Social: company posts first, because comments and statistics hang off them.
  const series = ctx.firstDate <= ctx.to ? followerSeries(ctx) : new Map();
  companyPosts(ctx, series);
  commentsOnCompanyPosts(ctx, series);
  customerPosts(ctx);
  socialMessages(ctx);
  socialStats(ctx, series);

  const emails = numberRecords(ctx.emails, messageIndex(ctx, "emails"), "EM");
  const chat = numberRecords(ctx.chat, messageIndex(ctx, "chat_messages"), "CH");
  const socialIdx = messageIndex(ctx, "social_posts");
  const social = numberRecords(ctx.social, socialIdx, "SP");
  resolveParents(chat, messageIndex(ctx, "chat_messages"), "thread_parent");
  resolveParents(social, socialIdx, "parent");
  const have = messageIndex(ctx, "social_stats_daily").keys;
  const stats = ctx.stats.filter((r) => !have.has(r.key));
  return { emails, chat_messages: chat, social_posts: social, social_stats_daily: stats };
}
