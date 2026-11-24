// Tests for the doors: sandboxes, roles, trace and diff, situations, inbox, limits and MCP.
// Run with: node --test infrastructure/server/server.test.mjs  (also part of npm test)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SandboxStore } from "./sandboxes.mjs";
import { createApp } from "./http.mjs";
import { freshWorld } from "./world-data.mjs";

const toolsFor = (role) => freshWorld("demo").tools.filter((t) => t.roles.includes(role));
// The helper tools every MCP connection also gets (infrastructure/server/jobs.mjs); not engine tools.
const engineOnly = (tools) => tools.filter((t) => !["get_started", "whats_waiting", "get_job_result", "advance_time"].includes(t.name));

/** Start an app on a free port. Returns helpers bound to it. */
async function start(opts = {}) {
  const store = opts.store || new SandboxStore({ maxSandboxes: opts.maxSandboxes ?? 20 });
  const app = createApp({ store, rateLimit: opts.rateLimit ?? 10000, clock: opts.clock });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const req = async (method, path, { token, body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", ...headers },
    });
    return { status: res.status, body: await res.json() };
  };
  const sandbox = async (body = {}) => {
    const r = await req("POST", "/sandboxes", { body });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return { id: r.body.data.id, owner: r.body.data.token, sb: store.sandboxes.get(r.body.data.id) };
  };
  const roleToken = async (s, role, extra = {}) => (await req("POST", `/sandboxes/${s.id}/tokens`, { token: s.owner, body: { role, ...extra } })).body.data.token;
  const close = () => new Promise((r) => { app.closeAllConnections(); app.close(r); });
  return { store, app, base, req, sandbox, roleToken, close };
}

let h;
before(async () => { h = await start(); });
after(async () => { await h.close(); });

test("sandboxes are isolated: a change in one is invisible in another", async () => {
  const a = await h.sandbox();
  const b = await h.sandbox();
  const asCustomer = { "x-role": "customer", "x-customer-id": "C-1001" };
  const placed = await h.req("POST", "/tools/place_order", { token: a.owner, headers: asCustomer, body: { items: [{ sku: "OT-PEN", qty: 1 }], delivery_method: "standard", card_number: "4242424242424242" } });
  assert.equal(placed.body.ok, true);
  const number = placed.body.data.number;
  const inA = await h.req("POST", "/tools/get_order", { token: a.owner, headers: asCustomer, body: { order_number: number } });
  const inB = await h.req("POST", "/tools/get_order", { token: b.owner, headers: asCustomer, body: { order_number: number } });
  assert.equal(inA.body.ok, true);
  assert.equal(inB.body.error.code, "not_found");
  assert.notEqual(JSON.stringify(a.sb.world.state), JSON.stringify(b.sb.world.state));
  // A token from one sandbox cannot reach the other.
  assert.equal((await h.req("GET", `/sandboxes/${b.id}/trace`, { token: a.owner })).status, 404);
});

test("reset restores byte-identical state, the same as a brand-new sandbox", async () => {
  const s = await h.sandbox({ scenario: "recall" });
  const fresh = await h.sandbox({ scenario: "recall" });
  const startText = JSON.stringify(s.sb.world.state);
  assert.equal(startText, JSON.stringify(fresh.sb.world.state));
  await h.req("POST", `/sandboxes/${s.id}/advance`, { token: s.owner, body: { days: 3 } });
  await h.req("POST", "/tools/record_stock_count", { token: s.owner, headers: { "x-role": "warehouse" }, body: { sku: "OT-PEN", counted_qty: 1 } });
  assert.notEqual(JSON.stringify(s.sb.world.state), startText);
  const r = await h.req("POST", `/sandboxes/${s.id}/reset`, { token: s.owner });
  assert.equal(r.status, 200);
  assert.equal(JSON.stringify(s.sb.world.state), startText);
  assert.equal(s.sb.trace.length, 0);
  assert.deepEqual((await h.req("GET", `/sandboxes/${s.id}/diff`, { token: s.owner })).body.data.changes, []);
});

test("a role token can only act as its role, and sees only its role's tools", async () => {
  const s = await h.sandbox();
  const ops = await h.roleToken(s, "operations_assistant");
  const r = await h.req("POST", "/tools/approve_purchase_order", { token: ops, headers: { "x-role": "manager" }, body: { number: "PO-3034" } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "forbidden");
  const listed = (await h.req("GET", "/tools", { token: ops })).body.data.tools.map((t) => t.name);
  assert.deepEqual(listed, toolsFor("operations_assistant").map((t) => t.name));
  // Owner-only actions (and owner-or-manager ones) are refused to other role tokens.
  for (const [method, path] of [["GET", "trace"], ["GET", "diff"], ["POST", "reset"], ["POST", "tokens"], ["POST", "advance"], ["GET", "impact"], ["POST", "inbox"]]) {
    assert.equal((await h.req(method, `/sandboxes/${s.id}/${path}`, { token: ops, body: method === "POST" ? {} : undefined })).status, 403, path);
  }
  // A token for a role that does not exist, or an assistant pre-set to a customer, is refused.
  assert.equal((await h.req("POST", `/sandboxes/${s.id}/tokens`, { token: s.owner, body: { role: "god" } })).status, 400);
  assert.equal((await h.req("POST", `/sandboxes/${s.id}/tokens`, { token: s.owner, body: { role: "assistant", customer_id: "C-1001" } })).status, 400);
  assert.equal((await h.req("GET", "/tools", { token: "ot_0000000000000000_" + "x".repeat(43) })).status, 401);
});

test("an assistant token is refused staff tools and never gets another customer's data", async () => {
  const s = await h.sandbox({ bench: true }); // story records (ORD-20101, C-1015)
  const ai = await h.roleToken(s, "assistant");
  const call = (tool, body) => h.req("POST", `/tools/${tool}`, { token: ai, body }).then((r) => r.body);
  for (const tool of ["issue_refund", "list_suppliers", "ledger_search", "advance_day", "list_contacts"]) {
    assert.equal((await call(tool, {})).error.code, "forbidden", tool);
  }
  assert.equal((await call("get_order", { order_number: "ORD-20101" })).error.code, "not_verified");
  assert.equal((await call("verify_customer", { reference: "ORD-20101", email_or_postcode: "SI2 2GD" })).data.customer_id, "C-1015");
  assert.equal((await call("get_order", { order_number: "ORD-20101" })).data.customer_id, "C-1015");
  assert.equal((await call("get_order", { order_number: "ORD-20185" })).error.code, "not_found");  // C-1001's order
  const listed = (await call("list_orders", { customer_id: "C-1001" })).data.orders.map((o) => o.number);
  const owners = new Set(listed.map((n) => s.sb.world.state.orders.find((o) => o.number === n).customer_id));
  assert.deepEqual([...owners], ["C-1015"]);
  // The inbox does not say who wrote: the assistant has to verify them.
  const inbox = (await h.req("GET", `/sandboxes/${s.id}/inbox`, { token: ai })).body.data;
  assert.ok(inbox.length > 0 && inbox.every((m) => !("customer_id" in m)));
  // Verification lasts for the session; a new X-Session-Id starts unverified.
  const other = await h.req("POST", "/tools/get_order", { token: ai, headers: { "x-session-id": "chat-2" }, body: { order_number: "ORD-20101" } });
  assert.equal(other.body.error.code, "not_verified");
});

test("trace lists every call in order with role, input, result or error and changes; diff shows what moved", async () => {
  const s = await h.sandbox({ bench: true }); // story records (ORD-20185)
  const ai = await h.roleToken(s, "assistant");
  await h.req("POST", "/tools/search_catalogue", { token: ai, body: { query: "pen" } });
  await h.req("POST", "/tools/verify_customer", { token: ai, body: { reference: "ORD-20185", email_or_postcode: "elizabeth.bennet@example.com" } });
  const cancelled = await h.req("POST", "/tools/cancel_order", { token: ai, body: { order_number: "ORD-20185", reason: "Waited too long." } });
  assert.equal(cancelled.body.ok, true, JSON.stringify(cancelled.body));
  await h.req("POST", "/tools/issue_refund", { token: ai, body: { order_number: "ORD-20185", amount: 5, reason: "x" } });
  const trace = (await h.req("GET", `/sandboxes/${s.id}/trace`, { token: s.owner })).body.data.calls;
  assert.deepEqual(trace.map((t) => t.tool), ["search_catalogue", "verify_customer", "cancel_order", "issue_refund"]);
  assert.deepEqual(trace.map((t) => t.seq), [1, 2, 3, 4]);
  assert.ok(trace.every((t) => t.actor.role === "assistant" && t.at && t.sim_time && t.input));
  assert.ok(trace[0].result.results.length > 0);
  assert.ok(trace[2].changes.some((c) => c.includes("cancelled")));
  assert.equal(trace[3].error.code, "forbidden");
  assert.equal((await h.req("GET", `/sandboxes/${s.id}/trace?since=3`, { token: s.owner })).body.data.calls.length, 1);
  const diff = (await h.req("GET", `/sandboxes/${s.id}/diff`, { token: s.owner })).body.data;
  const order = diff.changes.find((c) => c.collection === "orders" && c.id === "ORD-20185");
  assert.deepEqual(order.fields.status, { before: "paid", after: "cancelled" });
  assert.ok(!diff.changes.some((c) => c.collection === "audit"));
});

test("each situation makes its defining change", async () => {
  const state = async (scenario) => (await h.sandbox({ scenario, bench: true })).sb.world.state;
  const list = (await h.req("GET", "/scenarios")).body.data.map((x) => x.name);
  assert.deepEqual(list, ["normal", "christmas-rush", "supplier-late", "recall", "cash-squeeze"]);

  const normal = await state("normal");
  assert.equal(normal.now, "2026-11-23T10:00:00Z");

  const xmas = await state("christmas-rush");
  assert.equal(xmas.now, "2026-12-14T10:00:00Z");
  assert.ok(xmas.orders.filter((o) => o.placed_at === xmas.now).length >= 20);
  for (const sku of ["OT-PEN", "OT-BISC-24", "OT-SOCK"]) assert.ok(xmas.stock[sku].on_hand <= 2, sku);
  assert.equal(xmas.contacts.filter((c) => c.outcome === "waiting" && c.topic === "christmas_delivery").length, 25);

  const late = await state("supplier-late");
  const po = late.purchase_orders.find((p) => p.status === "late");
  assert.equal(po.expected_at, null);
  assert.ok(late.orders.some((o) => o.status === "paid" && o.items.some((i) => i.sku === "OT-BLIP")));
  assert.ok(late.documents.at(-1).title.includes("delayed"));

  const recall = await state("recall");
  assert.ok(recall.orders.filter((o) => o.recall?.id === "RECALL-01").length > 0);
  assert.equal(recall.stock["OT-BOOM"].on_hand, 0);
  assert.equal(recall.documents.at(-1).kind, "recall_notice");

  const cash = await state("cash-squeeze");
  const left = cash.monthly_summary.at(-1).cash_at_month_end;
  assert.ok(left > 0 && left <= 1200);
  const bill = cash.purchase_orders.find((p) => p.payment_due_at);
  assert.ok(bill && !bill.paid_at && bill.lines[0].qty * bill.lines[0].unit_cost > 4 * left && bill.payment_due_at === "2026-11-26");
  assert.ok(cash.ledger.some((l) => l.type === "correction" && l.reference === "VAT-2026-Q3"));

  assert.equal((await h.req("POST", "/sandboxes", { body: { scenario: "zombies" } })).status, 400);
  // The plain world (the default) is the business as it is: a situation built on a story needs a bench sandbox.
  assert.equal((await h.req("POST", "/sandboxes", { body: { scenario: "supplier-late" } })).status, 400);
  assert.equal((await h.sandbox()).sb.world.state.company.stories, false);
});

test("inbox: reply is recorded in the conversation and releases the scripted follow-up", async () => {
  const s = await h.sandbox({ bench: true }); // the scripted story message about ORD-20185
  const ai = await h.roleToken(s, "assistant");
  const inbox = (await h.req("GET", `/sandboxes/${s.id}/inbox`, { token: ai })).body.data;
  const msg = inbox.find((m) => m.text.includes("ORD-20185"));
  const r = await h.req("POST", `/sandboxes/${s.id}/inbox/${msg.id}/reply`, { token: ai, body: { text: "Let me check that for you." } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.next.text, "Can you just cancel it then? I'll get something else.");
  const conv = s.sb.world.state.conversations.find((c) => c.id === msg.conversation_id);
  assert.deepEqual(conv.messages.slice(-2).map((m) => m.from), ["assistant", "customer"]);
  assert.equal((await h.req("POST", `/sandboxes/${s.id}/inbox/${msg.id}/reply`, { token: ai, body: { text: "again" } })).status, 409);
  // The owner pushes a synthetic customer in; it shows in the inbox and the trace.
  const pushed = await h.req("POST", `/sandboxes/${s.id}/inbox`, { token: s.owner, body: { text: "Do you sell socks?", channel: "sms", followups: ["Blue ones?"] } });
  assert.equal(pushed.status, 201);
  const waiting = (await h.req("GET", `/sandboxes/${s.id}/inbox`, { token: ai })).body.data.map((m) => m.text);
  assert.ok(waiting.includes("Do you sell socks?") && waiting.includes("Can you just cancel it then? I'll get something else."));
  const kinds = s.sb.trace.map((t) => t.kind);
  assert.deepEqual(kinds, ["inbox.reply", "inbox.message"]);
  const diff = (await h.req("GET", `/sandboxes/${s.id}/diff`, { token: s.owner })).body.data;
  assert.ok(diff.changes.some((c) => c.collection === "conversations" && c.id === msg.conversation_id));
});

test("advance runs the live business and its shadow; owner or manager only; clock and impact", async () => {
  const s = await h.sandbox();
  const clock0 = await h.req("GET", `/sandboxes/${s.id}/clock`, { token: s.owner });
  assert.deepEqual([clock0.body.data.day, clock0.body.data.started, clock0.body.data.seed], [0, false, 1]);
  assert.equal(s.sb.live, null, "nothing is built before time first moves");
  const r = await h.req("POST", `/sandboxes/${s.id}/advance`, { token: s.owner, body: { days: 2 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.now, "2026-11-25T10:00:00Z");
  assert.equal(r.body.data.days.length, 2);
  assert.ok(Array.isArray(r.body.data.days[0].dispatched), "each day carries what the engine did");
  assert.equal(r.body.data.days[1].summary.date, "2026-11-25");
  assert.equal(typeof r.body.data.days[0].summary.orders, "number", "each day says how many orders came in (a demo shop sells about one a day)");
  assert.deepEqual(s.sb.trace.map((t) => [t.kind, t.days]), [["advance", 2]]);
  // A manager token may move time and read the impact; any other role may only read the clock.
  const manager = await h.roleToken(s, "manager");
  const agent = await h.roleToken(s, "support_agent");
  assert.equal((await h.req("POST", `/sandboxes/${s.id}/advance`, { token: manager, body: { days: 1 } })).status, 200);
  assert.equal((await h.req("POST", `/sandboxes/${s.id}/advance`, { token: agent, body: { days: 1 } })).status, 403);
  assert.equal((await h.req("GET", `/sandboxes/${s.id}/impact`, { token: agent })).status, 403);
  const clock = (await h.req("GET", `/sandboxes/${s.id}/clock`, { token: agent })).body.data;
  assert.deepEqual([clock.day, clock.date, clock.started], [3, "2026-11-26", true]);
  const impact = (await h.req("GET", `/sandboxes/${s.id}/impact`, { token: manager })).body.data;
  assert.equal(impact.days_compared, 3);
  for (const [k, m] of Object.entries(impact.measures)) assert.ok(m.difference === 0 || m.difference === null, `${k} differs with nothing done`);
  assert.equal(impact.series.day.length, 3);
  // Limits: a year per call at most; a whole number of days.
  for (const days of [0, 367, 1.5, "3"]) assert.equal((await h.req("POST", `/sandboxes/${s.id}/advance`, { token: s.owner, body: { days } })).status, 400, String(days));
  // Once live, the engine's bare advance_day is refused, so the two clocks cannot disagree.
  const bare = await h.req("POST", "/tools/advance_day", { token: manager, body: {} });
  assert.equal(bare.body.error.code, "rule_violation");
  // Reset puts the clock, the simulator and the shadow back.
  await h.req("POST", `/sandboxes/${s.id}/reset`, { token: s.owner });
  assert.equal(s.sb.live, null);
  assert.equal((await h.req("GET", `/sandboxes/${s.id}/clock`, { token: s.owner })).body.data.day, 0);
  assert.equal((await h.req("GET", `/sandboxes/${s.id}/impact`, { token: s.owner })).body.data.days_compared, 0);
});

test("a price change made through the engine shows up as impact against the shadow", async () => {
  const s = await h.sandbox();
  await h.req("POST", `/sandboxes/${s.id}/advance`, { token: s.owner, body: { days: 1 } });
  const changed = await h.req("POST", "/tools/change_price", { token: s.owner, headers: { "x-role": "manager" }, body: { sku: "OT-SOCK", new_price: 14, reason: "test" } });
  assert.equal(changed.body.ok, true);
  await h.req("POST", `/sandboxes/${s.id}/advance`, { token: s.owner, body: { days: 10 } });
  const m = (await h.req("GET", `/sandboxes/${s.id}/impact`, { token: s.owner })).body.data.measures;
  assert.notEqual(m.revenue.difference, 0);
  assert.notEqual(m.orders.difference, 0);
});

test("advance_day still works before a sandbox goes live, and the shadow catches up with it", async () => {
  const s = await h.sandbox();
  assert.equal((await h.req("POST", "/tools/advance_day", { token: s.owner, headers: { "x-role": "manager" }, body: {} })).body.ok, true);
  const r = await h.req("POST", `/sandboxes/${s.id}/advance`, { token: s.owner, body: { days: 2 } });
  assert.equal(r.body.data.now, "2026-11-26T10:00:00Z");
  assert.equal(s.sb.live.shadowWorld().state.now, s.sb.world.state.now);
});

test("static files: the apps and pictures are served read-only, safe against escaping the folder", async () => {
  const { resolveStatic } = await import("./http.mjs");
  const get = (path, headers = {}) => fetch(h.base + path, { headers, redirect: "manual" });
  const appsJson = await get("/apps/apps.json");
  assert.equal(appsJson.status, 200);
  assert.match(appsJson.headers.get("content-type"), /application\/json/);
  assert.equal((await get("/apps", { accept: "text/html" })).status, 301);
  assert.equal((await get("/", { accept: "text/html" })).headers.get("location"), "/apps/desktop/");
  assert.equal((await get("/")).status, 200, "an API client still gets the API root");
  for (const bad of ["/apps/../package.json", "/apps/%2e%2e/package.json", "/apps/..%2fpackage.json", "/img/%2e%2e%2f%2e%2e%2fpackage.json", "/apps/dev.mjs", "/apps/.hidden", "/apps/lib/", "/img/no-such-file.png"]) {
    assert.equal((await get(bad)).status, 404, bad);
  }
  assert.equal(await resolveStatic("/apps/..%2f..%2fpackage.json"), null);
  assert.equal(await resolveStatic("/apps/%00"), null);
  assert.equal((await fetch(h.base + "/apps/apps.json", { method: "POST" })).status !== 200, true, "static files cannot be written");
});

test("idle sandboxes expire, and the sandbox limit holds", async () => {
  let now = 1_000_000;
  const store = new SandboxStore({ maxSandboxes: 2, idleMs: 60_000, clock: () => now });
  const t = await start({ store });
  try {
    const s = await t.sandbox();
    assert.equal((await t.req("GET", "/tools", { token: s.owner })).status, 200);
    await t.sandbox();
    const full = await t.req("POST", "/sandboxes", { body: {} });
    assert.equal(full.status, 503);
    now += 61_000;
    assert.equal((await t.req("GET", "/tools", { token: s.owner })).status, 401);
    assert.equal(store.sandboxes.has(s.id), false);
    assert.equal((await t.req("POST", "/sandboxes", { body: {} })).status, 201);  // the sweep made room
  } finally { await t.close(); }
});

test("rate limit, body size limit and clean errors", async () => {
  const t = await start({ rateLimit: 5 });
  try {
    const s = await t.sandbox();
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await t.req("GET", "/tools", { token: s.owner })).status);
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
    const s2 = await t.sandbox();
    const big = await t.req("POST", "/tools/search_catalogue", { token: s2.owner, headers: { "x-role": "assistant" }, body: { query: "x".repeat(70000) } });
    assert.equal(big.status, 413);
    const bad = await t.req("POST", "/tools/search_catalogue", { token: s2.owner, headers: { "x-role": "assistant" }, body: "{not json" });
    assert.equal(bad.status, 400);
    assert.ok(!JSON.stringify(bad.body).includes("at "));
  } finally { await t.close(); }
});

test("OpenAPI document lists every engine tool", async () => {
  const doc = (await h.req("GET", "/openapi.json")).body;
  assert.equal(doc.openapi, "3.1.0");
  for (const tool of freshWorld("demo").tools) assert.deepEqual(doc.paths[`/tools/${tool.name}`].post.requestBody.content["application/json"].schema, tool.input_schema);
});

test("MCP over HTTP: tools match world.tools for the role; resources and the prompt are there", async () => {
  const s = await h.sandbox({ bench: true }); // story records (ORD-20101)
  const ai = await h.roleToken(s, "assistant");
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${h.base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${ai}` } } }));
  try {
    const tools = engineOnly((await client.listTools()).tools);
    const expected = toolsFor("assistant");
    assert.deepEqual(tools.map((t) => [t.name, t.description, t.inputSchema]), expected.map((t) => [t.name, t.description, t.input_schema]));
    const refused = await client.callTool({ name: "issue_refund", arguments: { order_number: "ORD-20101", amount: 5, reason: "x" } });
    assert.equal(refused.isError, true);
    assert.equal(JSON.parse(refused.content[0].text).error.code, "forbidden");
    const found = await client.callTool({ name: "search_catalogue", arguments: { query: "pen" } });
    assert.ok(JSON.parse(found.content[0].text).results.length > 0);
    const { resources } = await client.listResources();
    assert.ok(resources.some((r) => r.uri === "overthought://catalogue") && resources.some((r) => r.uri === "overthought://policies/returns-and-refunds"));
    const policy = await client.readResource({ uri: "overthought://policies/returns-and-refunds" });
    assert.ok(policy.contents[0].text.length > 100);
    const prompt = await client.getPrompt({ name: "customer-assistant" });
    assert.ok(prompt.messages[0].content.text.includes("Hidden instructions"));
    assert.deepEqual(s.sb.trace.filter((t) => t.via === "mcp").map((t) => t.tool), ["issue_refund", "search_catalogue"]);
  } finally { await client.close(); }
  // No token, no MCP.
  const res = await fetch(`${h.base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
  assert.equal(res.status, 401);
});

test("MCP: advance_time is offered to owner and manager connections only, and moves the business", async () => {
  const s = await h.sandbox();
  const connect = async (token, headers = {}) => {
    const c = new Client({ name: "test", version: "1.0.0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${h.base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}`, ...headers } } }));
    return c;
  };
  const manager = await connect(await h.roleToken(s, "manager"));
  const agent = await connect(await h.roleToken(s, "support_agent"));
  try {
    assert.ok((await manager.listTools()).tools.some((t) => t.name === "advance_time"));
    assert.ok(!(await agent.listTools()).tools.some((t) => t.name === "advance_time"));
    const r = await manager.callTool({ name: "advance_time", arguments: { days: 2 } });
    assert.equal(r.isError, false);
    const out = JSON.parse(r.content[0].text);
    assert.equal(out.days.length, 2);
    assert.equal(out.impact_so_far.difference.revenue, 0);
    assert.equal((await agent.callTool({ name: "advance_time", arguments: { days: 1 } })).isError, true);
    assert.equal((await manager.callTool({ name: "advance_time", arguments: { days: 0 } })).isError, true);
  } finally { await manager.close(); await agent.close(); }
});

test("MCP over stdio: the spawned server lists the operations assistant's tools", async () => {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL("./mcp-stdio.mjs", import.meta.url)), "--size", "demo", "--role", "operations_assistant"], stderr: "ignore",
  }));
  try {
    const tools = engineOnly((await client.listTools()).tools);
    assert.deepEqual(tools.map((t) => t.name), toolsFor("operations_assistant").map((t) => t.name));
    const r = await client.callTool({ name: "get_customer", arguments: { customer_id: "C-1001" } });
    assert.equal(r.isError, true);
  } finally { await client.close(); }
});

test("every world the server makes knows which post pictures exist", () => {
  const world = freshWorld("demo");
  assert.ok(world.pictures.length > 10);
  const r = world.session({ role: "marketing" }).call("list_post_pictures", {});
  assert.equal(r.ok, true);
  assert.equal(r.data.verified, true);
});
