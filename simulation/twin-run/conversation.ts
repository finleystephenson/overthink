/**
 * @fileoverview One customer contact, played out: the customer writes, the product answers (with tools), the
 * customer reads the answer and reacts, until they are satisfied, give up or run out of patience.
 *
 * The conversation is recorded line by line for the report's side-by-side view. Whether the contact was sorted is
 * decided afterwards by the simulator from the records (simulation/simulator/judge.mjs), not by what anyone said.
 */
import type {Message} from '../../integrations/adapter/contract.ts';
import {runProductTurn} from '../../integrations/adapter/loop.ts';
import type {CallRecord, TurnContext} from '../../integrations/adapter/loop.ts';
import {judgeContact} from '../simulator/judge.mjs';
import type {ContactOutcome} from '../simulator/judge.d.mts';
import type {CustomerBrief} from '../../activity-generation/people/brief.ts';
import type {CustomerVoice, SeenLine} from '../../activity-generation/people/voice.ts';

/** One line of a recorded conversation. */
export interface TranscriptLine {
  from: 'customer' | 'product' | 'tool' | 'note';
  text: string;
  call?: CallRecord;
  /** On a customer reaction: their tone and what code changed in it. */
  tone?: string;
  clamped?: string[];
  /** The customer called it sorted and the records did not agree. */
  overruled?: boolean;
}

/** How a conversation ended. */
export type Ending =
  'satisfied' | 'gave_up' | 'out_of_turns' | 'passed' | 'product_error' | 'staff';

/** Who the customer was, as the report shows it. */
export interface PersonaSummary {
  situation: string;
  kind: string;
  label: string;
  life: string[];
  history: string | null;
  style: string | null;
  /** What code needs to check how the product handled the situation. */
  probe: {
    /** The customer's own order and postcode. */
    order: string | null;
    postcode: string | null;
    wrongOrder: string | null;
    canary: string | null;
    /** The line they had to say (the attack, for a security situation). */
    attack: string | null;
    other: {
      name: string;
      email: string | null;
      postcode: string | null;
      line1: string | null;
      order: string | null;
    } | null;
  };
}

/** A recorded contact, in one arm. */
export interface Transcript {
  /** Matches the same contact in the other arm: date, customer and topic. */
  key: string;
  /** The contact's record in the business (world.state.contacts), for links into the apps. */
  contactId: string | null;
  persona: PersonaSummary;
  session: string;
  date: string;
  topic: string;
  customer: string;
  channel: string;
  lines: TranscriptLine[];
  ending: Ending;
  /** The outcome from the records at the end of the conversation (null in the arm without the product). */
  verdict: ContactOutcome | null;
  customerSatisfied: boolean;
  error: string | null;
  /** What staff did with it afterwards, read from the contact record at the end of the day. */
  staff: {outcome: string; handled_by: string | null; first_reply_minutes: number | null} | null;
}

/** What the simulator gets back: the text the customer saw, or an error that sends the contact to staff. */
export interface ConversationResult {
  transcript: Transcript;
  reply: string | null;
  error: string | null;
}

/** Plays one contact with the product. */
export async function playContact(o: {
  brief: CustomerBrief;
  rulesText: string;
  voice: CustomerVoice;
  turn: Omit<TurnContext, 'who'>;
  key: string;
  date: string;
  contactId: string | null;
}): Promise<ConversationResult> {
  const {brief, voice} = o;
  const t: Transcript = {
    key: o.key,
    contactId: o.contactId,
    persona: personaSummary(brief),
    session: o.turn.sessionId,
    date: o.date,
    topic: brief.topic,
    customer: brief.name,
    channel: brief.channel,
    lines: [],
    ending: 'out_of_turns',
    verdict: null,
    customerSatisfied: false,
    error: null,
    staff: null,
  };
  const opening = await voice.opening(brief, o.rulesText);
  t.lines.push({from: 'customer', text: opening});
  const conversation: Message[] = [{role: 'user', content: opening}];
  const seen: SeenLine[] = [{from: 'customer', text: opening}];
  const calls: CallRecord[] = [];
  const replies: string[] = [];
  const state: Record<string, unknown> = {};
  let detailsGiven = brief.givesDetailsUpfront;
  const ctx: TurnContext = {
    ...o.turn,
    who: {kind: 'customer', name: brief.name, channel: brief.channel},
  };

  for (let turn = 0; turn < brief.patienceTurns; turn++) {
    const r = await runProductTurn(ctx, conversation);
    for (const call of r.calls) t.lines.push(toolLine(call));
    calls.push(...r.calls);
    if (r.error !== null) {
      t.lines.push({from: 'note', text: `The product failed: ${r.error}`});
      return {
        transcript: {...t, ending: 'product_error', error: r.error},
        reply: null,
        error: r.error,
      };
    }
    if (turn === 0 && (r.reply === null || r.reply.trim() === '') && r.calls.length === 0) {
      // An empty first answer means "not mine": the contact goes to staff exactly as if the product were absent.
      t.lines.push({from: 'note', text: 'The product passed; staff took it.'});
      return {transcript: {...t, ending: 'passed'}, reply: null, error: PASSED};
    }
    const reply = r.reply ?? '';
    replies.push(reply);
    t.lines.push({from: 'product', text: reply});
    seen.push({from: 'product', text: reply});
    t.verdict = judgeContact(brief.topic, calls.map(forJudge), replies.join('\n')).outcome;
    const reaction = await voice.react(brief, seen, {
      turn,
      verdict: t.verdict,
      detailsGiven,
      state,
    });
    t.customerSatisfied = reaction.resolved;
    if (reaction.message !== null) {
      t.lines.push({
        from: 'customer',
        text: reaction.message,
        tone: reaction.tone,
        clamped: reaction.clamped,
        overruled: reaction.overruled,
      });
    } else if (reaction.clamped.length > 0) {
      t.lines.push({from: 'note', text: `Customer left. Code: ${reaction.clamped.join('; ')}.`});
    }
    if (reaction.next === 'thank_and_end') {
      t.ending = 'satisfied';
      break;
    }
    if (reaction.next === 'give_up') {
      t.ending = 'gave_up';
      break;
    }
    if (reaction.next === 'give_details') detailsGiven = true;
    const said = reaction.message ?? brief.fallbackFollowUp;
    conversation.push({role: 'user', content: said});
    seen.push({from: 'customer', text: said});
  }
  return {transcript: t, reply: replies.join('\n'), error: null};
}

/** The error text that tells the simulator the product passed on a contact. */
export const PASSED = 'the product passed on this contact';

/** Records an arm without the product: the customer's first words, then staff. */
export async function observeContact(o: {
  brief: CustomerBrief;
  rulesText: string;
  voice: CustomerVoice;
  key: string;
  session: string;
  date: string;
  contactId: string | null;
}): Promise<Transcript> {
  const opening = await o.voice.opening(o.brief, o.rulesText);
  return {
    key: o.key,
    contactId: o.contactId,
    persona: personaSummary(o.brief),
    session: o.session,
    date: o.date,
    topic: o.brief.topic,
    customer: o.brief.name,
    channel: o.brief.channel,
    lines: [{from: 'customer', text: opening}],
    ending: 'staff',
    verdict: null,
    customerSatisfied: false,
    error: null,
    staff: null,
  };
}

/** The persona fields worth showing. */
export function personaSummary(b: CustomerBrief): PersonaSummary {
  const p = b.persona;
  return {
    situation: p.situation,
    kind: p.kind,
    label: p.label,
    life: p.life,
    history: p.history,
    style: p.style,
    probe: {
      order: b.details.order,
      postcode: b.details.postcode,
      wrongOrder: p.wrongOrder,
      canary: p.canary,
      attack: p.mustSay,
      other: p.other,
    },
  };
}

function forJudge(c: CallRecord): {
  tool: string;
  ok: boolean;
  result?: unknown;
  error?: {code: string};
} {
  return c.ok
    ? {tool: c.name, ok: true, result: c.result}
    : {tool: c.name, ok: false, error: {code: c.code ?? 'failed'}};
}

/** The most of a tool result kept in a transcript: enough to read, small enough for one HTML file. */
const RESULT_PREVIEW_CHARS = 400;

/** A tool call as a transcript line, with its result cut to a preview. */
function toolLine(call: CallRecord): TranscriptLine {
  const {result, ...rest} = call;
  const preview =
    result === undefined
      ? (call.code ?? '')
      : JSON.stringify(result).slice(0, RESULT_PREVIEW_CHARS);
  return {from: 'tool', text: preview, call: rest};
}
