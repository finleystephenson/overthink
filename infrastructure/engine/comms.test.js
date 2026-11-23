// Run: node --test infrastructure/engine/comms.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createWorld } from "./all.js";
import { loadData } from "./load.js";
import { deriveComms } from "../../business/builder/world/comms.mjs";
import { loadCommsData } from "../../business/builder/world/comms-data.mjs";

const dataDir = join(fileURLToPath(new URL("../../", import.meta.url)), "business", "data");
const loaded = loadData(dataDir, { world: "demo" });
const commsData = loadCommsData(dataDir);

/** A demo world with a month of derived mail, chat and social already in it. */
function makeWorld() {
  const base = createWorld({ ...loaded, now: "2026-11-23T10:00:00Z" });
  for (const k of ["emails", "chat_messages", "social_posts", "social_stats_daily"]) base.state[k] = [];
  const derived = deriveComms(base.state, { from: "2026-10-01", to: "2026-11-22", seed: 3, data: commsData });
  base.state.emails = derived.emails;
  base.state.chat_messages = derived.chat_messages;
  base.state.social_posts = derived.social_posts;
  base.state.social_stats_daily = derived.social_stats_daily;
  for (const [prefix, key] of [["EM", "emails"], ["CH", "chat_messages"], ["SP", "social_posts"]]) {
    base.state.counters[prefix] = base.state[key].reduce((n, r) => Math.max(n, Number(r.id.split("-")[1])), 0);
  }
  return base;
}

const call = (world, role, tool, input) => world.session({ role }).call(tool, input);
const COMMS_TOOLS = ["list_mailboxes", "list_emails", "get_email_thread", "send_email", "draft_email", "mark_email", "list_channels", "read_channel", "send_chat_message", "read_direct_messages", "list_social_posts", "get_social_post", "create_social_post", "reply_social_post", "list_social_messages", "send_social_message", "social_stats"];

test("every comms tool is registered", () => {
  const world = makeWorld();
  for (const t of COMMS_TOOLS) assert.ok(world.tools.some((x) => x.name === t), `${t} missing`);
});

test("the customer-facing assistant and customers are refused everything internal", () => {
  const world = makeWorld();
  for (const role of ["assistant", "customer"]) {
    for (const [tool, input] of [["list_channels", {}], ["read_channel", { channel: "money" }], ["list_emails", { mailbox: "hello" }], ["list_mailboxes", {}], ["read_direct_messages", { person: "S-03" }], ["list_social_posts", {}]]) {
      const r = call(world, role, tool, input);
      assert.equal(r.ok, false, `${role} should not use ${tool}`);
      assert.equal(r.error.code, "forbidden");
    }
  }
});

test("staff can read chat; the finance box is not open to the warehouse", () => {
  const world = makeWorld();
  const ch = call(world, "warehouse", "read_channel", { channel: "stockroom", limit: 5 });
  assert.equal(ch.ok, true);
  assert.ok(ch.data.messages.length > 0 && ch.data.messages.length <= 5);
  const refused = call(world, "warehouse", "list_emails", { mailbox: "accounts" });
  assert.equal(refused.error.code, "forbidden");
  assert.equal(call(world, "finance", "list_emails", { mailbox: "accounts", limit: 3 }).ok, true);
  assert.equal(call(world, "finance", "list_emails", { mailbox: "toad" }).error.code, "forbidden");
  assert.equal(call(world, "manager", "list_emails", { mailbox: "toad", limit: 3 }).ok, true);
  const boxes = call(world, "buyer", "list_mailboxes", {}).data.mailboxes.map((b) => b.mailbox);
  assert.ok(boxes.includes("suppliers") && !boxes.includes("hello"));
});

test("direct messages are private to their owner's role, except for the manager", () => {
  const world = makeWorld();
  assert.equal(call(world, "marketing", "read_direct_messages", { person: "S-03" }).error.code, "forbidden");
  assert.equal(call(world, "finance", "read_direct_messages", { person: "S-03" }).ok, true);
  assert.equal(call(world, "manager", "read_direct_messages", { person: "S-03" }).ok, true);
});

test("marketing can post socially and warehouse cannot", () => {
  const world = makeWorld();
  const ok = call(world, "marketing", "create_social_post", { network: "squint", text: "The Spare Sock. One sock, sold singly.", image: "img/branded/spare-sock.jpg", product_id: "spare-sock" });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(call(world, "manager", "create_social_post", { network: "mutter", text: "A short note." }).ok, true);
  const no = call(world, "warehouse", "create_social_post", { network: "mutter", text: "Hello." });
  assert.equal(no.error.code, "forbidden");
  const post = world.state.social_posts.find((p) => p.id === ok.data.id);
  assert.equal(post.at, "2026-11-23T10:00:00Z");
  assert.equal(post.author.kind, "company");
  assert.ok(world.state.audit.at(-1).changes.length >= 0);
});

test("social posts are validated", () => {
  const world = makeWorld();
  assert.equal(call(world, "marketing", "create_social_post", { network: "squint", text: "No picture." }).error.code, "invalid_input");
  assert.equal(call(world, "marketing", "create_social_post", { network: "squint", text: "x", image: "img/branded/made-up-thing.jpg" }).error.code, "not_found");
  assert.equal(call(world, "marketing", "create_social_post", { network: "mutter", text: "x".repeat(281) }).error.code, "invalid_input");
  assert.equal(call(world, "marketing", "create_social_post", { network: "nowhere", text: "x" }).error.code, "invalid_input");
  assert.equal(call(world, "marketing", "create_social_post", { network: "mutter", text: "  " }).error.code, "invalid_input");
});

test("a reply to a customer's post and a private message are recorded", () => {
  const world = makeWorld();
  const mention = call(world, "support_lead", "list_social_posts", { mentions_only: true, limit: 1 });
  if (mention.data.posts.length) {
    const r = call(world, "support_lead", "reply_social_post", { post_id: mention.data.posts[0].id, text: "Thank you. We have noted it." });
    assert.equal(r.ok, true);
    assert.equal(call(world, "warehouse", "reply_social_post", { post_id: mention.data.posts[0].id, text: "Hi." }).error.code, "forbidden");
    const full = call(world, "support_lead", "get_social_post", { post_id: mention.data.posts[0].id });
    assert.ok(full.data.comments.some((c) => c.id === r.data.id));
  }
  const c = world.state.customers[0];
  const dm = call(world, "support_agent", "send_social_message", { network: "mutter", customer_id: c.id, text: "Hello, how can we help?" });
  assert.equal(dm.ok, true);
  const convo = call(world, "support_agent", "list_social_messages", { thread: dm.data.thread });
  assert.equal(convo.data.messages.length, 1);
});

test("send_email: a reply to a customer marks their contact answered", () => {
  const world = makeWorld();
  const c = world.state.customers.find((x) => x.email);
  world.state.contacts.push({ id: "CT-99001", at: "2026-11-23T08:00:00Z", customer_id: c.id, channel: "email", topic: "presale", handled_by: "support_agent", first_reply_minutes: null, resolve_minutes: null, outcome: "answered", case_number: null, summary: null });
  const inbound = { id: "EM-900001", key: "test|1", thread_id: "TH-CT-99001", mailbox: "hello", folder: "inbox", from: { name: c.name, address: c.email }, to: [{ name: "Overthought & Co.", address: "hello@overthought.example" }], cc: [], subject: "Question", body: "Is it in stock?", at: "2026-11-23T08:00:00Z", read: false, by: null, links: { customer_id: c.id, contact_id: "CT-99001" } };
  world.state.emails.push(inbound);
  world.state.counters.EM = 900001;
  const r = call(world, "support_agent", "send_email", { mailbox: "hello", reply_to_id: "EM-900001", body: "Yes, it is in stock." });
  assert.equal(r.ok, true, JSON.stringify(r));
  const sent = world.state.emails.find((e) => e.id === r.data.id);
  assert.equal(sent.folder, "sent");
  assert.equal(sent.thread_id, "TH-CT-99001");
  assert.equal(sent.to[0].address, c.email);
  assert.equal(sent.subject, "Re: Question");
  assert.equal(sent.links.contact_id, "CT-99001");
  assert.equal(r.data.id, "EM-900002", "ids carry on from the highest");
  assert.equal(world.state.contacts.find((x) => x.id === "CT-99001").first_reply_minutes, 120);
  // A second reply must not change the first reply time.
  world.setNow("2026-11-23T12:00:00Z");
  call(world, "support_agent", "send_email", { mailbox: "hello", reply_to_id: "EM-900001", body: "Anything else?" });
  assert.equal(world.state.contacts.find((x) => x.id === "CT-99001").first_reply_minutes, 120);
});

test("send_email validates, respects mailboxes, and delivers inside the company", () => {
  const world = makeWorld();
  assert.equal(call(world, "warehouse", "send_email", { mailbox: "accounts", to: ["x@y.example"], subject: "s", body: "b" }).error.code, "forbidden");
  assert.equal(call(world, "buyer", "send_email", { mailbox: "suppliers", to: ["not an address"], subject: "s", body: "b" }).error.code, "invalid_input");
  assert.equal(call(world, "buyer", "send_email", { mailbox: "suppliers", to: ["x@y.example"], subject: "s", body: "  " }).error.code, "invalid_input");
  assert.equal(call(world, "buyer", "send_email", { mailbox: "suppliers", to: ["x@y.example"], body: "b" }).error.code, "invalid_input");
  assert.equal(call(world, "buyer", "send_email", { mailbox: "nowhere", to: ["x@y.example"], subject: "s", body: "b" }).error.code, "not_found");
  const before = world.state.emails.length;
  const r = call(world, "buyer", "send_email", { mailbox: "suppliers", to: ["accounts@overthought.example"], subject: "Invoice question", body: "Please look at this invoice." });
  assert.equal(r.ok, true);
  assert.equal(world.state.emails.length, before + 2);
  const inbox = call(world, "finance", "list_emails", { mailbox: "accounts", unread: true, search: "invoice question" });
  assert.equal(inbox.data.emails.length, 1);
  const d = call(world, "buyer", "draft_email", { mailbox: "suppliers", to: ["x@y.example"], subject: "Later", body: "Not yet." });
  assert.equal(world.state.emails.find((e) => e.id === d.data.id).folder, "drafts");
});

test("mark_email and get_email_thread work", () => {
  const world = makeWorld();
  const e = call(world, "manager", "list_emails", { mailbox: "orders", folder: "sent", limit: 1 }).data.emails[0];
  const t = call(world, "support_agent", "get_email_thread", { email_id: e.id });
  assert.equal(t.ok, true);
  assert.ok(t.data.messages.length >= 1);
  assert.equal(call(world, "support_agent", "mark_email", { email_id: e.id, mark: "archive" }).data.folder, "archive");
  assert.equal(call(world, "marketing", "mark_email", { email_id: e.id, mark: "unread" }).error.code, "forbidden");
});

test("chat messages are stamped, threaded and counted on", () => {
  const world = makeWorld();
  const last = world.state.chat_messages.reduce((n, m) => Math.max(n, Number(m.id.split("-")[1])), 0);
  const first = call(world, "finance", "send_chat_message", { channel: "money", text: "Month-end figures are in the tray." });
  assert.equal(first.data.id, `CH-${String(last + 1).padStart(6, "0")}`);
  const reply = call(world, "manager", "send_chat_message", { channel: "money", text: "Thank you.", thread_parent: first.data.id });
  assert.equal(reply.ok, true);
  assert.equal(call(world, "manager", "send_chat_message", { channel: "random", text: "Wrong place.", thread_parent: first.data.id }).error.code, "invalid_input");
  assert.equal(call(world, "finance", "send_chat_message", { channel: "nowhere", text: "x" }).error.code, "not_found");
  assert.equal(call(world, "finance", "send_chat_message", { text: "x" }).error.code, "invalid_input");
  assert.equal(call(world, "finance", "send_chat_message", { channel: "money", text: "x", as: "S-10" }).error.code, "forbidden");
  const dm = call(world, "finance", "send_chat_message", { to: "S-01", as: "S-03", text: "A private word." });
  assert.equal(call(world, "manager", "read_direct_messages", { person: "S-03", with: "S-01" }).data.messages[0].id, dm.data.id);
  const read = call(world, "manager", "read_channel", { channel: "money", limit: 2 });
  assert.equal(read.data.messages[0].at >= read.data.messages[1].at, true);
});

test("social_stats reads for marketing and finance, not for the warehouse", () => {
  const world = makeWorld();
  const r = call(world, "marketing", "social_stats", { network: "squint", days: 7 });
  assert.equal(r.data.squint.days.length, 7);
  assert.ok(r.data.squint.followers_now > 0);
  assert.equal(call(world, "warehouse", "social_stats", {}).error.code, "forbidden");
});

// ---------------------------------------------------------------- the pass of 22 Nov

test("list_channels reports the time of the last message", () => {
  const world = makeWorld();
  const r = call(world, "manager", "list_channels", {});
  for (const c of r.data.channels.filter((x) => x.messages > 0)) {
    assert.match(c.last_at, /^\d{4}-\d\d-\d\dT/);
    const newest = world.state.chat_messages.filter((m) => m.channel === c.channel).reduce((a, m) => (m.at > a ? m.at : a), "");
    assert.equal(c.last_at, newest);
  }
});

test("roles with no person of their own are labelled and have no private messages", () => {
  const world = makeWorld();
  const ai = call(world, "operations_assistant", "send_chat_message", { channel: "general", text: "Stock figures are ready." });
  assert.equal(ai.ok, true);
  const rec = world.state.chat_messages.find((m) => m.id === ai.data.id);
  assert.equal(rec.from, "AI");
  assert.match(rec.from_name, /AI/);
  assert.equal(rec.assistant, true);
  const co = call(world, "coordinator", "send_chat_message", { channel: "general", text: "Hello from the coordinator desk." });
  assert.equal(world.state.chat_messages.find((m) => m.id === co.data.id).from_name, "Coordinator");
  for (const role of ["operations_assistant", "coordinator"]) {
    assert.equal(call(world, role, "read_direct_messages", { person: "S-03" }).error.code, "forbidden");
    assert.equal(call(world, role, "send_chat_message", { to: "S-01", text: "Private?" }).error.code, "forbidden");
  }
  assert.equal(call(world, "operations_assistant", "send_chat_message", { channel: "general", text: "x", as: "S-01" }).error.code, "forbidden");
});

test("read_channel searches, and react_to_chat_message replaces a person's reaction", () => {
  const world = makeWorld();
  const first = call(world, "manager", "send_chat_message", { channel: "random", text: "A quite particular zebra remark." });
  const found = call(world, "warehouse", "read_channel", { channel: "random", search: "particular zebra" });
  assert.equal(found.data.messages.length, 1);
  assert.equal(found.data.messages[0].id, first.data.id);
  assert.equal(call(world, "warehouse", "read_channel", { channel: "random", search: "particular unicorn" }).data.messages.length, 0);
  const r1 = call(world, "warehouse", "react_to_chat_message", { message_id: first.data.id, mark: "thanks" });
  assert.equal(r1.ok, true);
  const r2 = call(world, "warehouse", "react_to_chat_message", { message_id: first.data.id, mark: "ha" });
  assert.equal(r2.data.reactions.filter((x) => x.by === "S-04").length, 1);
  assert.equal(r2.data.reactions.find((x) => x.by === "S-04").mark, "ha");
  assert.equal(call(world, "warehouse", "react_to_chat_message", { message_id: first.data.id, mark: "👍" }).error.code, "invalid_input");
  const dm = call(world, "finance", "send_chat_message", { to: "S-01", as: "S-03", text: "A word." });
  assert.equal(call(world, "marketing", "react_to_chat_message", { message_id: dm.data.id, mark: "seen" }).error.code, "forbidden");
  assert.equal(call(world, "assistant", "react_to_chat_message", { message_id: first.data.id, mark: "seen" }).error.code, "forbidden");
});

test("social summaries carry `by` and any results; like and repost work once per post as the company", () => {
  const world = makeWorld();
  const mine = call(world, "marketing", "create_social_post", { network: "mutter", text: "A plain note." });
  const row = call(world, "manager", "list_social_posts", { limit: 1 }).data.posts[0];
  assert.equal(row.id, mine.data.id);
  assert.equal(row.by, "S-10");
  world.state.social_posts.find((p) => p.id === mine.data.id).reach = 55;
  assert.equal(call(world, "manager", "get_social_post", { post_id: mine.data.id }).data.reach, 55);
  const theirs = call(world, "manager", "list_social_posts", { network: "mutter", mentions_only: true, limit: 1 }).data.posts[0];
  if (!theirs) return;
  const like = call(world, "marketing", "like_social_post", { post_id: theirs.id });
  assert.equal(like.data.likes, theirs.likes + 1);
  assert.equal(call(world, "marketing", "like_social_post", { post_id: theirs.id }).error.code, "already_done");
  const rp = call(world, "marketing", "repost_social_post", { post_id: theirs.id });
  assert.equal(rp.data.reposts, theirs.reposts + 1);
  assert.equal(call(world, "marketing", "repost_social_post", { post_id: theirs.id }).error.code, "already_done");
  assert.equal(call(world, "marketing", "like_social_post", { post_id: mine.data.id }).error.code, "invalid_input");
  assert.equal(call(world, "warehouse", "like_social_post", { post_id: theirs.id }).error.code, "forbidden");
  assert.equal(call(world, "support_agent", "repost_social_post", { post_id: theirs.id }).error.code, "forbidden");
});

test("list_post_pictures lists real pictures when the server provides them, and create_social_post agrees", () => {
  const world = makeWorld();
  world.pictures = [{ path: "img/branded/blip.jpg", product_id: "blip", name: "Blip" }, "img/branded/spare-sock-2.jpg"];
  const r = call(world, "marketing", "list_post_pictures", {});
  assert.equal(r.data.verified, true);
  assert.equal(r.data.total, 2);
  assert.equal(r.data.pictures.find((p) => p.path.includes("spare-sock")).product_id, "spare-sock");
  assert.equal(call(world, "marketing", "list_post_pictures", { product_id: "blip" }).data.total, 1);
  assert.equal(call(world, "marketing", "create_social_post", { network: "squint", text: "x", image: "img/branded/blip.jpg" }).ok, true);
  assert.equal(call(world, "marketing", "create_social_post", { network: "squint", text: "x", image: "img/branded/daypack.jpg" }).error.code, "not_found");
  assert.equal(call(world, "assistant", "list_post_pictures", {}).error.code, "forbidden");
  delete world.pictures;
  assert.equal(call(world, "marketing", "list_post_pictures", {}).data.verified, false);
});

test("send_social_message can start a conversation by the customer's handle", () => {
  const world = makeWorld();
  const post = world.state.social_posts.find((p) => p.author.kind === "customer");
  if (!post) return;
  const r = call(world, "support_agent", "send_social_message", { network: post.network, handle: `@${post.author.handle}`, text: "Hello, thank you for the post." });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(world.state.social_posts.find((p) => p.id === r.data.id).links.customer_id, post.author.customer_id);
  assert.equal(call(world, "support_agent", "send_social_message", { network: "mutter", handle: "nobody_here", text: "Hi" }).error.code, "not_found");
});

test("drafts can be edited, sent as themselves and deleted; mail can be binned and forwarded", () => {
  const world = makeWorld();
  const d = call(world, "buyer", "draft_email", { mailbox: "suppliers", to: ["x@y.example"], subject: "Later", body: "Not yet." });
  const upd = call(world, "buyer", "update_draft", { email_id: d.data.id, to: ["accounts@overthought.example"], subject: "Now", body: "Please pay." });
  assert.equal(upd.ok, true);
  const rec = world.state.emails.find((e) => e.id === d.data.id);
  assert.equal(rec.subject, "Now");
  assert.equal(rec.to[0].address, "accounts@overthought.example");
  assert.equal(call(world, "buyer", "update_draft", { email_id: d.data.id, subject: "  " }).error.code, "invalid_input");
  const count = world.state.emails.length;
  const sent = call(world, "buyer", "send_draft", { email_id: d.data.id });
  assert.equal(sent.ok, true);
  assert.equal(sent.data.id, d.data.id, "the draft itself is sent, not a copy");
  assert.equal(rec.folder, "sent");
  assert.equal(world.state.emails.length, count + 1, "one copy lands in accounts");
  assert.equal(call(world, "buyer", "send_draft", { email_id: d.data.id }).error.code, "invalid_input");
  assert.equal(call(world, "buyer", "update_draft", { email_id: d.data.id, body: "x" }).error.code, "invalid_input");
  const d2 = call(world, "buyer", "draft_email", { mailbox: "suppliers", to: ["x@y.example"], subject: "Scrap", body: "Scrap." });
  assert.equal(call(world, "marketing", "delete_draft", { email_id: d2.data.id }).error.code, "forbidden");
  assert.equal(call(world, "buyer", "delete_draft", { email_id: d2.data.id }).ok, true);
  assert.ok(!world.state.emails.some((e) => e.id === d2.data.id));
  assert.equal(call(world, "buyer", "delete_draft", { email_id: sent.data.id }).error.code, "invalid_input");
  // bin
  const del = call(world, "buyer", "delete_email", { email_id: sent.data.id });
  assert.equal(del.data.folder, "bin");
  assert.equal(call(world, "buyer", "list_emails", { mailbox: "suppliers", folder: "bin" }).data.emails.some((e) => e.id === sent.data.id), true);
  assert.equal(call(world, "buyer", "delete_email", { email_id: sent.data.id }).error.code, "invalid_input");
  assert.equal(call(world, "marketing", "delete_email", { email_id: sent.data.id }).error.code, "forbidden");
  // forward
  const src = call(world, "manager", "list_emails", { mailbox: "orders", folder: "sent", limit: 1 }).data.emails[0];
  const fw = call(world, "support_agent", "forward_email", { email_id: src.id, mailbox: "hello", to: ["hudson@overthought.example"], body: "For you." });
  assert.equal(fw.ok, true, JSON.stringify(fw));
  const f = world.state.emails.find((e) => e.id === fw.data.id);
  assert.match(f.subject, /^Fwd: /);
  assert.ok(f.body.startsWith("For you.") && f.body.includes("Forwarded message") && f.body.includes(src.subject));
  assert.notEqual(f.thread_id, src.thread_id);
  assert.ok(world.state.emails.some((e) => e.mailbox === "hudson" && e.folder === "inbox" && e.subject === f.subject), "the forward lands in Mrs Hudson's inbox");
  assert.equal(call(world, "warehouse", "forward_email", { email_id: src.id, mailbox: "accounts", to: ["x@y.example"] }).error.code, "forbidden");
  assert.equal(call(world, "marketing", "forward_email", { email_id: src.id, mailbox: "press", to: ["x@y.example"] }).error.code, "forbidden");
  assert.equal(call(world, "assistant", "update_draft", { email_id: d.data.id, body: "x" }).error.code, "forbidden");
});
