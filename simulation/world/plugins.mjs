// The wider world as simulator plug-ins (shape: docs/environment-design.md, "Simulator plug-ins").
//
//   const plugins = worldPlugins({ products });   // seven plug-ins, in this order:
//   world-economy      monthly figures; confidence -> demand, inflation -> costs, jobs and rates -> price sensitivity
//   world-trends       weekly interest per category (and viral spikes); daily brand opinion -> visits
//   world-competitors  weekly rival decisions -> demand per category (attraction model in simulation/world/competitors.mjs)
//   world-suppliers    supplier capacity and disruptions -> purchase order due dates
//   world-supplier-side suppliers that write back: delay warnings, order queries, replies that can change an order
//   world-developments new rules, technology, labour market, council works -> the simulator's own keys
//   world-consumers    consumer behaviour shifts set in world_settings (price sensitivity, buying on the marketplace)
//
// Every modifiers() answer carries a `why` list ([{ source, effect, size, because }]) that simulation/simulator/core.mjs adds to the
// day's timeline line. Everything reads state.world_settings each day (the lab's only door into the wider world).
// Every chance uses rngFor keyed by date and organisation, so an untouched live world and its shadow stay identical.
// Browser-safe: the JSON is imported, not read from disk.
import { orgsFor } from "./organisations.mjs";
import { competitorEffects, competitorsAfterDay, clampCategories, productCompetition } from "./competitors.mjs";
import { economyAfterDay, economyEffects } from "./economy.mjs";
import { TREND_RULES, opinionAfterDay, opinionEffects, trendEffects, trendsAfterDay } from "./trends.mjs";
import { supplierWhy, suppliersAfterDay } from "./suppliers.mjs";
import { supplierSideAfterDay } from "./supplier-side.mjs";
import { developmentEffects, developmentsAfterDay } from "./developments.mjs";
import { activeSettings, clamp, percentWords, round } from "./common.mjs";
import { combineModifiers } from "../simulator/core.mjs";

/**
 * The wider world's plug-ins.
 * @param {{products?: Array<object>}=} opts The catalogue (business/data/products): lets rivals see Overthought's prices and
 *     launches by category. Without it rivals still run their calendars, launches and adverts but cannot react to prices.
 * @return {Array<object>} Plug-ins: { name, modifiers(ctx), afterDay(ctx) }, seven of them, in the order above.
 */
export function worldPlugins({ products = null } = {}) {
  const cats = products?.length ? [...new Set(products.map((p) => p.category))].sort() : TREND_RULES.categories;
  return [
    {
      name: "world-economy",
      modifiers: ({ state, date }) => economyEffects(state, date),
      afterDay: ({ state, date, seed }) => { economyAfterDay(state, date, seed); },
    },
    {
      name: "world-trends",
      modifiers({ state, date }) {
        const t = trendEffects(state, date, cats), o = opinionEffects(state, date);
        return { demand: { categories: t.categories }, visits: o.visits, why: [...t.why, ...o.why] };
      },
      afterDay: ({ state, date, seed }) => { trendsAfterDay(state, date, seed, cats); opinionAfterDay(state, date); },
    },
    {
      name: "world-competitors",
      modifiers({ state, date }) {
        const e = competitorEffects(orgsFor(state), state, date, cats);
        const p = productCompetition(orgsFor(state), state, date, products);
        return { demand: { categories: clampCategories(e.categories), products: p.products }, why: [...e.why, ...p.why] };
      },
      afterDay: ({ state, date, seed }) => { competitorsAfterDay(orgsFor(state), state, date, seed, products); },
    },
    {
      name: "world-suppliers",
      modifiers: ({ state, date }) => ({ why: supplierWhy(orgsFor(state).supplier_constraints, state, date) }),
      afterDay: ({ state, date, seed }) => { suppliersAfterDay(orgsFor(state).supplier_constraints, state, date, seed); },
    },
    {
      // Suppliers that write back (simulation/world/supplier-side.mjs): delay warnings, order queries, replies to the shop's mail.
      // WHY after world-suppliers: it explains the due dates that plug-in has just moved.
      name: "world-supplier-side",
      afterDay: ({ state, date, seed }) => { supplierSideAfterDay(orgsFor(state).supplier_constraints, state, date, seed, { products }); },
    },
    {
      name: "world-developments",
      // WHY combineModifiers: several developments can be in force at once; they multiply like plug-ins do.
      modifiers: ({ state, date }) => combineModifiers(developmentEffects(orgsFor(state), state, date)),
      afterDay: ({ state, date, seed }) => { developmentsAfterDay(orgsFor(state), state, date, seed); },
    },
    { name: "world-consumers", modifiers: ({ state, date }) => consumerEffects(state, date) },
  ];
}

/**
 * Consumer behaviour shifts from world_settings.consumer_shifts: a price_sensitivity factor, and marketplace_shift
 * (the share of the shop's buyers who now buy on The Great Bazaar instead of from shops' own websites).
 */
export function consumerEffects(state, date) {
  let sens = 1, stay = 1;
  for (const s of activeSettings(state, "consumer_shifts", date)) {
    if (typeof s.price_sensitivity === "number" && s.price_sensitivity > 0) sens *= s.price_sensitivity;
    if (typeof s.marketplace_shift === "number") stay *= 1 - clamp(s.marketplace_shift, 0, 0.9);
  }
  const why = [];
  if (sens !== 1) why.push({ source: "consumers", effect: `Shoppers ${sens > 1 ? "more" : "less"} sensitive to price (${percentWords(sens)})`, size: round(sens, 3), because: "A change in how people shop, set in the world settings." });
  if (stay !== 1) why.push({ source: "consumers", effect: `Overall demand ${percentWords(stay)}`, size: round(stay, 3), because: "Some shoppers now buy on The Great Bazaar marketplace instead of from shops' own websites (set in the world settings)." });
  return { price_sensitivity: sens, demand: { all: stay }, why };
}
