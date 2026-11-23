/**
 * @fileoverview One people-model call through the cache and the token budget, for the panels, buyers and staff.
 *
 * WHY every call goes through the content-addressed cache: the same person reading the same words always decides the
 * same thing, so both arms of a twin run, and every rerun, share reactions and cost nothing the second time.
 */
import {isRecord} from '../../integrations/adapter/contract.ts';
import {estimateTokens} from './budget.ts';
import type {Budget} from './budget.ts';
import type {ResponseCache} from './cache.ts';
import {requestKey} from './provider.ts';
import type {ChatProvider, ChatRequest} from './provider.ts';

/** A people model with its cache and budget: what every audience needs to ask someone something. */
export interface PeopleModel {
  provider: ChatProvider;
  cache: ResponseCache;
  budget: Budget;
}

/** Asks the model, or answers from the cache. Throws BudgetExceededError before a call that could pass the cap. */
export async function ask(m: PeopleModel, req: ChatRequest): Promise<string> {
  const key = requestKey(m.provider, req);
  const hit = m.cache.get(key);
  if (hit !== null) {
    m.budget.chargeCached();
    return hit.text;
  }
  m.budget.reserve(
    estimateTokens(req.system + req.messages.map((x) => x.content).join('')),
    req.maxTokens,
  );
  const res = await m.provider.complete(req);
  m.budget.charge(res.usage);
  m.cache.set(key, res);
  return res.text;
}

/** The first `{...}` block in a model's text, parsed, or null. Small models often wrap JSON in prose. */
export function firstJson(text: string): Record<string, unknown> | null {
  const match = /\{[\s\S]*\}/.exec(text);
  if (match === null) return null;
  try {
    const v: unknown = JSON.parse(match[0]);
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

/** `key: value` lines for a brief, the format the fake provider reads too. */
export function factLines(lines: readonly (readonly [string, string])[]): string {
  return lines.map(([k, v]) => `- ${k}: ${v}`).join('\n');
}

/** Trims a model's words to one tidy line of at most `max` characters. */
export function tidyText(x: unknown, max: number): string {
  if (typeof x !== 'string') return '';
  const t = x.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
