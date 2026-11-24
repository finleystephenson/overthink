#!/usr/bin/env node
// One command to run this project: checks Node, builds the world data if it is missing, starts the server with
// the default plug-ins, makes a first sandbox, and prints the address and the three ways to connect an AI.
//   npm start            or     node bin/sandbox.mjs [--port 4747] [--size demo|standard] [--open] [--help]
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ensureWorlds } from "./ensure-world.mjs";
import { HOOK } from "./typescript.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PORT = "4747"; // Not 8787 (used by many dev tools) or 8790 (the apps' own dev port).
const MIN_NODE = 24;

const HELP = `Overthink: an open-source sandbox for testing AI in a business environment (Overthought & Co.).

Usage: expanza-sandbox [options]      (from a clone: npm start, or node bin/sandbox.mjs)

Options:
  --port <n>              Port to listen on (default ${DEFAULT_PORT}).
  --size demo|standard    Size of the first sandbox (default standard: about 500 customers).
  --open                  Open the first screen in your browser.
  --help                  Show this page.

The server only listens on this machine. Docs: docs/README.md`;

/** Prints a plain sentence and stops. */
function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Opens a web address in the default browser. */
function openBrowser(url) {
  const [cmd, ...args] = process.platform === "darwin" ? ["open", url]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

/** Calls the running server and returns the `data` part of its answer. */
async function api(base, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error?.message ?? `${path} failed`);
  return json.data;
}

/** Starts infrastructure/server/main.mjs as a child and resolves once it is listening. Plug-in notices are passed through. */
function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", HOOK, "infrastructure/server/main.mjs", "--port", port], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] });
    let ready = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text) => {
      for (const line of text.split("\n")) {
        if (line.includes("sandbox server on")) { ready = true; resolve(child); }
        else if (line.includes("plug-in") || line.includes("Warning")) console.log(line);
      }
    });
    child.on("exit", (code) => {
      if (!ready) reject(new Error(`The server stopped at once. Port ${port} may be busy: try --port ${Number(port) + 1}.`));
      else process.exit(code ?? 0);
    });
    for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { child.kill(); process.exit(0); });
  });
}

const { values: o } = parseArgs({
  options: { port: { type: "string", default: process.env.PORT || DEFAULT_PORT }, size: { type: "string", default: "standard" }, open: { type: "boolean", default: false }, help: { type: "boolean", default: false } },
});
if (o.help) { console.log(HELP); process.exit(0); }
if (!["demo", "standard"].includes(o.size)) stop('--size must be "demo" or "standard".');
if (!/^\d+$/.test(o.port) || Number(o.port) > 65535) stop("--port must be a number from 1 to 65535.");
if (Number(process.versions.node.split(".")[0]) < MIN_NODE) stop(`This needs Node ${MIN_NODE} or newer (you have ${process.versions.node}). Install it from nodejs.org, then run this again.`);
if (!ensureWorlds({ sizes: ["demo", o.size] })) stop("The world data could not be built. Run `node business/builder/build-world.mjs --size demo` to see the error.");

let server;
try { server = await startServer(o.port); } catch (e) { stop(e.message); }
// WHY 127.0.0.1 and not localhost: the server listens on 127.0.0.1, and "localhost" can resolve to another program on ::1.
const base = `http://127.0.0.1:${o.port}`;
const sandbox = await api(base, "/sandboxes", { body: { size: o.size } });
// The manager job gives a key that can use every tool and move time, and changes nothing about who answers customers.
const job = await api(base, `/sandboxes/${sandbox.id}/jobs/manager/start`, { token: sandbox.token });

console.log(`
Overthought & Co. is running.

  The sandbox desktop:          ${base}/
  The explorer (the whole world):  ${base}/apps/explore/

Connect an AI to a ready sandbox (${o.size}, id ${sandbox.id}). Pick one way:

  1. MCP (Claude Code, Cursor, any MCP client). Copy this line:
     ${job.connect.claude_code}

  2. Your AI's own web address. Start your service (or the stand-in receptionist), then:
     node integrations/examples/receptionist.mjs 8899
     curl -s -X POST ${base}/sandboxes/${sandbox.id}/jobs/reception/start -H "Authorization: Bearer ${sandbox.token}" -d '{"url":"http://127.0.0.1:8899"}'

  3. The web API, from any language:
     ${job.connect.web_api}

Then move time on a week and read the result:
     curl -s -X POST ${base}/tools/advance_time -H "Authorization: Bearer ${job.connect.token}" -d '{"days":7}'
     curl -s ${base}/sandboxes/${sandbox.id}/jobs/manager/result -H "Authorization: Bearer ${job.connect.token}"

The browser opens its own sandbox; the Control Room has a "Connect your AI" panel for that one.
For a coding agent working in a sandbox of its own (people, activity, time, reset): overthink up (AGENTS.md).
Docs: docs/README.md (start with docs/connect.md).   Stop: Ctrl-C.
`);
if (o.open) openBrowser(`${base}/`);
