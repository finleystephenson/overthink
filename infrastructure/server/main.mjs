#!/usr/bin/env node
// Start the sandbox server: node infrastructure/server/main.mjs [--port 8787] [--host 127.0.0.1] [--max-sandboxes 20]
//   [--idle-minutes 120] [--rate-limit 600] [--persist <dir>] [--plugins events,comms,world,audience,team|events|none]
//   [--hosted] [--cors-origin <origin>] [--frame-ancestors <origin,...>] [--allowed-hosts <name,...>]
//   [--ip-rate-limit <per minute>] [--max-age-hours <h>] [--max-advance-days <n>] [--trust-proxy]
// Everything lives in memory unless --persist is given.
// Hosted mode (a --host other than this machine, or --hosted) is for a shared public server: outside calls may not reach
// private addresses, every address is rate-limited, sandboxes expire after --max-age-hours, the lab hides its list.
// SECURITY.md explains each setting.
import { parseArgs } from "node:util";
import { SandboxStore } from "./sandboxes.mjs";
import { createApp } from "./http.mjs";
import { loadPlugins } from "../../simulation/simulator/plugins.mjs";
import { DATA_DIR, businessData, dataFor } from "./world-data.mjs";
import { setOutboundPolicy } from "./net-guard.mjs";
import { webLimits } from "../../simulation/lab/routes.mjs";

const { values: o } = parseArgs({
  options: {
    port: { type: "string", default: process.env.PORT || "8787" },
    host: { type: "string", default: "127.0.0.1" },
    "max-sandboxes": { type: "string", default: "20" },
    "idle-minutes": { type: "string", default: "120" },
    // WHY 600: the apps served on the same port poll every two seconds and a playing clock moves a day a second.
    "rate-limit": { type: "string", default: "600" },
    persist: { type: "string" },
    // Simulator plug-ins for live sandboxes: "events,comms,world,audience,team" (default, whichever exist), a shorter list, or "none".
    plugins: { type: "string", default: "events,comms,world,audience,team" },
    hosted: { type: "boolean", default: process.env.OVERTHINK_HOSTED === "1" },
    // Off by default: the apps and the explorer are same-origin. Set it for a browser MCP client on another address.
    "cors-origin": { type: "string", default: process.env.CORS_ORIGIN || "" },
    "frame-ancestors": { type: "string", default: process.env.FRAME_ANCESTORS || "" },
    // Extra host names to answer to when bound to this machine behind your own proxy (DNS-rebinding guard).
    "allowed-hosts": { type: "string", default: process.env.ALLOWED_HOSTS || "" },
    "ip-rate-limit": { type: "string" },
    "max-age-hours": { type: "string" },
    "max-advance-days": { type: "string" },
    "trust-proxy": { type: "boolean", default: process.env.TRUST_PROXY === "1" },
  },
});

const LOCAL = ["127.0.0.1", "localhost", "::1"];
const hosted = o.hosted || !LOCAL.includes(o.host);
const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
const numOr = (s, d) => (s === undefined ? d : Number(s));
// WHY: on a shared server an address typed by a stranger must not reach this machine or its private network.
setOutboundPolicy({ allowPrivate: !hosted });
const only = o.plugins === "none" ? [] : o.plugins.split(",").map((x) => x.trim()).filter(Boolean);
const plugins = loadPlugins({ only, dataDir: DATA_DIR, biz: businessData(), products: dataFor("demo").products }).then((r) => {
  for (const s of r.skipped) console.log(`  plug-in ${s.name} left out: ${s.why}`);
  return r.plugins;
});
const maxAgeHours = numOr(o["max-age-hours"], hosted ? 24 : null);
const store = new SandboxStore({ maxSandboxes: Number(o["max-sandboxes"]), idleMs: Number(o["idle-minutes"]) * 60000, persistDir: o.persist || null, plugins,
  maxAgeMs: maxAgeHours == null ? null : maxAgeHours * 3600000, maxAdvanceDays: numOr(o["max-advance-days"], hosted ? 31 : 366) });
const server = createApp({
  store, rateLimit: Number(o["rate-limit"]),
  // When bound to this machine only, refuse requests addressed to any other host name (DNS rebinding).
  allowedHosts: LOCAL.includes(o.host) ? ["127.0.0.1", "localhost", "[::1]", ...list(o["allowed-hosts"])] : null,
  corsOrigin: o["cors-origin"] || null, frameAncestors: list(o["frame-ancestors"]), trustProxy: o["trust-proxy"],
  ipRateLimit: numOr(o["ip-rate-limit"], hosted ? 600 : 0),
  // A shared server does not list everyone's experiments: each person keeps the id of their own.
  labLimits: webLimits(hosted ? { listAll: false } : {}),
});
setInterval(() => store.sweep(), 60000).unref();

server.listen(Number(o.port), o.host, () => {
  const addr = `http://${o.host.includes(":") ? `[${o.host}]` : o.host}:${server.address().port}`;
  console.log(`Overthought & Co. sandbox server on ${addr}`);
  console.log(`  create a sandbox: curl -s -X POST ${addr}/sandboxes`);
  console.log(`  MCP endpoint:     ${addr}/mcp   docs: docs/connect.md`);
  if (!LOCAL.includes(o.host)) console.log("  Warning: listening beyond this machine. Read SECURITY.md (what it does not protect against) first.");
  if (hosted) console.log(`  Hosted mode: no private outside addresses, ${numOr(o["ip-rate-limit"], 600)} requests a minute per address, sandboxes kept at most ${maxAgeHours} hours.`);
});

// Nothing to flush unless --persist is on, and its writes are synchronous; open MCP streams are simply dropped.
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { server.closeAllConnections(); process.exit(0); });
