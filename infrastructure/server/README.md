# infrastructure/server/: the doors

How an outside AI connects to Overthought & Co., acts inside it, moves time on, and is observed. A thin layer over the engine (imported through `infrastructure/engine/all.js`, so every extension's tools exist in every sandbox): every action is an engine tool call made through `world.session({ role })`, so the engine's role rules always apply. No AI model is called anywhere. To connect, read `docs/connect.md`.

```bash
npm start                                       # the one command: checks Node, builds the worlds if missing, starts this server on port 4747 and prints how to connect
npm run serve                                   # just the server: web API + MCP + the apps on http://127.0.0.1:8787 (apps at /apps/)
node infrastructure/server/mcp-stdio.mjs --size demo --role assistant   # MCP over stdio, one private sandbox
node --test infrastructure/server/server.test.mjs              # tests (also in npm test)
```

## Files

| File | What it does |
|---|---|
| `main.mjs` | Starts the HTTP server. Options below. |
| `http.mjs` | Routes, tokens, opt-in CORS, page security headers, safe JSON, size and rate limits, the `/mcp` endpoint. |
| `net-guard.mjs` | Outside calls (job web addresses, lab connections): on a shared server, no private addresses, no redirects, capped answers. |
| `sandboxes.mjs` | The sandbox store: create, tokens, call-and-trace, reset, diff, expiry, optional persistence, and the live business (advance, clock, impact). |
| `mcp.mjs` | One MCP server per connection, bound to a sandbox and a role. Tools come straight from `world.tools`. |
| `mcp-stdio.mjs` | MCP over stdio for desktop apps. |
| `scenarios.mjs` | The five situations, each described in plain English in the file and at `GET /scenarios`. |
| `inbox.mjs` | Customer messages waiting for a reply, replies and scripted follow-ups. |
| `diff.mjs` | Which records differ from the starting state. |
| `openapi.mjs` | OpenAPI 3.1, generated from the tool list. |
| `jobs.mjs` | Ready jobs (`business/data/jobs.json`): the MCP instructions, what is waiting, taking and stopping a job, a job's result. See `docs/jobs.md`. |
| `deliver.mjs` | Sends a job's work to an AI's own web address after each simulated day (the simulator's tool protocol), turn by turn. |
| `callers.mjs` | The customer's side of a call or chat, by rules. |
| `voices.mjs`, `voice-bank.json` | What customers made of the AI, whether they use it, and knock-on effects, from the records. |
| `examples/receptionist.mjs` | A rules-based stand-in service (not an AI) to copy and replace with your model. |
| `world-data.mjs` | Reads `business/data/` once per size; makes worlds through `infrastructure/engine/all.js` and attaches the plan (team, marketing budget) the levers compare against. |

## Options (`main.mjs`)

| Flag | Default | Meaning |
|---|---|---|
| `--port` | 8787 (or `PORT`) | Port. (`npm start` uses 4747.) |
| `--host` | 127.0.0.1 | Address to listen on. Only this machine by default. |
| `--max-sandboxes` | 20 | Most sandboxes at once. Creating one more gets 503. |
| `--idle-minutes` | 120 | A sandbox unused this long is deleted. |
| `--rate-limit` | 600 | Requests a minute per token (and sandbox creations per address). 600 because the apps poll. |
| `--persist <dir>` | off | Save sandboxes to `<dir>` and load them on start. The only disk writes. |
| `--plugins` | `events,comms,audience` | Simulator plug-ins for live sandboxes (whichever exist): `events`, `comms`, both, or `none`. See "Costs" below. |
| `--hosted` | on when `--host` is not this machine | Shared-server mode: outside calls may not reach private addresses, per-address rate limit, sandboxes expire after `--max-age-hours`, advance capped, the lab hides its list. |
| `--cors-origin <origin>` | off | Answer cross-origin browser requests from this origin (or `*`). The apps and explorer do not need it. |
| `--frame-ancestors <a,b>` | none | Other origins allowed to show the pages in a frame (e.g. the Expanza site embedding the explorer). |
| `--allowed-hosts <a,b>` | none | Extra host names answered when bound to this machine (behind your own proxy). |
| `--ip-rate-limit <n>` | 0 local, 600 hosted | Requests a minute from one address, every route. |
| `--max-age-hours <h>` | none local, 24 hosted | A sandbox is deleted this long after it was made, however busy. |
| `--max-advance-days <n>` | 366 local, 31 hosted | Most days one request may move time. |
| `--trust-proxy` | off | Read the caller's address from `X-Forwarded-For` (only behind your own proxy). |

Threat model, hosted settings and what is not protected: [SECURITY.md](../../SECURITY.md).

## How it works

- **A sandbox** is one engine world in memory, made from `business/data/world/<size>/` at the fixed simulated "now" (Monday 23 Nov 2026, 10:00), then changed by its situation. The result is saved as a JSON string; reset loads that string back, so the state is byte-identical to the start (tested).
- **Tokens** look like `ot_<sandbox id>_<secret>`. Only a SHA-256 of the secret is kept, and it is compared in constant time. The owner token can do everything and act as any role (`X-Role`). Role tokens act as one role only; asking for another role is refused. An `assistant` token cannot be pre-set to a customer: it has to use `verify_customer` like the real assistant.
- **Engine sessions** are kept per token, role and `X-Session-Id`, so verification lasts across requests. Each MCP connection gets its own.
- **The trace** is written by the server around each call: wall time, simulated time, token, role, tool, input, the full result or error, and the engine's list of changes. Inbox messages and replies are traced too. `GET /sandboxes/:id/trace` (owner only).
- **The diff** compares the current state with the starting snapshot, record by record (`GET /sandboxes/:id/diff`). The engine's own audit log is left out because the trace covers it.
- **The inbox** writes every message and reply into the world's `conversations`, so they show in the diff. A role token does not see who wrote a message.

## Routes for time and the apps

| Route | Who | What |
|---|---|---|
| `POST /sandboxes/:id/advance` `{ "days": 7 }` | owner or manager token | Moves the business and its shadow twin on 1 to 366 days. Returns `{ now, days: [ { ...what advance_day did, summary } ], clock }`. Traced as one `advance` entry. |
| `GET /sandboxes/:id/clock` | any token of the sandbox | `{ now, date, day, seed, scale, started }`. Does not start anything. |
| `GET /sandboxes/:id/impact` | owner or manager token | Live minus shadow for the headline measures, plus a per-day `series`. All zero until something is done. |
| `GET /apps/*`, `GET /img/*` | anyone | Static files from `applications/` and `business/site/img/`. Read-only; no folder listings (a folder gives its `index.html` or 404); `..`, encoded slashes, hidden files and `applications/dev.mjs` are refused. A browser opening `/` is sent to `/apps/`. |
| MCP tool `advance_time` `{ "days": 7 }` | owner, manager and job connections | Same as the advance route; also returns the impact so far. |
| `GET /jobs`, `/sandboxes/:id/jobs[/:job/start\|stop\|test\|result]` | see `docs/connect.md` | Ready jobs: take one, test an AI's web address, see what it did. |

`POST /sandboxes` also takes `seed` (default 1).

**The live business** (`simulation/simulator/live.mjs`): nothing is built until the first advance. Then a shadow world is made from the sandbox's starting state, the simulator is set up there, and the same set-up (customer population, recent orders, opening stock) is carried over to the sandbox's own world. Anything done before the first advance therefore counts as an outside action. Both worlds then step the same days with the same seed and plug-ins; only the sandbox world ever receives outside actions.

**One clock.** In a live sandbox, time moves only through `advance` (or `advance_time`). The engine's own `advance_day` tool still exists for bench scenarios and for sandboxes that never go live; before the first advance it works as before (the shadow then lives through the same bare days so both start on the same date). After the first advance, calling `advance_day` through the server is refused with `rule_violation`, because it would move one world's clock without customers or staff and leave the shadow behind.

**Reset** puts back the world, drops the simulation and the shadow; the next advance starts them again from the start.

**Persistence** (`--persist`): the sandbox file also holds the simulator's state and the shadow world's state, so a restarted server carries on exactly where it was.

## Costs

Measured on a laptop (Node 24), both worlds together, with no plug-ins: a year of a `demo` sandbox takes about 6 seconds and a `standard` one about 8.5 seconds. Each later quarter is a little slower than the first because a live business keeps all its records (orders, ledger) for the apps; only the engine's audit log is trimmed (to 5,000 entries).

Memory: the shadow is a second full world, so a live sandbox holds about twice what an idle one does (a `standard` world is tens of megabytes; after a simulated year the server process was about 480 MB with one live standard sandbox). The per-day impact series is capped at 4,000 points (it halves itself beyond that).

The `comms` plug-in (mail, chat and social derived each day, `business/builder/world/comms.mjs`) is by far the slowest part at the moment: with it on, a `standard` year took about 110 seconds instead of 8.5. Start the server with `--plugins events` when you need speed more than new mail.

## What it protects against

- Acting beyond a role: every call goes through the engine's permission check; the server never calls a tool handler itself. Role tokens cannot switch role.
- One developer seeing another's sandbox: separate worlds; a token for one sandbox gets 404 on another.
- Guessing tokens: 256-bit random secrets, hashed, compared in constant time.
- Leaking internals: no stack traces in responses (unexpected errors are logged on the server and answered with `internal`).
- Escaping the static folders: paths are decoded, normalised and checked to stay inside `applications/` or `business/site/img/`; hidden files and folder listings are never served; nothing static can be written.
- Simple abuse: request bodies over 64 KB are refused; at most 366 simulated days per advance request, one advance at a time per sandbox; per-token rate limit; per-address limit on creating sandboxes; a cap on sandboxes; idle expiry; caps on sessions (500) and trace entries (20,000) per sandbox.
- DNS rebinding: when bound to localhost, requests addressed to any other host name are refused.

## What it does not protect against

- **The open internet.** There is no TLS, no user accounts and no sign-up. Anyone who can reach the port can create sandboxes up to the cap. Keep it on localhost, or put it behind a proxy with TLS and your own limits before exposing it.
- **Lost or shared tokens.** Whoever holds a token is that token. Tokens are shown once and cannot be revoked one by one; delete the sandbox instead.
- **Gaps in the engine.** The server adds no business rules. If the engine lets a role do something it should not, so does the server.
- **Memory.** Each sandbox holds a world in memory (a `standard` one is tens of megabytes). The cap is the only guard; set it to fit your machine.
- **Many addresses.** Rate limits are per token and per address, so many machines together can still fill the sandbox cap.
- **What you send.** Inputs, replies and pushed messages are stored in the trace (and on disk with `--persist`). Do not send real personal data.
- **Persisted files.** `--persist` writes token hashes, not tokens, but the files hold the whole sandbox. Protect the folder.
