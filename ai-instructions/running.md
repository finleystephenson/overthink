# Running a test, with and without the product

## The basic run

```sh
overthink up --adapter overthink.adapter.ts           # terminal 1: the business, the product on its channels
overthink act batch --file plan.json                 # terminal 2: your people and their first messages
overthink act advance-time --days 7                  # time moves: scheduled activity arrives, the business carries on
overthink act observe --since 0                      # what happened
```

The product answers activity on its channels as it arrives, and again when a person writes back. To carry a conversation on, read the product's reply (`observe`, or the conversation in the records), write the person's next message with your model, and send it (`send-message --conversation-id ...`, or a reply email).

## With and without the product

The effect of the product is the difference between two runs that differ only in the product:

1. Run the plan with the product: `overthink up --adapter overthink.adapter.ts`, the batch, the same number of days. Save what you need (`observe`, the records).
2. Stop it. Start `overthink up` with no adapter (or `overthink reset --yes` if you reuse the same server and are comparing something else). Run the exact same batch file and days.
3. Compare the records: replies, refunds, cases, orders kept, minutes to first reply.

The sandbox starts the same way every time (same seed, same people drawn, same background customers), so the only difference is what the product did. Without a product, contacts wait for staff, as they would in the real shop.

`impact` (also `GET /sandboxes/{id}/impact`) compares the business with its shadow twin: the same business from the same start where nothing outside was done. It counts everything from outside (your activity and the product together), so use it for "what did all this do to the business", and the two-run comparison for "what did the product do".

## Versions and access levels

Run the same batch against each version (`overthink up --adapter overthink.adapter.ts#v2`) or each access level (`--access read_only`). Change one thing at a time.

## Repeats

One run is one story. Before saying "it works", run the plan again with a second set of people (in the same sandbox, `create_person` only draws people not yet used) and check the result holds.

## The optional twin-run tool

`overthink run --adapter overthink.adapter.ts` is a ready-made experiment: it plays model-voiced customers against the product over 30 days and 10 paired seeds and writes a report (`docs/run.md`). Use it when the user wants that report; it is one tool, not the method.
