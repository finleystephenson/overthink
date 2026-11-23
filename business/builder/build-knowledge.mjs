// Writes the company's knowledge base (business/builder/world/knowledge.mjs) into every world folder as knowledge.json.
// Run after building the worlds (pnpm world does). Adds one file; never touches the others.
//   node business/builder/build-knowledge.mjs
import { writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildKnowledge } from "./world/knowledge.mjs";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
for (const base of ["world", "world-bench"]) {
  for (const size of ["demo", "standard"]) {
    const worldDir = join(dataDir, base, size);
    if (!existsSync(worldDir)) continue;
    const docs = buildKnowledge({ dataDir, worldDir });
    writeFileSync(join(worldDir, "knowledge.json"), JSON.stringify(docs, null, 2) + "\n");
    console.log(`${base}/${size}: ${docs.length} documents`);
  }
}
