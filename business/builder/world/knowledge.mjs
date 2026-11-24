// The company's knowledge base, written from the business's own records: supplier agreements, product sheets,
// policies, procedures, monthly meeting notes and a staff handbook. Rules only, no AI: every sentence is a fact from a
// data file, laid out as the document a small firm would keep. Deterministic (no random numbers, no clock).
//
// Written to business/data/world/<size>/knowledge.json (and the bench worlds) by business/builder/build-knowledge.mjs; the engine loads it
// into state.knowledge and infrastructure/engine/knowledge.js serves it, within each role's permissions.
//
// Access: "public" (customers and their assistant too), "staff" (everyone inside), or a list of roles. The manager and
// the operations assistant read everything inside.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseFrontMatter } from "../../../infrastructure/engine/load.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Unit costs and supplier terms: the people who buy, receive, pay for and approve stock. */
const SUPPLY_ROLES = ["buyer", "warehouse", "finance", "manager"];

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);
const money = (n) => `£${Number(n).toFixed(2).replace(/\.00$/, "")}`;
const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const longDate = (d) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/**
 * Builds every knowledge document for one world folder.
 * @param {{dataDir: string, worldDir: string}} o dataDir is business/data/; worldDir the world's folder (business/data/world/<size>).
 * @return {Array<object>} Documents: { id, title, kind, written_at, status, access, body, links, source }.
 */
export function buildKnowledge({ dataDir, worldDir }) {
  const read = (name, fallback = []) => readJson(join(worldDir, `${name}.json`), fallback);
  const company = read("company", {});
  const products = readdirSync(join(dataDir, "products")).filter((f) => f.endsWith(".json")).sort().map((f) => readJson(join(dataDir, "products", f)));
  const docs = [
    ...supplierAgreements(read("suppliers"), read("supplier_disruptions"), readJson(join(dataDir, "organisations.json"), {}).supplier_constraints || {}, products, company),
    ...productSheets(products, company),
    ...markdownDocs(join(dataDir, "policies"), "policy", () => "public", company),
    ...markdownDocs(join(dataDir, "procedures"), "procedure", (m) => (m.audience === "customer" ? "public" : Array.isArray(m.roles) ? [...new Set([...m.roles.filter((r) => r !== "assistant"), "support_lead"])] : "staff"), company),
    ...meetingNotes(readJson(join(dataDir, "history", "timeline.json"), { entries: [] }).entries, read("monthly_summary"), read("world_developments"), read("supplier_disruptions"), company),
    staffHandbook(readJson(join(dataDir, "staff.json"), { staff: [] }), readJson(join(dataDir, "team.json"), { people: {} }), readJson(join(dataDir, "business.json"), {}), company),
  ];
  return docs.map((d, i) => ({ id: `KB-${String(i + 1).padStart(4, "0")}`, status: "current", ...d }));
}

/** The date a document was last brought up to date: the world's last day of history. */
function asOf(company) {
  return String(company.history_to || company.as_of || "2026-11-22").slice(0, 10);
}

function supplierAgreements(suppliers, disruptions, constraints, products, company) {
  const nameOf = (sku) => {
    for (const p of products) for (const x of [...(p.variants || []), ...(p.accessories || [])]) if (x.sku === sku) return x.name && x.name !== p.name ? `${p.name} (${x.name})` : p.name;
    return sku;
  };
  return suppliers.map((s) => {
    const c = constraints[s.id] || {};
    const past = disruptions.filter((d) => d.supplier === s.id).sort((a, b) => (a.from < b.from ? -1 : 1));
    const lines = Object.entries(s.unit_cost || {}).map(([sku, cost]) => `| ${nameOf(sku)} | ${sku} | ${money(cost)} |`);
    const body = [
      `${s.name}, ${[s.town, s.country].filter(Boolean).join(", ")}. Supplies ${products.filter((p) => (s.products || []).includes(p.id)).map((p) => p.name).join(", ") || "parts and packaging"}.`,
      "## Terms",
      `- Delivery takes ${s.lead_time_days} day${s.lead_time_days === 1 ? "" : "s"} from the order.`,
      `- Smallest order: ${s.min_order_qty} per line${c.minimum_order_value ? `, and they ask for at least ${money(c.minimum_order_value)} an order` : ""}.`,
      `- We pay ${s.payment_terms_days ? `within ${s.payment_terms_days} days of delivery` : "on delivery"}.`,
      s.reliability != null ? `- On time about ${Math.round(s.reliability * 10)} times in 10.` : null,
      c.capacity_multiple ? `- They can make about ${c.capacity_multiple} of our usual orders in a week. A bigger order takes an extra week for each extra week's worth.` : null,
      c.disruption ? `- When something goes wrong there, it is usually that ${c.disruption}. Expect up to ${c.lead_time_spread_days} extra days.` : null,
      s.notes ? `\n${s.notes}` : null,
      "## Prices we pay",
      "| Product | Code | Each |", "|---|---|---|", ...lines,
      past.length ? "## Past problems" : null,
      ...past.map((d) => `- ${longDate(d.from)} to ${longDate(d.to)}: ${d.reason}; orders took ${d.extra_lead_days} more day${d.extra_lead_days === 1 ? "" : "s"}.`),
    ].filter((x) => x !== null).join("\n");
    return { title: `Supplier agreement: ${s.name}`, kind: "supplier agreement", written_at: asOf(company), access: SUPPLY_ROLES, body, links: { supplier_id: s.id }, source: ["suppliers", "organisations.supplier_constraints", "supplier_disruptions"] };
  });
}

function productSheets(products, company) {
  return products.map((p) => {
    const variants = (p.variants || []).map((v) => `| ${v.name} | ${v.sku} | ${money(v.price)} |`);
    const body = [
      p.tagline || null, "", p.summary || null,
      "## Versions and prices", "| Version | Code | Price |", "|---|---|---|", ...variants,
      (p.specs || []).length ? "## Specifications" : null, ...(p.specs || []).map(([k, v]) => `- ${k}: ${v}`),
      (p.in_the_box || []).length ? "## In the box" : null, ...(p.in_the_box || []).map((x) => `- ${x}`),
      (p.care || []).length ? "## Care" : null, ...(p.care || []).map((x) => `- ${x}`),
      (p.safety || []).length ? "## Safety" : null, ...(p.safety || []).map((x) => `- ${x}`),
      p.warranty?.summary ? `## Warranty\n${p.warranty.summary}` : null,
      p.returnable?.note ? `## Returns\n${p.returnable.note}` : null,
      (p.faq || []).length ? "## Questions people ask" : null, ...(p.faq || []).map((f) => `**${f.q}** ${f.a}`),
    ].filter((x) => x !== null).join("\n");
    return { title: `Product sheet: ${p.name}`, kind: "product sheet", written_at: asOf(company), access: "public", body, links: { product_id: p.id }, source: [`products/${p.id}.json`] };
  });
}

function markdownDocs(dir, kind, accessFor, company) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => {
    const doc = parseFrontMatter(readFileSync(join(dir, f), "utf8"));
    return { title: doc.title || f.replace(/\.md$/, ""), kind, written_at: asOf(company), access: accessFor(doc), body: doc.body.trim(), summary: doc.summary || null, links: { [kind]: f.replace(/\.md$/, "") }, source: [`${kind === "policy" ? "policies" : "procedures"}/${f}`] };
  });
}

/** One set of notes a month: the month's figures, what happened (the company timeline), and the outside world. */
function meetingNotes(entries, months, developments, disruptions, company) {
  const byMonth = new Map();
  const add = (ym, kind, item) => { if (!byMonth.has(ym)) byMonth.set(ym, { entries: [], outside: [] }); byMonth.get(ym)[kind].push(item); };
  for (const e of entries) add(e.date.slice(0, 7), "entries", e);
  for (const d of developments) add(d.from.slice(0, 7), "outside", d.headline);
  for (const d of disruptions) add(d.from.slice(0, 7), "outside", `${d.supplier_name}: ${d.reason}`);
  const figures = new Map(months.map((m) => [m.month, m]));
  const notes = [];
  for (const ym of [...byMonth.keys()].sort()) {
    const m = figures.get(ym);
    const { entries: es, outside } = byMonth.get(ym);
    if (!es.length && !m) continue;
    const people = [...new Set(es.flatMap((e) => e.people || []))];
    const body = [
      people.length ? `Present: ${people.join(", ")}.` : "Present: the team.",
      m ? `## The month in figures\n- Orders: ${m.orders}\n- Revenue: ${money(m.revenue)}\n- Profit: ${money(m.profit)}${m.cash_at_month_end != null ? `\n- Cash at month end: ${money(m.cash_at_month_end)}` : ""}` : null,
      es.length ? "## What happened" : null,
      ...es.map((e) => `- ${longDate(e.date)}, ${e.title}. ${e.text}`),
      outside.length ? "## Outside the shop" : null,
      ...outside.map((x) => `- ${x}`),
    ].filter((x) => x !== null).join("\n");
    const links = {};
    for (const e of es) for (const [k, v] of Object.entries(e.links || {})) links[k] = [...new Set([...(links[k] || []), ...v])];
    notes.push({ title: `Team meeting notes, ${monthName(ym)}`, kind: "meeting note", written_at: `${ym}-28`, access: "staff", body, links, source: ["history/timeline.json", "monthly_summary", "world_developments", "supplier_disruptions"] });
  }
  return notes;
}

function staffHandbook(staff, team, business, company) {
  const name = (id) => staff.staff.find((s) => s.id === id)?.name || "nobody";
  const days = (staff.days || []).map((d) => d[0].toUpperCase() + d.slice(1)).join(", ");
  const body = [
    `Welcome to ${business.name || "Overthought & Co."}. This is how we work.`,
    "## Hours",
    `We work ${days}, from ${staff.day_start || "09:00"}. Each person's contracted hours are in their contract; work beyond them is overtime and only for people whose contract allows it.`,
    "## Who does what",
    ...staff.staff.map((s) => {
      const t = team.people?.[s.id] || {};
      return `- **${s.name}**, ${s.job}. ${t.why || ""}${t.reports_to ? ` Reports to ${name(t.reports_to)}.` : ""}${(t.skills || []).length ? ` Ask about: ${t.skills.join(", ")}.` : ""}`;
    }),
    "## Who may do what",
    ...Object.entries(business.roles || {}).filter(([k]) => !k.startsWith("_")).map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${typeof v === "string" ? v : v.description || ""}`),
    "## Staff chat",
    "Money talk stays in #money (finance and the manager). Stock in #stockroom, parcels in #orders, customers in #customers, campaigns in #marketing. Everyone reads #general and #random.",
    "## Tasks",
    "Work handed to you is a task with an estimate. It comes out of your day: urgent tasks before customers, the rest after. Say in the task if the estimate is wrong.",
  ].join("\n");
  return { title: "Staff handbook", kind: "handbook", written_at: asOf(company), access: "staff", body, links: {}, source: ["staff.json", "team.json", "business.json"] };
}
