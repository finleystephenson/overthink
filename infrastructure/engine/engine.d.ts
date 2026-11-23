// Types for the parts of infrastructure/engine/engine.js that the TypeScript code uses. Hand-written until engine.js
// moves to TypeScript: describe only what is imported, and keep it true to the JavaScript.

/** A JSON Schema, as the engine writes them (type, properties, required, enum). */
export type JsonSchema = Record<string, unknown>;

/** One call's context, as the engine hands it to a tool's `run`. */
export interface ToolContext {
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

/** Adds record lists, id counters and tools to every world made after this call. */
export function extend(o: {state?: string[]; tools?: EngineTool[]}): void;

/** The helpers extension tools use, so they follow the same rules as the built-in ones. */
export const kit: {
  /** Throws the engine's refusal: `code` is machine-readable, `message` is a sentence for the caller. */
  fail: (code: string, message: string) => never;
  /** The next id for a prefix from the state's counters, e.g. nextId(ctx, 'C') → "C-1043". */
  nextId: (ctx: ToolContext, prefix: string, width?: number) => string;
  schema: {
    str: JsonSchema;
    num: JsonSchema;
    bool: JsonSchema;
    strs: JsonSchema;
    obj: (properties?: Record<string, JsonSchema>, required?: string[]) => JsonSchema;
  };
};
