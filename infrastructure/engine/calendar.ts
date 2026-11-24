/**
 * @fileoverview Engine extension: the company calendar. One schedule for the whole business, made of two kinds of
 * entry.
 *
 * Entries read from records. Deliveries due (purchase orders), bookings, staff shifts (the team and its hours),
 * campaigns, world events and task due dates are worked out from their own records every time the calendar is read.
 * WHY not copies: a copy drifts. When a supplier delays a delivery or a manager changes someone's hours, the
 * calendar shows it at once, because it reads the same record. These entries are changed through their own tool
 * (each says which, in `change_with`), never here.
 *
 * Entries people make. Meetings, supplier calls, reminders: made, moved and cancelled here, by staff or an AI
 * acting as a staff role, kept in `state.calendar_events`. A request from outside (a supplier asking for a call)
 * arrives through the world lens and waits as "tentative" until someone accepts or declines it.
 *
 * Times are the world's clock (UTC, like every record), and a day is a date (YYYY-MM-DD).
 * Meetings do not take staff time in the simulator yet: they are records, not work.
 *
 * Registration: imported by infrastructure/engine/all.js.
 */
import {extend, kit} from './engine.js';
import type {EngineState, EngineTool, PlannedPerson, ToolContext} from './engine.js';
import {effectiveStaff} from './levers.js';
import type {StaffChanges} from './levers.js';
import {supplierPeople} from '../../simulation/world/supplier-side.mjs';

// WHY the annotation: TypeScript only narrows after a never-returning call whose type is written out.
const fail: (code: string, message: string) => never = kit.fail;
const {nextId, tokens, matches, roles} = kit;
const {str, strs, bool, obj} = kit.schema;
const int = {type: 'integer'};
const DAY_MS = 86_400_000;

/** The kinds of entry read from records. */
const RECORD_KINDS = ['delivery', 'booking', 'shift', 'campaign', 'world', 'task'] as const;
/** The kinds of entry people make. */
const MADE_KINDS = ['meeting', 'supplier_call', 'reminder', 'other'] as const;
const ALL_KINDS: readonly string[] = [...RECORD_KINDS, ...MADE_KINDS];

/** Roles that work bookings: the help desk, the Fix Club, the coordinator, the manager. */
const BOOKING_READERS = [
  'support_agent',
  'support_lead',
  'technician',
  'coordinator',
  'manager',
  'operations_assistant',
];

/**
 * Who may see each kind. WHY: the calendar must not become a side door into records a role cannot read through its
 * own tools. Deliveries carry purchase orders (stock readers), campaigns carry spend (marketing readers).
 */
const READERS: Readonly<Record<string, readonly string[]>> = {
  delivery: roles.STOCK_READERS,
  booking: BOOKING_READERS,
  shift: roles.INTERNAL,
  campaign: roles.MARKETING_READERS,
  world: roles.INTERNAL,
  task: roles.INTERNAL,
  meeting: roles.INTERNAL,
  supplier_call: roles.INTERNAL,
  reminder: roles.INTERNAL,
  other: roles.INTERNAL,
};

/** The tool that changes each kind read from records. */
const CHANGE_WITH: Readonly<Record<string, string>> = {
  delivery: 'receive_purchase_order (or a supplier agreeing a new date)',
  booking: 'reschedule_booking or cancel_booking',
  shift: 'set_staffing',
  campaign: 'update_campaign or end_campaign',
  world: 'edit_world_event or cancel_world_event',
  task: 'update_task',
};

/** The longest stretch one list may cover. WHY: a quarter is enough for any view and keeps a list readable. */
const MAX_RANGE_DAYS = 92;
const MAX_ROWS = 600;
/** The longest timed entry, in minutes. WHY: anything longer is an all-day entry. */
const MAX_MINUTES = 12 * 60;
const MAX_TITLE = 120;
const MAX_NOTES = 2000;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

type Row = Record<string, unknown>;

/** A person on an entry. */
interface Person {
  id: string;
  name: string;
}

/** Someone outside the company on an entry they asked for. */
interface Outsider {
  name: string;
  email: string | null;
  organisation: string | null;
  supplier_id: string | null;
}

/** An entry people made, as kept in state.calendar_events. */
interface MadeEvent {
  id: string;
  kind: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  where: string | null;
  notes: string;
  organiser: Person & {role: string};
  invited: string[];
  outside: Outsider | null;
  links: Record<string, string>;
  status: 'confirmed' | 'tentative' | 'cancelled';
  created_at: string;
  history: {at: string; by: string; event: string}[];
}

/** One entry as every reader sees it, whichever kind. */
export interface CalendarEntry {
  id: string;
  kind: string;
  title: string;
  /** A date (all-day) or a time (ISO, UTC). */
  start: string;
  /** For all-day entries the last day (inclusive); for timed ones the end time. */
  end: string;
  all_day: boolean;
  status: string;
  where: string | null;
  notes: string;
  people: Person[];
  organiser: Person | null;
  from_outside: Outsider | null;
  /** The record this entry is read from or about, to open it: {kind, id}. */
  record: {kind: string; id: string} | null;
  links: Record<string, string>;
  /** "record" (read from a record), "made" (by staff) or "outside" (asked for by someone outside). */
  source: 'record' | 'made' | 'outside';
  editable: boolean;
  /** For entries read from records: the tool that changes them. */
  change_with: string | null;
}

// ------------------------------------------------------------------ dates

const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: string): boolean => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z?$/.test(s);
const dayOf = (iso: string): string => iso.slice(0, 10);
const addDays = (date: string, n: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const weekday = (date: string): string => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? '';

/** A time as the engine writes it: "2026-11-24T10:00:00Z". */
function timeOf(s: string): string {
  const t = Date.parse(s.endsWith('Z') ? s : `${s}Z`);
  if (Number.isNaN(t))
    fail('invalid_input', `"${s}" is not a time. Write it like 2026-11-24T10:00.`);
  return new Date(t).toISOString().replace('.000Z', 'Z');
}

/** The Monday of the week holding a date. WHY Monday: a UK business week starts on Monday. */
function mondayOf(date: string): string {
  const back = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -back);
}

/** Whether an entry touches the days from..to (inclusive). */
function overlaps(e: CalendarEntry, from: string, to: string): boolean {
  const first = dayOf(e.start);
  // A timed entry that ends at midnight belongs to the day it started.
  const last = e.all_day ? dayOf(e.end) : dayOf(new Date(Date.parse(e.end) - 1).toISOString());
  return first <= to && last >= from;
}

// ------------------------------------------------------------------ reading the records

function list(st: EngineState, key: string): Row[] {
  const v = st[key];
  return Array.isArray(v) ? (v as Row[]) : [];
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const sOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The team today, with hires and leavers, from the plan the server attaches. */
function teamOf(ctx: ToolContext): PlannedPerson[] {
  const plan = ctx.world.plan?.staff ?? [];
  const settings = ctx.st['settings'] as {staff?: StaffChanges} | undefined;
  return effectiveStaff(plan, settings?.staff ?? null);
}

function personById(ctx: ToolContext, id: string): PlannedPerson {
  const p = teamOf(ctx).find((x) => x.id === id);
  if (p === undefined)
    fail('not_found', `No one with id ${id} works here. list_staff shows who does.`);
  return p;
}

/** The person making the call: the first with the caller's role, else the role itself (the AI assistant). */
function caller(ctx: ToolContext): Person & {role: string} {
  const p = teamOf(ctx).find((x) => x.role === ctx.role);
  if (p !== undefined) return {id: p.id, name: p.name, role: p.role};
  const name = ctx.role === 'operations_assistant' ? 'Operations assistant (AI)' : ctx.role;
  return {id: ctx.role, name, role: ctx.role};
}

function blank(
  o: Pick<CalendarEntry, 'id' | 'kind' | 'title' | 'start' | 'end' | 'all_day'>,
): CalendarEntry {
  return {
    ...o,
    status: 'confirmed',
    where: null,
    notes: '',
    people: [],
    organiser: null,
    from_outside: null,
    record: null,
    links: {},
    source: 'record',
    editable: false,
    change_with: CHANGE_WITH[o.kind] ?? null,
  };
}

/** Deliveries: each purchase order on the day it is due, or the day it arrived. */
function deliveries(ctx: ToolContext): CalendarEntry[] {
  const names = new Map(list(ctx.st, 'suppliers').map((x) => [s(x['id']), s(x['name'])]));
  const out: CalendarEntry[] = [];
  for (const po of list(ctx.st, 'purchase_orders')) {
    const status = s(po['status']);
    if (status === 'cancelled') continue;
    const arrived = sOrNull(po['received_at']);
    const day = dayOf(arrived ?? sOrNull(po['expected_at']) ?? s(po['due_at']));
    if (!isDate(day)) continue;
    const number = s(po['number']);
    const supplier = names.get(s(po['supplier_id'])) ?? 'a supplier';
    const lines = Array.isArray(po['lines']) ? (po['lines'] as Row[]) : [];
    const e = blank({
      id: `delivery:${number}`,
      kind: 'delivery',
      title: `Delivery from ${supplier}`,
      start: day,
      end: day,
      all_day: true,
    });
    e.status = arrived !== null ? 'arrived' : status === 'late' ? 'late' : 'due';
    e.notes = lines.map((l) => `${String(l['qty'])} × ${s(l['sku'])}`).join(', ');
    e.record = {kind: 'po', id: number};
    e.links = {po: number, supplier_id: s(po['supplier_id'])};
    out.push(e);
  }
  return out;
}

/** Bookings: each service booking at its own time. */
function bookings(ctx: ToolContext): CalendarEntry[] {
  const names = new Map(list(ctx.st, 'customers').map((c) => [s(c['id']), s(c['name'])]));
  const out: CalendarEntry[] = [];
  for (const b of list(ctx.st, 'bookings')) {
    const start = s(b['start']);
    if (start === '') continue;
    const allDay = isDate(start);
    const end =
      s(b['end']) || (allDay ? start : new Date(Date.parse(start) + 3_600_000).toISOString());
    const number = s(b['number']);
    const e = blank({
      id: `booking:${number}`,
      kind: 'booking',
      title: `${s(b['service']).replace(/-/g, ' ')} for ${names.get(s(b['customer_id'])) ?? 'a customer'}`,
      start: allDay ? start : timeOf(start),
      end: allDay ? dayOf(end) : timeOf(end),
      all_day: allDay,
    });
    e.status = s(b['status']) || 'confirmed';
    e.where = sOrNull(b['location']);
    e.record = {kind: 'booking', id: number};
    e.links = {booking: number, customer_id: s(b['customer_id'])};
    out.push(e);
  }
  return out;
}

/**
 * Shifts: each person on each working day in the range, from their start time for their contracted hours (weekly
 * hours spread over the working days). WHY contracted, not the simulator's scaled hours: a calendar shows the rota as
 * written; list_staff gives the hours as worked at this world's size.
 */
function shifts(ctx: ToolContext, from: string, to: string): CalendarEntry[] {
  const plan = ctx.world.plan;
  const days = plan?.work_days ?? ['mon', 'tue', 'wed', 'thu', 'fri'];
  const out: CalendarEntry[] = [];
  for (const p of teamOf(ctx)) {
    const minutes = Math.round(((p.weekly_hours || 0) / Math.max(1, days.length)) * 60);
    if (minutes <= 0) continue;
    const begins = p.start ?? plan?.day_start ?? '09:00';
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (!days.includes(weekday(d))) continue;
      if (p.joined != null && d < p.joined) continue;
      const start = timeOf(`${d}T${begins}`);
      const e = blank({
        id: `shift:${p.id}:${d}`,
        kind: 'shift',
        title: `${p.name} at work`,
        start,
        end: new Date(Date.parse(start) + minutes * 60_000).toISOString().replace('.000Z', 'Z'),
        all_day: false,
      });
      e.people = [{id: p.id, name: p.name}];
      e.notes = p.job ?? '';
      e.record = {kind: 'staff', id: p.id};
      out.push(e);
    }
  }
  return out;
}

/** Campaigns: from their first day to their last. */
function campaigns(ctx: ToolContext): CalendarEntry[] {
  return list(ctx.st, 'campaigns')
    .filter((c) => isDate(s(c['start'])))
    .map((c) => {
      const start = s(c['start']);
      const end = isDate(s(c['end'])) ? s(c['end']) : start;
      const e = blank({
        id: `campaign:${s(c['id'])}`,
        kind: 'campaign',
        title: s(c['name']) || 'A campaign',
        start,
        end,
        all_day: true,
      });
      e.status = s(c['status']) || (end < dayOf(ctx.now) ? 'over' : 'running');
      e.notes = s(c['channel']);
      e.record = {kind: 'campaign', id: s(c['id'])};
      e.links = {campaign_id: s(c['id'])};
      return e;
    });
}

/** World events: from their first day to their last, unless cancelled. */
function worldEvents(ctx: ToolContext): CalendarEntry[] {
  return list(ctx.st, 'world_events')
    .filter((w) => isDate(s(w['start'])) && s(w['status']) !== 'cancelled')
    .map((w) => {
      const start = s(w['start']);
      const e = blank({
        id: `world:${s(w['id'])}`,
        kind: 'world',
        title: s(w['title']) || 'Something in the world',
        start,
        end: isDate(s(w['end'])) ? s(w['end']) : start,
        all_day: true,
      });
      e.status = s(w['status']) || 'scheduled';
      e.notes = s(w['headline']);
      e.record = {kind: 'world_event', id: s(w['id'])};
      e.links = {world_event: s(w['id'])};
      return e;
    });
}

/** Open tasks on the day they are due. */
function tasks(ctx: ToolContext): CalendarEntry[] {
  const team = new Map(teamOf(ctx).map((p) => [p.id, p.name]));
  return list(ctx.st, 'tasks')
    .filter((t) => isDate(s(t['due'])) && ['to_do', 'doing'].includes(s(t['status'])))
    .map((t) => {
      const due = s(t['due']);
      const who = s(t['assignee']);
      const e = blank({
        id: `task:${s(t['id'])}`,
        kind: 'task',
        title: `Due: ${s(t['title'])}`,
        start: due,
        end: due,
        all_day: true,
      });
      e.status = due < dayOf(ctx.now) ? 'overdue' : s(t['status']);
      e.people = [{id: who, name: team.get(who) ?? 'Someone who has left'}];
      e.record = {kind: 'task', id: s(t['id'])};
      return e;
    });
}

function made(st: EngineState): MadeEvent[] {
  const v = st['calendar_events'];
  if (Array.isArray(v)) return v as MadeEvent[];
  const fresh: MadeEvent[] = [];
  st['calendar_events'] = fresh;
  return fresh;
}

/** An entry people made, as readers see it. */
function viewMade(ctx: ToolContext, ev: MadeEvent): CalendarEntry {
  const team = new Map(teamOf(ctx).map((p) => [p.id, p.name]));
  return {
    id: ev.id,
    kind: ev.kind,
    title: ev.title,
    start: ev.start,
    end: ev.end,
    all_day: ev.all_day,
    status: ev.status,
    where: ev.where,
    notes: ev.notes,
    people: ev.invited.map((id) => ({id, name: team.get(id) ?? 'Someone who has left'})),
    organiser: {id: ev.organiser.id, name: ev.organiser.name},
    from_outside: ev.outside,
    record: ev.links['supplier_id'] ? {kind: 'supplier', id: ev.links['supplier_id']} : null,
    links: ev.links,
    source: ev.outside !== null ? 'outside' : 'made',
    editable: ev.status !== 'cancelled' && mayChange(ctx, ev),
    change_with: null,
  };
}

/** Every entry the caller may see that touches from..to. */
function entries(ctx: ToolContext, from: string, to: string): CalendarEntry[] {
  const can = (kind: string): boolean => READERS[kind]?.includes(ctx.role) === true;
  const out: CalendarEntry[] = [];
  if (can('delivery')) out.push(...deliveries(ctx));
  if (can('booking')) out.push(...bookings(ctx));
  if (can('shift')) out.push(...shifts(ctx, from, to));
  if (can('campaign')) out.push(...campaigns(ctx));
  if (can('world')) out.push(...worldEvents(ctx));
  if (can('task')) out.push(...tasks(ctx));
  for (const ev of made(ctx.st)) if (can(ev.kind)) out.push(viewMade(ctx, ev));
  return out.filter((e) => overlaps(e, from, to));
}

/** Soonest first; on the same day, all-day entries before timed ones. */
function byStart(a: CalendarEntry, b: CalendarEntry): number {
  const da = dayOf(a.start);
  const db = dayOf(b.start);
  if (da !== db) return da < db ? -1 : 1;
  if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
  return a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1;
}

/** One entry by id, whichever kind, or a refusal that looks the same as "not there" for a role that may not see it. */
function findEntry(ctx: ToolContext, id: string): CalendarEntry {
  const own = made(ctx.st).find((e) => e.id === id);
  if (own !== undefined && READERS[own.kind]?.includes(ctx.role) === true)
    return viewMade(ctx, own);
  const m = /^(delivery|booking|shift|campaign|world|task):(.+)$/.exec(id);
  if (m?.[1] !== undefined && m[2] !== undefined) {
    // A shift id carries its day; every other kind is found across all time.
    const day = m[1] === 'shift' ? (m[2].split(':')[1] ?? '') : null;
    const from = day !== null && isDate(day) ? day : '0000-01-01';
    const to = day !== null && isDate(day) ? day : '9999-12-31';
    const hit =
      m[1] === 'shift'
        ? entries(ctx, from, to).find((e) => e.id === id)
        : allOfKind(ctx, m[1]).find((e) => e.id === id);
    if (hit !== undefined) return hit;
  }
  return fail('not_found', `There is no calendar entry ${id}. list_events shows what there is.`);
}

function allOfKind(ctx: ToolContext, kind: string): CalendarEntry[] {
  if (READERS[kind]?.includes(ctx.role) !== true) return [];
  if (kind === 'delivery') return deliveries(ctx);
  if (kind === 'booking') return bookings(ctx);
  if (kind === 'campaign') return campaigns(ctx);
  if (kind === 'world') return worldEvents(ctx);
  if (kind === 'task') return tasks(ctx);
  return [];
}

// ------------------------------------------------------------------ making and changing entries

/** Only the organiser's role, or the manager, may change an entry. WHY: a shared calendar, not a free-for-all. */
function mayChange(ctx: ToolContext, ev: MadeEvent): boolean {
  if (ctx.role === 'manager' || ctx.role === ev.organiser.role) return true;
  // A request from outside belongs to whoever it invites.
  if (ev.outside !== null) {
    const team = teamOf(ctx);
    return ev.invited.some((id) => team.find((p) => p.id === id)?.role === ctx.role);
  }
  return false;
}

function ownEvent(ctx: ToolContext, id: string): MadeEvent {
  const ev = made(ctx.st).find((e) => e.id === id);
  if (ev === undefined) {
    if (/^(delivery|booking|shift|campaign|world|task):/.test(id)) {
      const kind = id.split(':')[0] ?? '';
      fail(
        'rule_violation',
        `This entry comes from its own record, so it changes there: use ${CHANGE_WITH[kind] ?? 'that record’s own tool'}.`,
      );
    }
    fail('not_found', `There is no calendar entry ${id}.`);
  }
  if (READERS[ev.kind]?.includes(ctx.role) !== true)
    fail('not_found', `There is no calendar entry ${id}.`);
  if (!mayChange(ctx, ev))
    fail(
      'forbidden',
      `${ev.organiser.name} made this entry, so only they (or the manager) can change it.`,
    );
  if (ev.status === 'cancelled') fail('already_done', `${ev.title} was cancelled.`);
  return ev;
}

function text(v: unknown, key: string, max: number): string {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  if (t.length > max) fail('invalid_input', `"${key}" is at most ${max} characters.`);
  return t;
}

/** When an entry starts and ends, from the input: a day (all-day), or a start and an end or a length. */
function when(
  i: Record<string, unknown>,
  was: MadeEvent | null,
): {start: string; end: string; all_day: boolean} {
  const allDay = typeof i['all_day'] === 'boolean' ? i['all_day'] : (was?.all_day ?? false);
  const rawStart = typeof i['start'] === 'string' ? i['start'] : was?.start;
  if (rawStart === undefined) fail('invalid_input', 'Say when it starts ("start").');
  if (allDay) {
    const start = dayOf(rawStart);
    if (!isDate(start)) fail('invalid_input', 'An all-day entry starts on a day: 2026-11-24.');
    const rawEnd = typeof i['end'] === 'string' ? dayOf(i['end']) : null;
    const keep = was?.all_day === true ? daysBetween(was.start, was.end) : 0;
    const end = rawEnd ?? addDays(start, keep);
    if (!isDate(end) || end < start)
      fail('invalid_input', 'The last day cannot be before the first.');
    if (daysBetween(start, end) > MAX_RANGE_DAYS)
      fail('invalid_input', `An entry lasts at most ${MAX_RANGE_DAYS} days.`);
    return {start, end, all_day: true};
  }
  if (!isTime(rawStart))
    fail('invalid_input', 'A timed entry starts at a time: 2026-11-24T10:00 (or say all_day).');
  const start = timeOf(rawStart);
  let minutes: number;
  if (typeof i['minutes'] === 'number') minutes = i['minutes'];
  else if (typeof i['end'] === 'string')
    minutes = (Date.parse(timeOf(i['end'])) - Date.parse(start)) / 60_000;
  else if (was !== null && !was.all_day)
    minutes = (Date.parse(was.end) - Date.parse(was.start)) / 60_000;
  else minutes = 30;
  if (!(minutes >= 5 && minutes <= MAX_MINUTES))
    fail('invalid_input', `A timed entry lasts from 5 minutes to ${MAX_MINUTES / 60} hours.`);
  return {
    start,
    end: new Date(Date.parse(start) + minutes * 60_000).toISOString().replace('.000Z', 'Z'),
    all_day: false,
  };
}

/** Staff ids, checked against the team. */
function staffIds(ctx: ToolContext, v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))
    fail('invalid_input', '"invite" is a list of staff ids, such as ["S-04"].');
  const ids = [...new Set(v as string[])];
  for (const id of ids) personById(ctx, id);
  return ids;
}

const LINK_KINDS = ['po', 'supplier_id', 'customer_id', 'case', 'order', 'booking'];

/** Links to records, each checked to exist, so an entry always opens onto something real. */
function checkLinks(ctx: ToolContext, v: unknown): Record<string, string> {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v))
    fail('invalid_input', `"links" is an object: ${LINK_KINDS.join(', ')}.`);
  const out: Record<string, string> = {};
  const where: Record<string, [string, string]> = {
    po: ['purchase_orders', 'number'],
    supplier_id: ['suppliers', 'id'],
    customer_id: ['customers', 'id'],
    case: ['cases', 'number'],
    order: ['orders', 'number'],
    booking: ['bookings', 'number'],
  };
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (raw === undefined || raw === null || raw === '') continue;
    const spot = where[k];
    if (spot === undefined)
      fail('invalid_input', `An entry can link to: ${LINK_KINDS.join(', ')}.`);
    if (typeof raw !== 'string') fail('invalid_input', `The ${k} link is a record id, as text.`);
    const id = raw;
    if (!list(ctx.st, spot[0]).some((r) => r[spot[1]] === id))
      fail('not_found', `There is no ${k.replace(/_id$/, '')} ${id}.`);
    out[k] = id;
  }
  return out;
}

/**
 * Plain warnings for an entry: invited people who are not at work then, or already busy. WHY warnings, not
 * refusals: a real calendar lets you book over a clash and tells you so; how an AI handles that is worth seeing.
 */
function warnings(ctx: ToolContext, ev: MadeEvent): string[] {
  const out: string[] = [];
  const day = dayOf(ev.start);
  const team = teamOf(ctx);
  const last = ev.all_day ? ev.end : day;
  // WHY not entries(): the caller's role may not see shifts (a request from outside comes through the world lens),
  // but a clash is a fact about the people invited, whoever asks.
  const rota = shifts(ctx, day, last);
  const others = made(ctx.st)
    .filter((e) => e.id !== ev.id && e.status !== 'cancelled' && !e.all_day)
    .map((e) => viewMade(ctx, e));
  for (const id of ev.invited) {
    const p = team.find((x) => x.id === id);
    if (p === undefined) continue;
    if (!ev.all_day) {
      const shift = rota.find((e) => e.people[0]?.id === id);
      if (shift === undefined) out.push(`${p.name} does not work on ${weekdayWord(day)}s.`);
      else if (ev.start < shift.start || ev.end > shift.end)
        out.push(`${p.name} works ${clock(shift.start)} to ${clock(shift.end)} that day.`);
    }
    const clash = others.find(
      (e) =>
        !ev.all_day && e.people.some((x) => x.id === id) && e.start < ev.end && ev.start < e.end,
    );
    if (clash !== undefined) out.push(`${p.name} already has “${clash.title}” then.`);
  }
  return out;
}

const clock = (iso: string): string => iso.slice(11, 16);
function weekdayWord(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    timeZone: 'UTC',
  });
}

function kindOf(v: unknown, fallback: string): string {
  const k = typeof v === 'string' && v !== '' ? v : fallback;
  if (!(MADE_KINDS as readonly string[]).includes(k))
    fail('invalid_input', `The kind is one of: ${MADE_KINDS.join(', ')}.`);
  return k;
}

function stampOf(ctx: ToolContext): string {
  return new Date(Date.parse(ctx.now)).toISOString().replace('.000Z', 'Z');
}

/** Makes an entry: the shared part of create_event and receive_meeting_request. */
function makeEntry(
  ctx: ToolContext,
  i: Record<string, unknown>,
  o: {
    organiser: MadeEvent['organiser'];
    outside: Outsider | null;
    kind: string;
    status: MadeEvent['status'];
  },
): {event: CalendarEntry; warnings: string[]} {
  const title = text(i['title'], 'title', MAX_TITLE);
  if (title === '') fail('invalid_input', 'Give the entry a title ("title").');
  const time = when(i, null);
  const ev: MadeEvent = {
    id: nextId(ctx, 'EV', 4),
    kind: o.kind,
    title,
    ...time,
    where: text(i['where'], 'where', MAX_TITLE) || null,
    notes: text(i['notes'], 'notes', MAX_NOTES),
    organiser: o.organiser,
    invited: staffIds(ctx, i['invite']),
    outside: o.outside,
    links: checkLinks(ctx, i['links']),
    status: o.status,
    created_at: stampOf(ctx),
    history: [],
  };
  ev.history.push({
    at: ev.created_at,
    by: o.organiser.name,
    event: o.outside ? 'asked for' : 'made',
  });
  made(ctx.st).push(ev);
  ctx.changes.push(
    `calendar ${ev.id} “${ev.title}” ${o.outside ? 'asked for by' : 'made by'} ${o.organiser.name}, ${ev.start}`,
  );
  return {event: viewMade(ctx, ev), warnings: warnings(ctx, ev)};
}

// ------------------------------------------------------------------ the tools

const TOOLS: EngineTool[] = [
  {
    name: 'list_events',
    roles: roles.INTERNAL,
    description:
      'The company calendar between two days (from and to, YYYY-MM-DD, inclusive; at most 92 days; default this week, Monday to Sunday). Entries read from records: deliveries due (purchase orders), bookings, staff shifts, campaigns, world events, task due dates. Entries people made: meetings, supplier calls, reminders. Filters: kinds (a list), staff_id (only entries with that person), search (words in the title, place, notes or names), include_cancelled. Each entry says where it comes from (record), whether you may change it here (editable) and, if not, which tool changes it (change_with). Kinds your role may not see are named in not_shown.',
    input_schema: obj({
      from: str,
      to: str,
      kinds: strs,
      staff_id: str,
      search: str,
      include_cancelled: bool,
    }),
    // WHY one list: an AI that plans anything (a call, a delivery, cover for a sale) needs the whole schedule in one read.
    run(ctx, i) {
      const today = dayOf(ctx.now);
      const from = typeof i['from'] === 'string' ? i['from'] : mondayOf(today);
      const to = typeof i['to'] === 'string' ? i['to'] : addDays(from, 6);
      if (!isDate(from) || !isDate(to)) fail('invalid_input', 'Days look like 2026-11-24.');
      if (to < from) fail('invalid_input', 'The last day cannot be before the first.');
      if (daysBetween(from, to) >= MAX_RANGE_DAYS)
        fail('invalid_input', `One list covers at most ${MAX_RANGE_DAYS} days.`);
      const kinds = Array.isArray(i['kinds']) ? (i['kinds'] as string[]) : null;
      for (const k of kinds ?? [])
        if (!ALL_KINDS.includes(k))
          fail('invalid_input', `The kinds are: ${ALL_KINDS.join(', ')}.`);
      const staff = typeof i['staff_id'] === 'string' ? i['staff_id'] : null;
      const words = typeof i['search'] === 'string' ? tokens(i['search']) : [];
      const rows = entries(ctx, from, to)
        .filter(
          (e) =>
            (kinds === null || kinds.includes(e.kind)) &&
            (i['include_cancelled'] === true || e.status !== 'cancelled') &&
            (staff === null || e.people.some((p) => p.id === staff) || e.organiser?.id === staff) &&
            (words.length === 0 ||
              matches(
                `${e.title} ${e.where ?? ''} ${e.notes} ${e.people.map((p) => p.name).join(' ')} ${e.from_outside?.name ?? ''}`,
                words,
              )),
        )
        .sort(byStart);
      return {
        from,
        to,
        today,
        total: rows.length,
        not_shown: ALL_KINDS.filter((k) => READERS[k]?.includes(ctx.role) !== true),
        events: rows.slice(0, MAX_ROWS),
      };
    },
  },
  {
    name: 'get_event',
    roles: roles.INTERNAL,
    description:
      'One calendar entry by id (from list_events): when, who, where, notes, the record it comes from or is about, whether you may change it here, and for entries people made, what happened to it.',
    input_schema: obj({event_id: str}, ['event_id']),
    run(ctx, i) {
      const entry = findEntry(ctx, String(i['event_id']));
      const own = made(ctx.st).find((e) => e.id === entry.id);
      return own === undefined ? entry : {...entry, history: own.history};
    },
  },
  {
    name: 'create_event',
    roles: roles.INTERNAL,
    description:
      'Puts an entry in the company calendar, made by the person with your role: title, start (a time, 2026-11-24T10:00, or a day with all_day true), and minutes (default 30) or end. kind: meeting (default), supplier_call, reminder or other. invite: staff ids. where, notes, and links to records (po, supplier_id, customer_id, case, order, booking). Returns the entry and warnings: anyone invited who is not at work then or already busy.',
    input_schema: obj(
      {
        title: str,
        start: str,
        end: str,
        minutes: int,
        all_day: bool,
        kind: {type: 'string', enum: [...MADE_KINDS]},
        invite: strs,
        where: str,
        notes: str,
        links: {type: 'object'},
      },
      ['title', 'start'],
    ),
    run(ctx, i) {
      return makeEntry(ctx, i, {
        organiser: caller(ctx),
        outside: null,
        kind: kindOf(i['kind'], 'meeting'),
        status: 'confirmed',
      });
    },
  },
  {
    name: 'update_event',
    roles: roles.INTERNAL,
    description:
      'Changes an entry people made (only its organiser’s role or the manager may; a request from outside also belongs to whoever it invites): move it (start, end or minutes, all_day), rename it (title), where, notes, invite or uninvite staff (lists of staff ids), links, or answer a request from outside (status "confirmed" accepts it). Entries read from records change through their own tool (see change_with). Returns the entry and any warnings.',
    input_schema: obj(
      {
        event_id: str,
        title: str,
        start: str,
        end: str,
        minutes: int,
        all_day: bool,
        where: str,
        notes: str,
        invite: strs,
        uninvite: strs,
        links: {type: 'object'},
        status: {type: 'string', enum: ['confirmed', 'tentative']},
      },
      ['event_id'],
    ),
    run(ctx, i) {
      const ev = ownEvent(ctx, String(i['event_id']));
      const said: string[] = [];
      if (
        i['start'] !== undefined ||
        i['end'] !== undefined ||
        i['minutes'] !== undefined ||
        i['all_day'] !== undefined
      ) {
        const time = when(i, ev);
        if (time.start !== ev.start || time.end !== ev.end)
          said.push(`moved from ${ev.start} to ${time.start}`);
        Object.assign(ev, time);
      }
      if (typeof i['title'] === 'string') {
        const t = text(i['title'], 'title', MAX_TITLE);
        if (t === '') fail('invalid_input', 'The title cannot be empty.');
        if (t !== ev.title) said.push(`renamed “${t}”`);
        ev.title = t;
      }
      if (typeof i['where'] === 'string') {
        ev.where = text(i['where'], 'where', MAX_TITLE) || null;
        said.push('place changed');
      }
      if (typeof i['notes'] === 'string') {
        ev.notes = text(i['notes'], 'notes', MAX_NOTES);
        said.push('notes changed');
      }
      const add = staffIds(ctx, i['invite']).filter((id) => !ev.invited.includes(id));
      const drop = Array.isArray(i['uninvite']) ? (i['uninvite'] as string[]) : [];
      if (add.length > 0) said.push(`invited ${add.join(', ')}`);
      if (drop.some((id) => ev.invited.includes(id))) said.push(`uninvited ${drop.join(', ')}`);
      ev.invited = [...ev.invited.filter((id) => !drop.includes(id)), ...add];
      if (i['links'] !== undefined) {
        ev.links = checkLinks(ctx, i['links']);
        said.push('links changed');
      }
      if (i['status'] === 'confirmed' || i['status'] === 'tentative') {
        if (i['status'] !== ev.status)
          said.push(i['status'] === 'confirmed' ? 'accepted' : 'marked tentative');
        ev.status = i['status'];
      }
      if (said.length === 0) fail('invalid_input', 'Say what to change.');
      const by = caller(ctx).name;
      ev.history.push({at: stampOf(ctx), by, event: said.join('; ')});
      ctx.changes.push(`calendar ${ev.id} ${said.join('; ')} by ${by}`);
      return {event: viewMade(ctx, ev), warnings: warnings(ctx, ev)};
    },
  },
  {
    name: 'cancel_event',
    roles: roles.INTERNAL,
    description:
      'Cancels an entry people made, or declines a request from outside, with an optional reason. It stays in the calendar as cancelled (list_events with include_cancelled shows it). Entries read from records cannot be cancelled here.',
    input_schema: obj({event_id: str, reason: str}, ['event_id']),
    run(ctx, i) {
      const ev = ownEvent(ctx, String(i['event_id']));
      const reason = text(i['reason'], 'reason', 300);
      const declined = ev.outside !== null && ev.status === 'tentative';
      ev.status = 'cancelled';
      const by = caller(ctx).name;
      ev.history.push({
        at: stampOf(ctx),
        by,
        event: `${declined ? 'declined' : 'cancelled'}${reason ? `: ${reason}` : ''}`,
      });
      ctx.changes.push(`calendar ${ev.id} ${declined ? 'declined' : 'cancelled'} by ${by}`);
      return {event: viewMade(ctx, ev)};
    },
  },
  {
    name: 'receive_meeting_request',
    roles: ['world'],
    description:
      'World lens only: someone outside the company asks for a meeting or a call (a supplier, a partner, a customer). from_name (or supplier_id, which fills in the supplier’s contact), from_email, organisation, title, start, minutes (default 30), kind (meeting or supplier_call; supplier_call when supplier_id is given), invite (staff ids; default the buyer for a supplier, else the manager), notes. It waits in the calendar as tentative until someone accepts or declines it.',
    input_schema: obj(
      {
        from_name: str,
        from_email: str,
        organisation: str,
        supplier_id: str,
        title: str,
        start: str,
        minutes: int,
        kind: {type: 'string', enum: ['meeting', 'supplier_call']},
        invite: strs,
        notes: str,
        where: str,
      },
      ['title', 'start'],
    ),
    // WHY the world lens: these speak for people outside the company, which a product under test must never do.
    run(ctx, i) {
      const supplierId = typeof i['supplier_id'] === 'string' ? i['supplier_id'] : null;
      const sup =
        supplierId === null ? null : list(ctx.st, 'suppliers').find((x) => x['id'] === supplierId);
      if (supplierId !== null && sup === undefined)
        fail('not_found', `There is no supplier ${supplierId}.`);
      const people = sup ? supplierPeople({id: s(sup['id']), name: s(sup['name'])}) : null;
      const name =
        text(i['from_name'], 'from_name', MAX_TITLE) ||
        people?.contact.name ||
        (sup ? s(sup['name']) : '');
      if (name === '') fail('invalid_input', 'Say who is asking ("from_name" or "supplier_id").');
      const outside: Outsider = {
        name,
        email: text(i['from_email'], 'from_email', MAX_TITLE) || people?.addresses[0] || null,
        organisation:
          text(i['organisation'], 'organisation', MAX_TITLE) || (sup ? s(sup['name']) : null),
        supplier_id: supplierId,
      };
      const team = teamOf(ctx);
      const fallback = team.find((p) => p.role === (sup ? 'buyer' : 'manager'))?.id;
      const input = {
        ...i,
        invite: Array.isArray(i['invite']) ? i['invite'] : fallback !== undefined ? [fallback] : [],
        links: supplierId !== null ? {supplier_id: supplierId} : undefined,
      };
      return makeEntry(ctx, input, {
        organiser: {id: 'outside', name, role: 'world'},
        outside,
        kind: kindOf(i['kind'], sup ? 'supplier_call' : 'meeting'),
        status: 'tentative',
      });
    },
  },
];

extend({state: ['calendar_events'], counters: [['EV', 'calendar_events', 'id']], tools: TOOLS});
