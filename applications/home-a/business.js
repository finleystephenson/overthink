// The business behind the first screen, shared by both designs of it (home-a and home-b).
// Four jobs: read what is happening in the business right now, make a "move" (a decision to test),
// say what a week did against the same business left alone, and connect an outside AI.
// Everything goes through the shared client, so an outside AI doing the same things shows up here too.
import { money, num, plural, timeParts } from "../lib/ui.js";
import { plainText } from "../lib/plain.js";
import { MEASURES, formatMeasure, headline, toneOf, isSame } from "../lib/impact.js";
import { isScreenRead } from "../lib/client.js";

const LOOK = { screen: true };
const MOVE_REASON = "Tried from the home screen";

// ------------------------------------------------------------------ reading the business

/** What a customer got in touch about, in words. The data stores a topic code. */
const TOPICS = {
  where_is_my_order: "asked where their order is",
  product_question: "asked about a product",
  return_request: "wants to send something back",
  refund_request: "asked for their money back",
  complaint: "made a complaint",
  damaged: "says something arrived broken",
  faulty: "says something does not work",
  wrong_item: "got the wrong thing",
  delivery_change: "wants to change a delivery",
  cancel: "wants to cancel an order",
};

function topicWords(topic) {
  return TOPICS[topic] || (topic ? `got in touch about ${String(topic).replace(/_/g, " ")}` : "got in touch");
}

/** Reads one tool and hands back its data, or null. A screen should never break because one app is quiet. */
async function look(world, tool, input = {}) {
  try {
    const r = await world.call(tool, input, LOOK);
    return r?.ok ? r.data : null;
  } catch {
    return null;
  }
}

/**
 * Everything the first screen shows about the business right now, from real records.
 * @param {object} world the shared client
 * @return {Promise<object>} { now, daysMoved, marketing, team, mail, news, picture, mutter, chat, waiting, money }
 */
export async function readBusiness(world) {
  const [clock, inbox, boxes, news, squint, mutter, chat, contacts, snap, levers] = await Promise.all([
    world.clock().catch(() => null),
    look(world, "list_emails", { mailbox: "hello", folder: "inbox", limit: 1 }),
    look(world, "list_mailboxes"),
    look(world, "list_news", { limit: 1 }),
    look(world, "list_social_posts", { network: "squint", kind: "post", limit: 8 }),
    look(world, "list_social_posts", { network: "mutter", kind: "post", limit: 4 }),
    look(world, "read_channel", { channel: "general", limit: 1 }),
    look(world, "list_contacts"),
    look(world, "business_snapshot"),
    look(world, "get_levers"),
  ]);
  const email = inbox?.emails?.[0];
  const story = news?.news?.[0];
  const pic = squint?.posts?.find((p) => p.image && p.author?.kind === "company");
  const short = mutter?.posts?.find((p) => p.author?.kind === "company") || mutter?.posts?.[0];
  const line = chat?.messages?.[0];
  const latest = contacts?.contacts?.[0];
  const who = latest?.customer_id ? await look(world, "get_customer", { customer_id: latest.customer_id }) : null;
  return {
    now: clock?.now || snap?.as_of || null,
    daysMoved: clock?.day || 0,
    marketing: levers ? (levers.marketing_per_month ?? levers.planned_marketing_per_month) : null,
    team: levers?.team?.length || 0,
    mail: email && {
      id: email.id,
      subject: plainText(email.subject),
      from: email.from?.name || email.from?.address || "Someone",
      at: email.at,
      unread: (boxes?.mailboxes || []).reduce((n, m) => n + (m.unread || 0), 0),
    },
    news: story && { id: story.id, headline: plainText(story.headline), section: story.section, at: story.at },
    picture: pic && { id: pic.id, src: `/${pic.image.replace(/^\//, "")}`, text: plainText(pic.text), likes: pic.likes || 0, at: pic.at },
    mutter: short && { id: short.id, text: plainText(short.text), likes: short.likes || 0, at: short.at },
    chat: line && { id: line.id, from: line.from_name, text: plainText(line.text), at: line.at },
    waiting: {
      count: (snap?.unanswered_contacts || 0) + (snap?.open_cases || 0),
      latest: latest && { id: latest.id, name: who?.name || "A customer", says: topicWords(latest.topic), at: latest.at },
    },
    money: snap && { cash: snap.cash, monthOrders: snap.this_month?.orders || 0, monthRevenue: snap.this_month?.revenue || 0, outOfStock: snap.stockouts?.count || 0 },
  };
}

/**
 * Adds up the days a run of time produced: orders, money taken, profit.
 * @param {Array<object>} days from the ot:day event
 * @return {{days: number, orders: number, revenue: number, net: number, contacts: number}}
 */
export function addUpDays(days) {
  const t = { days: 0, orders: 0, revenue: 0, net: 0, contacts: 0 };
  for (const d of days || []) {
    const s = d?.summary || d;
    if (!s || typeof s !== "object") continue;
    t.days += 1;
    t.orders += s.orders || 0;
    t.revenue += s.revenue || 0;
    t.net += s.net || 0;
    t.contacts += s.contacts || 0;
  }
  return t;
}

/** "Monday 23 November" */
export function dayName(iso) {
  if (!iso) return "";
  const p = timeParts(iso);
  return `${p.weekday} ${p.day} ${p.month}`;
}

// ------------------------------------------------------------------ moves (decisions to test)

/** Every product and accessory with its sizes and prices. Read once, when a price move needs it. */
async function everySku(world) {
  const cat = await look(world, "search_catalogue", { query: "the" });
  const ids = (cat?.results || []).filter((r) => r.kind === "product" || r.kind === "accessory").map((r) => r.id);
  const products = await Promise.all(ids.map((id) => look(world, "get_product", { id })));
  const all = products.flatMap((p) => (p?.variants || []).filter((v) => Number.isFinite(v.price) && v.price > 0));
  // WHY by sku: some sizes share one stock code, and the second change to the same code would be refused.
  return [...new Map(all.map((v) => [v.sku, v])).values()];
}

/** Moves every price by the same share. WHY one share: the range keeps its shape, so the test is fair. */
async function movePrices(world, share) {
  const skus = await everySku(world);
  if (!skus.length) throw new Error("The shop did not list its prices.");
  const results = await Promise.all(skus.map((v) => world.call("change_price", {
    sku: v.sku, new_price: Math.max(0.5, Math.round(v.price * share * 100) / 100), reason: MOVE_REASON,
  })));
  const bad = results.find((r) => !r.ok);
  if (bad) throw new Error(bad.error.message);
  return skus.length;
}

async function setMarketing(world, toMonthly) {
  const lv = await look(world, "get_levers");
  const now = lv?.marketing_per_month ?? lv?.planned_marketing_per_month ?? 0;
  const next = Math.round(toMonthly(now));
  const r = await world.call("set_marketing_budget", { monthly: next });
  if (!r.ok) throw new Error(r.error.message);
  return { was: now, now: next };
}

/** A company picture post on Squint, of a product the shop has not shown lately. */
async function postPicture(world) {
  const [pics, posts] = await Promise.all([look(world, "list_post_pictures"), look(world, "list_social_posts", { network: "squint", kind: "post", limit: 12 })]);
  const recent = new Set((posts?.posts || []).map((p) => p.image));
  const pool = (pics?.pictures || []).filter((p) => !recent.has(p.path));
  const pick = pool[Math.floor(Math.random() * pool.length)] || pics?.pictures?.[0];
  if (!pick) throw new Error("There were no pictures to post.");
  const text = `${pick.name}. Made properly, for a problem you did not know you had. In the shop now.`;
  const r = await world.call("create_social_post", { network: "squint", text, image: pick.path, product_id: pick.product_id });
  if (!r.ok) throw new Error(r.error.message);
  return pick;
}

async function moreHelpDeskHours(world) {
  const lv = await look(world, "get_levers");
  const person = lv?.team?.find((p) => p.role === "support_agent") || lv?.team?.find((p) => p.role === "support_lead");
  if (!person) throw new Error("Nobody works on the help desk.");
  const max = lv.limits?.weekly_hours?.[1] ?? 48;
  const hours = Math.min(max, person.weekly_hours + 10);
  const r = await world.call("set_staffing", { action: "hours", staff_id: person.id, weekly_hours: hours, reason: MOVE_REASON });
  if (!r.ok) throw new Error(r.error.message);
  return { name: person.name, hours };
}

/**
 * The decisions anyone can test from the first screen. Each `run` calls ordinary tools and resolves to a plain
 * sentence of what was done. `colour` and `pic` are for the card.
 */
export const MOVES = [
  {
    id: "prices-up", title: "Put every price up 10%", short: "Prices up 10%", colour: "#57c98a", pic: "/img/branded/trophy.jpg",
    async run(world) { const n = await movePrices(world, 1.1); return `Every price is now 10% higher (${plural(n, "price")} changed).`; },
  },
  {
    id: "prices-down", title: "Cut every price by 10%", short: "Prices down 10%", colour: "#5fc3ec", pic: "/img/branded/biscuit-tin.jpg",
    async run(world) { const n = await movePrices(world, 0.9); return `Every price is now 10% lower (${plural(n, "price")} changed).`; },
  },
  {
    id: "marketing-double", title: "Double the marketing", short: "Marketing doubled", colour: "#ff5a4e", pic: "/img/branded/boombox-mini.jpg",
    async run(world) { const m = await setMarketing(world, (v) => Math.max(v * 2, 20)); return `Marketing goes from ${money(m.was)} to ${money(m.now)} a month.`; },
  },
  {
    id: "marketing-off", title: "Stop all marketing", short: "Marketing stopped", colour: "#c9b9f2", pic: "/img/branded/paper-aeroplane.jpg",
    async run(world) { await setMarketing(world, () => 0); return "Marketing is stopped. Nobody new will hear about the shop."; },
  },
  {
    id: "post", title: "Post a picture", short: "A picture posted", colour: "#f45ba6", pic: "/img/branded/daypack.jpg",
    async run(world) { const p = await postPicture(world); return `A picture of ${p.name} is on Squint.`; },
  },
  {
    id: "hours", title: "Give the help desk 10 more hours", short: "More help desk hours", colour: "#ff7433", pic: "/img/branded/spare-sock.jpg",
    async run(world) { const h = await moreHelpDeskHours(world); return `${h.name} now works ${plural(h.hours, "hour")} a week.`; },
  },
];

// ------------------------------------------------------------------ the result, in words

/** The measures worth a sentence, in the order people care about them. */
// Profit is left out: the headline and the side-by-side figures already say it.
const SAY = ["revenue", "orders", "complaints", "customer_satisfaction", "first_response_minutes", "lost_sales", "social_reach", "followers"];

/**
 * Turns the impact into a few short sentences: this business against the same business left alone.
 * @param {object} imp from client.impact()
 * @return {{headline: string, tone: string, days: number, same: boolean, lines: Array<{key: string, text: string, tone: string, you: string, alone: string}>}}
 */
export function explainImpact(imp) {
  if (!imp?.available || !imp.days_compared) return { headline: "", tone: "neutral", days: 0, same: true, lines: [] };
  const same = isSame(imp);
  const h = headline(imp);
  const lines = [];
  for (const key of SAY) {
    const m = imp.measures?.[key];
    if (!m || m.difference == null || Math.abs(m.difference) < 0.005) continue;
    lines.push({ key, text: sentence(key, m.difference), tone: toneOf(key, m.difference), you: formatMeasure(key, m.live), alone: formatMeasure(key, m.shadow) });
  }
  return { headline: h.text, tone: h.tone, days: imp.days_compared, same, lines: lines.slice(0, 4) };
}

/** One measure's difference as a sentence a 12-year-old can read. */
function sentence(key, diff) {
  const up = diff > 0;
  const n = Math.abs(diff);
  switch (key) {
    case "net_profit": return `${money(n)} ${up ? "more" : "less"} profit.`;
    case "revenue": return `${money(n)} ${up ? "more" : "less"} money taken.`;
    case "orders": return `${plural(Math.round(n) || 1, up ? "more order" : "fewer order", up ? "more orders" : "fewer orders")}.`;
    case "complaints": return `${plural(Math.round(n) || 1, up ? "more complaint" : "fewer complaint", up ? "more complaints" : "fewer complaints")}.`;
    case "customer_satisfaction": return up ? "Customers were a little happier." : "Customers were a little less happy.";
    case "first_response_minutes": return up ? `Customers waited ${Math.round(n)} minutes longer for a reply.` : `Customers got a reply ${Math.round(n)} minutes sooner.`;
    case "lost_sales": return up ? `${plural(Math.round(n) || 1, "more sale")} lost to empty shelves.` : `${plural(Math.round(n) || 1, "fewer sale")} lost to empty shelves.`;
    case "social_reach": return `${num(Math.round(n))} ${up ? "more" : "fewer"} people saw the shop's posts.`;
    case "followers": return `${plural(Math.round(n) || 1, up ? "new follower" : "follower lost", up ? "new followers" : "followers lost")}.`;
    default: return `${MEASURES[key]?.label || key}: ${up ? "up" : "down"} ${formatMeasure(key, n)}.`;
  }
}

// ------------------------------------------------------------------ what an outside AI did

/** Plain words for the things an AI does most. Anything else is described from the tool's own name. */
const DID = {
  send_email: "sent an email", draft_email: "wrote a draft email", mark_email: "sorted the email", reply_social_post: "answered someone on social media",
  create_social_post: "posted on social media", like_social_post: "liked a post", send_social_message: "sent a private message",
  change_price: "changed a price", set_marketing_budget: "changed the marketing budget", set_staffing: "changed someone's hours",
  issue_refund: "gave a refund", create_return: "started a return", open_case: "opened a case", resolve_case: "closed a case",
  add_case_note: "wrote a note on a case", send_chat_message: "said something in staff chat", create_purchase_order: "ordered stock",
  place_order: "placed an order", update_order: "changed an order", cancel_order: "cancelled an order", add_world_event: "made something happen in the world",
  launch_product: "launched a product", verify_customer: "checked who a customer is", escalate: "passed a customer to a person", discontinue_product: "stopped selling a product", business_snapshot: "looked at the figures",
};

/**
 * The outside AI's actions in a change from client.onChange, as plain lines (newest first).
 * @param {Array<object>} entries trace entries
 * @param {string} ownerTokenId this screen's own key, whose actions are not "the AI"
 * @return {Array<{seq: number, text: string, ok: boolean}>}
 */
export function aiActions(entries, ownerTokenId) {
  return (entries || [])
    .filter((e) => e.kind === "tool" && !isScreenRead(e) && e.actor?.token && e.actor.token !== ownerTokenId)
    .map((e) => ({ seq: e.seq, text: didWords(e.tool), ok: e.ok !== false }))
    .reverse();
}

/** What a tool call did, in plain words ("sent an email", "looked at orders"). */
export function didWords(tool) {
  if (DID[tool]) return DID[tool];
  const [verb, ...rest] = String(tool).split("_");
  const thing = rest.join(" ");
  if (verb === "get") return `looked up ${thing ? `a ${thing}` : "something"}`.replace(/ a ([aeiou])/, " an $1");
  if (verb === "list" || verb === "read") return `looked at the ${thing || "business"}`;
  if (verb === "search" || verb === "check") return `checked ${thing || "something"}`;
  // Anything else is named, not conjugated: guessing "-ed" endings gives "verifyed".
  return `used “${String(tool).replace(/_/g, " ")}”`;
}
