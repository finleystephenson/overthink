// Who you can be at the company computer: each role in the engine, and the person who holds it.
// The names come from the engine (get_levers lists the team as it now is, including people hired in play).
// The list below is only the fallback for the moment before that answer arrives, or a server without the tool.
// Keep the fallback in step with business/data/staff.json. The AI roles have no person.

const JOBS = {
  manager: "Runs the place", finance: "Finance", support_lead: "Customer service lead", support_agent: "Customer service",
  warehouse: "Deliveries and dispatch", buyer: "Buying", marketing: "Marketing", technician: "Fix Club bench", coordinator: "Bookings and crews",
};

const AI = [
  { role: "assistant", name: "The shop's AI assistant", job: "Talks to customers", ai: true },
  { role: "operations_assistant", name: "The back-office AI", job: "Helps with stock and buying", ai: true },
];

/** @type {Array<{role: string, name: string, job: string, ai?: boolean, id?: string}>} Changed in place by loadPeople(). */
export const PEOPLE = [
  { role: "manager", name: "Mr Fezziwig", job: JOBS.manager },
  { role: "finance", name: "Ebenezer Scrooge", job: JOBS.finance },
  { role: "support_lead", name: "Mrs Hudson", job: JOBS.support_lead },
  { role: "support_agent", name: "Sam Weller", job: JOBS.support_agent },
  { role: "warehouse", name: "Phileas Fogg", job: JOBS.warehouse },
  { role: "buyer", name: "Robinson Crusoe", job: JOBS.buyer },
  { role: "marketing", name: "Mr Toad", job: JOBS.marketing },
  { role: "technician", name: "Hephaestus", job: JOBS.technician },
  { role: "coordinator", name: "The bookings desk", job: JOBS.coordinator },
  ...AI,
];

/** The whole team from the last loadPeople() (everyone, not one per role), or [] before it answers. */
export const TEAM = [];

/**
 * Replaces the fallback with the engine's own team: one person per role for the picker, in team order.
 * @param {object} world the client
 * @return {Promise<boolean>} true when the engine answered
 */
export async function loadPeople(world) {
  const r = await world.call("get_levers", {}, { role: "manager", screen: true }).catch(() => null);
  if (!r?.ok || !Array.isArray(r.data.team)) return false;
  TEAM.splice(0, TEAM.length, ...r.data.team);
  const seen = new Set();
  const people = [];
  for (const p of TEAM) {
    if (seen.has(p.role)) continue;
    seen.add(p.role);
    people.push({ role: p.role, name: p.name, job: JOBS[p.role] || p.role.replace(/_/g, " "), id: p.id });
  }
  // Roles nobody holds (the bookings desk) keep their stand-in so the picker still offers them.
  for (const p of PEOPLE) if (!p.ai && !seen.has(p.role)) people.push(p);
  PEOPLE.splice(0, PEOPLE.length, ...people, ...AI);
  return true;
}

/**
 * The person for a role, or a plain stand-in for a role this list does not know.
 * @param {string} role
 * @return {{role: string, name: string, job: string, ai?: boolean}}
 */
export function personFor(role) {
  return PEOPLE.find((p) => p.role === role) || { role, name: role ? role.replace(/_/g, " ") : "Someone", job: "" };
}

// ------------------------------------------------------------------ the whole team, with hours

/**
 * What get_levers does not say about each person: the book they come from and when their day starts
 * (business/data/staff.json, which is not served to the browser). People hired in play have neither and get plain defaults.
 */
const DETAILS = {
  "S-01": { from: "A Christmas Carol", start: "09:00" },
  "S-02": { from: "A Christmas Carol", start: "09:00" },
  "S-03": { from: "A Christmas Carol", start: "09:00" },
  "S-04": { from: "Around the World in Eighty Days", start: "09:00" },
  "S-05": { from: "The Wind in the Willows", start: "09:00" },
  "S-06": { from: "The Sherlock Holmes stories", start: "11:30" },
  "S-07": { from: "The Pickwick Papers", start: "09:00" },
  "S-08": { from: "Bleak House", start: "12:30" },
  "S-09": { from: "Robinson Crusoe", start: "09:00" },
  "S-10": { from: "The Wind in the Willows", start: "09:00" },
  "S-11": { from: "Greek myth", start: "09:00" },
};

/** Until get_levers answers: the team as business/data/staff.json starts it. */
const FALLBACK_TEAM = [
  ["S-01", "Mr Fezziwig", "manager", 22], ["S-02", "Ebenezer Scrooge", "finance", 8], ["S-03", "Bob Cratchit", "finance", 14],
  ["S-04", "Phileas Fogg", "warehouse", 22], ["S-05", "Mole", "warehouse", 20], ["S-06", "Mrs Hudson", "support_lead", 28],
  ["S-07", "Sam Weller", "support_agent", 28], ["S-08", "Esther Summerson", "support_agent", 24], ["S-09", "Robinson Crusoe", "buyer", 10],
  ["S-10", "Mr Toad", "marketing", 10], ["S-11", "Hephaestus", "technician", 8],
].map(([id, name, role, weekly_hours]) => ({ id, name, role, weekly_hours }));

/** Mon to Fri: the days everyone works (staff.json "days"). */
export const WORK_DAYS = [1, 2, 3, 4, 5];

/**
 * Everyone on the team as it is now (from get_levers, so hours changed in play and people hired in play show),
 * each with `{ id, name, role, job, from, start, weekly }`. Falls back to the starting team.
 * @param {object} world the client
 * @return {Promise<Array<{id: string, name: string, role: string, job: string, from: string, start: string, weekly: number}>>}
 */
export async function loadTeam(world) {
  const ok = TEAM.length || await loadPeople(world);
  const team = ok && TEAM.length ? TEAM : FALLBACK_TEAM;
  return team.map((p) => ({
    id: p.id, name: p.name, role: p.role, job: JOBS[p.role] || p.role.replace(/_/g, " "),
    from: DETAILS[p.id]?.from || (p.hired ? "New this year" : ""),
    start: DETAILS[p.id]?.start || "09:00",
    weekly: p.weekly_hours ?? 0,
  }));
}

/**
 * Whether someone is at work at a simulated time: weekdays, from their start for their weekly hours over five days.
 * @param {{start: string, weekly: number}} person
 * @param {string} iso simulated time (UTC)
 */
export function onShift(person, iso) {
  const d = new Date(iso);
  if (!WORK_DAYS.includes(d.getUTCDay())) return false;
  const [h, m] = person.start.split(":").map(Number);
  const from = h * 60 + m;
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minutes >= from && minutes < from + (person.weekly / WORK_DAYS.length) * 60;
}
