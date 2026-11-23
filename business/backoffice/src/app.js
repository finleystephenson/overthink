// The shell: navigation, routing, breadcrumbs, the command palette, the "View as" switch, spoilers, theme, the drawer.
import { S, load, html, raw, esc, icon, num, roleName, isAI, longNow, customers, closeDrawer, openRecord, setDrawerRenderer, pref, skeleton, href, scopedCustomer, access, plural } from "./core.js";

// ---------------------------------------------------------------- navigation: every page, in the order a person thinks
const NAV = [
  { id: "overview", label: "Company overview", icon: "home", href: "#/overview" },
  { id: "simulation", label: "Simulation", icon: "trend", items: [["#/simulation", "Saved runs"]], deep: true },
  { id: "commerce", label: "Commerce", icon: "cart", items: [["#/orders", "Orders", "orders"], ["#/products", "Products", "products"], ["#/payments", "Payments", "orders"], ["#/deliveries", "Deliveries", "orders", "late"], ["#/returns", "Returns and refunds", "orders", "returns_open"]] },
  { id: "customers", label: "Customers", icon: "users", items: [["#/customers", "Directory", "customers"], ["#/customers?view=regular", "Regulars", "customers"], ["#/customers?view=business", "Business buyers", "customers"], ["#/customers?view=returner", "Frequent returners", "customers"], ["#/customers?view=complainer", "Complainers", "customers"]] },
  { id: "service", label: "Customer operations", icon: "headset", items: [["#/service", "Service desk", "contacts"], ["#/service/cases", "Cases", "cases", "open_cases"], ["#/service/complaints", "Complaints", "cases"], ["#/service/repairs", "Fix Club repairs", "repairs"], ["#/service/topics", "What customers ask", "contacts"]] },
  { id: "ops", label: "Operations and supply", icon: "stock", items: [["#/stock", "Stock", "stock", "empty"], ["#/stock/counts", "Movements and counts", "stock"], ["#/suppliers", "Suppliers", "buying"], ["#/purchase-orders", "Purchase orders", "buying", "pos_open"], ["#/stockouts", "Stockouts", "stock"]] },
  { id: "finance", label: "Finance", icon: "coins", items: [["#/finance", "Profit and loss", "finance"], ["#/finance/cash", "Cash", "finance"], ["#/finance/margins", "Margins by product", "finance"], ["#/ledger", "Ledger", "ledger"], ["#/finance/anomalies", "Worth a look", "ledger"]] },
  { id: "marketing", label: "Marketing and sales", icon: "megaphone", items: [["#/marketing", "Campaigns", "marketing"], ["#/marketing/funnel", "Visitors and funnel", "marketing"], ["#/marketing/sales", "Repeat buying and best sellers", "marketing"]] },
  { id: "sales", label: "Sales", icon: "target", items: [["#/sales", "Prospects"]], deep: true },
  { id: "people", label: "People", icon: "person", items: [["#/people", "The team"], ["#/people/time", "Where the time goes"]], deep: true },
  { id: "systems", label: "Company systems and data", icon: "code", items: [["#/systems/roles", "Structure and roles"], ["#/systems/rules", "Rules and policies"], ["#/systems/knowledge", "Company knowledge", "documents"], ["#/systems/data", "Data dictionary"], ["#/systems/tools", "Tools reference"], ["#/systems/connect", "Connect"], ["#/systems/situations", "Situations"], ["#/systems/problems", "Known problems"], ["#/systems/judging", "How results are judged"]] },
];
const ROUTES = [
  [/^overview$/, "v-overview", "overview", ["overview"]],
  [/^needs$/, "v-overview", "needs", ["overview", "Everything that needs you"]],
  [/^activity$/, "v-overview", "activity", ["overview", "Recent activity"]],
  [/^about$/, "v-overview", "about", ["overview", "The company and five years"]],
  [/^simulation$/, "v-sim", "list", ["simulation", "Saved runs"]],
  [/^simulation\/([\w.-]+)\/card$/, "v-sim", "card", ["simulation", ["#/simulation", "Saved runs"]]],
  [/^simulation\/([\w.-]+)$/, "v-sim", "run", ["simulation", ["#/simulation", "Saved runs"]]],
  [/^sales$/, "v-sales", "prospects", ["sales", "Prospects"]],
  [/^sales\/([\w-]+)$/, "v-sales", "prospect", ["sales", ["#/sales", "Prospects"]]],
  [/^people$/, "v-people", "directory", ["people", "The team"]],
  [/^people\/time$/, "v-people", "time", ["people", "Where the time goes"]],
  [/^people\/([\w-]+)$/, "v-people", "person", ["people", ["#/people", "The team"]]],
  [/^orders$/, "v-commerce", "orders", ["commerce", "Orders"]],
  [/^products$/, "v-commerce", "products", ["commerce", "Products"]],
  [/^products\/([\w-]+)$/, "v-commerce", "product", ["commerce", ["#/products", "Products"]]],
  [/^payments$/, "v-commerce", "payments", ["commerce", "Payments"]],
  [/^deliveries$/, "v-commerce", "deliveries", ["commerce", "Deliveries"]],
  [/^returns$/, "v-commerce", "returns", ["commerce", "Returns and refunds"]],
  [/^customers$/, "v-customers", "directory", ["customers", "Directory"]],
  [/^service$/, "v-service", "desk", ["service", "Service desk"]],
  [/^service\/cases$/, "v-service", "cases", ["service", "Cases"]],
  [/^service\/complaints$/, "v-service", "complaints", ["service", "Complaints"]],
  [/^service\/repairs$/, "v-service", "repairs", ["service", "Fix Club repairs"]],
  [/^service\/topics$/, "v-service", "topics", ["service", "What customers ask"]],
  [/^stock$/, "v-ops", "stock", ["ops", "Stock"]],
  [/^stock\/counts$/, "v-ops", "counts", ["ops", "Movements and counts"]],
  [/^suppliers$/, "v-ops", "suppliers", ["ops", "Suppliers"]],
  [/^purchase-orders$/, "v-ops", "pos", ["ops", "Purchase orders"]],
  [/^stockouts$/, "v-ops", "stockouts", ["ops", "Stockouts"]],
  [/^finance$/, "v-finance", "pnl", ["finance", "Profit and loss"]],
  [/^finance\/cash$/, "v-finance", "cash", ["finance", "Cash"]],
  [/^finance\/margins$/, "v-finance", "margins", ["finance", "Margins by product"]],
  [/^ledger$/, "v-finance", "ledger", ["finance", "Ledger"]],
  [/^finance\/anomalies$/, "v-finance", "anomalies", ["finance", "Worth a look"]],
  [/^marketing$/, "v-marketing", "campaigns", ["marketing", "Campaigns"]],
  [/^marketing\/funnel$/, "v-marketing", "funnel", ["marketing", "Visitors and funnel"]],
  [/^marketing\/sales$/, "v-marketing", "sales", ["marketing", "Repeat buying and best sellers"]],
  [/^systems\/(roles|rules|knowledge|data|tools|connect|situations|problems|judging)$/, "v-systems", null, ["systems"]],
  [/^r\/([\w-]+)$/, "v-records", "page", []],
];
const groupOf = (id) => NAV.find((n) => n.id === id);
const modules = {};
const mod = (name) => (modules[name] ||= import(`./${name}.js`));

// ---------------------------------------------------------------- breadcrumbs
const crumbsEl = document.getElementById("crumbs");
export function setCrumbs(parts) {
  crumbsEl.innerHTML = html`${parts.map((p, i) => {
    const last = i === parts.length - 1;
    const [h, l] = Array.isArray(p) ? p : [null, p];
    return html`${i ? html`<span class="sep" aria-hidden="true">/</span>` : ""}${last ? html`<span class="here" aria-current="page">${l}</span>` : h ? html`<a href="${h}">${l}</a>` : html`<span>${l}</span>`}`;
  })}`;
  document.title = `${(Array.isArray(parts.at(-1)) ? parts.at(-1)[1] : parts.at(-1)) || "Back office"} · Overthought & Co. back office`;
}
window.__setCrumbs = setCrumbs;

// ---------------------------------------------------------------- the nav
function drawNav(path) {
  const b = S.meta.badges;
  const hot = new Set(["late", "empty", "open_cases"]);
  const exact = new Set(NAV.flatMap((g) => (g.items || []).map(([h]) => h.slice(2))));
  const on = (h, deep) => { const [hp, hq] = h.slice(2).split("?"); const [pp, pq] = path.split("?"); return (hp === pp && (hq || "") === (pq || "").replace(/&?open=[^&]*/, "")) || (deep && pp.startsWith(hp + "/") && !exact.has(pp)); }; // deep: a page under this one keeps it lit
  document.getElementById("nav").innerHTML = html`${NAV.map((g) => {
    if (!g.items) return html`<a class="nav-top ${on(g.href) ? "on" : ""}" data-area="${g.id}" href="${g.href}" ${on(g.href) ? raw('aria-current="page"') : ""}><span class="ico">${icon(g.icon)}</span><span>${g.label}</span>${b.needs && access("orders") === "all" ? html`<span class="nav-count hot" style="margin-left:auto" title="Things that need someone">${b.needs}</span>` : ""}</a>`;
    const open = g.items.some(([h]) => on(h, g.deep)) || pref.get("nav-" + g.id, g.id === "commerce");
    return html`<div class="nav-group ${open ? "open" : ""}" data-g="${g.id}"><button class="nav-top ${g.items.some(([h]) => on(h, g.deep)) ? "on" : ""}" data-area="${g.id}" aria-expanded="${open}" data-toggle="${g.id}"><span class="ico">${icon(g.icon)}</span><span>${g.label}</span>${icon("chev", "chev")}</button>
      <div class="nav-sub">${g.items.map(([h, l, area, badge]) => { const locked = area && access(area) === "none"; return html`<a href="${h}" class="${on(h, g.deep) ? "on" : ""} ${locked ? "locked" : ""}" ${on(h, g.deep) ? raw('aria-current="page"') : ""} ${locked ? raw(`title="${esc(roleName(S.role))} can't see this"`) : ""}><span>${l}</span>${locked ? icon("lock") : badge && b[badge] && access(area) === "all" ? html`<span class="nav-count ${hot.has(badge) ? "hot" : ""}">${b[badge]}</span>` : ""}</a>`; })}</div></div>`;
  })}`;
}
document.getElementById("nav").addEventListener("click", (e) => {
  const t = e.target.closest("[data-toggle]"); if (!t) return;
  const g = t.parentElement; const open = !g.classList.contains("open"); g.classList.toggle("open", open); t.setAttribute("aria-expanded", open); pref.set("nav-" + t.dataset.toggle, open);
});

// ---------------------------------------------------------------- router
const main = document.getElementById("main");
let renderSeq = 0;
async function route() {
  const seq = ++renderSeq;
  let h = location.hash.replace(/^#\/?/, "") || "overview";
  const [path, qs] = h.split("?");
  const query = Object.fromEntries(new URLSearchParams(qs || ""));
  closeDrawer(true);
  drawNav(h);
  closeSide();
  const hit = ROUTES.find(([re]) => re.test(path));
  if (!hit) { setCrumbs(["Not found"]); main.innerHTML = html`<div class="empty"><b>There is no page at “${path}”.</b><a href="#/overview">Go to the company overview</a></div>`; return; }
  const [re, file, fn, crumbs] = hit;
  const params = path.match(re).slice(1);
  const g = groupOf(crumbs[0]);
  document.documentElement.dataset.area = crumbs[0] || "commerce"; // the area's accent colour (see app.css)
  if (crumbs.length) setCrumbs(crumbs.map((c, i) => (i === 0 ? [g.href || g.items[0][0], g.label] : c)));
  main.innerHTML = String(skeleton(2));
  try {
    const m = await mod(file);
    if (seq !== renderSeq) return;
    const view = fn || params[0];
    if (file === "v-systems") setCrumbs([[g.items[0][0], g.label], g.items.find(([hh]) => hh === "#/" + path)?.[1] || view]);
    await m[view](main, params, query, (sub) => sub);
    if (seq !== renderSeq) return;
    if (query.open) openRecord(query.open);
    if (location.hash.includes("#story-")) document.getElementById(location.hash.split("#").at(-1))?.scrollIntoView({ block: "start" });
  } catch (e) {
    console.error(e);
    if (seq === renderSeq) main.innerHTML = html`<div class="err"><b>This page could not be shown.</b><br>${e.message}</div>`;
  }
  if (!query.open) main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
setDrawerRenderer(async (id, el) => { const m = await mod("v-records"); await m.inDrawer(id, el); });

// ---------------------------------------------------------------- small-screen menu
const side = document.getElementById("side"), scrim = document.getElementById("scrim"), menuBtn = document.getElementById("menuBtn");
function closeSide() { side.classList.remove("open"); scrim.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); }
menuBtn.onclick = () => { const o = !side.classList.contains("open"); side.classList.toggle("open", o); scrim.hidden = !o; menuBtn.setAttribute("aria-expanded", o); };
scrim.onclick = closeSide;

// ---------------------------------------------------------------- View as, spoilers, theme
const viewAs = document.getElementById("viewAs");
function drawRoleBar() {
  const bar = document.getElementById("roleBar");
  document.getElementById("viewAsWrap").classList.toggle("scoped", S.role !== "manager");
  if (S.role === "manager") { bar.hidden = true; return; }
  const one = scopedCustomer();
  bar.hidden = false;
  customers().then((cm) => {
    const c = one && cm.get(one);
    bar.innerHTML = html`${icon(isAI(S.role) ? "spark" : "eye")}<span>Viewing as <b>${roleName(S.role)}</b>. ${S.meta.role_about[S.role] || ""} ${c ? html`Showing one customer only, as if ${S.role === "assistant" ? "verified" : "signed in"}: <a href="#/r/${one}">${c.name}</a>.` : ""} Locked pages follow the engine's permission rules.</span><button class="btn sm" id="backToManager">View as Manager</button>`;
    bar.querySelector("#backToManager").onclick = () => setRole("manager");
  });
}
function setRole(r) { S.role = r; viewAs.value = r; pref.set("role", r); drawRoleBar(); route(); }
viewAs.onchange = () => setRole(viewAs.value);
const spoil = document.getElementById("spoilers");
spoil.onclick = () => { S.spoilers = !S.spoilers; spoil.setAttribute("aria-pressed", S.spoilers); spoil.title = S.spoilers ? "Hide spoilers" : "Show spoilers: mark the planted problems"; route(); };
const themeBtn = document.getElementById("theme");
const drawTheme = () => { const d = document.documentElement.dataset.theme === "dark"; themeBtn.innerHTML = String(icon(d ? "sun" : "moon")); themeBtn.setAttribute("aria-label", d ? "Switch to light" : "Switch to dark"); };
themeBtn.onclick = () => { const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = t; try { localStorage.setItem("bo-theme", t); } catch {} drawTheme(); route(); };

// ---------------------------------------------------------------- copy buttons, record links inside the drawer
document.addEventListener("click", async (e) => {
  const c = e.target.closest("[data-copy]");
  if (c) { e.preventDefault(); try { await navigator.clipboard.writeText(c.dataset.copy); } catch { /* clipboard blocked */ } const old = c.innerHTML; c.innerHTML = String(html`${icon("check")} Copied`); setTimeout(() => { c.innerHTML = old; }, 1200); return; }
  const r = e.target.closest("a[data-rec]");
  if (r && r.closest("#drawer") && !e.metaKey && !e.ctrlKey && !/^OT-/.test(r.dataset.rec)) { e.preventDefault(); openRecord(r.dataset.rec); }
});

// ---------------------------------------------------------------- the command palette (Cmd/Ctrl-K)
let pal = null;
const pages = () => NAV.flatMap((g) => (g.items ? g.items.map(([h, l]) => ({ h, l, sub: g.label })) : [{ h: g.href, l: g.label, sub: "Page" }]));
async function openPalette() {
  if (pal) return;
  const prev = document.activeElement;
  pal = document.createElement("div"); pal.className = "palette-scrim";
  pal.innerHTML = html`<div class="palette" role="dialog" aria-modal="true" aria-label="Search the back office"><div class="pin">${icon("search")}<input type="text" placeholder="Search orders, customers, products, suppliers, cases, pages…" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="palList" autocomplete="off" spellcheck="false"></div><ul id="palList" role="listbox"></ul><div class="pfoot"><span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span></div></div>`;
  document.body.append(pal);
  const input = pal.querySelector("input"), list = pal.querySelector("ul");
  let items = [], sel = 0, idx = null;
  const close = () => { pal.remove(); pal = null; prev?.focus?.(); };
  pal.addEventListener("click", (e) => { if (e.target === pal) close(); });
  load("search.json").then((d) => { idx = d; draw(); });
  const cmap = await customers();
  function draw() {
    const q = input.value.trim().toLowerCase();
    const groups = [];
    const add = (name, arr) => { if (arr.length) groups.push([name, arr.slice(0, q ? 7 : 5)]); };
    const m = (...s) => !q || s.some((x) => String(x ?? "").toLowerCase().includes(q));
    const canCust = access("customers") !== "none";
    add("Pages", pages().filter((p) => m(p.l, p.sub)).map((p) => ({ h: p.h, l: p.l, sub: p.sub, ic: "arrow" })));
    if (q) {
      add("Products", S.meta.products.filter((p) => m(p.name, p.id, p.category, ...p.skus)).map((p) => ({ h: `#/products/${p.id}`, l: p.name, sub: p.category, ic: "box" })));
      add("Suppliers", Object.entries(S.meta.suppliers).filter(([id, n]) => m(id, n)).map(([id, n]) => ({ h: `#/r/${id}`, l: n, sub: id, ic: "factory" })));
      if (idx) {
        const one = scopedCustomer(), mine = (cn) => !one || "C-" + cn === one;
        if (canCust) add("Customers", idx.customers.filter((c) => mine(c[0]) && m("c-" + c[0], c[1], c[2], c[3], c[4])).map((c) => ({ h: `#/r/C-${c[0]}`, l: c[1], sub: `C-${c[0]} · ${c[2]}`, ic: "users" })));
        if (access("orders") !== "none") add("Orders", idx.orders.filter((o) => mine(o[1]) && m(o[0], cmap.get("C-" + o[1])?.name)).sort((a, b) => b[2].localeCompare(a[2])).map((o) => ({ h: `#/r/${o[0]}`, l: o[0], sub: `${canCust ? cmap.get("C-" + o[1])?.name + " · " : ""}£${o[3].toFixed(2)} · ${o[2]}`, ic: "cart" })));
        if (access("cases") !== "none") add("Cases", idx.cases.filter((c) => mine(c[2]) && m(c[0], c[1])).map((c) => ({ h: `#/r/${c[0]}`, l: `${c[0]} ${c[1]}`, sub: "Case", ic: "headset" })));
        if (access("cases") !== "none") add("Conversations", idx.conversations.filter((c) => mine(c[2]) && m(c[0], c[1])).map((c) => ({ h: `#/r/${c[0]}`, l: `${c[0]} ${c[1] || ""}`, sub: "Conversation", ic: "chat" })));
        if (access("buying") !== "none") add("Purchase orders", idx.pos.filter((p) => m(p[0], S.meta.suppliers[p[1]])).map((p) => ({ h: `#/r/${p[0]}`, l: p[0], sub: `${S.meta.suppliers[p[1]]} · ${p[2]}`, ic: "factory" })));
        if (access("orders") !== "none") add("Returns and repairs", [...idx.returns.filter((r) => mine(r[2]) && m(r[0], r[1])).map((r) => ({ h: `#/r/${r[0]}`, l: r[0], sub: `Return on ${r[1]}`, ic: "ret" })), ...idx.repairs.filter((r) => mine(r[2]) && m(r[0], S.meta.sku[r[1]]?.name)).map((r) => ({ h: `#/r/${r[0]}`, l: r[0], sub: `Repair · ${S.meta.sku[r[1]]?.name}`, ic: "wrench" }))]);
        if (access("documents") !== "none") add("Documents", idx.documents.filter((d) => m(d[0], d[1])).map((d) => ({ h: `#/r/${d[0]}`, l: d[1], sub: d[0], ic: "doc" })));
        if (/^[a-z]+-[\w-]+$/i.test(q) && href(q.toUpperCase()) && !groups.some(([, a]) => a.some((x) => x.l.toLowerCase() === q))) groups.unshift(["Go to", [{ h: href(q.toUpperCase()), l: q.toUpperCase(), sub: "Open this record", ic: "arrow" }]]);
      }
    }
    items = groups.flatMap(([, a]) => a); sel = Math.min(sel, Math.max(0, items.length - 1));
    let k = 0;
    list.innerHTML = items.length ? html`${groups.map(([name, arr]) => html`<li class="grp" role="presentation">${name}</li>${arr.map((it) => { const i = k++; return html`<li role="presentation"><a role="option" id="pal-${i}" href="${it.h}" aria-selected="${i === sel}" data-i="${i}">${icon(it.ic)}<span>${it.l}</span><span class="muted">${it.sub}</span></a></li>`; })}`)}` : html`<li class="none">Nothing found for “${input.value}”. Try an order number like ORD-…, a name, a postcode or a page.</li>`;
    input.setAttribute("aria-activedescendant", items.length ? `pal-${sel}` : "");
    if (!idx && q) list.insertAdjacentHTML("beforeend", '<li class="none">Loading records…</li>');
  }
  input.addEventListener("input", () => { sel = 0; draw(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length); list.querySelectorAll("[aria-selected]").forEach((a) => a.setAttribute("aria-selected", +a.dataset.i === sel)); input.setAttribute("aria-activedescendant", `pal-${sel}`); list.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Enter" && items[sel]) { e.preventDefault(); location.hash = items[sel].h; close(); }
    else if (e.key === "Escape") close();
  });
  list.addEventListener("click", (e) => { if (e.target.closest("a")) close(); });
  draw(); input.focus();
}
document.getElementById("openPalette").onclick = openPalette;
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !pal) { e.preventDefault(); openPalette(); return; }
  if (e.key === "Escape" && document.getElementById("drawer") && !pal) closeDrawer();
});

// ---------------------------------------------------------------- start
(async () => {
  try {
    S.meta = await load("meta.json");
  } catch (e) { main.innerHTML = html`<div class="err"><b>The back office data is missing.</b> Run <code>node business/backoffice/build.mjs --size standard</code> and serve <code>business/backoffice/dist</code>.</div>`; return; }
  document.getElementById("kbdHint").textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
  document.getElementById("sideFoot").textContent = `${longNow(S.meta.now)} in the simulation. ${S.meta.size} world.`;
  viewAs.innerHTML = html`${S.meta.roles.map((r) => html`<option value="${r}">${roleName(r)}</option>`)}`;
  const saved = pref.get("role", "manager"); S.role = S.meta.roles.includes(saved) ? saved : "manager"; viewAs.value = S.role;
  drawTheme(); drawRoleBar();
  window.addEventListener("hashchange", route);
  route();
})();
