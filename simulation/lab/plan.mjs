// Idea → experiment plan. A person types an idea in plain English; this returns a plan they can read and edit before
// anything runs: the interventions (with parameters), the parts of the world involved (apps, people, organisations),
// what will be measured, a suggested length and number of repeats, and an honest list of what this world can and
// cannot model, with what would need building.
//
// Matching is by rules against the intervention catalogue (RULES below): no model is needed. An optional
// bring-your-own-model hook (`suggest`) can add interventions; it is off unless the caller passes one, and whatever it
// returns is checked against the catalogue like anything else.
import { checkExperiment } from "./experiment.mjs";
import { listInterventions } from "./interventions.mjs";
import { loadSituations } from "./overthink.mjs";

const APPS = {
  till: "Till (orders, products, prices, discounts, deliveries)", front_desk: "Front desk (customers, cases, complaints, returns)",
  letterbox: "Letterbox (email)", stockroom: "Stockroom (stock, suppliers, purchase orders)", tally: "Tally (accounts, cash)",
  megaphone: "Megaphone (campaigns, visitors)", rota: "Rota (team, hours, pay)", filing_cabinet: "Filing cabinet (policies, procedures)",
  daily_overthinker: "The Daily Overthinker (news)", squint: "Squint (picture posts)", mutter: "Mutter (short posts)", control_room: "Control room (time, impact, AI)",
};
// Words that name a category. WHY word boundaries: "ice" is inside "price" and "pen" inside "happen".
const CATEGORIES = { food: /\b(food|biscuits?|sandwich(es)?|ice|snacks?|hampers?)\b/, tech: /\b(tech|gadgets?|speakers?|boombox|electronics?|devices?)\b/, everyday: /\b(everyday|socks?|pens?|umbrellas?|bubble wrap)\b/, carry: /\b(bags?|carry|daypacks?|satchels?)\b/, "desk-home": /\b(desk|home|plants?|jungle)\b/, outdoors: /\b(outdoors?|stones?|puddles?|helmets?|aeroplanes?)\b/ };
const COMPETITOR_FOR = { food: "hamper-and-hare", tech: "gadgetry-goose", everyday: "lookalike-lane", carry: "wandering-satchel", "desk-home": "sensible-drawer", outdoors: "gilded-pebble" };

/** The product a rival copies when an idea names none: one well-known product per category. */
const PRODUCT_FOR = { food: { id: "biscuit-tin", name: "Biscuit Tin" }, tech: { id: "blip", name: "Blip" }, everyday: { id: "spare-sock", name: "Spare Sock" },
  carry: { id: "daypack", name: "Daypack" }, "desk-home": { id: "pocket-jungle", name: "Pocket Jungle" }, outdoors: { id: "skimming-stones", name: "Skimming Stones" } };
const PRODUCT_WORDS = [[/\bblip\b/, "blip", "tech"], [/\bboombox\b/, "boombox-mini", "tech"], [/\bbiscuit/, "biscuit-tin", "food"], [/\bsocks?\b/, "spare-sock", "everyday"], [/\bpens?\b/, "one-good-pen", "desk-home"], [/\bumbrellas?\b/, "other-umbrella", "everyday"], [/\bdaypacks?\b/, "daypack", "carry"], [/\bhelmets?\b/, "indoor-helmet", "everyday"], [/\btroph/, "trophy", "everyday"], [/\bstones?\b/, "skimming-stones", "outdoors"], [/\bpuddles?\b/, "starter-puddle", "desk-home"], [/\bjungle|plants?\b/, "pocket-jungle", "desk-home"], [/\baeroplanes?\b/, "paper-aeroplane", "everyday"], [/bubble wrap/, "bubble-wrap", "everyday"]];
const productIn = (t) => { const hit = PRODUCT_WORDS.find(([re]) => re.test(t)); return hit ? { id: hit[1], category: hit[2], name: hit[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) } : null; };

/** "Could an AI agent manage supplier communications?": a supplier in trouble, with and without your AI as the buyer. */
function supplierAiPlan() {
  const trouble = { type: "supplier_problem", day: 14, params: { supplier: "SUP-04", capacity_factor: 0.5, extra_lead_days: 10, days: 21 } };
  const ai = { type: "connect_ai", params: { connection: { kind: "cmd", cmd: "node simulation/simulator/examples/simple-supplier-mail.mjs" }, role: "buyer", cost_per_month: 0 } };
  return {
    arms: [arm("supplier-trouble", "Kestrel Paper & Pen in trouble from day 14 (staff buyer only)", [trouble]),
      arm("supplier-trouble-with-ai", "The same, with an AI as buyer handling supplier mail (replace the example command with your own)", [trouble, ai])],
    apps: ["stockroom", "letterbox", "till"], people: ["Robinson Crusoe (buyer)", "Supplier contacts (business/data/supplier-side.json), e.g. Trotty Veck at Kestrel Paper & Pen"],
    organisations: ["SUP-04 Kestrel Paper & Pen"], measures: ["stockouts", "lost_sales", "orders", "net_profit", "cash"],
    can: ["As buyer, the AI is sent the day's low-stock alert and each day's unread supplier mail (simulation/simulator/core.mjs doStock), with the buyer's tools: email, purchase orders, list_supplier_contacts, list_supplier_requests.",
      "Suppliers write back by rules (simulation/world/supplier-side.mjs): they warn of delays, query orders, answer lead-time questions, and agree to or refuse expedites, volume discounts and quantity changes by capacity, terms and how they have been treated. Agreed changes really change the purchase order.",
      "Suppliers remember rudeness, late payment and many changes, and become slower and less flexible."],
    cannot: ["Suppliers answer from fixed rules and a fixed set of requests; anything else gets a polite request to say what is needed.", "Switching to another supplier: each product has one.", "A volume discount lowers what the shop pays the supplier (cash), not the cost of goods in profit, which uses the catalogue cost.", "Nothing in the simulated business pays a bill late on its own, so late payment only counts if records show it."],
    build_next: ["Alternative suppliers per product."],
  };
}

const num = (text, re, fallback) => { const m = text.match(re); return m ? Number(m[1]) : fallback; };
const categoryIn = (t) => Object.entries(CATEGORIES).find(([, re]) => re.test(t))?.[0] ?? null;
// WHY clean the id: the lab's checker (simulation/lab/experiment.mjs) takes only letters, numbers, - and _ (so "x1.5" becomes "x1_5").
const arm = (id, label, interventions) => ({ id: String(id).replace(/[^a-z0-9_-]/gi, "_").slice(0, 40), label, interventions });

/**
 * The rules. Each: what it recognises, and what it puts in the plan. `can` and `cannot` are checked against the code
 * (file references given) so the plan never promises what the simulation does not do.
 */
const RULES = [
  {
    id: "delivery", match: /deliver|shipping|postage|free p&p/i,
    build(t) {
      const over = num(t, /£\s?(\d+(?:\.\d+)?)/, 50);
      return {
        arms: [
          arm("free-over-" + over, `Free standard delivery over £${over}`, [{ type: "delivery_charges", params: { price: 3.95, free_over: over } }]),
          arm("free-over-30", "Free standard delivery over £30", [{ type: "delivery_charges", params: { price: 3.95, free_over: 30 } }]),
          arm("always-free", "Standard delivery always free", [{ type: "delivery_charges", params: { price: 0, free_over: null } }]),
        ],
        apps: ["till", "tally"], measures: ["orders", "revenue", "net_profit", "customer_satisfaction"],
        can: ["Standard delivery is £3.95 and free over £50 today (business/data/business.json delivery.methods). Checkout charges whatever the rules say (engine place_order).", "Demand follows the change in what an order costs, with the same price elasticity as prices (simulation/simulator/core.mjs deliveryFactor).", "A shopper with a standard-delivery basket at 60% or more of the free-delivery threshold adds one more thing that reaches it, 30% of the time (simulation/simulator/top-up.mjs; an assumption in business/data/sim.json demand.basket_top_up), so a threshold also changes basket sizes."],
        cannot: [over === 50 ? "Free delivery over £50 is already the rule, so that arm is the same as the baseline; the others show the alternatives." : null, "The top-up rate is an assumption, not measured; survey figures on shoppers padding baskets are about whether people ever do it, not how often.", "Carrier costs to the shop do not change with the charge to the customer."].filter(Boolean),
        build_next: [],
      };
    },
  },
  {
    id: "returns", match: /return(s)? (policy|window|period)|refund policy|returns/i,
    build(t) {
      const days = num(t, /(\d+)\s*days?/, 14);
      return {
        arms: [arm(`window-${days}`, `${days}-day returns window`, [{ type: "returns_window", params: { days } }]), arm("window-7", "7-day returns window", [{ type: "returns_window", params: { days: 7 } }]), arm("window-60", "60-day returns window", [{ type: "returns_window", params: { days: 60 } }])],
        apps: ["front_desk", "filing_cabinet", "till"], measures: ["customer_satisfaction", "share_satisfied", "complaints", "repeat_contacts", "refunds", "net_profit"],
        can: ["The engine's returns tools follow the window (check_return_eligibility, create_return).", "Staff try to make the return a customer asks for; a return refused because the order is past the window leaves the customer only partly helped, which lowers satisfaction and their chance of buying again (simulation/simulator/core.mjs staffActions)."],
        cannot: ["Simulated customers ask to return things within 28 days of delivery (business/data/sim.json return_question.within_days), so a window longer than 28 days changes nothing.", "Shoppers do not choose whether to buy based on the returns window (no conversion effect)."],
        build_next: ["A conversion effect of the returns promise, and return requests later than 28 days."],
      };
    },
  },
  {
    id: "competitor", match: /competitor|rival|someone else|another shop|cheaper (version|copy|alternative)/i,
    build(t) {
      const product = productIn(t.toLowerCase());
      const cat = product ? product.category : categoryIn(t.toLowerCase()) || "tech";
      const copy = product || PRODUCT_FOR[cat];
      const pct = num(t, /(\d+)\s*%/, 20);
      return {
        arms: [arm("rival-launch", `A rival launches a similar product ${pct}% cheaper (${cat})`, [{ type: "competitor_move", params: { competitor: COMPETITOR_FOR[cat], launch_category: cat, price_factor: 1 - pct / 100, days: 60 } }]),
          arm("rival-copies-product", `A rival copies our ${copy.name}, ${pct}% cheaper`, [{ type: "competitor_move", params: { competitor: COMPETITOR_FOR[cat], product: copy.id, price_factor: 1 - pct / 100, days: 60 } }]),
          arm("rival-copies-we-cut", `The same, and we cut the ${copy.name}'s price 10%`, [{ type: "competitor_move", params: { competitor: COMPETITOR_FOR[cat], product: copy.id, price_factor: 1 - pct / 100, days: 60 } }, { type: "price_change", params: { percent: -10, scope: "product", target: copy.id } }])],
        apps: ["till", "daily_overthinker", "tally"], organisations: [COMPETITOR_FOR[cat]], measures: ["orders", "revenue", "net_profit", "lost_sales"],
        can: ["Competitors (business/data/organisations.json) take demand by category when their prices, advertising or range change (simulation/world/competitors.mjs), with reasons on every day.", "A launch can copy one named product of ours: the lost demand then lands on that product, not its siblings (simulation/world/competitors.mjs productCompetition; how close a copy it is, 0.5 against our own 1, is an assumption)."],
        cannot: ["Customers comparing named products side by side, or reading reviews of the copy."],
        build_next: [],
      };
    },
  },
  {
    id: "price", match: /pric(e|es|ing)|dearer|cheaper|charge more|charge less/i,
    build(t) {
      const pct = num(t, /(\d+(?:\.\d+)?)\s*%/, 10);
      const down = /cut|lower|cheaper|reduce|drop|down|fall|less/i.test(t);
      const cat = categoryIn(t.toLowerCase());
      const p = (x) => ({ type: "price_change", params: { percent: x, ...(cat ? { scope: "category", target: cat } : {}) } });
      const s = down ? -1 : 1;
      return {
        arms: [arm(`prices-${down ? "down" : "up"}-${pct}`, `Prices ${down ? "down" : "up"} ${pct}%${cat ? ` (${cat})` : ""}`, [p(s * pct)]), arm(`prices-${down ? "down" : "up"}-${pct / 2}`, `Prices ${down ? "down" : "up"} ${pct / 2}%`, [p(s * pct / 2)])],
        apps: ["till", "tally"], measures: ["orders", "revenue", "gross_profit", "net_profit", "customer_satisfaction"],
        can: ["Orders follow price with the price elasticity in business/data/sim.json (1.1), and each customer has a hidden price sensitivity (simulation/simulator/customers.mjs)."],
        cannot: ["Shoppers noticing a price change in the news or on social media."], build_next: [],
      };
    },
  },
  {
    id: "marketing", match: /market|advert|ads\b|promot/i,
    build(t) {
      const times = /double|twice/i.test(t) ? 2 : /half|halve/i.test(t) ? 0.5 : /tripl/i.test(t) ? 3 : 2;
      return {
        arms: [arm(`marketing-x${times}`, `Marketing budget × ${times}`, [{ type: "marketing_budget", params: { multiply: times } }]), arm("marketing-x1.5", "Marketing budget × 1.5", [{ type: "marketing_budget", params: { multiply: 1.5 } }])],
        apps: ["megaphone", "tally"], measures: ["orders", "visitors", "new_customers", "revenue", "net_profit"],
        can: ["Demand follows 1 + marketing elasticity × ln(spend ÷ plan), never below half, and spend is a daily cost (infrastructure/engine/levers.js)."],
        cannot: ["Which channel the money goes to (use a campaign for that)."], build_next: [],
      };
    },
  },
  {
    id: "sale", match: /\bsale\b|discount|% off|voucher|promo code/i,
    build(t) {
      const pct = Math.min(20, num(t, /(\d+)\s*%/, 10));
      return { arms: [arm(`sale-${pct}`, `A ${pct}% sale for two weeks`, [{ type: "sale", params: { percent: pct, days: 14 } }])],
        apps: ["megaphone", "till"], measures: ["orders", "revenue", "gross_profit", "net_profit"],
        can: ["A code gives its discount to about a quarter of buyers while it runs, and the discount lifts demand (infrastructure/engine/campaigns.js, simulation/simulator/campaigns.mjs)."], cannot: ["Discounts above 20% (the manager's limit)."], build_next: [] };
    },
  },
  {
    id: "supplier", match: /supplier|supply|stock ?out|shortage/i,
    build(t) {
      if (/\bai\b|agent|automat|bot/i.test(t)) return null; // "an AI to manage supplier communications": the AI rule
      return { arms: [arm("supplier-in-trouble", "Our ice supplier at half capacity, 10 days slower, for 3 weeks", [{ type: "supplier_problem", params: { supplier: "SUP-02", capacity_factor: 0.5, extra_lead_days: 10, days: 21 } }]),
        arm("all-suppliers-late", "All suppliers late four times as often for 3 weeks", [{ type: "supplier_disruption", params: { days: 21 } }])],
        apps: ["stockroom", "till", "front_desk"], organisations: ["SUP-02 Coldharbour Ice Works"], measures: ["stockouts", "lost_sales", "orders", "revenue", "complaints"],
        can: ["Purchase orders arrive late; empty shelves lose sales; some customers switch products (simulation/simulator/core.mjs)."], cannot: ["Switching to another supplier (each product has one). Writing to a supplier is possible: the supplier_email intervention asks for an expedite, a discount, a quantity change or lead times, and the supplier answers by its rules."], build_next: ["Alternative suppliers per product."] };
    },
  },
  {
    id: "staff", match: /hire|staff|team|employ|person for|extra pair of hands|cut hours/i,
    build() {
      return { arms: [arm("one-more-helper", "One more support agent, 28 hours a week", [{ type: "staffing", params: { action: "hire", role: "support_agent", weekly_hours: 28 } }]), arm("one-more-helper-part-time", "One more support agent, 14 hours a week", [{ type: "staffing", params: { action: "hire", role: "support_agent", weekly_hours: 14 } }])],
        apps: ["rota", "front_desk", "tally"], people: ["Mrs Hudson (support lead)", "Sam Weller and Esther Summerson (support agents)"], measures: ["first_response_minutes", "customer_satisfaction", "abandoned_contacts", "staff_task_hours", "net_profit"],
        can: ["A new hire works like the first person in that role; the queue moves faster and pay is a daily cost (infrastructure/engine/levers.js)."], cannot: ["Training time, or a new person being slower at first."], build_next: [] };
    },
  },
  {
    id: "event", match: /strike|heatwave|heat wave|weather|storm|recession|inflation|economy|trend|craze/i,
    build(t) {
      const arms = [];
      if (/strike/i.test(t)) arms.push(arm("postal-strike", "A two-week postal strike", [{ type: "postal_strike", params: { days: 14 } }]));
      if (/heat/i.test(t)) arms.push(arm("heatwave", "A one-week heatwave", [{ type: "heatwave", params: { days: 7 } }]));
      if (/recession|inflation|economy/i.test(t)) arms.push(arm("economy-shock", "Inflation up 3 points, confidence down 15", [{ type: "economy_shock", params: { inflation_shift: 3, confidence_shift: -15, days: 90 } }]));
      if (/trend|craze/i.test(t)) arms.push(arm("trend", `A trend in ${categoryIn(t.toLowerCase()) || "outdoors"}`, [{ type: "trend_boost", params: { category: categoryIn(t.toLowerCase()) || "outdoors", factor: 1.5, days: 30 } }]));
      if (!arms.length) arms.push(arm("storm", "A custom event: a week of storms", [{ type: "world_event", params: { title: "A week of storms", story: "Storms across the country.", effects: { demand: { all: 0.9 }, carrier_delay_days: 1 }, days: 7 } }]));
      return { arms, apps: ["daily_overthinker", "till", "front_desk"], measures: ["orders", "contacts", "late_parcels", "complaints", "net_profit"],
        can: ["World events and wider-world settings change demand, contacts, delays and costs while they run (infrastructure/engine/events.js, simulation/world/plugins.mjs), with their reasons each day."], cannot: [], build_next: [] };
    },
  },
  {
    id: "ai_customer_service", match: /(ai|agent|bot|assistant|chatbot).*(customer|enquir|complain|return|support|service)|(customer|support|service).*(ai|agent|bot|chatbot)/i,
    build() {
      return { overthink: true, arms: [arm("with-ai", "Your AI answers customers", [{ type: "connect_ai", params: { connection: { kind: "cmd", cmd: "node path/to/your-agent.mjs" }, role: "assistant", cost_per_month: 0 } }])],
        apps: ["front_desk", "letterbox", "till", "filing_cabinet"], people: ["Customers from business/data/characters.json", "Mrs Hudson (support lead)"], measures: ["customer_satisfaction", "first_response_minutes", "staff_task_hours", "wrong_actions", "complaints", "net_profit"],
        can: ["/overthink runs it through enquiries, complaints, returns, a prompt injection, a privacy request and a frustrated multi-turn customer (simulation/lab/situations), then a simulated stretch, and scores it (simulation/lab/scorecard.mjs).", "A scope can limit what it may read and act on; the lab's server enforces it."],
        cannot: ["Phone calls with real speech.", "The lab does not call any model: you connect your own."], build_next: [] };
    },
  },
  {
    id: "ai_other_role", match: /\b(ai|agent|bot|automat)/i,
    build(t) {
      const supplier = /supplier|stock|purchase|buy/i.test(t), marketing = /market|social|post|email/i.test(t);
      const role = supplier ? "buyer" : marketing ? "marketing" : "manager";
      if (supplier) return supplierAiPlan();
      return { arms: [arm(`ai-as-${role}`, `Your AI as ${role}`, [{ type: "connect_ai", params: { connection: { kind: "cmd", cmd: "node path/to/your-agent.mjs" }, role } }])],
        apps: supplier ? ["stockroom", "letterbox"] : marketing ? ["megaphone", "squint", "mutter", "letterbox"] : ["control_room", "till", "tally"],
        measures: supplier ? ["stockouts", "lost_sales", "orders", "net_profit"] : ["orders", "revenue", "net_profit", "social_reach", "unsubscribes"],
        can: [supplier ? "As buyer, it is sent the day's low-stock alert and can raise purchase orders through the engine's tools." : `As ${role}, it gets that role's daily work and tools.`],
        cannot: [], build_next: [] };
    },
  },
  {
    id: "launch", match: /launch|new product|introduce .* product|bring out/i,
    build() {
      return { arms: [], apps: ["till", "stockroom"], measures: ["orders", "revenue"],
        can: ["launch_product puts a prepared or discontinued product on sale; its demand follows its category with a fading novelty boost (simulation/simulator/core.mjs syncCatalogue)."],
        cannot: ["Inventing a brand-new product: the engine can only launch products already in the catalogue files, and this world has none waiting."],
        build_next: ["An engine tool to add a product (name, category, price, supplier) to a running world."] };
    },
  },
];

/**
 * Turns an idea into a plan. Nothing runs.
 * @param {string} idea
 * @param {object=} o
 * @param {?function(string, object): Promise<Array<object>>} o.suggest Bring-your-own model (off by default): given the
 *     idea and the catalogue, returns more arms ({ id, label, interventions }). Checked like anything else.
 * @return {Promise<object>}
 */
export async function planFromIdea(idea, { suggest = null } = {}) {
  const text = String(idea || "").trim().slice(0, 1000);
  if (!text) throw Object.assign(new Error("Type an idea, for example: What if we introduced free delivery on orders over £50?"), { code: "invalid_input" });
  const hits = [];
  for (const rule of RULES) {
    if (!rule.match.test(text)) continue;
    const built = rule.build(text);
    if (built) hits.push({ id: rule.id, ...built });
    if (rule.id === "ai_customer_service" && built) break; // the specific AI rule wins over the general one
  }
  // WHY only the first two: one idea, one experiment. Extra matches are usually words in passing ("cheaper" in a competitor idea).
  const has = (id) => hits.some((x) => x.id === id);
  // An AI to test is its own kind of plan; words like "returns" in it describe the situations, not a policy change.
  const used = has("ai_customer_service") ? hits.filter((h) => h.id === "ai_customer_service")
    : hits.filter((h) => !(h.id === "price" && (has("competitor") || has("delivery"))) && !(h.id === "launch" && has("competitor"))).slice(0, 2);
  let arms = used.flatMap((h) => h.arms);
  let suggested = null;
  if (suggest) {
    try { suggested = await suggest(text, { interventions: listInterventions() }); arms = [...arms, ...(Array.isArray(suggested) ? suggested : [])]; } catch (e) { suggested = { error: String(e.message || e) }; }
  }
  arms = dedupe(arms).slice(0, 4);
  const isAi = used.some((h) => h.overthink);
  const days = isAi ? 14 : 30, seeds = isAi ? 3 : 5;
  const experiment = { title: text.replace(/\?$/, ""), question: text, start: { size: "standard" }, days, seeds, arms };
  let problem = null;
  try { if (arms.length) checkExperiment(experiment); } catch (e) { problem = e.message; }
  const situations = isAi ? loadSituations().map((s) => ({ id: s.id, title: s.title })) : [];
  return {
    idea: text,
    understood_as: used.length ? used.map((h) => h.id.replace(/_/g, " ")) : [],
    kind: isAi ? "overthink" : "experiment",
    experiment,
    ...(isAi ? { overthink: { how: "Connect your AI (a command or a web address speaking the tool protocol, simulation/simulator/README.md), then run node simulation/lab/overthink.mjs --cmd \"...\" or POST /lab/overthink.", situations } } : {}),
    world_parts: {
      apps: [...new Set(used.flatMap((h) => h.apps || []))].map((a) => APPS[a] || a),
      people: [...new Set(used.flatMap((h) => h.people || []))],
      organisations: [...new Set(used.flatMap((h) => h.organisations || []))],
    },
    measures: [...new Set(used.flatMap((h) => h.measures || []))],
    duration: { days, seeds, why: isAi ? "Two weeks is enough for a few hundred customer contacts on the standard world; three seeds show whether the effect is luck." : "A month covers a full stock cycle and enough orders for a price or policy effect to show; five seeds give a 90% interval." },
    can_model: used.flatMap((h) => h.can || []),
    cannot_model: used.flatMap((h) => h.cannot || []),
    would_need_building: used.flatMap((h) => h.build_next || []),
    ...(used.length ? {} : { note: "No rule matched this idea, so the plan has no changes yet. Pick interventions from the catalogue (GET /lab/interventions) and add them to an arm." }),
    ...(problem ? { problem } : {}),
    model_hook: suggest ? { used: true, result: suggested } : { used: false, note: "Off by default. A bring-your-own model can suggest extra arms (planFromIdea(idea, { suggest })); none is needed." },
    next: "Edit the experiment (arms, parameters, days, seeds), then run it: POST /lab/experiments with { \"experiment\": ... } or node simulation/lab/cli.mjs run plan.json.",
  };
}

function dedupe(arms) {
  const seen = new Set();
  return arms.filter((a) => {
    const k = JSON.stringify(a.interventions);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
