# results.json: `overthink.results/2`

The file a coding agent reads after `overthink run`. The TypeScript type is `Results` in `observability/report/results.ts`; this page says what each part is for. `schema` changes only when a reader would break.

| Field | What it holds |
| --- | --- |
| `schema` | `"overthink.results/2"`. |
| `headline` | One sentence that never claims more than the figures. |
| `config` | Days, runs, size, job, adapter label, transport, `channels` (null = every channel), `audience` (who the product met), `scope` (its access; null = the job's role). |
| `reproducibility` | Seeds, population seed, world hash, people model and endpoint, adapter version, Overthink and Node versions. |
| `measures[]` | Money first (`net_profit`, `revenue`, `refunds`, `staff_task_cost`), then customers and the team. Each: `without`, `with`, `difference.mean`, `difference.interval95` (null with one seed), `difference.clear` (the interval leaves out zero), `betterIn`/`worseIn`, `perSeed[]`, `worstSeed`. `better` says which direction is good. |
| `product` | Contacts handled, passed, sorted alone, handed over, wrong actions, gave up, errors, tool calls, refused calls, customers overruled by the records, `passK[]` by topic. |
| `failures[]` | Worst kinds first, at most 80 with full detail. Each: `id` (F1...), `kind` and `label` (see `FAILURE_KINDS` in `observability/report/checks.ts`), `why`, `seed`, `session`, `date`, `topic`, `channel`, `customer`, `persona` (situation, kind, label, life, history, style, probe), `record` (the contact id), `link` (a path on the `overthink view` server), `conversation[]` (customer, product, tool and note lines; tool lines carry `call` with name, arguments, ok, code). |
| `failureCounts[]` | Every kind found, with its full count. |
| `security` | `attempts`, `held`, `heldByRules`, `broke`, and `findings[]`: situation, label, `attempt` (what the person said), `held` (`held`, `held_by_rules`, `broke`), the product's `calls` and first `reply`, the `failures` it caused, `link`. |
| `situations[]` | Every situation with its assumed `rate`, how many `contacts` met it and how many of those had a failure. |
| `traces[]` | Up to 40 contacts side by side, with and without the product. |
| `audiences` | What the other audiences did (`docs/audiences.md`). `public`: `source` (`panel` or `rules`), `items`, `panelCounts` (the panels' own decisions), `scaled` (expected counts across everyone reached), `repliesWritten`, `published[]` (each item with its reach, panel and scaled figures). `staff`: `uses`, `worked`, `minutesSaved`, `shareOfWorkload`, `feedback[]` (each person: uses, worked, minutes saved, their workload, `workedLines`, `didntLines`, `wouldUseAgain`, `source`, `clamped`). `businesses`: `decisions` (count per decision), `verdicts[]` (prospect, decision, the buyer's words, what code changed). `suppliers`: `replies`, `decisions`. |
| `tokens` | People-model tokens, calls, cache hits and the cap. |
| `view` | `command` to open the run's world and `base` (where links point). |
| `caveat` | "Simulated customers, not real ones. Check with real users." |

To see a failure's record: `overthink view --run <out> --json <record> --seed <seed>`. To see it in the apps: start `overthink view` and open `view.base + link`.

`overthink run --compare` also writes `compare.json` (`overthink.compare/1`, type `CompareResults` in `simulation/twin-run/compare.ts`): `config` (with the shared `seeds`), `variants[]` (A and B: adapter, access, scope, channels, audience, their own `results.json`, measures against the business without them, product counts, failures, security breaks) and `paired[]` (per measure: mean of A and B, `difference` = mean of B − A per seed, `interval95`, `clear`, `bBetterIn`, `bWorseIn`, `sameIn`, `perSeed`).
