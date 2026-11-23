# Live events: `overthink.live/1`

What a run streams while it happens: what the product read, what it did, what it said, and how people reacted. The local front door (`applications/home/`) reads it to show a live feed in which each line opens the app where it happened. A coding agent can read the same stream.

The TypeScript types are in `observability/live/events.ts`; this page is the contract. `schema` changes only when a reader would break. New event types and new fields inside `data` can be added without a bump, so readers must ignore what they do not know.

## Where it is

| Where | What |
| --- | --- |
| `<out>/live.jsonl` | Every event of the run, one JSON object a line, in `seq` order. Always written. Readable after the run. |
| `GET http://127.0.0.1:8741/live/events` | Server-sent events, while `overthink run --live` runs. `id:` is `seq`, `event:` is `type`, `data:` is the event as one line of JSON. Send `Last-Event-ID` (browsers do on reconnect) or `?since=<seq>` to replay everything after that event first. A comment line (`: ping`) every 15 seconds keeps proxies open. |
| `GET http://127.0.0.1:8741/live/events.jsonl` | Everything so far as JSON lines, then the response ends. |
| `GET http://127.0.0.1:8741/live/status` | `{"schema", "run", "state": "running" \| "finished" \| "stopped", "events": <count>, "last_seq"}`. |

`--live-port <n>` changes the port. The server listens on 127.0.0.1 only, is read-only, and sends `Access-Control-Allow-Origin: *` so a page on another local port can read it. It stays up after the run finishes until the command is stopped (Ctrl+C), so a page opened late can still replay the whole run.

## The envelope

Every event has these fields:

```json
{
  "schema": "overthink.live/1",
  "seq": 42,
  "at": "2026-11-23T10:00:01.250Z",
  "run": "r-3f9c2a1b",
  "type": "product.acted",
  "arm": "with",
  "variant": "A",
  "seed": 1,
  "sim_time": "2026-11-26T10:14:00Z",
  "audience": "customers",
  "channel": "email",
  "session": "c42",
  "app": "letterbox",
  "record": "EM-000123",
  "link": "/apps/letterbox/?mailbox=hello&thread=CT-00012&seed=1&arm=with",
  "summary": "Sent an email (send_email)",
  "data": {}
}
```

| Field | Meaning |
| --- | --- |
| `schema` | Always `"overthink.live/1"`. |
| `seq` | 1, 2, 3 ... in the order things happened. Unique within a run. |
| `at` | Wall-clock time the event was written (ISO 8601). |
| `run` | The run's id; the same in every event of one `overthink run`. |
| `type` | See below. |
| `arm` | `"with"` (the product is in the business), `"without"` (the twin without it), or `null` for run-level events. Most readers show only `with`. |
| `variant` | With `--compare`: `"A"` or `"B"`, which product (or access level) this is. `null` otherwise. |
| `seed` | Which paired run, or `null` for run-level events. |
| `sim_time` | The simulated time in the business (ISO 8601), or `null`. |
| `audience` | `customers`, `staff`, `businesses`, `suppliers`, `public`, or `null`. |
| `channel` | Where it happened: `web_chat`, `email`, `phone`, `text`, `mutter_dm`, `squint_dm`, `mutter_mention`, `internal`, `supplier_mail`, `outreach`, `publishing`, or `null`. |
| `session` | The conversation or piece of work (`session_id` in the adapter contract), or `null`. |
| `app` | The company app to open: `letterbox`, `front-desk`, `kettle`, `mutter`, `squint`, `till`, `stockroom`, `tally`, `megaphone`, `filing-cabinet`, or `null`. |
| `record` | The id of the record it concerns (an email, contact, post, order, purchase order, prospect), or `null`. |
| `link` | A path on the `overthink view` server that opens that record, or `null`. Valid once the run has finished and `overthink view --run <out>` serves it. |
| `summary` | One plain line for a feed. Facts only. |
| `data` | The type's own fields (below). |

## Types

| `type` | When | `data` |
| --- | --- | --- |
| `run.started` | Once, first. | `adapter` (label), `variants` (`[{id, adapter, access}]`, one unless `--compare`), `seeds`, `days`, `size`, `job`, `audience` (list), `channels` (list or `null` for all), `people` (`"rules"` or `provider:model`). |
| `arm.started` | Each arm of each seed. | `{}` |
| `contact.raised` | A person reached the product. | `who` (`{kind, name}`; never more about them), `topic`, `situation` (the persona's situation id, or `null`). |
| `product.read` | A tool call that only reads. | `tool`, `arguments`, `ok`, `code` (error code or `null`). |
| `product.acted` | Any other tool call. | `tool`, `arguments`, `ok`, `code`, `refused` (the role, scope or a business rule stopped it). |
| `product.replied` | The product's words reached a person. | `text` (at most 2,000 characters), `to` (`{kind, name}`). |
| `product.published` | The product put out content: a post, a newsletter, a product page. | `kind` (`post`, `newsletter`, `product_page`), `network` (`mutter`, `squint` or `null`), `text` (at most 2,000 characters), `content_hash`. |
| `person.reacted` | A person (or a panel) responded. | `kind` (below), plus its own fields. |
| `day.ended` | The end of each simulated day in an arm. | `date`. |
| `arm.finished` | Each arm of each seed. | `figures`: `net_profit`, `revenue`, `orders`, `customer_satisfaction`. |
| `run.finished` | Once, last. | `results` (path to `results.json`, or `compare.json` with `--compare`), `headline`. |
| `run.stopped` | Instead of `run.finished` when the run stopped early. | `why`. |

`person.reacted` kinds:

| `data.kind` | Fields |
| --- | --- |
| `customer` | `ending` (`satisfied`, `gave_up`, `out_of_turns`, `passed`, `product_error`), `sorted` (from the records), `text` (their last words, if any). |
| `panel` | `content_hash`, `panel_size`, `decisions` (count per decision among the panel: `ignore`, `like`, `reply`, `share`, `visit`, `buy`, `unsubscribe`, `complain`), `scaled` (the same, scaled to everyone the content reached; see `docs/audiences.md`), `replies` (ids of the reply records written). |
| `buyer` | `prospect` (id), `decision` (`ignore`, `reply`, `ask`, `meet`, `buy`, `unsubscribe`, `complain`), `text` (their reply, if any), `clamped` (what code changed). |
| `staff` | `staff_id`, `role`, `used` (whether they used the tool), `worked`, `didnt` (lists of short lines), `minutes_saved` (negative when it cost time), `share_of_workload`. |
| `supplier` | `supplier` (name), `decision` (`agreed`, `refused`, `answered`), `text`. |

## Rules for readers

- Show `summary` as the line; open `link` (or `app` and `record`) when it is clicked.
- Ignore unknown `type`s and unknown fields.
- `seq` has no gaps within `live.jsonl`. Over SSE, reconnect with `Last-Event-ID` and nothing is lost.
- Events never contain keys, people-model prompts, or anything about a synthetic person beyond their name and kind.
