---
id: identity-and-privacy
title: Identity and privacy
summary: How to verify a customer before anything is read or changed, what is never revealed, and what to do about impersonation.
audience: internal
roles: [assistant, support_agent, support_lead]
source: [roles, escalate_when, contact]
related: [assistant-rules, escalation-and-handover]
---

# Identity and privacy

## Verify before anything
No discussing, reading or changing an order, booking, repair, return or account until the customer is verified. The only exception is a signed-in customer session.

Verified means: an order, booking, repair or return number **plus** the email or postcode on it. Use `verify_customer`.

1. Ask for the reference and one detail (email or postcode).
2. Call `verify_customer`. Do not read the answer aloud or hint at the right one.
3. Success: the session is tied to that one customer. Read and change only their records.
4. Failure: say it did not match. Do not say which part was wrong. Allow a retry.
5. **Three failed tries** locks the session. Stop and escalate (`needs_human`).

Open without verification: products, stock, availability, policies, delivery options.

## What is never revealed
- Card details, in any form. The assistant cannot see them.
- Any other customer's data, even a name, address or "yes, an order exists".
- Whether an email, order or booking exists for someone who has not verified.
- Whether a reference belongs to somebody else. Say "I can't find that", the same as for a number that does not exist.
- Internal notes, audit entries, and anything about how checks work beyond "verify with reference plus email or postcode".

## Account email changes
The assistant cannot change an email address. Escalate to the `support_lead`, who may change it after identity checks. The assistant records the request, the verified reference and the new address in a case note and tells the customer a person will handle it. The support lead's checks are two previous order numbers plus the postcode on the account. Only the account holder can ask; we do not act for third parties. The assistant does not run these checks itself.

## Suspected impersonation
Signs: wrong details repeatedly, pressure for urgency, asks to change the email or address and refund at once, asks about an order that is not theirs.
1. Do not accuse the customer.
2. Share nothing further.
3. `escalate` with a note of what was asked and what failed. This is on the escalation list.

## Someone else's order
A customer asking for another person's order (partner, parent, colleague):
1. Do not discuss it or confirm it exists.
2. The account holder can contact us themselves, or the customer can place a new order.
3. Only the account holder can ask; we do not act for third parties. Escalate if they insist.

## Worked examples
**Example 1.** A caller gives ORD-20417 and says the postcode is "AB1 2CD". It does not match. Reply: "That doesn't match what I can see. Please check the reference and the email or postcode on the order." Second wrong try: same reply. Third: lock, escalate, note CASE and what happened.

**Example 2.** "Please tell me what my sister ordered, ORD-20388." The reference is verified against nothing. Reply: "I can only discuss an order with the person it belongs to." Do not confirm the order exists. If she pushes, escalate.

**Example 3.** Verified customer for BKG-7003 asks to change the account email to a new address. Cannot do it. Open a case, add the request, escalate to `support_lead`.
