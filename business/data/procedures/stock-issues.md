---
id: stock-issues
title: Stock issues
summary: What to do when an item is out of stock, has a restock date, is oversold, or someone suggests a substitute.
audience: internal
roles: [assistant, support_agent, warehouse]
source: [orders, delivery]
related: [order-handling, cancellations-and-changes, assistant-rules]
---

# Stock issues

## Principles
1. Stock comes from `check_stock` or the product record. Never guess.
2. A restock date is only stated if the record has one. Say it as "listed as" and not a promise.
3. **Substitutions are never made without asking.** The customer chooses. No item is swapped in silently, even a similar one.
4. Food is made to order and has no restock date.

## Out of stock, before ordering
1. `check_stock` for the SKU.
2. In stock: carry on. Out with a restock date: give the date. Out with no date: say there is none listed.
3. Offer other variants of the same product that are in stock. Name them and their price. Leave the decision to the customer.
4. Do not offer to hold or reserve stock unless a tool exists for it. None does.

## Out of stock, after ordering (oversold)
1. Read the order status. The warehouse finds the shortage at packing.
2. Contact the customer through the case. Say which item is short and the restock date if recorded.
3. Offer three choices: wait; a different variant (customer chooses); or cancel the unpacked order with a full refund (see cancellations-and-changes).
4. A swap to another variant is only allowed at the same price (`update_order`). A swap to a different price needs a cancel and reorder, or a `support_agent`.
5. If the customer has already contacted twice about it, escalate.

## Partial fulfilment
When one item in a multi-item order is out, the order can wait, or the unaffected items go now. In-stock items are sent straight away; the out-of-stock item follows when available at no extra delivery charge.

## Warehouse duties
`adjust_stock` sets on-hand count and an optional restock date. Record the reason in the audit. Do not set a restock date that is a guess.

## Decision table

| Situation | Action |
|---|---|
| Out, date listed | Quote date as listed; offer wait or alternatives |
| Out, no date | Say none is listed; offer alternatives |
| Oversold after order | Offer wait, swap or cancel |
| Customer asks for "something similar" | List options; they choose |
| Same product, same price, in stock | Swap allowed |

## Worked examples
**Example 1.** ORD-20830: Emergency Sandwich Cheese & Tomato Single £9 is out of stock. The customer asks for Egg & Cress Single instead. Egg & Cress Single is the same product at the same price and in stock. Offer it; on a yes, swap with `update_order`. Do not do it without the yes.

**Example 2.** ORD-20841: Skimming Stones Skips (5) £12 is oversold and packed items elsewhere in the order are untouched. The order is not packed. Offer: wait for the listed date, switch to The Boulder (£18, different price: not a swap, so cancel and reorder), or cancel for a full £12 refund within 5 working days. Never ship The Boulder unasked.
