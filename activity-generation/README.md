# activity-generation

The toolkit an AI agent uses to create activity inside the sandbox: synthetic people, and what they do. Everything goes through the engine's tools, so every app (Letterbox, Front Desk, Till, Mutter, Squint, Kettle, Rummage...) shows it, and the shop's rules apply to synthetic people exactly as to the simulator's own customers.

It is a set of verbs, not a set of tests. The agent decides what to do with them ([`ai-instructions/`](../ai-instructions/README.md)).

## Three ways in, one list of actions

| Way | How |
| --- | --- |
| MCP | `/mcp/activity` on the sandbox server, with the owner key (`overthink up` prints the `claude mcp add` line) |
| Command line | `overthink act <action> --field value ...` against the sandbox `overthink up` started; `overthink act --help` |
| HTTP | `POST /sandboxes/{id}/activity/{action}` with the owner key; `GET /sandboxes/{id}/activity` lists them |
| TypeScript | `openActivity(store, sandbox)` in-process, or `new ActivityClient({url, sandbox, key})` (`index.ts`) |

All four are made from [`actions.ts`](actions.ts), so they never drift apart. Only the owner key reaches them: a product under test holds a role key and cannot create customers or speak for them.

## The actions

| Action | What it does | Shows in |
| --- | --- | --- |
| `create_person` | Synthetic people as customers: drawn from the population (`count`, `where`) or described in words | Front Desk, Till (customers) |
| `list_people`, `remember` | Their profiles and memory; add what they were told | (world lens only) |
| `send_email` | An email arrives in hello@ (raises a contact) or another mailbox, e.g. suppliers@ | Letterbox, Front Desk |
| `send_message` | Website chat, a phone call or a text; carries a conversation on with `conversation_id` | Front Desk |
| `post` | A post, reply or DM on Mutter or Squint; DMs and mentions raise a contact | Mutter, Squint, Front Desk |
| `place_order`, `change_order`, `cancel_order`, `return_order`, `leave_review` | What a person does on the shop's website, under the shop's rules | Till, Stockroom, Tally |
| `supplier_event` | A purchase order runs late, changes price or quantity; a supplier writes in | Stockroom, Letterbox |
| `staff_event` | Someone in the team says something in Kettle; their hours change | Kettle |
| `meeting_request` | A supplier, partner or customer asks for a meeting or call; it waits as tentative until someone answers | Calendar |
| `world_event` | A world event from the library or your own: demand, delays, costs | The Daily Overthinker |
| `call_business_tool` | Any business tool as a role, for look-ups (catalogue, staff, purchase orders) | |
| `advance_time` | Moves the business on: the simulator's own customers, staff, parcels and suppliers carry on | everywhere |
| `schedule`, `list_schedule` | Runs an action later in simulated time, on its day | |
| `batch` | Runs a list of actions in order; keep a test's batch file to rerun it exactly | |
| `observe`, `impact` | What happened (the trace), and the business against its untouched twin | |
| `reset` | Back exactly to the start | |

A refusal by the shop (a return before delivery, a declined card) comes back as `{"ok": false, "error": {...}}`. That is often the point of a test, so a batch carries on unless `stop_on_error` is set.

## People

A synthetic person is a customer record (account, email, address) plus a profile: who they are. The profile is readable only through the world lens, so the product never sees it. Fields (`persons.ts` `PersonProfile`; all optional except `source`):

| Field | Meaning |
| --- | --- |
| `source` | `population` or `described` |
| `population_id`, `description` | Where they came from |
| `age`, `household`, `employment`, `income`, `online`, `channel`, `area`, `circumstances` | Real-world circumstances (from the population, or yours) |
| `goal` | What they want from the shop now, in a sentence |
| `tone`, `patience` | How they come across, and how long they put up with a poor answer |
| `adversarial` | True for someone who will try to break the product |
| `assumptions` | What whoever made the profile assumed, so a reader can check it |

Each person also has a `memory`: actions add a line ("Emailed hello@: "Late parcel""), and `remember` adds what they were told. Read it before voicing them again. Email addresses end in `@people.example` and postcodes start `OT`, an area that does not exist, so nothing can be mistaken for a real person.

How to make a fair, varied set: [`ai-instructions/synthetic-users.md`](../ai-instructions/synthetic-users.md).

## A product deployed on channels

`overthink up --adapter overthink.adapter.ts` deploys the product ([`integrations/deploy.ts`](../integrations/deploy.ts)): activity on its channels reaches it as it arrives, and its answer goes back where the person wrote. The simulator's own background customers stay with staff, so the product meets exactly the people you made.

## `people/`: realistic people for `overthink run` (optional)

[`people/`](people) is the persona engine behind `overthink run` (`docs/run.md`, `docs/audiences.md`): audiences, personas with hard and hostile situations, persona panels that read posts, buyers, staff feedback, a model client and a cache. Use it directly when you want those ready-made people; nothing else depends on it.

## Under the bonnet

- The engine tools for things arriving from outside live in [`infrastructure/engine/activity.ts`](../infrastructure/engine/activity.ts) (world lens only).
- Each action is written to the sandbox trace as `kind: "activity"`, apart from what a product did (`kind: "tool"` and `"reply"`).
- Scheduled actions wait in the world's state (`activity_schedule`) and run before their day when time moves ([`schedule.ts`](schedule.ts)), so a reset clears them.
