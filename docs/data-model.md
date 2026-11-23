# Data model and business engine

This page explains how Overthought & Co.'s information is stored, how the records link, and the one piece of code (the engine) that reads and changes them. You do not need to read code to follow it.

## Where things live

| What | Where | Notes |
|---|---|---|
| Company rules, numbers and roles | `business/data/business.json` | The source of every rule. Change a number here and everything follows. |
| Products, variants, accessories | `business/data/products/<id>.json` | The catalogue. Prices come only from here. |
| Services | `business/data/services/<id>.json` | Hidden on the site for now. |
| Policies (for customers) | `business/data/policies/<id>.md` | Written documents. |
| Procedures (for staff) | `business/data/procedures/<id>.md` | Written documents. |
| Help centre | `business/data/help.json` | Short questions and answers. |
| The generated company | `business/data/world/<size>/` | Five years of records. Built by our own code. |
| The website's copy | `business/data/seed/` | The demo world's customer-side records, in the shapes the site reads. |

Nothing is typed twice. The website, the AI tools and the tests all read the same files.

## The generated company

"Now" is Monday 23 November 2026, 10:00 (`sim.anchor_now` in business.json). The first order was taken on 22 November 2021. Five years means every warranty length (12, 24 and 60 months) has both expired and live cases.

Each size is a **scale** of one business. Scale 1 is the business `business/data/sim.json` and `business/data/staff.json` describe: about 42 orders a day in November 2026 (`demand.base_orders_per_day`), the full team of 11. History grows along an S-curve from a few orders a week at launch to exactly that size at "now", with the seasons and weekday pattern from `business/data/sim.json`, so the last weeks of history and the first weeks of a simulation are the same business. `company.json` records `scale`, `orders_per_day_now`, `staffing_now` (the team on the last day, hours times scale) and `staffing_by_month`.

| Size | Scale | Customers | Orders | Files | Use |
|---|---|---|---|---|---|
| `demo` | 0.02 | about 425 | about 700 | about 4.6 MB | Runs in a web browser. Keeps only the last 92 days of mail, chat and social. |
| `standard` | 0.2 | about 4,350 | about 7,300 | about 43 MB | The everyday test company. Builds in about 2 seconds. |
| `large` | 1 | about 21,000 | about 36,600 | about 175 MB | The full-size business. Built on request, not kept. |

The default world is an ordinary business: **no planted stories**. Late parcels, mix-ups and complaints come only from the normal rates. The hand-written stories are an option (`--stories`) for the benchmark; story worlds are written to `business/data/world-bench/<size>/`.

### How to rebuild it

```bash
node business/builder/build-world.mjs --size demo                 # business/data/world/demo
node business/builder/build-world.mjs --size standard --seed 1    # business/data/world/standard
node business/builder/build-world.mjs --size demo --stories       # business/data/world-bench/demo (add --write-seed to rewrite business/data/seed/; the finished shop keeps its own)
node business/builder/build-world.mjs --size standard --stories   # business/data/world-bench/standard
node business/builder/build-world.mjs --scale 0.5 --out /tmp/w    # any scale, any folder (never touches business/data/seed)
node business/builder/build-world.mjs --size standard --no-events # without world events, for comparison
node business/builder/validate.mjs --size standard                # proves it all adds up (--bench for business/data/world-bench, --dir for any folder)
```

### How it is made

The code is in `business/builder/build-world.mjs` and small modules in `business/builder/world/`:

| Module | What it does |
|---|---|
| `calendar.mjs` | Dates, working days, and how busy each day is: the S-curve of growth, with seasons and weekdays read from `business/data/sim.json`. |
| `catalogue.mjs` | Loads products. Holds the launch date of each product, the one price rise (April 2024), unit costs and the suppliers. |
| `customers.mjs` | Each day a Poisson number of shoppers arrive (expected orders for the scale, times campaigns and events); each is a returning customer or a new one. Builds sensible baskets. Staff never appear as customers. |
| `effects.mjs` | What world events do on a given day and in a given town (cached wrapper round `infrastructure/engine/events-core.js`). |
| `review-lines.mjs` | The bank of review sentences, by product, mood and kind of customer. |
| `simulate.mjs` | Runs the five years day by day. Orders take stock. Low stock raises purchase orders. Deliveries arrive after the supplier's lead time, sometimes late. Empty shelves lose sales. |
| `aftersales.mjs` | Turns the plans into records as they stand "now": shipments, returns, registrations, repairs, contacts, cases, conversations, reviews. |
| `money.mjs` | The ledger and the monthly summary. Wages, premises and software the way the simulator works them out. |
| `marketing.mjs` | Campaigns and daily website visits. |
| `documents.mjs` | Internal documents and the company description. |
| `stories.mjs` | The hand-written planted stories, laid over the world only with `--stories`. |
| `events.mjs` | World events and news for the history (from `business/data/events/library.json`; see `docs/events.md`). |
| `comms.mjs` | Mail, chat and social posts derived from the finished records (see `docs/comms.md`). |

Every rate is a named constant with a one-line reason, at the top of its module. The main ones: returns about 6%, faulty items about 1.5% of orders, late parcels 3%, lost parcels 0.4%, failed payments 2%, contacts 0.25 per order, tech repairs 4% over a product's life.

Costs are worked out the way the simulator works them out, from `business/data/staff.json` and `business/data/costs.json`, times scale. Wages: the pay of whoever was employed that month (hours times hourly pay, plus `on_cost_rate`). People join in the order `business/data/history/staff-history.json` gives, on the first Monday the orders need them; while the shop is small, everyone works fewer hours than their full-size role (hours follow the orders, with 15% slack). Premises (rent, utilities and insurance, booked as `rent`) and software grow with the hours worked. Marketing is the named campaigns plus one always-on campaign a month (`always_on: true`) that brings each month up to `marketing_per_month` (times scale and the size of the business). Wages are paid on the 28th; in the month still running at "now" the wages earned so far are accrued, so that month's profit is honest. The founder's opening cash is whatever keeps the bank balance above zero. Nothing is tuned to a target profit: the shop loses money for its first two years and makes about 8 to 11% now.

World events (`business/data/events/library.json`) shape the history: `demand.all` moves how many shoppers arrive each day, `demand.products` and `demand.categories` move what they pick (in their own town for regional events), `carrier_delay_days` makes parcels later, `contact_rate` makes more people get in touch, `supplier_late_chance` makes purchase orders later. A regional event with a `reach` also moves demand everywhere at that smaller strength (people read about it in the news); `activeEffects` applies it, for history and the live plug-in alike. Events about a product (named in their story, or whose demand effects name only products not yet on sale) never happen before that product's launch. The base late-parcel rate is one number, `LATE_RATE` in `infrastructure/engine/engine.js`, shared by the engine and the generator. `visits` and `costs.*` are not applied to history (the website visits and the ledger's fees are worked out from orders).

### Customer types

Each generated customer has habits. Most buy once as a gift. A third come back regularly. A few return a lot. A few complain often. About one in a hundred is an office that orders sandwiches every Monday. The type is not stored on the customer; it shows in their records.

### Planted stories (only with `--stories`)

About 30 hand-written edge cases can be laid over the generated world, with the same customer ids and record numbers in every size. They are for the benchmark (`examples/benchmark/scenarios/`, `examples/benchmark/`) and the server's situations; they are not in the default world. `business/data/world-bench/<size>/STORIES.md` lists them with their record numbers. Among them:

- Blip's supplier is late. Six paid orders wait for the stock.
- A stock count found 4 fewer Biscuit Tins than the system says. Nobody has adjusted it.
- A staff price list marked current says the Daypack is £119. The catalogue says £129.
- One return was refunded twice. The ledger shows both refunds; the order shows one.
- An office's Monday sandwich email on 16 November was read but never turned into an order.
- One delivery of Boombox Minis produces far more "will not charge" repairs than the rest.

The four booking stories (15, 16, 17, 29) are left out while services are hidden, so `bookings` is empty.

## Records and how they link

```
customer ─┬─< order ─< item >── SKU >── product
          │     └─< shipment
          ├─< return >── order
          ├─< registration >── order
          ├─< repair >── order, registration, batch (purchase order)
          ├─< case >── order / return / repair
          ├─< conversation >── case
          ├─< contact >── case
          └─< review >── order, product

supplier ─< purchase order ─< line >── SKU
SKU ─< stock movement >── order / purchase order / return / stock count
stock count >── SKU
ledger entry >── order / return / purchase order / campaign / case
monthly summary = the ledger, added up by month
campaign ── discount code ──< order
```

### ID formats

("Planted" in the next rows means the hand-written story records that exist only in a `--stories` world. The default world has none: its numbers start at the generated ranges.)

| Record | Example | Notes |
|---|---|---|
| Customer | `C-1001` | Planted customers are C-1001 to C-1036; generated ones follow. |
| Order | `ORD-10001` | Generated orders count up from 10001. Planted orders keep ORD-20101 to ORD-20188, so they are not in date order with the rest. |
| Shipment | `SHP-10001-1` | Order number, then parcel number. |
| Return | `RET-3001` | Planted from 3001, generated from 3101. |
| Registration | `REG-6001` | Planted from 6001, generated from 6101. |
| Repair | `FIX-5001` | Planted from 5001, generated from 5101. |
| Case | `CASE-9001` | Planted from 9001, generated from 9101. |
| Conversation | `CONV-8001` | Planted from 8001, generated from 8101. |
| Contact | `CT-00001` | In time order. |
| Supplier | `SUP-01` | |
| Purchase order | `PO-3001` | In the order they were raised. |
| Stock movement | `MV-000001` | In time order. |
| Stock count | `SC-0001` | |
| Ledger entry | `LED-000001` | In time order. |
| Campaign | `CMP-01` | |
| Document | `DOC-01` | |
| Review | `REV-0001` | |
| SKU | `OT-BLIP` | From the product files. |

All times are UTC, written like `2026-11-23T10:00:00Z`. Plain dates look like `2026-12-07`. Money is in pounds, to the penny.

## Each record type

Files are in `business/data/world/<size>/`. The first eight also exist in `business/data/seed/` for the website.

### Customer-side records (same shapes as before)

**customers.json.** One person. Name, email (always `@example.com`), phone (always `07700 900xxx`), addresses, how they like to be contacted, marketing consent, when they joined, account credit and staff notes. Towns and postcode areas (MH, QQ, ZZ, and HI for the two Highlands stories) are invented, so no address is real.

**orders.json.** One order. Items with the price paid at the time, totals (items, delivery, discount, total), payment (status, how it was paid, amount refunded; for pay later the amount due and its date), delivery method and address, shipments and a dated history. Optional: `note` (written by the customer) and `discount_code` (from a campaign). Chilled food always travels in its own parcel. A lost parcel is followed by a replacement parcel, or a refund if there was no stock.

**returns.json.** One return of one or more items. Reason (change of mind, faulty, damaged, wrong item), status, postage taken off (£2.95 for change of mind), refund amount and when it was paid. A refund is never more than the discounted price paid.

**registrations.json.** A product registered for warranty. Serial number, purchase date and the date the warranty ends.

**repairs.json.** A Fix Club repair. Fault, whether it is in warranty, status, any quote, and history. Generated tech repairs also carry `batch`: the purchase order the unit came from.

**cases.json.** A support case. Subject, category, status, complaint stage, related records, who it was escalated to, and dated notes.

**conversations.json.** A chat, email, phone or text exchange, message by message, usually linked to a case.

**bookings.json.** Empty while services are hidden.

### Simulator records

**business/data/staff.json, business/data/costs.json, business/data/sim.json, data/prospects.json** are read by `simulation/simulator/` (see `simulation/simulator/README.md`). Staff: eleven characters with a role, weekly hours, hourly pay and the minutes each task takes. Costs: rent, software, marketing, overtime and on-costs (card fees and carrier costs come from the engine's own ledger lines). `sim.json`: demand, contact rates, satisfaction and reputation settings. `prospects.json` (195 businesses from classic fiction) is copied into every world as `prospects.json`, with an empty `outreach.json` beside it. `business/data/characters.json` holds 3,000+ possible customers: the first 1,010 are the generator's list, in order; the rest carry `source_author` and `source_year` and are used by worlds that need more than the first list (`--size large`) and by the simulator. Rebuild them with `node business/builder/build-characters.mjs` and `node business/builder/build-prospects.mjs`.

### Back-office records (new)

**company.json.** One object. What the company does, each role and what it may do (from business.json, no names), working hours, the kinds of tools staff use, how a normal day runs, and the cash the founder put in. Also `scale`, `orders_per_day_now`, `staffing_now` (id, name, role, joined, weekly hours at this scale, hourly pay), `staffing_by_month` (month, wages, share of full-size hours worked), `stories` and `events` (how the world was built).

**world_events.json, news.json.** World events (`WE-00001`) and the news item each one published on its start day (`NW-00001`, `event` is the world event's id). Events up to a year ahead are already listed as `scheduled`. Shapes in `docs/events.md`.

**emails.json, chat_messages.json, social_posts.json, social_stats_daily.json.** Mail (`EM-000001`), staff chat (`CH-000001`), social posts (`SP-000001`) and daily follower figures, derived from the records. `links` point at real records. Shapes in `docs/comms.md`.

**documents.json** also holds the company history from `business/data/history/` when it exists: "How we got here" (story.md), "Company timeline" (timeline.json) and "Who joined when" (staff-history.json), kind `company history`.

**suppliers.json.** One UK supplier. What it supplies (product ids and SKUs), lead time in days, minimum order per line, unit cost per SKU, payment terms in days, reliability (0 to 1) and notes. The bakery and the ice supplier make to order: they deliver each morning exactly what that day's chilled parcels need.

**purchase_orders.json.** One order to a supplier. Lines (SKU, quantity, unit cost, quantity received), when it was ordered, when it is due, when it arrived, when it was paid, and its status: `ordered`, `late`, `part_received`, `received` or `cancelled`. The engine adds `draft` and `awaiting_approval`. A late order may have `expected_at`, the supplier's new date.

**stock_movements.json.** Every change to stock. Time, SKU, quantity (plus or minus), reason and reference. Reasons: `received` (a purchase order), `sold` (an order), `released` (a cancelled order puts stock back), `returned_to_stock` (a return that passed inspection), `written_off` (a lost parcel's replacement, or goods that failed inspection on arrival), `count_adjustment` (a stock count). Stock on hand is always the sum of the movements.

**stock_counts.json.** A shelf count. SKU, what the system said, what was counted, the difference, whether stock was adjusted, and a note. Most counts match. A few find small losses.

**stock.json.** Stock on hand per SKU at "now", and the restock date for anything that is empty. The engine uses it instead of the `stock` numbers in the product files.

**ledger.json.** Every pound in and out. Each entry has a time, type, signed amount, reference and month. Types:

| Type | Meaning | Cash? |
|---|---|---|
| `sale` | Items sold, after any discount. | Yes |
| `delivery_income` | Delivery charge paid by the customer. | Yes |
| `payment_fee` | Card fee: 1.5% plus 20p. | Yes |
| `cost_of_goods` | What the stock that left cost us. Stock coming back reverses it. | No |
| `delivery_cost` | What the carrier charges us per parcel. | Yes |
| `refund` | Money back to a customer. | Yes |
| `supplier_payment` | Paying a supplier, at the end of their payment terms. Not a cost in profit, because the cost is counted when the goods sell. | Yes |
| `wages`, `rent`, `software` | Monthly fixed costs. | Yes |
| `marketing_spend` | A campaign's spend, on its first day. | Yes |
| `goodwill_credit` | Account credit given to say sorry. | No |
| `correction` | Added by finance through the engine, always with a reason. | Yes |
| `pay_later` | Written only at run time. Money a pay-later customer owes: minus the total when the order is placed, plus when it is paid or taken off. Not profit. | Yes |
| `repair_income` | Written only at run time. A Fix Club assessment fee or repair price. Counts as revenue. | Yes |
| `repair_parts` | Written only at run time. Parts used on a repair (assumed 40% of its price). Counts in cost of goods. | Yes |

**monthly_summary.json.** One row per month, worked out only from the ledger and the orders: revenue, sales, delivery income, refunds, cost of goods, gross margin, each operating cost, profit, orders, new customers, repeat rate, average order value, supplier payments and cash at the month's end.

**campaigns.json.** One campaign. Name, channel (email, search, social or none), dates, spend, visits, orders attributed, and a discount code if it had one.

**web_sessions_daily.json.** One row per day. Visits by channel, product page views by product, baskets started, baskets abandoned, baskets lost because something was out of stock, and orders.

**contacts.json.** Every time someone got in touch. Time, customer (or null for someone who has not bought), channel (web chat, email, phone, text), topic, which role handled it, minutes to first reply, minutes to resolve, outcome and any case.

**documents.json.** Internal documents: guides, notes, price lists, supplier emails and meeting notes. Each has a title, kind, date written, body (markdown) and status (`current` or `out_of_date`). Some are deliberately wrong. Each wrong document lists in `checks` exactly what it contradicts, so the validator can prove it. Four are out of date: an old price list, an old 14-day returns window, a Trophy spec sheet with two sizes and silver, and a supplier email with an old lead time. One marked current is also wrong (the Daypack price).

**price_history.json.** Each price change: SKU, old price, new price, date and reason.

**reviews.json.** Internal product reviews: customer, order, product, rating 1 to 5, short text and date. The website does not show them.

## What the validator proves

`node business/builder/validate.mjs --size <size>` checks:

- every reference points at a real record;
- every price matches the catalogue on the day it was paid;
- stock on hand for each SKU equals the sum of its movements, and never goes below zero;
- every paid order has its sale, delivery income and fee in the ledger, and stock movements for its items;
- refunds in the ledger match each order and never exceed what was paid;
- each month's summary equals the ledger;
- no real-looking personal data: emails end `@example.com` (or a reserved `.example` domain for staff and suppliers), phones are `07700 900xxx`, postcode areas are invented;
- out-of-date documents really do contradict current records;
- the last 28 days of history average within 25% of the simulator's demand formula at the world's scale;
- news items point at real world events; every `links` field in mail, chat and social points at a real record;
- without stories: no story records, no `STORIES.md`, no staff among the customers, no "Test card", no planted findings, repairs and reviews numbered in date order;
- with stories: the planted stock stories hold (Blip and Trophy empty, six orders waiting).

It ends with a one-screen summary: customers, orders, revenue and profit by year, top products, return rate and stockouts. Deliberate mistakes from the stories are listed as "planted findings", not errors. The one planted double refund appears there.

## The engine (`infrastructure/engine/engine.js`)

One plain JavaScript module with no dependencies. The same code runs behind the website (in the browser), behind the AI assistant's tools, and in the tests.

```js
import { loadData } from "./load.js";
import { createWorld } from "./engine.js";
const data = loadData("data", { world: "standard" });   // leave out { world } to use business/data/seed
const world = createWorld({ ...data, now: "2026-11-23T10:00:00Z" });
const session = world.session({ role: "buyer" });
const r = session.call("stock_history", { sku: "OT-BLIP" });
// r is { ok: true, data } or { ok: false, error: { code, message } }
```

### Rules every tool follows

1. **Permission first.** Each tool lists the roles that may use it. Anyone else gets `forbidden`.
2. **Verification.** The customer-facing assistant starts unverified. Customer tools return `not_verified` until `verify_customer` succeeds. After that it can only touch that one customer's records.
3. **Validation.** Inputs and business rules are checked. A broken rule returns a clear code and a plain-English message. Nothing changes on failure.
4. **Audit.** Every call, allowed or not, is written to `state.audit` with what changed.
5. **No outside effects.** No network. No clock except the given `now`. New ids are the next number in sequence.
6. **Money stays inside.** Costs, the ledger, supplier details and other customers' data are never returned to the `customer` or `assistant` roles.

Error codes: `forbidden`, `not_verified`, `not_found`, `invalid_input`, `rule_violation`, `out_of_stock`, `unavailable`, `needs_human`.

### Roles

Roles are described in `business/data/business.json`. None has a person's name.

| Role | Who | In short |
|---|---|---|
| `customer` | A shopper on the website | Their own records only. |
| `assistant` | The customer-facing AI | One verified customer at a time. No back-office tools. |
| `support_agent` | Support team | Refunds up to £100, goodwill up to £15. |
| `support_lead` | Senior support | Refunds up to £1,000, policy exceptions. |
| `technician` | The Fix Club bench | Repairs and quotes. |
| `coordinator` | Bookings | Booking overrides. |
| `warehouse` | Stock and dispatch | Moves orders on, books in deliveries and returns, counts stock. |
| `buyer` | Buys stock | Suppliers and purchase orders. Orders up to £2,000 without approval. |
| `finance` | The books | Reads the ledger and figures. Adds corrections, with a reason. |
| `marketing` | Campaigns and prospects | Reads campaigns and website visits. Lists prospects and contacts them within the outreach rules. |
| `manager` | Runs the company | Reads everything. Approves refunds over £1,000 and purchase orders over £2,000. Moves the clock. |
| `operations_assistant` | Back-office AI | Reads stock, suppliers and purchase orders. Drafts purchase orders for a person to approve. Never sees the ledger or customers' contact details. |

### Tools and who may use them

**Open to everyone.** `search_catalogue`, `get_product`, `compare_products`, `check_compatibility`, `check_stock`, `search_knowledge`, `get_policy`, `get_service`, `check_availability`, `delivery_options`, `payment_methods`. These are about the catalogue, stock levels and rules. None shows costs.

**Customer records.** The customer, the assistant (once verified), support agents and the support lead. The manager can also use the read tools marked with a star.

| Tool | Does |
|---|---|
| `create_customer` | Makes an account (customer, support agent). |
| `place_order` | Places an order (customer only). Pays with `payment: { method, outcome?, card_number? }`; the older `card_number` on its own still means a card. See Ways to pay. |
| `verify_customer` | Checks a reference plus email or postcode. Three failures lock the session. |
| `get_customer`★, `list_orders`★, `get_order`★ | Profile and orders. Never card details. |
| `cancel_order`, `update_order` | Only before the order is packed. |
| `check_return_eligibility`, `create_return` | The 30-day window and its exceptions. |
| `report_problem` | Damaged, missing, wrong or spoiled items, within the assistant's limits. |
| `register_product`, `list_repairs`★, `get_repair`★, `create_repair`, `approve_repair_quote` | Warranty and The Fix Club. |
| `list_bookings`, `get_booking`, `create_booking`, `reschedule_booking`, `cancel_booking` | Services (hidden for now). |
| `list_cases`★, `get_case`★, `open_case`, `add_case_note`, `escalate` | Support cases. `escalate` also works for an unverified person. |

**Staff tools.**

| Tool | Who | Does |
|---|---|---|
| `issue_refund` | support agent (to £100), support lead (to £1,000) | Refunds to the original way of paying. On a pay-later order not yet paid, it takes the amount off what is owed instead. |
| `approve_large_refund` | manager | A refund above the support lead's limit. |
| `add_goodwill_credit` | support agent (to £15), support lead | Account credit. Give `case_number` to tie the cost to the case. |
| `advance_order` | warehouse | Packed, dispatched, delivered. |
| `receive_return` | warehouse | Inspects a return and releases the refund. |
| `adjust_stock` | warehouse | Sets stock, recorded as a stock count with a `count_adjustment` movement. |
| `update_repair` | technician | Repair status and quotes. |
| `override_booking` | coordinator | Changes a booking, skipping the rules. |
| `resolve_case` | support agent, support lead | Closes a case with a note. |

**Back-office tools (new).** None of these is open to `customer` or `assistant`.

| Tool | Who | Does |
|---|---|---|
| `get_company` | all staff and the operations assistant | The company description. |
| `search_documents({ query })`, `get_document({ id })` | all staff and the operations assistant | Internal documents. Some are out of date. |
| `list_suppliers`, `get_supplier({ id })` | buyer, manager, finance, warehouse, operations assistant | Suppliers with lead times and unit costs. |
| `list_purchase_orders({ status?, supplier_id?, sku? })`, `get_purchase_order({ number })` | same | Purchase orders. |
| `stock_history({ sku })` | same | On hand, every movement, counts and open purchase orders. |
| `get_monthly_summary({ month? })` | finance, manager | Monthly figures. |
| `ledger_search({ type?, from?, to?, reference? })` | finance, manager | Ledger entries and their total. |
| `add_ledger_correction({ amount, reference, reason })` | finance, manager | Adds a `correction` entry. Old entries are never edited. |
| `settle_pay_later({ order_number })` | finance, manager | The customer has paid a pay-later order: its payment goes from `due` to `paid`. |
| `list_campaigns`, `web_sessions({ from?, to? })` | marketing, manager, finance | Campaigns and daily visits. |
| `list_contacts({ customer_id? })` | support agent, support lead, manager | Inbound contacts. |
| `list_prospects({ sector?, status?, min_monthly_budget?, limit? })`, `get_prospect({ prospect_id })` | marketing, manager | The prospect market (`prospects.json`): businesses that only buy if approached. The simulator's hidden fields are never shown. |
| `send_outreach({ prospect_id, channel, message, offer? })` | marketing, manager | Contacts a prospect (email, letter, phone, visit) and records it in `outreach`. Refused: within 14 days of the last contact unless they replied, after a no, a discount over 10% (marketing) or 20% (manager), an unknown SKU, a message under 20 characters. |
| `create_purchase_order({ supplier_id, lines, note? })` | buyer, manager, operations assistant | The supplier must supply each SKU, and each line must meet its minimum order. The operations assistant's orders are `draft`. A buyer's order over £2,000 is `awaiting_approval`. |
| `approve_purchase_order({ number })` | buyer (to £2,000), manager | Sends a draft or waiting order to the supplier. |
| `receive_purchase_order({ number, lines? })` | warehouse, buyer, manager | Books in a delivery, with a `received` movement per line. |
| `record_stock_count({ sku, counted_qty, note?, adjust? })` | warehouse, buyer, manager | Records a count and, unless told not to, adjusts stock with a movement. |
| `advance_day` | manager | Moves the clock one day and applies what is due. See "What time does". |
| `check_books` | finance, manager | The health check. See below. |
| `business_snapshot` | finance, manager | Outcome figures. See below. |
| `launch_product({ product_id, from? })` | manager | Puts a product on sale from a date. Before it, the product is `coming_soon` and cannot be ordered. |
| `discontinue_product({ product_id, stock, reason? })` | manager | Stops selling it. `stock: "sell_through"` lets the shelf sell out with no reordering; `"write_off"` writes the shelf off now, keeping what waiting orders need. Paid orders are still sent; returns, warranty and repairs still work; the product stays in every record. |
| `change_price({ sku, new_price, reason, from? })` | manager | Adds a price change to `price_history`. Orders already placed keep their price. |

### Ways to pay

The ways to pay are data: `payments.methods` in `business/data/business.json`, in the order the checkout shows them. Each has an `id`, a `name`, a `kind` (`card`, `wallet`, `account` or `pay_later`), a one-line `explain`, and a list of `outcomes`. Each outcome has an `id`, a `label` for testers, a `result` (`paid` or `declined`), a `message` for the customer, and a `weight` (how often it happens when no outcome is named). Cards are the exception: their outcomes come from the `test_cards` table. To add a way to pay, add an entry. No code changes.

| Method | Kind | What it is | Outcomes |
|---|---|---|---|
| Card | card | Visa, Mastercard or American Express, with the test cards. | One per test card. |
| Tap | wallet | The wallet on your phone. | paid; not confirmed on the phone; no card in the wallet. |
| PayPost | account | An account you log into and approve the payment. | paid; window closed before approving; account needs checking; not enough money. |
| Later | pay_later | Pay in 30 days after a quick check. | approved; the check said no. |

- **Choosing the outcome.** Name it with `payment.outcome` to get exactly that result. Leave it out and the engine picks one by the weights. It has no randomness, so it uses the order number: the number's tail times 7919 (a prime), divided by the total weight, gives a point on the weights. Over any run of orders in a row the outcomes come out in the shares the weights say, and the same calls always give the same results.
- **Limits.** A method can have `limits`: `min_items_total` and `max_items_total` (the items, not delivery) and `not_when_every_item_ships_by` (a delivery method). Later uses £10 to £250 and not for a bag of only Cold food. A refused method saves no order. `payment_methods({ basket_total?, skus? })` says which methods a bag can use and why not, in plain words.
- **What the order records.** `payment.method` is the label shown to people ("Visa ending 4242", "Tap"), plus `method_id`, `method_name` and `outcome`. A failed payment saves the order as `payment_failed` with payment `declined`, as cards always have.
- **Pay later.** An approved order is `paid` for the warehouse, but its payment is `due`, with `due` (the amount) and `due_date` (30 days on). `settle_pay_later` marks it `paid`. Until then, any refund (cancel, return, problem, staff refund) takes the amount off what is owed instead of sending money back. If that brings it to nothing, the payment is `nothing_due`. `payment.refunded` counts both kinds, so "how much is left to refund" works the same for every method.
- **The ledger.** A pay-later sale counts the day it is placed, but the cash is owed: a `pay_later` entry takes it back out of cash until it is settled. See the table below.

## What every action records

Every change to stock goes through one helper (`moveStock`) and every pound through another (`postLedger`). So stock on hand always equals the sum of its movements, every pound has a ledger entry, and the records look exactly like the generated ones (same ids, fields and signs). Every stock movement except a delivery from a supplier also posts its cost of goods: units × the supplier's unit cost, the same sign as the movement. "Made to order" means the chilled-only food (sandwiches, ice): it is never on a shelf, so it is made on its dispatch day, as the generator does.

| Action | Stock | Money |
|---|---|---|
| Order placed and paid | `sold` per shelf item. Pre-order items wait in their own parcel with a note and take stock when it arrives. | `sale` (items less discount), `delivery_income`, `payment_fee` (1.5% + 20p). Pay later adds `pay_later` (minus the total). |
| Payment declined | Nothing. | Nothing. |
| Order cancelled before packing | `released` for what it took. | `refund` of what is left to refund. A declined order gets nothing back. |
| Delivery method or variant changed | Variant swap: `sold` new, `released` old. | `delivery_income` and `payment_fee` change by the difference; anything owed follows. |
| Parcel dispatched | Made-to-order food: today's purchase order from its supplier is `received` and `sold` straight out. | `delivery_cost` (carrier's charge). |
| Return passed inspection | Change of mind or wrong item: `returned_to_stock`. Faulty or damaged: scrapped (no movement; the cost was counted at sale). | `refund` against the return number, never more than is left. |
| Return failed inspection | Nothing (sent back to the customer). | Nothing; the return's refund becomes 0. |
| Problem: replacement | `written_off` for the free unit (made-to-order food is made on the day it is sent). | Cost of the unit; `delivery_cost` when the parcel goes. |
| Problem refund, staff refund, large refund | Nothing. | `refund`, never more than is left. On an unpaid pay-later order: `refund` plus `pay_later` (owed falls, no cash out). |
| Goodwill credit | Nothing. | `goodwill_credit` against the case (or the customer). |
| Pay later settled | Nothing. | `pay_later` plus what was owed (cash comes in). |
| Repair: out-of-warranty item received | Nothing. | `repair_income`: the assessment fee. |
| Repair: repaired | Nothing. | `repair_income`: quote less the fee already taken; `repair_parts`: 40% of the price (in warranty, of the listed repair price). |
| Repair: unrepairable | Nothing. | `refund` of the assessment fee. Declined: the fee is kept. |
| Purchase order received | `received` per line. | None yet. `supplier_payment` when the supplier's payment terms are up (`advance_day`). |
| Stock count or `adjust_stock` | `count_adjustment` for the difference. | Its cost. |
| Product discontinued with write-off | `written_off`, referenced to the product id. | Its cost. |
| Price changed, product launched | Nothing. | Nothing (orders keep their price). |
| Rent, software, wages | Nothing. | On the 1st, 3rd and 28th: the same amount as last month. |

Each month's summary row is worked out again from the ledger whenever a call adds an entry, so `get_monthly_summary` and the snapshot show run-time activity. Rows have two extra fields: `repair_income` (part of revenue) and `corrections` (cash only, like the validator).

### What time does (`advance_day`)
Deterministic: no randomness, no real clock. "Sometimes" is decided from a hash of the record's number.
- **Products**: a `coming_soon` product goes on sale on its date.
- **Supplier deliveries**: due orders arrive, or go `late` with chance 1 − the supplier's reliability, slipping 2 to 12 days. A late order arrives on its expected date (a late order with no date gets one).
- **Parcels**: a parcel waiting for stock takes it once it is on the shelf. Pending and packed parcels go out on working days (chilled only on its dispatch days). A parcel is delivered on its eta; 3% are late by 3 to 6 working days and show `delayed` first, then get the "delivered after the estimated date" note.
- **Unpaid orders**: a failed payment is cancelled after 24 hours.
- **Pay later**: on the due date the customer pays, except 5% (assumed), which are flagged `overdue` for finance.
- **Bills**: supplier payments when terms are up; rent, software and wages on their days.
- **Deadlines**: contacts with no reply past the reply target are flagged `overdue`; open complaints past their answer deadline (stage 1: 3 working days, stage 2: 10) get `deadline_missed` and a note; returns that arrived but are not refunded get `refund_due_by` and then `refund_late`.

### The health check (`check_books`)
The validator's money and stock rules, run on the live state: each movement points at a real record and stock never goes below zero; on hand equals the sum of movements per SKU; each paid order has its sale, delivery income and fee; stock moved for exactly what was sent; ledger refunds match each order and never exceed what was paid; pay-later entries match what is owed; declined orders have no entries; every ledger entry points at a real record and sits in its own month; each month's summary equals the ledger, worked out afresh. It returns `breaks` (should always be empty) and `planted` (the world's deliberate mistakes: the double refund and the unadjusted Biscuit Tin count). It needs a generated world.

### The outcome summary (`business_snapshot`)
Worked out from the current state in one pass: revenue, refunds, gross margin, profit and orders for this month and since the start; cash; stock value at cost; stockouts (shelf SKUs at zero); late parcels; open cases; complaints past deadline; average first reply (minutes) and unanswered contacts; refunds by reason (return reason, cancelled order, other order refund, repair fee); pay later owed and overdue; and actions refused by permissions (`forbidden` in the audit), by role.

### Dates on the live site
Tests fix the clock at `sim.anchor_now`. The live site passes the real time, and the engine moves every date forward by the whole number of days in between, so "delivered yesterday" stays yesterday. Ledger month labels and the monthly summary are worked out again after the move.

### Known limits
- Bookings (services are hidden) still write no ledger entries.
- Parcels are not lost at run time, and a refund for a used item cannot be reduced after inspection.
- Repair parts cost is an assumption (40% of the price); there are no parts records.

## Known gaps

- The engine's ledger has no types for insurance, utilities or packaging. The generator books insurance and utilities with rent (as premises) and leaves packaging (`costs.json` `packaging_per_order`) out of history's ledger; the simulator charges packaging itself.
- Customers are sorted by id as text, so at scale 1 (five-digit ids) `C-9999` sorts after `C-22308`.
- History treats Ice by Post as made to order (no shelf stock), but the simulator's opening top-up treats it as a shelf product, so it tops Ice up on day one.
