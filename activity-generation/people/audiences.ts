/**
 * @fileoverview Audiences: the kinds of synthetic people a product can be pointed at, as one abstraction.
 *
 *   customers   people who buy from the shop and write in (web chat, email, phone, text, Mutter and Squint).
 *   staff       the team, each with a role, a workload and a way of working, using an internal tool in their work.
 *   businesses  prospect companies, each with a buyer who reads the product's outreach and decides.
 *   suppliers   the shop's suppliers, who write to suppliers@ and answer what the product writes back.
 *   public      people who read the shop's posts, newsletters and product pages.
 *
 * An adapter declares `audience` (one kind or a list) and `channels`; each channel belongs to one audience
 * (integrations/adapter/channels.ts). The audience decides the job the product does (its role and tools) unless `--job` says
 * otherwise, and which people meet it. Each audience's members are built here from the business's own data, from
 * circumstances and never from identity.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CHANNEL_AUDIENCE} from '../../integrations/adapter/channels.ts';
import type {PoolPerson} from './panel.ts';

/** The kinds of people a product can meet. */
export const AUDIENCE_KINDS = ['customers', 'staff', 'businesses', 'suppliers', 'public'] as const;

/** One kind of people. */
export type AudienceKind = (typeof AUDIENCE_KINDS)[number];

/** What an audience is, for docs, `init` and the report. */
export interface AudienceDef {
  kind: AudienceKind;
  label: string;
  /** Who they are, in a line. */
  who: string;
  /** The channels the product meets them on. */
  channels: readonly string[];
  /** The job (simulation/twin-run/jobs.ts) a product for this audience does by default. */
  job: string;
  /** What they can do in response, as recorded. */
  reactions: readonly string[];
}

/** Every audience. */
export const AUDIENCES: Readonly<Record<AudienceKind, AudienceDef>> = {
  customers: {
    kind: 'customers',
    label: 'Customers',
    who: 'people who buy from the shop and write in about orders, deliveries, returns and products',
    channels: ['web_chat', 'email', 'phone', 'text', 'mutter_dm', 'squint_dm', 'mutter_mention'],
    job: 'customer-service',
    reactions: ['satisfied', 'gave_up', 'out_of_turns', 'complained', 'left'],
  },
  staff: {
    kind: 'staff',
    label: 'Staff',
    who: 'the team: each asks an internal tool for help with their real work, then says what it did for them',
    channels: ['internal'],
    job: 'internal-tool',
    reactions: ['used', 'worked', 'didnt', 'minutes_saved'],
  },
  businesses: {
    kind: 'businesses',
    label: 'Other businesses',
    who: 'prospect companies; each has a buyer with needs, a budget and limited patience',
    channels: ['outreach'],
    job: 'sales',
    reactions: ['ignore', 'reply', 'ask', 'meet', 'buy', 'unsubscribe', 'complain'],
  },
  suppliers: {
    kind: 'suppliers',
    label: 'Suppliers',
    who: 'the shop’s suppliers: they query orders, warn of delays and answer what they are sent',
    channels: ['supplier_mail'],
    job: 'operations',
    reactions: ['agreed', 'refused', 'answered'],
  },
  public: {
    kind: 'public',
    label: 'The public',
    who: 'people who read the shop’s posts, newsletters and product pages',
    channels: ['publishing'],
    job: 'content',
    reactions: ['ignore', 'like', 'reply', 'share', 'visit', 'buy', 'unsubscribe', 'complain'],
  },
};

/** Reads an adapter's `audience`: a kind, a list of kinds, or nothing. Throws naming the choices. */
export function checkAudience(raw: unknown, where = 'audience'): AudienceKind[] | null {
  if (raw === undefined || raw === null) return null;
  const list: unknown[] = Array.isArray(raw) ? raw : [raw];
  if (list.length === 0) throw new Error(`${where}: name at least one audience.`);
  for (const a of list)
    if (typeof a !== 'string' || !(AUDIENCE_KINDS as readonly string[]).includes(a))
      throw new Error(
        `${where}: unknown audience ${JSON.stringify(a)}. Audiences: ${AUDIENCE_KINDS.join(', ')}.`,
      );
  return [...new Set(list as AudienceKind[])];
}

/**
 * The audiences a product meets: the ones it declares, else the ones its channels reach, else customers (the shop's
 * first assistant is nearly always for them).
 */
export function audiencesOf(c: {audience?: AudienceKind[]; channels?: string[]}): AudienceKind[] {
  if (c.audience !== undefined) return c.audience;
  if (c.channels !== undefined) {
    const from = [...new Set(c.channels.map((ch) => CHANNEL_AUDIENCE[ch]))].filter(
      (a): a is AudienceKind => a !== undefined,
    );
    if (from.length > 0) return from;
  }
  return ['customers'];
}

/** The channels to deploy on when none are given: every channel of the audiences. */
export function channelsOf(audiences: readonly AudienceKind[]): string[] {
  return [...new Set(audiences.flatMap((a) => AUDIENCES[a].channels))];
}

/**
 * The job for a set of audiences. One job per run: a product for customers and the public at once would need two
 * roles, so it is two runs (or `--job` to say which).
 */
export function jobOf(audiences: readonly AudienceKind[]): string {
  const jobs = [...new Set(audiences.map((a) => AUDIENCES[a].job))];
  if (jobs.length > 1)
    throw new Error(
      `The audiences ${audiences.join(' and ')} need different jobs (${jobs.join(', ')}). ` +
        'Test them in separate runs, or pass --job to choose one.',
    );
  return jobs[0] ?? 'customer-service';
}

// ---------------------------------------------------------------- staff

/** A member of the team, as their audience sees them. */
export interface StaffMember {
  id: string;
  name: string;
  role: string;
  job: string;
  weeklyHours: number;
  /** Minutes a day they spend on fixed work (meetings, checks). */
  fixedDailyMinutes: number;
  /** Their task speeds, minutes per task (business/data/staff.json). */
  tasks: Readonly<Record<string, number>>;
  /** What they are good at (business/data/team.json). */
  skills: readonly string[];
  /** How they like to work, from their skill, hours and overtime terms: never from who they are. */
  style: string;
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

interface StaffFile {
  staff: {
    id: string;
    name: string;
    job: string;
    role: string;
    weekly_hours: number;
    skill: number;
    overtime: boolean;
    tasks: Record<string, number>;
    fixed_daily_minutes?: number;
  }[];
}

/** The team, from business/data/staff.json and business/data/team.json. */
export function staffMembers(dir = path.join(ROOT, 'business', 'data')): StaffMember[] {
  const staff = JSON.parse(fs.readFileSync(path.join(dir, 'staff.json'), 'utf8')) as StaffFile;
  const team = JSON.parse(fs.readFileSync(path.join(dir, 'team.json'), 'utf8')) as {
    people: Record<string, {skills?: string[]}>;
  };
  return staff.staff.map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
    job: s.job,
    weeklyHours: s.weekly_hours,
    fixedDailyMinutes: s.fixed_daily_minutes ?? 0,
    tasks: s.tasks,
    skills: team.people[s.id]?.skills ?? [],
    style: styleOf(s),
  }));
}

function styleOf(s: StaffFile['staff'][number]): string {
  const parts: string[] = [];
  parts.push(
    s.skill >= 0.95
      ? 'careful: checks every answer against the records'
      : 'practical: trusts a clear answer and moves on',
  );
  parts.push(
    s.weekly_hours <= 12
      ? 'part-time, so short on minutes and wants short answers'
      : 'works most days and has a steady queue',
  );
  if (!s.overtime) parts.push('will not stay late to fix a tool’s mistakes');
  return parts.join('; ');
}

// ---------------------------------------------------------------- businesses

/** A prospect company as the engine holds it (state.prospects). Only what buyers read. */
export interface ProspectRecord {
  id: string;
  name: string;
  sector: string;
  staff: number;
  monthly_budget: number;
  budget_band: string;
  preferred_channel: string;
  needs: {product: string; sku: string; qty: number; every: string; unit_price: number}[];
  decision_maker: {name: string; email: string};
  private: {reply_propensity: number};
}

/** The buyer at a prospect company. */
export interface BuyerPersona {
  prospectId: string;
  company: string;
  /** Signs their reply. Never sent to the model. */
  name: string;
  email: string;
  lines: [string, string][];
  /** How many contacts they tolerate before they are annoyed. */
  patience: number;
  /** Whether they would switch supplier now at all. */
  readyToSwitch: boolean;
  monthlyBudget: number;
  needs: ProspectRecord['needs'];
}

/**
 * The buyer persona for a prospect: needs, budget and patience from the record, readiness from a hash of the
 * prospect (the same in every arm and run).
 * WHY patience from reply propensity: a buyer who answers mail readily also tolerates a follow-up; one who rarely
 * answers is put off by a second unasked-for email. 1 to 3 contacts, an assumption.
 */
export function buyerPersona(p: ProspectRecord, unit: (s: string) => number): BuyerPersona {
  const patience = 1 + Math.round(Math.min(1, Math.max(0, p.private.reply_propensity)) * 2);
  const readyToSwitch = unit(`ready|${p.id}`) < 0.5;
  const needs = p.needs.map((n) => `${n.qty} x ${n.product} every ${n.every}`).join('; ');
  return {
    prospectId: p.id,
    company: p.name,
    name: p.decision_maker.name,
    email: p.decision_maker.email,
    patience,
    readyToSwitch,
    monthlyBudget: p.monthly_budget,
    needs: p.needs,
    lines: [
      ['company_type', p.sector.replace(/_/g, ' ')],
      ['staff', String(p.staff)],
      ['needs', needs],
      ['monthly_budget', `£${p.monthly_budget}`],
      ['prefers_contact_by', p.preferred_channel],
      ['patience_contacts', String(patience)],
      ['ready_to_switch_supplier', readyToSwitch ? 'yes' : 'no'],
    ],
  };
}

// ---------------------------------------------------------------- the public

/** A person in business/data/population.json. */
export interface PopulationPerson {
  name: string;
  income?: string;
  online?: string;
  employment?: string;
  household?: string;
  area?: string;
  circumstances?: string[];
}

/**
 * The public a panel is drawn from: everyone in the simulated population, marked as a customer when the business
 * knows them (so a reply can be signed and linked), or, with `onlyCustomers`, only those (a newsletter's readers).
 */
export function publicPool(
  population: {people: Record<string, PopulationPerson>},
  customers: readonly {id: string; name: string; email?: string; marketing_opt_in?: boolean}[],
  o: {onlyCustomers?: readonly string[]} = {},
): PoolPerson[] {
  const byName = new Map(customers.map((c) => [c.name.toLowerCase(), c]));
  const only = o.onlyCustomers !== undefined ? new Set(o.onlyCustomers) : null;
  const out: PoolPerson[] = [];
  for (const [key, p] of Object.entries(population.people)) {
    const c = byName.get(p.name.toLowerCase()) ?? null;
    if (only !== null && (c === null || !only.has(c.id))) continue;
    out.push({
      key,
      name: p.name,
      customerId: c?.id ?? null,
      email: c?.email ?? null,
      income: p.income ?? null,
      online: p.online ?? null,
      employment: p.employment ?? null,
      household: p.household ?? null,
      area: p.area ?? null,
      circumstances: p.circumstances ?? [],
    });
  }
  return out;
}

/** business/data/population.json, read once. */
export function loadPopulation(file = path.join(ROOT, 'business', 'data', 'population.json')): {
  people: Record<string, PopulationPerson>;
} {
  populationCache ??= JSON.parse(fs.readFileSync(file, 'utf8')) as {
    people: Record<string, PopulationPerson>;
  };
  return populationCache;
}

let populationCache: {people: Record<string, PopulationPerson>} | null = null;
