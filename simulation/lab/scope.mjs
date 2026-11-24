// What a connected product may touch: a list of tools or apps it may READ, and a list it may ACT on.
//
//   { "read": ["email", "orders", "catalogue"], "act": ["send_email", "open_case"] }
//
// An entry is a tool name ("send_email"), an app name from APPS below ("email"), or "*" (everything). A tool that only
// looks (its name starts list_, get_, search_, check_ ... the same rule the MCP server uses for its read-only hint)
// needs a READ entry; any other tool needs an ACT entry. No scope at all means the role's own permissions only.
// The lab's web door enforces it (simulation/lab/branch.mjs startHost): a call outside the scope is refused with
// "out_of_scope" before the engine sees it, and written in the trace like any other call, so it counts under safety.
import { annotationsFor } from "../../infrastructure/server/mcp.mjs";

/** Apps as groups of tools, by what the tool name mentions. */
export const APPS = {
  email: /email|mailbox|draft/,
  orders: /order|verify_customer|delivery_options|payment_methods/,
  customers: /customer/,
  returns: /return/,
  refunds: /refund|goodwill/,
  cases: /case|escalate|conversation/,
  catalogue: /catalogue|product|compatib|price_history/,
  stock: /stock|purchase_order|supplier/,
  repairs: /repair|register_product/,
  bookings: /booking|availability|service/,
  knowledge: /knowledge|policy|policies|help/,
  social: /social|post/,
  marketing: /campaign|marketing|prospect|outreach/,
  money: /ledger|bill|pay_later|business_snapshot|books/,
  news: /news|world_event|event_template/,
  calendar: /^(list|get|create|update|cancel)_events?$/,
  contacts: /contact_card/,
};

/**
 * Checks a scope as given. Throws invalid_input in plain words.
 * @param {*} s
 * @return {?{read: Array<string>, act: Array<string>}}
 */
export function checkScope(s) {
  if (s === null || s === undefined) return null;
  const fail = (m) => { throw Object.assign(new Error(m), { code: "invalid_input" }); };
  if (typeof s !== "object") fail('A scope is { "read": [...], "act": [...] }: tool names, app names or "*".');
  const list = (x, k) => {
    if (x === undefined) return [];
    if (!Array.isArray(x) || x.some((e) => typeof e !== "string" || e.length > 60)) fail(`"${k}" is a list of tool or app names.`);
    return x;
  };
  return { read: list(s.read, "read"), act: list(s.act, "act") };
}

/** Whether a tool only reads. */
export const isRead = (tool) => annotationsFor(tool).readOnlyHint;

/**
 * Whether a scope allows a tool, and why not.
 * @param {{read: Array<string>, act: Array<string>}} scope
 * @param {string} tool
 * @return {{ok: boolean, need: string, why: ?string}}
 */
export function allowed(scope, tool) {
  const need = isRead(tool) ? "read" : "act";
  // Acting on something includes reading it: an ACT entry also allows the reads of the same app.
  const lists = need === "read" ? [...scope.read, ...scope.act] : scope.act;
  const ok = lists.some((e) => e === "*" || e === tool || (APPS[e] && APPS[e].test(tool)));
  return { ok, need, why: ok ? null : `This product may not ${need === "read" ? "read with" : "use"} ${tool} (its scope: read ${scope.read.join(", ") || "nothing"}; act on ${scope.act.join(", ") || "nothing"}).` };
}
