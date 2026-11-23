// Tasks, workload and the org chart: the team as people with work to do. An extension of engine.js.
//
// Records:
//   state.tasks       { id: "TASK-0001", title, detail, assignee (staff id), created_by, created_at, due, priority
//                       ("normal" | "urgent"), minutes (estimate), minutes_done, status ("to_do" | "doing" | "done" |
//                       "cancelled"), links { order, case, po, supplier_id, customer_id, review }, completed_at, history }
//   state.staff_load  one row a simulated day, written by simulation/simulator/core.mjs: { date, people: [{ id, minutes, capacity, overtime }] }
// The simulator (simulation/simulator/core.mjs workTasks) has each assignee spend real minutes of their day on their open tasks
// (urgent ones before customers, the rest after) and marks a task done when its minutes are spent. So a task costs
// the business staff time, and can slow replies or add overtime. A person can also mark a task done themselves.
// The org chart (reporting lines, skills, why each person is here) is business/data/team.json.
import { extend, kit } from "./engine.js";
import { ROSTER } from "./comms.js";
import TEAM from "../../business/data/team.json" with { type: "json" };

const { fail, nextId, stamp, ms, dateOf, round2, schema: { str, obj }, roles } = kit;
const int = { type: "integer" };

const STATUSES = ["to_do", "doing", "done", "cancelled"];
const OPEN = ["to_do", "doing"];
const PRIORITIES = ["normal", "urgent"];
/** Estimates a task may carry, in minutes. WHY the cap: one task is at most two working days; bigger work is split. */
const MINUTES = [5, 960];
const DEFAULT_MINUTES = 30;
const LINK_KINDS = ["order", "case", "po", "supplier_id", "customer_id", "review"];

/** The team as the levers say it is today (hires included), else the fixed roster. */
function teamOf(ctx) {
  const plan = ctx.world.plan?.staff;
  const s = ctx.st.settings?.staff || null;
  const removed = new Set(s?.removed || []);
  const base = (Array.isArray(plan) ? plan : ROSTER).filter((p) => !removed.has(p.id)).map((p) => ({ id: p.id, name: p.name, role: p.role }));
  for (const a of s?.added || []) if (!removed.has(a.id)) base.push({ id: a.id, name: a.name, role: a.role });
  return base;
}

function person(ctx, id) {
  return teamOf(ctx).find((p) => p.id === id) || fail("not_found", `No one with id ${id} works here. Ask for the team list to see who does.`);
}

/** The person making the call: the first with the caller's role, or the role itself for one with no person. */
function caller(ctx) {
  const p = teamOf(ctx).find((x) => x.role === ctx.role);
  return p ? p.id : ctx.role;
}

/** Checks each link names a record that exists, so a task always opens onto something real. */
function checkLinks(ctx, links = {}) {
  const out = {};
  for (const [k, v] of Object.entries(links || {})) {
    if (v === undefined || v === null || v === "") continue;
    if (!LINK_KINDS.includes(k)) fail("invalid_input", `A task can link to: ${LINK_KINDS.join(", ")}.`);
    const id = String(v);
    const st = ctx.st;
    const found = k === "order" ? st.orders.some((o) => o.number === id)
      : k === "case" ? st.cases.some((c) => c.number === id)
      : k === "po" ? st.purchase_orders.some((p) => p.number === id)
      : k === "supplier_id" ? st.suppliers.some((s) => s.id === id)
      : k === "customer_id" ? st.customers.some((c) => c.id === id)
      : (st.reviews || []).some((r) => r.id === id);
    if (!found) fail("not_found", `There is no ${k.replace(/_id$/, "")} ${id}.`);
    out[k] = id;
  }
  return out;
}

function checkMinutes(m) {
  if (m === undefined) return DEFAULT_MINUTES;
  if (!Number.isInteger(m) || m < MINUTES[0] || m > MINUTES[1]) fail("invalid_input", `A task takes ${MINUTES[0]} to ${MINUTES[1]} minutes.`);
  return m;
}

function checkDue(d) {
  if (d === undefined || d === null || d === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) fail("invalid_input", "The due date must look like 2026-11-30.");
  return d;
}

function findTask(ctx, id) {
  return (ctx.st.tasks || []).find((t) => t.id === id) || fail("not_found", `There is no task ${id}.`);
}

function logTo(ctx, t, event) {
  (t.history ||= []).push({ at: stamp(ctx), by: caller(ctx), event });
}

/** A task with the assignee's name and whether it is late, for lists and screens. */
function view(ctx, t) {
  const who = teamOf(ctx).find((p) => p.id === t.assignee);
  const today = dateOf(ms(ctx.now));
  return { ...t, assignee_name: who?.name || "Someone who has left", minutes_left: Math.max(0, t.minutes - (t.minutes_done || 0)), overdue: !!(t.due && OPEN.includes(t.status) && t.due < today) };
}

const TOOLS = [
  {
    name: "list_tasks", roles: roles.INTERNAL,
    description: "Tasks, soonest due first (urgent first among the same day): open ones by default. Filters: assignee (a staff id), status (to_do, doing, done, cancelled, open or all), link (any record id: an order, case, purchase order, supplier, customer or review), limit (default 50, at most 200). Each has the assignee's name, minutes left and whether it is overdue.",
    input_schema: obj({ assignee: str, status: str, link: str, limit: int }),
    run(ctx, i) {
      const want = i.status || "open";
      if (![...STATUSES, "open", "all"].includes(want)) fail("invalid_input", `status is one of: ${[...STATUSES, "open", "all"].join(", ")}.`);
      const rows = (ctx.st.tasks || []).filter((t) => (want === "all" || (want === "open" ? OPEN.includes(t.status) : t.status === want))
        && (!i.assignee || t.assignee === i.assignee) && (!i.link || Object.values(t.links || {}).includes(i.link)))
        .sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")) || (a.priority === "urgent" ? -1 : 0) - (b.priority === "urgent" ? -1 : 0) || (a.id < b.id ? -1 : 1));
      const n = Math.min(200, Math.max(1, i.limit || 50));
      return { total: rows.length, tasks: rows.slice(0, n).map((t) => view(ctx, t)) };
    },
  },
  {
    name: "get_task", roles: roles.INTERNAL,
    description: "One task with its history.",
    input_schema: obj({ task_id: str }, ["task_id"]),
    run(ctx, i) { return view(ctx, findTask(ctx, i.task_id)); },
  },
  {
    name: "create_task", roles: roles.INTERNAL,
    description: `Gives someone a piece of work: title, assignee (a staff id), and optionally detail, due (a date), priority (normal or urgent), minutes (the estimate, ${MINUTES[0]} to ${MINUTES[1]}; default ${DEFAULT_MINUTES}) and links { order, case, po, supplier_id, customer_id, review }. In the simulation the assignee spends real minutes of their working day on it (urgent tasks before customers, others after) until it is done, so tasks cost staff time and can slow replies or add overtime. A task linked to a case adds a note to the case when it is done.`,
    input_schema: obj({ title: str, assignee: str, detail: str, due: str, priority: { type: "string", enum: PRIORITIES }, minutes: int, links: { type: "object" } }, ["title", "assignee"]),
    // WHY: work handed to a person should be a record other apps can see and the simulator can spend time on.
    run(ctx, i) {
      const title = String(i.title).trim();
      if (!title) fail("invalid_input", "Give the task a title.");
      if (title.length > 140) fail("invalid_input", "Keep the title under 140 characters; put the rest in the detail.");
      const who = person(ctx, i.assignee);
      const t = {
        id: nextId(ctx, "TASK", 4), title, detail: String(i.detail || "").slice(0, 2000), assignee: who.id, created_by: caller(ctx), created_at: stamp(ctx),
        due: checkDue(i.due), priority: i.priority || "normal", minutes: checkMinutes(i.minutes), minutes_done: 0, status: "to_do",
        links: checkLinks(ctx, i.links), completed_at: null, history: [],
      };
      logTo(ctx, t, `Created and given to ${who.name}`);
      (ctx.st.tasks ||= []).push(t);
      ctx.changes.push(`task ${t.id} created for ${who.id}: ${title}`);
      return view(ctx, t);
    },
  },
  {
    name: "update_task", roles: roles.INTERNAL,
    description: "Changes a task that is not finished: title, detail, assignee, due, priority, minutes (the estimate), status (to_do, doing or cancelled; use complete_task to finish one), and/or a note for its history.",
    input_schema: obj({ task_id: str, title: str, detail: str, assignee: str, due: str, priority: { type: "string", enum: PRIORITIES }, minutes: int, status: { type: "string", enum: ["to_do", "doing", "cancelled"] }, note: str }, ["task_id"]),
    run(ctx, i) {
      const t = findTask(ctx, i.task_id);
      if (!OPEN.includes(t.status)) fail("rule_violation", `${t.id} is ${t.status}; it cannot be changed.`);
      const said = [];
      if (i.title !== undefined) { const v = String(i.title).trim(); if (!v) fail("invalid_input", "The title cannot be empty."); t.title = v.slice(0, 140); said.push("title"); }
      if (i.detail !== undefined) { t.detail = String(i.detail).slice(0, 2000); said.push("detail"); }
      if (i.assignee !== undefined) { const who = person(ctx, i.assignee); t.assignee = who.id; said.push(`given to ${who.name}`); }
      if (i.due !== undefined) { t.due = checkDue(i.due); said.push(t.due ? `due ${t.due}` : "no due date"); }
      if (i.priority !== undefined) { t.priority = i.priority; said.push(i.priority); }
      if (i.minutes !== undefined) { t.minutes = checkMinutes(i.minutes); said.push(`${t.minutes} minutes`); }
      if (i.status !== undefined) { t.status = i.status; said.push(i.status.replace("_", " ")); }
      if (i.note) said.push(`note: ${String(i.note).slice(0, 300)}`);
      if (!said.length) fail("invalid_input", "Say what to change.");
      logTo(ctx, t, said.join("; "));
      ctx.changes.push(`task ${t.id} ${said.join("; ")}`);
      return view(ctx, t);
    },
  },
  {
    name: "complete_task", roles: roles.INTERNAL,
    description: "Marks a task done now, by the caller, with an optional note. (In the simulation, assignees also finish tasks themselves as they spend the minutes.)",
    input_schema: obj({ task_id: str, note: str }, ["task_id"]),
    run(ctx, i) {
      const t = findTask(ctx, i.task_id);
      if (!OPEN.includes(t.status)) fail("already_done", `${t.id} is already ${t.status}.`);
      t.status = "done"; t.completed_at = stamp(ctx); t.minutes_done = Math.max(t.minutes_done || 0, t.minutes);
      logTo(ctx, t, `Done${i.note ? `: ${String(i.note).slice(0, 300)}` : ""}`);
      ctx.changes.push(`task ${t.id} done`);
      return view(ctx, t);
    },
  },
  {
    name: "get_workload", roles: roles.INTERNAL,
    description: "How busy each person is: from the simulator's record of the last `days` working days (default 7): average minutes worked a day against their contracted minutes (load 1 is exactly full), overtime minutes, plus their open tasks and the minutes those still need. Before time has moved there is no record yet, so only tasks show.",
    input_schema: obj({ days: int }),
    run(ctx, i) {
      const n = Math.min(60, Math.max(1, i.days || 7));
      const rows = (ctx.st.staff_load || []).slice(-n);
      const team = teamOf(ctx);
      const people = team.map((p) => {
        const mine = rows.map((r) => r.people.find((x) => x.id === p.id)).filter((x) => x && x.capacity > 0);
        const worked = mine.reduce((s, x) => s + x.minutes, 0), cap = mine.reduce((s, x) => s + x.capacity, 0);
        const open = (ctx.st.tasks || []).filter((t) => t.assignee === p.id && OPEN.includes(t.status));
        return {
          id: p.id, name: p.name, role: p.role, days_recorded: mine.length,
          minutes_a_day: mine.length ? round2(worked / mine.length) : null, capacity_a_day: mine.length ? round2(cap / mine.length) : null,
          load: cap ? round2(worked / cap) : null, overtime_minutes: round2(mine.reduce((s, x) => s + (x.overtime || 0), 0)),
          open_tasks: open.length, task_minutes_left: open.reduce((s, t) => s + Math.max(0, t.minutes - (t.minutes_done || 0)), 0),
        };
      });
      return { days: rows.map((r) => r.date), people };
    },
  },
  {
    name: "get_org_chart", roles: roles.INTERNAL,
    description: "The team as an organisation: each person with their role, job, who they report to, their skills, what they usually own (which decides who answers in staff chat) and why they are here. Someone hired at run time reports to whoever that role reports to.",
    input_schema: obj({}),
    run(ctx) {
      const plan = new Map((ctx.world.plan?.staff || []).map((p) => [p.id, p]));
      const team = teamOf(ctx);
      const like = (role) => team.find((p) => p.role === role && TEAM.people[p.id]);
      return {
        people: team.map((p) => {
          const org = TEAM.people[p.id] || { ...(TEAM.people[like(p.role)?.id] || {}), why: "Hired to share the work of the role." };
          return { id: p.id, name: p.name, role: p.role, job: plan.get(p.id)?.job || null, reports_to: org.reports_to ?? null, skills: org.skills || [], owns: org.owns || [], why: org.why || "" };
        }),
      };
    },
  },
];

extend({
  state: ["tasks", "staff_load"],
  counters: [["TASK", "tasks", "id"]],
  tools: TOOLS,
});

/** The org data, for the simulator's chat plug-in (who answers what). */
export const ORG = TEAM.people;
