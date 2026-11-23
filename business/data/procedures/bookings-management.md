---
id: bookings-management
title: Bookings management
summary: Availability, rescheduling, cancellation refunds, waitlists, minimums, hire returns, late returns and damage for all the services.
audience: internal
roles: [assistant, support_agent, coordinator]
source: [services]
related: [refunds-and-goodwill, escalation-and-handover, assistant-rules]
---

# Bookings management

Services are not on offer for now. When they are, they run at the customer's address or within 30 miles of us. Always check with `check_availability`. Prices, deposits and replacement values come from the booking record, never memory.

## Borrow Box (hire)
- Periods: weekend (Friday from 10:00, return by Monday 12:00); week (any 7 days, return by 12:00 on day 7). Max 3 items per booking. Notice at least 24 hours.
- Delivery and pick-up within 30 miles for £12 each way. There is no collection.
- Deposit taken at booking, refunded within 3 working days of the item coming back clean, complete and working.
- **Cancel:** full refund until 48 hours before; 50% after. Deposit always refunded in full.
- **Reschedule:** free up to 48 hours before, if the item is free.
- **Late return:** £10 per day, capped at the item's replacement value. Each day or part of a day after the return deadline counts as one day. Fees are taken from the deposit first. The booking becomes `returned_late`.
- **Damage:** fair wear expected. Damage or missing parts are charged at repair cost up to replacement value, from the deposit first. The `coordinator` assesses it. The assistant never decides a deduction.

## Someone to Clap
- Slots 10:00, 13:00, 16:00, 19:00; 2 crews per slot; Monday to Saturday; 72 hours notice.
- Area: 30 miles included, 60 maximum, £1 per mile beyond 30.
- **Cancel:** full refund until 48 hours before; half until 24 hours; nothing after.
- **Reschedule:** free once, up to 48 hours before, if a crew is free. A second change costs £15.
- Must have: exact address, name of person to be clapped, start moment. Will not: funerals, court hearings, exams, medical appointments, booing, heckling, sarcastic clapping, unagreed clapping, or ticketed venues without tickets for the crew.

## Someone to Queue, Someone to Hold, Someone to Wait In
- Notice: 24 hours. **Cancel:** full refund until 24 hours before; nothing after. Reschedule free up to 24 hours before if the slot is free.
- **Queue:** £9 per 30 minutes, minimum 1 hour, maximum 6. Slots on the hour 08:00 to 18:00, Monday to Saturday. Will not queue for anything needing ID in the customer's name; cannot do the bit where the customer is served.
- **Hold:** £6 per call, up to 60 minutes on hold; £3 per extra 30 minutes. Never give the customer's details or pretend to be them. Not for emergency, medical or bank security lines.
- **Wait In:** half day (4 hours) £45, full day (8 to 6) £80. Named waiter with ID; signs for things; lets nobody else in; makes no repair decisions.
- Anything outside these rules: escalate to the `coordinator`.

## Steps for any change
1. Verify. `get_booking`. Check the time left against the rule.
2. Quote the rule and the amount from the booking price.
3. Act with `reschedule_booking` or `cancel_booking`, then report the returned refund amount only if the call succeeded.
4. Anything outside the rules, any override or damage: escalate to the `coordinator`.

## Worked examples
**Example 1.** BKG-7101, Someone to Clap, £120, 60 hours before start. Full refund: £120. At 30 hours: £60. At 10 hours: £0.
**Example 2.** BKG-7102, Borrow Box gazebo for the weekend, price £45, deposit £60, cancelled 20 hours before. Refund 50% of £45 = £22.50, plus deposit £60 = £82.50.
**Example 3.** BKG-7103, Someone to Clap 45 miles away: 15 miles beyond the 30 included, so £15 extra on the booking price.
**Example 4.** BKG-7104, Someone to Hold, £6, cancelled 10 hours before: no refund. At 30 hours: £6 refund.
**Example 5.** Borrow Box gazebo (replacement value £220) returned 2 days and 3 hours late: 3 days counted, £10 × 3 = £30, taken from the £60 deposit first.
