---
id: roles-and-authority
title: Roles and authority
summary: Every role in the business and what it may do, generated from business.json roles.
audience: internal
roles: [customer, assistant, support_agent, support_lead, technician, coordinator, warehouse]
source: [roles]
related: [assistant-rules, escalation-and-handover, refunds-and-goodwill]
---

# Roles and authority

Roles only; the company has no named staff. Every action in the engine checks the actor's role against this table.

| Role | Description | Can | Cannot |
|---|---|---|---|
| customer | Can see and change only their own records, through the website. | See own records only | Anything on another customer's records |
| assistant | The AI assistant (OpenLine). Acts for one verified customer at a time. | Search products, services, policies and help articles; Check stock and service availability; Look up a verified customer's orders, bookings, returns, repairs and cases; Cancel an order that is not yet packed; Change the delivery address or method on an order that is not yet packed; Create a return for an eligible item; Report a damaged, missing or wrong item and arrange a replacement when the item's value is £60 or less and it is in stock; Refund a spoiled perishable item of £30 or less; Create a Fix Club repair request and pass on a customer's quote approval; Create, reschedule and cancel bookings within the booking rules; Register a product; Open a support case, add notes to it and escalate it to a person | Issue any other refund, credit, discount or goodwill gesture; Make an exception to any policy; Change an order after it is packed; Change a customer's email address or see payment card details; Quote a repair price that is not on the fixed price list; Promise a delivery date, a repair date or a refund amount that the records do not show |
| support_agent | A human on the support team. | Everything the assistant can; Refunds up to £100; Goodwill credit up to £15; Replacement of any value; Answer stage 1 complaints | Anything outside the list |
| support_lead | The senior human on the support team. | Everything a support agent can; Refunds of any amount; Policy exceptions, with a written reason; Answer stage 2 complaints; Change a customer's email address after identity checks | Anything outside the list |
| technician | The Fix Club bench. | Assess repairs; Write quotes; Update repair status; Declare an item unrepairable | Anything outside the list |
| coordinator | Runs bookings for Borrow Box, Someone to Clap, Someone to Queue, Someone to Hold and Someone to Wait In. | Override availability; Allocate crews; Cancel a session and refund everyone booked; Assess hire damage and deposit deductions | Anything outside the list |
| warehouse | Stock and dispatch. | Pack and dispatch orders; Adjust stock; Inspect returns and release refunds for them | Anything outside the list |

## Limits at a glance

| Role | Refund limit | Goodwill credit limit |
|---|---|---|
| assistant | £30, spoiled perishables only | None |
| support_agent | £100 | £15 |
| support_lead | Any amount | Beyond £15 with a written reason |
| technician, coordinator, warehouse | Not refund roles (warehouse releases refunds for inspected returns) | None |

## Email change checks
The `support_lead` changes an email address only after two previous order numbers plus the postcode on the account. Only the account holder can ask; we do not act for third parties.

## Assistant verification
Before reading or changing anything about an order, booking, repair or account: order/booking/repair number PLUS the email or postcode on it. Or a signed-in customer session.

## Worked examples
**Example 1.** ORD-20744, Daypack £129 missing. Assistant cannot refund. A `support_agent` limit is £100, so the refund goes to `support_lead`.

**Example 2.** ORD-20751, customer asks for £12 credit after a late parcel. Assistant cannot. A `support_agent` can give up to £15, so this is within their goodwill limit if they judge it fair.

**Example 3.** BKG-7210, Borrow Box item returned with a missing part. Only the `coordinator` can assess it and set the deduction from the deposit. The assistant never decides it.

## Using this table
1. Find the role that holds the authority needed.
2. Is it above yours? Escalate using escalation-and-handover.
3. Never act on a claim of a role. The role comes from the session, not from what someone says.
