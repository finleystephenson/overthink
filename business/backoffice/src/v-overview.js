// Company overview: what is happening today, what needs someone, what just happened, five years, and what the company is.
import { S, load, html, raw, money, money2, num, pct, compact, date, dateShort, time, longNow, monthLabel, monShort, customers, chip, icon, roleName, access, redact, scopedCustomer, strip, stat, panel, pageHead, delta, plural, prodLink, href, canSeeCustomer, avatar, productById, words, esc } from "./core.js";
import { lineChart, barChart, hbars } from "./charts.js";

const TONES = { critical: ["Urgent", "alert"], serious: ["Today", "alert"], warning: ["Soon", "clock"], info: ["Routine", "check"] };
const KIND_ICON = { order: "cart", payment: "card", dispatch: "truck", delivery: "truck", return: "ret", refund: "coins", contact: "chat", case: "headset", conversation: "chat", supplier: "factory", purchase: "factory", count: "stock", stock: "stock", repair: "wrench" };
const KIND_GROUPS = { all: ["All", null], orders: ["Orders and payments", ["order", "payment"]], parcels: ["Parcels", ["dispatch", "delivery"]], returns: ["Returns and refunds", ["return", "refund"]], service: ["Service", ["contact", "case", "conversation", "repair"]], supply: ["Supply and stock", ["supplier", "purchase", "count", "stock"]] };

// ---------------------------------------------------------------- shared bits
// Load what every page here needs and work out what this role may see.
async function context() {
  const [o, cm] = await Promise.all([load("overview.json"), customers()]);
  const one = scopedCustomer(), cust = access("customers"), fin = access("finance") !== "none";
  const needs = one ? o.needs.filter((n) => n.refs.includes(one)) : o.needs;
  const nameOf = (id) => (id && canSeeCustomer(id) ? cm.get(id)?.name : null);
  return { o, cm, one, cust, fin, needs, nameOf, hide: (v) => (fin ? v : redact(String(v), false)), hideIf: (ok, v) => (ok ? v : redact(String(v), false)) };
}
const TONE_RANK = { critical: 0, serious: 1, warning: 2, info: 3 };
// What each kind of "needs you" item is called when several are grouped, and where its one action goes.
const GROUP_TITLE = {
  "stock:critical": (n) => `${n} products are out of stock, with paid orders waiting`,
  "service:critical": (n) => `${n} complaints are past their answer date`,
  "service:warning": (n) => `${n} cases are waiting for someone`,
  "orders:info": (n) => `${n} order groups are ready to pack`,
  "returns:info": (n) => `${n} returns have arrived and need checking`,
};
const GROUP_ACTION = { stock: ["See stock", "#/stock"], service: ["See the cases", "#/service/cases"], buying: ["See the order", null], delivery: ["See the parcel", null], orders: ["See orders", "#/orders"], money: ["See the entry", null], knowledge: ["Read it", null], repairs: ["See the repair", null], returns: ["See returns", "#/returns"] };
const firstRef = (n) => n.refs.find((r) => /^(ORD|CASE|PO|SC|RET|FIX|CT|DOC|LED|SHP)/.test(r)) || n.refs[0];
// Group the rules' findings by kind and urgency, most urgent first, so three lines can stand for all of them.
function groupNeeds(needs) {
  const g = new Map();
  for (const n of needs) { const k = `${n.kind}:${n.tone}`; if (!g.has(k)) g.set(k, { key: k, kind: n.kind, tone: n.tone, items: [] }); g.get(k).items.push(n); }
  return [...g.values()].map((x) => {
    const n = x.items.length, one = x.items[0];
    const title = n === 1 ? one.title : GROUP_TITLE[x.key]?.(n) || `${n} ${words(x.kind)} items need attention`;
    const [label, to] = GROUP_ACTION[x.kind] || ["Open", null];
    const link = n === 1 ? href(firstRef(one)) || to : x.key === "service:critical" ? "#/service/complaints" : to || href(firstRef(one));
    return { ...x, title, sub: n === 1 ? one.detail : x.items.slice(0, 2).map((i) => i.title).join(" · "), label, link: link || "#/overview" };
  }).sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.items.length - a.items.length);
}
// A small area chart with a dot on the latest point: the 30-second read of a trend. values: numbers, oldest first.
function spark(values, color = "var(--accent-deep)") {
  const W = 600, H = 96, pad = 6, lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const X = (i) => pad + (i / (values.length - 1)) * (W - 2 * pad), Y = (v) => pad + (1 - (v - lo) / span) * (H - 2 * pad - 8);
  const d = values.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
  const last = values.length - 1;
  return html`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Cash at each month end"><path d="${raw(d)}L${X(last)} ${H}L${X(0)} ${H}Z" fill="${color}" opacity=".1"/><path d="${raw(d)}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><circle cx="${X(last)}" cy="${Y(values[last])}" r="6" fill="${color}" stroke="var(--panel)" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>`;
}

// ---------------------------------------------------------------- the calm overview: a greeting, four tiles, three things
export async function overview(main) {
  const { o, fin, one, needs, hide, hideIf } = await context();
  const m = o.month, ordersAll = access("orders") === "all", casesAll = access("cases") === "all";
  const groups = groupNeeds(needs), top = groups.slice(0, 3);
  const hour = +o.now.slice(11, 13), part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const cashSeries = o.months.filter((r) => r[4] != null).slice(-13);
  const mname = (k) => monthLabel(k, true);

  main.innerHTML = html`
    <header class="page-head-lite">
      <h1 class="greet">Good ${part}. ${top.length ? html`${top.length === 1 ? "1 thing needs" : `${top.length} things need`} you.` : "Nothing needs you."}</h1>
      <p class="greet-sub">${longNow(o.now)} in the simulation${one ? ". Only this customer's records are visible to this role" : ""}.</p>
    </header>

    <div class="ov-top">
      <a class="hero" href="#/finance/cash" aria-label="Cash in the bank">
        <span class="k">Cash in the bank</span>
        <span class="v">${hide(money(o.cash))}</span>
        <span class="d">${fin ? html`${delta(o.cash, o.prev_cash)} on ${money(o.prev_cash)} at the end of ${monthLabel(m.prev_month, true).split(" ")[0]}` : "Finance only"}</span>
        ${fin && cashSeries.length > 1 ? html`${spark(cashSeries.map((r) => r[4]))}<span class="spark-cap"><span>${mname(cashSeries[0][0])}</span><span>Cash at each month end</span><span>${mname(cashSeries.at(-1)[0])}</span></span>` : ""}
      </a>
      <a class="hero sales" href="#/finance" title="Items sold plus delivery charges, before refunds">
        <span class="k">Sales, ${monthLabel(m.month, true).split(" ")[0]} so far</span>
        <span class="v">${hide(money(m.revenue))}</span>
        <span class="d">${fin ? html`${delta(m.revenue, m.prev_same_point)} on ${money(m.prev_same_point)} by this day last month` : "Finance only"}</span>
        ${fin ? html`<span class="cmp"><div><span>This month</span><i style="width:${Math.max(2, (m.revenue / Math.max(m.revenue, m.prev_same_point, 1)) * 100)}%"></i></div><div><span>Last month</span><i style="width:${Math.max(2, (m.prev_same_point / Math.max(m.revenue, m.prev_same_point, 1)) * 100)}%"></i></div></span>` : ""}
      </a>
    </div>

    <div class="ov-small">
      ${stat("Paid today", hideIf(ordersAll, num(o.today.paid)), html`${o.today.placed - o.today.paid ? `${o.today.placed - o.today.paid} declined · ` : ""}since midnight`, { href: "#/orders" })}
      ${stat("Parcels out", hideIf(ordersAll, num(o.in_transit)), html`${plural(o.late.length, "late parcel")} · ${o.to_pack} to pack`, { href: "#/deliveries" })}
      ${stat("Open cases", hideIf(casesAll, num(o.open_cases)), html`${o.complaints_open} complaints`, { href: "#/service/cases" })}
    </div>

    <section class="need-card" aria-labelledby="needsH">
      <h2 id="needsH">Needs you${needs.length ? html`<a href="#/needs">See all ${needs.length}</a>` : ""}</h2>
      ${top.length ? html`<ul class="need3">${top.map((g) => html`<li><span class="dot ${g.tone}" title="${TONES[g.tone][0]}"></span><div><b>${g.title}</b><small>${g.sub}</small></div><a class="btn" href="${g.link}">${g.label}</a></li>`)}</ul>`
        : html`<div class="panel"><div class="empty"><b>Nothing needs anyone right now.</b></div></div>`}
    </section>

    ${fin ? html`<section class="ov-chart panel"><div class="panel-h"><h3>Revenue by month</h3><span class="muted">${new Date(o.now).getUTCFullYear()} against the year before</span></div><div class="panel-b"><div id="revChart"></div></div></section>` : ""}

    <nav class="ov-links" aria-label="More about the company">
      <a href="#/activity">Recent activity<small>Orders, parcels, cases and stock as they happen</small></a>
      <a href="#/about">Five years, best sellers<small>Year by year, profit, and what sells</small></a>
      <a href="#/about">The company<small>What it is, a normal day, the systems it uses</small></a>
    </nav>
    <div id="simTile"></div>`;
  latestRun(main.querySelector("#simTile"));
  if (fin) drawRevenue(main.querySelector("#revChart"), o);
}

// Revenue this year against last, month by month, with a headline worked out from the months that are complete.
function drawRevenue(el, o) {
  const thisY = String(new Date(o.now).getUTCFullYear()), prevY = String(+thisY - 1);
  const mon = (y) => Array.from({ length: 12 }, (_, i) => o.months.find((r) => r[0] === `${y}-${String(i + 1).padStart(2, "0")}`)?.[1] ?? null);
  const cur = mon(thisY), prv = mon(prevY), nowM = new Date(o.now).getUTCMonth(); // months before this one are complete
  const sum = (a) => a.slice(0, nowM).reduce((n, v) => n + (v || 0), 0), c = sum(cur), p = sum(prv);
  const headline = nowM > 0 && p ? `Sales ${c >= p ? "up" : "down"} ${Math.round(Math.abs(c / p - 1) * 100)}% on ${prevY}, January to ${MONTH_LONG[nowM - 1]}` : null;
  const MON = MONTH_LONG.map((x) => x.slice(0, 3));
  lineChart(el, { labels: MON, headline, series: [{ name: thisY, values: cur, color: "var(--s1)", area: true }, { name: prevY, values: prv, color: "var(--s-prev)" }], fmt: compact, height: 240, title: `Revenue by month, ${thisY} and ${prevY}`, xFmt: (l, i, long) => (long ? MONTH_LONG[i] : l) });
}

// ---------------------------------------------------------------- every finding, as before
export async function needs(main) {
  const { needs, nameOf } = await context();
  const byTone = ["critical", "serious", "warning", "info"].map((t) => [t, needs.filter((n) => n.tone === t)]).filter(([, l]) => l.length);
  main.innerHTML = html`${pageHead("Everything that needs you", html`${needs.length} things, most urgent first. Each one is found by a rule over the records.`, html`<a class="btn" href="#/overview">Back to the overview</a>`)}
    <section class="panel"><div class="panel-b flush">${needs.length ? html`<ul class="needs">${byTone.map(([t, list]) => list.map((n) => html`<li class="need ${t}">
      <span class="ic" title="${TONES[t][0]}">${icon(TONES[t][1])}</span>
      <div><b><a href="${href(firstRef(n)) || "#/overview"}">${n.title}</a></b><p>${n.detail}</p></div>
      <span class="who-tag" title="The role that would normally act">${roleName(n.who)}</span>
      <div class="refs">${n.refs.slice(0, 8).map((r) => (/^C-/.test(r) ? (nameOf(r) ? chip(r, nameOf(r)) : "") : chip(r)))}${n.refs.length > 8 ? html`<span class="muted small">+${n.refs.length - 8} more</span>` : ""}</div></li>`))}</ul>` : html`<div class="empty"><b>Nothing needs anyone right now.</b></div>`}</div></section>`;
}

// ---------------------------------------------------------------- recent activity (it used to sit on the overview)
export async function activity(main) {
  const { o, fin, one, nameOf } = await context();
  main.innerHTML = html`${pageHead("Recent activity", "Everything that happened in the last three weeks, newest first.", html`<select class="input" id="actKind" aria-label="Show activity of one kind">${Object.entries(KIND_GROUPS).map(([k, [l]]) => html`<option value="${k}">${l}</option>`)}</select>`)}
    <section class="panel"><div class="panel-b flush"><ul class="feed" id="feed"></ul></div></section>`;
  const feed = main.querySelector("#feed");
  const drawFeed = (k) => {
    const kinds = KIND_GROUPS[k][1];
    let list = o.activity.filter((a) => !kinds || kinds.includes(a.kind));
    if (one) list = list.filter((a) => a.c === one);
    list = list.slice(0, 120);
    let day = null;
    feed.innerHTML = list.length ? html`${list.map((a) => {
      const d = a.t.slice(0, 10), head = d !== day ? ((day = d), html`<li class="day">${d === o.now.slice(0, 10) ? "Today" : dateShort(d) + " · " + new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}</li>`) : "";
      const who = a.c && nameOf(a.c);
      return html`${head}<li><time datetime="${a.t}">${time(a.t)}</time><span class="k ${a.kind}" title="${words(a.kind)}">${icon(KIND_ICON[a.kind] || "box")}</span><span class="txt"><a href="#/r/${a.id}" data-rec="${a.id}">${a.text[0].toUpperCase() + a.text.slice(1)}</a>${who ? html` · ${who}` : ""}</span><span class="m">${a.money != null && fin ? money2(a.money) : ""}</span></li>`;
    })}` : html`<li class="empty"><b>Nothing of this kind in the last three weeks.</b></li>`;
  };
  main.querySelector("#actKind").onchange = (e) => drawFeed(e.target.value);
  drawFeed("all");
}

// ---------------------------------------------------------------- five years, best sellers, and what the company is
export async function about(main) {
  const { o, fin, hide } = await context();
  main.innerHTML = html`${pageHead("The company and five years", "From the monthly summary, which is the ledger added up. The same figures as node business/builder/validate.mjs.", html`<a class="btn" href="#/systems/data">${icon("code")} Inspect the data</a>`)}
    <section aria-labelledby="perfH">
      <h2 class="sec-h" id="perfH">Five years of performance</h2>
      ${fin ? html`<div class="cols c21">
        <div class="panel"><div class="panel-h"><h3>Revenue by month</h3><span class="muted">${new Date(o.now).getUTCFullYear()} against the year before</span></div><div class="panel-b"><div id="revChart"></div></div></div>
        <div class="panel"><div class="panel-h"><h3>Year by year</h3></div><div class="panel-b flush"><div class="tbl-wrap"><table><thead><tr><th scope="col">Year</th><th class="num" scope="col" title="Orders whose payment went through">Paid orders</th><th class="num" scope="col" title="Items sold plus delivery charges">Revenue</th><th class="num" scope="col" title="Gross margin minus operating costs">Profit</th></tr></thead><tbody>${[...o.years].reverse().map((y) => html`<tr><td>${y.year}${y.year === String(new Date(o.now).getUTCFullYear()) ? html` <span class="muted small">to date</span>` : ""}</td><td class="num">${num(y.orders)}</td><td class="num">${money(y.revenue)}</td><td class="num ${y.profit < 0 ? "down" : ""}">${money(y.profit)}</td></tr>`)}</tbody></table></div></div></div>
      </div>
      <div class="cols c2" style="margin-top:20px">
        <div class="panel"><div class="panel-h"><h3>Profit by month</h3><span class="muted">Last 24 months</span></div><div class="panel-b"><div id="profitChart"></div></div></div>
        <div class="panel"><div class="panel-h"><h3>Best sellers, all time</h3><span class="muted">Money taken for items, paid orders</span></div><div class="panel-b"><div id="topList"></div></div></div>
      </div>` : html`<div class="panel"><div class="panel-b">${redactNote()}</div></div>`}
    </section>

    <section class="section" aria-labelledby="aboutH">
      <h2 class="sec-h" id="aboutH">What the company is and how it runs</h2>
      <div class="cols c3">
        <div class="panel"><div class="panel-b"><p class="lede">${o.company.what_we_do}</p><dl class="kv" style="margin-top:14px">
          <dt>Founded</dt><dd>${date(o.company.founded)}</dd>
          <dt>Open</dt><dd>${Object.entries(o.company.working_hours || {}).map(([k, v]) => html`${words(k).replace("mon sat", "Monday to Saturday").replace("sun", "Sunday").replace("bank holidays", "Bank holidays")}: ${v}<br>`)}</dd>
          <dt>Founder's cash</dt><dd>${hide(money(o.company.opening_cash))}</dd>
          <dt>Records</dt><dd>${num(o.totals.customers)} customers, ${num(o.totals.orders)} orders, ${num(o.totals.ledger)} ledger entries</dd>
          <dt>No named staff</dt><dd>Only <a href="#/systems/roles">roles</a>. ${o.company.size_note || ""}</dd></dl></div></div>
        <div class="panel"><div class="panel-h"><h3>A normal day</h3></div><div class="panel-b"><ol class="tl">${(o.company.normal_day || []).map((s) => html`<li><span class="node">${icon("clock")}</span><span class="what">${s}</span></li>`)}</ol></div></div>
        <div class="panel"><div class="panel-h"><h3>The systems it uses</h3></div><div class="panel-b"><ul class="list" style="margin:-9px -22px -16px">${(o.company.tools_used || []).map((t) => html`<li>${icon("bolt")}<span class="t" style="white-space:normal">${t}</span></li>`)}</ul></div></div>
      </div>
    </section>`;
  if (!fin) return;
  drawRevenue(main.querySelector("#revChart"), o);
  const last24 = o.months.slice(-24);
  barChart(main.querySelector("#profitChart"), { labels: last24.map((r) => r[0]), values: last24.map((r) => r[2]), fmt: money, tickFmt: compact, color: (v) => (v < 0 ? "var(--s2)" : "var(--s1)"), xFmt: (l, i, long) => (long ? monthLabel(l, true) : i % 3 === 0 ? monShort(l) : ""), xTicks: 24, name: "Profit", height: 220, title: "Profit by month, last 24 months", headline: profitHeadline(o) });
  main.querySelector("#topList").innerHTML = hbars(o.top.slice(0, 8).map((t) => ({ name: productById(t.id)?.name || t.id, value: t.money, href: `#/products/${t.id}`, title: `${productById(t.id)?.name}: ${money(t.money)} from ${num(t.units)} sold` })), { fmt: money });
}
// "Profit up on last year": the last 12 complete months against the 12 before them.
function profitHeadline(o) {
  const done = o.months.slice(0, -1), a = done.slice(-12).reduce((n, r) => n + r[2], 0), b = done.slice(-24, -12).reduce((n, r) => n + r[2], 0);
  return done.length >= 24 && b > 0 ? `Profit ${a >= b ? "up" : "down"} ${Math.round(Math.abs(a / b - 1) * 100)}% on the year before` : null;
}
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const redactNote = () => html`<div class="note ai">${icon("lock")}<span>${roleName(S.role)} can't see the company's money. Only Finance and the Manager can read the monthly figures (<code>get_monthly_summary</code>).</span></div>`;

// One small tile linking to the newest saved simulation run (nothing if there are none).
async function latestRun(el) {
  try {
    const { runs } = await load("sim/index.json"); const r = runs[0]; if (!r) return;
    const { toolName } = await import("./v-sim.js");
    el.innerHTML = String(html`<nav class="ov-links one" aria-label="Latest simulation"><a class="sim-tile" href="#/simulation/${r.id}"><span>Latest simulation: ${toolName(r)}<small>${plural(r.days, "day")}, ${plural(r.seeds, "repeat")}. ${r.payback?.text || "Open the report"}</small></span></a></nav>`);
  } catch { /* no runs: no tile */ }
}
