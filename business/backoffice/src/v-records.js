// One page for every record, by id: #/r/ORD-10001, #/r/C-1002, #/r/PO-3001 … The same renderer fills the side drawer.
import { S, load, html, raw, money, money2, num, pct, date, dateTime, dateShort, time, ago, words, cap, findRecord, customers, chip, idLink, icon, pill, tonePill, statusLabel, roleName, access, canSeeCustomer, redact, scopedCustomer, skuLink, skuName, skuImg, prodLink, productById, avatar, kv, panel, strip, stat, CHANNELS, markdown, storiesFor, storyNote, lockPanel, daysFrom, minutes, stars, codeBlock, isAI, monthLabel, flagIcons } from "./core.js";
import { barChart } from "./charts.js";

const AREA = { orders: "orders", shipment: "orders", returns: "orders", registrations: "orders", reviews: "orders", customer: "customers", repairs: "repairs", cases: "cases", conversations: "cases", contacts: "contacts", purchase_order: "buying", supplier: "buying", stock_count: "stock", movement: "stock", ledger: "ledger", document: "documents", campaign: "marketing" };
const CRUMB = { orders: ["#/orders", "Commerce", "Orders"], shipment: ["#/deliveries", "Commerce", "Deliveries"], returns: ["#/returns", "Commerce", "Returns and refunds"], registrations: ["#/customers", "Customers", "Registrations"], reviews: ["#/products", "Commerce", "Reviews"], customer: ["#/customers", "Customers", "Directory"], repairs: ["#/service/repairs", "Customer operations", "Fix Club repairs"], cases: ["#/service/cases", "Customer operations", "Cases"], conversations: ["#/service", "Customer operations", "Service desk"], contacts: ["#/service", "Customer operations", "Service desk"], purchase_order: ["#/purchase-orders", "Operations and supply", "Purchase orders"], supplier: ["#/suppliers", "Operations and supply", "Suppliers"], stock_count: ["#/stock/counts", "Operations and supply", "Movements and counts"], movement: ["#/stock/counts", "Operations and supply", "Movements and counts"], ledger: ["#/ledger", "Finance", "Ledger"], document: ["#/systems/knowledge", "Company systems and data", "Company knowledge"], campaign: ["#/marketing", "Marketing and sales", "Campaigns"] };

export async function page(main, [id]) {
  await render(id, main, false);
}
export async function inDrawer(id, el) { await render(id, el, true); }

async function render(id, el, drawer) {
  const found = await findRecord(id);
  if (!found) { el.innerHTML = html`<div class="empty"><b>No record called ${id}.</b>It may belong to a different world size, or the id is mistyped. <a href="#/overview">Back to the overview</a></div>`; return; }
  const area = AREA[found.type];
  const cr = CRUMB[found.type];
  if (!drawer) window.__setCrumbs([[cr[0], cr[1]], [cr[0], cr[2]], found.type === "customer" && canSeeCustomer(id) ? found.rec.name : id]);
  // permissions: the same rules the engine applies
  const a = access(area);
  const owner = found.rec.customer_id || found.order?.customer_id || (found.type === "customer" ? id : null);
  if (a === "none" || (a === "one" && owner !== scopedCustomer())) { el.innerHTML = String(lockPanel(area, a === "one" ? "another customer's records" : "this record")); return; }
  const fn = R[found.type];
  el.innerHTML = String(await fn(found, drawer));
  after[found.type]?.(el, found);
}

const head = (title, sub, pills = [], actions = "") => html`<div class="rec-head"><div style="min-width:0"><h1>${title} ${pills}</h1>${sub ? html`<p class="sub">${sub}</p>` : ""}</div>${actions ? html`<div class="actions">${actions}</div>` : ""}</div>`;
const who = async (cid) => {
  if (!cid) return html`<span class="muted">Not a customer yet</span>`;
  const c = (await customers()).get(cid);
  return canSeeCustomer(cid) ? html`<a class="who" href="#/r/${cid}" data-rec="${cid}">${avatar(cid, c?.name)}<span>${c?.name}</span></a>` : html`<span class="who">${avatar(cid, "?")}${redact(c?.name || cid, false)}</span>`;
};
const linked = (title, items) => (items.length ? panel(title, html`<ul class="list" style="margin:-8px -16px -16px">${items}</ul>`) : "");
const li = (id, title, sub, right) => html`<li class="hov"><a href="#/r/${id}" data-rec="${id}" style="display:contents;color:inherit"><span class="t"><b>${title}</b>${sub ? html`<small>${sub}</small>` : ""}</span><span class="meta">${right || ""}</span></a></li>`;
const tl = (items) => html`<ol class="tl">${items.map((e) => html`<li><span class="node ${e.tone || ""}">${icon(e.icon || "clock")}</span><div class="what">${e.what}<span class="when">${dateTime(e.at)}${e.by ? html` · ${e.by}` : ""}</span>${e.body ? html`<div class="body">${e.body}</div>` : ""}</div></li>`)}</ol>`;
async function ledgerFor(ref, fromYear) {
  if (access("ledger") === "none") return null;
  const ys = Object.keys(S.meta.ledger_years).filter((y) => y >= fromYear);
  const rows = (await Promise.all(ys.map((y) => load(`ledger/y${y}.json`)))).flat();
  return rows.filter((e) => e[4] === ref).sort((a, b) => a[1].localeCompare(b[1]));
}

// ---------------------------------------------------------------- each kind of record
const R = {
  async orders({ rec: o, bundle: b }, drawer) {
    const st = await storiesFor(o.number, o.customer_id);
    const returns = b.returns.filter((r) => r.order_number === o.number), cases = b.cases.filter((c) => Object.values(c.related || {}).includes(o.number));
    const convs = b.conversations.filter((c) => cases.some((k) => k.number === c.case_number) || (c.messages || []).some((m) => m.text.includes(o.number)));
    const regs = b.registrations.filter((r) => r.order_number === o.number), reps = b.repairs.filter((r) => r.order_number === o.number), revs = b.reviews.filter((r) => r.order_number === o.number);
    const contacts = b.contacts.filter((c) => cases.some((k) => k.number === c.case_number));
    const ledger = await ledgerFor(o.number, o.placed_at.slice(0, 4));
    const seeC = canSeeCustomer(o.customer_id);
    // the order's story, every event in time order
    const ev = [];
    for (const h of o.history || []) ev.push({ at: h.at, what: h.event, icon: /fail|declin/i.test(h.event) ? "alert" : /deliver/i.test(h.event) ? "check" : /refund/i.test(h.event) ? "coins" : "clock", tone: /fail|declin|lost/i.test(h.event) ? "crit" : /deliver/i.test(h.event) ? "good" : "" });
    for (const s of o.shipments) { if (s.dispatched_at) ev.push({ at: s.dispatched_at, what: html`Parcel ${idLink(s.id)} sent with ${s.carrier || "the courier"}`, icon: "truck", tone: "info" }); if (s.delivered_at) ev.push({ at: s.delivered_at, what: html`Parcel ${idLink(s.id)} delivered`, icon: "check", tone: "good" }); else if (["delayed", "lost"].includes(s.status)) ev.push({ at: s.eta + "T23:59", what: html`Parcel ${idLink(s.id)} ${s.status === "lost" ? "lost" : "late"}: was due ${date(s.eta)}`, icon: "alert", tone: s.status === "lost" ? "crit" : "serious", body: s.note }); }
    for (const r of returns) { ev.push({ at: r.created_at, what: html`Return ${idLink(r.number)} requested: ${words(r.reason)}`, icon: "ret", tone: "warn" }); if (r.refunded_at) ev.push({ at: r.refunded_at, what: html`Refund of ${money2(r.refund_amount)} paid for ${idLink(r.number)}`, icon: "coins", tone: "good" }); }
    for (const c of cases) ev.push({ at: c.opened_at, what: html`${c.is_complaint ? "Complaint" : "Case"} ${idLink(c.number)} opened: ${c.subject}`, icon: "headset", tone: c.is_complaint ? "serious" : "warn" });
    for (const c of convs) ev.push({ at: c.started_at, what: html`${CHANNELS[c.channel] || c.channel} conversation ${idLink(c.id)}: ${c.summary || ""}`, icon: "chat", tone: "ai" });
    for (const r of reps) ev.push({ at: r.created_at, what: html`Repair ${idLink(r.number)} requested: ${r.fault}`, icon: "wrench", tone: "ai" });
    for (const r of revs) ev.push({ at: r.date + "T12:00", what: html`Reviewed ${stars(r.rating)} “${r.text}”`, icon: "star" });
    ev.sort((x, y) => x.at.localeCompare(y.at));
    const addr = o.delivery.address || {};
    return html`${head(o.number, html`Placed ${dateTime(o.placed_at)} (${ago(o.placed_at)}) by ${await who(o.customer_id)}`, [pill(o.status), pill(o.payment.status, "pay")], drawer ? "" : html`<a class="btn" href="#/orders?open=${o.number}">${icon("cart")} In the list</a>`)}
      ${storyNote(st)}
      ${o.note ? html`<div class="note warn" style="margin-bottom:16px">${icon("chat")}<span><b>Note from the customer:</b> “${o.note}”</span></div>` : ""}
      ${o.recall ? html`<div class="note crit" style="margin-bottom:16px">${icon("alert")}<span><b>Safety recall ${o.recall.id}:</b> ${o.recall.issue}</span></div>` : ""}
      <div class="cols main-aside">
        <div class="stack">
          ${panel("What was bought", html`<div class="tbl-wrap" style="margin:-4px -16px -16px"><table><thead><tr><th scope="col">Item</th><th class="num" scope="col">Qty</th><th class="num" scope="col">Each</th><th class="num" scope="col">Total</th></tr></thead><tbody>${o.items.map((i) => html`<tr><td>${skuLink(i.sku)}</td><td class="num">${i.qty}</td><td class="num">${money2(i.unit_price)}</td><td class="num">${money2(i.qty * i.unit_price)}</td></tr>`)}</tbody>
            <tfoot>${[["Items", o.totals.items], ["Delivery", o.totals.delivery], o.totals.discount ? [`Discount${o.discount_code ? " (" + o.discount_code + ")" : ""}`, -o.totals.discount] : null, ["Paid", o.totals.total, 1], o.payment.refunded ? ["Refunded", -o.payment.refunded] : null].filter(Boolean).map(([k, v, b]) => html`<tr><td colspan="3" class="num ${b ? "strong" : "muted"}" style="height:32px;border:0">${k}</td><td class="num ${b ? "strong" : ""}" style="border:0">${money2(v)}</td></tr>`)}</tfoot></table></div>`)}
          ${panel("The order's story", tl(ev), { sub: `${ev.length} events, oldest first` })}
          ${o.shipments.length ? panel("Parcels", html`<div class="tbl-wrap" style="margin:-4px -16px -16px"><table class="cards"><thead><tr><th scope="col">Parcel</th><th scope="col">What</th><th scope="col">Carrier</th><th scope="col">Due</th><th scope="col">Status</th></tr></thead><tbody>${o.shipments.map((s) => html`<tr><td>${idLink(s.id)}<span class="sub mono">${s.tracking || ""}</span></td><td>${s.skus.map((k) => html`<div class="small">${skuName(k)}</div>`)}</td><td>${s.carrier || "–"}</td><td>${date(s.eta)}</td><td>${pill(s.status)}</td></tr>`)}</tbody></table></div>`) : ""}
          ${ledger ? panel("In the ledger", ledger.length ? html`<div class="tbl-wrap" style="margin:-4px -16px -16px"><table><tbody>${ledger.map((e) => html`<tr class="link"><td>${idLink(e[0])}</td><td>${cap(words(e[2]))}</td><td class="muted small">${dateTime(e[1])}</td><td class="num">${money2(e[3])}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">No ledger entries. Orders placed through the engine do not write sales to the ledger.</p>`, { sub: "Every pound this order moved" }) : ""}
        </div>
        <div class="stack">
          ${panel("Payment", kv([["Status", pill(o.payment.status, "pay")], ["How", o.payment.method], o.payment.due ? ["Owed", html`${money2(o.payment.due)} by ${date(o.payment.due_date)}`] : null, ["Refunded", money2(o.payment.refunded || 0)]]))}
          ${panel("Delivery", kv([["Method", cap(words(o.delivery.method))], ["Address", seeC ? html`${addr.line1}<br>${addr.town} ${addr.postcode}` : redact("address hidden", false)]]))}
          ${linked("Linked records", [...returns.map((r) => li(r.number, `Return ${r.number}`, words(r.reason), pill(r.status, "ret"))), ...cases.map((c) => li(c.number, c.subject, `${c.number} · ${words(c.category)}`, pill(c.status))), ...convs.map((c) => li(c.id, `${CHANNELS[c.channel] || c.channel} conversation`, c.summary, `${c.messages.length} messages`)), ...contacts.map((c) => li(c.id, `${CHANNELS[c.channel]} contact`, c.summary || words(c.topic), pill(c.outcome))), ...regs.map((r) => li(r.id, `Registered ${skuName(r.sku)}`, `Warranty to ${date(r.warranty_until)}`)), ...reps.map((r) => li(r.number, `Repair ${r.number}`, r.fault, pill(r.status, "rep"))), ...revs.map((r) => li(r.id, `Review ${r.rating}/5`, r.text))])}
        </div>
      </div>`;
  },

  async customer({ rec: c, bundle: b }, drawer) {
    const id = c.id;
    const st = await storiesFor(id);
    const own = (k) => b[k].filter((r) => r.customer_id === id);
    const orders = own("orders"), returns = own("returns"), cases = own("cases"), convs = own("conversations"), contacts = own("contacts"), regs = own("registrations"), reps = own("repairs"), revs = own("reviews");
    const idx = (await customers()).get(id);
    const paid = orders.filter((o) => o.payment.status !== "declined");
    const SEG = { regular: ["Regular", "good"], one_time: ["One-time buyer", ""], business: ["Business buyer", "ai"], returner: ["Frequent returner", "warn"], complainer: ["Complainer", "serious"] };
    const seeContact = access("customers") !== "none" && !(S.role === "operations_assistant");
    const ev = [];
    for (const o of orders) ev.push({ k: "orders", at: o.placed_at, what: html`Ordered ${idLink(o.number)}: ${o.items.map((i) => `${i.qty} × ${skuName(i.sku)}`).join(", ")}`, icon: "cart", tone: o.payment.status === "declined" ? "crit" : "info", right: money2(o.totals.total) });
    for (const r of returns) ev.push({ k: "returns", at: r.created_at, what: html`Returned ${r.items.map((i) => skuName(i.sku)).join(", ")} (${words(r.reason)}) ${idLink(r.number)}`, icon: "ret", tone: "warn" });
    for (const k of cases) ev.push({ k: "service", at: k.opened_at, what: html`${k.is_complaint ? "Complaint" : "Case"} ${idLink(k.number)}: ${k.subject}`, icon: "headset", tone: k.is_complaint ? "serious" : "warn" });
    for (const t of contacts) ev.push({ k: "service", at: t.at, what: html`${CHANNELS[t.channel]} ${idLink(t.id)}: ${t.summary || words(t.topic)}`, icon: "chat", body: html`Handled by ${roleName(t.handled_by)} · first reply ${minutes(t.first_reply_minutes)} · ${statusLabel(t.outcome)}` });
    for (const cv of convs) ev.push({ k: "service", at: cv.started_at, what: html`${CHANNELS[cv.channel] || cv.channel} conversation ${idLink(cv.id)}: ${cv.summary || ""}`, icon: "chat", tone: "ai", conv: cv });
    for (const r of reps) ev.push({ k: "repairs", at: r.created_at, what: html`Repair ${idLink(r.number)} for ${skuName(r.sku)}: ${r.fault}`, icon: "wrench", tone: "ai" });
    for (const r of regs) ev.push({ k: "repairs", at: r.purchased_at + "T12:00", what: html`Registered ${skuName(r.sku)} ${idLink(r.id)}, warranty to ${date(r.warranty_until)}`, icon: "shield" });
    for (const r of revs) ev.push({ k: "orders", at: r.date + "T12:00", what: html`Reviewed ${productById(r.product)?.name} ${stars(r.rating)} “${r.text}”`, icon: "star" });
    ev.sort((x, y) => y.at.localeCompare(x.at));
    lastEv = ev;
    const ad = c.addresses.find((x) => x.default) || c.addresses[0];
    return html`<div class="rec-head"><div class="row" style="gap:14px;flex-wrap:nowrap;min-width:0">${avatar(id, c.name, "lg")}<div style="min-width:0"><h1>${c.name} ${(idx?.segs || []).map((s) => tonePill(SEG[s][0], SEG[s][1], S.meta.segments[s]))}</h1><p class="sub"><span class="mono">${id}</span> · customer since ${date(c.created_at)} · ${ad?.town || ""}</p></div></div></div>
      ${storyNote(st)}
      ${strip([stat("Paid orders", num(paid.length)), stat("Spent, after refunds", money(idx?.spend)), stat("Returns", num(returns.length)), stat("Cases", num(cases.length), `${cases.filter((k) => k.is_complaint).length} complaints`), stat("Contacts", num(contacts.length)), stat("Account credit", money2(c.credit_balance))])}
      <div class="cols main-aside" style="margin-top:16px">
        <div class="stack">
          <section class="panel"><div class="panel-h"><h2>Everything, newest first</h2><span class="act"><span class="seg" role="group" aria-label="Show">${[["all", "All"], ["orders", "Orders"], ["service", "Service"], ["returns", "Returns"], ["repairs", "Repairs and warranty"]].map(([k, l], i) => html`<button aria-pressed="${i === 0}" data-ev="${k}">${l}</button>`)}</span></span></div><div class="panel-b" id="custTl"></div></section>
          ${convs.length ? panel("Conversations", html`<div class="stack">${convs.sort((x, y) => y.started_at.localeCompare(x.started_at)).map((cv) => html`<details ${cv === convs[0] ? raw("open") : ""}><summary class="row" style="cursor:pointer;padding:4px 0"><b>${CHANNELS[cv.channel] || cv.channel}</b><span class="muted small">${dateTime(cv.started_at)} · ${cv.messages.length} messages</span>${idLink(cv.id)}</summary>${thread(cv)}</details>`)}</div>`) : ""}
        </div>
        <div class="stack">
          ${panel("Spend by year", html`<div id="spendChart"></div>`, { sub: "Paid orders, before refunds" })}
          ${panel("Details", kv([["Email", redact(c.email, seeContact)], ["Phone", redact(c.phone, seeContact)], ["Address", seeContact ? html`${ad?.line1}<br>${ad?.town} ${ad?.postcode}` : redact("address", false)], ["Prefers", cap(words(c.contact_preference))], ["Marketing", c.marketing_opt_in ? "Agreed" : "Not agreed"], ["Staff notes", c.notes || html`<span class="muted">None</span>`]]))}
          ${regs.length ? linked("Registered products", regs.map((r) => li(r.id, skuName(r.sku), `Serial ${r.serial}`, daysFrom(S.meta.now, r.warranty_until) > 0 ? tonePill("In warranty", "good") : tonePill("Expired", "")))) : ""}
        </div>
      </div>`;
  },

  async shipment({ rec: s, order: o }) {
    const lateBy = s.delivered_at ? daysFrom(s.eta, s.delivered_at) : s.eta && s.eta < S.meta.now.slice(0, 10) ? daysFrom(s.eta, S.meta.now) : 0;
    return html`${head(s.id, html`A parcel in ${idLink(o.number)} for ${await who(o.customer_id)}`, [pill(s.status)])}
      ${await storiesFor(o.number).then(storyNote)}
      <div class="cols c2">${panel("The parcel", kv([["Carrier", s.carrier || "–"], ["Tracking", s.tracking ? html`<span class="mono">${s.tracking}</span>` : "–"], ["Sent", dateTime(s.dispatched_at)], ["Due", date(s.eta)], ["Arrived", s.delivered_at ? dateTime(s.delivered_at) : "Not yet"], ["Late by", lateBy > 0 ? tonePill(`${lateBy} days`, "serious") : "On time"], s.note ? ["Note", s.note] : null]))}
      ${panel("What is inside", html`<ul class="list" style="margin:-8px -16px -16px">${s.skus.map((k) => html`<li>${skuLink(k)}</li>`)}</ul>`)}</div>`;
  },

  async returns({ rec: r }) {
    const st = await storiesFor(r.number, r.order_number);
    const ledger = await ledgerFor(r.number, r.created_at.slice(0, 4));
    return html`${head(`Return ${r.number}`, html`On ${idLink(r.order_number)} by ${await who(r.customer_id)} · ${words(r.reason)}`, [pill(r.status, "ret")])}${storyNote(st)}
      <div class="cols c2">${panel("The return", kv([["Reason", cap(words(r.reason))], ["Asked", dateTime(r.created_at)], ["Postage taken off", money2(r.postage_deducted || 0)], ["Refund", money2(r.refund_amount)], ["Refunded", r.refunded_at ? dateTime(r.refunded_at) : "Not yet"], r.note ? ["Note", r.note] : null]))}
      ${panel("Items", html`<ul class="list" style="margin:-8px -16px -16px">${r.items.map((i) => html`<li>${skuLink(i.sku)}<span class="meta">× ${i.qty}</span></li>`)}</ul>`)}</div>
      ${ledger?.length ? html`<div class="section">${panel("Refunds in the ledger", html`<ul class="list" style="margin:-8px -16px -16px">${ledger.map((e) => li(e[0], cap(words(e[2])), dateTime(e[1]), money2(e[3])))}</ul>`, { sub: ledger.length > 1 ? "More than one refund entry for this return" : "" })}</div>` : ""}`;
  },

  async registrations({ rec: r }) {
    const live = daysFrom(S.meta.now, r.warranty_until) > 0;
    return html`${head(`Registration ${r.id}`, html`${skuName(r.sku)} for ${await who(r.customer_id)}`, [live ? tonePill("In warranty", "good") : tonePill("Warranty ended", "")])}
      ${panel("Registered product", kv([["Product", skuLink(r.sku)], ["Serial", html`<span class="mono">${r.serial}</span>`], ["Bought", html`${date(r.purchased_at)} on ${idLink(r.order_number)}`], ["Warranty until", html`${date(r.warranty_until)} (${ago(r.warranty_until)})`]]))}`;
  },

  async repairs({ rec: f }) {
    const st = await storiesFor(f.number, f.customer_id);
    return html`${head(`Repair ${f.number}`, html`${skuName(f.sku)} for ${await who(f.customer_id)}`, [pill(f.status, "rep"), f.in_warranty ? tonePill("In warranty", "good") : tonePill("Out of warranty", "")])}${storyNote(st)}
      <div class="cols main-aside"><div class="stack">${panel("What happened", tl((f.history || []).map((h) => ({ at: h.at, what: h.event, icon: "wrench", tone: /quote/i.test(h.event) ? "warn" : /return|repaired/i.test(h.event) ? "good" : "" }))))}</div>
      <div class="stack">${panel("The fault", kv([["Product", skuLink(f.sku)], ["Fault", f.fault], ["Order", f.order_number ? idLink(f.order_number) : "–"], ["Registration", f.registration_id ? idLink(f.registration_id) : "Not registered"], f.batch ? ["Came from", idLink(f.batch), "The purchase order (delivery batch) the unit came from"] : null, ["Opened", dateTime(f.created_at)]]))}
      ${f.quote ? panel("Quote", html`${kv(f.quote.lines.map((l) => [l.name, money2(l.price)]))}<div class="row" style="margin-top:10px;justify-content:space-between"><b>Total ${money2(f.quote.total)}</b><span class="muted small">Valid to ${date(f.quote.valid_until)}</span></div>`) : ""}</div></div>`;
  },

  async cases({ rec: k, bundle: b }) {
    const st = await storiesFor(k.number, k.customer_id);
    const convs = b.conversations.filter((c) => c.case_number === k.number), contacts = b.contacts.filter((c) => c.case_number === k.number);
    const due = k.is_complaint ? (k.complaint_stage === 2 ? 10 : 3) : null;
    return html`${head(k.subject, html`<span class="mono">${k.number}</span> · ${cap(words(k.category))} · opened ${dateTime(k.opened_at)} by ${await who(k.customer_id)}`, [pill(k.status), k.is_complaint ? tonePill(`Complaint, stage ${k.complaint_stage}`, "serious", `Stage ${k.complaint_stage}: answer within ${due} working days`) : ""])}${storyNote(st)}
      <div class="cols main-aside"><div class="stack">${panel("Notes", tl((k.notes || []).map((n) => ({ at: n.at, what: html`<b>${roleName(n.by)}</b>`, body: n.text, icon: isAI(n.by) ? "spark" : "chat", tone: isAI(n.by) ? "ai" : "info" }))), { sub: `${(k.notes || []).length} notes` })}
        ${convs.map((cv) => panel(`${CHANNELS[cv.channel] || cv.channel} conversation`, thread(cv), { sub: html`${idLink(cv.id)} · ${dateTime(cv.started_at)}` }))}</div>
      <div class="stack">${panel("Case", kv([["Status", pill(k.status)], ["Category", cap(words(k.category))], k.escalated_to ? ["Passed to", roleName(k.escalated_to)] : null, ...Object.entries(k.related || {}).map(([t, v]) => [cap(t), idLink(v)])]))}
        ${linked("Contacts about it", contacts.map((c) => li(c.id, `${CHANNELS[c.channel]} contact`, c.summary || words(c.topic), dateShort(c.at))))}</div></div>`;
  },

  async conversations({ rec: cv }) {
    const st = await storiesFor(cv.id, cv.customer_id);
    return html`${head(`${CHANNELS[cv.channel] || cv.channel} conversation`, html`<span class="mono">${cv.id}</span> · ${dateTime(cv.started_at)} · ${await who(cv.customer_id)}${cv.case_number ? html` · case ${idLink(cv.case_number)}` : ""}`, [tonePill(`${cv.messages.length} messages`, "ai")])}${storyNote(st)}
      ${cv.summary ? html`<p class="lede" style="margin-bottom:14px">${cv.summary}</p>` : ""}${panel("Thread", thread(cv))}`;
  },

  async contacts({ rec: c }) {
    return html`${head(`${CHANNELS[c.channel]} contact`, html`<span class="mono">${c.id}</span> · ${dateTime(c.at)} · ${await who(c.customer_id)}`, [pill(c.outcome)])}${await storiesFor(c.id, c.customer_id).then(storyNote)}
      ${panel("Contact", kv([["About", cap(words(c.topic))], ["Summary", c.summary || "–"], ["Handled by", c.handled_by ? roleName(c.handled_by) : "Nobody yet"], ["First reply", minutes(c.first_reply_minutes), "Minutes from the message to the first reply"], ["Resolved in", minutes(c.resolve_minutes)], ["Outcome", pill(c.outcome)], c.case_number ? ["Case", idLink(c.case_number)] : null]))}`;
  },

  async reviews({ rec: r }) {
    return html`${head(`Review ${r.id}`, html`${productById(r.product)?.name} · ${await who(r.customer_id)} · ${date(r.date)}`, [stars(r.rating)])}
      ${panel("Review", html`<p class="lede">“${r.text}”</p><div style="margin-top:12px">${kv([["Product", prodLink(r.product)], ["Order", idLink(r.order_number)], ["Rating", `${r.rating} out of 5`]])}</div>`, { sub: "Internal: the website does not show reviews" })}`;
  },

  async purchase_order({ rec: p }) {
    const { suppliers } = await load("buying.json");
    const s = suppliers.find((x) => x.id === p.s);
    const st = await storiesFor(p.n, p.s);
    return html`${head(p.n, html`To ${idLink(p.s)} ${s?.name} · ordered ${dateTime(p.o)}`, [pill(p.st, "po"), p.late ? tonePill(`${p.late} days late`, "serious") : ""])}${storyNote(st)}
      <div class="cols main-aside"><div class="stack">${panel("Lines", html`<div class="tbl-wrap" style="margin:-4px -16px -16px"><table><thead><tr><th scope="col">SKU</th><th class="num" scope="col">Ordered</th><th class="num" scope="col">Arrived</th><th class="num" scope="col" title="What one costs us">Unit cost</th><th class="num" scope="col">Value</th></tr></thead><tbody>${p.l.map((l) => html`<tr><td>${skuLink(l[0])}</td><td class="num">${num(l[1])}</td><td class="num">${num(l[3])}</td><td class="num">${money2(l[2])}</td><td class="num">${money2(l[1] * l[2])}</td></tr>`)}</tbody></table></div>`, { sub: `${money2(p.v)} in all` })}
        ${p.note ? html`<div class="note">${icon("doc")}<span>${p.note}</span></div>` : ""}</div>
      <div class="stack">${panel("Dates", tl([{ at: p.o, what: "Sent to the supplier", icon: "factory", tone: "info" }, { at: p.d + "T12:00", what: "Due", icon: "clock" }, p.e ? { at: p.e + "T12:00", what: "New date from the supplier", icon: "clock", tone: "warn" } : null, p.r ? { at: p.r, what: "Arrived", icon: "check", tone: p.late ? "serious" : "good" } : null, p.pd ? { at: p.pd, what: "Paid", icon: "coins", tone: "good" } : null].filter(Boolean).sort((a, b) => a.at.localeCompare(b.at))))}</div></div>`;
  },

  async supplier({ rec: s }) {
    const { pos } = await load("buying.json");
    const mine = pos.filter((p) => p.s === s.id);
    const st = await storiesFor(s.id);
    return html`${head(s.name, html`<span class="mono">${s.id}</span> · ${s.town}, ${s.country}${s.mto ? " · makes to order each morning" : ""}`, [s.on_time == null ? "" : s.on_time >= 0.95 ? tonePill("Usually on time", "good", "Share of its deliveries that arrived by the due date") : s.on_time >= 0.85 ? tonePill("Sometimes late", "warn") : tonePill("Often late", "serious")])}${storyNote(st)}
      ${strip([stat("Lead time", `${s.lead_time_days} days`), stat("Arrived on time", pct(s.on_time), `${s.late_count} of ${s.delivered} deliveries late`), stat("Average lateness", s.avg_late ? `${s.avg_late} days` : "–", "When late"), stat("Bought from them", money(s.spent), `${num(s.pos)} purchase orders`), stat("Open orders", num(s.open))])}
      <div class="cols main-aside" style="margin-top:16px"><div class="stack">${panel("Purchase orders", html`<div class="tbl-wrap tall" style="margin:-4px -16px -16px"><table><thead><tr><th scope="col">Order</th><th scope="col">Ordered</th><th scope="col">Due</th><th scope="col">Status</th><th class="num" scope="col">Value</th></tr></thead><tbody>${mine.slice(0, 120).map((p) => html`<tr><td>${idLink(p.n)}</td><td>${date(p.o)}</td><td>${date(p.d)}</td><td>${pill(p.st, "po")} ${p.late ? html`<span class="small down">${p.late}d late</span>` : ""}</td><td class="num">${money2(p.v)}</td></tr>`)}</tbody></table></div>`, { sub: mine.length > 120 ? `Newest 120 of ${mine.length}` : `${mine.length}` })}</div>
      <div class="stack">${panel("What they make", html`<ul class="list" style="margin:-8px -16px -16px">${s.skus.map((k) => html`<li>${skuLink(k)}<span class="meta" title="What one costs us">${access("cost") === "none" ? "" : money2(s.unit_cost[k])}</span></li>`)}</ul>`)}
        ${panel("Terms", kv([["Smallest order", `${s.min_order_qty} per line`], ["We pay within", `${s.payment_terms_days} days`], ["Reliability setting", pct(s.reliability), "How reliable the world generator makes this supplier. The on-time share above is what actually happened"], ["Notes", s.notes]]))}</div></div>`;
  },

  async stock_count({ rec: c }) {
    return html`${head(`Shelf count ${c.id}`, html`${skuName(c.sku)} · ${dateTime(c.at)}`, [c.difference === 0 ? tonePill("Matches", "good") : tonePill(`${c.difference > 0 ? "+" : ""}${c.difference}`, c.adjusted ? "warn" : "crit"), c.difference && !c.adjusted ? tonePill("Not adjusted", "crit") : ""])}${await storiesFor(c.id).then(storyNote)}
      ${panel("The count", kv([["Product", skuLink(c.sku)], ["System said", num(c.system_qty)], ["Counted", num(c.counted_qty)], ["Difference", num(c.difference)], ["Stock adjusted", c.adjusted ? "Yes" : "No"], ["Note", c.note]]))}`;
  },

  async movement({ rec: m }) {
    return html`${head(m.id, html`${skuName(m.sku)} · ${dateTime(m.at)}`, [tonePill(`${m.qty > 0 ? "+" : ""}${m.qty}`, m.qty > 0 ? "good" : "info"), tonePill(cap(words(m.reason)), "")])}
      ${panel("Stock movement", kv([["Product", skuLink(m.sku)], ["Change", `${m.qty > 0 ? "+" : ""}${m.qty}`], ["Why", cap(words(m.reason))], ["Caused by", m.reference ? idLink(m.reference) : "–"]]))}`;
  },

  async ledger({ rec: e }) {
    return html`${head(e.id, html`${cap(words(e.type))} · ${dateTime(e.at)}`, [tonePill(money2(e.amount), e.amount >= 0 ? "good" : "")])}${await storiesFor(e.id, e.reference).then(storyNote)}
      ${panel("Ledger entry", kv([["Type", cap(words(e.type))], ["Amount", money2(e.amount)], ["For", e.reference ? (/^[A-Z]+-/.test(e.reference) ? idLink(e.reference) : e.reference) : "–"], e.reason ? ["Reason", e.reason] : null]))}`;
  },

  async document({ rec: d }) {
    const st = await storiesFor(d.id);
    return html`${head(d.title, html`<span class="mono">${d.id}</span> · ${cap(words(d.kind))} · written ${date(d.written_at)}`, [pill(d.status)])}${storyNote(st)}
      ${d.status === "out_of_date" ? html`<div class="note warn" style="margin-bottom:14px">${icon("alert")}<span>Marked out of date. Staff and the operations assistant can still find it with <code>search_documents</code>.</span></div>` : ""}
      ${S.spoilers && d.checks?.length ? html`<div class="spoil">${icon("flag")}<b>What it gets wrong:</b> ${d.checks.map((c) => html`<span>${Object.entries(c).map(([k, v]) => `${k}: ${v}`).join(", ")}</span>`)}</div>` : ""}
      <div class="panel"><div class="panel-b md">${markdown(d.body)}</div></div>`;
  },

  async campaign({ rec: c }) {
    return html`${head(c.name, html`<span class="mono">${c.id}</span> · ${cap(c.channel)} · ${date(c.start)} to ${date(c.end)}`, [c.code ? tonePill(`Code ${c.code}`, "ai") : ""])}
      ${strip([stat("Spend", money(c.spend)), stat("Visits", num(c.visits)), stat("Orders put down to it", num(c.orders_attributed), "By the generator's attribution"), stat("Orders with its code", c.code ? num(c.code_orders) : "–", c.code ? money(c.code_money) : "No code"), stat("Cost per order", c.orders_attributed ? money2(c.spend / c.orders_attributed) : "–")])}`;
  },
};

function thread(cv) {
  return html`<div class="thread">${cv.messages.map((m) => { const us = m.from !== "customer"; return html`<div class="msg ${us ? "us" : "them"} ${isAI(m.from) ? "ai" : ""}"><span class="by">${us ? roleName(m.from) : "Customer"} · ${time(m.at) || date(m.at)}</span><div class="bubble">${m.text}</div></div>`; })}</div>`;
}

let lastEv = [];
const after = {
  customer(el, found) {
    const ev = lastEv;
    const box = el.querySelector("#custTl");
    const draw = (k) => { const list = ev.filter((e) => k === "all" || e.k === k); box.innerHTML = list.length ? String(tl(list.slice(0, 200))) : String(html`<div class="empty"><b>Nothing of this kind.</b></div>`); };
    el.querySelectorAll("[data-ev]").forEach((b) => (b.onclick = () => { el.querySelectorAll("[data-ev]").forEach((x) => x.setAttribute("aria-pressed", x === b)); draw(b.dataset.ev); }));
    draw("all");
    const years = {};
    for (const o of found.bundle.orders.filter((o) => o.customer_id === found.rec.id && o.payment.status !== "declined")) years[o.placed_at.slice(0, 4)] = (years[o.placed_at.slice(0, 4)] || 0) + o.totals.total;
    const ys = Object.keys(years).sort();
    const sc = el.querySelector("#spendChart");
    if (ys.length) barChart(sc, { labels: ys, values: ys.map((y) => years[y]), fmt: money, name: "Spent", height: 150, labelBars: ys.length <= 6, title: "Spend by year" }); else sc.innerHTML = String(html`<p class="muted">No paid orders yet.</p>`);
  },
};
