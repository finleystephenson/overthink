// The catalogue of things an experiment can change, as data.
//
// Each intervention has an id, a plain label and description, typed parameters (default and limits), and
// `apply(world, ctx)`. apply changes the world ONLY through the engine's own tools (as the role that would really do
// it, usually the manager) or by writing state.world_settings (the wider world's knobs, docs/open-world.md). So every
// change is checked by the engine's rules and lands in the records exactly as if a person had made it.
//
// One kind is different: `connect_ai` does not change the world; it decides who answers customers in a branch, so it
// is read when the branch is opened (kind "branch") and can only start on day 0.
//
// In an experiment an intervention is { type, day?, params? }. day 0 (the default) means before the first simulated
// day; day d means after d days have been simulated, before day d+1.
import { setWorldSetting, applyPolicySettings, policyValue } from "./branch.mjs";
import { checkConnection } from "./client.mjs";
import { checkScope } from "./scope.mjs";
import { addDays } from "../simulator/lib.mjs";
import ORGS from "../../business/data/organisations.json" with { type: "json" };
import { supplierPeople } from "../world/supplier-side.mjs";

const COMPETITORS = (ORGS.competitors || []).map((c) => c.id);
const DEVELOPMENTS = (ORGS.developments?.list || []).map((d) => d.id);
const CATEGORY_IDS = ["food", "tech", "everyday", "carry", "desk-home", "outdoors"];
const oneOf = (v, list, what) => { if (!list.includes(v)) fail(`There is no ${what} "${v}". Choose from: ${list.join(", ")}.`); };

const fail = (message) => { throw Object.assign(new Error(message), { code: "invalid_input" }); };
const money = (x) => `£${Number(x).toFixed(2)}`;

/**
 * @typedef {object} Param
 * @property {string} type "number", "integer", "string", "boolean", "object" or "any".
 * @property {string} label Plain words.
 * @property {*=} default
 * @property {number=} min
 * @property {number=} max
 * @property {Array<string>=} choices
 * @property {boolean=} required
 */

/** Calls one engine tool as a role, keeping what happened for the experiment's record. */
function caller(world, log) {
  const sessions = {};
  return (role, tool, input) => {
    const sess = (sessions[role] ||= world.session({ role }));
    const auditBefore = world.state.audit.length;
    const r = sess.call(tool, input);
    const audit = world.state.audit[auditBefore];
    log.push({ role, tool, input, ok: r.ok, error: r.ok ? null : r.error, engine_changes: audit?.changes ?? [] });
    return r;
  };
}

/** The variant and accessory lines of the products a price change covers. */
function linesFor(world, scope, target) {
  let products = world.products.filter((p) => (world.state.product_status?.[p.id]?.status ?? p.status) !== "discontinued");
  if (scope === "category") {
    const cats = [...new Set(world.products.map((p) => p.category))];
    if (!cats.includes(target)) fail(`There is no category "${target}". Categories: ${cats.join(", ")}.`);
    products = products.filter((p) => p.category === target);
  } else if (scope === "product") {
    if (!world.index.byId[target]) fail(`There is no product "${target}". Products: ${world.products.map((p) => p.id).join(", ")}.`);
    products = products.filter((p) => p.id === target);
  }
  const out = [];
  for (const p of products) {
    for (const v of p.variants) out.push({ product: p, sku: v.sku, label: `${p.name}${p.variants.length > 1 ? ` (${v.name})` : ""}` });
    for (const a of p.accessories || []) out.push({ product: p, sku: a.sku, label: `${a.name || a.sku}, for ${p.name}` });
  }
  return out;
}

/** Today's price of a line: the latest price history entry up to today, else the catalogue price. */
function priceToday(world, sku) {
  const today = world.state.now.slice(0, 10);
  let price = world.index.skus[sku].item.price, at = "";
  for (const h of world.state.price_history) if (h.sku === sku && h.date <= today && h.date >= at) { price = h.new_price; at = h.date; }
  return price;
}

/** @type {Object<string, object>} */
export const INTERVENTIONS = {
  price_change: {
    label: "Change prices",
    description: "Raises or lowers prices by a percentage: everything, one category, or one product. Recorded in the price history; orders already placed keep their price. In the simulation, customers buy less when prices rise (price elasticity in business/data/sim.json) and each customer also weighs prices against their own price sensitivity.",
    params: {
      percent: { type: "number", label: "Change, in per cent (10 = 10% dearer, -10 = 10% cheaper)", default: 10, min: -90, max: 300, required: true },
      scope: { type: "string", label: "Which products", default: "all", choices: ["all", "category", "product"] },
      target: { type: "string", label: "The category or product id (when scope is category or product)", default: null },
      reason: { type: "string", label: "Reason written in the price history", default: "Lab experiment" },
    },
    apply(world, { params, call }) {
      if (params.scope !== "all" && !params.target) fail(`Say which ${params.scope} in "target".`);
      const changes = [];
      for (const l of linesFor(world, params.scope, params.target)) {
        const old = priceToday(world, l.sku);
        const next = Math.max(0.01, Math.round(old * (1 + params.percent / 100) * 100) / 100);
        if (next === old) continue;
        const r = call("manager", "change_price", { sku: l.sku, new_price: next, reason: params.reason });
        if (r.ok) changes.push(`Price of ${l.label}: ${money(old)} → ${money(next)}`);
      }
      return { changes, summary: `${params.percent > 0 ? "Raised" : "Cut"} ${changes.length} prices by ${Math.abs(params.percent)}%${params.scope === "all" ? "" : ` (${params.scope} ${params.target})`}` };
    },
  },

  sale: {
    label: "Run a sale (discount code)",
    description: "Starts a campaign with a discount code for a number of days. About a quarter of buyers use a code while it runs (infrastructure/engine/campaigns.js); the discount also lifts demand through price elasticity. Optional extra spend promotes it.",
    params: {
      percent: { type: "number", label: "Discount, per cent (the manager may give up to 20%)", default: 10, min: 1, max: 20, required: true },
      days: { type: "integer", label: "How many days it runs", default: 14, min: 1, max: 365 },
      code: { type: "string", label: "The code customers type (3 to 12 capital letters or numbers)", default: "LABSALE" },
      monthly_spend: { type: "number", label: "Extra promotion spend, £ a month", default: 0, min: 0, max: 50000 },
      channel: { type: "string", label: "Where it is promoted", default: "none", choices: ["none", "email", "search", "social"] },
    },
    apply(world, { params, call, date }) {
      const start = date, end = addDays(date, params.days);
      const r = call("manager", "create_campaign", { name: `Sale: ${params.percent}% off`, channel: params.channel, start, end, monthly_spend: params.monthly_spend, code: params.code, discount_pct: params.percent });
      return { changes: r.ok ? [`Sale ${params.code}: ${params.percent}% off from ${start} to ${end}${params.monthly_spend ? `, £${params.monthly_spend} a month promotion` : ""}`] : [], summary: `A ${params.percent}% sale for ${params.days} days` };
    },
  },

  marketing_budget: {
    label: "Change the marketing budget",
    description: "Sets the monthly marketing spend: times the plan (2 = double), or an exact amount. Demand follows 1 + marketing elasticity × ln(spend ÷ plan), never below half; the spend is a cost every day (infrastructure/engine/levers.js).",
    params: {
      multiply: { type: "number", label: "Times the planned budget (2 = double, 0.5 = half)", default: 2, min: 0, max: 50 },
      monthly: { type: "number", label: "Or an exact amount, £ a month (overrides multiply)", default: null, min: 0, max: 50000 },
    },
    apply(world, { params, call }) {
      const lev = call("manager", "get_levers", {});
      const plan = lev.ok ? lev.data.planned_marketing_per_month : null;
      const now = lev.ok ? (lev.data.marketing_per_month ?? plan) : null;
      const monthly = params.monthly ?? Math.round((plan ?? 0) * params.multiply * 100) / 100;
      const r = call("manager", "set_marketing_budget", { monthly, reason: "Lab experiment" });
      return { changes: r.ok ? [`Marketing budget: £${now} → £${monthly} a month`] : [], summary: `Marketing budget £${monthly} a month (plan £${plan})` };
    },
  },

  staffing: {
    label: "Change the team",
    description: "Hires someone into an existing role (they work like the first person in that role), changes a person's weekly hours, or lets someone go. From the next simulated day; pay follows the hours (infrastructure/engine/levers.js set_staffing).",
    params: {
      action: { type: "string", label: "hire, hours or remove", default: "hire", choices: ["hire", "hours", "remove"] },
      role: { type: "string", label: "Role to hire into (e.g. support_agent, warehouse, buyer)", default: "support_agent" },
      staff_id: { type: "string", label: "Who (for hours or remove), e.g. S-07", default: null },
      weekly_hours: { type: "number", label: "Weekly hours (the plan's figure, 0 to 48)", default: 28, min: 0, max: 48 },
      name: { type: "string", label: "Name for a new hire (optional)", default: null },
    },
    apply(world, { params, call }) {
      const input = params.action === "hire"
        ? { action: "add", role: params.role, weekly_hours: params.weekly_hours, ...(params.name ? { name: params.name } : {}), reason: "Lab experiment" }
        : params.action === "hours" ? { action: "hours", staff_id: params.staff_id, weekly_hours: params.weekly_hours, reason: "Lab experiment" }
          : { action: "remove", staff_id: params.staff_id, reason: "Lab experiment" };
      if (params.action !== "hire" && !params.staff_id) fail('Say who in "staff_id" (see get_levers for the team).');
      const r = call("manager", "set_staffing", input);
      const engine = r.ok ? world.state.audit[world.state.audit.length - 1]?.changes ?? [] : [];
      return { changes: engine.map(plainStaffChange), summary: params.action === "hire" ? `Hired one ${params.role.replace(/_/g, " ")} for ${params.weekly_hours} hours a week` : params.action === "hours" ? `${params.staff_id} to ${params.weekly_hours} hours a week` : `${params.staff_id} leaves` };
    },
  },

  policy: {
    label: "Change a business rule",
    description: 'Changes one value in the business rules (business/data/business.json), e.g. "returns.window_days". There is no engine tool for this, so the change is written to world_settings.policies (saved with the world) and the branch\'s engine follows it. Only engine tools read these rules: the simulated staff do not, so a rule change shows up mainly in what tools and AIs are allowed to do.',
    params: {
      path: { type: "string", label: 'Which rule, as words joined by dots (e.g. "returns.window_days")', default: "returns.window_days", required: true },
      value: { type: "any", label: "The new value (same type as the old one)", required: true },
    },
    apply(world, { params }) {
      const old = policyValue(world, params.path);
      if (old === undefined) fail(`There is no business rule "${params.path}".`);
      if (typeof old === "object" || typeof old !== typeof params.value) fail(`"${params.path}" is a ${typeof old}; give a ${typeof old} value.`);
      const policies = { ...(world.state.world_settings?.policies || {}), [params.path]: params.value };
      setWorldSetting(world, "policies", policies);
      applyPolicySettings(world);
      return { changes: [`Rule ${params.path}: ${old} → ${params.value}`], summary: `${params.path} set to ${params.value}` };
    },
  },

  returns_window: {
    label: "Change the returns window",
    description: "How many days after delivery a customer may send something back for a refund (returns.window_days, 30 in the plan). Engine tools such as check_return_eligibility and create_return follow it.",
    params: { days: { type: "integer", label: "Days", default: 14, min: 0, max: 365, required: true } },
    apply(world, ctx) { return INTERVENTIONS.policy.apply(world, { ...ctx, params: { path: "returns.window_days", value: ctx.params.days } }); },
  },

  delivery_charges: {
    label: "Change delivery charges",
    description: "The standard delivery price and the order value above which it is free (business rules: delivery.methods, standard is £3.95, free over £50). Written to world_settings.policies; the engine charges it at checkout and the simulator's demand follows the change in what an order costs (same price elasticity as prices).",
    params: {
      price: { type: "number", label: "Standard delivery price, £", default: 3.95, min: 0, max: 50 },
      free_over: { type: "number", label: "Free delivery on orders of at least £ (leave empty for never free)", default: null, min: 0, max: 10000 },
    },
    apply(world, { params }) {
      const i = (world.business.delivery?.methods || []).findIndex((m) => m.id === "standard");
      if (i < 0) fail("This world has no standard delivery method.");
      const m = world.business.delivery.methods[i];
      const before = `£${m.price}${m.free_over != null ? `, free over £${m.free_over}` : ", never free"}`;
      const policies = { ...(world.state.world_settings?.policies || {}), [`delivery.methods.${i}.price`]: params.price, [`delivery.methods.${i}.free_over`]: params.free_over };
      setWorldSetting(world, "policies", policies);
      applyPolicySettings(world);
      const after = `£${params.price}${params.free_over != null ? `, free over £${params.free_over}` : ", never free"}`;
      return { changes: [`Standard delivery: ${before} → ${after}`], summary: `Standard delivery ${after}` };
    },
  },

  launch_product: {
    label: "Launch a product",
    description: "Puts a prepared or discontinued product on sale (engine launch_product). The engine cannot invent a brand-new product: only products already in the catalogue files can be launched, and the current worlds have no prepared-but-unlaunched products, so this works for bringing back one that was discontinued (e.g. after a discontinue_product earlier in the same arm). A launched product's demand follows its category, adjusted for price, with a novelty boost that fades (simulation/simulator/core.mjs syncCatalogue).",
    params: { product_id: { type: "string", label: "Product id", required: true } },
    apply(world, { params, call, date }) {
      const p = world.index.byId[params.product_id];
      if (!p) fail(`There is no product "${params.product_id}".`);
      const r = call("manager", "launch_product", { product_id: params.product_id, from: date });
      return { changes: r.ok ? [`${p.name} on sale from ${date}`] : [], summary: `Launch ${p.name}` };
    },
  },

  discontinue_product: {
    label: "Stop selling a product",
    description: "Ends a product (engine discontinue_product). Part of its demand moves to the rest of its category; the rest is lost (rates in business/data/audience.json).",
    params: {
      product_id: { type: "string", label: "Product id", required: true },
      stock: { type: "string", label: "sell_through or write_off", default: "sell_through", choices: ["sell_through", "write_off"] },
    },
    apply(world, { params, call }) {
      const p = world.index.byId[params.product_id];
      if (!p) fail(`There is no product "${params.product_id}".`);
      const r = call("manager", "discontinue_product", { product_id: params.product_id, stock: params.stock, reason: "Lab experiment" });
      return { changes: r.ok ? [`${p.name} no longer sold (${params.stock.replace("_", " ")})`] : [], summary: `Stop selling ${p.name}` };
    },
  },

  world_event: {
    label: "Cause a world event",
    description: "Something happens in the world: a template from the event library (list_event_templates) or your own, with effects on demand (all, by product, by category), visits, contact rate, carrier delays (days), supplier lateness and costs (carrier, goods, card fees). Its news is published in The Daily Overthinker.",
    params: {
      template: { type: "string", label: "Template id from the event library (optional)", default: null },
      title: { type: "string", label: "Title (for your own event)", default: null },
      story: { type: "string", label: "What happened (for your own event)", default: null },
      effects: { type: "object", label: "Effects: { demand: { all, products, categories }, visits, contact_rate, carrier_delay_days, supplier_late_chance, costs: { carrier, goods, card_fee } }", default: null },
      days: { type: "integer", label: "How many days it lasts", default: 14, min: 1, max: 365 },
    },
    apply(world, { params, call, date }) {
      if (!params.template && !(params.title && params.effects)) fail("Give a template id, or your own title and effects.");
      return addEvent(call, date, { template: params.template, title: params.title, story: params.story, effects: params.effects, days: params.days });
    },
  },

  supplier_disruption: {
    label: "Supplier disruption",
    description: "Deliveries from suppliers are late far more often, and goods cost a little more, for a number of days. The engine's events act on all suppliers at once (supplier_late_chance), not on one named supplier.",
    params: {
      days: { type: "integer", label: "How many days", default: 21, min: 1, max: 365 },
      late_times: { type: "number", label: "How many times more often deliveries are late", default: 4, min: 1, max: 20 },
      goods_cost: { type: "number", label: "Goods cost multiplier", default: 1.05, min: 0.5, max: 3 },
    },
    apply(world, { params, call, date }) {
      return addEvent(call, date, { title: "Supplier disruption", story: "A breakdown at a major distribution centre leaves suppliers struggling to deliver on time.",
        effects: { supplier_late_chance: params.late_times, costs: { goods: params.goods_cost } }, days: params.days });
    },
  },

  postal_strike: {
    label: "Postal strike",
    description: "A long postal strike (event template rs-postal-strike-long): parcels arrive about five days late, more customers get in touch, slightly fewer visits and orders.",
    params: { days: { type: "integer", label: "How many days", default: 14, min: 1, max: 120 } },
    apply(world, { params, call, date }) { return addEvent(call, date, { template: "rs-postal-strike-long", days: params.days }); },
  },

  heatwave: {
    label: "Heatwave",
    description: "A heatwave (event template rs-heatwave): ice and skimming stones sell more, umbrellas less, slightly fewer orders overall, a few more contacts.",
    params: { days: { type: "integer", label: "How many days", default: 7, min: 1, max: 60 } },
    apply(world, { params, call, date }) { return addEvent(call, date, { template: "rs-heatwave", days: params.days }); },
  },

  world_setting: {
    label: "Change a wider-world setting",
    description: "Writes one value into the wider world's settings (state.world_settings), which the world's plug-ins read every day. The settings that exist are listed in docs/world.md once the wider world is installed; until then a setting is saved but nothing reads it.",
    params: {
      path: { type: "string", label: 'Which setting, as words joined by dots (e.g. "economy.inflation")', required: true },
      value: { type: "any", label: "The new value", required: true },
    },
    apply(world, { params }) {
      // WHY: business rules go through the policy intervention, which checks each value's type; not round it.
      if (/^policies(\.|$)/.test(params.path)) fail('Business rules are changed with the "policy" intervention.');
      const r = setWorldSetting(world, params.path, params.value);
      return { changes: [`World setting ${params.path}: ${JSON.stringify(r.before)} → ${JSON.stringify(r.after)}`], summary: `${params.path} = ${JSON.stringify(params.value)}` };
    },
  },

  competitor_move: {
    label: "A competitor moves",
    description: "A rival (business/data/organisations.json competitors) cuts prices, advertises harder, or launches a similar product cheaper in a category, for a number of days. Give `product` (one of Overthought's product ids) to make the launch a cheaper copy of that product: the lost demand then lands on it, not on the whole category. Written to world_settings.competitor_moves; the wider world's competitor plug-in turns it into lost or won demand, with its reasons.",
    params: {
      competitor: { type: "string", label: "Competitor id (e.g. lookalike-lane, gadgetry-goose, bargain-barrow)", default: "lookalike-lane", required: true },
      launch_category: { type: "string", label: "Launch a similar product in this category (optional)", default: null },
      product: { type: "string", label: "Copy this one product of ours (a product id, optional; its category is used)", default: null },
      price_factor: { type: "number", label: "Their prices (0.8 = 20% cheaper)", default: 0.8, min: 0.2, max: 2 },
      ad_factor: { type: "number", label: "Their advertising (2 = twice as much)", default: 1, min: 0, max: 10 },
      days: { type: "integer", label: "How many days", default: 30, min: 1, max: 365 },
    },
    apply(world, { params, date }) {
      oneOf(params.competitor, COMPETITORS, "competitor");
      const copied = params.product ? world.index.byId[params.product] || fail(`There is no product "${params.product}". Products: ${world.products.map((p) => p.id).join(", ")}.`) : null;
      const cat = copied ? copied.category : params.launch_category;
      if (cat) oneOf(cat, CATEGORY_IDS, "category");
      const e = { competitor: params.competitor, price_factor: params.price_factor, ad_factor: params.ad_factor, ...(cat ? { launch_category: cat } : {}), ...(copied ? { product: copied.id } : {}) };
      const what = copied ? `launches a copy of ${copied.name} ${Math.round((1 - params.price_factor) * 100)}% cheaper` : cat ? `launches a ${Math.round((1 - params.price_factor) * 100)}% cheaper rival in ${cat}` : `prices × ${params.price_factor}, advertising × ${params.ad_factor}`;
      return pushSetting(world, "competitor_moves", e, date, params.days, `${params.competitor} ${what}`);
    },
  },

  supplier_email: {
    label: "Write to a supplier",
    description: "The buyer emails a supplier about one of its open purchase orders (the newest, unless `po` is given): ask to bring it forward, for a volume discount, to change a quantity, or about lead times, politely, plainly or rudely. Sent with send_email from the suppliers mailbox; the supplier answers by its rules on the next working day (simulation/world/supplier-side.mjs), and an agreed change really changes the order.",
    params: {
      supplier: { type: "string", label: "Supplier id (SUP-01 to SUP-11)", default: "SUP-03", required: true },
      ask: { type: "string", label: "What to ask for", default: "expedite", choices: ["expedite", "discount", "quantity", "lead_time"] },
      po: { type: "string", label: "Purchase order number (default: the newest open one with that supplier)", default: null },
      qty: { type: "integer", label: "New quantity (for ask = quantity)", default: null, min: 1, max: 100000 },
      tone: { type: "string", label: "How it is written", default: "polite", choices: ["polite", "plain", "rude"] },
    },
    apply(world, { params, call }) {
      const sup = (world.state.suppliers || []).find((x) => x.id === params.supplier);
      if (!sup) fail(`There is no supplier "${params.supplier}". Suppliers: ${(world.state.suppliers || []).map((x) => `${x.id} ${x.name}`).join(", ")}.`);
      const open = world.state.purchase_orders.filter((p) => p.supplier_id === sup.id && ["ordered", "late"].includes(p.status));
      const po = params.po || open.at(-1)?.number;
      if (!po && params.ask !== "lead_time") fail(`${sup.name} has no open purchase order to ask about. Raise one first, or ask about lead times.`);
      const to = supplierPeople(sup).from.address;
      const r = call("buyer", "send_email", { mailbox: "suppliers", to: [to], subject: po ? `${po}` : "Lead times", body: supplierEmailBody(params, po) });
      return { changes: r.ok ? [`email ${r.data.id} to ${to}`] : [], summary: `${params.tone} email to ${sup.name} asking ${params.ask.replace(/_/g, " ")}${po ? ` on ${po}` : ""}${r.ok ? "" : ` (refused: ${r.error.message})`}` };
    },
  },

  supplier_problem: {
    label: "One supplier in trouble",
    description: "One named supplier (e.g. SUP-02 Coldharbour Ice Works) can make less and takes longer to deliver, for a number of days. Written to world_settings.supplier_disruptions; the wider world's supplier plug-in applies it to that supplier's purchase orders.",
    params: {
      supplier: { type: "string", label: "Supplier id (SUP-01 to SUP-11)", default: "SUP-02", required: true },
      capacity_factor: { type: "number", label: "Share of normal capacity (0.5 = half)", default: 0.5, min: 0, max: 1 },
      extra_lead_days: { type: "integer", label: "Extra days to deliver", default: 10, min: 0, max: 120 },
      days: { type: "integer", label: "How many days", default: 21, min: 1, max: 365 },
    },
    apply(world, { params, date }) {
      const sup = (world.state.suppliers || []).find((x) => x.id === params.supplier);
      if (!sup) fail(`There is no supplier "${params.supplier}". Suppliers: ${(world.state.suppliers || []).map((x) => `${x.id} ${x.name}`).join(", ")}.`);
      return pushSetting(world, "supplier_disruptions", { supplier: params.supplier, capacity_factor: params.capacity_factor, extra_lead_days: params.extra_lead_days }, date, params.days, `${sup.name}: ${Math.round(params.capacity_factor * 100)}% capacity, ${params.extra_lead_days} days slower`);
    },
  },

  economy_shock: {
    label: "An economic shock",
    description: "Shifts the economy for a while: inflation, consumer confidence, unemployment, bank rate, wage growth (points added). Written to world_settings.economy_shocks; the wider world's economy plug-in turns it into demand and price sensitivity, with its reasons.",
    params: {
      inflation_shift: { type: "number", label: "Inflation, points added", default: 0, min: -10, max: 20 },
      confidence_shift: { type: "number", label: "Consumer confidence, points added", default: -10, min: -50, max: 50 },
      unemployment_shift: { type: "number", label: "Unemployment, points added", default: 0, min: -5, max: 15 },
      bank_rate_shift: { type: "number", label: "Bank rate, points added", default: 0, min: -5, max: 10 },
      wage_growth_shift: { type: "number", label: "Wage growth, points added", default: 0, min: -10, max: 10 },
      days: { type: "integer", label: "How many days", default: 60, min: 1, max: 365 },
    },
    apply(world, { params, date }) {
      const { days, ...shifts } = params;
      return pushSetting(world, "economy_shocks", shifts, date, days, Object.entries(shifts).filter(([, v]) => v).map(([k, v]) => `${k.replace(/_shift$/, "").replace(/_/g, " ")} ${v > 0 ? "+" : ""}${v}`).join(", ") || "no change");
    },
  },

  trend_boost: {
    label: "A trend takes off (or fades)",
    description: "Public interest in a category rises or falls (1.5 = half as much again). Written to world_settings.trend_boosts; the wider world's trends plug-in moves that category's demand.",
    params: {
      category: { type: "string", label: "Category (food, tech, everyday, carry, desk-home, outdoors)", default: "outdoors", required: true },
      factor: { type: "number", label: "Interest multiplier", default: 1.5, min: 0.1, max: 5 },
      days: { type: "integer", label: "How many days", default: 30, min: 1, max: 365 },
    },
    apply(world, { params, date }) {
      oneOf(params.category, CATEGORY_IDS, "category");
      return pushSetting(world, "trend_boosts", { category: params.category, factor: params.factor }, date, params.days, `interest in ${params.category} × ${params.factor}`);
    },
  },

  consumer_shift: {
    label: "Shoppers change",
    description: "Shoppers become more or less sensitive to price, or move some buying to the big marketplace. Written to world_settings.consumer_shifts.",
    params: {
      price_sensitivity: { type: "number", label: "Price sensitivity multiplier (1.2 = 20% more sensitive)", default: 1.2, min: 0.2, max: 5 },
      marketplace_shift: { type: "number", label: "Share of shoppers who move to the marketplace (0 to 0.9)", default: 0, min: 0, max: 0.9 },
      days: { type: "integer", label: "How many days", default: 60, min: 1, max: 365 },
    },
    apply(world, { params, date }) {
      return pushSetting(world, "consumer_shifts", { price_sensitivity: params.price_sensitivity, marketplace_shift: params.marketplace_shift }, date, params.days, `price sensitivity × ${params.price_sensitivity}${params.marketplace_shift ? `, ${Math.round(params.marketplace_shift * 100)}% to the marketplace` : ""}`);
    },
  },

  development: {
    label: "A development in the world",
    description: "Makes one of the world's listed developments happen (business/data/organisations.json developments: longer-returns, food-labels, parcel-lockers, pay-by-bank, same-day-bazaar, staff-shortage, high-street-roadworks). Written to world_settings.developments; the wider world's developments plug-in applies its effects and publishes its news.",
    params: {
      id: { type: "string", label: "Development id", default: "parcel-lockers", required: true },
      days: { type: "integer", label: "How many days", default: 60, min: 1, max: 730 },
    },
    apply(world, { params, date }) {
      oneOf(params.id, DEVELOPMENTS, "development");
      return pushSetting(world, "developments", { id: params.id }, date, params.days, `development ${params.id}`);
    },
  },

  connect_ai: {
    kind: "branch",
    label: "Connect an AI or tool",
    description: "Lets an AI or tool answer customers (or do another role's work) in this branch, through the shop's tools with that role's permissions. It is sent the work as the simulator's tool protocol (simulation/simulator/README.md). Starts on day 0 only.",
    params: {
      connection: { type: "object", label: '{ "kind": "cmd", "cmd": "node my-ai.mjs" } or { "kind": "http", "url": "https://..." } or { "kind": "none" }', required: true },
      role: { type: "string", label: "The role it acts as", default: "assistant", choices: ["assistant", "support_agent", "support_lead", "operations_assistant", "buyer", "marketing", "manager"] },
      cost_per_month: { type: "number", label: "What it costs, £ a month (for the scorecard)", default: 0, min: 0, max: 1e6 },
      timeout_seconds: { type: "number", label: "Seconds to wait for each reply", default: 60, min: 1, max: 600 },
      scope: { type: "object", label: 'What it may read and act on: { "read": [...], "act": [...] }, tool or app names (simulation/lab/scope.mjs). Leave out for the role\'s own permissions.', default: null },
    },
    apply() { return { changes: [], summary: "" }; },
  },

  call_tool: {
    label: "Call any engine tool",
    description: "Calls one of the shop's tools as a role, exactly as a person or an AI would (GET /tools lists them). The engine's rules apply; a refused call is recorded, not hidden.",
    params: {
      role: { type: "string", label: "Role", default: "manager", required: true },
      tool: { type: "string", label: "Tool name", required: true },
      input: { type: "object", label: "The tool's input", default: {} },
    },
    apply(world, { params, call }) {
      const r = call(params.role, params.tool, params.input || {});
      const engine = r.ok ? world.state.audit[world.state.audit.length - 1]?.changes ?? [] : [];
      return { changes: engine, summary: `${params.tool} as ${params.role}${r.ok ? "" : ` (refused: ${r.error?.message})`}` };
    },
  },
};

for (const [id, x] of Object.entries(INTERVENTIONS)) x.id = id;

/** What the buyer writes to a supplier, in one of three tones. WHY fixed wording: the experiment varies the tone only. */
function supplierEmailBody({ ask, tone, qty }, po) {
  const what = {
    expedite: `Could you bring ${po} forward? We are running low.`,
    discount: `Could you do a better price on ${po} for the volume?`,
    quantity: `Could you change the quantity on ${po} to ${qty || 1}?`,
    lead_time: `How long are your lead times at the moment${po ? `, and when will ${po} arrive` : ""}?`,
  }[ask];
  if (tone === "rude") return `${what.replace(/^Could you /, "You need to ").replace(/\?$/, ".")} This is ridiculous and your service is useless. Sort it out!!!\n\nRobinson Crusoe`;
  if (tone === "plain") return `${what}\n\nRobinson Crusoe`;
  return `Hello,\n\n${what} Thank you very much for your help.\n\nKind regards,\nRobinson Crusoe`;
}

/**
 * Adds one dated entry to a wider-world settings list (docs/world.md): from the next simulated day for `days` days.
 * WHY a list entry with dates, not a flag: the world plug-ins read only entries active on each date
 * (simulation/world/common.mjs activeSettings), so the setting switches itself off when it ends.
 */
function pushSetting(world, key, entry, date, days, words) {
  const from = addDays(date, 1), to = addDays(date, days);
  const current = world.state.world_settings || {};
  const { policies, ...lists } = current;
  const next = { ...lists, [key]: [...(Array.isArray(lists[key]) ? lists[key] : []), { ...entry, from, to }] };
  // WHY through the engine: set_world_settings (world lens) checks the shape, so a mistake is refused in words rather
  // than silently ignored by a plug-in. It replaces the whole object, and does not know the lab's own `policies` record
  // (simulation/lab/branch.mjs), so that is put back afterwards.
  const r = world.session({ role: "world" }).call("set_world_settings", { settings: next });
  if (!r.ok) fail(`The world refused the setting: ${r.error.message}`);
  if (policies) setWorldSetting(world, "policies", policies);
  return { changes: [`World setting ${key.replace(/_/g, " ")}: ${words}, ${from} to ${to}`], summary: words };
}

/** Adds a world event starting on the next simulated day. */
function addEvent(call, date, { template = null, title = null, story = null, effects = null, days }) {
  const start = addDays(date, 1);
  const input = { start, duration_days: days, ...(template ? { template } : {}), ...(title ? { title } : {}), ...(story ? { story } : {}), ...(effects ? { effects } : {}) };
  const r = call("manager", "add_world_event", input);
  if (!r.ok) return { changes: [], summary: `Event refused: ${r.error?.message}` };
  return { changes: [`World event "${r.data.title}" from ${r.data.start} to ${r.data.end}`], summary: `${r.data.title} for ${days} days` };
}

/** "staff hire-1 (New support agent 1) hired as support_agent, 20 hours a week" → plain words without the id. */
function plainStaffChange(s) {
  return s.replace(/^staff \S+ \(([^)]+)\)/, "$1").replace(/_/g, " ");
}

/**
 * The catalogue as plain data for a UI or an API: every intervention with its parameters.
 * @return {Array<object>}
 */
export function listInterventions() {
  return Object.values(INTERVENTIONS).map(({ id, label, description, params, kind }) => ({ id, label, description, kind: kind || "world", params }));
}

/**
 * Checks one intervention as given in an experiment and fills in defaults. Throws invalid_input in plain words.
 * @param {*} spec { type, day?, params? }
 * @param {number} days The experiment's length (an intervention must fall inside it).
 * @return {{type: string, day: number, params: object, label: string}}
 */
export function checkIntervention(spec, days) {
  if (!spec || typeof spec !== "object") fail("Each intervention is { type, day, params }.");
  const def = INTERVENTIONS[spec.type];
  if (!def) fail(`Unknown intervention "${spec.type}". Known: ${Object.keys(INTERVENTIONS).join(", ")}.`);
  const day = spec.day ?? 0;
  if (!Number.isInteger(day) || day < 0 || day >= days) fail(`"${def.label}": day must be a whole number from 0 to ${days - 1}.`);
  if (def.kind === "branch" && day !== 0) fail(`"${def.label}" can only start on day 0.`);
  const given = spec.params || {};
  const params = {};
  for (const [k, p] of Object.entries(def.params)) {
    let v = given[k] === undefined ? p.default ?? null : given[k];
    if (v === null || v === undefined) {
      if (p.required) fail(`"${def.label}" needs "${k}" (${p.label}).`);
      params[k] = null;
      continue;
    }
    if ((p.type === "number" || p.type === "integer") && (typeof v !== "number" || !Number.isFinite(v))) fail(`"${def.label}": "${k}" must be a number.`);
    if (p.type === "integer" && !Number.isInteger(v)) fail(`"${def.label}": "${k}" must be a whole number.`);
    if (p.type === "string" && typeof v !== "string") fail(`"${def.label}": "${k}" must be text.`);
    if (p.type === "object" && (typeof v !== "object" || Array.isArray(v))) fail(`"${def.label}": "${k}" must be an object.`);
    if (p.min !== undefined && v < p.min) fail(`"${def.label}": "${k}" must be at least ${p.min}.`);
    if (p.max !== undefined && v > p.max) fail(`"${def.label}": "${k}" must be at most ${p.max}.`);
    if (p.choices && !p.choices.includes(v)) fail(`"${def.label}": "${k}" must be one of ${p.choices.join(", ")}.`);
    params[k] = v;
  }
  for (const k of Object.keys(given)) if (!def.params[k]) fail(`"${def.label}" has no parameter "${k}". It takes: ${Object.keys(def.params).join(", ")}.`);
  if (spec.type === "connect_ai") { params.connection = checkConnection(params.connection); params.scope = checkScope(params.scope); }
  return { type: spec.type, day, params, label: def.label };
}

/**
 * Applies one checked intervention to a branch world. Never throws for a refusal by the engine: the refusal is part
 * of the result (a real manager can be told no, too).
 * @param {object} world
 * @param {{type: string, day: number, params: object}} iv
 * @return {{type: string, day: number, date: string, label: string, summary: string, changes: Array<string>,
 *     calls: Array<object>, refused: Array<string>, error: ?string}}
 */
export function applyIntervention(world, iv) {
  const def = INTERVENTIONS[iv.type];
  const calls = [];
  const date = world.state.now.slice(0, 10);
  let out = { changes: [], summary: "" }, error = null;
  try {
    out = def.apply(world, { params: iv.params, day: iv.day, date, call: caller(world, calls) });
  } catch (e) {
    if (e.code !== "invalid_input") throw e;
    error = e.message;
  }
  const refused = calls.filter((c) => !c.ok).map((c) => `${c.tool}: ${c.error?.message || c.error?.code}`);
  return { type: iv.type, day: iv.day, date, label: def.label, summary: out.summary, changes: out.changes, calls, refused, error };
}
