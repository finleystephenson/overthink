#!/usr/bin/env node
// MCP over stdio, for desktop AI apps that start a local process:
//   node infrastructure/server/mcp-stdio.mjs --size demo --role assistant [--scenario normal] [--customer-id C-1001] [--trace-file trace.json]
//   node infrastructure/server/mcp-stdio.mjs --job customer-email      (takes a ready job: its role, its briefing, its cover, and advance_time)
// One private sandbox lives as long as the process. stdout carries the protocol, so messages go to stderr.
// --trace-file writes the trace (every call, in order) when the process ends; nothing else touches the disk.
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SandboxStore } from "./sandboxes.mjs";
import { createMcpServer } from "./mcp.mjs";
import { startJob } from "./jobs.mjs";

const { values: o } = parseArgs({
  options: {
    size: { type: "string", default: "demo" },
    role: { type: "string", default: "assistant" },
    scenario: { type: "string", default: "normal" },
    "customer-id": { type: "string" },
    "trace-file": { type: "string" },
    job: { type: "string" },
  },
});

try {
  const store = new SandboxStore({ maxSandboxes: 1, idleMs: Infinity });
  const { sandbox } = store.create({ size: o.size, scenario: o.scenario });
  // The process acts through a role token, exactly like a remote AI would, so it can never be the owner.
  // With --job, the key is the job's (its role, its briefing, the simulator cover it needs, and the right to move time).
  const { token } = o.job ? startJob(store, sandbox, o.job) : store.mintRoleToken(sandbox, { role: o.role, customer_id: o["customer-id"] ?? null, label: "stdio" });
  const { principal } = store.authenticate(token);
  const server = createMcpServer({ store, sb: sandbox, principal, actor: { role: principal.role, customer_id: principal.customer_id }, session: "stdio" });
  await server.connect(new StdioServerTransport());
  console.error(`Overthought & Co. MCP (stdio): sandbox ${sandbox.id}, ${o.size}, ${o.scenario}, acting as ${principal.role}${o.job ? ` for the job ${o.job}` : ""}.`);
  const finish = () => {
    if (o["trace-file"]) writeFileSync(o["trace-file"], JSON.stringify({ trace: sandbox.trace, diff: store.diff(sandbox) }, null, 2));
    process.exit(0);
  };
  process.stdin.on("end", finish);
  process.on("SIGINT", finish);
  process.on("SIGTERM", finish);
} catch (e) {
  console.error(`Could not start: ${e.message}`);
  process.exit(1);
}
