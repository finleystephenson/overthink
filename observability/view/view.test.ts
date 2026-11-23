import assert from 'node:assert/strict';
import fs from 'node:fs';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import type {Turn} from '../../integrations/adapter/contract.ts';
import {buildResults} from '../report/results.ts';
import type {Results} from '../report/results.ts';
import {writeReport} from '../report/write.ts';
import {runOverthink} from '../../simulation/twin-run/run.ts';
import type {RunOptions} from '../../simulation/twin-run/run.ts';
import {fakeTransport, lookupProduct, testAdapter} from '../../tests/helpers.ts';
import {readBundle} from './bundle.ts';
import {changedSomething} from './marks.ts';
import {createViewServer, findRecord, isReadTool, openRun} from './server.ts';

const BASE: Omit<RunOptions, 'openTransport'> = {
  adapter: testAdapter(),
  days: 8,
  runs: 2,
  size: 'demo',
  job: 'customer-service',
  firstSeed: 1,
  provider: null,
  cacheDir: null,
  tokenCap: null,
};

/** Looks the order up like lookupProduct, then opens a case about it: a product that changes records. */
function actingProduct(turn: Turn): unknown {
  const tools = turn.conversation.filter((m) => m.role === 'tool');
  if (tools.length === 2) {
    const order = /ORD-\d+/.exec(turn.conversation.map((m) => m.content).join(' '))?.[0];
    return {
      tool_calls: [
        {
          name: 'open_case',
          arguments: {
            subject: 'Customer contact',
            category: 'other',
            summary: 'From the AI',
            related: {order},
          },
        },
      ],
    };
  }
  if (tools.length > 2) return {reply: 'I have opened a case and a colleague will follow it up.'};
  return lookupProduct(turn);
}

let dir = '';
let results: Results;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overthink-view-'));
  const raw = await runOverthink({...BASE, openTransport: () => fakeTransport(actingProduct)});
  results = buildResults(raw, dir);
  writeReport(
    dir,
    results,
    raw.seeds.map((s) => s.bundle),
  );
});

after(() => {
  fs.rmSync(dir, {recursive: true, force: true});
});

/** The world's state without the audit log, which reads are allowed to touch (and the store rolls back anyway). */
function fingerprint(state: Record<string, unknown>): string {
  return JSON.stringify({...state, audit: null});
}

test('view mode is read-only: reads work, every change is refused, the world stays byte for byte the same', async () => {
  const run = openRun(dir);
  const server = createViewServer(run);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const sb = (await (await fetch(`${base}/sandboxes`, {method: 'POST'})).json()) as {
      data: {id: string; token: string};
    };
    const {id, token} = sb.data;
    const opened = run.open(1, 'with');
    assert.equal(opened.sandbox.id, id, 'the apps get the saved world, not a fresh one');
    const before = fingerprint(opened.sandbox.world.state);
    const auditBefore = (opened.sandbox.world.state['audit'] as unknown[]).length;
    const traceBefore = opened.sandbox.trace.length;
    const call = (url: string, method = 'POST', body: unknown = {}): Promise<Response> =>
      fetch(base + url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Role': 'manager',
        },
        ...(method === 'GET' ? {} : {body: JSON.stringify(body)}),
      });
    let reads = 0;
    for (const t of opened.sandbox.world.tools) {
      const res = (await (await call(`/tools/${t.name}`)).json()) as {
        ok: boolean;
        error?: {code: string};
      };
      if (isReadTool(t.name)) reads++;
      else assert.equal(res.error?.code, 'read_only', `${t.name} must be refused`);
    }
    assert.ok(reads > 20, 'the reading tools still answer');
    for (const [url, method] of [
      [`/sandboxes/${id}/reset`, 'POST'],
      [`/sandboxes/${id}/advance`, 'POST'],
      [`/sandboxes/${id}/tokens`, 'POST'],
      [`/sandboxes/${id}/inbox`, 'POST'],
      [`/sandboxes/${id}/inbox/MSG-0001/reply`, 'POST'],
      [`/sandboxes/${id}`, 'DELETE'],
    ] as const) {
      assert.equal(
        (await call(url, method, {days: 1, text: 'hi'})).status,
        403,
        `${method} ${url}`,
      );
    }
    const advance = (await (await call('/tools/advance_time', 'POST', {days: 1})).json()) as {
      ok: boolean;
    };
    assert.equal(advance.ok, false);
    assert.equal(fingerprint(opened.sandbox.world.state), before);
    assert.equal(
      (opened.sandbox.world.state['audit'] as unknown[]).length,
      auditBefore,
      'reads leave no audit line',
    );
    assert.equal(
      opened.sandbox.trace.length,
      traceBefore,
      'the trace stays the product’s calls only',
    );
  } finally {
    server.close();
  }
});

test('"Your AI" marks match the product’s trace exactly', () => {
  for (const seed of results.reproducibility.seeds) {
    const b = readBundle(dir, seed);
    const changing = b.trace.filter(changedSomething).map((e) => e.seq);
    assert.ok(changing.length > 0, 'the acting product changed records');
    const marked = [...new Set(b.with.marks.filter((m) => m.kind === 'action').map((m) => m.seq))];
    assert.deepEqual(
      marked.sort(),
      [...changing].sort(),
      `seed ${seed}: one mark per changing call`,
    );
    assert.ok(
      b.trace.every((e) => e['via'] === 'overthink'),
      'the trace holds only the product’s calls',
    );
    // Every message mark is an email in the world the product wrote, and every email it wrote is marked.
    const run = openRun(dir);
    const state = run.open(seed, 'with').sandbox.world.state;
    const emails = (state['emails'] ?? []) as {id: string; overthink?: unknown}[];
    const written = emails
      .filter((e) => e.overthink !== undefined)
      .map((e) => e.id)
      .sort();
    const messageMarks = b.with.marks
      .filter((m) => m.kind === 'message')
      .map((m) => m.id)
      .sort();
    assert.deepEqual(messageMarks, written);
    assert.equal(b.without.marks.length, 0, 'nothing is marked in the world without the product');
  }
});

test('a do-nothing product leaves no marks', async () => {
  const raw = await runOverthink({
    ...BASE,
    runs: 1,
    openTransport: () => fakeTransport(() => ({})),
  });
  const b = raw.seeds[0]?.bundle;
  assert.ok(b !== undefined);
  assert.equal(b.with.marks.length, 0);
  assert.equal(b.trace.length, 0);
});

test('failures in the report link to real records in the saved world', () => {
  assert.ok(results.failures.length > 0, 'the run found something to report');
  const run = openRun(dir);
  for (const f of results.failures) {
    assert.ok(f.record !== null && f.link !== null, `${f.id} has a record and a link`);
    assert.ok(f.link.includes(encodeURIComponent(f.record)) && f.link.includes(`seed=${f.seed}`));
    const found = findRecord(run.open(f.seed, 'with').sandbox.world.state, f.record);
    assert.ok(found !== null, `${f.id}: ${f.record} exists in seed ${f.seed}`);
  }
});
