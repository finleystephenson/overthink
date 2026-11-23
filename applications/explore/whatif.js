// What-if: describe or pick a change, see the plan first (what it will change, the parts of the world involved, what is
// measured, how long, how many runs, and what this world cannot model), then run it against the world left alone.
//
// With the lab (simulation/lab/routes.mjs) the run is an experiment: every alternative and the world left alone run side by side
// from the same start, several times with different luck, and the result says what moved, how sure it is, why, and
// who was affected. Without the lab, the change runs once in your own world against its left-alone twin.
// Either way you can then watch it happen in your own world, day by day, and look around the changed world.
// Nothing here is written by a model: a visitor's own model may only suggest a plan, which they check before running.
import { esc, num, money, plural } from "../lib/ui.js";
import { world, ex, lab, mainHandle } from "./api.js";
import { READY, understand, planOf, applyChange, shortName, doing } from "./changes.js";
import { ownModel, modelArms } from "./ask.js";
import { clean, dateWords, refRow, hooks, emitMoved } from "./parts.js";
import { renderChanged } from "./changed.js";

const LENGTHS = [[7, "A week"], [30, "A month"], [90, "Three months"]];
const RUNS = [[1, "Once"], [3, "3 times"], [5, "5 times"]];
const MEASURE_WORDS = { orders: "Orders", revenue: "Money taken", gross_profit: "Gross profit", net_profit: "Profit", customer_satisfaction: "How happy customers are", complaints: "Complaints",
  first_response_minutes: "Wait for a first reply", lost_sales: "Sales lost to empty shelves", contacts: "Customers getting in touch", visitors: "Shop visitors", late_parcels: "Late parcels",
  new_customers: "New customers", reviews: "Reviews", staff_task_hours: "Hours of staff work", refunds: "Refunds", cash: "Cash", social_reach: "People who saw a post", followers: "Followers" };
const MARKS = ["●", "○", "■", "□"];
/** The idea as a question: a capital first letter and one question mark. */
const question = (t) => { const x = String(t).trim().replace(/\?*$/, "?"); return x[0].toUpperCase() + x.slice(1); };

let state = null; // { idea, plan, arms: [{ arm, on }], days, seeds, lab, results, explains, sel }

export async function renderWhatIf(main, q) {
  const idea = q.get("idea");
  const L = await lab();
  await loadNames();
  if (!idea) return pick(main, L);
  if (!state || state.idea !== idea || !state.plan) await makePlan(idea, L, q.get("library"));
  if (state.results) return result(main);
  return plan(main);
}

// ------------------------------------------------------------------ 1. pick or describe

async function pick(main, L) {
  state = null;
  const library = L ? await fetch("/lab/library").then((r) => r.json()).then((j) => j.data || []).catch(() => []) : [];
  const ready = library.length ? library.map((x) => ({ q: x.question || x.title, library: x.id })) : READY.map((r) => ({ q: r.q }));
  main.innerHTML = `
    <section class="xpage wi">
      <h1 class="xh1">Try a what-if</h1>
      <p class="xsub">Describe a change, or pick one. You will see the plan before anything runs.</p>
      <form class="wi-form" id="wiForm">
        <label class="sr" for="wiIdea">Your idea</label>
        <input class="input wi-in" id="wiIdea" placeholder="What if we hired one more person for customer help?" autocomplete="off">
        <button class="pm-pill" type="submit">See the plan</button>
      </form>
      <h2 class="xh2 is-gap">Ready questions</h2>
      <ul class="xrows">${ready.map((r) => `<li><a class="xr" href="#/whatif?idea=${encodeURIComponent(r.q)}${r.library ? `&library=${encodeURIComponent(r.library)}` : ""}"><span class="xr-t">${esc(r.q)}</span><span class="xr-go" aria-hidden="true">→</span></a></li>`).join("")}</ul>
      <p class="xnote">${L ? "Runs in the lab: each change and the world left alone, side by side, from the same start." : "Runs in your world, against the same world left alone."} Results are evidence about this simulated world, not forecasts of a real one.</p>
    </section>`;
  document.getElementById("wiForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = document.getElementById("wiIdea").value.trim();
    if (v) location.hash = `#/whatif?idea=${encodeURIComponent(v)}`;
  });
  document.getElementById("wiIdea").focus();
}

// ------------------------------------------------------------------ 2. the plan

async function labPlan(idea) {
  const r = await fetch("/lab/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idea }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || "The lab could not read that.");
  return j.data;
}

async function makePlan(idea, L, libraryId) {
  if (L) {
    const p = await labPlan(idea);
    let arms = p.experiment?.arms || [];
    if (libraryId) {
      const item = await fetch("/lab/library").then((r) => r.json()).then((j) => (j.data || []).find((x) => x.id === libraryId)).catch(() => null);
      if (item) { arms = item.arms; p.experiment = { ...item, ...(p.experiment || {}), arms: item.arms, days: item.days, seeds: item.seeds }; }
    }
    const labels = await fetch("/lab/interventions").then((r) => r.json()).then((j) => Object.fromEntries((j.data || []).map((x) => [x.id, x.label]))).catch(() => ({}));
    const limits = await fetch("/lab/limits").then((r) => r.json()).then((j) => j.data).catch(() => ({ maxWork: 2400, maxDays: 120, maxSeeds: 10, maxArms: 4 }));
    state = { idea, lab: true, plan: p, limits, labels, arms: arms.map((a, i) => ({ arm: a, on: i < 2 })), days: p.experiment?.days || 30, seeds: Math.min(5, p.experiment?.seeds || 3), suggested: false };
  } else {
    const templates = await world.eventLibrary().catch(() => []);
    const c = understand(idea, templates);
    state = { idea, lab: false, change: c, plan: c ? planOf(c) : null, arms: c ? [{ arm: { id: "change", label: shortName(c) }, on: true }] : [], days: 30, seeds: 1 };
  }
}

function plan(main) {
  const s = state;
  const p = s.plan;
  const empty = !s.arms.length;
  const intro = (iv) => esc(ivWords(iv, s.labels));
  const parts = s.lab
    ? [...(p.world_parts?.apps || []).map((a) => ({ text: plainLab(a), href: appHrefFromWords(a) })), ...(p.world_parts?.people || []).map((x) => ({ text: plainLab(x) })), ...(p.world_parts?.organisations || []).map((x) => ({ text: plainLab(x), href: NAMES.ids[String(x).toLowerCase()] ? `#/e/org/${encodeURIComponent(NAMES.ids[String(x).toLowerCase()])}` : null }))]
    : (p?.parts || []).map((r) => ({ text: r.title, href: r.kind === "ring" ? "#/look" : r.kind === "app" ? `#/apps/${encodeURIComponent(r.id)}` : `#/e/${encodeURIComponent(r.kind)}/${encodeURIComponent(r.id)}` }));
  const measured = s.lab ? (p.measures || []).map((k) => MEASURE_WORDS[k] || k.replace(/_/g, " ")) : p?.measured || [];
  const can = (s.lab ? p.can_model || [] : []).map(plainLab);
  const cannot = (s.lab ? [...(p.cannot_model || []), ...(p.would_need_building || []).map((x) => `Not built yet: ${x}`)] : p?.cannot || []).map(plainLab);
  const work = s.days * s.seeds * (s.arms.filter((a) => a.on).length + 1);
  const over = s.lab && work > (s.limits?.maxWork || 2400);
  main.innerHTML = `
    <section class="xpage wi">
      <p class="xback"><a href="#/whatif">← Other questions</a></p>
      <p class="pm-label">The plan · nothing has run yet</p>
      <h1 class="xh1">${esc(question(s.idea))}</h1>
      ${empty ? `
        <p class="ent-s">This world cannot test that yet${s.lab && p.message ? `: ${esc(p.message)}` : "."}</p>
        ${cannot.length ? `<ul class="plain-list">${cannot.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
        ${ownModel() && s.lab ? `<p><button class="pm-pill small" type="button" id="wiModel">Ask your own model for a plan</button> <span class="wi-said" id="wiModelSaid" aria-live="polite"></span></p>` : ""}
        <p><a href="#/whatif">Pick a ready question</a> or try other words: prices, marketing, a sale, hiring, a strike, a heatwave, a competitor, a supplier.</p>`
      : `
        ${s.suggested ? `<p class="xnote">These changes were suggested by your own model. Check them: the lab runs only what is written here.</p>` : ""}
        <div class="plan">
          <section class="plan-sec"><h2 class="xh2">What will change</h2>
            <ul class="arms">${s.arms.map((a, i) => `<li><label class="arm"><input type="checkbox" data-arm="${i}" ${a.on ? "checked" : ""}><span class="arm-mark" aria-hidden="true">${MARKS[i] || "·"}</span><span><b>${esc(plainLab(a.arm.label))}</b>
              ${s.lab ? `<span class="arm-ivs">${(a.arm.interventions || []).map(intro).join("; ")}</span>` : `<span class="arm-ivs">${p.steps.map(esc).join(" ")}</span>`}</span></label></li>`).join("")}
              <li class="arm-n"><span class="arm-mark" aria-hidden="true">┄</span><span><b>The world left alone</b><span class="arm-ivs">The same start and the same luck, with nothing changed. Everything is measured against it.</span></span></li></ul>
            ${s.lab && s.arms.length < (s.limits?.maxArms || 4) ? `<form class="wi-add" id="wiAdd"><label class="sr" for="wiAddIn">Add another alternative</label><input class="input" id="wiAddIn" placeholder="Add another alternative, e.g. a 5% sale"><button class="btn small" type="submit">Add</button><span class="wi-said" id="wiAddSaid" aria-live="polite"></span></form>` : ""}
          </section>
          <section class="plan-sec"><h2 class="xh2">Parts of the world involved</h2>
            <ul class="chips">${parts.map((x) => `<li>${x.href ? `<a href="${esc(x.href)}">${esc(x.text)}</a>` : esc(x.text)}</li>`).join("") || "<li>The whole shop</li>"}</ul></section>
          <section class="plan-sec"><h2 class="xh2">What is measured</h2>
            <ul class="chips">${measured.map((m) => `<li>${esc(m)}</li>`).join("")}<li>Who was affected, by name</li></ul></section>
          <section class="plan-sec"><h2 class="xh2">How long, and how many times</h2>
            <div class="seg" role="radiogroup" aria-label="How long">${LENGTHS.filter(([d]) => !s.lab || d <= (s.limits?.maxDays || 120)).map(([d, w]) => `<button type="button" role="radio" aria-checked="${d === s.days}" data-days="${d}">${w}</button>`).join("")}</div>
            ${s.lab ? `<div class="seg" role="radiogroup" aria-label="How many runs">${RUNS.map(([n, w]) => `<button type="button" role="radio" aria-checked="${n === s.seeds}" data-seeds="${n}">${w}</button>`).join("")}</div>
            <p class="xsub">${s.seeds > 1 ? `Each run has different luck (who shops, what goes wrong). Running ${s.seeds} times shows how sure the result is.` : "One run shows what happened once. It cannot say how much was luck."} ${esc(p.duration?.why || "")}</p>` : `<p class="xsub">It runs once, in your world, against the same world left alone.</p>`}
            ${over ? `<p class="is-bad-t">That is more work than this server allows (${num(work)} of ${num(s.limits.maxWork)} world-days). Choose fewer days, runs or alternatives.</p>` : ""}
          </section>
          ${can.length ? `<section class="plan-sec"><h2 class="xh2">How this world models it</h2><ul class="plain-list">${can.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></section>` : ""}
          <section class="plan-sec"><h2 class="xh2">What this world cannot model</h2><ul class="plain-list">${cannot.map((c) => `<li>${esc(c)}</li>`).join("")}<li>Real life. Results are evidence about this simulated world, not a forecast.</li></ul></section>
          ${s.lab ? workings({ experiment: { days: s.days, seeds: s.seeds, arms: s.arms.filter((a) => a.on).map((a) => a.arm) }, understood_as: p.understood_as, can_model: p.can_model, cannot_model: p.cannot_model, would_need_building: p.would_need_building, measures: p.measures, duration: p.duration, model_hook: p.model_hook }) : ""}
        </div>
        <div class="wi-go"><button class="pm-pill" type="button" id="wiRun" ${over ? "disabled" : ""}>Run it</button><span class="wi-said" id="wiRunSaid" aria-live="polite"></span></div>`}
    </section>`;

  main.querySelectorAll("[data-arm]").forEach((b) => b.addEventListener("change", () => {
    s.arms[+b.dataset.arm].on = b.checked;
    if (!s.arms.some((a) => a.on)) { b.checked = true; s.arms[+b.dataset.arm].on = true; }
    plan(main);
  }));
  main.querySelectorAll("[data-days]").forEach((b) => b.addEventListener("click", () => { s.days = +b.dataset.days; plan(main); }));
  main.querySelectorAll("[data-seeds]").forEach((b) => b.addEventListener("click", () => { s.seeds = +b.dataset.seeds; plan(main); }));
  document.getElementById("wiAdd")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = document.getElementById("wiAddIn").value.trim();
    const said = document.getElementById("wiAddSaid");
    if (!v) return;
    said.textContent = "Reading it…";
    try {
      const more = (await labPlan(v)).experiment?.arms || [];
      if (!more.length) { said.textContent = "The lab could not turn that into a change."; return; }
      const taken = new Set(s.arms.map((a) => a.arm.id));
      const a = { ...more[0], id: taken.has(more[0].id) ? `${more[0].id}-${s.arms.length + 1}` : more[0].id };
      s.arms.push({ arm: a, on: true });
      plan(main);
    } catch (err) { said.textContent = err.message; }
  });
  document.getElementById("wiModel")?.addEventListener("click", async () => {
    const said = document.getElementById("wiModelSaid");
    said.textContent = "Asking your model…";
    try {
      const catalogue = await fetch("/lab/interventions").then((r) => r.json()).then((j) => j.data);
      const arms = await modelArms(s.idea, catalogue);
      if (!arms?.length) { said.textContent = "Your model could not find a change in this world's catalogue."; return; }
      s.arms = arms.slice(0, 3).map((a, i) => ({ arm: { id: String(a.id || `idea-${i + 1}`).toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 40) || `idea-${i + 1}`, label: String(a.label || "A change").slice(0, 120), interventions: a.interventions || [] }, on: true }));
      s.suggested = true;
      plan(main);
    } catch (err) { said.textContent = err.message; }
  });
  document.getElementById("wiRun")?.addEventListener("click", () => (s.lab ? runLab(main) : runHere(main, s.change)));
}

function appHrefFromWords(text) {
  const name = String(text).split(" (")[0].trim().toLowerCase();
  const ids = { till: "till", tally: "tally", letterbox: "letterbox", "front desk": "front-desk", stockroom: "stockroom", rota: "rota", megaphone: "megaphone", squint: "squint", mutter: "mutter", kettle: "kettle", "the daily overthinker": "daily-overthinker", "filing cabinet": "filing-cabinet", "control room": "control-room" };
  return ids[name] ? `#/apps/${ids[name]}` : null;
}

// ------------------------------------------------------------------ 3. run in the lab

async function runLab(main) {
  const s = state;
  // WHY: the lab's checker takes ids of letters, numbers, - and _ only; a plan may suggest one with a dot ("x1.5").
  const seen = new Set();
  const arms = s.arms.filter((a) => a.on).map((a, i) => {
    let id = String(a.arm.id || `arm-${i + 1}`).replace(/[^a-z0-9_-]/gi, "-").replace(/^[-_]+/, "").slice(0, 40) || `arm-${i + 1}`;
    if (seen.has(id) || id === "baseline") id = `${id.slice(0, 34)}-${i + 1}`;
    seen.add(id);
    return { ...a.arm, id };
  });
  const btn = document.getElementById("wiRun");
  btn.disabled = true;
  const said = document.getElementById("wiRunSaid");
  said.textContent = "Starting…";
  let job;
  try {
    const r = await fetch("/lab/experiments", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ experiment: { title: s.idea, question: s.idea, start: s.plan.experiment?.start || { size: "standard" }, days: s.days, seeds: s.seeds, arms } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || "The lab did not start it.");
    job = j.data.id;
  } catch (e) { said.textContent = e.message; btn.disabled = false; return; }
  main.innerHTML = `
    <section class="xpage wi">
      <p class="pm-label">Running</p>
      <h1 class="xh1">${esc(question(s.idea))}</h1>
      <p class="xsub">${plural(arms.length + 1, "world")} side by side from the same start (${arms.map((a) => esc(plainLab(a.label))).join(", ")}, and the world left alone), ${s.seeds === 1 ? "once" : `${s.seeds} times with different luck`}, for ${plural(s.days, "day")} each.</p>
      <div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="wiProg"><span style="--p:0"></span></div>
      <p class="pm-mono" id="wiProgT">0%</p>
    </section>`;
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 600));
    if (!document.getElementById("wiProg")) return; // left the page; the lab keeps the result
    const st = await fetch(`/lab/experiments/${job}`).then((r) => r.json()).then((j) => j.data).catch(() => null);
    if (!st) continue;
    const pct = Math.round(st.progress * 100);
    document.getElementById("wiProg").setAttribute("aria-valuenow", pct);
    document.getElementById("wiProg").firstElementChild.style.setProperty("--p", st.progress);
    document.getElementById("wiProgT").textContent = `${pct}% · ${Math.round((Date.now() - t0) / 1000)} seconds`;
    if (st.status === "failed") { document.getElementById("wiProgT").textContent = `It stopped: ${st.error}`; return; }
    if (st.status === "done") break;
  }
  const results = await fetch(`/lab/experiments/${job}/results`).then((r) => r.json()).then((j) => j.data);
  const explains = {};
  await Promise.all(arms.map(async (a) => { explains[a.id] = await fetch(`/lab/experiments/${job}/explain/${a.id}`).then((r) => r.json()).then((j) => j.data).catch(() => null); }));
  Object.assign(s, { results, explains, job, ranArms: arms, sel: arms[0].id });
  result(main);
}

// ------------------------------------------------------------------ 4. the result

const KEY_ORDER = ["net_profit", "orders", "revenue", "customer_satisfaction", "complaints", "first_response_minutes", "contacts", "lost_sales", "late_parcels", "visitors", "new_customers", "staff_task_hours", "refunds", "reviews", "followers"];

/** One plain sentence: the change, what moved most clearly, and what could not be told from luck. */
function sentence(arm, ex, res) {
  const ms = (ex?.measures || []).filter((m) => MEASURE_WORDS[m.key]);
  const rank = (k) => (KEY_ORDER.includes(k) ? KEY_ORDER.indexOf(k) : 99);
  // One run has no interval, so "clear" means nothing: say what moved most, and that it may be luck.
  const clear = ms.filter((m) => (res.seeds === 1 ? Math.abs(m.difference || 0) > 0 : m.clear) && Math.abs(m.relative || 0) >= 0.005).sort((a, b) => rank(a.key) - rank(b.key)).slice(0, 3);
  const profit = res.arms[arm.id]?.measures?.net_profit;
  const span = res.days === 7 ? "a week" : res.days === 30 ? "a month" : res.days === 90 ? "three months" : plural(res.days, "day");
  const what = (m) => `${MEASURE_WORDS[m.key].toLowerCase()} ${tidy(m.in_words).replace(/£(\d[\d,]*)\.\d+/g, "£$1").replace(/^up /, "up by ").replace(/^down /, "down by ")}`;
  let s = `Over ${span}, “${plainLab(arm.label)}” `;
  s += clear.length ? `moved ${clear.map(what).join(", ").replace(/, ([^,]*)$/, " and $1")}` : "made no difference that stands out from luck";
  if (res.seeds > 1 && profit && !profit.difference?.clear && !clear.some((m) => m.key === "net_profit")) s += `; its effect on profit is too small to tell from luck`;
  return `${s}${res.seeds > 1 ? `, across ${res.seeds} runs` : " in one run, which cannot tell the change from luck"}.`;
}

async function result(main) {
  const s = state;
  const res = s.results;
  const arms = s.ranArms;
  const keys = KEY_ORDER.filter((k) => arms.some((a) => res.arms[a.id]?.measures?.[k]));
  // The measures that moved most (relative to the world left alone), always with profit and orders first.
  const moved = keys.map((k) => ({ k, r: Math.max(...arms.map((a) => Math.abs(res.arms[a.id].measures[k]?.relative || 0))) }));
  const show = [...new Set(["net_profit", "orders", ...moved.sort((a, b) => b.r - a.r).map((m) => m.k)])].filter((k) => keys.includes(k)).slice(0, 7);
  const sel = arms.find((a) => a.id === s.sel) || arms[0];
  const ex = s.explains[sel.id];
  const change = fromLabArm(sel);
  main.innerHTML = `
    <section class="xpage wi">
      <p class="xback"><a href="#/whatif?idea=${encodeURIComponent(s.idea)}" id="wiBackPlan">← Change the plan</a></p>
      <p class="pm-label">The result · against the world left alone</p>
      <h1 class="xh1">${esc(question(s.idea))}</h1>
      ${arms.map((a, i) => `<p class="wi-verdict"><span class="arm-mark" aria-hidden="true">${MARKS[i]}</span>${esc(sentence(a, s.explains[a.id], res))}</p>`).join("")}
      <figure class="dchart" aria-label="How far each change moved things from the world left alone">
        <figcaption class="xsub">How far each change moved things from the world left alone (the middle line). The bar shows where 90% of the runs' average would fall: if it crosses the line, luck could explain it.</figcaption>
        ${diffChart(show, arms, res)}
      </figure>
      ${arms.length > 1 ? `<div class="seg wi-pick" role="radiogroup" aria-label="Explain which change">${arms.map((a, i) => `<button type="button" role="radio" aria-checked="${a.id === sel.id}" data-sel="${esc(a.id)}">${MARKS[i]} ${esc(plainLab(a.label))}</button>`).join("")}</div>` : ""}
      <div class="wi-cols">
        <section><h2 class="xh2">Why</h2>
          ${whyChain(sel, ex)}
        </section>
        <section><h2 class="xh2">Who was affected</h2>
          ${ex?.people_affected ? `<p class="xsub">${esc(peopleLine(ex.people_affected))}</p><ul class="xrows" id="wiPeople">${(ex.people_affected.examples || []).map((p) => `<li data-name="${esc(p.name)}"><span class="xr"><span class="xr-t">${esc(p.name)}</span><span class="xr-n">${esc(personWords(p))}</span></span></li>`).join("")}</ul>` : `<p class="xempty">Not recorded.</p>`}
        </section>
      </div>
      <details class="workings" id="wiRepro"><summary>Show the workings: every measure, its interval, and how to run it again exactly</summary>
        <pre class="pm-code raw">${esc(JSON.stringify({ note: res.note, honesty: ex?.honesty, experiment: res.title, size: res.size, start_date: res.start_date, days: res.days, seeds_run: res.seeds_run, plugins: res.plugins, arm: res.arms[sel.id] }, null, 2))}</pre><pre class="pm-code raw" data-repro>Loading the record to run it again…</pre></details>
      <section class="ent-sec" id="wiFollow" hidden><h2 class="xh2">Follow one order in this run</h2>
        <p class="xsub">From the first run of “${esc(plainLab(sel.label))}”: every step the records hold, and every tool call that touched it.</p>
        <div class="seg" id="wiFollowPick" role="radiogroup" aria-label="Which order"></div><ol class="chain" id="wiFollowChain"></ol></section>
      <p class="xnote">Evidence about this simulated world, not a prediction of a real one. Each change is compared with the world left alone, with the same luck.${res.seeds > 1 ? ` It ran ${res.seeds} times; the bars show how sure that is.` : " It ran once, so some of this may be luck."}</p>
      <div class="wi-go">
        ${change ? `<button class="pm-pill" type="button" id="wiWatch">Watch it happen in your world</button>` : ""}
        <a class="pm-pill line small" href="#/whatif">Try another</a>
        ${change ? `<span class="xsub">Starts your world again from its first day, makes “${esc(plainLab(sel.label))}”, and runs ${plural(res.days, "day")} while you watch.</span>` : `<span class="xsub">This kind of change runs only in the lab for now.</span>`}
      </div>
    </section>`;
  main.querySelectorAll("[data-sel]").forEach((b) => b.addEventListener("click", () => { s.sel = b.dataset.sel; result(main); }));
  document.getElementById("wiBackPlan").addEventListener("click", (e) => { e.preventDefault(); s.results = null; plan(main); });
  document.getElementById("wiWatch")?.addEventListener("click", () => runHere(main, change, res.days));
  linkPeople(main);
  follow(sel.id);
  document.getElementById("wiRepro")?.addEventListener("toggle", async (e) => {
    const pre = e.target.querySelector("[data-repro]");
    if (!e.target.open || pre.dataset.done) return;
    const j = await fetch(`/lab/experiments/${state.job}/repro`).then((r) => r.json()).catch(() => null);
    pre.textContent = JSON.stringify(j?.data ?? j?.error ?? "Not kept any more.", null, 2);
    pre.dataset.done = "1";
  });
}

/** The lab's follow route: pick one of the run's latest orders, see its whole chain. */
async function follow(armId) {
  const box = document.getElementById("wiFollow");
  const offer = await fetch(`/lab/experiments/${state.job}/follow?arm=${encodeURIComponent(armId)}`).then((r) => r.json()).catch(() => null);
  const orders = offer?.data?.recent_orders || [];
  if (!box || !orders.length) return;
  box.hidden = false;
  const pick = document.getElementById("wiFollowPick");
  pick.innerHTML = orders.slice(-5).reverse().map((o, i) => `<button type="button" role="radio" aria-checked="${i === 0}" data-order="${esc(o)}">Order ${esc(o.slice(4))}</button>`).join("");
  const show = async (order) => {
    pick.querySelectorAll("[data-order]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.order === order)));
    const j = await fetch(`/lab/experiments/${state.job}/follow?arm=${encodeURIComponent(armId)}&order=${encodeURIComponent(order)}`).then((r) => r.json()).catch(() => null);
    const ev = j?.data?.events || [];
    document.getElementById("wiFollowChain").innerHTML = ev.map((e) => `<li class="step"><span class="step-at pm-mono">${esc(dateWords(e.at, { year: false }))}${String(e.at).length > 10 ? ` ${esc(String(e.at).slice(11, 16))}` : ""}</span><div class="step-b"><b class="step-h">${esc(e.kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()))}</b><span class="step-t">${esc(tidy(e.text))}</span></div></li>`).join("")
      || `<li class="xempty">${esc(j?.error?.message || "Nothing recorded.")}</li>`;
  };
  pick.querySelectorAll("[data-order]").forEach((b) => b.addEventListener("click", () => show(b.dataset.order)));
  show(orders.at(-1));
}

function peopleLine(p) {
  const bits = [];
  if (p.bought_more) bits.push(`${num(p.bought_more)} bought more`);
  if (p.bought_less) bits.push(`${num(p.bought_less)} bought less`);
  if (p.more_unhappy_contacts) bits.push(`${num(p.more_unhappy_contacts)} got in touch unhappy more often`);
  if (p.fewer_unhappy_contacts) bits.push(`${num(p.fewer_unhappy_contacts)} less often`);
  return `${plural(p.customers_with_different_outcomes || 0, "customer")} had a different time of it in the first run${bits.length ? `: ${bits.join(", ")}` : ""}. Some of them:`;
}
function personWords(p) {
  const b = p.baseline || {}, a = p.arm || {};
  const bits = [];
  if (a.orders !== b.orders) bits.push(`${plural(a.orders, "order")} with the change, ${num(b.orders)} left alone`);
  else if (Math.round(a.spend) !== Math.round(b.spend)) bits.push(`spent ${money(a.spend)} with the change, ${money(b.spend)} left alone`);
  if ((a.contacts || []).length !== (b.contacts || []).length) bits.push(`got in touch ${plural((a.contacts || []).length, "time")} against ${num((b.contacts || []).length)}`);
  return bits.join("; ") || clean(p.in_words || "");
}

/** Names become links when that person is in the world you are looking at (the same people start in every copy). */
async function linkPeople(main) {
  for (const li of main.querySelectorAll("#wiPeople [data-name]")) {
    const name = li.dataset.name;
    const hit = (await ex("search", { q: name, limit: 3 }).catch(() => [])).find((r) => r.kind === "person" && r.title === name);
    if (hit && li.isConnected) li.innerHTML = refRow({ ...hit, note: li.querySelector(".xr-n")?.textContent || "" }).replace(/^<li>|<\/li>$/g, "");
  }
}

/** A dot-and-interval chart: one row per measure, a mark per change, the world left alone as the middle line. */
function diffChart(keys, arms, res) {
  const W = 760, rowH = 46, left = 210, right = 170, mid = left + (W - left - right) / 2, half = (W - left - right) / 2 - 8;
  const rows = keys.map((k, i) => {
    const ms = arms.map((a) => res.arms[a.id].measures[k]).filter(Boolean);
    const base = Math.abs(ms[0]?.baseline) || 1;
    const scale = Math.max(...ms.map((m) => Math.max(Math.abs(m.difference.ci90?.[0] ?? m.difference.mean), Math.abs(m.difference.ci90?.[1] ?? m.difference.mean))), 1e-9);
    const x = (v) => mid + (v / scale) * half;
    const y = 24 + i * rowH;
    const marks = arms.map((a, j) => {
      const m = res.arms[a.id].measures[k];
      if (!m) return "";
      const yy = y + (arms.length > 1 ? (j - (arms.length - 1) / 2) * 9 : 0);
      const [lo, hi] = m.difference.ci90 || [m.difference.mean, m.difference.mean];
      const tone = !m.difference.clear ? "is-unclear" : (m.difference.mean > 0) === (m.better === "up") ? "is-good" : m.better ? "is-bad" : "";
      const shape = j === 0 ? `<circle cx="${x(m.difference.mean)}" cy="${yy}" r="5" class="dm ${tone}"/>` : j === 1 ? `<circle cx="${x(m.difference.mean)}" cy="${yy}" r="4.5" class="dm is-hollow ${tone}"/>` : `<rect x="${x(m.difference.mean) - 4.5}" y="${yy - 4.5}" width="9" height="9" class="dm ${j === 3 ? "is-hollow " : ""}${tone}"/>`;
      return `<line x1="${x(lo)}" x2="${x(hi)}" y1="${yy}" y2="${yy}" class="dw"/>${shape}`;
    }).join("");
    const first = ms[0];
    const label = `${fmt(k, first.difference.mean, true)}${first.difference.ci90 && res.seeds > 1 ? ` (${fmt(k, first.difference.ci90[0])} to ${fmt(k, first.difference.ci90[1])})` : ""}`;
    return `<g><text x="0" y="${y + 4}" class="dl">${esc(MEASURE_WORDS[k] || first.label)}</text>${marks}<text x="${W}" y="${y + 4}" class="dv" text-anchor="end">${esc(label)}</text>
      <line x1="${left}" x2="${W - right}" y1="${y + rowH / 2}" y2="${y + rowH / 2}" class="dr"/></g>`;
  }).join("");
  const H = 24 + keys.length * rowH;
  return `<svg viewBox="0 0 ${W} ${H + 18}" class="dsvg" role="img" aria-label="Differences from the world left alone">
    <line x1="${mid}" x2="${mid}" y1="4" y2="${H}" class="dz"/><text x="${mid}" y="${H + 14}" class="dzl" text-anchor="middle">The world left alone</text>${rows}</svg>`;
}
function fmt(k, v, sign = false) {
  const s = sign && v > 0 ? "+" : v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (["net_profit", "revenue", "gross_profit", "refunds", "cash"].includes(k)) return `${s}£${num(Math.round(a))}`;
  if (k === "customer_satisfaction") return `${s}${a.toFixed(2)}`;
  if (k === "first_response_minutes") return `${s}${Math.round(a)} min`;
  if (k === "staff_task_hours") return `${s}${a.toFixed(1)} h`;
  return `${s}${num(a >= 10 ? Math.round(a) : Math.round(a * 10) / 10)}`;
}

// ------------------------------------------------------------------ plain words for the lab's data

/** Names of organisations and suppliers by id, read once from the world (for "gadgetry-goose" → "Gadgetry Goose"). */
const NAMES = { byId: {}, ids: {}, ready: null };
export function loadNames() {
  NAMES.ready ||= ex("graph").then((g) => {
    for (const r of g.rings) for (const n of r.nodes) if (["org", "supplier"].includes(n.kind)) { NAMES.byId[n.id] = n.title; NAMES.ids[n.title.toLowerCase()] = n.id; }
  }).catch(() => {});
  return NAMES.ready;
}
const PRODUCT_NAMES = { blip: "Blip", "boombox-mini": "the Boombox Mini", "biscuit-tin": "the Biscuit Tin", daypack: "the Daypack", "one-good-pen": "One Good Pen", "spare-sock": "the Spare Sock", "other-umbrella": "the Other Umbrella", "pocket-jungle": "Pocket Jungle", "emergency-sandwich": "the Emergency Sandwich", "ice-by-post": "Ice by Post", "bubble-wrap": "Bubble Wrap", "indoor-helmet": "the Indoor Helmet", "paper-aeroplane": "the Paper Aeroplane", "skimming-stones": "Skimming Stones", "starter-puddle": "Starter Puddle", trophy: "the Trophy" };
const nameOf = (id) => NAMES.byId[id] || String(id || "").replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
const CATS = { food: "food", tech: "technology", everyday: "everyday", outdoors: "outdoor", "desk-home": "desk and home", carry: "bag" };
const pct = (f) => Math.round(Math.abs(f - 1) * 100);
const ROLE_W = { support_agent: "customer help person", support_lead: "customer help lead", warehouse: "warehouse packer", buyer: "buyer", marketing: "marketing person", finance: "bookkeeper", manager: "manager" };

/** One intervention as a sentence a 12-year-old can read. The raw parameters are in "Show the workings". */
export function ivWords(iv, labels = {}) {
  const p = iv.params || {};
  const d = p.days ? ` for ${p.days} days` : "";
  switch (iv.type) {
    case "price_change": return `${p.scope === "category" ? `Prices of ${CATS[p.target] || p.target} things` : p.scope === "product" ? `The price of ${PRODUCT_NAMES[p.target] || nameOf(p.target)}` : "Every price"} ${p.percent >= 0 ? "up" : "down"} ${Math.abs(p.percent ?? 10)}%`;
    case "sale": return `A ${p.percent ?? 10}% sale with a code${d || " for 14 days"}`;
    case "marketing_budget": return p.monthly != null ? `Spend £${p.monthly} a month on marketing` : p.multiply === 0 ? "No marketing at all" : `Spend ${p.multiply ?? 2} times the planned marketing budget`;
    case "staffing": return p.action === "remove" ? "One person leaves the team" : p.action === "hours" ? `Someone works ${p.weekly_hours} hours a week instead` : `Hire one more ${ROLE_W[p.role] || String(p.role || "person").replace(/_/g, " ")}, ${p.weekly_hours ?? 28} hours a week`;
    case "returns_window": return `Customers get ${p.days} days to send things back`;
    case "delivery_charges": return `Delivery costs £${p.price}${p.free_over != null ? `, free over £${p.free_over}` : ""}`;
    case "launch_product": return `Start selling ${PRODUCT_NAMES[p.product_id] || nameOf(p.product_id)}`;
    case "discontinue_product": return `Stop selling ${PRODUCT_NAMES[p.product_id] || nameOf(p.product_id)}`;
    case "postal_strike": return `A postal strike${d}`;
    case "heatwave": return `A heatwave${d}`;
    case "world_event": return `${p.title || "An event"} happens${d}`;
    case "supplier_disruption": return `A key supplier runs into trouble${d}`;
    case "supplier_problem": return `${nameOf(p.supplier)} can make only ${Math.round((p.capacity_factor ?? 0.5) * 100)}% of its usual amount and takes ${p.extra_lead_days ?? 0} days longer${d}`;
    case "competitor_move": return p.product ? `${nameOf(p.competitor)} sells a copy of ${PRODUCT_NAMES[p.product] || nameOf(p.product)} ${pct(p.price_factor ?? 0.8)}% cheaper${d}` : p.launch_category ? `${nameOf(p.competitor)} launches a rival ${CATS[p.launch_category] || p.launch_category} product ${pct(p.price_factor ?? 0.8)}% cheaper${d}`
      : (p.price_factor ?? 1) < 1 ? `${nameOf(p.competitor)} cuts its prices ${pct(p.price_factor)}%${d}` : (p.ad_factor ?? 1) > 1 ? `${nameOf(p.competitor)} advertises ${p.ad_factor} times as much${d}` : `${nameOf(p.competitor)} changes how it sells${d}`;
    case "economy_shock": {
      const bits = [p.confidence_shift && `people feel ${Math.abs(p.confidence_shift)} points ${p.confidence_shift < 0 ? "less" : "more"} confident`, p.inflation_shift && `prices rise ${p.inflation_shift > 0 ? "faster" : "slower"}`, p.unemployment_shift && `${p.unemployment_shift > 0 ? "more" : "fewer"} people out of work`, p.bank_rate_shift && `interest rates ${p.bank_rate_shift > 0 ? "up" : "down"}`].filter(Boolean);
      return `The economy turns: ${bits.join(", ") || "a shock"}${d}`;
    }
    case "trend_boost": return `Interest in ${CATS[p.category] || p.category} things ${(p.factor ?? 1.5) >= 1 ? "rises" : "falls"} ${pct(p.factor ?? 1.5)}%${d}`;
    case "consumer_shift": return `Shoppers become ${pct(p.price_sensitivity ?? 1.2)}% ${(p.price_sensitivity ?? 1.2) >= 1 ? "more" : "less"} careful about prices${d}`;
    case "connect_ai": return "An AI answers customers";
    case "policy": case "world_setting": return `Change a rule of the world: ${String(p.path || "").split(".").pop().replace(/_/g, " ")}`;
    case "call_tool": return `Use the shop's “${String(p.tool || "").replace(/_/g, " ")}” tool`;
    default: return labels[iv.type] || String(iv.type).replace(/_/g, " ");
  }
}

/** The lab's words made plain: file names gone, ids made names, its channel labels in everyday words. */
export function plainLab(t) {
  let x = tidy(t)
    .replace(/^World setting (competitor moves|economy shocks|trends|consumers)[^:]*:\s*/i, "")
    .replace(/^opinion:\s*/i, "What people think of the shop: ").replace(/^economy:\s*/i, "The economy: ").replace(/^trends?:\s*/i, "What is in fashion: ")
    .replace(/^competitors?:\s*/i, "Competitors: ").replace(/^suppliers?:\s*/i, "Suppliers: ").replace(/^events?:\s*/i, "Events: ")
    .replace(/\s*\((average effect a day|index, 1 = as planned|\(£\)|£)\)/gi, "").replace(/\s*\(1 to 5\)/g, "")
    .replace(/\bprice factor (\d?\.\d+)/g, (m, f) => `${pct(Number(f))}% cheaper`);
  for (const [id, name] of Object.entries(NAMES.byId)) if (id.includes("-")) x = x.replace(new RegExp(`\\b${id}\\b`, "g"), name);
  return x.replace(/\s{2,}/g, " ").trim();
}

/** "Show the workings": the raw record for developers, folded away. */
function workings(obj, title = "Show the workings") {
  return `<details class="workings"><summary>${esc(title)}</summary><pre class="pm-code raw">${esc(JSON.stringify(obj, null, 2))}</pre></details>`;
}

/**
 * Why, as a short chain: the change → the few channels that really moved (biggest first, with their size) → what
 * that did to the measures. Effects that could be luck fold into one line.
 */
function whyChain(arm, ex) {
  if (!ex) return `<p class="xempty">Not recorded.</p>`;
  const moved = (ex.channels || []).filter((c) => Math.abs(c.relative || 0) >= 0.01).sort((a, b) => Math.abs(b.relative) - Math.abs(a.relative)).slice(0, 4);
  const size = (c) => `${(c.difference ?? 0) >= 0 ? "up" : "down"} ${Math.round(Math.abs(c.relative) * 100)}%`;
  const chains = (ex.chains || []).filter((c) => moved.some((m) => m.label === c.channel));
  const all = [...new Set(chains.flatMap((c) => c.measures))];
  const clear = all.filter((m) => !/not clear from luck/.test(m)).map(plainLab).slice(0, 5);
  const unclear = all.filter((m) => /not clear from luck/.test(m)).map((m) => plainLab(m.replace(/\s*\(not clear from luck\)/, "")));
  const did = (ex.what_was_done || []).map((w) => plainLab(w.summary)).join("; ") || clean(arm.label);
  return `<ol class="whyc">
    <li><span class="whyc-k">The change</span><span class="whyc-v">${esc(did)}</span></li>
    <li><span class="whyc-k">What it moved</span>${moved.length ? `<ul>${moved.map((c) => `<li><b>${esc(plainLab(c.label))}</b> <span class="pm-mono">${esc(size(c))}</span></li>`).join("")}</ul>` : `<span class="whyc-v">Nothing moved much.</span>`}</li>
    <li><span class="whyc-k">What that did</span>${clear.length ? `<ul>${clear.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : `<span class="whyc-v">Nothing clear beyond luck.</span>`}</li></ol>
    ${unclear.length ? `<details class="more"><summary>Smaller effects that could be luck (${unclear.length})</summary><ul class="plain-list">${[...new Set(unclear)].map((m) => `<li>${esc(m)}</li>`).join("")}</ul></details>` : ""}
    ${workings({ channels: ex.channels, chains: ex.chains, records: ex.records }, "Show the workings: every channel and rule")}`;
}

/** The lab's words, without the file names it cites for developers ("(business/data/sim.json)", "(infrastructure/engine/events.js)"). */
function tidy(t) {
  return clean(String(t || "").replace(/\s*\((?:see\s+)?[\w./-]+\.(?:mjs|js|json|md)[^)]*\)/g, "").replace(/\s+[\w-]+\/[\w./-]+\.(?:mjs|js|json)\b/g, "")).replace(/ \(£\)/g, "");
}

/** The lab's change, in the explorer's own words, when it can be made with the shop's tools in your world. */
function fromLabArm(arm) {
  const ivs = arm.interventions || [];
  if (ivs.length !== 1) return null;
  const { type, params: p = {} } = ivs[0];
  switch (type) {
    case "price_change": return { type: "price", percent: p.percent ?? 10, ...(p.scope === "category" ? { category: p.target } : p.scope === "product" ? { product: p.target } : {}) };
    case "marketing_budget": return { type: "marketing", ...(p.monthly != null ? { monthly: p.monthly } : { multiply: p.multiply ?? 2 }) };
    case "staffing": return (p.action || "hire") === "hire" ? { type: "staff", role: p.role || "support_agent", hours: p.weekly_hours ?? 28 } : null;
    case "sale": return { type: "sale", percent: p.percent ?? 10, days: p.days ?? 14 };
    case "postal_strike": return { type: "event", template: "rs-postal-strike", title: "Postal strike", days: p.days ?? 14 };
    case "heatwave": return { type: "event", find: "heat", title: "Heatwave", days: p.days ?? 7 };
    case "world_event": return p.template ? { type: "event", template: p.template, title: p.title || "An event", days: p.days ?? 14 } : null;
    default: return null;
  }
}

// ------------------------------------------------------------------ 5. watch it in your world

async function runHere(main, change, days = state.days) {
  if (!change) return;
  if (change.type === "event" && !change.template) {
    const lib = await world.eventLibrary().catch(() => []);
    const t = lib.find((x) => x.title.toLowerCase().includes(change.find));
    if (!t) return;
    change = { ...change, template: t.id, title: t.title };
  }
  main.innerHTML = `
    <section class="xpage wi">
      <p class="pm-label">In your world · against the same world left alone</p>
      <h1 class="xh1">${esc(doing(change))}</h1>
      <p class="xsub" id="hereSaid">Starting your world again from its first day…</p>
      <figure class="lchart" id="hereChart" aria-label="Profit so far, with the change and left alone"></figure>
      <p class="home-live" id="hereLive" aria-live="polite"></p>
      <div class="wi-go" id="hereGo" hidden></div>
    </section>`;
  const said = document.getElementById("hereSaid");
  try {
    await world.reset();
    await hooks.readClock();
    const lines = await applyChange(change, mainHandle());
    said.textContent = `${lines.join(" ")} Now ${plural(days, "day")} run, one at a time.`;
    const step = days <= 30 ? 1 : 3;
    let ran = 0;
    while (ran < days) {
      if (!document.getElementById("hereChart")) return; // the visitor left; the world keeps what has happened
      const n = Math.min(step, days - ran);
      const before = (await world.clock()).now;
      const r = await world.advance(n);
      ran += n;
      emitMoved({ since: before, now: r.now, days: r.days });
      await hooks.readClock();
      const imp = await world.impact();
      lineChart(document.getElementById("hereChart"), imp, days);
      const last = r.days.at(-1)?.summary;
      document.getElementById("hereLive").innerHTML = `<span class="pm-dot on" aria-hidden="true"></span><span class="pm-mono">Day ${ran} of ${esc(days)} · ${esc(dateWords(r.now, { weekday: true }))}</span>${last ? ` ${plural(last.orders || 0, "order")} today` : ""}`;
    }
    await hooks.paintImpact();
    said.textContent = `${lines.join(" ")} ${plural(days, "day")} later, here is your world against the same world left alone.`;
    const go = document.getElementById("hereGo");
    go.hidden = false;
    go.innerHTML = `<a class="pm-pill" href="#/changed">Who and what it changed</a><a class="pm-pill line small" href="#/look">Look around this world</a>`;
  } catch (e) {
    said.textContent = `That stopped: ${e.message}`;
  }
}

/** Running profit for both worlds, drawn as two lines with their names at the ends. */
function lineChart(el, imp, days) {
  const s = imp.series;
  if (!s?.live?.net_profit?.length) return;
  const k = s.stride || 1;
  let a = 0, b = 0;
  const pts = s.live.net_profit.map((v, i) => [s.day?.[i] ?? i + 1, (a += (Number(v) || 0) * k), (b += (Number(s.shadow.net_profit[i]) || 0) * k)]);
  const W = 760, H = 260, L = 56, R = 150, T = 14, B = 28;
  const ys = pts.flatMap((p) => [p[1], p[2]]);
  const lo = Math.min(0, ...ys), hi = Math.max(1, ...ys);
  const x = (d) => L + (d / Math.max(days, 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const path = (j) => pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[j]).toFixed(1)}`).join("");
  const end = pts.at(-1);
  const diff = end[1] - end[2];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="lsvg" role="img" aria-label="Profit so far: ${money(end[1])} with the change, ${money(end[2])} left alone">
    <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="dr"/>
    <text x="${L - 8}" y="${y(hi) + 4}" class="dzl" text-anchor="end">${esc(money(hi))}</text><text x="${L - 8}" y="${y(0) + 4}" class="dzl" text-anchor="end">£0</text>
    <text x="${L}" y="${H - 6}" class="dzl">Day 0</text><text x="${W - R}" y="${H - 6}" class="dzl" text-anchor="end">Day ${days}</text>
    <path d="${path(2)}" class="ll is-alone"/><path d="${path(1)}" class="ll is-you"/>
    <text x="${x(end[0]) + 8}" y="${y(end[1]) + (end[1] >= end[2] ? -4 : 12)}" class="lt">With the change ${esc(money(end[1]))}</text>
    <text x="${x(end[0]) + 8}" y="${y(end[2]) + (end[1] >= end[2] ? 12 : -4)}" class="lt is-alone">Left alone ${esc(money(end[2]))}</text></svg>
    <figcaption class="xsub">Profit so far. ${Math.abs(diff) < 1 ? "No difference yet." : `${money(Math.abs(diff))} ${diff > 0 ? "more" : "less"} with the change.`} One run: some of this is luck.</figcaption>`;
}
