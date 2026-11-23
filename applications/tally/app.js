// Tally: the accounts. Cash in the bank, profit and loss by month and year, where the money goes, what is owed
// either way, what each product keeps, and the ledger itself, each in its own view (the old single page was
// 2,500px tall at one density). Every figure is read through the business's tools (business_snapshot,
// get_monthly_summary, check_books, ledger_search, list_purchase_orders, list_suppliers, list_pay_later,
// search_catalogue, get_product) and every action is a tool (add_ledger_correction, settle_pay_later), so a change
// made by anyone, or by an outside AI, shows here at once and again when time moves on.
//
// Address bar: #overview, #statement, #owed, #margins, #ledger.
import { startApp, esc, money, money2, num, plural, emptyState, skeleton, slideOver, toast, timeParts, shortDate, longDate } from "../lib/ui.js";
import { isScreenRead } from "../lib/client.js";
import { plainRef, plainText, rememberName } from "../lib/plain.js";
import { columns, area } from "../lib/chart.js";
import { openRecord } from "../lib/records.js";

const APP_ID = "tally";
const { world, app } = await startApp({ id: APP_ID });
document.title = `${app.name} · Overthought & Co.`;

/** Costs, in the words a person uses. */
const COSTS = [
  { key: "cost_of_goods", name: "The goods we sold" },
  { key: "wages", name: "Wages" },
  { key: "delivery_cost", name: "Postage and couriers" },
  { key: "refunds", name: "Refunds" },
  { key: "marketing_spend", name: "Marketing" },
  { key: "rent", name: "Rent" },
  { key: "payment_fee", name: "Card fees" },
  { key: "software", name: "Software" },
  { key: "goodwill_credit", name: "Goodwill credit" },
];

/** Ledger entry types, as a bookkeeper would say them. */
const TYPES = {
  sale: "Sale", delivery_income: "Delivery charged", cost_of_goods: "Goods we sold", payment_fee: "Card fee",
  delivery_cost: "Postage", refund: "Refund", supplier_payment: "Paid a supplier", wages: "Wages", rent: "Rent",
  software: "Software", marketing_spend: "Marketing", goodwill_credit: "Goodwill credit", pay_later: "Pay later",
  repair_income: "Repair", repair_parts: "Repair parts", correction: "Correction",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const ICONS = {
  overview: '<path d="M4 19V10M10 19V5M16 19v-7M21 19H3"/>',
  statement: '<path d="M6 3.5h12v17H6Z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
  owed: '<path d="M4 7.5h16v10H4Z"/><path d="M4 11h16"/><path d="M7.5 14.5h3"/>',
  margins: '<path d="M3.5 12.5v-8h8l9 9-8 8Z"/><circle cx="8" cy="8.5" r="1.4"/>',
  ledger: '<path d="M5 4.5h11.5a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2Z"/><path d="M5 17.5a2 2 0 0 1 2-2h11.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  tick: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
};

function ico(name, size = 18) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

const VIEWS = [
  { id: "overview", label: "Overview" },
  { id: "statement", label: "Profit and loss" },
  { id: "owed", label: "Owed and due" },
  { id: "margins", label: "What each thing keeps" },
  { id: "ledger", label: "Every pound in and out" },
];

const main = document.getElementById("main");

const S = {
  view: "overview",
  snapshot: null,
  months: [],
  books: null,
  bills: [],
  onTheWay: { total: 0, count: 0 },
  payLater: null,       // list_pay_later's answer
  products: null,
  marginKind: "product",
  chartTab: "profit",
  range: 12,
  period: { mode: "month", key: null },
  ledger: { anchor: null, type: "", ref: "", rows: [], count: 0, total: 0, capped: false },
  known: new Set(),
  freshAt: new Map(),  // ledger id -> when this screen first saw it, so a new line stays lit through a second redraw
  firstLedger: true,
  busy: false,
  again: false,
  failed: null,
};

// ------------------------------------------------------------------ helpers

/** A read that only draws the screen, so the record of actions leaves it out. */
function read(tool, input = {}) {
  return world.call(tool, input, { screen: true }).catch((e) => ({ ok: false, error: { code: "offline", message: e.message } }));
}

/** "2026-11" as "Nov", "Nov 26" or "November 2026". */
function monthName(key, style = "short") {
  const [y, m] = key.split("-").map(Number);
  if (style === "long") return `${MONTHS[m - 1]} ${y}`;
  if (style === "year") return `${MONTHS[m - 1].slice(0, 3)} ${String(y).slice(2)}`;
  return MONTHS[m - 1].slice(0, 3);
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysFrom(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
}

function pct(v) {
  return Number.isFinite(v) ? `${Math.round(v * 100)}%` : "–";
}

/** Signed money with a plus for gains: +£120, −£40. */
function signed(v, fmt = money) {
  return `${v > 0 ? "+" : ""}${fmt(v)}`;
}

function today() {
  return (S.snapshot?.as_of || new Date().toISOString()).slice(0, 10);
}

// ------------------------------------------------------------------ loading

/** Reads everything the views share. Each view draws from this; the ledger and margins read their own. */
async function load() {
  const [snap, summary, books, received, ordered, late, suppliers, campaigns, owed] = await Promise.all([
    read("business_snapshot"),
    read("get_monthly_summary"),
    read("check_books"),
    read("list_purchase_orders", { status: "received" }),
    read("list_purchase_orders", { status: "ordered" }),
    read("list_purchase_orders", { status: "late" }),
    read("list_suppliers"),
    read("list_campaigns"),
    read("list_pay_later"),
  ]);
  for (const x of suppliers.ok ? suppliers.data.suppliers : []) rememberName(x.id, x.name);
  for (const x of campaigns.ok ? campaigns.data.campaigns : []) rememberName(x.id, x.name);
  if (!snap.ok) return { refused: snap.error };
  S.snapshot = snap.data;
  S.months = summary.ok ? summary.data.months : [];
  S.books = books.ok ? books.data : null;
  const sup = new Map((suppliers.ok ? suppliers.data.suppliers : []).map((s) => [s.id, s]));
  S.suppliers = sup;
  S.bills = billsFrom(received.ok ? received.data.purchase_orders : [], sup);
  const coming = [...(ordered.ok ? ordered.data.purchase_orders : []), ...(late.ok ? late.data.purchase_orders : [])];
  S.onTheWay = { total: coming.reduce((n, p) => n + poValue(p, "qty"), 0), count: coming.length };
  // WHY list_pay_later: one call, oldest due first, with names and days overdue (it used to be pieced together from the ledger).
  S.payLater = owed.ok ? owed.data : null;
  return { refused: null };
}

/** A ledger reference in words: "Order 10671", "Purchase order 3221", a campaign's name, "Rent for November 2026". */
function refWords(ref) {
  const m = String(ref).match(/^([A-Z]+)-(\d{4})-(\d{2})$/);
  if (m) return `${m[1][0]}${m[1].slice(1).toLowerCase()} for ${monthName(`${m[2]}-${m[3]}`, "long")}`;
  return plainRef(ref) || "";
}

/** What a person typed, as the references it could mean: "10671" could be an order or a purchase order. */
function refsFor(text) {
  const t = String(text).trim();
  let m = t.match(/^(?:order\s*|#)?(\d+)$/i);
  if (m) return /^order/i.test(t) ? [`ORD-${m[1]}`] : [`ORD-${m[1]}`, `PO-${m[1]}`];
  m = t.match(/^(?:purchase\s*order|po)\s*-?\s*(\d+)$/i);
  if (m) return [`PO-${m[1]}`];
  return [t.toUpperCase().replace(/\s+/g, "-")];
}

/** What a purchase order is worth: received quantities for a bill, ordered ones for what is still coming. */
function poValue(po, field = "qty_received") {
  return po.lines.reduce((n, l) => n + (l[field] || 0) * l.unit_cost, 0);
}

/** Bills: delivered purchase orders not yet paid, each due on the supplier's terms after delivery. */
function billsFrom(pos, suppliers) {
  return pos.filter((p) => !p.paid_at && p.received_at).map((p) => {
    const s = suppliers.get(p.supplier_id);
    const due = addDays(p.received_at.slice(0, 10), s?.payment_terms_days ?? 30);
    return { number: p.number, supplier: s?.name || p.supplier_id, received: p.received_at.slice(0, 10), due, amount: poValue(p) };
  }).sort((a, b) => (a.due < b.due ? -1 : 1));
}

/** Prices from the catalogue and costs from the suppliers: what each thing keeps from its price. */
async function loadMargins() {
  const cat = await read("search_catalogue", { query: "ot" });
  if (!cat.ok || !S.suppliers?.size) { S.products = []; return; }
  const cost = {};
  for (const s of S.suppliers.values()) Object.assign(cost, s.unit_cost || {});
  const items = cat.data.results.filter((r) => r.kind === "product" || r.kind === "accessory");
  const full = await Promise.all(items.filter((r) => r.kind === "product").map((r) => read("get_product", { id: r.id })));
  const variants = new Map(full.filter((r) => r.ok).map((r) => [r.data.id, r.data.variants || []]));
  S.products = items.map((r) => {
    const lines = r.kind === "product"
      ? (variants.get(r.id) || []).filter((v) => Number.isFinite(v.price) && cost[v.sku] != null).map((v) => ({ price: v.price, cost: cost[v.sku], name: v.name }))
      : (cost[r.id] != null && Number.isFinite(r.price?.from) ? [{ price: r.price.from, cost: cost[r.id], name: r.name }] : []);
    if (!lines.length) return null;
    const ms = lines.map((l) => (l.price - l.cost) / l.price);
    const first = lines[0];
    return { id: r.id, kind: r.kind, name: r.name, price: first.price, cost: first.cost, lo: Math.min(...ms), hi: Math.max(...ms), margin: ms[0], variants: lines.length };
  }).filter(Boolean).sort((a, b) => b.margin - a.margin);
}

// ------------------------------------------------------------------ the shell

function shell() {
  main.innerHTML = `<div class="ws">
    <nav class="ws-rail" aria-label="${esc(app.name)}">
      <button class="btn primary ws-main-btn" id="corrBtn" title="Add a correction (C)">${ico("plus", 17)}<span>Add a correction</span></button>
      <ul class="rail-list">${VIEWS.map((v) => `<li><a class="rail-row" href="#${v.id}" data-view="${v.id}">${ico(v.id, 17)}<span class="rail-name">${esc(v.label)}</span><span class="rail-count" data-badge="${v.id}"></span></a></li>`).join("")}</ul>
      <div class="ta-books" id="books"></div>
    </nav>
    <section class="ws-view" id="view" tabindex="-1"></section>
  </div>`;
  main.querySelector("#corrBtn").addEventListener("click", () => openCorrection());
}

function markNav() {
  main.querySelectorAll(".rail-row").forEach((a) => {
    const on = a.dataset.view === S.view;
    a.classList.toggle("is-on", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  // The rail's only number: bills and pay-later orders past their date. Hidden at zero.
  const late = S.bills.filter((b) => b.due < today()).length + (S.payLater?.orders || []).filter((o) => o.days_overdue > 0).length;
  const b = main.querySelector('[data-badge="owed"]');
  if (b) b.textContent = late ? num(late) : "";
}

/** The books add up: a small tick and a line in the rail, not a stamp. Opens what was checked. */
function paintBooks() {
  const el = main.querySelector("#books");
  const b = S.books;
  if (!el) return;
  if (!b) { el.innerHTML = ""; return; }
  const ok = b.break_count === 0;
  el.innerHTML = `<button class="ta-books-btn${ok ? "" : " is-out"}" id="booksBtn">${ok ? ico("tick", 16) : '<span class="ta-bang">!</span>'}
    <span><b>${ok ? "The books add up" : `The books are out in ${esc(plural(b.break_count, "place"))}`}</b><small>${ok ? `${esc(num(b.checked?.ledger_entries))} lines, ${esc(plural(b.checked?.months ?? 0, "month"))}, checked just now` : "Open this to see where"}</small></span></button>`;
  el.querySelector("#booksBtn").addEventListener("click", openBooks);
}

/** What the check looked at, and anything that did not agree. */
function openBooks() {
  const b = S.books;
  const c = b.checked || {};
  const rows = [
    ["Products counted", num(c.skus)],
    ["Things that went in or out of stock", num(c.movements)],
    ["Orders checked against the money", num(c.orders)],
    ["Lines in the books", num(c.ledger_entries)],
    ["Months added up again", num(c.months)],
  ];
  slideOver({
    title: b.break_count ? "Where the books are out" : "The books add up",
    body: `<p class="t-lede">${b.break_count ? "These do not agree with the books. Each line says where." : "Every order, refund and month was checked against the money. Nothing is out."}</p>
      ${b.break_count ? `<ul class="od-rows">${b.breaks.map((x) => `<li><span class="pill bad">Out</span><span class="grow">${esc(plainText(typeof x === "string" ? x : JSON.stringify(x)))}</span></li>`).join("")}</ul>` : ""}
      <ul class="od-rows ta-checked">${rows.map(([k, v]) => `<li><span class="grow muted">${esc(k)}</span><span class="num">${esc(v)}</span></li>`).join("")}</ul>`,
  });
}

// ------------------------------------------------------------------ overview

function yearProfit(year) {
  return S.months.filter((m) => m.month.startsWith(year)).reduce((n, m) => n + m.profit, 0);
}

function drawOverview(view) {
  const s = S.snapshot;
  const year = today().slice(0, 4);
  const lastMonthEnd = S.months.filter((m) => m.month < s.month).at(-1);
  const sinceMonth = lastMonthEnd ? s.cash - lastMonthEnd.cash_at_month_end : null;
  const tm = s.this_month;
  const margin = tm.revenue ? tm.gross_margin / tm.revenue : null;
  const fig = (label, value, sub) => `<div class="fig"><dt>${esc(label)}</dt><dd>${esc(value)}</dd>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`;
  view.innerHTML = `<div class="v-wrap">
    <dl class="figs">
      ${fig("In the bank", money(s.cash), sinceMonth == null ? "" : `${signed(sinceMonth)} since ${shortDate(`${addDays(`${s.month}-01`, -1)}T00:00:00Z`)}`)}
      ${fig("Profit this month", money(tm.profit), `${money(tm.revenue)} taken from ${plural(tm.orders, "order")}`)}
      ${fig(`Profit in ${year}`, money(yearProfit(year)), `Since 1 January ${year}`)}
      ${fig("Kept from each £1 taken", margin == null ? "–" : `${Math.round(margin * 100)}p`, "This month, after the goods and refunds")}
    </dl>
    <section class="sect">
      <div class="sect-head">
        <div class="chips" role="group" aria-label="Chart">
          <button class="pm-chip" data-tab="profit" aria-pressed="${S.chartTab === "profit"}">Profit</button>
          <button class="pm-chip" data-tab="cash" aria-pressed="${S.chartTab === "cash"}">Cash in the bank</button>
        </div>
        <div class="chips" role="group" aria-label="How far back">
          ${[[12, "A year"], [36, "Three years"], [0, "Since we opened"]].map(([n, l]) => `<button class="pm-chip" data-range="${n}" aria-pressed="${S.range === n}">${l}</button>`).join("")}
        </div>
      </div>
      <h2 class="t-h ta-story" id="storyLine"></h2>
      <div id="story" class="ta-chart"></div>
      <p class="ta-key" id="storyKey"></p>
    </section>
    <section class="sect" id="where"></section>
  </div>`;
  view.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { S.chartTab = b.dataset.tab; draw(); }));
  view.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => { S.range = Number(b.dataset.range); draw(); }));
  paintStory(view);
  paintWhere(view.querySelector("#where"), periodMonths({ mode: "month", key: S.snapshot.month }).now, `${monthName(S.snapshot.month, "long")} so far`);
}

/** The one chart: takings (grey) and profit (ink, losses hang below in the bad colour), or the cash line. */
function paintStory(view) {
  const el = view.querySelector("#story");
  const all = S.months;
  const months = S.range ? all.slice(-S.range) : all;
  if (!months.length) { el.innerHTML = emptyState({ title: "No months on the books yet." }); return; }
  const labels = months.map((m) => m.month);
  const xFmt = (l, i, long) => (long ? monthName(l, "long") : l.endsWith("-01") || i === 0 ? monthName(l, "year") : monthName(l));
  if (S.chartTab === "profit") {
    columns(el, {
      title: "Takings and profit by month", labels, xFmt, fmt: money, height: 240,
      columns: [
        { name: "Taken", values: months.map((m) => m.revenue), color: "var(--x-rule)" },
        { name: "Profit", values: months.map((m) => m.profit), color: "var(--chart-you)", negColor: "var(--x-bad)" },
      ],
    });
    view.querySelector("#storyKey").innerHTML = `<span class="ch-key"><i class="is-light"></i>Taken</span><span class="ch-key"><i></i>Profit</span>`;
    view.querySelector("#storyLine").textContent = profitLine();
  } else {
    const s = S.snapshot;
    const past = months.filter((m) => m.month < s.month);
    area(el, {
      title: "Cash in the bank at the end of each month", height: 240,
      labels: [...past.map((m) => m.month), "now"],
      values: [...past.map((m) => m.cash_at_month_end), s.cash],
      xFmt: (l, i, long) => (l === "now" ? (long ? `Today, ${shortDate(s.as_of)}` : "Now") : xFmt(l, i, long)),
      fmt: money, name: "In the bank",
    });
    view.querySelector("#storyKey").innerHTML = `<span class="ch-key"><i></i>Cash at the end of each month, and today</span>`;
    view.querySelector("#storyLine").textContent = cashLine(past);
  }
}

/** The chart's headline, worked out from the months: this year so far against the same months last year. */
function profitLine() {
  const t = today();
  const year = Number(t.slice(0, 4));
  const upTo = t.slice(5, 7);
  const sum = (y) => S.months.filter((m) => m.month.startsWith(String(y)) && m.month.slice(5) <= upTo).reduce((n, m) => n + m.profit, 0);
  const now = sum(year);
  const before = sum(year - 1);
  const head = now >= 0 ? `${money(now)} profit so far this year` : `${money(-now)} lost so far this year`;
  if (!S.months.some((m) => m.month.startsWith(String(year - 1)))) return `${head}.`;
  if (before > 0 && now > 0) {
    const c = Math.round((now / before - 1) * 100);
    return `${head}, ${c === 0 ? "level with" : `${c > 0 ? "up" : "down"} ${Math.abs(c)}% on`} the same months of ${year - 1}.`;
  }
  return `${head}, against ${before >= 0 ? `${money(before)} profit` : `${money(-before)} lost`} in the same months of ${year - 1}.`;
}

function cashLine(past) {
  const s = S.snapshot;
  const first = past[0];
  if (!first) return `${money(s.cash)} in the bank today.`;
  const d = s.cash - first.cash_at_month_end;
  return `${money(s.cash)} in the bank today, ${d >= 0 ? `${money(d)} more` : `${money(-d)} less`} than at the end of ${monthName(first.month, "long")}.`;
}

/** Where the money went in some months: a sorted table, each row with a thin ink bar for its share. */
function paintWhere(el, months, when) {
  const t = totalOf(months);
  const parts = COSTS.map((c) => ({ ...c, value: c.key === "cost_of_goods" ? t.cost_of_goods : c.key === "refunds" ? t.refunds : t.ops[c.key] || 0 }))
    .filter((p) => p.value > 0.004).sort((a, b) => b.value - a.value);
  const total = parts.reduce((n, p) => n + p.value, 0);
  el.innerHTML = `<div class="sect-head"><h2 class="t-h">Where the money went</h2><span class="t-label">${esc(money(total))} in ${esc(when)}</span></div>
    ${total ? `<table class="tbl ta-where"><thead><tr><th>What</th><th class="r">Amount</th><th class="r">Share</th><th class="ta-bar-h"></th></tr></thead><tbody>
      ${parts.map((p) => `<tr><td>${esc(p.name)}</td><td class="r">${esc(money(p.value))}</td><td class="r muted">${esc(pct(p.value / total))}</td><td class="ta-bar"><span class="share" style="--w:${(p.value / parts[0].value).toFixed(3)}"><i></i></span></td></tr>`).join("")}
    </tbody></table>` : emptyState({ title: "Nothing went out." })}`;
}

// ------------------------------------------------------------------ profit and loss

/** The months a period covers, and the period before it, for comparison. */
function periodMonths(period) {
  if (period.mode === "month") {
    const i = S.months.findIndex((m) => m.month === period.key);
    return { now: i >= 0 ? [S.months[i]] : [], before: i > 0 ? [S.months[i - 1]] : [] };
  }
  return { now: S.months.filter((m) => m.month.startsWith(period.key)), before: S.months.filter((m) => m.month.startsWith(String(Number(period.key) - 1))) };
}

/** Adds up months into one set of figures. */
function totalOf(months) {
  const t = { sales: 0, delivery_income: 0, revenue: 0, refunds: 0, cost_of_goods: 0, gross_margin: 0, operating_costs_total: 0, profit: 0, orders: 0, ops: {} };
  for (const m of months) {
    for (const k of ["sales", "delivery_income", "revenue", "refunds", "cost_of_goods", "gross_margin", "operating_costs_total", "profit", "orders"]) t[k] += m[k] || 0;
    for (const [k, v] of Object.entries(m.operating_costs || {})) t.ops[k] = (t.ops[k] || 0) + v;
  }
  return t;
}

function periodName(p) {
  if (p.mode === "year") return p.key === today().slice(0, 4) ? `${p.key}, so far` : p.key;
  return p.key === S.snapshot.month ? `${monthName(p.key, "long")}, so far` : monthName(p.key, "long");
}

/** Moves the period on or back, staying inside the months the books hold. */
function stepPeriod(dir) {
  const p = S.period;
  if (p.mode === "month") {
    const i = S.months.findIndex((m) => m.month === p.key) + dir;
    if (i >= 0 && i < S.months.length) p.key = S.months[i].month;
  } else {
    const years = [...new Set(S.months.map((m) => m.month.slice(0, 4)))];
    const i = years.indexOf(p.key) + dir;
    if (i >= 0 && i < years.length) p.key = years[i];
  }
  draw();
}

/** The statement: label left, amount right, the change on the period before as one small grey figure. */
function drawStatement(view) {
  if (!S.months.length) { view.innerHTML = `<div class="v-wrap">${emptyState({ title: "No months on the books yet." })}</div>`; return; }
  S.period.key ||= S.snapshot.month;
  const { now, before } = periodMonths(S.period);
  const a = totalOf(now);
  const b = before.length ? totalOf(before) : null;
  const opRows = COSTS.filter((c) => !["cost_of_goods", "refunds"].includes(c.key)).map((c) => ({ label: c.name, k: (t) => -(t.ops[c.key] || 0), sub: true }));
  const rows = [
    { label: "Sales", k: (t) => t.sales, sub: true },
    { label: "Delivery charged", k: (t) => t.delivery_income, sub: true },
    { label: "Taken", k: (t) => t.revenue, total: true },
    { label: "Refunds", k: (t) => -t.refunds, sub: true },
    { label: "The goods we sold", k: (t) => -t.cost_of_goods, sub: true },
    { label: "Left after the goods", k: (t) => t.gross_margin, total: true, note: (t) => (t.revenue ? pct(t.gross_margin / t.revenue) : "") },
    ...opRows,
    { label: "Cost of running the shop", k: (t) => -t.operating_costs_total, total: true },
  ];
  const years = [...new Set(S.months.map((m) => m.month.slice(0, 4)))];
  const atStart = S.period.mode === "month" ? S.period.key === S.months[0].month : S.period.key === years[0];
  const atEnd = S.period.mode === "month" ? S.period.key === S.months.at(-1).month : S.period.key === years.at(-1);
  const change = (x, y) => {
    if (y == null || !Number.isFinite(y) || Math.abs(y) < 0.5) return "";
    const d = x - y;
    return Math.abs(d) < 0.5 ? "same" : signed(d);
  };
  const was = b ? (S.period.mode === "month" ? monthName(before[0].month, "long") : String(Number(S.period.key) - 1)) : "";
  view.innerHTML = `<div class="v-wrap">
    <div class="sect-head">
      <div class="ta-period">
        <button class="btn small icon-only ghost" data-step="-1" aria-label="Earlier" title="Earlier (left arrow)" ${atStart ? "disabled" : ""}>${ico("left", 16)}</button>
        <h2 class="t-h">${esc(periodName(S.period))}</h2>
        <button class="btn small icon-only ghost" data-step="1" aria-label="Later" title="Later (right arrow)" ${atEnd ? "disabled" : ""}>${ico("right", 16)}</button>
      </div>
      <div class="chips" role="group" aria-label="Month or year">
        <button class="pm-chip" data-mode="month" aria-pressed="${S.period.mode === "month"}">Month</button>
        <button class="pm-chip" data-mode="year" aria-pressed="${S.period.mode === "year"}">Year</button>
      </div>
    </div>
    <table class="tbl ta-st">
      <thead><tr><th></th><th class="r">${esc(periodName(S.period))}</th><th class="r">${b ? `Against ${esc(was)}` : ""}</th></tr></thead>
      <tbody>
        ${rows.map((r) => {
          const v = Math.abs(r.k(a)) < 0.005 ? 0 : r.k(a);
          if (r.sub && !v && !(b && r.k(b))) return "";
          return `<tr class="${r.total ? "is-total" : "is-sub"}"><th scope="row">${esc(r.label)}${r.note ? ` <span class="muted">${esc(r.note(a))}</span>` : ""}</th>
            <td class="r">${money(v)}</td><td class="r muted">${b ? esc(change(v, r.k(b))) : ""}</td></tr>`;
        }).join("")}
        <tr class="is-bottom"><th scope="row">${a.profit < 0 ? "Loss" : "Profit"}</th><td class="r ${a.profit < 0 ? "is-bad" : ""}">${money(a.profit)}</td><td class="r ${b && a.profit - b.profit < -0.5 ? "is-bad" : b && a.profit - b.profit > 0.5 ? "is-good" : "muted"}">${b ? esc(change(a.profit, b.profit)) : ""}</td></tr>
      </tbody>
    </table>
    <p class="t-label ta-foot">${esc(plural(a.orders, "order"))}${b ? `, against ${esc(plural(b.orders, "order"))} in ${esc(was)}` : ""}.</p>
    <section class="sect" id="where"></section>
  </div>`;
  view.querySelectorAll("[data-mode]").forEach((x) => x.addEventListener("click", () => {
    S.period = x.dataset.mode === "month" ? { mode: "month", key: S.snapshot.month } : { mode: "year", key: today().slice(0, 4) };
    draw();
  }));
  view.querySelectorAll("[data-step]").forEach((x) => x.addEventListener("click", () => stepPeriod(Number(x.dataset.step))));
  paintWhere(view.querySelector("#where"), now, periodName(S.period).replace(", so far", " so far"));
}

// ------------------------------------------------------------------ owed and due

/** A due date as a mono date; only a late one gets colour. */
function dueCell(due) {
  const d = daysFrom(today(), due);
  if (d < 0) return `<span class="is-bad">${esc(plural(-d, "day"))} late</span>`;
  return `<span class="mono">${d === 0 ? "Today" : esc(shortDate(`${due}T00:00:00Z`))}</span>`;
}

function drawOwed(view) {
  const owe = S.bills.reduce((n, b) => n + b.amount, 0);
  const pl = S.payLater;
  view.innerHTML = `<div class="v-wrap">
    <dl class="figs ta-owed-figs">
      <div class="fig"><dt>We owe suppliers</dt><dd>${esc(money(owe))}</dd><small>${S.bills.length ? `${esc(plural(S.bills.length, "bill"))} for goods we already have` : "Every delivery is paid for"}</small></div>
      <div class="fig"><dt>Still on its way</dt><dd>${esc(money(S.onTheWay.total))}</dd><small>${esc(plural(S.onTheWay.count, "purchase order"))}, paid once it arrives</small></div>
      <div class="fig"><dt>Customers owe us</dt><dd>${esc(money(pl?.owed_total || 0))}</dd><small>${pl?.total ? `${esc(plural(pl.total, "pay-later order"))}` : "Nobody owes the shop anything"}</small></div>
    </dl>
    <section class="sect"><h2 class="t-h">Bills from suppliers</h2>
      ${S.bills.length ? `<table class="tbl"><thead><tr><th>Supplier</th><th>Purchase order</th><th>Came</th><th>Due</th><th class="r">Amount</th></tr></thead><tbody>
        ${S.bills.map((b) => `<tr><td>${esc(b.supplier)}</td><td class="mono">${esc(plainRef(b.number))}</td><td class="mono">${esc(shortDate(`${b.received}T00:00:00Z`))}</td><td>${dueCell(b.due)}</td><td class="r">${esc(money2(b.amount))}</td></tr>`).join("")}
      </tbody></table>` : '<p class="od-sub">Every delivery is paid for.</p>'}
    </section>
    <section class="sect"><h2 class="t-h">Customers paying later</h2>
      ${pl?.orders?.length ? `<table class="tbl"><thead><tr><th>Order</th><th>Customer</th><th>Due</th><th class="r">Owed</th><th class="r"></th></tr></thead><tbody>
        ${pl.orders.map((o) => `<tr><td class="mono">${esc(plainRef(o.order_number))}</td><td>${esc(o.customer_name || "")}</td><td>${dueCell(o.due_date)}</td><td class="r">${esc(money2(o.owed))}</td>
          <td class="r"><button class="btn small" data-settle="${esc(o.order_number)}">Mark as paid</button></td></tr>`).join("")}
      </tbody></table>` : '<p class="od-sub">Nobody owes the shop anything on pay later.</p>'}
    </section>
  </div>`;
  view.querySelectorAll("[data-settle]").forEach((b) => b.addEventListener("click", () => settle(b)));
}

/** Records that a pay-later customer has paid: the row says so at once, and puts the button back if refused. */
async function settle(button) {
  const cell = button.parentElement;
  cell.innerHTML = '<span class="w5">Paid</span>';
  const r = await world.call("settle_pay_later", { order_number: button.dataset.settle });
  if (!r.ok) { cell.innerHTML = `<span class="said bad">${esc(r.error.message)}</span>`; return; }
  cell.innerHTML = `<span class="is-good">${esc(money2(r.data.paid))} came in</span>`;
  refresh();
}

// ------------------------------------------------------------------ what each thing keeps

/** A sorted table: price, cost and what is kept, with a thin ink bar for the share. */
function drawMargins(view) {
  if (S.products == null) {
    view.innerHTML = `<div class="v-wrap">${skeleton(6)}</div>`;
    loadMargins().then(() => { if (S.view === "margins") draw(); });
    return;
  }
  const list = S.products.filter((p) => p.kind === S.marginKind);
  view.innerHTML = `<div class="v-wrap">
    <div class="sect-head">
      <p class="t-lede">The price today against what the supplier charges us for one. Change a price in Till, then look again.</p>
      <div class="chips" role="group" aria-label="Products or add-ons">
        <button class="pm-chip" data-kind="product" aria-pressed="${S.marginKind === "product"}">Products</button>
        <button class="pm-chip" data-kind="accessory" aria-pressed="${S.marginKind === "accessory"}">Add-ons</button>
      </div>
    </div>
    ${list.length ? `<table class="tbl ta-m"><thead><tr><th></th><th>What</th><th class="r">Price</th><th class="r">Costs us</th><th class="r">Kept</th><th class="ta-bar-h"></th></tr></thead><tbody>
      ${list.map((p) => {
        const range = p.variants > 1 && Math.round(p.lo * 100) !== Math.round(p.hi * 100) ? `${Math.round(p.lo * 100)} to ${Math.round(p.hi * 100)}% across ${num(p.variants)} kinds` : "";
        return `<tr><td class="ta-pic">${p.kind === "product" ? `<img src="/img/web/${esc(p.id)}-640.webp" alt="" loading="lazy" width="40" height="40">` : ""}</td>
          <td>${esc(p.name)}${range ? `<small class="ta-range">${esc(range)}</small>` : ""}</td><td class="r">${esc(money2(p.price))}</td><td class="r muted">${esc(money2(p.cost))}</td>
          <td class="r w5">${Math.round(p.margin * 100)}%</td><td class="ta-bar"><span class="share" style="--w:${Math.max(0, Math.min(1, p.margin)).toFixed(3)}"><i></i></span></td></tr>`;
      }).join("")}
    </tbody></table>` : emptyState({ title: "No prices or costs to compare yet." })}
  </div>`;
  view.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => { S.marginKind = b.dataset.kind; draw(); }));
}

// ------------------------------------------------------------------ the ledger

/** The week the ledger shows: seven days ending on the anchor (today when following the clock). */
function ledgerWindow() {
  const to = S.ledger.anchor || today();
  return { from: addDays(to, -6), to };
}

/** Reads the ledger for the window (or one reference). Over 200 entries, it asks a day at a time. */
async function loadLedger() {
  const L = S.ledger;
  if (L.ref) {
    const parts = await Promise.all(refsFor(L.ref).map((ref) => read("ledger_search", { reference: ref, ...(L.type ? { type: L.type } : {}) })));
    const ok = parts.filter((p) => p.ok);
    if (!ok.length) return parts[0];
    L.rows = ok.flatMap((p) => p.data.entries).sort((a, b) => (a.at < b.at ? 1 : -1));
    L.count = ok.reduce((n, p) => n + p.data.count, 0);
    L.total = ok.reduce((n, p) => n + p.data.total, 0);
    L.capped = ok.some((p) => p.data.count > p.data.entries.length);
    return ok[0];
  }
  const { from, to } = ledgerWindow();
  const base = L.type ? { type: L.type } : {};
  const r = await read("ledger_search", { ...base, from, to });
  if (!r.ok) return r;
  let rows = r.data.entries;
  if (r.data.count > rows.length) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    const parts = await Promise.all(days.map((d) => read("ledger_search", { ...base, from: d, to: d })));
    rows = parts.flatMap((p) => (p.ok ? p.data.entries : []));
    L.capped = parts.some((p) => p.ok && p.data.count > p.data.entries.length);
  } else L.capped = false;
  L.rows = rows.slice().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
  L.count = r.data.count;
  L.total = r.data.total;
  return r;
}

function drawLedger(view) {
  view.innerHTML = `<div class="v-wrap">
    <form class="toolbar" id="lForm" role="search">
      <label class="search">${ico("search", 17)}<input id="lRef" placeholder="Find an order or a bill by its number" autocomplete="off" value="${esc(S.ledger.ref)}" aria-label="Find an order or a bill"></label>
      <select class="select is-small" id="lType" aria-label="Kind of entry"><option value="">Every kind</option>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${S.ledger.type === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>
      <div class="ta-week" id="lWeek"></div>
    </form>
    <p class="ta-l-sum" id="lSum"></p>
    <div class="ta-l" id="lRows" role="table" aria-label="Every pound in and out">${skeleton(8)}</div>
  </div>`;
  view.querySelector("#lForm").addEventListener("submit", (e) => { e.preventDefault(); S.ledger.ref = view.querySelector("#lRef").value.trim(); paintLedger(); });
  view.querySelector("#lRef").addEventListener("input", (e) => { if (!e.target.value && S.ledger.ref) { S.ledger.ref = ""; paintLedger(); } });
  view.querySelector("#lType").addEventListener("change", (e) => { S.ledger.type = e.target.value; paintLedger(); });
  paintLedger();
}

async function paintLedger() {
  const $ = (id) => main.querySelector(`#${id}`);
  if (!$("lRows")) return;
  const r = await loadLedger();
  if (S.view !== "ledger" || !$("lRows")) return;
  const L = S.ledger;
  const { from, to } = ledgerWindow();
  const following = !L.anchor;
  $("lWeek").innerHTML = L.ref ? `<button type="button" class="btn small ghost" id="lClear">Show the whole week</button>` : `
    <button type="button" class="btn small icon-only ghost" data-wk="-7" aria-label="The week before" title="The week before">${ico("left", 16)}</button>
    <span class="t-label">${esc(shortDate(`${from}T00:00:00Z`))} to ${esc(following ? "today" : shortDate(`${to}T00:00:00Z`))}</span>
    <button type="button" class="btn small icon-only ghost" data-wk="7" aria-label="The week after" title="The week after" ${following ? "disabled" : ""}>${ico("right", 16)}</button>`;
  $("lWeek").querySelectorAll("[data-wk]").forEach((b) => b.addEventListener("click", () => {
    const next = addDays(ledgerWindow().to, Number(b.dataset.wk));
    S.ledger.anchor = next >= today() ? null : next;
    paintLedger();
  }));
  $("lClear")?.addEventListener("click", () => { S.ledger.ref = ""; $("lRef").value = ""; paintLedger(); });
  if (!r.ok) { $("lRows").innerHTML = emptyState({ title: "The ledger did not open.", text: r.error.message }); $("lSum").innerHTML = ""; return; }
  $("lSum").innerHTML = L.count ? `<span class="t-label">${esc(plural(L.count, "line"))}${L.capped ? `, the first ${esc(num(L.rows.length))} shown` : ""}</span><span class="num w5">${esc(signed(L.total, money2))}</span>` : "";
  if (!L.rows.length) {
    $("lRows").innerHTML = emptyState({ title: L.ref ? `Nothing in the books for “${L.ref}”.` : "Nothing went in or out this week.", text: L.ref ? "Try the number of an order or a bill, such as 10671." : "" });
    return;
  }
  const fresh = new Set();
  const now = Date.now();
  for (const e of L.rows) {
    if (!S.firstLedger && !S.known.has(e.id)) S.freshAt.set(e.id, now);
    if (now - (S.freshAt.get(e.id) || 0) < 8000) fresh.add(e.id);
    S.known.add(e.id);
  }
  S.firstLedger = false;
  let lastDay = "";
  $("lRows").innerHTML = L.rows.map((e) => {
    const day = e.at.slice(0, 10);
    const head = day !== lastDay ? `<div class="ta-l-day" role="row"><span role="cell">${esc(longDate(e.at))}</span></div>` : "";
    lastDay = day;
    const words = refWords(e.reference);
    return `${head}<div class="ta-l-row${fresh.has(e.id) ? " is-new" : ""}" role="row">
      <span class="ta-l-time" role="cell">${esc(timeParts(e.at).time)}</span>
      <span class="ta-l-type" role="cell">${esc(TYPES[e.type] || e.type)}</span>
      <span class="ta-l-ref" role="cell">${words ? `<button class="ta-ref" data-ref="${esc(e.reference)}" title="Everything for ${esc(words)}">${esc(words)}</button>` : ""}${/^(ORD|PO)-\d+$/.test(e.reference) ? ` <button class="ta-open" data-open-rec="${esc(e.reference)}" title="Open ${esc(words)}" aria-label="Open ${esc(words)}">Open</button>` : ""}${e.reason ? `<small>${esc(plainText(e.reason))}</small>` : ""}</span>
      <span class="ta-l-amt" role="cell">${esc(signed(e.amount, money2))}</span>
    </div>`;
  }).join("");
  $("lRows").querySelectorAll("[data-ref]").forEach((b) => b.addEventListener("click", () => { S.ledger.ref = b.dataset.ref; $("lRef").value = b.textContent; paintLedger(); }));
  // Each line opens the order or purchase order it is for, the same record every app shows.
  $("lRows").querySelectorAll("[data-open-rec]").forEach((b) => b.addEventListener("click", () => openRecord(world, /^PO-/.test(b.dataset.openRec) ? "po" : "order", b.dataset.openRec)));
}

/** A correcting entry: books are put right by adding a line, never by changing an old one. */
function openCorrection() {
  const ref = S.ledger.ref || "";
  const over = slideOver({
    title: "Add a correction",
    body: `<form class="act-form-in" id="corrForm">
      <p class="t-lede">This adds a new line to the books, with your reason. Nothing old is changed.</p>
      <div class="chips" role="radiogroup" aria-label="Money in or out">
        <label class="ta-dir"><input type="radio" name="dir" value="1" checked><span class="pm-chip">Money in</span></label>
        <label class="ta-dir"><input type="radio" name="dir" value="-1"><span class="pm-chip">Money out</span></label>
      </div>
      <label class="field"><span>How much (£)</span><input class="input" name="amount" type="number" step="0.01" min="0.01" inputmode="decimal" placeholder="0.00" required></label>
      <label class="field"><span>Which order or bill it is for</span><input class="input" name="reference" value="${esc(ref)}" placeholder="Order 10671" required></label>
      <label class="field"><span>Why</span><textarea class="textarea" name="reason" placeholder="What was wrong, and how you know" required minlength="5"></textarea></label>
      <p class="said bad" id="corrErr" role="alert"></p>
      <div><button class="btn primary" type="submit">Add it to the books</button></div>
    </form>`,
  });
  const form = over.el.querySelector("#corrForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const amount = Math.round(Number(f.get("dir")) * Number(f.get("amount")) * 100) / 100;
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    const r = await world.call("add_ledger_correction", { amount, reference: refsFor(f.get("reference"))[0], reason: String(f.get("reason")).trim() });
    btn.disabled = false;
    if (!r.ok) { over.el.querySelector("#corrErr").textContent = r.error.message; return; }
    over.close();
    toast(`${signed(amount, money2)} added for ${refWords(r.data.reference) || "that"}.`, { tone: "good" });
    // Show the new line where it landed: the ledger, following today.
    S.ledger = { ...S.ledger, ref: "", anchor: null, type: "" };
    if (S.view !== "ledger") location.hash = "#ledger"; else refresh();
  });
  form.querySelector("[name=amount]").focus();
}

// ------------------------------------------------------------------ drawing, routing, keyboard, staying live

function draw() {
  markNav();
  paintBooks();
  const view = main.querySelector("#view");
  if (S.failed) { view.innerHTML = `<div class="v-wrap">${emptyState({ title: "The books did not open.", text: S.failed.message || "Try again in a moment." })}</div>`; return; }
  if (!S.snapshot) return;
  const scroll = view.scrollTop;
  ({ overview: drawOverview, statement: drawStatement, owed: drawOwed, margins: drawMargins, ledger: drawLedger })[S.view](view);
  view.scrollTop = scroll;
}

function route() {
  const id = location.hash.replace(/^#/, "");
  const was = S.view;
  S.view = VIEWS.some((v) => v.id === id) ? id : "overview";
  draw();
  if (was !== S.view) main.querySelector("#view").scrollTop = 0;
}

/** Redraws once, however many changes arrive while it is already redrawing. */
async function refresh({ margins = false } = {}) {
  if (margins) S.products = null;
  if (S.busy) { S.again = true; return; }
  S.busy = true;
  try {
    const res = await load();
    S.failed = res.refused;
    draw();
  } finally {
    S.busy = false;
    if (S.again) { S.again = false; refresh(); }
  }
}

/**
 * The keyboard. Keys act only when you are not typing and nothing is open over the page.
 *   1 to 5: the five views   C: add a correction   /: find in the ledger
 *   Left and Right: the period before or after (Profit and loss), the week before or after (the ledger)
 *   J or Down, K or Up: move through the buttons in the view
 */
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".over")) return;
  if (e.target.closest?.("input, textarea, select")) { if (e.key === "Escape") e.target.blur(); return; }
  if (e.target.closest?.(".ch svg")) return;  // a chart's own arrows walk its months
  const n = Number(e.key);
  if (n >= 1 && n <= VIEWS.length) { e.preventDefault(); location.hash = `#${VIEWS[n - 1].id}`; return; }
  if (e.key === "c") { e.preventDefault(); openCorrection(); return; }
  if (e.key === "/") { e.preventDefault(); if (S.view !== "ledger") location.hash = "#ledger"; setTimeout(() => main.querySelector("#lRef")?.focus(), 60); return; }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const dir = e.key === "ArrowLeft" ? -1 : 1;
    if (S.view === "statement") { e.preventDefault(); stepPeriod(dir); }
    if (S.view === "ledger") { e.preventDefault(); main.querySelector(`[data-wk="${dir * 7}"]:not(:disabled)`)?.click(); }
    return;
  }
  const down = e.key === "j" || e.key === "ArrowDown", up = e.key === "k" || e.key === "ArrowUp";
  if (!down && !up) return;
  const items = [...main.querySelectorAll("#view button:not(:disabled)")];
  if (!items.length) return;
  e.preventDefault();
  const at = items.indexOf(document.activeElement);
  const next = items[at < 0 ? 0 : Math.max(0, Math.min(items.length - 1, at + (down ? 1 : -1)))];
  next.focus();
  next.scrollIntoView({ block: "nearest" });
});

shell();
main.querySelector("#view").innerHTML = `<div class="v-wrap">${skeleton(6)}</div>`;
S.view = VIEWS.some((v) => v.id === location.hash.slice(1)) ? location.hash.slice(1) : "overview";
await refresh();
window.addEventListener("hashchange", route);

document.addEventListener("ot:day", (e) => {
  // A month that was "this month" may have ended; follow the clock unless a person picked another period.
  if (S.period.mode === "month" && S.period.key === S.snapshot?.month && e.detail?.now) S.period.key = e.detail.now.slice(0, 7);
  if (e.detail?.partial) return;
  refresh();
});
world.onChange((change) => {
  if (change.reset) { S.known.clear(); S.firstLedger = true; S.period = { mode: "month", key: null }; refresh({ margins: true }); return; }
  if (change.source === "local" && !change.entries.length) return;
  const real = change.entries.filter((e) => !isScreenRead(e));
  if (real.length) refresh({ margins: real.some((e) => /price|product|supplier/.test(e.tool || "")) });
});
