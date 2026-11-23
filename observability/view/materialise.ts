/**
 * @fileoverview Writes each recorded conversation into the business's own records at the end of an arm, so the apps
 * show exactly what was said: the customer's words in the hello@ inbox or the website chat, and the product's
 * replies beside them, marked as the product's.
 *
 * WHY at the end: the simulator writes a contact's records as it goes, with its own stock reply where the product
 * answered (simulation/simulator/core.mjs closeContact). Rewriting them during the run could change what the simulator reads back;
 * once the arm's figures are taken, nothing reads them but `overthink view`.
 */
import type {Transcript} from '../../simulation/twin-run/conversation.ts';
import type {Mark} from './marks.ts';

interface Email {
  id: string;
  key: string;
  thread_id?: string;
  mailbox: string;
  folder: string;
  from: {name: string; address: string};
  to: {name: string; address: string}[];
  cc: unknown[];
  subject: string;
  body: string;
  at: string;
  read: boolean;
  by: string | null;
  links: Record<string, unknown>;
  overthink?: {by: 'product'; session: string};
}

interface ChatMessage {
  from: string;
  at: string;
  text: string;
  overthink?: {by: 'product'; session: string};
}

interface Conversation {
  id: string;
  customer_id: string | null;
  channel: string;
  started_at: string;
  case_number: string | null;
  summary?: string;
  contact_id?: string;
  messages: ChatMessage[];
}

interface ContactRecord {
  id: string;
  at: string;
  channel: string;
  customer_id: string | null;
  handled_by: string | null;
  case_number?: string | null;
  summary?: string;
}

/** The parts of world.state this file reads and writes. */
export interface ConversationState {
  contacts: ContactRecord[];
  emails?: Email[];
  conversations?: Conversation[];
  customers: {id: string; name: string; email?: string}[];
  [k: string]: unknown;
}

const SHOP = {name: 'Overthought & Co.', address: 'hello@overthought.example'};
/** Minutes between lines of a conversation in the records: the product answers at once, people take a moment. */
const LINE_GAP_MINUTES = 2;

/**
 * Writes the arm's conversations into `state`. With the product, its lines replace the simulator's stock reply and
 * are marked; without it, only the customer's opening words are updated (so both arms show the same first message).
 * Returns the marks for what the product wrote.
 */
export function writeConversations(
  state: ConversationState,
  transcripts: readonly Transcript[],
  o: {withProduct: boolean; role: string},
): Mark[] {
  const marks: Mark[] = [];
  for (const t of transcripts) {
    if (t.contactId === null) continue;
    const contact = state.contacts.find((c) => c.id === t.contactId);
    if (contact === undefined) continue;
    const spoken = t.lines.filter((l) => l.from === 'customer' || l.from === 'product');
    const opening = spoken[0]?.text;
    if (opening === undefined) continue;
    const played = o.withProduct && t.ending !== 'passed' && t.ending !== 'staff';
    const byProduct = contact.handled_by === o.role;
    const at = (i: number): string =>
      new Date(Date.parse(contact.at) + i * LINE_GAP_MINUTES * 60000).toISOString();
    if (t.channel === 'email') {
      const emails = (state.emails ??= []);
      const inbound = emails.find((e) => e.key === `contact|${contact.id}|in`);
      if (inbound === undefined) continue;
      inbound.body = `${opening}\n\n${t.customer}`;
      if (!played) continue;
      if (byProduct) {
        // The simulator's stock reply stands in for the product's words; the real words follow.
        const stock = emails.findIndex((e) => e.key === `contact|${contact.id}|reply`);
        if (stock >= 0) emails.splice(stock, 1);
      }
      const customer = inbound.from;
      spoken.slice(1).forEach((line, i) => {
        const fromProduct = line.from === 'product';
        const email: Email = {
          id: nextId(emails, 'EM', 6),
          key: `overthink|${contact.id}|${i + 1}`,
          thread_id: contact.id,
          mailbox: 'hello',
          folder: fromProduct ? 'sent' : 'inbox',
          from: fromProduct ? SHOP : customer,
          to: [fromProduct ? customer : SHOP],
          cc: [],
          subject: fromProduct ? `Re: ${inbound.subject}` : inbound.subject,
          body: fromProduct ? line.text : `${line.text}\n\n${t.customer}`,
          at: at(i + 1),
          read: true,
          by: null,
          links: {...inbound.links},
          ...(fromProduct ? {overthink: {by: 'product' as const, session: t.session}} : {}),
        };
        emails.push(email);
        if (fromProduct)
          marks.push({
            id: email.id,
            kind: 'message',
            app: 'letterbox',
            session: t.session,
            what: 'replied by email',
          });
      });
      // A person who took over after the product answers after it, not in the middle of its conversation (the
      // simulator dates the first response at the product's speed).
      const staffReply = emails.find((e) => e.key === `contact|${contact.id}|reply`);
      const end = at(spoken.length);
      if (staffReply !== undefined && staffReply.at < end) staffReply.at = end;
      marks.push({
        id: contact.id,
        kind: 'conversation',
        app: 'letterbox',
        session: t.session,
        what: 'answered this email',
      });
      continue;
    }
    const conversations = (state.conversations ??= []);
    let conv = conversations.find((c) => c.contact_id === contact.id);
    if (conv === undefined) {
      if (!played) continue;
      // A phone call or a text has no conversation record of its own; the product's needs one to be seen.
      conv = {
        id: nextId(conversations, 'CONV', 4),
        customer_id: contact.customer_id,
        channel: t.channel === 'web_chat' ? 'web' : t.channel,
        started_at: contact.at,
        case_number: contact.case_number ?? null,
        ...(contact.summary !== undefined ? {summary: contact.summary} : {}),
        contact_id: contact.id,
        messages: [],
      };
      conversations.push(conv);
    }
    if (!played) {
      const first = conv.messages[0];
      if (first !== undefined) first.text = opening;
      continue;
    }
    // Staff lines stay (a hand-over ends with a person); the stock assistant line gives way to the real words.
    const staff = conv.messages.filter((m) => m.from === 'staff');
    conv.messages = [
      ...spoken.map((line, i) => ({
        from: line.from === 'product' ? 'assistant' : 'customer',
        at: at(i),
        text: line.text,
        ...(line.from === 'product'
          ? {overthink: {by: 'product' as const, session: t.session}}
          : {}),
      })),
      ...staff,
    ];
    marks.push(
      {
        id: conv.id,
        kind: 'conversation',
        app: 'front-desk',
        session: t.session,
        what: 'chatted with the customer',
      },
      {
        id: contact.id,
        kind: 'conversation',
        app: 'front-desk',
        session: t.session,
        what: 'answered this contact',
      },
    );
  }
  return marks;
}

/** The next id in a list, the way the engine numbers them (prefix, dash, zero-padded number). */
function nextId(list: readonly {id: string}[], prefix: string, width: number): string {
  let max = 0;
  for (const x of list) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(x.id);
    if (m?.[1] !== undefined) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(width, '0')}`;
}
