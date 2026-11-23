# Contributing to Overthink

Thank you for helping. Small, finished changes are best. Overthink is an open-source sandbox for testing AI in a business environment; at its centre is Overthought & Co. Read [docs/architecture.md](docs/architecture.md) to find your way around, and [docs/layout.md](docs/layout.md) if you knew the old folder names.

## Run it and test it

```bash
pnpm install
npm start           # the server and the apps on http://localhost:4747 (Rummage at /, the explorer at /apps/explore/)
pnpm test           # every suite, about two minutes
pnpm typecheck && pnpm lint
npm run check       # before you send anything: builds any missing world, then tests, world validators, scenario check
```

Node 24 and pnpm. Worlds are built into `business/data/world/` on first run; do not commit them.

## Where things are

The top-level folders, and what each holds, are in the [README](README.md#what-is-where); the file-level map is in [AGENTS.md](AGENTS.md#map).

## Style

- **New code is TypeScript**, following Google's TypeScript style guide, run directly by Node 24 (type stripping): erasable syntax only, named exports, `interface` for shapes, no `any`, JSDoc on every export. `pnpm lint` (ESLint and Prettier) and `pnpm typecheck` enforce it.
- **The older JavaScript** (engine, server, simulator, world, lab, apps) follows Google's JavaScript style: plain ES modules, two-space indent, double quotes, semicolons. It moves to TypeScript module by module; make small, exact edits to it meanwhile.
- No build step, no framework. No new dependencies without an issue first.
- `const` by default, `camelCase` for code, `UPPER_CASE` for constants.
- Small named functions that do one thing. No clever tricks.
- JSDoc on every exported function: what it does, `@param`, `@return`.
- Comments say WHY, not what. Start a reason with `WHY:` when it is not obvious.
- Words a person reads (messages, errors, docs) are plain English a 16-year-old can follow: short sentences, no filler, no hype.
- Same inputs, same outputs. Use the seeded random streams (`rngFor`, keyed by business facts), never `Math.random()` or the real clock inside the engine, simulator or world.
- Every rate or number that is a guess goes in a data file with a one-line reason, not in code.

## The rules of this world

- **No planted problems.** Do not rig the world so a test product succeeds or fails. Things happen for understandable causes, with variation.
- **Synthetic only.** No real people, companies, brands, payments, goods or messages. No claims of legal compliance or certification.
- **Out-of-copyright characters only.** Customers and staff come from books in the public domain.
- **No AI model at run time in the core.** The engine, simulator, world and lab call no model. People bring their own. A bring-your-own-model hook must be optional, off by default and checked like any other input.
- **Results are evidence, not forecasts.** Say what is simulated. Never claim something works if it is only a mock-up.
- **Never claim a result the records do not show.** Judge from records, not from what a product says it did.
- **Brand.** Never copy a real product's name, logo, colours or layout.

## Tests are required

Every change that has a rule needs a test. Unit tests sit next to the code (`*.test.ts`, and `*.test.js` / `*.test.mjs` for the older JavaScript) and use `node:test`; integration and end-to-end suites live in `tests/`. TypeScript tests are found by the globs in the `test` script in `package.json`; a JavaScript test file must be listed there to run. A change to a plug-in needs a test that an untouched world and its shadow twin stay identical.

## How to add things

Step-by-step recipes, with the checks to run, are in [docs/extending.md](docs/extending.md): a tool, a simulator plug-in, a lab intervention, an experiment or `/overthink` situation, an app, an organisation or event, and a different business.

Quick pointers: a **job** is an entry in `business/data/jobs.json` (see `docs/jobs.md`; extend `infrastructure/server/jobs.test.mjs`). An **event** is one object in `business/data/events/library.json` (see `docs/events.md`).

## Proposing a new world or experiment

- **An experiment.** Add `simulation/lab/library/<name>.json` and run it. Open a change with the question in one line, the `results.md` and `repro.json` from your run, and the assumptions you used. Someone else should get the same numbers from the same commit.
- **A new world.** Open an issue first with the business you want to describe, what is synthetic about it, and what you expect to share with Overthought & Co. Be aware of today's limit: another business's rates, staff and costs can be described in another folder (`simulation/simulator/cli.mjs --data`), but its products, suppliers and history need a world built for it, and the server, lab and explorer do not yet take another folder. See "Describe a different business" in `docs/extending.md`.

## Sending a change

Keep it to one thing. Say what changed and why in plain words, and run `npm run check` first. If you changed behaviour, change the doc that describes it.

By sending a change you agree it is licensed under the [Apache License 2.0](LICENSE), like the rest of the project (section 5 of the licence). The names and logos are not part of that grant ([TRADEMARKS.md](TRADEMARKS.md)).
