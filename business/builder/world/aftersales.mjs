// Turns the simulation's plans into records as they stand at "now": orders with shipments and history,
// returns, registrations, repairs, contacts, cases, conversations and reviews.
import fs from "node:fs";
import { rngFor } from "./rng.mjs";
import { reviewText } from "./review-lines.mjs";
import { DAY, HOUR, MINUTE, at, dayStart, dateOf, iso, parse, addMonths, round2 } from "./calendar.mjs";

/** Buyers of a Fix Club product who register it. WHY: registration is optional and most people skip it. */
const REGISTER_RATE = 0.35;
/** Tech units (Blip, Boombox Mini) that come in for repair over their life. */
export const TECH_REPAIR_RATE = 0.04;
/** Other Fix Club products that come in for repair. WHY: bags, umbrellas and helmets break less often than electronics. */
const OTHER_REPAIR_RATE = 0.012;
/** Extra "won't charge" repairs for Boombox Minis from the bad batch. */
const BAD_BATCH_RATE = 0.15;
/** Contacts per order. WHY: small shops see roughly one question for every four orders. */
export const CONTACT_RATE = 0.25;
/** Customers who complain often get in touch this many times per order. */
const COMPLAINER_CONTACT_RATE = 1.2;
/** Questions from people who have not ordered, per order. */
const PRESALE_RATE = 0.05;
/** The simulator's review settings (business/data/sim.json "reviews"), so history and simulation rate the shop alike. */
const SIM_REVIEWS = JSON.parse(fs.readFileSync(new URL("../../data/sim.json", import.meta.url), "utf8")).reviews;
/** Delivered orders that get a review. */
const REVIEW_RATE = SIM_REVIEWS.rate_per_delivered_order;
/** The AI assistant answers web chat from this date. Before it, a support agent did. */
const ASSISTANT_FROM = parse("2025-06-02");

/** How a card payment reads on an order. WHY: an ordinary card record, as a payment provider would show it. */
const CARDS = ["Visa debit ending 4242", "Mastercard ending 4444", "Visa ending 0005", "Visa debit ending 1881", "Mastercard debit ending 3220", "Amex ending 1005"];
const FAULTS = {
  blip: ["Battery drains overnight", "Screen flickers", "Will not turn on", "Screen cracked after a drop"],
  "boombox-mini": ["Will not charge", "Speaker crackles at high volume", "Bluetooth keeps dropping"],
  daypack: ["Zip splits at the end", "Strap stitching coming away", "Chest buckle snapped"],
  "indoor-helmet": ["Strap clip broken", "Padding coming loose"],
  "other-umbrella": ["Rib bent and sticks when opening", "Catch will not hold it closed"],
  "starter-puddle": ["Chip on one edge", "Surface clouded"],
  trophy: ["Cup loose on the stem", "Gold plating worn at the rim"],
};
const ACCIDENTAL = /drop/;

/** Each piece of the world gets ids in time order. */
const numberFrom = (prefix, start, width = 4) => { let n = start - 1; return () => `${prefix}-${String(++n).padStart(width, "0")}`; };

// ---------------------------------------------------------------- orders

function shipmentStatus(s, now) {
  if (now < s.dispatch - 2 * HOUR) return "pending";
  if (now < s.dispatch) return "packed";
  if (s.lost) return now >= s.lostAt ? "lost" : "in_transit";
  if (s.delivered <= now) return "delivered";
  if (s.late && now > s.eta + DAY) return "delayed";
  return "in_transit";
}

/** One generated order as a record, at "now". */
export function orderRecord(o, now, cat, customer, track) {
  const rng = rngFor(o.number, "card");
  const history = [{ at: iso(o.placed), event: "Order placed" }];
  const rec = {
    number: o.number, customer_id: o.customer_id, placed_at: iso(o.placed), status: "paid",
    items: o.lines.map((l) => ({ sku: l.sku, name: cat.skus[l.sku].name, qty: l.qty, unit_price: l.unit_price })),
    totals: { items: o.items, delivery: o.delivery, discount: o.discount, total: o.total },
    payment: { status: "paid", method: rng.pick(CARDS), refunded: 0 },
    delivery: { method: o.method, address: (({ line1, town, postcode }) => ({ line1, town, postcode }))(customer.addresses[0]) },
    shipments: [], history,
  };
  if (o.code) rec.discount_code = o.code;
  o.refunds = [];
  if (o.payFail) {
    rec.payment = { status: "declined", method: "Visa debit ending 0002", refunded: 0 };
    history.push({ at: iso(o.placed + MINUTE), event: "Payment declined. Order held for 24 hours." });
    if (now - o.placed > 24 * HOUR) {
      rec.status = "cancelled";
      history.push({ at: iso(o.placed + 24 * HOUR), event: "Cancelled: payment not completed within 24 hours." });
    } else rec.status = "payment_failed";
    return rec;
  }
  history.push({ at: iso(o.placed + MINUTE), event: "Payment taken" });
  if (o.cancelAt) {
    rec.status = "cancelled";
    rec.payment.status = "refunded"; rec.payment.refunded = o.total;
    o.refunds.push({ at: o.cancelAt, amount: o.total, reference: o.number });
    history.push({ at: iso(o.cancelAt), event: "Order cancelled at the customer's request before packing. Refunded in full." });
    return rec;
  }
  let k = 0;
  const ship = (s, skus, status, extra) => {
    const id = `SHP-${o.number.slice(4)}-${++k}`;
    const dispatched = !["pending", "packed"].includes(status);
    const chilled = s.kind === "chilled";
    const out = { id, skus, status, carrier: status === "pending" ? null : chilled ? "Coldline Couriers" : "Swiftway Parcels",
      tracking: dispatched ? (chilled ? "CC" : "HP") + String(track.next++) + "GB" : null,
      dispatched_at: dispatched ? iso(extra.dispatch) : null, eta: dateOf(extra.eta), delivered_at: status === "delivered" ? iso(extra.delivered) : null };
    if (extra.note) out.note = extra.note;
    rec.shipments.push(out);
    if (status !== "pending") history.push({ at: iso(extra.dispatch - 2 * HOUR), event: `Packed (${id})` });
    if (dispatched) history.push({ at: iso(extra.dispatch), event: `Dispatched (${id})` });
    if (status === "delivered") history.push({ at: iso(extra.delivered), event: `Delivered (${id})` });
    return out;
  };
  for (const s of o.shipments) {
    const status = shipmentStatus(s, now);
    const note = !(s.late && status === "delivered") ? null
      : s.eventDelay ? "Delivered after the estimated date. The carrier reported delays in the area." : "Delivered after the estimated date. The carrier missed a depot connection.";
    ship(s, s.skus, status, { ...s, note });
    if (status === "delayed") history.push({ at: iso(s.eta + 12 * HOUR), event: `Carrier reports a delay (SHP-${o.number.slice(4)}-${k})` });
    if (status === "lost") {
      history.push({ at: iso(s.lostAt), event: `Carrier marked the parcel lost (SHP-${o.number.slice(4)}-${k})` });
      if (s.refundInstead) {
        // No stock to send a replacement, so the lost items are refunded at the price paid.
        const items = o.lines.filter((l) => s.skus.includes(l.sku)).reduce((n, l) => n + l.qty * l.unit_price, 0);
        const amount = round2(items * (1 - o.discount / o.items));
        o.refunds.push({ at: s.replacement.dispatch, amount, reference: o.number });
        applyRefund(rec, amount, s.replacement.dispatch, `Out of stock for a replacement. Refunded £${amount.toFixed(2)}.`);
      } else if (s.replacement.dispatch <= now) {
        const rs = { ...s, kind: s.kind, delivered: s.replacement.delivered, dispatch: s.replacement.dispatch, eta: dayStart(s.replacement.delivered), lost: false, late: false };
        ship(rs, s.skus, shipmentStatus(rs, now), { ...rs, note: "Replacement for a parcel the carrier lost." });
      }
    }
  }
  const live = rec.shipments.filter((s) => s.status !== "lost");
  if (live.length && live.every((s) => s.status === "delivered")) rec.status = "delivered";
  else if (rec.shipments.some((s) => s.dispatched_at)) rec.status = "dispatched";
  else if (rec.shipments.length && rec.shipments.every((s) => s.status === "packed")) rec.status = "packed";
  return rec;
}

/** Applies refunds to an order's payment and history. */
export function applyRefund(rec, amount, t, text) {
  rec.payment.refunded = round2(rec.payment.refunded + amount);
  rec.payment.status = rec.payment.refunded >= rec.totals.total ? "refunded" : "part_refunded";
  rec.history.push({ at: iso(t), event: text });
}

// ---------------------------------------------------------------- returns

export function returnRecords(simOrders, records, now, business, nextNumber) {
  const list = simOrders.filter((o) => o.ret && o.ret.created <= now && records.get(o.number).status === "delivered").sort((a, b) => a.ret.created - b.ret.created);
  return list.map((o) => {
    const r = o.ret, rec = records.get(o.number);
    r.number = nextNumber();
    const line = rec.items.find((i) => i.sku === r.sku);
    let status = "label_sent";
    if (r.shipped <= now) status = "in_transit";
    if (r.received <= now) status = "received";
    if (r.rejected && r.received + DAY <= now) status = "rejected";
    if (r.refunded && r.refunded <= now) status = "refunded";
    // WHY: until inspection rejects it, a return is expected to be refunded in the usual way.
    const ded = r.reason === "change_of_mind" && status !== "rejected" ? business.returns.change_of_mind_postage : 0;
    // WHY: a discount code lowered what was paid, so the refund is the discounted price.
    const paidShare = 1 - rec.totals.discount / rec.totals.items;
    const refund = status === "rejected" ? 0 : round2(round2(line.unit_price * r.qty * paidShare) - ded);
    if (status === "refunded") {
      applyRefund(rec, refund, r.refunded, `Refund of £${refund.toFixed(2)} issued for ${r.number}`);
      o.refunds.push({ at: r.refunded, amount: refund, reference: r.number });
    }
    const notes = { faulty: "Customer reports a fault.", damaged: "Arrived damaged. Photo supplied.", wrong_item: "We sent the wrong item. Free label.", change_of_mind: "" };
    return { number: r.number, order_number: o.number, customer_id: o.customer_id, created_at: iso(r.created), items: [{ sku: r.sku, qty: r.qty }],
      reason: r.reason, status, postage_deducted: ded, refund_amount: refund, refunded_at: status === "refunded" ? iso(r.refunded) : null,
      note: r.rejected && status === "rejected" ? "Failed inspection: used and not complete. Sent back to the customer." : notes[r.reason] };
  });
}

// ---------------------------------------------------------------- registrations and repairs

/** The purchase order whose stock was on the shelf when a unit was sold: its batch. */
export function batchFinder(pos) {
  const bySku = {};
  for (const po of pos) if (po.receivedAt) for (const l of po.lines) (bySku[l.sku] ||= []).push(po);
  for (const list of Object.values(bySku)) list.sort((a, b) => a.receivedAt - b.receivedAt);
  return (sku, t) => [...(bySku[sku] || [])].reverse().find((po) => po.receivedAt <= t) || null;
}

export function afterCare({ seed, simOrders, records, now, cat, batchOf, badBatch, nextReg, nextFix }) {
  const registrations = [], repairs = [];
  const statuses = cat.business.fix_club.statuses;
  for (const o of simOrders) {
    const rec = records.get(o.number);
    if (rec.status !== "delivered") continue;
    const delivered = Math.max(...rec.shipments.filter((s) => s.delivered_at).map((s) => parse(s.delivered_at)));
    for (const line of rec.items) {
      const s = cat.skus[line.sku];
      if (!s.fixable || s.accessory) continue;
      const rng = rngFor(seed, "aftercare", o.number, line.sku);
      const purchased = dateOf(delivered);
      const until = addMonths(purchased, s.warranty);
      let reg = null;
      const regAt = delivered + rng.int(0, 10) * DAY;
      if (rng.chance(REGISTER_RATE) && regAt <= now) {
        const code = cat.byProduct[s.product].code || s.product.slice(0, 4).toUpperCase();
        reg = { id: null, customer_id: o.customer_id, sku: line.sku, serial: `${code.slice(0, 3)}-${rng.int(1000, 9999)}-${String(rng.int(0, 9999)).padStart(4, "0")}`, order_number: o.number, purchased_at: purchased, warranty_until: until, _at: regAt };
        registrations.push(reg);
      }
      const batch = s.category === "tech" ? batchOf(line.sku, parse(rec.placed_at)) : null;
      const bad = badBatch && batch === badBatch && rng.chance(BAD_BATCH_RATE);
      if (!bad && !rng.chance(s.category === "tech" ? TECH_REPAIR_RATE : OTHER_REPAIR_RATE)) continue;
      const created = at(delivered + (bad ? rng.int(40, 200) : rng.int(20, 900)) * DAY, rng.int(9, 20), rng.int(0, 59));
      if (created > now) continue;
      const fault = bad ? "Will not charge" : rng.pick(FAULTS[s.product]);
      const inWarranty = dateOf(created) <= until && !ACCIDENTAL.test(fault);
      const age = (now - created) / DAY;
      const status = age > 30 ? rng.weighted([["returned", 88], ["unrepairable", 4], ["declined", 8]].filter(([x]) => statuses.includes(x)))
        : rng.pick(["requested", "awaiting_item", "received", "assessing", "in_repair"].filter((x) => statuses.includes(x)));
      const priced = (cat.byProduct[s.product].fix_club?.repairs || []).filter((r) => r.price);
      const quote = !inWarranty && priced.length && status !== "requested" ? (() => {
        const l = rng.pick(priced); const sent = created + 4 * DAY;
        return { lines: [{ code: l.code, name: l.name, price: l.price }], total: l.price, sent_at: iso(sent), valid_until: dateOf(sent + cat.business.fix_club.quote_valid_days * DAY) };
      })() : null;
      const history = [{ at: iso(created), event: "Repair requested" }];
      if (status !== "requested") history.push({ at: iso(created + DAY), event: inWarranty ? "Free label sent" : "Label sent. £15 assessment fee applies (out of warranty)." });
      if (quote) history.push({ at: quote.sent_at, event: `Quote of £${quote.total} sent` });
      if (["returned", "unrepairable", "declined"].includes(status)) history.push({ at: iso(created + rng.int(8, 16) * DAY), event: { returned: "Repaired and returned to the customer", unrepairable: "Could not be repaired. Replacement offered.", declined: "Customer declined the quote. Item sent back." }[status] });
      const fix = { number: null, customer_id: o.customer_id, sku: line.sku, registration_id: null, _reg: reg, order_number: o.number, fault, in_warranty: inWarranty,
        created_at: iso(created), status: quote && status === "assessing" ? "quote_sent" : status, quote, promised_by: null, history };
      if (batch) fix.batch = batch.number;
      repairs.push(fix);
    }
  }
  // Numbers follow the date each record was made, as they would in a real system.
  const byTime = (a, b, ta, tb) => ta - tb || a.order_number.localeCompare(b.order_number) || a.sku.localeCompare(b.sku);
  registrations.sort((a, b) => byTime(a, b, a._at, b._at)).forEach((r) => (r.id = nextReg()));
  repairs.sort((a, b) => byTime(a, b, parse(a.created_at), parse(b.created_at)));
  for (const f of repairs) { f.number = nextFix(); f.registration_id = f._reg?.id || null; delete f._reg; }
  return { registrations, repairs };
}

// ---------------------------------------------------------------- contacts, cases, conversations, reviews

const TOPIC_TEXT = {
  where_is_my_order: { subject: "Where is my parcel?", category: "delivery", ask: "Hi, my parcel hasn't arrived yet. Where is it?", answer: "I have checked the tracking. It is with the carrier and due on the date shown. If it is more than 2 working days late, tell us and a person can refund the delivery charge." },
  late_parcel: { subject: "Parcel arrived late", category: "delivery", ask: "My parcel is days late. This was meant to be a present.", answer: "I am sorry. The carrier missed its date. I have opened a case so a support agent can look at the delivery charge." },
  lost_parcel: { subject: "Parcel lost in transit", category: "delivery", ask: "Tracking hasn't moved for a week. Has it been lost?", answer: "The carrier has marked it lost. A replacement goes out on the next working day." },
  return_question: { subject: "How do I return this?", category: "returns", ask: "I'd like to send something back. How does it work?", answer: "You have 30 days from delivery. I can create the return and send a prepaid label. Change of mind costs £2.95 postage." },
  refund_chase: { subject: "When will my refund arrive?", category: "returns", ask: "I sent my return back last week. When do I get my money?", answer: "Refunds go out within 5 working days of the return passing inspection, to your original card." },
  product_question: { subject: "Question about a product", category: "product", ask: "Does this come gift-wrapped, and will it arrive before the weekend?", answer: "There is no gift wrap; everything comes in plain card packaging. Sooner arrives the next working day if you order by 2pm." },
  change_order: { subject: "Change delivery address", category: "orders", ask: "Can I change the address on my order?", answer: "Your order is not packed yet, so I have changed the address." },
  fault: { subject: "Item stopped working", category: "product", ask: "It's stopped working properly. What can I do?", answer: "That sounds like a fault. You can return it within 30 days, or use the warranty through The Fix Club after that." },
  complaint: { subject: "Unhappy with the service", category: "complaint", ask: "This is the second time something has gone wrong with my order. I want to make a complaint.", answer: "I am sorry. I have logged a stage 1 complaint. A person will acknowledge it within 1 working day and answer within 3 working days." },
  presale: { subject: "Question before buying", category: "product", ask: "Is the Daypack big enough for a 15-inch laptop?", answer: "The Laptop Sleeve takes up to 14-inch laptops. A 15-inch laptop will not fit the sleeve." },
};
const CHANNELS = [["web_chat", 45], ["email", 30], ["phone", 15], ["text", 10]];
const CONV_CHANNEL = { web_chat: "web", email: "email", phone: "phone", text: "sms" };

function topicFor(rng, o, rec, ret, type) {
  const late = o.shipments?.some((s) => s.late), lost = o.shipments?.some((s) => s.lost);
  if (type === "complainer" && rng.chance(0.3)) return "complaint";
  if (lost) return "lost_parcel";
  if (late && rng.chance(0.7)) return "late_parcel";
  if (ret && rng.chance(0.6)) return ret.reason === "faulty" ? "fault" : rng.chance(0.5) ? "return_question" : "refund_chase";
  return rng.weighted([["where_is_my_order", 40], ["product_question", 25], ["change_order", 15], ["return_question", 12], ["complaint", 3], ["fault", 5]]);
}

/** Minutes to first reply and to resolve. WHY: chat is instant, phone is answered live, email waits for working hours. */
function timings(rng, channel, handledBy) {
  if (handledBy === "assistant") return [0, rng.int(2, 15)];
  if (channel === "phone") return [rng.int(0, 4), rng.int(5, 25)];
  return [rng.int(25, 540), rng.int(60, 2880)];
}

export function contactsAndCases({ seed, simOrders, records, returnsByOrder, customers, now, nextCase, nextConv, effects = null }) {
  const contacts = [], cases = [], conversations = [], goodwill = [];
  const typeOf = Object.fromEntries(customers.map((c) => [c.id, c._type]));
  const add = (rng, t, customer_id, topic, rec, ret) => {
    if (t > now) return;
    const channel = topic === "complaint" ? rng.weighted([["email", 6], ["phone", 3], ["web_chat", 1]]) : rng.weighted(CHANNELS);
    const handledBy = topic === "complaint" ? "support_lead" : channel === "web_chat" ? (t >= ASSISTANT_FROM ? "assistant" : "support_agent") : "support_agent";
    const [first, resolve] = timings(rng, channel, handledBy);
    const needsCase = ["late_parcel", "lost_parcel", "complaint", "fault"].includes(topic) || rng.chance(0.15);
    const text = TOPIC_TEXT[topic];
    let caseRec = null;
    if (needsCase && customer_id) {
      const old = now - t > 14 * DAY;
      const status = old ? rng.weighted([["resolved", 6], ["closed", 4]]) : rng.weighted([["open", 5], ["waiting_customer", 3], ["resolved", 2]]);
      const related = {};
      if (rec) related.order = rec.number;
      if (ret) related.return = ret.number;
      const notes = [{ at: iso(t + first * MINUTE), by: handledBy, text: text.answer }];
      if (topic === "late_parcel" && rng.chance(0.4)) {
        goodwill.push({ at: t + resolve * MINUTE, customer_id, amount: 5 });
        notes.push({ at: iso(t + resolve * MINUTE), by: "support_agent", text: "Added £5 goodwill credit for the late parcel (within the agent limit)." });
      }
      caseRec = { number: nextCase(), customer_id, subject: text.subject, category: text.category, status, is_complaint: topic === "complaint",
        complaint_stage: topic === "complaint" ? 1 : null, opened_at: iso(t), related, escalated_to: topic === "complaint" ? "support_lead" : null, notes };
      if (caseRec.escalated_to) caseRec.status = old ? caseRec.status : "escalated";
      cases.push(caseRec);
      if (channel === "web_chat" && rng.chance(0.4)) {
        const who = handledBy === "assistant" ? "assistant" : "support_agent";
        conversations.push({ id: nextConv(), customer_id, channel: CONV_CHANNEL[channel], started_at: iso(t), case_number: caseRec.number, summary: text.subject + ".",
          messages: [{ from: "customer", at: iso(t), text: text.ask + (rec ? ` Order ${rec.number}.` : "") }, { from: who, at: iso(t + MINUTE), text: text.answer },
            { from: "customer", at: iso(t + 3 * MINUTE), text: "Ok, thanks." }] });
      }
    }
    const outcome = caseRec ? (caseRec.status === "escalated" ? "escalated" : "case_opened") : topic === "change_order" ? "order_changed" : "answered";
    contacts.push({ at: t, customer_id, channel, topic, handled_by: handledBy, first_reply_minutes: first, resolve_minutes: resolve, outcome, case_number: caseRec?.number || null });
  };
  for (const o of simOrders) {
    const rec = records.get(o.number);
    if (o.customer_id && !typeOf[o.customer_id]) continue; // planted customers keep only their own stories
    const rng = rngFor(seed, "contact", o.number);
    const type = typeOf[o.customer_id];
    // WHY: events such as a postal strike or Black Friday make more people get in touch about their orders.
    const lift = effects ? effects.at(o.placed, rec.delivery.address.town).contact_rate : 1;
    const rate = (type === "complainer" ? COMPLAINER_CONTACT_RATE : CONTACT_RATE) * lift;
    let n = Math.floor(rate) + (rng.chance(rate % 1) ? 1 : 0);
    const ret = returnsByOrder.get(o.number);
    for (; n > 0; n--) add(rng, o.placed + rng.int(1, 10) * DAY + rng.int(9, 19) * HOUR, o.customer_id, topicFor(rng, o, rec, ret, type), rec, ret);
    if (rng.chance(PRESALE_RATE)) add(rng, o.placed - rng.int(1, 5) * DAY, null, "presale", null, null);
  }
  return { contacts, cases, conversations, goodwill };
}

/** Contacts behind the planted stories: one per planted conversation, one per planted case without one. */
export function plantedContacts(planted) {
  const list = [];
  const byChannel = { web: "web_chat", sms: "text", phone: "phone", email: "email" };
  const withConv = new Set();
  for (const v of planted.conversations) {
    withConv.add(v.case_number);
    const firstReply = v.messages.find((m) => m.from !== "customer");
    const by = firstReply?.from || "assistant";
    const minutes = firstReply ? Math.round((parse(firstReply.at) - parse(v.messages[0].at)) / MINUTE) : null;
    const k = planted.cases.find((c) => c.number === v.case_number);
    list.push({ at: parse(v.started_at), customer_id: v.customer_id, channel: byChannel[v.channel], topic: "story", handled_by: by, first_reply_minutes: minutes,
      resolve_minutes: k && ["resolved", "closed"].includes(k.status) ? 30 : null, outcome: k ? (k.status === "escalated" ? "escalated" : "case_opened") : "answered", case_number: v.case_number, summary: v.summary });
  }
  for (const k of planted.cases) {
    if (withConv.has(k.number)) continue;
    const by = k.notes[0]?.by || "support_agent";
    list.push({ at: parse(k.opened_at), customer_id: k.customer_id, channel: by === "assistant" ? "web_chat" : "email", topic: "story", handled_by: by, first_reply_minutes: by === "assistant" ? 0 : 10,
      resolve_minutes: ["resolved", "closed"].includes(k.status) ? 60 : null, outcome: k.status === "escalated" ? "escalated" : "case_opened", case_number: k.number, summary: k.subject });
  }
  for (const c of planted.contacts) list.push({ ...c, at: parse(c.at) });
  return list;
}

/**
 * A star rating the way the simulator gives one: its base weights, shifted down by a bad experience
 * (a fault, a wrong or damaged item, a late parcel) and up a little by a smooth one.
 */
function reviewRating(rng, { bad, late }) {
  const base = rng.weighted(SIM_REVIEWS.base_rating_weights);
  if (bad) return rng.int(1, 2);
  const shift = late ? SIM_REVIEWS.rating_bad_experience_shift : SIM_REVIEWS.rating_good_experience_shift;
  // WHY: a fractional shift (+0.5) becomes a whole star half the time, so the average moves by the shift.
  const whole = Math.trunc(shift) + (rng.chance(Math.abs(shift % 1)) ? Math.sign(shift) : 0);
  return Math.min(5, Math.max(1, base + whole));
}

export function makeReviews({ seed, simOrders, records, returnsByOrder, cat, typeOf, now, nextReview }) {
  const reviews = [];
  for (const o of simOrders) {
    const rec = records.get(o.number);
    if (rec.status !== "delivered" || !typeOf[o.customer_id]) continue;
    const rng = rngFor(seed, "review", o.number);
    if (!rng.chance(REVIEW_RATE)) continue;
    const delivered = Math.max(...rec.shipments.filter((s) => s.delivered_at).map((s) => parse(s.delivered_at)));
    const t = at(delivered + rng.int(2, 14) * DAY, rng.int(8, 22));
    if (t > now) continue;
    const ret = returnsByOrder.get(o.number);
    const late = o.shipments.some((s) => s.late || s.lost);
    const rating = reviewRating(rng, { bad: Boolean(ret && ret.reason !== "change_of_mind"), late });
    const line = rec.items[0];
    const product = cat.skus[line.sku].product;
    const text = reviewText(rng, { rating, product, type: typeOf[o.customer_id], town: rec.delivery.address.town, late });
    reviews.push({ id: null, customer_id: o.customer_id, order_number: o.number, product, sku: line.sku, rating, text, date: dateOf(t) });
  }
  // Numbered by date, as a review site would.
  reviews.sort((a, b) => a.date.localeCompare(b.date) || a.order_number.localeCompare(b.order_number)).forEach((r) => (r.id = nextReview()));
  return reviews;
}

export { numberFrom };
