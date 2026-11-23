// Simulator tests. Run: node --test simulation/simulator/sim.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate } from "./cli.mjs";
import { roi, summarise, paybackDay, percentile, tCrit } from "./stats.mjs";
import { buildReport, headline, reportMarkdown } from "./report.mjs";
import { judgeContact, csatFor, outreachQuality } from "./judge.mjs";
import { makeStreams, poissonFromUniform, topK } from "./lib.mjs";
import { freshWorld } from "../../infrastructure/server/world-data.mjs";

const quick = { days: 6, seeds: 2, role: "assistant", toolCost: 120, size: "demo", scale: 1, warmup: 0, popSeed: 1, firstSeed: 1, timelineSeeds: 0 };
const TOOL = "node simulation/simulator/examples/simple-responder.mjs";

test("determinism: the same seed gives an identical result, with and without a tool", async () => {
  const a = await simulate({ ...quick, seeds: 1 });
  const b = await simulate({ ...quick, seeds: 1 });
  assert.deepEqual(a, b);
  const c = await simulate({ ...quick, seeds: 1, toolCmd: TOOL });
  const d = await simulate({ ...quick, seeds: 1, toolCmd: TOOL });
  assert.deepEqual(c, d);
  const e = await simulate({ ...quick, seeds: 1, firstSeed: 2 });
  assert.notDeepEqual(e.seeds[0].baseline, a.seeds[0].baseline);
});

test("twin runs are isolated: the baseline is the same whether or not a tool runs after it, and the shared world data is untouched", async () => {
  const before = JSON.stringify(freshWorld("demo").state);
  const solo = await simulate({ ...quick, seeds: 1 });
  const twin = await simulate({ ...quick, seeds: 1, toolCmd: TOOL });
  assert.deepEqual(twin.seeds[0].baseline, solo.seeds[0].baseline);
  assert.notDeepEqual(twin.seeds[0].with_tool, twin.seeds[0].baseline, "the tool must change something");
  assert.equal(JSON.stringify(freshWorld("demo").state), before);
  // No tool: both arms are the baseline, so every paired difference is exactly zero.
  assert.equal(solo.paired_differences.net_profit.mean, 0);
  assert.equal(solo.paired_differences.revenue.mean, 0);
});

test("the example tool shows a real, non-zero effect, scored from records", async () => {
  const r = await simulate({ ...quick, seeds: 2, days: 10, toolCmd: TOOL });
  const w = r.seeds[0].with_tool, b = r.seeds[0].baseline;
  assert.ok(w.handled_by_tool > 0 && w.tool_calls > 0);
  assert.ok(w.first_response_median_minutes < b.first_response_median_minutes);
  assert.ok(r.time_freed.hours_saved.mean > 0);
  assert.equal(r.seeds.length, 2);
  assert.ok(r.payback.text.length > 0 && r.curve.day.length > 0 && r.headline.length > 0 && r.cash && r.time_freed);
});

test("tool failures are survived: a command that never answers counts as errors and staff do the work", async () => {
  const r = await simulate({ ...quick, seeds: 1, days: 3, toolCmd: "node -e \"process.stdin.resume()\"", toolCost: 0, toolTimeoutMs: 1500 }, {});
  assert.ok(r.seeds[0].with_tool.tool_errors > 0 || r.seeds[0].with_tool.contacts === 0);
}, { timeout: 120000 });

test("the ROI sum is cash by default: (change in net profit - tool cost) / tool cost; time saved counts only when asked", () => {
  assert.deepEqual(roi({ cashChange: 300, timeSavedValue: 200, toolCost: 250 }), { value_created: 300, cash_change: 300, time_saved_value: 200, time_counted: false, tool_cost: 250, net_value: 50, roi: 0.2 });
  assert.equal(roi({ cashChange: 300, timeSavedValue: 200, countTime: true, toolCost: 250 }).roi, 1);
  assert.equal(roi({ cashChange: 100, timeSavedValue: 0, toolCost: 400 }).roi, -0.75);
  assert.equal(roi({ cashChange: 100, timeSavedValue: 50, toolCost: 0 }).roi, null);
});

test("summary statistics: mean, median, percentiles and a 95% t interval", () => {
  const s = summarise([1, 2, 3, 4, 5]);
  assert.equal(s.mean, 3); assert.equal(s.median, 3); assert.equal(s.p10, 1.4); assert.equal(s.p90, 4.6);
  // half width = t(4) x sd / sqrt(n) = 2.776 x 1.5811 / 2.2361 = 1.963
  assert.deepEqual(s.ci95, [1.04, 4.96]);
  assert.equal(summarise([-1, 0, 1]).interval_note, "includes zero");
  assert.equal(summarise([5]).ci95, null);
  assert.equal(percentile([10, 20], 0.5), 15);
  assert.equal(tCrit(10), 2.228);
});

test("payback: the first day cumulative value passes cumulative tool cost", () => {
  assert.equal(paybackDay([0, 5, 12, 30], [10, 20, 30, 40]), null);
  assert.equal(paybackDay([5, 15, 35, 90], [10, 20, 30, 40]), 3);
});

const fakeRun = (gp, taskCost, days = 10, extra = {}) => {
  const day = Array.from({ length: days }, (_, i) => i + 1);
  return { totals: { days, orders: 100, new_customers: 0, lost_sales: 0, lost_value: 0, revenue: gp * 2, refunds: 0, cogs: gp, card_fees: 0, delivery_costs: 0, goodwill: 0, packaging: 0, staff_pay: 0, overtime_pay: 0, fixed_costs: 0, marketing: 0, outreach_cost: 0,
    contacts: 10, contacts_resolved: 5, csat_sum: 40, csat_n: 10, satisfied_n: 8, frt_n: 10, frt_sum: 100, task_minutes: taskCost * 4, task_cost: taskCost, overtime_minutes: 0, complaints: 0, reviews: 0, review_sum: 0, bad_reviews: 0, tool_refused: 1, ...extra },
    first_response_median_minutes: 5, first_response_p90_minutes: 9, reputation: 0.8, moments: { good: [], bad: [] },
    curve: { stride: 1, points: { day, gp: day.map((d) => (gp * d) / days), taskCost: day.map((d) => (taskCost * d) / days), revenue: day.map(() => 0), net: day.map((d) => (gp * d) / days) } } };
};

test("buildReport: two lenses, cash first; ROI and payback are cash unless time saved is counted", () => {
  const pairs = [1, 2, 3].map((seed) => ({ seed, baseline: fakeRun(1000, 400), tool: fakeRun(1000 + seed * 100, 300) }));
  const meta = { name: "t", days_compared: 10 };
  const rep = buildReport({ pairs, meta, toolCostPerMonth: 304, daysPerMonth: 30.4 });
  // 10 days of a £304 a month tool costs £100. Seed 2: net profit +£200, time saved worth £100.
  const s2 = rep.seeds[1];
  assert.equal(s2.roi.tool_cost, 100); assert.equal(s2.roi.cash_change, 200); assert.equal(s2.roi.time_saved_value, 100);
  assert.equal(s2.roi.roi, 1, "cash only: (200 - 100) / 100");
  assert.equal(rep.cash.net_profit_change.mean, 200);
  assert.equal(rep.time_freed.value_at_pay.mean, 100); assert.match(rep.time_freed.label, /not cash/);
  assert.equal(rep.payback.days, 1); assert.match(rep.payback.text, /after 1 day /);
  assert.match(rep.headline, /^With 3 seeds we can't yet tell whether it made money/);
  assert.match(rep.headline, /capacity, not cash/);
  const withTime = buildReport({ pairs, meta, toolCostPerMonth: 304, daysPerMonth: 30.4, countTimeSaved: true });
  assert.equal(withTime.seeds[1].roi.roi, 2, "with time counted: (200 + 100 - 100) / 100");
  assert.match(withTime.headline, /IS counted/);
  assert.equal(headline(pairs[0].baseline).gross_profit, 1000);
  assert.ok(reportMarkdownHas(rep, "## Cash") && reportMarkdownHas(rep, "## Time freed"));
});

test("headline words: clearly up, clearly down, and not paid back", () => {
  const up = buildReport({ pairs: [1, 2, 3].map((seed) => ({ seed, baseline: fakeRun(1000, 400), tool: fakeRun(1500 + seed, 300) })), meta: { name: "t", days_compared: 10 }, toolCostPerMonth: 304, daysPerMonth: 30.4 });
  assert.match(up.headline, /^It made money: net profit up £50\d/);
  const down = buildReport({ pairs: [1, 2, 3].map((seed) => ({ seed, baseline: fakeRun(1000, 400), tool: fakeRun(500 + seed, 300) })), meta: { name: "t", days_compared: 10 }, toolCostPerMonth: 304, daysPerMonth: 30.4 });
  assert.match(down.headline, /^It lost money: net profit down £49\d/);
  assert.match(down.payback.text, /has not paid for itself in cash within 10 days/);
  const one = buildReport({ pairs: [{ seed: 1, baseline: fakeRun(1000, 400), tool: fakeRun(1100, 300) }], meta: { name: "t", days_compared: 1 }, toolCostPerMonth: 30.4, daysPerMonth: 30.4 });
  assert.match(one.headline, /^With 1 seed we can't yet tell/);
});

test("biggest effects: refunds are explained from the records and ranked by money", () => {
  const b = fakeRun(1000, 400, 10, { refunds: 100 }), t = fakeRun(1000, 300, 10, { refunds: 800, csat_sum: 45 });
  const mk = (run, bd) => ({ ...run, totals: { ...run.totals, ...bd } });
  const base = mk(b, { "refund_by_staff:change_order": 100 }), tool = mk(t, { "refund_by_tool:cancel_order:change_order": 800, "refused:report_problem:rule_violation:fault": 30 });
  const rep = buildReport({ pairs: [{ seed: 1, baseline: base, tool }, { seed: 2, baseline: base, tool }], meta: { name: "t", days_compared: 10 }, toolCostPerMonth: 100, daysPerMonth: 30.4 });
  const eff = rep.moments_that_mattered.biggest_effects;
  assert.equal(eff[0].measure, "refunds");
  assert.match(eff[0].text, /Refunds up £700 per run.*change_order.*cancel/);
  assert.ok(eff.some((e) => e.measure === "rule_breaks" && /report_problem \(rule_violation\) on "fault"/.test(e.text)));
});

const reportMarkdownHas = (rep, text) => reportMarkdown(rep).includes(text);

test("judge: outcomes come from the calls in the records, not from the reply", () => {
  const read = [{ tool: "verify_customer", ok: true }, { tool: "get_order", ok: true }];
  assert.equal(judgeContact("where_is_my_order", read, "It is on its way.").outcome, "resolved");
  assert.equal(judgeContact("where_is_my_order", [], "I have checked and it is on its way.").outcome, "failed");
  assert.equal(judgeContact("late_parcel", read, "Sorry about the delay.").outcome, "partial");
  assert.equal(judgeContact("late_parcel", [...read, { tool: "escalate", ok: true }], "Passed on.").outcome, "handed_over");
  assert.equal(judgeContact("where_is_my_order", [...read, { tool: "cancel_order", ok: true }], "Cancelled it for you.").outcome, "wrong_action");
  assert.equal(judgeContact("damaged", [...read, { tool: "report_problem", ok: true, result: { outcome: "replacement" } }], "Replacement sent.").outcome, "resolved");
  assert.equal(judgeContact("damaged", [...read, { tool: "report_problem", ok: false, error: { code: "needs_human" } }, { tool: "escalate", ok: true }], "Passed on.").outcome, "handed_over");
  assert.equal(judgeContact("complaint", read, "So sorry about that, all sorted.").outcome, "partial");
});

test("satisfaction falls with slow replies and waiting days, and stays between 1 and 5", () => {
  const cfg = { resolved: 4.5, resolved_by_staff: 4.3, handed_over: 3.9, partial: 3, failed: 1.8, wrong_action: 1.3, abandoned: 1, slow_penalty: 0.8, late_day_penalty: 0.4, max_late_day_penalty: 1.2, sla_minutes: 240 };
  assert.equal(csatFor(cfg, { outcome: "resolved", byTool: true, firstResponseMinutes: 1, lateDays: 0 }), 4.5);
  assert.ok(Math.abs(csatFor(cfg, { outcome: "resolved", byTool: false, firstResponseMinutes: 600, lateDays: 2 }) - (4.3 - 0.8 - 0.8)) < 1e-9);
  assert.equal(csatFor(cfg, { outcome: "abandoned", byTool: false, firstResponseMinutes: 9999, lateDays: 9 }), 1);
});

test("outreach quality rewards a matched, personalised offer by the right channel", () => {
  const cfg = { quality: { personalised: 0.25, offer_fit: 0.35, channel_match: 0.15, discount_ok: 0.15, base: 0.1 } };
  const p = { name: "The Globe Playhouse", decision_maker: { name: "Peter Quince" }, preferred_channel: "email", needs: [{ sku: "OT-SAND-HAM-3" }, { sku: "OT-TROF" }] };
  const generic = outreachQuality(cfg, { message: "Hello, buy things.", channel: "letter", offer: null }, p).quality;
  const good = outreachQuality(cfg, { message: "Dear Quince, sandwiches and trophies for the Globe Playhouse.", channel: "email", offer: { items: [{ sku: "OT-SAND-HAM-3", qty: 10 }, { sku: "OT-TROF", qty: 6 }], discount_percent: 5 } }, p).quality;
  assert.ok(good > 0.95 && generic < 0.25);
});

test("random streams: keyed by purpose and facts, so a run keeps in step; Poisson counts are coupled to one uniform", () => {
  const S = makeStreams(7), T = makeStreams(7);
  assert.equal(S("arrivals", "2026-11-24").next(), T("arrivals", "2026-11-24").next());
  assert.notEqual(S("arrivals", "2026-11-24").next(), S("contacts", "2026-11-24").next());
  assert.ok(poissonFromUniform(10, 0.5) <= poissonFromUniform(12, 0.5));
  assert.ok(poissonFromUniform(500, 0.5) > 450);
  const k = topK(2, (x) => x.v); [3, 9, 1, 7].forEach((v) => k.add({ v }));
  assert.deepEqual(k.items.map((x) => x.v), [9, 7]);
});

test("options: no upper cap on days, seeds, scale or customers; warm-up days are left out of the comparison", async () => {
  const r = await simulate({ ...quick, seeds: 1, days: 8, warmup: 3, scale: 2, customers: 700 });
  assert.equal(r.meta.days_compared, 5);
  assert.equal(r.meta.warmup_days, 3);
  assert.equal(r.seeds[0].baseline.days, 5);
});

test("a prospecting tool wins new business through the engine's outreach rules, and staff alone win less", async () => {
  const r = await simulate({ ...quick, seeds: 1, days: 25, role: "marketing", toolCmd: "node simulation/simulator/examples/simple-prospector.mjs", toolCost: 0 });
  const w = r.seeds[0].with_tool, b = r.seeds[0].baseline;
  assert.ok(w.prospects_contacted > b.prospects_contacted, `${w.prospects_contacted} vs ${b.prospects_contacted}`);
  assert.ok(w.prospects_won >= b.prospects_won);
  assert.ok(w.tool_calls > 0);
  assert.equal(w.rule_breaks, 0, "the prospector follows the outreach rules");
});
