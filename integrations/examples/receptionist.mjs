#!/usr/bin/env node
// A STAND-IN, NOT AN AI: a rules-based "receptionist" that shows the shape of a service the business can send work to.
// Copy it and replace answer() with a call to your own model. Run: node integrations/examples/receptionist.mjs 8899
// Then take a job with its address: POST /sandboxes/<id>/jobs/reception/start {"url": "http://127.0.0.1:8899"}.
//
// Each request is one turn of the tool protocol (simulation/simulator/README.md "The tool protocol"):
//   { protocol, session_id, turn, message, history, channel, role, api_url, token, system_prompt, sim }
// and the answer is { "reply": "..." }. Act through the shop's tools at api_url with the token, sending
// X-Session-Id: session_id so a verified caller stays verified for the rest of the call.
import { createServer } from "node:http";

/** Calls one of the shop's tools. Returns { ok, data } or { ok: false, error }. */
async function tool(m, name, input) {
  const res = await fetch(`${m.api_url}/tools/${name}`, { method: "POST", body: JSON.stringify(input),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${m.token}`, "X-Session-Id": m.session_id } });
  return res.json();
}

/** The receptionist's rules. Replace this with your model. */
async function answer(m) {
  const said = [m.message, ...(m.history || []).filter((h) => h.from === "customer").map((h) => h.text)].join(" ");
  if (/\b(person|human|someone|complain)/i.test(m.message)) {
    const c = await tool(m, "escalate", { to: "support_agent", reason: "Caller asked for a person", summary: `Phone call: ${said.slice(0, 300)}`, contact: "phone" });
    return c.ok ? "Of course. I have passed this to our support team with a note, and a person will get back to you within one working day." : "I will ask a colleague to call you back within one working day.";
  }
  const order = said.match(/\bORD-\d+\b/)?.[0];
  const postcode = said.match(/\b[A-Z]{1,2}\d{1,2}[A-Z]? ?\d[A-Z]{2}\b/)?.[0];
  if (order && postcode) {
    const v = await tool(m, "verify_customer", { reference: order, email_or_postcode: postcode });
    if (!v.ok) return "That doesn't match what I can see. Could you check the order number and the postcode on it?";
    const o = await tool(m, "get_order", { order_number: order });
    const s = o.data?.shipments?.[0];
    return o.ok ? `Thank you. Order ${order} is ${o.data.status.replace(/_/g, " ")}${s?.eta ? `, with delivery expected on ${s.eta}` : ""}${s?.tracking ? ` (tracking ${s.tracking})` : ""}.` : "I can't see that order, I'm afraid.";
  }
  if (/\b(order|parcel|deliver|arrive|refund|return|broken|damaged)/i.test(said)) return "I can look into that for you. Could you give me the order number and the postcode on the order?";
  const word = said.match(/\b(umbrella|pen|sock|biscuit|helmet|sandwich|daypack|trophy|bubble wrap|boombox)e?s?\b/i)?.[1];
  if (word) {
    const r = await tool(m, "search_catalogue", { query: word });
    const p = r.data?.results?.[0];
    if (p) return `We do: ${p.name}, from £${p.price?.from ?? p.price}. Delivery is £3.95, free over £50.`;
  }
  return "Overthought & Co., how can I help? If it is about an order, I will need the order number and the postcode.";
}

const port = Number(process.argv[2] || process.env.PORT || 8899);
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  let reply;
  try { reply = await answer(JSON.parse(body)); } catch (e) { reply = "Sorry, I didn't catch that. Could you say it again?"; }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ reply }));
});
server.listen(port, "127.0.0.1", () => console.error(`Stand-in receptionist (rules, not AI) on http://127.0.0.1:${server.address().port}`));
export default server;
