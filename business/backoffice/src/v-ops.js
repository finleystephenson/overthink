// Operations and supply: stock now and over time, movements and counts, suppliers, purchase orders, stockouts.
import { S, load, html, raw, money, money2, num, pct, date, dateShort, dateTime, ago, words, cap, idLink, icon, pill, tonePill, access, skuLink, skuName, skuImg, prodImg, strip, stat, panel, pageHead, dataList, table, lockPanel, tabs, monthLabel, monShort, daysFrom, productById, openRecord } from "./core.js";
import { lineChart, barChart, hbars, meter, SERIES } from "./charts.js";

const TABS = () => [["#/stock", "Stock"], ["#/stock/counts", "Movements and counts"], ["#/suppliers", "Suppliers"], ["#/purchase-orders", "Purchase orders"], ["#/stockouts", "Stockouts"]];
const gate = (main, area, what) => { if (access(area) === "none") { main.innerHTML = String(lockPanel(area, what)); return true; } return false; };
const head = (sub, on) => html`${pageHead("Operations and supply", sub)}${tabs(TABS(), on)}`;
const level = (s) => (S.meta.sku[s.sku]?.mto ? "mto" : s.on_hand === 0 ? "empty" : s.on_hand <= 5 ? "low" : "ok");
const LEVEL = { mto: ["Made to order", ""], empty: ["Empty", "crit"], low: ["Low", "warn"], ok: ["In stock", "good"] };

// ---------------------------------------------------------------- stock now and over time
export async function stock(main, _, q) {
  if (gate(main, "stock", "stock")) return;
  const [d, ser] = await Promise.all([load("ops.json"), load("stock/series.json")]);
  const seeCost = access("cost") !== "none";
  const rows = d.stock.filter((s) => S.meta.sku[s.sku]).map((s) => ({ ...s, lv: level(s), cover: s.sold30 ? Math.round(s.on_hand / (s.sold30 / 30)) : null }));
  const tracked = rows.filter((r) => r.lv !== "mto");
  const weeks = ser.weeks.slice(-104);
  const total = weeks.map((_, i) => tracked.reduce((n, r) => n + (ser.levels[r.sku]?.slice(-104)[i] || 0), 0));
  main.innerHTML = html`${head("What is on the shelf now, how long it will last at the current rate of sales, and what is on its way.", "#/stock")}
    ${strip([stat("Units on the shelf", num(tracked.reduce((n, r) => n + r.on_hand, 0)), `${num(tracked.length)} SKUs tracked`), stat("Empty shelves", num(rows.filter((r) => r.lv === "empty").length), "Made-to-order food not counted"), stat("Low (5 or fewer)", num(rows.filter((r) => r.lv === "low").length)), stat("Coming in", num(rows.reduce((n, r) => n + r.incoming, 0)), "Units on open purchase orders", { href: "#/purchase-orders" }), seeCost ? stat("Stock value", money(rows.reduce((n, r) => n + r.value, 0)), "At what it cost us") : ""])}
    <div class="section" style="margin-top:16px">${panel("Units on the shelf, week by week", html`<div id="stCh"></div>`, { sub: "All tracked SKUs added together, last two years" })}</div>
    <div class="section" id="stList"></div>`;
  lineChart(main.querySelector("#stCh"), { labels: weeks, series: [{ name: "Units on the shelf", values: total, color: "var(--s1)", area: true }], fmt: num, xFmt: (l, i, long) => (long ? `Week ending ${date(l)}` : monShort(l.slice(0, 7))), height: 200 });
  dataList(main.querySelector("#stList"), {
    key: "stock", rows, rowId: (r) => r.sku, onOpen: (k) => (location.hash = `#/products/${S.meta.sku[k].product}`), placeholder: "Product or SKU", caption: "Stock by SKU", sortCol: 1, sortDir: 1,
    text: (r) => `${r.sku} ${skuName(r.sku)}`,
    views: [{ id: "all", label: "All SKUs" }, { id: "empty", label: "Empty", test: (r) => r.lv === "empty" }, { id: "low", label: "Low", test: (r) => r.lv === "low" }, { id: "short", label: "Under 30 days left", test: (r) => r.cover != null && r.cover < 30 && r.lv !== "mto" }, { id: "in", label: "Coming in", test: (r) => r.incoming > 0 }],
    chips: [{ id: "acc", label: "Accessories", test: (r) => S.meta.sku[r.sku].kind === "accessory" }, { id: "var", label: "Products", test: (r) => S.meta.sku[r.sku].kind === "variant" }],
    cols: [
      { label: "SKU", sort: (r) => skuName(r.sku), cell: (r) => html`<span class="prod">${skuImg(r.sku)}<span>${skuName(r.sku)}<span class="sub mono">${r.sku}</span></span></span>` },
      { label: "On the shelf", num: true, sort: (r) => (r.lv === "mto" ? 1e9 : r.on_hand), cell: (r) => (r.lv === "mto" ? html`<span class="muted small">To order</span>` : num(r.on_hand)) },
      { label: "Sold, 30 days", num: true, sort: (r) => r.sold30, cell: (r) => num(r.sold30) },
      { label: "Days left", num: true, sort: (r) => r.cover ?? 1e9, cell: (r) => (r.lv === "mto" ? "–" : r.cover == null ? html`<span class="muted">No recent sales</span>` : html`<span class="${r.cover < 14 ? "down" : ""}">${num(r.cover)}</span>`), title: "On the shelf divided by the last 30 days' daily sales" },
      { label: "Coming in", num: true, sort: (r) => r.incoming, cell: (r) => (r.incoming ? num(r.incoming) : "–"), cls: "hide-m" },
      { label: "Back on", sort: (r) => r.restock || "", cell: (r) => (r.restock ? date(r.restock) : "–"), cls: "hide-m" },
      seeCost ? { label: "Value", num: true, sort: (r) => r.value, cell: (r) => money(r.value), cls: "hide-m" } : null,
      { label: "State", sort: (r) => r.lv, cell: (r) => tonePill(...LEVEL[r.lv]) },
    ].filter(Boolean),
  }).setView(q.view || "all");
}

// ---------------------------------------------------------------- movements and counts
export async function counts(main, _, q) {
  if (gate(main, "stock", "stock movements")) return;
  const d = await load("ops.json");
  const skus = Object.keys(S.meta.sku).filter((k) => !S.meta.sku[k].mto);
  const pick = q.sku && S.meta.sku[q.sku] ? q.sku : skus[0];
  const off = d.counts.filter((c) => c.difference !== 0);
  main.innerHTML = html`${head("Every change to stock has a reason and a record behind it. Stock on hand is always the sum of the movements. Shelf counts check that against reality.", "#/stock/counts")}
    ${strip([stat("Shelf counts", num(d.counts.length)), stat("Did not match", num(off.length), `${pct(off.length / (d.counts.length || 1))} of counts`), stat("Not fixed", num(off.filter((c) => !c.adjusted).length), "Stock left unadjusted"), stat("Units missing, all counts", num(-off.reduce((n, c) => n + Math.min(0, c.difference), 0)), "Counted fewer than the system said")])}
    <div class="section" id="cList" style="margin-top:16px"></div>
    <div class="section"><div class="sec-h"><h2>Movements for one SKU</h2><span class="act"><label class="row"><span class="muted small">SKU</span><select class="input" id="skuPick">${skus.map((k) => html`<option value="${k}" ${k === pick ? raw("selected") : ""}>${skuName(k)}</option>`)}</select></label></span></div><div class="panel" id="mvBox"></div></div>`;
  dataList(main.querySelector("#cList"), {
    key: "counts", rows: d.counts, rowId: (c) => c.id, placeholder: "SKU or note", caption: "Shelf counts", tall: false,
    text: (c) => `${c.id} ${c.sku} ${skuName(c.sku)} ${c.note}`,
    views: [{ id: "off", label: "Did not match", test: (c) => c.difference !== 0 }, { id: "open", label: "Not fixed", test: (c) => c.difference !== 0 && !c.adjusted }, { id: "all", label: "All counts" }],
    cols: [
      { label: "Count", sort: (c) => c.at, cell: (c) => html`<span class="id">${c.id}</span><span class="sub">${date(c.at)}</span>` },
      { label: "SKU", cell: (c) => skuLink(c.sku) },
      { label: "System said", num: true, cell: (c) => num(c.system_qty), cls: "hide-m" },
      { label: "Counted", num: true, cell: (c) => num(c.counted_qty), cls: "hide-m" },
      { label: "Difference", num: true, sort: (c) => c.difference, cell: (c) => (c.difference === 0 ? html`<span class="muted">0</span>` : html`<b class="${c.difference < 0 ? "down" : ""}">${c.difference > 0 ? "+" : ""}${c.difference}</b>`) },
      { label: "Fixed", cell: (c) => (c.difference === 0 ? "–" : c.adjusted ? tonePill("Adjusted", "good") : tonePill("Not fixed", "crit")) },
      { label: "Note", cell: (c) => c.note, cls: "clip hide-m" },
    ],
  }).setView("off");
  const drawMv = async (k) => {
    const rows = (await load(`stock/mv-${k}.json`)).map((m) => ({ id: m[0], at: m[1], qty: m[2], why: m[3], ref: m[4], lvl: m[5] }));
    const box = main.querySelector("#mvBox");
    const by = rows.reduce((m, r) => ((m[r.why] = (m[r.why] || 0) + r.qty), m), {});
    box.innerHTML = html`<div class="panel-b" style="border-bottom:1px solid var(--line)"><div class="row" style="gap:18px">${Object.entries(by).map(([k2, v]) => html`<span class="small"><span class="muted">${cap(words(k2))}</span> <b class="tab">${v > 0 ? "+" : ""}${num(v)}</b></span>`)}<span class="small" style="margin-left:auto"><span class="muted">On the shelf now</span> <b class="tab">${num(rows[0]?.lvl ?? 0)}</b></span></div></div><div id="mvTab"></div>`;
    table(box.querySelector("#mvTab"), { rows, rowId: (r) => r.id, pageSize: 25, caption: `Movements for ${skuName(k)}`, cols: [{ label: "Movement", cell: (r) => html`<span class="id">${r.id}</span><span class="sub">${dateTime(r.at)}</span>` }, { label: "Why", cell: (r) => cap(words(r.why)) }, { label: "Caused by", cell: (r) => (r.ref ? idLink(r.ref) : "–") }, { label: "Change", num: true, cell: (r) => html`<span class="${r.qty > 0 ? "up" : ""}">${r.qty > 0 ? "+" : ""}${r.qty}</span>` }, { label: "Level after", num: true, cell: (r) => num(r.lvl) }] });
  };
  main.querySelector("#skuPick").onchange = (e) => { history.replaceState(null, "", `#/stock/counts?sku=${e.target.value}`); drawMv(e.target.value); };
  drawMv(pick);
}

// ---------------------------------------------------------------- suppliers
export async function suppliers(main) {
  if (gate(main, "buying", "suppliers")) return;
  const { suppliers: rows, pos } = await load("buying.json");
  main.innerHTML = html`${head("Who makes what we sell, how long they take, and how often they are late.", "#/suppliers")}
    ${strip([stat("Suppliers", num(rows.length), `${rows.filter((s) => s.mto).length} make to order each morning`), stat("Arrived on time", pct(rows.reduce((n, s) => n + s.delivered - s.late_count, 0) / (rows.reduce((n, s) => n + s.delivered, 0) || 1)), "All deliveries, all time"), stat("Late right now", num(pos.filter((p) => p.st === "late").length), "Purchase orders past due", { href: "#/purchase-orders?view=late" }), stat("Bought, all time", money(rows.reduce((n, s) => n + s.spent, 0)), "Value of purchase orders")])}
    <div class="cols c2 section" style="margin-top:16px">${panel("On time, by supplier", raw(hbars([...rows].filter((s) => s.delivered).sort((a, b) => a.on_time - b.on_time).map((s) => ({ name: s.name, value: s.on_time, href: `#/r/${s.id}`, color: s.on_time < 0.85 ? "var(--s2)" : "var(--s4)", title: `${s.name}: ${s.delivered - s.late_count} of ${s.delivered} on time` })), { fmt: (v) => pct(v), max: 1 })), { sub: "Share of deliveries that arrived by their due date" })}
      ${panel("Lead time, by supplier", raw(hbars([...rows].sort((a, b) => b.lead_time_days - a.lead_time_days).map((s) => ({ name: s.name, value: s.lead_time_days, href: `#/r/${s.id}`, color: "var(--s3)" })), { fmt: (v) => `${v} ${v === 1 ? "day" : "days"}` })), { sub: "Days from ordering to delivery" })}</div>
    <div class="section panel" id="supTab"></div>`;
  table(main.querySelector("#supTab"), {
    rows, rowId: (s) => s.id, caption: "Suppliers", sortCol: 6, cols: [
      { label: "Supplier", sort: (s) => s.name, cell: (s) => html`<b style="font-weight:600">${s.name}</b><span class="sub">${s.town} · <span class="mono">${s.id}</span></span>` },
      { label: "Makes", cell: (s) => html`<span class="row" style="gap:4px;flex-wrap:nowrap">${s.products.slice(0, 4).map((p) => prodImg(p))}</span>`, cls: "hide-m" },
      { label: "Lead time", num: true, sort: (s) => s.lead_time_days, cell: (s) => `${s.lead_time_days} ${s.lead_time_days === 1 ? "day" : "days"}` },
      { label: "On time", num: true, sort: (s) => s.on_time ?? -1, cell: (s) => html`<span class="${s.on_time < 0.85 ? "down" : ""}">${pct(s.on_time)}</span>` },
      { label: "Late by, typical", num: true, sort: (s) => s.avg_late, cell: (s) => (s.avg_late ? `${s.avg_late} days` : "–"), cls: "hide-m", title: "Average days late, when late" },
      { label: "Open orders", num: true, sort: (s) => s.open, cell: (s) => num(s.open) },
      { label: "Bought", num: true, sort: (s) => s.spent, cell: (s) => money(s.spent) },
    ],
  });
}

// ---------------------------------------------------------------- purchase orders
export async function pos(main, _, q) {
  if (gate(main, "buying", "purchase orders")) return;
  const { pos: rows } = await load("buying.json");
  const OPEN = ["draft", "awaiting_approval", "ordered", "late", "part_received"];
  const open = rows.filter((p) => OPEN.includes(p.st));
  const ms = {}; for (const p of rows) if (p.st !== "cancelled") { const m = p.o.slice(0, 7); (ms[m] ||= [0, 0]); ms[m][0] += p.v; if (p.late > 0) ms[m][1]++; }
  const months = Object.keys(ms).sort().slice(-24);
  const week = new Date(Date.parse(S.meta.now) + 7 * 864e5).toISOString().slice(0, 10);
  main.innerHTML = html`${head("Orders to suppliers: what is on its way, what is late, and what needs approving.", "#/purchase-orders")}
    ${strip([stat("Open", num(open.length), money(open.reduce((n, p) => n + p.v, 0)) + " on order"), stat("Late", num(rows.filter((p) => p.st === "late").length), "Past their due date"), stat("Due in the next 7 days", num(open.filter((p) => p.d <= week && p.d >= S.meta.now.slice(0, 10)).length)), stat("Need approval", num(rows.filter((p) => ["draft", "awaiting_approval"].includes(p.st)).length), "Drafts and orders over the buyer's limit"), stat("Arrived late, all time", pct(rows.filter((p) => p.r && p.late > 0).length / (rows.filter((p) => p.r).length || 1)), "Of deliveries that arrived")])}
    <div class="cols c21 section" style="margin-top:16px">${panel("Money ordered from suppliers, by month", html`<div id="poCh"></div>`, { sub: "Last 24 months" })}${panel("Open orders by stage", raw(meter(OPEN.map((s, i) => ({ name: cap(words(s)), value: open.filter((p) => p.st === s).length, color: ["var(--s6)", "var(--s5)", "var(--s1)", "var(--s2)", "var(--s3)"][i] })), { fmt: num })))}</div>
    <div class="section" id="poList"></div>`;
  barChart(main.querySelector("#poCh"), { labels: months, values: months.map((m) => ms[m][0]), fmt: money, name: "Ordered", color: "var(--s3)", xFmt: (l, i, long) => (long ? monthLabel(l, true) : i % 3 === 0 ? monShort(l) : ""), xTicks: 24, height: 190 });
  dataList(main.querySelector("#poList"), {
    key: "pos", rows, rowId: (p) => p.n, placeholder: "Order, supplier or product", caption: "Purchase orders",
    text: (p) => `${p.n} ${S.meta.suppliers[p.s]} ${p.l.map((l) => skuName(l[0])).join(" ")}`,
    views: [{ id: "open", label: "Open", test: (p) => OPEN.includes(p.st) }, { id: "late", label: "Late", test: (p) => p.st === "late" }, { id: "arrivedLate", label: "Arrived late", test: (p) => p.r && p.late > 0 }, { id: "all", label: "All" }],
    chips: Object.entries(S.meta.suppliers).map(([id, n]) => ({ id, label: n, test: (p) => p.s === id })),
    cols: [
      { label: "Order", sort: (p) => p.o, cell: (p) => html`<span class="id">${p.n}</span><span class="sub">${date(p.o)}</span>` },
      { label: "Supplier", sort: (p) => S.meta.suppliers[p.s], cell: (p) => S.meta.suppliers[p.s] },
      { label: "What", cell: (p) => html`<span class="small">${p.l.map((l) => `${l[1]} × ${skuName(l[0])}`).join(", ")}</span>`, cls: "clip hide-m" },
      { label: "Due", sort: (p) => p.d, cell: (p) => html`${date(p.d)}${p.e ? html`<span class="sub">now ${date(p.e)}</span>` : ""}` },
      { label: "Status", sort: (p) => p.st, cell: (p) => html`${pill(p.st, "po")}${p.late ? html`<span class="sub down">${p.late} days late</span>` : ""}` },
      { label: "Value", num: true, sort: (p) => p.v, cell: (p) => money2(p.v) },
    ],
  }).setView(q.view || "open");
}

// ---------------------------------------------------------------- stockouts and what they cost
export async function stockouts(main) {
  if (gate(main, "stock", "stockouts")) return;
  const d = await load("ops.json");
  const lostBy = {}; for (const x of d.lost.days) lostBy[x.date.slice(0, 7)] = (lostBy[x.date.slice(0, 7)] || 0) + x.lost;
  const months = Object.keys(lostBy).length ? (() => { const out = [], a = new Date(Object.keys(lostBy).sort()[0] + "-01"), b = new Date(S.meta.now.slice(0, 7) + "-01"); for (const x = a; x <= b; x.setUTCMonth(x.getUTCMonth() + 1)) out.push(x.toISOString().slice(0, 7)); return out; })() : [];
  const fin = access("finance") !== "none";
  main.innerHTML = html`${head("Every time a shelf went empty, how long it stayed empty, and the baskets people gave up on while it was.", "#/stockouts")}
    ${strip([stat("Times a shelf went empty", num(d.stockouts.length), `${num(new Set(d.stockouts.map((s) => s.sku)).size)} SKUs · made-to-order food not counted`), stat("Empty right now", num(d.stockouts.filter((s) => !s.to).length)), stat("Baskets lost to empty shelves", num(d.lost.total), "From the website's daily figures, all products"), fin ? stat("Sales lost, estimate", money(d.lost.est_value), "Lost baskets × that month's average order", { title: "An estimate: each lost basket valued at the average paid order in its month" }) : ""])}
    <div class="cols c2 section" style="margin-top:16px">${panel("Baskets lost to empty shelves, by month", months.length ? html`<div id="lostCh"></div>` : html`<p class="muted">None lost.</p>`)}${panel("Days empty, by SKU", raw(hbars(Object.entries(d.stockouts.reduce((m, s) => ((m[s.sku] = (m[s.sku] || 0) + s.days), m), {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: skuName(k), value: v, href: `#/products/${S.meta.sku[k]?.product}`, color: "var(--s2)" })), { fmt: (v) => `${v} days` })), { sub: "All stockouts added up" })}</div>
    <div class="section panel" id="soTab"></div>`;
  if (months.length) barChart(main.querySelector("#lostCh"), { labels: months, values: months.map((m) => lostBy[m] || 0), fmt: num, name: "Baskets lost", color: "var(--s2)", xFmt: (l, i, long) => (long ? monthLabel(l, true) : i % 6 === 0 ? monShort(l) : ""), xTicks: 60, height: 190 });
  table(main.querySelector("#soTab"), { rows: d.stockouts, rowId: (s) => s.sku, onOpen: (k) => (location.hash = `#/stock/counts?sku=${k}`), caption: "Stockouts", cols: [
    { label: "SKU", cell: (s) => skuLink(s.sku) },
    { label: "Went empty", sort: (s) => s.from, cell: (s) => date(s.from) },
    { label: "Back in stock", cell: (s) => (s.to ? date(s.to) : tonePill("Still empty", "crit")) },
    { label: "Days empty", num: true, sort: (s) => s.days, cell: (s) => num(s.days) },
    { label: "Baskets lost meanwhile", num: true, cell: (s) => num(s.lost_baskets_all_products), title: "Baskets given up on any product while this shelf was empty: the website does not record which product caused it" },
  ] });
}
