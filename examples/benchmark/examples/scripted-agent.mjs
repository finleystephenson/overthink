// A tiny example agent for the benchmark. It is NOT an AI: a few if-statements play the shop's assistant,
// so you can see the whole protocol work end to end without any API key. See examples/benchmark/README.md.
//
// It speaks the protocol two ways:
//   node examples/benchmark/examples/scripted-agent.mjs --serve 9100   (HTTP: use with --http-url http://127.0.0.1:9100)
//   node examples/benchmark/examples/scripted-agent.mjs                (stdin/stdout lines: use with --cmd "node examples/benchmark/examples/scripted-agent.mjs")
//
// What it does each turn: it reads the customer's message, calls the shop's tools through the web API with the
// token the runner gave it, and replies. Swap `respond()` for a call to your own model and you have a real agent.
import { createServer } from "node:http";
import { createInterface } from "node:readline";

/** Call one of the shop's tools over the web API. Returns { ok, data } or { ok: false, error }. */
async function tool(req, name, input) {
  const res = await fetch(`${req.api_url}/tools/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${req.token}`, "X-Session-Id": req.session_id, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return res.json();
}

/** The "brain". Replace with a model call. Here: verify if the message has an order number and an email, look the order up. */
async function respond(req) {
  const order = req.message.match(/ORD-\d+/)?.[0];
  const email = req.message.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0];
  if (order && email) {
    const v = await tool(req, "verify_customer", { reference: order, email_or_postcode: email });
    if (!v.ok) return "Those details do not match our records. Could you check them?";
    const o = await tool(req, "get_order", { order_number: order });
    return o.ok ? `Your order ${order} is ${o.data.status}.` : `I could not open ${order}.`;
  }
  // Anything else: search the catalogue with the customer's own words.
  const r = await tool(req, "search_catalogue", { query: req.message });
  const hits = r.ok ? (Array.isArray(r.data) ? r.data : r.data?.results || []) : [];
  if (hits.length) return `We sell ${hits[0].name}.`;
  return "I don't know. I can pass this to a person.";
}

const [mode, port] = [process.argv[2], process.argv[3]];
if (mode === "--serve") {
  createServer(async (rq, rs) => {
    let body = ""; for await (const c of rq) body += c;
    const reply = await respond(JSON.parse(body));
    rs.writeHead(200, { "Content-Type": "application/json" }); rs.end(JSON.stringify({ reply }));
  }).listen(Number(port || 9100), "127.0.0.1", () => console.error(`example agent on ${port || 9100}`));
} else {
  for await (const line of createInterface({ input: process.stdin })) {
    console.log(JSON.stringify({ reply: await respond(JSON.parse(line)) }));
  }
}
