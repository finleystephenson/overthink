/**
 * @fileoverview Engine extension: the address book. Everyone the business knows, in one searchable list: customers,
 * suppliers and the people who answer for them, the team, partners and other organisations it deals with, and
 * prospects (businesses it hopes to sell to).
 *
 * A card is read from the record it stands for every time, so it is never out of date: change a customer's email in
 * the help desk and their card shows it. The address book keeps only what is its own: notes and tags on a card
 * (`state.contact_notes`), which anyone who may see the card can change.
 *
 * Privacy. A role sees only the cards and fields its job needs. WHY: an address book is the easiest place to leak
 * personal data, so it follows the same lines as the business's own tools:
 * - prospects: marketing and the manager only (as list_prospects);
 * - a customer's phone and home address: the people who serve, deliver to or bill them, not marketing or buying;
 * - staff pay: finance and the manager only.
 *
 * Naming. The tools are list_contact_cards, get_contact_card and update_contact_card. WHY not list_contacts: that
 * name already belongs to the help desk's log of customers getting in touch (CT-... records), which products use.
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
const {tokens, matches, roles} = kit;
const {str, strs, obj} = kit.schema;
const int = {type: 'integer'};

const KINDS = ['customer', 'supplier', 'staff', 'partner', 'prospect'] as const;
type Kind = (typeof KINDS)[number];

/** Who may see each kind of card. */
const READERS: Readonly<Record<Kind, readonly string[]>> = {
  customer: roles.INTERNAL,
  supplier: roles.INTERNAL,
  staff: roles.INTERNAL,
  partner: roles.INTERNAL,
  prospect: ['marketing', 'manager'],
};
/** Who may see a customer's phone and home address: the people who serve, deliver to, repair for or bill them. */
const ADDRESS_READERS = [
  'support_agent',
  'support_lead',
  'warehouse',
  'technician',
  'coordinator',
  'finance',
  'manager',
  'operations_assistant',
];
const PAY_READERS = roles.MONEY_READERS;

/** Organisations that are not contacts. WHY: a rival is someone the business watches, not someone it calls. */
const NOT_CONTACTS = ['competitor'];
const DOMAIN = 'overthought.example';
const MAX_NOTES = 2000;
const MAX_TAGS = 12;
const MAX_TAG = 24;

type Row = Record<string, unknown>;

/** A card as every reader sees it. Fields a role may not see are null, and named in `hidden`. */
export interface ContactCard {
  /** The id of the record the card stands for: C-..., SUP-..., S-..., an organisation id, PR-... */
  id: string;
  kind: Kind;
  name: string;
  /** The name to sort by: "Mr Fezziwig" sorts under F. */
  sort_name: string;
  /** Their job, or what the organisation is ("Carrier"). */
  title: string | null;
  organisation: string | null;
  email: string | null;
  phone: string | null;
  town: string | null;
  address: string | null;
  /** Other ways to reach them: a supplier's sales and accounts desks. */
  other_emails: {label: string; email: string}[];
  tags: string[];
  notes: string;
  /** The record to open: {kind, id} in the apps' records layer. */
  record: {kind: string; id: string};
  /** Fields this role may not see on this card. */
  hidden: string[];
}

interface NoteRow {
  card_id: string;
  notes: string;
  tags: string[];
  updated_at: string;
  updated_by: string;
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const sOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function list(st: EngineState, key: string): Row[] {
  const v = st[key];
  return Array.isArray(v) ? (v as Row[]) : [];
}

function notesOf(st: EngineState): NoteRow[] {
  const v = st['contact_notes'];
  if (Array.isArray(v)) return v as NoteRow[];
  const fresh: NoteRow[] = [];
  st['contact_notes'] = fresh;
  return fresh;
}

/** "Mr Fezziwig" → "Fezziwig", "The Walrus" → "Walrus": how a person looks for a name in a list. */
export function sortName(name: string): string {
  return name.replace(/^(mr|mrs|ms|miss|dr|captain|the|sir|lady|lord)\.?\s+/i, '').trim() || name;
}

const words = (w: string): string => {
  const t = w.replace(/[_-]+/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function teamOf(ctx: ToolContext): PlannedPerson[] {
  const settings = ctx.st['settings'] as {staff?: StaffChanges} | undefined;
  return effectiveStaff(ctx.world.plan?.staff ?? [], settings?.staff ?? null);
}

function card(
  o: Pick<ContactCard, 'id' | 'kind' | 'name' | 'record'> & Partial<ContactCard>,
): ContactCard {
  return {
    sort_name: sortName(o.name),
    title: null,
    organisation: null,
    email: null,
    phone: null,
    town: null,
    address: null,
    other_emails: [],
    tags: [],
    notes: '',
    hidden: [],
    ...o,
  };
}

function customers(ctx: ToolContext): ContactCard[] {
  const full = ADDRESS_READERS.includes(ctx.role);
  return list(ctx.st, 'customers').map((c) => {
    const addresses = Array.isArray(c['addresses']) ? (c['addresses'] as Row[]) : [];
    const home = addresses.find((a) => a['default'] === true) ?? addresses[0];
    return card({
      id: s(c['id']),
      kind: 'customer',
      name: s(c['name']),
      title: 'Customer',
      email: sOrNull(c['email']),
      phone: full ? sOrNull(c['phone']) : null,
      town: home ? sOrNull(home['town']) : null,
      address:
        full && home ? `${s(home['line1'])}, ${s(home['town'])} ${s(home['postcode'])}` : null,
      record: {kind: 'customer', id: s(c['id'])},
      hidden: full ? [] : ['phone', 'address'],
    });
  });
}

function suppliers(ctx: ToolContext): ContactCard[] {
  return list(ctx.st, 'suppliers').map((x) => {
    const id = s(x['id']);
    const name = s(x['name']);
    const people = supplierPeople({id, name});
    return card({
      id,
      kind: 'supplier',
      name: people ? people.contact.name : name,
      title: 'Supplier',
      organisation: name,
      email: people ? people.addresses[0] : null,
      town: sOrNull(x['town']),
      other_emails: people
        ? [
            {label: 'Orders', email: people.addresses[1]},
            {label: 'Accounts', email: people.addresses[2]},
          ]
        : [],
      record: {kind: 'supplier', id},
    });
  });
}

function staff(ctx: ToolContext): ContactCard[] {
  const pay = PAY_READERS.includes(ctx.role);
  return teamOf(ctx).map((p) => {
    const last = (p.name.split(/\s+/).pop() ?? p.name).toLowerCase().replace(/[^a-z]/g, '');
    return card({
      id: p.id,
      kind: 'staff',
      name: p.name,
      title: p.job ?? words(p.role),
      organisation: 'Overthought & Co.',
      email: `${last}@${DOMAIN}`,
      record: {kind: 'staff', id: p.id},
      hidden: pay ? [] : ['hourly_pay'],
    });
  });
}

function partners(ctx: ToolContext): ContactCard[] {
  return list(ctx.st, 'organisations')
    .filter((o) => !s(o['id']).startsWith('_') && !NOT_CONTACTS.includes(s(o['kind'])))
    .map((o) =>
      card({
        id: s(o['id']),
        kind: 'partner',
        name: s(o['name']),
        title: words(s(o['kind'])),
        organisation: s(o['name']),
        town: sOrNull(o['town']),
        record: {kind: 'organisation', id: s(o['id'])},
      }),
    );
}

function prospects(ctx: ToolContext): ContactCard[] {
  return list(ctx.st, 'prospects').map((p) => {
    const dm = (p['decision_maker'] ?? {}) as Row;
    const where = (p['location'] ?? {}) as Row;
    return card({
      id: s(p['id']),
      kind: 'prospect',
      name: s(dm['name']) || s(p['name']),
      title: `Prospect · ${words(s(p['status']) || 'new')}`,
      organisation: s(p['name']),
      email: sOrNull(dm['email']),
      town: sOrNull(where['town']),
      address: sOrNull(where['address_line']),
      record: {kind: 'prospect', id: s(p['id'])},
    });
  });
}

/** Every card the caller may see, with its notes and tags. */
function cards(ctx: ToolContext, only: Kind | null = null): ContactCard[] {
  const can = (k: Kind): boolean => READERS[k].includes(ctx.role) && (only === null || only === k);
  const out: ContactCard[] = [];
  if (can('customer')) out.push(...customers(ctx));
  if (can('supplier')) out.push(...suppliers(ctx));
  if (can('staff')) out.push(...staff(ctx));
  if (can('partner')) out.push(...partners(ctx));
  if (can('prospect')) out.push(...prospects(ctx));
  const notes = new Map(notesOf(ctx.st).map((n) => [n.card_id, n]));
  for (const c of out) {
    const n = notes.get(c.id);
    if (n !== undefined) Object.assign(c, {notes: n.notes, tags: [...n.tags]});
  }
  return out;
}

function findCard(ctx: ToolContext, id: string): ContactCard {
  const c = cards(ctx).find((x) => x.id === id);
  // WHY the same words for "missing" and "not yours": a refusal must not confirm that a hidden card exists.
  if (c === undefined) fail('not_found', `There is no contact ${id} in your address book.`);
  return c;
}

function sorted(rows: ContactCard[]): ContactCard[] {
  return rows.sort(
    (a, b) => a.sort_name.localeCompare(b.sort_name, 'en-GB') || (a.id < b.id ? -1 : 1),
  );
}

/** A few facts from the record behind a card, for get_contact_card. */
function factsFor(ctx: ToolContext, c: ContactCard): Record<string, unknown> {
  const today = ctx.now.slice(0, 10);
  if (c.kind === 'customer') {
    const raw = list(ctx.st, 'customers').find((x) => x['id'] === c.id) ?? {};
    const orders = list(ctx.st, 'orders').filter((o) => o['customer_id'] === c.id);
    const last =
      orders
        .map((o) => s(o['placed_at']))
        .sort()
        .pop() ?? null;
    const open = list(ctx.st, 'cases').filter(
      (k) => k['customer_id'] === c.id && !['resolved', 'closed'].includes(s(k['status'])),
    ).length;
    return {
      customer_since: s(raw['created_at']).slice(0, 10) || null,
      orders: orders.length,
      last_order: last,
      open_cases: open,
      marketing_opt_in: raw['marketing_opt_in'] !== false,
      likes_to_hear_by: sOrNull(raw['contact_preference']),
    };
  }
  if (c.kind === 'supplier') {
    const raw = list(ctx.st, 'suppliers').find((x) => x['id'] === c.id) ?? {};
    const open = list(ctx.st, 'purchase_orders').filter(
      (p) => p['supplier_id'] === c.id && ['ordered', 'late'].includes(s(p['status'])),
    );
    return {
      makes: Array.isArray(raw['products']) ? raw['products'] : [],
      delivery_days: raw['lead_time_days'] ?? null,
      open_purchase_orders: open.length,
      next_delivery:
        open
          .map((p) => s(p['due_at']))
          .filter((d) => d >= today)
          .sort()[0] ?? null,
    };
  }
  if (c.kind === 'staff') {
    const p = teamOf(ctx).find((x) => x.id === c.id);
    const openTasks = list(ctx.st, 'tasks').filter(
      (t) => t['assignee'] === c.id && ['to_do', 'doing'].includes(s(t['status'])),
    ).length;
    const out: Record<string, unknown> = {
      role: p?.role ?? null,
      from_the_book: p?.from ?? null,
      starts_at: p?.start ?? ctx.world.plan?.day_start ?? null,
      contracted_hours_a_week: p?.weekly_hours ?? null,
      open_tasks: openTasks,
    };
    if (PAY_READERS.includes(ctx.role)) out['hourly_pay'] = p?.hourly_pay ?? null;
    return out;
  }
  if (c.kind === 'partner') {
    const raw = list(ctx.st, 'organisations').find((x) => x['id'] === c.id) ?? {};
    return {what_they_do: sOrNull(raw['about'])};
  }
  const raw = list(ctx.st, 'prospects').find((x) => x['id'] === c.id) ?? {};
  return {
    sector: sOrNull(raw['sector']),
    status: sOrNull(raw['status']),
    last_contacted: sOrNull(raw['last_contacted']),
    prefers: sOrNull(raw['preferred_channel']),
    monthly_budget: raw['monthly_budget'] ?? null,
  };
}

/** Tags as the address book keeps them: lower case, short, no repeats. */
function cleanTags(v: unknown, key: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))
    fail('invalid_input', `"${key}" is a list of words, such as ["wholesale", "call first"].`);
  const out = (v as string[])
    .map((t) => t.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean);
  for (const t of out)
    if (t.length > MAX_TAG)
      fail('invalid_input', `A tag is at most ${MAX_TAG} characters ("${t}").`);
  return [...new Set(out)];
}

const TOOLS: EngineTool[] = [
  {
    name: 'list_contact_cards',
    roles: roles.INTERNAL,
    description:
      'The address book: everyone the business knows, sorted by name. kind: customer, supplier (its contact person, with the sales and accounts desks), staff, partner (carriers, the bank, the council and other organisations it deals with; not rivals) or prospect (marketing and the manager only). search: words in the name, organisation, email, town, tags or notes. tag: only cards with that tag. limit (default 50, at most 200) and offset page on. Returns counts per kind, and the kinds your role may not see in not_shown. A customer’s phone and address are only for the roles that serve, deliver to or bill them; staff pay only for finance and the manager. Not the help desk’s contact log: that is list_contacts.',
    input_schema: obj({
      kind: {type: 'string', enum: [...KINDS]},
      search: str,
      tag: str,
      limit: int,
      offset: int,
    }),
    // WHY: "who is this, and how do I reach them" should be one call, whoever they are to the business.
    run(ctx, i) {
      const kind = typeof i['kind'] === 'string' ? (i['kind'] as Kind) : null;
      const ws = typeof i['search'] === 'string' ? tokens(i['search']) : [];
      const tag = typeof i['tag'] === 'string' ? i['tag'].trim().toLowerCase() : null;
      const visible = cards(ctx);
      const counts = Object.fromEntries(
        KINDS.filter((k) => READERS[k].includes(ctx.role)).map((k) => [
          k,
          visible.filter((c) => c.kind === k).length,
        ]),
      );
      const rows = sorted(
        visible.filter(
          (c) =>
            (kind === null || c.kind === kind) &&
            (tag === null || c.tags.includes(tag)) &&
            (ws.length === 0 ||
              matches(
                `${c.name} ${c.organisation ?? ''} ${c.email ?? ''} ${c.town ?? ''} ${c.title ?? ''} ${c.tags.join(' ')} ${c.notes}`,
                ws,
              )),
        ),
      );
      const from = Math.max(0, Math.floor(typeof i['offset'] === 'number' ? i['offset'] : 0));
      const n = Math.min(
        200,
        Math.max(1, Math.floor(typeof i['limit'] === 'number' ? i['limit'] : 50)),
      );
      return {
        total: rows.length,
        offset: from,
        counts,
        not_shown: KINDS.filter((k) => !READERS[k].includes(ctx.role)),
        tags: [...new Set(visible.flatMap((c) => c.tags))].sort(),
        cards: rows.slice(from, from + n),
      };
    },
  },
  {
    name: 'get_contact_card',
    roles: roles.INTERNAL,
    description:
      'One card in full (card_id is the id of the record it stands for: C-..., SUP-..., S-..., an organisation id, PR-...), with a few facts from that record: a customer’s orders and open cases, a supplier’s open purchase orders and next delivery, a person’s hours and open tasks (and pay, for finance and the manager), a prospect’s status. `record` says which record to open for the rest.',
    input_schema: obj({card_id: str}, ['card_id']),
    run(ctx, i) {
      const c = findCard(ctx, String(i['card_id']));
      return {...c, facts: factsFor(ctx, c)};
    },
  },
  {
    name: 'update_contact_card',
    roles: roles.INTERNAL,
    description:
      'Changes the address book’s own notes and tags on a card you can see: notes (replaces them; empty clears), tags (replaces them), add_tags, remove_tags. Tags are short words such as "wholesale" or "call first". The record itself (a customer’s email, a supplier’s terms) changes through its own tools.',
    input_schema: obj({card_id: str, notes: str, tags: strs, add_tags: strs, remove_tags: strs}, [
      'card_id',
    ]),
    run(ctx, i) {
      const c = findCard(ctx, String(i['card_id']));
      if (
        i['notes'] === undefined &&
        i['tags'] === undefined &&
        i['add_tags'] === undefined &&
        i['remove_tags'] === undefined
      )
        fail('invalid_input', 'Say what to change: notes, tags, add_tags or remove_tags.');
      const rows = notesOf(ctx.st);
      let row = rows.find((n) => n.card_id === c.id);
      if (row === undefined) {
        row = {card_id: c.id, notes: '', tags: [], updated_at: ctx.now, updated_by: ctx.role};
        rows.push(row);
      }
      const said: string[] = [];
      if (typeof i['notes'] === 'string') {
        const notes = i['notes'].trim();
        if (notes.length > MAX_NOTES)
          fail('invalid_input', `Notes are at most ${MAX_NOTES} characters.`);
        row.notes = notes;
        said.push(notes === '' ? 'notes cleared' : 'notes changed');
      }
      let tags = i['tags'] !== undefined ? cleanTags(i['tags'], 'tags') : row.tags;
      const drop = cleanTags(i['remove_tags'], 'remove_tags');
      tags = [
        ...new Set([
          ...tags.filter((t) => !drop.includes(t)),
          ...cleanTags(i['add_tags'], 'add_tags'),
        ]),
      ];
      if (tags.length > MAX_TAGS) fail('invalid_input', `A card has at most ${MAX_TAGS} tags.`);
      if (tags.join('|') !== row.tags.join('|')) said.push(`tags now ${tags.join(', ') || 'none'}`);
      row.tags = tags;
      row.updated_at = new Date(Date.parse(ctx.now)).toISOString().replace('.000Z', 'Z');
      row.updated_by = ctx.role;
      ctx.changes.push(`contact card ${c.id}: ${said.join('; ') || 'no change'}`);
      return {...c, notes: row.notes, tags: [...row.tags], updated_at: row.updated_at};
    },
  },
];

extend({state: ['contact_notes'], tools: TOOLS});
