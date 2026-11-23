// The Run: time plays forward a day at a time at a pace you can follow, and the screen shows what really came back
// from each day (orders, money, letters, news) while two lines draw themselves: this business with the idea, and
// the same business left alone. WHY a day per request: the picture must follow real results as they arrive.
import { esc, money, num, plural, timeParts } from "../lib/ui.js";
import { plainText } from "../lib/plain.js";
import { didWords } from "../home-a/business.js";

/** How long a run takes to watch, by its length. A month is about twenty seconds. */
function paceFor(days) {
  if (days <= 7) return 900;
  if (days <= 31) return 620;
  return 280;
}

/** Waits, but stops waiting at once if the tab is hidden or the run is skipped, so nothing ever stalls. */
function wait(ms, run) {
  if (document.hidden || run.skip || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); document.removeEventListener("visibilitychange", done); resolve(); };
    const t = setTimeout(done, ms);
    document.addEventListener("visibilitychange", done, { once: true });
    run.wake = done;
  });
}

/** Moves time on, trying again on a slow or failed answer before giving up honestly. */
async function advance(world, days) {
  let last = null;
  for (const pause of [0, 700, 1800]) {
    if (pause) await new Promise((r) => setTimeout(r, pause));
    try {
      return await world.advance(days);
    } catch (e) {
      last = e;
      if (e.code === "offline") continue;
    }
  }
  throw last || new Error("Time did not move.");
}

// ------------------------------------------------------------------ what each day says

/**
 * Plain lines about one day, from what the simulator returned for it, most telling first. Routine lines (customers
 * getting in touch, parcels going out) give way to rarer ones, so the list reads like a day, not a counter.
 */
function dayLines(day, recent) {
  const s = day.summary || {};
  const out = [];
  const late = (day.became_late || []).length;
  if (late) out.push({ kind: "bad", text: `${late === 1 ? "A parcel is" : `${late} parcels are`} running late.` });
  if (s.lost_sales > 0) out.push({ kind: "bad", text: `${s.lost_sales === 1 ? "A sale was" : `${Math.round(s.lost_sales)} sales were`} lost because a shelf was empty.` });
  if ((day.complaints_past_deadline || []).length) out.push({ kind: "bad", text: "A complaint went past its deadline." });
  if (s.orders > 0) out.push({ kind: "order", text: `${s.orders === 1 ? "An order" : `${Math.round(s.orders)} orders`} came in. ${money(s.revenue)} taken.` });
  if ((day.deliveries || []).length) out.push({ kind: "stock", text: "New stock arrived from a supplier." });
  for (const n of s.notes || []) {
    const po = n.match(/raised (\d+) purchase orders?/i);
    if (po) out.push({ kind: "stock", text: `The buyer ordered more stock${Number(po[1]) > 1 ? ` from ${po[1]} suppliers` : ""}.` });
  }
  if ((day.delivered || []).length) out.push({ kind: "routine", text: `${day.delivered.length === 1 ? "A parcel reached its customer" : `${day.delivered.length} parcels reached their customers`}.` });
  if (s.csat) out.push({ kind: "people", text: `Customers rated the day ${Number(s.csat).toFixed(1)} out of 5.` });
  if (s.contacts > 0) out.push({ kind: "routine", text: `${s.contacts === 1 ? "A customer" : `${Math.round(s.contacts)} customers`} got in touch.` });
  if (!s.orders && !out.length) out.push({ kind: "routine", text: "A quiet day. Nobody ordered anything." });
  // Skip a line said in the last two days, so the list keeps moving.
  return out.filter((l) => !recent.includes(l.text.replace(/\d+/g, "#"))).slice(0, 2);
}

/** Remembers the shape of recent lines (numbers removed) so the same kind of line is not repeated every day. */
function remember(recent, lines) {
  for (const l of lines) recent.push(l.text.replace(/\d+/g, "#"));
  while (recent.length > 4) recent.shift();
}

// ------------------------------------------------------------------ the chart

/**
 * Two lines of running profit: with the idea (ink) and left alone (dashed). The x axis is fixed to the whole run,
 * so the lines grow towards the right edge as days pass.
 * @param {HTMLElement} el
 * @param {{pts: Array<Array<number>>, total: number}} d points [day, with the idea, left alone], running totals
 */
export function drawChart(el, { pts, total, you = "With the change" }) {
  const W = 1000, H = 360, padT = 30, padB = 30;
  const line = [[0, 0, 0], ...pts];
  const all = line.flatMap((p) => [p[1], p[2]]);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 1) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const span = Math.max(1, total);
  const x = (d) => (Math.min(d, span) / span) * W;
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const path = (k) => line.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)} ${y(p[k]).toFixed(1)}`).join(" ");
  const zero = y(0);
  const last = line[line.length - 1];
  // The two end labels must never sit on top of each other: far apart, each beside its line; close, one block.
  const la = (y(last[1]) / H) * 100, lb = (y(last[2]) / H) * 100;
  const left = (x(last[0]) / W) * 100;
  const close = Math.abs(la - lb) < 22;
  const tags = !pts.length ? "" : close
    // Close together: one block beside the end, the higher value first, each with its own line key.
    ? `<span class="ch-tags" style="left:${left}%;top:${(la + lb) / 2}%">
        ${(last[1] >= last[2] ? [["is-you", last[1], you], ["is-alone", last[2], "Left alone"]] : [["is-alone", last[2], "Left alone"], ["is-you", last[1], you]])
          .map(([c, v, t]) => `<span class="ch-tag-row ${c}"><i></i><b>${esc(money(v))}</b>${esc(t)}</span>`).join("")}</span>`
    : `<span class="ch-tag is-you" style="left:${left}%;top:${la}%"><b>${esc(money(last[1]))}</b>${esc(you)}</span>
       <span class="ch-tag is-alone" style="left:${left}%;top:${lb}%"><b>${esc(money(last[2]))}</b>Left alone</span>`;
  el.innerHTML = `<div class="ch-plot"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2="${W}" y1="${zero}" y2="${zero}" class="ch-zero"/>
      <path d="${path(2)}" class="ch-alone"/>
      <path d="${path(1)}" class="ch-you"/>
    </svg>
    ${pts.length ? `<span class="ch-dot is-you" style="left:${left}%;top:${(y(last[1]) / H) * 100}%"></span>` : ""}
    ${tags}
    <span class="ch-axis">Profit since the test began</span></div>
    ${pts.length ? `<p class="ch-legend"><span class="ch-tag-row is-you"><i></i><b>${esc(money(last[1]))}</b>${esc(you)}</span>
      <span class="ch-tag-row is-alone"><i></i><b>${esc(money(last[2]))}</b>Left alone</span></p>` : ""}`;
}

/**
 * Running profit for both businesses from the impact series, as [day, with the idea, left alone].
 * WHY stride: on very long runs the simulator keeps every nth day; each kept day stands for n days.
 */
export function profitPoints(imp) {
  const s = imp?.series;
  if (!s?.live?.net_profit) return [];
  const k = s.stride || 1;
  let a = 0, b = 0;
  return s.live.net_profit.map((v, i) => [s.day?.[i] ?? i + 1, (a += (Number(v) || 0) * k), (b += (Number(s.shadow.net_profit[i]) || 0) * k)]);
}

// ------------------------------------------------------------------ the run itself

/**
 * Plays `days` days forward and paints the Run view. Resolves when finished (or stopped by an error, which it shows).
 * @param {{world: object, days: number, box: HTMLElement, title: string, before?: number, onDay?: function(object): void,
 *   isAi?: function(object): boolean, dayWaitMs?: number}} p  isAi picks out the outside AI's actions
 * @return {Promise<{ok: boolean, ran: number, imp: object|null}>}
 */
export async function runExperiment({ world, days, box, title, before = 0, onDay, isAi = null, dayWaitMs = 0 }) {
  const aiToken = !!isAi;
  const run = { skip: false, wake: null };
  const pace = paceFor(days);
  const els = paint(box, { title, days, ai: !!aiToken });
  drawChart(els.chart, { pts: [], total: before + days });
  els.skip.addEventListener("click", () => { run.skip = true; els.skip.disabled = true; els.skip.textContent = "Skipping to the end"; run.wake?.(); });
  const totals = { orders: 0, revenue: 0 };
  const seen = { mail: null, news: null, post: null };
  const recent = [];
  let imp = null;
  let ran = 0;
  let aiSeq = (await world.activity({ since: 0 }).catch(() => ({ last: 0 }))).last;
  await primeSeen(world, seen);

  while (ran < days) {
    const t0 = performance.now();
    // Skipping goes a month at a time with no pauses; watching goes a day at a time.
    const step = run.skip && !aiToken ? Math.min(30, days - ran) : 1;
    let r;
    try {
      r = await advance(world, step);
    } catch (e) {
      els.status.textContent = `The business stopped answering after ${plural(ran, "day")}. ${e.message || ""}`.trim();
      els.status.classList.add("is-bad");
      return { ok: false, ran, imp };
    }
    ran += step;
    for (const d of r.days || []) {
      totals.orders += d.summary?.orders || 0;
      totals.revenue += d.summary?.revenue || 0;
      if (!run.skip) { const lines = dayLines(d, recent); remember(recent, lines); feed(els.feed, lines); }
    }
    paintDay(els, r.now, ran, days, totals);
    // News and letters are checked every few days: they matter, but each check is another request.
    if (!run.skip && (ran % (days > 31 ? 3 : 2) === 0 || ran === days)) feed(els.feed, await freshNews(world, seen));
    imp = await world.impact().catch(() => imp);
    drawChart(els.chart, { pts: profitPoints(imp), total: before + days, you: aiToken ? "With your AI" : "With the change" });
    onDay?.({ now: r.now, ran, days: r.days });
    if (aiToken) {
      aiSeq = await waitForAi({ world, isAi, since: aiSeq, els, run, maxMs: dayWaitMs });
    } else {
      await wait(pace - (performance.now() - t0), run);
    }
  }
  els.status.textContent = "Done.";
  return { ok: true, ran, imp };
}

/** Remembers the newest letter and headline before the run, so only new ones are announced. */
async function primeSeen(world, seen) {
  const [m, n] = await Promise.all([
    world.call("list_emails", { mailbox: "hello", folder: "inbox", limit: 1 }, { screen: true }).catch(() => null),
    world.call("list_news", { limit: 1 }, { screen: true }).catch(() => null),
  ]);
  seen.mail = m?.ok ? m.data.emails?.[0]?.id : null;
  seen.news = n?.ok ? n.data.news?.[0]?.id : null;
}

async function freshNews(world, seen) {
  const out = [];
  const [m, n, p] = await Promise.all([
    world.call("list_emails", { mailbox: "hello", folder: "inbox", limit: 1 }, { screen: true }).catch(() => null),
    world.call("list_news", { limit: 1 }, { screen: true }).catch(() => null),
    world.call("list_social_posts", { mentions_only: true, limit: 1 }, { screen: true }).catch(() => null),
  ]);
  const post = p?.ok ? p.data.posts?.[0] : null;
  if (post && post.id !== seen.post && seen.post !== undefined) {
    if (seen.post) out.push({ kind: "mail", text: `${post.author?.name || "Someone"} posted about the shop: “${plainText(post.text).slice(0, 80)}”` });
    seen.post = post.id;
  }
  const mail = m?.ok ? m.data.emails?.[0] : null;
  if (mail && mail.id !== seen.mail) {
    seen.mail = mail.id;
    out.push({ kind: "mail", text: `A letter from ${mail.from?.name || "someone"}: “${plainText(mail.subject)}”` });
  }
  const story = n?.ok ? n.data.news?.[0] : null;
  if (story && story.id !== seen.news) {
    seen.news = story.id;
    out.push({ kind: "news", text: `In the news: ${plainText(story.headline)}` });
  }
  return out;
}

/**
 * After each day, gives an outside AI time to work: waits until it has been quiet for a few seconds, or the
 * longest wait passes, or the person skips. Shows what it is doing meanwhile.
 */
async function waitForAi({ world, isAi, since, els, run, maxMs }) {
  const start = performance.now();
  let lastAct = start;
  let count = 0;
  let seq = since;
  els.status.textContent = "Your AI is working on this day.";
  while (!run.skip && performance.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 1000));
    const a = await world.activity({ since: seq }).catch(() => null);
    if (!a) continue;
    seq = a.last;
    const mine = a.entries.filter(isAi);
    if (mine.length) {
      lastAct = performance.now();
      count += mine.length;
      feed(els.feed, mine.slice(-2).map((e) => ({ kind: e.ok === false ? "bad" : "ai", text: `Your AI ${didWords(e.tool)}${e.ok === false ? ", and the shop's rules said no" : ""}.` })));
      els.status.textContent = `Your AI has done ${plural(count, "thing")} today.`;
    }
    // Quiet for four seconds after doing something, or for ten if it has done nothing yet: move on.
    if (performance.now() - lastAct > (count ? 4000 : 10000)) break;
  }
  return seq;
}

// ------------------------------------------------------------------ painting

/** Draws the empty Run view and hands back its parts. */
export function paint(box, { title, days, ai }) {
  box.innerHTML = `
    <div class="run-head">
      <p class="pm-label"><span>${ai ? "Your AI at work" : "Experiment"}</span><span class="sep">·</span><span>${esc(title)}</span></p>
      <p class="run-date" id="runDate">&nbsp;</p>
      <div class="run-progress"><span class="run-bar" id="runBar"></span></div>
      <p class="run-count pm-mono" id="runCount">Day 0 of ${days}</p>
    </div>
    <div class="run-body">
      <div class="run-chart-wrap">
        <div class="run-figs">
          <div><span class="pm-mono">Orders</span><b id="runOrders">0</b></div>
          <div><span class="pm-mono">Money taken</span><b id="runTaken">£0</b></div>
        </div>
        <div class="chart" id="runChart"></div>
      </div>
      <div class="run-side">
        <p class="pm-mono run-side-h">What is happening</p>
        <ul class="run-feed" id="runFeed" aria-live="polite"></ul>
      </div>
    </div>
    <div class="run-foot"><p class="run-status" id="runStatus" aria-live="polite"></p><button class="pm-pill line small" type="button" id="runSkip">Skip to the end</button></div>`;
  return {
    date: box.querySelector("#runDate"), bar: box.querySelector("#runBar"), count: box.querySelector("#runCount"),
    orders: box.querySelector("#runOrders"), taken: box.querySelector("#runTaken"), chart: box.querySelector("#runChart"),
    feed: box.querySelector("#runFeed"), status: box.querySelector("#runStatus"), skip: box.querySelector("#runSkip"),
  };
}

/** One day passed: the date, the progress and the running figures. */
export function paintDay(els, now, ran, days, totals) {
  const p = timeParts(now);
  els.date.textContent = `${p.weekday} ${p.day} ${p.month}`;
  els.bar.style.transform = `scaleX(${Math.min(1, ran / days)})`;
  els.count.textContent = `Day ${Math.min(ran, days)} of ${days}`;
  els.orders.textContent = num(Math.round(totals.orders));
  els.taken.textContent = money(totals.revenue);
}

/** Adds lines to the top of the feed and keeps the newest five. */
export function feed(list, lines) {
  for (const l of lines.slice(0, 2)) {
    const li = document.createElement("li");
    li.className = `is-${l.kind}`;
    li.textContent = l.text;
    list.prepend(li);
  }
  while (list.children.length > 5) list.lastElementChild.remove();
}
