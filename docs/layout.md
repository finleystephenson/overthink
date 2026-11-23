# Layout: where things moved

On 23 November 2026 the repository was arranged by what each part is for. Code moved without changing what it does; every import and path was updated, and the tests passed before and after. If you knew the old names:

| Old path | New path |
| --- | --- |
| `data/` | `business/data/` |
| `tools/` (the world history builder, `tools/world/`) | `business/builder/` (`business/builder/world/`) |
| `site/` | `business/site/` |
| `backoffice/` | `business/backoffice/` |
| `brand/` | `business/brand/` |
| `apps/` | `applications/` (Rummage is `applications/home/`) |
| `explore/` | `applications/explore/`, served at `/apps/explore/` (`/explore/` redirects there) |
| `explore/explore.test.mjs` | `infrastructure/server/explore.test.mjs` (it tests the server's reads) |
| `engine/` | `infrastructure/engine/` |
| `server/` | `infrastructure/server/` |
| `server/examples/receptionist.mjs` | `integrations/examples/receptionist.mjs` |
| `src/adapter/` | `integrations/adapter/` |
| `src/init/` | `integrations/init/` |
| `examples/adapters/` | `integrations/examples/` |
| `plugins/overthink/` | `integrations/claude-plugin/` |
| `src/people/` | `activity-generation/people/` |
| `src/run/` | `simulation/twin-run/` |
| `sim/` | `simulation/simulator/` |
| `world/` | `simulation/world/` |
| `lab/` | `simulation/lab/` |
| `src/view/` | `observability/view/` |
| `src/report/` | `observability/report/` |
| `src/live/` | `observability/live/` |
| `src/test/helpers.ts` | `tests/helpers.ts` |
| `src/docs.test.ts` | `tests/docs.test.ts` |
| `bench/` | `examples/benchmark/` |
| `scenarios/` | `examples/benchmark/scenarios/` |
| `docs/security.md` | `SECURITY.md` |

New in the same change: `activity-generation/` (the toolkit for creating people and activity, with `infrastructure/engine/activity.ts` for the engine's side), `ai-instructions/` (the guides an agent reads), `integrations/deploy.ts` (a product on a live sandbox's channels), `overthink up` and `overthink act`, `tests/e2e/`, and `examples/first-test/`.

Two choices worth knowing:

- **The explorer sits in `applications/`**, not `observability/`. It is a browser screen that shares `applications/lib/` by relative imports, so its folder and its address mirror each other. Its server side, `infrastructure/server/explore.mjs`, stays with the server it is part of.
- **Unit tests stay beside their code.** `tests/` holds the end-to-end suites and shared helpers.
