// Bring your technology. Two ways, one page:
//   /overthink  test an existing AI product: what you are testing → connect it → what it may read and do, per app →
//               choose situations → run → evidence (each situation's checks, the scorecard, the raw report).
//               Runs in the lab (POST /lab/overthink), each situation in a fresh copy of the shop.
//   A job       give your AI (or any software) a job in YOUR world: connect it by MCP, web API or web address, move
//               time on, then see every tool call it made, what changed, and what the shop's rules refused.
// Technical words are allowed here, and only here.
import { esc, num, plural, copyText } from "../lib/ui.js";
import { world, ex, lab, serverJobs, ownerRoute } from "./api.js";
import { clean, refRow, hooks } from "./parts.js";

const APPS = [["email", "Email"], ["orders", "Orders"], ["customers", "Customers"], ["returns", "Returns"], ["refunds", "Refunds"], ["cases", "Cases"], ["catalogue", "Catalogue and prices"],
  ["stock", "Stock"], ["repairs", "Repairs"], ["knowledge", "Policies and help"], ["social", "Social"], ["marketing", "Marketing"], ["money", "Money"], ["news", "News"]];
const ROLES = [["assistant", "An assistant that answers customers", "Talks to customers by chat or email, acting for one checked customer at a time."],
  ["support_agent", "A customer help agent", "Answers customers and can give refunds and credit within the help desk's limits."],
  ["manager", "Something that runs the shop", "Prices, stock, marketing and the team, with the manager's permissions."]];
const isRead = (tool) => /^(list|get|search|check|read|lookup|find|whats|stock_history|price_history|web_sessions|social_stats|business_snapshot|delivery_options|payment_methods|compare)/.test(tool);

const ot = { role: "assistant", url: "", standIn: false, read: new Set(), act: new Set(), only: null, days: 0, repeats: 1 };

export async function renderTech(main) {
  const [L, jobs, sits] = await Promise.all([lab(), serverJobs(), ex("situations").catch(() => [])]);
  if (ot.only === null) ot.only = new Set(sits.map((s) => s.id));
  main.innerHTML = `
    <section class="xpage tech">
      <h1 class="xh1">Bring your technology</h1>
      <p class="xsub">Connect an AI product, or any software, to this world. It works through the shop's own tools, under the shop's rules, and everything it does is recorded.</p>
      <nav class="seg tech-tabs" role="tablist" aria-label="Ways to bring it">
        <button type="button" role="tab" data-tab="overthink" aria-selected="true">Test an AI product <span class="pm-mono">/overthink</span></button>
        <button type="button" role="tab" data-tab="job" aria-selected="false">Give it a job in your world</button>
      </nav>
      <div id="techBody"></div>
    </section>`;
  const body = main.querySelector("#techBody");
  const show = (tab) => {
    main.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    if (tab === "overthink") overthink(body, L, sits); else jobView(body, jobs);
  };
  main.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
  show("overthink");
  return null;
}

// ------------------------------------------------------------------ /overthink

function overthink(el, L, sits) {
  if (!L) { el.innerHTML = `<p class="xempty">The lab is not running on this server, so /overthink is not available here. Give your AI a job in your world instead.</p>`; return; }
  el.innerHTML = `
    <ol class="steps">
      <li class="stp"><h2 class="stp-h"><span>1</span>What are you testing?</h2>
        <div class="picks">${ROLES.map(([id, t, d]) => `<label class="pick"><input type="radio" name="otRole" value="${id}" ${ot.role === id ? "checked" : ""}><b>${esc(t)}</b><span>${esc(d)}</span></label>`).join("")}</div></li>
      <li class="stp"><h2 class="stp-h"><span>2</span>Connect it</h2>
        <p class="xsub">Your AI's web address. Each turn, the lab sends it the conversation and the shop's tools over HTTP; it answers with a reply and any tool calls (the protocol is in docs/lab.md and docs/connect.md).</p>
        <div class="row-in"><label class="sr" for="otUrl">Your AI's web address</label><input class="input" id="otUrl" placeholder="https://my-ai.example/turn" value="${esc(ot.url)}" ${ot.standIn ? "disabled" : ""}></div>
        <label class="check"><input type="checkbox" id="otStandIn" ${ot.standIn ? "checked" : ""}> No AI to hand? Use the lab's stand-in, which does nothing, to see how scoring works.</label></li>
      <li class="stp"><h2 class="stp-h"><span>3</span>What it may read, and what it may do</h2>
        <p class="xsub">Leave everything unticked to give it its role's own permissions. Anything ticked narrows it: a call outside these is refused before the shop sees it, and counted under safety.</p>
        <table class="perm"><thead><tr><th scope="col">Part of the shop</th><th scope="col">May read</th><th scope="col">May do</th></tr></thead><tbody>
          ${APPS.map(([id, w]) => `<tr><th scope="row">${esc(w)}</th><td><input type="checkbox" aria-label="${esc(w)}: may read" data-read="${id}" ${ot.read.has(id) ? "checked" : ""}></td><td><input type="checkbox" aria-label="${esc(w)}: may do" data-act="${id}" ${ot.act.has(id) ? "checked" : ""}></td></tr>`).join("")}
        </tbody></table></li>
      <li class="stp"><h2 class="stp-h"><span>4</span>Choose situations</h2>
        <ul class="sits">${sits.map((s) => `<li><label class="check"><input type="checkbox" data-sit="${esc(s.id)}" ${ot.only.has(s.id) ? "checked" : ""}><span><b>${esc(s.title)}</b><span class="xr-n">${esc(s.why || "")}</span></span></label></li>`).join("")}</ul>
        <div class="seg" role="radiogroup" aria-label="Repeats">${[1, 2, 3].map((n) => `<button type="button" role="radio" data-rep="${n}" aria-checked="${ot.repeats === n}">${n === 1 ? "Each once" : `Each ${n} times`}</button>`).join("")}</div>
        <div class="seg" role="radiogroup" aria-label="A stretch of ordinary days too">${[[0, "Situations only"], [7, "And a week of ordinary days"], [14, "And two weeks"]].map(([d, w]) => `<button type="button" role="radio" data-days="${d}" aria-checked="${ot.days === d}">${w}</button>`).join("")}</div></li>
      <li class="stp"><h2 class="stp-h"><span>5</span>Run</h2>
        <button class="pm-pill" type="button" id="otRun">Run the test</button> <span class="wi-said" id="otSaid" aria-live="polite"></span>
        <div class="prog" id="otProg" hidden><span style="--p:0"></span></div></li>
    </ol>
    <div id="otOut"></div>`;
  el.querySelectorAll("[name=otRole]").forEach((r) => r.addEventListener("change", () => { ot.role = r.value; }));
  el.querySelector("#otUrl").addEventListener("input", (e) => { ot.url = e.target.value.trim(); });
  el.querySelector("#otStandIn").addEventListener("change", (e) => { ot.standIn = e.target.checked; el.querySelector("#otUrl").disabled = ot.standIn; });
  el.querySelectorAll("[data-read]").forEach((c) => c.addEventListener("change", () => (c.checked ? ot.read.add(c.dataset.read) : ot.read.delete(c.dataset.read))));
  el.querySelectorAll("[data-act]").forEach((c) => c.addEventListener("change", () => (c.checked ? ot.act.add(c.dataset.act) : ot.act.delete(c.dataset.act))));
  el.querySelectorAll("[data-sit]").forEach((c) => c.addEventListener("change", () => (c.checked ? ot.only.add(c.dataset.sit) : ot.only.delete(c.dataset.sit))));
  el.querySelectorAll("[data-rep]").forEach((b) => b.addEventListener("click", () => { ot.repeats = +b.dataset.rep; overthink(el, L, sits); }));
  el.querySelectorAll("[data-days]").forEach((b) => b.addEventListener("click", () => { ot.days = +b.dataset.days; overthink(el, L, sits); }));
  el.querySelector("#otRun").addEventListener("click", () => runOverthink(el));
}

async function runOverthink(el) {
  const said = el.querySelector("#otSaid");
  if (!ot.standIn && !/^https?:\/\//.test(ot.url)) { said.textContent = "Give your AI's web address, or tick the stand-in."; return; }
  if (!ot.only.size) { said.textContent = "Choose at least one situation."; return; }
  const body = { connection: ot.standIn ? { kind: "none" } : { kind: "http", url: ot.url }, reference_only: ot.standIn, role: ot.role, days: ot.days, seeds: 1, repeats: ot.repeats, only: [...ot.only],
    ...(ot.read.size || ot.act.size ? { scope: { read: [...ot.read], act: [...ot.act] } } : {}) };
  const btn = el.querySelector("#otRun");
  btn.disabled = true;
  said.textContent = "Starting…";
  try {
    const r = await fetch("/lab/overthink", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || "The lab did not start it.");
    const prog = el.querySelector("#otProg");
    prog.hidden = false;
    const t0 = Date.now();
    let d;
    for (;;) {
      await new Promise((res) => setTimeout(res, 900));
      if (!el.isConnected) return;
      d = (await fetch(`/lab/overthink/${j.data.id}`).then((x) => x.json())).data;
      prog.firstElementChild.style.setProperty("--p", d.progress || 0);
      said.textContent = `Running · ${Math.round((Date.now() - t0) / 1000)} seconds`;
      if (d.status !== "running") break;
    }
    if (d.status === "failed") throw new Error(d.error || "It failed.");
    said.textContent = `Done in ${d.took_seconds ?? Math.round((Date.now() - t0) / 1000)} seconds.`;
    evidence(el.querySelector("#otOut"), d);
  } catch (e) { said.textContent = e.message; } finally { btn.disabled = false; }
}

/** The evidence: the scorecard, each situation's checks with what the records show, and the raw report. */
function evidence(out, d) {
  const SHARE = ["task_success", "accuracy", "reliability", "consistency"];
  const val = (k, m) => {
    if (k === "latency" && m.median_ms != null) return `${num(Math.round(m.median_ms))} ms (median)`;
    if (k === "cost" && m.status !== "not measured") return m.per_reply_gbp != null ? `£${Number(m.per_reply_gbp).toFixed(3)} a reply` : `£${num(m.per_month_entered || m.reported_cost_gbp || 0)}`;
    if (k === "process" && m.share_ok != null) return `${Math.round(m.share_ok * 100)}%`;
    if (m.value == null) return "Not measured";
    return typeof m.value === "number" ? (SHARE.includes(k) ? `${Math.round(m.value * 100)}%` : num(m.value)) : String(m.value);
  };
  out.innerHTML = `
    <section class="ev">
      <h2 class="xh2">Evidence</h2>
      ${(d.cards || []).map((c) => `<div class="card-ev"><h3 class="xh3">${esc(c.product)}</h3><p class="xsub">${esc(c.note || "")}</p>
        <dl class="facts">${Object.entries(c.metrics || {}).map(([k, m]) => `<div><dt>${esc(k.replace(/_/g, " "))}</dt><dd><b>${esc(val(k, m))}</b> <span class="xr-n">${esc(m.status === "measured" ? m.definition || "" : (m.why || m.definition || "").replace(/\s*Use --[\w-]+.*$/, ""))}</span></dd></div>`).join("")}</dl>
        <details class="workings"><summary>Show the workings: how each score is worked out</summary><pre class="pm-code raw">${esc(JSON.stringify(c.metrics, null, 2))}</pre></details></div>`).join("")}
      <h3 class="xh3">Situations</h3>
      <ul class="sitres">${(d.situations || []).filter((s) => s.checks).map((s) => `<li class="${s.passed ? "is-good" : "is-bad"}"><details><summary><b>${s.passed ? "Passed" : "Failed"}</b> ${esc(s.title)}${s.repeat ? ` <span class="pm-mono">repeat ${esc(s.repeat + 1)}</span>` : ""}</summary>
        <p class="xsub">${esc(s.why || "")}</p><ul class="plain-list">${s.checks.map((k) => `<li>${k.passed ? "Passed" : "Failed"}: ${esc(k.what === "judge" ? "the customer's need was met" : k.what)}</li>`).join("")}</ul>
        <details class="workings"><summary>Show the workings</summary><pre class="pm-code raw">${esc(JSON.stringify({ situation: s.situation, checks: s.checks, tool_calls: s.tool_calls, transcript: s.transcript }, null, 2))}</pre></details>
        ${s.transcript?.length ? `<ol class="plain-list">${s.transcript.map((t) => `<li><b>${esc(t.from || t.role || "")}</b> ${esc(clean(t.text || ""))}</li>`).join("")}</ol>` : ""}
        ${s.tool_calls?.length ? `<p class="pm-mono">Tool calls: ${esc(s.tool_calls.map((t) => t.tool || t.name).join(", "))}</p>` : ""}</details></li>`).join("")}</ul>
      <details class="workings"><summary>Show the workings: the whole report</summary><pre class="pm-code raw">${esc(JSON.stringify(d, null, 2).slice(0, 60000))}</pre></details>
    </section>`;
}

// ------------------------------------------------------------------ a job in your world

async function jobView(el, jobs) {
  if (!jobs.length) { el.innerHTML = `<p class="xempty">This server has no ready jobs.</p>`; return; }
  el.innerHTML = `
    <ol class="steps">
      <li class="stp"><h2 class="stp-h"><span>1</span>Pick its job</h2>
        <div class="picks">${jobs.map((j) => `<label class="pick"><input type="radio" name="job" value="${esc(j.id)}"><b>${esc(j.name)}</b><span>${esc(j.for_person || "")}</span></label>`).join("")}</div></li>
      <li class="stp" id="jobMore" hidden></li>
    </ol>`;
  el.querySelectorAll("[name=job]").forEach((r) => r.addEventListener("change", () => jobSteps(el.querySelector("#jobMore"), jobs.find((j) => j.id === r.value))));
}

function jobSteps(box, job) {
  box.hidden = false;
  const reads = job.tools.filter(isRead), does = job.tools.filter((t) => !isRead(t));
  box.innerHTML = `
    <h2 class="stp-h"><span>2</span>What it may read, and what it may do</h2>
    <p class="xsub">Fixed by the job (the ${esc(job.role.replace(/_/g, " "))}'s permissions); the shop's rules refuse anything else. ${esc(job.daily || "")}</p>
    <div class="wi-cols"><div><h3 class="xh3">May read</h3><p class="pm-mono">${esc(reads.join(", ") || "nothing")}</p></div><div><h3 class="xh3">May do</h3><p class="pm-mono">${esc(does.join(", ") || "nothing")}</p></div></div>
    <h2 class="stp-h"><span>3</span>Connect it</h2>
    <p class="xsub">This makes a key that can only act as this job, in your world. It is shown once.</p>
    <label class="check"><span>Or give your AI's web address and the shop will send it each customer's message:</span></label>
    <div class="row-in"><input class="input" id="jobUrl" placeholder="https://my-ai.example/reply (optional)"></div>
    <button class="pm-pill small" type="button" id="jobStart">Make its key</button> <span class="wi-said" id="jobSaid" aria-live="polite"></span>
    <div id="jobKey"></div>`;
  box.querySelector("#jobStart").addEventListener("click", async () => {
    const said = box.querySelector("#jobSaid");
    said.textContent = "Making the key…";
    try {
      const url = box.querySelector("#jobUrl").value.trim();
      const d = await ownerRoute("POST", `jobs/${job.id}/start`, url ? { url, can_move_time: false } : { can_move_time: false });
      said.textContent = "Ready. Copy one line into your AI.";
      const c = d.connect;
      const line = (t, v) => `<div class="pm-code"><div class="pm-code-head"><span>${esc(t)}</span><button class="btn small" type="button" data-copy>Copy</button></div><pre>${esc(typeof v === "string" ? v : JSON.stringify(v, null, 2))}</pre></div>`;
      box.querySelector("#jobKey").innerHTML = `
        ${line("MCP address (any MCP client)", c.mcp_url)}${line("Claude Code", c.claude_code)}${line("MCP settings file", c.mcp_json)}${line("Web API (curl)", c.web_api)}
        <h2 class="stp-h"><span>4</span>Run</h2>
        <p class="xsub">Move time on. Each day brings customers and work; your AI acts through its key.</p>
        <div class="seg"><button type="button" data-run="7">Run a week</button><button type="button" data-run="30">Run a month</button></div> <span class="wi-said" id="jobRunSaid" aria-live="polite"></span>
        <h2 class="stp-h"><span>5</span>Evidence</h2><div id="jobEv"><p class="xempty">Nothing yet. Run some days, or let your AI act, then look here.</p></div>
        <p><button class="btn small" type="button" id="jobRefresh">Read the evidence again</button></p>`;
      box.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copyText(b.closest(".pm-code").querySelector("pre").textContent, b)));
      box.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", async () => {
        const s = box.querySelector("#jobRunSaid");
        s.textContent = "Running…";
        const ok = await hooks.advance(+b.dataset.run);
        s.textContent = ok ? "Done." : "Time did not move.";
        jobEvidence(box.querySelector("#jobEv"), job);
      }));
      box.querySelector("#jobRefresh").addEventListener("click", () => jobEvidence(box.querySelector("#jobEv"), job));
    } catch (e) { said.textContent = e.message; }
  });
}

/** What the job's key did: the result in words, every tool call (each opens its own page), what the rules refused. */
async function jobEvidence(el, job) {
  const [res, act, info] = await Promise.all([ownerRoute("GET", `jobs/${job.id}/result?voices=all`).catch(() => null), world.activity({ since: 0 }), world.connectInfo()]);
  // Its calls: made with a key that is not this page's own (the owner's), as the job's role.
  const t = true;
  const mine = act.entries.filter((e) => e.kind === "tool" && e.actor?.token !== info.ownerTokenId && e.actor?.role === job.role);
  const refused = mine.filter((e) => !e.ok);
  const changed = mine.filter((e) => e.ok && (e.changes || []).length);
  el.innerHTML = `
    <p class="ent-s">${esc(clean(res?.summary || "No result yet."))}</p>
    <div class="wi-cols">
      <section><h3 class="xh3">Its tool calls <span class="pm-mono">${num(mine.length)}</span></h3>
        ${mine.length ? `<ul class="xrows">${mine.slice(-40).reverse().map((e) => refRow({ kind: "action", id: String(e.seq), title: `${e.tool}${e.ok ? "" : " (refused)"}`, note: e.changes?.[0] || e.sim_time?.slice(0, 16).replace("T", " ") })).join("")}</ul>` : `<p class="xempty">None yet${t ? "" : ": this key has not been used"}.</p>`}</section>
      <section><h3 class="xh3">What changed <span class="pm-mono">${num(changed.length)}</span></h3>
        ${changed.length ? `<ul class="plain-list">${changed.slice(-15).map((e) => `<li>${esc(clean(e.changes.join("; ")))}</li>`).join("")}</ul>` : `<p class="xempty">Nothing.</p>`}
        <h3 class="xh3">Refused by the shop's rules <span class="pm-mono">${num(refused.length)}</span></h3>
        ${refused.length ? `<ul class="plain-list">${refused.slice(-15).map((e) => `<li>${esc(e.tool)}: ${esc(clean(e.error?.message || ""))}</li>`).join("")}</ul>` : `<p class="xempty">Nothing.</p>`}</section>
    </div>`;
}
