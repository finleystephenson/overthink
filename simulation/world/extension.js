// Engine extension: the wider world's records and tools (see docs/world.md).
//
// Record lists, loaded from the world folder when the files exist and empty otherwise (so nothing breaks before a
// world is rebuilt): organisations, competitor_moves, economy, trends, opinion, supplier_disruptions, world_developments.
// state.world_settings (a plain object, not a list) is how the lab changes the wider world; it is not loaded from files.
//
// Two lenses. Business roles (every role a business or a customer could hold) see public knowledge: who the rivals
// are, what they have visibly done, their prices, the published figures, what is in fashion. The `world` lens (engine
// LENSES; the explorer and the lab, never offered by the server) also sees rivals' strategies, rules and budgets, moves
// decided but not yet visible, and the world settings.
// Registration: import "./extension.js" in infrastructure/engine/all.js.
import { extend, kit } from "../../infrastructure/engine/engine.js";
import { findOrg, orgsFor, publicView } from "./organisations.mjs";
import { ownPriceIndex, stanceOn, CATEGORY_WORDS } from "./competitors.mjs";
import { ECONOMY, economyEffects, rowsUpTo, withShocks } from "./economy.mjs";
import { latestTrend, TREND_RULES } from "./trends.mjs";

const { fail, dateOf, ms, round2, schema: { str, obj }, roles } = kit;
const integer = { type: "integer" };
const anyObject = { type: "object" };
/** Every business role plus the world lens. WHY all business roles: this is what anyone could read or see. */
const PUBLIC = [...roles.ALL, "world"];
const WORLD = ["world"];
const MAX_LIMIT = 200;

const today = (ctx) => dateOf(ms(ctx.now));
const isWorld = (ctx) => ctx.role === "world";
const limitOf = (i, d = 20) => Math.min(MAX_LIMIT, Math.max(1, i.limit || d));

/** Move fields that give away a rival's reasoning or the model's inner numbers. */
const MOVE_INTERNAL = ["reason", "trigger", "weight_add", "add_price_factor", "newsworthy", "forced", "ad_factor"];

function moveView(ctx, m) {
  if (isWorld(ctx)) return m;
  const out = {};
  for (const [k, v] of Object.entries(m)) if (!MOVE_INTERNAL.includes(k)) out[k] = v;
  return out;
}

function orgView(ctx, o) {
  return isWorld(ctx) ? o : publicView(o);
}

const TOOLS = [
  {
    name: "list_organisations", roles: PUBLIC,
    description: "The other organisations in the world: competitors, partners (carriers, payment provider, marketplace, ad network) and institutions (regulator, bank, central bank, statistics office, trade body, council, newspaper). Optional kind (competitor, partner, institution). Competitors show what anyone could see: what they sell and roughly how their prices compare.",
    input_schema: obj({ kind: str }),
    run(ctx, i) {
      const d = orgsFor(ctx.st);
      const groups = { competitor: d.competitors, partner: d.partners, institution: d.institutions };
      if (i.kind && !groups[i.kind]) fail("invalid_input", "kind must be competitor, partner or institution.");
      const list = i.kind ? groups[i.kind] : [...d.competitors, ...d.partners, ...d.institutions];
      return { total: list.length, organisations: list.map((o) => orgView(ctx, o)) };
    },
  },
  {
    name: "get_organisation", roles: PUBLIC,
    description: "One organisation by id (from list_organisations). For a competitor, also its moves you can see now (sales, price cuts, launches, advertising) and its prices today.",
    input_schema: obj({ id: str }, ["id"]),
    run(ctx, i) {
      const d = orgsFor(ctx.st);
      const o = findOrg(d, i.id) || fail("not_found", `No organisation ${i.id}. See list_organisations.`);
      if (o.kind !== "competitor") return orgView(ctx, o);
      const date = today(ctx);
      const moves = visibleMoves(ctx, date).filter((m) => m.competitor === o.id).slice(-10).reverse().map((m) => moveView(ctx, m));
      return { ...orgView(ctx, o), prices_today: pricesFor(ctx, o, date), recent_moves: moves };
    },
  },
  {
    name: "list_competitor_moves", roles: PUBLIC,
    description: "What rival shops have visibly done (sales, price cuts, price rises, cheaper alternatives, advertising pushes), newest first. Optional competitor (id), category, limit (default 20, at most 200).",
    input_schema: obj({ competitor: str, category: str, limit: integer }),
    run(ctx, i) {
      const list = visibleMoves(ctx, today(ctx))
        .filter((m) => (!i.competitor || m.competitor === i.competitor) && (!i.category || (m.categories || []).includes(i.category)))
        .reverse();
      return { total: list.length, moves: list.slice(0, limitOf(i)).map((m) => moveView(ctx, m)) };
    },
  },
  {
    name: "get_competitor_prices", roles: PUBLIC,
    description: "How each rival's prices compare with Overthought's today, by category, as anyone comparing the shops would see them: a percentage cheaper or dearer, and any sale on. Optional category.",
    input_schema: obj({ category: str }),
    run(ctx, i) {
      const d = orgsFor(ctx.st), date = today(ctx);
      const rows = [];
      for (const o of d.competitors) {
        for (const p of pricesFor(ctx, o, date)) if (!i.category || p.category === i.category) rows.push({ competitor: o.id, name: o.name, ...p });
      }
      return { date, prices: rows };
    },
  },
  {
    name: "get_economy", roles: PUBLIC,
    description: "The published monthly figures, newest first: inflation, consumer confidence, unemployment, Bank Rate and pay growth (all % except confidence, an index where below zero means more people feel worse off). Optional limit (months, default 12). Figures are simulated; the starting values are assumptions, with the real source to check.",
    input_schema: obj({ limit: integer }),
    run(ctx, i) {
      const date = today(ctx);
      const rows = rowsUpTo(ctx.st, date).slice().reverse().slice(0, limitOf(i, 12)).map((r) => withShocks(r, ctx.st, r.published)); // WHY each row's own date: figures show a shock from the month it is published
      const out = { months: rows, starting_values: ECONOMY.start };
      if (isWorld(ctx)) {
        const e = economyEffects(ctx.st, date);
        out.effects_today = { demand_all: e.demand.all, costs: e.costs, price_sensitivity: e.price_sensitivity, why: e.why };
      }
      return out;
    },
  },
  {
    name: "list_trends", roles: PUBLIC,
    description: "What is in fashion: the interest index per product category (100 is normal), with its last few weeks, and how people feel about Overthought & Co. lately (sentiment from -1 to 1, from reviews, complaints and customer posts). Optional category and weeks (default 8).",
    input_schema: obj({ category: str, weeks: integer }),
    run(ctx, i) {
      const date = today(ctx), weeks = Math.min(52, Math.max(1, i.weeks || 8));
      const cats = i.category ? [i.category] : TREND_RULES.categories;
      const trends = cats.map((c) => {
        const rows = (ctx.st.trends || []).filter((t) => t.category === c && t.date <= date).slice(-weeks);
        const now = latestTrend(ctx.st, c, date);
        return { category: c, in_words: CATEGORY_WORDS[c] || c, interest_now: now ? now.interest : 100,
          weeks: rows.map((t) => ({ date: t.date, interest: t.interest, ...(isWorld(ctx) ? { level: t.level, spike: t.spike } : {}) })) };
      });
      const op = (ctx.st.opinion || []).filter((o) => o.date <= date).at(-1) || null;
      return { trends, opinion: op };
    },
  },
  {
    name: "list_world_developments", roles: PUBLIC,
    description: "Changes in the wider world beyond the economy, newest first: new rules from the regulator, new technology at carriers and payment firms, the labour market, council works. Each with its dates and what it does in plain words. Optional limit (default 20).",
    input_schema: obj({ limit: integer }),
    run(ctx, i) {
      const date = today(ctx);
      const list = (ctx.st.world_developments || []).filter((w) => w.from <= date).slice().reverse();
      return { total: list.length, developments: list.slice(0, limitOf(i)).map((w) => (isWorld(ctx) ? w : { id: w.id, kind: w.kind, institution: w.institution_name,
        from: w.from, to: w.to, headline: w.headline, story: w.story, what_it_does: w.why, in_force: w.to >= date })) };
    },
  },
  {
    name: "get_world_settings", roles: WORLD,
    description: "World lens only: the settings experiments use to change the wider world (economy shocks, forced competitor moves, supplier disruptions, trend boosts, consumer shifts). Shape: docs/world.md.",
    input_schema: obj({}),
    run(ctx) { return ctx.st.world_settings || {}; },
  },
  {
    name: "set_world_settings", roles: WORLD,
    description: "World lens only: replaces the world settings. Shape: docs/world.md. Takes effect from the next simulated day.",
    input_schema: obj({ settings: anyObject }, ["settings"]),
    run(ctx, i) {
      const problem = checkSettings(i.settings);
      if (problem) fail("invalid_input", problem);
      ctx.st.world_settings = i.settings;
      ctx.changes.push("world settings changed");
      return ctx.st.world_settings;
    },
  },
];

/** Moves a business could see on a date: those that have started. The world lens also sees decided, future ones. */
function visibleMoves(ctx, date) {
  return (ctx.st.competitor_moves || []).filter((m) => isWorld(ctx) || m.from <= date);
}

/** A rival's prices against Overthought's today, per category it sells in. */
function pricesFor(ctx, o, date) {
  return o.categories.map((cat) => {
    const st = stanceOn(ctx.st, o, cat, date);
    const own = ownPriceIndex(ctx.st, ctx.world.products, cat, date) ?? 1;
    const rel = (o.price_position * st.price_factor) / own;
    const pct = Math.round(Math.abs(rel - 1) * 100);
    const sale = st.moves.find((m) => (m.price_factor ?? 1) !== 1);
    return { category: cat, compared_with_overthought: round2(rel), in_words: pct < 3 ? "about the same" : `${pct}% ${rel < 1 ? "cheaper" : "dearer"}`,
      offer_on: sale ? (sale.kind === "price_rise" ? "prices raised" : sale.season ? `${sale.season.replace(/-/g, " ")} sale` : "prices cut") : null };
  });
}

const SETTING_LISTS = {
  economy_shocks: [],
  competitor_moves: ["competitor"],
  supplier_disruptions: ["supplier"],
  trend_boosts: ["category", "factor"],
  consumer_shifts: [],
  developments: ["id"],
};

/**
 * Checks the shape of world settings. Returns a problem in words, or null.
 * @param {object} s
 * @return {?string}
 */
export function checkSettings(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return "settings must be an object.";
  for (const [k, v] of Object.entries(s)) {
    // WHY: the lab keeps business-rule changes (delivery charges, returns window) here as { "dotted.path": value }.
    if (k === "policies") {
      if (!v || typeof v !== "object" || Array.isArray(v)) return "policies must be an object of rule paths to values.";
      continue;
    }
    if (!SETTING_LISTS[k]) return `Unknown setting "${k}". Known: ${Object.keys(SETTING_LISTS).join(", ")}.`;
    if (!Array.isArray(v)) return `${k} must be a list.`;
    for (const e of v) {
      if (!e || typeof e !== "object") return `Each entry in ${k} must be an object.`;
      for (const f of SETTING_LISTS[k]) if (e[f] === undefined) return `Each entry in ${k} needs "${f}".`;
      for (const f of ["from", "to"]) if (e[f] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(e[f])) return `${k}: ${f} must be a date, YYYY-MM-DD.`;
    }
  }
  return null;
}

extend({
  state: ["organisations", "competitor_moves", "economy", "trends", "opinion", "supplier_disruptions", "world_developments"],
  counters: [["CM", "competitor_moves", "id"], ["SD", "supplier_disruptions", "id"], ["WD", "world_developments", "id"]],
  tools: TOOLS,
});
