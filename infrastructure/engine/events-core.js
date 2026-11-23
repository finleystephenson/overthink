// World events, the pure part: when things happen, what they do to the business on a given day, and what the news says.
// No Node imports, so it runs in a browser as well. Everything here is a plain function of its inputs.
//
// A "template" is one kind of event in business/data/events/library.json. An "occurrence" is one time it happens.
// Dates are plain "YYYY-MM-DD" text. A day number is whole days since 1970-01-01 (UTC), so adding days is adding.

const DAY_MS = 86400000;

/** The modifier keys the simulator understands (docs/environment-design.md, "Simulator plug-ins"). */
export const COST_KEYS = ["carrier", "goods", "card_fee"];

/** How far an added event's numbers may go. WHY: a typo such as 300 instead of 3.0 should be refused, not simulated. */
const MULTIPLIER_RANGE = [0.1, 10];
const MAX_DELAY_DAYS = 30;

// ---------------------------------------------------------------- random numbers

/** FNV-1a, the same hash as business/builder/world/rng.mjs. Copied (not imported) so this file has no path dependencies in a browser. */
export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32, the same generator as business/builder/world/rng.mjs, so streams match the world builder's. */
function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (p) => next() < p,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    between: (lo, hi) => lo + next() * (hi - lo),
    pick: (list) => list[Math.floor(next() * list.length)],
  };
}

/** One random stream per purpose and key. WHY: adding or editing one event must not reshuffle any other. */
const rngFor = (seed, ...keys) => makeRng(hashString(`${seed}|${keys.join("|")}`));

// ---------------------------------------------------------------- dates

/** "2026-11-22" to a day number. */
export const dayNumber = (text) => Math.floor(Date.parse(`${text.slice(0, 10)}T00:00:00Z`) / DAY_MS);

/** A day number back to "YYYY-MM-DD". */
export const dayText = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Adds whole days to a date text. */
export const addDays = (text, n) => dayText(dayNumber(text) + n);

const dayOfWeek = (n) => (((n + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday; 0 is Sunday
const daysFromCivil = (year, month, day) => Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);

/** Easter Sunday for a year (the anonymous Gregorian algorithm). WHY: Mother's Day, Pancake Day and the bank holidays hang off it. */
export function easterDay(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return daysFromCivil(year, month, day);
}

/** The day a "fixed" rule points at in a given year: a month and day, an offset from Easter, or the nth weekday of a month. */
function anchorDay(fixed, year) {
  if (fixed.easter_offset !== undefined) return easterDay(year) + fixed.easter_offset;
  if (fixed.weekday !== undefined) return nthWeekday(year, fixed.month, fixed.weekday, fixed.n);
  return daysFromCivil(year, fixed.month, fixed.day);
}

/** The nth (1 to 4) or last (n = -1) given weekday of a month. 0 is Sunday. */
function nthWeekday(year, month, weekday, n) {
  if (n > 0) {
    const first = daysFromCivil(year, month, 1);
    return first + ((weekday - dayOfWeek(first) + 7) % 7) + (n - 1) * 7;
  }
  const last = daysFromCivil(year, month + 1, 1) - 1;
  return last - ((dayOfWeek(last) - weekday + 7) % 7);
}

// ---------------------------------------------------------------- effects

/** Neutral modifiers: nothing changes. */
export function neutralModifiers() {
  return {
    demand: { all: 1, products: {}, categories: {} },
    visits: 1,
    contact_rate: 1,
    carrier_delay_days: 0,
    supplier_late_chance: 1,
    costs: { carrier: 1, goods: 1, card_fee: 1 },
  };
}

const scaleMultiplier = (m, w) => 1 + (m - 1) * w;
const round3 = (x) => Math.round(x * 1000) / 1000;

/** Applies a strength w (0 to about 1.2) to a set of effects: multipliers move toward or away from 1, delay days scale. */
export function scaleEffects(effects, w) {
  const out = {};
  const demand = effects.demand;
  if (demand) {
    out.demand = {};
    if (demand.all !== undefined) out.demand.all = round3(scaleMultiplier(demand.all, w));
    for (const group of ["products", "categories"]) {
      if (!demand[group]) continue;
      out.demand[group] = {};
      for (const [k, m] of Object.entries(demand[group])) out.demand[group][k] = round3(scaleMultiplier(m, w));
    }
  }
  for (const k of ["visits", "contact_rate", "supplier_late_chance"]) {
    if (effects[k] !== undefined) out[k] = round3(scaleMultiplier(effects[k], w));
  }
  if (effects.carrier_delay_days !== undefined) out.carrier_delay_days = round3(effects.carrier_delay_days * w);
  if (effects.costs) {
    out.costs = {};
    for (const [k, m] of Object.entries(effects.costs)) out.costs[k] = round3(scaleMultiplier(m, w));
  }
  return out;
}

/** Folds one set of effects, at strength w, into running modifiers (multiply the multipliers, add the days). */
function foldEffects(mod, effects, w) {
  const scaled = scaleEffects(effects, w);
  const d = scaled.demand || {};
  if (d.all !== undefined) mod.demand.all *= d.all;
  for (const group of ["products", "categories"]) {
    for (const [k, m] of Object.entries(d[group] || {})) mod.demand[group][k] = (mod.demand[group][k] ?? 1) * m;
  }
  if (scaled.visits !== undefined) mod.visits *= scaled.visits;
  if (scaled.contact_rate !== undefined) mod.contact_rate *= scaled.contact_rate;
  if (scaled.supplier_late_chance !== undefined) mod.supplier_late_chance *= scaled.supplier_late_chance;
  if (scaled.carrier_delay_days !== undefined) mod.carrier_delay_days += scaled.carrier_delay_days;
  for (const [k, m] of Object.entries(scaled.costs || {})) mod.costs[k] *= m;
}

/** Rounds every number in a finished set of modifiers so the output is tidy and comparable. */
function tidy(mod) {
  mod.demand.all = round3(mod.demand.all);
  for (const group of ["products", "categories"]) {
    for (const k of Object.keys(mod.demand[group])) mod.demand[group][k] = round3(mod.demand[group][k]);
  }
  mod.visits = round3(mod.visits);
  mod.contact_rate = round3(mod.contact_rate);
  mod.supplier_late_chance = round3(mod.supplier_late_chance);
  mod.carrier_delay_days = round3(mod.carrier_delay_days);
  for (const k of COST_KEYS) mod.costs[k] = round3(mod.costs[k]);
  return mod;
}

/**
 * How strongly an event acts on a given day. WHY: real events build, peak and fade; they do not switch on and off.
 * "flat" is full strength all the way; "build" rises from a quarter to full; "fade" falls from full to a quarter;
 * "peak" rises to full in the middle and falls away again. A one-day event is always full strength.
 */
export function rampFactor(ramp, start, end, date) {
  const length = dayNumber(end) - dayNumber(start);
  if (length <= 0 || ramp === "flat" || !ramp) return 1;
  const p = (dayNumber(date) - dayNumber(start)) / length;
  if (ramp === "build") return 0.25 + 0.75 * p;
  if (ramp === "fade") return 1 - 0.75 * p;
  if (ramp === "peak") return 1 - 0.75 * Math.abs(2 * p - 1);
  return 1;
}

// ---------------------------------------------------------------- regions

/** The leading letters of a postcode, "EL3 7GE" to "EL". */
const postcodeArea = (postcode) => (String(postcode || "").match(/^[A-Za-z]+/) || [""])[0].toUpperCase();

/**
 * Does a place fall inside a region? A region is { towns: [...], areas: [...] }: town names and/or postcode areas.
 * An event with no region is everywhere.
 */
export function matchesRegion(region, { postcode, town } = {}) {
  if (!region) return true;
  const towns = (region.towns || []).map((t) => t.toLowerCase());
  const areas = (region.areas || []).map((a) => a.toUpperCase());
  if (town && towns.includes(String(town).toLowerCase())) return true;
  return Boolean(postcode) && areas.includes(postcodeArea(postcode));
}

/** Share of customers (0 to 1) living in a region. customers: records with addresses[].town and postcode. */
export function regionShare(region, customers) {
  if (!region || !customers || !customers.length) return null;
  let n = 0;
  for (const c of customers) {
    const a = (c.addresses || []).find((x) => x.default) || (c.addresses || [])[0] || {};
    if (matchesRegion(region, { town: a.town, postcode: a.postcode })) n++;
  }
  return Math.round((n / customers.length) * 10000) / 10000;
}

// ---------------------------------------------------------------- scheduling

/** Accepts the library file ({ events: [...] }) or a bare list. */
const templatesOf = (library) => (Array.isArray(library) ? library : library.events || []);

/**
 * Turns a template into an occurrence that starts on a date and lasts a number of days.
 * `jitter` stretches or shrinks the template's effects a little (1 means exactly as written).
 */
export function instantiate(tpl, start, lengthDays, jitter = 1) {
  const effects = jitter === 1 ? structuredClone(tpl.effects) : scaleEffects(tpl.effects, jitter);
  // WHY: delay days are whole days in a record people read; the fractional form is only for regional blending.
  if (effects.carrier_delay_days !== undefined) effects.carrier_delay_days = Math.max(1, Math.round(effects.carrier_delay_days));
  const occ = {
    template: tpl.id,
    family: tpl.family,
    title: tpl.title,
    headline: tpl.headline,
    story: tpl.story,
    section: tpl.section || "Local",
    start,
    end: addDays(start, Math.max(1, lengthDays) - 1),
    status: "scheduled",
    origin: "seeded",
    ramp: tpl.ramp || "flat",
    effects,
    tags: tpl.tags ? [...tpl.tags] : [],
  };
  if (tpl.region) {
    occ.region = structuredClone(tpl.region);
    occ.region_share = tpl.region_share ?? null;
    // WHY: people far from the place read about it in the news; `reach` (0 to 1) is how strongly demand moves there.
    if (tpl.reach > 0) occ.reach = tpl.reach;
  }
  if (tpl.group) occ.group = tpl.group;
  return occ;
}

/** Fixed-date events: one occurrence a year, on the rule's date. */
function drawFixed(tpl, year) {
  const f = tpl.fixed;
  const start = dayText(anchorDay(f, year) + (f.offset_days || 0));
  return [instantiate(tpl, start, f.length_days || 1)];
}

/** Candidate start days: every day of the allowed months in a year. */
function candidateDays(months, year) {
  const days = [];
  for (const m of months) {
    const first = daysFromCivil(year, m, 1);
    const next = daysFromCivil(year, m + 1, 1);
    for (let d = first; d < next; d++) days.push(d);
  }
  return days;
}

const overlaps = (a, b, gap = 0) => dayNumber(a.start) <= dayNumber(b.end) + gap && dayNumber(b.start) <= dayNumber(a.end) + gap;

/**
 * Random events for one template and one year. The count comes from rate_per_year (4.5 means four, or five half the time).
 * All draws come from the stream for (seed, template id, year), so nothing else in the library affects them.
 */
function drawRandom(tpl, seed, year) {
  const rng = rngFor(seed, "event", tpl.id, year);
  const whole = Math.floor(tpl.rate_per_year);
  const count = whole + (rng.chance(tpl.rate_per_year - whole) ? 1 : 0);
  const days = candidateDays(tpl.months, year);
  const [lo, hi] = tpl.duration_days;
  const made = [];
  for (let i = 0; i < count; i++) {
    // Up to six tries to find a slot that does not run into this template's own earlier draw. The draws are always taken, so the stream is stable.
    for (let attempt = 0; attempt < 6; attempt++) {
      const start = dayText(rng.pick(days));
      const length = rng.int(lo, hi);
      const jitter = round3(rng.between(0.8, 1.2));
      const occ = instantiate(tpl, start, length, jitter);
      if (made.some((m) => overlaps(m, occ, 7))) continue;
      made.push(occ);
      break;
    }
  }
  return made;
}

/** Of any group of events that must not overlap (two postal strikes), keeps the ones that win a seeded draw. */
function resolveGroups(occurrences, seed) {
  const byGroup = new Map();
  for (const o of occurrences) {
    if (!o.group) continue;
    if (!byGroup.has(o.group)) byGroup.set(o.group, []);
    byGroup.get(o.group).push(o);
  }
  const dropped = new Set();
  for (const list of byGroup.values()) {
    // WHY: the winner is decided by a hash of the event itself, not by list order, so the outcome does not depend on what else is in the library.
    const ranked = list.slice().sort((a, b) => hashString(`${seed}|${a.template}|${a.start}`) - hashString(`${seed}|${b.template}|${b.start}`));
    const kept = [];
    for (const o of ranked) {
      if (kept.some((k) => overlaps(k, o))) dropped.add(o);
      else kept.push(o);
    }
  }
  return occurrences.filter((o) => !dropped.has(o));
}

/**
 * Does an occurrence depend on a product that is not on sale yet on its start day? It does if its title, headline or
 * story names the product, or if every product its demand effects name is still to launch (the event exists only
 * for them). A broad event (Valentine's Day) that also names a later product still happens.
 * @param {object} occ
 * @param {Array<{id: string, name: string, launched: string}>} products
 */
export function needsUnlaunchedProduct(occ, products) {
  const later = products.filter((p) => p.launched && p.launched > occ.start);
  if (!later.length) return false;
  const text = `${occ.title} ${occ.headline} ${occ.story}`.toLowerCase();
  if (later.some((p) => p.name && text.includes(p.name.replace(/^the /i, "").toLowerCase()))) return true;
  const named = Object.keys(occ.effects.demand?.products || {});
  return named.length > 0 && named.every((id) => later.some((p) => p.id === id));
}

/**
 * Which events happen between two dates (inclusive), for a seed. Same inputs, same answer.
 * With `products` ({ id, name, launched }), events about a product are left out before that product launches.
 * Returns occurrences sorted by start date, each with a `key` ("template@start") that is stable for that event.
 */
export function scheduleEvents(library, { seed, from, to, products = [] }) {
  const first = Number(from.slice(0, 4)) - 1;
  const last = Number(to.slice(0, 4));
  let all = [];
  for (const tpl of templatesOf(library)) {
    for (let year = first; year <= last; year++) {
      all = all.concat(tpl.fixed ? drawFixed(tpl, year) : drawRandom(tpl, seed, year));
    }
  }
  all = resolveGroups(all, seed);
  const window = { start: from, end: to };
  const inWindow = all.filter((o) => overlaps(o, window) && !needsUnlaunchedProduct(o, products));
  for (const o of inWindow) o.key = `${o.template}@${o.start}`;
  return inWindow.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.template < b.template ? -1 : 1));
}

// ---------------------------------------------------------------- what is happening on a day

/**
 * The status an occurrence has on a date. "cancelled" is permanent. Otherwise: scheduled before it starts,
 * active from the start date, over once the end date has passed (end of day, so pass the day being finished).
 */
export function statusOn(occ, date, { endOfDay = false } = {}) {
  if (occ.status === "cancelled") return "cancelled";
  if (date < occ.start) return "scheduled";
  if (endOfDay ? date >= occ.end : date > occ.end) return "over";
  return "active";
}

/**
 * The combined modifiers for one day: every event active that day, with its ramp applied, multiplied together.
 * With a place ({ postcode, town }) a regional event acts in full there and not at all elsewhere.
 * With no place it acts on the whole business in proportion to the share of customers in its region
 * (region_share, or `defaultRegionShare` when unknown). Delay days then become fractional: read them as an average.
 */
export function activeEffects(occurrences, date, { postcode, town, defaultRegionShare = 0.05 } = {}) {
  const mod = neutralModifiers();
  const located = Boolean(postcode || town);
  for (const occ of occurrences || []) {
    if (occ.status === "cancelled" || date < occ.start || date > occ.end) continue;
    let weight = rampFactor(occ.ramp, occ.start, occ.end, date);
    if (occ.region) {
      const inside = located && matchesRegion(occ.region, { postcode, town });
      const share = occ.region_share ?? defaultRegionShare;
      // Outside the region (or for the whole business), an event with a reach moves demand a little everywhere.
      if (occ.reach > 0 && occ.effects.demand && !inside) foldEffects(mod, { demand: occ.effects.demand }, weight * occ.reach * (located ? 1 : 1 - share));
      if (located) weight *= inside ? 1 : 0;
      else weight *= share;
    }
    if (weight > 0) foldEffects(mod, occ.effects, weight);
  }
  return tidy(mod);
}

/** News items published on a date: one per event that starts that day (and has not been cancelled). */
export function newsFor(occurrences, date) {
  return (occurrences || [])
    .filter((o) => o.start === date && o.status !== "cancelled")
    .map((o) => ({ at: `${date}T07:00:00Z`, headline: o.headline, story: o.story, section: o.section, event: o.id || o.key }));
}

// ---------------------------------------------------------------- plain words and checks

const humanise = (id) => id.replace(/-/g, " ");
const percent = (m) => (m >= 1 ? `up ${Math.round((m - 1) * 100)}%` : `down ${Math.round((1 - m) * 100)}%`);

/** What a set of effects means, in short plain sentences a person can read. */
export function describeEffects(effects) {
  const lines = [];
  const d = effects.demand || {};
  if (d.all !== undefined) lines.push(`Overall demand ${percent(d.all)}`);
  for (const [k, m] of Object.entries(d.products || {})) lines.push(`Demand for ${humanise(k)} ${percent(m)}`);
  for (const [k, m] of Object.entries(d.categories || {})) lines.push(`Demand for ${humanise(k)} goods ${percent(m)}`);
  if (effects.visits !== undefined) lines.push(`Website visits ${percent(effects.visits)}`);
  if (effects.contact_rate !== undefined) lines.push(`Customer contacts ${percent(effects.contact_rate)}`);
  if (effects.carrier_delay_days) lines.push(`Parcels about ${effects.carrier_delay_days} day${effects.carrier_delay_days === 1 ? "" : "s"} late`);
  if (effects.supplier_late_chance !== undefined) lines.push(`Chance a supplier is late ${percent(effects.supplier_late_chance)}`);
  const c = effects.costs || {};
  if (c.carrier !== undefined) lines.push(`Delivery cost ${percent(c.carrier)}`);
  if (c.goods !== undefined) lines.push(`Cost of goods ${percent(c.goods)}`);
  if (c.card_fee !== undefined) lines.push(`Card fees ${percent(c.card_fee)}`);
  return lines;
}

const isMultiplier = (x) => typeof x === "number" && x >= MULTIPLIER_RANGE[0] && x <= MULTIPLIER_RANGE[1];

/**
 * Checks an effects object against the plug-in contract. Returns an error message, or null if it is fine.
 * `known` lists real product ids and categories so a made-up product is refused.
 */
export function checkEffects(effects, { productIds = [], categories = [] } = {}) {
  if (!effects || typeof effects !== "object" || Array.isArray(effects)) return "effects must be an object.";
  const allowed = ["demand", "visits", "contact_rate", "carrier_delay_days", "supplier_late_chance", "costs"];
  for (const k of Object.keys(effects)) if (!allowed.includes(k)) return `Unknown effect "${k}". Use: ${allowed.join(", ")}.`;
  if (!Object.keys(effects).length) return "An event needs at least one effect.";
  const range = `${MULTIPLIER_RANGE[0]} to ${MULTIPLIER_RANGE[1]}`;
  const d = effects.demand;
  if (d !== undefined) {
    if (d.all !== undefined && !isMultiplier(d.all)) return `demand.all must be a multiplier from ${range}.`;
    for (const [group, known] of [["products", productIds], ["categories", categories]]) {
      for (const [k, m] of Object.entries(d[group] || {})) {
        if (!known.includes(k)) return `demand.${group}.${k} is not a known ${group === "products" ? "product" : "category"}.`;
        if (!isMultiplier(m)) return `demand.${group}.${k} must be a multiplier from ${range}.`;
      }
    }
  }
  for (const k of ["visits", "contact_rate", "supplier_late_chance"]) {
    if (effects[k] !== undefined && !isMultiplier(effects[k])) return `${k} must be a multiplier from ${range}.`;
  }
  const delay = effects.carrier_delay_days;
  if (delay !== undefined && !(typeof delay === "number" && delay >= 0 && delay <= MAX_DELAY_DAYS)) return `carrier_delay_days must be from 0 to ${MAX_DELAY_DAYS}.`;
  for (const [k, m] of Object.entries(effects.costs || {})) {
    if (!COST_KEYS.includes(k)) return `Unknown cost "${k}". Use: ${COST_KEYS.join(", ")}.`;
    if (!isMultiplier(m)) return `costs.${k} must be a multiplier from ${range}.`;
  }
  return null;
}
