// Builds the whole company: node business/builder/build-world.mjs --size standard --seed 1
// Sizes are scales of one business: scale 1 is the business business/data/sim.json and business/data/staff.json describe
// (about 42 orders a day in November 2026 with the full team of 11). Same size, seed and options always give
// the same files, byte for byte.
//
// Options:
//   --size demo|standard|large   which scale (see SIZES)
//   --scale N                    any other scale
//   --seed N                     random seed (default 1)
//   --stories                    lay the hand-written stories over the world (for the benchmark); written to
//                                business/data/world-bench/<size>/ instead of business/data/world/<size>/
//   --no-events                  no world events (for comparing against a world with them)
//   --out DIR                    write the world folder here instead
//   --write-seed                 with --size demo --stories: also rewrite business/data/seed (the public shop's records).
//                                Off by default: the shop is finished and builds from business/data/seed as it is.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { planted as storiesPlanted } from "./world/stories.mjs";
import { DAY, START, dateOf, iso, parse, round2, tradingDays, SIM_DEMAND } from "./world/calendar.mjs";
import { loadCatalogue, buildSuppliers, priceHistory, unitCost, LAUNCH } from "./world/catalogue.mjs";
import { makeCustomers, plantedHistory } from "./world/customers.mjs";
import { planCampaigns, finishCampaigns, webSessions } from "./world/marketing.mjs";
import { simulateWithPins } from "./world/simulate.mjs";
import { orderRecord, returnRecords, batchFinder, afterCare, contactsAndCases, plantedContacts, makeReviews, numberFrom } from "./world/aftersales.mjs";
import { buildLedger, addRunningCosts, staffingByMonth, joinDatesFromVolume, finishLedger, monthlySummary, openingCash } from "./world/money.mjs";
import { buildDocuments, buildCompany } from "./world/documents.mjs";
import { makeEffects } from "./world/effects.mjs";
import { buildEventHistory, loadEventLibrary } from "./world/events.mjs";
import { deriveComms } from "./world/comms.mjs";
import { loadCommsData } from "./world/comms-data.mjs";
import { PLANTED } from "./world/characters.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
/**
 * Scale of each named size. Chosen by measurement (see docs/data-model.md): demo fits in a web browser,
 * standard keeps the files and the engine quick, large is the full-size business.
 */
export const SIZES = { demo: 0.02, standard: 0.2, large: 1 };
/**
 * Days of mail, chat and social kept in each size (null: the whole history).
 * WHY: messages come from the calendar as well as from orders, so even a tiny world has five years of them;
 * the demo keeps its last three months so the whole world loads in a web browser.
 */
export const COMMS_DAYS = { demo: 92, standard: null, large: null };
/** Seed-file collections the website reads, in their existing shapes. */
export const SEED_COLLECTIONS = ["customers", "orders", "returns", "repairs", "registrations", "cases", "conversations", "bookings"];

/** A world with no stories: nothing planted, nothing pinned. */
const NO_STORIES = {
  customers: [], orders: [], returns: [], registrations: [], repairs: [], bookings: [], cases: [], conversations: [],
  storyRows: [], pins: [], blipWaiting: [], weekly: { orders: [] }, doubleRefund: null, counts: [], contacts: [], boomboxBatchOrder: null,
};

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const readIfThere = (rel, parseJson = true) => {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  return parseJson ? JSON.parse(text) : text;
};

/** The company history files, if they have been written yet. */
function loadHistory() {
  return { timeline: readIfThere("business/data/history/timeline.json"), story: readIfThere("business/data/history/story.md", false), staff: readIfThere("business/data/history/staff-history.json") };
}

/**
 * Units of each shelf product the simulator wants on day one: ops.opening_cover_days of its expected demand,
 * worked out exactly as simulation/simulator/core.mjs expectedSales does (base orders a day x scale, split by product weight).
 */
function openingCover(cat, scale) {
  const ops = readJson("business/data/sim.json").ops;
  const live = cat.products.filter((p) => !p.discontinued && (p.status ?? "active") === "active");
  const wsum = live.reduce((n, p) => n + (SIM_DEMAND.product_weights[p.id] || 0), 0);
  const out = {};
  for (const p of live) {
    const per = SIM_DEMAND.base_orders_per_day * scale * (SIM_DEMAND.product_weights[p.id] || 0) / wsum * (1 + SIM_DEMAND.second_product_chance);
    for (const v of p.variants) out[v.sku] = Math.ceil(per / p.variants.length * ops.opening_cover_days);
    for (const a of p.accessories || []) out[a.sku] = Math.ceil(per * SIM_DEMAND.accessory_chance / p.accessories.length * ops.opening_cover_days);
  }
  return out;
}

/** The team in force on the last day of history, with hours scaled to the world. */
function staffingNow(staff, joined, scale, now) {
  return staff.filter((p) => parse(joined[p.id] || "2021-11-22") <= now)
    .map((p) => ({ id: p.id, name: p.name, role: p.role, joined: joined[p.id] || null, weekly_hours: round2(p.weekly_hours * scale), hourly_pay: p.hourly_pay }));
}

/**
 * Builds every collection in memory. Pure apart from reading business/data/.
 * @param {{size?: string, seed?: number, scale?: number, stories?: boolean, events?: boolean, comms?: boolean}} opts
 * @returns {{world: object, facts: object, stories: (string|null)}}
 */
export function buildWorld({ size = "standard", seed = 1, scale = SIZES[size], stories = false, events = true, comms = true, commsDays = COMMS_DAYS[size] ?? null } = {}) {
  const cat = loadCatalogue(ROOT);
  const now = parse(cat.business.sim.anchor_now);
  const costs = readJson("business/data/costs.json");
  const staffData = readJson("business/data/staff.json");
  const history = loadHistory();
  // Joining dates follow the orders; the order people joined in, and the founder's date, come from the history.
  const story = history.staff?.staff || [];
  const order = story.length ? [...story].sort((a, b) => a.joined.localeCompare(b.joined)).map((p) => p.id) : staffData.staff.map((p) => p.id);
  const joined = joinDatesFromVolume(staffData.staff, order, story.find((p) => p.id === order[0])?.joined || "2021-11-22", now);
  const planted = stories ? storiesPlanted : NO_STORIES;

  // World events first: they shape demand, deliveries and contacts in everything that follows.
  const library = loadEventLibrary();
  const products = cat.products.map((p) => ({ id: p.id, name: p.name, launched: LAUNCH[p.id] }));
  const eventRecords = events ? buildEventHistory(library, { seed, from: dateOf(START), to: dateOf(now), products }) : { world_events: [], news: [] };
  const effects = makeEffects(eventRecords.world_events);

  const campaignPlan = planCampaigns(scale, now, costs);
  const suppliers = buildSuppliers(cat.skus, scale);
  // WHY: staff never appear as customers; with stories on, the story customers keep their own characters.
  const exclude = { firstPass: new Set(stories ? PLANTED : []), always: new Set(staffData.staff.map((p) => p.name)) };
  const gen = makeCustomers({ seed, scale, now, cat, campaigns: campaignPlan, effects, firstNumber: stories ? 1001 + planted.customers.length : 1001, exclude });
  const intents = [...gen.intents, ...(stories ? plantedHistory({ seed, planted, now, cat, campaigns: campaignPlan }) : [])];
  const people = [...planted.customers.map((c) => ({ ...c })), ...gen.customers];
  const townOf = Object.fromEntries(people.map((c) => [c.id, c.addresses[0].town]));
  const sim = simulateWithPins({ seed, cat, suppliers, intents, planted, now, campaigns: campaignPlan, effects, townOf, openingCover: openingCover(cat, scale) });
  // Purchase orders, numbered in the order they were raised.
  sim.pos.sort((a, b) => a.ordered_at - b.ordered_at || a.supplier_id.localeCompare(b.supplier_id));
  sim.pos.forEach((po, i) => (po.number = "PO-" + (3001 + i)));
  sim.counts.sort((a, b) => a.at - b.at || a.sku.localeCompare(b.sku));
  sim.counts.forEach((c, i) => (c.id = "SC-" + String(i + 1).padStart(4, "0")));

  // Orders as records at "now".
  const byId = Object.fromEntries(people.map((c) => [c.id, c]));
  const track = { next: 600000 };
  const records = new Map(sim.orders.map((o) => [o.number, orderRecord(o, now, cat, byId[o.customer_id], track)]));
  const genReturns = returnRecords(sim.orders, records, now, cat.business, numberFrom("RET", 3101));
  const returnsByOrder = new Map(genReturns.map((r) => [r.order_number, r]));
  for (const r of records.values()) r.history.sort((a, b) => a.at.localeCompare(b.at));

  // Registrations, repairs and the bad Boombox batch.
  const batchOf = batchFinder(sim.pos);
  const plantedOrder = (n) => planted.orders.find((o) => o.number === n);
  const badBatch = stories ? batchOf("OT-BOOM", parse(plantedOrder(planted.boomboxBatchOrder).placed_at)) : null;
  const care = afterCare({ seed, simOrders: sim.orders, records, now, cat, batchOf, badBatch, nextReg: numberFrom("REG", 6101), nextFix: numberFrom("FIX", 5101) });

  // Contacts, cases, conversations.
  const talk = contactsAndCases({ seed, simOrders: sim.orders, records, returnsByOrder, customers: gen.customers, now, nextCase: numberFrom("CASE", 9101), nextConv: numberFrom("CONV", 8101), effects });
  const contacts = [...talk.contacts, ...(stories ? plantedContacts(planted) : [])].sort((a, b) => a.at - b.at || String(a.customer_id).localeCompare(String(b.customer_id)))
    .map((c, i) => ({ id: "CT-" + String(i + 1).padStart(5, "0"), ...c, at: iso(c.at), summary: c.summary || null }));
  const goodwill = talk.goodwill.map((g, i) => ({ ...g, reference: talk.cases.find((k) => k.customer_id === g.customer_id && k.notes.some((n) => n.text.includes("goodwill") && Math.abs(parse(n.at) - g.at) < 60000))?.number || "GOODWILL" }));
  for (const g of goodwill) byId[g.customer_id].credit_balance = round2(byId[g.customer_id].credit_balance + g.amount);
  if (stories) {
    const barnaby = planted.cases.find((k) => k.customer_id === "C-1030");
    goodwill.push({ at: parse(barnaby.notes[0].at), customer_id: "C-1030", amount: 10, reference: barnaby.number });
  }

  // Every order, planted and generated.
  const orders = [...planted.orders, ...records.values()].sort((a, b) => a.placed_at.localeCompare(b.placed_at) || a.number.localeCompare(b.number));
  const returns = [...planted.returns, ...genReturns];

  // Refunds: generated ones from the plans, planted ones from the planted records, and the planted double refund.
  const refunds = sim.orders.flatMap((o) => o.refunds || []);
  for (const o of planted.orders) {
    if (o.status !== "cancelled" || o.payment.status !== "refunded") continue;
    const ev = o.history.find((h) => /cancel/i.test(h.event));
    refunds.push({ at: parse(ev.at), amount: o.payment.refunded, reference: o.number });
  }
  for (const r of planted.returns) {
    if (r.status !== "refunded") continue;
    refunds.push({ at: parse(r.refunded_at), amount: r.refund_amount, reference: r.number });
    if (r.number === planted.doubleRefund) refunds.push({ at: parse(r.refunded_at) + DAY, amount: r.refund_amount, reference: r.number });
  }

  // Stock movements with plain references.
  const movements = sim.movements.map((m) => ({ ...m, reference: typeof m.reference === "object" ? (m.reference.number || m.reference.id) : m.reference }))
    .sort((a, b) => a.at - b.at || a.sku.localeCompare(b.sku));
  const unit = Object.fromEntries(Object.values(cat.skus).map((s) => [s.sku, unitCost(s)]));
  const rows = buildLedger({ orders, refunds, movements, pos: sim.pos, suppliers, campaigns: campaignPlan, goodwill, unitCost: unit, now });
  const staffing = staffingByMonth({ staff: staffData.staff, joined, costs, scale, now });
  addRunningCosts(rows, { staffing, costs, scale, now });
  const ledger = finishLedger(rows);
  const opening = openingCash(scale, ledger);
  const summary = monthlySummary(ledger, orders, opening);

  const poRecords = sim.pos.map((po) => {
    const received = po.receivedAt && po.receivedAt <= now;
    const status = po.forced ? po.forced : po.cancelAt && po.cancelAt <= now ? "cancelled" : received ? (po.lines.some((l) => l.qty_received < l.qty) ? "part_received" : "received") : po.due_at < now ? "late" : "ordered";
    const pin = planted.pins.find((p) => po.forced && p.sku === po.lines[0].sku);
    return { number: po.number, supplier_id: po.supplier_id, lines: po.lines.map((l) => ({ sku: l.sku, qty: l.qty, unit_cost: l.unit_cost, qty_received: received ? l.qty_received : 0 })),
      ordered_at: iso(po.ordered_at), due_at: dateOf(po.due_at), expected_at: pin?.po.expected_at || null, received_at: received ? iso(po.receivedAt) : null, status, paid_at: po.paid_at || null, note: po.note };
  });
  const stock = Object.fromEntries(Object.keys(cat.skus).sort().map((sku) => {
    const on = sim.stock[sku].on_hand;
    const open = poRecords.filter((p) => ["ordered", "late"].includes(p.status) && p.lines.some((l) => l.sku === sku)).map((p) => p.expected_at || p.due_at).sort()[0] || null;
    return [sku, { on_hand: on, restock_date: on > 0 ? null : open }];
  }));

  const blipPO = poRecords.find((p) => p.status === "late" && p.lines[0].sku === "OT-BLIP")?.number;
  const trophyPO = poRecords.find((p) => p.lines[0].sku === "OT-TROF" && p.note.startsWith("Christmas"))?.number;
  const typeOf = Object.fromEntries(gen.customers.map((c) => [c.id, c._type]));
  const company = {
    ...buildCompany(cat, scale, opening),
    // One scale for history and simulator: scale 1 is the business in business/data/sim.json and business/data/staff.json.
    scale, orders_per_day_now: round2(SIM_DEMAND.base_orders_per_day * scale),
    staffing_now: staffingNow(staffData.staff, joined, scale, now),
    staffing_by_month: staffing.map((m) => ({ month: m.month, wages: m.wages, hours_share: round2(m.hours_share) })),
    stories, events,
  };
  const world = {
    company,
    customers: people.map(({ _type, ...c }) => c).sort((a, b) => a.id.localeCompare(b.id)),
    orders, returns,
    repairs: [...planted.repairs, ...care.repairs],
    registrations: [...planted.registrations, ...care.registrations.map(({ _at, ...r }) => r)],
    cases: [...planted.cases, ...talk.cases].sort((a, b) => a.number.localeCompare(b.number, "en", { numeric: true })),
    conversations: [...planted.conversations, ...talk.conversations],
    bookings: [],
    suppliers, purchase_orders: poRecords,
    stock_movements: movements.map((m, i) => ({ id: "MV-" + String(i + 1).padStart(6, "0"), at: iso(m.at), sku: m.sku, qty: m.qty, reason: m.reason, reference: m.reference })),
    stock_counts: sim.counts.map((c) => ({ id: c.id, at: iso(c.at), sku: c.sku, system_qty: c.system_qty, counted_qty: c.counted_qty, difference: c.difference, adjusted: c.adjusted, note: c.note })),
    stock, ledger, monthly_summary: summary,
    campaigns: finishCampaigns(seed, campaignPlan, orders),
    web_sessions_daily: webSessions(seed, tradingDays(now), orders, sim.lostByDay, cat),
    contacts,
    documents: buildDocuments({ cat, suppliers, blipPO, trophyPO, badBatch: badBatch?.number, stories, history }),
    price_history: priceHistory(cat.skus),
    // The prospect market (business/data/prospects.json) and an empty outreach log: businesses that only buy if approached.
    prospects: JSON.parse(fs.readFileSync(path.join(ROOT, "business/data/prospects.json"), "utf8")),
    outreach: [],
    reviews: makeReviews({ seed, simOrders: sim.orders, records, returnsByOrder, cat, typeOf, now, nextReview: numberFrom("REV", 1) }),
    world_events: eventRecords.world_events,
    news: eventRecords.news,
  };
  // Mail, chat and social, derived from the finished records for the whole history in one call.
  const commsFrom = commsDays ? dateOf(now - commsDays * DAY) : dateOf(START);
  if (comms) Object.assign(world, deriveComms({ ...world, now: iso(now) }, { from: commsFrom, to: dateOf(now), seed, data: loadCommsData(path.join(ROOT, "business", "data")) }));
  const facts = { blipPO, trophyPO, badBatch: badBatch?.number || null, lostUnits: sim.lostUnits, warnings: sim.warnings, pinReport: Object.fromEntries(Object.entries(sim.pinReport).map(([k, v]) => [k, { left: v.left, at_now: v.atNow }])) };
  return { world, facts, stories: stories ? storiesMarkdown(world, facts, size, planted) : null };
}

function storiesMarkdown(w, facts, size, planted) {
  const ledgerIds = w.ledger.filter((e) => e.reference === planted.doubleRefund && e.type === "refund").map((e) => e.id).join(", ");
  const count = w.stock_counts.find((c) => c.sku === "OT-BISC-24" && c.difference === -4 && !c.adjusted);
  const priceDoc = w.documents.find((d) => d.checks.some((c) => c.planted));
  const missed = w.contacts.find((c) => c.outcome === "not_actioned");
  const batchRepairs = w.repairs.filter((r) => r.batch && r.batch === facts.badBatch && r.fault === "Will not charge").map((r) => r.number);
  const weekly = planted.weekly.orders;
  const rows = [
    ...planted.storyRows,
    ["30", "A supplier is late with Blip stock; 6 paid orders are waiting on it", "C-1017, C-1031, C-1001, C-1032, C-1019, C-1020", `${facts.blipPO} (late, due 16 Nov, now expected 30 Nov); ${planted.blipWaiting.join(", ")}`],
    ["31", "A stock count found 4 fewer Biscuit Tins than the system says (not adjusted yet)", "none", count ? `${count.id} on ${count.at.slice(0, 10)}` : "count missing"],
    ["32", "An internal price list says the Daypack is £119; the catalogue says £129", "none", priceDoc ? `${priceDoc.id} "${priceDoc.title}"` : "missing"],
    ["33", "A customer was refunded twice for one return (a ledger error to be found)", "C-1016", `${planted.doubleRefund}; ledger ${ledgerIds}`],
    ["34", "A regular business customer's weekly sandwich order was missed last week", "C-1022", `${weekly[0]} to ${weekly[weekly.length - 1]} (every Monday); no order for 16 Nov; ${missed?.id} (email read, not actioned)`],
    ["35", "Boombox Mini: a spike in \"won't charge\" repairs from one supplier batch", "several", `batch ${facts.badBatch}; ${batchRepairs.length} repairs in this world${batchRepairs.length ? ": " + batchRepairs.slice(0, 8).join(", ") + (batchRepairs.length > 8 ? ", …" : "") : ""}; Jonah's ${planted.boomboxBatchOrder} (story 13) came from it`],
  ];
  let md = `# Planted stories (${size} world)\n\nSimulated now: 2026-11-23T10:00:00Z (Monday). Built by \`business/builder/build-world.mjs\`; the hand-written stories live in \`business/builder/world/stories.mjs\` and keep the same customer ids and record numbers in every size.\n\n| # | Story | Customer | Records |\n|---|---|---|---|\n`;
  for (const [n, t, c, r] of rows) md += `| ${n} | ${t} | ${c} | ${r} |\n`;
  md += `
## Deliberate quirks
- Stories 15, 16, 17 and 29 were about bookings. Services are hidden, so the world has no bookings and those stories are left out for now.
- Story 11: chilled parcels are dispatched Monday to Thursday, but the Ice by Post parcel missed its Friday delivery and was re-delivered today (shipment note explains it).
- Story 12: \`in_warranty\` is false on the Blip screen repair even though the Blip is inside 24 months, because accidental damage is excluded.
- Story 20: the Trophy is empty until ${facts.trophyPO} arrives on 7 Dec.
- Story 28: the plant arrived on a Saturday, a day late (shipment note); dispatch was Thursday.
- Story 4: the order status is \`dispatched\` while one of its two shipments is delivered; chilled charge £8.95 is the only delivery charge.
- Story 5: shipment \`note\` records that OT-PEN-REFILL was never packed; order status stays \`delivered\`.
- Orders may carry an optional \`note\` (story 23) and \`discount_code\`. Shipments may carry an optional \`note\`. Tech repairs carry \`batch\` (the purchase order the unit came from).
- Delivery area: HI postcodes (Highlands) are only on C-1033 and C-1034.
- Planted orders keep their numbers (ORD-20101 to ORD-20188), so they are not in date order with the generated orders (ORD-10001 upwards).
- Documents marked \`out_of_date\` contradict current records on purpose; each lists what it contradicts in \`checks\`.
`;
  return md;
}

const json = (v) => JSON.stringify(v, null, 2) + "\n";

function writeWorld(dir, world, stories) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(world)) fs.writeFileSync(path.join(dir, name + ".json"), json(value));
  if (stories) fs.writeFileSync(path.join(dir, "STORIES.md"), stories);
}

/** Total size of the JSON files in a folder, in MB. */
const folderMb = (dir) => round2(fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0) / 1e6);

function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : fallback; };
  const size = flag("size", "standard");
  if (!SIZES[size] && !flag("scale")) throw new Error(`Unknown size ${size}. Use demo, standard or large, or --scale N.`);
  const seed = Number(flag("seed", 1));
  const scale = Number(flag("scale", SIZES[size]));
  const stories = args.includes("--stories");
  const events = !args.includes("--no-events");
  const started = performance.now();
  const { world, facts, stories: storiesMd } = buildWorld({ size, seed, scale, stories, events });
  const out = flag("out", null);
  const dir = out ? path.resolve(out) : path.join(ROOT, stories ? "business/data/world-bench" : "business/data/world", size);
  writeWorld(dir, world, storiesMd);
  if (args.includes("--write-seed") && !out && stories && size === "demo") {
    // The website still reads business/data/seed; keep it in step with the demo story world.
    const seedDir = path.join(ROOT, "business/data/seed");
    for (const name of SEED_COLLECTIONS) fs.writeFileSync(path.join(seedDir, name + ".json"), json(world[name]));
    fs.writeFileSync(path.join(seedDir, "STORIES.md"), storiesMd);
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const counts = Object.fromEntries(Object.entries(world).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]));
  console.log(JSON.stringify({ size, seed, scale, stories, events, dir, seconds, mb: folderMb(dir), counts, pins_left: facts.pinReport, warnings: facts.warnings.length }, null, 1));
  for (const w of facts.warnings.slice(0, 10)) console.log("warning:", w);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
