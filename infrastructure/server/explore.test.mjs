// Tests for the explorer's reads (infrastructure/server/explore.mjs): the graph adds up, search finds people and products, every
// link on a page opens, time moving gives real pulses, and the world lens never reaches the tool API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SandboxStore } from "./sandboxes.mjs";
import { createApp } from "./http.mjs";
import { worldGraph, searchWorld, dossier, timeline, pulses, compareWorlds, startingPoints } from "./explore.mjs";

const store = new SandboxStore({ plugins: [] });
const { sandbox: sb, token } = store.create({ size: "demo" });
const st = sb.world.state;

test("the graph's counts match the state", () => {
  const g = worldGraph(sb.world);
  const ring = (id) => g.rings.find((r) => r.id === id);
  assert.equal(ring("team").nodes.length, sb.world.plan.staff.length);
  assert.equal(ring("customers").nodes.reduce((n, c) => n + c.count, 0), st.customers.length, "every customer is in exactly one community");
  const orderLinks = g.links.filter((l) => l.from.kind === "company" && l.to.kind === "community").reduce((n, l) => n + l.count, 0);
  const known = new Set(st.customers.map((c) => c.id));
  assert.equal(orderLinks, st.orders.filter((o) => known.has(o.customer_id)).length, "order links add up to the orders");
  assert.equal(ring("suppliers").nodes.filter((n) => n.kind === "supplier").length, st.suppliers.length);
  assert.equal(g.totals.orders, st.orders.length);
  assert.ok(ring("competitors").nodes.length > 0 && ring("forces").nodes.length === 4);
});

test("search finds a known character, a product and an order", () => {
  const someone = st.customers.find((c) => /^[A-Z][a-z]+$/.test(c.name)) || st.customers[0];
  const hits = searchWorld(sb.world, someone.name);
  assert.ok(hits.some((h) => h.kind === "person" && h.id === someone.id), `found ${someone.name}`);
  assert.equal(searchWorld(sb.world, "biscuit")[0].id, "biscuit-tin");
  const o = st.orders.at(-1);
  assert.equal(searchWorld(sb.world, o.number.slice(4))[0].id, o.number);
  assert.deepEqual(searchWorld(sb.world, ""), []);
});

test("every link on a page opens another page", () => {
  const o = st.orders.find((x) => (x.shipments || []).length) || st.orders.at(-1);
  const pages = [["company", "overthought"], ["person", o.customer_id], ["order", o.number], ["product", "biscuit-tin"], ["org", "thriftwhistle"], ["supplier", st.suppliers[0].id], ["force", "news"]];
  const opened = new Set();
  for (const [kind, id] of pages) {
    const d = dossier(sb.world, kind, id, { trace: sb.trace });
    assert.ok(d.title && d.sentence, `${kind} ${id} has a title and a sentence`);
    const links = [...d.connections.flatMap((g) => g.items), ...(d.chain || []).flatMap((s) => s.links || []), ...d.history.filter((h) => h.kind)];
    for (const l of links) {
      if (["app", "ring", "action"].includes(l.kind) || opened.has(`${l.kind}:${l.id}`)) continue;
      opened.add(`${l.kind}:${l.id}`);
      assert.doesNotThrow(() => dossier(sb.world, l.kind, l.id), `${kind} ${id} links to ${l.kind} ${l.id}`);
    }
  }
  assert.ok(opened.size > 10);
  // People show both lenses; no codes in what a person reads.
  const p = dossier(sb.world, "person", o.customer_id);
  assert.ok(p.lenses.business.rows.length && p.lenses.world.rows.length);
  assert.doesNotMatch(JSON.stringify([p.title, p.sentence, p.lenses, dossier(sb.world, "order", o.number).chain.map((s) => s.text)]), /\b(ORD|CT|EM|LED|MV|SHP)-\d/);
});

test("timeline, starting points and a missing page", () => {
  const t = timeline(sb.world, { from: "2025-01-01", to: st.now });
  assert.ok(t.items.length > 0);
  assert.ok(t.items.every((x, i) => i === 0 || t.items[i - 1].at <= x.at), "in time order");
  assert.ok(startingPoints(sb.world).length >= 2);
  assert.throws(() => dossier(sb.world, "order", "ORD-1"), /not in this world/);
  assert.throws(() => timeline(sb.world, { from: "2026-12-01", to: "2026-01-01" }), /from before to/);
});

test("time moving gives real pulses and a comparison with the world left alone", async () => {
  const before = st.now;
  assert.equal(compareWorlds(sb).started, false);
  await store.advance(sb, sb.tokens[0], 2);
  const ps = pulses(sb.world, before);
  assert.ok(ps.length > 0, "something happened in two days");
  assert.ok(ps.every((p) => p.at > before && p.from && p.to && p.text));
  const c = compareWorlds(sb);
  assert.equal(c.started, true);
  assert.equal(c.people_affected, 0, "nothing was done, so nobody differs from the world left alone");
});

test("the world lens stays out of the tool API, and role keys cannot read the explorer", async () => {
  const server = createApp({ store }).listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const role = store.mintRoleToken(sb, { role: "support_agent" }).token;
    const c = st.customers.find((x) => st.orders.some((o) => o.customer_id === x.id));
    const r = await fetch(`${base}/tools/get_customer`, { method: "POST", headers: { Authorization: `Bearer ${role}`, "Content-Type": "application/json" }, body: JSON.stringify({ customer_id: c.id }) }).then((x) => x.json());
    const text = JSON.stringify(r);
    for (const field of ["income", "circumstances", "household", "employment", "ties"]) assert.ok(!text.includes(`"${field}"`), `get_customer does not show ${field}`);
    for (const as of ["support_agent", "assistant", "manager"]) {
      const k = store.mintRoleToken(sb, { role: as }).token;
      const tools = (await fetch(`${base}/tools`, { headers: { Authorization: `Bearer ${k}` } }).then((x) => x.json())).data.tools.map((t) => t.name);
      assert.ok(!tools.includes("get_person") && !tools.includes("list_people"), `${as} has no world-lens tools`);
    }
    const asRole = await fetch(`${base}/sandboxes/${sb.id}/explore/entity/person/${c.id}`, { headers: { Authorization: `Bearer ${role}` } });
    assert.equal(asRole.status, 403, "a role key cannot read the explorer");
    const asOwner = await fetch(`${base}/sandboxes/${sb.id}/explore/entity/person/${c.id}`, { headers: { Authorization: `Bearer ${token}` } }).then((x) => x.json());
    assert.ok(asOwner.data.lenses.world.rows.length, "the owner (the person at the explorer) sees the world lens");
    assert.equal((await fetch(`${base}/apps/explore/`)).status, 200, "the explorer's pages are served");
  } finally {
    server.close();
  }
});
