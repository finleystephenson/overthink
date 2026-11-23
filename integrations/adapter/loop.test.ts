import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SandboxStore} from '../../infrastructure/server/sandboxes.mjs';
import {fakeTransport} from '../../tests/helpers.ts';
import {sandboxGateway} from './gateway.ts';
import {runProductTurn} from './loop.ts';
import type {TurnContext} from './loop.ts';
import type {Message} from './contract.ts';

function setup(scope: {read: string[]; act: string[]} | null): {
  ctx: (answer: Parameters<typeof fakeTransport>[0]) => TurnContext;
  trace: () => {tool?: string; ok?: boolean; error?: unknown; actor?: {session?: string}}[];
  done: () => void;
  gatewayTools: string[];
} {
  const store = new SandboxStore({maxSandboxes: 1, plugins: []});
  const {sandbox} = store.create({size: 'demo'});
  const gateway = sandboxGateway({store, sandbox, role: 'assistant', scope});
  return {
    ctx: (answer) => ({
      transport: fakeTransport(answer),
      gateway,
      sessionId: 'c1',
      who: {kind: 'customer', name: 'Mr Toad', channel: 'web_chat'},
      now: sandbox.world.state.now,
      business: {name: 'Overthought & Co.', role: 'assistant', instructions: ''},
    }),
    trace: () => sandbox.trace.filter((e) => e.kind === 'tool'),
    done: () => {
      store.remove(sandbox.id);
    },
    gatewayTools: gateway.schemas.map((s) => s.function.name),
  };
}

test('tools offered follow the role and the scope', () => {
  const all = setup(null);
  const narrow = setup({read: ['catalogue'], act: []});
  assert.ok(all.gatewayTools.includes('get_order'));
  assert.ok(
    !all.gatewayTools.includes('create_purchase_order'),
    'the assistant role cannot buy stock',
  );
  assert.ok(narrow.gatewayTools.includes('search_catalogue'));
  assert.ok(!narrow.gatewayTools.includes('get_order'));
  all.done();
  narrow.done();
});

test('the loop runs tool calls, sends results back, and ends on a reply', async () => {
  const s = setup(null);
  const conversation: Message[] = [{role: 'user', content: 'Do you sell skimming stones?'}];
  const r = await runProductTurn(
    s.ctx((turn) =>
      turn.conversation.at(-1)?.role === 'tool'
        ? {reply: 'Yes, we do.'}
        : {tool_calls: [{name: 'search_catalogue', arguments: {query: 'skimming'}}]},
    ),
    conversation,
  );
  assert.equal(r.reply, 'Yes, we do.');
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0]?.ok, true);
  assert.deepEqual(
    conversation.map((m) => m.role),
    ['user', 'assistant', 'tool', 'assistant'],
  );
  assert.equal(s.trace().at(-1)?.actor?.session, 'c1', 'calls are recorded under the conversation');
  s.done();
});

test('calls outside the scope or the role are refused and recorded', async () => {
  const s = setup({read: ['catalogue', 'orders'], act: []});
  const r = await runProductTurn(
    s.ctx((turn) =>
      turn.conversation.at(-1)?.role === 'tool'
        ? {reply: 'Done.'}
        : {
            tool_calls: [
              {name: 'issue_refund', arguments: {order_number: 'ORD-1', amount: 5}},
              {name: 'create_purchase_order', arguments: {}},
            ],
          },
    ),
    [{role: 'user', content: 'Refund me.'}],
  );
  assert.deepEqual(
    r.calls.map((c) => [c.name, c.code, c.refused]),
    [
      ['issue_refund', 'out_of_scope', true],
      ['create_purchase_order', 'out_of_scope', true],
    ],
  );
  assert.equal(s.trace().filter((e) => e.ok === false).length, 2, 'refusals are in the trace');
  s.done();
});

test('a role refusal comes from the engine itself', async () => {
  const s = setup(null);
  const r = await runProductTurn(
    s.ctx((turn) =>
      turn.conversation.at(-1)?.role === 'tool'
        ? {reply: 'ok'}
        : {tool_calls: [{name: 'create_purchase_order', arguments: {}}]},
    ),
    [{role: 'user', content: 'x'}],
  );
  const call = r.calls[0];
  assert.ok(call);
  assert.equal(call.code, 'forbidden');
  assert.equal(call.refused, true);
  s.done();
});

test('the loop stops a product that never replies, and reports a broken contract', async () => {
  const s = setup(null);
  const looping = await runProductTurn(
    {
      ...s.ctx(() => ({tool_calls: [{name: 'search_catalogue', arguments: {query: 'x'}}]})),
      maxSteps: 3,
    },
    [{role: 'user', content: 'x'}],
  );
  assert.match(looping.error ?? '', /3 times without replying/);
  assert.equal(looping.calls.length, 3);
  const broken = await runProductTurn(
    s.ctx(() => ({reply: 42})),
    [{role: 'user', content: 'x'}],
  );
  assert.match(broken.error ?? '', /broke the contract: "reply" must be a string/);
  s.done();
});
