// Calendar: the company's schedule. A day, a week or a month of everything with a date on it: deliveries due
// (purchase orders), bookings, who is at work, campaigns, world events, tasks due, and the meetings, supplier calls
// and reminders people make here. Entries from records are read from those records every time, so they move when the
// record moves; only the entries people make are made, moved and cancelled here. A request from someone outside waits
// as "not answered yet" until the person it invites accepts or declines it.
// Reads: list_events, get_event, list_staff, list_contact_cards. Acts: create_event, update_event, cancel_event.
//   ?view=day|week|month, ?date=2026-11-24, ?event=EV-0001 (or delivery:PO-3231) opens one entry.
import { startApp, esc, plural, timeParts, words, emptyState, skeleton, toast, slideOver, avatar } from "../lib/ui.js";
import { isScreenRead } from "../lib/client.js";
import { recordChip, wireRecordChips } from "../lib/records.js";
import { plainRef } from "../lib/plain.js";

const APP_ID = "calendar";
const { world, app } = await startApp({ id: APP_ID });
document.title = `${app.name} · Overthought & Co.`;
const main = document.getElementById("main");

const DAY_MS = 86_400_000;
const HOUR_PX = 44;
/** The hours a week or day shows unless something falls outside them. WHY: the shop's day, 08:00 to 18:00. */
const DAY_FROM = 8, DAY_TO = 18;
/** An all-day entry this long, or one that began before the range, goes on the "ongoing" line instead of the lanes. */
const LONG_DAYS = 14;
const LANES = 3;
const NARROW = 760;

/** Kinds, in the order the rail lists them, with the plain words and the drawing for each. */
const KINDS = {
  meeting: { label: "Meetings", one: "Meeting", icon: "people" },
  supplier_call: { label: "Supplier calls", one: "Supplier call", icon: "phone" },
  reminder: { label: "Reminders", one: "Reminder", icon: "bell" },
  other: { label: "Other", one: "Entry", icon: "dot" },
  delivery: { label: "Deliveries", one: "Delivery", icon: "truck" },
  booking: { label: "Bookings", one: "Booking", icon: "ticket" },
  task: { label: "Tasks due", one: "Task due", icon: "check" },
  campaign: { label: "Campaigns", one: "Campaign", icon: "megaphone" },
  world: { label: "World events", one: "In the world", icon: "globe" },
  shift: { label: "Who is at work", one: "Shift", icon: "clock" },
};
const MADE = ["meeting", "supplier_call", "reminder", "other"];
const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const ICON = {
  people: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M15.5 14.6c2.6-.3 4.4 1.1 5 4.4"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4-2 1.3a10 10 0 0 0 6.2 6.2l1.3-2 4 1.5v3a2 2 0 0 1-2 2A16.5 16.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2Z"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  dot: '<circle cx="12" cy="12" r="3.5"/>',
  truck: '<path d="M2.5 6.5h11v9h-11ZM13.5 9.5h4l3 3.5v2.5h-7"/><circle cx="6.5" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/>',
  ticket: '<path d="M3.5 7.5h17v3a1.5 1.5 0 0 0 0 3v3h-17v-3a1.5 1.5 0 0 0 0-3Z"/><path d="M14 7.5v9" stroke-dasharray="1.5 2"/>',
  check: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  megaphone: '<path d="M4 10v4l11 4.5v-13Z"/><path d="M18 9.5a3.5 3.5 0 0 1 0 5M7 14.8l1 4"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.4 5.2 3.4 8.5s-1 6.1-3.4 8.5c-2.4-2.4-3.4-5.2-3.4-8.5s1-6.1 3.4-8.5Z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  tick: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
};

/** One of this app's drawings as an inline svg. */
function ico(name, size = 16) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ""}</svg>`;
}

const $ = (id) => document.getElementById(id);
const read = (tool, input = {}) => world.call(tool, input, { screen: true });

// ------------------------------------------------------------------ dates (all in the world's clock, UTC)

const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const mondayOf = (d) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const dayOf = (iso) => String(iso).slice(0, 10);
const minutesOf = (iso) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
const clockOf = (iso) => iso.slice(11, 16);
const parts = (d) => timeParts(`${d}T12:00:00Z`);
/** The last day a timed entry touches (one ending at midnight belongs to the day before). */
const lastDayOf = (e) => (e.all_day ? e.end : dayOf(new Date(Date.parse(e.end) - 1).toISOString()));

/** The days a view shows, and the days it reads. */
function rangeOf(view, anchor) {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") { const from = mondayOf(anchor); return { from, to: addDays(from, 6) }; }
  const first = `${anchor.slice(0, 8)}01`;
  const from = mondayOf(first);
  return { from, to: addDays(from, 41) };
}

/** The view's heading: "Tuesday 24 November", "23 to 29 November 2026", "November 2026". */
function titleOf(view, anchor) {
  const p = parts(anchor);
  if (view === "day") return `${p.weekday} ${p.day} ${p.month}`;
  if (view === "month") return `${p.month} ${p.year}`;
  const { from, to } = rangeOf("week", anchor);
  const a = parts(from), b = parts(to);
  return a.month === b.month ? `${a.day} to ${b.day} ${b.month} ${b.year}` : `${a.day} ${a.monthShort} to ${b.day} ${b.monthShort} ${b.year}`;
}

/** When an entry is, in words. */
function whenWords(e) {
  if (e.all_day) {
    const a = parts(e.start);
    if (e.end === e.start) return `${a.weekday} ${a.day} ${a.month}`;
    const b = parts(e.end);
    return `${a.day} ${a.monthShort} to ${b.day} ${b.monthShort} ${b.year}`;
  }
  const a = timeParts(e.start);
  return `${a.weekday} ${a.day} ${a.month}, ${clockOf(e.start)} to ${clockOf(e.end)}`;
}

// ------------------------------------------------------------------ state

const ask = new URLSearchParams(location.search);
const S = {
  view: ["day", "week", "month"].includes(ask.get("view")) ? ask.get("view") : (innerWidth < NARROW ? "day" : "week"),
  anchor: /^\d{4}-\d{2}-\d{2}$/.test(ask.get("date") || "") ? ask.get("date") : null,
  today: null,
  now: null,
  hidden: new Set(readHidden()),
  events: [],
  notShown: [],
  waiting: [],
  team: [],
  suppliers: [],
  loading: 0,
};

function readHidden() {
  try { return JSON.parse(localStorage.getItem("ot-cal-hidden") || "[]"); } catch { return []; }
}
function saveHidden() {
  try { localStorage.setItem("ot-cal-hidden", JSON.stringify([...S.hidden])); } catch { /* a private window: fine */ }
}

/** Entries the rail's switches leave showing. */
const shown = () => S.events.filter((e) => !S.hidden.has(e.kind) && e.status !== "cancelled");

// ------------------------------------------------------------------ the frame

function shell() {
  main.innerHTML = `
    <nav class="cal-rail" id="rail" aria-label="Calendar">
      <button class="btn primary cal-new" id="new">${ico("plus")}<span>New entry</span></button>
      <div class="mini" id="mini"></div>
      <p class="rail-h">Show</p>
      <ul class="rail-list" id="kinds"></ul>
      <div id="waiting"></div>
    </nav>
    <div class="cal-scrim" id="scrim" hidden></div>
    <section class="cal-main" aria-label="Schedule">
      <header class="cal-bar">
        <button class="btn ghost icon-only small cal-rail-btn" id="rail-open" aria-label="Show the month and filters">${ico("menu", 18)}</button>
        <h1 class="cal-title" id="title">&nbsp;</h1>
        <div class="cal-nav">
          <button class="btn small" id="today">Today</button>
          <button class="btn ghost icon-only small" id="prev" aria-label="Back">${ico("prev", 18)}</button>
          <button class="btn ghost icon-only small" id="next" aria-label="On">${ico("next", 18)}</button>
        </div>
        <div class="cal-views" role="radiogroup" aria-label="How much to show">
          ${["day", "week", "month"].map((v) => `<button class="pm-chip" role="radio" data-view="${v}" aria-checked="${S.view === v}">${words(v)}</button>`).join("")}
        </div>
      </header>
      <div class="cal-ongoing" id="ongoing" hidden></div>
      <div class="cal-view" id="view" tabindex="-1"></div>
    </section>`;
  $("new").addEventListener("click", () => editor(null, {}));
  $("today").addEventListener("click", () => go({ anchor: S.today }));
  $("prev").addEventListener("click", () => step(-1));
  $("next").addEventListener("click", () => step(1));
  $("rail-open").addEventListener("click", () => toggleRail(true));
  $("scrim").addEventListener("click", () => toggleRail(false));
  main.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => go({ view: b.dataset.view })));
}

function toggleRail(open) {
  main.classList.toggle("is-rail-open", open);
  $("scrim").hidden = !open;
}

/** Moves the view and reads again. */
function go({ view = S.view, anchor = S.anchor } = {}) {
  S.view = view;
  S.anchor = anchor;
  main.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.view === view)));
  const q = new URLSearchParams(location.search);
  q.set("view", view);
  q.set("date", anchor);
  q.delete("event");
  history.replaceState(null, "", `?${q}`);
  toggleRail(false);
  load();
}

function step(n) {
  if (S.view === "day") go({ anchor: addDays(S.anchor, n) });
  else if (S.view === "week") go({ anchor: addDays(S.anchor, 7 * n) });
  else {
    const d = new Date(`${S.anchor.slice(0, 8)}01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    go({ anchor: d.toISOString().slice(0, 10) });
  }
}

// ------------------------------------------------------------------ reading

async function load() {
  const ticket = ++S.loading;
  const { from, to } = rangeOf(S.view, S.anchor);
  $("title").textContent = titleOf(S.view, S.anchor);
  if (!S.events.length) $("view").innerHTML = `<div class="cal-pad">${skeleton(8)}</div>`;
  const [res, ahead] = await Promise.all([
    read("list_events", { from, to }),
    read("list_events", { from: S.today, to: addDays(S.today, 60), kinds: ["meeting", "supplier_call"] }),
  ]);
  if (ticket !== S.loading) return;
  if (!res.ok) {
    $("view").innerHTML = `<div class="cal-pad">${emptyState({ title: res.error.code === "forbidden" ? "This job has no company calendar." : "The calendar did not open.", text: res.error.code === "forbidden" ? "Customers and the customer-facing assistant do not see the company's schedule." : res.error.message })}</div>`;
    S.events = [];
    paintRail();
    return;
  }
  S.events = res.data.events;
  S.notShown = res.data.not_shown;
  S.waiting = ahead.ok ? ahead.data.events.filter((e) => e.status === "tentative") : [];
  paintRail();
  paint();
}

/** The team and the suppliers, once, for the invite list and the supplier picker. */
async function loadPeople() {
  const [staff, sup] = await Promise.all([read("list_staff"), read("list_contact_cards", { kind: "supplier", limit: 50 })]);
  S.team = staff.ok ? staff.data.team : [];
  S.suppliers = sup.ok ? sup.data.cards : [];
}

// ------------------------------------------------------------------ the rail

function paintRail() {
  paintMini();
  const counts = {};
  for (const e of S.events) if (e.status !== "cancelled") counts[e.kind] = (counts[e.kind] || 0) + 1;
  $("kinds").innerHTML = Object.entries(KINDS).filter(([k]) => !S.notShown.includes(k)).map(([k, v]) => `<li>
      <button class="rail-row kind-row" data-kind="${k}" aria-pressed="${!S.hidden.has(k)}">
        <span class="kind-box">${ico("tick", 13)}</span><span class="rail-ico">${ico(v.icon)}</span>
        <span class="rail-name">${esc(v.label)}</span><span class="rail-n">${counts[k] || ""}</span></button></li>`).join("");
  $("kinds").querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.kind;
    if (S.hidden.has(k)) S.hidden.delete(k); else S.hidden.add(k);
    saveHidden();
    b.setAttribute("aria-pressed", String(!S.hidden.has(k)));
    paint();
  }));
  $("waiting").innerHTML = S.waiting.length ? `<p class="rail-h">Waiting for an answer</p>
    <ul class="rail-list">${S.waiting.map((e) => `<li><button class="rail-row wait-row" data-open="${esc(e.id)}" data-ot-ai-id="${esc(e.id)}">
      <span class="rail-ico">${ico(KINDS[e.kind]?.icon || "dot")}</span><span class="wait-text"><b>${esc(e.title)}</b><small>${esc(e.from_outside?.name || "")} · ${esc(shortWhen(e))}</small></span></button></li>`).join("")}</ul>` : "";
  $("waiting").querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openEntry(b.dataset.open)));
}

const shortWhen = (e) => { const p = parts(dayOf(e.start)); return `${p.weekday.slice(0, 3)} ${p.day} ${p.monthShort}${e.all_day ? "" : `, ${clockOf(e.start)}`}`; };

/** The small month in the rail: the days with something on carry a dot; a click opens that day. */
function paintMini() {
  const first = `${S.anchor.slice(0, 8)}01`;
  const from = mondayOf(first);
  const busy = new Set();
  for (const e of shown()) if (e.kind !== "shift" && e.kind !== "world" && e.kind !== "campaign") busy.add(dayOf(e.start));
  const { from: selFrom, to: selTo } = rangeOf(S.view === "month" ? "day" : S.view, S.anchor);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(from, i);
    const cls = [d.slice(0, 7) !== first.slice(0, 7) ? "is-out" : "", d === S.today ? "is-today" : "", d >= selFrom && d <= selTo ? "is-sel" : "", busy.has(d) ? "is-busy" : ""].filter(Boolean).join(" ");
    cells.push(`<button class="mini-day ${cls}" data-day="${d}" aria-label="${esc(parts(d).weekday)} ${parts(d).day} ${esc(parts(d).month)}">${parts(d).day}</button>`);
  }
  $("mini").innerHTML = `<p class="mini-head">${esc(parts(first).month)} ${parts(first).year}</p>
    <div class="mini-grid">${WEEKDAYS.map((w) => `<span class="mini-wd">${w[0]}</span>`).join("")}${cells.join("")}</div>`;
  $("mini").querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => go({ view: S.view === "month" ? "day" : S.view, anchor: b.dataset.day })));
}

// ------------------------------------------------------------------ the views

function paint() {
  paintMini();
  const narrow = innerWidth < NARROW;
  const { from, to } = rangeOf(S.view, S.anchor);
  const list = shown();
  // Long entries (a sale running all month, a cost rise lasting a year) would fill every lane: one quiet line instead.
  const ongoing = list.filter((e) => e.all_day && (daysBetween(e.start, e.end) >= LONG_DAYS || e.start < from));
  $("ongoing").hidden = !ongoing.length;
  $("ongoing").innerHTML = ongoing.length ? `<span class="pm-label">Going on</span>${ongoing.map((e) => `<button class="ongo" data-open="${esc(e.id)}">${ico(KINDS[e.kind].icon, 14)}<span>${esc(e.title)}</span><small>until ${esc(shortDay(e.end))}</small></button>`).join("")}` : "";
  const rest = list.filter((e) => !ongoing.includes(e));
  const view = $("view");
  if (S.view === "month") view.innerHTML = monthView(from, rest, narrow);
  else if (S.view === "week" && narrow) view.innerHTML = agendaView(from, to, rest);
  else view.innerHTML = timeView(S.view === "day" ? [S.anchor] : Array.from({ length: 7 }, (_, i) => addDays(from, i)), rest);
  view.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); openEntry(b.dataset.open); }));
  $("ongoing").querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openEntry(b.dataset.open)));
  view.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); go({ view: "day", anchor: b.dataset.goto }); }));
  view.querySelectorAll(".tg-col[data-day]").forEach((col) => col.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-open]")) return;
    // A click on an empty slot starts an entry there, on the half hour.
    const r = col.getBoundingClientRect();
    const mins = Math.max(0, Math.round(((ev.clientY - r.top) / HOUR_PX) * 2) / 2) * 60 + Number(col.dataset.from) * 60;
    const hh = String(Math.floor(mins / 60)).padStart(2, "0"), mm = String(Math.round(mins % 60)).padStart(2, "0");
    editor(null, { day: col.dataset.day, time: `${hh}:${mm}` });
  }));
  const scroller = view.querySelector(".tg-scroll");
  if (scroller && !scroller.dataset.placed) {
    scroller.dataset.placed = "1";
    scroller.scrollTop = Math.max(0, (Number(scroller.dataset.focus) - Number(scroller.dataset.from) - 0.5) * HOUR_PX);
  }
}

const shortDay = (d) => { const p = parts(d); return `${p.day} ${p.monthShort}`; };

/** One entry as a block: made entries are white with an ink edge; entries from records are a quiet grey; tentative is dashed. */
function chip(e, { compact = false, style = "" } = {}) {
  const k = KINDS[e.kind] || KINDS.other;
  const cls = ["ev", e.source === "record" ? "is-record" : "is-made", e.status === "tentative" ? "is-tentative" : "", compact ? "is-compact" : ""].filter(Boolean).join(" ");
  const time = e.all_day ? "" : `<time>${clockOf(e.start)}</time>`;
  const label = `${k.one}: ${e.title}, ${whenWords(e)}${e.status === "tentative" ? ", not answered yet" : ""}`;
  return `<button class="${cls}" data-open="${esc(e.id)}" ${e.source === "record" ? "" : `data-ot-ai-id="${esc(e.id)}"`} style="${style}" title="${esc(label)}" aria-label="${esc(label)}">
    <span class="ev-ico">${ico(k.icon, 13)}</span><span class="ev-text"><b>${esc(e.title)}</b>${compact ? "" : time}</span></button>`;
}

/**
 * Side-by-side columns for timed entries that overlap, as every calendar does.
 * @return {Map<string, {col: number, cols: number}>}
 */
function layoutDay(events) {
  const out = new Map();
  const sorted = events.slice().sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  let group = [], groupEnd = "", ends = [];
  const flush = () => { for (const g of group) out.set(g.e.id, { col: g.col, cols: ends.length }); group = []; ends = []; };
  for (const e of sorted) {
    if (group.length && e.start >= groupEnd) flush();
    let col = ends.findIndex((end) => end <= e.start);
    if (col < 0) { col = ends.length; ends.push(e.end); } else ends[col] = e.end;
    group.push({ e, col });
    if (group.length === 1 || e.end > groupEnd) groupEnd = e.end;
  }
  flush();
  return out;
}

/** Lanes for all-day entries across the days shown: each entry takes the first lane free on all its days. */
function laneAllDay(days, events) {
  const lanes = [];
  const placed = [];
  for (const e of events.slice().sort((a, b) => a.start.localeCompare(b.start) || daysBetween(b.start, b.end) - daysBetween(a.start, a.end))) {
    const a = Math.max(0, days.indexOf(e.start) >= 0 ? days.indexOf(e.start) : 0);
    const last = days.indexOf(e.end) >= 0 ? days.indexOf(e.end) : days.length - 1;
    let lane = lanes.findIndex((used) => used.every((d) => d < a || d > last));
    if (lane < 0) { lane = lanes.length; lanes.push([]); }
    for (let d = a; d <= last; d++) lanes[lane].push(d);
    placed.push({ e, a, last, lane });
  }
  return placed;
}

/** The day and week views: an all-day strip, then hours with entries placed by time; the day view adds who is at work. */
function timeView(days, list) {
  const allDay = list.filter((e) => e.all_day && e.kind !== "shift" && days.some((d) => d >= e.start && d <= e.end));
  const timed = list.filter((e) => !e.all_day && e.kind !== "shift");
  const shifts = list.filter((e) => e.kind === "shift");
  let lo = DAY_FROM, hi = DAY_TO;
  for (const e of [...timed, ...(S.view === "day" ? shifts : [])]) {
    if (!days.includes(dayOf(e.start))) continue;
    lo = Math.min(lo, Math.floor(minutesOf(e.start) / 60));
    hi = Math.max(hi, Math.min(24, Math.ceil((dayOf(e.end) > dayOf(e.start) ? 1440 : minutesOf(e.end)) / 60)));
  }
  const hours = Array.from({ length: hi - lo }, (_, i) => lo + i);
  const placed = laneAllDay(days, allDay);
  // One day has room for every lane; a week shows three and says how many more.
  const lanes = days.length === 1 ? Infinity : LANES;
  const over = placed.filter((p) => p.lane >= lanes);
  const head = days.map((d) => {
    const p = parts(d);
    const atWork = shifts.filter((e) => dayOf(e.start) === d).length;
    return `<div class="tg-day${d === S.today ? " is-today" : ""}" ${days.length > 1 ? `data-goto="${d}" role="button" tabindex="0"` : ""}>
      <span class="tg-wd">${esc(p.weekday.slice(0, 3))}</span><span class="tg-num">${p.day}</span>
      ${S.hidden.has("shift") || S.notShown.includes("shift") || days.length === 1 ? "" : `<span class="tg-staff">${atWork ? `${atWork} in` : "closed"}</span>`}</div>`;
  }).join("");
  const strip = placed.filter((p) => p.lane < lanes).map((p) => chip(p.e, { compact: true, style: `grid-column:${p.a + 1} / ${p.last + 2};grid-row:${p.lane + 1}` })).join("")
    + days.map((d, i) => { const n = over.filter((p) => i >= p.a && i <= p.last).length; return n ? `<button class="ev-more" data-goto="${d}" style="grid-column:${i + 1};grid-row:${LANES + 1}">${n} more</button>` : ""; }).join("");
  const nowMin = S.now ? minutesOf(S.now) : null;
  const cols = days.map((d) => {
    const mine = timed.filter((e) => dayOf(e.start) === d || (dayOf(e.start) < d && lastDayOf(e) >= d));
    const lay = layoutDay(mine);
    const blocks = mine.map((e) => {
      const start = dayOf(e.start) < d ? 0 : minutesOf(e.start);
      const end = lastDayOf(e) > d ? 1440 : (dayOf(e.end) > d ? 1440 : minutesOf(e.end));
      const top = ((start - lo * 60) / 60) * HOUR_PX;
      const h = Math.max(20, ((end - start) / 60) * HOUR_PX - 2);
      const { col, cols: n } = lay.get(e.id) || { col: 0, cols: 1 };
      return chip(e, { compact: h < 36, style: `top:${top}px;height:${h}px;left:calc(${(col / n) * 100}% + 2px);width:calc(${100 / n}% - 4px)` });
    }).join("");
    const now = d === S.today && nowMin != null && nowMin >= lo * 60 && nowMin <= hi * 60 ? `<span class="tg-now" style="top:${((nowMin - lo * 60) / 60) * HOUR_PX}px"></span>` : "";
    return `<div class="tg-col${d === S.today ? " is-today" : ""}" data-day="${d}" data-from="${lo}" aria-label="${esc(parts(d).weekday)}">${blocks}${now}</div>`;
  }).join("");
  const focus = S.view === "day" || days.includes(S.today) ? Math.max(lo, Math.min(hi - 1, nowMin != null ? Math.floor(nowMin / 60) - 1 : 9)) : 9;
  const empty = !allDay.length && !timed.length && (S.view !== "day" || !shifts.length);
  return `<div class="tg${days.length === 1 ? " is-day" : ""}" style="--days:${days.length};--hour:${HOUR_PX}px">
      <div class="tg-head"><span class="tg-gutter"></span>${head}</div>
      ${allDay.length ? `<div class="tg-strip"><span class="tg-gutter pm-label">All day</span><div class="tg-strip-grid">${strip}</div></div>` : ""}
      <div class="tg-scroll" data-from="${lo}" data-focus="${focus}">
        <div class="tg-body">
          <div class="tg-hours">${hours.map((h) => `<span style="height:${HOUR_PX}px">${String(h).padStart(2, "0")}:00</span>`).join("")}</div>
          <div class="tg-cols" style="height:${hours.length * HOUR_PX}px">${cols}</div>
          ${S.view === "day" ? rota(shifts, lo, hi) : ""}
        </div>
      </div>
      ${empty ? `<p class="tg-empty">Nothing on${S.view === "day" ? " this day" : " this week"}. Click a time to add something.</p>` : ""}
    </div>`;
}

/** Who is at work on the day shown: one row each, a bar on the day's hours, as a rota on the wall would show it. */
function rota(shifts, lo, hi) {
  if (S.hidden.has("shift") || S.notShown.includes("shift")) return "";
  if (!shifts.length) return `<aside class="rota"><p class="pm-label">At work</p><p class="rota-none">No one works on ${esc(parts(S.anchor).weekday)}s.</p></aside>`;
  const span = (hi - lo) * 60;
  const ticks = [];
  for (let h = lo; h <= hi; h += 2) ticks.push(`<span style="left:${(((h - lo) * 60) / span) * 100}%">${String(h).padStart(2, "0")}</span>`);
  const rows = shifts.slice().sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end)).map((e) => {
    const left = ((minutesOf(e.start) - lo * 60) / span) * 100, width = ((minutesOf(e.end) - minutesOf(e.start)) / span) * 100;
    const name = e.people[0]?.name || "";
    return `<button class="rota-row" data-open="${esc(e.id)}" aria-label="${esc(`${name}, ${clockOf(e.start)} to ${clockOf(e.end)}`)}">
      <span class="rota-who">${avatar(name, { size: 22 })}<b>${esc(name)}</b></span>
      <span class="rota-track"><i style="left:${left}%;width:${width}%"></i></span>
      <small>${clockOf(e.start)}–${clockOf(e.end)}</small></button>`;
  }).join("");
  return `<aside class="rota"><p class="pm-label rota-h">At work · ${shifts.length}</p>
    <div class="rota-axis"><span class="rota-who"></span><span class="rota-ticks">${ticks.join("")}</span><small></small></div>${rows}</aside>`;
}

/** The month: six weeks of days, a few entries each, and how many more. */
function monthView(from, list, narrow) {
  const month = S.anchor.slice(0, 7);
  const items = list.filter((e) => e.kind !== "shift");
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(from, i);
    const on = items.filter((e) => d >= dayOf(e.start) && d <= lastDayOf(e)).sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start.localeCompare(b.start));
    const max = narrow ? 0 : 3;
    cells.push(`<div class="mo-day${d.slice(0, 7) !== month ? " is-out" : ""}${d === S.today ? " is-today" : ""}" data-goto="${d}" role="button" tabindex="0" aria-label="${esc(parts(d).weekday)} ${parts(d).day} ${esc(parts(d).month)}: ${plural(on.length, "entry", "entries")}">
      <span class="mo-num">${parts(d).day}</span>
      ${narrow ? (on.length ? `<span class="mo-dots">${"<i></i>".repeat(Math.min(3, on.length))}</span>` : "") : on.slice(0, max).map((e) => chip(e, { compact: true })).join("")}
      ${!narrow && on.length > max ? `<span class="mo-more">${on.length - max} more</span>` : ""}</div>`);
  }
  return `<div class="mo"><div class="mo-head">${WEEKDAYS.map((w) => `<span>${w}</span>`).join("")}</div><div class="mo-grid">${cells.join("")}</div></div>`;
}

/** A week on a narrow screen: day by day, as a list. */
function agendaView(from, to, list) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const on = list.filter((e) => e.kind !== "shift" && d >= dayOf(e.start) && d <= lastDayOf(e)).sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start.localeCompare(b.start));
    const atWork = list.filter((e) => e.kind === "shift" && dayOf(e.start) === d).length;
    const p = parts(d);
    out.push(`<section class="ag-day${d === S.today ? " is-today" : ""}"><button class="ag-head" data-goto="${d}"><b>${esc(p.weekday)} ${p.day} ${esc(p.monthShort)}</b>${S.hidden.has("shift") ? "" : `<small>${atWork ? `${atWork} at work` : "closed"}</small>`}</button>
      ${on.length ? on.map((e) => chip(e)).join("") : `<p class="ag-none">Nothing on.</p>`}</section>`);
  }
  return `<div class="ag">${out.join("")}</div>`;
}

// ------------------------------------------------------------------ one entry

async function openEntry(id) {
  const sheet = slideOver({ title: "Calendar", body: `<div class="ent">${skeleton(6)}</div>` });
  const res = await read("get_event", { event_id: id });
  if (!sheet.el.isConnected) return;
  const body = sheet.el.querySelector(".over-body");
  if (!res.ok) { body.innerHTML = emptyState({ title: "It is not there any more.", text: res.error.message }); return; }
  const e = res.data;
  sheet.el.querySelector(".over-head h2").textContent = e.title;
  const q = new URLSearchParams(location.search); q.set("event", e.id); history.replaceState(null, "", `?${q}`);
  const k = KINDS[e.kind] || KINDS.other;
  const status = e.status === "tentative" ? `<span class="pill warn">Not answered yet</span>` : e.status === "cancelled" ? `<span class="pill bad">Cancelled</span>` : e.status === "late" || e.status === "overdue" ? `<span class="pill bad">${esc(words(e.status))}</span>` : "";
  const chips = [];
  if (e.record) chips.push(recordChip(e.record.kind, e.record.id));
  for (const [kind, rid] of Object.entries(e.links || {})) if (!(e.record && e.record.id === rid) && ["po", "supplier_id", "customer_id", "case", "order", "booking"].includes(kind)) chips.push(recordChip(kind, rid));
  const canAnswer = e.editable && e.source === "outside" && e.status === "tentative";
  body.innerHTML = `<div class="ent rise">
    <p class="ent-kind">${ico(k.icon, 15)}<span>${esc(k.one)}</span>${status}</p>
    <p class="ent-when">${esc(whenWords(e))}</p>
    <ul class="list rec-list">
      ${e.where ? `<li><span class="grow muted">Where</span><b>${esc(e.where)}</b></li>` : ""}
      ${e.from_outside ? `<li><span class="grow muted">Asked for by</span><b>${esc([e.from_outside.name, e.from_outside.organisation !== e.from_outside.name ? e.from_outside.organisation : null].filter(Boolean).join(", "))}</b></li>` : ""}
      ${e.organiser && !e.from_outside ? `<li><span class="grow muted">Made by</span><b>${esc(e.organiser.name)}</b></li>` : ""}
    </ul>
    ${e.people.length ? `<h3 class="h3 rec-h">${e.kind === "shift" ? "Who" : "Invited"}</h3><ul class="ent-people">${e.people.map((p) => `<li>${avatar(p.name, { size: 28 })}<span>${esc(p.name)}</span></li>`).join("")}</ul>` : ""}
    ${e.notes ? `<p class="ent-notes">${esc(e.notes)}</p>` : ""}
    ${chips.length ? `<p class="ent-chips">${chips.join(" ")}</p>` : ""}
    ${e.source === "record" ? `<p class="ent-from">This comes from ${esc(fromWords(e))}, so it moves when that does.</p>` : ""}
    ${(e.history || []).length ? `<h3 class="h3 rec-h">What happened</h3><ol class="rec-steps">${e.history.map((h) => `<li><time>${esc(whenStamp(h.at))} · ${esc(h.by)}</time><span>${esc(h.event.charAt(0).toUpperCase() + h.event.slice(1))}</span></li>`).join("")}</ol>` : ""}
    ${e.editable ? `<div class="rec-acts">
      ${canAnswer ? `<button class="btn primary" data-act="accept">Accept</button><button class="btn" data-act="decline">Decline</button><button class="btn ghost" data-act="edit">Change</button>`
        : `<button class="btn primary" data-act="edit">Change</button><button class="btn danger" data-act="cancel">Cancel it</button>`}
      <span class="ent-said" id="ent-said"></span></div>` : e.source === "made" || e.source === "outside" ? `<p class="ent-from">${e.status === "cancelled" ? "Cancelled entries stay, so the record is complete." : `Only ${esc(e.organiser?.name || "its organiser")} or the manager can change this.`}</p>` : ""}
  </div>`;
  wireRecordChips(body, world);
  const said = (text, tone = "") => { const el = body.querySelector("#ent-said"); if (el) { el.textContent = text; el.dataset.tone = tone; } };
  body.querySelector('[data-act="edit"]')?.addEventListener("click", () => { sheet.close(); editor(e, {}); });
  body.querySelector('[data-act="accept"]')?.addEventListener("click", async () => {
    const r = await world.call("update_event", { event_id: e.id, status: "confirmed" });
    if (!r.ok) { said(r.error.message, "bad"); return; }
    sheet.close(); toast(r.data.warnings.length ? `Accepted. ${r.data.warnings.join(" ")}` : "Accepted. It is in the calendar."); load();
  });
  for (const act of ["cancel", "decline"]) {
    body.querySelector(`[data-act="${act}"]`)?.addEventListener("click", async (ev) => {
      const b = ev.currentTarget;
      if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = act === "cancel" ? "Yes, cancel it" : "Yes, decline"; return; }
      const r = await world.call("cancel_event", { event_id: e.id });
      if (!r.ok) { said(r.error.message, "bad"); return; }
      sheet.close(); toast(act === "cancel" ? "Cancelled." : "Declined."); load();
    });
  }
}

/** The record an entry comes from, in words. */
function fromWords(e) {
  const r = e.record;
  if (!r) return "its record";
  if (r.kind === "po") return `${plainRef(r.id) || "a purchase order"}`;
  if (r.kind === "staff") return "the team's hours";
  if (r.kind === "campaign") return "the campaign";
  if (r.kind === "world_event") return "the news of the world";
  if (r.kind === "task") return "the task";
  if (r.kind === "booking") return "the booking";
  return "its record";
}

const whenStamp = (iso) => { const p = timeParts(iso); return `${p.day} ${p.monthShort}, ${clockOf(iso)}`; };

// ------------------------------------------------------------------ making and changing

/**
 * The form for a new entry or a change to one. Warnings (someone not at work, someone already busy) show beside
 * the button after saving, so the person can decide; the entry is saved either way, as in any calendar.
 */
async function editor(e, { day = null, time = null }) {
  if (!S.team.length) await loadPeople();
  const start = e ? (e.all_day ? `${e.start}T09:00` : e.start.slice(0, 16)) : `${day || (S.view === "month" ? S.today : S.anchor)}T${time || "10:00"}`;
  const len = e && !e.all_day ? Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60000) : 30;
  const invited = new Set((e?.people || []).map((p) => p.id));
  const sup = e?.links?.supplier_id || "";
  const sheet = slideOver({ title: e ? "Change the entry" : "A new entry", body: `<form class="ed" id="ed">
    <label class="field"><span>What</span><input class="input" name="title" required maxlength="120" value="${esc(e?.title || "")}" placeholder="Call with the bakery"></label>
    <div class="ed-row">
      <label class="field"><span>Kind</span><select class="select" name="kind" ${e ? "disabled" : ""}>${MADE.map((k) => `<option value="${k}" ${(e?.kind || "meeting") === k ? "selected" : ""}>${esc(KINDS[k].one)}</option>`).join("")}</select></label>
      <label class="field"><span>Day</span><input class="input" type="date" name="day" required value="${esc(start.slice(0, 10))}"></label>
    </div>
    <label class="ed-check"><input type="checkbox" name="all_day" ${e?.all_day ? "checked" : ""}><span>All day</span></label>
    <div class="ed-row" id="ed-times" ${e?.all_day ? "hidden" : ""}>
      <label class="field"><span>Starts</span><input class="input" type="time" name="time" step="900" value="${esc(start.slice(11, 16))}"></label>
      <label class="field"><span>How long</span><select class="select" name="minutes">${[...new Set([...LENGTHS, len])].sort((a, b) => a - b).map((m) => `<option value="${m}" ${m === len ? "selected" : ""}>${m < 60 ? `${m} minutes` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : plural(m / 60, "hour")}</option>`).join("")}</select></label>
    </div>
    <label class="field"><span>Where</span><input class="input" name="where" maxlength="120" value="${esc(e?.where || "")}" placeholder="The back office, or a phone number"></label>
    ${S.suppliers.length ? `<label class="field"><span>About a supplier</span><select class="select" name="supplier"><option value="">No one</option>${S.suppliers.map((c) => `<option value="${esc(c.id)}" ${sup === c.id ? "selected" : ""}>${esc(c.organisation || c.name)}</option>`).join("")}</select></label>` : ""}
    <fieldset class="ed-who"><legend>Invite</legend>
      ${S.team.map((p) => `<label class="ed-person"><input type="checkbox" name="invite" value="${esc(p.id)}" ${invited.has(p.id) ? "checked" : ""}>${avatar(p.name, { size: 24 })}<span><b>${esc(p.name)}</b><small>${esc(p.job || words(p.role))}</small></span></label>`).join("") || `<p class="muted small">The team list is not open to this job.</p>`}
    </fieldset>
    <label class="field"><span>Notes</span><textarea class="textarea" name="notes" rows="3" maxlength="2000">${esc(e?.notes || "")}</textarea></label>
    <p class="ed-acts"><button class="btn primary" type="submit">${e ? "Save the change" : "Put it in"}</button><span class="ent-said" id="ed-said" aria-live="polite"></span></p>
  </form>` });
  const f = sheet.el.querySelector("#ed");
  f.querySelector('[name="title"]').focus();
  f.all_day.addEventListener("change", () => { sheet.el.querySelector("#ed-times").hidden = f.all_day.checked; });
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const said = sheet.el.querySelector("#ed-said");
    const fd = new FormData(f);
    const allDay = f.all_day.checked;
    const input = {
      title: String(fd.get("title")).trim(),
      all_day: allDay,
      start: allDay ? String(fd.get("day")) : `${fd.get("day")}T${fd.get("time")}`,
      where: String(fd.get("where") || ""),
      notes: String(fd.get("notes") || ""),
      links: fd.get("supplier") ? { supplier_id: String(fd.get("supplier")) } : {},
    };
    if (!allDay) input.minutes = Number(fd.get("minutes"));
    const chosen = fd.getAll("invite").map(String);
    let r;
    if (e) {
      const was = new Set(e.people.map((p) => p.id));
      r = await world.call("update_event", { event_id: e.id, ...input, invite: chosen.filter((id) => !was.has(id)), uninvite: [...was].filter((id) => !chosen.includes(id)) });
    } else {
      r = await world.call("create_event", { ...input, kind: String(fd.get("kind")), invite: chosen });
    }
    if (!r.ok) { said.textContent = r.error.message; said.dataset.tone = "bad"; return; }
    const ev2 = r.data.event;
    // Show the new place in the calendar behind the panel, so the person sees it land.
    if (dayOf(ev2.start) < rangeOf(S.view, S.anchor).from || dayOf(ev2.start) > rangeOf(S.view, S.anchor).to) { S.anchor = dayOf(ev2.start); go({}); } else load();
    if (r.data.warnings.length) {
      said.dataset.tone = "warn";
      said.innerHTML = `Saved. ${r.data.warnings.map(esc).join(" ")} <button class="btn small" type="button" id="ed-done">Done</button>`;
      said.querySelector("#ed-done").addEventListener("click", () => sheet.close());
      return;
    }
    sheet.close();
    toast(e ? "Changed." : "In the calendar.");
  });
}

// ------------------------------------------------------------------ keys and staying live

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.("input, textarea, select, .over")) return;
  const k = e.key.toLowerCase();
  if (k === "t") go({ anchor: S.today });
  else if (k === "d" || k === "w" || k === "m") go({ view: { d: "day", w: "week", m: "month" }[k] });
  else if (k === "j" || e.key === "ArrowRight") step(1);
  else if (k === "k" || e.key === "ArrowLeft") step(-1);
  else if (k === "n" || k === "c") editor(null, {});
  else return;
  e.preventDefault();
});

let resized = innerWidth < NARROW;
addEventListener("resize", () => { const n = innerWidth < NARROW; if (n !== resized) { resized = n; paint(); } });

async function syncClock() {
  const c = await world.clock().catch(() => null);
  S.now = c?.now || S.now || new Date().toISOString();
  S.today = dayOf(S.now);
}

document.addEventListener("ot:day", async () => { await syncClock(); load(); });
document.addEventListener("ot:role", () => { S.team = []; S.events = []; shell(); load(); });
world.onChange((change) => {
  if (change.reset) { location.reload(); return; }
  if (change.entries.some((x) => !isScreenRead(x))) load();
});

await syncClock();
S.anchor ||= S.today;
shell();
await load();
const askedEvent = ask.get("event");
if (askedEvent) openEntry(askedEvent);
