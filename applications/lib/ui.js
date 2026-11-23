// Shared parts for every app: formatting, small pieces of interface, motion, and startApp() which puts the
// top bar on the page and hands the app its client. Pair with ui.css. No framework: functions return HTML
// strings or DOM nodes, and apps put them where they like.
import { getClient } from "./client.js";
import { mountTopBar } from "./topbar.js";

// ------------------------------------------------------------------ text and numbers

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Makes any value safe to put inside HTML. */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

/**
 * A template tag that escapes every value unless it is wrapped in raw(). Arrays are joined.
 * WHY: every bit of text from the world (names, messages) is written by someone else and must not become markup.
 */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return new Raw(out);
}

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

/** Marks a string as already-safe HTML, for html``. */
export function raw(s) {
  return new Raw(s);
}

function part(v) {
  if (v == null || v === false) return "";
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join("");
  return esc(v);
}

const GBP0 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const GBP2 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const N0 = new Intl.NumberFormat("en-GB");

/** £1,234 (whole pounds) with a true minus sign. */
export function money(v) {
  return v == null ? "–" : GBP0.format(Math.round(v)).replace("-£", "−£");
}

/** £1,234.50 */
export function money2(v) {
  return v == null ? "–" : GBP2.format(v).replace("-£", "−£");
}

/** 1,234 */
export function num(v) {
  return v == null ? "–" : N0.format(v);
}

/** "1 order" or "3 orders" */
export function plural(n, one, many = `${one}s`) {
  return `${num(n)} ${n === 1 ? one : many}`;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The parts of a simulated time, read in UTC because the simulated clock is written in UTC.
 * @param {string} iso
 */
export function timeParts(iso) {
  const d = new Date(iso);
  return {
    weekday: DAYS[d.getUTCDay()],
    day: d.getUTCDate(),
    month: MONTHS[d.getUTCMonth()],
    monthShort: MONTHS[d.getUTCMonth()].slice(0, 3),
    year: d.getUTCFullYear(),
    time: iso.slice(11, 16),
  };
}

/** "Tuesday 24 November 2026" */
export function longDate(iso) {
  const p = timeParts(iso);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

/** "24 Nov" */
export function shortDate(iso) {
  const p = timeParts(iso);
  return `${p.day} ${p.monthShort}`;
}

/** Whole days between two simulated times. */
export function daysBetween(a, b) {
  return Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 864e5);
}

/** "issue_refund" becomes "Issue refund". For tool names shown as small print, never as headlines. */
export function words(name) {
  const s = String(name || "").replace(/_/g, " ");
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

// ------------------------------------------------------------------ small parts

const AVATAR_COLOURS = ["#5fc3ec", "#ff7433", "#f45ba6", "#ffc72c", "#b5e53a", "#c9b9f2", "#3fcfb4", "#d9a066"];

/** A steady colour for a name: the same person is always the same colour. */
export function colourFor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
}

/** Initials from a name, skipping titles so "Mr Toad" is "T" and not "MT". */
export function initials(name) {
  const parts = String(name || "?").replace(/^(the|mr|mrs|ms|miss|dr)\s+/i, "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts.at(-1)[0] : "")).toUpperCase();
}

/**
 * A round avatar: initials on the person's colour.
 * @param {string} name
 * @param {{size?: number, ai?: boolean}=} options ai draws a small spark instead of initials
 */
export function avatar(name, { size = 32, ai = false } = {}) {
  const inner = ai
    ? '<svg viewBox="0 0 24 24" width="55%" height="55%" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3"/></svg>'
    : esc(initials(name));
  return `<span class="avatar${ai ? " is-ai" : ""}" style="--av:${ai ? "var(--ink)" : colourFor(name)};--av-size:${size}px" title="${esc(name)}" aria-hidden="true">${inner}</span>`;
}

/** A small rounded label. tone: good, info, warn, bad, neutral, or none. */
export function pill(text, tone = "neutral") {
  return `<span class="pill ${esc(tone)}">${esc(text)}</span>`;
}

/**
 * The look for "nothing here yet": a drawing, one plain sentence and one honest caveat.
 * @param {{title: string, text?: string, art?: string}} p art is trusted HTML (usually an SVG)
 */
export function emptyState({ title, text = "", art = "" }) {
  return `<div class="empty">${art ? `<div class="empty-art">${art}</div>` : ""}<p class="empty-title">${esc(title)}</p>${text ? `<p class="empty-text">${esc(text)}</p>` : ""}</div>`;
}

/** Grey shimmering lines that hold the place of content that is still loading. */
export function skeleton(lines = 3) {
  return `<div class="skel-wrap" aria-hidden="true">${Array.from({ length: lines }, (_, i) => `<span class="skel" style="width:${92 - ((i * 17) % 40)}%"></span>`).join("")}</div>`;
}

/** Turns an HTML string into a DOM node. */
export function node(markup) {
  const t = document.createElement("template");
  t.innerHTML = String(markup).trim();
  return t.content.firstElementChild;
}

// ------------------------------------------------------------------ toasts and the slide-over

/**
 * A short message in the corner that leaves on its own.
 * @param {string} message
 * @param {{tone?: string, ms?: number}=} options
 */
export function toast(message, { tone = "neutral", ms = 3200 } = {}) {
  let stack = document.querySelector(".toasts");
  if (!stack) {
    stack = node('<div class="toasts" role="status" aria-live="polite"></div>');
    document.body.append(stack);
  }
  const t = node(`<div class="toast ${esc(tone)}"><span class="toast-dot"></span><span>${esc(message)}</span></div>`);
  stack.append(t);
  setTimeout(() => {
    t.classList.add("is-leaving");
    t.addEventListener("animationend", () => t.remove(), { once: true });
    if (reducedMotion()) t.remove();
  }, ms);
}

/**
 * A panel that slides in from the right, over the page. Escape or the backdrop closes it.
 * @param {{title: string, body: string|Node, wide?: boolean}} p body is trusted HTML or a node
 * @return {{el: HTMLElement, close: function(): void}}
 */
export function slideOver({ title, body, wide = false }) {
  const wrap = node(`<div class="over" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="over-back"></div>
    <section class="over-panel${wide ? " is-wide" : ""}">
      <header class="over-head"><h2>${esc(title)}</h2><button class="btn icon-only ghost" data-close aria-label="Close">${closeIcon()}</button></header>
      <div class="over-body"></div>
    </section>
  </div>`);
  const content = wrap.querySelector(".over-body");
  if (typeof body === "string") content.innerHTML = body; else content.append(body);
  const opener = document.activeElement;
  function close() {
    wrap.classList.add("is-leaving");
    document.removeEventListener("keydown", onKey);
    const done = () => { wrap.remove(); opener?.focus?.(); };
    if (reducedMotion()) done(); else setTimeout(done, 220);
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  wrap.querySelector(".over-back").addEventListener("click", close);
  wrap.querySelector("[data-close]").addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.append(wrap);
  wrap.querySelector("[data-close]").focus();
  return { el: wrap, close };
}

function closeIcon() {
  return '<svg class="i" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
}

/** Copies text and gives the button a brief "Copied" state. */
export async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard blocked (not a secure page, or no permission): select-and-copy the old way.
    const ta = node("<textarea style=\"position:fixed;opacity:0\"></textarea>");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  if (button) {
    button.classList.add("is-copied");
    setTimeout(() => button.classList.remove("is-copied"), 1600);
  }
}

// ------------------------------------------------------------------ motion

/** True when the person has asked their computer for less movement. */
export function reducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Counts a number up (or down) to a new value, so a change is seen and not just swapped.
 * @param {Element} el the element whose text is the number
 * @param {number} to
 * @param {{format?: function(number): string, ms?: number}=} options
 */
export function countTo(el, to, { format = num, ms = 900 } = {}) {
  if (!el) return;
  const from = Number(el.dataset.value ?? to);
  el.dataset.value = String(to);
  if (reducedMotion() || from === to || !Number.isFinite(from)) {
    el.textContent = format(to);
    return;
  }
  el.classList.add("is-ticking");
  const start = performance.now();
  function frame(t) {
    const k = Math.min(1, (t - start) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = format(from + (to - from) * eased);
    if (k < 1) requestAnimationFrame(frame);
    else { el.textContent = format(to); el.classList.remove("is-ticking"); }
  }
  requestAnimationFrame(frame);
}

/** Plays a CSS animation class once, restarting it if it is already playing. */
export function pulse(el, cls = "is-pulsing") {
  if (!el || reducedMotion()) return;
  el.classList.remove(cls);
  void el.offsetWidth;  // forces the browser to notice the removal, so the animation starts again
  el.classList.add(cls);
  el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
}

/** Fades and lifts children into place one after another, for a screen arriving. */
export function stagger(parent, selector = ":scope > *", gap = 40) {
  if (!parent || reducedMotion()) return;
  parent.querySelectorAll(selector).forEach((el, i) => {
    el.style.setProperty("--delay", `${i * gap}ms`);
    el.classList.add("rise");
  });
}

// ------------------------------------------------------------------ theme

const THEME_KEY = "ot-theme";

/** The theme in use: "light" or "dark". */
export function currentTheme() {
  return document.documentElement.dataset.theme
    || (globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

/** Switches theme and remembers it for every app. */
export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage blocked: only this page changes */ }
}

// ------------------------------------------------------------------ apps

let appsPromise = null;

/** The app list from applications/apps.json. Read once per page. */
export function loadApps() {
  appsPromise ||= fetch(new URL("../apps.json", import.meta.url)).then((r) => r.json()).then((j) => j.apps);
  return appsPromise;
}

/** Whether a colour is dark (by relative luminance), so light things need to go on it. */
export function isDarkColour(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) < 110;
}

/** The address of an app's screen, from any page. "soon" apps go to the placeholder. */
export function appHref(app) {
  const base = new URL("../", import.meta.url);
  // WHY home/ and not the folder above: home is the search engine (applications/home/), the company's front door.
  if (app.id === "home") return new URL("home/", base).href;
  return new URL(app.status === "ready" ? `${app.id}/` : `soon/?app=${encodeURIComponent(app.id)}`, base).href;
}

/**
 * Starts an app: puts the top bar on the page, gives the page its accent colour, and returns the client.
 * @param {{id: string}} p the app's id in apps.json ("home" for the home screen)
 * @return {Promise<{world: ReturnType<typeof getClient>, app: object, apps: Array<object>, bar: object}>}
 */
export async function startApp({ id }) {
  const apps = await loadApps();
  const app = id === "home"
    ? { id: "home", name: "Overthought & Co.", accent: "#1d1e3c", status: "ready" }
    : apps.find((a) => a.id === id) || { id, name: words(id.replace(/^_/, "")), accent: "#1d1e3c", status: "ready" };
  document.documentElement.style.setProperty("--app", app.accent);
  // An ink-coloured app would vanish as a dot on a dark page; it borrows the sky instead.
  if (isDarkColour(app.accent)) document.documentElement.style.setProperty("--app-dot", "var(--sky)");
  const world = getClient();
  const bar = mountTopBar({ app, apps, world });
  return { world, app, apps, bar };
}
