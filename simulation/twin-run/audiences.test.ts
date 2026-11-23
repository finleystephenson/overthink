/**
 * @fileoverview Each audience end to end with the fake people model, --compare, and the live stream.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import type {Turn} from '../../integrations/adapter/contract.ts';
import {openLiveStream} from '../../observability/live/events.ts';
import type {LiveEvent} from '../../observability/live/events.ts';
import {startLiveServer} from '../../observability/live/server.ts';
import {fakeProvider} from '../../activity-generation/people/provider.ts';
import {buildResults} from '../../observability/report/results.ts';
import {fakeTransport, lookupProduct, testAdapter} from '../../tests/helpers.ts';
import {compareResults} from './compare.ts';
import {runOverthink} from './run.ts';
import type {RunOptions} from './run.ts';

const BASE: Omit<RunOptions, 'openTransport' | 'adapter' | 'job'> = {
  days: 5,
  runs: 1,
  size: 'demo',
  firstSeed: 1,
  provider: fakeProvider(),
  cacheDir: null,
  tokenCap: null,
  panelSize: 12,
};

/** The text of the last tool result in a turn, parsed. */
function lastTool(turn: Turn): unknown {
  const m = turn.conversation.at(-1);
  if (m?.role !== 'tool') return null;
  try {
    return JSON.parse(m.content) as unknown;
  } catch {
    return m.content;
  }
}

/** Publishes one post with an offer, then rewrites a product page, then says it is done. */
function publisher(turn: Turn): unknown {
  if (turn.who.channel !== 'publishing') return {};
  const toolTurns = turn.conversation.filter((m) => m.role === 'tool').length;
  if (toolTurns === 0)
    return {
      tool_calls: [
        {
          name: 'create_social_post',
          arguments: {
            network: 'mutter',
            text: `${turn.now.slice(0, 10)}: the One Good Pen, 20% off this week. It writes.`,
            product_id: 'one-good-pen',
          },
        },
      ],
    };
  if (toolTurns === 1 && turn.now.slice(8, 10) === turn.now.slice(8, 10))
    return {
      tool_calls: [
        {
          name: 'update_product_page',
          arguments: {
            product_id: 'one-good-pen',
            headline: 'One good pen',
            description: 'One pen that writes, every time. Refills sold separately.',
          },
        },
      ],
    };
  return {reply: 'Published.'};
}

/** Answers staff from the first useful tool its role has. */
function staffTool(turn: Turn): unknown {
  if (turn.who.kind !== 'staff') return {};
  const data = lastTool(turn);
  if (data !== null)
    return {reply: `Here is what the records show: ${JSON.stringify(data).slice(0, 300)}`};
  const names = turn.tools.map((t) => t.function.name);
  const pick = [
    'list_contacts',
    'list_all_orders',
    'social_stats',
    'list_purchase_orders',
    'ledger_search',
    'get_monthly_summary',
  ].find((n) => names.includes(n));
  return pick === undefined
    ? {reply: 'I cannot see anything for that.'}
    : {tool_calls: [{name: pick, arguments: {}}]};
}

/** Lists prospects, then writes to the first one about what it needs. */
function salesAgent(turn: Turn): unknown {
  if (turn.who.kind !== 'business') return {};
  const last = turn.conversation.at(-1);
  if (last?.role !== 'tool') return {tool_calls: [{name: 'list_prospects', arguments: {}}]};
  // The list is long and cut to fit a small model's context, so read it as text.
  const chunk = last.content.split('{"id":"PR-').find((c) => c.includes('"status":"new"'));
  const m =
    chunk === undefined ? null : /^(\d+)"[\s\S]*?"needs":\[\{"product":"([a-z-]+)"/.exec(chunk);
  if (m === null || turn.conversation.filter((x) => x.role === 'tool').length > 1)
    return {reply: 'Done for today.'};
  return {
    tool_calls: [
      {
        name: 'send_outreach',
        arguments: {
          prospect_id: `PR-${m[1] ?? ''}`,
          channel: 'email',
          message: `Hello, we supply ${(m[2] ?? '').replace(/-/g, ' ')} to small businesses near you, with weekly delivery.`,
        },
      },
    ],
  };
}

test('public: a published post and product page are read by a persona panel, scaled, and replies become records', async () => {
  const adapter = {
    ...testAdapter('publisher'),
    config: {
      ...testAdapter('publisher').config,
      audience: ['public' as const],
      channels: ['publishing'],
    },
  };
  const raw = await runOverthink({
    ...BASE,
    adapter,
    job: 'content',
    openTransport: () => fakeTransport(publisher),
  });
  const a = raw.seeds[0]?.audience;
  assert.ok(a !== undefined);
  const posts = a.published.filter((p) => p.kind === 'post');
  assert.ok(posts.length > 0, 'the product published posts');
  assert.ok(
    a.published.some((p) => p.kind === 'product_page'),
    'and a product page',
  );
  for (const p of a.published) {
    assert.equal(p.source, 'panel');
    assert.equal(p.panel?.size, 12);
    assert.ok(p.reach > 0, `${p.kind} reached someone`);
  }
  const r = buildResults(raw);
  assert.equal(r.audiences.public.source, 'panel');
  assert.ok(r.audiences.public.items >= 2);
});

test('public with --rules: the audience rules plan the response, labelled as rules', async () => {
  const adapter = {
    ...testAdapter('publisher'),
    config: {
      ...testAdapter('publisher').config,
      audience: ['public' as const],
      channels: ['publishing'],
    },
  };
  const raw = await runOverthink({
    ...BASE,
    provider: null,
    adapter,
    job: 'content',
    openTransport: () => fakeTransport(publisher),
  });
  const items = raw.seeds[0]?.audience.published ?? [];
  assert.ok(items.length > 0);
  assert.ok(items.every((p) => p.source === 'rules' && p.panel === null));
});

test('staff: an internal tool gets used in real work, each use is measured, and each person gives feedback', async () => {
  const adapter = {
    ...testAdapter('helper'),
    config: {...testAdapter('helper').config, audience: ['staff' as const], channels: ['internal']},
  };
  const raw = await runOverthink({
    ...BASE,
    adapter,
    job: 'internal-tool',
    openTransport: () => fakeTransport(staffTool),
  });
  const a = raw.seeds[0]?.audience;
  assert.ok(a !== undefined);
  assert.ok(a.staffUses.length > 0, 'staff used it');
  assert.ok(
    a.staffUses.some((u) => u.worked),
    'some uses worked by the records',
  );
  assert.ok(
    a.staffUses.every((u) => u.workloadMinutes > 0),
    'measured against their workload in the twin',
  );
  assert.ok(a.staffFeedback.length > 0);
  for (const f of a.staffFeedback) {
    assert.equal(f.source, 'model');
    if (f.worked === 0)
      assert.deepEqual(f.workedLines, [], 'nobody praises a tool that never worked');
  }
  const r = buildResults(raw);
  assert.equal(r.audiences.staff.uses, a.staffUses.length);
});

test('businesses: a sales agent’s outreach is read by buyers who decide, and the decisions are records', async () => {
  const adapter = {
    ...testAdapter('seller'),
    config: {
      ...testAdapter('seller').config,
      audience: ['businesses' as const],
      channels: ['outreach'],
    },
  };
  const raw = await runOverthink({
    ...BASE,
    days: 8,
    adapter,
    job: 'sales',
    openTransport: () => fakeTransport(salesAgent),
  });
  const buyers = raw.seeds[0]?.audience.buyers ?? [];
  assert.ok(buyers.length > 0, 'buyers read the outreach');
  for (const b of buyers)
    assert.ok(
      ['ignore', 'reply', 'ask', 'meet', 'buy', 'unsubscribe', 'complain'].includes(b.decision),
    );
  const r = buildResults(raw);
  assert.equal(
    Object.values(r.audiences.businesses.decisions).reduce((x, y) => x + y, 0),
    buyers.length,
  );
});

test('customers: contacts arrive on social channels too, and a product deployed only there meets only them', async () => {
  const adapter = {
    ...testAdapter('dm bot'),
    config: {
      ...testAdapter('dm bot').config,
      channels: ['mutter_dm', 'squint_dm', 'mutter_mention'],
    },
  };
  const raw = await runOverthink({
    ...BASE,
    provider: null,
    days: 30,
    runs: 3,
    adapter,
    job: 'customer-service',
    openTransport: () => fakeTransport(lookupProduct),
  });
  const met = raw.seeds.flatMap((s) => s.with.client.transcripts);
  assert.ok(met.length > 0, 'social contacts were raised');
  assert.ok(met.every((t) => ['mutter_dm', 'squint_dm', 'mutter_mention'].includes(t.channel)));
});

test('--compare: two access levels on the same seeds give paired differences', async () => {
  const full = testAdapter('A');
  const readOnly = {
    ...testAdapter('B'),
    config: {...testAdapter('B').config, access: 'read_only', scope: {read: ['*'], act: []}},
  };
  const o = {...BASE, provider: null, runs: 2, job: 'customer-service'};
  const ra = buildResults(
    await runOverthink({
      ...o,
      adapter: full,
      variant: 'A',
      openTransport: () => fakeTransport(lookupProduct),
    }),
    'A',
  );
  const rb = buildResults(
    await runOverthink({
      ...o,
      adapter: readOnly,
      variant: 'B',
      openTransport: () => fakeTransport(lookupProduct),
    }),
    'B',
  );
  const c = compareResults([full, readOnly], [ra, rb]);
  assert.equal(c.schema, 'overthink.compare/1');
  assert.deepEqual(c.config.seeds, [1, 2]);
  assert.equal(c.variants[1]?.access, 'read_only');
  const profit = c.paired.find((p) => p.key === 'net_profit');
  assert.ok(profit !== undefined);
  assert.equal(profit.perSeed.length, 2);
  for (const p of profit.perSeed)
    assert.equal(Math.round((p.b - p.a) * 100), Math.round(p.difference * 100));
  // The arm without a product is the same business for both: paired on the same seeds and people.
  const va = c.variants[0]!;
  const vb = c.variants[1];
  for (const m of va.measures)
    assert.equal(m.without, vb.measures.find((x) => x.key === m.key)?.without, m.key);
  // A variant compared with itself differs by exactly nothing.
  const same = compareResults([full, full], [ra, ra]);
  assert.ok(same.paired.every((p) => p.difference === null || p.difference === 0));
});

test('live: a run streams the documented events to live.jsonl and over server-sent events', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overthink-live-'));
  const file = path.join(dir, 'live.jsonl');
  const stream = openLiveStream({file});
  const server = await startLiveServer(stream, 0);
  try {
    stream.emit({type: 'run.started', summary: 'test'});
    await runOverthink({
      ...BASE,
      days: 6,
      adapter: testAdapter(),
      job: 'customer-service',
      live: stream,
      openTransport: () => fakeTransport(lookupProduct),
    });
    stream.emit({type: 'run.finished', summary: 'done', data: {results: null, headline: null}});
    const lines = fs
      .readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as LiveEvent);
    const types = new Set(lines.map((e) => e.type));
    for (const t of [
      'run.started',
      'arm.started',
      'contact.raised',
      'product.read',
      'product.replied',
      'person.reacted',
      'day.ended',
      'arm.finished',
      'run.finished',
    ])
      assert.ok(types.has(t as LiveEvent['type']), `emits ${t}`);
    lines.forEach((e, i) => {
      assert.equal(e.schema, 'overthink.live/1');
      assert.equal(e.seq, i + 1, 'seq has no gaps');
      assert.equal(e.run, stream.run);
      for (const k of [
        'at',
        'type',
        'arm',
        'variant',
        'seed',
        'sim_time',
        'audience',
        'channel',
        'session',
        'app',
        'record',
        'link',
        'summary',
        'data',
      ])
        assert.ok(k in e, `has ${k}`);
    });
    assert.ok(
      lines
        .filter((e) => e.type === 'contact.raised')
        .every((e) => e.arm === 'with' && e.audience === 'customers'),
    );
    // SSE replays everything after Last-Event-ID.
    const res = await fetch(`${server.url}/live/events`, {
      headers: {'Last-Event-ID': String(lines.length - 2)},
    });
    assert.ok(res.body !== null);
    const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    let text = '';
    while (!text.includes(`id: ${lines.length}\n`)) {
      const {value, done} = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    await reader.cancel();
    assert.match(text, new RegExp(`id: ${lines.length - 1}\\nevent: [a-z.]+\\ndata: \\{`));
    assert.doesNotMatch(
      text,
      new RegExp(`id: ${lines.length - 2}\\n`),
      'nothing before Last-Event-ID',
    );
    const status = (await (await fetch(`${server.url}/live/status`)).json()) as {
      state: string;
      events: number;
    };
    assert.equal(status.state, 'finished');
    assert.equal(status.events, lines.length);
  } finally {
    await server.close();
    stream.close();
  }
});
