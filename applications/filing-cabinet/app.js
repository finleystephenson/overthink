// Filing Cabinet: the company's knowledge base. Every document the business keeps, searchable by title and text,
// within what the person at the computer may read: supplier agreements, product sheets, policies, procedures, monthly
// meeting notes, the staff handbook and the older hand-written papers. People who write documents can add and change
// them (save_document); what is written here is what search_knowledge gives a connected AI from then on.
// Reads: search_documents, get_document. Acts: save_document. (The developers' tool list lives in Connect your AI.)
//   ?doc=KB-0001 opens one document.
import { startApp, esc, plural, timeParts, words, emptyState, skeleton, toast } from "../lib/ui.js";
import { isScreenRead } from "../lib/client.js";
import { plainText } from "../lib/plain.js";
import { recordChip, wireRecordChips } from "../lib/records.js";

const APP_ID = "filing-cabinet";
const { world, app } = await startApp({ id: APP_ID });
document.title = `${app.name} · Overthought & Co.`;
const main = document.getElementById("main");

/** Kinds in the order a person looks for them, with the plain words for each. */
const KINDS = [
  ["policy", "Policies"], ["procedure", "Procedures"], ["handbook", "Staff handbook"], ["product sheet", "Product sheets"],
  ["supplier agreement", "Supplier agreements"], ["meeting note", "Meeting notes"], ["guide", "Guides"], ["note", "Notes"],
  ["price list", "Price lists"], ["supplier email", "Supplier letters"], ["company history", "Company history"],
];
const WRITERS = ["manager", "support_lead", "finance", "buyer", "marketing", "warehouse"];
const WRITABLE = ["procedure", "policy", "guide", "note", "meeting note", "product sheet", "supplier agreement", "handbook"];
const ROLE_WORDS = { support_agent: "customer service", support_lead: "the help desk lead", warehouse: "dispatch", buyer: "buying", finance: "finance", marketing: "marketing", manager: "the manager", technician: "the Fix Club", coordinator: "bookings" };

const S = { kind: "", q: "", docs: [], kinds: {}, open: null, total: 0 };

function read(tool, input = {}) {
  return world.call(tool, input, { screen: true });
}

function dateText(d) {
  if (!d) return "";
  const p = timeParts(`${String(d).slice(0, 10)}T12:00:00Z`);
  return `${p.day} ${p.month} ${p.year}`;
}

/** Who may read a document, in plain words. */
function accessWords(a) {
  if (a === "public") return "Anyone, customers too";
  if (a === "staff" || !a) return "Everyone who works here";
  return `Only ${a.map((r) => ROLE_WORDS[r] || words(r)).join(", ")} (and the manager)`;
}

// ------------------------------------------------------------------ a small, safe Markdown reader

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,;:!?]|$)/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

/**
 * Markdown to HTML for the papers: headings, paragraphs, lists, tables, bold, italics.
 * WHY escape first: the text is written by the data, so it must never become markup of its own.
 * @param {string} md
 * @return {string}
 */
function markdown(md) {
  // WHY the extra "#": plainText drops one "#" before a space (a stray code marker), so each heading gets one to spare.
  const lines = esc(plainText(String(md || "").replace(/^(#{1,4}) /gm, "$1# ")).replace(/\r/g, "")).split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const n = Math.min(4, h[1].length + 1); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      out.push(`<div class="tbl"><table><thead><tr>${cells(body[0]).map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body.slice(1).map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "")); i++; }
      out.push(`<${ordered ? "ol" : "ul"}>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    if (/^&gt;\s?/.test(l)) {
      const q = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) { q.push(lines[i].replace(/^&gt;\s?/, "")); i++; }
      out.push(`<blockquote>${inline(q.join(" "))}</blockquote>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*\||\s*([-*]|\d+\.)\s+|&gt;)/.test(lines[i])) { para.push(lines[i]); i++; }
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("");
}

const ICON = {
  policies: '<path d="M12 3.5 5 6.5v5c0 4.5 3 7.6 7 9 4-1.4 7-4.5 7-9v-5Z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  guides: '<path d="M5 4.5h11.5a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2Z"/><path d="M5 17.5a2 2 0 0 1 2-2h11.5M9 8.5h6"/>',
  products: '<path d="M4 8 12 4l8 4v8.5l-8 4-8-4Z"/><path d="M4 8l8 4 8-4M12 12v8.5"/>',
  suppliers: '<path d="M2.5 6.5h11v9h-11ZM13.5 9.5h4l3 3.5v2.5h-7"/><circle cx="6.5" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/>',
  company: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9.5 20v-6h5v6"/>',
  dev: '<path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5.5l-3 13"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};

/** One of this app's drawings as an inline svg. */
function ico(name, size = 18) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ""}</svg>`;
}

const $ = (id) => document.getElementById(id);

function shell() {
  main.innerHTML = `
    <nav class="fc-rail" id="rail" aria-label="Kinds of document">
      ${WRITERS.includes(world.role) ? `<button class="btn primary fc-new" id="new-doc">Write a document</button>` : ""}
      <p class="rail-h">Kinds</p>
      <ul class="rail-list" id="kinds"></ul>
    </nav>
    <div class="fc-scrim" id="scrim" hidden></div>
    <section class="fc-list" id="list-pane" aria-label="Documents">
      <header class="list-head">
        <button class="btn ghost icon-only small list-rail-btn" id="rail-open" aria-label="Kinds">${ico("menu")}</button>
        <div class="list-title"><h1 class="fc-title" id="list-title">&nbsp;</h1><p class="list-sub" id="list-sub">&nbsp;</p></div>
      </header>
      <form class="fc-search" role="search" id="find">${ico("search", 17)}
        <input class="fc-search-input" id="q" name="q" type="search" placeholder="Search titles and text" aria-label="Search titles and text" autocomplete="off"></form>
      <ul class="fc-rows" id="rows" aria-label="Documents"></ul>
    </section>
    <section class="fc-read" id="read" aria-live="polite" tabindex="-1"><div class="read-empty"><p class="read-empty-title">Pick a document to read it.</p><p class="read-empty-text">You see what your job may read. <kbd>/</kbd> searches.</p></div></section>`;
  main.dataset.view = "list";
  $("rail-open").addEventListener("click", () => toggleRail(true));
  $("scrim").addEventListener("click", () => toggleRail(false));
  $("new-doc")?.addEventListener("click", () => editor(null));
  let timer = null;
  $("q").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { S.q = e.target.value.trim(); load(); }, 250);
  });
  $("find").addEventListener("submit", (e) => e.preventDefault());
}

function toggleRail(open) {
  main.classList.toggle("is-rail-open", open);
  $("scrim").hidden = !open;
}

function paintKinds() {
  const all = Object.values(S.kinds).reduce((a, b) => a + b, 0);
  const known = KINDS.filter(([k]) => S.kinds[k]);
  const extra = Object.keys(S.kinds).filter((k) => !KINDS.some(([x]) => x === k)).map((k) => [k, words(k)]);
  $("kinds").innerHTML = [["", "Everything"], ...known, ...extra].map(([k, label]) => `<li><button class="rail-row${S.kind === k ? " is-on" : ""}" data-kind="${esc(k)}"><span class="rail-name">${esc(label)}</span><span class="rail-n">${k ? S.kinds[k] : all}</span></button></li>`).join("");
  $("kinds").querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => { S.kind = b.dataset.kind; toggleRail(false); load(); }));
}

async function load() {
  $("rows").innerHTML = `<li class="rows-pad">${skeleton(8)}</li>`;
  const input = { limit: 200 };
  if (S.q) input.query = S.q;
  if (S.kind) input.kind = S.kind;
  const res = await read("search_documents", input);
  if (!res.ok) { $("rows").innerHTML = `<li class="rows-pad">${esc(res.error.message)}</li>`; return; }
  S.docs = res.data.documents;
  S.kinds = res.data.kinds;
  S.total = res.data.total;
  paintKinds();
  $("list-title").textContent = S.kind ? (KINDS.find(([k]) => k === S.kind)?.[1] || words(S.kind)) : "Everything";
  $("list-sub").textContent = `${plural(S.total, "document")}${S.q ? ` with “${S.q}”` : ""}`;
  $("rows").innerHTML = S.docs.length ? S.docs.map((d) => `<li><button class="fc-row${d.id === S.open ? " is-on" : ""}" data-doc="${esc(d.id)}">
      <span class="row-title">${esc(d.title)}</span><span class="row-sub">${esc(words(d.kind))} · ${esc(dateText(d.written_at))}${d.status === "out_of_date" ? " · out of date" : ""}</span></button></li>`).join("")
    : `<li class="rows-pad">${S.q ? "Nothing you may read says that." : "Nothing here."}</li>`;
  $("rows").querySelectorAll("[data-doc]").forEach((b) => b.addEventListener("click", () => openDoc(b.dataset.doc)));
}

/** The records a document is about, as chips that open them. */
function linkChips(links = {}) {
  const chips = [];
  if (links.supplier_id) chips.push(recordChip("supplier", links.supplier_id));
  for (const po of links.pos || []) chips.push(recordChip("po", po));
  for (const c of links.campaigns || []) chips.push(recordChip("campaign", c));
  return chips.length ? `<p class="page-chips">${chips.join(" ")}</p>` : "";
}

async function openDoc(id) {
  S.open = id;
  $("rows").querySelectorAll("[data-doc]").forEach((b) => b.classList.toggle("is-on", b.dataset.doc === id));
  main.dataset.view = "read";
  const pane = $("read");
  pane.innerHTML = `<div class="read-scroll"><div class="page">${skeleton(10)}</div></div>`;
  const res = await read("get_document", { id });
  if (S.open !== id) return;
  if (!res.ok) { pane.innerHTML = `<div class="read-scroll">${emptyState({ title: res.error.code === "forbidden" ? "Your job may not read this one." : "That document has gone." })}</div>`; return; }
  const d = res.data;
  history.replaceState(null, "", `?doc=${encodeURIComponent(id)}`);
  const canEdit = WRITERS.includes(world.role) && (d.access !== "public" || world.role === "manager");
  pane.innerHTML = `<div class="read-bar"><button class="btn ghost small read-back" id="read-back">${ico("back", 16)}<span>Back</span></button></div>
    <div class="read-scroll"><article class="page">
      <header class="page-head"><p class="page-kicker">${esc(words(d.kind))}${d.status === "out_of_date" ? ' <span class="pill bad">Out of date</span>' : ""}</p>
        <h2 class="page-title">${esc(d.title)}</h2>
        <p class="page-meta">${esc(dateText(d.written_at))}${d.edited_at ? ` · changed here by ${esc(ROLE_WORDS[d.edited_by] || words(d.edited_by))}` : ""} · Who can read it: ${esc(accessWords(d.access))}</p>
        ${linkChips(d.links)}
        ${canEdit ? `<p class="page-acts"><button class="btn small" id="edit">Change it</button> <button class="btn small ghost" id="stale">${d.status === "out_of_date" ? "Mark as current" : "Mark out of date"}</button><span class="fc-said" id="said"></span></p>` : ""}
      </header>
      <div class="prose">${markdown(d.body)}</div>
    </article></div>`;
  wireRecordChips(pane, world);
  $("read-back").addEventListener("click", () => { main.dataset.view = "list"; });
  $("edit")?.addEventListener("click", () => editor(d));
  $("stale")?.addEventListener("click", async () => {
    const r = await world.call("save_document", { id: d.id, status: d.status === "out_of_date" ? "current" : "out_of_date" });
    if (!r.ok) { $("said").textContent = r.error.message; return; }
    toast(r.data.status === "out_of_date" ? "Marked out of date. Nobody will be quoted it now." : "Marked current.");
    await load();
    openDoc(d.id);
  });
}

/** Writing a new document or changing one, in place. */
function editor(d) {
  main.dataset.view = "read";
  const pane = $("read");
  const roles = Object.keys(ROLE_WORDS);
  const access = d ? d.access : "staff";
  pane.innerHTML = `<div class="read-scroll"><form class="page fc-edit" id="edit-form">
    <p class="page-kicker">${d ? "Changing a document" : "A new document"}</p>
    <label class="field"><span class="pm-label">Title</span><input class="input" name="title" required maxlength="160" value="${esc(d?.title || "")}"></label>
    <div class="fc-edit-row">
      <label class="field"><span class="pm-label">Kind</span><select class="select" name="kind">${WRITABLE.map((k) => `<option value="${esc(k)}" ${(d?.kind || "procedure") === k ? "selected" : ""}>${esc(words(k))}</option>`).join("")}</select></label>
      <label class="field"><span class="pm-label">Who can read it</span><select class="select" name="access">
        <option value="staff" ${access === "staff" ? "selected" : ""}>Everyone who works here</option>
        ${world.role === "manager" ? `<option value="public" ${access === "public" ? "selected" : ""}>Anyone, customers too</option>` : ""}
        ${roles.map((r) => `<option value="${esc(r)}" ${Array.isArray(access) && access.length === 1 && access[0] === r ? "selected" : ""}>Only ${esc(ROLE_WORDS[r])}</option>`).join("")}
        ${Array.isArray(access) && access.length > 1 ? `<option value="${esc(access.join(","))}" selected>${esc(accessWords(access))}</option>` : ""}
      </select></label>
    </div>
    <label class="field"><span class="pm-label">Text (a line starting with # is a heading, - is a list)</span><textarea class="textarea fc-body-text" name="body" required rows="18">${esc(d?.body || "")}</textarea></label>
    <p class="page-acts"><button class="btn primary" type="submit">${d ? "Save the change" : "Save it"}</button> <button class="btn ghost" type="button" id="cancel">Cancel</button><span class="fc-said" id="said"></span></p>
  </form></div>`;
  $("cancel").addEventListener("click", () => (d ? openDoc(d.id) : (main.dataset.view = "list", $("read").innerHTML = "")));
  $("edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const input = { title: f.get("title"), body: f.get("body"), kind: f.get("kind"), access: f.get("access") };
    if (d) input.id = d.id;
    const r = await world.call("save_document", input);
    if (!r.ok) { $("said").textContent = r.error.message; $("said").dataset.tone = "bad"; return; }
    toast(d ? "Saved. Anyone who searches finds the new words." : "Saved in the cabinet.");
    await load();
    openDoc(r.data.id);
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !e.target.closest?.("input, textarea, select")) { e.preventDefault(); $("q").focus(); }
});
document.addEventListener("ot:role", () => { shell(); load(); });
world.onChange((change) => {
  if (change.reset) { location.reload(); return; }
  if (change.entries.some((x) => !isScreenRead(x) && x.tool === "save_document")) load();
});

shell();
await load();
const askedDoc = new URLSearchParams(location.search).get("doc");
if (askedDoc) openDoc(askedDoc);
