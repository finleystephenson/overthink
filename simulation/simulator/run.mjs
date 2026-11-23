// One closed batch run of the business: N days, baseline (staff only) or with a tool, from a fresh sandbox.
// The day itself lives in simulation/simulator/core.mjs; this file adds what only a Node batch run needs: a sandbox on the local
// server for the tool to call, the timeline file, and a pause now and then so Ctrl-C is heard.
// See simulation/simulator/README.md for the model in plain English.
import fs from "node:fs";
import { createSim, newTotals } from "./core.mjs";

export { newTotals };

/** Trace entries kept while a long run goes on. Only entries newer than the current tool call are ever read. */
const KEEP_TRACE = 2000;

/**
 * Runs one arm of one seed from start to finish.
 * @param {object} o { biz, store, apiUrl, size, seed, popSeed, days, warmup, arm, role, scale, customers, toolClient,
 *   toolCostPerMonth, timelinePath, shouldStop, plugins }
 * @return {Promise<object>} The run's totals (sim.totals()) plus { sandbox: { trace_entries } }.
 */
export async function runOnce(o) {
  const { biz, store, apiUrl, size, seed, popSeed = 1, days, warmup = 0, role = "assistant", scale = null, customers = null,
    toolClient = null, timelinePath = null, shouldStop = () => false, plugins = [], customerModel = "classic" } = o;
  const { sandbox: sb } = store.create({ size, scenario: "normal" });
  const token = toolClient ? store.mintRoleToken(sb, { role, label: "sim tool" }).token : null;
  const sim = createSim({
    world: sb.world, biz, seed, popSeed, role, scale, customers, warmup, plugins, toolClient, customerModel,
    toolEnv: { api_url: apiUrl, token }, tracer: traceReader(sb),
  });
  const tl = timelinePath ? fs.openSync(timelinePath, "w") : null;
  try {
    for (let day = 0; day < days || days === Infinity; day++) {
      if (day % 20 === 19) await new Promise((r) => setImmediate(r)); // let Ctrl-C be heard on long runs
      if (shouldStop()) break;
      const line = await sim.step();
      if (tl) fs.writeSync(tl, JSON.stringify(line) + "\n");
      if ((day + 1) % biz.sim.memory.compact_every_days === 0 && sb.trace.length > KEEP_TRACE) sb.trace.splice(0, sb.trace.length - KEEP_TRACE);
    }
  } finally {
    if (tl) fs.closeSync(tl);
  }
  const result = { ...sim.totals(), scale: sim.scale, sandbox: { trace_entries: sb.trace.length } };
  store.remove(sb.id);
  return result;
}

/** Reads what the tool did from the sandbox trace: its calls are the entries with its session id. */
function traceReader(sb) {
  return {
    mark: () => sb.seq,
    callsSince: (seq, session) => sb.trace.filter((e) => e.seq > seq && e.kind === "tool" && e.actor?.session === session),
  };
}
