// The explorer's reads: the world as one connected picture, for applications/explore/ (the front door).
//
// Read-only. Every function here looks at a sandbox's state and returns plain JSON; nothing is changed or traced.
// The routes need the sandbox's OWNER token (the person at the explorer), never a role key, because they use the
// WORLD LENS: traits a real business would never know (age band, income fifth, circumstances, who knows whom) and
// competitors' internals. The tool API (/tools, /mcp) never reaches this file, so a connected AI cannot see it.
//
//   GET /sandboxes/:id/explore/graph              rings of the world around the company, clusters with counts, links
//   GET /sandboxes/:id/explore/search?q=          people, products, orders, news, organisations, documents, apps
//   GET /sandboxes/:id/explore/entity/:kind/:id   one thing: what it is, two lenses (people), connections, history, chain
//   GET /sandboxes/:id/explore/timeline?from&to   what happened between two dates, plus a busy-ness strip
//   GET /sandboxes/:id/explore/pulses?since=      real things that happened since a moment, as moves along links
//   GET /sandboxes/:id/explore/compare            this world against the same world left alone: who and what differ
//   GET /sandboxes/:id/explore/starts             a few live stories worth following, picked from the records
//   GET /sandboxes/:id/explore/situations         the lab's ready situations for /overthink (titles only)
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { orgsFor, publicView } from "../../simulation/world/organisations.mjs";
import { personKey } from "../../simulation/world/population.mjs";
import { supplierPeople } from "../../simulation/world/supplier-side.mjs";

const ROOT = new URL("../../", import.meta.url);
const readJson = (rel, fallback) => {
  try { const f = new URL(rel, ROOT); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : fallback; } catch { return fallback; }
};
let POP; // business/data/population.json, read once (null when it has not been built)
const population = () => (POP ??= readJson("business/data/population.json", null) || { people: {} });
let APPS;
const apps = () => (APPS ??= readJson("applications/apps.json", { apps: [] }).apps.filter((a) => a.status === "ready"));
let HISTORY;
const history = () => (HISTORY ??= readJson("business/data/history/timeline.json", { entries: [] }).entries || []);

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const day = (iso) => String(iso || "").slice(0, 10);
/** A date as a person writes it: "13 Apr 2023". */
const dw = (iso) => { const d = new Date(String(iso || "").length <= 10 ? `${iso}T12:00:00Z` : iso); return Number.isNaN(+d) ? String(iso || "") : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); };
const money = (v) => `£${Number(v || 0).toFixed(2).replace(/\.00$/, "")}`;
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const low = (s) => String(s ?? "").toLowerCase();
const words = (s) => String(s || "").replace(/_/g, " ");
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Where a community's name comes from: the population's book group, without the builder's "(extra)" note. */
const communityName = (book) => String(book || "Elsewhere").replace(/\s*\(extra\)\s*$/i, "");
/** A competitor's move (docs/world.md): who, when, and what in words. */
const moveOrg = (m) => m.competitor || m.organisation_id || m.org_id || m.competitor_id || null;
const moveAt = (m) => m.at || `${m.from || m.date}T09:00:00Z`;
const moveText = (m) => m.headline || m.summary || m.text || "A competitor made a move";
const slug = (s) => low(s).normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ------------------------------------------------------------------ the index (rebuilt when the state grows)

const INDEX = new WeakMap(); // state -> { sig, ... }

/**
 * Lookups over one state. Rebuilt when the lists it covers change length (time moved, an order was placed).
 * @param {object} world an engine world ({ state, products, plan, ... })
 */
function indexOf(world) {
  const st = world.state;
  const sig = [st.now, st.customers.length, st.orders.length, st.contacts.length, st.news.length, st.cases.length, st.reviews.length, st.emails.length].join("|");
  const hit = INDEX.get(st);
  if (hit && hit.sig === sig) return hit;
  const pop = population().people;
  const customers = new Map(st.customers.map((c) => [c.id, c]));
  const traitsOf = new Map();       // customer id -> population traits (world lens)
  const customerByKey = new Map();  // population key -> customer id
  const communityOf = new Map();    // customer id -> community slug
  const communities = new Map();    // slug -> { id, title, customers: [] }
  for (const c of st.customers) {
    const key = personKey(c.name);
    const t = pop[key];
    if (t) { traitsOf.set(c.id, { key, ...t }); customerByKey.set(key, c.id); }
    const title = communityName(t?.book);
    const id = slug(title) || "elsewhere";
    if (!communities.has(id)) communities.set(id, { id, title, customers: [] });
    communities.get(id).customers.push(c.id);
    communityOf.set(c.id, id);
  }
  const byCustomer = (list, field = "customer_id") => {
    const m = new Map();
    for (const r of list) { const k = r[field]; if (!k) continue; (m.get(k) || m.set(k, []).get(k)).push(r); }
    return m;
  };
  const byRef = (list, field) => {
    const m = new Map();
    for (const r of list) { const k = typeof field === "function" ? field(r) : r[field]; if (!k) continue; (m.get(k) || m.set(k, []).get(k)).push(r); }
    return m;
  };
  const staff = (world.plan?.staff || []).map((s) => ({ id: s.id, name: s.name, job: s.job, role: s.role, from: s.from, weekly_hours: s.weekly_hours }));
  const orgs = orgsFor(st);
  const carriers = new Map(orgs.partners.filter((p) => p.kind === "carrier").map((p) => [low(p.name), p]));
  const idx = {
    sig, customers, traitsOf, customerByKey, communityOf, communities,
    orders: new Map(st.orders.map((o) => [o.number, o])),
    ordersBy: byCustomer(st.orders), contactsBy: byCustomer(st.contacts), casesBy: byCustomer(st.cases), reviewsBy: byCustomer(st.reviews),
    returnsBy: byCustomer(st.returns), postsBy: byRef(st.social_posts, (p) => p.links?.customer_id || p.author?.customer_id),
    emailsByOrder: byRef(st.emails, (e) => e.links?.order), emailsByCustomer: byRef(st.emails, (e) => e.links?.customer_id),
    emailsByCase: byRef(st.emails, (e) => e.links?.case), emailsByPo: byRef(st.emails, (e) => e.links?.po),
    movesByRef: byRef(st.stock_movements, "reference"), ledgerByRef: byRef(st.ledger, "reference"),
    casesByOrder: byRef(st.cases, (c) => c.related?.order), returnsByOrder: byRef(st.returns, "order_number"), reviewsByOrder: byRef(st.reviews, "order_number"),
    contactsByCase: byRef(st.contacts, "case_number"), chatByCampaign: byRef(st.chat_messages, (m) => m.links?.campaign_id),
    newsByEvent: byRef(st.news, "event"),
    staff, staffById: new Map(staff.map((s) => [s.id, s])),
    orgs, carriers, suppliers: new Map(st.suppliers.map((s) => [s.id, s])),
    // Each supplier's contact person (simulation/world/supplier-side.mjs), and the mail to and from that supplier.
    supplierPeople: new Map(st.suppliers.map((s) => [s.id, safePeople(s)]).filter(([, p]) => p)),
    emailsBySupplier: mailBySupplier(st),
    products: new Map(world.products.map((p) => [p.id, p])),
    productOfSku: skuMap(world),
    campaigns: new Map(st.campaigns.map((c) => [c.id, c])),
    campaignByCode: new Map(st.campaigns.filter((c) => c.code).map((c) => [String(c.code).toUpperCase(), c])),
  };
  INDEX.set(st, idx);
  return idx;
}

function safePeople(sup) { try { return supplierPeople(sup); } catch { return null; } }

/** Supplier id -> emails to or from it (by the links the mail carries, or by its addresses). */
function mailBySupplier(st) {
  const byAddress = new Map();
  for (const sup of st.suppliers) for (const a of safePeople(sup)?.addresses || []) byAddress.set(a, sup.id);
  const m = new Map();
  for (const e of st.emails) {
    const id = e.links?.supplier_id || byAddress.get(String(e.from?.address || "").toLowerCase()) || (e.to || []).map((t) => byAddress.get(String(t.address || "").toLowerCase())).find(Boolean);
    if (id) (m.get(id) || m.set(id, []).get(id)).push(e);
  }
  return m;
}

/** sku -> product id, for every variant and accessory. */
function skuMap(world) {
  const m = new Map();
  for (const p of world.products) {
    m.set(`OT-${p.code}`, p.id);
    for (const v of p.variants || []) if (v.sku) m.set(v.sku, p.id);
    for (const a of p.accessories || []) if (a.sku) m.set(a.sku, p.id);
  }
  return m;
}
const productOf = (idx, sku) => idx.productOfSku.get(sku) || [...idx.productOfSku.entries()].find(([k]) => sku?.startsWith(k))?.[1] || null;

// ------------------------------------------------------------------ plain words (never codes)

/**
 * Text written by the data, with record codes made plain: orders and cases keep their number as words, people and
 * suppliers become names, and codes that mean nothing to a person are taken out.
 */
export function plain(text, idx) {
  if (!text) return "";
  return String(text)
    .replace(/\s*\((?:ref\.?\s*|#)?((?:CT|EM|SP|CH|CONV|WE|NW|LED|MV|MSG|TH|TR|EV|AC|SC|SHP|REG|INV)-[\w-]+)\)/gi, "")
    .replace(/\b(ORD|PO|CASE|FIX|RET|REV)-(\d+)\b/g, (m, k, n) => `${{ ORD: "order", PO: "purchase order", CASE: "case", FIX: "repair", RET: "return", REV: "review" }[k]} ${n}`)
    .replace(/\bC-\d+\b/g, (c) => idx?.customers.get(c)?.name || "a customer")
    .replace(/\bS-\d+\b/g, (s) => idx?.staffById.get(s)?.name || "someone on the team")
    .replace(/\bSUP-\d+\b/g, (s) => idx?.suppliers.get(s)?.name || "a supplier")
    .replace(/\bOT-[A-Z0-9-]+\b/g, (sku) => { const p = idx && productOf(idx, sku); return p ? `of ${idx.products.get(p)?.name || "a product"}` : ""; })
    .replace(/\bfrom (\d{4}-\d{2}-\d{2})\b/g, (m, d) => `from ${dw(d)}`)
    .replace(/\b(?:SHP|REG|INV|CT|EM|SP|CH|CONV|WE|NW|LED|MV|SC)-[\w-]+\b/g, "")
    .replace(/\b(order|case|return|repair) \1 (\d+)/gi, "$1 $2")
    .replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
}

// ------------------------------------------------------------------ the graph (rings around the company)

/** The rings, from the inside out. */
export const RINGS = [
  { id: "team", label: "The team" },
  { id: "customers", label: "Customers and communities" },
  { id: "suppliers", label: "Suppliers and partners" },
  { id: "competitors", label: "Competitors" },
  { id: "institutions", label: "Institutions" },
  { id: "forces", label: "Outside forces" },
];
const MAX_COMMUNITIES = 11; // the biggest communities get their own node; the rest share "Everyone else"

/**
 * The world around the company as rings of nodes, each a real record or a cluster of records with its count, and the
 * links between them with how many things went along each.
 */
export function worldGraph(world) {
  const st = world.state;
  const idx = indexOf(world);
  const ringNodes = Object.fromEntries(RINGS.map((r) => [r.id, []]));
  const links = [];
  const centre = { kind: "company", id: "overthought", title: st.company?.name || "Overthought & Co." };
  const link = (to, count, label) => links.push({ from: { kind: "company", id: "overthought" }, to, count, label });

  // Team: everyone on the plan, with the chat messages they wrote.
  const chatBy = new Map();
  for (const m of st.chat_messages) chatBy.set(m.from, (chatBy.get(m.from) || 0) + 1);
  for (const s of idx.staff) {
    ringNodes.team.push({ kind: "staff", id: s.id, title: s.name, note: s.job });
    link({ kind: "staff", id: s.id }, chatBy.get(s.id) || 0, "messages in staff chat");
  }

  // Customers, clustered by community (the book their family comes from).
  const sorted = [...idx.communities.values()].sort((a, b) => b.customers.length - a.customers.length);
  const big = sorted.slice(0, MAX_COMMUNITIES);
  const rest = sorted.slice(MAX_COMMUNITIES);
  const ordersIn = (ids) => ids.reduce((n, id) => n + (idx.ordersBy.get(id)?.length || 0), 0);
  for (const c of big) {
    ringNodes.customers.push({ kind: "community", id: c.id, title: c.title, count: c.customers.length, cluster: true });
    link({ kind: "community", id: c.id }, ordersIn(c.customers), "orders");
  }
  if (rest.length) {
    const ids = rest.flatMap((c) => c.customers);
    ringNodes.customers.push({ kind: "community", id: "everyone-else", title: "Everyone else", count: ids.length, cluster: true, communities: rest.length });
    link({ kind: "community", id: "everyone-else" }, ordersIn(ids), "orders");
  }

  // Suppliers (purchase orders) and partners (carriers by parcels, the card company by payments).
  const posBy = new Map();
  for (const p of st.purchase_orders) posBy.set(p.supplier_id, (posBy.get(p.supplier_id) || 0) + 1);
  for (const s of st.suppliers) {
    const who = idx.supplierPeople.get(s.id)?.contact?.name;
    ringNodes.suppliers.push({ kind: "supplier", id: s.id, title: s.name, note: who ? `${who}, ${s.town}` : s.town, ...(who ? { person: { kind: "contact", id: s.id, title: who } } : {}) });
    link({ kind: "supplier", id: s.id }, posBy.get(s.id) || 0, "purchase orders");
  }
  const parcels = new Map();
  for (const o of st.orders) for (const sh of o.shipments || []) parcels.set(low(sh.carrier), (parcels.get(low(sh.carrier)) || 0) + 1);
  for (const p of idx.orgs.partners) {
    ringNodes.suppliers.push({ kind: "org", id: p.id, title: p.name, note: p.kind });
    const count = p.kind === "carrier" ? parcels.get(low(p.name)) || 0 : p.kind === "payment provider" ? st.orders.filter((o) => o.payment?.status === "paid").length : 0;
    link({ kind: "org", id: p.id }, count, p.kind === "carrier" ? "parcels" : p.kind === "payment provider" ? "payments" : "dealings");
  }

  // Competitors, with the moves they made (when the wider world records them).
  const movesBy = new Map();
  for (const m of st.competitor_moves || []) movesBy.set(moveOrg(m), (movesBy.get(moveOrg(m)) || 0) + 1);
  for (const c of idx.orgs.competitors) {
    ringNodes.competitors.push({ kind: "org", id: c.id, title: c.name, note: c.categories.map(catWords).join(", ") });
    link({ kind: "org", id: c.id }, movesBy.get(c.id) || 0, "moves");
  }
  for (const i of idx.orgs.institutions) {
    ringNodes.institutions.push({ kind: "org", id: i.id, title: i.name, note: i.kind });
    link({ kind: "org", id: i.id }, i.kind === "newspaper" ? st.news.length : 0, i.kind === "newspaper" ? "stories" : "dealings");
  }

  // Outside forces: the economy, opinion and trends, the news, events.
  const forces = [
    { id: "economy", title: "The economy", count: (st.economy || []).length, label: "monthly figures" },
    { id: "trends", title: "Opinion and trends", count: (st.trends || []).length + (st.opinion || []).length, label: "readings" },
    { id: "news", title: "The news", count: st.news.length, label: "stories" },
    { id: "events", title: "Events", count: st.world_events.length, label: "events" },
  ];
  for (const f of forces) {
    ringNodes.forces.push({ kind: "force", id: f.id, title: f.title, count: f.count, cluster: true });
    link({ kind: "force", id: f.id }, f.count, f.label);
  }

  // A few links between outer things: carriers reach the customers, the news reaches the customers.
  const carrierLinks = idx.orgs.partners.filter((p) => p.kind === "carrier").map((p) => ({ from: { kind: "org", id: p.id }, to: { kind: "ring", id: "customers" }, count: parcels.get(low(p.name)) || 0, label: "parcels delivered" }));
  links.push(...carrierLinks, { from: { kind: "force", id: "news" }, to: { kind: "ring", id: "customers" }, count: st.news.length, label: "stories read" });

  return {
    now: st.now, centre,
    rings: RINGS.map((r) => ({ ...r, nodes: ringNodes[r.id] })),
    links,
    totals: { customers: st.customers.length, orders: st.orders.length, staff: idx.staff.length, suppliers: st.suppliers.length, communities: idx.communities.size,
      organisations: idx.orgs.competitors.length + idx.orgs.partners.length + idx.orgs.institutions.length, news: st.news.length, events: st.world_events.length },
  };
}

// ------------------------------------------------------------------ search

/**
 * Finds things by name across the world. Best first: exact, then starts-with, then contains.
 * @return {Array<{kind: string, id: string, title: string, note: string}>}
 */
export function searchWorld(world, q, { limit = 20 } = {}) {
  const st = world.state;
  const idx = indexOf(world);
  const query = low(q).trim();
  if (!query) return [];
  const out = [];
  const score = (text) => {
    const t = low(text);
    if (!t) return 0;
    if (t === query) return 100;
    if (t.startsWith(query)) return 70;
    if (t.split(/[^a-z0-9]+/).some((w) => w.startsWith(query))) return 55;
    if (query.length >= 3 && t.includes(query)) return 35;
    return 0;
  };
  const add = (kind, id, title, note, s, boost = 0) => { if (s > 0) out.push({ kind, id, title, note, score: s + boost }); };
  // An order by its number: "10166", "order 10166", "ORD-10166".
  const num = query.match(/^(?:order\s*|ord-?)?(\d{5})$/);
  if (num && idx.orders.has(`ORD-${num[1]}`)) {
    const o = idx.orders.get(`ORD-${num[1]}`);
    add("order", o.number, `Order ${num[1]}`, `${idx.customers.get(o.customer_id)?.name || "A customer"}, ${dw(o.placed_at)}`, 100, 10);
  }
  add("company", "overthought", st.company?.name || "Overthought & Co.", "The business", score(st.company?.name), 5);
  for (const s of idx.staff) add("staff", s.id, s.name, `On the team: ${low(s.job)}`, score(s.name), 8);
  for (const p of world.products) add("product", p.id, p.name, p.tagline || "", Math.max(score(p.name), score(p.name.replace(/^The /, ""))), 6);
  for (const c of st.customers) add("person", c.id, c.name, `Customer in ${c.addresses?.[0]?.town || "the world"}`, score(c.name), 2);
  for (const [key, t] of Object.entries(population().people)) {
    if (idx.customerByKey.has(key)) continue;
    add("person", key, t.name, `Lives in ${t.town}; not a customer yet`, score(t.name));
  }
  for (const o of [...idx.orgs.competitors, ...idx.orgs.partners, ...idx.orgs.institutions]) add("org", o.id, o.name, cap(o.kind), score(o.name), 5);
  for (const s of st.suppliers) add("supplier", s.id, s.name, `Supplier in ${s.town}`, score(s.name), 5);
  for (const [id, p] of idx.supplierPeople) add("contact", id, p.contact.name, `Looks after ${p.name}`, score(p.contact.name), 4);
  for (const c of idx.communities.values()) add("community", c.id, c.title, `${plural(c.customers.length, "customer")}`, score(c.title), 3);
  for (const n of st.news) add("news", n.id, n.headline, `News, ${dw(n.at)}`, Math.min(60, score(n.headline)));
  for (const e of st.world_events) add("event", e.id, e.title, `Event, ${dw(e.start)}`, Math.min(60, score(e.title)));
  for (const c of st.campaigns) add("campaign", c.id, c.name, `Campaign, ${dw(c.start)}`, Math.min(60, score(c.name)));
  for (const d of st.documents) add("document", d.id, d.title, `Document, ${d.kind}`, Math.min(60, score(d.title)));
  for (const a of apps()) add("app", a.id, `${a.name} · ${a.plain}`, a.description, Math.max(score(a.name), score(a.plain)), 7);
  out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const seen = new Set();
  return out.filter((r) => { const k = `${r.kind}:${r.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, limit).map(({ score: _s, ...r }) => r);
}

// ------------------------------------------------------------------ one thing, with its connections

const ref = (kind, id, title, note = "") => ({ kind, id, title, ...(note ? { note } : {}) });
const APP_FOR = { order: "till", email: "letterbox", case: "front-desk", contact: "front-desk", stock: "stockroom", ledger: "tally", news: "daily-overthinker", social_squint: "squint", social_mutter: "mutter", chat: "kettle", rota: "rota", document: "filing-cabinet", campaign: "megaphone", review: "front-desk", purchase_order: "stockroom" };

/**
 * Everything about one thing, in one shape for every kind:
 * { kind, id, title, kind_label, sentence, picture, facts, lenses?, connections, history, chain?, apps }
 */
export function dossier(world, kind, id, { trace = [] } = {}) {
  const idx = indexOf(world);
  const fn = DOSSIERS[kind];
  if (!fn) fail("not_found", `There is no kind of thing called "${kind}".`);
  const d = fn(world, idx, id, { trace });
  if (!d) fail("not_found", "That is not in this world.");
  d.workings = { kind, id, ...(d.workings || {}) };
  d.kind = kind;
  d.id = id;
  d.connections = (d.connections || []).filter((g) => g.items.length);
  d.history = (d.history || []).filter((h) => h.at).sort((a, b) => (a.at < b.at ? -1 : 1));
  return d;
}

/** The product's picture with its background cut away (business/site/img/cut, served at /img/cut/), when there is one. */
const pictureOf = (p) => (p && existsSync(new URL(`business/site/img/cut/${p.id}.png`, ROOT)) ? `/img/cut/${p.id}.png` : null);

const DOSSIERS = {
  company(world, idx) {
    const st = world.state;
    const ms = st.monthly_summary.at(-1);
    return {
      title: st.company.name, kind_label: "The business",
      sentence: st.company.what_we_do,
      facts: [
        { label: "Started", value: dw(st.company.founded) },
        { label: "Customers", value: plural(st.customers.length, "customer") },
        { label: "Orders so far", value: plural(st.orders.length, "order") },
        { label: "Team", value: plural(idx.staff.length, "person", "people") },
        ...(ms ? [{ label: `Profit in ${ms.month}`, value: money(ms.profit) }] : []),
      ],
      connections: [
        { group: "The team", items: idx.staff.map((s) => ref("staff", s.id, s.name, s.job)) },
        { group: "What it sells", items: world.products.filter((p) => p.status !== "discontinued").map((p) => ref("product", p.id, p.name)) },
        { group: "Suppliers", items: st.suppliers.map((s) => ref("supplier", s.id, s.name)) },
        { group: "Its apps", items: apps().map((a) => ref("app", a.id, `${a.name} · ${a.plain}`)) },
      ],
      history: history().map((h) => ({ at: h.date, text: h.title + ". " + h.text })),
    };
  },

  person(world, idx, id) {
    const st = world.state;
    const pop = population().people;
    const c = idx.customers.get(id) || idx.customers.get(idx.customerByKey.get(id));
    const t = c ? idx.traitsOf.get(c.id) : pop[id] ? { key: id, ...pop[id] } : null;
    if (!c && !t) return null;
    const name = c?.name || t.name;
    const orders = c ? idx.ordersBy.get(c.id) || [] : [];
    const cases = c ? idx.casesBy.get(c.id) || [] : [];
    const reviews = c ? idx.reviewsBy.get(c.id) || [] : [];
    const contacts = c ? idx.contactsBy.get(c.id) || [] : [];
    const returns = c ? idx.returnsBy.get(c.id) || [] : [];
    const spent = orders.reduce((n, o) => n + (o.totals?.total || 0), 0);
    const bought = new Map();
    for (const o of orders) for (const it of o.items) { const p = productOf(idx, it.sku); if (p) bought.set(p, (bought.get(p) || 0) + it.qty); }
    const communityId = c ? idx.communityOf.get(c.id) : slug(communityName(t?.book));
    const business = c ? [
      { label: "Name", value: c.name },
      { label: "Town", value: c.addresses?.[0]?.town || "" },
      { label: "Customer since", value: dw(c.created_at) },
      { label: "Orders", value: `${plural(orders.length, "order")}, ${money(spent)} in all` },
      { label: "Prefers", value: words(c.contact_preference) },
      { label: "Marketing emails", value: c.marketing_opt_in ? "Said yes" : "Said no" },
      ...(cases.length ? [{ label: "Cases", value: `${plural(cases.length, "case")}, ${cases.filter((x) => x.is_complaint).length} complaints` }] : []),
    ] : [];
    const world_ = t ? [
      { label: "From the book", value: communityName(t.book) },
      { label: "Lives", value: `${t.town}, ${words(t.area)}` },
      { label: "Age", value: t.age },
      { label: "Household", value: words(t.household) },
      { label: "Work", value: words(t.employment) },
      { label: "Income", value: INCOME[t.income] || t.income },
      { label: "Shops online", value: words(t.online) },
      { label: "Would rather use", value: words(t.channel) },
      ...(t.circumstances?.length ? [{ label: "Going through", value: t.circumstances.map(words).join(", ") }] : []),
    ] : [];
    const knows = (t?.ties || []).map(([k, how]) => {
      const cid = idx.customerByKey.get(k);
      return ref("person", cid || k, pop[k]?.name || k, words(how));
    });
    const sentence = c
      ? `${name} ${orders.length ? `has ordered ${plural(orders.length, "time")} since ${String(c.created_at).slice(0, 4)}` : "is a customer who has not ordered yet"}${t ? `, and lives in ${t.town}` : ""}.`
      : `${name} lives in ${t.town}. They have never bought from the shop.`;
    return {
      title: name, kind_label: c ? "Customer" : "Person in the world", sentence,
      facts: [],
      lenses: {
        business: { title: "What the business knows", note: c ? "From orders, messages and the address book." : "Nothing: they have never been in touch.", rows: business },
        world: { title: "What is true in the world", note: "The business cannot see this. It shapes how they behave.", rows: world_ },
      },
      connections: [
        { group: "Community", items: communityId ? [ref("community", communityId, communityName(t?.book))] : [] },
        { group: "People they know", items: knows },
        { group: "Orders", items: orders.slice(-12).reverse().map((o) => ref("order", o.number, `Order ${o.number.slice(4)}`, `${dw(o.placed_at)}, ${money(o.totals.total)}, ${words(o.status)}`)) },
        { group: "What they bought", items: [...bought].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => ref("product", p, idx.products.get(p)?.name || p, `${n} bought`)) },
        { group: "Cases", items: cases.slice(-8).reverse().map((x) => ref("case", x.number, x.subject, `${dw(x.opened_at)}, ${x.status}`)) },
      ],
      history: [
        ...(c ? [{ at: c.created_at, text: "Became a customer" }] : []),
        ...orders.map((o) => ({ at: o.placed_at, text: `Ordered ${itemsWords(o)}`, kind: "order", id: o.number })),
        ...contacts.map((x) => ({ at: x.at, text: `Got in touch by ${words(x.channel)} about ${words(x.topic)}`, ...(x.case_number ? { kind: "case", id: x.case_number } : {}) })),
        ...reviews.map((r) => ({ at: `${r.date}T12:00:00Z`, text: `Gave ${idx.products.get(r.product)?.name || "a product"} ${r.rating} stars: "${r.text}"`, kind: "order", id: r.order_number })),
        ...returns.map((r) => ({ at: r.created_at, text: `Sent something back (${words(r.reason)})`, kind: "order", id: r.order_number })),
      ],
      apps: c ? ["front-desk", "letterbox", "till"] : [],
    };
  },

  staff(world, idx, id) {
    const s = idx.staffById.get(id);
    if (!s) return null;
    const st = world.state;
    const plan = world.plan.staff.find((x) => x.id === id) || {};
    const said = st.chat_messages.filter((m) => m.from === id);
    const sent = st.emails.filter((e) => e.by === id);
    return {
      title: s.name, kind_label: "On the team", sentence: `${s.name} is on the team: ${low(s.job)}.${s.from ? ` Comes from ${s.from}.` : ""}`,
      facts: [
        { label: "Job", value: s.job }, { label: "Hours a week", value: String(plan.weekly_hours ?? "") },
        { label: "Pay", value: plan.hourly_pay ? `${money(plan.hourly_pay)} an hour` : "" }, { label: "Starts at", value: plan.start || "" },
      ],
      connections: [
        { group: "Works with", items: idx.staff.filter((x) => x.id !== id && x.role === s.role).map((x) => ref("staff", x.id, x.name, x.job)) },
        { group: "Recent staff chat", items: said.slice(-6).reverse().map((m) => ref("app", "kettle", plain(m.text, idx).slice(0, 90), day(m.at))) },
      ],
      history: [...said.slice(-20).map((m) => ({ at: m.at, text: `Said in #${m.channel || "chat"}: "${plain(m.text, idx).slice(0, 140)}"` })),
        ...sent.slice(-10).map((e) => ({ at: e.at, text: `Sent an email: ${plain(e.subject, idx)}` }))],
      apps: ["kettle", "rota", "letterbox"],
    };
  },

  community(world, idx, id) {
    const all = [...idx.communities.values()].sort((a, b) => b.customers.length - a.customers.length);
    const groups = id === "everyone-else" ? all.slice(MAX_COMMUNITIES) : all.filter((c) => c.id === id);
    if (!groups.length) return null;
    const ids = groups.flatMap((g) => g.customers);
    const orders = ids.flatMap((c) => idx.ordersBy.get(c) || []);
    const title = id === "everyone-else" ? "Everyone else" : groups[0].title;
    const people = ids.map((c) => idx.customers.get(c)).sort((a, b) => (idx.ordersBy.get(b.id)?.length || 0) - (idx.ordersBy.get(a.id)?.length || 0));
    return {
      title, kind_label: "Community",
      sentence: id === "everyone-else"
        ? `Customers from ${plural(groups.length, "smaller community", "smaller communities")}, together.`
        : `Customers whose families come from ${title}. Neighbours, friends and relations, and they talk.`,
      facts: [{ label: "Customers", value: plural(ids.length, "customer") }, { label: "Orders", value: plural(orders.length, "order") },
        { label: "Spent", value: money(orders.reduce((n, o) => n + (o.totals?.total || 0), 0)) }],
      connections: [
        { group: id === "everyone-else" ? "Communities" : "Customers", items: id === "everyone-else"
          ? groups.map((g) => ref("community", g.id, g.title, plural(g.customers.length, "customer")))
          : people.slice(0, 60).map((c) => ref("person", c.id, c.name, plural(idx.ordersBy.get(c.id)?.length || 0, "order"))) },
        ...(id === "everyone-else" ? [{ group: "Customers who order most", items: people.slice(0, 30).map((c) => ref("person", c.id, c.name, plural(idx.ordersBy.get(c.id)?.length || 0, "order"))) }] : []),
      ],
      history: orders.slice(-15).map((o) => ({ at: o.placed_at, text: `${idx.customers.get(o.customer_id)?.name} ordered ${itemsWords(o)}`, kind: "order", id: o.number })),
    };
  },

  product(world, idx, id) {
    const p = idx.products.get(id);
    if (!p) return null;
    const st = world.state;
    const orders = st.orders.filter((o) => o.items.some((it) => productOf(idx, it.sku) === id));
    const units = orders.reduce((n, o) => n + o.items.filter((it) => productOf(idx, it.sku) === id).reduce((a, it) => a + it.qty, 0), 0);
    const reviews = st.reviews.filter((r) => r.product === id);
    const avg = reviews.length ? reviews.reduce((n, r) => n + r.rating, 0) / reviews.length : null;
    const skus = (p.variants || []).map((v) => v.sku).filter(Boolean);
    const stock = skus.reduce((n, s) => n + (st.stock[s]?.on_hand || 0), 0);
    const suppliers = st.suppliers.filter((s) => (s.products || []).includes(id));
    const rivals = idx.orgs.competitors.filter((c) => c.categories.includes(p.category) || c.categories.includes(CATEGORY_OF[p.category]));
    const prices = st.price_history.filter((h) => skus.includes(h.sku));
    const posts = st.social_posts.filter((x) => x.links?.product_id === id && x.author?.kind === "company");
    return {
      title: p.name, kind_label: "Product", sentence: p.tagline || p.summary, picture: pictureOf(p),
      facts: [
        { label: "Price", value: (p.variants || []).map((v) => v.price).filter(Number.isFinite).length ? `from ${money(Math.min(...p.variants.map((v) => v.price).filter(Number.isFinite)))}` : "" },
        { label: "Sold", value: `${plural(units, "unit")} in ${plural(orders.length, "order")}` },
        { label: "In the stockroom", value: plural(stock, "unit") },
        ...(avg ? [{ label: "Reviews", value: `${avg.toFixed(1)} stars from ${plural(reviews.length, "review")}` }] : []),
        { label: "Why it exists", value: p.why_it_exists || "" },
      ],
      connections: [
        { group: "Made by", items: suppliers.map((s) => ref("supplier", s.id, s.name, s.town)) },
        { group: "Sold elsewhere by", items: rivals.map((c) => ref("org", c.id, c.name, "competitor")) },
        { group: "Recent orders", items: orders.slice(-10).reverse().map((o) => ref("order", o.number, `Order ${o.number.slice(4)}`, `${idx.customers.get(o.customer_id)?.name}, ${dw(o.placed_at)}`)) },
        { group: "Reviews", items: reviews.slice(-6).reverse().map((r) => ref("person", r.customer_id, idx.customers.get(r.customer_id)?.name || "A customer", `${r.rating} stars: ${r.text}`)) },
      ],
      history: [
        ...prices.map((h) => ({ at: `${h.date}T09:00:00Z`, text: `Price ${money(h.old_price)} → ${money(h.new_price)}. ${h.reason}` })),
        ...posts.slice(-10).map((x) => ({ at: x.at, text: `The shop posted it on ${cap(x.network)}: "${plain(x.text, idx).slice(0, 120)}"` })),
        ...(orders[0] ? [{ at: orders[0].placed_at, text: "First sold", kind: "order", id: orders[0].number }] : []),
      ],
      apps: ["stockroom", "till", "squint"],
    };
  },

  order(world, idx, id) {
    const o = idx.orders.get(id);
    if (!o) return null;
    const c = idx.customers.get(o.customer_id);
    const items = o.items.map((it) => ({ ...it, product: productOf(idx, it.sku) }));
    return {
      title: `Order ${id.slice(4)}`, kind_label: "Order",
      sentence: `${c?.name || "A customer"} ordered ${itemsWords(o)} on ${dw(o.placed_at)}. It is ${words(o.status)}.`,
      picture: pictureOf(idx.products.get(items[0]?.product)),
      facts: [
        { label: "Total", value: money(o.totals.total) }, { label: "Delivery", value: `${words(o.delivery?.method)} to ${o.delivery?.address?.town || ""}` },
        { label: "Paid", value: `${words(o.payment?.status)}${o.payment?.refunded ? `, ${money(o.payment.refunded)} refunded` : ""}` },
        ...(o.discount_code ? [{ label: "Code used", value: o.discount_code }] : []),
      ],
      connections: [
        { group: "Customer", items: c ? [ref("person", c.id, c.name, c.addresses?.[0]?.town)] : [] },
        { group: "Products", items: [...new Set(items.map((i) => i.product).filter(Boolean))].map((p) => ref("product", p, idx.products.get(p)?.name)) },
        { group: "Cases", items: (idx.casesByOrder.get(id) || []).map((x) => ref("case", x.number, x.subject, x.status)) },
      ],
      chain: orderChain(world, idx, o),
      history: (o.history || []).map((h) => ({ at: h.at, text: plain(h.event, idx) })),
      apps: ["till", "letterbox", "stockroom", "front-desk"],
    };
  },

  case(world, idx, id) {
    const x = world.state.cases.find((k) => k.number === id);
    if (!x) return null;
    const c = idx.customers.get(x.customer_id);
    const mails = idx.emailsByCase.get(id) || [];
    return {
      title: x.subject, kind_label: x.is_complaint ? "Complaint" : "Case",
      sentence: `${c?.name || "A customer"} ${x.is_complaint ? "complained" : "asked for help"} on ${dw(x.opened_at)}: "${x.subject}". It is ${x.status}.`,
      facts: [{ label: "Kind", value: words(x.category) }, { label: "Status", value: x.status }, ...(x.escalated_to ? [{ label: "Passed to", value: words(x.escalated_to) }] : [])],
      connections: [
        { group: "Customer", items: c ? [ref("person", c.id, c.name)] : [] },
        { group: "About", items: x.related?.order ? [ref("order", x.related.order, `Order ${x.related.order.slice(4)}`)] : [] },
      ],
      history: [{ at: x.opened_at, text: "Opened" }, ...(x.notes || []).map((n) => ({ at: n.at, text: `${words(n.by)}: ${plain(n.text, idx)}` })),
        ...mails.map((m) => ({ at: m.at, text: `Email from ${m.from?.name}: ${plain(m.subject, idx)}` }))],
      apps: ["front-desk", "letterbox"],
    };
  },

  org(world, idx, id) {
    const all = [...idx.orgs.competitors, ...idx.orgs.partners, ...idx.orgs.institutions];
    const o = all.find((x) => x.id === id);
    if (!o) return null;
    const st = world.state;
    const pub = publicView(o);
    const moves = (st.competitor_moves || []).filter((m) => moveOrg(m) === id);
    const parcels = o.kind === "carrier" ? st.orders.filter((x) => (x.shipments || []).some((s) => low(s.carrier) === low(o.name))) : [];
    const late = parcels.filter((x) => (x.shipments || []).some((s) => low(s.carrier) === low(o.name) && s.delivered_at && s.eta && day(s.delivered_at) > s.eta));
    const isRival = o.kind === "competitor";
    return {
      title: o.name, kind_label: cap(o.kind), sentence: o.about,
      facts: [
        ...(isRival ? [{ label: "Sells", value: o.categories.map(catWords).join(", ") }, { label: "Prices", value: pub.prices_in_words }] : []),
        ...(o.kind === "carrier" ? [{ label: "Parcels carried", value: plural(parcels.length, "order") }, { label: "Arrived late", value: plural(late.length, "order") }] : []),
      ],
      lenses: isRival ? {
        business: { title: "What the business can see", note: "Their shop, their prices, their adverts.", rows: [{ label: "Prices", value: pub.prices_in_words }, { label: "Sells", value: o.categories.map(catWords).join(", ") }] },
        world: { title: "What is true in the world", note: "Their own plans. The business cannot see these.", rows: [
          { label: "How they play it", value: o.strategy_in_words || words(o.strategy) },
          ...(o.ad_budget_per_month ? [{ label: "Spends on adverts", value: `${money(o.ad_budget_per_month)} a month` }] : []),
        ] },
      } : undefined,
      connections: [
        { group: "Late parcels", items: late.slice(-8).reverse().map((x) => ref("order", x.number, `Order ${x.number.slice(4)}`, idx.customers.get(x.customer_id)?.name)) },
        { group: "Competes on", items: isRival ? world.products.filter((p) => o.categories.includes(p.category) || o.categories.includes(CATEGORY_OF[p.category])).map((p) => ref("product", p.id, p.name)) : [] },
        { group: "In the news", items: o.kind === "newspaper" ? st.news.slice(-10).reverse().map((n) => ref("news", n.id, n.headline, day(n.at))) : [] },
      ],
      // The reason is the rival's own thinking: world lens only (this route is the owner's).
      history: moves.map((m) => ({ at: moveAt(m), text: `${plain(moveText(m), idx)}${m.reason ? ` Why, in their own plans: ${plain(m.reason, idx)}` : ""}` })),
      apps: isRival ? ["daily-overthinker"] : o.kind === "carrier" ? ["till", "front-desk"] : [],
    };
  },

  supplier(world, idx, id) {
    const s = idx.suppliers.get(id);
    if (!s) return null;
    const pos = world.state.purchase_orders.filter((p) => p.supplier_id === id);
    const late = pos.filter((p) => p.received_at && p.due_at && day(p.received_at) > p.due_at);
    return {
      title: s.name, kind_label: "Supplier", sentence: `${s.name} in ${s.town} makes ${s.products.map((p) => idx.products.get(p)?.name || p).join(", ")} for the shop.`,
      facts: [{ label: "Takes", value: plural(s.lead_time_days, "day") + " to deliver" }, { label: "Purchase orders", value: plural(pos.length, "order") }, { label: "Late", value: plural(late.length, "time") }],
      lenses: supplierLenses(s, idx),
      connections: [{ group: "People", items: idx.supplierPeople.has(id) ? [ref("contact", id, idx.supplierPeople.get(id).contact.name, "Their contact")] : [] },
        { group: "Makes", items: s.products.map((p) => ref("product", p, idx.products.get(p)?.name || p)) }],
      history: [...pos.slice(-15).map((p) => ({ at: p.ordered_at, text: `Purchase order ${p.number.slice(3)} for ${p.lines.reduce((n, l) => n + l.qty, 0)} items, ${words(p.status)}${p.received_at && day(p.received_at) > p.due_at ? " (late)" : ""}` })),
        ...(idx.emailsBySupplier.get(id) || []).slice(-10).map((e) => ({ at: e.at, text: `Email from ${plain(e.from?.name, idx)}: ${plain(e.subject, idx)}`, kind: "contact", id }))],
      apps: ["stockroom", "letterbox", "tally"],
      workings: { supplier_id: id, products: s.products, skus: s.skus, lead_time_days: s.lead_time_days, min_order_qty: s.min_order_qty },
    };
  },

  contact(world, idx, id) {
    const p = idx.supplierPeople.get(id);
    const s = idx.suppliers.get(id);
    if (!p || !s) return null;
    const mail = idx.emailsBySupplier.get(id) || [];
    const mine = (e) => p.addresses.includes(String(e.from?.address || "").toLowerCase());
    return {
      title: p.contact.name, kind_label: "Supplier contact",
      sentence: `${p.contact.name} looks after the shop's orders at ${s.name}${p.contact.from ? `. From ${p.contact.from}` : ""}.`,
      facts: [{ label: "Works for", value: s.name }, { label: "Writes", value: words(p.tone) }, { label: "Emails", value: `${plural(mail.length, "email")} with the shop` }],
      lenses: supplierLenses(s, idx),
      connections: [{ group: "Works for", items: [ref("supplier", id, s.name, s.town)] }],
      chain: mail.slice(-20).map((e) => ({ at: e.at, step: mine(e) ? "They wrote" : "The shop wrote", text: `${cap(plain(e.subject, idx))}. ${plain(String(e.body || "").split("\n").find((l) => l.trim() && !/^(dear|hello|hi|good (morning|afternoon|evening))\b/i.test(l.trim())) || "", idx).slice(0, 160)}`,
        links: [], app: "letterbox" })),
      history: [],
      apps: ["letterbox", "stockroom"],
      workings: { supplier_id: id, addresses: p.addresses, tone: p.tone, mailbox_threads: [...new Set(mail.map((e) => e.thread_id))].slice(-10) },
    };
  },

  news(world, idx, id) {
    const n = world.state.news.find((x) => x.id === id);
    if (!n) return null;
    const ev = n.event ? world.state.world_events.find((e) => e.id === n.event) : null;
    return {
      title: n.headline, kind_label: "News story", sentence: n.story,
      facts: [{ label: "Printed", value: dw(n.at) }, { label: "Section", value: n.section || "" }],
      connections: [{ group: "The event behind it", items: ev ? [ref("event", ev.id, ev.title, `${dw(ev.start)} to ${dw(ev.end)}`)] : [] }],
      history: [{ at: n.at, text: "Printed in The Daily Overthinker" }],
      apps: ["daily-overthinker"],
    };
  },

  event(world, idx, id) {
    const e = world.state.world_events.find((x) => x.id === id);
    if (!e) return null;
    const st = world.state;
    const during = st.orders.filter((o) => day(o.placed_at) >= e.start && day(o.placed_at) <= e.end).length;
    const days = Math.max(1, (Date.parse(e.end) - Date.parse(e.start)) / 864e5);
    return {
      title: e.title, kind_label: "Event", sentence: e.story,
      facts: [{ label: "When", value: `${dw(e.start)} to ${dw(e.end)}` }, { label: "Status", value: e.status }, { label: "Orders while it ran", value: `${plural(during, "order")} (${(during / days).toFixed(1)} a day)` },
        ...effectWords(e.effects).map((w) => ({ label: "Effect", value: w }))],
      connections: [{ group: "In the news", items: (idx.newsByEvent.get(id) || []).map((n) => ref("news", n.id, n.headline, day(n.at))) }],
      history: [{ at: `${dw(e.start)}T00:00:00Z`, text: "Began" }, { at: `${dw(e.end)}T23:00:00Z`, text: "Ended" }],
      apps: ["daily-overthinker"],
    };
  },

  campaign(world, idx, id) {
    const c = idx.campaigns.get(id);
    if (!c) return null;
    const orders = c.code ? world.state.orders.filter((o) => String(o.discount_code || "").toUpperCase() === String(c.code).toUpperCase()) : [];
    return {
      title: c.name, kind_label: "Campaign", sentence: `${c.name} ran on ${words(c.channel)} from ${dw(c.start)} to ${dw(c.end)}.`,
      facts: [{ label: "Spent", value: money(c.spend) }, { label: "Visits", value: String(c.visits ?? "") }, ...(c.code ? [{ label: "Code", value: `${c.code}, ${c.discount_pct}% off` }] : [])],
      connections: [{ group: "Orders that used its code", items: orders.slice(-12).reverse().map((o) => ref("order", o.number, `Order ${o.number.slice(4)}`, idx.customers.get(o.customer_id)?.name)) }],
      history: (idx.chatByCampaign.get(id) || []).map((m) => ({ at: m.at, text: `${m.from_name} in staff chat: "${plain(m.text, idx)}"` })),
      apps: ["megaphone"],
    };
  },

  document(world, idx, id) {
    const d = world.state.documents.find((x) => x.id === id);
    if (!d) return null;
    return { title: d.title, kind_label: "Document", sentence: plain(String(d.body || "").replace(/^#.*\n/, "").split("\n").find((l) => l.trim()) || "", idx),
      facts: [{ label: "Written", value: dw(d.written_at) }, { label: "Status", value: d.status }], body: plain(d.body, idx), connections: [], history: [], apps: ["filing-cabinet"] };
  },

  app(world, idx, id) {
    const a = apps().find((x) => x.id === id);
    if (!a) return null;
    return { title: `${a.name} · ${a.plain}`, kind_label: "App", sentence: a.description, facts: [], open: `/apps/${a.id}/`, connections: [], history: [], apps: [a.id] };
  },

  force(world, idx, id) {
    const st = world.state;
    const f = {
      economy: () => ({ title: "The economy", sentence: "Prices, wages, jobs and how confident people feel. It moves month by month and changes what people spend.",
        rows: (st.economy || []).slice(-24).map((r) => ({ at: `${r.month}-01T00:00:00Z`, text: `Prices rising ${r.cpi_inflation}% a year; confidence ${r.consumer_confidence}; unemployment ${r.unemployment}%; bank rate ${r.bank_rate}%; wages rising ${r.wage_growth}%.`, ...(r.news_id ? { kind: "news", id: r.news_id } : {}) })) }),
      trends: () => ({ title: "Opinion and trends", sentence: "What people are into, and what they think of the shop. Interest in each kind of thing rises and falls; the shop's reputation follows its reviews, complaints and posts.",
        rows: [...(st.trends || []).filter((r) => r.viral || r.spike).slice(-12).map((r) => ({ at: `${r.date}T08:00:00Z`, text: `Interest in ${r.category} things ${r.viral ? "went viral" : "jumped"} (${r.interest} against a usual 100).` })),
          ...(st.opinion || []).filter((r, i, a) => i === a.length - 1 || i % 7 === 0).slice(-12).map((r) => ({ at: `${r.date}T20:00:00Z`, text: `Feeling about the shop: ${r.sentiment >= 0.02 ? "warm" : r.sentiment <= -0.02 ? "grumbling" : "neutral"} (${r.average_rating} stars from ${r.reviews} reviews, ${r.complaints} complaints in 30 days).` }))] }),
      news: () => ({ title: "The news", sentence: "What The Daily Overthinker printed. The news reaches customers and moves what they buy.",
        items: st.news.slice(-30).reverse().map((n) => ref("news", n.id, n.headline, day(n.at))) }),
      events: () => ({ title: "Events", sentence: "Things that happen in the world: seasons, strikes, weather, holidays. Each one moves demand, parcels or questions.",
        items: st.world_events.filter((e) => e.start <= day(st.now)).slice(-30).reverse().map((e) => ref("event", e.id, e.title, `${dw(e.start)} to ${dw(e.end)}`)),
        later: st.world_events.filter((e) => e.start > day(st.now)).slice(0, 12).map((e) => ref("event", e.id, e.title, `from ${dw(e.start)}`)) }),
    }[id]?.();
    if (!f) return null;
    const empty = !(f.items?.length || f.rows?.length);
    return {
      title: f.title, kind_label: "Outside force", sentence: f.sentence + (empty ? " This world has no records of it yet." : ""), facts: [],
      connections: [{ group: id === "events" ? "Recent" : "Latest", items: f.items || [] }, { group: "Coming up", items: f.later || [] }],
      history: f.rows || [], apps: ["daily-overthinker"],
    };
  },

  group(world, idx, id) {
    const st = world.state;
    const g = {
      team: () => ({ title: "The team", sentence: `${plural(idx.staff.length, "person", "people")} run the shop, from one small warehouse.`, items: idx.staff.map((x) => ref("staff", x.id, x.name, x.job)) }),
      suppliers: () => ({ title: "Suppliers", sentence: "The makers the shop buys from, each with a contact person who answers the shop's email.", items: st.suppliers.map((x) => ref("supplier", x.id, x.name, idx.supplierPeople.get(x.id)?.contact?.name || x.town)) }),
      carriers: () => ({ title: "Carriers", sentence: "The couriers who take the shop's parcels to its customers.", items: idx.orgs.partners.filter((o) => o.kind === "carrier").map((o) => ref("org", o.id, o.name, o.about)) }),
      partners: () => ({ title: "Payments, marketplace and ads", sentence: "The businesses the shop pays to take cards, list its things and show its adverts.", items: idx.orgs.partners.filter((o) => o.kind !== "carrier").map((o) => ref("org", o.id, o.name, o.kind)) }),
    }[id]?.();
    if (!g) return null;
    return { title: g.title, kind_label: "Group", sentence: g.sentence, facts: [], connections: [{ group: g.title, items: g.items }], history: [] };
  },

  action(world, idx, id, { trace }) {
    return actionDossier(world, idx, trace, Number(id));
  },
};

/** A supplier as the shop sees it, and as it is (world lens): what it will agree to when asked. */
function supplierLenses(s, idx) {
  const side = idx.supplierPeople.get(s.id)?.side;
  return {
    business: { title: "What the shop knows", note: "From its terms and the orders so far.", rows: [
      { label: "Delivers in", value: plural(s.lead_time_days, "day") }, { label: "Smallest order", value: s.min_order_qty ? plural(s.min_order_qty, "item") : "" },
      { label: "Contact", value: idx.supplierPeople.get(s.id)?.contact?.name || "" }].filter((r) => r.value) },
    world: { title: "What is true in the world", note: "How they will really answer. The shop finds out only by asking.", rows: side ? [
      { label: "Will rush an order", value: side.expedite_share ? `Sometimes (about ${Math.round(side.expedite_share * 100)}% of the time)` : `No: ${side.expedite_refusal || "they cannot"}` },
      { label: "Bulk discount", value: side.volume_discount_percent ? `${side.volume_discount_percent}% for ${side.volume_multiple} times the usual order` : "None" },
      { label: "Changes to an order", value: side.change_window_days ? `Up to ${plural(side.change_window_days, "day")} after ordering` : "Not once it is placed" },
      { label: "Tone", value: words(side.tone) }] : [] },
  };
}

/** A category as people say it. */
const catWords = (c) => ({ food: "food", tech: "technology", everyday: "everyday things", outdoors: "outdoor things", "desk-home": "desk and home", carry: "bags" }[c] || words(c));

const CATEGORY_OF = { food: "food", tech: "tech", everyday: "everyday", outdoors: "outdoors", "desk-home": "desk-home", carry: "carry" };
const INCOME = { Q1: "Lowest fifth", Q2: "Second fifth", Q3: "Middle fifth", Q4: "Fourth fifth", Q5: "Highest fifth" };

function itemsWords(o) {
  const parts = o.items.slice(0, 2).map((it) => `${it.qty > 1 ? `${it.qty} × ` : ""}${String(it.name).split(",")[0]}`);
  return parts.join(" and ") + (o.items.length > 2 ? ` and ${o.items.length - 2} more` : "");
}

function effectWords(effects = {}) {
  const out = [];
  const pct = (m) => `${m >= 1 ? "up" : "down"} ${Math.round(Math.abs(m - 1) * 100)}%`;
  if (effects.demand?.all && effects.demand.all !== 1) out.push(`Shoppers ${pct(effects.demand.all)}`);
  if (effects.visits && effects.visits !== 1) out.push(`Website visits ${pct(effects.visits)}`);
  if (effects.contact_rate && effects.contact_rate !== 1) out.push(`Customers getting in touch ${pct(effects.contact_rate)}`);
  if (effects.carrier_delay_days) out.push(`Parcels ${plural(effects.carrier_delay_days, "day")} slower`);
  return out;
}

// ------------------------------------------------------------------ follow the chain

/**
 * An order's journey, step by step, from what the records hold. A step with no record is left out, never made up.
 * @return {Array<{at: string, step: string, text: string, links: Array<object>, app: ?string}>}
 */
export function orderChain(world, idx, o) {
  const steps = [];
  const c = idx.customers.get(o.customer_id);
  const who = c?.name || "The customer";
  const add = (at, step, text, links = [], app = null) => at && steps.push({ at, step, text, links, app });
  if (o.discount_code) {
    const camp = idx.campaignByCode.get(String(o.discount_code).toUpperCase());
    add(o.placed_at, "How they found it", camp ? `${who} used the code ${o.discount_code} from "${camp.name}", a ${words(camp.channel)} campaign.` : `${who} used the code ${o.discount_code}.`,
      camp ? [ref("campaign", camp.id, camp.name)] : [], "megaphone");
  }
  add(o.placed_at, "Order placed", `${who} ordered ${itemsWords(o)}: ${money(o.totals.total)}.`, c ? [ref("person", c.id, c.name)] : [], "till");
  const ledger = idx.ledgerByRef.get(o.number) || [];
  const sale = ledger.filter((l) => ["sale", "delivery_income", "payment_fee"].includes(l.type));
  if (sale.length) add(sale[0].at, "Money in", `The books show ${sale.map((l) => `${words(l.type)} ${l.amount < 0 ? "−" : ""}${money(Math.abs(l.amount))}`).join(", ")}.`, [], "tally");
  for (const e of (idx.emailsByOrder.get(o.number) || []).filter((m) => m.mailbox === "orders")) add(e.at, "Email sent", `The shop emailed ${who}: "${plain(e.subject, idx)}".`, [], "letterbox");
  for (const m of idx.movesByRef.get(o.number) || []) {
    const p = productOf(idx, m.sku);
    add(m.at, "Stock", `${plural(Math.abs(m.qty), "item")} of ${idx.products.get(p)?.name || "stock"} left the stockroom.`, p ? [ref("product", p, idx.products.get(p)?.name)] : [], "stockroom");
  }
  for (const s of o.shipments || []) {
    const carrier = idx.carriers.get(low(s.carrier));
    const cl = carrier ? [ref("org", carrier.id, carrier.name)] : [];
    add(s.dispatched_at, "Dispatched", `Handed to ${s.carrier}. Due ${dw(s.eta)}.`, cl, "till");
    if (s.delivered_at) add(s.delivered_at, "Delivered", day(s.delivered_at) > s.eta ? `Arrived late, on ${dw(s.delivered_at)} (due ${dw(s.eta)}).` : `Arrived on ${dw(s.delivered_at)}.`, cl, "till");
    else if (s.status && s.status !== "delivered") add(s.dispatched_at, "Where it is", `The parcel is ${words(s.status)}.`, cl, "till");
  }
  const cost = ledger.filter((l) => ["cost_of_goods", "delivery_cost"].includes(l.type));
  if (cost.length) add(cost.at(-1).at, "Costs", `It cost the shop ${cost.map((l) => `${money(Math.abs(l.amount))} for ${l.type === "cost_of_goods" ? "the goods" : "postage"}`).join(" and ")}.`, [], "tally");
  for (const x of idx.casesByOrder.get(o.number) || []) {
    for (const ct of idx.contactsByCase.get(x.number) || []) add(ct.at, "Got in touch", `${who} got in touch by ${words(ct.channel)} about ${words(ct.topic)}${ct.first_reply_minutes != null ? `; first reply after ${ct.first_reply_minutes} minutes` : ""}.`, [], "front-desk");
    add(x.opened_at, x.is_complaint ? "Complaint" : "Case opened", `"${x.subject}". Now ${x.status}.`, [ref("case", x.number, x.subject)], "front-desk");
  }
  for (const e of (idx.emailsByOrder.get(o.number) || []).filter((m) => m.mailbox !== "orders")) add(e.at, "Message", `${e.from?.name}: "${plain(e.subject, idx)}"`, [], "letterbox");
  for (const r of idx.returnsByOrder.get(o.number) || []) {
    add(r.created_at, "Sent back", `Return started (${words(r.reason)}).`, [], "front-desk");
    if (r.refunded_at) add(r.refunded_at, "Refunded", `${money(r.refund_amount)} refunded.`, [], "tally");
  }
  for (const r of idx.reviewsByOrder.get(o.number) || []) add(`${r.date}T12:00:00Z`, "Review", `${r.rating} stars: "${r.text}"`, [ref("product", r.product, idx.products.get(r.product)?.name)], "squint");
  return steps.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** Records a change line or a result names, as links. */
function recordsIn(text, world, idx) {
  const out = [];
  const s = String(text || "");
  for (const m of s.matchAll(/\bORD-\d+\b/g)) out.push(ref("order", m[0], `Order ${m[0].slice(4)}`));
  for (const m of s.matchAll(/\bCASE-\d+\b/g)) out.push(ref("case", m[0], `Case ${m[0].slice(5)}`));
  for (const m of s.matchAll(/\bC-\d+\b/g)) if (idx.customers.has(m[0])) out.push(ref("person", m[0], idx.customers.get(m[0]).name));
  for (const m of s.matchAll(/\bOT-[A-Z0-9-]+\b/g)) { const p = productOf(idx, m[0]); if (p) out.push(ref("product", p, idx.products.get(p)?.name)); }
  for (const m of s.matchAll(/\bS-\d+\b/g)) if (idx.staffById.has(m[0])) out.push(ref("staff", m[0], idx.staffById.get(m[0]).name));
  for (const m of s.matchAll(/\bWE-\d+\b/g)) out.push(ref("event", m[0], world.state.world_events.find((e) => e.id === m[0])?.title || "An event"));
  const seen = new Set();
  return out.filter((r) => { const k = r.kind + r.id; if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * One action from the record (an AI's or a person's tool call): what it read first, what it did, which records
 * changed, and what followed in the same session.
 */
export function actionDossier(world, idx, trace, seq) {
  const t = trace.find((x) => x.seq === seq);
  if (!t || t.kind !== "tool") return null;
  const sameSession = (x) => x.kind === "tool" && x.actor?.session === t.actor?.session && x.actor?.token === t.actor?.token;
  const before = trace.filter((x) => x.seq < seq && sameSession(x)).slice(-8);
  const after = trace.filter((x) => x.seq > seq && sameSession(x)).slice(0, 8);
  const nextAdvance = trace.find((x) => x.seq > seq && x.kind === "advance");
  const who = t.actor?.session === "screen" ? "The screen" : t.via === "mcp" ? "A connected AI" : t.actor?.token === "tok_1" ? "You" : "A connected AI or app";
  const did = toolWords(t.tool);
  const changes = (t.changes || []).map((c) => plain(c, idx));
  return {
    title: cap(words(t.tool)), kind_label: "Action",
    sentence: `${who} ${did}${t.actor?.role ? ` as the ${words(t.actor.role)}` : ""} on ${dw(t.sim_time)}. ${t.ok ? (changes.length ? `It changed ${plural(changes.length, "record")}.` : "It changed nothing.") : `The shop's rules refused it: ${plain(t.error?.message, idx)}`}`,
    facts: [{ label: "When", value: `${dw(t.sim_time)} ${String(t.sim_time).slice(11, 16)}` }, { label: "Answer", value: t.ok ? "Done" : "Refused" }],
    workings: { seq: t.seq, tool: t.tool, role: t.actor?.role, via: t.via, input: t.input, ok: t.ok, error: t.error || null, changes: t.changes || [] },
    chain: [
      ...before.map((x) => ({ at: x.sim_time, step: "Read first", text: `${cap(toolWords(x.tool))}${x.ok ? "" : " (refused)"}`, links: [ref("action", String(x.seq), cap(toolWords(x.tool)))], app: appForTool(x.tool) })),
      { at: t.sim_time, step: "Did", text: `${cap(did)}. ${changes.join("; ") || "No records changed."}`, links: recordsIn(JSON.stringify(t.input) + " " + (t.changes || []).join(" "), world, idx), app: appForTool(t.tool) },
      ...after.map((x) => ({ at: x.sim_time, step: "Then", text: `${cap(toolWords(x.tool))}${(x.changes || []).length ? `: ${plain(x.changes[0], idx)}` : ""}`, links: [ref("action", String(x.seq), cap(toolWords(x.tool)))], app: appForTool(x.tool) })),
      ...(nextAdvance ? [{ at: nextAdvance.now, step: "Time moved", text: `${plural(nextAdvance.days, "day")} passed after it.`, links: [], app: null }] : []),
    ],
    connections: [{ group: "Records it touched", items: recordsIn(JSON.stringify(t.input) + " " + JSON.stringify(t.result || "").slice(0, 4000) + " " + (t.changes || []).join(" "), world, idx).slice(0, 20) }],
    history: [],
    apps: [appForTool(t.tool)].filter(Boolean),
  };
}

const TOOL_WORDS = { send_email: "sent an email", change_price: "changed a price", set_marketing_budget: "changed the marketing budget", set_staffing: "changed the team",
  create_social_post: "posted on social media", issue_refund: "gave a refund", open_case: "opened a case", resolve_case: "closed a case", add_world_event: "started a world event",
  create_purchase_order: "ordered stock", create_campaign: "started a campaign", get_order: "looked up an order", get_customer: "looked up a customer", list_orders: "listed orders",
  search_catalogue: "searched the catalogue", list_emails: "read the inbox", get_email_thread: "read an email", verify_customer: "checked who a customer is" };
const toolWords = (tool) => TOOL_WORDS[tool] || (/^(get|list|search|check|read)_/.test(tool) ? words(tool).replace(/^get /, "looked at ").replace(/^list /, "listed ").replace(/^search /, "searched ").replace(/^check /, "checked ").replace(/^read /, "read ") : `used “${words(tool)}”`);
function appForTool(tool) {
  if (/email|draft|mailbox/.test(tool)) return "letterbox";
  if (/case|refund|return|repair|customer|contact/.test(tool)) return "front-desk";
  if (/chat|channel|direct/.test(tool)) return "kettle";
  if (/social|post/.test(tool)) return "squint";
  if (/stock|purchase_order|supplier/.test(tool)) return "stockroom";
  if (/ledger|summary|books|pay_later/.test(tool)) return "tally";
  if (/news|world_event/.test(tool)) return "daily-overthinker";
  if (/campaign|marketing/.test(tool)) return "megaphone";
  if (/staff|cover/.test(tool)) return "rota";
  if (/order|price|product|catalogue/.test(tool)) return "till";
  if (/document/.test(tool)) return "filing-cabinet";
  return null;
}

// ------------------------------------------------------------------ timeline

/**
 * What happened between two dates: company milestones, events, news, campaigns, price changes, competitor moves, the
 * visitor's own changes; plus orders per bucket for a busy-ness strip.
 */
export function timeline(world, { from, to, trace = [], limit = 400 } = {}) {
  const st = world.state;
  const idx = indexOf(world);
  const first = history()[0]?.date || "2021-03-14";
  const f = day(from || first), t = day(to || st.now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t) || f > t) fail("invalid_input", '"from" and "to" are dates like 2026-11-23, from before to.');
  const inRange = (d) => d && day(d) >= f && day(d) <= t;
  const items = [];
  const add = (at, kind, text, link = null, weight = 1) => inRange(at) && items.push({ at, kind, text, ...(link ? { link } : {}), weight });
  for (const h of history()) add(`${h.date}T09:00:00Z`, "company", h.title, ref("company", "overthought", "Overthought & Co."), 5);
  for (const e of st.world_events) add(`${dw(e.start)}T00:00:00Z`, "event", e.title, ref("event", e.id, e.title), e.family === "calendar" ? 2 : 3);
  for (const n of st.news) if (!n.event) add(n.at, "news", n.headline, ref("news", n.id, n.headline), 2);
  for (const c of st.campaigns) if (!c.always_on) add(`${dw(c.start)}T09:00:00Z`, "campaign", c.name, ref("campaign", c.id, c.name), 2);
  for (const p of st.price_history) { const pid = productOf(idx, p.sku); add(`${p.date}T09:00:00Z`, "price", `${idx.products.get(pid)?.name || "A product"}: ${money(p.old_price)} → ${money(p.new_price)}`, pid ? ref("product", pid, idx.products.get(pid)?.name) : null, 3); }
  for (const m of st.competitor_moves || []) { const id = moveOrg(m); add(moveAt(m), "competitor", plain(moveText(m), idx), id ? ref("org", id, idx.orgs.competitors.find((c) => c.id === id)?.name || "A competitor") : null, 3); }
  for (const x of trace) if (x.kind === "tool" && x.ok && (x.changes || []).length && x.actor?.session !== "screen") add(x.sim_time, "you", `${cap(toolWords(x.tool))}: ${plain(x.changes[0], idx)}`, ref("action", String(x.seq), cap(toolWords(x.tool))), 6);
  items.sort((a, b) => (a.at < b.at ? -1 : 1));
  // Too many for the span: keep the weightiest, then put them back in time order.
  const kept = items.length > limit ? [...items].sort((a, b) => b.weight - a.weight).slice(0, limit).sort((a, b) => (a.at < b.at ? -1 : 1)) : items;
  const spanDays = (Date.parse(t) - Date.parse(f)) / 864e5;
  const bucket = spanDays > 400 ? "month" : spanDays > 60 ? "week" : "day";
  const keyOf = (d) => bucket === "month" ? d.slice(0, 7) : bucket === "week" ? weekStart(d) : d;
  const busy = new Map();
  for (const o of st.orders) { const d = day(o.placed_at); if (d >= f && d <= t) busy.set(keyOf(d), (busy.get(keyOf(d)) || 0) + 1); }
  return { from: f, to: t, now: st.now, bucket, items: kept.map(({ weight, ...x }) => x), total: items.length, orders: [...busy].sort().map(([k, n]) => ({ at: k, n })) };
}
function weekStart(d) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ pulses (what happened, as moves along links)

/**
 * Real things that happened after `since`, as moves between nodes of the graph, oldest first.
 * @return {Array<{at: string, from: object, to: object, kind: string, text: string, link: ?object}>}
 */
export function pulses(world, since, { limit = 80 } = {}) {
  const st = world.state;
  const idx = indexOf(world);
  const s = String(since || st.now);
  const after = (at) => at && at > s && at <= st.now;
  const out = [];
  const company = { kind: "company", id: "overthought" };
  const nodeOfCustomer = (cid) => {
    const comm = idx.communityOf.get(cid);
    const big = [...idx.communities.values()].sort((a, b) => b.customers.length - a.customers.length).slice(0, MAX_COMMUNITIES).some((c) => c.id === comm);
    return { kind: "community", id: big ? comm : "everyone-else" };
  };
  for (let i = st.orders.length - 1; i >= 0 && st.orders[i].placed_at > s; i--) {
    const o = st.orders[i];
    if (!after(o.placed_at)) continue;
    out.push({ at: o.placed_at, from: nodeOfCustomer(o.customer_id), to: company, kind: "order", text: `${idx.customers.get(o.customer_id)?.name} ordered ${itemsWords(o)}`, link: ref("order", o.number, `Order ${o.number.slice(4)}`) });
  }
  for (const o of st.orders.slice(-600)) for (const sh of o.shipments || []) {
    const carrier = idx.carriers.get(low(sh.carrier));
    if (!carrier) continue;
    if (after(sh.dispatched_at)) out.push({ at: sh.dispatched_at, from: company, to: { kind: "org", id: carrier.id }, kind: "dispatch", text: `A parcel left with ${carrier.name}`, link: ref("order", o.number, `Order ${o.number.slice(4)}`) });
    if (after(sh.delivered_at)) out.push({ at: sh.delivered_at, from: { kind: "org", id: carrier.id }, to: nodeOfCustomer(o.customer_id), kind: "delivery", text: `${idx.customers.get(o.customer_id)?.name}'s parcel arrived${sh.eta && day(sh.delivered_at) > sh.eta ? " late" : ""}`, link: ref("order", o.number, `Order ${o.number.slice(4)}`) });
  }
  for (const p of st.purchase_orders.slice(-200)) if (after(p.received_at)) out.push({ at: p.received_at, from: { kind: "supplier", id: p.supplier_id }, to: company, kind: "stock", text: `Stock arrived from ${idx.suppliers.get(p.supplier_id)?.name}`, link: ref("supplier", p.supplier_id, idx.suppliers.get(p.supplier_id)?.name) });
  for (const c of st.contacts.slice(-300)) if (after(c.at) && c.customer_id) out.push({ at: c.at, from: nodeOfCustomer(c.customer_id), to: company, kind: "contact", text: `${idx.customers.get(c.customer_id)?.name || "A customer"} got in touch about ${words(c.topic)}`, link: ref("person", c.customer_id, idx.customers.get(c.customer_id)?.name) });
  for (const n of st.news.slice(-40)) if (after(n.at)) out.push({ at: n.at, from: { kind: "force", id: "news" }, to: { kind: "ring", id: "customers" }, kind: "news", text: n.headline, link: ref("news", n.id, n.headline) });
  for (const p of st.social_posts.slice(-200)) if (after(p.at) && p.author?.kind === "company" && p.kind === "post") out.push({ at: p.at, from: company, to: { kind: "ring", id: "customers" }, kind: "post", text: `The shop posted on ${cap(p.network)}`, link: null });
  for (const m of (st.competitor_moves || []).slice(-40)) { const at = moveAt(m); const id = moveOrg(m); if (after(at) && id) out.push({ at, from: { kind: "org", id }, to: company, kind: "competitor", text: plain(moveText(m), idx), link: ref("org", id, m.competitor_name || id) }); }
  out.sort((a, b) => (a.at < b.at ? -1 : 1));
  // Spread over the period rather than the first few: keep every nth.
  if (out.length <= limit) return out;
  const step = out.length / limit;
  return Array.from({ length: limit }, (_, i) => out[Math.floor(i * step)]);
}

// ------------------------------------------------------------------ this world against the same world left alone

/**
 * Who and what differ between the live world and its shadow twin (the same world, left alone) since time first moved.
 * Empty until the first advance. People are linked only when they existed at the start (then they are the same
 * person in every copy of the world).
 */
export function compareWorlds(sb) {
  const live = sb.live;
  const shadow = live?.started?.() ? live.shadowWorld() : null;
  if (!shadow) return { started: false, people: [], products: [], events: [], changes: [], why: [], people_affected: 0 };
  const world = sb.world;
  const idx = indexOf(world);
  const clock = live.clock();
  const startDate = new Date(Date.parse(`${clock.date}T00:00:00Z`) - clock.day * 864e5).toISOString().slice(0, 10);
  const startCustomers = (() => { try { return new Set(JSON.parse(sb.start.state).customers.map((c) => c.id)); } catch { return new Set(); } })();
  const tally = (st) => {
    const per = new Map(), units = new Map();
    const bump = (id, k, n = 1) => { const r = per.get(id) || per.set(id, { orders: 0, spent: 0, contacts: 0, complaints: 0, reviews: 0, name: null }).get(id); r[k] += n; };
    for (const o of st.orders) if (day(o.placed_at) >= startDate) {
      bump(o.customer_id, "orders"); bump(o.customer_id, "spent", o.totals?.total || 0);
      for (const it of o.items) { const p = productOf(idx, it.sku) || it.sku; units.set(p, (units.get(p) || 0) + it.qty); }
    }
    for (const c of st.contacts) if (day(c.at) >= startDate && c.customer_id) bump(c.customer_id, "contacts");
    for (const c of st.cases) if (day(c.opened_at) >= startDate && c.is_complaint) bump(c.customer_id, "complaints");
    for (const r of st.reviews) if (r.date >= startDate) bump(r.customer_id, "reviews");
    const names = new Map(st.customers.map((c) => [c.id, c.name]));
    for (const [id, r] of per) r.name = names.get(id);
    return { per, units, events: new Map(st.world_events.map((e) => [e.id, e])) };
  };
  const a = tally(world.state), b = tally(shadow.state);
  const people = [];
  const ids = new Set([...a.per.keys(), ...b.per.keys()]);
  for (const id of ids) {
    const x = a.per.get(id) || { orders: 0, spent: 0, contacts: 0, complaints: 0, reviews: 0 }, y = b.per.get(id) || { orders: 0, spent: 0, contacts: 0, complaints: 0, reviews: 0 };
    const d = { orders: x.orders - y.orders, spent: Math.round((x.spent - y.spent) * 100) / 100, contacts: x.contacts - y.contacts, complaints: x.complaints - y.complaints, reviews: x.reviews - y.reviews };
    const size = Math.abs(d.orders) * 2 + Math.abs(d.contacts) + Math.abs(d.complaints) * 3 + Math.abs(d.spent) / 50;
    if (!size) continue;
    const existed = startCustomers.has(id);
    const name = x.name || y.name || "A customer";
    const said = [];
    if (d.orders) said.push(`${d.orders > 0 ? `${plural(d.orders, "more order")}` : `${plural(-d.orders, "fewer order")}`}`);
    else if (Math.abs(d.spent) >= 1) said.push(`spent ${money(Math.abs(d.spent))} ${d.spent > 0 ? "more" : "less"}`);
    if (d.contacts) said.push(`got in touch ${d.contacts > 0 ? `${plural(d.contacts, "more time")}` : `${plural(-d.contacts, "time")} less`}`);
    if (d.complaints) said.push(d.complaints > 0 ? `complained ${plural(d.complaints, "time")}` : "did not complain");
    if (!y.name && x.name && !existed) said.push("a new customer, only in this world");
    people.push({ ...(existed ? { kind: "person", id } : {}), title: name, note: cap(said.join(", ")), size, d });
  }
  people.sort((p, q) => q.size - p.size);
  const products = [];
  for (const p of new Set([...a.units.keys(), ...b.units.keys()])) {
    const d = (a.units.get(p) || 0) - (b.units.get(p) || 0);
    if (d) products.push({ kind: "product", id: p, title: idx.products.get(p)?.name || p, note: `${d > 0 ? "+" : "−"}${plural(Math.abs(d), "unit")} sold`, d });
  }
  products.sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
  const events = [...a.events.values()].filter((e) => !b.events.has(e.id)).map((e) => ({ kind: "event", id: e.id, title: e.title, note: `${dw(e.start)} to ${dw(e.end)}` }));
  // Things done, one line per tool and day (a price change across the range is one decision, not thirty lines).
  const changes = [];
  for (const x of sb.trace.filter((t) => t.kind === "tool" && t.ok && (t.changes || []).length && t.actor?.session !== "screen")) {
    const last = changes.at(-1);
    if (last && last.tool === x.tool && last.date === day(x.sim_time)) { last.n += 1; continue; }
    changes.push({ tool: x.tool, date: day(x.sim_time), n: 1, kind: "action", id: String(x.seq), first: cap(plain(x.changes[0], idx)) });
  }
  const changeRows = changes.map((c) => ({ kind: c.kind, id: c.id, title: c.n > 1 ? `${cap(toolWords(c.tool))}, ${plural(c.n, "time")}` : c.first, note: `${c.n > 1 ? `${c.first}, … · ` : ""}${dw(c.date)}` }));
  // The simulator's own reasons, day by day, when its plug-ins give them (docs/open-world.md: "Explain yourself").
  const why = new Map();
  for (const x of sb.trace) if (x.kind === "advance") for (const s of x.summary || []) for (const w of s?.why || []) {
    const k = `${w.source}|${w.because}`;
    const r = why.get(k) || why.set(k, { source: w.source, because: plain(w.because, idx), days: 0 }).get(k);
    r.days += 1;
  }
  return { started: true, from: startDate, to: clock.date, people: people.slice(0, 24).map(({ size, d, ...p }) => p), people_affected: people.length,
    products: products.slice(0, 10).map(({ d, ...p }) => p), events, changes: changeRows, why: [...why.values()].sort((p, q) => q.days - p.days).slice(0, 8) };
}

// ------------------------------------------------------------------ places to start (from the live records)

/** A handful of live stories worth following, picked from the records as they stand. Never hand-written. */
export function startingPoints(world) {
  const st = world.state;
  const idx = indexOf(world);
  const today = day(st.now);
  const out = [];
  const complaint = [...st.cases].reverse().find((c) => c.is_complaint && !["resolved", "closed"].includes(c.status) && c.related?.order);
  if (complaint) {
    const c = idx.customers.get(complaint.customer_id);
    out.push({ kind: "order", id: complaint.related.order, title: `${c?.name || "A customer"} is not happy`, text: `"${complaint.subject}". Follow their order from the first click to the complaint.` });
  }
  const late = [...st.orders].reverse().find((o) => (o.shipments || []).some((s) => s.delivered_at && s.eta && day(s.delivered_at) > s.eta && day(s.delivered_at) >= addDaysIso(today, -30)));
  if (late) out.push({ kind: "order", id: late.number, title: `${idx.customers.get(late.customer_id)?.name}'s parcel came late`, text: `${itemsWords(late)}, carried by ${late.shipments[0].carrier}.` });
  const now = st.world_events.find((e) => e.start <= today && e.end >= today && e.family !== "calendar") || st.world_events.find((e) => e.start <= today && e.end >= today);
  if (now) out.push({ kind: "event", id: now.id, title: now.title, text: `Happening now, until ${dw(now.end)}. ${now.headline}.` });
  const move = (st.competitor_moves || []).at(-1);
  if (move) { const id = moveOrg(move); out.push({ kind: "org", id, title: plain(moveText(move), idx), text: `${move.competitor_name || "A competitor"}, from ${dw(move.from || move.date)}. ${plain(move.story || "", idx)}` }); }
  const review = [...st.reviews].reverse().find((r) => r.rating <= 2) || st.reviews.at(-1);
  if (review) out.push({ kind: "order", id: review.order_number, title: `${idx.customers.get(review.customer_id)?.name} gave ${review.rating} ${review.rating === 1 ? "star" : "stars"}`, text: `"${review.text}"` });
  const news = st.news.at(-1);
  if (news) out.push({ kind: "news", id: news.id, title: news.headline, text: `In today's Daily Overthinker.` });
  // A family that talks: the customer with the most ties who has ordered lately.
  const recent = [...st.orders].reverse().slice(0, 200).map((o) => idx.customers.get(o.customer_id)).find((c) => (idx.traitsOf.get(c?.id)?.ties || []).length >= 2 && idx.traitsOf.get(c.id).circumstances?.length);
  if (recent) { const t = idx.traitsOf.get(recent.id); out.push({ kind: "person", id: recent.id, title: `${recent.name}, from ${communityName(t.book)}`, text: `Ordered this week. ${cap(words(t.circumstances[0]))}, and knows ${plural(t.ties.length, "other customer")}.` }); }
  return out.slice(0, 6);
}
const addDaysIso = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// ------------------------------------------------------------------ /overthink situations (the lab's, read-only)

/** The lab's ready situations for testing an AI product (lab/situations/*.json): id, title and why, or [] without a lab. */
export function situations() {
  try {
    const dir = new URL("simulation/lab/situations/", ROOT);
    return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
      const x = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
      return { id: x.id || f.replace(/\.json$/, ""), title: x.title, why: x.why };
    });
  } catch { return []; }
}

// ------------------------------------------------------------------ routes

/**
 * The explorer's routes, in infrastructure/server/http.mjs's shape: [method, pattern, handler(req, url, params) → [status, body]].
 * @param {{store: object, ownerOf: function(object, string): {sandbox: object}}} o ownerOf refuses anything but the owner token.
 */
export function exploreRoutes({ store, ownerOf }) {
  const S = "^\\/sandboxes\\/([0-9a-f]{16})\\/explore";
  const ok = (data) => [200, { ok: true, data }];
  return [
    ["GET", new RegExp(`${S}\\/graph$`), (req, url, [id]) => ok(worldGraph(ownerOf(req, id).sandbox.world))],
    ["GET", new RegExp(`${S}\\/search$`), (req, url, [id]) => ok(searchWorld(ownerOf(req, id).sandbox.world, String(url.searchParams.get("q") || "").slice(0, 100), { limit: Math.min(50, Number(url.searchParams.get("limit")) || 20) }))],
    ["GET", new RegExp(`${S}\\/entity\\/([a-z]+)\\/([A-Za-z0-9._-]+)$`), (req, url, [id, kind, eid]) => {
      const sb = ownerOf(req, id).sandbox;
      return ok(dossier(sb.world, kind, decodeURIComponent(eid), { trace: sb.trace }));
    }],
    ["GET", new RegExp(`${S}\\/timeline$`), (req, url, [id]) => {
      const sb = ownerOf(req, id).sandbox;
      return ok(timeline(sb.world, { from: url.searchParams.get("from"), to: url.searchParams.get("to"), trace: sb.trace }));
    }],
    ["GET", new RegExp(`${S}\\/pulses$`), (req, url, [id]) => ok(pulses(ownerOf(req, id).sandbox.world, url.searchParams.get("since")))],
    ["GET", new RegExp(`${S}\\/compare$`), (req, url, [id]) => ok(compareWorlds(ownerOf(req, id).sandbox))],
    ["GET", new RegExp(`${S}\\/starts$`), (req, url, [id]) => ok(startingPoints(ownerOf(req, id).sandbox.world))],
    ["GET", new RegExp(`${S}\\/situations$`), (req, url, [id]) => { ownerOf(req, id); return ok(situations()); }],
  ];
}
