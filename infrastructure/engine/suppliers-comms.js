// The supplier side's records and tools: who to write to at each supplier, what suppliers were asked and what they
// said, and (world lens only) how each supplier feels about the shop. An extension of engine.js; the rules that answer
// the shop's emails are in simulation/world/supplier-side.mjs and run as the simulator plug-in "world-supplier-side".
//
// Records: supplier_requests, one per email a supplier read or message it sent, with the decision and the reason.
// Registration: import "./suppliers-comms.js" in infrastructure/engine/all.js.
import { extend, kit } from "./engine.js";
import { amendPurchaseOrder, standingOf, supplierPeople, SUPPLIER_SIDE } from "../../simulation/world/supplier-side.mjs";

const { fail, dateOf, ms, stamp, schema: { str, num, obj }, roles } = kit;
const integer = { type: "integer" };
/** Who deals with suppliers. WHY the same as the stock readers: they see purchase orders and unit costs already. */
const BUYING = [...roles.STOCK_READERS, "world"];
const WORLD = ["world"];

const today = (ctx) => dateOf(ms(ctx.now));

const TOOLS = [
  {
    name: "list_supplier_contacts", roles: BUYING,
    description: "Who to write to at each supplier: the contact person, their email address, the sales and accounts desks, and the supplier's terms (lead time, minimum order per line, payment terms). Email a supplier with send_email from the suppliers mailbox; they answer on the next working day.",
    input_schema: obj({}),
    run(ctx) {
      const out = [];
      for (const sup of ctx.st.suppliers || []) {
        const p = supplierPeople(sup);
        if (!p) continue;
        out.push({ supplier_id: sup.id, supplier: sup.name, contact: p.contact.name, email: p.from.address, sales_desk: p.addresses[1], accounts_desk: p.addresses[2],
          lead_time_days: sup.lead_time_days, min_order_qty: sup.min_order_qty, payment_terms_days: sup.payment_terms_days });
      }
      return { total: out.length, contacts: out };
    },
  },
  {
    name: "list_supplier_requests", roles: BUYING,
    description: "What suppliers were asked and what they said, newest first: each email a supplier read (expedite, discount, quantity, lead time), each order it queried or confirmed, and each delay it warned of, with the decision (agreed, refused, answered, query, informed) and the reason. Optional supplier_id, po, kind, limit (default 25, at most 100).",
    input_schema: obj({ supplier_id: str, po: str, kind: str, limit: integer }),
    run(ctx, i) {
      const list = (ctx.st.supplier_requests || []).filter((r) => (!i.supplier_id || r.supplier_id === i.supplier_id) && (!i.po || r.po === i.po) && (!i.kind || r.kind === i.kind));
      const hide = ctx.role === "world" ? [] : ["trigger", "minimum_note"];
      const rows = list.slice().reverse().slice(0, Math.min(100, Math.max(1, i.limit || 25)))
        .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !hide.includes(k))));
      return { total: list.length, requests: rows };
    },
  },
  {
    name: "get_supplier_standing", roles: WORLD,
    description: "World lens only: how a supplier feels about the shop today and why (rude emails, bills paid late, many changes, thank-yous), and what it will agree to. A supplier at or below the cool line answers more slowly and offers half as much; at the lowest it refuses changes.",
    input_schema: obj({ supplier_id: str }, ["supplier_id"]),
    run(ctx, i) {
      const sup = (ctx.st.suppliers || []).find((s) => s.id === i.supplier_id) || fail("not_found", `No supplier ${i.supplier_id}.`);
      const p = supplierPeople(sup) || fail("not_found", `${sup.name} has no contact in business/data/supplier-side.json.`);
      return { supplier_id: sup.id, supplier: sup.name, contact: p.contact, tone: p.tone, standing: standingOf(ctx.st, sup.id, today(ctx)), rules: p.side, shared_rules: SUPPLIER_SIDE.rules };
    },
  },
  {
    name: "apply_supplier_change", roles: WORLD,
    description: "World lens only: a supplier agrees a change to a purchase order: a new due date (due, YYYY-MM-DD), a price factor on every line (price_factor, 0.95 = 5% off), or a new quantity on one line (sku and qty). The same code the supplier side uses when it agrees by email. Only open orders (ordered or late) can change.",
    input_schema: obj({ number: str, due: str, price_factor: num, sku: str, qty: integer, why: str }, ["number"]),
    run(ctx, i) {
      const po = (ctx.st.purchase_orders || []).find((p) => p.number === i.number) || fail("not_found", `No purchase order ${i.number}.`);
      if (!["ordered", "late"].includes(po.status)) fail("rule_violation", `${po.number} is ${po.status}; only open orders can change.`);
      if (i.due !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(i.due)) fail("invalid_input", "due must be a date, YYYY-MM-DD.");
      if (i.price_factor !== undefined && !(i.price_factor > 0 && i.price_factor <= 2)) fail("invalid_input", "price_factor must be above 0 and at most 2.");
      if (i.sku !== undefined && !po.lines.some((l) => l.sku === i.sku)) fail("invalid_input", `${i.sku} is not on ${po.number}.`);
      if (i.qty !== undefined && (i.sku === undefined || i.qty < 1)) fail("invalid_input", "A new quantity needs a sku and a number of at least 1.");
      const sup = (ctx.st.suppliers || []).find((s) => s.id === po.supplier_id);
      const notes = amendPurchaseOrder(ctx.st, po, { due: i.due, price_factor: i.price_factor, sku: i.sku, qty: i.qty }, { at: stamp(ctx), by: supplierPeople(sup)?.from.name || sup?.name || po.supplier_id, why: i.why || null });
      // WHY drop the audit line amendPurchaseOrder wrote: this call is already audited by the engine itself.
      if (notes.length) ctx.st.audit.pop();
      for (const n of notes) ctx.changes.push(n);
      return { number: po.number, changes: notes, purchase_order: po };
    },
  },
];

extend({ state: ["supplier_requests"], counters: [["SR", "supplier_requests", "id"]], tools: TOOLS });
