/**
 * @fileoverview Three ways to carry the contract to a product: a command (one JSON line in, one out), a web
 * address (HTTP POST), and an OpenAI-compatible chat endpoint (for products that are a model plus a prompt).
 *
 * Every transport returns the product's raw answer; {@link parseAnswer} in contract.ts checks it. Transports
 * never throw for a product's mistakes: they throw {@link TransportError} with a plain message, which the loop
 * records against the conversation.
 */
import {spawn} from 'node:child_process';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {guardedFetch} from '../../infrastructure/server/net-guard.mjs';
import {isRecord} from './contract.ts';
import type {ToolSchema, Turn} from './contract.ts';

/** Sends one turn and returns the product's raw JSON answer. */
export interface Transport {
  readonly kind: 'command' | 'http' | 'openai';
  send(turn: Turn): Promise<unknown>;
  close(): Promise<void>;
}

/** The product could not be reached, timed out, or sent something that is not JSON. */
export class TransportError extends Error {
  override readonly name = 'TransportError';
}

/** The default wait for one answer. Local models can be slow; a minute is generous but finite. */
export const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Starts a command that reads one JSON turn per line on stdin and writes one JSON answer per line on stdout.
 * One process serves the whole run; turns go one at a time so answers cannot be mixed up.
 */
export function commandTransport(o: {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}): Transport {
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // stderr is inherited so the developer sees their product's own logs while it runs.
  const child: ChildProcessWithoutNullStreams = spawn(o.command, {
    shell: true,
    cwd: o.cwd,
    stdio: ['pipe', 'pipe', 'inherit'],
  }) as unknown as ChildProcessWithoutNullStreams;
  const lines = createInterface({input: child.stdout})[Symbol.asyncIterator]();
  let dead: string | null = null;
  // Read through a function: `dead` is set by event callbacks, which flow analysis cannot see.
  const deadReason = (): string | null => dead;
  child.on('exit', (code) => {
    dead = `the command exited (code ${String(code)})`;
  });
  child.on('error', (e) => {
    dead = `the command could not start: ${e.message}`;
  });
  // A write after the child died raises EPIPE on the stream; the next send reports `dead` instead.
  child.stdin.on('error', () => undefined);
  let queue: Promise<unknown> = Promise.resolve();

  async function once(turn: Turn): Promise<unknown> {
    if (dead !== null) throw new TransportError(dead);
    child.stdin.write(JSON.stringify(turn) + '\n');
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        resolve('timeout');
      }, timeoutMs);
    });
    try {
      const got = await Promise.race([lines.next(), timeout]);
      if (got === 'timeout') {
        dead = `the command gave no answer in ${timeoutMs / 1000}s`;
        child.kill();
        throw new TransportError(dead);
      }
      if (got.done === true)
        throw new TransportError(deadReason() ?? 'the command closed its output');
      return parseJson(got.value, 'the command printed');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    kind: 'command',
    send(turn) {
      const next = queue.then(() => once(turn));
      queue = next.catch(() => undefined);
      return next;
    },
    close() {
      child.stdin.end();
      child.kill();
      return Promise.resolve();
    },
  };
}

/**
 * POSTs each turn as JSON to a web address. Uses the server's outbound guard (infrastructure/server/net-guard.mjs): on a shared
 * server private addresses are refused; on your own machine localhost is allowed.
 */
export function httpTransport(o: {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Transport {
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    kind: 'http',
    async send(turn) {
      const res = await guardedFetch(o.url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', ...o.headers},
        body: JSON.stringify(turn),
        signal: AbortSignal.timeout(timeoutMs),
      }).catch((e: unknown) => {
        throw new TransportError(`could not reach ${o.url}: ${errorText(e)}`);
      });
      const text = await res.text();
      if (!res.ok)
        throw new TransportError(`${o.url} answered HTTP ${res.status}: ${text.slice(0, 200)}`);
      return parseJson(text, `${o.url} answered`);
    },
    close: () => Promise.resolve(),
  };
}

/** Settings for a product that is an OpenAI-compatible model plus a system prompt. */
export interface OpenAiProductOptions {
  baseUrl: string;
  model: string;
  systemPrompt: string;
  apiKey?: string;
  timeoutMs?: number;
  temperature?: number;
}

/**
 * Calls an OpenAI-compatible `/chat/completions` endpoint as the product. The system prompt is the developer's;
 * Overthink adds one short paragraph saying who is writing and when, then the conversation and the tools.
 */
export function openAiTransport(o: OpenAiProductOptions): Transport {
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = o.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  return {
    kind: 'openai',
    async send(turn) {
      const body = {
        model: o.model,
        temperature: o.temperature ?? 0,
        messages: [
          {role: 'system', content: systemFor(o.systemPrompt, turn)},
          ...turn.conversation,
        ],
        ...(turn.tools.length > 0 ? {tools: turn.tools satisfies ToolSchema[]} : {}),
      };
      const res = await guardedFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(o.apiKey !== undefined ? {Authorization: `Bearer ${o.apiKey}`} : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      }).catch((e: unknown) => {
        throw new TransportError(`could not reach ${url}: ${errorText(e)}`);
      });
      const text = await res.text();
      if (!res.ok)
        throw new TransportError(`${url} answered HTTP ${res.status}: ${text.slice(0, 200)}`);
      return answerFromCompletion(parseJson(text, url));
    },
    close: () => Promise.resolve(),
  };
}

/** Turns a chat completion into the contract's answer shape. Exported for tests. */
export function answerFromCompletion(raw: unknown): unknown {
  const choices = isRecord(raw) ? raw['choices'] : undefined;
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const message = isRecord(first) ? first['message'] : undefined;
  if (!isRecord(message))
    throw new TransportError('the endpoint did not return choices[0].message');
  const content = message['content'];
  return {
    reply: typeof content === 'string' ? content : null,
    tool_calls: message['tool_calls'] ?? [],
  };
}

function systemFor(prompt: string, turn: Turn): string {
  const who =
    turn.who.kind === 'customer'
      ? `You are talking to ${turn.who.name} by ${turn.who.channel}.`
      : `This is internal work: ${turn.who.name}.`;
  return `${prompt}\n\n${who} It is now ${turn.now}. Use the tools to look things up and act; never claim an action you did not take.`;
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new TransportError(`${what} something that is not JSON: ${text.slice(0, 120)}`);
  }
}

/** Returns an error's message, or the value as text. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
