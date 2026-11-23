// Types for the parts of simulation/world/population.mjs that the TypeScript code uses.

/** A person's traits (business/data/population.json). Only the circumstance fields src/ reads are described. */
export interface PersonTraits {
  income?: string;
  employment?: string;
  online?: string;
  circumstances?: string[];
}

export function traitsFor(person: {name: string}, population: unknown): PersonTraits | null;
