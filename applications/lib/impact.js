// Reading the simulator's impact: this business (live) against the same business left alone (shadow).
// WHY one place: the top bar's chip and the Control Room's panel must say the same thing about the same numbers.
import { money, num } from "./ui.js";

/**
 * How to read each measure. `better` says which way is good for a business: "up", "down", or null when
 * neither is plainly better (more staff hours can mean more work done or more cost). `sum` says whether a day's
 * values add up over time (money, counts) or are a level (satisfaction, response time).
 */
export const MEASURES = {
  net_profit: { label: "Profit", format: "money", better: "up", sum: true },
  revenue: { label: "Revenue", format: "money", better: "up", sum: true },
  gross_profit: { label: "Gross profit", format: "money", better: "up", sum: true },
  cash: { label: "Cash in the bank", format: "money", better: "up", sum: false },
  orders: { label: "Orders", format: "num", better: "up", sum: true },
  refunds: { label: "Refunds", format: "money", better: "down", sum: true },
  complaints: { label: "Complaints", format: "num", better: "down", sum: true },
  reviews: { label: "Reviews", format: "num", better: null, sum: true },
  lost_sales: { label: "Sales lost to empty shelves", format: "num", better: "down", sum: true },
  stockouts: { label: "Days a product was sold out", format: "num", better: "down", sum: true },
  staff_task_hours: { label: "Hours of staff work", format: "hours", better: null, sum: true },
  customer_satisfaction: { label: "Customer satisfaction", format: "score", better: "up", sum: false },
  first_response_minutes: { label: "Minutes to first reply", format: "minutes", better: "down", sum: false },
  social_reach: { label: "People who saw a post", format: "num", better: "up", sum: true },
  followers: { label: "Followers", format: "num", better: "up", sum: false },
  content_visits: { label: "Visits from posts and mail", format: "num", better: "up", sum: true },
  content_orders: { label: "Orders from posts and mail", format: "num", better: "up", sum: true },
  content_revenue: { label: "Sales from posts and mail", format: "money", better: "up", sum: true },
  email_opens: { label: "Emails opened", format: "num", better: "up", sum: true },
  unsubscribes: { label: "People who unsubscribed", format: "num", better: "down", sum: true },
};

/** The measures in groups a person would expect, for lists. */
export const GROUPS = [
  { title: "Money", keys: ["net_profit", "revenue", "gross_profit", "cash", "refunds"] },
  { title: "Customers", keys: ["orders", "customer_satisfaction", "complaints", "first_response_minutes", "reviews", "lost_sales", "stockouts"] },
  { title: "Posts and mail", keys: ["social_reach", "followers", "content_visits", "content_orders", "content_revenue", "email_opens", "unsubscribes"] },
  { title: "The team", keys: ["staff_task_hours"] },
];

/** Formats a value of a measure for people. */
export function formatMeasure(key, v) {
  const f = MEASURES[key]?.format;
  if (v == null || !Number.isFinite(v)) return "–";
  if (f === "money") return money(v);
  if (f === "score") return `${v.toFixed(2)} of 5`;
  if (f === "minutes") return `${Math.round(v)} min`;
  if (f === "hours") return `${num(Math.round(v))} h`;
  return num(Math.round(v));
}

/** good, bad or neutral for a difference in a measure. Tiny differences (rounding) count as none. */
export function toneOf(key, diff) {
  const m = MEASURES[key];
  if (!m || !m.better || Math.abs(diff) < 0.005) return "neutral";
  return (diff > 0) === (m.better === "up") ? "good" : "bad";
}

/** True when nothing done has changed anything yet. */
export function isSame(imp) {
  return Object.values(imp.measures || {}).every((m) => Math.abs(m.difference || 0) < 0.005);
}

/**
 * The headline in plain words, and a short form for the top bar's chip.
 * Leads with profit; if profit has not moved, the first measure that has.
 * @param {object} imp the data from client.impact()
 * @return {{text: string, short: string, tone: string}}
 */
export function headline(imp) {
  const days = imp.days_compared || 0;
  if (!days) return { text: "Move time on and this will compare the two businesses.", short: "", tone: "neutral" };
  const over = days === 1 ? "over one day" : `over ${num(days)} days`;
  if (isSame(imp)) return { text: "Nothing has been done yet, so the two businesses are the same.", short: "Same as left alone", tone: "neutral" };
  const order = ["net_profit", ...Object.keys(MEASURES).filter((k) => k !== "net_profit")];
  const key = order.find((k) => Math.abs(imp.measures?.[k]?.difference || 0) >= 0.005);
  const diff = imp.measures[key].difference;
  const word = diff > 0 ? "more" : "less";
  const fmt = MEASURES[key].format;
  const amount = fmt === "money" ? money(Math.abs(diff)) : formatMeasure(key, Math.abs(diff));
  const what = MEASURES[key].label.toLowerCase();
  const text = fmt === "money"
    ? `${amount} ${word} ${what} than the same business left alone, ${over}.`
    : `${word === "more" ? "More" : "Less"} ${what} than the same business left alone (${amount}), ${over}.`;
  const short = `${diff > 0 ? "+" : "−"}${amount} ${key === "net_profit" ? "profit" : what}`;
  return { text, short, tone: toneOf(key, diff) };
}
