// Watching at any speed: the rate, the switch between normal and calm (with its thresholds and hold), grouping and
// counting, playback speeds, the timeline, and turning the sandbox's record of calls into events.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WATCH, actionOf, createGroups, createModeSwitch, createPlayback, createRate, createTimeline, embedded, fromTrace,
  isWatched, recordHref, threadOf,
} from "./watch.js";

const ev = (over = {}) => ({ type: "product.acted", arm: "with", app: "till", session: "CT-1", record: "ORD-1", at: "2026-11-23T10:00:00.000Z", data: { tool: "refund_order", ok: true }, ...over });

test("the rate counts events a second over its window, and forgets old ones", () => {
  const r = createRate(4000);
  for (let i = 0; i < 400; i++) r.add(1000 + i * 5);  // 400 events in 2 seconds
  assert.equal(r.rate(3000), 100);
  assert.equal(r.rate(9000), 0);
});

test("one event a second or more switches to calm at once", () => {
  const m = createModeSwitch({ enterRate: 1, exitRate: 0.4, holdMs: 6000 });
  assert.equal(m.update(0.5, 0), "normal");
  assert.equal(m.update(0.99, 100), "normal");
  assert.equal(m.update(1, 200), "calm");
});

test("calm holds until the rate stays low for the hold time (no flicker)", () => {
  const m = createModeSwitch({ enterRate: 1, exitRate: 0.4, holdMs: 6000 });
  m.update(500, 0);
  assert.equal(m.update(0.2, 1000), "calm");
  assert.equal(m.update(0.8, 3000), "calm");   // between the thresholds: still calm, and the quiet clock restarts
  assert.equal(m.update(0.1, 4000), "calm");
  assert.equal(m.update(0.1, 9999), "calm");
  assert.equal(m.update(0.1, 10000), "normal");
});

test("a burst with short pauses never flips back to normal", () => {
  const m = createModeSwitch();
  const r = createRate();
  const seen = new Set();
  let t = 0;
  for (let s = 0; s < 20; s++) {
    for (let i = 0; i < 2000; i++) r.add(t + i * 0.5);  // a thousand a second for a second
    t += 1000;
    seen.add(m.update(r.rate(t), t));
    t += 2000;                                        // then two quiet seconds
    seen.add(m.update(r.rate(t), t));
  }
  assert.deepEqual([...seen], ["calm"]);
});

test("the defaults are a person's pace", () => {
  assert.equal(WATCH.enterRate, 1);
  assert.ok(WATCH.exitRate < WATCH.enterRate);
});

test("events group by app and action with running counts, busiest first", () => {
  const g = createGroups();
  for (let i = 0; i < 5; i++) g.add(ev());
  for (let i = 0; i < 3; i++) g.add(ev({ type: "product.replied", app: "letterbox", data: {} }));
  g.add(ev({ type: "contact.raised", app: "letterbox", data: {} }));
  g.add(ev({ type: "product.read", data: { tool: "get_order" } }));
  assert.equal(g.total, 10);
  assert.deepEqual(g.apps().map((a) => [a.app, a.count, a.ai]), [["till", 6, 6], ["letterbox", 4, 3]]);
  assert.deepEqual(g.actions("till").map((a) => [a.action, a.count]), [["Gave refunds", 5], ["Looked things up", 1]]);
  assert.equal(g.actions("letterbox").find((a) => a.action === "Wrote in").who, "people");
});

test("actionOf says refused calls, unknown tools and people plainly", () => {
  assert.equal(actionOf(ev({ data: { tool: "refund_order", refused: true } })), "Was stopped");
  assert.equal(actionOf(ev({ data: { tool: "rename_widget" } })), "Rename widget");
  assert.equal(actionOf({ type: "person.reacted", data: { kind: "panel" } }), "Reacted to posts");
});

test("only the AI's arm and the event types that matter are watched", () => {
  assert.equal(isWatched(ev()), true);
  assert.equal(isWatched(ev({ arm: "without" })), false);
  assert.equal(isWatched(ev({ type: "day.ended" })), false);
  assert.equal(threadOf(ev()), "CT-1");
  assert.equal(threadOf(ev({ session: null })), "ORD-1");
});

test("playback: live shows the newest, slow drips one at a time, paused holds them", () => {
  const p = createPlayback({ slowMs: 500, backlog: 100, live: 5 });
  for (let i = 0; i < 20; i++) p.push({ i });
  assert.deepEqual(p.take(0).show.map((e) => e.i), [15, 16, 17, 18, 19]);
  p.setSpeed("slow");
  for (let i = 0; i < 3; i++) p.push({ i });
  assert.deepEqual(p.take(1000).show.map((e) => e.i), [0]);
  assert.equal(p.take(1200).show.length, 0);  // not yet
  assert.deepEqual(p.take(1500).show.map((e) => e.i), [1]);
  p.setSpeed("paused");
  for (let i = 0; i < 300; i++) p.push({ i });
  const held = p.take(5000);
  assert.equal(held.show.length, 0);
  assert.equal(held.waiting, 100);             // capped
  assert.ok(held.dropped > 0);
  p.setSpeed("live");
  assert.equal(p.take(6000).show.length, 5);   // back to now, not a flood
});

test("the timeline finds moments by time and keeps its newest events", () => {
  const tl = createTimeline({ cap: 1000 });
  for (let i = 0; i < 1500; i++) tl.push(ev({ at: new Date(Date.UTC(2026, 10, 23, 10, 0, 0, i * 10)).toISOString(), seq: i }));
  assert.ok(tl.size <= 1100);
  assert.ok(tl.dropped >= 400);
  const r = tl.range();
  const mid = tl.indexAt((r.from + r.to) / 2);
  assert.ok(mid > tl.size * 0.4 && mid < tl.size * 0.6);
  assert.equal(tl.indexAt(0), 0);
  assert.equal(tl.bins(10).reduce((a, b) => a + b, 0), tl.size);
  assert.equal(tl.find("x").length, 0);
});

test("the sandbox's record becomes events: the AI, never this browser or its screens", () => {
  const owner = "tok_1";
  assert.equal(fromTrace({ seq: 1, kind: "tool", via: "http", actor: { token: owner, session: "screen" }, tool: "list_orders" }, { owner }), null);
  assert.equal(fromTrace({ seq: 2, kind: "tool", via: "http", actor: { token: owner, session: "default" }, tool: "refund_order", ok: true }, { owner }), null);
  const product = fromTrace({ seq: 3, kind: "tool", via: "overthink", actor: { role: "assistant", session: "CT-00012" }, tool: "refund_order", ok: true, changes: ["ledger LED-000004 refund £12.00 on ORD-10442"], input: { order_number: "ORD-10442" } }, { owner });
  assert.equal(product.type, "product.acted");
  assert.equal(product.app, "till");
  assert.equal(product.session, "CT-00012");
  const keyed = fromTrace({ seq: 4, kind: "tool", via: "http", actor: { token: "tok_2", session: "x" }, tool: "get_order", ok: true }, { owner });
  assert.equal(keyed.type, "product.read");
  const reply = fromTrace({ seq: 5, kind: "reply", via: "deployed product", actor: { session: "CT-9" }, channel: "email", reply: "Hello" }, { owner });
  assert.equal(reply.type, "product.replied");
  assert.equal(reply.app, "letterbox");
  const person = fromTrace({ seq: 6, kind: "activity", action: "send_email", ok: true, result: { id: "EM-000777" } }, { owner });
  assert.equal(person.type, "activity");
  assert.equal(person.app, "letterbox");
  assert.equal(fromTrace({ seq: 7, kind: "advance" }, { owner }), null);
});

test("records open on the right page of the right app, embedded", () => {
  assert.equal(recordHref(ev({ record: "ORD-10442" })), "/apps/till/#orders/ORD-10442");
  assert.equal(recordHref(ev({ record: "CASE-9", app: "front-desk" })), "/apps/front-desk/?case=CASE-9");
  assert.equal(recordHref(ev({ link: "/apps/letterbox/?thread=TH-1" })), "/apps/letterbox/?thread=TH-1");
  assert.equal(recordHref(ev({ app: null, record: null })), null);
  assert.equal(embedded("/apps/till/#orders/ORD-1"), "/apps/till/?embed=1#orders/ORD-1");
  assert.equal(embedded("/apps/front-desk/?case=CASE-9"), "/apps/front-desk/?case=CASE-9&embed=1");
  assert.equal(embedded("/apps/x/?embed=1"), "/apps/x/?embed=1");
});
