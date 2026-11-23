import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fakeProvider} from '../../activity-generation/people/provider.ts';
import {buildResults} from '../../observability/report/results.ts';
import {writeReport} from '../../observability/report/write.ts';
import {fakeTransport, lookupProduct, testAdapter} from '../../tests/helpers.ts';
import {runOverthink} from './run.ts';
import type {RunOptions} from './run.ts';

const BASE: Omit<RunOptions, 'openTransport'> = {
  adapter: testAdapter(),
  days: 6,
  runs: 2,
  size: 'demo',
  job: 'customer-service',
  firstSeed: 1,
  provider: null,
  cacheDir: null,
  tokenCap: null,
};

test('a product that passes on everything gives zero difference to the business', async () => {
  const raw = await runOverthink({...BASE, openTransport: () => fakeTransport(() => ({}))});
  const r = buildResults(raw);
  for (const m of r.measures) {
    for (const p of m.perSeed) assert.equal(p.difference, 0, `${m.key} differs in seed ${p.seed}`);
  }
  assert.equal(r.product.contacts, 0);
  assert.ok(r.product.passed > 0, 'there were contacts to pass on');
});

test('end to end with the fake people model: results.json, summary.md and report.html', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'overthink-run-'));
  const raw = await runOverthink({
    ...BASE,
    provider: fakeProvider(),
    openTransport: () => fakeTransport(lookupProduct),
  });
  const r = buildResults(raw);
  const files = writeReport(out, r);
  const json = JSON.parse(fs.readFileSync(files.results, 'utf8')) as typeof r;
  assert.deepEqual(json.reproducibility.seeds, [1, 2]);
  assert.equal(json.reproducibility.people_model, 'fake:fake-people-1');
  assert.match(json.reproducibility.world_hash, /^[0-9a-f]{16}$/);
  assert.ok(json.product.contacts > 0);
  const summary = fs.readFileSync(files.summary, 'utf8');
  assert.ok(summary.split('\n').length <= 20, 'the summary stays short enough to paste into chat');
  assert.match(summary, /Simulated customers, not real ones\. Check with real users\./);
  const html = fs.readFileSync(files.html, 'utf8');
  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(
    html,
    /<script|https?:\/\/(?!127\.0\.0\.1)[a-z]/i,
    'self-contained: no scripts, no outside links',
  );
  assert.match(
    html,
    /With the product[\s\S]*Without the product|Without the product[\s\S]*With the product/,
  );
  fs.rmSync(out, {recursive: true});
});

test('with a people model, both arms open every shared conversation with the same words', async () => {
  const raw = await runOverthink({
    ...BASE,
    runs: 1,
    provider: fakeProvider(),
    openTransport: () => fakeTransport(lookupProduct),
  });
  const seed = raw.seeds[0];
  assert.ok(seed !== undefined);
  const without = new Map(seed.without.client.transcripts.map((t) => [t.key, t.lines[0]?.text]));
  let shared = 0;
  for (const t of seed.with.client.transcripts) {
    const other = without.get(t.key);
    if (other === undefined) continue;
    shared++;
    assert.equal(t.lines[0]?.text, other);
  }
  assert.ok(shared > 0, 'some contacts happened in both arms');
  assert.ok(raw.cache.hits >= shared, 'the second arm read its openings from the cache');
});

test('the token cap stops the run cleanly and says why', async () => {
  const raw = await runOverthink({
    ...BASE,
    provider: fakeProvider(),
    tokenCap: 400,
    openTransport: () => fakeTransport(lookupProduct),
  });
  assert.match(raw.stopped ?? '', /token cap/);
  assert.ok(raw.tokens.input + raw.tokens.output <= 400);
  const r = buildResults(raw);
  assert.equal(r.stopped, raw.stopped);
});
