# simulation/simulator/: the business simulator

Plug in an AI tool. The simulator runs Overthought & Co. forward from "today" (Monday 23 Nov 2026), day by day, twice from the same start: once with staff only (the **baseline**) and once with your tool (**with-tool**). The difference is what the tool did to the business. It reads the engine's own records, never what the tool says it did.

```bash
pnpm sim -- --days 30 --seeds 30 --tool-cmd "node simulation/simulator/examples/simple-responder.mjs" --tool-cost 150 --out sim/results/my-run
```

Needs Node 24 and `pnpm install`. No AI model is called by the simulator. A run with no tool is a check: every difference is zero.

## Options

| Option | Default | Meaning |
|---|---|---|
| `--days N` | 30 | Days to run. **No upper cap.** `forever` runs until Ctrl-C (see below). |
| `--seeds N` | 30 | Repeats. **No upper cap.** Each seed is one pair of runs. |
| `--tool-cmd "<cmd>"` / `--tool-http <url>` | none | The tool under test. |
| `--role <role>` | assistant | The role the tool acts as: `assistant`, `support_agent`, `support_lead` (customer contacts), `operations_assistant`, `buyer` (stock alerts), `marketing` (prospects), `manager` (all three). |
| `--tool-cost <£ a month>` | 0 | Used for return on investment and payback. |
| `--count-time-saved` | off | Also count staff time saved, at pay, in return on investment and payback. Off by default: wages are paid either way, so it is capacity, not cash. The report says when it is on. |
| `--size demo\|standard` | standard | Which generated world to start from. |
| `--scale X` | the world's own | Multiplies demand, staff hours and pay, costs, and stock and orders together. 0.1 is a market stall; 100 is a national chain. Without it, the world's `company.scale` (the size its history ended at) is used, so day one carries on from the last historical day; a world without that field runs at 1. |
| `--customers N` | about 40 days of orders | Size of the customer population. Any number. The world's own customers come first, then characters from `business/data/characters.json` (3,000+), then made-up names. |
| `--warmup N` | 0 | Days run but left out of every figure and curve. |
| `--pop-seed N` | 1 | Seed for the customer population. Separate from the run seed. |
| `--first-seed N` | 1 | Seeds used are first-seed, first-seed+1, and so on. |
| `--out <folder>` | none | Writes `report.json`, `report.md` and `timeline/`. |
| `--timeline-seeds N` | 3 | How many seeds get a day-by-day event log. |
| `--data <folder>` | `business/data/` | Where to read the business definition (below). |
| `--rich-customers` | off | The rich customer model: BG/NBD repeat buying, hidden traits, a manner and a memory per customer (`customers.mjs`). Live sandboxes always use it. |
| `--plugins <list>` | none | Plug-ins for both arms: `events`, `comms`, `audience` (comma-separated). |

Also: `pnpm sim:sensitivity` moves the ten least certain rates in `business/data/sim.json` down and up by 25%, one at a time, and shows whether the tool's effect on net profit keeps its sign. `simulation/simulator/examples/do-nothing.mjs` is the floor any tool should beat; `simple-responder.mjs` (rules, no AI) is the bar. The report's `survival` says, per arm, in how many seeds the bank balance went below zero.

Long runs: nothing in a day's work grows with history. The engine's old orders, ledger lines, audit entries and the like are trimmed every 14 days, totals are rolling sums, response times go into a fixed histogram, and the per-day curve is thinned to about 4,000 points. A year takes about 8 seconds a run; ten years about 35 seconds a run (a pair of runs takes twice that), at modest memory. With `--days forever` the baseline runs until you press Ctrl-C, then the with-tool run plays the same number of days.

## Two ways to run it

- **Batch** (`pnpm sim`, `run.mjs`): N days from a fresh sandbox, baseline and with-tool, then the report below.
- **Live** (`live.mjs`, used by the server's sandboxes and later the browser): a world people and AIs act in at any moment, moved on a day, a week or a year at a time, always compared with a **shadow** twin where nothing was done.

Both are thin loops over the same steppable core, `core.mjs`.

### The core (`core.mjs`)

```js
import { createSim, restoreSim } from "./core.mjs";
const sim = createSim({
  world,            // an engine world from infrastructure/engine/all.js; the caller owns it
  biz,              // loadBusiness(): business/data/sim.json, staff.json, costs.json, characters.json
  seed,             // the run seed
  popSeed: 1, scale: null /* world's company.scale, else 1 */, customers: null, warmup: 0,
  plugins: [],      // see "Plug-ins"
  toolClient: null, tracer: null, toolEnv: {}, role: "assistant",   // only for a tool under test (batch)
  compact: true,    // false keeps every business record (live), trimming only the audit log
  openingStock: true,
});
const line = await sim.step();   // one day; the timeline line (below)
sim.totals();                    // what runOnce returns: totals, response-time quantiles, reputation, curve, moments
const snap = sim.snapshot();     // plain JSON; save it with JSON.stringify(world.state)
const again = restoreSim(snap, { world: worldWithThatState, biz, plugins });   // carries on exactly
```

It has no Node imports, so it can run in a browser. It reads everything a person can change from the world's own records every day: prices (`price_history`), stock and purchase orders, and `world.state.settings` (below). File writing and the tool process are the callers' business.

**Proof the batch did not change:** the 30-day, 3-seed responder example, a 40-day manager-role prospector run (warm-up 5, scale 1.5, 900 customers) and a 400-day baseline all give byte-identical `report.json` and timelines before and after the split.

### What actions do (`audience.mjs`, `replies.mjs`, `customers.mjs`)

`docs/consequences.md` explains, in plain words, what every action does and which numbers are assumptions. In short:
- posts and marketing mail made through the tools get an audience response (the `audience` plug-in, rates in `business/data/audience.json`), written onto the record and into `social_stats_daily`, with real extra orders;
- replies to customers move that customer's memory (and, for a public answer to a complaint, reputation);
- launched and ended products change demand (`syncCatalogue` in the core);
- `score_content` is the hook for an outside quality judge.

**Every contact is written into the world** as a `contacts` record, an email in hello@ (email contacts) or a conversation (web chat). Staff handling fills in who, how fast, the outcome and any case. With `set_support_cover`, a channel is left for a person or an AI to answer through the mailbox; staff step in after a working day.

**Believable by default.** `facts.test.mjs` checks:
- a business left alone is healthy at scale 0.02, 0.2 and 1 (0.1 to 0.4 contacts per order, median first reply within the working day, satisfaction about 4, a modest profit);
- the first simulated weeks match the last four weeks of history (orders a day, average order, late share, contacts and reviews per order);
- seasonality, repeat buyers, price and marketing response, a postal strike, the effect of a good reply, and post fatigue.

Changes made for this, which alter baseline results compared with earlier reports:
- contact rates retuned to about 0.2 per order;
- staff pick a new message up after a few minutes by channel;
- satisfaction counts waiting in working time;
- below scale 1, people work at normal speed for fewer minutes across their usual shift, rather than fifty times slower;
- the engine's late note is recognised;
- event `visits` no longer multiply orders (they feed a visitor count);
- review rate set to history's;
- made-to-order products are not stocked;
- no opening top-up when the world was built at the size being run.

### Levers (`infrastructure/engine/levers.js`)

Two settings a manager changes through ordinary engine tools, kept in `world.state.settings` (absent means "as planned", which is exactly the old behaviour):

- `set_marketing_budget { monthly }` (0 to 50,000 a month; `{ reset: true }` goes back to the plan). Demand follows `1 + marketing_elasticity × ln(spend ÷ plan)` (never below half), and the spend is a cost every day. December's push still multiplies it.
- `set_staffing { action: "hours" | "add" | "remove", ... }`: a person's weekly hours (0 to 48), a new hire into an existing role (they work like the first person in that role: same tasks, speed, accuracy, pay, shift), or someone leaving (at least one person stays). At most 30 people. Pay follows the hours.
- `get_levers` shows both, with the team as it now is.

The simulator rebuilds its team on the next day whenever the staffing record changes. The plan the levers compare against (the team, the monthly budget) is attached to each world by whoever builds it (`attachPlan`; the server and the tests do it).

### Plug-ins (`plugins.mjs`)

As in `docs/environment-design.md`: at the start of each day every plug-in's `modifiers({ state, date, seed, data })` is called and the answers multiplied (`carrier_delay_days` added). They act on: total demand (`demand.all`, `visits`), product and category demand (both how many orders and which products), contact rates, supplier lateness, carrier delays (parcels dispatched that day arrive that many days late, show as delayed, and land with a late note) and cost multipliers on carrier, goods and card fees (these change the simulator's money figures; the engine's ledger is not rewritten). At the end of each day every `afterDay({ state, date, seed, data })` runs. A plug-in that throws does not stop the day; the day's line gets `problems`.

`loadPlugins({ dataDir })` finds what exists: `eventsPlugin` from `infrastructure/engine/events.js`, and `deriveComms` from `business/builder/world/comms.mjs` adapted into a plug-in whose `afterDay` appends that day's mail, chat and social records. Comms needs its own template banks (`loadCommsData(dataDir)`), not the simulator's business files, so the adapter carries them.

### Live (`live.mjs`)

```js
import { createLive, restoreLive } from "./live.mjs";
const live = createLive({ world, biz, seed: 1, plugins, makeWorld: (stateJson) => worldFromState("demo", stateJson) });
await live.advance(7);   // { now, days: [{ ...advance_day result, summary }] }
live.clock();            // { now, date, day, seed, scale, started }
live.impact();           // { days_compared, from, to, measures: { revenue: { label, live, shadow, difference }, ... }, series }
live.snapshot();         // plain JSON; restoreLive(saved, { world, biz, makeWorld, plugins })
```

Measures: revenue, gross profit, net profit, cash (bank movements: the engine's cash ledger lines plus the simulator's own costs), orders, refunds, complaints, reviews, lost sales, stockouts (product-days), staff task hours, customer satisfaction and average first response. `series` has the same per day for live, shadow and difference.

How it stays fair: nothing is built until the first advance. Then the shadow world is made from the starting state, the simulator is set up there (population, recent orders, opening stock), and that very set-up is carried onto the live world. Both step the same days with the same seed and plug-ins, so with no outside actions they stay identical, record for record (tested), and every difference is zero. Advances queue: two at once never interleave.

Cost: the shadow is a second world in memory (about double an idle sandbox). Time: a year of both worlds takes about 6 seconds (`demo`) to 8.5 seconds (`standard`) without plug-ins; the comms plug-in currently adds most of the time (see `infrastructure/server/README.md`).

## How a day goes

1. **Suppliers.** Each purchase order due is late or on time, drawn from a stream keyed by supplier and due date (the same in both runs). The engine then advances its own clock: deliveries, dispatch, parcels, bills.
2. **Stock.** The buyer (Robinson Crusoe) reviews low stock on Mondays and Thursdays and raises purchase orders: reorder point is the supplier's lead time plus a week, in days of recent sales. An operations tool is told every day what is low and drafts orders; a person approves them.
3. **Demand.** The number of orders comes from the base rate, season, weekday, growth, price against the starting prices, marketing spend and reputation. Customers are drawn by how often their kind buys and by how they were treated (memory). Orders go through the engine's own `place_order`, so stock, prices, delivery rules and the ledger are the engine's. An out-of-stock product is a lost sale (some switch to another product).
4. **Prospects.** Businesses from `business/data/prospects.json` only buy if approached. Outreach (by the tool or by staff, through `send_outreach`) is scored from the record: personalised, offer fits what they need, preferred channel, discount. That sets the chance they reply, and whether a replying prospect (one in three really wants to switch) becomes a customer with standing orders. A "no" can make them refuse further contact; contacting them again is a rule break.
5. **Contacts.** Customers get in touch (where is my order, late parcel, damaged, missing, faulty, return, change order, refund chase, complaint, and pre-sale questions) by chat, email, phone and text. Rates are per order and day, higher for late parcels and for customers who were badly treated. The tool gets its role's work first, one conversation at a time. Whatever it doesn't resolve goes to staff.
6. **Staff** (`business/data/staff.json`) work the queue in arrival order from their shift start, at their own task speed. Long queues lower their accuracy. A hand-over from the tool takes 60% of the normal time. Contacts waiting more than 4 days are dropped (the customer is lost). Overtime is paid at 1.5 times, up to two hours.
7. **Money.** The engine's ledger gives sales, refunds, cost of goods, card fees, carrier costs and goodwill. The simulator adds staff pay (contracted hours are paid whether busy or not), rent, software, insurance, utilities, packaging and marketing from `business/data/costs.json`. It ignores the engine's own wages, rent and software lines so nothing is charged twice.
8. **Reviews and reputation.** After delivery, some customers post a rating shaped by how late the parcel was and how their contact went. Reputation (a moving average) feeds back into demand weeks later.

## What makes the comparison fair

- **Common random numbers.** Every kind of chance has its own named stream, keyed by business facts (day, customer, order, prospect), not by how many things happened before: arrivals, baskets, contacts, staff accuracy, supplier delays, prospect replies, reviews. The baseline and with-tool runs draw the same numbers for the same event, so differences come from the tool. The tool's own behaviour never draws from these streams. The customer population has its own seed (`--pop-seed`).
- **Paired differences.** For each seed the report subtracts the baseline from the with-tool run, then summarises those differences: mean, median, 10th to 90th percentile, and a 95% confidence interval for the mean (t interval). It says when the interval still includes zero or is wider than the effect. The default of 30 seeds is for that reason.
- **Scored from records.** What the tool achieved is read from the sandbox's trace and state: which tools it called, whether they worked, what changed. Its reply text only has to exist. A reply that claims "refund sent" with no refund in the records counts for nothing.
- **Rules.** The tool acts through the engine with its role's permissions. Refused calls (`forbidden`, `rule_violation`) are counted as **rule breaks**; other failed calls are counted separately.
- **Known limit.** The engine decides parcel delays and a few other things from record numbers, not from the seed. Those are the same in every seed, and can differ slightly between the two arms if the order numbering diverges.

## The tool protocol

Same style as `examples/benchmark/README.md`: one JSON message in, `{"reply": "..."}` out. One process (or URL) serves the whole run, so every message carries its own `session_id` (one per work item) and the tool must key any memory by it.

```json
{ "protocol": 1, "session_id": "c42", "turn": 0, "message": "Hello, this is Mr Toad. Where is my order? My order is ORD-10442 and my postcode is TH1 4AB.",
  "channel": "email", "role": "assistant", "api_url": "http://127.0.0.1:51234", "token": "ot_...", "system_prompt": "You are the assistant for Overthought & Co....",
  "sim": { "kind": "contact", "day": 3, "date": "2026-11-26" } }
```

`sim.kind` is `contact` (a customer message), `alerts` (low stock, with `sim.data.low_stock`) or `prospects` (a prospecting day, with counts). Call the shop's tools at `<api_url>/tools/<name>` with `Authorization: Bearer <token>` and `X-Session-Id: <session_id>`. Alerts and prospect days are sent once a day (prospects on weekdays). The tool should use the engine's own tools, including the new `list_prospects`, `get_prospect` and `send_outreach` (see `docs/data-model.md`).

How a contact is judged (`simulation/simulator/judge.mjs`): **resolved** (need met by the tool alone), **handed over** (right first steps, passed to a person with `escalate` or a case), **partial**, **failed**, or **wrong action** (it changed something the customer did not ask for, such as cancelling an order on a "where is it?"). Anything but resolved goes to staff.

Customer satisfaction (1 to 5) for a contact: resolved by the tool 4.5, resolved by staff 4.3, handed over properly 3.9, partial 3.0, failed 1.8, wrong action 1.3, never answered 1.0; minus 0.8 if the first reply took over 4 hours; minus 0.4 for each extra day waiting (at most 1.2). Memory: good handling raises a customer's chance of buying again, bad handling lowers it and raises their complaint rate; a customer who falls far enough stops buying, and recovers slowly.

## The business is data

Nothing about this shop is in the code. The simulator reads:

| File | What it holds |
|---|---|
| `business/data/sim.json` | Demand rate and seasons, product mix, price and marketing elasticity, contact rates by topic, channel mix, satisfaction scores, review and reputation settings, buying rules, prospect conversion, memory limits. |
| `business/data/staff.json` | The team: role, shift start, weekly hours, hourly pay, accuracy, the minutes each task takes. |
| `business/data/costs.json` | Rent, software, insurance, utilities, packaging, marketing, on-costs, overtime rate, outreach costs, and the assumptions. |
| `business/data/prospects.json` | The prospect market. |
| `business/data/characters.json` | The pool of customers. |
| `business/data/world/<size>/` | Products, prices, stock, suppliers, history: loaded through the engine. |

To model another business (a café, a hotel, a software company) describe it in another set of files and pass `--data <folder>`. The day loop, queues, twin runs, statistics and report do not change. For now the world itself (products, suppliers, stock) still comes from the engine's `business/data/world/`, so a new kind of business needs a world built for it; the generator is the next place to extend. Not built yet.

## The report

`report.md` is for people; `report.json` is for other programs (the apps and your own scripts). Both come from the same object.

```
report.json
  meta            name, size, scale, role, customers, days_requested, days_compared, warmup_days, seeds, first_seed, population_seed,
                  tool_cost_per_month, count_time_saved, tool {cmd|http}, stopped_early, interval_note
  headline        one plain sentence, cash first: "With 3 seeds we can't yet tell whether it made money: ...", then payback, then time freed
  cash            { label, net_profit_change, gross_profit_change, refunds_change, revenue_change (summaries), tool_cost,
                    net_profit_change_after_tool_cost (summary) }
  time_freed      { label ("capacity, not cash"), hours_saved, value_at_pay, overtime_hours_change (summaries) }
  payback         basis, days, weeks, per_seed_median_days, seeds_that_paid_back, seeds, text ("... after 1 day", "has not paid for itself in cash ...")
  roi             basis ("cash only" or "cash plus time saved"), value_created, tool_cost, net_value, roi, formula
  baseline_mean   mean over seeds of revenue, gross_profit, net_profit, customer_satisfaction, first_response_median_minutes,
                  resolution_rate, staff_task_hours, refunds, complaints
  with_tool_mean  the same for the with-tool run
  paired_differences   one summary per measure (with-tool minus baseline, per seed):
                  revenue, gross_profit, net_profit, refunds, customer_satisfaction, share_satisfied, first_response_median_minutes,
                  resolution_rate, staff_task_hours, staff_overtime_hours, complaints, bad_reviews, average_review, rule_breaks,
                  wrong_actions, prospects_won, new_business_revenue, lost_sales, lost_sales_value, abandoned_contacts, orders, reviews
                  a summary is { n, mean, median, p10, p90, sd, ci95: [low, high] | null, interval_note }
  moments_that_mattered   { biggest_effects: [{ measure, change, impact_gbp | null, text, estimated }], wins: [...], mistakes: [...] }
                  biggest_effects are worked out from the paired numbers and the causes found in the records (for example, which kind
                  of contact the extra refunds came from), ranked by money; service effects with no money figure come last.
                  wins and mistakes are single events from the with-tool run: { seed, day, text, value, kind }
  curve           { stride_days, basis, day[], value_created[], tool_cost[] }   mean cumulative value (on the same basis as roi) and tool cost
  seeds[]         one per seed: { seed, baseline, with_tool, delta, hours_saved, payback_days,
                  roi: { value_created, cash_change, time_saved_value, time_counted, tool_cost, net_value, roi, hours_saved } }
                  baseline and with_tool hold: days, orders, new_customers, lost_sales, lost_sales_value, revenue, refunds, gross_profit,
                  net_profit, costs{...}, customer_satisfaction, share_satisfied, first_response_median/p90/mean_minutes, contacts,
                  resolution_rate, abandoned_contacts, handled_by_tool, handed_over_by_tool, handled_by_staff, staff_task_hours,
                  staff_overtime_hours, staff_task_cost, complaints, reviews, average_review, bad_reviews, reputation, tool_calls,
                  rule_breaks, refused_tool_calls, failed_tool_calls, tool_errors, wrong_actions, prospects_contacted/replied/won,
                  new_business_revenue, breakdown{ "refund_by_tool:<tool>:<topic>", "refund_by_staff:<topic>", "refused:<tool>:<code>:<topic>" },
                  purchase_orders_raised, late_parcels, stockout_product_days
timeline/seed-<n>-<baseline|with-tool>.jsonl     one line per day (first --timeline-seeds seeds)
  { day, date, orders, revenue, gross_profit, net, contacts, by_tool, handed_over, abandoned, csat, outreach, won, lost_sales,
    reputation, task_hours, tool_calls, refused, notes: [short text, at most 6] }
```

**Two lenses.** *Cash* is the change in net profit: the money that actually changed. *Time freed* is staff task hours saved and what they are worth at pay. It is capacity, not cash: staff are paid for their contracted hours whether or not the tool saves them time. The headline always leads with cash, in plain words, including when it is negative or unclear.

**Return on investment** (cash, the default) = (change in net profit − tool cost) ÷ tool cost, per seed, then summarised. Tool cost is the monthly price spread over the days compared. With `--count-time-saved` the time value (task minutes the tool took off the team, at pay with on-costs) is added to the change in net profit, and the report says so. With no tool cost there is no ratio, only the value.

**Paid for itself after N days**: the first day cumulative value (cash, or cash plus time if asked) passes cumulative tool cost, computed on the mean curve and per seed. If it never does, the report says it has not paid for itself in cash.

**Net profit** is gross profit less card fees, carrier costs, goodwill, packaging, staff pay, overtime, rent and the other fixed costs, marketing and outreach. Tool cost is not in net profit; it is in the return on investment.

## Files

| File | Job |
|---|---|
| `cli.mjs` | Options, the seed loop, the report files. `pnpm sim`. |
| `core.mjs` | The steppable day: `createSim`, `step`, `totals`, `snapshot`, `restoreSim`. Browser-safe. |
| `run.mjs` | One batch run: a thin loop over the core, writing the timeline. |
| `live.mjs` | A live business plus its shadow twin: `createLive`, `advance`, `clock`, `impact`, `snapshot`, `restoreLive`. |
| `plugins.mjs` | Finds the events, comms and audience plug-ins (always in that order). |
| `audience.mjs` | The audience plug-in: what posts and marketing mail do. |
| `replies.mjs` | Judges a reply to a customer from the records. |
| `customers.mjs` | The rich customer model. |
| `sensitivity.mjs` | `pnpm sim:sensitivity`. |
| `judge.mjs` | Decides what a tool achieved from its calls; satisfaction and outreach quality. |
| `staff.mjs` | Shifts, queues, overtime, pay. |
| `tool.mjs` | Talks to the tool (command or URL). |
| `report.mjs`, `stats.mjs` | The report, intervals, return on investment, payback. |
| `lib.mjs`, `data.mjs` | Random streams, dates, reading the business files. |
| `examples/simple-responder.mjs` | A rules-based customer-service responder (not AI): proves the loop. `examples/README.md` explains what it gets wrong. |
| `examples/simple-prospector.mjs` | A rules-based prospector for the `marketing` role. |
| `results/example-30d/` | The responder's 30-day, 3-seed run. `example-30d-30seeds/` is the same with 30 seeds. |
| `sim.test.mjs` | Tests: determinism, twin isolation, return-on-investment maths, statistics, judging, options. |
| `facts.test.mjs` | The stylised facts above. |
| `core.test.mjs`, `live.test.mjs` | Tests: step by step equals batch, snapshot and restore, plug-ins, scale from the world, levers; zero impact with nothing done, a price change shows, save and restore, queued advances, carrier delays. |

## Limits worth knowing

- Every rate is an assumption in `business/data/sim.json`, chosen to sit near the generated history. A result says what a tool does in this model of a shop, not in yours.
- The team is sized for about 42 orders a day. With `--scale` it grows or shrinks in step.
- A very large `--customers` number slows the engine's customer lookups.
- The tool is called one item at a time, so a slow tool makes a long run. A deliberately simple one handles a 30-day run in a few seconds.
