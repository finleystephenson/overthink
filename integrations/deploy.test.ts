/**
 * @fileoverview A deployed product answers the activity on its channels, where the person wrote, and only that.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SandboxStore} from '../infrastructure/server/sandboxes.mjs';
import {openActivity} from '../activity-generation/api.ts';
import {fakeTransport} from '../tests/helpers.ts';
import {deployProduct} from './deploy.ts';

type Row = Record<string, unknown>;

test('the product answers chats, emails and DMs as they arrive, and again when the person writes back', async () => {
  const store = new SandboxStore({plugins: []});
  const {sandbox} = store.create({size: 'demo'});
  const transport = fakeTransport((turn) => ({
    reply: `Answer ${String(turn.conversation.length)}`,
  }));
  deployProduct({
    store,
    sandbox,
    transport,
    channels: ['web_chat', 'email', 'mutter_dm'],
    role: 'assistant',
    scope: null,
    instructions: 'Help.',
  });
  const act = openActivity(store, sandbox);
  const [p] = await act.createPeople();
  assert.ok(p !== undefined);
  const st = sandbox.world.state as Record<string, unknown>;

  const chat = await act.sendMessage({person: p.customer_id, text: 'Hello'});
  const conv = (st['conversations'] as Row[]).find((c) => c['id'] === chat.conversation_id);
  assert.deepEqual(
    (conv?.['messages'] as Row[]).map((m) => m['from']),
    ['customer', 'assistant'],
  );
  await act.sendMessage({
    person: p.customer_id,
    text: 'And another thing',
    conversation_id: chat.conversation_id,
  });
  assert.equal(
    (conv?.['messages'] as Row[]).at(-1)?.['text'],
    'Answer 3',
    'it saw the whole conversation',
  );

  const mail = await act.sendEmail({person: p.customer_id, subject: 'Hi', body: 'A question'});
  const thread = (st['emails'] as Row[]).filter((e) => e['thread_id'] === mail.contact_id);
  assert.deepEqual(
    thread.map((e) => e['folder']),
    ['inbox', 'sent'],
  );

  await act.post({person: p.customer_id, network: 'mutter', kind: 'dm', text: 'Psst'});
  const dms = (st['social_posts'] as Row[]).filter(
    (x) =>
      x['kind'] === 'dm' &&
      x['network'] === 'mutter' &&
      String(x['thread']).includes(p.customer_id),
  );
  assert.deepEqual(
    dms.map((x) => (x['author'] as Row)['kind']),
    ['customer', 'company'],
  );

  await act.sendMessage({person: p.customer_id, text: 'By phone', channel: 'phone'});
  const phone = (st['contacts'] as Row[]).find(
    (c) => c['channel'] === 'phone' && c['source'] === 'activity',
  );
  assert.equal(phone?.['handled_by'], null, 'phone is not one of its channels: staff have it');
  assert.equal(transport.turns.length, 4);
  assert.ok(sandbox.trace.some((t) => t.kind === 'reply' && t['ok'] === true));
});
