// The other organisations in the world: competitors, partners, institutions, and limits on the shop's suppliers.
// Definitions live in business/data/organisations.json. A world folder may carry its own copy (organisations.json, loaded by
// simulation/world/extension.js into state.organisations); when it does, that copy wins, so a world keeps the rivals it was built with.
import bundled from "../../business/data/organisations.json" with { type: "json" };

/** The bundled definitions (business/data/organisations.json). */
export const ORGANISATIONS = bundled;

/**
 * The organisation definitions a state should use: its own copy when the world folder had one, else the bundled file.
 * state.organisations is a list of every organisation plus one { id: "_market" } row and one { id: "_suppliers" } row.
 * @param {?object} state
 * @return {{ market: object, competitors: Array<object>, partners: Array<object>, institutions: Array<object>, supplier_constraints: object, developments: object }}
 */
export function orgsFor(state) {
  const list = state?.organisations;
  if (!Array.isArray(list) || !list.length) return bundled;
  return fromList(list);
}

/** Flattens the definitions into one list of records (what build-history writes to organisations.json). */
export function toList(defs = bundled) {
  return [
    { id: "_market", kind: "market rules", ...defs.market },
    { id: "_suppliers", kind: "supplier constraints", constraints: defs.supplier_constraints },
    { id: "_developments", kind: "possible developments", list: defs.developments?.list || [] },
    ...defs.competitors, ...defs.partners, ...defs.institutions,
  ];
}

function fromList(list) {
  const market = list.find((o) => o.id === "_market") || { ...bundled.market };
  const sup = list.find((o) => o.id === "_suppliers");
  const dev = list.find((o) => o.id === "_developments");
  const rest = list.filter((o) => !o.id.startsWith("_"));
  return {
    market,
    competitors: rest.filter((o) => o.kind === "competitor"),
    partners: rest.filter((o) => PARTNER_KINDS.includes(o.kind)),
    institutions: rest.filter((o) => o.kind !== "competitor" && !PARTNER_KINDS.includes(o.kind)),
    supplier_constraints: sup?.constraints || bundled.supplier_constraints,
    developments: dev ? { list: dev.list } : bundled.developments,
  };
}

const PARTNER_KINDS = ["carrier", "payment provider", "marketplace", "ad network"];

/** Fields of a competitor that only the world lens sees. WHY: a real shop cannot read a rival's playbook. */
const INTERNAL_FIELDS = ["strategy", "strategy_in_words", "rules", "weights", "ad_budget_per_month"];

/**
 * What anyone can know about an organisation. For a competitor: who they are, what they sell, and roughly how their
 * prices compare (anyone can look at their shop). Never their strategy, rules or budgets.
 * @param {object} org
 * @return {object}
 */
export function publicView(org) {
  const out = {};
  for (const [k, v] of Object.entries(org)) if (!INTERNAL_FIELDS.includes(k) && !k.startsWith("_")) out[k] = v;
  if (org.kind === "competitor") {
    delete out.price_position;
    out.prices_in_words = pricesInWords(org.price_position);
  }
  return out;
}

/** "usually about 15% cheaper than Overthought" and the like. */
export function pricesInWords(position) {
  const pct = Math.round(Math.abs(position - 1) * 100);
  if (pct < 3) return "usually about the same price as Overthought";
  return `usually about ${pct}% ${position < 1 ? "cheaper" : "dearer"} than Overthought`;
}

/** Every competitor that sells in a category. */
export function competitorsIn(defs, category) {
  return defs.competitors.filter((c) => c.categories.includes(category));
}

/** Any organisation by id, or null. */
export function findOrg(defs, id) {
  return [...defs.competitors, ...defs.partners, ...defs.institutions].find((o) => o.id === id) || null;
}
