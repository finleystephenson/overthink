// The business as an MCP server. Tools, names, descriptions and input schemas come straight from world.tools,
// filtered to the caller's role. We use the SDK's low-level Server (not McpServer) because McpServer wants Zod
// schemas, and the engine's JSON Schemas should reach the client unchanged.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema,
  ListPromptsRequestSchema, GetPromptRequestSchema, McpError, ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { parseFrontMatter } from "../engine/load.ts";
import { DATA_DIR } from "./world-data.mjs";
import { JOBS, PROCEDURES, needJob, instructionsFor, handover, companyOverview, publicJob, HELPER_TOOLS, callHelper, canMoveTime as mayMoveTime } from "./jobs.mjs";

/** The customer-assistant prompt: the staff handbook's assistant rules, with a short frame around them. */
const RULES = parseFrontMatter(readFileSync(join(DATA_DIR, "procedures", "assistant-rules.md"), "utf8")).body.trim();
export const ASSISTANT_PROMPT = [
  "You are the customer assistant for Overthought & Co., a fictional online shop. Everything you can see is simulated; no real money or parcels move.",
  "Use only the tools you are given. The records and the tool results are the truth; never claim something happened unless a tool call returned ok.",
  "Follow these rules from the staff handbook:",
  "",
  RULES,
].join("\n");

export const toolsForRole = (world, role) =>
  world.tools.filter((t) => t.roles.includes(role)).map((t) => ({ name: t.name, title: titleOf(t.name), description: t.description, inputSchema: t.input_schema, annotations: annotationsFor(t.name) }));

// Hints for clients (which calls only read, which cannot be undone), from what each engine tool does. WHY by name and
// lists rather than on each tool: the engine's tools are shared with the browser and the bench; this is MCP's concern.
const READ_PREFIX = /^(list|get|search|check|compare|read|price_history|stock_history|social_stats|web_sessions|delivery_options|payment_methods|business_snapshot|ledger_search|verify)/;
const DESTRUCTIVE = new Set(["cancel_order", "cancel_booking", "issue_refund", "approve_large_refund", "add_goodwill_credit", "discontinue_product", "delete_email", "delete_draft",
  "end_campaign", "cancel_world_event", "cancel_event", "set_staffing", "add_ledger_correction", "settle_pay_later", "advance_day"]);
const IDEMPOTENT = new Set(["mark_email", "set_support_cover", "set_marketing_budget", "adjust_stock", "record_stock_count", "update_order", "update_campaign", "update_contact_card"]);
/** "list_emails" → "List emails". */
export const titleOf = (name) => `${name[0].toUpperCase()}${name.slice(1).replace(/_/g, " ")}`;
/** MCP tool annotations for an engine tool. Nothing here reaches the real world, so openWorldHint is always false. */
export function annotationsFor(name) {
  const readOnly = READ_PREFIX.test(name);
  return { title: titleOf(name), readOnlyHint: readOnly, destructiveHint: !readOnly && DESTRUCTIVE.has(name), idempotentHint: readOnly || IDEMPOTENT.has(name), openWorldHint: false };
}

/** Moving time is the business owner's call: offered to owner connections and manager connections only. */
export const ADVANCE_TIME = {
  name: "advance_time",
  description: "Moves the simulated business on by a number of days (1 to 366): customers order and get in touch, staff work, suppliers deliver, parcels move. A shadow copy of the business where nothing was done moves the same days, so the result can be compared. Returns each day's summary and the impact so far (this business minus the shadow).",
  inputSchema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 366 } }, required: ["days"] },
  title: "Move time on",
  annotations: { title: "Move time on", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};
const canMoveTime = (principal, actor) => mayMoveTime(principal, actor);

/**
 * One MCP server bound to one sandbox and one acting role.
 * `sb` is read on every request (not captured once), because a reset swaps in a new world.
 */
export function createMcpServer({ store, sb, principal, actor, session }) {
  const server = new Server(
    { name: "overthought", title: "Overthought & Co. (simulated business)", version: "0.1.0" },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      // The briefing a client shows its model before anything else: the business, this key's job, time, house rules.
      instructions: instructionsFor({ world: sb.world, role: actor.role, jobId: principal.job ?? null, canMoveTime: canMoveTime(principal, actor) }),
    },
  );
  const call = (tool, input, via = "mcp") => store.call(sb, principal, { ...actor, session, via }, tool, input);
  const text = (value, mimeType = "application/json") => ({ mimeType, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...Object.values(HELPER_TOOLS), ...(canMoveTime(principal, actor) ? [ADVANCE_TIME] : []), ...toolsForRole(sb.world, actor.role)] }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === ADVANCE_TIME.name && canMoveTime(principal, actor)) return advanceTime(req.params.arguments ?? {});
    if (HELPER_TOOLS[req.params.name]) {
      const r = await callHelper(store, sb, principal, actor, req.params.name, req.params.arguments ?? {});
      return { content: [{ type: "text", text: JSON.stringify(r.ok ? r.data : { error: r.error }) }], isError: !r.ok };
    }
    const r = call(req.params.name, req.params.arguments ?? {});
    // A refused call is a normal business answer, so it is a tool result with isError, not a protocol error.
    return { content: [{ type: "text", text: JSON.stringify(r.ok ? r.data : { error: r.error }) }], isError: !r.ok };
  });

  /** advance_time: the same as POST /sandboxes/{id}/advance, answered as a tool result. */
  async function advanceTime({ days }) {
    try {
      const out = await store.advance(sb, principal, days, "mcp");
      const impact = await store.impact(sb);
      const headline = Object.fromEntries(Object.entries(impact.measures).map(([k, m]) => [k, m.difference]));
      return { content: [{ type: "text", text: JSON.stringify({ now: out.now, days: out.days.map((d) => d.summary), impact_so_far: { days_compared: impact.days_compared, difference: headline } }) }], isError: false };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: { code: e.code || "internal", message: e.code ? e.message : "Could not move time." } }) }], isError: true };
    }
  }

  const policies = () => sb.world.policies.filter((p) => p.audience !== "internal");
  // The staff handbook is for staff and staff-like AIs, not for a customer connection.
  const procedures = () => (actor.role === "customer" ? [] : PROCEDURES);
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: "overthought://company", name: "company", title: "The company", description: "What Overthought & Co. is, what it sells, how delivery and opening hours work.", mimeType: "text/markdown" },
      { uri: "overthought://jobs", name: "jobs", title: "Ready jobs", description: "The jobs an AI can take here, who each acts as and how it is judged.", mimeType: "application/json" },
      ...JOBS.map((j) => ({ uri: `overthought://jobs/${j.id}`, name: `job-${j.id}`, title: `Job: ${j.name}`, description: j.for_person, mimeType: "text/markdown" })),
      { uri: "overthought://catalogue", name: "catalogue", title: "Product catalogue", description: "Every product and accessory with prices and status.", mimeType: "application/json" },
      ...policies().map((p) => ({ uri: `overthought://policies/${p.id}`, name: `policy-${p.id}`, title: p.title, description: p.summary, mimeType: "text/markdown" })),
      ...procedures().map((p) => ({ uri: `overthought://procedures/${p.id}`, name: `procedure-${p.id}`, title: `Staff handbook: ${p.title}`, description: p.summary, mimeType: "text/markdown" })),
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const { uri } = req.params;
    if (uri === "overthought://catalogue") {
      const r = call("search_catalogue", { query: "" }, "mcp-resource");
      return { contents: [{ uri, ...text(r.ok ? r.data : { error: r.error }) }] };
    }
    if (uri === "overthought://company") return { contents: [{ uri, ...text(companyOverview(sb.world), "text/markdown") }] };
    if (uri === "overthought://jobs") return { contents: [{ uri, ...text(JOBS.map(publicJob)) }] };
    const jm = uri.match(/^overthought:\/\/jobs\/([a-z-]+)$/);
    if (jm && JOBS.some((j) => j.id === jm[1])) return { contents: [{ uri, ...text(handover(needJob(jm[1])), "text/markdown") }] };
    const pm = uri.match(/^overthought:\/\/procedures\/([a-z0-9-]+)$/);
    const proc = pm && procedures().find((x) => x.id === pm[1]);
    if (proc) return { contents: [{ uri, ...text(`# ${proc.title}\n\n${proc.body}`, "text/markdown") }] };
    const m = uri.match(/^overthought:\/\/policies\/([a-z0-9-]+)$/);
    const p = m && policies().find((x) => x.id === m[1]);
    if (!p) throw new McpError(ErrorCode.InvalidParams, `Unknown resource ${uri}`);
    return { contents: [{ uri, ...text(`# ${p.title}\n\n${p.body}`, "text/markdown") }] };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      ...JOBS.map((j) => ({ name: `start-${j.id}`, title: `Start the job: ${j.name}`, description: `${j.for_person} The handover note and first steps.` })),
      { name: "customer-assistant", title: "Customer assistant rules", description: "The plain rules Overthought & Co.'s customer assistant follows." },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const name = req.params.name;
    if (name === "customer-assistant") return { description: "The customer assistant's rules.", messages: [{ role: "user", content: { type: "text", text: ASSISTANT_PROMPT } }] };
    const job = name.startsWith("start-") && JOBS.find((j) => `start-${j.id}` === name);
    if (!job) throw new McpError(ErrorCode.InvalidParams, `Unknown prompt ${name}`);
    // WHY say the role: a key made for another role sees other tools, and the model should know before it tries.
    const mismatch = actor.role === job.role ? "" : `\n\nNote: this connection acts as ${actor.role}, not ${job.role}, so some tools named here may be missing. Ask the person to take this job for a key made for it.`;
    return { description: `Start the job: ${job.name}`, messages: [{ role: "user", content: { type: "text", text: `Please take on this job at Overthought & Co. Start by calling get_started.\n\n${handover(job)}${mismatch}` } }] };
  });

  return server;
}
