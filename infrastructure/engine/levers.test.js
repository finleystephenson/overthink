// Tests for the levers extension (infrastructure/engine/levers.js). Run: node --test infrastructure/engine/levers.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveStaff, LIMITS } from "./levers.js";
import { freshWorld } from "../server/world-data.mjs";

const as = (world, role) => world.session({ role });

test("an untouched world has no settings, and the team is the plan, unchanged", () => {
  const w = freshWorld("demo");
  assert.equal(w.state.settings, undefined);
  const staff = w.plan.staff;
  assert.equal(effectiveStaff(staff, null), staff, "the very same list: the default path is the old one");
  const v = as(w, "manager").call("get_levers", {}).data;
  assert.equal(v.marketing_per_month, null);
  assert.equal(v.team.length, staff.length);
});

test("only a manager can pull the levers; internal staff can read them; customers cannot", () => {
  const w = freshWorld("demo");
  assert.equal(as(w, "support_agent").call("set_marketing_budget", { monthly: 100 }).error.code, "forbidden");
  assert.equal(as(w, "operations_assistant").call("set_staffing", { action: "remove", staff_id: "x" }).error.code, "forbidden");
  assert.equal(as(w, "assistant").call("get_levers", {}).error.code, "forbidden");
  assert.equal(as(w, "finance").call("get_levers", {}).ok, true);
});

test("marketing budget: set, checked against the limits, and reset to the plan", () => {
  const w = freshWorld("demo");
  const m = as(w, "manager");
  assert.equal(m.call("set_marketing_budget", { monthly: 3000.456 }).data.marketing_per_month, 3000.46);
  assert.equal(w.state.settings.marketing_per_month, 3000.46);
  for (const monthly of [-1, LIMITS.marketing_per_month[1] + 1]) assert.equal(m.call("set_marketing_budget", { monthly }).error.code, "invalid_input");
  assert.equal(m.call("set_marketing_budget", {}).error.code, "invalid_input");
  m.call("set_marketing_budget", { reset: true });
  assert.equal(w.state.settings.marketing_per_month, undefined);
  assert.ok(w.state.audit.at(-1).changes[0].includes("as planned"));
});

test("staffing: change hours, hire into an existing role, let someone go, within limits", () => {
  const w = freshWorld("demo");
  const m = as(w, "manager");
  const agent = w.plan.staff.find((s) => s.role === "support_agent");
  assert.equal(m.call("set_staffing", { action: "hours", staff_id: agent.id, weekly_hours: 35 }).ok, true);
  assert.equal(m.call("set_staffing", { action: "hours", staff_id: agent.id, weekly_hours: 60 }).error.code, "invalid_input");
  assert.equal(m.call("set_staffing", { action: "hours", staff_id: "nobody", weekly_hours: 10 }).error.code, "not_found");
  const hired = m.call("set_staffing", { action: "add", role: "warehouse", weekly_hours: 20, name: "Passepartout" });
  assert.equal(hired.ok, true);
  assert.equal(m.call("set_staffing", { action: "add", role: "astronaut", weekly_hours: 20 }).error.code, "invalid_input");
  assert.equal(m.call("set_staffing", { action: "remove", staff_id: w.plan.staff[1].id }).ok, true);
  const team = effectiveStaff(w.plan.staff, w.state.settings.staff);
  assert.equal(team.length, w.plan.staff.length);
  assert.equal(team.find((p) => p.id === agent.id).weekly_hours, 35);
  const p = team.find((x) => x.name === "Passepartout");
  assert.deepEqual([p.role, p.weekly_hours, p.hired], ["warehouse", 20, true]);
  assert.deepEqual(p.tasks, w.plan.staff.find((s) => s.role === "warehouse").tasks, "a hire works like the others in the role");
  // A world with no team attached refuses staffing changes clearly.
  const bare = freshWorld("demo");
  bare.plan = null;
  assert.equal(as(bare, "manager").call("set_staffing", { action: "remove", staff_id: "x" }).error.code, "not_found");
});

test("get_levers shows the support cover set by set_support_cover", () => {
  const world = freshWorld("demo");
  const boss = as(world, "manager");
  assert.equal(boss.call("get_levers", {}).data.support, null);
  assert.equal(boss.call("set_support_cover", { channels: ["email", "web_chat"], staff_after_minutes: 120 }).ok, true);
  assert.deepEqual(boss.call("get_levers", {}).data.support, { channels: ["email", "web_chat"], staff_after_minutes: 120 });
  boss.call("set_support_cover", { channels: [] });
  assert.equal(boss.call("get_levers", {}).data.support, null);
});
