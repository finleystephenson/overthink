// Run: node --test infrastructure/engine/events.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createWorld } from "./all.js";
import { loadData } from "./load.ts";
import { eventsPlugin } from "./events.js";
import { scheduleEvents, activeEffects, newsFor, rampFactor, statusOn, describeEffects, checkEffects, instantiate, needsUnlaunchedProduct } from "./events-core.js";
import { buildEventHistory } from "../../business/builder/world/events.mjs";

const DATA = fileURLToPath(new URL("../../business/data", import.meta.url));
const library = JSON.parse(readFileSync(`${DATA}/events/library.json`, "utf8"));
const characters = JSON.parse(readFileSync(`${DATA}/characters.json`, "utf8"));
const NOW = "2026-11-23T10:00:00Z";

const newWorld = () => createWorld({ ...loadData(DATA), now: NOW });
const keys = (list) => list.map((o) => o.key);
const byTemplate = (list, id) => list.filter((o) => o.template === id);

// A tiny hand-made occurrence, so the combining rules can be tested without the library.
const occ = (over) => ({ id: "WE-1", template: "t", status: "active", start: "2026-07-01", end: "2026-07-01", ramp: "flat", effects: {}, ...over });

// ------------------------------------------------------------ library

test("the library has at least 120 events: 28+ calendar, real-style, and 60+ storybook", () => {
  const n = (f) => library.events.filter((e) => e.family === f).length;
  assert.ok(library.events.length >= 120);
  assert.ok(n("calendar") >= 12 && n("real-style") >= 20 && n("storybook") >= 60);
});

test("every product id, category and town in the library exists, and every number has a why", () => {
  const data = loadData(DATA);
  const productIds = new Set(data.products.map((p) => p.id));
  const categories = new Set(data.products.map((p) => p.category));
  const towns = new Set(characters.map((c) => c.town));
  for (const e of library.events) {
    for (const p of Object.keys(e.effects.demand?.products || {})) assert.ok(productIds.has(p), `${e.id}: product ${p}`);
    for (const c of Object.keys(e.effects.demand?.categories || {})) assert.ok(categories.has(c), `${e.id}: category ${c}`);
    for (const t of e.region?.towns || []) assert.ok(towns.has(t), `${e.id}: town ${t}`);
    assert.equal(checkEffects(e.effects, { productIds: [...productIds], categories: [...categories] }), null, e.id);
    assert.equal(e.chatter.length >= 2 && e.chatter.length <= 3, true, `${e.id}: chatter`);
    assert.ok(e.headline && e.story && e.source && e.tags.length, e.id);
    const paths = [];
    const walk = (o, prefix) => { for (const [k, v] of Object.entries(o)) typeof v === "number" ? paths.push(prefix + k) : walk(v, prefix + k + "."); };
    walk(e.effects, "");
    for (const p of paths) assert.ok(e.why[p], `${e.id}: no why for ${p}`);
  }
});

test("storybook events name an out-of-copyright source; real-style names no real company", () => {
  for (const e of library.events.filter((x) => x.family === "storybook")) assert.ok(e.source.length > 8, e.id);
  const banned = /\b(royal mail|amazon|dhl|fedex|evri|tesco|paypal|visa|mastercard|google|facebook|disney)\b/i;
  for (const e of library.events) assert.ok(!banned.test(`${e.title} ${e.headline} ${e.story}`), `${e.id} names a real company`);
});

// ------------------------------------------------------------ scheduling

test("the same seed gives the same schedule; a different seed gives a different one", () => {
  const window = { from: "2024-01-01", to: "2025-12-31" };
  const a = scheduleEvents(library, { seed: "s1", ...window });
  const b = scheduleEvents(library, { seed: "s1", ...window });
  const c = scheduleEvents(library, { seed: "s2", ...window });
  assert.deepEqual(a, b);
  assert.notDeepEqual(keys(a), keys(c));
});

test("adding a template leaves every other event's dates and effects unchanged", () => {
  const window = { from: "2023-01-01", to: "2025-12-31" };
  const before = scheduleEvents(library, { seed: "s1", ...window });
  const extra = {
    id: "test-extra", family: "real-style", title: "Extra", headline: "Extra", story: "One. Two. Three.", source: "invented",
    rate_per_year: 3, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], duration_days: [2, 5], ramp: "flat", effects: { visits: 1.1 },
  };
  const after = scheduleEvents({ events: [...library.events, extra] }, { seed: "s1", ...window });
  assert.ok(byTemplate(after, "test-extra").length > 0);
  assert.deepEqual(after.filter((o) => o.template !== "test-extra"), before);
});

test("a window is a slice of the same schedule", () => {
  const wide = scheduleEvents(library, { seed: "s1", from: "2024-01-01", to: "2024-12-31" });
  const narrow = scheduleEvents(library, { seed: "s1", from: "2024-06-01", to: "2024-06-30" });
  for (const o of narrow) assert.ok(wide.some((w) => w.key === o.key), o.key);
});

test("fixed-date events land on the right day every year, including Easter-based ones", () => {
  const list = scheduleEvents(library, { seed: "s1", from: "2022-01-01", to: "2027-12-31" });
  for (const year of [2022, 2023, 2024, 2025, 2026, 2027]) {
    assert.equal(byTemplate(list, "cal-valentines").filter((o) => o.start === `${year}-02-01`).length, 1, `valentines ${year}`);
    assert.equal(byTemplate(list, "cal-christmas-run-up").filter((o) => o.start === `${year}-12-01`).length, 1, `christmas ${year}`);
  }
  // Easter Sunday 2026 is 5 April: Easter weekend starts on Good Friday the 3rd; Mother's Day (15 March) run-up starts the 5th.
  assert.ok(byTemplate(list, "cal-easter").some((o) => o.start === "2026-04-03" && o.end === "2026-04-06"));
  assert.ok(byTemplate(list, "cal-mothers-day").some((o) => o.start === "2026-03-05" && o.end === "2026-03-15"));
  // Black Friday 2025 is 28 November, so the week runs Monday the 24th to Monday the 1st.
  assert.ok(byTemplate(list, "cal-black-friday-week").some((o) => o.start === "2025-11-24" && o.end === "2025-12-01"));
  // Father's Day 2026 is 21 June.
  assert.ok(byTemplate(list, "cal-fathers-day").some((o) => o.end === "2026-06-21"));
});

test("events in one group never overlap (two postal strikes cannot happen at once)", () => {
  const list = scheduleEvents(library, { seed: "s1", from: "2021-11-22", to: "2031-11-22" });
  const grouped = list.filter((o) => o.group);
  for (let i = 0; i < grouped.length; i++) {
    for (let j = i + 1; j < grouped.length; j++) {
      if (grouped[i].group !== grouped[j].group) continue;
      assert.ok(grouped[i].end < grouped[j].start || grouped[j].end < grouped[i].start, `${grouped[i].key} overlaps ${grouped[j].key}`);
    }
  }
});

test("random events stay in their allowed months and durations", () => {
  const list = scheduleEvents(library, { seed: "s3", from: "2024-01-01", to: "2026-12-31" });
  for (const o of list) {
    const tpl = library.events.find((t) => t.id === o.template);
    if (!tpl.months) continue;
    if (o.start < "2024-01-01") continue;
    assert.ok(tpl.months.includes(Number(o.start.slice(5, 7))), `${o.key} month`);
    const length = (Date.parse(o.end) - Date.parse(o.start)) / 86400000 + 1;
    assert.ok(length >= tpl.duration_days[0] && length <= tpl.duration_days[1], `${o.key} length`);
  }
});

// ------------------------------------------------------------ effects

test("active events multiply together; delay days add", () => {
  const list = [
    occ({ id: "a", effects: { demand: { all: 1.2, products: { "indoor-helmet": 2 } }, visits: 1.5, carrier_delay_days: 2, costs: { carrier: 1.1 } } }),
    occ({ id: "b", effects: { demand: { all: 0.5, products: { "indoor-helmet": 1.5 }, categories: { food: 0.8 } }, visits: 2, carrier_delay_days: 1, costs: { carrier: 1.1 } } }),
    occ({ id: "c", start: "2026-08-01", end: "2026-08-01", effects: { visits: 9 } }),
  ];
  const m = activeEffects(list, "2026-07-01");
  assert.equal(m.demand.all, 0.6);
  assert.equal(m.demand.products["indoor-helmet"], 3);
  assert.equal(m.demand.categories.food, 0.8);
  assert.equal(m.visits, 3);
  assert.equal(m.carrier_delay_days, 3);
  assert.equal(m.costs.carrier, 1.21);
  assert.equal(m.supplier_late_chance, 1);
  assert.deepEqual(activeEffects(list, "2026-09-01"), activeEffects([], "2026-09-01"));
});

test("a regional event with a reach moves demand a little everywhere, in full inside its region", () => {
  const tpl = library.events.find((e) => e.id === "sb-wolf-pigs");
  const wolf = { ...instantiate(tpl, "2026-07-01", 1), id: "WE-1", status: "active" };
  assert.equal(wolf.reach, tpl.reach);
  const inLane = activeEffects([wolf], "2026-07-01", { town: tpl.region.towns[0] });
  const elsewhere = activeEffects([wolf], "2026-07-01", { town: "Verona" });
  const whole = activeEffects([wolf], "2026-07-01");
  const helmet = tpl.effects.demand.products["indoor-helmet"];
  assert.equal(inLane.demand.products["indoor-helmet"], helmet);
  assert.equal(elsewhere.demand.products["indoor-helmet"], Math.round((1 + (helmet - 1) * tpl.reach) * 1000) / 1000);
  assert.equal(elsewhere.carrier_delay_days, 0, "only demand reaches outside the region");
  assert.ok(whole.demand.products["indoor-helmet"] > elsewhere.demand.products["indoor-helmet"] && whole.demand.products["indoor-helmet"] < helmet);
  // The live plug-in asks for the whole business, so it sees the reach too.
  const plain = activeEffects([{ ...wolf, reach: undefined }], "2026-07-01");
  assert.ok(whole.demand.products["indoor-helmet"] > plain.demand.products["indoor-helmet"]);
});

test("nothing happens about a product before it is on sale", () => {
  const products = [{ id: "biscuit-tin", name: "The Biscuit Tin", launched: "2026-09-07" }, { id: "spare-sock", name: "The Spare Sock", launched: "2021-11-22" }];
  const tin = library.events.find((e) => e.id === "rs-gift-guide-tin");
  assert.equal(needsUnlaunchedProduct(instantiate(tin, "2024-10-01", 3), products), true);
  assert.equal(needsUnlaunchedProduct(instantiate(tin, "2026-10-01", 3), products), false);
  const valentines = library.events.find((e) => e.id === "cal-valentines");
  assert.equal(needsUnlaunchedProduct(instantiate(valentines, "2024-02-01", 14), products), false, "a broad event still happens");
  const all = scheduleEvents(library, { seed: 1, from: "2021-11-22", to: "2027-11-23", products });
  assert.ok(all.every((o) => o.template !== "rs-gift-guide-tin" || o.start >= "2026-09-07"));
});

test("a regional event acts in full in its region, not at all elsewhere, and in proportion with no place given", () => {
  const list = [occ({ region: { towns: ["Mother Goose Lane"] }, region_share: 0.1, effects: { demand: { products: { "indoor-helmet": 3 } }, carrier_delay_days: 2 } })];
  assert.equal(activeEffects(list, "2026-07-01", { town: "Mother Goose Lane" }).demand.products["indoor-helmet"], 3);
  assert.equal(activeEffects(list, "2026-07-01", { town: "Verona" }).demand.products["indoor-helmet"], undefined);
  const whole = activeEffects(list, "2026-07-01");
  assert.equal(whole.demand.products["indoor-helmet"], 1.2);
  assert.equal(whole.carrier_delay_days, 0.2);
  const byArea = [occ({ region: { areas: ["EL"] }, effects: { visits: 2 } })];
  assert.equal(activeEffects(byArea, "2026-07-01", { postcode: "EL3 7GE" }).visits, 2);
  assert.equal(activeEffects(byArea, "2026-07-01", { postcode: "VE1 1AA" }).visits, 1);
});

test("ramps build, peak, fade or stay flat", () => {
  const s = "2026-07-01", e = "2026-07-05";
  assert.equal(rampFactor("flat", s, e, "2026-07-03"), 1);
  assert.ok(rampFactor("build", s, e, s) < rampFactor("build", s, e, e));
  assert.equal(rampFactor("build", s, e, e), 1);
  assert.equal(rampFactor("fade", s, e, s), 1);
  assert.ok(rampFactor("fade", s, e, e) < 0.3);
  assert.equal(rampFactor("peak", s, e, "2026-07-03"), 1);
  assert.ok(rampFactor("peak", s, e, s) < 1 && rampFactor("peak", s, e, e) < 1);
  assert.equal(rampFactor("fade", s, s, s), 1);
  const ramped = [occ({ start: s, end: e, ramp: "build", effects: { visits: 2 } })];
  assert.ok(activeEffects(ramped, s).visits < activeEffects(ramped, e).visits);
  assert.equal(activeEffects(ramped, e).visits, 2);
});

test("cancelled events do nothing and make no news", () => {
  const list = [occ({ status: "cancelled", effects: { visits: 2 } })];
  assert.equal(activeEffects(list, "2026-07-01").visits, 1);
  assert.equal(newsFor(list, "2026-07-01").length, 0);
});

test("statuses follow the dates", () => {
  const o = occ({ start: "2026-07-01", end: "2026-07-03", status: "scheduled" });
  assert.equal(statusOn(o, "2026-06-30"), "scheduled");
  assert.equal(statusOn(o, "2026-07-03"), "active");
  assert.equal(statusOn(o, "2026-07-04"), "over");
  assert.equal(statusOn(o, "2026-07-03", { endOfDay: true }), "over");
  assert.match(describeEffects({ demand: { products: { "indoor-helmet": 3 } }, carrier_delay_days: 1 }).join("; "), /indoor helmet up 200%.*1 day late/);
});

// ------------------------------------------------------------ tools and roles

test("news is public; staff see world events; the future is the manager's", () => {
  const w = newWorld();
  w.state.world_events.push(occ({ id: "WE-00001", start: "2026-11-20", end: "2026-11-30", effects: { visits: 1.2 }, title: "Now" }));
  w.state.world_events.push(occ({ id: "WE-00002", start: "2026-12-20", end: "2026-12-25", status: "scheduled", effects: { visits: 1.2 }, title: "Later" }));
  w.state.news.push({ id: "NW-00001", at: "2026-11-20T07:00:00Z", headline: "H", story: "S", section: "Local", event: "WE-00001" });
  w.state.news.push({ id: "NW-00002", at: "2026-12-20T07:00:00Z", headline: "Future", story: "S", section: "Local", event: "WE-00002" });
  const customer = w.session({ role: "customer" });
  assert.equal(customer.call("list_news", {}).data.news.length, 1, "future news is not shown");
  assert.equal(customer.call("get_news_item", { id: "NW-00001" }).ok, true);
  assert.equal(customer.call("get_news_item", { id: "NW-00002" }).error.code, "not_found");
  assert.equal(customer.call("list_world_events", {}).error.code, "forbidden");
  const agent = w.session({ role: "support_agent" });
  const list = agent.call("list_world_events", {}).data.events;
  assert.deepEqual(list.map((e) => e.id), ["WE-00001"]);
  assert.ok(list[0].effects_in_words.length);
  assert.equal(agent.call("list_world_events", { status: "scheduled" }).error.code, "forbidden");
  assert.equal(agent.call("get_world_event", { id: "WE-00002" }).error.code, "forbidden");
  const manager = w.session({ role: "manager" });
  assert.equal(manager.call("list_world_events", { status: "scheduled" }).data.events[0].id, "WE-00002");
  assert.equal(manager.call("get_world_event", { id: "WE-00002" }).ok, true);
  assert.equal(agent.call("add_world_event", { template: "rs-heatwave" }).error.code, "forbidden");
  assert.equal(agent.call("edit_world_event", { id: "WE-00001", title: "x" }).error.code, "forbidden");
  assert.equal(agent.call("cancel_world_event", { id: "WE-00001" }).error.code, "forbidden");
  assert.equal(customer.call("list_news", { section: "Nowhere" }).data.news.length, 0);
});

test("a manager can add an event from the library; it is marked added, recorded and acts on the business", () => {
  const w = newWorld();
  const m = w.session({ role: "manager" });
  const r = m.call("add_world_event", { template: "sb-wolf-pigs" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.origin, "added");
  assert.equal(r.data.status, "active");
  assert.match(r.data.id, /^WE-\d{5}$/);
  assert.ok(r.data.news_id);
  const audit = w.state.audit.at(-1);
  assert.equal(audit.tool, "add_world_event");
  assert.ok(audit.changes.some((c) => c.includes(r.data.id)));
  const news = w.session({ role: "customer" }).call("list_news", {}).data.news;
  assert.match(news[0].headline, /Wolf/);
  const mod = eventsPlugin.modifiers({ state: w.state, date: "2026-11-23" });
  assert.ok(mod.demand.products["indoor-helmet"] > 1, "regional boost shows in the whole-business modifiers");
  assert.equal(activeEffects(w.state.world_events, "2026-11-29", { town: "Mother Goose Lane" }).demand.products["indoor-helmet"], 3);
});

test("a custom event needs a title, story and valid effects; the past and bad numbers are refused", () => {
  const w = newWorld();
  const m = w.session({ role: "manager" });
  assert.equal(m.call("add_world_event", { title: "Only a title" }).error.code, "invalid_input");
  assert.equal(m.call("add_world_event", { template: "no-such" }).error.code, "not_found");
  assert.equal(m.call("add_world_event", { template: "rs-heatwave", start: "2026-11-01" }).error.code, "rule_violation");
  const bad = { title: "T", story: "S", duration_days: 3 };
  assert.equal(m.call("add_world_event", { ...bad, effects: { demand: { products: { "made-up": 2 } } } }).error.code, "invalid_input");
  assert.equal(m.call("add_world_event", { ...bad, effects: { visits: 300 } }).error.code, "invalid_input");
  assert.equal(m.call("add_world_event", { ...bad, effects: { speed: 2 } }).error.code, "invalid_input");
  const ok = m.call("add_world_event", { ...bad, start: "2026-12-01", effects: { demand: { all: 1.5 } } });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.status, "scheduled");
  assert.equal(ok.data.end, "2026-12-03");
  assert.equal(ok.data.news_id, null, "news waits for the start date");
});

test("edit and cancel change the record, are logged, and refuse finished events", () => {
  const w = newWorld();
  const m = w.session({ role: "manager" });
  const id = m.call("add_world_event", { title: "Parade", story: "A parade.", start: "2026-12-01", duration_days: 5, effects: { visits: 1.3 } }).data.id;
  const edited = m.call("edit_world_event", { id, effects: { visits: 1.6 }, end: "2026-12-10", title: "Big parade" });
  assert.equal(edited.ok, true);
  assert.equal(edited.data.end, "2026-12-10");
  assert.equal(activeEffects(w.state.world_events, "2026-12-02").visits, 1.6);
  assert.ok(w.state.audit.at(-1).changes[0].includes("edited"));
  assert.equal(m.call("edit_world_event", { id }).error.code, "rule_violation", "nothing to change");
  const moved = m.call("edit_world_event", { id, start: "2026-12-05" });
  assert.equal(moved.data.start, "2026-12-05");
  const gone = m.call("cancel_world_event", { id, reason: "Rain" });
  assert.equal(gone.data.status, "cancelled");
  assert.ok(w.state.audit.at(-1).changes[0].includes("cancelled"));
  assert.equal(activeEffects(w.state.world_events, "2026-12-06").visits, 1);
  assert.equal(m.call("cancel_world_event", { id }).error.code, "rule_violation");
  assert.equal(m.call("edit_world_event", { id, title: "x" }).error.code, "rule_violation");
  assert.equal(m.call("edit_world_event", { id: "WE-99999", title: "x" }).error.code, "not_found");
  const active = m.call("add_world_event", { title: "Now", story: "Now.", duration_days: 4, effects: { visits: 1.1 } }).data.id;
  assert.equal(m.call("edit_world_event", { id: active, start: "2026-12-01" }).error.code, "rule_violation", "a started event cannot be moved");
});

// ------------------------------------------------------------ plug-in

test("the plug-in publishes each event's news once on its start day and moves statuses along", () => {
  const w = newWorld();
  const st = w.state;
  st.world_events.push(occ({ id: "WE-00001", status: "scheduled", start: "2026-11-25", end: "2026-11-26", headline: "Big news", story: "A. B. C.", section: "Local", effects: { visits: 1.2 } }));
  eventsPlugin.afterDay({ state: st, date: "2026-11-24", seed: "s" });
  assert.equal(st.news.length, 0);
  eventsPlugin.afterDay({ state: st, date: "2026-11-25", seed: "s" });
  assert.equal(st.news.length, 1);
  assert.equal(st.news[0].id, "NW-00001");
  assert.equal(st.world_events[0].status, "active");
  eventsPlugin.afterDay({ state: st, date: "2026-11-25", seed: "s" });
  assert.equal(st.news.length, 1, "no duplicate");
  eventsPlugin.afterDay({ state: st, date: "2026-11-26", seed: "s" });
  assert.equal(st.world_events[0].status, "over");
  assert.equal(eventsPlugin.modifiers({ state: st, date: "2026-11-25" }).visits, 1.2);
  assert.equal(eventsPlugin.modifiers({ state: st, date: "2026-11-27" }).visits, 1);
});

// ------------------------------------------------------------ history

test("the history builder gives five years of events plus a year ahead, and news only for what has started", () => {
  const { world_events, news } = buildEventHistory(library, { seed: "h1", from: "2021-11-22", to: "2026-11-22" });
  const again = buildEventHistory(library, { seed: "h1", from: "2021-11-22", to: "2026-11-22" });
  assert.deepEqual(again, { world_events, news });
  assert.ok(world_events.length > 250);
  assert.ok(world_events.every((e) => /^WE-\d{5}$/.test(e.id) && e.origin === "seeded"));
  const future = world_events.filter((e) => e.start > "2026-11-22");
  assert.ok(future.length > 20 && future.every((e) => e.status === "scheduled"));
  assert.ok(news.every((n) => n.at <= "2026-11-22T23:59:59Z" && /^NW-\d{5}$/.test(n.id)));
  assert.equal(news.length, world_events.filter((e) => e.start >= "2021-11-22" && e.start <= "2026-11-22").length);
  assert.ok(world_events.some((e) => e.status === "over") && world_events.every((e) => e.status !== "over" || e.end < "2026-11-22"));
  const w = newWorld();
  w.state.world_events = world_events;
  w.state.news = news;
  assert.ok(w.session({ role: "customer" }).call("list_news", { limit: 5 }).data.news.length === 5);
});

test("an event already active on the first day gets its news once", () => {
  const w = newWorld();
  const st = w.state;
  st.world_events.push(occ({ id: "WE-00001", start: "2026-11-23", end: "2026-11-30", headline: "Already on", story: "A. B. C.", section: "Diary", effects: { visits: 1.2 } }));
  st.world_events.push(occ({ id: "WE-00002", start: "2026-11-01", end: "2026-11-10", effects: { visits: 1.2 } }));
  eventsPlugin.afterDay({ state: st, date: "2026-11-24", seed: "s" });
  eventsPlugin.afterDay({ state: st, date: "2026-11-25", seed: "s" });
  assert.deepEqual(st.news.map((n) => n.event), ["WE-00001"]);
});

test("list_event_templates is manager-only, filters, pages, and descriptions carry the headline", () => {
  const w = newWorld();
  const m = w.session({ role: "manager" });
  assert.equal(w.session({ role: "support_agent" }).call("list_event_templates", {}).error.code, "forbidden");
  const all = m.call("list_event_templates", { limit: 5 }).data;
  assert.equal(all.total, library.events.length);
  assert.equal(all.templates.length, 5);
  assert.ok(all.templates[0].effects_in_words.length && all.templates[0].why && all.templates[0].chatter);
  const wolf = m.call("list_event_templates", { search: "wolf pigs", family: "storybook" }).data;
  assert.equal(wolf.templates[0].id, "sb-wolf-pigs");
  assert.notEqual(m.call("list_event_templates", { limit: 5, offset: 5 }).data.templates[0].id, all.templates[0].id);
  const added = m.call("add_world_event", { template: "rs-heatwave" }).data;
  assert.ok(added.headline);
  assert.ok(m.call("get_world_event", { id: added.id }).data.headline);
});
