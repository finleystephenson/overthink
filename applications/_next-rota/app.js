// Rota: the people. Who works here and since when, the week's shifts, how busy each team is against its hours,
// and the controls to change the team (hours, hiring, letting someone go) with the cost shown first.
// Reads: list_staff (hours and costs at this business's real size), get_company, ledger_search, list_contacts,
// list_purchase_orders, social_stats, search_documents, get_document and the impact. Action: set_staffing.
// Anything changed here, or by an outside AI, shows at once; what each change did shows after time moves on.
//
// Address bar: #team, #week, #busy, #results, #joined.
import { startApp, esc, money, money2, num, plural, emptyState, skeleton, slideOver, avatar, longDate } from "../lib/ui.js";
import { isScreenRead } from "../lib/client.js";
import { plainText } from "../lib/plain.js";
import { changesMade, changeCard, MONEY_MEASURES } from "../lib/results.js";

const APP_ID = "rota";
const { world, app } = await startApp({ id: APP_ID });
document.title = `${app.name} · Overthought & Co.`;

/** Jobs in plain words, and the team each belongs to. */
const JOBS = {
  manager: { job: "Runs the shop", team: "Running the shop" },
  finance: { job: "Keeps the books", team: "Money" },
  support_lead: { job: "Leads customer care", team: "Customer care" },
  support_agent: { job: "Answers customers", team: "Customer care" },
  warehouse: { job: "Packs and sends parcels", team: "Parcels" },
  buyer: { job: "Buys the stock", team: "Buying" },
  marketing: { job: "Marketing", team: "Marketing" },
  technician: { job: "Mends things at the Fix Club", team: "The Fix Club" },
  coordinator: { job: "Runs bookings", team: "Bookings" },
};
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const OPEN_HOURS = 8.5;  // 09:00 to 17:30, from the company record; used only when it cannot be read
const MEASURES = [...MONEY_MEASURES, { key: "staff_task_hours", label: "hours of work done" }];

const ICONS = {
  team: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M15.5 14.6c2.6-.3 4.4 1.1 5 4.4"/>',
  week: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4M7 13h4M7 16.5h7"/>',
  busy: '<path d="M4 19V10M10 19V5M16 19v-7M21 19H3"/>',
  results: '<path d="M4 16l5-5 4 4 7-7"/><path d="M14 8h6v6"/>',
  joined: '<path d="M5 4.5h11.5a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2Z"/><path d="M5 17.5a2 2 0 0 1 2-2h11.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};

function ico(name, size = 18) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

const VIEWS = [
  { id: "team", label: "The team" },
  { id: "week", label: "This week" },
  { id: "busy", label: "How busy" },
  { id: "results", label: "What changes did" },
  { id: "joined", label: "Who joined when" },
];

const main = document.getElementById("main");

const S = {
  view: "team",
  now: null,
  team: [],         // list_staff's people: plan_weekly_hours is what set_staffing takes; monthly_cost is real money
  limits: null,
  company: null,
  load: [],
  results: [],
  timeline: null,
  said: null,       // { text, tone } beside the team table, kept until time moves
  busy: false,
  again: false,
};

// ------------------------------------------------------------------ helpers

function read(tool, input = {}) {
  return world.call(tool, input, { screen: true }).catch((e) => ({ ok: false, error: { code: "offline", message: e.message } }));
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function today() {
  return (S.now || new Date().toISOString()).slice(0, 10);
}

function jobOf(p) {
  return JOBS[p.role] || { job: p.role.replace(/_/g, " "), team: "Other" };
}

function firstName(name) {
  const parts = String(name).replace(/^(mr|mrs|ms|miss|dr)\s+/i, "").split(/\s+/);
  return /^(mr|mrs|ms|miss|dr)\s/i.test(name) ? name : parts[0];
}

/** Hours a week as a person thinks of them: the figure set_staffing takes. */
function hoursOf(p) {
  return p.plan_weekly_hours ?? p.weekly_hours;
}

/**
 * What some weekly hours of one person's work cost each month on the books. WHY from monthly_cost: list_staff
 * already prices their hours at this business's real size with employer costs, so a change is priced the same way.
 */
function monthly(p, hours) {
  const h = hoursOf(p);
  return h ? (p.monthly_cost / h) * hours : null;
}

/** The days the shop opens, from the company record ("mon_sat"), as indexes into DAYS. */
function openDays() {
  const wh = S.company?.working_hours || {};
  return Object.keys(wh).includes("mon_sat") ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4];
}

function openLength() {
  const m = String(S.company?.working_hours?.mon_sat || "").match(/(\d\d):(\d\d)-(\d\d):(\d\d)/);
  return m ? (Number(m[3]) * 60 + Number(m[4]) - Number(m[1]) * 60 - Number(m[2])) / 60 : OPEN_HOURS;
}

// ------------------------------------------------------------------ loading

async function load() {
  const clock = await world.clock().catch(() => null);
  if (clock?.now) S.now = clock.now;
  const [staff, levers, company] = await Promise.all([read("list_staff"), read("get_levers"), S.company ? null : read("get_company")]);
  if (company?.ok) S.company = company.data;
  if (!staff.ok) return staff;
  S.team = staff.data.team;
  S.limits = levers.ok ? levers.data.limits : S.limits;
  const [work, results] = await Promise.all([loadWorkload(), changesMade(world, ["set_staffing"])]);
  S.load = work;
  S.results = results;
  if (!S.timeline) S.timeline = await loadTimeline();
  return staff;
}

/** Work coming in for each team: the last seven days against an ordinary week before them. */
async function loadWorkload() {
  const t = today();
  const wk = { from: addDays(t, -7), to: addDays(t, -1) };
  const before = { from: addDays(t, -35), to: addDays(t, -8) };
  const [sales, salesBefore, lines, linesBefore, contacts, pos, social] = await Promise.all([
    read("ledger_search", { type: "sale", ...wk }),
    read("ledger_search", { type: "sale", ...before }),
    read("ledger_search", wk),
    read("ledger_search", before),
    read("list_contacts"),
    read("list_purchase_orders"),
    read("social_stats", { days: 35 }),
  ]);
  const inWeek = (d, w) => d >= w.from && d <= w.to;
  const count = (list, f, w) => list.filter((x) => inWeek(f(x).slice(0, 10), w)).length;
  const out = [];
  if (sales.ok && salesBefore.ok) out.push({ team: "Parcels", work: "orders to pack", now: sales.data.count, usual: salesBefore.data.count / 4 });
  if (contacts.ok) {
    const staffed = contacts.data.contacts.filter((c) => ["support_agent", "support_lead"].includes(c.handled_by));
    const oldest = contacts.data.contacts.at(-1)?.at?.slice(0, 10) || t;
    // Only compare with the weeks the newest hundred contacts actually cover.
    const weeks = Math.min(4, Math.floor((Date.parse(wk.from) - Date.parse(oldest)) / (7 * 864e5)));
    if (weeks >= 1) out.push({ team: "Customer care", work: "customers to answer", now: count(staffed, (c) => c.at, wk), usual: count(staffed, (c) => c.at, { from: addDays(wk.from, -7 * weeks), to: addDays(wk.from, -1) }) / weeks });
  }
  if (pos.ok) out.push({ team: "Buying", work: "stock orders placed", now: count(pos.data.purchase_orders, (p) => p.ordered_at, wk), usual: count(pos.data.purchase_orders, (p) => p.ordered_at, before) / 4 });
  if (lines.ok && linesBefore.ok) out.push({ team: "Money", work: "lines in the books", now: lines.data.count, usual: linesBefore.data.count / 4 });
  if (social.ok) {
    const rows = [...(social.data.squint?.days || []), ...(social.data.mutter?.days || [])];
    out.push({ team: "Marketing", work: "posts made", now: rows.filter((r) => inWeek(r.date, wk)).reduce((n, r) => n + r.posts, 0), usual: rows.filter((r) => inWeek(r.date, before)).reduce((n, r) => n + r.posts, 0) / 4 });
  }
  return out;
}

/** The company timeline, from the business's own documents. Read once. */
async function loadTimeline() {
  const found = await read("search_documents", { query: "history" });
  const doc = found.ok ? found.data.documents.find((d) => /timeline|history/i.test(`${d.title} ${d.kind}`)) : null;
  if (!doc) return [];
  const full = await read("get_document", { id: doc.id });
  if (!full.ok) return [];
  return full.data.body.split("\n").map((line) => line.match(/^-\s+\*\*(\d{4}-\d\d-\d\d),\s*(.+?)\*\*\s*(.*)$/)).filter(Boolean)
    .map((m) => ({ date: m[1], title: m[2].replace(/\.$/, ""), text: plainText(m[3]) }));
}

// ------------------------------------------------------------------ the shell

function shell() {
  main.innerHTML = `<div class="ws">
    <nav class="ws-rail" aria-label="${esc(app.name)}">
      <button class="btn primary ws-main-btn" id="hireBtn" title="Hire someone (H)">${ico("plus", 17)}<span>Hire someone</span></button>
      <ul class="rail-list">${VIEWS.map((v) => `<li><a class="rail-row" href="#${v.id}" data-view="${v.id}">${ico(v.id, 17)}<span class="rail-name">${esc(v.label)}</span><span class="rail-count" data-badge="${v.id}"></span></a></li>`).join("")}</ul>
    </nav>
    <section class="ws-view" id="view" tabindex="-1"></section>
  </div>`;
  main.querySelector("#hireBtn").addEventListener("click", openHire);
}

function markNav() {
  main.querySelectorAll(".rail-row").forEach((a) => {
    const on = a.dataset.view === S.view;
    a.classList.toggle("is-on", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  // The rail's only number: teams stretched past an ordinary week. Hidden at zero.
  const b = main.querySelector('[data-badge="busy"]');
  if (b) { const n = busyRows().filter((r) => r.b.tone === "bad").length; b.textContent = n ? num(n) : ""; }
}

function monthYear(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ------------------------------------------------------------------ the team

function drawTeam(view) {
  const hours = S.team.reduce((n, p) => n + hoursOf(p), 0);
  const wages = S.team.reduce((n, p) => n + (p.monthly_cost || 0), 0);
  const wh = S.company?.working_hours?.mon_sat;
  view.innerHTML = `<div class="v-wrap">
    <dl class="figs">
      <div class="fig"><dt>People</dt><dd>${esc(num(S.team.length))}</dd></div>
      <div class="fig"><dt>Hours a week</dt><dd>${esc(num(hours))}</dd></div>
      <div class="fig"><dt>Wages on the books</dt><dd>${esc(money(wages))}</dd><small>a month, with employer costs</small></div>
      <div class="fig"><dt>Open</dt><dd class="ro-open">${wh ? esc(`Mon to Sat, ${wh.replace("-", " to ")}`) : "Mon to Sat"}</dd></div>
    </dl>
    <div class="sect-head ro-head"><p class="t-lede">Pick someone to change their hours. You see the cost before you save.</p><p class="said ${S.said?.tone || ""}" role="status">${esc(S.said?.text || "")}</p></div>
    <table class="tbl ro-people"><thead><tr><th>Name</th><th>Job</th><th class="r">Hours a week</th><th class="r">An hour</th><th class="r">A month</th><th>Here since</th></tr></thead><tbody>
      ${S.team.map((p) => `<tr><td><button class="ro-name" data-id="${esc(p.id)}">${avatar(p.name, { size: 28 })}<span>${esc(p.name)}</span></button></td>
        <td class="muted">${esc(jobOf(p).job)}</td><td class="r">${esc(num(hoursOf(p)))}</td><td class="r">${esc(money2(p.hourly_pay))}</td><td class="r">${esc(money(p.monthly_cost))}</td>
        <td class="mono">${p.hired ? "New this run" : p.joined ? esc(monthYear(p.joined)) : ""}</td></tr>`).join("")}
    </tbody></table>
  </div>`;
  view.querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", () => openPerson(b.dataset.id)));
}

/** One person: what they do, their hours with the cost shown first, and letting them go. */
function openPerson(id) {
  const p = S.team.find((x) => x.id === id);
  if (!p) return;
  const role = S.company?.roles?.[p.role];
  const moments = (S.timeline || []).filter((t) => mentions(t, p));
  const now = hoursOf(p);
  const over = slideOver({
    title: p.name,
    wide: true,
    body: `
      <div class="ro-o-head">${avatar(p.name, { size: 40 })}<div><b>${esc(jobOf(p).job)}</b><small>${p.hired ? "Joined during this run" : p.joined ? `Here since ${esc(longDate(`${p.joined}T00:00:00Z`))}` : ""}${p.shift_start ? ` · starts at ${esc(p.shift_start)}` : ""}</small></div></div>
      <form class="ro-hours" id="hForm">
        <h3 class="od-h">Their hours</h3>
        <p class="ro-h-read"><b id="hOut">${esc(num(now))}</b><span>hours a week</span></p>
        <input class="ro-slide" type="range" id="hIn" min="${S.limits?.weekly_hours?.[0] ?? 0}" max="${S.limits?.weekly_hours?.[1] ?? 48}" step="1" value="${now}" aria-label="Hours a week">
        <p class="od-sub" id="hCost">${esc(costLine(p, now))}</p>
        <div class="act-row"><button class="btn primary" id="hGo" type="submit" disabled>Change their hours</button><button class="btn" id="hBye" type="button">Let ${esc(firstName(p.name))} go</button></div>
        <p class="said bad" id="hErr" role="alert"></p>
      </form>
      ${role?.can?.length ? `<section class="od-sect"><h3 class="od-h">What the job allows</h3><ul class="ro-can">${role.can.map((c) => `<li>${esc(plainText(c))}</li>`).join("")}</ul></section>` : ""}
      ${moments.length ? `<section class="od-sect"><h3 class="od-h">In the company's history</h3><ul class="od-rows">${moments.map(tlItem).join("")}</ul></section>` : ""}`,
  });
  const f = over.el;
  const input = f.querySelector("#hIn");
  const fill = () => input.style.setProperty("--fill", `${((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min) || 1)) * 100}%`);
  fill();
  input.addEventListener("input", () => {
    fill();
    f.querySelector("#hOut").textContent = input.value;
    f.querySelector("#hCost").textContent = costLine(p, Number(input.value));
    f.querySelector("#hGo").disabled = Number(input.value) === now;
  });
  f.querySelector("#hForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const h = Number(input.value);
    const ok = await staff({ action: "hours", staff_id: p.id, weekly_hours: h, reason: "Changed in Rota" }, f.querySelector("#hErr"));
    if (ok) { over.close(); said(`${p.name} now works ${plural(h, "hour")} a week, from tomorrow. Move time on to see what it does.`); }
  });
  const bye = f.querySelector("#hBye");
  bye.addEventListener("click", async () => {
    // Two presses: the first says what it saves, the second does it.
    if (!bye.dataset.sure) {
      bye.dataset.sure = "1";
      bye.classList.add("danger");
      bye.textContent = `Yes, let ${firstName(p.name)} go (saves ${money(p.monthly_cost)} a month)`;
      return;
    }
    const ok = await staff({ action: "remove", staff_id: p.id, reason: "Let go in Rota" }, f.querySelector("#hErr"));
    if (ok) { over.close(); said(`${p.name} has left the team.`); }
  });
}

/** "4 hours more a week. About £23 more a month in wages." */
function costLine(p, hours) {
  const d = hours - hoursOf(p);
  if (!d) return `${money(p.monthly_cost)} a month now. Move the slider to see what a change costs.`;
  const m = monthly(p, Math.abs(d));
  return `${plural(Math.abs(d), "hour")} ${d > 0 ? "more" : "less"} a week.${m != null ? ` About ${money(m)} ${d > 0 ? "more" : "less"} a month in wages.` : ""}`;
}

function mentions(t, p) {
  const words = p.name.replace(/^(mr|mrs|ms|miss|dr)\s+/i, "").split(/\s+/).filter((w) => w.length > 2);
  return words.some((w) => new RegExp(`\\b${w}\\b`).test(`${t.title} ${t.text}`));
}

function tlItem(t) {
  return `<li><time>${esc(t.date.slice(0, 4))}</time><span class="grow"><b>${esc(t.title)}</b><small>${esc(t.text)}</small></span></li>`;
}

/** Feedback beside the team table, kept until time moves on. */
function said(text, tone = "good") {
  S.said = { text, tone };
  if (S.view !== "team") location.hash = "#team"; else draw();
}

/** Calls set_staffing and redraws. The business decides whether the change is allowed. */
async function staff(input, errEl) {
  const r = await world.call("set_staffing", input);
  if (!r.ok) { if (errEl) errEl.textContent = plainText(r.error.message); return false; }
  refresh();
  return true;
}

/** Hire someone: the job, the hours, a name, and the cost before anything is saved. */
function openHire() {
  const roles = [...new Set(S.team.map((p) => p.role))];
  const max = S.limits?.team_max ?? 30;
  const over = slideOver({
    title: "Hire someone",
    body: `<form class="ro-hours" id="rForm">
      <label class="field"><span>The job</span><select class="select" id="rRole">${roles.map((r) => `<option value="${esc(r)}" ${r === "support_agent" ? "selected" : ""}>${esc(jobOf({ role: r }).job)}</option>`).join("")}</select></label>
      <div class="field"><span>Hours a week</span><p class="ro-h-read"><b id="rHoursOut">20</b><span>hours a week</span></p><input class="ro-slide" type="range" id="rHours" min="1" max="${S.limits?.weekly_hours?.[1] ?? 48}" value="20" aria-label="Hours a week"></div>
      <label class="field"><span>Their name (left empty, they get a plain one)</span><input class="input" id="rName" maxlength="60" placeholder="New starter"></label>
      <p class="od-sub" id="rCost"></p>
      <div class="act-row"><button class="btn primary" type="submit" ${S.team.length >= max ? "disabled" : ""}>Hire them</button></div>
      <p class="said bad" id="rErr" role="alert">${S.team.length >= max ? `The team is full at ${esc(num(max))} people.` : ""}</p>
    </form>`,
  });
  const $ = (id) => over.el.querySelector(`#${id}`);
  const show = () => {
    const like = S.team.find((p) => p.role === $("rRole").value);
    const h = Number($("rHours").value);
    $("rHours").style.setProperty("--fill", `${(h / Number($("rHours").max)) * 100}%`);
    $("rHoursOut").textContent = h;
    const m = like ? monthly(like, h) : null;
    $("rCost").textContent = like ? `Paid like ${like.name}, ${money2(like.hourly_pay)} an hour.${m != null ? ` About ${money(m)} more a month in wages.` : ""} They start tomorrow.` : "";
  };
  show();
  $("rRole").addEventListener("change", show);
  $("rHours").addEventListener("input", show);
  $("rForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = { action: "add", role: $("rRole").value, weekly_hours: Number($("rHours").value), reason: "Hired in Rota" };
    if ($("rName").value.trim()) input.name = $("rName").value.trim();
    const ok = await staff(input, $("rErr"));
    if (ok) { over.close(); said(`Hired${input.name ? ` ${input.name}` : ""}, ${plural(input.weekly_hours, "hour")} a week. They start tomorrow.`); }
  });
  $("rRole").focus();
}

// ------------------------------------------------------------------ the week

/** People down the side, days across; each shift a flat bar of one hue, placed at its start time in the open day. */
function drawWeek(view) {
  const open = openDays();
  const len = openLength();
  const startH = Number(String(S.company?.working_hours?.mon_sat || "09:00").slice(0, 2)) || 9;
  const todayIdx = (new Date(`${today()}T00:00:00Z`).getUTCDay() + 6) % 7;
  view.innerHTML = `<div class="v-wrap is-wide">
    <p class="t-lede ro-lede">Each bar is one day's shift, from when they start. A full cell is the whole opening day. Hours are totalled on the right.</p>
    <div class="ro-grid" role="table" aria-label="The week's shifts">
      <div class="ro-g-row ro-g-headrow" role="row"><span role="columnheader"></span>${DAYS.map((d, i) => `<span role="columnheader" class="${i === todayIdx ? "is-today" : ""}">${d}</span>`).join("")}<span role="columnheader" class="r">Hours</span></div>
      ${S.team.map((p) => {
        const perDay = hoursOf(p) / open.length;
        const from = p.shift_start ? Number(p.shift_start.slice(0, 2)) + Number(p.shift_start.slice(3, 5)) / 60 - startH : 0;
        const left = Math.max(0, Math.min(1, from / len));
        const width = Math.max(0.02, Math.min(1 - left, perDay / len));
        return `<div class="ro-g-row" role="row"><button class="ro-g-who" role="rowheader" data-id="${esc(p.id)}">${esc(p.name)}</button>
          ${DAYS.map((d, i) => open.includes(i)
            ? `<span role="cell" class="ro-g-cell${i === todayIdx ? " is-today" : ""}" title="${esc(p.name)}, ${d}: ${Math.round(perDay * 10) / 10} hours from ${esc(p.shift_start || "opening")}"><i style="left:${(left * 100).toFixed(1)}%;width:${(width * 100).toFixed(1)}%"></i></span>`
            : `<span role="cell" class="ro-g-cell is-closed"></span>`).join("")}
          <span role="cell" class="ro-g-total">${esc(num(hoursOf(p)))}</span></div>`;
      }).join("")}
    </div>
  </div>`;
  view.querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", () => openPerson(b.dataset.id)));
}

// ------------------------------------------------------------------ how busy

function busyWord(stretch) {
  if (stretch == null) return { word: "Too few to tell", tone: "neutral" };
  if (stretch > 1.5) return { word: "Stretched", tone: "bad" };
  if (stretch > 1.2) return { word: "Busier than usual", tone: "warn" };
  if (stretch < 0.8) return { word: "Quieter than usual", tone: "info" };
  return { word: "As usual", tone: "good" };
}

function busyRows() {
  const scale = S.company?.scale || 1;
  return S.load.map((l) => {
    const people = S.team.filter((p) => jobOf(p).team === l.team);
    const hoursNow = people.reduce((n, p) => n + hoursOf(p), 0);
    const planned = (S.company?.staffing_now || []).filter((p) => jobOf(p).team === l.team).reduce((n, p) => n + p.weekly_hours / scale, 0);
    // A handful of items a week swings wildly, so tiny numbers are not judged.
    const ratio = l.usual > 0 && (l.usual >= 2 || l.now >= 4) ? l.now / l.usual : null;
    const hours = planned > 0 ? hoursNow / planned : 1;
    // More work than usual, or fewer hours to do it in, both stretch a team.
    const stretch = ratio == null ? null : hours > 0 ? ratio / hours : 9;
    return { ...l, people, hoursNow, planned, stretch, b: busyWord(stretch) };
  });
}

/** Work in the last seven days against an ordinary week, per team: a table with one bar, a tick at "as usual". */
function drawBusy(view) {
  const rows = busyRows();
  view.innerHTML = `<div class="v-wrap">
    <p class="t-lede ro-lede">The last seven days against an ordinary week, for the hours each team has. The tick on each bar is an ordinary week.</p>
    ${rows.length ? `<table class="tbl ro-busy"><thead><tr><th>Team</th><th>Work</th><th class="r">This week</th><th class="r">Usually</th><th class="r">Hours</th><th class="ro-b-h"></th><th>How it feels</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="w5">${esc(r.team)}</td><td class="muted">${esc(r.work)}</td><td class="r">${esc(num(Math.round(r.now)))}</td><td class="r muted">${esc(num(Math.round(r.usual)))}</td>
        <td class="r">${esc(num(Math.round(r.hoursNow)))}${r.planned && Math.round(r.hoursNow) !== Math.round(r.planned) ? `<small class="ro-sub">plan ${esc(num(Math.round(r.planned)))}</small>` : ""}</td>
        <td class="ro-b"><span class="ro-bar${r.b.tone === "bad" ? " is-bad" : ""}" style="--w:${Math.min(1, (r.stretch ?? 1) / 2).toFixed(3)}"><i></i><b></b></span></td>
        <td>${r.b.tone === "bad" ? `<span class="pill bad">${esc(r.b.word)}</span>` : `<span class="${r.b.tone === "warn" ? "w5" : "muted"}">${esc(r.b.word)}</span>`}</td></tr>`).join("")}
    </tbody></table>` : emptyState({ title: "Nothing to compare yet." })}
  </div>`;
}

// ------------------------------------------------------------------ what the changes did, who joined when

function drawResults(view) {
  view.innerHTML = `<div class="v-wrap">
    ${S.results.length ? `<ul class="rs-list">${S.results.slice(0, 10).map((a) => changeCard(a, describe(a), MEASURES)).join("")}</ul>`
      : `<p class="rs-empty">Change someone's hours or hire someone. Then move time on. Each change shows here with what it did, against the same business left alone.</p>`}
  </div>`;
}

function drawJoined(view) {
  const joins = S.team.filter((p) => p.joined).slice().sort((a, b) => (a.joined < b.joined ? -1 : 1));
  view.innerHTML = `<div class="v-wrap">
    ${joins.length ? `<ul class="od-rows">${joins.map((p) => `<li><time>${esc(monthYear(p.joined).replace(/^(\w{3})\w*/, "$1"))}</time>${avatar(p.name, { size: 28 })}<span class="grow"><b>${esc(p.name)}</b><small>${esc(jobOf(p).job)}</small></span></li>`).join("")}</ul>` : emptyState({ title: "No dates to show." })}
    ${S.timeline?.length ? `<section class="sect"><h2 class="t-h">The company's story</h2><ul class="od-rows">${S.timeline.map(tlItem).join("")}</ul></section>` : ""}
  </div>`;
}

// ------------------------------------------------------------------ drawing, routing, keyboard, staying live

let failedLoad = null;

function draw() {
  markNav();
  const view = main.querySelector("#view");
  if (failedLoad) { view.innerHTML = `<div class="v-wrap">${emptyState({ title: "The team did not load.", text: "Try again in a moment." })}</div>`; return; }
  if (!S.team.length) return;
  const scroll = view.scrollTop;
  ({ team: drawTeam, week: drawWeek, busy: drawBusy, results: drawResults, joined: drawJoined })[S.view](view);
  view.scrollTop = scroll;
}

function route() {
  const id = location.hash.replace(/^#/, "");
  const was = S.view;
  S.view = VIEWS.some((v) => v.id === id) ? id : "team";
  draw();
  if (was !== S.view) main.querySelector("#view").scrollTop = 0;
}

async function refresh() {
  if (S.busy) { S.again = true; return; }
  S.busy = true;
  try {
    const r = await load();
    failedLoad = r.ok ? null : r.error;
    draw();
  } finally {
    S.busy = false;
    if (S.again) { S.again = false; refresh(); }
  }
}

/**
 * The keyboard. Keys act only when you are not typing and nothing is open over the page.
 *   1 to 5: the five views   H: hire someone   J or Down, K or Up: move through the people (Enter opens)
 */
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".over")) return;
  if (e.target.closest?.("input, textarea, select")) { if (e.key === "Escape") e.target.blur(); return; }
  const n = Number(e.key);
  if (n >= 1 && n <= VIEWS.length) { e.preventDefault(); location.hash = `#${VIEWS[n - 1].id}`; return; }
  if (e.key === "h") { e.preventDefault(); openHire(); return; }
  const down = e.key === "j" || e.key === "ArrowDown", up = e.key === "k" || e.key === "ArrowUp";
  if (!down && !up) return;
  const items = [...main.querySelectorAll("#view [data-id]")];
  if (!items.length) return;
  e.preventDefault();
  const at = items.indexOf(document.activeElement);
  const next = items[at < 0 ? 0 : Math.max(0, Math.min(items.length - 1, at + (down ? 1 : -1)))];
  next.focus();
  next.scrollIntoView({ block: "nearest" });
});

shell();
main.querySelector("#view").innerHTML = `<div class="v-wrap">${skeleton(6)}</div>`;
S.view = VIEWS.some((v) => v.id === location.hash.slice(1)) ? location.hash.slice(1) : "team";
await refresh();
window.addEventListener("hashchange", route);

document.addEventListener("ot:day", (e) => {
  if (e.detail?.now) S.now = e.detail.now;
  if (e.detail?.partial) return;
  S.said = null;  // once time has moved, "What changes did" says what each change did
  refresh();
});
world.onChange((change) => {
  if (change.reset) { S.company = null; S.timeline = null; S.said = null; refresh(); return; }
  if (change.source === "local") return;
  if (change.entries.some((e) => !isScreenRead(e))) refresh();
});

// ------------------------------------------------------------------ plain words for a change

function describe(a) {
  const line = plainText((a.changes || []).join(" "));
  let m = line.match(/\(([^)]+)\) weekly_hours ([\d.]+) → ([\d.]+)/);
  if (m) return `${m[1]}: ${m[2]} to ${m[3]} hours a week.`;
  m = line.match(/\(([^)]+)\) hired as ([a-z_]+), ([\d.]+) hours/);
  if (m) return `Hired ${m[1]} (${jobOf({ role: m[2] }).job.toLowerCase()}), ${m[3]} hours a week.`;
  m = line.match(/\(([^)]+)\) left the team/);
  if (m) return `${m[1]} left the team.`;
  return "The team changed.";
}

