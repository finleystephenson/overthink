// The changes a what-if can make, by rules (no model needed): what a sentence means, the plan it becomes, and how the
// change is made through the shop's own tools, so the engine's rules apply and the records show it.
//
// A change is data: { type, ...params }. understand(text) turns words into one; planOf(change) says what it will do,
// what it touches, what is measured and what this world cannot model; applyChange(change, handle) makes it.

const PRODUCTS = [
  ["biscuit-tin", "The Biscuit Tin", "food", ["biscuit", "biscuits", "tin"]], ["emergency-sandwich", "The Emergency Sandwich", "food", ["sandwich", "sandwiches"]],
  ["ice-by-post", "Ice by Post", "food", ["ice"]], ["blip", "Blip", "tech", ["blip"]], ["boombox-mini", "Boombox Mini", "tech", ["boombox", "speaker"]],
  ["bubble-wrap", "Bubble Wrap", "everyday", ["bubble", "wrap"]], ["daypack", "The Daypack", "carry", ["daypack", "bag", "rucksack"]],
  ["indoor-helmet", "The Indoor Helmet", "everyday", ["helmet"]], ["one-good-pen", "One Good Pen", "desk-home", ["pen", "pens"]],
  ["other-umbrella", "The Other Umbrella", "everyday", ["umbrella"]], ["paper-aeroplane", "The Paper Aeroplane", "everyday", ["aeroplane", "plane"]],
  ["pocket-jungle", "Pocket Jungle", "desk-home", ["jungle", "plant", "terrarium"]], ["skimming-stones", "Skimming Stones", "outdoors", ["stones", "skimming"]],
  ["spare-sock", "The Spare Sock", "everyday", ["sock", "socks"]], ["starter-puddle", "Starter Puddle", "desk-home", ["puddle"]], ["trophy", "The Trophy", "everyday", ["trophy"]],
];
const CATEGORIES = { food: ["food", "chilled", "edible"], tech: ["tech", "gadget", "gadgets", "electronics"], everyday: ["everyday"], outdoors: ["outdoor", "outdoors"],
  "desk-home": ["desk", "home", "office"], carry: ["carry", "bags", "luggage"] };
const CATEGORY_WORDS = { food: "food", tech: "technology", everyday: "everyday things", outdoors: "outdoor things", "desk-home": "desk and home things", carry: "bags" };
const ROLES = { support_agent: ["help desk", "helpdesk", "customer help", "support", "customer service", "answer", "emails", "phone"], warehouse: ["warehouse", "pack", "packing", "packer", "stockroom", "dispatch"],
  marketing: ["marketing", "social media", "posts"], buyer: ["buyer", "buying", "stock"] };
const ROLE_WORDS = { support_agent: "customer help", warehouse: "the warehouse", marketing: "marketing", buyer: "buying stock" };

/** Ready questions, each a change written as data. The first screen and the what-if list show these. */
export const READY = [
  { q: "What if prices went up 10%?", change: { type: "price", percent: 10 } },
  { q: "What if we cut food prices by 15%?", change: { type: "price", percent: -15, category: "food" } },
  { q: "What if we doubled the marketing?", change: { type: "marketing", multiply: 2 } },
  { q: "What if we stopped all marketing?", change: { type: "marketing", multiply: 0 } },
  { q: "What if the help desk had one more person?", change: { type: "staff", role: "support_agent", hours: 28 } },
  { q: "What if there were a postal strike?", change: { type: "event", template: "rs-postal-strike", title: "Postal strike", days: 7 } },
  { q: "What if we ran a 15% sale for two weeks?", change: { type: "sale", percent: 15, days: 14 } },
];

const words = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9£%.\s-]/g, " ").replace(/\s+/g, " ")} `;
const has = (t, list) => list.some((w) => t.includes(` ${w} `) || (w.includes(" ") && t.includes(w)));

/**
 * What a sentence asks to change, by rules. Null when no rule matches (the caller may then try the visitor's own model).
 * @param {string} text
 * @param {Array<object>=} templates the world's event library (list_event_templates), for "a heatwave", "a storm"...
 * @return {?object} a change
 */
export function understand(text, templates = []) {
  const t = words(text);
  const pct = t.match(/(-?\d+(?:\.\d+)?)\s*(?:%|per ?cent)/);
  const n = pct ? Math.abs(Number(pct[1])) : null;
  const down = has(t, ["cut", "cuts", "lower", "lowered", "down", "cheaper", "reduce", "reduced", "less", "drop", "dropped", "fall", "fell"]);
  const daysM = t.match(/(\d+)\s*(day|days|week|weeks|month|months)/);
  const days = daysM ? Number(daysM[1]) * (/week/.test(daysM[2]) ? 7 : /month/.test(daysM[2]) ? 30 : 1) : null;
  const twoWeeks = has(t, ["two weeks", "a fortnight", "fortnight"]) ? 14 : has(t, ["a week", "one week"]) ? 7 : has(t, ["a month", "one month"]) ? 30 : null;

  // A sale or discount code (before prices: "15% off" is a sale, not a price change).
  if (has(t, ["sale", "discount", "off", "code", "promotion"]) && !has(t, ["marketing", "advertising"])) {
    return { type: "sale", percent: Math.min(20, Math.max(1, n ?? 10)), days: days || twoWeeks || 14 };
  }
  // Marketing.
  if (has(t, ["marketing", "advertising", "adverts", "ads", "advertise"])) {
    const pounds = t.match(/£\s?(\d[\d,]*)/);
    if (pounds) return { type: "marketing", monthly: Number(pounds[1].replace(/,/g, "")) };
    if (has(t, ["stop", "stopped", "no", "none", "zero", "scrap", "end"])) return { type: "marketing", multiply: 0 };
    if (has(t, ["triple", "tripled", "three times"])) return { type: "marketing", multiply: 3 };
    if (has(t, ["half", "halve", "halved"])) return { type: "marketing", multiply: 0.5 };
    if (n != null) return { type: "marketing", multiply: Math.max(0, 1 + (down ? -n : n) / 100) };
    return { type: "marketing", multiply: down ? 0.5 : 2 };
  }
  // Prices.
  if (has(t, ["price", "prices", "dearer", "cheaper", "charge", "charged", "cost", "costs"])) {
    const product = PRODUCTS.find(([, , , ws]) => has(t, ws));
    const category = Object.entries(CATEGORIES).find(([, ws]) => has(t, ws))?.[0] || null;
    const up = has(t, ["up", "raise", "raised", "rise", "rose", "increase", "increased", "dearer", "more", "higher"]);
    const size = n ?? 10;
    return { type: "price", percent: (down && !up) || (pct && Number(pct[1]) < 0) ? -size : size, ...(product ? { product: product[0] } : category ? { category } : {}) };
  }
  // The team.
  if (has(t, ["hire", "hired", "hiring", "person", "people", "staff", "someone", "employee", "worker", "team", "agent"])) {
    const role = Object.entries(ROLES).find(([, ws]) => has(t, ws))?.[0] || "support_agent";
    if (has(t, ["fewer", "lose", "lost", "fire", "sack", "quit", "leaves", "left"])) return { type: "staff", role, hours: 28, remove: true };
    return { type: "staff", role, hours: 28 };
  }
  // A post.
  if (has(t, ["post", "picture", "photo", "squint"])) return { type: "post" };
  // A world event from the library: the template whose title shares the most words.
  const strong = t.split(" ").filter((w) => w.length > 3 && !["what", "there", "were", "happened", "would", "with", "about", "week", "days", "month", "happen"].includes(w));
  let best = null;
  for (const tp of templates) {
    const tw = words(`${tp.title} ${(tp.tags || []).join(" ")}`);
    const score = strong.filter((w) => tw.includes(` ${w} `) || tw.includes(` ${w.replace(/s$/, "")} `)).length;
    if (score && (!best || score > best.score || (score === best.score && tp.family !== "calendar"))) best = { tp, score };
  }
  if (best) return { type: "event", template: best.tp.id, title: best.tp.title, days: days || twoWeeks || 7 };
  return null;
}

/** "Putting every price up 10%" etc.: the change as something being done. */
export function doing(c) {
  switch (c.type) {
    case "price": return `${c.percent > 0 ? "Putting" : "Cutting"} ${scopeWords(c)} ${c.percent > 0 ? "up" : "by"} ${Math.abs(c.percent)}%`.replace("Cutting every price by", "Cutting every price by");
    case "marketing": return c.monthly != null ? `Spending £${c.monthly} a month on marketing` : c.multiply === 0 ? "Stopping all marketing" : c.multiply === 2 ? "Doubling the marketing" : `Setting marketing to ${Math.round(c.multiply * 100)}% of the plan`;
    case "staff": return c.remove ? `Losing someone from ${ROLE_WORDS[c.role]}` : `Adding a person to ${ROLE_WORDS[c.role]}`;
    case "event": return `A ${c.title.toLowerCase()} for ${c.days} days`;
    case "sale": return `A ${c.percent}% sale for ${c.days} days`;
    case "post": return "Posting a picture of a product";
    default: return "A change";
  }
}

function scopeWords(c) {
  if (c.product) return `the price of ${PRODUCTS.find((p) => p[0] === c.product)?.[1] || "one product"}`;
  if (c.category) return `prices of ${CATEGORY_WORDS[c.category]}`;
  return "every price";
}

/** A short name for a chart line or a list: "Prices up 10%". */
export function shortName(c) {
  switch (c.type) {
    case "price": return `${c.product ? PRODUCTS.find((p) => p[0] === c.product)?.[1] : c.category ? CATEGORY_WORDS[c.category][0].toUpperCase() + CATEGORY_WORDS[c.category].slice(1) : "Prices"} ${c.percent > 0 ? "up" : "down"} ${Math.abs(c.percent)}%`;
    case "marketing": return c.monthly != null ? `Marketing £${c.monthly}` : c.multiply === 0 ? "No marketing" : `Marketing ×${c.multiply}`;
    case "staff": return c.remove ? `One fewer in ${ROLE_WORDS[c.role]}` : `One more in ${ROLE_WORDS[c.role]}`;
    case "event": return c.title;
    case "sale": return `${c.percent}% sale`;
    case "post": return "A picture posted";
    default: return "Change";
  }
}

const MEASURED = ["Profit", "Money taken", "Orders", "How happy customers are", "Complaints", "How long customers wait for a reply", "Sales lost to empty shelves", "Who was affected, by name"];

/**
 * The plan for a change, before anything runs: what it will do (and through which of the shop's tools), the parts of
 * the world involved, what is measured, and what this world cannot model.
 */
export function planOf(c) {
  const parts = [];
  const steps = [];
  const cannot = ["Real people: these are simulated shoppers, so the result is evidence about this world, not a forecast."];
  switch (c.type) {
    case "price": {
      const ps = c.product ? PRODUCTS.filter((p) => p[0] === c.product) : c.category ? PRODUCTS.filter((p) => p[2] === c.category) : PRODUCTS;
      steps.push(`Change the price of ${ps.length === PRODUCTS.length ? "every product and accessory" : ps.map((p) => p[1]).join(", ")} by ${c.percent > 0 ? "+" : ""}${c.percent}%, from today. Orders already placed keep their price.`);
      steps.push("Done by the manager with the shop's price tool, so it shows in the price history.");
      parts.push(...ps.slice(0, 8).map(([id, name]) => ({ kind: "product", id, title: name })), { kind: "ring", id: "customers", title: "Every customer who looks at those products" }, { kind: "ring", id: "competitors", title: "Competitors selling the same things" });
      cannot.push("Shoppers telling each other about the new prices.");
      break;
    }
    case "marketing":
      steps.push(c.monthly != null ? `Set the marketing budget to £${c.monthly} a month.` : c.multiply === 0 ? "Set the marketing budget to nothing." : `Set the marketing budget to ${c.multiply} times the plan.`);
      steps.push("More spend brings more visitors, with less extra each time; the spend is a cost every day.");
      parts.push({ kind: "app", id: "megaphone", title: "Megaphone · Marketing" }, { kind: "org", id: "shoutabout", title: "Shoutabout, the ad network" }, { kind: "ring", id: "customers", title: "People who have not found the shop yet" });
      cannot.push("Which advert or message works best: the money moves demand, not the wording.");
      break;
    case "staff":
      steps.push(c.remove ? `Let one person in ${ROLE_WORDS[c.role]} go, from tomorrow.` : `Hire one person into ${ROLE_WORDS[c.role]}, ${c.hours} hours a week, from tomorrow. They work like the first person in that job.`);
      steps.push("Pay follows the hours. Work that waits gets done sooner, or later.");
      parts.push({ kind: "app", id: "rota", title: "Rota · Who works when" }, { kind: "app", id: "front-desk", title: "Front Desk · Customer help" }, { kind: "ring", id: "team", title: "The team" });
      cannot.push("Training time, sick days and how well a new person fits in.");
      break;
    case "event":
      steps.push(`Start "${c.title}" tomorrow, for ${c.days} days, from the world's library of events.`);
      steps.push("It is printed in the news, and changes what shoppers, couriers or suppliers do while it lasts.");
      parts.push({ kind: "force", id: "events", title: "Events" }, { kind: "force", id: "news", title: "The news" }, { kind: "org", id: "swiftway-parcels", title: "The couriers" });
      cannot.push("Knock-on effects outside the shop, such as other businesses closing.");
      break;
    case "sale":
      steps.push(`Start a sale: ${c.percent}% off with a code, for ${c.days} days.`);
      steps.push("About a quarter of buyers use the code while it runs; lower prices also bring more buyers.");
      parts.push({ kind: "app", id: "megaphone", title: "Megaphone · Marketing" }, { kind: "app", id: "till", title: "Till · Orders" }, { kind: "ring", id: "customers", title: "Every customer" });
      cannot.push("Customers who wait for the next sale instead of buying now.");
      break;
    case "post":
      steps.push("Post one picture of a product on Squint, the shop's photo account.");
      parts.push({ kind: "app", id: "squint", title: "Squint · Photos" }, { kind: "ring", id: "customers", title: "Followers and their friends" });
      cannot.push("What the picture looks like: posts are scored by their words and timing, not seen.");
      break;
  }
  return { title: doing(c), steps, parts, measured: MEASURED, cannot };
}

// ------------------------------------------------------------------ making a change (through the shop's tools)

const REASON = "A what-if from the explorer";

async function ok(p) {
  const r = await p;
  if (!r?.ok) throw new Error(r?.error?.message || "The shop refused the change.");
  return r.data;
}

/** Every size and accessory with its price. */
async function everySku(h) {
  const cat = await ok(h.call("search_catalogue", { query: "the" }));
  const ids = (cat.results || []).filter((r) => r.kind === "product" || r.kind === "accessory").map((r) => r.id);
  const products = await Promise.all(ids.map((id) => ok(h.call("get_product", { id }))));
  const lines = [];
  for (const p of products) {
    for (const v of p.variants || []) if (Number.isFinite(v.price) && v.price > 0) lines.push({ sku: v.sku, price: v.price, product: p.id, category: p.category });
    for (const a of p.accessories || []) if (Number.isFinite(a.price) && a.price > 0) lines.push({ sku: a.sku, price: a.price, product: p.id, category: p.category });
  }
  return [...new Map(lines.map((l) => [l.sku, l])).values()];
}

/**
 * Makes a change in one world through the shop's own tools. Resolves to plain lines of what was done.
 * @param {object} c the change
 * @param {{call: function(string, object): Promise<object>, clock: function(): Promise<object>}} h a world handle
 */
export async function applyChange(c, h) {
  switch (c.type) {
    case "price": {
      const all = await everySku(h);
      const lines = all.filter((l) => (c.product ? l.product === c.product : c.category ? l.category === c.category : true));
      if (!lines.length) throw new Error("No prices matched that.");
      for (const l of lines) await ok(h.call("change_price", { sku: l.sku, new_price: Math.max(0.5, Math.round(l.price * (1 + c.percent / 100) * 100) / 100), reason: REASON }));
      return [`${lines.length} prices changed by ${c.percent > 0 ? "+" : ""}${c.percent}%.`];
    }
    case "marketing": {
      const lv = await ok(h.call("get_levers", {}));
      const plan = lv.planned_marketing_per_month ?? 0;
      const monthly = c.monthly ?? Math.round(plan * c.multiply);
      await ok(h.call("set_marketing_budget", { monthly, reason: REASON }));
      return [`Marketing: £${lv.marketing_per_month ?? plan} → £${monthly} a month.`];
    }
    case "staff": {
      if (c.remove) {
        const lv = await ok(h.call("get_levers", {}));
        const who = [...(lv.team || [])].reverse().find((p) => p.role === c.role);
        if (!who) throw new Error("Nobody does that job.");
        await ok(h.call("set_staffing", { action: "remove", staff_id: who.id, reason: REASON }));
        return [`${who.name} has left.`];
      }
      const r = await ok(h.call("set_staffing", { action: "add", role: c.role, weekly_hours: c.hours, reason: REASON }));
      return [`${r.name || "A new person"} joins ${ROLE_WORDS[c.role]}, ${c.hours} hours a week.`];
    }
    case "event": {
      const r = await ok(h.call("add_world_event", { template: c.template, duration_days: c.days }));
      return [`${r.title} from ${r.start} to ${r.end}.`];
    }
    case "sale": {
      const clock = await h.clock();
      const start = String(clock.date || clock.now).slice(0, 10);
      const end = new Date(Date.parse(`${start}T00:00:00Z`) + c.days * 864e5).toISOString().slice(0, 10);
      await ok(h.call("create_campaign", { name: `Sale: ${c.percent}% off`, channel: "email", start, end, monthly_spend: 0, code: `SAVE${c.percent}`, discount_pct: c.percent }));
      return [`Code SAVE${c.percent}: ${c.percent}% off until ${end}.`];
    }
    case "post": {
      const pics = await ok(h.call("list_post_pictures", {}));
      const pick = (pics.pictures || [])[0];
      if (!pick) throw new Error("There were no pictures to post.");
      await ok(h.call("create_social_post", { network: "squint", text: `${pick.name}. Made properly, for a problem you did not know you had.`, image: pick.path, product_id: pick.product_id }));
      return [`A picture of ${pick.name} is on Squint.`];
    }
    default: throw new Error("This kind of change is not known.");
  }
}
