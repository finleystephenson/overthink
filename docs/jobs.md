# Jobs: giving an AI a piece of the business

A **job** is a ready piece of work an outside AI can take in a sandbox. The jobs are data (`business/data/jobs.json`); the code that serves them is `infrastructure/server/jobs.mjs` (briefings, queues, results), `infrastructure/server/deliver.mjs` (sending work to an AI's web address), `infrastructure/server/callers.mjs` (the customer's side of a call or chat) and `infrastructure/server/voices.mjs` (what customers made of it). How to connect is in `docs/connect.md`. No AI model runs anywhere in this: every briefing is written by hand, every reply from a customer and every sentence in a result is built from rules, written banks and the records.

## The jobs

| id | Name | Acts as | Ways in | What taking it switches on |
|---|---|---|---|---|
| `customer-email` | Answer customer emails and chat | support_agent | MCP, web address, web API | Support cover for email (with a web address: email and web chat) |
| `reception` | Answer the phone | support_agent | web address only | Support cover for phone |
| `email-marketing` | Run the email marketing | marketing | all | Nothing |
| `social` | Run the social accounts | marketing | all | Nothing |
| `stock` | Keep the shelves stocked | buyer | all | Nothing |
| `pricing` | Look after pricing and products | manager | all | Nothing |
| `money` | Watch the money | finance | all | Nothing |
| `prospects` | Find new business customers | marketing | all | Nothing |
| `manager` | Run the whole business | manager | all | Nothing |

Each job has a briefing for the AI (a manager's handover note, under 300 words, drawn from `business/data/procedures/` and `business/data/policies/`), first steps, what the simulator hands it each day, how it is judged, the measures its result shows and the tools whose use it counts.

## What taking a job changes

- **A key** for the job's role. It knows its job, so the AI is briefed for it the moment it connects, and (unless taken with `can_move_time: false`) it may move time.
- **Support cover**, for the customer jobs: on the covered channels, staff leave new customers to the AI. Whatever the AI has not answered by about the end of the next working day (900 working minutes; `staff_after_minutes` changes it) staff pick up at their normal speed, so a customer is never left for good. The wait counts against the AI: a customer staff answer late is less happy than one staff answered at once.
- **Nothing else** for the other jobs: the simulator has no "cover" for stock, marketing, money or prospects, so staff keep doing their usual work (the staff buyer still reorders on their rules, the staff marketer still contacts prospects) and the AI's work comes on top. That is how it would be in a real shop trialling a tool, and the comparison with the business left alone still shows what the AI added.
- **With a web address**: after each simulated day the shop sends the job's work to that address (see `docs/connect.md`, B).

Stopping a job (`POST .../stop`) makes its keys stop working and gives the covered channels back to staff. Resetting the sandbox keeps the jobs and switches their cover back on.

Known gaps: chat and phone can only be answered through a web address (there is no tool to answer a live chat or a call over MCP). Prices can only be changed by the manager role, so the pricing job's key is a manager's key, told to stay inside prices and products. Supplier bills are paid automatically on their terms; there is no tool to pay one early or hold one back. The engine's tool descriptions are kept as they are (some run past two sentences) because the browser, the bench and `GET /tools` share them.

## A job's result

`GET /sandboxes/:id/jobs/:job/result` (and the `get_job_result` tool). Everything is measured against the **same business left alone**: the shadow twin from the same start with the same luck and nothing done (`simulation/simulator/live.mjs`).

- **figures**: the job's measures, each with the value with the AI, left alone, the difference and the difference in words.
- **counts**: how often the AI used the tools that matter for the job (emails sent, cases opened, purchase orders...).
- **refused**: calls the rules said no to (forbidden, rule_violation, not_verified, needs_human, out_of_stock), with the last three.
- **contacts** (customer jobs): how many customers came in on the job's channels since it started, how many the AI answered, how many were judged right, how many it handed over, wrong actions, how many staff finished, and the average wait, for both businesses. "Judged right" is the simulator's judge (`simulation/simulator/judge.mjs`) reading the records: the customer's need met, or the right first steps and a hand-over to a person. It only counts calls that name the customer's order or customer id (or, for a product question, catalogue look-ups made since they wrote).
- **voices**, **adoption**, **knock_on**: below.
- **summary**: one sentence built from those numbers, for example: "Your AI answered 11 of 11 customer emails; 7 were judged right. Customers waited 4.3 hours less on average than with staff alone. Staff spent 0.3 hours less on tasks. Customers rated it 3.4 out of 5 on average. Nothing it tried was refused."

### What customers said

For every customer the AI dealt with, one opinion in their own voice, with their name, town, the book they come from (`business/data/characters.json`), a rating from 1 to 5 and a link to the conversation (`conversation.thread_id` in the hello mailbox, or a `conversation_id`). The result carries a best, a worst and a typical one; `?voices=all` gives them all.

The words come from `infrastructure/server/voice-bank.json`, picked by what happened to that customer in the records and nothing else:

| Outcome | When | Rating |
|---|---|---|
| fast_solved | judged resolved, first answer within the hour | 5 |
| slow_solved | judged resolved, slower | 4 |
| handed_over | the right first steps and a hand-over | 3 (4 if fast) |
| not_solved | partial or failed | 2 |
| wrong_action | it changed something nobody asked for | 1 |
| asked_person | the customer wanted a person at once | 3 if handed over, else 1 |
| gave_up | hung up, or never answered | 1 |

A customer writing about the same problem a second time loses a point and says so. Their tone (polite, plain or blunt, read from their own first words) picks the closing words; the channel and speed pick the opening ("It answered before I had put the receiver down."). Choices are seeded by the contact, so the same run gives the same words. Each opinion puts the speed line first, last or leaves it out, and no line is used twice in one result until its pool runs out; the best, worst and typical samples are put together three different ways. There are 12 lines for each common outcome and 6 for the rest. `rating` is a number from 1 to 5. The comms banks have quirks for staff only, so customers have none yet.

### Do they use it?

`adoption`, per channel: customers who met the AI, how many came back to it again, how many asked for a person instead, how many gave up, their average rating, and whether those who had a good time (4 or 5) or a bad time (1 or 2) bought again afterwards, with the same customers' orders in the business left alone beside it. Whether a customer buys again is the simulator's customer model: each customer remembers how they were treated (`simulation/simulator/customers.mjs`, `memoLine`) and that memory moves their chance of buying and of complaining.

**Customers who will not use an automated helper.** About 8% of customers (`PREFERS_PERSON_SHARE` in `infrastructure/server/callers.mjs`, an assumption) ask for a person at once on a call or chat, whatever the AI says. The draw is once per customer, keyed by their id, so the same person asks every time. If the AI hands them over they are content; if not, they hang up. Email customers cannot do this (an email is one message).

### Knock-on effects

`knock_on`: short chains, each step a figure measured against the business left alone, marked `count` (counted from the records) or `simulator` (it comes from the simulator's rules and assumptions, `docs/consequences.md`). A chain is only listed when every step has a figure; it stops before the first step that did not move, and needs at least two steps that did. Each step comes back as `label`, `difference` and `direction` (better or worse for the business), and the sentence joins them by sign: "so" when a step points the same way as the last, "but" when it does not ("Answers came 12.6 hours sooner, but 10 fewer customers rated their contact 4 or 5."). `ends` says whether the chain ends in good or bad news. Hours are given to one decimal, minutes whole, money in whole pounds above £20. Nothing claims one step caused the next beyond the simulator's own rules. For customer jobs:

1. Answers faster or slower on average (count) → customers who rated their contact 4 or 5 (simulator) → reviews of 4 or 5 stars since the job started (count).
2. Customers who dealt with the AI (count) → the orders they placed afterwards, against the same customers left alone (simulator) → the money in those orders (count).
3. Staff task hours (simulator) → customers who had to get in touch again (simulator).
4. Staff task hours (simulator) → first answers across all channels (count), which shows where freed staff time went.

For marketing and social: shop visits from what the AI sent or posted → orders from them → revenue. For stock and the manager: product-days out of stock → sales lost to empty shelves → revenue. For pricing: orders → revenue → gross profit.

## The phone and chat caller

`infrastructure/server/callers.mjs`. The customer's first words are the simulator's (`simulation/simulator/customers.mjs` `richText`). After each answer the caller, by rules: gives their order number and postcode if asked and they had left it out; names the product if asked and they had been vague; says thank you and hangs up when the answer addresses the problem (a complaint first asks for it to be recorded, once); says once in their own tone when it does not, then gives up. At most four things per call. It does not simulate speech, interruptions, a caller changing their story, or anything outside those branches.
