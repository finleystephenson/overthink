# Company history

Written 22 Nov 2026 for the world built at scale 0.2. Three files in `business/data/history/` tell how Overthought & Co. got here. They are data, written once by hand. No AI runs at run time, and none of it is for the public shop site. They exist so old mail, staff chat and documents make sense.

| File | What it is |
|---|---|
| `timeline.json` | 82 dated entries from March 2021 to 22 Nov 2026. Each has `date`, `title`, `kind`, `text`, `people`, `evidence` and `links`. |
| `story.md` | The same history as one short internal document (the world's DOC-12 draws on it). |
| `staff-history.json` | For each staff member: joined date, why, first job, what changed, one line others say. |

## What is real and what is invented

**Real** (from `business/data/world/standard/`): every number, date and record id. That means monthly orders, revenue, profit and cash, ORD-10001 (22 Nov 2021, Mr Baddeley), product launch dates, first-sale dates, purchase orders and their lateness, campaign spend, the Apr 2024 price rise, the first review, return and repair, staff joining dates and hours (`company.json` `staffing_now`), and the world events used (Black Friday 2022, storm Dec 2023, bubble wrap viral Sep 2024, weekend paper mention Dec 2024, the miser Dec 2025, heatwave Jun 2026).

**Invented** (records silent): the sock story, the name, the warehouse unit, why each person joined, and anything a person said or did. Each entry says so in `evidence`. Where an entry mixes the two, the real part comes first. A link between an event and a result (for example a review and a good month) is never claimed.

## Key figures

Orders per year: 6 (2021), 98, 475, 1,519, 2,527, 2,555 so far (2026). Revenue 2026 to date £119,437.65. Five-year totals: 7,180 orders, £322,514.15, £26,256.36 profit. First profitable month: May 2023. Lowest cash: £1,400.05 (Feb 2025). Highest cash: £33,554.14 (Nov 2026). Best month: Dec 2025 (411 orders, £18,831.50). Busiest days: 26 orders on 7 and 16 Dec 2025.

## How to use these files

- **Staff chat and mail.** Never mention someone before their `joined` date. Joining order: Fezziwig (2021-03-14), Hudson (2023-09-11), Toad (2024-01-08), Fogg (2024-03-25), Mole (2024-06-17), Crusoe (2024-08-19), Scrooge (2024-09-16), Cratchit (2024-11-04), Hephaestus (2024-12-16), Weller (2025-02-24), Summerson (2025-07-07).
- **Anniversaries.** Use the timeline dates: launch day 22 Nov, each product's launch, each person's joining date.
- **News archive and "about the company".** Take titles and text from the timeline and filter by `kind`. Do not add clues or puzzles. This is ordinary history.
- **Numbers.** Quote from `evidence`. If the world is rebuilt with different numbers, these files must be checked again.
- **Place.** The company has no stated location. Do not add one.

## Known gaps

- November 2026 is month-to-date and its wages are not posted, so its profit is overstated. 2026 profit to date is £13,442.92 including that month.
- The world has a "Gift guide: the tin" event in Oct 2024, before the Biscuit Tin launched in Sep 2026. It is not used here.
- Bubble Wrap's own orders do not visibly jump in Sep 2024, though total orders rise. The history claims only the total.
