// A test feeder for the sandbox desktop: a live server (the same one `overthink run --live` starts) that streams
// made-up `overthink.live/1` events at any rate, so the desktop's calm mode can be seen and checked without a model.
//
//   node applications/desktop/feed-burst.mjs --port 8921 --rate 2000 --seconds 20 --slow 6
//
// Opens nothing; visit http://127.0.0.1:<port>/ . First a few events at a person's pace (windows come forward), then
// --seconds of --rate events a second (the desktop goes calm), then --slow events, one every three seconds (and
// back to normal once things stay quiet). Ctrl+C stops it. Nothing here touches a business: the events are invented.

import { parseArgs } from "node:util";
import { openLiveStream } from "../../observability/live/events.ts";
import { startLiveServer } from "../../observability/live/server.ts";

const { values: v } = parseArgs({ options: {
  port: { type: "string", default: "8921" }, rate: { type: "string", default: "2000" },
  seconds: { type: "string", default: "20" }, slow: { type: "string", default: "6" }, lead: { type: "string", default: "4" },
} });

const NAMES = ["Anne Elliot", "Elizabeth Bennet", "Mr Toad", "Mowgli", "Jane Eyre", "Pip", "Emma Woodhouse", "Ishmael", "Dorothy Gale", "Heathcliff"];
const MOVES = [
  { app: "letterbox", type: "product.replied", channel: "email", text: "Thanks for getting in touch. I have looked at your order and it left our warehouse this morning." },
  { app: "till", type: "product.acted", tool: "refund_order", record: () => `ORD-${10400 + rnd(300)}` },
  { app: "front-desk", type: "product.acted", tool: "add_case_note", record: () => `CASE-${9000 + rnd(200)}` },
  { app: "front-desk", type: "contact.raised", channel: "web_chat", text: "Hello, my kettle arrived with a dent in it." },
  { app: "till", type: "product.read", tool: "get_order", record: () => `ORD-${10400 + rnd(300)}` },
  { app: "stockroom", type: "product.acted", tool: "create_purchase_order", record: () => `PO-${3200 + rnd(50)}` },
  { app: "mutter", type: "product.published", kind: "post", network: "mutter", text: "New in: socks that remember which foot they belong on." },
  { app: "kettle", type: "product.acted", tool: "post_message" },
  { app: "front-desk", type: "person.reacted", kind: "customer", ending: "satisfied" },
];

function rnd(n) {
  return Math.floor(Math.random() * n);
}

let simMs = Date.parse("2026-11-23T10:00:00Z");

function one(stream) {
  const m = MOVES[rnd(MOVES.length)];
  const who = NAMES[rnd(NAMES.length)];
  const session = `CT-${String(10 + rnd(40)).padStart(5, "0")}`;
  simMs += 7000 + rnd(20000);
  const data = m.type === "product.replied" ? { text: m.text, to: { kind: "customer", name: who } }
    : m.type === "contact.raised" ? { who: { kind: "customer", name: who }, topic: "delivery", text: m.text }
      : m.type === "product.published" ? { kind: m.kind, network: m.network, text: m.text, content_hash: "x" }
        : m.type === "person.reacted" ? { kind: m.kind, ending: m.ending, sorted: true, text: "Lovely, thank you." }
          : { tool: m.tool, arguments: {}, ok: true, code: null, refused: false };
  stream.emit({
    type: m.type, arm: "with", seed: 1, sim_time: new Date(simMs).toISOString().replace(/\.\d+Z$/, "Z"), audience: "customers",
    channel: m.channel || null, session, app: m.app, record: m.record ? m.record() : null,
    summary: m.type === "person.reacted" ? `${who}: satisfied` : m.tool ? `Did: ${m.tool}` : m.type, data,
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const stream = openLiveStream();
const server = await startLiveServer(stream, Number(v.port));
console.log(`Feeding ${server.url}/  (${v.rate} a second for ${v.seconds}s after a slow start). Ctrl+C stops.`);
stream.emit({ type: "run.started", summary: "Run started", data: { adapter: "Burst feeder", seeds: [1], days: 1 } });
await wait(5000);
for (let i = 0; i < Number(v.lead); i++) { one(stream); await wait(2600); }
const rate = Number(v.rate);
const end = Date.now() + Number(v.seconds) * 1000;
while (Date.now() < end) {
  // Batches every 50ms, so a high rate is spread evenly rather than in one lump a second.
  for (let i = 0; i < rate / 20; i++) one(stream);
  await wait(50);
}
for (let i = 0; i < Number(v.slow); i++) { await wait(3000); one(stream); }
stream.emit({ type: "run.finished", summary: "Run finished", data: { headline: "Burst over" } });
console.log(`Done: ${stream.events.length} events. Still serving until Ctrl+C.`);
process.on("SIGINT", async () => { await server.close(); process.exit(0); });
