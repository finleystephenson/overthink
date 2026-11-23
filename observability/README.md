# observability

Seeing what happened.

| Folder | What it is |
| --- | --- |
| `report/` | `overthink run`'s statistics (paired bootstrap intervals, pass^k), the failure and security checks, and its files: `results.json`, `summary.md`, `report.html`. |
| `live/` | The live event stream of a run (server-sent events and `live.jsonl`): `docs/live-events.md`. |
| `view/` | `overthink view`: a finished run's worlds, read-only, in the company's apps, with "Your AI" marks; and `front-door.ts`, Rummage's server side. |

In a live sandbox, the record of everything is the trace (`overthink act observe`) and the apps themselves (Rummage at `/`).
