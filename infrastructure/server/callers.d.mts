export const MAX_CALLER_TURNS: number;
export function prefersPerson(customerId: string | null | undefined): boolean;
/** What a rules-played customer says next, or null when they leave. `state` is carried between turns. */
export function nextCallerTurn(o: {
  topic: string;
  opening: string;
  reply: string;
  state: Record<string, unknown>;
  order?: string | null;
  postcode?: string | null;
  product?: string | null;
  customerId?: string | null;
}): string | null;
