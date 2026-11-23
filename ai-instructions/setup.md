# Setup: start the sandbox and connect the product

Work in the user's own project folder. `overthink` below means `npx github:finleystephenson/overthink` (Node 24 or later). Nothing needs cloning.

## 1. Understand the product

Read its code. Find where a message goes in and a reply comes out, which tools or APIs it calls, how it starts, and what it is for. Tell the user in one line what you found.

## 2. Write the adapter

The adapter (`overthink.adapter.ts` in the user's repo) says how to reach the product. With the product running:

```sh
overthink init --url http://localhost:3000/chat --channels web_chat,email --yes --no-run
```

`--command "node bot.mjs"` works for a product that reads JSON lines on stdin. If the product does not speak the contract (AGENTS.md, "The contract"), write a small shim first: copy `integrations/examples/http-server.ts`. Then prove the wiring:

```sh
overthink check --adapter overthink.adapter.ts
```

## 3. Choose channels and access

- **Channels** are where the product is deployed, as in a real shop: `email` (the hello@ inbox), `web_chat`, `phone`, `text`, `mutter_dm`, `squint_dm`, `mutter_mention`. A website chatbot is `web_chat` only. Contacts on other channels go to staff.
- **Access** is what it may read and do: `full` (its job's role), `read_only`, `reply_only` (may only write messages), `no_money` (no refunds, credit or books), or an exact `scope`. Set it in the adapter (`access: 'read_only'`) or with `--access`. Access is worth testing: try two levels on the same activity.

## 4. Start the sandbox

```sh
overthink up --adapter overthink.adapter.ts      # the product deployed on its channels
overthink up                                      # the same business with no product: the baseline
```

It prints three things: Rummage (the company's apps, for the user to watch), the activity MCP line, and the business endpoints. Leave it running in its own terminal. It writes `.overthink/sandbox.json`, which `overthink act` reads.

To use the activity tools over MCP instead of the command line, run the `claude mcp add ... /mcp/activity` line it prints (any MCP client works the same way).

## Other ways a product can connect

- **The product is an MCP client** (it calls tools itself): give it the business MCP endpoint `/mcp` with a role key: `POST /sandboxes/{id}/tokens {"role": "assistant"}` with the owner key. See `docs/connect.md`.
- **Any language over HTTP:** `POST /tools/{name}` with `Authorization: Bearer <key>`; `GET /openapi.json` lists everything.

A product never gets the owner key. The owner key creates activity; a role key can only do that role's job, and the engine refuses the rest.
