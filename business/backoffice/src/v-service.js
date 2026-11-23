// Customer operations: the service desk, cases, complaints and their deadlines, Fix Club repairs, what customers ask.
import { S, load, html, raw, money2, num, pct, date, dateShort, dateTime, time, ago, words, cap, customers, idLink, icon, pill, tonePill, access, scopedCustomer, whoSync, canSeeCustomer, avatar, redact, skuName, strip, stat, panel, pageHead, dataList, table, CHANNELS, roleName, median, minutes, custId, lockPanel, tabs, monthLabel, monShort, isAI } from "./core.js";
import { lineChart, barChart, hbars, meter, SERIES } from "./charts.js";

const OPEN = ["open", "escalated", "waiting_customer"];
const CH_C = { web_chat: "var(--s1)", email: "var(--s3)", phone: "var(--s2)", text: "var(--s4)" };
const TABS = () => [["#/service", "Service desk"], ["#/service/cases", "Cases"], ["#/service/complaints", "Complaints"], ["#/service/repairs", "Fix Club repairs"], ["#/service/topics", "What customers ask"]];
async function data() {
  const [d, cm] = await Promise.all([load("service.json"), customers()]);
  const one = scopedCustomer();
  const mine = (cn) => !one || custId(cn) === one;
  return {
    cm,
    contacts: d.contacts.map((r) => ({ id: r[0], at: r[1], c: custId(r[2]), ch: r[3], topic: r[4], by: r[5], first: r[6], resolve: r[7], out: r[8], case: r[9], sum: r[10] })).filter((r) => mine(r.c ? +r.c.slice(2) : 0)),
    cases: d.cases.map((k) => ({ ...k, c: custId(k.c) })).filter((k) => mine(k.c ? +k.c.slice(2) : 0)),
    convs: d.conversations.map((k) => ({ ...k, c: custId(k.c) })).filter((k) => mine(k.c ? +k.c.slice(2) : 0)),
    repairs: d.repairs.map((k) => ({ ...k, c: custId(k.c) })).filter((k) => mine(k.c ? +k.c.slice(2) : 0)),
    rules: d.complaint_rules,
  };
}
const workingDays = (from, to) => { let n = 0; const d = new Date(from.slice(0, 10) + "T12:00:00Z"), end = new Date(to.slice(0, 10) + "T12:00:00Z"); for (d.setUTCDate(d.getUTCDate() + 1); d <= end; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() % 6) n++; return n; };
const addWorking = (from, n) => { const d = new Date(from.slice(0, 10) + "T12:00:00Z"); while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6) n--; } return d.toISOString().slice(0, 10); };
const stageDays = (rules, stage) => (stage === 2 ? rules?.stage_2_days ?? rules?.stage2_days ?? 10 : rules?.stage_1_days ?? rules?.stage1_days ?? 3);

// ---------------------------------------------------------------- the service desk: an inbox of contacts and conversations
export async function desk(main, _, q) {
  if (access("contacts") === "none" && access("cases") === "none") { main.innerHTML = String(lockPanel("contacts", "customer contacts")); return; }
  const d = await data();
  const now = S.meta.now, d30 = new Date(Date.parse(now) - 30 * 864e5).toISOString(), d90 = new Date(Date.parse(now) - 90 * 864e5).toISOString();
  const recent = d.contacts.filter((c) => c.at >= d90);
  const items = [
    ...d.convs.map((c) => ({ id: c.id, at: c.last || c.at, ch: c.ch === "web" ? "web_chat" : c.ch === "sms" ? "text" : c.ch, c: c.c, title: c.sum || "Conversation", body: c.first, kind: "conv", waiting: c.lastFrom === "customer", n: c.msgs })),
    ...d.contacts.filter((c) => c.at >= d30).map((c) => ({ id: c.id, at: c.at, ch: c.ch, c: c.c, title: c.sum || cap(words(c.topic)), body: `${roleName(c.by)} · ${statusLabel2(c.out)}`, kind: "contact", waiting: c.out === "not_actioned" || c.out === "waiting" })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const open = d.cases.filter((k) => OPEN.includes(k.st));
  main.innerHTML = html`${pageHead("Customer operations", "The service desk: every message and conversation, newest first, with the case behind it. Conversations are the full threads; contacts are the log of every time someone got in touch.")}
    ${tabs(TABS(), "#/service")}
    ${strip([stat("Contacts, last 30 days", num(d.contacts.filter((c) => c.at >= d30).length), `${num(recent.length)} in 90 days`), stat("First reply, typical", minutes(median(recent.map((c) => c.first).filter((x) => x != null))), "Median, last 90 days", { title: "Half of contacts got a first reply faster than this" }), stat("Resolved in, typical", minutes(median(recent.map((c) => c.resolve).filter((x) => x != null))), "Median, last 90 days"), stat("Answered by the AI assistant", pct(recent.filter((c) => c.by === "assistant").length / (recent.length || 1)), "Share of contacts, last 90 days"), stat("Open cases", num(open.length), `${open.filter((k) => k.cp).length} complaints`, { href: "#/service/cases" }), stat("Waiting for a reply", num(items.filter((i) => i.waiting).length), "Last message from the customer")])}
    <div class="panel section" style="margin-top:16px;overflow:hidden">
      <div class="toolbar"><span class="seg" role="group" aria-label="Channel">${[["all", "All channels"], ["web_chat", "Web chat"], ["email", "Email"], ["phone", "Phone"], ["text", "Text"]].map(([k, l], i) => html`<button aria-pressed="${i === 0}" data-ch="${k}">${l}</button>`)}</span><button class="fchip" data-wait aria-pressed="false">+ Waiting for a reply</button><span class="spacer"></span><span class="tbl-count">Conversations, and contacts from the last 30 days</span></div>
      <div class="inbox"><div class="inbox-list" role="listbox" aria-label="Messages"></div><div class="inbox-read" aria-live="polite"></div></div>
    </div>`;
  const listEl = main.querySelector(".inbox-list"), read = main.querySelector(".inbox-read");
  const st = { ch: "all", wait: false, sel: q.item || null };
  const draw = () => {
    const list = items.filter((i) => (st.ch === "all" || i.ch === st.ch) && (!st.wait || i.waiting));
    if (!st.sel || !list.some((i) => i.id === st.sel)) st.sel = list[0]?.id;
    listEl.innerHTML = list.length ? html`${list.slice(0, 200).map((i) => { const c = d.cm.get(i.c); const seen = canSeeCustomer(i.c); return html`<a class="inbox-item" role="option" href="#/service?item=${i.id}" data-item="${i.id}" aria-current="${i.id === st.sel}" aria-selected="${i.id === st.sel}">${i.c ? avatar(i.c, seen ? c?.name : "?") : html`<span class="avatar" style="background:var(--sunken)">?</span>`}<b>${i.c ? (seen ? c?.name : redact(c?.name || "", false)) : "Not a customer yet"}</b><time datetime="${i.at}">${i.at.slice(0, 10) === S.meta.now.slice(0, 10) ? time(i.at) : dateShort(i.at)}</time><span class="row"><span class="pill plain" style="height:18px;font-size:11px">${CHANNELS[i.ch] || i.ch}</span>${i.kind === "conv" ? html`<span class="pill ai plain" style="height:18px;font-size:11px">${i.n} messages</span>` : ""}${i.waiting ? html`<span class="pill warn" style="height:18px;font-size:11px">Waiting</span>` : ""}</span><small>${i.title}</small></a>`; })}` : html`<div class="empty"><b>Nothing here.</b>Try another channel.</div>`;
    openItem(st.sel);
  };
  const openItem = async (id) => {
    if (!id) { read.innerHTML = ""; return; }
    listEl.querySelectorAll("[data-item]").forEach((a) => { a.setAttribute("aria-current", a.dataset.item === id); a.setAttribute("aria-selected", a.dataset.item === id); });
    read.innerHTML = '<span class="skel" style="height:200px"></span>';
    const m = await import("./v-records.js");
    await m.inDrawer(id, read);
  };
  listEl.addEventListener("click", (e) => { const a = e.target.closest("[data-item]"); if (!a) return; e.preventDefault(); st.sel = a.dataset.item; history.replaceState(null, "", `#/service?item=${st.sel}`); openItem(st.sel); });
  main.querySelectorAll("[data-ch]").forEach((b) => (b.onclick = () => { st.ch = b.dataset.ch; main.querySelectorAll("[data-ch]").forEach((x) => x.setAttribute("aria-pressed", x === b)); draw(); }));
  main.querySelector("[data-wait]").onclick = (e) => { st.wait = !st.wait; e.currentTarget.setAttribute("aria-pressed", st.wait); e.currentTarget.textContent = (st.wait ? "" : "+ ") + "Waiting for a reply"; draw(); };
  draw();
}
const statusLabel2 = (s) => ({ answered: "Answered", order_changed: "Order changed", case_opened: "Case opened", escalated: "Passed to a person", not_actioned: "Never acted on", waiting: "Waiting" })[s] || cap(words(s));

// ---------------------------------------------------------------- cases
export async function cases(main, _, q) {
  if (access("cases") === "none") { main.innerHTML = String(lockPanel("cases", "support cases")); return; }
  const d = await data();
  const rows = d.cases;
  main.innerHTML = html`${pageHead("Customer operations", "Support cases: one per problem, with notes from whoever worked on it.")}${tabs(TABS(), "#/service/cases")}
    ${strip([stat("Open", num(rows.filter((k) => k.st === "open").length)), stat("Passed to a person", num(rows.filter((k) => k.st === "escalated").length), "Escalated, waiting for a person"), stat("Waiting for the customer", num(rows.filter((k) => k.st === "waiting_customer").length)), stat("Complaints, all time", num(rows.filter((k) => k.cp).length), `${pct(rows.filter((k) => k.cp).length / (rows.length || 1))} of cases`), stat("Cases, all time", num(rows.length))])}
    <div class="section" id="caseList" style="margin-top:16px"></div>`;
  dataList(main.querySelector("#caseList"), {
    key: "cases", rows, rowId: (k) => k.n, placeholder: "Case, subject, customer", caption: "Cases",
    text: (k) => `${k.n} ${k.s} ${canSeeCustomer(k.c) ? d.cm.get(k.c)?.name : ""} ${k.cat}`,
    views: [{ id: "open", label: "Not finished", test: (k) => OPEN.includes(k.st) }, { id: "esc", label: "Passed to a person", test: (k) => k.st === "escalated" }, { id: "cp", label: "Complaints", test: (k) => k.cp }, { id: "done", label: "Resolved or closed", test: (k) => !OPEN.includes(k.st) }, { id: "all", label: "All" }],
    chips: [...new Set(rows.map((k) => k.cat))].map((c) => ({ id: c, label: cap(words(c)), test: (k) => k.cat === c })),
    cols: [
      { label: "Case", sort: (k) => k.o, cell: (k) => html`<span class="id">${k.n}</span><span class="sub">${date(k.o)}</span>` },
      { label: "Subject", sort: (k) => k.s, cell: (k) => html`<b style="font-weight:550">${k.s}</b>${k.cp ? html` ${tonePill(`Stage ${k.stage}`, "serious", "Formal complaint")}` : ""}`, cls: "clip" },
      { label: "Customer", cell: (k) => whoSync(k.c, d.cm), cls: "hide-m" },
      { label: "About", sort: (k) => k.cat, cell: (k) => cap(words(k.cat)), cls: "hide-m" },
      { label: "Status", sort: (k) => k.st, cell: (k) => pill(k.st) },
      { label: "Last note", sort: (k) => k.last || "", cell: (k) => (k.last ? html`${ago(k.last)}<span class="sub">${k.notes} notes</span>` : "–"), cls: "hide-m" },
    ],
  }).setView(q.view || "open");
}

// ---------------------------------------------------------------- complaints and their deadlines
export async function complaints(main) {
  if (access("cases") === "none") { main.innerHTML = String(lockPanel("cases", "complaints")); return; }
  const d = await data();
  const now = S.meta.now;
  const rows = d.cases.filter((k) => k.cp).map((k) => { const days = stageDays(d.rules, k.stage); const used = workingDays(k.o, now); const open = OPEN.includes(k.st); return { ...k, days, used, due: addWorking(k.o, days), over: open && used > days, open }; });
  const months = {}; for (const k of rows) months[k.o.slice(0, 7)] = (months[k.o.slice(0, 7)] || 0) + 1;
  const ms = []; { const d0 = new Date(now); for (let i = 23; i >= 0; i--) { const x = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - i, 1)); ms.push(x.toISOString().slice(0, 7)); } }
  main.innerHTML = html`${pageHead("Customer operations", html`Formal complaints. Stage 1 is answered by support within ${stageDays(d.rules, 1)} working days; stage 2 by the support lead within ${stageDays(d.rules, 2)}.`)}${tabs(TABS(), "#/service/complaints")}
    ${strip([stat("Open complaints", num(rows.filter((k) => k.open).length)), stat("Past their answer date", num(rows.filter((k) => k.over).length), "Working days, Monday to Friday"), stat("At stage 2", num(rows.filter((k) => k.open && k.stage === 2).length), "With the support lead"), stat("Complaints, last 12 months", num(rows.filter((k) => k.o >= ms[12]).length), `${num(rows.length)} all time`)])}
    <div class="section" style="margin-top:16px">${panel("Open complaints and their deadlines", html`<div id="openC" style="margin:-4px -16px -16px"></div>`)}</div>
    <div class="cols c21 section">${panel("Complaints opened by month", html`<div id="cpCh"></div>`, { sub: "Last 24 months" })}${panel("What they were about", raw(hbars(Object.entries(rows.reduce((m, k) => ((m[k.s] = (m[k.s] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ name: k, value: v })), { fmt: num, color: "var(--s2)" })), { sub: "Most common subjects" })}</div>`;
  table(main.querySelector("#openC"), { rows: rows.filter((k) => k.open).sort((a, b) => b.used - b.days - (a.used - a.days)), rowId: (k) => k.n, caption: "Open complaints", empty: "No open complaints.", cols: [
    { label: "Case", cell: (k) => html`<span class="id">${k.n}</span><span class="sub">Opened ${date(k.o)}</span>` },
    { label: "Subject", cell: (k) => k.s, cls: "clip" },
    { label: "Customer", cell: (k) => whoSync(k.c, d.cm), cls: "hide-m" },
    { label: "Stage", cell: (k) => `Stage ${k.stage}` },
    { label: "Answer due", cell: (k) => html`${date(k.due)}<span class="sub">${k.used} of ${k.days} working days used</span>` },
    { label: "", cell: (k) => (k.over ? tonePill(`${k.used - k.days} days over`, "crit") : tonePill("In time", "good")) },
  ] });
  barChart(main.querySelector("#cpCh"), { labels: ms, values: ms.map((m) => months[m] || 0), fmt: num, name: "Complaints", color: "var(--s2)", xFmt: (l, i, long) => (long ? monthLabel(l, true) : i % 3 === 0 ? monShort(l) : ""), xTicks: 24, height: 190 });
}

// ---------------------------------------------------------------- Fix Club repairs, as a board
export async function repairs(main) {
  if (access("repairs") === "none") { main.innerHTML = String(lockPanel("repairs", "repairs")); return; }
  const d = await data();
  const LANES = [["requested", "Requested"], ["awaiting_item", "Waiting for the item"], ["received", "Arrived at the bench"], ["assessing", "Being checked"], ["quote_sent", "Quote with customer"], ["approved", "Quote accepted"], ["in_repair", "Being repaired"], ["repaired", "Repaired"], ["returned", "Sent back"], ["declined", "Quote declined"], ["unrepairable", "Can't be fixed"]];
  const known = new Set(LANES.map((l) => l[0]));
  for (const r of d.repairs) if (!known.has(r.st)) { LANES.push([r.st, cap(words(r.st))]); known.add(r.st); }
  const live = d.repairs.filter((r) => !["returned", "declined", "unrepairable"].includes(r.st));
  main.innerHTML = html`${pageHead("Customer operations", "The Fix Club: every repair from request to return. A card opens its full history.")}${tabs(TABS(), "#/service/repairs")}
    ${strip([stat("On the bench now", num(live.length), "Not yet finished"), stat("Waiting on a customer's yes", num(d.repairs.filter((r) => r.st === "quote_sent").length)), stat("In warranty", pct(d.repairs.filter((r) => r.w).length / (d.repairs.length || 1)), "Share of all repairs"), stat("Repairs, all time", num(d.repairs.length))])}
    <div class="board section" style="margin-top:16px" role="list">${LANES.map(([k, l]) => { const cards = d.repairs.filter((r) => r.st === k).sort((a, b) => b.o.localeCompare(a.o)); return html`<section class="lane" role="listitem" aria-label="${l}"><h3>${l}<span class="n">${cards.length}</span></h3>${cards.map((r) => html`<a class="ticket" href="#/r/${r.n}" data-rec="${r.n}"><span class="row" style="justify-content:space-between"><span class="id">${r.n}</span>${r.w ? tonePill("Warranty", "good") : r.q != null ? tonePill(money2(r.q), "warn") : ""}</span><b>${skuName(r.sku)}</b><span class="muted">${r.fault}</span><span class="row" style="margin-top:6px;justify-content:space-between"><span class="small">${canSeeCustomer(r.c) ? d.cm.get(r.c)?.name : "Customer"}</span><span class="muted">${ago(r.last || r.o)}</span></span></a>`)}</section>`; })}</div>`;
  main.querySelector(".board").addEventListener("click", (e) => { const a = e.target.closest("a[data-rec]"); if (!a) return; e.preventDefault(); import("./core.js").then((c) => c.openRecord(a.dataset.rec)); });
}

// ---------------------------------------------------------------- what customers ask about
export async function topics(main) {
  if (access("contacts") === "none") { main.innerHTML = String(lockPanel("contacts", "customer contacts")); return; }
  const d = await data();
  const now = S.meta.now, d90 = new Date(Date.parse(now) - 90 * 864e5).toISOString(), d180 = new Date(Date.parse(now) - 180 * 864e5).toISOString();
  const recent = d.contacts.filter((c) => c.at >= d90), before = d.contacts.filter((c) => c.at >= d180 && c.at < d90);
  const count = (list) => list.reduce((m, c) => ((m[c.topic] = (m[c.topic] || 0) + 1), m), {});
  const tn = count(recent), tb = count(before);
  const chans = Object.keys(CH_C);
  const ms = {}; for (const c of d.contacts) { const m = c.at.slice(0, 7); (ms[m] ||= Object.fromEntries(chans.map((k) => [k, 0])))[c.ch] = (ms[m][c.ch] || 0) + 1; }
  const months = Object.keys(ms).sort().slice(-24);
  const roles = [...new Set(d.contacts.map((c) => c.by).filter(Boolean))];
  main.innerHTML = html`${pageHead("Customer operations", "What people get in touch about, how they get in touch, and how fast they hear back.")}${tabs(TABS(), "#/service/topics")}
    <div class="cols c2">
      ${panel("Most asked, last 90 days", raw(hbars(Object.entries(tn).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: cap(words(k)), value: v, title: `${cap(words(k))}: ${v} in the last 90 days, ${tb[k] || 0} in the 90 before` })), { fmt: num })), { sub: `${num(recent.length)} contacts` })}
      <div class="stack">
        ${panel("How they got in touch", raw(meter(chans.map((k) => ({ name: CHANNELS[k], value: recent.filter((c) => c.ch === k).length, color: CH_C[k] })), { fmt: num })), { sub: "Last 90 days" })}
        ${panel("Who answered", raw(meter(roles.map((r, i) => ({ name: roleName(r), value: recent.filter((c) => c.by === r).length, color: isAI(r) ? "var(--s3)" : SERIES[[0, 1, 3, 4, 5][i % 5]] })), { fmt: num })), { sub: "Last 90 days" })}
      </div>
    </div>
    <div class="section">${panel("Contacts by month", html`<div id="cmCh"></div>`, { sub: "All channels, last 24 months" })}</div>
    <div class="section">${panel("How fast, by channel", html`<div id="speed" style="margin:-4px -16px -16px"></div>`, { sub: "Medians over the last 90 days. Half were faster than this." })}</div>`;
  lineChart(main.querySelector("#cmCh"), { labels: months, series: chans.map((k) => ({ name: CHANNELS[k], values: months.map((m) => ms[m][k] || 0), color: CH_C[k] })), fmt: num, xFmt: (l, i, long) => (long ? monthLabel(l, true) : monShort(l)), height: 220, title: "Contacts by month and channel" });
  table(main.querySelector("#speed"), { rows: chans, caption: "Speed by channel", cols: [{ label: "Channel", cell: (k) => html`<span class="row"><i class="dot" style="background:${CH_C[k]}"></i>${CHANNELS[k]}</span>` }, { label: "Contacts", num: true, cell: (k) => num(recent.filter((c) => c.ch === k).length) }, { label: "First reply", num: true, cell: (k) => minutes(median(recent.filter((c) => c.ch === k && c.first != null).map((c) => c.first))) }, { label: "Resolved in", num: true, cell: (k) => minutes(median(recent.filter((c) => c.ch === k && c.resolve != null).map((c) => c.resolve))) }, { label: "Turned into a case", num: true, cell: (k) => pct(recent.filter((c) => c.ch === k && c.case).length / (recent.filter((c) => c.ch === k).length || 1)) }] });
}
