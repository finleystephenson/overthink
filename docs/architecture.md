# Architecture

How Overthink is put together, folder by folder. Every file named here exists; where a part is thinner than its name suggests, the last section says so.

## The idea in one picture

```
 the developer's coding agent                 the product under test
   plans, creates people and activity,          answers on its channels, calls the
   moves time, observes, resets                 business tools its role allows
        |  owner key                                  |  role key / adapter
        v                                             v
 activity-generation/  (MCP /mcp/activity, CLI, HTTP, TS)   integrations/ (adapter, deploy, /mcp, web API)
        \                                             /
         +------------  infrastructure/server/  ----------+    applications/ (browser): Rummage and the apps
                     one SANDBOX = one engine world          reads the same sandbox through the web API
                     + starting snapshot + trace + live twin
                                   |
              infrastructure/engine/: records, tools, roles, rules (every change goes through a tool)
                                   |
     business/data/ (the company as files) --built by-- business/builder/ (five years of history)
                                   |
     simulation/simulator/ (the day loop) + simulation/world/ (the wider world) move time
     simulation/lab/ and simulation/twin-run/ run experiments on copies
     observability/ reports what happened
```

The developer's agent and the product never share a key. The agent holds the sandbox's owner key and speaks for the world outside the company. The product holds a role key (or is called through its adapter with a role) and can only do that role's job.

## The folders

| Folder | What it holds |
| --- | --- |
| `business/` | The company as data: products, staff, policies, procedures, costs, the population with real-world circumstances, the event library (`data/`); the builder that turns them into five years of history and checks it (`builder/`); the public shop website (`site/`), the back office (`backoffice/`) and the brand (`brand/`). |
| `applications/` | The company's apps in the browser: the sandbox desktop (`desktop/`, the front door), Rummage (`home/`), Letterbox, Calendar, Contacts, Front Desk, Kettle, Mutter, Squint, Till, Stockroom, Tally, Megaphone, Files, The Daily Overthinker; the Control Room and the explorer (sandbox screens); `lib/` shared by all. `apps.json` lists every app. Plain HTML, CSS and ES modules; they reach a sandbox only through `lib/client.js`. |
| `infrastructure/` | The engine (`engine/`: records, about 170 tools, roles, lenses; new extensions such as the calendar and the address book are TypeScript), the sandbox store, the web API, MCP and their security (`server/`), and the local session file (`session.ts`). |
| `integrations/` | How a product connects: the adapter contract, transports and tool gateway (`adapter/`), `overthink init` (`init/`), a product deployed on a live sandbox's channels (`deploy.ts`), copyable examples, the Claude Code plugin. |
| `activity-generation/` | The toolkit an agent uses to create activity: one list of actions (`actions.ts`) exposed as MCP tools, HTTP routes, `overthink act` and a TypeScript API; synthetic people (`persons.ts`); scheduling. `people/` is the optional persona engine. |
| `simulation/` | Time and behaviour (`simulator/`: the day loop, customers, staff, money, the live twin), the wider world (`world/`: population, rivals, economy, trends, suppliers), experiments on the business (`lab/`), and the optional `overthink run` (`twin-run/`). |
| `observability/` | Statistics, checks and the results files of `overthink run` (`report/`), the live event stream (`live/`), and `overthink view` with Rummage's server side (`view/`). |
| `ai-instructions/` | The guides the developer's agent reads. |
| `bin/` | The commands: `overthink` (`overthink.ts`, `up.ts`), `npm start` (`sandbox.mjs`), and the TypeScript loader for installs (`typescript.mjs`). |

## How state flows

**One engine state per sandbox.** A sandbox (`infrastructure/server/sandboxes.mjs`) holds one engine world, its starting snapshot (for reset and diff), its tokens, its inbox and its trace. Everything that changes the business changes it through an engine tool, so the rules always apply and every change is in the engine's audit and the sandbox's trace.

**Tools, roles and lenses.** Each tool declares which roles may call it and an input schema. A support agent cannot see the books. The `world` lens (`engine.js` `LENSES`) sees what no business role can: hidden traits, rivals' strategies, the world settings, synthetic people's profiles. The server never offers it to a connection. The explorer and the lab read through it, and the activity toolkit uses a fixed set of world-lens tools (`infrastructure/engine/activity.ts`) to deliver what arrives from outside: a synthetic person, their email, chat or post.

**Views over records.** Two extensions keep almost nothing of their own. The calendar (`infrastructure/engine/calendar.ts`) works out deliveries due, bookings, staff shifts, campaigns, world events and task due dates from those records every time it is read, so it can never fall out of step; it stores only the entries people make (meetings, supplier calls, reminders) and requests from outside. The address book (`infrastructure/engine/contacts.ts`) builds a card for every customer, supplier, member of staff, partner and prospect from its record, cut to what the caller's role may see, and stores only notes and tags.

**Activity** (`activity-generation/`). An action is either something arriving from outside (world-lens tools write the same records the simulator writes for its own customers: a Front Desk contact, an email in hello@, a conversation, a post), or something a person does in the shop (the `customer` role, signed in as them: orders, returns, reviews, under the shop's rules). Each action is written to the trace as `kind: "activity"`. Scheduled actions wait in the world's state and run before their day.

**A deployed product** (`integrations/deploy.ts`). `overthink up --adapter` hooks the product to the sandbox: after each action and each simulated day, activity waiting on its channels is sent to it through the adapter contract, its tool calls run with its role and scope, and its answer goes back where the person wrote. Its calls are traced as `kind: "tool"`, its answers as `kind: "reply"`.

**Plug-ins.** The simulator takes plug-ins: `{ name, modifiers(ctx), afterDay(ctx) }`. `modifiers` runs at the start of a day and returns multipliers (demand, visits, contact rate, costs, delays) plus a `why` list. `afterDay` adds that day's records. `simulation/simulator/plugins.mjs` loads them in a fixed order: events, comms, world, audience, team.

**Live world and shadow twin** (`simulation/simulator/live.mjs`). The first time time moves, a second world is made from the same starting state, with the same seed and plug-ins, and only staff in it. Every chance is drawn from `rngFor(seed, purpose, ...keys)` keyed by business facts, never a running count. With nothing done from outside, the two worlds stay identical and the impact is exactly zero; whatever differs is what was done.

**Lab branches and twin runs.** `simulation/lab/branch.mjs` restores a copy of one snapshot for each arm and seed, changes it only through engine tools or `state.world_settings`, and compares each arm with the baseline on the same seed. `simulation/twin-run/` does the same for a product: the same days with and without it, over several seeds.

## Where the parts are thinner than the name

- **The company's data** is lists of JSON records, not a graph database. The explorer builds connections on demand. Links between people are only household, neighbour and friend.
- **The wider world** is written rules with seeded chance, not agents that learn. Word of mouth between customers is not built. See "Not done" in [world.md](world.md).
- **Behaviour.** The simulator's own customers are a statistical model with small effects from real-world circumstances; staff are queues with speeds. Synthetic people from the toolkit say only what the agent writes for them.
- **A deployed product** answers activity only; the simulator's background customers stay with staff. Voice is not modelled: a phone call is its words.
- **The calendar** holds records, not work: a meeting takes no staff time in the simulator yet, and shifts are the contracted hours spread evenly over the working days.
- **Orchestration** is the day loop plus the plug-in order, with no message bus.
- **The lab** writes business rules it cannot change through a tool (returns window, delivery charges) to `world_settings.policies`.
- **Infrastructure.** One Node process, sandboxes in memory (optional persistence), two world sizes (`demo`, `standard`). Built for one developer on their own machine, not for many users at once.
