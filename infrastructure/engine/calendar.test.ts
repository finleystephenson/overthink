/**
 * @fileoverview The calendar (infrastructure/engine/calendar.ts): entries read from records follow their records,
 * entries people make can be made, moved and cancelled by the right people, roles see only what their job allows, and
 * a request from outside waits until someone answers it.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {freshWorld} from '../server/world-data.mjs';
import type {EngineResult, EngineWorld} from '../server/sandboxes.mjs';

type Row = Record<string, unknown>;
interface Entry {
  id: string;
  kind: string;
  title: string;
  start: string;
  end: string;
  status: string;
  people: {id: string}[];
  editable: boolean;
  change_with: string | null;
}
interface Listed {
  total: number;
  not_shown: string[];
  events: Entry[];
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

test('this week holds shifts, deliveries, campaigns and world events, all read from their records', () => {
  const w = freshWorld('demo');
  const week = data(call(w, 'manager', 'list_events')) as Listed;
  const kinds = new Set(week.events.map((e) => e.kind));
  for (const k of ['shift', 'delivery', 'campaign', 'world']) assert.ok(kinds.has(k), k);
  assert.deepEqual(week.not_shown, []);
  const shift = week.events.find((e) => e.kind === 'shift');
  assert.ok(shift !== undefined && !shift.editable && shift.change_with === 'set_staffing');
  // Mon to Fri, eleven people: weekends are empty.
  assert.equal(week.events.filter((e) => e.kind === 'shift').length, 55);
});

test('a delivery moves when its purchase order is delayed: the calendar reads the record, never a copy', () => {
  const w = freshWorld('demo');
  const po = (w.state['purchase_orders'] as Row[]).find((p) => p['status'] === 'ordered');
  assert.ok(po !== undefined);
  const id = `delivery:${String(po['number'])}`;
  const before = data(call(w, 'buyer', 'get_event', {event_id: id})) as Entry;
  const later = new Date(Date.parse(`${before.start}T00:00:00Z`) + 3 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  data(call(w, 'world', 'apply_supplier_change', {number: po['number'], due: later}));
  assert.equal((data(call(w, 'buyer', 'get_event', {event_id: id})) as Entry).start, later);
  assert.equal(
    code(call(w, 'buyer', 'update_event', {event_id: id, title: 'x'})),
    'rule_violation',
  );
});

test('roles see only their own kinds: no purchase orders or campaign spend for the help desk', () => {
  const w = freshWorld('demo');
  const desk = data(call(w, 'support_agent', 'list_events')) as Listed;
  assert.deepEqual(desk.not_shown.sort(), ['campaign', 'delivery']);
  assert.ok(desk.events.every((e) => e.kind !== 'delivery' && e.kind !== 'campaign'));
  const po = (w.state['purchase_orders'] as Row[])[0];
  assert.ok(po !== undefined);
  assert.equal(
    code(call(w, 'support_agent', 'get_event', {event_id: `delivery:${String(po['number'])}`})),
    'not_found',
  );
  assert.equal(code(call(w, 'customer', 'list_events')), 'forbidden');
  assert.equal(
    code(call(w, 'assistant', 'create_event', {title: 'x', start: '2026-11-24T10:00'})),
    'forbidden',
  );
});

test('make, move, invite and cancel a meeting; only its organiser or the manager may change it', () => {
  const w = freshWorld('demo');
  const made = data(
    call(w, 'buyer', 'create_event', {
      title: 'Call about winter stock',
      start: '2026-11-24T09:30',
      minutes: 45,
      kind: 'supplier_call',
      invite: ['S-05'],
      links: {supplier_id: 'SUP-01'},
    }),
  ) as {event: Entry; warnings: string[]};
  assert.equal(made.event.end, '2026-11-24T10:15:00Z');
  assert.deepEqual(made.warnings, []);
  const id = made.event.id;
  assert.match(id, /^EV-\d{4}$/);
  // Saturday, and Mole is not at work then: booked anyway, with a warning.
  const moved = data(
    call(w, 'buyer', 'update_event', {event_id: id, start: '2026-11-28T10:00', invite: ['S-04']}),
  ) as {event: Entry; warnings: string[]};
  assert.equal(moved.event.start, '2026-11-28T10:00:00Z');
  assert.equal(moved.event.end, '2026-11-28T10:45:00Z', 'a move keeps the length');
  assert.ok(
    moved.warnings.some((x) => /Mole does not work on Saturdays/.test(x)),
    moved.warnings.join(),
  );
  assert.equal(code(call(w, 'support_agent', 'cancel_event', {event_id: id})), 'forbidden');
  assert.equal(
    code(call(w, 'buyer', 'create_event', {title: 'x', start: 'tomorrow'})),
    'invalid_input',
  );
  assert.equal(
    code(
      call(w, 'buyer', 'create_event', {title: 'x', start: '2026-11-24T10:00', invite: ['S-99']}),
    ),
    'not_found',
  );
  assert.equal(
    code(
      call(w, 'buyer', 'create_event', {
        title: 'x',
        start: '2026-11-24T10:00',
        links: {po: 'PO-0'},
      }),
    ),
    'not_found',
  );
  data(call(w, 'manager', 'cancel_event', {event_id: id, reason: 'Moved to email'}));
  assert.equal(code(call(w, 'buyer', 'cancel_event', {event_id: id})), 'already_done');
  const week = data(
    call(w, 'buyer', 'list_events', {
      from: '2026-11-23',
      to: '2026-11-29',
      include_cancelled: true,
    }),
  ) as Listed;
  assert.equal(week.events.find((e) => e.id === id)?.status, 'cancelled');
  const audit = w.state['audit'] as {tool: string; changes: string[]}[];
  assert.ok(
    audit.some((a) => a.tool === 'cancel_event' && a.changes.some((c) => c.includes('cancelled'))),
  );
});

test('a clash with someone already booked is a warning', () => {
  const w = freshWorld('demo');
  data(
    call(w, 'manager', 'create_event', {
      title: 'Stock check',
      start: '2026-11-24T09:00',
      minutes: 60,
      invite: ['S-05'],
    }),
  );
  const second = data(
    call(w, 'manager', 'create_event', {
      title: 'Packing training',
      start: '2026-11-24T09:30',
      invite: ['S-05'],
    }),
  ) as {warnings: string[]};
  assert.ok(
    second.warnings.some((x) => x.includes('already has “Stock check”')),
    second.warnings.join(),
  );
});

test('a request from outside waits as tentative until the person it invites accepts or declines it', () => {
  const w = freshWorld('demo');
  assert.equal(
    code(call(w, 'manager', 'receive_meeting_request', {title: 'x', start: '2026-11-25T11:00'})),
    'forbidden',
  );
  const asked = data(
    call(w, 'world', 'receive_meeting_request', {
      supplier_id: 'SUP-02',
      title: 'Winter ice prices',
      start: '2026-11-25T09:15',
    }),
  ) as {event: Entry & {from_outside: {name: string; email: string}}};
  const ev = asked.event;
  assert.equal(ev.status, 'tentative');
  assert.equal(ev.kind, 'supplier_call');
  assert.equal(ev.from_outside.name, 'Captain Hatteras');
  assert.deepEqual(
    ev.people.map((p) => p.id),
    ['S-09'],
    'the buyer, by default',
  );
  assert.equal(
    code(call(w, 'support_agent', 'update_event', {event_id: ev.id, status: 'confirmed'})),
    'forbidden',
  );
  assert.equal(
    (
      data(call(w, 'buyer', 'update_event', {event_id: ev.id, status: 'confirmed'})) as {
        event: Entry;
      }
    ).event.status,
    'confirmed',
  );
  const history = (
    data(call(w, 'buyer', 'get_event', {event_id: ev.id})) as {history: {event: string}[]}
  ).history;
  assert.deepEqual(
    history.map((h) => h.event),
    ['asked for', 'accepted'],
  );
});

test('the range is checked, and search finds entries by words and people', () => {
  const w = freshWorld('demo');
  assert.equal(
    code(call(w, 'manager', 'list_events', {from: '2026-01-01', to: '2026-12-31'})),
    'invalid_input',
  );
  assert.equal(
    code(call(w, 'manager', 'list_events', {from: '2026-11-30', to: '2026-11-23'})),
    'invalid_input',
  );
  const mole = data(call(w, 'manager', 'list_events', {staff_id: 'S-05'})) as Listed;
  assert.equal(mole.total, 5);
  const found = data(call(w, 'manager', 'list_events', {search: 'black friday'})) as Listed;
  assert.ok(found.total >= 1 && found.events.every((e) => /black friday/i.test(e.title)));
});
