/**
 * @fileoverview The address book (infrastructure/engine/contacts.ts): every kind of contact in one list, each card
 * read from its record, notes and tags kept, and privacy by role (prospects, customers' addresses, staff pay).
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {freshWorld} from '../server/world-data.mjs';
import type {EngineResult, EngineWorld} from '../server/sandboxes.mjs';
import {sortName} from './contacts.ts';

type Row = Record<string, unknown>;
interface Card {
  id: string;
  kind: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  tags: string[];
  notes: string;
  hidden: string[];
  record: {kind: string; id: string};
  facts?: Row;
}
interface Listed {
  total: number;
  counts: Record<string, number>;
  not_shown: string[];
  tags: string[];
  cards: Card[];
}

function call(w: EngineWorld, role: string, tool: string, input: Row = {}): EngineResult {
  return w.session({role}).call(tool, input);
}
function data(r: EngineResult): unknown {
  assert.ok(r.ok, JSON.stringify(r));
  return r.data;
}
function code(r: EngineResult): string {
  if (r.ok) assert.fail(`expected a refusal: ${JSON.stringify(r)}`);
  return r.error.code;
}

test('everyone the business knows, sorted by name, each card pointing at its record', () => {
  const w = freshWorld('demo');
  const all = data(call(w, 'manager', 'list_contact_cards', {limit: 200})) as Listed;
  for (const k of ['customer', 'supplier', 'staff', 'partner', 'prospect'])
    assert.ok((all.counts[k] ?? 0) > 0, k);
  const names = all.cards.map((c) => sortName(c.name).toLowerCase());
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b, 'en-GB')),
  );
  const sup = data(call(w, 'manager', 'get_contact_card', {card_id: 'SUP-01'})) as Card;
  assert.equal(sup.name, 'Mrs Sowerby');
  assert.deepEqual(sup.record, {kind: 'supplier', id: 'SUP-01'});
  assert.ok(sup.email?.endsWith('.example'));
  const rivals = data(
    call(w, 'manager', 'list_contact_cards', {kind: 'partner', limit: 200}),
  ) as Listed;
  assert.ok(!rivals.cards.some((c) => c.id === 'thriftwhistle'), 'a rival is not a contact');
  assert.equal(sortName('Mr Fezziwig'), 'Fezziwig');
});

test('a card follows its record: change the customer, the card changes', () => {
  const w = freshWorld('demo');
  const c = (w.state.customers as Row[])[0];
  assert.ok(c !== undefined);
  c['email'] = 'new.address@example.com';
  assert.equal(
    (data(call(w, 'support_agent', 'get_contact_card', {card_id: c['id']})) as Card).email,
    'new.address@example.com',
  );
});

test('privacy: prospects for sales only, addresses for those who serve, pay for finance and the manager', () => {
  const w = freshWorld('demo');
  const desk = data(call(w, 'support_agent', 'list_contact_cards')) as Listed;
  assert.deepEqual(desk.not_shown, ['prospect']);
  assert.equal(
    code(call(w, 'support_agent', 'get_contact_card', {card_id: 'PR-001'})),
    'not_found',
  );
  const customer = (w.state.customers as Row[])[0];
  assert.ok(customer !== undefined);
  const id = String(customer['id']);
  const forMarketing = data(call(w, 'marketing', 'get_contact_card', {card_id: id})) as Card;
  assert.equal(forMarketing.phone, null);
  assert.equal(forMarketing.address, null);
  assert.deepEqual(forMarketing.hidden, ['phone', 'address']);
  assert.ok(
    (data(call(w, 'support_agent', 'get_contact_card', {card_id: id})) as Card).address !== null,
  );
  const staffForDesk = data(
    call(w, 'support_agent', 'get_contact_card', {card_id: 'S-03'}),
  ) as Card;
  assert.equal(staffForDesk.facts?.['hourly_pay'], undefined);
  assert.equal(
    (data(call(w, 'finance', 'get_contact_card', {card_id: 'S-03'})) as Card).facts?.['hourly_pay'],
    13.4,
  );
  assert.equal(code(call(w, 'customer', 'list_contact_cards')), 'forbidden');
  assert.equal(code(call(w, 'assistant', 'get_contact_card', {card_id: id})), 'forbidden');
});

test('notes and tags: kept, searchable, cleaned, and only on cards you can see', () => {
  const w = freshWorld('demo');
  const saved = data(
    call(w, 'support_lead', 'update_contact_card', {
      card_id: 'SUP-02',
      notes: 'Rings back after lunch.',
      add_tags: ['Call First', 'call first', 'ice'],
    }),
  ) as Card;
  assert.deepEqual(saved.tags, ['call first', 'ice']);
  const found = data(call(w, 'buyer', 'list_contact_cards', {tag: 'ice'})) as Listed;
  assert.deepEqual(
    found.cards.map((c) => c.id),
    ['SUP-02'],
  );
  assert.ok(found.tags.includes('call first'));
  assert.equal(
    (data(call(w, 'buyer', 'list_contact_cards', {search: 'after lunch'})) as Listed).total,
    1,
  );
  assert.deepEqual(
    (
      data(
        call(w, 'buyer', 'update_contact_card', {card_id: 'SUP-02', remove_tags: ['ice']}),
      ) as Card
    ).tags,
    ['call first'],
  );
  assert.equal(code(call(w, 'buyer', 'update_contact_card', {card_id: 'SUP-02'})), 'invalid_input');
  assert.equal(
    code(call(w, 'buyer', 'update_contact_card', {card_id: 'SUP-02', add_tags: ['x'.repeat(30)]})),
    'invalid_input',
  );
  assert.equal(
    code(call(w, 'support_agent', 'update_contact_card', {card_id: 'PR-001', notes: 'x'})),
    'not_found',
  );
});
