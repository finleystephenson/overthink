// The Daily Overthinker: the newspaper of the world the shop lives in.
// Reads the news (list_news, get_news_item) and, for staff, what each story is doing to trade
// (list_world_events, get_world_event). Anyone can set the news from the editor's desk
// (add_world_event, edit_world_event, cancel_world_event). Everything on the page comes from the world.
import { startApp, esc, emptyState, skeleton, slideOver, toast, longDate, shortDate, timeParts, daysBetween, reducedMotion, node } from "../lib/ui.js";
import { isScreenRead } from "../lib/client.js";
import { plainText } from "../lib/plain.js";
import { recordChip, wireRecordChips } from "../lib/records.js";

const APP_ID = "daily-overthinker";
const EDITION_SIZE = 30;
const EVENT_LIMIT = 100;

const { world, app } = await startApp({ id: APP_ID });
document.title = `${app.name} · Overthought & Co.`;
setMasthead(app.name);

const $ = (sel) => document.querySelector(sel);

/** Everything the page knows. Filled only from tool answers. */
const state = {
  now: null,             // the simulated time, ISO
  view: null,            // the date (YYYY-MM-DD) of the back issue on screen; null is today's paper
  edition: [],           // news items as of the page's date, newest first
  events: new Map(),     // world event id -> the event as the tool describes it, or null when hidden
  canSeeEvents: true,    // false for roles that may read the paper but not the trade figures
  library: [],           // ready-made events, from client.eventLibrary()
  byTemplate: new Map(), // library id -> template
  leadId: null,          // the lead story now on the page, to notice when it changes
  month: null,           // "YYYY-MM" shown in back issues
  loading: null,
};

// ------------------------------------------------------------------ words for numbers and places

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const CATEGORY_NAMES = { everyday: "Everyday things", tech: "Gadget", food: "Food", carry: "Bag", "desk-home": "Desk and home", outdoors: "Outdoor" };
const FAMILY_NAMES = { calendar: "Diary", "real-style": "Trade", storybook: "Storybook", custom: "Trade" };

/** "indoor-helmet" becomes "Indoor Helmet". Product ids are written from product names, so this reads true. */
function productName(id) {
  return String(id).split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

/** A multiplier in plain words: 3 is "about three times normal", 1.3 is "up about 30%". */
function factorWords(m) {
  if (m >= 1.9) return `about ${NUMBER_WORDS[Math.round(m)] || Math.round(m)} times normal`;
  if (m <= 0.55) return m <= 0.3 ? "almost nothing" : "about half normal";
  const pct = Math.round(Math.abs(m - 1) * 100);
  if (pct < 3) return m > 1 ? "up a touch" : "down a touch";
  const rounded = pct >= 10 ? Math.round(pct / 5) * 5 : pct;
  return `${m > 1 ? "up" : "down"} about ${rounded}%`;
}

/** "in Mother Goose Lane and Cottage in the Wood", or "" for an event that is everywhere. */
function regionWords(region) {
  if (!region) return "";
  const places = [...(region.towns || []), ...(region.areas || []).map((a) => `the ${a} postcode area`)];
  if (!places.length) return "";
  return `in ${places.length > 1 ? `${places.slice(0, -1).join(", ")} and ${places.at(-1)}` : places[0]}`;
}

/** How long an event lasts, as a person would say it. Dates are inclusive. */
function spanWords(start, end) {
  const n = daysBetween(start, end) + 1;
  if (n <= 1) return "for a day";
  if (n === 14) return "for a fortnight";
  if (n % 7 === 0 && n <= 35) return n === 7 ? "for a week" : `for ${NUMBER_WORDS[n / 7]} weeks`;
  return `for ${NUMBER_WORDS[n] || n} days`;
}

/**
 * What an event does to trade, one plain line per effect. Each line says where, so it can stand alone.
 * @param {object} effects the simulator's effect keys
 * @param {object|null} region
 * @return {Array<{path: string, text: string}>}
 */
function effectLines(effects = {}, region = null) {
  const where = regionWords(region);
  const out = [];
  const add = (path, text) => out.push({ path, text: where ? `${text} ${where}` : text });
  const d = effects.demand || {};
  if (d.all) add("demand.all", `Orders ${factorWords(d.all)}`);
  Object.entries(d.products || {}).sort((a, b) => b[1] - a[1]).forEach(([id, m]) => add(`demand.products.${id}`, `${productName(id)} sales ${factorWords(m)}`));
  Object.entries(d.categories || {}).forEach(([c, m]) => add(`demand.categories.${c}`, `${CATEGORY_NAMES[c] || productName(c)} sales ${factorWords(m)}`));
  if (effects.visits) add("visits", `Visits to the shop ${factorWords(effects.visits)}`);
  if (effects.contact_rate) add("contact_rate", `Customers getting in touch ${factorWords(effects.contact_rate)}`);
  if (effects.carrier_delay_days) {
    const days = Math.round(effects.carrier_delay_days);
    add("carrier_delay_days", days >= 1 ? `Parcels about ${NUMBER_WORDS[days] || days} day${days === 1 ? "" : "s"} late` : "Parcels a little slower");
  }
  if (effects.supplier_late_chance) add("supplier_late_chance", supplierWords(effects.supplier_late_chance));
  const c = effects.costs || {};
  if (c.carrier) add("costs.carrier", `Delivery costs ${factorWords(c.carrier)}`);
  if (c.goods) add("costs.goods", `What our goods cost us ${factorWords(c.goods)}`);
  if (c.card_fee) add("costs.card_fee", `Card fees ${factorWords(c.card_fee)}`);
  return out;
}

/** How a change in the chance of a late supplier reads: "Suppliers late about 20% more often". */
function supplierWords(m) {
  if (m >= 1.9) return `Suppliers late ${NUMBER_WORDS[Math.round(m)] || Math.round(m)} times as often`;
  const pct = Math.round(Math.abs(m - 1) * 100);
  if (pct < 3) return "Suppliers a touch more or less reliable";
  return `Suppliers late about ${pct >= 10 ? Math.round(pct / 5) * 5 : pct}% ${m > 1 ? "more" : "less"} often`;
}

/** "Until 30 Nov", "Ended 22 Nov": where an event stands today. */
function standingWords(ev) {
  if (ev.status === "cancelled") return "Called off";
  if (ev.status === "scheduled") return `Starts ${shortDate(ev.start)}`;
  if (ev.status === "over") return `Ended ${shortDate(ev.end)}`;
  return ev.end === ev.start ? "Today only" : `Until ${shortDate(ev.end)}`;
}

// ------------------------------------------------------------------ dates

const dateOf = (iso) => String(iso).slice(0, 10);
const today = () => dateOf(state.now);
const pageDate = () => state.view || today();

/** A date some days on. Dates are plain YYYY-MM-DD in UTC, like the simulated clock. */
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ the library

/** Which family a story belongs to: from its template, else from its event, else from its section. */
function familyOf(item) {
  const ev = state.events.get(item.event);
  const tpl = ev?.template && state.byTemplate.get(ev.template);
  if (tpl) return tpl.family;
  if (ev?.family && ev.family !== "custom") return ev.family;
  return item.section === "Diary" ? "calendar" : item.section === "Local" ? "storybook" : "real-style";
}

/**
 * Who a story is about and what it did, as records that open: the rival behind a competitor's move (with its other
 * moves), the supplier behind a supply problem. WHY: a story in the paper is something that happened in this world.
 */
async function storyWho(box, item) {
  if (!box) return;
  const [kind, id] = String(item.source || "").split(":");
  const chips = [];
  if (kind === "competitor_move") {
    const r = await world.call("list_competitor_moves", { limit: 200 }, { screen: true });
    const move = r.ok ? (r.data.moves || []).find((m) => m.id === id) : null;
    if (move?.competitor) chips.push(recordChip("organisation", move.competitor));
  } else if (kind === "supplier") {
    const r = await world.call("list_suppliers", {}, { screen: true });
    const name = item.headline.split(":")[0];
    const sup = r.ok ? r.data.suppliers.find((s) => s.name === name) : null;
    if (sup) chips.push(recordChip("supplier", sup.id));
  }
  if (!chips.length || !box.isConnected) return;
  box.innerHTML = `<h3 class="story-sub">Who it is about</h3><p class="rec-chips">${chips.join(" ")}</p>`;
  wireRecordChips(box, world);
}

/** The library template behind a story, when there is one (for its source, its reasons and its chatter). */
function templateOf(item) {
  const ev = state.events.get(item.event);
  // WHY: a story's headline can be rewritten at the desk, so the template is found from the event, never from the words.
  return (ev?.template && state.byTemplate.get(ev.template)) || null;
}

async function loadLibrary() {
  try {
    const lib = await world.eventLibrary();
    state.library = Array.isArray(lib) ? lib : lib?.events || [];
  } catch {
    state.library = [];  // no library: the paper still prints, the desk has nothing on the wire
  }
  state.library.forEach((t) => state.byTemplate.set(t.id, t));
}

// ------------------------------------------------------------------ reading the world

/** The paper as of the page's date, and the events behind its stories. */
async function loadEdition() {
  const before = state.view ? `${addDays(state.view, 1)}T00:00:00Z` : undefined;
  const res = await world.call("list_news", { limit: EDITION_SIZE, ...(before ? { before } : {}) }, { screen: true });
  if (!res.ok) return res.error;
  state.edition = res.data.news || [];
  await loadEvents();
  return null;
}

/** Events behind the stories. Recent ones come in one call; older back-issue stories are fetched one by one. */
async function loadEvents() {
  const res = await world.call("list_world_events", { limit: EVENT_LIMIT }, { screen: true });
  if (!res.ok) {
    // If the trade figures cannot be read, the paper still prints without them.
    state.canSeeEvents = false;
    state.events.clear();
    return;
  }
  state.canSeeEvents = true;
  for (const e of res.data.events) state.events.set(e.id, e);
  const missing = state.edition.slice(0, 10).filter((n) => n.event && !state.events.has(n.event));
  await Promise.all(missing.map(async (n) => {
    const r = await world.call("get_world_event", { id: n.event }, { screen: true });
    state.events.set(n.event, r.ok ? r.data : null);
  }));
}

// ------------------------------------------------------------------ pictures

/** The product a story moves most, when its picture exists, so the front page can show the real thing. */
function productFor(item) {
  const ev = state.events.get(item.event);
  const effects = ev?.effects || templateOf(item)?.effects || {};
  const products = Object.entries(effects.demand?.products || {}).sort((a, b) => Math.abs(b[1] - 1) - Math.abs(a[1] - 1));
  return products[0]?.[0] || null;
}

/**
 * A picture for a story: the product photograph when the story moves one product, with a plain caption.
 * WHY no drawing otherwise: a serious paper prints a story without a picture rather than with a cartoon.
 */
function figure(item, cls = "") {
  const id = productFor(item);
  if (!id) return "";
  return `<figure class="fig ${cls}"><img src="/img/branded/${esc(id)}.jpg" alt="${esc(productName(id))}" loading="lazy" data-fallback><figcaption>${esc(productName(id))}</figcaption></figure>`;
}

/** If a product picture is missing, the story prints without one. */
function wirePictures(root) {
  root.querySelectorAll("img[data-fallback]").forEach((img) => {
    img.addEventListener("error", () => img.closest("figure")?.remove(), { once: true });
  });
}

// ------------------------------------------------------------------ the strength curve

/** How strong an event is on a fraction of its way through, for its ramp. */
function rampAt(ramp, t) {
  if (ramp === "build") return 0.25 + 0.75 * t;
  if (ramp === "fade") return 1 - 0.75 * t;
  if (ramp === "peak") return 0.25 + 0.75 * Math.sin(Math.PI * t);
  return 1;
}

/** A small drawing of the event's life: its strength over its days, with a mark for the page's date. */
function curve(ev) {
  const n = 24;
  const pts = Array.from({ length: n + 1 }, (_, i) => [i / n, rampAt(ev.ramp, i / n)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${(x * 200).toFixed(1)} ${(36 - y * 30).toFixed(1)}`).join(" ");
  const total = Math.max(1, daysBetween(ev.start, ev.end));
  const at = Math.min(1, Math.max(0, daysBetween(ev.start, pageDate()) / total));
  const inside = pageDate() >= ev.start && pageDate() <= ev.end && ev.status !== "cancelled";
  const mark = inside ? `<circle class="curve-now" cx="${(at * 200).toFixed(1)}" cy="${(36 - rampAt(ev.ramp, at) * 30).toFixed(1)}" r="4.5"/>` : "";
  // One thin line and, when the page's date falls inside, one spark dot for "today". No fill.
  return `<svg class="curve" viewBox="-6 0 212 40" preserveAspectRatio="none" aria-hidden="true">
    <path class="curve-base" d="M0 38H200"/><path class="curve-line" d="${line}"/>${mark}</svg>`;
}

/**
 * The trade box under a story: what it does, where, and for how long.
 * @param {object} item a news item
 * @param {{why?: boolean, limit?: number}=} options why adds the template's reason under each line
 */
function tradeBox(item, { why = false, limit = 4 } = {}) {
  if (!state.canSeeEvents) {
    return `<p class="trade-locked">What this does to trade is for the staff to see.</p>`;
  }
  const ev = state.events.get(item.event);
  if (!ev) return "";
  const lines = effectLines(ev.effects, ev.region);
  const reasons = why ? templateOf(item)?.why || {} : {};
  if (!lines.length) return "";
  const shown = lines.slice(0, limit);
  return `<div class="trade" data-event="${esc(ev.id)}">
    <p class="trade-h">What it does to trade</p>
    <ul class="trade-lines">${shown.map((l) => `<li><span>${esc(l.text)}</span>${reasons[l.path] ? `<small>${esc(reasons[l.path])}</small>` : ""}</li>`).join("")}
      ${lines.length > shown.length ? `<li class="trade-more">and ${esc(NUMBER_WORDS[lines.length - shown.length] || lines.length - shown.length)} more</li>` : ""}</ul>
    <div class="trade-span">${curve(ev)}<span><b>${esc(standingWords(ev))}</b> ${esc(spanWords(ev.start, ev.end))}</span></div>
  </div>`;
}

// ------------------------------------------------------------------ the front page

/** A kicker: the section's name, small and grey above the headline. */
function kicker(item) {
  return `<p class="kick">${esc(item.section || "News")}</p>`;
}

function leadStory(item) {
  const [first, ...rest] = String(item.story).split(/(?<=\.)\s+/);
  return `<div class="lead" data-story="${esc(item.id)}">
    ${kicker(item)}
    <h2 class="lead-head"><button type="button" class="story-link" data-open="${esc(item.id)}">${esc(plainText(item.headline))}</button></h2>
    ${figure(item, "fig-lead")}
    <p class="lead-text"><span class="lead-first">${esc(first)}</span> ${esc(rest.join(" "))}</p>
    <p class="filed">Filed ${esc(longDate(item.at))}</p>
    ${tradeBox(item)}
  </div>`;
}

function secondStory(item) {
  return `<div class="second" data-story="${esc(item.id)}">
    ${figure(item, "fig-small")}
    ${kicker(item)}
    <h3 class="second-head"><button type="button" class="story-link" data-open="${esc(item.id)}">${esc(plainText(item.headline))}</button></h3>
    <p class="second-text">${esc(plainText(item.story))}</p>
    ${tradeBox(item, { limit: 2 })}
  </div>`;
}

/** The events acting on the page's date, strongest first in what they touch. */
function inForce() {
  const d = pageDate();
  return [...state.events.values()].filter((e) => e && e.status !== "cancelled" && e.start <= d && e.end >= d);
}

function inForceBox() {
  if (!state.canSeeEvents) {
    return `<aside class="force"><h2 class="sec-title">In force</h2>${emptyState({ title: "Nothing to show yet.", text: "The trade figures are not in. The paper still prints." })}</aside>`;
  }
  const list = inForce();
  const body = list.length
    ? `<ul class="force-list">${list.map((e) => `<li><button type="button" class="force-item" data-event-open="${esc(e.id)}">
        <span class="force-text"><b>${esc(plainText(e.title))}</b><small>${esc(effectLines(e.effects, e.region)[0]?.text || "Quiet effects")}</small></span>
        ${curve(e)}
      </button></li>`).join("")}</ul>`
    : emptyState({ title: "Nothing in force.", text: "An ordinary day. They happen." });
  return `<aside class="force"><h2 class="sec-title">In force ${state.view ? "that day" : "today"}</h2>${body}</aside>`;
}


/** A pull quote from the chatter the event's template carries, picked steadily by the story's id. */
function pullQuote(items) {
  for (const item of items) {
    const lines = templateOf(item)?.chatter || [];
    if (!lines.length) continue;
    const pick = lines[Number(String(item.id).replace(/\D/g, "")) % lines.length];
    return `<blockquote class="pull"><p>${esc(plainText(pick))}</p><footer>Overheard, on ${esc(item.headline.toLowerCase().startsWith("the ") ? item.headline : item.headline.charAt(0).toLowerCase() + item.headline.slice(1))}</footer></blockquote>`;
  }
  return "";
}

/** The three section columns: Diary, Trade, Storybook. */
function sectionColumns(items) {
  const cols = [["calendar", "Diary"], ["real-style", "Trade"], ["storybook", "Storybook"]];
  return `<section class="sections">${cols.map(([fam, title]) => {
    const list = items.filter((n) => familyOf(n) === fam || (fam === "real-style" && !["calendar", "storybook"].includes(familyOf(n)))).slice(0, 4);
    return `<div class="col" id="sec-${fam === "real-style" ? "trade" : fam}">
      <h2 class="sec-title">${title}</h2>
      ${list.length ? `<ul class="col-list">${list.map((n) => `<li>
          <button type="button" class="col-item" data-open="${esc(n.id)}"><b>${esc(plainText(n.headline))}</b><small>${esc(shortDate(n.at))}</small></button>
        </li>`).join("")}</ul>` : `<p class="col-quiet">Quiet. Nothing to report.</p>`}
    </div>`;
  }).join("")}</section>`;
}

/** Draws the whole front page for the page's date. */
function paintPaper(err) {
  const pages = $("#pages");
  $("#dateline").textContent = longDate(`${pageDate()}T12:00:00Z`);
  $("#dateline").setAttribute("datetime", pageDate());
  $("#edition-name").textContent = state.view ? "Back issue" : "Morning edition";
  paintBackIssueBanner();
  if (err) {
    pages.innerHTML = emptyState({ title: "No paper today.", text: "The news did not come in. Try again in a moment." });
    return;
  }
  const items = state.edition;
  if (!items.length) {
    pages.innerHTML = `<div class="front-empty">${emptyState({ title: "Nothing has happened yet.", text: "The presses are warm. The world is quiet." })}</div>`;
    return;
  }
  const [lead, ...others] = items;
  const seconds = others.slice(0, 3);
  const rest = others.slice(3);
  pages.innerHTML = `
    <section class="front" id="front">${leadStory(lead)}${inForceBox()}</section>
    ${pullQuote([lead, ...seconds])}
    <section class="seconds">${seconds.map(secondStory).join("")}</section>
    ${sectionColumns(rest.length ? rest : others)}`;
  wirePictures(pages);
  state.leadId = lead.id;
}

function paintBackIssueBanner() {
  const b = $("#backissue");
  if (!state.view) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = `<span>You are reading the paper as it was on ${esc(longDate(`${state.view}T12:00:00Z`))}.</span>
    <button class="btn small" type="button" data-today>Today's paper</button>`;
}

// ------------------------------------------------------------------ one story, opened

/** The full story in a slide-over: the picture, every effect with its reason, and what people said. */
async function openStory(id) {
  const res = await world.call("get_news_item", { id }, { screen: true });
  if (!res.ok) { toast(plainText(res.error.message), { tone: "bad" }); return; }
  const item = res.data;
  if (state.canSeeEvents && item.event && !state.events.has(item.event)) {
    const r = await world.call("get_world_event", { id: item.event }, { screen: true });
    state.events.set(item.event, r.ok ? r.data : null);
  }
  const tpl = templateOf(item);
  const ev = state.events.get(item.event);
  const chatter = tpl?.chatter || [];
  const canEdit = ev && ["active", "scheduled"].includes(ev.status);
  const { el, close } = slideOver({
    title: item.section || "News",
    wide: true,
    body: `<article class="story-page">
      ${kicker(item)}
      <h2 class="story-head">${esc(plainText(item.headline))}</h2>
      <p class="filed">Filed ${esc(longDate(item.at))}</p>
      ${figure(item, "fig-story")}
      <p class="story-text">${esc(plainText(item.story))}</p>
      ${tpl?.source && tpl.family === "storybook" ? `<p class="story-source">From ${esc(tpl.source)}.</p>` : ""}
      <div class="story-who" data-story-who="${esc(item.id)}"></div>
      ${state.canSeeEvents && ev ? `<h3 class="story-sub">What it does to trade</h3>` : ""}
      ${tradeBox(item, { why: true, limit: 12 })}
      ${chatter.length ? `<h3 class="story-sub">Overheard</h3><div class="story-quotes">${chatter.map((c) => `<blockquote class="pull small"><p>${esc(plainText(c))}</p></blockquote>`).join("")}</div>` : ""}
      ${canEdit ? `<button class="btn" type="button" data-desk-event="${esc(ev.id)}">Change it at the editor's desk</button>` : ""}
    </article>`,
  });
  wirePictures(el);
  el.querySelector("[data-desk-event]")?.addEventListener("click", () => { close(); openDesk({ eventId: ev.id }); });
  storyWho(el.querySelector("[data-story-who]"), item);
}

/** An event with no news item on the page (from the In force box) opens as its own story. */
function openEvent(id) {
  const ev = state.events.get(id);
  if (!ev) return;
  const news = state.edition.find((n) => n.event === id);
  if (news) { openStory(news.id); return; }
  const item = { id: ev.id, event: ev.id, headline: ev.title, story: ev.story, section: FAMILY_NAMES[ev.family] === "Diary" ? "Diary" : "Business", at: `${ev.start}T07:00:00Z` };
  const { el } = slideOver({
    title: "In force",
    wide: true,
    body: `<article class="story-page">${kicker(item)}<h2 class="story-head">${esc(ev.title)}</h2>${figure(item, "fig-story")}
      <p class="story-text">${esc(ev.story)}</p>${tradeBox(item, { why: true, limit: 12 })}</article>`,
  });
  wirePictures(el);
}

// ------------------------------------------------------------------ back issues

/** The month calendar of back issues: every day with news is a small front page you can open. */
async function paintCalendar() {
  const cal = $("#cal");
  const [y, m] = state.month.split("-").map(Number);
  const first = `${state.month}-01`;
  const nextMonth = addDays(first, 32).slice(0, 7) + "-01";
  $("#month-name").textContent = `${timeParts(`${first}T12:00:00Z`).month} ${y}`;
  $("#month-next").disabled = nextMonth > today();
  const res = await world.call("list_news", { before: `${nextMonth}T00:00:00Z`, limit: 100 }, { screen: true });
  const byDay = new Map();
  if (res.ok) for (const n of res.data.news) if (n.at.startsWith(state.month)) (byDay.get(dateOf(n.at)) || byDay.set(dateOf(n.at), []).get(dateOf(n.at))).push(n);
  const lead = new Date(`${first}T00:00:00Z`).getUTCDay();
  const offset = (lead + 6) % 7;  // weeks start on Monday, as they do at the shop
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const heads = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<span class="cal-dow">${d}</span>`).join("");
  const blanks = Array.from({ length: offset }, () => `<span class="cal-blank"></span>`).join("");
  const cells = Array.from({ length: daysIn }, (_, i) => {
    const date = `${state.month}-${String(i + 1).padStart(2, "0")}`;
    const news = byDay.get(date) || [];
    const future = date > today();
    const current = date === pageDate();
    return `<button type="button" class="cal-day${news.length ? " has-news" : ""}${current ? " is-current" : ""}" data-date="${date}" ${future ? "disabled" : ""} aria-label="${esc(longDate(`${date}T12:00:00Z`))}${news.length ? `: ${esc(news[0].headline)}` : ""}">
      <span class="cal-num">${i + 1}</span>
      ${news.length ? `<span class="cal-mini"><b>${esc(news[0].headline)}</b></span>` : ""}
    </button>`;
  }).join("");
  cal.innerHTML = heads + blanks + cells;
}

/** The latest issue before the page's lead story, or the next one after the page's date. */
async function step(direction) {
  if (direction < 0) {
    const leadDate = state.edition[0] ? dateOf(state.edition[0].at) : pageDate();
    const prev = state.edition.find((n) => dateOf(n.at) < leadDate);
    if (!prev) { toast("That is the first edition there is."); return; }
    await goTo(dateOf(prev.at));
    return;
  }
  if (!state.view) return;
  const res = await world.call("list_news", { before: `${addDays(state.view, 90)}T00:00:00Z`, limit: 100 }, { screen: true });
  const later = res.ok ? res.data.news.map((n) => dateOf(n.at)).filter((d) => d > state.view).sort()[0] : null;
  await goTo(later && later < today() ? later : null);
}

/** Opens the paper as it was on a date (null, or today or later, is today's paper). */
async function goTo(date) {
  state.view = date && date < today() ? date : null;
  state.month = pageDate().slice(0, 7);
  const err = await loadEdition();
  paintPaper(err);
  $("#later").disabled = !state.view;
  paintCalendar();
}

// ------------------------------------------------------------------ the day's ceremony

/**
 * A new day's paper: the page is reprinted in place and one quiet note says so (time moved away from the pointer).
 * A new lead story gets a short wash so the change is seen. No folding, spinning or stamped ribbons.
 */
async function newEdition({ stopPress = false } = {}) {
  const oldLead = state.leadId;
  const err = await loadEdition();
  if (state.view) { toast(stopPress ? "Today's paper has changed." : "Today's paper is out."); paintCalendar(); return; }
  paintPaper(err);
  if (state.leadId !== oldLead) {
    document.querySelector(".lead")?.classList.add("is-new");
    toast(stopPress ? "A new story has gone to print." : "Today's paper is out, with a new front page.");
  }
  paintCalendar();
}

// ------------------------------------------------------------------ the editor's desk

/** Multiplies how far each effect is from normal by k: 1.4 at strength 1.5 becomes 1.6. */
function scaleEffects(effects, k) {
  const scale = (v) => Math.min(10, Math.max(0.1, Math.round((1 + (v - 1) * k) * 1000) / 1000));
  const out = structuredClone(effects || {});
  for (const [key, v] of Object.entries(out)) {
    if (key === "carrier_delay_days") out[key] = Math.max(0, Math.round(v * k));
    else if (typeof v === "number") out[key] = scale(v);
    else if (v && typeof v === "object") for (const [k2, v2] of Object.entries(v)) {
      if (typeof v2 === "number") v[k2] = scale(v2);
      else if (v2 && typeof v2 === "object") for (const k3 of Object.keys(v2)) v2[k3] = scale(v2[k3]);
    }
  }
  return out;
}

function strengthWords(k) {
  if (k === 1) return "As written";
  return k < 1 ? (k <= 0.6 ? "Much milder" : "Milder") : (k >= 1.4 ? "Much stronger" : "Stronger");
}

/** The shortest and longest a template may run. */
function lengthRange(tpl) {
  if (tpl.duration_days) return tpl.duration_days;
  const n = tpl.fixed?.length_days || 7;
  return [Math.max(1, Math.round(n / 2)), Math.max(n, 14)];
}

const desk = { el: null, tab: "add", family: "all", query: "", selected: null, editing: null };

/**
 * Opens the editor's desk: a calm panel from the right, as Letterbox's writing window is calm. Two views:
 * "Add to the news" (ready-made stories on the left, the form on the right) and "Running and coming"
 * (what acts now and what is booked, each to change or call off). Every button is a real tool.
 * @param {{eventId?: string}=} options open with one event already in the form, to change it
 */
async function openDesk({ eventId } = {}) {
  if (desk.el) return;
  const el = node(`<div class="desk" role="dialog" aria-modal="true" aria-label="The editor's desk">
    <div class="desk-back"></div>
    <section class="desk-panel">
      <header class="desk-head">
        <h2 class="desk-h">The editor's desk</h2>
        <div class="desk-tabs" role="tablist" aria-label="What to do">
          <button type="button" class="pm-chip" role="tab" data-tab="add">Add to the news</button>
          <button type="button" class="pm-chip" role="tab" data-tab="print">Running and coming</button>
        </div>
        <button class="btn icon-only ghost small desk-x" type="button" data-close aria-label="Close (Escape)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </header>
      <p class="desk-lede">Change what happens in the world, then move time on to see what it does to trade.</p>
      <div class="desk-body"></div>
    </section>
  </div>`);
  desk.el = el;
  document.body.append(el);
  const opener = document.activeElement;
  const close = () => {
    document.removeEventListener("keydown", onKey);
    el.classList.add("is-leaving");
    setTimeout(() => { el.remove(); desk.el = null; opener?.focus?.(); }, reducedMotion() ? 0 : 160);
  };
  function onKey(e) {
    if (e.key === "Escape") { if (e.target.closest?.("input, textarea")) e.target.blur(); else close(); }
  }
  document.addEventListener("keydown", onKey);
  el.querySelector(".desk-back").addEventListener("click", close);
  el.querySelector("[data-close]").addEventListener("click", close);
  el.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => showDeskTab(b.dataset.tab)));
  showDeskTab(eventId ? "print" : "add");
  if (eventId) {
    const ev = state.events.get(eventId) || (await world.call("get_world_event", { id: eventId }, { screen: true })).data;
    if (ev) proofEvent(ev);
  }
}

/** Switches the desk between adding a story and changing what is already running. */
function showDeskTab(tab) {
  desk.tab = tab;
  desk.el.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === tab)));
  const body = desk.el.querySelector(".desk-body");
  body.innerHTML = tab === "add"
    ? `<div class="desk-grid">
        <section class="wire" aria-label="Ready-made stories">
          <div class="wire-tools">
            <div class="desk-search"><input type="search" id="wire-search" placeholder="Search stories" value="${esc(desk.query)}" aria-label="Search the ready-made stories" autocomplete="off"></div>
            <div class="wire-kinds" role="group" aria-label="Kind of story">
              ${[["all", "All"], ["calendar", "Diary"], ["real-style", "Real world"], ["storybook", "Storybook"]].map(([v, t]) => `<button type="button" class="pm-chip" aria-pressed="${desk.family === v}" data-family="${v}">${t}</button>`).join("")}
            </div>
          </div>
          <ul class="wire-list" id="wire-list"></ul>
        </section>
        <section class="proof" id="proof" aria-label="The story to add">${proofEmpty()}</section>
      </div>`
    : `<div class="desk-grid">
        <section class="wire" aria-label="Running and coming"><div id="inprint">${skeleton(5)}</div></section>
        <section class="proof" id="proof" aria-label="The story to change">${proofEmpty("Choose one on the left to change it or call it off.")}</section>
      </div>`;
  if (tab === "add") {
    paintWire();
    body.querySelectorAll("[data-family]").forEach((b) => b.addEventListener("click", () => {
      desk.family = b.dataset.family;
      body.querySelectorAll("[data-family]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      paintWire();
    }));
    body.querySelector("#wire-search").addEventListener("input", (e) => { desk.query = e.target.value; paintWire(); });
    wireListKeys(body.querySelector("#wire-list"));
  } else {
    paintInPrint();
  }
}

/** Up and Down (or J and K) move through a desk list and choose; the form beside it follows. */
function wireListKeys(list) {
  list.addEventListener("keydown", (e) => {
    const rows = [...list.querySelectorAll(".wire-item")];
    const at = rows.indexOf(document.activeElement);
    const d = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 }[e.key];
    if (!d || at < 0) return;
    e.preventDefault();
    const next = rows[Math.max(0, Math.min(rows.length - 1, at + d))];
    next.focus();
    next.click();
  });
}

/** The section a ready-made story prints in; older templates carry only their family. */
function sectionOf(t) {
  return t.section || FAMILY_NAMES[t.family] || "News";
}

function proofEmpty(text = "Choose a story on the left. You can set when it starts, how long it runs and how strong it is.") {
  return `<p class="proof-empty">${esc(text)}</p>`;
}

function paintWire() {
  const q = desk.query.trim().toLowerCase();
  const list = state.library.filter((t) => (desk.family === "all" || t.family === desk.family)
    && (!q || `${t.title} ${t.headline} ${(t.tags || []).join(" ")}`.toLowerCase().includes(q)));
  const ul = desk.el.querySelector("#wire-list");
  ul.innerHTML = list.length
    ? list.map((t) => `<li><button type="button" class="wire-item${desk.selected === t.id ? " is-on" : ""}" data-tpl="${esc(t.id)}">
        <b>${esc(t.title)}</b><small>${esc(sectionOf(t))}${t.region ? ` · ${esc(regionWords(t.region).replace(/^in /, ""))}` : ""}</small>
      </button></li>`).join("")
    : `<li>${state.library.length
      ? emptyState({ title: "Nothing matches.", text: "Try fewer words." })
      : emptyState({ title: "No ready-made stories.", text: "What is already running can still be changed." })}</li>`;
  ul.querySelectorAll("[data-tpl]").forEach((b) => b.addEventListener("click", () => {
    ul.querySelectorAll(".wire-item").forEach((x) => x.classList.toggle("is-on", x === b));
    proofTemplate(state.byTemplate.get(b.dataset.tpl));
  }));
}

/** The form for a ready-made story: how it will print and what it will do, with when, how long and how strong. */
function proofTemplate(tpl) {
  desk.selected = tpl.id;
  desk.editing = null;
  const [min, max] = lengthRange(tpl);
  const mid = tpl.fixed?.length_days || Math.round((min + max) / 2);
  const proof = desk.el.querySelector("#proof");
  proof.innerHTML = `<div class="proof-sheet">
    <p class="kick">${esc(sectionOf(tpl))}</p>
    <h3 class="proof-head">${esc(tpl.headline)}</h3>
    <p class="proof-story">${esc(tpl.story)}</p>
    ${tpl.family === "storybook" && tpl.source ? `<p class="story-source">From ${esc(tpl.source)}.</p>` : ""}
    <p class="trade-h">What it will do to trade</p>
    <ul class="trade-lines" id="proof-effects"></ul>
  </div>
  <div class="dials">
    <label class="field"><span>Starts</span><input class="input" type="date" id="d-start" min="${today()}" value="${today()}"></label>
    <label class="field"><span>Runs <b id="d-len-words"></b></span><input type="range" id="d-len" min="${min}" max="${max}" value="${mid}"></label>
    <label class="field"><span>Strength <b id="d-k-words"></b></span><input type="range" id="d-k" min="0.5" max="1.5" step="0.1" value="1"></label>
  </div>
  <div class="desk-foot"><button class="btn primary" type="button" id="send">Add to the news</button><span class="desk-said" id="said" aria-live="polite"></span></div>`;
  const update = () => {
    const k = Number(proof.querySelector("#d-k").value);
    const n = Number(proof.querySelector("#d-len").value);
    const start = proof.querySelector("#d-start").value || today();
    proof.querySelector("#d-len-words").textContent = spanWords(start, addDays(start, n - 1));
    proof.querySelector("#d-k-words").textContent = strengthWords(k);
    paintProofEffects(scaleEffects(tpl.effects, k), tpl.region, tpl.why);
  };
  proof.querySelectorAll("input").forEach((i) => i.addEventListener("input", update));
  update();
  proof.querySelector("#send").addEventListener("click", () => sendToPress(tpl));
  proof.scrollTop = 0;
}

function paintProofEffects(effects, region, why = {}) {
  const ul = desk.el.querySelector("#proof-effects");
  const lines = effectLines(effects, region);
  ul.innerHTML = lines.map((l) => `<li><span>${esc(l.text)}</span>${why?.[l.path] ? `<small>${esc(why[l.path])}</small>` : ""}</li>`).join("")
    || `<li><span>No effect on trade.</span></li>`;
}

/** Causes the event for real (add_world_event). The answer is written beside the button, where you pressed. */
async function sendToPress(tpl) {
  const proof = desk.el.querySelector("#proof");
  const k = Number(proof.querySelector("#d-k").value);
  const n = Number(proof.querySelector("#d-len").value);
  const start = proof.querySelector("#d-start").value || today();
  const input = { template: tpl.id, start, duration_days: n };
  if (k !== 1) input.effects = scaleEffects(tpl.effects, k);
  const button = proof.querySelector("#send");
  const said = proof.querySelector("#said");
  button.disabled = true;
  said.textContent = "Adding…";
  const res = await world.call("add_world_event", input);
  button.disabled = false;
  if (!res.ok) {
    said.className = "desk-said is-bad";
    said.textContent = plainText(res.error.message);
    return;
  }
  said.className = "desk-said is-good";
  said.textContent = start === today() ? "Added. It is in today's paper. Move time on to see what it does." : `Added. It runs from ${shortDate(`${start}T12:00:00Z`)}.`;
  button.textContent = "Add it again";
  // The front page catches up through world.onChange, the same way it would for an outside AI.
}

/** What is acting now and what is coming: each can be changed or called off. */
async function paintInPrint(highlight = null) {
  const box = desk.el?.querySelector("#inprint");
  if (!box) return;
  const [active, coming] = await Promise.all([
    world.call("list_world_events", { status: "active", limit: EVENT_LIMIT }, { screen: true }),
    world.call("list_world_events", { status: "scheduled", limit: EVENT_LIMIT }, { screen: true }),
  ]);
  if (!active.ok) { box.innerHTML = emptyState({ title: "The list did not load.", text: "Try again in a moment." }); return; }
  const soon = (coming.ok ? coming.data.events : []).filter((e) => e.start <= addDays(today(), 60)).sort((a, b) => (a.start < b.start ? -1 : 1));
  const row = (e) => `<li><button type="button" class="wire-item${e.id === (highlight || desk.editing) ? " is-on" : ""}" data-edit="${esc(e.id)}">
      <b>${esc(e.title)}</b><small>${esc(standingWords(e))}${e.origin === "added" ? " · added by hand" : ""}</small></button></li>`;
  box.innerHTML = `
    <p class="print-group">Running today</p>
    ${active.data.events.length ? `<ul class="wire-list">${active.data.events.map(row).join("")}</ul>` : `<p class="col-quiet">Nothing running.</p>`}
    <p class="print-group">Coming in the next two months</p>
    ${soon.length ? `<ul class="wire-list">${soon.map(row).join("")}</ul>` : `<p class="col-quiet">Nothing booked.</p>`}`;
  const all = [...active.data.events, ...soon];
  box.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => {
    box.querySelectorAll(".wire-item").forEach((x) => x.classList.toggle("is-on", x === b));
    proofEvent(all.find((e) => e.id === b.dataset.edit));
  }));
  box.querySelectorAll(".wire-list").forEach(wireListKeys);
}

/** Two presses to call off: the first asks, the second does it. WHY: calling off the weather by accident is too easy. */
async function spike(button, id) {
  const said = desk.el.querySelector("#said");
  if (!button.classList.contains("is-sure")) {
    button.classList.add("is-sure");
    button.textContent = "Press again to call it off";
    setTimeout(() => { if (button.isConnected) { button.classList.remove("is-sure"); button.textContent = "Call it off"; } }, 3500);
    return;
  }
  button.disabled = true;
  const res = await world.call("cancel_world_event", { id, reason: "Called off at the editor's desk" });
  button.disabled = false;
  if (!res.ok) { said.className = "desk-said is-bad"; said.textContent = plainText(res.error.message); return; }
  desk.editing = null;
  desk.el.querySelector("#proof").innerHTML = proofEmpty("Called off. It stops acting from today.");
  await paintInPrint();
}

/** The form for an event already running or booked, with its words, dates and strength open to change. */
function proofEvent(ev) {
  if (!ev) return;
  if (desk.tab !== "print") showDeskTab("print");
  desk.editing = ev.id;
  desk.selected = null;
  const started = ev.start <= today();
  const proof = desk.el.querySelector("#proof");
  proof.innerHTML = `<div class="proof-sheet">
    <p class="kick">${esc(standingWords(ev))}</p>
    <label class="field"><span>Headline</span><textarea class="textarea proof-edit is-head" id="e-head" rows="2">${esc(ev.headline || ev.title)}</textarea></label>
    <label class="field"><span>Story</span><textarea class="textarea proof-edit" id="e-story" rows="4">${esc(ev.story)}</textarea></label>
    ${started ? `<p class="proof-note">The story already printed stays as it was printed.</p>` : ""}
    <p class="trade-h">What it does to trade</p>
    <ul class="trade-lines" id="proof-effects"></ul>
  </div>
  <div class="dials">
    ${started ? "" : `<label class="field"><span>Starts</span><input class="input" type="date" id="e-start" min="${today()}" value="${esc(ev.start)}"></label>`}
    <label class="field"><span>Ends</span><input class="input" type="date" id="e-end" min="${today()}" value="${esc(ev.end)}"></label>
    <label class="field"><span>Strength <b id="d-k-words"></b></span><input type="range" id="d-k" min="0.5" max="1.5" step="0.1" value="1"></label>
  </div>
  <div class="desk-foot"><button class="btn primary" type="button" id="save">Save changes</button><button class="btn danger" type="button" id="spike">Call it off</button><span class="desk-said" id="said" aria-live="polite"></span></div>`;
  const update = () => {
    const k = Number(proof.querySelector("#d-k").value);
    proof.querySelector("#d-k-words").textContent = strengthWords(k);
    paintProofEffects(scaleEffects(ev.effects, k), ev.region, state.byTemplate.get(ev.template)?.why);
  };
  proof.querySelector("#d-k").addEventListener("input", update);
  update();
  proof.querySelector("#save").addEventListener("click", () => saveEdit(ev));
  proof.querySelector("#spike").addEventListener("click", (e) => spike(e.currentTarget, ev.id));
}

/** Sends only what changed (edit_world_event), so the record of actions shows exactly what the editor did. */
async function saveEdit(ev) {
  const proof = desk.el.querySelector("#proof");
  const said = proof.querySelector("#said");
  const input = { id: ev.id };
  const head = proof.querySelector("#e-head").value.trim();
  const story = proof.querySelector("#e-story").value.trim();
  const start = proof.querySelector("#e-start")?.value;
  const end = proof.querySelector("#e-end").value;
  const k = Number(proof.querySelector("#d-k").value);
  if (head && head !== (ev.headline || ev.title)) input.headline = head;
  if (story && story !== ev.story) input.story = story;
  if (start && start !== ev.start) input.start = start;
  if (end && end !== ev.end) input.end = end;
  if (k !== 1) input.effects = scaleEffects(ev.effects, k);
  if (Object.keys(input).length === 1) { said.className = "desk-said"; said.textContent = "Nothing has changed yet."; return; }
  said.className = "desk-said";
  said.textContent = "Saving…";
  const res = await world.call("edit_world_event", input);
  if (!res.ok) { said.className = "desk-said is-bad"; said.textContent = plainText(res.error.message); return; }
  proofEvent(res.data);
  const again = desk.el.querySelector("#said");
  again.className = "desk-said is-good";
  again.textContent = "Saved. It acts like this from now on.";
  await paintInPrint(ev.id);
}

// ------------------------------------------------------------------ wiring

function setMasthead(name) {
  // The name lives only in apps.json; the masthead sets it whole, in the paper's own serif.
  document.querySelector("#title").textContent = name;
}

async function refresh() {
  const err = await loadEdition();
  paintPaper(err);
}

$("#pages").addEventListener("click", (e) => {
  const open = e.target.closest("[data-open]");
  if (open) { openStory(open.dataset.open); return; }
  const ev = e.target.closest("[data-event-open]");
  if (ev) openEvent(ev.dataset.eventOpen);
});
$("#backissue").addEventListener("click", (e) => { if (e.target.closest("[data-today]")) goTo(null); });
$("#earlier").addEventListener("click", () => step(-1));
$("#later").addEventListener("click", () => step(1));
$("#desk-open").addEventListener("click", () => openDesk());
$("#cal").addEventListener("click", (e) => {
  const b = e.target.closest("[data-date]");
  if (b) { goTo(b.dataset.date); $("#paper").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth" }); }
});
$("#month-prev").addEventListener("click", () => { state.month = addDays(`${state.month}-01`, -1).slice(0, 7); paintCalendar(); });
$("#month-next").addEventListener("click", () => { state.month = addDays(`${state.month}-01`, 32).slice(0, 7); paintCalendar(); });
$("#jump").addEventListener("change", (e) => { if (e.target.value) goTo(e.target.value); });
/**
 * The keyboard, as in a reader. Keys act only when you are not typing and nothing is open over the page.
 *   Left: an earlier edition   Right: a later one   T: today's paper   E: the editor's desk
 *   J or K: move through the stories on the page (Enter opens one)
 */
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || desk.el || document.querySelector(".over") || e.target.closest?.("input, textarea, select")) return;
  const links = [...document.querySelectorAll("#pages [data-open]")];
  const at = links.indexOf(document.activeElement);
  const move = (d) => { const n = links[at < 0 ? 0 : Math.max(0, Math.min(links.length - 1, at + d))]; n?.focus(); n?.scrollIntoView({ block: "nearest" }); };
  const keys = {
    ArrowLeft: () => step(-1), ArrowRight: () => { if (state.view) step(1); }, t: () => goTo(null), e: () => openDesk(),
    j: () => move(1), k: () => move(-1),
  };
  if (!keys[e.key]) return;
  e.preventDefault();
  keys[e.key]();
});

state.now = (await world.clock()).now;
state.month = today().slice(0, 7);
$("#jump").max = today();
$("#pages").innerHTML = `<div class="front-loading">${skeleton(8)}</div>`;
await loadLibrary();
await refresh();
$("#later").disabled = true;
paintCalendar();

// Stay live: a new day brings a new paper; an outside AI causing an event stops the press.
document.addEventListener("ot:day", (e) => {
  state.now = e.detail.now;
  $("#jump").max = today();
  if (e.detail.partial) { $("#dateline").textContent = longDate(state.now); return; }
  newEdition();
});
world.onChange((change) => {
  if (change.reset) { state.view = null; state.events.clear(); refresh(); paintCalendar(); return; }
  if (change.previousNow && change.now !== change.previousNow) return;  // a day passing is handled by ot:day
  const acted = change.entries.some((e) => !isScreenRead(e) && /world_event|news/.test(e.tool || ""));
  if (acted) { newEdition({ stopPress: true }); if (desk.el) paintInPrint(); }
});
