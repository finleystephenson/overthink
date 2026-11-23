// Kettle: the team. People, tasks, hours and pay (team.js; this was Rota), and the staff chat. Channels and direct messages on the left, the conversation in the middle, threads at
// the side. Reads with list_channels, read_channel and read_direct_messages; sends with send_chat_message, as
// the team member chosen in the message box. Links to business records open through get_order, get_customer, get_case,
// get_supplier and get_purchase_order. Nothing on the screen is made up: every line comes from the world.
import { startApp, esc, avatar, emptyState, skeleton, toast, longDate, timeParts, reducedMotion, pulse } from "../lib/ui.js";
import { isScreenRead } from "../lib/client.js";
import { loadPeople, loadTeam, onShift as onShiftAt } from "../lib/people.js";
import { plainText, plainRef } from "../lib/plain.js";
import { openRecord, recordChip, wireRecordChips, kindOf } from "../lib/records.js";
import { showTeam, teamRail } from "./team.js";

const APP_ID = "kettle";
const PAGE = 100;
const BADGE_LOOKBACK = 25;
const SEEN_KEY = "ot-kettle-seen";
const GROUP_MINUTES = 8;
const REACTIONS = ["noted", "thanks", "seen", "ha", "good", "agreed"];  // the words react_to_chat_message accepts
const SEARCH_LIMIT = 30;
// Who a channel naturally belongs to, by job, so the message box starts on the right person.
const CHANNEL_OWNER = { orders: "warehouse", stockroom: "buyer", customers: "support_lead", money: "finance", marketing: "marketing" };
const AI_PERSON = { id: "AI", name: "Operations assistant", ai: true };

const { world, app } = await startApp({ id: APP_ID });
document.title = `${app.name} · Overthought & Co.`;
const $ = (sel) => document.querySelector(sel);

const state = {
  team: await loadTeam(world),  // everyone, with hours; reloaded when a day passes
  now: (await world.clock()).now,
  view: { kind: "channel", id: "general" },  // or { kind: "dm", id: "S-01~S-05" }: a pair of people, in id order
  channels: [],
  messages: [],      // the open conversation, oldest first
  total: 0,
  shown: new Set(),  // ids already drawn, so new arrivals can slide in
  latest: {},        // view key -> newest messages, for unread markers
  dms: new Map(),    // pair key -> newest first messages between those two
  newSince: null,    // where the "new" line goes in the open conversation
  thread: null,      // id of the message whose thread is open
  jumped: null,      // a date the conversation was jumped back to
  lastAt: {},        // channel -> last_at when its newest lines were read, so quiet channels are not read again
  search: { q: "", results: [], total: 0, busy: false },
};

// ------------------------------------------------------------------ people

const staffById = (id) => (id === "AI" ? AI_PERSON : state.team.find((s) => s.id === id));
const nameOf = (id, fallback) => staffById(id)?.name || fallback || id;
const onShift = (s, iso = state.now) => onShiftAt(s, iso);

const pairKey = (a, b) => [a, b].sort().join("~");
const pairOf = (key) => key.split("~");

/** Who the message box starts on for a conversation: the channel's natural person, else the manager. */
function defaultSender(v = state.view) {
  if (v.kind === "dm") return pairOf(v.id)[0];
  const owner = state.team.find((s) => s.role === (CHANNEL_OWNER[v.id] || "manager"));
  return (owner || state.team.find((s) => s.role === "manager") || state.team[0] || AI_PERSON).id;
}

/** Who is writing right now: the person chosen in the message box. */
function sender() {
  return document.querySelector("#composer [name=as]")?.value || defaultSender();
}

function shiftWords(s) {
  if (onShift(s)) return "In now";
  const d = new Date(state.now);
  if ([0, 6].includes(d.getUTCDay())) return "Off for the weekend";
  const [h, m] = s.start.split(":").map(Number);
  const nowMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  return nowMin < h * 60 + m ? `In at ${s.start}` : "Gone home";
}

// ------------------------------------------------------------------ what has been seen (per viewer, in this browser)

function loadSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch { return {}; }
}
function saveSeen(seen) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* storage blocked: unread markers just reset */ }
}
const viewKey = (v) => `${v.kind}|${v.id}`;

/** The number in a message id. Ids only grow, so "seen up to" is one number, even when the clock stands still. */
const idNum = (id) => Number(String(id).replace(/\D/g, "")) || 0;

/** Newest message id the world has for a conversation, from what is loaded. */
function newestIn(v) {
  const list = v.kind === "dm" ? state.dms.get(v.id) || [] : state.latest[`channel|${v.id}`] || [];
  return Math.max(0, ...list.map((m) => idNum(m.id)), ...(sameView(v) ? state.messages.map((m) => idNum(m.id)) : []));
}
const sameView = (v) => state.view.kind === v.kind && state.view.id === v.id;

/** The last message this person has seen in a conversation. A first visit counts as all seen, so a new desk starts tidy. */
function seenAt(v) {
  const seen = loadSeen();
  const at = seen[viewKey(v)];
  const newest = newestIn(v);
  // A fresh sandbox can have fewer messages than one remembered from before; then start again from what is there.
  if (typeof at !== "number" || at > newest) { seen[viewKey(v)] = newest; saveSeen(seen); return newest; }
  return at;
}

function markSeen(v) {
  const seen = loadSeen();
  seen[viewKey(v)] = newestIn(v);
  saveSeen(seen);
}

// ------------------------------------------------------------------ reading the world

async function loadChannels() {
  const res = await world.call("list_channels", {}, { screen: true });
  if (!res.ok) return;
  state.channels = res.data.channels;
  // last_at says when a channel last heard anything, so only channels that changed have their newest lines read again.
  await Promise.all(state.channels.map(async (c) => {
    const key = `channel|${c.channel}`;
    if (state.latest[key] && state.lastAt[key] === c.last_at) return;
    const r = await world.call("read_channel", { channel: c.channel, limit: BADGE_LOOKBACK }, { screen: true });
    state.latest[key] = r.ok ? r.data.messages : [];
    state.lastAt[key] = c.last_at;
  }));
}

/** Every private conversation between any two team members, grouped by the pair. */
async function loadDms() {
  const people = state.team.filter((p) => p.id);
  const all = await Promise.all(people.map((p) => world.call("read_direct_messages", { person: p.id, limit: PAGE }, { screen: true })));
  const seen = new Set();
  const groups = new Map();
  for (const res of all) {
    if (!res.ok) continue;
    for (const m of res.data.messages) {
      if (seen.has(m.id) || m.dm.length < 2) continue;
      seen.add(m.id);
      const key = pairKey(m.dm[0], m.dm[1]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
  }
  for (const list of groups.values()) list.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : idNum(b.id) - idNum(a.id)));
  state.dms = groups;
}

/** The open conversation, up to a date when jumped back. */
async function loadView({ before } = {}) {
  const v = state.view;
  const input = { limit: PAGE, ...(before ? { before } : {}) };
  const res = v.kind === "channel"
    ? await world.call("read_channel", { channel: v.id, ...input }, { screen: true })
    : await world.call("read_direct_messages", { person: pairOf(v.id)[0], with: pairOf(v.id)[1], ...input }, { screen: true });
  if (!res.ok) return res.error;
  state.total = res.data.total;
  state.messages = res.data.messages.slice().reverse();
  return null;
}

function unreadCount(key, v) {
  const since = seenAt(v);
  const list = key.startsWith("dm|") ? state.dms.get(v.id) || [] : state.latest[key] || [];
  return list.filter((m) => idNum(m.id) > since).length;
}

// ------------------------------------------------------------------ the side bar

function paintSide() {
  $("#channels").innerHTML = state.channels.map((c) => {
    const v = { kind: "channel", id: c.channel };
    const n = unreadCount(`channel|${c.channel}`, v);
    const on = state.view.kind === "channel" && state.view.id === c.channel;
    return `<li><button type="button" class="side-item${on ? " is-on" : ""}${n ? " is-unread" : ""}" data-channel="${esc(c.channel)}" title="${esc(c.about)}">
      <span class="hash" aria-hidden="true">#</span><span class="side-name">${esc(c.channel)}</span>${n ? `<span class="badge">${n >= BADGE_LOOKBACK ? `${n}+` : n}</span><span class="sr">unread</span>` : ""}
    </button></li>`;
  }).join("");
  paintDmList();
  paintShift();
}

/** When a channel last heard anything, in few words: a time today, "Yesterday", or a short date. */
function whenWords(iso) {
  if (!iso) return "";
  const day = dateOf(iso);
  const today = dateOf(state.now);
  if (day === today) return timeOf(iso);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
  if (day === yesterday) return "Yest.";
  const p = timeParts(iso);
  return `${p.day} ${p.monthShort}`;
}

const lastName = (s) => s.name.split(" ").at(-1);

function paintDmList() {
  const pairs = [...state.dms.keys()].sort((a, b) => (state.dms.get(a)[0].at < state.dms.get(b)[0].at ? 1 : -1));
  if (!pairs.length) {
    $("#dms").innerHTML = `<li class="side-note">Nobody has written to anybody privately yet.</li>`;
    return;
  }
  $("#dms").innerHTML = pairs.map((key) => {
    const people = pairOf(key).map((id) => staffById(id) || { id, name: nameOf(id) });
    const v = { kind: "dm", id: key };
    const n = unreadCount(`dm|${key}`, v);
    const on = state.view.kind === "dm" && state.view.id === key;
    return `<li><button type="button" class="side-item dm${on ? " is-on" : ""}${n ? " is-unread" : ""}" data-dm="${esc(key)}" title="${esc(people.map((p) => p.name).join(" and "))}">
      <span class="stack">${people.map((p) => avatar(p.name, { size: 22 })).join("")}</span><span class="side-name">${esc(people.map(lastName).join(" and "))}</span>${n ? `<span class="badge">${n}</span>` : ""}
    </button></li>`;
  }).join("");
}

/** Who is in today: one quiet row per person, those in first, and when the rest are in or gone. */
function paintShift() {
  const people = [...state.team].sort((a, b) => Number(onShift(b)) - Number(onShift(a)));
  const inNow = people.filter((s) => onShift(s)).length;
  $("#shift-h").textContent = inNow ? `In now · ${inNow} of ${people.length}` : "Nobody is in";
  $("#shift").innerHTML = people.map((s) => `<li class="shift-row${onShift(s) ? "" : " is-out"}" title="${esc(s.name)}, ${esc(s.from || "")}">
    ${avatar(s.name, { size: 22 })}<span class="side-name">${esc(s.name)}</span><small>${esc(shiftWords(s))}</small></li>`).join("");
}

// ------------------------------------------------------------------ the conversation

const timeOf = (iso) => iso.slice(11, 16);
const dateOf = (iso) => iso.slice(0, 10);

function dayLabel(date) {
  const today = dateOf(state.now);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
  if (date === today) return "Today";
  if (date === yesterday) return "Yesterday";
  return longDate(`${date}T12:00:00Z`).replace(/ \d{4}$/, (y) => (date.slice(0, 4) === today.slice(0, 4) ? "" : y));
}

/** plainText, plus the review and schedule codes it does not know: "On REV-0226:" reads "On this review:". */
function say(text) {
  return plainText(String(text).replace(/\bREV-\d+/g, "this review").replace(/\s*\(?\bSC-\d+\)?/g, ""));
}

/**
 * The message in plain words. A code that the message really links to becomes a small button saying "Order 20145"
 * (it opens the record); every other code is made plain by plainText.
 */
function textWithChips(m) {
  let raw = String(m.text);
  const chips = [];
  for (const [name, value] of Object.entries(m.links || {})) {
    const kind = kindOf(name);
    if (!value || !kind || kind === "contact" || !plainRef(value)) continue;
    const v = String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // "order ORD-20145" must not read "order Order 20145": the word before the code is swallowed.
    const re = new RegExp(`(?:\\b(?:order|purchase order|case|repair|return)\\s+(?:no\\.?\\s*|number\\s*|#\\s*)?)?\\b${v}\\b`, "gi");
    raw = raw.replace(re, () => { chips.push({ kind, value }); return `\u0001${chips.length - 1}\u0002`; });
  }
  return esc(say(raw)).replace(/\u0001(\d+)\u0002/g, (_, i) => {
    const { kind, value } = chips[Number(i)];
    return `<button type="button" class="chip-rec inline" data-kind="${esc(kind)}" data-value="${esc(value)}">${esc(plainRef(value))}</button>`;
  });
}

/** Links the text does not mention, as the shared record chips under the message. */
function linkChips(m) {
  const extra = Object.entries(m.links || {}).filter(([, v]) => v && !String(m.text).includes(v));
  if (!extra.length) return "";
  return `<div class="msg-chips">${extra.map(([name, value]) => recordChip(name, value)).join("")}</div>`;
}

/** Reactions are words, not pictures: one chip per word, with who said it. Pressing a chip says the same word yourself. */
function reactionChips(m) {
  if (!m.reactions?.length) return "";
  const byMark = new Map();
  for (const r of m.reactions) byMark.set(r.mark, [...(byMark.get(r.mark) || []), r.by]);
  const mine = sender();
  return `<div class="rx-row">${[...byMark].map(([mark, who]) => {
    const names = who.map((id) => nameOf(id));
    const first = names.map((n) => n.split(" ").at(-1));
    const label = first.length > 2 ? `${first.slice(0, 2).join(", ")} +${first.length - 2}` : first.join(", ");
    return `<button type="button" class="rx${who.includes(mine) ? " is-mine" : ""}" data-react="${esc(mark)}" data-msg="${esc(m.id)}" title="${esc(names.join(", "))}" aria-label="${esc(`${mark}, from ${names.join(", ")}`)}">${esc(mark)}<small>${esc(label)}</small></button>`;
  }).join("")}</div>`;
}

/** The small bar that appears on hover, focus or tap: react with a word, or reply in a thread. */
function toolsHtml(m, { inThread, isDm }) {
  const canReact = true;
  return `<div class="msg-tools">
    ${canReact ? `<span class="rx-pop" role="group" aria-label="React with a word">${REACTIONS.map((w) => `<button type="button" class="rx-word" data-react="${w}" data-msg="${esc(m.id)}">${w}</button>`).join("")}</span>
    <button type="button" class="btn small ghost" data-open-react aria-label="React" aria-expanded="false">React</button>` : ""}
    ${inThread || isDm ? "" : `<button type="button" class="btn small ghost" data-thread="${esc(m.id)}">Reply in thread</button>`}
  </div>`;
}

function repliesTo(id) {
  return state.messages.filter((m) => m.thread_parent === id);
}

function replySummary(m) {
  const replies = repliesTo(m.id);
  if (!replies.length) return "";
  const people = [...new Set(replies.map((r) => r.from_name))].slice(0, 3);
  return `<button type="button" class="msg-replies" data-thread="${esc(m.id)}">
    <span class="stack">${people.map((p) => avatar(p, { size: 20 })).join("")}</span>
    <b>${replies.length === 1 ? "1 reply" : `${replies.length} replies`}</b><small>Last at ${esc(timeOf(replies.at(-1).at))}</small>
  </button>`;
}

/**
 * One message.
 * @param {object} m a chat message
 * @param {{compact?: boolean, inThread?: boolean}=} options compact hides the name and avatar under a run by the same person
 */
function messageHtml(m, { compact = false, inThread = false } = {}) {
  const ai = m.from === "AI";
  const s = staffById(m.from);
  const isDm = state.view.kind === "dm";
  const orphan = !inThread && !isDm && m.thread_parent && !state.messages.some((p) => p.id === m.thread_parent);
  return `<article class="msg${compact ? " is-compact" : ""}${state.shown.has(m.id) ? "" : " is-new"}" data-id="${esc(m.id)}">
    <div class="msg-av">${compact ? `<time class="msg-hover-time">${esc(timeOf(m.at))}</time>` : avatar(m.from_name, { size: 32, ai })}</div>
    <div class="msg-body">
      ${compact ? "" : `<header class="msg-head"><b${s?.from && !ai ? ` title="${esc(s.name)}, from ${esc(s.from)}"` : ""}>${esc(m.from_name)}</b><time datetime="${esc(m.at)}">${esc(timeOf(m.at))}</time></header>`}
      ${orphan ? `<p class="msg-orphan">replied to a thread</p>` : ""}
      <p class="msg-text">${textWithChips(m)}</p>
      ${linkChips(m)}${reactionChips(m)}${inThread || isDm ? "" : replySummary(m)}
    </div>
    ${toolsHtml(m, { inThread, isDm })}
  </article>`;
}

/** Messages grouped by day, runs by one person tucked together, and a line where the unread ones begin. */
function streamHtml(list, { inThread = false } = {}) {
  let out = "";
  let lastDay = null;
  let prev = null;
  let newDrawn = false;
  for (const m of list) {
    const day = dateOf(m.at);
    if (day !== lastDay) { out += `<div class="day" data-day="${day}"><span>${esc(dayLabel(day))}</span></div>`; lastDay = day; prev = null; }
    if (!inThread && !newDrawn && state.newSince !== null && idNum(m.id) > state.newSince) {
      out += `<div class="new-line"><span>New</span></div>`;
      newDrawn = true;
      prev = null;
    }
    const compact = prev && prev.from === m.from && (Date.parse(m.at) - Date.parse(prev.at)) / 6e4 < GROUP_MINUTES;
    out += messageHtml(m, { compact, inThread });
    prev = m;
  }
  return out;
}

/** Channel replies live in threads; a private conversation is short pairs, so it reads best all in one line. */
function topLevel() {
  if (state.view.kind === "dm") return state.messages;
  return state.messages.filter((m) => !m.thread_parent || !state.messages.some((p) => p.id === m.thread_parent));
}

function viewTitle() {
  const v = state.view;
  if (v.kind === "channel") {
    const c = state.channels.find((x) => x.channel === v.id);
    return { title: `<span class="hash">#</span>${esc(v.id)}`, about: c?.about || "", placeholder: `Message #${v.id}` };
  }
  const people = pairOf(v.id).map((id) => staffById(id) || { name: nameOf(id), from: "" });
  const names = people.map((p) => p.name).join(" and ");
  return { title: `<span class="stack">${people.map((p) => avatar(p.name, { size: 28 })).join("")}</span><span>${esc(names)}</span>`, about: "A private conversation.", placeholder: `Message ${people[1].name}`, pair: people };
}

function paintHead() {
  const { title, about } = viewTitle();
  $("#convo-head").innerHTML = `
    <button type="button" class="btn small icon-only ghost side-toggle" id="side-toggle" aria-label="Channels and people">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
    <div class="convo-title"><h2>${title}</h2><p>${esc(about)}</p></div>
    <div class="find" id="find" role="search">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
      <input class="find-input" id="find-input" type="search" autocomplete="off" placeholder="Search this conversation" aria-label="Search this conversation" value="${esc(state.search.q)}">
      <button type="button" class="find-date" id="find-date" aria-label="Jump to a date" title="Jump to a date${state.jumped ? ` (now ${esc(shortDay(state.jumped))})` : ""}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>
      </button>
      <input class="find-picker" id="jump" type="date" tabindex="-1" aria-hidden="true" max="${dateOf(state.now)}" value="${esc(state.jumped || "")}">
      <div class="find-results" id="find-results" hidden></div>
    </div>`;
}

const shortDay = (date) => { const p = timeParts(`${date}T12:00:00Z`); return `${p.day} ${p.monthShort}`; };

/** Draws the open conversation. `arrive` slides in anything not drawn before. */
function paintStream(err, { keepScroll = false, arrive = true } = {}) {
  const stream = $("#stream");
  if (err) {
    stream.innerHTML = `<div class="stream-empty">${emptyState({ title: "This conversation did not open.", text: "Pick it again from the list." })}</div>`;
    return;
  }
  const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 120;
  const oldHeight = stream.scrollHeight;
  const list = topLevel();
  const more = state.total > state.messages.length;
  const { placeholder } = viewTitle();
  stream.innerHTML = `
    ${state.jumped ? `<div class="jumped"><span>Showing up to ${esc(longDate(`${state.jumped}T12:00:00Z`))}.</span><button type="button" class="btn small" data-now>Back to now</button></div>` : ""}
    ${more ? `<div class="earlier"><button type="button" class="btn small" data-earlier>Show earlier messages</button></div>` : `<div class="stream-start">${emptyState({ title: state.view.kind === "dm" ? "The start of this conversation." : `The very start of #${state.view.id}.`, text: state.view.kind === "dm" ? "Only these two people can read it." : "" })}</div>`}
    ${list.length ? streamHtml(list) : ""}`;
  if (!arrive || reducedMotion()) stream.querySelectorAll(".msg.is-new").forEach((el) => el.classList.remove("is-new"));
  state.messages.forEach((m) => state.shown.add(m.id));
  $("#composer textarea")?.setAttribute("placeholder", placeholder);
  wireRecordChips(stream, world);
  if (keepScroll) stream.scrollTop = stream.scrollHeight - oldHeight;
  else if (state.jumped) {
    const days = [...stream.querySelectorAll(".day")].filter((d) => d.dataset.day <= state.jumped);
    (days.at(-1) || stream.lastElementChild)?.scrollIntoView({ block: "start" });
  } else if (nearBottom || !arrive) stream.scrollTop = stream.scrollHeight;
  if (state.focus) showFocused();
}

/** After a jump from search: bring the chosen message into view with a short glow (its thread opens if it is a reply). */
function showFocused() {
  const id = state.focus;
  state.focus = null;
  const m = state.messages.find((x) => x.id === id);
  if (!m) return;
  const parent = state.view.kind === "channel" && m.thread_parent && state.messages.some((p) => p.id === m.thread_parent) ? m.thread_parent : null;
  if (parent) { state.thread = parent; paintThread(); }
  const el = document.querySelector(`${parent ? "#thread" : "#stream"} .msg[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "center" });
  el.classList.remove("is-found");
  void el.offsetWidth;  // restart the glow if it is the same message twice
  el.classList.add("is-found");
}

// ------------------------------------------------------------------ the thread at the side

function paintThread() {
  const box = $("#thread");
  const parent = state.messages.find((m) => m.id === state.thread);
  if (!parent) { closeThread(); return; }
  const replies = repliesTo(parent.id);
  box.hidden = false;
  document.body.classList.add("has-thread");
  box.innerHTML = `<header class="thread-head"><div><h2>Thread</h2><p>${state.view.kind === "channel" ? `#${esc(state.view.id)}` : "Private conversation"}</p></div>
      <button type="button" class="btn small icon-only ghost" data-close-thread aria-label="Close thread"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header>
    <div class="thread-body">
      ${streamHtml([parent], { inThread: true })}
      <div class="thread-count"><span>${replies.length ? (replies.length === 1 ? "1 reply" : `${replies.length} replies`) : "No replies yet"}</span></div>
      ${streamHtml(replies, { inThread: true })}
    </div>
    <form class="composer in-thread" id="thread-composer" autocomplete="off">${composerInner("Reply", sender())}</form>`;
  state.messages.forEach((m) => state.shown.add(m.id));
  wireComposer(box.querySelector("#thread-composer"), { threadParent: parent.id });
  wireRecordChips(box, world);
  const body = box.querySelector(".thread-body");
  body.scrollTop = body.scrollHeight;
}

function openThread(id) {
  state.thread = id;
  paintThread();
  $("#thread textarea")?.focus();
}

function closeThread() {
  state.thread = null;
  $("#thread").hidden = true;
  document.body.classList.remove("has-thread");
}

// ------------------------------------------------------------------ sending

/** The message box: who it is sent as, the words, and the send button. */
function composerInner(placeholder, chosen = defaultSender()) {
  const v = state.view;
  const choices = v.kind === "dm" ? pairOf(v.id).map((id) => staffById(id)).filter(Boolean) : state.team;
  const who = choices.some((s) => s.id === chosen) ? chosen : choices[0]?.id;
  // Who is writing is a small choice in the box's corner, not a permanent field: most messages keep the default.
  return `<textarea class="composer-text" name="text" rows="1" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"></textarea>
    <div class="composer-foot">
      <label class="as"><span>as</span><select class="select" name="as" aria-label="Written by">${choices.map((s) => `<option value="${esc(s.id)}"${s.id === who ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
      <span class="compose-keys"><kbd>Enter</kbd> sends · <kbd>Shift</kbd> <kbd>Enter</kbd> new line</span>
      <button class="btn primary small send" type="submit">Send</button>
    </div>`;
}

/** Enter sends, Shift and Enter makes a new line, the box grows with what is typed. */
function wireComposer(form, { threadParent = null } = {}) {
  const text = () => form.querySelector("textarea");
  const grow = () => { const t = text(); t.style.height = "auto"; t.style.height = `${Math.min(t.scrollHeight, 180)}px`; };
  form.addEventListener("input", (e) => { if (e.target.matches("textarea")) grow(); });
  form.addEventListener("keydown", (e) => {
    if (e.target.matches("textarea") && e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = text().value.trim();
    if (!value) { pulse(form, "is-refused"); return; }
    const as = form.querySelector("[name=as]")?.value || defaultSender();
    const input = { text: value, as };
    if (state.view.kind === "channel") input.channel = state.view.id; else input.to = pairOf(state.view.id).find((id) => id !== as) || pairOf(state.view.id)[1];
    if (threadParent) input.thread_parent = threadParent;
    form.classList.add("is-sending");
    const res = await world.call("send_chat_message", input);
    form.classList.remove("is-sending");
    if (!res.ok) { pulse(form, "is-refused"); toast(plainText(res.error.message), { tone: "bad" }); return; }
    text().value = "";
    grow();
    state.jumped = null;
    await refreshView({ toBottom: true });
    const sent = document.querySelector(`.msg[data-id="${CSS.escape(res.data.id)}"]`);
    if (sent) { sent.classList.add("is-sent"); sent.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" }); }
    text().focus();
  });
}

// ------------------------------------------------------------------ reacting

/** Says a word about a message as the person chosen in the message box; a second word replaces the first, as the tool does. */
async function react(id, mark) {
  const input = { message_id: id, mark };
  const dm = state.messages.find((x) => x.id === id)?.dm;
  const who = sender();
  input.as = dm && !dm.includes(who) ? dm[0] : who;
  const res = await world.call("react_to_chat_message", input);
  closeReactions();
  if (!res.ok) { toast(plainText(res.error.message), { tone: "bad" }); return; }
  for (const list of [state.messages, ...Object.values(state.latest), ...state.dms.values()]) {
    for (const m of list) if (m.id === id) m.reactions = res.data.reactions;
  }
  const m = state.messages.find((x) => x.id === id);
  const stream = $("#stream");
  const atBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 60;
  document.querySelectorAll(`.msg[data-id="${CSS.escape(id)}"]`).forEach((el) => {
    el.querySelector(".rx-row")?.remove();
    const body = el.querySelector(".msg-body");
    const replies = body.querySelector(".msg-replies");
    if (replies) replies.insertAdjacentHTML("beforebegin", reactionChips(m)); else body.insertAdjacentHTML("beforeend", reactionChips(m));
  });
  if (atBottom) stream.scrollTop = stream.scrollHeight;  // the new chip must not hide under the composer
}

function closeReactions() {
  document.querySelectorAll(".msg.is-reacting").forEach((el) => {
    el.classList.remove("is-reacting");
    el.querySelector("[data-open-react]")?.setAttribute("aria-expanded", "false");
  });
}

// ------------------------------------------------------------------ search

const matchesAll = (m, words) => words.every((w) => `${m.text} ${m.from_name}`.toLowerCase().includes(w));

/** Messages in the open conversation that contain every word. Channels ask the world; private messages are searched as loaded. */
async function runSearch(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const box = $("#find-results");
  if (!words.length) { box.hidden = true; return; }
  const v = state.view;
  let found = [];
  let total = 0;
  if (v.kind === "channel") {
    const res = await world.call("read_channel", { channel: v.id, search: q, limit: SEARCH_LIMIT }, { screen: true });
    if (!res.ok) return;
    found = res.data.messages;
    total = res.data.total;
  } else {
    found = state.messages.filter((m) => matchesAll(m, words)).reverse();
    total = found.length;
    found = found.slice(0, SEARCH_LIMIT);
  }
  if (q !== $("#find-input")?.value) return;  // typing moved on while the answer was on its way
  state.search = { q, results: found, total };
  paintResults(words);
}

function highlight(text, words) {
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return esc(text).replace(re, "<mark>$1</mark>");
}

function paintResults(words) {
  const box = $("#find-results");
  const { results, total } = state.search;
  box.hidden = false;
  box.innerHTML = results.length
    ? `<p class="find-count">${total === 1 ? "1 message" : `${total} messages`}${total > results.length ? `, newest ${results.length}` : ""}</p>
      <ul>${results.map((m) => `<li><button type="button" data-jump="${esc(m.id)}">
        ${avatar(m.from_name, { size: 28, ai: m.from === "AI" })}
        <span><b>${esc(m.from_name)}</b><time>${esc(dayLabel(dateOf(m.at)))}, ${esc(timeOf(m.at))}</time><em>${highlight(say(m.text), words)}</em></span></button></li>`).join("")}</ul>`
    : `<p class="find-none">Nothing here says that. Try fewer words.</p>`;
}

function closeFind() {
  const box = $("#find-results");
  if (box) box.hidden = true;
}

/** Opens the conversation as it was when a found message was written, then lands on it. */
async function jumpTo(id) {
  const m = state.search.results.find((x) => x.id === id);
  closeFind();
  if (!m) return;
  state.focus = id;
  if (!state.messages.some((x) => x.id === id)) {
    state.jumped = dateOf(m.at);
    const err = await loadView({ before: new Date(Date.parse(m.at) + 6e4).toISOString() });
    paintHead();
    paintStream(err, { arrive: false });
  } else {
    showFocused();
  }
}

// ------------------------------------------------------------------ wiring

async function refreshView({ toBottom = false, before } = {}) {
  const err = await loadView({ before });
  paintStream(err, { arrive: !toBottom });
  if (toBottom) $("#stream").scrollTop = $("#stream").scrollHeight;
  if (state.thread) paintThread();
}

async function open(view) {
  state.teamPage = null;
  $("#team-view").hidden = true;
  $("#convo").hidden = false;
  $("#team-rail").innerHTML = teamRail(null);
  state.view = view;
  state.jumped = null;
  state.search = { q: "", results: [], total: 0, busy: false };
  state.messages = [];  // the last conversation's lines must not count towards this one's
  state.newSince = seenAt(view);
  closeThread();
  toggleSide(false);
  paintHead();
  $("#composer").innerHTML = composerInner(viewTitle().placeholder);
  $("#stream").innerHTML = `<div class="stream-empty">${skeleton(8)}</div>`;
  const err = await loadView();
  state.messages.forEach((m) => state.shown.add(m.id));
  paintStream(err, { arrive: false });
  markSeen(view);
  paintSide();
  $("#composer textarea")?.focus({ preventScroll: true });
}

/** A Team page (people, tasks, hours and pay) in place of the conversation. */
async function openTeam(page, focusTask = null) {
  state.teamPage = page;
  closeThread();
  toggleSide(false);
  $("#convo").hidden = true;
  const el = $("#team-view");
  el.hidden = false;
  $("#team-rail").innerHTML = teamRail(page);
  paintSide();
  document.querySelectorAll("#channels .is-on, #dms .is-on").forEach((x) => x.classList.remove("is-on"));
  const me = state.team.find((p) => p.role === world.role)?.id || "S-01";
  await showTeam({ world, el, page, now: state.now, focusTask, openDm: (id) => open({ kind: "dm", id: [me, id].sort().join("~") }) });
}

async function paintAll() {
  await loadChannels();
  await loadDms();
}

function wireStatic() {
  wireComposer($("#composer"));
  $("#side").addEventListener("click", (e) => {
    const c = e.target.closest("[data-channel]");
    if (c) open({ kind: "channel", id: c.dataset.channel });
    const d = e.target.closest("[data-dm]");
    if (d) open({ kind: "dm", id: d.dataset.dm });
    const t = e.target.closest("[data-team]");
    if (t) openTeam(t.dataset.team);
  });
  $("#convo").addEventListener("click", async (e) => {
    const t = e.target.closest("[data-thread]");
    if (t) { openThread(t.dataset.thread); return; }
    if (e.target.closest("#side-toggle")) { toggleSide(); return; }
    if (e.target.closest("#find-date")) { $("#jump").showPicker?.(); return; }
    const hit = e.target.closest("[data-jump]");
    if (hit) { await jumpTo(hit.dataset.jump); return; }
    if (e.target.closest("[data-now]")) { state.jumped = null; paintHead(); await refreshView({ toBottom: true }); return; }
    if (e.target.closest("[data-earlier]")) {
      const oldest = state.messages[0]?.at;
      const keep = state.messages;
      const err = await loadView({ before: oldest });
      if (!err) state.messages = [...state.messages, ...keep];
      state.total = Math.max(state.total, state.messages.length);
      paintStream(err, { keepScroll: true, arrive: false });
    }
  });
  $("#convo").addEventListener("change", async (e) => {
    if (e.target.id !== "jump" || !e.target.value) return;
    state.jumped = e.target.value;
    const next = new Date(Date.parse(`${state.jumped}T00:00:00Z`) + 864e5).toISOString();
    const err = await loadView({ before: next });
    paintHead();
    paintStream(err, { arrive: false });
  });
  let typing = 0;
  $("#convo").addEventListener("input", (e) => {
    if (e.target.id !== "find-input") return;
    state.search.q = e.target.value;
    clearTimeout(typing);
    typing = setTimeout(() => runSearch(e.target.value.trim()), 250);
  });
  $("#convo").addEventListener("focusin", (e) => {
    if (e.target.id === "find-input" && state.search.results.length && e.target.value.trim()) $("#find-results").hidden = false;
  });
  // Reactions and record links work the same in the conversation and in the thread.
  for (const root of [$("#convo"), $("#thread")]) {
    root.addEventListener("click", (e) => {
      const word = e.target.closest("[data-react]");
      if (word) { react(word.dataset.msg, word.dataset.react); return; }
      const opener = e.target.closest("[data-open-react]");
      if (opener) {
        const msg = opener.closest(".msg");
        const was = msg.classList.contains("is-reacting");
        closeReactions();
        msg.classList.toggle("is-reacting", !was);
        opener.setAttribute("aria-expanded", String(!was));
        return;
      }
      const chip = e.target.closest(".chip-rec");
      if (chip) { openRecord(world, chip.dataset.kind, chip.dataset.value); return; }
      // On a touch screen there is no hover: tapping a message shows its tools.
      const msg = e.target.closest(".msg");
      if (msg && !e.target.closest("button, a, .msg-tools")) {
        const was = msg.classList.contains("is-tapped");
        document.querySelectorAll(".msg.is-tapped").forEach((x) => x.classList.remove("is-tapped"));
        closeReactions();
        msg.classList.toggle("is-tapped", !was);
      }
    });
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".find")) closeFind();
    if (!e.target.closest(".msg")) { closeReactions(); document.querySelectorAll(".msg.is-tapped").forEach((x) => x.classList.remove("is-tapped")); }
  });
  $("#thread").addEventListener("click", (e) => {
    if (e.target.closest("[data-close-thread]")) closeThread();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#find-results")?.hidden) { closeFind(); return; }
    if (document.querySelector(".msg.is-reacting")) { closeReactions(); return; }
    if (state.thread && !document.querySelector(".over")) closeThread();
  });
}

/** The rail on a phone slides in over a scrim, as in Letterbox. */
function toggleSide(open = !document.body.classList.contains("side-open")) {
  document.body.classList.toggle("side-open", open);
  $("#scrim").hidden = !open;
}

/**
 * The keyboard, as in a good chat app. Keys act only when you are not typing (Escape leaves the box).
 *   J or Down: next conversation   K or Up: previous   /: search   C or Enter: write   T: thread on the last message
 *   Escape: close the search, the words, the thread or the rail
 */
function wireKeys() {
  $("#scrim").addEventListener("click", () => toggleSide(false));
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".over")) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable='true']")) {
      if (e.key === "Escape" && e.target.matches("textarea")) e.target.blur();
      return;
    }
    const rows = [...document.querySelectorAll("#side .side-item")];
    const at = rows.findIndex((r) => r.classList.contains("is-on"));
    const step = (d) => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + d))];
      if (!next || next === rows[at]) return;
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest" });
      next.click();
    };
    const keys = {
      j: () => step(1), ArrowDown: () => step(1), k: () => step(-1), ArrowUp: () => step(-1),
      "/": () => $("#find-input")?.focus(), c: () => $("#composer textarea")?.focus(), Enter: () => $("#composer textarea")?.focus(),
      t: () => { const last = topLevel().at(-1); if (last && state.view.kind === "channel") openThread(last.id); },
      Escape: () => toggleSide(false),
    };
    const run = keys[e.key];
    if (!run || (e.key === "Enter" && e.target.closest("button, a"))) return;
    e.preventDefault();
    run();
  });
}

/** After time moves or someone writes: fresh badges, and new lines slide into the open conversation. */
async function liveUpdate() {
  await loadChannels();
  await loadDms();
  if (!state.jumped) await refreshView();
  markSeen(state.view);  // what arrives in the open conversation is seen as it lands
  paintSide();
  paintHead();
}

await paintAll();
wireStatic();
wireKeys();
const asked = new URLSearchParams(location.search);
if (asked.get("task")) await openTeam("tasks", asked.get("task"));
else if (asked.get("team")) await openTeam(asked.get("team"));
else await open(state.view);

document.addEventListener("ot:day", async (e) => {
  state.now = e.detail.now;
  if (e.detail.partial) return;
  // Hours change and people are hired in play, so the team is asked for again whenever a day passes.
  await loadPeople(world);
  state.team = await loadTeam(world);
  if (state.teamPage) openTeam(state.teamPage);
  liveUpdate();
});
world.onChange((change) => {
  if (change.reset) { location.reload(); return; }
  if (change.previousNow && change.now !== change.previousNow) return;  // ot:day handles a day passing
  if (change.entries.some((e) => !isScreenRead(e) && e.tool === "send_chat_message")) liveUpdate();
});
