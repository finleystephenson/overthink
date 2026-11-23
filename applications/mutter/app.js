// Mutter: the shop's short-post account. A timeline of what the shop says and what is said to it, mentions,
// a post opened with its conversation, what is trending (the day's news), private messages, a 280-character
// composer that posts for real, and how the account is doing. Words first: quick, dry, no pictures needed.
import { startApp, esc, num, plural, avatar, emptyState, skeleton, slideOver, stagger, toast, countTo, pulse, node } from "../lib/ui.js";
import { spiral } from "../lib/icons.js";
import { isScreenRead } from "../lib/client.js";
import { loadTeam } from "../lib/people.js";
import { plainText, rememberName } from "../lib/plain.js";
import { readNetwork, childrenOf, talkCount, age, fullTime, glyph, outcomeStrip, fillOutcome, byLine, teamNames, reactControl, wireReactions, authorName, resolvePartners, chart, wireCharts, burst } from "../lib/social.js";

// The id of this app in applications/apps.json. Its name, colour and icon all come from there.
const APP_ID = "mutter";
const NET = "mutter";
const LIMIT = 280;
const PAGE = 40;
const VIEWS = [
  { id: "timeline", label: "Timeline", icon: "feed" },
  { id: "mentions", label: "Mentions", icon: "at" },
  { id: "trending", label: "In the news", icon: "hash" },
  { id: "messages", label: "Messages", icon: "mail" },
  { id: "insights", label: "How it is going", icon: "chart" },
];

const { world, app } = await startApp({ id: APP_ID });
document.title = `${app.name} · Overthought & Co.`;

/** Everything the screen knows, refreshed from the world on every change. */
const S = {
  view: VIEWS.some((v) => `#${v.id}` === location.hash) ? location.hash.slice(1) : "timeline",
  records: [], kids: new Map(), byId: new Map(), now: null, failed: null, known: null, fresh: new Set(), freshUntil: new Map(), arrived: [],
  news: [], names: new Map(), stats: null, convos: null, thread: null, open: null, shown: PAGE, draft: "",
};

// ------------------------------------------------------------------ reading the world

async function load() {
  const [net, clock, news] = await Promise.all([
    readNetwork(world, NET), world.clock(), world.call("list_news", { limit: 12 }, { screen: true }).catch(() => ({ ok: false })),
  ]);
  S.now = clock.now;
  S.news = news.ok ? news.data.news : [];
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
  const dms = await world.call("list_social_messages", { network: NET, limit: 60 }, { screen: true });
  S.convos = dms.ok ? dms.data.conversations : [];
  await resolvePartners(world, S.convos, S.records);
  // Who wrote each company post: the post carries a staff id, the team says whose it is.
  S.names = teamNames(await loadTeam(world).catch(() => []));
}

const topLevel = () => S.records.filter((r) => r.kind === "post");
const mentions = () => S.records.filter((r) => r.author.kind === "customer");
/** Whole numbers while a figure counts up. */
const whole = (v) => num(Math.round(v));

// ------------------------------------------------------------------ the rail

function paintRail() {
  const rail = document.getElementById("rail");
  const waiting = S.convos ? S.convos.filter((c) => !c.answered).length : 0;
  const followers = S.stats?.ok ? S.stats.data[NET].followers_now : null;
  // The business's own identity heads the column (its spiral, its name in its face), then plain tabs with an underline.
  rail.innerHTML = `
    <div class="mu-me">
      <span class="mu-co" style="--s:48px" aria-hidden="true">${spiral({ size: 26 })}</span>
      <span class="mu-me-text"><b class="mu-name">Overthought &amp; Co.</b><small>@overthoughtco${followers == null ? "" : ` · ${esc(num(followers))} followers`}</small></span>
      <button class="btn primary small mu-say" id="say" title="Write a post (N)">New post</button>
    </div>
    <nav class="mu-tabs" aria-label="Views">${VIEWS.map((v) => `<a class="mu-tab${v.id === S.view ? " is-on" : ""}" href="#${v.id}" aria-current="${v.id === S.view ? "page" : "false"}">
      ${esc(v.label)}${v.id === "messages" && waiting ? `<small class="mu-waiting" title="${esc(plural(waiting, "conversation"))} waiting for an answer">${waiting}</small>` : ""}</a>`).join("")}</nav>`;
  rail.querySelector("#say")?.addEventListener("click", writePost);
}

/** Takes you to the box at the top of the timeline, ready to type. */
function writePost() {
  if (S.view !== "timeline" || S.open) { S.open = null; go("timeline"); }
  requestAnimationFrame(() => document.getElementById("composeText")?.focus());
}

function go(view) {
  S.open = null;
  S.view = view;
  if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
  paintRail();
  paintCol({ arrive: true });
  window.scrollTo({ top: 0 });
}

// ------------------------------------------------------------------ the centre column

async function paintCol({ arrive = false } = {}) {
  const col = document.getElementById("col");
  if (S.failed) { col.innerHTML = emptyState({ title: "The account did not load.", text: "Try again in a moment." }); return; }
  // On a phone the floating write button would sit on top of the reply box, so it steps aside in a thread.
  document.getElementById("main").classList.toggle("is-thread", Boolean(S.open));
  if (S.open) { await paintThread(col); return; }
  if (S.view === "timeline") paintTimeline(col);
  else if (S.view === "mentions") paintMentions(col);
  else if (S.view === "trending") paintTrending(col);
  else if (S.view === "messages") await paintMessages(col);
  else paintInsights(col);
}

/** One quiet line under the tabs saying what a view holds. The tab already names it, so there is no title. */
function head(title, sub = "") {
  return sub ? `<p class="mu-sub" aria-label="${esc(title)}">${esc(sub)}</p>` : "";
}

function paintTimeline(col) {
  const posts = topLevel();
  const shown = posts.slice(0, S.shown);
  col.innerHTML = `${head("Timeline")}${composer()}
    <ol class="mu-list">${shown.map((p) => row(p)).join("")}</ol>
    ${posts.length > shown.length ? '<button class="btn ghost mu-older" id="older">Show older</button>' : ""}`;
  wireComposer(col);
  wireRows(col);
  col.querySelector("#older")?.addEventListener("click", () => { S.shown += PAGE; paintTimeline(col); });
}

function paintMentions(col) {
  const list = mentions().slice(0, 80);
  col.innerHTML = `${head("Mentions", "Customers' posts that name the shop, and their replies to it.")}
    ${list.length ? `<ol class="mu-list">${list.map((p) => row(p, { context: true })).join("")}</ol>`
    : emptyState({ title: "Nobody has mentioned the shop.", text: "When they do, it lands here." })}`;
  wireRows(col);
}

/** One line of the stream: who, when, what, and the counts the record holds. */
function row(p, { context = false } = {}) {
  const parent = p.parent ? S.byId.get(p.parent) : null;
  const talk = talkCount(p.id, S.kids);
  return `<li class="mu-row${p.author.kind === "company" ? " is-shop" : ""}${S.fresh.has(p.id) ? " is-new" : ""}">
    <button class="mu-hit" data-open="${esc(p.id)}" aria-label="Open the post by ${esc(p.author.name)}, ${esc(age(p.at, S.now))} ago"></button>
    <div class="mu-row-body">
      <p class="mu-byline">${p.author.kind === "company" ? `<span class="mu-mini" aria-hidden="true">${spiral({ size: 14 })}</span>` : ""}<b>${esc(p.author.name)}</b><span>@${esc(p.author.handle)}</span><time>${esc(age(p.at, S.now))}</time>${byLine(p, S.names)}</p>
      ${context && parent ? `<p class="mu-context">Replying to @${esc(parent.author.handle)}</p>` : ""}
      <p class="mu-text">${linkify(said(p))}</p>
      <p class="mu-counts">
        <span class="react is-static" title="Replies">${glyph("talk", 17)}<b>${talk ? num(talk) : ""}</b></span>
        ${reactControl(p, "repost", { network: NET, zero: false })}
        ${reactControl(p, "like", { network: NET, zero: false })}
      </p>
    </div></li>`;
}

/** Handles in a post are coloured, the way a short-post feed shows who is being spoken to. */
function linkify(text) {
  return esc(text).replace(/@([a-z0-9_.]+[a-z0-9_])/gi, '<span class="mu-at">@$1</span>');
}

/** What a record says, in plain words: the text is written by the data and may hold order codes. */
function said(r) {
  return plainText(r.text);
}

function authorAvatar(p, size) {
  return p.author.kind === "company"
    ? `<span class="mu-co" style="--s:${size}px" aria-hidden="true">${spiral({ size: Math.round(size * 0.58) })}</span>`
    : avatar(p.author.name, { size });
}

function wireRows(col) {
  col.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openPost(b.dataset.open)));
}

// ------------------------------------------------------------------ the composer

/** The box at the top of the timeline, or the reply box under an opened post. */
function composer({ replyTo = null } = {}) {
  return `<form class="mu-compose${replyTo ? " is-reply" : ""}" ${replyTo ? `data-reply="${esc(replyTo)}"` : ""}>
    <div class="mu-compose-main">
      <label class="sr" for="composeText">${replyTo ? "Your reply" : "Your post"}</label>
      <textarea id="composeText" rows="${replyTo ? 2 : 3}" placeholder="${replyTo ? "Reply as the shop" : "Say it plainly."}">${esc(replyTo ? "" : S.draft)}</textarea>
      <div class="mu-compose-foot">
        <span class="mu-ring" aria-hidden="true"><b class="mu-ring-left"></b></span>
        <span class="mu-left sr" aria-live="polite"></span>
        <span class="mu-keys"><kbd>⌘</kbd> <kbd>Enter</kbd> ${replyTo ? "replies" : "posts"}</span>
        <button class="btn primary small" type="submit" disabled>${replyTo ? "Reply" : "Post"}</button>
      </div>
    </div>
  </form>`;
}

/** The ring fills as the post grows; it turns warm near the limit and shows what is left; past it, the button waits. */
function wireComposer(scope) {
  const form = scope.querySelector(".mu-compose");
  if (!form) return;
  const box = form.querySelector("textarea");
  const send = form.querySelector("button[type=submit]");
  const ring = form.querySelector(".mu-ring");
  const left = form.querySelector(".mu-ring-left");
  const said = form.querySelector(".mu-left");
  function update() {
    const n = box.value.length;
    const rest = LIMIT - n;
    ring.classList.toggle("is-near", rest <= 20 && rest >= 0);
    ring.classList.toggle("is-over", rest < 0);
    ring.classList.toggle("is-empty", n === 0);
    // A plain count in mono: what is used out of 280. It turns warm only near the limit.
    left.textContent = `${num(n)} / ${LIMIT}`;
    said.textContent = rest <= 20 ? `${rest} characters left` : "";
    send.disabled = !box.value.trim() || rest < 0;
    if (!form.dataset.reply) S.draft = box.value;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  }
  box.addEventListener("input", update);
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
  update();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = box.value.trim();
    send.disabled = true;
    const res = form.dataset.reply
      ? await world.call("reply_social_post", { post_id: form.dataset.reply, text })
      : await world.call("create_social_post", { network: NET, text });
    if (!res.ok) { send.disabled = false; toast(res.error.message, { tone: "bad" }); return; }
    burst(send, { count: 11 });
    // Clear the box first: a refresh leaves a half-typed reply alone, and this one is finished.
    box.value = "";
    if (!form.dataset.reply) S.draft = "";
    toast(form.dataset.reply ? "Replied." : "Posted. Move on a day to see what it did.", { tone: "good" });
    await refresh();
    // Open a new post at once: its results strip is where the test is read.
    if (!form.dataset.reply && res.data?.id) openPost(res.data.id);
  });
}

// ------------------------------------------------------------------ one post and its conversation

function openPost(id) {
  S.open = id;
  paintCol();
  window.scrollTo({ top: 0 });
}

/** The post large, the post it answers above it, what it did, a reply box, then every reply under it. */
async function paintThread(col) {
  const res = await world.call("get_social_post", { post_id: S.open }, { screen: true });
  if (!res.ok) { col.innerHTML = `${backBar()}${emptyState({ title: "This post has gone.", text: res.error.message })}`; wireBack(col); return; }
  const p = res.data;
  const chain = [];
  for (let up = S.byId.get(p.parent); up; up = S.byId.get(up.parent)) chain.unshift(up);
  const talk = talkCount(p.id, S.kids) || p.comments.length;
  const replies = flatten(p.id);
  col.innerHTML = `${backBar()}
    ${chain.length ? `<ol class="mu-list mu-chain">${chain.map((c) => row(c)).join("")}</ol>` : ""}
    <article class="mu-focus${p.author.kind === "company" ? " is-shop" : ""}">
      <header class="mu-focus-head">${authorAvatar(p, 48)}<span class="mu-who"><b>${authorName(p)}</b><small>@${esc(p.author.handle)}</small>${byLine(p, S.names)}</span></header>
      <p class="mu-focus-text">${linkify(said(p))}</p>
      <p class="mu-focus-time"><time>${esc(fullTime(p.at))}</time>${p.text.length ? ` · ${esc(plural(p.text.length, "character"))}` : ""}</p>
      ${p.author.kind === "customer" ? `<p class="mu-counts mu-focus-react">${reactControl(p, "repost", { network: NET, label: true })}${reactControl(p, "like", { network: NET, label: true })}</p>` : ""}
      ${outcomeStrip(p, { talk, network: NET, now: S.now })}
    </article>
    ${composer({ replyTo: p.id })}
    ${replies.length ? `<ol class="mu-list mu-replies">${replies.map(({ r, depth }) => `<li class="mu-nest" style="--depth:${Math.min(depth, 3)}"><ol class="mu-list">${row(r)}</ol></li>`).join("")}</ol>`
    : '<p class="mu-quiet">No replies yet.</p>'}`;
  fillOutcome(col);
  wireBack(col);
  wireComposer(col);
  wireRows(col);
}

/** Every reply under a post, depth-first, oldest first, so a conversation reads top to bottom. */
function flatten(id, depth = 0, out = []) {
  for (const r of S.kids.get(id) || []) { out.push({ r, depth }); flatten(r.id, depth + 1, out); }
  return out;
}

function backBar() {
  return `<header class="mu-head-back"><button class="btn ghost small" id="back" title="Back (Escape)">${glyph("back", 16)}<span>Back</span></button></header>`;
}

function wireBack(col) {
  col.querySelector("#back")?.addEventListener("click", () => { S.open = null; paintCol({ arrive: true }); });
}

// ------------------------------------------------------------------ trending (the day's news)

/** A trend: the section of the paper it is in, and its headline. Nothing counted that the record does not hold. */
function trend(n, i) {
  return `<li><button class="mu-trend" data-news="${esc(n.id)}">
    <small>${i + 1} · Trending in ${esc(n.section)} · ${esc(age(n.at, S.now))}</small><b>${esc(plainText(n.headline))}</b></button></li>`;
}

/** The old side box of news is gone: "In the news" is a tab now, so the column stays single and calm. */
function paintSide() {
  const side = document.getElementById("side");
  if (!side) return;
  const list = S.news.slice(0, 5);
  side.innerHTML = `<section class="mu-box">
      <h2 class="mu-box-title">What is happening</h2>
      ${list.length ? `<ol class="mu-trends">${list.map(trend).join("")}</ol><a class="mu-box-more" href="#trending">Show more</a>`
    : '<p class="mu-quiet">A quiet day in the papers.</p>'}
    </section>`;
  wireTrends(side);
}

function paintTrending(col) {
  col.innerHTML = `${head("Trending", "What people are into this week, and what the papers are saying. Open a story to read it, or to say something about it.")}
    <section class="mu-interest" id="mu-interest" aria-label="What people are into"></section>
    ${S.news.length ? `<ol class="mu-list mu-trend-list">${S.news.map(trend).join("")}</ol>` : emptyState({ title: "Nothing trending.", text: "The papers have gone quiet." })}`;
  wireTrends(col);
  paintInterest(col.querySelector("#mu-interest"));
}

/**
 * The world's trends (list_trends): interest in each kind of thing against normal (100), and how people feel about
 * the shop. WHY on Mutter: this is the network where talk turns into fashions; the same index moves demand in the
 * simulation, so a rising topic here is a rising category in the shop.
 */
async function paintInterest(box) {
  if (!box) return;
  const res = await world.call("list_trends", { weeks: 2 }, { screen: true });
  if (!res.ok || !box.isConnected) return;
  const rows = res.data.trends.slice().sort((a, b) => b.interest_now - a.interest_now);
  const change = (t) => { const w = t.weeks || []; return w.length > 1 ? t.interest_now - w[w.length - 2].interest : 0; };
  const op = res.data.opinion;
  box.innerHTML = `<ol class="mu-list mu-interest-list">${rows.map((t) => `<li class="mu-interest-row"><b>${esc(t.in_words)}</b>
    <span>${t.interest_now > 105 ? "Talked about more than usual" : t.interest_now < 95 ? "Quieter than usual" : "About as usual"}${change(t) ? `, ${change(t) > 0 ? "up" : "down"} ${Math.abs(change(t))} this week` : ""}</span>
    <span class="mu-interest-n">${esc(t.interest_now)}</span></li>`).join("")}</ol>
    ${op ? `<p class="mu-quiet">How people feel about the shop lately: ${op.sentiment > 0.15 ? "warm" : op.sentiment < -0.15 ? "cooler than usual" : "mixed"}, from ${esc(op.reviews)} reviews, ${esc(op.complaints)} complaints and what people posted.</p>` : ""}`;
}

function wireTrends(scope) {
  scope.querySelectorAll("[data-news]").forEach((b) => b.addEventListener("click", () => openNews(b.dataset.news)));
}

/** The story behind a trend, with a way to post about it. */
async function openNews(id) {
  const res = await world.call("get_news_item", { id }, { screen: true });
  if (!res.ok) { toast(res.error.message, { tone: "bad" }); return; }
  const n = res.data;
  const body = node(`<div class="mu-story">
    <p class="mu-story-section">${esc(n.section)} · ${esc(fullTime(n.at))}</p>
    <h3 class="mu-story-head">${esc(plainText(n.headline))}</h3>
    <p class="mu-story-text">${esc(plainText(n.story))}</p>
    <button class="btn primary" data-say><span>Say something about it</span></button>
  </div>`);
  const over = slideOver({ title: "In the news", body });
  body.querySelector("[data-say]")?.addEventListener("click", () => {
    over.close();
    S.draft = `On "${plainText(n.headline)}": `.slice(0, LIMIT);
    go("timeline");
    requestAnimationFrame(() => { const box = document.getElementById("composeText"); if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } });
  });
}

// ------------------------------------------------------------------ messages

async function paintMessages(col) {
  if (!S.convos.length) {
    col.innerHTML = `${head("Messages")}${newMessageBar()}${emptyState({ title: "No messages.", text: "Nobody has written to the shop privately here yet." })}`;
    wireNewMessage(col);
    return;
  }
  if (!S.thread || !S.convos.some((c) => c.thread === S.thread)) S.thread = S.convos[0].thread;
  col.innerHTML = `${head("Messages")}${newMessageBar()}<div class="mu-dm">
    <ol class="mu-dm-list">${S.convos.map((c) => `<li><button class="mu-dm-row${c.thread === S.thread ? " is-on" : ""}${c.answered ? "" : " is-waiting"}" data-thread="${esc(c.thread)}">
      ${avatar(c.who.name, { size: 36 })}<span class="mu-who"><b>${esc(c.who.name)}</b><small>${esc(plainText(c.last_text))}</small></span><time>${esc(age(c.last_at, S.now))}</time></button></li>`).join("")}</ol>
    <section class="mu-dm-pane" id="dmPane">${skeleton(3)}</section></div>`;
  col.querySelectorAll("[data-thread]").forEach((b) => b.addEventListener("click", () => {
    S.thread = b.dataset.thread;
    col.querySelectorAll("[data-thread]").forEach((x) => x.classList.toggle("is-on", x === b));
    col.querySelector(".mu-dm").classList.add("is-reading");
    paintDm();
  }));
  wireNewMessage(col);
  await paintDm();
}

/** The "New message" button above the conversations. */
function newMessageBar() {
  return `<div class="mu-dm-bar"><button class="btn small" id="newMsg">${glyph("plus", 16)}<span>New message</span></button></div>`;
}

function wireNewMessage(col) {
  col.querySelector("#newMsg")?.addEventListener("click", openNewMessage);
}

/** People who have posted, replied or mentioned the shop, newest first, one row each. */
function knownCustomers() {
  const seen = new Map();
  for (const r of S.records) if (r.author.kind === "customer" && !seen.has(r.author.handle)) seen.set(r.author.handle, r.author);
  return [...seen.values()];
}

/** Starts a conversation with a customer by handle: pick someone who has been in touch, or type a handle. */
function openNewMessage() {
  const people = knownCustomers().slice(0, 40);
  const body = node(`<form class="mu-newmsg">
    <label class="field"><span>To</span><input class="input" name="handle" list="muHandles" autocomplete="off" placeholder="Pick someone or type a handle">
      <datalist id="muHandles">${people.map((a) => `<option value="${esc(a.handle)}">${esc(a.name)}</option>`).join("")}</datalist></label>
    ${people.length ? `<ul class="mu-people" aria-label="People who have been in touch">${people.slice(0, 8).map((a) => `<li><button type="button" class="mu-person" data-handle="${esc(a.handle)}">${avatar(a.name, { size: 26 })}<span>${esc(a.name)}</span></button></li>`).join("")}</ul>` : ""}
    <label class="field"><span>Message</span><textarea class="textarea" rows="4" maxlength="${LIMIT}" placeholder="Write as the shop"></textarea></label>
    <div class="mu-newmsg-foot"><span class="muted small">Sent as the shop.</span>
      <button class="btn primary" type="submit" disabled><span>Send</span></button></div>
  </form>`);
  const over = slideOver({ title: "New message", body });
  const handle = body.querySelector("input");
  const text = body.querySelector("textarea");
  const send = body.querySelector("button[type=submit]");
  const ready = () => { send.disabled = !handle.value.trim() || !text.value.trim(); };
  handle.addEventListener("input", ready);
  text.addEventListener("input", ready);
  body.querySelectorAll(".mu-person").forEach((b) => b.addEventListener("click", () => { handle.value = b.dataset.handle; ready(); text.focus(); }));
  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    send.disabled = true;
    const res = await world.call("send_social_message", { network: NET, handle: handle.value.trim().replace(/^@/, ""), text: text.value.trim() });
    if (!res.ok) { ready(); toast(res.error.message, { tone: "bad" }); return; }
    burst(send);
    over.close();
    toast("Message sent.", { tone: "good" });
    await refresh();
    // Open the new conversation once the list holds it (a read in flight may not have seen it yet).
    if (res.data?.thread && S.convos?.some((c) => c.thread === res.data.thread)) S.thread = res.data.thread;
    go("messages");
  });
}

async function paintDm() {
  const pane = document.getElementById("dmPane");
  if (!pane) return;
  const res = await world.call("list_social_messages", { thread: S.thread }, { screen: true });
  if (!res.ok) { pane.innerHTML = emptyState({ title: "This conversation has gone.", text: res.error.message }); return; }
  const msgs = res.data.messages;
  const them = msgs.find((m) => m.author.kind === "customer")?.author || S.convos?.find((c) => c.thread === S.thread)?.who || { name: "A customer", handle: "" };
  pane.innerHTML = `<header class="mu-dm-head"><button class="btn small icon-only ghost mu-dm-back" aria-label="Back to all messages">${glyph("back", 18)}</button>
      <span class="mu-who"><b>${esc(them.name)}</b><small>${them.handle ? `@${esc(them.handle)}` : ""}</small></span></header>
    <ol class="mu-lines">${msgs.map((m) => `<li class="mu-line${m.author.kind === "company" ? " is-shop" : ""}${S.fresh.has(m.id) ? " is-new" : ""}">
      <span class="mu-line-who">${m.author.kind === "company" ? "Shop" : esc(them.name.split(" ")[0])}</span><p>${esc(plainText(m.text))}</p><time>${esc(age(m.at, S.now))}</time></li>`).join("")}</ol>
    <form class="mu-dm-form"><label class="sr" for="dmText">Message</label><textarea id="dmText" rows="1" maxlength="${LIMIT}" placeholder="Write back as the shop"></textarea><button class="btn small primary" type="submit" disabled><span>Send</span></button></form>`;
  const lines = pane.querySelector(".mu-lines");
  lines.scrollTop = lines.scrollHeight;
  pane.querySelector(".mu-dm-back").addEventListener("click", () => pane.closest(".mu-dm").classList.remove("is-reading"));
  const form = pane.querySelector("form");
  const box = form.querySelector("textarea");
  const send = form.querySelector("button");
  box.addEventListener("input", () => { send.disabled = !box.value.trim(); });
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!send.disabled) form.requestSubmit(); } });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    send.disabled = true;
    const r = await world.call("send_social_message", { thread: S.thread, text: box.value.trim() });
    if (!r.ok) { send.disabled = false; toast(r.error.message, { tone: "bad" }); return; }
    burst(send);
    await refresh();
    document.querySelector(".mu-dm")?.classList.add("is-reading");
  });
}

// ------------------------------------------------------------------ how the account is doing

function paintInsights(col) {
  if (!S.stats?.ok) {
    col.innerHTML = emptyState({ title: "No numbers yet.", text: "They appear once a day has been counted." });
    return;
  }
  const days = S.stats.data[NET].days.slice().reverse();
  const sum = (n, k, off = 0) => days.slice(Math.max(0, days.length - n - off), days.length - off).reduce((a, d) => a + d[k], 0);
  const lines = [
    { label: "Followers", value: S.stats.data[NET].followers_now, was: days.length > 7 ? days[days.length - 8].followers : null, note: "a week ago" },
    { label: "Saw a post, last 7 days", value: sum(7, "reach"), was: sum(7, "reach", 7), note: "the week before" },
    { label: "Likes, reposts and replies, last 7 days", value: sum(7, "engagement"), was: sum(7, "engagement", 7), note: "the week before" },
    { label: "Posts, last 30 days", value: sum(30, "posts"), was: sum(30, "posts", 30), note: "the month before" },
  ];
  col.innerHTML = `
    <ul class="mu-ins">${lines.map((l) => `<li><span class="mu-ins-label">${esc(l.label)}</span><b class="big-num">${whole(l.value)}</b>
      ${l.was == null ? "" : `<small>${l.value === l.was ? "same as" : `${l.value > l.was ? "+" : "−"}${esc(num(Math.abs(l.value - l.was)))} on`} ${esc(l.note)}</small>`}</li>`).join("")}</ul>
    <section class="mu-chart"><h2 class="mu-chart-title">Followers</h2>${chart({ rows: days, key: "followers", kind: "line", label: "Followers" })}</section>
    <section class="mu-chart"><h2 class="mu-chart-title">People who saw a post, each day</h2>${chart({ rows: days, key: "reach", kind: "bars", label: "Reach" })}</section>
    <section class="mu-chart"><h2 class="mu-chart-title">Likes, reposts and replies, each day</h2>${chart({ rows: days, key: "engagement", kind: "bars", label: "Likes, reposts and replies" })}</section>`;
  wireCharts(col);
}

// ------------------------------------------------------------------ staying live

let refreshing = null;
let again = false;

/**
 * Pulls the world again and redraws; whatever is new drops in at the top (see .is-new in app.css).
 * WHY the queue: a day passing fires both ot:day and onChange, and two reads at once would race.
 */
async function refresh() {
  if (refreshing) { again = true; return refreshing; }
  refreshing = redraw().finally(() => { refreshing = null; if (again) { again = false; refresh(); } });
  return refreshing;
}

async function redraw() {
  const typing = document.activeElement?.id === "composeText" ? document.activeElement.value : null;
  await load();
  paintRail();
  // Never wipe what someone is typing in a reply because something else happened.
  if (typing && S.open) return;
  await paintCol();
  paintSide();
  const arrivals = S.arrived.filter((r) => r.author.kind === "customer");
  if (arrivals.length) toast(arrivals.length === 1 ? "Someone has said something to the shop." : `${plural(arrivals.length, "new mention")}.`);
}

/**
 * The keyboard, as in Letterbox. Keys act only when you are not typing (Escape leaves the box).
 *   J or Down: next post   K or Up: previous   Enter: open it   Escape: back   N: write a post   R: reply to the open post
 */
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".over")) return;
  if (e.target.closest?.("input, textarea, select")) {
    if (e.key === "Escape") e.target.blur();
    return;
  }
  const hits = [...document.querySelectorAll("#col .mu-hit")];
  const at = hits.indexOf(document.activeElement);
  const step = (d) => {
    const next = hits[at < 0 ? 0 : Math.max(0, Math.min(hits.length - 1, at + d))];
    if (!next) return;
    next.focus({ preventScroll: true });
    next.closest("li").scrollIntoView({ block: "nearest" });
  };
  const keys = {
    j: () => step(1), ArrowDown: () => step(1), k: () => step(-1), ArrowUp: () => step(-1),
    n: writePost, r: () => document.getElementById("composeText")?.focus(),
    Escape: () => { if (S.open) { S.open = null; paintCol(); } },
  };
  const run = keys[e.key];
  if (!run || (e.key === "r" && !S.open)) return;
  e.preventDefault();
  run();
});

window.addEventListener("hashchange", () => { const id = location.hash.slice(1); if (VIEWS.some((v) => v.id === id)) go(id); });

wireReactions(world);
document.getElementById("col").innerHTML = skeleton(8);
await load();
paintRail();
await paintCol({ arrive: true });
paintSide();

document.addEventListener("ot:day", (e) => { if (!e.detail?.partial) refresh(); });
world.onChange((change) => { if (change.reset || change.entries.some((e) => !isScreenRead(e))) refresh(); });
