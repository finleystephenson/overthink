// The steppable simulator: one business, moved on one simulated day at a time.
// Rules-based and seeded: the same world, seed and actions give the same days. See simulation/simulator/README.md for the model.
//
// The caller owns the world (an engine world from infrastructure/engine/all.js) and decides when time moves:
//   const sim = createSim({ world, biz, seed });
//   const line = await sim.step();     // one day; returns that day's timeline line
//   sim.totals();                      // running totals so far
//   const snap = sim.snapshot();       // JSON-safe; with the world's state it restores the run exactly (restoreSim)
//
// WHY no Node APIs here (no fs, no child_process, no node: imports): the same file must run in a browser later.
// File writing (timelines) and the tool process client belong to the callers (simulation/simulator/run.mjs, simulation/simulator/live.mjs, infrastructure/server/).
import { rngFor } from "../../business/builder/world/rng.mjs";
import { applyPass, RELATION_COUNT } from "../../business/builder/world/characters.mjs";
import { effectiveStaff } from "../../infrastructure/engine/levers.js";
import { DAY, dateOf, addDays, weekdayOf, WD, round2, makeStreams, poissonFromUniform, topK, orderMinute } from "./lib.mjs";
import { makeTeam, beginDay, pick, commit, addLoad, payFor, freeMinutes, capacityMinutes } from "./staff.mjs";
import { judgeContact, csatFor, outreachQuality } from "./judge.mjs";
import { makeRich, richText, memoLine } from "./customers.mjs";
import { judgeOutsideReply } from "./replies.mjs";
import { liveCampaigns, discountLift, recordDay, bookDiscount } from "./campaigns.mjs";
import { webRow, audienceVisits } from "./web.mjs";
import { workTasks, recordLoad, writeReview } from "./team-work.mjs";
import { topUpBasket, TOP_UP_MIN_STOCK, TOP_UP_COVER_DAYS } from "./top-up.mjs";
import { supplierMailWaiting, supplierMailMessage } from "../world/supplier-side.mjs";

/** Read-only catalogue tools: what answering a product question takes (see simulation/simulator/judge.mjs READ_INFO). */
const CATALOGUE_READS = new Set(["search_catalogue", "get_product", "compare_products", "check_compatibility", "check_stock", "search_knowledge", "get_policy", "delivery_options"]);
const HIST = 2000; // histogram bins for first-response minutes: 1-minute bins to 120, then 10-minute bins
const binOf = (m) => (m <= 120 ? Math.round(m) : Math.min(HIST - 1, 120 + Math.floor((m - 120) / 10)));
const binMid = (b) => (b <= 120 ? b : 120 + (b - 120) * 10 + 5);
const EXCLUDED = ["BT", "IM", "JE", "GY", "HS", "ZE", "KW", "IV", "HI"];
// The engine's own late note reads "Delivered after the estimated date..."; history and the simulator both use it.
const LATE_WORDS = /late|delay|after the estimated date/i;
const CARRIER_LATE_NOTE = "Delivered late (carrier delay)";
const SNAPSHOT_VERSION = 1;
/** Memory points a customer gains when a task about them or their case is finished (someone followed up). Assumption. */
const TASK_FOLLOW_UP_POINTS = 0.2;
/** Without compaction (a live business keeps its records) only the engine's audit log is trimmed: it is not a business record. */
const AUDIT_KEEP_LIVE = 5000;
/** The working day used for response times: 09:00 to 17:30 (business/data/world company working_hours). */
const OPEN_MIN = 9 * 60, CLOSE_MIN = 17 * 60 + 30;

const SHOP = "Overthought & Co.";
const HELLO = "hello@overthought.example";
const SUBJECTS = {
  where_is_my_order: "Where is my order?", late_parcel: "My parcel is late", damaged: "Arrived damaged", missing: "Something missing from my parcel",
  fault: "It has stopped working", return_question: "Returning an item", change_order: "Changing my order", refund_chase: "Where is my refund?",
  complaint: "A complaint", product_question: "A question about a product", presale: "Before I buy",
};
const REPLIES = {
  where_is_my_order: "Thank you for waiting. I have checked your order: it is with the carrier and should reach you on the date in your dispatch email.",
  late_parcel: "I am sorry your parcel is late. I have asked the carrier to chase it and will write again as soon as I hear.",
  damaged: "I am sorry it arrived damaged. I have arranged a replacement; you do not need to send the broken one back.",
  missing: "I am sorry something was missing. I have sent the missing item today.",
  fault: "I am sorry it has stopped working. I have arranged a replacement under the guarantee.",
  return_question: "Of course. I have set up the return; the label is attached to this email.",
  change_order: "Done. I have changed your order as you asked.",
  refund_chase: "Your refund has been sent. Banks usually take three to five working days to show it.",
  complaint: "I am sorry. I have opened a case so we can put this right, and I will write again within two working days.",
  product_question: "Thank you for asking. The details are on the product page, and I am happy to answer anything else.",
  presale: "Standard delivery is £2.90 and takes three working days; next-day is £5.10.",
};

/** The newest record in a list that passes a test, scanning from the end (records are appended in time order). */
function findBack(list, test) {
  for (let i = (list || []).length - 1; i >= 0; i--) if (test(list[i])) return list[i];
  return null;
}

/** Next id in a list ("CT-00042"), carrying on from the highest id already there, whoever wrote it. Cached per list. */
const ID_CACHE = new WeakMap();
/** Social channels a contact can arrive on: the network and the kind of record it is there. */
const SOCIAL_CHANNELS = { mutter_dm: ["mutter", "dm"], squint_dm: ["squint", "dm"], mutter_mention: ["mutter", "post"] };

function nextIdIn(list, prefix, width) {
  let c = ID_CACHE.get(list);
  if (!c || c.n > list.length) { c = { n: 0, max: 0 }; ID_CACHE.set(list, c); }
  for (; c.n < list.length; c.n++) { const m = /(\d+)$/.exec(list[c.n].id || ""); if (m) c.max = Math.max(c.max, Number(m[1])); }
  c.max++;
  return `${prefix}-${String(c.max).padStart(width, "0")}`;
}

/** Running totals of one run. Every figure is a sum, so a long run costs no more memory than a short one. */
export const newTotals = () => ({
  days: 0, orders: 0, units: 0, lost_sales: 0, lost_value: 0, new_customers: 0,
  revenue: 0, refunds: 0, cogs: 0, card_fees: 0, delivery_costs: 0, goodwill: 0, packaging: 0,
  staff_pay: 0, overtime_pay: 0, fixed_costs: 0, marketing: 0, outreach_cost: 0,
  contacts: 0, contacts_tool: 0, contacts_handed_over: 0, contacts_staff: 0, contacts_resolved: 0, contacts_abandoned: 0,
  csat_sum: 0, csat_n: 0, satisfied_n: 0, frt_n: 0, frt_sum: 0, complaints: 0, repeat_contacts: 0, wrong_actions: 0,
  reviews: 0, review_sum: 0, bad_reviews: 0,
  tool_calls: 0, tool_refused: 0, tool_failed: 0, rule_breaks: 0, tool_errors: 0, tool_items: 0,
  task_minutes: 0, task_cost: 0, overtime_minutes: 0, stockout_sku_days: 0,
  prospects_contacted: 0, prospects_replied: 0, prospects_won: 0, prospect_revenue: 0, outreach_sent: 0, outreach_by_tool: 0,
  pos_raised: 0, pos_late: 0, late_parcels: 0,
  // Money in and out of the bank: the engine's cash ledger lines plus the costs the simulator charges (see moneyForDay).
  cash_flow: 0,
});

const subtract = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, typeof a[k] === "number" ? a[k] - (b[k] || 0) : a[k]]));

const slug = (n) => n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "")
  .replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");

/**
 * Thinned daily curve: at most ~4000 points however long the run, so memory stays bounded.
 * @param {?{stride: number, count: number, pts: object}} from A saved curve to carry on from.
 */
function makeCurve(from = null) {
  let stride = from ? from.stride : 1;
  let count = from ? from.count : 0;
  const pts = from ? structuredCopy(from.pts) : { day: [], gp: [], taskCost: [], revenue: [], net: [] };
  return {
    get pts() { return pts; },
    get stride() { return stride; },
    save: () => ({ stride, count, pts: structuredCopy(pts) }),
    add(day, row) {
      if (day % stride !== 0) return;
      for (const k of Object.keys(pts)) pts[k].push(row[k]);
      if (++count > 4000) {
        for (const k of Object.keys(pts)) pts[k] = pts[k].filter((_, i) => i % 2 === 0);
        stride *= 2;
        count = pts.day.length;
      }
    },
  };
}

/** A deep copy of plain data. JSON is enough: everything the simulator keeps is plain numbers, strings and lists. */
function structuredCopy(x) { return JSON.parse(JSON.stringify(x)); }

/** "Every Monday" and sandwich notes mark the business customers in the generated world. */
function kindOfNote(c) { return /every Monday|sandwiches/.test(c.notes || "") ? "business" : "regular"; }

/** Where an order is, from its parcels. `late` says a delivered order came after its promised date. */
function orderState(ord) {
  if (ord.status === "cancelled" || ord.status === "payment_failed") return { s: "none" };
  const sh = (ord.shipments || []).filter((x) => !["cancelled", "lost"].includes(x.status));
  if (sh.length && sh.every((x) => x.status === "delivered")) {
    const at = sh.reduce((m, x) => (x.delivered_at && x.delivered_at > m ? x.delivered_at : m), "").slice(0, 10);
    return { s: "delivered", at, late: sh.some((x) => x.note && LATE_WORDS.test(x.note)) };
  }
  if (sh.some((x) => x.status === "delayed")) return { s: "delayed" };
  if (sh.some((x) => x.status === "in_transit")) return { s: "in_transit" };
  return { s: "paid" };
}

/** What a customer writes for each kind of contact. */
function textFor(topic, c, rec, prod, x) {
  const o = rec ? ` My order is ${rec.o.number} and my postcode is ${rec.o.delivery.address.postcode}.` : "";
  const hi = `Hello, this is ${c.name}.`;
  const t = {
    where_is_my_order: "Where is my order? It has not arrived yet.",
    late_parcel: "My parcel is late. Can you chase it please?",
    damaged: `The ${prod} arrived damaged. I have a photo. Please send a replacement.`,
    missing: `The ${prod} was missing from my parcel.`,
    fault: `The ${prod} I bought has stopped working. Can I have a replacement?`,
    return_question: `I would like to return the ${prod}. I changed my mind.`,
    change_order: x.wants === "cancel" ? "Please cancel my order, I ordered it by mistake." : "Please change the delivery address on my order.",
    refund_chase: "Where is my refund? It has not arrived.",
    complaint: "I am unhappy with how my order was handled. This is a complaint.",
    product_question: `Can you tell me more about the ${prod}? Does it come in other sizes or colours?`,
    presale: `I am thinking of buying the ${prod}. How much is delivery?`,
  }[topic];
  return `${hi} ${t}${o}`;
}

function systemPromptFor(r) {
  return `You are the ${r} for Overthought & Co., a small online shop. Use the shop's tools through the web API. Follow its rules. Never promise what the records do not show.`;
}

/**
 * Multiplies the plug-ins' answers for one day into one set of modifiers (see docs/environment-design.md).
 * Multipliers multiply; carrier_delay_days adds. A key nobody mentions stays at 1 (or 0 days).
 * @param {Array<object>} answers What each plug-in's modifiers() returned (null or undefined are skipped).
 * @return {object} { demand: { all, products, categories }, visits, contact_rate, carrier_delay_days, supplier_late_chance, costs }
 */
export function combineModifiers(answers) {
  const m = { demand: { all: 1, products: {}, categories: {} }, visits: 1, contact_rate: 1, carrier_delay_days: 0, supplier_late_chance: 1, costs: { carrier: 1, goods: 1, card_fee: 1 }, price_sensitivity: 1, why: [] };
  const num = (x, fallback) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : fallback);
  for (const a of answers) {
    if (!a || typeof a !== "object") continue;
    const d = a.demand || {};
    m.demand.all *= num(d.all, 1);
    for (const [k, v] of Object.entries(d.products || {})) m.demand.products[k] = (m.demand.products[k] ?? 1) * num(v, 1);
    for (const [k, v] of Object.entries(d.categories || {})) m.demand.categories[k] = (m.demand.categories[k] ?? 1) * num(v, 1);
    m.visits *= num(a.visits, 1);
    m.contact_rate *= num(a.contact_rate, 1);
    m.carrier_delay_days += Math.round(num(a.carrier_delay_days, 0));
    m.supplier_late_chance *= num(a.supplier_late_chance, 1);
    for (const k of ["carrier", "goods", "card_fee"]) m.costs[k] *= num(a.costs?.[k], 1);
    // WHY: the wider world (simulation/world/plugins.mjs) says how strongly shoppers react to price, and why each change happened.
    m.price_sensitivity *= num(a.price_sensitivity, 1);
    if (Array.isArray(a.why)) m.why.push(...a.why);
  }
  return m;
}

/**
 * Creates a simulation over a world the caller owns. Reads the world's records at creation (customers, recent orders,
 * reviews, prospects) and tops stock up to the opening cover with recorded stock counts.
 *
 * @param {object} o
 * @param {object} o.world An engine world (made through infrastructure/engine/all.js). The sim changes it through engine tools.
 * @param {object} o.biz The business files: { sim, staff, costs, characters } (simulation/simulator/data.mjs loadBusiness).
 * @param {number} o.seed Run seed: every chance in a day comes from streams of this seed.
 * @param {number=} o.popSeed Seed for the customer population (default 1).
 * @param {?number=} o.scale Multiplies demand, staff hours and pay, and costs. Default: the world's own
 *     company.scale (where its history stopped), else 1.
 * @param {?number=} o.customers Size of the customer population (default about 40 days of orders).
 * @param {Array<object>=} o.plugins Plug-ins: { name, modifiers?(ctx), afterDay?(ctx) }.
 * @param {?object=} o.data What plug-ins receive as `data` (default: biz).
 * @param {?object=} o.toolClient A tool under test: { call(payload) -> Promise<{reply?, error?}> }. Null = staff only.
 * @param {?object=} o.tracer With a tool: { mark() -> number, callsSince(mark, sessionId) -> trace entries }.
 * @param {object=} o.toolEnv With a tool: { api_url, token } sent in every payload.
 * @param {string=} o.role The role the tool acts as (default "assistant").
 * @param {number=} o.warmup Days run but left out of the totals and the curve.
 * @param {boolean=} o.compact Trim old records every few days so long runs stay small (default true). False keeps every
 *     business record (a live sandbox the apps show) and trims only the engine's audit log.
 * @param {boolean=} o.openingStock Top stock up to the opening cover at creation (default: only when the world's
 *     history was not built at the size being run, i.e. no company.scale or a different scale).
 * @param {string=} o.customerModel "classic" (default: the batch model as it always was) or "rich": BG/NBD repeat
 *     buying, hidden traits, a manner and a memory per customer (simulation/simulator/customers.mjs).
 * @return {Sim}
 */
export function createSim(o) {
  return buildSim(o, null);
}

/**
 * Brings a saved simulation back onto a world whose state is the one saved with it.
 * @param {object} snap What sim.snapshot() returned.
 * @param {object} ctx { world, biz, plugins?, data?, toolClient?, tracer?, toolEnv? }: the things that are not data.
 * @return {Sim}
 */
export function restoreSim(snap, ctx) {
  if (!snap || snap.version !== SNAPSHOT_VERSION) throw new Error("Not a simulator snapshot this version can read.");
  return buildSim({ ...snap.opts, ...ctx }, snap);
}

/**
 * @typedef {object} Sim
 * @property {function(): Promise<object>} step Runs one simulated day; returns its timeline line.
 * @property {function(): object} totals Totals so far, in the shape runOnce returns.
 * @property {function(): object} snapshot JSON-safe state of the simulator (not the world).
 * @property {function(): object} running The raw running totals (not warm-up adjusted).
 * @property {function(): ?object} lastAdvance What the engine's advance_day said on the last day.
 * @property {function(): Array<Array>} openingStock [sku, target] pairs the opening stock was topped up to.
 * @property {function(): number} day Days run so far.
 * @property {number} scale The business size this sim runs at.
 * @property {object} world The world it runs on.
 */

/**
 * The business size to run at. An explicit option wins; otherwise the size the world's history ended at
 * (company.scale, written by the world generator), so day one continues from the last historical day; otherwise 1.
 * @param {?number|undefined} explicit
 * @param {object} world
 * @return {number}
 */
export function scaleFor(explicit, world) {
  if (typeof explicit === "number" && explicit > 0) return explicit;
  const fromWorld = world.state.company?.scale;
  return typeof fromWorld === "number" && fromWorld > 0 ? fromWorld : 1;
}

function buildSim(o, snap) {
  const { world, biz, seed, popSeed = 1, role = "assistant", customers: wantCustomers = null, plugins = [], toolClient = null,
    tracer = null, toolEnv = {}, warmup = 0, compact = true, customerModel = "classic", outreachJudge = null } = o;
  // WHY: the opening top-up exists for worlds whose history was not built at the simulator's size. A world that says
  // its own scale (company.scale) ends history where the simulator starts, so its stock is left as history left it.
  // Run at a different size from the world's own and its stock no longer fits, so it is topped up then too.
  const openingStock = o.openingStock ?? !(world.state.company?.scale > 0 && scaleFor(o.scale, world) === world.state.company.scale);
  const rich = customerModel === "rich";
  const A = biz.audience; // business/data/audience.json values (replies, catalogue changes); null for an older data folder
  const scale = scaleFor(o.scale, world);
  const data = o.data ?? biz;
  const { sim, staff: staffData, costs } = biz;
  const cfgD = sim.demand, cfgC = sim.contacts, cfgCust = sim.customers, cfgOps = sim.ops, cfgP = sim.prospects;
  const S = makeStreams(seed);
  const st = () => world.state; // read every time: a caller may swap the state object (loadState)
  world.lazySummary = true; // the simulator reads the ledger itself; monthly rows are made only when a tool asks for them
  if (snap && snap.dirty_from !== undefined) world.dirtyFrom = snap.dirty_from;
  const sess = {};
  const as = (r) => (sess[r] ||= world.session({ role: r }));
  const staffNames = new Set(staffData.staff.map((s) => s.name));

  // ---- catalogue and expected sales (fixed business data, so the same whether new or restored)
  const products0 = world.products.filter((p) => p.status === "active");
  const wsum0 = products0.reduce((n, p) => n + (cfgD.product_weights[p.id] || 0), 0);
  // The catalogue as the engine says it is today. Until a product is launched or ended these are exactly the
  // starting ones (cat is null), so an untouched run is unchanged; see syncCatalogue.
  let products = products0, wsum = wsum0, cat = null, catKey = "";
  const wOf = (p) => (cat ? cat.w.get(p.id) || 0 : cfgD.product_weights[p.id] || 0);
  const refPrice = (p) => p.variants[0].price;
  // Made-to-order products (chilled only: sandwiches, ice) are made each morning, as in history, never shelf stock.
  const madeToOrder = (e) => { const m = (e.item.delivery || e.product.delivery)?.methods || []; return m.length > 0 && m.every((x) => x === "chilled"); };
  const shelf = (sku) => world.index.skus[sku] && world.index.skus[sku].product.id !== "emergency-sandwich" && !madeToOrder(world.index.skus[sku]) && !world.index.skus[sku].product.discontinued;
  const lambda0 = cfgD.base_orders_per_day * scale;
  let expected = expectedSales();
  const MAXW = Math.max(...Object.values(cfgD.customer_kind_weight)) * Math.exp(cfgCust.memory_hazard_per_point * 3);

  // ---- the run's own state (everything here goes into a snapshot)
  let pop, byId, sold, soldWin, rep, rep0, live, pstate, events, outreachCursor, staffSent, backlog, itemSeq, ledgerCursor;
  let T, hist, curve, good, bad, snapT, snapHist, cumGP, cumTaskCost, cumNet, cumRev, curveDay, day, demandSeed0, delayed, lastAdv;
  let opening = []; // [sku, target] the opening stock was brought up to, so a twin world can be given the same
  let socialCursor = 0, emailCursor = 0; // records already looked at for outside replies to customers
  let cashLow = 0, openingCash = 0; // survival: the lowest the bank balance went
  let richState = null; // the rich customer model's own figures (simulation/simulator/customers.mjs)
  const moment = (d, text, value, kind) => { (value >= 0 ? good : bad).add({ day: d, text, value: round2(value), kind }); };
  let dayStat = {};
  let dayCamps = []; // tool-made campaigns running today (set in demand)
  let dayVisits = {}; // the visits those campaigns brought today, by channel
  let team = null, teamKey;
  let mods = combineModifiers([]);
  // The delivery rules as the world was made (see deliveryFactor).
  const deliveryPlan = { key: JSON.stringify(world.business.delivery?.methods || []), methods: structuredCopy(world.business.delivery?.methods || []), lastKey: null, elasticity: null, factor: 1 };

  if (snap) loadSnapshot(snap); else init();
  syncTeam();

  return {
    world,
    step,
    totals,
    snapshot,
    running: () => ({ ...T }),
    lastAdvance: () => lastAdv,
    openingStock: () => opening.map((x) => x.slice()),
    day: () => day,
    scale,
  };

  // ============================================================ start

  function init() {
    pop = buildPopulation();
    byId = new Map(pop.filter((c) => c.id).map((c) => [c.id, c]));
    sold = {}; soldWin = {};
    for (const sku of Object.keys(st().stock)) { sold[sku] = 0; soldWin[sku] = []; }
    // Opening stock is brought up to ops.opening_cover_days (35) days of this run's demand with recorded stock counts
    // (so the books stay true). Same for both runs.
    if (openingStock) topUpOpeningStock();
    // Reputation from the world's own reviews.
    const recent = st().reviews.slice(-150);
    rep = recent.length ? recent.reduce((n, r) => n + (r.rating - 1) / 4, 0) / recent.length : 0.8;
    rep0 = rep;
    // Live orders: the sim's own view of recent orders, bounded to 45 days.
    live = [];
    for (const ord of st().orders) {
      if (ord.status === "cancelled" || ord.status === "payment_failed") continue;
      if (Date.parse(ord.placed_at) < Date.parse(st().now) - 45 * DAY) continue;
      live.push({ o: ord, key: `${ord.customer_id}|${ord.placed_at.slice(0, 10)}|${ord.number}`, placed: dateOf(Date.parse(ord.placed_at)), exp: 0, reviewAt: null, prospect: null });
    }
    // Prospects: the engine holds them; the sim keeps what only the simulator knows.
    pstate = new Map(st().prospects.map((p) => [p.id, { outreachN: 0, k: 0, nextOrder: null, revenue: 0, won: false }]));
    events = []; // scheduled prospect events { day, pid, type }
    outreachCursor = st().outreach.length;
    staffSent = new Set();
    backlog = []; // contacts not yet served
    itemSeq = 0;
    ledgerCursor = st().ledger.length;
    T = newTotals();
    hist = new Int32Array(HIST);
    curve = makeCurve();
    good = topK(6, (m) => m.value); bad = topK(6, (m) => -m.value);
    snapT = null; snapHist = null;
    cumGP = 0; cumTaskCost = 0; cumNet = 0; cumRev = 0; curveDay = 0;
    day = 0;
    demandSeed0 = Date.parse(st().now);
    socialCursor = (st().social_posts || []).length; emailCursor = (st().emails || []).length;
    openingCash = st().company?.opening_cash ?? 0; cashLow = openingCash;
    if (rich) richState = makeRich({ pop, cfg: sim.customer_model, kindWeight: cfgD.customer_kind_weight, popSeed, lambda0 });
    delayed = []; // parcels held back by a carrier delay: [order number, shipment id]
    lastAdv = null;
  }

  /** The world's customers first, then characters from business/data/characters.json, then made-up names. */
  function buildPopulation() {
    const inWorld = st().customers.map((c) => ({ id: c.id, name: c.name, email: c.email, kind: kindOfNote(c), line1: c.addresses[0].line1, town: c.addresses[0].town, postcode: c.addresses[0].postcode, s: 0, orders: 0, engine: true }));
    const known = new Set(inWorld.map((c) => c.name));
    const extras = biz.characters.filter((c) => !known.has(c.name));
    shuffle(extras, rngFor(popSeed, "population-order"));
    const defaultN = Math.max(inWorld.length, Math.ceil(cfgD.base_orders_per_day * scale * 40));
    const N = wantCustomers || defaultN;
    const out = inWorld.slice();
    if (N < out.length) { shuffle(out, rngFor(popSeed, "population-subset")); out.length = N; }
    const taken = new Set(out.map((c) => c.name));
    for (let i = 0; out.length < N; i++) {
      const c = extras[i] ? fromCharacter(extras[i], i) : derivedCustomer(rngFor(popSeed, "population-name", i), taken, i) || madeUp(out.length);
      taken.add(c.name);
      out.push(c);
    }
    for (const c of out) c.w = excluded(c) ? 0 : (cfgD.customer_kind_weight[c.kind] ?? 1);
    return out;
  }
  function shuffle(list, r) { for (let i = list.length - 1; i > 0; i--) { const j = r.int(0, i); [list[i], list[j]] = [list[j], list[i]]; } }
  function fromCharacter(c, i) {
    return { id: null, name: c.name, email: `${slug(c.name)}.x${i}@example.com`, kind: c.kind, line1: c.address_line, town: c.town, postcode: c.postcode, s: 0, orders: 0, engine: false };
  }
  /**
   * A believable new name once every character is in use: a relation, a household member or a tradesman of one
   * ("Mr Toad's coachman", "A niece of Emma Woodhouse"), each pattern about equally often, never one already taken.
   */
  function derivedCustomer(r, taken, i) {
    if (!biz.characters.length) return null;
    for (let tries = 0; tries < 50; tries++) {
      const c = applyPass(biz.characters[r.int(0, biz.characters.length - 1)], 1 + r.int(0, RELATION_COUNT - 1));
      if (!taken.has(c.name) && !staffNames.has(c.base)) return fromCharacter(c, i);
    }
    return null;
  }
  /** Only when there are no characters at all (a business described without business/data/characters.json). */
  function madeUp(n) {
    return { id: null, name: `Customer ${n + 1}`, email: `customer.${n + 1}@example.com`, kind: ["gift", "regular", "regular", "returns_a_lot"][n % 4], line1: `${1 + (n % 90)} Market Street`, town: "Overthought", postcode: "ZZ1 1ZZ", s: 0, orders: 0, engine: false };
  }
  /** Staff never shop; nor do addresses the shop does not deliver to, or made-up postcodes. */
  function excluded(c) { return staffNames.has(c.name) || EXCLUDED.includes(c.postcode.match(/^[A-Z]+/)?.[0]) || c.postcode.startsWith("ZZ"); }

  function expectedSales() {
    const out = {};
    for (const p of products) {
      const share = wOf(p) / wsum, per = lambda0 * share * (1 + cfgD.second_product_chance);
      for (const v of p.variants) out[v.sku] = per / p.variants.length;
      for (const a of p.accessories || []) out[a.sku] = per * cfgD.accessory_chance / (p.accessories.length || 1);
    }
    return out;
  }

  function topUpOpeningStock() {
    for (const sku of Object.keys(st().stock)) {
      if (!shelf(sku) || !expected[sku]) continue;
      const target = Math.ceil(expected[sku] * cfgOps.opening_cover_days);
      opening.push([sku, target]);
      if (st().stock[sku].on_hand < target) as("warehouse").call("record_stock_count", { sku, counted_qty: target, note: "Opening stock for the simulation", adjust: true });
    }
  }

  /** The team follows world.state.settings.staff (set_staffing). Rebuilt only when that record changes. */
  function syncTeam() {
    const changes = st().settings?.staff || null;
    const key = changes ? JSON.stringify(changes) : "";
    if (team && key === teamKey) return;
    teamKey = key;
    team = makeTeam({ ...staffData, staff: effectiveStaff(staffData.staff, changes) }, costs, scale);
  }

  // ============================================================ one day

  /** Runs one simulated day and returns its timeline line. */
  async function step() {
    const today = dateOf(Date.parse(st().now)); // yesterday's date until the clock moves
    const problems = [];
    mods = combineModifiers(plugins.filter((p) => typeof p.modifiers === "function")
      .map((p) => guarded(p, "modifiers", { state: st(), date: addDays(today, 1), seed, data }, problems)));
    syncTeam();
    // 1. Supplier delays, drawn from a stream keyed by supplier and due date (the same in both runs), then the engine's own day.
    syncCatalogue(addDays(today, 1));
    outsideReplies();
    supplierDelays(today);
    const adv = as("manager").call("advance_day", {}).data;
    lastAdv = adv;
    const date = dateOf(Date.parse(st().now));
    const wd = weekdayOf(date);
    beginDay(team, staffData, wd);
    if (cfgCust.memory_recovery_per_day) recoverMemory();
    const evs = []; // short notes for the timeline
    dayStat = { orders: 0, contacts: 0, toolHandled: 0, handed: 0, abandoned: 0, csatSum: 0, csatN: 0, outreach: 0, won: 0, lost: 0 };
    carrierDelays(adv, date);
    T.late_parcels += adv.delayed.length;
    // The shipments dispatched today take packing time.
    addLoad(team, "warehouse", adv.dispatched.length * (staffData.staff.find((s) => s.role === "warehouse")?.tasks.pack_order || 4));

    // 2. Stock: low-stock work for the buyer or an operations tool.
    await doStock(day, date, wd, evs);
    // 3. Demand.
    const { ordersToday, marketing } = demand(date, wd);
    // 4. Prospects.
    await doProspects(day, date, wd, evs);
    // 5. Contacts: make today's, give the tool its share, let staff do the rest.
    const items = genContacts(day, date);
    dayStat.contacts = items.length;
    // Assigned tasks (infrastructure/engine/tasks.js) take real staff time: urgent ones before customers, the rest after.
    const taskTime = new Map();
    finishTasks(workTasks({ state: st(), team, now: st().now, urgent: true, usedToday: taskTime }));
    await doContacts(day, date, items, evs);
    finishTasks(workTasks({ state: st(), team, now: st().now, urgent: false, usedToday: taskTime }));
    // 6. Reviews, reputation, live-order housekeeping.
    doReviews(day, date);
    for (let i = live.length - 1; i >= 0; i--) if ((Date.parse(date) - Date.parse(live[i].placed)) / DAY > 45 && !live[i].reviewAt) live.splice(i, 1);
    // 7. Money for the day, from the engine's ledger plus the costs the business pays.
    const line = moneyForDay(date, ordersToday, marketing, evs);
    for (const p of plugins) if (typeof p.afterDay === "function") guarded(p, "afterDay", { state: st(), date, seed, data }, problems);
    writeWebRow(date);
    // WHY a note and not a crash: a broken plug-in should not stop the business; the day says what went wrong.
    if (problems.length) line.problems = problems;
    if (mods.why.length) line.why = mods.why;
    if (compact && (day + 1) % sim.memory.compact_every_days === 0) compactState(date);
    else if (!compact && st().audit.length > AUDIT_KEEP_LIVE) st().audit.splice(0, st().audit.length - AUDIT_KEEP_LIVE);
    day++;
    return line;
  }

  /**
   * Today's web_sessions_daily row, in history's shape, so visitor figures carry on past the last day of history
   * (simulation/simulator/web.mjs). Written once a day, after the audience has played out today's posts and mail.
   */
  function writeWebRow(date) {
    const s = st();
    const rows = (s.web_sessions_daily ||= []);
    if (rows.length && rows[rows.length - 1].date >= date) return;
    const soldBy = {};
    for (let k = s.orders.length - 1; k >= 0 && s.orders[k].placed_at.slice(0, 10) >= date; k--) {
      if (s.orders[k].placed_at.slice(0, 10) !== date) continue;
      for (const l of s.orders[k].items) { const id = world.index.skus[l.sku]?.product.id; if (id) soldBy[id] = (soldBy[id] || 0) + l.qty; }
    }
    const aud = audienceVisits(s, date);
    const named = { email: (dayVisits.email || 0) + aud.email, search: dayVisits.search || 0, social: (dayVisits.social || 0) + aud.social, referral: dayVisits.referral || 0 };
    rows.push(webRow({ date, seed, orders: dayStat.orders, lost: dayStat.lost, visitsFactor: mods.visits, named, productIds: world.products.map((p) => p.id), soldBy }));
  }

  // ---------------------------------------------------------------- catalogue changes (launch, end)

  /**
   * Follows the engine's product statuses (launch_product, discontinue_product). Nothing changes until one is set.
   * A launched product's weight: its category's typical weight, less if priced above the category, plus a novelty
   * boost that fades; part of its sales come from the rest of the range (cannibalisation). An ended product's demand
   * partly moves to the same category (switch_share); the rest is lost. Rates: business/data/audience.json "products".
   */
  function syncCatalogue(date) {
    const ps = st().product_status || {};
    const key = Object.keys(ps).length ? JSON.stringify(ps) : "";
    if (!key) { if (cat) { cat = null; products = products0; wsum = wsum0; expected = expectedSales(); } return; }
    if (key === catKey && !cat?.novel) return;
    catKey = key;
    const R = A?.products || { novelty_boost: 1.5, novelty_days: 30, cannibalisation: 0.3, switch_share: 0.4, price_elasticity_in_category: 1 };
    const statusOf = (p) => ps[p.id]?.status ?? p.status;
    const onSale = (p) => statusOf(p) === "active" && (ps[p.id]?.available_from ?? "") <= date;
    const known = world.products.filter((p) => cfgD.product_weights[p.id] > 0);
    const w = new Map();
    let total = 0, novel = false;
    for (const p of world.products.filter(onSale)) {
      let x = cfgD.product_weights[p.id] || 0;
      if (!x) {
        // A product the business files never priced: like its category, adjusted for price, new and fading.
        const peers = known.filter((q) => q.category === p.category);
        const pool = peers.length ? peers : known;
        const typical = pool.reduce((n, q) => n + cfgD.product_weights[q.id], 0) / pool.length;
        const prices = pool.map((q) => q.variants[0].price).sort((a, b) => a - b);
        const median = prices[Math.floor(prices.length / 2)];
        const age = Math.max(0, (Date.parse(date) - Date.parse(ps[p.id]?.available_from || date)) / DAY);
        x = typical * Math.pow(p.variants[0].price / median, -R.price_elasticity_in_category) * (1 + R.novelty_boost * Math.exp(-age / R.novelty_days));
        total += x * (1 - R.cannibalisation);
        novel = true;
      } else total += x;
      w.set(p.id, x);
    }
    // Ended products: part of their demand moves to what is left in the same category.
    for (const p of products0.filter((q) => !onSale(q))) {
      const lost = cfgD.product_weights[p.id] || 0;
      const peers = world.products.filter((q) => onSale(q) && q.category === p.category && w.get(q.id) > 0);
      const peerW = peers.reduce((n, q) => n + w.get(q.id), 0);
      if (!peerW) continue;
      for (const q of peers) w.set(q.id, w.get(q.id) + lost * R.switch_share * (w.get(q.id) / peerW));
      total += lost * R.switch_share;
    }
    cat = { w, factor: total / wsum0, novel };
    products = world.products.filter((p) => onSale(p) && w.get(p.id) > 0);
    wsum = products.reduce((n, p) => n + w.get(p.id), 0);
    expected = expectedSales();
    for (const p of world.products.filter((q) => !onSale(q))) for (const v of [...p.variants, ...(p.accessories || [])]) expected[v.sku] = 0;
    for (const sku of Object.keys(st().stock)) if (!(sku in sold)) { sold[sku] = 0; soldWin[sku] = []; }
  }

  // ---------------------------------------------------------------- outside replies to customers

  /**
   * Replies a person or an AI sent to a customer since the last day (public replies, private messages, email): a fast,
   * helpful one raises that customer's memory (they buy again sooner), a curt one lowers it a little, and a fast public
   * answer to a complaint lifts reputation. Judged by rules from the records (simulation/simulator/replies.mjs).
   */
  function outsideReplies() {
    const posts = st().social_posts || [], mails = st().emails || [];
    const found = [];
    for (; socialCursor < posts.length; socialCursor++) if (isTool(posts[socialCursor]) && ["reply", "dm"].includes(posts[socialCursor].kind)) found.push(["social", posts[socialCursor]]);
    for (; emailCursor < mails.length; emailCursor++) if (isTool(mails[emailCursor]) && mails[emailCursor].folder === "sent") found.push(["email", mails[emailCursor]]);
    // Public replies to reviews (infrastructure/engine/reviews.js), each judged once; `counted` marks it on the reply itself.
    for (const r of st().reviews || []) if (r.reply && !r.reply.counted) { r.reply.counted = true; found.push(["review", r]); }
    if (!found.length || !A?.replies) return;
    for (const [kind, rec] of found) {
      const v = judgeOutsideReply(kind, rec, st(), A);
      if (!v) continue;
      const c = byId.get(v.customer_id);
      if (!c) continue;
      c.s = Math.max(-3, Math.min(3, c.s + v.points));
      if (v.reputation) rep = Math.min(1, rep + v.reputation);
      T.csat_sum += v.csat; T.csat_n++; T.outside_replies = (T.outside_replies || 0) + 1;
      if (rich) c.memo = v.memo;
    }
  }
  function isTool(r) { return typeof r?.key === "string" && r.key.startsWith("tool|"); }

  // ---------------------------------------------------------------- rich customers

  /** New customers arrive to replace natural dropouts; more with more marketing and a better reputation. */
  function acquire(date, marketingFactor) {
    const pull = Math.pow(Math.max(0.1, marketingFactor) * Math.max(0.3, 1 + cfgD.reputation_weight * (rep - rep0)), sim.customer_model.acquisition_follows_marketing);
    const n = poissonFromUniform(richState.acqBase * pull, S("acquire", date).next());
    for (let i = 0; i < n; i++) {
      const k = richState.acquired;
      // WHY: a new customer is a character nobody in the shop's records is yet; stepping by a prime visits every one.
      const taken = new Set(pop.map((p) => p.name));
      let ch = null;
      for (let t = 0; t < biz.characters.length && !ch; t++) {
        const cand = biz.characters[((k + t) * 7919 + 17) % biz.characters.length];
        if (!taken.has(cand.name) && !excluded(cand)) ch = cand;
      }
      const c = ch ? fromCharacter(ch, 100000 + k) : derivedCustomer(rngFor(popSeed, "acquire-name", k), taken, 100000 + k) || madeUp(pop.length);
      c.email = `${slug(c.name)}.n${k}@example.com`;
      c.w = excluded(c) ? 0 : (cfgD.customer_kind_weight[c.kind] ?? 1);
      pop.push(c);
      richState.add(c);
    }
  }
  function abandonAfter(c) { return rich && c?.t ? Math.max(1, Math.round(cfgC.abandon_after_days * c.t.patience)) : cfgC.abandon_after_days; }
  function c0(it) { return it.customer; }

  /** Calls a plug-in, turning a throw into a note so one broken plug-in cannot stop the day. */
  function guarded(p, fn, ctx, problems) {
    try { return p[fn](ctx); } catch (e) { problems.push(`plug-in ${p.name || "?"} ${fn} failed: ${e.message}`); return null; }
  }

  function recoverMemory() {
    const k = cfgCust.memory_recovery_per_day;
    for (const c of pop) if (c.s !== 0) c.s = c.s < 0 ? Math.min(0, c.s + k) : Math.max(0, c.s - k);
  }

  function supplierDelays(today) {
    const tomorrow = addDays(today, 1);
    for (const po of st().purchase_orders) {
      if (po.status !== "ordered" || po.due_at > tomorrow) continue;
      const sup = st().suppliers.find((x) => x.id === po.supplier_id);
      const r = S("supplier-delay", po.supplier_id, po.due_at);
      if (sup && r.next() < (1 - sup.reliability) * mods.supplier_late_chance) {
        po.status = "late";
        po.expected_at = addDays(po.due_at, 2 + Math.floor(r.next() * 11));
        for (const l of po.lines) { const s = st().stock[l.sku]; if (s && s.on_hand <= 0) s.restock_date = po.expected_at; }
        T.pos_late++;
      }
    }
  }

  /**
   * A carrier delay (from a plug-in) holds parcels dispatched today for extra days. The engine delivers a parcel on its
   * eta, so the eta is moved and the promised one kept; once the promised day passes the parcel shows as delayed, and
   * when it lands late it carries a late note, exactly as an ordinary late parcel does.
   */
  function carrierDelays(adv, date) {
    const extra = mods.carrier_delay_days;
    if (extra > 0 && adv.dispatched.length) {
      const ids = new Set(adv.dispatched);
      for (const rec of live) for (const s of rec.o.shipments || []) {
        if (!ids.has(s.id) || !s.eta || s.promised_eta) continue;
        s.promised_eta = s.eta;
        s.eta = addDays(s.eta, extra);
        delayed.push([rec.o.number, s.id]);
      }
    }
    if (!delayed.length) return;
    const orders = new Map(live.map((r) => [r.o.number, r.o]));
    delayed = delayed.filter(([num, sid]) => {
      const s = orders.get(num)?.shipments?.find((x) => x.id === sid);
      if (!s) return false;
      if (s.status === "delivered") {
        if (s.delivered_at.slice(0, 10) > s.promised_eta) s.note = CARRIER_LATE_NOTE;
        s.eta = s.promised_eta;
        return false;
      }
      if (s.status === "in_transit" && s.promised_eta < date) { s.status = "delayed"; adv.delayed.push(s.id); }
      return true;
    });
  }

  /** Today's orders: how many arrive, who places them, what they buy. Returns the count and the day's marketing spend. */
  function demand(date, wd) {
    const monthIdx = Number(date.slice(5, 7)) - 1;
    const season = (monthIdx === 11 && Number(date.slice(8, 10)) >= 22) ? cfgD.late_december_factor : cfgD.season_by_month[monthIdx];
    const years = (Date.parse(date) - demandSeed0) / (365.25 * DAY);
    // Campaigns made with create_campaign add their spend to the budget and their codes to demand (simulation/simulator/campaigns.mjs).
    const camps = liveCampaigns(st(), date);
    dayCamps = camps;
    dayVisits = {};
    const marketing = marketingToday(monthIdx, camps);
    // Price sensitivity from plug-ins (the economy, consumer shifts). Exactly 1 when none say otherwise.
    const elasticity = cfgD.price_elasticity * mods.price_sensitivity;
    let lam = lambda0 * season * cfgD.weekday_factor_sunday_first[wd] * Math.pow(1 + cfgD.annual_growth, years)
      * Math.pow(priceIndex(), -elasticity) * Math.max(0.5, 1 + cfgD.marketing_elasticity * Math.log(marketing.factor))
      * Math.max(0.3, 1 + cfgD.reputation_weight * (rep - rep0)) * discountLift(camps, elasticity) * deliveryFactor(elasticity);
    // WHY no visits here: an event's demand.all already says how orders change; visits are people looking, and
    // multiplying both would count the same shoppers twice. Visits are kept as a visitor count only.
    lam = lam * mods.demand.all;
    T.visitors = (T.visitors || 0) + (lam / (A?.shop?.conversion || 0.025)) * mods.visits;
    if (cat) lam *= cat.factor;
    if (rich) { acquire(date, marketing.factor); lam *= richState.buyingPower(cfgCust); }
    if (camps.length) {
      const lift = (extra) => Math.max(0.5, 1 + cfgD.marketing_elasticity * Math.log(marketingToday(monthIdx, [{ monthly_spend: extra }]).factor));
      dayVisits = recordDay(camps, { lam, daysPerMonth: costs.days_per_month, elasticity, spendLift: (extra) => lift(extra) / lift(0) });
    }
    const n = poissonFromUniform(lam, S("arrivals", date).next());
    let ordersToday = 0;
    for (let i = 0; i < n; i++) {
      const r = S("basket", date, i);
      const c = rich ? richState.draw(r, cfgCust) : drawCustomer(r);
      // Rich model: each customer weighs today's prices against their own (hidden) price sensitivity.
      if (c && rich && !richState.accepts(c, priceIndex(), elasticity, S("accept", date, i).next())) continue;
      if (!c) continue;
      if (placeFor(c, r, date, i, `${date}|${i}`, null, null, S("thin", date, i).next())) ordersToday++;
    }
    ordersToday += productExtras(date, lam);
    dayStat.orders = ordersToday;
    T.orders += ordersToday;
    return { ordersToday, marketing: marketing.cost };
  }

  /**
   * The marketing budget today: the plan from business/data/costs.json, or what set_marketing_budget put in the settings.
   * `factor` is spend against the plan (times the December push); `cost` is today's share of the month.
   * WHY the same arithmetic as before when nothing is set: x / x is exactly 1, so an untouched run is unchanged.
   */
  function marketingToday(monthIdx, camps = []) {
    const plan = costs.marketing_per_month * scale;
    const spend = st().settings?.marketing_per_month ?? plan;
    const push = monthIdx === 11 ? costs.marketing_december_multiplier : 1;
    // Running campaigns add their own monthly spend on top (not pushed by December: it is what they were set to).
    const extra = camps.reduce((n, c) => n + (c.monthly_spend || 0), 0);
    if (extra) return { factor: (spend * push + extra) / plan, cost: (spend * push + extra) / costs.days_per_month };
    return { factor: (spend / plan) * push, cost: (spend * push) / costs.days_per_month };
  }

  /**
   * Product and category multipliers from plug-ins (an event, a post naming a product). A multiplier above 1 adds
   * orders of that product, drawn from their own streams; one below 1 drops that share of the product's ordinary
   * orders. WHY not reweight the everyday picks: that would reshuffle every basket in the day and drown a small,
   * real effect in noise; this way everything else in the day stays exactly as it was in the twin.
   */
  function productExtras(date, lam) {
    if (!hasProductMods()) return 0;
    let n = 0;
    for (const p of products) {
      const m = productMod(p);
      if (!(m > 1)) continue;
      const k = poissonFromUniform(lam * (wOf(p) / wsum) * (m - 1), S("extra-arrivals", date, p.id).next());
      for (let j = 0; j < k; j++) {
        const r = S("extra-basket", date, p.id, j);
        const c = rich ? richState.draw(r, cfgCust) : drawCustomer(r);
        if (c && placeFor(c, r, date, j, `${date}|${p.id}|${j}`, basket(p, r))) n++;
      }
    }
    return n;
  }
  function hasProductMods() { return Object.keys(mods.demand.products).length > 0 || Object.keys(mods.demand.categories).length > 0; }
  function productMod(p) { return (mods.demand.products[p.id] ?? 1) * (mods.demand.categories[p.category] ?? 1); }

  function priceNow(sku) {
    let price = world.index.skus[sku].item.price, date = "";
    const today = dateOf(Date.parse(st().now));
    for (const h of st().price_history) if (h.sku === sku && h.date <= today && h.date >= date) { price = h.new_price; date = h.date; }
    return price;
  }
  /**
   * Delivery charges against the plan (the business rules the world was made with): a dearer delivery, or a different
   * free-delivery threshold, changes what an order costs the customer, so demand follows it with the same price
   * elasticity as prices. Each product is taken as a typical basket of its own price. WHY exactly 1 when the rules are
   * unchanged: an untouched run stays byte-identical.
   */
  function deliveryFactor(elasticity) {
    const key = JSON.stringify(world.business.delivery?.methods || []);
    if (key === deliveryPlan.key) return 1;
    if (key !== deliveryPlan.lastKey || elasticity !== deliveryPlan.elasticity) {
      const methods = world.business.delivery?.methods || [];
      const charge = (ms, v) => { const m = ms.find((x) => x.id === "standard") || ms[0]; return !m ? 0 : m.free_over != null && v >= m.free_over ? 0 : m.price; };
      let now = 0, plan = 0;
      for (const p of products) { const v = refPrice(p), w = wOf(p); now += w * (v + charge(methods, v)); plan += w * (v + charge(deliveryPlan.methods, v)); }
      Object.assign(deliveryPlan, { lastKey: key, elasticity, factor: plan > 0 ? Math.pow(now / plan, -elasticity) : 1 });
    }
    return deliveryPlan.factor;
  }
  function priceIndex() {
    return products.reduce((n, p) => n + wOf(p) * priceNow(p.variants[0].sku) / refPrice(p), 0) / wsum;
  }

  /** Customers are drawn by how often their kind buys and how they were treated (memory). */
  function drawCustomer(r) {
    for (let k = 0; k < 40; k++) {
      const cand = pop[Math.floor(r.next() * pop.length)];
      const w = cand.w * Math.exp(cfgCust.memory_hazard_per_point * cand.s) * (cand.s <= cfgCust.churn_at ? 0 : 1);
      if (r.next() * MAXW < w) return cand;
    }
    return null;
  }

  /** Place one order for a customer through the engine, as that customer. Returns the order total, or 0. */
  /**
   * Places an order stamped at a believable time of the day (a seeded draw from the daily shape in lib.mjs, keyed by
   * the order's own key, so the same order has the same time in both twins), then puts the engine's clock back.
   * WHY: the engine's clock sits at 10:00 after each day; every order used to be stamped then. The engine's cut-off
   * rules (a 14:00 or 12:00 delivery cut-off) read the order time, so an evening order now ships a day later, as it should.
   */
  function placeFor(c, r, date, i, key, fixedItems = null, prospect = null, thinU = null) {
    const clock = st().now;
    st().now = isoAt(date, orderMinute(S("order-time", key).next()));
    try { return placeOrderFor(c, r, date, i, key, fixedItems, prospect, thinU); } finally { st().now = clock; }
  }
  function placeOrderFor(c, r, date, i, key, fixedItems = null, prospect = null, thinU = null) {
    if (!c.engine) {
      const made = as("support_agent").call("create_customer", { name: c.name, email: c.email, address: { line1: c.line1, town: c.town, postcode: c.postcode } });
      if (!made.ok) return 0;
      c.id = made.data.id; c.engine = true; byId.set(c.id, c); T.new_customers++;
    }
    const cs = world.session({ role: "customer", customer_id: c.id });
    let items = fixedItems;
    let method = "standard";
    if (!items) {
      const pr = pickProduct(r, c);
      // A product multiplier below 1 (from a plug-in) drops this share of its ordinary orders.
      if (thinU !== null && hasProductMods() && thinU >= Math.min(1, productMod(pr))) return 0;
      items = basket(pr, r);
      if (pr.id === "emergency-sandwich" || pr.id === "ice-by-post") method = "chilled";
      else if (r.next() < cfgD.next_day_share) method = "next-day";
      // A shopper near the free-delivery threshold may add one more thing to reach it (simulation/simulator/top-up.mjs, its own stream).
      items = topUpBasket(items, { method, methods: world.business.delivery?.methods, priceOf: priceNow, products, inStock: plentyForTopUp, cfg: cfgD.basket_top_up, r: S("top-up", key), weightOf: wOf }).items;
    } else method = items.some((l) => /SAND|ICE/.test(l.sku)) ? "chilled" : "standard";
    const attempt = (its) => cs.call("place_order", { items: its, delivery_method: method, card_number: "4242 4242 4242 4242" });
    let res = attempt(items);
    if (!res.ok && res.error.code === "out_of_stock") {
      T.lost_sales++; dayStat.lost++;
      T.lost_value += items.reduce((n, l) => n + l.qty * priceNow(l.sku), 0);
      if (!prospect && r.next() < cfgD.stock_substitute_share) {
        const alt = basket(pickProduct(r, c, items[0].sku), r);
        res = attempt(alt);
        if (res.ok) items = alt;
      }
    }
    if (!res.ok) return 0;
    const ord = st().orders[st().orders.length - 1];
    c.orders++;
    if (rich && !prospect) richState.afterPurchase(c, S("dropout", c.email, c.orders).next());
    for (const l of items) { sold[l.sku] = (sold[l.sku] || 0) + l.qty; T.units += l.qty; }
    live.push({ o: ord, key: `${c.id}|${date}|${key}`, placed: date, exp: 0, reviewAt: null, prospect });
    return res.data.totals.total;
  }
  /** A filler is offered only from stock above its reorder point plus TOP_UP_COVER_DAYS of sales (simulation/simulator/top-up.mjs). */
  function plentyForTopUp(sku) {
    const lead = st().suppliers.find((x) => x.skus.includes(sku))?.lead_time_days ?? 0;
    return (st().stock[sku]?.on_hand ?? 0) >= Math.max(TOP_UP_MIN_STOCK, (lead + cfgOps.safety_days + TOP_UP_COVER_DAYS) * avgSales(sku));
  }
  // c.cats: a rich customer's own category leanings from their circumstances (simulation/world/population.mjs); absent = 1.
  function pickProduct(r, c, notSku = null) {
    const pairs = products.filter((p) => !(notSku && p.variants.some((v) => v.sku === notSku)))
      .map((p) => [p, wOf(p) * (c.kind === "business" ? (p.id === "emergency-sandwich" ? 6 : 0.2) : 1) * (c.cats?.[p.category] ?? 1)]);
    return r.weighted(pairs);
  }
  function basket(p, r) {
    const v = p.id === "emergency-sandwich" ? r.weighted(p.variants.map((x) => [x, x.sku.endsWith("-3") ? 3 : 2])) : r.pick(p.variants);
    const qty = ["spare-sock", "paper-aeroplane", "emergency-sandwich"].includes(p.id) ? r.weighted([[1, 6], [2, 3], [3, 1]]) : 1;
    const lines = [{ sku: v.sku, qty }];
    if ((p.accessories || []).length && r.next() < cfgD.accessory_chance) lines.push({ sku: r.pick(p.accessories).sku, qty: 1 });
    if (r.next() < cfgD.second_product_chance) { const q = pickProduct(r, { kind: "gift" }, v.sku); lines.push({ sku: r.pick(q.variants).sku, qty: 1 }); }
    const merged = new Map();
    for (const l of lines) merged.set(l.sku, (merged.get(l.sku) || 0) + l.qty);
    return [...merged].map(([sku, qty]) => ({ sku, qty }));
  }

  // ---------------------------------------------------------------- money

  /** Adds up the day's money and work, keeps the totals and the curve, and returns the timeline line. */
  function moneyForDay(date, ordersToday, marketing, evs) {
    const L = st().ledger;
    const d = { sale: 0, delivery_income: 0, refund: 0, cost_of_goods: 0, payment_fee: 0, delivery_cost: 0, goodwill_credit: 0 };
    let engineCash = 0;
    for (let k = ledgerCursor; k < L.length; k++) {
      if (d[L[k].type] !== undefined) d[L[k].type] += L[k].amount;
      if (countsAsCash(L[k].type)) engineCash += L[k].amount;
    }
    ledgerCursor = L.length;
    // Cost changes from plug-ins (a carrier price rise, dearer goods). Multiplying by exactly 1 changes nothing.
    const extraCost = d.delivery_cost * (mods.costs.carrier - 1) + d.cost_of_goods * (mods.costs.goods - 1) + d.payment_fee * (mods.costs.card_fee - 1);
    d.delivery_cost *= mods.costs.carrier; d.cost_of_goods *= mods.costs.goods; d.payment_fee *= mods.costs.card_fee;
    const rev = d.sale + d.delivery_income, gp = rev + d.refund + d.cost_of_goods;
    // Money a campaign's code gave away today is booked with marketing, so profit and cash both fall by it.
    marketing += bookDiscount(dayCamps, d.sale);
    const pay = payFor(team, costs);
    const dim = costs.days_per_month;
    const fixed = ((costs.rent_per_month + costs.software_per_month + costs.insurance_per_month + costs.utilities_per_month) * scale) / dim;
    const packaging = costs.packaging_per_order * ordersToday;
    const outreachCost = dayStat.outreachCost || 0;
    const taskMin = team.reduce((m, p) => m + p.taskMinutes, 0), taskCost = team.reduce((m, p) => m + (p.taskMinutes / 60) * p.rate, 0);
    const ovMin = team.reduce((m, p) => m + p.overtimeMinutes, 0);
    recordLoad(st(), date, team); // how busy each person was today, for the Team app (get_workload)
    for (const p of team) { p.taskMinutes = 0; p.overtimeMinutes = 0; }
    T.days++; T.revenue += rev; T.refunds -= d.refund; T.cogs -= d.cost_of_goods; T.card_fees -= d.payment_fee; T.delivery_costs -= d.delivery_cost; T.goodwill -= d.goodwill_credit;
    T.packaging += packaging; T.staff_pay += pay.contracted; T.overtime_pay += pay.overtime; T.fixed_costs += fixed; T.marketing += marketing; T.outreach_cost += outreachCost;
    T.task_minutes += taskMin; T.task_cost += taskCost; T.overtime_minutes += ovMin;
    T.stockout_sku_days += Object.keys(st().stock).filter((k) => st().stock[k].on_hand <= 0 && shelf(k) && expected[k]).length;
    const net = gp + d.payment_fee + d.delivery_cost + d.goodwill_credit - packaging - pay.contracted - pay.overtime - fixed - marketing - outreachCost;
    T.cash_flow += engineCash + extraCost - packaging - pay.contracted - pay.overtime - fixed - marketing - outreachCost;
    cashLow = Math.min(cashLow, openingCash + T.cash_flow);
    if (day >= warmup) {
      cumGP += gp; cumTaskCost += taskCost; cumNet += net; cumRev += rev; curveDay++;
      curve.add(curveDay, { day: curveDay, gp: round2(cumGP), taskCost: round2(cumTaskCost), revenue: round2(cumRev), net: round2(cumNet) });
    }
    if (day === warmup - 1 && warmup > 0) { snapT = { ...T }; snapHist = Int32Array.from(hist); }
    return {
      day: day + 1, date, orders: ordersToday, revenue: round2(rev), gross_profit: round2(gp), net: round2(net), contacts: dayStat.contacts,
      by_tool: dayStat.toolHandled, handed_over: dayStat.handed, abandoned: dayStat.abandoned, csat: dayStat.csatN ? round2(dayStat.csatSum / dayStat.csatN) : null,
      outreach: dayStat.outreach, won: dayStat.won, lost_sales: dayStat.lost, reputation: round2(rep), task_hours: round2(taskMin / 60),
      tool_calls: dayStat.toolCalls || 0, refused: dayStat.toolRefused || 0, notes: evs.slice(0, 6),
    };
  }

  /**
   * Which ledger lines are money in or out of the bank. Cost of goods and goodwill are not cash (the engine's own rule),
   * and the engine's wages, rent, software and marketing lines are replaced by the simulator's own costs.
   */
  function countsAsCash(type) {
    return !["cost_of_goods", "goodwill_credit", "wages", "rent", "software", "marketing_spend"].includes(type);
  }

  // ---------------------------------------------------------------- stock

  function inbound(sku) {
    let n = 0;
    for (const po of st().purchase_orders) if (["ordered", "late", "draft", "awaiting_approval"].includes(po.status)) for (const l of po.lines) if (l.sku === sku) n += l.qty - (l.qty_received || 0);
    return n;
  }
  function avgSales(sku) { const w = soldWin[sku]; const tot = w.reduce((a, b) => a + b, 0); const k = w.length; return (tot + (expected[sku] || 0) * (28 - k)) / 28; }
  /** Reorder point = the supplier's lead time plus a safety margin, in days of recent sales; order up to that plus the cover days. */
  function lowStock() {
    const out = [];
    for (const sku of Object.keys(st().stock)) {
      if (!shelf(sku) || !expected[sku]) continue;
      const sup = st().suppliers.find((s) => s.skus.includes(sku));
      if (!sup) continue;
      const a = Math.max(avgSales(sku), 0.05), have = st().stock[sku].on_hand + inbound(sku), cover = have / a;
      const point = sup.lead_time_days + cfgOps.safety_days;
      if (cover < point) {
        out.push({ sku, supplier_id: sup.id, lead_time_days: sup.lead_time_days, on_hand: st().stock[sku].on_hand, inbound: inbound(sku), avg_daily_sales: round2(a),
          days_cover: round2(cover), suggested_qty: Math.max(cfgOps.reorder_min_cover_units, Math.ceil(a * (point + cfgOps.reorder_cover_days) - have)) });
      }
    }
    return out;
  }
  /** One purchase order per supplier. Returns the orders raised. */
  function raiseOrders(list, roleName) {
    const bySup = new Map();
    for (const x of list) {
      const sup = st().suppliers.find((s) => s.skus.includes(x.sku));
      if (!sup) continue;
      if (!bySup.has(sup.id)) bySup.set(sup.id, []);
      bySup.get(sup.id).push({ sku: x.sku, qty: Math.max(x.suggested_qty, sup.min_order_qty) });
    }
    const made = [];
    for (const [sid, lines] of bySup) {
      const r = as(roleName).call("create_purchase_order", { supplier_id: sid, lines, note: "Reorder (simulation)" });
      if (r.ok) { made.push(r.data); T.pos_raised++; }
    }
    return made;
  }
  async function doStock(d, date, wd, evs) {
    for (const sku of Object.keys(soldWin)) { soldWin[sku].push(sold[sku] || 0); sold[sku] = 0; if (soldWin[sku].length > 28) soldWin[sku].shift(); }
    const buyer = team.find((p) => p.role === "buyer");
    const toolStock = toolClient && ["operations_assistant", "buyer", "manager"].includes(role);
    if (toolStock) {
      const low = lowStock();
      if (low.length) await callTool({ kind: "alerts", id: `stock-${date}`, message: `Stock alert for ${date}: ${low.length} products are running low. Raise purchase orders for what is needed (create_purchase_order).`, data: { low_stock: low }, day: d, date, evs });
      // Supplier mail waiting (simulation/world/supplier-side.mjs): the connected buyer reads and answers it.
      const mail = supplierMailWaiting(st(), date);
      if (mail.length) await callTool({ kind: "supplier_mail", id: `supplier-mail-${date}`, message: supplierMailMessage(date, mail), data: { supplier_mail: mail }, day: d, date, evs });
      // A draft needs a person to approve it (buyer up to the limit, manager above).
      for (const po of st().purchase_orders.filter((p) => p.status === "draft")) {
        const total = po.lines.reduce((n, l) => n + l.qty * l.unit_cost, 0);
        const who = total > 2000 ? "manager" : "buyer";
        addLoad(team, who, (staffData.staff.find((s) => s.role === who)?.tasks[who === "buyer" ? "approve_draft_order" : "approve_purchase_order"]) || 4);
        as(who).call("approve_purchase_order", { number: po.number }); T.pos_raised++;
      }
    }
    // Staff buying runs on their buying days, for what is still low.
    if (buyer && (buyer.buying_days || cfgOps.baseline_buying_days).includes(WD[wd])) {
      const low = lowStock();
      addLoad(team, "buyer", buyer.tasks.check_stock);
      const made = raiseOrders(low, "buyer");
      addLoad(team, "buyer", made.length * buyer.tasks.place_supplier_order);
      for (const po of made) if (po.status === "awaiting_approval") { as("manager").call("approve_purchase_order", { number: po.number }); addLoad(team, "manager", 5); }
      if (made.length) evs.push(`Buyer raised ${made.length} purchase orders`);
    }
  }

  // ---------------------------------------------------------------- contacts

  function genContacts(d, date) {
    const items = [];
    const topics = cfgC.topics;
    const pushItem = (topic, c, rec, r, extra = {}) => {
      let ch = r.weighted(Object.entries(cfgC.channel_mix));
      // Social messages (contacts.social): a share of contacts arrive on Mutter or Squint instead. Their own stream, so
      // every draw above and after is unchanged and the twins stay paired.
      const soc = cfgC.social;
      if (soc?.share) { const rs = S("social-channel", date, rec ? rec.key : "none", topic, c.id ?? c.name); if (rs.next() < soc.share) ch = rs.weighted(Object.entries(soc.mix)); }
      const [lo, hi] = cfgC.arrival_hours[ch];
      const sku = extra.sku;
      const prod = sku ? world.index.skus[sku].product.name : "order";
      const text = rich && c.m ? richText(topic, c, rec, prod, extra, textFor) : textFor(topic, c, rec, prod, extra);
      items.push({ id: `c${++itemSeq}`, key: `${date}|${rec ? rec.key : "none"}|${topic}`, topic, cid: c.id, name: c.name, channel: ch, t0: d * 1440 + (lo * 60 + r.next() * (hi - lo) * 60), arrivalDay: d,
        order: rec?.o.number || null, postcode: rec ? rec.o.delivery.address.postcode : c.postcode, sku, text, rec, customer: c, repeat: !!extra.repeat });
    };
    for (const rec of live) contactsForOrder(rec, date, topics, pushItem);
    // Questions from people who have not bought yet.
    for (const t of ["product_question", "presale"]) {
      const lamQ = topics[t].per_order_today * Math.max(dayStat.orders, 1) * mods.contact_rate;
      const nq = poissonFromUniform(lamQ, S("questions", date, t).next());
      for (let i = 0; i < nq; i++) { const r = S("question", date, t, i); const c = pop[Math.floor(r.next() * pop.length)]; const p = r.pick(products); pushItem(t, c, null, r, { sku: p.variants[0].sku }); }
    }
    for (const it of items) { T.contacts += it.repeat ? 0 : 1; if (it.repeat) T.repeat_contacts++; if (it.topic === "complaint" && !it.repeat) T.complaints++; }
    for (const it of items) writeContact(it, d, date);
    for (const b of backlog) items.push(b);
    backlog = [];
    items.sort((a, b) => a.t0 - b.t0);
    return items;
  }

  /** Rates are per order and day, higher for late parcels and for customers who were badly treated. */
  function contactsForOrder(rec, date, topics, pushItem) {
    const os = orderState(rec.o);
    if (os.s === "none") return;
    const c = byId.get(rec.o.customer_id);
    if (!c) return;
    const age = (Date.parse(date) - Date.parse(rec.placed)) / DAY;
    const sinceDeliv = os.at ? (Date.parse(date) - Date.parse(os.at)) / DAY : null;
    const kindMult = (t) => (topics.complaint.kind_multiplier?.[c.kind] && t === "complaint" ? topics.complaint.kind_multiplier[c.kind] : 1);
    const badMult = (1 + cfgCust.complaint_multiplier_per_bad_point * Math.max(0, -c.s)) * mods.contact_rate;
    const roll = (t, p) => { const r = S("contact", rec.key, date, t); return r.next() < p * badMult ? r : null; };
    let r;
    if (os.s === "in_transit" && (r = roll("where_is_my_order", topics.where_is_my_order.per_order_day))) pushItem("where_is_my_order", c, rec, r);
    if (os.s === "delayed") {
      if ((r = roll("where_is_my_order", topics.where_is_my_order.per_order_day * topics.where_is_my_order.delayed_multiplier))) pushItem("where_is_my_order", c, rec, r);
      if ((r = roll("late_parcel", topics.late_parcel.per_order_day))) pushItem("late_parcel", c, rec, r);
    }
    if (os.s === "paid" && (r = roll("change_order", topics.change_order.per_order_day))) pushItem("change_order", c, rec, r, { wants: r.next() < 0.5 ? "cancel" : "address" });
    if (os.s === "delivered") {
      const sku = rec.o.items[S("contact", rec.key, "sku").int(0, rec.o.items.length - 1)].sku;
      for (const t of ["damaged", "missing", "fault", "return_question"]) if (sinceDeliv <= topics[t].within_days && (r = roll(t, topics[t].per_order_day))) pushItem(t, c, rec, r, { sku });
      if (rec.o.payment.refunded > 0 && age <= topics.refund_chase.within_days + 20 && (r = roll("refund_chase", topics.refund_chase.per_order_day))) pushItem("refund_chase", c, rec, r);
      if (os.late && sinceDeliv <= 3 && (r = roll("complaint", topics.complaint.late_per_order_day))) pushItem("complaint", c, rec, r);
    }
    if (os.s !== "delivered" && (r = roll("complaint", topics.complaint.per_order_day * kindMult("complaint")))) pushItem("complaint", c, rec, r);
    if (os.s === "delivered" && (r = roll("complaint", topics.complaint.per_order_day * kindMult("complaint")))) pushItem("complaint", c, rec, r);
  }

  async function doContacts(d, date, items, evs) {
    const rolesForTool = { assistant: 1, support_agent: 1, support_lead: 1, manager: 1 };
    const useTool = toolClient && rolesForTool[role];
    const toStaff = [];
    const outside = st().settings?.support;
    const held = [];
    for (const it of items) {
      // Channels a person or an outside AI answers (set_support_cover): staff leave them alone for a while.
      if (outside && outside.channels?.includes(it.channel) && !it.staffTakes) {
        const done = outsideAnswer(it, d, date);
        if (done) continue;
        if (workingMinutes(it.t0, d * 1440 + CLOSE_MIN, d, date) < (outside.staff_after_minutes ?? 480)) { it.fromBacklog = true; held.push(it); continue; }
        it.staffTakes = true; // waited too long: staff step in
      }
      if (!useTool || it.fromBacklog) { toStaff.push(it); continue; }
      const res = await callTool({ kind: "contact", id: it.id, message: it.text, channel: it.channel, data: { topic_hint: undefined }, day: d, date, evs, item: it });
      T.tool_items++;
      if (res.error) { T.tool_errors++; toStaff.push(it); continue; }
      const verdict = judgeContact(it.topic, res.calls, res.reply);
      it.verdict = verdict;
      if (verdict.outcome === "resolved") { finishContact(it, "resolved", true, d, cfgC.tool_response_minutes, date); T.contacts_tool++; dayStat.toolHandled++; continue; }
      if (verdict.outcome === "wrong_action") {
        finishContact(it, "wrong_action", true, d, cfgC.tool_response_minutes, date); T.contacts_tool++; T.wrong_actions++;
        moment(d, `The tool made an unrequested change on ${it.name}'s "${it.topic}" contact (${verdict.why}).`, -(40 + (it.rec ? it.rec.o.totals.total : 0)), "wrong_action");
        toStaff.push({ ...it, staffRepair: true, partOf: 0.5 });
        continue;
      }
      // handed over, partial, or failed: a person takes it. First response was the tool's.
      it.toolFirstResponse = cfgC.tool_response_minutes; it.toolOutcome = verdict.outcome;
      if (verdict.outcome === "handed_over") { T.contacts_handed_over++; dayStat.handed++; }
      toStaff.push(it);
    }
    staffWork(d, date, toStaff);
    for (const it of held) backlog.push(it);
  }

  /** Staff work the rest in arrival order. Long queues lower their accuracy; contacts waiting too long are dropped. */
  function staffWork(d, date, toStaff) {
    backlog = [];
    const taskFor = (it) => [cfgC.channel_task[it.channel], cfgC.topics[it.topic].task];
    const capacity = team.filter((p) => p.on && ["support_agent", "support_lead"].includes(p.role)).reduce((n, p) => n + capacityMinutes(p), 0);
    const pressure = Math.min(1, toStaff.reduce((n) => n + 8, 0) / Math.max(1, capacity));
    for (const it of toStaff) {
      const roles = it.topic === "complaint" ? ["support_lead"] : ["support_agent", "support_lead"];
      // A person is not watching the queue every minute: they pick a new message up after a while (by channel).
      const ready = it.arrivalDay === d ? it.t0 - d * 1440 + (cfgC.pickup_minutes?.[it.channel] ?? 0) : 0;
      const share = it.toolOutcome === "handed_over" ? cfgC.handed_over_minutes_share : 1;
      const slot = pick(team, roles, ready, taskFor(it), share) || (it.topic === "complaint" ? pick(team, ["support_agent", "support_lead"], ready, taskFor(it), share) : null);
      const abs = (m) => d * 1440 + m;
      if (!slot) {
        if (d - it.arrivalDay >= abandonAfter(it.customer)) {
          finishContact(it, "abandoned", false, d, null, date); T.contacts_abandoned++; dayStat.abandoned++;
          moment(d, `${it.name}'s "${it.topic}" contact was never answered and was dropped after ${cfgC.abandon_after_days} days.`, -45, "abandoned");
          continue;
        }
        it.fromBacklog = true; backlog.push(it);
        continue;
      }
      commit(slot);
      it.staffRole = slot.person.role; it.taskMinutes = slot.minutes * slot.person.scale;
      // The response time reported is the customer's real wait (clock minutes). What customers mind is working time:
      // a reply at 09:00 to an email sent at 22:00 is "first thing next morning", not eleven hours late.
      const frt = it.toolFirstResponse ?? Math.max(0, abs(slot.start) - it.t0);
      const frtWork = it.toolFirstResponse ?? workingMinutes(it.t0, abs(slot.start), d, date);
      const lateDays = Math.floor(frtWork / (CLOSE_MIN - OPEN_MIN)); // whole working days the customer waited
      const loss = cfgC.queue_pressure_skill_loss * pressure;
      const u = S("staff-skill", it.key).next();
      const okStaff = u < slot.person.skill * (1 - loss);
      staffAct(it, okStaff);
      T.contacts_staff++;
      finishContact(it, okStaff ? (it.outsideWindow ? "partial" : "resolved_by_staff") : "failed", false, d, frt, date, lateDays, it.toolOutcome === "handed_over", frtWork);
      if (!okStaff && !it.repeat && S("repeat", it.key).next() < 0.5) {
        const again = { ...it, id: `c${++itemSeq}`, repeat: true, t0: abs(24 * 60 + 9 * 60), arrivalDay: d + 1, fromBacklog: true, toolOutcome: null, toolFirstResponse: undefined, key: it.key + "|again", contactId: null, convId: null };
        writeContact(again, d + 1, addDays(date, 1));
        backlog.push(again);
      }
    }
  }

  // ---------------------------------------------------------------- contacts as the world's own records

  /**
   * Every contact becomes records a person or an AI can see and answer in the apps: a `contacts` record (Front Desk),
   * the customer's email in the hello@ mailbox for email contacts (Letterbox), and a conversation for web chat. The
   * shapes and keys are the comms deriver's, so it never writes the same message twice.
   */
  function writeContact(it, d, date) {
    if (it.contactId) return;
    const s = st();
    const at = isoAt(date, it.t0 - d * 1440);
    const c = it.customer;
    const rec = { id: nextIdIn(s.contacts, "CT", 5), at, customer_id: c?.id ?? null, channel: it.channel, topic: it.topic, handled_by: null,
      first_reply_minutes: null, resolve_minutes: null, outcome: "waiting", case_number: null, summary: summaryOf(it), order: it.order || null };
    s.contacts.push(rec);
    it.contactId = rec.id;
    it.at = at;
    if (it.channel === "email" && c?.email) {
      s.emails ||= [];
      s.emails.push({ id: nextIdIn(s.emails, "EM", 6), key: `contact|${rec.id}|in`, thread_id: rec.id, mailbox: "hello", folder: "inbox",
        from: { name: c.name, address: c.email }, to: [{ name: SHOP, address: HELLO }], cc: [], subject: SUBJECTS[it.topic] || "A question",
        body: `${it.text}\n\n${c.name}`, at, read: false, by: null, links: { customer_id: c.id ?? undefined, contact_id: rec.id, ...(it.order ? { order: it.order } : {}) } });
    } else if (SOCIAL_CHANNELS[it.channel]) {
      // A private message, or a public post that tags the shop, so Mutter and Squint show it where it came in.
      const [network, kind] = SOCIAL_CHANNELS[it.channel];
      s.social_posts ||= [];
      const handle = String(c?.name || "someone").toLowerCase().replace(/[^a-z]+/g, "");
      const post = { id: nextIdIn(s.social_posts, "SP", 6), key: `contact|${rec.id}|in`, network, author: { kind: "customer", name: c?.name ?? "Someone", handle, customer_id: c?.id ?? null },
        kind, text: it.text, image: null, at, likes: 0, reposts: 0, parent: null, parent_key: null, thread: kind === "dm" ? `dm-${network}-${c?.id ?? handle}-${date}` : null, by: null,
        mentions_shop: kind === "post", links: { customer_id: c?.id ?? undefined, contact_id: rec.id, ...(it.order ? { order: it.order } : {}) } };
      s.social_posts.push(post);
      it.socialId = post.id;
    } else if (it.channel === "web_chat" || (it.channel === "phone" && s.settings?.support?.channels?.includes("phone"))) {
      // WHY phone only under cover: a call left to an outside receptionist needs the caller's words on record; with
      // staff answering, calls stay as contacts only, exactly as before.
      s.conversations ||= [];
      const conv = { id: nextIdIn(s.conversations, "CONV", 4), customer_id: c?.id ?? null, channel: it.channel === "phone" ? "phone" : "web", started_at: at, case_number: null,
        summary: rec.summary, contact_id: rec.id, messages: [{ from: "customer", at, text: it.text }] };
      s.conversations.push(conv);
      it.convId = conv.id;
    }
  }

  /** Staff (or the tool, or the outside) finished with a contact: the record, and the reply where the customer sees it. */
  function closeContact(it, outcome, byTool, frt, date) {
    const rec = it.contactId && findBack(st().contacts, (x) => x.id === it.contactId);
    if (!rec || rec.handled_by) return;
    const answeredAt = frt === null || frt === undefined || !it.at ? null : isoAfterMinutes(it.at, frt);
    rec.handled_by = it.outsideBy ? "outside" : byTool ? role : it.staffRole || "support_agent";
    if (it.outsideBy) rec.answered_by = it.outsideBy; // who wrote the reply (a staff id the outside acted as, or "outside")
    if (rec.first_reply_minutes === null || rec.first_reply_minutes === undefined) rec.first_reply_minutes = answeredAt ? Math.max(0, Math.round((Date.parse(answeredAt) - Date.parse(it.at)) / 60000)) : null;
    rec.resolve_minutes = it.taskMinutes ? Math.round(it.taskMinutes) : null;
    rec.outcome = { resolved: "answered", resolved_by_staff: it.caseNumber ? "case_opened" : "answered", handed_over: "escalated", partial: "partly_answered", failed: "unresolved", wrong_action: "wrong_action", abandoned: "abandoned" }[outcome] || outcome;
    rec.case_number = it.caseNumber || null;
    if (!answeredAt || it.outsideBy) return; // the outside wrote its own reply
    const text = REPLIES[it.topic] || "Thank you for getting in touch. I have looked into this for you.";
    if (it.channel === "email" && it.customer?.email) {
      const s = st();
      s.emails.push({ id: nextIdIn(s.emails, "EM", 6), key: `contact|${rec.id}|reply`, thread_id: rec.id, mailbox: "hello", folder: "sent",
        from: { name: SHOP, address: HELLO }, to: [{ name: it.customer.name, address: it.customer.email }], cc: [], subject: `Re: ${SUBJECTS[it.topic] || "A question"}`,
        body: text, at: answeredAt, read: true, by: null, links: { customer_id: rec.customer_id ?? undefined, contact_id: rec.id, ...(it.order ? { order: it.order } : {}) } });
    } else if (it.socialId) {
      const s = st(), first = findBack(s.social_posts, (x) => x.id === it.socialId);
      if (first) s.social_posts.push({ ...first, id: nextIdIn(s.social_posts, "SP", 6), key: `contact|${rec.id}|reply`, author: { kind: "company", name: SHOP, handle: "overthoughtco" },
        kind: first.kind === "dm" ? "dm" : "reply", text, at: answeredAt, parent: first.kind === "dm" ? null : first.id, parent_key: first.kind === "dm" ? null : first.key, mentions_shop: false, by: byTool ? null : it.staffRole || null });
    } else if (it.convId) {
      const conv = findBack(st().conversations, (x) => x.id === it.convId);
      if (conv) { conv.messages.push({ from: byTool ? "assistant" : "staff", at: answeredAt, text }); if (rec.case_number) conv.case_number = rec.case_number; }
    }
  }

  /**
   * A contact on a channel the outside answers: has someone replied (send_email to the customer's email marks the
   * contact answered)? Then it is judged like a tool's answer, from the records: the reply and the tool calls made
   * about this customer or order since it arrived (the engine's audit log). Returns true when it is finished.
   */
  function outsideAnswer(it, d, date) {
    const rec = it.contactId && findBack(st().contacts, (x) => x.id === it.contactId);
    if (!rec || rec.first_reply_minutes === null || rec.first_reply_minutes === undefined || rec.handled_by) return false;
    const reply = findBack(st().emails || [], (e) => e.folder === "sent" && e.links?.contact_id === rec.id && String(e.key).startsWith("tool|"));
    const since = it.at || rec.at;
    const about = [it.order, rec.customer_id].filter(Boolean);
    // A question about a product names no order or customer, so catalogue look-ups since it arrived count for it.
    const info = ["product_question", "presale"].includes(it.topic);
    const calls = (st().audit || []).filter((a) => a.at >= since.slice(0, 10) && a.ok !== undefined && (about.some((x) => JSON.stringify(a.input || {}).includes(x)) || (info && CATALOGUE_READS.has(a.tool))))
      .map((a) => ({ tool: a.tool, ok: a.ok, result: a.tool === "report_problem" && a.ok ? { outcome: "replacement" } : {} }));
    // Chat and phone answers are written into the contact's conversation (infrastructure/server/deliver.mjs), not the mailbox.
    const conv = reply ? null : findBack(st().conversations || [], (x) => x.contact_id === rec.id);
    const said = reply ? reply.body : (conv?.messages || []).filter((m) => m.from !== "customer").map((m) => m.text).join("\n");
    const verdict = judgeContact(it.topic, calls, said);
    const repliedAt = reply ? reply.at : isoAfterMinutes(rec.at, rec.first_reply_minutes);
    const frtWork = workingMinutes(it.t0, runMinutes(repliedAt, d, date), d, date);
    const frt = Math.max(0, runMinutes(repliedAt, d, date) - it.t0);
    it.outsideBy = reply?.by || "outside";
    T.contacts_outside = (T.contacts_outside || 0) + 1;
    // WHY on the record: a correct hand-over is finished by staff, so only this says what the outside's answer was worth.
    rec.outside_verdict = verdict.outcome;
    if (verdict.outcome === "resolved" || verdict.outcome === "wrong_action") {
      finishContact(it, verdict.outcome, true, d, frt, date, Math.floor(frtWork / (CLOSE_MIN - OPEN_MIN)), false, frtWork);
      if (verdict.outcome === "resolved") T.contacts_resolved_outside = (T.contacts_resolved_outside || 0) + 1;
      if (verdict.outcome === "wrong_action") T.wrong_actions++;
      return true;
    }
    // Handed over, partial or not helpful: staff finish it, and the first answer was the outside's (as with a tool).
    it.toolFirstResponse = frtWork; it.toolOutcome = verdict.outcome; it.staffTakes = true; it.outsideBy = null;
    return false;
  }

  function summaryOf(it) {
    const m = /\.\s+(.*?[.?])/.exec(it.text);
    return (m ? m[1] : it.text).slice(0, 120);
  }
  /** An ISO time for a minute of a date. */
  function isoAt(date, minute) {
    const m = Math.max(0, Math.min(1439, Math.round(minute)));
    return `${date}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00Z`;
  }
  function isoAfterMinutes(iso, minutes) { return new Date(Date.parse(iso) + minutes * 60000).toISOString().replace(".000Z", "Z"); }
  /** Run minutes (day index × 1440 + minute) of an ISO time, given today's index and date. */
  function runMinutes(iso, today, todayDate) {
    const dayDiff = Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${todayDate}T00:00:00Z`)) / DAY);
    return (today + dayDiff) * 1440 + Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
  }

  /** Working minutes (09:00 to 17:30 on the team's days) between two run times (day index × 1440 + minute). */
  function workingMinutes(t0, t1, today, todayDate) {
    if (t1 <= t0) return 0;
    let total = 0;
    for (let k = Math.floor(t0 / 1440); k <= Math.floor(t1 / 1440); k++) {
      if (!isWorkingDay(k, today, todayDate)) continue;
      const open = k * 1440 + OPEN_MIN, close = k * 1440 + CLOSE_MIN;
      total += Math.max(0, Math.min(t1, close) - Math.max(t0, open));
    }
    return total;
  }
  function isWorkingDay(k, today, todayDate) {
    const wd = (((weekdayOf(todayDate) - (today - k)) % 7) + 7) % 7;
    return staffData.days.includes(WD[wd]);
  }

  /** Record the result of a contact: satisfaction, response time, memory and the order's experience. */
  function finishContact(it, outcome, byTool, d, frt, date, lateDays = 0, handedOver = false, frtWork = frt) {
    const cfg = sim.csat;
    const frtM = frt ?? cfgC.slow_after_minutes * 4;
    const felt = frtWork ?? frtM; // working minutes: what the customer holds against us
    const slowAfter = rich && c0(it)?.t ? cfgC.slow_after_minutes * c0(it).t.patience : cfgC.slow_after_minutes;
    const cs = csatFor(cfg, { outcome: outcome === "resolved_by_staff" && handedOver ? "handed_over" : outcome, byTool, firstResponseMinutes: felt, lateDays });
    T.csat_sum += cs; T.csat_n++; dayStat.csatSum += cs; dayStat.csatN++; if (cs >= cfg.satisfied_at_least) T.satisfied_n++;
    if (frt !== null) { T.frt_n++; T.frt_sum += frtM; hist[binOf(frtM)]++; }
    if (outcome === "resolved" || outcome === "resolved_by_staff") T.contacts_resolved++;
    const pts = outcome === "resolved" || outcome === "resolved_by_staff" ? cfgCust.good_resolution_points : outcome === "partial" ? cfgCust.partial_resolution_points
      : outcome === "wrong_action" ? cfgCust.wrong_action_points : outcome === "abandoned" ? cfgCust.abandoned_points : cfgCust.bad_resolution_points;
    const c = it.customer;
    const feltPoints = pts + (felt > (rich ? slowAfter : cfgC.slow_after_minutes) ? cfgCust.slow_points : 0);
    if (c) c.s = Math.max(-3, Math.min(3, c.s + feltPoints));
    // Word of mouth: friends, neighbours and household hear about a notable experience (simulation/simulator/customers.mjs).
    if (rich && c) richState.spread(c, feltPoints, date);
    if (it.rec) it.rec.exp += cs - 3.5;
    if (rich && c) c.memo = memoLine(it, outcome, frtM);
    closeContact(it, outcome, byTool, frt, date);
    if (it.topic === "complaint" && byTool && outcome === "resolved") moment(d, `The tool settled ${it.name}'s complaint without a person.`, 60, "complaint");
  }

  /** What staff do in the engine for a contact (real changes, through a support session). */
  function staffAct(it, ok) {
    const lb = st().ledger.length;
    staffActions(it, ok);
    let ref = 0;
    for (let k = lb; k < st().ledger.length; k++) if (st().ledger[k].type === "refund") ref -= st().ledger[k].amount;
    if (ref > 0) { const key = `refund_by_staff:${it.topic}`; T[key] = (T[key] || 0) + ref; }
  }
  function staffActions(it, ok) {
    if (!ok || !it.order || it.staffRepair) return;
    const s = world.session({ role: "support_agent" });
    if (!s.call("verify_customer", { reference: it.order, email_or_postcode: it.postcode }).ok) return;
    const ord = it.rec.o;
    const sku = it.sku || ord.items[0].sku;
    const r = S("staff-act", it.key);
    if (["damaged", "missing", "fault"].includes(it.topic)) {
      const out = s.call("report_problem", { order_number: ord.number, sku, problem: it.topic === "missing" ? "missing" : "damaged", resolution: r.next() < cfgC.staff_refund_chance_fault ? "refund" : "replacement", has_photo: true });
      if (!out.ok && out.error.code === "needs_human") s.call("issue_refund", { order_number: ord.number, amount: Math.min(ord.items.find((l) => l.sku === sku).unit_price, 100), reason: `${it.topic}, outside quick-fix window` });
    } else if (it.topic === "return_question") {
      const made = s.call("create_return", { order_number: ord.number, items: [{ sku, qty: 1 }], reason: "change_of_mind" });
      // WHY: a customer told "too late to return it" is not a resolved customer. Only when the order is really past the
      // returns window in the business rules, so a refusal for any other reason (and every untouched run) is unchanged.
      const at = orderState(ord).at, windowDays = world.business.returns?.window_days;
      if (!made.ok && at && typeof windowDays === "number" && (Date.parse(st().now) - Date.parse(at)) / DAY > windowDays) it.outsideWindow = true;
    }
    else if (it.topic === "change_order") {
      const cancel = it.text.includes("cancel");
      s.call(cancel ? "cancel_order" : "update_order", cancel ? { order_number: ord.number, reason: "customer asked" } : { order_number: ord.number, address: { line1: it.customer.line1, town: it.customer.town, postcode: it.postcode } });
    } else if (it.topic === "complaint") {
      const opened = s.call("open_case", { subject: "Complaint", category: "complaint", summary: it.text.slice(0, 120), related: { order: ord.number }, is_complaint: true });
      if (opened.ok) it.caseNumber = opened.data.number;
      if (r.next() < cfgC.staff_goodwill_chance_complaint) as("support_agent").call("add_goodwill_credit", { customer_id: it.cid, amount: cfgC.staff_goodwill_amount, reason: "Goodwill after a complaint" });
    }
  }

  // ---------------------------------------------------------------- calling the tool under test

  async function callTool({ kind, id, message, channel = "web_chat", data: extra = null, day: d, date, evs, item = null }) {
    const before = tracer.mark(), ledgerBefore = st().ledger.length;
    // The second argument is for in-process clients only (simulation/twin-run/client.ts): the contact as the simulator holds it, so
    // a model-voiced customer can be briefed from their hidden traits. It is never sent over the wire.
    const t = await toolClient.call({ protocol: 1, session_id: id, turn: 0, message, channel, role, api_url: toolEnv.api_url, token: toolEnv.token, system_prompt: systemPromptFor(role), sim: { kind, day: d + 1, date, ...(extra ? { data: extra } : {}) } }, { item });
    const calls = tracer.callsSince(before, id).map((e) => ({ tool: e.tool, ok: e.ok, result: e.ok ? e.result : undefined, error: e.ok ? undefined : e.error }));
    countToolRefunds(calls, ledgerBefore, item, kind);
    for (const c of calls) if (!c.ok && ["forbidden", "rule_violation"].includes(c.error?.code)) { const key = `refused:${c.tool}:${c.error.code}:${item?.topic || kind}`; T[key] = (T[key] || 0) + 1; }
    T.tool_calls += calls.length; dayStat.toolCalls = (dayStat.toolCalls || 0) + calls.length;
    const refused = calls.filter((c) => !c.ok && ["forbidden", "rule_violation"].includes(c.error?.code)).length, failed = calls.filter((c) => !c.ok).length;
    T.tool_refused += refused; T.tool_failed += failed; dayStat.toolRefused = (dayStat.toolRefused || 0) + refused;
    if (refused) evs.push(`Tool refused ${refused}x: ${calls.filter((c) => !c.ok).map((c) => c.tool + ":" + c.error.code).slice(0, 3).join(", ")}`);
    if (kind !== "contact" && calls.length) evs.push(`Tool (${kind}) made ${calls.length} calls`);
    return { reply: t.reply, error: t.error, calls };
  }
  function countToolRefunds(calls, ledgerBefore, item, kind) {
    let ref = 0;
    for (let k = ledgerBefore; k < st().ledger.length; k++) if (st().ledger[k].type === "refund") ref -= st().ledger[k].amount;
    const cause = calls.find((c) => c.ok && ["cancel_order", "report_problem", "create_return", "issue_refund"].includes(c.tool));
    if (ref > 0) { const key = `refund_by_tool:${cause?.tool || "other"}:${item?.topic || kind}`; T[key] = (T[key] || 0) + ref; }
  }

  // ---------------------------------------------------------------- prospects

  function staffOutreach(evs) {
    const toad = team.find((p) => p.role === "marketing" && p.on);
    if (!toad) return;
    const per = toad.tasks.send_outreach;
    const free = freeMinutes(toad);
    let canSend = Math.floor(free / per);
    const list = st().prospects.filter((p) => p.status === "new").sort((a, b) => b.monthly_budget - a.monthly_budget || a.id.localeCompare(b.id));
    for (const p of list) {
      if (canSend <= 0) break;
      const r = as("marketing").call("send_outreach", { prospect_id: p.id, channel: "email", message: `Hello ${p.decision_maker.name.split(" ").slice(-1)[0]}, we are Overthought & Co. We sell everyday things and would be glad to supply ${p.name}.` });
      if (r.ok) { staffSent.add(r.data.id); canSend--; addLoad(team, "marketing", per); if (evs.length < 6) evs.push(`Staff contacted ${p.name}`); }
    }
  }

  async function doProspects(d, date, wd, evs) {
    prospectEventsDue(d);
    standingOrders(d, date);
    // Outreach: the tool first (if its role prospects), then staff for what is left.
    const toolProspects = toolClient && ["marketing", "manager"].includes(role);
    if (toolProspects && wd >= 1 && wd <= 5) {
      const fresh = st().prospects.filter((p) => p.status === "new").length, waiting = st().prospects.filter((p) => p.status === "replied").length;
      await callTool({ kind: "prospects", id: `prospects-${date}`, message: `Prospecting for ${date}. ${fresh} prospects have not been contacted; ${waiting} replied and wait for a follow-up. Use list_prospects and send_outreach.`, data: { new: fresh, replied: waiting }, day: d, date, evs });
    }
    if (wd >= 1 && wd <= 5) staffOutreach(evs);
    await scoreOutreach(d);
  }

  /** Earlier replies and decisions come due today. */
  function prospectEventsDue(d) {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.day > d) continue;
      events.splice(i, 1);
      const p = st().prospects.find((x) => x.id === ev.pid), ps = pstate.get(ev.pid);
      if (ev.type !== "reply") continue;
      if (p.status !== "declined" && p.status !== "customer") p.status = "replied";
      T.prospects_replied++;
      if (ev.buy) {
        p.status = "customer"; ps.won = true; T.prospects_won++; dayStat.won++;
        const c = { id: null, name: p.decision_maker.name, email: p.decision_maker.email, kind: "business", line1: p.location.address_line, town: p.location.town, postcode: p.location.postcode, s: 0, orders: 0, engine: false, w: 0 };
        pop.push(c); ps.cust = c;
        ps.nextOrder = d + Math.floor(ev.startIn);
        if (ps.byTool) moment(d, `${p.name} replied and became a customer (needs: ${p.needs.map((n) => `${n.qty} x ${n.product}`).slice(0, 2).join(", ")}).`, p.monthly_budget * 0.6 * 6, "prospect_won");
      } else if (ev.decline) { p.status = "declined"; }
    }
  }

  /** Standing orders from won prospects. */
  function standingOrders(d, date) {
    for (const p of st().prospects) {
      const ps = pstate.get(p.id);
      if (!ps || !ps.won || ps.nextOrder === null || ps.nextOrder > d) continue;
      const due = p.needs.filter((n) => n.every === "week" || (n.every === "month" && ps.k % 4 === 0) || (n.every === "quarter" && ps.k % 13 === 0) || (n.every === "once" && ps.k === 0));
      ps.k = (ps.k || 0) + 1;
      const items = due.map((n) => ({ sku: n.sku, qty: Math.max(1, Math.round(n.qty * cfgP.share_of_need)) }));
      let total = 0;
      if (items.length) total = placeFor(ps.cust, S("prospect-order", p.id, d), date, 0, `P${p.id}|${d}`, items, p.id) || 0;
      if (total) { ps.revenue += total; T.prospect_revenue += total; }
      ps.nextOrder = d + 7;
      if (S("prospect-churn", p.id, d).next() < cfgP.churn_after_orders) ps.nextOrder = null;
    }
  }

  /** Score every new outreach record (whoever sent it) from the record itself. */
  // With `outreachJudge` (simulation/twin-run, a buyer persona voiced by a model), the buyer reads the tool's outreach and decides
  // for themselves; the random draws are still made first, so the streams stay identical, and staff outreach is
  // always scored by these rules.
  async function scoreOutreach(d) {
    while (outreachCursor < st().outreach.length) {
      const rec = st().outreach[outreachCursor++];
      const p = st().prospects.find((x) => x.id === rec.prospect_id), ps = pstate.get(p.id);
      ps.outreachN++; T.outreach_sent++; dayStat.outreach++;
      ps.byTool = !staffSent.has(rec.id);
      if (ps.byTool) T.outreach_by_tool++;
      dayStat.outreachCost = (dayStat.outreachCost || 0) + (costs.outreach_cost[rec.channel] || 0);
      if (ps.outreachN === 1) T.prospects_contacted++;
      const q = outreachQuality(cfgP, rec, p);
      const r = S("prospect-reply", p.id, ps.outreachN);
      const pReply = Math.min(0.95, p.private.reply_propensity * (0.4 + q.quality));
      const replies = r.next() < pReply, delay = cfgP.reply_delay_days[0] + Math.floor(r.next() * (cfgP.reply_delay_days[1] - cfgP.reply_delay_days[0] + 1));
      const uBuy = r.next(), uDecline = r.next(), startIn = cfgP.orders_start_after_days[0] + Math.floor(r.next() * (cfgP.orders_start_after_days[1] - cfgP.orders_start_after_days[0] + 1));
      if (outreachJudge && ps.byTool) {
        const v = await outreachJudge({ outreach: rec, prospect: p, quality: q.quality, contactN: ps.outreachN, day: d, won: ps.won });
        if (v) { if (v.replies) events.push({ day: d + delay, pid: p.id, type: "reply", buy: !!v.buy && !ps.won, decline: !!v.decline, startIn }); else if (v.decline) p.status = "declined"; continue; }
      }
      if (!replies) continue;
      // Buys when the outreach is good enough for them: quality plus a little luck against their own bar.
      const bar = 0.7 - 0.2 * Math.min(1, p.private.reply_propensity);
      const needReal = S("prospect-need", p.id).next() < cfgP.ready_to_buy_share; // only some prospects really want to switch supplier now
      const buy = needReal && q.quality + cfgP.buy_threshold_noise * (uBuy - 0.5) >= bar && !ps.won;
      events.push({ day: d + delay, pid: p.id, type: "reply", buy, decline: !buy && uDecline < 0.25, startIn });
    }
  }

  // ---------------------------------------------------------------- reviews and reputation

  /**
   * A finished task leaves a trace: a note on the case it was about, and a customer who was followed up remembers it
   * a little (TASK_FOLLOW_UP_POINTS, an assumption on the scale of sim.json customers' points).
   */
  function finishTasks(done) {
    for (const t of done) {
      const kase = t.links?.case ? st().cases.find((k) => k.number === t.links.case) : null;
      const who = staffData.staff.find((p) => p.id === t.assignee)?.name || "Someone";
      if (kase) as("support_lead").call("add_case_note", { case_number: kase.number, text: `${who} finished a task: ${t.title}.` });
      const cust = byId.get(t.links?.customer_id || kase?.customer_id);
      if (cust) cust.s = Math.min(3, cust.s + TASK_FOLLOW_UP_POINTS);
    }
  }

  function doReviews(d, date) {
    for (const rec of live) {
      const os = orderState(rec.o);
      if (os.s === "delivered" && !rec.reviewAt && !rec.reviewed) rec.reviewAt = addDays(os.at || date, 4);
      if (!rec.reviewAt || rec.reviewAt > date || rec.reviewed) continue;
      rec.reviewed = true; rec.reviewAt = null;
      const rr = S("review", rec.key);
      const loud = rich && rec.exp < -0.5 && byId.get(rec.o.customer_id)?.t?.public ? 2 : 1; // a public complainer posts the bad ones
      if (rr.next() >= sim.reviews.rate_per_delivered_order * (rec.exp < -1 ? 3 : 1) * loud) continue;
      let rating = rr.weighted(sim.reviews.base_rating_weights);
      if (rec.exp < -0.5) rating += sim.reviews.rating_bad_experience_shift; else if (rec.exp > 0.5) rating += sim.reviews.rating_good_experience_shift;
      if (orderState(rec.o).late) rating -= 1;
      rating = Math.max(1, Math.min(5, Math.round(rating)));
      // The review goes into the records, linked to its order and customer, so the help desk can read and answer it.
      writeReview({ state: st(), world, seed, order: rec.o, rating, date, late: orderState(rec.o).late, badHelp: rec.exp < -0.5 });
      T.reviews++; T.review_sum += rating; if (rating <= 2) T.bad_reviews++;
      rep += ((rating - 1) / 4 - rep) / sim.reviews.reputation_memory_reviews;
    }
  }

  // ---------------------------------------------------------------- keep memory bounded on long runs

  function compactState(date) {
    const s = st();
    const keep = Date.parse(date) - sim.memory.keep_order_days * DAY;
    const liveNums = new Set(live.map((l) => l.o.number));
    s.orders = s.orders.filter((x) => Date.parse(x.placed_at) >= keep || liveNums.has(x.number) || !["delivered", "cancelled", "payment_failed"].includes(x.status));
    const lk = Date.parse(date) - 40 * DAY;
    const drop = s.ledger.findIndex((e) => Date.parse(e.at) >= lk);
    if (drop > 0 && drop < ledgerCursor) { s.ledger.splice(0, drop); ledgerCursor -= drop; }
    if (s.audit.length > sim.memory.keep_audit) s.audit.splice(0, s.audit.length - sim.memory.keep_audit);
    s.stock_movements = s.stock_movements.filter((m) => Date.parse(m.at) >= lk);
    s.cases = s.cases.filter((c) => !["resolved", "closed"].includes(c.status) || Date.parse(c.opened_at) >= keep);
    s.returns = s.returns.filter((r) => !["refunded", "closed", "rejected"].includes(r.status) || Date.parse(r.created_at || date) >= keep);
    s.purchase_orders = s.purchase_orders.filter((p) => ["ordered", "late", "draft", "awaiting_approval"].includes(p.status) || Date.parse(p.ordered_at) >= keep);
    s.contacts.splice(0, Math.max(0, s.contacts.length - 300));
    s.reviews.splice(0, Math.max(0, s.reviews.length - 300));
    s.web_sessions_daily.splice(0, Math.max(0, s.web_sessions_daily.length - 120));
    if (s.outreach.length > 2000) { const cut = s.outreach.length - 1000; s.outreach.splice(0, cut); outreachCursor -= cut; }
    if (s.conversations.length > 500) s.conversations.splice(0, s.conversations.length - 500);
  }

  // ============================================================ results and saving

  /** Totals so far, in the shape runOnce returns (after any warm-up). */
  function totals() {
    const final = snapT ? subtract(T, snapT) : { ...T };
    const h = hist.slice();
    if (snapHist) for (let i = 0; i < HIST; i++) h[i] -= snapHist[i];
    const tot = h.reduce((a, b) => a + b, 0);
    const frtQ = (p) => { if (!tot) return null; let acc = 0; for (let i = 0; i < HIST; i++) { acc += h[i]; if (acc >= tot * p) return binMid(i); } return null; };
    const pts = curve.pts;
    return {
      totals: final, first_response_median_minutes: frtQ(0.5), first_response_p90_minutes: frtQ(0.9), reputation: round2(rep),
      curve: { stride: curve.stride, points: Object.fromEntries(Object.keys(pts).map((k) => [k, pts[k].slice()])) },
      moments: { good: good.items.slice(), bad: bad.items.slice() }, days_run: day, warmup_days: Math.min(warmup, day),
      survival: { opening_cash: round2(openingCash), cash_now: round2(openingCash + T.cash_flow), lowest_cash: round2(cashLow), ran_out_of_cash: cashLow < 0 },
      ...(richState ? { customers: richState.summary() } : {}),
    };
  }

  /**
   * Everything the simulator knows that is not in the world's state, as plain JSON. Records the sim shares with the
   * world (recent orders, the customers it shops as) are saved by number and position and linked again on restore.
   */
  function snapshot() {
    const popIndex = new Map(pop.map((c, i) => [c, i]));
    const recs = [], recIndex = new Map();
    const recId = (rec) => {
      if (!rec) return null;
      if (!recIndex.has(rec)) { recIndex.set(rec, recs.length); const { o: ord, ...rest } = rec; recs.push({ ...rest, o: ord.number }); }
      return recIndex.get(rec);
    };
    const liveIdx = live.map(recId);
    const backlogOut = backlog.map(({ rec, customer, ...rest }) => ({ ...rest, rec: recId(rec), customer: customer ? popIndex.get(customer) : null }));
    return structuredCopy({
      version: SNAPSHOT_VERSION,
      opts: { seed, popSeed, role, scale, customers: wantCustomers, warmup, compact, openingStock, customerModel },
      day, demandSeed0, rep, rep0, itemSeq, ledgerCursor, outreachCursor,
      pop, recs, live: liveIdx, backlog: backlogOut,
      pstate: [...pstate].map(([id, ps]) => { const { cust, ...rest } = ps; return [id, { ...rest, cust: cust ? popIndex.get(cust) : null }]; }),
      events, staffSent: [...staffSent], sold, soldWin, delayed,
      T, hist: Array.from(hist), snapT, snapHist: snapHist ? Array.from(snapHist) : null,
      curve: curve.save(), good: good.items, bad: bad.items, cum: { cumGP, cumTaskCost, cumNet, cumRev, curveDay },
      last_advance: lastAdv, dirty_from: world.dirtyFrom ?? null, opening, socialCursor, emailCursor, cashLow, openingCash,
      rich: richState ? richState.save() : null,
    });
  }

  function loadSnapshot(sn) {
    const s = structuredCopy(sn);
    ({ day, demandSeed0, rep, rep0, itemSeq, ledgerCursor, outreachCursor, events, sold, soldWin, delayed, T, snapT } = s);
    pop = s.pop;
    byId = new Map(pop.filter((c) => c.id).map((c) => [c.id, c]));
    const orders = new Map(st().orders.map((x) => [x.number, x]));
    const recs = s.recs.map((r) => ({ ...r, o: orders.get(r.o) }));
    live = s.live.map((i) => recs[i]).filter((r) => r.o);
    backlog = s.backlog.map((it) => ({ ...it, rec: it.rec === null ? null : recs[it.rec], customer: it.customer === null ? null : pop[it.customer] }))
      .filter((it) => !it.rec || it.rec.o);
    for (const it of backlog) if (it.toolFirstResponse === null) it.toolFirstResponse = undefined;
    pstate = new Map(s.pstate.map(([id, ps]) => { const { cust, ...rest } = ps; return [id, cust === null ? rest : { ...rest, cust: pop[cust] }]; }));
    staffSent = new Set(s.staffSent);
    hist = Int32Array.from(s.hist);
    snapHist = s.snapHist ? Int32Array.from(s.snapHist) : null;
    curve = makeCurve(s.curve);
    good = topK(6, (m) => m.value); bad = topK(6, (m) => -m.value);
    for (const x of s.good) good.add(x);
    for (const x of s.bad) bad.add(x);
    ({ cumGP, cumTaskCost, cumNet, cumRev, curveDay } = s.cum);
    lastAdv = s.last_advance;
    opening = s.opening || [];
    socialCursor = s.socialCursor ?? (st().social_posts || []).length; emailCursor = s.emailCursor ?? (st().emails || []).length;
    cashLow = s.cashLow ?? 0; openingCash = s.openingCash ?? 0;
    if (rich) richState = makeRich({ pop, cfg: sim.customer_model, kindWeight: cfgD.customer_kind_weight, popSeed, lambda0, saved: s.rich });
  }
}
