// Front Desk's two other desks, beside the queue of people who got in touch:
//   Customers: find anyone, and read their customer page (get_customer_overview): what they are worth, what the
//              business knows, and everything that ever happened with them, each line opening the real record.
//   Reviews:   every review (list_reviews), newest first, filtered to the ones that need an answer; answer in public
//              (reply_to_review), or hide one while it is looked into (flag_review).
// Every other app links here: ?customer=C-1002 opens the page, ?review=REV-0031 opens the review.
import { esc, avatar, emptyState, skeleton, money2, plural, words, timeParts, toast } from "../lib/ui.js";
import { plainText, plainRef, rememberName } from "../lib/plain.js";
import { openRecord, recordChip, wireRecordChips } from "../lib/records.js";
import { loadTeam } from "../lib/people.js";

const FLAG_REASONS = [["fake", "Looks fake"], ["abusive", "Rude or abusive"], ["wrong_product", "About something else"], ["personal_details", "Shows personal details"], ["other", "Something else"]];
const REVIEW_VIEWS = [["needs", "Needs a reply", { needs_reply: true }], ["poor", "1 or 2 stars", { max_rating: 2 }], ["all", "All", {}], ["hidden", "Hidden", { flagged: true }]];

/**
 * Mounts a desk into the panes.
 * @param {"customers"|"reviews"} kind
 * @param {{world: object, queuePane: HTMLElement, talkPane: HTMLElement, whoPane: HTMLElement, main: HTMLElement, now: function(): string, switcher: string, wireSwitcher: function(HTMLElement): void}} ctx
 * @param {{open?: string}=} options an id to open at once
 */
export function mountDesk(kind, ctx, { open = null } = {}) {
  const desk = kind === "customers" ? customersDesk(ctx) : reviewsDesk(ctx);
  desk.start(open);
  return desk;
}

function read(world, tool, input) {
  return world.call(tool, input, { screen: true });
}

function when(iso, now) {
  if (!iso) return "";
  const p = timeParts(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return p.year === timeParts(now).year ? `${p.day} ${p.monthShort}` : `${p.day} ${p.monthShort} ${p.year}`;
}

function stars(n) {
  return `<span class="dk-stars" aria-label="${n} of 5">${"★".repeat(n)}<span class="dk-stars-off">${"★".repeat(5 - n)}</span></span>`;
}

// ------------------------------------------------------------------ customers

function customersDesk(ctx) {
  const { world, queuePane, talkPane, whoPane, main } = ctx;
  let selected = null;
  let search = "";
  let rows = [];

  async function start(open) {
    queuePane.innerHTML = `<header class="q-head">${ctx.switcher}
      <input class="dk-search" id="dk-search" type="search" placeholder="Find a customer by name or email" aria-label="Find a customer" value="${esc(search)}"></header>
      <ul class="q-rows" id="dk-rows" aria-label="Customers"><li class="q-loading">${skeleton(8)}</li></ul>`;
    ctx.wireSwitcher(queuePane);
    const input = queuePane.querySelector("#dk-search");
    let t = null;
    input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { search = input.value.trim(); load(); }, 200); });
    whoPane.innerHTML = "";
    main.dataset.desk = "customers";
    if (!open) talkPane.innerHTML = `<div class="talk-empty"><p class="talk-empty-title">Pick a customer to see everything about them.</p><p class="talk-empty-text">Type a name to find anyone who has ever bought here.</p></div>`;
    await load();
    if (open) openPage(open);
  }

  /** With no search: people who got in touch most recently. With one: every match. */
  async function load() {
    const list = queuePane.querySelector("#dk-rows");
    if (search) {
      const res = await read(world, "list_customers", { search, limit: 60 });
      rows = res.ok ? res.data.customers.map((c) => ({ id: c.id, name: c.name, line: `${plural(c.orders, "order")} · since ${c.joined.slice(0, 4)}` })) : [];
    } else {
      const res = await read(world, "list_contacts", {});
      const seen = new Set();
      rows = [];
      for (const c of res.ok ? res.data.contacts : []) {
        if (!c.customer_id || seen.has(c.customer_id)) continue;
        seen.add(c.customer_id);
        rows.push({ id: c.customer_id, name: c.customer_name || "A customer", line: `Last in touch ${when(c.at, ctx.now())} · ${words(c.topic || c.channel)}` });
      }
    }
    for (const r of rows) rememberName(r.id, r.name);
    list.innerHTML = rows.length ? rows.map((r) => `<li class="q-li"><button class="q-row${r.id === selected ? " is-on" : ""}" data-cust="${esc(r.id)}">
        <span class="q-top"><b class="q-name">${esc(r.name)}</b></span><span class="q-line"><span class="q-subj">${esc(r.line)}</span></span></button></li>`).join("")
      : `<li class="q-empty">${search ? "Nobody by that name." : "Nobody has been in touch yet."}</li>`;
    list.querySelectorAll("[data-cust]").forEach((b) => b.addEventListener("click", () => openPage(b.dataset.cust)));
  }

  async function openPage(id) {
    selected = id;
    queuePane.querySelectorAll("[data-cust]").forEach((b) => b.classList.toggle("is-on", b.dataset.cust === id));
    main.dataset.view = "talk";
    talkPane.innerHTML = `<div class="dk-page">${skeleton(10)}</div>`;
    const res = await read(world, "get_customer_overview", { customer_id: id });
    if (selected !== id) return;
    if (!res.ok) {
      talkPane.innerHTML = emptyState({ title: res.error.code === "forbidden" ? "Customer pages are for the help desk, marketing and the manager." : "That customer is not on file." });
      return;
    }
    const d = res.data;
    rememberName(id, d.customer.name);
    history.replaceState(null, "", `?customer=${encodeURIComponent(id)}`);
    talkPane.innerHTML = pageHtml(d, ctx.now());
    wireRecordChips(talkPane, world);
    talkPane.querySelector("[data-back]")?.addEventListener("click", () => { main.dataset.view = "queue"; });
    talkPane.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openRecord(world, b.dataset.kind, b.dataset.open)));
    talkPane.querySelector("[data-task]")?.addEventListener("click", () => taskForm(d));
    talkPane.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => {
      talkPane.querySelectorAll("[data-filter]").forEach((x) => x.classList.toggle("is-on", x === b));
      talkPane.querySelectorAll(".dk-ev").forEach((li) => { li.hidden = b.dataset.filter !== "all" && li.dataset.kind !== b.dataset.filter; });
    }));
  }

  /** Gives someone on the team a task about this customer (create_task), right from their page. */
  async function taskForm(d) {
    const team = await loadTeam(world);
    const box = talkPane.querySelector("#dk-task");
    box.hidden = false;
    box.innerHTML = `<form class="dk-form" id="dk-task-form">
      <label class="field"><span class="pm-label">What needs doing</span><input class="input" name="title" required maxlength="140" value="Follow up with ${esc(d.customer.name)}"></label>
      <div class="dk-form-row"><label class="field"><span class="pm-label">Who</span><select class="select" name="assignee">${team.map((p) => `<option value="${esc(p.id)}" ${p.id === "S-07" ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
      <label class="field"><span class="pm-label">Minutes</span><input class="input" name="minutes" type="number" min="5" max="960" value="20"></label>
      <label class="field"><span class="pm-label">Urgent</span><select class="select" name="priority"><option value="normal">No</option><option value="urgent">Yes, before customers</option></select></label></div>
      <div class="dk-form-row"><button class="btn primary small" type="submit">Give the task</button><button class="btn small ghost" type="button" data-cancel>Cancel</button><span class="dk-said" aria-live="polite"></span></div></form>`;
    const form = box.querySelector("form");
    form.querySelector("[data-cancel]").addEventListener("click", () => { box.hidden = true; });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const links = { customer_id: d.customer.id };
      if (d.orders.list[0]) links.order = d.orders.list[0].number;
      const res = await world.call("create_task", { title: f.get("title"), assignee: f.get("assignee"), minutes: Number(f.get("minutes")), priority: f.get("priority"), links });
      const said = form.querySelector(".dk-said");
      if (!res.ok) { said.textContent = res.error.message; said.dataset.tone = "bad"; return; }
      said.textContent = `Given to ${res.data.assignee_name}. It comes out of their day.`;
      said.dataset.tone = "good";
      setTimeout(() => { box.hidden = true; }, 1600);
    });
  }

  return { start, refresh: () => (selected ? openPage(selected) : load()) };
}

/** The customer page: who they are, what they are worth, what we know, and everything that happened. */
function pageHtml(d, now) {
  const c = d.customer, v = d.value, k = d.knows;
  const home = c.addresses?.find((a) => a.default) || c.addresses?.[0];
  const events = [
    ...d.orders.list.map((o) => ({ kind: "order", at: o.placed_at, title: o.items[0] + (o.items.length > 1 ? ` and ${o.items.length - 1} more` : ""), line: `${words(o.status)} · ${money2(o.total)}`, ref: ["order", o.number] })),
    ...d.contacts.list.map((x) => ({ kind: "contact", at: x.at, title: plainText(x.summary || words(x.topic)), line: `${words(x.channel)} · ${words(x.outcome || "open")}`, ref: x.case_number ? ["case", x.case_number] : null })),
    ...d.cases.list.map((x) => ({ kind: "case", at: x.opened_at, title: plainText(x.subject), line: `${x.is_complaint ? "Complaint · " : ""}${words(x.status)}`, ref: ["case", x.number] })),
    ...d.reviews.list.map((r) => ({ kind: "review", at: `${r.date}T12:00:00Z`, title: `“${r.text}”`, line: `${r.rating} of 5${r.reply ? " · we replied" : " · no reply yet"}`, ref: ["review", r.id] })),
    ...d.social_posts.list.map((p) => ({ kind: "post", at: p.at, title: plainText(p.text), line: `${p.network === "squint" ? "Squint" : "Mutter"} · ${plural(p.likes, "like")}`, ref: null })),
    ...d.emails.list.map((e) => ({ kind: "email", at: e.at, title: plainText(e.subject), line: `${e.from_customer ? "They wrote to" : "We wrote from"} ${e.mailbox}@`, ref: null, href: `../letterbox/?mailbox=${encodeURIComponent(e.mailbox)}&email=${encodeURIComponent(e.id)}` })),
    ...d.returns.list.map((r) => ({ kind: "order", at: r.created_at, title: `Sent back from ${plainRef(r.order_number, { lower: true })}`, line: `${words(r.reason || "")} · ${words(r.status)}`, ref: ["order", r.order_number] })),
  ].filter((e) => e.at).sort((a, b) => (a.at < b.at ? 1 : -1));
  const counts = { order: d.orders.total, contact: d.contacts.total, case: d.cases.total, review: d.reviews.total, post: d.social_posts.total, email: d.emails.total };
  const since = v.days_since_last_order;
  return `<article class="dk-page">
    <button class="btn ghost small dk-back" data-back>Back</button>
    <header class="dk-head">${avatar(c.name, { size: 56 })}
      <div><h2 class="pm-h2">${esc(c.name)}</h2><p class="dk-sub">${esc([c.email, c.phone, home ? `${home.town} ${home.postcode}` : null].filter(Boolean).join(" · "))}</p></div>
      <button class="btn small" data-task>Give someone a task about them</button></header>
    <div id="dk-task" hidden></div>
    <dl class="dk-figs">
      <div><dt>Spent with us</dt><dd>${esc(money2(v.lifetime_value))}</dd></div>
      <div><dt>Orders</dt><dd>${esc(v.orders)}</dd></div>
      <div><dt>Usual order</dt><dd>${v.average_order == null ? "None yet" : esc(money2(v.average_order))}</dd></div>
      <div><dt>Last bought</dt><dd>${since == null ? "Never" : since === 0 ? "Today" : esc(`${plural(since, "day")} ago`)}</dd></div>
    </dl>
    <h3 class="pm-h3 dk-h">What we know</h3>
    <ul class="dk-knows">
      <li><span>Likes to hear by</span><b>${esc(words(k.contact_preference || "email"))}</b></li>
      <li><span>Usually gets in touch by</span><b>${esc(k.usually_gets_in_touch_by ? words(k.usually_gets_in_touch_by) : "Has not yet")}</b></li>
      <li><span>Buys most</span><b>${esc(k.favourite_products.map((f) => f.name).join(", ") || "Nothing yet")}</b></li>
      <li><span>Complaints</span><b>${esc(k.complaints)}${k.open_cases ? `, ${esc(plural(k.open_cases, "case"))} open` : ""}</b></li>
      <li><span>Reviews</span><b>${k.average_rating == null ? "None" : `${esc(plural(d.reviews.total, "review"))}, ${esc(k.average_rating)} of 5 on average`}</b></li>
      <li><span>Newsletters</span><b>${k.marketing_opt_in ? "Yes" : "No"}</b></li>
      <li><span>Credit to spend</span><b>${esc(money2(k.credit_balance))}</b></li>
      <li><span>Customer since</span><b>${esc(c.created_at ? `${timeParts(c.created_at).month} ${timeParts(c.created_at).year}` : "")}</b></li>
    </ul>
    <h3 class="pm-h3 dk-h">Everything that happened</h3>
    <div class="dk-filters" role="group" aria-label="Show">
      <button class="pm-chip is-on" data-filter="all">All</button>
      ${[["order", "Orders"], ["contact", "Got in touch"], ["case", "Cases"], ["review", "Reviews"], ["post", "Posts"], ["email", "Email"]].filter(([key]) => counts[key]).map(([key, label]) => `<button class="pm-chip" data-filter="${key}">${label} <span class="mono">${counts[key]}</span></button>`).join("")}
    </div>
    <ol class="dk-events">${events.length ? events.slice(0, 120).map((e) => `<li class="dk-ev" data-kind="${e.kind}">
      <time>${esc(when(e.at, now))}</time>
      ${e.ref ? `<button class="dk-ev-main" data-kind="${e.ref[0]}" data-open="${esc(e.ref[1])}">` : e.href ? `<a class="dk-ev-main" href="${esc(e.href)}">` : `<div class="dk-ev-main">`}
        <b>${esc(e.title)}</b><small>${esc(e.line)}</small>
      ${e.ref ? "</button>" : e.href ? "</a>" : "</div>"}</li>`).join("") : `<li class="q-empty">Nothing has happened with them yet.</li>`}</ol>
  </article>`;
}

// ------------------------------------------------------------------ reviews

function reviewsDesk(ctx) {
  const { world, queuePane, talkPane, whoPane, main } = ctx;
  let view = "needs";
  let selected = null;
  let rows = [];

  async function start(open) {
    queuePane.innerHTML = `<header class="q-head">${ctx.switcher}
      <div class="q-stages dk-views" role="tablist" aria-label="Which reviews">${REVIEW_VIEWS.map(([id, label]) => `<button class="q-stage${id === view ? " is-on" : ""}" role="tab" data-view="${id}">${label}</button>`).join("")}</div>
      <p class="dk-avg" id="dk-avg"></p></header>
      <ul class="q-rows" id="dk-rows" aria-label="Reviews"><li class="q-loading">${skeleton(8)}</li></ul>`;
    ctx.wireSwitcher(queuePane);
    queuePane.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
      view = b.dataset.view;
      queuePane.querySelectorAll("[data-view]").forEach((x) => x.classList.toggle("is-on", x === b));
      load();
    }));
    main.dataset.desk = "reviews";
    whoPane.innerHTML = "";
    talkPane.innerHTML = `<div class="talk-empty"><p class="talk-empty-title">Pick a review to answer it.</p><p class="talk-empty-text">Answers are public: everyone who reads the review reads them.</p></div>`;
    if (open) {
      const r = await read(world, "get_review", { review_id: open });
      if (r.ok && r.data.flag) view = "hidden";
      else if (r.ok && r.data.reply) view = "all";
      queuePane.querySelectorAll("[data-view]").forEach((x) => x.classList.toggle("is-on", x.dataset.view === view));
    }
    await load();
    if (open) openReview(open);
  }

  async function load() {
    const filter = REVIEW_VIEWS.find(([id]) => id === view)[2];
    const res = await read(world, "list_reviews", { ...filter, limit: 100 });
    rows = res.ok ? res.data.reviews : [];
    const avg = queuePane.querySelector("#dk-avg");
    if (avg) avg.textContent = res.ok && res.data.total ? `${plural(res.data.total, "review")}, ${res.data.average_rating} of 5 on average` : "";
    paintRows();
  }

  function paintRows() {
    const list = queuePane.querySelector("#dk-rows");
    if (!list) return;
    list.innerHTML = rows.length ? rows.map((r) => `<li class="q-li"><button class="q-row${r.id === selected ? " is-on" : ""}" data-rev="${esc(r.id)}">
      <span class="q-top"><b class="q-name">${esc(r.reviewer)}</b>${stars(r.rating)}<span class="q-time">${esc(when(r.date, ctx.now()))}</span></span>
      <span class="q-line"><span class="q-subj">${esc(r.product_name)}</span><span class="q-due"> · ${esc(r.text)}</span></span></button></li>`).join("")
      : `<li class="q-empty">${view === "needs" ? "Every review has an answer." : "No reviews here."}</li>`;
    list.querySelectorAll("[data-rev]").forEach((b) => b.addEventListener("click", () => openReview(b.dataset.rev)));
  }

  async function openReview(id) {
    selected = id;
    queuePane.querySelectorAll("[data-rev]").forEach((b) => b.classList.toggle("is-on", b.dataset.rev === id));
    main.dataset.view = "talk";
    const res = await read(world, "get_review", { review_id: id });
    if (selected !== id) return;
    if (!res.ok) { talkPane.innerHTML = emptyState({ title: "That review is not there any more." }); return; }
    const r = res.data;
    history.replaceState(null, "", `?review=${encodeURIComponent(id)}`);
    const canReply = ctx.tools.has("reply_to_review"), canFlag = ctx.tools.has("flag_review");
    talkPane.innerHTML = `<article class="dk-page">
      <button class="btn ghost small dk-back" data-back>Back</button>
      <header class="dk-rev-head">${stars(r.rating)}<span class="dk-sub">${esc(r.product_name)} · ${esc(when(r.date, ctx.now()))}</span></header>
      <blockquote class="dk-quote">${esc(r.text)}</blockquote>
      <p class="dk-sub">Written by <button class="dk-link" data-cust="${esc(r.customer_id || "")}">${esc(r.reviewer)}</button></p>
      <p class="dk-chips">${r.order_number ? recordChip("order", r.order_number) : ""} ${r.customer_id ? recordChip("customer", r.customer_id) : ""}</p>
      ${r.flag ? `<p class="dk-flag">Hidden from customers: ${esc(words(r.flag.reason))}${r.flag.note ? `. ${esc(r.flag.note)}` : ""}.</p>` : ""}
      ${r.reply ? `<section class="dk-reply"><h3 class="pm-h3">Our public reply</h3><p>${esc(r.reply.text)}</p><p class="dk-sub">${esc(r.reply.by_name)}${r.reply.edited ? " · edited" : ""}</p></section>` : ""}
      ${canReply ? `<form class="dk-form" id="dk-reply">
        <label class="field"><span class="pm-label">${r.reply ? "Change the reply" : "Reply in public"}</span><textarea class="textarea" name="text" rows="5" maxlength="1500" required placeholder="Thank them, or say sorry and what you have done about it."></textarea></label>
        <div class="dk-form-row"><button class="btn primary" type="submit">${r.reply ? "Post the new reply" : "Post reply"}</button><span class="dk-said" aria-live="polite"></span></div></form>` : `<p class="dk-sub">Only the help desk, marketing and the manager answer reviews.</p>`}
      ${canFlag ? `<div class="dk-form-row dk-flag-row">${r.flag ? `<button class="btn small" data-unflag>Show it again</button>`
        : `<select class="select" id="dk-reason" aria-label="Why hide it">${FLAG_REASONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select><button class="btn small" data-flag>Hide while we look</button>`}<span class="dk-said" id="dk-flag-said" aria-live="polite"></span></div>` : ""}
    </article>`;
    wireRecordChips(talkPane, world);
    talkPane.querySelector("[data-back]").addEventListener("click", () => { main.dataset.view = "queue"; });
    talkPane.querySelector("[data-cust]")?.addEventListener("click", (e) => { if (e.currentTarget.dataset.cust) ctx.showCustomer(e.currentTarget.dataset.cust); });
    const form = talkPane.querySelector("#dk-reply");
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const said = form.querySelector(".dk-said");
      const res2 = await world.call("reply_to_review", { review_id: id, text: new FormData(form).get("text") });
      if (!res2.ok) { said.textContent = res2.error.message; said.dataset.tone = "bad"; return; }
      toast("Reply posted. Everyone can read it.");
      await load();
      openReview(id);
    });
    const flag = async (input) => {
      const res2 = await world.call("flag_review", { review_id: id, ...input });
      const said = talkPane.querySelector("#dk-flag-said");
      if (!res2.ok) { said.textContent = res2.error.message; said.dataset.tone = "bad"; return; }
      toast(input.clear ? "Customers can see it again." : "Hidden from customers.");
      await load();
      openReview(id);
    };
    talkPane.querySelector("[data-flag]")?.addEventListener("click", () => flag({ reason: talkPane.querySelector("#dk-reason").value }));
    talkPane.querySelector("[data-unflag]")?.addEventListener("click", () => flag({ clear: true }));
    if (r.customer_id) ctx.paintCustomerSide(r.customer_id);
  }

  return { start, refresh: () => load().then(() => selected && openReview(selected)) };
}
