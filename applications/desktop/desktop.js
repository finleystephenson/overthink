// The sandbox desktop: the computer the AI works on, and the front door at /. A menu bar (the company, its apps,
// what is happening, search, the business's own time), a dock of the company's apps (built from apps.json, so a new
// app appears by itself), and each app in its own window. On a phone or tablet: a home screen and full-screen apps.
//
// Watching the AI at any speed. Every event (a run's live stream, or on `overthink up` the sandbox's own record of
// calls) is counted. While it comes at a person's pace, the app it happened in comes forward, the AI's cursor goes to
// it, and the record it touched is revealed. When it comes faster (hundreds or thousands a second) nothing on screen
// jumps: the desktop goes calm, and the activity panel counts, streams at the speed you choose, follows one thread,
// and keeps a timeline to step back through. The rules for when are in watch.js; the windows in windows.js.

import { getClient } from "../lib/client.js";
import { appIcon, spiral } from "../lib/icons.js";
import { connectLive, nowLine, phrase } from "../lib/live.js";
import { plainRef } from "../lib/plain.js";
import { CURSOR_HTML, aiBadge, didWords, ensureStyle, startYourAi } from "../lib/your-ai.js";
import { mountWindows } from "./windows.js";
import { mountPanel } from "./panel.js";
import { mountSpotlight } from "./spotlight.js";
import {
  WATCH, actionOf, createGroups, createModeSwitch, createPlayback, createRate, createTimeline, fromTrace, isAiAction,
  isWatched, recordHref, threadOf,
} from "./watch.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const TOUCH = "(max-width: 760px), (pointer: coarse) and (max-width: 1366px)";
const REVEAL_MS = 1100;    // at most one window reveal this often, even at a person's pace
const BUSY_MS = 5000;      // someone using the desktop this recently is not interrupted by a window coming forward
const DOCK_FAVOURITES = ["home", "letterbox", "front-desk", "kettle"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const params = new URLSearchParams(location.search);
const calmAt = Number(params.get("calm")) > 0 ? Number(params.get("calm")) : WATCH.enterRate;

const S = {
  apps: new Map(),
  world: null,
  hasWorld: false,
  run: null,               // "running" | "finished" | null
  mode: "normal",
  latest: null,            // the newest watched event
  following: null,         // { id, label }
  busyAt: 0,               // when the person last used the desktop
  calmPanelDismissed: false,
  clock: null,
  revealTimer: null,
  pending: null,
  lastReveal: 0,
  dockPulse: new Map(),
  latestAt: -Infinity,    // when the newest event arrived live (a replay does not count)
};

const rate = createRate();
const modes = createModeSwitch({ enterRate: calmAt, exitRate: Math.min(WATCH.exitRate, calmAt * 0.4) });
const groups = createGroups();
const playback = createPlayback();
const timeline = createTimeline();

const icon = (app, o) => appIcon(app, o);
const touch = () => matchMedia(TOUCH).matches;

/** Rummage and the live events may still say "filing-cabinet" for Files, or the other way round. */
function alias(id) {
  if (!id || S.apps.has(id)) return id;
  if (id === "filing-cabinet" && S.apps.has("files")) return "files";
  if (id === "files" && S.apps.has("filing-cabinet")) return "filing-cabinet";
  return id;
}

// ------------------------------------------------------------------ the screen

function area() {
  const mb = $("menubar").offsetHeight || 32;
  return { w: innerWidth, h: innerHeight, top: mb, bottom: touch() ? innerHeight : innerHeight - 92 };
}

let wins = null;

function paintMenuBar() {
  $("coMenu").innerHTML = `${spiral({ size: 17 })}<b>Overthought &amp; Co.</b>`;
  $("coMenu").setAttribute("aria-label", "Overthought & Co.");
}

function paintDock() {
  const apps = [...S.apps.values()];
  const list = touch() ? DOCK_FAVOURITES.map((id) => S.apps.get(id)).filter(Boolean) : apps;
  let html = "";
  let layer = null;
  for (const a of list) {
    if (layer && a.layer !== layer && !touch()) html += '<span class="dock-sep" aria-hidden="true"></span>';
    layer = a.layer;
    html += `<button type="button" class="dock-i" data-app="${esc(a.id)}" aria-label="${esc(a.name)}, ${esc(a.plain)}">${icon(a, { size: 48 })}
      <span class="dock-ai" aria-hidden="true"></span><span class="dock-tip">${esc(a.name)} <span>· ${esc(a.plain)}</span></span></button>`;
  }
  $("dock").innerHTML = html;
  markOpen();
}

function markOpen() {
  if (!wins) return;
  for (const b of $("dock").querySelectorAll(".dock-i")) b.classList.toggle("is-open", Boolean(wins.wm.get(b.dataset.app)));
  document.body.classList.toggle("in-app", touch() && Boolean(wins.wm.focused()));
  // Touch: the status bar sits on the open app's paper, or on the wallpaper at home.
}

function paintHome() {
  const apps = [...S.apps.values()];
  $("home").innerHTML = `<div class="home-hello"><b>Overthought &amp; Co.</b><p id="homeDate"></p></div>
    <ul class="home-grid">${apps.map((a) => `<li><button type="button" class="home-a" data-app="${esc(a.id)}">${icon(a, { size: 60 })}<span>${esc(a.name)}<small>${esc(a.plain)}</small></span></button></li>`).join("")}</ul>`;
  paintClock();
}

function applyTouch() {
  const t = touch();
  document.body.classList.toggle("is-touch", t);
  $("home").hidden = !t;
  paintDock();
  wins?.resize();
  wins?.paint();
}

// ------------------------------------------------------------------ the clock: the business's time, not yours

function setClock(iso) {
  if (!iso || iso === S.clock) return;
  if (S.clock && iso < S.clock) return;
  S.clock = iso;
  paintClock();
}

function paintClock() {
  if (!S.clock) { $("clock").textContent = ""; return; }
  const d = new Date(S.clock);
  const day = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  $("clock").innerHTML = `<span class="d">${day}</span>&nbsp; ${S.clock.slice(11, 16)}`;
  $("clock").title = `The business's time: ${day} ${d.getUTCFullYear()}, ${S.clock.slice(11, 16)}. It moves only when the simulation moves it.`;
  const hd = $("homeDate");
  if (hd) hd.textContent = `${day}, ${S.clock.slice(11, 16)} in the business`;
}

// ------------------------------------------------------------------ menus

let openMenu = null;

function showMenu(button, items) {
  closeMenu();
  const r = button.getBoundingClientRect();
  const m = document.createElement("div");
  m.className = "menu";
  m.setAttribute("role", "menu");
  m.style.left = `${Math.max(6, Math.min(r.left, innerWidth - 300))}px`;
  m.innerHTML = items.map((it, i) => {
    if (it === "-") return '<div class="menu-sep" role="separator"></div>';
    if (it.head) return `<div class="menu-h">${esc(it.head)}</div>`;
    if (it.html) return it.html;
    return `<button type="button" class="menu-i" role="menuitem" data-i="${i}"${it.disabled ? ' aria-disabled="true"' : ""}>${it.icon || ""}<span>${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : it.small ? `<small>${esc(it.small)}</small>` : ""}</button>`;
  }).join("");
  m.addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]");
    if (!b) return;
    closeMenu();
    items[Number(b.dataset.i)].run?.();
  });
  $("menus").append(m);
  button.setAttribute("aria-expanded", "true");
  openMenu = { m, button };
  m.querySelector(".menu-i")?.focus({ preventScroll: true });
}

function closeMenu() {
  if (!openMenu) return;
  openMenu.m.remove();
  openMenu.button.setAttribute("aria-expanded", "false");
  openMenu = null;
}

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl ";

function companyMenu() {
  const theme = document.documentElement.dataset.theme || "auto";
  return [
    { html: `<div class="menu-about"><b>Overthought &amp; Co.</b><p>A simulated company whose apps all work, inside an open-source sandbox for testing AI in a business environment. Nothing here is real, and nothing you do leaves the sandbox.</p></div>` },
    "-",
    { label: "Search the company", kbd: `${MOD}K`, run: () => spot.open() },
    { label: "Activity", small: S.run === "running" ? "Live" : "", run: () => panel.toggle() },
    "-",
    { head: "Look" },
    ...[["light", "Light"], ["dark", "Dark"], ["auto", "Same as this device"]].map(([t, l]) => ({ label: l, small: theme === t ? "✓" : "", run: () => setTheme(t) })),
  ];
}

function appsMenu() {
  const out = [];
  let layer = null;
  for (const a of S.apps.values()) {
    if (a.layer !== layer) { if (layer) out.push("-"); out.push({ head: a.layer === "sandbox" ? "The sandbox" : "The business" }); layer = a.layer; }
    out.push({ label: a.name, small: a.plain, icon: icon(a, { size: 20 }), run: () => openApp(a.id) });
  }
  return out;
}

function windowMenu() {
  const list = wins.wm.list().slice().reverse();
  const front = wins.wm.focused();
  return [
    { label: "Next window", kbd: `${MOD}\``, disabled: list.filter((w) => !w.min).length < 2, run: () => wins.wm.cycle(1) },
    { label: front?.max ? "Back to its size" : "Fill the screen", disabled: !front, run: () => front && wins.wm.toggleMax(front.app) },
    { label: "Minimise", disabled: !front, run: () => front && wins.wm.minimise(front.app) },
    { label: "Close", kbd: `${MOD}W`, disabled: !front, run: () => front && wins.wm.close(front.app) },
    "-",
    { label: "Arrange in a cascade", disabled: !list.length, run: () => wins.cascade() },
    { label: "Close every window", disabled: !list.length, run: () => list.forEach((w) => wins.wm.close(w.app)) },
    ...(list.length ? ["-", ...list.map((w) => ({ label: S.apps.get(w.app)?.name || w.app, small: w.min ? "minimised" : w === front ? "●" : "", icon: S.apps.get(w.app) ? icon(S.apps.get(w.app), { size: 20 }) : "", run: () => wins.wm.focus(w.app) }))] : []),
  ];
}

function setTheme(t) {
  try { if (t === "auto") localStorage.removeItem("ot-theme"); else localStorage.setItem("ot-theme", t); } catch { /* blocked: this page only */ }
  const apply = (doc) => { if (t === "auto") delete doc.documentElement.dataset.theme; else doc.documentElement.dataset.theme = t; };
  apply(document);
  for (const w of wins.wm.list()) { try { apply(wins.get(w.app).frame.contentDocument); } catch { /* not loaded */ } }
}

// ------------------------------------------------------------------ opening things

/**
 * Opens an app's window (on a phone, full screen), optionally at one page, revealing one record.
 * @param {string} id
 * @param {?string=} href a path under /apps/
 * @param {?string=} reveal a record id
 */
function openApp(id, href = null, reveal = null) {
  id = alias(id);
  if (!S.apps.has(id)) return null;
  closeMenu();
  if (reveal) { try { sessionStorage.setItem("ot-reveal", reveal); } catch { /* blocked */ } }
  const rec = wins.open(id, href);
  // Same page, no reload: ask the app to reveal it now (lib/your-ai.js).
  if (reveal && rec && !rec.reloaded) {
    try { sessionStorage.removeItem("ot-reveal"); rec.frame.contentWindow.otYourAi?.reveal(reveal); } catch { /* not ready */ }
  }
  bounce(id);
  return rec;
}

function bounce(id) {
  const b = $("dock").querySelector(`.dock-i[data-app="${CSS.escape(id)}"]`);
  if (!b || wins.wm.get(id)?.url) return;
  b.classList.remove("bounce");
  void b.offsetWidth;
  b.classList.add("bounce");
  setTimeout(() => b.classList.remove("bounce"), 720);
}

/** Opens one moment of the run where it happened. */
function openEvent(e) {
  const app = alias(e.app);
  if (!app) return;
  const href = S.hasWorld ? recordHref({ ...e, app }) : null;
  const rec = openApp(app, href, S.hasWorld ? e.record : null);
  if (rec) showCard(app, e);
}

// ------------------------------------------------------------------ frames: keys, links and focus from inside apps

function hookFrame(app, frame) {
  let doc;
  try { doc = frame.contentDocument; } catch { return; }
  if (!doc) return;
  // An app inside a window: its links to other apps open those apps' windows, not a page inside this one.
  doc.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const a = e.target.closest?.("a[href]");
    if (!a || a.target === "_blank") return;
    const url = new URL(a.href, frame.contentWindow.location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === "/" || url.pathname.startsWith("/apps/desktop/")) { e.preventDefault(); return; }
    const m = /^\/apps\/([^/]+)\//.exec(url.pathname);
    const to = m && alias(m[1]);
    if (to && to !== app && S.apps.has(to)) {
      e.preventDefault();
      openApp(to, url.pathname + url.search + url.hash);
    }
  }, true);
  doc.addEventListener("keydown", (e) => onKey(e, true), true);
  doc.addEventListener("pointerdown", () => { S.busyAt = Date.now(); if (wins.wm.focused()?.app !== app) wins.wm.focus(app); }, true);
  doc.addEventListener("input", () => { S.busyAt = Date.now(); }, true);
  // The app's own pages are full screen in a phone's window: nothing to tell it. Theme follows the desktop.
}

// ------------------------------------------------------------------ keys

function onKey(e, fromFrame = false) {
  const mod = e.metaKey || e.ctrlKey;
  S.busyAt = Date.now();
  if (mod && (e.key === "k" || e.key === "K" || e.code === "Space")) { e.preventDefault(); spot.toggle(); return; }
  if ((mod && (e.key === "w" || e.key === "W")) || (e.altKey && e.code === "KeyW")) {
    const f = wins.wm.focused();
    if (f) { e.preventDefault(); wins.wm.close(f.app); }
    return;
  }
  if (mod && (e.code === "Backquote" || e.key === "`")) { e.preventDefault(); wins.wm.cycle(e.shiftKey ? -1 : 1); return; }
  if (fromFrame) return;
  if (e.key === "Escape") {
    if (openMenu) { closeMenu(); return; }
    if (spot.isOpen()) { spot.close(); return; }
    if (panel.isOpen()) { panel.close(); }
  }
}

// ------------------------------------------------------------------ watching

/** One event, from wherever it came. */
function take(e, { replay = false } = {}) {
  if (e.sim_time && e.arm !== "without") setClock(e.sim_time);
  if (e.type === "run.started") S.run = "running";
  if (e.type === "run.finished" || e.type === "run.stopped") { S.run = "finished"; paintLive(); }
  if (!isWatched(e)) return;
  e.app = alias(e.app);
  const now = performance.now();
  timeline.push(e);
  groups.add(e);
  if (!S.following || threadOf(e) === S.following.id) playback.push(e);
  S.latest = e;
  if (replay) return;
  rate.add(now);
  pulseDock(e.app, isAiAction(e));
  const mode = modes.update(rate.rate(now), now);
  if (mode !== S.mode) onMode(mode);
  const mine = S.following && threadOf(e) === S.following.id;
  if (S.mode === "normal" || mine) consider(e);
}

/** Normal pace: the newest AI action is shown, at most once every REVEAL_MS; anything else stays a quiet line. */
function consider(e) {
  if (!isAiAction(e) && e.type !== "contact.raised" && e.type !== "activity") return;
  // A call that failed changed nothing: it is in the counts and the timeline, but it does not pull a window forward.
  if (e.data?.ok === false && !e.data?.refused) return;
  S.pending = e;
  if (S.revealTimer) return;
  const wait = Math.max(0, REVEAL_MS - (performance.now() - S.lastReveal));
  S.revealTimer = setTimeout(() => {
    S.revealTimer = null;
    const p = S.pending;
    S.pending = null;
    if (!p || (S.mode === "calm" && !(S.following && threadOf(p) === S.following.id))) return;
    S.lastReveal = performance.now();
    reveal(p);
  }, wait);
}

function reveal(e) {
  const app = S.apps.get(e.app);
  const text = lineText(e);
  // A banner when nothing else shows it: people's activity, or a person busy on the desktop (never pull a window
  // from under them), or a phone. Otherwise the window itself comes forward with the card.
  if (!app || !isAiAction(e)) { banner(e, text); return; }
  if (touch() || Date.now() - S.busyAt < BUSY_MS || spot.isOpen()) { banner(e, text); wins.aiHere(app.id); return; }
  const href = S.hasWorld ? recordHref(e) : null;
  const rec = openApp(app.id, href, S.hasWorld ? e.record : null);
  if (!rec) return;
  wins.aiHere(app.id);
  // With a record to show, the app's own cursor (lib/your-ai.js) taps it; otherwise the desktop's goes to the window.
  if (!(S.hasWorld && e.record)) glide(rec.el);
  showCard(app.id, e);
}

/** The AI's cursor glides from the menu bar to the window it is working in, and taps. */
function glide(el) {
  const c = $("cursor");
  const from = $("live").getBoundingClientRect();
  if (!c.classList.contains("on")) {
    c.style.setProperty("--cx", `${from.left + 10}px`);
    c.style.setProperty("--cy", `${from.bottom}px`);
  }
  c.classList.add("on");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const r = el.getBoundingClientRect();
    c.style.setProperty("--cx", `${r.left + r.width * 0.42}px`);
    c.style.setProperty("--cy", `${r.top + Math.min(r.height * 0.35, 220)}px`);
  }));
  clearTimeout(c._t);
  setTimeout(() => { c.classList.remove("tap"); void c.offsetWidth; c.classList.add("tap"); }, 720);
  c._t = setTimeout(() => c.classList.remove("on", "tap"), 3000);
}

/** What the AI did, on the window it did it in. */
function showCard(appId, e) {
  const rec = wins.get(appId);
  if (!rec) return;
  const body = rec.el.querySelector(".win-body");
  body.querySelector(".win-card")?.remove();
  const p = said(e);
  const card = document.createElement("div");
  card.className = `win-card${p.refused ? " is-refused" : ""}`;
  const t = e.sim_time ? e.sim_time.slice(11, 16) : "";
  card.innerHTML = `<div class="k">${aiBadge()}<time>${esc(t)}</time></div><p>${p.text}</p>${p.quote ? `<q>${esc(p.quote.slice(0, 280))}</q>` : ""}`;
  if (!isAiAction(e)) card.querySelector(".yai-badge")?.replaceWith(Object.assign(document.createElement("span"), { textContent: actionOf(e) }));
  body.append(card);
  clearTimeout(rec.el._card);
  rec.el._card = setTimeout(() => { card.classList.add("is-leaving"); setTimeout(() => card.remove(), 300); }, 6000);
}

const cap = (html) => html.replace(/^([a-z])/, (m) => m.toUpperCase());

/** One event as plain words. */
function lineText(e) {
  const where = S.apps.get(e.app) ? ` in ${S.apps.get(e.app).name}` : "";
  if (e.type === "activity") return `${actionOf(e)}${where}`;
  if (e.type === "product.acted" && e.data?.ok !== false && !e.data?.refused) return `${didWords(e.data?.tool)}${where}`;
  return nowLine(e, S.apps.get(e.app)?.name) || e.summary || actionOf(e);
}

/**
 * What happened, as HTML for a card, banner or line: the shared words for the AI's calls (lib/your-ai.js), the
 * run's own phrases (lib/live.js) for everything else.
 */
function said(e) {
  if (e.type === "product.acted" && e.data?.ok !== false && !e.data?.refused) return { text: esc(didWords(e.data?.tool)), quote: "", ai: true };
  const p = e.type === "activity" ? null : phrase(e);
  if (p && !p.divider) return { text: cap(p.text), quote: p.quote || "", ai: Boolean(p.ai), refused: p.refused };
  return { text: esc(lineText(e)), quote: "", ai: isAiAction(e) };
}

/** One event as a panel line: who did it, in bold where it is a name. */
function panelLine(e) {
  if (e.type === "product.acted" && e.data?.ok !== false && !e.data?.refused) return { html: `<span class="ai">Your AI</span> ${esc(didWords(e.data?.tool).toLowerCase())}`, quote: "", ai: true };
  const p = e.type === "activity" ? null : phrase(e);
  if (p && !p.divider) return { html: p.ai ? `<span class="ai">Your AI</span> ${p.text}` : cap(p.text), quote: p.quote || "", ai: Boolean(p.ai) };
  if (e.type === "product.read") return { html: `<span class="ai">Your AI</span> ${esc(lineText(e).replace(/…$/, "").replace(/^./, (c) => c.toLowerCase()))}`, quote: "", ai: true };
  return { html: esc(lineText(e)), quote: "", ai: false };
}

function when(e) {
  const t = e.sim_time || "";
  return t ? `${DAYS[new Date(t).getUTCDay()]} ${t.slice(11, 16)}` : "";
}

function banner(e, text) {
  if (S.mode === "calm" && !(S.following && threadOf(e) === S.following.id)) return;
  const box = $("banners");
  const app = S.apps.get(e.app);
  const b = document.createElement("button");
  b.type = "button";
  b.className = "banner";
  const p = said(e);
  const ai = isAiAction(e) || e.type === "product.read";
  b.innerHTML = `${app ? icon(app, { size: 30 }) : spiral({ size: 30 })}<span><span class="t">${ai ? aiBadge() : `<b>${esc(app?.name || "Overthought & Co.")}</b>`}${ai && app ? `<b>${esc(app.name)}</b>` : ""}<time>${esc(e.sim_time ? e.sim_time.slice(11, 16) : "")}</time></span>
    <p>${p.text || esc(text)}</p>${p.quote ? `<q>${esc(p.quote.slice(0, 120))}</q>` : ""}</span>`;
  b.addEventListener("click", () => { dismiss(b); openEvent(e); });
  box.prepend(b);
  while (box.childElementCount > 3) box.lastElementChild.remove();
  setTimeout(() => dismiss(b), 5200);
}

function dismiss(b) {
  if (!b.isConnected || b.classList.contains("is-leaving")) return;
  b.classList.add("is-leaving");
  setTimeout(() => b.remove(), 280);
}

function onMode(mode) {
  S.mode = mode;
  paintLive();
  if (mode === "calm") {
    for (const b of $("banners").children) dismiss(b);
    clearTimeout(S.revealTimer);
    S.revealTimer = null;
    S.pending = null;
    if (!S.calmPanelDismissed && !panel.isOpen()) panel.open();
  } else {
    S.calmPanelDismissed = false;
  }
}

/** The AI's dot on a dock icon, at most a few times a second per app. */
function pulseDock(app, ai) {
  if (!app) return;
  const now = performance.now();
  if (now - (S.dockPulse.get(app) || 0) < 900) return;
  S.dockPulse.set(app, now);
  if (ai) wins.aiHere(app);
  const b = $("dock").querySelector(`.dock-i[data-app="${CSS.escape(app)}"]`);
  if (!b) return;
  b.classList.add("ai");
  clearTimeout(b._ai);
  b._ai = setTimeout(() => b.classList.remove("ai"), 2600);
}

let liveDrawn = 0;
function paintLive(force = false) {
  const now = performance.now();
  if (!force && now - liveDrawn < 250) return;
  liveDrawn = now;
  const b = $("live");
  const t = $("liveText");
  const r = rate.rate(now);
  const active = S.latest && now - S.latestAt < 8000;
  if (S.mode === "calm") {
    b.dataset.state = "calm";
    t.innerHTML = `<b>Your AI</b> · ${Math.round(r).toLocaleString("en-GB")} a second`;
  } else if (active && S.latest) {
    b.dataset.state = "active";
    t.textContent = lineText(S.latest);
  } else if (S.run === "finished" || (S.run && groups.total)) {
    b.dataset.state = "done";
    t.textContent = `${S.run === "finished" ? "Run finished" : "Quiet"} · ${groups.total.toLocaleString("en-GB")} things`;
  } else {
    b.dataset.state = "idle";
    t.textContent = groups.total ? "Quiet" : "";
  }
  b.title = S.mode === "calm" ? "Your AI is very busy. Open Activity to watch it calmly." : "Activity";
}

// ------------------------------------------------------------------ following one thread

function follow(id, e) {
  if (!id) {
    S.following = null;
  } else {
    const who = timeline.thread(id).map((x) => x.data?.who?.name || x.data?.to?.name).find(Boolean);
    S.following = { id, label: who ? `${who}’s conversation` : plainRef(id) || (e?.record ? plainRef(e.record) : "") || "one thread" };
    // The thread so far, at a readable pace.
    playback.setSpeed(playback.speed === "paused" ? "paused" : "slow");
    panel.setSpeed(playback.speed);
    for (const x of timeline.thread(id).slice(-20)) playback.push(x);
  }
  panel.reset();
  panel.draw(performance.now(), true);
}

// ------------------------------------------------------------------ sources of events

async function startFeed() {
  // A run's live stream (`overthink run --live`), or a finished run (`overthink view`).
  const live = await connectLive({
    onEvent: (e, o) => { take(e, o); if (!o.replay) S.latestAt = performance.now(); },
    onState: (s) => { S.run = s === "running" ? "running" : "finished"; paintLive(true); },
  }).catch(() => null);
  if (live) return;
  // `overthink up`: the sandbox's own record of calls, followed through the client's poll.
  if (!S.hasWorld) return;
  const owner = (await S.world.connectInfo().catch(() => null))?.ownerTokenId || "tok_1";
  const { entries } = await S.world.activity({ since: 0 }).catch(() => ({ entries: [] }));
  for (const t of entries) { const e = fromTrace(t, { owner }); if (e) take(e, { replay: true }); }
  S.world.onChange((c) => {
    if (c.now) setClock(c.now);
    if (c.reset) { timeline.clear(); groups.clear(); panel.reset(); }
    for (const t of c.entries || []) {
      const e = fromTrace(t, { owner });
      if (e) { take(e); S.latestAt = performance.now(); }
    }
    paintLive(true);
  });
}

// ------------------------------------------------------------------ start

let panel = null;
let spot = null;

async function main() {
  ensureStyle();
  $("cursor").className = "yai-cursor";
  $("cursor").innerHTML = CURSOR_HTML;
  const apps = await fetch("../apps.json").then((r) => r.json()).then((j) => j.apps);
  for (const a of apps) S.apps.set(a.id, a);
  // The client adopts the sandbox handed over in the address (#sandbox=…&key=…), before any window asks for one.
  S.world = getClient();
  paintMenuBar();
  paintHome();
  applyTouch();
  matchMedia(TOUCH).addEventListener("change", applyTouch);

  wins = mountWindows({
    desk: $("desk"), snap: $("snap"), apps: S.apps, icon, area, touch,
    dockRect: (app) => $("dock").querySelector(`.dock-i[data-app="${CSS.escape(app)}"]`)?.getBoundingClientRect() || null,
    onFrame: hookFrame,
    onChange: markOpen,
  });
  panel = mountPanel({
    el: $("panel"), apps: S.apps, icon, groups, playback, timeline, line: panelLine, when, open: openEvent, follow,
    status: () => ({ live: S.run === "running" || performance.now() - (S.latestAt || -1e9) < 5000, rate: rate.rate(performance.now()), mode: S.mode, run: S.run, following: S.following }),
    onClose: () => { $("live").setAttribute("aria-expanded", "false"); if (S.mode === "calm") S.calmPanelDismissed = true; },
  });
  spot = mountSpotlight({
    el: $("spot"), world: S.world, apps: S.apps, icon, openApp, openEvent, hasWorld: () => S.hasWorld,
    findAi: (q) => timeline.find(q, 4, (e) => `${lineText(e)} ${e.data?.text || ""}`).map((e) => ({ e, text: lineText(e), sub: when(e) })),
  });

  // The menu bar.
  $("coMenu").addEventListener("click", (e) => (openMenu?.button === e.currentTarget ? closeMenu() : showMenu(e.currentTarget, companyMenu())));
  $("appsMenu").addEventListener("click", (e) => (openMenu?.button === e.currentTarget ? closeMenu() : showMenu(e.currentTarget, appsMenu())));
  $("winMenu").addEventListener("click", (e) => (openMenu?.button === e.currentTarget ? closeMenu() : showMenu(e.currentTarget, windowMenu())));
  for (const id of ["coMenu", "appsMenu", "winMenu"]) $(id).addEventListener("pointerenter", (e) => { if (openMenu && openMenu.button !== e.currentTarget) e.currentTarget.click(); });
  document.addEventListener("pointerdown", (e) => { if (openMenu && !openMenu.m.contains(e.target) && !openMenu.button.contains(e.target)) closeMenu(); });
  $("searchBtn").addEventListener("click", () => spot.open());
  $("live").addEventListener("click", () => { panel.toggle(); $("live").setAttribute("aria-expanded", String(panel.isOpen())); });
  $("dock").addEventListener("click", (e) => {
    const b = e.target.closest(".dock-i");
    if (!b) return;
    const w = wins.wm.get(b.dataset.app);
    // The dock: open it; bring it forward; already in front, minimise it.
    if (w && !w.min && wins.wm.focused() === w && !touch()) wins.wm.minimise(w.app); else openApp(b.dataset.app);
  });
  $("home").addEventListener("click", (e) => { const b = e.target.closest(".home-a"); if (b) openApp(b.dataset.app); });
  document.addEventListener("keydown", (e) => onKey(e));
  document.addEventListener("pointerdown", () => { S.busyAt = Date.now(); }, true);
  addEventListener("resize", () => { wins.resize(); });
  // A record opened from inside an app (lib/your-ai.js): in that app's own window.
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || e.data?.type !== "ot:open") return;
    const m = /^\/apps\/([^/]+)\//.exec(String(e.data.href || ""));
    if (m) openApp(m[1], e.data.href, e.data.reveal || null);
  });

  // Is there a world to look at? `overthink up` and `overthink view` have one; a live run's own server has only events.
  const clock = await S.world.clock().catch(() => null);
  S.hasWorld = Boolean(clock?.now);
  if (clock?.now) setClock(clock.now);
  startYourAi({ world: S.hasWorld ? S.world : null, apps, icon });

  // Windows that were open last time come back (not on a phone: that starts at the home screen).
  if (!touch()) for (const id of wins.wm.restorable().slice(-4)) if (S.apps.has(id)) wins.open(id);
  if (params.get("open")) openApp(params.get("open"));

  await startFeed();
  paintLive(true);
  // One quiet loop: the panel's frames, the menu bar's line, and leaving calm when things slow down.
  setInterval(() => {
    const now = performance.now();
    const mode = modes.update(rate.rate(now), now);
    if (mode !== S.mode) onMode(mode);
    paintLive();
    panel.draw(now);
  }, 250);
}

main().catch((e) => {
  console.error(e);
  $("liveText").textContent = "The sandbox could not be reached";
});
