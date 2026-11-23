// The day-by-day simulation: orders take stock, low stock raises purchase orders, deliveries arrive
// after the supplier's lead time (sometimes late), and empty shelves turn into lost sales.
import { rngFor } from "./rng.mjs";
import { DAY, HOUR, MINUTE, at, dayStart, dateOf, isWorkday, nextWorkday, addWorkdays, weekday, parse, season, round2, iso, tradingDays } from "./calendar.mjs";
import { MADE_TO_ORDER, priceAt } from "./catalogue.mjs";
import { makeEffects } from "./effects.mjs";

// ---- rates. Each is a share of orders (or of shipments, or of purchase orders). ----
/** Card payments that fail. WHY: about 2% of online card payments are declined. */
export const PAYMENT_FAIL_RATE = 0.02;
/** Orders cancelled by the customer before packing. WHY: a small share change their mind within hours. */
export const CANCEL_RATE = 0.015;
/** Parcels that arrive after their estimated date, outside event weeks: the engine's own rate, one number in one place. */
export { LATE_RATE } from "../../../infrastructure/engine/engine.js";
import { LATE_RATE } from "../../../infrastructure/engine/engine.js";
/** Parcels lost by the carrier. WHY: about 1 in 250 parcels goes missing. */
export const LOST_RATE = 0.004;
/**
 * Orders with a returnable item that send something back, for most customers.
 * WHY: about 5%; with the few customers who return a lot (below) the overall rate is about 6%, normal for a gift shop.
 */
export const RETURN_RATE = 0.045;
/** Customers who return a lot send something back this often. */
const RETURNER_RATE = 0.2;
/** Why things come back. Faulty is a quarter of returns, so about 1.5% of orders. */
export const RETURN_REASONS = [["change_of_mind", 0.6], ["faulty", 0.25], ["damaged", 0.1], ["wrong_item", 0.05]];
/** Change-of-mind returns that fail inspection (worn, broken seal, not complete). */
const REJECT_RATE = 0.06;
/** Purchase orders a supplier cannot fill and cancels. */
const PO_CANCEL_RATE = 0.01;
/** Purchase orders that arrive short on one line. */
const PO_SHORT_RATE = 0.04;

// ---- reorder rules ----
/** Days of demand the buyer looks back over to judge the sales rate. */
const LOOKBACK_DAYS = 28;
/** Extra days of stock kept on top of the supplier's lead time, in case of late deliveries. */
const SAFETY_DAYS = 7;
/** Days of sales one purchase order should cover. WHY: six weeks keeps orders few without tying up cash. */
const COVER_DAYS = 42;
/**
 * From this many days before "now" the buyer stocks up for Christmas: every shelf product is kept at or above
 * `openingCover` (business/data/sim.json ops.opening_cover_days of the simulator's expected demand).
 * WHY: the simulator starts by topping every shelf up to that cover; if history already ends there, day one
 * needs no stock adjustment and the first simulated week looks like the last historical one.
 */
const STOCK_UP_DAYS = 70;
/** Planted orders within this many days have their stock kept back from ordinary customers. */
const RESERVE_DAYS = 60;

const CARRIER = { chilled: "Coldline Couriers", parcel: "Swiftway Parcels" };

/** Blip's supplier lead time was 10 days until September 2026. WHY: an out-of-date note quotes the old figure. */
const leadTime = (sup, t) => (sup.id === "SUP-05" && t < parse("2026-09-01") ? 10 : sup.lead_time_days);

/**
 * Parcel dates for one shipment, following the delivery rules in business.json.
 * `delayDays` comes from world events (a postal strike, snow): it may be fractional (an event ramping up),
 * so the whole part always applies and the rest is a chance of one more day.
 */
function planShipment(rng, placed, kind, skus, delayDays = 0) {
  let dispatch, eta, delivered;
  const day = dayStart(placed);
  if (kind === "chilled") {
    // Chilled goes Monday to Thursday, baked the morning it is sent, arrives the next day before 1pm.
    let d = nextWorkday(day);
    while (weekday(d) === 5) d = nextWorkday(d);
    dispatch = at(d, 9); eta = d + DAY; delivered = at(d + DAY, 11, rng.int(0, 90));
  } else if (kind === "next-day") {
    const plant = skus.some((s) => s.plant);
    let d = isWorkday(day) && placed < at(day, 14) ? day : nextWorkday(day);
    while (plant && weekday(d) === 5) d = nextWorkday(d); // plants are not sent on Fridays
    dispatch = at(d, 15); eta = nextWorkday(d); delivered = at(eta, 10, rng.int(0, 120));
  } else {
    const d = nextWorkday(day);
    dispatch = at(d, 9); eta = addWorkdays(d, 3); delivered = at(addWorkdays(d, rng.chance(0.6) ? 2 : 3), 13, rng.int(0, 180));
  }
  const s = { kind, skus: skus.map((x) => x.sku), dispatch, eta, delivered, late: false, lost: false };
  if (kind !== "chilled" && rng.chance(LOST_RATE)) {
    s.lost = true;
    s.lostAt = at(addWorkdays(eta, 5), 9);
    s.replacement = { dispatch: at(nextWorkday(s.lostAt), 9) };
    s.replacement.delivered = at(addWorkdays(dayStart(s.replacement.dispatch), 2), 12);
    s.delivered = null;
  } else if (rng.chance(LATE_RATE)) {
    s.late = true;
    s.delivered = at(addWorkdays(eta, rng.int(3, 6)), 14, rng.int(0, 120));
  }
  // WHY: the extra draw only happens on event days, so parcels on ordinary days keep exactly the same dates.
  if (delayDays > 0 && !s.lost) {
    const extra = Math.floor(delayDays) + (rng.chance(delayDays % 1) ? 1 : 0);
    if (extra > 0) {
      s.delivered = at(addWorkdays(dayStart(s.delivered), extra), 14, rng.int(0, 120));
      s.late = s.late || dayStart(s.delivered) > s.eta;
      s.eventDelay = true;
    }
  }
  return s;
}

/** A possible return for a delivered order: which line, why, and when each step happens. */
function planReturn(rng, order, cat, type, deliveredAt) {
  const eligible = order.lines.filter((l) => !cat.skus[l.sku].chilled && !cat.skus[l.sku].plant && cat.skus[l.sku].category !== "food");
  if (!eligible.length || !deliveredAt) return null;
  if (!rng.chance(type === "returner" ? RETURNER_RATE : RETURN_RATE)) return null;
  const line = rng.pick(eligible);
  const reason = rng.weighted(RETURN_REASONS);
  const created = at(dayStart(deliveredAt) + rng.int(1, 20) * DAY, rng.int(8, 21), rng.int(0, 59));
  const shipped = created + rng.int(1, 3) * DAY;
  const received = at(addWorkdays(dayStart(shipped), rng.int(1, 3)), 11);
  const rejected = reason === "change_of_mind" && rng.chance(REJECT_RATE);
  const refunded = rejected ? null : at(addWorkdays(dayStart(received), rng.int(1, 2)), 15);
  return { sku: line.sku, qty: 1, reason, created, shipped, received, rejected, refunded };
}

/** Next generated order number. WHY: with stories on, 20101 to 20299 belong to the planted story orders. */
function makeNumberer(skipStoryNumbers) {
  let n = 10000;
  return () => { n += 1; if (skipStoryNumbers && n >= 20101 && n <= 20299) n = 20300; return "ORD-" + n; };
}

/** Planted orders, turned into stock events: which lines take stock, and when. */
function plantedStockEvents(o, cat) {
  const events = [];
  if (o.payment.status === "declined") return events;
  const cancelled = o.status === "cancelled" ? o.history.find((h) => /cancel/i.test(h.event))?.at : null;
  for (const line of o.items) {
    const s = cat.skus[line.sku];
    const ship = o.shipments.find((x) => x.skus.includes(line.sku));
    if (ship && ship.status === "pending") continue; // waiting for stock
    const mto = MADE_TO_ORDER.includes(s.product);
    if (mto && !ship?.dispatched_at) continue;
    const t = mto ? at(dayStart(parse(ship.dispatched_at)), 7) : parse(o.placed_at);
    events.push({ t, kind: mto ? "mto" : "sold", sku: line.sku, qty: line.qty, ref: o.number, planted: true });
    if (cancelled) events.push({ t: parse(cancelled), kind: "released", sku: line.sku, qty: line.qty, ref: o.number });
  }
  return events;
}

/**
 * Runs the whole five years once. `cuts` writes off part of one delivery per pinned SKU so a pinned
 * stock story comes out exactly (found by running twice).
 */
export function simulate({ seed, cat, suppliers, intents, planted, now, campaigns, cuts = {}, effects = makeEffects(), townOf = {}, openingCover = {} }) {
  const pins = Object.fromEntries(planted.pins.map((p) => [p.sku, { ...p, holdFrom: parse(p.hold_from), lastSale: parse(p.last_sale) }]));
  const supplierOf = {};
  for (const sup of suppliers) for (const sku of sup.skus) supplierOf[sku] = sup;
  const stocked = Object.values(cat.skus).filter((s) => !MADE_TO_ORDER.includes(s.product));
  const stock = Object.fromEntries(Object.keys(cat.skus).map((k) => [k, { on_hand: 0, on_order: 0, demand: [] }]));
  const movements = [], pos = [], orders = [], counts = [], lostByDay = new Map(), lostUnits = {}, warnings = [], pinReport = {};
  const restockBlocked = (sku, t) => pins[sku] && t >= pins[sku].holdFrom;
  const nextNumber = makeNumberer(planted.orders.length > 0);
  const mtoPOs = new Map();

  // Everything that happens at a moment in time goes in a bucket for its day.
  const buckets = new Map();
  const schedule = (t, ev) => {
    if (t > now) return;
    const d = dayStart(t);
    if (!buckets.has(d)) buckets.set(d, []);
    buckets.get(d).push({ ...ev, t });
  };
  const move = (t, sku, qty, reason, ref) => {
    stock[sku].on_hand += qty;
    movements.push({ at: t, sku, qty, reason, reference: ref });
  };

  // Planted orders keep stock back for themselves for RESERVE_DAYS ahead.
  const plantedEvents = planted.orders.flatMap((o) => plantedStockEvents(o, cat));
  const reserveList = {};
  for (const e of plantedEvents) if (e.kind === "sold" && !MADE_TO_ORDER.includes(cat.skus[e.sku].product)) (reserveList[e.sku] ||= []).push(e);
  const reserved = (sku, t) => (reserveList[sku] || []).reduce((n, e) => (e.t > t && e.t <= t + RESERVE_DAYS * DAY ? n + e.qty : n), 0);
  for (const e of plantedEvents) schedule(e.t, e);
  for (const r of planted.returns) {
    if (r.status === "refunded" && ["change_of_mind", "wrong_item"].includes(r.reason)) {
      for (const i of r.items) schedule(parse(r.refunded_at), { kind: "returned_to_stock", sku: i.sku, qty: i.qty, ref: r.number });
    }
  }
  for (const i of intents) schedule(i.at, { kind: "intent", intent: i });
  for (const c of planted.counts) schedule(parse(c.at), { kind: "planted_count", count: c });

  // ---- purchase orders ----
  const raisePO = (t, sup, lines, forced) => {
    const rng = rngFor(seed, "po", sup.id, dateOf(t), lines.map((l) => l.sku).join(","));
    const po = { supplier_id: sup.id, ordered_at: t, due_at: dayStart(t) + leadTime(sup, t) * DAY, lines: lines.map((l) => ({ ...l, unit_cost: sup.unit_cost[l.sku], qty_received: 0 })), note: forced?.note || "" };
    for (const l of lines) stock[l.sku].on_order += l.qty;
    pos.push(po);
    if (forced) { po.forced = forced.status; return; }
    if (rng.chance(PO_CANCEL_RATE)) {
      po.cancelAt = t + 2 * DAY;
      po.note = "Supplier could not fill this order and cancelled it.";
      schedule(po.cancelAt, { kind: "po_cancel", po });
      return;
    }
    // WHY: events such as a port strike make suppliers more likely to miss their date.
    const lateChance = Math.min(1, (1 - sup.reliability) * effects.at(t).supplier_late_chance);
    const late = rng.chance(lateChance) ? rng.int(2, 12) : 0;
    const arrive = at(po.due_at + late * DAY, 7, 30);
    const shortLine = rng.chance(PO_SHORT_RATE) ? rng.int(0, lines.length - 1) : -1;
    po.lines.forEach((l, k) => { l.planned = k === shortLine ? Math.max(1, Math.floor(l.qty * rng.between(0.7, 0.95))) : l.qty; });
    po.arrive = arrive;
    schedule(arrive, { kind: "po_arrive", po });
  };

  const reorderCheck = (t) => {
    const want = new Map();
    for (const s of stocked) {
      if (s.launched > dateOf(t + 45 * DAY)) continue; // not launched yet
      if (restockBlocked(s.sku, t) || (cuts[s.sku] && t >= cuts[s.sku].freezeFrom)) continue;
      const st = stock[s.sku];
      const sup = supplierOf[s.sku];
      const lead = leadTime(sup, t);
      st.demand = st.demand.filter((d) => d.t > t - LOOKBACK_DAYS * DAY);
      const launchedFor = t - parse(s.launched);
      let rate = st.demand.reduce((n, d) => n + d.qty, 0) / LOOKBACK_DAYS;
      // WHY: before launch and in the first weeks there is no history; buy one minimum order to start.
      if (launchedFor < LOOKBACK_DAYS * DAY && st.on_hand + st.on_order === 0) { (want.get(sup) || want.set(sup, []).get(sup)).push({ sku: s.sku, qty: sup.min_order_qty }); continue; }
      const ahead = Math.min(2, Math.max(0.6, season(t + lead * DAY) / season(t)));
      rate *= ahead;
      // Planted orders coming up count as known demand, so their stock is bought in time.
      const known = reserved(s.sku, t);
      let point = Math.ceil(rate * (lead + SAFETY_DAYS)) + known;
      const stockingUp = t >= now - STOCK_UP_DAYS * DAY && openingCover[s.sku];
      if (stockingUp) point = Math.max(point, openingCover[s.sku] + Math.ceil(rate * (lead + SAFETY_DAYS)) + known);
      // WHY: with no recent demand at all the buyer does not restock until something is needed.
      if (st.on_hand + st.on_order > point || (rate === 0 && !stockingUp && st.on_hand + st.on_order >= known)) continue;
      let qty = Math.max(sup.min_order_qty, Math.ceil(rate * (lead + COVER_DAYS)) + known - st.on_hand - st.on_order);
      if (stockingUp) qty = Math.max(qty, point + Math.ceil(rate * SAFETY_DAYS) - st.on_hand - st.on_order);
      (want.get(sup) || want.set(sup, []).get(sup)).push({ sku: s.sku, qty });
    }
    for (const [sup, lines] of want) raisePO(at(t, 17, 30), sup, lines);
  };

  // ---- quarterly stock counts ----
  const countDay = (d) => [0, 3, 6, 9].includes(new Date(d).getUTCMonth()) && weekday(d) === 1 && new Date(d).getUTCDate() <= 7;
  const runCount = (d) => {
    const rng = rngFor(seed, "count", dateOf(d));
    const live = stocked.filter((s) => s.launched <= dateOf(d) && !restockBlocked(s.sku, d));
    for (let k = 0; k < Math.min(5, live.length); k++) {
      const s = live.splice(rng.int(0, live.length - 1), 1)[0];
      const system = stock[s.sku].on_hand;
      // WHY: most counts agree; small losses from mis-picks and breakage are normal; a surplus is rare.
      const diff = Math.max(-system, rng.weighted([[0, 70], [-1, 14], [-2, 6], [1, 7], [-3, 3]]));
      const t = at(d, 18);
      const count = { at: t, sku: s.sku, system_qty: system, counted_qty: system + diff, difference: diff,
        note: diff === 0 ? "Matches." : diff > 0 ? "One more than the system. Probably a return put back without being booked in." : "Short. Likely mis-picks or breakage.", adjusted: diff !== 0 };
      counts.push(count);
      if (diff !== 0) move(t, s.sku, diff, "count_adjustment", count);
    }
  };

  // ---- orders ----
  const delivery = Object.fromEntries(cat.business.delivery.methods.map((m) => [m.id, m]));
  const takeIntent = (ev) => {
    const it = ev.intent;
    const rng = rngFor(seed, "order", it.key);
    const lines = [];
    for (const l of it.lines) {
      const s = cat.skus[l.sku];
      stock[l.sku].demand.push({ t: it.at, qty: l.qty });
      const mto = MADE_TO_ORDER.includes(s.product);
      const free = stock[l.sku].on_hand - reserved(l.sku, it.at);
      if (mto || free >= l.qty) lines.push({ ...l, unit_price: priceAt(l.sku, it.at, cat.skus) });
      else lostUnits[l.sku] = (lostUnits[l.sku] || 0) + l.qty;
    }
    if (!lines.length) {
      const d = dateOf(it.at);
      lostByDay.set(d, (lostByDay.get(d) || 0) + 1);
      return;
    }
    const items = round2(lines.reduce((n, l) => n + l.qty * l.unit_price, 0));
    const method = lines.some((l) => cat.skus[l.sku].chilled) ? "chilled" : it.method;
    const m = delivery[method];
    const charge = m.free_over != null && items > m.free_over ? 0 : m.price;
    const pct = it.code ? campaigns.find((c) => c.code === it.code).discount_pct : 0;
    const discount = round2(items * pct / 100);
    const order = { number: nextNumber(), intent: it, customer_id: it.customer_id, placed: it.at, lines, method, items, delivery: charge, discount, total: round2(items + charge - discount), code: pct ? it.code : null };
    orders.push(order);
    if (rng.chance(PAYMENT_FAIL_RATE)) { order.payFail = true; return; }
    const hasMto = lines.some((l) => MADE_TO_ORDER.includes(cat.skus[l.sku].product));
    for (const l of lines) if (!MADE_TO_ORDER.includes(cat.skus[l.sku].product)) move(it.at, l.sku, -l.qty, "sold", order.number);
    if (!hasMto && rng.chance(CANCEL_RATE) && !lines.some((l) => restockBlocked(l.sku, it.at))) {
      order.cancelAt = it.at + rng.int(1, 5) * HOUR;
      for (const l of lines) schedule(order.cancelAt, { kind: "released", sku: l.sku, qty: l.qty, ref: order.number });
      return;
    }
    const chilled = lines.filter((l) => cat.skus[l.sku].chilled).map((l) => cat.skus[l.sku]);
    const other = lines.filter((l) => !cat.skus[l.sku].chilled).map((l) => cat.skus[l.sku]);
    order.shipments = [];
    const delay = effects.at(it.at, townOf[it.customer_id] || "").carrier_delay_days;
    if (chilled.length) order.shipments.push(planShipment(rng, it.at, "chilled", chilled, delay));
    if (other.length) order.shipments.push(planShipment(rng, it.at, method === "next-day" ? "next-day" : "standard", other, delay));
    for (const s of order.shipments) {
      if (s.kind === "chilled") for (const l of lines.filter((x) => s.skus.includes(x.sku))) schedule(at(dayStart(s.dispatch), 7), { kind: "mto", sku: l.sku, qty: l.qty, ref: order.number });
      if (s.lost) schedule(s.replacement.dispatch, { kind: "replace", order, shipment: s });
    }
    const delivered = Math.max(...order.shipments.map((s) => s.delivered || s.replacement?.delivered || 0));
    // WHY: a parcel the carrier lost is replaced, not returned.
    order.ret = order.shipments.some((x) => x.lost) ? null : planReturn(rng, order, cat, it.type, delivered || null);
    const r = order.ret;
    if (r && r.refunded && ["change_of_mind", "wrong_item"].includes(r.reason) && !restockBlocked(r.sku, r.refunded)) {
      schedule(r.refunded, { kind: "returned_to_stock", sku: r.sku, qty: r.qty, ref: order.number, ret: r });
      r.restocked = true;
    }
  };

  const handle = (ev) => {
    switch (ev.kind) {
      case "intent": return takeIntent(ev);
      case "sold": {
        stock[ev.sku].demand.push({ t: ev.t, qty: ev.qty });
        if (stock[ev.sku].on_hand < ev.qty) warnings.push(`planted ${ev.ref} short of ${ev.sku} on ${iso(ev.t)}`);
        else move(ev.t, ev.sku, -ev.qty, "sold", ev.ref);
        const pin = pins[ev.sku];
        if (pin && ev.t === pin.lastSale) pinReport[ev.sku] = { left: stock[ev.sku].on_hand, lastPO: [...pos].reverse().find((p) => p.receivedAt && p.receivedAt <= ev.t && p.lines.some((l) => l.sku === ev.sku)) };
        return;
      }
      case "mto": {
        // One purchase order a day per made-to-order supplier, placed the evening before, delivered at 7am.
        const sup = supplierOf[ev.sku];
        const key = sup.id + dateOf(ev.t);
        let po = mtoPOs.get(key);
        if (!po) {
          po = { supplier_id: sup.id, ordered_at: ev.t - 13 * HOUR, due_at: dayStart(ev.t), receivedAt: ev.t, lines: [], note: "Made to order for today's chilled parcels." };
          mtoPOs.set(key, po); pos.push(po);
        }
        const line = po.lines.find((l) => l.sku === ev.sku) || po.lines[po.lines.push({ sku: ev.sku, qty: 0, unit_cost: sup.unit_cost[ev.sku], qty_received: 0 }) - 1];
        line.qty += ev.qty; line.qty_received += ev.qty;
        move(ev.t, ev.sku, ev.qty, "received", po);
        move(ev.t, ev.sku, -ev.qty, "sold", ev.ref);
        return;
      }
      case "released": case "returned_to_stock": return move(ev.t, ev.sku, ev.qty, ev.kind, ev.ret || ev.ref);
      case "po_cancel": for (const l of ev.po.lines) stock[l.sku].on_order -= l.qty; return;
      case "po_arrive": {
        const po = ev.po;
        po.receivedAt = ev.t;
        for (const l of po.lines) {
          l.qty_received = l.planned;
          stock[l.sku].on_order -= l.qty;
          move(ev.t, l.sku, l.qty_received, "received", po);
          const cut = cuts[l.sku] && cuts[l.sku].key === poKey(po) ? Math.min(cuts[l.sku].cut, stock[l.sku].on_hand) : 0;
          if (cut > 0) {
            move(ev.t + MINUTE, l.sku, -cut, "written_off", po);
            po.note = `${cut} of ${l.sku} failed inspection on arrival and were scrapped.`;
          }
        }
        return;
      }
      case "replace": {
        const { order, shipment } = ev;
        const short = shipment.skus.some((sku) => stock[sku].on_hand < order.lines.find((l) => l.sku === sku).qty);
        if (short) { shipment.refundInstead = true; return; }
        for (const sku of shipment.skus) move(ev.t, sku, -order.lines.find((l) => l.sku === sku).qty, "written_off", order.number);
        return;
      }
      case "planted_count": {
        const c = ev.count;
        const system = stock[c.sku].on_hand;
        counts.push({ at: ev.t, sku: c.sku, system_qty: system, counted_qty: Math.max(0, system + c.difference), difference: c.difference, note: c.note, adjusted: false, planted: true });
        return;
      }
    }
  };

  // Forced purchase orders from the pinned stories.
  for (const p of Object.values(pins)) schedule(parse(p.po.ordered_at), { kind: "forced_po", pin: p });

  // Start 45 days early so the first products are on the shelf on launch day.
  for (let d = tradingDays(now)[0] - 45 * DAY; d <= dayStart(now); d += DAY) {
    const evs = (buckets.get(d) || []).sort((a, b) => a.t - b.t);
    for (const ev of evs) {
      if (ev.kind === "forced_po") {
        const sup = supplierOf[ev.pin.sku];
        raisePO(ev.t, sup, [{ sku: ev.pin.sku, qty: Math.max(sup.min_order_qty, 20) }], { status: ev.pin.po.status, note: ev.pin.po.note });
      } else handle(ev);
    }
    if (d + 17.5 * HOUR <= now) reorderCheck(d);
    if (countDay(d) && d + 18 * HOUR <= now) runCount(d);
  }
  for (const sku of Object.keys(pinReport)) pinReport[sku].atNow = stock[sku].on_hand;
  return { orders, movements, pos, counts, lostByDay, lostUnits, warnings, pinReport, stock };
}

export const poKey = (po) => `${po.supplier_id}|${dateOf(po.ordered_at)}`;

/**
 * Runs the simulation, then again until each pinned shelf is empty straight after its last planted sale.
 * The fix: units left over are written off when the last delivery before that sale arrives (failed inspection),
 * and the SKU is not reordered after that delivery was ordered (so nothing refills it before "now").
 */
export function simulateWithPins(args) {
  let cuts = {}, result;
  for (let pass = 0; pass < 5; pass++) {
    result = simulate({ ...args, cuts });
    let changed = false;
    for (const [sku, rep] of Object.entries(result.pinReport)) {
      if ((rep.left === 0 && rep.atNow === 0) || !rep.lastPO) continue;
      const key = poKey(rep.lastPO);
      const prev = cuts[sku]?.key === key ? cuts[sku].cut : 0;
      cuts = { ...cuts, [sku]: { key, cut: prev + rep.left, freezeFrom: rep.lastPO.ordered_at + 60000 } };
      changed = true;
    }
    if (!changed) break;
  }
  return result;
}
