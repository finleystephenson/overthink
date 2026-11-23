// Types for the parts of simulation/simulator/audience.mjs that the TypeScript code uses. Hand-written until it moves to TypeScript.

/** What the audience plug-in puts on a record it has planned. Only the fields src/ reads or writes are described. */
export interface AudiencePlan {
  kind: string;
  network?: string;
  first_day: number;
  tau: number;
  window: number;
  product_id: string | null;
  offer?: boolean;
  unsubscribed?: number;
  plan: Record<string, number>;
  so_far: Record<string, number>;
  shown: Record<string, number>;
  [k: string]: unknown;
}

/** The plug-in, as simulation/simulator/core.mjs runs it, plus `plan`, which plans new records at once. */
export interface AudiencePlugin {
  name: 'audience';
  plan(state: unknown, seed: number): void;
  modifiers(ctx: unknown): unknown;
  afterDay(ctx: unknown): void;
}

export function audiencePlugin(o: {rates: unknown; products: unknown[]; commsData?: unknown}): AudiencePlugin;

/** business/data/audience.json with its explanations stripped; only what src/ reads. */
export interface AudienceRates {
  social: {
    like_rate: Record<string, number>;
    comments_per_like: number;
    repost_rate: Record<string, number>;
    reach_per_repost: number;
    visit_rate: Record<string, number>;
  };
  shop: {conversion: number; average_order_value: number};
  email: {open_rate: number; click_rate: number; unsubscribe_rate: number};
}
