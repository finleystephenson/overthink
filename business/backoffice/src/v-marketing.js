// Marketing and sales: campaigns and their results, where visitors come from, the path to an order, repeat buying, best sellers.
import { S, load, html, raw, money, money2, num, pct, compact, date, cap, words, tonePill, access, strip, stat, panel, pageHead, table, lockPanel, tabs, monthLabel, monShort, productById, prodLink, delta } from "./core.js";
import { lineChart, barChart, hbars, SERIES } from "./charts.js";

const TABS = () => [["#/marketing", "Campaigns"], ["#/marketing/funnel", "Visitors and funnel"], ["#/marketing/sales", "Repeat buying and best sellers"]];
const gate = (main) => { if (access("marketing") === "none") { main.innerHTML = String(lockPanel("marketing", "marketing figures")); return true; } return false; };
const head = (sub, on) => html`${pageHead("Marketing and sales", sub)}${tabs(TABS(), on)}`;
const CH = { direct: "var(--s1)", search: "var(--s2)", social: "var(--s3)", email: "var(--s4)", referral: "var(--s5)", none: "var(--s6)" };

export async function campaigns(main) {
  if (gate(main)) return;
  const { campaigns: list } = await load("marketing.json");
  const spend = list.reduce((n, c) => n + c.spend, 0), orders = list.reduce((n, c) => n + c.orders_attributed, 0);
  const chans = [...new Set(list.filter((c) => c.spend > 0).map((c) => c.channel))];
  const now = S.meta.now.slice(0, 10);
  main.innerHTML = html`${head("Every campaign: what it cost, the visits and orders put down to it, and the orders that used its code.", "#/marketing")}
    ${strip([stat("Campaigns", num(list.length), `${list.filter((c) => c.start <= now && c.end >= now).length} running now`), stat("Spent", money(spend), "All time"), stat("Visits from campaigns", num(list.reduce((n, c) => n + c.visits, 0))), stat("Orders put down to them", num(orders), "By the generator's attribution"), stat("Cost per order", money2(spend / (orders || 1)), "Spend divided by those orders")])}
    <div class="cols c2 section" style="margin-top:16px">${panel("Cost per order, by channel", raw(hbars(chans.map((ch) => { const l = list.filter((c) => c.channel === ch), o = l.reduce((n, c) => n + c.orders_attributed, 0); return { name: cap(ch), value: o ? l.reduce((n, c) => n + c.spend, 0) / o : 0, color: CH[ch] }; }).sort((a, b) => a.value - b.value), { fmt: money2 })), { sub: "Lower is better" })}
      ${panel("Spend by year", html`<div id="spCh"></div>`)}</div>
    <div class="section panel" id="cTab"></div>`;
  const ys = [...new Set(list.map((c) => c.start.slice(0, 4)))].sort();
  barChart(main.querySelector("#spCh"), { labels: ys, values: ys.map((y) => list.filter((c) => c.start.startsWith(y)).reduce((n, c) => n + c.spend, 0)), fmt: money, name: "Spend", color: "var(--s3)", height: 180, labelBars: true });
  table(main.querySelector("#cTab"), { rows: list, rowId: (c) => c.id, sortCol: 1, caption: "Campaigns", cols: [
    { label: "Campaign", sort: (c) => c.name, cell: (c) => html`<b style="font-weight:600">${c.name}</b><span class="sub">${cap(c.channel)}${c.code ? ` · code ${c.code}` : ""}</span>` },
    { label: "When", sort: (c) => c.start, cell: (c) => html`${date(c.start)}<span class="sub">to ${date(c.end)}</span>`, cls: "hide-m" },
    { label: "Spend", num: true, sort: (c) => c.spend, cell: (c) => money(c.spend) },
    { label: "Visits", num: true, sort: (c) => c.visits, cell: (c) => num(c.visits), cls: "hide-m" },
    { label: "Orders", num: true, sort: (c) => c.orders_attributed, cell: (c) => num(c.orders_attributed), title: "Orders put down to the campaign" },
    { label: "Used the code", num: true, sort: (c) => c.code_orders ?? -1, cell: (c) => (c.code ? html`${num(c.code_orders)}<span class="sub">${money(c.code_money)}</span>` : "–"), cls: "hide-m" },
    { label: "Cost per order", num: true, sort: (c) => (c.orders_attributed ? c.spend / c.orders_attributed : 1e9), cell: (c) => (c.orders_attributed ? money2(c.spend / c.orders_attributed) : "–") },
  ] });
}

export async function funnel(main, _, q) {
  if (gate(main)) return;
  const { web } = await load("marketing.json");
  const span = { "3": 3, "12": 12, all: web.length }[q.span || "12"] || 12;
  const sel = web.slice(-span), prev = web.slice(-span * 2, -span);
  const sum = (l, k) => l.reduce((n, m) => n + m[k], 0);
  const visits = sum(sel, "total"), started = sum(sel, "started"), orders = sum(sel, "orders"), aband = sum(sel, "abandoned"), lost = sum(sel, "lost");
  const chans = Object.keys(sel[0]?.visits || {});
  const views = {}; for (const m of sel) for (const [k, v] of Object.entries(m.views)) views[k] = (views[k] || 0) + v;
  const m24 = web.slice(-24);
  const step = (label, n, of, note) => html`<div class="step"><span>${label}</span><span class="bar" style="width:${Math.max(1, (n / (visits || 1)) * 100)}%"></span><span class="tab"><b>${num(n)}</b> <span class="muted small">${of != null ? pct(n / (of || 1), 1) : ""}</span></span></div>${note ? html`<div class="step"><span></span><span class="drop">${note}</span><span></span></div>` : ""}`;
  main.innerHTML = html`${head("Where visitors come from and how many of them end up buying. From the website's daily figures.", "#/marketing/funnel")}
    <div class="row" style="margin-bottom:14px"><span class="seg" role="group" aria-label="Period">${[["3", "Last 3 months"], ["12", "Last 12 months"], ["all", "All time"]].map(([k, l]) => html`<button aria-pressed="${String(q.span || "12") === k}" data-s="${k}">${l}</button>`)}</span><span class="muted small">${monthLabel(sel[0].month, true)} to ${monthLabel(sel.at(-1).month, true)}${sel.at(-1).month === S.meta.now.slice(0, 7) ? " (to date)" : ""}</span></div>
    ${strip([stat("Visits", num(visits), prev.length ? html`${delta(visits, sum(prev, "total"))} vs the period before` : ""), stat("Started a basket", pct(started / (visits || 1), 1), `${num(started)} baskets`), stat("Bought", pct(orders / (visits || 1), 2), html`${num(orders)} orders from the website <span class="term" title="Visits that ended in an order">conversion</span>`), stat("Baskets left behind", num(aband), `${pct(aband / (started || 1))} of baskets started`), stat("Lost to empty shelves", num(lost), "Baskets given up", { href: "#/stockouts" })])}
    <div class="cols c2 section" style="margin-top:16px">
      ${panel("From a visit to an order", html`<div class="funnel">${step("Visits", visits, null, `${pct(1 - started / (visits || 1), 1)} left without starting a basket`)}${step("Started a basket", started, visits, `${num(aband)} baskets left behind, ${num(lost)} of them because something was out of stock`)}${step("Ordered", orders, visits)}</div>`)}
      ${panel("Where visits came from", raw(hbars(chans.map((k) => ({ name: cap(k), value: sum(sel.map((m) => ({ v: m.visits[k] || 0 })), "v"), color: CH[k] || "var(--s6)" })).sort((a, b) => b.value - a.value), { fmt: num })))}
    </div>
    <div class="section">${panel("Visits by channel, month by month", html`<div id="vCh"></div>`, { sub: "Last 24 months" })}</div>
    <div class="section">${panel("Most viewed product pages", raw(hbars(Object.entries(views).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => ({ name: productById(k)?.name || k, value: v, href: `#/products/${k}` })), { fmt: num })), { sub: "In the selected period" })}</div>`;
  main.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => (location.hash = `#/marketing/funnel?span=${b.dataset.s}`)));
  lineChart(main.querySelector("#vCh"), { labels: m24.map((m) => m.month), series: chans.map((k) => ({ name: cap(k), values: m24.map((m) => m.visits[k] || 0), color: CH[k] || "var(--s6)" })), fmt: num, tickFmt: (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : String(v)), xFmt: (l, i, long) => (long ? monthLabel(l, true) : monShort(l)), height: 240, endLabel: false });
}

export async function sales(main) {
  if (gate(main)) return;
  const [{ cohorts, movers }, money_] = await Promise.all([load("marketing.json"), access("finance") !== "none" ? load("money.json") : null]);
  const ms = money_?.months.slice(-24) || [];
  const mv = movers.filter((m) => m.now || m.before).map((m) => ({ ...m, ch: m.before ? (m.now - m.before) / m.before : null }));
  main.innerHTML = html`${head("Who comes back, and what is selling more or less than before.", "#/marketing/sales")}
    <div class="cols c2">
      ${panel("Do first-time buyers come back?", html`<div id="coh" style="margin:-4px -16px -16px"></div>`, { sub: "Customers grouped by the year of their first paid order" })}
      ${ms.length ? panel("New customers by month", html`<div id="ncCh"></div>`, { sub: "First paid order that month" }) : ""}
    </div>
    ${ms.length ? html`<div class="section">${panel("Share of orders from returning customers", html`<div id="rrCh"></div>`, { sub: "Monthly summary's repeat rate, last 24 months" })}</div>` : ""}
    <div class="section">${panel("Best sellers, last 90 days", html`<div id="mvTab" style="margin:-4px -16px -16px"></div>`, { sub: "Units sold, against the 90 days before" })}</div>`;
  table(main.querySelector("#coh"), { rows: cohorts, caption: "Repeat buying by first year", cols: [{ label: "First bought in", cell: (c) => c.year }, { label: "Customers", num: true, cell: (c) => num(c.customers) }, { label: "Came back", num: true, cell: (c) => num(c.came_back) }, { label: "Share", num: true, cell: (c) => html`<span class="row" style="justify-content:flex-end;flex-wrap:nowrap"><span class="meter" style="width:80px"><i style="width:${(c.came_back / (c.customers || 1)) * 100}%;background:var(--s4)"></i></span><b class="tab">${pct(c.came_back / (c.customers || 1))}</b></span>` }] });
  if (ms.length) {
    barChart(main.querySelector("#ncCh"), { labels: ms.map((m) => m.month), values: ms.map((m) => m.new_customers), fmt: num, name: "New customers", color: "var(--s1)", xFmt: (l, i, long) => (long ? monthLabel(l, true) : i % 3 === 0 ? monShort(l) : ""), xTicks: 24, height: 190 });
    lineChart(main.querySelector("#rrCh"), { labels: ms.map((m) => m.month), series: [{ name: "From returning customers", values: ms.map((m) => m.repeat_rate), color: "var(--s4)", area: true }], fmt: (v) => pct(v), xFmt: (l, i, long) => (long ? monthLabel(l, true) : monShort(l)), height: 190 });
  }
  table(main.querySelector("#mvTab"), { rows: mv, rowId: (m) => m.id, onOpen: (id) => (location.hash = `#/products/${id}`), sortCol: 1, caption: "Best sellers", cols: [
    { label: "Product", cell: (m) => prodLink(m.id) },
    { label: "Last 90 days", num: true, sort: (m) => m.now, cell: (m) => num(m.now) },
    { label: "90 days before", num: true, sort: (m) => m.before, cell: (m) => num(m.before), cls: "hide-m" },
    { label: "Change", num: true, sort: (m) => m.ch ?? -9, cell: (m) => (m.ch == null ? tonePill("New", "info") : html`<b class="${m.ch > 0 ? "up" : m.ch < 0 ? "down" : ""}">${m.ch > 0 ? "↑" : m.ch < 0 ? "↓" : ""} ${pct(Math.abs(m.ch))}</b>`) },
  ] });
}
