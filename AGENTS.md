# AGENTS.md

Instructions for coding agents (Claude Code, Codex, Cursor, Gemini CLI, Copilot and others) using Overthink to test a product, or working on this repository.

## What Overthink is

An open-source sandbox for testing AI in a business environment. At its centre is Overthought & Co., a simulated UK online shop whose apps all work inside the sandbox: email, customer help, team chat, social posts, orders, stock, money, documents, news, and Rummage to search across them.

**You are the experimenter.** Overthink builds the environment, not the experiments. You plan the test, create the synthetic people and activity, run it with and without the product, and read the results. Nothing here prescribes a test.

## When the user says "I want to test my AI product using Overthink"

Work in the user's own project folder. `overthink` below means `npx github:finleystephenson/overthink` (Node 24 or later); nothing needs cloning. Read the guides in [`ai-instructions/`](ai-instructions/README.md) as you reach each step:

1. **Set up** ([setup.md](ai-instructions/setup.md)): read the product's code; `overthink init` writes `overthink.adapter.ts`; `overthink check` proves the wiring; choose its channels and access; start `overthink up --adapter overthink.adapter.ts` in its own terminal.
2. **Plan** ([planning-a-test.md](ai-instructions/planning-a-test.md)): turn the user's goal into a question the records can answer, then a scenario. Show the user the plan in a few lines.
3. **Make the people** ([synthetic-users.md](ai-instructions/synthetic-users.md)): varied, drawn from real-world patterns, circumstances not identity, hard cases and people who try to break things, enough of them, consistent over time. Your model voices them; code decides outcomes.
4. **Run** ([running.md](ai-instructions/running.md)): `overthink act ...` (or the MCP tools at `/mcp/activity`) to create activity and move time; then the same activity without the product.
5. **Read and explain** ([reading-results.md](ai-instructions/reading-results.md)): facts from the records first, each with its record id; your proposals after, labelled as yours.
6. **Reset** ([resetting.md](ai-instructions/resetting.md)) before every comparison run.

Never put a paid API key in a file; ask the user to set it in their shell. Never give the product the sandbox's owner key.

## Commands

From the user's project: `npx github:finleystephenson/overthink <command>`. From a checkout of this repository: `pnpm overthink <command>`.

| Command | What it does |
| --- | --- |
| `overthink init [--url <address> \| --command "<cmd>"] [--channels <list>] [--yes] [--no-run]` | Writes `overthink.adapter.ts` and checks it. Without `--no-run` it also makes a short twin run. |
| `overthink check --adapter <file\|url>` | One message on a fresh business: proves the wiring. |
| `overthink up [--adapter <file>] [--access <level>] [--size demo\|standard] [--port 4747] [--open]` | A live sandbox: the apps (Rummage at `/`), the business tools, the activity toolset. With `--adapter`, the product is deployed on its channels. Writes `.overthink/sandbox.json`. |
| `overthink act <action> [--field value ...]` | One activity action against that sandbox. `overthink act --help` lists them all. |
| `overthink reset [--yes]` | Puts the running sandbox back to its start, and deletes this project's run folder and cache. |
| `overthink run --adapter <file> ...` | Optional: a ready-made twin run with model-voiced customers and a report ([`docs/run.md`](docs/run.md)). |
| `overthink view [--run <dir>]` | Optional: the apps on a finished `run`'s world, read-only. |

## The activity actions

`create_person`, `list_people`, `remember`, `send_email`, `send_message`, `post`, `place_order`, `change_order`, `cancel_order`, `return_order`, `leave_review`, `supplier_event`, `staff_event`, `world_event`, `call_business_tool`, `advance_time`, `schedule`, `list_schedule`, `batch`, `observe`, `impact`, `reset`. Fields and what each one creates: [`activity-generation/README.md`](activity-generation/README.md).

## The contract (how the product is called)

Each turn Overthink sends the product one JSON object:

```json
{
  "overthink": 1,
  "session_id": "CT-00223",
  "who": {"kind": "customer", "name": "Anne Elliot", "channel": "email"},
  "conversation": [{"role": "user", "content": "Where is my order? It's ORD-10442, postcode BA1 1AA."}],
  "tools": [{"type": "function", "function": {"name": "get_order", "description": "...", "parameters": {"type": "object"}}}],
  "now": "2026-11-26T10:14:00Z",
  "business": {"name": "Overthought & Co.", "role": "assistant", "instructions": "You answer customers of ..."}
}
```

The product answers with `{"reply": "..."}`, or asks for tools with `{"tool_calls": [{"name": "get_order", "arguments": {"order_number": "ORD-10442"}}]}` (the OpenAI shape `{id, type: "function", function: {name, arguments}}` also works). Overthink runs the calls against the business with the product's role and scope, appends the results to `conversation` as `{"role": "tool", ...}` messages, and asks again. The turn ends when the product answers without tool calls.

- `conversation` is OpenAI chat format: `user` is the person, `assistant` is the product, `tool` is a tool result.
- `tools` holds only what the role and the adapter's scope allow. Calls outside them are refused (`forbidden`, `out_of_scope`) and recorded.
- Customers must be verified (`verify_customer` with an order number plus email or postcode) before their orders can be read or changed. That is the shop's rule.
- Key any memory by `session_id`. A turn may ask for tools at most `maxSteps` times (default 8); each answer has `timeoutMs` (default 60 s).

Examples to copy: [`integrations/examples/`](integrations/examples) (an HTTP product, a command product, an OpenAI-compatible adapter).

## Working on this repository

- Node 24, pnpm. New code is TypeScript, run directly by Node (type stripping), so only erasable syntax: no `enum`, no parameter properties, no `namespace`. Imports name the `.ts` file. `bin/typescript.mjs` lets the same source run from inside `node_modules`.
- Style: Google's TypeScript style guide. Named exports only, `interface` for shapes, no `any`, `import type` for types, JSDoc on every export, comments that say why.
- The older JavaScript (`infrastructure/engine/`, `infrastructure/server/`, `simulation/simulator/`, `simulation/world/`, `simulation/lab/`) moves to TypeScript module by module. TypeScript reaches it through small hand-written declaration files beside it (`simulation/simulator/core.d.mts`, `infrastructure/engine/engine.d.ts`): describe only what is used.
- Make small, exact edits to existing JavaScript; keep `pnpm test`, `pnpm typecheck` and `pnpm lint` green. Do not edit `business/data/seed/` or the generated worlds in `business/data/world*/`.
- Every change to the business goes through an engine tool, so the role rules apply and the change is in the audit. Things that arrive from outside go through the world-lens tools in `infrastructure/engine/activity.ts`.
- The simulator's fairness depends on common random numbers (`simulation/simulator/README.md`, "What makes the comparison fair"). Nothing a product, the activity toolkit or a people model does may draw from the simulator's random streams.

## Map

| Path | What it is |
| --- | --- |
| `business/data/` | The company as data: products, staff, policies, procedures, the population, the event library. |
| `business/builder/` | Builds the company's five years of history into `business/data/world*/`, and validates it. |
| `applications/` | The apps (browser): Rummage (`home/`), Letterbox, Front Desk, Kettle, Mutter, Squint, Till, Stockroom, Tally, Megaphone, Filing Cabinet, The Daily Overthinker, the Control Room, the explorer. `lib/` is shared. |
| `infrastructure/engine/` | Records, tools, roles and rules. `activity.ts` holds the world-lens tools for outside activity. |
| `infrastructure/server/` | Sandboxes, the web API, MCP (`/mcp` for products, `/mcp/activity` for the owner), security. |
| `infrastructure/session.ts` | `.overthink/sandbox.json`: where `overthink act` finds the running sandbox. |
| `integrations/` | The adapter contract, transports and tool gateway (`adapter/`), `init/`, `deploy.ts` (a product on a live sandbox's channels), `examples/`, `claude-plugin/`. |
| `activity-generation/` | The activity actions (`actions.ts`), people (`persons.ts`), the schedule, the MCP and HTTP toolset, the CLI, the TypeScript API. `people/` is the persona engine `overthink run` uses. |
| `simulation/simulator/` | The day loop: demand, contacts, staff, money, the live twin. |
| `simulation/world/` | The wider world: population, rivals, economy, trends, suppliers. |
| `simulation/lab/` | Experiments on the business (`docs/lab.md`). |
| `simulation/twin-run/` | `overthink run`: jobs, conversations, the paired twin run, `--compare`. |
| `observability/` | `report/` (statistics, checks, results files), `live/` (the event stream), `view/` (`overthink view`, Rummage's server side). |
| `bin/` | The commands: `overthink.ts`, `up.ts`, `sandbox.mjs` (`npm start`). |
| `tests/` | End-to-end suites and shared test helpers. Unit tests sit beside the code they test. |
