// The back office: builds a static app from the generated world.
// node business/backoffice/build.mjs [--size standard]
// Reads business/data/, docs/data-model.md, the engine and the server code (never writes outside business/backoffice/) and writes
// business/backoffice/dist/: the app from business/backoffice/src/, plus compact JSON split so each screen loads only what it needs.
// Every number the app shows is worked out here or in the browser from these files. Nothing is typed in by hand.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const args = process.argv.slice(2);
const size = args.includes("--size") ? args[args.indexOf("--size") + 1] : "standard";
// WHY world-bench: the back office shows the planted stories ("Known problems"), which only the bench world has.
const WORLD = path.join(ROOT, "business/data/world-bench", size);
if (!fs.existsSync(WORLD)) { console.error(`No world at ${WORLD}. Run: node business/builder/build-world.mjs --size ${size} --stories`); process.exit(1); }

const DIST = args.includes("--out") ? path.resolve(args[args.indexOf("--out") + 1]) : path.join(HERE, "dist"); // --out builds a preview elsewhere
const BUCKETS = 32; // customer records are split into this many files

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const w = {};
for (const f of fs.readdirSync(WORLD)) if (f.endsWith(".json")) w[f.replace(".json", "")] = read(path.join(WORLD, f));
const business = read(path.join(ROOT, "business/data/business.json"));
const products = fs.readdirSync(path.join(ROOT, "business/data/products")).filter((f) => f.endsWith(".json")).map((f) => read(path.join(ROOT, "business/data/products", f)));

const NOW = business.sim.anchor_now;
const TODAY = NOW.slice(0, 10);
const r2 = (n) => Math.round(n * 100) / 100;
const custNum = (id) => (id ? parseInt(id.slice(2), 10) : 0);
const bucketOf = (id) => (id ? custNum(id) % BUCKETS : "x");
const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = (t) => (t ? `${+t.slice(8, 10)} ${MONS[+t.slice(5, 7) - 1]} ${t.slice(0, 4)}` : t);
const min = (t) => (t ? t.slice(0, 16) : null); // 2026-11-23T10:00
const daysBetween = (a, b) => Math.round((new Date(b.slice(0, 10)) - new Date(a.slice(0, 10))) / 864e5);
const gbp = (n) => (n < 0 ? "−£" : "£") + Math.abs(Number(n)).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ------------------------------------------------------------ output folders
fs.rmSync(DIST, { recursive: true, force: true });
for (const d of ["", "data", "data/people", "data/orders", "data/ledger", "data/stock", "img"]) fs.mkdirSync(path.join(DIST, d), { recursive: true });
const sizes = {};
const out = (rel, obj) => { const s = JSON.stringify(obj); fs.writeFileSync(path.join(DIST, "data", rel), s); sizes[rel] = s.length; };
for (const f of fs.readdirSync(path.join(HERE, "src"))) fs.copyFileSync(path.join(HERE, "src", f), path.join(DIST, f));
fs.copyFileSync(path.join(ROOT, "business/brand/mark.svg"), path.join(DIST, "img/mark.svg"));

// ------------------------------------------------------------ pictures
function picture(file) {
  while (file && typeof file === "object") file = file.file || file.src || file.cutout || Object.values(file).find((v) => typeof v === "string" && /\.(jpg|png|webp)$/.test(v));
  if (!file) return null;
  const base = path.basename(file).replace(/\.\w+$/, "");
  const web = path.join(ROOT, "business/site/img/web", `${base}-640.webp`);
  const jpg = path.join(ROOT, "business/site/img/branded", `${base}.jpg`);
  const src = fs.existsSync(web) ? web : fs.existsSync(jpg) ? jpg : null;
  if (!src) return null;
  const name = path.basename(src);
  if (!fs.existsSync(path.join(DIST, "img", name))) fs.copyFileSync(src, path.join(DIST, "img", name));
  return "img/" + name;
}

// ------------------------------------------------------------ the catalogue: one entry per SKU
// Made-to-order products (bakery, ice) come in each morning, so an empty shelf is normal. Read from the suppliers file:
// a supplier whose notes say it makes to order.
const supplierOf = {}, costOf = {};
for (const s of w.suppliers) for (const k of s.skus) { supplierOf[k] = s.id; costOf[k] = s.unit_cost[k]; }
const mtoSuppliers = new Set(w.suppliers.filter((s) => /to order/i.test(s.notes || "")).map((s) => s.id));
const MTO = new Set(w.suppliers.filter((s) => mtoSuppliers.has(s.id)).flatMap((s) => s.products));
const sku = {};
const productList = [];
for (const p of products.sort((a, b) => a.name.localeCompare(b.name))) {
  const img = picture(p.image?.file || `img/${p.id}.jpg`);
  const entry = { id: p.id, name: p.name, category: p.category, tagline: p.tagline, img, warranty: p.warranty?.months ?? null, mto: MTO.has(p.id), skus: [] };
  for (const v of p.variants || []) {
    const vimg = p.variant_images ? picture(Object.entries(p.variant_images.images).find(([k]) => v.name.startsWith(k))?.[1]) : null;
    sku[v.sku] = { sku: v.sku, product: p.id, name: p.variants.length > 1 ? `${p.name}, ${v.name}` : p.name, short: v.name, price: v.price, kind: "variant", img: vimg || img };
    entry.skus.push(v.sku);
  }
  for (const a of p.accessories || []) {
    sku[a.sku] = { sku: a.sku, product: p.id, name: a.name, short: a.name, price: a.price, kind: "accessory", img: picture(a.image?.file || a.image) || img };
    entry.skus.push(a.sku);
  }
  productList.push(entry);
}
for (const k in sku) Object.assign(sku[k], { cost: costOf[k] ?? null, supplier: supplierOf[k] ?? null, on_hand: w.stock[k]?.on_hand ?? null, restock: w.stock[k]?.restock_date ?? null, mto: MTO.has(sku[k].product) });
const productOf = (k) => sku[k]?.product;

// ------------------------------------------------------------ lookups
const custById = Object.fromEntries(w.customers.map((c) => [c.id, c]));
const paid = w.orders.filter((o) => o.payment.status !== "declined"); // the validator's definition of a paid order
const monthOf = (t) => t.slice(0, 7);
const months = w.monthly_summary.map((m) => m.month);
const late = (s) => s.status === "delayed" || (["in_transit", "pending"].includes(s.status) && s.eta && s.eta < TODAY);
const OPEN_CASE = ["open", "escalated", "waiting_customer"];

// ------------------------------------------------------------ people buckets: a customer and everything about them
const buckets = {};
const B = (id) => (buckets[bucketOf(id)] ||= { customers: [], orders: [], returns: [], registrations: [], repairs: [], cases: [], conversations: [], contacts: [], reviews: [] });
for (const c of w.customers) B(c.id).customers.push(c);
for (const k of ["orders", "returns", "registrations", "repairs", "cases", "conversations", "contacts", "reviews"]) for (const r of w[k]) B(r.customer_id)[k].push(r);
for (const [b, v] of Object.entries(buckets)) out(`people/p-${b}.json`, v);
const refs = {};
for (const k of ["orders", "returns", "registrations", "repairs", "cases", "conversations", "contacts", "reviews"])
  for (const r of w[k]) refs[r.number || r.id] = r.customer_id ? custNum(r.customer_id) : 0;
for (const o of w.orders) for (const s of o.shipments) refs[s.id] = custNum(o.customer_id);
out("refs.json", refs);

// ------------------------------------------------------------ payments: card brand from the test card's last four digits
const cardBy = Object.fromEntries((business.payments?.test_cards || []).map((c) => [c.number.replace(/\s/g, "").slice(-4), c]));
const payMethod = (o) => {
  if (o.payment.method_name) return o.payment.method_name;
  const last4 = (o.payment.method || "").match(/(\d{4})\s*$/)?.[1];
  return cardBy[last4]?.brand ? `Card (${cardBy[last4].brand})` : last4 ? "Card (other)" : o.payment.method || "Unknown";
};
const payOutcome = (o) => (o.payment.status === "declined" ? (cardBy[(o.payment.method || "").match(/(\d{4})\s*$/)?.[1]]?.label || o.payment.outcome || "Declined") : null);

// ------------------------------------------------------------ orders index, one file per year
const hasReturn = new Set(w.returns.map((r) => r.order_number));
const hasCase = new Set(w.cases.map((c) => c.related?.order).filter(Boolean));
const ordersByYear = {};
for (const o of w.orders) {
  const y = o.placed_at.slice(0, 4);
  const prods = [...new Set(o.items.map((i) => productOf(i.sku)))].join(",");
  const flags = (hasReturn.has(o.number) ? "R" : "") + (hasCase.has(o.number) ? "C" : "") + (o.shipments.some(late) ? "L" : "") + (o.discount_code ? "D" : "") + (o.shipments.some((s) => s.status === "lost") ? "X" : "");
  (ordersByYear[y] ||= []).push([o.number, custNum(o.customer_id), min(o.placed_at), o.status, o.totals.total, prods, o.payment.status, o.delivery.method, flags, o.items.reduce((n, i) => n + i.qty, 0), payMethod(o), o.payment.refunded || 0]);
}
for (const [y, rows] of Object.entries(ordersByYear)) out(`orders/y${y}.json`, rows.sort((a, b) => b[2].localeCompare(a[2])));

// ------------------------------------------------------------ customers index and segments
// Segments are worked out from behaviour, because the customer's type is not stored (docs/data-model.md).
const SEGMENTS = {
  business: "Business buyers: 10 or more paid orders, at least 80% of them sandwiches and 70% placed on a Monday",
  regular: "Regulars: 3 or more paid orders",
  one_time: "One-time buyers: exactly 1 paid order",
  returner: "Frequent returners: 3 or more returns, or 2 or more returns on a quarter or more of their orders",
  complainer: "Complainers: 3 or more complaint cases",
};
const cAgg = {};
for (const c of w.customers) cAgg[c.id] = { orders: 0, spend: 0, last: null, first: null, returns: 0, cases: 0, open: 0, contacts: 0, complaints: 0, sand: 0, mon: 0 };
for (const o of paid) {
  const a = cAgg[o.customer_id]; a.orders++; a.spend += o.totals.total - (o.payment.refunded || 0);
  if (!a.last || o.placed_at > a.last) a.last = o.placed_at; if (!a.first || o.placed_at < a.first) a.first = o.placed_at;
  if (o.items.some((i) => MTO.has(productOf(i.sku)) && /SAND/.test(i.sku))) a.sand++;
  if (new Date(o.placed_at).getUTCDay() === 1) a.mon++;
}
for (const r of w.returns) cAgg[r.customer_id].returns++;
for (const c of w.cases) if (c.customer_id) { const a = cAgg[c.customer_id]; a.cases++; if (OPEN_CASE.includes(c.status)) a.open++; if (c.is_complaint) a.complaints++; }
for (const c of w.contacts) if (c.customer_id) cAgg[c.customer_id].contacts++;
const segOf = (a) => {
  const s = [];
  if (a.orders >= 10 && a.sand / a.orders >= 0.8 && a.mon / a.orders >= 0.7) s.push("business");
  else if (a.orders >= 3) s.push("regular");
  if (a.orders === 1) s.push("one_time");
  if (a.returns >= 3 || (a.returns >= 2 && a.returns / Math.max(1, a.orders) >= 0.25)) s.push("returner");
  if (a.complaints >= 3) s.push("complainer");
  return s;
};
const custRows = w.customers.map((c) => { const a = cAgg[c.id]; const ad = c.addresses.find((x) => x.default) || c.addresses[0]; return [custNum(c.id), c.name, ad?.town || "", ad?.postcode || "", c.created_at.slice(0, 10), a.orders, r2(a.spend), a.last ? a.last.slice(0, 10) : null, a.returns, a.cases, a.open, c.email, c.credit_balance, a.contacts, segOf(a).join(","), a.complaints, c.marketing_opt_in ? 1 : 0]; });
out("customers.json", custRows);
const segCounts = Object.fromEntries(Object.keys(SEGMENTS).map((k) => [k, custRows.filter((r) => r[14].split(",").includes(k)).length]));

// ------------------------------------------------------------ stock: weekly levels and movements per SKU
const mvs = [...w.stock_movements].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
const firstDay = new Date(mvs[0].at.slice(0, 10) + "T00:00:00Z");
const weekEnd = new Date(firstDay); weekEnd.setUTCDate(weekEnd.getUTCDate() + ((7 - weekEnd.getUTCDay()) % 7));
const weeks = [];
for (let d = new Date(weekEnd); d.toISOString().slice(0, 10) < TODAY; d.setUTCDate(d.getUTCDate() + 7)) weeks.push(d.toISOString().slice(0, 10));
weeks.push(TODAY);
const level = Object.fromEntries(Object.keys(sku).map((k) => [k, 0]));
const series = Object.fromEntries(Object.keys(sku).map((k) => [k, []]));
const perSku = Object.fromEntries(Object.keys(sku).map((k) => [k, []]));
const outages = []; // a shelf going empty and coming back
const openOut = {};
let wi = 0;
for (const m of mvs) {
  while (wi < weeks.length - 1 && m.at.slice(0, 10) > weeks[wi]) { for (const k in level) series[k].push(level[k]); wi++; }
  const before = level[m.sku];
  level[m.sku] += m.qty;
  perSku[m.sku]?.push([m.id, min(m.at), m.qty, m.reason, m.reference, level[m.sku]]);
  if (!sku[m.sku]?.mto) {
    if (before > 0 && level[m.sku] <= 0) openOut[m.sku] = m.at;
    if (before <= 0 && level[m.sku] > 0 && openOut[m.sku]) { outages.push({ sku: m.sku, from: openOut[m.sku].slice(0, 10), to: m.at.slice(0, 10) }); delete openOut[m.sku]; }
  }
}
for (const [k, t] of Object.entries(openOut)) outages.push({ sku: k, from: t.slice(0, 10), to: null });
while (wi < weeks.length) { for (const k in level) series[k].push(level[k]); wi++; }
for (const k in level) if (level[k] !== (w.stock[k]?.on_hand ?? 0)) console.warn(`! ${k}: movements add to ${level[k]}, stock.json says ${w.stock[k]?.on_hand}`);
out("stock/series.json", { weeks, levels: series });
for (const [k, rows] of Object.entries(perSku)) out(`stock/mv-${k}.json`, rows.reverse());
// movements by year, so any MV id can be opened
const mvYears = {};
for (const m of mvs) (mvYears[m.at.slice(0, 4)] ||= []).push([m.id, min(m.at), m.sku, m.qty, m.reason, m.reference]);
for (const [y, rows] of Object.entries(mvYears)) out(`stock/y${y}.json`, rows);

// ------------------------------------------------------------ products: sales, returns, faults, reviews
const salesBy = {};
const skuSold = {}, skuSold30 = {}, skuSold90 = {}, skuSoldPrev90 = {};
const daysAgo = (n) => new Date(new Date(NOW).getTime() - n * 864e5).toISOString();
const d30 = daysAgo(30), d90 = daysAgo(90), d180 = daysAgo(180);
for (const o of paid) for (const i of o.items) {
  const p = productOf(i.sku), m = monthOf(o.placed_at);
  const row = ((salesBy[p] ||= {})[m] ||= [0, 0]); row[0] += i.qty; row[1] += i.qty * i.unit_price;
  skuSold[i.sku] = (skuSold[i.sku] || 0) + i.qty;
  if (o.placed_at >= d30) skuSold30[i.sku] = (skuSold30[i.sku] || 0) + i.qty;
  if (o.placed_at >= d90) skuSold90[i.sku] = (skuSold90[i.sku] || 0) + i.qty;
  else if (o.placed_at >= d180) skuSoldPrev90[i.sku] = (skuSoldPrev90[i.sku] || 0) + i.qty;
}
const returned = {}, faulty = {}, repairsBy = {};
for (const r of w.returns) for (const i of r.items) { returned[i.sku] = (returned[i.sku] || 0) + i.qty; if (r.reason === "faulty") faulty[i.sku] = (faulty[i.sku] || 0) + i.qty; }
for (const f of w.repairs) repairsBy[f.sku] = (repairsBy[f.sku] || 0) + 1;
const firstSale = {};
for (const o of paid) for (const i of o.items) { const p = productOf(i.sku); if (!firstSale[p] || o.placed_at < firstSale[p]) firstSale[p] = o.placed_at.slice(0, 10); }
const productsOut = productList.map((p) => {
  const ks = p.skus;
  const sum = (o) => ks.reduce((n, k) => n + (o[k] || 0), 0);
  const revs = w.reviews.filter((r) => r.product === p.id).sort((a, b) => b.date.localeCompare(a.date));
  const dist = [1, 2, 3, 4, 5].map((s) => revs.filter((r) => r.rating === s).length);
  const lastSale = Object.keys(salesBy[p.id] || {}).sort().at(-1) || null;
  const empty = ks.some((k) => !p.mto && (w.stock[k]?.on_hand ?? 1) === 0);
  return {
    ...p,
    sold: sum(skuSold), sold30: sum(skuSold30), sold90: sum(skuSold90), soldPrev90: sum(skuSoldPrev90), returned: sum(returned), faulty: sum(faulty), repairs: sum(repairsBy),
    revenue: r2(Object.values(salesBy[p.id] || {}).reduce((n, v) => n + v[1], 0)),
    cost_sold: r2(ks.reduce((n, k) => n + (skuSold[k] || 0) * (costOf[k] || 0), 0)),
    monthly: months.map((m) => salesBy[p.id]?.[m] || [0, 0]),
    first_sale: firstSale[p.id] || null, last_sale_month: lastSale,
    lifecycle: !firstSale[p.id] ? "not_sold" : empty ? "out_of_stock" : firstSale[p.id] >= daysAgo(365).slice(0, 10) ? "new" : "selling",
    reviews: { count: revs.length, avg: revs.length ? r2(revs.reduce((n, r) => n + r.rating, 0) / revs.length) : null, dist, recent: revs.slice(0, 8).map((r) => [r.id, r.customer_id, r.rating, r.text, r.date, r.order_number]) },
    prices: w.price_history.filter((h) => ks.includes(h.sku)),
    counts: w.stock_counts.filter((c) => ks.includes(c.sku)).sort((a, b) => b.at.localeCompare(a.at)),
    sku_sold: Object.fromEntries(ks.map((k) => [k, [skuSold[k] || 0, skuSold30[k] || 0, returned[k] || 0, faulty[k] || 0, repairsBy[k] || 0]])),
  };
});
out("products.json", productsOut);

// ------------------------------------------------------------ suppliers and purchase orders
const poValue = (p) => r2(p.lines.reduce((n, l) => n + l.qty * l.unit_cost, 0));
const poRows = w.purchase_orders.map((p) => {
  const arrived = p.received_at ? p.received_at.slice(0, 10) : null;
  const daysLate = arrived ? Math.max(0, daysBetween(p.due_at, arrived)) : p.due_at < TODAY && p.status !== "cancelled" ? daysBetween(p.due_at, TODAY) : 0;
  return { n: p.number, s: p.supplier_id, o: min(p.ordered_at), d: p.due_at, e: p.expected_at, r: min(p.received_at), st: p.status, pd: min(p.paid_at), v: poValue(p), late: daysLate, l: p.lines.map((l) => [l.sku, l.qty, l.unit_cost, l.qty_received]), note: p.note || "" };
});
const supOut = w.suppliers.map((s) => {
  const pos = poRows.filter((p) => p.s === s.id && p.st !== "cancelled");
  const done = pos.filter((p) => p.r);
  const lateOnes = done.filter((p) => p.late > 0);
  return { ...s, mto: mtoSuppliers.has(s.id), pos: pos.length, delivered: done.length, late_count: lateOnes.length, on_time: done.length ? r2((done.length - lateOnes.length) / done.length) : null, avg_late: lateOnes.length ? r2(lateOnes.reduce((n, p) => n + p.late, 0) / lateOnes.length) : 0, spent: r2(pos.reduce((n, p) => n + p.v, 0)), open: pos.filter((p) => !["received", "cancelled"].includes(p.st)).length };
});
out("buying.json", { suppliers: supOut, pos: [...poRows].reverse() });

// ------------------------------------------------------------ operations: stock now, counts, stockouts
const lostByDay = Object.fromEntries(w.web_sessions_daily.map((d) => [d.date, d.baskets_lost_to_stockouts]));
const msBy = Object.fromEntries(w.monthly_summary.map((m) => [m.month, m]));
const incoming = {};
for (const p of poRows) if (["ordered", "late", "part_received", "awaiting_approval", "draft"].includes(p.st)) for (const l of p.l) incoming[l[0]] = (incoming[l[0]] || 0) + l[1] - (l[3] || 0);
const stockNow = Object.keys(sku).map((k) => ({ sku: k, on_hand: w.stock[k]?.on_hand ?? 0, restock: w.stock[k]?.restock_date ?? null, sold30: skuSold30[k] || 0, value: r2((w.stock[k]?.on_hand ?? 0) * (costOf[k] || 0)), incoming: incoming[k] || 0 }));
const stockouts = outages.map((o) => {
  const end = o.to || TODAY;
  let lost = 0; for (const [d, n] of Object.entries(lostByDay)) if (d >= o.from && d <= end) lost += n;
  return { ...o, days: daysBetween(o.from, end), lost_baskets_all_products: lost };
}).sort((a, b) => b.from.localeCompare(a.from));
const lostTotal = w.web_sessions_daily.reduce((n, d) => n + d.baskets_lost_to_stockouts, 0);
const lostRows = w.web_sessions_daily.filter((d) => d.baskets_lost_to_stockouts > 0).map((d) => ({ date: d.date, lost: d.baskets_lost_to_stockouts, aov: msBy[d.date.slice(0, 7)]?.average_order_value ?? null }));
out("ops.json", { stock: stockNow, counts: [...w.stock_counts].sort((a, b) => b.at.localeCompare(a.at)), stockouts, lost: { total: lostTotal, days: lostRows, est_value: r2(lostRows.reduce((n, d) => n + d.lost * (d.aov || 0), 0)) }, weeks_from: weeks[0] });

// ------------------------------------------------------------ money
const ledgerByYear = {};
for (const e of w.ledger) (ledgerByYear[e.at.slice(0, 4)] ||= []).push([e.id, min(e.at), e.type, e.amount, e.reference, e.reason || e.note || ""]);
for (const [y, rows] of Object.entries(ledgerByYear)) out(`ledger/y${y}.json`, rows.reverse());
const ledgerYears = Object.fromEntries(Object.entries(ledgerByYear).map(([y, r]) => [y, { count: r.length, first: r.at(-1)[0], last: r[0][0] }]));
// Anomalies: things a bookkeeper would want to look at, found by rule, never hand-picked.
const anomalies = [];
const refundsByRef = {};
for (const e of w.ledger) if (e.type === "refund") (refundsByRef[e.reference] ||= []).push(e);
const retByNum = Object.fromEntries(w.returns.map((r) => [r.number, r]));
const ordByNum = Object.fromEntries(w.orders.map((o) => [o.number, o]));
for (const [ref, es] of Object.entries(refundsByRef)) {
  const total = -es.reduce((n, e) => n + e.amount, 0);
  const expected = retByNum[ref]?.refund_amount ?? null;
  if (expected != null && total - expected > 0.009) anomalies.push({ kind: "refund_mismatch", title: `${ref} was refunded ${gbp(total)} in the ledger, but the return says ${gbp(expected)}`, detail: `${es.length} refund entries for one return. The customer may have been paid twice.`, refs: [ref, retByNum[ref].order_number, ...es.map((e) => e.id)] });
}
const byOrderRefund = {};
for (const e of w.ledger) if (e.type === "refund") { const o = ordByNum[e.reference] || ordByNum[retByNum[e.reference]?.order_number]; if (o) byOrderRefund[o.number] = (byOrderRefund[o.number] || 0) - e.amount; }
for (const [n, v] of Object.entries(byOrderRefund)) { const o = ordByNum[n]; if (v - o.totals.total > 0.009) anomalies.push({ kind: "refund_over_paid", title: `Refunds on ${n} add up to more than was paid`, detail: `${gbp(v)} refunded against a ${gbp(o.totals.total)} order.`, refs: [n] }); }
for (const e of w.ledger.filter((e) => e.type === "correction")) anomalies.push({ kind: "correction", title: `A correction of ${gbp(e.amount)} was added by hand`, detail: e.reason || e.note || "No reason given.", refs: [e.id, e.reference].filter(Boolean) });
for (const m of w.monthly_summary.slice(-12)) if (m.profit < 0) anomalies.push({ kind: "loss_month", title: `${MONS[+m.month.slice(5) - 1]} ${m.month.slice(0, 4)} made a loss of ${gbp(-m.profit)}`, detail: `Gross margin ${gbp(m.gross_margin)} against running costs of ${gbp(m.operating_costs_total)}.`, refs: [] });
out("money.json", { months: w.monthly_summary, ledger_years: ledgerYears, opening_cash: w.company.opening_cash ?? null, anomalies, types: [...new Set(w.ledger.map((e) => e.type))] });

// ------------------------------------------------------------ commerce: payments, deliveries, returns
const payMonths = {};
const payMethods = {};
for (const o of w.orders) {
  const m = monthOf(o.placed_at), meth = payMethod(o), st = o.payment.status;
  const pm = (payMonths[m] ||= { month: m, paid: 0, declined: 0, money: 0, refunded: 0 });
  if (st === "declined") pm.declined++; else { pm.paid++; pm.money += o.totals.total; pm.refunded += o.payment.refunded || 0; }
  const mm = (payMethods[meth] ||= { method: meth, orders: 0, declined: 0, money: 0, refunded: 0 });
  mm.orders++; if (st === "declined") mm.declined++; else { mm.money += o.totals.total; mm.refunded += o.payment.refunded || 0; }
}
const statusCounts = {}; for (const o of w.orders) statusCounts[o.payment.status] = (statusCounts[o.payment.status] || 0) + 1;
const failReasons = {}; for (const o of w.orders) { const r = payOutcome(o); if (r) failReasons[r] = (failReasons[r] || 0) + 1; }
out("payments.json", {
  months: Object.values(payMonths).map((m) => ({ ...m, money: r2(m.money), refunded: r2(m.refunded) })).sort((a, b) => a.month.localeCompare(b.month)),
  methods: Object.values(payMethods).map((m) => ({ ...m, money: r2(m.money), refunded: r2(m.refunded) })).sort((a, b) => b.orders - a.orders),
  statuses: statusCounts, fail_reasons: failReasons,
  declined: w.orders.filter((o) => o.payment.status === "declined").map((o) => [o.number, custNum(o.customer_id), min(o.placed_at), o.totals.total, payOutcome(o), o.status]).sort((a, b) => b[2].localeCompare(a[2])),
  methods_offered: (business.payments?.methods || []).map((m) => ({ id: m.id, name: m.name, kind: m.kind, explain: m.explain })),
});
const shipRows = [];
const shipMonths = {};
for (const o of w.orders) for (const s of o.shipments) {
  const lateBy = s.delivered_at && s.eta ? Math.max(0, daysBetween(s.eta, s.delivered_at)) : late(s) && s.eta ? daysBetween(s.eta, TODAY) : 0;
  shipRows.push([s.id, o.number, custNum(o.customer_id), s.carrier, s.status, o.delivery.method, min(s.dispatched_at), s.eta, min(s.delivered_at), lateBy, late(s) ? 1 : 0, s.note || ""]);
  if (s.dispatched_at) { const m = monthOf(s.dispatched_at); const x = (shipMonths[m] ||= { month: m, sent: 0, late: 0, lost: 0 }); x.sent++; if (lateBy > 0) x.late++; if (s.status === "lost") x.lost++; }
}
out("deliveries.json", { rows: shipRows.sort((a, b) => String(b[6] || "9").localeCompare(String(a[6] || "9"))), months: Object.values(shipMonths).sort((a, b) => a.month.localeCompare(b.month)), rules: business.delivery });
out("returns.json", w.returns.map((r) => [r.number, r.order_number, custNum(r.customer_id), min(r.created_at), r.reason, r.status, r.refund_amount, r.items.map((i) => i.sku).join(","), r.postage_deducted || 0, min(r.refunded_at), r.items.reduce((n, i) => n + i.qty, 0)]).sort((a, b) => b[3].localeCompare(a[3])));

// ------------------------------------------------------------ customer service
out("service.json", {
  contacts: w.contacts.map((c) => [c.id, min(c.at), custNum(c.customer_id), c.channel, c.topic, c.handled_by, c.first_reply_minutes, c.resolve_minutes, c.outcome, c.case_number, c.summary]),
  cases: w.cases.map((c) => ({ n: c.number, c: custNum(c.customer_id), s: c.subject, cat: c.category, st: c.status, cp: c.is_complaint, stage: c.complaint_stage, o: min(c.opened_at), last: min(c.notes?.at(-1)?.at), rel: c.related || {}, esc: c.escalated_to, notes: c.notes?.length || 0 })),
  conversations: w.conversations.map((c) => ({ id: c.id, c: custNum(c.customer_id), ch: c.channel, at: min(c.started_at), last: min(c.messages.at(-1)?.at), case: c.case_number, sum: c.summary, msgs: c.messages.length, first: c.messages[0]?.text, lastFrom: c.messages.at(-1)?.from })),
  repairs: w.repairs.map((f) => ({ n: f.number, c: custNum(f.customer_id), sku: f.sku, fault: f.fault, st: f.status, w: f.in_warranty, o: min(f.created_at), q: f.quote?.total ?? null, last: min(f.history?.at(-1)?.at), batch: f.batch || null })),
  complaint_rules: business.complaints, contact_rules: business.contact,
});

// ------------------------------------------------------------ marketing
const codeOrders = {};
for (const o of paid) if (o.discount_code) { const a = (codeOrders[o.discount_code] ||= [0, 0]); a[0]++; a[1] += o.totals.total; }
const webMonths = {};
for (const d of w.web_sessions_daily) {
  const m = (webMonths[d.date.slice(0, 7)] ||= { visits: {}, total: 0, started: 0, abandoned: 0, lost: 0, orders: 0, views: {} });
  for (const [k, v] of Object.entries(d.visits)) m.visits[k] = (m.visits[k] || 0) + v;
  m.total += d.total_visits; m.started += d.baskets_started; m.abandoned += d.baskets_abandoned; m.lost += d.baskets_lost_to_stockouts; m.orders += d.orders;
  for (const [k, v] of Object.entries(d.product_page_views)) m.views[k] = (m.views[k] || 0) + v;
}
// repeat purchase: of the customers whose first paid order was in a year, how many came back
const cohorts = {};
for (const c of w.customers) { const a = cAgg[c.id]; if (!a.first) continue; const y = a.first.slice(0, 4); const x = (cohorts[y] ||= { year: y, customers: 0, came_back: 0 }); x.customers++; if (a.orders >= 2) x.came_back++; }
out("marketing.json", {
  campaigns: w.campaigns.map((c) => ({ ...c, code_orders: c.code ? codeOrders[c.code]?.[0] || 0 : null, code_money: c.code ? r2(codeOrders[c.code]?.[1] || 0) : null })),
  web: Object.entries(webMonths).map(([month, v]) => ({ month, ...v })),
  cohorts: Object.values(cohorts),
  movers: productsOut.map((p) => ({ id: p.id, now: p.sold90, before: p.soldPrev90, money: p.revenue })),
});

// ------------------------------------------------------------ knowledge: staff documents, procedures, customer policies
const fm = (text) => { const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/); if (!m) return { body: text }; const meta = {}; for (const l of m[1].split(/\r?\n/)) { const kv = l.match(/^([\w-]+):\s*(.*)$/); if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, ""); } return { ...meta, body: m[2] }; };
const mdDir = (d) => fs.existsSync(path.join(ROOT, d)) ? fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith(".md")).sort().map((f) => ({ id: f.replace(/\.md$/, ""), ...fm(fs.readFileSync(path.join(ROOT, d, f), "utf8")) })) : [];
const titleOf = (x) => x.title || x.body.match(/^# (.+)$/m)?.[1] || x.id;
out("documents.json", w.documents);
out("knowledge.json", {
  procedures: mdDir("business/data/procedures").map((x) => ({ id: x.id, title: titleOf(x), summary: x.summary || x.description || "", body: x.body })),
  policies: mdDir("business/data/policies").map((x) => ({ id: x.id, title: titleOf(x), summary: x.summary || x.description || "", body: x.body })),
});

// ------------------------------------------------------------ the engine and the server, imported for real
const { loadData } = await import(path.join(ROOT, "infrastructure/engine/load.js"));
const { createWorld } = await import(path.join(ROOT, "infrastructure/engine/engine.js"));
let serverMods = {};
try {
  serverMods = {
    openapi: await import(path.join(ROOT, "infrastructure/server/openapi.mjs")),
    scenarios: await import(path.join(ROOT, "infrastructure/server/scenarios.mjs")),
    diff: await import(path.join(ROOT, "infrastructure/server/diff.mjs")),
    sandboxes: await import(path.join(ROOT, "infrastructure/server/sandboxes.mjs")),
  };
} catch (e) { console.warn("! server code could not be imported:", e.message); }
const engineData = loadData(path.join(ROOT, "business", "data"), { world: size, bench: true });
const fresh = () => createWorld(engineData);
const world0 = fresh();
const TOOLS = world0.tools;
const ALL_ROLES = Object.keys(business.roles).filter((k) => !k.startsWith("_"));

out("rules.json", {
  rules: { contact: business.contact, delivery: business.delivery, orders: business.orders, returns: business.returns, problems: business.problems, warranty: business.warranty, fix_club: business.fix_club, complaints: business.complaints, escalate_when: business.escalate_when },
  roles: business.roles, company_roles: w.company.roles, all_roles: ALL_ROLES, tools: TOOLS.map((t) => ({ name: t.name, roles: t.roles, description: t.description })),
});

function world0Probe() { return world0; }
// ------------------------------------------------------------ tool examples: each tool really called, as a role allowed to call it
const pick = {
  delivered: w.orders.filter((o) => o.status === "delivered" && o.placed_at >= daysAgo(25) && o.customer_id).sort((a, b) => b.placed_at.localeCompare(a.placed_at))[0],
  unpacked: w.orders.find((o) => o.status === "paid" && o.customer_id),
  packed: w.orders.find((o) => o.status === "packed") || w.orders.find((o) => o.status === "paid"),
  due: w.orders.find((o) => o.payment.status === "due"),
  repair: w.repairs.find((f) => f.status === "quote_sent") || w.repairs[0],
  ret: w.returns.find((r) => ["received", "in_transit", "label_sent"].includes(r.status)) || w.returns[0],
  kase: w.cases.find((c) => OPEN_CASE.includes(c.status)) || w.cases[0],
  po: w.purchase_orders.find((p) => p.status === "late") || w.purchase_orders.at(-1),
  emptySku: Object.keys(w.stock).find((k) => w.stock[k].on_hand === 0 && !sku[k]?.mto) || Object.keys(w.stock)[0],
  stockSku: Object.keys(w.stock).find((k) => w.stock[k].on_hand > 10 && sku[k]?.kind === "variant" && !sku[k]?.mto) || Object.keys(w.stock)[0],
};
// a recent delivered order with an item that can still be sent back, found by asking the engine itself
const returnable = (() => {
  try {
    const sa = world0Probe().session({ role: "support_agent" });
    for (const o of w.orders.filter((o) => o.status === "delivered" && o.placed_at >= daysAgo(28)).sort((a, b) => b.placed_at.localeCompare(a.placed_at)))
      for (const i of o.items) { const r = sa.call("check_return_eligibility", { order_number: o.number, sku: i.sku }); if (r.ok && (r.data.eligible ?? r.data.can_return ?? true)) return { order: o, sku: i.sku }; }
  } catch { /* engine mid-change */ }
  return { order: pick.delivered, sku: pick.delivered.items[0].sku };
})();
const warrantyOrder = w.orders.filter((o) => o.status === "delivered" && o.placed_at >= daysAgo(60) && o.items.some((i) => products.find((p) => p.id === productOf(i.sku))?.warranty?.months)).sort((a, b) => b.placed_at.localeCompare(a.placed_at))[0] || pick.delivered;
const warrantySku = warrantyOrder.items.find((i) => products.find((p) => p.id === productOf(i.sku))?.warranty?.months)?.sku || warrantyOrder.items[0].sku;
const postcodeOf = (o) => o.delivery?.address?.postcode || custById[o.customer_id]?.addresses?.[0]?.postcode;
const accProduct = products.find((p) => p.accessories?.length);
const supplierPick = w.suppliers.find((s) => !mtoSuppliers.has(s.id)) || w.suppliers[0];
const EX = { // tool → [role, input, the order whose customer an assistant verifies first]
  search_catalogue: ["assistant", { query: products[0].name.split(" ").at(-1).toLowerCase() }],
  get_product: ["assistant", { id: products[0].id }],
  compare_products: ["assistant", { ids: [products[0].id, products[1].id] }],
  check_compatibility: ["assistant", { a: accProduct?.id, b: accProduct?.accessories[0].sku }],
  check_stock: ["assistant", { sku: pick.emptySku }],
  search_knowledge: ["assistant", { query: "returns" }],
  get_policy: ["assistant", { id: (engineData.policies.find((p) => /return/.test(p.id)) || engineData.policies[0])?.id }],
  get_service: ["assistant", { id: engineData.services[0]?.id }],
  delivery_options: ["assistant", { skus: [pick.stockSku], postcode: postcodeOf(pick.delivered) }],
  payment_methods: ["assistant", { basket_total: 40, skus: [pick.stockSku] }],
  create_customer: ["support_agent", { name: "Sam Example", email: "sam.example@example.com", address: { line1: "1 Example Row", town: pick.delivered.delivery.address.town, postcode: postcodeOf(pick.delivered) } }],
  place_order: ["customer", { items: [{ sku: pick.stockSku, qty: 1 }], delivery_method: "standard", payment: { method: "card", card_number: "4242424242424242" } }, null, pick.delivered.customer_id],
  verify_customer: ["assistant", { reference: pick.delivered.number, email_or_postcode: postcodeOf(pick.delivered) }],
  get_customer: ["assistant", {}, pick.delivered],
  list_orders: ["assistant", {}, pick.delivered],
  get_order: ["assistant", { order_number: pick.delivered.number }, pick.delivered],
  cancel_order: ["assistant", { order_number: pick.unpacked?.number, reason: "Ordered the wrong one" }, pick.unpacked],
  update_order: ["assistant", { order_number: pick.unpacked?.number, delivery_method: "next-day" }, pick.unpacked],
  check_return_eligibility: ["assistant", { order_number: pick.delivered.number, sku: pick.delivered.items[0].sku }, pick.delivered],
  create_return: ["assistant", { order_number: returnable.order.number, items: [{ sku: returnable.sku, qty: 1 }], reason: "change_of_mind" }, returnable.order],
  report_problem: ["assistant", { order_number: pick.delivered.number, sku: pick.delivered.items[0].sku, problem: "damaged", resolution: "replacement", has_photo: true }, pick.delivered],
  register_product: ["assistant", { sku: warrantySku, order_number: warrantyOrder.number }, warrantyOrder],
  list_repairs: ["support_agent", { customer_id: pick.repair.customer_id }],
  get_repair: ["support_agent", { repair_number: pick.repair.number }],
  create_repair: ["assistant", { sku: pick.repair.sku, fault: "Will not switch on", order_number: pick.repair.order_number }, w.orders.find((o) => o.number === pick.repair.order_number)],
  approve_repair_quote: ["support_agent", { repair_number: pick.repair.number }],
  list_cases: ["support_agent", { customer_id: pick.kase.customer_id }],
  get_case: ["support_agent", { case_number: pick.kase.number }],
  open_case: ["assistant", { subject: "Question about delivery", category: "delivery", summary: "Customer asks when the parcel will arrive." }, pick.delivered],
  add_case_note: ["support_agent", { case_number: pick.kase.number, text: "Called the customer back." }],
  escalate: ["assistant", { to: "support_agent", reason: "Customer wants to speak to a person", summary: "Asked twice for a person.", contact: "someone@example.com" }],
  issue_refund: ["support_agent", { order_number: pick.delivered.number, amount: 5, reason: "Late parcel goodwill" }],
  approve_large_refund: ["manager", { order_number: pick.delivered.number, amount: Math.min(5, pick.delivered.totals.total), reason: "Example" }],
  add_goodwill_credit: ["support_agent", { customer_id: pick.delivered.customer_id, amount: 5, reason: "Sorry for the wait" }],
  // a pay-later order is placed first (as the customer), then finance settles it
  settle_pay_later: ["finance", {}, null, null, (wd) => ({ order_number: pick.due?.number || wd.session({ role: "customer", customer_id: pick.delivered.customer_id }).call("place_order", { items: [{ sku: pick.stockSku, qty: 1 }], delivery_method: "standard", payment: { method: "later", outcome: "approved" } }).data?.number })],
  advance_order: ["warehouse", { order_number: pick.packed?.number, to: "dispatched" }],
  receive_return: ["warehouse", { return_number: pick.ret.number, passed: true }],
  adjust_stock: ["warehouse", { sku: pick.stockSku, on_hand: 12 }],
  update_repair: ["technician", { repair_number: pick.repair.number, status: "in_repair" }],
  resolve_case: ["support_agent", { case_number: pick.kase.number, note: "Answered and closed." }],
  get_company: ["operations_assistant", {}],
  list_suppliers: ["buyer", {}],
  get_supplier: ["buyer", { id: supplierPick.id }],
  list_purchase_orders: ["buyer", { status: "late" }],
  get_purchase_order: ["buyer", { number: pick.po.number }],
  stock_history: ["operations_assistant", { sku: pick.emptySku }],
  get_monthly_summary: ["finance", { month: months.at(-2) }],
  ledger_search: ["finance", { reference: pick.delivered.number }],
  add_ledger_correction: ["finance", { amount: -1.5, reference: pick.delivered.number, reason: "Example correction" }],
  list_campaigns: ["marketing", {}],
  web_sessions: ["marketing", { from: daysAgo(3).slice(0, 10), to: TODAY }],
  list_contacts: ["support_lead", { customer_id: pick.kase.customer_id }],
  search_documents: ["operations_assistant", { query: "price" }],
  get_document: ["operations_assistant", { id: w.documents[0].id }],
  create_purchase_order: ["operations_assistant", { supplier_id: supplierPick.id, lines: [{ sku: supplierPick.skus[0], qty: supplierPick.min_order_qty }], note: "Example draft" }],
  // the operations assistant drafts an order first; a person approves it
  approve_purchase_order: ["manager", {}, null, null, (wd) => ({ number: wd.session({ role: "operations_assistant" }).call("create_purchase_order", { supplier_id: supplierPick.id, lines: [{ sku: supplierPick.skus[0], qty: supplierPick.min_order_qty }], note: "Draft to approve" }).data?.number })],
  check_books: ["finance", {}],
  business_snapshot: ["manager", {}],
  change_price: ["manager", { sku: pick.stockSku, new_price: r2((sku[pick.stockSku]?.price || 10) + 1), reason: "Example: supplier costs went up", from: daysAgo(-7).slice(0, 10) }],
  discontinue_product: ["manager", { product_id: productOf(pick.stockSku), stock: "sell_through", reason: "Example" }],
  launch_product: ["manager", {}, null, null, (wd) => { const pid = productOf(pick.stockSku); wd.session({ role: "manager" }).call("discontinue_product", { product_id: pid, stock: "sell_through", reason: "Example, so it can be launched again" }); return { product_id: pid, from: daysAgo(-7).slice(0, 10) }; }],
  receive_purchase_order: ["warehouse", { number: pick.po.number }],
  record_stock_count: ["warehouse", { sku: pick.stockSku, counted_qty: w.stock[pick.stockSku].on_hand, note: "Example count", adjust: false }],
  advance_day: ["manager", {}],
};
const trim = (v, depth = 0) => {
  if (Array.isArray(v)) { const a = v.slice(0, 3).map((x) => trim(x, depth + 1)); if (v.length > 3) a.push(`… ${v.length - 3} more`); return a; }
  if (v && typeof v === "object") { if (depth > 4) return "{…}"; return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x, depth + 1)])); }
  if (typeof v === "string" && v.length > 240) return v.slice(0, 240) + "…";
  return v;
};
const toolDocs = [];
const startState = JSON.stringify(world0.state);
const { loadState } = await import(path.join(ROOT, "infrastructure/engine/engine.js"));
for (const t of TOOLS) {
  const ex = EX[t.name];
  let example = null;
  if (ex && t.roles.includes(ex[0])) {
    const [role, input0, verifyWith, customer_id, setup] = ex;
    const wd = loadState(fresh(), startState);
    let input = input0, setupNote = null;
    if (setup) try { input = setup(wd); setupNote = true; } catch (e) { input = input0; }
    const s = wd.session({ role, customer_id: role === "customer" ? customer_id : undefined });
    let verified = null;
    if (verifyWith && role === "assistant") try { const v = s.call("verify_customer", { reference: verifyWith.number, email_or_postcode: postcodeOf(verifyWith) }); verified = v.ok ? { reference: verifyWith.number, email_or_postcode: postcodeOf(verifyWith) } : null; } catch { /* shown as unverified */ }
    const auditBefore = wd.state.audit.length;
    let r;
    try { r = s.call(t.name, input); } catch (e) { r = { ok: false, error: { code: "engine_error", message: `The engine threw while building this example: ${e.message}` } }; }
    const changes = wd.state.audit[auditBefore]?.changes || [];
    example = { role, customer_id: role === "customer" ? customer_id : null, verified, setup: setupNote, input, ok: r.ok, result: trim(r.ok ? r.data : r.error), changes: trim(changes) };
  }
  // and one refusal, to show the permission check: the first role that may not call it
  const refusedRole = ["assistant", "operations_assistant", "marketing", "customer"].find((x) => !t.roles.includes(x));
  let refusal = null;
  if (refusedRole) try { const r = world0.session({ role: refusedRole, customer_id: refusedRole === "customer" ? w.customers[0].id : undefined }).call(t.name, ex?.[1] || {}); refusal = { role: refusedRole, error: r.ok ? null : r.error }; } catch { /* engine mid-change: skip the refusal example */ }
  toolDocs.push({ name: t.name, description: t.description, roles: t.roles, input_schema: t.input_schema, example, refusal });
}
out("tools.json", toolDocs);

// ------------------------------------------------------------ connect: the OpenAPI document, generated by the server's own code
let openapi = null;
if (serverMods.openapi) {
  const doc = serverMods.openapi.openApi(world0, ALL_ROLES, serverMods.scenarios?.scenarioNames || []);
  openapi = { info: doc.info, paths: Object.entries(doc.paths).flatMap(([p, ops]) => Object.entries(ops).map(([method, o]) => ({ method: method.toUpperCase(), path: p, summary: o.summary, tool: p.startsWith("/tools/"), auth: !(Array.isArray(o.security) && o.security.length === 0), body: p.startsWith("/tools/") ? null : o.requestBody?.content?.["application/json"]?.schema || null, params: (o.parameters || []).filter((x) => x.in !== "header").map((x) => ({ name: x.name, in: x.in, schema: x.schema })) }))), path_count: Object.keys(doc.paths).length };
}
out("connect.json", { openapi, roles: ALL_ROLES, scenarios: serverMods.scenarios?.scenarioNames || [], sizes: fs.readdirSync(path.join(ROOT, "business/data/world-bench")).filter((d) => fs.statSync(path.join(ROOT, "business/data/world-bench", d)).isDirectory()) });

// ------------------------------------------------------------ situations: each one really applied, then compared with normal
const situations = [];
if (serverMods.scenarios && serverMods.diff) {
  const base = JSON.parse(startState);
  for (const s of serverMods.scenarios.listScenarios()) {
    const t0 = Date.now();
    let summary = {}, examples = [], error = null, now = NOW;
    try {
      const wd = loadState(fresh(), startState);
      serverMods.scenarios.applyScenario(wd, s.name);
      const d = serverMods.diff.diffStates(base, wd.state);
      summary = d.summary; now = wd.state.now;
      const seen = {};
      examples = d.changes.filter((c) => c.id != null && c.collection !== "web_sessions_daily" && (seen[c.collection] = (seen[c.collection] || 0) + 1) <= 2).slice(0, 12).map((c) => ({ collection: c.collection, id: c.id, change: c.change, fields: c.fields ? Object.keys(c.fields) : null }));
    } catch (e) { error = e.message; }
    situations.push({ ...s, now, summary, examples, error, ms: Date.now() - t0 });
  }
}
out("situations.json", situations);

// ------------------------------------------------------------ how results are judged: a real recorded run, made through the sandbox store
let judging = null;
if (serverMods.sandboxes) {
  try {
    const store = new serverMods.sandboxes.SandboxStore({ clock: () => Date.parse(NOW) });
    const { sandbox: sb, token } = store.create({ size, scenario: "normal" });
    const { token: aiToken } = store.mintRoleToken(sb, { role: "assistant", label: "my-ai" });
    const p = store.authenticate(aiToken).principal;
    const who = store.actAs(p, {});
    const o = pick.delivered;
    store.call(sb, p, who, "get_order", { order_number: o.number });
    store.call(sb, p, who, "verify_customer", { reference: o.number, email_or_postcode: postcodeOf(o) });
    store.call(sb, p, who, "get_order", { order_number: o.number });
    store.call(sb, p, who, "open_case", { subject: "Parcel question", category: "delivery", summary: "Customer asked where the parcel is." });
    store.call(sb, p, who, "issue_refund", { order_number: o.number, amount: 5, reason: "Customer asked for money back" });
    const diff = store.diff(sb);
    judging = { trace: sb.trace.map((e) => trim({ ...e, actor: { ...e.actor, token: "tok_assistant" } })), diff: { from: diff.from, now: diff.now, summary: diff.summary, changes: trim(diff.changes) }, owner_token_shape: token.replace(/_[^_]+$/, "_…") };
    store.remove(sb.id);
  } catch (e) { console.warn("! could not record an example run:", e.message); }
}
out("judging.json", judging);

// ------------------------------------------------------------ data dictionary: every record type, worked out from the data and docs/data-model.md
const modelMd = fs.existsSync(path.join(ROOT, "docs/data-model.md")) ? fs.readFileSync(path.join(ROOT, "docs/data-model.md"), "utf8") : "";
const docOf = {};
for (const m of modelMd.matchAll(/^\*\*([\w.]+)\.json\.\*\* (.+)$/gm)) docOf[m[1]] = m[2];
const PREFIX = [[/^ORD-\d+$/, "orders"], [/^C-\d+$/, "customers"], [/^RET-\d+$/, "returns"], [/^REG-\d+$/, "registrations"], [/^FIX-\d+$/, "repairs"], [/^CASE-\d+$/, "cases"], [/^CONV-\d+$/, "conversations"], [/^CT-\d+$/, "contacts"], [/^REV-\d+$/, "reviews"], [/^SUP-\d+$/, "suppliers"], [/^PO-\d+$/, "purchase_orders"], [/^MV-\d+$/, "stock_movements"], [/^SC-\d+$/, "stock_counts"], [/^LED-\d+$/, "ledger"], [/^CMP-\d+$/, "campaigns"], [/^DOC-\d+$/, "documents"], [/^OT-[A-Z0-9-]+$/, "products"], [/^SHP-[\d-]+$/, "orders"]];
const productIds = new Set(products.map((p) => p.id));
const targetOf = (v) => (typeof v !== "string" ? null : PREFIX.find(([re]) => re.test(v))?.[1] || (productIds.has(v) ? "products" : null));
// What each field means. Shared names first, then "collection.field" where a name means something particular.
const MEANING = {
  id: "The record's own id.", number: "The record's own number.", customer_id: "The customer it belongs to.", order_number: "The order it is about.", sku: "The stock-keeping unit: one exact thing we sell.", skus: "The SKUs involved.",
  name: "Its name.", email: "Email address. Always ends @example.com.", phone: "Phone number. Always 07700 900xxx.", addresses: "Delivery addresses; one is the default.", "addresses[].postcode": "Postcode. The areas are invented.", "addresses[].town": "Town (invented).",
  contact_preference: "How they like to be contacted.", marketing_opt_in: "Whether they agreed to marketing.", created_at: "When it was created.", credit_balance: "Account credit, in pounds.", notes: "Staff notes.",
  placed_at: "When the customer placed it.", status: "Where it has got to.", items: "What was bought.", "items[].qty": "How many.", "items[].unit_price": "Price paid for one, at the time.", "items[].name": "Name at the time of sale.",
  "totals.items": "Items, after any discount.", "totals.delivery": "Delivery charge.", "totals.discount": "Discount taken off.", "totals.total": "What the customer paid.",
  "payment.status": "Paid, declined, refunded, part refunded, due or nothing due.", "payment.method": "How it was paid, as shown to people.", "payment.refunded": "Money refunded so far (or taken off what is owed).",
  "delivery.method": "Standard, next-day (Sooner) or chilled.", shipments: "Parcels. An order can go in more than one.", "shipments[].carrier": "The courier.", "shipments[].eta": "The date it should arrive.", "shipments[].delivered_at": "When it arrived.", "shipments[].dispatched_at": "When it left the warehouse.", "shipments[].tracking": "Courier tracking number.",
  history: "Dated events, in order.", note: "A free-text note.", discount_code: "The campaign code used, if any.",
  reason: "Why.", refund_amount: "Money returned.", refunded_at: "When the refund was paid.", postage_deducted: "Return postage taken off the refund.",
  serial: "Serial number.", purchased_at: "Purchase date.", warranty_until: "Last day of warranty.", fault: "What is wrong, in the customer's words.", in_warranty: "Covered by the warranty.", quote: "The repair quote, if one was sent.", batch: "The purchase order the unit came from.",
  subject: "One-line subject.", category: "Kind of case.", is_complaint: "A formal complaint, with deadlines.", complaint_stage: "1 (support, 3 working days) or 2 (lead, 10 working days).", opened_at: "When it was opened.", related: "Linked records.", escalated_to: "The role it was passed to.",
  channel: "How they got in touch.", started_at: "When it started.", messages: "Each message, in order.", "messages[].from": "Who wrote it.", "messages[].text": "What was said.", case_number: "The case it belongs to.", summary: "A one-line summary.",
  at: "When it happened.", topic: "What it was about.", handled_by: "The role that handled it.", first_reply_minutes: "Minutes until the first reply.", resolve_minutes: "Minutes until it was resolved.", outcome: "How it ended.",
  rating: "Stars, 1 to 5.", text: "What they wrote.", date: "The day.", product: "The product id.", products: "Product ids.",
  supplier_id: "The supplier.", lines: "What was ordered.", "lines[].qty_received": "How many arrived.", "lines[].unit_cost": "Cost of one, to us.", ordered_at: "When it was sent to the supplier.", due_at: "When the supplier promised it.", expected_at: "The supplier's new date, if late.", received_at: "When it arrived.", paid_at: "When we paid the supplier.",
  lead_time_days: "Days from ordering to delivery.", min_order_qty: "Smallest quantity per line.", unit_cost: "Cost of one, per SKU.", payment_terms_days: "Days we have to pay.", reliability: "Share of deliveries on time (0 to 1).", town: "Town.", country: "Country.",
  qty: "Quantity: plus comes in, minus goes out.", reference: "The record that caused it.", system_qty: "What the system said.", counted_qty: "What was counted.", difference: "Counted minus system.", adjusted: "Whether stock was corrected.",
  type: "The kind of entry.", amount: "Signed amount in pounds: plus is money in.", month: "The month, YYYY-MM.",
  revenue: "Sales plus delivery income.", profit: "Gross margin minus operating costs.", cash_at_month_end: "Money in the bank at the month's end.", gross_margin: "Revenue minus refunds and cost of goods.", orders: "Paid orders.", new_customers: "First-time buyers.", repeat_rate: "Share of orders from returning customers.", average_order_value: "Average paid order.",
  spend: "Money spent.", visits: "Website visits.", orders_attributed: "Orders put down to it.", code: "Discount code.", discount_pct: "Discount, in percent.", start: "First day.", end: "Last day.",
  total_visits: "All visits that day.", baskets_started: "Baskets with something in.", baskets_abandoned: "Baskets left without buying.", baskets_lost_to_stockouts: "Baskets given up because something was out of stock.",
  title: "Title.", kind: "Kind of document.", written_at: "When it was written.", body: "The text (Markdown).", checks: "What a wrong document contradicts, for the validator.",
  old_price: "Price before.", new_price: "Price after.", on_hand: "Units on the shelf now.", restock_date: "When an empty shelf fills again.",
};
const typeOf = (k, v) => v === null ? "null" : Array.isArray(v) ? "list" : typeof v === "object" ? "object" : typeof v === "number" ? (/amount|price|cost|total|spend|revenue|profit|cash|refund|margin|balance|value|income|fee|sales|due$/.test(k) && !/qty|days|pct/.test(k) ? "money" : Number.isInteger(v) ? "whole number" : "number") : typeof v === "boolean" ? "yes/no" : /^\d{4}-\d\d-\d\dT/.test(v) ? "time (UTC)" : /^\d{4}-\d\d-\d\d$/.test(v) ? "date" : /^\d{4}-\d\d$/.test(v) ? "month" : "text";
function fieldsOf(records) {
  const f = new Map();
  const isMap = (o) => { const ks = Object.keys(o); return ks.length > 4 && ks.every((k) => productIds.has(k) || sku[k] || /^[a-z]+$/.test(k)) && ks.some((k) => productIds.has(k) || sku[k]); };
  const walk = (o, pre, seen) => {
    for (const [k, v] of Object.entries(o)) {
      const p = pre ? `${pre}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v) && isMap(v)) { add(p + "{key}", Object.values(v)[0], seen, "map"); continue; }
      add(p, v, seen);
      if (Array.isArray(v) && v[0] && typeof v[0] === "object") for (const x of v.slice(0, 3)) walk(x, p + "[]", seen);
      else if (v && typeof v === "object" && !Array.isArray(v)) walk(v, p, seen);
    }
  };
  const add = (p, v, seen, kind) => {
    const e = f.get(p) || { path: p, types: new Set(), present: 0, example: undefined, links: new Map() };
    if (!seen.has(p)) { e.present++; seen.add(p); }
    e.types.add(kind === "map" ? "map" : typeOf(p.split(".").at(-1), v));
    if (e.example === undefined && v != null && !(typeof v === "object")) e.example = v;
    if (e.example === undefined && Array.isArray(v) && v.length && typeof v[0] !== "object") e.example = v.slice(0, 3);
    const vals = Array.isArray(v) ? v : [v];
    for (const x of vals) { const t = targetOf(x); if (t) e.links.set(t, (e.links.get(t) || 0) + 1); }
    f.set(p, e);
  };
  for (const r of records) walk(r, "", new Set());
  return [...f.values()];
}
const COLL_ID = { customers: "id", orders: "number", returns: "number", registrations: "id", repairs: "number", cases: "number", conversations: "id", contacts: "id", reviews: "id", suppliers: "id", purchase_orders: "number", stock_movements: "id", stock_counts: "id", ledger: "id", campaigns: "id", documents: "id", monthly_summary: "month", web_sessions_daily: "date", price_history: "sku" };
const collections = [];
const sampleIds = (arr, idf) => { if (!arr.length) return []; const idx = [0, Math.floor(arr.length / 2), arr.length - 1]; return [...new Set(idx)].map((i) => arr[i]); };
for (const [name, data] of Object.entries(w)) {
  let records;
  if (Array.isArray(data)) records = data;
  else if (name === "stock") records = Object.entries(data).map(([k, v]) => ({ sku: k, ...v }));
  else records = [data];
  const sampleSrc = records.length > 400 ? records.filter((_, i) => i % Math.ceil(records.length / 400) === 0) : records;
  const fields = fieldsOf(sampleSrc).map((e) => {
    const leaf = e.path.replace(/\{key\}$/, "").replace(/^.*\./, "");
    const links = [...e.links.entries()].filter(([t]) => !(t === name && COLL_ID[name] === e.path)).map(([t]) => t);
    return { path: e.path, type: [...e.types].filter((t) => t !== "null").join(" or ") || "null", optional: e.present < sampleSrc.length || e.types.has("null"), meaning: MEANING[`${name}.${e.path}`] || MEANING[e.path.replace(/\{key\}$/, "")] || MEANING[leaf] || "", example: e.example, links };
  });
  collections.push({ name, file: `business/data/world-bench/${size}/${name}.json`, about: docOf[name] || "", count: records.length, shape: Array.isArray(data) ? "list" : name === "stock" ? "map of SKU → record" : "one object", id_field: COLL_ID[name] || null, fields, samples: sampleIds(records).map((r) => trim(r, -2)) });
}
// the catalogue lives in business/data/products, one file per product
collections.push({ name: "products", file: "business/data/products/<id>.json", about: "One product: name, category, story, variants (each a SKU with its price), accessories, warranty and pictures. Prices come only from here.", count: products.length, shape: "one file per product", id_field: "id", fields: fieldsOf(products).filter((e) => e.path.split(/[.[]/).length <= 3).map((e) => ({ path: e.path, type: [...e.types].join(" or "), optional: e.present < products.length, meaning: MEANING[e.path] || MEANING[e.path.replace(/^.*\./, "")] || "", example: e.example, links: [...e.links.keys()].filter((t) => t !== "products") })), samples: [trim(products[0], -2)] });
const edges = [];
for (const c of collections) for (const f of c.fields) for (const t of f.links) if (t !== c.name || f.path !== c.id_field) edges.push({ from: c.name, to: t, via: f.path });
// links made by value rather than by id: a discount code, the monthly sums, the page-view keys
if (collections.some((c) => c.name === "campaigns")) edges.push({ from: "orders", to: "campaigns", via: "discount_code = campaigns.code" });
if (collections.some((c) => c.name === "monthly_summary")) edges.push({ from: "monthly_summary", to: "ledger", via: "month (the ledger added up)" });
if (collections.some((c) => c.name === "web_sessions_daily")) edges.push({ from: "web_sessions_daily", to: "products", via: "product_page_views{product id}" });
const edgeKey = new Set();
const edgesOut = edges.filter((e) => { const k = e.from + ">" + e.to; if (edgeKey.has(k) || e.from === e.to) return false; edgeKey.add(k); return true; });
out("dictionary.json", { size, collections: collections.sort((a, b) => b.count - a.count), edges: edgesOut, id_formats: [...modelMd.matchAll(/^\| ([A-Z][\w ]+) \| `([^`]+)` \| (.*) \|$/gm)].map((m) => ({ record: m[1], example: m[2], note: m[3] })) });

// ------------------------------------------------------------ planted stories (spoilers)
const storiesMd = fs.existsSync(path.join(WORLD, "STORIES.md")) ? fs.readFileSync(path.join(WORLD, "STORIES.md"), "utf8") : "";
const IDRE = /\b(?:ORD|CASE|CONV|RET|REG|FIX|PO|SC|LED|CT|DOC|SHP|SUP|REV|CMP)-[\d-]+\b|\bC-\d{4,}\b|\bOT-[A-Z0-9-]+\b/g;
const stories = [];
for (const line of storiesMd.split("\n")) {
  const m = line.match(/^\| (\d+) \| (.+?) \| (.+?) \| (.+?) \|$/);
  if (!m) continue;
  let ids = [...new Set((m[3] + " " + m[4]).match(IDRE) || [])];
  const range = m[4].match(/ORD-(\d+) to ORD-(\d+)/);
  if (range) for (let n = +range[1]; n <= +range[2]; n++) ids.push(`ORD-${n}`);
  ids = [...new Set(ids)];
  stories.push({ n: +m[1], title: m[2], customer: m[3], records: m[4], ids });
}
const quirks = (storiesMd.split("## Deliberate quirks")[1] || "").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
out("stories.json", { stories, quirks });

// ------------------------------------------------------------ overview: today, recent activity, things that need someone
const ms = w.monthly_summary;
const byYear = {};
for (const s of ms) { const y = s.month.slice(0, 4); byYear[y] ||= { year: y, revenue: 0, profit: 0, orders: 0, refunds: 0, new_customers: 0 }; byYear[y].revenue += s.revenue; byYear[y].profit += s.profit; byYear[y].orders += s.orders; byYear[y].refunds += s.refunds; byYear[y].new_customers += s.new_customers; }
const prodSales = {};
for (const o of paid) for (const i of o.items) { const p = productOf(i.sku); (prodSales[p] ||= [0, 0]); prodSales[p][0] += i.qty * i.unit_price; prodSales[p][1] += i.qty; }
const placedBetween = (a, b) => w.orders.filter((o) => o.placed_at >= a && o.placed_at < b);
const summ = (os) => ({ placed: os.length, paid: os.filter((o) => o.payment.status !== "declined").length, money: r2(os.filter((o) => o.payment.status !== "declined").reduce((n, o) => n + o.totals.total, 0)) });
const thisM = ms.at(-1), prevM = ms.at(-2);
const prevStart = prevM.month + "-01T00:00:00Z", prevSame = prevM.month + NOW.slice(7);
const ledgerSum = (from, to, types) => r2(w.ledger.filter((e) => e.at >= from && e.at < to && types.includes(e.type)).reduce((n, e) => n + e.amount, 0));
const prevSoFar = ledgerSum(prevStart, prevSame, ["sale", "delivery_income"]);
const workingDaysSince = (t) => { let n = 0; const d = new Date(t.slice(0, 10) + "T12:00:00Z"); const end = new Date(TODAY + "T23:59:00Z"); for (d.setUTCDate(d.getUTCDate() + 1); d <= end; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() % 6) n++; return n; };
const lateParcels = [];
for (const o of w.orders) for (const s of o.shipments) if (late(s)) lateParcels.push({ order: o.number, customer: o.customer_id, name: custById[o.customer_id]?.name, shipment: s.id, status: s.status, eta: s.eta, days: s.eta ? daysBetween(s.eta, TODAY) : null, note: s.note || "" });
const waiting = {};
for (const o of w.orders) if (o.status === "paid" || o.status === "part_dispatched") for (const s of o.shipments) if (s.status === "pending") for (const k of s.skus) if (sku[k] && !sku[k].mto && (w.stock[k]?.on_hand ?? 1) === 0) (waiting[k] ||= []).push(o.number);
const empty = Object.entries(w.stock).filter(([k, v]) => v.on_hand === 0 && !sku[k]?.mto).map(([k, v]) => ({ sku: k, restock: v.restock_date, waiting: waiting[k] || [] }));
const low = Object.entries(w.stock).filter(([k, v]) => v.on_hand > 0 && v.on_hand <= 5 && !sku[k]?.mto).map(([k, v]) => ({ sku: k, on_hand: v.on_hand }));
const openCases = w.cases.filter((c) => OPEN_CASE.includes(c.status));
const needs = [];
const N = (o) => needs.push(o);
for (const e of empty) if (e.waiting.length) N({ kind: "stock", tone: "critical", who: "buyer", title: `${e.waiting.length} paid ${e.waiting.length === 1 ? "order is" : "orders are"} waiting for ${sku[e.sku]?.name}`, detail: `None on the shelf.${e.restock ? ` Next delivery expected ${nice(e.restock)}.` : ""}`, refs: [e.sku, ...e.waiting] });
for (const c of openCases.filter((c) => c.is_complaint)) {
  const target = c.complaint_stage === 2 ? (business.complaints?.stage_2_days ?? 10) : (business.complaints?.stage_1_days ?? 3), used = workingDaysSince(c.opened_at);
  if (used > target) N({ kind: "service", tone: "critical", who: c.complaint_stage === 2 ? "support_lead" : "support_agent", title: `Complaint ${c.number} is past its answer date`, detail: `Stage ${c.complaint_stage}: answer due within ${target} working days. Opened ${nice(c.opened_at.slice(0, 10))}, ${used} working days ago. “${c.subject}”`, refs: [c.number, c.customer_id, ...Object.values(c.related || {})] });
}
for (const p of poRows.filter((p) => p.st === "late")) N({ kind: "buying", tone: "serious", who: "buyer", title: `${supOut.find((s) => s.id === p.s)?.name} is ${p.late} days late with ${p.n}`, detail: `Due ${nice(p.d)}, now expected ${p.e ? nice(p.e) : "with no new date"}. ${p.l.map((l) => `${l[1]} × ${sku[l[0]]?.name}`).join(", ")}.`, refs: [p.n, p.s] });
for (const p of lateParcels) N({ kind: "delivery", tone: "serious", who: "support_agent", title: `Parcel ${p.shipment} is ${p.days} ${p.days === 1 ? "day" : "days"} late`, detail: `${p.name}'s parcel was due ${nice(p.eta)}. ${p.note}`.trim(), refs: [p.order, p.customer] });
for (const c of w.stock_counts.filter((c) => c.difference !== 0 && !c.adjusted)) N({ kind: "stock", tone: "warning", who: "warehouse", title: `A shelf count of ${sku[c.sku]?.name} is ${Math.abs(c.difference)} ${c.difference < 0 ? "short" : "over"} and not fixed`, detail: `Counted ${c.counted_qty}, the system says ${c.system_qty} (${nice(c.at.slice(0, 10))}). Stock has not been adjusted.`, refs: [c.id, c.sku] });
for (const c of w.contacts.filter((c) => c.outcome === "not_actioned")) N({ kind: "service", tone: "warning", who: "support_agent", title: `${/^[aeiou]/.test(c.channel) ? "An" : "A"} ${c.channel.replace("_", " ")} from ${custById[c.customer_id]?.name || "someone"} was never acted on`, detail: `${nice(c.at.slice(0, 10))}: ${c.summary || c.topic.replace(/_/g, " ")}`, refs: [c.id, c.customer_id].filter(Boolean) });
for (const a of anomalies.filter((a) => a.kind === "refund_mismatch" || a.kind === "refund_over_paid")) N({ kind: "money", tone: "warning", who: "finance", title: a.title, detail: a.detail, refs: a.refs });
const docsWrong = w.documents.filter((d) => d.status === "current" && d.checks?.length);
for (const d of docsWrong) N({ kind: "knowledge", tone: "warning", who: "manager", title: `“${d.title}” is marked current but disagrees with the records`, detail: `Staff and the operations assistant read it. It should be corrected or marked out of date.`, refs: [d.id] });
const listed = new Set(needs.flatMap((n) => n.refs));
for (const c of openCases.filter((c) => c.status === "escalated" && !listed.has(c.number))) N({ kind: "service", tone: "warning", who: c.escalated_to || "support_lead", title: `Case ${c.number} is waiting for a ${String(c.escalated_to || "person").replace("_", " ")}`, detail: c.subject, refs: [c.number, c.customer_id] });
for (const o of w.orders.filter((o) => o.status === "payment_failed")) N({ kind: "orders", tone: "warning", who: "support_agent", title: `Payment failed on ${o.number}`, detail: `Placed ${nice(o.placed_at.slice(0, 10))}. It is cancelled after 24 hours unless the customer pays.`, refs: [o.number, o.customer_id] });
for (const f of w.repairs.filter((f) => f.status === "quote_sent")) N({ kind: "repairs", tone: "info", who: "customer", title: `Repair ${f.number} is waiting for the customer to accept a quote`, detail: `${sku[f.sku]?.name}: ${f.fault}. Quote ${gbp(f.quote?.total ?? 0)}.`, refs: [f.number, f.customer_id] });
for (const r of w.returns.filter((r) => r.status === "received")) N({ kind: "returns", tone: "info", who: "warehouse", title: `Return ${r.number} has arrived and needs checking`, detail: `A refund of ${gbp(r.refund_amount)} is released after inspection.`, refs: [r.number, r.order_number] });
for (const o of w.orders.filter((o) => o.status === "packed")) N({ kind: "orders", tone: "info", who: "warehouse", title: `${o.number} is packed and ready to go`, detail: `Placed ${nice(o.placed_at.slice(0, 10))} for ${custById[o.customer_id]?.name}.`, refs: [o.number] });
const toPack = w.orders.filter((o) => o.status === "paid" && !o.shipments.some((s) => s.status === "pending" && s.skus.some((k) => waiting[k]?.includes(o.number))));
if (toPack.length) N({ kind: "orders", tone: "info", who: "warehouse", title: `${toPack.length} paid ${toPack.length === 1 ? "order is" : "orders are"} ready to pack`, detail: `Oldest placed ${nice(toPack.map((o) => o.placed_at).sort()[0].slice(0, 10))}.`, refs: toPack.map((o) => o.number) });

// Recent activity: every kind of event, newest first, up to "now"
const ev = [];
const E = (t, kind, id, text, extra = {}) => { if (t && t <= NOW && t >= daysAgo(21)) ev.push({ t: min(t), kind, id, text, ...extra }); };
for (const o of w.orders) {
  E(o.placed_at, o.payment.status === "declined" ? "payment" : "order", o.number, o.payment.status === "declined" ? `Payment declined on ${o.number}` : `${o.number} placed`, { c: o.customer_id, money: o.totals.total, n: o.items.reduce((a, i) => a + i.qty, 0) });
  for (const s of o.shipments) { E(s.dispatched_at, "dispatch", s.id, `${s.id} sent with ${s.carrier}`, { c: o.customer_id, ref: o.number }); E(s.delivered_at, "delivery", s.id, `${s.id} delivered`, { c: o.customer_id, ref: o.number }); }
}
for (const r of w.returns) { E(r.created_at, "return", r.number, `Return ${r.number} requested (${r.reason.replace(/_/g, " ")})`, { c: r.customer_id, ref: r.order_number }); E(r.refunded_at, "refund", r.number, `Refund paid for ${r.number}`, { c: r.customer_id, money: -r.refund_amount }); }
for (const c of w.contacts) E(c.at, "contact", c.id, `${c.channel.replace("_", " ")}: ${c.summary || c.topic.replace(/_/g, " ")}`, { c: c.customer_id, ref: c.case_number });
for (const c of w.cases) E(c.opened_at, "case", c.number, `${c.is_complaint ? "Complaint" : "Case"} ${c.number} opened: ${c.subject}`, { c: c.customer_id });
for (const c of w.conversations) E(c.started_at, "conversation", c.id, `${c.channel} conversation: ${c.summary || ""}`, { c: c.customer_id, ref: c.case_number });
for (const p of w.purchase_orders) { E(p.received_at, "supplier", p.number, `${supOut.find((s) => s.id === p.supplier_id)?.name} delivered ${p.number}`, { ref: p.supplier_id, money: -poValue(p) }); E(p.ordered_at, "purchase", p.number, `${p.number} sent to ${supOut.find((s) => s.id === p.supplier_id)?.name}`, { ref: p.supplier_id }); }
for (const c of w.stock_counts) E(c.at, "count", c.id, `Shelf count of ${sku[c.sku]?.name}: ${c.difference === 0 ? "matches" : (c.difference > 0 ? "+" : "") + c.difference}`, { ref: c.sku });
for (const m of w.stock_movements) if (["written_off", "count_adjustment"].includes(m.reason)) E(m.at, "stock", m.id, `${sku[m.sku]?.name}: ${m.qty > 0 ? "+" : ""}${m.qty} (${m.reason.replace(/_/g, " ")})`, { ref: m.reference });
for (const f of w.repairs) for (const h of f.history || []) E(h.at, "repair", f.number, `${f.number}: ${h.event}`, { c: f.customer_id });
ev.sort((a, b) => b.t.localeCompare(a.t));

const lastWeek = summ(placedBetween(daysAgo(7), NOW)), weekBefore = summ(placedBetween(daysAgo(14), daysAgo(7)));
const shipsOut = w.orders.flatMap((o) => o.shipments).filter((s) => ["in_transit", "delayed"].includes(s.status)).length;
out("overview.json", {
  now: NOW,
  today: summ(w.orders.filter((o) => o.placed_at.startsWith(TODAY) && o.placed_at <= NOW)),
  week: lastWeek, prev_week: weekBefore,
  month: { month: thisM.month, revenue: thisM.revenue, profit: thisM.profit, orders: thisM.orders, prev_month: prevM.month, prev_revenue: prevM.revenue, prev_profit: prevM.profit, prev_same_point: prevSoFar },
  cash: thisM.cash_at_month_end, prev_cash: prevM.cash_at_month_end,
  empty, low, late: lateParcels, in_transit: shipsOut, to_pack: toPack.length,
  open_cases: openCases.length, complaints_open: openCases.filter((c) => c.is_complaint).length,
  contacts_7d: w.contacts.filter((c) => c.at >= daysAgo(7) && c.at <= NOW).length,
  years: Object.values(byYear).map((y) => ({ ...y, revenue: r2(y.revenue), profit: r2(y.profit), refunds: r2(y.refunds) })),
  months: ms.map((m) => [m.month, m.revenue, m.profit, m.orders, m.cash_at_month_end]), // the fifth value is the cash at that month end
  top: Object.entries(prodSales).sort((a, b) => b[1][0] - a[1][0]).map(([p, v]) => ({ id: p, money: r2(v[0]), units: v[1] })),
  needs, activity: ev.slice(0, 160),
  company: { ...w.company, roles: undefined },
  totals: { customers: w.customers.length, orders: w.orders.length, paid: paid.length, suppliers: w.suppliers.length, pos: w.purchase_orders.length, ledger: w.ledger.length, contacts: w.contacts.length, cases: w.cases.length, repairs: w.repairs.length, reviews: w.reviews.length, returns: w.returns.length, conversations: w.conversations.length, movements: w.stock_movements.length },
});

// ------------------------------------------------------------ the command palette's index
out("search.json", {
  orders: w.orders.map((o) => [o.number, custNum(o.customer_id), o.placed_at.slice(0, 10), o.totals.total, o.status]),
  customers: custRows.map((r) => [r[0], r[1], r[2], r[3], r[11]]),
  cases: w.cases.map((c) => [c.number, c.subject, custNum(c.customer_id)]),
  pos: w.purchase_orders.map((p) => [p.number, p.supplier_id, p.status]),
  returns: w.returns.map((r) => [r.number, r.order_number, custNum(r.customer_id)]),
  repairs: w.repairs.map((f) => [f.number, f.sku, custNum(f.customer_id)]),
  documents: w.documents.map((d) => [d.id, d.title]),
  conversations: w.conversations.map((c) => [c.id, c.summary, custNum(c.customer_id)]),
});

// ------------------------------------------------------------ meta: loaded first, kept small
const storyCustomers = new Set(stories.map((s) => (s.customer.match(/C-\d+/) || [])[0]).filter(Boolean));
const demoCustomer = [...storyCustomers].map((id) => [id, (cAgg[id]?.orders || 0) + (cAgg[id]?.cases || 0) * 2 + w.repairs.filter((f) => f.customer_id === id).length * 3]).sort((a, b) => b[1] - a[1])[0]?.[0] || w.customers[0].id;
out("meta.json", {
  size, now: NOW, buckets: BUCKETS, company: { name: w.company.name, what_we_do: w.company.what_we_do, founded: w.company.founded, tagline: business.tagline },
  sku, products: productList.map(({ id, name, category, img, skus, mto, warranty, tagline }) => ({ id, name, category, img, skus, mto, warranty, tagline })),
  categories: business.categories, suppliers: Object.fromEntries(w.suppliers.map((s) => [s.id, s.name])),
  order_years: Object.keys(ordersByYear).sort().reverse(), order_year_counts: Object.fromEntries(Object.entries(ordersByYear).map(([y, r]) => [y, r.length])),
  ledger_years: ledgerYears, mv_years: Object.fromEntries(Object.entries(mvYears).map(([y, r]) => [y, [r[0][0], r.at(-1)[0]]])),
  tools: TOOLS.map((t) => [t.name, t.roles, !!t.needs_customer || /customer/.test(JSON.stringify(t.roles)) && t.roles.includes("assistant")]),
  roles: ALL_ROLES, role_about: Object.fromEntries(ALL_ROLES.map((r) => [r, typeof business.roles[r] === "string" ? business.roles[r] : business.roles[r]?.description || ""])),
  demo_customer: demoCustomer, segments: SEGMENTS, segment_counts: segCounts,
  badges: { needs: needs.length, open_cases: openCases.length, late: lateParcels.length, empty: empty.length, returns_open: w.returns.filter((r) => !["refunded", "rejected"].includes(r.status)).length, pos_open: poRows.filter((p) => !["received", "cancelled"].includes(p.st)).length },
});

// ------------------------------------------------------------ simulation runs, prospects and the team
// Read-only: sim/results/*/report.json (plus timeline/*.jsonl), business/data/prospects.json and business/data/staff.json.
// Each run is copied slimmed: the per-seed list is replaced by the mean of every number over the seeds.
{
  const mean = (a) => (a.length ? a.reduce((n, v) => n + v, 0) / a.length : 0);
  const meanOf = (seeds, arm) => {
    const keys = new Set(seeds.flatMap((s) => Object.entries(s[arm] || {}).filter(([, v]) => typeof v === "number").map(([k]) => k)));
    return Object.fromEntries([...keys].map((k) => [k, r2(mean(seeds.map((s) => s[arm]?.[k]).filter((v) => typeof v === "number")))]));
  };
  fs.mkdirSync(path.join(DIST, "data/sim"), { recursive: true });
  const resDir = path.join(ROOT, "simulation/simulator/results");
  const runs = [];
  for (const id of fs.existsSync(resDir) ? fs.readdirSync(resDir).sort() : []) {
    const rp = path.join(resDir, id, "report.json");
    if (!fs.existsSync(rp)) continue;
    const rep = read(rp);
    const { seeds = [], ...rest } = rep;
    const timeline = {}; // { seed: { baseline: [days], with_tool: [days] } }
    const tdir = path.join(resDir, id, "timeline");
    for (const f of fs.existsSync(tdir) ? fs.readdirSync(tdir).sort() : []) {
      const m = f.match(/^seed-(\d+)-(baseline|with-tool)\.jsonl$/); if (!m) continue;
      const days = fs.readFileSync(path.join(tdir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      (timeline[m[1]] ||= {})[m[2] === "baseline" ? "baseline" : "with_tool"] = days;
    }
    const slim = { id, ...rest, baseline_all: meanOf(seeds, "baseline"), with_tool_all: meanOf(seeds, "with_tool"), has_timeline: Object.keys(timeline).length > 0, saved: fs.statSync(rp).mtime.toISOString() };
    out(`sim/${id}.json`, slim);
    if (slim.has_timeline) out(`sim/${id}-timeline.json`, timeline);
    runs.push({ id, name: rest.meta?.name || id, tool: rest.meta?.tool || {}, role: rest.meta?.role, days: rest.meta?.days_compared, seeds: rest.meta?.seeds, start: rest.meta?.start_date, saved: slim.saved, payback: rest.payback, roi: rest.roi, tool_cost_per_month: rest.meta?.tool_cost_per_month, cash: rest.cash, time_freed: rest.time_freed });
  }
  runs.sort((a, b) => b.saved.localeCompare(a.saved));
  out("sim/index.json", { runs });

  // prospects: no email addresses, street addresses or postcodes
  const pr = read(path.join(ROOT, "business/data/prospects.json"));
  out("sales.json", pr.map((p) => ({ id: p.id, name: p.name, sector: p.sector, staff: p.staff, town: p.location?.town, needs: p.needs, budget_band: p.budget_band, monthly_budget: p.monthly_budget, decision_maker: p.decision_maker?.name, decision_from: p.decision_maker?.from, channel: p.preferred_channel, status: p.status, last_contacted: p.last_contacted, notes: p.notes, reply: p.private?.reply_propensity })));

  // the team and the cost assumptions that turn hours into pay
  const st = read(path.join(ROOT, "business/data/staff.json")), co = read(path.join(ROOT, "business/data/costs.json"));
  out("people.json", { days: st.days, day_start: st.day_start, reference_orders_per_day: st.reference_orders_per_day, on_cost_rate: co.on_cost_rate, overtime_rate: co.overtime_rate, staff: st.staff.map(({ customer_clash, ...p }) => p) });
}

// ------------------------------------------------------------ report
const total = Object.values(sizes).reduce((a, b) => a + b, 0);
const big = Object.entries(sizes).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${(v / 1024).toFixed(0)} KB`).join(", ");
console.log(`Back office built for "${size}" in business/backoffice/dist: ${Object.keys(sizes).length} data files, ${(total / 1024 / 1024).toFixed(2)} MB in all. Largest: ${big}.`);
console.log(`meta.json ${(sizes["meta.json"] / 1024).toFixed(0)} KB, overview.json ${(sizes["overview.json"] / 1024).toFixed(0)} KB. Needs: ${needs.length}. Segments: ${JSON.stringify(segCounts)}. Tools with examples: ${toolDocs.filter((t) => t.example).length}/${toolDocs.length}. Situations: ${situations.map((s) => s.name + (s.error ? "!" : "")).join(", ")}.`);
