/**
 * @fileoverview Token accounting and a hard cap for the people model.
 *
 * WHY a cap that refuses before a call rather than after: a run on a paid model must never spend more than it was
 * allowed. Each call reserves its `maxTokens` of output plus its prompt; if that could pass the cap, the call is
 * not made and the run stops cleanly with the seeds it finished. Cached answers are free and never refused.
 */
import type {Usage} from './provider.ts';

/** The run would pass its token cap. Caught by the run, which stops and reports what it finished. */
export class BudgetExceededError extends Error {
  override readonly name = 'BudgetExceededError';
}

/** Tokens used so far, by what they were for. */
export interface TokenTally {
  input: number;
  output: number;
  calls: number;
  cached_calls: number;
}

/** Counts tokens and refuses calls that could pass the cap. */
export interface Budget {
  readonly cap: number | null;
  readonly tally: TokenTally;
  /** Throws {@link BudgetExceededError} if a call of this size could pass the cap. */
  reserve(promptTokens: number, maxOutputTokens: number): void;
  charge(usage: Usage): void;
  chargeCached(): void;
}

/** Makes a budget. `cap` is total tokens (input plus output); null means no cap. */
export function createBudget(cap: number | null): Budget {
  const tally: TokenTally = {input: 0, output: 0, calls: 0, cached_calls: 0};
  return {
    cap,
    tally,
    reserve(promptTokens, maxOutputTokens) {
      if (cap === null) return;
      const used = tally.input + tally.output;
      if (used + promptTokens + maxOutputTokens > cap) {
        throw new BudgetExceededError(
          `the people model would pass the token cap (${used} used of ${cap}); stopping cleanly`,
        );
      }
    },
    charge(usage) {
      tally.input += usage.input;
      tally.output += usage.output;
      tally.calls++;
    },
    chargeCached() {
      tally.cached_calls++;
    },
  };
}

/** A rough token count for text (four characters a token), used only to reserve room before a call. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
