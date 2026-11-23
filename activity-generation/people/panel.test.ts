/**
 * @fileoverview Persona panels, buyers and staff: deterministic, cached, held to what is possible, and blind to names.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBudget} from './budget.ts';
import {openCache} from './cache.ts';
import {fakeProvider} from './provider.ts';
import {buyerPersona, loadPopulation, publicPool, staffMembers} from './audiences.ts';
import type {ProspectRecord} from './audiences.ts';
import {clampBuyer} from './buyers.ts';
import {
  BOUND,
  clampDecision,
  drawPanel,
  estimateRates,
  panelRequest,
  readContent,
  zero,
} from './panel.ts';
import type {Content, PanelMember} from './panel.ts';
import {unit} from './personas.ts';
import {measureUse} from './staff.ts';

const POST: Content = {
  kind: 'post',
  recordId: 'SP-1',
  network: 'mutter',
  text: 'The One Good Pen, 20% off this week. It writes.',
  image: null,
  productName: 'One Good Pen',
  price: null,
};

const pool = publicPool(loadPopulation(), []);

test('a panel is drawn the same way every time, across every kind of circumstance', () => {
  const a = drawPanel(pool, 40, 'panel|1|post|mutter');
  const b = drawPanel(pool, 40, 'panel|1|post|mutter');
  assert.equal(a.length, 40);
  assert.deepEqual(
    a.map((m) => m.person.key),
    b.map((m) => m.person.key),
  );
  assert.deepEqual(
    new Set(a.map((m) => m.person.income)),
    new Set(['Q1', 'Q2', 'Q3', 'Q4', 'Q5']),
    'every income fifth',
  );
  assert.ok(new Set(a.map((m) => m.person.online)).size >= 3, 'most shopping habits');
  assert.notDeepEqual(
    a.map((m) => m.person.key),
    drawPanel(pool, 40, 'panel|2|post|mutter').map((m) => m.person.key),
  );
});

test('panel decisions are deterministic and cached by content: a second reading costs no calls', async () => {
  const cache = openCache(null);
  const model = {provider: fakeProvider(), cache, budget: createBudget(null)};
  const panel = drawPanel(pool, 20, 'k');
  const first = await readContent(model, panel, POST);
  // Two members with exactly the same circumstances share one call: the same brief and words give the same answer.
  const calls = model.budget.tally.calls;
  assert.equal(calls + model.budget.tally.cached_calls, 20);
  const again = await readContent(model, panel, POST);
  assert.deepEqual(again, first);
  assert.equal(model.budget.tally.calls, calls, 'no new calls');
  const other = await readContent(model, panel, {...POST, text: 'Something else entirely.'});
  assert.equal(other.length, 20);
  assert.ok(model.budget.tally.calls > calls, 'new words, new reading');
});

test('names never reach the model and never change a decision', async () => {
  const panel = drawPanel(pool, 30, 'names');
  const renamed: PanelMember[] = panel.map((m, i) => ({
    ...m,
    person: {...m.person, name: `Person ${i} Zebedee-Okonkwo`},
  }));
  for (const [i, m] of panel.entries()) {
    const req = panelRequest(m, POST);
    assert.deepEqual(req, panelRequest(renamed[i] as PanelMember, POST));
    assert.ok(!req.system.includes(m.person.name), 'the name is not in the brief');
  }
  const model = (): Parameters<typeof readContent>[0] => ({
    provider: fakeProvider(),
    cache: openCache(null),
    budget: createBudget(null),
  });
  assert.deepEqual(
    await readContent(model(), panel, POST),
    await readContent(model(), renamed, POST),
  );
  // Buyers too: the decision maker's name is not in what they are asked.
  const prospect: ProspectRecord = {
    id: 'PR-1',
    name: 'Toad Hall',
    sector: 'estate',
    staff: 14,
    monthly_budget: 500,
    budget_band: 'small',
    preferred_channel: 'email',
    needs: [{product: 'one-good-pen', sku: 'OT-PEN', qty: 10, every: 'month', unit_price: 9}],
    decision_maker: {name: 'Mr Badger', email: 'b@example.com'},
    private: {reply_propensity: 0.5},
  };
  const b1 = buyerPersona(prospect, unit);
  const b2 = buyerPersona(
    {...prospect, decision_maker: {name: 'Ms Q', email: 'q@example.com'}},
    unit,
  );
  assert.deepEqual(b1.lines, b2.lines);
});

test('code holds a decision to what the content allows', () => {
  assert.equal(
    clampDecision({decision: 'unsubscribe'}, POST).decision,
    'ignore',
    'no unsubscribing from a post',
  );
  assert.equal(
    clampDecision({decision: 'buy'}, {...POST, productName: null}).decision,
    'visit',
    'nothing to buy',
  );
  assert.equal(
    clampDecision({decision: 'reply', reply: ''}, POST).decision,
    'like',
    'a reply needs words',
  );
  assert.equal(clampDecision({decision: 'dance'}, POST).decision, 'ignore');
  assert.equal(clampDecision(null, POST).decision, 'ignore');
  const r = clampDecision({decision: 'reply', reply: 'x'.repeat(500)}, POST);
  assert.ok((r.reply ?? '').length <= 280, 'a Mutter reply fits Mutter');
});

test('rates are shrunk toward the rules and kept within plausible bounds', () => {
  const prior = {...zero(), like: 0.03, visit: 0.02, buy: 0.0005};
  const all = estimateRates({...zero(), like: 40}, 40, prior);
  assert.equal(all.like, 0.03 * BOUND, 'a panel that all likes it cannot push past the bound');
  const none = estimateRates(zero(), 40, prior);
  assert.equal(none.like, 0.015, 'nobody liking it halves the rate at k = N');
  assert.equal(none.buy, 0.00025);
  assert.ok(Math.abs(DECISION_SUM(none) - 1) < 1e-9);
});

const DECISION_SUM = (r: Record<string, number>): number =>
  Object.values(r).reduce((a, b) => a + b, 0);

test('buyers are held to their needs, budget and patience', () => {
  const b = {
    prospectId: 'PR-1',
    company: 'X',
    name: 'n',
    email: 'e',
    lines: [],
    patience: 2,
    readyToSwitch: true,
    monthlyBudget: 100,
    needs: [{product: 'one-good-pen', sku: 'OT-PEN', qty: 10, every: 'month', unit_price: 9}],
  };
  const o = {
    id: 'OUT-1',
    message: 'We sell lovely umbrellas.',
    channel: 'email',
    offer: null,
    contactN: 1,
  };
  assert.equal(clampBuyer(b, o, 'buy').decision, 'ask', 'nothing they need');
  assert.equal(clampBuyer(b, {...o, message: 'One good pen, ten a month.'}, 'buy').decision, 'buy');
  assert.equal(
    clampBuyer({...b, readyToSwitch: false}, {...o, message: 'one good pen'}, 'buy').decision,
    'reply',
  );
  const big = {
    ...o,
    message: 'one good pen',
    offer: {items: [{sku: 'OT-PEN', qty: 100}], discount_percent: 0},
  };
  assert.equal(clampBuyer(b, big, 'buy').decision, 'meet', 'over budget');
  assert.equal(clampBuyer(b, o, 'complain').decision, 'ignore', 'within their patience');
  assert.equal(clampBuyer(b, {...o, contactN: 3}, 'complain').decision, 'complain');
});

test('a staff use is measured from the calls: a failed answer costs time, an unasked change costs more', () => {
  const m = staffMembers().find((s) => s.role === 'support_agent');
  assert.ok(m !== undefined);
  const req = {
    member: m,
    date: '2026-11-26',
    ask: 'Which contacts are open?',
    expects: ['list_contacts'],
    readOnly: true,
    manualMinutes: 10,
  };
  const ok = {name: 'list_contacts', arguments: {}, ok: true, code: null, refused: false};
  const good = measureUse(
    req,
    'Three are open: CT-1 a late parcel, CT-2 a refund, CT-3 a question about socks.',
    [ok],
    300,
  );
  assert.equal(good.worked, true);
  assert.ok(good.minutesSaved > 0 && good.minutesSaved < 10);
  const lazy = measureUse(
    req,
    'There are a few open ones, have a look in Front Desk when you can.',
    [],
    300,
  );
  assert.equal(lazy.worked, false);
  assert.ok(lazy.minutesSaved < 0);
  const meddler = measureUse(
    req,
    'Three are open and I closed one for you as resolved already.',
    [ok, {...ok, name: 'resolve_case'}],
    300,
  );
  assert.equal(meddler.worked, false);
  assert.ok(meddler.minutesSaved < lazy.minutesSaved);
});
