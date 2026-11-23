// Customers, and the orders each of them means to place (before stock decides what they can get).
import fs from "node:fs";
import { rngFor } from "./rng.mjs";
import { DAY, MINUTE, START, at, dayStart, dateOf, demand, weekday, ORDER_HOURS, parse, iso, expectedOrders, growth, SIM_DEMAND } from "./calendar.mjs";
import { campaignBoost, activeCode } from "./marketing.mjs";
import { CHARACTERS, CHARACTER_AREAS, PLANTED, KIND_TO_TYPE, RELATION_COUNT, applyPass, slug, excludedHome } from "./characters.mjs";
import { makeEffects } from "./effects.mjs";
import { buildExtra } from "./characters-extra.mjs";

/** Customers are recognisable public-domain characters; see characters.mjs for the list, the rights rules and the second-pass rule. */
const EXTRA = buildExtra();
/** Invented postcode areas: the first list's, plus the extra list's (used by sizes that need more than 974 characters). */
export const FAKE_POSTCODE_AREAS = [...CHARACTER_AREAS, ...EXTRA.areas];

/**
 * Customer types. Weights are shares of new customers.
 * WHY: most online shoppers buy once as a gift; a third come back; a few return a lot or complain often;
 * a handful of offices buy sandwiches weekly.
 */
export const CUSTOMER_TYPES = [["gift", 0.53], ["regular", 0.33], ["returner", 0.07], ["complainer", 0.05], ["business", 0.02]];

/**
 * Share of orders placed by someone who has bought before, once the shop is established.
 * WHY: a five-year-old shop with regulars, office orders and gift buyers who come back at Christmas takes most of its
 * orders from people it knows; about two in three. The simulator's dropout chances (business/data/sim.json customer_model)
 * imply more still; this sits between that and the usual small-shop figure of about half.
 */
const REPEAT_SHARE = 0.66;
/** Days the repeat share takes to build up from nothing. WHY: in the first months there is nobody to come back. */
const REPEAT_RAMP_DAYS = 540;
/**
 * Chance a customer stops buying after each order: the mean of the simulator's dropout distribution for their kind
 * (business/data/sim.json customer_model, beta(a, b) has mean a / (a + b)), so history and simulation lose customers alike.
 */
const SIM_KINDS = JSON.parse(fs.readFileSync(new URL("../../data/sim.json", import.meta.url), "utf8")).customer_model.kinds;
const dropout = (k) => SIM_KINDS[k].dropout_a / (SIM_KINDS[k].dropout_a + SIM_KINDS[k].dropout_b);
const CHURN = { gift: dropout("gift"), regular: dropout("regular"), returner: dropout("returns_a_lot"), complainer: dropout("complains") };
/** How likely each kind of past customer is to be the one who comes back (business/data/sim.json customer_kind_weight). */
const KIND_WEIGHT = {
  gift: SIM_DEMAND.customer_kind_weight.gift, regular: SIM_DEMAND.customer_kind_weight.regular,
  returner: SIM_DEMAND.customer_kind_weight.returns_a_lot, complainer: SIM_DEMAND.customer_kind_weight.complains,
};
/** Nobody orders again within this many days of their last order. */
const MIN_GAP_DAYS = 10;
/** Offices that order sandwiches every Monday, per unit of scale. */
const BUSINESSES_PER_SCALE = 10;
/** Which product someone came for (business/data/sim.json product_weights). WHY: one set of weights for history and simulation. */
const LEAD = SIM_DEMAND.product_weights;
/** A product sells harder in its first weeks. WHY: launch posts, curiosity and the launch campaign. */
const LAUNCH_BOOST = 2;
const LAUNCH_BOOST_DAYS = 42;
/** Gifts lean towards things that look like presents in November and December. */
const GIFT_BOOST = { trophy: 2.2, "biscuit-tin": 2.2, "skimming-stones": 1.5, daypack: 1.5, "boombox-mini": 1.4, "pocket-jungle": 1.4 };
/** What sells together. WHY: people buy the case with the Blip, clips with socks, sandwiches with ice for parties. */
const COMPANIONS = {
  "OT-BLIP": [["OT-BLIP-CASE", 0.35], ["OT-BLIP-CHG", 0.2], ["OT-BLIP-LAN", 0.15]],
  "OT-BOOM": [["OT-BOOM-CASE", 0.3]], "OT-PACK": [["OT-PACK-SLV", 0.3]], "OT-SOCK": [["OT-SOCK-CLIP", 0.2]],
  "OT-PEN": [["OT-PEN-REFILL", 0.3]], "OT-HELM": [["OT-HELM-LINER", 0.25]], "OT-JUNG": [["OT-JUNG-KIT", 0.2], ["OT-JUNG-PLANT", 0.1]],
  "OT-STON-SKP-5": [["OT-STON-POUCH", 0.15]], "OT-PUDL": [["OT-PUDL-MAT", 0.3]], "OT-ICE": [["OT-SAND-HAM-3", 0.2], ["OT-SAND-CHP-3", 0.15]],
};
const REPEAT_ACCESSORIES = ["OT-BLIP-CHG", "OT-PEN-REFILL", "OT-JUNG-PLANT", "OT-SOCK-CLIP", "OT-HELM-LINER"];
/** Planted customers only get history orders for everyday consumables, so their stories stay as written. */
const SAFE_FOR_PLANTED = ["OT-SOCK", "OT-PLAN-1", "OT-PLAN-5", "OT-PEN", "OT-PEN-REFILL", "OT-WRAP", "OT-SOCK-CLIP"];
/** Share of orders not needing the chilled van that pay for Sooner. */
const NEXT_DAY_SHARE = SIM_DEMAND.next_day_share;
/** Share of orders during an email campaign that use its code. */
const CODE_USE = 0.25;

/** Picks days in proportion to demand (and campaign boosts and events), between two times. */
export function makeDaySampler(from, to, campaigns, effects = makeEffects()) {
  const days = [], cum = [];
  let total = 0;
  for (let d = dayStart(from); d <= to; d += DAY) {
    total += demand(d) * campaignBoost(d, campaigns) * effects.at(d).demand.all;
    days.push(d); cum.push(total);
  }
  return (rng) => {
    const r = rng.next() * total;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    return days[lo];
  };
}

const timeOn = (rng, day) => at(day, rng.weighted(ORDER_HOURS), rng.int(0, 59));

/**
 * Hands out characters in a fixed, seeded order. Every real character in the pool (both lists) is used once, in a
 * shuffled order, so named characters are spread over all five years. A customer of a given type gets the next unused
 * character whose kind matches; if none is left, the next unused one.
 * Only when a size needs more customers than there are characters (the large world) are derived names mixed in:
 * a relation, a household member or a tradesman of a character ("Mr Toad's coachman", "A niece of Emma Woodhouse"),
 * each pattern used about equally, and drawn evenly through time rather than after the real names run out.
 * @param {number} seed
 * @param {number} count About how many customers will be needed.
 * @param {{firstPass: Set<string>, always: Set<string>}} exclude Names kept out as customers (story customers) and
 *     names never used at all, not even as a base (staff).
 */
function characterPicker(seed, count, exclude) {
  const usable = (c) => !exclude.always.has(c.name) && !excludedHome(c);
  const all = [...CHARACTERS, ...EXTRA.characters].filter(usable);
  const rng = rngFor(seed, "characters", 0);
  const remaining = all.filter((c) => !exclude.firstPass.has(c.name));
  for (let i = remaining.length - 1; i > 0; i--) { const j = rng.int(0, i); [remaining[i], remaining[j]] = [remaining[j], remaining[i]]; }
  const used = new Set([...exclude.firstPass, ...exclude.always]);
  let derivedLeft = Math.max(0, count - remaining.length);
  const derived = () => {
    for (let tries = 0; tries < 50; tries++) {
      const c = applyPass(rng.pick(all), 1 + rng.int(0, RELATION_COUNT - 1));
      if (!used.has(c.name)) return c;
    }
    // WHY: a last resort that is still unique, never reached at the sizes we build.
    return applyPass(rng.pick(all), RELATION_COUNT + 1 + used.size);
  };
  return (type) => {
    // WHY: the chance of a derived name is its share of what is still to come, so both kinds run out together.
    const useDerived = !remaining.length || (derivedLeft > 0 && rng.chance(derivedLeft / (derivedLeft + remaining.length)));
    let c;
    if (useDerived) {
      c = derived();
      derivedLeft = Math.max(0, derivedLeft - 1);
    } else {
      let i = remaining.findIndex((x) => KIND_TO_TYPE[x.kind] === type);
      if (i < 0) i = 0;
      c = remaining.splice(i, 1)[0];
    }
    used.add(c.name);
    return c;
  };
}

/** Variant of a product someone picks, and how many. */
function pickVariant(rng, p, t, cat) {
  const live = (p.variants || []).filter((v) => cat.skus[v.sku].launched <= iso(t).slice(0, 10));
  const v = p.id === "skimming-stones" ? rng.weighted([[live[0], 5], [live[1], 3.5], [live[2], 1.5]].filter(([x]) => x))
    : p.id === "paper-aeroplane" ? rng.weighted([[live[0], 6], [live[1], 4]]) : rng.pick(live);
  const qty = ["spare-sock", "paper-aeroplane"].includes(p.id) ? rng.weighted([[1, 6], [2, 3], [3, 1]])
    : p.id === "emergency-sandwich" ? rng.weighted([[1, 6], [2, 3], [3, 1]]) : p.id === "ice-by-post" ? rng.weighted([[1, 7], [2, 3]]) : 1;
  return [v.sku, qty];
}

/** Product weight on a day: its base weight, a gift lift before Christmas, a launch lift, and any world event. */
function leadProduct(rng, t, cat, gifty, town, effects) {
  const day = iso(t).slice(0, 10);
  const month = new Date(t).getUTCMonth();
  const pairs = cat.products.filter((p) => cat.skus[p.variants[0].sku].launched <= day).map((p) => {
    const launched = parse(cat.skus[p.variants[0].sku].launched);
    const launch = t - launched < LAUNCH_BOOST_DAYS * DAY ? LAUNCH_BOOST : 1;
    const gift = gifty && month >= 10 ? GIFT_BOOST[p.id] || 1 : 1;
    return [p, LEAD[p.id] * gift * launch * effects.demandFor(t, p.id, p.category, town)];
  });
  return rng.weighted(pairs);
}

/** One basket: a lead product, things that go with it, sometimes a second product. */
export function makeBasket(rng, t, cat, { type, planted, repeat, town = "", effects = makeEffects() }) {
  const lines = new Map();
  const add = ([sku, qty]) => lines.set(sku, (lines.get(sku) || 0) + qty);
  if (type === "business") {
    const flavours = ["OT-SAND-HAM-3", "OT-SAND-EGG-3", "OT-SAND-CHP-3", "OT-SAND-PLN-3"];
    for (let i = rng.int(1, 3); i > 0; i--) add([rng.pick(flavours), 1]);
  } else if (planted) {
    add([rng.pick(SAFE_FOR_PLANTED.filter((s) => cat.skus[s].launched <= iso(t).slice(0, 10))), 1]);
  } else if (repeat && rng.chance(0.06)) {
    const owned = REPEAT_ACCESSORIES.filter((s) => cat.skus[s].launched <= iso(t).slice(0, 10));
    add([rng.pick(owned), 1]);
  } else {
    const first = pickVariant(rng, leadProduct(rng, t, cat, type === "gift", town, effects), t, cat);
    add(first);
    for (const [sku, p] of COMPANIONS[first[0]] || []) if (cat.skus[sku].launched <= iso(t).slice(0, 10) && rng.chance(p)) add([sku, 1]);
    if (rng.chance(SIM_DEMAND.second_product_chance)) add(pickVariant(rng, leadProduct(rng, t, cat, false, town, effects), t, cat));
  }
  let skus = [...lines.keys()];
  const chilled = skus.some((s) => cat.skus[s].chilled);
  // WHY: a live plant travels by Sooner and chilled food by Cold; one parcel cannot be both, so the plant waits for another day.
  if (chilled) skus = skus.filter((s) => !cat.skus[s].plant);
  const method = chilled ? "chilled" : skus.some((s) => cat.skus[s].plant) ? "next-day" : rng.chance(NEXT_DAY_SHARE) ? "next-day" : "standard";
  return { lines: skus.map((sku) => ({ sku, qty: lines.get(sku) })), method };
}

/** A count from a Poisson distribution, drawn from one uniform number (inversion), so each day costs one draw. */
function poisson(lambda, u) {
  if (lambda <= 0) return 0;
  // WHY: above a few hundred, exp(-lambda) underflows; a normal approximation is indistinguishable there.
  if (lambda > 300) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normalFromUniform(u)));
  let k = 0, p = Math.exp(-lambda), cum = p;
  while (u > cum && k < 10 * lambda + 50) { k++; p *= lambda / k; cum += p; }
  return k;
}

/** Inverse of the standard normal distribution (Acklam's rational approximation, plenty for counts). */
function normalFromUniform(u) {
  const x = Math.min(Math.max(u, 1e-9), 1 - 1e-9);
  const t = Math.sqrt(-2 * Math.log(x < 0.5 ? x : 1 - x));
  const z = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
  return x < 0.5 ? -z : z;
}

/** Share of today's orders that come from someone who has bought before. */
const repeatShare = (d) => REPEAT_SHARE * Math.min(1, (d - START) / (REPEAT_RAMP_DAYS * DAY));

/**
 * Past customers who might come back, by type. Picking is O(1): choose a type by weight times how many are left,
 * then one person of that type. People who churn are swapped out of their list.
 */
function makeReturningPools() {
  const pools = { gift: [], regular: [], returner: [], complainer: [] };
  const add = (p) => { p.slot = pools[p.type].length; pools[p.type].push(p); };
  const remove = (p) => {
    const list = pools[p.type];
    const last = list.pop();
    if (last !== p) { list[p.slot] = last; last.slot = p.slot; }
    p.slot = -1;
  };
  const pick = (rng, t) => {
    const pairs = Object.entries(pools).filter(([, l]) => l.length).map(([type, l]) => [type, KIND_WEIGHT[type] * l.length]);
    if (!pairs.length) return null;
    const list = pools[rng.weighted(pairs)];
    // WHY: a few tries for someone who has not just ordered; otherwise today's shopper is a new face.
    for (let tries = 0; tries < 3; tries++) {
      const p = list[rng.int(0, list.length - 1)];
      if (t - p.last >= MIN_GAP_DAYS * DAY) return p;
    }
    return null;
  };
  return { add, remove, pick };
}

/** Every Monday for a stretch, skipping Christmas weeks: an office's sandwich order. */
function businessDays(rng, join, now) {
  const days = [];
  let d = join + ((8 - weekday(join)) % 7) * DAY;
  const end = d + rng.int(20, 100) * 7 * DAY;
  for (d += 7 * DAY; d < end; d += 7 * DAY) {
    const md = new Date(d);
    const christmas = (md.getUTCMonth() === 11 && md.getUTCDate() >= 20) || (md.getUTCMonth() === 0 && md.getUTCDate() <= 4);
    if (!christmas && !rng.chance(0.08)) days.push(d);
  }
  return days.filter((x) => x < dayStart(now));
}

/** About how many new customers a world will need, so the character list can be sized before anyone is picked. */
function expectedNewCustomers(scale, now) {
  // WHY: a slight underestimate; if real names run out early, derived ones fill the gap, never the other way round.
  let fresh = 0;
  for (let d = START; d < dayStart(now); d += DAY) fresh += expectedOrders(d, scale) * (1 - repeatShare(d));
  return Math.round(fresh * 0.95);
}

/** A customer record (without id) for a character, drawn from that customer's own stream. */
function customerRecord(rng, who, type, firstOrderAt) {
  return {
    name: who.name, phone: "07700 900" + String(rng.int(0, 999)).padStart(3, "0"),
    addresses: [{ id: "A1", line1: who.address_line, town: who.town, postcode: who.postcode, default: true }], contact_preference: rng.weighted([["email", 7], ["sms", 2], ["phone", 1]]),
    marketing_opt_in: rng.chance(0.4), created_at: iso(firstOrderAt - rng.int(2, 25) * MINUTE), credit_balance: 0,
    notes: type === "business" ? `Orders sandwiches every Monday for the team at ${who.address_line}.` : "",
    _type: type, // removed before writing; used for habits such as returns and complaints
  };
}

/**
 * Customers and the orders they mean to place, driven by demand: each day a Poisson number of shoppers arrive
 * (expected orders for the world's scale, times campaigns and world events); each is a returning customer
 * or a new one. Offices with weekly sandwich orders come on top.
 * Every arrival draws from its own stream keyed by date and position, so a change on one day does not reshuffle
 * the baskets of other days.
 * @param {{seed: number, scale: number, now: number, cat: object, campaigns: object[], effects: object,
 *     firstNumber: number, exclude: {firstPass: Set<string>, always: Set<string>}}} opts
 * @returns {{customers: object[], intents: object[]}}
 */
export function makeCustomers({ seed, scale, now, cat, campaigns, effects = makeEffects(), firstNumber, exclude }) {
  const pickCharacter = characterPicker(seed, expectedNewCustomers(scale, now), exclude);
  const pools = makeReturningPools();
  const people = [], intents = [];
  const newPerson = (rng, type, t) => {
    const p = { rng, type, join: t, who: pickCharacter(type), visits: 0, last: 0, order: people.length };
    people.push(p);
    return p;
  };
  const addIntent = (p, key, t, rng) => {
    const { lines, method } = makeBasket(rng, t, cat, { type: p.type, planted: false, repeat: p.visits > 0, town: p.who.town, effects });
    const code = activeCode(t, campaigns);
    intents.push({ key, person: p, at: t, lines, method, type: p.type, code: code && rng.chance(CODE_USE) ? code : null });
    p.visits += 1; p.last = t; p.first = Math.min(p.first ?? t, t);
  };

  // Offices first, so their characters are chosen the same way whatever the shoppers do.
  for (let k = 0; k < Math.round(BUSINESSES_PER_SCALE * scale); k++) {
    const rng = rngFor(seed, "business", k);
    const join = dayStart(START + rng.int(200, 1500) * DAY);
    const p = newPerson(rng, "business", at(join, 9, rng.int(0, 50)));
    for (const d of businessDays(rng, join, now)) addIntent(p, `B${k}:${p.visits}`, at(d, 9, rng.int(0, 50)), rng);
    if (!p.visits) people.pop();
  }

  for (let d = START; d < dayStart(now); d += DAY) {
    const date = dateOf(d);
    const lambda = expectedOrders(d, scale) * campaignBoost(d, campaigns) * effects.at(d).demand.all;
    const n = poisson(lambda, rngFor(seed, "arrivals", date).next());
    for (let i = 0; i < n; i++) {
      const rng = rngFor(seed, "visit", date, i);
      const t = timeOn(rng, d);
      let p = rng.chance(repeatShare(d)) ? pools.pick(rng, t) : null;
      if (!p) {
        p = newPerson(rngFor(seed, "customer", date, i), rng.weighted(CUSTOMER_TYPES.filter(([x]) => x !== "business")), t);
        pools.add(p);
      }
      addIntent(p, `${date}:${i}`, t, rng);
      if (rng.chance(CHURN[p.type])) pools.remove(p);
    }
  }

  // Customer numbers follow the date of each person's first order.
  people.sort((a, b) => a.join - b.join || a.order - b.order);
  const usedEmails = new Set(exclude.firstPass.size ? PLANTED.map((n) => slug(n) + "@example.com") : []);
  const customers = people.map((p, n) => {
    p.id = "C-" + (firstNumber + n);
    let email = slug(p.who.name) + "@example.com";
    for (let k = 2; usedEmails.has(email); k++) email = slug(p.who.name) + k + "@example.com";
    usedEmails.add(email);
    const { name, ...rest } = customerRecord(p.rng, p.who, p.type, p.first);
    return { id: p.id, name, email, ...rest };
  });
  return { customers, intents: intents.map(({ person, ...x }) => ({ ...x, customer_id: person.id })) };
}

/**
 * A few older everyday orders for the planted story customers, so their accounts have history.
 * WHY: only consumables, at least 60 days old, so no story changes.
 */
export function plantedHistory({ seed, planted, now, cat, campaigns }) {
  const intents = [];
  for (const c of planted.customers) {
    if (c.addresses[0].postcode.startsWith("HI")) continue; // we do not deliver there
    const rng = rngFor(seed, "planted-history", c.id);
    const from = parse(c.created_at) + DAY, to = now - 60 * DAY;
    if (to - from < 30 * DAY) continue;
    const sampler = makeDaySampler(from, to, campaigns);
    const days = Array.from({ length: rng.weighted([[0, 1], [1, 3], [2, 2]]) }, () => sampler(rng)).sort((a, b) => a - b);
    days.forEach((d, k) => {
      const t = timeOn(rng, d);
      const { lines, method } = makeBasket(rng, t, cat, { type: "regular", planted: true, repeat: k > 0 });
      const code = activeCode(t, campaigns);
      intents.push({ key: `${c.id}h:${k}`, customer_id: c.id, at: t, lines, method, type: "regular", code: code && rng.chance(CODE_USE) ? code : null });
    });
  }
  return intents;
}
