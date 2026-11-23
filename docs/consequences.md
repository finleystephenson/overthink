# What everything you do does to the business

Overthought & Co. answers every action with rules, not with an AI. This page says, in plain words, what each action changes when time moves on, and which numbers we made up. The numbers live in `business/data/audience.json` and `business/data/sim.json`; each has a one-line reason and a source, or the word "assumption". Change a number and run again.

Every effect is measured against the **shadow**: the same business, with the same luck, where nothing was done. With nothing done, every difference is zero.

## Prices, stock, marketing, staff

| Action | What happens |
|---|---|
| `change_price` | Demand follows price: a 10% rise loses about 10% of orders across the range (`price_elasticity` 1.1). With the rich customer model, each customer also has their own hidden price sensitivity, so some leave at a price others accept. |
| `create_purchase_order`, stock counts | Stock is what the shop can sell. An empty shelf loses the sale (some customers pick something else). |
| `set_marketing_budget` | More spend brings more orders with diminishing returns: doubling the budget adds the same number of orders each time, so each extra pound buys less. The spend is a cost every day. With the rich model it also brings new customers. |
| `set_staffing` | Hours and people change how fast customers are answered and parcels packed, and the pay bill. |
| `set_support_cover` | Hands a channel (say email) to you or your own AI. The customer's email sits in the hello@ mailbox; reply with `send_email`. Staff step in after a working day, unless you set a different wait. |

## Talking to customers

- **Every contact is a real record.** It goes into Front Desk (`contacts`), as an email in hello@ for email contacts, or as a conversation for web chat. Staff handling updates it: who answered, how fast, the outcome, and any case they opened.
- **Your reply to a customer's email** marks their contact as answered. It is judged by the same rules as a plugged-in tool (`simulation/simulator/judge.mjs`): what you did in the records (for example, did you look the order up, make the return or arrange the replacement) and whether you wrote a real answer. Resolved, and the customer is satisfied and remembers it. Not resolved, and staff finish it, but your first answer still counts as the first reply.
- **A public reply or private message to a customer** (`reply_social_post`, `send_social_message`), or a one-to-one email:
  - A fast, helpful one raises that customer's memory, so they buy again sooner.
  - A fast, helpful public answer to a complaint also lifts the shop's reputation a little.
  - A curt one does slight harm.
  - Fast means within 4 hours. Helpful means at least 25 characters that are about their order or problem. Both are assumptions.
- **Response times** are the customer's real wait in clock minutes. What customers hold against the shop is working time (09:00 to 17:30 on working days): an email sent at 22:00 and answered at 09:05 is "first thing next morning".

## Social posts (`create_social_post`)

Each post gets a plan when the audience first sees it, which is the next simulated day. The plan then plays out over a week, mostly in the first day or two. Squint (the photo network) lasts longer than mutter (short posts).

**Reach** starts from the network's followers (`social_stats_daily`) times a base share (12% squint, 8% mutter). It is then multiplied by:

- **picture:** a mutter post with a picture is seen more;
- **time and weekday:** the live clock sits at 10:00, so tool posts count as daytime;
- **length:** too short or too long is seen less;
- **names a product:** seen a little more, and its visitors go to that product;
- **fits the moment:** an active world event names its product, its category or its words (×1.4);
- **an offer or code:** more likes, clicks and buying;
- **fatigue:** more than three posts a week lowers every post, and each extra post on the same day reaches 60% of the one before;
- **quality:** see below;
- **luck:** the same post always has the same luck.

**Responses:** likes, comments and reposts. Each repost reaches 35 more people. You also get visits to the shop, new followers, and orders (visits × 2.5% conversion, from published Shopify ranges).

The results are written on the post as `audience`:
- `shown` is what has happened so far: reach, likes, comments, reposts, visits, followers, orders and revenue;
- `plan` is the whole expected response;
- `factors` says why.

Up to five comment records in customers' own words appear under the post when the comms banks are loaded. The day's `social_stats_daily` row gains the reach, the engagement and the new followers.

Orders from posts are real extra demand in the business, added as extra orders of the named product (or across the range). The orders and revenue on the post are estimates; the true figures are in the impact.

No company post on a network for 14 days, and followers drift away at 0.1% a day.

## Marketing email (`send_email` to three or more customers)

- **Opens** are 30% of recipients and **clicks** are 8% of opens. Orders come from clicks at the same conversion as social visits.
- **Unsubscribes** are 0.3% of recipients. They are six times as likely for customers who never opted in, and those who unsubscribe are marked `marketing_opt_in: false`.
- **Fatigue:** more than two marketing mails a fortnight means fewer opens and more unsubscribes.
- The results are written on the email as `audience`. Every rate here is an assumption.

## The catalogue

- **`launch_product`:** a product the business files have never priced gets its category's typical demand. It sells less if priced above the category's median. While new it sells up to 2.5 times its settled rate, fading over about a month. Thirty per cent of its sales are taken from the rest of the range.
- **`discontinue_product`:** the product stops selling. Forty per cent of its demand moves to products in the same category; the rest is lost. Its stock is no longer reordered.
- **Made-to-order products** (chilled only: sandwiches, ice) are made each morning, as in history, and never stocked.

## Optional quality score (`score_content`)

Rules can check facts about a post or an email, but not whether the writing is good. A manager can record a score from 0 to 1 from any judge: a person, a cheap AI model or a local one. The response is multiplied by 0.6 (score 0), 1 (score 0.5) or 1.5 (score 1), on a straight line in between.

- The same words always keep the score they were first given (cached by a fingerprint of the text), so runs repeat.
- Score before time moves on.
- Without a score the record says "quality was not judged" and counts it as ordinary.
- Nothing in the simulator calls a model. To plug a judge in, read new posts and emails after each action, ask your judge, and call `score_content`.

## Customers (the rich model, used by live sandboxes)

- **Buying:** each customer has their own buying rate. After each purchase they may stop buying for good (the BG/NBD idea, Fader, Hardie and Lee 2005). New customers arrive to replace them, more with more marketing and a better reputation. The day's demand follows who is still buying, so customers who are badly treated cost real sales.
- **Hidden traits:** each customer has their own price sensitivity, patience, readiness to complain in public, and readiness to leave. They are never shown through the tools.
- **How they write:** polite, plain or blunt; some are vague ("the thing I ordered"); some leave out their order number, so a tool has to ask; and they bring up last time ("This is the second time I have written about this").
- The shapes of all of these are assumptions (`business/data/sim.json` `customer_model`).

## Seeing what an action did

`GET /sandboxes/:id/impact` gives live minus shadow for the money, service and content measures:
- social reach, followers, visits, orders and revenue from content;
- email opens and unsubscribes.

It also gives `actions`: each thing done, with how the measures moved between it and the next action. That is a time window, not a proof of cause: effects overlap and linger.


## Campaigns you start (`create_campaign`, `update_campaign`, `end_campaign`) and the website

Only campaigns made with these tools are played by the simulator (history's are part of the business as it was, and are read-only). The numbers are `simulation/simulator/campaigns.mjs`; most are history's own:

- **Spend** is paid every day (monthly spend / 30.4) on top of the marketing budget and counts as part of it, so it lifts orders by the same marketing elasticity (0.2 on the log of spend against plan): doubling the budget adds the same each time.
- **A discount code** is used by 25% of buyers (the share history uses). Those buyers face a price lower by the discount, so orders rise by the price elasticity (1.1), and that share of the day's sales is given away. The money given is booked with marketing cost, so profit and cash both fall by it, and it is written on the campaign as `discount_given`.
- **Results on the campaign**: `spend_to_date` (and `spend`, the same), `visits` and `orders_attributed`. Orders attributed are the expected extra orders the campaign caused, shared between campaigns by the size of each one's lift (the real orders are in the impact). Visits come from spend at history's rates (search 1.6 and social 2.2 visits a pound) or, for email and "none", from attributed orders at a 2.1% conversion.
- **A marketing email** sent with `links.campaign_id` is scored by the audience as usual, and its visits and orders are added to that campaign too.
- **Twin fairness.** The shadow has no campaign, so the impact is exactly what the campaign did; every draw is the same in both.
- Rules: marketing may give up to 10% off, the manager 20%; a code is 3 to 12 capital letters or numbers and unique; spend up to 50,000 a month; no start in the past; at most 366 days.

**Website rows.** Every simulated day now writes a `web_sessions_daily` row in history's shape. Visits come from the day's orders at a 2.1% conversion (x0.85 to 1.15 luck), baskets started from a 70% abandon rate, product views from sales and visits. Because orders already carry spend, campaigns, posts and events, visits follow them; an event's visits multiplier scales the visitors; visits that a campaign, a social post or a marketing email brought are put in their own channel (the rest follow history's mix of direct 34%, search 31%, social 15%, email 10%, referral 10%).

**Order times.** New orders in the live business are stamped through the day (a seeded draw per order from an hourly shape: quiet overnight, peaks at lunchtime and about 8pm; `ORDER_HOUR_WEIGHTS` in `simulation/simulator/lib.mjs`, an assumption). The same order has the same time in both twins. The engine's 12:00 and 14:00 delivery cut-offs read the order time, so an evening order ships a day later.

**Live records are kept.** A live sandbox never trims `contacts`, `emails`, `cases` or website rows (`compact: false`); trimming is for long batch runs only.
