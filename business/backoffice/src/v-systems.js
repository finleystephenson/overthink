// Company systems and data: the developer's view. Roles and permissions, rules, knowledge, the data dictionary,
// every engine tool with a real example, how to connect, the situations, the planted problems, and what gets recorded.
import { S, load, html, raw, esc, num, date, dateTime, words, cap, icon, chip, idLink, tonePill, pill, roleName, isAI, markdown, codeBlock, prettyJson, panel, pageHead, strip, stat, href, access, pref } from "./core.js";

const HOST = "http://127.0.0.1:8787";
const sideIndex = (items, on, base) => html`<nav class="side-index" aria-label="Index">${items.map(([k, l, c]) => html`<a href="${base}${k}" class="${k === on ? "on" : ""}" ${k === on ? raw('aria-current="true"') : ""}><span>${l}</span>${c != null ? html`<span class="c">${c}</span>` : ""}</a>`)}</nav>`;
const sh = (s) => codeBlock(s);

// ---------------------------------------------------------------- company structure, roles and the permission matrix
export async function roles(main) {
  const r = await load("rules.json");
  const roleList = r.all_roles;
  const about = (k) => (typeof r.roles[k] === "string" ? r.roles[k] : r.roles[k]?.description || "");
  const can = (k) => r.company_roles?.[k]?.can || r.roles[k]?.can || [];
  const groupOf = (t) => (t.roles.length === roleList.length ? "Open to everyone" : t.roles.includes("customer") || t.roles.includes("assistant") ? "Customer records" : t.roles.includes("operations_assistant") || ["finance", "marketing", "buyer"].some((x) => t.roles.includes(x)) ? "Back office" : "Staff only");
  const groups = ["Open to everyone", "Customer records", "Staff only", "Back office"].map((g) => [g, r.tools.filter((t) => groupOf(t) === g)]).filter(([, l]) => l.length);
  main.innerHTML = html`${pageHead("Company structure and roles", html`The company has no named staff, only roles. Every action in the business engine checks the caller's role against the table below; anyone else gets <code>forbidden</code>. Read from <code>business/data/business.json</code> and the engine's own tool list.`)}
    ${strip([stat("Roles", num(roleList.length), `${roleList.filter(isAI).length} of them AI`), stat("Engine tools", num(r.tools.length)), stat("Open to every role", num(r.tools.filter((t) => t.roles.length === roleList.length).length), "Catalogue, stock, policies"), stat("Allowed calls", num(r.tools.reduce((n, t) => n + t.roles.length, 0)), "Ticks in the table")])}
    <div class="section panel" style="margin-top:16px"><div class="panel-h"><h2>Who does what</h2></div><div class="panel-b flush"><div class="tbl-wrap"><table class="cards"><thead><tr><th scope="col">Role</th><th scope="col">Who</th><th scope="col">May</th><th class="num" scope="col">Tools</th></tr></thead><tbody>${roleList.map((k) => html`<tr><td class="nowrap"><b style="font-weight:600">${roleName(k)}</b> ${isAI(k) ? tonePill("AI", "ai") : ""}<span class="sub mono">${k}</span></td><td style="min-width:200px">${about(k)}</td><td>${can(k).length ? html`<ul style="margin:0;padding-left:16px;font-size:12.5px;color:var(--ink-2)">${can(k).map((x) => html`<li>${x}</li>`)}</ul>` : html`<span class="muted small">Their own records, through the website</span>`}</td><td class="num">${r.tools.filter((t) => t.roles.includes(k)).length}</td></tr>`)}</tbody></table></div></div></div>
    <div class="section panel"><div class="panel-h"><h2>Permission matrix</h2><span class="muted">Role × engine tool. A tick means the engine lets that role call it.</span><span class="act"><label class="search"><span class="sr">Find a tool</span>${icon("search")}<input class="input" id="mq" type="search" placeholder="Find a tool" style="width:200px"></label></span></div>
      <div class="panel-b flush"><div class="matrix-wrap"><table class="matrix" id="matrix"><thead><tr><th scope="col" style="vertical-align:bottom;padding-bottom:8px">Tool</th>${roleList.map((k, i) => html`<th scope="col" class="rot ${k === S.role ? "hl" : ""}" data-col="${i}"><span>${roleName(k)}</span></th>`)}</tr></thead><tbody>
      ${groups.map(([g, list]) => html`<tr class="grp"><td colspan="${roleList.length + 1}">${g} <span class="muted" style="font-weight:400">· ${list.length}</span></td></tr>${list.map((t) => html`<tr data-tool="${t.name}"><td class="tool"><a href="#/systems/tools?t=${t.name}" title="${t.description}">${t.name}</a></td>${roleList.map((k, i) => html`<td data-col="${i}" class="${k === S.role ? "hl" : ""}">${t.roles.includes(k) ? html`<span class="yes ${isAI(k) ? "ai" : ""}" title="${roleName(k)} may call ${t.name}">${icon("check")}</span>` : html`<span class="sr">No</span>`}</td>`)}</tr>`)}`)}
      </tbody></table></div></div></div>`;
  const m = main.querySelector("#matrix");
  m.addEventListener("pointerover", (e) => { const c = e.target.closest("[data-col]")?.dataset.col; m.querySelectorAll(".hov").forEach((x) => x.classList.remove("hov", "hl")); if (c != null) m.querySelectorAll(`[data-col="${c}"]`).forEach((x) => x.classList.add("hov", "hl")); });
  m.addEventListener("pointerleave", () => { m.querySelectorAll(".hov").forEach((x) => x.classList.remove("hov", "hl")); const i = roleList.indexOf(S.role); m.querySelectorAll(`[data-col="${i}"]`).forEach((x) => x.classList.add("hl")); });
  main.querySelector("#mq").oninput = (e) => { const q = e.target.value.toLowerCase(); m.querySelectorAll("tr[data-tool]").forEach((tr) => (tr.hidden = q && !tr.dataset.tool.includes(q))); };
}

// ---------------------------------------------------------------- rules and policies
const human = (k) => cap(words(k).replace(/\bpct\b/, "percent").replace(/\bmax\b/, "most").replace(/\bmin\b/, "least"));
function flat(obj, pre = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (k.startsWith("_")) continue;
    const p = pre ? `${pre}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...flat(v, p));
    else out.push([p, k, v]);
  }
  return out;
}
const showVal = (v) => (Array.isArray(v) ? (v.every((x) => typeof x !== "object") ? v.join(", ") : html`<ul style="margin:0;padding-left:16px">${v.map((o) => html`<li>${Object.entries(o).filter(([, x]) => x != null && typeof x !== "object").map(([k, x], i) => html`${i ? " · " : ""}<span class="muted">${human(k)}:</span> ${String(x)}`)}</li>`)}</ul>`) : typeof v === "boolean" ? (v ? "Yes" : "No") : v);
export async function rules(main) {
  const [r, k] = await Promise.all([load("rules.json"), load("knowledge.json")]);
  const secs = Object.entries(r.rules).filter(([, v]) => v);
  main.innerHTML = html`${pageHead("Rules and policies", html`The business rules exactly as the engine reads them, with the field each comes from in <code>business/data/business.json</code>. Change a number there and the engine, the website and this page all follow.`)}
    <div class="cols aside-main"><div>${sideIndex([...secs.map(([s]) => [s, human(s)]), ["policies", "Customer policies", k.policies.length]], null, "#/systems/rules#")}</div>
    <div class="stack">${secs.map(([s, v]) => html`<section class="panel" id="${s}"><div class="panel-h"><h2>${human(s)}</h2><span class="muted mono small">business.json → ${s}</span></div><div class="panel-b flush"><div class="tbl-wrap"><table class="cards"><tbody>${(typeof v === "object" && !Array.isArray(v) ? flat(v, s) : [[s, s, v]]).map(([p, key, val]) => html`<tr><td style="width:34%"><b style="font-weight:550">${human(key)}</b><span class="sub mono">${p}</span></td><td>${showVal(val)}</td></tr>`)}</tbody></table></div></div></section>`)}
      <section class="panel" id="policies"><div class="panel-h"><h2>Customer policies</h2><span class="muted mono small">data/policies/*.md</span></div><div class="panel-b flush"><ul class="list">${k.policies.map((p) => html`<li style="display:block"><details><summary style="cursor:pointer"><b style="font-weight:600">${p.title}</b> <span class="muted small mono">${p.id}</span>${p.summary ? html`<div class="muted small" style="margin:2px 0 0 14px">${p.summary}</div>` : ""}</summary><div class="md" style="padding:10px 0 6px 14px">${markdown(p.body)}</div></details></li>`)}</ul></div></section>
    </div></div>`;
  main.querySelectorAll(".side-index a").forEach((a) => (a.onclick = (e) => { e.preventDefault(); main.querySelector("#" + a.getAttribute("href").split("#").at(-1))?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }));
}

// ---------------------------------------------------------------- company knowledge: documents, procedures, policies
export async function knowledge(main, _, q) {
  const [docs, k] = await Promise.all([load("documents.json"), load("knowledge.json")]);
  const staff = access("documents") !== "none";
  const all = [...(staff ? docs.map((d) => ({ id: d.id, title: d.title, kind: cap(words(d.kind)), group: "Staff documents", status: d.status, body: d.body, date: d.written_at, rec: true })) : []), ...k.procedures.map((p) => ({ id: p.id, title: p.title, kind: "Procedure", group: "Procedures", body: p.body, summary: p.summary })), ...k.policies.map((p) => ({ id: p.id, title: p.title, kind: "Customer policy", group: "Customer policies", body: p.body, summary: p.summary }))];
  main.innerHTML = html`${pageHead("Company knowledge", html`What staff and the AI roles read: internal documents (some deliberately out of date or wrong), step-by-step procedures, and the policies customers see. Searchable in full.${staff ? "" : html` <span class="pill ai">${roleName(S.role)} can't read the staff documents</span>`}`)}
    <div class="panel" style="overflow:hidden"><div class="toolbar"><label class="search"><span class="sr">Search all documents</span>${icon("search")}<input class="input" id="kq" type="search" placeholder="Search every document" value="${q.q || ""}" style="width:320px"></label><span class="spacer"></span><span class="tbl-count" id="kc"></span></div>
    <div class="inbox kn"><div class="inbox-list" id="kl"></div><div class="inbox-read" id="kr"></div></div></div>`;
  const list = main.querySelector("#kl"), read = main.querySelector("#kr"), input = main.querySelector("#kq");
  let sel = q.doc || all[0]?.id;
  const draw = () => {
    const s = input.value.trim().toLowerCase();
    const hits = all.filter((d) => !s || (d.title + " " + d.body).toLowerCase().includes(s));
    main.querySelector("#kc").textContent = `${hits.length} of ${all.length}`;
    if (!hits.some((d) => d.id === sel)) sel = hits[0]?.id;
    let g = null;
    list.innerHTML = hits.length ? html`${hits.map((d) => { const hd = d.group !== g ? ((g = d.group), html`<div class="muted small" style="padding:12px 14px 4px;font-weight:600">${g}</div>`) : ""; const n = s ? (d.body.toLowerCase().match(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length : 0; return html`${hd}<a class="inbox-item" href="#/systems/knowledge?doc=${d.id}" data-doc="${d.id}" aria-current="${d.id === sel}" style="grid-template-columns:minmax(0,1fr) auto"><b>${d.title}</b>${d.status ? pill(d.status) : html`<span></span>`}<small style="grid-column:1/3">${d.kind}${d.date ? ` · ${date(d.date)}` : ""}${n ? ` · ${n} matches` : ""}</small></a>`; })}` : html`<div class="empty"><b>No document mentions that.</b></div>`;
    const d = all.find((x) => x.id === sel);
    // the document is the hero: one reading column, a clear warning when it is out of date
    read.innerHTML = d ? html`<article class="doc">${d.status === "out_of_date" ? html`<div class="stale">${icon("alert")}<div><b>Out of date</b>This document no longer matches how the shop works, but staff and the operations assistant can still find it.</div></div>` : ""}<h1 class="doc-title">${d.title}</h1><p class="doc-meta"><span class="mono">${d.id}</span> · ${d.kind}${d.date ? ` · written ${date(d.date)}` : ""}${d.status && d.status !== "out_of_date" ? html` · ${pill(d.status)}` : ""}${d.rec ? html` · <a href="#/r/${d.id}">Record page</a>` : ""}</p><div class="md">${markdown(d.body, s)}</div></article>` : "";
  };
  list.addEventListener("click", (e) => { const a = e.target.closest("[data-doc]"); if (!a) return; e.preventDefault(); sel = a.dataset.doc; history.replaceState(null, "", `#/systems/knowledge?doc=${sel}`); draw(); read.scrollTop = 0; });
  let t; input.oninput = () => { clearTimeout(t); t = setTimeout(draw, 100); };
  draw();
}

// ---------------------------------------------------------------- the data dictionary
const LAYOUT = [["campaigns", "customers", "orders", "products", "suppliers"], ["web_sessions_daily", "contacts", "returns", "stock", "purchase_orders"], ["monthly_summary", "conversations", "registrations", "stock_movements", "documents"], ["ledger", "cases", "repairs", "stock_counts", "price_history"], ["company", "reviews", "bookings"]];
export async function data(main, _, q) {
  const d = await load("dictionary.json");
  const byName = Object.fromEntries(d.collections.map((c) => [c.name, c]));
  const sel = byName[q.c] ? q.c : "orders" in byName ? "orders" : d.collections[0].name;
  const c = byName[sel];
  // relationship diagram
  const pos = {}; LAYOUT.forEach((row, y) => row.forEach((n, x) => byName[n] && (pos[n] = [x, y])));
  let extraX = 0; for (const n of Object.keys(byName)) if (!pos[n]) pos[n] = [3 + (extraX++ % 2), 4];
  const NW = 154, NH = 46, GX = 200, GY = 84, W = 5 * GX, H = (Math.max(...Object.values(pos).map((p) => p[1])) + 1) * GY;
  const cx = (n) => pos[n][0] * GX + GX / 2, cy = (n) => pos[n][1] * GY + GY / 2;
  const related = new Set([sel, ...d.edges.filter((e) => e.from === sel || e.to === sel).flatMap((e) => [e.from, e.to])]);
  const edgePath = (e) => { const x1 = cx(e.from), y1 = cy(e.from), x2 = cx(e.to), y2 = cy(e.to); const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - (x1 === x2 ? 0 : 14) + (y1 === y2 ? -22 : 0); return `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`; };
  const svg = `<svg class="erd" viewBox="0 0 ${W} ${H}" role="img" aria-label="How the record types link to each other">${d.edges.filter((e) => pos[e.from] && pos[e.to]).map((e) => `<path class="e ${e.from === sel || e.to === sel ? "on" : "dim"}" d="${edgePath(e)}"><title>${esc(e.from)}.${esc(e.via)} → ${esc(e.to)}</title></path>`).join("")}${Object.keys(pos).map((n) => `<g class="n ${n === sel ? "on" : related.has(n) ? "" : "dim"}" data-c="${n}" tabindex="0" role="link" aria-label="${n}, ${byName[n].count} records"><rect x="${cx(n) - NW / 2}" y="${cy(n) - NH / 2}" width="${NW}" height="${NH}" rx="10"/><text x="${cx(n)}" y="${cy(n) - 3}" text-anchor="middle">${esc(n.replace(/_/g, " "))}</text><text class="c" x="${cx(n)}" y="${cy(n) + 13}" text-anchor="middle">${num(byName[n].count)} ${byName[n].shape === "list" || byName[n].shape.startsWith("map") || byName[n].shape.startsWith("one file") ? "records" : ""}</text></g>`).join("")}</svg>`;
  const links = d.edges.filter((e) => e.from === sel), back = d.edges.filter((e) => e.to === sel);
  const recHref = (s) => (c.id_field && s[c.id_field] && href(String(s[c.id_field])) ? href(String(s[c.id_field])) : null);
  main.innerHTML = html`${pageHead("Data dictionary", html`Every record type in the <b>${d.size}</b> world: what it is, its fields (worked out from the data itself), how it links to the others, and real samples. Meanings come from <code>docs/data-model.md</code>.`)}
    <div class="panel"><div class="panel-h"><h2>How the records link</h2><span class="muted">Select a record type. Lines show a field that holds another record's id.</span></div><div class="panel-b" style="overflow-x:auto"><div style="min-width:760px">${raw(svg)}</div></div></div>
    <div class="cols aside-main section">
      <div>${sideIndex(d.collections.map((x) => [x.name, x.name.replace(/_/g, " "), num(x.count)]), sel, "#/systems/data?c=")}</div>
      <div class="stack">
        <div class="rec-head" style="margin:0"><div><h1>${sel.replace(/_/g, " ")} ${tonePill(`${num(c.count)} ${c.shape === "one object" ? "object" : "records"}`, "info")}</h1><p class="sub mono">${c.file}${c.id_field ? ` · id: ${c.id_field}` : ""} · ${c.shape}</p></div></div>
        ${c.about ? html`<p class="lede">${c.about}</p>` : ""}
        ${links.length || back.length ? html`<div class="row small">${links.map((e) => html`<a class="chip name" href="#/systems/data?c=${e.to}" title="${sel}.${e.via}">${e.via} → ${e.to.replace(/_/g, " ")}</a>`)}${back.map((e) => html`<a class="chip name" href="#/systems/data?c=${e.from}" title="${e.from}.${e.via}">← ${e.from.replace(/_/g, " ")}.${e.via}</a>`)}</div>` : ""}
        ${panel("Fields", html`<div class="tbl-wrap" style="margin:-4px -16px -16px"><table class="cards"><thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Meaning</th><th scope="col">Example</th></tr></thead><tbody>${c.fields.map((f) => html`<tr><td><span class="mono" style="font-size:12px;${f.path.includes(".") || f.path.includes("[") ? "color:var(--ink-2)" : "font-weight:600"}">${f.path}</span>${f.optional ? html` <span class="muted tiny">optional</span>` : ""}</td><td class="nowrap small">${f.type}${f.links.length ? html`<span class="sub">→ ${f.links.map((l) => html`<a href="#/systems/data?c=${l}">${l.replace(/_/g, " ")}</a> `)}</span>` : ""}</td><td class="small" style="min-width:180px">${f.meaning || html`<span class="muted">–</span>`}</td><td class="mono small" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.example === undefined ? "" : typeof f.example === "string" && href(f.example) ? html`<a href="${href(f.example)}">${f.example}</a>` : JSON.stringify(f.example)}</td></tr>`)}</tbody></table></div>`, { sub: `${c.fields.length} fields, nested ones included` })}
        <section class="panel"><div class="panel-h"><h2>Sample records</h2><span class="act">${c.samples.length > 1 ? html`<span class="seg" role="group" aria-label="Sample">${c.samples.map((_, i) => html`<button aria-pressed="${i === 0}" data-s="${i}">${["First", "Middle", "Last"][i] || i + 1}</button>`)}</span>` : ""}<a class="btn sm" id="sOpen" href="#" hidden>${icon("ext")} Open its page</a></span></div><div class="panel-b" id="sBox"></div></section>
      </div>
    </div>
    ${d.id_formats.length ? html`<div class="section">${panel("Id formats", html`<div class="tbl-wrap" style="margin:-4px -16px -16px"><table><thead><tr><th scope="col">Record</th><th scope="col">Example</th><th scope="col">Notes</th></tr></thead><tbody>${d.id_formats.map((f) => html`<tr><td>${f.record}</td><td class="mono small">${f.example}</td><td class="small">${f.note}</td></tr>`)}</tbody></table></div>`, { sub: "From docs/data-model.md" })}</div>` : ""}`;
  const box = main.querySelector("#sBox"), open = main.querySelector("#sOpen");
  const show = (i) => { const s = c.samples[i]; box.innerHTML = String(codeBlock("", { json: s, label: "sample record" })); const h = s && recHref(s); open.hidden = !h; if (h) open.href = h; main.querySelectorAll("[data-s]").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.s === i)); };
  main.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => show(+b.dataset.s)));
  show(0);
  main.querySelectorAll(".erd .n").forEach((g) => { const go = () => (location.hash = `#/systems/data?c=${g.dataset.c}`); g.addEventListener("click", go); g.addEventListener("keydown", (e) => e.key === "Enter" && go()); });
}

// ---------------------------------------------------------------- tools reference, with real calls
export async function tools(main, _, q) {
  const list = await load("tools.json");
  const roleF = q.role || "";
  const shown = list.filter((t) => !roleF || t.roles.includes(roleF));
  const sel = list.find((t) => t.name === q.t) || shown[0];
  const props = Object.entries(sel.input_schema?.properties || {}), req = new Set(sel.input_schema?.required || []);
  const ex = sel.example;
  const curl = ex ? `# as ${ex.role}${ex.verified ? `, after verify_customer ${JSON.stringify(ex.verified)}` : ""}\ncurl -s -X POST ${HOST}/tools/${sel.name} \\\n  -H "Authorization: Bearer $${ex.role === "customer" ? "OWNER" : "AI"}"${ex.role === "customer" ? ` -H "X-Role: customer" -H "X-Customer-Id: ${ex.customer_id}"` : ""} \\\n  -d '${JSON.stringify(ex.input)}'` : "";
  const mcp = ex ? JSON.stringify({ method: "tools/call", params: { name: sel.name, arguments: ex.input } }, null, 2) : "";
  main.innerHTML = html`${pageHead("Tools reference", html`Every tool in the business engine. The same tools answer the web API (<code>POST /tools/&lt;name&gt;</code>) and MCP. Each example below was really called against the ${S.meta.size} world when this page was built, as a role that is allowed to.`, html`<label class="row"><span class="muted small">Only tools for</span><select class="input" id="roleF"><option value="">Any role</option>${S.meta.roles.map((r) => html`<option value="${r}" ${r === roleF ? raw("selected") : ""}>${roleName(r)}</option>`)}</select></label>`)}
    <div class="cols aside-main"><div>${sideIndex(shown.map((t) => [t.name + (roleF ? `&role=${roleF}` : ""), t.name, t.example ? null : "–"]), sel.name + (roleF ? `&role=${roleF}` : ""), "#/systems/tools?t=")}</div>
    <div class="stack">
      <div class="rec-head" style="margin:0"><div><h1 class="mono" style="font-family:var(--mono);font-size:20px">${sel.name}</h1><p class="lede" style="margin-top:6px">${sel.description}</p></div></div>
      ${panel("Who may call it", html`<div class="row">${S.meta.roles.map((r) => (sel.roles.includes(r) ? tonePill(roleName(r), isAI(r) ? "ai" : "good") : html`<span class="pill" style="opacity:.55" title="Gets forbidden">${roleName(r)}</span>`))}</div>${sel.refusal?.error ? html`<p class="small muted" style="margin-top:10px">Anyone else is refused. Called as <b>${roleName(sel.refusal.role)}</b>, the engine answered <code>${sel.refusal.error.code}</code>: “${sel.refusal.error.message}”</p>` : ""}`)}
      ${panel("Input", props.length ? html`<div class="tbl-wrap" style="margin:-4px -16px -16px"><table class="cards"><thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Needed</th><th scope="col">Allowed values</th></tr></thead><tbody>${props.map(([k, v]) => html`<tr><td class="mono small" style="font-weight:600">${k}</td><td class="small">${v.type || "any"}${v.items?.type ? ` of ${v.items.type}` : ""}</td><td>${req.has(k) ? tonePill("Required", "warn") : html`<span class="muted small">Optional</span>`}</td><td class="small">${v.enum ? v.enum.join(", ") : v.minimum != null || v.maximum != null ? `${v.minimum ?? ""} to ${v.maximum ?? ""}` : v.description || ""}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">Takes no input.</p>`, { act: html`<details><summary class="small" style="cursor:pointer">JSON Schema</summary></details>` })}
      <div id="schemaBox" hidden>${codeBlock("", { json: sel.input_schema })}</div>
      ${ex ? html`<section class="panel"><div class="panel-h"><h2>A real call</h2>${tonePill(ex.ok ? "ok: true" : `ok: false · ${ex.result?.code}`, ex.ok ? "good" : "serious")}<span class="muted">as ${roleName(ex.role)}${ex.verified ? ", after verifying the customer" : ""}${ex.setup ? ", after a setup call that makes what it needs (see build.mjs)" : ""}</span></div><div class="panel-b stack">
        <div class="cols c2"><div><div class="muted small" style="margin-bottom:6px">Web API</div>${sh(curl)}</div><div><div class="muted small" style="margin-bottom:6px">MCP (tools/call)</div>${sh(mcp)}</div></div>
        <div><div class="muted small" style="margin-bottom:6px">What the engine answered${JSON.stringify(ex.result).includes("more") ? " (long lists cut to three)" : ""}</div>${codeBlock("", { json: ex.ok ? { ok: true, data: ex.result } : { ok: false, error: ex.result } })}</div>
        ${ex.changes?.length ? html`<div><div class="muted small" style="margin-bottom:6px">What it changed (the engine's audit entry)</div>${codeBlock("", { json: ex.changes })}</div>` : ""}
        ${!ex.ok ? html`<p class="small muted">A refusal is a normal answer: the request worked and the business said no. It comes back with HTTP 200.</p>` : ""}
      </div></section>` : html`<div class="note">${icon("clock")}<span>No example for this tool: it is part of services and bookings, which are switched off for now.</span></div>`}
    </div></div>`;
  main.querySelector("#roleF").onchange = (e) => (location.hash = `#/systems/tools?t=${sel.name}${e.target.value ? `&role=${e.target.value}` : ""}`);
  const det = main.querySelector("details"); det.ontoggle = () => (main.querySelector("#schemaBox").hidden = !det.open);
}

// ---------------------------------------------------------------- connect
export async function connect(main) {
  const c = await load("connect.json");
  const o = c.openapi;
  const sizes = c.sizes.join('" or "');
  main.innerHTML = html`${pageHead("Connect your AI", html`Get a private copy of the business (a sandbox), connect through the web API or MCP, and see exactly what your AI did. Nothing here calls an AI model: you bring the AI. Full guide in <code>docs/connect.md</code>.`)}
    <div class="cols c21"><div class="stack">
      ${[
        ["Start the server", "Needs Node 24 and this repository.", `pnpm install          # once\nnpm run serve         # ${HOST}`],
        ["Create a sandbox", `size is "${sizes}". scenario is one of: ${c.scenarios.join(", ")}. The reply holds the sandbox id and the owner token, shown once.`, `curl -s -X POST ${HOST}/sandboxes \\\n  -H 'Content-Type: application/json' -d '{"size":"demo","scenario":"normal"}'\nS=<data.id>; OWNER=<data.token>`],
        ["Give your AI its own token", "A role token can only ever act as one role. Use assistant for a customer-facing AI and operations_assistant for a back-office one.", `curl -s -X POST ${HOST}/sandboxes/$S/tokens \\\n  -H "Authorization: Bearer $OWNER" -d '{"role":"assistant"}'\nAI=<data.token>`],
        ["Call a tool", "Every answer is { ok, data } or { ok: false, error: { code, message } }.", `curl -s ${HOST}/tools -H "Authorization: Bearer $AI"            # what this role may do\ncurl -s -X POST ${HOST}/tools/search_catalogue \\\n  -H "Authorization: Bearer $AI" -d '{"query":"umbrella"}'`],
        ["Or connect over MCP", "Same tools, same names. Over HTTP with your AI token, or over stdio with a private sandbox and no server.", `claude mcp add --transport http overthought ${HOST}/mcp \\\n  --header "Authorization: Bearer $AI"\n\n# stdio, in your client's MCP settings:\n{ "mcpServers": { "overthought": { "command": "node",\n  "args": ["/full/path/to/server/mcp-stdio.mjs", "--size", "demo", "--role", "assistant"] } } }`],
        ["See what happened", "The trace is every call in order; the diff is every record that changed. Both owner only.", `curl -s ${HOST}/sandboxes/$S/trace -H "Authorization: Bearer $OWNER"\ncurl -s ${HOST}/sandboxes/$S/diff  -H "Authorization: Bearer $OWNER"`],
        ["Start again", "Reset puts the sandbox back byte for byte and clears the trace.", `curl -s -X POST ${HOST}/sandboxes/$S/reset -H "Authorization: Bearer $OWNER"`],
      ].map(([t, p, code], i) => html`<section class="panel"><div class="panel-h"><span class="pill info plain" style="min-width:24px;justify-content:center">${i + 1}</span><h2>${t}</h2></div><div class="panel-b"><p class="small ink2" style="margin-bottom:10px">${p}</p>${sh(code)}</div></section>`)}
    </div>
    <div class="stack">
      ${panel("At a glance", html`<dl class="kv"><dt>Base URL</dt><dd class="mono small">${HOST}</dd><dt>Auth</dt><dd>Bearer token per sandbox</dd><dt>Roles</dt><dd>${c.roles.map((r) => html`<span class="chip" style="margin:0 4px 4px 0">${r}</span>`)}</dd><dt>Situations</dt><dd>${c.scenarios.map((s) => html`<a class="chip" style="margin:0 4px 4px 0" href="#/systems/situations#${s}">${s}</a>`)}</dd><dt>Errors</dt><dd class="small">forbidden, not_verified, not_found, invalid_input, rule_violation, out_of_stock, unavailable, needs_human</dd></dl>`)}
      ${o ? panel("Endpoints", html`<p class="small muted" style="margin-bottom:10px">From <code>/openapi.json</code>, generated by <code>infrastructure/server/openapi.mjs</code> when this page was built. ${o.paths.filter((p) => p.tool).length} more are tools: <a href="#/systems/tools">POST /tools/&lt;name&gt;</a>.</p><ul class="list" style="margin:0 -16px -16px">${o.paths.filter((p) => !p.tool).map((p) => html`<li style="align-items:flex-start"><span class="method ${p.method}">${p.method}</span><span class="t" style="white-space:normal"><b class="mono" style="font-size:12px;white-space:normal">${p.path}</b><small style="white-space:normal">${p.summary}${p.auth ? "" : " · no token needed"}</small></span></li>`)}</ul>`, { sub: o.info.version }) : html`<div class="note warn">The server code could not be imported at build time, so the endpoint list is missing. See docs/connect.md.</div>`}
    </div></div>`;
}

// ---------------------------------------------------------------- situations
export async function situations(main) {
  const list = await load("situations.json");
  main.innerHTML = html`${pageHead("Situations", html`The same business in a different state. A sandbox can start in any of them; reset returns to the situation, not to normal. Each was really applied to the ${S.meta.size} world when this page was built and compared with the normal state, record by record.`)}
    <div class="stack">${list.map((s) => { const tot = Object.values(s.summary).reduce((a, x) => ({ added: a.added + x.added, changed: a.changed + x.changed, removed: a.removed + x.removed }), { added: 0, changed: 0, removed: 0 }); return html`<section class="panel" id="${s.name}"><div class="panel-h"><h2>${s.title}</h2><span class="chip">${s.name}</span>${s.now !== S.meta.now ? tonePill(`Clock moves to ${date(s.now)}`, "ai") : ""}<span class="act small muted">${s.error ? html`<span class="down">Could not be applied at build time: ${s.error}</span>` : html`${num(tot.added)} added · ${num(tot.changed)} changed · ${num(tot.removed)} removed`}</span></div>
      <div class="panel-b"><p class="lede">${s.description}</p>
      ${Object.keys(s.summary).length ? html`<div class="cols c2" style="margin-top:14px"><div class="tbl-wrap"><table><thead><tr><th scope="col">Records</th><th class="num" scope="col">Added</th><th class="num" scope="col">Changed</th><th class="num" scope="col">Removed</th></tr></thead><tbody>${Object.entries(s.summary).sort((a, b) => b[1].added + b[1].changed - (a[1].added + a[1].changed)).map(([k, v]) => html`<tr><td><a href="#/systems/data?c=${k}">${k.replace(/_/g, " ")}</a></td><td class="num">${v.added || ""}</td><td class="num">${v.changed || ""}</td><td class="num">${v.removed || ""}</td></tr>`)}</tbody></table></div>
        <div><div class="muted small" style="margin-bottom:6px">For example</div><ul class="list" style="border-radius:10px;box-shadow:inset 0 0 0 1px var(--line)">${s.examples.map((e) => html`<li><span class="t"><b class="mono" style="font-size:12px">${e.change === "added" ? html`<span class="mono">${e.id}</span>` : href(String(e.id)) ? idLink(String(e.id)) : e.id}</b><small>${e.collection.replace(/_/g, " ")} ${e.change}${e.fields ? `: ${e.fields.join(", ")}` : ""}</small></span>${tonePill(e.change, e.change === "added" ? "good" : e.change === "removed" ? "crit" : "info")}</li>`)}</ul></div></div>` : s.name === "normal" ? html`<p class="small muted" style="margin-top:8px">No changes: this is the starting point.</p>` : ""}
      <div style="margin-top:14px">${sh(`curl -s -X POST ${HOST}/sandboxes -d '{"size":"standard","scenario":"${s.name}"}'`)}</div></div></section>`; })}</div>`;
  if (location.hash.split("#").length > 2) main.querySelector("#" + location.hash.split("#").at(-1))?.scrollIntoView();
}

// ---------------------------------------------------------------- known problems (spoilers)
export async function problems(main) {
  if (!S.spoilers) {
    main.innerHTML = html`${pageHead("Known problems", "")}<div class="lock"><div class="ic" style="background:var(--crit-bg);color:var(--crit)">${icon("eye")}</div><h2>Spoilers are hidden</h2><p>About thirty problems were planted in this business on purpose: a late supplier, a count that does not match, a refund paid twice, a prompt injection in an order note, and more. If you are testing an AI, it should find them itself.</p><p style="margin-top:16px"><button class="btn primary" id="showSp">${icon("eye")} Show spoilers</button></p></div>`;
    main.querySelector("#showSp").onclick = () => document.getElementById("spoilers").click();
    return;
  }
  const { stories, quirks } = await load("stories.json");
  main.innerHTML = html`${pageHead("Known problems", html`The planted stories, from <code>business/data/world/${S.meta.size}/STORIES.md</code>, with links to the exact records. With spoilers on, every record page also says which story it belongs to.`)}
    <div class="panel"><ul class="needs">${stories.map((s) => html`<li class="need warning" id="story-${s.n}"><span class="ic" style="background:var(--crit-bg);color:var(--crit);font-weight:700;font-size:11px">${s.n}</span><div><b>${s.title}</b><p>${s.records}</p></div><span class="who-tag">${s.customer}</span><div class="refs">${s.ids.slice(0, 14).map((id) => chip(id))}${s.ids.length > 14 ? html`<span class="muted small">+${s.ids.length - 14}</span>` : ""}</div></li>`)}</ul></div>
    ${quirks.length ? html`<div class="section">${panel("Deliberate quirks", html`<ul style="margin:0;padding-left:18px">${quirks.map((q) => html`<li style="margin:4px 0">${markdown(q)}</li>`)}</ul>`)}</div>` : ""}`;
}

// ---------------------------------------------------------------- how results are judged
export async function judging(main) {
  const j = await load("judging.json");
  main.innerHTML = html`${pageHead("How results are judged", html`What the environment records about an AI's work today. There is no automatic score yet: scenario packs with known right answers are planned (Phase 4 of <code>docs/project-00-plan.md</code>). What exists is a complete, honest record you can judge from.`)}
    <div class="cols c3">
      ${panel("The trace", html`<p class="small ink2">Every call, in order: wall time, simulated time, which token and role, the tool, the exact input, the full result or error, and the engine's list of changes. Inbox messages and replies too. <code>GET /sandboxes/:id/trace</code>, owner only, with <code>?since=</code> for new entries.</p>`)}
      ${panel("The diff", html`<p class="small ink2">Every record that differs from the sandbox's starting state: added, removed, or changed field by field with before and after. <code>GET /sandboxes/:id/diff</code>. Reset makes it empty again.</p>`)}
      ${panel("Refusals", html`<p class="small ink2">When an AI tries something its role may not do, the engine says <code>forbidden</code> (or <code>not_verified</code>, <code>rule_violation</code> …) and nothing changes. The refusal is in the trace like any other call, so overreach is visible.</p>`)}
    </div>
    ${j ? html`<div class="section">${panel("A real recorded run", html`<p class="small ink2" style="margin-bottom:12px">Made when this page was built, through the server's own sandbox store: an assistant token asks for an order before verifying, verifies, asks again, opens a case, then tries a refund it is not allowed to give.</p><ol class="tl">${j.trace.map((e) => html`<li><span class="node ${e.ok ? "good" : "crit"}">${icon(e.ok ? "check" : "x")}</span><div class="what"><b class="mono" style="font-size:12.5px">${e.seq}. ${e.tool}</b> ${e.ok ? tonePill("ok", "good") : tonePill(e.error?.code, "crit")} <span class="muted small">as ${roleName(e.actor?.role)}</span><span class="when">${e.error ? e.error.message : `${(e.changes || []).length} changes`}</span><details style="margin-top:4px"><summary class="small" style="cursor:pointer">The trace entry</summary>${codeBlock("", { json: e })}</details></div></li>`)}</ol>`)}</div>
      <div class="section">${panel("The diff after that run", html`${Object.keys(j.diff.summary).length ? html`<div class="row" style="margin-bottom:10px">${Object.entries(j.diff.summary).map(([k, v]) => html`<span class="chip name">${k}: +${v.added} ~${v.changed} −${v.removed}</span>`)}</div>` : ""}${codeBlock("", { json: j.diff })}`, { sub: "Every record that differs from the start" })}</div>` : html`<div class="note warn section">The example run could not be recorded at build time.</div>`}`;
}
