// Competitors: rival shops that make their own decisions every week, and what that does to Overthought's demand.
//
// Each competitor has a strategy and rules (business/data/organisations.json). On Mondays each one looks at the calendar, at
// Overthought's prices and launches, and at what is in fashion, and may start a sale, follow a price cut, launch a
// cheaper alternative or push its advertising. Every chance is drawn with rngFor keyed by business facts (the date,
// the competitor, the season, the price change it reacts to), never a running count, so a live world and its shadow
// twin make the same decisions unless something really differs between them.
//
// Demand effect: an attraction (share) model per category, the multinomial-logit form used in marketing science.
//   attraction(rival) = weight x exp(-price_beta x (price_factor - 1)) x ad_factor ^ ad_gamma  (+ any launched copies)
//   share(Overthought) = its weight / (its weight + every rival's attraction + people who buy nothing of the kind)
// Overthought's multiplier in a category is its share today over its share with every rival at its normal price and
// advertising. WHY Overthought's own price is held at normal here: the simulator already applies Overthought's own
// price elasticity (simulation/simulator/core.mjs), and counting it twice would exaggerate every price change.
import { rngFor } from "../../business/builder/world/rng.mjs";
import { addDays, clamp, nextStateId, percentWords, publishNews, activeSettings, daysBetween, round, dateWords, listWords } from "./common.mjs";
import { competitorsIn, findOrg } from "./organisations.mjs";

/** Words for a category in a headline. */
export const CATEGORY_WORDS = {
  everyday: "everyday things", food: "food by post", tech: "small gadgets", carry: "bags and umbrellas",
  "desk-home": "desk and home things", outdoors: "outdoor things",
};
const words = (c) => CATEGORY_WORDS[c] || c.replace(/-/g, " ");

// ---------------------------------------------------------------- where each competitor stands today

/**
 * A competitor's stance in one category on a date: the product of every move in force.
 * Moves made because of world_settings are not read from the records: the settings themselves are the truth, so
 * editing or removing a setting takes effect at once and nothing is counted twice.
 * @return {{ price_factor: number, ad_factor: number, weight_add: number, add_price_factor: number, moves: Array<object> }}
 */
export function stanceOn(state, comp, category, date) {
  const out = { price_factor: 1, ad_factor: 1, weight_add: 0, add_price_factor: 1, moves: [] };
  for (const m of state.competitor_moves || []) {
    // WHY skip a copy of one named product: it competes with that product, not the whole category (productCompetition).
    if (m.competitor !== comp.id || m.forced || m.products?.length || !(m.categories || []).includes(category)) continue;
    if (m.from > date || m.to < date) continue;
    applyMove(out, m);
  }
  for (const s of activeSettings(state, "competitor_moves", date)) {
    if (s.competitor !== comp.id || s.product) continue;
    const cats = s.launch_category ? [s.launch_category] : s.categories || comp.categories;
    if (!cats.includes(category)) continue;
    applyMove(out, forcedAsMove(s, comp));
  }
  return out;
}

function applyMove(out, m) {
  out.price_factor *= m.price_factor ?? 1;
  out.ad_factor *= m.ad_factor ?? 1;
  if (m.weight_add) { out.weight_add += m.weight_add; out.add_price_factor = m.add_price_factor ?? 0.8; }
  out.moves.push(m);
}

/** A world_settings competitor move in the same shape as a recorded move. */
function forcedAsMove(s, comp) {
  if (s.launch_category) {
    return { competitor: comp.id, kind: "launch", categories: [s.launch_category], weight_add: s.weight_add ?? comp.rules?.launch?.weight_add ?? 0.15,
      add_price_factor: s.price_factor ?? 0.8, forced: true, from: s.from, to: s.to, ...(s.product ? { products: [s.product] } : {}) };
  }
  return { competitor: comp.id, kind: (s.price_factor ?? 1) < 1 ? "price_cut" : "change", categories: s.categories || comp.categories,
    price_factor: s.price_factor ?? 1, ad_factor: s.ad_factor ?? 1, forced: true, from: s.from, to: s.to };
}

/** One rival's attraction in a category given its stance. */
function attraction(market, weight, stance) {
  let a = weight * Math.exp(-market.price_beta * (stance.price_factor - 1)) * Math.pow(stance.ad_factor, market.ad_gamma);
  if (stance.weight_add) a += stance.weight_add * Math.exp(-market.price_beta * (stance.add_price_factor - 1));
  return a;
}

/**
 * Overthought's demand multiplier per category from what its rivals are doing today, with the reasons.
 * @param {object} defs orgsFor(state).
 * @param {object} state Engine state.
 * @param {string} date YYYY-MM-DD.
 * @param {Array<string>} categories The shop's categories.
 * @return {{ categories: Object<string, number>, why: Array<object> }}
 */
export function competitorEffects(defs, state, date, categories) {
  const market = defs.market;
  const out = { categories: {}, why: [] };
  for (const cat of categories) {
    const rivals = competitorsIn(defs, cat);
    if (!rivals.length) continue;
    let normal = market.overthought_weight + market.outside_weight, now = normal;
    const causes = [];
    for (const r of rivals) {
      const w = r.weights?.[cat] ?? 0.3;
      const st = stanceOn(state, r, cat, date);
      normal += w;
      now += attraction(market, w, st);
      if (st.moves.length) causes.push(`${r.name} ${st.moves.map(moveWords).join(" and ")}`);
    }
    const m = normal / now;
    if (Math.abs(m - 1) < 0.001) continue;
    out.categories[cat] = m;
    out.why.push({
      source: "competitors", effect: `Demand for ${words(cat)} ${percentWords(m)}`, size: round(m, 3),
      because: `${causes.join("; ")}. Some shoppers who would have bought from Overthought buy from them instead${m > 1 ? " (or, with their prices up, come back)" : ""}.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------- a copy of one named product

/**
 * How strongly a direct copy of one product competes with it, against Overthought's own weight 1 for that product.
 * An assumption: a look-alike of one thing is a much closer substitute for it than a general alternative is for a whole
 * category (0.15 there), so a copy 20% cheaper takes about a quarter of that product's demand and none of its siblings'.
 */
export const PRODUCT_COPY_WEIGHT = 0.5;

/**
 * Overthought's demand multiplier per product from rivals' copies of named products (a launch with `product`, from
 * world_settings or recorded), the same attraction form as competitorEffects but for one product's own market.
 * @param {object} defs orgsFor(state).
 * @param {object} state
 * @param {string} date
 * @param {?Array<object>} products The catalogue, for names in the reasons.
 * @return {{ products: Object<string, number>, why: Array<object> }}
 */
export function productCompetition(defs, state, date, products = null) {
  const market = defs.market, out = { products: {}, why: [] };
  const copies = {};
  const add = (id, comp, a) => { (copies[id] ||= []).push({ comp, a }); };
  for (const m of state.competitor_moves || []) {
    if (m.forced || !m.products?.length || m.from > date || m.to < date) continue;
    const comp = findOrg(defs, m.competitor);
    for (const id of m.products) add(id, comp, (m.weight_add ?? PRODUCT_COPY_WEIGHT) * Math.exp(-market.price_beta * ((m.add_price_factor ?? 0.8) - 1)));
  }
  for (const s of activeSettings(state, "competitor_moves", date)) {
    if (!s.product) continue;
    add(s.product, findOrg(defs, s.competitor), (s.weight_add ?? PRODUCT_COPY_WEIGHT) * Math.exp(-market.price_beta * ((s.price_factor ?? 0.8) - 1)));
  }
  for (const [id, list] of Object.entries(copies)) {
    const normal = 1 + market.outside_weight;
    const m = normal / (normal + list.reduce((n, x) => n + x.a, 0));
    const name = (products || []).find((p) => p.id === id)?.name || id;
    out.products[id] = clamp(m, 0.3, 2);
    out.why.push({ source: "competitors", effect: `Demand for ${name} ${percentWords(m)}`, size: round(m, 3),
      because: `${listWords(list.map((x) => x.comp?.name || "A rival"))} sell${list.length > 1 ? "" : "s"} a cheaper copy of ${name}. Shoppers who would have bought it from Overthought buy the copy instead; other products are not affected.` });
  }
  return out;
}

function moveWords(m) {
  if (m.kind === "launch") return "has a cheaper alternative on sale";
  if (m.kind === "ad_push" || m.kind === "trend_push") return "is advertising hard";
  if ((m.price_factor ?? 1) > 1) return `has put prices up ${Math.round((m.price_factor - 1) * 100)}%`;
  if ((m.price_factor ?? 1) < 1) return `has prices ${Math.round((1 - m.price_factor) * 100)}% lower than usual${m.ad_factor > 1 ? " and is advertising" : ""}`;
  return "is advertising";
}

// ---------------------------------------------------------------- Overthought's own prices, as rivals see them

/** The price of a sku on a date: the latest recorded change on or before it, else the catalogue price. */
function priceOn(state, sku, base, date) {
  let price = base, at = "";
  for (const h of state.price_history || []) if (h.sku === sku && h.date <= date && h.date >= at) { price = h.new_price; at = h.date; }
  return price;
}

/** Overthought's price level in a category on a date (1 = catalogue prices). Null when it sells nothing there. */
export function ownPriceIndex(state, products, category, date) {
  const ps = (products || []).filter((p) => p.category === category && p.variants?.length);
  if (!ps.length) return null;
  return ps.reduce((n, p) => n + priceOn(state, p.variants[0].sku, p.variants[0].price, date) / p.variants[0].price, 0) / ps.length;
}

/** The date of the latest price cut in a category within the window (what a rival would react to), or null. */
function latestCut(state, products, category, from, to) {
  const skus = new Set((products || []).filter((p) => p.category === category).flatMap((p) => p.variants.map((v) => v.sku)));
  let at = null;
  for (const h of state.price_history || []) if (skus.has(h.sku) && h.new_price < h.old_price && h.date > from && h.date <= to && (!at || h.date > at)) at = h.date;
  return at;
}

// ---------------------------------------------------------------- weekly decisions

/** Whether a date is inside a season window ["MM-DD", "MM-DD"]. */
function inSeason(market, season, date) {
  const w = market.seasons?.[season];
  if (!w) return false;
  const md = date.slice(5);
  return md >= w[0] && md <= w[1];
}

/** Has this competitor already made a move of this kind for this season this year? */
function hadSeason(state, comp, kind, season, year) {
  return (state.competitor_moves || []).some((m) => m.competitor === comp.id && m.kind === kind && m.season === season && m.from.slice(0, 4) === year);
}

const activeOrPending = (state, comp, kind, date, cat = null) => (state.competitor_moves || []).some((m) =>
  m.competitor === comp.id && m.kind === kind && m.to >= date && (!cat || (m.categories || []).includes(cat)));

/**
 * Every competitor's decisions for one week, made on a Monday. Pure apart from reading the state.
 * @param {object} defs orgsFor(state).
 * @param {object} state Engine state (read only here).
 * @param {string} date The Monday, YYYY-MM-DD.
 * @param {number} seed Run seed.
 * @param {Array<object>} products The catalogue (for Overthought's prices and launches); may be empty.
 * @return {Array<object>} New move records without ids, in a fixed order.
 */
export function decideWeek(defs, state, date, seed, products) {
  const moves = [];
  for (const comp of defs.competitors) {
    const R = comp.rules || {};
    for (const rule of R.sales || []) seasonal(moves, defs, state, comp, rule, "sale", date, seed);
    if (R.price_rises) seasonal(moves, defs, state, comp, R.price_rises, "price_rise", date, seed);
    if (R.follow_cuts) followCuts(moves, defs, state, comp, R.follow_cuts, date, seed, products);
    if (R.launch) launches(moves, state, comp, R.launch, date, seed, products);
    if (R.ad_push) adPush(moves, defs, state, comp, R.ad_push, date, seed);
    if (R.trend_push) trendPush(moves, state, comp, R.trend_push, date, seed);
  }
  return moves;
}

function seasonal(moves, defs, state, comp, rule, kind, date, seed) {
  if (!inSeason(defs.market, rule.season, date)) return;
  const year = date.slice(0, 4);
  if (hadSeason(state, comp, kind, rule.season, year) || moves.some((m) => m.competitor === comp.id && m.season === rule.season)) return;
  // WHY keyed by year and season, not date: one decision per season, so a "no" on the first Monday stays a "no".
  if (!rngFor(seed, "competitor-season", year, rule.season, comp.id, kind).chance(rule.chance)) return;
  const name = defs.market.season_names?.[rule.season] || rule.season;
  const pct = Math.round(Math.abs(1 - rule.price_factor) * 100);
  const cats = listWords(comp.categories.map(words));
  moves.push({
    date, competitor: comp.id, competitor_name: comp.name, kind, season: rule.season, categories: comp.categories,
    from: date, to: addDays(date, rule.length_days - 1), price_factor: rule.price_factor, ad_factor: rule.ad_factor ?? 1,
    headline: kind === "sale" ? `${comp.name} starts its ${name}: up to ${pct}% off` : `${comp.name} puts its prices up by ${pct}%`,
    story: kind === "sale"
      ? `${comp.name} has cut prices on ${cats} for its ${name}, which runs until ${dateWords(addDays(date, rule.length_days - 1))}. Shoppers comparing prices will notice.`
      : `${comp.name} has raised its prices on ${cats}. It says its customers come for quality, not bargains.`,
    reason: `Its calendar: a ${name} most years (chance ${Math.round(rule.chance * 100)}%).`,
  });
}

function followCuts(moves, defs, state, comp, rule, date, seed, products) {
  const watch = defs.market.cut_watch_days ?? 14;
  for (const cat of comp.categories) {
    const now = ownPriceIndex(state, products, cat, date);
    const before = ownPriceIndex(state, products, cat, addDays(date, -watch));
    if (now === null || before === null || now >= before * (1 - (defs.market.cut_threshold ?? 0.03))) continue;
    const cutAt = latestCut(state, products, cat, addDays(date, -watch), date);
    if (!cutAt) continue;
    const trigger = `${cat}|${cutAt}`;
    if ((state.competitor_moves || []).some((m) => m.competitor === comp.id && m.trigger === trigger)) continue;
    const r = rngFor(seed, "competitor-follow", comp.id, cat, cutAt);
    if (!r.chance(rule.chance)) continue;
    const cut = 1 - now / before;
    const delay = r.int(rule.delay_days[0], rule.delay_days[1]);
    const from = addDays(date, delay);
    const pf = round(1 - rule.follow_share * cut, 3);
    moves.push({
      date, competitor: comp.id, competitor_name: comp.name, kind: "price_match", trigger, categories: [cat],
      from, to: addDays(from, rule.length_days - 1), price_factor: pf, ad_factor: 1,
      headline: `${comp.name} cuts prices on ${words(cat)}`,
      story: `${comp.name} has lowered its prices on ${words(cat)} by about ${Math.round((1 - pf) * 100)}%, a few days after Overthought & Co. cut its own. Price watchers expect the two to keep an eye on each other.`,
      reason: `Overthought cut its ${words(cat)} prices by ${Math.round(cut * 100)}% (on ${dateWords(cutAt)}). Its rule: follow cuts (chance ${Math.round(rule.chance * 100)}%) after ${rule.delay_days[0]} to ${rule.delay_days[1]} days.`,
    });
  }
}

/** Overthought products launched (launch_product) in the last 28 days, by category. */
function recentLaunches(state, products, date) {
  const out = [];
  for (const [id, s] of Object.entries(state.product_status || {})) {
    if (s?.status !== "active" || !s.available_from || s.available_from > date || daysBetween(s.available_from, date) > 28) continue;
    const p = (products || []).find((x) => x.id === id);
    if (p) out.push(p);
  }
  return out;
}

function launches(moves, state, comp, rule, date, seed, products) {
  let cat = null, because = null, trigger = null;
  for (const p of recentLaunches(state, products, date)) {
    if (!comp.categories.includes(p.category)) continue;
    trigger = `launch|${p.id}|${state.product_status[p.id].available_from}`;
    if ((state.competitor_moves || []).some((m) => m.competitor === comp.id && m.trigger === trigger)) { trigger = null; continue; }
    if (rngFor(seed, "competitor-copy", comp.id, trigger).chance(rule.after_overthought_launch)) {
      cat = p.category; because = `Overthought launched ${p.name || p.id}; its rule is to copy what sells.`; break;
    }
    trigger = null;
  }
  if (!cat) {
    const r = rngFor(seed, "competitor-launch", date, comp.id);
    if (!r.chance(rule.chance_per_year / 52)) return;
    cat = r.pick(comp.categories);
    because = `It launches a copy of something popular now and then (about ${rule.chance_per_year} a year).`;
  }
  moves.push({
    date, competitor: comp.id, competitor_name: comp.name, kind: "launch", trigger, categories: [cat],
    from: date, to: addDays(date, rule.length_days - 1), weight_add: rule.weight_add, add_price_factor: rule.price_factor,
    headline: `${comp.name} launches a cheaper alternative in ${words(cat)}`,
    story: `${comp.name} has brought out a new line in ${words(cat)}, priced about ${Math.round((1 - rule.price_factor) * 100)}% below the shops it resembles. Reviewers say it looks very familiar.`,
    reason: because,
  });
}

function adPush(moves, defs, state, comp, rule, date, seed) {
  if (activeOrPending(state, comp, "ad_push", date)) return;
  const month = Number(date.slice(5, 7));
  let p = rule.chance_per_week;
  if (rule.q4_multiplier && month >= 10) p *= rule.q4_multiplier;
  if (rule.season && inSeason(defs.market, rule.season, date)) p *= rule.season_multiplier || 1;
  if (!rngFor(seed, "competitor-ad", date, comp.id).chance(Math.min(0.9, p))) return;
  moves.push({
    date, competitor: comp.id, competitor_name: comp.name, kind: "ad_push", categories: comp.categories,
    from: date, to: addDays(date, rule.length_days - 1), price_factor: 1, ad_factor: rule.ad_factor,
    headline: `${comp.name} is advertising everywhere`,
    story: `Adverts for ${comp.name} are turning up all over the internet this week.`,
    reason: `It pushes its advertising now and then (about ${Math.round(p * 52 * 10) / 10} times a year at this time of year).`,
    newsworthy: false,
  });
}

function trendPush(moves, state, comp, rule, date, seed) {
  for (const cat of comp.categories) {
    const latest = latestTrend(state, cat);
    if (!latest || latest.interest < rule.interest_above || activeOrPending(state, comp, "trend_push", date, cat)) continue;
    if (!rngFor(seed, "competitor-trend", date, comp.id, cat).chance(rule.chance)) continue;
    moves.push({
      date, competitor: comp.id, competitor_name: comp.name, kind: "trend_push", categories: [cat],
      from: date, to: addDays(date, rule.length_days - 1), price_factor: 1, ad_factor: rule.ad_factor,
      headline: `${comp.name} rides the fashion for ${words(cat)}`,
      story: `${comp.name} is advertising its ${words(cat)} while they are in fashion.`,
      reason: `Interest in ${words(cat)} is ${latest.interest} (normal is 100); its rule is to advertise when it passes ${rule.interest_above}.`,
      newsworthy: false,
    });
  }
}

/** The latest trend row for a category, or null. Read backwards: the newest rows are at the end. */
function latestTrend(state, cat) {
  const t = state.trends || [];
  for (let i = t.length - 1; i >= 0; i--) if (t[i].category === cat) return t[i];
  return null;
}

// ---------------------------------------------------------------- the day's work

/**
 * End of a day: on Mondays every competitor decides; any move made through world_settings is recorded once; news is
 * published for notable moves on the day they start.
 * @param {object} defs orgsFor(state).
 * @param {object} state Engine state (moves and news are added).
 * @param {string} date YYYY-MM-DD.
 * @param {number} seed
 * @param {Array<object>} products
 * @return {Array<object>} The moves recorded today.
 */
export function competitorsAfterDay(defs, state, date, seed, products, { posts = true } = {}) {
  state.competitor_moves = state.competitor_moves || [];
  const added = [];
  const record = (m) => { const rec = { id: nextStateId(state, "CM", "competitor_moves"), ...m }; state.competitor_moves.push(rec); added.push(rec); };
  if (new Date(`${date}T00:00:00Z`).getUTCDay() === 1) for (const m of decideWeek(defs, state, date, seed, products)) record(m);
  recordForced(defs, state, date, record, products);
  for (const m of state.competitor_moves) {
    // WHY from <= date and not ==: a move set mid-way through its dates (an experiment) is still reported, once.
    if (m.newsworthy === false || m.news_id || m.from > date || m.to < date) continue;
    const item = publishNews(state, { date, headline: m.headline, story: m.story, section: "Business", source: `competitor_move:${m.id}` });
    if (item) m.news_id = item.id;
  }
  if (posts) for (const m of state.competitor_moves) if (!m.post_id && (m.from === date || (m.forced && m.date === date))) postMove(defs, state, m, date, seed);
  return added;
}

/** What a rival says on Mutter when it makes a move, in its own voice. Plain words; never a record code. */
const POST_LINES = {
  sale: [(m, c) => `Our ${c.season} is on! Up to ${c.pct}% off ${c.cats} until ${c.to}. Go on, treat yourself.`, (m, c) => `It's that time again: ${c.pct}% off ${c.cats}. Ends ${c.to}.`],
  price_rise: [(m, c) => `A small note: prices on ${c.cats} go up a little today. Good things take good materials.`],
  price_match: [(m, c) => `New lower prices on ${c.cats}, from today. Same things, smaller bill.`, (m, c) => `We've had a look at the competition. Our ${c.cats} just got cheaper.`],
  launch: [(m, c) => `Brand new in ${c.cats}: the one everyone's talking about, for less.`, (m, c) => `Just landed: our take on ${c.cats}. You might find it looks familiar. It costs less.`],
  ad_push: [(m, c) => `${c.about} Have a look.`],
  trend_push: [(m, c) => `Everyone wants ${c.cats} right now. We have plenty.`],
  price_cut: [(m, c) => `Prices down on ${c.cats}, from today.`],
  change: [(m, c) => `Some changes to our prices on ${c.cats} today.`],
};

/** Adds a rival's Mutter post for a move (author kind "organisation"), once. WHY: the social apps show the wider world too. */
function postMove(defs, state, m, date, seed) {
  const comp = findOrg(defs, m.competitor);
  if (!comp) return;
  state.social_posts = state.social_posts || [];
  const r = rngFor(seed, "competitor-post", m.competitor, m.from, m.kind);
  const lines = POST_LINES[m.kind] || POST_LINES.change;
  const ctx = { season: defs.market.season_names?.[m.season] || "sale", pct: Math.round(Math.abs(1 - (m.price_factor ?? m.add_price_factor ?? 1)) * 100),
    cats: listWords((m.categories || []).map(words)), to: dateWords(m.to), about: comp.about };
  const id = nextStateId(state, "SP", "social_posts", 6);
  state.social_posts.push({
    key: `world|mutter|move|${m.id}`, network: "mutter", author: { kind: "organisation", name: comp.name, handle: comp.id.replace(/-/g, ""), org_id: comp.id },
    kind: "post", text: r.pick(lines)(m, ctx), image: null, at: `${date}T${String(r.int(9, 16)).padStart(2, "0")}:${String(r.int(0, 59)).padStart(2, "0")}:00Z`,
    likes: r.int(2, 40), reposts: r.int(0, 8), parent_key: null, thread: null, by: null, mentions_shop: false, links: { competitor_move: m.id }, id, parent: null,
  });
  m.post_id = id;
}

/** Records each world_settings competitor move once, on its first day, so the newspaper and the record show it. */
function recordForced(defs, state, date, record, products = null) {
  (state.world_settings?.competitor_moves || []).forEach((s, i) => {
    if (!s || (s.from && s.from > date) || (s.to && s.to < date)) return;
    const key = `settings|${i}|${s.competitor}|${s.from || ""}`;
    if (state.competitor_moves.some((m) => m.trigger === key)) return;
    const comp = findOrg(defs, s.competitor);
    if (!comp || comp.kind !== "competitor") return;
    const mv = forcedAsMove(s, comp);
    const cat = listWords((mv.categories || []).map(words));
    const launch = mv.kind === "launch";
    const pct = Math.round(Math.abs(1 - (launch ? mv.add_price_factor : mv.price_factor)) * 100);
    const copied = s.product ? (products || []).find((p) => p.id === s.product)?.name || s.product : null;
    record({
      ...mv, date, competitor_name: comp.name, trigger: key, from: s.from || date, to: s.to || addDays(date, 364),
      headline: copied ? `${comp.name} launches a cheaper copy of ${copied}` : launch ? `${comp.name} launches a cheaper alternative in ${cat}`
        : mv.price_factor < 1 ? `${comp.name} cuts prices on ${cat} by ${pct}%` : `${comp.name} changes its prices on ${cat}`,
      story: copied ? `${comp.name} has brought out its own version of Overthought's ${copied}, priced about ${pct}% lower.`
        : launch ? `${comp.name} has brought out a new line in ${cat}, priced about ${pct}% below what it copies.`
        : `${comp.name} has ${mv.price_factor < 1 ? "lowered" : "changed"} its prices on ${cat}. Shoppers comparing prices will notice.`,
      reason: "Set in the world settings (an experiment).",
    });
  });
}

/** The "why" lines for competitor effects, clamped so a broken setting cannot make demand absurd. */
export function clampCategories(cats) {
  for (const k of Object.keys(cats)) cats[k] = clamp(cats[k], 0.3, 2);
  return cats;
}
