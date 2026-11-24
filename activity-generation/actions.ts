/**
 * @fileoverview Every action an agent can take to create activity in the sandbox, in one list.
 *
 * The MCP toolset, the HTTP routes, the `overthink act` command and the TypeScript API are all made from this list,
 * so they can never drift apart. Each action has a JSON Schema for its input (what MCP clients and the HTTP API
 * check against), a description written for a model to read, and a `run` that goes through engine tools.
 *
 * Nothing here decides what to test. It is a set of verbs: the agent plans the scenario and calls them.
 */
import type {ActivityEnv} from './env.ts';
import {ActivityError, asCustomer, asRole, asWorld, hooksOf, refuse} from './env.ts';
import {createPeople} from './persons.ts';
import type {CreatePersonInput} from './persons.ts';
import {addToSchedule, listSchedule} from './schedule.ts';

/** A JSON Schema object for one action's input. */
export interface InputSchema {
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties?: boolean;
}

/** One verb. */
export interface ActionDef {
  name: string;
  /** One line for menus and `overthink act --help`. */
  title: string;
  /** What it does, for a model to read: what it creates, where it shows, what it needs. */
  description: string;
  input: InputSchema;
  /** True for an action that only reads, so clients can mark it safe. */
  readOnly?: boolean;
  run(env: ActivityEnv, input: Record<string, unknown>): Promise<unknown>;
}

/** What one action did, as written to the trace and returned to the caller. */
export type ActionResult =
  | {ok: true; action: string; data: unknown}
  | {ok: false; action: string; error: {code: string; message: string}};

const s = {type: 'string'};
const int = {type: 'integer'};
const bool = {type: 'boolean'};
const obj = {type: 'object'};
const PERSON = {
  type: 'string',
  description: 'The customer id of the person (C-...), from create_person or the business.',
};
const ITEMS = {
  type: 'array',
  description:
    'Order lines: [{"sku": "...", "qty": 1}]. SKUs come from the catalogue (call_business_tool search_catalogue).',
  items: {type: 'object', properties: {sku: s, qty: int}, required: ['sku']},
};

function schema(properties: InputSchema['properties'], required: string[] = []): InputSchema {
  return {type: 'object', properties, required, additionalProperties: false};
}

function str(i: Record<string, unknown>, key: string): string {
  const v = i[key];
  if (typeof v !== 'string' || v === '') refuse('invalid_input', `Missing "${key}".`);
  return v;
}

/** Copies the listed keys that are present, so engine tools never see a key the caller did not give. */
function pick(i: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (i[k] !== undefined) out[k] = i[k];
  return out;
}

/** The lines of an order, for "return everything" and for a default review. */
function orderOf(
  env: ActivityEnv,
  customerId: string,
  number: string,
): {items: {sku: string; qty: number}[]} {
  const o = env.sandbox.world.state.orders.find(
    (x) => x.number === number && x.customer_id === customerId,
  ) as {items?: {sku: string; qty: number}[]} | undefined;
  if (o === undefined) refuse('not_found', `${customerId} has no order ${number}.`);
  return {items: o.items ?? []};
}

/** The actions, in the order menus show them. */
export const ACTIONS: readonly ActionDef[] = [
  {
    name: 'create_person',
    title: 'Create synthetic people',
    description:
      'Creates synthetic people as customers of Overthought & Co. from="population" (default) draws `count` people with real-world circumstances from the population, spread across it; `where` narrows the draw (e.g. {"online": "never"}). from="described" makes one person from your own description (name required). `profile` adds fields: goal, tone, patience, adversarial, assumptions... (activity-generation/README.md, "People"). Returns their customer ids, emails and postcodes. Profiles are never shown to the product.',
    input: schema({
      from: {type: 'string', enum: ['population', 'described']},
      count: int,
      where: obj,
      name: s,
      description: s,
      email: s,
      address: obj,
      profile: obj,
    }),
    run: async (env, i) => Promise.resolve(createPeople(env, i as CreatePersonInput)),
  },
  {
    name: 'list_people',
    title: 'List synthetic people',
    description:
      'Every synthetic person in this sandbox, with their profile and memory (what they have said and been told).',
    input: schema({}),
    readOnly: true,
    run: async (env) => Promise.resolve(asWorld(env, 'list_synthetic_people', {})),
  },
  {
    name: 'remember',
    title: 'Add to a person’s memory',
    description:
      'Adds a line to a person’s memory ("was promised a refund by Friday"), so whoever voices them next stays consistent. Actions add their own lines; use this for what the product told them.',
    input: schema({person: PERSON, line: s}, ['person', 'line']),
    run: async (env, i) =>
      Promise.resolve(
        asWorld(env, 'note_synthetic_person', {
          customer_id: str(i, 'person'),
          line: str(i, 'line'),
        }),
      ),
  },
  {
    name: 'send_email',
    title: 'Someone emails the company',
    description:
      'An email arrives in a company mailbox (hello by default, the customer inbox; suppliers for supplier mail). From a person (person) or any outside address (from_name, from_address). Mail to hello raises a Front Desk contact, which the help desk, or a product deployed on email, answers. Shows in Letterbox and Front Desk.',
    input: schema(
      {
        person: PERSON,
        from_name: s,
        from_address: s,
        mailbox: s,
        subject: s,
        body: s,
        order_number: s,
        topic: s,
      },
      ['subject', 'body'],
    ),
    run: async (env, i) =>
      Promise.resolve(
        asWorld(env, 'deliver_email', {
          ...pick(i, [
            'from_name',
            'from_address',
            'mailbox',
            'subject',
            'body',
            'order_number',
            'topic',
          ]),
          ...(i['person'] === undefined ? {} : {customer_id: i['person']}),
        }),
      ),
  },
  {
    name: 'send_message',
    title: 'Someone chats, calls or texts',
    description:
      'A person writes on the website chat (channel web_chat, the default), calls (phone; the words are the call) or texts (text). Starts a conversation and a Front Desk contact; give conversation_id to carry an existing conversation on.',
    input: schema(
      {
        person: PERSON,
        channel: {type: 'string', enum: ['web_chat', 'phone', 'text']},
        text: s,
        conversation_id: s,
        order_number: s,
        topic: s,
      },
      ['text'],
    ),
    run: async (env, i) =>
      Promise.resolve(
        asWorld(env, 'deliver_chat_message', {
          ...pick(i, ['channel', 'text', 'conversation_id', 'order_number', 'topic']),
          ...(i['person'] === undefined ? {} : {customer_id: i['person']}),
        }),
      ),
  },
  {
    name: 'post',
    title: 'Someone posts on Mutter or Squint',
    description:
      'A person (or anyone, by name) posts on Mutter or Squint (kind post), replies to a post (kind reply with reply_to), or sends the shop a private message (kind dm). A DM, or a Mutter post with mentions_shop true, raises a Front Desk contact.',
    input: schema(
      {
        person: PERSON,
        name: s,
        handle: s,
        network: {type: 'string', enum: ['mutter', 'squint']},
        kind: {type: 'string', enum: ['post', 'reply', 'dm']},
        text: s,
        reply_to: s,
        mentions_shop: bool,
      },
      ['network', 'text'],
    ),
    run: async (env, i) =>
      Promise.resolve(
        asWorld(env, 'deliver_social_post', {
          ...pick(i, ['name', 'handle', 'network', 'kind', 'text', 'reply_to', 'mentions_shop']),
          ...(i['person'] === undefined ? {} : {customer_id: i['person']}),
        }),
      ),
  },
  {
    name: 'place_order',
    title: 'Someone places an order',
    description:
      'A person checks out on the shop’s website: items, delivery_method (default standard), payment (default a card that pays; declines and other outcomes are listed by the payment_methods tool). The shop’s stock, prices and money rules apply. Shows in Till, Stockroom and Tally.',
    input: schema({person: PERSON, items: ITEMS, delivery_method: s, payment: obj, address: obj}, [
      'person',
      'items',
    ]),
    run: async (env, i) =>
      Promise.resolve(
        asCustomer(env, str(i, 'person'), 'place_order', {
          items: (i['items'] as {sku: string; qty?: number}[]).map((x) => ({
            sku: x.sku,
            qty: x.qty ?? 1,
          })),
          delivery_method: i['delivery_method'] ?? 'standard',
          // WHY this card: the shop's test card that always pays. Name another in payment to test a decline.
          payment: i['payment'] ?? {method: 'card', card_number: '4242 4242 4242 4242'},
          ...pick(i, ['address']),
        }),
      ),
  },
  {
    name: 'change_order',
    title: 'Someone changes an order',
    description:
      'A person changes their order’s address or delivery method, or swaps a variant (swap {from_sku, to_sku}). Only before it is packed, as on the real site.',
    input: schema({person: PERSON, order_number: s, address: obj, delivery_method: s, swap: obj}, [
      'person',
      'order_number',
    ]),
    run: async (env, i) =>
      Promise.resolve(
        asCustomer(
          env,
          str(i, 'person'),
          'update_order',
          pick(i, ['order_number', 'address', 'delivery_method', 'swap']),
        ),
      ),
  },
  {
    name: 'cancel_order',
    title: 'Someone cancels an order',
    description: 'A person cancels an order that is not yet packed; the payment is refunded.',
    input: schema({person: PERSON, order_number: s, reason: s}, ['person', 'order_number']),
    run: async (env, i) =>
      Promise.resolve(
        asCustomer(env, str(i, 'person'), 'cancel_order', {
          order_number: str(i, 'order_number'),
          reason: i['reason'] ?? 'changed my mind',
        }),
      ),
  },
  {
    name: 'return_order',
    title: 'Someone returns an order',
    description:
      'A person starts a return: reason change_of_mind (postage deducted), faulty, damaged or wrong_item (free). items defaults to every line of the order. The returns policy applies.',
    input: schema(
      {
        person: PERSON,
        order_number: s,
        reason: {type: 'string', enum: ['change_of_mind', 'faulty', 'damaged', 'wrong_item']},
        items: ITEMS,
      },
      ['person', 'order_number', 'reason'],
    ),
    run: async (env: ActivityEnv, i: Record<string, unknown>): Promise<unknown> => {
      const person = str(i, 'person');
      const number = str(i, 'order_number');
      const items =
        (i['items'] as {sku: string; qty?: number}[] | undefined) ??
        orderOf(env, person, number).items;
      return Promise.resolve(
        asCustomer(env, person, 'create_return', {
          order_number: number,
          reason: i['reason'],
          items: items.map((x) => ({sku: x.sku, qty: x.qty ?? 1})),
        }),
      );
    },
  },
  {
    name: 'leave_review',
    title: 'Someone leaves a review',
    description:
      'A person reviews something from one of their delivered orders: rating 1 to 5 and text. It shows on the shop at once, and the help desk can answer it.',
    input: schema({person: PERSON, order_number: s, rating: int, text: s, sku: s}, [
      'person',
      'order_number',
      'rating',
      'text',
    ]),
    run: async (env, i) =>
      Promise.resolve(
        asCustomer(
          env,
          str(i, 'person'),
          'write_review',
          pick(i, ['order_number', 'rating', 'text', 'sku']),
        ),
      ),
  },
  {
    name: 'supplier_event',
    title: 'A supplier does something',
    description:
      'kind "delay": an open purchase order (purchase_order) arrives later (days later, or a new due date). kind "price": its prices change (price_factor, 1.1 = 10% more). kind "quantity": one line changes (sku, qty). kind "email": the supplier writes to suppliers@ (from_name, from_address, subject, body). Open orders are listed by call_business_tool list_purchase_orders as the buyer.',
    input: schema(
      {
        kind: {type: 'string', enum: ['delay', 'price', 'quantity', 'email']},
        purchase_order: s,
        days: int,
        due: s,
        price_factor: {type: 'number'},
        sku: s,
        qty: int,
        why: s,
        from_name: s,
        from_address: s,
        subject: s,
        body: s,
      },
      ['kind'],
    ),
    run: async (env, i) => Promise.resolve(supplierEvent(env, i)),
  },
  {
    name: 'staff_event',
    title: 'A member of staff does something',
    description:
      'kind "message": a member of staff (staff_id, e.g. S-03) says something in Kettle, the team chat: in a channel (channel) or to one person (to). kind "hours": their weekly hours change from the next day (weekly_hours; 0 is off until changed back). Staff ids come from call_business_tool list_staff.',
    input: schema(
      {
        kind: {type: 'string', enum: ['message', 'hours']},
        staff_id: s,
        text: s,
        channel: s,
        to: s,
        weekly_hours: {type: 'number'},
        reason: s,
      },
      ['kind', 'staff_id'],
    ),
    run: async (env, i) => Promise.resolve(staffEvent(env, i)),
  },
  {
    name: 'meeting_request',
    title: 'Someone outside asks to meet',
    description:
      'Someone outside the company asks for a meeting or a call: a supplier (supplier_id fills in its contact person), a partner or a customer (from_name, from_email, organisation). title, start (a time, 2026-11-24T10:00), minutes (default 30), kind (meeting or supplier_call), invite (staff ids; default the buyer for a supplier, else the manager), notes, where. It waits in the Calendar as tentative until someone accepts (update_event status confirmed) or declines (cancel_event).',
    input: schema(
      {
        title: s,
        start: s,
        minutes: int,
        kind: {type: 'string', enum: ['meeting', 'supplier_call']},
        supplier_id: s,
        from_name: s,
        from_email: s,
        organisation: s,
        invite: {type: 'array', items: s},
        notes: s,
        where: s,
      },
      ['title', 'start'],
    ),
    run: async (env, i) =>
      Promise.resolve(
        asWorld(
          env,
          'receive_meeting_request',
          pick(i, [
            'title',
            'start',
            'minutes',
            'kind',
            'supplier_id',
            'from_name',
            'from_email',
            'organisation',
            'invite',
            'notes',
            'where',
          ]),
        ),
      ),
  },
  {
    name: 'world_event',
    title: 'Something happens in the wider world',
    description:
      'A world event: a template from the event library (template; list them with call_business_tool list_event_templates as manager), or your own (title, story, effects, start, duration_days). effects use the simulator’s keys: demand, visits, contact_rate, carrier_delay_days, supplier_late_chance, costs. Its news appears in The Daily Overthinker.',
    input: schema({
      template: s,
      title: s,
      story: s,
      effects: obj,
      start: s,
      duration_days: int,
      end: s,
    }),
    run: async (env, i) =>
      Promise.resolve(
        asRole(
          env,
          'manager',
          'add_world_event',
          pick(i, ['template', 'title', 'story', 'effects', 'start', 'duration_days', 'end']),
        ),
      ),
  },
  {
    name: 'call_business_tool',
    title: 'Use any business tool',
    description:
      'Calls one of the business’s own tools as a role (default manager), for look-ups (search_catalogue, list_staff, list_purchase_orders, get_order) or for something a person in the company does. The engine’s role rules apply. List tools with GET /tools.',
    input: schema({role: s, tool: s, input: obj}, ['tool']),
    run: async (env, i) =>
      Promise.resolve(
        asRole(
          env,
          typeof i['role'] === 'string' ? i['role'] : 'manager',
          str(i, 'tool'),
          (i['input'] ?? {}) as Record<string, unknown>,
        ),
      ),
  },
  {
    name: 'advance_time',
    title: 'Move time on',
    description:
      'Moves the business on by days (1 to 366): the simulator’s own customers order and write in, staff work, parcels and suppliers move, scheduled activity happens on its day, and a deployed product gets its work. Returns each day’s summary.',
    input: schema({days: int}, ['days']),
    run: async (env: ActivityEnv, i: Record<string, unknown>): Promise<unknown> => {
      const days = i['days'];
      if (typeof days !== 'number' || !Number.isInteger(days))
        refuse('invalid_input', '"days" must be a whole number.');
      const out = await env.store.advance(env.sandbox, env.principal, days, env.via);
      return {now: out.now, days: out.days.map((d) => d.summary)};
    },
  },
  {
    name: 'schedule',
    title: 'Schedule an action',
    description:
      'Runs an action later in simulated time: at (a date, YYYY-MM-DD, or a time) or in_days from now. It runs when time reaches that day (advance_time). action and input are as for that action. Use it to spread activity across days, the way real people arrive.',
    input: schema({at: s, in_days: int, action: s, input: obj}, ['action']),
    run: async (env, i) => Promise.resolve(addToSchedule(env, i)),
  },
  {
    name: 'list_schedule',
    title: 'List scheduled actions',
    description: 'Scheduled actions, waiting and done, with what each did.',
    input: schema({}),
    readOnly: true,
    run: async (env) => Promise.resolve(listSchedule(env)),
  },
  {
    name: 'batch',
    title: 'Run several actions',
    description:
      'Runs a list of actions in order: actions [{"action": "...", "input": {...}}]. Each result is returned; stop_on_error stops at the first refusal (default false: a refusal is often the point of the test).',
    input: schema({actions: {type: 'array', items: obj}, stop_on_error: bool}, ['actions']),
    run: async (env: ActivityEnv, i: Record<string, unknown>): Promise<unknown> => {
      const list = i['actions'];
      if (!Array.isArray(list) || list.length > 1000)
        refuse('invalid_input', '"actions" must be a list of up to 1,000 actions.');
      const results: ActionResult[] = [];
      for (const step of list as {action?: unknown; input?: unknown}[]) {
        const r = await perform(
          env,
          String(step.action),
          (step.input ?? {}) as Record<string, unknown>,
        );
        results.push(r);
        if (!r.ok && i['stop_on_error'] === true) break;
      }
      return {ran: results.length, failed: results.filter((r) => !r.ok).length, results};
    },
  },
  {
    name: 'observe',
    title: 'See what happened',
    description:
      'What happened in the sandbox since a point in its trace (since, a seq number; 0 for everything): every tool call a product made, every reply, every activity and every time move, newest last, at most limit (default 100). Also the clock. Use the last seq as the next since.',
    input: schema({since: int, limit: int, kind: s}),
    readOnly: true,
    run: async (env, i) => Promise.resolve(observe(env, i)),
  },
  {
    name: 'impact',
    title: 'Compare with the business left alone',
    description:
      'This business minus its shadow twin (the same business from the same start and luck, where nothing outside was done), for the headline measures: money first. Zeros until time has moved.',
    input: schema({}),
    readOnly: true,
    run: async (env) => env.store.impact(env.sandbox),
  },
  {
    name: 'reset',
    title: 'Start again',
    description:
      'Puts the sandbox back exactly as it began: every record, the clock, the people you made, the schedule and the trace.',
    input: schema({}),
    run: async (env: ActivityEnv): Promise<unknown> => {
      env.store.reset(env.sandbox);
      return Promise.resolve({reset: true, now: env.sandbox.world.state.now});
    },
  },
];

const BY_NAME = new Map(ACTIONS.map((a) => [a.name, a]));

/** The action called `name`, or undefined. */
export function actionNamed(name: string): ActionDef | undefined {
  return BY_NAME.get(name);
}

/**
 * Runs one action, writes it to the trace, then lets anything deployed on the sandbox react (a product answers the
 * message that just arrived). A refusal is a result, not an exception: callers report it to the agent.
 */
export async function perform(
  env: ActivityEnv,
  name: string,
  input: Record<string, unknown>,
): Promise<ActionResult> {
  const def = BY_NAME.get(name);
  let result: ActionResult;
  try {
    // WHY: `overthink view` serves a finished run read-only; activity there would rewrite what the run did.
    if ((env.store as {readOnly?: boolean}).readOnly === true)
      refuse(
        'forbidden',
        'This is a finished run, shown read-only. Activity needs a live sandbox (overthink up).',
      );
    if (def === undefined)
      refuse(
        'not_found',
        `There is no action "${name}". Actions: ${ACTIONS.map((a) => a.name).join(', ')}.`,
      );
    checkInput(def.input, input);
    result = {ok: true, action: name, data: await def.run(env, input)};
  } catch (e) {
    if (!(e instanceof ActivityError)) throw e;
    result = {ok: false, action: name, error: {code: e.code, message: e.message}};
  }
  // WHY not for batch, reads or time moves: a batch's steps record themselves; reads change nothing; a time move is
  // already in the trace as kind "advance".
  if (
    def !== undefined &&
    def.readOnly !== true &&
    name !== 'batch' &&
    name !== 'advance_time' &&
    name !== 'reset'
  ) {
    env.store.record(env.sandbox, {
      kind: 'activity',
      via: env.via,
      actor: {token: env.principal.id, role: 'owner'},
      action: name,
      input,
      ok: result.ok,
      ...(result.ok ? {result: result.data} : {error: result.error}),
    });
  }
  if (result.ok && def?.readOnly !== true)
    for (const h of hooksOf(env.sandbox).afterActivity) await h(env.sandbox);
  return result;
}

/** Required keys and basic types, so a mistake comes back as one plain sentence. */
function checkInput(schema: InputSchema, input: Record<string, unknown>): void {
  if (typeof input !== 'object' || Array.isArray(input))
    refuse('invalid_input', 'The input must be a JSON object.');
  for (const key of schema.required ?? []) {
    if (input[key] === undefined || input[key] === null)
      refuse('invalid_input', `Missing "${key}".`);
  }
  for (const key of Object.keys(input)) {
    const def = schema.properties[key];
    if (def === undefined)
      refuse(
        'invalid_input',
        `Unknown field "${key}". Fields: ${Object.keys(schema.properties).join(', ') || 'none'}.`,
      );
    const v = input[key];
    const t = def['type'];
    const ok =
      t === 'integer'
        ? Number.isInteger(v)
        : t === 'array'
          ? Array.isArray(v)
          : t === 'object'
            ? typeof v === 'object' && v !== null && !Array.isArray(v)
            : typeof v === t;
    if (!ok)
      refuse(
        'invalid_input',
        `"${key}" must be ${t === 'integer' ? 'a whole number' : `a ${String(t)}`}.`,
      );
    const allowed = def['enum'];
    if (Array.isArray(allowed) && !allowed.includes(v))
      refuse('invalid_input', `"${key}" must be one of: ${allowed.join(', ')}.`);
  }
}

function supplierEvent(env: ActivityEnv, i: Record<string, unknown>): unknown {
  const kind = i['kind'];
  if (kind === 'email') {
    return asWorld(env, 'deliver_email', {
      mailbox: 'suppliers',
      ...pick(i, ['from_name', 'from_address', 'subject', 'body']),
    });
  }
  const number = str(i, 'purchase_order');
  const change: Record<string, unknown> = {number, why: i['why'] ?? 'supplier event (activity)'};
  if (kind === 'delay') {
    if (i['due'] !== undefined) change['due'] = i['due'];
    else {
      const po = (
        env.sandbox.world.state['purchase_orders'] as
          {number: string; due_at?: string; expected_at?: string | null}[] | undefined
      )?.find((p) => p.number === number);
      const due = po?.expected_at ?? po?.due_at;
      if (due === undefined)
        refuse('not_found', `There is no open purchase order ${number} with a due date.`);
      const days = typeof i['days'] === 'number' ? i['days'] : 7;
      change['due'] = new Date(Date.parse(`${due.slice(0, 10)}T12:00:00Z`) + days * 86400000)
        .toISOString()
        .slice(0, 10);
    }
  } else if (kind === 'price') change['price_factor'] = i['price_factor'];
  else if (kind === 'quantity') Object.assign(change, pick(i, ['sku', 'qty']));
  return asWorld(env, 'apply_supplier_change', change);
}

function staffEvent(env: ActivityEnv, i: Record<string, unknown>): unknown {
  const staff = str(i, 'staff_id');
  if (i['kind'] === 'hours') {
    return asRole(env, 'manager', 'set_staffing', {
      action: 'hours',
      staff_id: staff,
      weekly_hours: i['weekly_hours'],
      ...pick(i, ['reason']),
    });
  }
  if (i['channel'] === undefined && i['to'] === undefined)
    refuse('invalid_input', 'Say where: channel (a Kettle channel) or to (a staff id).');
  // WHY the manager: only the manager may speak as anyone (send_chat_message's `as`), which is what this is.
  return asRole(env, 'manager', 'send_chat_message', {
    as: staff,
    text: str(i, 'text'),
    ...pick(i, ['channel', 'to']),
  });
}

function observe(env: ActivityEnv, i: Record<string, unknown>): unknown {
  const since = typeof i['since'] === 'number' ? i['since'] : 0;
  const limit = Math.min(500, typeof i['limit'] === 'number' ? i['limit'] : 100);
  const kind = typeof i['kind'] === 'string' ? i['kind'] : null;
  const entries = env.sandbox.trace.filter(
    (t) => t.seq > since && (kind === null || t.kind === kind),
  );
  const shown = entries.slice(0, limit);
  return {
    clock: env.store.simClock(env.sandbox),
    total: entries.length,
    entries: shown,
    last: shown.at(-1)?.seq ?? since,
    more: entries.length > shown.length,
  };
}
