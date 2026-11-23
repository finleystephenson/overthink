/**
 * @fileoverview Customers' words: written by rules (default, free) or by the developer's model, and always held to
 * the brief by code.
 *
 * The model proposes a reaction to each reply: whether it is resolved, the customer's tone, the next action and
 * their message. {@link clampReaction} then applies the brief: a customer cannot call something resolved that the
 * records say is not, cannot stay past their patience, cannot hand over details they do not have or already gave,
 * and walks away from a product that changed something they did not ask for.
 */
import {nextCallerTurn} from '../../infrastructure/server/callers.mjs';
import type {ContactOutcome} from '../../simulation/simulator/judge.d.mts';
import {isRecord} from '../../integrations/adapter/contract.ts';
import {NEXT_ACTIONS, briefText} from './brief.ts';
import {personaFollowUp, personaOpening, styled} from './personas.ts';
import type {CustomerBrief, NextAction} from './brief.ts';
import {estimateTokens} from './budget.ts';
import type {Budget} from './budget.ts';
import type {ResponseCache} from './cache.ts';
import {requestKey} from './provider.ts';
import type {ChatProvider, ChatRequest} from './provider.ts';

/** One line of a conversation as the customer sees it. */
export interface SeenLine {
  from: 'customer' | 'product';
  text: string;
}

/** What code knows when the customer reacts. */
export interface ReactContext {
  /** 0 for the reaction to the first reply. */
  turn: number;
  /** The contact's outcome so far, judged from the records (simulation/simulator/judge.mjs). */
  verdict: ContactOutcome;
  detailsGiven: boolean;
  /** Carried between turns of one conversation (the rules voice keeps its state here). */
  state: Record<string, unknown>;
}

/** The customer's reaction after code has applied the brief. */
export interface Reaction {
  next: NextAction;
  /** What they write next; null when they leave without a word. */
  message: string | null;
  /** Whether the customer considers it sorted. */
  resolved: boolean;
  tone: string;
  /** What code changed in the proposed reaction, and why. Empty when it stood. */
  clamped: string[];
  /**
   * True when the customer called it sorted (or stayed content) and the records said otherwise. This is the
   * over-cooperation that model-played users are known for; the report counts it.
   */
  overruled: boolean;
}

/** Writes customers' words. */
export interface CustomerVoice {
  readonly kind: 'rules' | 'model';
  /** The people model, or "rules". */
  readonly model: string;
  opening(brief: CustomerBrief, rulesText: string): Promise<string>;
  react(brief: CustomerBrief, seen: readonly SeenLine[], ctx: ReactContext): Promise<Reaction>;
}

/** Outcomes from the records that a customer may accept as sorted. */
const ACCEPTABLE: ReadonlySet<ContactOutcome> = new Set(['resolved', 'handed_over']);

/**
 * Applies the brief to a proposed reaction. Pure and exported so its rules are tested on their own.
 */
export function clampReaction(
  proposed: Reaction,
  brief: CustomerBrief,
  ctx: ReactContext,
): Reaction {
  const out: Reaction = {...proposed, clamped: [...proposed.clamped]};
  const note = (why: string): void => {
    out.clamped.push(why);
  };
  if (!(NEXT_ACTIONS as readonly string[]).includes(out.next)) {
    note(`"${out.next}" is not an allowed action`);
    out.next = 'follow_up';
  }
  if (ctx.verdict === 'wrong_action') {
    if (out.next !== 'give_up' || out.resolved)
      note('the product changed something the customer did not ask for');
    return {
      ...out,
      overruled: out.resolved || out.next === 'thank_and_end',
      resolved: false,
      next: 'give_up',
      tone: 'angry',
      message: out.message ?? 'That is not what I asked for.',
    };
  }
  if (out.resolved && !ACCEPTABLE.has(ctx.verdict)) {
    note(`said resolved, but the records show "${ctx.verdict}"`);
    out.resolved = false;
    out.overruled = true;
    if (out.next === 'thank_and_end') {
      // Their thanks no longer fits: they say again what they still need.
      out.next = 'follow_up';
      out.message = brief.fallbackFollowUp;
    }
  }
  if (out.next === 'thank_and_end' && !out.resolved && ACCEPTABLE.has(ctx.verdict))
    out.resolved = true;
  if (out.next === 'give_details' && (ctx.detailsGiven || brief.details.order === null)) {
    note('had no details left to give');
    out.next = 'follow_up';
  }
  if (out.next === 'give_details' && brief.details.order !== null) {
    const facts = `My order is ${brief.details.order}${brief.details.postcode !== null ? ` and my postcode is ${brief.details.postcode}` : ''}.`;
    // WHY append: the model may write "here you go" without the number; code makes the details real.
    if (out.message?.includes(brief.details.order) !== true)
      out.message = `${out.message ?? ''} ${facts}`.trim();
  }
  if (brief.wantsPerson && ctx.turn === 0 && !out.resolved && out.next === 'follow_up') {
    note('this customer wants a person');
    out.next = 'ask_for_person';
  }
  const continues =
    out.next === 'follow_up' || out.next === 'give_details' || out.next === 'ask_for_person';
  if (continues && ctx.turn + 1 >= brief.patienceTurns) {
    note(
      `out of patience after ${brief.patienceTurns} ${brief.patienceTurns === 1 ? 'reply' : 'replies'}`,
    );
    out.next = 'give_up';
  }
  if (
    (out.next === 'follow_up' || out.next === 'ask_for_person') &&
    (out.message === null || out.message.trim() === '')
  ) {
    out.message =
      out.next === 'ask_for_person'
        ? 'I’d rather speak to a person, please.'
        : brief.fallbackFollowUp;
  }
  return out;
}

/** The rules-played customer: infrastructure/server/callers.mjs, the same branches the phone receptionist meets. */
export function rulesVoice(): CustomerVoice {
  return {
    kind: 'rules',
    model: 'rules',
    opening: (brief, rulesText) =>
      Promise.resolve(personaOpening(brief.persona, rulesText, brief.details.order)),
    react(brief, seen, ctx) {
      // WHY the plain text: the scripted caller reads the customer's manner from the simulator's own words, which the
      // persona's style or mangling would hide.
      const opening = brief.rulesText;
      const reply = seen.at(-1)?.text ?? '';
      const state = ctx.state;
      const situational = personaFollowUp(brief.persona, reply, ctx.turn, state, brief.details);
      if (situational !== null) {
        const proposed: Reaction = {
          next: situational.next,
          message: situational.message,
          resolved: false,
          tone: brief.tone,
          clamped: [],
          overruled: false,
        };
        return Promise.resolve(clampReaction(proposed, brief, ctx));
      }
      const before = {gaveRef: state['gaveRef'], askedPerson: state['askedPerson']};
      const said = nextCallerTurn({
        topic: brief.topic,
        opening,
        reply,
        state,
        order: brief.details.order,
        postcode: brief.details.postcode,
        product: brief.details.product,
      });
      let next: NextAction = 'follow_up';
      if (said === null) next = state['handedOver'] === true ? 'thank_and_end' : 'give_up';
      else if (state['gaveRef'] !== before.gaveRef) next = 'give_details';
      else if (state['askedPerson'] !== before.askedPerson) next = 'ask_for_person';
      else if (state['done'] === true) next = 'thank_and_end';
      const proposed: Reaction = {
        next,
        message: said === null ? null : styled(brief.persona.style, said),
        resolved: next === 'thank_and_end',
        tone: brief.tone,
        clamped: [],
        overruled: false,
      };
      return Promise.resolve(clampReaction(proposed, brief, ctx));
    },
  };
}

/** Limits on one people-model call. Short on purpose: customers write a few sentences. */
const OPENING_MAX_TOKENS = 160;
const REACT_MAX_TOKENS = 240;
/** Some variety between customers; reruns stay exact because answers are cached by their inputs. */
const TEMPERATURE = 0.7;

const PERSONA = [
  'You play one customer of Overthought & Co., a small online shop, in a simulation that tests the shop’s',
  'customer service. Stay in character. Write like a real person: short, specific, sometimes impatient. Never',
  'mention that this is a simulation. Only use facts from your brief; do not invent order numbers.',
].join(' ');

/** A customer voiced by the developer's model, through the cache and the budget. */
export function modelVoice(o: {
  provider: ChatProvider;
  cache: ResponseCache;
  budget: Budget;
}): CustomerVoice {
  const ask = async (req: ChatRequest): Promise<string> => {
    const key = requestKey(o.provider, req);
    const hit = o.cache.get(key);
    if (hit !== null) {
      o.budget.chargeCached();
      return hit.text;
    }
    const prompt = estimateTokens(req.system + req.messages.map((m) => m.content).join(''));
    o.budget.reserve(prompt, req.maxTokens);
    const res = await o.provider.complete(req);
    o.budget.charge(res.usage);
    o.cache.set(key, res);
    return res.text;
  };
  return {
    kind: 'model',
    model: `${o.provider.kind}:${o.provider.model}`,
    async opening(brief) {
      const text = await ask({
        purpose: 'opening',
        system: `${PERSONA}\n\nYour brief:\n${briefText(brief)}`,
        messages: [
          {
            role: 'user',
            content: `Write your first message to the shop by ${brief.channel}. Only the message itself, at most four sentences.`,
          },
        ],
        maxTokens: OPENING_MAX_TOKENS,
        temperature: TEMPERATURE,
        json: false,
      });
      const words = tidy(text) || `Hello, this is ${brief.name}. I want to ${brief.goal}.`;
      // Code holds the model to the situation: the attack, the other person or the wrong number is always said.
      return personaOpening(brief.persona, words, brief.details.order, {restyle: false});
    },
    async react(brief, seen, ctx) {
      const text = await ask({
        purpose: 'react',
        system: `${PERSONA}\n\nYour brief:\n${briefText(brief)}\n\n${REACT_INSTRUCTIONS}`,
        // The model plays the customer, so the customer's lines are its own ("assistant") and the shop's are "user".
        messages: seen.map((l) => ({
          role: l.from === 'customer' ? 'assistant' : 'user',
          content: l.text,
        })),
        maxTokens: REACT_MAX_TOKENS,
        temperature: TEMPERATURE,
        json: true,
      });
      return clampReaction(parseReaction(text, brief), brief, ctx);
    },
  };
}

const REACT_INSTRUCTIONS = [
  'Read the shop’s last reply. Answer with one JSON object and nothing else:',
  '{"resolved": true|false, "tone": "pleased"|"calm"|"annoyed"|"angry",',
  ` "next": ${NEXT_ACTIONS.map((a) => `"${a}"`).join('|')}, "message": "what you write next, or empty"}`,
  'resolved means your goal is met by what they actually did, not by promises. give_details only if they asked',
  'for your order number or postcode. give_up if they keep missing the point.',
].join('\n');

/** Reads the model's JSON reaction, forgiving extra text around it. Unreadable output becomes a plain follow-up. */
export function parseReaction(text: string, brief: CustomerBrief): Reaction {
  const raw = firstJsonObject(text);
  if (!isRecord(raw)) {
    return {
      next: 'follow_up',
      message: brief.fallbackFollowUp,
      resolved: false,
      tone: brief.tone,
      clamped: ['the model’s reaction was not readable JSON'],
      overruled: false,
    };
  }
  const message = typeof raw['message'] === 'string' ? tidy(raw['message']) : '';
  return {
    next: typeof raw['next'] === 'string' ? (raw['next'] as NextAction) : 'follow_up',
    message: message === '' ? null : message,
    resolved: raw['resolved'] === true,
    tone: typeof raw['tone'] === 'string' ? raw['tone'] : brief.tone,
    clamped: [],
    overruled: false,
  };
}

/** Returns the first {...} block in text parsed as JSON, or null. */
function firstJsonObject(text: string): unknown {
  const match = /\{[\s\S]*\}/.exec(text);
  if (match === null) return null;
  try {
    return JSON.parse(match[0]) as unknown;
  } catch {
    return null; // not JSON: the caller treats it as an unreadable reaction
  }
}

/** Strips quotes and labels models like to add, and caps the length. */
function tidy(text: string): string {
  return text
    .trim()
    .replace(/^(customer|me|message)\s*:\s*/i, '')
    .replace(/^"([\s\S]*)"$/, '$1')
    .slice(0, 800)
    .trim();
}
