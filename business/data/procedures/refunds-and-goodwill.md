---
id: refunds-and-goodwill
title: Refunds and goodwill
summary: Who may refund or credit what, the limits, and how to record it.
audience: internal
roles: [assistant, support_agent, support_lead, warehouse]
source: [roles, payments, returns, problems]
related: [returns-assessment, delivery-problems, escalation-and-handover]
---

# Refunds and goodwill

## Who can do what

| Role | Refunds | Goodwill credit | Exceptions |
|---|---|---|---|
| assistant | Only a spoiled perishable of £30 or less; refunds as part of cancelling an unpacked order | None | None |
| support_agent | Up to £100 | Up to £15 | None |
| support_lead | Any amount | Above £15 (any amount agent cannot give) | Yes, with a written reason |
| warehouse | Releases refunds for returns it has inspected | None | None |

The assistant never offers or promises a refund, credit, discount or gesture it cannot do. It never says "I'll see what I can do".

## Rules for every refund
1. Refunds go to the **original payment method only**. No cash, no other card, no bank transfer.
2. Payment refunds arrive within 5 working days. Return refunds are issued within 5 working days of the return arriving. The legal limit is 14 days from receipt or proof of posting; a refund for faulty goods is due within 14 days of agreeing it is owed.
3. Refunds go to the original payment method only.
4. A late parcel (more than 2 working days after its estimated date) earns a refund of the delivery charge on request. A `support_agent` does it, not the assistant.
5. The amount must match the records. Never promise an amount the order does not show.

## Steps: staff refund
1. Check identity and read the order.
2. Work out the amount from the matching procedure (returns, delivery problems, bookings).
3. Within your limit? Call `issue_refund` with order number, amount and a reason that names the rule.
4. Above your limit: add a case note and escalate to `support_lead`.
5. Add a case note saying what was refunded, why and the amount.
6. Tell the customer the amount and the 5 working day timing. Do not state a date the record does not show.

## Steps: goodwill credit
1. Only where no rule gives the customer what they ask for, and only a human decides.
2. Up to £15: `support_agent` calls `add_goodwill_credit` with customer id and reason.
3. Over £15, or any policy exception: `support_lead`, with a written reason.
4. Never offer goodwill to settle a complaint on the assistant's own authority.

## Worked examples
**Example 1.** ORD-20702: spoiled Sandwich Three-pack £24, reported 6 hours after delivery with a photo. £24 is within the assistant's £30 spoiled limit. Refund £24 to the original card.

**Example 2.** ORD-20744: customer reports a missing Daypack £129 (confirmed not in a second parcel) and wants a refund. £129 is above the agent's £100 limit. Escalate to `support_lead`. Note the item, price, tracking and the 14-day report date.

**Example 3.** ORD-20751: a late parcel, customer asks for £20 credit. £20 is above the £15 agent limit. A `support_agent` can give up to £15; anything more needs the `support_lead` with a written reason. Whether late parcels earn credit is a human choice, not a rule.

## Decision table

| Amount and kind | Who |
|---|---|
| Spoiled perishable ≤ £30 | assistant |
| Any other refund ≤ £100 | support_agent |
| Refund > £100 | support_lead |
| Credit ≤ £15 | support_agent |
| Credit > £15, or exception | support_lead |
