// The live simulator's website figures: one web_sessions_daily row a day, in the shape history writes
// (business/builder/world/marketing.mjs webSessions), so visitor figures carry on past the last day of history.
//
// The ratios are history's: visits come from orders at a 2.1% conversion (x 0.85 to 1.15 of luck), baskets started from
// orders at a 70% abandon rate, product page views from sales and visits. What moves the figures:
//   - orders already carry marketing spend, campaigns, posts and events, so visits follow them;
//   - an event's visits multiplier (data in the events) scales the visitors;
//   - visits that a campaign, a social post or a marketing email brought are put in their own channel, and the rest are
//     split by history's channel mix.
//
// Pure apart from returning a row. Browser-safe: no Node imports.
import { rngFor } from "../../business/builder/world/rng.mjs";
import { CONVERSION } from "./campaigns.mjs";

const ABANDON = 0.7;
const CHANNEL_MIX = [["direct", 0.34], ["search", 0.31], ["social", 0.15], ["email", 0.1], ["referral", 0.1]];
/** The most of a day's visits that named sources (campaigns, posts, mail) may account for; the rest are everyday visitors. */
const MAX_NAMED = 0.7;
const DAY = 86400000;

/**
 * Visits that today's social posts and marketing emails brought, by channel (the audience plug-in writes `last_day`
 * on each item it played out).
 * @param {object} state
 * @param {string} date YYYY-MM-DD
 * @return {{social: number, email: number}}
 */
export function audienceVisits(state, date) {
  const out = { social: 0, email: 0 };
  const from = new Date(Date.parse(`${date}T00:00:00Z`) - 40 * DAY).toISOString().slice(0, 10);
  const scan = (list, key) => {
    for (let i = (list || []).length - 1; i >= 0 && String(list[i].at || "").slice(0, 10) >= from; i--) {
      if (list[i].audience?.last_day?.date === date) out[key] += list[i].audience.last_day.visits;
    }
  };
  scan(state.social_posts, "social");
  scan(state.emails, "email");
  return out;
}

/**
 * Today's website row.
 * @param {object} o
 * @param {string} o.date
 * @param {number|string} o.seed
 * @param {number} o.orders Orders placed today.
 * @param {number} o.lost Baskets lost to empty shelves today.
 * @param {number} o.visitsFactor An event's visits multiplier (1 for none).
 * @param {object} o.named Visits by channel that campaigns, posts and mail brought: { email, search, social, referral }.
 * @param {Array<string>} o.productIds Every product, so the row has a views entry for each (as history).
 * @param {object} o.soldBy Units sold today by product id.
 * @return {object} { date, visits, total_visits, product_page_views, baskets_started, baskets_abandoned, baskets_lost_to_stockouts, orders }
 */
export function webRow({ date, seed, orders, lost, visitsFactor = 1, named = {}, productIds, soldBy }) {
  const rng = rngFor(seed, "web-live", date);
  const placed = orders;
  let total = Math.max(placed + lost, Math.round(((placed + lost) / CONVERSION) * rng.between(0.85, 1.15)) || rng.int(3, 12));
  total = Math.max(placed + lost, Math.round(total * visitsFactor));
  const channels = ["email", "search", "social", "referral"];
  const wanted = channels.reduce((n, k) => n + (named[k] || 0), 0);
  // WHY a floor on the total: named visits are real people, so a quiet day's total grows to hold them.
  if (wanted > total * MAX_NAMED) total = Math.ceil(wanted / MAX_NAMED);
  const visits = Object.fromEntries(CHANNEL_MIX.map(([k]) => [k, Math.round(named[k] || 0)]));
  const rest = total - Object.values(visits).reduce((a, b) => a + b, 0);
  const shares = CHANNEL_MIX.map(([k, s]) => [k, s * rng.between(0.8, 1.2)]);
  const sum = shares.reduce((n, [, s]) => n + s, 0);
  let left = rest;
  shares.forEach(([k, s], i) => {
    const n = i === shares.length - 1 ? left : Math.min(left, Math.round((rest * s) / sum));
    visits[k] += Math.max(0, n);
    left -= n;
  });
  const views = {};
  for (const id of productIds) views[id] = Math.round((soldBy[id] || 0) * rng.between(12, 25) + total * 0.05 * rng.next());
  const started = Math.round((placed + lost) / (1 - ABANDON));
  return { date, visits, total_visits: total, product_page_views: views, baskets_started: started, baskets_abandoned: started - placed, baskets_lost_to_stockouts: lost, orders: placed };
}
