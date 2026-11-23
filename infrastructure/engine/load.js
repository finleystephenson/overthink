// Node-only helper: reads business/data/ and returns what createWorld needs.
// Missing files or folders give empty values, so the engine can run on a half-built data folder.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);

function listFiles(dir, ext) {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).sort() : [];
}

/** Split "---\nkey: value\n---\nbody" into { ...front matter, body }. Values are plain strings, or [a, b] lists. */
export function parseFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    else v = v.replace(/^["']|["']$/g, "");
    meta[kv[1]] = v;
  }
  return { ...meta, body: m[2] };
}

/**
 * Reads business/data/. With { world: "demo" | "standard" | "large" } the records come from business/data/world/<size>/
 * (every collection, including suppliers, ledger and the rest) instead of business/data/seed/.
 * With { bench: true } they come from business/data/world-bench/<size>/: the same business with the hand-written stories
 * laid over it, which the benchmark scenarios rely on.
 */
export function loadData(dir, { world, bench = false } = {}) {
  const business = readJson(join(dir, "business.json"), null);
  const products = listFiles(join(dir, "products"), ".json").map((f) => readJson(join(dir, "products", f)));
  const services = listFiles(join(dir, "services"), ".json").map((f) => readJson(join(dir, "services", f)));
  const policies = listFiles(join(dir, "policies"), ".md").map((f) => {
    const doc = parseFrontMatter(readFileSync(join(dir, "policies", f), "utf8"));
    return { id: f.replace(/\.md$/, ""), ...doc };
  });
  const help = readJson(join(dir, "help.json"), []);
  const seedDir = world ? join(dir, bench ? "world-bench" : "world", world) : join(dir, "seed");
  if (world && !existsSync(seedDir)) throw new Error(`No world at ${seedDir}. Build it: node business/builder/build-world.mjs --size ${world}${bench ? " --stories" : ""}`);
  const seed = {};
  for (const f of listFiles(seedDir, ".json")) seed[f.replace(/\.json$/, "")] = readJson(join(seedDir, f));
  return { business, products, services, policies, help, seed };
}
