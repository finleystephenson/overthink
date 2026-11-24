export const SIZES: string[];
/** The generated world files for one size (business, products, policies, help, seed state). */
export function dataFor(size: string): Record<string, unknown> & {business: {name?: string; [k: string]: unknown}};
/** A world of this size holding a saved state (JSON string or object). */
export function worldFromState(size: string, state: string | Record<string, unknown>, o?: {bench?: boolean}): import('./sandboxes.mjs').EngineWorld;
/** A fresh world at the fixed simulated "now", with the team's plan attached: every sandbox starts identical. */
export function freshWorld(size: string, o?: {bench?: boolean}): import('./sandboxes.mjs').EngineWorld;
