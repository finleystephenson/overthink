// Time: the five trading years, working days, and how busy each day is.
import fs from "node:fs";

export const DAY = 86400000;
export const HOUR = 3600000;
export const MINUTE = 60000;

/** The first order ever taken. Five years before "now", so every warranty length has expired and live cases. */
export const START = Date.UTC(2021, 10, 22);

export const iso = (t) => new Date(t).toISOString().replace(".000Z", "Z");
export const dateOf = (t) => iso(t).slice(0, 10);
export const monthOf = (t) => iso(t).slice(0, 7);
export const parse = (s) => Date.parse(s.length === 10 ? s + "T00:00:00Z" : s);
export const dayStart = (t) => t - (((t % DAY) + DAY) % DAY);
export const at = (day, hours, minutes = 0) => dayStart(day) + hours * HOUR + minutes * MINUTE;
export const weekday = (t) => new Date(t).getUTCDay(); // 0 is Sunday
export const isWorkday = (t) => weekday(t) >= 1 && weekday(t) <= 5;
export const round2 = (x) => Math.round(x * 100) / 100;

/** Next working day after t, at the same time of day. */
export function nextWorkday(t) {
  let d = t + DAY;
  while (!isWorkday(d)) d += DAY;
  return d;
}

export function addWorkdays(t, n) {
  let d = t;
  for (let i = 0; i < n; i++) d = nextWorkday(d);
  return d;
}

export function addMonths(dateText, months) {
  const d = new Date(parse(dateText));
  d.setUTCMonth(d.getUTCMonth() + months);
  return dateOf(d.getTime());
}

/** Every day from START up to and including the day of now. */
export function tradingDays(now) {
  const days = [];
  for (let d = START; d <= dayStart(now); d += DAY) days.push(d);
  return days;
}

/** Years since the first order, as a decimal. */
export const yearsIn = (t) => (t - START) / (365.25 * DAY);

/**
 * The simulator's demand model (business/data/sim.json "demand"). WHY: history and the live simulator must describe one
 * business, so both read the same base orders a day, seasons and weekday pattern from one file.
 */
export const SIM_DEMAND = JSON.parse(fs.readFileSync(new URL("../../data/sim.json", import.meta.url), "utf8")).demand;
/** The moment history ends and the simulator takes over. */
const ANCHOR_NOW = Date.parse(JSON.parse(fs.readFileSync(new URL("../../data/business.json", import.meta.url), "utf8")).sim.anchor_now);

/** Midpoint and width (in years) of the S-shaped growth from launch to full size. */
const GROWTH_MID_YEARS = 2.8;
const GROWTH_WIDTH_YEARS = 0.6;
const logistic = (years) => 1 / (1 + Math.exp(-(years - GROWTH_MID_YEARS) / GROWTH_WIDTH_YEARS));

/**
 * Size of the business on day t as a share of its size at "now" (1.0 at now).
 * WHY: an S-curve. A new shop with no reputation sells a few orders a week; word of mouth compounds through years
 * two and three; by year five growth has slowed to a few percent a year, close to the simulator's annual_growth,
 * so the last weeks of history and the first weeks of a simulation look like the same business.
 * About 5% of full size in year one, 20% at the start of year three, 85% at the start of year five.
 */
export const growth = (t) => Math.min(1, logistic(yearsIn(t)) / logistic(yearsIn(ANCHOR_NOW)));

/** Month weight, from business/data/sim.json. WHY: after the last posting day before Christmas almost nobody orders. */
export function season(t) {
  const d = new Date(t);
  if (d.getUTCMonth() === 11 && d.getUTCDate() >= 22) return SIM_DEMAND.late_december_factor;
  return SIM_DEMAND.season_by_month[d.getUTCMonth()];
}

/** Day-of-week weight, Sunday first, from business/data/sim.json. */
export const weekdayFactor = (t) => SIM_DEMAND.weekday_factor_sunday_first[weekday(t)];

/** Relative chance that an order lands on day t (before campaigns and events). */
export const demand = (t) => growth(t) * season(t) * weekdayFactor(t);

/**
 * Expected orders on day t for a world at a given scale, before campaigns and events.
 * Scale 1 is the business business/data/sim.json and business/data/staff.json describe (base_orders_per_day at "now").
 */
export const expectedOrders = (t, scale) => SIM_DEMAND.base_orders_per_day * scale * demand(t);

/** Hour of day an order is placed. WHY: lunch-break and evening peaks, very little overnight. */
export const ORDER_HOURS = [[7, 2], [8, 4], [9, 6], [10, 6], [11, 6], [12, 9], [13, 8], [14, 6], [15, 5], [16, 5], [17, 6], [18, 8], [19, 10], [20, 10], [21, 7], [22, 3]];

/** Trading year of a month: 0 is Nov 2021 to Oct 2022. */
export function tradingYear(month) {
  const [y, m] = month.split("-").map(Number);
  return Math.floor(((y - 2021) * 12 + (m - 11)) / 12);
}
