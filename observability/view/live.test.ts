import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {eventsFromWorlds, handleLive, linkFor, liveSourceFor, readLiveFile} from './live.ts';
import type {LiveEvent} from './live.ts';

/** A saved world with one email conversation the product answered and one chat it answered. */
const STATE = {
  customers: [
    {id: 'C-1', name: 'Juliet of Vienna'},
    {id: 'C-2', name: 'Alfred Jingle'},
  ],
  contacts: [
    {id: 'CT-1', at: '2026-11-25T09:00:00Z', customer_id: 'C-1', channel: 'email'},
    {id: 'CT-2', at: '2026-11-24T10:00:00Z', customer_id: 'C-2', channel: 'web_chat'},
  ],
  emails: [
    {
      id: 'EM-1',
      thread_id: 'CT-1',
      at: '2026-11-25T09:00:00Z',
      folder: 'inbox',
      body: 'Where is it?',
    },
    {
      id: 'EM-2',
      thread_id: 'CT-1',
      at: '2026-11-25T09:02:00Z',
      folder: 'sent',
      body: 'On its way.',
      overthink: {by: 'product'},
    },
    {id: 'EM-3', thread_id: 'CT-1', at: '2026-11-25T09:04:00Z', folder: 'inbox', body: 'Thanks.'},
  ],
  conversations: [
    {
      id: 'CONV-1',
      contact_id: 'CT-2',
      messages: [
        {from: 'customer', at: '2026-11-24T10:00:00Z', text: 'Can I return it?'},
        {from: 'assistant', at: '2026-11-24T10:01:00Z', text: 'Yes.', overthink: {by: 'product'}},
      ],
    },
  ],
};

const MARKS = [
  {id: 'EM-2', kind: 'message' as const, app: 'letterbox', session: 'c1', what: 'replied by email'},
  {id: 'CT-1', kind: 'conversation' as const, app: 'letterbox', session: 'c1', what: 'answered'},
  {id: 'CT-2', kind: 'conversation' as const, app: 'front-desk', session: 'c2', what: 'answered'},
  {
    id: 'CASE-9',
    kind: 'action' as const,
    app: 'front-desk',
    session: 'c2',
    seq: 4,
    tool: 'open_case',
    what: 'open_case: opened CASE-9',
  },
];

test('a run without live.jsonl is rebuilt from its saved worlds: only what the product did, in order', () => {
  const events = eventsFromWorlds('r', [
    {seed: 1, state: STATE, marks: MARKS, callTimes: new Map([[4, '2026-11-24T10:01:30Z']])},
  ]);
  assert.deepEqual(
    events.map((e) => [e.type, e.summary]),
    [
      ['contact.raised', 'Alfred Jingle wrote in'],
      ['product.replied', 'Replied to Alfred Jingle'],
      ['product.acted', 'opened CASE-9'],
      ['contact.raised', 'Juliet of Vienna wrote in'],
      ['product.replied', 'Replied to Juliet of Vienna'],
      ['person.reacted', 'Juliet of Vienna wrote back'],
    ],
  );
  assert.deepEqual(
    events.map((e) => e.seq),
    [1, 2, 3, 4, 5, 6],
  );
  assert.ok(events.every((e) => e.schema === 'overthink.live/1' && e.arm === 'with'));
  assert.equal(events[4]?.link, '/apps/letterbox/?mailbox=hello&thread=CT-1&seed=1&arm=with');
  assert.equal(events[0]?.link, '/apps/front-desk/?contact=CT-2&seed=1&arm=with');
});

test('links open the record in its app, on the right seed', () => {
  assert.equal(linkFor('till', 'ORD-10', 2), '/apps/till/?seed=2&arm=with#orders/ORD-10');
  assert.equal(linkFor('front-desk', 'CASE-9', 1), '/apps/front-desk/?case=CASE-9&seed=1&arm=with');
});

test('live.jsonl is read as it grows, and the stream follows it until the run finishes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overthink-live-'));
  const file = path.join(dir, 'live.jsonl');
  const line = (seq: number, type: string): string =>
    `${JSON.stringify({schema: 'overthink.live/1', seq, type, run: 'r', summary: type, data: {}})}\n`;
  fs.writeFileSync(file, line(1, 'run.started') + '{"half');
  assert.equal(readLiveFile(dir)?.length, 1, 'a half-written line is skipped');
  const source = liveSourceFor(dir, () => {
    throw new Error('not rebuilt when live.jsonl exists');
  });
  assert.equal(source.state(), 'running');
  const server = http.createServer((req, res) => {
    if (!handleLive(req, res, new URL(req.url ?? '/', 'http://x'), source)) res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const got: LiveEvent[] = [];
    const ctrl = new AbortController();
    const reading = (async () => {
      const res = await fetch(`${base}/live/events`, {signal: ctrl.signal});
      const reader = res.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      let text = '';
      while (got.length < 2) {
        const {value} = await reader.read();
        text += new TextDecoder().decode(value);
        got.splice(
          0,
          got.length,
          ...[...text.matchAll(/^data: (.+)$/gm)].map((m) => JSON.parse(m[1]!) as LiveEvent),
        );
      }
      ctrl.abort();
    })();
    fs.writeFileSync(file, line(1, 'run.started') + line(2, 'run.finished'));
    await reading.catch(() => undefined);
    assert.deepEqual(
      got.map((e) => e.type),
      ['run.started', 'run.finished'],
    );
    assert.equal(source.state(), 'finished');
    const status = (await (await fetch(`${base}/live/status`)).json()) as {events: number};
    assert.equal(status.events, 2);
  } finally {
    server.closeAllConnections();
    server.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
