// The bar on every one of the company's apps: slim and calm, so the app itself is what you look at.
//   left   Rummage's mark (home, the company's search at /) and the open app with its plain word ("Letterbox · Email")
//   right  during a live run, the one line Rummage shows: what your AI is doing now, opening that record;
//          on `overthink view`, the switch between the business with your AI and the same moment without it.
// Setting up, connecting and running tests happen in the terminal or a coding agent, never here.
// Time still moves underneath (an app's own button, an outside AI, a run): the bar tells open screens through
// the "ot:day" event and keeps runDays/play/pause for apps that move time themselves. Styles: lib/bar.css.
import { appIcon } from "./icons.js";
import { connectLive, nowLine } from "./live.js";
import { daysFromTrace } from "./days.js";
import { esc, node, reducedMotion, toast } from "./ui.js";

/** One simulated day this often while an app has asked time to run. */
const DAY_MS = 3200;

/**
 * Puts the bar at the top of the page.
 * @param {{app: object, apps: Array<object>, world: object}} p
 * @return {{runDays: function(number): Promise<void>, play: function(): void, pause: function(): void, busy: function(): boolean, now: function(): ?string}}
 */
export function mountTopBar({ app, apps, world }) {
  const home = apps.find((a) => a.id === "home") || { id: "home", name: "Rummage", plain: "Search", icon: "rummage", accent: "#b5e53a" };
  const isHome = app.id === "home";
  const bar = node(`<header class="sbar">
    <nav class="sbar-left" aria-label="Overthought &amp; Co.">
      <a class="sbar-home" href="/" title="${esc(home.name)}: search the company" aria-label="${esc(home.name)}: search the company">${appIcon(home, { size: 30 })}</a>
      ${isHome ? "" : `<span class="sbar-app">${appIcon(app, { size: 24 })}<b>${esc(app.name)}</b><span class="sbar-plain">${esc(plainName(app))}</span></span>`}
    </nav>
    <div class="sbar-right">
      <a class="sbar-live" hidden></a>
      <span class="sbar-arms" role="group" aria-label="With or without your AI" hidden>
        <button type="button" data-arm="with" aria-pressed="true">Your AI</button>
        <button type="button" data-arm="without" aria-pressed="false">Without your AI</button>
      </span>
    </div>
  </header>`);
  document.body.prepend(bar);
  // Embedded (?embed=1): the page around it has its own frame, so the bar takes no room.
  if (new URLSearchParams(location.search).get("embed") === "1") { bar.hidden = true; document.documentElement.style.setProperty("--sb-h", "0px"); }

  const $ = (s) => bar.querySelector(s);
  const state = { now: null, busy: false, playing: false };

  // ---------------------------------------------------------------- after a run: with or without your AI

  fetch("/view/run", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (!j?.ok) return;
    const view = j.data.view || { seed: 1, arm: "with" };
    const arms = $(".sbar-arms");
    arms.hidden = false;
    for (const b of arms.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.arm === view.arm));
    arms.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-arm]");
      if (!b || b.dataset.arm === view.arm) return;
      // The `ot-view` cookie picks the world on the view server; the tab's sandbox is forgotten so the app asks again.
      document.cookie = `ot-view=${view.seed}.${b.dataset.arm}; path=/; SameSite=Strict`;
      try { sessionStorage.removeItem("ot-sandbox"); } catch { /* storage blocked: the cookie is enough */ }
      const q = new URLSearchParams(location.search);
      q.set("seed", String(view.seed));
      q.set("arm", b.dataset.arm);
      location.search = q.toString();
    });
  }).catch(() => { /* not the view server */ });

  // ---------------------------------------------------------------- during a run: the one live line

  const byId = new Map(apps.map((a) => [a.id, a]));
  connectLive({
    onEvent: (e, { replay }) => {
      if (replay) return;
      const text = nowLine(e, byId.get(e.app)?.name);
      if (!text) return;
      const live = $(".sbar-live");
      live.hidden = false;
      live.href = e.link || (byId.get(e.app) ? `/apps/${e.app}/` : "/?tab=ai");
      live.innerHTML = `<span class="sbar-pip" aria-hidden="true"></span><span class="sbar-live-t">${esc(text)}</span>`;
      live.title = text;
    },
    onState: (s) => { if (s !== "running") $(".sbar-live").hidden = true; },
  }).catch(() => { /* no run on this server */ });

  // ---------------------------------------------------------------- time, underneath

  function announceDay(detail) {
    state.now = detail.now;
    document.dispatchEvent(new CustomEvent("ot:day", { detail }));
  }

  /**
   * Moves the world on, a day per request (a week at a time for long runs), telling open screens after each step.
   * For apps that move time themselves (Control Room); nothing in the bar does.
   * @param {number} total days
   */
  async function runDays(total = 1) {
    if (state.busy) return;
    state.busy = true;
    const step = total > 21 ? 7 : 1;
    const from = state.now;
    const days = [];
    try {
      for (let done = 0; done < total; done += step) {
        const n = Math.min(step, total - done);
        const r = await world.advance(n).catch(() => wait(800).then(() => world.advance(n)));
        days.push(...r.days);
        announceDay({ now: r.now, previousNow: from, days, partial: done + step < total });
        if (total > 1 && step === 1 && !reducedMotion() && !document.hidden) await wait(220);
      }
      world.announce({ now: state.now, previousNow: from, days });
    } catch (e) {
      const far = days.length ? ` after ${days.length === 1 ? "1 day" : `${days.length} days`}` : "";
      toast(e.code === "offline" ? `The business could not be reached. Time stopped${far}.` : `Time stopped${far}. ${e.message}`, { tone: "bad" });
      pause();
    } finally {
      state.busy = false;
    }
  }

  async function loop() {
    while (state.playing) {
      await runDays(1);
      await wait(DAY_MS);
    }
  }

  function play() {
    if (state.playing) return;
    state.playing = true;
    loop();
  }

  function pause() {
    state.playing = false;
  }

  // Someone else (an outside AI, another tab, a run) moved the clock: open screens redraw.
  world.onChange((change) => {
    if (change.reset) { state.now = change.now; return; }
    if (change.source !== "poll" || !change.now || change.now === state.now || state.busy) return;
    announceDay({ now: change.now, previousNow: change.previousNow, days: change.entries.flatMap(daysFromTrace), partial: false });
  });
  world.clock().then((c) => { state.now = c.now; }).catch(() => { /* the app shows its own error */ });

  return { runDays, play, pause, busy: () => state.busy, now: () => state.now };
}

// ------------------------------------------------------------------ plain names

/** What each app is, in plain words, for people who do not know what "Kettle" means. apps.json `plain` wins. */
const PLAIN = {
  letterbox: "Email", kettle: "Team chat", squint: "Photos", mutter: "Short posts", "front-desk": "Customer help",
  "daily-overthinker": "News", "control-room": "Time and results", till: "Orders and products", stockroom: "Stock and suppliers",
  tally: "Money", megaphone: "Marketing", rota: "The team", "filing-cabinet": "Documents", home: "Search",
};

/**
 * The plain description of an app ("Email"), from apps.json when it has one.
 * @param {{id: string, plain?: string}} app
 */
export function plainName(app) {
  return app.plain || PLAIN[app.id] || "";
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
