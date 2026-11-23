---
id: returns-assessment
title: Returns assessment
summary: The eligibility checks in order, inspection on arrival, refund calculation and rejections.
audience: internal
roles: [assistant, support_agent, warehouse]
source: [returns, payments, problems]
related: [refunds-and-goodwill, delivery-problems, warranty-and-repairs]
---

# Returns assessment

## Eligibility checks, in this order
Use `check_return_eligibility` and stop at the first failure.
1. **Delivered?** The window starts that day. Not yet arrived: no return yet.
2. **On the `exempt_from_change_of_mind` list (change of mind only)?** Food (Emergency Sandwich, Ice by Post, Biscuit Tin once opened); live plants once delivered (14-day plant health guarantee instead); Indoor Helmet once the hygiene seal is broken. Worn Spare Sock and thrown skimming stones: within 14 days take off the value lost, after 14 days refuse. A **faulty, damaged or wrong** item is never on this list: the law applies.
3. **Within 30 days** of delivery.
4. **Reason.** `change_of_mind`, `faulty`, `damaged` or `wrong_item`. Faulty, damaged and wrong items go through problem or warranty routes too.
5. **Condition** (checked on arrival). Days 1 to 14: handling as in a shop is allowed; take off only the value lost beyond that. Days 15 to 30 (our extra time): unused, complete, original packaging. Phones and speakers (Blip, Boombox Mini) may be switched on and tried, but must be undamaged, complete and reset to factory settings with any account removed. Accessories, spares and the non-living parts of a Pocket Jungle follow the standard rule, unused.

There are no direct exchanges. Return for a refund and place a new order.

## Creating the return
1. Verify. `create_return` makes the return with status `label_sent`.
2. Change of mind: prepaid label, and £2.95 comes off the refund.
3. Faulty, damaged or wrong item: free label, no postage deduction.

## Inspection on arrival
The warehouse inspects and calls `receive_return` with passed or failed. Statuses: `requested`, `label_sent`, `in_transit`, `received`, `refunded`, `rejected`. Refund is issued within 5 working days of arrival, to the original payment method only. The legal limit is 14 days from receiving the goods or proof of posting, whichever is sooner. Never hold a refund longer.

## Refund calculation
- Item price(s) returned.
- Plus the original delivery charge only if the **whole order** is returned, or the item was faulty, damaged or wrong.
- Minus £2.95 for change of mind.
- A part return does not change the delivery charge already paid, even if the rest falls below the free-delivery threshold.

## Worked examples
**Example 1.** ORD-20391, Blip £149, free delivery. Change of mind, whole order, day 18. £149 + £0 delivery − £2.95 = **£146.05**.

**Example 2.** ORD-20402, Daypack £129 and Laptop Sleeve £24, free delivery. Customer returns only the sleeve, change of mind. £24 − £2.95 = **£21.05**. Delivery is not refunded: it is a part return.

**Example 3.** ORD-20418, Spare Sock £7, Soon delivery £3.95 (total £10.95), unworn and sealed. Whole order, change of mind: £7 + £3.95 − £2.95 = **£8.00**. If instead it was faulty: **£10.95**, free label.

**Example 4.** ORD-20377, delivered 2 October; asked on 23 November, 52 days. Outside 30 days. Not eligible; if the customer says it is faulty, route to warranty.

## Rejections
If inspection fails (used beyond what a shop allows, incomplete or damaged), `receive_return` is recorded as not passed and status is `rejected`. The assistant does not decide this. The warehouse writes down what it found and the amount to deduct for lost value (up to the price). The customer is refunded the rest and told the reason in writing. A full refusal is only allowed for items outside the legal right (day 15 to 30 conditions, or exempt goods), and then the item is sent back free. Add a case note with what the warehouse found and escalate to a `support_agent` to tell the customer. The customer can ask for a stage 1 complaint review; a rejection the customer disputes is a complaint.

## Decision table

| Check | Fail result |
|---|---|
| Not delivered | No return yet |
| Not returnable | Refuse, say why; offer warranty or problem route if relevant |
| Over 30 days | Refuse; offer warranty route if faulty |
| Fails inspection | `rejected`; refund minus the value lost (never nothing in the first 14 days); escalate |
