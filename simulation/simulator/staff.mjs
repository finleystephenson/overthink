// The team at work. Each person has a shift (start, length from weekly hours) and works the contact queue in order,
// at their own task speed. Work beyond the shift is overtime for people marked overtime: true. `scale` multiplies every
// person's hours and pay (read each person as "this role, times the scale"), so a person's minutes go further.
import { WD } from "./lib.mjs";

const OVERTIME_MAX = 120; // minutes a person will stay late on a bad day
/**
 * Below scale 1 a person is not "a fraction of a person working 50 times slower": they work at normal speed for
 * fewer minutes, spread over their usual shift (a small shop's owner checks the inbox through the day). These minutes
 * a day can always be worked beyond the contracted share, as overtime, so hours never round to nothing and one
 * person can answer the handful of contacts a tiny shop gets.
 */
const SMALL_SHOP_EXTRA_MINUTES = 30;

const clock = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

export function makeTeam(staffData, costs, scale) {
  // WHY two models: at scale 1 and above the arithmetic is exactly as it always was (a person's minutes go further);
  // below 1 the "budget" model above keeps response times true to a small business.
  const budgeted = scale < 1;
  return staffData.staff.map((s) => ({
    ...s, scale: budgeted ? 1 : scale, payScale: scale, budgeted, rate: s.hourly_pay * (1 + costs.on_cost_rate), startMin: clock(s.start || staffData.day_start || "09:00"),
    dayMin: (s.weekly_hours / staffData.days.length) * 60, free: 0, end: 0, normalEnd: 0, on: false, taskMinutes: 0, overtimeMinutes: 0, fixedMinutes: 0,
    budget: 0, used: 0,
  }));
}

/** Minutes of work this person has left today within their normal hours. */
export function freeMinutes(p) {
  return p.budgeted ? Math.max(0, p.budget - p.used) : Math.max(0, p.normalEnd - p.free) * p.scale;
}

/** Minutes of work this person has today within their normal hours. */
export function capacityMinutes(p) {
  return p.budgeted ? p.budget : (p.normalEnd - p.startMin) * p.scale;
}

/** Start a working day: who is in, from when to when. Fixed daily minutes (admin) are taken off the shift. */
export function beginDay(team, staffData, dateWeekday) {
  const day = WD[dateWeekday];
  for (const p of team) {
    p.on = staffData.days.includes(day);
    p.free = p.startMin;
    const fixed = p.on ? p.fixed_daily_minutes || 0 : 0;
    p.fixedMinutes += fixed;
    if (p.budgeted) {
      // Available across the whole usual shift, for their share of the minutes (fixed duties scale too).
      p.used = 0;
      p.budget = Math.max(0, p.dayMin - fixed) * p.payScale;
      p.normalEnd = p.startMin + p.dayMin;
      p.end = p.normalEnd + OVERTIME_MAX;
      continue;
    }
    p.normalEnd = p.startMin + Math.max(0, p.dayMin - fixed);
    p.end = p.normalEnd + (p.overtime ? OVERTIME_MAX : 0);
  }
}

/** Minutes this person needs for a contact: the channel task plus the topic task, at their speed, divided by the scale. */
export const minutesFor = (p, tasks) => {
  let m = 0;
  for (const t of tasks) { if (t == null) continue; if (p.tasks[t] === undefined) return null; m += p.tasks[t]; }
  return m / p.scale;
};

/**
 * Pick the person who can start this item soonest and finish inside their shift (normal hours first, then overtime).
 * Returns { person, start, finish, overtime } or null. Does not change anything.
 */
export function pick(team, roles, ready, tasks, share = 1) {
  let best = null;
  for (const overtimeOk of [false, true]) {
    for (const p of team) {
      if (!p.on || !roles.includes(p.role)) continue;
      const m = minutesFor(p, tasks);
      if (m === null) continue;
      const start = Math.max(ready, p.free), finish = start + m * share;
      const limit = overtimeOk ? p.end : p.normalEnd;
      if (p.budgeted) {
        const room = p.budget + (overtimeOk ? Math.max(SMALL_SHOP_EXTRA_MINUTES, OVERTIME_MAX * p.payScale) : 0);
        if (finish > limit || p.used + m * share > room) continue;
      } else if (finish > limit || (overtimeOk && !p.overtime)) continue;
      if (!best || start < best.start) best = { person: p, start, finish, minutes: m * share, overtime: finish > p.normalEnd };
    }
    if (best) return best;
  }
  return null;
}

/** Book it. Minutes past the normal end count as overtime. */
export function commit(slot) {
  const p = slot.person;
  if (p.budgeted) {
    const over = Math.max(0, p.used + slot.minutes - Math.max(p.budget, p.used));
    p.free = slot.finish; p.used += slot.minutes; p.taskMinutes += slot.minutes; p.overtimeMinutes += over;
    return over;
  }
  const over = Math.max(0, slot.finish - Math.max(p.normalEnd, slot.start));
  p.free = slot.finish;
  p.taskMinutes += slot.minutes * p.scale; // work minutes before the scale divides them
  p.overtimeMinutes += over;
  return over;
}

/** Spread a block of minutes (for example packing 40 parcels) over a role's people by their hours; the rest is overtime. */
export function addLoad(team, role, minutes) {
  const people = team.filter((p) => p.on && p.role === role);
  if (!people.length) return { done: 0, overtime: 0 };
  const total = people.reduce((n, p) => n + p.weekly_hours, 0);
  let over = 0;
  for (const p of people) {
    if (p.budgeted) {
      const m = minutes * (p.weekly_hours / total);
      const o = Math.max(0, p.used + m - Math.max(p.budget, p.used));
      p.used += m; p.taskMinutes += m; p.overtimeMinutes += o; over += o;
      continue;
    }
    const m = (minutes / p.scale) * (p.weekly_hours / total);
    const room = Math.max(0, p.normalEnd - p.free);
    p.free += m; p.taskMinutes += minutes * (p.weekly_hours / total);
    if (m > room) { const o = m - room; p.overtimeMinutes += o; over += o; }
  }
  return { done: minutes, overtime: over };
}

/** Pay for the day: contracted hours (a seventh of the week) plus overtime at the overtime rate. */
export function payFor(team, costs) {
  let contracted = 0, overtime = 0;
  for (const p of team) {
    contracted += (p.weekly_hours * (p.budgeted ? p.payScale : p.scale) / 7) * p.rate;
    // Budgeted overtime minutes are real minutes; otherwise they are shift minutes that stand for `scale` people.
    // A small shop's extra minutes are a part-timer's extra hours, paid at the normal rate.
    overtime += (p.overtimeMinutes / 60) * (p.budgeted ? 1 : p.scale) * p.rate * (p.budgeted ? 1 : costs.overtime_rate);
  }
  return { contracted, overtime };
}

/** The most real minutes a person gives to assigned tasks in one day. WHY: the help desk and the packing still need them. */
export const TASK_MINUTES_PER_DAY = 120;

/**
 * Spends up to `wanted` real minutes of a person's day on an assigned task (data: state.tasks, infrastructure/engine/tasks.js).
 * Inside their normal hours first; beyond them only as overtime a person's contract allows (as for contacts: a small
 * shop's people can always stay a little, SMALL_SHOP_EXTRA_MINUTES). Overtime is booked and paid like any other.
 * @param {object} p A team member (makeTeam).
 * @param {number} wanted Real minutes the task still needs.
 * @param {number} usedToday Real minutes this person already gave to tasks today.
 * @return {number} Real minutes spent.
 */
export function spendOnTask(p, wanted, usedToday) {
  if (!p.on || wanted <= 0) return 0;
  const cap = Math.max(0, Math.min(wanted, TASK_MINUTES_PER_DAY - usedToday));
  if (!cap) return 0;
  if (p.budgeted) {
    const room = Math.max(0, p.budget + Math.max(SMALL_SHOP_EXTRA_MINUTES, OVERTIME_MAX * p.payScale) - p.used);
    const m = Math.min(cap, room);
    const over = Math.max(0, p.used + m - Math.max(p.budget, p.used));
    p.used += m; p.free = Math.min(p.end, p.free + m); p.taskMinutes += m; p.overtimeMinutes += over;
    return m;
  }
  // At scale 1 and above a person stands for `scale` people; one of them does the task, so it takes m / scale of the shift.
  const limit = p.overtime ? p.end : p.normalEnd;
  const shift = Math.min(cap / p.scale, Math.max(0, limit - p.free));
  const over = Math.max(0, p.free + shift - Math.max(p.normalEnd, p.free));
  p.free += shift; p.taskMinutes += shift * p.scale; p.overtimeMinutes += over;
  return shift * p.scale;
}
