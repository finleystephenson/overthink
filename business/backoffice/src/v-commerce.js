// Commerce: orders, products, payments, deliveries, returns and refunds.
import { S, load, html, raw, money, money2, num, pct, compact, date, dateShort, dateTime, time, ago, words, cap, customers, allOrders, idLink, icon, pill, tonePill, access, scopedCustomer, whoSync, canSeeCustomer, redact, prodImg, prodLink, skuLink, skuName, productById, strip, stat, panel, pageHead, dataList, table, kv, flagIcons, monthLabel, monShort, stars, statusLabel, storiesFor, storyNote, lockPanel, daysFrom, custId, openRecord, CHANNELS } from "./core.js";
import { lineChart, barChart, hbars, meter, SERIES } from "./charts.js";

const scope = (rows, key = "c") => { const one = scopedCustomer(); return one ? rows.filter((r) => r[key] === one) : rows; };
const gate = (main, area, what) => { if (access(area) === "none") { main.innerHTML = String(lockPanel(area, what)); return true; } return false; };
const last = (arr, n) => arr.slice(-n);

// ---------------------------------------------------------------- orders
export async function orders(main, _, q) {
  if (gate(main, "orders", "orders")) return;
  const [rowsAll, cm] = await Promise.all([allOrders(), customers()]);
  const rows = scope(rowsAll);
  const paid = rows.filter((r) => r.pay !== "declined");
  const thisY = S.meta.now.slice(0, 4);
  main.innerHTML = html`${pageHead("Orders", html`Every order the shop has taken, newest first. <span class="term" title="An order counts as paid when its payment status is anything but declined. This is how business/builder/validate.mjs counts.">Paid</span> means the payment went through; declined orders are kept and marked.`)}
    ${strip([
      stat("Paid orders, all time", num(paid.length), `${num(rows.length)} placed, ${num(rows.length - paid.length)} declined`),
      stat(`Paid orders in ${thisY}`, num(paid.filter((r) => r.at.startsWith(thisY)).length), scopedCustomer() ? "To today" : "To today. The validator counts the same way"),
      stat("Waiting to be packed", num(rows.filter((r) => r.st === "paid").length), "Paid, not yet in a parcel", { href: "#/orders?view=pack" }),
      stat("On their way", num(rows.filter((r) => r.st === "dispatched" || r.st === "part_dispatched").length), "Sent, not yet delivered"),
      stat("With a parcel problem", num(rows.filter((r) => /[LX]/.test(r.flags)).length), "A parcel late now, or lost in the past"),
      stat("Average paid order", money2(paid.reduce((n, r) => n + r.total, 0) / (paid.length || 1)), "Items plus delivery"),
    ])}
    <div class="section" id="list" style="margin-top:16px"></div>`;
  dataList(main.querySelector("#list"), {
    key: "orders", rows, placeholder: "Order number, customer, product",
    text: (r) => `${r.id} ${canSeeCustomer(r.c) ? cm.get(r.c)?.name : ""} ${r.prods.map((p) => productById(p)?.name).join(" ")} ${r.st}`,
    views: [{ id: "all", label: "All" }, { id: "pack", label: "To pack", test: (r) => r.st === "paid" }, { id: "way", label: "On the way", test: (r) => ["dispatched", "part_dispatched", "packed"].includes(r.st) }, { id: "problems", label: "Problems", test: (r) => /[LXC]/.test(r.flags) || r.st === "payment_failed" }, { id: "delivered", label: "Delivered", test: (r) => r.st === "delivered" }, { id: "cancelled", label: "Cancelled or declined", test: (r) => r.st === "cancelled" || r.pay === "declined" }],
    chips: [{ id: "y", label: `Placed in ${thisY}`, test: (r) => r.at.startsWith(thisY) }, { id: "R", label: "Has a return", test: (r) => r.flags.includes("R") }, { id: "C", label: "Has a case", test: (r) => r.flags.includes("C") }, { id: "D", label: "Used a code", test: (r) => r.flags.includes("D") }, { id: "chilled", label: "Chilled", test: (r) => r.ship === "chilled" }, { id: "next", label: "Next-day", test: (r) => r.ship === "next-day" }, { id: "ref", label: "Refunded", test: (r) => r.refunded > 0 }],
    rowId: (r) => r.id, caption: "Orders",
    cols: [
      { label: "Order", sort: (r) => r.at, cell: (r) => html`<span class="id">${r.id}</span><span class="sub">${dateShort(r.at)} ${r.at.slice(0, 4)}, ${time(r.at)}</span>` },
      { label: "Customer", sort: (r) => cm.get(r.c)?.name, cell: (r) => whoSync(r.c, cm) },
      { label: "Items", cls: "hide-m", cell: (r) => html`<span class="row" style="gap:4px;flex-wrap:nowrap">${r.prods.slice(0, 3).map((p) => prodImg(p))}${r.prods.length > 3 ? html`<span class="muted small">+${r.prods.length - 3}</span>` : ""}<span class="muted small" style="margin-left:4px">${r.qty} ${r.qty === 1 ? "item" : "items"}</span></span>` },
      { label: "Status", sort: (r) => r.st, cell: (r) => pill(r.st) },
      { label: "Payment", sort: (r) => r.pay, cell: (r) => pill(r.pay, "pay", r.method), cls: "hide-m" },
      { label: "Delivery", sort: (r) => r.ship, cell: (r) => cap(words(r.ship)), cls: "hide-m" },
      { label: "", cell: (r) => html`<span class="row" style="gap:3px;flex-wrap:nowrap">${flagIcons(r.flags)}</span>`, cls: "hide-m" },
      { label: "Total", num: true, sort: (r) => r.total, cell: (r) => html`<span class="${r.pay === "declined" ? "muted" : ""}">${money2(r.total)}</span>` },
    ],
  }).setView(q.view || "all");
}

// ---------------------------------------------------------------- products
export async function products(main, _, q) {
  const list = await load("products.json");
  const seeCost = access("cost") !== "none";
  const mode = q.as === "table" ? "table" : "gallery";
  const stockOf = (p) => p.skus.filter((k) => S.meta.sku[k]?.kind === "variant").reduce((n, k) => n + (S.meta.sku[k]?.on_hand || 0), 0);
  const price = (p) => { const ps = p.skus.filter((k) => S.meta.sku[k].kind === "variant").map((k) => S.meta.sku[k].price); return ps.length ? (Math.min(...ps) === Math.max(...ps) ? money2(ps[0]) : `${money2(Math.min(...ps))}–${money2(Math.max(...ps))}`) : "–"; };
  const margin = (p) => (p.revenue ? (p.revenue - p.cost_sold) / p.revenue : null);
  const sold30 = list.reduce((n, p) => n + p.sold30, 0);
  const rated = list.filter((p) => p.reviews.count);
  main.innerHTML = html`${pageHead("Products", "The catalogue as the business sees it: what each thing sells for, what it costs us, what is on the shelf, how it sells and how often it comes back.", html`<span class="seg" role="group" aria-label="Show as"><a class="btn sm ghost" style="${mode === "gallery" ? "background:var(--panel);box-shadow:var(--shadow-1)" : ""}" href="#/products">Pictures</a><a class="btn sm ghost" style="${mode === "table" ? "background:var(--panel);box-shadow:var(--shadow-1)" : ""}" href="#/products?as=table">Table</a></span>`)}
    ${strip([stat("Products", num(list.length), `${num(Object.keys(S.meta.sku).length)} SKUs, accessories included`), stat("Units sold, last 30 days", num(sold30), "Paid orders"), stat("SKUs with an empty shelf", num(Object.values(S.meta.sku).filter((s) => !s.mto && s.on_hand === 0).length), "Made-to-order food not counted", { href: "#/stock" }), stat("Average review", rated.length ? (rated.reduce((n, p) => n + p.reviews.avg * p.reviews.count, 0) / rated.reduce((n, p) => n + p.reviews.count, 0)).toFixed(2) + " ★" : "–", `${num(rated.reduce((n, p) => n + p.reviews.count, 0))} internal reviews`), seeCost ? stat("Gross margin on items", pct(list.reduce((n, p) => n + p.revenue - p.cost_sold, 0) / list.reduce((n, p) => n + p.revenue, 0), 1), "Item sales minus their cost, all time") : ""])}
    <div class="section" id="plist" style="margin-top:16px"></div>`;
  const el = main.querySelector("#plist");
  if (mode === "gallery") {
    el.innerHTML = html`<div class="gallery">${list.map((p) => html`<a class="pcard" href="#/products/${p.id}"><img src="${p.img || ""}" alt="" loading="lazy" width="320" height="240"><div class="b"><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><b>${p.name}</b>${pill(p.lifecycle)}</div><div class="row"><span>${price(p)}</span><span>${p.mto ? "Made each morning" : `${stockOf(p)} on the shelf`}</span></div><div class="row"><span>${num(p.sold30)} sold in 30 days</span><span>${p.reviews.avg ? html`${p.reviews.avg.toFixed(1)} ★` : "No reviews"}</span></div></div></a>`)}</div>`;
    return;
  }
  el.innerHTML = html`<div class="panel" id="ptab"></div>`;
  table(el.querySelector("#ptab"), {
    rows: list, rowId: (p) => p.id, onOpen: (id) => (location.hash = `#/products/${id}`), pageSize: 100, sortCol: 4, caption: "Products",
    cols: [
      { label: "Product", sort: (p) => p.name, cell: (p) => html`<span class="prod">${prodImg(p.id)}<span><b style="font-weight:600">${p.name}</b><span class="sub">${cap(words(p.category))}</span></span></span>` },
      { label: "Price", cell: price, cls: "hide-m" },
      seeCost ? { label: "Margin", num: true, sort: margin, cell: (p) => pct(margin(p)), title: "Item sales minus their cost, as a share of item sales" } : null,
      { label: "On the shelf", num: true, sort: stockOf, cell: (p) => (p.mto ? html`<span class="muted small" title="Made each morning to order">To order</span>` : num(stockOf(p))) },
      { label: "Sold", num: true, sort: (p) => p.sold, cell: (p) => num(p.sold) },
      { label: "Last 30 days", num: true, sort: (p) => p.sold30, cell: (p) => num(p.sold30), cls: "hide-m" },
      { label: "Returned", num: true, sort: (p) => (p.sold ? p.returned / p.sold : 0), cell: (p) => html`${num(p.returned)} <span class="muted small">${p.sold ? pct(p.returned / p.sold, 1) : ""}</span>`, title: "Units returned, and as a share of units sold" },
      { label: "Reviews", num: true, sort: (p) => p.reviews.avg || 0, cell: (p) => (p.reviews.count ? html`${p.reviews.avg.toFixed(1)} <span class="muted small">(${p.reviews.count})</span>` : "–") },
      { label: "Sales", num: true, sort: (p) => p.revenue, cell: (p) => money(p.revenue) },
      { label: "Stage", sort: (p) => p.lifecycle, cell: (p) => pill(p.lifecycle), cls: "hide-m" },
    ].filter(Boolean),
  });
}

export async function product(main, [id]) {
  const list = await load("products.json");
  const p = list.find((x) => x.id === id);
  if (!p) { main.innerHTML = String(html`<div class="empty"><b>No product called ${id}.</b><a href="#/products">All products</a></div>`); return; }
  window.__setCrumbs([["#/products", "Commerce"], ["#/products", "Products"], p.name]);
  const seeCost = access("cost") !== "none", seeStaff = access("company") !== "none";
  const st = await storiesFor(...p.skus, p.id);
  const months = (await load("money.json").catch(() => null))?.months?.map((m) => m.month);
  const margin = p.revenue ? (p.revenue - p.cost_sold) / p.revenue : null;
  main.innerHTML = html`<div class="rec-head"><div class="row" style="gap:16px;flex-wrap:nowrap;min-width:0">${p.img ? html`<img class="thumb lg" src="${p.img}" alt="">` : ""}<div style="min-width:0"><h1>${p.name} ${pill(p.lifecycle)}</h1><p class="sub">${cap(words(p.category))} · ${p.tagline || ""} · first sold ${date(p.first_sale)}${p.warranty ? ` · ${p.warranty}-month warranty` : ""}</p></div></div></div>
    ${storyNote(st)}
    ${strip([stat("Sales, all time", money(p.revenue), `${num(p.sold)} units`), stat("Last 30 days", num(p.sold30), "Units sold"), stat("Last 90 days", num(p.sold90), html`vs ${num(p.soldPrev90)} the 90 before`), seeCost ? stat("Margin", pct(margin, 1), "Item sales minus their cost") : "", stat("Returned", num(p.returned), `${p.sold ? pct(p.returned / p.sold, 1) : "–"} of units · ${num(p.faulty)} faulty`), stat("Reviews", p.reviews.avg ? `${p.reviews.avg.toFixed(1)} ★` : "–", `${p.reviews.count} reviews · ${p.repairs} repairs`)])}
    <div class="cols c2" style="margin-top:16px">
      ${panel("Units sold by month", html`<div id="pSales"></div>`, { sub: "Last 24 months, against the 12 before" })}
      ${panel("Stock on the shelf, week by week", html`<div id="pStock"></div>`, { sub: "Each SKU, from every stock movement" })}
    </div>
    <div class="section">${panel("Each SKU", html`<div id="skus" style="margin:-4px -16px -16px"></div>`, { sub: "A SKU is one exact thing we sell: a variant or an accessory" })}</div>
    <div class="cols c2 section">
      ${seeStaff ? panel("What customers say", html`<div class="row" style="gap:18px;align-items:flex-start"><div><span class="display hero-num">${p.reviews.avg?.toFixed(1) ?? "–"}</span><div class="muted small">${p.reviews.count} internal reviews</div></div><div style="flex:1;min-width:180px">${raw(hbars([5, 4, 3, 2, 1].map((s) => ({ name: `${s} ★`, value: p.reviews.dist[s - 1] })), { color: "var(--s6)" }))}</div></div><ul class="list" style="margin:12px -16px -16px">${p.reviews.recent.map((r) => html`<li class="hov"><a href="#/r/${r[0]}" data-rec="${r[0]}" style="display:contents;color:inherit"><span class="t"><b>“${r[3]}”</b><small>${stars(r[2])} · ${date(r[4])}</small></span></a></li>`)}</ul>`, { sub: "Not shown on the website" }) : ""}
      <div class="stack">
        ${panel("Price history", p.prices.length ? html`<ul class="list" style="margin:-8px -16px -16px">${p.prices.map((h) => html`<li><span class="t"><b>${skuName(h.sku)}: ${money2(h.old_price)} → ${money2(h.new_price)}</b><small>${h.reason}</small></span><span class="meta">${date(h.date)}</span></li>`)}</ul>` : html`<p class="muted">The price has never changed.</p>`)}
        ${p.counts.length ? panel("Shelf counts", html`<ul class="list" style="margin:-8px -16px -16px">${p.counts.slice(0, 6).map((c) => html`<li class="hov"><a href="#/r/${c.id}" data-rec="${c.id}" style="display:contents;color:inherit"><span class="t"><b>${skuName(c.sku)}</b><small>${c.note}</small></span><span class="meta">${c.difference === 0 ? tonePill("Matches", "good") : tonePill(`${c.difference > 0 ? "+" : ""}${c.difference}${c.adjusted ? "" : ", not fixed"}`, c.adjusted ? "warn" : "crit")} ${date(c.at)}</span></a></li>`)}</ul>`, { sub: `${p.counts.length} counts` }) : ""}
      </div>
    </div>`;
  table(main.querySelector("#skus"), {
    rows: p.skus.map((k) => ({ k, s: S.meta.sku[k], v: p.sku_sold[k] })), pageSize: 50, caption: "SKUs",
    cols: [
      { label: "SKU", cell: (r) => html`<span class="prod">${r.s.img ? html`<img class="thumb" src="${r.s.img}" alt="">` : ""}<span>${r.s.short}<span class="sub mono">${r.k}</span></span></span>` },
      { label: "Price", num: true, cell: (r) => money2(r.s.price) },
      seeCost ? { label: "Cost", num: true, cell: (r) => money2(r.s.cost), title: "What one costs us from the supplier" } : null,
      seeCost ? { label: "Margin", num: true, cell: (r) => (r.s.cost ? pct((r.s.price - r.s.cost) / r.s.price) : "–") } : null,
      { label: "On the shelf", num: true, cell: (r) => (r.s.mto ? html`<span class="muted small">To order</span>` : r.s.on_hand === 0 ? html`${tonePill("Empty", "crit")}${r.s.restock ? html`<span class="sub">back ${dateShort(r.s.restock)}</span>` : ""}` : num(r.s.on_hand)) },
      { label: "Sold", num: true, cell: (r) => num(r.v[0]) }, { label: "30 days", num: true, cell: (r) => num(r.v[1]), cls: "hide-m" }, { label: "Returned", num: true, cell: (r) => num(r.v[2]) }, { label: "Faulty", num: true, cell: (r) => num(r.v[3]), cls: "hide-m" }, { label: "Repairs", num: true, cell: (r) => num(r.v[4]), cls: "hide-m" },
      access("buying") !== "none" ? { label: "Supplier", cell: (r) => (r.s.supplier ? idLink(r.s.supplier) : "–"), cls: "hide-m" } : null,
    ].filter(Boolean),
  });
  const ms = months || [];
  const units = p.monthly.map((m) => m[0]);
  const n = Math.min(24, units.length);
  barChart(main.querySelector("#pSales"), { labels: ms.slice(-n), values: units.slice(-n), prev: units.slice(-n - 12, -12).length === n ? units.slice(-n - 12, -12) : null, name: "Units sold", prevName: "Same month a year before", fmt: num, xFmt: (l, i, long) => (long ? monthLabel(l, true) : i % 3 === 0 ? monShort(l) : ""), xTicks: 24, height: 200, title: `${p.name}: units sold by month` });
  const ser = await load("stock/series.json");
  const ks = p.skus.filter((k) => !S.meta.sku[k].mto).slice(0, 6);
  const W = ser.weeks.length, from = Math.max(0, W - 104);
  if (ks.length) lineChart(main.querySelector("#pStock"), { labels: ser.weeks.slice(from), series: ks.map((k, i) => ({ name: S.meta.sku[k].short, values: ser.levels[k].slice(from), color: SERIES[i] })), fmt: num, xFmt: (l, i, long) => (long ? `Week ending ${date(l)}` : monShort(l.slice(0, 7))), xTicks: 6, height: 200, endLabel: false, title: "Stock on the shelf" });
  else main.querySelector("#pStock").innerHTML = String(html`<p class="muted">Made to order each morning, so there is no shelf to track.</p>`);
}

// ---------------------------------------------------------------- payments
export async function payments(main) {
  if (gate(main, "orders", "payments")) return;
  const [d, rowsAll, cm] = await Promise.all([load("payments.json"), allOrders(), customers()]);
  const one = scopedCustomer();
  const total = Object.values(d.statuses).reduce((a, b) => a + b, 0);
  const paidMoney = d.methods.reduce((n, m) => n + m.money, 0), refunded = d.methods.reduce((n, m) => n + m.refunded, 0);
  const declined = one ? d.declined.filter((r) => custId(r[1]) === one) : d.declined;
  const m24 = last(d.months, 24);
  main.innerHTML = html`${pageHead("Payments", "How customers paid, how often a payment failed and why, and what was refunded. Every order tried to take a payment once.")}
    ${one ? "" : strip([stat("Payments taken", num(total - (d.statuses.declined || 0)), `${pct((total - (d.statuses.declined || 0)) / total, 1)} of ${num(total)} attempts`), stat("Declined", num(d.statuses.declined || 0), `${pct((d.statuses.declined || 0) / total, 1)} of attempts`), stat("Money taken", money(paidMoney), "Paid orders, before refunds"), stat("Refunded", money(refunded), `${num(d.statuses.refunded || 0)} in full, ${num(d.statuses.part_refunded || 0)} in part`), stat("Pay later owed", num(d.statuses.due || 0), "Orders not yet settled")])}
    <div class="cols c21 section" style="margin-top:16px">
      ${panel("Declined payments by month", html`<div id="decl"></div>`, { sub: "Last 24 months" })}
      ${panel("Why payments failed", raw(hbars(Object.entries(d.fail_reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, value: v })), { fmt: num, color: "var(--s5)" })), { sub: "From the test card used" })}
    </div>
    <div class="cols c2 section">
      ${panel("By way of paying", html`<div id="meth" style="margin:-4px -16px -16px"></div>`)}
      ${panel("Ways to pay the checkout offers", html`<ul class="list" style="margin:-8px -16px -16px">${d.methods_offered.map((m) => html`<li><span class="t" style="white-space:normal"><b>${m.name} ${tonePill(words(m.kind), "plain")}</b><small style="white-space:normal">${m.explain}</small></span></li>`)}</ul>`, { sub: "From business.json" })}
    </div>
    <div class="section">${panel("Declined payments", html`<div id="dtab" style="margin:-4px -16px -16px"></div>`, { sub: `${num(declined.length)}, newest first` })}</div>`;
  barChart(main.querySelector("#decl"), { labels: m24.map((m) => m.month), values: m24.map((m) => m.declined), fmt: num, name: "Declined", color: "var(--s5)", xFmt: (l, i, long) => (long ? monthLabel(l, true) : i % 3 === 0 ? monShort(l) : ""), xTicks: 24, height: 190 });
  table(main.querySelector("#meth"), { rows: d.methods, caption: "By way of paying", cols: [{ label: "Way of paying", cell: (m) => m.method }, { label: "Attempts", num: true, cell: (m) => num(m.orders) }, { label: "Declined", num: true, cell: (m) => html`${num(m.declined)} <span class="muted small">${pct(m.declined / m.orders, 1)}</span>` }, { label: "Taken", num: true, cell: (m) => money(m.money) }, { label: "Refunded", num: true, cell: (m) => money(m.refunded) }] });
  table(main.querySelector("#dtab"), { rows: declined, rowId: (r) => r[0], pageSize: 20, caption: "Declined payments", cols: [{ label: "Order", cell: (r) => html`<span class="id">${r[0]}</span>` }, { label: "Customer", cell: (r) => whoSync(custId(r[1]), cm) }, { label: "When", cell: (r) => dateTime(r[2]) }, { label: "Why", cell: (r) => r[4] }, { label: "Order now", cell: (r) => pill(r[5]) }, { label: "Total", num: true, cell: (r) => money2(r[3]) }] });
}

// ---------------------------------------------------------------- deliveries
export async function deliveries(main) {
  if (gate(main, "orders", "deliveries")) return;
  const [d, cm] = await Promise.all([load("deliveries.json"), customers()]);
  const one = scopedCustomer();
  const rows = d.rows.map((r) => ({ id: r[0], ord: r[1], c: custId(r[2]), carrier: r[3], st: r[4], method: r[5], sent: r[6], eta: r[7], arrived: r[8], lateBy: r[9], lateNow: r[10], note: r[11] })).filter((r) => !one || r.c === one);
  const m24 = last(d.months, 24), m12 = last(d.months, 12);
  const sent12 = m12.reduce((n, m) => n + m.sent, 0), late12 = m12.reduce((n, m) => n + m.late, 0);
  const now = rows.filter((r) => r.lateNow || (r.st === "lost" && r.sent >= S.meta.now.slice(0, 4)));
  const carriers = [...new Set(rows.map((r) => r.carrier).filter(Boolean))];
  main.innerHTML = html`${pageHead("Deliveries", "Every parcel: who carried it, when it was due and when it arrived. Late means it arrived after its due date, or is still out past it.")}
    ${strip([stat("Parcels sent, all time", num(rows.filter((r) => r.sent).length)), stat("On the road now", num(rows.filter((r) => ["in_transit", "delayed"].includes(r.st)).length), `${num(rows.filter((r) => r.st === "pending").length)} waiting to be packed`), stat("Late right now", num(rows.filter((r) => r.lateNow).length), "Past their due date, not arrived"), stat("Arrived late, last 12 months", pct(late12 / (sent12 || 1), 1), `${num(late12)} of ${num(sent12)} parcels`), stat("Lost, all time", num(rows.filter((r) => r.st === "lost").length), "A replacement or a refund followed")])}
    ${now.length ? html`<div class="section" style="margin-top:16px">${panel("Needs someone now", html`<div id="nowTab" style="margin:-4px -16px -16px"></div>`, { sub: "Late parcels, and parcels lost this year" })}</div>` : ""}
    <div class="cols c21 section">
      ${panel("Share of parcels that arrived late", html`<div id="lateCh"></div>`, { sub: "By month sent, last 24 months" })}
      ${panel("By carrier", html`${raw(hbars(carriers.map((c, i) => ({ name: c, value: rows.filter((r) => r.carrier === c).length, color: SERIES[i] })), { fmt: num }))}<dl class="kv" style="margin-top:14px">${carriers.map((c) => { const mine = rows.filter((r) => r.carrier === c && r.arrived); return html`<dt>${c}</dt><dd>${pct(mine.filter((r) => r.lateBy > 0).length / (mine.length || 1), 1)} arrived late · ${num(rows.filter((r) => r.carrier === c && r.st === "lost").length)} lost</dd>`; })}</dl>`)}
    </div>
    <div class="section" id="shipList"></div>`;
  if (now.length) table(main.querySelector("#nowTab"), { rows: now, rowId: (r) => r.ord, caption: "Late and lost parcels", cols: shipCols(cm) });
  lineChart(main.querySelector("#lateCh"), { labels: m24.map((m) => m.month), series: [{ name: "Arrived late", values: m24.map((m) => (m.sent ? m.late / m.sent : 0)), color: "var(--s2)", area: true }], fmt: (v) => pct(v, 1), xFmt: (l, i, long) => (long ? monthLabel(l, true) : monShort(l)), height: 200, title: "Share of parcels that arrived late", series2: null });
  dataList(main.querySelector("#shipList"), {
    key: "ships", rows, rowId: (r) => r.ord, placeholder: "Parcel, order, tracking, customer", caption: "Parcels",
    text: (r) => `${r.id} ${r.ord} ${canSeeCustomer(r.c) ? cm.get(r.c)?.name : ""} ${r.carrier}`,
    views: [{ id: "all", label: "All parcels" }, { id: "road", label: "On the road", test: (r) => ["in_transit", "delayed"].includes(r.st) }, { id: "late", label: "Arrived late", test: (r) => r.lateBy > 0 }, { id: "lost", label: "Lost", test: (r) => r.st === "lost" }, { id: "pending", label: "Waiting to be packed", test: (r) => r.st === "pending" }],
    chips: [...carriers.map((c) => ({ id: c, label: c, test: (r) => r.carrier === c })), { id: "chilled", label: "Chilled", test: (r) => r.method === "chilled" }, { id: "next", label: "Next-day", test: (r) => r.method === "next-day" }],
    cols: shipCols(cm),
  });
}
const shipCols = (cm) => [
  { label: "Parcel", sort: (r) => r.sent || "9", cell: (r) => html`<span class="id">${r.id}</span><span class="sub">${r.sent ? `Sent ${dateShort(r.sent)} ${r.sent.slice(0, 4)}` : "Not sent"}</span>` },
  { label: "Customer", cell: (r) => whoSync(r.c, cm) },
  { label: "Carrier", sort: (r) => r.carrier, cell: (r) => r.carrier || "–", cls: "hide-m" },
  { label: "Due", sort: (r) => r.eta, cell: (r) => date(r.eta) },
  { label: "Status", sort: (r) => r.st, cell: (r) => pill(r.st) },
  { label: "Late by", num: true, sort: (r) => r.lateBy, cell: (r) => (r.lateBy > 0 ? html`<span class="down">${r.lateBy} ${r.lateBy === 1 ? "day" : "days"}</span>` : html`<span class="muted">–</span>`) },
];

// ---------------------------------------------------------------- returns and refunds
export async function returns(main) {
  if (gate(main, "orders", "returns")) return;
  const [d, cm, prods] = await Promise.all([load("returns.json"), customers(), load("products.json")]);
  const one = scopedCustomer();
  const rows = d.map((r) => ({ id: r[0], ord: r[1], c: custId(r[2]), at: r[3], reason: r[4], st: r[5], refund: r[6], skus: r[7].split(","), postage: r[8], refundedAt: r[9], qty: r[10] })).filter((r) => !one || r.c === one);
  const open = rows.filter((r) => !["refunded", "rejected"].includes(r.st));
  const REASON_C = { change_of_mind: "var(--s1)", faulty: "var(--s2)", damaged: "var(--s3)", wrong_item: "var(--s4)" };
  main.innerHTML = html`${pageHead("Returns and refunds", "Everything sent back: why, what state it is in, and the money returned. A refund is paid when the warehouse has checked the item.")}
    ${strip([stat("Returns, all time", num(rows.length), `${num(rows.reduce((n, r) => n + r.qty, 0))} items`), stat("Still open", num(open.length), `${num(rows.filter((r) => r.st === "received").length)} arrived and waiting to be checked`), stat("Refunded", money2(rows.filter((r) => r.refundedAt).reduce((n, r) => n + r.refund, 0)), "Paid back to customers for returns"), stat("Rejected", num(rows.filter((r) => r.st === "rejected").length), "Failed the check"), stat("Faulty or damaged", pct(rows.filter((r) => ["faulty", "damaged"].includes(r.reason)).length / (rows.length || 1)), "Share of returns")])}
    <div class="cols c2 section" style="margin-top:16px">
      ${panel("Why things come back", raw(meter(Object.keys(REASON_C).map((k) => ({ name: cap(words(k)), value: rows.filter((r) => r.reason === k).length, color: REASON_C[k] })), { fmt: num })))}
      ${panel("Most returned, as a share of units sold", raw(hbars(prods.filter((p) => p.sold >= 10).map((p) => ({ name: p.name, value: p.returned / p.sold, href: `#/products/${p.id}`, title: `${p.name}: ${p.returned} of ${p.sold} units` })).sort((a, b) => b.value - a.value).slice(0, 6), { fmt: (v) => pct(v, 1), color: "var(--s2)" })), { sub: "Products with 10 or more sold" })}
    </div>
    <div class="section" id="retList"></div>`;
  dataList(main.querySelector("#retList"), {
    key: "returns", rows, rowId: (r) => r.id, placeholder: "Return, order, customer, product", caption: "Returns",
    text: (r) => `${r.id} ${r.ord} ${canSeeCustomer(r.c) ? cm.get(r.c)?.name : ""} ${r.skus.map(skuName).join(" ")}`,
    views: [{ id: "all", label: "All" }, { id: "open", label: "Open", test: (r) => !["refunded", "rejected"].includes(r.st) }, { id: "refunded", label: "Refunded", test: (r) => r.st === "refunded" }, { id: "rejected", label: "Rejected", test: (r) => r.st === "rejected" }],
    chips: Object.keys(REASON_C).map((k) => ({ id: k, label: cap(words(k)), test: (r) => r.reason === k })),
    cols: [
      { label: "Return", sort: (r) => r.at, cell: (r) => html`<span class="id">${r.id}</span><span class="sub">${date(r.at)}</span>` },
      { label: "Customer", cell: (r) => whoSync(r.c, cm) },
      { label: "Items", cell: (r) => html`<span class="row" style="gap:6px;flex-wrap:nowrap">${r.skus.slice(0, 2).map((k) => html`<span class="small">${skuName(k)}</span>`)}</span>`, cls: "hide-m" },
      { label: "Reason", sort: (r) => r.reason, cell: (r) => cap(words(r.reason)) },
      { label: "Status", sort: (r) => r.st, cell: (r) => pill(r.st, "ret") },
      { label: "Refund", num: true, sort: (r) => r.refund, cell: (r) => money2(r.refund) },
    ],
  });
}
