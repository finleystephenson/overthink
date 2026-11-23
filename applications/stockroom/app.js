// Stockroom: the shelves, what moved, the counts, the suppliers and the purchase orders.
// Every number is read live (stock_history per SKU, list_suppliers, list_purchase_orders) and every button is a
// real tool (record_stock_count, create_purchase_order, approve_purchase_order, receive_purchase_order).
//
// Address bar: #shelves, #shelves/OT-SOCK, #moves, #counts, #suppliers, #orders.
import { startApp, esc, money, money2, num, plural, timeParts, daysBetween, words, emptyState, skeleton, slideOver, toast } from "../lib/ui.js";
import { isScreenRead } from "../lib/client.js";
import { plainRef } from "../lib/plain.js";
import { recordChip, wireRecordChips } from "../lib/records.js";
import { pool, addDays } from "../lib/shop-data.js";
import { lineArea } from "../lib/chart.js";

// The id of this app in applications/apps.json. Its name, colour and icon all come from there.
const APP_ID = "stockroom";

const { world, app } = await startApp({ id: APP_ID });
document.title = `${app.name} · Overthought & Co.`;
const main = document.getElementById("main");

const S = {
  view: "shelves",
  filter: "all",
  now: null,
  tools: new Set(),
  products: [],
  items: [],          // one per SKU: { sku, name, product, picture, onHand, restock, sold28, cover, state, history }
  suppliers: [],
  pos: [],            // purchase orders still open plus the most recent closed ones
  reliability: null,  // supplier id -> { due, onTime, late }
  loading: null,
  again: false,
  panel: null,
};

const ICONS = {
  shelves: '<path d="M3.5 4v16M20.5 4v16M3.5 9h17M3.5 15h17"/><rect x="6" y="5.5" width="4" height="3.5" rx=".8"/><rect x="12" y="11" width="5" height="4" rx=".8"/><rect x="6.5" y="16.5" width="3.5" height="3.5" rx=".8"/>',
  moves: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
  counts: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4V2.8h6V4M8.5 10l2 2 4-4M8.5 16h7"/>',
  suppliers: '<path d="M3 20V9l5 3V9l5 3V6l8-2v16Z"/><path d="M7 16h2M12 16h2M17 16h1"/>',
  orders: '<path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2Z"/><path d="M9 8.5h6M9 12h6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};

function ico(name, size = 18) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

const VIEWS = [
  { id: "shelves", label: "Shelves" },
  { id: "moves", label: "Movements" },
  { id: "counts", label: "Counts" },
  { id: "suppliers", label: "Suppliers" },
  { id: "orders", label: "Purchase orders" },
];

const REASON = { sold: "Sold", received: "Delivered by the supplier", released: "Back from a cancelled order", returned_to_stock: "Returned and back on the shelf", written_off: "Written off", count_adjustment: "Put right after a count" };

const PO_STATUS = { draft: ["Draft", "neutral"], awaiting_approval: ["Waiting for approval", "warn"], ordered: ["Ordered", "info"], late: ["Late", "bad"], part_received: ["Part arrived", "warn"], received: ["Arrived", "good"], cancelled: ["Cancelled", "neutral"] };

/** A purchase order's state in words. Only a late one is coloured: it is the one to chase. */
function poState(s) {
  const [t, tone] = PO_STATUS[s] || [words(s), "neutral"];
  return tone === "bad" ? `<span class="pill bad">${esc(t)}</span>` : `<span class="sr-state">${esc(t)}</span>`;
}

function read(tool, input = {}) {
  return world.call(tool, input, { screen: true });
}

function can(tool) {
  return S.tools.has(tool);
}

function dayLabel(date, long = false) {
  const p = timeParts(`${date.slice(0, 10)}T12:00:00Z`);
  return long ? `${p.weekday} ${p.day} ${p.month}` : `${p.day} ${p.monthShort}`;
}

function when(iso) {
  if (!iso) return "";
  if (iso.slice(0, 10) === S.now.slice(0, 10)) return iso.slice(11, 16);
  const d = daysBetween(iso, S.now);
  const p = timeParts(iso);
  if (d > 0 && d < 7) return `${p.weekday.slice(0, 3)} ${p.time}`;
  return `${p.day} ${p.monthShort}${p.year !== timeParts(S.now).year ? ` ${p.year}` : ""}`;
}

function supplierOf(sku) {
  return S.suppliers.find((s) => (s.skus || []).includes(sku)) || null;
}

function itemOf(sku) {
  return S.items.find((x) => x.sku === sku) || null;
}

function thumb(sku, size = 40) {
  const it = itemOf(sku);
  if (!it) return `<span class="thumb" style="--s:${size}px"></span>`;
  return `<span class="thumb" style="--s:${size}px;--sweep:${esc(it.product.sweep)}"><img src="${esc(it.picture)}" alt="" loading="lazy"></span>`;
}

function poTotal(po) {
  return po.lines.reduce((n, l) => n + l.qty * (l.unit_cost || 0), 0);
}

// ------------------------------------------------------------------ reading the world

function pictureFor(p, v) {
  const vi = p.variant_images;
  if (vi && v.options?.[vi.option] && vi.images?.[v.options[vi.option]]) return `/${vi.images[v.options[vi.option]]}`;
  if (v.image) return `/${v.image}`;
  const file = p.image?.file ? String(p.image.file).split("/").pop() : `${p.id}.jpg`;
  return `/img/branded/${file}`;
}

/** The whole stockroom: products (for names and pictures), every SKU's history, suppliers and purchase orders. */
async function load() {
  if (S.loading) { S.again = true; return S.loading; }
  S.loading = (async () => {
    const clock = await world.clock().catch(() => null);
    if (clock?.now) S.now = clock.now;
    const sup = await read("list_suppliers");
    S.suppliers = sup.ok ? sup.data.suppliers : [];
    const cat = await read("search_catalogue", { query: "ot" });
    const ids = cat.ok ? [...new Set(cat.data.results.filter((x) => x.kind === "product").map((x) => x.id))] : [];
    const prods = (await pool(ids, 6, (id) => read("get_product", { id }))).filter((r) => r.ok).map((r) => r.data);
    S.products = prods.map((p) => ({ id: p.id, name: p.name, status: p.status, sweep: p.image?.sweep || "#ece6da", picture: pictureFor(p, {}),
      madeToOrder: (p.delivery?.methods || []).length > 0 && p.delivery.methods.every((m) => m === "chilled") }));
    const skus = prods.flatMap((p) => [...(p.variants || []).map((v) => ({ p, v, acc: false })), ...(p.accessories || []).map((v) => ({ p, v, acc: true }))]);
    const since = addDays(S.now.slice(0, 10), -27);
    const hist = await pool(skus, 8, ({ v }) => read("stock_history", { sku: v.sku }));
    S.items = skus.map(({ p, v, acc }, i) => {
      const h = hist[i].ok ? hist[i].data : null;
      const product = S.products.find((x) => x.id === p.id);
      const sold28 = h ? -h.movements.filter((m) => m.reason === "sold" && m.at.slice(0, 10) >= since).reduce((n, m) => n + m.qty, 0) : 0;
      const onHand = h ? h.on_hand : v.stock ?? 0;
      const rate = sold28 / 28;
      const lead = supplierOf(v.sku)?.lead_time_days ?? 7;
      const cover = rate > 0 ? onHand / rate : onHand > 0 ? Infinity : 0;
      const state = product.madeToOrder ? "made" : onHand <= 0 ? "out" : cover < Math.max(7, lead + 2) ? "low" : "fine";
      return { sku: v.sku, name: v.name, accessory: acc, product, picture: pictureFor(p, v), onHand, restock: h?.restock_date || null, sold28, rate, cover, lead, state, history: h };
    });
    const statuses = ["draft", "awaiting_approval", "ordered", "late", "part_received"];
    const [open, recent] = await Promise.all([
      Promise.all(statuses.map((st) => read("list_purchase_orders", { status: st }))),
      read("list_purchase_orders", { status: "received" }),
    ]);
    S.pos = [...open.flatMap((r) => (r.ok ? r.data.purchase_orders : [])), ...(recent.ok ? recent.data.purchase_orders.slice(0, 12) : [])];
    S.reliability = null;  // read again when the suppliers view asks
  })();
  try { await S.loading; } finally { S.loading = null; }
  if (S.again) { S.again = false; return load(); }
}

/** How often each supplier's deliveries arrived by their due date, from their last hundred purchase orders. */
async function loadReliability() {
  const lists = await pool(S.suppliers, 4, (s) => read("list_purchase_orders", { supplier_id: s.id }));
  S.reliability = Object.fromEntries(S.suppliers.map((s, i) => {
    const done = (lists[i].ok ? lists[i].data.purchase_orders : []).filter((p) => p.received_at && p.due_at);
    const onTime = done.filter((p) => p.received_at.slice(0, 10) <= p.due_at).length;
    return [s.id, { due: done.length, onTime, late: done.length - onTime, lateDays: done.filter((p) => p.received_at.slice(0, 10) > p.due_at).map((p) => daysBetween(p.due_at, p.received_at)) }];
  }));
}

// ------------------------------------------------------------------ the shell

function shell() {
  main.innerHTML = `<div class="ws">
    <nav class="ws-rail" aria-label="${esc(app.name)}">
      ${can("create_purchase_order") ? `<button class="btn primary ws-main-btn" id="raise" title="Raise an order (O)">${ico("plus", 17)}<span>Raise an order</span></button>` : ""}
      <ul class="rail-list">${VIEWS.map((v) => `<li><a class="rail-row" href="#${v.id}" data-view="${v.id}">${ico(v.id, 17)}<span class="rail-name">${esc(v.label)}</span><span class="rail-count" data-badge="${v.id}"></span></a></li>`).join("")}</ul>
    </nav>
    <section class="ws-view" id="view" tabindex="-1"></section>
  </div>`;
  main.querySelector("#raise")?.addEventListener("click", () => raisePO());
}

function draw() {
  main.querySelectorAll(".rail-row").forEach((a) => {
    const on = a.dataset.view === S.view;
    a.classList.toggle("is-on", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const view = main.querySelector("#view");
  // The rail's numbers: empty shelves, orders waiting for a yes. Hidden at zero.
  const badge = (id, n) => { const b = main.querySelector(`[data-badge="${id}"]`); if (b) b.textContent = n ? num(n) : ""; };
  badge("shelves", S.items.filter((x) => x.state === "out").length);
  badge("orders", S.pos.filter((p) => ["draft", "awaiting_approval"].includes(p.status)).length);
  const scroll = view.scrollTop;
  ({ shelves: drawShelves, moves: drawMoves, counts: drawCounts, suppliers: drawSuppliers, orders: drawOrders })[S.view](view);
  view.scrollTop = scroll;
}

// ------------------------------------------------------------------ shelves

function coverText(x) {
  if (x.state === "made") return "Made for each order";
  if (x.onHand <= 0) return x.restock ? `Empty, more due ${dayLabel(x.restock)}` : "Empty";
  if (!Number.isFinite(x.cover)) return "Not selling lately";
  return `${plural(Math.max(1, Math.round(x.cover)), "day")} left`;
}

/**
 * How full a shelf is, as days of selling: a thin ink bar up to 30 days, with one tick where an order must go in
 * (the supplier's lead time and two days to spare). Under the tick, the bar turns the bad colour.
 */
function level(x) {
  if (x.state === "made") return '<span class="lvl is-made" aria-hidden="true"></span>';
  const days = x.onHand <= 0 ? 0 : Number.isFinite(x.cover) ? x.cover : 30;
  const mark = Math.min(30, Math.max(7, x.lead + 2));
  return `<span class="lvl${x.state === "out" || x.state === "low" ? " is-low" : ""}" style="--w:${Math.min(1, days / 30).toFixed(3)};--m:${(mark / 30).toFixed(3)}" aria-hidden="true"><i></i><b></b></span>`;
}

const SHELF_FILTERS = [
  { id: "all", label: "Everything", test: () => true },
  { id: "out", label: "Empty", test: (x) => x.state === "out" },
  { id: "low", label: "Running low", test: (x) => x.state === "low" },
  { id: "fine", label: "Plenty", test: (x) => x.state === "fine" },
  { id: "made", label: "Made to order", test: (x) => x.state === "made" },
];

/** The shelves: each product's picture, large, over a ruled list of its versions with what is left and for how long. */
function drawShelves(view) {
  const units = S.items.filter((x) => x.state !== "made").reduce((s, x) => s + Math.max(0, x.onHand), 0);
  const f = SHELF_FILTERS.find((x) => x.id === S.filter) || SHELF_FILTERS[0];
  const bays = S.products.map((p) => ({ p, items: S.items.filter((x) => x.product.id === p.id && f.test(x)) })).filter((b) => b.items.length)
    // The ones that need an order first, then by name.
    .sort((a, b) => Math.min(...a.items.map(urgency)) - Math.min(...b.items.map(urgency)) || a.p.name.localeCompare(b.p.name));
  view.innerHTML = `<div class="v-wrap">
    <div class="toolbar">
      <div class="chips" role="group" aria-label="Show">${SHELF_FILTERS.map((x) => `<button class="pm-chip" data-filter="${x.id}" aria-pressed="${x.id === S.filter}">${esc(x.label)} <span class="chip-n">${num(S.items.filter(x.test).length)}</span></button>`).join("")}</div>
      <p class="t-label">${esc(num(units))} things on the shelves. The tick on each bar is when to order more.</p>
    </div>
    <div class="bays" id="bays">${bays.map(({ p, items }) => `<article class="bay${p.status !== "active" ? " is-off" : ""}">
      <div class="bay-pic" style="--sweep:${esc(p.sweep)}"><img src="${esc(p.picture)}" alt="" loading="lazy"></div>
      <h2 class="bay-name">${esc(p.name)}</h2>
      <ul class="bins">${items.map((x) => `<li><button class="bin" data-sku="${esc(x.sku)}">
        <span class="bin-name">${esc(x.accessory ? x.name : items.length === 1 ? "On the shelf" : x.name)}</span>
        <span class="bin-n">${x.state === "made" ? "–" : num(x.onHand)}</span>
        ${level(x)}
        <small class="bin-cover${x.state === "out" ? " is-bad" : x.state === "low" ? " w5" : ""}">${esc(coverText(x))}</small>
      </button></li>`).join("")}</ul>
    </article>`).join("") || emptyState({ title: "Nothing here.", text: "No shelf matches this filter right now." })}</div>
  </div>`;
  view.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { S.filter = b.dataset.filter; draw(); }));
}

/** Days of selling left, with empty shelves first and made-to-order food last. */
function urgency(x) {
  if (x.state === "made") return 1e6;
  if (x.onHand <= 0) return -1;
  return Number.isFinite(x.cover) ? x.cover : 1e5;
}

// ------------------------------------------------------------------ one SKU

async function openSku(sku) {
  const x = itemOf(sku);
  if (!x) return;
  const over = slideOver({ title: x.accessory || x.product.name === x.name ? x.name : `${x.product.name}, ${x.name}`, body: skeleton(6), wide: true });
  S.panel = { sku, over };
  over.el.addEventListener("click", (e) => { if (e.target.closest("[data-close], .over-back")) S.panel = null; });
  await fillSku(over, sku);
}

/**
 * The orders and purchase orders behind the shelf's latest movements, as chips that open them. WHY: an empty shelf
 * is about people waiting; from here you can open the orders it affected and the order that will refill it.
 */
function movedBy(movements) {
  const refs = [];
  for (const m of movements.slice().reverse()) {
    const kind = /^ORD-/.test(m.reference) ? "order" : /^PO-/.test(m.reference) ? "po" : null;
    if (kind && !refs.some((r) => r[1] === m.reference)) refs.push([kind, m.reference]);
    if (refs.length >= 8) break;
  }
  return refs.length ? `<section class="od-sect"><h3 class="od-h">What moved it lately</h3><p class="rec-chips">${refs.map(([k, id]) => recordChip(k, id)).join(" ")}</p></section>` : "";
}

async function fillSku(over, sku, { said } = {}) {
  const r = await read("stock_history", { sku });
  const x = itemOf(sku);
  const body = over.el.querySelector(".over-body");
  if (!r.ok) { body.innerHTML = emptyState({ title: "That shelf did not load.", text: "Try again in a moment." }); return; }
  // WHY kept on the panel: a refresh redraws it moments after a count, and the result must stay beside the form.
  if (S.panel?.over === over) { said ||= S.panel.said; S.panel.said = said; }
  const h = r.data;
  // Walk back from today's number through the movements to draw the last 60 days of the shelf.
  const days = 60;
  const start = addDays(S.now.slice(0, 10), -(days - 1));
  const levels = [];
  let onHand = h.on_hand;
  const moves = h.movements.slice().reverse();
  let k = 0;
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(start, i);
    levels[i] = onHand;
    while (k < moves.length && moves[k].at.slice(0, 10) >= date) { onHand -= moves[k].qty; k++; }
  }
  const sup = supplierOf(sku);
  body.innerHTML = `
    <div class="sku-top">
      <span class="sku-pic" style="--sweep:${esc(x.product.sweep)}"><img src="${esc(x.picture)}" alt=""></span>
      <dl class="sku-figs">
        <div class="fig"><dt>On the shelf</dt><dd>${x.state === "made" ? "–" : esc(num(h.on_hand))}</dd></div>
        <div class="fig"><dt>Lasts</dt><dd class="sku-lasts">${esc(coverText(x))}</dd><small>${x.state === "made" ? "Baked or frozen for each day's orders, so the shelf is meant to be empty." : `${esc(num(x.sold28))} sold in four weeks · ${sup ? `${esc(sup.name)} takes ${esc(plural(sup.lead_time_days, "day"))}` : ""}`}</small></div>
      </dl>
    </div>
    ${movedBy(h.movements)}
    <section class="od-sect"><h3 class="od-h">Do something</h3>
      <div class="acts">
        ${can("create_purchase_order") && sup && x.product.status !== "discontinued" ? `<button class="btn small primary" data-act="order">${ico("plus", 16)} Order more from ${esc(sup.name)}</button>` : ""}
        ${can("record_stock_count") ? `<button class="btn small" data-act="count">${ico("counts", 16)} Count the shelf</button>` : ""}
      </div>
      ${said ? `<p class="said ${said.tone}" role="status">${esc(said.text)}</p>` : ""}
      <div class="act-form" id="sku-form"></div>
    </section>
    ${x.state === "made" ? "" : `<section class="od-sect"><h3 class="od-h">The last 60 days</h3><div id="sku-chart"></div>${arrivals(h, start)}</section>`}
    ${h.open_purchase_orders.length ? `<section class="od-sect"><h3 class="od-h">On order</h3><ul class="od-rows">${h.open_purchase_orders.map((po) => { const l = po.lines.find((y) => y.sku === sku); return `<li><span class="grow"><b>${esc(num(l.qty - (l.qty_received || 0)))} coming</b><small>${esc(S.suppliers.find((s) => s.id === po.supplier_id)?.name || "")} · due ${esc(dayLabel(po.due_at, true))}</small></span>${poState(po.status)}</li>`; }).join("")}</ul></section>` : ""}
    <section class="od-sect"><h3 class="od-h">What moved</h3>
      <ul class="od-rows">${h.movements.slice(-14).reverse().map(moveRow).join("") || `<li class="od-sub">Nothing has moved.</li>`}</ul>
    </section>
    <section class="od-sect"><h3 class="od-h">Counts</h3>
      <ul class="od-rows">${h.counts.slice().reverse().slice(0, 6).map(countRow).join("") || `<li class="od-sub">Never counted.</li>`}</ul>
    </section>`;
  if (x.state !== "made") {
    lineArea(body.querySelector("#sku-chart"), { values: levels, labels: levels.map((_, i) => dayLabel(addDays(start, i))), fmt: num, height: 170,
      tip: (i) => `<b>${esc(dayLabel(addDays(start, i), true))}</b><span>${esc(num(levels[i]))} on the shelf</span>` });
  }
  wireRecordChips(body, world);
  body.querySelector("[data-act=count]")?.addEventListener("click", () => countForm(body.querySelector("#sku-form"), sku, h.on_hand, (text) => fillSku(over, sku, { said: { text, tone: "good" } })));
  body.querySelector("[data-act=order]")?.addEventListener("click", () => { over.close(); S.panel = null; raisePO(sup.id, [{ sku, qty: Math.max(sup.min_order_qty || 1, Math.ceil(x.rate * 30) || sup.min_order_qty || 1) }]); });
}

/** Deliveries that reached this shelf in the chart's window: what an order did, in one line each. */
function arrivals(h, start) {
  const got = h.movements.filter((m) => m.reason === "received" && m.at.slice(0, 10) >= start).reverse().slice(0, 4);
  if (!got.length) return `<p class="od-sub sr-note">No deliveries in this time.</p>`;
  return `<ul class="sr-arrivals">${got.map((m) => `<li><b class="num">+${esc(num(m.qty))}</b> arrived ${esc(dayLabel(m.at, true))}${plainRef(m.reference) ? `, ${esc(plainRef(m.reference, { lower: true }))}` : ""}.</li>`).join("")}</ul>`;
}

/** One movement: how many, which thing, why, when. In and out differ by the sign, not by colour. */
function moveRow(m) {
  const it = itemOf(m.sku);
  return `<li class="move">
    ${thumb(m.sku, 32)}
    <span class="grow"><b>${esc(REASON[m.reason] || words(m.reason))}</b><small>${esc(it ? (it.accessory ? it.name : it.product.name) : "")}${plainRef(m.reference) ? ` · ${esc(plainRef(m.reference))}` : ""}</small></span>
    <time>${esc(when(m.at))}</time>
    <span class="num move-q${m.qty < 0 ? " muted" : ""}">${m.qty > 0 ? "+" : "−"}${esc(num(Math.abs(m.qty)))}</span>
  </li>`;
}

function countRow(c) {
  const it = itemOf(c.sku);
  const d = c.difference;
  return `<li>${thumb(c.sku, 32)}<span class="grow"><b>${esc(it ? (it.accessory || it.product.name === it.name ? it.name : `${it.product.name}, ${it.name}`) : c.sku)}</b><small>Counted ${esc(num(c.counted_qty))}, the books said ${esc(num(c.system_qty))}${c.note ? ` · ${esc(c.note)}` : ""}</small></span>
    <time>${esc(when(c.at))}</time>
    <span class="sr-diff">${d === 0 ? '<span class="muted">Matched</span>' : c.adjusted ? `<span class="num">${d > 0 ? "+" : "−"}${Math.abs(d)}, put right</span>` : `<span class="pill bad">${d > 0 ? "+" : "−"}${Math.abs(d)}, left as it was</span>`}</span></li>`;
}

/** The clipboard: what the books say, what you counted, and whether to put the number right. */
function countForm(slot, sku, systemQty, after) {
  slot.innerHTML = `<form class="act count-form">
    <div class="count-pair"><div class="fig"><dt>The books say</dt><dd>${esc(num(systemQty))}</dd></div>
      <label class="field"><span>You counted</span><input class="input count-in" name="qty" type="number" min="0" step="1" value="${esc(systemQty)}" required></label></div>
    <label class="field"><span>Note</span><input class="input" name="note" placeholder="Where, or anything odd"></label>
    <label class="check"><input type="checkbox" name="adjust" checked> Put the books right to match</label>
    <p class="said" role="status"></p>
    <div class="act-row"><button class="btn small primary" type="submit">Record the count</button><button class="btn small ghost" type="button" data-cancel>Not now</button></div>
  </form>`;
  const f = slot.querySelector("form");
  f.qty.select();
  f.querySelector("[data-cancel]").addEventListener("click", () => { slot.innerHTML = ""; });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    const r = await world.call("record_stock_count", { sku, counted_qty: Number(f.qty.value), note: f.note.value, adjust: f.adjust.checked });
    const said = f.querySelector(".said");
    if (!r.ok) { btn.disabled = false; said.className = "said bad"; said.textContent = r.error.message; return; }
    const text = r.data.difference === 0 ? "Counted. It matches." : `Counted. ${plural(Math.abs(r.data.difference), "thing")} ${r.data.difference > 0 ? "more" : "fewer"} than the books said.`;
    said.className = "said good";
    said.textContent = text;
    await load();
    if (after) await after(text);
    else { draw(); const again = main.querySelector("#count-slot .said"); if (again) { again.className = "said good"; again.textContent = text; } }
  });
}

// ------------------------------------------------------------------ movements and counts

function drawMoves(view) {
  const since = addDays(S.now.slice(0, 10), -6);
  const all = S.items.flatMap((x) => (x.history?.movements || []).filter((m) => m.at.slice(0, 10) >= since)).sort((a, b) => b.at.localeCompare(a.at));
  const byDay = new Map();
  for (const m of all) { const d = m.at.slice(0, 10); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(m); }
  const inN = all.filter((m) => m.qty > 0).reduce((n, m) => n + m.qty, 0), outN = -all.filter((m) => m.qty < 0).reduce((n, m) => n + m.qty, 0);
  view.innerHTML = `<div class="v-wrap">
    <dl class="figs sr-two"><div class="fig"><dt>Came onto the shelves this week</dt><dd>+${esc(num(inN))}</dd></div><div class="fig"><dt>Left the shelves this week</dt><dd>−${esc(num(outN))}</dd></div></dl>
    ${[...byDay.entries()].map(([d, list]) => `<section class="sect"><div class="sect-head"><h2 class="t-h">${esc(dayLabel(d, true))}</h2><span class="t-label">${esc(plural(list.length, "movement"))}</span></div>
      <ul class="od-rows">${list.slice(0, 40).map(moveRow).join("")}</ul>${list.length > 40 ? `<p class="t-label sr-more">and ${esc(num(list.length - 40))} more</p>` : ""}</section>`).join("") || emptyState({ title: "Nothing moved this week." })}
  </div>`;
}

function drawCounts(view) {
  const counts = S.items.flatMap((x) => x.history?.counts || []).sort((a, b) => b.at.localeCompare(a.at));
  const choices = S.items.filter((x) => x.state !== "made");
  view.innerHTML = `<div class="v-wrap">
    <section class="sr-count-card">
      <h2 class="t-h">Count a shelf</h2>
      <label class="field"><span>Which shelf</span><select class="select" id="count-sku">${choices.map((x) => `<option value="${esc(x.sku)}">${esc(x.accessory || x.product.name === x.name ? x.name : `${x.product.name}, ${x.name}`)}</option>`).join("")}</select></label>
      <div id="count-slot"></div>
    </section>
    <section class="sect"><h2 class="t-h">Every count</h2><ul class="od-rows">${counts.slice(0, 40).map(countRow).join("") || `<li>${emptyState({ title: "No counts yet." })}</li>`}</ul></section>
  </div>`;
  const sel = view.querySelector("#count-sku");
  if (S.countSku && choices.some((x) => x.sku === S.countSku)) sel.value = S.countSku;
  const show = () => { S.countSku = sel.value; countForm(view.querySelector("#count-slot"), sel.value, itemOf(sel.value).onHand, null); };
  sel.addEventListener("change", show);
  show();
}

// ------------------------------------------------------------------ suppliers

/** Suppliers as one ruled table: who, what they make, how long they take, how often they kept their word. */
async function drawSuppliers(view) {
  const row = (s) => {
    const rel = S.reliability?.[s.id];
    const pct = rel?.due ? `${Math.round((rel.onTime / rel.due) * 100)}%` : S.reliability ? "–" : "…";
    const prods = [...new Set((s.skus || []).map((k) => itemOf(k)?.product).filter(Boolean))];
    return `<tr>
      <td><b class="w5">${esc(s.name)}</b><small class="sr-sub">${esc(s.town)}, ${esc(s.country)}${s.notes ? ` · ${esc(s.notes)}` : ""}</small></td>
      <td><span class="sr-pics">${prods.slice(0, 4).map((p) => `<span class="thumb" style="--s:32px;--sweep:${esc(p.sweep)}" title="${esc(p.name)}"><img src="${esc(p.picture)}" alt="${esc(p.name)}"></span>`).join("")}</span></td>
      <td class="r">${esc(plural(s.lead_time_days, "day"))}</td>
      <td class="r">${esc(pct)}${rel?.late ? `<small class="sr-sub">worst ${esc(plural(Math.max(...rel.lateDays), "day"))} late</small>` : ""}</td>
      <td class="r muted">${esc(`${Math.round((s.reliability || 0) * 100)}%`)}</td>
      <td class="r">${esc(num(s.min_order_qty))}</td>
      <td class="r">${esc(plural(s.payment_terms_days, "day"))}</td>
      <td class="r">${can("create_purchase_order") ? `<button class="btn small" data-raise="${esc(s.id)}">New order</button>` : ""}</td>
    </tr>`;
  };
  const paint = () => {
    view.innerHTML = `<div class="v-wrap is-wide">
      <p class="t-lede sr-lede">Who makes what, how long they take, and how often they keep their word. On time lately is from their last hundred orders.</p>
      <table class="tbl sr-sups"><thead><tr><th>Supplier</th><th>Makes</th><th class="r">Takes</th><th class="r">On time lately</th><th class="r">Promised</th><th class="r">Smallest order</th><th class="r">Pay within</th><th></th></tr></thead>
        <tbody>${S.suppliers.map(row).join("")}</tbody></table>
    </div>`;
  };
  paint();
  if (!S.reliability) {
    await loadReliability();
    if (S.view === "suppliers") paint();
  }
}

// ------------------------------------------------------------------ purchase orders

const LANES = [
  { id: "wait", title: "Waiting for a yes", test: (p) => ["draft", "awaiting_approval"].includes(p.status) },
  { id: "ordered", title: "On their way", test: (p) => ["ordered", "late", "part_received"].includes(p.status) },
  // Made-to-order food is ordered fresh every day; it would bury every other delivery, so arrived lists leave it out.
  { id: "done", title: "Arrived", test: (p) => p.status === "received" && p.lines.some((l) => itemOf(l.sku)?.state !== "made") },
];

function itemName(it, sku) {
  if (!it) return sku;
  return it.accessory || it.name === it.product.name ? it.name : `${it.product.name}, ${it.name}`;
}

/** A purchase order as a card: supplier and state, what is in it, when, how much, and its one next step. */
function poCard(po) {
  const sup = S.suppliers.find((s) => s.id === po.supplier_id);
  const late = ["ordered", "part_received"].includes(po.status) && po.due_at < S.now.slice(0, 10);
  const acts = [];
  if (["draft", "awaiting_approval"].includes(po.status) && can("approve_purchase_order")) acts.push(`<button class="btn small primary" data-approve="${esc(po.number)}">Approve</button>`);
  if (["ordered", "late", "part_received"].includes(po.status) && can("receive_purchase_order")) acts.push(`<button class="btn small" data-receive="${esc(po.number)}">It has arrived</button>`);
  return `<li class="po" data-po="${esc(po.number)}">
    <div class="po-head"><b>${esc(sup?.name || "A supplier")}</b>${poState(late && po.status === "ordered" ? "late" : po.status)}</div>
    <ul class="po-lines">${po.lines.map((l) => `<li>${thumb(l.sku, 28)}<span class="grow">${esc(itemName(itemOf(l.sku), l.sku))}</span><span class="num">${l.qty_received && l.qty_received < l.qty ? `${num(l.qty_received)} of ` : ""}${esc(num(l.qty))}</span></li>`).join("")}</ul>
    <div class="po-foot"><span class="t-label">${esc(plainRef(po.number))} · ${po.received_at ? `arrived ${esc(when(po.received_at))}` : `due ${esc(dayLabel(po.due_at))}`}</span><span class="num w5">${esc(money(poTotal(po)))}</span></div>
    ${po.status === "received" ? shelfNow(po) : ""}
    ${acts.length ? `<div class="acts">${acts.join("")}</div>` : ""}
    <p class="said${S.poSaid?.number === po.number ? " good" : ""}" role="status">${S.poSaid?.number === po.number ? esc(S.poSaid.text) : ""}</p>
  </li>`;
}

/** After a delivery: how full those shelves are now, so an order's effect is visible. Made-to-order food is left out. */
function shelfNow(po) {
  const kept = po.lines.map((l) => itemOf(l.sku)).filter((it) => it && it.state !== "made");
  if (!kept.length) return "";
  return `<p class="po-now">On the shelf now: ${kept.slice(0, 3).map((it) => `${esc(itemName(it))} ${esc(num(it.onHand))}`).join("; ")}${kept.length > 3 ? " and more" : ""}.</p>`;
}

function drawOrders(view) {
  view.innerHTML = `<div class="v-wrap is-wide">
    <p class="t-lede sr-lede">What the shop has asked its suppliers for, and where it has got to.</p>
    <div class="lanes">${LANES.map((l) => { const list = S.pos.filter(l.test); return `<section class="lane"><h2 class="lane-head"><span>${esc(l.title)}</span><span class="t-label">${esc(num(list.length))}</span></h2>
      <ul class="lane-list">${list.slice(0, 24).map(poCard).join("") || `<li class="lane-empty">Nothing here.</li>`}</ul></section>`; }).join("")}</div>
  </div>`;
}

/** The order form in a slide-over: a supplier, then a quantity for anything they make. */
function raisePO(supplierId = (S.suppliers.find((s) => (s.skus || []).some((k) => itemOf(k) && itemOf(k).state !== "made")) || S.suppliers[0])?.id, preset = []) {
  const body = document.createElement("div");
  const over = slideOver({ title: "Raise an order", body, wide: true });
  const draw1 = (sid) => {
    const sup = S.suppliers.find((s) => s.id === sid);
    const lines = (sup.skus || []).map((sku) => ({ sku, it: itemOf(sku), qty: preset.find((p) => p.sku === sku)?.qty || 0 })).filter((l) => l.it && l.it.product.status !== "discontinued");
    body.innerHTML = `<form class="po-form">
      <label class="field"><span>Supplier</span><select class="select" name="supplier">${S.suppliers.map((s) => `<option value="${esc(s.id)}"${s.id === sid ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
      <p class="small muted">${esc(sup.name)} takes ${esc(plural(sup.lead_time_days, "day"))}. Smallest order ${esc(num(sup.min_order_qty))} a line.</p>
      <ul class="od-rows po-pick">${lines.map((l) => `<li>${thumb(l.sku, 44)}<span class="grow"><b>${esc(l.it.accessory || l.it.name === l.it.product.name ? l.it.name : `${l.it.product.name}, ${l.it.name}`)}</b>
        <small>${esc(num(l.it.onHand))} on the shelf · ${esc(coverText(l.it).toLowerCase())} · ${esc(money2(sup.unit_cost?.[l.sku]))} each</small></span>
        <input class="input qty" type="number" min="0" step="1" name="q:${esc(l.sku)}" value="${esc(l.qty || "")}" placeholder="0" aria-label="How many"></li>`).join("")}</ul>
      <label class="field"><span>Note</span><input class="input" name="note" placeholder="Anything the supplier should know"></label>
      <div class="po-total"><button class="btn small" type="button" id="fill30">Fill each shelf for 30 days</button><span>Total</span><b class="big-num" id="po-total">£0</b></div>
      <p class="said" role="status"></p>
      <div class="act-row"><button class="btn primary" type="submit">Send the order</button></div>
    </form>`;
    const f = body.querySelector("form");
    const total = () => {
      const t = lines.reduce((n, l) => n + (Number(f[`q:${l.sku}`].value) || 0) * (sup.unit_cost?.[l.sku] || 0), 0);
      body.querySelector("#po-total").textContent = money2(t);
    };
    f.addEventListener("input", total);
    total();
    // A quick way to try a stock decision: enough of everything to cover the next month at today's pace.
    body.querySelector("#fill30").addEventListener("click", () => {
      for (const l of lines) {
        if (l.it.state === "made") continue;
        const need = Math.ceil(l.it.rate * 30 - Math.max(0, l.it.onHand));
        f[`q:${l.sku}`].value = need > 0 ? Math.max(sup.min_order_qty || 1, need) : "";
      }
      total();
    });
    f.supplier.addEventListener("change", () => { preset = []; draw1(f.supplier.value); });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const chosen = lines.map((l) => ({ sku: l.sku, qty: Math.round(Number(f[`q:${l.sku}`].value) || 0) })).filter((l) => l.qty > 0);
      const said = (text) => { const el = body.querySelector(".said"); el.className = "said bad"; el.textContent = text; };
      if (!chosen.length) return said("Put a number against at least one thing.");
      const r = await world.call("create_purchase_order", { supplier_id: sid, lines: chosen, note: f.note.value });
      if (!r.ok) return said(r.error.message);
      over.close();
      toast(r.data.status === "ordered" ? `Sent to ${sup.name}. Due ${dayLabel(r.data.due_at, true)}.` : r.data.status === "draft" ? "Saved as a draft for a person to approve." : "Over the buyer's limit, so it waits for the manager.", { tone: "good", ms: 4200 });
      await load();
      S.view = "orders";
      history.replaceState(null, "", "#orders");
      draw();
      const card = main.querySelector(`[data-po="${CSS.escape(r.data.number)}"]`);
      card?.classList.add("is-changed");
    });
  };
  draw1(supplierId);
}

/** Approve or book in: the card says so at once; on a refusal it says why, on the card. */
async function poAction(tool, number, said) {
  const card = main.querySelector(`[data-po="${CSS.escape(number)}"]`);
  const acts = card?.querySelector(".acts");
  if (acts) acts.hidden = true;
  const line = card?.querySelector(".said");
  if (line) { line.className = "said"; line.textContent = "Sending…"; }
  const r = await world.call(tool, { number });
  if (!r.ok) {
    if (acts) acts.hidden = false;
    if (line) { line.className = "said bad"; line.textContent = r.error.message; }
    return;
  }
  // WHY kept in state: the refresh that follows any action redraws the board, and the words must stay on the card.
  S.poSaid = { number, text: said };
  await load();
  draw();
  main.querySelector(`[data-po="${CSS.escape(number)}"]`)?.classList.add("is-changed");
}

// ------------------------------------------------------------------ routing and staying live

function route() {
  const [view, id] = location.hash.replace(/^#/, "").split("/");
  const was = S.view;
  S.view = VIEWS.some((v) => v.id === view) ? view : "shelves";
  draw();
  if (was !== S.view) main.querySelector("#view").scrollTop = 0;
  if (id && S.view === "shelves" && !S.panel) openSku(decodeURIComponent(id));
}

main.addEventListener("click", (e) => {
  const sku = e.target.closest("[data-sku]");
  if (sku) { openSku(sku.dataset.sku); return; }
  const ap = e.target.closest("[data-approve]");
  if (ap) { poAction("approve_purchase_order", ap.dataset.approve, "Approved and sent to the supplier."); return; }
  const rc = e.target.closest("[data-receive]");
  if (rc) { poAction("receive_purchase_order", rc.dataset.receive, "Booked in. The shelves are fuller."); return; }
  const raise = e.target.closest("[data-raise]");
  if (raise) raisePO(raise.dataset.raise);
});

/**
 * The keyboard. Keys act only when you are not typing and nothing is open over the page.
 *   1 to 5: the five views   O: raise an order   J or Down, K or Up: move through shelves or orders (Enter opens)
 */
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".over")) return;
  if (e.target.closest?.("input, textarea, select")) { if (e.key === "Escape") e.target.blur(); return; }
  const n = Number(e.key);
  if (n >= 1 && n <= VIEWS.length) { e.preventDefault(); location.hash = `#${VIEWS[n - 1].id}`; return; }
  if (e.key === "o" && can("create_purchase_order")) { e.preventDefault(); raisePO(); return; }
  const down = e.key === "j" || e.key === "ArrowDown", up = e.key === "k" || e.key === "ArrowUp";
  if (!down && !up) return;
  const items = [...main.querySelectorAll("#view .bin, #view .po button, #view [data-raise]")];
  if (!items.length) return;
  e.preventDefault();
  const at = items.indexOf(document.activeElement);
  const next = items[at < 0 ? 0 : Math.max(0, Math.min(items.length - 1, at + (down ? 1 : -1)))];
  next.focus();
  next.scrollIntoView({ block: "nearest" });
});

async function refresh() {
  await load();
  // WHY: redrawing the counts view would wipe a count someone is typing; leave the screen alone while a form has focus.
  if (document.activeElement?.closest?.("form")) return;
  draw();
}

let pending = null;
function scheduleRefresh() {
  clearTimeout(pending);
  pending = setTimeout(refresh, 500);
}

async function start() {
  // Nobody is "at the computer": the client calls each tool as a job allowed to use it. Only existence matters here.
  const list = await world.tools().catch(() => []);
  S.tools = new Set(list.map((t) => t.name));
  shell();
  main.querySelector("#view").innerHTML = `<div class="v-wrap">${skeleton(6)}</div>`;
  await load();
  route();
}

await start();
window.addEventListener("hashchange", route);
document.addEventListener("ot:day", (e) => {
  if (e.detail?.now) S.now = e.detail.now;
  if (!e.detail?.partial) scheduleRefresh();
});
world.onChange((change) => {
  if (change.source === "local") return;
  if (change.now) S.now = change.now;
  if (change.reset || change.entries.some((e) => !isScreenRead(e))) scheduleRefresh();
});
