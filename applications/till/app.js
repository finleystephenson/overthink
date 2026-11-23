// Till: the shop's admin. Today at a glance, every order, the products and their prices, discounts and
// payments, deliveries. Every figure is read live through the business's tools (lib/shop-data.js) and every
// button is a real tool call, so an outside AI changing a price or cancelling an order shows here within seconds.
//
// Address bar: #today, #orders, #orders/ORD-17210, #products, #products/OT-SOCK, #money, #deliveries.
import { startApp, esc, money, money2, num, plural, timeParts, daysBetween, words, avatar, emptyState, skeleton, slideOver, toast } from "../lib/ui.js";
import { isScreenRead } from "../lib/client.js";
import { plainRef, plainText } from "../lib/plain.js";
import { openRecord } from "../lib/records.js";
import { createData, addDays } from "../lib/shop-data.js";
import { lineArea } from "../lib/chart.js";

const APP_ID = "till";
const { world, app } = await startApp({ id: APP_ID });
document.title = `${app.name} · Overthought & Co.`;

const D = createData(world);
const main = document.getElementById("main");

const S = {
  view: "today",
  now: null,
  sales: null,         // salesByDay answer, or a refusal
  list: [],            // full order records from the last week (the ledger window), newest first
  listError: null,
  known: new Set(),    // order numbers already on screen, so new ones arrive visibly
  panel: null,         // the open slide-over: { kind, id, over, redraw }
  loading: null,
  again: false,
  // The Orders view pages through every order in the shop (list_all_orders), not just the week.
  page: { filter: "all", q: "", rows: [], total: 0, error: null, busy: false },
  owed: null,          // list_pay_later's answer
};

// ------------------------------------------------------------------ words and small parts

const ICONS = {
  today: '<path d="M4 19V10M10 19V5M16 19v-7M21 19H3"/>',
  orders: '<path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2Z"/><path d="M9 8.5h6M9 12h6"/>',
  products: '<path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5Z"/><path d="M4 8.5 12 13l8-4.5M12 13v7"/>',
  money: '<path d="M3.5 7.5h17v9h-17Z"/><circle cx="12" cy="12" r="2.3"/><path d="M6.5 10v4M17.5 10v4"/>',
  deliveries: '<path d="M2.5 6.5h11v9h-11ZM13.5 9.5h4l3 3v3h-7"/><circle cx="6.5" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  tag: '<path d="M3.5 12.5v-8h8l9 9-8 8Z"/><circle cx="8" cy="8.5" r="1.4"/>',
};

function ico(name, size = 18) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

const VIEWS = [
  { id: "today", label: "Today" },
  { id: "orders", label: "Orders" },
  { id: "products", label: "Products" },
  { id: "money", label: "Discounts and payments" },
  { id: "deliveries", label: "Deliveries" },
];

// Order states in plain words. Only a failed payment is coloured: it is the one a person must act on.
const STATUS = {
  placed: "Waiting for payment", paid: "To pack", packed: "Packed", part_dispatched: "Partly sent", dispatched: "On its way",
  delivered: "Delivered", cancelled: "Cancelled", payment_failed: "Payment failed", declined: "Payment failed",
};
const statusText = (s) => STATUS[s] || words(s);

function statusCell(s, late = false) {
  if (late) return '<span class="pill bad">Late</span>';
  if (s === "payment_failed" || s === "declined") return `<span class="pill bad">${esc(statusText(s))}</span>`;
  return `<span class="t-status">${esc(statusText(s))}</span>`;
}

const PRODUCT_STATUS = { active: "On sale", coming_soon: "Coming soon", discontinued: "Stopped", prepared: "Not launched" };
const SHIP = { pending: "Waiting to be packed", packed: "Packed", in_transit: "On its way", dispatched: "On its way", delayed: "Held up", delivered: "Delivered", lost: "Lost", cancelled: "Cancelled" };
const shipWords = (st) => SHIP[st] || words(st);
const PAY = { paid: "Paid", refunded: "Refunded", part_refunded: "Partly refunded", declined: "Declined", due: "Pay later, owed", overdue: "Pay later, overdue", settled: "Pay later, paid", nothing_due: "Nothing owed" };

/** "14:20", "Sat 11:23", "3 Nov": how long ago, the way a shop till says it. */
function when(iso) {
  if (!iso) return "";
  const now = S.now || iso;
  if (iso.slice(0, 10) === now.slice(0, 10)) return iso.slice(11, 16);
  const d = daysBetween(iso, now);
  const p = timeParts(iso);
  if (d > 0 && d < 7) return `${p.weekday.slice(0, 3)} ${p.time}`;
  return p.year === timeParts(now).year ? `${p.day} ${p.monthShort}` : `${p.day} ${p.monthShort} ${p.year}`;
}

function dayLabel(date, long = false) {
  const p = timeParts(`${date}T12:00:00Z`);
  return long ? `${p.weekday} ${p.day} ${p.month}` : `${p.day} ${p.monthShort}`;
}

/** The product a line belongs to, for its picture. Falls back to nothing rather than guessing. */
function lineProduct(sku) {
  return D.sku.get(sku) || null;
}

/** The product an item line names ("1 x The Spare Sock, One size"), for list rows that carry words, not codes. */
function productNamed(line) {
  return D.products.find((p) => String(line).includes(p.name)) || null;
}

function pic(src, sweep, size) {
  return src ? `<span class="thumb" style="--s:${size}px;--sweep:${esc(sweep)}"><img src="${esc(src)}" alt="" loading="lazy"></span>` : `<span class="thumb" style="--s:${size}px"></span>`;
}

function thumb(sku, size = 40) {
  const hit = lineProduct(sku);
  return hit ? pic(hit.item.picture || hit.product.picture, hit.product.sweep, size) : pic("", "", size);
}

/** "The Daypack and 2 more things" */
function itemsLine(order) {
  const names = order.items.map((l) => lineProduct(l.sku)?.product.name || l.name.split(",")[0]);
  const unique = [...new Set(names)];
  return unique.length > 1 ? `${unique[0]} and ${plural(unique.length - 1, "more thing", "more things")}` : unique[0] || "Nothing";
}

function itemCount(order) {
  return order.items.reduce((n, l) => n + l.qty, 0);
}

/** A parcel that should have arrived by now and has not. */
function isLate(s) {
  if (!s || ["delivered", "cancelled", "lost"].includes(s.status)) return false;
  if (s.status === "delayed") return true;
  return Boolean(s.eta && S.now && s.eta < S.now.slice(0, 10) && s.dispatched_at);
}

function orderLate(o) {
  return (o.shipments || []).some(isLate);
}

const toPack = (o) => ["paid", "placed"].includes(o.status);

// The Orders filters. Each asks the business for one status; "Late" needs parcels, so it reads the week's orders.
const FILTERS = [
  { id: "all", label: "All" },
  { id: "paid", label: "To pack", status: "paid" },
  { id: "placed", label: "Waiting for payment", status: "placed" },
  { id: "dispatched", label: "On its way", status: "dispatched" },
  { id: "late", label: "Late", local: true },
  { id: "delivered", label: "Delivered", status: "delivered" },
  { id: "cancelled", label: "Cancelled", status: "cancelled" },
  { id: "payment_failed", label: "Payment failed", status: "payment_failed" },
];

// ------------------------------------------------------------------ the shell: a rail and one view, as Letterbox has

function shell() {
  main.innerHTML = `<div class="ws">
    <nav class="ws-rail" aria-label="${esc(app.name)}">
      <a class="btn primary ws-main-btn" href="#products?change" title="Change prices (P)">${ico("tag", 17)}<span>Change prices</span></a>
      <ul class="rail-list">${VIEWS.map((v) => `<li><a class="rail-row" href="#${v.id}" data-view="${v.id}">${ico(v.id, 17)}<span class="rail-name">${esc(v.label)}</span><span class="rail-count" data-badge="${v.id}"></span></a></li>`).join("")}</ul>
    </nav>
    <section class="ws-view" id="view" tabindex="-1"></section>
  </div>`;
}

function markNav() {
  main.querySelectorAll(".rail-row").forEach((a) => {
    const on = a.dataset.view === S.view;
    a.classList.toggle("is-on", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

/** The rail's numbers: orders to pack, parcels late. Hidden at zero. */
function badges() {
  const set = (id, n) => {
    const b = main.querySelector(`[data-badge="${id}"]`);
    if (b) b.textContent = n ? num(n) : "";
  };
  set("orders", S.list.filter(toPack).length);
  set("deliveries", S.list.filter(orderLate).length);
}

// ------------------------------------------------------------------ loading

/** Reads the world. One at a time: a change arriving mid-read asks for one more read afterwards. */
async function load({ catalogue = true } = {}) {
  if (S.loading) { S.again = true; return S.loading; }
  S.loading = (async () => {
    const clock = await world.clock().catch(() => null);
    if (clock?.now) S.now = clock.now;
    D.now = S.now;
    await Promise.all([catalogue || !D.products.length ? D.loadCatalogue() : null, loadOrders(), D.loadPriceChanges()]);
    if (S.view === "orders") await loadPage();
  })();
  try { await S.loading; } finally { S.loading = null; }
  if (S.again) { S.again = false; return load(); }
}

async function loadOrders() {
  S.listError = null;
  const r = await D.loadIndex();
  if (!r.ok) { S.list = []; S.listError = r.error; return; }
  const [list, sales] = await Promise.all([D.loadOrders(), D.salesByDay(30)]);
  S.list = list;
  S.sales = sales;
}

/** One page of every order, for the Orders view. `more` adds the next page below. */
async function loadPage({ more = false } = {}) {
  const P = S.page;
  const f = FILTERS.find((x) => x.id === P.filter) || FILTERS[0];
  if (f.local) return;
  const q = { offset: more ? P.rows.length : 0, ...(f.status ? { status: f.status } : {}), ...(P.q.trim() ? { search: P.q.trim() } : {}) };
  const r = await D.allOrders(q);
  if (!r.ok) { P.error = r.error; return; }
  P.error = null;
  P.total = r.data.total;
  P.rows = more ? [...P.rows, ...r.data.orders.filter((o) => !P.rows.some((x) => x.number === o.number))] : r.data.orders;
}

/** Draws the current view from what has been read. */
function draw() {
  markNav();
  badges();
  const view = main.querySelector("#view");
  const fn = { today: drawToday, orders: drawOrders, products: drawProducts, money: drawMoney, deliveries: drawDeliveries }[S.view];
  // A refresh can arrive while someone is typing in a box; keep their place.
  const active = document.activeElement;
  const typing = active?.matches?.("#view input:not([type=radio])") ? { name: active.name || active.id, at: active.selectionStart, value: active.value } : null;
  fn(view);
  if (typing) {
    const again = view.querySelector(`[name="${typing.name}"], #${CSS.escape(typing.name || "x")}`);
    if (again) { again.value = typing.value; again.focus(); try { again.setSelectionRange(typing.at, typing.at); } catch { /* number inputs */ } }
  }
  for (const o of S.list) S.known.add(o.number);
}

// ------------------------------------------------------------------ today

function lastDay() {
  if (!S.sales?.ok) return null;
  const since = Date.parse(S.now) - 864e5;
  const entries = S.sales.entries.filter((e) => Date.parse(e.at) > since);
  const numbers = new Set(entries.filter((e) => e.type === "sale").map((e) => e.reference));
  const taken = entries.reduce((n, e) => n + e.amount, 0);
  const items = [...numbers].map((n) => D.orders.get(n)).filter(Boolean).reduce((n, o) => n + itemCount(o), 0);
  return { money: taken, orders: numbers.size, items, average: numbers.size ? taken / numbers.size : 0 };
}

/** Units sold per product over the last week, from the week's orders. */
function selling() {
  const since = addDays(S.now.slice(0, 10), -6);
  const by = new Map();
  for (const o of S.list) {
    if (o.status === "cancelled" || o.placed_at.slice(0, 10) < since) continue;
    for (const l of o.items) {
      const hit = lineProduct(l.sku);
      if (!hit) continue;
      const row = by.get(hit.product.id) || { product: hit.product, units: 0, money: 0 };
      row.units += l.qty;
      row.money += l.qty * l.unit_price;
      by.set(hit.product.id, row);
    }
  }
  return [...by.values()].sort((a, b) => b.units - a.units || b.money - a.money);
}

function drawToday(view) {
  const day = lastDay();
  const top = selling().slice(0, 5);
  const empty = D.products.filter((x) => x.status === "active" && !x.madeToOrder).flatMap((x) => x.variants.filter((v) => v.stock === 0).map((v) => ({ x, v })));
  const pack = S.list.filter(toPack).length;
  const late = S.list.filter(orderLate).length;
  const fig = (label, value) => `<div class="fig"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  view.innerHTML = `
    <div class="v-wrap">
      ${day ? `<dl class="figs">${fig("Taken in the last day", money(day.money))}${fig("Orders", num(day.orders))}${fig("Things sold", num(day.items))}${fig("Average order", money(day.average))}</dl>
        <section class="t-chart"><p class="t-label">Taken each day, the last 30 days</p><div id="chart"></div></section>`
        : `<div class="figs-loading">${skeleton(3)}</div>`}
      <section class="sect">
        <div class="sect-head"><h2 class="t-h">Selling this week</h2><a class="btn small ghost" href="#products">Every product</a></div>
        ${top.length ? `<div class="strip">${top.map((r) => `<a class="pcard" href="#products/${esc(r.product.id)}" data-product="${esc(r.product.id)}">
          <span class="pcard-pic" style="--sweep:${esc(r.product.sweep)}"><img src="${esc(r.product.picture)}" alt="" loading="lazy"></span>
          <span class="pcard-body"><b class="pcard-name">${esc(r.product.name)}</b><span class="pcard-sub">${esc(num(r.units))} sold · ${esc(money(r.money))}</span></span>
        </a>`).join("")}</div>` : emptyState({ title: "Nothing sold this week." })}
      </section>
      <div class="t-cols">
        <section class="sect">
          <div class="sect-head"><h2 class="t-h">Latest orders</h2><a class="btn small ghost" href="#orders">Every order</a></div>
          <ul class="o-table" id="latest">${S.list.length ? S.list.slice(0, 6).map((o) => orderRow(summaryOf(o), orderLate(o))).join("") : `<li>${emptyState({ title: "No orders yet.", text: "They arrive as the day goes on." })}</li>`}</ul>
        </section>
        <section class="sect">
          <h2 class="t-h">Needs doing</h2>
          <ul class="todo">
            <li><a href="#orders?f=paid"><span>${pack ? `${esc(plural(pack, "order"))} to pack` : "Nothing to pack"}</span>${ico("orders", 16)}</a></li>
            <li><a href="#deliveries"><span class="${late ? "is-bad" : ""}">${late ? `${esc(plural(late, "parcel"))} running late` : "No parcels late"}</span>${ico("deliveries", 16)}</a></li>
            ${empty.length ? empty.slice(0, 4).map(({ x, v }) => `<li><a href="#products/${esc(x.id)}" data-product="${esc(x.id)}"><span>${esc(x.name)}${x.variants.length > 1 ? `, ${esc(v.name)}` : ""}: shelf empty</span>${ico("products", 16)}</a></li>`).join("") : `<li><a href="#products"><span>Every shelf has stock</span>${ico("products", 16)}</a></li>`}
          </ul>
        </section>
      </div>
    </div>`;
  if (S.sales?.ok) {
    const days = S.sales.days;
    lineArea(view.querySelector("#chart"), {
      values: days.map((d) => d.money), labels: days.map((d) => dayLabel(d.date)), fmt: money, height: 200,
      tip: (i) => `<b>${i === days.length - 1 ? "The last 24 hours" : esc(dayLabel(days[i].date, true))}</b><span>${esc(money2(days[i].money))} · ${esc(plural(days[i].orders, "order"))}</span>`,
    });
  }
}

// ------------------------------------------------------------------ orders

/** A full order record in the same shape as a list_all_orders row, so one row drawing serves both. */
function summaryOf(o) {
  return {
    number: o.number, placed_at: o.placed_at, status: o.status, total: o.totals.total, customer_name: o.delivery?.address?.town || "",
    items: o.items.map((l) => `${l.qty} x ${l.name}`), skus: o.items.map((l) => l.sku), label: itemsLine(o),
  };
}

/**
 * One order as a table row: picture, what, which order, who, when, state, total (right-aligned).
 * @param {object} o a list_all_orders row, or summaryOf(full order)
 */
function orderRow(o, late = false) {
  const first = o.skus ? lineProduct(o.skus[0])?.product : productNamed(o.items?.[0]);
  const what = o.label || (o.items?.length ? `${(first?.name || String(o.items[0]).replace(/^\d+ x /, "").split(",")[0])}${o.items.length > 1 ? ` and ${plural(o.items.length - 1, "more thing", "more things")}` : ""}` : "Nothing");
  const fresh = S.known.size && !S.known.has(o.number);
  return `<li class="o-li${fresh ? " is-new" : ""}"><button class="o-row" data-order="${esc(o.number)}">
    ${first ? pic(first.picture, first.sweep, 40) : pic("", "", 40)}
    <span class="o-what">${esc(what)}</span>
    <span class="o-num">${esc(plainRef(o.number))}</span>
    <span class="o-who">${esc(o.customer_name || "")}</span>
    <span class="o-when">${esc(when(o.placed_at))}</span>
    <span class="o-state">${statusCell(o.status, late)}</span>
    <span class="o-total">${esc(money2(o.total))}</span>
  </button></li>`;
}

function drawOrders(view) {
  const P = S.page;
  const f = FILTERS.find((x) => x.id === P.filter) || FILTERS[0];
  const rows = f.local
    ? S.list.filter(orderLate).filter((o) => !P.q.trim() || `${o.number} ${itemsLine(o)} ${o.delivery?.address?.town}`.toLowerCase().includes(P.q.trim().toLowerCase())).map((o) => [summaryOf(o), true])
    : P.rows.map((o) => [o, false]);
  const total = f.local ? rows.length : P.total;
  view.innerHTML = `
    <div class="v-wrap">
      <div class="toolbar">
        <div class="chips" role="group" aria-label="Show">${FILTERS.map((x) => `<button class="pm-chip" data-filter="${x.id}" aria-pressed="${x.id === P.filter}">${esc(x.label)}</button>`).join("")}</div>
        <label class="search">${ico("search", 17)}<input id="o-search" type="search" placeholder="Order number, customer or product" value="${esc(P.q)}" aria-label="Search every order" autocomplete="off"></label>
      </div>
      <p class="t-label o-count">${P.busy ? "Reading…" : f.local ? `${esc(plural(total, "order"))} with a parcel running late, from the last week` : `${esc(num(total))} ${total === 1 ? "order" : "orders"}${P.q.trim() ? ` matching “${esc(P.q.trim())}”` : ""}, newest first`}</p>
      <div class="o-head" aria-hidden="true"><span></span><span>What</span><span>Order</span><span>Customer</span><span>Placed</span><span>State</span><span>Total</span></div>
      <ul class="o-table" id="orders">${rows.length ? rows.map(([o, late]) => orderRow(o, late)).join("")
        : `<li>${emptyState({ title: P.error ? "The orders did not load." : "Nothing matches.", text: P.error ? "Try again in a moment." : "Try another filter or fewer words." })}</li>`}</ul>
      ${!f.local && P.rows.length < P.total ? `<div class="more"><button class="btn" id="older">Show ${esc(num(Math.min(50, P.total - P.rows.length)))} more</button></div>` : ""}
    </div>`;
  view.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", async () => {
    P.filter = b.dataset.filter;
    P.busy = true;
    draw();
    await loadPage();
    P.busy = false;
    draw();
  }));
  const input = view.querySelector("#o-search");
  let timer = null;
  input.addEventListener("input", () => {
    P.q = input.value;
    clearTimeout(timer);
    timer = setTimeout(async () => { await loadPage(); draw(); }, 280);
  });
  view.querySelector("#older")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = "Reading…";
    await loadPage({ more: true });
    draw();
  });
}

// ------------------------------------------------------------------ one order

async function openOrder(number) {
  const over = slideOver({ title: plainRef(number), body: skeleton(8), wide: true });
  S.panel = { kind: "order", id: number, over, redraw: () => fillOrder(over, number) };
  over.el.addEventListener("click", (e) => { if (e.target.closest("[data-close], .over-back")) closedPanel(); });
  document.addEventListener("keydown", function esc1(e) { if (e.key === "Escape") { closedPanel(); document.removeEventListener("keydown", esc1); } });
  await fillOrder(over, number);
}

function closedPanel() {
  S.panel = null;
  if (/\//.test(location.hash)) history.replaceState(null, "", `#${S.view}`);
}

const STEPS = ["Placed", "Packed", "Sent", "Delivered"];

function stepOf(status) {
  return { placed: 0, paid: 0, packed: 1, part_dispatched: 2, dispatched: 2, delivered: 3 }[status] ?? -1;
}

async function fillOrder(over, number, { said } = {}) {
  const body = over.el.querySelector(".over-body");
  // WHY kept on the panel: a refresh redraws the panel moments after an action, and the words saying what
  // happened must stay beside the buttons until the person moves on.
  if (S.panel?.over === over) { said ||= S.panel.said; S.panel.said = said; }
  const r = await D.order(number);
  if (!r.ok) {
    body.innerHTML = emptyState({ title: "That order did not open.", text: "Try again in a moment." });
    return;
  }
  const o = r.data;
  const step = stepOf(o.status);
  const c = D.can("get_customer") ? await D.customer(o.customer_id) : null;
  const cust = c?.ok ? c.data : null;
  const refundable = Math.round((o.totals.total - (o.payment.refunded || 0)) * 100) / 100;
  const year = timeParts(o.placed_at).year !== timeParts(S.now).year ? ` ${timeParts(o.placed_at).year}` : "";
  body.innerHTML = `
    <p class="od-top">${statusCell(o.status, orderLate(o))}<span class="t-label">Placed ${esc(when(o.placed_at))}${esc(year)}</span></p>
    ${o.status === "cancelled" || step < 0 ? "" : `<ol class="track">${STEPS.map((s, i) => `<li class="${i <= step ? "is-done" : ""}"><i></i><span>${s}</span></li>`).join("")}</ol>`}
    <ul class="od-lines">${o.items.map((l) => `<li>${thumb(l.sku, 48)}<span class="grow"><b>${esc(l.name)}</b><small>${esc(l.qty)} × ${esc(money2(l.unit_price))}</small></span><span class="num">${esc(money2(l.qty * l.unit_price))}</span></li>`).join("")}</ul>
    <dl class="sums">
      <div><dt>Things</dt><dd>${esc(money2(o.totals.items))}</dd></div>
      <div><dt>Delivery, ${esc(words(o.delivery.method).toLowerCase())}</dt><dd>${esc(money2(o.totals.delivery))}</dd></div>
      ${o.totals.discount ? `<div><dt>Discount</dt><dd>−${esc(money2(o.totals.discount))}</dd></div>` : ""}
      <div class="sum-total"><dt>Total</dt><dd>${esc(money2(o.totals.total))}</dd></div>
    </dl>
    <div class="od-grid">
      <section><h3 class="od-h">Customer</h3>
        <div class="od-person">${avatar(cust?.name || "?", { size: 32 })}<span><button class="linkish" data-customer="${esc(o.customer_id)}">${esc(cust?.name || "A customer")}</button><small>${esc(cust?.email || "")}</small></span></div>
        <p class="od-addr">${esc(o.delivery.address.line1)}<br>${esc(o.delivery.address.town)} ${esc(o.delivery.address.postcode)}</p></section>
      <section><h3 class="od-h">Payment</h3>
        <p><b class="w5">${esc(PAY[o.payment.status] || words(o.payment.status))}</b></p><p class="od-sub">${esc(o.payment.method || "")}</p>
        ${o.payment.refunded ? `<p class="od-sub">${esc(money2(o.payment.refunded))} given back</p>` : ""}
        ${o.payment.due_date ? `<p class="od-sub">Due ${esc(dayLabel(o.payment.due_date, true))}</p>` : ""}</section>
    </div>
    <section class="od-sect"><h3 class="od-h">Parcels</h3>
      ${(o.shipments || []).length ? `<ul class="od-rows">${o.shipments.map((s) => `<li><span class="grow"><b>${esc(shipWords(s.status))}${s.carrier && s.dispatched_at ? ` with ${esc(s.carrier)}` : ""}</b>
        <small>${s.status === "cancelled" ? "never sent" : s.delivered_at ? `arrived ${esc(when(s.delivered_at))}` : s.eta ? `due ${esc(dayLabel(s.eta, true))}` : "not sent yet"}</small></span>
        ${isLate(s) ? `<span class="pill bad">${esc(plural(Math.max(1, daysBetween(s.eta, S.now)), "day"))} late</span>` : ""}</li>`).join("")}</ul>` : `<p class="od-sub">No parcels.</p>`}
    </section>
    <section class="od-sect"><h3 class="od-h">What happened</h3>
      <ol class="history">${o.history.slice().reverse().map((h) => `<li><time>${esc(when(h.at))}</time><span>${esc(plainEvent(h.event))}</span></li>`).join("")}</ol>
    </section>
    <section class="od-sect od-acts"><h3 class="od-h">Do something</h3>
      ${orderActions(o, refundable)}
      ${said ? `<p class="said ${said.tone}" role="status">${esc(said.text)}</p>` : '<p class="said" role="status"></p>'}
      <div class="act-form" id="act-form"></div>
    </section>`;
  body.querySelector("[data-customer]")?.addEventListener("click", (e) => openRecord(world, "customer", e.currentTarget.dataset.customer));
  wireOrderActions(over, o, refundable);
}

/** An order's history line in plain words: parcel codes go, any other code is said out loud. */
function plainEvent(text) {
  return plainText(String(text).replace(/\s*\(SHP-[\d-]+\)/g, "").replace(/\bSHP-[\d-]+\b/g, "the parcel"));
}

/** The buttons for this order. The next step is the one ink pill; the business still has the last word. */
function orderActions(o, refundable) {
  const acts = [];
  const before = ["placed", "paid"].includes(o.status);
  if (D.can("advance_order")) {
    const next = { placed: "packed", paid: "packed", packed: "dispatched", part_dispatched: "dispatched", dispatched: "delivered" }[o.status];
    if (next) acts.push(["advance", `Mark as ${next === "dispatched" ? "sent" : next}`, next, "primary"]);
  }
  if (D.can("settle_pay_later") && ["due", "overdue"].includes(o.payment.status)) acts.push(["settle", "Mark the pay-later as paid"]);
  if (D.can("update_order") && before) acts.push(["address", "Change the address"]);
  if (D.can("issue_refund") && refundable > 0 && o.payment.status !== "declined") acts.push(["refund", "Give money back"]);
  if (D.can("cancel_order") && before) acts.push(["cancel", "Cancel the order", "", "danger"]);
  if (!acts.length) return `<p class="od-sub">${o.status === "cancelled" ? "This order is closed." : "Nothing to do here."}</p>`;
  return `<div class="acts">${acts.map(([id, label, extra, cls]) => `<button class="btn small ${cls || ""}" data-act="${id}" ${extra ? `data-to="${extra}"` : ""}>${esc(label)}</button>`).join("")}</div>`;
}

function wireOrderActions(over, o, refundable) {
  const body = over.el.querySelector(".over-body");
  const slot = body.querySelector("#act-form");
  const saidEl = body.querySelector(".said");
  // Feedback sits beside the buttons that were pressed; on failure the order is left as it was.
  const done = async (r, said) => {
    if (!r.ok) { saidEl.className = "said bad"; saidEl.textContent = r.error.message; return; }
    await fillOrder(over, o.number, { said: { text: said, tone: "good" } });
    load({ catalogue: true }).then(draw);
  };
  const form = (fields, submit, label) => {
    slot.innerHTML = `<form class="act">${fields}<div class="act-row"><button class="btn primary small" type="submit">${esc(label)}</button><button class="btn ghost small" type="button" data-cancel>Not now</button></div></form>`;
    wireForm(slot, submit);
  };
  body.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
    const act = b.dataset.act;
    const name = plainRef(o.number);
    if (act === "cancel") {
      form(`<label class="field"><span>Why</span><input class="input" name="reason" required value="Asked for by the customer"></label>`,
        async (f) => done(await world.call("cancel_order", { order_number: o.number, reason: f.get("reason") }), `${name} is cancelled and the money is on its way back.`), "Cancel it");
    }
    if (act === "address") {
      const a = o.delivery.address;
      form(`<div class="act-grid"><label class="field"><span>Street</span><input class="input" name="line1" required value="${esc(a.line1)}"></label>
        <label class="field"><span>Town</span><input class="input" name="town" required value="${esc(a.town)}"></label>
        <label class="field"><span>Postcode</span><input class="input" name="postcode" required value="${esc(a.postcode)}"></label></div>`,
      async (f) => done(await world.call("update_order", { order_number: o.number, address: { line1: f.get("line1"), town: f.get("town"), postcode: f.get("postcode") } }), "The parcel will go to the new address."), "Save the address");
    }
    if (act === "refund") {
      form(`<div class="act-grid"><label class="field"><span>How much (up to ${esc(money2(refundable))})</span><input class="input" name="amount" type="number" step="0.01" min="0.01" max="${refundable}" required value="${refundable}"></label>
        <label class="field"><span>Why</span><input class="input" name="reason" required placeholder="What went wrong"></label></div>`,
      async (f) => done(await world.call("issue_refund", { order_number: o.number, amount: Number(f.get("amount")), reason: f.get("reason") }), `${money2(Number(f.get("amount")))} is going back to the customer.`), "Give it back");
    }
    if (act === "advance") {
      b.disabled = true;
      (async () => done(await world.call("advance_order", { order_number: o.number, to: b.dataset.to }), `${name} is ${b.textContent.replace(/^Mark as /, "").toLowerCase()}.`))();
    }
    if (act === "settle") {
      b.disabled = true;
      (async () => done(await world.call("settle_pay_later", { order_number: o.number }), "Marked as paid."))();
    }
  }));
}

function wireForm(slot, submit) {
  const f = slot.querySelector("form");
  f.querySelector("input:not([type=radio]), select")?.focus();
  f.querySelector("[data-cancel]")?.addEventListener("click", () => { slot.innerHTML = ""; });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    await submit(new FormData(f));
    if (btn.isConnected) btn.disabled = false;
  });
}

// ------------------------------------------------------------------ products

function priceText(items) {
  const ps = items.map((v) => v.price).filter((x) => typeof x === "number");
  if (!ps.length) return "–";
  const lo = Math.min(...ps), hi = Math.max(...ps);
  return lo === hi ? money2(lo) : `${money2(lo)} to ${money2(hi)}`;
}

function stockText(p) {
  if (p.madeToOrder) return "Made for each order";
  const n = p.variants.reduce((s, v) => s + (v.stock || 0), 0);
  const empty = p.variants.filter((v) => v.stock === 0).length;
  return n ? `${num(n)} on the shelf${empty ? `, ${plural(empty, "version")} empty` : ""}` : "Shelf empty";
}

/** "Price up 10% on 23 Nov": the last change to any of the product's own prices, by anyone, in plain grey text. */
function changeLine(p) {
  const c = D.lastChange(p);
  if (!c) return "";
  const pct = Math.round((c.new_price / c.old_price - 1) * 100);
  return `Price ${pct >= 0 ? "up" : "down"} ${Math.abs(pct)}% on ${dayLabel(c.date)}${c.date.slice(0, 4) !== S.now.slice(0, 4) ? ` ${c.date.slice(0, 4)}` : ""}`;
}

function drawProducts(view) {
  view.innerHTML = `
    <div class="v-wrap">
      <section class="bulk" id="bulk-card">
        <div class="bulk-text"><h2 class="t-h">Change every price</h2><p>Try new prices across the shop. Then move time on and open a product to see what changed.</p></div>
        <form class="bulk-form" id="bulk">
          <div class="chips" role="group" aria-label="Quick choices">${[-10, -5, 5, 10].map((n) => `<button class="pm-chip" type="button" data-pct="${n}" aria-pressed="${(S.bulkPct ?? 10) === n}">${n > 0 ? "+" : "−"}${Math.abs(n)}%</button>`).join("")}</div>
          <label class="bulk-pct"><input class="input" name="pct" type="number" step="1" min="-90" max="200" value="${S.bulkPct ?? 10}" aria-label="Percent"><span>%</span></label>
          <input class="input bulk-why" name="reason" required placeholder="Why, in a few words" aria-label="Why">
          <button class="btn primary" type="submit">Change prices</button>
          <p class="said ${S.bulkSaid?.tone || ""}" aria-live="polite">${esc(S.bulkSaid?.text || "")}</p>
        </form>
      </section>
      <div class="pgrid" id="pgrid">${D.products.map((p) => `<button class="pcard${p.status !== "active" ? " is-off" : ""}" data-product="${esc(p.id)}">
        <span class="pcard-pic" style="--sweep:${esc(p.sweep)}"><img src="${esc(p.picture)}" alt="" loading="lazy"></span>
        <span class="pcard-body">
          <span class="pcard-top"><b class="pcard-name">${esc(p.name)}</b><span class="pcard-price">${esc(priceText(p.variants))}</span></span>
          <span class="pcard-sub">${p.status !== "active" ? `${esc(PRODUCT_STATUS[p.status] || words(p.status))} · ` : ""}${esc(stockText(p))}</span>
          ${changeLine(p) ? `<span class="pcard-change">${esc(changeLine(p))}</span>` : ""}
        </span>
      </button>`).join("") || emptyState({ title: "No products could be read." })}</div>
    </div>`;
  wireBulk(view);
}

/** Every price in the shop moved by the same percent, one change_price each, counting beside the button. */
function wireBulk(view) {
  const f = view.querySelector("#bulk");
  if (!f) return;
  // WHY looked up each time: time moving on redraws the view while prices are still changing.
  const say = (text, tone = "") => {
    S.bulkSaid = { text, tone };
    const el = main.querySelector("#bulk .said");
    if (el) { el.className = `said ${tone}`; el.textContent = text; }
  };
  if (S.bulkBusy) f.querySelector("[type=submit]").disabled = true;
  f.querySelectorAll("[data-pct]").forEach((b) => b.addEventListener("click", () => {
    f.pct.value = b.dataset.pct;
    S.bulkPct = Number(b.dataset.pct);
    f.querySelectorAll("[data-pct]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pct = Number(f.pct.value);
    if (!pct) { say("Pick a percent first."); return; }
    S.bulkPct = pct;
    const items = D.products.filter((p) => p.status === "active").flatMap((p) => [...p.variants, ...p.accessories]);
    const btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    S.bulkBusy = true;
    let done = 0;
    let failed = null;
    for (const v of items) {
      const to = Math.max(0.5, Math.round(v.price * (1 + pct / 100) * 100) / 100);
      const r = await world.call("change_price", { sku: v.sku, new_price: to, reason: f.reason.value });
      if (r.ok) { done++; D.noteActivity([{ tool: "change_price", ok: true, result: r.data }]); } else failed = r.error.message;
      say(`Changed ${done} of ${items.length} prices…`);
    }
    await Promise.all([D.loadCatalogue(), D.loadPriceChanges()]);
    S.bulkBusy = false;
    say(failed && !done ? failed : `Every price is ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}%. Move time on to see what it does.`, failed && !done ? "bad" : "good");
    draw();
  });
}

async function openProduct(id) {
  const p0 = D.products.find((x) => x.id === id);
  const over = slideOver({ title: p0?.name || "Product", body: skeleton(6), wide: true });
  S.panel = { kind: "product", id, over, redraw: () => fillProduct(over, id) };
  over.el.addEventListener("click", (e) => { if (e.target.closest("[data-close], .over-back")) closedPanel(); });
  document.addEventListener("keydown", function esc1(e) { if (e.key === "Escape") { closedPanel(); document.removeEventListener("keydown", esc1); } });
  await fillProduct(over, id);
}

async function fillProduct(over, id, { ticked } = {}) {
  const body = over.el.querySelector(".over-body");
  const r = await D.reloadProduct(id);
  if (!r.ok) { body.innerHTML = emptyState({ title: "That product could not be opened.", text: r.error?.message || "" }); return; }
  const p = r.product;
  if (S.panel?.over === over) { ticked ||= S.panel.ticked; S.panel.ticked = ticked; }
  over.el.querySelector(".over-head h2").textContent = p.name;
  const canPrice = D.can("change_price");
  const row = (v) => `<li class="var${ticked?.sku === v.sku ? " is-changed" : ""}" data-sku="${esc(v.sku)}" data-pic="${esc(v.picture || p.picture)}">
      ${pic(v.picture || p.picture, p.sweep, 44)}
      <span class="grow"><b>${esc(v.name)}</b><small>${p.madeToOrder ? "made for each order" : v.stock === 0 ? `shelf empty${v.restock_date ? `, back ${esc(dayLabel(v.restock_date))}` : ""}` : `${esc(num(v.stock))} on the shelf`}</small></span>
      <span class="num var-price">${esc(money2(v.price))}</span>
      ${canPrice ? `<button class="btn small" data-price="${esc(v.sku)}">Change</button>` : ""}
    </li>`;
  const history = D.changesTo(p);
  body.innerHTML = `
    <figure class="ph" style="--sweep:${esc(p.sweep)}"><img id="ph-img" src="${esc(p.picture)}" alt="${esc(p.name)}"></figure>
    <p class="ph-tag">${esc(p.tagline)}</p>
    <p class="od-sub">${esc(PRODUCT_STATUS[p.status] || words(p.status))} · ${esc(words(p.category))}${warrantyText(p.warranty)}</p>
    <p class="ph-sum">${esc(p.summary)}</p>
    <section class="od-sect"><h3 class="od-h">${p.variants.length > 1 ? "Versions and prices" : "Price"}</h3>
      <ul class="od-rows vars">${p.variants.map(row).join("")}</ul>
      ${ticked ? `<p class="said good" role="status">${esc(ticked.said)}</p>` : ""}
      <div class="act-form" id="price-form"></div>
    </section>
    ${p.accessories.length ? `<section class="od-sect"><h3 class="od-h">Goes with it</h3><ul class="od-rows vars">${p.accessories.map(row).join("")}</ul></section>` : ""}
    <section class="od-sect"><h3 class="od-h">How it sells</h3><div id="effect">${skeleton(2)}</div></section>
    <section class="od-sect"><h3 class="od-h">Price changes</h3>
      ${history.length ? `<ul class="od-rows">${history.slice(0, 8).map((c) => `<li><time>${esc(dayLabel(c.date))}${c.date.slice(0, 4) !== S.now.slice(0, 4) ? ` ${esc(c.date.slice(0, 4))}` : ""}</time><span class="grow"><b>${esc(money2(c.old_price))} to ${esc(money2(c.new_price))}</b><small>${esc(plainText(c.reason || ""))}</small></span></li>`).join("")}</ul>` : `<p class="od-sub">The price has never changed.</p>`}
    </section>
    <section class="od-sect"><h3 class="od-h">On sale or not</h3>${lifecycle(p)}<div class="act-form" id="life-form"></div></section>`;
  // Pointing at a version shows its own picture, when it has one.
  const img = body.querySelector("#ph-img");
  body.querySelectorAll(".var").forEach((li) => li.addEventListener("pointerenter", () => { if (img.getAttribute("src") !== li.dataset.pic) img.src = li.dataset.pic; }));
  body.querySelectorAll("[data-price]").forEach((b) => b.addEventListener("click", () => priceForm(over, p, b.dataset.price)));
  wireLifecycle(over, p);
  drawEffect(body.querySelector("#effect"), p);
}

/**
 * What the last price change did: things sold a day and money a day, before against since. Before is the two
 * weeks up to the change; since is every full day after it. With no recent change, the last four weeks.
 * Bars: grey before the change, ink after it, the spark on the day it changed.
 */
async function drawEffect(el, p) {
  if (p.madeToOrder && !p.variants.length) return;
  const by = await D.unitsByDay(p);
  if (!el.isConnected) return;
  const today = S.now.slice(0, 10);
  const from = addDays(today, -27);
  const last = D.lastChange(p);
  const c = last && last.date >= addDays(today, -60) ? last : null;
  const days = Array.from({ length: 28 }, (_, i) => addDays(from, i));
  const hi = Math.max(1, ...days.map((d) => by.get(d) || 0));
  const bars = `<div class="ubars" role="img" aria-label="Things sold each day, last four weeks">${days.map((d) => `<i class="${c && d >= c.date ? "is-after" : ""}${c && d === c.date ? " is-mark" : ""}" style="--h:${((by.get(d) || 0) / hi) * 100}%" title="${esc(dayLabel(d, true))}: ${esc(num(by.get(d) || 0))} sold"></i>`).join("")}</div>`;
  if (!c) {
    const n = days.reduce((t, d) => t + (by.get(d) || 0), 0);
    el.innerHTML = `${bars}<p class="od-sub">${esc(num(n))} sold in the last four weeks. Change a price above, move time on, and the difference shows here.</p>`;
    return;
  }
  const avg = (list) => (list.length ? list.reduce((t, d) => t + (by.get(d) || 0), 0) / list.length : 0);
  const before = Array.from({ length: 14 }, (_, i) => addDays(c.date, i - 14));
  const after = [];
  for (let d = c.date; d < today; d = addDays(d, 1)) after.push(d);
  const b = avg(before), a = avg(after);
  const change = b ? Math.round((a / b - 1) * 100) : null;
  const fig = (label, n, price) => `<div><span class="t-label">${esc(label)}</span><b class="fig-num">${esc(n.toFixed(1))}</b><span class="od-sub">sold a day · ${esc(money(n * price))} a day</span></div>`;
  el.innerHTML = `<p class="od-sub">The price went from ${esc(money2(c.old_price))} to ${esc(money2(c.new_price))} on ${esc(dayLabel(c.date, true))}.</p>
    ${bars}
    ${after.length ? `<div class="effect">${fig("Two weeks before", b, c.old_price)}${fig(`Since, ${plural(after.length, "day")}`, a, c.new_price)}
      ${change == null ? "" : `<div><span class="t-label">Difference</span><b class="fig-num ${change >= 0 ? "is-good" : "is-bad"}">${change >= 0 ? "+" : "−"}${Math.abs(change)}%</b><span class="od-sub">things sold a day</span></div>`}</div>`
      : `<p class="od-sub">Move time on to see what it does.</p>`}`;
}

/** The record keeps the warranty as months, or as an object with months in it. */
function warrantyText(w) {
  const m = typeof w === "number" ? w : w?.months;
  return m ? ` · ${esc(plural(m, "month"))} warranty` : "";
}

function lifecycle(p) {
  const canStop = D.can("discontinue_product"), canLaunch = D.can("launch_product");
  const said = p.status === "active" ? "On sale now." : p.status === "coming_soon" ? `Goes on sale ${esc(dayLabel(p.available_from, true))}.` : p.status === "discontinued" ? "No longer sold." : "Not on sale yet.";
  if (p.status === "active") return `<p class="od-sub">${said}</p>${canStop ? `<div class="acts"><button class="btn small danger" data-life="stop">Stop selling it</button></div>` : ""}`;
  return `<p class="od-sub">${said}</p>${canLaunch ? `<div class="acts"><button class="btn small primary" data-life="launch">Put it on sale</button></div>` : ""}`;
}

function wireLifecycle(over, p) {
  const body = over.el.querySelector(".over-body");
  const slot = body.querySelector("#life-form");
  const fail = (r) => { slot.insertAdjacentHTML("beforeend", `<p class="said bad">${esc(r.error.message)}</p>`); };
  body.querySelector("[data-life=stop]")?.addEventListener("click", () => {
    slot.innerHTML = `<form class="act">
      <fieldset class="radios"><legend>What happens to the shelf</legend>
        <label><input type="radio" name="stock" value="sell_through" checked> Sell what is left</label>
        <label><input type="radio" name="stock" value="write_off"> Write it off now</label></fieldset>
      <label class="field"><span>Why</span><input class="input" name="reason" placeholder="A sentence for the record"></label>
      <div class="act-row"><button class="btn small danger" type="submit">Stop selling ${esc(p.name)}</button><button class="btn small ghost" type="button" data-cancel>Not now</button></div></form>`;
    wireForm(slot, async (f) => {
      const r = await world.call("discontinue_product", { product_id: p.id, stock: f.get("stock"), reason: f.get("reason") || "" });
      if (!r.ok) return fail(r);
      toast(`${p.name} is no longer sold.${r.data.written_off?.length ? ` ${plural(r.data.written_off.reduce((n, x) => n + x.qty, 0), "thing")} written off.` : ""}`, { tone: "good" });
      await fillProduct(over, p.id);
      afterProductChange();
    });
  });
  body.querySelector("[data-life=launch]")?.addEventListener("click", () => {
    slot.innerHTML = `<form class="act"><label class="field"><span>From</span><input class="input" type="date" name="from" value="${esc(S.now.slice(0, 10))}" min="${esc(S.now.slice(0, 10))}" required></label>
      <div class="act-row"><button class="btn small primary" type="submit">Put it on sale</button><button class="btn small ghost" type="button" data-cancel>Not now</button></div></form>`;
    wireForm(slot, async (f) => {
      const r = await world.call("launch_product", { product_id: p.id, from: f.get("from") });
      if (!r.ok) return fail(r);
      toast(r.data.status === "active" ? `${p.name} is on sale.` : `${p.name} goes on sale ${dayLabel(r.data.available_from, true)}.`, { tone: "good" });
      await fillProduct(over, p.id);
      afterProductChange();
    });
  });
}

/** The price editor, opened in place under the version: a number to nudge, a reason, then change_price. */
function priceForm(over, p, sku) {
  const item = [...p.variants, ...p.accessories].find((v) => v.sku === sku);
  const slot = over.el.querySelector("#price-form");
  over.el.querySelector(`[data-sku="${CSS.escape(sku)}"]`)?.after(slot);
  slot.innerHTML = `<form class="act price-edit">
    <div class="nudge">
      <button class="btn small icon-only" type="button" data-step="-1" aria-label="A pound less">−</button>
      <label class="nudge-num"><span>£</span><input name="price" type="number" step="0.01" min="0.01" value="${esc(item.price)}" aria-label="New price" required></label>
      <button class="btn small icon-only" type="button" data-step="1" aria-label="A pound more">+</button>
      <span class="nudge-diff" aria-live="polite"></span>
    </div>
    <label class="field"><span>Why</span><input class="input" name="reason" required placeholder="For the price history"></label>
    <div class="act-row"><button class="btn small primary" type="submit">Change the price</button><button class="btn small ghost" type="button" data-cancel>Not now</button></div>
  </form>`;
  const input = slot.querySelector("[name=price]");
  const diff = slot.querySelector(".nudge-diff");
  const show = () => {
    const d = Math.round((Number(input.value) - item.price) * 100) / 100;
    diff.textContent = !d ? `Now ${money2(item.price)}.` : `${d > 0 ? "Up" : "Down"} ${money2(Math.abs(d))}, ${Math.round((Math.abs(d) / item.price) * 100)}%.`;
  };
  slot.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
    input.value = String(Math.max(0.01, Math.round((Number(input.value) + Number(b.dataset.step)) * 100) / 100));
    show();
  }));
  input.addEventListener("input", show);
  show();
  wireForm(slot, async (f) => {
    const to = Number(f.get("price"));
    const r = await world.call("change_price", { sku, new_price: to, reason: f.get("reason") });
    if (!r.ok) { diff.textContent = r.error.message; diff.classList.add("is-bad"); return; }
    D.noteActivity([{ tool: "change_price", ok: true, result: r.data }]);
    const said = `${item.accessory ? item.name : p.variants.length > 1 ? `${p.name}, ${item.name},` : p.name} is ${money2(r.data.new_price)} from ${dayLabel(r.data.date, true)}.`;
    await fillProduct(over, p.id, { ticked: { sku, said } });
    afterProductChange();
  });
  input.select();
}

function afterProductChange() {
  if (S.view === "products" || S.view === "today") draw();
}

// ------------------------------------------------------------------ discounts and payments

async function drawMoney(view) {
  view.innerHTML = `
    <div class="v-wrap">
      <section class="sect first"><h2 class="t-h">Discount codes</h2><div id="codes">${skeleton(3)}</div></section>
      <section class="sect"><div class="sect-head"><h2 class="t-h">Owed on pay later</h2><span class="t-label" id="owed-sum"></span></div><div id="owed">${skeleton(2)}</div></section>
      <div class="t-cols">
        <section class="sect"><h2 class="t-h">How the last ${esc(num(D.windowDays))} days were paid</h2><div id="paid"></div></section>
        <section class="sect"><h2 class="t-h">Ways to pay</h2><div id="ways">${skeleton(3)}</div></section>
      </div>
    </div>`;
  drawPaid(view.querySelector("#paid"));
  const [camp, ways, owed] = await Promise.all([
    D.can("list_campaigns") ? D.read("list_campaigns") : null,
    D.read("payment_methods"),
    D.can("list_pay_later") ? D.read("list_pay_later") : null,
  ]);
  if (S.view !== "money") return;
  const codes = view.querySelector("#codes");
  if (!camp?.ok) codes.innerHTML = emptyState({ title: "The codes did not load.", text: "Try again in a moment." });
  else {
    const today = S.now.slice(0, 10);
    const list = camp.data.campaigns.filter((c) => c.code).sort((a, b) => b.start.localeCompare(a.start));
    const state = (c) => (c.start > today ? `Starts ${dayLabel(c.start)}` : c.end < today ? "Ended" : "Running");
    const yr = (d) => (d.slice(0, 4) !== today.slice(0, 4) ? ` ${d.slice(0, 4)}` : "");
    codes.innerHTML = list.length ? `<table class="tbl">
      <thead><tr><th>Code</th><th>Campaign</th><th class="r">Off</th><th>Runs</th><th class="r">Orders</th><th>State</th></tr></thead>
      <tbody>${list.slice(0, 12).map((c) => `<tr><td class="mono">${esc(c.code)}</td><td>${esc(c.name)}</td><td class="r">${esc(c.discount_pct)}%</td>
        <td class="mono">${esc(dayLabel(c.start))}${esc(yr(c.start))} to ${esc(dayLabel(c.end))}${esc(yr(c.end))}</td><td class="r">${esc(num(c.orders_attributed || 0))}</td><td class="${state(c) === "Running" ? "w5" : "muted"}">${esc(state(c))}</td></tr>`).join("")}</tbody></table>`
      : emptyState({ title: "No discount codes.", text: "Everyone pays the price on the label." });
  }
  const w = view.querySelector("#ways");
  w.innerHTML = ways.ok ? `<ul class="od-rows">${ways.data.methods.map((m) => `<li><span class="grow"><b>${esc(m.name)}</b><small>${esc(m.explain || "")}</small></span><span class="${m.available === false ? "muted" : "w5"}">${m.available === false ? "Off" : "On"}</span></li>`).join("")}</ul>` : emptyState({ title: "Could not read the ways to pay.", text: ways.error.message });
  drawOwed(view, owed);
}

/** Orders still owed on pay later (list_pay_later), oldest due first, each with a button to mark it paid. */
function drawOwed(view, owed) {
  const el = view.querySelector("#owed");
  const sum = view.querySelector("#owed-sum");
  if (!owed?.ok) { el.innerHTML = emptyState({ title: "Could not read what is owed." }); return; }
  sum.textContent = owed.data.total ? `${money2(owed.data.owed_total)} on ${plural(owed.data.total, "order")}` : "";
  if (!owed.data.orders.length) { el.innerHTML = '<p class="od-sub">Nobody owes anything on pay later.</p>'; return; }
  el.innerHTML = `<table class="tbl">
    <thead><tr><th>Order</th><th>Customer</th><th>Due</th><th class="r">Owed</th><th></th></tr></thead>
    <tbody>${owed.data.orders.map((o) => `<tr data-row="${esc(o.order_number)}"><td class="mono">${esc(plainRef(o.order_number))}</td><td>${esc(o.customer_name || "")}</td>
      <td class="mono">${esc(dayLabel(o.due_date))}${o.days_overdue ? ` <span class="pill bad">${esc(plural(o.days_overdue, "day"))} late</span>` : ""}</td><td class="r">${esc(money2(o.amount_owed ?? o.owed ?? 0))}</td>
      <td class="r">${D.can("settle_pay_later") ? `<button class="btn small" data-settle="${esc(o.order_number)}">Mark as paid</button>` : ""}</td></tr>`).join("")}</tbody></table>`;
  el.querySelectorAll("[data-settle]").forEach((b) => b.addEventListener("click", async () => {
    // Changed on screen first; put back with the reason if the business says no.
    const cell = b.parentElement;
    cell.innerHTML = '<span class="w5">Paid</span>';
    const r = await world.call("settle_pay_later", { order_number: b.dataset.settle });
    if (!r.ok) { cell.innerHTML = `<span class="said bad">${esc(r.error.message)}</span>`; return; }
    load({ catalogue: false }).then(() => { if (S.view === "money") draw(); });
  }));
}

function drawPaid(el) {
  const by = new Map();
  for (const o of S.list) by.set(o.payment.status, (by.get(o.payment.status) || 0) + 1);
  const total = S.list.length || 1;
  const parts = [...by.entries()].sort((a, b) => b[1] - a[1]);
  const taken = S.list.filter((o) => o.payment.status !== "declined").reduce((n, o) => n + o.totals.total, 0);
  const back = S.list.reduce((n, o) => n + (o.payment.refunded || 0), 0);
  el.innerHTML = parts.length ? `<ul class="od-rows">
    <li><span class="grow"><b>Taken</b></span><span class="num w5">${esc(money(taken))}</span></li>
    <li><span class="grow"><b>Given back</b></span><span class="num w5">${esc(money(back))}</span></li>
    ${parts.map(([k, n]) => `<li><span class="grow">${esc(PAY[k] || words(k))}</span><span class="num muted">${esc(Math.round((n / total) * 100))}%</span><span class="num">${esc(plural(n, "order"))}</span></li>`).join("")}
  </ul>` : emptyState({ title: "No orders in this window." });
}

// ------------------------------------------------------------------ deliveries

function drawDeliveries(view) {
  const parcels = S.list.flatMap((o) => (o.shipments || []).filter((s) => s.status !== "cancelled").map((s) => ({ o, s })));
  const lanes = [
    { id: "wait", title: "Waiting to go", items: parcels.filter(({ s }) => ["pending", "packed"].includes(s.status) || (!s.dispatched_at && !["delivered", "lost"].includes(s.status))) },
    { id: "road", title: "On the road", items: parcels.filter(({ s }) => s.dispatched_at && !s.delivered_at && s.status !== "lost").sort((a, b) => isLate(b.s) - isLate(a.s)) },
    { id: "done", title: "Arrived", items: parcels.filter(({ s }) => s.delivered_at).sort((a, b) => b.s.delivered_at.localeCompare(a.s.delivered_at)) },
    { id: "lost", title: "Lost", items: parcels.filter(({ s }) => s.status === "lost") },
  ].filter((l) => l.id !== "lost" || l.items.length);
  view.innerHTML = `
    <div class="v-wrap is-wide">
      <p class="t-label lanes-note">Every parcel from the last ${esc(num(D.windowDays))} days, from the shelf to the doorstep.</p>
      <div class="lanes">${lanes.map((l) => `<section class="lane">
        <h2 class="lane-head"><span>${esc(l.title)}</span><span class="t-label">${esc(num(l.items.length))}</span></h2>
        <ul class="lane-list">${l.items.slice(0, 30).map(parcelCard).join("") || `<li class="lane-empty">Nothing here.</li>`}</ul>
        ${l.items.length > 30 ? `<p class="lane-more">and ${esc(num(l.items.length - 30))} more</p>` : ""}
      </section>`).join("")}</div>
    </div>`;
}

function parcelCard({ o, s }) {
  const lateBy = isLate(s) ? Math.max(1, daysBetween(s.eta, S.now)) : 0;
  return `<li><button class="parcel" data-order="${esc(o.number)}">
    <span class="parcel-top">${s.skus.slice(0, 2).map((k) => thumb(k, 32)).join("")}<b>${esc(plainRef(o.number))}</b>${lateBy ? `<span class="pill bad">${esc(plural(lateBy, "day"))} late</span>` : ""}</span>
    <span class="parcel-sub">${esc(o.delivery.address.town)}${s.carrier ? ` · ${esc(s.carrier)}` : ""} · ${s.delivered_at ? `arrived ${esc(when(s.delivered_at))}` : s.eta ? `due ${esc(dayLabel(s.eta))}` : esc(shipWords(s.status).toLowerCase())}</span>
  </button></li>`;
}

// ------------------------------------------------------------------ routing, keyboard, staying live

async function route() {
  const h = location.hash.replace(/^#/, "");
  const [path, query] = h.split("?");
  const [view, id] = path.split("/");
  const was = S.view;
  S.view = VIEWS.some((v) => v.id === view) ? view : "today";
  const f = new URLSearchParams(query || "").get("f");
  if (f && FILTERS.some((x) => x.id === f)) S.page.filter = f;
  if (S.view === "orders" && (was !== "orders" || f || !S.page.rows.length)) { S.page.busy = true; draw(); await loadPage(); S.page.busy = false; }
  draw();
  if (was !== S.view) main.querySelector("#view").scrollTop = 0;
  if (S.view === "products" && /change/.test(query || "")) { main.querySelector("#bulk [name=pct]")?.focus(); history.replaceState(null, "", "#products"); }
  if (S.view === "orders" && id && S.panel?.id !== id) openOrder(decodeURIComponent(id));
  if (S.view === "products" && id && S.panel?.id !== id) openProduct(decodeURIComponent(id));
}

main.addEventListener("click", (e) => {
  const o = e.target.closest("[data-order]");
  if (o) { e.preventDefault(); history.replaceState(null, "", `#${S.view}`); openOrder(o.dataset.order); return; }
  const p = e.target.closest("[data-product]");
  if (p) { e.preventDefault(); history.replaceState(null, "", `#${S.view}`); openProduct(p.dataset.product); }
});

/**
 * The keyboard. Keys act only when you are not typing and nothing is open over the page.
 *   1 to 5: the five views   J or Down, K or Up: move through orders or products (Enter opens)
 *   /: search the orders   P: change prices
 */
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".over")) return;
  if (e.target.closest?.("input, textarea, select")) { if (e.key === "Escape") e.target.blur(); return; }
  const n = Number(e.key);
  if (n >= 1 && n <= VIEWS.length) { e.preventDefault(); location.hash = `#${VIEWS[n - 1].id}`; return; }
  if (e.key === "/") { e.preventDefault(); if (S.view !== "orders") location.hash = "#orders"; setTimeout(() => main.querySelector("#o-search")?.focus(), 60); return; }
  if (e.key === "p") { e.preventDefault(); location.hash = "#products?change"; return; }
  const down = e.key === "j" || e.key === "ArrowDown", up = e.key === "k" || e.key === "ArrowUp";
  if (!down && !up) return;
  const items = [...main.querySelectorAll("#view .o-row, #view .pcard, #view .parcel")];
  if (!items.length) return;
  e.preventDefault();
  const at = items.indexOf(document.activeElement);
  const next = items[at < 0 ? 0 : Math.max(0, Math.min(items.length - 1, at + (down ? 1 : -1)))];
  next.focus();
  next.scrollIntoView({ block: "nearest" });
});

/** A redraw that keeps an open form intact: the panel is only refreshed when nobody is typing in it. */
async function refresh({ catalogue = true } = {}) {
  await load({ catalogue });
  draw();
  if (S.panel && S.panel.over.el.isConnected && !S.panel.over.el.querySelector("form")) S.panel.redraw();
}

let pending = null;
function scheduleRefresh() {
  clearTimeout(pending);
  pending = setTimeout(() => refresh(), 400);
}

async function start() {
  shell();
  main.querySelector("#view").innerHTML = `<div class="v-wrap">${skeleton(6)}</div>`;
  await D.loadTools();
  await load();
  await route();
}

await start();
window.addEventListener("hashchange", route);

document.addEventListener("ot:day", (e) => {
  if (e.detail?.now) S.now = e.detail.now;
  if (e.detail?.partial) return;  // a long run fires per step; read once it settles
  scheduleRefresh();
});
world.onChange((change) => {
  if (change.reset) { D.orders.clear(); S.known.clear(); S.page.rows = []; scheduleRefresh(); return; }
  if (change.source === "local") return;  // this page moved the clock; ot:day covers it
  if (change.now) S.now = change.now;
  D.noteActivity(change.entries);
  if (change.entries.some((e) => !isScreenRead(e))) scheduleRefresh();
});
