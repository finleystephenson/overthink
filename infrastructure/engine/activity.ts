/**
 * @fileoverview Engine extension: the outside world reaching the business. Synthetic people are created here, and
 * their emails, chats and social posts arrive here, as the same records the simulator writes when its own customers
 * get in touch (a contact for Front Desk, an email in Letterbox, a conversation for web chat, a post on Mutter or
 * Squint). That is what makes every app show activity an agent creates.
 *
 * Only the `world` lens may call these tools. WHY: they speak for people outside the company. A product under test
 * acts as a business role and must never be able to invent customers or put words in their mouths. The server never
 * offers the world lens to a connection; activity-generation/ calls these tools for the sandbox's owner.
 *
 * What a person does inside the business (orders, returns, reviews) goes through the engine's own customer tools
 * instead, so the shop's rules apply to synthetic people exactly as to the simulator's.
 *
 * Registration: imported by infrastructure/engine/all.js.
 */
import {extend, kit} from './engine.js';
import type {EngineState, EngineTool, ToolContext} from './engine.js';

// WHY the annotation: TypeScript only narrows after a never-returning call whose type is written out.
const fail: (code: string, message: string) => never = kit.fail;
const {nextId} = kit;
const {str, strs, obj} = kit.schema;
const WORLD = ['world'];
const SHOP = 'Overthought & Co.';
const HELLO = 'hello@overthought.example';
const ANY_OBJECT = {type: 'object'};
const MAX_TEXT = 8000;

/** Where an outside message comes in, and the contact channel Front Desk files it under. */
const SOCIAL_CONTACT: Readonly<Record<string, string>> = {
  'mutter:dm': 'mutter_dm',
  'squint:dm': 'squint_dm',
  'mutter:post': 'mutter_mention',
};
const CHAT_CHANNELS = ['web_chat', 'phone', 'text'];
const NETWORKS = ['mutter', 'squint'];

/** A synthetic person: a customer record plus who they are. Read only through the world lens. */
interface SyntheticPerson {
  customer_id: string;
  name: string;
  created_at: string;
  profile: Record<string, unknown>;
  memory: {at: string; line: string}[];
}

/** The record lists these tools write, typed loosely: they are the simulator's shapes, kept as plain JSON. */
type Row = Record<string, unknown>;

function list(st: EngineState, key: string): Row[] {
  const existing = st[key];
  if (Array.isArray(existing)) return existing as Row[];
  const fresh: Row[] = [];
  st[key] = fresh;
  return fresh;
}

/**
 * The next id in a list, as the simulator makes them (highest number so far plus one). WHY not the engine's counters:
 * contacts, emails and posts are numbered by the simulator this way, and both must agree or ids would repeat.
 */
function nextIn(rows: readonly Row[], prefix: string, width: number): string {
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)$/.exec(typeof r['id'] === 'string' ? r['id'] : '');
    if (m?.[1] !== undefined) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(width, '0')}`;
}

function text(i: Record<string, unknown>, key: string, what: string, max = MAX_TEXT): string {
  const v = i[key];
  if (typeof v !== 'string' || v.trim() === '') fail('invalid_input', `Say ${what} ("${key}").`);
  if (v.length > max) fail('invalid_input', `"${key}" is at most ${max} characters.`);
  return v;
}

function optional(i: Record<string, unknown>, key: string): string | null {
  const v = i[key];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function customerOf(ctx: ToolContext, id: string | null): Row | null {
  if (id === null) return null;
  const c = ctx.st.customers.find((x) => x['id'] === id);
  if (c === undefined) fail('not_found', `There is no customer ${id}.`);
  return c;
}

function remember(ctx: ToolContext, customerId: string | null, line: string): void {
  if (customerId === null) return;
  const p = list(ctx.st, 'synthetic_people').find((x) => x['customer_id'] === customerId);
  if (p !== undefined) (p['memory'] as SyntheticPerson['memory']).push({at: ctx.now, line});
}

/** A contact for Front Desk, waiting for an answer: what the help desk and a deployed product pick up. */
function raiseContact(
  ctx: ToolContext,
  o: {
    customerId: string | null;
    channel: string;
    topic: string;
    summary: string;
    order: string | null;
  },
): Row {
  const contacts = list(ctx.st, 'contacts');
  const rec: Row = {
    id: nextIn(contacts, 'CT', 5),
    at: ctx.now,
    customer_id: o.customerId,
    channel: o.channel,
    topic: o.topic,
    handled_by: null,
    first_reply_minutes: null,
    resolve_minutes: null,
    outcome: 'waiting',
    case_number: null,
    summary: o.summary.slice(0, 120),
    order: o.order,
    source: 'activity',
  };
  contacts.push(rec);
  ctx.changes.push(`contact ${String(rec['id'])} raised on ${o.channel}`);
  return rec;
}

const TOOLS: EngineTool[] = [
  {
    name: 'add_synthetic_person',
    roles: WORLD,
    description:
      'World lens only: a synthetic person becomes a customer of the shop (they have an account, so they can order, write in and be verified). profile is free JSON describing who they are (activity-generation/README.md, "People"); it is never shown to business roles.',
    input_schema: obj(
      {name: str, email: str, phone: str, address: ANY_OBJECT, profile: ANY_OBJECT},
      ['name'],
    ),
    run(ctx, i) {
      const name = text(i, 'name', 'their name', 120);
      const email =
        optional(i, 'email') ??
        `${name
          .toLowerCase()
          .replace(/[^a-z]+/g, '.')
          .replace(/^\.|\.$/g, '')}@people.example`;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        fail('invalid_input', 'That email address does not look right.');
      if (ctx.st.customers.some((c) => String(c['email']).toLowerCase() === email.toLowerCase())) {
        fail('rule_violation', `A customer with ${email} already exists. Give another email.`);
      }
      const a = (i['address'] ?? {}) as Row;
      const address = {
        id: 'A1',
        line1: typeof a['line1'] === 'string' ? a['line1'] : '1 Example Street',
        town: typeof a['town'] === 'string' ? a['town'] : 'Bath',
        postcode: typeof a['postcode'] === 'string' ? a['postcode'] : 'BA1 1AA',
        default: true,
      };
      const customer: Row = {
        id: nextId(ctx, 'C'),
        name,
        email,
        phone: optional(i, 'phone') ?? '',
        addresses: [address],
        contact_preference: 'email',
        marketing_opt_in: false,
        created_at: ctx.now,
        credit_balance: 0,
        notes: '',
      };
      ctx.st.customers.push(customer);
      const person: SyntheticPerson = {
        customer_id: String(customer['id']),
        name,
        created_at: ctx.now,
        profile: (i['profile'] ?? {}) as Record<string, unknown>,
        memory: [],
      };
      list(ctx.st, 'synthetic_people').push(person as unknown as Row);
      ctx.changes.push(`synthetic person ${person.customer_id} (${name}) created`);
      return {customer_id: person.customer_id, name, email, postcode: address.postcode};
    },
  },
  {
    name: 'list_synthetic_people',
    roles: WORLD,
    description:
      'World lens only: every synthetic person created in this sandbox, with their profile and memory.',
    input_schema: obj({}),
    run(ctx) {
      const people = list(ctx.st, 'synthetic_people');
      return {total: people.length, people};
    },
  },
  {
    name: 'note_synthetic_person',
    roles: WORLD,
    description:
      'World lens only: adds a line to a synthetic person\'s memory ("was told the parcel comes Friday"), so whoever voices them next stays consistent.',
    input_schema: obj({customer_id: str, line: str}, ['customer_id', 'line']),
    run(ctx, i) {
      const id = text(i, 'customer_id', 'which person');
      if (!list(ctx.st, 'synthetic_people').some((p) => p['customer_id'] === id))
        fail('not_found', `${id} is not a synthetic person.`);
      remember(ctx, id, text(i, 'line', 'what to remember', 500));
      return {customer_id: id};
    },
  },
  {
    name: 'deliver_email',
    roles: WORLD,
    description:
      "World lens only: an email arrives from outside in one of the company's mailboxes (hello by default; suppliers for supplier mail). Mail to hello from a customer also raises a Front Desk contact, so the help desk or a deployed product answers it.",
    input_schema: obj(
      {
        from_name: str,
        from_address: str,
        customer_id: str,
        mailbox: str,
        subject: str,
        body: str,
        order_number: str,
        topic: str,
      },
      ['subject', 'body'],
    ),
    run(ctx, i) {
      const customer = customerOf(ctx, optional(i, 'customer_id'));
      const fromAddress =
        optional(i, 'from_address') ?? (customer === null ? null : String(customer['email']));
      if (fromAddress === null)
        fail('invalid_input', 'Say who it is from: customer_id, or from_address.');
      const fromName =
        optional(i, 'from_name') ?? (customer === null ? fromAddress : String(customer['name']));
      const mailbox = optional(i, 'mailbox') ?? 'hello';
      const subject = text(i, 'subject', 'a subject', 200);
      const body = text(i, 'body', 'what the email says');
      const order = optional(i, 'order_number');
      const customerId = customer === null ? null : String(customer['id']);
      const contact =
        mailbox === 'hello'
          ? raiseContact(ctx, {
              customerId,
              channel: 'email',
              topic: optional(i, 'topic') ?? 'other',
              summary: subject,
              order,
            })
          : null;
      const emails = list(ctx.st, 'emails');
      const id = nextIn(emails, 'EM', 6);
      emails.push({
        id,
        key: `activity|${id}`,
        thread_id: contact === null ? id : contact['id'],
        mailbox,
        folder: 'inbox',
        from: {name: fromName, address: fromAddress},
        to: [{name: SHOP, address: mailbox === 'hello' ? HELLO : `${mailbox}@overthought.example`}],
        cc: [],
        subject,
        body,
        at: ctx.now,
        read: false,
        by: null,
        links: {
          ...(customerId === null ? {} : {customer_id: customerId}),
          ...(contact === null ? {} : {contact_id: contact['id']}),
          ...(order === null ? {} : {order}),
        },
      });
      ctx.changes.push(`email ${id} arrived in ${mailbox} from ${fromAddress}`);
      remember(ctx, customerId, `Emailed ${mailbox}@: "${subject}"`);
      return {email_id: id, contact_id: contact === null ? null : contact['id']};
    },
  },
  {
    name: 'deliver_chat_message',
    roles: WORLD,
    description:
      'World lens only: a customer writes on the website chat, calls (phone) or texts (text). A new conversation raises a Front Desk contact; give conversation_id to carry one on.',
    input_schema: obj(
      {
        customer_id: str,
        channel: str,
        text: str,
        conversation_id: str,
        order_number: str,
        topic: str,
      },
      ['text'],
    ),
    run(ctx, i) {
      const words = text(i, 'text', 'what they write');
      const conversations = list(ctx.st, 'conversations');
      const ongoing = optional(i, 'conversation_id');
      if (ongoing !== null) {
        const conv = conversations.find((c) => c['id'] === ongoing);
        if (conv === undefined) fail('not_found', `There is no conversation ${ongoing}.`);
        (conv['messages'] as Row[]).push({from: 'customer', at: ctx.now, text: words});
        ctx.changes.push(`conversation ${ongoing}: the customer wrote again`);
        remember(
          ctx,
          (conv['customer_id'] as string | null) ?? null,
          `Wrote again in ${ongoing}: "${words.slice(0, 80)}"`,
        );
        return {conversation_id: ongoing, contact_id: conv['contact_id'] ?? null};
      }
      const channel = optional(i, 'channel') ?? 'web_chat';
      if (!CHAT_CHANNELS.includes(channel))
        fail('invalid_input', `"channel" must be one of: ${CHAT_CHANNELS.join(', ')}.`);
      const customer = customerOf(ctx, optional(i, 'customer_id'));
      const customerId = customer === null ? null : String(customer['id']);
      const contact = raiseContact(ctx, {
        customerId,
        channel,
        topic: optional(i, 'topic') ?? 'other',
        summary: words,
        order: optional(i, 'order_number'),
      });
      const conv: Row = {
        id: nextIn(conversations, 'CONV', 4),
        customer_id: customerId,
        channel: channel === 'web_chat' ? 'web' : channel,
        started_at: ctx.now,
        case_number: null,
        summary: contact['summary'],
        contact_id: contact['id'],
        messages: [{from: 'customer', at: ctx.now, text: words}],
      };
      conversations.push(conv);
      ctx.changes.push(`conversation ${String(conv['id'])} started on ${channel}`);
      remember(ctx, customerId, `Started a ${channel} conversation: "${words.slice(0, 80)}"`);
      return {conversation_id: conv['id'], contact_id: contact['id']};
    },
  },
  {
    name: 'deliver_social_post',
    roles: WORLD,
    description:
      'World lens only: someone outside posts on Mutter or Squint (kind post), replies to a post (kind reply, reply_to a post id) or messages the shop privately (kind dm). A DM, or a Mutter post that mentions the shop, raises a Front Desk contact.',
    input_schema: obj(
      {
        network: str,
        kind: str,
        text: str,
        customer_id: str,
        name: str,
        handle: str,
        reply_to: str,
        mentions_shop: {type: 'boolean'},
        tags: strs,
      },
      ['network', 'text'],
    ),
    run(ctx, i) {
      const network = text(i, 'network', 'the network (mutter or squint)');
      if (!NETWORKS.includes(network))
        fail('invalid_input', `"network" must be one of: ${NETWORKS.join(', ')}.`);
      const kind = optional(i, 'kind') ?? 'post';
      if (!['post', 'reply', 'dm'].includes(kind))
        fail('invalid_input', '"kind" must be post, reply or dm.');
      const words = text(i, 'text', 'what they post', 2000);
      const customer = customerOf(ctx, optional(i, 'customer_id'));
      const name =
        customer === null ? (optional(i, 'name') ?? 'Someone') : String(customer['name']);
      const handle = optional(i, 'handle') ?? name.toLowerCase().replace(/[^a-z]+/g, '');
      const posts = list(ctx.st, 'social_posts');
      let parent: Row | null = null;
      const replyTo = optional(i, 'reply_to');
      if (kind === 'reply') {
        if (replyTo === null)
          fail('invalid_input', 'A reply needs reply_to: the id of the post it answers.');
        parent = posts.find((p) => p['id'] === replyTo) ?? null;
        if (parent === null) fail('not_found', `There is no post ${replyTo}.`);
      }
      const mentions = kind === 'post' && i['mentions_shop'] === true;
      const contactChannel =
        SOCIAL_CONTACT[`${network}:${kind === 'dm' ? 'dm' : mentions ? 'post' : 'none'}`];
      const customerId = customer === null ? null : String(customer['id']);
      const contact =
        contactChannel === undefined
          ? null
          : raiseContact(ctx, {
              customerId,
              channel: contactChannel,
              topic: 'other',
              summary: words,
              order: null,
            });
      const id = nextIn(posts, 'SP', 6);
      posts.push({
        id,
        key: `activity|${id}`,
        network,
        author: {kind: 'customer', name, handle, customer_id: customerId},
        kind,
        text: words,
        image: null,
        at: ctx.now,
        likes: 0,
        reposts: 0,
        parent: parent === null ? null : parent['id'],
        parent_key: parent === null ? null : (parent['key'] ?? null),
        thread: kind === 'dm' ? `dm-${network}-${customerId ?? handle}` : null,
        by: null,
        mentions_shop: mentions,
        links: {
          ...(customerId === null ? {} : {customer_id: customerId}),
          ...(contact === null ? {} : {contact_id: contact['id']}),
        },
      });
      ctx.changes.push(`${network} ${kind} ${id} by @${handle}`);
      remember(ctx, customerId, `Posted on ${network} (${kind}): "${words.slice(0, 80)}"`);
      return {post_id: id, contact_id: contact === null ? null : contact['id']};
    },
  },
];

extend({state: ['synthetic_people'], tools: TOOLS});
