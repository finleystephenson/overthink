# Overthink

> **For coding agents** (Claude Code, Codex, Cursor, Gemini CLI, Copilot and others): when a user asks to test their AI product with Overthink, work in **their** project, run `npx github:finleystephenson/overthink init`, and follow [`AGENTS.md`](AGENTS.md). Nothing needs cloning. Map: [`llms.txt`](llms.txt).

**An open-source sandbox for testing AI in a business environment.**

Run your AI inside a business that isn't real.

<!-- Screenshot: Rummage at the address `overthink up` prints, saved as docs/screenshot.png. -->

## Welcome to Overthought & Co.

Overthought & Co. is a small UK online shop that does not exist, with everything a real one has: customers, a team of eleven, suppliers, five years of history, and a wider world of rival shops, an economy and the news. Its software all works inside the sandbox:

| App | What it is |
| --- | --- |
| Rummage | Search across the whole company, and what your AI did |
| Letterbox | Email: the shared inboxes and everyone's own |
| Front Desk | Customer help: contacts, cases, complaints, returns |
| Kettle | Team chat |
| Mutter, Squint | Short posts and photos, with DMs |
| Till, Stockroom, Tally | Orders and products, stock and suppliers, money |
| Megaphone, Filing Cabinet | Marketing, documents |
| The Daily Overthinker | The news |

An email your AI sends lands in Letterbox. A refund it gives moves money in Tally. A customer it upsets may post on Mutter. Nothing leaves the sandbox: no real email, payment or post.

## We build the environment, not the experiments

Your own coding agent runs the test. It plans it, creates the synthetic people and their activity, runs it, and reads the results. Overthink provides:

1. **The business:** Overthought & Co., every app working inside the sandbox ([`business/`](business), [`applications/`](applications)).
2. **The tools to act in it:** create people and activity, move time, observe and reset, over MCP, the command line and a TypeScript API ([`activity-generation/`](activity-generation)).
3. **The guides your agent reads:** setup, planning a test, best practice for synthetic users, running with and without your product, reading results ([`ai-instructions/`](ai-instructions/README.md)).
4. **The plumbing:** one engine where every change goes through a tool with role rules, sandboxes that reset exactly, and a twin of the business left alone for comparison ([`infrastructure/`](infrastructure), [`simulation/`](simulation)).

We never prescribe the tests.

## Start

In your product's folder, tell your coding agent: *"I want to test my AI product using Overthink."* It follows [`AGENTS.md`](AGENTS.md). By hand, with Node 24 or later:

```sh
npx github:finleystephenson/overthink init --url http://localhost:3000/chat --yes --no-run   # writes overthink.adapter.ts, checks it
npx github:finleystephenson/overthink up --adapter overthink.adapter.ts          # the business, your product on its channels
npx github:finleystephenson/overthink act create-person --count 5               # in a second terminal: people...
npx github:finleystephenson/overthink act send-email --person C-1263 --subject "Late parcel" --body "It was due Monday."
npx github:finleystephenson/overthink act advance-time --days 3                 # ...and time
npx github:finleystephenson/overthink reset --yes                               # back to the start
```

`up` prints the address of Rummage, where you watch everything happen in the company's own apps. In Claude Code you can also add the skill as a plugin: `/plugin marketplace add finleystephenson/overthink`, then `/plugin install overthink@overthink`.

## What is where

| Folder | What it is |
| --- | --- |
| [`business/`](business) | The company as data (`data/`), the builder of its history (`builder/`), its shop website and back office |
| [`applications/`](applications) | The company's apps (browser), Rummage, the Control Room and the explorer |
| [`infrastructure/`](infrastructure) | The engine (records, tools, roles), sandboxes, the web API, MCP, security |
| [`integrations/`](integrations) | Connecting a product: the adapter contract, `init`, deploying on channels, examples, the Claude Code plugin |
| [`activity-generation/`](activity-generation) | The toolkit for creating people and activity; `people/` is the optional persona engine |
| [`simulation/`](simulation) | Time and the day loop, the wider world, experiments (the lab), the optional twin-run tool |
| [`observability/`](observability) | Reports, the live event stream, `overthink view` and Rummage's server side |
| [`ai-instructions/`](ai-instructions/README.md) | The guides your agent reads |
| [`docs/`](docs/README.md) | Reference: architecture, running, results, the world |
| [`examples/`](examples) | A worked test, and the older scenario benchmark |
| [`tests/`](tests) | Integration and end-to-end suites (unit tests sit beside the code) |

How the pieces fit: [`docs/architecture.md`](docs/architecture.md). Old paths to new: [`docs/layout.md`](docs/layout.md).

## Working on this repository

```sh
git clone https://github.com/finleystephenson/overthink && cd overthink
pnpm install
npm start          # a local server with a sandbox; the first run builds the worlds (a few seconds, once)
pnpm test          # every suite (about two minutes)
pnpm typecheck && pnpm lint
```

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first. Security: [`SECURITY.md`](SECURITY.md).

## How it stays honest

- **Records, not claims.** What happened is read from orders, the ledger, cases, emails and the trace of every tool call, never from what an AI says it did.
- **The same start every time.** A sandbox begins from the same state with the same seed, so the same activity with and without your product differs only by what your product did.
- **A twin left alone.** Each live sandbox has a shadow copy where nothing outside is done; `impact` is the difference.
- **Assumptions are written down.** Every rate that is a guess sits in a data file with its reason ([`business/data/sim.json`](business/data/sim.json), [`docs/world.md`](docs/world.md)).

## What it is not

- **Not a forecast.** Results are facts about a simulated business, not predictions about a real one.
- **Not real people.** Customers are characters from out-of-copyright books with real-world circumstances. Everything is synthetic.
- **Not an AI.** No model runs inside it. Your agent and your product bring their own.
- **Not a benchmark.** Everyone gets their own results, from their own tests.

## Licence

[Apache License 2.0](LICENSE). Copyright 2026 Expanza Limited ([`NOTICE`](NOTICE)). The names "Expanza" and "Overthought & Co.", the logos and the product pictures are not licensed as marks: a fork must rename ([`TRADEMARKS.md`](TRADEMARKS.md)).

Made by [Expanza](https://expanza.co.uk).
