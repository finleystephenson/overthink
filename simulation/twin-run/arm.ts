/**
 * @fileoverview One arm of one seed: a fresh copy of the business, run day by day by the simulator (simulation/simulator/core.mjs).
 *
 * The two arms of a seed differ only in their tool client. Every kind of chance in the simulator comes from named
 * streams keyed by business facts (simulation/simulator/README.md, "What makes the comparison fair"), so both arms meet the same
 * customers, orders and delays, and any difference comes from the product.
 */
import {createSim} from '../simulator/core.mjs';
import type {ToolClient, Tracer} from '../simulator/core.d.mts';
import {headline} from '../simulator/report.mjs';
import {SandboxStore} from '../../infrastructure/server/sandboxes.mjs';
import type {Sandbox, TraceEntry} from '../../infrastructure/server/sandboxes.mjs';

/** Trace entries kept while a long run goes on (as simulation/simulator/run.mjs): only entries newer than the current call are read. */
const KEEP_TRACE = 2000;

/** What one arm produced. */
export interface ArmResult<C> {
  /** simulation/simulator/report.mjs headline(): money, customers, staff and the tool's counts. */
  figures: ReturnType<typeof headline>;
  client: C;
  /** Every call the product made through Overthink, in order (the sandbox trace is trimmed; this is not). */
  productTrace: TraceEntry[];
  /** Whatever `atEnd` returned. */
  saved: unknown;
}

/** Settings shared by both arms of a run. */
export interface ArmSettings {
  biz: Parameters<typeof createSim>[0]['biz'];
  size: string;
  days: number;
  role: string;
  /**
   * Simulator plug-ins both arms run (the audience plug-in for content, the supplier side for supplier mail). Made
   * fresh for each arm. Default none: the batch simulator drives the day itself.
   */
  plugins?: () => unknown[];
}

/** What an arm's client may add to the day: work that is not a simulator contact. */
export interface ArmHooks {
  /** Runs after each simulated day, before the next starts. */
  endOfDay?(date: string): Promise<void>;
  /** Decides how a prospect answers the product's outreach (simulation/simulator/core.mjs outreachJudge). */
  outreachJudge?: Parameters<typeof createSim>[0]['outreachJudge'];
  /** Runs once after the last day. */
  finish?(): Promise<void>;
}

/** Runs one arm. `makeClient` gets the fresh sandbox so tool calls land in its records. */
export async function runArm<C extends ToolClient & {afterDay?(): void}>(
  settings: ArmSettings,
  seed: number,
  makeClient: (store: SandboxStore, sandbox: Sandbox) => C,
  atEnd?: (sandbox: Sandbox, client: C, productTrace: readonly TraceEntry[]) => unknown,
  hooks?: (store: SandboxStore, sandbox: Sandbox) => ArmHooks,
): Promise<ArmResult<C>> {
  // One store per arm, with no live plug-ins: the batch simulator drives the day itself.
  const store = new SandboxStore({maxSandboxes: 1, plugins: []});
  const {sandbox} = store.create({size: settings.size, scenario: 'normal'});
  try {
    const client = makeClient(store, sandbox);
    // Plug-ins before hooks: a hook may use a plug-in made for this arm (the audience plug-in's plan).
    const plugins = settings.plugins?.() ?? [];
    const h = hooks?.(store, sandbox) ?? {};
    const sim = createSim({
      world: sandbox.world,
      biz: settings.biz,
      seed,
      popSeed: 1,
      role: settings.role,
      plugins,
      toolClient: client,
      outreachJudge: h.outreachJudge ?? null,
      tracer: traceReader(sandbox),
      // The rich customer model gives each customer hidden traits and a manner, which the briefs are built from.
      customerModel: 'rich',
    });
    const productTrace: TraceEntry[] = [];
    let copied = 0;
    for (let day = 0; day < settings.days; day++) {
      await sim.step();
      client.afterDay?.();
      // The day's date in the business, before the clock moves on: work for staff and the public happens on it.
      await h.endOfDay?.(sandbox.world.state.now.slice(0, 10));
      // WHY copy before trimming: `overthink view` marks every record the product touched, so none may be lost.
      for (const e of sandbox.trace)
        if (e.seq > copied && e.kind === 'tool' && e['via'] === 'overthink') productTrace.push(e);
      copied = sandbox.seq;
      if (sandbox.trace.length > KEEP_TRACE * 2)
        sandbox.trace.splice(0, sandbox.trace.length - KEEP_TRACE);
    }
    await h.finish?.();
    const figures = headline(sim.totals());
    const saved = atEnd?.(sandbox, client, productTrace) ?? null;
    return {figures, client, productTrace, saved};
  } finally {
    store.remove(sandbox.id);
  }
}

/** Reads the product's calls from the sandbox trace: its calls carry the work item's session id. */
function traceReader(sb: Sandbox): Tracer {
  return {
    mark: () => sb.seq,
    callsSince: (seq, session) =>
      sb.trace
        .filter((e) => e.seq > seq && e.kind === 'tool' && e.actor?.session === session)
        .map((e) => ({
          tool: String(e.tool),
          ok: e.ok === true,
          result: e['result'],
          ...(isCode(e['error']) ? {error: e['error']} : {}),
        })),
  };
}

function isCode(x: unknown): x is {code: string} {
  return typeof x === 'object' && x !== null && typeof (x as {code?: unknown}).code === 'string';
}
