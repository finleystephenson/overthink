// Sales: the prospects (businesses that buy only if someone approaches them) from business/data/prospects.json.
// Contact details are left out at build time. Only what the file records is shown: no stages or outreach are invented.
import { html, raw, icon, load, money, money2, num, pct, plural, pageHead, panel, strip, stat, dataList, kv, tonePill, prodLink, date, words, cap } from "./core.js";
import { hbars } from "./charts.js";

const BAND = { micro: "Micro", small: "Small", medium: "Medium", large: "Large" };
const every = (e) => (e === "once" ? "one time" : "every " + e);
const count = (rows, f) => { const m = {}; for (const r of rows) { const k = f(r); m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]); };
const needsOf = (p) => p.needs.map((n) => `${n.qty} × ${n.product.replace(/-/g, " ")}`).join(", ");

export async function prospects(main) {
  const rows = await load("sales.json");
  const stages = count(rows, (p) => p.status), contacted = rows.filter((p) => p.last_contacted).length;
  const budget = rows.reduce((n, p) => n + (p.monthly_budget || 0), 0);
  main.innerHTML = html`${pageHead("Prospects", "Businesses the shop could sell to. They only buy if someone approaches them, with an offer that fits what they need.")}
    ${strip([
      stat("Prospects", num(rows.length), `${plural(new Set(rows.map((p) => p.sector)).size, "sector")}`),
      stat("Pipeline", stages.map(([s, n]) => `${num(n)} ${s}`).join(", "), stages.length === 1 ? "Every prospect is at the first stage" : "Prospects by stage"),
      stat("Contacted", num(contacted), contacted ? "have a recorded contact" : "No outreach recorded yet"),
      stat("Monthly budgets", money(budget), "added up across all prospects"),
    ])}
    <div class="section" id="plist"></div>
    <div class="cols c3" style="margin-top:28px">
      ${panel("By sector", raw(hbars(count(rows, (p) => p.sector).map(([n, v]) => ({ name: cap(n), value: v })), { color: "var(--accent-deep)" })))}
      ${panel("By budget band", raw(hbars(count(rows, (p) => p.budget_band).map(([n, v]) => ({ name: BAND[n] || n, value: v })), { color: "var(--accent-deep)" })))}
      ${panel("Preferred channel", raw(hbars(count(rows, (p) => p.channel).map(([n, v]) => ({ name: cap(n), value: v })), { color: "var(--accent-deep)" })))}
    </div>`;
  const sectors = count(rows, (p) => p.sector).slice(0, 6).map(([s]) => s);
  dataList(main.querySelector("#plist"), {
    key: "prospects", rows, rowId: (p) => p.id, onOpen: (id) => { location.hash = `#/sales/${id}`; }, placeholder: "Business, sector, town or decision-maker", caption: "Prospects", sortCol: 5, sortDir: -1,
    text: (p) => `${p.id} ${p.name} ${p.sector} ${p.town} ${p.decision_maker}`,
    views: [{ id: "all", label: "All prospects" }, ...sectors.map((s) => ({ id: s, label: cap(s), test: (p) => p.sector === s }))],
    chips: Object.keys(BAND).map((b) => ({ id: b, label: BAND[b] + " budget", test: (p) => p.budget_band === b })).concat([{ id: "email", label: "Prefers email", test: (p) => p.channel === "email" }, { id: "letter", label: "Prefers letters", test: (p) => p.channel === "letter" }]),
    cols: [
      { label: "Business", sort: (p) => p.name, cell: (p) => html`<b>${p.name}</b><span class="sub">${p.id} · ${cap(p.sector)}</span>` },
      { label: "Size", num: true, sort: (p) => p.staff, cell: (p) => html`${num(p.staff)}<span class="sub">staff</span>`, cls: "hide-m" },
      { label: "Where", sort: (p) => p.town, cell: (p) => p.town, cls: "hide-m" },
      { label: "Needs", cell: (p) => html`<span class="sub" style="margin:0">${needsOf(p)}</span>`, cls: "hide-m" },
      { label: "Budget", sort: (p) => p.monthly_budget, cell: (p) => html`${BAND[p.budget_band] || p.budget_band}<span class="sub">${money(p.monthly_budget)}/mo</span>` },
      { label: "Reply likelihood", num: true, sort: (p) => p.reply ?? -1, cell: (p) => (p.reply == null ? "–" : pct(p.reply)), title: "How likely they are to answer an approach, from the simulator's data" },
      { label: "Stage", sort: (p) => p.status, cell: (p) => tonePill(cap(p.status), "info") },
    ],
  });
}

export async function prospect(main, [id]) {
  const rows = await load("sales.json"), p = rows.find((x) => x.id === id);
  if (!p) { main.innerHTML = String(html`<div class="empty"><b>There is no prospect called “${id}”.</b><a href="#/sales">Back to the prospects</a></div>`); return; }
  window.__setCrumbs([["#/sales", "Sales"], ["#/sales", "Prospects"], p.name]);
  main.innerHTML = html`${pageHead(p.name, `${cap(p.sector)} in ${p.town}, ${plural(p.staff, "member of staff", "staff")}.`)}
    <div class="cols main-aside">
      <div class="stack">
        ${panel("What they need", html`<div class="tbl-wrap"><table><thead><tr><th>Product</th><th class="num">Quantity</th><th class="num">Price each</th><th>How often</th></tr></thead><tbody>${p.needs.map((n) => html`<tr><td>${prodLink(n.product)}</td><td class="num">${num(n.qty)}</td><td class="num">${money2(n.unit_price)}</td><td>${cap(every(n.every))}</td></tr>`)}</tbody></table></div>`, { flush: true })}
        ${panel("Outreach", p.last_contacted ? html`<p>Last contacted ${date(p.last_contacted)}.</p>` : html`<p class="muted">Nothing recorded. They have not been approached.</p>`, { sub: "From the prospect record" })}
        ${p.notes ? panel("Notes", html`<p>${p.notes}</p>`) : ""}
      </div>
      <aside>${panel("About them", kv([
        ["Stage", cap(p.status)], ["Sector", cap(p.sector)], ["Size", plural(p.staff, "member of staff", "staff")], ["Town", p.town],
        ["Budget band", BAND[p.budget_band] || p.budget_band], ["Monthly budget", money(p.monthly_budget)],
        ["Decision-maker", p.decision_maker], ["Preferred channel", cap(p.channel)], ["Reply likelihood", p.reply == null ? "–" : pct(p.reply), "From the simulator's data: how likely they are to answer an approach"],
      ]))}</aside></div>`;
}
