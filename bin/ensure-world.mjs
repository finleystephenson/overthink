#!/usr/bin/env node
// Makes sure the generated worlds exist, building any that are missing. They are not kept in git:
// they are built from the files in business/data/ by business/builder/build-world.mjs (about 2 seconds each, same files every time).
//   node bin/ensure-world.mjs            the demo and standard worlds the server needs
//   node bin/ensure-world.mjs --all      also the story worlds in business/data/world-bench (for the tests and the benchmark)
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { HOOK } from "./typescript.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Builds any missing world, printing one plain line first.
 * @param {{sizes?: string[], bench?: boolean, log?: (line: string) => void}} [options] Sizes to check (default both),
 *     and whether to include the benchmark's story worlds.
 * @return {boolean} True when every world exists afterwards.
 */
export function ensureWorlds({ sizes = ["demo", "standard"], bench = false, log = console.log } = {}) {
  let ok = true;
  const wanted = sizes.flatMap((size) => (bench ? [[size, false], [size, true]] : [[size, false]]));
  for (const [size, stories] of wanted) {
    const folder = join(ROOT, "business", "data", stories ? "world-bench" : "world", size);
    // company.json is the last thing the builder writes that every world has, so its absence means "not built".
    if (existsSync(join(folder, "company.json"))) continue;
    log(`Building the ${size} world${stories ? " (story version)" : ""}: it takes a few seconds and only happens once.`);
    const args = ["business/builder/build-world.mjs", "--size", size, ...(stories ? ["--stories"] : [])];
    const run = spawnSync(process.execPath, ["--import", HOOK, ...args], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
    if (run.status !== 0) {
      log(`The ${size} world did not build. Run "node ${args.join(" ")}" to see why.`);
      ok = false;
    }
  }
  return ok;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(ensureWorlds({ bench: process.argv.includes("--all") }) ? 0 : 1);
}
