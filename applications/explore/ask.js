// The search/ask box in the top bar. "/" focuses it. It finds people, products, orders, stories, organisations and
// apps by name, and recognises "what if…" questions, which open a plan. All by rules: it never needs a model.
// A visitor may add their own model key (kept in this browser only, sent only to the model's maker, never to our
// server); then the what-if planner can also ask that model to read a free-form idea. Off by default.
import { esc } from "../lib/ui.js";
import { ex } from "./api.js";
import { clean, hrefFor } from "./parts.js";

const KEY = "ot-own-model";
const KIND_WORDS = { person: "Person", staff: "Team", product: "Product", order: "Order", news: "News", event: "Event", org: "Organisation", supplier: "Supplier",
  community: "Community", campaign: "Campaign", document: "Document", app: "App", company: "Business", case: "Case" };
const WHATIF = /^\s*(what if|what would happen|what happens if|if we|if the|suppose|imagine)\b/i;

/** The visitor's own model setting, or null. Never throws (storage may be blocked). */
export function ownModel() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); return v?.on && v.key ? v : null; } catch { return null; }
}
function saveModel(v) { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* blocked: off */ } }

export function mountAsk(root) {
  root.innerHTML = `
    <form class="ask" role="search" autocomplete="off">
      <label class="sr" for="askInput">Search the world, or ask what if</label>
      <input class="ask-in" id="askInput" type="search" placeholder="Search, or ask “what if…”" aria-controls="askList" aria-expanded="false" aria-autocomplete="list">
      <kbd class="ask-kbd" aria-hidden="true">/</kbd>
      <div class="ask-pop" id="askPop" hidden>
        <ul class="ask-list" id="askList" role="listbox" aria-label="Results"></ul>
        <div class="ask-foot"><button type="button" class="ask-model" id="askModel"></button></div>
        <div class="ask-set" id="askSet" hidden></div>
      </div>
    </form>`;
  const form = root.querySelector("form");
  const input = root.querySelector("#askInput");
  const pop = root.querySelector("#askPop");
  const list = root.querySelector("#askList");
  let items = [], sel = 0, timer = null, ask = 0;

  const modelLabel = () => { root.querySelector("#askModel").textContent = ownModel() ? "Your own model is on" : "Use your own model (optional)"; };
  modelLabel();

  function open(on) { pop.hidden = !on; input.setAttribute("aria-expanded", String(on)); if (!on) root.querySelector("#askSet").hidden = true; }

  function paint() {
    list.innerHTML = items.map((it, i) => `<li role="option" id="ask-${i}" aria-selected="${i === sel}"><a href="${esc(it.href)}" class="ask-row${it.whatif ? " is-whatif" : ""}" tabindex="-1">
      <span class="ask-kind">${esc(it.kindWord)}</span><span class="ask-t">${esc(it.title)}</span>${it.note ? `<span class="ask-n">${esc(it.note)}</span>` : ""}</a></li>`).join("")
      || `<li class="ask-none">${input.value.trim() ? "Nothing by that name. Try a first name, a product, or an order number." : "Type a name, a product, an order number, or “what if…”."}</li>`;
    input.setAttribute("aria-activedescendant", items.length ? `ask-${sel}` : "");
  }

  async function lookup() {
    const q = input.value.trim();
    const mine = ++ask;
    if (!q) { items = []; paint(); return; }
    const whatif = WHATIF.test(q) ? [{ whatif: true, kindWord: "What-if", title: q.replace(/\?*$/, "?"), note: "See the plan", href: `#/whatif?idea=${encodeURIComponent(q)}` }] : [];
    items = whatif;
    paint();
    const found = await ex("search", { q, limit: 8 }).catch(() => []);
    if (mine !== ask) return;
    items = [...whatif, ...found.map((r) => ({ kindWord: KIND_WORDS[r.kind] || "", title: clean(r.title), note: clean(r.note), href: hrefFor(r) }))];
    // A question that names nothing is probably an idea: offer to plan it last.
    if (!whatif.length && q.split(/\s+/).length >= 3 && found.length < 3) items.push({ whatif: true, kindWord: "What-if", title: `What if ${q.replace(/^\s*what if\s*/i, "")}`, note: "Plan it", href: `#/whatif?idea=${encodeURIComponent(q)}` });
    sel = 0;
    paint();
  }

  input.addEventListener("input", () => { open(true); clearTimeout(timer); timer = setTimeout(lookup, 110); });
  input.addEventListener("focus", () => { open(true); paint(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      paint();
    } else if (e.key === "Escape") { open(false); input.blur(); }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    const it = items[sel] || (q ? { href: `#/whatif?idea=${encodeURIComponent(q)}` } : null);
    if (!it) return;
    location.hash = it.href.slice(1);
    open(false);
    input.blur();
  });
  list.addEventListener("click", () => { open(false); input.blur(); });
  document.addEventListener("pointerdown", (e) => { if (!root.contains(e.target)) open(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.target.closest("input, textarea, select, [contenteditable]")) return;
    e.preventDefault();
    input.focus();
    input.select();
  });

  // ---- the visitor's own model: a key in this browser only
  root.querySelector("#askModel").addEventListener("click", () => {
    const set = root.querySelector("#askSet");
    const v = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
    set.hidden = false;
    set.innerHTML = `
      <p class="ask-set-t">Use your own model to read ideas the rules do not understand. It only turns your words into a plan you check before anything runs. It never writes a result.</p>
      <label class="ask-lab" for="askKey">Your Anthropic key</label>
      <input class="input" id="askKey" type="password" value="${esc(v.key || "")}" placeholder="sk-ant-…" autocomplete="off" spellcheck="false">
      <label class="ask-lab" for="askModelName">Model</label>
      <input class="input" id="askModelName" value="${esc(v.model || "claude-opus-5-5")}" spellcheck="false">
      <p class="ask-set-n">Kept in this browser only. Sent to Anthropic when you plan an idea, never to this server.</p>
      <div class="ask-set-b"><button type="button" class="btn small primary" id="askSave">Turn it on</button><button type="button" class="btn small" id="askOff">Turn it off</button><span class="ask-said" id="askSaid" aria-live="polite"></span></div>`;
    set.querySelector("#askSave").addEventListener("click", () => {
      const key = set.querySelector("#askKey").value.trim();
      if (!/^sk-ant-/.test(key)) { set.querySelector("#askSaid").textContent = "That does not look like a key."; return; }
      saveModel({ on: true, key, model: set.querySelector("#askModelName").value.trim() || "claude-opus-5-5" });
      set.querySelector("#askSaid").textContent = "On.";
      modelLabel();
    });
    set.querySelector("#askOff").addEventListener("click", () => { saveModel(null); set.querySelector("#askSaid").textContent = "Off. The key is gone from this browser."; modelLabel(); });
  });
}

/**
 * Asks the visitor's own model to turn an idea into experiment arms from the lab's catalogue. Only a suggestion for the
 * plan: the lab checks it like anything else, and nothing runs until the visitor presses Run.
 * @return {Promise<?Array<object>>} arms, or null
 */
export async function modelArms(idea, catalogue) {
  const m = ownModel();
  if (!m) return null;
  const prompt = `You turn a business "what if" idea into experiment arms for a simulated online shop. Use ONLY these intervention types and parameters:\n${JSON.stringify(catalogue.map(({ id, label, params }) => ({ id, label, params: Object.fromEntries(Object.entries(params).map(([k, p]) => [k, { type: p.type, default: p.default, min: p.min, max: p.max, choices: p.choices }])) })))}\n\nIdea: ${idea}\n\nAnswer with JSON only: {"arms":[{"id":"short-id","label":"plain words","interventions":[{"type":"...","params":{...}}]}]} with one to three arms. If no type fits, answer {"arms":[]}.`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": m.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: m.model, max_tokens: 4000, output_config: { effort: "low" }, messages: [{ role: "user", content: prompt }] }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message || `Your model answered ${res.status}.`);
  if (j.stop_reason === "refusal") return null;
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const json = text.match(/\{[\s\S]*\}/);
  try { return JSON.parse(json[0]).arms || null; } catch { return null; }
}
