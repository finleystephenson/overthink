#!/usr/bin/env node
// Sensitivity report: does a result survive our least certain numbers?
//   pnpm sim:sensitivity -- [--tool-cmd "node simulation/simulator/examples/simple-responder.mjs"] [--days 30] [--seeds 3] [--size demo] [--scale 1]
// Runs the twin comparison once as the business files say, then again with each of the ten least certain rates moved
// down and up by 25%, and shows whether the tool's effect on net profit (and on satisfaction) keeps its sign.
// One-at-a-time, so it shows which single number a verdict leans on, not how the numbers act together
// (see https://www.jasss.org/19/1/5/5.pdf on why that is only a first check).
import { parseArgs } from "node:util";
import { simulate } from "./cli.mjs";
import { loadBusiness } from "./data.mjs";

/** The ten rates we are least sure of (all assumptions in business/data/sim.json). */
export const UNCERTAIN = [
  "demand.price_elasticity", "demand.marketing_elasticity", "demand.reputation_weight",
  "contacts.queue_pressure_skill_loss", "contacts.handed_over_minutes_share", "customers.memory_hazard_per_point",
  "customers.good_resolution_points", "reviews.rate_per_delivered_order", "contacts.topics.complaint.late_per_order_day",
  "contacts.topics.where_is_my_order.per_order_day",
];

const get = (o, path) => path.split(".").reduce((x, k) => x[k], o);
function set(o, path, v) { const ks = path.split("."); const last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = v; }

/**
 * Runs the sweep.
 * @param {object} o { toolCmd, days, seeds, size, scale, step (0.25), log }
 * @return {Promise<object>} { base, rows: [{ rate, value, low, high }], holds, of }
 */
export async function sensitivity({ toolCmd = "node simulation/simulator/examples/simple-responder.mjs", days = 30, seeds = 3, size = "demo", scale = 1, step = 0.25, log = () => {} } = {}) {
  const opts = { days, seeds, role: "assistant", toolCost: 0, size, scale, warmup: 0, popSeed: 1, firstSeed: 1, timelineSeeds: 0, toolCmd };
  const once = async (biz) => {
    const r = await simulate({ ...opts, biz });
    return { net: r.paired_differences.net_profit.mean, csat: r.paired_differences.customer_satisfaction.mean };
  };
  const base = await once(loadBusiness());
  log(`as written: net profit ${base.net}, satisfaction ${base.csat}`);
  const rows = [];
  let holds = 0, of = 0;
  for (const rate of UNCERTAIN) {
    const value = get(loadBusiness().sim, rate);
    const out = { rate, value };
    for (const [name, f] of [["low", 1 - step], ["high", 1 + step]]) {
      const biz = loadBusiness();
      set(biz.sim, rate, value * f);
      const r = await once(biz);
      out[name] = { ...r, net_sign_same: Math.sign(r.net) === Math.sign(base.net), csat_sign_same: Math.sign(r.csat) === Math.sign(base.csat) };
      of++; if (out[name].net_sign_same) holds++;
      log(`${rate} x${f}: net ${r.net} (${out[name].net_sign_same ? "same sign" : "SIGN FLIPS"}), satisfaction ${r.csat}`);
    }
    rows.push(out);
  }
  return { base, rows, holds, of, note: `The tool's effect on net profit keeps its sign in ${holds} of ${of} runs with one rate moved ${step * 100}%.` };
}

async function main() {
  const { values: v } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== "--"), options: {
    "tool-cmd": { type: "string" }, days: { type: "string", default: "30" }, seeds: { type: "string", default: "3" }, size: { type: "string", default: "demo" }, scale: { type: "string", default: "1" },
  } });
  const r = await sensitivity({ toolCmd: v["tool-cmd"], days: Number(v.days), seeds: Number(v.seeds), size: v.size, scale: Number(v.scale), log: (s) => console.error(s) });
  console.log(`\nAs written: net profit change ${r.base.net}, satisfaction change ${r.base.csat}\n`);
  console.log("| Rate | Value | -25%: net (sign) | +25%: net (sign) |\n|---|---|---|---|");
  for (const x of r.rows) console.log(`| ${x.rate} | ${x.value} | ${x.low.net} (${x.low.net_sign_same ? "same" : "flips"}) | ${x.high.net} (${x.high.net_sign_same ? "same" : "flips"}) |`);
  console.log(`\n${r.note}`);
  process.exit(0);
}
if (process.argv[1] && process.argv[1].endsWith("sensitivity.mjs")) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
