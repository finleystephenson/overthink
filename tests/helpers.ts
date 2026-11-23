/**
 * @fileoverview Small helpers shared by the tests: an in-process product and a loaded adapter that needs no file.
 */
import type {Turn} from '../integrations/adapter/contract.ts';
import type {LoadedAdapter} from '../integrations/adapter/load.ts';
import type {Transport} from '../integrations/adapter/transports.ts';

/** A transport that answers in-process, so tests need no server or child process. */
export function fakeTransport(answer: (turn: Turn) => unknown): Transport & {turns: Turn[]} {
  const turns: Turn[] = [];
  return {
    kind: 'command',
    turns,
    send(turn) {
      turns.push(turn);
      return Promise.resolve(answer(turn));
    },
    close: () => Promise.resolve(),
  };
}

/** A product that verifies and looks up the order when it can, and otherwise asks for the details. */
export function lookupProduct(turn: Turn): unknown {
  const last = turn.conversation.at(-1);
  if (last?.role === 'tool')
    return {reply: 'I have checked your order: it is on its way and should arrive soon.'};
  const text = turn.conversation
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ');
  const order = /ORD-\d+/.exec(text)?.[0];
  const postcode = /[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}/.exec(text)?.[0];
  if (order !== undefined && postcode !== undefined) {
    return {
      tool_calls: [
        {name: 'verify_customer', arguments: {reference: order, email_or_postcode: postcode}},
        {name: 'get_order', arguments: {order_number: order}},
      ],
    };
  }
  return {reply: 'Could you give me your order number and postcode?'};
}

/** An adapter description for tests; the transport is passed separately. */
export function testAdapter(name = 'test product'): LoadedAdapter {
  return {
    config: {transport: 'command', command: 'none', name, version: 'test'},
    baseDir: process.cwd(),
    source: name,
  };
}
