import assert from 'node:assert/strict';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {test} from 'node:test';
import {CONTRACT_VERSION} from './contract.ts';
import type {Turn} from './contract.ts';
import {
  TransportError,
  answerFromCompletion,
  commandTransport,
  httpTransport,
  openAiTransport,
} from './transports.ts';

const TURN: Turn = {
  overthink: CONTRACT_VERSION,
  session_id: 's1',
  who: {kind: 'customer', name: 'Mr Toad', channel: 'web_chat'},
  conversation: [{role: 'user', content: 'Where is my order?'}],
  tools: [],
  now: '2026-11-22T10:00:00Z',
  business: {name: 'Overthought & Co.', role: 'assistant', instructions: 'Help.'},
};

/** Starts a local server answering each POST with `answer(body)`; returns its URL and a stop function. */
async function serve(
  answer: (body: unknown) => unknown,
): Promise<{url: string; stop: () => Promise<void>}> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      res
        .writeHead(200, {'Content-Type': 'application/json'})
        .end(JSON.stringify(answer(JSON.parse(body))));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    stop: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

test('command transport: one JSON line in, one out, in order', async () => {
  const script = `process.stdin.setEncoding("utf8");let b="";process.stdin.on("data",d=>{b+=d;let i;while((i=b.indexOf("\\n"))>=0){const t=JSON.parse(b.slice(0,i));b=b.slice(i+1);process.stdout.write(JSON.stringify({reply:"seen "+t.session_id})+"\\n")}})`;
  const t = commandTransport({command: `node -e '${script}'`});
  try {
    const [a, b] = await Promise.all([t.send(TURN), t.send({...TURN, session_id: 's2'})]);
    assert.deepEqual(a, {reply: 'seen s1'});
    assert.deepEqual(b, {reply: 'seen s2'});
  } finally {
    await t.close();
  }
});

test('command transport: a silent command times out with a plain error', async () => {
  const t = commandTransport({command: 'node -e "setInterval(()=>{},1000)"', timeoutMs: 300});
  await assert.rejects(
    t.send(TURN),
    (e: unknown) => e instanceof TransportError && /no answer in 0.3s/.test(e.message),
  );
  await t.close();
});

test('http transport: posts the turn and returns the JSON answer', async () => {
  const s = await serve((body) => ({reply: `hello ${(body as Turn).who.name}`}));
  try {
    assert.deepEqual(await httpTransport({url: s.url}).send(TURN), {reply: 'hello Mr Toad'});
  } finally {
    await s.stop();
  }
});

test('openai transport: sends system prompt, conversation and tools; maps the completion', async () => {
  let seen: Record<string, unknown> = {};
  const s = await serve((body) => {
    seen = body as Record<string, unknown>;
    return {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {id: 'c1', type: 'function', function: {name: 'get_order', arguments: '{}'}},
            ],
          },
        },
      ],
    };
  });
  try {
    const t = openAiTransport({
      baseUrl: s.url.replace(/\/$/, ''),
      model: 'm',
      systemPrompt: 'You help.',
    });
    const answer = await t.send(TURN);
    assert.equal(seen['model'], 'm');
    const messages = seen['messages'] as {role: string; content: string}[];
    const system = messages[0];
    assert.ok(system);
    assert.equal(system.role, 'system');
    assert.match(system.content, /You help\.[\s\S]*Mr Toad/);
    assert.equal(messages[1]?.content, 'Where is my order?');
    assert.deepEqual(answer, {
      reply: null,
      tool_calls: [{id: 'c1', type: 'function', function: {name: 'get_order', arguments: '{}'}}],
    });
  } finally {
    await s.stop();
  }
});

test('answerFromCompletion refuses a completion without a message', () => {
  assert.throws(() => answerFromCompletion({choices: []}), TransportError);
});
