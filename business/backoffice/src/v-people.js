// People: the team from business/data/staff.json. Pay, hours and task minutes are the file's own; everything else is worked out here.
import { S, html, raw, esc, icon, load, money, money2, num, pct, plural, pageHead, panel, strip, stat, table, kv, tonePill, words } from "./core.js";
import { hbars, meter } from "./charts.js";

const TILE = ["#5fc3ec", "#ff7433", "#f45ba6", "#ffc72c", "#b5e53a", "#c9b9f2"]; // brand colours for initial tiles, until photos exist
const TEAM = { manager: "Management", finance: "Finance", warehouse: "Warehouse", support_lead: "Customer service", support_agent: "Customer service", buyer: "Buying", marketing: "Marketing", technician: "Fix Club" };
const team = (p) => TEAM[p.role] || words(p.role);
const label = (t) => String(t).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const weekly = (p) => p.weekly_hours * p.hourly_pay;

// A coloured initial tile: the person's first letter. Photos come later.
export const tileFor = (p, big) => html`<span class="pp-tile ${big ? "big" : ""}" style="background:${TILE[(parseInt(p.id.replace(/\D/g, ""), 10) - 1) % TILE.length]}" aria-hidden="true">${p.name[0]}</span>`;

const totals = (d) => {
  const hours = d.staff.reduce((n, p) => n + p.weekly_hours, 0), pay = d.staff.reduce((n, p) => n + weekly(p), 0);
  return { hours, pay, withOn: pay * (1 + d.on_cost_rate), monthly: (pay * (1 + d.on_cost_rate) * 52) / 12 };
};

export async function directory(main) {
  const d = await load("people.json"), t = totals(d);
  main.innerHTML = html`${pageHead("The team", `${plural(d.staff.length, "person", "people")} on the payroll, working ${d.days.length} days a week from ${d.day_start}. Each one is a character from a book or a myth.`)}
    ${strip([
      stat("Weekly payroll", money(t.pay), `${money(t.withOn)} with on-costs`),
      stat("Contracted hours", num(t.hours) + " h", "a week, paid busy or not"),
      stat("Average hourly pay", money2(t.pay / t.hours), "weighted by hours"),
      stat("A month", money(t.monthly), "with on-costs, 52 weeks over 12"),
    ])}
    <section class="section"><div id="team"></div></section>
    <nav class="ov-links" style="margin-top:28px"><a href="#/people/time">Where the time goes<small>Hours and pay by team, and what each task takes</small></a></nav>`;
  table(main.querySelector("#team"), {
    caption: "The team", rows: d.staff, rowId: (p) => p.id, onOpen: (id) => { location.hash = `#/people/${id}`; }, sortCol: 0, sortDir: 1, tall: true,
    cols: [
      { label: "Person", sort: (p) => p.name, cell: (p) => html`<span class="row" style="flex-wrap:nowrap;gap:12px">${tileFor(p)}<span><b>${p.name}</b><span class="sub">${p.from}</span></span></span>` },
      { label: "Role", sort: (p) => p.job, cell: (p) => html`${p.job}<span class="sub">${team(p)}</span>`, cls: "hide-m" },
      { label: "Hours a week", num: true, sort: (p) => p.weekly_hours, cell: (p) => num(p.weekly_hours) },
      { label: "Pay an hour", num: true, sort: (p) => p.hourly_pay, cell: (p) => money2(p.hourly_pay), cls: "hide-m" },
      { label: "Pay a week", num: true, sort: (p) => weekly(p), cell: (p) => money(weekly(p)) },
      { label: "Tasks", sort: (p) => Object.keys(p.tasks).length, cell: (p) => html`${plural(Object.keys(p.tasks).length, "task")}<span class="sub">${Object.keys(p.tasks).slice(0, 2).map(label).join(", ")}${Object.keys(p.tasks).length > 2 ? "…" : ""}</span>`, cls: "hide-m" },
    ],
  });
}

export async function person(main, [id]) {
  const d = await load("people.json"), p = d.staff.find((x) => x.id === id);
  if (!p) { main.innerHTML = String(html`<div class="empty"><b>There is no one with the id “${id}”.</b><a href="#/people">Back to the team</a></div>`); return; }
  window.__setCrumbs([["#/people", "People"], ["#/people", "The team"], p.name]);
  const tasks = Object.entries(p.tasks).sort((a, b) => b[1] - a[1]), top = Math.max(...tasks.map((x) => x[1]), 1);
  const routine = p.fixed_daily_minutes ? (p.fixed_daily_minutes * d.days.length) / 60 : 0;
  main.innerHTML = html`<div class="pp-head">${tileFor(p, true)}<div><h1>${p.name}</h1><p class="sub">${p.job}. ${p.from}.</p></div></div>
    <div class="cols main-aside" style="margin-top:28px">
      <div class="stack">
        ${panel("What they do, and how long each takes", html`<div class="bars">${tasks.map(([k, m]) => html`<div class="bar-row"><span class="name" title="${label(k)}">${label(k)}</span><span class="track"><span class="fill" style="display:block;width:${(m / top) * 100}%;background:var(--accent-deep)"></span></span><span class="val">${m} min</span></div>`)}</div>`, { sub: "Minutes for one task at normal speed" })}
        ${routine ? panel("Where the week goes", html`${raw(meter([{ name: "Daily routine", value: routine, color: "var(--accent-deep)" }, { name: "Work as it arrives", value: Math.max(0, p.weekly_hours - routine), color: "var(--s-prev)" }], { fmt: (v) => `${(Math.round(v * 10) / 10)} h` }))}`, { sub: `${p.weekly_hours} contracted hours` }) : ""}
      </div>
      <aside>${panel("Their terms", kv([
        ["Team", team(p)], ["Hours a week", `${p.weekly_hours} h`], ["Shift starts", p.start || d.day_start], ["Works", d.days.map((x) => x[0].toUpperCase() + x.slice(1)).join(", ")],
        ["Pay an hour", money2(p.hourly_pay)], ["Pay a week", money(weekly(p)), "Hours times hourly pay"], ["With on-costs", money(weekly(p) * (1 + d.on_cost_rate)), `${pct(d.on_cost_rate)} on top`],
        ["Accuracy", pct(p.skill), "Chance of handling a customer contact correctly at normal load"], ["Can work overtime", p.overtime ? "Yes, at " + d.overtime_rate + " times pay" : "No"],
        ["Daily routine", p.fixed_daily_minutes ? `${p.fixed_daily_minutes} min a day` : "None"],
      ]))}</aside></div>`;
}

export async function time(main) {
  const d = await load("people.json"), t = totals(d);
  const by = {}; for (const p of d.staff) { const g = (by[team(p)] ||= { name: team(p), hours: 0, pay: 0, people: 0 }); g.hours += p.weekly_hours; g.pay += weekly(p); g.people++; }
  const groups = Object.values(by).sort((a, b) => b.hours - a.hours);
  const taskMap = {}; for (const p of d.staff) for (const [k, m] of Object.entries(p.tasks)) (taskMap[k] ||= []).push([p, m]);
  const tasks = Object.entries(taskMap).map(([k, v]) => ({ k, min: Math.min(...v.map((x) => x[1])), max: Math.max(...v.map((x) => x[1])), who: v.map((x) => x[0]) })).sort((a, b) => b.max - a.max);
  const routineH = d.staff.reduce((n, p) => n + ((p.fixed_daily_minutes || 0) * d.days.length) / 60, 0);
  main.innerHTML = html`${pageHead("Where the time goes", "Worked out from the contracted hours, the pay and the minutes each task takes. The file says how long a task takes, not how many there are, so busy-ness is not guessed.")}
    ${strip([stat("Contracted hours", num(t.hours) + " h", "a week"), stat("Daily routine", `${Math.round(routineH)} h`, `${pct(routineH / t.hours)} of the week, fixed`), stat("Biggest team", `${num(groups[0].hours)} h`, `${groups[0].name}, ${pct(groups[0].hours / t.hours)} of hours`), stat("Weekly payroll", money(t.pay), "before on-costs")])}
    <div class="cols c2" style="margin-top:28px">
      ${panel("Hours by team", raw(hbars(groups.map((g) => ({ name: g.name, value: g.hours, title: `${g.name}: ${g.hours} h, ${g.people} ${g.people === 1 ? "person" : "people"}` })), { fmt: (v) => `${v} h`, color: "var(--accent-deep)" })), { sub: "Contracted hours a week" })}
      ${panel("Pay by team", raw(hbars(groups.map((g) => ({ name: g.name, value: g.pay })).sort((a, b) => b.value - a.value), { fmt: money, color: "var(--accent-deep)" })), { sub: "Hours times hourly pay, a week" })}
    </div>
    <section class="section">${panel("Each person's week", html`<div class="pp-weeks">${[...d.staff].sort((a, b) => b.weekly_hours - a.weekly_hours).map((p) => { const r = ((p.fixed_daily_minutes || 0) * d.days.length) / 60; return html`<a class="pp-wk" href="#/people/${p.id}">${tileFor(p)}<span class="nm">${p.name}<small>${p.job}</small></span><span class="trk"><i class="r" style="width:${(r / 40) * 100}%"></i><i class="o" style="width:${((p.weekly_hours - r) / 40) * 100}%"></i></span><span class="mv">${p.weekly_hours} h</span></a>`; })}</div><p class="small muted" style="margin-top:12px"><span class="pp-key r"></span> Daily routine <span class="pp-key o"></span> Work as it arrives</p>`)}</section>
    <section class="section">${panel("What each task takes", html`<div class="tbl-wrap"><table><thead><tr><th>Task</th><th class="num">Minutes</th><th>Done by</th></tr></thead><tbody>${tasks.map((x) => html`<tr><td>${label(x.k)}</td><td class="num">${x.min === x.max ? x.max : `${x.min} to ${x.max}`}</td><td>${x.who.map((p) => p.name).join(", ")}</td></tr>`)}</tbody></table></div>`, { flush: true, sub: "Where several people do a task, the range is fastest to slowest" })}</section>`;
}
