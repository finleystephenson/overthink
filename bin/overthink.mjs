#!/usr/bin/env node
// The `overthink` command as installed (npx, npm i -g, a tarball). It runs bin/overthink.ts.
// bin/typescript.mjs lets Node run the package's TypeScript from inside node_modules, with no build step.
import "./typescript.mjs";

// The demo world is read as soon as the engine loads, so build it first (once, a few seconds) if this copy lacks it.
// It is built from the source files in business/data/ into business/data/world/ beside them: the same files every time.
const { ensureWorlds } = await import("./ensure-world.mjs");
if (!ensureWorlds({ sizes: ["demo"], log: (line) => console.error(line) })) process.exit(1);

await import("./overthink.ts");
