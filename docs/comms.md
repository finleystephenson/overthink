# Mail, chat and social

The company's three message streams. Code: `infrastructure/engine/comms.js` (records and tools), `business/builder/world/comms.mjs` (writes the history and each new day), `data/comms/*.json` (the written template banks). Tests: `infrastructure/engine/comms.test.js`, `business/builder/world/comms.test.mjs`.

## Records

All times are UTC ISO strings. Every record also has a `key`: a stable name for what it is about (for example `order|ORD-10041|confirm`). The key is how a record is written once, never twice.

**emails** (`EM-000001`). One message in one mailbox.
`{ id, key, thread_id, mailbox, folder, from:{name,address}, to:[{name,address}], cc:[...], subject, body, at, read, by, links }`
- `mailbox`: `hello`, `orders`, `suppliers`, `accounts`, `press`, or a person's box (the last word of their name: `fezziwig`, `scrooge`, `cratchit`, `fogg`, `mole`, `hudson`, `weller`, `summerson`, `crusoe`, `toad`, `hephaestus`). Address is `<mailbox>@overthought.example`.
- `folder`: `inbox`, `sent`, `drafts`, `junk`, `archive`.
- `by`: the staff id who wrote it, or null (a customer, a supplier, the automatic system, or the customer-care assistant).
- `links`: any of `customer_id`, `order`, `contact_id`, `case`, `po`, `supplier_id`, `campaign_id`, `ledger_id`, `conversation_id`. Only set when true, and the record exists.
- Mail between staff is two or three copies sharing one `thread_id`: one in the sender's `sent`, one in each recipient's `inbox`.

**chat_messages** (`CH-000001`). One chat line.
`{ id, key, channel, dm, from, from_name, text, at, thread_parent, parent_key, reactions:[{by,mark}], links }`
- `channel`: `general`, `orders`, `stockroom`, `customers`, `money`, `marketing`, `random`. For a private message `channel` is null and `dm` is the two staff ids, sorted. (`"AI"` is the operations assistant.)
- `thread_parent`: the id of the message this answers, or null. `reactions` use plain words (`noted`, `thanks`, `seen`, `ha`, `good`, `agreed`), not emoji.

**social_posts** (`SP-000001`). Everything on squint (photo sharing) and mutter (short posts).
`{ id, key, network, author:{kind,name,handle,customer_id?}, kind, text, image, at, likes, reposts, parent, parent_key, thread, by, mentions_shop, links }`
- `author.kind`: `company` or `customer`. The company handle is `overthoughtco`.
- `kind`: `post`, `comment`, `reply`, `dm`. A `dm` has a `thread` (`dm-<network>-<customer>-<date>`) and no parent; comments and replies have `parent`.
- `image`: only for company posts. A path such as `img/branded/blip.jpg` (relative to `business/site/`) of a picture that exists. Customers' pictures are not stored, so their `image` is null.
- `mentions_shop`: true for a customer's post that tags `@overthoughtco`.
- `links`: `product_id`, `campaign_id`, `order`, `customer_id`.
- Limits: squint captions 2,200 characters and need a picture; mutter 280.

**social_stats_daily**. `{ key, date, network, followers, reach, engagement, posts }`, one row per network per day. Followers grow with orders, social visits and campaign starts.

## Tools and who may use them

Internal means every staff role and the operations assistant. The customer-facing `assistant` and `customer` roles get **none** of these tools: emails and chat hold other customers' details and the company's money talk.

| Tool | Roles | Notes |
|---|---|---|
| `list_mailboxes` | internal | only the boxes the role may open, with totals and unread |
| `list_emails` | internal | mailbox, folder, unread, search, limit (25, max 100), before |
| `get_email_thread` | internal | by email id, or thread id plus mailbox |
| `send_email` | internal | new, or a reply (`reply_to_id`); from a box the role may use |
| `draft_email` | internal | saves to `drafts` |
| `mark_email` | internal | read, unread, archive, junk, inbox |
| `list_channels`, `read_channel` | internal | newest first, `before` pages back |
| `send_chat_message` | internal | a channel or `to` a person; optional `thread_parent`, `as` |
| `read_direct_messages` | internal | your own role's people only; the manager and operations assistant may read any |
| `list_social_posts`, `get_social_post`, `list_social_messages` | internal | `mentions_only` filter; messages grouped by conversation |
| `create_social_post` | marketing, manager | squint needs a real product picture |
| `reply_social_post`, `send_social_message` | marketing, manager, support_agent, support_lead | speaks as the company |
| `social_stats` | marketing, manager, finance | followers, reach, engagement by day |

Mailbox rules. Shared boxes: `hello` (support_agent, support_lead, manager, marketing), `orders` (warehouse, support_agent, support_lead, manager, coordinator), `suppliers` (buyer, warehouse, manager, finance, coordinator), `accounts` (finance, manager, buyer), `press` (marketing, manager). A personal box opens only for the owner's role, the manager and the operations assistant. So the warehouse cannot open `accounts`, and finance cannot open Mr Toad's box.

Rules every writing tool follows: validate input, check the role, stamp `ctx.now`, push a line to `ctx.changes`. Ids carry on from the highest id actually in the state (`EM`, `CH`, `SP`), even if the simulator appended records without touching the counters. Mail to our own addresses also lands in that mailbox's inbox, unread. Nothing leaves the simulated company.

**Answering a customer.** A `send_email` reply to a customer who wrote in by email sets `first_reply_minutes` on their `contact` (found through the replied-to email's `contact_id`, else the customer's newest unanswered email contact). It only sets it if empty, so a second reply changes nothing.

## How the history and each day get written

`deriveComms(state, { from, to, seed, data })` in `business/builder/world/comms.mjs` is pure and repeatable, with no Node imports. It returns `{ emails, chat_messages, social_posts, social_stats_daily }`: only new records, for things dated `from`..`to` (inclusive, `YYYY-MM-DD`). Load its data with `loadCommsData(dataDir)` from `business/builder/world/comms-data.mjs` (Node only; in a browser pass the same object, fetched as JSON).

- Each message is drawn from a random stream keyed by what it is about (an order number, a purchase order, a contact id, a date), so a window gives the same records as the same days inside the whole history.
- A record whose `key` is already in the state is skipped, so running a day twice writes nothing twice.
- Nothing is dated after `state.now` when `to` is today.
- Replies and comments carry `parent_key`; `parent` (or `thread_parent`) is set when the parent is in this batch or already in the state.

**What comes from what.**

| Source record | Mail | Chat | Social |
|---|---|---|---|
| order | confirmation (all chilled or £60+ orders, about 12% of others), dispatch note (half of special ones, 10% of others), cancelled, payment failed | big order (£100+: half of those, all £200+), late delivery | customer post after delivery (3.5%, 6% for big orders; a late parcel gives a complaint post 20% of the time), company reply |
| contact by email | the customer's email (in their voice, from topic and summary) and the staff reply | | |
| email conversation | the thread, as written | | |
| purchase order | order sent, confirmation, delay notice if late, invoice into `accounts`, remittance | raised, received, late | |
| campaign | newsletter (email campaigns, 60% of launches) | campaign starts | launch posts on both networks, other campaigns on mutter |
| case (complaint) | | complaint | |
| review | | good (35%), bad (80%) | customer post, company reply |
| stock count with a difference, faulty return | | stock count, faulty return | |
| monthly summary | | month-end | |
| ledger | Scrooge queries one cost each month, Bob replies | | |
| the calendar | weekly figures every Monday; press, junk, pitches | Monday and Friday notes, notices, banter, private messages | company posts (squint about 2 a week, mutter about 3), comments, DMs, daily follower stats |

**Template banks** in `business/data/comms/`. Slots in braces (`{name}`, `{order}`, `{product}`, `{days}`); a test fails if one is left unfilled. Add variety by adding lines; no code changes.

| File | Holds |
|---|---|
| `mail_customer.json` | customer enquiries by topic (greeting + body + extra + closer) and staff replies and sign-offs |
| `mail_system.json` | order mail, supplier traffic, newsletters, press, internal mail (weekly figures, cost queries) |
| `junk.json` | 69 **bundles**: one invented company, sender, matching subjects and bodies each. 49 are sales pitches (search, payments, packaging, couriers, directories, partnerships, surveys); 20 are junk (invoice chasers, phishing, prizes). An email made from one has `bundle` set to the bundle id, so subject, body, sender and company always agree |
| `chat.json` | lines per situation per person (orders, stock, complaints, reviews, month-end, campaigns, general notices) and private-message pairs |
| `banter.json` | #random: about 200 observations (17 to 20 per person, each tagged with a topic), replies that fit the topic, sign-off habits, name forms for addressing someone, lead-ins by time of day, "fact of the day" clauses and weather by month |
| `social.json` | caveats, ten kinds of company post (`company_types`: new, back, question, made, correction, price, care, thanks), dry notices, seasonal lines by month, customer posts and comments, replies, DMs |

How variety is made, so no line comes round often:
- **Parts.** A line is a base sentence plus optional lead-in, sign-off habit, address-by-name, and a fact of the day (yesterday's orders, the week so far, the best seller, the weather). Replies are tied to what they answer ("Re PO-3262: ...").
- **No repeats within a month** for each person's observations: they come in a shuffled order and are used up first.
- **Company captions** are never used twice in a calendar year, and the least-used caption across years is chosen first.
- **Facts in captions** (price, care, questions, features, specs, review counts) come from the product record via `loadCommsData`, never from the template.

Staff keep their voices: Fezziwig warm, Scrooge counts pennies, Cratchit meek and careful, Fogg exact about time, Mole shy and homely, Hudson firm and kind, Weller cheerful with odd comparisons, Summerson modest, Crusoe lists, Toad over-excited, Hephaestus terse. No text hints at a problem to solve.

**Cost of a daily call.** Indexes built from the whole history (lookups by id, orders by day and by customer, first sale dates, the follower series, the company-post walk, message keys and the highest ids) are kept in a `WeakMap` keyed on the state object and only topped up from the end of each list. Lists are assumed to grow by appending. A one-day call visits only records dated in the last 75 days (150 for purchase orders), so 365 single-day calls on the standard world take about 1.5 seconds, and give the same records as one call for the whole year (ids aside). Replacing a list with a new array rebuilds that list's index.

## What the simulator calls

- World build: once, `deriveComms(state, { from: firstDay, to: now, seed, data })`, then write the four arrays as `emails.json`, `chat_messages.json`, `social_posts.json`, `social_stats_daily.json` in the world folder.
- Each simulated day, at the end of the day, after that day's commerce records exist: `deriveComms(state, { from: date, to: date, seed, data })`, then append the four arrays to `state.emails`, `state.chat_messages`, `state.social_posts`, `state.social_stats_daily`. Set `state.now` to a time on or after `date` first.
- Effects on the business of what a person posts or sends (a post bringing visitors, a reply calming a customer) are for the simulator to decide from these records; this module only writes and stores messages.

## Changes of 22 Nov (second pass)

**Chat wording and hours.** `#random`, general notices and private messages are written by one day-by-day walk (kept in the cache, like the company-post walk). A line is a whole sentence; the only parts added are an optional lead-in, a sentence after it or a sign-off habit, and a part that would repeat words already in the line is dropped. Facts of the day (yesterday's orders, last week's, the best seller, the weather) appear only in lines written around them, and only on days they are worth saying: a line about yesterday's orders needs three or more, and counts agree ("1 order", never "1 orders"). A reply must come from the reply set written for its opener's topic; an opener with no topic gets no reply. The least-used line comes round first, so no line is used more than four times in five years. People post only inside their own hours from `business/data/staff.json` (start time plus the day's length from weekly hours, never past 18:30), on weekdays; the few evening messages (under 2%) come only from Scrooge, Cratchit, Crusoe and Toad. A reply from someone who has gone home is simply not sent.

**Roles without a person.** `business/data/staff.json` has no coordinator and no operations assistant. The coordinator posts as "Coordinator" (`role_only: true`); the operations assistant as "Operations assistant (AI)" (`from: "AI"`, `assistant: true`). Neither has private messages: they cannot read anyone's, send one, or speak as a named person. Only the manager may read any person's private messages or speak as them.

**Money.** One formatter for every figure in mail and chat: `£1,589.25` with pence, `£1,589` without.

**Suppliers.** Invoices and remittances use `accounts@<supplier's own domain>` with the display name "Accounts, <supplier>"; purchase-order mail uses `orders@`.

**Customers.** Greetings use `shortName` ("Mrs Hudson", "Medb" for "Queen Medb", "Queen of Hearts" whole). Handles never double a one-word name. A staff member's name is never used as a customer author. Direct-message answers come from a set keyed by the question's topic (`dm_topics` in `social.json`).

**Live days.** The "future" cut at the clock applies only to windows of more than one day; a single live day is trusted. Single-day calls after "now" keep the weekly rates of history, and the follower series is continuous across the join. The deriver never changes an existing record, so fields the simulator adds to posts (`reach`, `visits`, `orders`, `results`) are left alone.

**New tools** (all in `infrastructure/engine/comms.js`):

| Tool | Roles | What it does |
|---|---|---|
| `update_draft`, `delete_draft`, `send_draft` | internal, by mailbox | edit a draft; throw it away; send the draft itself (same record, drafts to sent) |
| `delete_email` | internal, by mailbox | move to the new `bin` folder (`mark_email` with `inbox` restores) |
| `forward_email` | internal, by mailbox | forward with a note, quoting the original, into a new thread |
| `read_channel` `search` | internal | keep only messages with every word given |
| `react_to_chat_message` | internal | a plain-word reaction; one per person per message; private messages only by the two people |
| `like_social_post`, `repost_social_post` | marketing, manager | as the company, once per post (`liked_by_shop`, `reposted_by_shop`); not on the company's own posts; reposts on mutter only |
| `list_post_pictures` | internal | every picture a post may use, with product id and name |
| `send_social_message` `handle` | marketing, manager, support | start a conversation by the customer's handle as well as by id |

`list_post_pictures` and `create_social_post` use `world.pictures` when the server sets it (`listPictures(dataDir)` in `business/builder/world/comms-data.mjs` reads the files that exist); without it the list comes from the product records alone and says `verified: false`. `postSummary` now returns `by` and passes on `reach`, `visits`, `orders` and `results`.
