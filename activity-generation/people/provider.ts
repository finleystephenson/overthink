/**
 * @fileoverview The model that voices the simulated people: any OpenAI-compatible chat endpoint (OpenAI, OpenRouter,
 * Ollama, LM Studio, vLLM, LiteLLM, Anthropic's compatible endpoint), the native Anthropic API, or a deterministic
 * fake for tests. About a hundred lines of fetch instead of an SDK, so Overthink keeps no runtime dependency for it.
 *
 * Settings (environment):
 *   OVERTHINK_BASE_URL   e.g. http://localhost:11434/v1 for Ollama
 *   OVERTHINK_API_KEY    any text for local servers that ignore it
 *   OVERTHINK_MODEL      e.g. llama3.2
 *   OVERTHINK_PROVIDER   "openai" (default), "anthropic" or "fake"
 */
import {createHash} from 'node:crypto';
import {isRecord} from '../../integrations/adapter/contract.ts';

/**
 * What a people-model call is for: a customer's first message or reaction, a panel member reading content, a buyer
 * reading outreach, or a member of staff giving feedback on an internal tool.
 */
export type Purpose = 'opening' | 'react' | 'panel' | 'buyer' | 'staff';

/** One request to the people model. */
export interface ChatRequest {
  /** What the call is for; used for accounting and by the fake provider. Real providers ignore it. */
  purpose: Purpose;
  system: string;
  messages: {role: 'user' | 'assistant'; content: string}[];
  maxTokens: number;
  temperature: number;
  /** Ask for a JSON object back. */
  json: boolean;
}

/** Tokens a call used. Counted from the provider's own figures where it gives them. */
export interface Usage {
  input: number;
  output: number;
}

/** A model's answer. */
export interface ChatResult {
  text: string;
  usage: Usage;
}

/** A model that voices people. */
export interface ChatProvider {
  /** "openai", "anthropic" or "fake". */
  readonly kind: string;
  readonly model: string;
  /** Where it runs, for the report (never the key). */
  readonly endpoint: string;
  complete(req: ChatRequest): Promise<ChatResult>;
}

/** The provider failed: unreachable, an HTTP error, or an answer without text. */
export class ProviderError extends Error {
  override readonly name = 'ProviderError';
}

const PROVIDER_TIMEOUT_MS = 120_000;

/** Calls `POST {baseUrl}/chat/completions`. */
export function openAiCompatibleProvider(o: {
  baseUrl: string;
  model: string;
  apiKey?: string;
}): ChatProvider {
  const url = o.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  return {
    kind: 'openai',
    model: o.model,
    endpoint: o.baseUrl,
    async complete(req) {
      const body = {
        model: o.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        // Honoured by Ollama and vLLM; best effort elsewhere. The cache, not the seed, is what makes reruns exact.
        seed: 1,
        messages: [{role: 'system', content: req.system}, ...req.messages],
        ...(req.json ? {response_format: {type: 'json_object'}} : {}),
      };
      const raw = await postJson(
        url,
        body,
        o.apiKey !== undefined ? {Authorization: `Bearer ${o.apiKey}`} : {},
      );
      const choices = isRecord(raw) ? raw['choices'] : undefined;
      const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
      const msg = isRecord(first) ? first['message'] : undefined;
      const text = isRecord(msg) ? msg['content'] : undefined;
      if (typeof text !== 'string') throw new ProviderError(`${url} returned no message text`);
      const usage = isRecord(raw) && isRecord(raw['usage']) ? raw['usage'] : {};
      return {
        text,
        usage: {input: count(usage['prompt_tokens']), output: count(usage['completion_tokens'])},
      };
    },
  };
}

/** Calls the native Anthropic Messages API (`POST /v1/messages`). */
export function anthropicProvider(o: {
  model: string;
  apiKey: string;
  baseUrl?: string;
}): ChatProvider {
  const base = (o.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  return {
    kind: 'anthropic',
    model: o.model,
    endpoint: base,
    async complete(req) {
      const body = {
        model: o.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        // WHY no JSON mode flag: the Messages API has none; the prompt asks for JSON and voice.ts parses leniently.
        system: req.system,
        messages: req.messages,
      };
      const raw = await postJson(`${base}/v1/messages`, body, {
        'x-api-key': o.apiKey,
        'anthropic-version': '2023-06-01',
      });
      const content = isRecord(raw) ? raw['content'] : undefined;
      const text = Array.isArray(content)
        ? content
            .filter((b): b is Record<string, unknown> => isRecord(b) && b['type'] === 'text')
            .map((b) => String(b['text']))
            .join('')
        : undefined;
      if (text === undefined) throw new ProviderError('the Anthropic API returned no content');
      const usage = isRecord(raw) && isRecord(raw['usage']) ? raw['usage'] : {};
      return {
        text,
        usage: {input: count(usage['input_tokens']), output: count(usage['output_tokens'])},
      };
    },
  };
}

/**
 * A deterministic stand-in for tests and dry runs. Writes plain sentences from the brief in the system prompt and
 * judges a reply by simple word rules, so a test can check the plumbing without a model. Never cooperative on its
 * own: whatever it claims, voice.ts clamps it against the records.
 */
export function fakeProvider(): ChatProvider {
  return {
    kind: 'fake',
    model: 'fake-people-1',
    endpoint: 'in-process',
    complete(req) {
      const facts = factsFrom(req.system);
      let text: string;
      if (req.purpose === 'panel' || req.purpose === 'buyer' || req.purpose === 'staff') {
        text = JSON.stringify(
          fakeJudgement(req.purpose, facts, req.messages.at(-1)?.content ?? ''),
        );
      } else if (req.purpose === 'opening') {
        const shares = facts['shares_order_number_at_first'] === 'yes' && facts['order'] !== 'none';
        const details = shares
          ? ` My order is ${facts['order'] ?? ''} and my postcode is ${facts['postcode'] ?? ''}.`
          : '';
        text = `Hi, ${facts['name'] ?? 'a customer'} here (fake model). ${facts['goal'] ?? 'I need help.'}${details}`;
      } else {
        const last = req.messages.at(-1)?.content ?? '';
        const helpful =
          /order|refund|replace|sorry|case|deliver|return|track/i.test(last) && last.length > 40;
        text = JSON.stringify({
          resolved: helpful,
          tone: helpful ? 'calm' : 'annoyed',
          next: helpful ? 'thank_and_end' : 'follow_up',
          message: helpful
            ? 'Thank you, that helps.'
            : `That does not answer it. ${facts['goal'] ?? ''}`.trim(),
        });
      }
      const input = Math.ceil(
        (req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0)) / 4,
      );
      return Promise.resolve({text, usage: {input, output: Math.ceil(text.length / 4)}});
    },
  };
}

/**
 * Reads the people model from the environment. Returns null when nothing is set, which means people are played by
 * rules only (free and deterministic).
 */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): ChatProvider | null {
  const kind = env['OVERTHINK_PROVIDER'] ?? 'openai';
  if (kind === 'fake') return fakeProvider();
  const model = env['OVERTHINK_MODEL'];
  if (kind === 'anthropic') {
    const apiKey = env['OVERTHINK_API_KEY'] ?? env['ANTHROPIC_API_KEY'];
    if (model === undefined || apiKey === undefined) {
      throw new ProviderError(
        'OVERTHINK_PROVIDER=anthropic needs OVERTHINK_MODEL and OVERTHINK_API_KEY.',
      );
    }
    const baseUrl = env['OVERTHINK_BASE_URL'];
    return anthropicProvider({model, apiKey, ...(baseUrl !== undefined ? {baseUrl} : {})});
  }
  const baseUrl = env['OVERTHINK_BASE_URL'];
  if (baseUrl === undefined && model === undefined) return null;
  if (baseUrl === undefined || model === undefined) {
    throw new ProviderError(
      'Set both OVERTHINK_BASE_URL and OVERTHINK_MODEL (and OVERTHINK_API_KEY if needed).',
    );
  }
  const apiKey = env['OVERTHINK_API_KEY'];
  return openAiCompatibleProvider({baseUrl, model, ...(apiKey !== undefined ? {apiKey} : {})});
}

/** A stable key for a request to a given model: the same inputs always give the same key. */
export function requestKey(p: Pick<ChatProvider, 'kind' | 'model'>, req: ChatRequest): string {
  const canonical = JSON.stringify([
    p.kind,
    p.model,
    req.system,
    req.messages,
    req.maxTokens,
    req.temperature,
    req.json,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', ...headers},
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (e) {
    throw new ProviderError(
      `could not reach ${url}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const text = await res.text();
  if (!res.ok) throw new ProviderError(`${url} answered HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError(`${url} did not answer JSON`);
  }
}

function count(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
}

/** Pulls `key: value` lines out of a brief, for the fake provider. */
function factsFrom(system: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of system.matchAll(/^- (\w+): (.+)$/gm)) {
    const [, k, v] = m;
    if (k !== undefined && v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * The fake provider's decisions for panels, buyers and staff: plain word rules over the brief's facts and the text
 * read, so tests see decisions that follow from circumstances and content, and never from a name (none is given).
 */
function fakeJudgement(
  purpose: 'panel' | 'buyer' | 'staff',
  facts: Record<string, string>,
  text: string,
): Record<string, unknown> {
  const lower = text.toLowerCase();
  const offer = /\b\d{1,2}\s?%|discount|half price|\bsale\b|free delivery/.test(lower);
  if (purpose === 'panel') {
    const tight = /tight/.test(facts['money'] ?? '');
    const busy = /little spare time|interrupted|new job|moving/.test(facts['life'] ?? '');
    const keen = /every week|now and then/.test(facts['shopping_online'] ?? '');
    const shouty = /!!|[A-Z]{12,}/.test(text);
    // A deterministic spread: the same person and text always land in the same place.
    const u =
      parseInt(
        createHash('sha256')
          .update(JSON.stringify(facts) + text)
          .digest('hex')
          .slice(0, 8),
        16,
      ) /
      2 ** 32;
    let decision = 'ignore';
    if (shouty) decision = facts['content'] === 'newsletter' ? 'unsubscribe' : 'ignore';
    else if (busy && text.length > 500) decision = 'ignore';
    else if (offer && keen && !tight && u < 0.5) decision = 'buy';
    else if (offer && u < 0.6) decision = 'visit';
    else if (u < 0.3) decision = 'like';
    else if (u < 0.36) decision = 'reply';
    else if (u < 0.4) decision = 'share';
    return {
      decision,
      reply: decision === 'reply' ? 'Looks useful, does it come in other colours?' : '',
      why: 'fake model',
    };
  }
  if (purpose === 'buyer') {
    const needs = (facts['needs'] ?? '')
      .toLowerCase()
      .split(/[,;]\s*/)
      .map((n) => n.split(' x ').at(-1)?.trim() ?? '');
    const names = needs.filter((n) => n.length > 2 && lower.includes(n.replace(/-/g, ' ')));
    const ready = facts['ready_to_switch_supplier'] === 'yes';
    const times = Number(facts['times_contacted'] ?? '1');
    const patience = Number(facts['patience_contacts'] ?? '2');
    let decision = 'ignore';
    if (times > patience) decision = 'unsubscribe';
    else if (names.length > 0 && ready && offer) decision = 'buy';
    else if (names.length > 0 && ready) decision = 'meet';
    else if (names.length > 0) decision = 'ask';
    else if (text.length > 120) decision = 'reply';
    return {
      decision,
      message: decision === 'ignore' ? '' : 'Thanks for writing. Tell me more about prices.',
      why: 'fake model',
    };
  }
  const worked = facts['code_says_it_worked'] === 'yes';
  return {
    worked: worked ? ['It found what I needed'] : [],
    didnt: worked ? [] : ['It did not give me what I asked for'],
    would_use_again: worked,
    note: 'fake model',
  };
}
