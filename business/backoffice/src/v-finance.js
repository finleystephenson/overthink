// Finance: profit and loss, cash, margins by product, the ledger, and things worth a look.
import { S, load, html, raw, money, money2, num, pct, compact, date, dateTime, words, cap, idLink, icon, chip, tonePill, access, strip, stat, panel, pageHead, dataList, table, lockPanel, tabs, monthLabel, monShort, productById, prodLink, delta } from "./core.js";
import { lineChart, barChart, hbars, meter, SERIES } from "./charts.js";

const TABS = () => [["#/finance", "Profit and loss"], ["#/finance/cash", "Cash"], ["#/finance/margins", "Margins by product"], ["#/ledger", "Ledger"], ["#/finance/anomalies", "Worth a look"]];
const gate = (main, area, what) => { if (access(area) === "none") { main.innerHTML = String(lockPanel(area, what)); return true; } return false; };
const head = (sub, on) => html`${pageHead("Finance", sub)}${tabs(TABS(), on)}`;
const OPEX = [["payment_fee", "Card fees"], ["delivery_cost", "Carrier charges"], ["wages", "Wages"], ["rent", "Rent"], ["software", "Software"], ["marketing_spend", "Marketing"], ["goodwill_credit", "Goodwill credit"]];
const LINES = [
  ["sales", "Items sold", "Items sold, after any discount"], ["delivery_income", "Delivery charges", "Delivery paid by customers"], ["revenue", "Revenue", "Items sold plus delivery charges", 1],
  ["refunds", "Refunds", "Money given back", 0, -1], ["cost_of_goods", "Cost of the goods sold", "What the stock that left cost us; stock coming back reverses it", 0, -1], ["gross_margin", "Gross margin", "Revenue minus refunds and the cost of goods", 1],
  ...OPEX.map(([k, l]) => [k, l, null, 0, -1, true]), ["operating_costs_total", "Running costs", "All the costs above added up", 0, -1], ["profit", "Profit", "Gross margin minus running costs", 2],
];
const val = (m, k) => (OPEX.some(([o]) => o === k) ? m.operating_costs[k] || 0 : m[k]);

// ---------------------------------------------------------------- profit and loss
export async function pnl(main, _, q) {
  if (gate(main, "finance", "the company's figures")) return;
  const { months } = await load("money.json");
  const years = [...new Set(months.map((m) => m.month.slice(0, 4)))];
  const y = years.includes(q.year) ? q.year : years.at(-1);
  const ms = months.filter((m) => m.month.startsWith(y)), prev = months.filter((m) => m.month.startsWith(String(+y - 1)));
  const sum = (list, k) => list.reduce((n, m) => n + val(m, k), 0);
  const partial = ms.length < 12;
  const prevSame = prev.filter((m) => +m.month.slice(5) <= ms.length);
  main.innerHTML = html`${head("Where the money came from and went, month by month. Everything here is the ledger added up, so it matches the validator to the penny.", "#/finance")}
    <div class="row" style="margin-bottom:14px"><span class="seg" role="group" aria-label="Year">${years.map((yy) => html`<button aria-pressed="${yy === y}" data-y="${yy}">${yy}</button>`)}</span>${partial ? html`<span class="muted small">${y} to date: ${ms.length} months. Compared with the same months of ${+y - 1}.</span>` : ""}</div>
    ${strip([stat("Revenue", money(sum(ms, "revenue")), html`${delta(sum(ms, "revenue"), sum(prevSame, "revenue"))} vs ${money(sum(prevSame, "revenue"))}`), stat("Gross margin", money(sum(ms, "gross_margin")), `${pct(sum(ms, "gross_margin") / (sum(ms, "revenue") || 1), 1)} of revenue`), stat("Running costs", money(sum(ms, "operating_costs_total")), html`${delta(sum(ms, "operating_costs_total"), sum(prevSame, "operating_costs_total"), { good: -1 })} vs last year`), stat("Profit", money(sum(ms, "profit")), html`${delta(sum(ms, "profit"), sum(prevSame, "profit"))} vs ${money(sum(prevSame, "profit"))}`), stat("Paid orders", num(sum(ms, "orders")), `Average ${money2(sum(ms, "revenue") / (sum(ms, "orders") || 1))}`)])}
    <div class="cols c2 section" style="margin-top:16px">${panel("Profit by month", html`<div id="pCh"></div>`, { sub: `${y} against ${+y - 1}` })}${panel("Revenue by month", html`<div id="rCh"></div>`, { sub: `${y} against ${+y - 1}` })}</div>
    <div class="section">${panel(`Profit and loss, ${y}`, html`<div class="tbl-wrap" style="margin:-4px -16px -16px"><table class="pl"><thead><tr><th scope="col" style="position:sticky;left:0;z-index:3">Line</th>${ms.map((m) => html`<th class="num" scope="col">${monthLabel(m.month).split(" ")[0]}</th>`)}<th class="num" scope="col">${y}</th><th class="num" scope="col">${+y - 1}${partial ? " same months" : ""}</th></tr></thead><tbody>${LINES.map(([k, l, t, bold, sign, indent]) => html`<tr style="${bold ? "font-weight:650" : ""}"><td style="position:sticky;left:0;background:var(--panel);${indent ? "padding-left:26px;color:var(--ink-2)" : ""}" ${t ? raw(`title="${t}"`) : ""}>${l}</td>${ms.map((m) => html`<td class="num ${k === "profit" && m.profit < 0 ? "down" : ""}">${money(val(m, k) * (sign || 1))}</td>`)}<td class="num" style="background:var(--sunken)">${money(sum(ms, k) * (sign || 1))}</td><td class="num muted">${money(sum(prevSame, k) * (sign || 1))}</td></tr>`)}</tbody></table></div>`, { sub: "Costs shown as minus figures" })}</div>`;
  main.querySelectorAll("[data-y]").forEach((b) => (b.onclick = () => (location.hash = `#/finance?year=${b.dataset.y}`)));
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const byM = (list, k) => MON.map((_, i) => list.find((m) => +m.month.slice(5) === i + 1)?.[k] ?? null);
  barChart(main.querySelector("#pCh"), { labels: MON, values: byM(ms, "profit"), prev: byM(prev, "profit"), name: y, prevName: String(+y - 1), fmt: money, tickFmt: compact, color: (v) => (v < 0 ? "var(--s2)" : "var(--s4)"), height: 200 });
  lineChart(main.querySelector("#rCh"), { labels: MON, series: [{ name: y, values: byM(ms, "revenue"), color: "var(--s1)", area: true }, { name: String(+y - 1), values: byM(prev, "revenue"), color: "var(--s-prev)", dash: true }], fmt: compact, xTicks: 12, height: 200 });
}

// ---------------------------------------------------------------- cash
export async function cash(main) {
  if (gate(main, "finance", "the company's cash")) return;
  const { months, opening_cash } = await load("money.json");
  const now = months.at(-1), yearAgo = months.at(-13);
  const low = months.reduce((a, m) => (m.cash_at_month_end < a.cash_at_month_end ? m : a), months[0]);
  const last12 = months.slice(-12);
  const sum = (k) => last12.reduce((n, m) => n + val(m, k), 0);
  const ins = [["Items sold", sum("sales")], ["Delivery charges", sum("delivery_income")]];
  const outs = [["Paid to suppliers", sum("supplier_payments")], ["Refunds", sum("refunds")], ...OPEX.filter(([k]) => k !== "goodwill_credit").map(([k, l]) => [l, sum(k)])].sort((a, b) => b[1] - a[1]);
  main.innerHTML = html`${head("The money in the bank. Cash is not profit: stock is paid for when the supplier's terms run out, not when it sells.", "#/finance/cash")}
    <div class="cols main-aside"><div class="panel"><div class="panel-b"><div class="row" style="align-items:flex-end;gap:18px;margin-bottom:10px"><div><div class="muted small">In the bank now</div><div class="display hero-num">${money(now.cash_at_month_end)}</div></div><div class="small">${delta(now.cash_at_month_end, yearAgo?.cash_at_month_end)} <span class="muted">vs ${money(yearAgo?.cash_at_month_end)} a year ago</span></div></div><div id="cashCh"></div></div></div>
      <div class="stack">${strip([stat("Founder's cash", money(opening_cash), "Put in at the start")])}${strip([stat("Lowest month end", money(low.cash_at_month_end), monthLabel(low.month, true))])}${strip([stat("Paid to suppliers, 12 months", money(sum("supplier_payments")), "At the end of their payment terms")])}</div></div>
    <div class="cols c2 section">${panel("Money in, last 12 months", raw(hbars(ins.map(([n, v]) => ({ name: n, value: v, color: "var(--s4)" })), { fmt: money, max: Math.max(...ins.map((x) => x[1]), ...outs.map((x) => x[1])) })))}${panel("Money out, last 12 months", raw(hbars(outs.map(([n, v]) => ({ name: n, value: v, color: "var(--s2)" })), { fmt: money, max: Math.max(...ins.map((x) => x[1]), ...outs.map((x) => x[1])) })), { sub: "Cash only: the cost of goods is paid through suppliers" })}</div>`;
  lineChart(main.querySelector("#cashCh"), { labels: months.map((m) => m.month), series: [{ name: "Cash at the month's end", values: months.map((m) => m.cash_at_month_end), color: "var(--s1)", area: true }], fmt: money, tickFmt: compact, xFmt: (l, i, long) => (long ? monthLabel(l, true) : l.endsWith("-01") ? l.slice(0, 4) : ""), xTicks: 60, height: 240, title: "Cash at the end of each month" });
}

// ---------------------------------------------------------------- margins by product
export async function margins(main) {
  if (gate(main, "cost", "costs and margins")) return;
  const list = (await load("products.json")).filter((p) => p.revenue > 0).map((p) => ({ ...p, gm: p.revenue - p.cost_sold, gp: (p.revenue - p.cost_sold) / p.revenue }));
  const rev = list.reduce((n, p) => n + p.revenue, 0), gm = list.reduce((n, p) => n + p.gm, 0);
  main.innerHTML = html`${head("What each product makes after paying for it. Item sales only (no delivery), paid orders, all time, at the cost the supplier charges today.", "#/finance/margins")}
    ${strip([stat("Item sales", money(rev)), stat("Their cost", money(rev - gm)), stat("Margin", money(gm), `${pct(gm / rev, 1)} of item sales`), stat("Best margin", list.sort((a, b) => b.gp - a.gp)[0]?.name, pct(list[0]?.gp, 1)), stat("Thinnest margin", list.at(-1)?.name, pct(list.at(-1)?.gp, 1))])}
    <div class="cols c2 section" style="margin-top:16px">${panel("Margin as a share of sales", raw(hbars(list.map((p) => ({ name: p.name, value: p.gp, href: `#/products/${p.id}`, color: p.gp < 0.4 ? "var(--s2)" : "var(--s4)" })), { fmt: (v) => pct(v), max: 1 })))}${panel("Margin in pounds", raw(hbars([...list].sort((a, b) => b.gm - a.gm).map((p) => ({ name: p.name, value: p.gm, href: `#/products/${p.id}` })), { fmt: money })))}</div>`;
}

// ---------------------------------------------------------------- the ledger
export async function ledger(main, _, q) {
  if (gate(main, "ledger", "the ledger")) return;
  const { ledger_years, types } = await load("money.json");
  const years = Object.keys(ledger_years).sort().reverse();
  const y = q.year === "all" ? "all" : years.includes(q.year) ? q.year : years[0];
  const raws = y === "all" ? (await Promise.all(years.map((yy) => load(`ledger/y${yy}.json`)))).flat() : await load(`ledger/y${y}.json`);
  const rows = raws.map((e) => ({ id: e[0], at: e[1], type: e[2], amount: e[3], ref: e[4], why: e[5] }));
  const by = {}; for (const r of rows) by[r.type] = (by[r.type] || 0) + r.amount;
  main.innerHTML = html`${head("Every pound in and out, in time order. Entries are never edited: mistakes are put right with a correction that gives its reason.", "#/ledger")}
    <div class="row" style="margin-bottom:14px"><span class="seg" role="group" aria-label="Year">${[...years, "all"].map((yy) => html`<button aria-pressed="${yy === y}" data-y="${yy}">${yy === "all" ? "All years" : yy}</button>`)}</span><span class="muted small">${num(rows.length)} entries</span></div>
    ${strip([stat("Money in", money(rows.filter((r) => r.amount > 0).reduce((n, r) => n + r.amount, 0)), "Positive entries"), stat("Money out", money(-rows.filter((r) => r.amount < 0 && r.type !== "cost_of_goods" && r.type !== "goodwill_credit").reduce((n, r) => n + r.amount, 0)), "Cash entries only"), stat("Cost of goods", money(-(by.cost_of_goods || 0)), "Not cash: counted when goods sell"), stat("Refunds", money(-(by.refund || 0))), stat("Corrections", num(rows.filter((r) => r.type === "correction").length), "Added by hand, with a reason")])}
    <div class="section" id="lgList" style="margin-top:16px"></div>`;
  main.querySelectorAll("[data-y]").forEach((b) => (b.onclick = () => (location.hash = `#/ledger?year=${b.dataset.y}`)));
  dataList(main.querySelector("#lgList"), {
    key: "ledger", rows, rowId: (r) => r.id, pageSize: 100, placeholder: "Reference (ORD-…, PO-…), id or reason", caption: "Ledger entries",
    text: (r) => `${r.id} ${r.ref || ""} ${r.why || ""} ${r.type}`,
    views: [{ id: "all", label: "All" }, { id: "in", label: "Money in", test: (r) => r.amount > 0 }, { id: "out", label: "Money out", test: (r) => r.amount < 0 }],
    chips: types.map((t) => ({ id: t, label: cap(words(t)), test: (r) => r.type === t })),
    cols: [
      { label: "Entry", sort: (r) => r.id, cell: (r) => html`<span class="id">${r.id}</span>` },
      { label: "When", sort: (r) => r.at, cell: (r) => dateTime(r.at) },
      { label: "Type", sort: (r) => r.type, cell: (r) => cap(words(r.type)) },
      { label: "For", cell: (r) => (r.ref && /^[A-Z]+-/.test(r.ref) ? idLink(r.ref) : r.ref || "–") },
      { label: "Reason", cell: (r) => r.why || "", cls: "clip hide-m" },
      { label: "Amount", num: true, sort: (r) => r.amount, cell: (r) => html`<span class="${r.amount > 0 ? "up" : ""}">${money2(r.amount)}</span>` },
    ],
  }).setQuery(q.q || "");
}

// ---------------------------------------------------------------- anomalies worth a look
export async function anomalies(main) {
  if (gate(main, "ledger", "the ledger")) return;
  const { anomalies: list } = await load("money.json");
  const KIND = { refund_mismatch: ["A refund paid more than once", "crit", "The ledger's refunds for a return add up to more than the return's refund amount."], refund_over_paid: ["Refunds above what was paid", "crit", "The refunds against one order add up to more than its total."], correction: ["A correction added by hand", "warn", "Every correction entry: finance adds these, always with a reason."], loss_month: ["A month that lost money", "info", "Any of the last 12 months whose profit was below zero."] };
  main.innerHTML = html`${head("Things a bookkeeper would want to check. Each is found by a plain rule over the ledger, listed under the item.", "#/finance/anomalies")}
    ${list.length ? html`<div class="panel"><ul class="needs">${list.map((a) => html`<li class="need ${KIND[a.kind][1] === "crit" ? "critical" : KIND[a.kind][1] === "warn" ? "warning" : "info"}"><span class="ic">${icon(KIND[a.kind][1] === "info" ? "clock" : "alert")}</span><div><b>${a.title}</b><p>${a.detail}</p><p class="tiny muted" style="margin-top:4px">Rule: ${KIND[a.kind][2]}</p></div><span class="who-tag">${KIND[a.kind][0]}</span><div class="refs">${a.refs.map((r) => chip(r))}</div></li>`)}</ul></div>` : html`<div class="panel"><div class="empty"><b>Nothing looks wrong.</b>No rule found anything.</div></div>`}`;
}
