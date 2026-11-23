// Turns per-seed pairs of runs into report.json and report.md. Everything is computed from run totals (the engine's records),
// never from what a tool said it did. The JSON shape is documented in simulation/simulator/README.md.
import { summarise, roi, paybackDay, mean, median, percentile } from "./stats.mjs";

const r2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

/**
 * Survival per arm: in how many seeds the bank balance (opening cash plus every day's money in and out) went below
 * zero, and the lowest it went on average.
 */
export function survivalOf(pairs) {
  const arm = (k) => {
    const s = pairs.map((p) => p[k].survival).filter(Boolean);
    if (!s.length) return null;
    return { seeds: s.length, ran_out_of_cash: s.filter((x) => x.ran_out_of_cash).length, lowest_cash_mean: r2(s.reduce((n, x) => n + x.lowest_cash, 0) / s.length), cash_at_end_mean: r2(s.reduce((n, x) => n + x.cash_now, 0) / s.length) };
  };
  return { label: "Did the business run out of cash?", baseline: arm("baseline"), with_tool: arm("tool") };
}

/** One run's headline numbers. t is the run's totals (after any warm-up). */
export function headline(res, scaleDays) {
  const t = res.totals, gp = t.revenue - t.refunds - t.cogs;
  const net = gp - t.card_fees - t.delivery_costs - t.goodwill - t.packaging - t.staff_pay - t.overtime_pay - t.fixed_costs - t.marketing - t.outreach_cost;
  return {
    days: t.days, orders: t.orders, new_customers: t.new_customers, lost_sales: t.lost_sales, lost_sales_value: r2(t.lost_value),
    revenue: r2(t.revenue), refunds: r2(t.refunds), gross_profit: r2(gp), net_profit: r2(net),
    costs: { card_fees: r2(t.card_fees), delivery: r2(t.delivery_costs), goodwill: r2(t.goodwill), packaging: r2(t.packaging), staff_pay: r2(t.staff_pay), overtime_pay: r2(t.overtime_pay), fixed: r2(t.fixed_costs), marketing: r2(t.marketing), outreach: r2(t.outreach_cost) },
    customer_satisfaction: t.csat_n ? r2(t.csat_sum / t.csat_n) : null,
    share_satisfied: t.csat_n ? r2(t.satisfied_n / t.csat_n) : null,
    first_response_median_minutes: res.first_response_median_minutes, first_response_p90_minutes: res.first_response_p90_minutes,
    first_response_mean_minutes: t.frt_n ? r2(t.frt_sum / t.frt_n) : null,
    contacts: t.contacts, resolution_rate: t.contacts ? r2(t.contacts_resolved / t.contacts) : null, abandoned_contacts: t.contacts_abandoned,
    handled_by_tool: t.contacts_tool, handed_over_by_tool: t.contacts_handed_over, handled_by_staff: t.contacts_staff,
    staff_task_hours: r2(t.task_minutes / 60), staff_overtime_hours: r2(t.overtime_minutes / 60), staff_task_cost: r2(t.task_cost),
    complaints: t.complaints, reviews: t.reviews, average_review: t.reviews ? r2(t.review_sum / t.reviews) : null, bad_reviews: t.bad_reviews, reputation: res.reputation,
    tool_calls: t.tool_calls, rule_breaks: t.tool_refused, refused_tool_calls: t.tool_refused, failed_tool_calls: t.tool_failed, tool_errors: t.tool_errors, wrong_actions: t.wrong_actions,
    prospects_contacted: t.prospects_contacted, prospects_replied: t.prospects_replied, prospects_won: t.prospects_won, new_business_revenue: r2(t.prospect_revenue),
    breakdown: Object.fromEntries(Object.entries(t).filter(([k]) => k.startsWith("refund_by_") || k.startsWith("refused:")).map(([k, v]) => [k, r2(v)])),
    purchase_orders_raised: t.pos_raised, late_parcels: t.late_parcels, stockout_product_days: t.stockout_sku_days,
  };
}

const DELTA_KEYS = ["revenue", "gross_profit", "net_profit", "refunds", "customer_satisfaction", "share_satisfied", "first_response_median_minutes", "resolution_rate", "staff_task_hours", "staff_overtime_hours", "complaints", "bad_reviews", "average_review", "rule_breaks", "wrong_actions", "prospects_won", "new_business_revenue", "lost_sales", "lost_sales_value", "abandoned_contacts", "orders", "reviews"];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const money = (x) => (x === null || x === undefined ? "n/a" : `${x < 0 ? "-" : ""}£${Math.abs(x).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
const sgnMoney = (x) => (x === null || x === undefined ? "n/a" : `${x >= 0 ? "+" : "-"}£${Math.abs(x).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`);
const sgn = (x, f = (v) => v) => (x === null || x === undefined ? "n/a" : `${x > 0 ? "+" : ""}${f(x)}`);
const ci = (s, f = (v) => v) => (s.ci95 ? `${f(s.ci95[0])} to ${f(s.ci95[1])}` : "n/a");
/** Estimated cost of one 1 or 2 star review, in lost future sales. A stated assumption, not a measurement. */
const BAD_REVIEW_COST = 25;
/** Why a kind of contact moves refunds, in words. Only used with the numbers that show it happened. */
const WHY = {
  change_order: "customers asked to cancel and the tool did it at once, while the parcel was still unpacked; staff replied hours later, when many parcels had already gone, so fewer cancellations went through",
  damaged: "claims for damaged items were settled more often", missing: "claims for missing items were settled more often", fault: "claims for faulty items were settled more often",
  return_question: "more returns were created on the spot", complaint: "more complaints ended in a refund",
};

/** Sum of breakdown entries per topic: { topic: { tool: £, staff: £ } }, averaged over seeds. */
function refundCauses(seeds) {
  const by = {};
  for (const s of seeds) for (const arm of ["baseline", "with_tool"]) for (const [k, v] of Object.entries(s[arm].breakdown || {})) {
    const [kind, ...rest] = k.split(":");
    if (!kind.startsWith("refund_by_")) continue;
    const topic = rest[rest.length - 1], who = kind === "refund_by_tool" ? "tool" : "staff";
    const e = (by[topic] ||= { baseline_staff: 0, tool_arm_tool: 0, tool_arm_staff: 0 });
    if (arm === "baseline") e.baseline_staff += v; else if (who === "tool") e.tool_arm_tool += v; else e.tool_arm_staff += v;
  }
  for (const e of Object.values(by)) for (const k of Object.keys(e)) e[k] = e[k] / seeds.length;
  return by;
}
function refusalCauses(seeds) {
  const by = {};
  for (const s of seeds) for (const [k, v] of Object.entries(s.with_tool.breakdown || {})) if (k.startsWith("refused:")) { const [, tool, code, topic] = k.split(":"); const key = `${tool} (${code}) on "${topic}" contacts`; by[key] = (by[key] || 0) + v / seeds.length; }
  return Object.entries(by).sort((a, b) => b[1] - a[1]);
}

/**
 * The biggest effects of the tool, from the paired numbers and the causes found in the records, ranked by money.
 * impact_gbp is the money effect (positive is good for the business); service effects without a money figure come last.
 */
function biggestEffects(d, seeds, hasTool) {
  const out = [];
  const mean = (k) => d[k].mean;
  const refunds = mean("refunds");
  if (refunds) {
    const causes = refundCauses(seeds);
    const ranked = Object.entries(causes).map(([t, e]) => [t, (e.tool_arm_tool + e.tool_arm_staff) - e.baseline_staff]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const top = ranked[0];
    const c = top && causes[top[0]];
    const why = top ? ` Mostly on "${top[0]}" contacts (${money(Math.round(c.tool_arm_tool + c.tool_arm_staff))} refunded with the tool, ${money(Math.round(c.baseline_staff))} by staff alone): ${WHY[top[0]] || "the tool resolved more of these"}.` : "";
    out.push({ measure: "refunds", change: refunds, impact_gbp: -refunds, text: `Refunds ${refunds > 0 ? "up" : "down"} ${money(Math.abs(refunds))} per run.${why}`, estimated: false });
  }
  if (mean("new_business_revenue")) out.push({ measure: "new_business_revenue", change: mean("new_business_revenue"), impact_gbp: mean("new_business_revenue"), text: `New business from prospects ${sgnMoney(mean("new_business_revenue"))} per run (${sgn(mean("prospects_won"))} prospects won).`, estimated: false });
  if (mean("lost_sales_value")) out.push({ measure: "lost_sales_value", change: mean("lost_sales_value"), impact_gbp: -mean("lost_sales_value"), text: `Sales lost to empty shelves ${mean("lost_sales_value") > 0 ? "up" : "down"} ${money(Math.abs(mean("lost_sales_value")))} per run.`, estimated: false });
  if (mean("bad_reviews")) out.push({ measure: "bad_reviews", change: mean("bad_reviews"), impact_gbp: -mean("bad_reviews") * BAD_REVIEW_COST, text: `1 and 2 star reviews ${sgn(mean("bad_reviews"))} per run (valued at ${money(BAD_REVIEW_COST)} each in lost future sales: an assumption).`, estimated: true });
  if (mean("abandoned_contacts")) out.push({ measure: "abandoned_contacts", change: mean("abandoned_contacts"), impact_gbp: -mean("abandoned_contacts") * 45, text: `Contacts never answered ${sgn(mean("abandoned_contacts"))} per run (each valued at £45 of lost custom: an assumption).`, estimated: true });
  if (hasTool) {
    const refusals = refusalCauses(seeds), total = refusals.reduce((n, [, v]) => n + v, 0);
    if (total > 0) out.push({ measure: "rule_breaks", change: mean("rule_breaks"), impact_gbp: null, text: `${Math.round(total)} tool calls per run were refused by the rules, nearly all ${refusals.slice(0, 2).map(([k, v]) => `${k} (${Math.round(v)})`).join(" and ")}.`, estimated: false });
    if (mean("wrong_actions")) out.push({ measure: "wrong_actions", change: mean("wrong_actions"), impact_gbp: -mean("wrong_actions") * 40, text: `Unrequested changes ${sgn(mean("wrong_actions"))} per run.`, estimated: true });
  }
  if (mean("customer_satisfaction") !== null) out.push({ measure: "customer_satisfaction", change: mean("customer_satisfaction"), impact_gbp: null, text: `Customer satisfaction ${sgn(mean("customer_satisfaction"))} on the 1 to 5 scale (${sgn(Math.round((mean("share_satisfied") || 0) * 100))} points more customers satisfied).`, estimated: false });
  if (mean("first_response_median_minutes") !== null) out.push({ measure: "first_response", change: mean("first_response_median_minutes"), impact_gbp: null, text: `Median first response ${sgn(mean("first_response_median_minutes"))} minutes.`, estimated: false });
  out.sort((a, b) => (b.impact_gbp === null ? -1 : Math.abs(b.impact_gbp)) - (a.impact_gbp === null ? -1 : Math.abs(a.impact_gbp)));
  return out;
}

/** The headline, cash first, in plain words, including when it is negative or unclear. */
function headlineText({ net, seeds, toolCostPerMonth, payback, tl }) {
  const n = seeds, avg = net.mean;
  let cash;
  if (n < 2) cash = `With ${plural(n, "seed", "seeds")} we can't yet tell whether it made money: net profit changed by ${sgnMoney(avg)} in the one run.`;
  else if (net.ci95[0] <= 0 && net.ci95[1] >= 0) cash = `With ${plural(n, "seed", "seeds")} we can't yet tell whether it made money: net profit changed by ${sgnMoney(avg)} on average (95% interval ${sgnMoney(net.ci95[0])} to ${sgnMoney(net.ci95[1])}).`;
  else if (avg > 0) cash = `It made money: net profit up ${money(avg)} on average (95% interval ${sgnMoney(net.ci95[0])} to ${sgnMoney(net.ci95[1])}), over ${plural(n, "seed", "seeds")}.`;
  else cash = `It lost money: net profit down ${money(-avg)} on average (95% interval ${sgnMoney(net.ci95[0])} to ${sgnMoney(net.ci95[1])}), over ${plural(n, "seed", "seeds")}.`;
  const time = ` Separately it freed ${tl.hours} staff hours (worth ${money(tl.value)} at pay: capacity, not cash, because wages are paid either way).`;
  return `${cash} ${payback}${time}`;
}

/**
 * pairs: [{ seed, baseline: result, tool: result }]. Returns the whole report object.
 * Two lenses. Cash: the change in net profit (the money that actually changed). Time freed: staff task hours saved, valued at pay,
 * shown as capacity, not cash. ROI and payback use cash unless countTimeSaved is true, which adds the time value.
 * Tool cost is the monthly price spread over the days compared.
 */
export function buildReport({ pairs, meta, toolCostPerMonth, daysPerMonth, countTimeSaved = false }) {
  const hasTool = pairs.some((p) => p.tool !== p.baseline);
  const perSeed = pairs.map((p) => {
    const b = headline(p.baseline), t = headline(p.tool);
    const days = t.days, toolCost = toolCostPerMonth * days / daysPerMonth;
    const cashChange = t.net_profit - b.net_profit;
    const timeSavedValue = b.staff_task_cost - t.staff_task_cost, hoursSaved = b.staff_task_hours - t.staff_task_hours;
    const calc = roi({ cashChange, timeSavedValue, countTime: countTimeSaved, toolCost });
    const cb = p.baseline.curve, ct = p.tool.curve, n = Math.min(cb.points.day.length, ct.points.day.length);
    const cumValue = [], cumCost = [];
    for (let i = 0; i < n; i++) { cumValue.push((ct.points.net[i] - cb.points.net[i]) + (countTimeSaved ? cb.points.taskCost[i] - ct.points.taskCost[i] : 0)); cumCost.push(toolCostPerMonth * cb.points.day[i] / daysPerMonth); }
    const idx = paybackDay(cumValue, cumCost);
    return { seed: p.seed, baseline: b, with_tool: t, delta: Object.fromEntries(DELTA_KEYS.map((k) => [k, b[k] === null || t[k] === null ? null : r2(t[k] - b[k])])), hours_saved: r2(hoursSaved), roi: { ...calc, hours_saved: r2(hoursSaved) }, payback_days: idx === null ? null : cb.points.day[idx - 1], _curves: { value: cumValue, cost: cumCost, days: cb.points.day.slice(0, n) } };
  });

  const deltas = {};
  for (const k of DELTA_KEYS) deltas[k] = summarise(perSeed.map((s) => s.delta[k]));
  const base = {}, tool = {};
  for (const k of ["revenue", "gross_profit", "net_profit", "customer_satisfaction", "first_response_median_minutes", "resolution_rate", "staff_task_hours", "refunds", "complaints"]) {
    base[k] = r2(mean(perSeed.map((s) => s.baseline[k]).filter((x) => x !== null))); tool[k] = r2(mean(perSeed.map((s) => s.with_tool[k]).filter((x) => x !== null)));
  }
  const timeLens = {
    label: "Capacity, not cash: staff are paid for their contracted hours whether or not the tool saves them time.",
    hours_saved: summarise(perSeed.map((s) => s.hours_saved)), value_at_pay: summarise(perSeed.map((s) => s.roi.time_saved_value)),
    overtime_hours_change: deltas.staff_overtime_hours,
  };
  const cashLens = {
    label: "Cash: the change in net profit, the money that actually changed. Tool cost is separate.",
    net_profit_change: deltas.net_profit, gross_profit_change: deltas.gross_profit, refunds_change: deltas.refunds, revenue_change: deltas.revenue,
    tool_cost: r2(mean(perSeed.map((s) => s.roi.tool_cost))), net_profit_change_after_tool_cost: summarise(perSeed.map((s) => r2(s.delta.net_profit - s.roi.tool_cost))),
  };
  const roiSummary = {
    basis: countTimeSaved ? "cash plus time saved (--count-time-saved)" : "cash only",
    value_created: summarise(perSeed.map((s) => s.roi.value_created)), tool_cost: cashLens.tool_cost, net_value: summarise(perSeed.map((s) => s.roi.net_value)),
    roi: toolCostPerMonth > 0 ? summarise(perSeed.map((s) => s.roi.roi), 3) : null,
    formula: countTimeSaved ? "ROI = (change in net profit + staff time saved x pay - tool cost) / tool cost, per seed, then summarised." : "ROI = (change in net profit - tool cost) / tool cost, per seed, then summarised. Staff time saved is shown separately, not counted.",
  };
  const n = perSeed.length ? Math.min(...perSeed.map((s) => s._curves.value.length)) : 0;
  const meanValue = [], meanCost = [], dayAt = perSeed[0]?._curves.days.slice(0, n) || [];
  for (let i = 0; i < n; i++) { meanValue.push(mean(perSeed.map((s) => s._curves.value[i]))); meanCost.push(mean(perSeed.map((s) => s._curves.cost[i]))); }
  const idx = n ? paybackDay(meanValue, meanCost) : null, pb = idx === null ? null : dayAt[idx - 1];
  const seedDays = perSeed.map((s) => s.payback_days).filter((x) => x !== null);
  const basisWords = countTimeSaved ? "counting cash and staff time saved" : "in cash";
  const payback = {
    basis: roiSummary.basis, days: pb, weeks: pb === null ? null : r2(pb / 7), per_seed_median_days: seedDays.length ? median(seedDays) : null, seeds_that_paid_back: seedDays.length, seeds: perSeed.length,
    text: toolCostPerMonth <= 0 ? "No tool cost was entered, so there is nothing to pay back." : pb === null ? `It has not paid for itself ${basisWords} within ${plural(meta.days_compared, "day", "days")}.` : `It paid for itself ${basisWords} after ${plural(pb, "day", "days")} (${r2(pb / 7)} weeks)${deltas.net_profit.interval_note === "includes zero" ? ", but the profit interval includes zero, so this is not firm" : ""}.`,
  };
  const headlineLine = headlineText({ net: deltas.net_profit, seeds: perSeed.length, toolCostPerMonth, payback: payback.text, tl: { hours: timeLens.hours_saved.mean, value: timeLens.value_at_pay.mean } }) + (countTimeSaved ? " Staff time saved IS counted in the return and payback figures (--count-time-saved)." : "");
  const curve = { stride_days: pairs[0]?.baseline.curve.stride || 1, basis: roiSummary.basis, day: dayAt, value_created: meanValue.map(r2), tool_cost: meanCost.map(r2) };
  const moments = pairs.flatMap((p) => [...p.tool.moments.good.map((m) => ({ ...m, seed: p.seed })), ...p.tool.moments.bad.map((m) => ({ ...m, seed: p.seed }))]);
  const events = { wins: moments.filter((m) => m.value >= 0).sort((a, b) => b.value - a.value).slice(0, 5), mistakes: moments.filter((m) => m.value < 0).sort((a, b) => a.value - b.value).slice(0, 5) };
  const wide = deltas.net_profit.interval_note;
  return {
    meta: { ...meta, tool_cost_per_month: toolCostPerMonth, count_time_saved: countTimeSaved, seeds: perSeed.length, interval_note: perSeed.length < 2 ? "Only one seed: no interval. Use more seeds." : wide ? `The 95% interval for net profit is still wide (${wide}). Run more seeds for a firmer answer.` : "The 95% interval for net profit does not include zero." },
    headline: headlineLine, cash: cashLens, time_freed: timeLens, payback, roi: roiSummary, baseline_mean: base, with_tool_mean: tool, paired_differences: deltas,
    // Did the business keep money in the bank? (EnterpriseArena-style survival, per arm.)
    survival: survivalOf(pairs),
    moments_that_mattered: { biggest_effects: biggestEffects(deltas, perSeed, hasTool), ...events }, curve, seeds: perSeed.map(({ _curves, ...s }) => s),
  };
}

export function reportMarkdown(rep) {
  const m = rep.meta, d = rep.paired_differences, ro = rep.roi, c = rep.cash, tf = rep.time_freed;
  const row = (label, key, f = (v) => v) => `| ${label} | ${f(rep.baseline_mean[key])} | ${f(rep.with_tool_mean[key])} | ${sgn(d[key].mean, f)} | ${sgn(d[key].median, f)} | ${sgn(d[key].p10, f)} to ${sgn(d[key].p90, f)} | ${ci(d[key], f)} |`;
  const lines = [
    `# Simulation report: ${m.name}`, "", `**${rep.headline}**`, "",
    `${plural(m.days_compared, "day", "days")} compared${m.warmup_days ? ` (after ${m.warmup_days} warm-up days)` : ""}, ${plural(m.seeds, "seed", "seeds")}, size ${m.size}, scale ${m.scale}, ${m.customers} customers. Tool role: ${m.role}. Tool cost: ${money(m.tool_cost_per_month)} a month.`, "",
    `## Cash: the money that changed`,
    `- Net profit ${sgnMoney(d.net_profit.mean)} on average (median ${sgnMoney(d.net_profit.median)}; 10th to 90th ${sgnMoney(d.net_profit.p10)} to ${sgnMoney(d.net_profit.p90)}; 95% interval ${ci(d.net_profit, sgnMoney)}).`,
    `- Gross profit ${sgnMoney(d.gross_profit.mean)} (95% interval ${ci(d.gross_profit, sgnMoney)}); revenue ${sgnMoney(d.revenue.mean)}; refunds ${sgnMoney(d.refunds.mean)}.`,
    `- Tool cost over the run: ${money(c.tool_cost)}. Net profit change after tool cost: ${sgnMoney(c.net_profit_change_after_tool_cost.mean)} (95% interval ${ci(c.net_profit_change_after_tool_cost, sgnMoney)}).`,
    `- Return on investment (${ro.basis}): ${ro.roi ? `${ro.roi.mean} (95% interval ${ci(ro.roi)})` : "no tool cost entered"}. ${ro.formula}`,
    `- ${rep.payback.text}`, `- ${m.interval_note}`, "",
    `## Time freed: capacity, not cash`,
    `- ${tf.hours_saved.mean} staff task hours saved over the run (95% interval ${ci(tf.hours_saved)}), worth ${money(tf.value_at_pay.mean)} at pay.`,
    `- ${tf.label}${m.count_time_saved ? " This run counts that value in the return and payback because --count-time-saved was set." : " It is not counted in the return or payback (use --count-time-saved to count it)."}`,
    `- Overtime hours: ${sgn(tf.overtime_hours_change.mean)} per run.`, "",
    `## Baseline against with-tool (mean over seeds)`,
    `The differences are paired: with-tool minus baseline for the same seed, then summarised. "10th to 90th" is the range of the middle 80% of seeds.`, "",
    `| Measure | Baseline | With tool | Mean difference | Median | 10th to 90th | 95% interval |`, `|---|---|---|---|---|---|---|`,
    row("Revenue", "revenue", money), row("Gross profit", "gross_profit", money), row("Net profit", "net_profit", money), row("Refunds", "refunds", money),
    row("Customer satisfaction (1 to 5)", "customer_satisfaction"), row("First response, median minutes", "first_response_median_minutes"), row("Resolution rate", "resolution_rate"),
    row("Staff task hours", "staff_task_hours"), row("Complaints", "complaints"),
    `| Reviews of 1 or 2 stars | | | ${sgn(d.bad_reviews.mean)} | ${sgn(d.bad_reviews.median)} | ${sgn(d.bad_reviews.p10)} to ${sgn(d.bad_reviews.p90)} | ${ci(d.bad_reviews)} |`,
    `| New business won from prospects (revenue) | | | ${sgnMoney(d.new_business_revenue.mean)} | ${sgnMoney(d.new_business_revenue.median)} | ${sgnMoney(d.new_business_revenue.p10)} to ${sgnMoney(d.new_business_revenue.p90)} | ${ci(d.new_business_revenue, sgnMoney)} |`,
    `| Prospects won | | | ${sgn(d.prospects_won.mean)} | ${sgn(d.prospects_won.median)} | ${sgn(d.prospects_won.p10)} to ${sgn(d.prospects_won.p90)} | ${ci(d.prospects_won)} |`, "",
    `Customer satisfaction is worked out from outcomes: each contact scores 1 to 5 (resolved 4.5, handed over properly 3.9, resolved by staff 4.3, partly 3.0, failed 1.8, wrong action 1.3, never answered 1.0), minus a penalty for a slow first reply and for each extra day waiting. See simulation/simulator/README.md.`, "",
    `## Moments that mattered`, `**Biggest effects** (ranked by money; service effects without a money figure come last)`,
    ...rep.moments_that_mattered.biggest_effects.map((e) => `- ${e.text}${e.impact_gbp !== null ? ` (${sgnMoney(e.impact_gbp)}${e.estimated ? ", estimated" : ""})` : ""}`),
    "", `**Single events: biggest wins**`,
    ...(rep.moments_that_mattered.wins.length ? rep.moments_that_mattered.wins.map((x) => `- Day ${x.day + 1} (seed ${x.seed}): ${x.text}`) : ["- None recorded."]),
    "", `**Single events: worst mistakes**`,
    ...(rep.moments_that_mattered.mistakes.length ? rep.moments_that_mattered.mistakes.map((x) => `- Day ${x.day + 1} (seed ${x.seed}): ${x.text}`) : ["- None recorded."]),
    "", `## Per seed`, `| Seed | Net profit difference | Hours saved | ROI | Paid back after |`, `|---|---|---|---|---|`,
    ...rep.seeds.slice(0, 40).map((s) => `| ${s.seed} | ${sgnMoney(s.delta.net_profit)} | ${s.hours_saved} | ${s.roi.roi ?? "n/a"} | ${s.payback_days === null ? "never" : plural(s.payback_days, "day", "days")} |`),
    rep.seeds.length > 40 ? `| ... | ${rep.seeds.length - 40} more seeds in report.json | | | |` : "",
    "", `## Next actions`, ...nextActions(rep).map((a, i) => `${i + 1}. ${a}`), "",
  ];
  return lines.join("\n");
}

function nextActions(rep) {
  const d = rep.paired_differences, out = [];
  if (rep.meta.seeds < 10) out.push(`Run more seeds (try --seeds 30): with ${rep.meta.seeds} the intervals are wide.`);
  const ref = rep.moments_that_mattered.biggest_effects.find((e) => e.measure === "rule_breaks");
  if (ref) out.push("Stop the tool making the calls the rules refuse (listed under biggest effects); each one is counted as a rule break.");
  if (d.wrong_actions.mean > 0) out.push("Open the timeline for the worst wrong action and fix what the tool did (see the timeline folder).");
  if (d.customer_satisfaction.mean !== null && d.customer_satisfaction.mean < 0) out.push("Satisfaction fell: check which contact types it fails (the timeline shows each day's hand-overs).");
  if (rep.payback.days === null && rep.meta.tool_cost_per_month > 0) out.push("It has not paid back in cash: widen what it handles, or lower its cost.");
  if (!out.length) out.push("Try a longer run (--days 90) and a harder month (December) to see whether the result holds.");
  return out.slice(0, 3);
}
