# tests

Unit tests sit beside the code they test (`*.test.ts`, `*.test.js`, `*.test.mjs`). This folder holds what spans the whole project:

- `e2e/`: the live sandbox end to end, as a developer's agent uses it (`overthink up` with the example product deployed, activity over HTTP, the product's answers, Rummage, reset).
- `docs.test.ts`: the entry points an agent reads first stay present and linked.
- `helpers.ts`: shared fakes for product transports and adapters.

`pnpm test` runs everything; `pnpm test:e2e` runs only `e2e/`.
