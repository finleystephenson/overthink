// Front Desk: the help desk. On the left, everyone who got in touch (waiting, in progress, done); in the
// middle, the conversation with them; on the right, who they are and what they have bought, sent back or
// had mended. Every read and every action is a real engine tool or the server's inbox, so an outside AI
// answering customers shows up here as it happens.
//
// Address bar (used by other apps to link here, Letterbox among them):
//   ?case=CASE-9007   ?contact=CT-00018   ?customer=C-1002 (their customer page)   ?review=REV-0031
// Three desks share the panes: the queue (people who got in touch), Customers and Reviews (desks.js).
import { startApp, esc, avatar, emptyState, skeleton, slideOver, toast, money2, plural, words, timeParts, daysBetween, pulse, reducedMotion, appHref } from "../lib/ui.js";
import { isScreenRead } from "../lib/client.js";
import { personFor } from "../lib/people.js";
import { plainText, plainRef, rememberName } from "../lib/plain.js";
import { openRecord } from "../lib/records.js";
import { mountDesk } from "./desks.js";

const APP_ID = "front-desk";
const { world, app, apps } = await startApp({ id: APP_ID });
document.title = `${app.name} · Overthought & Co.`;

const STAGES = [
  { id: "waiting", name: "Waiting" },
  { id: "progress", name: "In progress" },
  { id: "done", name: "Done" },
];
const CHANNELS = { chat: "Chat", email: "Email", phone: "Phone", text: "Text" };
const CLOSED = ["resolved", "closed"];
const COMPLAINT_DAYS = { 1: 3, 2: 10 };  // working days to answer, by stage (business rules)
const HAND_TO = ["support_agent", "support_lead", "technician", "coordinator"];
const CATEGORIES = ["orders", "delivery", "returns", "repairs", "bookings", "product", "complaint", "account", "other"];

const ICONS = {
  chat: '<path d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3v-3H5A1.5 1.5 0 0 1 3.5 16V8A1.5 1.5 0 0 1 5 6.5Z"/>',
  email: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4.5-2 1.5a10 10 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2Z"/>',
  text: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  reply: '<path d="M9.5 6 4 11.5 9.5 17"/><path d="M4 11.5h9.5a6.5 6.5 0 0 1 6.5 6.5v1"/>',
  note: '<path d="M5.5 4.5h13v10l-5 5h-8Z"/><path d="M13.5 19.5v-5h5"/>',
  hand: '<path d="M4 12h11M11 7l5 5-5 5"/><path d="M20 5v14"/>',
  done: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  open: '<path d="M12 5v14M5 12h14"/>',
  refund: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/><path d="M13.8 9.3a2 2 0 0 0-3.4 1.2v4.5M9 12.5h3.5M9 15h5"/>',
  swap: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11M12 9c-2-4-6-4-6-1.5S10 9 12 9Zm0 0c2-4 6-4 6-1.5S14 9 12 9Z"/>',
  box: '<path d="M4 8 12 4l8 4v8.5l-8 4-8-4Z"/><path d="M4 8l8 4 8-4M12 12v8.5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  person: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  wrench: '<path d="M14.5 4.5a4 4 0 0 0-4.8 5.3L4 15.5 8.5 20l5.7-5.7a4 4 0 0 0 5.3-4.8l-2.6 2.6-2.8-.6-.6-2.8Z"/>',
  bag: '<path d="M5 8h14l-1.2 11.5H6.2Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  letter: '<path d="M14 4h6v6M20 4l-8 8"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
};

/** One of this app's drawings as an inline svg. */
function ico(name, size = 18) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

const $ = (id) => document.getElementById(id);
const main = $("main");
const queuePane = $("queue");
const talkPane = $("talk");
const whoPane = $("who");

const S = {
  tools: new Set(),
  items: [],
  stage: "waiting",
  filters: { channel: "", topic: "", who: "" },
  selected: null,
  known: new Set(),
  fresh: new Set(),       // people who arrived while the page was open; kept at the top until opened
  firstPaint: true,
  now: null,
  cases: new Map(),       // case number -> get_case answer (or a refusal)
  customers: new Map(),   // customer id -> get_customer answer (or a refusal)
  orders: new Map(),      // customer id -> their orders, kept across redraws for the action forms
  mode: "reply",
  desk: "queue",          // queue, customers or reviews
  deskView: null,         // the mounted customers or reviews desk
  olderDone: 0,           // finished contacts older than the newest 100 that list_contacts returns
};

// ------------------------------------------------------------------ helpers

function read(tool, input) {
  return world.call(tool, input, { screen: true });
}

/** Engine channel names to the four a person thinks in. */
function channelOf(c) {
  return { web_chat: "chat", web: "chat", email: "email", phone: "phone", text: "text", sms: "text" }[c] || "chat";
}

function when(iso) {
  if (!iso) return "";
  const now = S.now || iso;
  if (iso.slice(0, 10) === now.slice(0, 10)) return iso.slice(11, 16);
  const d = daysBetween(iso, now);
  const p = timeParts(iso);
  if (d > 0 && d < 7) return `${p.weekday.slice(0, 3)} ${p.time}`;
  return p.year === timeParts(now).year ? `${p.day} ${p.monthShort}` : `${p.day} ${p.monthShort} ${p.year}`;
}

function dayName(date) {
  const p = timeParts(`${date}T12:00:00Z`);
  return `${p.weekday.slice(0, 3)} ${p.day} ${p.monthShort}`;
}

/** Monday-to-Friday days after a date, as the business counts complaint deadlines. */
function addWorkingDays(iso, n) {
  const t = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  let left = n;
  while (left > 0) {
    t.setUTCDate(t.getUTCDate() + 1);
    if (t.getUTCDay() !== 0 && t.getUTCDay() !== 6) left -= 1;
  }
  return t.toISOString().slice(0, 10);
}

/** How long someone has been waiting, in plain words. */
function waited(iso) {
  const mins = Math.max(0, Math.round((Date.parse(S.now) - Date.parse(iso)) / 60000));
  if (mins < 2) return "since just now";
  if (mins < 60) return plural(mins, "minute");
  if (mins < 60 * 24) return plural(Math.round(mins / 60), "hour");
  return plural(Math.round(mins / 1440), "day");
}

/**
 * A customer's face: they have no photos, so their initials on the one quiet tint every avatar wears.
 * Someone who has not said who they are gets a plain outline of a person.
 */
function customerFace(name, size = 40) {
  if (!name) return `<span class="avatar" style="--av-size:${size}px" aria-hidden="true">${ico("person", Math.round(size * 0.5))}</span>`;
  return avatar(name, { size });
}

function staffName(role) {
  if (!role) return "";
  if (role === "system") return "The system";
  return personFor(role).name;
}

// ------------------------------------------------------------------ the server's inbox (customers waiting)

/** Customers waiting on the server's inbox (not an engine tool), through the page's client. */
function inboxList() {
  return world.inbox({ status: "all" });
}

function inboxReply(messageId, text) {
  return world.inboxReply(messageId, text);
}

// ------------------------------------------------------------------ loading the queue

async function loadTools() {
  try {
    S.tools = new Set((await world.tools()).map((t) => t.name));
  } catch {
    S.tools = new Set();
  }
}

/**
 * Cases and customers are kept between refreshes: the server allows about 120 reads a minute and a busy desk
 * has a hundred open cases, so rereading them all each time time moves would be refused. A failed read is
 * never kept, so a refusal for being too quick heals on the next try.
 */
async function cached(map, key, tool, input) {
  if (map.has(key)) return map.get(key);
  const res = await read(tool, input);
  if (res.ok || ["forbidden", "invalid_input", "not_found"].includes(res.error?.code)) map.set(key, res);
  return res;
}

function caseFor(number) {
  return cached(S.cases, number, "get_case", { case_number: number });
}

function customerFor(id) {
  if (!id) return Promise.resolve({ ok: false });
  return cached(S.customers, id, "get_customer", { customer_id: id });
}

/** Lets cases that may have moved on be read again: the one open now and those with recent activity. Closed ones never change. */
function expireBusyCases() {
  const recent = new Set(S.items.filter((i) => i.waitingSince || daysBetween(i.at, S.now) < 3).map((i) => i.case_number));
  const open = S.items.find((i) => i.key === S.selected)?.case_number;
  for (const [number, res] of S.cases) {
    if (res.ok && !CLOSED.includes(res.data.status) && (number === open || recent.has(number))) S.cases.delete(number);
  }
}

/**
 * Everything that people got in touch about, as one list. A contact, an inbox message and a case about the
 * same thing are one item: keyed by the case when there is one, else by the conversation, else by the contact.
 */
async function loadQueue() {
  const [contactsRes, inbox] = await Promise.all([
    read("list_contacts", {}),
    inboxList(),
  ]);
  const contacts = contactsRes.ok ? contactsRes.data.contacts : [];
  // WHY: list_contacts hands back only the newest 100 contacts, with the total of all of them. Everything
  // older than those is long finished, so it counts towards Done without being listed. (The old count
  // stopped at whatever the newest 100 held, so Done never grew past it.)
  S.olderDone = contactsRes.ok ? Math.max(0, (contactsRes.data.total || 0) - contacts.length) : 0;
  const items = new Map();
  const get = (key, seed) => {
    if (!items.has(key)) items.set(key, { key, contacts: [], messages: [], case_number: null, customer_id: null, conversation_id: null, name: null, ...seed });
    return items.get(key);
  };
  for (const c of contacts) {
    const it = get(c.case_number ? `case:${c.case_number}` : `ct:${c.id}`, {});
    it.contacts.push(c);
    it.case_number ||= c.case_number;
    it.customer_id ||= c.customer_id;
    it.name ||= c.customer_name || null;
  }
  for (const m of inbox) {
    const it = get(m.case_number ? `case:${m.case_number}` : `conv:${m.conversation_id}`, {});
    it.messages.push(m);
    it.case_number ||= m.case_number;
    it.customer_id ||= m.customer_id || null;
    it.conversation_id ||= m.conversation_id;
    it.name ||= m.customer_name || null;
  }
  const list = [...items.values()];
  await Promise.all(list.filter((i) => i.case_number).map((i) => caseFor(i.case_number)));
  await Promise.all(list.map(async (i) => {
    const k = i.case_number ? await caseFor(i.case_number) : null;
    i.case = k?.ok ? k.data : null;
    i.customer_id ||= i.case?.customer_id || null;
  }));
  // Contacts carry the customer's name, so only the nameless are looked up now; the rest when opened.
  await Promise.all([...new Set(list.filter((i) => !i.name).map((i) => i.customer_id).filter(Boolean))].map(customerFor));
  for (const i of list) describe(i);
  S.items = list;
}

/** Works out an item's stage, channel, topic, owner, time and complaint deadline from its parts. */
function describe(i) {
  const cust = i.customer_id ? S.customers.get(i.customer_id) : null;
  if (cust?.ok) i.customer = cust.data;
  i.name ||= i.customer?.name || null;
  if (i.customer_id && i.name) rememberName(i.customer_id, i.name);
  const waiting = i.messages.filter((m) => m.status === "waiting");
  // A contact nobody has picked up yet is recorded with the outcome "waiting"; once staff or the shop's AI
  // answer it the outcome changes (answered, case_opened, unresolved...).
  const waitingContacts = i.contacts.filter((c) => c.outcome === "waiting");
  const lastContact = [...i.contacts].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  const lastMsg = [...i.messages].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  const times = [...i.contacts.map((c) => c.at), ...i.messages.map((m) => m.reply?.at || m.at), ...(i.case?.notes || []).map((n) => n.at)];
  i.at = times.sort().at(-1) || i.case?.opened_at || S.now;
  i.waitingSince = [...waiting.map((m) => m.at), ...waitingContacts.map((c) => c.at)].sort()[0] || null;
  i.stage = i.waitingSince ? "waiting"
    : i.case ? (CLOSED.includes(i.case.status) ? "done" : "progress")
    : lastContact && ["resolved", "answered", "order_changed"].includes(lastContact.outcome) ? "done"
    : lastMsg && lastMsg.status === "replied" ? "done" : "progress";
  i.channel = channelOf((lastMsg && (!lastContact || lastMsg.at > lastContact.at) ? lastMsg.channel : lastContact?.channel) || "web_chat");
  i.topic = i.case?.category || "other";
  i.owner = i.case?.escalated_to || lastContact?.handled_by || null;
  // WHY: `about` is the engine's own one-line summary ("A late parcel."), better than the topic's code name.
  const about = String(lastContact?.about || "").replace(/\.$/, "");
  i.title = plainText(i.case?.subject || lastContact?.summary || headline(i.messages[0]?.text) || about || "");
  i.title ||= { chat: "Chatted with the shop", email: "Sent an email", phone: "Phoned the shop", text: "Sent a text" }[i.channel];
  i.complaint = !!i.case?.is_complaint;
  if (i.complaint) {
    i.deadline = addWorkingDays(i.case.opened_at, COMPLAINT_DAYS[i.case.complaint_stage] || 3);
    i.late = !CLOSED.includes(i.case.status) && (!!i.case.deadline_missed || i.deadline < S.now.slice(0, 10));
  }
}

/** A customer's own words as a headline: the first sentence, or the first few words of a long one. */
function headline(text) {
  if (!text) return "";
  const first = text.split(/(?<=[.?!])\s/)[0];
  if (first.length <= 72) return first;
  return `${first.slice(0, 68).replace(/\s+\S*$/, "")}…`;
}

// ------------------------------------------------------------------ the queue

function visible() {
  const f = S.filters;
  return S.items
    .filter((i) => i.stage === S.stage)
    .filter((i) => !f.channel || i.channel === f.channel)
    .filter((i) => !f.topic || i.topic === f.topic)
    .filter((i) => !f.who || (f.who === "none" ? !i.owner : i.owner === f.who))
    // Waiting: whoever has waited longest first, as at any counter, but someone who has just walked in is
    // shown at the top until opened so the arrival is seen. The rest: newest first.
    .sort((a, b) => (S.fresh.has(b.key) - S.fresh.has(a.key))
      || (S.stage === "waiting" ? a.waitingSince.localeCompare(b.waitingSince) : b.at.localeCompare(a.at)));
}

const DESKS = [["queue", "Got in touch"], ["customers", "Customers"], ["reviews", "Reviews"]];

/** The switch between the three desks, at the top of the left pane. */
function switcherHtml() {
  return `<div class="dk-desks" role="tablist" aria-label="Desk">${DESKS.map(([id, label]) => `<button class="dk-desk${S.desk === id ? " is-on" : ""}" role="tab" aria-selected="${S.desk === id}" data-desk="${id}">${label}</button>`).join("")}</div>`;
}

function wireSwitcher(root) {
  root.querySelectorAll("[data-desk]").forEach((b) => b.addEventListener("click", () => setDesk(b.dataset.desk)));
}

/** Moves to a desk; `open` is a customer or review id to show at once. */
function setDesk(id, open = null) {
  S.desk = id;
  S.selected = null;
  main.dataset.view = "queue";
  if (id === "queue") {
    delete main.dataset.desk;
    S.deskView = null;
    history.replaceState(null, "", location.pathname);
    if (!S.items.length) { start(); return; }
    paintQueueShell();
    paintFilters();
    paintCounts();
    paintRows();
    paintTalkEmpty();
    paintGlance();
    return;
  }
  S.deskView = mountDesk(id, {
    world, queuePane, talkPane, whoPane, main, tools: S.tools, now: () => S.now,
    switcher: switcherHtml(), wireSwitcher,
    showCustomer: (cid) => setDesk("customers", cid),
    paintCustomerSide: (cid) => { S.selected = `side:${cid}`; paintWho({ key: S.selected, customer_id: cid, contacts: [], messages: [] }); },
  }, { open });
}

function paintQueueShell() {
  queuePane.innerHTML = `
    <header class="q-head">${switcherHtml()}
      <div class="q-stages" role="tablist" aria-label="Where things are">
        ${STAGES.map((s, n) => `<button class="q-stage${s.id === S.stage ? " is-on" : ""}" role="tab" aria-selected="${s.id === S.stage}" data-stage="${s.id}" title="${s.name} (${n + 1})">
          <span>${s.name}</span><span class="q-stage-n" data-n="${s.id}"></span></button>`).join("")}
      </div>
      <div class="q-filters">
        <div class="q-chans" role="group" aria-label="How they got in touch">
          <button class="q-chan${!S.filters.channel ? " is-on" : ""}" data-chan="">All</button>
          ${Object.entries(CHANNELS).map(([id, name]) => `<button class="q-chan${S.filters.channel === id ? " is-on" : ""}" data-chan="${id}" title="${name}" aria-label="${name}">${ico(id, 16)}</button>`).join("")}
        </div>
        <select class="select q-sel" id="f-topic" aria-label="Topic"></select>
        <select class="select q-sel" id="f-who" aria-label="Who has it"></select>
        ${S.tools.has("set_support_cover") ? `<button class="btn small ghost icon-only q-cover" id="cover-btn" title="Who answers" aria-label="Who answers">${ico("person", 17)}</button>` : ""}
      </div>
    </header>
    <ul class="q-rows" id="q-rows" aria-label="Who got in touch"></ul>`;
  queuePane.querySelectorAll("[data-stage]").forEach((b) => b.addEventListener("click", () => pickStage(b.dataset.stage)));
  queuePane.querySelectorAll("[data-chan]").forEach((b) => b.addEventListener("click", () => {
    S.filters.channel = b.dataset.chan;
    queuePane.querySelectorAll("[data-chan]").forEach((x) => x.classList.toggle("is-on", x === b));
    paintRows();
  }));
  queuePane.querySelector("#cover-btn")?.addEventListener("click", openCover);
  wireSwitcher(queuePane);
  queuePane.querySelector("#f-topic").addEventListener("change", (e) => { S.filters.topic = e.target.value; paintRows(); });
  queuePane.querySelector("#f-who").addEventListener("change", (e) => { S.filters.who = e.target.value; paintRows(); });
}

/** Shows one of the three lists: waiting, in progress, done. */
function pickStage(id) {
  if (!STAGES.some((s) => s.id === id)) return;
  S.stage = id;
  S.firstPaint = true;
  queuePane.querySelectorAll("[data-stage]").forEach((x) => {
    x.classList.toggle("is-on", x.dataset.stage === id);
    x.setAttribute("aria-selected", String(x.dataset.stage === id));
  });
  paintRows();
}

function paintFilters() {
  const topics = [...new Set(S.items.map((i) => i.topic))].sort();
  const owners = [...new Set(S.items.map((i) => i.owner || ""))].sort();
  const topicSel = queuePane.querySelector("#f-topic");
  const whoSel = queuePane.querySelector("#f-who");
  topicSel.innerHTML = `<option value="">Every topic</option>${topics.map((t) => `<option value="${esc(t)}" ${S.filters.topic === t ? "selected" : ""}>${esc(words(t))}</option>`).join("")}`;
  whoSel.innerHTML = `<option value="">Anyone</option>${owners.map((o) => `<option value="${esc(o || "none")}" ${S.filters.who === (o || "none") ? "selected" : ""}>${esc(o ? staffName(o) : "Nobody yet")}</option>`).join("")}`;
}

/** The count on each list's tab, said once and nowhere else. Done includes every older, finished contact. */
function paintCounts() {
  for (const s of STAGES) {
    const el = queuePane.querySelector(`[data-n="${s.id}"]`);
    const n = S.items.filter((i) => i.stage === s.id).length + (s.id === "done" ? S.olderDone || 0 : 0);
    el.textContent = n ? n.toLocaleString("en-GB") : "";
  }
}

function paintRows() {
  const rows = queuePane.querySelector("#q-rows");
  if (!rows) return;
  const list = visible();
  const first = S.firstPaint;
  // A refresh can repaint twice in a row (the day moved and the world changed); a row that has already
  // arrived must not arrive again, and stays bold until someone opens it.
  const newKeys = new Set(S.items.filter((i) => !first && !S.known.has(i.key)).map((i) => i.key));
  S.items.forEach((i) => S.known.add(i.key));
  S.firstPaint = false;
  if (!list.length) {
    const said = { waiting: ["Nobody is waiting.", "Everyone who got in touch has had an answer."], progress: ["Nothing in progress.", "No case is open right now."], done: ["Nothing finished yet.", "Finished conversations land here."] }[S.stage];
    rows.innerHTML = `<li class="q-empty">${emptyState({ title: said[0], text: said[1] })}</li>`;
    return;
  }
  rows.innerHTML = list.map((i) => rowHtml(i, newKeys.has(i.key), S.fresh.has(i.key))).join("");
  if (S.stage === "done" && S.olderDone) rows.insertAdjacentHTML("beforeend", `<li class="q-older">${esc(S.olderDone.toLocaleString("en-GB"))} older contacts were finished before these.</li>`);
  rows.querySelectorAll("[data-key]").forEach((b) => b.addEventListener("click", () => openItem(b.dataset.key)));
}

/** How long someone has waited, short enough for the corner of a row: "4 hours", "3 days". */
function waitedShort(iso) {
  const w = waited(iso);
  return w === "since just now" ? "Just now" : w;
}

/**
 * One row, two lines. Line one: who, how they got in touch, and one figure (how long they have waited, or when).
 * Line two: what it is about. Colour only when a complaint has missed its deadline.
 */
function rowHtml(i, isNew, isFresh) {
  const on = i.key === S.selected;
  const waiting = i.stage === "waiting";
  const due = i.complaint && !i.late && i.stage !== "done" ? ` · complaint, answer by ${dayName(i.deadline)}` : "";
  return `<li class="q-li${isNew ? " is-new" : ""}"><button class="q-row${on ? " is-on" : ""}${isFresh ? " is-fresh" : ""}" data-key="${esc(i.key)}" ${on ? 'aria-current="true"' : ""}>
    <span class="q-top"><b class="q-name">${esc(i.name || "Someone new")}</b><span class="q-chan-ico" title="${CHANNELS[i.channel]}">${ico(i.channel, 14)}</span>
      <span class="q-time${waiting ? " is-wait" : ""}" title="${waiting ? `Waiting ${esc(waited(i.waitingSince))}` : ""}">${esc(waiting ? waitedShort(i.waitingSince) : when(i.at))}</span></span>
    <span class="q-line"><span class="q-subj">${esc(i.title)}</span><span class="q-due">${esc(due)}</span>${i.complaint && i.late ? '<span class="pill bad q-late">Past deadline</span>' : ""}</span>
  </button></li>`;
}

/**
 * The keyboard, as in a good help desk. Keys act only when you are not typing.
 *   J or Down: next (it opens)   K or Up: previous   R: reply   N: note for the team   D: done (resolve)
 *   H: hand over   O: open a case   1, 2, 3: waiting, in progress, done   Escape: back
 */
document.addEventListener("keydown", (e) => {
  if (S.desk !== "queue" || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".over")) return;
  if (e.target.closest?.("input, textarea, select, [contenteditable='true']")) {
    if (e.key === "Escape") e.target.blur();
    return;
  }
  const rows = [...queuePane.querySelectorAll(".q-row")];
  const at = rows.findIndex((r) => r.dataset.key === S.selected);
  const step = (d) => {
    const next = rows[at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + d))];
    if (!next || next.dataset.key === S.selected) return;
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest" });
    openItem(next.dataset.key);
  };
  const press = (name) => talkPane.querySelector(`[data-act="${name}"]:not(:disabled)`)?.click();
  const keys = {
    j: () => step(1), ArrowDown: () => step(1), k: () => step(-1), ArrowUp: () => step(-1),
    r: () => focusComposer("reply"), n: () => focusComposer("note"), d: () => press("resolve"), h: () => press("hand"), o: () => press("open"),
    1: () => pickStage("waiting"), 2: () => pickStage("progress"), 3: () => pickStage("done"),
    Escape: () => { main.dataset.view = "queue"; main.classList.remove("is-who-open"); },
  };
  const run = keys[e.key];
  if (!run) return;
  e.preventDefault();
  run();
});

/** Puts the cursor in the writing box, switched to a reply or a note. */
function focusComposer(mode) {
  const tab = talkPane.querySelector(`#composer [data-mode="${mode}"]`);
  if (tab && tab.getAttribute("aria-pressed") !== "true") tab.click();
  talkPane.querySelector("#comp-text")?.focus();
}

// ------------------------------------------------------------------ the conversation

/** Nothing open: one quiet line, and the keys that work here. */
function paintTalkEmpty(text) {
  const waiting = S.items.some((i) => i.stage === "waiting");
  talkPane.innerHTML = `<div class="talk-empty">
    <p class="talk-empty-title">${esc(text || (waiting ? "Choose someone to answer them." : "Nobody is waiting. New messages appear on the left."))}</p>
    <p class="talk-empty-text"><kbd>J</kbd> and <kbd>K</kbd> move, <kbd>R</kbd> replies, <kbd>N</kbd> adds a note, <kbd>D</kbd> marks it done, <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> switch lists.</p>
  </div>`;
}

/** Opens one item: the conversation in the middle, the customer on the right. */
async function openItem(key) {
  const i = S.items.find((x) => x.key === key);
  if (!i) return;
  S.selected = key;
  S.fresh.delete(key);
  main.dataset.view = "talk";
  queuePane.querySelectorAll(".q-row").forEach((r) => {
    const on = r.dataset.key === key;
    r.classList.toggle("is-on", on);
    if (on) { r.setAttribute("aria-current", "true"); r.classList.remove("is-fresh"); } else r.removeAttribute("aria-current");
  });
  syncUrl(i);
  talkPane.innerHTML = `<div class="talk-loading">${skeleton(7)}</div>`;
  // The queue only knows the customer's name; their details (email, orders) are read now, once.
  if (i.customer_id && !i.customer) {
    const c = await customerFor(i.customer_id);
    if (c.ok) { i.customer = c.data; i.name ||= c.data.name; }
  }
  if (S.selected !== key) return;
  paintWho(i);
  const events = await timeline(i);
  if (S.selected !== key) return;
  paintTalk(i, events, { arrive: true });
}

function syncUrl(i) {
  const q = new URLSearchParams();
  if (i?.case_number) q.set("case", i.case_number);
  else if (i?.contacts[0]) q.set("contact", i.contacts[0].id);
  else if (i?.customer_id) q.set("customer", i.customer_id);
  history.replaceState(null, "", `${location.pathname}${q.toString() ? `?${q}` : ""}`);
}

/**
 * Everything said about this item, in order: how they got in touch, the customer's messages and our replies
 * (by email from the hello@ box, or from the waiting inbox), and the team's notes on the case.
 */
async function timeline(i) {
  const ev = [];
  for (const c of i.contacts) {
    ev.push({ at: c.at, kind: "contact", channel: channelOf(c.channel), text: c.summary, by: c.handled_by, outcome: c.outcome });
  }
  i.emails = await emailsFor(i);
  const bodies = new Set();
  const seen = new Set();  // a letter can come back in more than one thread read; show it once
  for (const t of i.emails) {
    for (const m of t.messages) {
      if (m.id && seen.has(m.id)) continue;
      seen.add(m.id);
      const ours = String(m.from?.address || "").endsWith("@overthought.example");
      ev.push({ at: m.at, kind: ours ? "ours" : "theirs", channel: "email", text: m.body, by: ours ? m.from?.name : null, email: m, thread: t.thread_id });
      bodies.add(String(m.body || "").trim());
    }
  }
  for (const m of i.messages) {
    // The inbox repeats the customer's last email; show it once.
    if (!bodies.has(m.text.trim())) ev.push({ at: m.at, kind: "theirs", channel: channelOf(m.channel), text: m.text, waiting: m.status === "waiting" });
    if (m.reply) ev.push({ at: m.reply.at, kind: "ours", channel: channelOf(m.channel), text: m.reply.text, by: staffName(m.reply.role) });
  }
  for (const n of i.case?.notes || []) ev.push({ at: n.at, kind: n.by === "system" ? "system" : "note", text: n.text, by: staffName(n.by) });
  return ev.sort((a, b) => a.at.localeCompare(b.at));
}

/** The customer's email conversations about this item, from the hello@ box, when the role may open it. */
async function emailsFor(i) {
  if (!i.customer?.email || !S.tools.has("list_emails")) return [];
  const res = await read("list_emails", { mailbox: "hello", search: i.customer.email, limit: 60 });
  if (!res.ok) return [];
  const contactIds = new Set(i.contacts.map((c) => c.id));
  const mine = res.data.emails.filter((e) => (e.links?.contact_id && contactIds.has(e.links.contact_id))
    || (i.case_number ? e.links?.case === i.case_number : e.links?.conversation_id && e.links.conversation_id === i.conversation_id));
  const threadIds = [...new Set(mine.map((e) => e.thread_id))];
  const threads = await Promise.all(threadIds.map((t) => read("get_email_thread", { email_id: mine.find((e) => e.thread_id === t).id })));
  return threads.filter((t) => t.ok).map((t) => t.data);
}

function letterboxHref(threadId) {
  const lb = apps.find((a) => a.id === "letterbox") || { id: "letterbox", status: "ready" };
  return `${appHref(lb)}?mailbox=hello&thread=${encodeURIComponent(threadId)}`;
}

// The single key for each action, shown in its tooltip.
const ACT_KEYS = { resolve: "D", hand: "H", open: "O" };

function paintTalk(i, events, { arrive = false } = {}) {
  const can = (t) => S.tools.has(t);
  const k = i.case;
  const open = k && !CLOSED.includes(k.status);
  const threads = i.emails || [];
  const waiting = i.messages.find((m) => m.status === "waiting");
  const actions = [
    !k && can("open_case") && i.customer ? ["open", "open", "Open a case"] : null,
    open && can("resolve_case") ? ["resolve", "done", "Done"] : null,
    open && can("escalate") ? ["hand", "hand", "Hand over"] : null,
    can("issue_refund") && i.customer ? ["refund", "refund", "Refund"] : null,
    can("report_problem") && i.customer ? ["replace", "swap", "Replacement"] : null,
    can("add_goodwill_credit") && i.customer ? ["credit", "gift", "Goodwill credit"] : null,
    can("create_return") && i.customer ? ["return", "box", "Return"] : null,
  ].filter(Boolean);
  // One ink pill per view: finishing the case, or opening one. Everything else is a quiet button.
  const btn = ([act, icon, label], n) => {
    const primary = n === 0 && (act === "resolve" || act === "open");
    const key = ACT_KEYS[act] ? ` (${ACT_KEYS[act]})` : "";
    return `<button class="btn small ${primary ? "accent" : "ghost"}" data-act="${act}" title="${label}${key}" aria-label="${label}">${ico(icon, 16)}<span>${label}</span></button>`;
  };
  const meta = [
    STAGES.find((s) => s.id === i.stage).name,
    k ? words(k.category) : "",
    k ? plainRef(k.number) : "",
    i.owner ? `with ${staffName(i.owner).replace(/^The /, "the ")}` : "",
  ].filter(Boolean);
  const complaint = i.complaint && i.stage !== "done"
    ? (i.late ? '<span class="pill bad">Complaint past its deadline</span>' : `<span class="talk-due">Complaint: answer by ${esc(dayName(i.deadline))}</span>`) : "";
  talkPane.innerHTML = `
    <div class="talk-wrap">
      <header class="talk-bar">
        <button class="btn ghost small icon-only talk-back" id="talk-back" aria-label="Back to the list">${ico("back")}</button>
        <div class="talk-actions">${actions.map(btn).join("")}
          ${threads.length ? `<a class="btn small ghost" href="${letterboxHref(threads[0].thread_id)}" title="Open the emails in Letterbox" aria-label="Open the emails">${ico("letter", 16)}<span>Emails</span></a>` : ""}</div>
        ${i.customer_id ? `<button class="btn small ghost icon-only talk-who-btn" id="talk-who" aria-label="The customer" title="The customer">${ico("person", 17)}</button>` : ""}
      </header>
      <div class="talk-scroll" id="feed-scroll">
        <h2 class="talk-subj">${esc(i.title)}</h2>
        <p class="talk-meta">${meta.map(esc).join(" · ")}</p>
        ${complaint ? `<p class="talk-flag">${complaint}</p>` : ""}
        <ol class="talk-feed" id="feed">${events.map((e) => eventHtml(e, i)).join("") || `<li class="ev-none">Nothing has been said yet.</li>`}</ol>
      </div>
      ${composerHtml(i, waiting, threads)}
    </div>`;
  talkPane.querySelector("#talk-back").addEventListener("click", () => { main.dataset.view = "queue"; });
  talkPane.querySelector("#talk-who")?.addEventListener("click", () => main.classList.add("is-who-open"));
  talkPane.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => openAction(b.dataset.act, i)));
  wireComposer(i, waiting, threads);
  const scroll = talkPane.querySelector("#feed-scroll");
  // The newest message is what matters, so a conversation opens at its end, as a chat does.
  if (arrive || scroll.scrollHeight > scroll.clientHeight) scroll.scrollTop = scroll.scrollHeight;
}

/** One thing said or done, as a mail app shows a letter: who, how, when, then the words. */
function eventHtml(e, i) {
  const at = `<time class="ev-time">${esc(when(e.at))}</time>`;
  if (e.kind === "contact") {
    const said = plainText(e.text || "");
    return `<li class="ev ev-line"><span class="ev-ico">${ico(e.channel, 15)}</span><span>${esc(i.name || "Someone")} got in touch by ${esc(CHANNELS[e.channel].toLowerCase())}${e.by ? `. ${esc(staffName(e.by))} answered` : ""}.${said ? ` ${esc(said)}` : ""}</span>${at}</li>`;
  }
  if (e.kind === "system") return `<li class="ev ev-line"><span class="ev-ico">${ico("clock", 15)}</span><span>${esc(plainText(e.text))}</span>${at}</li>`;
  if (e.kind === "note") {
    return `<li class="ev ev-msg ev-note"><header class="ev-head"><span class="ev-tile">${ico("note", 16)}</span>
      <span class="ev-who"><b>${esc(e.by)}</b><span>Note for the team</span></span>${at}</header>
      <p class="ev-text">${esc(plainText(e.text))}</p></li>`;
  }
  const ours = e.kind === "ours";
  const who = ours ? e.by || "Us" : i.name || "Customer";
  return `<li class="ev ev-msg${ours ? " is-ours" : ""}${e.waiting ? " is-waiting" : ""}">
    <header class="ev-head">${ours ? avatar(who, { size: 32 }) : customerFace(i.name, 32)}
      <span class="ev-who"><b>${esc(who)}</b><span>${esc(CHANNELS[e.channel])}${ours ? "" : e.waiting ? " · waiting for an answer" : ""}</span></span>${at}</header>
    <p class="ev-text">${esc(plainText(e.text))}</p>
  </li>`;
}

/** The writing box: a reply to the customer, or a note only the team sees. */
function composerHtml(i, waiting, threads) {
  const canNote = S.tools.has("add_case_note") && i.case;
  const emailOk = threads.length && S.tools.has("send_email");
  const replyWay = waiting && !(emailOk && channelOf(waiting.channel) === "email") ? CHANNELS[channelOf(waiting.channel)].toLowerCase() : emailOk ? "email" : waiting ? "email" : null;
  if (!replyWay && !canNote) {
    return `<p class="talk-cant">${esc(i.stage === "done" ? "This one is finished." : i.stage === "progress" && !waiting ? "They have had their answer. Nothing is waiting." : i.stage === "waiting" && !waiting ? `This ${CHANNELS[i.channel].toLowerCase()} contact is answered on that channel.` : "There is nothing to answer here.")}</p>`;
  }
  const mode = S.mode === "note" && canNote ? "note" : replyWay ? "reply" : "note";
  return `<form class="composer is-${mode}" id="composer">
    <div class="comp-tabs">
      ${replyWay ? `<button type="button" class="pm-chip" data-mode="reply" aria-pressed="${mode === "reply"}">Reply by ${esc(replyWay)}</button>` : ""}
      ${canNote ? `<button type="button" class="pm-chip" data-mode="note" aria-pressed="${mode === "note"}">Note for the team</button>` : ""}
    </div>
    <textarea class="comp-text" id="comp-text" rows="3" aria-label="Write here" placeholder="${mode === "note" ? "Only the team sees this." : `Write to ${esc(i.name || "them")}`}"></textarea>
    <div class="comp-row"><button class="btn primary small" type="submit">${mode === "note" ? "Add note" : "Send"}</button><span class="comp-keys"><kbd>⌘</kbd> <kbd>Enter</kbd> ${mode === "note" ? "adds it" : "sends"}</span></div>
  </form>`;
}

function wireComposer(i, waiting, threads) {
  const form = talkPane.querySelector("#composer");
  if (!form) return;
  const text = form.querySelector("#comp-text");
  form.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    S.mode = b.dataset.mode;
    const keep = text.value;
    form.outerHTML = composerHtml(i, waiting, threads);
    wireComposer(i, waiting, threads);
    talkPane.querySelector("#comp-text").value = keep;
    talkPane.querySelector("#comp-text").focus();
  }));
  text.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = text.value.trim();
    if (!body) { text.focus(); pulse(text, "is-shaking"); return; }
    const isNote = form.classList.contains("is-note");
    form.querySelector("[type=submit]").disabled = true;
    let res;
    if (isNote) {
      res = await world.call("add_case_note", { case_number: i.case_number, text: body });
    } else {
      // A customer who wrote by email is answered by email, from hello@, so the reply is a real letter in
      // Letterbox. If they are also waiting in the server's inbox, the same reply clears that wait.
      const byEmail = threads.length && S.tools.has("send_email") && (!waiting || channelOf(waiting.channel) === "email");
      if (byEmail) {
        const last = threads.flatMap((t) => t.messages).filter((m) => !String(m.from?.address).endsWith("@overthought.example")).sort((a, b) => a.at.localeCompare(b.at)).at(-1)
          || threads.at(-1).messages.at(-1);
        res = await world.call("send_email", { mailbox: "hello", reply_to_id: last.id, body });
        if (res.ok && waiting) await inboxReply(waiting.id, body);
      } else {
        res = await inboxReply(waiting.id, body);
      }
    }
    if (!res.ok) {
      form.querySelector("[type=submit]").disabled = false;
      return toast(res.error?.message || "That did not go through.", { tone: "bad" });
    }
    toast(isNote ? "Note added." : "Sent.", { tone: "good" });
    await afterAction(i.key, { landed: true });
  });
}

// ------------------------------------------------------------------ the customer

const WHO_CLOSE = `<button class="btn ghost small icon-only who-close" data-who-close aria-label="Close">${ico("back")}</button>`;

whoPane.addEventListener("click", (e) => { if (e.target.closest("[data-who-close]")) main.classList.remove("is-who-open"); });

/** With nobody picked there is no customer to show, and the counts are already on the list's tabs. */
function paintGlance() {
  whoPane.innerHTML = `<p class="who-quiet">Pick someone to see who they are, what they bought and what they sent back.</p>`;
}

async function paintWho(i) {
  if (!i.customer_id) {
    whoPane.innerHTML = `${WHO_CLOSE}<p class="who-quiet">They have not said who they are, so there is nothing to look up.</p>`;
    return;
  }
  if (!i.customer) {
    const r = await customerFor(i.customer_id);
    i.customer = r.ok ? r.data : null;
    if (!i.customer) {
      whoPane.innerHTML = `${WHO_CLOSE}<p class="who-quiet">Their details are not available.</p>`;
      return;
    }
  }
  const c = i.customer;
  const home = c.addresses?.find((a) => a.default) || c.addresses?.[0];
  whoPane.innerHTML = `${WHO_CLOSE}
    <header class="who-head">${customerFace(c.name, 40)}
      <div class="who-id"><button class="who-name" data-customer title="All their details">${esc(c.name)}</button><p class="who-line">${esc(c.email)}</p></div>
    </header>
    <ul class="who-facts">
      ${c.phone ? `<li><span>Phone</span><b>${esc(c.phone)}</b></li>` : ""}
      ${home ? `<li><span>Lives in</span><b>${esc(home.town)} ${esc(home.postcode)}</b></li>` : ""}
      <li><span>Customer since</span><b class="num">${esc(timeParts(c.created_at).year)}</b></li>
      <li><span>Credit to spend</span><b class="num" data-credit>${esc(money2(c.credit_balance || 0))}</b></li>
      <li><span>Likes to hear by</span><b>${esc(words(c.contact_preference || "email"))}</b></li>
    </ul>
    <section class="who-sec" id="who-orders"><h3 class="who-h">Orders</h3>${skeleton(3)}</section>
    <section class="who-sec" id="who-cases"><h3 class="who-h">Earlier contacts</h3>${skeleton(2)}</section>
    <section class="who-sec" id="who-repairs"><h3 class="who-h">Repairs and returns</h3>${skeleton(2)}</section>`;
  const [orders, cases, repairs, returns] = await Promise.all([
    read("list_orders", { customer_id: c.id }),
    read("list_cases", { customer_id: c.id }),
    read("list_repairs", { customer_id: c.id }),
    read("list_returns", { customer_id: c.id }),
  ]);
  if (S.selected !== i.key) return;
  i.orders = orders.ok ? orders.data.orders : [];
  S.orders.set(c.id, i.orders);
  fillSec("who-orders", orders, (d) => d.orders.map((o) => `<li><button class="who-row" data-order="${esc(o.number)}">
      <span class="who-row-main"><b>${esc(o.items?.[0] || plainRef(o.number))}${o.items?.length > 1 ? ` and ${o.items.length - 1} more` : ""}</b><small>${esc(plainRef(o.number))} · ${esc(when(o.placed_at))} · ${esc(words(o.status))}</small></span>
      <b class="who-money">${esc(money2(o.total))}</b></button></li>`), "No orders yet.");
  fillSec("who-cases", cases, (d) => d.cases.filter((k) => k.number !== i.case_number).sort((a, b) => b.opened_at.localeCompare(a.opened_at)).map((k) => `<li><button class="who-row" data-case="${esc(k.number)}">
      <span class="who-row-main"><b>${esc(plainText(k.subject))}</b><small>${esc(plainRef(k.number))} · ${esc(when(k.opened_at))} · ${esc(words(k.status))}</small></span></button></li>`), "This is the first time.");
  // Repairs and returns share a heading: both are things that came back to the shop.
  const fixes = [
    ...(repairs.ok ? repairs.data.repairs : []).map((r) => `<li class="who-plain"><span class="who-row-main"><b>${esc(r.fault)}</b><small>${esc(plainRef(r.number))} · ${r.in_warranty ? "in warranty" : "out of warranty"} · ${esc(words(r.status))}</small></span></li>`),
    ...(returns.ok ? returns.data.returns : []).map((r) => `<li class="who-plain"><span class="who-row-main"><b>Return for ${esc(plainRef(r.order_number, { lower: true }))}</b><small>${esc(words(r.reason))} · ${esc(words(r.status))}</small></span>${r.refund_amount ? `<b class="who-money">${esc(money2(r.refund_amount))}</b>` : ""}</li>`),
  ];
  const sec = whoPane.querySelector("#who-repairs");
  if (sec) sec.innerHTML = `${sec.querySelector(".who-h").outerHTML}${fixes.length ? `<ul class="who-list">${fixes.join("")}</ul>` : '<p class="who-none">Nothing mended or sent back.</p>'}`;
  whoPane.querySelectorAll("[data-order]").forEach((b) => b.addEventListener("click", () => openOrder(b.dataset.order, i)));
  whoPane.querySelector("[data-customer]")?.addEventListener("click", () => setDesk("customers", c.id));
  whoPane.querySelectorAll("[data-case]").forEach((b) => b.addEventListener("click", () => {
    const other = S.items.find((x) => x.case_number === b.dataset.case);
    if (other) {
      pickStage(other.stage);
      openItem(other.key);
    } else {
      openRecord(world, "case", b.dataset.case);
    }
  }));
}

function fillSec(id, res, rows, emptyText) {
  const sec = whoPane.querySelector(`#${id}`);
  if (!sec) return;
  const head = sec.querySelector(".who-h").outerHTML;
  if (!res.ok) {
    sec.innerHTML = `${head}<p class="who-none">Nothing to show right now.</p>`;
    return;
  }
  const list = rows(res.data);
  sec.innerHTML = `${head}${list.length ? `<ul class="who-list">${list.join("")}</ul>` : `<p class="who-none">${esc(emptyText)}</p>`}`;
}

/** An order opens as the shared record, with this desk's own buttons under it for roles that have the tools. */
function openOrder(number, i) {
  const can = (t) => S.tools.has(t);
  const acts = [
    can("issue_refund") ? ["refund", "refund", "Refund"] : null,
    can("report_problem") ? ["replace", "swap", "Replacement"] : null,
    can("create_return") ? ["return", "box", "Return"] : null,
  ].filter(Boolean);
  return openRecord(world, "order", number, {
    actions: acts.map(([act, icon, label]) => `<button class="btn small" data-oact="${act}">${ico(icon, 16)}${label}</button>`).join(""),
    onOpen: (sheet) => sheet.el.querySelectorAll("[data-oact]").forEach((b) => b.addEventListener("click", () => {
      sheet.close();
      openAction(b.dataset.oact, i, number);
    })),
  });
}

// ------------------------------------------------------------------ actions

function ordersOf(i) {
  return i.orders || S.orders.get(i.customer_id) || [];
}

function orderOptions(i, chosen) {
  return ordersOf(i).map((o) => `<option value="${esc(o.number)}" ${o.number === chosen ? "selected" : ""}>${esc(plainRef(o.number))} · ${esc(o.items?.[0] || "")} · ${esc(money2(o.total))}</option>`).join("");
}

/** Each action in a small form in a slide-over. Fields are only what the tool asks for. */
const ACTIONS = {
  open: {
    title: "Open a case",
    fields: (i) => `<label class="field"><span>What it is about</span><input class="input" name="subject" required value="${esc(i.title.slice(0, 80))}"></label>
      <label class="field"><span>Kind</span><select class="select" name="category">${CATEGORIES.map((c) => `<option value="${c}">${esc(words(c))}</option>`).join("")}</select></label>
      <label class="field"><span>What happened</span><textarea class="textarea" name="summary" required></textarea></label>
      ${ordersOf(i).length ? `<label class="field"><span>About an order</span><select class="select" name="order"><option value="">None</option>${orderOptions(i)}</select></label>` : ""}
      <label class="check"><input type="checkbox" name="complaint"> <span>This is a complaint</span></label>`,
    run: (i, f) => withCheck(i, () => world.call("open_case", { subject: f.subject, category: f.category, summary: f.summary, is_complaint: !!f.complaint, ...(f.order ? { related: { order: f.order } } : {}) })),
    said: (r) => `${plainRef(r.data.number) || "Case"} opened.`,
  },
  hand: {
    title: "Hand over",
    fields: () => `<div class="field"><span>To</span><div class="hand-to">${HAND_TO.map((r, n) => `<label class="hand-pick"><input type="radio" name="to" value="${r}" ${n === 0 ? "checked" : ""}>${avatar(personFor(r).name, { size: 34 })}<span><b>${esc(personFor(r).name)}</b><small>${esc(personFor(r).job)}</small></span></label>`).join("")}</div></div>
      <label class="field"><span>Why</span><input class="input" name="reason" required></label>
      <label class="field"><span>What they need to know</span><textarea class="textarea" name="summary" required></textarea></label>`,
    run: (i, f) => withCheck(i, () => world.call("escalate", { case_number: i.case_number, to: f.to, reason: f.reason, summary: f.summary })),
    said: (r) => `Handed to ${staffName(r.data.escalated_to)}.`,
  },
  resolve: {
    title: "Resolve",
    fields: () => `<label class="field"><span>How it was sorted</span><textarea class="textarea" name="note" required></textarea></label>`,
    run: (i, f) => world.call("resolve_case", { case_number: i.case_number, note: f.note }),
    said: () => "Resolved.",
  },
  refund: {
    title: "Refund",
    fields: (i, order) => `<label class="field"><span>Order</span><select class="select" name="order_number">${orderOptions(i, order)}</select></label>
      <label class="field"><span>Amount (£)</span><input class="input" name="amount" type="number" min="0.01" step="0.01" required></label>
      <label class="field"><span>Why</span><input class="input" name="reason" required></label>`,
    run: (i, f) => withCheck(i, () => world.call("issue_refund", { order_number: f.order_number, amount: Number(f.amount), reason: f.reason })),
    said: (r, f) => `${money2(Number(f.amount))} going back${r.data.refund_expected_by ? `, there by ${dayName(r.data.refund_expected_by)}` : ""}.`,
  },
  replace: {
    title: "Send a replacement",
    fields: (i, order) => `<label class="field"><span>Order</span><select class="select" name="order_number" data-sku-from>${orderOptions(i, order)}</select></label>
      <label class="field"><span>Item</span><select class="select" name="sku" data-skus></select></label>
      <label class="field"><span>What was wrong</span><select class="select" name="problem"><option value="damaged">Damaged</option><option value="missing">Missing</option><option value="wrong">Wrong item</option><option value="spoiled">Spoiled</option></select></label>`,
    run: (i, f) => withCheck(i, () => world.call("report_problem", { order_number: f.order_number, sku: f.sku, problem: f.problem, resolution: "replacement" })),
    // The engine may decide a person must look first; say what it decided, not what was hoped for.
    said: (r) => (r.data.replacement_shipment ? "A replacement is on its way." : r.data.message || `Passed to the team${r.data.case_number ? ` as ${plainRef(r.data.case_number)}` : ""}.`),
  },
  credit: {
    title: "Goodwill credit",
    fields: () => `<label class="field"><span>Amount (£)</span><input class="input" name="amount" type="number" min="0.01" step="0.01" required></label>
      <label class="field"><span>Why</span><input class="input" name="reason" required></label>`,
    run: (i, f) => withCheck(i, () => world.call("add_goodwill_credit", { customer_id: i.customer_id, amount: Number(f.amount), reason: f.reason, ...(i.case_number ? { case_number: i.case_number } : {}) })),
    said: (r) => `They now have ${money2(r.data.credit_balance)} to spend.`,
  },
  return: {
    title: "Start a return",
    fields: (i, order) => `<label class="field"><span>Order</span><select class="select" name="order_number" data-sku-from>${orderOptions(i, order)}</select></label>
      <label class="field"><span>Item</span><select class="select" name="sku" data-skus></select></label>
      <label class="field"><span>Why it is coming back</span><select class="select" name="reason"><option value="faulty">Faulty</option><option value="damaged">Damaged</option><option value="wrong_item">Wrong item</option><option value="change_of_mind">Changed their mind</option></select></label>`,
    run: (i, f) => withCheck(i, () => world.call("create_return", { order_number: f.order_number, items: [{ sku: f.sku, qty: 1 }], reason: f.reason })),
    said: (r) => `${plainRef(r.data.return_number || r.data.number) || "Return"} started. A label is on its way to them.`,
  },
};

/** Every action is allowed for whoever is looking, so there is nothing to check first. */
function withCheck(i, fn) {
  return fn();
}

function openAction(act, i, order) {
  const a = ACTIONS[act];
  if (!a) return;
  const form = document.createElement("form");
  form.className = "act-form";
  form.innerHTML = `${a.fields(i, order)}<div class="act-foot"><button class="btn primary" type="submit">${esc(a.title)}</button></div>`;
  const sheet = slideOver({ title: a.title, body: form });
  const fillSkus = async () => {
    const pick = form.querySelector("[data-skus]");
    if (!pick) return;
    const res = await read("get_order", { order_number: form.querySelector("[data-sku-from]").value });
    pick.innerHTML = res.ok ? res.data.items.map((it) => `<option value="${esc(it.sku)}">${esc(it.name)}</option>`).join("") : "";
  };
  form.querySelector("[data-sku-from]")?.addEventListener("change", fillSkus);
  fillSkus();
  form.querySelector("input:not([type=radio]):not([type=checkbox]), textarea")?.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    const res = await a.run(i, f);
    if (!res.ok) {
      btn.disabled = false;
      form.querySelector(".act-error")?.remove();
      form.insertAdjacentHTML("beforeend", `<p class="act-error">${esc(res.error?.message || "That did not go through.")}</p>`);
      return;
    }
    sheet.close();
    toast(a.said(res, f), { tone: "good" });
    if (act === "resolve") await stampRow(i.key);
    await afterAction(i.key, { landed: act !== "resolve", credit: act === "credit" });
  });
}

/** A finished item leaves the list (180ms) before it moves to Done. */
function stampRow(key) {
  const li = queuePane.querySelector(`.q-row[data-key="${CSS.escape(key)}"]`)?.closest(".q-li");
  if (!li || reducedMotion()) return Promise.resolve();
  li.classList.add("is-leaving");
  return new Promise((r) => setTimeout(r, 180));
}

/** After anything the desk does: reload the world's view and keep the same item open. */
async function afterAction(key, { landed = false, credit = false } = {}) {
  const was = S.items.find((x) => x.key === key);
  if (was?.case_number) S.cases.delete(was.case_number);
  if (was?.customer_id) S.customers.delete(was.customer_id);
  expireBusyCases();
  await loadQueue();
  paintFilters();
  paintCounts();
  const i = S.items.find((x) => x.key === key) || S.items.find((x) => x.case_number && key.endsWith(x.case_number));
  if (i && i.stage !== S.stage) {
    S.stage = i.stage;
    queuePane.querySelectorAll("[data-stage]").forEach((x) => { x.classList.toggle("is-on", x.dataset.stage === i.stage); x.setAttribute("aria-selected", String(x.dataset.stage === i.stage)); });
  }
  paintRows();
  if (!i) { S.selected = null; paintTalkEmpty(); return paintGlance(); }
  S.selected = i.key;
  queuePane.querySelector(`.q-row[data-key="${CSS.escape(i.key)}"]`)?.classList.add("is-on");
  if (i.customer_id && !i.customer) {
    const c = await customerFor(i.customer_id);
    if (c.ok) i.customer = c.data;
  }
  const events = await timeline(i);
  paintTalk(i, events);
  if (landed) talkPane.querySelector(".talk-feed > li:last-child")?.classList.add("is-landing");
  await paintWho(i);
  // The new credit is shown where it changed, beside the customer, with a short wash.
  if (credit) whoPane.querySelector("[data-credit]")?.closest("li")?.classList.add("is-changed");
}

// ------------------------------------------------------------------ who answers (manager)

const COVER_CHANNELS = [["web_chat", "chat", "Chat"], ["email", "email", "Email"], ["phone", "phone", "Phone"], ["text", "text", "Text"]];
const COVER_WAITS = [[120, "2 hours"], [240, "4 hours"], [480, "One working day"], [960, "Two working days"]];

/** The engine takes the setting but does not hand it back, so this tab remembers what it last set. */
function savedCover() {
  try { return JSON.parse(sessionStorage.getItem("fd-cover")) || { channels: [], staff_after_minutes: 480 }; } catch { return { channels: [], staff_after_minutes: 480 }; }
}

/** The manager decides, per channel, whether the team answers or the owner and their own AI do (staff step in after a wait). */
function openCover() {
  const now = savedCover();
  const form = document.createElement("form");
  form.className = "act-form";
  form.innerHTML = `<p class="muted">Pick who answers each way people get in touch. If nobody has answered after the wait below, the team steps in.</p>
    ${COVER_CHANNELS.map(([id, icon, name]) => `<fieldset class="cover-row"><legend>${ico(icon, 16)}${name}</legend>
      <label><input type="radio" name="${id}" value="team" ${now.channels.includes(id) ? "" : "checked"}><span>The team</span></label>
      <label><input type="radio" name="${id}" value="ai" ${now.channels.includes(id) ? "checked" : ""}><span>You and your AI</span></label></fieldset>`).join("")}
    <label class="field"><span>The team steps in after</span><select class="select" name="wait">${COVER_WAITS.map(([m, t]) => `<option value="${m}" ${m === now.staff_after_minutes ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    <div class="act-foot"><button class="btn primary" type="submit">Save</button></div>`;
  const sheet = slideOver({ title: "Who answers", body: form });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());
    const input = { channels: COVER_CHANNELS.filter(([id]) => f[id] === "ai").map(([id]) => id), staff_after_minutes: Number(f.wait) };
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    const res = await world.call("set_support_cover", input);
    if (!res.ok) {
      btn.disabled = false;
      form.querySelector(".act-error")?.remove();
      form.insertAdjacentHTML("beforeend", `<p class="act-error">${esc(res.error?.message || "That did not go through.")}</p>`);
      return;
    }
    try { sessionStorage.setItem("fd-cover", JSON.stringify(input)); } catch { /* the setting still stands */ }
    sheet.close();
    toast(input.channels.length ? "From the next day, your AI answers first on those." : "The team answers everything.", { tone: "good" });
  });
}

// ------------------------------------------------------------------ start, and staying live

async function refresh() {
  if (S.desk !== "queue") { await S.deskView?.refresh(); return; }
  const before = new Set(S.items.map((i) => i.key));
  expireBusyCases();
  await loadQueue();
  S.items.filter((x) => !before.has(x.key)).forEach((x) => S.fresh.add(x.key));
  paintFilters();
  paintCounts();
  paintRows();
  if (!S.selected) { paintTalkEmpty(); paintGlance(); }
  const i = S.items.find((x) => x.key === S.selected);
  if (i && !talkPane.querySelector("#comp-text")?.value) {
    const events = await timeline(i);
    if (S.selected === i.key) paintTalk(i, events);
  }
  const fresh = S.items.filter((x) => !before.has(x.key) && x.stage === "waiting").length;
  if (fresh) toast(fresh === 1 ? "Someone new has got in touch." : `${fresh} new people have got in touch.`);
}

let timer = null;
function scheduleRefresh() {
  clearTimeout(timer);
  timer = setTimeout(refresh, 250);
}

async function start(asked = {}) {
  await loadTools();
  S.now = (await world.clock()).now;
  // Other apps open a customer's page or a review here.
  if (asked.customer || asked.review) { setDesk(asked.customer ? "customers" : "reviews", asked.customer || asked.review); return; }
  S.desk = "queue";
  delete main.dataset.desk;
  S.cases.clear();
  S.customers.clear();
  S.selected = null;
  S.firstPaint = true;
  paintQueueShell();
  queuePane.querySelector("#q-rows").innerHTML = `<li class="q-loading">${skeleton(8)}</li>`;
  await loadQueue();
  paintTalkEmpty();
  paintFilters();
  paintCounts();
  const target = S.items.find((i) => (asked.case && i.case_number === asked.case) || (asked.contact && i.contacts.some((c) => c.id === asked.contact)))
    || (asked.customer && S.items.filter((i) => i.customer_id === asked.customer).sort((a, b) => b.at.localeCompare(a.at))[0]);
  if (target) S.stage = target.stage;
  else if (!S.items.some((i) => i.stage === "waiting")) S.stage = "progress";
  queuePane.querySelectorAll("[data-stage]").forEach((x) => { x.classList.toggle("is-on", x.dataset.stage === S.stage); x.setAttribute("aria-selected", String(x.dataset.stage === S.stage)); });
  paintRows();
  if (!target && !asked.customer) paintGlance();
  if (target) await openItem(target.key);
  else if (asked.customer) {
    // A customer with nothing open: show who they are, and say there is nothing to talk about yet.
    const c = await customerFor(asked.customer);
    const it = { key: `cust:${asked.customer}`, customer_id: asked.customer, customer: c.ok ? c.data : null, contacts: [], messages: [] };
    S.selected = it.key;
    main.dataset.view = "talk";
    paintTalkEmpty(`Nothing open with ${it.customer?.name || "them"}. Their orders are on the right.`);
      paintWho(it);
  }
}

const q = new URLSearchParams(location.search);
await start({ case: q.get("case"), customer: q.get("customer"), contact: q.get("contact"), review: q.get("review") });

document.addEventListener("ot:day", (e) => {
  if (e.detail?.now) S.now = e.detail.now;
  scheduleRefresh();
});
world.onChange((change) => {
  if (change.reset) { S.known.clear(); S.fresh.clear(); try { sessionStorage.removeItem("fd-cover"); } catch { /* fine */ } start(); return; }
  if (change.source === "local") return;
  if (change.now) S.now = change.now;
  // The inbox's own entries are not tool calls, so any new entry at all may mean a customer wrote.
  if (change.entries.some((e) => !isScreenRead(e))) scheduleRefresh();
});

// On narrower screens the customer slides in from the right; Escape or the close button puts them away.
document.addEventListener("keydown", (e) => { if (e.key === "Escape") main.classList.remove("is-who-open"); });
