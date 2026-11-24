// Types for the parts of infrastructure/engine/levers.js that the TypeScript code uses. Hand-written until levers.js
// moves to TypeScript: describe only what is imported, and keep it true to the JavaScript.
import type {PlannedPerson} from './engine.js';

/** The changes a manager made to the team (world.state.settings.staff). */
export interface StaffChanges {
  hours?: Record<string, number>;
  removed?: string[];
  added?: {id: string; name: string; role: string; weekly_hours: number; joined?: string}[];
}

/** The team as the settings say it is today: the plan itself when nothing changed, else a changed copy. */
export function effectiveStaff(
  staff: readonly PlannedPerson[],
  changes: StaffChanges | null | undefined,
): PlannedPerson[];
