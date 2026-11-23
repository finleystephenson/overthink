# The wider world

Overthought & Co. does not trade alone. Around it are rival shops that make their own decisions, partners and institutions, an economy, fashions, what people say about the shop, and the people themselves. This page says what exists, how it works, every assumption, and how the lab changes it.

Everything here is simulated. Results are evidence about this world, never forecasts of the real one. Every organisation is invented; none is, or imitates, a real company or public body.

## What exists

| Part | Files | What it does |
|---|---|---|
| Organisations | `business/data/organisations.json`, `simulation/world/organisations.mjs` | 8 rival shops, 5 partners, 7 institutions, limits on the shop's 11 suppliers, and a list of possible world developments. |
| Competitors | `simulation/world/competitors.mjs` | Every Monday each rival may start a sale, follow a price cut, launch a cheaper alternative or advertise. Their moves change Overthought's demand per category, make the news and appear as their own posts on Mutter. |
| Economy | `business/data/economy.json`, `simulation/world/economy.mjs` | Monthly inflation, consumer confidence, unemployment, Bank Rate and pay growth. They change demand, costs and how strongly shoppers react to price, with lags. |
| Trends and opinion | `simulation/world/trends.mjs` | Weekly interest per product category, with the odd viral spike; daily brand sentiment from the shop's own reviews, complaints and customer posts. |
| Suppliers | `simulation/world/suppliers.mjs` | Each supplier's capacity and occasional disruptions, which move new purchase orders' due dates. |
| Developments | `simulation/world/developments.mjs` | New rules, new technology, the labour market, council works. |
| People | `world/population*.mjs`, `simulation/world/people.js` | Real-world circumstances for every customer (see "People" below). |
| Simulator plug-ins | `simulation/world/plugins.mjs` | `worldPlugins({ products })`: seven plug-ins, loaded by `simulation/simulator/plugins.mjs` under the name `world`. |
| Engine extension | `simulation/world/extension.js` | Record lists and tools (below). |
| History | `simulation/world/build-history.mjs` | Five years of the above, written beside a world's other files. |
| Tests | `simulation/world/world.test.mjs` | Determinism, twin fairness, effects, news, posts, lenses. |

## How each part works, and why

### Competitors

Each rival has categories it sells in (the shop's own: everyday, food, tech, carry, desk-home, outdoors), a price position (how its normal prices compare with Overthought's), an advertising budget, a strategy and rules:

| Rival | Strategy | Main rules |
|---|---|---|
| Thriftwhistle | undercutter | follows Overthought's cuts within 5 to 12 days (75%); Black Friday and January sales |
| The Gilded Pebble | premium | never discounts; raises prices most springs; advertises before Christmas |
| Lookalike Lane | copycat | after an Overthought launch in its categories, 35% chance of a cheaper copy; otherwise about one copy a year |
| Bargain Barrow | seasonal discounter | deep January, summer, Black Friday and Christmas sales with advertising bursts |
| Hamper & Hare | seasonal premium | small Christmas offer, heavy Christmas advertising |
| Gadgetry Goose | advertiser | frequent advertising pushes; follows big tech cuts sometimes |
| The Wandering Satchel Co. | seasonal | spring sale, summer advertising |
| The Sensible Drawer | follower | follows cuts slowly; advertises when desk and home things are in fashion |

**Decisions.** On Mondays, in a fixed order. Every chance uses `rngFor(seed, purpose, ...business keys)`: a seasonal sale is keyed by year, season and rival (one decision per season); a follow by rival, category and the date of the price change it reacts to; adverts and launches by date and rival. "Overthought cut its prices" means its average price in a category fell more than 3% over the last 14 days (from `price_history` and the catalogue). A launch is a product made active by `launch_product` in the last 28 days.

**Demand effect: an attraction (share) model per category,** the multinomial-logit form used in marketing science:

- a rival's attraction = weight × exp(−2.5 × (price factor − 1)) × advert factor^0.3, plus any cheaper copy it launched;
- Overthought's share = its weight (1) ÷ (its weight + every rival's attraction + 1.5 for people who buy nothing of the kind);
- Overthought's multiplier = its share today ÷ its share with every rival at normal prices and advertising.

So a rival with weight 0.55 cutting 30% takes about 7% of Overthought's demand in that category. Overthought's own price is held at normal inside this model because the simulator already applies its own price elasticity; counting it twice would exaggerate every price change. Multipliers are clamped to 0.3 to 2.

**Assumptions:** the weights, price sensitivity 2.5 and advert power 0.3 are judgement, chosen so a big rival sale moves a category by 5 to 10%, which seems plausible for a niche gift shop. Copy launches add 0.15 weight at 20% cheaper for 180 days.

**Records and news.** Moves go into `competitor_moves`, each with a plain headline, story and (world lens only) the reason. Notable ones (not adverts) are published in `news`, section "Business", on the day they start. Each move also appears as the rival's own post on Mutter (`social_posts`, author kind `organisation`).

### Economy

Monthly rows (`economy`), published on the 15th. Each figure follows `next = now + reversion × (long-run − now) + noise`, with noise from `rngFor(seed, "economy", month, figure)`. Confidence's long-run level rises by 1.5 points for each point pay grows faster than prices. Bank Rate moves 0.25 at a time, only in decision months, towards 3.0 + (inflation − 2) − 0.5 × (unemployment − 4.5), and only 60% of the time (central banks move slowly). Each month's figures make the news, section "Money".

**Starting values (all assumptions, written from memory of recent UK figures, not checked):**

| Figure | Start | Check against |
|---|---|---|
| CPI inflation | 2.8% | ONS, consumer price inflation |
| Consumer confidence | −19 | GfK Consumer Confidence Index |
| Unemployment | 5.2% | ONS, labour market overview |
| Bank Rate | 3.5% | Bank of England, Bank Rate history |
| Pay growth | 3.6% | ONS, average weekly earnings (regular pay) |

The five-year history passes through yearly anchors (also assumptions, in `business/data/economy.json`: inflation peaking near 11% in late 2022, Bank Rate 5.25% in late 2023, and so on) along a seeded wobbly line that ends exactly at the starting values.

**Effects, each measured against the starting values, so an unchanged economy changes nothing:**

| From | To | Lag | Size (assumption) |
|---|---|---|---|
| Consumer confidence | `demand.all` | 1 month | 0.3% per point, within ±10% |
| Inflation | `costs.goods`, `costs.carrier` | 2 months | half (goods) and 60% (carrier) of the excess inflation passed on |
| Unemployment, Bank Rate | `price_sensitivity` | 1 month | +4% per unemployment point, +3% per rate point, within 0.85 to 1.3 |

Pay growth acts only through confidence. Staff pay is not one of the simulator's plug-in keys, so the economy does not change the shop's own wage bill (see "Not done").

### Trends and opinion

**Trends** (`trends`, one row per category each Monday): interest = 100 × exp(level + spike). The level is a seeded walk that drifts back to normal (15% a week, noise 0.06). With a 1% weekly chance per category something goes viral: the spike adds 0.45 to 0.95 and fades by 40% a week; a new spike cannot start while one is still big. A spike to 150 or more makes the news, section "Trends". Demand in the category is multiplied by (interest / 100)^0.4, within 0.7 to 1.6. These numbers are assumptions chosen so interest usually stays within 80 to 125.

**Opinion** (`opinion`, one row a day): sentiment from −1 to 1 from the last 30 days of the shop's own records: 50% review ratings against a normal 4.25 (needs 3 reviews), 30% complaints per order against a normal 2.5% (with a prior of 40 normal orders, needs 30 orders), 20% customer posts on social media scored by a small word list. Normals are near the five-year history. It changes website visits by 5% per point, so at most ±5%. It is read only from records, so it changes only because of what happened.

### Suppliers

Limits on the world's existing suppliers, keyed by id in `business/data/organisations.json` (`supplier_constraints`); the world's `suppliers.json` is not changed.

- **Capacity** (`capacity_multiple`): how many of the shop's usual-sized orders (median of its last ten from that supplier) the supplier can make in a week. A bigger order takes an extra week per extra week's worth. Measured in usual orders, not units, because the same world runs at different sizes.
- **Disruptions** (`disruptions_per_year`): each Monday a seeded chance of trouble for 7 to 21 days (its reason is in the data, such as "two knitting machines are waiting for parts"). Capacity halves and new orders take 1 to `lead_time_spread_days` extra days. Recorded in `supplier_disruptions`, published as local news.
- Each new purchase order is checked once, at the end of the day it was raised. If it is delayed, its `due_at` moves and `world_delay: { days, because }` says why.
- `minimum_order_value` is shown for information only; the engine already enforces `min_order_qty`.

### Suppliers that write back

`simulation/world/supplier-side.mjs` (plug-in `world-supplier-side`), data in `business/data/supplier-side.json`, records and tools in `infrastructure/engine/suppliers-comms.js`. Each supplier has a contact person (a storybook character who is not a customer, for example Mrs Glegg at Beckside Mill, Mr Otter at Riverstone Goods) with an address at the supplier's made-up domain, and a tone (warm, brisk, formal, plain). On working days, by rules only:

- **Delay warnings.** When a disruption starts (natural or set), open orders raised before it and due while it lasts move by its extra days, and the contact writes to say why.
- **New orders.** An order made later by capacity, or (at most once a quarter) under the minimum order value, gets a query; others get a confirmation only if the comms plug-in has not written one.
- **Replies to the shop.** Any email sent with `send_email` to a supplier address gets an answer on the next working day: lead times (with any disruption), and yes or no to bringing an order forward (needs a lead time over a day, no disruption, and the shop's open orders under 75% of a week's capacity; saves up to `expedite_share` of the lead time), a volume discount (orders of at least `volume_multiple` usual orders), or a new quantity (within `change_window_days`, at or above the minimum, within capacity). Unclear emails get a question back; a plain thank-you gets no reply.
- **Memory.** Standing = −1 per rude email and per bill paid late (180 days), −0.5 per agreed change beyond 3 in 90 days, +0.25 per polite email (at most +1). At −1 or below: replies take two working days and offers are halved. At −2 or below: no changes at all, with the reasons named.
- Agreed changes go through `amendPurchaseOrder` (also the world-lens tool `apply_supplier_change`): `due_at` (or `expected_at` if late), line `unit_cost`, line `qty`, written to `purchase_orders[].amendments` and the audit. Every decision is a `supplier_requests` record (`list_supplier_requests`); contacts via `list_supplier_contacts`; `get_supplier_standing` (world lens) explains the memory.
- A connected AI as `buyer` is sent each day's unread supplier mail (`sim.kind` `supplier_mail`). Example: `simulation/simulator/examples/simple-supplier-mail.mjs`. Ready job: `supplier-mail`. Lab intervention: `supplier_email` (polite, plain or rude request).

**Limits.** All numbers are assumptions. A discount lowers the bill (cash), not cost of goods in profit (the engine uses the catalogue cost). Nothing in the simulated business pays a bill late by itself, so late payment counts only when records show one. No switching suppliers.

### Developments

Listed in `business/data/organisations.json` (`developments`), each with its institution, chance a year, length, news and effects in the simulator's own keys. Each may happen on a Monday, at most once every three years. All sizes are small assumptions:

| Development | Kind | Effect |
|---|---|---|
| Longer returns window (Fair Shopping Board) | regulation | demand +1%, contacts +4% |
| New food labels (Fair Shopping Board) | regulation | food demand −1%, goods cost +0.3% |
| Parcel lockers (Swiftway Parcels) | technology | carrier cost −3%, contacts −2% |
| Pay-by-bank (Pennywise Pay) | technology | card fees −10% |
| Same-day delivery at The Great Bazaar | technology | demand −1%, contacts +3% |
| Warehouse staff shortage (Guild of Small Shopkeepers) | labour market | carrier cost +3% |
| Roadworks by the warehouse (Brookford Town Council) | council | parcels 2 days late, for 14 days |

Recorded in `world_developments`, published as news. The labour-market one acts through carriers' prices because the simulator has no plug-in key for the shop's own pay.

### Organisations

Partners: Swiftway Parcels and Coldline Couriers (the carriers the business already uses), Pennywise Pay (payments), The Great Bazaar (marketplace), Shoutabout (ad network). Institutions: The Fair Shopping Board (consumer regulator), Thrift & Penny Bank, The Counting House (central bank), The Office for Plain Figures (statistics), The Guild of Small Shopkeepers (trade body), Brookford Town Council, The Daily Overthinker (newspaper).

## Fairness between the live world and its shadow

Every chance is drawn from `rngFor(seed, purpose, ...keys)` keyed by business facts (date, month, organisation, category, the price change reacted to), never by a running count. Plug-ins read only the state and `world_settings`. So a live world and its shadow twin, given the same plug-ins and no actions, stay identical record for record (tested in `simulation/world/world.test.mjs`). If the live business cuts a price, a rival may follow in the live world only: that is a real consequence of the action, and it shows in the impact.

## "Why"

Every plug-in's `modifiers()` returns a `why` list: `[{ source, effect, size, because }]`, for example
`{ source: "competitors", effect: "Demand for small gadgets down 7%", size: 0.935, because: "Lookalike Lane has a cheaper alternative on sale. Some shoppers who would have bought from Overthought buy from them instead." }`.
`simulation/simulator/core.mjs` `combineModifiers` collects them, and each day's timeline line carries them as `line.why` (only when there are any). Sources: `economy`, `trends`, `opinion`, `competitors`, `suppliers`, `developments`, `consumers`.

## `world_settings`: how the lab changes the wider world

`state.world_settings` is a plain object, read by the plug-ins every day and saved with snapshots. It is the only way to change the wider world besides engine tools. Every list is optional; `from` and `to` are dates (YYYY-MM-DD), both optional and inclusive. `set_world_settings` (world lens) checks the shape.

```json
{
  "economy_shocks": [
    { "from": "2026-12-01", "to": "2027-02-28",
      "confidence_shift": -10, "inflation_shift": 2, "unemployment_shift": 1, "bank_rate_shift": 0.5, "wage_growth_shift": 0 }
  ],
  "competitor_moves": [
    { "competitor": "thriftwhistle", "from": "2026-12-01", "to": "2027-01-31",
      "price_factor": 0.8, "categories": ["everyday"], "ad_factor": 1.5 },
    { "competitor": "lookalike-lane", "from": "2026-12-01", "launch_category": "tech", "price_factor": 0.8, "weight_add": 0.15 }
  ],
  "supplier_disruptions": [
    { "supplier": "SUP-03", "from": "2026-12-01", "to": "2026-12-21", "capacity_factor": 0.5, "extra_lead_days": 7 }
  ],
  "trend_boosts": [
    { "category": "outdoors", "factor": 1.8, "from": "2026-12-01", "to": "2026-12-31" }
  ],
  "consumer_shifts": [
    { "from": "2026-12-01", "price_sensitivity": 1.2, "marketplace_shift": 0.05 }
  ],
  "developments": [
    { "id": "parcel-lockers", "from": "2026-12-01", "to": "2027-12-01" }
  ]
}
```

- **economy_shocks**: shifts added to the figures while active, used at once for the effects (no lag) and shown in that month's published figures. The underlying monthly process is not changed, so effects stop when the shock ends.
- **competitor_moves**: `price_factor` (against the rival's normal prices) and `ad_factor` in `categories` (default: all it sells); or `launch_category` for a cheaper alternative (`price_factor` is then the copy's price, default 0.8). Add `product` (an Overthought product id) to make it a copy of that one product: its effect then lands only on that product, in the same attraction form with the product's own market (copy weight 0.5 against Overthought's 1, outside 1.5; an assumption), so a copy 20% cheaper takes about a quarter of that product's demand (`productCompetition` in simulation/world/competitors.mjs). Recorded once in `competitor_moves` with news and a Mutter post; the setting itself drives the effect, so editing or removing it takes effect the next day.
- **supplier_disruptions**: `capacity_factor` multiplies capacity; `extra_lead_days` are added to new orders raised while it is active.
- **trend_boosts**: `factor` multiplies the category's interest (so 1.8 gives about +26% demand).
- **consumer_shifts**: `price_sensitivity` multiplies the simulator's price elasticity; `marketplace_shift` (0 to 0.9) is the share of buyers now buying on The Great Bazaar instead, so `demand.all` × (1 − shift).
- **developments**: makes a listed development happen (id from `business/data/organisations.json`).

`price_sensitivity` is a new modifier key: `combineModifiers` multiplies it (default 1) and `demand()` in `simulation/simulator/core.mjs` multiplies the price elasticity by it wherever elasticity is used (orders, the rich customers' acceptance, discount lift, campaign visits). At 1 nothing changes.

## Engine tools

Record lists (loaded from the world folder when the files exist, empty otherwise): `organisations`, `competitor_moves`, `economy`, `trends`, `opinion`, `supplier_disruptions`, `world_developments`. When `organisations` is empty the bundled `business/data/organisations.json` is used.

| Tool | Who | What |
|---|---|---|
| `list_organisations` | every role, world | rivals, partners, institutions (optional kind) |
| `get_organisation` | every role, world | one organisation; for a rival, its visible moves and today's prices |
| `list_competitor_moves` | every role, world | rivals' moves that have started, newest first |
| `get_competitor_prices` | every role, world | each rival's prices against Overthought's today, per category, with any sale on |
| `get_economy` | every role, world | published monthly figures and the starting values with their sources |
| `list_trends` | every role, world | interest per category and the latest opinion |
| `list_world_developments` | every role, world | developments that have begun |
| `get_world_settings`, `set_world_settings` | world only | read or replace `world_settings` |

**Two lenses.** Business roles see public knowledge: who the rivals are, what they have visibly done, roughly how their prices compare. They never see a rival's strategy, rules, weights, budget, the reason behind a move, or moves decided but not yet started. The `world` lens sees all of that, plus the economy's effects today and the settings. `world` is an engine lens (`LENSES` in `infrastructure/engine/engine.js`): it can call only tools that name it, so it cannot act in the business, and the server never offers it (its roles come from `business/data/business.json`). `get_person` and `list_people` (simulation/world/people.js) are open to the world lens and, for now, the manager.

## History

`node simulation/world/build-history.mjs <world folder> [--seed 2021] [--from YYYY-MM-DD] [--to YYYY-MM-DD]` runs the same rules over the past (default: the company's founding to the day before `anchor_now`), reading the folder's own reviews, cases, social posts, price changes and daily web figures as they stood on each day. It writes new files only and refuses to overwrite: the record lists above plus `world_news.json` (news items in `news.json`'s shape, ids carrying on after `news.json`'s highest). The engine does not load `world_news.json`; merge it into `news.json` when the world is next rebuilt. The past's purchase orders and social posts are not touched, so past rivals' posts and supplier delays on past orders are not in the history. `business/data/world/demo` and `business/data/world/standard` have these files (seed 2021).

## People

Every customer in Overthought & Co. is a storybook character, and every one now also has a real-world life: an age band, household, income fifth, job status, area, online shopping habit, preferred way to be contacted, and some circumstances (new parent, carer, moving home, keen gardener and so on). These come from UK statistics, not from the story.

**Where it lives.** `simulation/world/population-sources.json` holds the targets and where each came from. `node simulation/world/build-population.mjs` writes `business/data/population.json`. `simulation/world/population.mjs` turns traits into behaviour. `node simulation/world/report-population.mjs` writes `simulation/world/population-report.md`.

**Fair by construction.** Traits are dealt out by exact counts (so the whole population matches the targets) from a shuffle that never looks at the character's book, name, kind or author. A villain is no more likely to be poor than a hero. The report measures this (Cramér's V against chance). Only the links between people (same address = household, same street = neighbour, same book and similar age = friend) use the story, because that is what "could know each other" means.

**Behaviour from circumstances only.** Money (income, household) moves price sensitivity; time (job, new baby, caring) moves patience and when people get in touch; online habit moves how often they buy; life events move which product categories they want. Each effect is small, clamped, and written down with its reason in `BEHAVIOUR_ASSUMPTIONS`. `simulation/simulator/customers.mjs` applies it only when `business/data/population.json` exists. A rich customer's category leanings (`c.cats`) now weight which product they pick (`pickProduct` in `simulation/simulator/core.mjs`).

**What is verified.** Only headline figures were confirmed by search (UK population 69.3 million in mid-2024; one-person households 29.5% and lone-parent families 16.1% in 2024; employment rate 75.0% and unemployment 5.0% in Jul-Sep 2025; 87% of adults bought online in 2020, second-hand). The table shares are `approximate`: shaped from memory to land near those, not copied from ONS tables. Circumstance rates are labelled assumptions.

**Fairness checks.** `outcomesByGroup(records, population, groupBy)` gives per-group means, counts and the largest gap, and says "too few to judge" under 30 people in a group.

**World lens.** `get_person` and `list_people` show these hidden traits, to the `world` lens and (for now) the manager.

## Not done

- **Word of mouth along people's ties.** A customer's experience shifting their household, neighbours' and friends' buying needs a per-customer hook in `simulation/simulator/customers.mjs` (plug-ins can only return shop-wide multipliers). Not built.
- **Staff pay from the labour market.** The simulator has no plug-in key for the shop's wage bill; pay growth and the staff-shortage development act through confidence and carriers' prices instead.
- **Contact channel shifts.** `consumer_shifts` moves price sensitivity and buying on the marketplace, not which channel people use to get in touch.
- **Date shifting.** When the live site shifts every date to look current, month labels in `economy` (`"2026-11"`) are not shifted, only full dates.
