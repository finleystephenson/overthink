# infrastructure

The sandbox itself: what makes every app genuinely work, safely, on one machine.

| Path | What it is |
| --- | --- |
| `engine/` | The business as records, tools and rules. Every change goes through a tool, with the role rules applied and written to the audit. `engine.js` is the commerce core; each other file adds one area (mail and chat, events, reviews, tasks...). `activity.ts` adds the world-lens tools for things arriving from outside. |
| `server/` | Sandboxes (`sandboxes.mjs`: one world each, its starting snapshot, tokens, trace, the live twin), the web API (`http.mjs`), MCP for products (`mcp.mjs`, `/mcp`) and the activity toolset's mount (`/mcp/activity`), jobs, outbound-call guards and the security tests. See `server/README.md` and `SECURITY.md`. |
| `session.ts` | `.overthink/sandbox.json`: where `overthink act` finds the sandbox `overthink up` is running. |
