// Results: what each arm did to the simulated business, against the baseline, over the seeds.
//
// For every measure and every seed: the arm's figure minus the baseline's figure from the same seed (a paired
// difference: same luck, so luck cancels). Across seeds: the mean difference and a 90% interval for it (t interval,
// the same maths as simulation/simulator/report.mjs at a different level). Then one plain sentence per arm that says only what the
// numbers support. These are facts about the simulated world, never predictions about a real one.
import { mean, sd, percentile } from "../simulator/stats.mjs";
import { MEASURE_LABELS } from "../simulator/live.mjs";

/** Two-sided 90% t values by degrees of freedom (1.645 for large samples). */
const T90 = [0, 6.314, 2.92, 2.353, 2.132, 2.015, 1.943, 1.895, 1.86, 1.833, 1.812, 1.796, 1.782, 1.771, 1.761, 1.753, 1.746, 1.74, 1.734, 1.729, 1.725, 1.721, 1.717, 1.714, 1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697];
const t90 = (df) => (df <= 30 ? T90[df] : df <= 60 ? 1.68 : 1.66);
const r = (x, d = 2) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/**
 * Every measure the lab reports: label, unit, which way is better for the business or its customers (null when it is
 * neither), and its group. Money is one group among several on purpose (docs/open-world.md).
 */
export const MEASURES = {
  revenue: { group: "money", unit: "£", better: "up" },
  gross_profit: { group: "money", unit: "£", better: "up" },
  net_profit: { group: "money", unit: "£", better: "up" },
  cash: { group: "money", unit: "£", better: "up" },
  refunds: { group: "money", unit: "£", better: "down" },
  orders: { group: "customers", unit: "", better: "up" },
  new_customers: { group: "customers", unit: "", better: "up", label: "New customers" },
  visitors: { group: "customers", unit: "", better: "up", label: "Shop visitors" },
  customer_satisfaction: { group: "customers", unit: "/5", better: "up" },
  share_satisfied: { group: "customers", unit: "share", better: "up", label: "Share of contacts rated 4 or 5" },
  first_response_minutes: { group: "customers", unit: "min", better: "down" },
  first_response_median_minutes: { group: "customers", unit: "min", better: "down", label: "First response, median (working minutes)" },
  contacts: { group: "customers", unit: "", better: "down", label: "Customer contacts" },
  repeat_contacts: { group: "customers", unit: "", better: "down", label: "Repeat contacts (had to ask again)" },
  abandoned_contacts: { group: "customers", unit: "", better: "down", label: "Contacts never answered (customer gave up)" },
  complaints: { group: "customers", unit: "", better: "down" },
  reviews: { group: "reputation", unit: "", better: null },
  average_review: { group: "reputation", unit: "/5", better: "up", label: "Average review (stars)" },
  bad_reviews: { group: "reputation", unit: "", better: "down", label: "Bad reviews (1 or 2 stars)" },
  reputation: { group: "reputation", unit: "", better: "up", label: "Reputation at the end (0 to 1)" },
  staff_task_hours: { group: "people", unit: "h", better: null },
  overtime_hours: { group: "people", unit: "h", better: "down", label: "Staff overtime hours" },
  stockouts: { group: "operations", unit: "", better: "down" },
  lost_sales: { group: "operations", unit: "", better: "down" },
  late_parcels: { group: "operations", unit: "", better: "down", label: "Late parcels" },
  social_reach: { group: "marketing", unit: "", better: "up" },
  followers: { group: "marketing", unit: "", better: "up" },
  content_visits: { group: "marketing", unit: "", better: "up" },
  content_orders: { group: "marketing", unit: "", better: "up" },
  content_revenue: { group: "marketing", unit: "£", better: "up" },
  email_opens: { group: "marketing", unit: "", better: "up" },
  unsubscribes: { group: "marketing", unit: "", better: "down" },
  contacts_given_to_ai: { group: "ai", unit: "", better: null, label: "Contacts given to the AI" },
  contacts_resolved_by_ai: { group: "ai", unit: "", better: "up", label: "Contacts the AI resolved alone" },
  contacts_handed_over_by_ai: { group: "ai", unit: "", better: null, label: "Contacts the AI handed to a person" },
  wrong_actions: { group: "ai", unit: "", better: "down", label: "Wrong actions (changed what nobody asked for)" },
  ai_errors: { group: "ai", unit: "", better: "down", label: "AI errors and timeouts" },
  ai_tool_calls: { group: "ai", unit: "", better: null, label: "AI tool calls" },
  ai_refused_calls: { group: "ai", unit: "", better: "down", label: "AI calls refused by the rules" },
  rule_breaks: { group: "ai", unit: "", better: "down", label: "Rule breaks (prospecting)" },
};
for (const [k, m] of Object.entries(MEASURES)) m.label ||= MEASURE_LABELS[k] || k;

/**
 * Summary of paired differences across seeds.
 * @param {Array<number>} diffs One per seed (arm minus baseline).
 * @return {{n: number, mean: ?number, ci90: ?Array<number>, sd: ?number, p10: ?number, p90: ?number, clear: boolean, note: ?string}}
 */
export function summarise90(diffs) {
  const xs = diffs.filter((x) => typeof x === "number" && Number.isFinite(x));
  const n = xs.length, m = mean(xs), s = sd(xs);
  if (!n) return { n, mean: null, ci90: null, sd: null, p10: null, p90: null, clear: false, note: "no data" };
  let ci90 = null, clear = false, note = null;
  if (n >= 2) {
    const h = t90(n - 1) * s / Math.sqrt(n);
    ci90 = [r(m - h), r(m + h)];
    clear = s === 0 ? m !== 0 : ci90[0] > 0 || ci90[1] < 0;
    note = s === 0 ? (m === 0 ? "exactly zero in every seed" : "the same difference in every seed") : clear ? null : "the interval includes zero";
  } else note = "one seed: no interval";
  return { n, mean: r(m), ci90, sd: r(s), p10: r(percentile(xs, 0.1)), p90: r(percentile(xs, 0.9)), clear, note };
}

/**
 * Paired results for every arm against the baseline.
 * @param {object} raw What runExperiment returned.
 * @return {object} { title, question, days, seeds, arms: { id: { label, verdict, measures: { key: { label, group, baseline, arm, difference, relative, better } } } } }
 */
export function buildResults(raw) {
  const base = raw.arms.baseline;
  const n = base.seeds.length;
  const out = {
    title: raw.experiment.title, question: raw.experiment.question, size: raw.start.size, start_date: raw.start.date,
    days: raw.experiment.days, seeds: n, seeds_run: raw.seeds_run, plugins: raw.plugins,
    note: "Evidence about this simulated business, not a prediction of a real one. Each difference is the arm minus the baseline in the same seed (same luck), averaged over seeds, with a 90% interval for that average.",
    arms: {}, timings: raw.timings,
  };
  for (const [id, arm] of Object.entries(raw.arms)) {
    if (id === "baseline") continue;
    const measures = {};
    for (const [k, meta] of Object.entries(MEASURES)) {
      const b = base.seeds.map((s) => s.measures[k]), a = arm.seeds.map((s) => s.measures[k]);
      if (b.every((x) => x === null || x === undefined) && a.every((x) => x === null || x === undefined)) continue;
      const d = a.map((x, i) => (typeof x === "number" && typeof b[i] === "number" ? x - b[i] : null));
      const sum = summarise90(d);
      const bm = mean(b.filter(Number.isFinite)), am = mean(a.filter(Number.isFinite));
      measures[k] = {
        label: meta.label, group: meta.group, unit: meta.unit, better: meta.better,
        baseline: r(bm), arm: r(am), difference: sum,
        relative: bm ? r(sum.mean / Math.abs(bm), 4) : null,
        direction: !sum.clear || !meta.better ? null : (sum.mean > 0) === (meta.better === "up") ? "better" : "worse",
      };
    }
    out.arms[id] = { id, label: arm.label, interventions: arm.interventions, applied: arm.applied.map(plainApplied), verdict: verdict(arm, measures, raw.experiment.days, n), measures };
  }
  return out;
}

const plainApplied = (a) => ({ day: a.day, date: a.date, what: a.label, summary: a.summary, changes: a.changes.slice(0, 12), changes_total: a.changes.length, refused: a.refused, error: a.error, ...(a.seed ? { seed: a.seed } : {}) });

/** How to say a number in a sentence. */
export function say(meta, x) {
  if (x === null) return "an unknown amount";
  const abs = Math.abs(x);
  if (meta.unit === "£") return `£${abs >= 100 ? Math.round(abs).toLocaleString("en-GB") : abs.toFixed(2)}`;
  if (meta.unit === "share") return `${(abs * 100).toFixed(1)} points`;
  if (meta.unit === "/5") return `${abs.toFixed(2)} points`;
  if (meta.unit === "min") return `${Math.round(abs)} minutes`;
  if (meta.unit === "h") return `${abs.toFixed(1)} hours`;
  return abs >= 10 ? String(Math.round(abs)) : String(Math.round(abs * 10) / 10);
}

/**
 * One sentence that never claims more than the numbers show: the clearest moves (interval excludes zero), and an
 * honest "could not tell" for net profit and orders when they did not clearly move.
 */
function verdict(arm, measures, days, seeds) {
  const lead = `In this simulated world, over ${days} days and ${seeds} ${seeds === 1 ? "run" : "runs"}, "${arm.label}"`;
  // WHY not visitors or followers: visitors is the simulator's estimate behind orders (it always moves with demand), and
  // followers drift; neither is a headline on its own.
  const clear = Object.entries(measures).filter(([k, m]) => m.difference.clear && m.difference.mean !== 0 && m.group !== "ai" && m.relative !== null && !["visitors", "followers"].includes(k))
    .sort((a, b) => Math.abs(b[1].relative) - Math.abs(a[1].relative));
  const pick = [];
  for (const k of ["net_profit", "orders", "customer_satisfaction"]) if (measures[k]?.difference.clear) pick.push(k);
  for (const [k] of clear) if (pick.length < 3 && !pick.includes(k)) pick.push(k);
  if (!pick.length) {
    const any = Object.values(measures).some((m) => m.difference.mean);
    return `${lead} made ${any ? "no difference we can tell apart from luck" : "no difference at all"} to any measure.`;
  }
  const bits = pick.slice(0, 3).map((k) => {
    const m = measures[k], d = m.difference;
    const range = d.ci90 ? ` (90% interval ${sign(m, d.ci90[0])} to ${sign(m, d.ci90[1])})` : "";
    return `${d.mean > 0 ? "raised" : "lowered"} ${m.label.replace(/ \(.*\)$/, "").toLowerCase()} by ${say(m, d.mean)}${range}`;
  });
  const unsure = ["net_profit", "orders"].filter((k) => measures[k] && !measures[k].difference.clear && !pick.includes(k)).map((k) => measures[k].label.replace(/ \(.*\)$/, "").toLowerCase());
  return `${lead} ${join(bits)}${unsure.length ? `; we cannot tell its effect on ${unsure.join(" or ")}` : ""}.`;
}
const sign = (m, x) => `${x < 0 ? "-" : "+"}${say(m, x)}`;
const join = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * The results as Markdown, for people.
 * @param {object} res buildResults()
 * @return {string}
 */
export function resultsMarkdown(res) {
  const lines = [`# ${res.title}`, "", res.question ? `**Question:** ${res.question}` : "", "",
    `${res.size} world from ${res.start_date}, ${res.days} days, ${res.seeds} seeds. ${res.note}`, ""];
  for (const arm of Object.values(res.arms)) {
    lines.push(`## ${arm.label}`, "", arm.verdict, "");
    for (const a of arm.applied) lines.push(`- Day ${a.day}: ${a.summary}${a.refused.length ? ` (refused: ${a.refused.join("; ")})` : ""}${a.error ? ` (not done: ${a.error})` : ""}`);
    lines.push("", "| Measure | Baseline | This arm | Difference (90% interval) |", "|---|---|---|---|");
    for (const m of Object.values(arm.measures)) {
      const d = m.difference;
      if (d.mean === 0 && m.baseline === m.arm && !m.baseline) continue;
      lines.push(`| ${m.label} | ${m.baseline ?? "n/a"} | ${m.arm ?? "n/a"} | ${d.mean ?? "n/a"}${d.ci90 ? ` (${d.ci90[0]} to ${d.ci90[1]})` : ""}${m.direction ? `, ${m.direction}` : ""} |`);
    }
    lines.push("");
  }
  lines.push(`Took ${(res.timings.total_ms / 1000).toFixed(1)} s.`);
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n") + "\n";
}
