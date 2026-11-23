---
id: complaints-handling
title: Complaints handling
summary: How to spot a complaint, the two stages, the time limits and what to record.
audience: internal
roles: [assistant, support_agent, support_lead]
source: [complaints, roles, escalate_when]
related: [escalation-and-handover, refunds-and-goodwill, assistant-rules]
---

# Complaints handling

## What counts as a complaint
Any expression of dissatisfaction the customer wants recorded or resolved. "This is the second time" or "I want to complain" both count. A plain question about status does not.

## Stage 1
- Handled by any member of the support team (`support_agent` or above).
- Acknowledge within **1 working day**.
- Answer within **3 working days**.

## Stage 2
- The customer disagrees with the stage 1 answer and asks for a review.
- The `support_lead` reviews it. Answer within **10 working days**.
- This is the company's final answer. Say so plainly.

Working days are Monday to Friday, not bank holidays. Phone and email hours are Monday to Saturday, 09:00 to 17:30.

## Steps: the assistant
1. Stay calm and do not argue or defend.
2. Open a case with `open_case`, `is_complaint: true`.
3. Record the facts (see below).
4. `escalate` to `support_agent`. The assistant cannot settle a complaint and cannot offer credit, refund or an exception.
5. Tell the customer: it is recorded, a person will reply, acknowledged within 1 working day and answered within 3 working days.
6. Do not promise an outcome.

## Steps: support agent (stage 1)
1. Read the case notes and the linked order, return, repair or booking.
2. Acknowledge within 1 working day.
3. Resolve within the agent's authority (refund up to £100, credit up to £15), or escalate to `support_lead` if more is needed.
4. Record the answer with `add_case_note` and `resolve_case`.
5. If the customer is still unhappy, set `complaint_stage` to 2 and pass it to the `support_lead`.

## What to record
- What happened, in the customer's words, short.
- Linked order, return, repair or booking number.
- Dates: when it happened, when the customer contacted, when acknowledged.
- Earlier contacts on the same problem.
- What the customer wants.
- What was said or promised, and by whom (role).
- Stage and deadlines.

## What not to say
The company is not a member of an ombudsman or alternative dispute resolution scheme. Do not claim it is, or name a scheme. If the customer asks about outside routes, escalate. (Flagged for legal review in business.json.)

## Worked examples
**Example 1.** Customer on ORD-20915 writes "this is the third time my parcel hasn't turned up and I'm furious". Complaint, and repeat contact. Open CASE-9210 as a complaint, note the three contacts, escalate to `support_agent`. Tell the customer: acknowledged within 1 working day, answered within 3 working days. If raised on Monday, acknowledge by Tuesday, answer by Thursday.

**Example 2.** Stage 1 answered on 2 December for CASE-9215; the customer replies that it is not good enough. Move to stage 2. Support Lead answers within 10 working days: raised 3 December, so by 17 December. That answer is final.

## Decision table

| Customer says | Action |
|---|---|
| Wants to complain | Stage 1 case, escalate |
| Disagrees with stage 1 | Stage 2 to `support_lead` |
| Disagrees with stage 2 | No further stage; restate it is final; do not mention ombudsman |
