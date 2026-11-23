// Squint: the shop's photo-sharing account. A profile with its picture grid, a feed, customers' posts that
// tag the shop, private messages, and how the account is doing. Posting, replying to comments and answering
// messages call the real tools, so whatever an outside AI does on the account shows up here as it happens.
import { startApp, esc, num, plural, avatar, emptyState, skeleton, slideOver, stagger, toast, countTo, pulse, node, reducedMotion } from "../lib/ui.js";
import { spiral } from "../lib/icons.js";
import { isScreenRead } from "../lib/client.js";
import { loadTeam } from "../lib/people.js";
import { plainText, rememberName } from "../lib/plain.js";
import { readNetwork, childrenOf, talkCount, age, fullTime, glyph, standIn, outcomeStrip, fillOutcome, byLine, teamNames, reactControl, wireReactions, authorName, resolvePartners, chart, wireCharts, burst } from "../lib/social.js";

// The id of this app in applications/apps.json. Its name, colour and icon all come from there.
const APP_ID = "squint";
const NET = "squint";
const CAPTION_MAX = 2200;
const BIO = "Ordinary things, designed properly. Photographed in good light, which is as far as we go with flattery.";
const TABS = [
  { id: "posts", label: "Posts", icon: "grid" },
  { id: "feed", label: "Feed", icon: "feed" },
  { id: "tagged", label: "Tagged", icon: "tag" },
  { id: "messages", label: "Messages", icon: "mail" },
  { id: "insights", label: "How it is going", icon: "chart" },
];

const { world, app } = await startApp({ id: APP_ID });
document.title = `${app.name} · Overthought & Co.`;

/** Everything the screen knows, refreshed from the world on every change. */
const S = {
  tab: TABS.some((t) => `#${t.id}` === location.hash) ? location.hash.slice(1) : "posts",
  records: [], kids: new Map(), byId: new Map(), now: null,
  stats: null, products: new Map(), grounds: {}, pictures: [], names: new Map(), known: null, fresh: new Set(), freshUntil: new Map(), arrived: [], mine: new Set(),
  thread: null, viewer: null,
};

// ------------------------------------------------------------------ reading the world

/** Reads the whole account. New ids since the last read are remembered so they can arrive with a flourish. */
async function load() {
  const [net, clock] = await Promise.all([readNetwork(world, NET), world.clock()]);
  S.now = clock.now;
  if (!net.ok) { S.failed = net.error; return; }
  S.failed = null;
  const before = S.known;
  S.records = net.records;
  S.byId = new Map(net.records.map((r) => [r.id, r]));
  S.kids = childrenOf(net.records);
  S.known = new Set(net.records.map((r) => r.id));
  // New ids stay "new" for a few seconds, because one day passing can cause two reads in a row and the
  // second must not wipe the arrival the first one found.
  const until = Date.now() + 8000;
  S.arrived = before ? net.records.filter((r) => !before.has(r.id)) : [];
  S.arrived.forEach((r) => S.freshUntil.set(r.id, until));
  S.fresh = new Set([...S.freshUntil].filter(([, t]) => t > Date.now()).map(([id]) => id));
  S.stats = await world.call("social_stats", { network: NET, days: 90 }, { screen: true });
  net.records.forEach((x) => rememberName(x.author?.customer_id, x.author?.name));
  await loadProductNames();
  // Who wrote each company post: the post carries a staff id, the team says whose it is.
  S.names = teamNames(await loadTeam(world).catch(() => []));
}

/** Product names for captions on drawn pictures. Read once per product id; names do not change in a run. */
async function loadProductNames() {
  const ids = [...new Set(S.records.map((r) => r.links?.product_id).filter(Boolean))].filter((id) => !S.products.has(id));
  const found = await Promise.all(ids.map((id) => world.call("get_product", { id }, { screen: true })));
  found.forEach((res, i) => S.products.set(ids[i], res.ok ? res.data.name : null));
}

/** The picture grounds (a colour behind each product picture), so a picture never loads onto blank grey. */
async function loadGrounds() {
  try { S.grounds = await (await fetch("/img/branded/grounds.json")).json(); } catch { S.grounds = {}; }
}

const companyPosts = () => S.records.filter((r) => r.kind === "post" && r.author.kind === "company");
const taggedPosts = () => S.records.filter((r) => r.kind === "post" && r.author.kind === "customer");
const picUrl = (image) => `/${image}`;
/** Whole numbers while a figure counts up, so it never shows 31.81 likes on the way. */
const whole = (v) => num(Math.round(v));
const groundOf = (image) => S.grounds[(image || "").split("/").pop().replace(/\.jpg$/, "")] || "var(--sunken)";

// ------------------------------------------------------------------ the profile

function paintProfile() {
  const el = document.getElementById("profile");
  const followers = S.stats?.ok ? S.stats.data[NET].followers_now : null;
  const week = S.stats?.ok ? S.stats.data[NET].days.slice(0, 7).reduce((n, d) => n + d.reach, 0) : null;
  const action = `<button class="btn primary sq-new" id="newPost" title="New post (N)">${glyph("plus", 17)}<span>New post</span></button>`;
  // The business's own identity, inside the calm frame: its spiral and its name in its own face (Anybody).
  el.innerHTML = `
    <div class="sq-mark" aria-hidden="true">${spiral({ size: 40 })}</div>
    <div class="sq-id">
      <div class="sq-name-row"><h1 class="sq-name">Overthought &amp; Co.</h1><span class="sq-handle">@overthoughtco</span></div>
      <ul class="sq-counts">
        <li><b>${num(companyPosts().length)}</b> posts</li>
        ${followers == null ? "" : `<li><b>${num(followers)}</b> followers</li>`}
        ${week == null ? "" : `<li><b>${num(week)}</b> saw a post this week</li>`}
      </ul>
      <p class="sq-bio">${esc(BIO)}</p>
    </div>
    <div class="sq-act">${action}</div>`;
  el.querySelector("#newPost")?.addEventListener("click", openComposer);
}

function paintTabs() {
  const el = document.getElementById("tabs");
  const waiting = conversationsWaiting();
  // Plain words with an underline, and the number waiting written out: no icons, no dot.
  el.innerHTML = TABS.map((t) => `<button class="sq-tab${t.id === S.tab ? " is-on" : ""}" data-tab="${t.id}" aria-current="${t.id === S.tab ? "page" : "false"}">
    <span>${esc(t.label)}</span>${t.id === "messages" && waiting ? `<small class="sq-waiting" title="${esc(plural(waiting, "conversation"))} waiting for an answer">${waiting}</small>` : ""}</button>`).join("");
  el.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
}

/** Conversations whose newest message is from a customer: the familiar unread dot on the messages tab. */
function conversationsWaiting() {
  return S.convos ? S.convos.filter((c) => !c.answered).length : 0;
}

function switchTab(id) {
  if (id === S.tab) return;
  S.tab = id;
  history.replaceState(null, "", `#${id}`);
  paintTabs();
  paintView({ arrive: true });
}

// ------------------------------------------------------------------ the views

async function paintView({ arrive = false } = {}) {
  const view = document.getElementById("view");
  view.dataset.tab = S.tab;
  if (S.failed) { view.innerHTML = emptyState({ title: "The account did not load.", text: "Try again in a moment." }); return; }
  if (S.tab === "posts") paintGrid(view);
  else if (S.tab === "feed") paintFeed(view);
  else if (S.tab === "tagged") paintTagged(view);
  else if (S.tab === "messages") await paintMessages(view);
  else paintInsights(view);
  wireGridKeys(view);
}

/**
 * Arrow keys move through a picture grid as they would in a photo app; Enter opens the picture.
 * WHY by columns read from the layout: the grid has 3 columns on a wide screen and 3 on a phone, but may change.
 */
function wireGridKeys(view) {
  const grid = view.querySelector(".sq-grid");
  if (!grid) return;
  grid.addEventListener("keydown", (e) => {
    const tiles = [...grid.querySelectorAll("[data-open]")];
    const at = tiles.indexOf(document.activeElement);
    if (at < 0) return;
    const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, l: 1, h: -1, j: cols, k: -cols }[e.key];
    if (!move) return;
    e.preventDefault();
    const next = tiles[Math.max(0, Math.min(tiles.length - 1, at + move))];
    next.focus();
    next.scrollIntoView({ block: "nearest" });
  });
}

/** One square: a company picture or a customer's drawn stand-in, with likes and comments on hover. */
function tile(p) {
  const talk = talkCount(p.id, S.kids);
  const pic = p.image
    ? `<img src="${esc(picUrl(p.image))}" alt="${esc(plainText(p.text).slice(0, 120))}" loading="lazy" decoding="async">`
    : standIn({ name: p.author.name, seed: p.id, label: S.products.get(p.links?.product_id) || "" });
  return `<li class="sq-tile${S.fresh.has(p.id) ? " is-new" : ""}" style="--ground:${p.image ? groundOf(p.image) : "transparent"}">
    <button data-open="${esc(p.id)}" aria-label="Open the post from ${esc(age(p.at, S.now))} ago">${pic}
      <span class="sq-tile-over"><span>${glyph("heart", 16)} ${num(p.likes)}</span><span>${glyph("talk", 16)} ${num(talk)}</span></span>
    </button></li>`;
}

function paintGrid(view) {
  const posts = companyPosts();
  view.innerHTML = posts.length
    ? `<ul class="sq-grid">${posts.map(tile).join("")}</ul>`
    : emptyState({ title: "No pictures yet.", text: "Press New post to share the first one." });
  wireOpen(view, posts);
}

function paintTagged(view) {
  const posts = taggedPosts();
  view.innerHTML = posts.length
    ? `<p class="sq-note">Customers' own posts that tag the shop. Their photos are not kept, so each one shows their initials.</p><ul class="sq-grid">${posts.map(tile).join("")}</ul>`
    : emptyState({ title: "Nobody has tagged the shop yet.", text: "When a customer posts about something they bought and tags the shop, it appears here." });
  wireOpen(view, posts);
}

/** The feed: the newest company and customer posts as big cards, picture first. */
function paintFeed(view) {
  const posts = S.records.filter((r) => r.kind === "post").slice(0, 30);
  view.innerHTML = `<ol class="sq-feed">${posts.map(feedCard).join("")}</ol>`;
  wireOpen(view, posts);
}

function feedCard(p) {
  const talk = talkCount(p.id, S.kids);
  const latest = (S.kids.get(p.id) || []).slice(-2);
  const pic = p.image
    ? `<img src="${esc(picUrl(p.image))}" alt="" loading="lazy" decoding="async">`
    : standIn({ name: p.author.name, seed: p.id, label: S.products.get(p.links?.product_id) || "" });
  return `<li class="sq-card${S.fresh.has(p.id) ? " is-new" : ""}">
    <header class="sq-card-head">${authorAvatar(p, 36)}<span class="sq-who"><b>${authorName(p)}</b><small>@${esc(p.author.handle)} · ${esc(age(p.at, S.now))}</small>${byLine(p, S.names)}</span>
      ${p.author.kind === "customer" ? `<span class="pill">Tagged the shop</span>` : ""}</header>
    <button class="sq-card-pic" data-open="${esc(p.id)}" style="--ground:${p.image ? groundOf(p.image) : "transparent"}" aria-label="Open this post">${pic}</button>
    <div class="sq-card-body">
      <p class="sq-card-meta">${reactControl(p, "like", { network: NET })}<span class="react is-static" title="Comments">${glyph("talk", 17)}<b>${num(talk)}</b></span></p>
      <p class="sq-caption"><b>${esc(p.author.handle)}</b> ${esc(said(p))}</p>
      ${latest.map((c) => `<p class="sq-line"><b>${esc(c.author.handle)}</b> ${esc(said(c))}</p>`).join("")}
      ${talk > 2 ? `<button class="sq-more" data-open="${esc(p.id)}">See all ${esc(plural(talk, "comment"))}</button>` : ""}
    </div></li>`;
}

/** What a record says, in plain words: the text is written by the data and may hold order codes. */
function said(r) {
  return plainText(r.text);
}

function authorAvatar(p, size) {
  return p.author.kind === "company"
    ? `<span class="sq-co" style="--s:${size}px" aria-hidden="true">${spiral({ size: Math.round(size * 0.62) })}</span>`
    : avatar(p.author.name, { size });
}

function wireOpen(view, list) {
  view.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openPost(b.dataset.open, list)));
}

// ------------------------------------------------------------------ one post, opened large

/**
 * Opens a post over the page: the picture big on the left, the caption, what it did and the comments on the right.
 * Arrow keys step through the list it was opened from.
 */
async function openPost(id, list) {
  closeViewer();
  const wrap = node(`<div class="sq-lb" role="dialog" aria-modal="true" aria-label="A post">
    <div class="sq-lb-back"></div>
    <button class="sq-lb-close btn icon-only ghost" aria-label="Close">${glyph("close", 22)}</button>
    <button class="sq-lb-step is-prev" aria-label="Newer post">${glyph("left", 22)}</button>
    <button class="sq-lb-step is-next" aria-label="Older post">${glyph("right", 22)}</button>
    <article class="sq-lb-panel"><div class="sq-lb-pic"></div><div class="sq-lb-side">${skeleton(5)}</div></article>
  </div>`);
  const opener = document.activeElement;
  const ids = list.map((p) => p.id);
  S.viewer = { id, ids, wrap, opener };
  const step = (d) => { const i = ids.indexOf(S.viewer.id) + d; if (i >= 0 && i < ids.length) fillViewer(ids[i], d); };
  wrap.querySelector(".sq-lb-back").addEventListener("click", closeViewer);
  wrap.querySelector(".sq-lb-close").addEventListener("click", closeViewer);
  wrap.querySelector(".is-prev").addEventListener("click", () => step(-1));
  wrap.querySelector(".is-next").addEventListener("click", () => step(1));
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeViewer();
    if (e.target.matches("textarea, input")) return;
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });
  document.body.append(wrap);
  document.body.classList.add("sq-locked");
  wrap.querySelector(".sq-lb-close").focus();
  await fillViewer(id, 0);
}

function closeViewer() {
  const v = S.viewer;
  if (!v) return;
  S.viewer = null;
  document.body.classList.remove("sq-locked");
  v.wrap.classList.add("is-leaving");
  setTimeout(() => { v.wrap.remove(); v.opener?.focus?.(); }, reducedMotion() ? 0 : 200);
}

/** Reads the post with get_social_post (fresh comments) and draws it into the open viewer. */
async function fillViewer(id, direction) {
  const v = S.viewer;
  if (!v) return;
  v.id = id;
  const res = await world.call("get_social_post", { post_id: id }, { screen: true });
  if (S.viewer !== v || v.id !== id) return;
  const side = v.wrap.querySelector(".sq-lb-side");
  const picBox = v.wrap.querySelector(".sq-lb-pic");
  v.wrap.querySelector(".is-prev").disabled = v.ids.indexOf(id) <= 0;
  v.wrap.querySelector(".is-next").disabled = v.ids.indexOf(id) >= v.ids.length - 1;
  if (!res.ok) { side.innerHTML = emptyState({ title: "This post has gone.", text: res.error.message }); return; }
  const p = res.data;
  picBox.style.setProperty("--ground", p.image ? groundOf(p.image) : "transparent");
  // The picture whole, over a soft blur of itself, so a wide photo fills the frame without being cropped.
  picBox.innerHTML = p.image
    ? `<img class="sq-lb-blur" src="${esc(picUrl(p.image))}" alt=""><img class="sq-lb-img" src="${esc(picUrl(p.image))}" alt="${esc(said(p).slice(0, 160))}">`
    : standIn({ name: p.author.name, seed: p.id, label: S.products.get(p.links?.product_id) || "" });
  const talk = talkCount(p.id, S.kids) || p.comments.length;
  side.innerHTML = `
    <header class="sq-lb-head">${authorAvatar(p, 40)}<span class="sq-who"><b>${authorName(p)}</b><small>@${esc(p.author.handle)}</small>${byLine(p, S.names)}</span></header>
    <div class="sq-lb-scroll">
      <p class="sq-lb-caption">${esc(said(p))}</p>
      <p class="sq-lb-time">${esc(fullTime(p.at))}${p.links?.product_id && S.products.get(p.links.product_id) ? ` · ${esc(S.products.get(p.links.product_id))}` : ""}</p>
      ${p.author.kind === "customer" ? `<p class="sq-card-meta sq-lb-react">${reactControl(p, "like", { network: NET, label: true })}</p>` : ""}
      ${outcomeStrip(p, { talk, network: NET, now: S.now })}
      <h3 class="sq-lb-sub">${talk ? esc(plural(talk, "comment")) : "No comments yet"}</h3>
      <ol class="sq-thread">${p.comments.map((c) => commentItem(c)).join("")}</ol>
    </div>
    ${replyBox(p.id, "Add a comment as the shop")}`;
  fillOutcome(side);
  wireReplies(side);
  matchGround(picBox);
}

/**
 * Paints the space around a whole picture in the picture's own backdrop colour (read from its top-left corner),
 * so a wide or tall photo shown whole looks like one print, not a photo on a grey card.
 * WHY: the grounds list does not cover every picture name; the picture itself always knows.
 */
function matchGround(box) {
  const img = box.querySelector(".sq-lb-img");
  if (!img) return;
  const paint = () => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 2, 2, 1, 1, 0, 0, 1, 1);
      const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
      box.style.setProperty("--ground", `rgb(${r} ${gr} ${b})`);
    } catch { /* a picture from elsewhere cannot be read: the grounds list colour stays */ }
  };
  if (img.complete && img.naturalWidth) paint(); else img.addEventListener("load", paint, { once: true });
}

/** A comment and, under it, any replies to it (read from the whole account, since a post's read gives one level). */
function commentItem(c, depth = 0) {
  const replies = (S.kids.get(c.id) || []);
  const mine = c.author.kind === "company";
  return `<li class="sq-c${mine ? " is-shop" : ""}${S.fresh.has(c.id) ? " is-new" : ""}" data-id="${esc(c.id)}">
    ${authorAvatar(c, depth ? 26 : 30)}
    <div class="sq-c-body">
      <p><b>${esc(c.author.handle)}</b> ${esc(said(c))}</p>
      <p class="sq-c-meta"><span>${esc(age(c.at, S.now))}</span>${mine ? (c.likes ? `<span>${esc(plural(c.likes, "like"))}</span>` : "") : reactControl(c, "like", { network: NET, zero: false })}
        ${!mine ? `<button class="sq-c-reply" data-reply="${esc(c.id)}" data-handle="${esc(c.author.handle)}">Reply</button>` : ""}</p>
      ${replies.length ? `<ol class="sq-thread is-nested">${replies.map((r) => commentItem(r, depth + 1)).join("")}</ol>` : ""}
    </div></li>`;
}

/** The comment box at the foot of an opened post. */
function replyBox(postId, placeholder) {
  return `<form class="sq-reply" data-post="${esc(postId)}">
    <span class="sq-reply-to" hidden></span>
    <label class="sr" for="sqReplyText">Comment</label>
    <textarea id="sqReplyText" class="sq-reply-text" rows="1" maxlength="${CAPTION_MAX}" placeholder="${esc(placeholder)}"></textarea>
    <button class="btn small primary" type="submit" disabled><span>Post</span></button>
  </form>`;
}

function wireReplies(side) {
  const form = side.querySelector(".sq-reply");
  if (!form) return;
  const box = form.querySelector("textarea");
  const send = form.querySelector("button[type=submit]");
  const to = form.querySelector(".sq-reply-to");
  let target = form.dataset.post;
  box.addEventListener("input", () => { send.disabled = !box.value.trim(); box.style.height = "auto"; box.style.height = `${Math.min(140, box.scrollHeight)}px`; });
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
  side.querySelectorAll("[data-reply]").forEach((b) => b.addEventListener("click", () => {
    target = b.dataset.reply;
    to.hidden = false;
    to.innerHTML = `Replying to @${esc(b.dataset.handle)} <button type="button" aria-label="Stop replying">${glyph("close", 13)}</button>`;
    to.querySelector("button").addEventListener("click", () => { target = form.dataset.post; to.hidden = true; box.focus(); });
    box.focus();
  }));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = box.value.trim();
    if (!text) return;
    send.disabled = true;
    const res = await world.call("reply_social_post", { post_id: target, text });
    if (!res.ok) { send.disabled = false; toast(res.error.message, { tone: "bad" }); return; }
    burst(send);
    toast(target === form.dataset.post ? "Comment posted." : "Reply posted.", { tone: "good" });
    await refresh();
  });
}

// ------------------------------------------------------------------ a new post

/** Every picture a post may use, with its product name, from the engine (not a list kept in this file). */
async function loadPictures() {
  const res = await world.call("list_post_pictures", {}, { screen: true });
  S.pictures = res.ok ? res.data.pictures : [];
}

async function openComposer() {
  if (!S.pictures.length) await loadPictures();
  let chosen = null;
  const body = node(`<form class="sq-compose">
    <div class="sq-compose-stage" style="--ground:var(--sunken)"><p class="sq-compose-hint">Pick a picture.</p></div>
    ${S.pictures.length ? `<ul class="sq-picks" role="listbox" aria-label="Product pictures">${S.pictures.map((pic, i) => `<li><button type="button" class="sq-pick" data-i="${i}" role="option" aria-selected="false" title="${esc(pic.name)}" style="--ground:${groundOf(pic.path)}">
      <img src="/${esc(pic.path)}" alt="${esc(pic.name)}" loading="lazy"></button></li>`).join("")}</ul>` : '<p class="sq-note">There are no product pictures to post yet.</p>'}
    <p class="sq-compose-name muted small" aria-live="polite">&nbsp;</p>
    <label class="field"><span>Caption</span>
      <textarea class="textarea sq-compose-text" maxlength="${CAPTION_MAX}" placeholder="Plain, exact, and one honest caveat."></textarea></label>
    <div class="sq-compose-foot"><span class="sq-count muted small">0 / ${num(CAPTION_MAX)}</span>
      <span class="muted small">Posts as the shop.</span>
      <span class="reply-keys"><kbd>⌘</kbd> <kbd>Enter</kbd> shares</span>
      <button class="btn primary" type="submit" disabled><span>Share</span></button></div>
  </form>`);
  const over = slideOver({ title: "New post", body, wide: true });
  const stage = body.querySelector(".sq-compose-stage");
  const text = body.querySelector("textarea");
  const send = body.querySelector("button[type=submit]");
  const count = body.querySelector(".sq-count");
  const nameEl = body.querySelector(".sq-compose-name");
  const ready = () => { send.disabled = !chosen || !text.value.trim(); };
  body.querySelectorAll(".sq-pick img").forEach((img) => img.addEventListener("error", () => img.closest("li").remove(), { once: true }));
  body.querySelectorAll(".sq-pick").forEach((b) => b.addEventListener("click", () => {
    chosen = S.pictures[Number(b.dataset.i)];
    body.querySelectorAll(".sq-pick").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    stage.style.setProperty("--ground", groundOf(chosen.path));
    stage.innerHTML = `<img src="/${esc(chosen.path)}" alt="">`;
    nameEl.textContent = chosen.name;
    ready();
  }));
  text.addEventListener("input", () => { count.textContent = `${num(text.value.length)} / ${num(CAPTION_MAX)}`; ready(); });
  text.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !send.disabled) body.requestSubmit(); });
  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    send.disabled = true;
    const res = await world.call("create_social_post", { network: NET, text: text.value.trim(), image: chosen.path, ...(chosen.product_id ? { product_id: chosen.product_id } : {}) });
    if (!res.ok) { ready(); toast(res.error.message, { tone: "bad" }); return; }
    S.mine.add(res.data.id);
    burst(send, { count: 14 });
    over.close();
    toast("Posted. Move on a day to see what it did.", { tone: "good" });
    if (S.tab !== "posts") { S.tab = "posts"; history.replaceState(null, "", "#posts"); }
    await refresh();
    // Open it straight away: its results strip is where the test is read.
    openPost(res.data.id, companyPosts());
  });
}

// ------------------------------------------------------------------ messages

async function loadConversations() {
  const res = await world.call("list_social_messages", { network: NET, limit: 60 }, { screen: true });
  S.convos = res.ok ? res.data.conversations : [];
  await resolvePartners(world, S.convos, S.records);
  return res;
}

async function paintMessages(view) {
  if (!S.convos) await loadConversations();
  if (!S.convos.length) {
    view.innerHTML = `${newMessageBar()}${emptyState({ title: "No messages.", text: "Nobody has written to the shop privately here yet." })}`;
    wireNewMessage(view);
    return;
  }
  if (!S.thread || !S.convos.some((c) => c.thread === S.thread)) S.thread = S.convos[0].thread;
  view.innerHTML = `${newMessageBar()}<div class="sq-dm">
    <ol class="sq-dm-list">${S.convos.map((c) => `<li><button class="sq-dm-row${c.thread === S.thread ? " is-on" : ""}${c.answered ? "" : " is-waiting"}" data-thread="${esc(c.thread)}">
      ${avatar(c.who.name, { size: 40 })}<span class="sq-who"><b>${esc(c.who.name)}</b><small>${esc(plainText(c.last_text))}</small></span><span class="sq-dm-age">${esc(age(c.last_at, S.now))}</span></button></li>`).join("")}</ol>
    <section class="sq-dm-pane" id="dmPane">${skeleton(4)}</section></div>`;
  view.querySelectorAll("[data-thread]").forEach((b) => b.addEventListener("click", () => {
    S.thread = b.dataset.thread;
    view.querySelectorAll("[data-thread]").forEach((x) => x.classList.toggle("is-on", x === b));
    view.querySelector(".sq-dm").classList.add("is-reading");
    paintThread();
  }));
  wireNewMessage(view);
  // Up and Down (or J and K) move through the conversations and open each, as in Letterbox.
  view.querySelector(".sq-dm-list").addEventListener("keydown", (e) => {
    const rows = [...view.querySelectorAll(".sq-dm-row")];
    const at = rows.indexOf(document.activeElement);
    const d = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 }[e.key];
    if (!d || at < 0) return;
    e.preventDefault();
    const next = rows[Math.max(0, Math.min(rows.length - 1, at + d))];
    next.focus();
    next.click();
  });
  await paintThread();
}

/** The "New message" button above the conversations. */
function newMessageBar() {
  return `<div class="sq-dm-bar"><button class="btn small" id="newMsg">${glyph("plus", 16)}<span>New message</span></button></div>`;
}

function wireNewMessage(view) {
  view.querySelector("#newMsg")?.addEventListener("click", openNewMessage);
}

/** People who have posted, commented or tagged the shop, newest first, one row each. */
function knownCustomers() {
  const seen = new Map();
  for (const r of S.records) if (r.author.kind === "customer" && !seen.has(r.author.handle)) seen.set(r.author.handle, r.author);
  return [...seen.values()];
}

/** Starts a conversation with a customer by handle: pick someone who has been in touch, or type a handle. */
function openNewMessage() {
  const people = knownCustomers().slice(0, 40);
  const body = node(`<form class="sq-compose sq-newmsg">
    <label class="field"><span>To</span><input class="input" name="handle" list="sqHandles" autocomplete="off" placeholder="Pick someone or type a handle">
      <datalist id="sqHandles">${people.map((a) => `<option value="${esc(a.handle)}">${esc(a.name)}</option>`).join("")}</datalist></label>
    ${people.length ? `<ul class="sq-people" aria-label="People who have been in touch">${people.slice(0, 8).map((a) => `<li><button type="button" class="sq-person" data-handle="${esc(a.handle)}">${avatar(a.name, { size: 26 })}<span>${esc(a.name)}</span></button></li>`).join("")}</ul>` : ""}
    <label class="field"><span>Message</span><textarea class="textarea" rows="4" maxlength="${CAPTION_MAX}" placeholder="Write as the shop"></textarea></label>
    <div class="sq-compose-foot"><span class="muted small">Sent as the shop.</span>
      <button class="btn primary" type="submit" disabled><span>Send</span></button></div>
  </form>`);
  const over = slideOver({ title: "New message", body });
  const handle = body.querySelector("input");
  const text = body.querySelector("textarea");
  const send = body.querySelector("button[type=submit]");
  const ready = () => { send.disabled = !handle.value.trim() || !text.value.trim(); };
  handle.addEventListener("input", ready);
  text.addEventListener("input", ready);
  body.querySelectorAll(".sq-person").forEach((b) => b.addEventListener("click", () => { handle.value = b.dataset.handle; ready(); text.focus(); }));
  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    send.disabled = true;
    const res = await world.call("send_social_message", { network: NET, handle: handle.value.trim().replace(/^@/, ""), text: text.value.trim() });
    if (!res.ok) { ready(); toast(res.error.message, { tone: "bad" }); return; }
    burst(send);
    over.close();
    toast("Message sent.", { tone: "good" });
    S.tab = "messages"; history.replaceState(null, "", "#messages");
    await refresh();
    // Open the new conversation once the list holds it (a read in flight may not have seen it yet).
    if (res.data?.thread && S.convos?.some((c) => c.thread === res.data.thread)) { S.thread = res.data.thread; paintAll(); }
  });
}

async function paintThread() {
  const pane = document.getElementById("dmPane");
  if (!pane) return;
  const res = await world.call("list_social_messages", { thread: S.thread }, { screen: true });
  if (!res.ok) { pane.innerHTML = emptyState({ title: "This conversation has gone.", text: res.error.message }); return; }
  const msgs = res.data.messages;
  const them = msgs.find((m) => m.author.kind === "customer")?.author || S.convos?.find((c) => c.thread === S.thread)?.who || { name: "A customer", handle: "" };
  pane.innerHTML = `<header class="sq-dm-head"><button class="btn small icon-only ghost sq-dm-back" aria-label="Back to all messages">${glyph("back", 18)}</button>
      ${avatar(them.name, { size: 34 })}<span class="sq-who"><b>${esc(them.name)}</b><small>${them.handle ? `@${esc(them.handle)}` : ""}</small></span></header>
    <ol class="sq-bubbles">${msgs.map((m) => `<li class="sq-bubble${m.author.kind === "company" ? " is-shop" : ""}${S.fresh.has(m.id) ? " is-new" : ""}"><p>${esc(plainText(m.text))}</p><small>${esc(fullTime(m.at))}</small></li>`).join("")}</ol>
    <form class="sq-reply sq-dm-form"><label class="sr" for="dmText">Message</label><textarea id="dmText" class="sq-reply-text" rows="1" maxlength="${CAPTION_MAX}" placeholder="Write back as the shop"></textarea><button class="btn small primary" type="submit" disabled><span>Send</span></button></form>`;
  const list = pane.querySelector(".sq-bubbles");
  list.scrollTop = list.scrollHeight;
  pane.querySelector(".sq-dm-back").addEventListener("click", () => pane.closest(".sq-dm").classList.remove("is-reading"));
  const form = pane.querySelector("form");
  const box = form.querySelector("textarea");
  const send = form.querySelector("button");
  box.addEventListener("input", () => { send.disabled = !box.value.trim(); box.style.height = "auto"; box.style.height = `${Math.min(140, box.scrollHeight)}px`; });
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    send.disabled = true;
    const r = await world.call("send_social_message", { thread: S.thread, text: box.value.trim() });
    if (!r.ok) { send.disabled = false; toast(r.error.message, { tone: "bad" }); return; }
    burst(send);
    await refresh();
    document.querySelector(".sq-dm")?.classList.add("is-reading");
  });
}

// ------------------------------------------------------------------ how the account is doing

function paintInsights(view) {
  if (!S.stats?.ok) {
    view.innerHTML = emptyState({ title: "No numbers yet.", text: "They appear once a day has been counted." });
    return;
  }
  const days = S.stats.data[NET].days.slice().reverse();
  const last = (n, k, off = 0) => days.slice(Math.max(0, days.length - n - off), days.length - off).reduce((a, d) => a + d[k], 0);
  const tiles = [
    { label: "Followers", value: S.stats.data[NET].followers_now, was: days.length > 7 ? days[days.length - 8].followers : null, change: true },
    { label: "Saw a post, last 7 days", value: last(7, "reach"), was: last(7, "reach", 7) },
    { label: "Likes and comments, last 7 days", value: last(7, "engagement"), was: last(7, "engagement", 7) },
    { label: "Pictures posted, last 30 days", value: last(30, "posts"), was: last(30, "posts", 30) },
  ];
  view.innerHTML = `<div class="sq-ins">
    <ul class="sq-ins-tiles">${tiles.map((t) => `<li><span class="sq-ins-label">${esc(t.label)}</span><b class="big-num">${whole(t.value)}</b>
      ${t.was == null ? "" : `<small class="sq-delta ${t.value >= t.was ? "is-up" : "is-down"}">${esc(deltaText(t.value, t.was, t.change))}</small>`}</li>`).join("")}</ul>
    <div class="sq-ins-charts">
      <section class="card"><h2 class="h3">Followers</h2><p class="muted small">Every day for the last ${esc(plural(days.length, "day"))}.</p>${chart({ rows: days, key: "followers", kind: "line", label: "Followers" })}</section>
      <section class="card"><h2 class="h3">People who saw a post</h2><p class="muted small">Each day.</p>${chart({ rows: days, key: "reach", kind: "bars", label: "Reach" })}</section>
      <section class="card"><h2 class="h3">Likes and comments</h2><p class="muted small">Each day.</p>${chart({ rows: days, key: "engagement", kind: "bars", label: "Likes and comments" })}</section>
    </div></div>`;
  wireCharts(view);
}

function deltaText(now, was, isTotal) {
  const d = now - was;
  if (isTotal) return d === 0 ? "Same as a week ago" : `${d > 0 ? "+" : "−"}${num(Math.abs(d))} on a week ago`;
  if (d === 0) return "Same as the week before";
  return `${d > 0 ? "+" : "−"}${num(Math.abs(d))} on the period before`;
}

// ------------------------------------------------------------------ staying live

function paintAll(opts) {
  paintProfile();
  paintTabs();
  paintView(opts);
}

let refreshing = null;
let again = false;

/**
 * Pulls the world again and redraws; whatever is new arrives with a flourish (see .is-new in app.css).
 * WHY the queue: a day passing fires both ot:day and onChange, and two reads at once would race.
 */
async function refresh() {
  if (refreshing) { again = true; return refreshing; }
  refreshing = redraw().finally(() => { refreshing = null; if (again) { again = false; refresh(); } });
  return refreshing;
}

async function redraw() {
  await load();
  S.convos = null;
  await loadConversations();
  paintAll();
  if (S.viewer) fillViewer(S.viewer.id, 0);
  // Only things that arrived on their own get a toast; what you just did already said so.
  const newPosts = S.arrived.filter((r) => r.kind === "post" && !S.mine.has(r.id));
  if (newPosts.length) toast(newPosts.length === 1 ? "A new post has arrived." : `${plural(newPosts.length, "new post")} have arrived.`);
}

document.getElementById("view").innerHTML = `<div class="sq-loading">${skeleton(6)}</div>`;
wireReactions(world);
await Promise.all([loadGrounds(), load()]);
await loadConversations();
paintAll({ arrive: true });

// N starts a new post from anywhere on the page, as long as nothing is being typed and nothing is open over it.
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || S.viewer || document.querySelector(".over")) return;
  if (e.target.closest?.("input, textarea, select")) return;
  if (e.key === "n") { e.preventDefault(); openComposer(); }
});

// The tab lives in the address, so back and forward (and a shared link) land on the same view.
window.addEventListener("hashchange", () => { const id = location.hash.slice(1); if (TABS.some((t) => t.id === id)) switchTab(id); });
document.addEventListener("ot:day", (e) => { if (!e.detail?.partial) refresh(); });
world.onChange((change) => { if (change.reset || change.entries.some((e) => !isScreenRead(e))) refresh(); });
