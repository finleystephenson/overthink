import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {briefFor} from './brief.ts';
import type {CustomerBrief} from './brief.ts';
import {BudgetExceededError, createBudget} from './budget.ts';
import {openCache} from './cache.ts';
import {fakeProvider, providerFromEnv} from './provider.ts';
import {clampReaction, modelVoice, parseReaction} from './voice.ts';
import type {Reaction, ReactContext} from './voice.ts';

const BRIEF: CustomerBrief = briefFor(
  {
    id: 'c1',
    key: 'k',
    topic: 'where_is_my_order',
    cid: 'C-1',
    name: 'Anne Elliot',
    channel: 'email',
    order: 'ORD-10001',
    postcode: 'BA1 1AA',
    text: 'Where is my order?',
    repeat: false,
    customer: {
      id: 'C-1',
      name: 'Anne Elliot',
      t: {price: 1, patience: 1, public: false, leave: 1},
      m: {vague: false, omits: true, tone: 'plain'},
    },
  },
  null,
);
const ctx = (o: Partial<ReactContext>): ReactContext => ({
  turn: 0,
  verdict: 'failed',
  detailsGiven: false,
  state: {},
  ...o,
});
const said = (o: Partial<Reaction>): Reaction => ({
  next: 'follow_up',
  message: 'Hm.',
  resolved: false,
  tone: 'calm',
  clamped: [],
  overruled: false,
  ...o,
});

test('the brief comes from traits: patience in replies, details withheld, tone', () => {
  assert.equal(BRIEF.patienceTurns, 3);
  assert.equal(BRIEF.givesDetailsUpfront, false);
  assert.equal(BRIEF.tone, 'plain');
  assert.match(BRIEF.goal, /where my order is/);
});

test('a customer cannot call it resolved when the records say otherwise', () => {
  const r = clampReaction(
    said({next: 'thank_and_end', resolved: true}),
    BRIEF,
    ctx({verdict: 'failed'}),
  );
  assert.equal(r.resolved, false);
  assert.equal(r.next, 'follow_up');
  assert.match(r.clamped.join(), /records show "failed"/);
  assert.equal(r.overruled, true);
});

test('a wrong action makes the customer leave, whatever the model said', () => {
  const r = clampReaction(
    said({next: 'thank_and_end', resolved: true}),
    BRIEF,
    ctx({verdict: 'wrong_action'}),
  );
  assert.deepEqual([r.next, r.resolved, r.tone], ['give_up', false, 'angry']);
});

test('patience runs out, unknown actions become follow-ups, details are made real', () => {
  assert.equal(clampReaction(said({}), BRIEF, ctx({turn: 2})).next, 'give_up');
  assert.equal(
    clampReaction(said({next: 'sing' as Reaction['next']}), BRIEF, ctx({})).next,
    'follow_up',
  );
  const d = clampReaction(said({next: 'give_details', message: 'Here you go.'}), BRIEF, ctx({}));
  assert.match(d.message ?? '', /ORD-10001 and my postcode is BA1 1AA/);
  assert.equal(
    clampReaction(said({next: 'give_details'}), BRIEF, ctx({detailsGiven: true})).next,
    'follow_up',
  );
});

test('an unreadable judgement is a plain follow-up, not a crash', () => {
  const r = parseReaction('I think so!', BRIEF);
  assert.equal(r.next, 'follow_up');
  assert.equal(r.message, BRIEF.fallbackFollowUp);
});

test('the cache gives the same words again for free, on disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overthink-cache-'));
  const first = modelVoice({
    provider: fakeProvider(),
    cache: openCache(dir),
    budget: createBudget(null),
  });
  const a = await first.opening(BRIEF, '');
  const cache = openCache(dir);
  const budget = createBudget(null);
  const b = await modelVoice({provider: fakeProvider(), cache, budget}).opening(BRIEF, '');
  assert.equal(a, b);
  assert.deepEqual([cache.stats.hits, budget.tally.calls, budget.tally.cached_calls], [1, 0, 1]);
  fs.rmSync(dir, {recursive: true});
});

test('the budget refuses a call that could pass the cap', async () => {
  const budget = createBudget(50);
  const voice = modelVoice({provider: fakeProvider(), cache: openCache(null), budget});
  await assert.rejects(voice.opening(BRIEF, ''), BudgetExceededError);
  assert.equal(budget.tally.calls, 0, 'nothing was spent');
});

test('providerFromEnv: nothing set means rules; half set is an error', () => {
  assert.equal(providerFromEnv({}), null);
  assert.equal(providerFromEnv({OVERTHINK_PROVIDER: 'fake'})?.kind, 'fake');
  assert.throws(() => providerFromEnv({OVERTHINK_MODEL: 'llama3.2'}), /OVERTHINK_BASE_URL/);
  assert.equal(
    providerFromEnv({OVERTHINK_BASE_URL: 'http://localhost:11434/v1', OVERTHINK_MODEL: 'llama3.2'})
      ?.model,
    'llama3.2',
  );
});
