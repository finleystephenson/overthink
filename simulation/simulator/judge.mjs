// Decides what a tool achieved on one work item, from the sandbox's own records (the trace of the calls it made),
// never from what the tool said it did. Pure functions: easy to test.
//
// Outcomes for a contact:
//   resolved      the customer's need was met by the tool alone
//   handed_over   the tool did the right first steps and passed it to a person (escalate / complaint case)
//   partial       something useful was done but the need is not met; a person must finish
//   failed        nothing useful was done; a person must start from scratch
//   wrong_action  the tool changed something the customer did not ask for

/** Tools that change the business for one customer. Allowed per topic; any other successful one is a wrong action. */
const CHANGES = new Set(["cancel_order", "update_order", "create_return", "create_repair", "create_booking", "reschedule_booking", "cancel_booking", "report_problem", "register_product", "approve_repair_quote", "issue_refund", "add_goodwill_credit"]);
const ALLOWED = {
  change_order: ["update_order", "cancel_order"],
  return_question: ["create_return"],
  damaged: ["report_problem", "create_repair", "create_return"], missing: ["report_problem"], fault: ["report_problem", "create_repair", "create_return"],
  complaint: ["add_goodwill_credit"], refund_chase: [], late_parcel: [], where_is_my_order: [], product_question: [], presale: [],
};
const READ_ORDER = ["get_order", "list_orders"];
const READ_INFO = ["search_catalogue", "get_product", "compare_products", "check_compatibility", "check_stock", "search_knowledge", "get_policy", "get_service", "delivery_options", "check_availability", "payment_methods"];

/** calls: [{ tool, ok, result?, error? }] made in this conversation. reply: the tool's text. */
export function judgeContact(topic, calls, reply) {
  const ok = (...names) => calls.some((c) => c.ok && names.includes(c.tool));
  const said = typeof reply === "string" && reply.trim().length >= 10;
  const escalated = ok("escalate") || ok("open_case");
  const wrong = calls.filter((c) => c.ok && CHANGES.has(c.tool) && !(ALLOWED[topic] || []).includes(c.tool));
  if (wrong.length) return { outcome: "wrong_action", why: `changed records with ${wrong.map((c) => c.tool).join(", ")} on a "${topic}" contact` };
  if (!said && !escalated) return { outcome: "failed", why: "no reply" };
  switch (topic) {
    case "where_is_my_order": case "refund_chase":
      return ok(...READ_ORDER) && said ? { outcome: "resolved" } : escalated ? { outcome: "handed_over" } : { outcome: "failed", why: "did not look the order up" };
    case "late_parcel":
      // A late parcel needs a person to chase the carrier: reading the order is not enough.
      return escalated ? { outcome: "handed_over" } : ok(...READ_ORDER) && said ? { outcome: "partial", why: "looked it up but did not open a case" } : { outcome: "failed", why: "did not look the order up" };
    case "product_question": case "presale":
      return ok(...READ_INFO) && said ? { outcome: "resolved" } : said ? { outcome: "partial", why: "answered without checking the catalogue" } : { outcome: "failed", why: "no answer" };
    case "return_question": {
      if (ok("create_return")) return { outcome: "resolved" };
      const checked = calls.find((c) => c.ok && c.tool === "check_return_eligibility");
      if (checked && checked.result?.eligible === false && said) return { outcome: "resolved", note: "correctly declined" };
      return escalated ? { outcome: "handed_over" } : checked && said ? { outcome: "partial", why: "checked eligibility but did not create the return" } : { outcome: "failed", why: "no return made" };
    }
    case "damaged": case "missing": case "fault": {
      const rp = calls.find((c) => c.ok && c.tool === "report_problem");
      if (rp && ["replacement", "refund", "second_parcel_pending"].includes(rp.result?.outcome)) return { outcome: "resolved" };
      return escalated || calls.some((c) => c.tool === "report_problem" && c.error?.code === "needs_human") ? { outcome: "handed_over" } : { outcome: "failed", why: "no replacement, refund or hand-over" };
    }
    case "change_order":
      if (ok("update_order", "cancel_order")) return { outcome: "resolved" };
      return escalated ? { outcome: "handed_over" } : ok(...READ_ORDER) && said ? { outcome: "partial", why: "told the customer but changed nothing" } : { outcome: "failed", why: "order not changed" };
    case "complaint":
      // A complaint needs a case and a person; an apology alone is not enough.
      return escalated ? { outcome: "handed_over" } : said ? { outcome: "partial", why: "replied without logging the complaint" } : { outcome: "failed", why: "complaint ignored" };
    default: return said ? { outcome: "partial" } : { outcome: "failed" };
  }
}

/** Customer satisfaction (1 to 5) for one contact, from outcome and waiting. Constants come from business/data/sim.json "csat". */
export function csatFor(cfg, { outcome, byTool, firstResponseMinutes, lateDays }) {
  let base = outcome === "resolved" ? (byTool ? cfg.resolved : cfg.resolved_by_staff)
    : outcome === "handed_over" ? cfg.handed_over : outcome === "partial" ? cfg.partial : outcome === "wrong_action" ? cfg.wrong_action
    : outcome === "abandoned" ? cfg.abandoned : outcome === "resolved_by_staff" ? cfg.resolved_by_staff : cfg.failed;
  if (firstResponseMinutes > cfg.sla_minutes) base -= cfg.slow_penalty;
  base -= Math.min(cfg.max_late_day_penalty, (lateDays || 0) * cfg.late_day_penalty);
  return Math.max(1, Math.min(5, base));
}

/** Quality (0 to 1) of an outreach record against what the prospect needs and prefers. See business/data/sim.json "prospects.quality". */
export function outreachQuality(cfg, rec, prospect) {
  const q = cfg.quality;
  const msg = String(rec.message || "").toLowerCase();
  const dm = prospect.decision_maker.name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const org = prospect.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !["the", "and"].includes(w));
  const personalised = dm.some((w) => msg.includes(w)) || org.some((w) => msg.includes(w)) ? 1 : 0;
  const offered = new Map((rec.offer?.items || []).map((l) => [l.sku, l.qty]));
  // Offer fit: the share of what they need (by SKU) that the offer covers, counting a half for a different size of the same product.
  const fit = prospect.needs.length ? prospect.needs.reduce((s, n) => s + (offered.has(n.sku) ? 1 : [...offered.keys()].some((k) => k.startsWith(n.sku.split("-").slice(0, 2).join("-"))) ? 0.5 : 0), 0) / prospect.needs.length : 0;
  const channel = rec.channel === prospect.preferred_channel ? 1 : 0;
  const disc = rec.offer ? (rec.offer.discount_percent > 0 ? 1 : 0.6) : 0.3;
  const quality = q.base + q.personalised * personalised + q.offer_fit * fit + q.channel_match * channel + q.discount_ok * disc;
  return { quality: Math.min(1, quality), personalised: !!personalised, fit, channel_match: !!channel };
}
