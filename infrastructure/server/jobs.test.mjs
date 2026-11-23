// Tests for ready jobs: the data, taking a job, what an MCP client sees first, the work queue, a job's result with
// customers' opinions, a job taken with a web address (the stand-in receptionist), and the caller's rules.
// Run with: node --test infrastructure/server/jobs.test.mjs  (also part of npm test)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SandboxStore } from "./sandboxes.mjs";
import { createApp } from "./http.mjs";
import { freshWorld, ROLES } from "./world-data.mjs";
import { JOBS, instructionsFor } from "./jobs.mjs";
import { mannerOf, nextCallerTurn, prefersPerson, PREFERS_PERSON_SHARE } from "./callers.mjs";
import { knockOn } from "./voices.mjs";

let h;
before(async () => {
  const store = new SandboxStore({ maxSandboxes: 20 });
  const app = createApp({ store, rateLimit: 100000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const req = async (method, path, { token, body } = {}) => {
    const res = await fetch(base + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    return { status: res.status, body: await res.json() };
  };
  const sandbox = async (size = "demo") => {
    const r = await req("POST", "/sandboxes", { body: { size } });
    return { id: r.body.data.id, owner: r.body.data.token, sb: store.sandboxes.get(r.body.data.id) };
  };
  const take = async (s, job, body = {}) => req("POST", `/sandboxes/${s.id}/jobs/${job}/start`, { token: s.owner, body });
  const tool = async (token, name, input = {}) => (await req("POST", `/tools/${name}`, { token, body: input })).body;
  h = { store, app, base, req, sandbox, take, tool, close: () => new Promise((r) => { app.closeAllConnections(); app.close(r); }) };
});
after(async () => { await h.close(); });

test("every job's role exists, its tools exist and that role may use them, and its briefing is short", () => {
  const world = freshWorld("demo");
  const measures = ["revenue", "gross_profit", "net_profit", "cash", "orders", "refunds", "complaints", "reviews", "lost_sales", "stockouts", "staff_task_hours",
    "customer_satisfaction", "first_response_minutes", "social_reach", "followers", "content_visits", "content_orders", "content_revenue", "email_opens", "unsubscribes"];
  assert.ok(JOBS.length >= 9);
  for (const job of JOBS) {
    assert.ok(ROLES.includes(job.role), job.id);
    for (const name of [...job.tools, ...job.counts.map(([t]) => t)]) {
      const t = world.tools.find((x) => x.name === name);
      assert.ok(t, `${job.id}: no tool ${name}`);
      assert.ok(t.roles.includes(job.role), `${job.id}: ${job.role} cannot use ${name}`);
    }
    for (const m of job.measures) assert.ok(measures.includes(m), `${job.id}: no measure ${m}`);
    assert.ok(job.briefing.split(/\s+/).length <= 300, `${job.id} briefing is too long`);
    const words = instructionsFor({ world, role: job.role, jobId: job.id, canMoveTime: true }).split(/\s+/).length;
    assert.ok(words <= 360, `${job.id} instructions are ${words} words`);
  }
});

test("GET /jobs lists the ready jobs and the ways each can be taken", async () => {
  const r = await h.req("GET", "/jobs");
  assert.equal(r.status, 200);
  const byId = Object.fromEntries(r.body.data.map((j) => [j.id, j]));
  assert.deepEqual(byId.reception.ways, ["url"]);
  assert.deepEqual(byId["customer-email"].ways, ["mcp", "url", "web_api"]);
  assert.equal(byId["customer-email"].prompt, "start-customer-email");
});

test("taking the customer email job makes a key, switches on cover for email, and shows in the job list", async () => {
  const s = await h.sandbox();
  const r = await h.take(s, "customer-email");
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const c = r.body.data.connect;
  assert.match(c.mcp_url, /\/mcp\?key=ot_/);
  assert.match(c.claude_code, /^claude mcp add --transport http overthought /);
  assert.equal(c.mcp_json.mcpServers.overthought.headers.Authorization, `Bearer ${c.token}`);
  assert.deepEqual(c.claude_desktop.mcpServers.overthought.args.slice(0, 2), ["-y", "mcp-remote"]);
  const list = (await h.req("GET", `/sandboxes/${s.id}/jobs`, { token: s.owner })).body.data;
  assert.equal(list[0].id, "customer-email");
  assert.equal(list[0].summary, "Not connected yet: nothing done.");
  const levers = await h.tool(c.token, "get_levers");
  assert.deepEqual(levers.data.support, { channels: ["email"], staff_after_minutes: 900 });
  // Phone calls can only be put through to a web address.
  assert.equal((await h.take(s, "reception")).status, 400);
  assert.equal((await h.take(s, "no-such-job")).status, 404);
  // Helper tools work on the web API too, for agents that do not speak MCP.
  const started = await h.tool(c.token, "get_started");
  assert.equal(started.data.job.id, "customer-email");
  assert.equal(started.data.can_move_time, true);
  assert.match(started.data.waiting.summary, /customer email/);
});

test("MCP with the key in the address: instructions, prompts, resources, annotated tools, and work", async () => {
  const s = await h.sandbox();
  const key = (await h.take(s, "customer-email")).body.data.connect.token;
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${h.base}/mcp?key=${key}`)));
  try {
    const instructions = client.getInstructions();
    assert.match(instructions, /^You are connected to Overthought & Co\./);
    assert.match(instructions, /Your job: answer customer emails and chat\./);
    assert.match(instructions, /advance_time/);
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    assert.ok(JOBS.every((j) => prompts.includes(`start-${j.id}`)));
    const prompt = await client.getPrompt({ name: "start-customer-email" });
    assert.match(prompt.messages[0].content.text, /reply_to_id/);
    const uris = (await client.listResources()).resources.map((r) => r.uri);
    for (const u of ["overthought://company", "overthought://jobs", "overthought://jobs/reception", "overthought://procedures/refunds-and-goodwill", "overthought://policies/returns-and-refunds"]) assert.ok(uris.includes(u), u);
    assert.match((await client.readResource({ uri: "overthought://company" })).contents[0].text, /## What it sells/);
    const tools = (await client.listTools()).tools;
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.deepEqual(tools.slice(0, 4).map((t) => t.name), ["get_started", "whats_waiting", "get_job_result", "advance_time"]);
    assert.equal(by.list_emails.annotations.readOnlyHint, true);
    assert.equal(by.issue_refund.annotations.destructiveHint, true);
    assert.equal(by.send_email.annotations.readOnlyHint, false);
    assert.equal(by.send_email.title, "Send email");
    const got = JSON.parse((await client.callTool({ name: "get_started", arguments: {} })).content[0].text);
    assert.equal(got.job.id, "customer-email");
    const moved = await client.callTool({ name: "advance_time", arguments: { days: 1 } });
    assert.equal(moved.isError, false);
    const waiting = JSON.parse((await client.callTool({ name: "whats_waiting", arguments: {} })).content[0].text);
    assert.ok(Array.isArray(waiting.emails));
  } finally { await client.close(); }
});

test("doing the customer email job: answered emails are judged, with opinions, adoption and knock-on effects", async () => {
  const s = await h.sandbox("standard");
  const key = (await h.take(s, "customer-email")).body.data.connect.token;
  for (let day = 0; day < 4; day++) {
    await h.tool(key, "advance_time", { days: 1 });
    for (const e of (await h.tool(key, "whats_waiting")).data.emails) {
      if (e.order) await h.tool(key, "get_order", { order_number: e.order });
      const sent = await h.tool(key, "send_email", { mailbox: "hello", reply_to_id: e.email_id, body: `Thank you for writing. I have looked up ${e.order || "your question"} and our support team will follow it up today.\n\nOverthought & Co. support team` });
      assert.equal(sent.ok, true, JSON.stringify(sent));
    }
  }
  await h.tool(key, "advance_time", { days: 1 });
  const r = (await h.req("GET", `/sandboxes/${s.id}/jobs/customer-email/result?voices=all`, { token: key })).body.data;
  assert.ok(r.contacts.with_ai.answered_by_ai > 0);
  assert.match(r.summary, /^Your AI answered \d+ of \d+ customer emails/);
  assert.ok(r.voices.count > 0 && r.voices.all.length === r.voices.count);
  for (const v of r.voices.all) {
    assert.ok(v.rating >= 1 && v.rating <= 5);
    assert.ok(v.quote.startsWith(v.name));
    assert.ok(v.conversation.thread_id);
  }
  assert.ok(r.voices.sample.length >= 1 && r.voices.sample.length <= 3);
  assert.ok(r.adoption.email.customers_met_it > 0);
  for (const chain of r.knock_on) {
    assert.equal(chain.measured_against, "the same business left alone");
    assert.ok(chain.steps.length >= 2);
    assert.ok(chain.steps.every((st) => ["count", "simulator"].includes(st.source) && ["better", "worse"].includes(st.direction) && typeof st.difference === "number" && st.label));
    assert.doesNotMatch(chain.sentence, /→| 0 |−/);
  }
  // Opinions: no two the same, and the sample is put together three different ways.
  const said = r.voices.all.map((v) => v.said);
  assert.equal(new Set(said).size, said.length);
  assert.equal(typeof r.voices.sample[0].rating, "number");
  if (r.voices.sample.length === 3 && r.voices.sample.every((v) => v.outcome !== "gave_up" && v.outcome !== "asked_person")) assert.equal(new Set(r.voices.sample.map((v) => v.shape)).size, 3);
  // Same records, same words.
  const again = (await h.req("GET", `/sandboxes/${s.id}/jobs/customer-email/result?voices=all`, { token: s.owner })).body.data;
  assert.deepEqual(again.voices.all.map((v) => v.said), r.voices.all.map((v) => v.said));
  // Another job's key may not read this result.
  const other = (await h.take(s, "stock")).body.data.connect.token;
  assert.equal((await h.req("GET", `/sandboxes/${s.id}/jobs/customer-email/result`, { token: other })).status, 403);
  // Stopping: the key stops working and staff take email back.
  assert.equal((await h.req("POST", `/sandboxes/${s.id}/jobs/customer-email/stop`, { token: s.owner })).status, 200);
  assert.equal((await h.req("GET", `/sandboxes/${s.id}/clock`, { token: key })).status, 401);
  assert.equal(s.sb.world.state.settings.support, undefined);
});

/** Starts the stand-in receptionist on a free port. */
async function receptionist() {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../../integrations/examples/receptionist.mjs", import.meta.url)), "0"], { stdio: ["ignore", "ignore", "pipe"] });
  const url = await new Promise((resolve) => child.stderr.on("data", (d) => { const m = String(d).match(/http:\/\/127\.0\.0\.1:\d+/); if (m) resolve(m[0]); }));
  return { url, stop: () => child.kill() };
}

test("a job taken with a web address: test message, phone calls turn by turn, and a service that is down", async () => {
  const svc = await receptionist();
  try {
    const s = await h.sandbox("standard");
    const tried = await h.req("POST", `/sandboxes/${s.id}/jobs/reception/test`, { token: s.owner, body: { url: svc.url, message: "Do you sell umbrellas?" } });
    assert.equal(tried.body.ok, true, JSON.stringify(tried.body));
    assert.match(tried.body.data.reply, /umbrella|Umbrella/);
    const r = await h.take(s, "reception", { url: svc.url });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(r.body.data.cover.channels, ["phone"]);
    await h.req("POST", `/sandboxes/${s.id}/advance`, { token: s.owner, body: { days: 6 } });
    const calls = s.sb.trace.filter((t) => t.kind === "delivery" && t.contact_id);
    assert.ok(calls.length > 0, "no calls were put through");
    for (const c of calls) {
      assert.equal(c.channel, "phone");
      assert.ok(c.transcript.length >= 2 && c.transcript.length <= 9);
      assert.equal(c.transcript[0].from, "customer");
    }
    const conv = s.sb.world.state.conversations.find((x) => x.contact_id === calls[0].contact_id);
    assert.equal(conv.channel, "phone");
    const result = (await h.req("GET", `/sandboxes/${s.id}/jobs/reception/result`, { token: s.owner })).body.data;
    assert.deepEqual(result.contacts.channels, ["phone"]);
    assert.match(result.summary, /^Your AI answered \d+ of \d+ calls/);
    // A service that is not there: the test says so, and time still moves (staff pick the calls up).
    const down = await h.sandbox("standard");
    const dead = "http://127.0.0.1:9";
    const t = await h.req("POST", `/sandboxes/${down.id}/jobs/reception/test`, { token: down.owner, body: { url: dead } });
    assert.equal(t.body.ok, false);
    assert.equal(t.body.error.code, "unavailable");
    await h.take(down, "reception", { url: dead, timeout_seconds: 2 });
    const moved = await h.req("POST", `/sandboxes/${down.id}/advance`, { token: down.owner, body: { days: 3 } });
    assert.equal(moved.status, 200);
    assert.ok(down.sb.trace.some((x) => x.kind === "delivery" && x.ok === false));
  } finally { svc.stop(); }
});

test("the caller: gives the order number when asked, says once that a reply missed, and some want a person", () => {
  const opening = "Hi, Bob here. Where is my order? I ordered it a little while ago.";
  assert.deepEqual(mannerOf(opening), { tone: "plain", omits: true, vague: false });
  const state = {};
  const facts = { topic: "where_is_my_order", opening, order: "ORD-1", postcode: "ZZ1 1ZZ", customerId: "C-NOT-PICKY" };
  assert.equal(nextCallerTurn({ ...facts, reply: "Could I have your order number and postcode?", state }), "It's ORD-1, and the postcode is ZZ1 1ZZ.");
  assert.match(nextCallerTurn({ ...facts, reply: "Nice weather.", state }), /doesn't really answer/);
  assert.equal(nextCallerTurn({ ...facts, reply: "Nice weather.", state }), null);
  assert.equal(state.gaveUp, true);
  const ok = {};
  assert.equal(nextCallerTurn({ ...facts, opening: "Hello, this is Bob. Where is ORD-1?", reply: "Your order ORD-1 was dispatched today and should arrive tomorrow.", state: ok }), "That's helpful, thank you. Goodbye.");
  const ids = Array.from({ length: 2000 }, (_, i) => `C-${i}`);
  const share = ids.filter(prefersPerson).length / ids.length;
  assert.ok(Math.abs(share - PREFERS_PERSON_SHARE) < 0.03, String(share));
  const picky = ids.find(prefersPerson);
  assert.match(nextCallerTurn({ ...facts, customerId: picky, reply: "Hello, how can I help?", state: {} }), /person/);
});

test("MCP over stdio with --job: the job's briefing and advance_time", async () => {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("./mcp-stdio.mjs", import.meta.url)), "--job", "stock"], stderr: "ignore" }));
  try {
    assert.match(client.getInstructions(), /Your job: keep the shelves stocked\./);
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes("advance_time") && names.includes("create_purchase_order"));
    const waiting = JSON.parse((await client.callTool({ name: "whats_waiting", arguments: {} })).content[0].text);
    assert.match(waiting.summary, /under three weeks of stock/);
  } finally { await client.close(); }
});

test("knock-on chains read by the sign of each step and stop at the first step that did not move", () => {
  const impact = (m) => ({ measures: Object.fromEntries(Object.entries(m).map(([k, difference]) => [k, { difference }])) });
  const job = { id: "stock" };
  const [chain] = knockOn({ job, impact: impact({ stockouts: -5, lost_sales: -3, revenue: -40.4 }) });
  assert.equal(chain.sentence, "5 fewer product-days out of stock, so 3 fewer sales lost to empty shelves, but revenue was £40 lower.");
  assert.deepEqual(chain.steps.map((st) => st.direction), ["better", "better", "worse"]);
  assert.equal(chain.ends, "worse");
  // A step with no change ends the chain; one step alone is not a chain.
  assert.deepEqual(knockOn({ job, impact: impact({ stockouts: -5, lost_sales: 0, revenue: 100 }) }), []);
  const [two] = knockOn({ job, impact: impact({ stockouts: 2, lost_sales: 1.5, revenue: 0 }) });
  assert.equal(two.sentence, "2 more product-days out of stock, so 1.5 more sales lost to empty shelves.");
});

test("the job routes are in /openapi.json", async () => {
  const doc = (await h.req("GET", "/openapi.json")).body;
  for (const p of ["/jobs", "/sandboxes/{id}/jobs", "/sandboxes/{id}/jobs/{job}/start", "/sandboxes/{id}/jobs/{job}/test", "/sandboxes/{id}/jobs/{job}/stop", "/sandboxes/{id}/jobs/{job}/result"]) assert.ok(doc.paths[p], p);
});
