# Moving the older JavaScript to TypeScript

New code in Overthink is TypeScript, written to [Google's TypeScript style guide](https://google.github.io/styleguide/tsguide.html) and checked in CI by `tsc` (strict), ESLint (`typescript-eslint` strict, type-aware) and Prettier. The oldest parts were written in JavaScript first and are still JavaScript. This page is the plan for moving them, one module at a time, without breaking anything on the way.

## Where it stands (23 November 2026)

| Part | Language today | About how much |
| --- | --- | --- |
| `activity-generation/`, `integrations/`, `observability/`, `simulation/twin-run/`, `bin/overthink.ts`, `tests/` | TypeScript | all of it |
| `infrastructure/engine/` | Mixed. New extensions are TypeScript (`activity.ts`, `calendar.ts`, `contacts.ts`), and so is `load.ts`, the first module moved. The core (`engine.js`) and the older extensions are JavaScript. | 5,500 lines JS, 1,900 TS |
| `infrastructure/server/` | JavaScript | 3,800 lines |
| `simulation/simulator/`, `simulation/world/`, `simulation/lab/` | JavaScript | 9,800 lines |
| `business/builder/` | JavaScript | 6,700 lines |
| `applications/` (the apps in the browser) | JavaScript, plain ES modules with no build step | 20,400 lines |

TypeScript reaches the JavaScript through small hand-written declaration files beside it (`infrastructure/engine/engine.d.ts`, `levers.d.ts`, `simulation/simulator/core.d.mts` and others). Each describes only what the TypeScript uses.

## How one module moves

The same steps every time. One module per change, and nothing else in that change.

1. **Check where it runs.** A module the browser loads (anything under `applications/`, or anything the apps import) cannot become `.ts`: browsers do not run TypeScript and the apps have no build step. A module a child process loads must be started with `--import bin/typescript.mjs` (see `bin/ensure-world.mjs`), so it also runs from inside `node_modules` after `npx`.
2. **Rename and type it.** `foo.js` becomes `foo.ts`. Add types, JSDoc on every export, and keep the WHY comments. Use only erasable syntax (no `enum`, no parameter properties, no `namespace`), because Node runs the file by stripping its types. Do not change what the code does: no renamed exports, no new rules, no tidying of logic. A behaviour change is a separate change with its own test.
3. **Point the importers at it.** Every `import ... from "./foo.js"` becomes `"./foo.ts"`. JavaScript can import TypeScript directly in Node 24. `grep -rn "foo.js"` must find nothing afterwards, including in `docs/`.
4. **Retire its declaration file.** If `foo.d.ts` existed, delete it: the TypeScript now describes itself. Its importers get real types, and `tsc` may find mistakes the hand-written file hid. Fix those in the TypeScript caller, not by loosening the module.
5. **Check, in this order:** the module's own tests (`node --test <its test>`), then `pnpm typecheck`, `pnpm lint`, and the whole `pnpm test`. A module the simulator uses must also keep the shadow-twin test green (`simulation/simulator/live.test.mjs`: an untouched world and its twin stay identical), because that is what makes every comparison fair.

Tests stay where they are. A JavaScript test can test a TypeScript module, so tests move to TypeScript later, on their own.

## The order

Smallest and most depended-on first, so each step gives real types to the most code. The engine core comes after its extensions, because it is the largest file and the most used.

1. **Leaves with no imports of their own.** Done: `infrastructure/engine/load.ts` (reading the data folder; used by the server, the builder, the benchmark and the tests). Next: `simulation/simulator/stats.mjs`, `infrastructure/server/net-guard.mjs`, `business/builder/world/rng.mjs`.
2. **Engine extensions, one file each.** `reviews.js`, `customers.js`, `campaigns.js`, `tasks.js`, `levers.js` (retires `levers.d.ts`), `knowledge.js`, `suppliers-comms.js`, `events-core.js` and `events.js`, `comms.js`. Each already has its own tests.
3. **The engine core.** `engine.js` is about 2,900 lines. First split it, still in JavaScript, into modules by subject (dates and helpers, the input check, sessions and the call wrapper, the tools by area), with the tests green after each split. Then move each piece. `createWorld`, `extend` and `kit` keep their names and shapes, so no extension notices. `engine.d.ts` goes last.
4. **The server.** `sandboxes.mjs`, `mcp.mjs`, `http.mjs` and the rest, retiring their `.d.mts` files.
5. **The simulator, the wider world and the lab,** module by module, keeping the shadow-twin test green throughout.
6. **The builder** (`business/builder/`). It runs only when a world is built.
7. **The apps stay JavaScript.** They are static files the browser loads as they are, and that is a feature: anyone can open one and read it. They will instead be checked with `// @ts-check` and their JSDoc, so `tsc` finds type mistakes in them without a build step.

## What "done" means for a module

- It is `.ts`, passes `pnpm typecheck` with the strict settings in `tsconfig.json`, and passes `pnpm lint` with no rule switched off for it.
- No hand-written declaration file describes it any more.
- Every test that passed before passes after, and the number of tests did not go down.
