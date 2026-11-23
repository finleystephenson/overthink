// Reviews: what customers say about what they bought, and the shop's public answers. An extension of engine.js.
//
// Records: state.reviews (already loaded from the world folder; the simulator adds new ones as orders are reviewed).
//   { id: "REV-0001", customer_id, order_number, product, sku, rating 1-5, text, date,
//     reply?: { text, by, by_name, at, edited? }, flag?: { reason, note, by, at } }
// A reply is public: anyone who reads reviews (customers too) sees it. The simulator judges a reply as it judges other
// public replies (simulation/simulator/replies.mjs): a helpful answer to a poor review lifts reputation a little.
// A flagged review is hidden from customers and their assistant until the flag is cleared; staff still see it.
import { extend, kit } from "./engine.js";
import { ROSTER } from "./comms.js";

const { fail, round2, stamp, tokens, matches, schema: { str, bool, obj }, roles } = kit;
const int = { type: "integer" };

/** People who answer customers in public. */
export const REVIEW_REPLIERS = ["support_agent", "support_lead", "manager", "marketing"];
/** People who may hide a review while it is looked into. */
const REVIEW_FLAGGERS = ["support_lead", "manager", "marketing"];
const FLAG_REASONS = ["fake", "abusive", "wrong_product", "personal_details", "other"];
const REPLY_MAX = 1500;

const isStaff = (ctx) => roles.INTERNAL.includes(ctx.role);

/** Who is writing: the first person with the caller's role, or `as` when the caller may speak for them. */
function writer(ctx, as) {
  if (as) {
    const p = ROSTER.find((x) => x.id === as) || fail("not_found", `There is no staff member ${as}.`);
    if (p.role !== ctx.role && ctx.role !== "manager") fail("forbidden", `The ${ctx.role} role cannot write as ${p.name}.`);
    return { id: p.id, name: p.name };
  }
  const own = ROSTER.find((p) => p.role === ctx.role);
  return own ? { id: own.id, name: own.name } : { id: ctx.role, name: "Overthought & Co." };
}

function findReview(ctx, id) {
  const r = (ctx.st.reviews || []).find((x) => x.id === id);
  // WHY: a hidden review must look exactly like a missing one to a customer.
  if (!r || (r.flag && !isStaff(ctx))) fail("not_found", `There is no review ${id}.`);
  return r;
}

/** A review as a row: names filled in. Customers see the reviewer's name as it is shown on the shop, not their id. */
function view(ctx, r) {
  const product = ctx.world.products.find((p) => p.id === r.product);
  const c = ctx.st.customers.find((x) => x.id === r.customer_id);
  const row = {
    id: r.id, date: r.date, rating: r.rating, text: r.text, product: r.product, product_name: product?.name || r.product, sku: r.sku || null,
    reviewer: c ? c.name : "A customer", reply: r.reply || null, source: r.source || "history",
  };
  if (isStaff(ctx)) Object.assign(row, { customer_id: r.customer_id || null, order_number: r.order_number || null, flag: r.flag || null });
  return row;
}

const TOOLS = [
  {
    name: "list_reviews", roles: roles.ALL,
    description: "Product reviews, newest first, with the shop's public reply if there is one. Filters: product (a product id), rating (exactly), max_rating (this or lower), needs_reply (true: no reply yet), customer_id and order_number (staff), flagged (staff), search (words in the text), before (a date; only older). limit defaults to 50 (at most 200). Also returns how many match and their average rating. Customers and their assistant never see flagged reviews or who wrote them by id.",
    input_schema: obj({ product: str, rating: int, max_rating: int, needs_reply: bool, customer_id: str, order_number: str, flagged: bool, search: str, before: str, limit: int }),
    // WHY: reviews are the end of a customer's journey and part of the shop's public face; they need to be findable.
    run(ctx, i) {
      const staff = isStaff(ctx);
      const words = i.search ? tokens(i.search) : [];
      const rows = (ctx.st.reviews || []).filter((r) => (staff || !r.flag)
        && (!i.product || r.product === i.product) && (i.rating === undefined || r.rating === i.rating) && (i.max_rating === undefined || r.rating <= i.max_rating)
        && (i.needs_reply === undefined || !r.reply === i.needs_reply) && (!staff || !i.customer_id || r.customer_id === i.customer_id)
        && (!staff || !i.order_number || r.order_number === i.order_number) && (!staff || i.flagged === undefined || !!r.flag === i.flagged)
        && (!i.before || r.date < i.before) && (!words.length || matches(r.text, words)))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
      const n = Math.min(200, Math.max(1, i.limit || 50));
      const avg = rows.length ? round2(rows.reduce((s, r) => s + r.rating, 0) / rows.length) : null;
      return { total: rows.length, average_rating: avg, reviews: rows.slice(0, n).map((r) => view(ctx, r)) };
    },
  },
  {
    name: "get_review", roles: roles.ALL,
    description: "One review in full, with the shop's reply. Staff also get the order it was about (number, status, when, total) and the customer's id.",
    input_schema: obj({ review_id: str }, ["review_id"]),
    run(ctx, i) {
      const r = findReview(ctx, i.review_id);
      const out = view(ctx, r);
      if (isStaff(ctx) && r.order_number) {
        const o = ctx.st.orders.find((x) => x.number === r.order_number);
        out.order = o ? { number: o.number, status: o.status, placed_at: o.placed_at, total: o.totals?.total ?? null } : null;
      }
      return out;
    },
  },
  {
    name: "reply_to_review", roles: REVIEW_REPLIERS,
    description: "Answers a review in public, as the shop (signed by the person with your role, or `as`, a staff id the caller may speak for). Everyone who reads reviews sees it. A second reply replaces the first and is marked edited. A helpful, prompt answer to a poor review lifts the shop's reputation a little in the simulation.",
    input_schema: obj({ review_id: str, text: str, as: str }, ["review_id", "text"]),
    // WHY: answering a bad review well is one of the cheapest things a small shop can do for its name.
    run(ctx, i) {
      const r = findReview(ctx, i.review_id);
      const text = String(i.text || "").trim();
      if (!text) fail("invalid_input", "The reply cannot be empty.");
      if (text.length > REPLY_MAX) fail("invalid_input", `The reply is too long (${text.length} characters; the most is ${REPLY_MAX}).`);
      const who = writer(ctx, i.as);
      const edited = !!r.reply;
      r.reply = { text, by: who.id, by_name: who.name, at: stamp(ctx), ...(edited ? { edited: true } : {}) };
      ctx.changes.push(`review ${r.id} ${edited ? "reply edited" : "replied to"} by ${who.id}`);
      return view(ctx, r);
    },
  },
  {
    name: "write_review", roles: ["customer"], needs_customer: true,
    description: "The signed-in customer reviews something from one of their delivered orders: order_number, rating (1 to 5), text, and sku (which line; default the first). One review per order. It appears on the shop at once and the help desk can answer it.",
    input_schema: obj({ order_number: str, rating: int, text: str, sku: str }, ["order_number", "rating", "text"]),
    // WHY: a customer's journey ends in feedback; the customer (or their own AI) must be able to leave it.
    run(ctx, i) {
      const o = ctx.st.orders.find((x) => x.number === i.order_number && x.customer_id === ctx.sess.customer_id);
      if (!o) fail("not_found", `There is no order ${i.order_number} on this account.`);
      if (o.status !== "delivered") fail("rule_violation", "You can review an order once it has been delivered.");
      if (!Number.isInteger(i.rating) || i.rating < 1 || i.rating > 5) fail("invalid_input", "The rating is a whole number from 1 to 5.");
      const text = String(i.text || "").trim();
      if (text.length < 3 || text.length > REPLY_MAX) fail("invalid_input", `Write between 3 and ${REPLY_MAX} characters.`);
      if ((ctx.st.reviews || []).some((r) => r.order_number === o.number)) fail("already_done", `${o.number} already has a review.`);
      const line = o.items.find((l) => !i.sku || l.sku === i.sku) || fail("not_found", `${i.sku} is not in ${o.number}.`);
      const product = ctx.world.index.skus[line.sku]?.product;
      const top = (ctx.st.reviews || []).reduce((n, r) => Math.max(n, Number(String(r.id).split("-")[1]) || 0), 0);
      const r = { id: `REV-${String(top + 1).padStart(4, "0")}`, customer_id: o.customer_id, order_number: o.number, product: product?.id || null, sku: line.sku, rating: i.rating, text, date: ctx.now.slice(0, 10), source: "customer" };
      (ctx.st.reviews ||= []).push(r);
      ctx.changes.push(`review ${r.id} written for ${o.number} (${r.rating} stars)`);
      return view(ctx, r);
    },
  },
  {
    name: "flag_review", roles: REVIEW_FLAGGERS,
    description: `Hides a review from customers while it is looked into, with a reason (${FLAG_REASONS.join(", ")}) and an optional note; staff still see it. Send clear: true to show it again. Flagging does not change what the review says or the shop's reputation.`,
    input_schema: obj({ review_id: str, reason: { type: "string", enum: FLAG_REASONS }, note: str, clear: bool }, ["review_id"]),
    // WHY: a fake or abusive review should not sit on the shop page, but hiding honest criticism is not allowed for long.
    run(ctx, i) {
      const r = findReview(ctx, i.review_id);
      if (i.clear) {
        if (!r.flag) fail("already_done", `${r.id} is not flagged.`);
        delete r.flag;
        ctx.changes.push(`review ${r.id} flag cleared`);
        return view(ctx, r);
      }
      if (!i.reason) fail("invalid_input", `Say why: ${FLAG_REASONS.join(", ")}.`);
      const who = writer(ctx, null);
      r.flag = { reason: i.reason, note: String(i.note || "").slice(0, 300), by: who.id, at: stamp(ctx) };
      ctx.changes.push(`review ${r.id} flagged (${i.reason}) by ${who.id}`);
      return view(ctx, r);
    },
  },
];

extend({ tools: TOOLS });
