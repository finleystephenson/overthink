// Overthought & Co. shop front: makes the static pages work in the browser.
// ALL business rules (prices, stock, eligibility, totals, refunds) come from the engine (engine.js) through
// session.call(tool, input) or quoteBasket. This file only draws screens, reads forms and calls the engine.
// The world is kept in localStorage so the shop remembers what you did. One ES module, no dependencies.
import { createWorld, loadState, quoteBasket } from "./engine.js";

const D = window.OT_DATA || {};

// ---------------------------------------------------------------- small helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// WHY: record ids ("ORD-2000191") are for the system; people read "Order 2000191". Links and data attributes keep the id.
const NO_WORDS = { ORD: "Order", RET: "Return", FIX: "Repair", BKG: "Booking", CASE: "Case", REG: "Registration" };
const plainNo = (n) => { const m = /^([A-Z]+)-0*(\d+)$/.exec(String(n ?? "")); return m ? `${NO_WORDS[m[1]] || ""} ${m[2]}`.trim() : String(n ?? ""); };
const bareNo = (n) => String(n ?? "").replace(/^[A-Z]+-0*/, "");
const money = (n) => "£" + (Number.isInteger(n) ? n : Number(n).toFixed(2));
const dateOf = (s) => { const d = new Date(String(s).length === 10 ? s + "T12:00:00Z" : s); return isNaN(d) ? String(s) : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); };
const dateTime = (s) => { const d = new Date(s); return isNaN(d) ? String(s) : d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }); };
const addDays = (day, n) => new Date(Date.parse(String(day).slice(0, 10) + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const label = (s) => String(s || "").replace(/_/g, " ");
const tag = (s) => `<span class="status">${esc(label(s))}</span>`;
const bad = (m) => `<div class="alert bad" role="alert">${esc(typeof m === "string" ? m : plain(m))}</div>`;
const good = (html) => `<div class="alert" role="status">${html}</div>`;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// Screen-reader announcements: one polite live region for the whole page.
function announce(msg) {
  let el = $("#ot-live");
  if (!el) { el = document.createElement("div"); el.id = "ot-live"; el.className = "vh"; el.setAttribute("aria-live", "polite"); document.body.append(el); }
  el.textContent = ""; setTimeout(() => (el.textContent = msg), 30);
}

// ---------------------------------------------------------------- storage (every access guarded)
const store = {
  get: (k) => { try { return localStorage.getItem("ot:" + k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem("ot:" + k, v); return true; } catch { return false; } },
  del: (k) => { try { localStorage.removeItem("ot:" + k); } catch { /* ignore */ } },
};
const jget = (k, d) => { try { const v = JSON.parse(store.get(k)); return v ?? d; } catch { return d; } };

// A fingerprint of the shop's data: saved state from older data is thrown away.
const VER = (() => { const s = JSON.stringify(D); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return s.length + ":" + h; })();

// ---------------------------------------------------------------- the world
let world, sess = null, custId = null, bag = [];
const MUTATING = new Set(["create_customer", "place_order", "cancel_order", "update_order", "create_return", "report_problem", "register_product", "create_repair", "approve_repair_quote", "create_booking", "reschedule_booking", "cancel_booking", "open_case", "add_case_note"]);

function initWorld() {
  const args = { business: D.business, products: D.products || [], services: D.services || [], policies: D.policies || [], help: D.help || [], seed: D.seed || {}, now: new Date().toISOString() };
  world = createWorld(args);
  const saved = jget("state", null);
  if (saved && saved.ver === VER && saved.state) {
    try { loadState(world, saved.state); world.setNow(args.now); } catch { world = createWorld(args); }
  }
  custId = store.get("cust");
  if (custId && !world.state.customers.some((c) => c.id === custId)) { custId = null; store.del("cust"); }
  // Drop anything in the bag that is no longer a real SKU.
  bag = jget("bag", []).filter((l) => l && l.qty >= 1 && (() => { try { quoteBasket(world, { items: [l], delivery_method: "", postcode: "" }); return true; } catch { return false; } })());
}
function save() {
  const st = world.state;
  if (st.audit.length > 300) st.audit.splice(0, st.audit.length - 300);
  store.set("state", JSON.stringify({ ver: VER, state: st }));
}
const session = () => (sess ||= world.session({ role: "customer", customer_id: custId }));
function call(tool, input = {}) {
  const r = session().call(tool, input);
  if (MUTATING.has(tool)) save(); // failures can change state too (a declined payment is recorded)
  return r;
}
function signIn(id) { custId = id; store.set("cust", id); sess = null; }
function signOut() { custId = null; store.del("cust"); sess = null; }
const me = () => (custId ? call("get_customer").data : null);

// The bag and the delivery choice.
const opts = jget("opts", { method: "" });
const saveOpts = () => store.set("opts", JSON.stringify(opts));
const bagCount = () => bag.reduce((n, l) => n + l.qty, 0);
// An empty bag forgets its made-up customer, so the next bag gets a new one (see who() below).
function saveBag() { store.set("bag", JSON.stringify(bag)); if (!bag.length) store.del("who"); updateCount(); }
function updateCount(bump) {
  $$("[data-bag-count]").forEach((e) => {
    e.textContent = bagCount();
    if (bump) { e.classList.remove("bump"); void e.offsetWidth; e.classList.add("bump"); } // springy bump, see site.css
  });
}
function addToBag(sku, qty) {
  qty = Math.max(1, Math.min(99, parseInt(qty, 10) || 1));
  const l = bag.find((x) => x.sku === sku);
  if (l) l.qty = Math.min(99, l.qty + qty); else bag.push({ sku, qty });
  saveBag(); updateCount(true); who(); // the first thing in the bag picks the made-up customer
}

// Names for SKUs, from the world's records.
let skuMap = null;
function skuInfo(sku) {
  if (!skuMap) {
    skuMap = {};
    for (const p of world.products) {
      for (const v of p.variants || []) skuMap[v.sku] = { name: `${p.name}, ${v.name}`, product: p };
      for (const a of p.accessories || []) skuMap[a.sku] = { name: `${p.name}: ${a.name}`, product: p };
    }
  }
  return skuMap[sku] || { name: sku, product: null };
}
// What a customer sees for a SKU: a name, the variant, a picture on its colour. Never the SKU itself.
const itemOf = (sku) => D.items?.[sku] || { name: skuInfo(sku).name, sub: "", src: "", ground: "#E9E6E0", href: "shop.html" };
const skuName = (sku) => { const it = itemOf(sku); return it.sub ? `${it.name}, ${it.sub}` : it.name; };
const SPIRAL = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3a9 9 0 1 1-9 9 6.5 6.5 0 0 1 6.5-6.5 4.5 4.5 0 0 1 4.5 4.5"/></svg>`;
// Cut-out pictures get a small shadow on the item's colour; the few framed ones fill their tile (site.css).
const picImg = (it) => (it.src ? `<img class="${it.cut ? "cut" : "framed"}" src="${esc(it.src)}" alt="" loading="lazy">` : "");
const mini = (sku, cls = "mini") => { const it = itemOf(sku); return `<span class="${cls}" style="--c:${esc(it.ground)}">${picImg(it)}</span>`; };
// Engine messages are written for staff and AI tools; customers get the same facts in plain words, with names not codes.
const OK_CARD = () => (D.business.payments.test_cards || []).find((t) => t.result === "paid")?.number || "4242 4242 4242 4242";
function plain(err) {
  const m = String(err?.message || "Something went wrong. Please try again.");
  if (err?.code === "out_of_stock") return "Something in your bag has just sold out. Go back to your bag to change it.";
  if (/insufficient/i.test(m)) return "Your card was declined: there isn't enough money on it. Try another card.";
  if (/declined/i.test(m)) return "Your card was declined. Try another card.";
  if (/Only the test cards/i.test(m)) return `That card number didn't work. Use the test card, ${OK_CARD()}.`;
  if (/already exists/i.test(m)) return "There's already an account with that email. Use another email, or sign in under Your orders first.";
  if (/cannot be used for this (basket|order)/i.test(m)) return "That delivery option isn't available for this address. Choose another one.";
  return m.replace(/\bOT-[A-Z0-9-]+/g, (x) => skuName(x));
}

// Price the bag through the engine. If the chosen method is not allowed, fall back to the first allowed one and say so.
function basket(postcode, method) {
  const quote = (m) => { try { return quoteBasket(world, { items: bag, delivery_method: m || "", postcode: postcode || "" }); } catch { return null; } };
  let q = quote(method);
  if (!q) return null;
  let notice = "";
  if (q.methods.length && !q.methods.some((m) => m.id === method)) {
    if (method) notice = "That delivery method isn't available for this bag, so another has been chosen.";
    q = quote(q.methods[0].id);
  }
  return { q, method: q.delivery_method, notice };
}
const methodNote = (b) => {
  const out = [];
  if (!b.q.reachable) out.push(D.business.delivery.area);
  if (b.notice) out.push(b.notice);
  if (!b.q.methods.length && bag.length) out.push("No delivery method is available for this bag.");
  return out;
};
// Delivery as choice cards: name, price and the method's one-line `explain` from business.json (else its `time`).
// Which methods show is the engine's call: only Cold for chilled things, never Cold without them.
const explainOf = (m) => D.business.delivery.methods.find((x) => x.id === m.id)?.explain || m.explain || m.time || "";
// A bag with chilled and ordinary things travels as two parcels (the engine marks the method parcels: 2).
const MIXED = "Cold things travel in their own chilly parcel, and everything else comes in a second one. You pay one delivery charge.";
const parcelsHtml = (b) => (b.q.methods.some((m) => m.parcels === 2)
  ? `<div class="parcels"><div class="parcel-pics" aria-hidden="true"><span class="parcel cold"><b>Cold</b></span><span class="parcel warm"><b>Warm</b></span></div><p>${esc(D.business.delivery.mixed_explain || MIXED)}</p></div>` : "");
const methodCards = (b) => `<fieldset class="choices"><legend class="vh">Delivery</legend>${b.q.methods.map((m) => `<label class="choice"><input type="radio" name="method" value="${esc(m.id)}" ${m.id === b.method ? "checked" : ""}><span class="choice-top"><b>${esc(m.name)}</b><span class="choice-price">${m.price ? money(m.price) : "Free"}</span></span><small>${esc(explainOf(m))}</small></label>`).join("")}</fieldset>`
  + parcelsHtml(b) + methodNote(b).map((n) => `<p class="note">${esc(n)}</p>`).join("");

const ARROW = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const EMPTY_BAG = `<div class="empty"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8.5h14l-1.2 11.5H6.2L5 8.5z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/></svg><p><strong>Your bag is empty.</strong></p><p class="muted">Nothing in here yet. Everything we make is on one page.</p><p><a class="btn" href="shop.html">Go to the shop</a></p></div>`;

// ---------------------------------------------------------------- shared forms
const field = (name, lab, extra = "", val = "") => `<div class="field"><label for="f-${name}">${lab}</label><input id="f-${name}" name="${name}" value="${esc(val)}" ${extra}></div>`;
// Name/email/phone/address: only asked when nobody is signed in.
// noAddress: checkout asks for the delivery address once and reuses it for the account.
function customerFields(noAddress = false) {
  if (custId) { const c = me(); return `<p class="note">Signed in as <strong>${esc(c?.name)}</strong> (${esc(c?.email)}). <a href="account.html#orders">Your orders</a></p>`; }
  if (noAddress) return `<div class="row2">${field("name", "Your name", 'required autocomplete="name"')}${field("email", "Email", 'type="email" required autocomplete="email"')}</div>
`;
  return `<div class="row2">${field("name", "Your name", 'required autocomplete="name"')}${field("email", "Email", 'type="email" required autocomplete="email"')}</div>
    <div class="row2">${field("phone", "Phone", 'type="tel" autocomplete="tel"')}${field("line1", "Address line", 'required autocomplete="address-line1"')}</div>
    <div class="row2">${field("town", "Town", 'required autocomplete="address-level2"')}${field("postcode", "Postcode", 'required autocomplete="postal-code"')}</div>`;
}
// Sign-up when needed. Returns { ok } or the engine's error.
function ensureCustomer(fd) {
  if (custId) return { ok: true };
  const v = (k) => String(fd.get(k) || "").trim();
  const r = call("create_customer", { name: v("name"), email: v("email"), phone: v("phone"), address: { line1: v("line1"), town: v("town"), postcode: v("postcode") } });
  if (r.ok) signIn(r.data.id);
  return r;
}
// Wire delegated events on a root: data-act clicks, data-form submits, change/input hooks.
function wire(root, h) {
  root.addEventListener("click", (e) => { const t = e.target.closest("[data-act]"); if (t && root.contains(t)) { if (t.tagName === "A" && !t.dataset.act) return; h.click?.(t.dataset.act, t, e); } });
  root.addEventListener("submit", (e) => { const f = e.target.closest("form[data-form]"); if (f) { e.preventDefault(); h.submit?.(f.dataset.form, f, new FormData(f)); } });
  root.addEventListener("change", (e) => h.change?.(e.target, e));
  root.addEventListener("input", (e) => h.input?.(e.target, e));
}
const draw = (root, html, focus) => { root.innerHTML = html; if (focus) $(focus, root)?.focus(); };

// ---------------------------------------------------------------- product page
const LOW_STOCK = 5; // wording only: "Only N left" is shown at or below this
function initProduct(root) {
  const p = world.products.find((x) => x.id === root.dataset.product); if (!p) return;
  const pre = p.status === "preorder";
  const sel = {};
  $$("[data-option]", root).forEach((g) => { sel[g.dataset.option] = $("[aria-pressed=true]", g)?.dataset.value ?? $("[data-value]", g)?.dataset.value; });
  const add = $("[data-add]", root), qty = $("[data-qty]", root);
  const live = document.createElement("p"); live.className = "added-note"; live.setAttribute("aria-live", "polite"); $(".buyrow", root)?.after(live);
  const lbl = $(".add-lbl", add), lbl0 = lbl?.textContent;
  let cur = null;

  function update() {
    const st = Object.fromEntries(p.variants.map((v) => [v.sku, call("check_stock", { sku: v.sku }).data || {}]));
    cur = p.variants.find((v) => Object.entries(sel).every(([k, val]) => v.options[k] === val)) || null;
    // An option value is "sold out" when no variant with it (and the other chosen options) is in stock.
    $$("[data-option]", root).forEach((g) => {
      const name = g.dataset.option;
      $$("[data-value]", g).forEach((b) => {
        const ok = p.variants.some((v) => v.options[name] === b.dataset.value && Object.entries(sel).every(([k, x]) => k === name || v.options[k] === x) && (pre || st[v.sku].in_stock));
        b.classList.toggle("soldout", !ok); b.title = ok ? "" : "Not available in this combination right now";
        b.setAttribute("aria-pressed", String(sel[name] === b.dataset.value));
      });
    });
    const stockEl = $("[data-stock]", root);
    if (!cur) { stockEl.textContent = "Not available in that combination"; stockEl.className = "stock out"; add.disabled = true; return; }
    const s = st[cur.sku];
    $("[data-price]", root).textContent = money(cur.price);
    let text, cls = "stock";
    if (pre) text = `Pre-order, ships from ${dateOf(p.available_from)}`;
    else if (!s.in_stock) { text = s.restock_date ? `Sold out. Back on ${dateOf(s.restock_date)}` : "Sold out for now"; cls += " out"; }
    else if (s.on_hand <= LOW_STOCK) { text = `Only ${s.on_hand} left`; cls += " low"; }
    else text = "In stock";
    stockEl.textContent = text; stockEl.className = cls;
    add.disabled = !pre && !s.in_stock;
    if (lbl) lbl.textContent = add.disabled ? "Sold out for now" : lbl0;
  }
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-value]");
    if (b) { sel[b.closest("[data-option]").dataset.option] = b.dataset.value; update(); return; }
    const step = e.target.closest("[data-step]");
    if (step) { qty.value = Math.max(1, Math.min(20, (parseInt(qty.value, 10) || 1) + Number(step.dataset.step))); return; }
    if (e.target.closest("[data-add]") && cur && !add.disabled) {
      const n = Math.max(1, Math.min(20, parseInt(qty.value, 10) || 1));
      addToBag(cur.sku, n);
      // The button turns into a drawn tick for a moment (site.css: .add.is-added), then returns.
      add.classList.remove("is-added"); void add.offsetWidth; add.classList.add("is-added");
      clearTimeout(add._t); add._t = setTimeout(() => add.classList.remove("is-added"), 1800);
      live.innerHTML = `Added ${n} × ${esc(p.variants.length > 1 ? `${p.name}, ${cur.name}` : p.name)}. <a href="bag.html">View bag</a>`;
    }
  });
  update();
}
// Accessory "Add" buttons (product pages, the shop's Extras, accessory pages). The same tick as the main button.
function initAccessories() {
  const stock = (sku) => call("check_stock", { sku }).data;
  const soldOut = (b) => { b.disabled = true; const l = $(".add-lbl", b); if (l) l.textContent = "Sold out"; };
  $$("[data-add-sku]").forEach((b) => { const s = stock(b.dataset.addSku); if (s && !s.in_stock) soldOut(b); });
  const page = $("[data-acc]"), pill = $("[data-acc-stock]");
  if (page && pill) {
    const s = stock(page.dataset.acc);
    if (s) { pill.textContent = s.in_stock ? (s.on_hand <= LOW_STOCK ? `Only ${s.on_hand} left` : "In stock") : s.restock_date ? `Sold out. Back on ${dateOf(s.restock_date)}` : "Sold out for now"; pill.className = `stock${s.in_stock ? (s.on_hand <= LOW_STOCK ? " low" : "") : " out"}`; }
  }
  let note = null;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-add-sku]"); if (!b || b.disabled) return;
    const sku = b.dataset.addSku, s = stock(sku);
    if (!s || !s.in_stock) { soldOut(b); announce("Sorry, that has just sold out."); return; }
    addToBag(sku, 1);
    b.classList.remove("is-added"); void b.offsetWidth; b.classList.add("is-added");
    clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove("is-added"), 1800);
    if (page && page.contains(b)) {
      note ||= Object.assign(document.createElement("p"), { className: "added-note" }); note.setAttribute("aria-live", "polite"); b.closest(".buyrow").after(note);
      note.innerHTML = `Added ${esc(skuName(sku))}. <a href="bag.html">View bag</a>`;
    } else announce(`Added ${skuName(sku)} to your bag.`);
  });
}

// ---------------------------------------------------------------- help page
function initHelp() {
  const search = $("[data-help-search]"), items = $$("[data-help]"), groups = $$("[data-group]"), list = $("[data-help-list]");
  const empty = $("[data-help-empty]"), prods = $("[data-help-products]"), head = $("[data-help-count]"), reset = $("[data-help-reset]");
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let topic = "";
  const q0 = new URLSearchParams(location.search).get("q"); if (q0) search.value = q0;
  function apply() {
    const q = search.value.trim(), words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let n = 0;
    for (const h of items) {
      const ok = (!topic || h.dataset.topic === topic) && words.every((w) => h.dataset.text.includes(w));
      h.hidden = !ok; if (!ok) h.open = false; else n++;
    }
    // Grouped under topic headings until someone searches; empty groups disappear.
    groups.forEach((g) => (g.hidden = !$$("[data-help]", g).some((h) => !h.hidden)));
    list.classList.toggle("searching", !!q);
    $$("[data-topic-btn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.topicBtn === topic)));
    let found = [];
    if (q.length > 1) { const r = call("search_catalogue", { query: q }); found = (r.data?.results || []).filter((x) => x.kind === "product" && (n === 0 || words.some((w) => w.length > 2 && x.name.toLowerCase().includes(w)))).slice(0, 3); } // when the search names a product, or nothing else matched
    prods.innerHTML = found.length ? `<ul class="list" style="margin-bottom:22px">${found.map((x) => `<li><div class="grow"><a href="${esc(x.id)}.html"><b>${esc(x.name)}</b></a><p class="muted" style="margin:4px 0 0">${esc(x.summary)}</p></div>${x.price ? `<span class="price">${x.price.from === x.price.to ? money(x.price.from) : "From " + money(x.price.from)}</span>` : ""}</li>`).join("")}</ul>` : "";
    empty.hidden = n > 0 || found.length > 0;
    reset.hidden = !q && !topic;
    const name = topic && $(`[data-topic-btn="${topic}"] b`)?.textContent;
    head.textContent = q ? `${plural(n, "answer")} for “${q}”${name ? ` in ${name}` : ""}` : topic ? `${name}: ${plural(n, "answer")}` : `All ${plural(n, "answer")}`;
    if (q && n === 1) items.find((h) => !h.hidden).open = true;
  }
  search.addEventListener("input", apply);
  search.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $(".answers").scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" }); } });
  $$("[data-topic-btn]").forEach((b) => b.addEventListener("click", () => {
    topic = topic === b.dataset.topicBtn ? "" : b.dataset.topicBtn; apply();
    const top = $(".answers").getBoundingClientRect().top;
    if (topic && top > innerHeight * 0.75) $(".answers").scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  }));
  reset.addEventListener("click", () => { topic = ""; search.value = ""; apply(); search.focus(); });
  apply();
}

// ---------------------------------------------------------------- bag
function initBag(root) {
  let focus = null;
  function render() {
    if (!bag.length) { draw(root, EMPTY_BAG); return; }
    const person = who(); // made up; nobody types an address on this site
    const b = basket(person.postcode, opts.method); if (!b) { draw(root, bad("Something in your bag could not be priced. Clear the bag and try again.")); return; }
    const lines = b.q.lines.map((l) => {
      const s = call("check_stock", { sku: l.sku }).data, pre = skuInfo(l.sku).product?.status === "preorder";
      const warn = !pre && s && s.on_hand < l.qty ? `<p class="note" style="margin:4px 0 0;color:var(--signal)">${s.on_hand ? `Only ${s.on_hand} in stock.` : "Out of stock."} Reduce the quantity or remove it before checkout.</p>` : "";
      const it = itemOf(l.sku), nm = skuName(l.sku);
      return `<li class="bagline"><a class="thumb" href="${esc(it.href)}" style="--c:${esc(it.ground)}" tabindex="-1" aria-hidden="true">${it.src ? picImg(it) : SPIRAL}</a>
        <div class="grow"><b><a href="${esc(it.href)}">${esc(it.name)}</a></b>${it.sub ? `<br><span class="each">${esc(it.sub)}</span>` : it.fits ? `<br><span class="each">${esc(it.fits)}</span>` : ""}<br><span class="each">${money(l.unit_price)} each</span>${warn}</div>
        <div class="line-end"><span class="line-total">${money(l.line_total)}</span>
        <span class="stepper"><button class="btn small ghost" data-act="dec" data-sku="${esc(l.sku)}" aria-label="One fewer ${esc(nm)}">−</button><span class="mono" aria-label="Quantity">${l.qty}</span><button class="btn small ghost" data-act="inc" data-sku="${esc(l.sku)}" aria-label="One more ${esc(nm)}">+</button></span>
        <button class="linkbtn" data-act="rm" data-sku="${esc(l.sku)}" aria-label="Remove ${esc(nm)}">Remove</button></div></li>`;
    }).join("");
    draw(root, `<div class="work"><div><ul class="list">${lines}</ul><p style="margin-top:18px"><button class="linkbtn" data-act="clear">Empty the bag</button></p></div>
      <aside class="panel" aria-label="Order summary"><h3>Delivery and total</h3>
      <div class="sendto"><p aria-live="polite">Sending to <b>${esc(person.name)}</b>, ${esc(person.town)} ${esc(person.postcode)}</p><button type="button" class="btn small ghost" data-act="random">${DICE_ICON} Randomise</button></div>
      ${methodCards(b)}
      <table class="sum" style="margin-top:14px"><tbody><tr><td>Items</td><td>${money(b.q.items_total)}</td></tr><tr><td>Delivery</td><td>${b.q.delivery_charge == null ? "n/a" : b.q.delivery_charge ? money(b.q.delivery_charge) : "Free"}</td></tr><tr class="total"><td>Total</td><td>${b.q.total == null ? "n/a" : money(b.q.total)}</td></tr></tbody></table>
      <p style="margin-top:16px">${b.q.total == null ? `<button class="btn" style="width:100%" disabled>Go to checkout</button>` : `<a class="btn" style="width:100%" href="checkout.html">Go to checkout ${ARROW}</a>`}</p></aside></div>`, focus); focus = null;
  }
  wire(root, {
    click(act, t) {
      const l = bag.find((x) => x.sku === t.dataset.sku);
      if (act === "inc" && l) { l.qty = Math.min(99, l.qty + 1); focus = `[data-act=inc][data-sku="${l.sku}"]`; }
      else if (act === "dec" && l) { l.qty -= 1; focus = `[data-act=dec][data-sku="${l.sku}"]`; if (l.qty < 1) { bag = bag.filter((x) => x !== l); focus = null; } }
      else if (act === "rm") { bag = bag.filter((x) => x !== l); announce("Removed from your bag."); }
      else if (act === "clear") bag = [];
      else if (act === "random") { who(true); focus = "[data-act=random]"; render(); return; }
      else return;
      saveBag(); render();
    },
    change(t) { if (t.name === "method") { opts.method = t.value; saveOpts(); focus = "[name=method]:checked"; render(); } },
  });
  render();
}

// ---------------------------------------------------------------- checkout
// Nobody types their own details here. Checkout shows a made-up customer from this list (public-domain characters
// and places only) and "Randomise" picks another. Postcodes use invented areas the engine delivers to; any that
// fall in an excluded area (business.json delivery.excluded_postcode_prefixes) are skipped.
const PEOPLE = [
  ["Sherlock Holmes", "221B Baker Street", "London", "BK2 21B", "sherlock.holmes", "221"],
  ["Alice Liddell", "1 Rabbit Hole", "Wonderland", "WL1 1AA", "alice.liddell", "101"],
  ["Robin Hood", "The Major Oak", "Sherwood Forest", "SF1 1RH", "robin.hood", "111"],
  ["Dorothy Gale", "The Farmhouse, Yellow Brick Road", "Oz", "OZ1 1YB", "dorothy.gale", "123"],
  ["Long John Silver", "The Spyglass Inn", "Treasure Island", "TI1 1XX", "long.john.silver", "150"],
  ["Captain Nemo", "The Nautilus, Twenty Thousand Leagues Down", "Under the Sea", "NA2 0LS", "captain.nemo", "200"],
  ["Ebenezer Scrooge", "The Counting House (unheated)", "London", "XM1 1AS", "ebenezer.scrooge", "124"],
  ["Dr Henry Jekyll", "The Laboratory, Round the Back", "Soho", "JH1 1DE", "henry.jekyll", "186"],
  ["King Arthur", "The Round Table, Great Hall", "Camelot", "AR1 7RT", "king.arthur", "537"],
  ["Elizabeth Bennet", "Longbourn House", "Meryton", "MY1 1PP", "elizabeth.bennet", "813"],
  ["Peter Rabbit", "The Sand-bank under the Fir Tree", "The Lake District", "RB1 1CP", "peter.rabbit", "902"],
  ["Mr Toad", "Toad Hall (poop-poop)", "The Riverbank", "TH1 1PP", "mr.toad", "908"],
  ["Count Dracula", "Castle Dracula, Borgo Pass", "Transylvania", "DR4 1CU", "count.dracula", "897"],
  ["Victor Frankenstein", "The Attic Laboratory", "Ingolstadt", "FV1 1IT", "victor.frankenstein", "818"],
  ["Phileas Fogg", "7 Savile Row (back in 80 days)", "London", "PF8 0DY", "phileas.fogg", "872"],
  ["Tom Sawyer", "The Freshly Whitewashed Fence", "St Petersburg, Missouri", "FN1 1CE", "tom.sawyer", "876"],
  ["The Mad Hatter", "The Tea Table (it's always six o'clock)", "Wonderland", "WL6 6TE", "mad.hatter", "865"],
  ["Robinson Crusoe", "The Hut on the Beach", "Desert Island", "DI1 1FR", "robinson.crusoe", "719"],
  ["Oliver Twist", "A Back Room off Saffron Hill", "London", "OT1 2MO", "oliver.twist", "838"],
  ["Jane Eyre", "Thornfield Hall", "Millcote", "EY1 1RE", "jane.eyre", "847"],
  ["Lemuel Gulliver", "A Very Small House", "Lilliput", "LP1 1GT", "lemuel.gulliver", "726"],
  ["Don Quixote", "The Windmill (definitely a giant)", "La Mancha", "QX1 1DQ", "don.quixote", "605"],
  ["Sinbad the Sailor", "The Harbour, Seventh Voyage", "Basra", "SV7 7SB", "sinbad", "777"],
  ["Rip Van Winkle", "Under a Tree (please don't wake him)", "Catskill Mountains", "ZZ2 0YR", "rip.van.winkle", "820"],
  ["Captain Ahab", "The Pequod, Somewhere at Sea", "Nantucket", "WH1 1LE", "captain.ahab", "851"],
  ["Little Red Riding Hood", "Grandmother's Cottage, The Woods", "Over the River", "GM1 1WF", "red.riding.hood", "697"],
  ["Gretel", "The Gingerbread House", "The Deep Dark Forest", "GB1 1CK", "gretel", "812"],
].map(([name, line1, town, postcode, user, n]) => ({ name, line1, town, postcode, email: `${user}@example.com`, phone: `07700 900${n}` }))
  .filter((p) => !(D.business?.delivery?.excluded_postcode_prefixes || []).includes(p.postcode.match(/^[A-Z]{1,2}/)?.[0]));
const pickPerson = (not) => { const pool = PEOPLE.filter((p) => p !== not); return pool[Math.floor(Math.random() * pool.length)]; };
// The made-up customer for this bag: picked once when the bag first has something in it, kept (by name) until the
// bag is empty again, shown on the bag and at checkout. who(true) is Randomise. Delivery is quoted to their postcode.
function who(fresh = false) {
  const cur = PEOPLE.find((p) => p.name === store.get("who"));
  if (cur && !fresh) return cur;
  const p = pickPerson(cur);
  store.set("who", p.name);
  return p;
}

// Test cards from business.payments.test_cards: { number, brand, label, result, message }, result paid, declined
// or needs_check. Older data ({ number, result } only) still works: brand and label are worked out from it.
// Whether a card works is always the engine's decision (place_order); this only chooses which test card to send.
const brandOf = (n) => { const d = String(n).replace(/\D/g, ""); return /^4/.test(d) ? "Visa" : /^(5[1-5]|2[2-7])/.test(d) ? "Mastercard" : /^3[47]/.test(d) ? "American Express" : "Card"; };
const kindOf = (r) => (/^paid/i.test(r) ? "paid" : /check/i.test(r) ? "check" : "declined");
const labelOf = (r) => (/insufficient/i.test(r) ? "Not enough money" : /^declined/i.test(r) ? "Card declined" : /check/i.test(r) ? "Bank wants to check" : "Payment works");
const TEST_CARDS = (D.business?.payments?.test_cards || []).filter((c) => c && c.number).map((c) => {
  const r = String(c.result || ""), last4 = String(c.number).replace(/\D/g, "").slice(-4);
  const label = c.label || labelOf(r);
  // A made-up expiry: past for an "Expired" card, a few years ahead for the rest.
  const yy = new Date().getUTCFullYear() % 100, mm = String((parseInt(last4, 10) % 12) + 1).padStart(2, "0");
  const expired = /expir/i.test(`${label} ${c.message || ""}`);
  return { number: c.number, brand: c.brand || brandOf(c.number), label, kind: kindOf(r), message: c.message || "", last4, expiry: `${mm}/${expired ? yy - 2 : yy + 3}` };
});
// The three card brands: one working test card per brand. Only brands with a working card are offered.
const BRANDS = ["Visa", "Mastercard", "American Express"].map((b) => TEST_CARDS.find((c) => c.kind === "paid" && c.brand === b)).filter(Boolean);
const brandKey = (b) => String(b).toLowerCase().replace(/[^a-z]+/g, "-");
// What a customer reads when a payment doesn't go through: a short headline and what to do next. The engine's message
// is written for staff and AI tools too ("Order ORD-… was saved as payment_failed"), so only its customer part is used.
const customerPart = (m) => String(m || "").replace(/\s*(The order was saved|Order ORD-)[^]*$/, "").trim();
function payProblem(message, card) {
  const m = customerPart(message || card?.message);
  const head = /bank wants to check/i.test(m) ? "Your bank wants to check this with you." : /expired/i.test(m) ? "That card has expired."
    : /not have enough money|insufficient/i.test(m) ? "That card doesn't have enough money on it." : /security code/i.test(m) ? "The security code didn't match."
    : /went wrong/i.test(m) ? "Something went wrong at the bank." : /declined/i.test(m) ? "That card was declined." : m.split(/(?<=\.)\s/)[0] || "That card didn't go through.";
  return { head, tip: "Try another card. No money was taken." };
}
// Any other way to pay: its own message, first sentence as the headline and the rest as what to do.
function methodProblem(message) {
  const [head, ...rest] = customerPart(message).split(/(?<=\.)\s/);
  return { head: head || "That didn't go through.", tip: rest.join(" ") || "Nothing was paid. Try again, or choose another way to pay." };
}
const dayMonth = (d) => { const t = new Date(String(d).slice(0, 10) + "T12:00:00Z"); return isNaN(t) ? String(d) : t.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }); };
const TICK = `<svg class="tick" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

function initCheckout(root) {
  if (!bag.length) { draw(root, EMPTY_BAG); return; }
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => (calm ? Math.min(ms, 250) : ms);
  let method = opts.method, person = who(), anim = "", total = 0;
  // The ways to pay, and which this bag can use, come from the engine (payment_methods). pm: the method chosen.
  // brand: the working card for the brand chosen (Visa to begin with). Payments always use a card that works.
  // stage: the little moment each method draws ("idle", then e.g. "confirm", "open", "checking", "ok", "fail").
  let methods = [], pm = null, brand = BRANDS[0] || null, problem = null, stage = "idle", stageText = "";
  const loadMethods = () => {
    const b = basket(person.postcode, method);
    const r = call("payment_methods", { ...(b ? { basket_total: b.q.items_total } : {}), skus: [...new Set(bag.map((l) => l.sku))] });
    // The website shows only the methods switched on in build.mjs (SITE_PAYMENT_METHODS); the engine keeps them all.
    const shown = D.flags?.payment_methods;
    methods = (r.ok ? r.data.methods : []).filter((m) => !Array.isArray(shown) || shown.includes(m.id));
    total = b?.q.total ?? 0;
    // Just one way to pay (card, for now): it is simply the way to pay, with no choice to make.
    if (methods.length === 1 && methods[0].available) pm = methods[0].id;
  };
  const single = () => methods.length === 1;
  const M = () => methods.find((m) => m.id === pm);
  const shownCard = () => brand;
  const personHtml = () => `<div class="who-name">${esc(person.name)}</div>
    <dl class="who-list"><div><dt>Address</dt><dd>${esc(person.line1)}<br>${esc(person.town)}<br>${esc(person.postcode)}</dd></div>
    <div><dt>Email</dt><dd>${esc(person.email).replace("@", "<wbr>@")}</dd></div><div><dt>Phone</dt><dd>${esc(person.phone)}</dd></div></dl>`;
  // The drawn card: flips to the chosen brand, with the made-up customer's name on it.
  const payCard = () => {
    const c = shownCard();
    const num = c ? (c.brand === "American Express" ? `•••• •••••• •${c.last4}` : `•••• •••• •••• ${c.last4}`) : "•••• •••• •••• ••••";
    return `<div class="paycard${c ? ` b-${brandKey(c.brand)}` : " blank"}${anim ? ` ${anim}` : ""}">
      <div class="pc-top"><span class="pc-chip" aria-hidden="true"></span><span class="pc-brand">${c ? esc(c.brand) : ""}</span></div>
      <div class="pc-num" aria-label="${c ? `${esc(c.brand)} ending ${esc(c.last4)}` : "No card chosen"}">${num}</div>
      <div class="pc-foot"><div><small>Name</small><b>${esc(person.name)}</b></div><div><small>Expires</small><b>${c ? esc(c.expiry) : "--/--"}</b></div></div></div>`;
  };
  // Each other way to pay has its own small moment, drawn by kind. Words come from the method and the engine.
  const stageHtml = (m) => {
    const amount = money(total);
    if (m.kind === "wallet") {
      const screen = { idle: `<p class="ph-say">Press <b>Place order</b>, then look at your phone.</p>`,
        confirm: `<div class="ph-ring" aria-hidden="true"></div><p class="ph-say">Confirm on your phone…</p>`,
        ok: `<div class="ph-done">${TICK}</div><p class="ph-say"><b>Done</b></p>`,
        fail: `<div class="ph-bad" aria-hidden="true">!</div><p class="ph-say">${esc(stageText)}</p>` }[stage];
      return `<div class="phone s-${stage}${anim ? ` ${anim}` : ""}" role="img" aria-label="${esc(m.name)} on your phone"><div class="ph-screen"><span class="ph-notch" aria-hidden="true"></span>
        <p class="ph-name">${esc(m.name)}</p><p class="ph-amt">${amount}</p><p class="ph-to">to Overthought &amp; Co.</p>${screen}<span class="ph-side" aria-hidden="true"></span></div></div>`;
    }
    if (m.kind === "account") {
      const body = { idle: `<p>When you place the order, ${esc(m.name)} opens here so you can log in and approve.</p>`,
        open: `<p class="ac-who">Logged in as <b>${esc(person.email)}</b></p><p class="ac-pay">Pay Overthought &amp; Co. <b>${amount}</b></p><div class="ac-btns"><button type="button" class="btn small" data-act="approve">Approve</button><button type="button" class="btn small ghost" data-act="close">Close</button></div>`,
        closing: `<p>The window is closing…</p>`, working: `<p>Approving…</p>`,
        ok: `<div class="ac-done">${TICK}<b>Approved</b></div>`, fail: `<p class="ac-bad">${esc(stageText)}</p>` }[stage];
      return `<div class="acct s-${stage}${anim ? ` ${anim}` : ""}"><div class="ac-bar"><i></i><i></i><i></i><span>${esc(m.name)}${stage === "idle" ? "" : ": log in and approve"}</span></div><div class="ac-body" aria-live="polite">${body}</div></div>`;
    }
    if (m.kind === "pay_later") {
      const body = { idle: `<div class="lt-split"><div><small>Today</small><b>£0</b></div><div><small>In ${esc(m.due_in_days || 30)} days</small><b>${amount}</b></div></div><p>A quick check decides when you place the order.</p>`,
        checking: `<div class="lt-bar" aria-hidden="true"><i></i></div><p>Checking…</p>`,
        ok: `<div class="lt-ok">${TICK}<b>Approved</b></div><p>${esc(stageText)}</p>`,
        fail: `<p class="lt-no"><b>Not this time.</b></p><p>${esc(stageText)}</p>` }[stage];
      return `<div class="later s-${stage}${anim ? ` ${anim}` : ""}" aria-live="polite"><p class="lt-name">${esc(m.name)}</p>${body}</div>`;
    }
    return `<div class="later"><p class="lt-name">${esc(m.name)}</p><p>${esc(m.explain)}</p></div>`;
  };
  const tileHtml = (m) => `<button type="button" class="mtile k-${esc(m.kind)}" data-act="method" data-m="${esc(m.id)}" aria-pressed="${pm === m.id}"${m.available ? "" : ` aria-disabled="true" aria-describedby="why-${esc(m.id)}"`}>
      <span class="mt-ico" aria-hidden="true"></span><b>${esc(m.name)}</b><small>${esc(m.kind === "card" ? "Visa, Mastercard, Amex" : m.explain.split(/(?<=\.)\s/)[0])}</small></button>`;
  const payHtml = () => {
    const m = M(), off = methods.filter((x) => !x.available);
    // One way to pay: no "How would you like to pay?" and no tiles; the card brands come straight under "Payment".
    return `${single() ? "" : `<p class="pay-head" id="pay-q">How would you like to pay?</p>
      <div class="mtiles" role="group" aria-labelledby="pay-q">${methods.map(tileHtml).join("")}</div>`}
      ${off.length ? `<ul class="why-not">${off.map((x) => `<li id="why-${esc(x.id)}">${esc(x.why_not)}</li>`).join("")}</ul>` : ""}
      ${m ? `<div class="pay${m.kind === "card" ? "" : " solo"}">
        <div class="pay-pick">${m.kind === "card"
          ? `${single() ? `<p class="vh" id="brand-q">Choose a card</p>` : `<p class="pay-sub" id="brand-q">Which card?</p>`}<div class="brands" role="group" aria-labelledby="brand-q">${BRANDS.map((c) => `<button type="button" class="brand b-${brandKey(c.brand)}" data-act="brand" data-brand="${esc(c.brand)}" aria-pressed="${brand === c}"><span>${esc(c.brand)}</span></button>`).join("")}</div>`
          : `<p class="pay-explain">${esc(m.explain)}</p>`}
          ${problem ? `<div class="payerr" role="alert"><b>${esc(problem.head)}</b><p>${esc(problem.tip)}</p></div>` : ""}
        </div>
        ${m.kind === "card" ? payCard() : stageHtml(m)}
      </div>` : ""}`;
  };
  const drawPay = (focus) => { $("[data-co-card]", root).innerHTML = payHtml(); anim = ""; if (focus) $(focus, root)?.focus(); };
  draw(root, `<form data-form="checkout" class="work" novalidate><div>
      <div class="who-head"><h3>Your details</h3><button type="button" class="btn small ghost" data-act="random">${DICE_ICON} Randomise</button></div>
      <div class="who" data-who aria-live="polite">${personHtml()}</div>
      <p class="note who-note">Overthought &amp; Co. is a demonstration company, built for testing AI products on a realistic business. No personal details are taken.</p>
      <h3>Delivery</h3><div data-co-methods></div>
      <h3>Payment</h3><div data-co-card></div>
    </div>
    <aside class="panel" aria-label="Order summary"><h3>Your order</h3><div data-co-sum></div><div data-co-msg></div><button class="btn" style="width:100%;margin-top:14px" data-submit>Place order</button><p class="note" style="margin-top:10px"><a href="bag.html">Change your bag</a></p></aside></form>`);
  // Delivery choices and the summary, priced by the engine for this person's postcode.
  function side() {
    const b = basket(person.postcode, method); if (!b) return;
    method = b.method; total = b.q.total ?? 0;
    $("[data-co-methods]", root).innerHTML = methodCards(b);
    // The lines in one table and delivery and total in another, so the wide total never squeezes the item names.
    $("[data-co-sum]", root).innerHTML = `<table class="sum"><tbody>${b.q.lines.map((l) => `<tr class="thumbline"><td><div class="item-line">${mini(l.sku)}<span>${l.qty} × ${esc(skuName(l.sku))}</span></div></td><td>${money(l.line_total)}</td></tr>`).join("")}</tbody></table><table class="sum"><tbody><tr><td>Delivery</td><td>${b.q.delivery_charge == null ? "n/a" : b.q.delivery_charge ? money(b.q.delivery_charge) : "Free"}</td></tr><tr class="total"><td>Total</td><td>${b.q.total == null ? "n/a" : money(b.q.total)}</td></tr></tbody></table>`;
  }
  const msg = () => $("[data-co-msg]", root);
  const btn = () => $("[data-submit]", root);
  let busy = false;
  const ready = () => { busy = false; btn().disabled = false; btn().textContent = "Place order"; };
  const fail = (e) => { msg().innerHTML = bad(e); ready(); $("[role=alert]", msg())?.scrollIntoView({ block: "nearest" }); };
  // Sign in as the made-up person (the same person may have ordered before), then send one real place_order.
  function place(payment) {
    const address = { line1: person.line1, town: person.town, postcode: person.postcode };
    const known = world.state.customers.find((c) => String(c.email).toLowerCase() === person.email);
    if (known) signIn(known.id);
    else {
      const made = call("create_customer", { name: person.name, email: person.email, phone: person.phone, address });
      if (!made.ok) return made;
      signIn(made.data.id);
    }
    return call("place_order", { items: bag.map(({ sku, qty }) => ({ sku, qty })), delivery_method: method, address, payment });
  }
  const goToOrder = (o) => { bag = []; saveBag(); opts.method = ""; saveOpts(); location.href = `order.html?n=${encodeURIComponent(o.number)}&placed=1`; };
  // A payment that didn't go through (the engine saved it as payment_failed): one plain line, then try again.
  function didntGo(r, prob, label) {
    problem = prob; stageText = label || prob.head; stage = "fail"; anim = "shake"; ready(); drawPay();
    $(".payerr", root)?.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" });
    announce(`${prob.head} ${prob.tip}`);
  }
  // What this attempt sends: an outcome that works.
  function planned(m) {
    return m.outcomes.find((o) => o.result === "paid") || m.outcomes[0];
  }
  // After a method's moment: send it, then show how it ended.
  function finish(m, outcomeId, onOk) {
    const r = place({ method: m.id, outcome: outcomeId });
    if (r.ok) { stage = "ok"; stageText = onOk ? onOk(r.data) : ""; drawPay(); announce(`${m.name}: ${stageText || "paid"}.`); return setTimeout(() => goToOrder(r.data), wait(m.kind === "pay_later" ? 1700 : 1000)); }
    const e = r.error || {};
    if (!e.order_number) { stage = "idle"; drawPay(); return fail(e); }
    const o = m.outcomes.find((x) => x.id === outcomeId);
    didntGo(r, methodProblem(e.message), o?.label);
  }
  wire(root, {
    click(act, t) {
      if (busy && act !== "approve" && act !== "close") return;
      if (act === "random") {
        person = who(true); const w = $("[data-who]", root);
        w.innerHTML = personHtml(); w.classList.remove("swap"); void w.offsetWidth; w.classList.add("swap");
        msg().innerHTML = ""; side(); loadMethods(); if (M() && !M().available) pm = null; drawPay();
      }
      if (act === "method") {
        const m = methods.find((x) => x.id === t.dataset.m);
        if (!m) return;
        if (!m.available) { announce(`${m.name} can't be used for this bag. ${m.why_not}`); $(`#why-${CSS.escape(m.id)}`, root)?.classList.add("flash"); setTimeout(() => $(`#why-${CSS.escape(m.id)}`, root)?.classList.remove("flash"), 900); return; }
        if (pm !== m.id) anim = "flip";
        pm = m.id; problem = null; stage = "idle"; msg().innerHTML = "";
        drawPay(`[data-act=method][data-m="${CSS.escape(m.id)}"]`);
      }
      if (act === "brand") {
        const next = BRANDS.find((c) => c.brand === t.dataset.brand);
        if (next !== shownCard()) anim = "flip";
        brand = next; problem = null; msg().innerHTML = "";
        drawPay(`[data-act=brand][data-brand="${CSS.escape(next.brand)}"]`);
      }
      // PayPost's window: Approve sends the planned outcome; Close sends the method's "closed the window" outcome.
      if (act === "approve" || act === "close") {
        const m = M(); if (!m || stage !== "open") return;
        const plan = t.dataset.plan || $("[data-co-card]", root).dataset.plan;
        if (act === "close") {
          const closed = m.outcomes.find((o) => o.moment === "close");
          if (!closed) { stage = "idle"; drawPay(); return ready(); }
          stage = "closing"; drawPay();
          return setTimeout(() => finish(m, closed.id), wait(450));
        }
        stage = "working"; drawPay();
        setTimeout(() => finish(m, plan), wait(800));
      }
    },
    change(t) { if (t.name === "method") { method = t.value; opts.method = method; saveOpts(); side(); drawPay(); } },
    submit() {
      if (busy) return;
      msg().innerHTML = "";
      const m = M();
      if (!m) { anim = ""; drawPay("[data-act=method]"); $(".mtiles", root)?.classList.add("nudge"); setTimeout(() => $(".mtiles", root)?.classList.remove("nudge"), 600); return fail(`Choose how you'd like to pay first: ${methods.filter((x) => x.available).map((x) => x.name).join(", ")}.`); }
      if (m.kind === "card" && !shownCard()) { anim = "shake"; drawPay("[data-act=brand]"); return fail("Choose a card first: Visa, Mastercard or American Express."); }
      busy = true; btn().disabled = true; btn().textContent = m.kind === "pay_later" ? "Checking…" : m.kind === "card" ? "Paying…" : `Waiting for ${m.name}…`;
      problem = null;
      if (m.kind === "card") {
        const card = brand;
        drawPay();
        return setTimeout(() => {
          const r = place({ method: "card", card_number: card.number });
          if (r.ok) return goToOrder(r.data);
          const e = r.error || {};
          if (!e.order_number) return fail(e);
          didntGo(r, payProblem(e.message, card));
        }, wait(900));
      }
      const plan = planned(m);
      // The moment happens by the payment choices, which may be off screen when Place order is pressed.
      const show = () => $(".pay", root)?.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" });
      if (m.kind === "account") {
        // The window slides in. A planned "closed" outcome closes it by itself; otherwise the customer approves or closes.
        stage = "open"; $("[data-co-card]", root).dataset.plan = plan.id; drawPay(); show(); $("[data-act=approve]", root)?.focus({ preventScroll: true });
        if (plan.moment === "close") setTimeout(() => { if (stage === "open") { stage = "closing"; drawPay(); setTimeout(() => finish(m, plan.id), wait(450)); } }, wait(1600));
        return;
      }
      if (m.kind === "wallet") {
        stage = "confirm"; drawPay(); show();
        // A timeout outcome lets the ring run all the way out; anything else answers sooner.
        return setTimeout(() => finish(m, plan.id), wait(plan.moment === "timeout" ? 2600 : 1500));
      }
      stage = m.kind === "pay_later" ? "checking" : "idle"; drawPay(); show();
      setTimeout(() => finish(m, plan.id, (o) => (o.payment.due_date ? `${money(o.payment.due)} due on ${dayMonth(o.payment.due_date)}. Nothing to pay today.` : "")), wait(1400));
    },
  });
  side(); loadMethods(); drawPay();
}
const DICE_ICON = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>`;

// ---------------------------------------------------------------- order and shipment views
const shipments = (o) => (o.shipments || []).length ? `<ul class="list">${o.shipments.map((s, k) => `<li><div class="grow"><b>Parcel ${k + 1}</b> ${tag(s.status)}${s.replacement ? " " + tag("replacement") : ""}<p class="muted" style="margin:4px 0 0">${(s.skus || []).map(skuName).map(esc).join(", ")}</p></div><div class="mono" style="text-align:right">${s.carrier ? esc(s.carrier) : "Not yet dispatched"}${s.tracking ? `<br>Tracking ${esc(s.tracking)}` : ""}${s.delivered_at ? `<br>Delivered ${esc(dateOf(s.delivered_at))}` : s.eta ? `<br>Expected ${esc(dateOf(s.eta))}` : ""}</div></li>`).join("")}</ul>` : `<p class="muted">No parcels yet.</p>`;
const history = (o) => `<ul class="list">${(o.history || []).map((h) => `<li><span>${esc(h.event)}</span><span class="mono muted">${esc(dateTime(h.at))}</span></li>`).join("")}</ul>`;
const itemRows = (o) => `<ul class="list order-items">${o.items.map((i) => `<li>${mini(i.sku)}<div class="grow"><a href="${esc(itemOf(i.sku).href)}"><b>${esc(skuName(i.sku))}</b></a></div><span>${i.qty} × ${money(i.unit_price)}</span></li>`).join("")}</ul>`;

// What happened to the payment, in plain words: "Paid with Visa ending 4242", or "Visa ending 0002 didn't go through".
const cardLine = (pay) => {
  const brand = pay.brand || pay.card?.brand || pay.card_brand || "";
  const last4 = String(pay.last4 || pay.last_four || pay.card?.last4 || pay.card_last4 || String(pay.method || "").match(/ending (\d{4})/)?.[1] || "");
  const card = brand && last4 ? `${brand} ending ${last4}` : last4 ? `card ending ${last4}` : "";
  if (!card) return pay.method || "";
  if (pay.status === "declined") return `${card[0].toUpperCase()}${card.slice(1)} didn't go through. No money was taken.`;
  return `Paid with ${card}`;
};
// Any way to pay: cards as above; "Paid with Tap"; "Pay later: £24 due on 21 December".
const payLine = (pay) => {
  if (!pay.method_id || pay.method_id === "card" || pay.last4) return cardLine(pay);
  const name = pay.method_name || pay.method;
  if (pay.status === "declined") return `${name} didn't go through. No money was taken.`;
  if (pay.status === "due") return `Pay later: ${money(pay.due)} due on ${dayMonth(pay.due_date)}`;
  if (pay.status === "nothing_due") return `Pay later with ${name}: nothing to pay.`;
  if (pay.due_date) return `Paid later with ${name}`;
  return `Paid with ${name}`;
};
function initOrder(root) {
  const n = new URLSearchParams(location.search).get("n") || "";
  const ui = { open: null, banner: "", msg: "", elig: null, cancel: false, placed: new URLSearchParams(location.search).get("placed") === "1" };
  function render(focus) {
    if (!n) return draw(root, `<p>No order number was given.</p><p><a href="account.html">Your orders</a> · <a href="track.html">Track an order</a></p>`);
    if (!custId) return draw(root, `<div class="alert">Sign in to see the details of this order. <a href="account.html">Sign in</a> or <a href="track.html?n=${encodeURIComponent(n)}">track it</a>.</div>`);
    const r = call("get_order", { order_number: n });
    if (!r.ok) return draw(root, bad(r.error) + `<p><a href="account.html">Your orders</a></p>`);
    const o = r.data, t = o.totals, pay = o.payment;
    const itemActions = o.items.map((i) => {
      const open = ui.open?.sku === i.sku ? ui.open.kind : null;
      return `<li>${mini(i.sku)}<div class="grow"><b>${esc(skuName(i.sku))}</b></div>
        <span class="inline" style="margin:0"><button class="btn small ghost" data-act="open" data-kind="return" data-sku="${esc(i.sku)}">Return</button><button class="btn small ghost" data-act="open" data-kind="problem" data-sku="${esc(i.sku)}">Report a problem</button><button class="btn small ghost" data-act="open" data-kind="register" data-sku="${esc(i.sku)}">Register</button></span>
        ${open ? `<div class="sub-panel">${itemForm(open, i)}</div>` : ""}</li>`;
    }).join("");
    const canCancel = !["cancelled", "payment_failed"].includes(o.status);
    const placed = ui.placed ? `<div class="placed" role="status"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/></svg><div><b>Order placed. Thank you.</b><p>Your order number is ${esc(bareNo(n))}. You'll find it again under <a href="account.html#orders">Your orders</a>.</p></div></div>` : "";
    draw(root, `${placed}${ui.banner}<div class="work"><div>
      <p><span class="label">Order</span> <span class="mono">${esc(bareNo(o.number))}</span> ${tag(o.status)}</p><p class="muted">Placed ${esc(dateTime(o.placed_at))}</p>
      <h3 style="margin:18px 0 8px">Items</h3>${itemRows(o)}
      <h3 style="margin:24px 0 8px">Parcels</h3>${shipments(o)}
      <h3 style="margin:24px 0 8px">History</h3>${history(o)}
      <h3 style="margin:24px 0 8px">Do something with this order</h3><ul class="list order-items">${itemActions}</ul>
      <div style="margin-top:18px">${canCancel ? (ui.cancel ? `<div class="alert">Cancel order ${esc(bareNo(o.number))}? <span class="inline"><button class="btn small" data-act="cancel-yes">Yes, cancel it</button><button class="btn small ghost" data-act="cancel-no">Keep it</button></span></div>` : `<button class="btn ghost small" data-act="cancel">Cancel this order</button>`) : ""}</div>
      ${ui.msg}</div>
      <aside class="panel"><h3>Payment</h3><table class="sum"><tbody><tr><td>Items</td><td>${money(t.items)}</td></tr><tr><td>Delivery</td><td>${t.delivery ? money(t.delivery) : "Free"}</td></tr>${t.discount ? `<tr><td>Discount</td><td>−${money(t.discount)}</td></tr>` : ""}<tr class="total"><td>Total</td><td>${money(t.total)}</td></tr></tbody></table>
      <p style="margin-top:12px">${esc(payLine(pay))}<br><span class="note">Status: ${esc(label(pay.status))}${pay.refunded ? `<br>${pay.due_date && pay.status !== "refunded" && pay.status !== "part_refunded" ? "Taken off what you owe" : "Refunded"}: ${money(pay.refunded)}` : ""}</span></p>
      <h3 style="margin:18px 0 8px">Delivery</h3><p class="note">${esc(D.business.delivery.methods.find((m) => m.id === o.delivery.method)?.name || label(o.delivery.method))}<br>${esc(o.delivery.address.line1)}, ${esc(o.delivery.address.town)}, ${esc(o.delivery.address.postcode)}</p>
      </aside></div>`, focus);
  }
  // The small form under an item: return, problem or register.
  function itemForm(kind, i) {
    if (kind === "return") {
      const e = ui.elig;
      if (!e) return "";
      if (!e.ok) return bad(e.error);
      if (!e.data.eligible) return `<div class="alert" role="status">${esc(e.data.message)}</div>`;
      const d = e.data;
      return `<form data-form="return" data-sku="${esc(i.sku)}"><p>You can return this by ${esc(dateOf(d.return_by))}. ${esc(d.condition || "")}</p>
        <div class="row2"><div class="field"><label for="r-reason">Reason</label><select id="r-reason" name="reason"><option value="change_of_mind">Changed my mind (refund ${money(d.refund_if_change_of_mind.refund_amount)})</option><option value="faulty">Faulty (refund ${money(d.refund_if_faulty.refund_amount)})</option><option value="damaged">Damaged (refund ${money(d.refund_if_faulty.refund_amount)})</option><option value="wrong_item">Wrong item sent (refund ${money(d.refund_if_faulty.refund_amount)})</option></select></div>
        <div class="field"><label for="r-qty">Quantity</label><input id="r-qty" name="qty" type="number" min="1" max="${d.qty_returnable}" value="1"></div></div>
        <label class="pick"><input type="checkbox" name="worn"> <span>I have worn it or broken its seal</span></label><p class="note">${esc(d.refund_timing || "")}</p>
        <button class="btn small">Start the return</button></form>`;
    }
    if (kind === "problem") return `<form data-form="problem" data-sku="${esc(i.sku)}"><div class="row2"><div class="field"><label for="p-problem">What happened?</label><select id="p-problem" name="problem"><option value="damaged">It arrived damaged</option><option value="missing">It did not arrive</option><option value="wrong">Wrong item</option><option value="spoiled">Food spoiled</option></select></div>
      <div class="field"><label for="p-res">What would you like?</label><select id="p-res" name="resolution"><option value="replacement">A replacement</option><option value="refund">A refund</option></select></div></div>
      <label class="pick"><input type="checkbox" name="photo"> <span>I have a photo of it</span></label><button class="btn small">Report it</button></form>`;
    return `<form data-form="register" data-sku="${esc(i.sku)}"><div class="field"><label for="g-serial">Serial number (optional)</label><input id="g-serial" name="serial"></div><button class="btn small">Register for warranty</button></form>`;
  }
  const done = (html) => { ui.open = null; ui.banner = good(html); render("[role=status]"); };
  wire(root, {
    click(act, t) {
      ui.msg = ""; ui.banner = ""; ui.placed = false;
      if (act === "open") { ui.open = { sku: t.dataset.sku, kind: t.dataset.kind }; ui.elig = t.dataset.kind === "return" ? call("check_return_eligibility", { order_number: n, sku: t.dataset.sku }) : null; return render(`form [name], .sub-panel .alert`); }
      if (act === "cancel") { ui.cancel = true; return render("[data-act=cancel-yes]"); }
      if (act === "cancel-no") { ui.cancel = false; return render("[data-act=cancel]"); }
      if (act === "cancel-yes") {
        ui.cancel = false; const r = call("cancel_order", { order_number: n, reason: "Cancelled by customer on the website" });
        if (!r.ok) { ui.msg = bad(r.error); return render(); }
        if (r.data.due_cancelled) return done(`Order cancelled. Nothing to pay: the ${money(r.data.due_cancelled)} you owed has been cancelled.`);
        return done(`Order cancelled. Refund of ${money(r.data.refund_amount)} to ${esc(r.data.refund_to)}, expected by ${esc(dateOf(r.data.refund_expected_by))}.`);
      }
    },
    submit(kind, f, fd) {
      const sku = f.dataset.sku; ui.banner = "";
      let r;
      if (kind === "return") {
        r = call("create_return", { order_number: n, items: [{ sku, qty: parseInt(fd.get("qty"), 10) || 1 }], reason: fd.get("reason"), worn: fd.get("worn") === "on" });
        if (r.ok) return done(`Return <strong>${esc(bareNo(r.data.number))}</strong> created. A prepaid label is on its way. Refund: <strong>${money(r.data.refund_amount)}</strong>${r.data.postage_deducted ? ` (after ${money(r.data.postage_deducted)} postage)` : ""}. ${esc(r.data.refund_timing || "")}`);
      } else if (kind === "problem") {
        r = call("report_problem", { order_number: n, sku, problem: fd.get("problem"), resolution: fd.get("resolution"), has_photo: fd.get("photo") === "on" });
        if (r.ok) {
          const d = r.data;
          return done(d.message ? esc(d.message) : `Sorted. ${d.outcome === "replacement" ? `A replacement is on its way (${esc(d.replacement_shipment)}).${d.return_label ? " " + esc(d.return_label) : ""}` : `Refund of ${money(d.refund_amount)} issued, expected by ${esc(dateOf(d.refund_expected_by))}.`} Case ${esc(d.case_number)}.`);
        }
      } else {
        r = call("register_product", { sku, order_number: n, ...(String(fd.get("serial")).trim() ? { serial: String(fd.get("serial")).trim() } : {}) });
        if (r.ok) return done(`Registered (${esc(r.data.id)}). Warranty runs until ${esc(dateOf(r.data.warranty_until))}.`);
      }
      ui.msg = bad(r.error); render("[role=alert]");
    },
  });
  render();
}

// ---------------------------------------------------------------- track an order
// Nothing personal to type: pick one of the orders made in this browser, pick a demo order, or paste an order number.
// The order is read through the engine as its own customer sees it (get_order), so the page shows exactly what they would.
function initTrack(root) {
  const seedCust = new Set((D.seed?.customers || []).map((c) => c.id));
  const orders = world.state.orders;
  const nameOf = (o) => world.state.customers.find((c) => c.id === o.customer_id)?.name || "";
  const firstItem = (o) => (o.items[0] ? skuName(o.items[0].sku) + (o.items.length > 1 ? ` and ${plural(o.items.length - 1, "more")}` : "") : "");
  // Orders placed here (customers made in this browser), newest first.
  const mine = orders.filter((o) => !seedCust.has(o.customer_id)).slice().reverse().slice(0, 8);
  // Demo orders: two of each kind (delivered, on the way, cancelled ...), newest first, so every state can be seen.
  const seen = {}, demo = orders.filter((o) => seedCust.has(o.customer_id)).slice().sort((a, b) => String(b.placed_at).localeCompare(String(a.placed_at))).filter((o) => (seen[o.status] = (seen[o.status] || 0) + 1) <= 2);
  const pick = (o) => `<button type="button" class="order-pick" data-act="show" data-n="${esc(o.number)}"><b>${esc(plainNo(o.number))}</b> ${tag(o.status)}<span>${esc(firstItem(o))}</span></button>`;
  draw(root, `<div class="track">
    <div class="panel"><h3>Your orders in this browser</h3>${mine.length ? `<div class="order-picks">${mine.map(pick).join("")}</div>` : `<p class="muted" style="margin:0">None yet. Orders you place here show up in this list.</p>`}</div>
    ${demo.length ? `<div class="panel"><h3>Pick a demo order</h3><p class="note">Orders from the shop's made-up customers, one of each kind.</p><div class="field" style="margin:0"><label for="t-demo" class="vh">Demo order</label><select id="t-demo" data-demo><option value="">Choose an order</option>${demo.map((o) => `<option value="${esc(o.number)}">${esc(label(o.status))}: ${esc(firstItem(o))} (${esc(nameOf(o))})</option>`).join("")}</select></div></div>` : ""}
    <form data-form="track" class="panel"><h3>Have an order number?</h3><div class="inline" style="margin:0"><label for="t-n" class="vh">Order number</label><input id="t-n" name="n" placeholder="20417" autocomplete="off" spellcheck="false"><button class="btn">Track</button></div></form>
  </div><div data-out aria-live="polite" style="margin-top:28px"></div>`);
  const out = $("[data-out]", root);
  function show(num) {
    num = String(num || "").trim().toUpperCase();
    if (!num) return;
    // WHY: people type the number they were shown ("20417"); the record id carries a prefix ("ORD-20417").
    const o = orders.find((x) => x.number === num || bareNo(x.number) === bareNo(num));
    const g = o && world.session({ role: "customer", customer_id: o.customer_id }).call("get_order", { order_number: o.number });
    if (!g?.ok) { out.innerHTML = `<div class="alert" role="alert">We couldn't find order ${esc(bareNo(num))}. Check the number, or pick one of the orders above.</div>`; return; }
    const d = g.data;
    out.innerHTML = `<h2 style="font-size:28px">${esc(plainNo(d.number))} ${tag(d.status)}</h2><p class="muted">Placed ${esc(dateTime(d.placed_at))}. ${esc(payLine(d.payment).replace(/([^.])$/, "$1."))}</p>${itemRows(d)}<h3 style="margin:22px 0 8px">Parcels</h3>${shipments(d)}<h3 style="margin:22px 0 8px">History</h3>${history(d)}`;
    out.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  wire(root, {
    click(act, t) { if (act === "show") show(t.dataset.n); },
    change(t) { if (t.matches("[data-demo]")) show(t.value); },
    submit(_, f, fd) { show(fd.get("n")); },
  });
  const n0 = new URLSearchParams(location.search).get("n");
  if (n0) { $("#t-n", root).value = n0; show(n0); }
}

// ---------------------------------------------------------------- account
function initAccount(root) {
  const ui = { tab: "Orders", bk: null, msg: "", open: null };
  const TABS = ["Orders", "Returns", "Repairs", "Registered products", ...(D.flags?.services ? ["Bookings"] : []), "Support history", "Profile"];
  const svcName = (id) => world.services[id]?.name || id;
  // A hire item or a package, whichever the service has.
  const itemName = (b) => { const s = world.services[b.service]; return [...(s?.items || []), ...(s?.packages || [])].find((i) => i.id === b.item_id)?.name || b.item_id; };
  function body() {
    const own = (list) => list.filter((x) => x.customer_id === custId);
    if (ui.tab === "Profile") { const c = me(); return `<table class="spec"><tbody><tr><th>Name</th><td>${esc(c.name)}</td></tr><tr><th>Email</th><td>${esc(c.email)}</td></tr><tr><th>Phone</th><td>${esc(c.phone || "none")}</td></tr><tr><th>Contact by</th><td>${esc(c.contact_preference)}</td></tr>${c.credit_balance ? `<tr><th>Credit</th><td>${money(c.credit_balance)}</td></tr>` : ""}${c.addresses.map((a) => `<tr><th>Address${a.default ? " (default)" : ""}</th><td>${esc(a.line1)}, ${esc(a.town)}, ${esc(a.postcode)}</td></tr>`).join("")}</tbody></table>`; }
    if (ui.tab === "Orders") { const o = call("list_orders").data.orders; return o.length ? `<ul class="list">${o.map((x) => `<li><div class="grow"><a href="order.html?n=${encodeURIComponent(x.number)}"><b>${esc(plainNo(x.number))}</b></a> ${tag(x.status)}<p class="muted" style="margin:4px 0 0">${esc(dateOf(x.placed_at))} · ${x.items.map(esc).join(", ")}</p></div><span class="mono">${money(x.total)}</span></li>`).join("")}</ul>` : `<p>No orders yet. <a href="shop.html">Shop</a></p>`; }
    if (ui.tab === "Bookings") { const b = call("list_bookings").data.bookings; return b.length ? `<ul class="list">${b.map(bookingRow).join("")}</ul>` : `<p>No bookings yet. <a href="services.html">See the services</a></p>`; }
    if (ui.tab === "Returns") { const r = own(world.state.returns); return r.length ? `<ul class="list">${r.map((x) => `<li><div class="grow"><b>${esc(plainNo(x.number))}</b> ${tag(x.status)}<p class="muted" style="margin:4px 0 0"><a href="order.html?n=${encodeURIComponent(x.order_number)}">${esc(plainNo(x.order_number))}</a> · ${x.items.map((i) => `${i.qty ?? 1} × ${esc(skuName(i.sku))}`).join(", ")} · ${esc(label(x.reason))}</p></div><span class="mono">Refund ${money(x.refund_amount)}</span></li>`).join("")}</ul>` : `<p>No returns. Start one from an order.</p>`; }
    if (ui.tab === "Repairs") {
      const l = call("list_repairs").data.repairs; if (!l.length) return `<p>No repairs. ${D.flags?.services ? `<a href="fix-club.html#book">Request one</a>` : `<a href="help.html?q=repair">How repairs work</a>`}</p>`;
      return `<ul class="list">${l.map((x) => { const r = call("get_repair", { repair_number: x.number }).data; return `<li><div class="grow"><b>${esc(plainNo(r.number))}</b> ${tag(r.status)} ${r.in_warranty ? tag("in warranty") : ""}<p style="margin:4px 0">${esc(skuName(r.sku))}: ${esc(r.fault)}</p>${r.quote ? `<p class="note">Quote ${money(r.quote.total)}: ${r.quote.lines.map((q) => `${esc(q.name)} ${money(q.price)}`).join(", ")}. Valid until ${esc(dateOf(r.quote.valid_until))}.</p>` : ""}${r.promised_by ? `<p class="note">Promised by ${esc(dateOf(r.promised_by))}</p>` : ""}<p class="note">${(r.history || []).slice(-2).map((h) => esc(h.event)).join(" · ")}</p></div>${r.status === "quote_sent" ? `<button class="btn small" data-act="approve" data-n="${esc(r.number)}">Approve quote</button>` : ""}</li>`; }).join("")}</ul>`;
    }
    if (ui.tab === "Registered products") { const r = own(world.state.registrations); return r.length ? `<ul class="list">${r.map((x) => `<li><div class="grow"><b>${esc(skuName(x.sku))}</b><p class="muted" style="margin:4px 0 0">Bought ${esc(dateOf(x.purchased_at))}${x.serial ? " · serial " + esc(x.serial) : ""}</p></div><span class="mono">Warranty to ${esc(dateOf(x.warranty_until))}</span></li>`).join("")}</ul>` : `<p>Nothing registered. Register a product from its order.</p>`; }
    const c = call("list_cases").data.cases; return c.length ? `<ul class="list">${c.map((x) => `<li><div class="grow"><b>${esc(x.subject)}</b> ${tag(x.status)}<p class="muted" style="margin:4px 0 0">${esc(label(x.category))} · ${esc(dateOf(x.opened_at))}</p></div></li>`).join("")}</ul>` : `<p>No earlier contact. <a href="help.html">Help</a></p>`;
  }
  // Start times a service accepts, or null when it takes borrow-box style dates or free times.
  function startOptions(service) { return D.business.services[service]?.slots || world.services[service]?.slots || null; }
  function bookingRow(b) {
    const o = ui.bk?.number === b.number ? ui.bk.kind : null, live = b.status === "confirmed";
    return `<li><div class="grow"><b>${esc(svcName(b.service))}</b>: ${esc(itemName(b))} ${tag(b.status)}<p class="muted" style="margin:4px 0 0">${esc(plainNo(b.number))} · ${esc(dateTime(b.start))} · ${esc(b.location || "")}${b.party_size > 1 ? ` · ${b.party_size} people` : ""}</p></div><span class="mono">${money(b.price)}${b.deposit ? ` + ${money(b.deposit)} deposit` : ""}</span>
      ${live ? `<span class="inline" style="margin:0"><button class="btn small ghost" data-act="bk" data-kind="move" data-n="${esc(b.number)}">Reschedule</button><button class="btn small ghost" data-act="bk" data-kind="cancel" data-n="${esc(b.number)}">Cancel</button></span>` : ""}
      ${o === "cancel" ? `<div class="sub-panel">Cancel ${esc(plainNo(b.number))}? <span class="inline"><button class="btn small" data-act="bk-cancel" data-n="${esc(b.number)}">Yes, cancel</button><button class="btn small ghost" data-act="bk-no">Keep it</button></span></div>` : ""}
      ${o === "move" ? `<div class="sub-panel">${moveForm(b)}</div>` : ""}</li>`;
  }
  function moveForm(b) {
    const r = D.business.services[b.service] || {};
    const rule = r.reschedule || (r.reschedule_min_hours ? `Free up to ${r.reschedule_min_hours} hours before, if the new time is free.` : "");
    const slots = startOptions(b.service);
    // Hold has no fixed slots, so it takes any time; the others pick from their list of start times.
    const when = slots ? `<div class="field"><label for="m-t">Start</label><select id="m-t" name="slot">${slots.map((t) => `<option>${t}</option>`).join("")}</select></div>` : b.service === "someone-to-hold" ? `<div class="field"><label for="m-t">Time</label><input id="m-t" name="slot" type="time" required></div>` : "";
    const inputs = `<div class="row2"><div class="field"><label for="m-d">New date</label><input id="m-d" name="date" type="date" min="${today()}" required></div>${when}</div>`;
    return `<form data-form="move" data-n="${esc(b.number)}"><p class="note">${esc(rule)}</p>${inputs}<button class="btn small">Move it</button> <button type="button" class="btn small ghost" data-act="bk-no">Never mind</button></form>`;
  }
  function render(focus) {
    if (!custId) {
      const cs = world.state.customers;
      return draw(root, `<div class="work"><form data-form="signin" class="panel"><h3>Sign in</h3>${cs.length ? `<div class="field"><label for="a-c">Your account</label><select id="a-c" name="c">${cs.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.email)})</option>`).join("")}</select></div><button class="btn">Sign in</button>` : `<p>No accounts yet.</p>`}</form>
        <div class="panel"><h3>New here?</h3><p>Your account is made when you place your first order.</p><a class="btn ghost" href="shop.html">Go to the shop</a></div></div>`);
    }
    const c = me();
    draw(root, `<p class="muted">Signed in as <strong>${esc(c.name)}</strong> <button class="btn small ghost" data-act="signout">Sign out</button></p><div class="tabs" role="group" aria-label="Account sections">${TABS.map((t) => `<button class="chip" data-act="tab" data-tab="${esc(t)}" aria-pressed="${t === ui.tab}">${esc(t)}</button>`).join("")}</div>${ui.msg}<div>${body()}</div>`, focus);
  }
  wire(root, {
    click(act, t) {
      ui.msg = "";
      if (act === "signout") { signOut(); ui.tab = "Orders"; return render(); }
      if (act === "tab") { ui.tab = t.dataset.tab; ui.bk = null; return render("[data-act=tab][aria-pressed=true]"); }
      if (act === "bk") { ui.bk = { number: t.dataset.n, kind: t.dataset.kind }; return render(".sub-panel button, .sub-panel input, .sub-panel select"); }
      if (act === "bk-no") { ui.bk = null; return render("[data-act=tab][aria-pressed=true]"); }
      if (act === "bk-cancel") {
        const r = call("cancel_booking", { booking_number: t.dataset.n }); ui.bk = null;
        ui.msg = r.ok ? good(`Booking cancelled. Refund: <strong>${money(r.data.refund_amount)}</strong>${r.data.credit_amount ? `, plus ${money(r.data.credit_amount)} credit` : ""}. ${esc(r.data.rule)}${r.data.refund_expected_by ? ` Expected by ${esc(dateOf(r.data.refund_expected_by))}.` : ""}`) : bad(r.error.message);
        return render("[role=alert], [role=status]");
      }
      if (act === "approve") {
        const r = call("approve_repair_quote", { repair_number: t.dataset.n });
        ui.msg = r.ok ? good(`Quote approved (${money(r.data.total)}). We promise it back by ${esc(dateOf(r.data.promised_by))}.`) : bad(r.error.message);
        return render("[role=alert], [role=status]");
      }
    },
    submit(kind, f, fd) {
      if (kind === "signin") { signIn(fd.get("c")); return render("[data-act=tab][aria-pressed=true]"); }
      if (kind === "move") {
        const b = call("get_booking", { booking_number: f.dataset.n }).data; let input = { booking_number: b.number };
        const day = fd.get("date"), span = Math.round((Date.parse(b.end) - Date.parse(b.start)) / 864e5);
        input.new_start = b.service === "borrow-box" ? `${day}T10:00:00Z` : `${day}T${fd.get("slot")}:00Z`;
        if (b.service === "borrow-box") input.new_end = addDays(day, span);
        const r = call("reschedule_booking", input); ui.bk = null;
        ui.msg = r.ok ? good(`Moved to ${esc(dateTime(r.data.booking.start))}.${r.data.fee ? ` A change fee of ${money(r.data.fee)} applies.` : " No fee."}`) : bad(r.error.message);
        render("[role=alert], [role=status]");
      }
    },
  });
  render();
}

// ---------------------------------------------------------------- booking and repair forms on service pages
function initBook(root) {
  const id = root.dataset.book, svc = world.services[id], rules = D.business.services[id] || {};
  let out = "";
  const slotsHtml = (date, pkg) => {
    const r = date ? call("check_availability", { service: id, item_id: pkg, date }) : null;
    const free = Object.fromEntries((r?.data?.slots || []).map((s) => [s.slot, s.crews_free]));
    return rules.slots.map((s) => `<option value="${s}" ${date && free[s] < 1 ? "disabled" : ""}>${s}${date ? (free[s] < 1 ? " (full)" : ` (${plural(free[s], "crew")} free)`) : ""}</option>`).join("");
  };
  function fields() {
    if (id === "someone-to-queue") {
      return `<div class="row2"><div class="field"><label for="b-date">Date</label><input id="b-date" name="date" type="date" min="${today()}" required></div><div class="field"><label for="b-start">Start hour</label><select id="b-start" name="start">${rules.slots.map((t) => `<option>${t}</option>`).join("")}</select></div></div>
        <div class="row2"><div class="field"><label for="b-pkg">Hours</label><select id="b-pkg" name="pkg">${(svc.packages || []).map((p) => `<option value="${esc(p.id)}">${p.hours} hour${p.hours === 1 ? "" : "s"} · ${money(p.price)}</option>`).join("")}</select></div><div class="field"><label for="b-place">Where is the queue?</label><input id="b-place" name="place" required></div></div>
        <div class="field"><label for="b-for">What is it for?</label><input id="b-for" name="for" required></div><p class="note" data-price-line></p>`;
    }
    if (id === "someone-to-hold") {
      return `<div class="row2"><div class="field"><label for="b-num">Number to call</label><input id="b-num" name="num" type="tel" required></div><div class="field"><label for="b-for">What is it about?</label><input id="b-for" name="for" required></div></div>
        <div class="row2"><div class="field"><label for="b-date">Date</label><input id="b-date" name="date" type="date" min="${today()}" required></div><div class="field"><label for="b-time">Time</label><input id="b-time" name="time" type="time" value="10:00" required></div></div>
        <div class="field" style="max-width:260px"><label for="b-extra">Extra half hours on hold</label><select id="b-extra" name="extra">${[0, 1, 2, 3, 4].map((n) => `<option>${n}</option>`).join("")}</select></div><p class="note" data-price-line></p>`;
    }
    if (id === "someone-to-wait-in") {
      return `<div class="row2"><div class="field"><label for="b-date">Date</label><input id="b-date" name="date" type="date" min="${today()}" required></div><div class="field"><label for="b-pkg">Half or full day</label><select id="b-pkg" name="pkg">${(svc.packages || []).map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.note || "")}) ${money(p.price)}</option>`).join("")}</select></div></div>
        <div class="row2"><div class="field" data-half><label for="b-start">Half day starts</label><select id="b-start" name="start">${(svc.slots || []).map((t) => `<option>${t}</option>`).join("")}</select></div><div class="field"><label for="b-addr">Address</label><input id="b-addr" name="addr" required></div></div>
        <div class="field"><label for="b-for">What are you waiting for? (optional)</label><input id="b-for" name="for"></div><p class="note" data-price-line></p>`;
    }
    if (id === "someone-to-clap") {
      return `<div class="row2"><div class="field"><label for="b-pkg">Package</label><select id="b-pkg" name="pkg">${(svc.packages || []).map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${p.clappers} clappers, ${p.minutes} min) ${money(p.price)}</option>`).join("")}</select></div>
        <div class="field"><label for="b-date">Date</label><input id="b-date" name="date" type="date" min="${today()}" required></div></div>
        <div class="row2"><div class="field"><label for="b-slot">Time slot</label><select id="b-slot" name="slot">${slotsHtml("", "")}</select></div><div class="field"><label for="b-mi">Distance from us (miles)</label><input id="b-mi" name="miles" type="number" min="0" step="1" value="0"></div></div>
        <fieldset style="border:0;padding:0;margin:0 0 14px"><legend class="label">Add-ons</legend>${(svc.add_ons || []).map((a) => `<label class="pick"><input type="checkbox" name="addon" value="${esc(a.id)}"><span>${esc(a.name)} · ${money(a.price)}</span></label>`).join("")}</fieldset>
        <div class="row2"><div class="field"><label for="b-who">Name of the person to be clapped</label><input id="b-who" name="who" required></div><div class="field"><label for="b-addr">Exact address</label><input id="b-addr" name="addr" required></div></div>
        <p class="note" data-price-line></p>`;
    }
    if (id === "borrow-box") {
      return `<div class="row2"><div class="field"><label for="b-item">Item</label><select id="b-item" name="item">${(svc.items || []).map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join("")}</select></div><div class="field"><label for="b-date">Start date</label><input id="b-date" name="date" type="date" min="${today()}" required></div></div>
        <fieldset style="border:0;padding:0;margin:0 0 10px"><legend class="label">Period</legend><label class="pick"><input type="radio" name="period" value="weekend" checked><span>Weekend: ${esc(rules.periods?.weekend || "")}</span></label><label class="pick"><input type="radio" name="period" value="week"><span>Week: ${esc(rules.periods?.week || "")}</span></label></fieldset>
        <fieldset style="border:0;padding:0;margin:0 0 10px"><legend class="label">Pick up or deliver</legend><label class="pick"><input type="radio" name="how" value="pickup" checked><span>Pick it up from us (free)</span></label><label class="pick"><input type="radio" name="how" value="deliver"><span>We bring it and fetch it back (${money(rules.delivery_fee_each_way || 0)} each way)</span></label></fieldset>
        <div class="field" data-miles hidden style="max-width:240px"><label for="b-mi">Distance from us (miles)</label><input id="b-mi" name="miles" type="number" min="0" value="5"></div><p class="note" data-price-line></p>`;
    }
    return fixFields();
  }
  // Fix Club: things you own (registrations, orders) first, then any eligible product with proof of purchase.
  function fixFields() {
    const eligible = new Set(D.business.fix_club.eligible_products), owned = [];
    if (custId) {
      for (const r of world.state.registrations.filter((x) => x.customer_id === custId)) if (eligible.has(skuInfo(r.sku).product?.id)) owned.push({ v: `reg|${r.id}|${r.sku}`, t: `${skuName(r.sku)} (registered ${r.id})` });
      for (const o of world.state.orders.filter((x) => x.customer_id === custId)) for (const i of o.items) if (eligible.has(skuInfo(i.sku).product?.id)) owned.push({ v: `ord|${o.number}|${i.sku}`, t: `${skuName(i.sku)} (order ${bareNo(o.number)})` });
    }
    const other = world.products.filter((p) => eligible.has(p.id)).flatMap((p) => p.variants.map((v) => `<option value="${esc(v.sku)}">${esc(p.name)}, ${esc(v.name)}</option>`)).join("");
    return `<div class="field"><label for="b-own">Which product?</label><select id="b-own" name="own">${owned.map((o) => `<option value="${esc(o.v)}">${esc(o.t)}</option>`).join("")}<option value="other">Something else from the Fix Club list</option></select></div>
      <div data-other ${owned.length ? "hidden" : ""}><div class="row2"><div class="field"><label for="b-sku">Product</label><select id="b-sku" name="sku">${other}</select></div><div class="field"><label for="b-ord">Order number (proof of purchase)</label><input id="b-ord" name="ord" placeholder="20417"></div></div></div>
      <div class="field"><label for="b-fault">What's wrong with it?</label><textarea id="b-fault" name="fault" rows="3" required></textarea></div>`;
  }
  function render() {
    draw(root, `<form data-form="book" class="panel">${fields()}<h3 style="margin:18px 0 10px">${custId ? "Your details" : "Who is booking?"}</h3>${customerFields()}<button class="btn" data-submit>${id === "fix-club" ? "Send repair request" : "Book it (simulated payment)"}</button> <span class="note">A simulation: nothing is charged.</span></form><div data-out aria-live="polite" style="margin-top:16px">${out}</div>`);
    $("[data-other]", root) && syncOther();
    refresh();
  }
  const syncOther = () => { const f = $("form", root); $("[data-other]", root).hidden = f.own.value !== "other"; };
  // Live availability and list-price hint (the final price always comes back from the engine when you book).
  function refresh() {
    const f = $("form", root), line = $("[data-price-line]", root); if (!f || !line) return;
    if (id === "someone-to-clap") {
      const sel = f.slot.value; f.slot.innerHTML = slotsHtml(f.date.value, f.pkg.value); if ([...f.slot.options].some((o) => o.value === sel && !o.disabled)) f.slot.value = sel;
      const pkg = (svc.packages || []).find((p) => p.id === f.pkg.value), add = [...f.querySelectorAll("[name=addon]:checked")].reduce((n, c) => n + (svc.add_ons.find((a) => a.id === c.value)?.price || 0), 0);
      line.textContent = pkg ? `List price ${money(pkg.price + add)}. Travel within ${rules.area?.included_miles || 30} miles is included; the final price is confirmed when you book.` : "";
    } else if (id === "someone-to-queue" || id === "someone-to-wait-in") {
      const pkg = (svc.packages || []).find((p) => p.id === f.pkg.value), full = id === "someone-to-wait-in" && pkg.hours > 4;
      if (id === "someone-to-wait-in") $("[data-half]", root).hidden = full;
      const start = full ? svc.slots[0] : f.start.value;
      let avail = "";
      if (f.date.value) { const r = call("check_availability", { service: id, item_id: pkg.id, date: f.date.value, slot: start }); avail = r.ok ? (r.data.slots[0].free ? "That slot is free. " : "That slot is already taken. ") : esc(r.error.message) + " "; }
      line.textContent = `${avail}List price ${money(pkg.price)}. ${rules.min_notice_hours} hours' notice needed. The final price is confirmed when you book.`;
    } else if (id === "someone-to-hold") {
      const call1 = svc.packages.find((p) => p.id === "HOLD-CALL"), extra = svc.packages.find((p) => p.id === "HOLD-EXTRA");
      line.textContent = `List price ${money(call1.price + Number(f.extra.value) * extra.price)}. Includes ${rules.included_hold_minutes} minutes on hold. ${rules.min_notice_hours} hours' notice needed.`;
    } else if (id === "borrow-box") {
      const deliver = f.how.value === "deliver"; $("[data-miles]", root).hidden = !deliver;
      const it = (svc.items || []).find((i) => i.id === f.item.value), weekend = f.period.value === "weekend";
      let avail = "";
      if (f.date.value) { const r = call("check_availability", { service: id, item_id: it.id, date: f.date.value, end_date: addDays(f.date.value, weekend ? 3 : 6) }); avail = r.ok ? `${r.data.units_free} of ${r.data.units_total} free for those dates. ` : esc(r.error.message) + " "; }
      line.textContent = `${avail}List price ${money((weekend ? it.price_weekend : it.price_week) + (deliver ? 2 * (rules.delivery_fee_each_way || 0) : 0))} plus a ${money(it.deposit)} deposit, refunded when it comes back. The final price is confirmed when you book.`;
    }
  }
  wire(root, {
    change(t) { if (t.name === "own") syncOther(); refresh(); },
    submit(_, f, fd) {
      const o = $("[data-out]", root), btn = $("[data-submit]", root); btn.disabled = true;
      const stop = (m) => { o.innerHTML = bad(m); btn.disabled = false; };
      const v = (k) => String(fd.get(k) || "").trim();
      let tool = "create_booking", input;
      if (id === "someone-to-queue") input = { service: id, item_id: fd.get("pkg"), start: `${fd.get("date")}T${fd.get("start")}:00Z`, location: v("place"), note: v("for") };
      else if (id === "someone-to-hold") input = { service: id, item_id: "HOLD-CALL", start: `${fd.get("date")}T${fd.get("time")}:00Z`, add_ons: Array(Number(fd.get("extra")) || 0).fill("HOLD-EXTRA"), location: v("num"), note: v("for") };
      else if (id === "someone-to-wait-in") {
        const full = (svc.packages.find((p) => p.id === fd.get("pkg"))?.hours || 0) > 4;
        input = { service: id, item_id: fd.get("pkg"), start: `${fd.get("date")}T${full ? svc.slots[0] : fd.get("start")}:00Z`, location: v("addr"), note: v("for") };
      } else if (id === "someone-to-clap") input = { service: id, item_id: fd.get("pkg"), start: `${fd.get("date")}T${fd.get("slot")}:00Z`, add_ons: fd.getAll("addon"), distance_miles: Number(fd.get("miles")) || 0, location: `${v("addr")} (to clap: ${v("who")})` };
      else if (id === "borrow-box") {
        const weekend = fd.get("period") === "weekend", deliver = fd.get("how") === "deliver";
        input = { service: id, item_id: fd.get("item"), start: `${fd.get("date")}T10:00:00Z`, end: addDays(fd.get("date"), weekend ? 3 : 6), ...(deliver ? { delivery: true, distance_miles: Number(fd.get("miles")) || 0 } : {}) };
      } else {
        tool = "create_repair";
        if (fd.get("own") === "other") { if (!v("ord")) return stop("Enter the order number you bought it on, as proof of purchase."); input = { sku: fd.get("sku"), fault: v("fault"), order_number: v("ord").toUpperCase() }; }
        else { const [kind, ref, sku] = fd.get("own").split("|"); input = { sku, fault: v("fault"), ...(kind === "reg" ? { registration_id: ref } : { order_number: ref }) }; }
      }
      const made = ensureCustomer(fd); if (!made.ok) return stop(made.error.message);
      const r = call(tool, input);
      if (!r.ok) return stop(r.error.message);
      const d = r.data;
      o.innerHTML = tool === "create_booking"
        ? good(`Booked. Your booking number is <strong>${esc(bareNo(d.number))}</strong> for ${esc(dateTime(d.start))}. Price ${money(d.price)}${d.deposit ? ` plus a ${money(d.deposit)} deposit` : ""}, paid by simulation. <a href="account.html">See it in your account</a>.`)
        : good(`Repair request <strong>${esc(bareNo(d.number))}</strong> received. ${d.in_warranty ? `It is <strong>in warranty</strong> (until ${esc(dateOf(d.warranty_until))}), so there is no assessment fee.` : `It is <strong>out of warranty</strong> (ended ${esc(dateOf(d.warranty_until))}). Assessment fee ${money(d.assessment_fee)}, taken off the repair price if you go ahead.`} Postage: ${esc(d.postage)} Turnaround ${d.turnaround_working_days} working days from arrival.${(d.fixed_price_list || []).length ? `<br>Fixed prices: ${d.fixed_price_list.map((x) => `${esc(x.name)} ${x.price == null ? "quoted after assessment" : money(x.price)}`).join("; ")}.` : ""} <a href="account.html">Follow it in your account</a>.`);
      out = o.innerHTML; // keep the confirmation if the form is redrawn
      render(); announce("Done.");
    },
  });
  render();
}

// ---------------------------------------------------------------- start
function start() {
  initWorld(); updateCount();
  window.addEventListener("storage", (e) => { if (e.key === "ot:bag") { bag = jget("bag", []); updateCount(); } });
  const run = (fn, ...a) => { try { fn(...a); } catch (e) { console.error(e); } };
  $$("[data-product]").forEach((r) => run(initProduct, r));
  run(initAccessories);
  if (document.body.dataset.view === "help") run(initHelp);
  const apps = { bag: initBag, checkout: initCheckout, order: initOrder, track: initTrack, account: initAccount };
  $$("[data-app]").forEach((r) => apps[r.dataset.app] && run(apps[r.dataset.app], r));
  $$("[data-book]").forEach((r) => run(initBook, r));
}
start();
