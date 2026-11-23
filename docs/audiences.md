# Audiences: who a product meets

A product is pointed at one audience per run. The adapter says which (`audience`) and where it is deployed (`channels`); `overthink init` asks both. The audience decides the job (the product's role and tools) unless `--job` says otherwise. Code: `activity-generation/people/audiences.ts`, `simulation/twin-run/audience-work.ts`.

| Audience | Who they are | Channels | Job (role) | What they do back |
| --- | --- | --- | --- | --- |
| `customers` | People who buy from the shop and write in | `web_chat`, `email`, `phone`, `text`, `mutter_dm`, `squint_dm`, `mutter_mention` | `customer-service` (assistant) | A whole conversation; satisfied, gave up, or left (`docs/run.md`) |
| `staff` | The team: role, workload, way of working | `internal` | `internal-tool` (each request runs in the asker's own role) | Use it when it helps their work; feedback; minutes saved or lost |
| `businesses` | Prospect companies, each with a buyer | `outreach` | `sales` (marketing) | Ignore, reply, ask, meet, buy, unsubscribe, complain |
| `suppliers` | The shop's suppliers | `supplier_mail` | `operations` (operations assistant) | Agree, refuse or answer (`simulation/world/supplier-side.mjs`) |
| `public` | People who read posts, newsletters, product pages | `publishing` | `content` (marketing) | Ignore, like, reply, share, visit, buy, unsubscribe, complain |

Behaviour never comes from identity. Every brief holds circumstances (money, time, how someone shops, what is going on in their life, a company's needs and budget) and nothing about who they are. Names are never sent to the people model; tests change every name and check nothing else changes.

## Customers

As in `docs/run.md`. Since 23 Nov a share of contacts (8%, `business/data/sim.json` `contacts.social`, an assumption) arrives as private messages on Mutter or Squint, or as public Mutter posts that tag the shop. They are drawn from their own random stream, so every other draw is unchanged and the twins stay paired. Mutter and Squint show them where they came in; staff answer them like chats, checking the social inboxes about hourly.

## Staff

On each working day, a member of staff with work the tool could help with asks it, in their own role and so with only their own tools: a support agent asks which contacts are still waiting; the manager asks for the day in a few lines; finance asks for today's refunds; the buyer asks what is running low; the warehouse asks what is waiting to be packed; marketing asks how the posts did (`activity-generation/people/staff.ts`).

Code measures each use from the calls and the reply, never from what anyone says:

- **worked**: the answer used one of the records the request needs (for example `list_contacts`), has some substance (8 words or more), and changed nothing nobody asked it to change;
- **minutes saved** = (minutes the task takes by hand, if it worked) − reading time (200 words a minute) − checking time (3 minutes for careful staff, 1.5 for practical ones) − 10 minutes to undo an unasked change. A failed answer costs its reading and checking, since the work is then done by hand anyway;
- **share of workload**: minutes saved over that person's working minutes on the same day in the twin without the product (their fixed minutes plus the contacts they handled; their contracted day when no work was recorded).

At the end of the arm each person gives feedback: what worked, what did not, and whether they would use it again. With a model they say it in their own words; code holds it to the measurements (no praise for a tool that never worked, no "would use again" for one that cost them time). With `--rules` the lines are written from the measurements.

## Businesses

The simulator sends the day's prospecting to the product (`list_prospects`, `send_outreach`). Each prospect has a buyer (`buyerPersona`): its needs, monthly budget, preferred contact, patience (1 to 3 contacts, from how readily it answers mail) and whether it would switch supplier now (half of them, by a hash of the prospect). With a model the buyer reads the message and decides; code holds the decision to what is possible (`clampBuyer`):

- **buy** needs a buyer who would switch, a message or offer naming something they need, and an offer within their monthly budget; otherwise it becomes a reply, a question or a meeting request;
- **complain** needs more contacts than their patience; otherwise it becomes ignore.

The simulator plays the decision out (`simulation/simulator/core.mjs` `outreachJudge`): a buy becomes a customer with standing orders, ignore is silence, unsubscribe and complain close the door. The outreach and any reply are written into the sales mailbox (Letterbox). Without a model, the simulator's own rules decide, as before. Staff outreach is always scored by the rules.

## Suppliers

With the `suppliers` audience the wider world's supplier plug-ins run in both arms: suppliers query orders, warn of delays and answer the shop's email by their capacity, terms and how they have been treated (`simulation/world/supplier-side.mjs`). Supplier mail goes to the product when it is deployed on `supplier_mail`; each supplier's decision about what the product wrote is in `results.json` `audiences.suppliers`.

## The public: persona panels

Once a day the product may publish: a Mutter or Squint post (`create_social_post`), a newsletter (`send_email` to three or more customers), or a product page (`update_product_page`, shown in Till). Each new item is read by a **panel** (`activity-generation/people/panel.ts`).

1. **Who sees it is decided by code**, exactly as without a panel: the audience rules (`simulation/simulator/audience.mjs`) plan a post's reach from followers, timing, length, fatigue and luck; a newsletter's readers are its opens; a product page's views are a week of its ordinary traffic.
2. **A panel reads it.** N people (default 40, `--panel`) are drawn across the population, stratified by income fifth and how often they shop online so every circumstance is there in proportion, by a hash of the seed and the kind of content (the same panel in every arm and rerun). A newsletter's panel is drawn from the customers it went to. Each member reads the item as they would meet it (in their feed, their inbox, on the page) through the developer's model and makes one decision.
3. **Code holds each decision to the content**: no unsubscribing from a post, no buying from a post that names no product (it counts as a visit), a reply needs words.
4. **Code turns decisions into rates**, shrunk toward the rules' rates (the prior) and bounded:

   r_d = (n_d + k × prior_d) / (N + k), then clamped to [prior_d / 5, prior_d × 5]

   with n_d the members who chose d and k = 40. The prior is what the rules expect of ordinary content (likes, replies, shares and visits per person reached on each network; clicks, orders and unsubscribes per opened email; the shop's conversion per page view). The bound says content can do at most five times better or worse than ordinary on any one action: an assumption, there because a model-played panel can be unanimous in a way no real audience is.
5. **Code scales them**: expected count = reach × r_d (a buyer also counts as a visit). These replace the rules' figures on the record, and the audience plug-in plays them out over the following days as demand, like any post. A rewritten product page changes orders by views × (r_buy − conversion): negative when the new page sells less.
6. **Replies become records**: a panel member who replies or complains gets a comment on the post (Mutter, Squint) or an email to hello@ (newsletters), in their own words.

**Why 40.** After shrinkage the standard error of a rate is √(N·p(1−p)) / (N + k). For a 25% rate:

| N (panel) | Calls per item | Standard error | One member changing their mind moves a rate by | Weight of the panel against the prior |
| --- | --- | --- | --- | --- |
| 10 | 10 | 2.7 points | 2.0 points | 0.20 |
| 20 | 20 | 3.2 points | 1.7 points | 0.33 |
| **40** | **40** | **3.4 points** | **1.25 points** | **0.50** |
| 80 | 80 | 3.2 points | 0.8 points | 0.67 |

At 40 the panel and the rules weigh the same, one odd answer from a small local model moves nothing much, and an item costs 40 short calls (about 150 output tokens each). Raise it for a final comparison; lower it for a quick look.

**Cached by content.** Every call is cached by a hash of the brief and the words read, so the same post read by the same panel costs nothing the second time, both arms and every rerun share reactions, and two members with exactly the same circumstances share an answer.

**`--rules`.** Without a model the audience rules plan the response as they always have (`simulation/simulator/audience.mjs`, labelled `rules` in `results.json`). Product pages have no rules plan, so they change nothing under `--rules`.

## Access levels

`access` in the adapter (or `@level` after it on the command line) sets what the product may read and act on: `full` (the job's role), `read_only`, `reply_only` (messages only), `no_money` (no refunds, goodwill or books), or an exact `scope`. `overthink run --compare A B` runs two products, versions or access levels on the same seeds and people and reports each one's results and the paired differences (B − A per seed, with a bootstrap interval). Facts only.

## Limits

- Model-played people are not real people; panels are evidence about this simulated audience, not a forecast.
- In the arm without the product, staff do the same work the same way; the comparison is the product against the shop as it is.
- A buyer decision by the model is compared with staff outreach scored by rules.
- Panel replies are written on the item's day, at the time the panel read it.
