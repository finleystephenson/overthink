// Search from anywhere on the desktop (Ctrl/Cmd K, or Ctrl/Cmd Space): the company's apps, what your AI did, and
// everything Rummage searches (people, orders, email, chats, posts, reviews, documents, news), each result opening
// in its own app's window. The searching itself is Rummage's (applications/home/sources.js), so both always agree.

import { makeSources } from "../home/sources.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const KINDS = [["people", "People"], ["orders", "Orders"], ["email", "Email"], ["chat", "Conversations"], ["posts", "Posts"],
  ["reviews", "Reviews"], ["docs", "Documents"], ["news", "News"], ["products", "Products"]];
const TYPE_MS = 140;
const PER_KIND = 4;

/**
 * @param {{el: HTMLElement, world: object, apps: Map<string, object>, icon: function(object, object): string,
 *   findAi: function(string): Array<{e: object, text: string, sub: string}>, openApp: function(string, ?string): void,
 *   openEvent: function(object): void, hasWorld: function(): boolean}} o
 */
export function mountSpotlight(o) {
  const sources = makeSources(o.world);
  const el = o.el;
  el.innerHTML = `<div class="spot-box" role="dialog" aria-modal="true" aria-label="Search">
      <label class="spot-f"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>
        <input id="spotQ" type="search" autocomplete="off" spellcheck="false" placeholder="Search apps, customers, orders, emails…"
          role="combobox" aria-expanded="true" aria-controls="spotR" aria-autocomplete="list"><kbd>esc</kbd></label>
      <div class="spot-r" id="spotR" role="listbox"></div>
      <div class="spot-foot"><span>↑↓ move</span><span>↵ open</span><span id="spotHint"></span></div>
    </div>`;
  const input = el.querySelector("#spotQ");
  const list = el.querySelector("#spotR");
  let rows = [];
  let sel = 0;
  let timer = null;
  let asked = 0;
  let opener = null;

  el.addEventListener("pointerdown", (e) => { if (e.target === el) close(); });
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, TYPE_MS); paintLocal(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!rows.length) return;
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      mark();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows[sel]) choose(rows[sel]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-r]");
    if (b) choose(rows[Number(b.dataset.r)]);
  });
  list.addEventListener("pointermove", (e) => {
    const b = e.target.closest("[data-r]");
    if (b && Number(b.dataset.r) !== sel) { sel = Number(b.dataset.r); mark(); }
  });

  /** The apps and your AI's actions answer at once; the company's records follow. */
  function local(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const apps = [...o.apps.values()].filter((a) => words.every((w) => `${a.name} ${a.plain} ${a.description}`.toLowerCase().includes(w)))
      .slice(0, q ? 5 : 8).map((a) => ({ group: "Apps", kind: "app", app: a.id, title: a.name, snip: a.plain }));
    const ai = q ? o.findAi(q).slice(0, 4).map(({ e, text, sub }) => ({ group: "Your AI", kind: "ai", app: e.app, title: text, snip: sub || "", e })) : [];
    return [...apps, ...ai];
  }

  function paintLocal() {
    const q = input.value.trim();
    rows = [...local(q), ...(q ? [{ group: "", kind: "all", app: "home", title: `Search everything for “${q}”`, snip: "In Rummage" }] : [])];
    sel = 0;
    paint(q && o.hasWorld() ? '<div class="spot-none">Searching the company…</div>' : "");
  }

  async function search() {
    const q = input.value.trim();
    const id = ++asked;
    if (!q || !o.hasWorld()) return paintLocal();
    const groups = await Promise.all(KINDS.map(([k]) => sources[k](q, PER_KIND).catch(() => [])));
    if (id !== asked) return;
    const found = groups.flatMap((g, i) => g.map((r) => ({ ...r, group: KINDS[i][1], kind: "record" })));
    const head = local(q);
    rows = [...head, ...found, { group: "", kind: "all", app: "home", title: `Search everything for “${q}”`, snip: "In Rummage" }];
    sel = Math.min(sel, rows.length - 1);
    paint(found.length || head.length ? "" : `<div class="spot-none">Nothing in the company matches “${esc(q)}”.</div>`);
  }

  function paint(extra = "") {
    let last = null;
    list.innerHTML = rows.map((r, i) => {
      const h = r.group && r.group !== last ? `<div class="spot-h">${esc(r.group)}</div>` : "";
      last = r.group;
      const app = o.apps.get(alias(r.app));
      const ic = r.kind === "ai" ? '<span class="dot"><i></i></span>' : app ? o.icon(app, { size: 28 }) : "<span></span>";
      return `${h}<button type="button" class="spot-i" role="option" data-r="${i}" aria-selected="${i === sel}">${ic}
        <span class="tt"><b>${esc(r.title)}</b>${r.snip ? `<small>${esc(String(r.snip).slice(0, 140))}</small>` : ""}</span>
        <span class="where">${esc(r.kind === "app" ? "Open" : app?.name || "")}</span></button>`;
    }).join("") + extra;
    el.querySelector("#spotHint").textContent = o.hasWorld() ? "Searches like Rummage" : "The run’s own actions; the whole company after it finishes";
  }

  function mark() {
    for (const b of list.querySelectorAll("[data-r]")) b.setAttribute("aria-selected", String(Number(b.dataset.r) === sel));
    list.querySelector(`[data-r="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }

  /** Rummage still calls Files "files" while the app list may say "filing-cabinet" (or the other way round). */
  function alias(id) {
    if (o.apps.has(id)) return id;
    if (id === "files" && o.apps.has("filing-cabinet")) return "filing-cabinet";
    if (id === "filing-cabinet" && o.apps.has("files")) return "files";
    return id;
  }

  function choose(r) {
    close();
    if (r.kind === "app") return o.openApp(r.app, null);
    if (r.kind === "ai") return o.openEvent(r.e);
    if (r.kind === "all") return o.openApp("home", `/apps/home/?q=${encodeURIComponent(input.value.trim())}`);
    // Rummage's links are relative to its own folder (../till/...): make them absolute.
    const href = r.href ? new URL(r.href, `${location.origin}/apps/home/`).pathname + new URL(r.href, `${location.origin}/apps/home/`).search + new URL(r.href, `${location.origin}/apps/home/`).hash : null;
    o.openApp(alias(r.app), href, r.id);
  }

  function open() {
    opener = document.activeElement;
    el.hidden = false;
    input.value = "";
    paintLocal();
    requestAnimationFrame(() => input.focus());
  }

  function close() {
    if (el.hidden) return;
    el.hidden = true;
    clearTimeout(timer);
    asked++;
    if (opener && opener !== document.body) opener.focus?.({ preventScroll: true });
  }

  return { open, close, toggle: () => (el.hidden ? open() : close()), isOpen: () => !el.hidden };
}
