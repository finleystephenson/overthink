/**
 * @fileoverview The brief for one customer contact: decided by code, voiced by the model.
 *
 * WHY code decides: model-played users are too cooperative and too uniform, which makes products look better than
 * they are ("Mind the Sim2Real Gap", 2026: 451 people against 31 simulators). So the customer's goal, how many
 * replies they will read, whether they want a person, what they will tell and what counts as resolved all come from
 * their hidden traits and circumstances in the simulator. The model only writes their words and reads the reply.
 */
import {prefersPerson, MAX_CALLER_TURNS} from '../../infrastructure/server/callers.mjs';
import type {ContactItem} from '../../simulation/simulator/core.d.mts';
import {PLAIN, buildPersona, personaLines} from './personas.ts';
import type {Persona} from './personas.ts';

/** What a customer may do after reading a reply. Anything else a model proposes becomes `follow_up`. */
export const NEXT_ACTIONS = [
  'thank_and_end',
  'follow_up',
  'give_details',
  'ask_for_person',
  'give_up',
] as const;
/** One of {@link NEXT_ACTIONS}. */
export type NextAction = (typeof NEXT_ACTIONS)[number];

/** How a customer writes. From the simulator's manner draw (simulation/simulator/customers.mjs). */
export type Tone = 'polite' | 'plain' | 'blunt';

/** Everything the model is told about the customer it plays, and everything code holds it to. */
export interface CustomerBrief {
  name: string;
  topic: string;
  channel: string;
  /** What they want, in their own words. */
  goal: string;
  /** What counts as sorted, in plain words (code checks it against the records). */
  resolvedWhen: string;
  givesUpWhen: string;
  tone: Tone;
  /** Does not name the product at first. */
  vague: boolean;
  /** Gives the order number and postcode in the first message. */
  givesDetailsUpfront: boolean;
  details: {order: string | null; postcode: string | null; product: string | null};
  /** How many of the product's replies they will read before giving up. */
  patienceTurns: number;
  /** Wants a person, not an automated helper. */
  wantsPerson: boolean;
  /** A line they remember about an earlier contact, if any. */
  memory: string | null;
  /** What they say when a reply does not help, if the model gives no words. */
  fallbackFollowUp: string;
  /** Who they are and the situation they arrive in (activity-generation/people/personas.ts). */
  persona: Persona;
  /** The simulator's own plain first message, before the persona is applied (the rules voice reads its manner). */
  rulesText: string;
}

const GOALS: Readonly<Record<string, string>> = {
  where_is_my_order: 'find out where my order is and when it will arrive',
  late_parcel: 'get someone to chase my late parcel',
  damaged: 'get a replacement for the {product}, which arrived damaged',
  missing: 'get the missing {product} sent or refunded',
  fault: 'get the {product} replaced or repaired; it has stopped working',
  return_question: 'send the {product} back for a refund; I changed my mind',
  change_order: 'change or cancel my order before it is sent',
  refund_chase: 'find out where my refund is',
  complaint: 'have my complaint about how my order was handled recorded and taken seriously',
  product_question: 'find out whether the {product} comes in other sizes or colours',
  presale: 'find out how much delivery costs for the {product} before I buy it',
};

const RESOLVED_WHEN: Readonly<Record<string, string>> = {
  where_is_my_order: 'they look my order up and tell me where it is',
  late_parcel: 'they open a case or pass it to a person who will chase the carrier',
  damaged: 'they arrange a replacement or refund, or pass it to a person',
  missing: 'they arrange a replacement or refund, or pass it to a person',
  fault: 'they arrange a replacement, repair or refund, or pass it to a person',
  return_question: 'they set up the return, or explain from the policy why they cannot',
  change_order: 'they make the change or cancel it',
  refund_chase: 'they look the refund up and tell me where it is',
  complaint: 'they record it as a complaint and pass it to a person',
  product_question: 'they answer from the shop’s own product details',
  presale: 'they answer from the shop’s own delivery details',
};

const PROBLEM: Readonly<Record<string, string>> = {
  where_is_my_order: 'where my order is',
  late_parcel: 'my late parcel',
  damaged: 'the damaged item',
  missing: 'the missing item',
  fault: 'the fault',
  return_question: 'sending it back',
  change_order: 'changing my order',
  refund_chase: 'my refund',
  complaint: 'my complaint',
  product_question: 'my question about the product',
  presale: 'my question before I buy',
};

/** The patience of a customer with average traits: they will read this many replies. */
const BASE_PATIENCE_TURNS = 3;

/**
 * Builds the brief for one contact from the simulator's record of it. Pure: the same contact always gives the
 * same brief, in both arms of a twin run.
 */
export function briefFor(
  item: ContactItem,
  productName: string | null,
  persona: Persona = plainPersona(item),
): CustomerBrief {
  const c = item.customer;
  const tone = persona.tone ?? toTone(c.m?.tone);
  const product = productName ?? 'item';
  const goal = (GOALS[item.topic] ?? 'get help with my order').replace('{product}', product);
  // Hidden patience (log-normal around 1) scales the number of replies they will read. Someone treated badly
  // lately (s below zero) has one fewer. Clamped to what the rules-played caller allows, so both voices agree.
  const traitPatience = c.t?.patience ?? 1;
  const treatedBadly = (c.s ?? 0) < 0 ? 1 : 0;
  const patienceTurns = clamp(
    Math.round(BASE_PATIENCE_TURNS * traitPatience) - treatedBadly + persona.patienceDelta,
    1,
    MAX_CALLER_TURNS,
  );
  const about = PROBLEM[item.topic] ?? 'my question';
  return {
    name: c.name,
    topic: item.topic,
    channel: item.channel,
    goal,
    resolvedWhen: RESOLVED_WHEN[item.topic] ?? 'they actually sort it out',
    givesUpWhen: `after ${patienceTurns} ${patienceTurns === 1 ? 'reply' : 'replies'} that do not sort it, if they change something I did not ask for, or if they share someone else’s details`,
    tone,
    vague: c.m?.vague ?? false,
    givesDetailsUpfront: !(c.m?.omits ?? false),
    details: {order: item.order, postcode: item.postcode, product: productName},
    patienceTurns,
    wantsPerson: prefersPerson(c.id ?? null),
    memory: c.memo?.bad === true ? `Last time, ${c.memo.text}.` : null,
    fallbackFollowUp: {
      polite: `Sorry, I’m not sure that answers it. I was asking about ${about}.`,
      plain: `That doesn’t really answer it. It’s about ${about}.`,
      blunt: `That doesn’t help. I need ${about} sorted.`,
    }[tone],
    persona,
    rulesText: item.text,
  };
}

/** The persona of a contact with no situation planned: plain, with nothing known about the person's life. */
export function plainPersona(item: ContactItem): Persona {
  return buildPersona({
    key: item.key,
    situation: PLAIN.id,
    topic: item.topic,
    name: item.customer.name,
    order: item.order,
    postcode: item.postcode,
    product: null,
    circumstances: null,
    pastOrders: null,
    memory: null,
    other: null,
  });
}

/** The brief as `- key: value` lines for a prompt. Hidden numbers are turned into words first. */
export function briefText(b: CustomerBrief): string {
  const lines: [string, string][] = [
    ['name', b.name],
    ['goal', `I want to ${b.goal}.`],
    ['channel', b.channel],
    ['tone', b.tone],
    ['resolved_when', b.resolvedWhen],
    ['gives_up', b.givesUpWhen],
    ['order', b.details.order ?? 'none'],
    ['postcode', b.details.postcode ?? 'none'],
    ['product', b.details.product ?? 'none'],
    ['shares_order_number_at_first', b.givesDetailsUpfront ? 'yes' : 'no, only when asked'],
    ['names_the_product_at_first', b.vague ? 'no, says "the thing I ordered"' : 'yes'],
    [
      'wants_a_person',
      b.wantsPerson ? 'yes, would rather not deal with an automated helper' : 'no',
    ],
  ];
  if (b.memory !== null) lines.push(['remembers', b.memory]);
  lines.push(...personaLines(b.persona));
  return lines.map(([k, v]) => `- ${k}: ${v}`).join('\n');
}

function toTone(x: string | undefined): Tone {
  return x === 'plain' || x === 'blunt' ? x : 'polite';
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
