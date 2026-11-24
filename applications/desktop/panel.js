// The activity panel: the calm way to watch an AI that is doing hundreds of things a second. It slides out from the
// menu bar (a sheet from the bottom on a phone) and never redraws faster than four times a second, however fast the
// events come. Top to bottom: what is happening (live, slow, paused), running counts per app and per action, the
// stream of lines at the chosen speed, and the timeline to step back through and open any moment.

import { appOf, threadOf } from "./watch.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (n) => Math.round(n).toLocaleString("en-GB");
const STREAM_MAX = 60;
const FRAME_MS = 250;

/**
 * @param {{el: HTMLElement, apps: Map<string, object>, icon: function(object, object): string,
 *   groups: object, playback: object, timeline: object, line: function(object): {html: string, quote: string, ai: boolean},
 *   when: function(object): string, open: function(object): void, follow: function(?string, ?object): void,
 *   status: function(): {live: boolean, rate: number, mode: string, run: ?string, following: ?object},
 *   onClose: function(): void}} o
 */
export function mountPanel(o) {
  const el = o.el;
  el.innerHTML = `<header class="p-head">
      <h2>Activity</h2>
      <span class="state" id="pState"><i></i><span></span></span>
      <button class="p-close" type="button" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg></button>
    </header>
    <div class="p-bar">
      <span class="seg" role="group" aria-label="Speed">
        <button type="button" data-speed="live" aria-pressed="true">Live</button>
        <button type="button" data-speed="slow" aria-pressed="false">Slow</button>
        <button type="button" data-speed="paused" aria-pressed="false">Paused</button>
      </span>
      <span class="p-wait mono" id="pWait"></span>
    </div>
    <div class="p-follow" id="pFollow" hidden></div>
    <div class="p-scroll" id="pScroll">
      <div class="p-sec-h"><span>By app</span><span class="mono" id="pTotal"></span></div>
      <ul class="counts" id="pCounts"></ul>
      <div class="p-sec-h"><span id="pStreamH">As it happens</span><span></span></div>
      <ul class="stream" id="pStream"></ul>
    </div>
    <section class="tl" aria-label="Timeline">
      <div class="tl-top">
        <button type="button" data-step="-1" aria-label="One step back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
        <button type="button" data-step="1" aria-label="One step on"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
        <span id="tlPos" class="mono"></span>
        <span class="now"><button type="button" class="live-btn" id="tlLive" hidden>Back to now</button></span>
      </div>
      <div class="tl-strip"><canvas id="tlCanvas"></canvas><div class="tl-head" id="tlHead"></div>
        <input type="range" id="tlRange" min="0" max="0" value="0" step="1" aria-label="Step back through what happened"></div>
      <div class="tl-at" id="tlAt"></div>
    </section>`;
  const $ = (id) => el.querySelector(`#${id}`);
  const ui = { open: false, expanded: new Set(), sel: null, scrub: null, lastDraw: 0, lastBins: 0, lineEls: [] };

  el.querySelector(".p-close").addEventListener("click", () => close());
  el.querySelector(".seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-speed]");
    if (!b) return;
    o.playback.setSpeed(b.dataset.speed);
    for (const x of el.querySelectorAll("[data-speed]")) x.setAttribute("aria-pressed", String(x === b));
    draw(performance.now(), true);
  });
  $("pCounts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-app]");
    if (!b) return;
    const a = b.dataset.app;
    if (ui.expanded.has(a)) ui.expanded.delete(a); else ui.expanded.add(a);
    drawCounts();
  });
  $("pStream").addEventListener("click", (e) => onLineClick(e, $("pStream")));
  $("tlAt").addEventListener("click", (e) => onLineClick(e, $("tlAt")));
  $("pFollow").addEventListener("click", (e) => { if (e.target.closest("button")) o.follow(null, null); });

  function onLineClick(e, list) {
    const act = e.target.closest("[data-do]");
    const li = e.target.closest("[data-i]");
    if (!li) return;
    const ev = li._e;
    if (act?.dataset.do === "open") return o.open(ev);
    if (act?.dataset.do === "follow") return o.follow(threadOf(ev), ev);
    // A line opens its actions underneath; again closes them.
    const was = li.classList.contains("is-sel");
    for (const x of list.querySelectorAll(".is-sel")) { x.classList.remove("is-sel"); x.querySelector(".line-acts")?.remove(); }
    if (was) return;
    li.classList.add("is-sel");
    const acts = document.createElement("div");
    acts.className = "line-acts";
    const app = o.apps.get(ev.app);
    acts.innerHTML = `${app ? `<button type="button" class="primary" data-do="open">Open in ${esc(app.name)}</button>` : ""}${threadOf(ev) ? '<button type="button" data-do="follow">Follow this thread</button>' : ""}`;
    li.querySelector(".tx").append(acts);
  }

  // ---------------------------------------------------------------- timeline: scrub and step

  const range = $("tlRange");
  range.addEventListener("input", () => scrubTo(Number(range.value)));
  el.querySelector(".tl-top").addEventListener("click", (e) => {
    const b = e.target.closest("[data-step]");
    if (!b || !o.timeline.size) return;
    const at = ui.scrub ?? o.timeline.size - 1;
    scrubTo(Math.max(0, Math.min(o.timeline.size - 1, at + Number(b.dataset.step))));
  });
  $("tlLive").addEventListener("click", () => { ui.scrub = null; drawTimeline(true); });
  el.addEventListener("keydown", (e) => {
    if (e.target === range) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); el.querySelector(`[data-step="${e.key === "ArrowLeft" ? -1 : 1}"]`).click(); }
  });

  function scrubTo(i) {
    ui.scrub = i;
    drawTimeline(true);
  }

  function drawTimeline(force = false) {
    const tl = o.timeline;
    const n = tl.size;
    range.max = String(Math.max(0, n - 1));
    const i = ui.scrub ?? Math.max(0, n - 1);
    range.value = String(i);
    $("tlLive").hidden = ui.scrub == null;
    $("tlPos").textContent = n ? `${fmt(i + 1)} of ${fmt(n + tl.dropped)}` : "Nothing yet";
    const pct = n > 1 ? (i / (n - 1)) * 100 : 100;
    $("tlHead").style.left = `${pct}%`;
    // The density strip: redrawn when the count has grown by a tenth, or on a forced draw.
    if (force || n !== ui.lastBins) { ui.lastBins = n; paintStrip(); }
    const e = tl.get(i);
    const at = $("tlAt");
    if (!e) { at.innerHTML = ""; return; }
    if (at.firstElementChild?._e !== e) {
      at.innerHTML = "";
      at.append(lineEl(e, i, false));
    }
  }

  function paintStrip() {
    const c = $("tlCanvas");
    const w = c.clientWidth, h = c.clientHeight;
    if (!w) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // WHY index slices, not time: the scrubber moves by event, so the strip must match it under the thumb.
    const n = o.timeline.size;
    const bars = Math.max(1, Math.floor(w / 3));
    const counts = new Array(bars).fill(0);
    const ai = new Array(bars).fill(0);
    if (n) {
      const step = Math.max(1, Math.floor(n / 4000));  // sample a long timeline
      for (let k = 0; k < n; k += step) {
        const e = o.timeline.get(k);
        const b = Math.min(bars - 1, Math.floor((k / n) * bars));
        const t = o.timeline.timeAt(k);
        const prev = k ? o.timeline.timeAt(Math.max(0, k - step)) : t;
        counts[b] += 1 / Math.max(1, t - prev + 1);  // denser where events came close together
        if (e.type?.startsWith("product.")) ai[b]++;
      }
    }
    const peak = Math.max(...counts, 1e-9);
    const ink = getComputedStyle(el).getPropertyValue("--x-ink-3").trim() || "#6C7893";
    const spark = getComputedStyle(el).getPropertyValue("--x-spark").trim() || "#FF653C";
    for (let b = 0; b < bars; b++) {
      if (!counts[b] && !ai[b]) continue;
      const v = Math.max(0.12, Math.sqrt(counts[b] / peak));
      const bh = Math.max(2, v * (h - 6));
      ctx.fillStyle = ai[b] ? spark : ink;
      ctx.globalAlpha = ai[b] ? 0.85 : 0.45;
      ctx.fillRect(b * 3, h - bh, 2, bh);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- counts and the stream

  function drawCounts() {
    const apps = o.groups.apps();
    const peak = apps[0]?.count || 1;
    $("pTotal").textContent = o.groups.total ? fmt(o.groups.total) : "";
    $("pCounts").innerHTML = apps.length ? apps.slice(0, 16).map((g) => {
      const app = o.apps.get(g.app);
      const top = o.groups.actions(g.app).slice(0, 2).map((a) => a.action).join(", ");
      const open = ui.expanded.has(g.app);
      return `<li><button type="button" class="count${g.ai ? " ai" : ""}" data-app="${esc(g.app)}" aria-expanded="${open}">
          ${app ? o.icon(app, { size: 26 }) : '<span style="width:26px"></span>'}
          <span class="nm"><b>${esc(app?.name || "Elsewhere")}</b><small>${esc(top)}</small></span>
          <span class="n">${fmt(g.count)}</span><span class="bar"><i style="--w:${((g.count / peak) * 100).toFixed(1)}%"></i></span></button>
        ${open ? `<ul class="acts">${o.groups.actions(g.app).slice(0, 8).map((a) => `<li class="${a.who === "ai" ? "ai" : ""}"><span>${esc(a.action)}</span><span class="n">${fmt(a.count)}</span></li>`).join("")}</ul>` : ""}</li>`;
    }).join("") : `<li class="p-empty">Nothing has happened yet. When your AI starts work, everything it does is counted here.</li>`;
  }

  function lineEl(e, i, fresh) {
    const li = document.createElement("li");
    li.className = `line${fresh ? " new" : ""}`;
    li.dataset.i = String(i);
    li._e = e;
    const l = o.line(e);
    const app = o.apps.get(appOf(e));
    li.innerHTML = `${app ? o.icon(app, { size: 22 }) : '<span></span>'}<span class="tx">${l.html}${l.quote ? `<q>${esc(l.quote.slice(0, 160))}</q>` : ""}<small>${esc(o.when(e))}${app ? ` · ${esc(app.name)}` : ""}</small></span>`;
    li.setAttribute("role", "button");
    li.tabIndex = 0;
    return li;
  }

  let streamSeq = 0;
  function drawStream(show) {
    const list = $("pStream");
    if (!show.length) return;
    const frag = document.createDocumentFragment();
    // Newest first; a fast burst only ever draws the last few of each frame.
    for (const e of show.slice(-12).reverse()) frag.append(lineEl(e, streamSeq++, true));
    list.prepend(frag);
    while (list.childElementCount > STREAM_MAX) list.lastElementChild.remove();
  }

  // ---------------------------------------------------------------- one frame

  function draw(now, force = false) {
    if (!ui.open) return;
    if (!force && now - ui.lastDraw < FRAME_MS) return;
    ui.lastDraw = now;
    const s = o.status();
    const st = $("pState");
    st.classList.toggle("live", s.live);
    st.lastElementChild.textContent = s.live
      ? (s.rate >= 1 ? `Live · ${fmt(s.rate)} a second` : "Live")
      : s.run === "finished" ? "The run has finished" : o.groups.total ? "Quiet now" : "Nothing running";
    const { show, waiting } = o.playback.take(now);
    $("pWait").textContent = o.playback.speed === "live" ? "" : waiting ? `${fmt(waiting)} waiting` : "";
    if (show.length) drawStream(show);
    else if (!$("pStream").childElementCount) $("pStream").innerHTML = "";
    drawCounts();
    const f = s.following;
    $("pFollow").hidden = !f;
    if (f) $("pFollow").innerHTML = `<span>Following <b>${esc(f.label)}</b></span><button type="button">Stop</button>`;
    $("pStreamH").textContent = f ? "This thread" : "As it happens";
    drawTimeline();
  }

  function open() {
    if (ui.open) return;
    ui.open = true;
    el.hidden = false;
    el.classList.remove("is-leaving");
    // Draw what has already happened: the newest lines from the timeline.
    $("pStream").innerHTML = "";
    const n = o.timeline.size;
    const recent = [];
    for (let i = n - 1; i >= 0 && recent.length < 30; i--) {
      const e = o.timeline.get(i);
      if (o.status().following && threadOf(e) !== o.status().following.id) continue;
      recent.push(e);
    }
    for (const e of recent.reverse()) $("pStream").prepend(lineEl(e, streamSeq++, false));
    draw(performance.now(), true);
    paintStrip();
    el.querySelector('[data-speed][aria-pressed="true"]')?.focus({ preventScroll: true });
  }

  function close() {
    if (!ui.open) return;
    ui.open = false;
    el.classList.add("is-leaving");
    setTimeout(() => { if (!ui.open) el.hidden = true; }, 220);
    o.onClose();
  }

  return {
    open, close,
    toggle: () => (ui.open ? close() : open()),
    isOpen: () => ui.open,
    draw,
    /** Starts the stream again (after following a thread, or stopping). */
    reset() { $("pStream").innerHTML = ""; if (ui.open) { ui.open = false; open(); } },
    setSpeed(s) { el.querySelector(`[data-speed="${s}"]`)?.click(); },
  };
}
