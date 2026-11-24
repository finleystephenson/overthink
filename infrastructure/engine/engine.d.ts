// Types for the parts of infrastructure/engine/engine.js that the TypeScript code uses. Hand-written until engine.js
// moves to TypeScript: describe only what is imported, and keep it true to the JavaScript.

/** A JSON Schema, as the engine writes them (type, properties, required, enum). */
export type JsonSchema = Record<string, unknown>;

/** A person in the business's planned team (business/data/staff.json "staff"), as the levers extension reads it. */
export interface PlannedPerson {
  id: string;
  name: string;
  role: string;
  job?: string;
  /** The book the character comes from. */
  from?: string;
  weekly_hours: number;
  hourly_pay?: number;
  /** When their working day starts, "09:00". */
  start?: string;
  /** Set on people hired during a run (infrastructure/engine/levers.js). */
  hired?: boolean;
  joined?: string | null;
}

/** What "as planned" means for a world (infrastructure/engine/levers.js attachPlan). Fixed business data, not state. */
export interface WorldPlan {
  staff: PlannedPerson[];
  /** The working days, as "mon", "tue" ... */
  work_days: string[] | null;
  day_start: string | null;
}

/** An engine world: its state, plus the fixed plan the server attaches. */
export interface EngineWorld {
  state: EngineState;
  plan?: WorldPlan;
}

/** One call's context, as the engine hands it to a tool's `run`. */
export interface ToolContext {
  /** The world the call runs in. */
  world: EngineWorld;
  /** The world's state: every record list, the clock and the id counters. */
  st: EngineState;
  /** The role the call acts as (a business role, or the `world` lens). */
  role: string;
  /** The simulated time of the call (ISO). */
  now: string;
  /** Plain lines for the audit log, one per change. */
  changes: string[];
}

/** The parts of the state the TypeScript reads or writes. Every list is plain JSON. */
export interface EngineState {
  now: string;
  counters: Record<string, number>;
  customers: Record<string, unknown>[];
  [list: string]: unknown;
}

/** An engine tool. `run` throws through `kit.fail` to refuse; whatever it returns is the tool's data. */
export interface EngineTool {
  name: string;
  roles: readonly string[];
  description: string;
  input_schema: JsonSchema;
  needs_customer?: boolean;
  run(ctx: ToolContext, input: Record<string, unknown>): unknown;
}

/**
 * Adds record lists, id counters and tools to every world made after this call. A counter is
 * [prefix, state key, id field], so nextId(ctx, prefix) carries on from the highest id already there.
 */
export function extend(o: {
  state?: string[];
  counters?: [string, string, string][];
  tools?: EngineTool[];
}): void;

/** The helpers extension tools use, so they follow the same rules as the built-in ones. */
export const kit: {
  /** Throws the engine's refusal: `code` is machine-readable, `message` is a sentence for the caller. */
  fail: (code: string, message: string) => never;
  /** The next id for a prefix from the state's counters, e.g. nextId(ctx, 'C') → "C-1043". */
  nextId: (ctx: ToolContext, prefix: string, width?: number) => string;
  /** The roles, by group: who may call what. */
  roles: {
    ALL: readonly string[];
    STAFF: readonly string[];
    INTERNAL: readonly string[];
    CUSTOMER_ROLES: readonly string[];
    MONEY_READERS: readonly string[];
    MARKETING_READERS: readonly string[];
    STOCK_READERS: readonly string[];
    LENSES: readonly string[];
  };
  /** Words in a search, lower-cased. */
  tokens: (q: string) => string[];
  /** Whether a text holds every word (false for no words). */
  matches: (text: string, words: readonly string[]) => boolean;
  schema: {
    str: JsonSchema;
    num: JsonSchema;
    bool: JsonSchema;
    strs: JsonSchema;
    obj: (properties?: Record<string, JsonSchema>, required?: string[]) => JsonSchema;
  };
};
