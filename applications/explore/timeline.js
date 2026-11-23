// The timeline: five years of history and what happens as time runs. Zoom from years to one day; every item opens
// its own page. A strip of bars shows how busy the shop was (orders); press a bar to zoom into it.
import { esc, num } from "../lib/ui.js";
import { ex, world } from "./api.js";
import { clean, dateWords, hrefFor, onMoved } from "./parts.js";

const ZOOMS = [["all", "Five years"], ["year", "A year"], ["month", "A month"], ["week", "A week"], ["day", "A day"]];
const KIND = { company: "The business", event: "Event", news: "News", campaign: "Campaign", price: "Price", competitor: "Competitor", you: "A change made" };
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => iso(Date.parse(`${d}T00:00:00Z`) + n * 864e5);
const SPAN = { year: 365, month: 30, week: 7, day: 0 };

export async function renderTimeline(main, q) {
  let zoom = q.get("zoom") || "all";
  let at = q.get("at") || null; // the end of the window (a date)
  main.innerHTML = `
    <section class="xpage tl">
      <header class="tl-head">
        <div><h1 class="xh1">Timeline</h1><p class="xsub">What happened, and what happens as time runs. Press anything to open it.</p></div>
        <div class="tl-ctl">
          <div class="seg" role="radiogroup" aria-label="How much time">${ZOOMS.map(([z, w]) => `<button type="button" role="radio" data-zoom="${z}">${w}</button>`).join("")}</div>
          <div class="tl-step"><button class="btn small" type="button" data-step="-1" aria-label="Earlier">←</button><span class="pm-mono" id="tlSpan"></span><button class="btn small" type="button" data-step="1" aria-label="Later">→</button></div>
        </div>
      </header>
      <div class="tl-busy" id="tlBusy" aria-label="Orders over this time"></div>
      <ol class="tl-list" id="tlList"></ol>
    </section>`;

  async function paint() {
    const now = (await world.clock()).now.slice(0, 10);
    const end = zoom === "all" ? now : (at || now);
    const from = zoom === "all" ? null : addDays(end, -SPAN[zoom]);
    const data = await ex("timeline", { from, to: end });
    main.querySelectorAll("[data-zoom]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.zoom === zoom)));
    main.querySelectorAll("[data-step]").forEach((b) => { b.disabled = zoom === "all" || (b.dataset.step === "1" && end >= now); });
    document.getElementById("tlSpan").textContent = data.from === data.to ? dateWords(data.to, { weekday: true }) : `${dateWords(data.from)} to ${dateWords(data.to)}`;
    // How busy: one bar per day, week or month.
    const max = Math.max(1, ...data.orders.map((o) => o.n));
    const word = { day: "day", week: "week of", month: "month" }[data.bucket];
    document.getElementById("tlBusy").innerHTML = data.orders.length ? `<div class="bars">${data.orders.map((o) => `<button type="button" class="bar" data-bucket="${esc(o.at)}" style="--h:${(o.n / max).toFixed(3)}" aria-label="${num(o.n)} orders in the ${word} ${esc(dateWords(o.at.length === 7 ? `${o.at}-01` : o.at))}" title="${num(o.n)} orders, ${esc(o.at)}"></button>`).join("")}</div><p class="pm-mono tl-busy-k">Orders per ${data.bucket}. Press a bar to look closer.</p>` : "";
    document.getElementById("tlBusy").querySelectorAll("[data-bucket]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.bucket;
      if (data.bucket === "month") { zoom = "month"; at = iso(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 0)); }
      else if (data.bucket === "week") { zoom = "week"; at = addDays(k, 6); }
      else { zoom = "day"; at = k; }
      save();
    }));
    // The items, grouped by month (or by day when looking closely).
    const groupOf = (x) => (zoom === "all" || zoom === "year" ? x.at.slice(0, 7) : x.at.slice(0, 10));
    const groups = new Map();
    for (const it of [...data.items].reverse()) (groups.get(groupOf(it)) || groups.set(groupOf(it), []).get(groupOf(it))).push(it);
    const list = document.getElementById("tlList");
    list.innerHTML = [...groups].map(([g, items]) => `<li class="tl-g"><h2 class="tl-gh">${esc(g.length === 7 ? new Date(`${g}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : dateWords(g, { weekday: true }))}</h2>
      <ul>${items.map((it) => `<li><a class="tl-it is-${esc(it.kind)}" href="${esc(hrefFor(it.link))}"><span class="tl-k pm-mono">${esc(KIND[it.kind] || it.kind)}</span><span class="tl-t">${esc(clean(it.text))}</span><span class="pm-mono">${esc(dateWords(it.at, { year: false }))}</span></a></li>`).join("")}</ul></li>`).join("")
      || `<li class="xempty">Nothing marked in this time${zoom === "day" ? ". The bars show the orders that came in." : "."}</li>`;
    if (data.total > data.items.length) list.insertAdjacentHTML("afterbegin", `<li class="pm-mono tl-more">Showing the ${num(data.items.length)} biggest of ${num(data.total)} things. Look closer to see the rest.</li>`);
  }
  function save() {
    const qs = new URLSearchParams({ zoom, ...(at ? { at } : {}) });
    history.replaceState(null, "", `#/timeline?${qs}`);
    paint();
  }
  main.querySelectorAll("[data-zoom]").forEach((b) => b.addEventListener("click", () => { zoom = b.dataset.zoom; save(); }));
  main.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", async () => {
    const now = (await world.clock()).now.slice(0, 10);
    const span = Math.max(1, SPAN[zoom]);
    at = addDays(at || now, Number(b.dataset.step) * span);
    if (at > now) at = now;
    save();
  }));
  await paint();
  return { destroy: onMoved(() => paint().catch(() => {})) };
}
