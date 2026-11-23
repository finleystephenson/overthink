// Situations: the same business in a different state. Each one is a small function that changes a fresh world
// before the sandbox's starting snapshot is taken, so reset returns to the situation, not to "normal".
// They use engine tools wherever a tool exists (so the records stay consistent) and edit state directly only
// where no tool does the job; each direct edit says why.

const must = (r, what) => {
  if (!r.ok) throw new Error(`Situation setup failed at ${what}: ${r.error.code} ${r.error.message}`);
  return r.data;
};
const addDaysIso = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().replace(".000Z", "Z");
const tail = (list, field) => Math.max(0, ...list.map((r) => Number(String(r[field]).match(/(\d+)$/)?.[1] || 0)));
const planted = Array.from({ length: 36 }, (_, i) => `C-${1001 + i}`);
const TEST_CARD = "4242424242424242";

/** Add an internal document. There is no tool for writing documents, so this is a direct edit. */
function addDocument(st, doc) {
  const id = `DOC-${String(tail(st.documents, "id") + 1).padStart(2, "0")}`;
  st.documents.push({ id, kind: "guide", written_at: st.now.slice(0, 10), status: "current", ...doc });
  return id;
}

/** Place an order as the customer would. Returns the order, or null if the engine refused it (e.g. no delivery to them). */
function placeOrder(world, customer_id, sku, qty) {
  const r = world.session({ role: "customer", customer_id }).call("place_order", { items: [{ sku, qty }], delivery_method: "standard", card_number: TEST_CARD });
  return r.ok ? r.data : null;
}

export const SCENARIOS = [
  {
    name: "normal",
    title: "A normal Monday",
    description: "The business exactly as generated: Monday 23 November 2026, 10:00. On a bench sandbox the benchmark's hand-written stories are there too (Blip's supplier is late with six paid orders waiting, a stock count that does not match, an out-of-date price list and the rest).",
    apply() {},
  },
  {
    name: "christmas-rush",
    title: "The Christmas rush",
    description: "The clock is moved on 21 days to Monday 14 December using advance_day, so deliveries and parcels move as they would. Then a wave of orders arrives the same morning: one gift order from each of 24 regular customers, plus enough orders of One Good Pen, the Biscuit Tin and the Spare Sock to leave 2 or fewer of each. 25 new contacts are waiting, nobody has answered them yet.",
    apply(world) {
      const manager = world.session({ role: "manager" });
      for (let d = 0; d < 21; d++) must(manager.call("advance_day", {}), "advance_day");
      const st = world.state;
      const gifts = ["OT-TROF", "OT-BOOM", "OT-PACK", "OT-UMBR", "OT-HELM", "OT-JUNG", "OT-STON-SKP-5", "OT-PUDL"].filter((s) => st.stock[s]?.on_hand > 5);
      const placed = [];
      planted.slice(0, 24).forEach((c, i) => { const o = gifts.length && placeOrder(world, c, gifts[i % gifts.length], 1); if (o) placed.push(o); });
      // Drain three popular SKUs to 2 or fewer, in small realistic baskets, spread over the customers.
      let k = 0;
      for (const sku of ["OT-PEN", "OT-BISC-24", "OT-SOCK"]) {
        let guard = 0;
        while (st.stock[sku].on_hand > 2 && guard++ < 500) {
          const o = placeOrder(world, planted[k++ % planted.length], sku, Math.min(3, st.stock[sku].on_hand - 2));
          if (o) placed.push(o);
        }
      }
      // Contacts have no tool (they are written when a person or the assistant handles one), so add them directly.
      let ct = tail(st.contacts, "id");
      const channels = ["web_chat", "email", "phone", "text"];
      for (let i = 0; i < 25; i++) {
        const o = placed[i % placed.length];
        st.contacts.push({
          id: `CT-${String(++ct).padStart(5, "0")}`, at: addDaysIso(st.now, -(i * 7) / 1440), customer_id: o.customer_id,
          channel: channels[i % 4], topic: "christmas_delivery", handled_by: null, first_reply_minutes: null, resolve_minutes: null,
          outcome: "waiting", case_number: null, summary: `Asks whether ${o.number} will arrive before Christmas.`,
        });
      }
    },
  },
  {
    name: "supplier-late",
    bench_only: true, // builds on the story of Blip's late purchase order
    title: "A supplier lets us down",
    description: "Blip's purchase order was already late (due 16 Nov, promised for 30 Nov). This morning the supplier emailed: the 30 Nov date has slipped and they cannot give a new one. The order now has no expected date, and the paid Blip orders keep waiting. The email is filed as a current document.",
    apply(world) {
      const st = world.state;
      const po = st.purchase_orders.find((p) => p.status === "late" && p.lines.some((l) => l.sku === "OT-BLIP"));
      const supplier = st.suppliers.find((s) => s.id === po.supplier_id);
      // No tool records a supplier's broken promise; a buyer would update the record by hand like this.
      po.expected_at = null;
      po.note = `${po.note} ${supplier.name} emailed on 23 Nov: the 30 Nov date has slipped and they cannot give a new date yet.`.trim();
      addDocument(st, {
        title: `Email from ${supplier.name}: Blip delivery delayed again`, kind: "supplier_email",
        body: `# Email from ${supplier.name}, 23 Nov 2026\nSorry. The Blip batch for ${po.number} (${po.lines[0].qty} units) will not make 30 November. A component is held at the port. We cannot give a new date until it clears customs. We will write again by Friday.\n`,
      });
    },
  },
  {
    name: "recall",
    title: "A product recall",
    description: "Testing found that one delivery (batch) of the Boombox Mini can overheat while charging. That batch is the purchase order with the most 'will not charge' repairs. Every order whose Boombox Mini came from it is flagged with a recall note and a history line, the remaining stock is counted to zero and taken off sale with a stock count, and a staff document says exactly what to do.",
    apply(world) {
      const st = world.state;
      const sku = "OT-BOOM";
      const counts = {};
      for (const r of st.repairs) if (r.sku === sku && r.batch) counts[r.batch] = (counts[r.batch] || 0) + 1;
      const pos = st.purchase_orders.filter((p) => p.received_at && p.lines.some((l) => l.sku === sku)).sort((a, b) => a.received_at.localeCompare(b.received_at));
      const worst = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      const batch = pos.find((p) => p.number === worst) || pos.at(-2) || pos.at(-1);
      const next = pos[pos.indexOf(batch) + 1];
      // Stock goes out first in, first out, so units sold between this delivery and the next one came from it.
      const affected = st.orders.filter((o) => o.status !== "cancelled" && o.items.some((i) => i.sku === sku) && o.placed_at >= batch.received_at && (!next || o.placed_at < next.received_at));
      const recall = { id: "RECALL-01", sku, batch: batch.number, issue: "May overheat while charging.", status: "customer_not_contacted" };
      // No tool flags an order; a recall is a manual, company-wide decision.
      for (const o of affected) {
        o.recall = { ...recall };
        (o.history ||= []).push({ at: st.now, event: "Safety recall RECALL-01: this Boombox Mini may overheat while charging. Customer to be contacted." });
      }
      must(world.session({ role: "warehouse" }).call("record_stock_count", { sku, counted_qty: 0, note: "Recall RECALL-01: all Boombox Mini stock quarantined, not for sale.", adjust: true }), "record_stock_count");
      addDocument(st, {
        title: "Recall RECALL-01: Boombox Mini, overheating", kind: "recall_notice",
        body: `# Recall RECALL-01: Boombox Mini\nUnits from purchase order ${batch.number} may overheat while charging. ${affected.length} customer orders are affected; each has a \`recall\` note.\n\n## What to do\n1. Tell the customer to stop charging and using it now.\n2. Offer a full refund including delivery, or a replacement when safe stock arrives. They keep or recycle the unit; we never ask them to post a battery.\n3. Support agents and the support lead issue the refund. The assistant explains, opens a case (category "repairs", mention RECALL-01) and escalates to support_agent. It does not promise an amount or a date.\n4. Any burn, injury or damage to property: escalate to support_lead the same day.\n5. Do not sell Boombox Mini until this notice is withdrawn. Stock has been counted to zero.\n`,
      });
    },
  },
  {
    name: "cash-squeeze",
    title: "A cash squeeze",
    description: "The quarterly VAT bill has just been paid, leaving £1,200 in the bank (or a quarter of the cash, if the world is smaller). A large Christmas stock order of Boombox Minis was ordered and delivered (through the engine), and its invoice must be paid within 3 days. The invoice is far more than the cash.",
    apply(world) {
      const st = world.state;
      const month = st.monthly_summary.at(-1);
      // £1,200, or a quarter of the cash if the world is small (the demo world only holds about £1,200).
      const target = Math.min(1200, Math.round(month.cash_at_month_end * 25) / 100);
      const bill = Math.round((month.cash_at_month_end - target) * 100) / 100;
      if (bill > 0) must(world.session({ role: "finance" }).call("add_ledger_correction", { amount: -bill, reference: "VAT-2026-Q3", reason: "Quarterly VAT bill paid to HMRC (fictional)." }), "add_ledger_correction");
      // The monthly summary is worked out once by the generator; keep its cash figure in step with the ledger.
      month.cash_at_month_end = target;
      const supplier = st.suppliers.find((s) => s.skus.includes("OT-BOOM"));
      const unit = supplier.unit_cost["OT-BOOM"];
      const qty = Math.max(supplier.min_order_qty, Math.ceil(6000 / unit));
      const manager = world.session({ role: "manager" });
      const po = must(manager.call("create_purchase_order", { supplier_id: supplier.id, lines: [{ sku: "OT-BOOM", qty }], note: "Christmas stock." }), "create_purchase_order");
      const rec = st.purchase_orders.find((p) => p.number === po.number);
      if (rec.status !== "ordered") must(manager.call("approve_purchase_order", { number: po.number }), "approve_purchase_order");
      must(manager.call("receive_purchase_order", { number: po.number }), "receive_purchase_order");
      // WHY a direct edit: payment dates are not modelled per invoice; this supplier asked for short terms on this order.
      rec.payment_due_at = addDaysIso(st.now, 3).slice(0, 10);
      rec.note = `Christmas stock. Invoice £${(qty * unit).toFixed(2)} must be paid by ${rec.payment_due_at} (supplier agreed delivery on 3-day terms).`;
    },
  },
];

export const scenarioNames = SCENARIOS.map((s) => s.name);
export const listScenarios = () => SCENARIOS.map(({ name, title, description, bench_only }) => ({ name, title, description, bench_only: bench_only === true }));

/**
 * Apply a named situation to a fresh world. Clears the audit so the trace only shows what the caller does.
 * Situations that build on a story record (bench_only) need a bench world (business/data/world-bench).
 */
export function applyScenario(world, name = "normal", { bench = false } = {}) {
  const s = SCENARIOS.find((x) => x.name === name);
  if (!s) throw Object.assign(new Error(`Unknown scenario "${name}". Choose one of: ${scenarioNames.join(", ")}.`), { code: "invalid_input" });
  if (s.bench_only && !bench) throw Object.assign(new Error(`The "${name}" situation builds on the benchmark's stories. Create the sandbox with "bench": true.`), { code: "invalid_input" });
  s.apply(world);
  world.state.audit = [];
}
