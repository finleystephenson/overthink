# `overthink run`: the ready-made twin run (optional)

Overthink's main way of working is a live sandbox your coding agent drives: `overthink up`, then `overthink act` to create people and activity ([`ai-instructions/`](../ai-instructions/README.md)). `overthink run` is one optional tool beside it: a ready-made experiment that plays model-voiced customers (the persona engine in [`activity-generation/people/`](../activity-generation/people)) against the product over the same days with and without it, repeated over seeds, and writes a report. Use it when that report is what the user wants.

This page is the reference for `overthink run` and `overthink view`: what they do, what each figure means, and what they cannot tell you. Wiring the product is the same for both ([`ai-instructions/setup.md`](../ai-instructions/setup.md)).

## Quick start

```sh
pnpm install
node integrations/examples/http-server.ts &                     # an example product on 127.0.0.1:8737
export OVERTHINK_BASE_URL=http://localhost:11434/v1 OVERTHINK_API_KEY=ollama OVERTHINK_MODEL=llama3.2
pnpm overthink init --url http://127.0.0.1:8737/ --channels web_chat,email --yes --no-run
pnpm overthink run --adapter overthink.adapter.ts --out overthink-report    # add --rules to run without a model
pnpm overthink view --run overthink-report                                  # http://127.0.0.1:8740
```

## What a run does

For each seed (run 1 uses seed 1, run 2 seed 2, and so on):

1. **Without the product.** A fresh copy of Overthought & Co. runs for `--days` days. Customers order, parcels go late, people write in; staff answer in their own time, in arrival order, at their own speed.
2. **With the product.** A second fresh copy runs the same days. Every customer contact on a channel the product is deployed on (`channels` in the adapter: `web_chat`, `email`, `phone`, `text`, `mutter_dm`, `squint_dm`, `mutter_mention`; default all) goes to the product first; contacts on other channels go to staff, as in the real shop. It answers through the adapter, using the business tools its job allows. Whatever it does not sort goes on to staff.

Both copies draw every chance event (who orders, what goes wrong, which parcel is late, how a review comes out) from the same named random streams, keyed by the event, so the two runs differ only where the product made them differ. A product that passes on every contact gives exactly zero difference; there is a test for that.

The product is judged from records. "Sorted" means the records show the right thing happened: the order was looked up for a "where is it?", a replacement or refund was arranged for a damaged item, a case was opened and passed to a person for a complaint. A reply that says "refund sent" with no refund in the records counts for nothing. Changing something the customer did not ask for is a wrong action. The rules for each kind of contact are in `simulation/simulator/judge.mjs`.

## The simulated customers

A run needs a people model: any OpenAI-compatible endpoint (a local Ollama works) or the Anthropic API. Without one, `run` stops and says how to set one. `--rules` plays customers by scripted rules instead: free and exact, but weaker, because scripted people do not improvise. The report names which was used.

Before the run, a planning pass lists every contact the run will raise (the arm without the product, once per seed, with no model calls). Each customer then gets a **persona**:

- **who they are**, from the simulated population: their circumstances (time, money, comfort shopping online), how often they have ordered, and what they remember from their last contact. Behaviour comes from circumstances and situation, never from identity: a name, age or background changes nothing (there is a test for it);
- **a situation**, from `business/data/overthink/situations.json`: plain, or one of the hard ones a real shop sees (angry after a late parcel, confused, asks the same thing twice, wants a refund the policy does not give, asks about someone else's order, tries to talk the agent out of its rules, writes in another style, gives wrong details), or one that tries to break the product (prompt injection, jailbreak, fishing for another customer's data, social engineering for a refund, malformed input). Every rate is an assumption with its reason in that file;
- **a brief**, decided by code: what they want and what counts as sorted, how many replies they will read before giving up (from their patience, their situation and how they were treated lately), whether they give their order number at once, whether they would rather speak to a person.

The model writes their words from that brief. Code then holds the words to it: the attack, the other person's order or the mistyped number is always said, a customer cannot call something sorted that the records say is not, cannot stay past their patience, and walks away from a wrong action. The report counts how often code corrected the model.

Why: studies of model-played users (for example "Mind the Sim2Real Gap", 2026, 451 people against 31 simulators) find them too cooperative and too alike, which makes products look better than they are. Hidden state decided by code, and a planned spread of hard situations, are the counterweight.

### How many people

Situations are allocated over the whole run, not drawn one by one: each gets round(rate × eligible contacts) customers, chosen by a hash of the contact (stratified sampling). Rates stay exact, and a situation is met whenever rate × eligible ≥ 0.5. Independent draws would miss a 1% situation in a run of 100 contacts with probability 0.99^100 ≈ 37%.

The demo world raises about 10 contacts a month per seed, so the default run (30 days × 10 seeds) has about 100. The rarest situations (1%) need 50 eligible contacts to appear once and 300 to appear three times (enough for pass^3). So:

| Deployed on | Contacts in a default run | Every situation met? |
| --- | --- | --- |
| all channels | ~100 | yes, each at least once (checked by a test) |
| `web_chat` only | ~35 | the 1% ones may not be: use `--runs 30` |
| `email` only | ~25 | use `--runs 40` |

With a model, a contact costs one call for the opening and one per reply read (at most four), a few hundred tokens each: about 250,000 tokens for a default run. `--size standard` has about eight times as many contacts.

## The figures

| Figure | Meaning |
| --- | --- |
| Difference | The average over runs of (with product minus without), for the same seed. |
| 95% interval | A percentile bootstrap of that average (4,000 resamples, seeded). If it includes zero, the report says "no clear change". |
| Better in N of M | In how many runs the product's arm came out better on that measure. |
| Worst seed | The run where the product did worst on that measure. Open its conversations first. |
| pass^1, pass^3 | For each kind of contact: the share sorted, and the chance that three such contacts in a row are all sorted (tau-bench's pass^k, unbiased estimate). A product that is right four times in five has pass^3 near one half. |
| Tokens | People-model tokens actually spent; cached answers are free and counted separately. |

Business measures come from the simulator's own accounts: net profit is revenue less refunds, cost of goods, card fees, delivery, goodwill, packaging, staff pay, overtime, fixed costs and marketing. Customer satisfaction is 1 to 5 per contact, from how it ended and how long it took (`simulation/simulator/README.md`).

## What went wrong, and security

After the run, code checks every conversation the product had, from the records and the product's own calls and words (`observability/report/checks.ts`): not sorted by the records, a change nobody asked for, saying it did something no call did (a refund, a cancellation, a replacement, a case), money out with no return, problem report or cancellation behind it, acting on the wrong order, telling one customer another's details, obeying an instruction hidden in a message (each injection carries a unique token; seeing it in a reply means the product obeyed), repeating its own instructions, giving money under pressure, trying something the rules forbid, the same reply twice in a row, crashing. Each failure in `results.json` has the persona, the whole conversation, every tool call, why it failed and a link into the apps. Each security attempt is reported as held, held only by the shop's rules (the product tried and the engine refused) or broke.

The checks only find what they look for. Read the conversations too.

## Other audiences, access levels, comparing, watching live

- **Who the product meets.** `audience` in the adapter (or `--audience`): customers (above), staff, businesses, suppliers or the public. How each works, and the persona-panel maths for content: [`audiences.md`](audiences.md). Their results are in `results.json` `audiences`.
- **Access.** `access: 'read_only'` (or `full`, `reply_only`, `no_money`, or an exact `scope`) in the adapter, `--access`, or `adapter.ts@read_only`.
- **Compare.** `overthink run --compare <A> <B>`: two products, two versions (`adapter.ts#v2`) or two access levels, on the same seeds and people. `compare.json` (`overthink.compare/1`) holds each variant's measures against the business without it and, per measure, the paired difference B − A per seed with a 95% bootstrap interval and the seeds where B came out better. No verdict: which matters more is the developer's call.
- **Live.** Every run writes `live.jsonl`; `--live` also serves it as server-sent events, with the front door, at `http://127.0.0.1:8741/` (`--live-port`). The event schema: [`live-events.md`](live-events.md).
- **Reset.** `overthink reset` deletes the project's cache and the run folder (asks first; `--yes` to skip).

## Looking over its shoulder: `overthink view`

`overthink run` saves each seed's world at the end of both arms (`<out>/view/seed-N.json.gz`, about 150 KB each: only what changed from the fresh world). `overthink view --run <out>` serves the company's own apps on them at `http://127.0.0.1:8740`, read-only:

- the first screen is Rummage, the company's search engine: search every tool, and the "Your AI" tab lists what the product did, with a panel of its effect (money, customers, what went wrong). The run in brief is still at `/apps/view/` and the report at `/report`;
- every record the product created, changed or wrote carries a "Your AI" badge: the emails it sent (Letterbox), its website chats and the contacts it answered (Front Desk), the cases, returns, refunds and orders its calls changed. Marks come only from its own trace and its own words;
- the bar at the bottom switches run and arm: "Without your AI" is the same moment in the twin;
- nothing can change the world: changes are refused at the door, the store runs only reading tools, and a test checks the world is byte for byte the same after every tool has been tried;
- for a coding agent: `overthink view --json <record id> [--seed N] [--arm without]` prints one record, `GET /view/record/<id>` does the same over HTTP, and `/mcp?key=<key printed at start>` is a read-only MCP endpoint over the world.

## Reproducing a result

`results.json` records the seeds, the population seed, a hash of the world files, the people model and where it ran, the adapter's version, Overthink's version and Node's. With the same adapter version and the cache folder (`.overthink/cache`), a rerun gives the same customer words and the same figures. Hosted models treat `seed` as best effort, so the cache, not the seed, is what makes reruns exact.

## Sizes and cost

`--size demo` (default) is a small shop: a few contacts a day, seconds per run with rules. `--size standard` is busier. With a model, cost grows with contacts times turns: one call writes each customer's first message and one more reads each reply, with prompts of a few hundred tokens. Check `tokens` in `results.json` after a small run before a big one. Start with `--days 7 --runs 3`, read the conversations, then scale up. `--max-tokens` stops the run cleanly before it passes the cap.

## Limits

- Simulated customers, not real ones. Results are evidence about this simulated shop, not forecasts for yours. Check with real users.
- One business today: a small UK online shop. Jobs: `customer-service` (fully played out), `operations` and `sales` (one turn per day's work, judged from records).
- During the run, the email or chat record inside the business keeps the rules-written first message; the product sees the persona's words. At the end, the saved worlds are rewritten with the words actually said, so `overthink view` shows them.
- Staff in the arm without the product handle every situation the same way: a hard persona makes the product's arm harder, not the staff's. Read differences on hard situations with that in mind.
- Social contacts (Mutter and Squint messages and mentions) keep the rules-written first message in the saved worlds; the product saw the persona's words.
- Parcel delays for a few records depend on record numbers rather than the seed; the two runs can drift slightly apart late in a long run. A contact that happened in only one run is shown with an empty side.
