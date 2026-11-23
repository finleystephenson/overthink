// Generator tests. Run: node --test business/builder/world/world.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorld, SIZES } from "../build-world.mjs";
import { planted } from "./stories.mjs";
import { PAYMENT_FAIL_RATE, LATE_RATE, RETURN_RATE, RETURN_REASONS } from "./simulate.mjs";
import { CONTACT_RATE } from "./aftersales.mjs";
import { SIM_DEMAND } from "./calendar.mjs";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
// WHY: rates are checked without events (events move lateness and contacts on purpose) and without mail and chat (speed).
const quiet = buildWorld({ size: "standard", seed: 1, events: false, comms: false }).world;
const standard = buildWorld({ size: "standard", seed: 1, comms: false }).world;
const near = (actual, target, tolerance, what) => assert.ok(Math.abs(actual - target) <= tolerance, `${what}: ${actual.toFixed(4)} not within ${tolerance} of ${target}`);
const staffNames = JSON.parse(fs.readFileSync(path.join(ROOT, "business/data/staff.json"), "utf8")).staff.map((p) => p.name);

test("same seed gives an identical world; another seed gives a different one", () => {
  const a = JSON.stringify(buildWorld({ size: "demo", seed: 1 }));
  assert.equal(JSON.stringify(buildWorld({ size: "demo", seed: 1 })), a);
  assert.notEqual(JSON.stringify(buildWorld({ size: "demo", seed: 2 })), a);
});

test("one scale for history and simulator: the last weeks of history match business/data/sim.json at the world's scale", () => {
  for (const [w, size] of [[standard, "standard"], [buildWorld({ size: "demo", comms: false }).world, "demo"]]) {
    assert.equal(w.company.scale, SIZES[size]);
    assert.equal(w.company.orders_per_day_now, Math.round(SIM_DEMAND.base_orders_per_day * SIZES[size] * 100) / 100);
    assert.equal(w.company.staffing_now.length, 11, "the whole team is in place by now");
  }
  const larger = buildWorld({ size: "standard", scale: 0.4, events: false, comms: false }).world;
  assert.ok(larger.orders.length > quiet.orders.length * 1.7, "orders grow with scale");
});

test("rates land near their constants (standard world, no events)", () => {
  const generated = quiet.orders;
  near(generated.filter((o) => o.payment.status === "declined").length / generated.length, PAYMENT_FAIL_RATE, 0.01, "payment failures");
  const ships = generated.flatMap((o) => o.shipments).filter((s) => s.status === "delivered");
  near(ships.filter((s) => s.note?.includes("after the estimated")).length / ships.length, LATE_RATE, 0.015, "late parcels");
  const returnable = generated.filter((o) => o.status === "delivered" && o.items.some((i) => !/^OT-(SAND|ICE|JUNG$|BISC)/.test(i.sku)));
  near(quiet.returns.length / returnable.length, 0.06, 0.02, "returns (about 6% overall)");
  assert.ok(quiet.returns.length / returnable.length >= RETURN_RATE - 0.01);
  const faulty = RETURN_REASONS.find(([r]) => r === "faulty")[1];
  near(quiet.returns.filter((r) => r.reason === "faulty").length / quiet.returns.length, faulty, 0.1, "faulty share of returns");
  const contacts = quiet.contacts.filter((c) => c.topic !== "presale");
  near(contacts.length / generated.length, CONTACT_RATE, 0.15, "contacts per order");
});

test("world events make parcels later and are reported in the news", () => {
  const lateShare = (w) => { const s = w.orders.flatMap((o) => o.shipments).filter((x) => x.status === "delivered"); return s.filter((x) => x.note?.includes("after the estimated")).length / s.length; };
  assert.ok(lateShare(standard) > lateShare(quiet), "event delays add late parcels");
  assert.ok(standard.world_events.length > 100);
  const ids = new Set(standard.world_events.map((e) => e.id));
  assert.ok(standard.news.length > 100 && standard.news.every((n) => ids.has(n.event)));
  assert.deepEqual(quiet.world_events, []);
});

test("money adds up the simulator's way: early losses, a modest profit by now", () => {
  const byYear = {};
  for (const m of standard.monthly_summary) { const y = m.month.slice(0, 4); byYear[y] ||= { revenue: 0, profit: 0 }; byYear[y].revenue += m.revenue; byYear[y].profit += m.profit; }
  assert.ok(byYear[2022].profit < 0);
  for (const y of [2025, 2026]) assert.ok(byYear[y].profit > 0 && byYear[y].profit < byYear[y].revenue * 0.2, `${y} profit ${byYear[y].profit}`);
  assert.ok(byYear[2026].revenue > byYear[2023].revenue);
  assert.ok(standard.monthly_summary.every((m) => m.cash_at_month_end > 0), "the founder's money covers the early losses");
});

test("the default world is ordinary: no stories, no staff as customers, numbers in date order", () => {
  for (const w of [standard, buildWorld({ size: "demo", comms: false }).world]) {
    assert.equal(w.company.stories, false);
    assert.ok(!w.orders.some((o) => planted.orders.some((p) => p.number === o.number && p.customer_id === o.customer_id)));
    assert.ok(!w.contacts.some((c) => c.topic === "story"));
    assert.ok(!w.customers.some((c) => staffNames.includes(c.name)));
    assert.ok(!JSON.stringify(w.orders).includes("Test card"));
    const fix = w.repairs.map((r) => r.created_at);
    assert.deepEqual(fix, [...fix].sort());
  }
});

test("with --stories the planted stories are laid over every size with their fixed numbers", () => {
  for (const size of ["standard", "demo"]) {
    const w = buildWorld({ size, stories: true, comms: false }).world;
    for (const o of planted.orders) assert.deepEqual(w.orders.find((x) => x.number === o.number), o);
    assert.deepEqual(w.stock["OT-TROF"], { on_hand: 0, restock_date: "2026-12-07" });
    assert.equal(w.stock["OT-BLIP"].on_hand, 0);
    assert.equal(w.bookings.length, 0);
    assert.equal(w.ledger.filter((e) => e.reference === planted.doubleRefund && e.type === "refund").length, 2);
  }
});

test("the validator passes on freshly built demo worlds, with and without stories", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "overthought-world-"));
  try {
    for (const [name, extra] of [["plain", []], ["stories", ["--stories"]]]) {
      const out = path.join(dir, name);
      const built = spawnSync(process.execPath, ["business/builder/build-world.mjs", "--size", "demo", "--out", out, ...extra], { cwd: ROOT, encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr);
      const r = spawnSync(process.execPath, ["business/builder/validate.mjs", "--size", "demo", "--dir", out], { cwd: ROOT, encoding: "utf8" });
      assert.equal(r.status, 0, r.stdout.slice(-2000));
      if (name === "stories") assert.match(r.stdout, /RET-3006: refunded 22.1 in the ledger/);
      else assert.ok(!fs.existsSync(path.join(out, "STORIES.md")));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the month still running has its wages to date, so its profit is honest", () => {
  const last = standard.monthly_summary.at(-1);
  assert.equal(last.month, "2026-11");
  const full = standard.company.staffing_by_month.at(-1).wages;
  const share = (Date.parse("2026-11-23T10:00:00Z") - Date.parse("2026-11-01")) / (30 * 864e5);
  assert.ok(Math.abs(last.operating_costs.wages - full * share) < 1, `wages ${last.operating_costs.wages} against ${full} x ${share.toFixed(3)}`);
});

test("no world event is about a product before that product is on sale", () => {
  const tin = standard.world_events.filter((e) => e.template === "rs-gift-guide-tin");
  assert.ok(tin.every((e) => e.start >= "2026-09-07"), tin.map((e) => e.start).join(", "));
});
