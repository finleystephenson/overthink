// The Control Room: the sandbox's full bench, behind the guided first screen. It is Expanza's layer, not one of the
// business's tools. One calm page, in the order a tester needs it:
//   the result against the same business left alone (headline, chart, every measure), time,
//   the jobs an AI has taken and what each did (GET /sandboxes/:id/jobs and each job's result),
//   the levers (prices, marketing, hours, a campaign, an event), the business now, everything that was done,
//   connecting an AI, and starting again.
// Reads are made as the manager and marked as screen reads, so they never fill the record of what was done.
import { startApp, esc, money, num, plural, shortDate, timeParts, daysBetween, avatar, copyText, emptyState, skeleton, slideOver, toast, words, node } from "../lib/ui.js";
import { personFor } from "../lib/people.js";
import { isScreenRead } from "../lib/client.js";
import { summariseDays } from "../lib/days.js";
import { MEASURES, GROUPS, formatMeasure, toneOf, headline } from "../lib/impact.js";
import { didWords } from "../home-a/business.js";
import { drawChart, profitPoints } from "../home-b/run.js";
import { mountTry } from "./try.js";

// Every sandbox starts at the same simulated moment (infrastructure/server/README.md: "Monday 23 Nov 2026, 10:00").
const RUN_START = "2026-11-23T10:00:00Z";
const AS = { role: "manager", screen: true };
const RECORD_MAX = 80;

const { world, bar } = await startApp({ id: "control-room" });
const info = await world.connectInfo();
const $ = (id) => document.getElementById(id);
const page = { now: null, lastSeq: 0, figures: null, jobs: [] };

// ------------------------------------------------------------------ the result, against the same business left alone

/** The headline sentence, the chart and the full table of measures, from the simulator's impact. */
async function paintResult() {
  const imp = await world.impact().catch(() => ({ available: false }));
  const days = imp?.days_compared || 0;
  const h = imp?.available ? headline(imp) : { text: "Move time on and this will compare the two businesses.", tone: "neutral" };
  $("verdict").textContent = h.text;
  $("verdict").dataset.tone = h.tone;
  const profit = imp?.measures?.net_profit;
  $("verdictSub").textContent = !days ? "A copy of this business runs beside it with nothing done. Every difference between them is down to what was done here."
    : profit && profit.difference != null ? `Over ${plural(days, "day")}: ${money(profit.live)} profit here, ${money(profit.shadow)} in the same business left alone.`
      : `Over ${plural(days, "day")}.`;
  const chart = $("chart");
  if (days) drawChart(chart, { pts: profitPoints(imp), total: Math.max(7, days), you: "This business" });
  else chart.innerHTML = "";
  const box = $("measures");
  if (!imp?.available || !days) { box.innerHTML = ""; return; }
  // Every measure the simulator compares, grouped as a person would expect; the difference is the column that matters.
  box.innerHTML = GROUPS.map((g) => {
    const rows = g.keys.map((k) => [k, imp.measures?.[k]]).filter(([, m]) => m && m.live != null);
    if (!rows.length) return "";
    return `<tbody><tr class="grp"><th colspan="4" scope="colgroup">${esc(g.title)}</th></tr>${rows.map(([k, m]) => {
      const d = m.difference;
      const same = d == null || Math.abs(d) < 0.005;
      return `<tr class="${toneOf(k, d || 0)}"><th scope="row">${esc(MEASURES[k].label)}</th><td>${esc(formatMeasure(k, m.live))}</td><td>${esc(formatMeasure(k, m.shadow))}</td>
        <td class="diff">${same ? "Same" : `${d > 0 ? "+" : "−"}${esc(formatMeasure(k, Math.abs(d)))}`}</td></tr>`;
    }).join("")}</tbody>`;
  }).join("");
  box.insertAdjacentHTML("afterbegin", `<thead><tr><th scope="col"><span class="sr">Measure</span></th><th scope="col">This business</th><th scope="col">Left alone</th><th scope="col">Difference</th></tr></thead>`);
}

// ------------------------------------------------------------------ time

function paintTime(now) {
  page.now = now;
  const p = timeParts(now);
  const day = daysBetween(RUN_START, now) + 1;
  $("when").textContent = `${p.weekday} ${p.day} ${p.month} ${p.year}`;
  $("dayOf").textContent = day <= 1 ? "The first day of this test" : `Day ${num(day)} of this test`;
}

/** The run buttons use the sandbox bar's own runner, so the day card and the date change happen once, together. */
function wireRuns() {
  document.querySelectorAll("[data-days]").forEach((btn) => btn.addEventListener("click", async () => {
    if (bar.busy()) return;
    const days = Number(btn.dataset.days);
    document.querySelectorAll("[data-days]").forEach((b) => { b.disabled = true; });
    btn.setAttribute("aria-busy", "true");
    $("runSaid").textContent = `Moving on ${plural(days, "day")}…`;
    await bar.runDays(days);
    document.querySelectorAll("[data-days]").forEach((b) => { b.disabled = false; });
    btn.removeAttribute("aria-busy");
    $("runSaid").textContent = `Moved on ${plural(days, "day")}.`;
  }));
}

// ------------------------------------------------------------------ jobs an AI has taken

/** A call to the sandbox's own job routes, as its owner (the routes are Expanza's, not the business's tools). */
async function jobRoute(method, path = "") {
  const res = await fetch(`/sandboxes/${info.sandboxId}/jobs${path}`, { method, headers: { Authorization: `Bearer ${info.token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error?.message || "The sandbox did not answer.");
  return json.data;
}

async function paintJobs() {
  const box = $("jobs");
  const list = await jobRoute("GET").catch(() => null);
  page.jobs = Array.isArray(list) ? list : [];
  if (!page.jobs.length) {
    box.innerHTML = `<li class="cr-empty">${emptyState({ title: "No AI has taken a job yet.", text: "Give one a job with Connect your AI at the top. What it does shows here." })}</li>`;
    return;
  }
  box.innerHTML = page.jobs.map((j) => `<li><button type="button" class="cr-row job-row" data-job="${esc(j.id)}">
      <span class="row-main"><span class="row-top"><b>${esc(j.name)}</b>${j.active ? "" : '<span class="pill">Stopped</span>'}</span><span class="row-sub">${esc(j.summary)}</span></span>
      <span class="row-meta">${esc(plural(j.calls || 0, "action"))}${j.refused ? ` · ${esc(plural(j.refused, "refusal"))}` : ""}</span></button></li>`).join("");
  box.querySelectorAll("[data-job]").forEach((b) => b.addEventListener("click", () => openJob(b.dataset.job)));
}

/**
 * One job's result in a panel from the right: the summary, its figures against the business left alone, what
 * customers said, whether they came back, and the knock-on effects, all as the server worked them out.
 */
async function openJob(id) {
  const job = page.jobs.find((j) => j.id === id);
  const over = slideOver({ title: job?.name || "A job", wide: true, body: `<div class="job">${skeleton(8)}</div>` });
  const panel = over.el.querySelector(".job");
  const r = await jobRoute("GET", `/${encodeURIComponent(id)}/result?voices=all`).catch((e) => ({ error: e.message }));
  if (r.error) { panel.innerHTML = emptyState({ title: "The result did not load.", text: r.error }); return; }
  const parts = [];
  parts.push(`<p class="job-summary">${esc(String(r.summary || job?.summary || "").replace(/\s*(Rules|The rules)\b[^]*$/i, "").trim() || "Nothing yet.")}</p>`);
  parts.push(`<p class="job-meta">Acts as ${esc(personFor(job?.role || "manager").name.replace(/^The /, "the "))} · started ${esc(job?.started_sim ? shortDate(job.started_sim) : "")}${job?.active ? "" : " · stopped"}</p>`);
  if (Array.isArray(r.figures) && r.figures.length) {
    parts.push(`<h3 class="job-h">Against the same business left alone</h3><table class="figs"><thead><tr><th><span class="sr">Measure</span></th><th>With the AI</th><th>Left alone</th><th>Difference</th></tr></thead><tbody>
      ${r.figures.map((f) => `<tr class="${toneOf(f.key, f.difference || 0)}"><th scope="row">${esc(MEASURES[f.key]?.label || f.label)}</th><td>${esc(formatMeasure(f.key, f.with_ai))}</td><td>${esc(formatMeasure(f.key, f.left_alone))}</td><td class="diff">${esc(f.plain || "")}</td></tr>`).join("")}</tbody></table>`);
  }
  const c = r.contacts;
  if (c?.with_ai) {
    // The customers on the job's channels, with the AI and in the same business left alone, side by side.
    const a = c.with_ai, b = c.left_alone || {};
    const rows = [["Customers who got in touch", "arrived"], ["Answered by the AI", "answered_by_ai"], ["Judged right", "judged_right"], ["Handed to a person", "handed_over"],
      ["Changed something not asked for", "wrong_action"], ["Finished by staff", "finished_by_staff"], ["Still waiting", "still_waiting"], ["Average wait, hours", "average_wait_hours"]];
    parts.push(`<h3 class="job-h">Customers on its channels</h3><table class="figs"><thead><tr><th><span class="sr">Measure</span></th><th>With the AI</th><th>Left alone</th></tr></thead><tbody>
      ${rows.filter(([, k]) => a[k] != null).map(([l, k]) => `<tr><th scope="row">${esc(l)}</th><td>${esc(num(a[k]))}</td><td>${b[k] == null ? "–" : esc(num(b[k]))}</td></tr>`).join("")}</tbody></table>`);
  }
  const voices = (r.voices?.all || r.voices?.sample || []).slice(0, 12);
  if (voices.length) {
    parts.push(`<h3 class="job-h">What customers said</h3><ul class="voices">${voices.map((v) => `<li class="voice">
      <p>“${esc(v.said)}”</p><p class="voice-who"><span>${esc(v.name)}${v.town ? `, ${esc(v.town)}` : ""}</span><span>${esc(String(v.rating))} of 5</span></p></li>`).join("")}</ul>`);
  }
  const uses = Object.entries(r.adoption || {});
  if (uses.length) {
    parts.push(`<h3 class="job-h">Did they come back to it?</h3>${uses.map(([ch, u]) => `<dl class="job-dl"><div class="job-dl-h"><dt>${esc(words(ch))}</dt><dd></dd></div>
      ${[["Met it", u.customers_met_it], ["Came back to it", u.came_back_to_it], ["Asked for a person", u.asked_for_a_person], ["Gave up", u.gave_up], ["Average rating", u.average_rating != null ? `${Number(u.average_rating).toFixed(1)} of 5` : null]]
        .filter(([, v]) => v != null).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(typeof v === "number" ? num(v) : v)}</dd></div>`).join("")}
      ${[["Bought again after a good time", u.bought_again_after_a_good_time], ["Bought again after a bad time", u.bought_again_after_a_bad_time]].filter(([, x]) => x?.customers)
        .map(([k, x]) => `<div><dt>${esc(k)} (${esc(plural(x.customers, "customer"))})</dt><dd>${esc(plural(x.with_ai, "order"))}${x.left_alone != null ? ` <small>against ${esc(num(x.left_alone))} left alone</small>` : ""}</dd></div>`).join("")}</dl>`).join("")}`);
  }
  const chains = Array.isArray(r.knock_on) ? r.knock_on : [];
  if (chains.length) parts.push(`<h3 class="job-h">Knock-on effects</h3><ul class="chains">${chains.map((k) => `<li class="${k.ends === "bad" ? "bad" : k.ends === "good" ? "good" : ""}">${esc(k.sentence)}</li>`).join("")}</ul>`);
  if (r.refused?.count) parts.push(`<p class="job-meta">The shop's rules said no ${esc(plural(r.refused.count, "time"))}.</p>`);
  if (job?.active) parts.push(`<div class="job-foot"><button type="button" class="btn danger" id="stopJob">Stop this job</button><span class="job-said" id="jobSaid"></span></div>`);
  panel.innerHTML = parts.join("");
  panel.querySelector("#stopJob")?.addEventListener("click", async (e) => {
    const b = e.currentTarget;
    if (!b.classList.contains("is-sure")) { b.classList.add("is-sure"); b.textContent = "Press again to stop it"; return; }
    b.disabled = true;
    try {
      await jobRoute("POST", `/${encodeURIComponent(id)}/stop`);
      panel.querySelector("#jobSaid").textContent = "Stopped. Its key no longer works.";
      b.remove();
      paintJobs();
    } catch (err) {
      panel.querySelector("#jobSaid").textContent = err.message;
      b.disabled = false;
    }
  });
}

// ------------------------------------------------------------------ the business now

const FIGURES = [
  { key: "cash", label: "Cash in the bank", get: (s) => s.cash, fmt: money },
  { key: "profit", label: "Profit this month", get: (s) => s.this_month?.profit, fmt: money },
  { key: "orders", label: "Orders this month", get: (s) => s.this_month?.orders, fmt: (v) => num(Math.round(v)) },
  { key: "stock", label: "Stock on the shelves", get: (s) => s.stock_value, fmt: money },
  { key: "cases", label: "Cases open", get: (s) => s.open_cases, fmt: (v) => num(Math.round(v)), worse: "up" },
  { key: "late", label: "Parcels running late", get: (s) => s.late_parcels, fmt: (v) => num(Math.round(v)), worse: "up" },
];

async function paintFigures({ changed = false } = {}) {
  const box = $("figures");
  const res = await world.call("business_snapshot", {}, AS);
  if (!res.ok) { box.innerHTML = emptyState({ title: "The figures did not load.", text: res.error.message }); return; }
  const snap = res.data;
  box.innerHTML = FIGURES.map((f) => {
    const value = f.get(snap);
    const before = page.figures ? f.get(page.figures) : null;
    const diff = changed && before != null && value != null && Math.round(value) !== Math.round(before) ? value - before : 0;
    const worse = f.worse === "up" ? diff > 0 : diff < 0;
    return `<div class="fig"><span class="fig-label">${esc(f.label)}</span><b class="big-num">${esc(f.fmt(value ?? 0))}</b>
      <span class="fig-delta ${diff ? (worse ? "bad" : "good") : ""}">${diff ? `${diff > 0 ? "+" : "−"}${esc(f.fmt(Math.abs(diff)))}` : "&nbsp;"}</span></div>`;
  }).join("");
  page.figures = snap;
  $("nowAsOf").textContent = `As of ${shortDate(snap.as_of)}, ${snap.as_of.slice(11, 16)}`;
}

/** Profit for each of the last twelve months as plain bars: grey for profit, the bad colour for a loss. */
async function paintMonths() {
  const box = $("months");
  const res = await world.call("get_monthly_summary", {}, AS);
  const months = res.ok ? (res.data.months || []).slice(-12) : [];
  if (!months.length) { box.innerHTML = ""; return; }
  const max = Math.max(1, ...months.map((m) => Math.abs(m.profit)));
  box.innerHTML = `<p class="fig-label">Profit, month by month</p><div class="bars">${months.map((m, i) => {
    const h = Math.max(2, (Math.abs(m.profit) / max) * 100);
    const p = timeParts(`${m.month}-15T12:00:00Z`);
    return `<div class="bar-col${i === months.length - 1 ? " is-now" : ""}" title="${esc(`${p.month} ${p.year}: ${money(m.profit)}`)}">
      <span class="bar-fill${m.profit < 0 ? " loss" : ""}" style="--h:${h}%"></span><span class="bar-label">${esc(p.monthShort)}</span></div>`;
  }).join("")}</div>`;
}

// ------------------------------------------------------------------ everything that was done

/** Who did it, in words: you (from these screens) or an AI's key, which is for one job. */
function whoDid(e) {
  const mine = e.actor?.token === info.ownerTokenId;
  const role = e.actor?.role === "owner" ? null : e.actor?.role;
  return { mine, name: mine ? "You" : "Your AI", as: role && !mine ? `as ${personFor(role).name.replace(/^The /, "the ")}` : "" };
}

/** Engine change lines carry full timestamps; a date is all a person needs. */
function tidyChange(line) {
  return String(line).replace(/(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}Z/g, (m) => shortDate(m));
}

function recordRow(entry) {
  let e = entry;
  const who = whoDid(e);
  let verb = e.tool ? didWords(e.tool) : "";
  if (e.kind === "inbox.reply") verb = "replied to a customer";
  if (e.kind === "inbox.message") verb = "sent in a customer message";
  if (e.kind === "advance") {
    const t = summariseDays(e.summary || []).totals;
    verb = `moved time on ${plural(e.days || 1, "day")}`;
    e = { ...e, ok: true, changes: [`${plural(Math.round(t.orders), "order")}, ${money(t.revenue)} taken, ${money(t.net)} profit`] };
  }
  const refused = e.ok === false;
  const changes = e.changes || [];
  const detail = refused ? `The rules said no: ${e.error?.message || ""}` : changes.slice(0, 2).map(tidyChange).join(" · ") + (changes.length > 2 ? ` · and ${plural(changes.length - 2, "more change")}` : "");
  return `<li class="rec${refused ? " is-refused" : ""}" data-seq="${esc(e.seq)}" tabindex="-1">
    ${who.mine ? avatar("You", { size: 28 }) : avatar("AI", { size: 28, ai: true })}
    <div class="rec-main"><p class="rec-line"><b>${esc(who.name)}</b> ${esc(refused ? `tried: ${verb}` : verb)}<span class="rec-as"> ${esc(who.as)}</span></p>
      ${detail ? `<p class="rec-detail">${esc(detail)}</p>` : ""}</div>
    <div class="rec-side">${refused ? '<span class="pill bad">Refused</span>' : ""}<time>${esc(shortDate(e.sim_time))}</time></div>
  </li>`;
}

async function paintRecord({ fresh = false } = {}) {
  const list = $("record");
  if (fresh) { list.innerHTML = ""; page.lastSeq = 0; }
  const { entries, last } = await world.activity({ since: page.lastSeq });
  page.lastSeq = last;
  addRecord(entries, { mark: !fresh && list.querySelector(".rec") });
}

function addRecord(entries, { mark = true } = {}) {
  const list = $("record");
  list.querySelector(".cr-empty")?.remove();
  for (const e of entries.filter((x) => !isScreenRead(x))) {
    if (list.querySelector(`[data-seq="${e.seq}"]`)) continue;
    const li = node(recordRow(e));
    if (mark) li.classList.add("is-new");
    list.prepend(li);
  }
  while (list.children.length > RECORD_MAX) list.lastElementChild.remove();
  if (!list.children.length) list.innerHTML = `<li class="cr-empty">${emptyState({ title: "Nothing has been done yet.", text: "Everything you or your AI does appears here as it happens." })}</li>`;
}

// ------------------------------------------------------------------ connect your AI (the one place for technical words)

const AI_ROLES = [
  { role: "assistant", say: "The shop's assistant: talks to customers" },
  { role: "operations_assistant", say: "The back-office assistant: stock and buying" },
  { role: "support_agent", say: "A support agent: refunds up to £100" },
  { role: "manager", say: "The manager: can do almost anything" },
];

function copyRow(label, value, { secret = false } = {}) {
  return `<div class="copy-row"><span class="copy-label-text">${esc(label)}</span><code class="${secret ? "is-hidden" : ""}">${esc(value)}</code>
    ${secret ? '<button class="btn ghost small" data-reveal>Show</button>' : ""}
    <button class="btn small" data-copy="${esc(value)}"><span class="copy-label">Copy</span><span class="copied">Copied</span></button></div>`;
}

function wireCopies(root) {
  root.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copyText(b.dataset.copy, b)));
  root.querySelectorAll("[data-reveal]").forEach((b) => b.addEventListener("click", () => {
    const code = b.closest(".copy-row").querySelector("code");
    code.classList.toggle("is-hidden");
    b.textContent = code.classList.contains("is-hidden") ? "Show" : "Hide";
  }));
}

function paintConnect() {
  const box = $("connect");
  box.innerHTML = `<p class="cr-text">Your AI reaches this business through the web API or as an MCP server, with a key for one job. The key lets it do only what a person in that job could do. To give it a whole job with a briefing, use Connect your AI at the top.</p>
    <div class="copy-rows">${copyRow("Web API", info.apiUrl)}${copyRow("MCP", info.mcpUrl)}</div>
    <div class="connect-make"><label class="field"><span>A key for</span><select class="select" id="aiRole">${AI_ROLES.map((r) => `<option value="${r.role}">${esc(r.say)}</option>`).join("")}</select></label>
      <button class="btn" id="mintBtn">Make a key</button><span class="cr-said" id="mintSaid"></span></div>
    <div id="minted"></div>
    <details class="owner-key"><summary>The owner key (for you, not your AI)</summary>
      <p class="cr-text">This key can do everything, including starting again. Keep it out of your AI's hands.</p>${copyRow("Owner key", info.token, { secret: true })}</details>`;
  wireCopies(box);
  $("mintBtn").addEventListener("click", mint);
}

async function mint() {
  const role = $("aiRole").value;
  const btn = $("mintBtn");
  btn.disabled = true;
  try {
    const t = await world.mintToken(role);
    const config = JSON.stringify({ mcpServers: { overthought: { type: "http", url: info.mcpUrl, headers: { Authorization: `Bearer ${t.token}` } } } }, null, 2);
    const cli = `claude mcp add --transport http overthought ${info.mcpUrl} --header "Authorization: Bearer ${t.token}"`;
    $("minted").innerHTML = `<div class="minted">${copyRow("The key", t.token)}
      <div class="pm-code"><div class="pm-code-head"><span>MCP settings</span><button class="btn small" data-copy="${esc(config)}"><span class="copy-label">Copy</span><span class="copied">Copied</span></button></div><pre>${esc(config)}</pre></div>
      <div class="pm-code"><div class="pm-code-head"><span>Or, in Claude Code</span><button class="btn small" data-copy="${esc(cli)}"><span class="copy-label">Copy</span><span class="copied">Copied</span></button></div><pre>${esc(cli)}</pre></div></div>`;
    wireCopies($("minted"));
    $("mintSaid").textContent = "Ready. It is shown once.";
  } catch (e) {
    $("mintSaid").textContent = `No key was made. ${e.message}`;
  } finally {
    btn.disabled = false;
  }
}

// ------------------------------------------------------------------ start again

/** Two presses, the second within a few seconds: starting again throws away everything done, so it must be meant. */
function wireReset() {
  const btn = $("resetBtn");
  const said = $("resetSaid");
  let armed = null;
  btn.addEventListener("click", async () => {
    if (!armed) {
      btn.textContent = "Press again to start again";
      btn.classList.add("is-sure");
      armed = setTimeout(() => { armed = null; btn.textContent = "Start again"; btn.classList.remove("is-sure"); }, 4000);
      return;
    }
    clearTimeout(armed);
    armed = null;
    btn.disabled = true;
    said.textContent = "Starting again…";
    bar.pause();
    try {
      await world.reset();
      page.figures = null;
      await Promise.all([paintFigures(), paintMonths(), paintRecord({ fresh: true }), paintResult(), paintJobs()]);
      said.textContent = "Back where it started. The jobs are kept.";
    } catch (e) {
      said.textContent = `It did not start again. ${e.message}`;
    }
    btn.disabled = false;
    btn.textContent = "Start again";
    btn.classList.remove("is-sure");
  });
}

// ------------------------------------------------------------------ keyboard

/**
 * Up and Down (or J and K) move through any list on this page; Enter opens the row, as everywhere in the sandbox.
 * D, W and M move time on a day, a week or a month. Keys act only when you are not typing.
 */
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".over")) return;
  if (e.target.closest?.("input, textarea, select")) { if (e.key === "Escape") e.target.blur(); return; }
  const run = { d: 1, w: 7, m: 30 }[e.key];
  if (run) { e.preventDefault(); document.querySelector(`[data-days="${run}"]`)?.click(); return; }
  const d = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 }[e.key];
  const list = e.target.closest?.(".cr-list");
  if (!d || !list) return;
  const rows = [...list.querySelectorAll(":scope > li > button, :scope > li.rec")];
  const at = rows.indexOf(e.target.closest("button, li.rec"));
  const next = rows[Math.max(0, Math.min(rows.length - 1, at + d))];
  if (!next) return;
  e.preventDefault();
  next.focus();
});

// ------------------------------------------------------------------ start and stay live

wireRuns();
wireReset();
paintConnect();
$("figures").innerHTML = skeleton(4);
$("record").innerHTML = `<li>${skeleton(5)}</li>`;
paintTime((await world.clock()).now);
const levers = mountTry($("tryBody"), { world, onDone: () => { $("runSaid").textContent = "Now move time on to see what it does."; } });
await Promise.all([paintResult(), paintJobs(), paintFigures(), paintMonths(), paintRecord({ fresh: true })]);

let settle = null;
document.addEventListener("ot:day", (e) => {
  paintTime(e.detail.now);
  clearTimeout(settle);
  settle = setTimeout(() => {
    paintFigures({ changed: true });
    if (!e.detail.partial) { paintMonths(); paintResult(); paintJobs(); levers.refresh(); }
  }, e.detail.partial ? 150 : 300);
});

world.onChange((change) => {
  if (change.reset) { page.figures = null; paintRecord({ fresh: true }); paintFigures(); paintMonths(); paintResult(); return; }
  const shown = change.entries.filter((x) => !isScreenRead(x));
  if (change.entries.length) page.lastSeq = Math.max(page.lastSeq, change.entries.at(-1).seq);
  if (!shown.length) return;
  addRecord(shown);
  // What an outside AI changes shows in the figures without waiting for a day to pass.
  if (shown.some((x) => (x.changes || []).length && x.kind !== "advance")) { paintFigures({ changed: true }); paintJobs(); }
  if (shown.some((x) => x.actor?.token && x.actor.token !== info.ownerTokenId)) toast("Your AI did something. It is under Everything that was done.");
});
