// Letterbox: the company's email. Boxes and folders on the left, the letters in one folder in the middle,
// the open conversation on the right. Every read and every action is a real engine tool, so an outside AI
// sending or filing mail shows up here as it happens.
//
// Address bar (used by other apps to link here, Front Desk among them):
//   ?mailbox=hello&folder=inbox&thread=TH-CONV-8006&email=EM-001240&q=blip
// Every part is optional. `thread` (with `mailbox`) or `email` opens that conversation.
import { startApp, esc, avatar, emptyState, skeleton, toast, timeParts, daysBetween, countTo, pulse, reducedMotion } from "../lib/ui.js";
import { isScreenRead } from "../lib/client.js";
import { plainText, plainRef } from "../lib/plain.js";
import { recordChip, wireRecordChips } from "../lib/records.js";

const APP_ID = "letterbox";
const { world, app } = await startApp({ id: APP_ID });
document.title = `${app.name} · Overthought & Co.`;

const SHARED = ["hello", "orders", "suppliers", "accounts", "press"];
const FOLDERS = [
  { id: "inbox", name: "Inbox" },
  { id: "sent", name: "Sent" },
  { id: "drafts", name: "Drafts" },
  { id: "junk", name: "Junk" },
  { id: "archive", name: "Archive" },
  { id: "bin", name: "Bin" },
];
const PAGE = 50;
const OUR_DOMAIN = "@overthought.example";

// Small drawings for this app only (24-unit, round strokes), so the rail reads at a glance without words.
const ICONS = {
  inbox: '<path d="M3.5 13.5 6 5.5h12l2.5 8V19H3.5Z"/><path d="M3.5 13.5H9a3 3 0 0 0 6 0h5.5"/>',
  sent: '<path d="M20.5 3.5 10 14"/><path d="M20.5 3.5 14 20.5l-4-6.5-6.5-4Z"/>',
  drafts: '<path d="M14.5 5.5l4 4L8 20H4v-4Z"/><path d="M12.5 7.5l4 4"/>',
  junk: '<circle cx="12" cy="12" r="8"/><path d="M6.4 6.4l11.2 11.2"/>',
  bin: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/><path d="M10.5 11v5.5M13.5 11v5.5"/>',
  forward: '<path d="M14.5 6 20 11.5 14.5 17"/><path d="M20 11.5h-9.5A6.5 6.5 0 0 0 4 18v1"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="5" rx="1.2"/><path d="M5 9.5V19.5h14V9.5M10 13h4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  reply: '<path d="M9.5 6 4 11.5 9.5 17"/><path d="M4 11.5h9.5a6.5 6.5 0 0 1 6.5 6.5v1"/>',
  unread: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  undo: '<path d="M9 7 4.5 11.5 9 16"/><path d="M4.5 11.5H14a5.5 5.5 0 0 1 0 11h-2"/>',
  // The shared boxes each get a picture: a speech bubble for hello, a parcel, a lorry, a coin, a newspaper.
  hello: '<path d="M5 13.5c0-4 3.1-7 7-7s7 3 7 7-3.1 6-7 6c-1 0-2-.2-2.9-.5L5 20l1-3.6A6.3 6.3 0 0 1 5 13.5Z"/><path d="M9.5 13.5h.01M12 13.5h.01M14.5 13.5h.01" stroke-width="2.6"/>',
  orders: '<path d="M4 8 12 4l8 4v8.5l-8 4-8-4Z"/><path d="M4 8l8 4 8-4M12 12v8.5M8 6l8 4"/>',
  suppliers: '<path d="M2.5 6.5h11v9h-11ZM13.5 9.5h4l3 3.5v2.5h-7"/><circle cx="6.5" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/>',
  accounts: '<circle cx="12" cy="12" r="8"/><path d="M14.5 8.8a2.6 2.6 0 0 0-4.6 1.6V15.5M8.5 12.5h4.5M8.5 15.5h7"/>',
  press: '<path d="M4.5 5.5h12v13a1.5 1.5 0 0 0 3 0V9h-3"/><path d="M7.5 9h6M7.5 12h6M7.5 15h4"/>',
  order: '<path d="M5 8h14l-1.2 11.5H6.2Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  customer: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  case: '<path d="M5 9.5c0-.8.7-1.5 1.5-1.5h11c.8 0 1.5.7 1.5 1.5V18c0 .8-.7 1.5-1.5 1.5h-11C5.7 19.5 5 18.8 5 18Z"/><path d="M9.5 8V6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M5 13h14"/>',
  po: '<path d="M6.5 3.5h8l3 3v14h-11Z"/><path d="M9 10h6M9 13.5h6M9 17h3.5"/>',
  supplier: '<path d="M3.5 20V10l5 3V10l5 3V7.5l7 3.5V20Z"/>',
  campaign: '<path d="M4 10v4h3l7 4.5v-13L7 10Z"/><path d="M17.5 9a4 4 0 0 1 0 6"/>',
  ledger: '<path d="M5 4.5h11.5a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2Z"/><path d="M5 17.5a2 2 0 0 1 2-2h11.5"/>',
  contact: '<path d="M5 18V9a7 7 0 0 1 14 0v9"/><path d="M3.5 13h3v5h-3ZM17.5 13h3v5h-3Z"/>',
};

/** One of this app's drawings as an inline svg. */
function ico(name, size = 18) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

const $ = (id) => document.getElementById(id);
const main = $("main");
const rail = $("rail");
const listPane = $("list-pane");
const readPane = $("read-pane");

// Everything the screen knows. Redrawn from the world after every change; only edited by hand to make an
// action feel instant before the world answers.
const S = {
  tools: new Set(),
  directory: [],          // every box in the company: { mailbox, address, label, name, open, unread, total }
  mailbox: null,
  folder: "inbox",
  search: "",
  emails: [],             // the loaded page of the open folder, newest first
  more: false,
  folderUnread: {},
  selected: null,         // thread id of the open conversation
  thread: null,           // get_email_thread's answer
  known: new Set(),       // email ids already on screen, so only genuinely new letters slide in
  firstPaint: true,
  now: null,
  compose: null,
};

// ------------------------------------------------------------------ small helpers

/** Whether an address belongs to the company, so our own letters can be told apart from theirs. */
function isOurs(address) {
  return String(address || "").toLowerCase().endsWith(OUR_DOMAIN);
}

/** A person's avatar; the company's own addresses wear the app's colour. */
function face(person, size = 40) {
  const name = person?.name || person?.address || "?";
  const a = avatar(name.replace(/^(Sales desk|Accounts|Office|Marketing Dept),\s*/i, ""), { size });
  return isOurs(person?.address) ? a.replace(/--av:[^;]+;/, "--av:var(--app);") : a;
}

/** "11:23" today, "Sat" this week, "21 Nov" this year, "21 Nov 2025" before that. */
function when(iso) {
  if (!iso) return "";
  const now = S.now || iso;
  if (iso.slice(0, 10) === now.slice(0, 10)) return iso.slice(11, 16);
  const d = daysBetween(iso, now);
  const p = timeParts(iso);
  if (d > 0 && d < 7) return p.weekday.slice(0, 3);
  return p.year === timeParts(now).year ? `${p.day} ${p.monthShort}` : `${p.day} ${p.monthShort} ${p.year}`;
}

/** "Saturday 21 November 2026, 10:15" */
function fullWhen(iso) {
  const p = timeParts(iso);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.time}`;
}

/** A box's display name: "hello@" for shared boxes, the person's name for their own. */
function boxName(b) {
  if (!b) return "";
  return SHARED.includes(b.mailbox) ? `${b.mailbox}@` : b.name;
}

/** The picture for a box: a drawing on a coloured tile for shared boxes, the person's face for their own. */
function boxFace(b, size = 30) {
  if (SHARED.includes(b.mailbox)) {
    return `<span class="box-tile box-${esc(b.mailbox)}" style="--size:${size}px">${ico(b.mailbox, Math.round(size * 0.6))}</span>`;
  }
  return avatar(b.name, { size });
}

function currentBox() {
  return S.directory.find((b) => b.mailbox === S.mailbox);
}

/** Reads a tool for drawing only: left out of the record of actions. */
function read(tool, input) {
  return world.call(tool, input, { screen: true });
}

/** Keeps the address bar in step, so a refresh or a shared link opens the same place. */
function syncUrl() {
  const q = new URLSearchParams();
  if (S.mailbox) q.set("mailbox", S.mailbox);
  if (S.folder !== "inbox") q.set("folder", S.folder);
  if (S.selected) q.set("thread", S.selected);
  if (S.search) q.set("q", S.search);
  history.replaceState(null, "", `${location.pathname}${q.toString() ? `?${q}` : ""}`);
}

// ------------------------------------------------------------------ loading

/** Every tool the business has: whoever is looking can do everything. */
async function loadTools() {
  try {
    S.tools = new Set((await world.tools()).map((t) => t.name));
  } catch {
    S.tools = new Set();
  }
}

/** Every box in the business, with its unread and total letters. */
async function loadDirectory() {
  const res = await read("list_mailboxes", {});
  S.directory = (res.ok ? res.data.mailboxes : []).map((b) => ({
    mailbox: b.mailbox,
    address: b.address,
    label: b.label,
    name: SHARED.includes(b.mailbox) ? b.mailbox : b.label.replace(/'s own box$/i, "").replace(/'s$/, ""),
    open: true,
    unread: b.unread || 0,
    total: b.total || 0,
  }));
}

/** Unread letters per folder of the open box, from one search for everything unread. */
async function loadFolderCounts() {
  S.folderUnread = {};
  if (!currentBox()?.open) return;
  const res = await read("list_emails", { mailbox: S.mailbox, unread: true, limit: 100 });
  if (!res.ok) return;
  for (const e of res.data.emails) S.folderUnread[e.folder] = (S.folderUnread[e.folder] || 0) + 1;
}

/** The letters in the open folder. `older` adds the next page below the ones already shown. */
async function loadList({ older = false } = {}) {
  if (!currentBox()?.open) {
    S.emails = [];
    S.more = false;
    return { ok: false };
  }
  const input = { mailbox: S.mailbox, folder: S.folder, limit: PAGE };
  if (S.search) input.search = S.search;
  if (older && S.emails.length) input.before = S.emails.at(-1).at;
  const res = await read("list_emails", input);
  if (!res.ok) return res;
  const got = res.data.emails;
  S.emails = older ? [...S.emails, ...got.filter((e) => !S.emails.some((x) => x.id === e.id))] : got;
  S.more = got.length === PAGE;
  return res;
}

/** Letters grouped into conversations, newest conversation first, as a mail app shows them. */
function threads() {
  const out = new Map();
  for (const e of S.emails) {
    let t = out.get(e.thread_id);
    if (!t) {
      t = { id: e.thread_id, latest: e, count: 0, unread: false, ids: [] };
      out.set(e.thread_id, t);
    }
    t.count += 1;
    t.ids.push(e.id);
    if (!e.read) t.unread = true;
  }
  return [...out.values()];
}

// ------------------------------------------------------------------ the rail

function paintRail() {
  const box = currentBox();
  const shared = S.directory.filter((b) => SHARED.includes(b.mailbox));
  const people = S.directory.filter((b) => !SHARED.includes(b.mailbox));
  const canWrite = S.tools.has("send_email") && S.directory.some((b) => b.open);
  rail.innerHTML = `
    <div class="rail-top">
      <button class="btn primary lb-compose" id="compose-btn" ${canWrite ? "" : "disabled"} title="New message (N)">${ico("drafts", 18)}<span>New message</span></button>
      <button class="btn ghost icon-only small rail-close" id="rail-close" aria-label="Close">${ico("close")}</button>
    </div>
    ${box?.open ? `<div class="rail-sec">
      <p class="rail-h">${esc(boxName(box))}</p>
      <ul class="rail-list">${FOLDERS.map((f) => folderRow(f)).join("")}</ul>
    </div>` : ""}
    <div class="rail-sec">
      <p class="rail-h">Shared</p>
      <ul class="rail-list">${shared.map(boxRow).join("")}</ul>
    </div>
    <div class="rail-sec">
      <p class="rail-h">People</p>
      <ul class="rail-list">${people.map(boxRow).join("")}</ul>
    </div>`;
  rail.querySelector("#compose-btn").addEventListener("click", () => openCompose());
  rail.querySelector("#rail-close").addEventListener("click", closeRail);
  rail.querySelectorAll("[data-folder]").forEach((b) => b.addEventListener("click", () => pickFolder(b.dataset.folder)));
  rail.querySelectorAll("[data-box]").forEach((b) => b.addEventListener("click", () => pickBox(b.dataset.box)));
}

function folderRow(f) {
  const n = S.folderUnread[f.id] || 0;
  const on = f.id === S.folder;
  return `<li><button class="rail-row${on ? " is-on" : ""}" data-folder="${f.id}" ${on ? 'aria-current="true"' : ""}>
    <span class="rail-ico">${ico(f.id)}</span><span class="rail-name">${f.name}</span>
    <span class="rail-count${n ? "" : " is-zero"}" data-count="folder-${f.id}">${n || ""}</span>
  </button></li>`;
}

function boxRow(b) {
  const on = b.mailbox === S.mailbox;
  const tail = `<span class="rail-count${b.unread ? "" : " is-zero"}" data-count="box-${esc(b.mailbox)}">${b.unread || ""}</span>`;
  return `<li><button class="rail-row is-box${on ? " is-on" : ""}" data-box="${esc(b.mailbox)}" ${on ? 'aria-current="true"' : ""} title="${esc(b.label)}">
    ${boxFace(b, 28)}<span class="rail-name">${esc(boxName(b))}</span>${tail}
  </button></li>`;
}

/** Ticks the rail's unread numbers to their new values instead of redrawing them, so a change is seen. */
function tickCounts(before) {
  for (const b of S.directory) {
    if (!b.open) continue;
    const el = rail.querySelector(`[data-count="box-${b.mailbox}"]`);
    const was = before.boxes.get(b.mailbox);
    if (el && was != null && was !== b.unread) bump(el, was, b.unread);
  }
  for (const f of FOLDERS) {
    const el = rail.querySelector(`[data-count="folder-${f.id}"]`);
    const was = before.folders[f.id] || 0;
    const now = S.folderUnread[f.id] || 0;
    if (el && before.mailbox === S.mailbox && was !== now) bump(el, was, now);
  }
}

function bump(el, from, to) {
  el.classList.toggle("is-zero", !to);
  el.dataset.value = String(from);
  countTo(el, to, { ms: 600, format: (v) => (Math.round(v) ? String(Math.round(v)) : "") });
  if (to > from) pulse(el, "is-bumping");
}

function snapshotCounts() {
  return { mailbox: S.mailbox, boxes: new Map(S.directory.map((b) => [b.mailbox, b.unread])), folders: { ...S.folderUnread } };
}

// ------------------------------------------------------------------ the list

function folderName() {
  return FOLDERS.find((f) => f.id === S.folder)?.name || "";
}

function paintListShell() {
  const box = currentBox();
  listPane.innerHTML = `
    <header class="list-head">
      <button class="btn ghost icon-only small list-rail-btn" id="rail-open" aria-label="Mailboxes and folders">${ico("menu")}</button>
      <div class="list-title">
        <h1 class="lb-title">${box ? esc(boxName(box)) : "Letterbox"}</h1>
        <p class="list-sub">${box ? esc(folderName()) : ""}</p>
      </div>
    </header>
    ${box?.open ? `<form class="lb-search" role="search" id="search-form">
      ${ico("search", 17)}
      <input class="lb-search-input" id="search" type="search" placeholder="Search ${esc(folderName().toLowerCase())}" aria-label="Search this folder" value="${esc(S.search)}" autocomplete="off">
    </form>` : ""}
    <ul class="lb-rows" id="rows" aria-label="Conversations"></ul>`;
  listPane.querySelector("#rail-open").addEventListener("click", openRail);
  const input = listPane.querySelector("#search");
  if (input) {
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => runSearch(input.value.trim()), 280);
    });
    listPane.querySelector("#search-form").addEventListener("submit", (e) => { e.preventDefault(); runSearch(input.value.trim()); });
  }
}

async function runSearch(q) {
  if (q === S.search) return;
  S.search = q;
  syncUrl();
  await loadList();
  paintRows();
}

function paintRows() {
  const rows = listPane.querySelector("#rows");
  if (!rows) return;
  const box = currentBox();
  if (!box) {
    rows.innerHTML = `<li class="rows-empty">${emptyState({ title: "No post at all.", text: "This business has no mailboxes yet." })}</li>`;
    return;
  }
  const list = threads();
  if (!list.length) {
    rows.innerHTML = `<li class="rows-empty">${emptyState({ ...(S.search ? { title: "Nothing matches.", text: "Try fewer words, or another folder." } : quietCopy()) })}</li>`;
    return;
  }
  const firstTime = S.firstPaint;
  rows.innerHTML = list.map((t) => rowHtml(t, !firstTime && !S.known.has(t.latest.id))).join("")
    + (S.more ? '<li class="rows-more"><button class="btn ghost small" id="older">Older letters</button></li>' : "");
  list.forEach((t) => t.ids.forEach((id) => S.known.add(id)));
  if (firstTime && !reducedMotion()) {
    rows.querySelectorAll(".row-li").forEach((li, i) => {
      if (i > 14) return;
      li.style.setProperty("--delay", `${i * 28}ms`);
      li.classList.add("rise");
    });
  }
  S.firstPaint = false;
  rows.querySelectorAll("[data-thread]").forEach((b) => b.addEventListener("click", () => openThread(b.dataset.thread, b.dataset.email)));
  rows.querySelector("#older")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    await loadList({ older: true });
    paintRows();
  });
}

/** One plain sentence for an empty folder, so a quiet pane never looks broken. */
function quietCopy() {
  const hello = S.mailbox === "hello";
  return {
    inbox: { title: "All caught up.", text: hello ? "No customer has written in yet. New letters appear here the moment they arrive." : "Nothing new has arrived. New letters appear here the moment they come." },
    sent: { title: "Nothing sent yet.", text: "Letters written from this box are kept here." },
    drafts: { title: "No drafts.", text: "A letter you save half-written waits here until you finish it." },
    junk: { title: "No junk.", text: "Anything that looks like a pitch or a scam would be filed here." },
    archive: { title: "Nothing filed away.", text: "Letters you archive are kept here, out of the way but not lost." },
    bin: { title: "The bin is empty.", text: "Deleted letters wait here until you put them back." },
  }[S.folder] || { title: "Nothing in here.", text: "" };
}

function rowHtml(t, isNew) {
  const e = t.latest;
  const outward = S.folder === "sent" || S.folder === "drafts" || (S.folder === "bin" && isOurs(e.from?.address));
  const who = outward ? (e.to?.[0] || { name: "No one yet", address: "" }) : e.from;
  const on = t.id === S.selected;
  return `<li class="row-li${isNew ? " is-new" : ""}"><button class="lb-row${t.unread ? " is-unread" : ""}${on ? " is-on" : ""}" data-thread="${esc(t.id)}" data-email="${esc(e.id)}" ${on ? 'aria-current="true"' : ""}>
    <span class="row-main">
      <span class="row-top"><b class="row-from">${outward ? "To " : ""}${esc(who.name || who.address)}</b>${t.count > 1 ? `<span class="row-n">${t.count}</span>` : ""}<time class="row-time" datetime="${esc(e.at)}">${esc(when(e.at))}</time></span>
      <span class="row-line"><span class="row-subj">${esc(plainText(e.subject) || "(no subject)")}</span><span class="row-snip"> · ${esc(plainText(String(e.snippet || "")).replace(/\s+/g, " "))}</span></span>
    </span>
    <span class="row-dot" aria-hidden="true"></span>
    ${t.unread ? '<span class="sr">Unread.</span>' : ""}
  </button></li>`;
}

/**
 * The keyboard, as in a good mail app. Keys act only when you are not typing.
 *   J or Down: next letter (it opens)   K or Up: previous   R: reply   F: forward   E: archive   U: mark unread
 *   # or Delete: bin   /: search   N or C: new message   Escape: back to the list on a phone
 */
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || S.compose) return;
  if (e.target.closest?.("input, textarea, select, [contenteditable='true']")) {
    if (e.key === "Escape") e.target.blur();
    return;
  }
  const rows = [...listPane.querySelectorAll(".lb-row")];
  const at = rows.findIndex((r) => r.dataset.thread === S.selected);
  const step = (d) => {
    const next = rows[at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + d))];
    if (!next || next.dataset.thread === S.selected) return;
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest" });
    openThread(next.dataset.thread, next.dataset.email);
  };
  const press = (name) => readPane.querySelector(`[data-act="${name}"]:not(:disabled)`)?.click();
  const keys = {
    j: () => step(1), ArrowDown: () => step(1), k: () => step(-1), ArrowUp: () => step(-1),
    r: () => press("reply"), f: () => press("forward"), e: () => press("archive"), u: () => press("unread"),
    "#": () => press("delete"), Delete: () => press("delete"),
    "/": () => listPane.querySelector("#search")?.focus(), n: () => openCompose(), c: () => openCompose(),
    Escape: () => { main.dataset.view = "list"; },
  };
  const run = keys[e.key];
  if (!run) return;
  e.preventDefault();
  run();
});

// ------------------------------------------------------------------ the open conversation

function paintReaderEmpty() {
  const box = currentBox();
  readPane.innerHTML = `<div class="read-empty">
    <p class="read-empty-title">Choose a letter to read it.</p>
    <p class="read-empty-text"><kbd>J</kbd> and <kbd>K</kbd> move, <kbd>R</kbd> replies, <kbd>E</kbd> archives, <kbd>N</kbd> starts a new message.</p>
  </div>`;
}

/**
 * Opens one conversation. Opening marks the letters in it as read, with the real tool, as a person reading
 * mail would: an outside AI watching the record sees the read too.
 */
async function openThread(threadId, emailId) {
  S.selected = threadId;
  syncUrl();
  main.dataset.view = "read";
  listPane.querySelectorAll(".lb-row").forEach((r) => {
    const on = r.dataset.thread === threadId;
    r.classList.toggle("is-on", on);
    if (on) r.setAttribute("aria-current", "true"); else r.removeAttribute("aria-current");
  });
  readPane.innerHTML = `<div class="read-loading">${skeleton(6)}</div>`;
  const input = emailId ? { email_id: emailId } : { thread_id: threadId, mailbox: S.mailbox };
  const res = await read("get_email_thread", input);
  if (S.selected !== threadId) return;
  if (!res.ok) {
    readPane.innerHTML = `<div class="read-empty">${emptyState({ title: "That letter will not open.", text: "Try another one." })}</div>`;
    return;
  }
  S.thread = res.data;
  S.selected = res.data.thread_id;
  paintReader({ arrive: true });
  markThreadRead();
  // A draft opens straight back into the writing window, where it can be finished.
  const draft = S.folder === "drafts" && res.data.messages.find((m) => m.id === emailId && m.folder === "drafts");
  if (draft && S.tools.has("update_draft")) openCompose({ draft });
}

async function markThreadRead() {
  const unread = (S.thread?.messages || []).filter((m) => !m.read && m.folder !== "sent" && m.folder !== "drafts");
  if (!unread.length || !S.tools.has("mark_email")) return;
  // Show it read at once; the world catches up a moment later.
  unread.forEach((m) => { m.read = true; });
  listPane.querySelector(`.lb-row[data-thread="${CSS.escape(S.thread.thread_id)}"]`)?.classList.remove("is-unread");
  S.emails.forEach((e) => { if (unread.some((m) => m.id === e.id)) e.read = true; });
  await Promise.all(unread.map((m) => world.call("mark_email", { email_id: m.id, mark: "read" })));
  await refreshCounts();
}

function paintReader({ arrive = false } = {}) {
  const t = S.thread;
  if (!t) return paintReaderEmpty();
  const msgs = t.messages || [];
  const inbound = [...msgs].reverse().find((m) => !isOurs(m.from?.address)) || msgs.at(-1);
  const draft = [...msgs].reverse().find((m) => m.folder === "drafts");
  const isDraft = msgs.length > 0 && msgs.every((m) => m.folder === "drafts");
  const links = Object.assign({}, ...msgs.map((m) => m.links || {}));
  const can = (n) => S.tools.has(n);
  const has = (f) => msgs.some((m) => m.folder === f);
  const inBin = has("bin") && !has("inbox") && !has("sent") && !has("archive") && !has("junk");
  const filedAway = has("archive") && !has("inbox");
  const inJunk = has("junk") && !has("inbox");
  const onlySent = msgs.every((m) => m.folder === "sent");
  const mark = can("mark_email") && !isDraft;
  const btn = (act, icon, label, on, cls = "ghost") => `<button class="btn small ${cls}" data-act="${act}" ${on ? "" : "disabled"}>${ico(icon, 16)}<span>${label}</span></button>`;
  const actions = inBin
    ? btn("restore", "undo", "Back to the inbox", mark, "accent") + btn("forward", "forward", "Forward", can("forward_email"))
    : draft && isDraft
      ? btn("edit-draft", "drafts", "Edit draft", can("update_draft"), "accent") + btn("delete-draft", "bin", "Delete", can("delete_draft"))
      : [
        btn("reply", "reply", "Reply", can("send_email"), "accent"),
        btn("forward", "forward", "Forward", can("forward_email")),
        filedAway ? btn("inbox", "undo", "To inbox", mark) : btn("archive", "archive", "Archive", mark && !onlySent),
        inJunk ? btn("inbox", "inbox", "Not junk", mark) : btn("junk", "junk", "Junk", mark && !onlySent),
        btn("unread", "unread", "Unread", mark && !onlySent),
        btn("delete", "bin", "Delete", can("delete_email")),
      ].join("");
  readPane.innerHTML = `
    <div class="read-wrap${arrive ? " is-arriving" : ""}">
      <header class="read-bar">
        <button class="btn ghost small icon-only read-back" id="read-back" aria-label="Back to the list">${ico("back")}</button>
        <div class="read-actions">${actions}</div>
      </header>
      <div class="read-scroll">
        <h2 class="read-subj">${esc(plainText(t.subject || msgs[0]?.subject) || "(no subject)")}</h2>
        <div class="chips" id="chips">${chipsHtml(links)}</div>
        <ol class="msgs" id="msgs">${msgs.map((m, i) => msgHtml(m, i, msgs.length)).join("")}</ol>
        ${isDraft || inBin || !can("send_email") ? "" : `<div class="reply-dock" id="reply-dock">
          <button class="reply-prompt" id="reply-prompt">${face({ name: boxName(currentBox()), address: currentBox()?.address || `hello${OUR_DOMAIN}` }, 30)}<span>Reply to ${esc(inbound?.from?.name || "them")}</span></button>
        </div>`}
      </div>
    </div>`;
  readPane.querySelector("#read-back").addEventListener("click", () => { main.dataset.view = "list"; });
  readPane.querySelectorAll("[data-act]").forEach((b) => {
    // Narrow panes hide the words and keep the drawings, so each button carries its name for screen readers.
    b.setAttribute("aria-label", b.textContent.trim());
    b.title = b.textContent.trim();
    b.addEventListener("click", () => act(b.dataset.act, b));
  });
  readPane.querySelectorAll(".msg.is-folded .msg-head").forEach((h) => h.addEventListener("click", () => h.closest(".msg").classList.remove("is-folded")));
  readPane.querySelector("#reply-prompt")?.addEventListener("click", () => openReply());
  wireRecordChips(readPane.querySelector("#chips"), world);
  if (arrive) readPane.querySelector(".read-scroll").scrollTop = 0;
}

function msgHtml(m, i, n) {
  // Long conversations fold their older letters to one line, so the newest is what you see first.
  const folded = n > 2 && i < n - 2;
  const ours = isOurs(m.from?.address);
  const to = (m.to || []).map((p) => p.name || p.address).join(", ");
  const cc = (m.cc || []).map((p) => p.name || p.address).join(", ");
  return `<li class="msg${ours ? " is-ours" : ""}${folded ? " is-folded" : ""}${m.folder === "drafts" ? " is-draft" : ""}" data-id="${esc(m.id)}">
    <header class="msg-head" ${folded ? 'role="button" tabindex="0" aria-label="Show this letter"' : ""}>
      ${face(m.from, 38)}
      <div class="msg-who">
        <span class="msg-name"><b>${esc(plainText(m.from?.name) || m.from?.address)}</b><span class="msg-addr">${esc(m.from?.address || "")}</span></span>
        <span class="msg-to">to ${esc(to || "no one yet")}${cc ? `, copy to ${esc(cc)}` : ""}</span>
        <span class="msg-peek">${esc(plainText(String(m.body || "")).replace(/\s+/g, " ").slice(0, 160))}</span>
      </div>
      <time class="msg-time" datetime="${esc(m.at)}" title="${esc(fullWhen(m.at))}">${m.folder === "drafts" ? "Draft" : esc(when(m.at))}</time>
    </header>
    <div class="msg-body">${esc(plainText(m.body || ""))}</div>
    ${audienceHtml(m)}
  </li>`;
}

/** How a marketing letter did, quietly under it: only the figures the engine wrote on the sent email. */
function audienceHtml(m) {
  const a = m.audience;
  const r = a?.shown || a?.so_far;
  if (!r || typeof r !== "object") return "";
  // The engine says these are expected values, so they are rounded and prefixed "about".
  const n = (v) => Math.round(v);
  const bits = [`sent to ${esc(r.recipients)}`, `about ${n(r.opens)} opened`, `${n(r.clicks)} clicked`, `${n(r.orders)} ${n(r.orders) === 1 ? "order" : "orders"}`, `${esc(a.unsubscribed || 0)} unsubscribed`];
  return `<p class="msg-audience" title="${esc(a.estimated || "")}"><span>How it did</span>${bits.join(" · ")}</p>`;
}

readPane.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".msg.is-folded .msg-head")) {
    e.preventDefault();
    e.target.closest(".msg").classList.remove("is-folded");
  }
});

// ------------------------------------------------------------------ record chips

// Which of this app's drawings goes on each kind of record a letter can be about.
const CHIP_ICON = { customer_id: "customer", order: "order", case: "case", po: "po", supplier_id: "supplier", campaign_id: "campaign", ledger_id: "ledger" };

/** One chip per business record the letters in the conversation are about. The shared records.js fills and opens them. */
function chipsHtml(links) {
  return Object.keys(CHIP_ICON).filter((k) => links[k]).map((k) => recordChip(k, links[k], { icon: ico(CHIP_ICON[k], 17) })).join("");
}

// ------------------------------------------------------------------ actions on a conversation

/** Archive, junk, back to the inbox, unread, reply or send a draft: each is one real tool call per letter. */
async function act(what, button) {
  const msgs = S.thread?.messages || [];
  if (what === "reply") return openReply();
  if (what === "forward") return openCompose({ forward: msgs.at(-1) });
  if (what === "edit-draft") return openCompose({ draft: [...msgs].reverse().find((m) => m.folder === "drafts") });
  if (what === "delete-draft") return deleteDraft([...msgs].reverse().find((m) => m.folder === "drafts"), button);
  if (what === "unread") return markUnread(msgs);
  // Each letter in the conversation that is not ours to keep moves with one real tool call.
  const restoring = what === "restore" || what === "inbox";
  const from = what === "restore" ? ["bin"] : what === "inbox" ? ["archive", "junk"] : (what === "delete" ? ["inbox", "archive", "junk", "sent"] : ["inbox", "archive", "junk"]).filter((f) => f !== what);
  const targets = msgs.filter((m) => from.includes(m.folder));
  if (!targets.length) return toast("Nothing here to move.");
  button.disabled = true;
  const calls = targets.map((m) => (what === "delete" ? world.call("delete_email", { email_id: m.id }) : world.call("mark_email", { email_id: m.id, mark: restoring ? "inbox" : what })));
  const bad = (await Promise.all(calls)).find((r) => !r.ok);
  if (bad) {
    button.disabled = false;
    return toast(bad.error.message, { tone: "bad" });
  }
  toast({ archive: "Filed in the archive.", junk: "Thrown in the junk.", inbox: "Back in the inbox.", restore: "Back in the inbox.", delete: "Moved to the bin." }[what], { tone: "good" });
  await leaveRow(S.thread.thread_id, restoring ? "inbox" : what);
  closeReader();
  await Promise.all([loadList(), refreshCounts()]);
  paintRows();
}

/** Throws a saved draft away for good, with the real tool. */
async function deleteDraft(d, button) {
  if (!d) return;
  if (button) button.disabled = true;
  const res = await world.call("delete_draft", { email_id: d.id });
  if (!res.ok) {
    if (button) button.disabled = false;
    return toast(res.error.message, { tone: "bad" });
  }
  closeCompose({ instant: true });
  toast("Draft thrown away.", { tone: "good" });
  await leaveRow(d.thread_id, "delete");
  closeReader();
  await Promise.all([loadList(), refreshCounts()]);
  paintRows();
}

async function markUnread(msgs) {
  const last = [...msgs].reverse().find((m) => m.folder !== "sent" && m.folder !== "drafts");
  if (!last) return toast("There is nothing here from anyone else to mark.");
  const res = await world.call("mark_email", { email_id: last.id, mark: "unread" });
  if (!res.ok) return toast(res.error.message, { tone: "bad" });
  toast("Marked unread.");
  const row = listPane.querySelector(`.lb-row[data-thread="${CSS.escape(S.thread.thread_id)}"]`);
  S.emails.forEach((e) => { if (e.id === last.id) e.read = false; });
  closeReader();
  row?.classList.add("is-unread");
  pulse(row?.querySelector(".row-dot"), "is-popping");
  await refreshCounts();
}

/** The row goes the way its letter went: sideways into the archive, tumbling into the junk. */
function leaveRow(threadId, how) {
  const li = listPane.querySelector(`.lb-row[data-thread="${CSS.escape(threadId)}"]`)?.closest(".row-li");
  if (!li || reducedMotion()) return Promise.resolve();
  li.style.setProperty("--h", `${li.offsetHeight}px`);
  li.classList.add(`is-leaving-${how}`);
  return new Promise((r) => setTimeout(r, 520));
}

function closeReader() {
  S.selected = null;
  S.thread = null;
  syncUrl();
  main.dataset.view = "list";
  listPane.querySelectorAll(".lb-row.is-on").forEach((r) => { r.classList.remove("is-on"); r.removeAttribute("aria-current"); });
  paintReaderEmpty();
}

// ------------------------------------------------------------------ writing: reply, new message, drafts

function openReply() {
  const dock = readPane.querySelector("#reply-dock");
  if (!dock) return;
  if (dock.classList.contains("is-open")) return dock.querySelector("textarea")?.focus();
  const msgs = S.thread.messages;
  const target = [...msgs].reverse().find((m) => !isOurs(m.from?.address)) || msgs.at(-1);
  dock.classList.add("is-open");
  dock.innerHTML = `<form class="reply-form" id="reply-form">
    <p class="reply-to">${ico("reply", 15)}<span>To ${esc(target.from?.name || target.from?.address)}</span><span class="muted">from ${esc(boxName(currentBox()))}</span></p>
    <textarea class="textarea reply-text" id="reply-text" rows="6" aria-label="Your reply" placeholder="Write your reply"></textarea>
    <div class="reply-row">
      <button class="btn primary" type="submit">${ico("sent", 16)}<span>Send</span></button>
      <button class="btn ghost" type="button" id="reply-draft" ${S.tools.has("draft_email") ? "" : "disabled"}>Save draft</button>
      <span class="reply-keys"><kbd>⌘</kbd> <kbd>Enter</kbd> sends</span>
      <button class="btn ghost small icon-only reply-x" type="button" id="reply-x" aria-label="Discard">${ico("close", 16)}</button>
    </div>
  </form>`;
  const text = dock.querySelector("#reply-text");
  text.focus();
  dock.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  dock.querySelector("#reply-x").addEventListener("click", () => paintReader());
  dock.querySelector("#reply-draft").addEventListener("click", () => saveReplyDraft(target, text.value));
  dock.querySelector("#reply-form").addEventListener("submit", (e) => { e.preventDefault(); sendReply(target, text.value); });
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(target, text.value); }
  });
}

async function sendReply(target, body) {
  if (!body.trim()) return shake(readPane.querySelector("#reply-text"));
  const form = readPane.querySelector("#reply-form");
  form.querySelectorAll("button").forEach((b) => { b.disabled = true; });
  const res = await world.call("send_email", { mailbox: S.mailbox, reply_to_id: target.id, body });
  if (!res.ok) {
    form.querySelectorAll("button").forEach((b) => { b.disabled = false; });
    return toast(res.error.message, { tone: "bad" });
  }
  await flyAway(form);
  toast("Sent.", { tone: "good" });
  await reloadThread(res.data.id);
  await Promise.all([loadList(), refreshCounts()]);
  paintRows();
}

async function saveReplyDraft(target, body) {
  if (!body.trim()) return shake(readPane.querySelector("#reply-text"));
  const res = await world.call("draft_email", { mailbox: S.mailbox, reply_to_id: target.id, body });
  if (!res.ok) return toast(res.error.message, { tone: "bad" });
  toast("Saved in drafts.", { tone: "good" });
  paintReader();
  await refreshCounts();
}

async function reloadThread(emailId) {
  const res = await read("get_email_thread", { email_id: emailId });
  if (!res.ok) return;
  S.thread = res.data;
  S.selected = res.data.thread_id;
  paintReader();
  const last = readPane.querySelector(".msg:last-child");
  last?.classList.add("is-landing");
  last?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
}

/**
 * The writing window in the corner, as mail apps have it. One window, three jobs:
 * a new message, a forward (`forward`: the letter being passed on), or a saved draft to finish (`draft`).
 */
function openCompose({ to = "", subject = "", forward = null, draft = null } = {}) {
  closeRail();
  if (S.compose) closeCompose({ instant: true });
  // The natural sender: a draft keeps its box, a forward goes from the box you are in, a new message from hello@.
  const from = draft ? draft.mailbox : forward ? S.mailbox : "hello";
  const book = S.directory.map((b) => `<option value="${esc(b.address)}">${esc(boxName(b))}</option>`).join("");
  const mode = draft ? "draft" : forward ? "forward" : "new";
  const title = { draft: "Draft", forward: "Forward", new: "New message" }[mode];
  const addrs = (list) => (list || []).map((p) => p.address).join(", ");
  const sheet = document.createElement("div");
  sheet.className = "compose";
  sheet.dataset.mode = mode;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", title);
  sheet.innerHTML = `<form class="compose-form" id="compose-form">
    <header class="compose-head"><span class="compose-title">${title}</span><button class="btn ghost small icon-only" type="button" id="compose-x" aria-label="Close">${ico("close", 16)}</button></header>
    <input type="hidden" id="c-from" value="${esc(from)}">
    <label class="compose-line"><span>To</span><input class="compose-in" id="c-to" list="c-book" autocomplete="off" placeholder="name@example.com" value="${esc(draft ? addrs(draft.to) : to)}"></label>
    <datalist id="c-book">${book}</datalist>
    ${mode === "forward"
      ? `<p class="compose-line compose-fixed"><span>Subject</span><b>${esc(/^fwd:/i.test(forward.subject) ? forward.subject : `Fwd: ${forward.subject}`)}</b></p>`
      : `<label class="compose-line"><span>Subject</span><input class="compose-in" id="c-subj" value="${esc(draft ? draft.subject : subject)}"></label>`}
    <textarea class="compose-body" id="c-body" aria-label="${mode === "forward" ? "Your note" : "Message"}" placeholder="${mode === "forward" ? "Add a note (optional). The letter is quoted below it." : "Write here"}">${esc(draft ? draft.body : "")}</textarea>
    <footer class="compose-foot">
      <button class="btn primary" type="submit">${ico(mode === "forward" ? "forward" : "sent", 16)}<span>${mode === "forward" ? "Forward" : "Send"}</span></button>
      ${mode === "forward" ? "" : `<button class="btn ghost" type="button" id="c-draft" ${S.tools.has(draft ? "update_draft" : "draft_email") ? "" : "disabled"}>Save draft</button>`}
      ${draft ? `<button class="btn ghost icon-only compose-bin" type="button" id="c-delete" aria-label="Delete this draft" title="Delete this draft" ${S.tools.has("delete_draft") ? "" : "disabled"}>${ico("bin", 17)}</button>` : ""}
    </footer>
  </form>`;
  document.body.append(sheet);
  S.compose = sheet;
  sheet._draft = draft;
  sheet._forward = forward;
  sheet.querySelector(mode === "new" && to ? "#c-subj" : "#c-to").focus();
  sheet.querySelector("#compose-x").addEventListener("click", () => closeCompose());
  sheet.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCompose();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendNew(); }
  });
  sheet.querySelector("#c-draft")?.addEventListener("click", () => sendNew({ draft: true }));
  sheet.querySelector("#c-delete")?.addEventListener("click", () => deleteDraft(draft));
  sheet.querySelector("#compose-form").addEventListener("submit", (e) => { e.preventDefault(); sendNew(); });
}

function closeCompose({ instant = false } = {}) {
  if (!S.compose) return;
  const sheet = S.compose;
  S.compose = null;
  sheet.classList.add("is-closing");
  setTimeout(() => sheet.remove(), instant || reducedMotion() ? 0 : 200);
  if (!instant) rail.querySelector("#compose-btn")?.focus();
}

/** Sends, forwards or saves what is in the window, each with its own real tool. */
async function sendNew({ draft: saveOnly = false } = {}) {
  const sheet = S.compose;
  if (!sheet) return;
  const v = (id) => sheet.querySelector(id)?.value.trim() ?? "";
  const to = v("#c-to").split(/[,;\s]+/).filter(Boolean);
  const body = sheet.querySelector("#c-body").value;
  const { _draft: old, _forward: fwd } = sheet;
  if (!saveOnly && !to.length) return shake(sheet.querySelector("#c-to"));
  if (!fwd && !body.trim()) return shake(sheet.querySelector("#c-body"));
  sheet.querySelectorAll("button").forEach((b) => { b.disabled = true; });
  const res = await composeCall({ old, fwd, saveOnly, to, body, mailbox: v("#c-from"), subject: v("#c-subj") });
  if (!res.ok) {
    sheet.querySelectorAll("button").forEach((b) => { b.disabled = false; });
    return toast(res.error.message, { tone: "bad" });
  }
  S.compose = null;
  if (saveOnly) {
    sheet.classList.add("is-closing");
    setTimeout(() => sheet.remove(), 200);
    toast("Saved in drafts.", { tone: "good" });
  } else {
    await flyAway(sheet);
    sheet.remove();
    toast(fwd ? "Forwarded." : "Sent.", { tone: "good" });
  }
  if (old && S.selected === old.thread_id) closeReader();
  await refreshAll();
}

/** The one tool call behind the window's button. An old draft is updated first, so what is sent is what is on screen. */
async function composeCall({ old, fwd, saveOnly, to, body, mailbox, subject }) {
  if (fwd) return world.call("forward_email", { email_id: fwd.id, mailbox, to, ...(body.trim() ? { body } : {}) });
  if (old) {
    const saved = await world.call("update_draft", { email_id: old.id, ...(to.length ? { to } : {}), subject, body });
    return saved.ok && !saveOnly ? world.call("send_draft", { email_id: old.id }) : saved;
  }
  return world.call(saveOnly ? "draft_email" : "send_email", { mailbox, to, subject, body });
}

/** The letter folds into a paper plane and is gone over the top of the screen. */
function flyAway(el) {
  if (!el || reducedMotion()) return Promise.resolve();
  el.classList.add("is-flying");
  return new Promise((r) => setTimeout(r, 620));
}

function shake(el) {
  if (!el) return;
  el.focus();
  pulse(el, "is-shaking");
}

// ------------------------------------------------------------------ choosing a box or a folder

async function pickBox(mailbox) {
  closeRail();
  if (mailbox === S.mailbox) return;
  S.mailbox = mailbox;
  S.folder = "inbox";
  S.search = "";
  S.firstPaint = true;
  closeReader();
  await showBox();
}

async function pickFolder(folder) {
  closeRail();
  if (folder === S.folder) return;
  S.folder = folder;
  S.search = "";
  S.firstPaint = true;
  closeReader();
  rail.querySelectorAll("[data-folder]").forEach((b) => {
    const on = b.dataset.folder === folder;
    b.classList.toggle("is-on", on);
    if (on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
  });
  paintListShell();
  listPane.querySelector("#rows").innerHTML = `<li class="rows-loading">${skeleton(8)}</li>`;
  await loadList();
  paintRows();
  syncUrl();
}

async function showBox() {
  paintRail();
  paintListShell();
  listPane.querySelector("#rows").innerHTML = `<li class="rows-loading">${skeleton(8)}</li>`;
  paintReaderEmpty();
  await Promise.all([loadList(), loadFolderCounts()]);
  paintRail();
  paintRows();
  syncUrl();
}

function openRail() {
  main.classList.add("is-rail-open");
  $("scrim").hidden = false;
  rail.querySelector(".rail-row.is-on, .rail-row")?.focus();
}

function closeRail() {
  main.classList.remove("is-rail-open");
  $("scrim").hidden = true;
}

$("scrim").addEventListener("click", closeRail);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && main.classList.contains("is-rail-open")) closeRail(); });

/** The box to open first: the address bar's, else hello@, else the first box. */
function defaultBox(asked) {
  if (asked && S.directory.some((b) => b.mailbox === asked)) return asked;
  return (S.directory.find((b) => b.mailbox === "hello") || S.directory[0])?.mailbox || null;
}

// ------------------------------------------------------------------ staying live

/** Unread numbers, refreshed and ticked (not redrawn) so a change is seen. */
async function refreshCounts() {
  const before = snapshotCounts();
  await Promise.all([loadDirectory(), loadFolderCounts()]);
  if (!rail.querySelector(".rail-row")) return paintRail();
  tickCounts(before);
}

let refreshTimer = null;

/** Something changed in the world (time moved, or someone acted): bring the screen up to date, once. */
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshAll, 220);
}

async function refreshAll() {
  if (!S.mailbox) return;
  const before = snapshotCounts();
  const rows = listPane.querySelector("#rows");
  const scroll = rows?.scrollTop;
  await Promise.all([loadDirectory(), loadFolderCounts(), loadList(), world.clock().then((c) => { if (c?.now) S.now = c.now; }).catch(() => {})]);
  tickCounts(before);
  paintRows();
  const fresh = listPane.querySelectorAll(".row-li.is-new .lb-row.is-unread").length;
  const list = listPane.querySelector("#rows");
  // New letters drop in at the top; bring the top into view so they are seen, and say so once.
  if (list) list.scrollTo({ top: fresh ? 0 : (scroll ?? 0), behavior: fresh && !reducedMotion() ? "smooth" : "auto" });
  if (fresh) toast(fresh === 1 ? "A new letter has arrived." : `${fresh} new letters have arrived.`);
  // The open conversation may have grown (someone wrote back): redraw it only if it did.
  if (S.thread && !readPane.querySelector("#reply-dock.is-open")) {
    const res = await read("get_email_thread", { email_id: S.thread.messages.at(-1).id });
    if (res.ok && res.data.messages.length !== S.thread.messages.length) {
      S.thread = res.data;
      paintReader();
    }
  }
}

async function start({ asked = {} } = {}) {
  await loadTools();
  S.now = (await world.clock()).now;
  await loadDirectory();
  S.mailbox = defaultBox(asked.mailbox);
  S.folder = FOLDERS.some((f) => f.id === asked.folder) ? asked.folder : "inbox";
  S.search = asked.q || "";
  S.firstPaint = true;
  await showBox();
  if (asked.thread || asked.email) await openThread(asked.thread, asked.email);
}

const q = new URLSearchParams(location.search);
await start({ asked: { mailbox: q.get("mailbox"), folder: q.get("folder"), thread: q.get("thread"), email: q.get("email"), q: q.get("q") } });

document.addEventListener("ot:day", (e) => {
  if (e.detail?.now) S.now = e.detail.now;
  scheduleRefresh();
});
world.onChange((change) => {
  if (change.reset) {
      S.known.clear();
    closeReader();
    start({ asked: { mailbox: S.mailbox } });
    return;
  }
  if (change.source === "local") return;  // this page moved the clock; ot:day already covers it
  if (change.now) S.now = change.now;
  if (change.entries.some((e) => !isScreenRead(e))) {
      scheduleRefresh();
  }
});
