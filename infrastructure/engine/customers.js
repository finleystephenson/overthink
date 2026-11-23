// The customer page: everything the business knows about one customer, in one read. An extension of engine.js.
//
// WHY one tool: a help desk, a marketing screen or a connected AI asking "who is this?" should not need ten calls
// (orders, contacts, cases, returns, reviews, posts, mail...). Everything here is what the business itself holds;
// the person's hidden circumstances (world/population.json) are never shown here (that is the world lens).
import { extend, kit } from "./engine.js";
import { canUseMailbox } from "./comms.js";

const { fail, round2, ms, dateOf, schema: { str, obj } } = kit;

/** Staff who look after customers, and marketing (who answer them in public). Never a customer or their assistant. */
export const CUSTOMER_PAGE_ROLES = ["support_agent", "support_lead", "manager", "marketing", "operations_assistant"];
const LIST_MAX = 50;
const CLOSED = ["resolved", "closed"];

/** Newest first by a date field. */
const newest = (field) => (a, b) => (String(a[field]) < String(b[field]) ? 1 : String(a[field]) > String(b[field]) ? -1 : 0);

/** Money a customer actually spent on an order: what they paid, less what was given back. Cancelled orders count 0. */
function netOf(o) {
  if (["cancelled", "payment_failed"].includes(o.status)) return 0;
  return round2((o.totals?.total || 0) - (o.payment?.refunded || 0));
}

/** The products this customer buys most, by units. */
function favourites(orders) {
  const n = new Map();
  for (const o of orders) {
    if (["cancelled", "payment_failed"].includes(o.status)) continue;
    for (const l of o.items) n.set(l.name, (n.get(l.name) || 0) + l.qty);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([name, units]) => ({ name, units }));
}

/** Lifetime value and rhythm of buying, from the orders alone. */
function valueOf(orders, today) {
  const paid = orders.filter((o) => !["cancelled", "payment_failed"].includes(o.status));
  const spent = round2(paid.reduce((n, o) => n + (o.totals?.total || 0), 0));
  const refunded = round2(paid.reduce((n, o) => n + (o.payment?.refunded || 0), 0));
  const dates = paid.map((o) => o.placed_at).sort();
  const last = dates.at(-1) || null;
  return {
    orders: paid.length, spent, refunded, lifetime_value: round2(spent - refunded),
    average_order: paid.length ? round2(spent / paid.length) : null,
    first_order: dates[0] || null, last_order: last,
    days_since_last_order: last ? Math.round((ms(`${today}T00:00:00Z`) - ms(`${last.slice(0, 10)}T00:00:00Z`)) / 86400000) : null,
  };
}

/** What the business has learned about how this person likes to be treated, in plain facts. */
function knowsOf(c, orders, contacts, cases, reviews) {
  const channels = new Map();
  for (const x of contacts) channels.set(x.channel, (channels.get(x.channel) || 0) + 1);
  const lastContact = contacts[0] || null;
  const ratings = reviews.map((r) => r.rating);
  return {
    contact_preference: c.contact_preference || null,
    marketing_opt_in: c.marketing_opt_in !== false,
    usually_gets_in_touch_by: [...channels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    favourite_products: favourites(orders),
    complaints: cases.filter((k) => k.is_complaint).length,
    open_cases: cases.filter((k) => !CLOSED.includes(k.status)).length,
    average_rating: ratings.length ? round2(ratings.reduce((a, b) => a + b, 0) / ratings.length) : null,
    last_contact: lastContact ? { at: lastContact.at, topic: lastContact.topic, outcome: lastContact.outcome || null } : null,
    credit_balance: c.credit_balance || 0,
    notes: c.notes || "",
  };
}

const TOOLS = [
  {
    name: "get_customer_overview", roles: CUSTOMER_PAGE_ROLES,
    description: "Everything the business knows about one customer in one read: profile, lifetime value (orders, spent, refunded, average order, days since the last order), their orders, contacts, cases, returns, repairs, reviews (with any reply), their posts on squint and mutter, the emails with them in mailboxes this role may open, and what the business has learned (preferred channel, favourite products, complaints, average rating, credit). Lists are newest first, at most 50 each, with totals.",
    input_schema: obj({ customer_id: str }, ["customer_id"]),
    // WHY: every app links a customer to this one page, so the same person reads the same way everywhere.
    run(ctx, i) {
      const st = ctx.st;
      const c = st.customers.find((x) => x.id === i.customer_id) || fail("not_found", `There is no customer ${i.customer_id}.`);
      const today = dateOf(ms(ctx.now));
      const mine = (list) => (list || []).filter((x) => x.customer_id === c.id);
      const orders = mine(st.orders).sort(newest("placed_at"));
      const contacts = mine(st.contacts).sort(newest("at"));
      const cases = mine(st.cases).sort(newest("opened_at"));
      const returns = mine(st.returns).sort(newest("created_at"));
      const repairs = mine(st.repairs).sort(newest("created_at"));
      const reviews = mine(st.reviews).sort(newest("date"));
      const posts = (st.social_posts || []).filter((p) => p.kind !== "dm" && p.author?.kind === "customer" && (p.author.customer_id || p.links?.customer_id) === c.id).sort(newest("at"));
      const addr = String(c.email).toLowerCase();
      const mail = (st.emails || []).filter((e) => canUseMailbox(ctx.role, e.mailbox) && (e.links?.customer_id === c.id
        || String(e.from?.address).toLowerCase() === addr || (e.to || []).some((t) => String(t.address).toLowerCase() === addr))).sort(newest("at"));
      const { id, name, email, phone, addresses, contact_preference, marketing_opt_in, credit_balance, created_at } = c;
      return {
        customer: { id, name, email, phone, addresses, contact_preference, marketing_opt_in, credit_balance, created_at },
        value: valueOf(orders, today),
        knows: knowsOf(c, orders, contacts, cases, reviews),
        orders: { total: orders.length, list: orders.slice(0, LIST_MAX).map((o) => ({ number: o.number, placed_at: o.placed_at, status: o.status, total: o.totals?.total ?? 0, net: netOf(o), items: o.items.map((x) => `${x.qty} x ${x.name}`) })) },
        contacts: { total: contacts.length, list: contacts.slice(0, LIST_MAX).map((x) => ({ id: x.id, at: x.at, channel: x.channel, topic: x.topic, outcome: x.outcome || null, summary: x.summary || null, case_number: x.case_number || null, order: x.order || null, first_reply_minutes: x.first_reply_minutes ?? null })) },
        cases: { total: cases.length, list: cases.slice(0, LIST_MAX).map((k) => ({ number: k.number, subject: k.subject, category: k.category, status: k.status, is_complaint: !!k.is_complaint, opened_at: k.opened_at, related: k.related || {} })) },
        returns: { total: returns.length, list: returns.slice(0, LIST_MAX).map((r) => ({ number: r.number, order_number: r.order_number, status: r.status, reason: r.reason || null, created_at: r.created_at || null })) },
        repairs: { total: repairs.length, list: repairs.slice(0, LIST_MAX).map((r) => ({ number: r.number, status: r.status, product: r.product || r.sku || null, created_at: r.created_at || null })) },
        reviews: { total: reviews.length, list: reviews.slice(0, LIST_MAX).map((r) => ({ id: r.id, date: r.date, rating: r.rating, text: r.text, product: r.product, order_number: r.order_number || null, reply: r.reply || null, flagged: !!r.flag })) },
        social_posts: { total: posts.length, list: posts.slice(0, LIST_MAX).map((p) => ({ id: p.id, network: p.network, at: p.at, text: p.text, likes: p.likes || 0, reposts: p.reposts || 0, image: p.image || null, links: p.links || {} })) },
        emails: { total: mail.length, list: mail.slice(0, LIST_MAX).map((e) => ({ id: e.id, mailbox: e.mailbox, folder: e.folder, at: e.at, subject: e.subject, from_customer: String(e.from?.address).toLowerCase() === addr })) },
      };
    },
  },
];

extend({ tools: TOOLS });
