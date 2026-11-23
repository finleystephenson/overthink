// Types for the parts of infrastructure/server/sandboxes.mjs that the TypeScript code uses.

export interface EngineToolInfo {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  roles: string[];
}

/** One engine session: calls run with its role (and, for a customer, as that customer). */
export interface EngineSession {
  call(tool: string, input: unknown): EngineResult;
}

export interface EngineWorld {
  business: {name?: string; [k: string]: unknown};
  session(o: {role: string; customer_id?: string | null}): EngineSession;
  tools: EngineToolInfo[];
  index: {skus: Record<string, {product: {name: string}} | undefined>};
  state: {
    now: string;
    orders: {number: string; customer_id: string; status: string; delivery: {address: {postcode: string}}}[];
    customers: {id: string; name: string}[];
    contacts: {id: string; at: string; customer_id: string | null; topic: string; outcome: string; handled_by: string | null; first_reply_minutes: number | null; resolve_minutes: number | null; order: string | null}[];
    [k: string]: unknown;
  };
}

export interface TraceEntry {
  seq: number;
  kind: string;
  tool?: string;
  ok?: boolean;
  actor?: {token?: string; role?: string; session?: string};
  [k: string]: unknown;
}

export interface Principal {
  id: string;
  role: string | null;
  owner?: boolean;
}

export interface Sandbox {
  id: string;
  size: string;
  seq: number;
  /** The starting state as JSON (for reset and diff). */
  start: {state: string; inbox: string};
  /** The server's inbox of customer messages (infrastructure/server/inbox.mjs). */
  inbox: {seq: number; messages: Record<string, unknown>[]};
  world: EngineWorld;
  trace: TraceEntry[];
  tokens: Principal[];
  seed?: number;
  /** Per-day and per-action hooks (activity-generation/env.ts SandboxHooks). In memory only, never saved. */
  hooks?: object;
}

export type EngineResult = {ok: true; data: unknown} | {ok: false; error: {code: string; message: string}};

export class SandboxStore {
  constructor(o?: {maxSandboxes?: number; idleMs?: number; plugins?: unknown[] | null; persistDir?: string | null});
  readonly sandboxes: Map<string, Sandbox>;
  create(o?: {size?: string; scenario?: string; seed?: number}): {sandbox: Sandbox; token: string};
  mintRoleToken(sb: Sandbox, o: {role: string; label?: string | null}): {token: string; id: string; role: string};
  call(sb: Sandbox, principal: Principal, actor: {role: string; session: string; via: string}, tool: string, input: unknown): EngineResult;
  record(sb: Sandbox, entry: Record<string, unknown>): void;
  remove(id: string): void;
  reset(sb: Sandbox): void;
  advance(sb: Sandbox, principal: Principal, days: number, via?: string): Promise<{now: string; days: {summary: Record<string, unknown>}[]}>;
  impact(sb: Sandbox): Promise<Record<string, unknown>>;
  diff(sb: Sandbox): Record<string, unknown>;
  simClock(sb: Sandbox): {now: string; date: string; day: number; seed: number; started: boolean};
  authenticate(token: string): {sandbox: Sandbox; principal: Principal} | null;
  describe(sb: Sandbox): Record<string, unknown>;
}
