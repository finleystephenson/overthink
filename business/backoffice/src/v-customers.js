// Customers: the directory, with segments worked out from behaviour. Each profile is a record page (#/r/C-…).
import { S, html, money, money2, num, pct, date, ago, customers, access, scopedCustomer, whoSync, canSeeCustomer, redact, tonePill, strip, stat, pageHead, dataList, lockPanel } from "./core.js";

const SEG = { regular: ["Regular", "good"], one_time: ["One-time", ""], business: ["Business", "ai"], returner: ["Returner", "warn"], complainer: ["Complainer", "serious"] };

export async function directory(main, _, q) {
  if (access("customers") === "none") { main.innerHTML = String(lockPanel("customers", "customers")); return; }
  const cm = await customers();
  const one = scopedCustomer();
  const rows = [...cm.values()].filter((c) => !one || c.id === one);
  const buyers = rows.filter((c) => c.orders > 0);
  const year = S.meta.now.slice(0, 4);
  main.innerHTML = html`${pageHead("Customers", html`Everyone with an account. The groups are worked out from what people did, because a customer's type is not stored. Hover a group for its exact rule.`)}
    ${strip([
      stat("Customers", num(rows.length), `${num(rows.length - buyers.length)} have not bought yet`),
      stat("Bought more than once", pct(buyers.filter((c) => c.orders >= 2).length / (buyers.length || 1)), `${num(buyers.filter((c) => c.orders >= 2).length)} of ${num(buyers.length)} buyers`),
      stat("Bought this year", num(rows.filter((c) => c.last && c.last.startsWith(year)).length), "Last paid order in " + year),
      stat("Average spend", money(buyers.reduce((n, c) => n + c.spend, 0) / (buyers.length || 1)), "Per buyer, after refunds"),
      stat("Agreed to marketing", pct(rows.filter((c) => c.optin).length / (rows.length || 1)), "Can be emailed offers"),
      stat("With an open case", num(rows.filter((c) => c.open > 0).length), "Waiting on support", { href: "#/service/cases" }),
    ])}
    <div class="section" id="clist" style="margin-top:16px"></div>`;
  const segView = (k) => ({ id: k, label: SEG[k][0] === "One-time" ? "One-time buyers" : SEG[k][0] === "Business" ? "Business buyers" : SEG[k][0] + "s", test: (c) => c.segs.includes(k) });
  dataList(main.querySelector("#clist"), {
    key: "customers", rows, rowId: (c) => c.id, placeholder: "Name, email, town, postcode or C-number", caption: "Customers", sortCol: 4,
    text: (c) => `${c.id} ${c.name} ${c.email} ${c.town} ${c.postcode}`,
    views: [{ id: "all", label: "Everyone" }, ...Object.keys(SEG).map(segView)],
    chips: [{ id: "open", label: "Open case", test: (c) => c.open > 0 }, { id: "credit", label: "Has credit", test: (c) => c.credit > 0 }, { id: "never", label: "Never bought", test: (c) => c.orders === 0 }, { id: "lapsed", label: "Not bought in a year", test: (c) => c.last && c.last < String(+year - 1) + S.meta.now.slice(4, 10) }, { id: "optin", label: "Agreed to marketing", test: (c) => c.optin }],
    cols: [
      { label: "Customer", sort: (c) => c.name, cell: (c) => html`${whoSync(c.id, cm)}<span class="sub mono" style="margin-left:34px">${c.id}</span>` },
      { label: "Groups", cell: (c) => html`<span class="row" style="gap:4px">${c.segs.map((s) => tonePill(SEG[s][0], SEG[s][1], S.meta.segments[s]))}</span>`, cls: "hide-m" },
      { label: "Town", sort: (c) => c.town, cell: (c) => html`${c.town}<span class="sub">${redact(c.postcode, canSeeCustomer(c.id) && S.role !== "operations_assistant")}</span>`, cls: "hide-m" },
      { label: "Joined", sort: (c) => c.joined, cell: (c) => date(c.joined), cls: "hide-m" },
      { label: "Paid orders", num: true, sort: (c) => c.orders, cell: (c) => num(c.orders) },
      { label: "Spent", num: true, sort: (c) => c.spend, cell: (c) => money2(c.spend), title: "Paid orders minus refunds" },
      { label: "Last order", sort: (c) => c.last || "", cell: (c) => (c.last ? html`${date(c.last)}<span class="sub">${ago(c.last)}</span>` : html`<span class="muted">Never</span>`), cls: "hide-m" },
      { label: "Returns", num: true, sort: (c) => c.returns, cell: (c) => num(c.returns), cls: "hide-m" },
      { label: "Cases", num: true, sort: (c) => c.cases, cell: (c) => (c.open ? html`${num(c.cases)} <span class="pill warn" style="margin-left:4px">${c.open} open</span>` : num(c.cases)) },
    ],
  }).setView(q.view || "all");
}
