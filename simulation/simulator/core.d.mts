// Types for the parts of simulation/simulator/core.mjs that the TypeScript code uses. Hand-written until core.mjs moves to TypeScript.

/** One message for the tool under test, in the simulator's own tool protocol (simulation/simulator/README.md). */
export interface ToolPayload {
  protocol: 1;
  session_id: string;
  turn: number;
  message: string;
  channel: string;
  role: string;
  system_prompt: string;
  sim: {kind: 'contact' | 'alerts' | 'prospects' | string; day: number; date: string; data?: unknown};
}

/** A customer in the simulated population. Only `name` and `id` are always present. */
export interface SimCustomer {
  id?: string | null;
  name: string;
  email?: string;
  kind?: string;
  /** How they were treated lately (negative is badly). */
  s?: number;
  /** Hidden traits (rich customer model only). */
  t?: {price: number; patience: number; public: boolean; leave: number};
  /** Manner of writing (rich customer model only). */
  m?: {vague: boolean; omits: boolean; tone: string};
  memo?: {order: string | null; bad: boolean; text: string} | null;
}

/** One customer contact as the simulator holds it while it is being handled. */
export interface ContactItem {
  id: string;
  key: string;
  topic: string;
  cid: string | null;
  name: string;
  channel: string;
  order: string | null;
  postcode: string | null;
  sku?: string;
  text: string;
  at?: string;
  /** The contact record's id in world.state.contacts (written before the tool is called). */
  contactId?: string;
  customer: SimCustomer;
  rec?: {o: {number: string; items: {sku: string; name?: string; qty: number}[]; totals: {total: number}}} | null;
  repeat: boolean;
}

/** What the simulator passes beside the payload (second argument of ToolClient.call). */
export interface ToolCallContext {
  item: ContactItem | null;
}

export interface ToolClient {
  call(payload: ToolPayload, context?: ToolCallContext): Promise<{reply?: string; error?: string}>;
  close?(): Promise<void>;
}

export interface Tracer {
  mark(): number;
  callsSince(seq: number, session: string): {tool: string; ok: boolean; result?: unknown; error?: {code: string}}[];
}

export interface SimRunResult {
  totals: Record<string, number>;
  first_response_median_minutes: number | null;
  first_response_p90_minutes: number | null;
  reputation: number;
  days_run: number;
  survival: {opening_cash: number; cash_now: number; lowest_cash: number; ran_out_of_cash: boolean};
}

export interface Sim {
  step(): Promise<Record<string, unknown>>;
  totals(): SimRunResult;
  readonly scale: number;
}

export function createSim(o: {
  world: unknown;
  biz: unknown;
  seed: number;
  popSeed?: number;
  role?: string;
  plugins?: unknown[];
  toolClient?: ToolClient | null;
  tracer?: Tracer | null;
  toolEnv?: Record<string, unknown>;
  customerModel?: 'classic' | 'rich';
  /** Decides how a prospect answers the tool's outreach; null keeps the simulator's rules for that one. */
  outreachJudge?: ((x: OutreachJudgeInput) => Promise<OutreachVerdict | null>) | null;
  warmup?: number;
}): Sim;

/** What the outreach judge is given: the outreach record and the prospect as the engine holds them. */
export interface OutreachJudgeInput {
  outreach: {id: string; at: string; prospect_id: string; channel: string; message: string; offer: {items: {sku: string; qty: number}[]; discount_percent: number} | null};
  prospect: {id: string; name: string; sector: string; staff: number; status: string; monthly_budget: number; budget_band: string; preferred_channel: string; needs: {product: string; sku: string; qty: number; every: string; unit_price: number}[]; decision_maker: {name: string; email: string}; private: {reply_propensity: number}};
  /** The rules' own quality score for the message (simulation/simulator/judge.mjs outreachQuality), 0 to 1. */
  quality: number;
  /** How many times this prospect has now been contacted. */
  contactN: number;
  day: number;
  won: boolean;
}

/** How the prospect answers. `replies` with `buy` makes them a customer; `decline` stops further contact. */
export interface OutreachVerdict {
  replies: boolean;
  buy: boolean;
  decline: boolean;
}
