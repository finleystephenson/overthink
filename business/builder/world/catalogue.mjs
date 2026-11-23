// What the company sells and who it buys from. Prices and rules come from business/data/; the
// launch dates, cost ratios and suppliers below are the generator's own invented history.
import fs from "node:fs";
import path from "node:path";
import { parse, round2 } from "./calendar.mjs";

export function loadCatalogue(root) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
  const business = read("business/data/business.json");
  const products = fs.readdirSync(path.join(root, "business/data/products")).sort().map((f) => read("business/data/products/" + f));
  const skus = {};
  for (const p of products) {
    for (const v of [...(p.variants || []), ...(p.accessories || [])]) {
      skus[v.sku] = {
        sku: v.sku, product: p.id, name: `${p.name}, ${v.name}`, short: p.name, price: v.price,
        category: p.category, accessory: !(p.variants || []).includes(v),
        chilled: (p.delivery?.methods || []).length === 1 && p.delivery.methods[0] === "chilled",
        plant: p.id === "pocket-jungle" && !(p.accessories || []).includes(v),
        warranty: p.warranty?.months ?? 12, fixable: business.fix_club.eligible_products.includes(p.id),
        launched: LAUNCH[p.id],
      };
    }
  }
  for (const s of Object.values(skus)) if (!s.launched) throw new Error(`No launch date for ${s.product}`);
  return { business, products, skus, byProduct: Object.fromEntries(products.map((p) => [p.id, p])) };
}

/**
 * When each product went on sale. The sandwich, sock and paper aeroplane were first;
 * Blip came in year three; the newest four arrived in the last six months.
 */
export const LAUNCH = {
  "emergency-sandwich": "2021-11-22", "spare-sock": "2021-11-22", "paper-aeroplane": "2021-11-22",
  "one-good-pen": "2022-02-07", "bubble-wrap": "2022-04-04", "other-umbrella": "2022-09-05",
  "daypack": "2023-02-06", "ice-by-post": "2023-05-02", "indoor-helmet": "2023-09-04", "trophy": "2023-11-06",
  "blip": "2024-03-04", "boombox-mini": "2025-03-03",
  "pocket-jungle": "2026-06-01", "skimming-stones": "2026-06-15", "starter-puddle": "2026-08-03", "biscuit-tin": "2026-09-07",
};

/** Made to order: the bakery and the ice supplier deliver each morning exactly what was sold. No shelf stock. */
export const MADE_TO_ORDER = ["emergency-sandwich", "ice-by-post"];

/** The one price rise, in year three. WHY: costs rose and these three had not changed since launch. */
export const PRICE_RISE = { at: "2024-04-01", skus: ["OT-SOCK", "OT-PEN", "OT-UMBR"], ratio: 1 / 0.88, reason: "Supplier costs went up. First price change since launch." };

/** Price before the rise: today's price taken back 12% and rounded to whole pounds. */
export const oldPrice = (sku, skus) => Math.round(skus[sku].price * (1 / PRICE_RISE.ratio));

export function priceAt(sku, t, skus) {
  if (PRICE_RISE.skus.includes(sku) && t < parse(PRICE_RISE.at)) return oldPrice(sku, skus);
  return skus[sku].price;
}

export function priceHistory(skus) {
  return PRICE_RISE.skus.map((sku) => ({ sku, old_price: oldPrice(sku, skus), new_price: skus[sku].price, date: PRICE_RISE.at, reason: PRICE_RISE.reason }));
}

/**
 * Cost to buy one unit, as a share of today's price.
 * WHY: food and paper have thin margins; own-design goods are made cheaply in small UK workshops;
 * electronics carry the highest bought-in cost.
 */
const COST_SHARE = { food: 0.42, tech: 0.58, everyday: 0.38, "desk-home": 0.4, carry: 0.45, outdoors: 0.35 };
export const unitCost = (s) => round2(s.price * (COST_SHARE[s.category] ?? 0.4));

/** Invented UK suppliers. Lead times in days, minimum order in units per line, payment terms in days. */
const SUPPLIERS = [
  ["SUP-01", "Hollin Bakehouse", "Brookford", ["emergency-sandwich"], 1, 1, 14, 0.99, "Bakes to order. Our order goes in by 6pm; the van arrives before 8am on dispatch days."],
  ["SUP-02", "Coldharbour Ice Works", "Saltgrave", ["ice-by-post"], 1, 1, 14, 0.98, "Packs ice to order the morning it is sent."],
  ["SUP-03", "Beckside Mill", "Pennyfold", ["spare-sock", "indoor-helmet"], 14, 60, 30, 0.93, "Knits the sock and sews the helmet. Busy in autumn."],
  ["SUP-04", "Kestrel Paper & Pen", "Oldmarrow", ["one-good-pen", "paper-aeroplane", "bubble-wrap"], 10, 50, 30, 0.95, "Prints, folds and fills. Reliable."],
  ["SUP-05", "Marrowfield Devices", "Lower Wexcombe", ["blip"], 21, 20, 30, 0.72, "Assembles Blip and its accessories. Lead time went from 10 to 21 days in September 2026. Often late."],
  ["SUP-06", "Tidewater Audio", "Saltgrave", ["boombox-mini"], 28, 20, 45, 0.88, "Builds the Boombox Mini in batches."],
  ["SUP-07", "Ashgrove Workshop", "Thistlewick", ["trophy"], 28, 20, 30, 0.9, "Casts and finishes the Trophy. Long lead time before Christmas."],
  ["SUP-08", "Fellside Bags", "Brookford", ["daypack", "other-umbrella"], 21, 20, 30, 0.9, "Sews the Daypack and the umbrella canopy."],
  ["SUP-09", "Glasshouse Growers", "Pennyfold", ["pocket-jungle"], 7, 15, 30, 0.92, "Grows the plants and builds the domes."],
  ["SUP-10", "Riverstone Goods", "Thistlewick", ["skimming-stones", "starter-puddle"], 14, 30, 30, 0.92, "Sorts stones and casts puddles."],
  ["SUP-11", "Tinsmith & Oven", "Oldmarrow", ["biscuit-tin"], 7, 24, 30, 0.96, "Bakes and tins the shortbread."],
];

/**
 * Supplier records. Minimum orders shrink with the size of the world (scale = customers / 500),
 * so a small demo world does not hold years of stock. WHY a floor of 10: nobody makes fewer.
 */
export function buildSuppliers(skus, scale) {
  return SUPPLIERS.map(([id, name, town, products, lead, moq, terms, reliability, notes]) => {
    const list = Object.values(skus).filter((s) => products.includes(s.product));
    const minQty = moq === 1 ? 1 : Math.max(10, Math.round(moq * Math.min(scale, 4)));
    return {
      id, name, town, country: "United Kingdom", products, skus: list.map((s) => s.sku),
      lead_time_days: lead, min_order_qty: minQty, unit_cost: Object.fromEntries(list.map((s) => [s.sku, unitCost(s)])),
      payment_terms_days: terms, reliability, notes,
    };
  });
}
