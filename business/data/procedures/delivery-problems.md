---
id: delivery-problems
title: Delivery problems
summary: What to do when a parcel is late, lost, damaged, short, wrong, spoiled, held for heat, or carrying live plants.
audience: internal
roles: [assistant, support_agent, support_lead, warehouse]
source: [delivery, problems, orders]
related: [refunds-and-goodwill, escalation-and-handover, order-handling]
---

# Delivery problems

## Before anything
Verify the customer. Read the order and every shipment. The fast route is for problems reported within **14 days** (`quick_fix_within_days`); spoiled perishables within **24 hours** of delivery. These are our quick-fix windows only. They never remove a legal right. A later report of a faulty item is not refused: open a case and escalate to a `support_agent` (the customer can reject within 30 days, ask for repair or replacement, and claim for up to 6 years, 5 in Scotland).

## Late
1. A parcel is **late** when it is 2 working days past its expected delivery date (`late_definition_working_days`). Working days are Monday to Friday, not bank holidays.
2. Read tracking and `eta` from the shipment. Report only what the record shows. Do not promise a new date.
3. If late but not lost: open a case, note it, and tell the customer what the tracking says.
4. A parcel that arrives more than 2 working days after its estimated date earns a refund of the delivery charge on request. That is a refund, so escalate to a `support_agent`; the assistant does not do it.

## Lost
A parcel is **lost** after 5 working days (`lost_after_working_days`). Treat it as a missing item.

## Missing item
1. First check whether the order was split into two parcels. Look at every shipment.
2. If an undelivered second shipment exists, report its status. It is not missing.
3. If truly missing: send it again or refund it, the customer's choice.
4. The assistant may arrange a resend if the item is £60 or less and in stock. A refund for a missing item is not an assistant action: escalate to a `support_agent`.

## Damaged
1. Needs a photo. Ask for it.
2. Customer chooses a replacement or refund.
3. The damaged item need not come back unless it cost more than £60.
4. Assistant: replacement only if unit price is £60 or less and in stock. Refund or higher value: escalate.

## Wrong item
Send the right item free and provide a free label for the wrong one. Assistant limit is £60 and in stock; otherwise escalate.

## Spoiled perishables (Emergency Sandwich, Ice by Post)
1. Must be reported within 24 hours of delivery, with a photo.
2. Customer chooses a full refund or a resend.
3. The assistant may refund a spoiled item of £30 or less. Above £30, escalate.
4. Anything involving illness or an allergic reaction: escalate at once as a safety concern.

## Heat pause (Ice by Post)
When the forecast at the delivery address is 28°C or above, the order is held, not dispatched. Offer a new date or a refund. If the order is unpacked, the assistant can cancel it for a refund.

## Live plants (Pocket Jungle)
Sent by Sooner delivery only, Monday to Thursday, and not when the forecast is below 0°C. A live-plant order held for frost is treated like the heat pause: offer a new date or a refund; if the order is unpacked, the assistant can cancel it for a refund.

An unhealthy plant within 14 days of delivery has a 14-day plant health guarantee: a replacement plant is sent free. A photo is needed. The assistant may arrange the replacement within its limit (£60 or less, in stock); otherwise open a case and escalate.

## Decision table

| Problem | Assistant can | Otherwise |
|---|---|---|
| Missing, ≤£60, in stock | Resend | Escalate |
| Missing, wants refund | Record choice | Escalate to `support_agent` |
| Damaged, ≤£60, in stock | Replacement | Escalate |
| Wrong item, ≤£60, in stock | Resend and label | Escalate |
| Spoiled, ≤£30 | Refund | Escalate above £30 |

## Worked examples
**Example 1.** ORD-20702: Sandwich Single £9, delivered Monday, photo sent Monday evening. Within 24 hours and £9 is under £30: refund £9. The chilled delivery charge of £8.95 is refunded only if the whole order is returned or the item was faulty, damaged or wrong; refund the item only and escalate if the customer asks for more.

**Example 2.** ORD-20715: Daypack £129 arrived dented, photo supplied, day 5. Over £60, so no assistant replacement. Escalate to a `support_agent`; they can replace any value. The item must come back because it cost over £60.
