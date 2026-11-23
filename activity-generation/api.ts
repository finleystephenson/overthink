/**
 * @fileoverview The TypeScript API: the same actions as the MCP toolset and `overthink act`, as typed methods.
 *
 *     // In the same process as the sandbox:
 *     const act = openActivity(store, sandbox);
 *     // Or against a running sandbox (overthink up):
 *     const act = new ActivityClient({url: 'http://127.0.0.1:4747', sandbox: id, key});
 *
 *     const [ann] = await act.createPeople({count: 1});
 *     await act.sendEmail({person: ann.customer_id, subject: 'Late parcel', body: '...'});
 *     await act.advanceTime(3);
 *
 * Each method throws {@link ActivityError} on a refusal. `perform` returns the result instead, for agents that
 * want to see refusals as data.
 */
import type {Principal, Sandbox, SandboxStore} from '../infrastructure/server/sandboxes.mjs';
import {perform} from './actions.ts';
import type {ActionResult} from './actions.ts';
import type {ActivityEnv} from './env.ts';
import {ActivityError} from './env.ts';
import type {CreatePersonInput, Person} from './persons.ts';
import {attachSchedule} from './schedule.ts';

/** Every verb, over any way of reaching a sandbox. Subclasses say how one action is sent. */
export abstract class ActivityApi {
  /** Runs one action by name. Never throws for a refusal: see `ok`. */
  abstract perform(action: string, input?: Record<string, unknown>): Promise<ActionResult>;

  /** Runs one action and returns its data, or throws {@link ActivityError}. */
  async run(action: string, input: Record<string, unknown> = {}): Promise<unknown> {
    const r = await this.perform(action, input);
    if (!r.ok) throw new ActivityError(r.error.code, r.error.message);
    return r.data;
  }

  /** Synthetic people as customers (activity-generation/persons.ts). */
  async createPeople(input: CreatePersonInput = {}): Promise<Person[]> {
    return (await this.run('create_person', {...input})) as Person[];
  }

  async sendEmail(input: {
    person?: string;
    subject: string;
    body: string;
    mailbox?: string;
    order_number?: string;
  }): Promise<{email_id: string; contact_id: string | null}> {
    return (await this.run('send_email', {...input})) as {
      email_id: string;
      contact_id: string | null;
    };
  }

  async sendMessage(input: {
    person?: string;
    text: string;
    channel?: 'web_chat' | 'phone' | 'text';
    conversation_id?: string;
  }): Promise<{conversation_id: string; contact_id: string | null}> {
    return (await this.run('send_message', {...input})) as {
      conversation_id: string;
      contact_id: string | null;
    };
  }

  async post(input: {
    person?: string;
    network: 'mutter' | 'squint';
    text: string;
    kind?: 'post' | 'reply' | 'dm';
    reply_to?: string;
    mentions_shop?: boolean;
  }): Promise<{post_id: string}> {
    return (await this.run('post', {...input})) as {post_id: string};
  }

  async placeOrder(input: {
    person: string;
    items: {sku: string; qty?: number}[];
    delivery_method?: string;
    payment?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return (await this.run('place_order', {...input})) as Record<string, unknown>;
  }

  async advanceTime(days: number): Promise<{now: string; days: Record<string, unknown>[]}> {
    return (await this.run('advance_time', {days})) as {
      now: string;
      days: Record<string, unknown>[];
    };
  }

  async schedule(input: {
    action: string;
    input?: Record<string, unknown>;
    at?: string;
    in_days?: number;
  }): Promise<unknown> {
    return this.run('schedule', {...input});
  }

  async batch(
    actions: {action: string; input?: Record<string, unknown>}[],
    stopOnError = false,
  ): Promise<{ran: number; failed: number; results: ActionResult[]}> {
    return (await this.run('batch', {actions, stop_on_error: stopOnError})) as {
      ran: number;
      failed: number;
      results: ActionResult[];
    };
  }

  async observe(
    since = 0,
    limit = 100,
  ): Promise<{entries: Record<string, unknown>[]; last: number; more: boolean}> {
    return (await this.run('observe', {since, limit})) as {
      entries: Record<string, unknown>[];
      last: number;
      more: boolean;
    };
  }

  async reset(): Promise<void> {
    await this.run('reset');
  }
}

/** Activity on a sandbox in this process. */
export class Activity extends ActivityApi {
  readonly env: ActivityEnv;

  constructor(env: ActivityEnv) {
    super();
    this.env = env;
  }

  override perform(action: string, input: Record<string, unknown> = {}): Promise<ActionResult> {
    return perform(this.env, action, input);
  }
}

/**
 * Opens a sandbox for activity as its owner, and makes scheduled actions run as time moves. `via` names the door in
 * the trace.
 */
export function openActivity(
  store: SandboxStore,
  sandbox: Sandbox,
  o: {principal?: Principal; via?: string} = {},
): Activity {
  const principal = o.principal ?? sandbox.tokens.find((t) => t.owner === true);
  if (principal === undefined) throw new Error('This sandbox has no owner token.');
  const env: ActivityEnv = {store, sandbox, principal, via: o.via ?? 'api'};
  attachSchedule(env, perform);
  return new Activity(env);
}

/** Activity on a running sandbox, over HTTP (POST /sandboxes/{id}/activity/{action}). */
export class ActivityClient extends ActivityApi {
  readonly url: string;
  readonly sandbox: string;
  readonly #key: string;

  constructor(o: {url: string; sandbox: string; key: string}) {
    super();
    this.url = o.url.replace(/\/$/, '');
    this.sandbox = o.sandbox;
    this.#key = o.key;
  }

  override async perform(
    action: string,
    input: Record<string, unknown> = {},
  ): Promise<ActionResult> {
    let res: Response;
    try {
      res = await fetch(
        `${this.url}/sandboxes/${this.sandbox}/activity/${encodeURIComponent(action)}`,
        {
          method: 'POST',
          headers: {'content-type': 'application/json', authorization: `Bearer ${this.#key}`},
          body: JSON.stringify(input),
        },
      );
    } catch {
      return {
        ok: false,
        action,
        error: {
          code: 'offline',
          message: `No sandbox answers at ${this.url}. Start one with: overthink up`,
        },
      };
    }
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      data?: unknown;
      error?: {code: string; message: string};
    };
    if (json.ok === true) return {ok: true, action, data: json.data};
    return {
      ok: false,
      action,
      error: json.error ?? {code: 'http', message: `The sandbox answered ${String(res.status)}.`},
    };
  }
}
