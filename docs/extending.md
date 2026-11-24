# Extending Overthink

Recipes for adding to the project. Each one names the files and the check to run. Before any of them: `pnpm install`, and run `npm test` once so you know it is green (about 350 tests, about 70 seconds). Rules for all changes: [CONTRIBUTING.md](../CONTRIBUTING.md).

## 1. Add an engine tool (an extension)

A tool is something an AI or an app can call, with roles and an input schema. New tools live in their own file under `infrastructure/engine/`, added with `extend()`.

1. Write it in TypeScript. Copy the shape of a recent extension, such as `infrastructure/engine/contacts.ts` (a small one) or `infrastructure/engine/calendar.ts`. Start the file with `import {extend, kit} from './engine.js';` (the types come from `engine.d.ts`; add to it only what you use).
2. Call `extend({ state: [...], counters: [...], tools: [...] })`.
   - `state`: names of new record lists kept in the world. Each loads from `<world folder>/<name>.json` or starts empty.
   - `counters`: `[prefix, state key, id field]`, so new ids carry on from the highest one.
   - `tools`: `{ name, roles, description, input_schema, run(ctx, input) }`. Take helpers from `kit` (`fail`, `round2`, `nextId`, `schema`, `roles`). `run` reads `ctx.st` and throws with `fail("code", "plain message")` on a broken rule. Say WHY a role may or may not use it.
   - To deepen a core tool, use `replace` (see `infrastructure/engine/knowledge.js`).
3. Add `import "./yourfile.ts";` to `infrastructure/engine/all.js`. Always import `infrastructure/engine/all.js`, never `engine.js`, where you make a world.
4. Write a test next to it (`infrastructure/engine/yourfile.test.ts`, `node:test`): the success case and each refusal. The `test` script finds `*.test.ts` files by itself.
5. Check: `node --test infrastructure/engine/yourfile.test.ts`, then `pnpm typecheck`, `pnpm lint` and `npm test`.

The server, MCP and `GET /openapi.json` pick the tool up with no other change. To give a tool to the world lens only, use `roles: kit.roles.LENSES` as `simulation/world/extension.js` does.

## 2. Add a simulator plug-in

A plug-in is `{ name, modifiers(ctx), afterDay(ctx) }`. `modifiers` returns multipliers for the day plus a `why` list; `afterDay` adds records. Keep both free of the real clock and `Math.random()`.

1. Write it in `simulation/world/` (a wider-world effect) or `simulation/simulator/` (a business effect). Draw every chance with `rngFor(seed, purpose, ...keys)` keyed by facts such as date and organisation id, never a running count. WHY: that keeps the live world and its shadow twin in step, so doing nothing gives exactly zero difference.
2. Return `why` entries: `{ source, effect, size, because }`, in plain words. The lab uses them for "why".
3. Read settings from `state.world_settings` so the lab can change them. Put every guessed rate in a data file with a reason.
4. Register it. For a wider-world plug-in, add it to the list in `worldPlugins()` in `simulation/world/plugins.mjs`. For anything else, add a `want("yourname")` block in `loadPlugins()` in `simulation/simulator/plugins.mjs`. Order is fixed in that file; later plug-ins see what earlier ones wrote.
5. Test: that an untouched live world and its shadow stay identical (copy the pattern in `simulation/world/world.test.mjs`), and one test of the effect itself.
6. Check: `node simulation/lab/cli.mjs run raise-prices-10 --seeds 2 --days 10`. Your plug-in name appears in `repro.json`.

## 3. Add a lab intervention

An intervention is one named change an experiment can make. It may change a branch only through engine tools or `state.world_settings`.

1. Add an entry to `INTERVENTIONS` in `simulation/lab/interventions.mjs`: `label`, `description` (what it does in the simulation, and what it does not), `params` (type, label, default, min, max), and `apply(world, { params, call, date })`. `call(role, tool, input)` runs an engine tool. Return `{ changes: [plain sentences], summary }`.
2. If it needs a new wider-world setting, write it with `setWorldSetting(world, path, value)` and read it in a plug-in (recipe 2).
3. Check: `node simulation/lab/cli.mjs interventions` lists it. Add a test to `simulation/lab/lab.test.mjs` (a change moves what it should; no change gives zero).

## 4. Add a library experiment, and an /overthink situation

**An experiment.** Add `simulation/lab/library/<name>.json`. Copy `simulation/lab/library/returns-window.json`: `title`, `question`, `start` (`size`, `seed`), `days`, `seeds`, and `arms`, each with `id`, `label` and `interventions: [{ type, day, params }]`. The baseline is added for you. The library is read from the folder, so there is nothing to register. Check: `node simulation/lab/cli.mjs library`, then `node simulation/lab/cli.mjs run <name>`. Read the verdict. Check that it says only what the numbers support.

**A situation.** Add `simulation/lab/situations/<id>.json`: `id`, `title`, `why`, `pick` (a named picker from `PICKERS` in `simulation/lab/overthink.mjs` that finds the right customer or order, such as `order_in_transit`), `channel`, `opening` (with `{a.name}`, `{a.order}`, `{a.postcode}`), `customer` (how many turns, what satisfies them, the follow-up line) and `checks`. Copy `simulation/lab/situations/where-is-my-order.json`. A new kind of case needs a new picker in `simulation/lab/overthink.mjs`. Check: `node simulation/lab/overthink.mjs --reference-only` (about 4 seconds) runs every situation against the two reference rows. A good situation makes the do-nothing row fail and the rules-based row behave sensibly.

## 5. Add a business app

1. Add an entry to `applications/apps.json`: `id`, `layer` (`business`), `name`, `plain` (what it is, in plain words), `description`, `accent`, `icon`, `status`, `roles`. Names and colours live only here.
2. `cp -r applications/_template applications/<id>`. In `applications/<id>/app.js` set `APP_ID` to `<id>`.
3. Add an icon: a drawing in `GLYPHS` in `applications/lib/icons.js` under the `icon` name.
4. Build the screen. Read with `world.call(tool, input, { screen: true })` and act with `world.call(tool, input)`. Show a refusal as a calm empty state. Redraw on `ot:day`, `ot:role` and `world.onChange`. `applications/lib/client.js` is the only way an app reaches the world; never call the server yourself. Full steps and the client's calls: [applications/README.md](../applications/README.md).
5. Follow [applications/DESIGN.md](../applications/DESIGN.md): its numbered hard rules (colour, type, shape, space) apply. Use `applications/lib/premium.css` and the shared parts. Never copy a real product's name, logo, colours or layout.
6. Check at 1440 and 390 wide, light and dark, with no console errors and no sideways scroll. Run `node applications/dev.mjs` (port 8790; leave that port alone if someone else is using it, and use `npm start -- --port <n>` instead).

## 6. Add an organisation or a world event

**An organisation.** Rivals, partners and institutions are in `business/data/organisations.json`, loaded by `simulation/world/organisations.mjs`. Add an object to `competitors`, `partners` or `institutions`, copying a neighbour. A rival needs `categories`, `price_position`, `ad_budget_per_month`, `strategy`, `weights` and `rules`; see Thriftwhistle for a full example. Every organisation is invented; none may be or imitate a real company or public body. WHY a rebuild: a built world keeps its own copy of the file, so delete `business/data/world/` and run `npm start` to rebuild it. Check: `node --test simulation/world/world.test.mjs`. Details: [world.md](world.md).

**An event.** Add an object to `business/data/events/library.json` (fields and wording rules in [events.md](events.md)): a unique `id`, a `why` for every number, and words that name no real company, brand or living person; storybook events only from out-of-copyright work. Adding one never moves another. Check: `node --test infrastructure/engine/events.test.js`. To cause one in a running world, call `add_world_event` with a `template`.

## 7. Describe a different business

The business is data, so another business means another folder. This is what works today:

- **Works:** `node simulation/simulator/cli.mjs --data <folder> ...` reads `sim.json` (demand, rates, satisfaction), `staff.json`, `costs.json` and `characters.json` (and optionally `audience.json` and `population.json`) from your folder instead of `business/data/`. I checked it runs with a copy of those files in another folder. The day loop, queues, twin runs and report do not change.
- **Does not work yet:** the world itself (products, suppliers, stock, history, policies, the apps' words) still comes from `business/data/world/` and `business/data/business.json`, built by `business/builder/build-world.mjs`. The server, the lab and the explorer do not take `--data` at all. So a café or a hotel needs its own world built first, and the generator is not made general. That is the next place to extend.

Today, to change this business, edit its files (rates, staff, costs, products, events, policies; [README](../README.md#change-the-business)) and rebuild.

## 8. Publish an experiment so others can reproduce it

Every run saves `repro.json`: a SHA-256 of the starting state, the size and population seed, every seed, every arm's interventions with parameters, the plug-ins, the customer model and the Node version.

1. Write the experiment as a JSON file (or save a plan: `node simulation/lab/cli.mjs plan "..." --save plan.json`) and run it: `node simulation/lab/cli.mjs run my-experiment.json --out lab/results/my-experiment`.
2. Publish the experiment file, `results.md`, `results.json` and `repro.json` together, with the project's git commit. Say the question in one line and list the assumptions you changed.
3. Someone else checks out the same commit, runs the same file, and compares `results.json` and `repro.json`. The start-state hash must match and the numbers must be identical. I ran the same experiment twice and the results differed only in the timing fields.
4. If it is a good general question, add it to `simulation/lab/library/` (recipe 4).

For `/overthink`, the record also holds each situation's fingerprint, the settings, and the product's declared version and model. A result is evidence about this simulated world, never a forecast: say so when you share one.
