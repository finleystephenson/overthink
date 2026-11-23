// The explorer: the front door to Overthought & Co. One page; the address after # says what is open, so deep links
// and the back button work. The top bar is always there: who this is, the ways in, the search/ask box, the clock.
//
//   #/                  the world, moving, one sentence and three doors
//   #/look              the map at full size, stories to follow, and what is happening now
//   #/e/<kind>/<id>     one thing: a person, organisation, product, order, event, story, staff member, app...
//   #/timeline          five years of history and what happens as time runs
//   #/whatif            describe or pick a change, see the plan, run it against the world left alone
//   #/changed           this world against the same world left alone
//   #/apps, #/apps/<id> the business's own apps, opened in place
//   #/tech              bring your technology
import { world, ex } from "./api.js";
import { esc, money, num, plural, toast } from "../lib/ui.js";
import { SPIRAL_PATH } from "../lib/icons.js";
import { headline, isSame } from "../lib/impact.js";
import { summariseDays } from "../lib/days.js";
import { drawMap } from "./map.js";
import { clean, dateWords, refRow, onMoved, emitMoved, hooks } from "./parts.js";
import { mountAsk } from "./ask.js";
import { renderEntity } from "./entity.js";
import { renderTimeline } from "./timeline.js";
import { renderWhatIf } from "./whatif.js";
import { renderTech } from "./tech.js";
import { renderApps } from "./apps-view.js";
import { renderChanged } from "./changed.js";

const main = document.getElementById("main");

// ------------------------------------------------------------------ the top bar

function mountMark() {
  for (const el of document.querySelectorAll("[data-mark]")) el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SPIRAL_PATH}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
}

const clock = { now: null, busy: false, playing: false, timer: null, el: document.getElementById("clock") };

function paintClock() {
  const c = clock.el;
  c.innerHTML = `
    <span class="xc-date" id="clockDate">${clock.now ? esc(dateWords(clock.now, { weekday: true })) : "…"}</span>
    <button class="xc-btn xc-play" type="button" data-clock="play" aria-label="${clock.playing ? "Pause" : "Play: a day every second or so"}">${clock.playing ? "Pause" : "Play"}</button>
    <button class="xc-btn" type="button" data-clock="1">Day</button>
    <button class="xc-btn" type="button" data-clock="7">Week</button>
    <button class="xc-btn" type="button" data-clock="30">Month</button>
    <a class="xc-impact" id="impactChip" href="#/changed" hidden></a>`;
  c.querySelectorAll("[data-clock]").forEach((b) => b.addEventListener("click", () => {
    const v = b.dataset.clock;
    if (v === "play") return clock.playing ? pause() : play();
    pause();
    advance(Number(v));
  }));
}

async function readClock() {
  try {
    const c = await world.clock();
    clock.now = c.now;
    document.getElementById("clockDate").textContent = dateWords(c.now, { weekday: true });
  } catch (e) {
    document.getElementById("clockDate").textContent = "Not connected";
    toast(e.message || "The world could not be reached.", { tone: "bad" });
  }
}

/** Moves the world on `days` days, then tells every listening view what happened. */
async function advance(days) {
  if (clock.busy) return false;
  clock.busy = true;
  clock.el.classList.add("is-busy");
  const since = clock.now;
  try {
    const r = await world.advance(days);
    clock.now = r.now;
    document.getElementById("clockDate").textContent = dateWords(r.now, { weekday: true });
    const sum = summariseDays(r.days);
    const pick = sum.items.slice(0, 3).map((i) => `${i.format === "money" ? money(i.value) : num(Math.round(i.value))} ${i.label}`).join(", ");
    if (!clock.playing) toast(`${days === 1 ? "A day" : days === 7 ? "A week" : days === 30 ? "A month" : plural(days, "day")} went by${pick ? `: ${pick}` : "."}`);
    emitMoved({ since, now: r.now, days: r.days });
    paintImpact();
    return true;
  } catch (e) {
    toast(e.message || "Time could not move.", { tone: "bad" });
    pause();
    return false;
  } finally {
    clock.busy = false;
    clock.el.classList.remove("is-busy");
  }
}

function play() {
  clock.playing = true;
  paintClock();
  readClockText();
  const tick = async () => {
    if (!clock.playing) return;
    await advance(1);
    if (clock.playing) clock.timer = setTimeout(tick, 1100);
  };
  tick();
}
function pause() {
  if (!clock.playing) return;
  clock.playing = false;
  clearTimeout(clock.timer);
  paintClock();
  readClockText();
  paintImpact();
}
function readClockText() { const d = document.getElementById("clockDate"); if (d && clock.now) d.textContent = dateWords(clock.now, { weekday: true }); }

/** "Against the world left alone": shown once anything this world did differs from the same world left alone. */
async function paintImpact() {
  const chip = document.getElementById("impactChip");
  if (!chip) return;
  try {
    const imp = await world.impact();
    if (!imp.available || !imp.days_compared || isSame(imp)) { chip.hidden = true; return; }
    const h = headline(imp);
    chip.hidden = false;
    chip.className = `xc-impact is-${h.tone}`;
    chip.textContent = `${h.short} against the world left alone`;
  } catch { chip.hidden = true; }
}

// ------------------------------------------------------------------ the views

let current = null;

async function home() {
  main.innerHTML = `
    <section class="home">
      <div class="home-map" id="homeMap" aria-busy="true"></div>
      <div class="home-words">
        <h1 class="home-h"><span>Overthought &amp; Co.</span> A whole business and the world around it, running.</h1>
        <p class="home-sub">Look around, change anything, see what happens.</p>
        <div class="doors">
          <a class="door is-main" href="#/look"><b>Look around</b><span>Follow anyone and anything</span></a>
          <a class="door" href="#/whatif"><b>Try a what-if</b><span>Change something, see why</span></a>
          <a class="door" href="#/tech"><b>Bring your technology</b><span>Connect an AI or any software</span></a>
        </div>
        <p class="home-live" id="homeLive" aria-live="polite"></p>
      </div>
    </section>`;
  const el = document.getElementById("homeMap");
  const graph = await ex("graph");
  el.removeAttribute("aria-busy");
  const map = drawMap(el, graph, { compact: true, onCaption: (p, n) => caption(document.getElementById("homeLive"), p, n) });
  const caught = await ex("pulses", { since: new Date(Date.parse(graph.now) - 864e5).toISOString().replace(".000", "") }).catch(() => []);
  // The last day, replayed once so the picture is moving when you arrive.
  if (caught.length) setTimeout(() => map.pulse(caught.slice(-24), 4000), 500);
  const stop = onMoved(async ({ since }) => map.pulse(await ex("pulses", { since }).catch(() => []), clock.playing ? 1000 : 2600));
  return { destroy() { stop(); map.destroy(); } };
}

/** One line under the map saying the latest real thing that moved, linked to it. */
function caption(el, p, n) {
  if (!el || !p) return;
  const link = p.link ? `<a href="#/e/${encodeURIComponent(p.link.kind)}/${encodeURIComponent(p.link.id)}">${esc(clean(p.text))}</a>` : esc(clean(p.text));
  el.innerHTML = `<span class="pm-dot on" aria-hidden="true"></span><span class="pm-mono">${esc(dateWords(p.at, { year: false }))}</span> ${link}${n > 1 ? ` <span class="pm-mono">and ${num(n - 1)} more</span>` : ""}`;
}

async function look() {
  main.innerHTML = `
    <section class="look">
      <div class="look-map"><div id="lookMap" aria-busy="true"></div><p class="home-live" id="lookLive" aria-live="polite"></p></div>
      <aside class="look-side">
        <h2 class="xh2">Stories to follow</h2>
        <p class="xsub">Picked from the records as they stand now.</p>
        <ul class="xrows" id="starts"><li class="skel-row"></li><li class="skel-row"></li><li class="skel-row"></li></ul>
        <h2 class="xh2 is-gap">Happening now</h2>
        <p class="xsub" id="feedNote">Move the clock on and each thing that happens appears here.</p>
        <ul class="xrows feed" id="feed"></ul>
      </aside>
    </section>`;
  const [graph, starts] = await Promise.all([ex("graph"), ex("starts")]);
  const feed = document.getElementById("feed");
  const map = drawMap(document.getElementById("lookMap"), graph, { onCaption: (p, n) => caption(document.getElementById("lookLive"), p, n) });
  document.getElementById("lookMap").removeAttribute("aria-busy");
  document.getElementById("starts").innerHTML = starts.map((s) => refRow({ kind: s.kind, id: s.id, title: s.title, note: s.text })).join("") || `<li class="xempty">Nothing stands out yet.</li>`;
  const addFeed = (list) => {
    if (!list.length) return;
    document.getElementById("feedNote").hidden = true;
    // Parcels and deliveries come in bursts: one line per carrier per day, so orders and messages are not drowned.
    const groups = new Map();
    for (const p of list) {
      const k = ["dispatch", "delivery", "stock"].includes(p.kind) ? `${p.kind}|${p.at.slice(0, 10)}|${p.from.id}|${p.to.id}` : `${p.at}|${p.text}`;
      const g = groups.get(k);
      if (g) { g.n += 1; g.at = p.at > g.at ? p.at : g.at; } else groups.set(k, { ...p, n: 1 });
    }
    const say = (g) => (g.n < 2 ? g.text : g.kind === "dispatch" ? g.text.replace(/^A parcel/, `${g.n} parcels`) : g.kind === "delivery" ? `${g.n} parcels arrived${/late$/.test(g.text) ? ", some late" : ""}` : `${g.text} (${g.n} deliveries)`);
    const rows = [...groups.values()].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 30)
      .map((g) => refRow({ kind: g.link?.kind || g.from.kind, id: g.link?.id || g.from.id, title: say(g), note: dateWords(g.at, { year: false }) })).join("");
    feed.insertAdjacentHTML("afterbegin", rows);
    while (feed.children.length > 40) feed.lastElementChild.remove();
  };
  const stop = onMoved(async ({ since }) => {
    const list = await ex("pulses", { since }).catch(() => []);
    map.pulse(list, clock.playing ? 1000 : 2600);
    addFeed(list);
  });
  // Actions taken from elsewhere (an app, a connected AI) show in the feed too, linked to what they did.
  const off = world.onChange((ch) => {
    const acts = (ch.entries || []).filter((e) => e.kind === "tool" && e.ok && (e.changes || []).length && e.actor?.session !== "screen");
    if (acts.length) addFeed(acts.map((e) => ({ at: e.sim_time, text: clean(e.changes[0]), from: { kind: "action", id: String(e.seq) }, link: { kind: "action", id: String(e.seq) } })));
  });
  return { destroy() { stop(); off(); map.destroy(); } };
}

const ROUTES = [
  [/^\/?$/, () => home()],
  [/^\/look$/, () => look()],
  [/^\/e\/([a-z]+)\/(.+)$/, ([kind, id]) => renderEntity(main, kind, decodeURIComponent(id))],
  [/^\/timeline$/, (m, q) => renderTimeline(main, q)],
  [/^\/whatif$/, (m, q) => renderWhatIf(main, q)],
  [/^\/changed$/, () => renderChanged(main)],
  [/^\/apps(?:\/([a-z-]+))?$/, ([id]) => renderApps(main, id)],
  [/^\/tech$/, (m, q) => renderTech(main, q)],
];

async function route() {
  const raw = location.hash.replace(/^#/, "");
  const [path, qs] = raw.split("?");
  const q = new URLSearchParams(qs || "");
  current?.destroy?.();
  current = null;
  document.title = "Overthought & Co.";
  window.scrollTo(0, 0);
  for (const a of document.querySelectorAll("[data-nav]")) a.toggleAttribute("aria-current", path.startsWith(`/${a.dataset.nav}`));
  document.body.dataset.view = path.split("/")[1] || "home";
  const hit = ROUTES.find(([re]) => re.test(path));
  if (!hit) { main.innerHTML = `<section class="xpage"><p class="xempty">Nothing here. <a href="#/">Back to the start</a>.</p></section>`; return; }
  try {
    current = await hit[1](path.match(hit[0]).slice(1), q);
  } catch (e) {
    main.innerHTML = `<section class="xpage"><p class="xempty">${esc(e.message || "That could not be opened.")} <a href="#/">Back to the start</a>.</p></section>`;
  }
  // Focus moves to the page for keyboards and screen readers, without a jump.
  if (document.activeElement === document.body || !document.activeElement) main.focus({ preventScroll: true });
}

// ------------------------------------------------------------------ start

Object.assign(hooks, { advance, paintImpact, readClock });
mountMark();
paintClock();
mountAsk(document.getElementById("ask"));
window.addEventListener("hashchange", route);
// Keys that work everywhere: "/" goes to the box (in ask.js); "." moves a day on.
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === ".") { e.preventDefault(); advance(1); }
});
await readClock();
paintImpact();
route();
// Anything else that moves this world (an app in another tab, a connected AI) shows on the clock too.
world.onChange((ch) => {
  if (ch.source === "local") return;
  if (ch.now && ch.now !== clock.now && !clock.busy) {
    const since = clock.now;
    clock.now = ch.now;
    readClockText();
    emitMoved({ since, now: ch.now, days: [] });
    paintImpact();
  }
  if (ch.reset) { readClock(); paintImpact(); }
});
