// The rich customer model: who buys again, who quietly stops, and how each customer writes. Rules only, no AI.
// Used by simulation/simulator/core.mjs when customerModel is "rich" (live sandboxes; `--rich-customers` in pnpm sim).
//
// - Repeat buying follows the BG/NBD idea (Fader, Hardie and Lee 2005): each customer has their own buying rate
//   (gamma across people, mean 1 times their kind's weight) and, after each purchase, a chance of dropping out for good
//   (beta across people). New customers arrive at the rate that replaced natural dropouts at the start, scaled by
//   marketing and reputation. The day's total demand follows the customers who are still buying.
// - Hidden traits (never shown through the engine's tools): price sensitivity, patience, whether they complain in
//   public, how likely they are to leave.
// - A manner for messages: tone, vagueness, whether they give their order number; only visible in their words.
// - A one-line memory of how they were treated, brought up in their next message.
// Every draw comes from the population seed keyed by the customer's email, so both twins get the same customers.
// Parameters: business/data/sim.json "customer_model" (assumptions). Browser-safe.
import { rngFor } from "../../business/builder/world/rng.mjs";
import { traitsFor, behaviourFrom, personKey } from "../world/population.mjs";

/**
 * Word of mouth. Only a notable experience (at least WOM_MIN_POINTS of memory, good or bad) is passed on; each tie
 * hears it with WOM_HEAR_CHANCE and takes a share of it by how close they are. Shares are assumptions, kept small:
 * a friend's bad story makes you a little less likely to buy, it does not stop you.
 */
const WOM_MIN_POINTS = 0.5;
const WOM_HEAR_CHANCE = 0.5;
const WOM_SHARE = { household: 0.35, friend: 0.25, neighbour: 0.15 };

/**
 * Sets up the rich model over a population (adding traits to anyone without them).
 * @param {object} o { pop, cfg: sim.customer_model, kindWeight, popSeed, lambda0, saved? }
 * @return {object} { draw, accepts, afterPurchase, add, buyingPower, summary, save, acqBase, acquired }
 */
export function makeRich({ pop, cfg, kindWeight, popSeed, lambda0, saved = null }) {
  let acquired = saved?.acquired ?? 0;
  let prefix = new Float64Array(0), total = 0, hazardCfg = null;
  const byKey = new Map(); // personKey(name) -> customer, for word of mouth (rebuilt when the population grows)
  let keyedFor = -1;
  for (const c of pop) if (!c.t) assign(c);
  let wRef = saved?.wRef ?? null, acqBase = saved?.acqBase ?? null;
  if (wRef === null) {
    // At the start nobody has been treated well or badly yet: the reference is plain buying power.
    let w = 0, wp = 0;
    for (const c of pop) { const e = c.w * c.rate; w += e; wp += e * c.p; }
    wRef = w;
    acqBase = w ? lambda0 * (wp / w) : 0; // dropouts a day at the start: orders a day times the average dropout chance
  }

  const self = {
    get acqBase() { return acqBase; },
    get acquired() { return acquired; },
    /** Today's buying power against the start (rebuilds the draw table). */
    buyingPower(cust) {
      hazardCfg = cust || hazardCfg;
      prefix = new Float64Array(pop.length);
      total = 0;
      for (let i = 0; i < pop.length; i++) { total += effective(pop[i]); prefix[i] = total; }
      return wRef ? total / wRef : 1;
    },
    /** One customer, chosen by their own buying weight with one random number (so both twins choose alike). */
    draw(r, cust) {
      hazardCfg = cust;
      if (prefix.length !== pop.length) self.buyingPower(cust);
      if (!total) return null;
      const u = r.next() * total;
      let lo = 0, hi = prefix.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (prefix[mid] > u) hi = mid; else lo = mid + 1; }
      return pop[lo];
    },
    /** Whether this customer still buys at today's prices (their own price sensitivity, hidden). */
    accepts(c, priceIndex, elasticity, u) {
      if (!c.t || priceIndex === 1) return true;
      return u < Math.min(1, Math.pow(priceIndex, -elasticity * (c.t.price - 1)));
    },
    /** After a purchase the customer may stop buying for good (their own dropout chance). */
    afterPurchase(c, u) { if (c.p !== undefined && u < c.p) c.alive = false; },
    /** A new customer joins. */
    add(c) { assign(c); acquired++; },
    summary() {
      let alive = 0, dropped = 0;
      for (const c of pop) if (c.t) { if (c.alive) alive++; else dropped++; }
      return { population: pop.length, still_buying: alive, dropped_out: dropped, new_customers: acquired };
    },
    save: () => ({ acquired, wRef, acqBase }),
    /**
     * Passes a customer's experience to the people they know (business/data/population.json ties), who are customers too.
     * Each draw is keyed by the customer, the date and the tie, so both twins hear the same stories.
     * @param {object} c The customer whose memory just changed.
     * @param {number} points The change (sim.json customers' memory points).
     * @param {string} date
     * @return {number} How many people heard.
     */
    spread(c, points, date) {
      const population = cfg.population;
      if (!population || Math.abs(points) < WOM_MIN_POINTS) return 0;
      const ties = population.people[personKey(c.name)]?.ties || [];
      if (!ties.length) return 0;
      if (keyedFor !== pop.length) { keyedFor = pop.length; byKey.clear(); for (const x of pop) if (!byKey.has(personKey(x.name))) byKey.set(personKey(x.name), x); }
      let heard = 0;
      for (const [key, kind] of ties) {
        const t = byKey.get(key);
        if (!t || t === c) continue;
        if (rngFor(popSeed, "word-of-mouth", c.email, date, key).next() >= WOM_HEAR_CHANCE) continue;
        t.s = Math.max(-3, Math.min(3, t.s + points * (WOM_SHARE[kind] ?? 0.15)));
        heard++;
      }
      return heard;
    },
  };
  return self;

  function effective(c) {
    if (!c.alive || !c.w) return 0;
    const h = hazardCfg;
    if (!h) return c.w * c.rate;
    return c.s <= h.churn_at ? 0 : c.w * c.rate * Math.exp(h.memory_hazard_per_point * c.s);
  }

  /** Draws a customer's buying rate, dropout chance, traits and manner once, from the population seed. */
  function assign(c) {
    const r = rngFor(popSeed, "customer", c.email);
    const k = cfg.kinds[c.kind] || cfg.kinds.regular;
    const T = cfg.traits, M = cfg.manner;
    c.rate = gamma(r, k.heterogeneity) / k.heterogeneity;
    const leave = logNormal(r, T.leave_sd);
    const ga = gamma(r, k.dropout_a), gb = gamma(r, k.dropout_b);
    c.p = Math.min(0.95, (ga / (ga + gb)) * leave);
    c.alive = true;
    c.t = { price: round3(logNormal(r, T.price_sensitivity_sd)), patience: round3(logNormal(r, T.patience_sd)), public: r.next() < T.public_complainer_share, leave: round3(leave) };
    c.m = { vague: r.next() < M.vague_share, omits: r.next() < M.omits_order_number_share, tone: r.weighted(Object.entries(M.tone)) };
    c.memo = c.memo ?? null;
    // Real-world circumstances (simulation/world/population.mjs), only when business/data/population.json was loaded. No random numbers
    // are drawn here, so everything above is identical with or without the file.
    if (cfg.population) applyCircumstances(c, behaviourFrom(traitsFor(c, cfg.population)));
  }
  // kindWeight is part of c.w already; kept in the signature so callers state where weights come from.
  void kindWeight;
}

/** Scales the hidden traits by the circumstance multipliers and records channel, contact hours and category demand. */
function applyCircumstances(c, b) {
  c.t.price = round3(c.t.price * b.price);
  c.t.patience = round3(c.t.patience * b.patience);
  c.rate *= b.rate;
  c.channel = b.channel;
  c.contact_window = b.contact_window;
  c.cats = b.categories;
}

/**
 * A customer's message in their own manner: tone, vagueness, whether the order number is there, and what they
 * remember from last time. Only the words change; the topic and the facts underneath are the rules'.
 * @param {string} topic
 * @param {object} c The customer (with m and memo).
 * @param {?object} rec The order record the contact is about.
 * @param {string} prod The product's name.
 * @param {object} x Extra facts (for example { wants: "cancel" }).
 * @param {function} textFor The plain message maker in simulation/simulator/core.mjs.
 * @return {string}
 */
export function richText(topic, c, rec, prod, x, textFor) {
  const blank = textFor(topic, { name: "" }, null, c.m.vague ? "thing I ordered" : prod, x);
  const body = blank.replace(/^Hello, this is \.\s*/, "");
  const hello = { polite: `Hello, this is ${c.name}.`, plain: `Hi, ${c.name} here.`, blunt: `${c.name}.` }[c.m.tone] || `Hello, this is ${c.name}.`;
  let order = "";
  if (rec) order = c.m.omits ? " I ordered it a little while ago." : ` My order is ${rec.o.number} and my postcode is ${rec.o.delivery.address.postcode}.`;
  let memory = "";
  if (c.memo && rec && c.memo.order === rec.o.number) memory = " This is the second time I have written about this.";
  else if (c.memo?.bad) memory = ` Last time ${c.memo.text}.`;
  const close = { polite: " Thank you.", blunt: " Please sort it out.", plain: "" }[c.m.tone] || "";
  return `${hello}${memory} ${body}${order}${close}`;
}

/**
 * One line a customer remembers about a contact: bad experiences are brought up next time.
 * @return {{order: ?string, bad: boolean, text: string}}
 */
export function memoLine(it, outcome, frtMinutes) {
  const good = outcome === "resolved" || outcome === "resolved_by_staff";
  const slow = frtMinutes > 24 * 60;
  const text = outcome === "abandoned" ? "nobody answered me" : !good ? "my problem was not sorted out" : slow ? `it took you ${Math.round(frtMinutes / 1440)} days to answer` : "you sorted it out";
  return { order: it.order || null, bad: !good || slow, text };
}

/** Gamma(shape, 1) from uniform numbers (Marsaglia and Tsang; shapes below 1 boosted). */
function gamma(r, shape) {
  if (shape < 1) return gamma(r, shape + 1) * Math.pow(Math.max(1e-12, r.next()), 1 / shape);
  const d = shape - 1 / 3, cc = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < 100; i++) {
    let x, v;
    do { x = normal(r); v = 1 + cc * x; } while (v <= 0);
    v = v * v * v;
    const u = r.next();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(Math.max(1e-300, u)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return shape;
}
function normal(r) { return Math.sqrt(-2 * Math.log(Math.max(1e-12, r.next()))) * Math.cos(2 * Math.PI * r.next()); }
function logNormal(r, sd) { return Math.exp(sd * normal(r) - (sd * sd) / 2); }
function round3(x) { return Math.round(x * 1000) / 1000; }
