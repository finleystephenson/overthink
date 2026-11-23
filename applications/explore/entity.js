// One page for every kind of thing in the world: what it is in one sentence, its facts, the two lenses for people
// ("what the business knows" and "what is true in the world"), the chain of what happened (orders and actions),
// its connections (each links onward), and a small history.
import { esc } from "../lib/ui.js";
import { ex } from "./api.js";
import { clean, dateWords, refRow, hrefFor, onMoved } from "./parts.js";

const APPS = { till: "Till · Orders", letterbox: "Letterbox · Email", stockroom: "Stockroom · Stock", "front-desk": "Front Desk · Customer help", tally: "Tally · Money",
  squint: "Squint · Photos", mutter: "Mutter · Short posts", kettle: "Kettle · Staff chat", rota: "Rota · Who works when", megaphone: "Megaphone · Marketing",
  "daily-overthinker": "The Daily Overthinker · News", "filing-cabinet": "Filing Cabinet · Documents", "control-room": "Control Room · Results" };
const appLink = (id) => (APPS[id] ? `<a class="xapp" href="#/apps/${esc(id)}">Open in ${esc(APPS[id].split(" · ")[0])}<span> · ${esc(APPS[id].split(" · ")[1])}</span></a>` : "");

export async function renderEntity(main, kind, id) {
  main.innerHTML = `<section class="xpage ent"><p class="xback"><a href="#/look" data-back>← Back</a></p><div class="skel-block"></div></section>`;
  const paint = async () => {
    const d = await ex(`entity/${kind}/${encodeURIComponent(id)}`);
    document.title = `${clean(d.title)} · Overthought & Co.`;
    main.innerHTML = `
      <article class="xpage ent">
        <p class="xback"><a href="#/look" data-back>← Back</a></p>
        <header class="ent-head${d.picture ? " has-pic" : ""}">
          <div>
            <p class="pm-label">${esc(d.kind_label)}</p>
            <h1 class="ent-h">${esc(clean(d.title))}</h1>
            <p class="ent-s">${esc(clean(d.sentence))}</p>
            ${d.apps?.length ? `<p class="ent-apps">${d.apps.map(appLink).join("")}</p>` : ""}
          </div>
          ${/^(https?:\/\/|\/|\.\.?\/)/i.test(String(d.picture || "")) ? `<figure class="ent-pic"><img src="${esc(d.picture)}" alt="${esc(clean(d.title))}" width="320" height="320"></figure>` : ""}
        </header>
        ${d.facts?.filter((f) => f.value).length ? `<dl class="facts">${d.facts.filter((f) => f.value).map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(capital(clean(f.value)))}</dd></div>`).join("")}</dl>` : ""}
        ${d.lenses ? lenses(d.lenses) : ""}
        ${d.body ? `<div class="ent-body">${esc(d.body).replace(/\n/g, "<br>")}</div>` : ""}
        ${d.chain?.length ? chain(d) : ""}
        ${d.kind === "app" ? `<p><a class="pm-pill small" href="#/apps/${esc(d.id)}">Open it here</a></p>` : ""}
        ${d.connections.length ? `<section class="ent-sec"><h2 class="xh2">Connected to</h2><div class="conns">${d.connections.map((g) => `<div class="conn"><h3 class="conn-h">${esc(g.group)} <span class="pm-mono">${g.items.length}</span></h3><ul class="xrows">${g.items.slice(0, 12).map(refRow).join("")}</ul>${g.items.length > 12 ? `<details class="more"><summary>${g.items.length - 12} more</summary><ul class="xrows">${g.items.slice(12).map(refRow).join("")}</ul></details>` : ""}</div>`).join("")}</div></section>` : ""}
        ${d.history.length ? history(d.history) : ""}
        ${workings(d.workings)}
      </article>`;
    main.querySelectorAll("[data-back]").forEach((a) => a.addEventListener("click", (e) => { if (history_length() > 1) { e.preventDefault(); window.history.back(); } }));
  };
  await paint();
  // Time moving changes what a page knows (a new order, a parcel arriving): read it again, quietly.
  const stop = onMoved(() => paint().catch(() => {}));
  return { destroy: stop };
}
const history_length = () => window.history.length;

/** The record behind the page, for developers: ids, raw fields. Folded away; plain words above never need it. */
export function workings(w, title = "Show the workings") {
  if (!w || !Object.keys(w).length) return "";
  return `<details class="workings"><summary>${esc(title)}</summary><pre class="pm-code raw">${esc(JSON.stringify(w, null, 2))}</pre></details>`;
}
const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function lenses(l) {
  const side = (x, cls) => `<section class="lens ${cls}"><h2 class="lens-h">${esc(x.title)}</h2><p class="lens-n">${esc(x.note)}</p>
    ${x.rows.length ? `<dl class="lens-rows">${x.rows.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${esc(capital(clean(r.value)))}</dd></div>`).join("")}</dl>` : `<p class="xempty">Nothing.</p>`}</section>`;
  return `<div class="lenses">${side(l.business, "is-biz")}${side(l.world, "is-world")}</div>`;
}

/** Follow the chain: each step with its time, what happened, links to its records and the app it lives in. */
function chain(d) {
  return `<section class="ent-sec"><h2 class="xh2">${d.kind === "action" ? "What it read, what it did, what followed" : "Follow the chain"}</h2>
    <p class="xsub">${d.kind === "order" ? "Every step the records hold, in time order. Steps nobody recorded are left out, never made up." : "From the record of every tool call."}</p>
    <ol class="chain">${d.chain.map((s) => `<li class="step">
      <span class="step-at pm-mono">${esc(dateWords(s.at, { year: false }))}${s.at?.length > 10 ? ` ${esc(s.at.slice(11, 16))}` : ""}</span>
      <div class="step-b"><b class="step-h">${esc(s.step)}</b><span class="step-t">${esc(clean(s.text))}</span>
      ${(s.links || []).length || s.app ? `<span class="step-l">${(s.links || []).map((r) => `<a href="${esc(hrefFor(r))}">${esc(clean(r.title))}</a>`).join("")}${s.app && APPS[s.app] ? `<a class="is-app" href="#/apps/${esc(s.app)}">${esc(APPS[s.app])}</a>` : ""}</span>` : ""}</div></li>`).join("")}</ol></section>`;
}

/** A small timeline: dots along the years (or months) it covers, and the entries, newest first. */
function history(items) {
  const t0 = Date.parse(items[0].at), t1 = Date.parse(items.at(-1).at);
  const span = Math.max(1, t1 - t0);
  const dots = items.map((h) => `<span class="hs-dot" style="left:${(((Date.parse(h.at) - t0) / span) * 100).toFixed(2)}%" title="${esc(dateWords(h.at))}"></span>`).join("");
  const row = (h) => `<li class="hrow"><span class="pm-mono">${esc(dateWords(h.at))}</span>${h.kind ? `<a href="${esc(hrefFor(h))}">${esc(clean(h.text))}</a>` : `<span>${esc(clean(h.text))}</span>`}</li>`;
  const newest = [...items].reverse();
  return `<section class="ent-sec"><h2 class="xh2">History</h2>
    <div class="hstrip" aria-hidden="true">${dots}<span class="hs-a pm-mono">${esc(dateWords(items[0].at))}</span><span class="hs-b pm-mono">${esc(dateWords(items.at(-1).at))}</span></div>
    <ul class="hrows">${newest.slice(0, 10).map(row).join("")}</ul>
    ${newest.length > 10 ? `<details class="more"><summary>${newest.length - 10} earlier</summary><ul class="hrows">${newest.slice(10).map(row).join("")}</ul></details>` : ""}</section>`;
}
