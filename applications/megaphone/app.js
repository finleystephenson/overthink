// Megaphone: marketing and sales. Who came to the shop and what they did, every campaign and what it brought in,
// the monthly marketing budget, the newsletter, the two social accounts, and the businesses that might buy in bulk.
// Reads: web_sessions, list_campaigns, get_levers, social_stats, list_social_posts, list_emails, list_customers,
// list_prospects, get_prospect. Actions: set_marketing_budget, create_campaign, update_campaign, end_campaign,
// send_email, draft_email, send_outreach. Nothing here is made up: a campaign started, a post made or a prospect
// answered by anyone, or any AI, shows here at once.
//
// Address bar: #overview, #campaigns, #newsletter, #social, #prospects.
import { startApp, esc, money, money2, num, plural, emptyState, skeleton, slideOver, toast, avatar, shortDate, longDate, appHref, words } from "../lib/ui.js";
import { isScreenRead } from "../lib/client.js";
import { plainText } from "../lib/plain.js";
import { columns, spark } from "../lib/chart.js";
import { changesMade, changeCard, MONEY_MEASURES } from "../lib/results.js";

const APP_ID = "megaphone";
const { world, app, apps } = await startApp({ id: APP_ID });
document.title = `${app.name} · Overthought & Co.`;

/** Where visitors come from, in words. */
const CHANNELS = [
  { key: "direct", name: "Typed us in" },
  { key: "search", name: "Search" },
  { key: "social", name: "Social" },
  { key: "email", name: "Email" },
  { key: "referral", name: "Other sites" },
];
const CAMPAIGN_CHANNEL = { search: "Search", social: "Social", email: "Email", none: "On the site" };
const STAGES = [
  { status: "new", name: "Not yet contacted" },
  { status: "contacted", name: "Contacted" },
  { status: "replied", name: "Replied" },
  { status: "customer", name: "Customers" },
  { status: "declined", name: "Said no" },
];
const OUTREACH = { email: "Email", letter: "Letter", phone: "Phone", visit: "Visit" };
const PER_MONTH = { week: 52 / 12, month: 1, quarter: 1 / 3, year: 1 / 12 };
/** The newsletter goes out from the marketing box, as every newsletter before it did. */
const NEWS_BOX = "toad";
const SUBSCRIBERS = "subscribers@overthought.example";
/** The changes this screen makes, whose results it shows. */
const MY_TOOLS = ["set_marketing_budget", "create_campaign", "update_campaign", "end_campaign", "send_email", "send_outreach"];

const ICONS = {
  overview: '<path d="M4 19V10M10 19V5M16 19v-7M21 19H3"/>',
  campaigns: '<path d="M4 10v4h3l7 4.5v-13L7 10Z"/><path d="M17.5 9a4 4 0 0 1 0 6"/>',
  newsletter: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  social: '<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.5"/>',
  prospects: '<path d="M3.5 20V10l5 3V10l5 3V7.5l7 3.5V20Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  out: '<path d="M7 17 17 7M9 7h8v8"/>',
};

function ico(name, size = 18) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

const VIEWS = [
  { id: "overview", label: "Overview" },
  { id: "campaigns", label: "Campaigns" },
  { id: "newsletter", label: "Newsletter" },
  { id: "social", label: "Social" },
  { id: "prospects", label: "Prospects" },
];

const main = document.getElementById("main");

const S = {
  view: "overview",
  now: null,
  results: [],
  audience: "news",
  people: {},           // audience id -> [{ name, email }], read once from list_customers
  days: null,
  campaigns: null,
  levers: null,
  social: null,
  posts: {},
  letters: null,
  letterResults: new Map(),
  prospects: {},
  sector: "",
  campaignView: "running",
  knownProspects: new Map(),
  products: new Map(),
  said: {},             // view id -> { text, tone }: feedback that must outlive a redraw
  busy: false,
  again: false,
};

// ------------------------------------------------------------------ helpers

function read(tool, input = {}) {
  return world.call(tool, input, { screen: true }).catch((e) => ({ ok: false, error: { code: "offline", message: e.message } }));
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function today() {
  return (S.now || new Date().toISOString()).slice(0, 10);
}

function pct(v) {
  return Number.isFinite(v) ? `${v < 0.1 ? (Math.round(v * 1000) / 10).toFixed(1) : Math.round(v * 100)}%` : "–";
}

function sum(list, f) {
  return list.reduce((n, x) => n + (f(x) || 0), 0);
}

function day(d) {
  return shortDate(`${d}T00:00:00Z`);
}

/** One quiet line for a part of the screen that did not load. */
function failed(title) {
  return emptyState({ title, text: "Try again in a moment." });
}

/** Feedback beside the button that was pressed, kept across redraws until the next action in that view. */
function saidHtml(view) {
  const s = S.said[view];
  return `<p class="said ${s?.tone || ""}" role="status">${esc(s?.text || "")}</p>`;
}

function say(view, text, tone = "good") {
  S.said[view] = { text, tone };
  main.querySelectorAll(`[data-said="${view}"]`).forEach((el) => { el.className = `said ${tone}`; el.textContent = text; });
}

// ------------------------------------------------------------------ loading

async function load() {
  const clock = await world.clock().catch(() => null);
  if (clock?.now) S.now = clock.now;
  const from = addDays(today(), -89);
  const [days, campaigns, levers, social, squint, mutter, letters] = await Promise.all([
    read("web_sessions", { from }),
    read("list_campaigns"),
    read("get_levers"),
    read("social_stats", { days: 60 }),
    read("list_social_posts", { network: "squint", kind: "post", limit: 30 }),
    read("list_social_posts", { network: "mutter", kind: "post", limit: 30 }),
    read("list_emails", { mailbox: NEWS_BOX, folder: "sent", limit: 60 }),
  ]);
  Object.assign(S, { days, campaigns, levers, social, letters, posts: { squint, mutter } });
  S.results = await changesMade(world, MY_TOOLS);
  await Promise.all([loadProspects(), loadResultsOfLetters()]);
}

/** Each stage of the pipeline is its own list, so every stage shows even when one is long. */
async function loadProspects() {
  const base = S.sector ? { sector: S.sector } : {};
  const answers = await Promise.all(STAGES.map((s) => read("list_prospects", { ...base, status: s.status })));
  S.prospects = Object.fromEntries(STAGES.map((s, i) => [s.status, answers[i]]));
  if (!S.sectors && answers[0].ok) {
    const all = await read("list_prospects", {});
    S.sectors = all.ok ? [...new Set(all.data.prospects.map((p) => p.sector))].sort() : [];
    S.prospectTotal = all.ok ? all.data.total : 0;
  }
}

/**
 * Who a newsletter can go to, from list_customers: everyone who said yes to marketing mail, or every customer.
 * Read once per audience, a page of 200 at a time. WHY: it used to be guessed from the last hundred contacts.
 */
async function loadPeople(audience) {
  if (S.people[audience] || audience === "list") return;
  const base = audience === "news" ? { marketing_opt_in: true } : {};
  const first = await read("list_customers", { ...base, limit: 200 });
  if (!first.ok) { S.people[audience] = []; return; }
  const pages = Math.ceil(first.data.total / 200);
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => read("list_customers", { ...base, limit: 200, offset: (i + 1) * 200 })));
  S.people[audience] = [first, ...rest].flatMap((r) => (r.ok ? r.data.customers : [])).filter((c) => c.email);
}

/** Newsletters already sent: mail from the marketing box to the subscriber list, to customers, or tied to a campaign. */
function newsletters() {
  if (!S.letters?.ok) return null;
  return S.letters.data.emails.filter((e) => e.links?.campaign_id || (e.to || []).length >= 3 || (e.to || []).some((t) => t.address === SUBSCRIBERS));
}

/** What each newsletter brought in, as the business wrote it on the email. */
async function loadResultsOfLetters() {
  const sent = newsletters() || [];
  await Promise.all(sent.slice(0, 8).map(async (e) => {
    const r = await read("get_email_thread", { email_id: e.id });
    const msg = r.ok ? r.data.messages.find((m) => m.id === e.id) : null;
    if (msg?.audience) S.letterResults.set(e.id, msg.audience);
  }));
}

// ------------------------------------------------------------------ the shell

function shell() {
  main.innerHTML = `<div class="ws">
    <nav class="ws-rail" aria-label="${esc(app.name)}">
      <button class="btn primary ws-main-btn" id="newCamp" title="Start a campaign (N)">${ico("plus", 17)}<span>Start a campaign</span></button>
      <ul class="rail-list">${VIEWS.map((v) => `<li><a class="rail-row" href="#${v.id}" data-view="${v.id}">${ico(v.id, 17)}<span class="rail-name">${esc(v.label)}</span><span class="rail-count" data-badge="${v.id}"></span></a></li>`).join("")}</ul>
    </nav>
    <section class="ws-view" id="view" tabindex="-1"></section>
  </div>`;
  main.querySelector("#newCamp").addEventListener("click", () => campaignForm());
}

function markNav() {
  main.querySelectorAll(".rail-row").forEach((a) => {
    const on = a.dataset.view === S.view;
    a.classList.toggle("is-on", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

// ------------------------------------------------------------------ overview: the week, the budget, what changes did

function drawOverview(view) {
  const d = S.days;
  const whole = d?.ok ? d.data.days.filter((x) => x.date < today()) : [];
  const last = whole.slice(-7), prev = whole.slice(-14, -7);
  const visits = sum(last, (x) => x.total_visits), before = sum(prev, (x) => x.total_visits), orders = sum(last, (x) => x.orders);
  const change = before ? Math.round((visits / before - 1) * 100) : null;
  const L = S.levers?.ok ? S.levers.data : null;
  const fig = (label, value, sub) => `<div class="fig"><dt>${esc(label)}</dt><dd>${esc(value)}</dd>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`;
  view.innerHTML = `<div class="v-wrap">
    <dl class="figs">
      ${fig("Visitors, last seven days", d?.ok ? num(visits) : "–", change == null ? "" : `${change === 0 ? "The same as" : `${Math.abs(change)}% ${change > 0 ? "more than" : "fewer than"}`} the week before`)}
      ${fig("Orders from them", d?.ok ? num(orders) : "–", visits ? `${pct(orders / visits)} of visitors ordered` : "")}
      ${fig("Campaigns running", S.campaigns?.ok ? num(S.campaigns.data.campaigns.filter(isRunning).length) : "–", "")}
      ${fig("Marketing budget", L ? money(L.marketing_per_month ?? L.planned_marketing_per_month ?? 0) : "–", "a month")}
    </dl>
    <div class="mg-cols">
      <section class="sect" id="budget"></section>
      <section class="sect"><h2 class="t-h">What your changes did</h2>${resultsHtml()}</section>
    </div>
    <section class="sect"><div class="sect-head"><h2 class="t-h">Visitors each day</h2><span class="t-label">Six weeks</span></div><div id="vChart"></div></section>
    <div class="mg-cols">
      <section class="sect" id="sources"></section>
      <section class="sect" id="funnel"></section>
    </div>
  </div>`;
  paintBudget(view.querySelector("#budget"));
  if (d?.ok) {
    const six = d.data.days.slice(-42);
    columns(view.querySelector("#vChart"), {
      title: "Visitors each day", labels: six.map((x) => x.date), height: 200, fmt: num,
      xFmt: (l, i, long) => (long ? longDate(`${l}T00:00:00Z`) : day(l)),
      columns: [{ name: "Visitors", values: six.map((x) => x.total_visits), color: "var(--chart-you)" }],
      tip: (i) => `<b>${esc(longDate(`${six[i].date}T00:00:00Z`))}</b>${CHANNELS.map((c) => `<span class="ch-row">${esc(c.name)}<b>${esc(num(six[i].visits?.[c.key] || 0))}</b></span>`).join("")}<span class="ch-row">In all<b>${esc(num(six[i].total_visits))}</b></span>`,
    });
    paintSources(view.querySelector("#sources"), last);
    paintFunnel(view.querySelector("#funnel"), d.data.days.slice(-30));
  } else view.querySelector("#vChart").innerHTML = failed("The visitor figures did not load.");
}

/** Where last week's visitors came from: a sorted table with one ink bar each, not five colours. */
function paintSources(el, last) {
  const rows = CHANNELS.map((c) => ({ ...c, v: sum(last, (x) => x.visits?.[c.key]) })).sort((a, b) => b.v - a.v);
  const total = sum(rows, (r) => r.v) || 1;
  el.innerHTML = `<div class="sect-head"><h2 class="t-h">Where they came from</h2><span class="t-label">Last seven days</span></div>
    <table class="tbl"><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="r">${esc(num(r.v))}</td><td class="r muted">${esc(pct(r.v / total))}</td><td class="mg-bar"><span class="share" style="--w:${(r.v / (rows[0].v || 1)).toFixed(3)}"><i></i></span></td></tr>`).join("")}</tbody></table>`;
}

/** From a visit to an order, the last 30 days, as a ruled table with one ink bar per step. */
function paintFunnel(el, last) {
  const visits = sum(last, (d) => d.total_visits);
  const baskets = sum(last, (d) => d.baskets_started);
  const orders = sum(last, (d) => d.orders);
  const lost = sum(last, (d) => d.baskets_lost_to_stockouts);
  const steps = [
    { name: "Came to the shop", v: visits },
    { name: "Looked at a product (page views)", v: sum(last, (d) => sum(Object.values(d.product_page_views || {}), (x) => x)) },
    { name: "Put something in a basket", v: baskets },
    { name: "Ordered", v: orders },
  ];
  const top = Math.max(1, ...steps.map((s) => s.v));
  el.innerHTML = `<div class="sect-head"><h2 class="t-h">From a visit to an order</h2><span class="t-label">Last 30 days</span></div>
    <table class="tbl"><tbody>${steps.map((s) => `<tr><td>${esc(s.name)}</td><td class="r">${esc(num(s.v))}</td><td class="mg-bar"><span class="share" style="--w:${(s.v / top).toFixed(3)}"><i></i></span></td></tr>`).join("")}</tbody></table>
    <p class="t-label mg-note">${baskets ? `${pct(1 - orders / baskets)} of baskets were left behind.` : ""}${lost ? ` ${plural(lost, "basket")} lost to an empty shelf.` : ""}</p>`;
}

function paintBudget(el) {
  const r = S.levers;
  if (!r?.ok) { el.innerHTML = `<h2 class="t-h">Marketing budget</h2>${failed("The budget did not load.")}`; return; }
  const L = r.data;
  const planned = L.planned_marketing_per_month ?? 0;
  const now = L.marketing_per_month ?? planned;
  const max = Math.max(500, Math.ceil((Math.max(planned, now) * 5) / 50) * 50);
  const step = max > 2000 ? 10 : 1;
  el.innerHTML = `<h2 class="t-h">Marketing budget</h2>
    <div class="mg-budget">
      <p class="mg-b-num"><b id="bOut">${money(now)}</b><span>a month</span></p>
      <p class="od-sub" id="bWas">${L.marketing_per_month == null ? "As planned." : `The plan says ${money(planned)}.`}</p>
      <input class="mg-slide" id="bIn" type="range" min="0" max="${max}" step="${step}" value="${now}" aria-label="Monthly marketing budget" style="--plan:${((planned / max) * 100).toFixed(1)}%">
      <div class="mg-scale t-label"><span>£0</span><span>${money(max)}</span></div>
      <div class="act-row"><button class="btn primary" id="bGo" disabled>Set the budget</button>${L.marketing_per_month == null ? "" : `<button class="btn ghost" id="bReset">Back to the plan</button>`}<span class="t-label">Starts tomorrow</span></div>
      <p class="said ${S.said.budget?.tone || ""}" data-said="budget" role="status">${esc(S.said.budget?.text || "")}</p>
    </div>`;
  const input = el.querySelector("#bIn");
  const go = el.querySelector("#bGo");
  const fill = () => input.style.setProperty("--fill", `${(Number(input.value) / max) * 100}%`);
  fill();
  input.addEventListener("input", () => {
    const v = Number(input.value);
    fill();
    el.querySelector("#bOut").textContent = money(v);
    const d = v - planned;
    el.querySelector("#bWas").textContent = v === now ? (L.marketing_per_month == null ? "As planned." : `The plan says ${money(planned)}.`)
      : `${d === 0 ? "The same as the plan" : `${money(Math.abs(d))} a month ${d > 0 ? "more" : "less"} than the plan`}. About ${money(v / 30.4)} a day.`;
    go.disabled = v === now;
  });
  go.addEventListener("click", async () => {
    go.disabled = true;
    const r2 = await world.call("set_marketing_budget", { monthly: Number(input.value), reason: "Set in Megaphone" });
    if (!r2.ok) { say("budget", r2.error.message, "bad"); go.disabled = false; return; }
    S.levers = r2;
    say("budget", `The budget is now ${money(r2.data.marketing_per_month)} a month, from tomorrow. Move time on to see what it does.`);
    refresh();
  });
  el.querySelector("#bReset")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    const r2 = await world.call("set_marketing_budget", { reset: true, reason: "Back to the plan, in Megaphone" });
    if (!r2.ok) { say("budget", r2.error.message, "bad"); e.target.disabled = false; return; }
    S.levers = r2;
    say("budget", "The budget is back to the plan from tomorrow.");
    refresh();
  });
}

/** Plain words for one change made on this screen. */
function describe(a) {
  const line = (a.changes || []).join(" ");
  if (a.tool === "set_marketing_budget") {
    const m = line.match(/→\s*([\d.]+|as planned)/);
    return m && m[1] !== "as planned" ? `Budget set to ${money(Number(m[1]))} a month.` : "Budget put back to the plan.";
  }
  if (a.tool === "create_campaign") return "Started a campaign.";
  if (a.tool === "update_campaign") return "Changed a campaign.";
  if (a.tool === "end_campaign") return "Ended a campaign.";
  if (a.tool === "send_email") return "A newsletter went out.";
  if (a.tool === "send_outreach") {
    const id = line.match(/prospect (PR-\d+)/)?.[1];
    const p = Object.values(S.prospects).flatMap((r) => (r?.ok ? r.data.prospects : [])).find((x) => x.id === id);
    return p ? `Wrote to ${p.name}.` : "Wrote to a prospect.";
  }
  return "A change.";
}

function resultsHtml() {
  const list = S.results.filter((a) => a.tool !== "send_email" || (a.changes || []).some((c) => /email .* sent from toad/.test(c)));
  return list.length ? `<ul class="rs-list">${list.slice(0, 6).map((a) => changeCard(a, describe(a), a.tool === "send_email" ? [...MONEY_MEASURES, { key: "email_opens", label: "opened" }, { key: "unsubscribes", label: "unsubscribed", goodWhenUp: false }] : MONEY_MEASURES)).join("")}</ul>`
    : `<p class="rs-empty">Change the budget, start a campaign, send a newsletter or write to a prospect. Then move time on. Each change shows here with what it did, against the same business left alone.</p>`;
}

// ------------------------------------------------------------------ campaigns

function isRunning(c) {
  return c.start <= today() && (!c.end || c.end >= today()) && c.status !== "ended";
}

/** Campaigns made here (with create_campaign) carry a monthly spend; only those can be changed or ended. */
function ours(c) {
  return c.monthly_spend != null;
}

function drawCampaigns(view) {
  if (!S.campaigns?.ok) { view.innerHTML = `<div class="v-wrap">${failed("The campaigns did not load.")}</div>`; return; }
  const all = S.campaigns.data.campaigns.slice().sort((a, b) => (a.start < b.start ? 1 : -1));
  const year = today().slice(0, 4);
  const views = { running: all.filter((c) => isRunning(c) || c.start > today()), year: all.filter((c) => c.start.startsWith(year)), all };
  const list = views[S.campaignView];
  const y = views.year;
  view.innerHTML = `<div class="v-wrap is-wide">
    <dl class="figs">
      <div class="fig"><dt>Spent on campaigns in ${esc(year)}</dt><dd>${esc(money(sum(y, (c) => c.spend_to_date ?? c.spend)))}</dd></div>
      <div class="fig"><dt>Visits they brought</dt><dd>${esc(num(sum(y, (c) => c.visits)))}</dd></div>
      <div class="fig"><dt>Orders put down to them</dt><dd>${esc(num(sum(y, (c) => c.orders_attributed)))}</dd></div>
      <div class="fig"><dt>Each order cost</dt><dd>${sum(y, (c) => c.orders_attributed) ? esc(money2(sum(y, (c) => c.spend_to_date ?? c.spend) / sum(y, (c) => c.orders_attributed))) : "–"}</dd></div>
    </dl>
    <div class="toolbar mg-tools">
      <div class="chips" role="group" aria-label="Which campaigns">
        ${[["running", "Running and coming up"], ["year", "This year"], ["all", "Every one"]].map(([id, l]) => `<button class="pm-chip" data-cv="${id}" aria-pressed="${S.campaignView === id}">${l} <span class="chip-n">${num(views[id].length)}</span></button>`).join("")}
      </div>
      ${saidHtml("campaigns").replace('class="said', 'data-said="campaigns" class="said')}
    </div>
    ${list.length ? `<table class="tbl mg-camps"><thead><tr><th>Campaign</th><th>Where</th><th>Runs</th><th>Code</th><th class="r">Visits</th><th class="r">Orders</th><th class="r">Spent</th><th class="r">Each order</th><th></th></tr></thead><tbody>
      ${list.map((c) => {
        const spent = c.spend_to_date ?? c.spend;
        const state = c.start > today() ? `Starts ${day(c.start)}` : isRunning(c) ? "Running" : "Ended";
        return `<tr data-camp="${esc(c.id)}"><td><b class="w5">${esc(c.name)}</b><small class="mg-sub">${esc(state)}${ours(c) ? ` · ${esc(money(c.monthly_spend))} a month` : ""}</small></td>
          <td>${esc(CAMPAIGN_CHANNEL[c.channel] || words(c.channel))}</td>
          <td class="mono">${esc(day(c.start))}${c.end ? ` to ${esc(day(c.end))}` : ""}${c.start.slice(0, 4) !== year ? ` ${esc(c.start.slice(0, 4))}` : ""}</td>
          <td class="mono">${c.code ? `${esc(c.code)} · ${esc(num(c.discount_pct))}%` : ""}</td>
          <td class="r">${esc(num(c.visits || 0))}</td><td class="r">${esc(num(c.orders_attributed || 0))}</td><td class="r">${esc(money(spent))}</td>
          <td class="r muted">${c.orders_attributed ? esc(money2(spent / c.orders_attributed)) : ""}</td>
          <td class="r">${ours(c) && state !== "Ended" ? `<button class="btn small" data-edit="${esc(c.id)}">Change</button>` : ""}</td></tr>`;
      }).join("")}
    </tbody></table>` : emptyState({ title: "Nothing running just now.", text: "Start a campaign to see what it brings in." })}
  </div>`;
  view.querySelectorAll("[data-cv]").forEach((b) => b.addEventListener("click", () => { S.campaignView = b.dataset.cv; draw(); }));
  view.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => campaignForm(all.find((c) => c.id === b.dataset.edit))));
}

/**
 * Start a campaign, or change or end one made here. The form says what the business allows: channel, dates,
 * monthly spend, and an optional discount code. Changes count from the next day.
 */
function campaignForm(c = null) {
  const t = today();
  const over = slideOver({
    title: c ? c.name : "Start a campaign",
    body: `<form class="mg-form" id="cForm">
      <p class="t-lede">${c ? "Changes count from tomorrow. What it did so far stays on the record." : "It starts on the day you pick. Move time on to see the visits and orders it brings, against the same business left alone."}</p>
      <label class="field"><span>Name</span><input class="input" name="name" required value="${esc(c?.name || "")}" placeholder="Winter socks push"></label>
      ${c ? "" : `<div class="field"><span>Where it runs</span><div class="chips mg-radio" role="radiogroup">${Object.entries(CAMPAIGN_CHANNEL).map(([k, v], i) => `<label><input type="radio" name="channel" value="${k}" ${i === 0 ? "checked" : ""}><span class="pm-chip">${esc(v)}</span></label>`).join("")}</div></div>`}
      <div class="act-grid">
        ${c ? "" : `<label class="field"><span>Starts</span><input class="input" type="date" name="start" min="${t}" value="${addDays(t, 1)}" required></label>`}
        <label class="field"><span>Ends</span><input class="input" type="date" name="end" min="${t}" value="${esc(c?.end || addDays(t, 28))}" required></label>
        <label class="field"><span>Spend a month (£)</span><input class="input" type="number" name="monthly_spend" min="0" max="50000" step="10" value="${esc(c?.monthly_spend ?? 300)}" required></label>
      </div>
      <div class="act-grid">
        <label class="field"><span>Discount code (optional)</span><input class="input mono-in" name="code" pattern="[A-Z0-9]{3,12}" placeholder="WINTER10" value="${esc(c?.code || "")}"></label>
        <label class="field"><span>Discount (%)</span><input class="input" type="number" name="discount_pct" min="0" max="20" step="1" value="${esc(c?.discount_pct || 0)}"></label>
      </div>
      <p class="said bad" id="cErr" role="alert"></p>
      <div class="act-row"><button class="btn primary" type="submit">${c ? "Save the changes" : "Start it"}</button>${c ? '<button class="btn danger" type="button" id="cEnd">End it today</button>' : ""}</div>
    </form>`,
  });
  const form = over.el.querySelector("#cForm");
  const err = over.el.querySelector("#cErr");
  form.code.addEventListener("input", () => { form.code.value = form.code.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const code = String(f.get("code") || "").trim();
    const pctOff = Number(f.get("discount_pct") || 0);
    const input = { name: String(f.get("name")).trim(), end: f.get("end"), monthly_spend: Number(f.get("monthly_spend")) };
    if (code && pctOff) Object.assign(input, { code, discount_pct: pctOff });
    else if (c?.code) input.discount_pct = 0;
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    const r = c ? await world.call("update_campaign", { campaign_id: c.id, ...input }) : await world.call("create_campaign", { ...input, channel: f.get("channel"), start: f.get("start") });
    btn.disabled = false;
    if (!r.ok) { err.textContent = plainText(r.error.message); return; }
    over.close();
    say("campaigns", c ? `${input.name} is changed from tomorrow.` : `${input.name} starts ${day(String(f.get("start")))}. Move time on to see what it brings.`);
    if (S.view !== "campaigns") location.hash = "#campaigns";
    refresh();
  });
  over.el.querySelector("#cEnd")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    const r = await world.call("end_campaign", { campaign_id: c.id });
    if (!r.ok) { err.textContent = plainText(r.error.message); e.target.disabled = false; return; }
    over.close();
    say("campaigns", `${c.name} ends today. What it did so far stays on the record.`);
    refresh();
  });
  form.name.focus();
}

// ------------------------------------------------------------------ the newsletter

function drawNewsletter(view) {
  const sent = newsletters();
  const keep = view.querySelector("#nForm") ? { subject: view.querySelector("#nSubject").value, text: view.querySelector("#nBody").value } : S.draft;
  const groups = [
    { id: "news", name: "Customers who asked for news" },
    { id: "all", name: "Every customer" },
    { id: "list", name: "The old subscriber list" },
  ];
  view.innerHTML = `<div class="v-wrap">
    <div class="mg-cols mg-news">
      <section>
        <form class="mg-compose" id="nForm">
          <div class="mg-c-line"><span>From</span><b>Mr Toad, marketing</b></div>
          <div class="mg-c-line mg-c-who"><span>To</span><div class="chips mg-radio" role="radiogroup" aria-label="Who gets it">${groups.map((g) => `<label><input type="radio" name="aud" value="${g.id}" ${S.audience === g.id ? "checked" : ""}><span class="pm-chip">${esc(g.name)}</span></label>`).join("")}</div></div>
          <p class="mg-c-hint t-label" id="nHint">${esc(audienceHint())}</p>
          <label class="mg-c-line"><span>Subject</span><input class="mg-c-in" id="nSubject" aria-label="Subject" value="${esc(keep?.subject || "")}" required></label>
          <textarea class="mg-c-body" id="nBody" placeholder="Dear friend of the shop," aria-label="The letter" required>${esc(keep?.text || "")}</textarea>
          <div class="act-row mg-c-foot"><button class="btn primary" type="submit" id="nSend">Send it</button><button class="btn ghost" type="button" id="nDraft">Save a draft</button><span class="t-label"><kbd>⌘</kbd> <kbd>Enter</kbd> sends</span></div>
          <p class="said ${S.said.newsletter?.tone || ""}" data-said="newsletter" role="status">${esc(S.said.newsletter?.text || "")}</p>
        </form>
      </section>
      <section>
        <div class="sect-head"><h2 class="t-h">Sent before</h2><a class="btn small ghost" href="${appHref({ id: "letterbox", status: "ready" })}?mailbox=${NEWS_BOX}&folder=sent">Open in Letterbox</a></div>
        ${!sent ? failed("The newsletters did not load.") : sent.length ? `<ul class="od-rows">${sent.slice(0, 8).map(letterRow).join("")}</ul>` : '<p class="od-sub">No newsletters yet.</p>'}
      </section>
    </div>
  </div>`;
  const form = view.querySelector("#nForm");
  const remember = () => { S.draft = { subject: view.querySelector("#nSubject").value, text: view.querySelector("#nBody").value }; };
  form.addEventListener("input", remember);
  form.addEventListener("submit", (e) => { e.preventDefault(); sendNews("send_email"); });
  view.querySelector("#nBody").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendNews("send_email"); } });
  view.querySelector("#nDraft").addEventListener("click", () => sendNews("draft_email"));
  view.querySelectorAll("[name=aud]").forEach((x) => x.addEventListener("change", async () => {
    S.audience = x.value;
    view.querySelector("#nHint").textContent = audienceHint();
    await loadPeople(S.audience);
    const hint = main.querySelector("#nHint");
    if (hint) hint.textContent = audienceHint();
  }));
  loadPeople(S.audience).then(() => { const hint = main.querySelector("#nHint"); if (hint) hint.textContent = audienceHint(); });
}

/** One line under the audience: who that is, in a sentence. */
function audienceHint() {
  if (S.audience === "list") return "One address for everyone on the old list. No customer is counted, so it shows no results.";
  const p = S.people[S.audience];
  if (!p) return "Finding the customers…";
  if (S.audience === "news") return `${plural(p.length, "customer")} said yes to news from the shop.`;
  return `${plural(p.length, "customer")}. Most never asked for news, so more of them will unsubscribe.`;
}

function letterRow(e) {
  const a = S.letterResults.get(e.id);
  const got = a?.shown || {};
  const res = a?.kind === "marketing_email"
    ? (Object.keys(got).length ? `${num(Math.round(got.opens || 0))} opened · ${num(Math.round(got.clicks || 0))} clicked · ${num(Math.round((got.orders || 0) * 10) / 10)} orders${got.revenue ? ` · ${money(got.revenue)}` : ""}${a.unsubscribed ? ` · ${plural(a.unsubscribed, "unsubscribe")}` : ""}` : `Sent to ${plural(a.plan?.recipients || 0, "customer")}. Move time on to see who opens it.`)
    : plainText(e.snippet || "").replace(/\s+/g, " ").slice(0, 90);
  return `<li><time>${esc(shortDate(e.at))}${e.at.slice(0, 4) !== today().slice(0, 4) ? ` ${esc(e.at.slice(0, 4))}` : ""}</time><span class="grow"><b>${esc(plainText(e.subject))}</b><small>${esc(res)}</small></span></li>`;
}

/** Sends (or drafts) the newsletter as an ordinary email from the marketing box. */
async function sendNews(tool) {
  if (S.audience !== "list") await loadPeople(S.audience);
  const to = S.audience === "list" ? [SUBSCRIBERS] : (S.people[S.audience] || []).map((c) => c.email);
  const subject = main.querySelector("#nSubject").value.trim();
  const text = main.querySelector("#nBody").value.trim();
  if (!subject || !text) return say("newsletter", "A newsletter needs a subject and a few words.", "bad");
  if (!to.length) return say("newsletter", "Nobody to send it to yet.", "bad");
  const btn = main.querySelector(tool === "send_email" ? "#nSend" : "#nDraft");
  btn.disabled = true;
  const r = await world.call(tool, { mailbox: NEWS_BOX, to, subject, body: text });
  btn.disabled = false;
  if (!r.ok) return say("newsletter", plainText(r.error.message), "bad");
  if (tool === "draft_email") return say("newsletter", "Saved as a draft. It is in Letterbox.");
  S.draft = null;
  main.querySelector("#nSubject").value = "";
  main.querySelector("#nBody").value = "";
  say("newsletter", `Sent to ${to.length === 1 ? "the old list" : plural(to.length, "customer")}. Move time on to see who opens it.`);
  refresh();
}

// ------------------------------------------------------------------ the social accounts

function drawSocial(view) {
  if (!S.social?.ok) { view.innerHTML = `<div class="v-wrap">${failed("The social figures did not load.")}</div>`; return; }
  const nets = ["squint", "mutter"].map((id) => ({ id, app: apps.find((a) => a.id === id) || { id, name: id, status: "ready" } }));
  view.innerHTML = `<div class="v-wrap"><div class="mg-nets">${nets.map(netCard).join("")}</div></div>`;
}

function netCard({ id, app: a }) {
  const s = S.social.data[id];
  const days = (s?.days || []).slice().reverse();
  const last30 = days.slice(-30);
  const before = days.at(-31)?.followers ?? days[0]?.followers ?? 0;
  const gained = (s?.followers_now ?? 0) - before;
  const pr = S.posts[id];
  const own = pr?.ok ? pr.data.posts.find((p) => p.author?.kind === "company") : null;
  return `<section class="mg-net">
    <div class="sect-head"><h2 class="t-h">${esc(a.name)}${a.plain ? ` <span class="mg-plain">· ${esc(a.plain)}</span>` : ""}</h2><a class="btn small ghost" href="${appHref(a)}">Open ${ico("out", 14)}</a></div>
    <dl class="figs mg-net-figs">
      <div class="fig"><dt>Followers</dt><dd>${esc(num(s?.followers_now ?? 0))}</dd><small>${gained ? `${gained > 0 ? "+" : "−"}${esc(num(Math.abs(gained)))} in 30 days` : "No change in 30 days"}</small></div>
      <div class="fig"><dt>Saw a post, 30 days</dt><dd>${esc(num(sum(last30, (d) => d.reach)))}</dd><small>${esc(plural(sum(last30, (d) => d.posts), "post"))}</small></div>
    </dl>
    <div class="mg-spark">${spark(last30.map((d) => d.reach), { width: 520, height: 48 })}<span class="t-label">How many saw a post each day</span></div>
    ${own ? `<div class="mg-post">${own.image ? `<img src="/${esc(own.image.replace(/^\//, ""))}" alt="" loading="lazy">` : ""}<p><span class="t-label">Latest, ${esc(shortDate(own.at))}</span>${esc(own.text.slice(0, 160))}${own.text.length > 160 ? "…" : ""}</p></div>` : ""}
  </section>`;
}

// ------------------------------------------------------------------ prospects

/** What a prospect's regular needs come to in a month at their prices (one-off buys left out). */
function monthlyWorth(p) {
  return sum(p.needs || [], (n) => (PER_MONTH[n.every] ? n.qty * n.unit_price * PER_MONTH[n.every] : 0));
}

function drawProspects(view) {
  const first = S.prospects.new;
  if (!first?.ok) { view.innerHTML = `<div class="v-wrap">${failed("The prospects did not load.")}</div>`; return; }
  view.innerHTML = `<div class="v-wrap is-wide">
    <div class="toolbar">
      <p class="t-lede">Businesses and institutions that could buy in bulk. ${S.prospectTotal ? `${esc(num(S.prospectTotal))} in all.` : ""}</p>
      <select class="select is-small" id="pSector" aria-label="Sector"><option value="">Every sector</option>${(S.sectors || []).map((s) => `<option ${S.sector === s ? "selected" : ""} value="${esc(s)}">${esc(s[0].toUpperCase() + s.slice(1))}</option>`).join("")}</select>
    </div>
    <div class="mg-board">${STAGES.map(column).join("")}</div>
  </div>`;
  view.querySelector("#pSector").addEventListener("change", async (e) => { S.sector = e.target.value; await loadProspects(); draw(); });
  view.querySelectorAll("[data-prospect]").forEach((b) => b.addEventListener("click", () => openProspect(b.dataset.prospect)));
}

function column(st) {
  const r = S.prospects[st.status];
  const list = r?.ok ? r.data.prospects : [];
  const total = r?.ok ? r.data.total : 0;
  const cards = list.slice(0, 40).map((p) => {
    const prev = S.knownProspects.get(p.id);
    const moved = prev && prev !== p.status;
    S.knownProspects.set(p.id, p.status);
    const worth = monthlyWorth(p);
    return `<li><button class="mg-p${moved ? " is-changed" : ""}" data-prospect="${esc(p.id)}">
      <b>${esc(p.name)}</b>
      <small>${esc(p.location?.town || "")} · ${worth ? `about ${esc(money(worth))} a month` : "one-off buys"}</small>
    </button></li>`;
  }).join("");
  return `<section class="lane" aria-label="${esc(st.name)}">
    <h2 class="lane-head"><span>${esc(st.name)}</span><span class="t-label">${esc(num(total))}</span></h2>
    ${list.length ? `<ul class="lane-list">${cards}</ul>${total > Math.min(40, list.length) ? `<p class="lane-empty">And ${esc(num(total - Math.min(40, list.length)))} more${S.sector ? "" : ". Pick a sector to see them"}.</p>` : ""}` : '<p class="lane-empty">None yet.</p>'}
  </section>`;
}

async function openProspect(id) {
  const over = slideOver({ title: "Prospect", body: skeleton(6), wide: true });
  const r = await read("get_prospect", { prospect_id: id });
  if (!r.ok) { over.el.querySelector(".over-body").innerHTML = emptyState({ title: "That prospect did not open.", text: r.error.message }); return; }
  over.el.querySelector(".over-head h2").textContent = r.data.name;
  await loadProducts((r.data.needs || []).map((n) => n.product));
  paintProspect(over, r.data);
}

/** Product and variant names, so a need reads "3 × The Emergency Sandwich, ham" and never as a stock code. */
async function loadProducts(ids) {
  const missing = [...new Set(ids)].filter((id) => id && !S.products.has(id));
  const got = await Promise.all(missing.map((id) => read("get_product", { id })));
  got.forEach((r, i) => {
    if (r.ok) S.products.set(missing[i], { name: r.data.name, variants: new Map((r.data.variants || []).map((v) => [v.sku, v.name])) });
  });
}

function itemName(productId, sku) {
  const p = S.products.get(productId) || [...S.products.values()].find((x) => x.variants.has(sku));
  if (!p) return "an item";
  const v = p.variants.get(sku);
  return v && v !== p.name && p.variants.size > 1 ? `${p.name}, ${v.toLowerCase()}` : p.name;
}

function paintProspect(over, p, said = null) {
  const box = over.el.querySelector(".over-body");
  const gapUntil = p.last_contacted && p.status === "contacted" ? addDays(p.last_contacted, 14) : null;
  const waiting = gapUntil && gapUntil > today();
  const worth = monthlyWorth(p);
  const dm = p.decision_maker || {};
  box.innerHTML = `
    <div class="mg-pr-head">${avatar(dm.name || p.name, { size: 40 })}<div><b>${esc(dm.name || "Someone in charge")}</b><small>Decides for ${esc(p.name)}${dm.from ? ` · from ${esc(dm.from)}` : ""}</small></div>
      <span class="${p.status === "declined" ? "pill bad" : "sr-state"}">${esc(STAGES.find((s) => s.status === p.status)?.name || p.status)}</span></div>
    <ul class="od-rows mg-facts">
      <li><span class="grow muted">Where</span><span>${esc([p.location?.address_line, p.location?.town, p.location?.postcode].filter(Boolean).join(", "))}</span></li>
      <li><span class="grow muted">Sector</span><span>${esc(p.sector)}, ${esc(plural(p.staff || 0, "person", "people"))}</span></li>
      <li><span class="grow muted">Budget</span><span class="num">${esc(money(p.monthly_budget))} a month</span></li>
      <li><span class="grow muted">Likes to hear by</span><span>${esc(OUTREACH[p.preferred_channel] || p.preferred_channel)}</span></li>
    </ul>
    <section class="od-sect"><h3 class="od-h">What they need${worth ? `, about ${esc(money(worth))} a month` : ""}</h3>
      <ul class="od-rows">${(p.needs || []).map((n) => `<li><img class="mg-need-pic" src="/img/web/${esc(n.product)}-640.webp" alt="" loading="lazy" width="40" height="40"><span class="grow"><b>${esc(num(n.qty))} × ${esc(itemName(n.product, n.sku))}</b><small>${n.every === "once" ? "Once" : `Every ${esc(n.every)}`}</small></span><span class="num">${esc(money2(n.unit_price))} each</span></li>`).join("")}</ul>
      ${p.notes ? `<p class="od-sub mg-pr-notes">${esc(p.notes)}</p>` : ""}</section>
    <section class="od-sect"><h3 class="od-h">What has passed between us</h3>
      ${(p.outreach || []).length ? `<ul class="od-rows">${p.outreach.slice().reverse().map((o) => `<li><time>${esc(shortDate(o.at))}</time><span class="grow"><b>${esc(OUTREACH[o.channel] || o.channel)}</b><small>${esc(plainText(o.message))}${o.offer ? ` Offer: ${esc(num(o.offer.discount_percent))}% off ${esc(o.offer.items.map((i) => `${i.qty} × ${itemName(null, i.sku)}`).join(", ") || "anything")}.` : ""}</small></span></li>`).join("")}</ul>` : '<p class="od-sub">Nothing yet. They have never heard from us.</p>'}</section>
    <section class="od-sect"><h3 class="od-h">Get in touch</h3>
      ${said ? `<p class="said good" role="status">${esc(said)}</p>` : ""}
      ${p.status === "declined" ? '<p class="od-sub">They said no. The rules say not to contact them again.</p>'
        : waiting ? `<p class="od-sub">Contacted on ${esc(day(p.last_contacted))}. The next contact can be from ${esc(longDate(`${gapUntil}T00:00:00Z`))}, or sooner if they reply.</p>`
        : `<form class="mg-form" id="oForm">
          <div class="chips mg-radio" role="radiogroup" aria-label="How">${Object.entries(OUTREACH).map(([k, v]) => `<label><input type="radio" name="channel" value="${k}" ${k === p.preferred_channel ? "checked" : ""}><span class="pm-chip">${esc(v)}${k === p.preferred_channel ? ", their choice" : ""}</span></label>`).join("")}</div>
          <textarea class="textarea" name="message" minlength="20" required placeholder="Dear ${esc(dm.name || "Sir or Madam")},"></textarea>
          <fieldset class="mg-offer"><legend class="od-h">Add an offer (optional)</legend>
            ${(p.needs || []).map((n, i) => `<label class="check"><input type="checkbox" name="item" value="${i}"> ${esc(num(n.qty))} × ${esc(itemName(n.product, n.sku))}</label>`).join("")}
            <label class="mg-off"><span>Discount</span><input class="mg-slide" type="range" name="off" min="0" max="20" step="1" value="0"><b id="oOff" class="num">0%</b></label>
          </fieldset>
          <p class="said bad" id="oErr" role="alert"></p>
          <div class="act-row"><button class="btn primary" type="submit">Send</button></div>
        </form>`}</section>`;
  const form = box.querySelector("#oForm");
  if (!form) return;
  form.off.addEventListener("input", () => { box.querySelector("#oOff").textContent = `${form.off.value}%`; form.off.style.setProperty("--fill", `${(form.off.value / 20) * 100}%`); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const items = [...form.querySelectorAll("[name=item]:checked")].map((x) => p.needs[Number(x.value)]).map((n) => ({ sku: n.sku, qty: n.qty }));
    const off = Number(form.off.value);
    const input = { prospect_id: p.id, channel: form.channel.value, message: form.message.value.trim() };
    if (items.length || off) input.offer = { items, discount_percent: off };
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    const r = await world.call("send_outreach", input);
    btn.disabled = false;
    if (!r.ok) { box.querySelector("#oErr").textContent = plainText(r.error.message); return; }
    const fresh = await read("get_prospect", { prospect_id: p.id });
    if (fresh.ok) paintProspect(over, fresh.data, `${OUTREACH[r.data.channel]} sent to ${p.name}. Move time on to see if they answer.`);
    refresh();
  });
}

// ------------------------------------------------------------------ drawing, routing, keyboard, staying live

function draw() {
  markNav();
  const view = main.querySelector("#view");
  if (!S.days) return;
  // WHY: a redraw while someone types the newsletter would lose their place; the words are kept in S.draft.
  const typing = document.activeElement?.closest?.("#view form");
  if (typing && S.view === "newsletter") return;
  const scroll = view.scrollTop;
  ({ overview: drawOverview, campaigns: drawCampaigns, newsletter: drawNewsletter, social: drawSocial, prospects: drawProspects })[S.view](view);
  view.scrollTop = scroll;
}

function route() {
  const id = location.hash.replace(/^#/, "");
  const was = S.view;
  S.view = VIEWS.some((v) => v.id === id) ? id : "overview";
  draw();
  if (was !== S.view) main.querySelector("#view").scrollTop = 0;
}

async function refresh() {
  if (S.busy) { S.again = true; return; }
  S.busy = true;
  try { await load(); draw(); } finally {
    S.busy = false;
    if (S.again) { S.again = false; refresh(); }
  }
}

/**
 * The keyboard. Keys act only when you are not typing and nothing is open over the page.
 *   1 to 5: the five views   N: start a campaign   J or Down, K or Up: move through the buttons in the view
 */
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".over")) return;
  if (e.target.closest?.("input, textarea, select")) { if (e.key === "Escape") e.target.blur(); return; }
  if (e.target.closest?.(".ch svg")) return;
  const n = Number(e.key);
  if (n >= 1 && n <= VIEWS.length) { e.preventDefault(); location.hash = `#${VIEWS[n - 1].id}`; return; }
  if (e.key === "n") { e.preventDefault(); campaignForm(); return; }
  const down = e.key === "j" || e.key === "ArrowDown", up = e.key === "k" || e.key === "ArrowUp";
  if (!down && !up) return;
  const items = [...main.querySelectorAll("#view button:not(:disabled), #view .mg-p")];
  if (!items.length) return;
  e.preventDefault();
  const at = items.indexOf(document.activeElement);
  const next = items[at < 0 ? 0 : Math.max(0, Math.min(items.length - 1, at + (down ? 1 : -1)))];
  next.focus();
  next.scrollIntoView({ block: "nearest" });
});

shell();
main.querySelector("#view").innerHTML = `<div class="v-wrap">${skeleton(6)}</div>`;
S.view = VIEWS.some((v) => v.id === location.hash.slice(1)) ? location.hash.slice(1) : "overview";
await refresh();
window.addEventListener("hashchange", route);

document.addEventListener("ot:day", (e) => {
  if (e.detail?.now) S.now = e.detail.now;
  if (e.detail?.partial) return;
  S.said = {};  // once time has moved, the results list says what each change did
  refresh();
});
world.onChange((change) => {
  if (change.reset) { S.knownProspects.clear(); S.sectors = null; S.people = {}; S.letterResults = new Map(); S.said = {}; refresh(); return; }
  if (change.source === "local") return;
  if (change.entries.some((e) => !isScreenRead(e))) refresh();
});
