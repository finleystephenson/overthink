// Campaigns made through the engine's tools (create_campaign), and what they do to each simulated day.
// History's campaigns (planned by business/builder/world/marketing.mjs) are part of the business as it was and are the same in both
// twins, so only campaigns with source "tool" are played here. docs/consequences.md explains the numbers.
//
// A running campaign does two things, through the same rules the simulator already uses:
//   - its monthly spend is added to the day's marketing budget, so it lifts orders by the marketing elasticity
//     (business/data/sim.json marketing_elasticity) and is paid every day;
//   - its discount code lifts orders by the price elasticity for the share of buyers who use a code, and that share of
//     the day's sales is given away (booked as marketing cost).
// Results go on the campaign record as history does (visits, orders_attributed, spend), plus spend_to_date.
//
// Pure apart from writing onto the campaign records. Browser-safe: no Node imports.

/** Share of orders that use an active code. WHY: the same 25% the history generator uses (business/builder/world/customers.mjs CODE_USE). */
export const CODE_USE = 0.25;
/** Visits a pound of paid spend buys. WHY: the history generator's figures (business/builder/world/marketing.mjs VISITS_PER_POUND). */
export const VISITS_PER_POUND = { email: 0, search: 1.6, social: 2.2, none: 0 };
/** Share of website visits that become an order, as in history (business/builder/world/marketing.mjs CONVERSION). */
export const CONVERSION = 0.021;
/** Email visits per order in history are orders / conversion x 0.5 to 0.8; the middle is used here (no luck needed). */
export const EMAIL_VISIT_SHARE = 0.65;
export const CHANNELS = ["email", "search", "social", "none"];

const r2 = (x) => Math.round(x * 100) / 100;

/**
 * The tool-made campaigns running on a date: not ended, start <= date <= end.
 * @param {object} state
 * @param {string} date YYYY-MM-DD
 * @return {Array<object>}
 */
export function liveCampaigns(state, date) {
  return (state.campaigns || []).filter((c) => c.source === "tool" && !c.ended && c.start <= date && date <= c.end);
}

/** The orders lift from codes: each running code is used by CODE_USE of buyers, who face a price (1 - pct) lower. */
export function discountLift(list, elasticity) {
  return list.reduce((m, c) => m * Math.pow(1 - (CODE_USE * (c.discount_pct || 0)) / 100, -elasticity), 1);
}

/** Share of a day's sales given away through codes. */
export function discountShare(list) {
  return Math.min(0.5, list.reduce((n, c) => n + (CODE_USE * (c.discount_pct || 0)) / 100, 0));
}

/** Total monthly spend of these campaigns. */
export const monthlySpendOf = (list) => list.reduce((n, c) => n + (c.monthly_spend || 0), 0);

/**
 * Writes one day's results onto the running campaigns: spend, expected extra orders and visits.
 * Extra orders are the expected values (like a post's), shared out by each campaign's own size of lift; the real
 * orders are in the impact.
 * @param {Array<object>} list The campaigns running today.
 * @param {object} d
 * @param {number} d.lam Today's expected orders, with everything applied.
 * @param {number} d.daysPerMonth
 * @param {number} d.elasticity Price elasticity.
 * @param {function(number): number} d.spendLift Orders lift of adding this many pounds a month (1 for none).
 * @return {object} Today's campaign visits by channel (email, search, social, referral), for the day's website figures.
 */
export function recordDay(list, { lam, daysPerMonth, elasticity, spendLift }) {
  const visits = { email: 0, search: 0, social: 0, referral: 0 };
  if (!list.length) return visits;
  const total = spendLift(monthlySpendOf(list)) * discountLift(list, elasticity);
  const extra = total > 1 ? lam * (1 - 1 / total) : 0;
  const own = list.map((c) => Math.max(0, Math.log(spendLift(c.monthly_spend || 0) * discountLift([c], elasticity))));
  const sum = own.reduce((a, b) => a + b, 0);
  list.forEach((c, k) => {
    const t = (c.tally ||= { orders: 0, visits: 0, spend: 0, mail_orders: 0, mail_visits: 0, discount_given: 0, days: 0 });
    const orders = sum ? (extra * own[k]) / sum : 0;
    const spend = (c.monthly_spend || 0) / daysPerMonth;
    t.orders += orders;
    t.spend += spend;
    const v = c.channel === "email" ? (orders / CONVERSION) * EMAIL_VISIT_SHARE : c.channel === "none" ? orders / CONVERSION : spend * VISITS_PER_POUND[c.channel];
    t.visits += v;
    visits[c.channel === "none" ? "referral" : c.channel] += v;
    t.days++;
    refresh(c);
  });
  return visits;
}

/** Takes a day's discount off sales: adds each campaign's share of revenue to what it gave away. Returns the money given. */
export function bookDiscount(list, revenue) {
  let given = 0;
  for (const c of list) {
    const amount = revenue * ((CODE_USE * (c.discount_pct || 0)) / 100);
    if (!amount) continue;
    c.tally.discount_given = (c.tally.discount_given || 0) + amount;
    c.discount_given = r2(c.tally.discount_given);
    given += amount;
  }
  return given;
}

/**
 * Brings the figures people read in line with the running tally.
 * `spend` is spend to date (history's `spend` is the whole campaign's, which this equals once it has ended).
 * @param {object} c A campaign record with a tally.
 * @return {void}
 */
export function refresh(c) {
  const t = c.tally;
  if (!t) return;
  // A campaign from history keeps the figures it had; only what mail added since is put on top.
  const base = c.source === "tool" ? { visits: 0, orders: 0 } : (c.history_base ||= { visits: c.visits || 0, orders: c.orders_attributed || 0 });
  if (c.source === "tool") { c.spend_to_date = r2(t.spend); c.spend = c.spend_to_date; }
  c.visits = Math.round(base.visits + t.visits + (t.mail_visits || 0));
  c.orders_attributed = Math.round(base.orders + t.orders + (t.mail_orders || 0));
}

/**
 * Adds a day of a marketing email's response to the campaign it is linked to.
 * @param {object} c The campaign record.
 * @param {number} orders Expected orders from the mail today.
 * @param {number} visits Expected visits from the mail today.
 * @return {void}
 */
export function addMail(c, orders, visits) {
  const t = (c.tally ||= { orders: 0, visits: 0, spend: 0, mail_orders: 0, mail_visits: 0, discount_given: 0, days: 0 });
  t.mail_orders += orders;
  t.mail_visits += visits;
  refresh(c);
}
