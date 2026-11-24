// Contacts: the company's address book. Everyone the business knows in one list: customers, suppliers and the
// people who answer for them, the team, partners, and prospects (for marketing and the manager). Each card is read from
// the record it stands for, cut to what the person at the computer may see, and opens that record. The address book's
// own notes and tags can be changed here; what is written is what a connected AI reads from then on.
// Reads: list_contact_cards, get_contact_card. Acts: update_contact_card.
//   ?card=SUP-01 opens one card.
import { startApp, esc, plural, timeParts, words, emptyState, skeleton, toast, avatar, copyText, money2 } from "../lib/ui.js";
import { isScreenRead } from "../lib/client.js";
import { openRecord, recordChip, wireRecordChips, recordLabel } from "../lib/records.js";

const APP_ID = "contacts";
const { world, app } = await startApp({ id: APP_ID });
document.title = `${app.name} · Overthought & Co.`;
const main = document.getElementById("main");

/** The kinds, in the order a person looks for them, with the plain words for each. */
const KINDS = [["", "Everyone"], ["customer", "Customers"], ["supplier", "Suppliers"], ["staff", "The team"], ["partner", "Partners"], ["prospect", "Prospects"]];
const ONE = { customer: "Customer", supplier: "Supplier", staff: "Works here", partner: "Partner", prospect: "Prospect" };
const PAGE = 200;
/** What the main button says, by the kind of record behind the card. */
const OPEN_WORDS = { customer: "Open their customer page", supplier: "Open the supplier", staff: "Open their team page", organisation: "Open the organisation", prospect: "Open the prospect" };

const S = { kind: "", tag: "", q: "", cards: [], counts: {}, tags: [], total: 0, open: null, ownAt: 0 };
/** How long a change made on this screen is treated as ours when the world reports it back. */
const OWN_MS = 5000;

const ICON = {
  everyone: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M15.5 14.6c2.6-.3 4.4 1.1 5 4.4"/>',
  customer: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.8 3.6-5.6 7-5.6s6.2 1.8 7 5.6"/>',
  supplier: '<path d="M2.5 6.5h11v9h-11ZM13.5 9.5h4l3 3.5v2.5h-7"/><circle cx="6.5" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/>',
  staff: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9.5 20v-6h5v6"/>',
  partner: '<path d="M3 11.5 7.5 7l4 3 2-1.5 3.5 3"/><path d="m3 11.5 5.5 5.5c.8.8 2 .8 2.8 0L21 7.5"/>',
  prospect: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  tag: '<path d="M4 4h7l9 9-7 7-9-9Z"/><circle cx="8.5" cy="8.5" r="1.4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
};

/** One of this app's drawings as an inline svg. */
function ico(name, size = 18) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ""}</svg>`;
}

const $ = (id) => document.getElementById(id);

function read(tool, input = {}) {
  return world.call(tool, input, { screen: true });
}

/** "4 March 2024" from a date or a time. */
function dateText(d) {
  if (!d) return "";
  const p = timeParts(`${String(d).slice(0, 10)}T12:00:00Z`);
  return `${p.day} ${p.month} ${p.year}`;
}

// ------------------------------------------------------------------ the frame

function shell() {
  main.innerHTML = `
    <nav class="ct-rail" id="rail" aria-label="Groups">
      <p class="rail-h">People</p>
      <ul class="rail-list" id="kinds"></ul>
      <p class="rail-h">Tags</p>
      <ul class="rail-list" id="tags"></ul>
    </nav>
    <div class="ct-scrim" id="scrim" hidden></div>
    <section class="ct-list" id="list-pane" aria-label="Contacts">
      <header class="list-head">
        <button class="btn ghost icon-only small list-rail-btn" id="rail-open" aria-label="Groups">${ico("menu")}</button>
        <div class="list-title"><h1 class="ct-title" id="list-title">&nbsp;</h1><p class="list-sub" id="list-sub">&nbsp;</p></div>
      </header>
      <form class="ct-search" role="search" id="find">${ico("search", 17)}
        <input class="ct-search-input" id="q" name="q" type="search" placeholder="Search names, places and notes" aria-label="Search names, places and notes" autocomplete="off" value="${esc(S.q)}"></form>
      <ul class="ct-rows" id="rows" aria-label="Contacts"></ul>
    </section>
    <section class="ct-read" id="read" aria-live="polite" tabindex="-1">${nothingOpen()}</section>`;
  main.dataset.view = "list";
  $("rail-open").addEventListener("click", () => toggleRail(true));
  $("scrim").addEventListener("click", () => toggleRail(false));
  let timer = null;
  $("q").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { S.q = e.target.value.trim(); load(); }, 250);
  });
  $("find").addEventListener("submit", (e) => e.preventDefault());
}

function nothingOpen() {
  return `<div class="read-empty"><p class="read-empty-title">Pick someone to see their card.</p><p class="read-empty-text"><kbd>J</kbd> and <kbd>K</kbd> move. <kbd>/</kbd> searches.</p></div>`;
}

function toggleRail(open) {
  main.classList.toggle("is-rail-open", open);
  $("scrim").hidden = !open;
}

function paintRail() {
  const all = Object.values(S.counts).reduce((a, b) => a + b, 0);
  const shown = KINDS.filter(([k]) => !k || k in S.counts);
  $("kinds").innerHTML = shown.map(([k, label]) => `<li><button class="rail-row${!S.tag && S.kind === k ? " is-on" : ""}" data-kind="${esc(k)}">
      <span class="rail-ico">${ico(k || "everyone", 17)}</span><span class="rail-name">${esc(label)}</span><span class="rail-n">${k ? S.counts[k] : all}</span></button></li>`).join("");
  $("tags").innerHTML = S.tags.length
    ? S.tags.map((t) => `<li><button class="rail-row${S.tag === t ? " is-on" : ""}" data-tag="${esc(t)}"><span class="rail-ico">${ico("tag", 17)}</span><span class="rail-name">${esc(t)}</span></button></li>`).join("")
    : `<li class="rail-quiet">No tags yet.</li>`;
  $("kinds").querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => { S.kind = b.dataset.kind; S.tag = ""; toggleRail(false); load(); }));
  $("tags").querySelectorAll("[data-tag]").forEach((b) => b.addEventListener("click", () => { S.tag = b.dataset.tag; S.kind = ""; toggleRail(false); load(); }));
}

// ------------------------------------------------------------------ the list

/** The words under a name: what they are, then how to reach them. */
function rowSub(c) {
  const what = c.kind === "customer" ? "Customer" : c.title || ONE[c.kind];
  return [what, c.email || c.town].filter(Boolean).join(" · ");
}

function rowHtml(c) {
  const org = (c.kind === "supplier" || c.kind === "prospect") && c.organisation ? ` <small>· ${esc(c.organisation)}</small>` : "";
  return `<li><button class="ct-row${c.id === S.open ? " is-on" : ""}" data-card="${esc(c.id)}">
    <span class="row-title"><span>${esc(c.name)}</span>${org}</span><span class="row-sub">${esc(rowSub(c))}</span></button></li>`;
}

/** Rows under letter headers ("A", "B" ...), by the name a person looks under. */
function groupedRows(cards) {
  let last = null;
  return cards.map((c) => {
    const first = (c.sort_name || c.name || "#").charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : "#";
    const head = letter !== last ? `<li class="ct-letter" aria-hidden="true">${letter}</li>` : "";
    last = letter;
    return head + rowHtml(c);
  }).join("");
}

function paintRows() {
  const more = S.cards.length < S.total;
  $("rows").innerHTML = S.cards.length
    ? groupedRows(S.cards) + (more ? `<li class="ct-more"><button class="btn small" id="more">Show more</button></li>` : "")
    : `<li class="rows-pad">${S.q || S.tag ? "No one matches that." : "No one here yet."}</li>`;
  $("rows").querySelectorAll("[data-card]").forEach((b) => b.addEventListener("click", () => openCard(b.dataset.card)));
  $("more")?.addEventListener("click", () => load({ more: true }));
}

async function load({ more = false } = {}) {
  if (!more) $("rows").innerHTML = `<li class="rows-pad">${skeleton(8)}</li>`;
  const input = { limit: PAGE, offset: more ? S.cards.length : 0 };
  if (S.q) input.search = S.q;
  if (S.kind) input.kind = S.kind;
  if (S.tag) input.tag = S.tag;
  const res = await read("list_contact_cards", input);
  if (!res.ok) {
    $("list-title").textContent = "Contacts";
    $("list-sub").textContent = "";
    $("rows").innerHTML = `<li class="rows-pad">${emptyState({ title: "Not for this desk.", text: res.error.message })}</li>`;
    return;
  }
  S.cards = more ? [...S.cards, ...res.data.cards] : res.data.cards;
  S.counts = res.data.counts;
  S.tags = res.data.tags;
  S.total = res.data.total;
  paintRail();
  $("list-title").textContent = S.tag ? `Tagged “${S.tag}”` : KINDS.find(([k]) => k === S.kind)?.[1] || "Everyone";
  $("list-sub").textContent = `${plural(S.total, "person", "people")}${S.q ? ` with “${S.q}”` : ""}`;
  paintRows();
}

// ------------------------------------------------------------------ the card

/** A line in the "how to reach them" list; `copy` adds a copy button. */
function way(label, value, { copy = false, num = false } = {}) {
  if (value == null || value === "") return "";
  return `<li><span class="way-label">${esc(label)}</span><span class="way-value${num ? " num" : ""}">${esc(value)}</span>
    ${copy ? `<button class="btn ghost small copy" type="button" data-copy="${esc(value)}" aria-label="Copy ${esc(label.toLowerCase())}">${ico("copy", 15)}<span class="when-idle">Copy</span><span class="when-copied">Copied</span></button>` : ""}</li>`;
}

/** The facts from the record behind a card, in plain words. */
function factLines(c) {
  const f = c.facts || {};
  if (c.kind === "customer") {
    return way("Customer since", dateText(f.customer_since)) + way("Orders", f.orders, { num: true }) + way("Last order", dateText(f.last_order))
      + way("Open cases", f.open_cases ? f.open_cases : "None") + way("Likes to hear by", f.likes_to_hear_by && words(f.likes_to_hear_by))
      + way("Marketing mail", f.marketing_opt_in ? "Happy to get it" : "Does not want it");
  }
  if (c.kind === "supplier") {
    return way("Makes for us", (f.makes || []).map((m) => words(String(m).replace(/-/g, " "))).join(", ")) + way("Delivery takes", f.delivery_days != null ? plural(f.delivery_days, "day") : "")
      + way("Orders open", f.open_purchase_orders, { num: true }) + way("Next delivery", f.next_delivery ? dateText(f.next_delivery) : "None due");
  }
  if (c.kind === "staff") {
    return way("Starts at", f.starts_at) + way("Hours a week", f.contracted_hours_a_week, { num: true }) + way("Open tasks", f.open_tasks, { num: true })
      + (f.hourly_pay != null ? way("Pay an hour", money2(f.hourly_pay), { num: true }) : "") + way("From the book", f.from_the_book);
  }
  if (c.kind === "partner") return f.what_they_do ? `<li><span class="way-value">${esc(f.what_they_do)}</span></li>` : "";
  return way("What they do", f.sector && words(f.sector)) + way("Where it is", f.status && words(f.status)) + way("Last in touch", f.last_contacted ? dateText(f.last_contacted) : "Never")
    + way("Prefers", f.prefers && words(f.prefers)) + way("Budget a month", f.monthly_budget != null ? money2(f.monthly_budget) : "", { num: true });
}

/** One quiet line for the fields this job may not see. */
function hiddenLine(hidden = []) {
  const shown = hidden.map((h) => (h === "hourly_pay" ? "pay" : words(h).toLowerCase()));
  return shown.length ? `<p class="card-quiet">Your job does not show their ${shown.join(" or ")}.</p>` : "";
}

function tagChips(tags) {
  return tags.length
    ? tags.map((t) => `<span class="tag">${esc(t)}<button type="button" data-untag="${esc(t)}" aria-label="Remove the tag ${esc(t)}">${ico("close", 13)}</button></span>`).join("")
    : `<span class="card-quiet">No tags.</span>`;
}

async function openCard(id, { quiet = false } = {}) {
  S.open = id;
  $("rows").querySelectorAll("[data-card]").forEach((b) => b.classList.toggle("is-on", b.dataset.card === id));
  main.dataset.view = "read";
  const pane = $("read");
  if (!quiet) pane.innerHTML = `<div class="read-scroll"><div class="card-page">${skeleton(10)}</div></div>`;
  const res = await read("get_contact_card", { card_id: id });
  if (S.open !== id) return;
  if (!res.ok) {
    pane.innerHTML = `<div class="read-scroll">${emptyState({ title: res.error.code === "not_found" ? "That card is not in your address book." : "It did not open.", text: res.error.code === "not_found" ? "Your job may not see it, or it has gone." : res.error.message })}</div>`;
    return;
  }
  const c = res.data;
  history.replaceState(null, "", `?card=${encodeURIComponent(id)}`);
  const sub = [c.title, c.organisation && c.organisation !== c.name ? c.organisation : null].filter(Boolean).join(" · ");
  const reach = way("Email", c.email, { copy: true }) + c.other_emails.map((o) => way(o.label, o.email, { copy: true })).join("")
    + way("Phone", c.phone, { copy: true }) + way("Address", c.address) + (c.address ? "" : way("Town", c.town));
  pane.innerHTML = `<div class="read-bar"><button class="btn ghost small" id="read-back">${ico("back", 16)}<span>Back</span></button></div>
    <div class="read-scroll"><article class="card-page">
      <header class="ct-head">${avatar(c.name, { size: 64 })}
        <div class="card-who"><p class="card-kicker">${esc(ONE[c.kind])}</p><h2 class="card-name">${esc(c.name)}</h2>${sub ? `<p class="card-sub">${esc(sub)}</p>` : ""}</div>
      </header>
      <div class="card-acts"><button class="btn primary small" id="open-record">${esc(OPEN_WORDS[c.record.kind] || `Open their ${recordLabel(c.record.kind).toLowerCase()}`)}</button></div>
      <section class="card-sec"><h3 class="card-h">How to reach them</h3>
        <ul class="ways">${reach || `<li><span class="way-value card-quiet">No contact details on file.</span></li>`}</ul>${hiddenLine(c.hidden)}</section>
      <section class="card-sec"><h3 class="card-h">From their record</h3><ul class="ways">${factLines(c)}</ul>
        <p class="card-chips">${recordChip(c.record.kind, c.record.id)}</p></section>
      <section class="card-sec"><h3 class="card-h">Tags</h3><div class="tags" id="tag-list">${tagChips(c.tags)}</div>
        <form class="tag-add" id="tag-form"><input class="input" id="tag-in" maxlength="24" placeholder="Add a tag" aria-label="Add a tag" autocomplete="off"><button class="btn small" type="submit">Add</button></form>
        <p class="ct-said" id="tag-said"></p></section>
      <section class="card-sec"><h3 class="card-h">Notes</h3>
        <textarea class="textarea notes" id="notes" maxlength="2000" placeholder="Anything worth remembering about them" aria-label="Notes">${esc(c.notes)}</textarea>
        <p class="save-row"><button class="btn small" id="save-notes" type="button">Save notes</button><span class="ct-said" id="notes-said"></span></p></section>
    </article></div>`;
  wireRecordChips(pane, world);
  wireCard(c);
}

function wireCard(c) {
  $("read-back").addEventListener("click", () => { main.dataset.view = "list"; });
  $("open-record").addEventListener("click", () => openRecord(world, c.record.kind, c.record.id));
  $("read").querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copyText(b.dataset.copy, b)));
  let tags = [...c.tags];
  const paintTags = () => {
    $("tag-list").innerHTML = tagChips(tags);
    $("tag-list").querySelectorAll("[data-untag]").forEach((b) => b.addEventListener("click", () => changeTags({ remove_tags: [b.dataset.untag] }, tags.filter((t) => t !== b.dataset.untag))));
  };
  /** Changes the screen first, then saves; puts it back and says why if the save is refused. */
  const changeTags = async (input, next) => {
    const before = tags;
    tags = next;
    paintTags();
    $("tag-said").textContent = "";
    S.ownAt = Date.now();
    const r = await world.call("update_contact_card", { card_id: c.id, ...input });
    if (!r.ok) { tags = before; paintTags(); $("tag-said").textContent = r.error.message; $("tag-said").dataset.tone = "bad"; return; }
    tags = r.data.tags;
    paintTags();
    refreshList();
  };
  paintTags();
  $("tag-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = $("tag-in").value.trim().toLowerCase().replace(/\s+/g, " ");
    if (!t) return;
    $("tag-in").value = "";
    if (!tags.includes(t)) changeTags({ add_tags: [t] }, [...tags, t]);
  });
  $("save-notes").addEventListener("click", async () => {
    const said = $("notes-said");
    said.textContent = "Saving…";
    delete said.dataset.tone;
    S.ownAt = Date.now();
    const r = await world.call("update_contact_card", { card_id: c.id, notes: $("notes").value });
    if (!r.ok) { said.textContent = r.error.message; said.dataset.tone = "bad"; return; }
    said.textContent = "Saved";
    toast(r.data.notes ? "Notes saved. Anyone who opens this card reads them." : "Notes cleared.");
    refreshList();
  });
}

/** Reloads the list without losing the place, after a change that may move a row (a new tag, new notes). */
async function refreshList() {
  const scroll = $("rows").scrollTop;
  await load();
  $("rows").scrollTop = scroll;
}

// ------------------------------------------------------------------ keys and live changes

function moveBy(step) {
  const rows = [...$("rows").querySelectorAll("[data-card]")];
  if (!rows.length) return;
  const at = rows.findIndex((b) => b.dataset.card === S.open);
  const next = rows[Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + step))];
  next.scrollIntoView({ block: "nearest" });
  openCard(next.dataset.card);
}

document.addEventListener("keydown", (e) => {
  const typing = e.target.closest?.("input, textarea, select");
  if (e.key === "Escape") {
    if (typing) { e.target.blur(); return; }
    if (main.classList.contains("is-rail-open")) { toggleRail(false); return; }
    if (main.dataset.view === "read") main.dataset.view = "list";
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "/") { e.preventDefault(); $("q").focus(); }
  else if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); moveBy(1); }
  else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); moveBy(-1); }
});

document.addEventListener("ot:role", async () => {
  S.open = null;
  S.kind = "";
  S.tag = "";
  shell();
  await load();
  toast("The address book now shows what that person may see.");
});
world.onChange((change) => {
  if (change.reset) { location.reload(); return; }
  // WHY leave out our own saves: this screen already shows them, and a redraw would wipe the "Saved" beside the button.
  const ours = (x) => x.tool === "update_contact_card" && Date.now() - S.ownAt < OWN_MS;
  if (!change.entries.some((x) => !isScreenRead(x) && !ours(x))) return;
  refreshList();
  // WHY not while someone is typing: a redraw would throw away the words they have not saved yet.
  if (S.open && !document.activeElement?.closest?.("#read input, #read textarea")) openCard(S.open, { quiet: true });
});

shell();
await load();
const asked = new URLSearchParams(location.search).get("card");
if (asked) openCard(asked);
