// Kettle's Team pages, beside the chat: the people (org chart, skills, hours, pay and how busy each one really is),
// their tasks, and the staffing levers (hours, hiring, letting someone go) that used to be Rota.
// Reads: get_org_chart, list_staff, get_workload, list_tasks, get_task. Acts: create_task, update_task,
// complete_task, set_staffing. In the simulation a task takes real minutes of its assignee's day, so giving work
// here slows replies or adds overtime; how busy each person was comes from the simulator's own record.
import { esc, avatar, emptyState, skeleton, money2, plural, toast, words, timeParts } from "../lib/ui.js";
import { recordChip, wireRecordChips } from "../lib/records.js";
import { plainRef } from "../lib/plain.js";

const LINK_WORDS = { order: "order", case: "case", po: "purchase order", supplier_id: "supplier", customer_id: "customer", review: "review" };
const PAGES = [["people", "People"], ["tasks", "Tasks"], ["hours", "Hours and pay"]];

/**
 * Draws one Team page into `el`.
 * @param {{world: object, el: HTMLElement, page: string, now: string, openDm: function(string): void, focusTask?: string}} ctx
 */
export async function showTeam(ctx) {
  const { el, page } = ctx;
  el.innerHTML = `<div class="tm">${skeleton(10)}</div>`;
  const draw = { people: drawPeople, tasks: drawTasks, hours: drawHours }[page] || drawPeople;
  await draw(ctx);
}

/** The pages as rail rows, for app.js. */
export function teamRail(on) {
  return PAGES.map(([id, label]) => `<li><button type="button" class="side-item${on === id ? " is-on" : ""}" data-team="${id}"><span class="hash" aria-hidden="true">·</span><span class="side-name">${label}</span></button></li>`).join("");
}

function read(world, tool, input = {}) {
  return world.call(tool, input, { screen: true });
}

function said(el, res, good) {
  el.textContent = res.ok ? good : res.error.message;
  el.dataset.tone = res.ok ? "good" : "bad";
}

function dueWords(d) {
  if (!d) return "";
  const p = timeParts(`${d}T12:00:00Z`);
  return `due ${p.day} ${p.monthShort}`;
}

// ------------------------------------------------------------------ people

async function drawPeople(ctx) {
  const { world, el } = ctx;
  const [org, staff, load, tasks] = await Promise.all([read(world, "get_org_chart"), read(world, "list_staff"), read(world, "get_workload", { days: 7 }), read(world, "list_tasks", { limit: 200 })]);
  if (!org.ok) { el.innerHTML = emptyState({ title: org.error.message }); return; }
  const byId = new Map(org.data.people.map((p) => [p.id, { ...p }]));
  for (const s of staff.ok ? staff.data.team : []) Object.assign(byId.get(s.id) || {}, { hours: s.weekly_hours, pay: s.hourly_pay, monthly: s.monthly_cost, joined: s.joined });
  for (const w of load.ok ? load.data.people : []) Object.assign(byId.get(w.id) || {}, { load: w });
  const people = [...byId.values()];
  const top = people.filter((p) => !p.reports_to || !byId.has(p.reports_to));
  const kids = (id) => people.filter((p) => p.reports_to === id);
  const node = (p) => `<li><button class="tm-node" data-person="${esc(p.id)}">${avatar(p.name, { size: 28 })}<span><b>${esc(p.name)}</b><small>${esc(p.job || words(p.role))}</small></span>${loadBar(p.load)}</button>
    ${kids(p.id).length ? `<ul>${kids(p.id).map(node).join("")}</ul>` : ""}</li>`;
  const recorded = load.ok && load.data.days.length;
  el.innerHTML = `<div class="tm">
    <header class="tm-head"><h2 class="pm-h2">People</h2><p class="tm-sub">Who reports to whom, and how full each person's day was ${recorded ? `over the last ${plural(load.data.days.length, "working day")}` : "(move time on to see it)"}.</p></header>
    <ul class="tm-tree">${top.map(node).join("")}</ul>
    <div class="tm-detail" id="tm-detail"></div>
  </div>`;
  el.querySelectorAll("[data-person]").forEach((b) => b.addEventListener("click", () => {
    el.querySelectorAll("[data-person]").forEach((x) => x.classList.toggle("is-on", x === b));
    personDetail(ctx, byId.get(b.dataset.person), byId, tasks.ok ? tasks.data.tasks : []);
  }));
}

/** How full a person's day was: a thin bar, ink up to their hours, the over-run past it. */
function loadBar(l) {
  if (!l || l.load == null) return `<span class="tm-load tm-load-none" title="No days recorded yet"></span>`;
  const pct = Math.round(l.load * 100);
  return `<span class="tm-load" title="${pct}% of their hours${l.overtime_minutes ? `, ${Math.round(l.overtime_minutes)} minutes over` : ""}"><span style="width:${Math.min(100, pct)}%"></span></span><span class="tm-pct">${pct}%</span>`;
}

function personDetail(ctx, p, byId, tasks) {
  const box = ctx.el.querySelector("#tm-detail");
  const mine = tasks.filter((t) => t.assignee === p.id);
  const l = p.load;
  box.innerHTML = `<article class="tm-card">
    <header class="tm-card-head">${avatar(p.name, { size: 44 })}<div><h3 class="pm-h3">${esc(p.name)}</h3><p class="tm-sub">${esc(p.job || words(p.role))}${p.reports_to ? ` · reports to ${esc(byId.get(p.reports_to)?.name || "")}` : ""}</p></div></header>
    <p>${esc(p.why)}</p>
    <ul class="tm-facts">
      <li><span>Good at</span><b>${esc(p.skills.join(", "))}</b></li>
      <li><span>Hours a week</span><b>${p.hours != null ? esc(p.hours) : ""}</b></li>
      <li><span>Pay an hour</span><b>${p.pay != null ? esc(money2(p.pay)) : ""}</b></li>
      <li><span>Costs a month</span><b>${p.monthly != null ? esc(money2(p.monthly)) : ""}</b></li>
      <li><span>A working day</span><b>${l?.minutes_a_day != null ? `${esc(Math.round(l.minutes_a_day))} of ${esc(Math.round(l.capacity_a_day))} minutes used` : "Not recorded yet"}</b></li>
      <li><span>Overtime this week</span><b>${l ? `${esc(Math.round(l.overtime_minutes))} minutes` : ""}</b></li>
    </ul>
    <h4 class="tm-h">Their tasks</h4>
    ${mine.length ? `<ul class="tm-tasks">${mine.map(taskRow).join("")}</ul>` : `<p class="tm-sub">Nothing assigned.</p>`}
    <div class="tm-row"><button class="btn small primary" data-give>Give them a task</button><button class="btn small" data-dm>Message them</button></div>
    <div id="tm-give"></div>
  </article>`;
  wireRecordChips(box, ctx.world);
  box.querySelector("[data-dm]").addEventListener("click", () => ctx.openDm(p.id));
  box.querySelector("[data-give]").addEventListener("click", () => taskForm(ctx, box.querySelector("#tm-give"), [...byId.values()], p.id));
}

// ------------------------------------------------------------------ tasks

function taskRow(t) {
  const pct = Math.round(((t.minutes_done || 0) / t.minutes) * 100);
  const links = Object.entries(t.links || {}).filter(([k]) => LINK_WORDS[k]).map(([k, id]) => recordChip(k, id)).join("");
  return `<li class="tm-task${t.overdue ? " is-late" : ""}" data-task="${esc(t.id)}">
    <div class="tm-task-main"><b>${esc(t.title)}</b><small>${esc(t.assignee_name)} · ${esc(words(t.status))}${t.priority === "urgent" ? " · urgent" : ""}${t.due ? ` · ${esc(dueWords(t.due))}` : ""}${t.overdue ? " · late" : ""} · ${esc(Math.round(t.minutes_done || 0))} of ${esc(t.minutes)} minutes</small>
      <span class="tm-progress" aria-label="${pct}% done"><span style="width:${pct}%"></span></span>${links ? `<span class="tm-links">${links}</span>` : ""}</div>
    ${["to_do", "doing"].includes(t.status) ? `<div class="tm-task-acts"><button class="btn small" data-done="${esc(t.id)}">Done</button><button class="btn small ghost" data-cancel="${esc(t.id)}">Cancel</button></div>` : ""}
  </li>`;
}

async function drawTasks(ctx) {
  const { world, el } = ctx;
  const filter = ctx.filter || "open";
  const [list, org] = await Promise.all([read(world, "list_tasks", { status: filter, limit: 200 }), read(world, "get_org_chart")]);
  if (!list.ok) { el.innerHTML = emptyState({ title: list.error.message }); return; }
  const people = org.ok ? org.data.people : [];
  el.innerHTML = `<div class="tm">
    <header class="tm-head"><h2 class="pm-h2">Tasks</h2><p class="tm-sub">Work given to people. Each task comes out of its person's day: urgent ones before customers, the rest after.</p>
      <div class="tm-row"><div class="tm-seg" role="tablist">${[["open", "To do"], ["done", "Done"], ["all", "All"]].map(([id, l]) => `<button class="pm-chip${filter === id ? " is-on" : ""}" data-filter="${id}">${l}</button>`).join("")}</div>
      <button class="btn small primary" data-new>New task</button></div></header>
    <div id="tm-give"></div>
    ${list.data.tasks.length ? `<ul class="tm-tasks">${list.data.tasks.map(taskRow).join("")}</ul>` : `<p class="empty">${filter === "open" ? "Nobody has a task. Give one with New task." : "No tasks here."}</p>`}
  </div>`;
  wireRecordChips(el, world);
  el.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => showTeam({ ...ctx, filter: b.dataset.filter })));
  el.querySelector("[data-new]").addEventListener("click", () => taskForm(ctx, el.querySelector("#tm-give"), people, null));
  wireTaskActions(ctx, el);
  if (ctx.focusTask) el.querySelector(`[data-task="${CSS.escape(ctx.focusTask)}"]`)?.scrollIntoView({ block: "center" });
}

function wireTaskActions(ctx, root) {
  root.querySelectorAll("[data-done]").forEach((b) => b.addEventListener("click", async () => {
    const res = await ctx.world.call("complete_task", { task_id: b.dataset.done });
    if (!res.ok) { toast(res.error.message, { tone: "bad" }); return; }
    toast("Marked done.");
    showTeam(ctx);
  }));
  root.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", async () => {
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Press again to cancel"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Cancel"; }, 3000); return; }
    const res = await ctx.world.call("update_task", { task_id: b.dataset.cancel, status: "cancelled" });
    if (!res.ok) { toast(res.error.message, { tone: "bad" }); return; }
    toast("Task cancelled.");
    showTeam(ctx);
  }));
}

/** The new-task form: who, what, how long, by when, urgent or not, and the record it is about. */
function taskForm(ctx, box, people, assignee) {
  box.innerHTML = `<form class="tm-form">
    <label class="field"><span class="pm-label">What needs doing</span><input class="input" name="title" required maxlength="140" placeholder="Ring the customer about their parcel"></label>
    <div class="tm-row">
      <label class="field"><span class="pm-label">Who</span><select class="select" name="assignee">${people.map((p) => `<option value="${esc(p.id)}" ${p.id === assignee ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
      <label class="field"><span class="pm-label">Minutes</span><input class="input" name="minutes" type="number" min="5" max="960" value="30"></label>
      <label class="field"><span class="pm-label">By</span><input class="input" name="due" type="date"></label>
      <label class="field"><span class="pm-label">Urgent</span><select class="select" name="priority"><option value="normal">No</option><option value="urgent">Yes, before customers</option></select></label>
    </div>
    <label class="field"><span class="pm-label">About (optional): an order, case or purchase order number</span><input class="input" name="about" placeholder="ORD-10694, CASE-9158 or PO-3289"></label>
    <div class="tm-row"><button class="btn primary small" type="submit">Give the task</button><button class="btn small ghost" type="button" data-x>Cancel</button><span class="tm-said" aria-live="polite"></span></div>
  </form>`;
  const form = box.querySelector("form");
  form.querySelector("[data-x]").addEventListener("click", () => { box.innerHTML = ""; });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const about = String(f.get("about") || "").trim().toUpperCase();
    const links = /^ORD-\d+$/.test(about) ? { order: about } : /^CASE-\d+$/.test(about) ? { case: about } : /^PO-\d+$/.test(about) ? { po: about } : /^C-\d+$/.test(about) ? { customer_id: about } : {};
    const input = { title: f.get("title"), assignee: f.get("assignee"), minutes: Number(f.get("minutes")), priority: f.get("priority"), links };
    if (f.get("due")) input.due = f.get("due");
    const out = form.querySelector(".tm-said");
    if (about && !Object.keys(links).length) { said(out, { ok: false, error: { message: "Give a number like ORD-10694, CASE-9158 or PO-3289." } }); return; }
    const res = await ctx.world.call("create_task", input);
    said(out, res, res.ok ? `Given to ${res.data.assignee_name}${links.order || links.case || links.po ? `, about ${plainRef(Object.values(links)[0], { lower: true })}` : ""}.` : "");
    if (res.ok) setTimeout(() => showTeam(ctx), 700);
  });
  form.querySelector("input").focus();
}

// ------------------------------------------------------------------ hours and pay (the staffing levers)

async function drawHours(ctx) {
  const { world, el } = ctx;
  const staff = await read(world, "list_staff");
  if (!staff.ok) { el.innerHTML = emptyState({ title: staff.error.message }); return; }
  const canChange = world.role === "manager";
  const team = staff.data.team;
  const total = team.reduce((n, p) => n + (p.monthly_cost || 0), 0);
  const roles = [...new Set(team.map((p) => p.role))];
  el.innerHTML = `<div class="tm">
    <header class="tm-head"><h2 class="pm-h2">Hours and pay</h2><p class="tm-sub">The team costs ${esc(money2(total))} a month. Changes start on the next simulated day; more hours answer customers and pack parcels faster, and cost more.${canChange ? "" : " Only the manager can change the team."}</p></header>
    <table class="tm-table"><thead><tr><th>Who</th><th>Job</th><th class="num">Hours a week</th><th class="num">Pay an hour</th><th class="num">A month</th><th></th></tr></thead>
    <tbody>${team.map((p) => `<tr data-row="${esc(p.id)}"><td>${esc(p.name)}</td><td>${esc(p.job || words(p.role))}</td>
      <td class="num">${canChange ? `<input class="input tm-hours" type="number" min="0" max="48" step="0.5" value="${esc(p.plan_weekly_hours)}" aria-label="Planned hours for ${esc(p.name)}"><small class="tm-real">${esc(p.weekly_hours)} at this size</small>` : esc(p.weekly_hours)}</td>
      <td class="num">${esc(money2(p.hourly_pay))}</td><td class="num">${p.monthly_cost != null ? esc(money2(p.monthly_cost)) : ""}</td>
      <td>${canChange ? `<button class="btn small" data-save="${esc(p.id)}">Save</button> <button class="btn small ghost" data-remove="${esc(p.id)}">Let go</button>` : ""}<span class="tm-said"></span></td></tr>`).join("")}</tbody></table>
    ${canChange ? `<form class="tm-form" id="tm-hire"><h3 class="pm-h3">Hire someone</h3><div class="tm-row">
      <label class="field"><span class="pm-label">Job</span><select class="select" name="role">${roles.map((r) => `<option value="${esc(r)}">${esc(words(r))}</option>`).join("")}</select></label>
      <label class="field"><span class="pm-label">Hours a week</span><input class="input" name="weekly_hours" type="number" min="1" max="48" value="16"></label>
      <label class="field"><span class="pm-label">Name</span><input class="input" name="name" placeholder="Optional"></label>
      <button class="btn primary small" type="submit">Hire</button><span class="tm-said" aria-live="polite"></span></div></form>` : ""}
  </div>`;
  el.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", async () => {
    const row = b.closest("tr");
    const res = await world.call("set_staffing", { action: "hours", staff_id: b.dataset.save, weekly_hours: Number(row.querySelector(".tm-hours").value) });
    said(row.querySelector(".tm-said"), res, "Saved. From tomorrow.");
  }));
  el.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", async () => {
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Press again to let go"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Let go"; }, 3000); return; }
    const res = await world.call("set_staffing", { action: "remove", staff_id: b.dataset.remove });
    if (res.ok) { toast("They have left the team."); showTeam(ctx); } else said(b.closest("tr").querySelector(".tm-said"), res, "");
  }));
  el.querySelector("#tm-hire")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const input = { action: "add", role: f.get("role"), weekly_hours: Number(f.get("weekly_hours")) };
    if (f.get("name")) input.name = f.get("name");
    const res = await world.call("set_staffing", input);
    said(e.target.querySelector(".tm-said"), res, "Hired. They start tomorrow.");
    if (res.ok) setTimeout(() => showTeam(ctx), 900);
  });
}
