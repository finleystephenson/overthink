// Shared pieces: safe HTML, data loading, formatting, the status vocabulary, links between records,
// permissions (read from the engine's own tool table), icons, tables, lists with filters and saved views, the drawer.

// ---------------------------------------------------------------- safe HTML
// html`...${value}...` escapes every value unless it is raw() or another html`` result.
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
const part = (v) => (v == null || v === false ? "" : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join("") : esc(v));
export function html(strings, ...vals) { let s = strings[0]; vals.forEach((v, i) => { s += part(v) + strings[i + 1]; }); return new Raw(s); }
export const attr = (name, on) => (on ? raw(` ${name}`) : "");

// ---------------------------------------------------------------- data loading (cached, on demand)
const cache = new Map();
export function load(file) {
  if (!cache.has(file)) cache.set(file, fetch("business/data/" + file).then((r) => { if (!r.ok) throw new Error(`Could not load ${file} (${r.status})`); return r.json(); }));
  return cache.get(file);
}
export const S = { meta: null, role: "manager", spoilers: false };
export const custId = (n) => (n ? "C-" + n : null);
export const people = (id) => load(`people/p-${id ? parseInt(String(id).replace("C-", ""), 10) % S.meta.buckets : "x"}.json`);
export async function ownerOf(id) { const refs = await load("refs.json"); return id in refs ? custId(refs[id]) : undefined; }
let custIndex = null;
export async function customers() {
  if (!custIndex) {
    const rows = await load("customers.json");
    custIndex = new Map(rows.map((r) => [custId(r[0]), { id: custId(r[0]), name: r[1], town: r[2], postcode: r[3], joined: r[4], orders: r[5], spend: r[6], last: r[7], returns: r[8], cases: r[9], open: r[10], email: r[11], credit: r[12], contacts: r[13], segs: r[14] ? r[14].split(",") : [], complaints: r[15], optin: !!r[16] }]));
  }
  return custIndex;
}
export async function allOrders() {
  const years = await Promise.all(S.meta.order_years.map((y) => load(`orders/y${y}.json`)));
  return years.flat().map(orderRow);
}
export const orderRow = (r) => ({ id: r[0], c: custId(r[1]), at: r[2], st: r[3], total: r[4], prods: r[5] ? r[5].split(",") : [], pay: r[6], ship: r[7], flags: r[8], qty: r[9], method: r[10], refunded: r[11] });

// Find any record by its id, wherever it lives.
export async function findRecord(id) {
  if (/^C-\d+$/.test(id)) { const b = await people(id); return b.customers.find((c) => c.id === id) ? { type: "customer", rec: b.customers.find((c) => c.id === id), bundle: b } : null; }
  if (/^(ORD|RET|REG|FIX|CASE|CONV|CT|REV|SHP)-/.test(id)) {
    const owner = await ownerOf(id);
    if (owner === undefined) return null;
    const b = await people(owner);
    if (id.startsWith("SHP-")) { const o = b.orders.find((o) => o.shipments.some((s) => s.id === id)); return o ? { type: "shipment", rec: o.shipments.find((s) => s.id === id), order: o, bundle: b } : null; }
    const coll = { ORD: "orders", RET: "returns", REG: "registrations", FIX: "repairs", CASE: "cases", CONV: "conversations", CT: "contacts", REV: "reviews" }[id.split("-")[0]];
    const rec = b[coll].find((r) => (r.number || r.id) === id);
    return rec ? { type: coll, rec, bundle: b } : null;
  }
  if (/^(PO|SUP)-/.test(id)) { const d = await load("buying.json"); const rec = id.startsWith("PO") ? d.pos.find((p) => p.n === id) : d.suppliers.find((s) => s.id === id); return rec ? { type: id.startsWith("PO") ? "purchase_order" : "supplier", rec } : null; }
  if (/^SC-/.test(id)) { const d = await load("ops.json"); const rec = d.counts.find((c) => c.id === id); return rec ? { type: "stock_count", rec } : null; }
  if (/^DOC-/.test(id)) { const d = await load("documents.json"); const rec = d.find((x) => x.id === id); return rec ? { type: "document", rec } : null; }
  if (/^CMP-/.test(id)) { const d = await load("marketing.json"); const rec = d.campaigns.find((x) => x.id === id); return rec ? { type: "campaign", rec } : null; }
  if (/^LED-/.test(id)) {
    const y = Object.entries(S.meta.ledger_years).find(([, v]) => id >= v.first && id <= v.last)?.[0];
    if (!y) return null;
    const r = (await load(`ledger/y${y}.json`)).find((e) => e[0] === id);
    return r ? { type: "ledger", rec: { id: r[0], at: r[1], type: r[2], amount: r[3], reference: r[4], reason: r[5] } } : null;
  }
  if (/^MV-/.test(id)) {
    const y = Object.entries(S.meta.mv_years).find(([, v]) => id >= v[0] && id <= v[1])?.[0];
    if (!y) return null;
    const r = (await load(`stock/y${y}.json`)).find((e) => e[0] === id);
    return r ? { type: "movement", rec: { id: r[0], at: r[1], sku: r[2], qty: r[3], reason: r[4], reference: r[5] } } : null;
  }
  return null;
}

// ---------------------------------------------------------------- formatting
const gbp0 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const gbp2 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = new Intl.NumberFormat("en-GB");
export const money = (v) => (v == null ? "–" : gbp0.format(Math.round(v)).replace("-£", "−£"));
export const money2 = (v) => (v == null ? "–" : gbp2.format(v).replace("-£", "−£"));
export const num = (v) => (v == null ? "–" : n0.format(v));
export const pct = (v, dp = 0) => (v == null || !isFinite(v) ? "–" : (v * 100).toFixed(dp) + "%");
export const compact = (v) => { const a = Math.abs(v), s = v < 0 ? "−" : ""; return a >= 1e6 ? s + "£" + (a / 1e6).toFixed(1) + "m" : a >= 1000 ? s + "£" + (a / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : s + "£" + Math.round(a); };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const date = (t) => { if (!t) return "–"; const [y, m, d] = t.slice(0, 10).split("-"); return `${+d} ${MON[m - 1]} ${y}`; };
export const dateShort = (t) => { if (!t) return "–"; const [, m, d] = t.slice(0, 10).split("-"); return `${+d} ${MON[m - 1]}`; };
export const time = (t) => (t && t.length > 10 ? t.slice(11, 16) : "");
export const dateTime = (t) => (t ? `${date(t)}${time(t) ? ", " + time(t) : ""}` : "–");
export const monthLabel = (m, long) => `${(long ? MONTH : MON)[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
export const monShort = (m) => `${MON[+m.slice(5, 7) - 1]} ’${m.slice(2, 4)}`;
export const dayName = (t) => DAY[new Date(t.slice(0, 10) + "T12:00:00Z").getUTCDay()];
export const longNow = (t) => { const d = new Date(t); return `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${time(t)}`; };
export function ago(t) {
  if (!t) return "";
  const days = Math.round((Date.parse(S.meta.now.slice(0, 10)) - Date.parse(t.slice(0, 10))) / 864e5);
  if (days === 0) return "today"; if (days === 1) return "yesterday"; if (days === -1) return "tomorrow";
  if (days < 0) return `in ${-days} days`;
  if (days < 60) return `${days} days ago`;
  if (days < 730) return `${Math.round(days / 30.4)} months ago`;
  return `${(days / 365.25).toFixed(1).replace(/\.0$/, "")} years ago`;
}
export const daysFrom = (a, b) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 864e5);
export const plural = (n, one, many = one + "s") => `${num(n)} ${n === 1 ? one : many}`;
export const words = (s) => (s === "story" ? "other" : s ? String(s).replace(/_/g, " ") : "");
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
export const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const minutes = (m) => (m == null ? "–" : m < 1 ? "under 1 min" : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${(m / 60).toFixed(1).replace(/\.0$/, "")} h` : `${(m / 1440).toFixed(1).replace(/\.0$/, "")} d`);
export const change = (now, before) => (before ? (now - before) / Math.abs(before) : null);
export const delta = (now, before, { good = 1, fmt = (v) => pct(Math.abs(v)) } = {}) => {
  const c = change(now, before);
  if (c == null || !isFinite(c)) return "";
  const cls = c === 0 ? "" : c * good > 0 ? "up" : "down";
  return html`<b class="${cls}">${c > 0 ? "↑" : c < 0 ? "↓" : ""} ${fmt(c)}</b>`;
};

// ---------------------------------------------------------------- plain-English labels and states: one meaning everywhere
const STATUS = {
  placed: ["Placed", "info"], paid: ["Paid, not packed", "info"], payment_failed: ["Payment failed", "crit"], packed: ["Packed", "info"], dispatched: ["On its way", "info"],
  delivered: ["Delivered", "good"], cancelled: ["Cancelled", ""], part_dispatched: ["Partly sent", "warn"],
  declined: ["Declined", "crit"], refunded: ["Refunded", ""], part_refunded: ["Part refunded", "warn"], due: ["Due (pay later)", "warn"], nothing_due: ["Nothing due", ""],
  pending: ["Waiting to be packed", "warn"], in_transit: ["In transit", "info"], delayed: ["Delayed", "serious"], lost: ["Lost", "crit"],
  requested: ["Requested", "info"], label_sent: ["Label sent", "info"], received: ["Arrived, to check", "warn"], rejected: ["Rejected", "serious"],
  awaiting_item: ["Waiting for item", "info"], assessing: ["Being checked", "info"], quote_sent: ["Quote sent", "warn"], approved: ["Quote accepted", "info"], in_repair: ["Being repaired", "info"], repaired: ["Repaired", "good"], returned: ["Sent back", "good"], unrepairable: ["Can't be fixed", "serious"],
  open: ["Open", "warn"], escalated: ["Passed to a person", "serious"], waiting_customer: ["Waiting for customer", "info"], resolved: ["Resolved", "good"], closed: ["Closed", ""],
  ordered: ["Ordered", "info"], late: ["Late", "serious"], part_received: ["Part arrived", "warn"], draft: ["Draft", ""], awaiting_approval: ["Needs approval", "warn"],
  answered: ["Answered", "good"], order_changed: ["Order changed", "good"], case_opened: ["Case opened", "info"], not_actioned: ["Never acted on", "crit"], waiting: ["Waiting", "warn"],
  current: ["Current", "good"], out_of_date: ["Out of date", "warn"], new: ["New", "info"], selling: ["Selling", "good"], out_of_stock: ["Out of stock", "crit"], not_sold: ["Not sold yet", ""],
};
const CTX = { pay: { paid: ["Paid", "good"] }, po: { received: ["Arrived", "good"] }, ret: { received: ["Arrived, to check", "warn"], refunded: ["Refunded", "good"] }, rep: { received: ["Arrived at bench", "info"], declined: ["Quote declined", ""] } };
const entry = (s, ctx) => CTX[ctx]?.[s] || STATUS[s] || [cap(words(s)), ""];
export const statusLabel = (s, ctx) => entry(s, ctx)[0];
export const pill = (s, ctx, title) => { const [l, t] = entry(s, ctx); return html`<span class="pill ${t}" ${title ? raw(`title="${esc(title)}"`) : ""}>${l}</span>`; };
export const tonePill = (text, tone, title) => html`<span class="pill ${tone}" ${title ? raw(`title="${esc(title)}"`) : ""}>${text}</span>`;
export const ROLE_NAMES = { customer: "Customer", assistant: "AI assistant", support_agent: "Support agent", support_lead: "Support lead", technician: "Technician", coordinator: "Coordinator", warehouse: "Warehouse", buyer: "Buyer", finance: "Finance", marketing: "Marketing", manager: "Manager", operations_assistant: "Operations assistant (AI)" };
export const roleName = (r) => ROLE_NAMES[r] || cap(words(r));
export const isAI = (r) => r === "assistant" || r === "operations_assistant";
export const CHANNELS = { web_chat: "Web chat", web: "Web chat", email: "Email", phone: "Phone", text: "Text", sms: "Text" };
export const FLAGS = { R: "Has a return", C: "Has a support case", L: "A parcel is late", D: "Used a discount code", X: "A parcel was lost" };
export const flagIcons = (f) => [...(f || "")].map((c) => html`<span class="flag ${c}" title="${FLAGS[c]}" aria-label="${FLAGS[c]}">${c}</span>`);

// ---------------------------------------------------------------- icons: one stroke family, drawn here
const P = {
  filter: "M4 6h16 M7 12h10 M10 18h4", home: "M4 10.5 12 4l8 6.5V20H4z M9.5 20v-5h5v5", cart: "M3 4h2.5l2.2 10.5h10.6L20.5 7H6.4 M9.5 19.5h.01 M17 19.5h.01", box: "M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z M3.5 7.5 12 11.5l8.5-4 M12 11.5v9",
  users: "M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M2.5 20c.5-3.6 3-5.5 6-5.5s5.5 1.9 6 5.5 M16 4.3a3.5 3.5 0 0 1 0 6.4 M18 14.8c2 .6 3.2 2.4 3.5 5.2", headset: "M4 15v-3a8 8 0 0 1 16 0v3 M4 15a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2z M20 15a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2z M17 17c0 2-2 3-5 3",
  truck: "M2.5 6.5h11v9h-11z M13.5 9.5h4l3 3v3h-7 M6.5 18.5a1.5 1.5 0 1 0 0-.01 M17 18.5a1.5 1.5 0 1 0 0-.01", coins: "M12 6c4.4 0 8-1.1 8-2.5S16.4 1 12 1 4 2.1 4 3.5 7.6 6 12 6z M4 3.5v5C4 9.9 7.6 11 12 11s8-1.1 8-2.5v-5 M4 8.5v5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-5 M4 13.5v5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-5",
  megaphone: "M3.5 10v4h3l7 4.5v-13l-7 4.5z M17 9a4 4 0 0 1 0 6 M6.5 14l1 5h2.5l-1-5", code: "m8.5 7-5 5 5 5 M15.5 7l5 5-5 5 M13.5 4.5l-3 15", search: "M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z m5-1.5 4 4",
  trend: "M3 17l5.5-5.5 4 3.5L20 7 M15 7h5v5", person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4.5 20.5c.6-4 3.6-6 7.5-6s6.9 2 7.5 6", target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z M12 12h.01",
  chev: "m9 5 7 7-7 7", x: "M6 6l12 12M18 6 6 18", alert: "M12 3.5 21.5 20h-19z M12 10v4.5 M12 17.5h.01", check: "m5 12.5 4.5 4.5L19 7.5", clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3 2",
  lock: "M6 10.5h12v10H6z M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3", copy: "M9 9h11v11H9z M5 15H4V4h11v1", ext: "M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6", card: "M2.5 6h19v12h-19z M2.5 10h19 M6 15h4",
  ret: "M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11", wrench: "M14.5 6.5a4 4 0 0 0-5.3 5.3L3.5 17.5 6.5 20.5l5.7-5.7a4 4 0 0 0 5.3-5.3l-2.6 2.6-2.6-.7-.7-2.6z", chat: "M4 5h16v11H9l-5 4z",
  doc: "M6 3h8.5L19 7.5V21H6z M14 3v5h5 M9 13h7 M9 17h5", stock: "M3 21h18 M5 21V11l7-4 7 4v10 M9 21v-6h6v6", factory: "M3 21V10l5 3V10l5 3V10l5 3V4h3v17z", ledger: "M5 3.5h12.5A1.5 1.5 0 0 1 19 5v15.5H6.5A1.5 1.5 0 0 1 5 19z M5 17h14 M9 7.5h6 M9 11h6",
  bolt: "M13 2.5 4.5 14H12l-1 7.5L19.5 10H12z", flag: "M5 21V4 M5 4h11l-2 4 2 4H5", eye: "M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z M12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1", star: "m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z", plus: "M12 5v14M5 12h14", minus: "M5 12h14",
  arrow: "M5 12h14 M13 6l6 6-6 6", sort: "M7 10l5-5 5 5", sun: "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4", moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z",
  graph: "M5 6.5a2 2 0 1 0 0-.01 M19 6.5a2 2 0 1 0 0-.01 M12 18.5a2 2 0 1 0 0-.01 M7 6.5h10 M6 8.3l5 8.4 M18 8.3l-5 8.4", shield: "M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z", book: "M4 4.5h6a2 2 0 0 1 2 2V20a1.5 1.5 0 0 0-1.5-1.5H4z M20 4.5h-6a2 2 0 0 0-2 2V20a1.5 1.5 0 0 1 1.5-1.5H20z",
  plug: "M9 3v5 M15 3v5 M6.5 8h11v3a5.5 5.5 0 0 1-11 0z M12 16.5V21", scale: "M12 4v16 M6 20h12 M4 8h16 M4 8l-2 6a3 3 0 0 0 6 0z M20 8l-2 6a3 3 0 0 0 6 0z", play: "M7 4.5v15l12-7.5z", spark: "M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l2.5 2.5 M15.5 15.5 18 18 M6 18l2.5-2.5 M15.5 8.5 18 6",
};
export const icon = (name, cls = "") => raw(`<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[name] || P.box}"/></svg>`);

// ---------------------------------------------------------------- people and products
const AV = ["#5FC3EC", "#FF7433", "#F45BA6", "#FFC72C", "#B5E53A", "#C9B9F2"];
export const initials = (name) => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
export const avatar = (id, name, cls = "") => html`<span class="avatar ${cls}" style="background:${AV[(parseInt(String(id).replace(/\D/g, ""), 10) || 0) % AV.length]}" aria-hidden="true">${initials(name)}</span>`;
export const skuName = (k) => S.meta.sku[k]?.name || k;
export const skuImg = (k, cls = "thumb") => { const s = S.meta.sku[k]; return s?.img ? html`<img class="${cls}" src="${s.img}" alt="" loading="lazy" width="32" height="32">` : html`<span class="${cls}"></span>`; };
export const productById = (id) => S.meta.products.find((p) => p.id === id);
export const prodImg = (id, cls = "thumb") => { const p = productById(id); return p?.img ? html`<img class="${cls}" src="${p.img}" alt="" loading="lazy" width="32" height="32">` : html`<span class="${cls}"></span>`; };
export const prodLink = (id) => { const p = productById(id); return p ? html`<a class="prod" href="#/products/${id}">${prodImg(id)}<span>${p.name}</span></a>` : id; };
export const skuLink = (k) => { const s = S.meta.sku[k]; return s ? html`<a class="prod" href="#/products/${s.product}">${skuImg(k)}<span>${s.name}</span></a>` : html`<span class="chip">${k}</span>`; };

// ---------------------------------------------------------------- links between records
export function href(id) {
  if (!id) return null;
  if (/^OT-/.test(id)) return S.meta.sku[id] ? `#/products/${S.meta.sku[id].product}` : null;
  if (productById(id)) return `#/products/${id}`;
  if (/^(ORD|C|RET|REG|FIX|CASE|CONV|CT|REV|SHP|PO|SUP|SC|DOC|CMP|LED|MV)-[\w-]+$/.test(id)) return `#/r/${id}`;
  return null;
}
export const chip = (id, label) => { const h = href(id), cls = label && label !== id ? "chip name" : "chip"; return h ? html`<a class="${cls}" href="${h}" data-rec="${id}">${label || id}</a>` : html`<span class="${cls}">${label || id}</span>`; };
export const idLink = (id) => (id ? html`<a class="id" href="${href(id)}" data-rec="${id}">${id}</a>` : "–");
export async function whoLink(id) {
  if (!id) return html`<span class="muted">Not a customer yet</span>`;
  const c = (await customers()).get(id);
  if (!canSeeCustomer(id)) return html`<span class="who">${avatar(id, "?")}${redact(c?.name || id, false)}</span>`;
  return html`<a class="who" href="#/r/${id}" data-rec="${id}">${avatar(id, c?.name)}<span>${c?.name || id}</span></a>`;
}
export const whoSync = (id, cmap) => {
  if (!id) return html`<span class="muted">Not a customer yet</span>`;
  const c = cmap.get(id);
  if (!canSeeCustomer(id)) return html`<span class="who">${avatar(id, "?")}${redact(c?.name || id, false)}</span>`;
  return html`<a class="who" href="#/r/${id}" data-rec="${id}">${avatar(id, c?.name)}<span>${c?.name || id}</span></a>`;
};

// ---------------------------------------------------------------- permissions, read from the engine's own tool table
export const SCOPED_ROLES = ["customer", "assistant"];
const AREA_TOOL = { orders: "get_order", customers: "get_customer", contacts: "list_contacts", cases: "get_case", stock: "stock_history", buying: "list_purchase_orders", ledger: "ledger_search", finance: "get_monthly_summary", marketing: "list_campaigns", documents: "search_documents", company: "get_company", repairs: "get_repair", products: "check_stock" };
const tool = (name) => S.meta.tools.find((t) => t[0] === name);
export const scopedCustomer = () => (SCOPED_ROLES.includes(S.role) ? S.meta.demo_customer : null);
/** "all", "one" (a single verified customer) or "none". */
export function access(area, role = S.role) {
  if (["overview", "products", "systems", "rules", "catalogue"].includes(area)) return "all";
  if (area === "cost") return access("stock", role);
  if (area === "reviews") return access("company", role);
  const t = tool(AREA_TOOL[area] || area);
  if (!t || !t[1].includes(role)) return "none";
  return SCOPED_ROLES.includes(role) ? "one" : "all";
}
export const toolFor = (area) => AREA_TOOL[area] || area;
export const whoMay = (area) => { const t = tool(AREA_TOOL[area === "cost" ? "stock" : area] || area); return t ? t[1].map(roleName) : []; };
export function lockPanel(area, what) {
  const list = whoMay(area);
  return html`<div class="lock" role="note"><div class="ic">${icon("lock")}</div>
    <h2>${roleName(S.role)} can't see ${what}</h2>
    <p>The engine only lets ${list.length ? list.slice(0, -1).join(", ") + (list.length > 1 ? " and " : "") + list.at(-1) : "nobody"} do this. Anyone else who calls <code>${toolFor(area === "cost" ? "stock" : area)}</code> gets <code>forbidden</code>.</p>
    <p class="small muted">Switch “View as” to Manager to see everything, or open <a href="#/systems/roles">Company structure and roles</a> for the full table.</p></div>`;
}
export const canSeeCustomer = (id) => { const a = access("customers"); return a === "all" || (a === "one" && id === scopedCustomer()); };
export const redact = (text, ok) => (ok ? text : html`<span class="redacted" title="Hidden for this role" aria-label="Hidden for this role">${"•".repeat(Math.min(14, String(text).length || 6))}</span>`);

// ---------------------------------------------------------------- tooltip
const tipEl = () => document.getElementById("tip");
export function showTip(e, content) {
  const t = tipEl(); t.innerHTML = String(content); t.hidden = false;
  const r = t.getBoundingClientRect(); let x = e.clientX + 14, y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  t.style.left = Math.max(8, x) + "px"; t.style.top = Math.max(8, y) + "px";
}
export const hideTip = () => { tipEl().hidden = true; };

// ---------------------------------------------------------------- skeletons and empty states
export const skeleton = (rows = 3) => html`<div class="stack" aria-busy="true" aria-label="Loading"><span class="skel" style="height:28px;width:280px"></span><span class="skel" style="height:86px"></span>${Array.from({ length: rows }, () => html`<span class="skel" style="height:180px"></span>`)}</div>`;
export const emptyState = (title, hint) => html`<div class="empty"><b>${title}</b>${hint || ""}</div>`;

// ---------------------------------------------------------------- local preferences (per viewer)
export const pref = {
  get(k, d) { try { const v = localStorage.getItem("bo-" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("bo-" + k, JSON.stringify(v)); } catch { /* private window: fine */ } },
};

// ---------------------------------------------------------------- tables: sticky header, sortable, paged, keyboard, rows open their record
// cols: [{ label, sort: (row) => value, cell: (row) => html, num, cls, title }]
export function table(el, { cols, rows, pageSize = 50, rowId, onOpen, empty = "Nothing matches.", sortCol = null, sortDir = -1, caption, cards = true, tall = false, foot }) {
  let page = 0, sc = sortCol, sd = sortDir, kb = -1, slice = [];
  const draw = () => {
    let list = rows;
    if (sc != null && cols[sc].sort) { const f = cols[sc].sort; list = [...rows].sort((a, b) => { const x = f(a), y = f(b); return (x == null ? -Infinity : x) > (y == null ? -Infinity : y) ? sd : (x == null ? -Infinity : x) < (y == null ? -Infinity : y) ? -sd : 0; }); }
    const pages = Math.max(1, Math.ceil(list.length / pageSize)); page = Math.min(page, pages - 1);
    slice = list.slice(page * pageSize, page * pageSize + pageSize);
    el.innerHTML = html`<div class="tbl-wrap ${tall ? "tall" : ""}" tabindex="0" aria-label="${caption || "Table"}. Use the arrow keys to move and Enter to open."><table class="${cards ? "cards" : ""}">${caption ? html`<caption class="sr">${caption}</caption>` : ""}<thead><tr>${cols.map((c, i) => html`<th scope="col" class="${c.num ? "num" : ""} ${c.cls || ""}" ${c.sort ? raw(`aria-sort="${sc === i ? (sd > 0 ? "ascending" : "descending") : "none"}"`) : ""} ${c.title ? raw(`title="${esc(c.title)}"`) : ""}>${c.sort ? html`<button data-sort="${i}">${c.label}${raw('<svg class="icon arr" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>')}</button>` : c.label}</th>`)}</tr></thead>
      <tbody>${slice.length ? slice.map((r, i) => html`<tr class="${rowId ? "link" : ""} ${i === kb ? "kb" : ""}" data-i="${i}">${cols.map((c) => html`<td class="${c.num ? "num" : ""} ${c.cls || ""}">${c.cell(r)}</td>`)}</tr>`) : html`<tr><td colspan="${cols.length}">${emptyState(empty, "Try fewer filters or a different search.")}</td></tr>`}</tbody>${foot ? html`<tfoot>${foot(list)}</tfoot>` : ""}</table></div>
      ${list.length > pageSize ? html`<div class="pager"><span>${num(page * pageSize + 1)}–${num(Math.min(list.length, (page + 1) * pageSize))} of ${num(list.length)}</span><span class="btns"><span>Page ${page + 1} of ${pages}</span><button class="btn sm" data-pg="-1" ${page === 0 ? raw("disabled") : ""} aria-label="Previous page">←</button><button class="btn sm" data-pg="1" ${page >= pages - 1 ? raw("disabled") : ""} aria-label="Next page">→</button></span></div>` : ""}`;
  };
  const open = (i) => { const r = slice[i]; if (!r || !rowId) return; const id = rowId(r); onOpen ? onOpen(id, r) : openRecord(id); };
  el.onclick = (e) => {
    const s = e.target.closest("[data-sort]"); if (s) { const i = +s.dataset.sort; sd = sc === i ? -sd : cols[i].num ? -1 : 1; sc = i; draw(); return; }
    const p = e.target.closest("[data-pg]"); if (p) { page += +p.dataset.pg; kb = -1; draw(); el.scrollIntoView({ block: "nearest" }); return; }
    if (e.target.closest("a, button")) return;
    const tr = e.target.closest("tr[data-i]"); if (tr) open(+tr.dataset.i);
  };
  el.onkeydown = (e) => {
    if (!e.target.classList.contains("tbl-wrap")) return;
    if (["ArrowDown", "j"].includes(e.key)) { kb = Math.min(slice.length - 1, kb + 1); } else if (["ArrowUp", "k"].includes(e.key)) { kb = Math.max(0, kb - 1); } else if (e.key === "Enter" && kb >= 0) { open(kb); return; } else return;
    e.preventDefault();
    el.querySelectorAll("tr.kb").forEach((t) => t.classList.remove("kb"));
    const tr = el.querySelector(`tr[data-i="${kb}"]`); tr?.classList.add("kb"); tr?.scrollIntoView({ block: "nearest" });
  };
  draw();
  return { update(r) { rows = r; page = 0; kb = -1; draw(); }, get rows() { return rows; } };
}

// A list page: search, filter chips, built-in and saved views, then the table.
// views: [{ id, label, test }]; chips: [{ id, label, test }]
export function dataList(el, { key, rows, cols, text, views = [], chips = [], rowId, onOpen, pageSize = 50, sortCol, sortDir, caption, extra, placeholder = "Search", tall = true }) {
  const saved = pref.get(`views-${key}`, []);
  const st = { view: views[0]?.id || null, chips: new Set(), q: "" };
  const all = () => [...views, ...saved.map((s) => ({ ...s, saved: true }))];
  el.innerHTML = html`<div class="panel">
    ${views.length ? html`<div class="views" role="tablist" aria-label="Views"></div>` : ""}
    <div class="toolbar"><label class="search"><span class="sr">${placeholder}</span>${icon("search")}<input class="input" type="search" placeholder="${placeholder}" autocomplete="off"></label>${chips.length ? html`<div class="filter-wrap"><button class="btn filter-btn" aria-expanded="false" aria-haspopup="true">${icon("filter")} Filter <span class="n" hidden></span></button><div class="chips pop" aria-label="Filters" hidden></div></div>` : ""}<span class="spacer"></span><span class="tbl-count" aria-live="polite"></span>${extra || ""}</div>
    <div class="tbody"></div></div>`;
  const vEl = el.querySelector(".views"), cEl = el.querySelector(".chips") || document.createElement("div"), fBtn = el.querySelector(".filter-btn"), cnt = el.querySelector(".tbl-count"), input = el.querySelector("input");
  const t = table(el.querySelector(".tbody"), { cols, rows: [], rowId, onOpen, pageSize, sortCol, sortDir, caption, tall });
  const testOf = (v) => (v?.saved ? views.find((x) => x.id === v.from)?.test : v?.test);
  const apply = () => {
    const v = all().find((x) => x.id === st.view);
    const vt = testOf(v);
    let list = vt ? rows.filter(vt) : rows;
    const active = chips.filter((c) => st.chips.has(c.id));
    if (active.length) list = list.filter((r) => active.every((c) => c.test(r)));
    const q = st.q.trim().toLowerCase();
    if (q) list = list.filter((r) => text(r).toLowerCase().includes(q));
    t.update(list);
    cnt.textContent = `${num(list.length)} of ${num(rows.length)}`;
    if (vEl) vEl.innerHTML = html`${all().map((x) => html`<button role="tab" aria-selected="${x.id === st.view}" data-view="${x.id}">${x.label}${x.test ? html` <span class="n">${num(rows.filter(x.test).length)}</span>` : ""}${x.saved ? html`<span class="x" data-del="${x.id}" title="Delete this saved view" aria-label="Delete saved view">×</span>` : ""}</button>`)}<button class="save" data-save="1" title="Save the current search and filters as a view">+ Save view</button>`;
    const pool = vt ? rows.filter(vt) : rows;
    cEl.innerHTML = html`${chips.map((c) => html`<button class="fchip" aria-pressed="${st.chips.has(c.id)}" data-chip="${c.id}">${st.chips.has(c.id) ? "" : "+ "}${c.label} <span class="n">${num(pool.filter(c.test).length)}</span></button>`)}`;
    if (fBtn) { const nb = fBtn.querySelector(".n"); nb.textContent = st.chips.size; nb.hidden = !st.chips.size; } // how many filters are on
  };
  vEl?.addEventListener("click", (e) => {
    const d = e.target.closest("[data-del]"); if (d) { e.stopPropagation(); const i = saved.findIndex((s) => s.id === d.dataset.del); saved.splice(i, 1); pref.set(`views-${key}`, saved); st.view = views[0]?.id; apply(); return; }
    if (e.target.closest("[data-save]")) {
      const name = prompt("Name this view", st.q || [...st.chips].join(", ") || "My view"); if (!name) return;
      const sv = { id: "s" + Date.now(), label: name, q: st.q, chips: [...st.chips], from: st.view }; saved.push(sv); pref.set(`views-${key}`, saved); st.view = sv.id; apply(); return;
    }
    const b = e.target.closest("[data-view]"); if (!b) return;
    const v = all().find((x) => x.id === b.dataset.view);
    if (v.saved) { st.chips = new Set(v.chips); st.q = v.q || ""; input.value = st.q; st.view = v.id; }
    else st.view = v.id;
    apply();
  });
  // the filter chips sit in a small popover behind one button; Escape or a click elsewhere closes it
  const closePop = () => { cEl.hidden = true; fBtn?.setAttribute("aria-expanded", "false"); };
  fBtn?.addEventListener("click", (e) => { e.stopPropagation(); const open = cEl.hidden; cEl.hidden = !open; fBtn.setAttribute("aria-expanded", String(open)); });
  document.addEventListener("click", (e) => { if (fBtn && !e.target.closest(".filter-wrap")) closePop(); });
  el.addEventListener("keydown", (e) => { if (e.key === "Escape" && !cEl.hidden) closePop(); });
  cEl.addEventListener("click", (e) => { const b = e.target.closest("[data-chip]"); if (!b) return; st.chips.has(b.dataset.chip) ? st.chips.delete(b.dataset.chip) : st.chips.add(b.dataset.chip); apply(); });
  let timer; input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { st.q = input.value; apply(); }, 90); });
  apply();
  return { setView(id) { st.view = id; apply(); }, setQuery(q) { st.q = q; input.value = q; apply(); }, toggleChip(id) { st.chips.add(id); apply(); } };
}

// ---------------------------------------------------------------- the drawer: a record opens beside the list
let drawerRender = null;
export const setDrawerRenderer = (fn) => { drawerRender = fn; };
let lastFocus = null;
export async function openRecord(id) {
  if (!drawerRender) { location.hash = href(id); return; }
  if (/^OT-/.test(id) || productById(id)) { location.hash = href(id); return; }
  closeDrawer(true);
  lastFocus = document.activeElement;
  const scrim = document.createElement("div"); scrim.className = "drawer-scrim"; scrim.id = "drawerScrim";
  const d = document.createElement("aside"); d.className = "drawer"; d.id = "drawer"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "false"); d.setAttribute("aria-label", id);
  d.innerHTML = html`<div class="drawer-h"><span class="crumb mono">${id}</span><span class="act"><a class="btn sm ghost" href="#/r/${id}" title="Open as a full page">${icon("ext")} Full page</a><button class="btn sm ghost" data-copy="${location.href.split("#")[0]}#/r/${id}" title="Copy a link to this record">${icon("link")} Copy link</button><button class="iconbtn" data-close aria-label="Close (Esc)">${icon("x")}</button></span></div><div class="drawer-b">${skeleton(2)}</div>`;
  document.body.append(scrim, d);
  requestAnimationFrame(() => { scrim.classList.add("on"); d.classList.add("on"); });
  scrim.onclick = () => closeDrawer();
  d.querySelector("[data-close]").onclick = () => closeDrawer();
  d.querySelector("[data-close]").focus();
  const [path] = location.hash.split("?");
  history.replaceState(null, "", `${path}?open=${id}`);
  const body = d.querySelector(".drawer-b");
  try { await drawerRender(id, body); } catch (e) { body.innerHTML = html`<div class="err">Could not open ${id}: ${e.message}</div>`; console.error(e); }
}
export function closeDrawer(silent) {
  const d = document.getElementById("drawer"), s = document.getElementById("drawerScrim");
  if (!d) return;
  d.remove(); s?.remove();
  if (!silent) { const [path] = location.hash.split("?"); history.replaceState(null, "", path); lastFocus?.focus?.(); }
}

// ---------------------------------------------------------------- small renderers
export const kv = (pairs) => html`<dl class="kv">${pairs.filter(Boolean).filter((p) => p[1] !== undefined).map(([k, v, title]) => html`<dt ${title ? raw(`title="${esc(title)}" class="term"`) : ""}>${k}</dt><dd>${v ?? "–"}</dd>`)}</dl>`;
export const stat = (k, v, d, { href: h, title } = {}) => h ? html`<a class="stat" href="${h}" ${title ? raw(`title="${esc(title)}"`) : ""}><span class="k">${k}</span><span class="v">${v}</span><span class="d">${d || raw("&nbsp;")}</span></a>` : html`<div class="stat" ${title ? raw(`title="${esc(title)}"`) : ""}><span class="k">${k}</span><span class="v">${v}</span><span class="d">${d || raw("&nbsp;")}</span></div>`;
// columns: up to 4 stats sit in one row, 5 in one tight row, 6 in two rows of three, more in rows of four
export const strip = (stats) => html`<div class="strip" style="--n:${stats.length};--cols:${stats.length <= 5 ? stats.length : stats.length === 6 ? 3 : 4}">${stats}</div>`;
export const panel = (title, body, { sub, act, flush, id } = {}) => html`<section class="panel" ${id ? raw(`id="${id}"`) : ""}><div class="panel-h"><h2>${title}</h2>${sub ? html`<span class="muted">${sub}</span>` : ""}${act ? html`<span class="act">${act}</span>` : ""}</div><div class="panel-b ${flush ? "flush" : ""}">${body}</div></section>`;
export const pageHead = (title, sub, actions) => html`<div class="page-head"><div><h1>${title}</h1>${sub ? html`<p class="sub">${sub}</p>` : ""}</div>${actions ? html`<div class="actions">${actions}</div>` : ""}</div>`;
export const tabs = (items, on) => html`<nav class="tabs" aria-label="Sections of this page">${items.map(([h, l, n]) => html`<a href="${h}" class="${h === on ? "on" : ""}" ${h === on ? raw('aria-current="page"') : ""}>${l}${n != null ? html` <span class="nav-count">${num(n)}</span>` : ""}</a>`)}</nav>`;
export const stars = (n) => html`<span class="stars" aria-label="${n} out of 5">${"★".repeat(Math.round(n))}<span style="opacity:.25">${"★".repeat(5 - Math.round(n))}</span></span>`;

// ---------------------------------------------------------------- tiny markdown (for staff documents and policies)
export function markdown(md, hl) {
  const mark = (s) => (hl ? s.replace(new RegExp(`(${hl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>") : s);
  const inline = (s) => mark(esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1"));
  const lines = md.split("\n"), out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,4} /.test(l)) { const n = Math.min(3, l.match(/^#+/)[0].length); out.push(`<h${n}>${inline(l.replace(/^#+ /, ""))}</h${n}>`); }
    else if (l.startsWith("|")) {
      const rows = []; while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]); i--;
      const cells = (r) => r.split("|").slice(1, -1).map((c) => c.trim());
      out.push(`<div class="tbl-wrap"><table><thead><tr>${cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.slice(2).map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    } else if (/^\s*[-*] /.test(l)) { const items = []; while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*] /, "")); i--; out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`); }
    else if (/^\d+\. /.test(l)) { const items = []; while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, "")); i--; out.push(`<ol>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ol>`); }
    else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  return raw(out.join(""));
}

// ---------------------------------------------------------------- JSON, pretty and safe, with record ids as links
const IDRX = /^(ORD|C|RET|REG|FIX|CASE|CONV|CT|REV|SHP|PO|SUP|SC|DOC|CMP|LED|MV)-[\w-]+$|^OT-[A-Z0-9-]+$/;
export function prettyJson(v, ind = 0) {
  const pad = "  ".repeat(ind), pad1 = "  ".repeat(ind + 1);
  if (v === null) return '<span class="j-b">null</span>';
  if (typeof v === "boolean") return `<span class="j-b">${v}</span>`;
  if (typeof v === "number") return `<span class="j-n">${v}</span>`;
  if (typeof v === "string") { const s = esc(JSON.stringify(v)); return IDRX.test(v) && href(v) ? `<a class="j-s j-id" href="${href(v)}">${s}</a>` : `<span class="j-s">${s}</span>`; }
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => pad1 + prettyJson(x, ind + 1)).join(",\n")}\n${pad}]` : "[]";
  const ks = Object.keys(v); return ks.length ? `{\n${ks.map((k) => `${pad1}<span class="j-k">${esc(JSON.stringify(k))}</span>: ${prettyJson(v[k], ind + 1)}`).join(",\n")}\n${pad}}` : "{}";
}
export const codeBlock = (text, { json, label } = {}) => html`<div class="code"><button class="btn sm copy" data-copy="${json ? JSON.stringify(json, null, 2) : text}" aria-label="Copy${label ? " " + label : ""}">${icon("copy")} Copy</button><pre>${json !== undefined ? raw(prettyJson(json)) : text}</pre></div>`;

// stories that mention a record (only used when spoilers are on)
export async function storiesFor(...ids) {
  if (!S.spoilers) return [];
  const { stories } = await load("stories.json");
  return stories.filter((s) => ids.some((id) => id && s.ids.includes(id)));
}
export const storyNote = (list) => (list.length ? html`<div class="spoil">${icon("flag")}<b>Planted on purpose:</b> ${list.map((s) => html`<a class="tag" href="#/systems/problems#story-${s.n}">Story ${s.n}: ${s.title}</a>`)}</div>` : "");
