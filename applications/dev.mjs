#!/usr/bin/env node
// One command for the whole company computer: node applications/dev.mjs [--port 8790] [any infrastructure/server/main.mjs option]
// A thin wrapper: the real server (infrastructure/server/main.mjs) now serves the apps (/apps/), the pictures (/img/), the web API
// and MCP from one port. This only fills in the defaults the apps are built against, then starts it.
//
//   port 8790 (unless --port or PORT is given)
//   plug-ins: the server default (events, comms, world, audience, team) unless --plugins is given
//
// WHY keep this file: other builders already run `node applications/dev.mjs --port ...`.

const args = process.argv.slice(2);
const has = (flag) => args.some((a) => a === flag || a.startsWith(`${flag}=`));
if (!has("--port") && !process.env.PORT) args.push("--port", "8790");
// WHY: no plug-in flag here, so the dev server runs the same plug-ins as the real server (events, comms, audience).
process.argv = [process.argv[0], process.argv[1], ...args];

// main.mjs reads process.argv when it loads, so it must be imported after the defaults are in place.
await import("../infrastructure/server/main.mjs");
