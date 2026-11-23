#!/usr/bin/env node
// The lab from the command line.
//
//   node simulation/lab/cli.mjs run <experiment.json | library name> [--days N] [--seeds N] [--size demo|standard] [--out folder]
//   node simulation/lab/cli.mjs library                 the built-in experiments
//   node simulation/lab/cli.mjs interventions           everything an experiment can change, with parameters
//   node simulation/lab/cli.mjs plan "What if we ...?"  an idea turned into a plan (nothing runs); --save plan.json
// /overthink has its own command: node simulation/lab/overthink.mjs (see docs/lab.md).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runExperiment, DEFAULT_LIMITS } from "./experiment.mjs";
import { buildResults, resultsMarkdown } from "./results.mjs";
import { explainArm } from "./explain.mjs";
import { listInterventions } from "./interventions.mjs";
import { planFromIdea } from "./plan.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIBRARY = path.join(HERE, "library");

/** Reads an experiment from a file, or from the library by name. */
export function readExperiment(ref) {
  const file = fs.existsSync(ref) ? ref : path.join(LIBRARY, ref.endsWith(".json") ? ref : `${ref}.json`);
  if (!fs.existsSync(file)) throw new Error(`No experiment file "${ref}". Library: ${libraryNames().join(", ")}.`);
  const spec = JSON.parse(fs.readFileSync(file, "utf8"));
  return spec.experiment || spec; // a saved plan holds its experiment under "experiment"
}
const libraryNames = () => fs.readdirSync(LIBRARY).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));

async function main() {
  const [cmd, ...rest] = process.argv.slice(2).filter((a) => a !== "--");
  const { values: v, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
    days: { type: "string" }, seeds: { type: "string" }, size: { type: "string" }, out: { type: "string" }, save: { type: "string" }, action: { type: "string" }, quiet: { type: "boolean", default: false },
  } });
  if (cmd === "library") {
    for (const n of libraryNames()) { const e = readExperiment(n); console.log(`${n.padEnd(22)} ${e.question}`); }
    return;
  }
  if (cmd === "interventions") {
    for (const i of listInterventions()) console.log(`${i.id.padEnd(22)} ${i.label}: ${Object.entries(i.params).map(([k, p]) => `${k}${p.default !== undefined && p.default !== null ? `=${JSON.stringify(p.default)}` : ""}`).join(", ")}`);
    return;
  }
  if (cmd === "plan") {
    const plan = await planFromIdea(positionals.join(" "));
    if (v.save) fs.writeFileSync(v.save, JSON.stringify(plan, null, 2) + "\n");
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (cmd !== "run" || !positionals[0]) {
    console.error("Usage: node simulation/lab/cli.mjs run <experiment.json | library name> [--days N] [--seeds N] [--size demo|standard] [--out folder]\n       node simulation/lab/cli.mjs library | interventions | plan \"What if ...?\"");
    process.exit(2);
  }
  const spec = readExperiment(positionals[0]);
  if (v.days) spec.days = Number(v.days);
  if (v.seeds) spec.seeds = Number(v.seeds);
  if (v.size) spec.start = { ...(spec.start || {}), size: v.size };
  // WHY no caps here: someone running the lab on their own machine decides how long they wait.
  const limits = { ...DEFAULT_LIMITS, maxDays: 36500, maxSeeds: 1000, maxArms: 50, maxInterventions: 500 };
  let last = -1;
  const raw = await runExperiment(spec, { limits, onProgress: (p) => {
    const pct = Math.floor(p.done * 20);
    if (!v.quiet && pct !== last) { last = pct; process.stderr.write(`\r${"#".repeat(pct)}${".".repeat(20 - pct)} seed ${p.seed_index + 1}/${p.seeds}, day ${p.day}/${p.days}`); }
  } });
  if (!v.quiet) process.stderr.write("\n");
  const res = buildResults(raw);
  for (const a of Object.values(res.arms)) console.log(`\n${a.label}\n  ${a.verdict}`);
  console.log(`\n${raw.experiment.arms.length} arms × ${raw.seeds_run.length} seeds × ${raw.experiment.days} days on the ${raw.start.size} world: ${(raw.timings.total_ms / 1000).toFixed(1)} s (set-up ${(raw.timings.setup_ms / 1000).toFixed(1)} s, ${(mean(raw.timings.per_seed_ms) / 1000).toFixed(1)} s a seed).`);
  const out = v.out || path.join(HERE, "results", `${slug(raw.experiment.title)}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(res, null, 1) + "\n");
  fs.writeFileSync(path.join(out, "results.md"), resultsMarkdown(res));
  const explanations = Object.fromEntries(Object.keys(res.arms).map((id) => [id, explainArm(raw, id)]));
  fs.writeFileSync(path.join(out, "explanation.json"), JSON.stringify(explanations, null, 1) + "\n");
  fs.writeFileSync(path.join(out, "repro.json"), JSON.stringify(raw.repro, null, 1) + "\n");
  console.log(`Saved to ${out} (results.json, results.md, explanation.json, repro.json).`);
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message || e); process.exit(1); });
