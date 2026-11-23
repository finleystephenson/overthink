// View mode: added to every app page by `overthink view` (observability/view/server.ts), never by the apps themselves.
// It does three things, before the app's own script asks for its world:
//   1. picks the world: ?seed=3&arm=without in the address bar sets the `ot-view` cookie the server reads, and
//      forgets the sandbox this tab had, so the app opens that seed and arm;
//   2. on the run summary (applications/view/), puts a small bar on the page: which run, a switch to the same moment
//      without the product, and the way back to Rummage (the apps' own top bar has the switch everywhere else);
//   3. badges every record the product created, changed or wrote ("Your AI"), by matching the record ids the server
//      lists at /view/marks against the ids the apps already put in data-* attributes.

const COOKIE = "ot-view";
const SANDBOX_KEY = "ot-sandbox";  // applications/lib/client.js keeps the tab's sandbox here
// The data-* attributes the apps put record ids in (Letterbox threads and emails, Front Desk items, Till orders ...).
const ID_ATTRS = ["data-id", "data-email", "data-thread", "data-order", "data-key", "data-po", "data-msg", "data-open",
  "data-post", "data-reply", "data-ref", "data-doc", "data-row", "data-settle", "data-case", "data-contact"];

function readCookie() {
  const m = /(?:^|;\s*)ot-view=(\d+)\.(without|with)/.exec(document.cookie);
  return m ? { seed: Number(m[1]), arm: m[2] } : null;
}

function writeView(view) {
  document.cookie = `${COOKIE}=${view.seed}.${view.arm}; path=/; SameSite=Strict`;
  try { sessionStorage.removeItem(SANDBOX_KEY); } catch { /* storage blocked: the server still follows the cookie */ }
}

/** The view the address bar asks for, else the one this browser had, else none (the server picks seed one, with). */
function chooseView() {
  const q = new URLSearchParams(location.search);
  const had = readCookie();
  const seed = Number(q.get("seed") || had?.seed || 0);
  const arm = q.get("arm") === "without" ? "without" : q.get("arm") === "with" ? "with" : had?.arm || "with";
  if (!seed) return had;
  const view = { seed, arm };
  if (!had || had.seed !== seed || had.arm !== arm) writeView(view);
  return view;
}

// Synchronous on purpose: the app's module runs next and must already see the right cookie.
const chosen = chooseView();

function switchTo(arm) {
  const view = { seed: chosen?.seed || 1, arm };
  writeView(view);
  const q = new URLSearchParams(location.search);
  q.set("seed", String(view.seed));
  q.set("arm", arm);
  location.search = q.toString();
}

function bar(run, view, count) {
  const el = document.createElement("div");
  el.className = "ot-viewbar";
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", "Finished run");
  const seeds = run.seeds.map((s) => `<option value="${s}"${s === view.seed ? " selected" : ""}>Run ${s}</option>`).join("");
  el.innerHTML = `<a class="ot-home" href="/">Rummage</a>
    <a class="ot-home" href="/apps/view/">Run summary</a>
    <select class="ot-seed" aria-label="Which run">${seeds}</select>
    <span class="ot-switch" role="group" aria-label="With or without your AI">
      <button type="button" data-arm="with" aria-pressed="${view.arm === "with"}">With your AI</button>
      <button type="button" data-arm="without" aria-pressed="${view.arm === "without"}">Without your AI</button>
    </span>
    <span class="ot-count">${view.arm === "with" ? `${count} records by your AI` : "The same moment, without it"}</span>
    <span class="ot-ro">Read-only</span>`;
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-arm]");
    if (b && b.dataset.arm !== view.arm) switchTo(b.dataset.arm);
  });
  el.querySelector(".ot-seed").addEventListener("change", (e) => {
    writeView({ seed: Number(e.target.value), arm: view.arm });
    const q = new URLSearchParams(location.search);
    q.set("seed", e.target.value);
    location.search = q.toString();
  });
  document.body.append(el);
}

const STYLE = `
.ot-viewbar{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:2147483000;display:flex;gap:10px;align-items:center;flex-wrap:wrap;
  padding:8px 12px;border-radius:999px;background:#16172b;color:#f3f1ea;font:500 13px/1.2 Geist,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.25);max-width:calc(100vw - 32px)}
.ot-viewbar a{color:#f3f1ea}.ot-viewbar select{background:#26284a;color:inherit;border:0;border-radius:99px;padding:4px 8px;font:inherit}
.ot-switch{display:inline-flex;background:#26284a;border-radius:99px;padding:2px}
.ot-switch button{border:0;background:none;color:inherit;font:inherit;padding:5px 10px;border-radius:99px;cursor:pointer}
.ot-switch button[aria-pressed="true"]{background:#ff7433;color:#16172b}
.ot-count{opacity:.8}.ot-ro{font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.6}
[data-ot-ai]{position:relative;box-shadow:inset 3px 0 0 #ff7433}
[data-ot-ai]::after{content:attr(data-ot-ai);position:absolute;top:4px;right:6px;z-index:2;pointer-events:none;
  background:#ff7433;color:#16172b;font:600 10px/1 Geist,system-ui,sans-serif;letter-spacing:.04em;padding:3px 6px;border-radius:99px}
@media (max-width:640px){.ot-viewbar{border-radius:16px;bottom:8px}.ot-count{display:none}}`;

/** Badges every element whose data-* id is one the product touched. Cheap: one attribute look-up per element. */
function badge(root, marks) {
  for (const attr of ID_ATTRS) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      // Front Desk keys look like "ct:CT-00012" or "conv:CONV-0041": the id is after the colon.
      const id = el.getAttribute(attr).replace(/^[a-z]+:/, "");
      const m = marks.get(id);
      if (m && !el.hasAttribute("data-ot-ai")) {
        el.setAttribute("data-ot-ai", "Your AI");
        el.title = `Your AI: ${m.map((x) => x.what).join("; ")}`;
      }
    }
  }
}

async function start() {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);
  const [run, marks] = await Promise.all([
    fetch("/view/run").then((r) => r.json()).then((j) => j.data),
    fetch(`/view/marks${chosen ? `?seed=${chosen.seed}&arm=${chosen.arm}` : ""}`).then((r) => r.json()).then((j) => j.data),
  ]);
  const view = { seed: marks.seed, arm: marks.arm };
  const byId = new Map();
  for (const m of marks.marks) byId.set(m.id, [...(byId.get(m.id) || []), m]);
  if (document.readyState === "loading") await new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
  // The apps' own top bar (lib/topbar.js) and Rummage's panel have the switch; only the run summary needs this bar.
  if (location.pathname.startsWith("/apps/view/")) bar(run, view, byId.size);
  if (view.arm !== "with" || !byId.size) return;
  badge(document.body, byId);
  // WHY observe: the apps draw their lists after their reads come back, and redraw on every click.
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; badge(document.body, byId); });
  }).observe(document.body, { childList: true, subtree: true });
}

start().catch((e) => console.warn("overthink view:", e.message));
