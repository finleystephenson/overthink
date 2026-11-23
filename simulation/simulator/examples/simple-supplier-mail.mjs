// A deliberately simple buyer's helper for supplier mail. It is NOT an AI: a few rules. Role "buyer".
//
// Protocol (simulation/simulator/README.md): one JSON message per line on stdin, one {"reply": "..."} per line on stdout.
//   sim.kind "alerts"        (products running low): for each low product with an order already open, it asks that
//                            order's supplier, politely, to bring it forward. Once per order.
//   sim.kind "supplier_mail" (suppliers have written): it reads each email, thanks the supplier when it agreed to
//                            something, and marks the mail read.
// It calls the shop's tools over the web API with the token it was given, so the engine's rules apply.
import { createInterface } from "node:readline";

const asked = new Set(); // purchase orders already asked about (per process, so per branch)

async function tool(req, name, input) {
  const res = await fetch(`${req.api_url}/tools/${name}`, {
    method: "POST", headers: { Authorization: `Bearer ${req.token}`, "X-Session-Id": req.session_id, "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  return res.json();
}

/** Ask the supplier of each low product's open order to bring it forward. */
async function chaseLowStock(req) {
  const low = req.sim?.data?.low_stock || [];
  if (!low.length) return "Nothing low.";
  const contacts = await tool(req, "list_supplier_contacts", {});
  const emailOf = Object.fromEntries((contacts.data?.contacts || []).map((c) => [c.supplier_id, c]));
  let sent = 0;
  for (const item of low) {
    const pos = await tool(req, "list_purchase_orders", { sku: item.sku, status: "ordered" });
    const po = pos.data?.purchase_orders?.[0];
    const c = emailOf[item.supplier_id];
    if (!po || !c || asked.has(po.number)) continue;
    asked.add(po.number);
    const r = await tool(req, "send_email", { mailbox: "suppliers", to: [c.email], subject: po.number,
      body: `Hello,\n\nCould you bring ${po.number} forward, please? We are running low on ${item.sku}. Thank you for your help.\n\nKind regards,\nRobinson Crusoe` });
    if (r.ok) sent++;
  }
  return `Asked ${sent} suppliers to bring orders forward.`;
}

/** Read supplier mail; say thank you for anything agreed; mark it read. */
async function readSupplierMail(req) {
  const list = await tool(req, "list_emails", { mailbox: "suppliers", unread: true, limit: 50 });
  let thanked = 0;
  for (const e of list.data?.emails || []) {
    if (/we can bring|we've changed|we can take/i.test(e.snippet || "")) {
      const r = await tool(req, "send_email", { mailbox: "suppliers", reply_to_id: e.id, body: "Thank you, that is a great help.\n\nRobinson Crusoe" });
      if (r.ok) thanked++;
    }
    await tool(req, "mark_email", { email_id: e.id, mark: "read" });
  }
  return `Read ${(list.data?.emails || []).length} supplier emails, thanked ${thanked}.`;
}

async function respond(req) {
  if (req.sim?.kind === "alerts") return chaseLowStock(req);
  if (req.sim?.kind === "supplier_mail") return readSupplierMail(req);
  return "This helper only deals with suppliers.";
}

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  if (!line.trim()) continue;
  let out;
  try { out = { reply: await respond(JSON.parse(line)) }; } catch (e) { out = { reply: "Sorry, something went wrong." }; }
  process.stdout.write(JSON.stringify(out) + "\n");
}
