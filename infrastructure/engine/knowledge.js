// The company's knowledge base: every document the business keeps, searchable within each role's permissions.
// An extension of engine.js.
//
// Two stores, read as one:
//   state.documents  the hand-written papers in the world folder (documents.json), some of them out of date on purpose
//   state.knowledge  documents written from the records (business/builder/world/knowledge.mjs -> knowledge.json): supplier
//                    agreements, product sheets, policies, procedures, monthly meeting notes, the staff handbook;
//                    plus anything written at run time with save_document
// Access on each document: "public" (customers and their assistant too), "staff" (everyone inside), or a list of roles.
// The manager and the operations assistant read everything inside. search_knowledge (engine.js, open to everyone)
// reads the same store through the `knowledge` hook, so a customer's assistant finds product sheets but never a
// supplier's prices, and a connected AI only ever reads what its role could read.
import { extend, kit } from "./engine.js";

const { fail, nextId, stamp, dateOf, ms, tokens, matches, schema: { str, obj }, roles } = kit;
const int = { type: "integer" };

const SEE_ALL = ["manager", "operations_assistant"];
const SUPPLY_ROLES = ["buyer", "warehouse", "finance", "manager"];
/** Access for the hand-written papers, which carry none of their own. WHY: a supplier's email quotes their terms. */
const PAPER_ACCESS = { "supplier email": SUPPLY_ROLES };
/** Who may write or change documents; only the manager may publish to customers. */
const WRITERS = ["manager", "support_lead", "finance", "buyer", "marketing", "warehouse"];
const KINDS_WRITABLE = ["policy", "procedure", "guide", "note", "meeting note", "product sheet", "supplier agreement", "handbook"];
const BODY_MAX = 40000;

/** The access rule of a document. */
function accessOf(d) {
  return d.access || PAPER_ACCESS[d.kind] || "staff";
}

/** True when this role may read the document. */
export function canReadDocument(role, d) {
  const a = accessOf(d);
  if (a === "public") return true;
  if (!roles.INTERNAL.includes(role)) return false;
  if (a === "staff" || SEE_ALL.includes(role)) return true;
  return Array.isArray(a) && a.includes(role);
}

/** Every document this role may read, papers first. */
function readable(ctx) {
  return [...(ctx.st.documents || []), ...(ctx.st.knowledge || [])].filter((d) => canReadDocument(ctx.role, d));
}

function find(ctx, id) {
  const d = [...(ctx.st.documents || []), ...(ctx.st.knowledge || [])].find((x) => x.id === id);
  if (!d) fail("not_found", `No document ${id}.`);
  if (!canReadDocument(ctx.role, d)) fail("forbidden", `The ${ctx.role} role may not read "${d.title}".`);
  return d;
}

/** A row for lists: no body, a short summary, who may read it in plain words. */
function row(d, score) {
  const first = String(d.summary || d.body || "").replace(/^#.*$/gm, "").replace(/\s+/g, " ").trim();
  return {
    id: d.id, title: d.title, kind: d.kind, written_at: d.written_at, status: d.status || "current", access: accessOf(d),
    summary: first.length > 180 ? `${first.slice(0, 177)}...` : first, links: d.links || {}, ...(score ? { score } : {}),
    ...(d.edited_at ? { edited_at: d.edited_at, edited_by: d.edited_by } : {}),
  };
}

/** Title words count three times, body words once. */
function scoreOf(d, words) {
  const title = String(d.title).toLowerCase(), body = String(d.body).toLowerCase();
  return words.reduce((n, w) => n + (title.includes(w) ? 3 : 0) + (body.includes(w) ? 1 : 0), 0);
}

/** For search_knowledge: documents this role may read, except policies (it already reads those itself). */
function knowledgeSource(ctx, words) {
  const out = [];
  for (const d of readable(ctx)) {
    if (d.kind === "policy" || d.status === "out_of_date") continue;
    const s = scoreOf(d, words);
    if (!s) continue;
    const passages = String(d.body).split(/\n\s*\n|\n(?=#)/).map((t) => ({ t: t.trim(), n: words.filter((w) => t.toLowerCase().includes(w)).length })).filter((x) => x.n).sort((a, b) => b.n - a.n).slice(0, 2);
    out.push({ kind: "document", id: d.id, title: d.title, passages: passages.map((x) => x.t), score: s });
  }
  return out;
}

const TOOLS = [
  {
    name: "search_documents", roles: roles.INTERNAL,
    description: "Searches the company's knowledge base (title and text) within what this role may read: supplier agreements, product sheets, policies, procedures, meeting notes, the staff handbook and the older hand-written papers (some out of date). query is optional (no query lists everything, newest first); filters kind and status (current, out_of_date); limit defaults to 50 (at most 200). Returns the matching documents (no body; use get_document) and how many of each kind this role can see.",
    input_schema: obj({ query: str, kind: str, status: str, limit: int }),
    // WHY: answers about how the business works must be quoted from its own papers, and only from papers the caller may read.
    run(ctx, i) {
      const words = i.query ? tokens(i.query) : [];
      const mine = readable(ctx);
      const kinds = {};
      for (const d of mine) kinds[d.kind] = (kinds[d.kind] || 0) + 1;
      const rows = mine.filter((d) => (!i.kind || d.kind === i.kind) && (!i.status || (d.status || "current") === i.status) && (!words.length || matches(`${d.title} ${d.body}`, words)))
        .map((d) => ({ d, s: words.length ? scoreOf(d, words) : 0 }))
        .sort((a, b) => b.s - a.s || String(b.d.written_at).localeCompare(String(a.d.written_at)) || (a.d.id < b.d.id ? -1 : 1));
      const n = Math.min(200, Math.max(1, i.limit || 50));
      return { total: rows.length, kinds, documents: rows.slice(0, n).map((x) => row(x.d, x.s)) };
    },
  },
  {
    name: "get_document", roles: roles.INTERNAL,
    description: "One document from the knowledge base in full, if this role may read it.",
    input_schema: obj({ id: str }, ["id"]),
    run(ctx, i) { const d = find(ctx, i.id); return { ...d, access: accessOf(d) }; },
  },
  {
    name: "save_document", roles: WRITERS,
    description: `Writes a new document into the knowledge base, or changes one (give id). title, body (plain text or simple markdown), kind (${KINDS_WRITABLE.join(", ")}), status (current or out_of_date) and access ("staff", or roles separated by commas such as "buyer,finance"; only the manager may make a document "public", which customers and their assistant can then find). You can only change documents you may read. What is written here is what search_knowledge and search_documents return from then on, so a changed procedure changes what a connected AI reads.`,
    input_schema: obj({ id: str, title: str, body: str, kind: str, status: { type: "string", enum: ["current", "out_of_date"] }, access: str }),
    // WHY: a business's rules change; an experiment can be "rewrite the returns procedure and see what the AI does".
    run(ctx, i) {
      const access = i.access === undefined || ["staff", "public"].includes(i.access) ? i.access : String(i.access).split(",").map((r) => r.trim()).filter(Boolean);
      if (access !== undefined && access !== "staff" && access !== "public" && !(Array.isArray(access) && access.length && access.every((r) => roles.INTERNAL.includes(r)))) fail("invalid_input", "access is \"staff\", \"public\" or a list of staff roles.");
      if (access === "public" && ctx.role !== "manager") fail("forbidden", "Only the manager may publish a document to customers.");
      if (i.kind !== undefined && !KINDS_WRITABLE.includes(i.kind)) fail("invalid_input", `kind is one of: ${KINDS_WRITABLE.join(", ")}.`);
      if (i.body !== undefined && String(i.body).length > BODY_MAX) fail("invalid_input", `The text is too long (the most is ${BODY_MAX} characters).`);
      const today = dateOf(ms(ctx.now));
      if (i.id) {
        const d = find(ctx, i.id);
        if (accessOf(d) === "public" && ctx.role !== "manager") fail("forbidden", "Only the manager may change a document customers can read.");
        for (const k of ["title", "body", "kind", "status"]) if (i[k] !== undefined) d[k] = String(i[k]);
        if (access !== undefined) d.access = access;
        d.edited_at = stamp(ctx); d.edited_by = ctx.role; d.written_at = today;
        ctx.changes.push(`document ${d.id} changed`);
        return row(d);
      }
      const title = String(i.title || "").trim(), body = String(i.body || "").trim();
      if (!title || !body) fail("invalid_input", "A new document needs a title and some text.");
      const d = { id: nextId(ctx, "KB", 4), title, kind: i.kind || "note", written_at: today, status: i.status || "current", access: access ?? "staff", body, links: {}, source: ["written here"], edited_at: stamp(ctx), edited_by: ctx.role };
      (ctx.st.knowledge ||= []).push(d);
      ctx.changes.push(`document ${d.id} written: ${title}`);
      return row(d);
    },
  },
];

const REPLACED = ["search_documents", "get_document"];
extend({ state: ["knowledge"], counters: [["KB", "knowledge", "id"]], tools: TOOLS.filter((t) => !REPLACED.includes(t.name)), replace: TOOLS.filter((t) => REPLACED.includes(t.name)), knowledge: [knowledgeSource] });
