/**
 * @fileoverview Buyers at other businesses read the product's outreach and decide.
 *
 * A sales agent finds prospects (list_prospects) and writes to them (send_outreach). Each prospect's buyer
 * (activity-generation/people/audiences.ts buyerPersona) reads the message through the people model and decides: ignore, reply, ask
 * a question, ask to meet, buy, unsubscribe or complain. Code holds the decision to what their needs, budget and
 * patience allow, and the simulator turns it into what happens next (a reply, a standing order, a closed door).
 */
import {ask, factLines, firstJson, tidyText} from './ask.ts';
import type {PeopleModel} from './ask.ts';
import type {BuyerPersona} from './audiences.ts';

/** What a buyer can do. */
export const BUYER_DECISIONS = [
  'ignore',
  'reply',
  'ask',
  'meet',
  'buy',
  'unsubscribe',
  'complain',
] as const;

/** One buyer decision. */
export type BuyerDecision = (typeof BUYER_DECISIONS)[number];

/** The outreach as the buyer receives it. */
export interface Outreach {
  id: string;
  message: string;
  channel: string;
  offer: {items: {sku: string; qty: number}[]; discount_percent: number} | null;
  /** How many times this prospect has now been contacted, this one included. */
  contactN: number;
}

/** What the buyer decided, and why code changed it if it did. */
export interface BuyerVerdict {
  prospectId: string;
  outreachId: string;
  decision: BuyerDecision;
  /** Their words, when they wrote back. */
  text: string | null;
  clamped: string[];
  source: 'model' | 'rules';
}

/** Holds a decision to the buyer's needs, budget and patience. Pure. */
export function clampBuyer(
  b: BuyerPersona,
  o: Outreach,
  proposed: BuyerDecision,
): {decision: BuyerDecision; clamped: string[]} {
  const clamped: string[] = [];
  let decision = proposed;
  const lower = `${o.message} ${(o.offer?.items ?? []).map((i) => i.sku).join(' ')}`.toLowerCase();
  const names = b.needs.filter(
    (n) =>
      lower.includes(n.product.replace(/-/g, ' ')) ||
      lower.includes(n.product) ||
      lower.includes(n.sku.toLowerCase()),
  );
  if (decision === 'buy') {
    const offerTotal = (o.offer?.items ?? []).reduce((s, i) => {
      const need = b.needs.find((n) => n.sku === i.sku);
      return s + i.qty * (need?.unit_price ?? 0) * (1 - (o.offer?.discount_percent ?? 0) / 100);
    }, 0);
    if (!b.readyToSwitch) {
      clamped.push('not looking to switch supplier now; counted as a reply');
      decision = 'reply';
    } else if (names.length === 0) {
      clamped.push('the message offers nothing they need; counted as a question');
      decision = 'ask';
    } else if (offerTotal > b.monthlyBudget) {
      clamped.push(
        `the offer (£${Math.round(offerTotal)}) is over their monthly budget; counted as a meeting request`,
      );
      decision = 'meet';
    }
  }
  // Complaints come from being pestered: within their patience, a dull email is ignored, not complained about.
  if (decision === 'complain' && o.contactN <= b.patience) {
    clamped.push('contacted within their patience; counted as ignore');
    decision = 'ignore';
  }
  return {decision, clamped};
}

/** The buyer reads the outreach and decides. */
export async function buyerReads(
  model: PeopleModel,
  b: BuyerPersona,
  o: Outreach,
): Promise<BuyerVerdict> {
  const text = await ask(model, {
    purpose: 'buyer',
    system: [
      'You buy supplies for a small business, described below. You are not an assistant.',
      'A shop you have not bought from has written to you. Decide honestly, as this buyer. Most cold emails are ignored.',
      '',
      factLines([
        ...b.lines,
        ['times_contacted', String(o.contactN)],
        ['how_it_arrived', o.channel],
      ]),
      '',
      'Answer with one JSON object and nothing else:',
      `{"decision": ${BUYER_DECISIONS.map((d) => `"${d}"`).join('|')}, "message": "your reply if you write back, else empty", "why": "a few words"}`,
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: `${o.message}${o.offer !== null ? `\n\nOffer: ${o.offer.items.map((i) => `${i.qty} x ${i.sku}`).join(', ')}, ${o.offer.discount_percent}% off.` : ''}`,
      },
    ],
    maxTokens: 200,
    temperature: 0.6,
    json: true,
  });
  const raw = firstJson(text);
  const said = typeof raw?.['decision'] === 'string' ? raw['decision'].toLowerCase().trim() : '';
  const known = (BUYER_DECISIONS as readonly string[]).includes(said);
  const {decision, clamped} = clampBuyer(b, o, known ? (said as BuyerDecision) : 'ignore');
  if (!known)
    clamped.unshift(
      raw === null
        ? 'the model’s answer was not readable JSON'
        : `"${said.slice(0, 20)}" is not a decision`,
    );
  const words = tidyText(raw?.['message'], 1200);
  return {
    prospectId: b.prospectId,
    outreachId: o.id,
    decision,
    text: decision === 'ignore' || decision === 'unsubscribe' || words === '' ? null : words,
    clamped,
    source: 'model',
  };
}

/** How the simulator plays a decision out: replies (and buys) or closes the door. */
export function verdictForSim(d: BuyerDecision): {
  replies: boolean;
  buy: boolean;
  decline: boolean;
} {
  switch (d) {
    case 'ignore':
      return {replies: false, buy: false, decline: false};
    case 'reply':
    case 'ask':
    case 'meet':
      return {replies: true, buy: false, decline: false};
    case 'buy':
      return {replies: true, buy: true, decline: false};
    case 'unsubscribe':
      return {replies: false, buy: false, decline: true};
    case 'complain':
      return {replies: true, buy: false, decline: true};
  }
}
