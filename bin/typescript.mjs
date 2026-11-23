// Lets Node run this package's TypeScript wherever the package sits, and a developer's overthink.adapter.ts in any
// project. Import it first (or pass it to node --import).
//
// WHY: Node 24 runs TypeScript by stripping types, but refuses to for files inside node_modules (where npx and npm
// put a package). This registers a load hook that strips the types of this package's own .ts files with Node's
// built-in stripTypeScriptTypes, so the same source runs from a checkout and from an install, with no build step and
// no compiler at run time. In a checkout it changes nothing: Node strips the types itself.
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [major] = process.versions.node.split(".").map(Number);
if (major < 24 || typeof registerHooks !== "function") {
  console.error(`Overthink needs Node 24 or later (this is ${process.version}). See https://nodejs.org.`);
  process.exit(1);
}

const ROOT = pathToFileURL(dirname(dirname(fileURLToPath(import.meta.url))) + "/").href;

/** This file's address, for child processes: `node --import <HOOK> script.mjs`. */
export const HOOK = import.meta.url;

// WHY two cases. This package's own .ts files need the hook only inside node_modules (elsewhere Node strips types
// itself). A developer's adapter file (overthink.adapter.ts) needs it everywhere: Node reads a .ts file as CommonJS
// in a project whose package.json has no "type": "module", and the adapter is always an ES module.
const inNodeModules = ROOT.includes("/node_modules/");
const isAdapter = (url) => url.startsWith("file:") && /\.adapter\.ts$/.test(url) && !url.startsWith(ROOT);
// stripTypeScriptTypes is marked experimental; its warning would only confuse someone running a command.
const emit = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes("stripTypeScriptTypes") ? undefined : emit.call(process, w, ...rest));
registerHooks({
  load(url, context, next) {
    const ours = inNodeModules && url.startsWith(ROOT) && url.endsWith(".ts") && !url.endsWith(".d.ts");
    if (ours || isAdapter(url)) {
      const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"));
      return { format: "module", source, shortCircuit: true };
    }
    return next(url, context);
  },
});
