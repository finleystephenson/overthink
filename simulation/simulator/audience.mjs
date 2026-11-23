// The audience: how the outside world answers what the business puts out. A simulator plug-in (see
// docs/environment-design.md), rules only, no AI. Every rate is in business/data/audience.json; docs/consequences.md explains them.
//
// What it scores (only records made through the engine's tools by a person or an AI, key "tool|..."; the history and
// the comms deriver's daily background posts are part of the business as it was, and are the same in both twins):
//   - company social posts (create_social_post): reach, likes, comments, reposts, visits, new followers, orders;
//   - marketing email (send_email to several customers): opens, clicks, orders, unsubscribes.
// Each item gets a plan when first seen (from followers, network, picture, length, product, current events, offer,
// fatigue, quality and a little luck), then the plan plays out over the following days on a hot-score curve that
// decays (as in the OASIS feed). Results are written onto the record (`audience`) and into social_stats_daily, and the
// visits become extra demand through modifiers (on the named product when there is one).
//
// Pure apart from writing onto records, like every plug-in. Browser-safe: no Node imports.
import { rngFor } from "../../business/builder/world/rng.mjs";
import { contentHash, qualityFactor } from "../../infrastructure/engine/levers.js";
import { addMail } from "./campaigns.mjs";

const DAY = 86400000;
const dayNo = (s) => Math.floor(Date.parse(`${s.slice(0, 10)}T00:00:00Z`) / DAY);
const dateOfNo = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const r1 = (x) => Math.round(x * 10) / 10;
const OFFER = /\b\d{1,2}\s?%\s?off\b|\bcode\s+[A-Z0-9]{3,}\b|\bdiscount\b|\bhalf price\b|\bsale\b/i;
const NETWORKS = ["squint", "mutter"];
const LOOKBACK_DAYS = 30; // records are appended in date order, so a scan from the end can stop this far back

/**
 * Strips business/data/audience.json down to its values: { value, why, source } becomes value.
 * @param {object} json
 * @return {object}
 */
export function audienceRates(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return json;
  if ("value" in json && "why" in json) return json.value;
  const out = {};
  for (const [k, v] of Object.entries(json)) if (!k.startsWith("_")) out[k] = audienceRates(v);
  return out;
}

/**
 * The audience plug-in.
 * @param {object} o
 * @param {object} o.rates audienceRates(business/data/audience.json).
 * @param {Array<object>} o.products The catalogue (world.products): names, categories and prices.
 * @param {?object=} o.commsData The comms template banks (loadCommsData). With them, a few comment records are written
 *     per post in customers' words; without them comments are counts only.
 * @return {object} { name: "audience", modifiers, afterDay }
 */
export function audiencePlugin({ rates, products, commsData = null }) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const S = rates.social, E = rates.email, shop = rates.shop;

  return {
    name: "audience",
    /**
     * Plans anything new now, without waiting for the next day. activity-generation/people/panel.ts calls it so a persona panel can
     * start from the rules' reach and replace what people do (a record that already has `audience` is never re-planned).
     */
    plan(state, seed) { planNew(state, seed); },
    /** Start of a day: plan anything new, then turn today's share of visits into extra demand. */
    modifiers({ state, date, seed, data }) {
      planNew(state, seed);
      const extra = { all: 0, products: {} };
      for (const item of activeItems(state, date)) {
        const share = dayShare(item.audience, date);
        if (!share) continue;
        const orders = item.audience.plan.orders * share;
        if (item.audience.product_id) extra.products[item.audience.product_id] = (extra.products[item.audience.product_id] || 0) + orders;
        else extra.all += orders;
      }
      return toModifiers(extra, state, date, data);
    },
    /** End of a day: what each item did today, onto the record and into the day's social figures. */
    afterDay({ state, date, seed }) {
      planNew(state, seed);
      const today = { squint: { reach: 0, engagement: 0, posts: 0, followers: 0 }, mutter: { reach: 0, engagement: 0, posts: 0, followers: 0 } };
      for (const item of activeItems(state, date)) {
        const a = item.audience, share = dayShare(a, date);
        if (!share) continue;
        for (const [k, v] of Object.entries(a.plan)) a.so_far[k] = (a.so_far[k] || 0) + v * share;
        a.days_counted = (a.days_counted || 0) + 1;
        a.last_day = { date, visits: a.plan.visits * share }; // read by the website figures (simulation/simulator/web.mjs)
        // A mail linked to a campaign (links.campaign_id) counts as part of it: its visits and orders go on the campaign.
        const linked = a.campaign_id && (state.campaigns || []).find((c) => c.id === a.campaign_id);
        if (linked) addMail(linked, a.plan.orders * share, a.plan.visits * share);
        a.shown = Object.fromEntries(Object.entries(a.so_far).map(([k, v]) => [k, k === "revenue" ? Math.round(v * 100) / 100 : r1(v)]));
        if (a.kind === "social_post") {
          const t = today[a.network];
          t.reach += a.plan.reach * share; t.engagement += (a.plan.likes + a.plan.comments + a.plan.reposts) * share; t.followers += a.plan.followers * share;
          if (dayNo(date) === a.first_day) { t.posts++; writeComments(state, item, seed); }
        }
      }
      for (const n of NETWORKS) writeStats(state, date, n, today[n]);
    },
  };

  // ---------------------------------------------------------------- what is new, and its plan

  function planNew(state, seed) {
    for (const p of recent(state.social_posts || [], state.now)) {
      if (p.audience || !isToolPost(p)) continue;
      p.audience = planPost(state, p, seed);
    }
    const emails = recent(state.emails || [], state.now).filter((e) => !e.audience && isToolMail(e));
    if (!emails.length) return;
    const customers = new Map((state.customers || []).map((c) => [String(c.email).toLowerCase(), c]));
    for (const e of emails) {
      const who = [...e.to, ...(e.cc || [])].map((x) => customers.get(String(x.address).toLowerCase())).filter(Boolean);
      // WHY a mark even when it is not marketing: so the same email is never looked at again.
      e.audience = who.length >= E.min_customer_recipients ? planMail(state, e, who, seed) : { kind: "personal_email" };
    }
  }

  function planPost(state, p, seed) {
    const date = p.at.slice(0, 10), n = p.network;
    const followers = followersOn(state, n, date);
    const product = productOf(p.links?.product_id, p.text);
    const quality = qualityOf(state, p, `${n}|${p.text}`);
    const offer = OFFER.test(p.text);
    const f = {
      picture: n === "mutter" && p.image ? S.picture_on_mutter : 1,
      hour: S.hour_factor[hourBand(Number(p.at.slice(11, 13)))],
      weekday: S.weekday_factor[new Date(`${date}T00:00:00Z`).getUTCDay()],
      length: lengthFactor(n, p.text.length),
      product: product ? S.names_product : 1,
      event: fitsEvent(state, date, p.text, product) ? S.fits_event : 1,
      fatigue: fatigue(state, p),
      quality: quality.factor,
      luck: luck(rngFor(seed, "audience-post", p.key)),
    };
    let reach = followers * S.base_reach[n] * Object.values(f).reduce((a, b) => a * b, 1);
    const reposts = reach * S.repost_rate[n] * (offer ? S.offer.engagement : 1);
    reach += reposts * S.reach_per_repost;
    const likes = reach * S.like_rate[n] * quality.factor * (offer ? S.offer.engagement : 1);
    const visits = reach * S.visit_rate[n] * (offer ? S.offer.click : 1);
    const orders = visits * shop.conversion * (offer ? S.offer.conversion : 1);
    const plan = { reach, likes, comments: likes * S.comments_per_like, reposts, visits, followers: reach * S.follow_rate * quality.factor, orders,
      revenue: orders * (product ? product.variants[0].price : shop.average_order_value) };
    return { kind: "social_post", network: n, first_day: dayNo(date) + 1, tau: S.decay_days[n], window: S.window_days, product_id: product?.id ?? null,
      offer, followers_at_post: followers, factors: roundAll(f), quality: quality.note, plan: roundAll(plan), so_far: {}, shown: {},
      estimated: "Visits, orders and revenue are the demand this post added (expected values); the real orders are in the impact." };
  }

  function planMail(state, e, who, seed) {
    const date = e.at.slice(0, 10);
    const text = `${e.subject}\n${e.body}`;
    const product = productOf(null, text);
    const quality = qualityOf(state, e, `email|${text}`);
    const offer = OFFER.test(text);
    const excess = Math.max(0, mailsBefore(state, e) - E.fatigue.free_per_fortnight);
    const openF = 1 / (1 + E.fatigue.open_per_extra * excess), unsubF = 1 + E.fatigue.unsubscribe_per_extra * excess;
    let unsubscribed = 0, notOptedIn = 0;
    for (const c of who) {
      const optedIn = c.marketing_opt_in !== false;
      if (!optedIn) notOptedIn++;
      const chance = E.unsubscribe_rate * unsubF * (optedIn ? 1 : E.not_opted_in_unsubscribe);
      if (rngFor(seed, "audience-unsubscribe", e.key, c.id).next() < chance) { unsubscribed++; c.marketing_opt_in = false; }
    }
    const opens = who.length * E.open_rate * openF * quality.factor;
    const clicks = opens * E.click_rate * (offer ? S.offer.click : 1);
    const orders = clicks * shop.conversion * (offer ? S.offer.conversion : 1);
    const plan = { recipients: who.length, opens, clicks, visits: clicks, orders, revenue: orders * (product ? product.variants[0].price : shop.average_order_value) };
    return { kind: "marketing_email", campaign_id: e.links?.campaign_id ?? null, first_day: dayNo(date) + 1, tau: E.decay_days, window: E.window_days, product_id: product?.id ?? null, offer,
      unsubscribed, not_opted_in: notOptedIn, fatigue_extra_mails: excess, quality: quality.note, plan: roundAll(plan), so_far: {}, shown: {},
      estimated: "Opens, clicks and orders are expected values; the real orders are in the impact." };
  }

  // ---------------------------------------------------------------- factors

  function followersOn(state, network, date) {
    const rows = state.social_stats_daily || [];
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].network === network && rows[i].date <= date) return rows[i].followers;
    return 500; // a world with no social history: a small following
  }
  function hourBand(h) { return h < 7 ? "night" : h < 10 ? "morning" : h < 17 ? "day" : h < 22 ? "evening" : "late"; }
  function lengthFactor(network, len) {
    const L = S.length[network];
    return len < L.short ? L.short_factor : len > L.long ? L.long_factor : 1;
  }
  function productOf(id, text) {
    if (id && byId.has(id)) return byId.get(id);
    const lower = String(text || "").toLowerCase();
    return products.find((p) => lower.includes(p.name.toLowerCase())) || null;
  }
  /** A post fits the moment when an active world event names its product or category, or the text uses its words. */
  function fitsEvent(state, date, text, product) {
    const lower = text.toLowerCase();
    for (const ev of state.world_events || []) {
      if (ev.status === "cancelled" || date < ev.start || date > ev.end) continue;
      if (product && (ev.effects?.demand?.products?.[product.id] || ev.effects?.demand?.categories?.[product.category])) return true;
      const words = [...(ev.tags || []), ...String(ev.title || "").toLowerCase().split(/[^a-z]+/)].filter((w) => w.length >= 5 && w !== "region");
      if (words.some((w) => lower.includes(w))) return true;
    }
    return false;
  }
  /** Fatigue: company posts on the same network in the week before, and earlier the same day. */
  function fatigue(state, p) {
    const d = dayNo(p.at);
    let week = 0, sameDay = 0;
    for (const q of recent(state.social_posts || [], p.at)) {
      if (q === p || q.kind !== "post" || q.author?.kind !== "company" || q.network !== p.network || q.at > p.at || (q.at === p.at && q.id >= p.id)) continue;
      const qd = dayNo(q.at);
      if (qd === d) sameDay++;
      if (qd > d - 7) week++;
    }
    return Math.pow(S.fatigue.same_day_factor, sameDay) / (1 + S.fatigue.per_extra_post * Math.max(0, week - S.fatigue.free_per_week));
  }
  function mailsBefore(state, e) {
    const d = dayNo(e.at);
    return recent(state.emails || [], e.at).filter((x) => x !== e && x.audience?.kind === "marketing_email" && dayNo(x.at) > d - 14 && x.at <= e.at).length;
  }
  /** Log-normal luck with median 1, from the item's own stream (same item, same luck, in any run). */
  function luck(r) {
    const u1 = Math.max(1e-12, r.next()), u2 = r.next();
    return Math.exp(S.virality_sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
  }
  /** Quality: a judged score on the record (score_content), else a cached score for the same text, else not judged. */
  function qualityOf(state, rec, text) {
    const judged = rec.quality?.score ?? state.settings?.quality_cache?.[contentHash(text)]?.score;
    if (typeof judged === "number") return { factor: qualityFactor(judged, rates.quality.range), note: { score: judged, judged: true } };
    return { factor: 1, note: { score: null, judged: false, note: "Quality was not judged, so it counts as ordinary (1)." } };
  }

  // ---------------------------------------------------------------- playing out

  function activeItems(state, date) {
    const d = dayNo(date), out = [];
    // Product pages (update_product_page) are planned only by the persona panel; the rules leave them unplanned.
    for (const list of [state.social_posts || [], state.emails || [], state.product_pages || []]) {
      for (const x of recent(list, dateOfNo(d - LOOKBACK_DAYS))) {
        const a = x.audience;
        if (a && a.plan && d >= a.first_day && d < a.first_day + a.window) out.push(x);
      }
    }
    return out;
  }
  /** Today's share of the item's whole response: exponential decay over the window, normalised to 1. */
  function dayShare(a, date) {
    const k = dayNo(date) - a.first_day;
    if (k < 0 || k >= a.window) return 0;
    let total = 0;
    for (let i = 0; i < a.window; i++) total += Math.exp(-i / a.tau);
    return Math.exp(-k / a.tau) / total;
  }
  /**
   * Extra orders become demand multipliers against what the business sells on an ordinary day.
   * WHY an estimate: the plug-in does not see the simulator's exact rate for the day; it uses the plan's base rate,
   * season and weekday, which is close. The impact (live minus shadow) shows what really happened.
   */
  function toModifiers(extra, state, date, data) {
    const cfg = data?.sim?.demand;
    if (!cfg || (!extra.all && !Object.keys(extra.products).length)) return {};
    const scale = state.company?.scale > 0 ? state.company.scale : 1;
    const m = Number(date.slice(5, 7)) - 1;
    const base = cfg.base_orders_per_day * scale * cfg.season_by_month[m] * cfg.weekday_factor_sunday_first[new Date(`${date}T00:00:00Z`).getUTCDay()];
    const wsum = Object.values(cfg.product_weights).reduce((a, b) => a + b, 0);
    const out = { demand: { all: 1 + extra.all / Math.max(1, base), products: {} } };
    for (const [id, orders] of Object.entries(extra.products)) {
      const share = (cfg.product_weights[id] || wsum / Object.keys(cfg.product_weights).length) / wsum;
      out.demand.products[id] = 1 + orders / Math.max(0.5, base * share);
    }
    return out;
  }

  /** Adds the day's content figures to that day's social_stats_daily row (made if the comms deriver made none). */
  function writeStats(state, date, network, t) {
    const rows = (state.social_stats_daily ||= []);
    let row = null, prev = null;
    for (let i = rows.length - 1; i >= 0 && (!row || !prev); i--) {
      const x = rows[i];
      if (x.network !== network) continue;
      if (x.date === date && !row) row = x;
      else if (x.date < date && !prev) prev = x;
      if (x.date < dateOfNo(dayNo(date) - LOOKBACK_DAYS)) break;
    }
    const offsetBefore = prev?.content?.followers_total ?? 0;
    const quiet = !postedWithin(state, network, date, 14);
    if (!t.reach && !t.followers && !offsetBefore && !quiet) return; // nothing to add: leave the row exactly as it was
    if (!row) {
      row = { key: `stats|${network}|${date}`, date, network, followers: prev ? (prev.followers_base ?? prev.followers) : followersOn(state, network, date), reach: 0, engagement: 0, posts: 0 };
      rows.push(row);
    }
    if (row.followers_base === undefined) row.followers_base = row.followers;
    const drift = quiet ? (row.followers_base + offsetBefore) * S.drift_per_day : 0;
    const total = offsetBefore + t.followers - drift;
    row.followers = Math.max(0, Math.round(row.followers_base + total));
    row.reach = Math.round((row.reach || 0) + t.reach);
    row.engagement = Math.round((row.engagement || 0) + t.engagement);
    row.posts = (row.posts || 0) + t.posts;
    row.content = { reach: Math.round(t.reach), engagement: Math.round(t.engagement), followers_gained: r1(t.followers), followers_drift: r1(drift), followers_total: total };
  }
  function postedWithin(state, network, date, days) {
    const from = dateOfNo(dayNo(date) - days);
    for (const p of recent(state.social_posts || [], from)) if (p.network === network && p.kind === "post" && p.author?.kind === "company" && p.at.slice(0, 10) >= from) return true;
    return false;
  }

  /** A few comments in customers' own words, from the comms banks, on the post's first day. */
  function writeComments(state, post, seed) {
    const bank = commsData?.social?.customer_comment;
    const customers = state.customers || [];
    if (!bank?.length || !customers.length) return;
    const n = Math.min(S.max_comment_records, Math.round(post.audience.plan.comments));
    const product = post.audience.product_id ? byId.get(post.audience.product_id) : null;
    for (let i = 0; i < n; i++) {
      const r = rngFor(seed, "audience-comment", post.key, i);
      const c = customers[Math.floor(r.next() * customers.length)];
      let text = bank[Math.floor(r.next() * bank.length)];
      if (text.includes("{product}") && !product) continue;
      text = text.replace(/\{product\}/g, product ? product.name : "");
      const hour = 10 + Math.floor(r.next() * 12), minute = Math.floor(r.next() * 60);
      const at = `${dateOfNo(post.audience.first_day)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`;
      state.social_posts.push({
        id: nextSocialId(state), key: `audience|${post.id}|comment|${i}`, network: post.network,
        author: { kind: "customer", name: c.name, handle: c.name.toLowerCase().replace(/[^a-z]+/g, ""), customer_id: c.id },
        kind: "comment", text, image: null, at, likes: Math.floor(r.next() * 4), reposts: 0, parent: post.id, parent_key: post.key, thread: null, by: null,
        mentions_shop: false, links: { ...(post.links || {}), customer_id: c.id },
      });
    }
  }
}

/** Records made through the engine's tools have keys "tool|<id>". */
const isToolPost = (p) => typeof p.key === "string" && p.key.startsWith("tool|") && p.kind === "post" && p.author?.kind === "company";
const isToolMail = (e) => typeof e.key === "string" && e.key.startsWith("tool|") && e.folder === "sent";

/** The records from `since` (a date or time) on, scanning from the end: lists are appended in date order. */
function recent(list, since) {
  const cut = String(since).slice(0, 10);
  const from = dateOfNo(dayNo(cut) - LOOKBACK_DAYS);
  let i = list.length - 1;
  while (i >= 0 && String(list[i].at || "").slice(0, 10) >= from) i--;
  return list.slice(i + 1);
}

function nextSocialId(state) {
  let max = 0;
  for (const p of state.social_posts) { const m = /(\d+)$/.exec(p.id || ""); if (m) max = Math.max(max, Number(m[1])); }
  return `SP-${String(max + 1).padStart(6, "0")}`;
}

function roundAll(o) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 1000) / 1000 : v])); }
