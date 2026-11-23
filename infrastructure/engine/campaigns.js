// Campaigns a person (or an AI acting as marketing or the manager) can start, change and stop.
// History's campaigns are only listed (list_campaigns). One made here has source "tool"; the simulator plays it every
// day: its monthly spend and its discount code move visits and orders, and the results are written back onto it
// (visits, orders_attributed, spend_to_date). See simulation/simulator/campaigns.mjs and docs/consequences.md.
import { extend, kit } from "./engine.js";

const { fail, round2, dateOf, ms, addDays, schema: { str, num, obj }, roles } = kit;

const CHANNELS = ["email", "search", "social", "none"];
/** The same ceilings send_outreach uses for offers. WHY: one rule for how much a role may give away. */
const MAX_DISCOUNT = { marketing: 10, manager: 20 };
export const CAMPAIGN_LIMITS = { monthly_spend: [0, 50000], days: 366 };
const WRITERS = ["marketing", "manager"];
const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** A campaign made here, by id, or a plain refusal. History's campaigns are read-only. */
function mine(ctx, id) {
  const c = (ctx.st.campaigns || []).find((x) => x.id === id) || fail("not_found", `There is no campaign ${id}.`);
  if (c.source !== "tool") fail("rule_violation", `${c.name} is part of the business's history, so it cannot be changed. Only campaigns made here can.`);
  if (c.ended) fail("rule_violation", `${c.name} has already ended.`);
  return c;
}

/** Checks a code and its percentage together: both or neither, an uppercase code nobody else uses, within the role's ceiling. */
function checkOffer(ctx, code, pct, selfId) {
  if (code == null && !pct) return { code: null, pct: 0 };
  if (!code || !(pct > 0)) fail("invalid_input", "A discount needs both a code and a percentage above 0.");
  if (!/^[A-Z0-9]{3,12}$/.test(code)) fail("invalid_input", "A discount code is 3 to 12 capital letters or numbers, such as SPRING15.");
  const max = MAX_DISCOUNT[ctx.role] ?? 0;
  if (pct > max) fail("rule_violation", `The ${ctx.role} role can give at most ${max}% off.`);
  if ((ctx.st.campaigns || []).some((c) => c.id !== selfId && c.code === code && !c.ended)) fail("rule_violation", `The code ${code} is already used by another campaign.`);
  return { code, pct };
}

function checkSpend(v) {
  const [lo, hi] = CAMPAIGN_LIMITS.monthly_spend;
  if (typeof v !== "number" || !(v >= lo && v <= hi)) fail("invalid_input", `The monthly spend must be an amount in pounds from ${lo} to ${hi}.`);
  return round2(v);
}

function checkDates(today, start, end) {
  if (!isDay(start) || !isDay(end)) fail("invalid_input", "Start and end must be dates such as 2026-12-01.");
  if (start < today) fail("invalid_input", "A campaign cannot start in the past.");
  if (end < start) fail("invalid_input", "A campaign cannot end before it starts.");
  if (days(start, end) + 1 > CAMPAIGN_LIMITS.days) fail("invalid_input", `A campaign can run for at most ${CAMPAIGN_LIMITS.days} days.`);
}

extend({
  counters: [["CMP", "campaigns", "id"]],
  tools: [
    {
      name: "create_campaign", roles: WRITERS,
      description: "Starts a marketing campaign: name, channel (email, search, social or none), start and end dates (not in the past), monthly_spend in pounds (0 to 50,000), and optionally a discount code (3 to 12 capital letters or numbers) with discount_pct (marketing up to 10%, manager up to 20%). While it runs, its spend is paid every day and adds visitors and orders, and a code gives that percentage to the customers who use it (about a quarter of buyers). Visits, orders attributed and spend to date are written on the campaign as time moves on. To count an email as part of it, send the email with links.campaign_id.",
      input_schema: obj({ name: str, channel: { type: "string", enum: CHANNELS }, start: str, end: str, monthly_spend: num, code: str, discount_pct: num }, ["name", "channel", "start", "end", "monthly_spend"]),
      // WHY: before this a campaign could only be read; an owner needs to start one and see it work.
      run(ctx, i) {
        const name = String(i.name || "").trim();
        if (!name || name.length > 100) fail("invalid_input", "Give the campaign a name of up to 100 characters.");
        const today = dateOf(ms(ctx.now));
        checkDates(today, i.start, i.end);
        const offer = checkOffer(ctx, i.code ?? null, i.discount_pct ?? 0, null);
        const c = {
          id: kit.nextId(ctx, "CMP", 3), name, channel: i.channel, start: i.start, end: i.end, spend: 0, code: offer.code, discount_pct: offer.pct,
          visits: 0, orders_attributed: 0, monthly_spend: checkSpend(i.monthly_spend), spend_to_date: 0, source: "tool", created_by: ctx.role, created_at: kit.stamp(ctx),
        };
        ctx.st.campaigns.push(c);
        ctx.changes.push(`campaign ${c.id} ${name} created (${c.channel}, ${c.start} to ${c.end}, £${c.monthly_spend} a month${c.code ? `, code ${c.code} ${c.discount_pct}% off` : ""})`);
        return c;
      },
    },
    {
      name: "update_campaign", roles: WRITERS,
      description: "Changes a campaign made here (not history's): name, end date, monthly_spend, or its code and discount_pct (give discount_pct 0 to take the code away). Changes count from the next simulated day.",
      input_schema: obj({ campaign_id: str, name: str, end: str, monthly_spend: num, code: str, discount_pct: num }, ["campaign_id"]),
      run(ctx, i) {
        const c = mine(ctx, i.campaign_id);
        const today = dateOf(ms(ctx.now));
        if (i.name !== undefined) { const n = String(i.name).trim(); if (!n || n.length > 100) fail("invalid_input", "Give the campaign a name of up to 100 characters."); c.name = n; }
        if (i.end !== undefined) {
          if (!isDay(i.end)) fail("invalid_input", "The end must be a date such as 2026-12-01.");
          if (i.end < c.start || i.end < today) fail("invalid_input", "A campaign cannot end before it starts or before today.");
          if (days(c.start, i.end) + 1 > CAMPAIGN_LIMITS.days) fail("invalid_input", `A campaign can run for at most ${CAMPAIGN_LIMITS.days} days.`);
          c.end = i.end;
        }
        if (i.monthly_spend !== undefined) c.monthly_spend = checkSpend(i.monthly_spend);
        if (i.code !== undefined || i.discount_pct !== undefined) {
          const offer = i.discount_pct === 0 && i.code === undefined ? { code: null, pct: 0 } : checkOffer(ctx, i.code ?? c.code, i.discount_pct ?? c.discount_pct, c.id);
          c.code = offer.code; c.discount_pct = offer.pct;
        }
        ctx.changes.push(`campaign ${c.id} updated`);
        return c;
      },
    },
    {
      name: "end_campaign", roles: WRITERS,
      description: "Stops a campaign made here from today: no more spend, visitors or discount from the next simulated day. What it did so far stays on the record.",
      input_schema: obj({ campaign_id: str }, ["campaign_id"]),
      run(ctx, i) {
        const c = mine(ctx, i.campaign_id);
        const today = dateOf(ms(ctx.now));
        c.ended = true; c.ended_at = kit.stamp(ctx);
        // A campaign that has not started yet never runs: its end is the day before it would have begun.
        if (c.end > today) c.end = c.start > today ? addDays(c.start, -1) : today;
        ctx.changes.push(`campaign ${c.id} ended`);
        return c;
      },
    },
  ],
});
