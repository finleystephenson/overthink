## People

Every customer in Overthought & Co. is a storybook character, and every one now also has a real-world life: an age band, household, income fifth, job status, area, online shopping habit, preferred way to be contacted, and some circumstances (new parent, carer, moving home, keen gardener and so on). These come from UK statistics, not from the story.

**Where it lives.** `simulation/world/population-sources.json` holds the targets and where each came from. `node simulation/world/build-population.mjs` writes `business/data/population.json`. `simulation/world/population.mjs` turns traits into behaviour. `node simulation/world/report-population.mjs` writes `simulation/world/population-report.md`.

**Fair by construction.** Traits are dealt out by exact counts (so the whole population matches the targets) from a shuffle that never looks at the character's book, name, kind or author. A villain is no more likely to be poor than a hero. The report measures this (Cramer's V against chance). Only the links between people (same address = household, same street = neighbour, same book and similar age = friend) use the story, because that is what "could know each other" means.

**Behaviour from circumstances only.** Money (income, household) moves price sensitivity; time (job, new baby, caring) moves patience and when people get in touch; online habit moves how often they buy; life events move which product categories they want. Each effect is small, clamped, and written down with its reason in `BEHAVIOUR_ASSUMPTIONS`. `simulation/simulator/customers.mjs` applies it only when `business/data/population.json` exists.

**What is verified.** Only headline figures were confirmed by search (UK population 69.3 million in mid-2024; one-person households 29.5% and lone-parent families 16.1% in 2024; employment rate 75.0% and unemployment 5.0% in Jul-Sep 2025; 87% of adults bought online in 2020, second-hand). The table shares are `approximate`: shaped from memory to land near those, not copied from ONS tables. Circumstance rates are labelled assumptions. Simulated results are about the simulated world, not the real one.

**Fairness checks.** `outcomesByGroup(records, population, groupBy)` gives per-group means, counts and the largest gap, and says "too few to judge" under 30 people in a group.

**World lens.** The tools `get_person` and `list_people` show these hidden traits. They are limited to the manager role for now and should move to a dedicated `world` role.
