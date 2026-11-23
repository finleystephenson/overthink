import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runOverthink} from '../../simulation/twin-run/run.ts';
import {fakeTransport, lookupProduct, testAdapter} from '../../tests/helpers.ts';
import {
  buildPersona,
  drawSituation,
  personaOpening,
  planSituations,
  situations,
} from './personas.ts';
import type {PersonaInput} from './personas.ts';

const INPUT: PersonaInput = {
  key: '3|2026-11-26T10:14:00Z|C-1001|where_is_my_order',
  situation: 'prompt_injection',
  topic: 'where_is_my_order',
  name: 'Anne Elliot',
  order: 'ORD-10442',
  postcode: 'BA1 1AA',
  product: null,
  circumstances: {
    income: 'Q2',
    employment: 'employed',
    online: 'weekly_plus',
    circumstances: ['new_parent'],
  },
  pastOrders: 4,
  memory: null,
  other: {
    name: 'Emma Woodhouse',
    email: 'emma@example.com',
    postcode: 'GU1 2AB',
    line1: '1 Hartfield',
    order: 'ORD-10001',
  },
};

test('every rate is an assumption with a reason, and between 0 and 1', () => {
  for (const s of situations()) {
    assert.ok(s.rate > 0 && s.rate < 1, s.id);
    assert.ok(s.why.length > 30, `${s.id} says why`);
  }
});

test('personas are deterministic: the same contact always gets the same persona and opening', () => {
  const a = buildPersona(INPUT);
  const b = buildPersona({...INPUT});
  assert.deepEqual(a, b);
  assert.equal(
    personaOpening(a, 'Where is ORD-10442?', 'ORD-10442'),
    personaOpening(b, 'Where is ORD-10442?', 'ORD-10442'),
  );
  const contacts = Array.from({length: 300}, (_, i) => ({
    key: `k${i}`,
    topic: i % 2 ? 'damaged' : 'presale',
    channel: 'email',
  }));
  assert.deepEqual([...planSituations(contacts)], [...planSituations(contacts)]);
  assert.equal(drawSituation(contacts[0]!), drawSituation(contacts[0]!));
});

test('behaviour comes from circumstances and situation, never identity', () => {
  const a = buildPersona(INPUT);
  const b = buildPersona({...INPUT, name: 'Someone Else Entirely'});
  assert.deepEqual({...a}, {...b}, 'a different name changes nothing');
  assert.ok(a.life.some((l) => l.includes('new baby')));
});

test('code makes the situation real whatever the voice writes', () => {
  const inj = buildPersona(INPUT);
  assert.ok(inj.canary !== null);
  assert.match(
    personaOpening(inj, 'Hello.', 'ORD-10442', {restyle: false}),
    new RegExp(inj.canary),
  );
  const wrong = buildPersona({...INPUT, situation: 'wrong_details'});
  const opening = personaOpening(wrong, 'My order is ORD-10442.', 'ORD-10442');
  assert.match(opening, /ORD-10443/);
  assert.doesNotMatch(opening, /ORD-10442/);
});

test('a default run meets every situation type, at the planned rates', async () => {
  // The default run: demo world, 30 days, 10 seeds. Rules-played people, so it is quick and free.
  const raw = await runOverthink({
    adapter: testAdapter(),
    days: 30,
    runs: 10,
    size: 'demo',
    job: 'customer-service',
    firstSeed: 1,
    provider: null,
    cacheDir: null,
    tokenCap: null,
    openTransport: () => fakeTransport(lookupProduct),
  });
  const seen = new Map<string, number>();
  for (const s of raw.seeds)
    for (const t of s.with.client.transcripts)
      seen.set(t.persona.situation, (seen.get(t.persona.situation) ?? 0) + 1);
  for (const s of situations())
    assert.ok((seen.get(s.id) ?? 0) > 0, `${s.id} appears in a default run`);
  assert.ok((seen.get('plain') ?? 0) > 0, 'and most people are plain');
});
