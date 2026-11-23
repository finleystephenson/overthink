// "Change something": the levers a business owner would actually pull. A price, the marketing budget, someone's
// hours, a campaign, an event in the world. Each one is an ordinary engine tool call as the manager, so it is checked
// by the rules and shows in "Everything that was done". Then you move time and read the result.
import { esc, money, num, avatar, plural, shortDate } from "../lib/ui.js";

const AS = { role: "manager", screen: true };
const ACT = { role: "manager" };
const REASON = "Tried from the Control Room";

const TABS = [
  { id: "price", label: "Prices" },
  { id: "marketing", label: "Marketing" },
  { id: "hours", label: "Hours" },
  { id: "campaign", label: "A campaign" },
  { id: "event", label: "An event" },
];

/**
 * Builds the panel inside `box`.
 * @param {HTMLElement} box
 * @param {{world: object, onDone: function(string): void}} p onDone is told what was done, to nudge the person to run time
 */
export function mountTry(box, { world, onDone }) {
  const s = { tab: "price", priceMode: "one", levers: null, products: null, product: null, person: null, library: null };
  box.innerHTML = `<div class="try-tabs" role="group" aria-label="What to change">${TABS.map((t) => `<button type="button" class="pm-chip" data-tab="${t.id}" aria-pressed="${t.id === s.tab}">${t.label}</button>`).join("")}</div>
    <div class="try-body" id="tryBody"></div>
    <p class="try-said" id="trySaid" aria-live="polite"></p>`;
  const said = box.querySelector("#trySaid");
  const body = box.querySelector("#tryBody");
  box.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    s.tab = b.dataset.tab;
    box.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    paint();
  }));

  async function levers() {
    const r = await world.call("get_levers", {}, AS);
    s.levers = r.ok ? r.data : null;
    return s.levers;
  }

  /** What happened, written under the controls you just used (not in a toast far away). */
  function done(msg) {
    said.className = "try-said is-good";
    said.textContent = msg;
    onDone?.(msg);
  }

  function refused(msg) {
    said.className = "try-said is-bad";
    said.textContent = msg;
  }
  const finish = done;

  // ---------------------------------------------------------------- price

  /** One product, or every price in the shop at once (the owner's own example of a test: "put prices up 10%"). */
  function priceModes() {
    return `<div class="price-mode" role="radiogroup" aria-label="What to change">${[["one", "One product"], ["all", "Every price"]].map(([v, t]) =>
      `<button role="radio" aria-checked="${s.priceMode === v}" data-mode="${v}">${t}</button>`).join("")}</div>`;
  }

  function wireModes() {
    body.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
      if (s.priceMode === b.dataset.mode) return;
      s.priceMode = b.dataset.mode;
      paintPrice();
    }));
  }

  async function loadProducts() {
    if (!s.products) {
      const r = await world.call("search_catalogue", { query: "the" }, AS);
      s.products = r.ok ? r.data.results.filter((p) => p.kind === "product") : [];
    }
    return s.products;
  }

  async function paintAllPrices() {
    if (!(await loadProducts()).length) { body.innerHTML = `${priceModes()}<p class="muted">The shop's prices did not load. Try again in a moment.</p>`; wireModes(); return; }
    body.innerHTML = `${priceModes()}
      <div class="shelf is-all">${s.products.map((p) => `<span class="shelf-item"><img src="/img/web/${esc(p.id)}-640.webp" alt="" loading="lazy" width="64" height="64"></span>`).join("")}</div>
      <div class="dial-read big"><b class="dial-value" id="allOut">No change</b><span class="dial-was" id="allWas">Every price in the shop moves by the same share.</span></div>
      <input class="slide" id="allIn" type="range" min="-30" max="30" step="1" value="0" aria-label="Change every price by">
      <div class="try-go"><button class="btn primary" id="allGo" disabled>Change every price</button></div>`;
    wireModes();
    const input = body.querySelector("#allIn");
    const go = body.querySelector("#allGo");
    const show = () => {
      const v = Number(input.value);
      fill(input);
      body.querySelector("#allOut").textContent = v === 0 ? "No change" : `${v > 0 ? "+" : "−"}${Math.abs(v)}%`;
      body.querySelector("#allWas").textContent = v === 0 ? (s.lastAll || "Every price in the shop moves by the same share.") : `Every price ${Math.abs(v)}% ${v > 0 ? "higher" : "lower"}. A £10 thing would cost ${money2(10 * (1 + v / 100))}.`;
      go.disabled = v === 0;
    };
    input.addEventListener("input", show);
    show();
    go.addEventListener("click", () => changeAll(Number(input.value), go));
  }

  /** Moves every size of every product by the same share, a few at a time so the business is not flooded. */
  async function changeAll(pct, go) {
    go.disabled = true;
    const label = go.textContent;
    const k = 1 + pct / 100;
    const skus = [];
    for (const p of s.products) {
      const r = await world.call("get_product", { id: p.id }, AS);
      if (r.ok) skus.push(...r.data.variants.filter((v) => Number.isFinite(v.price)));
      go.textContent = `Reading the prices…`;
    }
    let done = 0;
    let failed = null;
    for (let i = 0; i < skus.length; i += 6) {
      const res = await Promise.all(skus.slice(i, i + 6).map((v) => world.call("change_price", { sku: v.sku, new_price: Math.max(0.01, Math.round(v.price * k * 100) / 100), reason: `${REASON}: every price ${pct > 0 ? "+" : "−"}${Math.abs(pct)}%` }, ACT)));
      done += res.filter((x) => x.ok).length;
      failed ||= res.find((x) => !x.ok);
      go.textContent = `Changing prices… ${done} of ${skus.length}`;
    }
    go.textContent = label;
    if (!done) { refused(failed?.error?.message || "No price changed."); go.disabled = false; return; }
    s.lastAll = `Done: every price ${Math.abs(pct)}% ${pct > 0 ? "higher" : "lower"}.`;
    finish(`Every price is now ${Math.abs(pct)}% ${pct > 0 ? "higher" : "lower"}. Move time on to see what it does.`);
    paintAllPrices();
  }

  async function paintPrice() {
    if (s.priceMode === "all") return paintAllPrices();
    if (!s.products) {
      const r = await world.call("search_catalogue", { query: "the" }, AS);
      s.products = r.ok ? r.data.results.filter((p) => p.kind === "product") : [];
    }
    if (!s.products.length) { body.innerHTML = `<p class="muted">The catalogue did not answer.</p>`; return; }
    s.product ||= s.products.find((p) => p.id === "spare-sock") || s.products[0];
    const r = await world.call("get_product", { id: s.product.id }, AS);
    const variants = r.ok ? r.data.variants.filter((v) => Number.isFinite(v.price)) : [];
    const base = variants[0]?.price ?? s.product.price?.from ?? 0;
    body.innerHTML = `${priceModes()}
      <div class="shelf">${s.products.map((p) => `<button class="shelf-item${p.id === s.product.id ? " is-on" : ""}" data-product="${esc(p.id)}" aria-label="${esc(p.name)}">
        <img src="/img/web/${esc(p.id)}-640.webp" alt="" loading="lazy" width="64" height="64"></button>`).join("")}</div>
      <div class="dial-row">
        <img class="dial-pic" src="/img/web/${esc(s.product.id)}-640.webp" alt="">
        <div class="dial-read"><span class="dial-name">${esc(s.product.name)}</span><b class="dial-value" id="priceOut">${money2(base)}</b><span class="dial-was" id="priceWas">The price now</span></div>
      </div>
      <input class="slide" id="priceIn" type="range" min="${(base * 0.5).toFixed(2)}" max="${(base * 2).toFixed(2)}" step="${base >= 20 ? 1 : 0.5}" value="${base}" aria-label="New price">
      <div class="try-go"><button class="btn primary" id="priceGo" disabled>Set the price</button></div>`;
    wireModes();
    body.querySelectorAll("[data-product]").forEach((b) => b.addEventListener("click", () => { s.product = s.products.find((p) => p.id === b.dataset.product); paintPrice(); }));
    const input = body.querySelector("#priceIn");
    const go = body.querySelector("#priceGo");
    const show = () => {
      const v = Number(input.value);
      fill(input);
      body.querySelector("#priceOut").textContent = money2(v);
      const pct = Math.round((v / base - 1) * 100);
      body.querySelector("#priceWas").textContent = pct === 0 ? "The price now" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}% on ${money2(base)}`;
      go.disabled = v === base;
    };
    input.addEventListener("input", show);
    show();
    go.addEventListener("click", async () => {
      go.disabled = true;
      const k = Number(input.value) / base;
      // Every size and colour moves by the same share, so the range keeps its shape.
      const results = await Promise.all(variants.map((v) => world.call("change_price", { sku: v.sku, new_price: Math.round(v.price * k * 100) / 100, reason: REASON }, ACT)));
      const bad = results.find((x) => !x.ok);
      if (bad) { refused(bad.error.message); go.disabled = false; return; }
      done(`${s.product.name} now costs ${money2(Number(input.value))}.`);
      paintPrice();
    });
  }

  // ---------------------------------------------------------------- marketing

  async function paintMarketing() {
    const lv = s.levers || await levers();
    if (!lv) { body.innerHTML = `<p class="muted">The levers did not answer.</p>`; return; }
    const plan = lv.planned_marketing_per_month;
    const now = lv.marketing_per_month ?? plan;
    // The slider spans nothing to five times the plan, in steps fine enough that the plan itself can be chosen.
    const max = Math.max(100, Math.ceil((plan * 5) / 100) * 100);
    const step = max <= 2000 ? 1 : max <= 20000 ? 10 : 100;
    body.innerHTML = `
      <div class="dial-read big"><b class="dial-value" id="mkOut">${money(now)}</b><span class="dial-was" id="mkWas"></span></div>
      <div class="slide-wrap"><input class="slide" id="mkIn" type="range" min="0" max="${max}" step="${step}" value="${now}" aria-label="Marketing a month">
        <span class="slide-mark" style="--at:${(plan / max) * 100}%" title="The plan"></span></div>
      <div class="try-go"><button class="btn primary" id="mkGo" disabled>Spend this each month</button>${lv.marketing_per_month != null ? '<button class="btn ghost" id="mkReset">Back to the plan</button>' : ""}</div>`;
    const input = body.querySelector("#mkIn");
    const go = body.querySelector("#mkGo");
    const show = () => {
      const v = Number(input.value);
      fill(input);
      body.querySelector("#mkOut").textContent = money(v);
      body.querySelector("#mkWas").textContent = v === plan ? "A month, as planned" : v === 0 ? "A month. Nobody will hear about us." : `A month, against ${money(plan)} planned`;
      go.disabled = v === now;
    };
    input.addEventListener("input", show);
    show();
    go.addEventListener("click", async () => {
      go.disabled = true;
      const r = await world.call("set_marketing_budget", { monthly: Number(input.value) }, ACT);
      if (!r.ok) { refused(r.error.message); go.disabled = false; return; }
      s.levers = null;
      done(`Marketing is now ${money(Number(input.value))} a month, from tomorrow.`);
      paintMarketing();
    });
    body.querySelector("#mkReset")?.addEventListener("click", async () => {
      const r = await world.call("set_marketing_budget", { reset: true }, ACT);
      if (!r.ok) { refused(r.error.message); return; }
      s.levers = null;
      done("Marketing is back to the plan.");
      paintMarketing();
    });
  }

  // ---------------------------------------------------------------- hours

  async function paintHours() {
    const lv = s.levers || await levers();
    if (!lv) { body.innerHTML = `<p class="muted">The levers did not answer.</p>`; return; }
    s.person = lv.team.find((p) => p.id === s.person?.id) || lv.team.find((p) => p.role === "support_agent") || lv.team[0];
    const [lo, hi] = lv.limits?.weekly_hours || [0, 48];
    body.innerHTML = `
      <div class="team">${lv.team.map((p) => `<button type="button" class="pm-chip team-item" aria-pressed="${p.id === s.person.id}" data-person="${esc(p.id)}">${avatar(p.name, { size: 22 })}<span>${esc(p.name)}</span></button>`).join("")}</div>
      <div class="dial-read big"><span class="dial-name">${esc(s.person.name)}</span><b class="dial-value" id="hrOut"></b><span class="dial-was" id="hrWas"></span></div>
      <input class="slide" id="hrIn" type="range" min="${lo}" max="${hi}" step="1" value="${s.person.weekly_hours}" aria-label="Hours a week">
      <div class="try-go"><button class="btn primary" id="hrGo" disabled>Set the hours</button></div>`;
    body.querySelectorAll("[data-person]").forEach((b) => b.addEventListener("click", () => { s.person = lv.team.find((p) => p.id === b.dataset.person); paintHours(); }));
    const input = body.querySelector("#hrIn");
    const go = body.querySelector("#hrGo");
    const show = () => {
      const v = Number(input.value);
      fill(input);
      body.querySelector("#hrOut").textContent = plural(v, "hour");
      body.querySelector("#hrWas").textContent = v === s.person.weekly_hours ? `A week, at ${money2(s.person.hourly_pay)} an hour` : `A week, from ${num(s.person.weekly_hours)}. Pay follows the hours.`;
      go.disabled = v === s.person.weekly_hours;
    };
    input.addEventListener("input", show);
    show();
    go.addEventListener("click", async () => {
      go.disabled = true;
      const r = await world.call("set_staffing", { action: "hours", staff_id: s.person.id, weekly_hours: Number(input.value), reason: REASON }, ACT);
      if (!r.ok) { refused(r.error.message); go.disabled = false; return; }
      s.levers = null;
      done(`${s.person.name} now works ${plural(Number(input.value), "hour")} a week, from tomorrow.`);
      paintHours();
    });
  }

  // ---------------------------------------------------------------- an event

  async function paintEvent() {
    s.library ??= await world.eventLibrary();
    const pool = s.library.filter((e) => e.family !== "calendar");
    if (pool.length) {
      // A searchable list, not a shuffled hand of cards: you choose what happens, then make it happen.
      s.evQ ??= "";
      const q = s.evQ.toLowerCase();
      const list = pool.filter((e) => !q || `${e.title} ${e.headline || ""}`.toLowerCase().includes(q)).slice(0, 8);
      body.innerHTML = `<input class="input" id="evQ" type="search" placeholder="Find something to happen: a heatwave, a strike…" value="${esc(s.evQ)}" aria-label="Find an event">
        <ul class="cr-list ev-list">${list.map((e) => `<li class="ev-row"><span class="ev-text"><b>${esc(e.title)}</b><small>${esc(e.headline || "")}</small></span>
          <button type="button" class="btn small" data-template="${esc(e.id)}">Make it happen</button></li>`).join("") || `<li class="ev-none">Nothing matches. Try another word.</li>`}</ul>
        <p class="try-note">For more control (when it starts, how long, how strong) use the editor's desk in The Daily Overthinker.</p>`;
      const input = body.querySelector("#evQ");
      input.addEventListener("input", () => { s.evQ = input.value; const at = input.selectionStart; paintEvent().then(() => { const i = body.querySelector("#evQ"); i.focus(); i.setSelectionRange(at, at); }); });
      body.querySelectorAll("[data-template]").forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true;
        const r = await world.call("add_world_event", { template: b.dataset.template }, ACT);
        if (!r.ok) { refused(r.error.message); b.disabled = false; return; }
        b.textContent = "Happening";
        done(`${pool.find((e) => e.id === b.dataset.template)?.title || "It"} is happening. Move time on to see what it does.`);
      }));
      return;
    }
    // No library to choose from yet: make one up. A name, how much it moves demand, and for how long.
    body.innerHTML = `
      <input class="input ev-name" id="evName" maxlength="60" placeholder="A heatwave" aria-label="What happens">
      <div class="dial-read big"><b class="dial-value" id="evOut"></b><span class="dial-was">More or fewer people buy</span></div>
      <input class="slide" id="evIn" type="range" min="-60" max="100" step="5" value="25" aria-label="Change in demand">
      <div class="dial-read"><b class="dial-value small" id="evDays"></b><span class="dial-was">How long it lasts</span></div>
      <input class="slide" id="evLen" type="range" min="1" max="30" step="1" value="7" aria-label="Days it lasts">
      <div class="try-go"><button class="btn primary" id="evGo">Make it happen</button></div>`;
    const input = body.querySelector("#evIn");
    const len = body.querySelector("#evLen");
    const show = () => {
      fill(input);
      fill(len);
      const v = Number(input.value);
      body.querySelector("#evOut").textContent = v === 0 ? "No change" : `${v > 0 ? "+" : "−"}${Math.abs(v)}%`;
      body.querySelector("#evDays").textContent = plural(Number(len.value), "day");
    };
    input.addEventListener("input", show);
    len.addEventListener("input", show);
    show();
    body.querySelector("#evGo").addEventListener("click", async () => {
      const title = body.querySelector("#evName").value.trim() || "A heatwave";
      const v = Number(input.value);
      const r = await world.call("add_world_event", {
        title, headline: title, story: `${title}. People ${v >= 0 ? "buy more" : "buy less"} than usual while it lasts.`,
        effects: { demand: { all: Math.round((1 + v / 100) * 100) / 100 } }, duration_days: Number(len.value),
      }, ACT);
      if (!r.ok) { refused(r.error.message); return; }
      done(`${title}. Move time on to see what it does.`);
    });
  }

  // ---------------------------------------------------------------- a campaign

  /** Start a marketing campaign (create_campaign) and end one that is running (end_campaign). */
  async function paintCampaign() {
    const r = await world.call("list_campaigns", {}, AS);
    const all = r.ok ? (r.data.campaigns || r.data || []) : [];
    const running = (Array.isArray(all) ? all : []).filter((c) => !["ended", "finished", "cancelled"].includes(c.status));
    const today = (await world.clock()).now.slice(0, 10);
    body.innerHTML = `<div class="camp-form">
        <label class="field"><span>Name</span><input class="input" id="cpName" maxlength="60" value="Winter push"></label>
        <label class="field"><span>Where</span><select class="select" id="cpChannel"><option value="social">Social posts</option><option value="search">Search adverts</option><option value="email">Email</option></select></label>
        <label class="field"><span>Spend a month</span><input class="input" id="cpSpend" type="number" min="0" max="50000" step="50" value="500"></label>
        <label class="field"><span>For how many weeks</span><input class="input" id="cpWeeks" type="number" min="1" max="26" value="2"></label>
        <label class="field"><span>Discount code (optional)</span><input class="input" id="cpCode" maxlength="12" placeholder="WINTER10"></label>
        <label class="field"><span>Discount</span><select class="select" id="cpPct"><option value="0">None</option><option value="5">5%</option><option value="10">10%</option><option value="15">15%</option><option value="20">20%</option></select></label>
      </div>
      <div class="try-go"><button class="btn primary" id="cpGo">Start the campaign</button></div>
      ${running.length ? `<p class="try-sub">Running now</p><ul class="cr-list ev-list">${running.map((c) => `<li class="ev-row"><span class="ev-text"><b>${esc(c.name)}</b>
        <small>${esc(c.channel || "")}${c.monthly_spend != null ? ` · ${esc(money(c.monthly_spend))} a month` : ""}${c.end ? ` · until ${esc(shortDate(`${c.end}T12:00:00Z`))}` : ""}</small></span>
        <button type="button" class="btn small" data-end="${esc(c.id)}">End it</button></li>`).join("")}</ul>` : ""}`;
    body.querySelector("#cpGo").addEventListener("click", async (e) => {
      const go = e.currentTarget;
      const weeks = Math.max(1, Number(body.querySelector("#cpWeeks").value) || 1);
      const end = new Date(Date.parse(`${today}T12:00:00Z`) + (weeks * 7 - 1) * 864e5).toISOString().slice(0, 10);
      const code = body.querySelector("#cpCode").value.trim().toUpperCase();
      const pct = Number(body.querySelector("#cpPct").value);
      const input = { name: body.querySelector("#cpName").value.trim() || "A campaign", channel: body.querySelector("#cpChannel").value, start: today, end,
        monthly_spend: Number(body.querySelector("#cpSpend").value) || 0, ...(code && pct ? { code, discount_pct: pct } : {}) };
      go.disabled = true;
      const res = await world.call("create_campaign", input, ACT);
      go.disabled = false;
      if (!res.ok) { refused(res.error.message); return; }
      done(`${input.name} runs for ${plural(weeks, "week")} at ${money(input.monthly_spend)} a month. Move time on to see what it does.`);
      paintCampaign();
    });
    body.querySelectorAll("[data-end]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      const res = await world.call("end_campaign", { campaign_id: b.dataset.end }, ACT);
      if (!res.ok) { refused(res.error.message); b.disabled = false; return; }
      done("The campaign has ended. Its spending stops from tomorrow.");
      paintCampaign();
    }));
  }

  function paint() {
    said.textContent = "";
    ({ price: paintPrice, marketing: paintMarketing, hours: paintHours, campaign: paintCampaign, event: paintEvent })[s.tab]();
  }

  paint();
  return { refresh: () => { s.levers = null; if (s.tab !== "event" && s.tab !== "campaign") { const keep = said.innerHTML; const cls = said.className; paint(); said.innerHTML = keep; said.className = cls; } } };
}

/** Paints the part of a slider's track before the thumb, so the value reads as an amount. */
function fill(input) {
  const pct = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
  input.style.setProperty("--fill", `${pct}%`);
}

function money2(v) {
  return `£${Number(v).toFixed(2).replace(/\.00$/, "")}`;
}

