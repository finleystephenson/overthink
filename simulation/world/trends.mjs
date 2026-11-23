// Opinion and trends: what is in fashion, and what people think of the shop.
//
// Trends: an interest index per product category (100 = normal), worked out every Monday. It wanders (a seeded,
// mean-reverting walk in log terms) and now and then something goes viral: a seeded spike that fades over a few weeks
// and makes the news (section "Trends"). Interest moves demand for that category, modestly: demand x (interest/100)^0.4.
//
// Opinion: brand sentiment from -1 to 1, worked out every day from the last 30 days of the shop's own records: review
// ratings, complaints against orders, and what customers say about the shop on social media. It is read only from the
// records, so it changes only because of what happened. It nudges website visits (people look up shops they hear
// well of), by at most 5% either way.
import { rngFor } from "../../business/builder/world/rng.mjs";
import { activeSettings, addDays, clamp, percentWords, publishNews, round, weekdayOf } from "./common.mjs";
import { normal } from "./economy.mjs";
import { CATEGORY_WORDS } from "./competitors.mjs";

/** Assumptions, chosen so a category's interest usually stays within 80 to 125 and a spike roughly doubles it for a week or two. */
export const TREND_RULES = {
  categories: ["everyday", "food", "tech", "carry", "desk-home", "outdoors"],
  reversion: 0.15, noise: 0.06, spike_chance_per_week: 0.01, spike_size: [0.45, 0.95], spike_fade: 0.6,
  demand_elasticity: 0.4, demand_min: 0.7, demand_max: 1.6, newsworthy_interest: 150,
};

/**
 * Assumptions for opinion: what "normal" looks like for this shop (near the five-year history: reviews average about
 * 4.2 to 4.3, and about 2.5 complaints per 100 orders), and how much sentiment moves visits.
 */
export const OPINION_RULES = {
  window_days: 30, normal_rating: 4.25, normal_complaint_share: 0.025, visits_per_point: 0.05,
  weights: { reviews: 0.5, complaints: 0.3, social: 0.2 },
  positive: ["love", "best", "brilliant", "perfect", "great", "lovely", "keep going back", "recommend", "delighted", "happy", "favourite", "excellent", "worth"],
  negative: ["late", "broken", "never again", "disappointed", "refund", "worst", "missing", "wrong", "rubbish", "still waiting", "complain", "damaged", "melted"],
};

const SPIKE_HEADLINES = [
  (w) => `Everyone suddenly wants ${w}`,
  (w) => `A video about ${w} has been watched by half the country`,
  (w) => `${w[0].toUpperCase()}${w.slice(1)} are this month's craze`,
];

// ---------------------------------------------------------------- trends

/** The latest trend row for a category, or null. */
export function latestTrend(state, category, date = "9999") {
  const t = state.trends || [];
  for (let i = t.length - 1; i >= 0; i--) if (t[i].category === category && t[i].date <= date) return t[i];
  return null;
}

/**
 * This week's trend row for a category from last week's. Pure.
 * @return {object} { id, date, category, interest, level, spike }
 */
export function nextTrend(prev, category, date, seed, R = TREND_RULES) {
  const r = rngFor(seed, "trend", date, category);
  const level = (prev?.level ?? 0) * (1 - R.reversion) + R.noise * normal(r);
  let spike = (prev?.spike ?? 0) * R.spike_fade;
  if (spike < 0.02) spike = 0;
  // WHY no new spike while one is still big: crazes do not stack; a second wave just keeps the first going.
  const viral = r.chance(R.spike_chance_per_week) && spike < 0.2;
  if (viral) spike += r.between(R.spike_size[0], R.spike_size[1]);
  return { id: `${date}|${category}`, date, category, interest: Math.round(100 * Math.exp(level + spike)), level: round(level, 4), spike: round(spike, 4), viral };
}

/** Mondays: one new row per category; a viral spike makes the news. */
export function trendsAfterDay(state, date, seed, categories = TREND_RULES.categories) {
  if (weekdayOf(date) !== 1) return [];
  state.trends = state.trends || [];
  const added = [];
  for (const cat of categories) {
    if (state.trends.some((t) => t.date === date && t.category === cat)) continue;
    const row = nextTrend(latestTrend(state, cat), cat, date, seed);
    if (row.viral && row.interest >= TREND_RULES.newsworthy_interest) {
      const words = CATEGORY_WORDS[cat] || cat;
      const pick = rngFor(seed, "trend-headline", date, cat).pick(SPIKE_HEADLINES);
      const news = publishNews(state, { date, headline: pick(words), source: `trend:${row.id}`, section: "Trends",
        story: `Interest in ${words} has jumped to about ${(row.interest / 100).toFixed(1)} times its usual level in a week, after people started sharing them online. These things usually fade within a month.` });
      if (news) row.news_id = news.id;
    }
    state.trends.push(row);
    added.push(row);
  }
  return added;
}

/** Category multipliers from interest (and any trend boosts in world_settings), with the reasons. */
export function trendEffects(state, date, categories = TREND_RULES.categories, R = TREND_RULES) {
  const out = { categories: {}, why: [] };
  const boosts = activeSettings(state, "trend_boosts", date);
  for (const cat of categories) {
    const row = latestTrend(state, cat, date);
    let interest = row ? row.interest : 100;
    const boost = boosts.filter((b) => b.category === cat).reduce((n, b) => n * (typeof b.factor === "number" && b.factor > 0 ? b.factor : 1), 1);
    interest *= boost;
    const m = clamp(Math.pow(interest / 100, R.demand_elasticity), R.demand_min, R.demand_max);
    if (Math.abs(m - 1) < 0.001) continue;
    out.categories[cat] = m;
    if (Math.abs(m - 1) < 0.005) continue; // WHY: too small to be worth a line in "why"; still applied.
    out.why.push({ source: "trends", effect: `Demand for ${CATEGORY_WORDS[cat] || cat} ${percentWords(m)}`, size: round(m, 3),
      because: `Interest in ${CATEGORY_WORDS[cat] || cat} is ${Math.round(interest)} (100 is normal)${boost !== 1 ? `, including a boost set in the world settings (x${boost})` : ""}${row?.spike ? "; something about them went viral recently" : ""}.` });
  }
  return out;
}

// ---------------------------------------------------------------- opinion

/** Records dated within [from, to], read from the end of a list (newest last) until they get older than `from`. */
function recent(list, dateOf, from, to) {
  const out = [];
  for (let i = (list || []).length - 1; i >= 0; i--) {
    const d = dateOf(list[i]);
    if (!d) continue;
    if (d < from) break;
    if (d <= to) out.push(list[i]);
  }
  return out;
}

const count = (text, ws) => ws.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);

/**
 * Brand sentiment on a date from the shop's records over the last 30 days. Pure; reads only.
 * @return {object} { date, sentiment, reviews, average_rating, complaints, orders, social_positive, social_negative, parts }
 */
export function opinionOn(state, date, R = OPINION_RULES) {
  const from = addDays(date, -R.window_days + 1);
  const reviews = recent(state.reviews, (r) => r.date, from, date);
  // WHY the daily web rows first: the simulator trims old orders to save memory, so counting orders would undercount.
  const web = recent(state.web_sessions_daily, (w) => w.date, from, date);
  const orders = web.length ? web.reduce((n, w) => n + (w.orders || 0), 0) : recent(state.orders, (o) => o.placed_at?.slice(0, 10), from, date).length;
  const complaints = recent(state.cases, (c) => c.opened_at?.slice(0, 10), from, date).filter((c) => c.is_complaint).length;
  const posts = recent(state.social_posts, (p) => p.at?.slice(0, 10), from, date).filter((p) => p.author?.kind === "customer");
  let pos = 0, neg = 0;
  for (const p of posts) {
    const t = String(p.text || "").toLowerCase();
    const s = count(t, R.positive) - count(t, R.negative);
    if (s > 0) pos++; else if (s < 0) neg++;
  }
  const avg = reviews.length ? reviews.reduce((n, r) => n + r.rating, 0) / reviews.length : null;
  const parts = {
    // WHY minimum counts: two reviews or a dozen orders say too little to move anyone's opinion of a shop.
    reviews: avg === null || reviews.length < 3 ? 0 : clamp(avg - R.normal_rating, -1, 1),
    // WHY a prior of 40 "normal" orders and a 5-point scale: a quiet month with no complaints is luck, not a reputation.
    complaints: orders >= 30 ? clamp(-((complaints + 40 * R.normal_complaint_share) / (orders + 40) - R.normal_complaint_share) / 0.05, -1, 1) : 0,
    social: (pos - neg) / (pos + neg + 5),
  };
  const sentiment = clamp(R.weights.reviews * parts.reviews + R.weights.complaints * parts.complaints + R.weights.social * parts.social, -1, 1);
  return { id: date, date, sentiment: round(sentiment, 3), reviews: reviews.length, average_rating: avg === null ? null : round(avg, 2),
    complaints, orders, social_positive: pos, social_negative: neg, parts: { reviews: round(parts.reviews, 3), complaints: round(parts.complaints, 3), social: round(parts.social, 3) } };
}

/** End of a day: today's opinion row. */
export function opinionAfterDay(state, date) {
  state.opinion = state.opinion || [];
  if (state.opinion.length && state.opinion.at(-1).date >= date) return null;
  const row = opinionOn(state, date);
  state.opinion.push(row);
  return row;
}

/** Visits from yesterday's sentiment, with the reason. */
export function opinionEffects(state, date, R = OPINION_RULES) {
  const row = (state.opinion || []).filter((o) => o.date < date).at(-1);
  if (!row || Math.abs(row.sentiment) < 0.02) return { visits: 1, why: [] };
  const visits = 1 + R.visits_per_point * row.sentiment;
  return { visits, why: [{ source: "opinion", effect: `Website visits ${percentWords(visits)}`, size: round(visits, 3),
    because: `People are ${row.sentiment > 0 ? "speaking well" : "grumbling"} about the shop: ${row.average_rating ?? "no"} average rating from ${row.reviews} reviews, ${row.complaints} complaints on ${row.orders} orders, and ${row.social_positive} kind and ${row.social_negative} unkind customer posts in the last 30 days.` }] };
}
