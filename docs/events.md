# World events and the news

The business does not sit alone. Posts go on strike, summers get hot, a sock goes viral, and now and then the Big Bad Wolf blows down a house. These are **events**. Each one is reported in the news, and each one changes demand, deliveries or costs for a while.

Everything is in `business/data/events/library.json`. You can edit it with a text editor.

## Three families

| Family | What it is | When it happens |
|---|---|---|
| `calendar` | Christmas, Easter, back to school, Black Friday week, bank holidays, the clocks changing | The same dates every year (Easter-based ones move with Easter) |
| `real-style` | Things that could happen to any UK online shop: a postal strike, a heatwave, a fuel price jump, a rival closing | Randomly, at a yearly rate, in the months you allow |
| `storybook` | The brand's own flavour. The customers are characters from out-of-copyright books, so the news is what happens in those books, reported straight | Randomly, like real-style |

Rules for the words: never a real company, brand or living person (say "the national postal service", "a large courier"). Storybook events use only work that is out of copyright (author died before 1955 and published before 1929, or traditional), never a film or TV version.

## One event in the library

```json
{
  "id": "sb-wolf-pigs",
  "family": "storybook",
  "title": "The Wolf blows down two houses",
  "headline": "Wolf blows down two houses in Pigs' Lane; third stands firm",
  "story": "Three to six sentences of deadpan news copy.",
  "source": "The Three Little Pigs, traditional English folk tale",
  "section": "Local",
  "rate_per_year": 0.3,
  "months": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  "duration_days": [10, 16],
  "region": { "towns": ["Mother Goose Lane", "Cottage in the Wood"] },
  "region_share": 0.0335,
  "ramp": "peak",
  "effects": {
    "demand": { "products": { "indoor-helmet": 3.0, "bubble-wrap": 1.5 } },
    "contact_rate": 1.3,
    "carrier_delay_days": 1
  },
  "why": { "demand.products.indoor-helmet": "Falling bricks and rafters make a padded cap sensible." },
  "chatter": ["Pigs' Lane needs helmets. All of them."],
  "tags": ["fairy-tale", "region", "disaster"],
  "group": "optional"
}
```

### When it happens

- **Random events** use `rate_per_year` (0.3 means about one every three years; 2 means twice a year), `months` (1 to 12, the months it may start in) and `duration_days` (`[shortest, longest]`).
- **Calendar events** use `fixed` instead. Three ways to say a date:
  - a day: `{ "month": 2, "day": 1, "length_days": 14 }`
  - Easter-based: `{ "easter_offset": -21, "offset_days": -10, "length_days": 11 }` (Mother's Day is three Sundays before Easter; this starts ten days earlier)
  - a weekday of a month: `{ "month": 5, "weekday": 1, "n": -1, "offset_days": -2, "length_days": 3 }` (the last Monday in May, starting two days before). `weekday` 0 is Sunday; `n` is 1 to 4, or -1 for the last.
- **`group`** stops two events of one kind overlapping (two postal strikes cannot happen at once). Give related events the same word.

### What it does: `effects`

Exactly the keys the simulator understands. Leave out any that do not apply.

| Key | Meaning |
|---|---|
| `demand.all` | Multiplies every order's chance (1.1 means 10% more) |
| `demand.products` | Multiplier per product id, for example `"indoor-helmet": 3.0` |
| `demand.categories` | Multiplier per category: `everyday`, `tech`, `food`, `carry`, `desk-home`, `outdoors` |
| `visits` | Multiplies website visits |
| `contact_rate` | Multiplies how many customers get in touch |
| `carrier_delay_days` | Days added to delivery |
| `supplier_late_chance` | Multiplies the chance a supplier is late |
| `costs.carrier`, `costs.goods`, `costs.card_fee` | Multiplies delivery cost, cost of goods and card fees |

Keep numbers believable: most between 0.8 and 1.4, a few dramatic ones. Every number has a one-line reason under `why`, keyed by its path (for example `"demand.all"` or `"costs.carrier"`).

### The shape over time: `ramp`

- `flat`: full strength the whole time
- `build`: starts at a quarter strength and rises to full
- `fade`: starts at full and dies away to a quarter
- `peak`: rises to full in the middle and falls away again

A one-day event is always full strength.

### Where: `region`

Leave it out and the event is everywhere. Otherwise give `towns` (names exactly as in `business/data/characters.json`) and/or `areas` (postcode letters such as `EL`). Inside the region the event acts in full; outside, not at all. When the simulator asks for the whole business at once, a regional event acts in proportion to `region_share` (the share of customers living there, filled in from `characters.json`). So a house blown down in one lane is a big deal in that lane and a small ripple nationally.

### Words for other people: `chatter`, `tags`, `section`

`chatter` is two or three lines staff or customers might say. `section` is the newspaper section (Diary, Local, Weather, Delivery, Money, Business, Trends). `tags` are for searching.

## How the schedule is made

`scheduleEvents(library, { seed, from, to })` in `infrastructure/engine/events-core.js` lists what happens in a window. The same seed always gives the same list. Each event draws from its own random stream, keyed by its id and the year, so **adding or editing one template never moves any other event**. Each random occurrence is also made a little bigger or smaller (80% to 120% of the written effect), and that final number is what is saved.

## In a world

Two lists are kept with the rest of the business records:

- `world_events`: id `WE-00001`, template, title, headline, story, `start`, `end`, `status` (`scheduled`, `active`, `over`, or `cancelled`), `origin` (`seeded` or `added`), `region`, `ramp` and the `effects` actually applied.
- `news`: id `NW-00001`, `at`, headline, story, `section`, and the `event` it is about. An event's news is published on its start day.

Every day the simulator asks the events plug-in (`eventsPlugin` in `infrastructure/engine/events.js`) for that day's modifiers (everything active, ramps applied, multiplied together) and, at the end of the day, it publishes news and updates statuses. For a customer in a particular place, `activeEffects(events, date, { town, postcode })` gives the exact figures for that place.

## Tools

| Tool | Who | What |
|---|---|---|
| `list_news`, `get_news_item` | everyone | The public newspaper. Newest first. Filter by `section` or `before` |
| `list_world_events`, `get_world_event` | staff roles | What is happening, and what recently ended, with effects in plain words. Events that have not started are hidden |
| `list_event_templates` | manager | The event library: filter by `family`, `search`, `limit`, `offset`. Manager only because it shows what could happen |
| `add_world_event` | manager | Cause an event: a library `template`, or a custom one with `title`, `story`, `effects` and dates. Marked `origin: "added"` |
| `edit_world_event` | manager | Change an event that has not finished. A started event cannot be moved |
| `cancel_world_event` | manager | Stop an event from today. Published news stays |

Everything the manager changes is recorded in the audit log.

## Add or edit an event

**Change an existing one:** open `business/data/events/library.json`, find its `id`, change the numbers, the story or the rate. Keep a `why` for each number.

**Add one:** copy a similar entry, give it a new unique `id`, and fill in every field. Check it: `node --test infrastructure/engine/events.test.js` confirms the product ids and towns exist, every number has a reason and the story is the right length.

**Cause one right now in a running world:** use `add_world_event` with a `template`, or:

```json
{ "title": "Street fair", "story": "The town holds a fair.", "start": "2026-12-05", "duration_days": 3,
  "effects": { "visits": 1.3, "demand": { "all": 1.1 } } }
```

It cannot start in the past, and made-up product ids or wild numbers (a multiplier outside 0.1 to 10) are refused.
