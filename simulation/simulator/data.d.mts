export const ROOT: string;
/** business/data/sim.json, staff.json, costs.json and characters.json, read once. */
export function loadBusiness(dir?: string): {sim: {memory: {compact_every_days: number}}} & Record<string, unknown>;
