// The ledger (every pound in and out) and the monthly summary built from it.
import { DAY, iso, monthOf, parse, round2, START, growth } from "./calendar.mjs";

/** Card fee per payment: 1.5% plus 20p. WHY: typical UK online card processing. */
const FEE_RATE = 0.015, FEE_FIXED = 0.2;
/** What the carrier charges us per parcel. WHY: small-business contract rates, a little under what customers pay. */
const CARRIER_COST = { chilled: 6.8, "next-day": 5.1, standard: 2.9 };
/** Money the founder put in on day one, before any sales. Scaled with the world's size, never below £2,000. */
const OPENING_CASH = 12000;

/**
 * Opening cash: the founder's money, enough that the bank balance never goes below a small cushion.
 * WHY: a real shop that ran out of cash would have borrowed or closed; the founder covers the early losses.
 */
export function openingCash(scale, ledger = []) {
  let cash = 0, lowest = 0;
  for (const e of ledger) if (!NOT_CASH.includes(e.type)) { cash += e.amount; lowest = Math.min(lowest, cash); }
  const cushion = 1000 * scale;
  return Math.max(2000, Math.round(OPENING_CASH * scale), Math.ceil((cushion - lowest) / 500) * 500);
}
/** Day of the month each running cost is paid. */
const FIXED_DAY = { rent: 1, software: 3, wages: 28 };
const WEEKS_PER_MONTH = 52 / 12;
/** Hours worked as a share of what the orders need. WHY: a little slack for training, stock counts and quiet days. */
const HOURS_SLACK = 1.15;
/** The founder always puts in at least this many hours a week, however quiet it is. */
const FOUNDER_MIN_HOURS = 10;

/** Ledger types that are cash, not profit and loss. */
export const CASH_ONLY = ["supplier_payment"];
/** Ledger types that are profit and loss, not cash. */
export const NOT_CASH = ["cost_of_goods", "goodwill_credit"];

export function buildLedger({ orders, refunds, movements, pos, suppliers, campaigns, goodwill, unitCost, now }) {
  const rows = [];
  const add = (t, type, amount, reference) => { if (t <= now && amount !== 0) rows.push({ t, type, amount: round2(amount), reference }); };
  for (const o of orders) {
    if (o.payment.status === "declined") continue;
    const t = parse(o.placed_at);
    add(t, "sale", o.totals.items - o.totals.discount, o.number);
    add(t, "delivery_income", o.totals.delivery, o.number);
    add(t, "payment_fee", -(o.totals.total * FEE_RATE + FEE_FIXED), o.number);
    for (const s of o.shipments) {
      if (!s.dispatched_at) continue;
      add(parse(s.dispatched_at), "delivery_cost", -CARRIER_COST[s.carrier === "Coldline Couriers" ? "chilled" : o.delivery.method === "next-day" ? "next-day" : "standard"], o.number);
    }
  }
  for (const r of refunds) add(r.at, "refund", -r.amount, r.reference);
  // Stock leaving the shelf is a cost; stock coming back reverses it. Deliveries from suppliers are not (they are stock).
  for (const m of movements) if (m.reason !== "received") add(m.at, "cost_of_goods", m.qty * unitCost[m.sku], m.reference);
  const terms = Object.fromEntries(suppliers.map((s) => [s.id, s.payment_terms_days]));
  for (const po of pos) {
    if (!po.receivedAt) continue;
    const due = po.receivedAt + terms[po.supplier_id] * DAY;
    po.paid_at = due <= now ? iso(due) : null;
    add(due, "supplier_payment", -po.lines.reduce((n, l) => n + l.qty_received * l.unit_cost, 0), po.number);
  }
  for (const c of campaigns) add(parse(c.start) + 9 * 3600000, "marketing_spend", -c.spend, c.id);
  for (const g of goodwill) add(g.at, "goodwill_credit", -g.amount, g.reference);
  return rows;
}

/** Share of a month (by days) someone was employed, given the date they joined. */
function shareEmployed(joined, monthStart, monthEnd) {
  const from = Math.max(parse(joined), monthStart);
  return from >= monthEnd ? 0 : (monthEnd - from) / (monthEnd - monthStart);
}

/**
 * Joining dates worked out from order volume: each person joins on the first Monday the orders need more hours
 * than the team already has (plus half of the newcomer's), in the order business/data/history/staff-history.json gives.
 * WHY: the hand-written dates came from an older, smaller history; hiring ahead of the orders makes years of
 * losses, hiring behind them makes the business look far more profitable than it could be.
 * @param {object[]} staff business/data/staff.json staff
 * @param {string[]} order Staff ids in the order they joined (first is the founder)
 * @param {object} founding Joining date of the founder
 * @returns {Object<string, string>} id to "YYYY-MM-DD"
 */
export function joinDatesFromVolume(staff, order, founding, now) {
  const byId = Object.fromEntries(staff.map((p) => [p.id, p]));
  const full = staff.reduce((n, p) => n + p.weekly_hours, 0);
  const ids = [...order, ...staff.map((p) => p.id).filter((id) => !order.includes(id))];
  const dates = { [ids[0]]: founding };
  let team = byId[ids[0]].weekly_hours, next = 1;
  let d = START + ((8 - new Date(START).getUTCDay()) % 7) * DAY; // first Monday
  for (; d <= now && next < ids.length; d += 7 * DAY) {
    const needed = full * growth(d) * HOURS_SLACK;
    while (next < ids.length && needed >= team + byId[ids[next]].weekly_hours / 2) {
      dates[ids[next]] = iso(d).slice(0, 10);
      team += byId[ids[next]].weekly_hours;
      next++;
    }
  }
  // WHY: by "now" the business is full size, so anyone not yet placed joins on the last Monday of history.
  for (; next < ids.length; next++) dates[ids[next]] = iso(d - 7 * DAY).slice(0, 10);
  return dates;
}

/**
 * Who works here each month and what they cost, from business/data/staff.json (hours and pay) and the joining dates in
 * business/data/history/staff-history.json. Hours scale with the world: scale 1 is the full team, a demo world has the
 * same people on fewer hours.
 * WHY: while the shop is small, everyone employed works fewer hours than their full-size role: the hours worked
 * follow the orders (with some slack), never more than the contracted hours of the people employed then. By "now"
 * the orders need the whole team on full hours, which is exactly the team the simulator starts with.
 * @returns {{month: string, wages: number, hours_share: number}[]} One row per month from launch to now.
 */
export function staffingByMonth({ staff, joined, costs, scale, now }) {
  const fullHours = staff.reduce((n, p) => n + p.weekly_hours, 0);
  const rows = [];
  for (let d = new Date(START); d.getTime() <= now; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    let pay = 0, hours = 0;
    for (const p of staff) {
      const share = shareEmployed(joined[p.id] || "2021-11-22", monthStart, monthEnd);
      pay += share * p.weekly_hours * p.hourly_pay * WEEKS_PER_MONTH;
      hours += share * p.weekly_hours;
    }
    const needed = Math.max(FOUNDER_MIN_HOURS, fullHours * growth((monthStart + monthEnd) / 2) * HOURS_SLACK);
    const worked = Math.min(1, needed / hours);
    rows.push({ month: monthOf(monthStart), wages: round2(pay * worked * (1 + costs.on_cost_rate) * scale), hours_share: (hours * worked) / fullHours });
  }
  return rows;
}

/**
 * Wages, premises and software for every month, worked out the way the simulator works them out (business/data/costs.json).
 * WHY: no target margin. Profit is whatever the orders earn after these costs, so history and simulation agree.
 * Premises (rent, utilities, insurance) and software grow with the team: a one-person shop does not rent the
 * full warehouse. The engine's ledger has no separate types for utilities and insurance, so they are booked
 * with rent as the premises cost.
 */
export function addRunningCosts(rows, { staffing, costs, scale, now }) {
  const premises = costs.rent_per_month + costs.utilities_per_month + costs.insurance_per_month;
  for (const m of staffing) {
    const [y, mo] = m.month.split("-").map(Number);
    const amounts = { wages: m.wages, rent: premises * scale * m.hours_share, software: costs.software_per_month * scale * m.hours_share };
    for (const [type, amount] of Object.entries(amounts)) {
      let t = Date.UTC(y, mo - 1, FIXED_DAY[type], 12);
      let due = amount;
      // WHY: wages are paid on the 28th, but the month's profit is only honest if the pay earned so far is counted:
      // in the month that is still running, the wages to date are accrued just before "now".
      if (type === "wages" && t > now && now >= Date.UTC(y, mo - 1, 1)) {
        const start = Date.UTC(y, mo - 1, 1), end = Date.UTC(y, mo, 1);
        due = amount * (now - start) / (end - start);
        t = now - 60000;
      }
      if (t >= START && t <= now && due > 0) rows.push({ t, type, amount: -round2(due), reference: `${type.toUpperCase()}-${m.month}` });
    }
  }
}

export function finishLedger(rows) {
  rows.sort((a, b) => a.t - b.t || a.type.localeCompare(b.type) || String(a.reference).localeCompare(String(b.reference)));
  return rows.map((r, i) => ({ id: "LED-" + String(i + 1).padStart(6, "0"), at: iso(r.t), type: r.type, amount: r.amount, reference: r.reference, month: monthOf(r.t) }));
}

const OPEX = ["payment_fee", "delivery_cost", "wages", "rent", "software", "marketing_spend", "goodwill_credit"];

/** One row per month, worked out only from the ledger and the orders. */
export function monthlySummary(ledger, orders, openingCash) {
  const months = [...new Set(ledger.map((e) => e.month))].sort();
  const seen = new Set();
  const firstOrder = {};
  for (const o of [...orders].sort((a, b) => a.placed_at.localeCompare(b.placed_at))) {
    if (o.payment.status === "declined") continue;
    if (!firstOrder[o.customer_id]) firstOrder[o.customer_id] = o.placed_at.slice(0, 7);
  }
  let cash = openingCash;
  return months.map((month) => {
    const es = ledger.filter((e) => e.month === month);
    const sum = (type) => round2(es.filter((e) => e.type === type).reduce((n, e) => n + e.amount, 0));
    const sales = sum("sale"), deliveryIncome = sum("delivery_income");
    const revenue = round2(sales + deliveryIncome), refunds = round2(-sum("refund")), cogs = round2(-sum("cost_of_goods"));
    const operating = Object.fromEntries(OPEX.map((t) => [t, round2(-sum(t))]));
    const opTotal = round2(Object.values(operating).reduce((n, x) => n + x, 0));
    const gross = round2(revenue - refunds - cogs);
    cash = round2(cash + es.filter((e) => !NOT_CASH.includes(e.type)).reduce((n, e) => n + e.amount, 0));
    const placed = orders.filter((o) => o.placed_at.startsWith(month) && o.payment.status !== "declined");
    let repeat = 0;
    for (const o of placed) if (firstOrder[o.customer_id] < month || (firstOrder[o.customer_id] === month && seen.has(o.customer_id))) repeat++; else seen.add(o.customer_id);
    for (const o of placed) seen.add(o.customer_id);
    return {
      month, revenue, sales, delivery_income: deliveryIncome, refunds, cost_of_goods: cogs, gross_margin: gross, operating_costs: operating,
      operating_costs_total: opTotal, profit: round2(gross - opTotal), orders: placed.length,
      new_customers: Object.values(firstOrder).filter((m) => m === month).length,
      repeat_rate: placed.length ? round2(repeat / placed.length) : 0,
      average_order_value: placed.length ? round2(placed.reduce((n, o) => n + o.totals.total, 0) / placed.length) : 0,
      supplier_payments: round2(-sum("supplier_payment")), cash_at_month_end: cash,
    };
  });
}
