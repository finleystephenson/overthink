// The desktop's windows, drawn: one <section> per open app around an <iframe> of the app (?embed=1, so its own bar
// hides). Dragging, resizing from any edge, snapping to the top (fill) or a side (half), minimising into the dock,
// maximising and closing. The state (where, what order, what to remember) is wm-core.js; this file only draws it
// and turns pointer moves into calls on it.

import { createWindows, MIN_H, MIN_W } from "./wm-core.js";
import { embedded } from "./watch.js";
import { aiBadge } from "../lib/your-ai.js";

const ICONS = {
  min: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
  max: '<svg viewBox="0 0 24 24"><rect x="5.5" y="5.5" width="13" height="13" rx="2.5"/></svg>',
  unmax: '<svg viewBox="0 0 24 24"><path d="M8.5 5.5h8a2 2 0 0 1 2 2v8"/><rect x="5.5" y="8.5" width="10" height="10" rx="2.2"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Draws the windows.
 * @param {{desk: HTMLElement, snap: HTMLElement, apps: Map<string, object>, icon: function(object, object): string,
 *   area: function(): object, dockRect: function(string): ?DOMRect, touch: function(): boolean,
 *   onFrame: function(string, HTMLIFrameElement): void, onChange: function(): void}} o
 */
export function mountWindows(o) {
  const wm = createWindows({ storage: safeLocal(), area: o.area() });
  const els = new Map();  // app -> { el, frame }

  function build(w) {
    const app = o.apps.get(w.app) || { id: w.app, name: w.app, plain: "", icon: "filing", accent: "#888" };
    const el = document.createElement("section");
    el.className = "win is-opening";
    el.dataset.app = w.app;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", `${app.name}${app.plain ? ` · ${app.plain}` : ""}`);
    el.innerHTML = `<header class="win-bar">
        <button class="win-back" type="button" data-act="home" aria-label="Back to the home screen">${ICONS.back}<span>Home</span></button>
        <span class="win-id">${o.icon(app, { size: 18 })}<b>${esc(app.name)}</b>${app.plain ? `<span class="plain">${esc(app.plain)}</span>` : ""}</span>
        <span class="win-ai" title="Your AI is working here">${aiBadge()}</span>
        <span class="win-ctl">
          <button type="button" data-act="min" aria-label="Minimise" title="Minimise">${ICONS.min}</button>
          <button type="button" data-act="max" aria-label="Fill the screen" title="Fill the screen">${ICONS.max}</button>
          <button type="button" data-act="close" aria-label="Close" title="Close">${ICONS.close}</button>
        </span>
      </header>
      <div class="win-body">
        <div class="win-load">${o.icon(app, { size: 44 })}</div>
        <iframe title="${esc(app.name)}" allow="clipboard-write"></iframe>
        <div class="win-shield"></div>
        <div class="edge" aria-hidden="true"></div>
        <div class="home-bar" aria-hidden="true"></div>
      </div>
      ${["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((d) => `<div class="rz rz-${d}" data-rz="${d}"></div>`).join("")}`;
    const frame = el.querySelector("iframe");
    frame.addEventListener("load", () => {
      el.classList.add("is-loaded");
      o.onFrame(w.app, frame);
    });
    frame.src = embedded(w.url || defaultUrl(app));
    el.addEventListener("animationend", () => el.classList.remove("is-opening"), { once: true });
    wire(el, w.app);
    o.desk.append(el);
    els.set(w.app, { el, frame });
    return els.get(w.app);
  }

  function defaultUrl(app) {
    return app.status === "soon" ? `/apps/soon/?app=${encodeURIComponent(app.id)}` : `/apps/${app.id}/`;
  }

  /** Puts every window where the state says, in its order. */
  function paint() {
    const area = wm.area();
    const front = wm.focused();
    for (const w of wm.list()) {
      const rec = els.get(w.app) || build(w);
      const { el } = rec;
      const r = w.max ? { x: 0, y: area.top, w: area.w, h: area.bottom - area.top } : w;
      el.style.left = `${r.x}px`;
      el.style.top = `${r.y}px`;
      el.style.width = `${r.w}px`;
      el.style.height = `${r.h}px`;
      el.style.zIndex = String(w.z);
      el.classList.toggle("is-max", w.max);
      el.classList.toggle("is-front", w === front);
      el.classList.toggle("is-min", w.min);
      el.hidden = w.min && !el.classList.contains("is-minimising");
      el.querySelector('[data-act="max"]').innerHTML = w.max ? ICONS.unmax : ICONS.max;
    }
    o.onChange();
  }

  wm.onChange((what, w) => {
    if (what === "close") {
      const rec = els.get(w.app);
      els.delete(w.app);
      if (rec) {
        rec.el.classList.add("is-closing");
        setTimeout(() => rec.el.remove(), 160);
      }
    }
    if (what === "minimise") genie(w, true);
    if (what === "focus" && els.get(w.app)?.el.hidden) genie(w, false);
    if (what === "max") animate(w.app);
    paint();
  });

  /** Minimising shrinks the window into its dock icon; bringing it back grows it out again. */
  function genie(w, down) {
    const rec = els.get(w.app);
    const dock = o.dockRect(w.app);
    if (!rec || !dock || o.touch() || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const { el } = rec;
    const r = el.getBoundingClientRect();
    const dx = dock.left + dock.width / 2 - (r.left + r.width / 2);
    const dy = dock.top + dock.height / 2 - (r.top + r.height / 2);
    const s = Math.max(0.05, dock.width / r.width);
    const away = `translate(${dx}px, ${dy}px) scale(${s})`;
    el.hidden = false;
    if (down) {
      el.classList.add("is-minimising");
      el.style.transform = "none";
      requestAnimationFrame(() => { el.style.transform = away; el.style.opacity = "0"; });
      setTimeout(() => { el.classList.remove("is-minimising"); el.style.transform = ""; el.style.opacity = ""; el.hidden = wm.get(w.app)?.min ?? true; }, 280);
    } else {
      el.style.transform = away;
      el.style.opacity = "0";
      el.classList.add("is-restoring");
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transform = ""; el.style.opacity = ""; }));
      setTimeout(() => el.classList.remove("is-restoring"), 300);
    }
  }

  function animate(app) {
    const el = els.get(app)?.el;
    if (!el || o.touch()) return;
    el.classList.add("is-animating");
    setTimeout(() => el.classList.remove("is-animating"), 240);
  }

  // ---------------------------------------------------------------- pointer: move, resize, snap

  function wire(el, app) {
    el.addEventListener("pointerdown", () => { if (wm.focused()?.app !== app) wm.focus(app); }, true);
    el.querySelector(".win-ctl").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-act]");
      if (!b) return;
      if (b.dataset.act === "close") wm.close(app);
      if (b.dataset.act === "min") wm.minimise(app);
      if (b.dataset.act === "max") wm.toggleMax(app);
    });
    el.querySelector(".win-back").addEventListener("click", () => wm.minimise(app));
    const bar = el.querySelector(".win-bar");
    bar.addEventListener("dblclick", (e) => { if (!e.target.closest("button")) wm.toggleMax(app); });
    bar.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button") || o.touch()) return;
      drag(e, app, "move");
    });
    for (const h of el.querySelectorAll("[data-rz]")) h.addEventListener("pointerdown", (e) => { if (e.button === 0) drag(e, app, h.dataset.rz); });
    // Touch: swipe in from the left edge, or up from the bottom bar, to go back to the home screen.
    swipe(el.querySelector(".edge"), (dx, dy) => dx > 70 && Math.abs(dy) < 80, () => wm.minimise(app));
    swipe(el.querySelector(".home-bar"), (dx, dy) => dy < -40, () => wm.minimise(app));
  }

  function swipe(zone, done, then) {
    let start = null;
    zone.addEventListener("pointerdown", (e) => { start = { x: e.clientX, y: e.clientY }; zone.setPointerCapture(e.pointerId); });
    zone.addEventListener("pointerup", (e) => {
      if (start && done(e.clientX - start.x, e.clientY - start.y)) then();
      start = null;
    });
    zone.addEventListener("pointercancel", () => { start = null; });
    zone.addEventListener("click", () => { if (zone.classList.contains("home-bar")) then(); });
  }

  function drag(e, app, how) {
    e.preventDefault();
    const w = wm.get(app);
    if (!w) return;
    const area = wm.area();
    const start = { x: e.clientX, y: e.clientY };
    let base = { x: w.x, y: w.y, w: w.w, h: w.h };
    let wasMax = w.max;
    let snapTo = null;
    let moved = false;
    document.body.classList.add("is-dragging");
    document.body.style.cursor = how === "move" ? "default" : getComputedStyle(e.target).cursor;
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) < 3) return;
      moved = true;
      if (how === "move") {
        // A filled window dragged by its bar comes back to its own size, under the pointer where it was held.
        if (wasMax) {
          wasMax = false;
          base = { ...base, x: ev.clientX - base.w * (start.x / area.w), y: area.top };
          start.x = ev.clientX;
          start.y = ev.clientY;
        }
        wm.setRect(app, { x: base.x + ev.clientX - start.x, y: base.y + ev.clientY - start.y, w: base.w, h: base.h }, { persist: false });
        snapTo = snapFor(ev.clientX, ev.clientY, area);
        showSnap(snapTo);
        return;
      }
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      const r = { ...base };
      if (how.includes("e")) r.w = Math.max(MIN_W, base.w + dx);
      if (how.includes("s")) r.h = Math.max(MIN_H, base.h + dy);
      if (how.includes("w")) { r.w = Math.max(MIN_W, base.w - dx); r.x = base.x + base.w - r.w; }
      if (how.includes("n")) { r.h = Math.max(MIN_H, base.h - dy); r.y = Math.max(area.top, base.y + base.h - r.h); r.h = base.y + base.h - r.y; }
      wm.setRect(app, r, { persist: false });
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.body.classList.remove("is-dragging");
      document.body.style.cursor = "";
      showSnap(null);
      const now = wm.get(app);
      if (!now) return;
      if (snapTo === "max") { wm.setRect(app, { ...now }, { persist: false }); wm.toggleMax(app); return; }
      if (snapTo) { animate(app); wm.setRect(app, snapTo); return; }
      if (moved) wm.setRect(app, { ...now });
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  }

  /** Let go at the top: fill the screen. At a side: that half. */
  function snapFor(x, y, area) {
    const h = area.bottom - area.top;
    if (y <= area.top + 2) return "max";
    if (x <= 2) return { x: 0, y: area.top, w: Math.round(area.w / 2), h };
    if (x >= area.w - 3) return { x: Math.round(area.w / 2), y: area.top, w: Math.round(area.w / 2), h };
    return null;
  }

  function showSnap(s) {
    const area = wm.area();
    const r = s === "max" ? { x: 0, y: area.top, w: area.w, h: area.bottom - area.top } : s;
    o.snap.classList.toggle("on", Boolean(r));
    if (!r) return;
    Object.assign(o.snap.style, { left: `${r.x + 6}px`, top: `${r.y + 6}px`, width: `${r.w - 12}px`, height: `${r.h - 12}px` });
  }

  // ---------------------------------------------------------------- the rest of the page asks

  return {
    wm,
    /**
     * Opens an app's window (or brings it forward). With `href`, the window goes to that page of the app; the same
     * page already showing is not reloaded.
     */
    open(app, href = null) {
      const had = wm.get(app);
      const url = href ? embedded(href) : null;
      wm.open(app, url ? { url } : {});
      const rec = els.get(app);
      if (!rec) return null;
      rec.reloaded = !had;
      if (had && url) {
        // Where the app is now (it may have moved itself), against where it should go.
        let now;
        try { now = new URL(rec.frame.contentWindow.location.href); } catch { now = new URL(rec.frame.src, location.href); }
        const want = new URL(url, location.href);
        if (now.pathname + now.search !== want.pathname + want.search) {
          rec.el.classList.remove("is-loaded");
          rec.frame.src = url;
          rec.reloaded = true;
        } else if (now.hash !== want.hash) {
          try { rec.frame.contentWindow.location.hash = want.hash; } catch { rec.frame.src = url; }
        }
      }
      return rec;
    },
    get: (app) => els.get(app) || null,
    paint,
    /** The screen changed size. */
    resize() {
      wm.setArea(o.area());
    },
    /** Marks a window as the place the AI is working, for a while. */
    aiHere(app, ms = 6000) {
      const el = els.get(app)?.el;
      if (!el) return;
      el.classList.add("has-ai");
      clearTimeout(el._ai);
      el._ai = setTimeout(() => el.classList.remove("has-ai"), ms);
    },
    /** Arranges the open windows in a neat cascade, front last. */
    cascade() {
      const area = wm.area();
      const v = wm.list().filter((w) => !w.min);
      v.forEach((w, i) => {
        const ww = Math.min(1100, Math.round(area.w * 0.66)), hh = Math.min(760, Math.round((area.bottom - area.top) * 0.74));
        wm.setRect(w.app, { x: 60 + i * 32, y: area.top + 18 + i * 32, w: ww, h: hh });
        animate(w.app);
      });
    },
  };
}

/** localStorage, or null where reading it throws (blocked storage). */
function safeLocal() {
  try {
    const s = globalThis.localStorage;
    s.getItem("ot-probe");
    return s;
  } catch {
    return null;
  }
}
