// Turns what the simulator says about a day into words and figures a person reads.
// WHY one place: the top bar, Home and the Control Room all describe days, and must say it the same way.
//
// A day comes in one of two shapes:
//  - from POST /sandboxes/:id/advance: { ...what the engine did (lists of ids), summary: { orders, revenue, net, ... } }
//  - from the trace (kind "advance"): the summary alone.
// Both are accepted.

/** Figures from the simulator's day line, in the order they are shown. */
const FIGURES = [
  { key: "orders", one: "order", many: "orders", format: "num", tone: "good" },
  { key: "revenue", label: "taken", format: "money", tone: "good" },
  { key: "net", label: "profit", format: "money", tone: "signed" },
  { key: "contacts", one: "customer got in touch", many: "customers got in touch", format: "num", tone: "info" },
  { key: "lost_sales", one: "sale lost to an empty shelf", many: "sales lost to empty shelves", format: "num", tone: "bad" },
];

/** Things the engine lists by id that are worth a chip when they happen (all are problems). */
const TROUBLE = [
  { key: "became_late", one: "parcel running late", many: "parcels running late" },
  { key: "complaints_past_deadline", one: "complaint past its deadline", many: "complaints past their deadline" },
  { key: "refunds_late", one: "refund running late", many: "refunds running late" },
];

/** The summary line from either shape of day. */
export function summaryOf(day) {
  if (!day || typeof day !== "object") return null;
  if (day.summary && typeof day.summary === "object") return day.summary;
  return "orders" in day || "revenue" in day ? day : null;
}

/**
 * Adds up one or more days.
 * @param {Array<object>} days oldest first
 * @return {{items: Array<{key: string, value: number, label: string, format: string, tone: string}>,
 *   sentence: string, quiet: boolean, totals: object, note: string}}
 */
export function summariseDays(days) {
  const totals = { orders: 0, revenue: 0, net: 0, contacts: 0, lost_sales: 0, gross_profit: 0, csat: null };
  let csatSum = 0;
  let csatDays = 0;
  let note = "";
  const withSummary = days.filter(summaryOf);
  for (const day of withSummary) {
    const s = summaryOf(day);
    for (const k of ["orders", "revenue", "net", "contacts", "lost_sales", "gross_profit"]) totals[k] += Number(s[k]) || 0;
    if (Number.isFinite(s.csat) && s.csat > 0) { csatSum += s.csat; csatDays += 1; }
    if (!note && Array.isArray(s.notes) && s.notes.length) note = s.notes[0];
  }
  totals.csat = csatDays ? csatSum / csatDays : null;

  const items = [];
  if (withSummary.length) {
    for (const f of FIGURES) {
      const v = totals[f.key];
      if (!v && f.key !== "orders") continue;
      const tone = f.tone === "signed" ? (v < 0 ? "bad" : "good") : f.tone;
      const label = f.label || (Math.round(v) === 1 ? f.one : f.many);
      items.push({ key: f.key, value: v, label, format: f.format, tone });
    }
  }
  if (totals.csat != null) items.push({ key: "csat", value: totals.csat, label: "out of 5 from customers", format: "score", tone: totals.csat >= 4 ? "good" : totals.csat >= 3.5 ? "info" : "bad" });
  for (const t of TROUBLE) {
    const n = days.reduce((sum, d) => sum + (Array.isArray(d?.[t.key]) ? d[t.key].length : 0), 0);
    if (n) items.push({ key: t.key, value: n, label: n === 1 ? t.one : t.many, format: "num", tone: "bad" });
  }
  const sentence = items.length ? "" : "A quiet one. Nothing much moved.";
  return { items, sentence, quiet: !items.length, totals, note };
}

/** "a, b and c" */
export function joinWords(list) {
  if (list.length < 2) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

/** The days in a trace entry of kind "advance" (its summary list), or [] for any other entry. */
export function daysFromTrace(entry) {
  if (entry?.kind === "advance" && Array.isArray(entry.summary)) return entry.summary;
  return [];
}
