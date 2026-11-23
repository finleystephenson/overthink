// Usage: node examples/benchmark/compare.mjs <a.json> <b.json>
// Prints the scenarios whose pass rate differs between two result files.
import { readFileSync } from "node:fs";

const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, "utf8")));
if (!a || !b) { console.error("Usage: node examples/benchmark/compare.mjs <a.json> <b.json>"); process.exit(1); }
if (a.meta.scenarios_version !== b.meta.scenarios_version) {
  console.log(`Warning: scenario versions differ (${a.meta.scenarios_version} vs ${b.meta.scenarios_version}). Results are not comparable.`);
}

const rate = (s) => (s ? s.passes / s.runs : null);
const show = (s) => (s ? `${s.passes}/${s.runs}` : "missing");
const ids = [...new Set([...Object.keys(a.summary.scenarios), ...Object.keys(b.summary.scenarios)])].sort();
let changed = 0;
for (const id of ids) {
  const [x, y] = [a.summary.scenarios[id], b.summary.scenarios[id]];
  if (rate(x) === rate(y)) continue;
  changed++;
  const arrow = rate(y) > rate(x) ? "better" : "worse";
  console.log(`${id.padEnd(24)} ${show(x)} -> ${show(y)}  ${x && y ? arrow : ""}`);
}
console.log(`\n${changed} of ${ids.length} scenarios changed. Overall ${a.summary.passes}/${a.summary.total} -> ${b.summary.passes}/${b.summary.total}.`);
