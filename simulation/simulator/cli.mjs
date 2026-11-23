#!/usr/bin/env node
// pnpm sim -- --days 30 --seeds 30 [--tool-cmd "<cmd>" | --tool-http <url>] [--role assistant] [--tool-cost <£/month>] [--size demo|standard]
//   [--scale 1] [--customers N] [--warmup N] [--pop-seed 1] [--out simulation/simulator/results/<name>] [--data <folder>] [--timeline-seeds 3]
// See simulation/simulator/README.md.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";
import { SandboxStore } from "../../infrastructure/server/sandboxes.mjs";
import { createApp } from "../../infrastructure/server/http.mjs";
import { loadBusiness, ROOT } from "./data.mjs";
import { makeToolClient } from "./tool.mjs";
import { loadPlugins } from "./plugins.mjs";
import { dataFor } from "../../infrastructure/server/world-data.mjs";
import { runOnce } from "./run.mjs";
import { buildReport, reportMarkdown } from "./report.mjs";

export function parseOptions(argv) {
  const { values: v } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      days: { type: "string", default: "30" }, seeds: { type: "string", default: "30" }, "tool-cmd": { type: "string" }, "tool-http": { type: "string" },
      role: { type: "string", default: "assistant" }, "tool-cost": { type: "string", default: "0" }, size: { type: "string", default: "standard" },
      scale: { type: "string" }, customers: { type: "string" }, warmup: { type: "string", default: "0" }, "pop-seed": { type: "string", default: "1" },
      out: { type: "string" }, data: { type: "string" }, "timeline-seeds": { type: "string", default: "3" }, "first-seed": { type: "string", default: "1" }, name: { type: "string" }, "count-time-saved": { type: "boolean", default: false },
      "rich-customers": { type: "boolean", default: false }, plugins: { type: "string", default: "" },
    },
  });
  const days = ["forever", "inf", "infinity", "0"].includes(v.days) ? Infinity : Number(v.days);
  if (!(days > 0)) throw new Error("--days must be a positive number (or 'forever').");
  const seeds = Number(v.seeds);
  if (!(seeds >= 1)) throw new Error("--seeds must be at least 1.");
  // No --scale: the world's own size (company.scale, where its history stopped), else 1. See simulation/simulator/core.mjs scaleFor.
  const scale = v.scale === undefined ? null : Number(v.scale);
  if (scale !== null && !(scale > 0)) throw new Error("--scale must be above 0.");
  return { days, seeds, toolCmd: v["tool-cmd"], toolHttp: v["tool-http"], role: v.role, toolCost: Number(v["tool-cost"]), size: v.size, scale, customers: v.customers ? Number(v.customers) : null,
    warmup: Number(v.warmup), popSeed: Number(v["pop-seed"]), out: v.out, data: v.data, timelineSeeds: Number(v["timeline-seeds"]), firstSeed: Number(v["first-seed"]), name: v.name, countTimeSaved: v["count-time-saved"],
    customerModel: v["rich-customers"] ? "rich" : "classic", plugins: v.plugins ? v.plugins.split(",").map((x) => x.trim()).filter(Boolean) : [] };
}

export async function simulate(opts, { log = () => {} } = {}) {
  // `opts.biz` lets a caller (the sensitivity report) pass business files changed in memory.
  const biz = opts.biz || loadBusiness(opts.data ? path.resolve(opts.data) : undefined);
  const plugins = opts.plugins?.length
    ? (await loadPlugins({ only: opts.plugins, dataDir: path.join(ROOT, "business", "data"), biz, products: dataFor(opts.size).products })).plugins : [];
  const store = new SandboxStore({ maxSandboxes: 4 });
  const server = createApp({ store, rateLimit: 1e9 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  let stop = false;
  const onSig = () => { stop = true; };
  process.on("SIGINT", onSig);
  const hasTool = !!(opts.toolCmd || opts.toolHttp);
  const outDir = opts.out ? path.resolve(opts.out) : null;
  if (outDir) { fs.mkdirSync(path.join(outDir, "timeline"), { recursive: true }); }
  const pairs = [];
  try {
    for (let i = 0; i < opts.seeds && !stop; i++) {
      const seed = opts.firstSeed + i;
      const common = { biz, store, apiUrl, size: opts.size, seed, popSeed: opts.popSeed, days: opts.days, warmup: opts.warmup, scale: opts.scale, customers: opts.customers, shouldStop: () => stop,
        customerModel: opts.customerModel || "classic", plugins };
      const tl = (arm) => (outDir && i < opts.timelineSeeds ? path.join(outDir, "timeline", `seed-${seed}-${arm}.jsonl`) : null);
      const t0 = performance.now();
      const baseline = await runOnce({ ...common, arm: "baseline", role: opts.role, timelinePath: tl("baseline") });
      let tool = baseline;
      if (hasTool) {
        const client = makeToolClient({ cmd: opts.toolCmd, http: opts.toolHttp, timeoutMs: opts.toolTimeoutMs || biz.sim.tool.per_item_timeout_ms });
        // "Until stopped" runs: the baseline ran until Ctrl-C; the with-tool run then plays exactly the same number of days.
        const twin = opts.days === Infinity ? { days: baseline.days_run, shouldStop: () => false } : {};
        try { tool = await runOnce({ ...common, ...twin, arm: "tool", role: opts.role, toolClient: client, toolCostPerMonth: opts.toolCost, timelinePath: tl("with-tool") }); } finally { await client.close(); }
      }
      pairs.push({ seed, baseline, tool });
      log(`seed ${seed} done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    }
  } finally { process.off("SIGINT", onSig); server.closeAllConnections?.(); server.close(); }
  if (!pairs.length) throw new Error("No seed finished.");
  const daysCompared = pairs[0].baseline.totals.days;
  const meta = {
    name: opts.name || (outDir ? path.basename(outDir) : "simulation"), generated_for: "same business, same seed, with and without the tool", size: opts.size, scale: opts.scale ?? pairs[0].baseline.scale, role: opts.role,
    customers: opts.customers || "default", days_requested: opts.days === Infinity ? "until stopped" : opts.days, days_compared: daysCompared, warmup_days: opts.warmup, first_seed: opts.firstSeed,
    population_seed: opts.popSeed, customer_model: opts.customerModel || "classic", plugins: opts.plugins || [], tool: hasTool ? (opts.toolCmd ? { cmd: opts.toolCmd } : { http: opts.toolHttp }) : null, stopped_early: stop, start_date: "2026-11-23",
  };
  if (!hasTool) meta.note = "No tool given: both arms are the baseline, so every difference is zero. This checks the run itself.";
  const report = buildReport({ pairs, meta, toolCostPerMonth: opts.toolCost, daysPerMonth: biz.costs.days_per_month, countTimeSaved: !!opts.countTimeSaved });
  if (outDir) {
    fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 1) + "\n");
    fs.writeFileSync(path.join(outDir, "report.md"), reportMarkdown(report));
  }
  return report;
}

async function main() {
  const opts = parseOptions(process.argv.slice(2).filter((a) => a !== "--"));
  const t0 = performance.now();
  const report = await simulate(opts, { log: (s) => console.error(s) });
  const d = report.paired_differences;
  console.log(report.headline);
  console.log(`Cash: net profit ${d.net_profit.mean >= 0 ? "+" : ""}${d.net_profit.mean} (95% ${d.net_profit.ci95 ? d.net_profit.ci95.join(" to ") : "n/a"}). Time freed: ${report.time_freed.hours_saved.mean} staff hours. Satisfaction ${d.customer_satisfaction.mean >= 0 ? "+" : ""}${d.customer_satisfaction.mean}; rule breaks ${d.rule_breaks.mean}`);
  console.log(`took ${((performance.now() - t0) / 1000).toFixed(1)}s${opts.out ? `; written to ${opts.out}` : ""}`);
  process.exit(0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
