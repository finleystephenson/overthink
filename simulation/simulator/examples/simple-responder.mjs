// A deliberately simple customer-service responder. It is NOT an AI: a few if-statements and keyword matches.
// It exists only to prove the simulator loop end to end, with a role of "assistant".
//
// Protocol (see simulation/simulator/README.md): one JSON message per line on stdin, one {"reply": "..."} per line on stdout.
// Each message has `session_id`, `message`, `api_url`, `token` and `sim.kind` ("contact", "alerts" or "prospects").
// It calls the shop's tools over the web API with the token it was given, so the engine's rules apply.
import { createInterface } from "node:readline";

async function tool(req, name, input) {
  const res = await fetch(`${req.api_url}/tools/${name}`, {
    method: "POST", headers: { Authorization: `Bearer ${req.token}`, "X-Session-Id": req.session_id, "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  return res.json();
}

async function respond(req) {
  if (req.sim?.kind !== "contact") return "This responder only answers customers.";
  const text = req.message, low = text.toLowerCase();
  const order = text.match(/ORD-\d+/)?.[0], postcode = text.match(/postcode is ([A-Z0-9 ]+)\./)?.[1]?.trim();
  const isQuestion = !order;
  // Questions before a purchase: search the catalogue with the product named in the message.
  if (isQuestion) {
    const words = low.match(/(?:the|about the) ([a-z' -]+?)(?:[?.,]| does| come| how|$)/)?.[1] || low;
    const r = await tool(req, "search_catalogue", { query: words });
    const hit = (r.ok ? (Array.isArray(r.data) ? r.data : r.data?.results || r.data?.products || []) : [])[0];
    return hit ? `${hit.name}: ${hit.tagline || hit.summary || "see our website for details"}. Delivery is from £3.95.` : "I could not find that. A person will help you.";
  }
  const v = await tool(req, "verify_customer", { reference: order, email_or_postcode: postcode || "" });
  if (!v.ok) return "I could not verify those details. Please check your order number and postcode.";
  const o = await tool(req, "get_order", { order_number: order });
  if (!o.ok) return "I could not open that order.";
  const items = o.data.items || [];
  const named = items.find((l) => low.includes(l.name.toLowerCase().replace(/^the /, "")));
  const sku = (named || items[0])?.sku;
  const escalate = async (to, reason) => { await tool(req, "escalate", { to, reason, summary: text.slice(0, 200) }); return "I have passed this to a colleague, who will pick it up first thing."; };
  if (/where is my refund|refund/.test(low)) return `Your order ${order} is ${o.data.status}. Refunds reach your card within 5 working days of being issued.`;
  if (/cancel/.test(low)) { const c = await tool(req, "cancel_order", { order_number: order, reason: "customer asked" }); return c.ok ? `Order ${order} is cancelled and refunded.` : await escalate("support_agent", "cancel failed: " + c.error?.code); }
  if (/damaged|missing|stopped working/.test(low)) {
    const problem = /missing/.test(low) ? "missing" : "damaged";
    const p = await tool(req, "report_problem", { order_number: order, sku, problem, resolution: "replacement", has_photo: /photo/.test(low) });
    return p.ok ? `Sorry about that. We are sending a replacement (${p.data.outcome}).` : await escalate("support_agent", `${problem} item: ${p.error?.code}`);
  }
  if (/complaint|unhappy/.test(low)) { await tool(req, "open_case", { subject: "Complaint", category: "complaint", summary: text.slice(0, 200), related: { order }, is_complaint: true }); return await escalate("support_lead", "customer complaint"); }
  if (/late|chase|delay/.test(low)) { await tool(req, "open_case", { subject: "Late parcel", category: "delivery", summary: text.slice(0, 200), related: { order } }); return await escalate("support_agent", "late parcel needs chasing"); }
  if (/return/.test(low)) return await escalate("support_agent", "return request");
  if (/change|address/.test(low)) return await escalate("support_agent", "order change");
  return `Your order ${order} is ${o.data.status}. ${(o.data.shipments || []).map((s) => `Parcel ${s.id}: ${s.status}${s.eta ? ", expected " + s.eta : ""}`).join(". ")}`;
}

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  if (!line.trim()) continue;
  let out;
  try { out = { reply: await respond(JSON.parse(line)) }; } catch (e) { out = { reply: "Sorry, something went wrong." }; }
  process.stdout.write(JSON.stringify(out) + "\n");
}
