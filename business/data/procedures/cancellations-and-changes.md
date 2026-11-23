---
id: cancellations-and-changes
title: Cancellations and changes
summary: What can be cancelled or changed on an order, until when, and how to record it.
audience: internal
roles: [assistant, support_agent, support_lead]
source: [orders, payments, delivery]
related: [order-handling, refunds-and-goodwill, escalation-and-handover]
---

# Cancellations and changes

## The rule
An order can be cancelled or changed **until it is packed** (`cancel_until`, `change_until`). Once packed, it cannot be changed and the assistant cannot cancel it. A customer who wants to cancel a packed delivery order still has the legal right to (Consumer Contracts Regulations 2013 reg 29, up to 14 days after delivery). Treat it as a return after arrival. The exception is The Emergency Sandwich and Ice by Post once packed: perishable goods, no legal right to cancel.

Allowed changes (`changes_allowed`) are only these three:
- delivery address
- delivery method
- a variant of the same product at the same price

Nothing else is a change. Adding an item, changing quantity or swapping to a different product means cancel and reorder.

## Steps: cancel an order
1. Verify the customer (see identity-and-privacy).
2. `get_order`. Read the status.
3. If status is `placed`, `paid` or `payment_failed`: continue. If `packed`, `dispatched`, `part_dispatched`, or `delivered`: stop. Explain it cannot be cancelled by the assistant but they can change their mind: they send it back after it arrives, with the £2.95 label charge. Never say they have no right to cancel.
4. Confirm with the customer what is being cancelled.
5. Call `cancel_order` with a reason. Only say it is cancelled if the call succeeded.
6. Tell the customer the refund goes to the original payment method only and takes up to 5 working days.

The assistant cancels a **whole order only** (`orders.partial_cancellation`). Removing one line from an order that is not yet packed needs a `support_agent`.

## Steps: change an order
1. Verify and read the order as above. It must not be packed.
2. Address: any UK mainland address. The area excludes Northern Ireland, the Scottish Highlands and Islands, the Isle of Man, the Channel Islands and abroad.
3. Delivery method: it must be allowed for the items. Chilled items only allow Cold. Live plants only allow Sooner, Monday to Thursday. The delivery options are Soon, Sooner and Cold.
4. Variant swap: same product, same price, in stock. Use `update_order` with `swap`.
5. If the change would alter the price, refuse it and offer cancel and reorder.

## Decision table

| Request | Not yet packed | Packed or later |
|---|---|---|
| Cancel whole order | Yes, full refund | Not by the assistant; treat as a return after arrival (legal right to cancel) |
| Change address | Yes | No |
| Change method | Yes, if allowed for items | No |
| Swap variant, same price | Yes, if in stock | No |
| Swap to a dearer variant | No; cancel and reorder | No |
| Cancel one line of several | Not by the assistant (whole order only); escalate to `support_agent` | No |

## Worked examples

**Example 1.** ORD-20520, status `paid`, Blip £149, free delivery. The customer wants to cancel. Cancel it; the full £149 returns to the original card within 5 working days.

**Example 2.** ORD-20533, status `packed`, Spare Sock £7 plus Soon delivery £3.95 (total £10.95). The customer has changed their mind. Packed orders cannot be changed, but the customer can still change their mind. Offer to return it after it arrives: a change-of-mind return refunds £7 plus £3.95 (whole order) minus £2.95 postage, so £8.00. Say there are no direct exchanges.

**Example 3.** ORD-20541, status `paid`, Emergency Sandwich Egg & Cress Single £9. Customer wants Ham Salad Single, also £9, in stock. Swap it.

## Chilled and plant orders
A chilled or plant order is cancellable until packed like any other. When the status is `part_dispatched`, the dispatched parcel is packed. The unpacked parcel can still be cancelled or changed. Because the assistant cancels whole orders only, escalate to a `support_agent` to cancel just that part.
