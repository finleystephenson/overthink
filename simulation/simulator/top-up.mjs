// Basket top-up: a shopper a little short of the free-delivery threshold sometimes adds one more thing to reach it.
//
// Rule: only for standard delivery, only when that method has a charge and a free-over threshold, and only when the
// basket is already at least `near_share` of the threshold. Then, with chance `rate`, the shopper adds one thing in
// stock that closes the gap (see fillerFor). Rates: business/data/sim.json demand.basket_top_up.
//
// Evidence and assumption: shopper surveys (UPS and comScore's "Pulse of the Online Shopper", 2012 to 2015, quoted
// from memory and not checked here) found about half of online shoppers say they have added items to reach free
// shipping. That is "ever done it", not a rate per basket, so the chance per near-threshold basket (0.3) is an
// assumption chosen below that share.
//
// WHY its own random stream: the top-up draw must not move any other draw of the day, so a run where the threshold
// changes differs only in the baskets that really changed.

/**
 * Stock needed for a product to be offered as a top-up: at least TOP_UP_MIN_STOCK units, and enough to cover its
 * supplier's lead time, the safety days and TOP_UP_COVER_DAYS more of its usual sales (simulation/simulator/core.mjs plentyForTopUp).
 * WHY: shops suggest "add this for free delivery" items they have plenty of; a filler should not take the units a
 * shopper who came for that product needs before the next delivery.
 */
export const TOP_UP_MIN_STOCK = 10;
export const TOP_UP_COVER_DAYS = 14;

/** Products that cannot go by standard delivery (chilled food, live plants): never used to top up. */
const NOT_STANDARD = new Set(["emergency-sandwich", "ice-by-post", "pocket-jungle"]);

/**
 * The basket after a possible top-up.
 * @param {Array<{sku: string, qty: number}>} items The basket.
 * @param {object} o
 * @param {string} o.method The delivery method chosen ("standard", "next-day", "chilled").
 * @param {Array<object>} o.methods The shop's delivery methods today (business.delivery.methods).
 * @param {function(string): number} o.priceOf Today's price of a sku.
 * @param {Array<object>} o.products Products on sale (with variants).
 * @param {function(string): boolean} o.inStock Whether a sku can be sold now.
 * @param {{rate: number, near_share: number}} o.cfg business/data/sim.json demand.basket_top_up.
 * @param {function(object): number=} o.weightOf How popular a product is (default 1 each).
 * @param {{next: function(): number}} o.r The top-up random stream (keyed by the order).
 * @return {{items: Array<{sku: string, qty: number}>, added: ?string}}
 */
export function topUpBasket(items, { method, methods, priceOf, products, inStock, cfg, r, weightOf = () => 1 }) {
  const none = { items, added: null };
  if (!cfg || !(cfg.rate > 0) || method !== "standard") return none;
  const std = (methods || []).find((m) => m.id === "standard");
  if (!std || std.free_over == null || !(std.price > 0)) return none;
  const subtotal = items.reduce((n, l) => n + l.qty * priceOf(l.sku), 0);
  const gap = std.free_over - subtotal;
  if (gap <= 0 || subtotal < std.free_over * cfg.near_share || r.next() >= cfg.rate) return none;
  const pick = fillerFor(gap, { priceOf, products, inStock, weightOf, u: r.next(), skip: new Set(items.map((l) => l.sku)) });
  return pick ? { items: [...items, { sku: pick, qty: 1 }], added: pick } : none;
}

/** Room above the gap a shopper accepts for a filler (£). An assumption: nobody spends £30 to save £3.95. */
const FILLER_ROOM = 10;

/**
 * A sku in stock priced from the gap to FILLER_ROOM over it, picked by popularity with draw u; failing that, the
 * cheapest that closes the gap (ties by sku). WHY by popularity: always the cheapest would empty one shelf.
 */
function fillerFor(gap, { priceOf, products, inStock, weightOf, u, skip }) {
  const near = [];
  let cheapest = null, cheapestPrice = Infinity;
  for (const p of products) {
    if (NOT_STANDARD.has(p.id)) continue;
    for (const v of p.variants || []) {
      if (skip.has(v.sku) || !inStock(v.sku)) continue;
      const price = priceOf(v.sku);
      if (price < gap) continue;
      if (price <= gap + FILLER_ROOM) near.push([v.sku, weightOf(p) / p.variants.length]);
      if (price < cheapestPrice || (price === cheapestPrice && v.sku < cheapest)) { cheapest = v.sku; cheapestPrice = price; }
    }
  }
  const total = near.reduce((n, [, w]) => n + w, 0);
  if (!(total > 0)) return cheapest;
  let x = u * total;
  for (const [sku, w] of near) { x -= w; if (x < 0) return sku; }
  return near.at(-1)[0];
}
