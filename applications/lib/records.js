// One way a business record opens, from any app: an order, customer, case, purchase order, supplier or campaign
// clicked anywhere shows the same slide-over, read through the same tool as the person at the computer.
// WHY one place: the owner should never meet the same order drawn three ways in three apps.
//
//   import { openRecord, recordChip, wireRecordChips } from "./records.js";
//   openRecord(world, "order", "ORD-10671");                    // from a click
//   el.innerHTML = recordChip("case", "CASE-9154");             // a chip that opens it
//   wireRecordChips(el, world);                                  // fills chips with a title and facts, and opens them
import { appHref, avatar, emptyState, esc, loadApps, money2, plural, skeleton, slideOver, timeParts, toast, words } from "./ui.js";
import { personFor } from "./people.js";
import { plainRef, plainText, rememberName } from "./plain.js";

/**
 * Every kind of record: the tool that reads it and its input, its label, and the app that owns it.
 * `aliases` are the names the engine uses for the same thing in `related` links (customer_id, supplier_id...).
 */
const KINDS = {
  order: { label: "Order", tool: "get_order", input: (id) => ({ order_number: id }), owner: ["front-desk", (d) => `customer=${encodeURIComponent(d.customer_id)}`, "See the customer in the help desk"] },
  customer: { label: "Customer", tool: "get_customer", input: (id) => ({ customer_id: id }), aliases: ["customer_id"], owner: ["front-desk", (d, id) => `customer=${encodeURIComponent(id)}`, "Open their customer page"] },
  case: { label: "Case", tool: "get_case", input: (id) => ({ case_number: id }), aliases: ["case_number"], owner: ["front-desk", (d, id) => `case=${encodeURIComponent(id)}`, "Open in the help desk"] },
  po: { label: "Purchase order", tool: "get_purchase_order", input: (id) => ({ number: id }), aliases: ["purchase_order"], owner: ["stockroom", (d, id) => `po=${encodeURIComponent(id)}`, "Open in the stockroom"] },
  supplier: { label: "Supplier", tool: "get_supplier", input: (id) => ({ id }), aliases: ["supplier_id"], owner: ["stockroom", (d, id) => `supplier=${encodeURIComponent(id)}`, "Open in the stockroom"] },
  campaign: { label: "Campaign", tool: "list_campaigns", input: () => ({}), aliases: ["campaign_id"], owner: ["megaphone", (d, id) => `campaign=${encodeURIComponent(id)}`, "Open in marketing"] },
  contact: { label: "Help desk", tool: null, aliases: ["contact_id"] },
  review: { label: "Review", tool: "get_review", input: (id) => ({ review_id: id }), aliases: ["review_id"], owner: ["front-desk", (d, id) => `review=${encodeURIComponent(id)}`, "Answer it in the help desk"] },
  task: { label: "Task", tool: "get_task", input: (id) => ({ task_id: id }), aliases: ["task_id"], owner: ["kettle", (d, id) => `task=${encodeURIComponent(id)}`, "Open in Team"] },
  organisation: { label: "Organisation", tool: "get_organisation", input: (id) => ({ id }), aliases: ["organisation_id", "competitor"], owner: ["daily-overthinker", () => "", "Read the news"] },
  news: { label: "News", tool: "get_news_item", input: (id) => ({ id }), aliases: ["news_id"], owner: ["daily-overthinker", (d, id) => `story=${encodeURIComponent(id)}`, "Open in the paper"] },
  // WHY the address book's card for staff: there is no business tool that reads one person, and the card is
  // already cut to what the role may see (pay only for finance and the manager).
  staff: { label: "Team", tool: "get_contact_card", input: (id) => ({ card_id: id }), aliases: ["staff_id", "assignee"], owner: ["kettle", () => "team=people", "Open in Team"] },
  prospect: { label: "Prospect", tool: "get_prospect", input: (id) => ({ prospect_id: id }), aliases: ["prospect_id"], owner: ["contacts", (d, id) => `card=${encodeURIComponent(id)}`, "Open in Contacts"] },
  booking: { label: "Booking", tool: "get_booking", input: (id) => ({ booking_number: id }), aliases: ["booking_number"], owner: ["calendar", (d, id) => `event=${encodeURIComponent(`booking:${id}`)}`, "See it in the calendar"] },
  event: { label: "Calendar", tool: "get_event", input: (id) => ({ event_id: id }), aliases: ["event_id"], owner: ["calendar", (d, id) => `event=${encodeURIComponent(id)}`, "Open in the calendar"] },
  world_event: { label: "World event", tool: "get_world_event", input: (id) => ({ id }), owner: ["daily-overthinker", () => "", "Read the news"] },
};

/** The kind for any name a link may use ("customer_id" is "customer"), or null for one that cannot be opened. */
export function kindOf(name) {
  if (KINDS[name]) return name;
  return Object.keys(KINDS).find((k) => KINDS[k].aliases?.includes(name)) || null;
}

/** "Order", "Purchase order"... for a kind or any of its aliases. */
export function recordLabel(name) {
  return KINDS[kindOf(name)]?.label || words(name);
}

const cache = new Map();

/**
 * Reads one record as the current role. Cached per role for the life of the page, unless `fresh`.
 * Resolves like world.call(): `{ ok, data }` or `{ ok: false, error }`.
 * @param {object} world the client
 * @param {string} kind
 * @param {string} id
 * @param {{fresh?: boolean}=} options
 */
export function fetchRecord(world, kind, id, { fresh = false } = {}) {
  const k = kindOf(kind);
  const spec = KINDS[k];
  if (!spec?.tool) return Promise.resolve({ ok: false, error: { code: "not_found", message: "This record cannot be opened here." } });
  const key = `${world.role}|${k}|${id}`;
  if (fresh || !cache.has(key)) {
    cache.set(key, world.call(spec.tool, spec.input(id), { screen: true }).then((res) => {
      if (res.ok && (k === "customer" || k === "supplier")) rememberName(id, res.data.name);
      if (!res.ok || k !== "campaign") return res;
      // There is no get_campaign: find it in the list.
      const list = Array.isArray(res.data) ? res.data : res.data.campaigns || [];
      const c = list.find((x) => x.id === id);
      return c ? { ok: true, data: c } : { ok: false, error: { code: "not_found", message: "That campaign has gone." } };
    }).catch((e) => ({ ok: false, error: { code: e.code || "offline", message: e.message } })));
  }
  return cache.get(key);
}

/** Forgets every record read so far (a day passed, or the person at the computer changed). */
export function forgetRecords() {
  cache.clear();
}
document.addEventListener("ot:day", forgetRecords);

/** "Monday 23 November 2026, 10:00" */
function fullWhen(iso) {
  if (!iso) return "";
  const p = timeParts(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return iso.length === 10 ? `${p.weekday} ${p.day} ${p.month}` : `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.time}`;
}

/** When a calendar entry is, in words: "Tuesday 24 November, 10:00 to 10:30" or "24 to 30 November". */
function eventWhen(d) {
  if (!d?.start) return "";
  if (d.all_day) return d.end && d.end !== d.start ? `${shortDay(d.start)} to ${shortDay(d.end)}` : fullWhen(d.start);
  return `${fullWhen(d.start)} to ${timeParts(d.end).time}`;
}

function shortDay(iso) {
  const p = timeParts(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return `${p.day} ${p.monthShort}`;
}

/**
 * A record in a few words, for a chip or a heading: a title, two or three facts and a tone (bad, warn or "").
 * @param {string} kind
 * @param {string} id
 * @param {object} d the record
 * @return {{title: string, facts: Array<string>, tone: string}}
 */
export function summariseRecord(kind, id, d) {
  const k = kindOf(kind);
  if (k === "order") {
    const first = d.items?.[0]?.name || "Order";
    const more = (d.items?.length || 0) - 1;
    const late = (d.shipments || []).some((s) => /delay|late|lost/.test(s.status));
    return { title: more > 0 ? `${first} and ${more} more` : first, facts: [words(d.status), money2(d.totals?.total)], tone: d.status === "cancelled" ? "bad" : late ? "warn" : "" };
  }
  if (k === "customer") {
    const home = d.addresses?.find((a) => a.default) || d.addresses?.[0];
    return { title: d.name, facts: [home?.town, d.credit_balance ? `${money2(d.credit_balance)} credit` : null, d.created_at ? `since ${timeParts(d.created_at).year}` : null].filter(Boolean), tone: "" };
  }
  if (k === "case") {
    const open = !["resolved", "closed"].includes(d.status);
    return { title: d.subject, facts: [plainRef(id), words(d.status), d.is_complaint ? "complaint" : null].filter(Boolean), tone: d.is_complaint && open ? "bad" : "" };
  }
  if (k === "po") {
    const value = (d.lines || []).reduce((s, l) => s + l.qty * l.unit_cost, 0);
    return { title: plainRef(id), facts: [words(d.status), money2(value), d.due_at ? `due ${shortDay(d.due_at)}` : null].filter(Boolean), tone: "" };
  }
  if (k === "supplier") {
    return { title: d.name, facts: [d.town, d.lead_time_days != null ? `${plural(d.lead_time_days, "day")} to deliver` : null].filter(Boolean), tone: "" };
  }
  if (k === "review") {
    return { title: `${d.rating} of 5: ${d.product_name}`, facts: [d.reviewer, d.reply ? "answered" : "no reply yet"].filter(Boolean), tone: d.rating <= 2 && !d.reply ? "bad" : "" };
  }
  if (k === "task") {
    return { title: d.title, facts: [d.assignee_name, words(d.status), d.due ? `due ${shortDay(d.due)}` : null].filter(Boolean), tone: d.overdue ? "warn" : "" };
  }
  if (k === "organisation") {
    return { title: d.name, facts: [words(d.kind || ""), d.town].filter(Boolean), tone: "" };
  }
  if (k === "news") {
    return { title: d.headline, facts: [d.section, d.at ? shortDay(d.at) : null].filter(Boolean), tone: "" };
  }
  if (k === "campaign") {
    return { title: d.name || d.title || id, facts: [words(d.status || d.channel || "")].filter(Boolean), tone: "" };
  }
  if (k === "staff") {
    return { title: d.name, facts: [d.title, d.email].filter(Boolean), tone: "" };
  }
  if (k === "prospect") {
    return { title: d.name, facts: [d.sector && words(d.sector), d.status && words(d.status)].filter(Boolean), tone: "" };
  }
  if (k === "event") {
    return { title: d.title, facts: [eventWhen(d), d.status === "tentative" ? "not answered yet" : d.status === "cancelled" ? "cancelled" : null].filter(Boolean), tone: d.status === "cancelled" ? "bad" : d.status === "tentative" ? "warn" : "" };
  }
  if (k === "world_event") {
    return { title: d.title, facts: [d.start ? shortDay(d.start) : null, words(d.status || "")].filter(Boolean), tone: "" };
  }
  return { title: plainRef(id) || recordLabel(kind), facts: [], tone: "" };
}

function row(label, value) {
  return value == null || value === "" ? "" : `<li><span class="grow muted">${esc(label)}</span><b>${esc(value)}</b></li>`;
}

/** The record in full, as the slide-over shows it. */
function recordBody(k, id, d) {
  if (k === "order") {
    return `<ul class="list rec-list">
        ${row("Order number", plainRef(id).replace(/^Order /, ""))}${row("Placed", fullWhen(d.placed_at))}${row("Where it is", words(d.status))}
        ${row("Paid", [money2(d.totals?.total), d.payment?.method && words(d.payment.method).toLowerCase()].filter(Boolean).join(", "))}${d.payment?.refunded ? row("Given back", money2(d.payment.refunded)) : ""}
      </ul>
      <h3 class="h3 rec-h">In the parcel</h3>
      <ul class="list rec-list">${(d.items || []).map((it) => `<li><span class="grow">${esc(it.qty)} × ${esc(it.name)}</span><b>${esc(money2(it.unit_price * it.qty))}</b></li>`).join("")}</ul>
      ${(d.shipments || []).length ? `<h3 class="h3 rec-h">Deliveries</h3>
      <ul class="list rec-list">${d.shipments.map((s) => `<li><span class="grow">${esc(s.carrier || "Not sent yet")}${s.tracking ? ` <span class="mono muted small">${esc(s.tracking)}</span>` : ""}</span><b>${esc(words(s.status))}</b></li>`).join("")}</ul>` : ""}
      ${(d.history || []).length ? `<h3 class="h3 rec-h">What happened</h3>
      <ol class="rec-steps">${d.history.map((h) => `<li><time>${esc(fullWhen(h.at))}</time><span>${esc(plainText(h.event))}</span></li>`).join("")}</ol>` : ""}`;
  }
  if (k === "customer") {
    const home = d.addresses?.find((a) => a.default) || d.addresses?.[0];
    return `<div class="rec-person">${avatar(d.name, { size: 64 })}<div><p class="h3">${esc(d.name)}</p><p class="muted small">${esc(d.email || "")}</p></div></div>
      <ul class="list rec-list">${row("Phone", d.phone)}${row("Lives at", home ? `${home.line1}, ${home.town} ${home.postcode}` : "")}
      ${row("Likes to hear by", d.contact_preference && words(d.contact_preference))}${row("Credit to spend", money2(d.credit_balance || 0))}${row("Customer since", d.created_at ? `${timeParts(d.created_at).month} ${timeParts(d.created_at).year}` : "")}</ul>`;
  }
  if (k === "case") {
    return `<ul class="list rec-list">${row("Case number", plainRef(id).replace(/^Case /, ""))}${row("Where it is", words(d.status))}${row("About", words(d.category))}
      ${row("Opened", fullWhen(d.opened_at))}${d.is_complaint ? row("Complaint", `stage ${d.complaint_stage}`) : ""}${row("With", d.escalated_to ? personFor(d.escalated_to).name : "")}</ul>
      ${(d.notes || []).length ? `<h3 class="h3 rec-h">Notes</h3>
      <ol class="rec-steps">${d.notes.map((n) => `<li><time>${esc(fullWhen(n.at))} · ${esc(personFor(n.by).name)}</time><span>${esc(plainText(n.text))}</span></li>`).join("")}</ol>` : ""}`;
  }
  if (k === "po") {
    return `<ul class="list rec-list">${row("Where it is", words(d.status))}${row("Ordered", fullWhen(d.ordered_at))}${row("Due", d.due_at ? shortDay(d.due_at) : "")}
      ${row("Arrived", d.received_at ? fullWhen(d.received_at) : "")}${row("Paid", d.paid_at ? fullWhen(d.paid_at) : "")}</ul>
      <h3 class="h3 rec-h">On order</h3>
      <ul class="list rec-list">${(d.lines || []).map((l) => `<li><span class="grow">${esc(l.qty)} × ${esc(l.name || l.sku)}</span><span class="muted small">${esc(l.qty_received ?? 0)} arrived</span><b>${esc(money2(l.qty * l.unit_cost))}</b></li>`).join("")}</ul>`;
  }
  if (k === "supplier") {
    return `<ul class="list rec-list">${row("Where", [d.town, d.country].filter(Boolean).join(", "))}${row("Delivery takes", d.lead_time_days != null ? plural(d.lead_time_days, "day") : "")}
      ${row("Smallest order", d.min_order_qty)}${row("Things they make for us", (d.skus || []).length || "")}${row("Email", d.email)}</ul>`;
  }
  if (k === "review") {
    return `<p class="rec-quote">“${esc(d.text)}”</p><ul class="list rec-list">${row("Rating", `${d.rating} of 5`)}${row("About", d.product_name)}${row("By", d.reviewer)}${row("Written", fullWhen(d.date))}</ul>
      ${d.reply ? `<h3 class="h3 rec-h">Our public reply</h3><p>${esc(d.reply.text)}</p><p class="muted small">${esc(d.reply.by_name || "")}, ${esc(fullWhen(d.reply.at))}</p>` : ""}
      ${d.order_number ? `<p>${recordChip("order", d.order_number)} ${d.customer_id ? recordChip("customer", d.customer_id) : ""}</p>` : ""}`;
  }
  if (k === "task") {
    return `<ul class="list rec-list">${row("For", d.assignee_name)}${row("Where it is", words(d.status))}${row("Due", d.due ? shortDay(d.due) : "")}${row("Time", `${Math.round(d.minutes_done || 0)} of ${d.minutes} minutes done`)}${row("Urgent", d.priority === "urgent" ? "yes" : "")}</ul>
      ${d.detail ? `<p>${esc(d.detail)}</p>` : ""}
      <p>${Object.entries(d.links || {}).map(([kind, id]) => recordChip(kind, id)).join(" ")}</p>
      ${(d.history || []).length ? `<h3 class="h3 rec-h">What happened</h3><ol class="rec-steps">${d.history.map((h) => `<li><time>${esc(fullWhen(h.at))} · ${esc(plainRef(h.by))}</time><span>${esc(h.event)}</span></li>`).join("")}</ol>` : ""}`;
  }
  if (k === "organisation") {
    return `<ul class="list rec-list">${row("What it is", words(d.kind || ""))}${row("Where", d.town)}${row("Sells", (d.sells || d.categories || []).join?.(", "))}</ul>${d.about || d.description ? `<p>${esc(d.about || d.description)}</p>` : ""}
      ${(d.recent_moves || []).length ? `<h3 class="h3 rec-h">What they did</h3><ol class="rec-steps">${d.recent_moves.slice(-6).map((m) => `<li><time>${esc(fullWhen(m.date || m.from))}</time><span>${esc(m.headline || words(m.kind))}</span></li>`).join("")}</ol>` : ""}`;
  }
  if (k === "news") {
    return `<p class="muted small">${esc(d.section || "")} · ${esc(fullWhen(d.at))}</p><p>${esc(d.story || "")}</p>`;
  }
  if (k === "staff") {
    const f = d.facts || {};
    return `<div class="rec-person">${avatar(d.name, { size: 64 })}<div><p class="h3">${esc(d.name)}</p><p class="muted small">${esc(d.title || "")}</p></div></div>
      <ul class="list rec-list">${row("Email", d.email)}${row("Starts at", f.starts_at)}${row("Hours a week", f.contracted_hours_a_week)}${row("Open tasks", f.open_tasks)}${f.hourly_pay != null ? row("Pay an hour", money2(f.hourly_pay)) : ""}${row("From the book", f.from_the_book)}</ul>`;
  }
  if (k === "prospect") {
    const dm = d.decision_maker || {};
    return `<ul class="list rec-list">${row("Who decides", dm.name)}${row("Email", dm.email)}${row("Where", d.location?.town)}${row("What they do", d.sector && words(d.sector))}${row("Where it is", d.status && words(d.status))}${row("Last in touch", d.last_contacted ? fullWhen(d.last_contacted) : "never")}</ul>`;
  }
  if (k === "event") {
    return `<ul class="list rec-list">${row("When", eventWhen(d))}${row("Where", d.where)}${row("Who", (d.people || []).map((p) => p.name).join(", "))}${d.from_outside ? row("Asked for by", [d.from_outside.name, d.from_outside.organisation].filter(Boolean).join(", ")) : ""}${row("Made by", d.organiser?.name)}</ul>
      ${d.notes ? `<p>${esc(d.notes)}</p>` : ""}${d.record ? `<p>${recordChip(d.record.kind, d.record.id)}</p>` : ""}`;
  }
  if (k === "world_event") {
    return `<p class="muted small">${esc(fullWhen(d.start))}${d.end && d.end !== d.start ? ` to ${esc(fullWhen(d.end))}` : ""}</p><p>${esc(d.story || d.headline || "")}</p>`;
  }
  return `<ul class="list rec-list">${Object.entries(d).filter(([, v]) => v != null && v !== "" && typeof v !== "object").slice(0, 12)
    .map(([key, v]) => row(words(key), /_at$/.test(key) ? fullWhen(String(v)) : typeof v === "number" && /total|amount|budget|spend|cost/.test(key) ? money2(v) : String(v))).join("")}</ul>`;
}

/** A link across to the app that owns the record, when that app is ready. */
async function ownerLink(k, id, d) {
  const owner = KINDS[k].owner;
  if (!owner) return "";
  const apps = await loadApps().catch(() => []);
  const app = apps.find((a) => a.id === owner[0]);
  if (app?.status !== "ready" || location.pathname.includes(`/${owner[0]}/`)) return "";
  return `<p class="rec-foot"><a class="btn small" href="${appHref(app)}?${owner[1](d, id)}">${esc(owner[2])}</a></p>`;
}

/**
 * Opens a record in the shared slide-over. A role that may not see it gets the calm "not for this desk" state.
 * @param {object} world the client
 * @param {string} kind order, customer, case, po, supplier, campaign (or an alias such as customer_id)
 * @param {string} id
 * @param {{actions?: string, onOpen?: function({el: HTMLElement, close: function(), data: object}): void}=} options
 *   actions: trusted HTML put under the record (an app's own buttons); onOpen: wire them once drawn.
 * @return {Promise<{el: HTMLElement, close: function(): void}|null>}
 */
export async function openRecord(world, kind, id, { actions = "", onOpen } = {}) {
  const k = kindOf(kind);
  if (!k) return null;
  if (k === "contact") {
    const apps = await loadApps().catch(() => []);
    const desk = apps.find((a) => a.id === "front-desk");
    if (desk?.status === "ready") location.href = `${appHref(desk)}?contact=${encodeURIComponent(id)}`;
    return null;
  }
  const sheet = slideOver({ title: plainRef(id) || KINDS[k].label, wide: k === "order", body: `<div class="rec">${skeleton(6)}</div>` });
  const res = await fetchRecord(world, k, id);
  const body = sheet.el.querySelector(".over-body");
  if (!sheet.el.isConnected) return sheet;
  if (!res.ok) {
    body.innerHTML = res.error?.code === "not_found"
      ? emptyState({ title: "It is not there any more.", text: `The business has no ${KINDS[k].label.toLowerCase()} by that number.` })
      : emptyState({ title: "It did not open.", text: "Try again in a moment." });
    return sheet;
  }
  const s = summariseRecord(k, id, res.data);
  sheet.el.querySelector(".over-head h2").textContent = s.title;
  sheet.el.setAttribute("aria-label", s.title);
  body.innerHTML = `<div class="rec rise">${recordBody(k, id, res.data)}${actions ? `<div class="rec-acts">${actions}</div>` : ""}${await ownerLink(k, id, res.data)}</div>`;
  wireRecordChips(body, world);
  onOpen?.({ ...sheet, data: res.data });
  return sheet;
}

/**
 * A chip for a record: it fills itself with a title and facts (wireRecordChips) and opens the record.
 * @param {string} kind
 * @param {string} id
 * @param {{icon?: string}=} options icon is trusted HTML for the chip's picture
 */
export function recordChip(kind, id, { icon = "" } = {}) {
  const k = kindOf(kind);
  const openable = k && (KINDS[k].tool || k === "contact");
  return `<button type="button" class="rec-chip${KINDS[k]?.tool ? " is-loading" : ""}" data-rec-kind="${esc(k || kind)}" data-rec-id="${esc(id)}" ${openable ? "" : "disabled"}>
    ${icon ? `<span class="rec-chip-ico">${icon}</span>` : ""}<span class="rec-chip-text"><b>${esc(plainRef(id) || recordLabel(kind))}</b><small>${esc(recordLabel(kind))}</small></span></button>`;
}

/**
 * Fills every record chip under `root` (title and facts, or a calm lock for a role that may not see it) and
 * opens the record on click. Safe to call again after a redraw.
 * @param {Element} root
 * @param {object} world the client
 */
export function wireRecordChips(root, world) {
  root.querySelectorAll(".rec-chip:not([data-wired])").forEach(async (chip) => {
    chip.dataset.wired = "1";
    const { recKind: k, recId: id } = chip.dataset;
    chip.addEventListener("click", () => {
      openRecord(world, k, id);
    });
    if (!KINDS[k]?.tool) return;
    const res = await fetchRecord(world, k, id);
    chip.classList.remove("is-loading");
    if (!res.ok) {
      chip.querySelector("small").textContent = recordLabel(k);
      return;
    }
    const s = summariseRecord(k, id, res.data);
    chip.querySelector("b").textContent = s.title;
    chip.querySelector("small").textContent = s.facts.join(" · ");
    if (s.tone) chip.dataset.tone = s.tone;
  });
}
