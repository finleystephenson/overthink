---
id: warranty-and-repairs
title: Warranty and repairs
summary: How to work out whether an item is in warranty and how a Fix Club repair moves status by status.
audience: internal
roles: [assistant, technician, support_agent]
source: [warranty, fix_club]
related: [returns-assessment, refunds-and-goodwill, escalation-and-handover]
---

# Warranty and repairs

## Working out in-warranty
1. **Is the product Fix Club eligible?** Blip, Boombox Mini, Daypack, Indoor Helmet, Starter Puddle, Other Umbrella, Trophy. Everything else is not (the sandwich is not covered).
2. **Proof of purchase.** An order number or a product registration. No proof: no warranty claim.
3. **Months.** 12 default; 24 for tech (Blip, Boombox Mini); 60 for Daypack. None for food, live plants, paper and card.
4. **Count** from the day the order was delivered to today. `create_repair` works out `in_warranty`.
5. **Cause.** Warranty covers faults in materials and manufacture under normal use. It excludes accidental damage (drops, liquid), normal wear (battery capacity fading to 80%), repairs by anyone but The Fix Club, and loss or theft.

An item can be inside the months and still out of warranty because of the cause.

## Repair journey

| Status | Meaning | Who moves it |
|---|---|---|
| requested | Request opened | assistant or customer |
| awaiting_item | Waiting for the item to arrive | technician |
| received | Item arrived | technician |
| assessing | Under assessment | technician |
| quote_sent | Out-of-warranty quote sent | technician |
| approved | Customer accepted the quote | assistant passes approval on |
| in_repair | Being fixed | technician |
| repaired | Fixed | technician |
| returned | Sent back | technician |
| declined | Customer declined the quote | technician |
| unrepairable | Cannot be fixed | technician |

Target turnaround is 10 working days, counted from the day the item arrives at The Fix Club. The assistant only repeats a date the record shows (`promised_by`). Repairs carry a 90-day repair warranty.

## Postage and fees
- **In warranty:** free label both ways. No assessment fee.
- **Out of warranty:** customer pays £4.95 to send it in. Return postage is in the repair price. £15 assessment fee, out of warranty only. Taken when the item arrives. Taken off the repair price if the quote is accepted, kept if the quote is declined, refunded if the item is found unrepairable.

## Quotes
1. Only the technician writes a quote. The assistant quotes only the fixed prices: Blip screen £49, battery £29; Boombox Mini battery £35; Daypack zip £25, buckle fitted £8. A repair with no fixed price in the product record (Indoor Helmet re-stitching, Starter Puddle chip and crack, Trophy re-plating, anything on the Other Umbrella) is quoted by the technician after assessment. The assistant never estimates it.
2. A quote is valid 14 days (`quote_valid_days`). `approve_repair_quote` fails once it has expired. Escalate to the technician for a new one.

## Unrepairable
In warranty: remedy is repair first, replacement if a repair is not possible, refund if neither is possible. A technician declares it unrepairable; then escalate to `support_agent`. Out of warranty: the assessment fee is refunded if the item is found unrepairable.

## Worked examples
**Example 1.** FIX-5008: Blip bought 2025-12-01 (REG-6004), warranty to 2027-12-01. Screen cracked after a drop. Inside 24 months but accidental damage is excluded, so out of warranty. Quote £49 (screen). Customer pays £4.95 postage, and the £15 assessment fee comes off: £49 − £15 = £34 balance.

**Example 2.** FIX-5012: Daypack bought 2023-03-10, zip fault. 60 months runs to 2028-03-10. Fault is manufacture, so in warranty: free labels, no fee, no charge for the zip.

**Example 3.** FIX-5015: Boombox Mini battery holds 80% after 20 months. Capacity fading to 80% is normal wear, excluded. Out of warranty: quote £35.

## Legal rights come first
The warranty is on top of the law. A fault that was there on delivery, or shows within 6 months, is repaired or replaced free under the Consumer Rights Act 2015 s.23 even if the warranty has ended or the customer used a non-Fix Club repairer. Do not refuse on warranty grounds alone: escalate to a `support_agent`.
