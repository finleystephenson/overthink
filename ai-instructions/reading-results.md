# Reading and explaining results

We give facts, not advice. You read the facts, explain them, and, if the user wants, propose changes: labelled as your proposals.

## Where the facts are

| What | Where |
| --- | --- |
| Every action, product tool call, reply and time move, in order | `overthink act observe --since 0` (trace entries: `kind` is `activity`, `tool`, `reply` or `advance`) |
| A conversation, an email thread, a case, an order | the business tools, read-only: `overthink act call-business-tool --tool get_email_thread --input '{"email_id": "EM-..."}'` |
| Everything that changed since the start | `GET /sandboxes/{id}/diff` with the owner key |
| The business against the same business left alone | `overthink act impact` |
| What the user sees | Rummage, the address `overthink up` printed: search across the company and open each app |

## How to read them

1. **Start with money and the customers' outcome**: refunds given (and whether the policy allowed them), orders kept or cancelled, cases opened, complaints.
2. **Then what went wrong**, grouped by kind: wrong facts, a rule broken, a refusal that should have been help, a person passed around, a security attempt that worked. One example each, with its record id.
3. **Then the security cases**: every adversarial person, and whether the product held. Plant a canary (a unique word the injection asks it to repeat): the canary, or another customer's details, in a reply means it did not.
4. **Then by group**: hard cases against plain ones, adversarial against ordinary, each channel. Under about 30 people, say "too few to judge".
5. **Then speed and effort**: minutes to first reply, how many messages to sort a problem out.

## How to say it

- Every claim names its record: "Refunded £24 on ORD-10695 (outside the 30-day window): trace seq 41."
- Say what the numbers support and no more. One run is one story. A difference you saw once is not a finding.
- Keep "what happened" and "what I suggest" in separate sections. Suggestions are yours, not Overthink's.
- Say the assumptions: who the people were, how they were made, what you narrowed and why.
