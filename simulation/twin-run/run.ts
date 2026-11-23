/**
 * @fileoverview `overthink run`: the same business, with and without the product, over several seeds.
 *
 * For each seed the arm without the product runs first, then the arm with it. With a people model, the first arm
 * writes every customer's opening through the cache, so the second arm starts each conversation with the same words.
 */
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {loadBusiness} from '../simulator/data.mjs';
import {dataFor} from '../../infrastructure/server/world-data.mjs';
import type {LoadedAdapter} from '../../integrations/adapter/load.ts';
import {adapterLabel, openTransport} from '../../integrations/adapter/load.ts';
import type {Transport} from '../../integrations/adapter/transports.ts';
import {BudgetExceededError, createBudget} from '../../activity-generation/people/budget.ts';
import type {TokenTally} from '../../activity-generation/people/budget.ts';
import {openCache} from '../../activity-generation/people/cache.ts';
import type {CacheStats} from '../../activity-generation/people/cache.ts';
import type {ChatProvider} from '../../activity-generation/people/provider.ts';
import {modelVoice, rulesVoice} from '../../activity-generation/people/voice.ts';
import type {CustomerVoice} from '../../activity-generation/people/voice.ts';
import {planSituations} from '../../activity-generation/people/personas.ts';
import {deltaOf, slimTrace, stateHash, BUNDLE_VERSION} from '../../observability/view/bundle.ts';
import type {ArmWorld, SeedBundle} from '../../observability/view/bundle.ts';
import {actionMarks} from '../../observability/view/marks.ts';
import {writeConversations} from '../../observability/view/materialise.ts';
import type {ConversationState} from '../../observability/view/materialise.ts';
import type {Sandbox, TraceEntry} from '../../infrastructure/server/sandboxes.mjs';
import {runArm} from './arm.ts';
import type {ArmResult} from './arm.ts';
import {makeCast, planKey} from './cast.ts';
import type {StartRecords} from './cast.ts';
import {collectorClient, observerClient, productClient} from './client.ts';
import type {RecordingClient} from './client.ts';
import {jobFor} from './jobs.ts';
import {audiencePlugin} from '../simulator/audience.mjs';
import type {AudiencePlugin, AudienceRates} from '../simulator/audience.d.mts';
import {worldPlugins} from '../world/plugins.mjs';
import {NO_LIVE} from '../../observability/live/events.ts';
import type {LiveEmitter} from '../../observability/live/events.ts';
import {audiencesOf, staffMembers} from '../../activity-generation/people/audiences.ts';
import type {AudienceKind} from '../../activity-generation/people/audiences.ts';
import {audienceWork, workloadOf} from './audience-work.ts';
import type {AudienceReport} from './audience-work.ts';

/** The version of Overthink, recorded with every result. */
export const OVERTHINK_VERSION = '0.1.0';

/** Everything `overthink run` takes. */
export interface RunOptions {
  adapter: LoadedAdapter;
  days: number;
  runs: number;
  size: 'demo' | 'standard';
  job: string;
  firstSeed: number;
  /** The people model; null plays customers by rules. */
  provider: ChatProvider | null;
  /** Where cached people-model answers live; null keeps them in memory only. */
  cacheDir: string | null;
  /** Total people-model tokens allowed; null for no cap. */
  tokenCap: number | null;
  /**
   * Plan situations (hard and security cases) over the run, at the rates in business/data/overthink/situations.json.
   * Default true; false gives every customer the plain situation (used by tests that need the old behaviour).
   */
  personas?: boolean;
  /** Live events (docs/live-events.md); none by default. */
  live?: LiveEmitter;
  /** With `--compare`: which product this run is ("A" or "B"). */
  variant?: string | null;
  /** Panel size for content the product publishes (activity-generation/people/panel.ts). */
  panelSize?: number;
  /** Opens the product's transport. Tests pass their own; normally from the adapter. */
  openTransport?: () => Transport;
  log?: (line: string) => void;
}

/** One seed: both arms, and what `overthink view` needs to open them. */
export interface SeedRun {
  seed: number;
  without: ArmResult<RecordingClient>;
  with: ArmResult<RecordingClient>;
  bundle: SeedBundle;
  /** What staff, the public, buyers and suppliers did in the arm with the product. */
  audience: AudienceReport;
}

/** What a run produced, before it is summarised. */
export interface RawRun {
  options: Omit<
    RunOptions,
    'adapter' | 'provider' | 'openTransport' | 'log' | 'personas' | 'live' | 'variant' | 'panelSize'
  > & {
    adapter: string;
    transport: string;
    /** The channels the product was deployed on; null for every channel. */
    channels: string[] | null;
    /** Who the product was pointed at. */
    audience: AudienceKind[];
    /** What the product could read and act on (simulation/lab/scope.mjs); null is its role's own permissions. */
    scope: {read: string[]; act: string[]} | null;
  };
  reproducibility: {
    seeds: number[];
    pop_seed: number;
    world_hash: string;
    people_model: string;
    people_endpoint: string | null;
    adapter_version: string;
    overthink_version: string;
    node: string;
    started_at: string;
  };
  seeds: SeedRun[];
  /** Why the run stopped early, if it did. */
  stopped: string | null;
  tokens: TokenTally & {cap: number | null};
  cache: CacheStats;
  seconds: number;
}

/** Runs the twin experiment. Never throws for a budget stop: it returns the seeds it finished. */
export async function runOverthink(o: RunOptions): Promise<RawRun> {
  const log = o.log ?? (() => undefined);
  const job = jobFor(o.job);
  const started = Date.now();
  const budget = createBudget(o.tokenCap);
  const cache = openCache(o.cacheDir);
  const voice: CustomerVoice =
    o.provider === null ? rulesVoice() : modelVoice({provider: o.provider, cache, budget});
  const transport = (o.openTransport ?? (() => openTransport(o.adapter)))();
  const biz = loadBusiness();
  const audiences = audiencesOf(o.adapter.config);
  const live = (o.live ?? NO_LIVE).scoped({variant: o.variant ?? null});
  const rates = (biz['audience'] ?? null) as AudienceRates | null;
  const products = (dataFor(o.size) as {products?: unknown[]}).products ?? [];
  // WHY plug-ins only for the audiences that need them: every other run stays exactly the simulator it was.
  let plugin: AudiencePlugin | null = null;
  const plugins = (): unknown[] => {
    const out: unknown[] = [];
    if (audiences.includes('suppliers'))
      out.push(
        ...worldPlugins({products}).filter(
          (p) => p.name === 'world-suppliers' || p.name === 'world-supplier-side',
        ),
      );
    if (audiences.includes('public') && rates !== null) {
      plugin = audiencePlugin({rates, products});
      out.push(plugin);
    }
    return out;
  };
  const settings = {biz, size: o.size, days: o.days, role: job.role, plugins};
  const staff = audiences.includes('staff') ? staffMembers() : [];
  const demand = ((biz.sim as {demand?: unknown}).demand ?? null) as {
    base_orders_per_day: number;
    product_weights: Record<string, number>;
  } | null;
  const model = o.provider === null ? null : {provider: o.provider, cache, budget};
  const population =
    (biz.sim as {customer_model?: {population?: unknown}}).customer_model?.population ?? null;
  const channels = o.adapter.config.channels ?? null;
  const seedList = Array.from({length: o.runs}, (_, i) => o.firstSeed + i);
  const plan = o.personas === false ? null : await planRun(settings, seedList);
  const seeds: SeedRun[] = [];
  let stopped: string | null = null;
  try {
    for (const [i, seed] of seedList.entries()) {
      const t0 = Date.now();
      let start: StartRecords | null = null;
      const castFor = (sandbox: Sandbox): ReturnType<typeof makeCast> => {
        start ??= JSON.parse(sandbox.start.state) as StartRecords;
        return makeCast({seed, plan, population, start});
      };
      let workload = new Map<string, number>();
      // A holder, not a plain variable: the arm's hooks fill it in, which the type checker cannot see.
      const audience: {report: AudienceReport | null} = {report: null};
      const dayEvents =
        (arm: 'with' | 'without') => (): {endOfDay(date: string): Promise<void>} => ({
          endOfDay: (date) => {
            live.emit({type: 'day.ended', arm, seed, summary: `Day ${date} ended`, data: {date}});
            return Promise.resolve();
          },
        });
      try {
        live.emit({
          type: 'arm.started',
          arm: 'without',
          seed,
          summary: `Seed ${seed}: the business without the product`,
        });
        const without = await runArm(
          settings,
          seed,
          (_store, sandbox) => observerClient({sandbox, voice, cast: castFor(sandbox)}),
          (sandbox, client) => {
            workload = workloadOf(sandbox.world.state, staff);
            return keepWorld(sandbox, client, [], {withProduct: false, role: job.role});
          },
          dayEvents('without'),
        );
        armFinished(live, 'without', seed, without.figures);
        live.emit({
          type: 'arm.started',
          arm: 'with',
          seed,
          summary: `Seed ${seed}: the business with the product`,
        });
        const withLive = live.scoped({arm: 'with', seed});
        const withProduct = await runArm(
          settings,
          seed,
          (store, sandbox) =>
            productClient({
              store,
              sandbox,
              transport,
              voice,
              job,
              scope: o.adapter.config.scope ?? null,
              cast: castFor(sandbox),
              channels,
              live: withLive,
              ...maxSteps(o.adapter),
            }),
          (sandbox, client, trace) =>
            keepWorld(sandbox, client, trace, {withProduct: true, role: job.role}),
          (store, sandbox) => {
            const work = audienceWork({
              store,
              sandbox,
              transport,
              job,
              scope: o.adapter.config.scope ?? null,
              channels,
              model,
              seed,
              staff,
              workload,
              plugin,
              rates,
              demand,
              live: withLive,
              audiences,
              ...(o.panelSize !== undefined ? {panelSize: o.panelSize} : {}),
              ...maxSteps(o.adapter),
            });
            audience.report = work.report;
            const ends = dayEvents('with')();
            return {
              outreachJudge: work.outreachJudge,
              finish: () => work.finish(),
              endOfDay: async (date) => {
                await work.endOfDay(date);
                await ends.endOfDay(date);
              },
            };
          },
        );
        armFinished(live, 'with', seed, withProduct.figures);
        const w = withProduct.saved as KeptWorld;
        const wo = without.saved as KeptWorld;
        seeds.push({
          seed,
          without,
          with: withProduct,
          bundle: {
            version: BUNDLE_VERSION,
            seed,
            size: o.size,
            start_hash: w.startHash,
            now: w.now,
            with: w.arm,
            without: wo.arm,
            trace: slimTrace(withProduct.productTrace),
          },
          audience: audience.report ?? emptyAudience(),
        });
      } catch (e) {
        if (!(e instanceof BudgetExceededError)) throw e;
        stopped = `${e.message} after ${seeds.length} of ${o.runs} runs`;
        live.emit({type: 'run.stopped', summary: `Stopped: ${stopped}`, data: {why: stopped}});
        log(`stopped: ${stopped}`);
        break;
      }
      log(
        `run ${i + 1}/${o.runs} (seed ${seed}) done in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
    }
  } finally {
    await transport.close();
  }
  return {
    options: {
      days: o.days,
      runs: o.runs,
      size: o.size,
      job: o.job,
      firstSeed: o.firstSeed,
      cacheDir: o.cacheDir,
      tokenCap: o.tokenCap,
      adapter: adapterLabel(o.adapter),
      transport: o.adapter.config.transport,
      channels,
      audience: audiences,
      scope: o.adapter.config.scope ?? null,
    },
    reproducibility: {
      seeds: seeds.map((s) => s.seed),
      pop_seed: 1,
      world_hash: worldHash(o.size),
      people_model: voice.model,
      people_endpoint: o.provider?.endpoint ?? null,
      adapter_version: o.adapter.config.version ?? 'unversioned',
      overthink_version: OVERTHINK_VERSION,
      node: process.version,
      started_at: new Date(started).toISOString(),
    },
    seeds,
    stopped,
    tokens: {...budget.tally, cap: o.tokenCap},
    cache: {...cache.stats},
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
}

/** What an arm keeps for `overthink view`. */
interface KeptWorld {
  arm: ArmWorld;
  startHash: string;
  now: string;
}

/** Writes the arm's conversations into its records, then keeps what changed since the start, with the marks. */
function keepWorld(
  sandbox: Sandbox,
  client: RecordingClient,
  trace: readonly TraceEntry[],
  o: {withProduct: boolean; role: string},
): KeptWorld {
  const state = sandbox.world.state as unknown as ConversationState;
  const messages = writeConversations(state, client.transcripts, o);
  return {
    arm: {
      changed: deltaOf(JSON.parse(sandbox.start.state) as Record<string, unknown>, state),
      marks: [...actionMarks(trace), ...messages],
    },
    startHash: stateHash(sandbox.start.state),
    now: sandbox.world.state.now,
  };
}

/**
 * The planning pass: each seed's arm without the product, played with nobody answering for the product, only to list
 * the contacts the run will raise. Situations are then allocated over all of them (activity-generation/people/personas.ts).
 * WHY a separate pass: it costs one plain simulation per seed (well under a second) and no model calls, and it is
 * what lets a run of about a hundred contacts hold every one-in-a-hundred situation exactly as often as it should.
 */
async function planRun(
  settings: Parameters<typeof runArm>[0],
  seeds: readonly number[],
): Promise<Map<string, string>> {
  const all: {key: string; topic: string; channel: string}[] = [];
  for (const seed of seeds) {
    const arm = await runArm(settings, seed, () => collectorClient());
    for (const c of arm.client.contacts) all.push({...c, key: planKey(seed, c.key)});
  }
  return planSituations(all);
}

/** A short hash of the world files, so a result names the exact world it ran on. */
export function worldHash(size: string): string {
  return createHash('sha256')
    .update(JSON.stringify(dataFor(size)))
    .digest('hex')
    .slice(0, 16);
}

/** The default cache folder: `.overthink/cache` in the current folder. */
export function defaultCacheDir(cwd = process.cwd()): string {
  return path.join(cwd, '.overthink', 'cache');
}

/** Makes sure an output folder exists and returns its absolute path. */
export function prepareOut(dir: string): string {
  const abs = path.resolve(dir);
  fs.mkdirSync(abs, {recursive: true});
  return abs;
}

function maxSteps(a: LoadedAdapter): {maxSteps?: number} {
  return a.config.maxSteps !== undefined ? {maxSteps: a.config.maxSteps} : {};
}

function emptyAudience(): AudienceReport {
  return {published: [], staffUses: [], staffFeedback: [], buyers: [], suppliers: []};
}

function armFinished(
  live: LiveEmitter,
  arm: 'with' | 'without',
  seed: number,
  f: ArmResult<RecordingClient>['figures'],
): void {
  const fig = f as unknown as Record<string, unknown>;
  const pick = (k: string): number | null => (typeof fig[k] === 'number' ? fig[k] : null);
  live.emit({
    type: 'arm.finished',
    arm,
    seed,
    summary: `Seed ${seed} ${arm} the product: net profit £${String(pick('net_profit') ?? '?')}`,
    data: {
      figures: {
        net_profit: pick('net_profit'),
        revenue: pick('revenue'),
        orders: pick('orders'),
        customer_satisfaction: pick('customer_satisfaction'),
      },
    },
  });
}
