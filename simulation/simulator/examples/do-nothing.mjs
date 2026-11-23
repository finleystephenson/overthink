#!/usr/bin/env node
// The "do nothing" tool: answers every message with silence and calls no tools, so staff do all the work.
// It is the floor any tool should beat; simulation/simulator/examples/simple-responder.mjs (rules, no AI) is the bar.
//   pnpm sim -- --tool-cmd "node simulation/simulator/examples/do-nothing.mjs"
import { createInterface } from "node:readline";

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  process.stdout.write(JSON.stringify({ reply: "" }) + "\n");
}
