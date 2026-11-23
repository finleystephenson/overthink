/**
 * @fileoverview The activity toolkit: every verb lands as the records the apps read, the shop's rules apply to
 * synthetic people, profiles stay hidden from business roles, scheduled actions run on their day, reset forgets it
 * all, and only the owner key reaches the toolset (HTTP and MCP).
 */
import assert from 'node:assert/strict';
import type {AddressInfo} from 'node:net';
import {test} from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {SandboxStore} from '../infrastructure/server/sandboxes.mjs';
import {createApp} from '../infrastructure/server/http.mjs';
import {ActivityClient, openActivity} from './api.ts';
import {ACTIONS} from './actions.ts';
import {parseActArgs} from './cli.ts';

type Row = Record<string, unknown>;

function fresh(): {
  store: SandboxStore;
  act: ReturnType<typeof openActivity>;
  state: Record<string, unknown>;
} {
  const store = new SandboxStore({plugins: []});
  const {sandbox} = store.create({size: 'demo'});
  return {store, act: openActivity(store, sandbox), state: sandbox.world.state};
}

const rows = (state: Record<string, unknown>, key: string): Row[] => (state[key] ?? []) as Row[];

test('people drawn from the population are spread across it, and their profiles are hidden from the business', async () => {
  const {store, act} = fresh();
  const people = await act.createPeople({count: 12});
  assert.equal(new Set(people.map((p) => p.customer_id)).size, 12);
  assert.ok(new Set(people.map((p) => p.profile.age)).size >= 3, 'more than one or two age bands');
  assert.ok(
    people.every((p) => p.profile.source === 'population' && /^OT\d \d[A-Z]{2}$/.test(p.postcode)),
  );
  const sb = [...store.sandboxes.values()][0];
  assert.ok(sb !== undefined);
  for (const role of ['assistant', 'support_agent', 'manager']) {
    assert.equal(sb.world.session({role}).call('list_synthetic_people', {}).ok, false, role);
  }
  const narrowed = await act.createPeople({count: 3, where: {online: 'never'}});
  assert.ok(narrowed.every((p) => p.profile.online === 'never'));
});

test('a described person keeps the words they were made from, and memory grows with what they do', async () => {
  const {act} = fresh();
  const [p] = await act.createPeople({
    from: 'described',
    name: 'Priya Shah',
    description: 'Works nights; shops on her phone after a shift.',
    profile: {patience: 'low', assumptions: ['night shifts mean short replies']},
  });
  assert.ok(p !== undefined);
  await act.sendMessage({person: p.customer_id, text: 'Do you deliver on Saturdays?'});
  await act.run('remember', {person: p.customer_id, line: 'Was told: no Saturday delivery.'});
  const {people} = (await act.run('list_people')) as {
    people: {name: string; profile: Row; memory: {line: string}[]}[];
  };
  const me = people.find((x) => x.name === 'Priya Shah');
  assert.ok(me !== undefined);
  assert.equal(me.profile['description'], 'Works nights; shops on her phone after a shift.');
  assert.deepEqual(
    me.memory.map((m) => m.line),
    [
      'Started a web_chat conversation: "Do you deliver on Saturdays?"',
      'Was told: no Saturday delivery.',
    ],
  );
});

test('emails, chats and posts arrive where the apps read them, each with a waiting Front Desk contact', async () => {
  const {act, state} = fresh();
  const [p] = await act.createPeople();
  assert.ok(p !== undefined);
  const mail = await act.sendEmail({
    person: p.customer_id,
    subject: 'Late parcel',
    body: 'It has not come.',
  });
  const email = rows(state, 'emails').find((e) => e['id'] === mail.email_id);
  assert.ok(email !== undefined);
  assert.equal(email['mailbox'], 'hello');
  assert.equal(email['folder'], 'inbox');
  const chat = await act.sendMessage({person: p.customer_id, text: 'Hello?', channel: 'text'});
  assert.equal(
    rows(state, 'conversations').find((c) => c['id'] === chat.conversation_id)?.['channel'],
    'text',
  );
  const dm = await act.post({
    person: p.customer_id,
    network: 'squint',
    kind: 'dm',
    text: 'Is the tin in stock?',
  });
  const plain = await act.post({person: p.customer_id, network: 'mutter', text: 'Nice weather.'});
  assert.ok(rows(state, 'social_posts').some((x) => x['id'] === dm.post_id && x['kind'] === 'dm'));
  const contacts = rows(state, 'contacts').filter((c) => c['source'] === 'activity');
  assert.deepEqual(
    contacts.map((c) => [c['channel'], c['outcome']]),
    [
      ['email', 'waiting'],
      ['text', 'waiting'],
      ['squint_dm', 'waiting'],
    ],
    'a plain post that does not mention the shop raises no contact',
  );
  assert.ok(rows(state, 'social_posts').some((x) => x['id'] === plain.post_id));
});

test('synthetic people meet the shop’s own rules: orders, changes, returns and cancellations', async () => {
  const {act, state} = fresh();
  const [p] = await act.createPeople();
  assert.ok(p !== undefined);
  const stock = state['stock'] as Record<string, {on_hand: number}>;
  const sku = Object.entries(stock).find(([, v]) => v.on_hand > 5)?.[0] ?? '';
  const order = (await act.placeOrder({person: p.customer_id, items: [{sku}]})) as {number: string};
  assert.match(order.number, /^ORD-/);
  const early = await act.perform('return_order', {
    person: p.customer_id,
    order_number: order.number,
    reason: 'faulty',
  });
  assert.equal(early.ok, false, 'nothing can be returned before it is delivered');
  assert.ok(
    (await act.perform('cancel_order', {person: p.customer_id, order_number: order.number})).ok,
  );
  const declined = await act.perform('place_order', {
    person: p.customer_id,
    items: [{sku}],
    payment: {method: 'card', card_number: '4000 0000 0000 0002'},
  });
  assert.equal(declined.ok, false, 'a declined card is refused by the shop, not by the toolkit');
});

test('supplier, staff and world events go through the engine', async () => {
  const {act, state} = fresh();
  const po = rows(state, 'purchase_orders').find((x) => x['status'] === 'ordered');
  assert.ok(po !== undefined);
  const before = String(po['expected_at'] ?? po['due_at']);
  assert.ok(
    (
      await act.perform('supplier_event', {
        kind: 'delay',
        purchase_order: String(po['number']),
        days: 5,
      })
    ).ok,
  );
  assert.ok(String(po['expected_at'] ?? po['due_at']) > before, JSON.stringify(po));
  const mail = await act.perform('supplier_event', {
    kind: 'email',
    from_name: 'Boxworks',
    from_address: 'orders@boxworks.example',
    subject: 'Prices',
    body: 'Up 5% in January.',
  });
  assert.ok(mail.ok);
  assert.ok(
    rows(state, 'emails').some((e) => e['mailbox'] === 'suppliers' && e['subject'] === 'Prices'),
  );
  const said = await act.perform('staff_event', {
    kind: 'message',
    staff_id: 'S-03',
    channel: 'general',
    text: 'The printer is jammed.',
  });
  assert.ok(said.ok, JSON.stringify(said));
  const today = String(state['now']).slice(0, 10);
  const event = await act.perform('world_event', {
    title: 'Heatwave',
    story: 'A hot week.',
    effects: {demand: {all: 1.1}},
    start: today,
    duration_days: 3,
  });
  assert.ok(event.ok, JSON.stringify(event));
});

test('scheduled actions run on their day; batches report each step; reset forgets everything', async () => {
  const {act, state} = fresh();
  const [p] = await act.createPeople();
  assert.ok(p !== undefined);
  await act.schedule({
    in_days: 2,
    action: 'send_email',
    input: {person: p.customer_id, subject: 'Still nothing', body: 'Any news?'},
  });
  await act.advanceTime(1);
  assert.ok(!rows(state, 'emails').some((e) => e['subject'] === 'Still nothing'), 'not yet');
  await act.advanceTime(2);
  assert.ok(
    rows(state, 'emails').some((e) => e['subject'] === 'Still nothing'),
    'arrived on its day',
  );
  const b = await act.batch([
    {action: 'send_message', input: {person: p.customer_id, text: 'Hi'}},
    {
      action: 'leave_review',
      input: {person: p.customer_id, order_number: 'ORD-0', rating: 5, text: 'x'},
    },
    {action: 'no_such_action'},
  ]);
  assert.deepEqual([b.ran, b.failed], [3, 2]);
  const seen = await act.observe(0, 500);
  assert.ok(seen.entries.some((e) => e['kind'] === 'activity' && e['action'] === 'send_message'));
  assert.ok(seen.entries.some((e) => e['kind'] === 'advance'));
  await act.reset();
  const after = openActivity(act.env.store, act.env.sandbox).env.sandbox.world.state;
  assert.equal(rows(after, 'synthetic_people').length, 0);
  assert.equal(rows(after, 'activity_schedule').length, 0);
  assert.equal(act.env.sandbox.trace.length, 0);
});

test('a mistake in an action’s input comes back as one plain sentence', async () => {
  const {act} = fresh();
  const r = await act.perform('send_email', {subject: 'x', body: 'y', colour: 'blue'});
  assert.ok(!r.ok);
  assert.match(r.error.message, /Unknown field "colour"/);
});

test('every action has a schema, a description and a CLI spelling', () => {
  for (const a of ACTIONS) {
    assert.ok(a.description.length > 40, a.name);
    assert.equal(a.input.type, 'object', a.name);
    assert.match(a.name, /^[a-z_]+$/);
  }
  const send = ACTIONS.find((a) => a.name === 'place_order');
  assert.ok(send !== undefined);
  assert.deepEqual(parseActArgs(send, ['--person', 'C-1', '--items', '[{"sku":"A"}]']), {
    person: 'C-1',
    items: [{sku: 'A'}],
  });
});

test('only the owner key reaches the toolset, over HTTP and MCP', async () => {
  const store = new SandboxStore({plugins: []});
  const {sandbox, token} = store.create({size: 'demo'});
  const role = store.mintRoleToken(sandbox, {role: 'assistant'}).token;
  const server = createApp({store});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const owner = new ActivityClient({url, sandbox: sandbox.id, key: token});
    const made = await owner.createPeople({count: 1});
    assert.equal(made.length, 1);
    const product = await new ActivityClient({url, sandbox: sandbox.id, key: role}).perform(
      'create_person',
      {},
    );
    assert.ok(!product.ok);
    assert.equal(product.error.code, 'forbidden');
    const asProduct = await fetch(`${url}/tools/add_synthetic_person`, {
      method: 'POST',
      headers: {authorization: `Bearer ${role}`},
      body: JSON.stringify({name: 'Mallory'}),
    }).then((r) => r.json() as Promise<{ok: boolean}>);
    assert.equal(asProduct.ok, false, 'the world lens tools are not business tools');

    const client = new Client({name: 'test', version: '1'});
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${url}/mcp/activity`), {
        requestInit: {headers: {authorization: `Bearer ${token}`}},
      }),
    );
    const {tools} = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name),
      ACTIONS.map((a) => a.name),
    );
    const listed = await client.callTool({name: 'list_people', arguments: {}});
    assert.equal(listed.isError, false);
    await client.close();
    const refused = await fetch(`${url}/mcp/activity`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${role}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: {name: 'x', version: '1'},
        },
      }),
    });
    assert.equal(refused.status, 403);
  } finally {
    server.close();
  }
});
