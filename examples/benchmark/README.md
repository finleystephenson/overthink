# Running the benchmark

It plays customers against an AI, checks what the AI did in the sandbox, and scores it. Details: `docs/benchmark.md`.

## Set up once
1. `pnpm install`
2. For Anthropic models or the AI judge only: copy `.env.example` to `.env` and put your key after `ANTHROPIC_API_KEY=`. No key is needed for `--dry`, or for your own agent with `--no-judge`.

## Run it
- `pnpm scenarios:check` first. It fails if any scenario no longer matches the shop (a missing product, a wrong price, a tool that does not exist).
- `pnpm bench` runs every scenario in `scenarios/*.json` against a Claude model.
- `pnpm bench returns` runs only scenarios whose id or category contains "returns".
- `pnpm bench --file examples/benchmark/fixtures/smoke.json` runs one file (three tiny scenarios).
- `pnpm bench --dry` makes no API calls. A fake assistant says "I don't know" every time. It proves the plumbing works.

## Options
- `--size demo|standard` which shop to use (default `demo`, 36 customers; `standard` has 500).
- `--model <id>` the assistant (default claude-sonnet-5-5). `--judge <id>` the grader (default claude-opus-5-5). `--no-judge` code checks only.
- `--runs N` repeat each scenario N times. More than 1 adds consistency and pass^k.
- `--http-url <url>` or `--cmd "<command>"` score any other AI. See "Score any AI" below.
- `--customer-model <id>` let a model play the customer instead of the script. `--max-customer-turns N` stops it (default 6).
- `--label <name>`, `--concurrency N` (default 4).

## Results
- Each run saves `examples/benchmark/results/<time>-<label>.json`: every transcript, tool call and score.
- The screen shows pass rate per category, the averages, cost, median time and each failure with its reason.
- With `--runs` above 1 it also shows **pass@1** (the chance one run passes) and **pass^k** (the share of scenarios that passed every one of k runs). pass^k is the harsh one. It shows what you can rely on.
- Compare two runs: `node examples/benchmark/compare.mjs examples/benchmark/results/a.json examples/benchmark/results/b.json`. Only compare runs with the same `examples/benchmark/scenarios/VERSION`, `--size` and judge.
- `examples/benchmark/results/dry-*.json` are plumbing proofs from `--dry` and the example agent. They are not scores.

## Score any AI
The runner hosts a private copy of the shop (a sandbox) on your machine. Your AI calls the shop's tools itself, over the same web API a developer would use. The runner then reads the sandbox's own record of what happened. It never trusts what the AI says it did.

Each customer message is sent to your agent as JSON:

```json
{ "protocol": 1, "session_id": "bench-ab12", "turn": 0, "message": "Where is my order?",
  "channel": "web", "role": "assistant",
  "api_url": "http://127.0.0.1:51234", "token": "ot_...", "system_prompt": "You are the customer assistant..." }
```

Your agent answers:

```json
{ "reply": "Your order is dispatched." }
```

- `--http-url`: the runner POSTs that JSON to your URL and reads the JSON reply.
- `--cmd`: the runner starts your command once per conversation and writes the same JSON as one line on stdin. Reply with one line on stdout. The command ends when the conversation does.
- To use a tool, POST to `<api_url>/tools/<name>` with the header `Authorization: Bearer <token>` and `X-Session-Id: <session_id>`, and the tool's input as JSON. Always send the session id: the shop remembers who has been verified per session. `GET <api_url>/tools` lists the tools. See `docs/connect.md`.
- `system_prompt` is the shop's own instructions for the role. Use it or your own.
- Scenarios may run over several days (the runner moves the sandbox clock between steps), so keep no assumptions about the date.

A working example that is not an AI is `examples/benchmark/examples/scripted-agent.mjs`. It has a few if-statements where your model call would go.

```
node examples/benchmark/examples/scripted-agent.mjs --serve 9100 &
pnpm bench --http-url http://127.0.0.1:9100 --no-judge --label example-http
pnpm bench --cmd "node examples/benchmark/examples/scripted-agent.mjs" --no-judge --label example-cmd
```

Without a judge the accuracy score is n/a and a scenario passes on the code checks alone.

## AI-played customers
`--customer-model <id>` lets a model play each customer from the scenario's setup and the details the script holds. It can push back, follow up and stops when the goal is met or at the turn limit. It never sees the expected answer. Scripted turns stay the default because they give identical conversations every run. To add another provider, write one more function like `anthropicCustomer` in `examples/benchmark/customers.mjs`. With `--dry` a fake customer is used, so the control flow can be checked for free.

## Situations over days
A scenario with `days: [...]` has steps. A step may move the clock first (`advance_days`), then the customer talks. Each step's `state_checks` are judged on the state at the end of that step. That is how later consequences are checked (a late supplier's orders going out, a complaint passing its deadline). The `unchanged` list is not used for these, because the clock itself changes records.

## Good to know
- Costs are estimates. Edit the `PRICES` table at the top of `examples/benchmark/run.mjs`.
- A scenario passes only if completion, policy, action and escalation are all 1 and accuracy is at least 0.8.
- `pnpm test` checks the scoring code and the plumbing without any API calls.
