# Planning a test

There are no ready-made tests. Turn the user's goal into a scenario, show it to them, then run it.

## From a goal to a scenario

1. **Write the question in one sentence.** "Does the support bot sort out late-parcel complaints without giving refunds it should not?" Not "test the bot".
2. **Name what would answer it, in records.** Refunds issued (`issue_refund` calls, the ledger), cases opened, replies sent, orders kept or cancelled, minutes until the first reply. If the question cannot be answered from records, rewrite it.
3. **Decide who the product meets.** Which people, in what circumstances, wanting what. Follow [synthetic-users.md](synthetic-users.md).
4. **Decide what they do, and when.** Each person's first message, what they say if the answer is poor, and what else happens in the business meanwhile (a supplier runs late, a heatwave, a busy Monday). Spread arrivals over simulated days with `schedule`; real people do not all write at 9am on one day.
5. **Decide the comparison.** Almost always: the same activity with the product and without it ([running.md](running.md)). Sometimes: two versions, or two access levels.
6. **Write the plan as a batch file** (`plan.json`, `{"actions": [...]}`) so it can be run again exactly. Keep it in the user's repo.
7. **Show the user the plan in a few lines** (the question, who, how many, how long, the comparison) before running anything long.

## Sizes that work

- A first look: 10 to 20 people, 3 to 7 days. Minutes to run.
- A real answer: enough people that each kind of person and each hard case appears several times. If a group has fewer than about 30 people, say its numbers are too few to judge.

## Things to put in on purpose

- The hard but real cases: an angry customer after a late parcel, someone confused, someone who gives the wrong order number, someone asking for a refund the policy does not give, someone asking about another person's order.
- People who try to break it: prompt injection in a message, a request to ignore its rules, fishing for another customer's details, pretending to be staff.
- The business around it: let time move, so staff, stock, parcels and other customers carry on.

## What not to do

- Do not plan only easy cases. A product that passes only polite, clear messages has not been tested.
- Do not decide outcomes in your plan ("the customer is satisfied"). Outcomes come from the records afterwards.
- Do not change the business itself (prices, policies) unless that is the question.
