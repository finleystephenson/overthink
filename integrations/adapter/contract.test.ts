import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ContractError, parseAnswer} from './contract.ts';
import {AdapterError, checkAdapter} from './load.ts';

test('parseAnswer accepts a reply alone', () => {
  assert.deepEqual(parseAnswer({reply: 'Hello'}), {reply: 'Hello', toolCalls: []});
});

test('parseAnswer accepts short and OpenAI-shaped tool calls', () => {
  const a = parseAnswer({
    tool_calls: [
      {name: 'get_order', arguments: {order_number: 'ORD-1'}},
      {
        id: 'x9',
        type: 'function',
        function: {name: 'verify_customer', arguments: '{"reference":"ORD-1"}'},
      },
    ],
  });
  assert.equal(a.reply, null);
  assert.deepEqual(a.toolCalls, [
    {id: 'call_1', name: 'get_order', arguments: {order_number: 'ORD-1'}},
    {id: 'x9', name: 'verify_customer', arguments: {reference: 'ORD-1'}},
  ]);
});

test('parseAnswer explains what is wrong', () => {
  assert.throws(() => parseAnswer('hi'), ContractError);
  assert.throws(() => parseAnswer({reply: 3}), /"reply" must be a string/);
  assert.throws(() => parseAnswer({tool_calls: {}}), /"tool_calls" must be a list/);
  assert.throws(
    () => parseAnswer({tool_calls: [{arguments: {}}]}),
    /tool_calls\[0\] needs a "name"/,
  );
  assert.throws(
    () => parseAnswer({tool_calls: [{name: 'x', arguments: '{bad'}]}),
    /not valid JSON/,
  );
});

test('an empty object is a valid answer that says nothing', () => {
  assert.deepEqual(parseAnswer({}), {reply: null, toolCalls: []});
});

test('checkAdapter types each transport and rejects mistakes in plain words', () => {
  assert.equal(checkAdapter({transport: 'http', url: 'http://localhost:1/'}).transport, 'http');
  assert.equal(
    checkAdapter({transport: 'command', command: 'node a.mjs', version: '1'}).transport,
    'command',
  );
  const o = checkAdapter({
    transport: 'openai',
    baseUrl: 'http://x/v1',
    model: 'm',
    systemPromptFile: 'p.txt',
  });
  assert.equal(o.transport === 'openai' ? o.model : null, 'm');
  assert.throws(() => checkAdapter({transport: 'smoke'}), AdapterError);
  assert.throws(() => checkAdapter({transport: 'http', url: 'ftp://x'}), /must start with http/);
  assert.throws(() => checkAdapter({transport: 'command'}), /"command" must be a non-empty string/);
  assert.throws(
    () => checkAdapter({transport: 'http', url: 'http://x', maxSteps: -1}),
    /positive number/,
  );
});
