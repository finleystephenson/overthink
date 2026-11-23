// The team's own work in the simulation, beside customers and parcels: assigned tasks, a daily record of how busy each
// person was, and new reviews written into the records. Called from simulation/simulator/core.mjs. Browser-safe, no randomness of its
// own beyond streams keyed by business facts (so a live world and its shadow twin stay in step when nothing is done).
import { spendOnTask, capacityMinutes } from "./staff.mjs";
import { rngFor } from "../../business/builder/world/rng.mjs";

const OPEN = ["to_do", "doing"];
/** Days of staff_load kept in the state (get_workload reads the last few). */
const LOAD_DAYS = 90;
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Today's work on assigned tasks: each person on shift spends minutes on their open tasks (soonest due first) until the
 * day's task time is used. `urgent` true works only urgent tasks (done before customers), false only the rest (after).
 * @param {{state: object, team: Array<object>, now: string, urgent: boolean, usedToday: Map<string, number>}} o
 * @return {Array<object>} Tasks finished in this call.
 */
export function workTasks({ state, team, now, urgent, usedToday }) {
  const tasks = state.tasks || [];
  if (!tasks.length) return [];
  const done = [];
  for (const p of team) {
    if (!p.on) continue;
    const mine = tasks.filter((t) => t.assignee === p.id && OPEN.includes(t.status) && (t.priority === "urgent") === urgent)
      .sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")) || (a.id < b.id ? -1 : 1));
    for (const t of mine) {
      const spent = spendOnTask(p, t.minutes - (t.minutes_done || 0), usedToday.get(p.id) || 0);
      if (!spent) break;
      usedToday.set(p.id, (usedToday.get(p.id) || 0) + spent);
      t.minutes_done = r1((t.minutes_done || 0) + spent);
      (t.history ||= []).push({ at: now, by: p.id, event: `Worked on it for ${Math.round(spent)} minutes` });
      if (t.minutes_done >= t.minutes - 0.05) {
        t.status = "done"; t.completed_at = now; t.minutes_done = t.minutes;
        t.history.push({ at: now, by: p.id, event: "Done" });
        done.push(t);
      } else t.status = "doing";
    }
  }
  return done;
}

/** Writes today's load per person (minutes worked, minutes contracted, overtime) to state.staff_load. */
export function recordLoad(state, date, team) {
  const rows = (state.staff_load ||= []);
  rows.push({ date, people: team.map((p) => ({ id: p.id, minutes: r1(p.taskMinutes), capacity: p.on ? r1(capacityMinutes(p)) : 0, overtime: r1(p.overtimeMinutes) })) });
  if (rows.length > LOAD_DAYS) rows.splice(0, rows.length - LOAD_DAYS);
}

const REVIEW_TEXT = {
  5: ["{p} is exactly what it says. Very pleased.", "Well packed, quick, and {p} does the job. Would buy again.", "Bought {p} on a whim. No regrets at all.", "{p} made me laugh and then turned out to be useful."],
  4: ["{p} is good. One small quibble, but I would buy it again.", "Happy with {p}. {late}", "Does what it should. {p} is better made than I expected."],
  3: ["{p} is fine. Nothing more, nothing less.", "{p} is all right. {late}", "It works. I expected a little more from {p}."],
  2: ["Disappointed with {p}. {late}", "{p} is not what I hoped for. {help}", "Not great. {p} feels cheaper than the price."],
  1: ["{p}: {late} {help}", "Would not buy {p} again. {help}", "Poor. {p} let me down and {help2}"],
};

/**
 * A review the simulator decided a customer wrote, as a record in the shape of the history's (reviews.json), so the
 * help desk, the customer page and the shop's reputation all read the same thing. Its words come from a small bank,
 * keyed by the order, and say what actually went wrong (a late parcel, a contact nobody sorted out).
 * @param {{state: object, world: object, seed: number, order: object, rating: number, date: string, late: boolean, badHelp: boolean}} o
 * @return {object} The review (already appended to state.reviews).
 */
export function writeReview({ state, world, seed, order, rating, date, late, badHelp }) {
  const list = (state.reviews ||= []);
  const top = list.reduce((n, r) => Math.max(n, Number(String(r.id).split("-")[1]) || 0), 0);
  const item = order.items[0];
  const product = world.index.skus[item.sku]?.product;
  const r = rngFor(seed, "review-text", order.number);
  const text = r.pick(REVIEW_TEXT[rating]).replace(/\{p\}/g, product?.name || item.name)
    .replace("{late}", late ? "It came later than promised." : rating >= 4 ? "Arrived on time." : "")
    .replace("{help2}", badHelp ? "when I wrote in, nobody sorted it out." : "it was not what was described.")
    .replace("{help}", badHelp ? "I wrote in and it still is not sorted." : "").replace(/\s+/g, " ").trim();
  const rec = { id: `REV-${String(top + 1).padStart(4, "0")}`, customer_id: order.customer_id, order_number: order.number, product: product?.id || null, sku: item.sku, rating, text, date, source: "simulated" };
  list.push(rec);
  return rec;
}
