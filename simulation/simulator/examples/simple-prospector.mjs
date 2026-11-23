// A deliberately simple prospecting tool for the "marketing" role. NOT an AI: it writes a personalised message from each
// prospect's own record, offers what they need at 5% off, and uses the channel they prefer. It proves the prospect loop.
// Protocol: see simulation/simulator/README.md (one JSON line in, {"reply": "..."} out). It acts only through the shop's tools.
import { createInterface } from "node:readline";

async function tool(req, name, input) {
  const res = await fetch(`${req.api_url}/tools/${name}`, { method: "POST", headers: { Authorization: `Bearer ${req.token}`, "X-Session-Id": req.session_id, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return res.json();
}
const DAILY_LIMIT = 10;

async function respond(req) {
  if (req.sim?.kind !== "prospects") return "I only prospect for new business.";
  // Replied prospects first (a follow-up is allowed after a reply), then new ones with the biggest budgets.
  const replied = await tool(req, "list_prospects", { status: "replied", limit: 20 });
  const fresh = await tool(req, "list_prospects", { status: "new", min_monthly_budget: 100, limit: 100 });
  const queue = [...(replied.ok ? replied.data.prospects : []), ...(fresh.ok ? fresh.data.prospects.sort((a, b) => b.monthly_budget - a.monthly_budget) : [])].slice(0, DAILY_LIMIT);
  let sent = 0;
  for (const p of queue) {
    const surname = p.decision_maker.name.split(" ").pop();
    const needs = p.needs.map((n) => `${n.product.replace(/-/g, " ")}`).join(", ");
    const r = await tool(req, "send_outreach", {
      prospect_id: p.id, channel: p.preferred_channel,
      message: `Dear ${surname}, we are Overthought & Co. We can supply ${p.name} with ${needs}, delivered on a schedule that suits you. Here is an offer for what we think you need.`,
      offer: { items: p.needs.map((n) => ({ sku: n.sku, qty: n.qty })), discount_percent: 5 },
    });
    if (r.ok) sent++;
  }
  return `Contacted ${sent} prospects.`;
}

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  if (!line.trim()) continue;
  let out;
  try { out = { reply: await respond(JSON.parse(line)) }; } catch { out = { reply: "Sorry, something went wrong." }; }
  process.stdout.write(JSON.stringify(out) + "\n");
}
