// Parts both social apps (Squint and Mutter) share: reading a whole network, small icons,
// the drawn stand-in for a customer's picture, the "what this post did" strip and the account charts.
// WHY in lib/: both apps must read the network and draw a post's results the same way.
import { plainText } from "./plain.js";
import { esc, num, shortDate, timeParts, colourFor, initials, reducedMotion, avatar, toast, countTo } from "./ui.js";

// ------------------------------------------------------------------ reading

/**
 * Every post, comment and reply on one network, newest first, paging back with `before`.
 * WHY page: a picture grid needs comment counts for every post, and one call returns at most 100 records.
 * @param {object} world the client
 * @param {string} network squint or mutter
 * @param {{maxPages?: number}=} options
 * @return {Promise<{ok: boolean, records?: Array<object>, error?: object}>}
 */
export async function readNetwork(world, network, { maxPages = 12 } = {}) {
  const records = [];
  const seen = new Set();
  let before;
  for (let page = 0; page < maxPages; page++) {
    const res = await world.call("list_social_posts", { network, limit: 100, ...(before ? { before } : {}) }, { screen: true })
      // A refused read comes back as a failed result, not a crash.
      .catch((e) => ({ ok: false, error: { code: e.code || "refused", message: e.message } }));
    if (!res.ok) return res;
    const batch = res.data.posts.filter((p) => !seen.has(p.id));
    batch.forEach((p) => { seen.add(p.id); records.push(p); });
    if (res.data.posts.length < 100) break;
    before = res.data.posts.at(-1).at;
  }
  return { ok: true, records };
}

/**
 * Groups records under the post they answer, so replies to comments sit under their comment.
 * @param {Array<object>} records
 * @return {Map<string, Array<object>>} parent id to children, oldest first
 */
export function childrenOf(records) {
  const map = new Map();
  for (const r of records) {
    if (!r.parent) continue;
    if (!map.has(r.parent)) map.set(r.parent, []);
    map.get(r.parent).push(r);
  }
  for (const list of map.values()) list.sort((a, b) => (a.at < b.at ? -1 : 1));
  return map;
}

/** How many comments and replies sit under a post, at any depth. */
export function talkCount(id, kids) {
  return (kids.get(id) || []).reduce((n, c) => n + 1 + talkCount(c.id, kids), 0);
}

// ------------------------------------------------------------------ time

/**
 * A short age for a record against the simulated clock: "now", "4m", "3h", "2d", or a date once it is old.
 * @param {string} at
 * @param {string} now
 */
export function age(at, now) {
  const mins = Math.max(0, Math.round((Date.parse(now) - Date.parse(at)) / 6e4));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  if (mins < 60 * 24 * 7) return `${Math.round(mins / 1440)}d`;
  const p = timeParts(at);
  return Date.parse(now) - Date.parse(at) > 300 * 864e5 ? `${p.day} ${p.monthShort} ${p.year}` : shortDate(at);
}

/** "Thursday 19 November, 11:47" for the full time under an opened post. */
export function fullTime(at) {
  const p = timeParts(at);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.time}`;
}

// ------------------------------------------------------------------ icons

const GLYPH = {
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.3C19.5 15.4 12 20 12 20Z"/>',
  talk: '<path d="M4.5 11.5a7.5 7 0 1 1 3.6 6L4.5 19l1.2-3.4a6.7 6.7 0 0 1-1.2-4.1Z"/>',
  repost: '<path d="M6 9.5 9 6.5l3 3M9 6.5v8a3 3 0 0 0 3 3h3M18 14.5l-3 3-3-3M15 17.5v-8a3 3 0 0 0-3-3H9"/>',
  send: '<path d="M4.5 12 19.5 5l-4 14-3.5-5.5Z"/><path d="m12 13.5 7.5-8.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  grid: '<rect x="4.5" y="4.5" width="6" height="6" rx="1.4"/><rect x="13.5" y="4.5" width="6" height="6" rx="1.4"/><rect x="4.5" y="13.5" width="6" height="6" rx="1.4"/><rect x="13.5" y="13.5" width="6" height="6" rx="1.4"/>',
  feed: '<rect x="5" y="4.5" width="14" height="9" rx="2"/><path d="M5 17h14M5 20h9"/>',
  tag: '<path d="M4.5 4.5h7l8 8-7 7-8-8Z"/><circle cx="8.5" cy="8.5" r="1.3"/>',
  mail: '<path d="M4.5 6.5h15v11h-15Z"/><path d="m4.5 7 7.5 6 7.5-6"/>',
  chart: '<path d="M4.5 19.5h15"/><path d="M7.5 16v-4M12 16V8M16.5 16v-6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  door: '<path d="M6 20V4.5h10V20M4 20h16"/><circle cx="13" cy="12.5" r=".9" fill="currentColor"/>',
  bag: '<path d="M5.5 8.5h13l-1 11h-11Z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
  at: '<circle cx="12" cy="12" r="3.5"/><path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.3 6.7"/>',
  hash: '<path d="M9.5 4.5 8 19.5M16 4.5l-1.5 15M5 9h14.5M4.5 15H19"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="m14.5 6-6 6 6 6"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
};

/** A small line icon from the social set. */
export function glyph(name, size = 18) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[name] || ""}</svg>`;
}

// ------------------------------------------------------------------ the stand-in for a customer's picture

/** A steady number from a string, so the same post always draws the same picture. */
function hashOf(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

const PATTERNS = ["rings", "stripes", "dots", "waves", "sun"];

/**
 * A drawn picture for a customer's post: their colour, a pattern picked from the post, and their initials.
 * WHY: customers' photos are not stored, and a stock photo would be a lie. This says "someone's picture" honestly.
 * @param {{name: string, seed: string, label?: string}} p label is a few words shown like a sticker (a product name)
 * @return {string} an SVG element
 */
export function standIn({ name, seed, label = "" }) {
  // The calm look: one quiet tint, a fine ink pattern and the initials. No candy colours, no gloss (applications/DESIGN.md).
  const h = hashOf(seed);
  const base = "var(--x-tint, #E7ECF5)";
  const second = "var(--x-rule, #CFD7E6)";
  const kind = PATTERNS[h % PATTERNS.length];
  const rot = (h >> 3) % 360;
  const id = `si${h.toString(36)}`;
  const shapes = {
    rings: [0, 1, 2, 3, 4, 5].map((i) => `<circle cx="${70 + (h % 60)}" cy="${60 + ((h >> 5) % 80)}" r="${30 + i * 34}" fill="none" stroke="${second}" stroke-width="13" opacity="${0.75 - i * 0.1}"/>`).join(""),
    stripes: `<g transform="rotate(${rot} 150 150)">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<rect x="-80" y="${i * 52 - 90}" width="460" height="24" fill="${second}" opacity=".7"/>`).join("")}</g>`,
    dots: Array.from({ length: 36 }, (_, i) => `<circle cx="${(i % 6) * 54 + 24 + ((i / 6) % 2 ? 26 : 0)}" cy="${Math.floor(i / 6) * 54 + 24}" r="${9 + ((h >> (i % 20)) & 7)}" fill="${second}" opacity=".8"/>`).join(""),
    waves: [0, 1, 2, 3, 4, 5].map((i) => `<path d="M-20 ${70 + i * 44} q 40 -34 80 0 t 80 0 t 80 0 t 80 0" fill="none" stroke="${second}" stroke-width="15" stroke-linecap="round" opacity=".75"/>`).join(""),
    sun: `<g transform="rotate(${rot} 150 150)">${Array.from({ length: 12 }, (_, i) => `<path d="M150 150 L${150 + 260 * Math.cos((i * Math.PI) / 6)} ${150 + 260 * Math.sin((i * Math.PI) / 6)} L${150 + 260 * Math.cos(((i + 0.5) * Math.PI) / 6)} ${150 + 260 * Math.sin(((i + 0.5) * Math.PI) / 6)}Z" fill="${second}" opacity=".55"/>`).join("")}</g><circle cx="150" cy="150" r="58" fill="${base}"/>`,
  };
  const sticker = label
    ? `<text x="150" y="246" text-anchor="middle" font-family="Geist, sans-serif" font-weight="500" font-size="15" style="fill:var(--x-ink-2, #55607A)">${esc(label.length > 30 ? `${label.slice(0, 29)}…` : label)}</text>`
    : "";
  return `<svg class="stand-in" viewBox="0 0 300 300" preserveAspectRatio="xMidYMid slice" role="img" aria-label="A drawn stand-in for ${esc(name)}'s picture">
    <g style="fill:${base};stroke:${second}"><rect width="300" height="300" style="stroke:none"/></g>
    <g style="color:${second}" data-pattern="${id}">${shapes[kind].replaceAll(`"${second}"`, '"currentColor"')}</g>
    <text x="150" y="${label ? 172 : 176}" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif" font-weight="600" font-size="64" letter-spacing="-2" style="fill:var(--x-ink, #0B1730)">${esc(initials(name))}</text>${sticker}
  </svg>`;
}

// ------------------------------------------------------------------ what this post did

/** What the audience has done so far, and the whole expected response, from the post's `audience` (written once time moves on). */
function audienceOf(post) {
  const a = post.audience;
  return a && a.shown && a.plan ? a : null;
}

/** A figure as a whole number, or "" when there is none. */
const whole = (v) => (Number.isFinite(v) ? Math.round(v) : null);

/**
 * Why the post did as it did, in plain words, from the audience's factors. Only what moved the result, best first.
 * @param {object} a the post's audience
 * @return {Array<{up: boolean, text: string}>}
 */
export function whyLines(a) {
  const f = a.factors || {};
  const out = [];
  const add = (up, text) => out.push({ up, text });
  // Whether the writing itself was scored, and what that did: said first, because it is the one thing a judge sets.
  if (a.quality?.judged) add(f.quality >= 1, `The writing was scored ${Math.round(a.quality.score * 10)} out of 10, so ${f.quality >= 1 ? "more" : "fewer"} people liked it`);
  if (a.offer) add(true, "Has an offer, so more people clicked and bought");
  if (f.event > 1) add(true, "Fits what is happening in the world right now");
  if (f.hour > 1.05) add(true, "Posted at a good time of day"); else if (f.hour < 0.95) add(false, "Posted at a quiet time of day");
  if (f.weekday > 1.05) add(true, "A good day of the week"); else if (f.weekday < 0.95) add(false, "A quiet day of the week");
  if (f.picture > 1) add(true, "The picture helped it get seen");
  if (f.product > 1) add(true, "Names a product, so visitors went straight to it");
  if (f.length < 1) add(false, "The wording was too short or too long, so fewer people saw it");
  if (f.fatigue < 0.95) add(false, "Several posts close together, so each reached fewer people");
  if (f.luck > 1.2) add(true, "It was shared more than expected"); else if (f.luck < 0.8) add(false, "It was shared less than expected");
  return out.slice(0, 6);
}

/**
 * The strip under an opened company post: what the audience has done so far, filling toward the plan, and why.
 * Nothing is shown as a number until the simulator has counted it; call fillOutcome() after every paint.
 * WHY nothing for a customer's post: reach, visits and orders are counted for the shop's own posts only.
 * @param {object} post a post from get_social_post
 * @param {{talk: number, network: string, now: ?string}} p talk is comments and replies counted from the thread;
 *     now (the sandbox time) tells a post from before the test began, which is never counted, from one not counted yet
 */
export function outcomeStrip(post, { talk, network, now = null }) {
  if (post.author?.kind !== "company") return "";
  const a = audienceOf(post);
  const shown = a?.shown || {}, plan = a?.plan || {};
  const row = (key, label, value, goal) => ({ key, label, value, goal: Number.isFinite(goal) && whole(goal) > whole(value) ? whole(goal) : null });
  const rows = [
    row("reach", "People who saw it", a ? whole(shown.reach ?? 0) : null, plan.reach),
    row("likes", "Likes", Math.max(post.likes ?? 0, whole(shown.likes) ?? 0), plan.likes),
    ...(network === "mutter" ? [row("reposts", "Reposts", Math.max(post.reposts ?? 0, whole(shown.reposts) ?? 0), plan.reposts)] : []),
    row("talk", network === "mutter" ? "Replies" : "Comments", talk, null),
    row("visits", "Visits to the shop", a ? whole(shown.visits ?? 0) : null, plan.visits),
    row("orders", "Orders", a ? whole(shown.orders ?? 0) : null, plan.orders),
  ];
  const before = !a && now && Date.parse(now) - Date.parse(post.at) > 864e5;
  const why = a ? whyLines(a) : [];
  if (a && !a.quality?.judged) why.push({ up: null, text: "The writing was not scored, so it counts as ordinary" });
  const money = a && shown.revenue > 0 ? `About ${money0(shown.revenue)} of orders so far. This is an estimate.` : "";
  // A sober ruled table: what happened so far on the left of each figure, where it is heading in grey beside it.
  return `<section class="did" aria-label="What this post did">
    <h3 class="did-title">What this post did</h3>
    <dl class="did-rows">${rows.map((t) => `<div class="did-row${t.value == null ? " is-waiting" : ""}" data-key="${t.key}">
      <dt>${t.label}</dt><dd><b class="did-num">${t.value == null ? "–" : num(t.value)}</b>${t.goal ? `<span class="did-goal">heading for ${num(t.goal)}</span>` : ""}</dd></div>`).join("")}</dl>
    ${a ? "" : before ? '<p class="did-note">Only likes and comments are counted for this one. Reach, visits and orders are counted for posts you or an AI make.</p>'
      : `<div class="did-wait"><p>Not counted yet. Move on a day and these fill in.</p><button type="button" class="btn small" data-did-next><span>Move on a day</span></button></div>`}
    ${money ? `<p class="did-note">${esc(money)}</p>` : ""}
    ${why.length ? `<p class="did-sub">Why</p><ul class="did-why">${why.map((w) => `<li class="${w.up == null ? "" : w.up ? "is-up" : "is-down"}">${esc(w.text)}.</li>`).join("")}</ul>` : ""}
  </section>`;
}

/** Whole pounds with a thousands comma. */
function money0(v) {
  return `£${Math.round(v).toLocaleString("en-GB")}`;
}

/**
 * Counts the strip's numbers up once it is on screen. Run it after every paint of an opened post: a strip that was
 * waiting and now holds numbers (time moved on) simply arrives filled.
 * @param {Element} root
 * @param {function(number): string=} format
 */
export function fillOutcome(root, format = (v) => num(Math.round(v))) {
  // The figures are written straight into the strip now: counting up on every open was motion on a frequent action.
  return { root, format };
}

// ------------------------------------------------------------------ who a conversation is with

/**
 * Gives every conversation a `who`: the customer on the other side. WHY: a conversation the shop started has only
 * the shop's own message in it, and the list names the sender, so the customer is found from the id in the thread
 * name, by way of the posts already read, or the customer record.
 * @param {object} world the client
 * @param {Array<object>} convos from list_social_messages
 * @param {Array<object>} records posts already read from the network
 */
export async function resolvePartners(world, convos, records) {
  const known = new Map(records.filter((r) => r.author.customer_id).map((r) => [r.author.customer_id, r.author]));
  for (const c of convos) {
    if (c.with.kind !== "company") { c.who = c.with; continue; }
    const cid = c.thread.match(/-(C-\d+)-/)?.[1];
    let who = known.get(cid);
    if (!who && cid) {
      const res = await world.call("get_customer", { id: cid }, { screen: true }).catch(() => null);
      const name = res?.ok && (res.data.name || res.data.customer?.name);
      if (name) who = { name, handle: "" };
    }
    c.who = who || { name: "A customer", handle: "" };
    if (cid) known.set(cid, c.who);
  }
}

// ------------------------------------------------------------------ who wrote it

/** The team as a map of staff id to name, from loadTeam(). */
export function teamNames(team) {
  return new Map(team.map((p) => [p.id, p.name]));
}

/**
 * "Written by Cratchit" with a small avatar, for a company post whose writer is known.
 * @param {object} post
 * @param {Map<string, string>} names from teamNames()
 */
export function byLine(post, names) {
  const name = post.by && names.get(post.by);
  return name ? `<span class="by">${avatar(name, { size: 18 })}<span>Written by ${esc(name)}</span></span>` : "";
}

// ------------------------------------------------------------------ like and repost

/**
 * A like or repost control on a customer's post or comment: a button that shows the shop's own state (pressed
 * once done). On the shop's own posts it is a plain count.
 * @param {object} p a record
 * @param {"like"|"repost"} kind
 * @param {{network: string, zero?: boolean, label?: boolean}} o zero shows 0; label adds the word
 */
export function reactControl(p, kind, { network, zero = true, label = false }) {
  const done = kind === "like" ? p.liked_by_shop : p.reposted_by_shop;
  const n = (kind === "like" ? p.likes : p.reposts) || 0;
  const icon = glyph(kind === "like" ? "heart" : "repost", 17);
  const shown = n || zero ? num(n) : "";
  const word = label ? `<span class="react-word">${kind === "like" ? "Like" : "Repost"}</span>` : "";
  const allowed = p.author?.kind === "customer" && p.kind !== "dm" && (kind === "like" || (network === "mutter" && p.kind === "post"));
  if (!allowed) return `<span class="react is-static" title="${kind === "like" ? "Likes" : "Reposts"}">${icon}<b>${shown}</b></span>`;
  const verb = kind === "like" ? "Like" : "Repost";
  return `<button type="button" class="react${done ? " is-done" : ""}" data-react="${kind}" data-id="${esc(p.id)}" aria-pressed="${done ? "true" : "false"}"
    aria-label="${done ? `${verb}d by the shop` : `${verb} as the shop`}" title="${done ? `${verb}d by the shop` : `${verb} as the shop`}">${icon}<b>${shown}</b>${word}</button>`;
}

/**
 * A post's author as a name: a customer's opens their record; the shop's and anyone else's is plain text.
 * @param {object} p a record
 * @return {string} trusted HTML
 */
export function authorName(p) {
  const id = p.author?.customer_id || (p.author?.kind === "customer" ? p.links?.customer_id : null);
  return id ? `<button type="button" class="author-link" data-author-customer="${esc(id)}" title="See ${esc(p.author.name)}'s record">${esc(p.author.name)}</button>` : `${esc(p.author?.name || "")}`;
}

/**
 * Makes every reactControl() button on the page work, once. Calls the real tool, bursts, and shows the new state
 * at once; the app's own refresh then redraws from the world.
 * @param {object} world the client
 */
export function wireReactions(world) {
  // A customer's name on a post opens their customer record (and from there their page in the help desk).
  document.addEventListener("click", (e) => {
    const who = e.target.closest?.("[data-author-customer]");
    if (!who) return;
    e.stopPropagation();
    import("./records.js").then((m) => m.openRecord(world, "customer", who.dataset.authorCustomer));
  }, true);
  // "Move on a day" in a post's results strip: the same button as the top bar's, so time moves in one place.
  document.addEventListener("click", (e) => {
    const n = e.target.closest?.("[data-did-next]");
    if (!n) return;
    n.disabled = true;
    n.querySelector("span").textContent = "Moving on…";
    // The top bar hears the clock move (its poll) and tells every open screen through "ot:day".
    world.advance(1).catch(() => {});
  });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest?.("button[data-react]");
    if (!b || b.disabled || b.getAttribute("aria-pressed") === "true") return;
    const kind = b.dataset.react;
    b.disabled = true;
    const res = await world.call(kind === "repost" ? "repost_social_post" : "like_social_post", { post_id: b.dataset.id });
    b.disabled = false;
    // "Already done" means the world agrees with what the button should show, so it is not an error to the viewer.
    const already = res.error?.code === "already_done";
    if (!res.ok && !already) { toast(res.error.message, { tone: "bad" }); return; }
    b.classList.add("is-done");
    b.setAttribute("aria-pressed", "true");
    const count = b.querySelector("b");
    const total = res.ok ? (kind === "repost" ? res.data.reposts : res.data.likes) : null;
    if (count && total != null) count.textContent = num(total);

  });
}

// ------------------------------------------------------------------ account charts

/**
 * One measure over time as a single-series chart with a hover readout. Line for running totals (followers),
 * bars for daily amounts (reach, engagement). No second axis, ever: each measure gets its own chart.
 * @param {{rows: Array<{date: string}>, key: string, kind: "line"|"bars", label: string, format?: function(number): string}} p rows oldest first
 * @return {string}
 */
export function chart({ rows, key, kind, label, format = num }) {
  if (!rows.length) return '<p class="muted small">No days counted yet.</p>';
  const W = 600, H = 170, padT = 12, padB = 22;
  const vals = rows.map((r) => r[key] || 0);
  const max = Math.max(...vals), min = kind === "line" ? Math.min(...vals) : 0;
  const span = max - min || 1;
  const y = (v) => padT + (H - padT - padB) * (1 - (v - min) / span);
  const step = W / rows.length;
  let marks;
  if (kind === "line") {
    const pts = vals.map((v, i) => `${(i + 0.5) * step},${y(v)}`);
    marks = `<path class="ch-area" d="M${(0.5) * step},${H - padB} L${pts.join(" L")} L${(rows.length - 0.5) * step},${H - padB}Z"/>
      <path class="ch-line" d="M${pts.join(" L")}"/>`;
  } else {
    const bw = Math.max(1, step - 2);
    marks = vals.map((v, i) => {
      const top = y(v), hgt = Math.max(v ? 2 : 0, H - padB - top);
      return `<rect class="ch-bar" x="${i * step + 1}" y="${H - padB - hgt}" width="${bw}" height="${hgt}" rx="${Math.min(3, bw / 2)}"/>`;
    }).join("");
  }
  const first = rows[0].date, last = rows.at(-1).date;
  return `<figure class="ch" data-kind="${kind}" data-rows='${esc(JSON.stringify(rows.map((r) => [r.date, r[key] || 0])))}' data-label="${esc(label)}">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}, ${esc(shortDate(first))} to ${esc(shortDate(last))}">
      <line class="ch-base" x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}"/>
      ${marks}
      <line class="ch-cross" x1="0" x2="0" y1="${padT}" y2="${H - padB}" hidden/>
    </svg>
    <figcaption class="ch-axis"><span>${esc(shortDate(first))}</span><span>${esc(shortDate(last))}</span></figcaption>
    <div class="ch-tip" hidden></div>
    <span class="ch-max">${esc(format(max))}</span>${kind === "line" && min > 0 ? `<span class="ch-min">${esc(format(min))}</span>` : ""}
  </figure>`;
}

/**
 * Gives every chart inside `root` its hover readout: a crosshair and the day's number.
 * @param {Element} root
 * @param {function(number): string=} format
 */
export function wireCharts(root, format = num) {
  root.querySelectorAll(".ch").forEach((fig) => {
    const rows = JSON.parse(fig.dataset.rows);
    const tip = fig.querySelector(".ch-tip");
    const cross = fig.querySelector(".ch-cross");
    function show(e) {
      const box = fig.querySelector("svg").getBoundingClientRect();
      const i = Math.min(rows.length - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * rows.length)));
      const [date, v] = rows[i];
      const x = ((i + 0.5) / rows.length) * 600;
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.hidden = false;
      tip.hidden = false;
      tip.innerHTML = `<b>${esc(format(v))}</b> ${esc(shortDate(date))}`;
      tip.style.left = `${Math.min(box.width - 70, Math.max(0, ((i + 0.5) / rows.length) * box.width - 40))}px`;
    }
    fig.addEventListener("pointermove", show);
    fig.addEventListener("pointerleave", () => { tip.hidden = true; cross.hidden = true; });
  });
}

// ------------------------------------------------------------------ motion

/** Once little hearts that burst from a button; now does nothing (see the comment inside). */
export function burst(el, options = {}) {
  // Retired: confetti-like motion is against the calm look (applications/DESIGN.md, rule 20). Kept so old callers still work.
  return { el, options };
}
