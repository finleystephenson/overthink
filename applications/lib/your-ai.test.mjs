// The shared "Your AI" facts: which records are the AI's, and how its work connects across apps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStory, hrefFor, idsIn, readMarks, readTrace, recordWords } from "./your-ai.js";

const TRACE = [
  { seq: 1, kind: "activity", action: "send_message", ok: true, result: { contact_id: "CT-00012" } },
  { seq: 2, kind: "tool", via: "http", actor: { token: "tok_1", session: "screen" }, tool: "list_orders", ok: true },
  { seq: 3, kind: "tool", via: "overthink", actor: { role: "assistant", session: "CT-00012" }, tool: "get_order", ok: true, input: { order_number: "ORD-10442" } },
  { seq: 4, kind: "tool", via: "overthink", actor: { role: "assistant", session: "CT-00012" }, tool: "refund_order", ok: true, input: { order_number: "ORD-10442" },
    changes: ["order ORD-10442 refunded", "ledger LED-000004 refund £12.00 on ORD-10442"] },
  { seq: 5, kind: "reply", via: "deployed product", actor: { session: "CT-00012" }, contact_id: "CT-00012", reply: "Done, refunded." },
  { seq: 6, kind: "tool", via: "http", actor: { token: "tok_1", session: "default" }, tool: "add_case_note", ok: true, changes: ["case CASE-1 note added"] },
  { seq: 7, kind: "activity", action: "leave_review", ok: true, result: { id: "REV-0031", order: "ORD-10442" } },
];

test("idsIn finds record ids anywhere in a value", () => {
  assert.deepEqual(idsIn(["ledger LED-000004 refund on ORD-10442", { a: "CT-1" }]).sort(), ["CT-1", "LED-000004", "ORD-10442"]);
});

test("readTrace keeps the AI and the world, and leaves out this browser and its screens", () => {
  const acts = readTrace(TRACE, { owner: "tok_1" });
  assert.deepEqual(acts.map((a) => a.seq), [1, 3, 4, 5, 6, 7]);
  assert.deepEqual(acts.filter((a) => a.ai).map((a) => a.seq), [3, 4, 5]);
  assert.equal(acts.find((a) => a.seq === 4).what, "Gave a refund");
});

test("only what the AI changed is marked; reads and the person at the computer are not", () => {
  const s = createStory();
  s.add(readTrace(TRACE, { owner: "tok_1" }));
  assert.equal(s.isMarked("ORD-10442"), true);
  assert.equal(s.isMarked("LED-000004"), true);
  assert.equal(s.isMarked("CT-00012"), true);
  assert.equal(s.isMarked("CASE-1"), false);
  assert.equal(s.isMarked("REV-0031"), false);
});

test("a record's story connects the conversation that caused it, what else changed, and what came after", () => {
  const s = createStory();
  s.add(readTrace(TRACE, { owner: "tok_1" }));
  const st = s.of("ORD-10442");
  assert.equal(st.cause, "CT-00012");
  assert.deepEqual(st.thread.map((a) => a.seq), [3, 4, 5]);
  assert.ok(st.related.includes("LED-000004"));
  assert.deepEqual(st.after.map((a) => a.seq), [7]);
  assert.equal(s.of("CASE-1"), null);
  // From the ledger line back to the same story.
  assert.equal(s.of("LED-000004").cause, "CT-00012");
});

test("a finished run's marks read as the same story", () => {
  const s = createStory();
  s.add(readMarks([{ id: "ORD-1", kind: "action", app: "till", session: "CT-5", seq: 9, tool: "refund_order", what: "Gave a refund" },
    { id: "CT-5", kind: "conversation", app: "front-desk", session: "CT-5", what: "Answered" }]));
  assert.equal(s.isMarked("ORD-1"), true);
  assert.equal(s.of("ORD-1").cause, "CT-5");
});

test("every record opens on its own app's page, and is said in words", () => {
  assert.equal(hrefFor("ORD-10442"), "/apps/till/#orders/ORD-10442");
  assert.equal(hrefFor("CT-00012"), "/apps/front-desk/?contact=CT-00012");
  assert.equal(hrefFor("PO-3"), "/apps/stockroom/#orders/PO-3");
  assert.equal(hrefFor("LED-000004"), "/apps/tally/#ledger");
  assert.equal(hrefFor("EV-0012"), "/apps/calendar/?event=EV-0012");
  assert.equal(hrefFor("DOC-3"), "/apps/files/?doc=DOC-3");
  assert.equal(hrefFor("ZZZ-1"), null);
  assert.equal(recordWords("ORD-10442"), "Order 10442");
  assert.equal(recordWords("LED-000004"), "A ledger line");
});
