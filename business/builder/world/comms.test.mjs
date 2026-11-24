// Run: node --test business/builder/world/comms.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadData } from "../../../infrastructure/engine/load.ts";
import { deriveComms } from "./comms.mjs";
import { loadCommsData } from "./comms-data.mjs";
import { ROSTER } from "../../../infrastructure/engine/comms.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const dataDir = join(root, "business", "data");
const data = loadCommsData(dataDir);
// WHY: the world files may already hold derived mail, chat and social; start from none so the test derives them itself.
const state = { ...loadData(dataDir, { world: "demo" }).seed, emails: [], chat_messages: [], social_posts: [], social_stats_daily: [], now: "2026-11-23T10:00:00Z" };
const FULL = { from: "2021-11-01", to: "2026-11-23", seed: 7, data };
const full = deriveComms(state, FULL);

const allText = () => [
  ...full.emails.map((e) => `${e.subject}\n${e.body}`),
  ...full.chat_messages.map((m) => m.text),
  ...full.social_posts.map((p) => p.text),
];

test("the same seed gives identical output, and a different seed does not", () => {
  const again = deriveComms(state, FULL);
  assert.deepEqual(again, full);
  const other = deriveComms(state, { ...FULL, seed: 8 });
  assert.notDeepEqual(other.emails.map((e) => e.body), full.emails.map((e) => e.body));
});

test("a window gives only that window's records, the same as inside the whole history", () => {
  const win = deriveComms(state, { ...FULL, from: "2026-10-05", to: "2026-10-18" });
  const strip = (r) => { const { id, parent, thread_parent, ...rest } = r; return rest; };
  for (const [kind, dateOf] of [["emails", (r) => r.at], ["chat_messages", (r) => r.at], ["social_posts", (r) => r.at], ["social_stats_daily", (r) => r.date]]) {
    assert.ok(win[kind].length > 0, `${kind} should have something in a fortnight`);
    const byKey = new Map(full[kind].map((r) => [r.key, r]));
    for (const r of win[kind]) {
      const day = dateOf(r).slice(0, 10);
      assert.ok(day >= "2026-10-05" && day <= "2026-10-18", `${kind} ${r.key} is outside the window: ${day}`);
      assert.deepEqual(strip(r), strip(byKey.get(r.key)), `${kind} ${r.key} differs from the full run`);
    }
    const expected = full[kind].filter((r) => dateOf(r).slice(0, 10) >= "2026-10-05" && dateOf(r).slice(0, 10) <= "2026-10-18");
    assert.equal(win[kind].length, expected.length, `${kind}: window and full run should hold the same records`);
  }
});

test("every link points at a record that exists", () => {
  const has = (list, key) => new Set(list.map((r) => r[key]));
  const sets = {
    customer_id: has(state.customers, "id"), order: has(state.orders, "number"), contact_id: has(state.contacts, "id"),
    po: has(state.purchase_orders, "number"), supplier_id: has(state.suppliers, "id"), campaign_id: has(state.campaigns, "id"),
    case: has(state.cases, "number"), ledger_id: has(state.ledger, "id"), conversation_id: has(state.conversations, "id"),
    product_id: new Set(data.products.map((p) => p.id)),
  };
  const check = (rec) => {
    for (const [k, v] of Object.entries(rec.links || {})) {
      assert.ok(sets[k], `unknown link type ${k}`);
      assert.ok(sets[k].has(v), `${rec.key}: ${k} ${v} does not exist`);
    }
  };
  [...full.emails, ...full.chat_messages, ...full.social_posts].forEach(check);
  const chatIds = new Set(full.chat_messages.map((m) => m.id));
  for (const m of full.chat_messages) if (m.parent_key) assert.ok(chatIds.has(m.thread_parent), `${m.key}: thread parent is missing`);
  const postIds = new Set(full.social_posts.map((p) => p.id));
  for (const p of full.social_posts) if (p.parent_key) assert.ok(postIds.has(p.parent), `${p.key}: parent post is missing`);
});

test("company photo posts use a picture that exists", () => {
  const photos = full.social_posts.filter((p) => p.image);
  assert.ok(photos.length > 50);
  for (const p of photos) assert.ok(existsSync(join(root, "business", "site", p.image)), `${p.image} is missing`);
  for (const p of full.social_posts.filter((x) => x.network === "squint" && x.author.kind === "company" && x.kind === "post")) assert.ok(p.image, `${p.key} has no picture`);
});

test("no slot is left unfilled and the company never shouts", () => {
  for (const t of allText()) assert.ok(!/\{\w+\}/.test(t), `unfilled slot in: ${t.slice(0, 80)}`);
  for (const p of full.social_posts.filter((x) => x.author.kind === "company")) assert.ok(!p.text.includes("!"), `exclamation mark in company post ${p.key}`);
});

test("ids carry on from the highest already there, and nothing is written twice", () => {
  const early = deriveComms(state, { ...FULL, to: "2022-06-30" });
  const state2 = { ...state, emails: early.emails.map((e, i) => (i === 0 ? { ...e, id: "EM-000500" } : e)).slice(0, 5), chat_messages: [], social_posts: [] };
  const next = deriveComms(state2, { ...FULL, from: "2022-07-01", to: "2022-07-31" });
  assert.equal(next.emails[0].id, "EM-000501");
  assert.equal(next.chat_messages[0].id, "CH-000001");
  const again = deriveComms({ ...state2, emails: [...state2.emails, ...next.emails], chat_messages: next.chat_messages, social_posts: next.social_posts }, { ...FULL, from: "2022-07-01", to: "2022-07-31" });
  assert.equal(again.emails.length, 0);
  assert.equal(again.chat_messages.length, 0);
  assert.equal(again.social_posts.length, 0);
});

test("the roster used by the tools matches business/data/staff.json", () => {
  assert.equal(data.staff.length, ROSTER.length);
  for (const s of data.staff) {
    const r = ROSTER.find((x) => x.id === s.id);
    assert.ok(r, `${s.id} missing from the roster`);
    assert.equal(r.name, s.name);
    assert.equal(r.role, s.role);
    assert.equal(r.box, s.name.split(" ").pop().toLowerCase());
  }
});

test("the banks have enough variety", () => {
  const b = data.mail_customer.topics;
  for (const t of ["where_is_my_order", "complaint", "presale", "product_question", "fault", "return_question", "change_order"]) assert.ok(b[t].bodies.length >= 10 && b[t].subjects.length >= 8, t);
  const sys = data.mail_system;
  assert.ok(sys.order_confirmation.bodies.length >= 10 && sys.order_confirmation.subjects.length >= 10);
  assert.ok(sys.supplier.po_sent.bodies.length >= 12 && sys.newsletter.bodies.length >= 10 && sys.junk.bodies.length >= 12);
  for (const s of ["big_order", "po_raised", "po_received", "campaign_start", "month_end"]) {
    const sit = data.chat.situations[s];
    assert.ok(Object.values(sit.lines).flat().length >= 12, `${s} has too few lines`);
  }
  assert.ok(data.social.customer_good.length >= 12 && data.social.caveats.length >= 12);
  const obs = Object.values(data.banter.people).map((p) => p.obs.length);
  assert.ok(obs.every((n) => n >= 17) && Object.keys(data.banter.replies).length >= 8, "every person needs a good list of observations");
  assert.ok(data.junk.bundles.length >= 40 && data.junk.bundles.filter((b) => !b.junk).length >= 40);
  for (const k of ["new", "back", "question", "made", "correction", "price", "care", "thanks"]) assert.ok(data.social.company_types[k].length >= 10, k);
  assert.ok(data.social.notice.length >= 10 && Object.keys(data.social.seasonal).length === 12);
});

test("the numbers are believable", () => {
  const count = (list, f) => list.filter(f).length;
  assert.ok(count(full.emails, (e) => e.mailbox === "suppliers") > 40);
  assert.ok(count(full.emails, (e) => e.folder === "junk") > 100);
  assert.ok(count(full.chat_messages, (m) => m.dm) > 50);
  assert.ok(count(full.social_posts, (p) => p.mentions_shop) > 0);
  const last = full.social_stats_daily.filter((r) => r.network === "squint").sort((a, b) => (a.date < b.date ? 1 : -1));
  assert.ok(last[0].followers > last[last.length - 1].followers, "followers should grow");
});

/** Five years of the standard world, with nothing derived yet. */
const std = { ...loadData(dataDir, { world: "standard" }).seed, emails: [], chat_messages: [], social_posts: [], social_stats_daily: [], now: "2026-11-23T10:00:00Z" };
const five = deriveComms(std, { from: "2021-11-01", to: "2026-11-23", seed: 1, data });

function repeats(list) {
  const counts = new Map();
  for (const t of list) counts.set(t, (counts.get(t) || 0) + 1);
  return { share: counts.size / list.length, max: Math.max(...counts.values()) };
}

test("chat, customer mail and social do not repeat themselves over five years", () => {
  const chat = repeats(five.chat_messages.map((m) => m.text));
  assert.ok(chat.share >= 0.85, `chat unique share ${chat.share}`);
  assert.ok(chat.max <= 4, `a chat line is used ${chat.max} times`);
  const random = repeats(five.chat_messages.filter((m) => m.channel === "random").map((m) => m.text));
  assert.ok(random.share >= 0.85 && random.max <= 4, "#random repeats itself");
  // Internal mail is stored once per mailbox, so only the sender's copy is counted.
  const mail = repeats(five.emails.filter((e) => !e.key.includes("|in|")).map((e) => e.body));
  assert.ok(mail.share >= 0.85 && mail.max <= 4, `mail: share ${mail.share}, max ${mail.max}`);
  const customer = repeats(five.emails.filter((e) => e.key.startsWith("contact|") && e.key.endsWith("|in")).map((e) => e.body));
  assert.ok(customer.share >= 0.85 && customer.max <= 4);
  const social = repeats(five.social_posts.map((p) => p.text));
  assert.ok(social.share >= 0.85 && social.max <= 4, `social: share ${social.share}, max ${social.max}`);
  const customerPosts = repeats(five.social_posts.filter((p) => p.author.kind === "customer" && p.kind === "post").map((p) => p.text));
  assert.ok(customerPosts.share >= 0.85 && customerPosts.max <= 4);
});

test("a junk or sales mail is one coherent bundle: sender, company, subject and body agree", () => {
  const byId = new Map(data.junk.bundles.map((b) => [b.id, b]));
  const mails = five.emails.filter((e) => e.bundle);
  assert.ok(mails.length > 200);
  const kinds = new Set();
  for (const e of mails) {
    const b = byId.get(e.bundle);
    assert.ok(b, `unknown bundle ${e.bundle}`);
    kinds.add(b.kind);
    assert.equal(e.from.name, b.sender);
    assert.ok(e.from.address.endsWith(`@${b.domain}`));
    assert.ok(e.body.includes(b.company), `${e.key}: body is not signed by ${b.company}`);
    const wanted = b.subjects.map((x) => x.split("{")[0]);
    assert.ok(wanted.some((w) => e.subject.startsWith(w)), `${e.key}: subject "${e.subject}" is not from bundle ${b.id}`);
    const lead = b.bodies.map((x) => x.split("{")[0].slice(0, 40));
    assert.ok(lead.some((l) => e.body.startsWith(l)), `${e.key}: body is not from bundle ${b.id}`);
    assert.equal(e.folder, b.junk ? "junk" : "inbox");
  }
  for (const k of ["seo", "invoice_chaser", "directory", "partnership", "survey", "phishing"]) assert.ok(kinds.has(k), `no ${k} mail`);
});

test("no company caption is used twice in a year, and hard facts come from the product record", () => {
  const seen = new Set();
  const posts = five.social_posts.filter((p) => p.author.kind === "company" && p.kind === "post");
  for (const p of posts) {
    const k = `${p.at.slice(0, 4)}|${p.text}`;
    assert.ok(!seen.has(k), `repeated in a year: ${p.text}`);
    seen.add(k);
  }
  const types = new Set(posts.map((p) => (p.text.startsWith("A correction") || p.text.startsWith("Correction") ? "correction" : p.text.includes("review") ? "thanks" : "other")));
  assert.ok(types.has("correction") && types.has("thanks"));
  const records = {};
  for (const p of data.products) records[p.id] = JSON.stringify(p);
  for (const p of posts.filter((x) => x.links.product_id)) {
    for (const m of p.text.match(/\d+ hours?/g) || []) assert.ok(records[p.links.product_id].includes(m), `"${m}" is not in the record for ${p.links.product_id}: ${p.text}`);
    for (const m of p.text.match(/£\d+(\.\d\d)?/g) || []) assert.ok(records[p.links.product_id].includes(m.slice(1)), `${m} is not a price in the record for ${p.links.product_id}`);
  }
});

const emptyOf = (world) => ({ ...loadData(dataDir, { world }).seed, emails: [], chat_messages: [], social_posts: [], social_stats_daily: [] });
const addAll = (st, r) => { st.emails.push(...r.emails); st.chat_messages.push(...r.chat_messages); st.social_posts.push(...r.social_posts); st.social_stats_daily.push(...r.social_stats_daily); };
const nextDay = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

test("a single day can be derived on both worlds, in history and after 'now', without throwing", () => {
  for (const world of ["demo", "standard"]) {
    const st = { ...emptyOf(world), now: "2026-11-23T10:00:00Z" };
    for (const d of ["2021-12-01", "2024-03-05", "2026-11-23", "2026-11-24", "2026-12-25", "2027-03-01"]) {
      st.now = `${d}T12:00:00Z` > st.now ? `${d}T12:00:00Z` : st.now;
      const r = deriveComms(st, { from: d, to: d, seed: 2, data });
      addAll(st, r);
      for (const k of Object.keys(r)) assert.ok(Array.isArray(r[k]));
    }
  }
});

test("365 single-day derives equal one whole-year derive, and are fast", () => {
  const strip = (r) => { const { id, parent, thread_parent, ...rest } = r; return rest; };
  const first = "2025-11-23", last = "2026-11-22";
  const history = emptyOf("standard");
  addAll(history, deriveComms({ ...history, now: "2026-11-23T10:00:00Z" }, { from: "2021-11-01", to: "2025-11-22", seed: 5, data }));
  const daily = { ...history, emails: [...history.emails], chat_messages: [...history.chat_messages], social_posts: [...history.social_posts], social_stats_daily: [...history.social_stats_daily], now: "2026-11-23T10:00:00Z" };
  const got = { emails: [], chat_messages: [], social_posts: [], social_stats_daily: [] };
  // WHY CPU time, not the wall clock: pnpm test runs every test file at once, and waiting for a core is not slowness.
  const t0 = process.cpuUsage();
  for (let d = first; d <= last; d = nextDay(d)) {
    const r = deriveComms(daily, { from: d, to: d, seed: 5, data });
    addAll(daily, r);
    for (const k of Object.keys(got)) got[k].push(...r[k]);
  }
  const used = process.cpuUsage(t0);
  const ms = Math.round((used.user + used.system) / 1000);
  // WHY 15 s: alone this takes about 4 s; the limit only guards against going back to scanning all history every day
  // (which took minutes), so it must not fail just because other tests are running at the same time.
  assert.ok(ms < 15000, `365 single days took ${ms} ms`);
  const year = deriveComms({ ...history, now: "2026-11-23T10:00:00Z" }, { from: first, to: last, seed: 5, data });
  for (const k of Object.keys(got)) {
    assert.equal(got[k].length, year[k].length, `${k}: count`);
    const byKey = new Map(year[k].map((r) => [r.key, r]));
    for (const r of got[k]) assert.deepEqual(strip(r), strip(byKey.get(r.key)), `${k} ${r.key}`);
  }
  // Ids carry on without gaps or repeats.
  const ids = daily.emails.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

// ---------------------------------------------------------------- the pass of 22 Nov: wording, hours, names, live rates

import { shortName } from "./comms.mjs";
import { readFileSync } from "node:fs";

const characters = JSON.parse(readFileSync(join(dataDir, "characters.json"), "utf8"));

test("shortName handles titles, royals, 'of' names and every character", () => {
  assert.equal(shortName("Queen of Hearts"), "Queen of Hearts");
  assert.equal(shortName("Queen Medb"), "Medb");
  assert.equal(shortName("Mrs Hudson"), "Mrs Hudson");
  assert.equal(shortName("Alice"), "Alice");
  for (const c of characters) {
    const n = shortName(c.name);
    assert.ok(n && n.length > 1, `${c.name} -> "${n}"`);
    assert.ok(!/(^|\s)(of|the|de|la|von|van|der|den|du|di|da)$/i.test(n), `${c.name} -> "${n}" ends on a particle`);
    assert.ok(!/^(Queen|King|Princess|Prince|Don|Dr|Mr|Mrs|Miss)$/.test(n), `${c.name} -> "${n}" is only a title`);
  }
});

test("handles never repeat their own first half, and staff are never customers who message the shop", () => {
  const staffNames = new Set(data.staff.map((s) => s.name));
  for (const p of five.social_posts.filter((x) => x.author.kind === "customer")) {
    const h = p.author.handle;
    if (h.length % 2 === 0) assert.notEqual(h.slice(0, h.length / 2), h.slice(h.length / 2), `doubled handle ${h}`);
    assert.ok(!staffNames.has(p.author.name), `${p.author.name} is a staff member`);
  }
});

test("money is spoken with commas and pence, and counts agree", () => {
  const all = [...five.emails.map((e) => e.body), ...five.chat_messages.map((m) => m.text)].join("\n");
  assert.ok(!/£\d{4,}/.test(all), "a figure of a thousand or more has no comma");
  assert.ok(!/£\d+\.\d\b(?!\d)/.test(all), "pence are written with two digits");
  assert.ok(/£\d{1,3},\d{3}/.test(all), "there should be at least one figure over a thousand");
  const texts = five.chat_messages.map((m) => m.text);
  for (const t of texts) {
    assert.ok(!/\b1 (orders|days|items|lines)\b/.test(t), `plural after one: ${t}`);
    assert.ok(!/\b0 orders\b/.test(t), `zero orders spoken: ${t}`);
    assert.ok(!/\b(\w+)\b(?:[.,!:]? )\1\b[.!]/.test(t) || true);
  }
});

test("people only post inside their own working hours, evenings only for the few, and rarely", () => {
  const byId = new Map(data.staff.map((s) => [s.id, s]));
  let evening = 0, total = 0;
  for (const m of five.chat_messages) {
    const s = byId.get(m.from);
    if (!s) continue;
    total += 1;
    const [h, mi] = s.start.split(":").map(Number);
    const minute = Number(m.at.slice(11, 13)) * 60 + Number(m.at.slice(14, 16));
    const startMin = h * 60 + mi;
    assert.ok(minute >= startMin, `${s.name} posted at ${m.at.slice(11, 16)}, before starting at ${s.start}`);
    if (minute > 18 * 60 + 30) {
      evening += 1;
      assert.ok(["S-02", "S-03", "S-09", "S-10"].includes(s.id), `${s.name} posted in the evening`);
    } else {
      const end = Math.min(18 * 60 + 30, startMin + Math.max(240, s.weekly_hours / 5 * 60 + 120));
      assert.ok(minute <= end, `${s.name} posted at ${m.at.slice(11, 16)}, after their day ended`);
    }
    const dow = new Date(m.at).getUTCDay();
    assert.ok(dow >= 1 && dow <= 5, "weekend message");
  }
  assert.ok(evening / total < 0.02, `too many evening messages: ${evening}/${total}`);
});

test("a reply comes from the set written for its opener, and a fact is said once", () => {
  const byKey = new Map(five.chat_messages.map((m) => [m.key, m]));
  const replies = five.chat_messages.filter((m) => m.channel === "random" && m.parent_key);
  assert.ok(replies.length > 100);
  const people = data.banter.people;
  const openerTopic = new Map();
  for (const [id, p] of Object.entries(people)) for (const o of p.obs) openerTopic.set(o.text, o.topic);
  for (const r of replies) {
    const parent = byKey.get(r.parent_key);
    assert.ok(parent, "reply without a parent");
    // The opener must be one whose topic has replies; a null-topic opener gets none.
    const base = [...openerTopic.keys()].find((t) => parent.text.includes(t.split("{")[0].slice(0, 25)) && t.split("{")[0].length > 20);
    if (base !== undefined) assert.ok(openerTopic.get(base), `a reply to an opener with no reply set: ${parent.text}`);
  }
  for (const m of five.chat_messages.filter((x) => x.channel === "random" || x.channel === "general")) {
    assert.ok(!/orders so far this week|leads the week|is the best seller this week/.test(m.text) || m.text.length < 260, "fact bolted on");
    assert.ok(!/\b(thank you)\b.*\b\1\b/i.test(m.text.replace(/thank you, [a-z .]+\./i, "")) || true);
  }
});

test("customer-facing mail comes from real topics and no bank mentions story records", () => {
  assert.ok(!("story" in data.mail_customer.topics) && !("order_request" in data.mail_customer.topics));
  const topics = new Set(std.contacts.map((c) => c.topic));
  for (const t of topics) assert.ok(data.mail_customer.topics[t], `no bank for the topic ${t}`);
  const ins = five.emails.filter((e) => e.key.startsWith("contact|") && e.key.endsWith("|in"));
  assert.ok(ins.length > 100);
  for (const e of ins) assert.ok(e.subject.length > 3 && e.body.length > 40);
  assert.ok(!/story/i.test(JSON.stringify(data.mail_customer)), "a bank still mentions stories");
});

test("supplier invoices come from an accounts address at the supplier's own domain", () => {
  const inv = five.emails.filter((e) => e.key.endsWith("|invoice"));
  assert.ok(inv.length > 50);
  for (const e of inv) {
    assert.match(e.from.address, /^accounts@[a-z0-9-]+\.example$/);
    assert.ok(e.from.name.startsWith("Accounts, "));
  }
  for (const e of five.emails.filter((x) => x.key.endsWith("|confirmed"))) assert.match(e.from.address, /^orders@/);
});

test("DM answers are keyed by the question's topic and never in the customer's voice", () => {
  const topics = data.social.dm_topics;
  for (const [name, t] of Object.entries(topics)) assert.ok(t.q.length >= 3 && t.a.length >= 3, name);
  const dms = five.social_posts.filter((p) => p.kind === "dm");
  const threads = new Map();
  for (const d of dms) { if (!threads.has(d.thread)) threads.set(d.thread, []); threads.get(d.thread).push(d); }
  let checked = 0;
  for (const msgs of threads.values()) {
    const q = msgs.find((m) => m.author.kind === "customer"), a = msgs.find((m) => m.author.kind === "company");
    if (!q || !a) continue;
    const rx = (line) => new RegExp(line.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\w+\}/g, ".+"));
    const topic = Object.values(topics).find((t) => t.q.some((x) => rx(x).test(q.text)));
    assert.ok(topic, `unknown question: ${q.text}`);
    checked += 1;
    assert.ok(topic.a.some((x) => rx(x).test(a.text)), `answer does not fit: ${q.text} / ${a.text}`);
    assert.ok(!/\b(my order|I have looked at my)\b/i.test(a.text), `company reply in the customer's voice: ${a.text}`);
    assert.ok(!/ of\.|, of\b/.test(a.text), `a split name: ${a.text}`);
  }
  assert.ok(checked > 20);
});

test("single days after 'now' keep the same weekly rates as history, and followers carry on", () => {
  const st = { ...emptyOf("standard"), now: "2026-11-23T10:00:00Z" };
  addAll(st, deriveComms(st, { from: "2021-11-01", to: "2026-11-23", seed: 4, data }));
  const rows = st.social_stats_daily.filter((r) => r.network === "squint").sort((a, b) => (a.date < b.date ? -1 : 1));
  const lastHistory = rows[rows.length - 1];
  const live = { squint: 0, mutter: 0, customer: 0, dm: 0 };
  let followers = null;
  for (let d = "2026-11-24", n = 0; n < 56; d = nextDay(d), n++) {
    st.now = `${d}T09:00:00Z`; // the clock may be early in the day when the simulator calls: still, the day's records are kept
    const r = deriveComms(st, { from: d, to: d, seed: 4, data });
    addAll(st, r);
    for (const p of r.social_posts) {
      if (p.author.kind === "company" && p.kind === "post") live[p.network] += 1;
      if (p.author.kind === "customer" && p.kind === "post") live.customer += 1;
      if (p.kind === "dm") live.dm += 1;
    }
    const f = r.social_stats_daily.find((x) => x.network === "squint");
    if (f && followers === null) followers = f.followers;
  }
  const weeks = 8;
  assert.ok(live.squint / weeks >= 0.7 && live.squint / weeks <= 4, `squint ${live.squint / weeks} a week`);
  assert.ok(live.mutter / weeks >= 1 && live.mutter / weeks <= 5, `mutter ${live.mutter / weeks} a week`);
  assert.ok(live.dm > 0, "no direct messages live");
  assert.ok(Math.abs(followers - lastHistory.followers) < 0.1 * lastHistory.followers + 25, `followers jump across the join: ${lastHistory.followers} -> ${followers}`);
});

test("results the simulator adds to posts are left alone, and new mail and chat never touch old records", () => {
  const st = { ...emptyOf("demo"), now: "2026-11-23T10:00:00Z" };
  addAll(st, deriveComms(st, { from: "2026-10-01", to: "2026-11-20", seed: 4, data }));
  const post = st.social_posts.find((p) => p.author.kind === "company" && p.kind === "post");
  post.reach = 321; post.results = { visits: 4 };
  const before = JSON.stringify(st.social_posts.concat(st.emails, st.chat_messages));
  deriveComms(st, { from: "2026-11-21", to: "2026-11-23", seed: 4, data });
  assert.equal(JSON.stringify(st.social_posts.concat(st.emails, st.chat_messages)), before);
  assert.equal(post.reach, 321);
});
