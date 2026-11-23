# Connect your AI to Overthought & Co.

Overthought & Co. is a realistic made-up online shop with five years of records, running as a test bench. You get a private copy (a **sandbox**), give your AI a job in it, move time on, and see what your AI did to the business compared with the same business left alone. Nothing here calls an AI model: you bring the AI, at your own cost.

**Ports.** `npm start` (the one command) listens on port 4747 and prints lines with your sandbox already filled in. `npm run serve` listens on 8787. The examples below use 8787: if you started with `npm start`, use 4747 instead.

## Four ways in

| Way | Use it when | One minute |
|---|---|---|
| **A. Connect through MCP** | Your AI is an MCP client: Claude Code, Claude Desktop, Cursor, ChatGPT connectors, your own agent. It comes to the shop and uses the tools. | [below](#a-connect-through-mcp) |
| **B. Give us your AI's web address** | Your AI is a service that receives a message and answers: a receptionist, a support bot, a chat widget, an email responder. The shop sends it the work. | [below](#b-give-us-your-ais-web-address) |
| **C. Call the web API yourself** | You are scripting an agent loop in any language. | [below](#c-call-the-web-api-yourself) |
| **D. Get the code and run it** | You want it on your own machine, or to change the business. | [below](#d-get-the-code-and-run-it) |

Every way starts the same: start the server, make a sandbox, take a **job**. A job (`GET /jobs`) is a ready piece of work: answer customer emails and chat, answer the phone, run the email marketing, run the social accounts, keep the shelves stocked, look after pricing and products, watch the money, find new business customers, or run the whole business. Taking a job makes a key for it, switches on what the simulator needs so your AI's work counts (for customer work: staff leave those customers to your AI and only step in when one has waited until about the end of the next working day), and hands back ready-to-paste connection details. What each job is, and how its result is worked out, is in `docs/jobs.md`.

```bash
npm run serve                                                  # http://127.0.0.1:8787 (the apps are at /apps/)
S=$(curl -s -X POST localhost:8787/sandboxes -d '{"size":"standard"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.id')
```

Keep the owner token from that reply too (`data.token`, shown once): `OWNER=ot_...`. Use `standard` (500 customers, a few customer emails and calls a day); `demo` is smaller and quieter.

### A. Connect through MCP

```bash
curl -s -X POST localhost:8787/sandboxes/$S/jobs/customer-email/start -H "Authorization: Bearer $OWNER"
```

The reply's `data.connect` holds everything, already filled in with the key:

- `claude_code`: paste into a terminal: `claude mcp add --transport http overthought http://127.0.0.1:8787/mcp --header "Authorization: Bearer ot_..."`
- `mcp_json`: for Cursor and other clients with an `mcpServers` file (`"type": "http"`, `url`, `headers`).
- `mcp_url`: the address with the key in it (`.../mcp?key=ot_...`) for clients that only take a URL, such as custom connectors.
- `claude_desktop`: Claude Desktop's config file starts local programs only, so this goes through the small `mcp-remote` bridge: `{"command": "npx", "args": ["-y", "mcp-remote", "<mcp_url>"]}`.

No server at all: `node infrastructure/server/mcp-stdio.mjs --job customer-email` starts its own private sandbox (use the full path in a client's config: `{"command": "node", "args": ["/full/path/to/overthought/server/mcp-stdio.mjs", "--job", "customer-email"]}`).

When your AI connects it is told, before anything else, what the business is, its job, how time works and the house rules (the server's instructions). It gets the tools its job's role may use, plus `get_started`, `whats_waiting`, `get_job_result` and `advance_time`; a prompt per job (`start-customer-email` and so on: the handover note); and resources to read (`overthought://company`, `overthought://jobs/<id>`, `overthought://policies/<id>`, `overthought://procedures/<id>`, `overthought://catalogue`). Then just say "start the job".

### B. Give us your AI's web address

Your service takes one JSON message per turn and answers `{"reply": "..."}`. This is the simulator's tool protocol (`simulation/simulator/README.md`, "The tool protocol"), plus `history`, the conversation so far:

```json
{ "protocol": 1, "session_id": "CT-03712", "turn": 1, "message": "It's ORD-17252, and the postcode is DI3 8YU.",
  "history": [{ "from": "customer", "text": "Hi, Jingle here. Where is my parcel? I ordered it a little while ago." },
              { "from": "shop", "text": "I can look into that. Could you give me the order number and the postcode?" }],
  "channel": "phone", "role": "support_agent", "api_url": "http://127.0.0.1:8787", "token": "ot_...",
  "system_prompt": "You are connected to Overthought & Co. ...", "sim": { "kind": "contact", "job": "reception", "date": "2026-11-24", "contact_id": "CT-03712" } }
```

To look things up or act, call the shop's tools at `<api_url>/tools/<name>` with `Authorization: Bearer <token>` and `X-Session-Id: <session_id>` (so a caller you verified stays verified for the call). `integrations/examples/receptionist.mjs` is a 60-line stand-in that does exactly this with rules, not AI: copy it and replace `answer()` with a call to your model.

```bash
node integrations/examples/receptionist.mjs 8899 &                     # the stand-in (or your own service)
curl -s -X POST localhost:8787/sandboxes/$S/jobs/reception/test -H "Authorization: Bearer $OWNER" \
  -d '{"url":"http://127.0.0.1:8899","message":"Do you sell socks?"}'     # see it answer once; nothing changes
curl -s -X POST localhost:8787/sandboxes/$S/jobs/reception/start -H "Authorization: Bearer $OWNER" \
  -d '{"url":"http://127.0.0.1:8899","timeout_seconds":15}'
curl -s -X POST localhost:8787/sandboxes/$S/advance -H "Authorization: Bearer $OWNER" -d '{"days":7}'
curl -s localhost:8787/sandboxes/$S/jobs/reception/result -H "Authorization: Bearer $OWNER"
```

After each simulated day, every customer contact on the job's channels (phone for `reception`; email and web chat for `customer-email`) is sent to your address one at a time, as it would have happened: the shop's clock is set to just after the customer got in touch. Email is one turn; your reply is sent from hello@. A call or chat goes on turn by turn until the customer hangs up. Jobs without customers (stock, prospects, marketing and the rest) get one message a day with what is waiting (`sim.kind` is `alerts`, `prospects` or `daily`). Every turn, with its timing, is in the trace (`kind: "delivery"`, with the transcript).

If your service is slow or down, the customer waits: a message that times out (`timeout_seconds`, 1 to 60, default 15) or answers badly is left, three failures in a row hand the rest of that day to staff, and staff pick those customers up at their normal speed. It never stops time moving. The test route answers `"ok": false` with the reason when your address cannot be reached.

**The phone channel.** Calls are text: what the caller says and what your receptionist says back. Real voice (speech in and out) is outside this version: the test is on what the receptionist says and does, not how it sounds. Callers follow written rules (`infrastructure/server/callers.mjs`), not a model. Their manner comes from the simulator's customer model (polite, plain or blunt; some vague; some leave out the order number at first): they give their order number and postcode when asked, name the product when asked, thank you and hang up when the answer addresses their problem (a complaint also wants to hear it is recorded), say once in their own tone when it does not, then give up. About 8% will not deal with an automated helper and ask for a person at once (an assumption, drawn once per customer). A caller says at most four things. It cannot simulate interruptions, people changing their story, or anything outside those branches.

**Worked example: an AI receptionist.** Start the stand-in as above, take `reception` with its address, move on a week, read the result. A real run on the standard world: 9 calls put through, each a short transcript in the trace; the result says how many it answered, how many were judged right, how long callers waited against staff alone, what the callers said about it (in their own voices, with a 1 to 5 rating and a link to the conversation), whether they came back or asked for a person, and the knock-on effects.

### C. Call the web API yourself

Take a job as in A; the key works on the web API too. The helper tools are there as well:

```bash
K=<data.connect.token>
curl -s -X POST localhost:8787/tools/get_started   -H "Authorization: Bearer $K" -d '{}'   # briefing, today, what is waiting
curl -s -X POST localhost:8787/tools/whats_waiting -H "Authorization: Bearer $K" -d '{}'
curl -s -X POST localhost:8787/tools/advance_time  -H "Authorization: Bearer $K" -d '{"days":1}'
curl -s localhost:8787/sandboxes/$S/jobs/customer-email/result -H "Authorization: Bearer $K"
```

**Worked example: an email marketing tool.** Take `email-marketing`, then with its key:

```bash
curl -s -X POST localhost:8787/tools/list_customers -H "Authorization: Bearer $K" -d '{"marketing_opt_in":true,"limit":200}'   # who asked for news
curl -s -X POST localhost:8787/tools/create_campaign -H "Authorization: Bearer $K" \
  -d '{"name":"Umbrella week","channel":"email","start":"2026-11-23","end":"2026-11-30","monthly_spend":0}'                  # → data.id, e.g. CMP-091
curl -s -X POST localhost:8787/tools/send_email -H "Authorization: Bearer $K" -d '{"mailbox":"hello","to":["<opted-in addresses>"],
  "subject":"The Other Umbrella, for the other weather","body":"The Other Umbrella is £22. ...","links":{"campaign_id":"CMP-091"}}'
curl -s -X POST localhost:8787/tools/advance_time -H "Authorization: Bearer $K" -d '{"days":7}'
curl -s localhost:8787/sandboxes/$S/jobs/email-marketing/result -H "Authorization: Bearer $K"
```

The result gives opens, shop visits, orders and revenue from the email, and unsubscribes, each against the business that sent nothing. (A real run: 150 opted-in customers, one email, a week: 45 opens and about 4 visits more than left alone.) Mail to people who did not opt in causes unsubscribes.

### D. Get the code and run it

Node 24 and pnpm. `git clone <this repository> && cd overthought && pnpm install && npm start`, then open http://localhost:4747/apps/. The generated worlds are built on the first run (a few seconds). Everything runs on your machine; nothing calls out.

## Job routes

| Route | Who | What |
|---|---|---|
| `GET /jobs` | anyone | The ready jobs: name, what it is for, role, tools, what the simulator hands it, how it is judged, `ways` it can be taken. |
| `POST /sandboxes/:id/jobs/:job/start` | owner | Takes the job. Body (all optional): `url` (your AI's web address), `timeout_seconds`, `can_move_time` (default true), `staff_after_minutes`. Returns `connect` (key, `mcp_url`, `claude_code`, `mcp_json`, `claude_desktop`, `web_api`) and the `cover` switched on. |
| `POST /sandboxes/:id/jobs/:job/test` | owner | Sends one test message to `url` (or the job's address) and returns `reply`, `ms` or `error`. Changes nothing. |
| `POST /sandboxes/:id/jobs/:job/stop` | owner | Its keys stop working; staff take back what it covered. |
| `GET /sandboxes/:id/jobs` | owner | Which jobs are taken, how, when each last did something, and a plain line on what it has done. |
| `GET /sandboxes/:id/jobs/:job/result` | owner, manager, or the job's own key | The figures that matter for the job against the business left alone, what it did, what the rules refused, what customers said (`?voices=all` for every one), whether they use it, knock-on effects, and one plain sentence. |

## Reference

The sections below are the lower-level pieces the jobs are built on.

## 1. Create a sandbox

```bash
curl -s -X POST http://127.0.0.1:8787/sandboxes \
  -H 'Content-Type: application/json' -d '{"size":"demo","scenario":"normal"}'
```

The reply has `data.id` and `data.token`. The token is the **owner token**: it can do everything, and it is shown once. Put both in your shell:

```bash
S=<data.id>
OWNER=<data.token>
```

`size` is `demo` (36 customers) or `standard` (500 customers). `seed` (optional, default 1) picks the luck of the simulated days: same seed and same actions, same days. `scenario` is one of `normal`, `christmas-rush`, `supplier-late`, `recall`, `cash-squeeze` (see `curl -s http://127.0.0.1:8787/scenarios`).

## 2. Give your AI its own token

Your AI should not hold the owner token. Mint one that can only ever act as one role:

```bash
curl -s -X POST http://127.0.0.1:8787/sandboxes/$S/tokens \
  -H "Authorization: Bearer $OWNER" -d '{"role":"assistant"}'
AI=<data.token>
```

Use `assistant` for a customer-facing AI and `operations_assistant` for a back-office one. Every role is listed in `business/data/business.json` and explained in `docs/data-model.md`.

## 3. Call a tool

```bash
# What can this role do? (names, descriptions, JSON Schemas)
curl -s http://127.0.0.1:8787/tools -H "Authorization: Bearer $AI"

# Search the catalogue
curl -s -X POST http://127.0.0.1:8787/tools/search_catalogue \
  -H "Authorization: Bearer $AI" -d '{"query":"umbrella"}'

# Verify a customer, then look up their order
curl -s -X POST http://127.0.0.1:8787/tools/verify_customer \
  -H "Authorization: Bearer $AI" -d '{"reference":"ORD-20101","email_or_postcode":"ZZ4 9CH"}'
curl -s -X POST http://127.0.0.1:8787/tools/get_order \
  -H "Authorization: Bearer $AI" -d '{"order_number":"ORD-20101"}'

# A staff tool: refused
curl -s -X POST http://127.0.0.1:8787/tools/issue_refund \
  -H "Authorization: Bearer $AI" -d '{"order_number":"ORD-20101","amount":10,"reason":"test"}'
```

Every answer is `{ "ok": true, "data": ... }` or `{ "ok": false, "error": { "code", "message" } }`. A refusal from the business (like `forbidden` above) still comes back as HTTP 200: the request worked, the business said no. Error codes: `forbidden`, `not_verified`, `not_found`, `invalid_input`, `rule_violation`, `out_of_stock`, `unavailable`, `needs_human`.

Verification lasts for the token's session. To run several conversations at once, send `X-Session-Id: <any name>`; each name starts unverified.

Plain reads for exploring: `GET /products`, `/products/<id>`, `/policies`, `/policies/<id>`, `/help`. The full API is at `/openapi.json`.

The owner token can act as any role by naming it: `-H "X-Role: manager"` (and `-H "X-Customer-Id: C-1001"` for the `customer` role).

## 4. Connect an MCP client with a role key

A job key (above) is the easy way. With a plain role key:

**Over HTTP** (the server must be running). Paste into your client's MCP settings, with your AI token:

```json
{
  "mcpServers": {
    "overthought": {
      "type": "http",
      "url": "http://127.0.0.1:8787/mcp",
      "headers": { "Authorization": "Bearer ot_..." }
    }
  }
}
```

In Claude Code: `claude mcp add --transport http overthought http://127.0.0.1:8787/mcp --header "Authorization: Bearer $AI"`

**Over stdio** (no server needed; the client starts its own private sandbox). Use the full path to this repository:

```json
{
  "mcpServers": {
    "overthought": {
      "command": "node",
      "args": ["/full/path/to/overthought/server/mcp-stdio.mjs", "--size", "demo", "--role", "assistant"]
    }
  }
}
```

Add `"--scenario", "recall"` to start in a situation, and `"--trace-file", "/full/path/trace.json"` to save the trace and diff when the client disconnects.

Over MCP you get the same tools (named and described exactly as in `GET /tools`, with titles and read-only, destructive and idempotent hints), the helper tools `get_started`, `whats_waiting` and `get_job_result`, the resources and job prompts described in A above, and a prompt, `customer-assistant`, with the rules the shop's assistant follows. The key can also go in the address (`/mcp?key=ot_...`) for clients that cannot send headers.

## 5. Give it work: the inbox

```bash
curl -s http://127.0.0.1:8787/sandboxes/$S/inbox -H "Authorization: Bearer $AI"
curl -s -X POST http://127.0.0.1:8787/sandboxes/$S/inbox/MSG-0004/reply \
  -H "Authorization: Bearer $AI" -d '{"text":"I can help with that. What is your order number?"}'
```

Waiting customer messages come from the shop's own unanswered conversations and open cases, plus a few scripted customers for each situation. Some scripted customers write back after your reply. The AI is not told who wrote: it has to verify the person, as on a real chat.

Bring your own customers (for example, another AI playing customers) with the owner token:

```bash
curl -s -X POST http://127.0.0.1:8787/sandboxes/$S/inbox -H "Authorization: Bearer $OWNER" \
  -d '{"text":"Do you deliver to Leeds?","channel":"email","followups":["How much is next-day?"]}'
```

## 6. See what happened

```bash
curl -s http://127.0.0.1:8787/sandboxes/$S/trace -H "Authorization: Bearer $OWNER"   # every call, in order
curl -s http://127.0.0.1:8787/sandboxes/$S/diff  -H "Authorization: Bearer $OWNER"   # every record that changed
```

Each trace entry has the time, simulated time, role, tool, input, result or error, and what changed. Add `?since=<seq>` to get only new entries. The diff lists records added, changed (field by field, before and after) and removed since the start.

## 7. Move time on and see the impact

The sandbox is a live business. Whatever you or your AI change (prices, stock, purchase orders, the marketing budget, who works how many hours) takes effect when time moves on: customers order and get in touch, staff work, suppliers deliver, parcels arrive or go late. A **shadow** copy of the same business, with the same luck, moves the same days with nothing done to it. The impact is the difference.

```bash
# Move on a week (1 to 366 days per call; owner or manager token). Each day: what happened, and a one-line summary.
curl -s -X POST http://127.0.0.1:8787/sandboxes/$S/advance -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' -d '{"days":7}'

# Where are we? (any token of this sandbox)
curl -s http://127.0.0.1:8787/sandboxes/$S/clock -H "Authorization: Bearer $OWNER"
# { "now": "2026-11-30T10:00:00Z", "date": "2026-11-30", "day": 7, "seed": 1, "scale": 1, "started": true }

# What difference did it make? (owner or manager token)
curl -s http://127.0.0.1:8787/sandboxes/$S/impact -H "Authorization: Bearer $OWNER"
```

`impact` gives, for revenue, gross profit, net profit, cash, orders, refunds, complaints, reviews, lost sales, stockouts, staff task hours, customer satisfaction and first-response time: this business (`live`), the shadow (`shadow`) and `difference` (live minus shadow), plus the same per day in `series` for charts. With nothing done, every difference is exactly zero.

Levers a manager can pull, as ordinary tools: `change_price`, `create_purchase_order`, `set_marketing_budget` (`{"monthly": 4000}`, or `{"reset": true}`), `set_staffing` (`{"action":"hours","staff_id":"...","weekly_hours":30}`, `{"action":"add","role":"support_agent","weekly_hours":20}`, `{"action":"remove","staff_id":"..."}`) and `get_levers` to see them.

Over MCP, owner, manager and job connections (unless the job was taken with `can_move_time: false`) get `advance_time` (`{"days": 7}`), which does the same as the route and returns the impact so far.

Once time has moved this way, the engine's bare `advance_day` tool is refused in that sandbox, so the business and its shadow can never be on different dates.

## 8. Start again

```bash
curl -s -X POST http://127.0.0.1:8787/sandboxes/$S/reset -H "Authorization: Bearer $OWNER"   # exactly as it began
curl -s -X DELETE http://127.0.0.1:8787/sandboxes/$S -H "Authorization: Bearer $OWNER"       # gone
```

Reset keeps your tokens, clears the trace, and puts the clock, the simulation and its shadow back to the start. A sandbox left alone for 2 hours is deleted.
