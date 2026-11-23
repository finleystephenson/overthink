// Simulation: saved runs, one run's report (headline, with-versus-without, value over time, moments, replay) and the report card.
// Every number comes from simulation/simulator/results/<run>/report.json and timeline/*.jsonl, copied by the build. Nothing is typed in here.
import { html, raw, esc, icon, load, money, num, pct, date, dateShort, plural, pageHead, panel, strip, stat, table, tonePill, codeBlock, emptyState } from "./core.js";
import { lineChart } from "./charts.js";

const MARK = "M12.00 2.00C12.49 2.11 14.02 2.30 14.93 2.65C15.84 3.01 16.73 3.52 17.47 4.12C18.22 4.72 18.90 5.47 19.42 6.25C19.940 7.03 20.35 7.92 20.61 8.80C20.87 9.68 20.98 10.63 20.97 11.53C20.95 12.43 20.78 13.35 20.50 14.18C20.22 15.01 19.79 15.82 19.28 16.52C18.78 17.21 18.14 17.84 17.47 18.33C16.79 18.83 16.01 19.23 15.24 19.49C14.47 19.75 13.63 19.90 12.83 19.91C12.04 19.93 11.21 19.82 10.47 19.60C9.72 19.38 8.99 19.04 8.36 18.62C7.73 18.20 7.16 17.66 6.70 17.08C6.24 16.51 5.86 15.84 5.60 15.18C5.34 14.51 5.19 13.78 5.15 13.09C5.10 12.39 5.18 11.67 5.34 11.02C5.50 10.36 5.78 9.72 6.12 9.16C6.46 8.60 6.91 8.09 7.39 7.67C7.87 7.26 8.43 6.91 9.00 6.67C9.56 6.42 10.18 6.27 10.77 6.21C11.36 6.15 11.98 6.19 12.54 6.31C13.10 6.43 13.65 6.65 14.13 6.92C14.62 7.19 15.06 7.56 15.42 7.95C15.79 8.34 16.16 9.05 16.31 9.27"; // the spiral from business/brand/mark.svg
const RUN_CMD = 'pnpm sim -- --days 30 --seeds 30 --tool-cmd "node simulation/simulator/examples/simple-responder.mjs" --tool-cost 150 --out simulation/simulator/results/my-run';

// ---------------------------------------------------------------- small helpers
const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "");
const signed = (v, f) => sign(v) + f(Math.abs(v));
const hrs = (v) => `${(Math.round(v * 10) / 10).toLocaleString("en-GB")} h`;
const mins = (v) => (v < 60 ? `${Math.round(v)} min` : `${(v / 60).toFixed(1)} h`);
const dec = (v, dp = 1) => (Math.round(v * 10 ** dp) / 10 ** dp).toLocaleString("en-GB");
const range = (s, f) => (s && s.mean === 0 && s.p10 === 0 && s.p90 === 0 ? "" : s && s.ci95 && !(s.ci95[0] === 0 && s.ci95[1] === 0) ? `${signed(s.ci95[0], f)} to ${signed(s.ci95[1], f)}` : s && s.p10 != null ? `${signed(s.p10, f)} to ${signed(s.p90, f)} (middle 80%)` : "");
const unclear = (s) => !s || !s.ci95 || (s.ci95[0] <= 0 && s.ci95[1] >= 0);

// The tool's name: the report's own name if it has one, else the script or host it ran, else the run's name.
export function toolName(meta) {
  const t = meta.tool || {};
  if (t.name) return t.name;
  const word = ((t.cmd || "").match(/([\w-]+)\.(?:mjs|js|py|ts)\b/) || [])[1] || (t.http ? t.http.replace(/^https?:\/\//, "").split(/[/:]/)[0] : "");
  const s = word.replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : meta.name;
}

// The two lenses, as the report gives them. Cash: the change in net profit (and after the tool's price). Time freed: staff hours, not cash.
function lenses(r) {
  const c = r.cash || {}, t = r.time_freed || {}, days = r.meta?.days_compared || 1;
  const hours = t.hours_saved || null;
  return { cash: c.net_profit_change || null, after: c.net_profit_change_after_tool_cost || null, toolCost: c.tool_cost ?? 0, hours, value: t.value_at_pay || null, days, perWeek: hours ? (hours.mean / days) * 7 : null };
}

// The report writes its own plain sentence; this is only the fallback.
const cashWords = (r, L) => {
  if (r.headline) return r.headline;
  const c = L.cash; if (!c) return "No cash figure in this report.";
  return unclear(c) ? "No clear cash change: the range includes zero, so the tool may have earned or lost money." : c.mean > 0 ? "The tool made money, and the whole range is above zero." : "The tool lost money, and the whole range is below zero.";
};

// ---------------------------------------------------------------- the list of saved runs
export async function list(main) {
  const { runs } = await load("sim/index.json");
  main.innerHTML = html`${pageHead("Simulation", "Saved runs. Each one ran this shop forward twice from the same start, without the AI tool and with it.")}
    ${runs.length ? html`<div id="runs"></div>` : html`<div class="panel">${emptyState("No saved runs yet.", "Runs saved under simulation/simulator/results appear here after the next build.")}</div>`}
    <div class="section">${devPanel()}</div>`;
  if (!runs.length) return;
  table(main.querySelector("#runs"), {
    caption: "Saved simulation runs", rows: runs, rowId: (r) => r.id, onOpen: (id) => { location.hash = `#/simulation/${id}`; }, pageSize: 25, sortCol: 4, sortDir: -1,
    cols: [
      { label: "Tool", sort: (r) => toolName(r), cell: (r) => html`<b>${toolName(r)}</b><span class="sub">${r.name}${r.role ? " · acts as " + r.role.replace(/_/g, " ") : ""}</span>` },
      { label: "Length", num: true, sort: (r) => r.days, cell: (r) => html`${plural(r.days, "day")}<span class="sub">${plural(r.seeds, "repeat")}</span>`, cls: "hide-m" },
      { label: "Cash result", num: true, sort: (r) => lenses({ ...r, meta: { days_compared: r.days } }).cash?.mean ?? 0, cell: (r) => { const c = lenses({ ...r, meta: { days_compared: r.days } }).cash; return c ? html`${signed(c.mean, money)}<span class="sub">${unclear(c) ? "range includes zero" : "clear"}</span>` : "–"; } },
      { label: "Time freed", num: true, sort: (r) => r.time_freed?.hours_saved?.mean ?? 0, cell: (r) => { const h = lenses({ ...r, meta: { days_compared: r.days } }).hours; return h ? hrs(h.mean) : "–"; } },
      { label: "Paid back", sort: (r) => r.payback?.days ?? 1e9, cell: (r) => (r.payback?.days != null ? html`${plural(r.payback.days, "day")}<span class="sub">${r.payback.seeds_that_paid_back} of ${r.payback.seeds} repeats</span>` : html`Not yet<span class="sub">in ${r.payback?.basis || "cash"}</span>`), cls: "hide-m" },
      { label: "Run on", sort: (r) => r.saved, cell: (r) => date(r.saved), cls: "hide-m" },
    ],
  });
}

// The only place that tells a developer how to start a run. Shown on the Simulation pages only.
function devPanel() {
  return panel("How to run a simulation", html`<div class="stack"><p class="small muted">For developers. Needs Node 24 and <code>pnpm install</code>. The tool is any command or URL that answers the shop's protocol.</p>${codeBlock(RUN_CMD)}<p class="small muted">Then <code>node business/backoffice/build.mjs --size standard</code> adds the run to this list.</p></div>`, { sub: "Developers" });
}

// ---------------------------------------------------------------- one run
const GROUPS = [
  ["Money", [["revenue", "Sales", money, 1], ["gross_profit", "Gross profit", money, 1], ["net_profit", "Net profit", money, 1, "Before the tool's own price"], ["refunds", "Refunds paid", money, -1], ["lost_sales", "Sales lost to empty shelves, number", (v) => dec(v, 1), -1], ["lost_sales_value", "Sales lost to empty shelves, value", money, -1], ["new_business_revenue", "New business from prospects", money, 1]]],
  ["Customers", [["customer_satisfaction", "Customer satisfaction, 1 to 5", (v) => dec(v, 2), 1], ["share_satisfied", "Customers satisfied", (v) => pct(v), 1], ["resolution_rate", "Questions resolved", (v) => pct(v), 1], ["first_response_median_minutes", "First reply, typical wait", mins, -1], ["average_review", "Average review, 1 to 5", (v) => dec(v, 2), 1], ["bad_reviews", "Bad reviews", (v) => dec(v, 1), -1], ["complaints", "Complaints", (v) => dec(v, 1), -1], ["abandoned_contacts", "Customers given up waiting", (v) => dec(v, 1), -1]]],
  ["Staff time", [["staff_task_hours", "Staff hours on tasks", hrs, -1], ["staff_overtime_hours", "Overtime hours", hrs, -1]]],
  ["Orders and rules", [["orders", "Orders", (v) => dec(v, 1), 1], ["prospects_won", "Prospects won", (v) => dec(v, 1), 1], ["rule_breaks", "Rule breaks by the tool", (v) => dec(v, 1), -1], ["wrong_actions", "Wrong actions by the tool", (v) => dec(v, 1), -1]]],
];

function compare(r) {
  const A = { ...r.baseline_mean, ...r.baseline_all }, B = { ...r.with_tool_mean, ...r.with_tool_all }, D = r.paired_differences || {};
  const quiet = [];
  const groups = GROUPS.map(([g, ms]) => html`<div class="sm-group"><h3>${g}</h3>${ms.map(([k, label, f, better, hint]) => {
    const a = A[k], b = B[k], d = D[k];
    if (a == null || b == null) return "";
    if (!a && !b && !(d && d.mean)) { quiet.push(label.toLowerCase()); return ""; }
    const diff = d ? d.mean : b - a, mx = Math.max(Math.abs(a), Math.abs(b), 1e-9);
    const tone = unclear(d) ? "flat" : better * diff > 0 ? "good" : better * diff < 0 ? "bad" : "flat";
    const verdict = unclear(d) ? "unclear" : tone === "good" ? "better" : tone === "bad" ? "worse" : "";
    return html`<div class="sm-row"><div class="sm-l"><b>${label}</b>${hint ? html`<small>${hint}</small>` : ""}</div>
      <div class="sm-bars"><div class="sm-b"><span class="who">Without</span><span class="trk"><i class="off" style="width:${Math.max(1, (Math.abs(a) / mx) * 100)}%"></i></span><span class="mv">${f(a)}</span></div>
      <div class="sm-b"><span class="who">With</span><span class="trk"><i class="on" style="width:${Math.max(1, (Math.abs(b) / mx) * 100)}%"></i></span><span class="mv">${f(b)}</span></div></div>
      <div class="sm-d ${tone}"><b>${signed(diff, f)}</b><span>${verdict}${d && range(d, f) ? html`<small>range ${range(d, f)}</small>` : ""}</span></div></div>`;
  })}</div>`);
  return html`${groups}${quiet.length ? html`<p class="small muted" style="margin-top:14px">Nothing happened in either run for: ${quiet.join(", ")}.</p>` : ""}`;
}

export async function run(main, [id]) {
  let r, tl = null;
  try { r = await load(`sim/${id}.json`); } catch { main.innerHTML = String(html`<div class="empty"><b>There is no saved run called “${id}”.</b><a href="#/simulation">Back to the saved runs</a></div>`); return; }
  const L = lenses(r), name = toolName(r.meta), m = r.meta;
  window.__setCrumbs([["#/simulation", "Simulation"], ["#/simulation", "Saved runs"], name]);
  const p = r.payback || {};
  const ow = r.paired_differences?.rule_breaks;
  main.innerHTML = html`${pageHead(name, `${plural(m.days_compared, "day")} from ${dateShort(m.start_date)}, ${plural(m.seeds, "repeat")}, acting as ${String(m.role || "").replace(/_/g, " ")}. The same shop and the same customers, once without the tool and once with it.`, html`<a class="btn" href="#/simulation/${id}/card">${icon("star")} Report card</a>`)}
    <div class="ov-top">
      <div class="hero" aria-label="Cash result">
        <span class="k">Cash result: the change in net profit, with the tool against without</span>
        <span class="v sm-big">${L.cash ? signed(L.cash.mean, money) : "–"}</span>
        <span class="d">${L.cash ? html`Range ${range(L.cash, money)}.${L.after ? html` After the tool's ${money(L.toolCost)} price: ${signed(L.after.mean, money)}.` : ""}` : ""}</span>
        <p class="sm-plain">${cashWords(r, L)}</p>
      </div>
      <div class="hero sales" aria-label="Time freed">
        <span class="k">Time freed, counted separately</span>
        <span class="v">${L.hours ? hrs(L.hours.mean) : "–"}</span>
        <span class="d">${L.hours ? html`${hrs(L.hours.ci95?.[0] ?? L.hours.p10)} to ${hrs(L.hours.ci95?.[1] ?? L.hours.p90)} of staff task time, about ${hrs(L.perWeek)} a week.` : ""}</span>
        <p class="sm-plain">Capacity, not cash: staff are paid for their contracted hours either way.${L.value ? html` At staff pay these hours are worth about ${money(L.value.mean)}.` : ""}</p>
      </div>
    </div>
    <div class="ov-small" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      ${stat("Payback", p.days != null ? plural(p.days, "day") : "Not yet", p.days != null ? `counted in ${p.basis || "cash"}` : `not in ${p.basis || "cash"}, ${plural(m.days_compared, "day")}`, { title: p.text })}
      ${stat("Paid back in", p.seeds ? `${p.seeds_that_paid_back} of ${p.seeds}` : "–", "repeats paid it back")}
      ${stat("Rule breaks", ow ? dec(ow.mean, 1) : "–", ow && ow.ci95 ? `range ${dec(ow.ci95[0], 1)} to ${dec(ow.ci95[1], 1)}` : "refused calls, per run")}
      ${stat("Tool price", m.tool_cost_per_month ? money(m.tool_cost_per_month) : "Not set", m.tool_cost_per_month ? "a month, used for payback" : "no payback without a price")}
    </div>
    ${m.interval_note ? html`<p class="small muted" style="margin-top:14px">${icon("alert")} ${m.interval_note}</p>` : ""}
    <section class="section"><h2 class="sec-h">With the tool, against without</h2>${panel("Every measure, averaged over the repeats", compare(r), { sub: "Bars start at zero. The range is the 95% interval of the difference." })}</section>
    <section class="section"><h2 class="sec-h">Value over time, against the tool's price</h2><div class="panel"><div class="panel-b"><div id="curve"></div></div></div></section>
    <section class="section"><h2 class="sec-h">The moments that mattered</h2><div id="moments"></div></section>
    ${r.has_timeline ? html`<section class="section"><h2 class="sec-h">Replay</h2><div id="replay"></div></section>` : ""}
    <section class="section">${devPanel()}</section>`;
  drawCurve(main.querySelector("#curve"), r);
  drawMoments(main.querySelector("#moments"), r);
  if (r.has_timeline) { tl = await load(`sim/${id}-timeline.json`); replay(main.querySelector("#replay"), tl, r); }
}

function drawCurve(el, r) {
  const c = r.curve;
  if (!c || !c.day?.length) { el.innerHTML = String(emptyState("No curve in this report.")); return; }
  const last = c.day.length - 1, net = c.value_created[last] - c.tool_cost[last];
  lineChart(el, {
    labels: c.day, height: 260, fmt: money, xTicks: 8, xFmt: (d) => `Day ${d}`, title: "Cumulative value created and cumulative tool cost, by day",
    headline: `After ${plural(c.day[last], "day")}: ${money(c.value_created[last])} of value against ${money(c.tool_cost[last])} of tool price, ${signed(net, money)} on balance`,
    series: [{ name: `Value created so far (${c.basis || "cash"})`, values: c.value_created, color: "var(--accent-deep)", area: true }, { name: "Tool price so far", values: c.tool_cost, color: "var(--s2)" }],
  });
}

function drawMoments(el, r) {
  const mm = r.moments_that_mattered || {}, item = (x) => html`<li><span class="sm-day">Day ${x.day}</span><span>${x.text}</span><b class="${x.value < 0 ? "bad" : "good"}">${x.value ? "about " + signed(x.value, money) : ""}</b></li>`;
  const card = (title, arr, none) => html`<div class="panel"><div class="panel-h"><h3>${title}</h3></div><div class="panel-b">${arr?.length ? html`<ul class="sm-moments">${arr.slice(0, 8).map(item)}</ul>` : html`<p class="muted">${none}</p>`}</div></div>`;
  const big = (mm.biggest_effects || []).slice(0, 6);
  const effects = big.length ? html`<div class="panel" style="margin-bottom:20px"><div class="panel-h"><h3>What moved the result</h3><span class="muted">Worked out from the records, biggest money first</span></div><div class="panel-b"><ul class="sm-moments sm-fx">${big.map((x) => html`<li><b class="${x.impact_gbp == null ? "" : x.impact_gbp < 0 ? "bad" : "good"}">${x.impact_gbp == null ? "–" : signed(x.impact_gbp, money)}<small>${x.impact_gbp == null ? "not in £" : x.estimated ? "estimate" : "from the records"}</small></b><span>${x.text}</span></li>`)}</ul></div></div>` : "";
  el.innerHTML = html`${effects}<div class="cols c2">${card("Wins, single moments", mm.wins, "No single standout wins were recorded in this run.")}${card("Mistakes, single moments", mm.mistakes, "No single mistakes were recorded in this run.")}</div>`;
}

// ---------------------------------------------------------------- the replay: day by day, side by side
function replay(el, tl, r) {
  const seeds = Object.keys(tl).filter((s) => tl[s].baseline && tl[s].with_tool);
  if (!seeds.length) return;
  let seed = seeds[0], day = 0, timer = null;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const data = () => { const t = tl[seed], n = Math.min(t.baseline.length, t.with_tool.length); return { b: t.baseline.slice(0, n), w: t.with_tool.slice(0, n), n }; };
  el.innerHTML = html`<div class="panel sm-replay"><div class="sm-ctl">
      <button class="btn" id="rpPlay" aria-label="Play or pause the replay"></button>
      <input type="range" id="rpDay" min="1" value="1" aria-label="Day of the replay">
      <span class="sm-daylab" id="rpLab" aria-live="off"></span>
      ${seeds.length > 1 ? html`<label class="small muted">Repeat <select id="rpSeed" class="input" style="height:30px">${seeds.map((s) => html`<option value="${s}">${s}</option>`)}</select></label>` : ""}</div>
    <div class="sm-arms" id="rpArms"></div><div id="rpChart" class="sm-rchart"></div></div>`;
  const $ = (s) => el.querySelector(s), rng = $("#rpDay"), play = $("#rpPlay");
  const arm = (d, tool, title) => {
    const by = d.by_tool || 0, ho = d.handed_over || 0, ct = d.contacts || 0;
    return html`<div class="sm-arm ${tool ? "with" : "without"}"><h3>${title}</h3>
      <dl><div><dt>Orders</dt><dd>${num(d.orders)}</dd></div><div><dt>Sales</dt><dd>${money(d.revenue)}</dd></div><div><dt>Gross profit</dt><dd>${money(d.gross_profit)}</dd></div><div><dt>Customer messages</dt><dd>${num(ct)}</dd></div><div><dt>Satisfaction</dt><dd>${d.csat ? dec(d.csat, 2) : "–"}</dd></div><div><dt>Staff task hours</dt><dd>${dec(d.task_hours, 1)}</dd></div></dl>
      <p class="sm-says">${tool ? `The tool answered ${by} of ${ct} messages and handed ${ho} to staff.` : `Staff answered all ${ct} messages.`}${d.abandoned ? ` ${plural(d.abandoned, "customer")} gave up waiting.` : ""}</p>
      ${d.notes?.length ? html`<ul class="sm-notes">${d.notes.slice(0, 4).map((n) => html`<li>${n}</li>`)}</ul>` : ""}</div>`;
  };
  const chart = (b, w, upto) => {
    const cum = (a) => { let s = 0; return a.map((x) => (s += x.gross_profit)); };
    const cb = cum(b), cw = cum(w), all = [...cb, ...cw], lo = Math.min(0, ...all), hi = Math.max(...all, 1), W = 1000, H = 150, P = 8;
    const X = (i) => P + (i / Math.max(1, b.length - 1)) * (W - 2 * P - 90), Y = (v) => H - 18 - ((v - lo) / (hi - lo || 1)) * (H - 34);
    const path = (c) => c.slice(0, upto + 1).map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
    const end = (c, col, lab) => `<circle cx="${X(upto)}" cy="${Y(c[upto])}" r="4.5" fill="${col}" stroke="var(--panel)" stroke-width="2"/><text x="${X(upto) + 10}" y="${Y(c[upto]) + 4}" class="lbl" fill="${col}">${esc(lab)}</text>`;
    return `<p class="small muted">Gross profit added up so far</p><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gross profit added up day by day, without and with the tool"><line class="base" x1="${P}" x2="${W - 90}" y1="${Y(Math.max(0, lo))}" y2="${Y(Math.max(0, lo))}"/><path d="${path(cb)}" fill="none" stroke="var(--s-prev)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="${path(cw)}" fill="none" stroke="var(--accent-deep)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>${end(cb, "var(--ink-3)", "Without " + money(cb[upto]))}${end(cw, "var(--accent-deep)", "With " + money(cw[upto]))}</svg>`;
  };
  function draw() {
    const { b, w, n } = data(); day = Math.max(0, Math.min(n - 1, day));
    rng.max = n; rng.value = day + 1;
    $("#rpLab").textContent = `Day ${b[day].day} of ${n} · ${date(b[day].date)}`;
    $("#rpArms").innerHTML = String(html`${arm(b[day], false, "Without the tool")}${arm(w[day], true, "With the tool")}`);
    $("#rpChart").innerHTML = chart(b, w, day);
    const atEnd = day >= n - 1;
    play.innerHTML = String(timer ? html`${icon("minus")} Pause` : html`${icon("play")} ${atEnd ? "Replay" : "Play"}`);
  }
  const stop = () => { clearInterval(timer); timer = null; draw(); };
  const start = () => {
    if (day >= data().n - 1) day = 0;
    timer = setInterval(() => { if (!el.isConnected) { clearInterval(timer); return; } if (day >= data().n - 1) { stop(); return; } day++; draw(); }, 900);
    draw();
  };
  play.onclick = () => (timer ? stop() : start());
  rng.oninput = () => { clearInterval(timer); timer = null; day = +rng.value - 1; draw(); };
  $("#rpSeed")?.addEventListener("change", (e) => { seed = e.target.value; day = 0; clearInterval(timer); timer = null; draw(); });
  if (reduce) { day = data().n - 1; draw(); } else { draw(); start(); }
}

// ---------------------------------------------------------------- the report card: one panel to screenshot and share
export async function card(main, [id]) {
  let r; try { r = await load(`sim/${id}.json`); } catch { main.innerHTML = String(html`<div class="empty"><b>There is no saved run called “${id}”.</b><a href="#/simulation">Back to the saved runs</a></div>`); return; }
  const L = lenses(r), name = toolName(r.meta), m = r.meta, p = r.payback || {}, rb = r.paired_differences?.rule_breaks;
  window.__setCrumbs([["#/simulation", "Simulation"], ["#/simulation", "Saved runs"], [`#/simulation/${id}`, name], "Report card"]);
  const tile = (cls, k, v, d) => html`<div class="rc-n ${cls}"><span class="rc-k">${k}</span><span class="rc-v">${v}</span><span class="rc-d">${d}</span></div>`;
  main.innerHTML = html`<div class="rc-wrap"><article class="rc" aria-label="Report card for ${name}">
    <header class="rc-top"><svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="${raw(MARK)}" fill="none" stroke="#5fc3ec" stroke-width="3.3" stroke-linecap="round"/></svg><span>Overthought &amp; Co. · business simulator</span></header>
    <p class="rc-lead">We gave a whole business to</p>
    <h1 class="rc-name">${name}</h1>
    <p class="rc-len">for ${plural(m.days_compared, "day")}, ${plural(m.seeds, "time")} over, with and without it</p>
    <div class="rc-nums">
      ${tile("sun", "Cash result", L.cash ? signed(L.cash.mean, money) : "–", L.cash ? `${unclear(L.cash) ? "range includes zero" : "clear of zero"}` : "")}
      ${tile("sky", "Staff time freed", L.perWeek != null ? `${dec(L.perWeek, 0)} h` : "–", "a week")}
      ${tile("lime", "Paid for itself", p.days != null ? plural(p.days, "day") : "Not yet", p.days != null ? `in ${p.basis || "cash"}` : `in cash, ${plural(m.days_compared, "day")}`)}
      ${tile("pink", "Rule breaks", rb ? dec(rb.mean, 0) : "–", "refused by the shop's rules")}
    </div>
  </article><p class="rc-foot"><a href="#/simulation/${id}">Open the full run</a></p></div>`;
}
