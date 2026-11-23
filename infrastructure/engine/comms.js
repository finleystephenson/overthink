// Mail, staff chat and two social accounts: record types and tools. An extension of engine.js.
//
// Records (see docs/comms.md for the full shapes):
//   emails              threads in mailboxes (hello, orders, suppliers, accounts, press, and one box per person)
//   chat_messages       staff chat: seven channels and private messages between two people
//   social_posts        posts, comments, replies and private messages on two networks, squint and mutter
//   social_stats_daily  followers, reach and engagement per network per day
// Outside messages are written by business/builder/world/comms.mjs from the business records. The tools here let a person
// or an AI read them and add their own, under the same role rules as everything else.
import { extend, kit } from "./engine.js";

const { fail, nextId, stamp, ms, dateOf, tokens, matches, schema: { str, bool, obj, strs }, roles } = kit;
const int = { type: "integer" };

const DOMAIN = "overthought.example";
const SHOP_NAME = "Overthought & Co.";
const SHOP_HANDLE = "overthoughtco";
const AI_NAME = "Operations assistant (AI)";
const ROLE_ONLY_NAMES = { coordinator: "Coordinator" };

/** Who is who. Matches business/data/staff.json (a test checks that). A mailbox is the last word of the name. */
export const ROSTER = [
  { id: "S-01", name: "Mr Fezziwig", role: "manager", box: "fezziwig" },
  { id: "S-02", name: "Ebenezer Scrooge", role: "finance", box: "scrooge" },
  { id: "S-03", name: "Bob Cratchit", role: "finance", box: "cratchit" },
  { id: "S-04", name: "Phileas Fogg", role: "warehouse", box: "fogg" },
  { id: "S-05", name: "Mole", role: "warehouse", box: "mole" },
  { id: "S-06", name: "Mrs Hudson", role: "support_lead", box: "hudson" },
  { id: "S-07", name: "Sam Weller", role: "support_agent", box: "weller" },
  { id: "S-08", name: "Esther Summerson", role: "support_agent", box: "summerson" },
  { id: "S-09", name: "Robinson Crusoe", role: "buyer", box: "crusoe" },
  { id: "S-10", name: "Mr Toad", role: "marketing", box: "toad" },
  { id: "S-11", name: "Hephaestus", role: "technician", box: "hephaestus" },
];

/** Shared mailboxes and the roles that work them. WHY: the person who answers customers should not read the finance box. */
export const SHARED_BOXES = {
  hello: { label: "Customers write here", roles: ["support_agent", "support_lead", "manager", "marketing"] },
  orders: { label: "Order and dispatch notes", roles: ["warehouse", "support_agent", "support_lead", "manager", "coordinator"] },
  suppliers: { label: "Suppliers and purchase orders", roles: ["buyer", "warehouse", "manager", "finance", "coordinator"] },
  accounts: { label: "Invoices and payments", roles: ["finance", "manager", "buyer"] },
  press: { label: "Press and partnerships", roles: ["marketing", "manager"] },
};

export const CHANNELS = {
  general: "Everyone, notices and good mornings",
  orders: "Orders, dispatch and parcels",
  stockroom: "Stock, deliveries, purchase orders and repairs",
  customers: "Complaints, reviews and customers",
  money: "Takings, costs and month-end",
  marketing: "Campaigns, posts and newsletters",
  random: "Everything else",
};

/**
 * Who may read and post in each channel. WHY: a small firm still keeps the money talk with finance and the manager,
 * and the customer channel away from people who never deal with customers. Matches who has ever posted where in the
 * history (a test checks that), so no one is shut out of a conversation they took part in. The manager and the
 * operations assistant see every channel (SEE_ALL below).
 */
export const CHANNEL_ROLES = {
  general: [...roles.INTERNAL],
  random: [...roles.INTERNAL],
  orders: ["warehouse", "support_agent", "support_lead", "buyer", "finance", "marketing", "coordinator"],
  stockroom: ["warehouse", "buyer", "finance", "technician", "marketing", "coordinator"],
  customers: ["support_agent", "support_lead", "warehouse", "marketing", "finance", "technician", "coordinator"],
  money: ["finance"],
  marketing: ["marketing", "support_lead", "finance", "warehouse"],
};

const NETWORKS = ["squint", "mutter"];
const NETWORK_LIMITS = { squint: 2200, mutter: 280 };
/** Roles that can read everything internal: the manager and the operations assistant. */
const SEE_ALL = ["manager", "operations_assistant"];
const MAX_LIST = 100;
const IMAGE_PATTERN = /^img\/branded\/[a-z0-9-]+\.jpg$/;

// ---------------------------------------------------------------- shared helpers

const COLLECTION = { EM: "emails", CH: "chat_messages", SP: "social_posts" };

/**
 * The next id for EM, CH or SP. WHY: the simulator appends derived records without touching the counters,
 * so the counter is first lifted to the highest id actually in the state.
 */
function freshId(ctx, prefix) {
  const highest = ctx.st[COLLECTION[prefix]].reduce((n, r) => Math.max(n, Number(String(r.id).split("-")[1]) || 0), 0);
  ctx.st.counters[prefix] = Math.max(ctx.st.counters[prefix] || 0, highest);
  return nextId(ctx, prefix, 6);
}

const staffById = (id) => ROSTER.find((p) => p.id === id);
export { staffById };
const mailboxIds = () => [...Object.keys(SHARED_BOXES), ...ROSTER.map((p) => p.box)];

/** Can this role open this mailbox? Shared boxes by role; a personal box only by its owner's role, the manager or the operations assistant. */
export function canUseMailbox(role, box) {
  if (SHARED_BOXES[box]) return SEE_ALL.includes(role) || SHARED_BOXES[box].roles.includes(role);
  const owner = ROSTER.find((p) => p.box === box);
  if (!owner) return false;
  return SEE_ALL.includes(role) || owner.role === role;
}

function needMailbox(ctx, box) {
  if (!box || !mailboxIds().includes(box)) fail("not_found", `There is no mailbox called "${box}". Look at the list of mailboxes.`);
  if (!canUseMailbox(ctx.role, box)) fail("forbidden", `The ${ctx.role} role cannot use the ${box} mailbox.`);
  return box;
}

const addressOf = (box) => `${box}@${DOMAIN}`;

function boxOfAddress(addr) {
  const m = String(addr).toLowerCase().match(/^([a-z0-9.-]+)@overthought\.example$/);
  return m && mailboxIds().includes(m[1]) ? m[1] : null;
}

/**
 * The person speaking: `as` when given and allowed, else the first person with the caller's role.
 * Roles with no person of their own are never passed off as one: the coordinator role (staff.json has no
 * coordinator) speaks as "Coordinator", and the operations assistant as "Operations assistant (AI)", both
 * flagged `assistant` or `role_only`, so an app can label them as what they are.
 */
function speaker(ctx, as) {
  if (as) {
    const p = staffById(as) || fail("not_found", `There is no staff member ${as}.`);
    if (p.role !== ctx.role && ctx.role !== "manager") fail("forbidden", `The ${ctx.role} role cannot speak as ${p.name}.`);
    return { id: p.id, name: p.name };
  }
  const own = ROSTER.find((p) => p.role === ctx.role);
  if (own) return { id: own.id, name: own.name };
  if (ctx.role === "operations_assistant") return { id: "AI", name: AI_NAME, assistant: true };
  return { id: ctx.role, name: ROLE_ONLY_NAMES[ctx.role] || ctx.role, role_only: true };
}

/** True for a speaker who is a staff member with a private inbox. */
const isPerson = (who) => !!staffById(who.id);

function limitOf(i, fallback = 25) {
  return Math.min(MAX_LIST, Math.max(1, i.limit || fallback));
}

/** Newest first, optionally only records older than `before` (an ISO date or time). */
function newestFirst(list, before) {
  const cutoff = before ? ms(before.length === 10 ? `${before}T00:00:00Z` : before) : Infinity;
  return list.filter((r) => ms(r.at) < cutoff).sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
}

function needText(text, what, max) {
  const t = String(text ?? "").trim();
  if (!t) fail("invalid_input", `${what} cannot be empty.`);
  if (t.length > max) fail("invalid_input", `${what} is too long (${t.length} characters; the most is ${max}).`);
  return t;
}

const snippet = (text) => (text.length > 160 ? `${text.slice(0, 157)}...` : text);

// ---------------------------------------------------------------- mail

function emailSummary(e) {
  return { id: e.id, thread_id: e.thread_id, mailbox: e.mailbox, folder: e.folder, from: e.from, to: e.to, subject: e.subject, at: e.at, read: e.read, snippet: snippet(e.body), links: e.links };
}

function parseAddresses(list, what) {
  if (!Array.isArray(list) || !list.length) fail("invalid_input", `${what} needs at least one address.`);
  return list.map((a) => {
    const text = String(a).trim();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(text)) fail("invalid_input", `"${a}" is not an email address.`);
    return text.toLowerCase();
  });
}

/** A name for an address: staff and customers we know, else the address itself. */
function partyFor(ctx, addr) {
  const box = boxOfAddress(addr);
  if (box) {
    const p = ROSTER.find((x) => x.box === box);
    return { name: p ? p.name : SHOP_NAME, address: addr };
  }
  const c = ctx.st.customers.find((x) => String(x.email).toLowerCase() === addr);
  return { name: c ? c.name : addr, address: addr };
}

/** Finds the customer behind an address, so a reply can be linked and the contact marked answered. */
function customerByAddress(ctx, addr) {
  return ctx.st.customers.find((x) => String(x.email).toLowerCase() === addr) || null;
}

/** A reply to a customer who wrote in by email counts as the first answer to their contact. Kept minimal on purpose. */
function markContactAnswered(ctx, contactId, customerId) {
  const contacts = ctx.st.contacts || [];
  let c = contactId ? contacts.find((x) => x.id === contactId) : null;
  if (!c && customerId) c = contacts.filter((x) => x.customer_id === customerId && x.channel === "email" && x.first_reply_minutes == null).pop();
  if (!c || (c.first_reply_minutes !== null && c.first_reply_minutes !== undefined)) return;
  c.first_reply_minutes = Math.max(0, Math.round((ms(ctx.now) - ms(c.at)) / 60000));
  ctx.changes.push(`contact ${c.id} first_reply_minutes → ${c.first_reply_minutes}`);
}

/** Shared by send_email and draft_email: checks the input and builds the record. */
function buildEmail(ctx, i, folder) {
  const box = needMailbox(ctx, i.mailbox);
  let parent = null;
  if (i.reply_to_id) {
    parent = ctx.st.emails.find((e) => e.id === i.reply_to_id) || fail("not_found", `No email ${i.reply_to_id}.`);
    if (!canUseMailbox(ctx.role, parent.mailbox)) fail("forbidden", `The ${ctx.role} role cannot use the ${parent.mailbox} mailbox.`);
  }
  const toList = i.to && i.to.length ? i.to : parent ? [parent.folder === "sent" ? parent.to[0].address : parent.from.address] : null;
  const to = parseAddresses(toList, "to");
  const cc = i.cc && i.cc.length ? parseAddresses(i.cc, "cc") : [];
  const subject = needText(i.subject || (parent ? (/^re:/i.test(parent.subject) ? parent.subject : `Re: ${parent.subject}`) : ""), "The subject", 200);
  const body = needText(i.body, "The body", 20000);
  const sender = speaker(ctx, null);
  const id = freshId(ctx, "EM");
  const customer = to.map((a) => customerByAddress(ctx, a)).find(Boolean);
  const links = { ...(parent ? parent.links : {}) };
  if (customer && !links.customer_id) links.customer_id = customer.id;
  if (i.links?.campaign_id) {
    const id = String(i.links.campaign_id);
    if (!(ctx.st.campaigns || []).some((c) => c.id === id)) fail("not_found", `There is no campaign ${id}.`);
    links.campaign_id = id;
  }
  return {
    id, key: `tool|${id}`, thread_id: parent ? parent.thread_id : `TH-${id}`, mailbox: box, folder,
    from: { name: SHARED_BOXES[box] ? (ROSTER.find((p) => p.id === sender.id)?.name || SHOP_NAME) : partyFor(ctx, addressOf(box)).name, address: addressOf(box) },
    to: to.map((a) => partyFor(ctx, a)), cc: cc.map((a) => partyFor(ctx, a)), subject, body, at: stamp(ctx), read: true,
    by: sender.id === "AI" ? null : sender.id, links,
  };
}

/** Puts a copy of an email the company sent into the inbox of any of our own boxes it was addressed to. */
function deliverInside(ctx, email) {
  for (const p of [...email.to, ...email.cc]) {
    const box = boxOfAddress(p.address);
    if (!box || box === email.mailbox) continue;
    const id = freshId(ctx, "EM");
    ctx.st.emails.push({ ...email, id, key: `tool|${id}`, mailbox: box, folder: "inbox", read: false });
    ctx.changes.push(`email ${id} delivered to ${box}`);
  }
}

const MAIL_READ = roles.INTERNAL;
const MAIL_WRITE = roles.INTERNAL;

const MAIL_TOOLS = [
  {
    name: "list_mailboxes", roles: MAIL_READ,
    description: "The mailboxes this role may open (shared ones such as hello, orders, suppliers, accounts, press, and personal ones), with how many emails and how many unread.",
    input_schema: obj({}),
    run(ctx) {
      const out = mailboxIds().filter((b) => canUseMailbox(ctx.role, b)).map((b) => {
        const mine = ctx.st.emails.filter((e) => e.mailbox === b);
        const owner = ROSTER.find((p) => p.box === b);
        return { mailbox: b, address: addressOf(b), label: SHARED_BOXES[b] ? SHARED_BOXES[b].label : `${owner.name}'s own box`, total: mine.length, unread: mine.filter((e) => e.folder === "inbox" && !e.read).length };
      });
      return { mailboxes: out };
    },
  },
  {
    name: "list_emails", roles: MAIL_READ,
    description: "Emails in one mailbox, newest first. Filter by folder (inbox, sent, drafts, junk, archive, bin), unread only, a search word or phrase (subject, sender and body), and a limit (default 25, at most 100). `before` (a date or time) pages back. Each row has a short snippet; use get_email_thread for the whole conversation.",
    input_schema: obj({ mailbox: str, folder: { type: "string", enum: ["inbox", "sent", "drafts", "junk", "archive", "bin"] }, unread: bool, search: str, limit: int, before: str }, ["mailbox"]),
    run(ctx, i) {
      const box = needMailbox(ctx, i.mailbox);
      const words = i.search ? tokens(i.search) : [];
      const list = ctx.st.emails.filter((e) => e.mailbox === box && (!i.folder || e.folder === i.folder) && (!i.unread || (!e.read && e.folder === "inbox")) &&
        (!words.length || matches(`${e.subject} ${e.from.name} ${e.from.address} ${e.body}`, words)));
      const rows = newestFirst(list, i.before);
      return { total: rows.length, emails: rows.slice(0, limitOf(i)).map(emailSummary) };
    },
  },
  {
    name: "get_email_thread", roles: MAIL_READ,
    description: "A whole email conversation, oldest first, as it sits in one mailbox. Give an email id (EM-...) or a thread_id plus the mailbox.",
    input_schema: obj({ email_id: str, thread_id: str, mailbox: str }),
    run(ctx, i) {
      let thread = i.thread_id, box = i.mailbox;
      if (i.email_id) {
        const e = ctx.st.emails.find((x) => x.id === i.email_id) || fail("not_found", `No email ${i.email_id}.`);
        thread = e.thread_id; box = e.mailbox;
      }
      if (!thread || !box) fail("invalid_input", "Say which email, or give a conversation and a mailbox.");
      needMailbox(ctx, box);
      const msgs = ctx.st.emails.filter((e) => e.thread_id === thread && e.mailbox === box).sort((a, b) => (a.at < b.at ? -1 : 1));
      if (!msgs.length) fail("not_found", `No thread ${thread} in ${box}.`);
      return { thread_id: thread, mailbox: box, subject: msgs[0].subject, messages: msgs };
    },
  },
  {
    name: "send_email", roles: MAIL_WRITE,
    description: "Sends an email from a mailbox this role may use. New mail needs to, subject and body. To reply, give reply_to_id (the subject and the recipient are filled in if left out). A reply to a customer who wrote in by email marks their contact as answered. Mail to our own addresses lands in that mailbox. Give links.campaign_id to make the mail part of one of our campaigns (its visits and orders then count there). Nothing leaves the simulated company.",
    input_schema: obj({ mailbox: str, to: strs, cc: strs, subject: str, body: str, reply_to_id: str, links: obj({ campaign_id: str }) }, ["mailbox", "body"]),
    // WHY: a reply is the moment a customer's first answer is recorded, so response times in the reports are true.
    run(ctx, i) {
      const e = buildEmail(ctx, i, "sent");
      ctx.st.emails.push(e);
      ctx.changes.push(`email ${e.id} sent from ${e.mailbox} to ${e.to.map((p) => p.address).join(", ")}`);
      afterSend(ctx, e);
      return { id: e.id, thread_id: e.thread_id, at: e.at };
    },
  },
  {
    name: "draft_email", roles: MAIL_WRITE,
    description: "Saves an email in the drafts folder of a mailbox this role may use, without sending it. Same inputs as send_email.",
    input_schema: obj({ mailbox: str, to: strs, cc: strs, subject: str, body: str, reply_to_id: str }, ["mailbox", "body"]),
    run(ctx, i) {
      const e = buildEmail(ctx, i, "drafts");
      ctx.st.emails.push(e);
      ctx.changes.push(`email ${e.id} saved as a draft in ${e.mailbox}`);
      return { id: e.id, thread_id: e.thread_id, folder: "drafts" };
    },
  },
  {
    name: "mark_email", roles: MAIL_WRITE,
    description: "Marks an email as read or unread, or moves it to the archive or the junk folder (or back to the inbox).",
    input_schema: obj({ email_id: str, mark: { type: "string", enum: ["read", "unread", "archive", "junk", "inbox"] } }, ["email_id", "mark"]),
    run(ctx, i) {
      const e = ctx.st.emails.find((x) => x.id === i.email_id) || fail("not_found", `No email ${i.email_id}.`);
      needMailbox(ctx, e.mailbox);
      if (i.mark === "read" || i.mark === "unread") e.read = i.mark === "read";
      else { e.folder = i.mark; if (i.mark !== "inbox") e.read = true; }
      ctx.changes.push(`email ${e.id} marked ${i.mark}`);
      return { id: e.id, folder: e.folder, read: e.read };
    },
  },
];

// ---------------------------------------------------------------- chat

const dmKey = (a, b) => [a, b].sort().join("|");

function needChannel(name, role) {
  if (!CHANNELS[name]) fail("not_found", `There is no channel #${name}. Channels: ${Object.keys(CHANNELS).join(", ")}.`);
  if (role && !canUseChannel(role, name)) fail("forbidden", `The ${role} role is not in #${name}.`);
  return name;
}

/** True when this role may read and post in the channel. */
export function canUseChannel(role, name) {
  return SEE_ALL.includes(role) || !!CHANNEL_ROLES[name]?.includes(role);
}

/** A person may read direct messages that involve their own role; the manager may read any. The coordinator and the operations assistant have no person of their own, so they read none. */
function canReadDm(role, personId) {
  const p = staffById(personId);
  if (!p) fail("not_found", `There is no staff member ${personId}.`);
  // WHY: a role with no person of its own (coordinator, operations assistant) has no private messages to read, and may not read anyone else's.
  if (role !== "manager" && p.role !== role) fail("forbidden", `The ${role} role cannot read ${p.name}'s direct messages.`);
}

const CHAT_TOOLS = [
  {
    name: "list_channels", roles: roles.INTERNAL,
    description: "The staff chat channels (#general, #orders, #stockroom, #customers, #money, #marketing, #random) that this role is in, with what each is for, how many messages and when the last one was. Money talk is for finance and the manager; each channel has its own members.",
    input_schema: obj({}),
    run(ctx) {
      return { channels: Object.entries(CHANNELS).filter(([name]) => canUseChannel(ctx.role, name)).map(([name, about]) => {
        const msgs = ctx.st.chat_messages.filter((m) => m.channel === name);
        return { channel: name, about, messages: msgs.length, last_at: msgs.reduce((t, m) => (t === null || m.at > t ? m.at : t), null) };
      }) };
    },
  },
  {
    name: "read_channel", roles: roles.INTERNAL,
    description: "Messages in one channel, newest first. limit defaults to 30 (at most 100); `before` (a date or time) pages back; `search` keeps only messages containing every word given.",
    input_schema: obj({ channel: str, limit: int, before: str, search: str }, ["channel"]),
    run(ctx, i) {
      const ch = needChannel(i.channel, ctx.role);
      const words = i.search ? tokens(i.search) : [];
      const rows = newestFirst(ctx.st.chat_messages.filter((m) => m.channel === ch && (!words.length || matches(`${m.text} ${m.from_name}`, words))), i.before);
      return { channel: ch, total: rows.length, messages: rows.slice(0, limitOf(i, 30)) };
    },
  },
  {
    name: "send_chat_message", roles: roles.INTERNAL,
    description: "Posts in a channel (channel) or sends a private message to one person (to, a staff id such as S-03). Optional: thread_parent (a message id to answer) and as (a staff id with your role; the manager may speak as anyone).",
    input_schema: obj({ channel: str, to: str, text: str, thread_parent: str, as: str }, ["text"]),
    run(ctx, i) {
      if (!i.channel === !i.to) fail("invalid_input", "Give either a channel or a person to send to, not both.");
      const text = needText(i.text, "The message", 2000);
      const who = speaker(ctx, i.as);
      const id = freshId(ctx, "CH");
      const rec = { id, key: `tool|${id}`, channel: null, dm: null, from: who.id, from_name: who.name, text, at: stamp(ctx), parent_key: null, thread_parent: null, reactions: [], links: {} };
      if (rec.assistant === undefined && who.assistant) rec.assistant = true;
      if (who.role_only) rec.role_only = true;
      if (i.channel) rec.channel = needChannel(i.channel, ctx.role);
      else {
        if (!isPerson(who)) fail("forbidden", `The ${ctx.role} role has no person of its own, so it cannot send private messages. Post in a channel.`);
        if (!staffById(i.to)) fail("not_found", `There is no staff member ${i.to}.`);
        if (i.to === who.id) fail("invalid_input", "That is you. Send it to someone else.");
        rec.dm = [who.id, i.to].sort();
      }
      if (i.thread_parent) {
        const p = ctx.st.chat_messages.find((m) => m.id === i.thread_parent) || fail("not_found", `No message ${i.thread_parent}.`);
        if ((p.channel || null) !== rec.channel || (p.dm ? dmKey(...p.dm) : null) !== (rec.dm ? dmKey(...rec.dm) : null)) fail("invalid_input", "The message you are answering is somewhere else.");
        rec.thread_parent = p.id; rec.parent_key = p.key;
      }
      ctx.st.chat_messages.push(rec);
      ctx.changes.push(`chat message ${id} sent in ${rec.channel ? `#${rec.channel}` : `a private message to ${i.to}`}`);
      return { id, at: rec.at };
    },
  },
  {
    name: "read_direct_messages", roles: roles.INTERNAL,
    description: "Private messages involving one person (person, a staff id), newest first; give `with` to see only the conversation with one other person, and `search` to keep only messages containing every word given. You may read your own role's messages; the manager and the operations assistant may read any.",
    input_schema: obj({ person: str, with: str, limit: int, before: str, search: str }, ["person"]),
    run(ctx, i) {
      canReadDm(ctx.role, i.person);
      if (i.with && !staffById(i.with) && i.with !== "AI") fail("not_found", `There is no staff member ${i.with}.`);
      const words = i.search ? tokens(i.search) : [];
      const mine = ctx.st.chat_messages.filter((m) => m.dm && m.dm.includes(i.person) && (!i.with || m.dm.includes(i.with)) && (!words.length || matches(`${m.text} ${m.from_name}`, words)));
      const rows = newestFirst(mine, i.before);
      return { total: rows.length, messages: rows.slice(0, limitOf(i, 30)) };
    },
  },
];

// ---------------------------------------------------------------- social

/** Only pictures that belong to a product: img/branded/<product id>[-more].jpg, or an accessory (acc-...). */
function needImage(ctx, image) {
  const listed = picturesOf(ctx);
  if (listed.verified) {
    if (!listed.pictures.some((p) => p.path === image)) fail("not_found", `There is no product picture ${image}. Look at the list of post pictures.`);
    return image;
  }
  if (!IMAGE_PATTERN.test(image)) fail("invalid_input", "The image must be a product picture such as img/branded/blip.jpg.");
  const name = image.slice("img/branded/".length, -4);
  const known = name.startsWith("acc-") || ctx.world.products.some((p) => name === p.id || name.startsWith(`${p.id}-`));
  if (!known) fail("not_found", `There is no product picture ${image}.`);
  return image;
}

/**
 * Every picture a post may use. The server sets `world.pictures` (strings or { path, product_id, name }) from the files that exist
 * (see listPictures in business/builder/world/comms-data.mjs). Without it the list comes from the product records alone and is marked unverified.
 */
function picturesOf(ctx) {
  const given = ctx.world.pictures;
  const products = ctx.world.products || [];
  const nameOf = (id) => products.find((p) => p.id === id)?.name || id;
  if (Array.isArray(given) && given.length) {
    const pictures = given.map((g) => {
      const path = typeof g === "string" ? g : g.path;
      const name = path.slice("img/branded/".length, -4);
      const pid = (typeof g === "object" && g.product_id) || products.map((p) => p.id).filter((id) => name === id || name.startsWith(`${id}-`)).sort((a, b) => b.length - a.length)[0] || null;
      return { path, product_id: pid, name: (typeof g === "object" && g.name) || (pid ? nameOf(pid) : name) };
    });
    return { verified: true, pictures };
  }
  const pictures = [];
  for (const p of products) {
    for (const a of p.accessories || []) if (a.image) pictures.push({ path: a.image, product_id: p.id, name: a.name || p.name });
    if (p.image?.file) pictures.push({ path: p.image.file, product_id: p.id, name: p.name });
  }
  return { verified: false, pictures };
}

function needNetwork(n) {
  if (!NETWORKS.includes(n)) fail("invalid_input", `The network must be one of: ${NETWORKS.join(", ")}.`);
  return n;
}

const companyAuthor = () => ({ kind: "company", name: SHOP_NAME, handle: SHOP_HANDLE });
const SOCIAL_WRITERS = ["marketing", "manager", "support_agent", "support_lead"];

function socialRecord(ctx, i, kind) {
  const who = speaker(ctx, null);
  const id = freshId(ctx, "SP");
  return {
    id, key: `tool|${id}`, network: i.network, author: companyAuthor(), kind, text: i.text, image: null, at: stamp(ctx), likes: 0, reposts: 0,
    parent_key: null, parent: null, thread: null, by: who.id === "AI" ? null : who.id, mentions_shop: false, links: {},
  };
}

function postSummary(p) {
  const out = { id: p.id, network: p.network, kind: p.kind, author: p.author, text: p.text, image: p.image, at: p.at, likes: p.likes, reposts: p.reposts, parent: p.parent, mentions_shop: p.mentions_shop, by: p.by || null, links: p.links };
  // Results the simulator adds to posts made through the tools are passed on as they are.
  for (const k of ["audience", "reach", "visits", "orders", "results", "liked_by_shop", "reposted_by_shop"]) if (p[k] !== undefined) out[k] = p[k];
  return out;
}

const SOCIAL_TOOLS = [
  {
    name: "list_social_posts", roles: roles.INTERNAL,
    description: "Posts on squint (photo sharing) and mutter (short posts), newest first: the company's own, customers' posts, comments and replies (not private messages). Filter by network, kind (post, comment, reply) and mentions_only (customers' posts that tag the shop). Default 25, at most 100; `before` pages back.",
    input_schema: obj({ network: str, kind: { type: "string", enum: ["post", "comment", "reply"] }, mentions_only: bool, limit: int, before: str }),
    run(ctx, i) {
      if (i.network) needNetwork(i.network);
      const list = ctx.st.social_posts.filter((p) => p.kind !== "dm" && (!i.network || p.network === i.network) && (!i.kind || p.kind === i.kind) && (!i.mentions_only || p.mentions_shop));
      const rows = newestFirst(list, i.before);
      return { total: rows.length, posts: rows.slice(0, limitOf(i)).map(postSummary) };
    },
  },
  {
    name: "get_social_post", roles: roles.INTERNAL,
    description: "One post with its comments and replies, oldest first.",
    input_schema: obj({ post_id: str }, ["post_id"]),
    run(ctx, i) {
      const p = ctx.st.social_posts.find((x) => x.id === i.post_id && x.kind !== "dm") || fail("not_found", `No post ${i.post_id}.`);
      const comments = ctx.st.social_posts.filter((x) => x.parent === p.id).sort((a, b) => (a.at < b.at ? -1 : 1)).map(postSummary);
      return { ...postSummary(p), comments };
    },
  },
  {
    name: "create_social_post", roles: ["marketing", "manager"],
    description: "Posts as the company. squint needs a product picture (image, such as img/branded/blip.jpg) and takes up to 2,200 characters; mutter takes up to 280 and may have a picture. Optional links: product_id and campaign_id. Brand voice: plain, exact, one honest caveat, no exclamation marks.",
    input_schema: obj({ network: str, text: str, image: str, product_id: str, campaign_id: str }, ["network", "text"]),
    run(ctx, i) {
      needNetwork(i.network);
      const text = needText(i.text, "The post", NETWORK_LIMITS[i.network]);
      if (i.network === "squint" && !i.image) fail("invalid_input", "A squint post needs a picture.");
      const p = socialRecord(ctx, { ...i, text }, "post");
      if (i.image) p.image = needImage(ctx, i.image);
      if (i.product_id) { if (!ctx.world.products.some((x) => x.id === i.product_id)) fail("not_found", `No product ${i.product_id}.`); p.links.product_id = i.product_id; }
      if (i.campaign_id) { if (!ctx.st.campaigns.some((x) => x.id === i.campaign_id)) fail("not_found", `No campaign ${i.campaign_id}.`); p.links.campaign_id = i.campaign_id; }
      ctx.st.social_posts.push(p);
      ctx.changes.push(`${p.network} post ${p.id} published`);
      return { id: p.id, at: p.at };
    },
  },
  {
    name: "reply_social_post", roles: SOCIAL_WRITERS,
    description: "Replies, as the company, to a post, comment or reply (not a private message; use send_social_message for those).",
    input_schema: obj({ post_id: str, text: str }, ["post_id", "text"]),
    run(ctx, i) {
      const parent = ctx.st.social_posts.find((x) => x.id === i.post_id && x.kind !== "dm") || fail("not_found", `No post ${i.post_id}.`);
      const text = needText(i.text, "The reply", NETWORK_LIMITS[parent.network]);
      const p = socialRecord(ctx, { network: parent.network, text }, "reply");
      p.parent = parent.id; p.parent_key = parent.key; p.links = { ...parent.links };
      ctx.st.social_posts.push(p);
      ctx.changes.push(`${p.network} reply ${p.id} to ${parent.id}`);
      return { id: p.id, at: p.at };
    },
  },
  {
    name: "list_social_messages", roles: roles.INTERNAL,
    description: "Private messages on squint and mutter, grouped into conversations (newest first). Give `thread` to read one conversation in full. Filter by network. Default 25 conversations.",
    input_schema: obj({ network: str, thread: str, limit: int }),
    run(ctx, i) {
      if (i.network) needNetwork(i.network);
      const dms = ctx.st.social_posts.filter((p) => p.kind === "dm" && (!i.network || p.network === i.network));
      if (i.thread) {
        const msgs = dms.filter((p) => p.thread === i.thread).sort((a, b) => (a.at < b.at ? -1 : 1));
        if (!msgs.length) fail("not_found", `No conversation ${i.thread}.`);
        return { thread: i.thread, messages: msgs.map(postSummary) };
      }
      const by = new Map();
      for (const m of dms) { if (!by.has(m.thread)) by.set(m.thread, []); by.get(m.thread).push(m); }
      const rows = [...by.entries()].map(([thread, ms2]) => {
        const last = ms2.reduce((a, b) => (a.at > b.at ? a : b));
        // WHY: a thread the shop started has no customer message yet, so `with` comes from the customer it is linked to.
        const first = ms2.find((m) => m.author.kind !== "company");
        const linked = ms2.map((m) => m.links?.customer_id).find(Boolean);
        const customer = linked ? ctx.st.customers.find((c) => c.id === linked) : null;
        const who = first ? first.author : customer ? { kind: "customer", name: customer.name, handle: null, customer_id: customer.id } : ms2[0].author;
        return { thread, network: last.network, with: who, messages: ms2.length, last_at: last.at, last_text: snippet(last.text), answered: ms2.some((m) => m.author.kind === "company") };
      }).sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
      return { total: rows.length, conversations: rows.slice(0, limitOf(i)) };
    },
  },
  {
    name: "send_social_message", roles: SOCIAL_WRITERS,
    description: "Sends a private message as the company: into an existing conversation (thread) or to a customer (network plus customer_id, or network plus the customer's handle) to start one.",
    input_schema: obj({ thread: str, network: str, customer_id: str, handle: str, text: str }, ["text"]),
    run(ctx, i) {
      let network = i.network, thread = i.thread, links = {};
      if (thread) {
        const t = ctx.st.social_posts.find((p) => p.kind === "dm" && p.thread === thread) || fail("not_found", `No conversation ${thread}.`);
        network = t.network; links = { ...t.links };
      } else {
        needNetwork(network);
        let customerId = i.customer_id;
        if (!customerId && i.handle) {
          const h = String(i.handle).replace(/^@/, "").toLowerCase();
          customerId = ctx.st.social_posts.find((x) => x.author?.kind === "customer" && String(x.author.handle).toLowerCase() === h)?.author.customer_id;
          if (!customerId) fail("not_found", `No customer with the handle ${i.handle}.`);
        }
        const c = ctx.st.customers.find((x) => x.id === customerId) || fail("not_found", `No customer ${customerId}. Give a conversation, or a network and the customer.`);
        thread = `dm-${network}-${c.id}-${dateOf(ms(ctx.now))}`; links = { customer_id: c.id };
      }
      const text = needText(i.text, "The message", NETWORK_LIMITS[network]);
      const p = socialRecord(ctx, { network, text }, "dm");
      p.thread = thread; p.links = links;
      ctx.st.social_posts.push(p);
      ctx.changes.push(`${network} message ${p.id} in ${thread}`);
      return { id: p.id, thread, at: p.at };
    },
  },
  {
    name: "social_stats", roles: roles.MARKETING_READERS,
    description: "Followers, reach and engagement per day for squint and mutter, newest first. Give network, and days (default 30, at most 366). Includes today's follower totals.",
    input_schema: obj({ network: str, days: int }),
    run(ctx, i) {
      if (i.network) needNetwork(i.network);
      const days = Math.min(366, Math.max(1, i.days || 30));
      const rows = ctx.st.social_stats_daily.filter((r) => !i.network || r.network === i.network).sort((a, b) => (a.date < b.date ? 1 : -1));
      const out = {};
      for (const n of i.network ? [i.network] : NETWORKS) {
        const mine = rows.filter((r) => r.network === n);
        out[n] = { followers_now: mine.length ? mine[0].followers : 0, days: mine.slice(0, days).map(({ date, followers, reach, engagement, posts }) => ({ date, followers, reach, engagement, posts })) };
      }
      return out;
    },
  },
];

// ---------------------------------------------------------------- later additions: drafts, forwarding, likes, reactions, pictures

/** What happens after a company email leaves: copies land in our own boxes, and a reply to a customer marks their contact answered. */
function afterSend(ctx, e) {
  deliverInside(ctx, e);
  const answered = e.to.map((p) => customerByAddress(ctx, p.address)).find(Boolean);
  if (answered || e.links.contact_id) markContactAnswered(ctx, e.links.contact_id, answered ? answered.id : e.links.customer_id);
}

function needDraft(ctx, id) {
  const e = ctx.st.emails.find((x) => x.id === id) || fail("not_found", `No email ${id}.`);
  needMailbox(ctx, e.mailbox);
  if (e.folder !== "drafts") fail("invalid_input", `${id} is not a draft.`);
  return e;
}

const REACTION_WORDS = ["noted", "thanks", "seen", "ha", "good", "agreed"];

const EXTRA_TOOLS = [
  {
    name: "update_draft", roles: MAIL_WRITE,
    description: "Edits a draft: any of to, cc, subject and body. Only drafts can be edited.",
    input_schema: obj({ email_id: str, to: strs, cc: strs, subject: str, body: str }, ["email_id"]),
    run(ctx, i) {
      const e = needDraft(ctx, i.email_id);
      if (i.to) e.to = parseAddresses(i.to, "to").map((a) => partyFor(ctx, a));
      if (i.cc) e.cc = parseAddresses(i.cc, "cc").map((a) => partyFor(ctx, a));
      if (i.subject !== undefined) e.subject = needText(i.subject, "The subject", 200);
      if (i.body !== undefined) e.body = needText(i.body, "The body", 20000);
      ctx.changes.push(`draft ${e.id} edited`);
      return { id: e.id, folder: e.folder };
    },
  },
  {
    name: "delete_draft", roles: MAIL_WRITE,
    description: "Throws a draft away for good. Only drafts can be deleted this way; delete_email moves other mail to the bin.",
    input_schema: obj({ email_id: str }, ["email_id"]),
    run(ctx, i) {
      const e = needDraft(ctx, i.email_id);
      ctx.st.emails.splice(ctx.st.emails.indexOf(e), 1);
      ctx.changes.push(`draft ${i.email_id} deleted`);
      return { id: i.email_id, deleted: true };
    },
  },
  {
    name: "send_draft", roles: MAIL_WRITE,
    description: "Sends a draft itself (the same record moves from drafts to sent). It needs a recipient, a subject and a body. Same effects as send_email.",
    input_schema: obj({ email_id: str }, ["email_id"]),
    run(ctx, i) {
      const e = needDraft(ctx, i.email_id);
      if (!e.to.length) fail("invalid_input", "The draft has no recipient.");
      needText(e.subject, "The subject", 200); needText(e.body, "The body", 20000);
      e.folder = "sent"; e.at = stamp(ctx); e.read = true;
      ctx.changes.push(`draft ${e.id} sent from ${e.mailbox} to ${e.to.map((p) => p.address).join(", ")}`);
      afterSend(ctx, e);
      return { id: e.id, thread_id: e.thread_id, at: e.at };
    },
  },
  {
    name: "delete_email", roles: MAIL_WRITE,
    description: "Moves an email to the bin folder. mark_email with mark inbox puts it back.",
    input_schema: obj({ email_id: str }, ["email_id"]),
    run(ctx, i) {
      const e = ctx.st.emails.find((x) => x.id === i.email_id) || fail("not_found", `No email ${i.email_id}.`);
      needMailbox(ctx, e.mailbox);
      if (e.folder === "bin") fail("invalid_input", `${e.id} is already in the bin.`);
      e.deleted_from = e.folder; e.folder = "bin"; e.read = true;
      ctx.changes.push(`email ${e.id} moved to the bin`);
      return { id: e.id, folder: e.folder };
    },
  },
  {
    name: "forward_email", roles: MAIL_WRITE,
    description: "Forwards an email, from a mailbox this role may use, to new recipients (to), with an optional note (body). Starts a new thread whose body quotes the original.",
    input_schema: obj({ email_id: str, mailbox: str, to: strs, cc: strs, body: str }, ["email_id", "mailbox", "to"]),
    run(ctx, i) {
      const src = ctx.st.emails.find((x) => x.id === i.email_id) || fail("not_found", `No email ${i.email_id}.`);
      needMailbox(ctx, src.mailbox);
      const quoted = `---------- Forwarded message ----------\nFrom: ${src.from.name} <${src.from.address}>\nDate: ${src.at}\nSubject: ${src.subject}\nTo: ${src.to.map((p) => p.address).join(", ")}\n\n${src.body}`;
      const e = buildEmail(ctx, { mailbox: i.mailbox, to: i.to, cc: i.cc, subject: /^fwd:/i.test(src.subject) ? src.subject : `Fwd: ${src.subject}`, body: `${i.body ? `${i.body.trim()}\n\n` : ""}${quoted}` }, "sent");
      e.links = { ...src.links };
      delete e.links.contact_id;
      ctx.st.emails.push(e);
      ctx.changes.push(`email ${e.id} forwarded from ${e.mailbox} to ${e.to.map((p) => p.address).join(", ")}`);
      afterSend(ctx, e);
      return { id: e.id, thread_id: e.thread_id, at: e.at };
    },
  },
  {
    name: "react_to_chat_message", roles: roles.INTERNAL,
    description: `Reacts to a chat message with a plain word (${REACTION_WORDS.join(", ")}). One reaction per person per message: a second one replaces the first. Private messages can only be reacted to by the two people in them.`,
    input_schema: obj({ message_id: str, mark: { type: "string", enum: REACTION_WORDS }, as: str }, ["message_id", "mark"]),
    run(ctx, i) {
      const m = ctx.st.chat_messages.find((x) => x.id === i.message_id) || fail("not_found", `No message ${i.message_id}.`);
      const who = speaker(ctx, i.as);
      if (m.dm && !m.dm.includes(who.id)) fail("forbidden", "That is a private message between two other people.");
      if (m.channel) needChannel(m.channel, ctx.role);
      m.reactions = (m.reactions || []).filter((r) => r.by !== who.id);
      m.reactions.push({ by: who.id, mark: i.mark });
      ctx.changes.push(`chat message ${m.id} reaction ${i.mark} by ${who.id}`);
      return { id: m.id, reactions: m.reactions };
    },
  },
  {
    name: "like_social_post", roles: ["marketing", "manager"],
    description: "Likes a post, comment or reply as the company account. Once per post. The company cannot like its own posts.",
    input_schema: obj({ post_id: str }, ["post_id"]),
    run(ctx, i) {
      const p = ctx.st.social_posts.find((x) => x.id === i.post_id && x.kind !== "dm") || fail("not_found", `No post ${i.post_id}.`);
      if (p.author?.kind === "company") fail("invalid_input", "The company cannot like its own post.");
      if (p.liked_by_shop) fail("already_done", `The company has already liked ${p.id}.`);
      p.liked_by_shop = true; p.likes = (p.likes || 0) + 1;
      ctx.changes.push(`${p.network} post ${p.id} liked by the company`);
      return { id: p.id, likes: p.likes };
    },
  },
  {
    name: "repost_social_post", roles: ["marketing", "manager"],
    description: "Reposts a customer's post as the company account (on mutter; squint has no reposts). Once per post. Not for the company's own posts, comments or private messages.",
    input_schema: obj({ post_id: str }, ["post_id"]),
    run(ctx, i) {
      const p = ctx.st.social_posts.find((x) => x.id === i.post_id && x.kind === "post") || fail("not_found", `No post ${i.post_id}.`);
      if (p.network !== "mutter") fail("invalid_input", "Only mutter posts can be reposted.");
      if (p.author?.kind === "company") fail("invalid_input", "The company cannot repost its own post.");
      if (p.reposted_by_shop) fail("already_done", `The company has already reposted ${p.id}.`);
      p.reposted_by_shop = true; p.reposts = (p.reposts || 0) + 1;
      ctx.changes.push(`${p.network} post ${p.id} reposted by the company`);
      return { id: p.id, reposts: p.reposts };
    },
  },
  {
    name: "list_post_pictures", roles: roles.INTERNAL,
    description: "Every product picture a squint or mutter post may use, with the product it shows: [{ path, product_id, name }]. Optional product_id filter. `verified` says whether the list comes from the picture files that exist (true) or only from the product records.",
    input_schema: obj({ product_id: str }),
    run(ctx, i) {
      const { verified, pictures } = picturesOf(ctx);
      const list = pictures.filter((p) => !i.product_id || p.product_id === i.product_id);
      return { verified, total: list.length, pictures: list };
    },
  },
];

extend({
  state: ["emails", "chat_messages", "social_posts", "social_stats_daily"],
  counters: [["EM", "emails", "id"], ["CH", "chat_messages", "id"], ["SP", "social_posts", "id"]],
  tools: [...MAIL_TOOLS, ...CHAT_TOOLS, ...SOCIAL_TOOLS, ...EXTRA_TOOLS],
});
