/**
 * @fileoverview One product turn: send the conversation, run the tools the product asks for, send the results back,
 * and repeat until the product answers without tool calls (or runs out of steps).
 */
import {CONTRACT_VERSION, ContractError, parseAnswer, toWireCall} from './contract.ts';
import type {Message, Turn, Who} from './contract.ts';
import {REFUSAL_CODES} from './gateway.ts';
import type {ToolGateway} from './gateway.ts';
import {errorText} from './transports.ts';
import type {Transport} from './transports.ts';

/** How many times the product may ask for tools in one turn before Overthink stops it. */
export const DEFAULT_MAX_STEPS = 8;

/** The most of a tool result sent back to the product. Keeps small local models inside their context. */
const MAX_RESULT_CHARS = 6000;

/** One tool call as it happened, for the report's trace view. */
export interface CallRecord {
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  /** The engine's error code: `forbidden`, `out_of_scope`, `not_verified`, ... */
  code: string | null;
  /** True when the rules refused it (role, scope or a business rule). */
  refused: boolean;
  /** What the tool returned, when it worked. */
  result?: unknown;
}

/** What one product turn produced. */
export interface TurnResult {
  /** The text the customer sees, or null when the product sent none. */
  reply: string | null;
  calls: CallRecord[];
  /** Set when the product broke the contract, timed out or hit the step limit. */
  error: string | null;
  steps: number;
}

/** Everything a turn needs that does not change between steps. */
export interface TurnContext {
  transport: Transport;
  gateway: ToolGateway;
  sessionId: string;
  who: Who;
  now: string;
  business: Turn['business'];
  maxSteps?: number;
}

/**
 * Runs one product turn. Appends what happened to `conversation` (the product's tool requests, the tool results
 * and its final reply), so the next turn carries the whole history.
 */
export async function runProductTurn(
  ctx: TurnContext,
  conversation: Message[],
): Promise<TurnResult> {
  const maxSteps = ctx.maxSteps ?? DEFAULT_MAX_STEPS;
  const calls: CallRecord[] = [];
  for (let step = 1; step <= maxSteps; step++) {
    const turn: Turn = {
      overthink: CONTRACT_VERSION,
      session_id: ctx.sessionId,
      who: ctx.who,
      conversation: conversation.map((m) => ({...m})),
      tools: [...ctx.gateway.schemas],
      now: ctx.now,
      business: ctx.business,
    };
    let answer;
    try {
      answer = parseAnswer(await ctx.transport.send(turn));
    } catch (e) {
      const prefix = e instanceof ContractError ? 'broke the contract: ' : '';
      return {reply: null, calls, error: prefix + errorText(e), steps: step};
    }
    if (answer.toolCalls.length === 0) {
      if (answer.reply !== null) conversation.push({role: 'assistant', content: answer.reply});
      return {reply: answer.reply, calls, error: null, steps: step};
    }
    conversation.push({
      role: 'assistant',
      content: answer.reply ?? '',
      tool_calls: answer.toolCalls.map(toWireCall),
    });
    for (const call of answer.toolCalls) {
      const out = ctx.gateway.call(ctx.sessionId, call.name, call.arguments);
      const code = out.ok ? null : (out.error?.code ?? 'failed');
      calls.push({
        name: call.name,
        arguments: call.arguments,
        ok: out.ok,
        code,
        refused: code !== null && REFUSAL_CODES.has(code),
        ...(out.ok ? {result: out.data} : {}),
      });
      const content = JSON.stringify(out.ok ? out.data : {error: out.error});
      conversation.push({
        role: 'tool',
        tool_call_id: call.id,
        content: content.slice(0, MAX_RESULT_CHARS),
      });
    }
  }
  return {
    reply: null,
    calls,
    error: `asked for tools ${maxSteps} times without replying`,
    steps: maxSteps,
  };
}
