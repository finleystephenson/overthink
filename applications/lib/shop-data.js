// The shop's reads, shared by Till and Stockroom (moved here from till/data.js). Every figure on the screen comes from an engine tool through world.call(..., { screen: true }),
// so whatever a person or an outside AI does shows up on the next read. Nothing here is stored in the page
// except a cache of answers, which is thrown away whenever the world changes.

/** Order statuses that will not move again on their own (a return can still refund one, so we re-read when opened). */
export const SETTLED = new Set(["delivered", "cancelled"]);

/**
 * Runs fn over items, a few at a time, so a screen asking for eighty orders does not open eighty requests at once.
 * @template T, R
 * @param {Array<T>} items
 * @param {number} limit
 * @param {function(T, number): Promise<R>} fn
 * @return {Promise<Array<R>>}
 */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const k = next++;
      out[k] = await fn(items[k], k);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** A date (YYYY-MM-DD) moved by n days. */
export function addDays(date, n) {
  const t = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** The picture for a product record: the branded render, which lives under /img/branded/ with the same name. */
function pictureOf(file, id) {
  const name = file ? String(file).split("/").pop() : `${id}.jpg`;
  return `/img/branded/${name}`;
}

/** The product record trimmed to what Till draws, with a picture for every variant that has its own. */
function shapeProduct(d) {
  const vi = d.variant_images;
  const variants = (d.variants || []).map((v) => ({
    ...v,
    picture: vi && v.options?.[vi.option] && vi.images?.[v.options[vi.option]] ? `/${vi.images[v.options[vi.option]]}` : pictureOf(d.image?.file, d.id),
  }));
  const accessories = (d.accessories || []).map((a) => ({ ...a, picture: a.image ? `/${a.image}` : "" , accessory: true }));
  const methods = d.delivery?.methods || [];
  return {
    id: d.id, name: d.name, tagline: d.tagline || "", summary: d.summary || "", category: d.category || "",
    status: d.status, available_from: d.available_from || null, discontinued_at: d.discontinued_at || null,
    picture: pictureOf(d.image?.file, d.id), sweep: d.image?.sweep || "#ece6da",
    variants, accessories,
    // WHY: chilled things are made for each order, so an empty shelf is normal for them, not a stockout.
    madeToOrder: methods.length > 0 && methods.every((m) => m === "chilled"),
    warranty: d.warranty, delivery: d.delivery,
  };
}

/**
 * Everything Till knows about the world, read live.
 * @param {object} world the shared client
 */
export function createData(world) {
  const D = {
    tools: new Set(),
    products: [],
    sku: new Map(),        // sku -> { product, item }
    orders: new Map(),     // order number -> get_order answer
    customers: new Map(),  // customer id -> get_customer answer
    index: [],             // [{ number, at }] newest first, the orders in the window
    source: "ledger",      // how orders are found: through the ledger, where every paid order has a sale
    priceChanges: [],      // { sku, old_price, new_price, date, reason, at }
    windowDays: 7,
    now: null,

    read(tool, input = {}) {
      return world.call(tool, input, { screen: true });
    },

    can(tool) {
      return D.tools.has(tool);
    },

    /**
     * Which tools the business has. Nobody is "at the computer": the client calls each tool as a job allowed to
     * use it, so the screen only needs to know a tool exists.
     */
    async loadTools() {
      const list = await world.tools().catch(() => []);
      D.tools = new Set(list.map((t) => t.name));
      D.source = "ledger";
    },

    /**
     * Every price change in the shop's history, newest first, from price_history: the ones from before the run
     * and every change made since (here or by an outside AI). WHY this and not the activity record: it is one
     * call, it includes history, and it is what the business itself keeps.
     */
    async loadPriceChanges() {
      const r = await D.read("price_history", {});
      if (r.ok) D.priceChanges = r.data.changes;
      return r;
    },

    /** Picks price changes out of new activity, so a change shows before the next read. */
    noteActivity(entries) {
      for (const e of entries || []) {
        if (e.tool !== "change_price" || !e.ok || !e.result) continue;
        const c = e.result;
        if (!D.priceChanges.some((x) => x.sku === c.sku && x.date === c.date && x.new_price === c.new_price)) D.priceChanges.unshift({ ...c });
      }
    },

    /** Every change to one product's own prices (its versions, not what goes with it), newest first. */
    changesTo(p) {
      const skus = new Set(p.variants.map((v) => v.sku));
      return D.priceChanges.filter((c) => skus.has(c.sku));
    },

    /** The latest price change to the product itself, or null. */
    lastChange(p) {
      return D.changesTo(p)[0] || null;
    },

    /**
     * One page of every order in the shop (list_all_orders): newest first, with customer names, totals and a short
     * item list. Includes declined payments, which the ledger never sees.
     * @param {{status?: string, search?: string, offset?: number, limit?: number}} q
     */
    allOrders(q = {}) {
      return D.read("list_all_orders", { limit: 50, ...q });
    },

    /**
     * Things sold per day for a product, from the stock movements of each of its versions (newest 200 each).
     * @return {Promise<Map<string, number>>} date -> units
     */
    async unitsByDay(p) {
      const got = await pool(p.variants, 4, (v) => D.read("stock_history", { sku: v.sku }));
      const by = new Map();
      for (const g of got) for (const m of (g.ok ? g.data.movements : [])) {
        if (m.reason !== "sold") continue;
        const d = m.at.slice(0, 10);
        by.set(d, (by.get(d) || 0) - m.qty);
      }
      return by;
    },

    /** Every product with live prices and stock (search_catalogue to find them, get_product for each). */
    async loadCatalogue() {
      // WHY "ot": every SKU starts with OT-, and the search needs at least one word, so this finds the whole range.
      const r = await D.read("search_catalogue", { query: "ot" });
      if (!r.ok) return r;
      const ids = [...new Set(r.data.results.filter((x) => x.kind === "product").map((x) => x.id))];
      const got = await pool(ids, 6, (id) => D.read("get_product", { id }));
      D.products = got.filter((g) => g.ok).map((g) => shapeProduct(g.data));
      D.sku.clear();
      for (const p of D.products) for (const item of [...p.variants, ...p.accessories]) D.sku.set(item.sku, { product: p, item });
      return { ok: true };
    },

    /** One product again, after a price change or a launch, so the screen can show the new truth at once. */
    async reloadProduct(id) {
      const r = await D.read("get_product", { id });
      if (!r.ok) return r;
      const p = shapeProduct(r.data);
      const i = D.products.findIndex((x) => x.id === id);
      if (i >= 0) D.products[i] = p; else D.products.push(p);
      for (const item of [...p.variants, ...p.accessories]) D.sku.set(item.sku, { product: p, item });
      return { ok: true, product: p };
    },

    /**
     * Ledger entries of one type between two dates. The tool returns at most 200 entries but always the full count,
     * so a busy window is split in half until each half fits.
     */
    async ledger(type, from, to) {
      const r = await D.read("ledger_search", { type, from, to });
      if (!r.ok) return r;
      if (r.data.count <= r.data.entries.length || from >= to) return { ok: true, entries: r.data.entries };
      const span = Math.round((Date.parse(to) - Date.parse(from)) / 864e5);
      const mid = addDays(from, Math.floor(span / 2));
      const [a, b] = await Promise.all([D.ledger(type, from, mid), D.ledger(type, addDays(mid, 1), to)]);
      if (!a.ok) return a;
      if (!b.ok) return b;
      return { ok: true, entries: [...a.entries, ...b.entries] };
    },

    /**
     * Sales per day for the last n days, from the ledger's sale entries. A "day" is the 24 hours up to the same
     * time as now, because the simulated clock stops at the same hour each day: a calendar day would end every
     * chart on a half-empty morning.
     */
    async salesByDay(n = 30) {
      const end = Date.parse(D.now);
      const start = end - n * 864e5;
      const from = new Date(start).toISOString().slice(0, 10), to = D.now.slice(0, 10);
      // WHY both: "taken" means what customers paid, which is the things plus their delivery, as the day card counts it.
      const [r, del] = await Promise.all([D.ledger("sale", from, to), D.ledger("delivery_income", from, to)]);
      if (!r.ok) return r;
      if (del.ok) r.entries = [...r.entries, ...del.entries];
      const days = Array.from({ length: n }, (_, i) => ({ date: new Date(start + i * 864e5 + 1).toISOString().slice(0, 10), money: 0, orders: new Set() }));
      for (const e of r.entries) {
        const t = Date.parse(e.at);
        if (t <= start || t > end) continue;
        const d = days[Math.min(n - 1, Math.floor((t - start - 1) / 864e5))];
        d.money += e.amount;
        if (e.type === "sale") d.orders.add(e.reference);
      }
      return { ok: true, days: days.map((d) => ({ date: d.date, money: Math.round(d.money * 100) / 100, orders: d.orders.size })), entries: r.entries };
    },

    /**
     * The orders in the window, newest first. The manager finds them through the ledger (every paid order has a sale);
     * the support desk through the customers who have been in touch. Other roles have no way to list orders.
     */
    async loadIndex() {
      if (D.source === "ledger") {
        const today = D.now.slice(0, 10);
        const r = await D.ledger("sale", addDays(today, -(D.windowDays - 1)), today);
        if (!r.ok) return r;
        const seen = new Map();
        for (const e of r.entries) if (!seen.has(e.reference) && /^ORD-/.test(e.reference)) seen.set(e.reference, { number: e.reference, at: e.at });
        D.index = [...seen.values()].sort((a, b) => b.at.localeCompare(a.at) || b.number.localeCompare(a.number));
        return { ok: true };
      }
      if (D.source === "contacts") {
        const r = await D.read("list_contacts", {});
        if (!r.ok) return r;
        const ids = [...new Set(r.data.contacts.map((c) => c.customer_id).filter(Boolean))].slice(0, 30);
        const lists = await pool(ids, 6, (id) => D.read("list_orders", { customer_id: id }));
        const seen = new Map();
        for (const l of lists) for (const o of (l.ok ? l.data.orders : [])) seen.set(o.number, { number: o.number, at: o.placed_at });
        D.index = [...seen.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 120);
        return { ok: true };
      }
      D.index = [];
      return { ok: false, error: { code: "forbidden", message: "No order list for this role." } };
    },

    /** Full records for the orders in the window. Settled ones are kept; anything still moving is read again. */
    async loadOrders({ fresh = false } = {}) {
      const want = D.index.filter((x) => fresh || !D.orders.has(x.number) || !SETTLED.has(D.orders.get(x.number).status));
      await pool(want, 8, async (x) => {
        const r = await D.read("get_order", { order_number: x.number });
        if (r.ok) D.orders.set(x.number, r.data);
      });
      return D.index.map((x) => D.orders.get(x.number)).filter(Boolean);
    },

    /** One order, always read fresh (it is about to be shown or acted on). */
    async order(number) {
      const r = await D.read("get_order", { order_number: number });
      if (r.ok) D.orders.set(number, r.data);
      return r;
    },

    /** A customer's name and details, read once per customer. */
    async customer(id) {
      if (!D.customers.has(id)) D.customers.set(id, D.read("get_customer", { customer_id: id }));
      return D.customers.get(id);
    },
  };
  return D;
}
