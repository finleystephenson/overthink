import type {SimRunResult} from './core.d.mts';
/** One run's headline numbers (money, customers, staff, the tool's calls). */
export function headline(res: SimRunResult, scaleDays?: number): Record<string, number | null | Record<string, number | null>>;
