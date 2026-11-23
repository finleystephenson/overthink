# Resetting

- **Start the business again:** `overthink reset --yes` while `overthink up` runs, or the `reset` action. The sandbox goes back exactly to its start: every record, the clock, the people you made, the schedule and the trace. The server keeps running and `.overthink/sandbox.json` stays, so `overthink act` keeps working.
- **Start completely clean:** stop `overthink up` (Ctrl+C), then `overthink reset --yes`. This also deletes the people-model cache and any `overthink run` reports in the project.
- **Before a comparison run, always reset** (or start a fresh `up`), so both runs begin from the same business.

Nothing persists outside the sandbox: no real email, payment or post ever leaves it.
