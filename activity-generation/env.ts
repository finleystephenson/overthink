/**
 * @fileoverview Where activity happens: one sandbox, and the doors into its world that activity uses.
 *
 * Activity speaks for people outside the company, so it acts through the engine's `world` lens (for things that
 * arrive from outside: an email, a chat, a post) or as the person themselves (the `customer` role, for what they do
 * in the shop: order, return, review). Either way it goes through engine tools, so the shop's rules apply and every
 * app shows the result. Each action is written to the sandbox trace as `kind: "activity"`, apart from what a product
 * did, so results can always tell the two apart.
 */
import type {
  EngineResult,
  Principal,
  Sandbox,
  SandboxStore,
} from '../infrastructure/server/sandboxes.mjs';

/** One sandbox, opened for activity by its owner. */
export interface ActivityEnv {
  readonly store: SandboxStore;
  readonly sandbox: Sandbox;
  /** The owner's principal: activity is the experimenter's, never a product's. */
  readonly principal: Principal;
  /** Where the call came from, for the trace: "api", "http", "mcp", "cli" or "schedule". */
  readonly via: string;
}

/** A refusal or a mistake in an action's input. `code` follows the engine's error codes. */
export class ActivityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Throws an {@link ActivityError}. */
export function refuse(code: string, message: string): never {
  throw new ActivityError(code, message);
}

/** Calls an engine tool through the world lens: something arriving from outside the company. */
export function asWorld(env: ActivityEnv, tool: string, input: Record<string, unknown>): unknown {
  return unwrap(env.sandbox.world.session({role: 'world'}).call(tool, input));
}

/** Calls an engine tool as a customer, signed in: what they do on the shop's website. */
export function asCustomer(
  env: ActivityEnv,
  customerId: string,
  tool: string,
  input: Record<string, unknown>,
): unknown {
  return unwrap(
    env.sandbox.world.session({role: 'customer', customer_id: customerId}).call(tool, input),
  );
}

/** Calls an engine tool as a business role (a member of staff, the manager). */
export function asRole(
  env: ActivityEnv,
  role: string,
  tool: string,
  input: Record<string, unknown>,
): unknown {
  return unwrap(env.sandbox.world.session({role}).call(tool, input));
}

function unwrap(r: EngineResult): unknown {
  if (!r.ok) refuse(r.error.code, r.error.message);
  return r.data;
}

/**
 * Per-day hooks on a sandbox: run before and after each simulated day when time moves (infrastructure/server/
 * sandboxes.mjs). `afterActivity` runs after every action, so a deployed product answers a message as it arrives.
 * In memory only: whoever opens the sandbox adds them again.
 */
export interface SandboxHooks {
  beforeDay: ((sb: Sandbox) => Promise<void>)[];
  afterDay: ((sb: Sandbox) => Promise<void>)[];
  afterActivity: ((sb: Sandbox) => Promise<void>)[];
}

/** The sandbox's hooks, made on first use. */
export function hooksOf(sb: Sandbox): SandboxHooks {
  sb.hooks ??= {beforeDay: [], afterDay: [], afterActivity: []};
  const h = sb.hooks as Partial<SandboxHooks>;
  h.beforeDay ??= [];
  h.afterDay ??= [];
  h.afterActivity ??= [];
  return h as SandboxHooks;
}
