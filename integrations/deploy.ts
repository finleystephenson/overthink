/**
 * @fileoverview A product deployed on channels of a live sandbox, through its adapter (the same overthink.adapter.ts
 * that `overthink check` and `overthink run` use).
 *
 * When a synthetic person writes in on one of the product's channels (activity-generation/), the product gets the
 * conversation, may call the business tools its role allows, and its answer goes back where the person wrote: a
 * reply from hello@ in Letterbox, the shop's side of a chat, a reply on Mutter or Squint. It answers as the message
 * arrives, and again whenever the person writes back.
 *
 * Only activity reaches it. WHY: the simulator's own background customers are answered by staff, as before, so the
 * product meets exactly the people the developer's agent made, and the business around them keeps its usual life.
 */
import type {Sandbox, SandboxStore} from '../infrastructure/server/sandboxes.mjs';
import type {Scope} from '../simulation/lab/scope.mjs';
import {hooksOf} from '../activity-generation/env.ts';
import type {Message} from './adapter/contract.ts';
import {sandboxGateway} from './adapter/gateway.ts';
import type {ToolGateway} from './adapter/gateway.ts';
import {runProductTurn} from './adapter/loop.ts';
import type {Transport} from './adapter/transports.ts';

/** The contact channels a deployment can answer, and how a reply goes back on each. */
export const DEPLOYABLE_CHANNELS = [
  'email',
  'web_chat',
  'phone',
  'text',
  'mutter_dm',
  'squint_dm',
  'mutter_mention',
] as const;

/** What a deployment needs. */
export interface DeployOptions {
  store: SandboxStore;
  sandbox: Sandbox;
  transport: Transport;
  /** Where it is deployed; contacts on other channels go to staff. */
  channels: readonly string[];
  /** The engine role its tool calls run as (assistant for a customer-facing product). */
  role: string;
  scope: Scope | null;
  /** The standing instructions it is given (simulation/twin-run/jobs.ts). */
  instructions: string;
  maxSteps?: number;
}

/** A product on a sandbox. */
export interface Deployment {
  readonly channels: readonly string[];
  /** Answers whatever is waiting on its channels. Returns how many conversations it answered. */
  deliver(): Promise<number>;
}

type Row = Record<string, unknown>;

/** The record lists a deployment reads, from a sandbox's state. */
function rows(sb: Sandbox, key: string): Row[] {
  const v = sb.world.state[key];
  return Array.isArray(v) ? (v as Row[]) : [];
}

/** Deploys a product and hooks it to the sandbox, so it answers as activity arrives and as days pass. */
export function deployProduct(o: DeployOptions): Deployment {
  const bad = o.channels.filter((c) => !(DEPLOYABLE_CHANNELS as readonly string[]).includes(c));
  if (bad.length > 0)
    throw new Error(
      `A live deployment answers ${DEPLOYABLE_CHANNELS.join(', ')}; not ${bad.join(', ')}.`,
    );
  let gateway: ToolGateway | null = null;
  let busy: Promise<number> = Promise.resolve(0);

  async function deliverNow(): Promise<number> {
    const sb = o.sandbox;
    // WHY a fresh gateway after a reset: the reset world has no record of the product's key.
    gateway ??= sandboxGateway({
      store: o.store,
      sandbox: sb,
      role: o.role,
      scope: o.scope,
      label: 'deployed product',
    });
    let answered = 0;
    for (const contact of rows(sb, 'contacts')) {
      if (contact['source'] !== 'activity' || !o.channels.includes(String(contact['channel'])))
        continue;
      const work = workFor(sb, contact);
      if (work === null) continue;
      const r = await runProductTurn(
        {
          transport: o.transport,
          gateway,
          sessionId: String(contact['id']),
          who: {kind: 'customer', name: work.name, channel: String(contact['channel'])},
          now: sb.world.state.now,
          business: {
            name: sb.world.business.name ?? 'Overthought & Co.',
            role: o.role,
            instructions: o.instructions,
          },
          ...(o.maxSteps === undefined ? {} : {maxSteps: o.maxSteps}),
        },
        work.conversation,
      );
      o.store.record(sb, {
        kind: 'reply',
        via: 'deployed product',
        actor: {role: o.role, session: String(contact['id'])},
        contact_id: contact['id'],
        channel: contact['channel'],
        ok: r.error === null && r.reply !== null,
        reply: r.reply,
        ...(r.error === null ? {} : {error: r.error}),
        tool_calls: r.calls.map((c) => ({name: c.name, ok: c.ok, code: c.code})),
      });
      if (r.reply === null) continue;
      work.send(r.reply);
      contact['handled_by'] ??= 'your_ai';
      contact['first_reply_minutes'] ??= 1;
      if (contact['outcome'] === 'waiting') contact['outcome'] = 'answered';
      answered++;
    }
    return answered;
  }

  const deployment: Deployment = {
    channels: o.channels,
    deliver() {
      // One delivery at a time: an action arriving mid-delivery waits, so nothing is answered twice.
      busy = busy.then(deliverNow, deliverNow);
      return busy;
    },
  };
  const hooks = hooksOf(o.sandbox);
  const run = async (): Promise<void> => {
    await deployment.deliver();
  };
  hooks.afterActivity.push(run);
  hooks.afterDay.push(run);
  return deployment;
}

/** What is waiting on one contact, as a conversation for the product, and how to send its answer back. */
function workFor(
  sb: Sandbox,
  contact: Row,
): {name: string; conversation: Message[]; send(reply: string): void} | null {
  const id = contact['id'];
  const channel = String(contact['channel']);
  const customer = sb.world.state.customers.find((c) => c.id === contact['customer_id']);
  const name = customer?.name ?? 'A customer';
  const support = sb.world.session({role: 'support_agent'});
  if (channel === 'email') {
    const thread = rows(sb, 'emails').filter((e) => e['thread_id'] === id);
    const last = thread.at(-1);
    if (last === undefined || last['folder'] !== 'inbox') return null; // nothing new since the last answer
    const first = thread.find((e) => e['folder'] === 'inbox');
    return {
      name,
      conversation: thread.map((e) => ({
        role: e['folder'] === 'inbox' ? 'user' : 'assistant',
        content:
          e['folder'] === 'inbox'
            ? `Subject: ${String(e['subject'])}\n\n${String(e['body'])}`
            : String(e['body']),
      })),
      // WHY the support agent's mailbox: the reply leaves from hello@ like any answer, whoever wrote it; the
      // product's own role (often the assistant) has no mailbox of its own.
      send: (reply) =>
        support.call('send_email', {
          mailbox: 'hello',
          reply_to_id: String(first?.['id'] ?? last['id']),
          body: reply,
        }),
    };
  }
  if (channel === 'web_chat' || channel === 'phone' || channel === 'text') {
    const conv = rows(sb, 'conversations').find((c) => c['contact_id'] === id);
    const messages = (conv?.['messages'] ?? []) as Row[];
    if (conv === undefined || messages.at(-1)?.['from'] !== 'customer') return null;
    return {
      name,
      conversation: messages.map((m) => ({
        role: m['from'] === 'customer' ? 'user' : 'assistant',
        content: String(m['text']),
      })),
      send: (reply) => messages.push({from: 'assistant', at: sb.world.state.now, text: reply}),
    };
  }
  const posts = rows(sb, 'social_posts');
  const opening = posts.find((p) => (p['links'] as Row | undefined)?.['contact_id'] === id);
  if (opening === undefined) return null;
  const isDm = opening['kind'] === 'dm';
  const thread = isDm
    ? posts.filter((p) => p['thread'] === opening['thread'])
    : [opening, ...posts.filter((p) => p['parent'] === opening['id'])];
  if ((thread.at(-1)?.['author'] as Row | undefined)?.['kind'] === 'company') return null;
  return {
    name,
    conversation: thread.map((p) => ({
      role: (p['author'] as Row | undefined)?.['kind'] === 'company' ? 'assistant' : 'user',
      content: String(p['text']),
    })),
    send: (reply) =>
      isDm
        ? support.call('send_social_message', {
            thread: String(opening['thread']),
            network: String(opening['network']),
            text: reply,
          })
        : support.call('reply_social_post', {post_id: String(opening['id']), text: reply}),
  };
}
