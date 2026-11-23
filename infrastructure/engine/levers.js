// Levers: business settings a manager (or a connected AI acting as one) can change, that the simulator reads every day.
// Prices, stock and purchase orders already live in the engine's records. Two more things a real owner changes are
// how much goes on marketing and who works how many hours. They live in world.state.settings, so they are saved,
// reset and compared like every other record, and the simulator picks them up on the next simulated day.
//
// No settings (the default) means "as planned": the marketing plan in business/data/costs.json and the team in business/data/staff.json.
// WHY a missing record rather than a filled-in one: a world built before this file existed behaves exactly as before.
import { extend, kit } from "./engine.js";

const { fail, round2, dateOf, ms, schema: { str, num, obj }, roles } = kit;

/** A code word as plain words: "support_agent" becomes "support agent". */
const plain = (w) => String(w).replace(/_/g, " ");

/** Sensible limits. WHY: 48 hours is the UK working-time limit; the budget cap stops a typo from wrecking a run. */
export const LIMITS = { marketing_per_month: [0, 50000], weekly_hours: [0, 48], team_max: 30 };

/**
 * The team as the settings say it is today.
 * Returns `staff` itself (same array) when nothing was changed, so the default path is exactly the old one.
 * @param {Array<object>} staff The planned team (business/data/staff.json "staff").
 * @param {?object} changes world.state.settings.staff: { hours: { id: n }, removed: [id], added: [{ id, name, role, weekly_hours }] }.
 * @return {Array<object>} One entry per person working here, in the same shape as business/data/staff.json.
 */
export function effectiveStaff(staff, changes) {
  if (!changes) return staff;
  const hours = changes.hours || {};
  const removed = new Set(changes.removed || []);
  const out = staff.filter((s) => !removed.has(s.id)).map((s) => (s.id in hours ? { ...s, weekly_hours: hours[s.id] } : s));
  for (const a of changes.added || []) {
    if (removed.has(a.id)) continue;
    // A new hire works like the first person already in that role: same tasks, speed, accuracy, pay and shift.
    const like = staff.find((s) => s.role === a.role);
    if (!like) continue;
    out.push({ ...like, id: a.id, name: a.name, weekly_hours: a.id in hours ? hours[a.id] : a.weekly_hours, customer_clash: false, hired: true, joined: a.joined || null });
  }
  return out;
}

/**
 * A short fingerprint of a piece of content (FNV-1a over the text, lower-cased, spaces squeezed), so the same words
 * always get the same quality score however many times they are posted or sent.
 * @param {string} text
 * @return {string} 8 hex characters.
 */
export function contentHash(text) {
  const t = String(text).trim().toLowerCase().replace(/\s+/g, " ");
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Turns a judged quality score (0 to 1) into a response multiplier: 0 gives range[0], 0.5 gives 1, 1 gives range[1].
 * @param {number} score
 * @param {Array<number>} range [low, high], from business/data/audience.json.
 * @return {number}
 */
export function qualityFactor(score, range = [0.6, 1.5]) {
  const q = Math.max(0, Math.min(1, score));
  return q < 0.5 ? range[0] + (1 - range[0]) * (q / 0.5) : 1 + (range[1] - 1) * ((q - 0.5) / 0.5);
}

/** The content a score is about: a social post or an email, and the text its fingerprint is taken from. */
function contentFor(ctx, i) {
  if (i.kind === "social_post") {
    const p = (ctx.st.social_posts || []).find((x) => x.id === i.id) || fail("not_found", `No social post ${i.id}.`);
    return { rec: p, text: `${p.network}|${p.text}` };
  }
  if (i.kind === "email") {
    const e = (ctx.st.emails || []).find((x) => x.id === i.id) || fail("not_found", `No email ${i.id}.`);
    return { rec: e, text: `email|${e.subject}\n${e.body}` };
  }
  return fail("invalid_input", "Say whether you are scoring a social post or an email.");
}

/** The settings record, made on first write so an untouched world has none. */
function settingsOf(ctx) {
  if (!ctx.st.settings) ctx.st.settings = {};
  return ctx.st.settings;
}

/**
 * Tells a world what "as planned" means: the team and the monthly marketing budget from the business files.
 * The engine itself never reads business/data/staff.json or business/data/costs.json, so whoever builds the world attaches them.
 * WHY on the world, not in the state: the plan is fixed business data, like the products; only changes are records.
 * @param {object} world An engine world.
 * @param {{staff: Array<object>, marketing_per_month: number}} plan
 * @return {object} The same world.
 */
export function attachPlan(world, { staff, marketing_per_month, on_cost_rate = null, days_per_month = null, work_days = null, day_start = null }) {
  world.plan = { staff, marketing_per_month, on_cost_rate, days_per_month, work_days, day_start };
  return world;
}

/** The planned team attached to this world (world.plan.staff), or a clear refusal. */
function rosterOf(ctx) {
  const staff = ctx.world.plan?.staff;
  if (!Array.isArray(staff) || !staff.length) fail("not_found", "This world has no team loaded, so staffing cannot be changed here.");
  return staff;
}

/** What a reader sees: each person with their hours now, and the marketing budget now. */
function view(ctx) {
  const s = ctx.st.settings || {};
  const planned = ctx.world.plan?.marketing_per_month ?? null;
  const staff = Array.isArray(ctx.world.plan?.staff) ? effectiveStaff(ctx.world.plan.staff, s.staff || null) : [];
  return {
    marketing_per_month: s.marketing_per_month ?? null,
    marketing_note: s.marketing_per_month == null ? "As planned (the business's marketing plan)." : "Set by a manager.",
    planned_marketing_per_month: planned,
    team: staff.map((p) => ({ id: p.id, name: p.name, role: p.role, weekly_hours: p.weekly_hours, hourly_pay: p.hourly_pay, hired: !!p.hired })),
    // Who answers customers (set_support_cover): null means staff answer everything.
    support: s.support ? structuredClone(s.support) : null,
    limits: LIMITS,
  };
}

/**
 * Each person at this world's own size. The simulator multiplies every person's hours and pay by the world's scale
 * (company.scale), so a "22 hour" manager at scale 0.02 works 0.44 hours a week; these figures are already that.
 */
function staffDetails(ctx) {
  const s = ctx.st.settings || {};
  const plan = ctx.world.plan || {};
  const scale = ctx.st.company?.scale > 0 ? ctx.st.company.scale : 1;
  const team = Array.isArray(plan.staff) ? effectiveStaff(plan.staff, s.staff || null) : [];
  const joinedBy = new Map((ctx.st.company?.staffing_now || []).map((p) => [p.id, p.joined]));
  const rate = plan.on_cost_rate, dim = plan.days_per_month;
  const dayCount = plan.work_days?.length || 5;
  return {
    scale,
    team: team.map((p) => {
      const hours = round2(p.weekly_hours * scale * 100) / 100;
      const cost = rate != null && dim ? round2((p.weekly_hours * scale / 7) * p.hourly_pay * (1 + rate) * dim) : null;
      return {
        id: p.id, name: p.name, role: p.role, job: p.job || null, book: p.from || null, shift_start: p.start || plan.day_start || null,
        weekly_hours: round2(p.weekly_hours * scale), hours_per_working_day: round2((p.weekly_hours * scale) / dayCount), hourly_pay: p.hourly_pay,
        monthly_cost: cost, joined: p.joined || joinedBy.get(p.id) || null, hired: !!p.hired,
        plan_weekly_hours: p.weekly_hours,
      };
    }),
  };
}

/** Change one person's hours. */
function setHours(ctx, changes, team, i) {
  const p = team.find((x) => x.id === i.staff_id);
  if (!p) fail("not_found", `No one with id ${i.staff_id} works here. Ask for the team list to see who works here.`);
  if (typeof i.weekly_hours !== "number") fail("invalid_input", "Say how many hours a week they should work.");
  changes.hours = { ...(changes.hours || {}), [p.id]: i.weekly_hours };
  ctx.changes.push(`staff ${p.id} (${p.name}) weekly_hours ${p.weekly_hours} → ${i.weekly_hours}`);
}

/** Hire someone into a role that already exists. */
function addPerson(ctx, changes, team, roster, i) {
  if (!i.role) fail("invalid_input", "Say which job the new person will do.");
  if (!roster.some((s) => s.role === i.role)) fail("invalid_input", `There is no ${plain(i.role)} job here to copy. The jobs are: ${[...new Set(roster.map((s) => plain(s.role)))].join(", ")}.`);
  if (team.length >= LIMITS.team_max) fail("rule_violation", `The team is already ${team.length} people; the most is ${LIMITS.team_max}.`);
  if (typeof i.weekly_hours !== "number") fail("invalid_input", "Say how many hours a week they will work.");
  const added = changes.added || [];
  const id = `hire-${added.length + 1}`;
  const name = String(i.name || `New ${i.role.replace(/_/g, " ")} ${added.length + 1}`).slice(0, 60);
  changes.added = [...added, { id, name, role: i.role, weekly_hours: i.weekly_hours, joined: dateOf(ms(ctx.now)) }];
  ctx.changes.push(`staff ${id} (${name}) hired as ${i.role}, ${i.weekly_hours} hours a week`);
  return id;
}

/** Let someone go. The last person cannot be removed: someone has to open the post. */
function removePerson(ctx, changes, team, i) {
  const p = team.find((x) => x.id === i.staff_id);
  if (!p) fail("not_found", `No one with id ${i.staff_id} works here. Ask for the team list to see who does.`);
  if (team.length <= 1) fail("rule_violation", "The business needs at least one person.");
  changes.removed = [...(changes.removed || []), p.id];
  ctx.changes.push(`staff ${p.id} (${p.name}) left the team`);
}

extend({
  tools: [
    {
      name: "score_content", roles: ["manager"],
      description: "Records a quality score (0 to 1) for a social post or an email, given by a judge you choose (a person, a cheap AI model or a local one). The simulator multiplies the audience's response by it (0 gives 0.6 times, 0.5 ordinary, 1 gives 1.5 times). The same words always keep the same score. Score before time moves on: once the audience has seen it, the score is fixed. Nothing here calls a model.",
      input_schema: obj({ kind: { type: "string", enum: ["social_post", "email"] }, id: str, score: num, judge: str }, ["kind", "id", "score"]),
      // WHY: rules can check facts about a post (picture, product, offer, timing) but not whether the writing is good;
      // this is the hook for an outside judge, cached by content so a run repeats exactly.
      run(ctx, i) {
        if (!(i.score >= 0 && i.score <= 1)) fail("invalid_input", "A score must be a number from 0 to 1.");
        const { rec, text } = contentFor(ctx, i);
        if (rec.audience?.plan) fail("rule_violation", `${rec.id} has already been seen by the audience; score content before time moves on.`);
        const hash = contentHash(text);
        const s = settingsOf(ctx);
        const judge = String(i.judge || "unnamed judge").slice(0, 80);
        const cached = s.quality_cache?.[hash];
        // WHY the first score wins: the same text must always get the same score, so runs repeat.
        const score = cached ? cached.score : Math.round(i.score * 1000) / 1000;
        s.quality_cache = { ...(s.quality_cache || {}), [hash]: cached || { score, judge } };
        rec.quality = { score, judge: cached ? cached.judge : judge, hash };
        ctx.changes.push(`${i.kind} ${rec.id} quality ${score} (${rec.quality.judge})${cached ? " (same words scored before)" : ""}`);
        return { id: rec.id, score, judge: rec.quality.judge, hash, reused: !!cached };
      },
    },
    {
      name: "get_levers", roles: roles.INTERNAL,
      description: "The settings the simulator reads every day (hours here are the plan\u0027s; list_staff gives each person\u0027s real hours and cost at this world\u0027s size): the monthly marketing budget (null means as planned), the team with each person's weekly hours, and the support cover (which channels are left to you or your AI; null means staff answer everything).",
      input_schema: obj({}),
      run(ctx) { return view(ctx); },
    },
    {
      name: "list_staff", roles: roles.INTERNAL,
      description: "The people who work here, at this world's real size: id, name, role, job, the book they come from, shift_start, weekly_hours and hours_per_working_day as actually worked (already multiplied by the world's scale, which is also returned), hourly_pay, monthly_cost (hours x pay plus employer costs, at this scale), and joined date (null if not recorded). plan_weekly_hours is the figure set_staffing takes. Nothing needs scaling again.",
      input_schema: obj({}),
      run(ctx) { return staffDetails(ctx); },
    },
    {
      name: "set_support_cover", roles: ["manager"],
      description: "Decides who answers customers on each channel. Channels listed here (email, web_chat, phone, text) are left for you or your own AI to answer (reply to the customer's email in the hello mailbox with send_email); staff step in only after staff_after_minutes of working time (default 480, one working day; 0 to 2400). An empty list puts staff back on everything.",
      input_schema: obj({ channels: { type: "array" }, staff_after_minutes: num }, ["channels"]),
      // WHY: the way to test a customer-service AI is to let it answer the real queue, with staff as the safety net.
      run(ctx, i) {
        const allowed = ["email", "web_chat", "phone", "text"];
        if (!Array.isArray(i.channels) || i.channels.some((c) => !allowed.includes(c))) fail("invalid_input", `Pick channels from this list: ${allowed.map(plain).join(", ")}.`);
        const after = i.staff_after_minutes ?? 480;
        if (!(after >= 0 && after <= 2400)) fail("invalid_input", "Staff can step in after 0 to 2400 working minutes.");
        const s = settingsOf(ctx);
        if (!i.channels.length) { delete s.support; ctx.changes.push("settings support → staff answer everything"); return { support: null }; }
        s.support = { channels: [...new Set(i.channels)], staff_after_minutes: after };
        ctx.changes.push(`settings support → outside answers ${s.support.channels.join(", ")}; staff after ${after} working minutes`);
        return { support: s.support };
      },
    },
    {
      name: "set_marketing_budget", roles: ["manager"],
      description: `Sets the monthly marketing spend in pounds, from the next simulated day (${LIMITS.marketing_per_month[0]} to ${LIMITS.marketing_per_month[1]}). More spend brings more visitors and orders, with diminishing returns; it is paid every day. Send "reset": true to go back to the plan.`,
      input_schema: obj({ monthly: num, reset: { type: "boolean" }, reason: str }),
      // WHY: marketing is one of the few levers an owner pulls every month; the simulator already prices its effect.
      run(ctx, i) {
        const s = settingsOf(ctx);
        const before = s.marketing_per_month ?? "as planned";
        if (i.reset) { delete s.marketing_per_month; ctx.changes.push(`settings marketing_per_month ${before} → as planned`); return view(ctx); }
        const [lo, hi] = LIMITS.marketing_per_month;
        if (typeof i.monthly !== "number" || !(i.monthly >= lo && i.monthly <= hi)) fail("invalid_input", `The monthly marketing spend must be an amount in pounds from ${lo} to ${hi}.`);
        s.marketing_per_month = round2(i.monthly);
        ctx.changes.push(`settings marketing_per_month ${before} → ${s.marketing_per_month}`);
        return view(ctx);
      },
    },
    {
      name: "set_staffing", roles: ["manager"],
      description: `Changes the team from the next simulated day. action "hours": { staff_id, weekly_hours }; "add": { role, weekly_hours, name? } hires someone who works like the others in that role; "remove": { staff_id }. Hours are ${LIMITS.weekly_hours[0]} to ${LIMITS.weekly_hours[1]} a week; at most ${LIMITS.team_max} people. Pay follows the hours.`,
      input_schema: obj({ action: { type: "string", enum: ["hours", "add", "remove"] }, staff_id: str, role: str, weekly_hours: num, name: str, reason: str }, ["action"]),
      // WHY: who works and for how long decides how fast customers are answered and parcels packed; the sim's team follows this record.
      run(ctx, i) {
        const roster = rosterOf(ctx);
        const s = settingsOf(ctx);
        const changes = { ...(s.staff || {}) };
        const team = effectiveStaff(roster, s.staff || null);
        const [lo, hi] = LIMITS.weekly_hours;
        if (i.weekly_hours !== undefined && !(i.weekly_hours >= lo && i.weekly_hours <= hi)) fail("invalid_input", `Weekly hours must be from ${lo} to ${hi}.`);
        let id = i.staff_id;
        if (i.action === "hours") setHours(ctx, changes, team, i);
        else if (i.action === "add") id = addPerson(ctx, changes, team, roster, i);
        else removePerson(ctx, changes, team, i);
        s.staff = changes;
        return { ...view(ctx), changed: id };
      },
    },
  ],
});
