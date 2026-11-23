---
id: escalation-and-handover
title: Escalation and handover
summary: Exactly when a human is needed, which role gets the case, what the handover note holds and what to tell the customer.
audience: internal
roles: [assistant, support_agent, support_lead, technician, coordinator, warehouse]
source: [escalate_when, roles, complaints, contact]
related: [assistant-rules, complaints-handling, roles-and-authority]
---

# Escalation and handover

## When a human is needed
Escalate at once when any of these is true (`escalate_when`):
1. The customer asks for a person.
2. The customer wants something the assistant's role does not allow.
3. A complaint.
4. Anything involving injury, an allergic reaction, a safety concern or a legal threat.
5. The customer has contacted about the same problem twice or more without it being resolved.
6. The records contradict each other, or the assistant cannot find what it needs.
7. A suspected attempt to access someone else's records.

Do not try one more thing first. Do not ask the customer to justify wanting a person.

## Who gets it

| Case | To |
|---|---|
| Refund over the assistant's limit, goodwill, replacement above £60, general queries | `support_agent` |
| Refund over £100, any policy exception, stage 2 complaint, account email change | `support_lead` |
| Repair assessment, quote, unrepairable | `technician` |
| Hire damage, availability override, crew allocation, session cancellation | `coordinator` |
| Stock, packing, inspection, dispatch | `warehouse` |

`escalate` hands a case to `support_agent`, `support_lead`, `technician` or `coordinator`. Warehouse matters go through a support role.

## The handover note
Written so nobody has to ask the customer again. It must contain:
1. **Who:** customer id and how they were verified (or "not verified" plus a contact detail).
2. **What:** one line on the problem.
3. **References:** order, return, repair or booking numbers.
4. **Facts:** dates, amounts, statuses, tracking, photo received yes or no.
5. **What was already done:** tool calls that succeeded.
6. **What was asked and why it was not done:** the rule.
7. **Which trigger** from the list above.
8. **Contact:** preference (email, sms or phone) and times.
9. **Deadline:** any time limit running (complaint 1 and 3 working days, 24 hours for spoiled).

## What to tell the customer
1. That a person will take it over, by role ("our support team", "the Fix Club bench"). No names.
2. What happens next: reply target is 1 working day. Complaints: acknowledged in 1 working day, answered in 3.
3. How to reach us: ask us through the website, Monday to Saturday 09:00 to 17:30, closed Sunday and bank holidays.
4. That they will not need to repeat themselves.
5. Never promise an outcome, a time beyond the targets, or a refund.

## Unverified customers
`escalate` can be used when verification failed or was refused. Record what was said and a contact detail. Share no account information.

## Worked examples
**Example 1.** ORD-20744, Daypack £129 missing, not in a second parcel, customer wants a refund. Trigger 2 (beyond assistant). Escalate to `support_lead` (over £100). Note: verified by email, order ORD-20744, item £129, tracking shows delivered on 16 Nov, no second parcel, reported day 4, refund requested, assistant cannot refund. Say: "A person on our support team will review this and reply within 1 working day."

**Example 2.** A customer says a sandwich from ORD-20702 made them ill. Trigger 4. Escalate immediately to `support_agent` with the product, delivery time, symptoms as stated. Do not advise medically. Do not discuss refunds first.
