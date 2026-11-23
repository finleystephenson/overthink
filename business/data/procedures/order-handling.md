---
id: order-handling
title: Order handling
summary: How an order moves from placed to delivered, including split chilled parcels, partial fulfilment, failed payments and pre-orders.
audience: internal
roles: [assistant, support_agent, warehouse]
source: [orders, delivery, payments]
related: [cancellations-and-changes, stock-issues, delivery-problems]
---

# Order handling

## The normal path
Statuses (from `orders.statuses`): `placed`, `paid`, `payment_failed`, `packed`, `dispatched`, `delivered`, `cancelled`, `part_dispatched`. (`ready_to_collect` and `collected` exist in the data but are not used: there is no collection.)

1. **Placed.** The order exists. Payment is attempted at once.
2. **Paid.** Payment succeeded. The order can still be cancelled or changed.
3. **Packed.** The warehouse has packed it. From here it cannot be changed, and the assistant cannot cancel it. The customer still has the legal right to cancel a delivery order (Consumer Contracts Regulations 2013 reg 29), so a cancel request on a packed order is handled as a return when it arrives.
4. **Dispatched.** A shipment has a carrier and tracking number.
5. **Delivered.**

Only the warehouse moves an order forward (`advance_order`). The assistant reads status; it never changes it except by cancelling or changing an unpacked order.

## Split shipments for chilled items
The Emergency Sandwich and Ice by Post travel only by Cold (£8.95), as their own parcel. Chilled dispatch is Monday to Thursday only, delivered next day before 1pm; order cut-off is 12:00.

1. Put chilled lines in one shipment, everything else in another (`SHP-xxxxx-1`, `SHP-xxxxx-2`).
2. The customer pays one delivery charge: the chilled one.
3. When one parcel has left and the other has not, the order is `part_dispatched`.
4. Tell the customer there will be two parcels, and give each parcel's tracking.

**Example 1.** ORD-20610: Three-pack sandwich £24 and Daypack £129. Items £153, delivery £8.95, total £161.95. Two parcels, one delivery charge.

**Example 2.** ORD-20611: Ice by Post £16 and one Spare Sock £7, ordered Friday. Chilled does not dispatch on Friday, so the ice parcel waits for Monday. The sock may go first and the order shows `part_dispatched`.

## Partial fulfilment (one item out of stock)
1. Check stock with `check_stock`. Read the restock date from the record only.
2. Tell the customer which item is short and its restock date.
3. Offer: wait for the item, or cancel the unpacked order for a full refund. Never substitute without asking.
4. In-stock items are sent straight away. Pre-order and out-of-stock items follow when available, at no extra delivery charge. Say so; no escalation is needed for the charge.

## Payment failed
There are four ways to pay, listed in `payments.methods`: Card, Tap (phone wallet), PayPost (an account the customer logs into) and Later (pay in 30 days). Use `payment_methods` to see them, and which ones a bag can use and why not. Card results come from `payments.test_cards` (Stripe-style numbers): `paid`, `declined` or `needs_check`. The other methods have their own outcomes, each `paid` or `declined`. Any failed payment saves the order as `payment_failed` and shows that outcome's message. The order's `payment.method` says how they tried to pay.
1. Status is `payment_failed`. Nothing is packed.
2. Tell the customer the payment was declined and that no money was taken. Do not guess a reason beyond what the record says.
3. The order is held for 24 hours (`payment_failed_hold_hours`), then cancelled. Stock is not reserved while it waits.
4. The customer retries at checkout. The assistant cannot take payment.
5. Never ask for or read out card details.

## Pay later (Later)
1. Later is for orders from £10 to £250, not counting delivery, and not for a bag of only Cold food. If a customer asks why they can't use it, `payment_methods` gives the reason in plain words.
2. An approved order is `paid` and is packed and sent as normal. Its payment status is `due`, with the amount and the `due_date` (30 days after the order).
3. Finance marks it paid with `settle_pay_later` once the money is in.
4. Until then, a refund of any kind takes the amount off what is owed. Nothing is sent back, because nothing was paid. Say it that way: "That's been taken off what you owe."
5. If the quick check says no, nothing is owed. The customer can pay another way.

## Pre-orders
A pre-order ships from the product's available-from date.
1. Say the ship date as "from 14 December 2026", never as a delivery date.
2. Payment is taken when the pre-order is placed.
3. It can be cancelled for a full refund any time before it is packed, or changed like any other order.
4. Accessories ordered with it ship straight away.
5. The 30-day return window starts when it is delivered, not when it was ordered.

## Decision table

| Situation | Action |
|---|---|
| Paid, not packed | Can cancel or change |
| Packed or later | Cannot change. Cancel request: treat as a return after arrival (legal right); food that is packed cannot be cancelled |
| `payment_failed` | Customer retries; do not pack |
| Chilled plus other items | Two parcels, one chilled charge |
| Item short | Offer wait or cancel; no substitutions |
