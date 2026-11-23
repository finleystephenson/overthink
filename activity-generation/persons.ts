/**
 * @fileoverview Synthetic people: who they are, and how to make them.
 *
 * A synthetic person is a customer of the shop (an account, an address, an email) plus a profile that says who they
 * are. The profile is for whoever voices them (the developer's own model), never for the product: business roles
 * cannot read it. Two ways to make one:
 *
 * - from the population (business/data/population.json): people with real-world circumstances (age band,
 *   household, work, income, how often they shop online), drawn so a batch spreads across the population;
 * - described in words, with any profile fields the agent wants to pin down.
 *
 * ai-instructions/synthetic-users.md says how to make a fair, varied set of them.
 */
import {loadPopulation} from './people/audiences.ts';
import type {ActivityEnv} from './env.ts';
import {asWorld, refuse} from './env.ts';

/**
 * Who a synthetic person is. Every field is optional apart from `source`; leave out what you do not know rather
 * than invent it. Circumstances drive behaviour; identity never does (ai-instructions/synthetic-users.md).
 */
export interface PersonProfile {
  /** How they were made. */
  source: 'population' | 'described';
  /** The population id, when drawn from it. */
  population_id?: string;
  /** The agent's own words about them, when described. */
  description?: string;
  /** Age band, e.g. "35-44". */
  age?: string;
  /** e.g. "couple", "single_parent", "multi_adult_other". */
  household?: string;
  /** e.g. "employed", "self_employed", "student", "retired", "unemployed". */
  employment?: string;
  /** Income quintile, Q1 (lowest) to Q5. */
  income?: string;
  /** How often they shop online: never, rarely, monthly, weekly_plus. */
  online?: string;
  /** How they prefer to get in touch: email, chat, phone, social. */
  channel?: string;
  /** urban, town, rural. */
  area?: string;
  /** Things going on in their life that bear on how they shop (moving_home, new_parent, carer...). */
  circumstances?: string[];
  /** What they want from the shop right now, in a sentence. */
  goal?: string;
  /** How they tend to come across: polite, plain, blunt. */
  tone?: string;
  /** How long they will put up with a poor answer: low, medium, high. */
  patience?: string;
  /** True for someone who will try to make the product break its rules. */
  adversarial?: boolean;
  /** What the person who made this profile assumed, so a reader can check it. */
  assumptions?: string[];
  [extra: string]: unknown;
}

/** A synthetic person as the sandbox keeps them. */
export interface Person {
  customer_id: string;
  name: string;
  email: string;
  postcode: string;
  profile: PersonProfile;
}

/** What `create_person` takes. */
export interface CreatePersonInput {
  /** "population" (default) or "described". */
  from?: 'population' | 'described';
  /** How many to make from the population (1 to 100). Described people are made one at a time. */
  count?: number;
  /** Only population people whose fields match these values, e.g. {"online": "never"}. */
  where?: Record<string, string>;
  /** For a described person: their name. */
  name?: string;
  /** For a described person: who they are, in words. */
  description?: string;
  email?: string;
  address?: {line1?: string; town?: string; postcode?: string};
  /** More profile fields (see {@link PersonProfile}); for population people they are added to what was drawn. */
  profile?: Partial<PersonProfile>;
}

const MAX_BATCH = 100;
const FIELDS = ['age', 'household', 'employment', 'income', 'online', 'channel', 'area'] as const;

/** Creates one or more synthetic people as customers of the business. */
export function createPeople(env: ActivityEnv, input: CreatePersonInput): Person[] {
  // WHY a plain string: the input comes from JSON, whatever its type says.
  const from: string =
    input.from ??
    (input.description !== undefined || input.name !== undefined ? 'described' : 'population');
  if (from === 'described') return [describedPerson(env, input)];
  if (from !== 'population') refuse('invalid_input', '"from" must be "population" or "described".');
  const count = input.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH) {
    refuse('invalid_input', `"count" must be a whole number from 1 to ${MAX_BATCH}.`);
  }
  return drawFromPopulation(env, count, input.where ?? {}).map((p) =>
    add(env, p.name, p.profile, input),
  );
}

function describedPerson(env: ActivityEnv, input: CreatePersonInput): Person {
  if (input.name === undefined || input.name.trim() === '')
    refuse('invalid_input', 'A described person needs a "name".');
  const profile: PersonProfile = {
    ...input.profile,
    source: 'described',
    ...(input.description === undefined ? {} : {description: input.description}),
  };
  return add(env, input.name, profile, input);
}

function add(
  env: ActivityEnv,
  name: string,
  profile: PersonProfile,
  input: CreatePersonInput,
): Person {
  const email = input.email ?? uniqueEmail(env, name);
  const address = input.address ?? {postcode: postcodeFor(name)};
  const r = asWorld(env, 'add_synthetic_person', {name, email, address, profile}) as {
    customer_id: string;
    email: string;
    postcode: string;
  };
  return {customer_id: r.customer_id, name, email: r.email, postcode: r.postcode, profile};
}

/**
 * Draws people from the population who are not yet customers, spread across it. WHY a stride and not the first
 * N: the file is ordered by book, so the first hundred would all come from a handful of novels and be alike.
 * Deterministic: the same sandbox seed and the same calls give the same people.
 */
function drawFromPopulation(
  env: ActivityEnv,
  count: number,
  where: Record<string, string>,
): {name: string; profile: PersonProfile}[] {
  const people = loadPopulation().people;
  const taken = new Set(env.sandbox.world.state.customers.map((c) => c.name));
  const ids = Object.keys(people)
    .sort()
    .filter((id) => {
      const p = people[id];
      if (p === undefined || taken.has(p.name)) return false;
      return Object.entries(where).every(([k, v]) => {
        const value = (p as unknown as Record<string, unknown>)[k];
        return Array.isArray(value) ? value.includes(v) : String(value) === v;
      });
    });
  if (ids.length < count) {
    refuse(
      'not_found',
      `Only ${ids.length} people in the population match and are not yet customers.`,
    );
  }
  const stride = coprimeStride(ids.length);
  let at = (env.sandbox.seed ?? 1) * 7919 + taken.size;
  const out: {name: string; profile: PersonProfile}[] = [];
  for (let n = 0; n < count; n++) {
    at = (at + stride) % ids.length;
    const id = ids[at] ?? '';
    const p = people[id];
    if (p === undefined) continue;
    const profile: PersonProfile = {source: 'population', population_id: id};
    const raw = p as unknown as Record<string, unknown>;
    for (const k of FIELDS) if (typeof raw[k] === 'string') profile[k] = raw[k];
    if (Array.isArray(raw['circumstances']))
      profile.circumstances = raw['circumstances'] as string[];
    out.push({name: p.name, profile});
  }
  return out;
}

/** A step through `n` items that visits each once: the first prime near n/φ that does not divide n. */
function coprimeStride(n: number): number {
  if (n <= 2) return 1;
  let s = Math.max(1, Math.round(n / 1.618));
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  while (gcd(s, n) !== 1) s++;
  return s;
}

function uniqueEmail(env: ActivityEnv, name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z]+/g, '.')
      .replace(/^\.|\.$/g, '') || 'someone';
  const used = new Set(
    env.sandbox.world.state.customers.map((c) =>
      ((c as {email?: string}).email ?? '').toLowerCase(),
    ),
  );
  for (let n = 1; ; n++) {
    const email = `${base}${n === 1 ? '' : String(n)}@people.example`;
    if (!used.has(email)) return email;
  }
}

/**
 * A made-up postcode in the shape a UK one has, so products that check the format accept it. The "OT" area does
 * not exist, so it can never be mistaken for a real address.
 */
function postcodeFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const letters = 'ABDEFGHJLNPQRSTUWXYZ';
  return `OT${String(1 + (h % 9))} ${String(h % 10)}${letters[(h >>> 4) % letters.length] ?? 'A'}${letters[(h >>> 9) % letters.length] ?? 'B'}`;
}
