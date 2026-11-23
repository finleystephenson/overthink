// OpenAPI 3.1 document, generated from the engine's tool list so it can never drift from what the server does.

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema, description = "OK") => ({ description, content: { "application/json": { schema } } });
const body = (schema) => ({ required: true, content: { "application/json": { schema } } });
const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };
const jobParam = { name: "job", in: "path", required: true, schema: { type: "string" }, description: "A job id from GET /jobs, such as customer-email." };
const roleHeaders = [
  { name: "X-Role", in: "header", required: false, schema: { type: "string" }, description: "Owner tokens only: the role to act as. Role tokens are fixed to their role." },
  { name: "X-Customer-Id", in: "header", required: false, schema: { type: "string" }, description: "Owner tokens acting as the customer role." },
  { name: "X-Session-Id", in: "header", required: false, schema: { type: "string" }, description: "Keeps separate engine sessions (e.g. one per conversation). Verification lasts for the session." },
];
const op = (summary, extra = {}) => ({ summary, responses: { 200: json(ref("Result")) }, ...extra });

export function openApi(world, roles, scenarios) {
  const paths = {
    "/health": { get: { ...op("Health check"), security: [] } },
    "/scenarios": { get: { ...op("List the situations a sandbox can start in"), security: [] } },
    "/sandboxes": {
      post: {
        ...op("Create a private copy of the business. Returns its id and the owner token (shown once)."), security: [],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { size: { enum: ["demo", "standard"] }, scenario: { enum: scenarios }, seed: { type: "integer", minimum: 0, description: "Seed for the simulated days (default 1). Same seed, same actions: same days." }, bench: { type: "boolean", description: "true: the benchmark's world with its hand-written stories (business/data/world-bench). Default false: the business as it is." } } } } } },
      },
    },
    "/sandboxes/{id}": { get: op("Describe a sandbox (owner)", { parameters: [idParam] }), delete: op("Delete a sandbox (owner)", { parameters: [idParam] }) },
    "/sandboxes/{id}/reset": { post: op("Put the sandbox back exactly as it started (owner)", { parameters: [idParam] }) },
    "/sandboxes/{id}/tokens": {
      post: op("Mint a token that can only act as one role (owner)", {
        parameters: [idParam],
        requestBody: body({ type: "object", required: ["role"], properties: { role: { enum: roles }, customer_id: { type: "string" }, label: { type: "string" } } }),
      }),
    },
    "/sandboxes/{id}/trace": { get: op("Every call in order: time, role, tool, input, result or error, changes (owner)", { parameters: [idParam, { name: "since", in: "query", schema: { type: "integer" } }] }) },
    "/sandboxes/{id}/diff": { get: op("Records that differ from the starting state (owner)", { parameters: [idParam] }) },
    "/sandboxes/{id}/advance": {
      post: op("Move time on: the business runs these days (customers, staff, suppliers, parcels), and so does its shadow twin where nothing was done. Returns each day: what the engine did plus a summary (owner or manager token).", {
        parameters: [idParam], requestBody: body({ type: "object", required: ["days"], properties: { days: { type: "integer", minimum: 1, maximum: 366 } } }),
      }),
    },
    "/sandboxes/{id}/clock": { get: op("The simulated date, day number and seed (any token of this sandbox)", { parameters: [idParam] }) },
    "/sandboxes/{id}/impact": { get: op("What was done, in numbers: this business minus its shadow twin for revenue, profit, cash, orders, satisfaction, response time, staff hours, refunds, complaints, reviews, lost sales and stockouts, with a per-day series (owner or manager token)", { parameters: [idParam] }) },
    "/sandboxes/{id}/inbox": {
      get: op("Customer messages waiting for a reply", { parameters: [idParam, { name: "status", in: "query", schema: { enum: ["waiting", "replied", "all"] } }] }),
      post: op("Push in a customer message (owner)", {
        parameters: [idParam],
        requestBody: body({ type: "object", required: ["text"], properties: { text: { type: "string" }, channel: { enum: ["web", "email", "sms", "phone"] }, customer_id: { type: "string" }, conversation_id: { type: "string" }, followups: { type: "array", items: { type: "string" } } } }),
      }),
    },
    "/sandboxes/{id}/inbox/{messageId}/reply": {
      post: op("Reply to a waiting message", {
        parameters: [idParam, { name: "messageId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: body({ type: "object", required: ["text"], properties: { text: { type: "string" } } }),
      }),
    },
    "/tools": { get: op("The tools your role may use, with JSON Schemas", { parameters: roleHeaders }) },
    "/products": { get: op("The catalogue (search_catalogue)") },
    "/products/{id}": { get: op("One product (get_product)", { parameters: [idParam] }) },
    "/policies": { get: op("Customer policies: id, title, summary") },
    "/policies/{id}": { get: op("One policy (get_policy)", { parameters: [idParam] }) },
    "/help": { get: op("Help centre questions and answers") },
    // Ready jobs (infrastructure/server/jobs.mjs, docs/jobs.md).
    "/jobs": { get: { ...op("The ready jobs an AI can take: name, role, tools, what the simulator hands it, how it is judged, and the ways it can be taken"), security: [] } },
    "/sandboxes/{id}/jobs": { get: op("Which jobs are taken in this sandbox, how, when each last did something, and a plain line on what it has done (owner)", { parameters: [idParam] }) },
    "/sandboxes/{id}/jobs/{job}/start": {
      post: op("Take a job: makes a key for its role, switches on the simulator cover it needs, and returns ready-to-paste connection details (owner). With url, the business sends the job's work to that address.", {
        parameters: [idParam, jobParam],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { url: { type: "string", description: "Your AI's web address (http or https). It receives the tool protocol and answers {\"reply\": \"...\"}." }, timeout_seconds: { type: "integer", minimum: 1, maximum: 60 }, can_move_time: { type: "boolean" }, staff_after_minutes: { type: "integer", minimum: 0, maximum: 2400 } } } } } },
      }),
    },
    "/sandboxes/{id}/jobs/{job}/test": {
      post: op("Send one test message to an AI's web address and return its reply, how long it took, or what went wrong. Changes nothing (owner).", {
        parameters: [idParam, jobParam],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { url: { type: "string" }, message: { type: "string" }, channel: { enum: ["email", "web_chat", "phone"] } } } } } },
      }),
    },
    "/sandboxes/{id}/jobs/{job}/stop": { post: op("Stop a job: its keys stop working and staff take back what it covered (owner)", { parameters: [idParam, jobParam] }) },
    "/sandboxes/{id}/jobs/{job}/result": {
      get: op("A job's result against the business left alone: figures, what it did, what the rules refused, what customers said, whether they use it, knock-on effects and one plain sentence (owner, manager or the job's own key)", {
        parameters: [idParam, jobParam, { name: "voices", in: "query", schema: { enum: ["all"] }, description: "all: every customer's opinion, not just the sample." }],
      }),
    },
  };
  for (const t of world.tools) {
    paths[`/tools/${t.name}`] = {
      post: {
        operationId: t.name, summary: t.description, description: `Roles allowed: ${t.roles.join(", ")}.`,
        parameters: roleHeaders, requestBody: body(t.input_schema), responses: { 200: json(ref("Result"), "The engine's answer. `ok` false means the business refused, not that the request failed.") },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Overthought & Co. sandbox API", version: "0.1.0", description: "A private, resettable copy of a fictional online shop. Bring your own AI. Every call is recorded in the sandbox trace." },
    servers: [{ url: "/" }],
    security: [{ bearer: [] }],
    paths,
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "A sandbox token: the owner token from POST /sandboxes, or a role token from POST /sandboxes/{id}/tokens." } },
      schemas: {
        Result: {
          oneOf: [
            { type: "object", required: ["ok"], properties: { ok: { const: true }, data: {} } },
            { type: "object", required: ["ok", "error"], properties: { ok: { const: false }, error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } } },
          ],
        },
      },
    },
  };
}
