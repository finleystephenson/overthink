/**
 * @fileoverview The one contract between Overthink and the product under test.
 *
 * Each turn Overthink sends one JSON object (a {@link Turn}) and the product answers with one JSON object (an
 * {@link Answer}). The conversation is in OpenAI chat format on purpose: a product that is a model plus a prompt
 * can pass it straight to its own model, and every other product only has to read `role` and `content`.
 *
 * WHY tool calls come back to Overthink instead of the product calling an API itself: the business must decide
 * what a refund or a cancelled order does, with the product's permissions and an audit record, so that results
 * come from records and never from what the product says it did.
 */

/** The version of this contract. Sent with every turn; bumped only for a breaking change. */
export const CONTRACT_VERSION = 1;

/** A tool call as the product asks for it, and as it is echoed back in the conversation. */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {name: string; arguments: string};
}

/** One message in the conversation, OpenAI chat format. `user` is the customer, `assistant` the product. */
export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** On an assistant message that asked for tools. */
  tool_calls?: ToolCall[];
  /** On a tool message: which call this is the result of. */
  tool_call_id?: string;
}

/** A business tool the product may use, as an OpenAI function schema. */
export interface ToolSchema {
  type: 'function';
  function: {name: string; description: string; parameters: Record<string, unknown>};
}

/** Who the product is talking to, or what work it is doing. */
export interface Who {
  kind: 'customer' | 'work' | 'staff' | 'supplier' | 'business' | 'public';
  /** The customer's name as they gave it, or a label for the work ("Stock alert"). */
  name: string;
  /** Where the message came in: a channel in integrations/adapter/channels.ts (web_chat, email, internal, publishing ...). */
  channel: string;
}

/** What Overthink sends the product on every turn. */
export interface Turn {
  overthink: typeof CONTRACT_VERSION;
  /** One conversation. A product that keeps memory should key it by this. */
  session_id: string;
  who: Who;
  conversation: Message[];
  /** Only the tools the product's role and scope allow. */
  tools: ToolSchema[];
  /** The simulated date and time, ISO 8601. */
  now: string;
  business: {name: string; role: string; instructions: string};
}

/** A tool call after validation: a name and parsed arguments. */
export interface RequestedCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** What the product answers, after validation. */
export interface Answer {
  /** Text for the customer. Only the reply of the answer that ends the turn reaches them. */
  reply: string | null;
  /** Tools to run before the product is asked again. Empty means the turn is over. */
  toolCalls: RequestedCall[];
}

/** An answer that breaks the contract. The message says what was wrong and what was expected. */
export class ContractError extends Error {
  override readonly name = 'ContractError';
}

/**
 * Checks a product's raw answer and returns it in one shape.
 *
 * Accepts `{reply, tool_calls}` where each call is either `{name, arguments}` (arguments as an object or a JSON
 * string) or the OpenAI shape `{id, type: "function", function: {name, arguments}}`. Throws a
 * {@link ContractError} naming the first problem.
 */
export function parseAnswer(raw: unknown): Answer {
  if (!isRecord(raw)) {
    throw new ContractError(
      `The answer must be a JSON object like {"reply": "..."}; got ${describe(raw)}.`,
    );
  }
  const reply = raw['reply'];
  if (reply !== undefined && reply !== null && typeof reply !== 'string') {
    throw new ContractError(`"reply" must be a string; got ${describe(reply)}.`);
  }
  const calls = raw['tool_calls'];
  if (calls !== undefined && calls !== null && !Array.isArray(calls)) {
    throw new ContractError(`"tool_calls" must be a list; got ${describe(calls)}.`);
  }
  const toolCalls = (calls ?? []).map((c: unknown, i: number) => parseCall(c, i));
  return {reply: typeof reply === 'string' ? reply : null, toolCalls};
}

function parseCall(raw: unknown, index: number): RequestedCall {
  const where = `tool_calls[${index}]`;
  if (!isRecord(raw)) throw new ContractError(`${where} must be an object; got ${describe(raw)}.`);
  // The OpenAI shape nests name and arguments under `function`; the short shape has them at the top.
  const inner = isRecord(raw['function']) ? raw['function'] : raw;
  const name = inner['name'];
  if (typeof name !== 'string' || name === '') {
    throw new ContractError(`${where} needs a "name" (the tool to run).`);
  }
  const args = parseArguments(inner['arguments'], where);
  const id = typeof raw['id'] === 'string' && raw['id'] !== '' ? raw['id'] : `call_${index + 1}`;
  return {id, name, arguments: args};
}

function parseArguments(raw: unknown, where: string): Record<string, unknown> {
  if (raw === undefined || raw === null || raw === '') return {};
  if (isRecord(raw)) return raw;
  if (typeof raw === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ContractError(
        `${where}.arguments is a string but not valid JSON: ${raw.slice(0, 80)}`,
      );
    }
    if (isRecord(parsed)) return parsed;
  }
  throw new ContractError(
    `${where}.arguments must be an object (or a JSON string of one); got ${describe(raw)}.`,
  );
}

/** Returns the tool call in the OpenAI shape, for the conversation sent back to the product. */
export function toWireCall(call: RequestedCall): ToolCall {
  return {
    id: call.id,
    type: 'function',
    function: {name: call.name, arguments: JSON.stringify(call.arguments)},
  };
}

/** Narrows an unknown value to a plain object. */
export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function describe(x: unknown): string {
  if (x === null) return 'null';
  if (Array.isArray(x)) return 'a list';
  if (typeof x === 'string') return `the text "${x.slice(0, 40)}"`;
  return `a ${typeof x}`;
}
