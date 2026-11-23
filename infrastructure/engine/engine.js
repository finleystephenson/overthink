// Overthought & Co. business engine.
// One plain ES module. No dependencies, no Node-only APIs, no clock, no randomness.
// Every rule number is read from the `business` object passed to createWorld.
// See docs/data-model.md for the spec.

// ---------------------------------------------------------------- small helpers

const DAY = 86400000;
const HOUR = 3600000;
const clone = (x) => JSON.parse(JSON.stringify(x ?? null));
const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => "£" + (Number.isInteger(n) ? n : n.toFixed(2));

/** A rule broken or a lookup failed. Thrown by handlers, turned into { ok:false } by session.call. */
class Fail extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}
const fail = (code, message, extra) => {
  throw new Fail(code, message, extra);
};

// ---- dates (all UTC; bank holidays are not modelled)

const ms = (s) => Date.parse(s);
const isoOf = (t) => new Date(t).toISOString().replace(".000Z", "Z");
const dateOf = (t) => new Date(t).toISOString().slice(0, 10);
const isDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isIsoString = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z)?$/.test(s);
const isWorkday = (t) => { const d = new Date(t).getUTCDay(); return d >= 1 && d <= 5; };

/** Add days to an ISO date or datetime, keeping its format. */
function addDays(s, n) {
  const t = ms(s) + n * DAY;
  return isDateOnly(s) ? dateOf(t) : isoOf(t);
}

/** Add Monday-to-Friday days. Returns a date (YYYY-MM-DD). */
function addWorkingDays(s, n) {
  let t = ms(s);
  while (n > 0) {
    t += DAY;
    if (isWorkday(t)) n--;
  }
  return dateOf(t);
}

/** Next working day strictly after the given time. */
const nextWorkday = (t) => ms(addWorkingDays(dateOf(t), 1));

/** Add whole months, clamping to the end of a shorter month. */
function addMonths(s, months) {
  const d = new Date(ms(s));
  const target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
  const last = new Date(Date.UTC(new Date(target).getUTCFullYear(), new Date(target).getUTCMonth() + 1, 0)).getUTCDate();
  return dateOf(target + (Math.min(d.getUTCDate(), last) - 1) * DAY);
}

/** Whole calendar days from a to b (negative if b is earlier). */
const daysBetween = (a, b) => Math.round((ms(dateOf(ms(b))) - ms(dateOf(ms(a)))) / DAY);

/** Shift every ISO date or datetime string in a value by n days. */
function shiftDates(value, n) {
  if (n === 0) return value;
  if (typeof value === "string") return isIsoString(value) ? addDays(value, n) : value;
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, n));
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = shiftDates(value[k], n);
    return out;
  }
  return value;
}

// ---------------------------------------------------------------- indexes over the catalogue

function buildIndex(products) {
  const skus = {};
  const byId = {};
  for (const p of products) {
    byId[p.id] = p;
    for (const v of p.variants || []) skus[v.sku] = { product: p, item: v, kind: "variant" };
    for (const a of p.accessories || []) skus[a.sku] = { product: p, item: a, kind: a.kind || "accessory" };
  }
  return { skus, byId };
}

function initialStock(products) {
  const stock = {};
  for (const p of products) {
    for (const x of [...(p.variants || []), ...(p.accessories || [])]) {
      stock[x.sku] = { on_hand: x.stock ?? 0, restock_date: x.restock_date ?? null };
    }
  }
  return stock;
}

/** Products' own dates (preorder, restock) move with the seed. */
function shiftProduct(p, n) {
  const q = clone(p);
  if (q.available_from) q.available_from = addDays(q.available_from, n);
  for (const x of [...(q.variants || []), ...(q.accessories || [])]) {
    if (x.restock_date) x.restock_date = addDays(x.restock_date, n);
  }
  return q;
}

// ---------------------------------------------------------------- ids

/** Highest numeric tail among existing ids, so new ids are "the next number in sequence". */
function maxTail(list, field) {
  let max = 0;
  for (const r of list) {
    const m = String(r[field]).match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function initialCounters(st) {
  return {
    "ORD": maxTail(st.orders, "number"), "RET": maxTail(st.returns, "number"),
    "FIX": maxTail(st.repairs, "number"), "REG": maxTail(st.registrations, "id"),
    "BKG": maxTail(st.bookings, "number"), "CASE": maxTail(st.cases, "number"),
    "CONV": maxTail(st.conversations, "id"), "C": maxTail(st.customers, "id"),
    "PO": maxTail(st.purchase_orders, "number"), "SC": maxTail(st.stock_counts, "id"),
    "MV": maxTail(st.stock_movements, "id"), "LED": maxTail(st.ledger, "id"),
  };
}

/** Back-office collections from a generated world. Empty when the engine runs on business/data/seed. */
const BACK_OFFICE = ["suppliers", "purchase_orders", "stock_movements", "stock_counts", "ledger", "monthly_summary", "campaigns", "web_sessions_daily", "contacts", "documents", "price_history", "reviews", "prospects", "outreach"];

function nextId(ctx, prefix, width = 0) {
  ctx.st.counters[prefix] = (ctx.st.counters[prefix] || 0) + 1;
  return `${prefix}-${String(ctx.st.counters[prefix]).padStart(width, "0")}`;
}

// ---------------------------------------------------------------- the world

export function createWorld({ business, products = [], services = [], policies = [], help = [], seed = {}, now } = {}) {
  business = clone(business);
  const nowIso = now || business.sim.anchor_now;
  const shift = Math.round((ms(nowIso) - ms(business.sim.anchor_now)) / DAY);

  const prods = products.map((p) => shiftProduct(p, shift));
  const svcs = {};
  for (const s of services) svcs[s.id] = shiftDates(clone(s), shift);

  const sd = shiftDates(clone(seed), shift);
  const st = {
    now: nowIso,
    customers: sd.customers || [], orders: sd.orders || [], returns: sd.returns || [],
    registrations: sd.registrations || [], repairs: sd.repairs || [], bookings: sd.bookings || [],
    cases: sd.cases || [], conversations: sd.conversations || [],
    // A generated world (business/data/world/<size>) brings its own stock and the back-office records.
    stock: sd.stock || initialStock(prods), audit: [], counters: {},
    company: sd.company || null,
  };
  for (const k of BACK_OFFICE) st[k] = sd[k] || [];
  // WHY: the wider world's history (world_news.json, built by simulation/world/build-history.mjs) is news too, so The Daily
  // Overthinker reports it. Its ids carry on after news.json's, so the two lists join without clashes.
  if (Array.isArray(st.news) && Array.isArray(sd.world_news) && sd.world_news.length) {
    const have = new Set(st.news.map((n) => n.id));
    st.news = [...st.news, ...sd.world_news.filter((n) => !have.has(n.id))].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  }
  st.product_status = {};
  st.counters = initialCounters(st);
  for (const [prefix, key, field] of EXTRA_COUNTERS) st.counters[prefix] = maxTail(st[key] || [], field);
  // WHY: shifting dates moves each entry's "at" but not its "month" label, so both are redone to keep the books true.
  if (shift !== 0 && st.ledger.length) {
    for (const e of st.ledger) e.month = e.at.slice(0, 7);
    refreshSummary(st, "");
  }

  const world = {
    business, services: svcs, policies: clone(policies),
    help: Array.isArray(help) ? clone(help) : clone(help?.articles || []),
    products: prods, index: buildIndex(prods), shift, state: st,
    tools: TOOLS.map(({ name, description, input_schema, roles }) => ({ name, description, input_schema, roles })),
    session: (opts) => makeSession(world, opts),
    setNow: (iso) => { world.state.now = iso; },
  };
  return world;
}

/** Restore a saved state (object or JSON string), e.g. from localStorage. */
export function loadState(world, json) {
  const st = typeof json === "string" ? JSON.parse(json) : clone(json);
  world.state = st;
  return world;
}

// ---------------------------------------------------------------- sessions and the call wrapper

const STAFF = ["support_agent", "support_lead", "technician", "coordinator", "warehouse", "buyer", "finance", "marketing", "manager"];
const ALL_ROLES = ["customer", "assistant", ...STAFF, "operations_assistant"];
/** Everyone inside the company, people and the operations assistant. Never the customer or the customer-facing assistant. */
const INTERNAL = [...STAFF, "operations_assistant"];
/** Stock, suppliers and purchase orders. Includes unit costs, so never customer-facing. */
const STOCK_READERS = ["buyer", "manager", "operations_assistant", "warehouse", "finance"];
const MONEY_READERS = ["finance", "manager"];
const MARKETING_READERS = ["marketing", "manager", "finance"];
/** Prospects and outreach: the people who look for new business. */
const SALES = ["marketing", "manager"];
/** Outreach rules (see send_outreach). */
const OUTREACH_GAP_DAYS = 14, OUTREACH_MAX_DISCOUNT = { marketing: 10, manager: 20 };
const OUTREACH_CHANNELS = ["email", "letter", "phone", "visit"];
/** Customer read tools the manager can also use. */
const CUSTOMER_READERS = ["customer", "assistant", "support_agent", "support_lead", "manager"];
const CUSTOMER_ROLES = ["customer", "assistant", "support_agent", "support_lead"];

/**
 * Lenses: views of the whole world for the explorer and the lab, not jobs in the business. A lens may call only the
 * tools that name it (simulation/world/extension.js, simulation/world/people.js), never the business tools, and the server never offers it.
 */
const LENSES = ["world"];

function makeSession(world, { role, customer_id = null } = {}) {
  if (!ALL_ROLES.includes(role) && !LENSES.includes(role)) throw new Error(`Unknown role: ${role}`);
  const sess = { role, customer_id, failures: 0, locked: false };
  return { call: (tool, input) => runTool(world, sess, tool, input), info: () => ({ role, customer_id: sess.customer_id }) };
}

function runTool(world, sess, toolName, rawInput) {
  const st = world.state;
  const input = clone(rawInput ?? {});
  const ctx = { world, st, business: world.business, role: sess.role, sess, changes: [], now: st.now, dirty: null };
  let result;
  try {
    const tool = TOOLS.find((t) => t.name === toolName);
    if (!tool) fail("not_found", `There is no tool called "${toolName}".`);
    if (!tool.roles.includes(sess.role)) {
      fail("forbidden", `The ${sess.role} role is not allowed to use ${toolName}. If the customer needs this, hand the case to a person.`);
    }
    if (tool.needs_customer && !sess.customer_id && !STAFF.includes(sess.role)) {
      fail("not_verified", "This person has not been verified yet. Verify them with an order, booking, repair or return number plus the email or postcode on it.");
    }
    if (sess.role === "customer" && !sess.customer_id && tool.roles !== OPEN && tool.name !== "create_customer") {
      fail("not_verified", "Sign in or create an account first. Without one only the open tools and create_customer work.");
    }
    validate(tool.input_schema, input);
    result = { ok: true, data: clone(tool.run(ctx, input)) };
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    result = { ok: false, error: { code: e.code, message: e.message, ...e.extra } };
  }
  // Live figures: any month that gained an entry (or an order) has its summary row worked out again from the ledger.
  // WHY: a long simulation posts thousands of entries; world.lazySummary defers the monthly rows until a tool reads them (flushSummary).
  if (ctx.dirty) { if (world.lazySummary) world.dirtyFrom = !world.dirtyFrom || ctx.dirty < world.dirtyFrom ? ctx.dirty : world.dirtyFrom; else refreshSummary(st, ctx.dirty); }
  st.audit.push({
    at: st.now, role: sess.role, customer_id: sess.customer_id, tool: toolName, input,
    ok: result.ok, error_code: result.ok ? null : result.error.code, changes: ctx.changes,
  });
  return result;
}

/** Minimal JSON Schema check: required, type, enum. Enough to protect the handlers. */
function validate(schema, input) {
  for (const key of schema.required || []) {
    if (input[key] === undefined || input[key] === null) fail("invalid_input", `Missing "${key}".`);
  }
  for (const [key, def] of Object.entries(schema.properties || {})) {
    const v = input[key];
    if (v === undefined || v === null) continue;
    const ok = def.type === "array" ? Array.isArray(v)
      : def.type === "integer" ? Number.isInteger(v)
      : def.type === "object" ? typeof v === "object" && !Array.isArray(v)
      : typeof v === def.type;
    if (!ok) fail("invalid_input", `"${key}" must be a ${def.type}.`);
    if (def.enum && !def.enum.includes(v)) fail("invalid_input", `"${key}" must be one of: ${def.enum.join(", ")}.`);
  }
}

// ---------------------------------------------------------------- record helpers used by many tools

/** Record a change for the audit log. */
const note = (ctx, text) => ctx.changes.push(text);

/** Set a field and write "label field old → new" to the audit. */
function setField(ctx, label, obj, key, value) {
  note(ctx, `${label} ${key} ${obj[key] ?? "none"} → ${value}`);
  obj[key] = value;
}

/** The customer this call is about. Staff sessions without one must say who. */
function who(ctx, input = {}) {
  const id = ctx.sess.customer_id || input.customer_id;
  if (!id) fail("invalid_input", "Say which customer this is for (customer_id).");
  return id;
}

/** Find a record. Wrong customer looks exactly like "no such record" so we never leak. */
function findOwned(ctx, list, field, id, label) {
  const rec = list.find((r) => r[field] === id);
  const scoped = ctx.sess.customer_id;
  if (!rec || (scoped && rec.customer_id !== scoped)) {
    fail("not_found", `There is no ${label} ${id} on this account. Check the number with the customer.`);
  }
  return rec;
}

/**
 * The order a customer-facing tool acts on. Staff may name the customer (customer_id) instead of verifying the
 * session; then the order must be that customer's, and a mismatch looks like "no such order", as for a customer.
 */
function orderFor(ctx, i) {
  const o = findOwned(ctx, ctx.st.orders, "number", i.order_number, "order");
  if (i.customer_id && o.customer_id !== i.customer_id) fail("not_found", `There is no order ${i.order_number} on this account. Check the number with the customer.`);
  return o;
}

const getCustomer = (ctx, id) => ctx.st.customers.find((c) => c.id === id);
const historyAdd = (ctx, rec, event) => (rec.history = rec.history || []).push({ at: ctx.now, event });
const stockOf = (ctx, sku) => ctx.st.stock[sku] || { on_hand: 0, restock_date: null };

// ---------------------------------------------------------------- effects: the only place stock and money change
// WHY: every tool (website, staff, a connected AI) changes stock and money through moveStock and postLedger, so stock
// on hand always equals the sum of its movements and every pound has a ledger entry. The records have exactly the
// shapes, id formats and signs that business/builder/world writes, so run-time and historical records are the same kind of thing.

/** Card fee per payment: 1.5% plus 20p. WHY: the generator's rate (business/builder/world/money.mjs), so old and new orders cost the same. */
const FEE_RATE = 0.015, FEE_FIXED = 0.2;
/** What the carrier charges us per parcel, as in business/builder/world/money.mjs. */
const CARRIER_COST = { chilled: 6.8, "next-day": 5.1, standard: 2.9 };
const CARRIERS = { chilled: "Coldline Couriers", parcel: "Swiftway Parcels" };
/** Ledger types that are cash but not profit and loss. pay_later is money a customer owes: out when sold, in when settled. */
const CASH_ONLY = ["supplier_payment", "pay_later"];
/** Ledger types that are profit and loss but not cash. WHY: stock was paid for by supplier payments; credit is not money. */
const NOT_CASH = ["cost_of_goods", "goodwill_credit"];
const OPEX = ["payment_fee", "delivery_cost", "wages", "rent", "software", "marketing_spend", "goodwill_credit"];

const stamp = (ctx) => isoOf(ms(ctx.now));
const feeOn = (total) => round2(total * FEE_RATE + FEE_FIXED);

/** A number in [0, 1) from a string. WHY: "sometimes late" must be the same every run, with no Math.random (FNV-1a, as business/builder/world/rng.mjs). */
function frac(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

/** Unit cost of a SKU from its supplier, or 0 when the world has no suppliers (business/data/seed). */
function unitCost(ctx, sku) {
  const w = ctx.world;
  if (w.costSource !== ctx.st.suppliers) {
    w.costSource = ctx.st.suppliers;
    w.costs = {};
    for (const s of ctx.st.suppliers) for (const [k, v] of Object.entries(s.unit_cost || {})) w.costs[k] = v;
  }
  return w.costs[sku] || 0;
}

/** One ledger entry. Zero amounts are skipped, as the generator does. The month is marked for the summary to be redone. */
function postLedger(ctx, type, amount, reference) {
  amount = round2(amount);
  if (!amount) return null;
  const at = stamp(ctx);
  const e = { id: nextId(ctx, "LED", 6), at, type, amount, reference, month: at.slice(0, 7) };
  ctx.st.ledger.push(e);
  touchMonth(ctx, e.month);
  note(ctx, `ledger ${e.id} ${type} ${money(amount)} on ${reference}`);
  return e;
}

/** Marks a month whose summary row must be worked out again at the end of the call. */
/** Brings the monthly rows up to date when summaries were deferred (world.lazySummary). */
function flushSummary(ctx) {
  if (ctx.world.dirtyFrom) { const m = ctx.world.dirtyFrom; ctx.world.dirtyFrom = null; refreshSummary(ctx.st, m); }
}
function touchMonth(ctx, month) {
  if (!ctx.dirty || month < ctx.dirty) ctx.dirty = month;
}

/**
 * One stock movement. Stock never goes below zero. Every movement except a delivery from a supplier is also a cost of
 * goods entry (qty x unit cost, same sign): stock leaving costs money, stock coming back reverses it (money.mjs).
 */
function moveStock(ctx, sku, qty, reason, reference) {
  const s = ctx.st.stock[sku] || (ctx.st.stock[sku] = { on_hand: 0, restock_date: null });
  if (s.on_hand + qty < 0) fail("out_of_stock", `${sku} has only ${s.on_hand} in stock${s.restock_date ? `; due back ${s.restock_date}` : ""}.`);
  ctx.st.stock_movements.push({ id: nextId(ctx, "MV", 6), at: stamp(ctx), sku, qty, reason, reference });
  note(ctx, `stock ${sku} ${s.on_hand} → ${s.on_hand + qty} (${reason})`);
  s.on_hand += qty;
  if (s.on_hand > 0) s.restock_date = null;
  if (reason !== "received") postLedger(ctx, "cost_of_goods", qty * unitCost(ctx, sku), reference);
}

/**
 * Units of a SKU an order has taken off the shelf, by the validator's rule: nothing for a cancelled order, a parcel still
 * waiting for stock, or made-to-order food not yet sent. WHY: only what was really taken can be put back.
 */
function heldBy(ctx, o, sku) {
  if (o.status === "cancelled") return 0;
  let n = 0;
  for (const l of o.items) {
    if (l.sku !== sku) continue;
    const ship = (o.shipments || []).find((s) => s.skus.includes(sku));
    if ((ship && waiting(ship)) || (isMadeToOrder(ctx.world.index.skus[sku]) && !ship?.dispatched_at)) continue;
    n += l.qty;
  }
  return n;
}

/** Made to order: chilled-only products (sandwiches, ice) are made the morning they are sent, so they are never on a shelf. */
const isMadeToOrder = (e) => { const m = deliveryMethodsOf(e) || []; return m.length > 0 && m.every((x) => x === "chilled"); };

/** The sale, delivery income and card fee for an order that was paid (or approved for pay later), as money.mjs. */
function bookSale(ctx, o) {
  postLedger(ctx, "sale", o.totals.items - o.totals.discount, o.number);
  postLedger(ctx, "delivery_income", o.totals.delivery, o.number);
  postLedger(ctx, "payment_fee", -feeOn(o.totals.total), o.number);
}

function lookupSku(ctx, sku) {
  const hit = ctx.world.index.skus[sku];
  if (!hit) fail("not_found", `There is no product with SKU ${sku}.`);
  // WHY: prices can change at run time (change_price); the catalogue file keeps the launch price.
  return { ...hit, item: { ...hit.item, price: priceOf(ctx, sku) } };
}

// ---------------------------------------------------------------- product lifecycle and prices (kept in state so a saved run keeps them)

/** Today's price: the newest price change that has taken effect, else the catalogue price. */
function priceOf(ctx, sku) {
  const today = dateOf(ms(ctx.now));
  let price = ctx.world.index.skus[sku]?.item.price, date = "";
  for (const h of ctx.st.price_history || []) if (h.sku === sku && h.date <= today && h.date >= date) { price = h.new_price; date = h.date; }
  return price;
}

/** A product's status now: active, preorder, coming_soon, discontinued (or whatever the catalogue says). */
function statusOf(ctx, p) {
  return ctx.st.product_status?.[p.id]?.status ?? p.status;
}

/** Why a customer cannot order this SKU now, or null. WHY: a discontinued product stays in history but is not sold again. */
function notSellable(ctx, e, qty) {
  const life = ctx.st.product_status?.[e.product.id];
  const status = statusOf(ctx, e.product);
  if (status === "discontinued" && !(life?.sell_through && stockOf(ctx, e.item.sku).on_hand >= qty)) return `${e.product.name} is no longer sold.`;
  if (status === "coming_soon") return `${e.product.name} is not on sale yet. It is available from ${life?.available_from}.`;
  if (!["active", "preorder", "discontinued"].includes(status)) return `${e.product.name} is not on sale.`;
  return null;
}

/** Date a shipment reached the customer, or null. */
function arrivedAt(order, sku) {
  const s = (order.shipments || []).find((x) => (x.skus || []).includes(sku));
  if (!s) return null;
  return s.status === "delivered" ? s.delivered_at || null : null;
}

function openCaseRecord(ctx, { customer_id, subject, category, summary, related = {}, is_complaint = false, status = "open" }) {
  const rec = {
    number: nextId(ctx, "CASE"), customer_id, subject, category, status, is_complaint,
    complaint_stage: is_complaint ? 1 : null, opened_at: ctx.now, related, escalated_to: null,
    notes: summary ? [{ at: ctx.now, by: ctx.role, text: summary }] : [],
  };
  ctx.st.cases.push(rec);
  note(ctx, `case ${rec.number} created (${status})`);
  return rec;
}

function escalateCase(ctx, rec, to, reason) {
  setField(ctx, `case ${rec.number}`, rec, "status", "escalated");
  setField(ctx, `case ${rec.number}`, rec, "escalated_to", to);
  rec.notes.push({ at: ctx.now, by: ctx.role, text: `Escalated to ${to}: ${reason}` });
}

// ---------------------------------------------------------------- catalogue helpers

const tokens = (q) => String(q).toLowerCase().split(/[^a-z0-9£]+/).filter(Boolean);

function matches(text, words) {
  const t = String(text).toLowerCase();
  return words.length > 0 && words.every((w) => t.includes(w));
}

function priceRange(items) {
  const prices = items.map((i) => i.price).filter((p) => typeof p === "number");
  return prices.length ? { from: Math.min(...prices), to: Math.max(...prices) } : null;
}

function liveVariants(ctx, p) {
  return (p.variants || []).map((v) => ({ ...v, price: priceOf(ctx, v.sku), stock: stockOf(ctx, v.sku).on_hand, restock_date: stockOf(ctx, v.sku).restock_date }));
}

function resolveProduct(ctx, ref) {
  return ctx.world.index.byId[ref] || ctx.world.index.skus[ref]?.product || null;
}

// ---------------------------------------------------------------- delivery

/** Postcode areas we do not deliver to are listed in business.delivery.excluded_postcode_prefixes. */
function reachable(ctx, postcode) {
  const area = String(postcode).toUpperCase().replace(/\s+/g, "").match(/^[A-Z]{1,2}/)?.[0] || "";
  return !ctx.business.delivery.excluded_postcode_prefixes.includes(area);
}

/** An accessory's own delivery/returnable fields win; otherwise the parent product's. */
const deliveryMethodsOf = (e) => (e.item.delivery || e.product.delivery)?.methods;
const returnableOf = (e) => e.item.returnable || e.product.returnable;

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const minuteOfDay = (t) => new Date(t).getUTCHours() * 60 + new Date(t).getUTCMinutes();

/** Earliest and latest delivery dates for a method, from the rules' own wording and cutoffs. */
function deliveryDates(ctx, m) {
  const t = ms(ctx.now);
  if (m.cutoff) {
    const dispatchDays = m.id === "chilled" ? ctx.business.delivery.chilled_dispatch_weekdays : [1, 2, 3, 4, 5];
    let d = ms(dateOf(t));
    if (!(isWorkday(t) && minuteOfDay(t) < minutesOf(m.cutoff))) d += DAY;
    while (!dispatchDays.includes(new Date(d).getUTCDay())) d += DAY;
    return { earliest: dateOf(nextWorkday(d)), latest: null };
  }
  const days = (m.time.match(/\d+/g) || [2]).map(Number);
  return { earliest: addWorkingDays(ctx.now, Math.min(...days)), latest: addWorkingDays(ctx.now, Math.max(...days)) };
}

/** Which methods a basket of SKUs may use, and what they cost. */
function deliveryFor(ctx, skus, postcode) {
  const items = skus.map((s) => lookupSku(ctx, s));
  const total = items.reduce((n, i) => n + i.item.price, 0);
  const methods = ctx.business.delivery.methods;
  const chilled = items.some((i) => (deliveryMethodsOf(i) || []).includes("chilled"));
  let allowed = methods.map((m) => m.id);
  for (const i of items) {
    const list = deliveryMethodsOf(i);
    if (list && !(chilled && !list.includes("chilled"))) allowed = allowed.filter((id) => list.includes(id) || (chilled && id === "chilled"));
  }
  if (chilled) allowed = allowed.filter((id) => id === "chilled");
  if (!reachable(ctx, postcode)) allowed = [];
  return methods.filter((m) => allowed.includes(m.id)).map((m) => {
    const free = m.free_over !== null && total >= m.free_over;
    const dates = deliveryDates(ctx, m);
    return {
      id: m.id, name: m.name, price: free ? 0 : m.price, time: m.time, earliest_date: dates.earliest, latest_date: dates.latest,
      parcels: chilled && m.id === "chilled" && items.some((i) => !(deliveryMethodsOf(i) || []).includes("chilled")) ? 2 : 1,
      ...(m.note ? { note: m.note } : {}),
    };
  });
}

/** Price a basket: line totals, the delivery charge for the chosen method (null if not allowed) and the total. Pure; throws on unknown SKUs. */
function basketQuote(ctx, items, method, postcode) {
  const lines = items.map((l) => {
    const { product, item } = lookupSku(ctx, l.sku);
    if (!(l.qty >= 1)) fail("invalid_input", `Quantity for ${l.sku} must be at least 1.`);
    return { sku: l.sku, name: `${product.name}, ${item.name}`, qty: l.qty, unit_price: item.price, line_total: round2(item.price * l.qty) };
  });
  const methods = lines.length ? deliveryFor(ctx, lines.flatMap((l) => Array(l.qty).fill(l.sku)), postcode) : [];
  const chosen = methods.find((m) => m.id === method);
  const itemsTotal = round2(lines.reduce((n, l) => n + l.line_total, 0));
  return {
    lines, items_total: itemsTotal, delivery_method: method ?? null, delivery_charge: chosen ? chosen.price : null,
    total: chosen ? round2(itemsTotal + chosen.price) : null, methods, reachable: reachable(ctx, postcode),
  };
}

/** Shared by the bag page and delivery_options. items: [{ sku, qty }]. */
export function quoteBasket(world, { items, delivery_method, postcode }) {
  return basketQuote({ world, st: world.state, business: world.business, now: world.state.now, changes: [] }, items, delivery_method, postcode);
}

// ---------------------------------------------------------------- orders

const isBeforePacked = (ctx, order) => {
  const statuses = ctx.business.orders.statuses;
  return statuses.indexOf(order.status) < statuses.indexOf(ctx.business.orders.cancel_until) &&
    (order.shipments || []).every((s) => s.status === "pending");
};

function notPackedMessage(ctx, order, action) {
  if (order.status === "cancelled") return `Order ${order.number} is already cancelled.`;
  // WHY: a packed order cannot be stopped in the warehouse, but the law still lets the customer cancel by returning it.
  if (action === "cancel") return `Order ${order.number} is ${order.status}. ${ctx.business.orders.cancel_after_packed}`;
  return `Order ${order.number} is ${order.status}, so it cannot be changed any more. ${ctx.business.orders.cancel_after_packed}`;
}

// ---------------------------------------------------------------- ways to pay
// Every way to pay lives in business.payments.methods. A card's result comes from the test_cards table; every other
// method has a list of outcomes. Adding a method is adding data: nothing here names Tap, PayPost or Later.

const payMethods = (ctx) => ctx.business.payments.methods || [{ id: "card", name: "Card", kind: "card", explain: "", outcomes_from: "test_cards", outcomes: [] }];
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

/** Why this method can't pay for this basket, as plain sentences (empty when it can). Unknown totals or SKUs skip that check. */
function payBlocks(ctx, method, itemsTotal, skus) {
  const L = method.limits;
  if (!L) return [];
  const msg = L.messages || {};
  const out = [];
  const known = (skus || []).map((s) => ctx.world.index.skus[s]).filter(Boolean);
  // WHY: fresh food that only travels Cold is eaten within days, long before a 30-day payment is due.
  if (L.not_when_every_item_ships_by && known.length && known.every((e) => { const m = deliveryMethodsOf(e) || []; return m.length === 1 && m[0] === L.not_when_every_item_ships_by; })) {
    out.push(msg.not_when_every_item_ships_by || `${method.name} can't be used for this bag.`);
  }
  if (typeof itemsTotal === "number") {
    if (L.min_items_total != null && itemsTotal < L.min_items_total) out.push(fill(msg.min_items_total || `${method.name} is for orders of £{min} or more.`, { min: L.min_items_total, max: L.max_items_total }));
    if (L.max_items_total != null && itemsTotal > L.max_items_total) out.push(fill(msg.max_items_total || `${method.name} is for orders of up to £{max}.`, { min: L.min_items_total, max: L.max_items_total }));
  }
  return out;
}

/** A method's outcomes. Cards list their test cards, so a tester sees every result in one shape. */
const outcomesOf = (ctx, m) => (m.outcomes_from === "test_cards"
  ? (ctx.business.payments.test_cards || []).map((c) => ({ id: c.number, label: c.label, result: c.result === "paid" ? "paid" : "declined", message: c.message, brand: c.brand }))
  : m.outcomes || []);

/**
 * The outcome for a payment with no outcome named. WHY: the engine has no randomness, so the same calls always give
 * the same world. The order number's tail, times a large prime, picks a point in the total weight: over any run of
 * orders in a row the outcomes come out in the same shares as the weights, and a retry (a new order number) can differ.
 */
function pickOutcome(outcomes, orderNumber) {
  const total = outcomes.reduce((n, o) => n + (o.weight || 0), 0);
  if (!total) return outcomes[0];
  let at = (Number(String(orderNumber).match(/(\d+)$/)?.[1] || 0) * 7919) % total;
  for (const o of outcomes) { at -= o.weight || 0; if (at < 0) return o; }
  return outcomes[0];
}

const isPayLaterDue = (p) => p.status === "due";

/**
 * Money back on an order, through every refund path. A pay-later order that is not yet paid gets the amount taken off
 * what is owed instead: there is nothing to send back. `refunded` counts both, so "how much is left" works the same.
 */
function giveBack(ctx, o, amount, reference = o.number) {
  const p = o.payment, where = `order ${o.number}`;
  // WHY: money back never exceeds what was paid, whichever path asks for it.
  amount = Math.max(0, Math.min(round2(amount), round2(o.totals.total - p.refunded)));
  if (!amount) return { amount: 0, refund_amount: 0 };
  setField(ctx, where, p, "refunded", round2(p.refunded + amount));
  postLedger(ctx, "refund", -amount, reference);
  if (isPayLaterDue(p)) {
    // Nothing was paid yet, so what is owed falls instead: the refund is not money out.
    postLedger(ctx, "pay_later", amount, o.number);
    setField(ctx, where, p, "due", Math.max(0, round2(p.due - amount)));
    if (p.due <= 0) setField(ctx, where, p, "status", "nothing_due");
    return { amount, refund_amount: 0, due_cancelled: amount, still_due: p.due, due_date: p.due_date, how: `Nothing was paid yet, so ${money(amount)} was taken off what is owed. Still to pay: ${money(p.due)}${p.due ? ` by ${p.due_date}` : ""}.` };
  }
  setField(ctx, where, p, "status", p.refunded >= o.totals.total ? "refunded" : "part_refunded");
  return { amount, refund_amount: amount, refund_expected_by: addWorkingDays(ctx.now, ctx.business.payments.refund_time_working_days) };
}

// ---------------------------------------------------------------- returns

/**
 * Why this line cannot be returned, or null. flags.worn means worn, thrown, opened, unsealed or otherwise used.
 * Returns { code, message } to block, or { inspect: true, message } when it may come back but a person must inspect it.
 */
function returnBlock(ctx, order, line, flags) {
  const entry = lookupSku(ctx, line.sku);
  const { product } = entry;
  const returnable = returnableOf(entry);
  const arrived = arrivedAt(order, line.sku);
  const r = ctx.business.returns;
  // Exempt by law (CCRs reg 28): "always", or only once opened / unsealed.
  const exempt = (r.exempt_from_change_of_mind || []).find((e) => e.product === product.id);
  const conditional = exempt && exempt.when !== "always";
  if (exempt && !conditional) {
    if (product.category === "food") return { code: "not_returnable", message: `${product.name} is perishable food and cannot be returned to change your mind. If it arrived spoiled, tell us within ${ctx.business.problems.spoiled_quick_fix_hours} hours with a photo and a person will sort it. Your legal rights for faulty goods still apply.` };
    if (!returnable || returnable.ok === false) return { code: "not_returnable", message: `${product.name} cannot be returned to change your mind. ${exempt.why} ${returnable?.note || ""}`.trim() };
  }
  if (conditional && flags.worn) return { code: "not_returnable", message: `${product.name} cannot be returned to change your mind once it is ${exempt.when}. ${exempt.why}` };
  if (!exempt && returnable && returnable.ok === false) {
    return { code: "not_returnable", message: `${product.name} cannot be returned. ${returnable.note || ""}`.trim() };
  }
  if (!exempt && product.category === "food" && !entry.item.returnable) return { code: "not_returnable", message: `${product.name} is perishable food and cannot be returned. If it arrived spoiled, tell us within ${ctx.business.problems.spoiled_quick_fix_hours} hours with a photo.` };
  if (!arrived) return { code: "not_arrived", message: `${product.name} has not been delivered yet, so the ${r.window_days}-day return window has not started.` };
  const used = daysBetween(arrived, ctx.now);
  if (used > r.window_days) {
    return { code: "out_of_window", message: `The return window is ${r.window_days} days from the day it was delivered. This one arrived ${used} days ago.` };
  }
  if (flags.worn) {
    // Within the legal 14 days a used item can come back, with the refund reduced. In our extra days it must be unused.
    if (used > r.legal_cancellation_days) return { code: "worn", message: `${product.name} arrived ${used} days ago. From day ${r.legal_cancellation_days + 1} to day ${r.window_days} (our extra days) an item must be unused to be returned to change your mind. ${r.refund_may_be_reduced.rule}` };
    return { inspect: true, message: `${product.name} can still be returned, but a person will inspect it and decide the refund. The refund may be reduced by the value lost through use, up to the full price. The amount is decided after inspection and cannot be promised now. You will be told the reason in writing.` };
  }
  return null;
}

function alreadyReturned(ctx, order, sku) {
  return ctx.st.returns
    .filter((r) => r.order_number === order.number && r.status !== "rejected")
    .reduce((n, r) => n + r.items.filter((i) => i.sku === sku).reduce((m, i) => m + i.qty, 0), 0);
}

/** Refund for returning `lines`. Postage comes off change-of-mind; delivery comes back only per the rule. */
function refundFor(ctx, order, lines, reason) {
  const t = order.totals;
  const keep = t.discount > 0 && t.items > 0 ? 1 - t.discount / t.items : 1;
  const itemsValue = lines.reduce((n, l) => n + order.items.find((i) => i.sku === l.sku).unit_price * l.qty, 0) * keep;
  const whole = order.items.every((i) => alreadyReturned(ctx, order, i.sku) + (lines.find((l) => l.sku === i.sku)?.qty || 0) >= i.qty);
  const deliveryPaidBack = ctx.st.returns.some((r) => r.order_number === order.number && r.status !== "rejected" && r.delivery_refunded > 0);
  // A change of mind never gets back more delivery than the cheapest option (Soon); faulty returns get it all.
  const soon = ctx.business.delivery.methods.find((m) => m.id === "standard").price;
  const delivery = (whole || reason !== "change_of_mind") && !deliveryPaidBack ? (reason === "change_of_mind" ? Math.min(t.delivery, soon) : t.delivery) : 0;
  const postage = reason === "change_of_mind" ? ctx.business.returns.change_of_mind_postage : 0;
  return { items_value: round2(itemsValue), delivery_refunded: delivery, postage_deducted: postage, refund_amount: round2(Math.max(0, itemsValue + delivery - postage)), whole_order: whole };
}

// ---------------------------------------------------------------- problems (damaged, missing, wrong, spoiled)

const PROBLEMS = ["damaged", "missing", "wrong", "spoiled"];
/** Return reasons whose items go back on the shelf, as in business/builder/world/simulate.mjs. */
const RESALEABLE = ["change_of_mind", "wrong_item"];

function assistantLimits(business) {
  return {
    replacement: business.roles.assistant.limits.replacement_max_unit_price,
    spoiled_refund: business.roles.assistant.limits.spoiled_refund_max,
    spoiled_hours: business.problems.spoiled_quick_fix_hours,
  };
}

/** A parcel that is still on its way for this SKU, if any. */
function pendingShipment(ctx, order, sku) {
  return (order.shipments || []).find((s) => (s.skus || []).includes(sku) && ["pending", "packed", "in_transit", "delayed"].includes(s.status) &&
    (!s.dispatched_at || ms(addWorkingDays(s.dispatched_at, ctx.business.delivery.lost_after_working_days)) >= ms(dateOf(ms(ctx.now)))));
}

// ---------------------------------------------------------------- bookings

const BOOKING_LIVE = ["confirmed", "out_on_hire"];
const overlaps = (a, b) => ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);
const hoursUntil = (ctx, iso) => (ms(iso) - ms(ctx.now)) / HOUR;

function liveBookings(ctx, service, ignore) {
  return ctx.st.bookings.filter((b) => b.service === service && BOOKING_LIVE.includes(b.status) && b.number !== ignore);
}

function needNotice(ctx, start, hours, what) {
  if (hoursUntil(ctx, start) < hours) fail("rule_violation", `${what} needs at least ${hours} hours' notice. That start is too soon.`);
}

function getService(ctx, id) {
  return ctx.world.services[id] || fail("not_found", `There is no service called ${id}. The bookable services are borrow-box, someone-to-clap, someone-to-queue, someone-to-hold and someone-to-wait-in.`);
}

/** Borrow Box: weekend (Fri to Mon) or week (7 days). Units free = units minus overlapping hires. */
function planBorrow(ctx, i, ignore) {
  const rules = ctx.business.services["borrow-box"];
  const item = (getService(ctx, "borrow-box").items || []).find((x) => x.id === i.item_id) || fail("not_found", `There is no Borrow Box item ${i.item_id}.`);
  const day = dateOf(ms(i.start));
  const [dropOff] = rules.periods.week.match(/\d\d:\d\d/g);
  const [, back] = rules.periods.weekend.match(/\d\d:\d\d/g);
  const isFriday = new Date(ms(day)).getUTCDay() === 5;
  const span = i.end ? daysBetween(day, i.end) : isFriday ? 3 : 6;
  if (!(span === 3 && isFriday) && span !== 6) fail("invalid_input", `Borrow Box runs weekends (${rules.periods.weekend}) or weeks (${rules.periods.week}).`);
  const weekend = span === 3;
  const start = `${day}T${dropOff}:00Z`;
  const end = `${addDays(day, span)}T${back}:00Z`;
  needNotice(ctx, start, rules.min_notice_hours, "Borrow Box booking");
  const clash = liveBookings(ctx, "borrow-box", ignore).filter((b) => b.item_id === item.id && overlaps({ start, end }, b)).length;
  if (clash >= item.units) fail("unavailable", `${item.name} is fully booked for those dates (${item.units} unit${item.units === 1 ? "" : "s"}). Try other dates.`);
  const fee = rules.delivery_fee_each_way;
  const deliver = i.delivery === true;
  const miles = i.distance_miles ?? 0;
  const maxMiles = ctx.business.services["someone-to-clap"].area.included_miles;
  if (deliver && miles > maxMiles) fail("rule_violation", `Delivery is only within ${maxMiles} miles of us.`);
  return {
    item_id: item.id, start, end, party_size: 1, add_ons: [], distance_miles: deliver ? miles : null,
    location: deliver ? "Delivered to customer" : BORROW_LOCATION,
    price: (weekend ? item.price_weekend : item.price_week) + (deliver ? fee * 2 : 0), deposit: item.deposit,
  };
}

/** Someone to Clap: fixed slots, limited crews, mileage beyond the included area. */
function planClap(ctx, i, ignore) {
  const rules = ctx.business.services["someone-to-clap"];
  const svc = getService(ctx, "someone-to-clap");
  const pkg = (svc.packages || []).find((p) => p.id === i.item_id) || fail("not_found", `There is no Someone to Clap package ${i.item_id}.`);
  const slot = String(i.start).slice(11, 16);
  if (!rules.slots.includes(slot)) fail("invalid_input", `Slots are ${rules.slots.join(", ")}.`);
  if (new Date(ms(i.start)).getUTCDay() === 0) fail("rule_violation", `Someone to Clap works ${rules.days}.`);
  needNotice(ctx, i.start, rules.min_notice_hours, "Someone to Clap");
  const miles = i.distance_miles ?? 0;
  if (miles > rules.area.max_miles) fail("rule_violation", `We travel at most ${rules.area.max_miles} miles from where we are based. ${miles} miles is too far.`);
  const taken = liveBookings(ctx, "someone-to-clap", ignore).filter((b) => b.start === i.start).length;
  if (taken >= rules.crews_per_slot) fail("unavailable", `Both crews are booked at ${slot} on ${dateOf(ms(i.start))}. Try another slot or day.`);
  const addOns = (i.add_ons || []).map((id) => (svc.add_ons || []).find((a) => a.id === id) || fail("not_found", `There is no add-on ${id}.`));
  const mileage = Math.max(0, miles - rules.area.included_miles) * rules.area.per_mile_beyond_included;
  return {
    item_id: pkg.id, start: isoOf(ms(i.start)), end: isoOf(ms(i.start) + (pkg.minutes || 0) * 60000), party_size: pkg.clappers || 1,
    add_ons: addOns.map((a) => a.id), distance_miles: miles, location: i.location || "Customer's address",
    price: round2(pkg.price + addOns.reduce((n, a) => n + a.price, 0) + mileage), deposit: 0,
  };
}

// Borrow Box items are delivered and picked up (there is no collection and no visitable place).
const BORROW_LOCATION = "Delivered and picked up";

// The "will not" rules that a machine can check are the ones about what the booking is for. We look for
// obvious words in what the customer says it is for; anything subtler is left to the coordinator.
const WILL_NOT_PATTERNS = {
  "someone-to-queue": { re: /\b(passport|id|identity|licen[cs]e|photo card|collect(?:ing)? (?:a |my )?parcel)\b/i, rule: "Hold or queue for anything that needs ID in your name" },
  "someone-to-hold": { re: /\b(emergency|999|112|ambulance|nhs|medical|doctor|hospital|bank|fraud)\b/i, rule: "Hold for emergency, medical or bank security lines" },
};

/** Stop a booking whose stated purpose is on the service's will-not list. */
function checkWillNot(ctx, service, text) {
  const p = WILL_NOT_PATTERNS[service];
  if (p && p.re.test(text)) {
    const list = ctx.business.services[service].will_not.join("; ");
    fail("rule_violation", `We cannot take that booking. ${service === "someone-to-queue" ? "Someone to Queue" : "Someone to Hold"} will not: ${list}.`);
  }
}

/** A slot holds one booking per service: one queuer or waiter, at one place, at a time. */
function slotTaken(ctx, service, start, end, ignore) {
  return liveBookings(ctx, service, ignore).some((b) => overlaps({ start, end }, b));
}

/** Shared checks for the three "Someone to ..." services that are priced from packages. */
function planPackaged(ctx, i, ignore, service) {
  const rules = ctx.business.services[service];
  const svc = getService(ctx, service);
  const pkg = (svc.packages || []).find((p) => p.id === i.item_id) || fail("not_found", `There is no ${svc.name} package ${i.item_id}. The packages are ${(svc.packages || []).map((p) => p.id).join(", ")}.`);
  const day = new Date(ms(i.start)).getUTCDay();
  if (day === 0) fail("rule_violation", `${svc.name} works ${rules.days || svc.days}.`);
  needNotice(ctx, i.start, rules.min_notice_hours, svc.name);
  return { rules, svc, pkg, start: isoOf(ms(i.start)), slot: String(i.start).slice(11, 16) };
}

/** Someone to Queue: slots on the hour, 1 to 6 hours, one booking per slot. */
function planQueue(ctx, i, ignore) {
  const { rules, pkg, start, slot } = planPackaged(ctx, i, ignore, "someone-to-queue");
  if (!rules.slots.includes(slot)) fail("invalid_input", `Slots start on the hour: ${rules.slots[0]} to ${rules.slots.at(-1)}.`);
  if (pkg.hours < rules.min_hours || pkg.hours > rules.max_hours) fail("rule_violation", `Someone to Queue is ${rules.min_hours} to ${rules.max_hours} hours.`);
  if (!i.location || !i.note) fail("invalid_input", `Say where the queue is (location) and what it is for (note). ${rules.customer_must}`);
  checkWillNot(ctx, "someone-to-queue", `${i.location} ${i.note}`);
  const end = isoOf(ms(start) + pkg.hours * HOUR);
  if (slotTaken(ctx, "someone-to-queue", start, end, ignore)) fail("unavailable", `Someone is already booked to queue at ${slot} on ${dateOf(ms(start))}. Try another hour or day.`);
  return { item_id: pkg.id, start, end, party_size: 1, add_ons: [], distance_miles: null, location: i.location, note: i.note, price: pkg.price, deposit: 0 };
}

/** Someone to Hold: a call, an hour on hold included, extra half hours bought as add_ons ["HOLD-EXTRA", ...]. */
function planHold(ctx, i, ignore) {
  const { rules, svc, pkg, start } = planPackaged(ctx, i, ignore, "someone-to-hold");
  if (!i.location || !i.note) fail("invalid_input", `Give the number to ring (location) and what the call is about (note). ${rules.customer_must}`);
  checkWillNot(ctx, "someone-to-hold", i.note);
  const extra = (svc.packages || []).find((p) => p.id === "HOLD-EXTRA") || fail("not_found", "The extra-time package HOLD-EXTRA is missing.");
  const extras = (i.add_ons || []);
  if (extras.some((a) => a !== extra.id)) fail("invalid_input", `The only add-on is ${extra.id} (${extra.note}).`);
  const minutes = rules.included_hold_minutes + extras.length * extra.minutes;
  const end = isoOf(ms(start) + minutes * 60000);
  // WHY: the rules give no call capacity, so the only clash is the same customer booking the same minute twice.
  const dupe = liveBookings(ctx, "someone-to-hold", ignore).some((b) => b.customer_id === i.customer_id && b.start === start && b.location === i.location);
  if (dupe) fail("unavailable", "You already have a hold booked for that number at that time.");
  return { item_id: pkg.id, start, end, party_size: 1, add_ons: extras, distance_miles: null, location: i.location, note: i.note, price: round2(pkg.price + extras.length * extra.price), deposit: 0 };
}

/** Someone to Wait In: a half day (from a listed slot) or a full day (8 to 6), one booking per day-part. */
function planWaitIn(ctx, i, ignore) {
  const { rules, svc, pkg, start, slot } = planPackaged(ctx, i, ignore, "someone-to-wait-in");
  const full = pkg.hours > 4;
  const allowed = full ? [svc.slots[0]] : svc.slots;
  if (!allowed.includes(slot)) fail("invalid_input", `${pkg.name} starts at ${allowed.join(" or ")}.`);
  if (!i.location) fail("invalid_input", "Give the address to wait at (location).");
  const end = isoOf(ms(start) + pkg.hours * HOUR);
  if (slotTaken(ctx, "someone-to-wait-in", start, end, ignore)) fail("unavailable", `A waiter is already booked for that ${full ? "day" : "half day"} on ${dateOf(ms(start))}. Try another day.`);
  return { item_id: pkg.id, start, end, party_size: 1, add_ons: [], distance_miles: null, location: i.location, note: i.note || "", price: pkg.price, deposit: 0 };
}

const PLANNERS = { "borrow-box": planBorrow, "someone-to-clap": planClap, "someone-to-queue": planQueue, "someone-to-hold": planHold, "someone-to-wait-in": planWaitIn };

/** Refund tiers per service, read from business.services[...].cancel. */
function cancellationTerms(ctx, b) {
  const hours = hoursUntil(ctx, b.start);
  const c = ctx.business.services[b.service].cancel;
  const out = { price_refund: 0, deposit_refund: 0, credit_amount: 0, rule: "" };
  if (b.service === "borrow-box") {
    out.price_refund = hours >= c.full_refund_until_hours ? b.price : round2((b.price * c.after_that_refund_percent) / 100);
    out.deposit_refund = b.deposit;
    out.rule = hours >= c.full_refund_until_hours ? `Full refund (more than ${c.full_refund_until_hours} hours ahead). Deposit refunded.` : `${c.after_that_refund_percent}% refund (under ${c.full_refund_until_hours} hours ahead). Deposit refunded in full.`;
  } else if (b.service === "someone-to-clap") {
    if (hours >= c.full_refund_until_hours) { out.price_refund = b.price; out.rule = `Full refund (${c.full_refund_until_hours}+ hours ahead).`; }
    else if (hours >= c.half_refund_until_hours) { out.price_refund = round2(b.price / 2); out.rule = `Half refund (between ${c.half_refund_until_hours} and ${c.full_refund_until_hours} hours ahead).`; }
    else out.rule = `No refund (under ${c.half_refund_until_hours} hours ahead).`;
  } else {
    // Queue, Hold and Wait In: full refund up to the cut-off, nothing after.
    if (hours >= c.full_refund_until_hours) { out.price_refund = b.price; out.rule = `Full refund (${c.full_refund_until_hours}+ hours ahead).`; }
    else out.rule = `No refund (under ${c.full_refund_until_hours} hours ahead).`;
  }
  return out;
}

/** Reschedule rules per service. Returns the fee (0 if free). */
function rescheduleFee(ctx, b) {
  const rules = ctx.business.services[b.service];
  const hours = hoursUntil(ctx, b.start);
  const cutoff = rules.reschedule_min_hours;
  if (hours < cutoff) fail("rule_violation", `A booking can only be changed up to ${cutoff} hours before it starts. This one starts in about ${Math.max(0, Math.floor(hours))} hours.`);
  if (b.service === "someone-to-clap" && b.reschedules >= 1) return rules.second_reschedule_fee;
  return 0;
}

// ---------------------------------------------------------------- tool definitions
// Schema shortcuts.
const str = { type: "string" };
const num = { type: "number" };
const bool = { type: "boolean" };
const obj = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const strs = { type: "array", items: str };

const TOPIC_WORDS = { return_question: "a question about returning an item", change_order: "wants to change an order", presale: "a question before buying", late_parcel: "a late parcel", product_question: "a question about a product", where_is_my_order: "asking where an order is", complaint: "a complaint", fault: "an item that has stopped working", refund_chase: "asking where a refund is", damaged: "an item that arrived damaged", missing: "something missing from a parcel" };
/** One plain line on what a contact is about: its own summary if it has one, else the topic in words (and the order). */
function contactAbout(c) {
  if (c.summary) return String(c.summary);
  const what = TOPIC_WORDS[c.topic] || String(c.topic || "a contact").replace(/_/g, " ");
  return `${what.charAt(0).toUpperCase()}${what.slice(1)}${c.order ? ` (order ${c.order})` : ""}.`;
}

const OPEN = ALL_ROLES;

const TOOLS = [
  // ============================== open to everyone
  {
    name: "search_catalogue", roles: OPEN,
    description: "Keyword search across products, accessories and services. Returns id, name, price range, summary and status.",
    input_schema: obj({ query: str, category: str }, ["query"]),
    // WHY: customers describe what they want, not product ids; the assistant must find real things, not invent them.
    run(ctx, i) {
      const words = tokens(i.query);
      const out = [];
      for (const p of ctx.world.products) {
        if (i.category && p.category !== i.category) continue;
        const hay = [p.id, p.name, p.tagline, p.summary, p.category, ...(p.variants || []).map((v) => `${v.sku} ${v.name}`)].join(" ");
        if (matches(hay, words)) out.push({ kind: "product", id: p.id, name: p.name, price: priceRange(liveVariants(ctx, p)), summary: p.summary, status: statusOf(ctx, p) });
        for (const a of p.accessories || []) {
          if (!i.category && matches(`${a.sku} ${a.name} ${a.description}`, words)) out.push({ kind: a.kind || "accessory", id: a.sku, name: a.name, price: { from: a.price, to: a.price }, summary: a.description, status: statusOf(ctx, p), for: p.id });
        }
      }
      if (!i.category) {
        for (const s of Object.values(ctx.world.services)) {
          if (matches([s.id, s.name, s.tagline, s.summary].join(" "), words)) out.push({ kind: "service", id: s.id, name: s.name, price: null, summary: s.summary, status: "active" });
        }
      }
      return { results: out };
    },
  },
  {
    name: "get_product", roles: OPEN,
    description: "The full product record, with live stock for every variant. Accepts a product id or a SKU.",
    input_schema: obj({ id: str }, ["id"]),
    // WHY: stock changes as orders happen, so the static record must be overlaid with live numbers.
    run(ctx, i) {
      const p = resolveProduct(ctx, i.id) || fail("not_found", `There is no product ${i.id}.`);
      const life = ctx.st.product_status?.[p.id];
      return { ...p, status: statusOf(ctx, p), ...(life?.available_from ? { available_from: life.available_from } : {}), ...(life?.discontinued_at ? { discontinued_at: life.discontinued_at } : {}),
        variants: liveVariants(ctx, p), accessories: (p.accessories || []).map((a) => ({ ...a, price: priceOf(ctx, a.sku), stock: stockOf(ctx, a.sku).on_hand })) };
    },
  },
  {
    name: "compare_products", roles: OPEN,
    description: "Side by side: price, key specs, variants, warranty and delivery for two to four products.",
    input_schema: obj({ ids: strs }, ["ids"]),
    // WHY: comparisons must come from the records so the assistant cannot embellish one product against another.
    run(ctx, i) {
      if (i.ids.length < 2 || i.ids.length > 4) fail("invalid_input", "Compare between 2 and 4 products.");
      return {
        products: i.ids.map((id) => {
          const p = resolveProduct(ctx, id) || fail("not_found", `There is no product ${id}.`);
          return { id: p.id, name: p.name, status: statusOf(ctx, p), price: priceRange(liveVariants(ctx, p)), specs: p.specs, variants: (p.variants || []).map((v) => v.name), warranty: p.warranty, delivery: p.delivery, returnable: p.returnable };
        }),
      };
    },
  },
  {
    name: "check_compatibility", roles: OPEN,
    description: "Looks up the recorded compatibility between two product ids or SKUs. Says unknown when there is no entry; never guesses.",
    input_schema: obj({ a: str, b: str }, ["a", "b"]),
    // WHY: a wrong "yes, it fits" costs a return; "unknown" is honest and sends the customer to a person.
    run(ctx, i) {
      // An entry lives on a product and says "this product works (or not) with <with>". `with` may be a product id,
      // a SKU, a SKU prefix or a plain name. `applies_to` (a SKU prefix) narrows an entry to some variants,
      // e.g. the 16-inch sleeve fits the 22 L Daypack but not the 16 L.
      // An accessory is its own thing: its parent's entries describe the parent, so they are never used for it.
      const side = (x) => {
        const e = ctx.world.index.skus[x];
        const product = ctx.world.index.byId[x] || (e && !e.item.kind ? e.product : null);
        return { ref: x, sku: e ? x : null, product, names: [x, product?.id, product?.name, e?.item.name].filter(Boolean).map((r) => r.toLowerCase()) };
      };
      const matches = (withRef, other) => {
        const w = String(withRef).toLowerCase();
        return other.names.includes(w) || (other.sku && /^ot-/.test(w) && other.sku.toLowerCase().startsWith(w));
      };
      const entriesFor = (from, other) => (from.product?.compatibility || []).filter((c) => matches(c.with, other))
        .filter((c) => !c.applies_to || !from.sku || from.sku.startsWith(c.applies_to));
      const [A, B] = [side(i.a), side(i.b)];
      const hits = [...entriesFor(A, B), ...entriesFor(B, A)];
      const answers = new Set(hits.map((h) => h.works));
      if (answers.size === 1) return { result: hits[0].works ? "yes" : "no", note: hits.map((h) => h.note).filter(Boolean).join(" ") };
      // Entries disagree: it depends on which model. Say so and give every note, so nobody has to guess.
      if (answers.size > 1) return { result: "depends", note: "It depends on the model. " + hits.map((h) => `${h.applies_to || h.with}: ${h.works ? "yes" : "no"}. ${h.note || ""}`).join(" ") };
      return { result: "unknown", note: "There is no compatibility entry for these two. Do not guess; offer to pass the question to a person." };
    },
  },
  {
    name: "check_stock", roles: OPEN,
    description: "Units on hand for a SKU, and the restock date if it is out.",
    input_schema: obj({ sku: str }, ["sku"]),
    // WHY: promising stock that is not there leads to cancelled orders; the live number is the only safe answer.
    run(ctx, i) {
      const { item } = lookupSku(ctx, i.sku);
      const s = stockOf(ctx, i.sku);
      return { sku: i.sku, name: item.name, on_hand: s.on_hand, in_stock: s.on_hand > 0, restock_date: s.on_hand > 0 ? null : s.restock_date };
    },
  },
  {
    name: "search_knowledge", roles: OPEN,
    description: "Keyword search across policies, help articles and the company documents this role may read (customers and their assistant see only public ones). Returns titles, ids and matching passages.",
    input_schema: obj({ query: str }, ["query"]),
    // WHY: answers about rules must be quoted from the written policy, not recalled.
    run(ctx, i) {
      const words = tokens(i.query);
      const score = (text) => words.filter((w) => String(text).toLowerCase().includes(w)).length;
      const out = [];
      for (const p of ctx.world.policies) {
        const passages = String(p.body || "").split(/\n\s*\n/).map((t) => ({ t, s: score(t) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 2);
        const s = score(p.title || "") * 2 + passages.reduce((n, x) => n + x.s, 0);
        if (s > 0) out.push({ kind: "policy", id: p.id, title: p.title, passages: passages.map((x) => x.t.trim()), score: s });
      }
      for (const h of ctx.world.help) {
        const s = score(`${h.q || h.title || ""} ${h.a || h.body || ""}`);
        if (s > 0) out.push({ kind: "help", id: h.id, title: h.q || h.title, passages: [h.a || h.body], policy: h.policy || null, score: s });
      }
      // Extensions add their own stores (infrastructure/engine/knowledge.js: the company's documents, within the caller's permissions).
      for (const source of KNOWLEDGE_SOURCES) out.push(...source(ctx, words, score));
      return { results: out.sort((a, b) => b.score - a.score).slice(0, 6) };
    },
  },
  {
    name: "get_policy", roles: OPEN,
    description: "One policy in full.",
    input_schema: obj({ id: str }, ["id"]),
    // WHY: when a customer disputes an answer, the assistant can read the exact wording.
    run(ctx, i) {
      return ctx.world.policies.find((p) => p.id === i.id) || fail("not_found", `There is no policy ${i.id}.`);
    },
  },
  {
    name: "list_policies", roles: OPEN,
    description: "Every policy: id, title and a one-line summary. Open one in full with get_policy.",
    input_schema: obj({}),
    // WHY: a person or an AI browsing the policies needs the list before it can pick one.
    run(ctx) { return { policies: ctx.world.policies.map((p) => ({ id: p.id, title: p.title, summary: p.summary || "" })) }; },
  },
  {
    name: "get_service", roles: OPEN,
    description: "A service record (Borrow Box, Someone to Clap, Make a Thing) with its live rules from the business record.",
    input_schema: obj({ id: str }, ["id"]),
    // WHY: items, packages and sessions live in the service; the rules live in business.json. Both are shown together.
    run(ctx, i) {
      return { ...getService(ctx, i.id), rules: ctx.business.services[i.id] };
    },
  },
  {
    name: "check_availability", roles: OPEN,
    description: "Crews free for a clap slot, units free for a hire period, or whether a Queue, Hold or Wait In slot is free.",
    input_schema: obj({ service: str, item_id: str, date: str, slot: str, end_date: str }, ["service", "item_id"]),
    // WHY: the assistant should look before offering a date, so it never offers something that will fail at booking.
    run(ctx, i) {
      const svc = getService(ctx, i.service);
      if (!i.date) fail("invalid_input", "A date is needed.");
      if (i.service === "someone-to-clap") {
        const slots = i.slot ? [i.slot] : ctx.business.services["someone-to-clap"].slots;
        const per = ctx.business.services["someone-to-clap"].crews_per_slot;
        return { service: i.service, date: i.date, slots: slots.map((slot) => ({ slot, crews_free: per - liveBookings(ctx, i.service).filter((b) => b.start === `${i.date}T${slot}:00Z`).length })) };
      }
      if (i.service === "someone-to-queue" || i.service === "someone-to-wait-in") {
        const pkg = (svc.packages || []).find((p) => p.id === i.item_id) || fail("not_found", `There is no package ${i.item_id}.`);
        const slots = i.slot ? [i.slot] : (ctx.business.services[i.service].slots || svc.slots);
        return { service: i.service, item_id: pkg.id, date: i.date, slots: slots.map((slot) => {
          const start = `${i.date}T${slot}:00Z`;
          return { slot, free: !slotTaken(ctx, i.service, start, isoOf(ms(start) + pkg.hours * HOUR)) };
        }) };
      }
      // WHY: nothing limits how many calls we hold at once, so Someone to Hold is always free.
      if (i.service === "someone-to-hold") return { service: i.service, date: i.date, free: true };
      const item = (svc.items || []).find((x) => x.id === i.item_id) || fail("not_found", `There is no item ${i.item_id}.`);
      const probe = { start: `${i.date}T10:00:00Z`, end: `${i.end_date || addDays(i.date, 3)}T12:00:00Z` };
      const out = liveBookings(ctx, i.service).filter((b) => b.item_id === item.id && overlaps(probe, b)).length;
      return { service: i.service, item_id: item.id, units_free: Math.max(0, item.units - out), units_total: item.units };
    },
  },
  {
    name: "delivery_options", roles: OPEN,
    description: "Which delivery methods are allowed for these SKUs and this postcode, with prices and the earliest delivery date.",
    input_schema: obj({ skus: strs, postcode: str }, ["skus", "postcode"]),
    // WHY: chilled food, plants and remote postcodes restrict methods; the customer must see only what is possible.
    run(ctx, i) {
      if (!i.skus.length) fail("invalid_input", "Give at least one SKU.");
      const methods = deliveryFor(ctx, i.skus, i.postcode);
      const reachableNow = reachable(ctx, i.postcode);
      return { postcode: i.postcode, reachable: reachableNow, area_rule: reachableNow ? null : ctx.business.delivery.area, methods };
    },
  },
  {
    name: "create_customer", roles: ["customer", "support_agent"],
    description: "Website sign-up: creates a customer account. A customer session with no customer_id becomes this customer.",
    input_schema: obj({ name: str, email: str, phone: str, address: { type: "object" } }, ["name", "email", "address"]),
    // WHY: checkout needs an account to hang orders on; email must be unique so two people never share records.
    run(ctx, i) {
      const a = i.address;
      if (!(a.line1 && a.town && a.postcode)) fail("invalid_input", "An address needs line1, town and postcode.");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(i.email)) fail("invalid_input", "That email address does not look right.");
      if (ctx.st.customers.some((c) => c.email.toLowerCase() === i.email.toLowerCase())) fail("rule_violation", "An account with that email already exists. Sign in instead.");
      const c = {
        id: nextId(ctx, "C"), name: i.name, email: i.email, phone: i.phone || "",
        addresses: [{ id: "A1", line1: a.line1, town: a.town, postcode: a.postcode, default: true }],
        contact_preference: "email", marketing_opt_in: false, created_at: ctx.now, credit_balance: 0, notes: "",
      };
      ctx.st.customers.push(c);
      note(ctx, `customer ${c.id} created`);
      if (ctx.role === "customer" && !ctx.sess.customer_id) ctx.sess.customer_id = c.id;
      return c;
    },
  },
  {
    name: "payment_methods", roles: OPEN,
    description: "The ways to pay, each with a plain explanation and every test outcome. Give basket_total (items, not counting delivery) and/or skus to see which can be used for that bag and why not.",
    input_schema: obj({ basket_total: num, skus: strs }),
    // WHY: an assistant must answer "how can I pay?" and "why can't I pay later?" from the rules, not guess.
    run(ctx, i) {
      const unknown = (i.skus || []).filter((s) => !ctx.world.index.skus[s]);
      if (unknown.length) fail("not_found", `No such SKU: ${unknown.join(", ")}.`);
      return {
        methods: payMethods(ctx).map((m) => {
          const why = payBlocks(ctx, m, i.basket_total, i.skus);
          return { id: m.id, name: m.name, kind: m.kind, explain: m.explain, available: !why.length, why_not: why.length ? why.join(" ") : null, due_in_days: m.due_in_days ?? null, limits: m.limits ? { ...m.limits, messages: undefined } : null, outcomes: outcomesOf(ctx, m) };
        }),
        refund_to: ctx.business.payments.refund_to,
      };
    },
  },
  {
    name: "place_order", roles: ["customer"],
    description: "Website checkout: places an order for the signed-in customer with simulated payment. payment: { method, outcome?, card_number? } (see payment_methods); card_number alone still means a card. Not available to the assistant, which sends people to the website.",
    input_schema: obj({ items: { type: "array", items: obj({ sku: str, qty: { type: "integer" } }, ["sku", "qty"]) }, delivery_method: str, address: { type: "object" }, card_number: str, payment: obj({ method: str, outcome: str, card_number: str }, ["method"]) }, ["items", "delivery_method"]),
    needs_customer: true,
    // WHY: the shop front needs one honest path that takes prices, stock and delivery rules from the records, never from the browser.
    run(ctx, i) {
      const cust = getCustomer(ctx, ctx.sess.customer_id) || fail("not_found", "Customer not found.");
      const address = i.address || cust.addresses.find((a) => a.default) || cust.addresses[0];
      if (!address || !(address.line1 && address.town && address.postcode)) fail("invalid_input", "A delivery address (line1, town, postcode) is needed.");
      if (!i.items.length) fail("invalid_input", "The bag is empty.");
      const q = basketQuote(ctx, i.items, i.delivery_method, address.postcode);
      if (q.delivery_charge === null) fail("rule_violation", `${i.delivery_method} cannot be used for this basket${q.reachable ? "" : ` to that postcode. ${ctx.business.delivery.area}`}. Allowed: ${q.methods.map((m) => m.id).join(", ") || "none"}.`);
      const entry = (sku) => ctx.world.index.skus[sku];
      const isPre = (sku) => statusOf(ctx, entry(sku).product) === "preorder";
      // WHY: made-to-order food is never on a shelf; it is made and sent on the dispatch day.
      const fromShelf = (sku) => !isPre(sku) && !isMadeToOrder(entry(sku));
      for (const l of q.lines) {
        const why = notSellable(ctx, entry(l.sku), l.qty);
        if (why) fail("rule_violation", why);
        if (fromShelf(l.sku) && stockOf(ctx, l.sku).on_hand < l.qty) fail("out_of_stock", `${l.sku} has only ${stockOf(ctx, l.sku).on_hand} in stock.`);
      }
      // Which way to pay. The old card_number field on its own still means a card.
      const pay = i.payment || { method: "card", card_number: i.card_number };
      const methods = payMethods(ctx);
      const pm = methods.find((m) => m.id === pay.method) || fail("invalid_input", `There is no way to pay called ${pay.method}. Ways to pay: ${methods.map((m) => m.id).join(", ")}.`);
      const blocks = payBlocks(ctx, pm, q.items_total, q.lines.map((l) => l.sku));
      if (blocks.length) fail("rule_violation", `${blocks.join(" ")} Choose another way to pay.`);
      let result, message, payment, failEvent;
      if (pm.outcomes_from === "test_cards") {
        const cardNo = pay.card_number ?? pay.outcome ?? i.card_number;
        const card = (ctx.business.payments.test_cards || []).find((c) => c.number.replace(/\s+/g, "") === String(cardNo).replace(/\s+/g, ""));
        if (!card) fail("invalid_input", "Only the test cards work here: " + ctx.business.payments.test_cards.map((c) => c.number).join(", ") + ".");
        const last4 = String(cardNo).replace(/\D/g, "").slice(-4);
        result = card.result; message = card.message;
        payment = { method: `${card.brand} ending ${last4}`, method_id: pm.id, method_name: pm.name, outcome: card.result, brand: card.brand, last4, refunded: 0 };
        failEvent = card.result === "needs_check" ? "Payment not completed: the bank wants to check with the customer" : "Payment declined";
      } else {
        const outs = pm.outcomes || [];
        // The next order number (not taken yet: a bad outcome name must not use one up).
        const out = pay.outcome ? outs.find((o) => o.id === pay.outcome) : pickOutcome(outs, (ctx.st.counters.ORD || 0) + 1);
        if (!out) fail("invalid_input", `${pm.name} has no outcome called ${pay.outcome}. Outcomes: ${outs.map((o) => o.id).join(", ")}.`);
        result = out.result; message = out.message;
        payment = { method: pm.name, method_id: pm.id, method_name: pm.name, outcome: out.id, refunded: 0 };
        failEvent = `Payment not completed (${pm.name}): ${out.label}`;
      }
      const number = nextId(ctx, "ORD");
      const chilled = q.lines.filter((l) => (deliveryMethodsOf(ctx.world.index.skus[l.sku]) || []).includes("chilled")).map((l) => l.sku);
      // Pre-order items wait in their own parcel, so the rest of the order is not held up.
      const pre = q.lines.map((l) => l.sku).filter((s) => isPre(s) && !chilled.includes(s));
      const groups = [chilled, q.lines.map((l) => l.sku).filter((s) => !chilled.includes(s) && !pre.includes(s)), pre].filter((g) => g.length);
      const order = {
        number, customer_id: cust.id, placed_at: ctx.now, status: "paid",
        items: q.lines.map((l) => ({ sku: l.sku, name: l.name, qty: l.qty, unit_price: l.unit_price })),
        totals: { items: q.items_total, delivery: q.delivery_charge, discount: 0, total: q.total },
        payment: { status: "paid", ...payment },
        delivery: { method: i.delivery_method, address: { line1: address.line1, town: address.town, postcode: address.postcode } },
        shipments: groups.map((g, k) => ({ id: `SHP-${number.slice(4)}-${k + 1}`, skus: g, status: "pending", carrier: null, tracking: null, dispatched_at: null, eta: null, delivered_at: null,
          // WHY: a pending parcel with a note is waiting for stock (the generator's convention); its stock is taken when it arrives.
          ...(g === pre ? { note: `Pre-order. Ships when it is in stock, from ${entry(g[0]).product.available_from || "the launch date"}.` } : {}) })),
        history: [{ at: ctx.now, event: "Order placed" }],
      };
      if (result !== "paid") {
        order.status = "payment_failed";
        order.payment = { status: "declined", ...payment };
        order.shipments = [];
        order.history = [{ at: ctx.now, event: failEvent }];
        ctx.st.orders.push(order);
        note(ctx, `order ${number} created (payment_failed)`);
        fail("rule_violation", `${message} Order ${number} was saved as payment_failed and nothing was taken from stock.`, { order_number: number });
      }
      // WHY: pay later goes ahead now (the order is paid for fulfilment), but the money is owed until finance settles it.
      bookSale(ctx, order);
      if (pm.due_in_days) {
        Object.assign(order.payment, { status: "due", due: q.total, due_date: addDays(dateOf(ms(ctx.now)), pm.due_in_days), settled_at: null });
        order.history.push({ at: ctx.now, event: `Pay later approved (${pm.name}): ${money(q.total)} due on ${order.payment.due_date}` });
        // WHY: the sale counts now, but the money is owed, so cash is not in until it is settled.
        postLedger(ctx, "pay_later", -q.total, number);
      }
      for (const l of q.lines) if (fromShelf(l.sku)) moveStock(ctx, l.sku, -l.qty, "sold", number);
      ctx.st.orders.push(order);
      note(ctx, `order ${number} created`);
      return order;
    },
  },

  // ============================== customer records
  {
    name: "verify_customer", roles: ["assistant", "support_agent", "support_lead"],
    description: "Verifies a customer by an order, booking, repair or return number plus the matching email or postcode. Three failed tries locks the session.",
    input_schema: obj({ reference: str, email_or_postcode: str }, ["reference", "email_or_postcode"]),
    // WHY: stops someone reading another person's orders by guessing a number; the number alone is never enough.
    run(ctx, i) {
      const s = ctx.sess;
      if (s.locked) fail("needs_human", "Too many failed verification attempts. Do not try again; hand this conversation to a person.");
      const coll = { ORD: ["orders", "number"], BKG: ["bookings", "number"], FIX: ["repairs", "number"], RET: ["returns", "number"] }[String(i.reference).split("-")[0].toUpperCase()];
      const rec = coll && ctx.st[coll[0]].find((r) => r[coll[1]] === i.reference);
      const cust = rec && getCustomer(ctx, rec.customer_id);
      const given = String(i.email_or_postcode).trim().toLowerCase().replace(/\s+/g, "");
      const postcodes = cust ? [...cust.addresses.map((a) => a.postcode), rec.delivery?.address?.postcode].filter(Boolean).map((p) => p.toLowerCase().replace(/\s+/g, "")) : [];
      if (cust && (cust.email.toLowerCase() === given || postcodes.includes(given))) {
        s.customer_id = cust.id;
        s.failures = 0;
        return { verified: true, customer_id: cust.id, name: cust.name };
      }
      s.failures += 1;
      if (s.failures >= 3) {
        s.locked = true;
        fail("needs_human", "Verification failed three times, so this session is locked. Hand the customer to a person.");
      }
      fail("not_verified", `Those details do not match our records (attempt ${s.failures} of 3). Ask the customer to check the number and the email or postcode.`);
    },
  },
  {
    name: "get_customer", roles: CUSTOMER_READERS, needs_customer: true,
    description: "The customer's profile, addresses and contact preference. Never card details.",
    input_schema: obj({ customer_id: str }),
    // WHY: personal details are only shown to the verified owner; card data is not stored at all.
    run(ctx, i) {
      const c = getCustomer(ctx, who(ctx, i)) || fail("not_found", "Customer not found.");
      const { id, name, email, phone, addresses, contact_preference, marketing_opt_in, credit_balance, created_at } = c;
      return { id, name, email, phone, addresses, contact_preference, marketing_opt_in, credit_balance, created_at };
    },
  },
  {
    name: "list_orders", roles: CUSTOMER_READERS, needs_customer: true,
    description: "All of the customer's orders, newest first.",
    input_schema: obj({ customer_id: str }),
    // WHY: lets the customer find an order without knowing its number.
    run(ctx, i) {
      const id = who(ctx, i);
      return { orders: ctx.st.orders.filter((o) => o.customer_id === id).sort((a, b) => ms(b.placed_at) - ms(a.placed_at)).map((o) => ({ number: o.number, placed_at: o.placed_at, status: o.status, total: o.totals.total, items: o.items.map((x) => `${x.qty} x ${x.name}`) })) };
    },
  },
  {
    name: "get_order", roles: CUSTOMER_READERS, needs_customer: true,
    description: "One order with items, shipments, tracking, payment status and history.",
    input_schema: obj({ order_number: str }, ["order_number"]),
    // WHY: every answer about an order must come from the record, not memory.
    run(ctx, i) {
      return findOwned(ctx, ctx.st.orders, "number", i.order_number, "order");
    },
  },
  {
    name: "cancel_order", roles: CUSTOMER_ROLES, needs_customer: true,
    description: "Cancels an order that is not yet packed and marks the payment refunded.",
    input_schema: obj({ order_number: str, reason: str }, ["order_number", "reason"]),
    // WHY: once packed, the parcel is physically in motion; before that, cancelling costs us nothing.
    run(ctx, i) {
      const o = findOwned(ctx, ctx.st.orders, "number", i.order_number, "order");
      if (!isBeforePacked(ctx, o)) fail("rule_violation", notPackedMessage(ctx, o, "cancel"));
      // WHY: a declined payment took no money, so cancelling it gives nothing back and records nothing.
      const declined = o.payment.status === "declined";
      const refund = declined ? 0 : round2(o.totals.total - o.payment.refunded);
      const held = [...new Set(o.items.map((l) => l.sku))].map((sku) => [sku, declined ? 0 : heldBy(ctx, o, sku)]);
      setField(ctx, `order ${o.number}`, o, "status", "cancelled");
      const back = refund > 0 ? giveBack(ctx, o, refund) : { refund_amount: 0 };
      if (!declined && o.payment.status !== "nothing_due") setField(ctx, `order ${o.number}`, o.payment, "status", "refunded");
      // WHY: only what the order really took goes back on the shelf (not pre-orders still waiting, not made-to-order food).
      for (const [sku, n] of held) if (n > 0) moveStock(ctx, sku, n, "released", o.number);
      for (const s of o.shipments || []) s.status = "cancelled";
      historyAdd(ctx, o, `Cancelled: ${i.reason}`);
      // A pay-later order not yet paid has nothing to send back: what was owed is simply cancelled.
      if (back.due_cancelled) return { order_number: o.number, status: "cancelled", refund_amount: 0, due_cancelled: back.due_cancelled, still_due: 0, message: back.how };
      return { order_number: o.number, status: "cancelled", refund_amount: refund, refund_to: ctx.business.payments.refund_to, refund_expected_by: addWorkingDays(ctx.now, ctx.business.payments.refund_time_working_days) };
    },
  },
  {
    name: "update_order", roles: CUSTOMER_ROLES, needs_customer: true,
    description: "Changes the address or delivery method, or swaps a variant of the same product at the same price. Only before packed.",
    input_schema: obj({ order_number: str, address: { type: "object" }, delivery_method: str, swap: obj({ from_sku: str, to_sku: str }, ["from_sku", "to_sku"]) }, ["order_number"]),
    // WHY: changes are free until the warehouse packs it; after that we would have to unpack a parcel.
    run(ctx, i) {
      const o = findOwned(ctx, ctx.st.orders, "number", i.order_number, "order");
      if (!isBeforePacked(ctx, o)) fail("rule_violation", notPackedMessage(ctx, o, "change"));
      if (!i.address && !i.delivery_method && !i.swap) fail("invalid_input", `Say what to change: ${ctx.business.orders.changes_allowed.join(", ")}.`);
      const address = i.address ? { line1: i.address.line1, town: i.address.town, postcode: i.address.postcode } : o.delivery.address;
      if (i.address && !(address.line1 && address.town && address.postcode)) fail("invalid_input", "An address needs line1, town and postcode.");
      const skus = o.items.flatMap((l) => Array(l.qty).fill(l.sku));
      const options = deliveryFor(ctx, skus, address.postcode);
      const method = i.delivery_method || o.delivery.method;
      const chosen = options.find((m) => m.id === method);
      if (!chosen) fail("rule_violation", `${method} cannot be used for this order${reachable(ctx, address.postcode) ? "" : ` to that postcode. ${ctx.business.delivery.area}`}. Allowed: ${options.map((m) => m.id).join(", ") || "none"}.`);
      let line;
      if (i.swap) {
        line = o.items.find((l) => l.sku === i.swap.from_sku) || fail("not_found", `${i.swap.from_sku} is not in this order.`);
        const from = lookupSku(ctx, i.swap.from_sku);
        const to = lookupSku(ctx, i.swap.to_sku);
        if (from.product.id !== to.product.id) fail("rule_violation", "A swap must be another variant of the same product.");
        if (from.item.price !== to.item.price) fail("rule_violation", "A swap must be at the same price. Cancel and reorder for a different price.");
        const why = notSellable(ctx, to, line.qty);
        if (why) fail("rule_violation", why);
        // WHY: the new variant leaves the shelf and the old one goes back, so both counts stay true.
        if (o.payment.status !== "declined" && heldBy(ctx, o, from.item.sku) >= line.qty) {
          moveStock(ctx, to.item.sku, -line.qty, "sold", o.number);
          moveStock(ctx, from.item.sku, line.qty, "released", o.number);
        }
        note(ctx, `order ${o.number} item ${line.sku} → ${to.item.sku}`);
        line.swapped_from = [...(line.swapped_from || []), line.sku]; // so the books can still match the old SKU's movements
        line.sku = to.item.sku;
        line.name = `${to.product.name}, ${to.item.name}`;
        for (const s of o.shipments) s.skus = s.skus.map((k) => (k === i.swap.from_sku ? to.item.sku : k));
      }
      if (i.address) { note(ctx, `order ${o.number} address → ${address.postcode}`); o.delivery.address = address; }
      if (method !== o.delivery.method) {
        const delta = round2(chosen.price - o.totals.delivery);
        setField(ctx, `order ${o.number}`, o.delivery, "method", method);
        setField(ctx, `order ${o.number}`, o.totals, "delivery", chosen.price);
        o.totals.total = round2(o.totals.items - o.totals.discount + chosen.price);
        // WHY: the charge on the payment changes with the delivery price, so income, the card fee and anything owed follow it.
        if (o.payment.status !== "declined") {
          postLedger(ctx, "delivery_income", delta, o.number);
          postLedger(ctx, "payment_fee", -delta * FEE_RATE, o.number);
        }
        if (isPayLaterDue(o.payment)) {
          setField(ctx, `order ${o.number}`, o.payment, "due", round2(o.payment.due + delta));
          postLedger(ctx, "pay_later", -delta, o.number);
        }
      }
      historyAdd(ctx, o, "Order changed before packing");
      return { order_number: o.number, delivery: o.delivery, totals: o.totals, items: o.items };
    },
  },
  {
    name: "check_return_eligibility", roles: CUSTOMER_ROLES, needs_customer: true,
    description: "Says yes or no for returning an item, with the reason and the refund that would result. Set worn=true if the customer has worn it or removed its seal.",
    input_schema: obj({ order_number: str, sku: str, worn: bool }, ["order_number", "sku"]),
    // WHY: customers ask "can I?" before they post anything; the answer and the money must match what create_return will do.
    run(ctx, i) {
      const o = findOwned(ctx, ctx.st.orders, "number", i.order_number, "order");
      const line = o.items.find((l) => l.sku === i.sku) || fail("not_found", `${i.sku} is not in order ${o.number}.`);
      const block = returnBlock(ctx, o, line, { worn: i.worn });
      const left = line.qty - alreadyReturned(ctx, o, line.sku);
      if (!block && left <= 0) return { eligible: false, code: "already_returned", message: "This item already has a return open or completed." };
      if (block && !block.inspect) return { eligible: false, code: block.code, message: block.message };
      const arrived = arrivedAt(o, line.sku);
      const one = [{ sku: line.sku, qty: left }];
      if (block) {
        // WHY: the refund for a used item depends on the value lost, which only a person can judge after seeing it.
        return {
          eligible: true, inspection_required: true, refund_amount_decided_after_inspection: true, refund_amount: null,
          qty_returnable: left, return_by: addDays(dateOf(ms(arrived)), ctx.business.returns.window_days),
          message: block.message, deciding_role: "warehouse inspects; a person decides the refund",
          refund_timing: ctx.business.returns.refund_issued,
        };
      }
      return {
        eligible: true, qty_returnable: left, condition: ctx.business.returns.condition,
        return_by: addDays(dateOf(ms(arrived)), ctx.business.returns.window_days),
        refund_if_change_of_mind: refundFor(ctx, o, one, "change_of_mind"),
        refund_if_faulty: refundFor(ctx, o, one, "faulty"),
        refund_timing: ctx.business.returns.refund_issued,
      };
    },
  },
  {
    name: "create_return", roles: CUSTOMER_ROLES, needs_customer: true,
    description: "Creates a return with a prepaid label. Change of mind deducts postage; faulty, damaged or wrong item is free.",
    input_schema: obj({ order_number: str, customer_id: str, items: { type: "array", items: obj({ sku: str, qty: { type: "integer" } }, ["sku"]) }, reason: { type: "string", enum: ["change_of_mind", "faulty", "damaged", "wrong_item"] }, worn: bool }, ["order_number", "items", "reason"]),
    // WHY: one rule set decides eligibility and money, so a customer is never told one thing and refunded another.
    run(ctx, i) {
      const o = orderFor(ctx, i);
      if (!i.items.length) fail("invalid_input", "Say which items to return.");
      const lines = i.items.map((l) => ({ sku: l.sku, qty: l.qty ?? 1 }));
      let inspect = false; // a used item: refund decided after inspection
      for (const l of lines) {
        const ordered = o.items.find((x) => x.sku === l.sku) || fail("not_found", `${l.sku} is not in order ${o.number}.`);
        const block = returnBlock(ctx, o, ordered, { worn: i.worn });
        if (block && !block.inspect) fail("rule_violation", block.message);
        if (block) inspect = true;
        if (l.qty < 1 || l.qty > ordered.qty - alreadyReturned(ctx, o, l.sku)) fail("rule_violation", `Only ${ordered.qty - alreadyReturned(ctx, o, l.sku)} of ${l.sku} can still be returned.`);
      }
      const money_ = refundFor(ctx, o, lines, i.reason);
      const rec = {
        number: nextId(ctx, "RET"), order_number: o.number, customer_id: o.customer_id, created_at: ctx.now, items: lines, reason: i.reason,
        status: "label_sent", postage_deducted: money_.postage_deducted, delivery_refunded: money_.delivery_refunded, refund_amount: money_.refund_amount, refunded_at: null, note: "",
      };
      if (inspect) { rec.inspection_required = true; rec.note = "Used item: refund reduced by value lost, decided by a person after inspection."; }
      ctx.st.returns.push(rec);
      note(ctx, `return ${rec.number} created for order ${o.number}, refund ${money(rec.refund_amount)}`);
      historyAdd(ctx, o, `Return ${rec.number} created`);
      if (inspect) {
        // WHY: the assistant must not promise an amount for a used item; the maximum is shown only as a ceiling.
        return { ...rec, refund_amount: null, maximum_refund: money_.refund_amount, refund_amount_decided_after_inspection: true, whole_order: money_.whole_order, refund_timing: ctx.business.returns.refund_issued,
          message: "Return created. A person inspects the item when it arrives and decides the refund, which may be reduced by the value lost through use. We will tell you the reason in writing. No amount can be promised yet." };
      }
      return { ...rec, whole_order: money_.whole_order, refund_timing: ctx.business.returns.refund_issued };
    },
  },
  {
    name: "report_problem", roles: CUSTOMER_ROLES, needs_customer: true,
    description: "Reports a damaged, missing, wrong or spoiled item and asks for a replacement or refund. Creates a case. Sorts it out within the assistant's limits, otherwise escalates.",
    input_schema: obj({ order_number: str, customer_id: str, sku: str, problem: { type: "string", enum: PROBLEMS }, resolution: { type: "string", enum: ["replacement", "refund"] }, has_photo: bool }, ["order_number", "sku", "problem", "resolution"]),
    // WHY: small, clear-cut problems are fixed on the spot; anything bigger goes to a person so the assistant never gives away money it may not.
    run(ctx, i) {
      const o = orderFor(ctx, i);
      const line = o.items.find((l) => l.sku === i.sku) || fail("not_found", `${i.sku} is not in order ${o.number}.`);
      const b = ctx.business;
      const lim = assistantLimits(b);
      const arrived = arrivedAt(o, i.sku);

      // WHY: Ice by Post is sold with no promise it arrives frozen, so melting is the product. A leaking, torn or contaminated pack is damage and goes the normal way.
      if (i.problem === "spoiled" && lookupSku(ctx, i.sku).product.id === "ice-by-post") fail("rule_violation", b.problems.ice_note);

      if (i.problem === "missing") {
        const coming = pendingShipment(ctx, o, i.sku);
        if (coming) return { outcome: "second_parcel_pending", shipment: coming.id, status: coming.status, eta: coming.eta, message: `${i.sku} is in parcel ${coming.id}, which has not arrived yet (${coming.status}, expected ${coming.eta || "date not set"}). ${b.problems.missing_item.split(".")[0]}.` };
      } else {
        if (!arrived) fail("rule_violation", `That item has not been delivered yet, so it cannot be reported as ${i.problem}.`);
        // WHY: these windows are service targets, not legal limits. A late report is never refused: a person looks at it.
        const late = i.problem === "spoiled" ? ms(ctx.now) - ms(arrived) > lim.spoiled_hours * HOUR : daysBetween(arrived, ctx.now) > b.problems.quick_fix_within_days;
        if (late) {
          const lateSubject = `${i.problem} item ${i.sku} on ${o.number} (reported late)`;
          const why = i.problem === "spoiled" ? `Reported more than ${lim.spoiled_hours} hours after delivery.` : `Reported ${daysBetween(arrived, ctx.now)} days after delivery.`;
          const c = openCaseRecord(ctx, { customer_id: o.customer_id, subject: lateSubject, category: "product", summary: `${i.problem}; customer wants a ${i.resolution}. ${why} Past the quick-fix window, so a person decides. Legal rights still apply.`, related: { order: o.number } });
          escalateCase(ctx, c, "support_agent", why);
          fail("needs_human", `That was outside our quick-fix window (${i.problem === "spoiled" ? lim.spoiled_hours + " hours" : b.problems.quick_fix_within_days + " days"}), so the assistant cannot sort it straight away. A person will look at it. Your legal rights still apply. Case ${c.number} has been passed to a support agent, who will pick it up within ${b.contact.support_reply_target_working_days} working day.`, { case_number: c.number });
        }
        if (["damaged", "spoiled"].includes(i.problem) && !i.has_photo) fail("rule_violation", `A photo is needed to report a ${i.problem} item. Ask the customer to send one, then try again.`);
      }

      const category = i.problem === "missing" ? "delivery" : "product";
      const subject = `${i.problem} item ${i.sku} on ${o.number}`;
      const price = line.unit_price;
      const limited = ctx.role === "assistant" || ctx.role === "customer";
      const refundCap = ctx.role === "support_lead" ? Infinity : limited ? (i.problem === "spoiled" ? lim.spoiled_refund : 0) : b.roles.support_agent.refund_limit;
      const refundOk = (i.problem === "spoiled" || !limited) && price <= refundCap;
      const mto = isMadeToOrder(lookupSku(ctx, i.sku));
      const replaceOk = (!limited || price <= lim.replacement) && (mto || stockOf(ctx, i.sku).on_hand >= 1);

      if (i.resolution === "refund" ? !refundOk : !replaceOk) {
        const why = i.resolution === "refund"
          ? `The assistant can only refund a spoiled perishable item of ${money(lim.spoiled_refund)} or less.`
          : price > lim.replacement ? `The assistant can only replace items of ${money(lim.replacement)} or less (this is ${money(price)}).` : `${i.sku} is out of stock, so it cannot be replaced right now.`;
        const c = openCaseRecord(ctx, { customer_id: o.customer_id, subject, category, summary: `${i.problem}; customer wants a ${i.resolution}. ${why}`, related: { order: o.number } });
        escalateCase(ctx, c, "support_agent", why);
        fail("needs_human", `${why} Case ${c.number} has been passed to a person, who will pick it up within ${b.contact.support_reply_target_working_days} working day.`, { case_number: c.number });
      }

      const c = openCaseRecord(ctx, { customer_id: o.customer_id, subject, category, summary: `${i.problem}; resolved by ${i.resolution}.`, related: { order: o.number }, status: "resolved" });
      const out = { outcome: i.resolution, case_number: c.number };
      if (i.resolution === "replacement") {
        // WHY: a free replacement leaves the shelf with no sale, so it is a write-off (as the generator does for lost parcels).
        // Made-to-order food is made fresh on the day the replacement is sent instead (see dispatchShipment).
        if (!mto) moveStock(ctx, i.sku, -1, "written_off", o.number);
        const rep = { id: `SHP-${o.number.slice(4)}-${o.shipments.length + 1}`, skus: [i.sku], status: "pending", replacement: true, carrier: null, tracking: null, dispatched_at: null, eta: null, delivered_at: null };
        o.shipments.push(rep);
        historyAdd(ctx, o, `Replacement ${rep.id} for ${i.problem} ${i.sku}`);
        out.replacement_shipment = rep.id;
        out.return_label = i.problem === "wrong" ? "A free label is provided for the wrong item." : i.problem === "damaged" && price > 60 ? "The damaged item must be sent back (free label)." : null;
      } else {
        const back = giveBack(ctx, o, price);
        historyAdd(ctx, o, back.due_cancelled ? `${money(price)} taken off what is owed for ${i.problem} ${i.sku}` : `Refund ${money(price)} for ${i.problem} ${i.sku}`);
        Object.assign(out, back.due_cancelled ? { ...back, how: undefined, message: back.how } : { refund_amount: back.amount, refund_expected_by: back.refund_expected_by });
      }
      return out;
    },
  },
  {
    name: "register_product", roles: CUSTOMER_ROLES, needs_customer: true,
    description: "Registers a purchased product and records its warranty end date.",
    input_schema: obj({ sku: str, order_number: str, serial: str }, ["sku", "order_number"]),
    // WHY: a registration is proof of purchase later, so the warranty claim does not depend on finding an old email.
    run(ctx, i) {
      const o = findOwned(ctx, ctx.st.orders, "number", i.order_number, "order");
      if (!o.items.some((l) => l.sku === i.sku)) fail("not_found", `${i.sku} is not in order ${o.number}.`);
      const { product } = lookupSku(ctx, i.sku);
      const months = product.warranty?.months ?? ctx.business.warranty.default_months;
      if (!months) fail("rule_violation", `${product.name} has no warranty to register. ${product.warranty?.guarantee || ""}`.trim());
      if (ctx.st.registrations.some((r) => r.order_number === o.number && r.sku === i.sku)) fail("rule_violation", "That product is already registered on this order.");
      const bought = dateOf(ms(arrivedAt(o, i.sku) || o.placed_at));
      const rec = { id: nextId(ctx, "REG"), customer_id: o.customer_id, sku: i.sku, serial: i.serial || null, order_number: o.number, purchased_at: bought, warranty_until: addMonths(bought, months) };
      ctx.st.registrations.push(rec);
      note(ctx, `registration ${rec.id} created`);
      return rec;
    },
  },
  {
    name: "list_repairs", roles: CUSTOMER_READERS, needs_customer: true,
    description: "The customer's Fix Club repairs.",
    input_schema: obj({ customer_id: str }),
    // WHY: customers lose repair numbers; the list lets them ask about "my repair".
    run(ctx, i) {
      const id = who(ctx, i);
      return { repairs: ctx.st.repairs.filter((r) => r.customer_id === id).map((r) => ({ number: r.number, sku: r.sku, status: r.status, fault: r.fault, in_warranty: r.in_warranty })) };
    },
  },
  {
    name: "get_repair", roles: CUSTOMER_READERS, needs_customer: true,
    description: "One repair: status, quote and history.",
    input_schema: obj({ repair_number: str }, ["repair_number"]),
    // WHY: quotes and dates must be read from the record, never promised from memory.
    run(ctx, i) {
      return findOwned(ctx, ctx.st.repairs, "number", i.repair_number, "repair");
    },
  },
  {
    name: "create_repair", roles: CUSTOMER_ROLES, needs_customer: true,
    description: "Opens a Fix Club repair request and works out whether it is in warranty from the purchase date.",
    input_schema: obj({ sku: str, fault: str, order_number: str, registration_id: str }, ["sku", "fault"]),
    // WHY: warranty status decides whether the customer pays, so it is calculated from dates, not asked.
    run(ctx, i) {
      const { product } = lookupSku(ctx, i.sku);
      if (!ctx.business.fix_club.eligible_products.includes(product.id)) fail("rule_violation", `${product.name} is not covered by The Fix Club. ${ctx.business.fix_club.not_eligible_note}`);
      const cid = who(ctx);
      const reg = i.registration_id ? findOwned(ctx, ctx.st.registrations, "id", i.registration_id, "registration") : null;
      const order = i.order_number ? findOwned(ctx, ctx.st.orders, "number", i.order_number, "order") : null;
      if (!reg && !order) fail("invalid_input", `Proof of purchase is needed: ${ctx.business.warranty.needs}`);
      if ((reg && reg.sku !== i.sku) || (order && !order.items.some((l) => l.sku === i.sku))) fail("rule_violation", `${i.sku} is not on that ${reg && reg.sku !== i.sku ? "registration" : "order"}.`);
      const months = product.warranty?.months ?? ctx.business.warranty.default_months;
      const until = reg ? reg.warranty_until : addMonths(dateOf(ms(arrivedAt(order, i.sku) || order.placed_at)), months);
      const inWarranty = months > 0 && dateOf(ms(ctx.now)) <= until;
      const fc = ctx.business.fix_club;
      const rec = {
        number: nextId(ctx, "FIX"), customer_id: cid, sku: i.sku, registration_id: reg?.id ?? null, order_number: order?.number ?? reg?.order_number ?? null,
        fault: i.fault, in_warranty: inWarranty, created_at: ctx.now, status: "requested", quote: null, promised_by: null,
        history: [{ at: ctx.now, event: "Repair requested" }],
      };
      ctx.st.repairs.push(rec);
      note(ctx, `repair ${rec.number} created, in_warranty ${inWarranty}`);
      return {
        ...rec, warranty_until: until, assessment_fee: inWarranty ? 0 : fc.assessment_fee, postage: fc.postage,
        fixed_price_list: product.fix_club?.repairs || [], turnaround_working_days: fc.turnaround_working_days,
      };
    },
  },
  {
    name: "approve_repair_quote", roles: CUSTOMER_ROLES, needs_customer: true,
    description: "Moves a repair from quote_sent to approved, if the quote is still valid.",
    input_schema: obj({ repair_number: str }, ["repair_number"]),
    // WHY: quotes expire so prices are not held forever; the customer must ask for a fresh one after that.
    run(ctx, i) {
      const r = findOwned(ctx, ctx.st.repairs, "number", i.repair_number, "repair");
      if (r.status !== "quote_sent" || !r.quote) fail("rule_violation", `Repair ${r.number} is "${r.status}", so there is no quote to approve.`);
      const lastDay = isDateOnly(r.quote.valid_until) ? ms(r.quote.valid_until) + DAY : ms(r.quote.valid_until);
      if (ms(ctx.now) >= lastDay) fail("rule_violation", `That quote ran out on ${dateOf(ms(r.quote.valid_until))} (quotes last ${ctx.business.fix_club.quote_valid_days} days). A technician needs to send a fresh one.`);
      setField(ctx, `repair ${r.number}`, r, "status", "approved");
      r.promised_by = addWorkingDays(ctx.now, ctx.business.fix_club.turnaround_working_days);
      historyAdd(ctx, r, "Quote approved");
      return { repair_number: r.number, status: r.status, total: r.quote.total, promised_by: r.promised_by };
    },
  },
  {
    name: "list_bookings", roles: CUSTOMER_ROLES, needs_customer: true,
    description: "The customer's bookings.",
    input_schema: obj({ customer_id: str }),
    // WHY: lets the customer find a booking without the number.
    run(ctx, i) {
      const id = who(ctx, i);
      return { bookings: ctx.st.bookings.filter((b) => b.customer_id === id).sort((a, b) => ms(a.start) - ms(b.start)) };
    },
  },
  {
    name: "get_booking", roles: CUSTOMER_ROLES, needs_customer: true,
    description: "One booking.",
    input_schema: obj({ booking_number: str }, ["booking_number"]),
    // WHY: dates, deposits and payments are read from the record.
    run(ctx, i) {
      return findOwned(ctx, ctx.st.bookings, "number", i.booking_number, "booking");
    },
  },
  {
    name: "create_booking", roles: CUSTOMER_ROLES, needs_customer: true,
    description: "Books a Borrow Box item or a package of Someone to Clap, Queue, Hold or Wait In and takes simulated payment. For Queue, Hold and Wait In, location is the place, number or address and note is what it is for.",
    input_schema: obj({ service: { type: "string", enum: ["borrow-box", "someone-to-clap", "someone-to-queue", "someone-to-hold", "someone-to-wait-in"] }, item_id: str, start: str, party_size: { type: "integer" }, add_ons: strs, end: str, distance_miles: num, delivery: bool, location: str, note: str }, ["service", "item_id", "start"]),
    // WHY: availability, notice and service area are checked together so a booking is never made that we cannot deliver.
    run(ctx, i) {
      const cid = who(ctx);
      const plan = PLANNERS[i.service](ctx, { ...i, customer_id: cid });
      const rec = {
        number: nextId(ctx, "BKG"), customer_id: cid, service: i.service, ...plan, status: "confirmed",
        payment: { status: "paid", refunded: 0 }, reschedules: 0, created_at: ctx.now, note: "",
      };
      ctx.st.bookings.push(rec);
      note(ctx, `booking ${rec.number} created (${i.service} ${plan.item_id})`);
      return rec;
    },
  },
  {
    name: "reschedule_booking", roles: CUSTOMER_ROLES, needs_customer: true,
    description: "Moves a booking to a new date, slot or session under the service's reschedule rule.",
    input_schema: obj({ booking_number: str, new_item_id: str, new_start: str, new_end: str }, ["booking_number"]),
    // WHY: free changes are a promise only while we can still resell the old slot, hence the notice cut-off.
    run(ctx, i) {
      const b = findOwned(ctx, ctx.st.bookings, "number", i.booking_number, "booking");
      if (!BOOKING_LIVE.includes(b.status) || b.status === "out_on_hire") fail("rule_violation", `Booking ${b.number} is ${b.status} and cannot be moved.`);
      if (!i.new_item_id && !i.new_start) fail("invalid_input", "Give a new_start or a new_item_id.");
      const fee = rescheduleFee(ctx, b);
      const plan = PLANNERS[b.service](ctx, { item_id: i.new_item_id || b.item_id, start: i.new_start || b.start, end: i.new_end, party_size: b.party_size, add_ons: b.add_ons, distance_miles: b.distance_miles ?? undefined, delivery: b.service === "borrow-box" && b.location !== BORROW_LOCATION, location: b.location, note: b.note, customer_id: b.customer_id }, b.number);
      const rescheduled = b.reschedules + 1;
      note(ctx, `booking ${b.number} start ${b.start} → ${plan.start}`);
      Object.assign(b, { item_id: plan.item_id, start: plan.start, end: plan.end, location: plan.location, reschedules: rescheduled });
      if (b.service === "borrow-box") b.price = plan.price;
      if (fee) { b.payment.extra_fees = round2((b.payment.extra_fees || 0) + fee); note(ctx, `booking ${b.number} reschedule fee ${money(fee)}`); }
      return { booking: b, fee };
    },
  },
  {
    name: "cancel_booking", roles: CUSTOMER_ROLES, needs_customer: true,
    description: "Cancels a booking and refunds whatever the service's cancellation rule allows. Returns the amount.",
    input_schema: obj({ booking_number: str }, ["booking_number"]),
    // WHY: refunds fall with notice because late cancellations leave us with an empty slot we cannot resell.
    run(ctx, i) {
      const b = findOwned(ctx, ctx.st.bookings, "number", i.booking_number, "booking");
      if (b.status !== "confirmed") fail("rule_violation", `Booking ${b.number} is ${b.status}, so it cannot be cancelled.`);
      if (hoursUntil(ctx, b.start) <= 0) fail("rule_violation", "That booking has already started.");
      const t = cancellationTerms(ctx, b);
      const total = round2(t.price_refund + t.deposit_refund);
      setField(ctx, `booking ${b.number}`, b, "status", "cancelled");
      b.payment.refunded = round2((b.payment.refunded || 0) + total);
      b.payment.status = total >= b.price + b.deposit ? "refunded" : "part_refunded";
      if (t.credit_amount) {
        const c = getCustomer(ctx, b.customer_id);
        note(ctx, `customer ${c.id} credit_balance ${c.credit_balance} → ${round2(c.credit_balance + t.credit_amount)}`);
        c.credit_balance = round2(c.credit_balance + t.credit_amount);
      }
      return { booking_number: b.number, refund_amount: total, price_refund: t.price_refund, deposit_refund: t.deposit_refund, credit_amount: t.credit_amount, rule: t.rule, refund_expected_by: total ? addWorkingDays(ctx.now, ctx.business.payments.refund_time_working_days) : null };
    },
  },
  {
    name: "list_cases", roles: CUSTOMER_READERS, needs_customer: true,
    description: "Earlier contacts (cases) for this customer.",
    input_schema: obj({ customer_id: str }),
    // WHY: repeat contacts about the same problem must be spotted, because they escalate.
    run(ctx, i) {
      const id = who(ctx, i);
      return { cases: ctx.st.cases.filter((c) => c.customer_id === id).map((c) => ({ number: c.number, subject: c.subject, category: c.category, status: c.status, opened_at: c.opened_at, related: c.related })) };
    },
  },
  {
    name: "get_case", roles: CUSTOMER_READERS, needs_customer: true,
    description: "One case with its notes.",
    input_schema: obj({ case_number: str }, ["case_number"]),
    // WHY: notes carry what was already tried, so the customer does not repeat themselves.
    run(ctx, i) {
      return findOwned(ctx, ctx.st.cases, "number", i.case_number, "case");
    },
  },
  {
    name: "open_case", roles: CUSTOMER_ROLES, needs_customer: true,
    description: "Records the interaction as a support case.",
    input_schema: obj({ customer_id: str, contact_id: str, subject: str, category: { type: "string", enum: ["orders", "delivery", "returns", "repairs", "bookings", "product", "complaint", "account", "other"] }, summary: str, related: { type: "object" }, is_complaint: bool }, ["subject", "category", "summary"]),
    // WHY: every contact leaves a trace, so the next person (or the next call) knows what happened.
    run(ctx, i) {
      // WHY: staff at the help desk name the customer; a verified session already knows who it is.
      const cid = who(ctx, i);
      if (!getCustomer(ctx, cid)) fail("not_found", `There is no customer ${cid}.`);
      const contact = i.contact_id ? ctx.st.contacts.find((c) => c.id === i.contact_id && (!c.customer_id || c.customer_id === cid)) : null;
      if (i.contact_id && !contact) fail("not_found", `There is no contact ${i.contact_id} for this customer.`);
      const related = i.related || {};
      const lists = { order: ["orders", "number"], return: ["returns", "number"], repair: ["repairs", "number"], booking: ["bookings", "number"] };
      for (const [k, v] of Object.entries(related)) {
        if (!lists[k]) fail("invalid_input", `related can name: ${Object.keys(lists).join(", ")}.`);
        findOwned(ctx, ctx.st[lists[k][0]], lists[k][1], v, k);
      }
      const c = openCaseRecord(ctx, { customer_id: cid, subject: i.subject, category: i.category, summary: i.summary, related, is_complaint: !!i.is_complaint || i.category === "complaint" });
      // Linking the contact makes it show its case, as contacts from the history do.
      if (contact) {
        setField(ctx, `contact ${contact.id}`, contact, "case_number", c.number);
        setField(ctx, `contact ${contact.id}`, contact, "outcome", "case_opened");
      }
      return c;
    },
  },
  {
    name: "add_case_note", roles: CUSTOMER_ROLES, needs_customer: true,
    description: "Adds a note to a case.",
    input_schema: obj({ case_number: str, text: str }, ["case_number", "text"]),
    // WHY: later people read the notes, so new facts must be added, not lost.
    run(ctx, i) {
      const c = findOwned(ctx, ctx.st.cases, "number", i.case_number, "case");
      c.notes.push({ at: ctx.now, by: ctx.role, text: i.text });
      note(ctx, `case ${c.number} note added`);
      return { case_number: c.number, notes: c.notes.length };
    },
  },
  {
    name: "escalate", roles: CUSTOMER_ROLES,
    description: "Hands a case to a person (support_agent, support_lead, technician or coordinator) and sets it to escalated. Works for an unverified customer: then give a contact detail and no case_number is needed.",
    input_schema: obj({ case_number: str, customer_id: str, to: { type: "string", enum: ["support_agent", "support_lead", "technician", "coordinator"] }, reason: str, summary: str, contact: str }, ["to", "reason", "summary"]),
    // WHY: the one safe exit. Even someone we cannot verify must be able to reach a human, without being shown any records.
    run(ctx, i) {
      let c;
      // WHY: staff can act on a case or a named customer without verifying the session as that customer.
      const staffNamed = STAFF.includes(ctx.role) && (i.case_number || i.customer_id);
      if (ctx.sess.customer_id || staffNamed) {
        c = i.case_number ? findOwned(ctx, ctx.st.cases, "number", i.case_number, "case")
          : openCaseRecord(ctx, { customer_id: ctx.sess.customer_id || i.customer_id, subject: i.reason, category: "other", summary: i.summary });
        c.notes.push({ at: ctx.now, by: ctx.role, text: i.summary });
      } else {
        if (!i.contact) fail("invalid_input", "This person is not verified, so a contact detail (email or phone) is needed to follow up.");
        c = openCaseRecord(ctx, { customer_id: null, subject: i.reason, category: "other", summary: `${i.summary} Contact: ${i.contact}` });
      }
      escalateCase(ctx, c, i.to, i.reason);
      return { case_number: c.number, status: c.status, escalated_to: c.escalated_to, reply_target_working_days: ctx.business.contact.support_reply_target_working_days };
    },
  },

  // ============================== staff only
  {
    name: "issue_refund", roles: ["support_agent", "support_lead"],
    description: "Refunds money to the order's original payment. Support agent up to the role's refund limit; support lead any amount.",
    input_schema: obj({ order_number: str, amount: num, reason: str }, ["order_number", "amount", "reason"]),
    // WHY: money leaves only through limits a person owns; the assistant gets forbidden so an attempt is plainly visible in the audit.
    run(ctx, i) { return refundOrder(ctx, i); },
  },
  {
    name: "approve_large_refund", roles: ["manager"],
    description: "The manager's refund, for amounts over the support lead's limit. Same rules otherwise.",
    input_schema: obj({ order_number: str, amount: num, reason: str }, ["order_number", "amount", "reason"]),
    // WHY: the largest refunds need the most senior person, and a separate tool makes that visible in the audit.
    run(ctx, i) { return refundOrder(ctx, i); },
  },
  {
    name: "add_goodwill_credit", roles: ["support_agent", "support_lead"],
    description: "Adds account credit as a goodwill gesture. Support agent up to the role's limit; support lead any amount.",
    input_schema: obj({ customer_id: str, amount: num, reason: str, case_number: str }, ["customer_id", "amount", "reason"]),
    // WHY: goodwill is discretionary, so it is capped per role. It is a cost the day it is given (money.mjs: goodwill_credit).
    run(ctx, i) {
      const limit = ctx.business.roles.support_agent.goodwill_credit_limit;
      const c = getCustomer(ctx, i.customer_id) || fail("not_found", `No customer ${i.customer_id}.`);
      if (!(i.amount > 0)) fail("invalid_input", "The amount must be more than zero.");
      if (ctx.role === "support_agent" && i.amount > limit) fail("rule_violation", `A support agent can give up to ${money(limit)} goodwill credit.`);
      if (i.case_number) findOwned(ctx, ctx.st.cases, "number", i.case_number, "case");
      setField(ctx, `customer ${c.id}`, c, "credit_balance", round2(c.credit_balance + i.amount));
      // The generator refers goodwill to the case it was given on; without a case, to the customer.
      postLedger(ctx, "goodwill_credit", -i.amount, i.case_number || c.id);
      return { customer_id: c.id, credit_balance: c.credit_balance };
    },
  },
  {
    name: "settle_pay_later", roles: MONEY_READERS,
    description: "Marks a pay-later order as paid: the customer has paid what was owed. Finance or the manager.",
    input_schema: obj({ order_number: str }, ["order_number"]),
    // WHY: pay later is money owed, not money taken, until someone who keeps the books records that it came in.
    run(ctx, i) {
      const o = ctx.st.orders.find((x) => x.number === i.order_number) || fail("not_found", `No order ${i.order_number}.`);
      const p = o.payment;
      if (!p.due_date) fail("rule_violation", `Order ${o.number} was not paid with pay later.`);
      if (p.status === "nothing_due") fail("rule_violation", `Nothing is owed on order ${o.number}: it was all taken off before it was paid.`);
      if (!isPayLaterDue(p)) fail("rule_violation", `Order ${o.number} is already settled (payment ${p.status}).`);
      const amount = settlePayLater(ctx, o);
      return { order_number: o.number, paid: amount, payment_status: p.status, settled_at: p.settled_at };
    },
  },
  {
    name: "advance_order", roles: ["warehouse"],
    description: "Moves an order along: packed, dispatched, delivered. Parcels still waiting for stock stay behind.",
    input_schema: obj({ order_number: str, to: str }, ["order_number", "to"]),
    // WHY: the simulation needs the warehouse to move time forward, and the cancel/change rules hinge on "packed".
    run(ctx, i) {
      const next = { placed: ["packed"], paid: ["packed"], packed: ["dispatched"], part_dispatched: ["dispatched"], dispatched: ["delivered"] };
      const o = ctx.st.orders.find((x) => x.number === i.order_number) || fail("not_found", `No order ${i.order_number}.`);
      if (!(next[o.status] || []).includes(i.to)) fail("rule_violation", `An order that is ${o.status} cannot go to ${i.to}.`);
      // WHY: dispatch and delivery go through the same helpers as advance_day, so a parcel costs the same whoever moves it.
      for (const s of o.shipments || []) {
        if (["cancelled", "delivered", "lost"].includes(s.status) || waiting(s)) continue;
        if (i.to === "packed") s.status = "packed";
        if (i.to === "dispatched" && ["pending", "packed"].includes(s.status)) dispatchShipment(ctx, o, s);
        if (i.to === "delivered" && s.dispatched_at) deliverShipment(ctx, o, s);
      }
      setField(ctx, `order ${o.number}`, o, "status", i.to);
      historyAdd(ctx, o, `Order ${i.to}`);
      return { order_number: o.number, status: o.status };
    },
  },
  {
    name: "receive_return", roles: ["warehouse"],
    description: "Records a returned parcel arriving and its inspection. Passed: the refund is paid and resaleable items (change of mind, wrong item) go back on the shelf; faulty or damaged ones are scrapped. Failed: the return is rejected and nothing is paid.",
    input_schema: obj({ return_number: str, passed: bool }, ["return_number", "passed"]),
    // WHY: the refund follows inspection, as the returns policy says.
    run(ctx, i) {
      const r = ctx.st.returns.find((x) => x.number === i.return_number) || fail("not_found", `No return ${i.return_number}.`);
      if (!["requested", "label_sent", "in_transit", "received"].includes(r.status)) fail("rule_violation", `Return ${r.number} is ${r.status}.`);
      if (!i.passed) {
        // WHY: a rejected return pays nothing and deducts nothing (the generator's rule); the item goes back to the customer.
        setField(ctx, `return ${r.number}`, r, "status", "rejected");
        Object.assign(r, { refund_amount: 0, postage_deducted: 0 });
        return { return_number: r.number, status: r.status };
      }
      const o = ctx.st.orders.find((x) => x.number === r.order_number);
      setField(ctx, `return ${r.number}`, r, "status", "refunded");
      r.refunded_at = stamp(ctx);
      const back = giveBack(ctx, o, r.refund_amount, r.number);
      // WHY: only things we can sell again go back on the shelf; a faulty or damaged item is scrapped. Its cost was already counted when it sold.
      if (RESALEABLE.includes(r.reason)) for (const l of r.items) moveStock(ctx, l.sku, l.qty, "returned_to_stock", r.number);
      historyAdd(ctx, o, back.due_cancelled ? `Return ${r.number}: ${money(back.amount)} taken off what is owed` : `Return ${r.number} refunded ${money(back.amount)}`);
      if (back.due_cancelled) return { return_number: r.number, status: r.status, refund_amount: 0, due_cancelled: back.due_cancelled, still_due: back.still_due, message: back.how };
      return { return_number: r.number, status: r.status, refund_amount: back.amount, refund_due_by: addWorkingDays(ctx.now, ctx.business.payments.refund_time_working_days) };
    },
  },
  {
    name: "adjust_stock", roles: ["warehouse"],
    description: "Sets units on hand for a SKU, with an optional restock date. Recorded as a stock count with a count_adjustment movement.",
    input_schema: obj({ sku: str, on_hand: { type: "integer" }, restock_date: str }, ["sku", "on_hand"]),
    // WHY: stock gets corrected by people; doing it as a count keeps on hand equal to the sum of movements and costs the difference.
    run(ctx, i) {
      countStock(ctx, i.sku, i.on_hand, "Set by the warehouse.", true);
      const s = ctx.st.stock[i.sku];
      if (i.restock_date !== undefined) setField(ctx, `stock ${i.sku}`, s, "restock_date", i.restock_date);
      return { sku: i.sku, ...s };
    },
  },
  {
    name: "update_repair", roles: ["technician"],
    description: "Moves a repair to a new status, optionally with a quote ({ lines:[{code,name,price}] }). A quote is valid for the period in business.json. Money follows: the assessment fee when an out-of-warranty item is received, the repair price and parts cost when repaired, the fee back if unrepairable.",
    input_schema: obj({ repair_number: str, status: str, quote: { type: "object" } }, ["repair_number", "status"]),
    // WHY: only the bench knows the true fault; quotes come from there, not from the assistant.
    run(ctx, i) {
      const r = ctx.st.repairs.find((x) => x.number === i.repair_number) || fail("not_found", `No repair ${i.repair_number}.`);
      if (!ctx.business.fix_club.statuses.includes(i.status)) fail("invalid_input", `Status must be one of: ${ctx.business.fix_club.statuses.join(", ")}.`);
      if (i.status === "quote_sent") {
        const lines = i.quote?.lines;
        if (!Array.isArray(lines) || !lines.length) fail("invalid_input", "A quote needs lines: [{ code, name, price }].");
        const total = round2(lines.reduce((n, l) => n + l.price, 0));
        r.quote = { lines, total, sent_at: ctx.now, valid_until: addDays(dateOf(ms(ctx.now)), ctx.business.fix_club.quote_valid_days) };
        note(ctx, `repair ${r.number} quote ${money(total)}`);
      }
      const from = r.status;
      setField(ctx, `repair ${r.number}`, r, "status", i.status);
      historyAdd(ctx, r, `Status ${i.status}`);
      repairMoney(ctx, r, from);
      return r;
    },
  },
  {
    name: "override_booking", roles: ["coordinator"],
    description: "Changes a booking directly (start, end, item_id, status, price, deposit, party_size, location, note). Skips availability and notice rules.",
    input_schema: obj({ booking_number: str, changes: { type: "object" } }, ["booking_number", "changes"]),
    // WHY: coordinators sometimes have to bend the rules (a crew is freed, a hire is extended); that power is theirs alone.
    run(ctx, i) {
      const b = ctx.st.bookings.find((x) => x.number === i.booking_number) || fail("not_found", `No booking ${i.booking_number}.`);
      const allowed = ["start", "end", "item_id", "status", "price", "deposit", "party_size", "location", "note"];
      const bad = Object.keys(i.changes).filter((k) => !allowed.includes(k));
      if (bad.length) fail("invalid_input", `Cannot change: ${bad.join(", ")}. Allowed: ${allowed.join(", ")}.`);
      for (const [k, v] of Object.entries(i.changes)) setField(ctx, `booking ${b.number}`, b, k, v);
      return b;
    },
  },
  {
    name: "resolve_case", roles: ["support_agent", "support_lead"],
    description: "Closes a case as resolved with a note.",
    input_schema: obj({ case_number: str, note: str }, ["case_number", "note"]),
    // WHY: a resolved case needs a written outcome so a repeat contact can see what was done.
    run(ctx, i) {
      const c = ctx.st.cases.find((x) => x.number === i.case_number) || fail("not_found", `No case ${i.case_number}.`);
      setField(ctx, `case ${c.number}`, c, "status", "resolved");
      c.notes.push({ at: ctx.now, by: ctx.role, text: i.note });
      return { case_number: c.number, status: c.status };
    },
  },

  // ============================== back office (generated worlds). Never the customer or the customer-facing assistant.
  {
    name: "get_company", roles: INTERNAL,
    description: "What the company does, its roles, working hours, the tools staff use and how a normal day runs.",
    input_schema: obj({}),
    // WHY: an internal agent needs the shape of the business before it can reason about it.
    run(ctx) { return ctx.st.company || fail("not_found", "This world has no company record. Load a generated world."); },
  },
  {
    name: "list_suppliers", roles: STOCK_READERS,
    description: "Every supplier: what they supply, lead time, minimum order, payment terms and reliability.",
    input_schema: obj({}),
    // WHY: supplier costs are commercial details, so only back-office roles see them.
    run(ctx) { return { suppliers: ctx.st.suppliers }; },
  },
  {
    name: "get_supplier", roles: STOCK_READERS,
    description: "One supplier with unit costs per SKU.",
    input_schema: obj({ id: str }, ["id"]),
    run(ctx, i) { return ctx.st.suppliers.find((x) => x.id === i.id) || fail("not_found", `No supplier ${i.id}.`); },
  },
  {
    name: "list_purchase_orders", roles: STOCK_READERS,
    description: "Purchase orders, newest first. Optional filters: status, supplier_id, sku. At most 100.",
    input_schema: obj({ status: str, supplier_id: str, sku: str }),
    run(ctx, i) {
      const list = ctx.st.purchase_orders.filter((p) => (!i.status || p.status === i.status) && (!i.supplier_id || p.supplier_id === i.supplier_id) && (!i.sku || p.lines.some((l) => l.sku === i.sku)));
      return { total: list.length, purchase_orders: list.slice().reverse().slice(0, 100) };
    },
  },
  {
    name: "get_purchase_order", roles: STOCK_READERS,
    description: "One purchase order with its lines, dates and status.",
    input_schema: obj({ number: str }, ["number"]),
    run(ctx, i) { return findPO(ctx, i.number); },
  },
  {
    name: "stock_history", roles: STOCK_READERS,
    description: "Stock on hand for a SKU, every movement (newest 200), its stock counts and open purchase orders.",
    input_schema: obj({ sku: str }, ["sku"]),
    // WHY: on hand is the sum of movements; showing them lets anyone check the number.
    run(ctx, i) {
      lookupSku(ctx, i.sku);
      const moves = ctx.st.stock_movements.filter((m) => m.sku === i.sku);
      return { sku: i.sku, ...stockOf(ctx, i.sku), movements_total: moves.length, movements: moves.slice(-200),
        counts: ctx.st.stock_counts.filter((c) => c.sku === i.sku),
        open_purchase_orders: ctx.st.purchase_orders.filter((p) => ["draft", "awaiting_approval", "ordered", "late"].includes(p.status) && p.lines.some((l) => l.sku === i.sku)) };
    },
  },
  {
    name: "get_monthly_summary", roles: MONEY_READERS,
    description: "Monthly figures: revenue, refunds, cost of goods, costs by type, profit, orders, cash. One month (YYYY-MM) or all.",
    input_schema: obj({ month: str }),
    run(ctx, i) {
      flushSummary(ctx);
      if (!i.month) return { months: ctx.st.monthly_summary };
      return ctx.st.monthly_summary.find((m) => m.month === i.month) || fail("not_found", `No summary for ${i.month}.`);
    },
  },
  {
    name: "ledger_search", roles: MONEY_READERS,
    description: "Ledger entries by type, date range (from/to, YYYY-MM-DD) and reference. Returns the total and at most 200 entries.",
    input_schema: obj({ type: str, from: str, to: str, reference: str }),
    // WHY: money questions must be answered from entries, never from estimates.
    run(ctx, i) {
      const list = ctx.st.ledger.filter((e) => (!i.type || e.type === i.type) && (!i.reference || e.reference === i.reference)
        && (!i.from || e.at.slice(0, 10) >= i.from) && (!i.to || e.at.slice(0, 10) <= i.to));
      return { count: list.length, total: round2(list.reduce((n, e) => n + e.amount, 0)), entries: list.slice(0, 200) };
    },
  },
  {
    name: "add_ledger_correction", roles: MONEY_READERS,
    description: "Adds a correcting ledger entry (signed amount, GBP) against a reference, with a written reason. Never edits an old entry.",
    input_schema: obj({ amount: num, reference: str, reason: str }, ["amount", "reference", "reason"]),
    // WHY: books are corrected by adding entries, so the mistake and its fix both stay visible.
    run(ctx, i) {
      if (!i.amount) fail("invalid_input", "The amount cannot be zero.");
      if (String(i.reason).trim().length < 5) fail("invalid_input", "Give a reason for the correction.");
      const e = { id: nextId(ctx, "LED", 6), at: ctx.now, type: "correction", amount: round2(i.amount), reference: i.reference, month: ctx.now.slice(0, 7), reason: i.reason, by: ctx.role };
      ctx.st.ledger.push(e);
      note(ctx, `ledger ${e.id} correction ${money(e.amount)} on ${i.reference}`);
      return e;
    },
  },
  {
    name: "list_campaigns", roles: MARKETING_READERS,
    description: "Marketing campaigns with channel, dates, spend, visits, orders attributed and any discount code, and `status` (scheduled, running or ended). Ones made with create_campaign also show monthly_spend and spend_to_date.",
    input_schema: obj({}),
    run(ctx) {
      const today = dateOf(ms(ctx.now));
      return { campaigns: ctx.st.campaigns.map((c) => ({ ...c, status: c.ended || c.end < today ? "ended" : c.start > today ? "scheduled" : "running" })) };
    },
  },
  {
    name: "web_sessions", roles: MARKETING_READERS,
    description: "Daily website visits by channel, product page views, baskets and orders. Dates from/to (YYYY-MM-DD); at most 92 days.",
    input_schema: obj({ from: str, to: str }),
    run(ctx, i) {
      const list = ctx.st.web_sessions_daily.filter((d) => (!i.from || d.date >= i.from) && (!i.to || d.date <= i.to));
      return { days: list.slice(-92) };
    },
  },
  {
    name: "list_contacts", roles: ["support_agent", "support_lead", "manager"],
    description: "Inbound contacts (chat, email, phone, text), newest first, optionally for one customer. At most 100. Each row has customer_name and `about`, a one-line plain summary, so a list needs no second call per row.",
    input_schema: obj({ customer_id: str }),
    run(ctx, i) {
      const list = ctx.st.contacts.filter((c) => !i.customer_id || c.customer_id === i.customer_id);
      const names = new Map(ctx.st.customers.map((c) => [c.id, c.name]));
      return { total: list.length, contacts: list.slice().reverse().slice(0, 100).map((c) => ({ ...c, customer_name: names.get(c.customer_id) || null, about: contactAbout(c) })) };
    },
  },
  {
    name: "list_customers", roles: INTERNAL,
    description: "Customers, in id order: id, name, email, marketing_opt_in, joined date and number of orders. `search` keeps names or emails containing every word given; `marketing_opt_in` true or false keeps only those who have (or have not) agreed to marketing mail. limit defaults to 50 (at most 200); `offset` pages on. Staff only: never for a customer or the customer-facing assistant.",
    input_schema: obj({ search: str, marketing_opt_in: bool, limit: { type: "integer" }, offset: { type: "integer" } }),
    // WHY: a newsletter audience should be one call, not one read per customer.
    run(ctx, i) {
      const words = i.search ? tokens(i.search) : [];
      const counts = new Map();
      for (const o of ctx.st.orders) counts.set(o.customer_id, (counts.get(o.customer_id) || 0) + 1);
      const rows = ctx.st.customers.filter((c) => (!words.length || matches(`${c.name} ${c.email}`, words)) && (i.marketing_opt_in === undefined || (c.marketing_opt_in !== false) === i.marketing_opt_in));
      const from = Math.max(0, Math.floor(i.offset || 0)), n = Math.min(200, Math.max(1, Math.floor(i.limit || 50)));
      return { total: rows.length, offset: from, customers: rows.slice(from, from + n).map((c) => ({ id: c.id, name: c.name, email: c.email, marketing_opt_in: c.marketing_opt_in !== false, joined: String(c.created_at || "").slice(0, 10), orders: counts.get(c.id) || 0 })) };
    },
  },
  {
    name: "list_all_orders", roles: INTERNAL,
    description: "Every order in the shop, newest first, including ones whose payment was declined (status payment_failed). Filters: status, from and to (dates such as 2026-11-22, on the day placed), customer_id, and `search` (words in the order number, customer name or email, or the items). limit defaults to 50 (at most 200); offset pages on. Each row has customer_name, total, payment_status, payment method and a short item list. Staff only: use get_order for one order in full.",
    input_schema: obj({ status: str, from: str, to: str, customer_id: str, search: str, limit: { type: "integer" }, offset: { type: "integer" } }),
    // WHY: the shop admin screen needs the whole list in one call, not ledger lines and a read per order.
    run(ctx, i) {
      for (const [k, v] of [["from", i.from], ["to", i.to]]) if (v !== undefined && !isDateOnly(v)) fail("invalid_input", `The ${k} date must look like 2026-11-22.`);
      const names = new Map(ctx.st.customers.map((c) => [c.id, c]));
      const words = i.search ? tokens(i.search) : [];
      const rows = ctx.st.orders.filter((o) => (!i.status || o.status === i.status) && (!i.customer_id || o.customer_id === i.customer_id)
        && (!i.from || o.placed_at.slice(0, 10) >= i.from) && (!i.to || o.placed_at.slice(0, 10) <= i.to)
        && (!words.length || matches(`${o.number} ${names.get(o.customer_id)?.name || ""} ${names.get(o.customer_id)?.email || ""} ${o.items.map((x) => x.name).join(" ")}`, words)))
        .sort((a, b) => (a.placed_at < b.placed_at ? 1 : a.placed_at > b.placed_at ? -1 : a.number < b.number ? 1 : -1));
      const from = Math.max(0, Math.floor(i.offset || 0)), n = Math.min(200, Math.max(1, Math.floor(i.limit || 50)));
      return { total: rows.length, offset: from, orders: rows.slice(from, from + n).map((o) => ({
        number: o.number, customer_id: o.customer_id, customer_name: names.get(o.customer_id)?.name || null, placed_at: o.placed_at, status: o.status,
        total: o.totals.total, payment_status: o.payment?.status || null, payment_method: o.payment?.method || null, items: o.items.map((x) => `${x.qty} x ${x.name}`),
      })) };
    },
  },
  {
    name: "price_history", roles: INTERNAL,
    description: "What a price was and when it changed, newest change first. Give `sku` for one product line, or leave it out for every change. Each change has date, old_price, new_price and the reason, and includes changes made after the business started (change_price). With a sku, `price_now` is today's price. Dates from and to narrow it; at most 500 changes.",
    input_schema: obj({ sku: str, from: str, to: str }),
    run(ctx, i) {
      if (i.sku) lookupSku(ctx, i.sku);
      for (const [k, v] of [["from", i.from], ["to", i.to]]) if (v !== undefined && !isDateOnly(v)) fail("invalid_input", `The ${k} date must look like 2026-11-22.`);
      const rows = (ctx.st.price_history || []).filter((h) => (!i.sku || h.sku === i.sku) && (!i.from || h.date >= i.from) && (!i.to || h.date <= i.to))
        .slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      return { ...(i.sku ? { sku: i.sku, price_now: priceOf(ctx, i.sku) } : {}), total: rows.length, changes: rows.slice(0, 500) };
    },
  },
  {
    name: "list_pay_later", roles: MONEY_READERS,
    description: "Orders with money still owed on pay later, oldest due date first: order number, customer, amount owed, due date and days overdue (0 if not yet due). Finance or the manager.",
    input_schema: obj({}),
    // WHY: finance chases what is owed; before this they had to open every order to find it.
    run(ctx) {
      const today = dateOf(ms(ctx.now)), names = new Map(ctx.st.customers.map((c) => [c.id, c.name]));
      const rows = ctx.st.orders.filter((o) => o.payment && isPayLaterDue(o.payment)).map((o) => ({
        order_number: o.number, customer_id: o.customer_id, customer_name: names.get(o.customer_id) || null, placed_at: o.placed_at,
        owed: o.payment.due, due_date: o.payment.due_date, days_overdue: Math.max(0, Math.round((ms(`${today}T00:00:00Z`) - ms(`${o.payment.due_date}T00:00:00Z`)) / 86400000)),
      })).sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : a.order_number < b.order_number ? -1 : 1));
      return { total: rows.length, owed_total: round2(rows.reduce((n, r) => n + r.owed, 0)), orders: rows };
    },
  },
  {
    name: "list_returns", roles: ["support_agent", "support_lead", "warehouse", "manager"],
    description: "Returns, newest first, optionally for one customer or with one status (requested, label_sent, in_transit, received, refunded, rejected). At most 100.",
    input_schema: obj({ customer_id: str, status: str }),
    // WHY: the help desk and the warehouse both need to see what is coming back, not one return at a time.
    run(ctx, i) {
      const list = ctx.st.returns.filter((r) => (!i.customer_id || r.customer_id === i.customer_id) && (!i.status || r.status === i.status));
      return { total: list.length, returns: list.slice().reverse().slice(0, 100) };
    },
  },
  {
    name: "get_conversation", roles: CUSTOMER_READERS, needs_customer: true,
    description: "One chat, email, text or phone conversation with all its messages.",
    input_schema: obj({ conversation_id: str }, ["conversation_id"]),
    // WHY: what the customer already said is the starting point for any reply.
    run(ctx, i) {
      return findOwned(ctx, ctx.st.conversations, "id", i.conversation_id, "conversation");
    },
  },
  {
    name: "list_prospects", roles: SALES,
    description: "Businesses and institutions that might buy in bulk, with sector, size, location, what they need, budget band, decision maker, status and when they were last contacted. Filter by sector, status (new, contacted, replied, customer, declined) or a minimum monthly budget. At most 100.",
    input_schema: obj({ sector: str, status: str, min_monthly_budget: num, limit: { type: "integer" } }),
    // WHY: a sales tool needs a market to look at. The simulator's hidden fields (private) are never shown.
    run(ctx, i) {
      const list = (ctx.st.prospects || []).filter((p) => (!i.sector || p.sector === i.sector) && (!i.status || p.status === i.status) && (!i.min_monthly_budget || p.monthly_budget >= i.min_monthly_budget));
      return { total: list.length, prospects: list.slice(0, Math.min(100, i.limit || 100)).map(({ private: _p, ...p }) => p) };
    },
  },
  {
    name: "get_prospect", roles: SALES,
    description: "One prospect with its outreach history.",
    input_schema: obj({ prospect_id: str }, ["prospect_id"]),
    run(ctx, i) {
      const p = (ctx.st.prospects || []).find((x) => x.id === i.prospect_id) || fail("not_found", `No prospect ${i.prospect_id}.`);
      const { private: _p, ...rest } = p;
      return { ...rest, outreach: (ctx.st.outreach || []).filter((o) => o.prospect_id === p.id) };
    },
  },
  {
    name: "send_outreach", roles: SALES,
    description: "Contacts a prospect by email, letter, phone or visit with a message and, optionally, an offer: offer { items: [{ sku, qty }], discount_percent }. Rules: not within 14 days of the last contact unless they replied; never a prospect who declined; a discount of at most 10% (marketing) or 20% (manager); offered SKUs must exist; the message needs at least 20 characters.",
    input_schema: obj({ prospect_id: str, channel: { type: "string", enum: OUTREACH_CHANNELS }, message: str, offer: { type: "object" } }, ["prospect_id", "channel", "message"]),
    // WHY: lets a tool prospect for business through the same rules as a person. How the prospect answers is decided by the simulator from this record, never from what the tool says it achieved.
    run(ctx, i) {
      const p = (ctx.st.prospects || []).find((x) => x.id === i.prospect_id) || fail("not_found", `No prospect ${i.prospect_id}.`);
      if (p.status === "declined") fail("rule_violation", `${p.name} has said no. Do not contact them again.`);
      if (String(i.message).trim().length < 20) fail("invalid_input", "The message needs at least 20 characters.");
      const today = dateOf(ms(ctx.now));
      if (p.last_contacted && p.status === "contacted" && daysBetween(p.last_contacted, today) < OUTREACH_GAP_DAYS) fail("rule_violation", `${p.name} was contacted on ${p.last_contacted}. Wait ${OUTREACH_GAP_DAYS} days, or until they reply.`);
      const offer = i.offer ? { items: i.offer.items || [], discount_percent: i.offer.discount_percent || 0 } : null;
      if (offer) {
        if (!Array.isArray(offer.items) || typeof offer.discount_percent !== "number" || offer.discount_percent < 0) fail("invalid_input", "An offer needs a list of items with quantities, and a discount of 0% or more.");
        const max = OUTREACH_MAX_DISCOUNT[ctx.role];
        if (offer.discount_percent > max) fail("rule_violation", `The ${ctx.role} role can offer at most ${max}% off.`);
        for (const l of offer.items) { if (!ctx.world.index.skus[l.sku]) fail("not_found", `There is no product with SKU ${l.sku}.`); if (!Number.isInteger(l.qty) || l.qty < 1) fail("invalid_input", "Each offer line needs a whole quantity of 1 or more."); }
      }
      const rec = { id: nextId(ctx, "OUT", 4), at: ctx.now, prospect_id: p.id, channel: i.channel, message: i.message, offer, by_role: ctx.role };
      ctx.st.outreach.push(rec);
      setField(ctx, `prospect ${p.id}`, p, "status", "contacted");
      p.last_contacted = today;
      return rec;
    },
  },
  {
    name: "search_documents", roles: INTERNAL,
    description: "Keyword search across internal documents. Returns id, title, kind, date and status. Some documents are out of date.",
    input_schema: obj({ query: str }, ["query"]),
    run(ctx, i) {
      const words = tokens(i.query);
      return { documents: ctx.st.documents.filter((d) => matches(`${d.title} ${d.body}`, words)).map(({ id, title, kind, written_at, status }) => ({ id, title, kind, written_at, status })) };
    },
  },
  {
    name: "get_document", roles: INTERNAL,
    description: "One internal document in full.",
    input_schema: obj({ id: str }, ["id"]),
    run(ctx, i) { return ctx.st.documents.find((d) => d.id === i.id) || fail("not_found", `No document ${i.id}.`); },
  },
  {
    name: "create_purchase_order", roles: ["buyer", "manager", "operations_assistant"],
    description: "Raises a purchase order to one supplier: lines [{ sku, qty }]. The operations assistant's orders are drafts; a buyer's order over the approval limit waits for the manager.",
    input_schema: obj({ supplier_id: str, lines: { type: "array" }, note: str }, ["supplier_id", "lines"]),
    // WHY: spending money on stock needs a person; the limit keeps large orders with the manager.
    run(ctx, i) {
      const sup = ctx.st.suppliers.find((x) => x.id === i.supplier_id) || fail("not_found", `No supplier ${i.supplier_id}.`);
      if (!i.lines.length) fail("invalid_input", "Add at least one line.");
      const lines = i.lines.map((l) => {
        if (!sup.skus.includes(l.sku)) fail("rule_violation", `${sup.name} does not supply ${l.sku}.`);
        // WHY: a discontinued product is not restocked; its shelf sells through or is written off.
        const e = ctx.world.index.skus[l.sku];
        if (e && statusOf(ctx, e.product) === "discontinued") fail("rule_violation", `${e.product.name} is discontinued, so it is not reordered.`);
        if (!Number.isInteger(l.qty) || l.qty < sup.min_order_qty) fail("rule_violation", `${sup.name}'s minimum order is ${sup.min_order_qty} per line.`);
        return { sku: l.sku, qty: l.qty, unit_cost: sup.unit_cost[l.sku], qty_received: 0 };
      });
      const total = poTotal({ lines });
      const limit = ctx.business.roles.buyer.po_approval_limit;
      const status = ctx.role === "operations_assistant" ? "draft" : ctx.role === "buyer" && total > limit ? "awaiting_approval" : "ordered";
      const po = { number: nextId(ctx, "PO"), supplier_id: sup.id, lines, ordered_at: ctx.now, due_at: addDays(dateOf(ms(ctx.now)), sup.lead_time_days),
        expected_at: null, received_at: null, status, paid_at: null, note: i.note || "", raised_by: ctx.role };
      ctx.st.purchase_orders.push(po);
      if (status === "ordered") for (const l of lines) markRestock(ctx, l.sku, po.due_at);
      note(ctx, `purchase order ${po.number} ${status} ${money(total)}`);
      return { ...po, total };
    },
  },
  {
    name: "approve_purchase_order", roles: ["buyer", "manager"],
    description: "Approves a draft or awaiting-approval purchase order, so it is sent to the supplier. A buyer can approve up to the limit; the manager any amount.",
    input_schema: obj({ number: str }, ["number"]),
    // WHY: the operations assistant can suggest an order but only a person can commit the money.
    run(ctx, i) {
      const po = findPO(ctx, i.number);
      if (!["draft", "awaiting_approval"].includes(po.status)) fail("rule_violation", `${po.number} is ${po.status}; only drafts and orders awaiting approval can be approved.`);
      const total = poTotal(po), limit = ctx.business.roles.buyer.po_approval_limit;
      if (ctx.role === "buyer" && total > limit) fail("rule_violation", `${po.number} is ${money(total)}, over the buyer's ${money(limit)} limit. The manager must approve it.`);
      setField(ctx, `purchase order ${po.number}`, po, "status", "ordered");
      po.ordered_at = ctx.now;
      po.due_at = addDays(dateOf(ms(ctx.now)), ctx.st.suppliers.find((x) => x.id === po.supplier_id).lead_time_days);
      po.approved_by = ctx.role;
      for (const l of po.lines) markRestock(ctx, l.sku, po.due_at);
      return { ...po, total };
    },
  },
  {
    name: "receive_purchase_order", roles: ["warehouse", "buyer", "manager"],
    description: "Books in a delivery. Without lines, everything ordered arrived; with lines [{ sku, qty_received }], only those amounts.",
    input_schema: obj({ number: str, lines: { type: "array" } }, ["number"]),
    // WHY: stock only goes up when goods are counted in, and every unit has a movement.
    run(ctx, i) {
      const po = findPO(ctx, i.number);
      if (!["ordered", "late"].includes(po.status)) fail("rule_violation", `${po.number} is ${po.status}. Only ordered or late purchase orders can be received.`);
      const got = Object.fromEntries((i.lines || po.lines.map((l) => ({ sku: l.sku, qty_received: l.qty }))).map((l) => [l.sku, l.qty_received]));
      for (const sku of Object.keys(got)) if (!po.lines.some((l) => l.sku === sku)) fail("invalid_input", `${sku} is not on ${po.number}.`);
      receiveLines(ctx, po, got);
      return po;
    },
  },
  {
    name: "record_stock_count", roles: ["warehouse", "buyer", "manager"],
    description: "Records a shelf count. Unless adjust is false, stock is set to the counted number with a count_adjustment movement.",
    input_schema: obj({ sku: str, counted_qty: { type: "integer" }, note: str, adjust: bool }, ["sku", "counted_qty"]),
    // WHY: the system number drifts from the shelf; a count with a movement keeps on hand equal to the sum of movements.
    run(ctx, i) { return countStock(ctx, i.sku, i.counted_qty, i.note || "", i.adjust !== false); },
  },
  {
    name: "advance_day", roles: ["manager"],
    description: "Moves the simulated clock forward one day and applies everything due: supplier deliveries arrive (or go late, by the supplier's reliability), waiting parcels take stock that came in, parcels are dispatched, delivered or delayed, unpaid orders are cancelled after 24 hours, pay-later amounts are settled or go overdue, supplier bills and monthly costs are paid, products launch, and late replies and complaint deadlines are flagged.",
    input_schema: obj({}),
    // WHY: lets a test or a simulation see the consequences of decisions without waiting for real days. Deterministic: no randomness, no clock.
    run(ctx) {
      const next = isoOf(ms(ctx.now) + DAY);
      setField(ctx, "clock", ctx.st, "now", next);
      ctx.now = next;
      const today = dateOf(ms(next));
      const done = { deliveries: [], became_late: [], dispatched: [], delivered: [], delayed: [], cancelled: [], stock_allocated: [],
        pay_later_settled: [], pay_later_overdue: [], supplier_payments: [], fixed_costs: [], launched: [], contacts_overdue: [], complaints_past_deadline: [], refunds_late: [] };
      launchesDue(ctx, today, done);
      purchaseOrdersDue(ctx, today, done);
      parcelsDue(ctx, today, done);
      payLaterDue(ctx, today, done);
      supplierPaymentsDue(ctx, done);
      fixedCostsDue(ctx, today, done);
      deadlinesDue(ctx, today, done);
      return { now: next, ...done };
    },
  },
  {
    name: "check_books", roles: MONEY_READERS,
    description: "Health check of the books against the current state: stock against movements per SKU, each order against its ledger entries and stock, refunds against what was paid, every ledger reference, and each month's summary against the ledger. Returns breaks (should be none) and the planted findings the world was built with.",
    input_schema: obj({}),
    // WHY: whatever anyone (or any AI) does, the books must stay true; this is the same set of rules as business/builder/validate.mjs, run on the live state.
    run(ctx) {
      if (!ctx.st.company) fail("not_found", "This world keeps no books (it has no company record). Load a generated world.");
      flushSummary(ctx);
      return checkBooks(ctx);
    },
  },
  {
    name: "business_snapshot", roles: MONEY_READERS,
    description: "Outcome figures from the current state: revenue, refunds, gross margin and profit (this month and since the start), cash, stock value, stockouts, late parcels, open cases, complaints past deadline, average first reply, refunds by reason, pay later owed and actions refused by permissions.",
    input_schema: obj({}),
    // WHY: the figures an evaluation compares before and after someone (or an AI) has worked in the business.
    run(ctx) { flushSummary(ctx); return snapshot(ctx); },
  },
  {
    name: "launch_product", roles: ["manager"],
    description: "Puts a prepared (or discontinued) product on sale from a date (YYYY-MM-DD, default today). Before that date it shows as coming_soon and cannot be ordered.",
    input_schema: obj({ product_id: str, from: str }, ["product_id"]),
    // WHY: a launch is a decision with a date; the shop must not sell it early, and the date must survive a saved run.
    run(ctx, i) {
      const p = ctx.world.index.byId[i.product_id] || fail("not_found", `There is no product ${i.product_id}.`);
      const today = dateOf(ms(ctx.now)), from = i.from || today;
      if (!isDateOnly(from)) fail("invalid_input", "The start date must be a date such as 2026-11-22.");
      if (statusOf(ctx, p) === "active") fail("rule_violation", `${p.name} is already on sale.`);
      const status = from <= today ? "active" : "coming_soon";
      ctx.st.product_status[p.id] = { status, available_from: from };
      note(ctx, `product ${p.id} status → ${status} from ${from}`);
      return { product_id: p.id, status, available_from: from };
    },
  },
  {
    name: "discontinue_product", roles: ["manager"],
    description: "Stops selling a product. stock: sell_through (what is on the shelf can still be bought, no more is ordered) or write_off (shelf stock is written off now, except what waiting orders need). Open orders are still honoured; returns, warranty and repairs still work; the product stays in history.",
    input_schema: obj({ product_id: str, stock: { type: "string", enum: ["sell_through", "write_off"] }, reason: str }, ["product_id", "stock"]),
    // WHY: ending a product has a cost (written-off stock) and must never break orders customers already paid for.
    run(ctx, i) {
      const p = ctx.world.index.byId[i.product_id] || fail("not_found", `There is no product ${i.product_id}.`);
      if (statusOf(ctx, p) === "discontinued") fail("rule_violation", `${p.name} is already discontinued.`);
      ctx.st.product_status[p.id] = { status: "discontinued", discontinued_at: stamp(ctx), sell_through: i.stock === "sell_through", reason: i.reason || "" };
      note(ctx, `product ${p.id} status → discontinued (${i.stock})`);
      const written = [];
      if (i.stock === "write_off") {
        for (const x of [...(p.variants || []), ...(p.accessories || [])]) {
          const extra = stockOf(ctx, x.sku).on_hand - waitingNeed(ctx, x.sku);
          if (extra > 0) { moveStock(ctx, x.sku, -extra, "written_off", p.id); written.push({ sku: x.sku, qty: extra }); }
        }
      }
      return { product_id: p.id, status: "discontinued", stock: i.stock, written_off: written };
    },
  },
  {
    name: "update_product_page", roles: ["manager", "marketing"],
    description: "Rewrites a product's page in the shop (Till): its headline and description as shoppers read them. The catalogue facts (price, stock, specification) are unchanged. Each change is kept, newest last, so the page's history can be read.",
    input_schema: obj({ product_id: str, headline: str, description: str }, ["product_id", "description"]),
    // WHY a record per change rather than editing the catalogue: the page text is content people react to (the public
    // panel reads it, activity-generation/people/panel.ts), and both twins must keep the same catalogue file.
    run(ctx, i) {
      const p = ctx.world.index.byId[i.product_id] || fail("not_found", `There is no product ${i.product_id}.`);
      const description = String(i.description || "").trim();
      if (description.length < 20) fail("invalid_input", "The description needs at least 20 characters.");
      if (description.length > 4000) fail("invalid_input", "The description can be at most 4,000 characters.");
      const id = nextId(ctx, "PP", 5);
      const rec = { id, key: `tool|${id}`, product_id: p.id, headline: String(i.headline || p.name).slice(0, 120), description, at: stamp(ctx), by_role: ctx.role };
      (ctx.st.product_pages ||= []).push(rec);
      note(ctx, `product page ${p.id} rewritten (${id})`);
      return rec;
    },
  },
  {
    name: "change_price", roles: ["manager"],
    description: "Changes a SKU's price from a date (YYYY-MM-DD, default today) and records it in the price history. Orders already placed keep the price they were placed at.",
    input_schema: obj({ sku: str, new_price: num, reason: str, from: str }, ["sku", "new_price", "reason"]),
    // WHY: prices change, but what a customer agreed to pay never does; the history shows when and why.
    run(ctx, i) {
      lookupSku(ctx, i.sku);
      if (!(i.new_price > 0)) fail("invalid_input", "The new price must be more than zero.");
      const date = i.from || dateOf(ms(ctx.now));
      if (!isDateOnly(date)) fail("invalid_input", "The start date must be a date such as 2026-11-22.");
      const old = priceOf(ctx, i.sku);
      if (old === round2(i.new_price)) fail("rule_violation", `${i.sku} already costs ${money(old)}.`);
      const h = { sku: i.sku, old_price: old, new_price: round2(i.new_price), date, reason: i.reason };
      ctx.st.price_history.push(h);
      note(ctx, `price ${i.sku} ${money(old)} → ${money(h.new_price)} from ${date}`);
      return h;
    },
  },
];

// ---------------------------------------------------------------- back-office helpers

/** Bench parts cost as a share of the repair's price. WHY: an assumption (no parts records exist); parts are well under half the price. */
const PARTS_SHARE = 0.4;
const REPAIR_DONE = ["repaired", "returned"];

/**
 * The money a repair status change causes, written once each (r.charges remembers what was taken):
 * - out of warranty, item received: the assessment fee comes in (business.json fix_club.assessment_fee_rules);
 * - repaired (or returned after an approved quote): the quote less the fee already taken comes in, and parts cost goes out;
 * - in warranty, repaired: only the parts cost (we pay for warranty work);
 * - unrepairable: the fee is refunded. Declined: the fee is kept.
 */
function repairMoney(ctx, r, from) {
  const fc = ctx.business.fix_club;
  const c = r.charges || (r.charges = { assessment_fee: 0, repair_price: 0, parts_cost: 0, refunded: 0 });
  const early = ["requested", "awaiting_item"];
  if (!r.in_warranty && early.includes(from) && !early.includes(r.status) && !c.assessment_fee) {
    c.assessment_fee = fc.assessment_fee;
    postLedger(ctx, "repair_income", c.assessment_fee, r.number);
  }
  if (REPAIR_DONE.includes(r.status) && !c.parts_cost && !(r.status === "returned" && from === "declined")) {
    const product = ctx.world.index.skus[r.sku]?.product;
    const listed = (product?.fix_club?.repairs || []).find((x) => typeof x.price === "number")?.price || 0;
    if (!r.in_warranty && r.quote && from !== "declined") {
      c.repair_price = round2(Math.max(0, r.quote.total - c.assessment_fee));
      postLedger(ctx, "repair_income", c.repair_price, r.number);
    }
    c.parts_cost = round2(PARTS_SHARE * (r.quote?.total || listed));
    postLedger(ctx, "repair_parts", -c.parts_cost, r.number);
  }
  if (r.status === "unrepairable" && c.assessment_fee && !c.refunded) {
    c.refunded = c.assessment_fee;
    postLedger(ctx, "refund", -c.refunded, r.number);
  }
}

function findPO(ctx, number) {
  return ctx.st.purchase_orders.find((p) => p.number === number) || fail("not_found", `No purchase order ${number}.`);
}

const poTotal = (po) => round2(po.lines.reduce((n, l) => n + l.qty * l.unit_cost, 0));

/** An out-of-stock SKU shows the date its next delivery is due. */
function markRestock(ctx, sku, date) {
  const s = ctx.st.stock[sku];
  if (s && s.on_hand <= 0 && (!s.restock_date || date < s.restock_date)) s.restock_date = date;
}

/** A shelf count: records it and, when adjusting, moves stock (and its cost) by the difference. Shared by record_stock_count and adjust_stock. */
function countStock(ctx, sku, counted, text, adjustWanted) {
  lookupSku(ctx, sku);
  if (counted < 0) fail("invalid_input", "A count cannot be negative.");
  const s = stockOf(ctx, sku);
  const diff = counted - s.on_hand;
  const adjust = adjustWanted && diff !== 0;
  const count = { id: nextId(ctx, "SC", 4), at: stamp(ctx), sku, system_qty: s.on_hand, counted_qty: counted, difference: diff, adjusted: adjust, note: text };
  ctx.st.stock_counts.push(count);
  if (adjust) moveStock(ctx, sku, diff, "count_adjustment", count.id);
  note(ctx, `stock count ${count.id} ${sku} difference ${diff}`);
  return count;
}

/** The customer paid what a pay-later order owed: cash comes in. Shared by settle_pay_later and advance_day. */
function settlePayLater(ctx, o) {
  const p = o.payment, amount = p.due;
  setField(ctx, `order ${o.number}`, p, "status", "paid");
  setField(ctx, `order ${o.number}`, p, "due", 0);
  p.settled_at = stamp(ctx);
  delete p.overdue;
  postLedger(ctx, "pay_later", amount, o.number);
  historyAdd(ctx, o, `Pay later settled: ${money(amount)} paid`);
  return amount;
}

/** Books in a delivery: got maps sku to units received (default: everything ordered). */
function receiveLines(ctx, po, got = null) {
  for (const l of po.lines) {
    const qty = got ? got[l.sku] ?? 0 : l.qty;
    if (qty > 0) moveStock(ctx, l.sku, qty, "received", po.number);
    l.qty_received = qty;
  }
  setField(ctx, `purchase order ${po.number}`, po, "status", po.lines.every((l) => l.qty_received >= l.qty) ? "received" : "part_received");
  po.received_at = stamp(ctx);
}

/** Refund to the order's original payment, within the caller's limit. Used by issue_refund and approve_large_refund. */
function refundOrder(ctx, i) {
  const limit = ctx.business.roles.support_agent.refund_limit;
  const leadLimit = ctx.business.roles.support_lead.refund_limit ?? Infinity;
  const o = ctx.st.orders.find((x) => x.number === i.order_number) || fail("not_found", `No order ${i.order_number}.`);
  if (!(i.amount > 0)) fail("invalid_input", "The amount must be more than zero.");
  if (o.payment.status === "declined") fail("rule_violation", `Order ${o.number}'s payment was declined, so nothing was paid and there is nothing to refund.`);
  if (ctx.role === "support_agent" && i.amount > limit) fail("rule_violation", `A support agent can refund up to ${money(limit)}. Pass this to the support lead.`);
  if (ctx.role === "support_lead" && i.amount > leadLimit) fail("rule_violation", `The support lead can refund up to ${money(leadLimit)}. The manager approves anything larger.`);
  if (o.payment.refunded + i.amount > o.totals.total + 1e-9) fail("rule_violation", `Only ${money(round2(o.totals.total - o.payment.refunded))} is left to refund on this order.`);
  const back = giveBack(ctx, o, i.amount);
  if (back.due_cancelled) {
    historyAdd(ctx, o, `${money(i.amount)} taken off what is owed: ${i.reason}`);
    return { order_number: o.number, refunded: 0, due_cancelled: i.amount, still_due: back.still_due, message: back.how };
  }
  historyAdd(ctx, o, `Refund ${money(i.amount)}: ${i.reason}`);
  return { order_number: o.number, refunded: i.amount, refund_expected_by: back.refund_expected_by };
}

// ---------------------------------------------------------------- parcels

/** A pending parcel with a note is waiting for stock (the generator's convention): its stock has not been taken yet. */
const waiting = (s) => s.status === "pending" && !!s.note;
/**
 * Parcels arrive late this often, outside event weeks. WHY: UK couriers miss the date on about 3% of parcels.
 * The world generator imports this number (business/builder/world/simulate.mjs), so history and the live engine agree.
 */
export const LATE_RATE = 0.03;
const LATE_NOTE = "Delivered after the estimated date. The carrier missed a depot connection.";
const MTO_NOTE = "Made to order for today's chilled parcels.";

const isChilledParcel = (ctx, s) => s.skus.some((sku) => (deliveryMethodsOf(ctx.world.index.skus[sku] || { item: {}, product: {} }) || []).includes("chilled"));

/** Units of a SKU that parcels waiting for stock still need. WHY: written-off or recounted stock must not starve paid orders. */
function waitingNeed(ctx, sku) {
  let n = 0;
  for (const o of ctx.st.orders) {
    if (o.status === "cancelled") continue;
    for (const s of o.shipments || []) if (waiting(s) && s.skus.includes(sku)) n += o.items.filter((l) => l.sku === sku).reduce((t, l) => t + l.qty, 0);
  }
  return n;
}

/** A waiting parcel takes its stock once every line is on the shelf (and a pre-order's date has come). */
function allocate(ctx, o, s, today) {
  const lines = o.items.filter((l) => s.skus.includes(l.sku));
  for (const l of lines) {
    const e = ctx.world.index.skus[l.sku];
    const from = ctx.st.product_status?.[e?.product.id]?.available_from ?? e?.product.available_from;
    if ((from && from > today) || stockOf(ctx, l.sku).on_hand < l.qty) return false;
  }
  for (const l of lines) moveStock(ctx, l.sku, -l.qty, "sold", o.number);
  delete s.note;
  historyAdd(ctx, o, `Stock arrived for ${s.id}`);
  return true;
}

/** Made-to-order food: today's purchase order from its supplier is received and sold straight out, as simulate.mjs does. */
function makeToOrder(ctx, sku, qty, orderNumber, reason = "sold") {
  const sup = ctx.st.suppliers.find((x) => x.skus.includes(sku));
  if (!sup) return; // a world without suppliers (business/data/seed) does not model made-to-order stock
  const today = dateOf(ms(ctx.now));
  let po = ctx.st.purchase_orders.findLast((p) => p.supplier_id === sup.id && p.due_at === today && p.note === MTO_NOTE);
  if (!po) {
    po = { number: nextId(ctx, "PO"), supplier_id: sup.id, lines: [], ordered_at: `${addDays(today, -1)}T18:00:00Z`, due_at: today, expected_at: null,
      received_at: stamp(ctx), status: "received", paid_at: null, note: MTO_NOTE };
    ctx.st.purchase_orders.push(po);
  }
  let line = po.lines.find((l) => l.sku === sku);
  if (!line) po.lines.push(line = { sku, qty: 0, unit_cost: sup.unit_cost[sku], qty_received: 0 });
  line.qty += qty; line.qty_received += qty;
  moveStock(ctx, sku, qty, "received", po.number);
  moveStock(ctx, sku, -qty, reason, orderNumber);
}

/** Hands a parcel to the carrier: made-to-order lines are made, and the carrier's charge is a cost (money.mjs delivery_cost). */
function dispatchShipment(ctx, o, s) {
  const chilled = isChilledParcel(ctx, s);
  // A free replacement is one unit and is a write-off, not a second sale.
  for (const l of o.items) if (s.skus.includes(l.sku) && isMadeToOrder(ctx.world.index.skus[l.sku])) makeToOrder(ctx, l.sku, s.replacement ? 1 : l.qty, o.number, s.replacement ? "written_off" : "sold");
  const today = dateOf(ms(ctx.now));
  const n = (ctx.st.counters.TRK = (ctx.st.counters.TRK || 900000) + 1);
  Object.assign(s, { status: "in_transit", carrier: CARRIERS[chilled ? "chilled" : "parcel"], tracking: `${chilled ? "CC" : "HP"}${n}GB`, dispatched_at: stamp(ctx),
    eta: chilled ? addDays(today, 1) : addWorkingDays(today, o.delivery.method === "next-day" ? 1 : 3) });
  postLedger(ctx, "delivery_cost", -CARRIER_COST[chilled ? "chilled" : o.delivery.method === "next-day" ? "next-day" : "standard"], o.number);
  historyAdd(ctx, o, `Dispatched (${s.id})`);
}

function deliverShipment(ctx, o, s) {
  if (s.eta && dateOf(ms(ctx.now)) > s.eta) s.note = LATE_NOTE;
  Object.assign(s, { status: "delivered", delivered_at: stamp(ctx) });
  historyAdd(ctx, o, `Delivered (${s.id})`);
}

/** The day a parcel really arrives: its eta, or 3 to 6 working days later for the late share (deterministic per parcel). */
const arrivalDay = (s) => (frac(`${s.id}|late`) < LATE_RATE ? addWorkingDays(s.eta, 3 + Math.floor(frac(`${s.id}|days`) * 4)) : s.eta);

/** Order status from its parcels, as business/builder/world/aftersales.mjs works it out. */
function settleOrderStatus(ctx, o) {
  const live = o.shipments.filter((s) => !["lost", "cancelled"].includes(s.status));
  const status = live.length && live.every((s) => s.status === "delivered") ? "delivered" : live.some((s) => s.dispatched_at) ? "dispatched" : o.status;
  if (status !== o.status) { setField(ctx, `order ${o.number}`, o, "status", status); historyAdd(ctx, o, `Order ${status}`); }
}

// ---------------------------------------------------------------- what advance_day applies

/** A product launched for a later date goes on sale when the date comes. */
function launchesDue(ctx, today, done) {
  for (const [id, life] of Object.entries(ctx.st.product_status || {})) {
    if (life.status === "coming_soon" && life.available_from <= today) { life.status = "active"; note(ctx, `product ${id} on sale`); done.launched.push(id); }
  }
}

/** Days a late supplier delivery slips: 2 to 12, as simulate.mjs. */
const slipDays = (po) => 2 + Math.floor(frac(`${po.number}|days`) * 11);

/**
 * Supplier deliveries. WHY: a supplier misses its date with chance 1 - reliability (simulate.mjs), decided per purchase
 * order from its number, so the same run always gives the same late orders. A late order arrives on its expected date.
 */
function purchaseOrdersDue(ctx, today, done) {
  for (const po of ctx.st.purchase_orders) {
    if (po.status === "late") {
      if (!po.expected_at) po.expected_at = [addDays(po.due_at, slipDays(po)), today].sort()[1];
      if (po.expected_at <= today) { receiveLines(ctx, po); done.deliveries.push(po.number); }
    } else if (po.status === "ordered" && po.due_at <= today) {
      const sup = ctx.st.suppliers.find((x) => x.id === po.supplier_id);
      if (sup && frac(`${po.number}|late`) < 1 - sup.reliability) {
        setField(ctx, `purchase order ${po.number}`, po, "status", "late");
        po.expected_at = addDays(po.due_at, slipDays(po));
        for (const l of po.lines) { const s = ctx.st.stock[l.sku]; if (s && s.on_hand <= 0) s.restock_date = po.expected_at; }
        done.became_late.push(po.number);
      } else { receiveLines(ctx, po); done.deliveries.push(po.number); }
    }
  }
}

/** Can a parcel go today? Working days only; chilled only on its dispatch weekdays. */
function canDispatch(ctx, s, today) {
  const day = new Date(ms(today)).getUTCDay();
  return isChilledParcel(ctx, s) ? ctx.business.delivery.chilled_dispatch_weekdays.includes(day) : day >= 1 && day <= 5;
}

function parcelsDue(ctx, today, done) {
  for (const o of ctx.st.orders) {
    if (o.status === "payment_failed") {
      if (ms(o.placed_at) + ctx.business.orders.payment_failed_hold_hours * HOUR <= ms(ctx.now)) {
        setField(ctx, `order ${o.number}`, o, "status", "cancelled");
        historyAdd(ctx, o, "Cancelled: payment not completed within 24 hours.");
        done.cancelled.push(o.number);
      }
      continue;
    }
    // Delivered orders still move when a replacement parcel is on its way.
    if (o.status === "cancelled" || !(o.shipments || []).some((s) => !["delivered", "lost", "cancelled"].includes(s.status))) continue;
    let moved = false;
    for (const s of o.shipments || []) {
      if (waiting(s)) { if (!allocate(ctx, o, s, today)) continue; done.stock_allocated.push(s.id); }
      if (["pending", "packed"].includes(s.status)) {
        if (canDispatch(ctx, s, today)) { dispatchShipment(ctx, o, s); done.dispatched.push(s.id); moved = true; }
      } else if (["in_transit", "delayed"].includes(s.status) && s.eta) {
        if (arrivalDay(s) <= today) { deliverShipment(ctx, o, s); done.delivered.push(s.id); moved = true; }
        else if (s.status === "in_transit" && s.eta < today) {
          s.status = "delayed";
          historyAdd(ctx, o, `Carrier reports a delay (${s.id})`);
          done.delayed.push(s.id);
        }
      }
    }
    if (moved) settleOrderStatus(ctx, o);
  }
}

/** Pay-later customers who pay after the due date. WHY: an assumption; most pay on time, a few in twenty do not. */
const OVERDUE_RATE = 0.05;

/** On the due date the customer pays (cash comes in), except a small deterministic share, which is flagged overdue for finance. */
function payLaterDue(ctx, today, done) {
  for (const o of ctx.st.orders) {
    const p = o.payment;
    if (!isPayLaterDue(p) || p.due_date > today || p.overdue) continue;
    if (frac(`${o.number}|overdue`) < OVERDUE_RATE) {
      p.overdue = true;
      historyAdd(ctx, o, `Pay later overdue: ${money(p.due)} was due on ${p.due_date}`);
      done.pay_later_overdue.push(o.number);
    } else { settlePayLater(ctx, o); done.pay_later_settled.push(o.number); }
  }
}

/** Supplier bills are paid on their terms after delivery (money.mjs: received + payment_terms_days). */
function supplierPaymentsDue(ctx, done) {
  const terms = Object.fromEntries(ctx.st.suppliers.map((s) => [s.id, s.payment_terms_days]));
  for (const po of ctx.st.purchase_orders) {
    if (!po.received_at || po.paid_at || !["received", "part_received"].includes(po.status)) continue;
    if (ms(po.received_at) + (terms[po.supplier_id] ?? 0) * DAY > ms(ctx.now)) continue;
    postLedger(ctx, "supplier_payment", -po.lines.reduce((n, l) => n + l.qty_received * l.unit_cost, 0), po.number);
    po.paid_at = stamp(ctx);
    done.supplier_payments.push(po.number);
  }
}

/** Day of the month each fixed cost is paid (money.mjs FIXED_DAY). Each is the same as last month's. */
const FIXED_DAY = { rent: 1, software: 3, wages: 28 };

function fixedCostsDue(ctx, today, done) {
  const day = Number(today.slice(8, 10)), month = today.slice(0, 7), L = ctx.st.ledger;
  for (const [type, d] of Object.entries(FIXED_DAY)) {
    if (d !== day) continue;
    const ref = `${type.toUpperCase()}-${month}`;
    let last = null;
    for (let k = L.length - 1; k >= 0 && !last; k--) { if (L[k].reference === ref) { last = "paid"; } else if (L[k].type === type) last = L[k]; }
    if (last && last !== "paid") { postLedger(ctx, type, last.amount, ref); done.fixed_costs.push(ref); }
  }
}

/** Working days to answer a complaint, by stage (business.json complaints: 3, then 10). */
const COMPLAINT_DAYS = { 1: 3, 2: 10 };
const CLOSED_CASE = ["resolved", "closed"];
const complaintDeadline = (c) => addWorkingDays(c.opened_at, COMPLAINT_DAYS[c.complaint_stage] || 3);

/** Unanswered contacts age past the reply target, complaints pass their answer deadline, and refunds for returns that arrived fall late. */
function deadlinesDue(ctx, today, done) {
  const b = ctx.business;
  for (const c of ctx.st.contacts) {
    if (c.first_reply_minutes != null || c.overdue) continue;
    if (addWorkingDays(c.at, b.contact.support_reply_target_working_days) < today) { c.overdue = true; done.contacts_overdue.push(c.id); }
  }
  for (const c of ctx.st.cases) {
    if (!c.is_complaint || CLOSED_CASE.includes(c.status) || c.deadline_missed) continue;
    const by = complaintDeadline(c);
    if (by < today) { c.deadline_missed = by; c.notes.push({ at: stamp(ctx), by: "system", text: `Answer deadline ${by} missed.` }); done.complaints_past_deadline.push(c.number); }
  }
  for (const r of ctx.st.returns) {
    if (r.status !== "received") continue;
    // WHY: the refund is due within the business's working days of the parcel arriving; the first day we see it counts as arrival.
    r.refund_due_by ||= addWorkingDays(today, b.payments.refund_time_working_days);
    if (r.refund_due_by < today && !r.refund_late) { r.refund_late = true; done.refunds_late.push(r.number); }
  }
}

// ---------------------------------------------------------------- the monthly summary, worked out from the ledger

/** Orders per month (not declined), each customer's first month, and new customers per month. */
function orderMonths(orders) {
  const placedBy = new Map(), firstOrder = {}, newBy = {};
  for (const o of orders) {
    if (o.payment.status === "declined") continue;
    const m = o.placed_at.slice(0, 7);
    (placedBy.get(m) || placedBy.set(m, []).get(m)).push(o);
    if (!firstOrder[o.customer_id] || m < firstOrder[o.customer_id]) firstOrder[o.customer_id] = m;
  }
  for (const m of Object.values(firstOrder)) newBy[m] = (newBy[m] || 0) + 1;
  return { placedBy, firstOrder, newBy };
}

/** One month's row, by the generator's formula (money.mjs monthlySummary), plus repair income and corrections. */
function monthRow(month, es, placed, om, cashBefore) {
  const sum = (type) => round2(es.filter((e) => e.type === type).reduce((n, e) => n + e.amount, 0));
  const sales = sum("sale"), deliveryIncome = sum("delivery_income"), repairIncome = sum("repair_income");
  const revenue = round2(sales + deliveryIncome + repairIncome), refunds = round2(-sum("refund")), cogs = round2(-sum("cost_of_goods") - sum("repair_parts"));
  const operating = Object.fromEntries(OPEX.map((t) => [t, round2(-sum(t))]));
  const opTotal = round2(Object.values(operating).reduce((n, x) => n + x, 0));
  const gross = round2(revenue - refunds - cogs);
  const cash = round2(cashBefore + es.filter((e) => !NOT_CASH.includes(e.type)).reduce((n, e) => n + e.amount, 0));
  const seen = new Set();
  let repeat = 0;
  for (const o of placed) {
    const first = om.firstOrder[o.customer_id];
    if (first < month || (first === month && seen.has(o.customer_id))) repeat++; else seen.add(o.customer_id);
  }
  return {
    month, revenue, sales, delivery_income: deliveryIncome, repair_income: repairIncome, refunds, cost_of_goods: cogs, gross_margin: gross, operating_costs: operating,
    operating_costs_total: opTotal, profit: round2(gross - opTotal), orders: placed.length, new_customers: om.newBy[month] || 0,
    repeat_rate: placed.length ? round2(repeat / placed.length) : 0,
    average_order_value: placed.length ? round2(placed.reduce((n, o) => n + o.totals.total, 0) / placed.length) : 0,
    supplier_payments: round2(-sum("supplier_payment")), corrections: sum("correction"), cash_at_month_end: cash,
  };
}

/** Summary rows for every month from `from` on, built from the ledger ("" = all). The ledger is in time order. */
function summaryRows(st, from, cashBefore) {
  const byMonth = new Map();
  for (let k = st.ledger.length - 1; k >= 0 && st.ledger[k].month >= from; k--) {
    const e = st.ledger[k];
    (byMonth.get(e.month) || byMonth.set(e.month, []).get(e.month)).unshift(e);
  }
  const om = orderMonths(st.orders);
  let cash = cashBefore;
  return [...byMonth.keys()].sort().map((m) => { const row = monthRow(m, byMonth.get(m), om.placedBy.get(m) || [], om, cash); cash = row.cash_at_month_end; return row; });
}

/** Works out the summary again from `from` on. WHY: the figures finance reads must include everything done at run time. */
function refreshSummary(st, from) {
  const kept = st.monthly_summary.filter((r) => r.month < from);
  const cash = kept.length ? kept.at(-1).cash_at_month_end : st.company?.opening_cash ?? 0;
  st.monthly_summary = [...kept, ...summaryRows(st, from, cash)];
}

// ---------------------------------------------------------------- check_books: business/builder/validate.mjs's money and stock rules on the live state

function checkBooks(ctx) {
  const st = ctx.st, idx = ctx.world.index, breaks = [], planted = [];
  const bad = (m) => breaks.push(m);
  const by = (list, key) => new Map(list.map((x) => [x[key], x]));
  const oBy = by(st.orders, "number"), retBy = by(st.returns, "number"), poBy = by(st.purchase_orders, "number"), countBy = by(st.stock_counts, "id");
  const caseBy = by(st.cases, "number"), repBy = by(st.repairs, "number"), custBy = by(st.customers, "id");
  const onOrder = (o, sku) => o?.items.some((i) => i.sku === sku || (i.swapped_from || []).includes(sku));
  const isMTO = (sku) => !!idx.skus[sku] && isMadeToOrder(idx.skus[sku]);

  // Stock: every movement points at a real record, no shelf goes below zero, on hand equals the sum of movements.
  const refOk = (m) => {
    if (m.reason === "received" || (m.reason === "written_off" && poBy.has(m.reference))) return !!poBy.get(m.reference)?.lines.some((l) => l.sku === m.sku);
    if (m.reason === "written_off" && idx.byId[m.reference]) return idx.skus[m.sku]?.product.id === m.reference;
    if (m.reason === "count_adjustment") return countBy.get(m.reference)?.sku === m.sku;
    if (m.reason === "returned_to_stock") return !!retBy.get(m.reference)?.items.some((i) => i.sku === m.sku) || onOrder(oBy.get(m.reference), m.sku);
    return onOrder(oBy.get(m.reference), m.sku);
  };
  const balance = {}, soldBy = {};
  let prev = "";
  for (const m of st.stock_movements) {
    if (m.at < prev) bad(`${m.id}: movements out of time order`);
    prev = m.at;
    if (!refOk(m)) bad(`${m.id}: reference ${m.reference} does not match ${m.reason} of ${m.sku}`);
    balance[m.sku] = (balance[m.sku] || 0) + m.qty;
    if (balance[m.sku] < 0) bad(`${m.id}: ${m.sku} stock below zero`);
    if (m.reason === "sold" || m.reason === "released") soldBy[m.reference + "|" + m.sku] = (soldBy[m.reference + "|" + m.sku] || 0) - m.qty;
  }
  for (const [k, v] of Object.entries(st.stock)) if ((balance[k] || 0) !== v.on_hand) bad(`stock ${k}: on hand ${v.on_hand} but movements sum to ${balance[k] || 0}`);
  for (const c of st.stock_counts) {
    if (c.counted_qty - c.system_qty !== c.difference) bad(`${c.id}: difference does not add up`);
    if (c.difference !== 0 && !c.adjusted) planted.push(`${c.id}: count of ${c.sku} found ${c.difference} and was not adjusted`);
  }

  // Orders: sale, delivery income and fee in the ledger; stock moved for what was sent; refunds within what was paid.
  const ledgerBy = {};
  for (const e of st.ledger) (ledgerBy[e.reference] ||= []).push(e);
  const sumType = (ref, type) => round2((ledgerBy[ref] || []).filter((e) => e.type === type).reduce((n, e) => n + e.amount, 0));
  const retsByOrder = {};
  for (const r of st.returns) (retsByOrder[r.order_number] ||= []).push(r);
  for (const o of st.orders) {
    if (o.payment.status === "declined") { if (ledgerBy[o.number]) bad(`${o.number}: declined but in the ledger`); continue; }
    if (sumType(o.number, "sale") !== round2(o.totals.items - o.totals.discount)) bad(`${o.number}: ledger sale ${sumType(o.number, "sale")} != ${round2(o.totals.items - o.totals.discount)}`);
    if (sumType(o.number, "delivery_income") !== o.totals.delivery) bad(`${o.number}: ledger delivery income ${sumType(o.number, "delivery_income")} != ${o.totals.delivery}`);
    if (!(sumType(o.number, "payment_fee") < 0)) bad(`${o.number}: no payment fee`);
    if (o.payment.due_date && sumType(o.number, "pay_later") !== round2(-(o.payment.due || 0))) bad(`${o.number}: pay later in the ledger ${sumType(o.number, "pay_later")} != owed ${o.payment.due || 0}`);
    const want = {};
    for (const i of o.items) {
      const ship = o.shipments.find((s) => s.skus.includes(i.sku));
      const notYet = (ship && waiting(ship)) || (isMTO(i.sku) && !ship?.dispatched_at);
      want[i.sku] = (want[i.sku] || 0) + (o.status === "cancelled" || notYet ? 0 : i.qty);
    }
    for (const [k, expect] of Object.entries(want)) if ((soldBy[o.number + "|" + k] || 0) !== expect) bad(`${o.number}: ${k} stock moved ${soldBy[o.number + "|" + k] || 0}, expected ${expect}`);
    const rets = retsByOrder[o.number] || [];
    const refunded = round2(-[o.number, ...rets.map((r) => r.number)].reduce((n, ref) => n + sumType(ref, "refund"), 0));
    let doubles = 0;
    for (const r of rets) {
      const over = round2(-sumType(r.number, "refund") - r.refund_amount);
      if (over > 0.001) { planted.push(`${r.number}: refunded ${round2(-sumType(r.number, "refund"))} in the ledger for a ${r.refund_amount} return (refunded twice) on ${o.number}`); doubles += over; }
    }
    // A return refunded twice is reported above (it is planted); everything else must stay within what was paid.
    if (round2(refunded - doubles) > o.totals.total + 0.001) bad(`${o.number}: ledger refunds ${refunded} exceed what was paid ${o.totals.total}`);
    if (Math.abs(round2(refunded - doubles) - o.payment.refunded) > 0.001) bad(`${o.number}: ledger refunds ${refunded} != order refunded ${o.payment.refunded}`);
  }

  // Every ledger entry points at a real record and sits in its own month.
  const campaigns = new Set(st.campaigns.map((c) => c.id));
  const known = (r) => oBy.has(r) || retBy.has(r) || poBy.has(r) || caseBy.has(r) || campaigns.has(r) || countBy.has(r) || repBy.has(r) || custBy.has(r) || !!idx.byId[r] || /^(WAGES|RENT|SOFTWARE)-\d{4}-\d{2}$/.test(r);
  for (const e of st.ledger) {
    if (e.month !== e.at.slice(0, 7)) bad(`${e.id}: month field`);
    if (e.type !== "correction" && !known(e.reference)) bad(`${e.id}: reference ${e.reference} not found`);
  }

  // Each month's summary equals the ledger, worked out afresh.
  const fresh = summaryRows(st, "", st.company?.opening_cash ?? 0);
  const rowBy = by(st.monthly_summary, "month");
  for (const f of fresh) {
    const s = rowBy.get(f.month);
    if (!s) { bad(`${f.month}: ledger has a month with no summary`); continue; }
    for (const k of ["revenue", "refunds", "cost_of_goods", "orders"]) if (Math.abs(s[k] - f[k]) > 0.001) bad(`${f.month}: summary ${k} ${s[k]} != ledger ${f[k]}`);
    for (const t of OPEX) if (Math.abs(s.operating_costs[t] - f.operating_costs[t]) > 0.001) bad(`${f.month}: summary ${t}`);
    if (Math.abs(s.profit - f.profit) > 0.011) bad(`${f.month}: summary profit ${s.profit} != ledger ${f.profit}`);
    if (Math.abs(s.cash_at_month_end - f.cash_at_month_end) > 0.011) bad(`${f.month}: cash ${s.cash_at_month_end} != ledger ${f.cash_at_month_end}`);
  }
  return { ok: breaks.length === 0, breaks: breaks.slice(0, 200), break_count: breaks.length, planted,
    checked: { skus: Object.keys(st.stock).length, movements: st.stock_movements.length, orders: st.orders.length, ledger_entries: st.ledger.length, months: fresh.length } };
}

// ---------------------------------------------------------------- business_snapshot

/** Why money went back, from what the refund entry refers to. */
function refundReason(st, ref, retBy, oBy) {
  if (retBy.has(ref)) return `return_${retBy.get(ref).reason}`;
  if (oBy.has(ref)) return oBy.get(ref).status === "cancelled" ? "cancelled_order" : "order_refund";
  if (/^FIX-/.test(ref)) return "repair_fee";
  return "other";
}

function snapshot(ctx) {
  const st = ctx.st, today = dateOf(ms(ctx.now)), month = today.slice(0, 7);
  const pick = (r) => ({ revenue: r.revenue, refunds: r.refunds, gross_margin: r.gross_margin, profit: r.profit, orders: r.orders });
  const zero = { revenue: 0, refunds: 0, gross_margin: 0, profit: 0, orders: 0 };
  const since = { ...zero };
  for (const r of st.monthly_summary) for (const k of Object.keys(since)) since[k] = round2(since[k] + r[k]);
  const cur = st.monthly_summary.find((r) => r.month === month);
  const shelf = (sku) => { const e = ctx.world.index.skus[sku]; return e && !isMadeToOrder(e) && statusOf(ctx, e.product) !== "discontinued"; };
  const out = Object.keys(st.stock).filter((k) => st.stock[k].on_hand <= 0 && shelf(k)).sort();
  const parcels = st.orders.flatMap((o) => (o.status === "cancelled" ? [] : o.shipments || []));
  const replies = st.contacts.map((c) => c.first_reply_minutes).filter((x) => typeof x === "number");
  const retBy = new Map(st.returns.map((r) => [r.number, r])), oBy = new Map(st.orders.map((o) => [o.number, o]));
  const byReason = {};
  for (const e of st.ledger) if (e.type === "refund") { const k = refundReason(st, e.reference, retBy, oBy); byReason[k] = round2((byReason[k] || 0) - e.amount); }
  const refused = { total: 0, by_role: {} };
  for (const a of st.audit) if (a.error_code === "forbidden") { refused.total++; refused.by_role[a.role] = (refused.by_role[a.role] || 0) + 1; }
  const owed = st.orders.filter((o) => isPayLaterDue(o.payment));
  return {
    as_of: stamp(ctx), month, this_month: cur ? pick(cur) : zero, since_start: since,
    cash: st.monthly_summary.at(-1)?.cash_at_month_end ?? st.company?.opening_cash ?? 0,
    stock_value: round2(Object.entries(st.stock).reduce((n, [k, v]) => n + Math.max(0, v.on_hand) * unitCost(ctx, k), 0)),
    stockouts: { count: out.length, skus: out },
    late_parcels: parcels.filter((s) => s.status === "delayed" || (s.status === "in_transit" && s.eta && s.eta < today)).length,
    open_cases: st.cases.filter((c) => !CLOSED_CASE.includes(c.status)).length,
    complaints_past_deadline: st.cases.filter((c) => c.is_complaint && !CLOSED_CASE.includes(c.status) && complaintDeadline(c) < today).length,
    average_first_reply_minutes: replies.length ? round2(replies.reduce((n, x) => n + x, 0) / replies.length) : null,
    unanswered_contacts: st.contacts.length - replies.length,
    refunds_by_reason: byReason,
    pay_later: { owed: round2(owed.reduce((n, o) => n + o.payment.due, 0)), orders: owed.length, overdue: owed.filter((o) => o.payment.overdue).length },
    refused_actions: refused,
  };
}

// ---------------------------------------------------------------- extensions

/** Id counters added by extensions: [prefix, state key, id field]. */
const EXTRA_COUNTERS = [];
/** Extra stores search_knowledge reads: functions (ctx, words, score) returning results in its shape. */
const KNOWLEDGE_SOURCES = [];

/**
 * Add record types and tools from another module (infrastructure/engine/comms.js, infrastructure/engine/events.js).
 * Call it at import time, before any createWorld, so every world has the same tools.
 * - state: names of extra collections kept in world.state (each loads from <world folder>/<name>.json, or starts empty).
 * - counters: [prefix, state key, id field] so nextId(ctx, prefix) carries on from the highest id already there.
 * - tools: same shape as the built-in ones: { name, roles, description, input_schema, run(ctx, input) }.
 * - replace: tools of that shape that take the place of a core tool with the same name.
 * - knowledge: functions (ctx, words, score) that add results to search_knowledge.
 * WHY: the core stays one file about commerce; mail, chat, social and news each live in their own file.
 */
export function extend({ state = [], counters = [], tools = [], knowledge = [], replace = [] } = {}) {
  for (const k of knowledge) if (!KNOWLEDGE_SOURCES.includes(k)) KNOWLEDGE_SOURCES.push(k);
  // WHY replace: an extension may deepen a core tool (infrastructure/engine/knowledge.js adds permissions and more documents to
  // search_documents), keeping its name, so the core still works alone and the full engine gets the deeper one.
  for (const tool of replace) {
    const at = TOOLS.findIndex((t) => t.name === tool.name);
    if (at < 0) throw new Error(`There is no tool called "${tool.name}" to replace.`);
    TOOLS[at] = tool;
  }
  for (const key of state) if (!BACK_OFFICE.includes(key)) BACK_OFFICE.push(key);
  for (const c of counters) if (!EXTRA_COUNTERS.some((x) => x[0] === c[0])) EXTRA_COUNTERS.push(c);
  for (const tool of tools) {
    if (TOOLS.some((t) => t.name === tool.name)) throw new Error(`A tool called "${tool.name}" already exists.`);
    TOOLS.push(tool);
  }
}

/** The helpers extension tools need, so they follow the same rules as the built-in ones. */
export const kit = {
  fail, clone, round2, nextId, stamp, ms, isoOf, dateOf, addDays, tokens, matches,
  schema: { str, num, bool, strs, obj },
  roles: { ALL: ALL_ROLES, STAFF, INTERNAL, CUSTOMER_ROLES, MONEY_READERS, MARKETING_READERS, STOCK_READERS, LENSES },
};
