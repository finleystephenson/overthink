// Rummage, Overthought & Co.'s search engine and front door (applications/home/, served at /). Its name lives in apps.json.
// It is the window onto a run, never the controls: runs are started and rerun from the terminal or a coding agent.
// Home: the name, one search box, the company's tools, and (after or during a run) one line about your AI.
// Results: tabs, results from every tool (each opens its record there), and a panel with what your AI did and its
// effect on the business, facts only. Your AI's own actions are results too, and arrive live while a run is going.
// The same page works with no AI at all: then it is simply the company's search.

import { getClient } from "../lib/client.js";
import { appIcon, spiral } from "../lib/icons.js";
import { esc, loadApps } from "../lib/ui.js";
import { connectLive, nowLine, phrase, plainIds } from "../lib/live.js";
import { TABS, makeSources } from "./sources.js";

const $ = (id) => document.getElementById(id);
const TYPE_MS = 160;      // typing pause on the results page before searching again
const PER_KIND_ALL = 4;   // rows per kind on "All"; a tab of its own shows more
const PER_KIND_TAB = 20;

/** Where a product works, in plain words. */
const CHANNELS = { web_chat: "website chat", email: "email", phone: "phone", text: "text messages" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const S = {
  apps: new Map(),
  run: null,             // /view/run's data on `overthink view`, else null
  live: null,            // "running" | "finished" | null
  items: [],             // your AI's part of the run: { e, p }, in order
  marks: new Set(),      // ids of records your AI created, changed or wrote (this world)
  arm: "with",
  q: "",
  tab: "all",
  asked: 0,
  shown: new Set(),      // keys of rows on screen, so new ones can arrive with a little movement
  others: [],            // the last rows from the company's tools, kept so live events can repaint without asking again
};

const andList = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const wordsOf = (q) => q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
const hasRun = () => Boolean(S.run || S.items.length);
const aiCount = () => S.items.filter((x) => x.p.ai).length;

/** "29 Nov 2026" from a date or a time. */
function day(iso) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Escapes text and makes the query's words bold, as search engines do in snippets. */
function bold(text, words) {
  let out = esc(text);
  for (const w of words) out = out.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"), "<b>$1</b>");
  return out;
}

// ------------------------------------------------------------------ the address: which face, which search

function readAddress() {
  const p = new URLSearchParams(location.search);
  S.q = (p.get("q") || "").trim();
  S.tab = TABS.some((t) => t.id === p.get("tab")) ? p.get("tab") : "all";
}

function go(q, tab, { replace = false } = {}) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (tab && tab !== "all") p.set("tab", tab);
  const url = `${location.pathname}${p.toString() ? `?${p}` : ""}`;
  history[replace ? "replaceState" : "pushState"](null, "", url);
  render();
}

function render() {
  readAddress();
  const results = Boolean(S.q) || S.tab !== "all";
  document.body.dataset.page = results ? "results" : "home";
  document.body.dataset.tab = S.tab;
  $("serp").hidden = !results;
  if ($("q").value.trim() !== S.q) $("q").value = S.q;
  $("clear").hidden = !$("q").value;
  const name = S.apps.get("home")?.name || "Rummage";
  document.title = results ? `${S.q || TABS.find((t) => t.id === S.tab).label} · ${name}` : name;
  if (results) { paintTabs(); paintPanel(); search(); } else paintAiLine();
}

// ------------------------------------------------------------------ home

function paintLogo() {
  const name = S.apps.get("home")?.name || "Rummage";
  const me = S.apps.get("home");
  $("logo").innerHTML = `${me ? appIcon(me, { size: 40 }) : spiral({ size: 40 })}<span>${esc(name)}</span>`;
  $("logo").setAttribute("aria-label", `${name}: home`);
}

function paintApps() {
  const tools = [...S.apps.values()].filter((a) => a.id !== "home");
  $("apps").innerHTML = tools.map((a) => `<li><a class="app" href="../${esc(a.id)}/">${appIcon(a, { size: 52 })}
    <span><b>${esc(a.name)}</b><small>${esc(a.plain)}</small></span></a></li>`).join("");
}

/**
 * One line under the box. While a run is going it says what the AI is doing right now and opens that record; after a
 * run it is a quiet way into what it did; with no run there is no line.
 */
function paintAiLine() {
  const el = $("aiLine");
  el.hidden = !hasRun();
  if (el.hidden) return;
  el.classList.toggle("live", S.live === "running");
  if (S.live === "running" && S.latest) {
    const { e, text } = S.latest;
    const app = S.apps.get(e.app);
    const href = e.link || (app ? `../${app.id}/` : "?tab=ai");
    el.innerHTML = `<a href="${esc(href)}"><span class="pip" aria-hidden="true"></span>${esc(text)}</a>`;
  } else if (S.live === "running") {
    el.innerHTML = '<span class="pip" aria-hidden="true"></span>Your AI is starting…';
  } else {
    el.innerHTML = `<a href="?tab=ai">See what your AI did in the last run →</a>`;
  }
}

// ------------------------------------------------------------------ results

function paintTabs() {
  $("tabs").innerHTML = TABS.filter((t) => t.id !== "ai" || hasRun()).map((t) => {
    const n = t.id === "ai" ? aiCount() : 0;
    const href = `?${new URLSearchParams({ ...(S.q ? { q: S.q } : {}), ...(t.id !== "all" ? { tab: t.id } : {}) })}`;
    return `<a href="${esc(href)}" data-tab="${t.id}"${t.id === S.tab ? ' aria-current="page"' : ""}>${esc(t.label)}${n ? ` <span class="n">${n}</span>` : ""}</a>`;
  }).join("");
}

/** Your AI's part of the run as result rows, newest first, matching the query. */
function aiRows(q, n) {
  const ws = wordsOf(q);
  const out = [];
  for (let i = S.items.length - 1; i >= 0 && out.length < n; i--) {
    const { e, p } = S.items[i];
    if (p.divider) continue;
    const app = S.apps.get(e.app);
    const text = p.text.replace(/<[^>]+>/g, "");
    if (!ws.every((w) => `${text} ${p.quote || ""} ${app?.name || ""}`.toLowerCase().includes(w))) continue;
    out.push({
      kind: "ai", key: `ev-${e.run}-${e.seq}`, ai: p.ai, app: e.app,
      where: [e.seed != null && S.run?.seeds?.length > 1 ? `Run ${e.seed}` : "", e.type === "person.reacted" ? "How people reacted" : ""].filter(Boolean).join(" › "),
      title: p.ai ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text,
      snip: p.quote ? `“${plainIds(p.quote)}”` : "", date: e.sim_time, href: e.link || (app ? `../${app.id}/` : null),
    });
  }
  return out;
}

/** Mixes the kinds on "All" one at a time, so no single tool fills the page. */
function interleave(groups) {
  const out = [];
  for (let i = 0; groups.some((g) => g[i]); i++) for (const g of groups) if (g[i]) out.push(g[i]);
  return out;
}

async function search() {
  const id = ++S.asked;
  const tab = TABS.find((t) => t.id === S.tab);
  const per = tab.id === "all" ? PER_KIND_ALL : PER_KIND_TAB;
  if (!S.others.length || S.others.q !== S.q || S.others.tab !== S.tab) $("results").innerHTML = '<div class="skeleton"></div>'.repeat(3);
  // WHY: the live run's own server has the run's events but no world to search; that comes with `overthink view`.
  const kinds = S.noWorld ? [] : tab.kinds.filter((k) => k !== "ai");
  const groups = await Promise.all(kinds.map((k) => S.sources[k](S.q, per).catch(() => [])));
  if (id !== S.asked) return;
  S.others = groups;
  S.others.q = S.q;
  S.others.tab = S.tab;
  paintResults();
}

function paintResults() {
  const tab = TABS.find((t) => t.id === S.tab);
  const ws = wordsOf(S.q);
  const mine = tab.kinds.includes("ai") ? aiRows(S.q, tab.id === "ai" ? 200 : 3) : [];
  const rows = tab.id === "all" ? [...mine, ...interleave(S.others)] : [...mine, ...S.others.flat()];
  for (const r of rows) {
    r.key ||= `${r.kind}-${r.id}`;
    if (r.kind !== "ai" && S.arm === "with" && (S.marks.has(r.id) || (r.thread && S.marks.has(r.thread)))) r.ai = true;
  }
  const fresh = new Set(rows.map((r) => r.key).filter((k) => S.shown.size && !S.shown.has(k)));
  S.shown = new Set(rows.map((r) => r.key));
  $("about").textContent = rows.length === 0 ? ""
    : tab.id === "ai" ? `${S.live === "running" ? "Live. " : ""}${rows.length} ${rows.length === 1 ? "thing" : "things"}${S.q ? ` matching “${S.q}”` : ""}, newest first`
      : `${rows.length} results${S.q ? ` for “${S.q}”` : ""}`;
  $("results").innerHTML = rows.length ? rows.map((r) => resultHtml(r, ws, fresh.has(r.key))).join("") : noneHtml(tab);
}

/** No codes on screen: record numbers in titles and snippets become words. */
const words = (t) => String(t || "").replace(/\bORD-(\d+)/g, "order $1").replace(/\bCASE-(\d+)/g, "case $1").replace(/\bPO-(\d+)/g, "purchase order $1");

function resultHtml(r, ws, fresh) {
  r = { ...r, title: words(r.title), snip: words(r.snip) };
  const app = S.apps.get(r.app);
  const icon = app ? appIcon(app, { size: 28 }) : `<span class="app-icon" style="border-radius:8px;box-shadow:inset 0 0 0 1px var(--line-2)"></span>`;
  const title = r.href ? `<a href="${esc(r.href)}">${bold(r.title, ws)}</a>` : bold(r.title, ws);
  const date = day(r.date);
  return `<article class="res${r.ai ? " is-ai" : ""}${fresh ? " new" : ""}">
    <div class="src">${icon}<span class="where"><b>${esc(app?.name || "The run")}</b>${r.where ? `<span>${esc(r.where)}</span>` : ""}</span>${r.ai ? '<span class="ai">Your AI</span>' : ""}</div>
    <h3>${title}</h3>
    ${date || r.snip ? `<p class="snip">${date ? `<span class="d">${esc(date)}${r.snip ? " — " : ""}</span>` : ""}${bold(r.snip || "", ws)}</p>` : ""}
  </article>`;
}

function noneHtml(tab) {
  if (S.noWorld && tab.id !== "ai") {
    return `<div class="none"><p>While the run is going, Rummage follows what your AI does: see <a href="?tab=ai">Your AI</a>.</p>
      <p>The whole company is searchable when it finishes: <b>overthink view</b>.</p></div>`;
  }
  if (tab.id === "ai" && !S.items.length) {
    return `<div class="none">${S.live === "running" ? "<p>The run has started. Your AI’s actions appear here as it takes them.</p>" : "<p>Your AI did nothing in this run that anyone could see.</p>"}</div>`;
  }
  return `<div class="none"><p>Nothing matches <b>${esc(S.q)}</b>${tab.id !== "all" ? ` in ${esc(tab.label.toLowerCase())}` : ""}.</p>
    <ul><li>Try fewer words, or a name.</li>${tab.id !== "all" ? `<li><a href="?q=${encodeURIComponent(S.q)}">Search everything</a></li>` : ""}</ul></div>`;
}

// ------------------------------------------------------------------ the panel: what your AI did, and its effect

/** A measure's value in its own unit. */
function fmt(m, v) {
  if (v == null) return "–";
  if (m.unit === "£") return `${v < 0 ? "−" : ""}£${Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (m.unit === "share") return `${Math.round(v * 100)}%`;
  if (m.unit === "/5") return `${v.toFixed(1)} of 5`;
  if (m.unit === "min") return v >= 120 ? `${Math.round(v / 60)} hours` : `${Math.round(v)} min`;
  return v.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

function measureRow(m) {
  const d = m.difference?.mean;
  const tone = d == null || !m.difference.clear || d === 0 ? "" : (d > 0) === (m.better === "up") ? "good" : "bad";
  const said = d == null ? "–" : !m.difference.clear ? "No clear change" : `${d > 0 ? "+" : "−"}${fmt(m, Math.abs(d)).replace(/^−/, "")}`;
  return `<li><span>${esc(m.label)}</span><span class="v ${tone}">${esc(said)}<small>${esc(fmt(m, m.without))} without, ${esc(fmt(m, m.with))} with</small></span></li>`;
}

function paintPanel() {
  const panel = $("panel");
  const show = hasRun() && (S.tab === "all" || S.tab === "ai");
  panel.hidden = !show;
  if (!show) return;
  const r = S.run?.results;
  const startedWith = S.items.find((x) => x.e.type === "run.started")?.e.data || {};
  const c = r?.config || startedWith;
  const where = c.channels?.length ? andList(c.channels.map((x) => CHANNELS[x] || x.replace(/_/g, " "))) : "every channel";
  const runs = r?.reproducibility?.seeds?.length || c.seeds?.length || 0;
  const head = `<div class="p-head"><span class="k">${S.live === "running" ? "Your AI, live" : "Your AI"}</span>
    <h2>${esc(c.adapter || "Your AI")}</h2>
    <p>On ${esc(where)}${runs ? ` · ${runs} ${runs === 1 ? "run" : "runs"} of ${c.days} days, each beside the same business without it` : ""}</p></div>`;
  const without = S.arm === "without" ? '<p class="without-note">You are looking at the business without your AI. Search shows that version.</p>' : "";
  if (!r) {
    panel.innerHTML = `${head}${without}<div class="p-sec"><dl class="facts">
      <div><dt>Actions so far</dt><dd>${aiCount()}</dd></div>
      <div><dt>People who wrote in</dt><dd>${S.items.filter((x) => x.e.type === "contact.raised").length}</dd></div>
      <div><dt>Replies</dt><dd>${S.items.filter((x) => x.e.type === "product.replied").length}</dd></div></dl></div>
      <div class="p-sec"><p class="p-note">${S.live === "running" ? "The effect on the business appears when the run finishes." : "The effect on the business, and the whole company to search, open with <b>overthink view</b>."}</p></div>`;
    return;
  }
  const p = r.product || {};
  const keys = ["net_profit", "revenue", "refunds", "customer_satisfaction", "first_response_median_minutes", "complaints"];
  const measures = keys.map((k) => r.measures.find((m) => m.key === k)).filter(Boolean);
  const wrong = (r.failureCounts || []).slice(0, 4).map((f) => {
    const link = r.failures.find((x) => x.kind === f.kind)?.link;
    return `<li><span>${link ? `<a href="${esc(link)}">${esc(f.label)}</a>` : esc(f.label)}</span><span class="v">${f.n}</span></li>`;
  }).join("");
  const sec = r.security || {};
  panel.innerHTML = `${head}${without}
    <div class="p-sec"><h3>What it did</h3><dl class="facts">
      <div><dt>Conversations</dt><dd>${p.contacts ?? 0}</dd></div>
      <div><dt>Sorted alone</dt><dd>${p.resolvedAlone ?? 0}</dd></div>
      <div><dt>Actions</dt><dd>${p.toolCalls ?? aiCount()}</dd></div></dl></div>
    <div class="p-sec"><h3>Effect on the business, per run</h3><ul class="rows">${measures.map(measureRow).join("")}</ul></div>
    <div class="p-sec"><h3>What went wrong</h3><ul class="rows">${wrong || "<li><span>Nothing the checks look for</span></li>"}
      ${sec.attempts ? `<li><span>Attempts to break it</span><span class="v">${sec.attempts}<small>held ${sec.held}, broke ${sec.broke}</small></span></li>` : ""}</ul></div>
    <div class="p-foot"><a href="/report">Full report →</a>
      <span class="arms" role="group" aria-label="With or without your AI">
        <button type="button" data-arm="with" aria-pressed="${S.arm === "with"}">With your AI</button>
        <button type="button" data-arm="without" aria-pressed="${S.arm === "without"}">Without</button></span></div>`;
}

/** The same moment without the AI: the `ot-view` cookie the view server reads, then a fresh look. */
function switchArm(arm) {
  if (arm === S.arm) return;
  document.cookie = `ot-view=${S.run?.view?.seed || 1}.${arm}; path=/; SameSite=Strict`;
  try { sessionStorage.removeItem("ot-sandbox"); } catch { /* storage blocked: the cookie is enough */ }
  location.reload();
}

// ------------------------------------------------------------------ live

let repaint = null;

/** One event from the run. Only the arm with the product; the twin is what the report compares against. */
function take(e) {
  if (e.arm === "without") return;
  const line = nowLine(e, S.apps.get(e.app)?.name);
  if (line) S.latest = { e, text: line };
  const p = phrase(e);
  if (p) S.items.push({ e, p });
  if (!p && !line) return;
  // WHY batch: a finished run arrives as hundreds of events at once; paint once they have landed.
  clearTimeout(repaint);
  repaint = setTimeout(() => {
    if (document.body.dataset.page === "home") paintAiLine();
    else { paintTabs(); paintPanel(); if (S.tab === "ai" || S.tab === "all") paintResults(); }
  }, 120);
}

// ------------------------------------------------------------------ start

function wire() {
  const input = $("q");
  let timer = null;
  $("box").addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(timer);
    const q = input.value.trim();
    if (q || S.tab !== "all") go(q, S.tab);
    input.blur();
  });
  input.addEventListener("input", () => {
    $("clear").hidden = !input.value;
    // Results update as you type once you are on them; the home waits for Enter, as a search engine's does.
    if (document.body.dataset.page !== "results") return;
    clearTimeout(timer);
    timer = setTimeout(() => go(input.value.trim(), S.tab, { replace: true }), TYPE_MS);
  });
  $("clear").addEventListener("click", () => { input.value = ""; $("clear").hidden = true; input.focus(); });
  $("tabs").addEventListener("click", (e) => {
    const a = e.target.closest("a[data-tab]");
    if (!a) return;
    e.preventDefault();
    go(input.value.trim(), a.dataset.tab);
  });
  $("logo").addEventListener("click", (e) => { e.preventDefault(); go("", "all"); });
  $("main").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-arm]");
    if (b) switchArm(b.dataset.arm);
    const a = e.target.closest('a[href^="?"]');
    if (a) { e.preventDefault(); const p = new URLSearchParams(a.getAttribute("href").slice(1)); go(p.get("q") || "", p.get("tab") || "all"); }
  });
  window.addEventListener("popstate", render);
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); input.focus(); input.select(); }
    if (e.key === "Escape" && document.activeElement === input) input.blur();
  });
}

async function main() {
  const apps = (await loadApps()).filter((a) => a.layer === "business" && a.status === "ready");
  S.apps = new Map(apps.map((a) => [a.id, a]));
  paintLogo();
  paintApps();
  const world = getClient();
  S.sources = makeSources(world);
  wire();
  // Which server this is: `overthink view` answers /view/run; any server with a run answers /live/status.
  const run = await fetch("/view/run", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!run?.ok) S.noWorld = !(await fetch("/openapi.json").then((r) => r.ok).catch(() => false));
  if (run?.ok) {
    S.run = run.data;
    S.arm = run.data.view?.arm === "without" ? "without" : "with";
    const marks = await fetch("/view/marks", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    S.marks = new Set((marks?.data?.marks || []).map((m) => m.id));
  }
  render();
  await connectLive({
    onEvent: take,
    onState: (state) => {
      S.live = state;
      if (document.body.dataset.page === "home") paintAiLine(); else { paintTabs(); paintPanel(); }
    },
  });
}

main().catch((e) => {
  console.error(e);
  $("about").textContent = "The business could not be reached. Is Overthink running?";
});
