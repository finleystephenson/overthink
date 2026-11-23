#!/usr/bin/env node
/**
 * @fileoverview The `overthink` command.
 *
 *   overthink up    [--port 4747] [--size demo|standard] [--adapter <file|url>] [--open]   a live sandbox for an agent
 *   overthink act   <action> [--field value ...]                       create activity in it (overthink act --help)
 *   overthink init  [--url <address> | --command "<cmd>"] [--channels web_chat,email] [--name ..] [--yes] [--no-run]
 *   overthink check --adapter <file|url> [--job customer-service]
 *   overthink run   --adapter <file|url> [--days 30] [--runs 10] [--size demo|standard] [--job customer-service]
 *                   [--channels web_chat,email] [--out overthink-report] [--first-seed 1] [--max-tokens 2000000]
 *                   [--no-cache] [--rules]
 *   overthink view  [--run overthink-report] [--port 8740] [--json <record id>] [--seed N] [--arm with|without]
 *   overthink run   --compare <adapterA> <adapterB> [same flags]     two products, versions or access levels, paired
 *   overthink reset [--out overthink-report] [--yes]                  wipes this project's runs, cache and worlds
 *
 * People are voiced by the model in OVERTHINK_BASE_URL / OVERTHINK_API_KEY / OVERTHINK_MODEL (see AGENTS.md). Without
 * one, `run` stops and says how to set one; `--rules` runs with rule-played people instead, labelled as weaker.
 * See docs/run.md.
 */
import path from 'node:path';
import {parseArgs} from 'node:util';
import {ensureWorlds} from './ensure-world.mjs';
import {checkChannels} from '../integrations/adapter/channels.ts';
import {checkAdapter} from '../integrations/adapter/check.ts';
import {adapterLabel, loadAdapter, openTransport} from '../integrations/adapter/load.ts';
import type {LoadedAdapter} from '../integrations/adapter/load.ts';
import {gatherAnswers, terminalAsk, writeAdapter} from '../integrations/init/init.ts';
import type {InitAnswers} from '../integrations/init/init.ts';
import {providerFromEnv} from '../activity-generation/people/provider.ts';
import {jobFor} from '../simulation/twin-run/jobs.ts';
import {defaultCacheDir, runOverthink} from '../simulation/twin-run/run.ts';
import {VIEW_PORT, buildResults} from '../observability/report/results.ts';
import {summaryMarkdown} from '../observability/report/summary.ts';
import {writeReport} from '../observability/report/write.ts';
import {findRecord, openRun, startViewServer} from '../observability/view/server.ts';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {ACCESS_NAMES} from '../integrations/adapter/access.ts';
import {openLiveStream} from '../observability/live/events.ts';
import type {LiveStream} from '../observability/live/events.ts';
import {LIVE_PORT, startLiveServer} from '../observability/live/server.ts';
import {
  audiencesOf,
  channelsOf,
  checkAudience,
  jobOf,
} from '../activity-generation/people/audiences.ts';
import {DEFAULT_PANEL_SIZE} from '../activity-generation/people/panel.ts';
import {compareMarkdown, runCompare} from '../simulation/twin-run/compare.ts';
import {act} from '../activity-generation/cli.ts';
import {ActivityClient} from '../activity-generation/api.ts';
import {readSession} from '../infrastructure/session.ts';
import {UP_PORT, up} from './up.ts';

const USAGE = `Usage:
  overthink up    [--port ${UP_PORT}] [--size demo|standard] [--adapter <file|url>] [--job customer-service] [--open]
  overthink act   <action> [--field value ...]      (overthink act --help lists every action)
  overthink init  [--url <address> | --command "<cmd>"] [--audience customers] [--channels web_chat,email]
                  [--name <name>] [--version <v>] [--yes] [--no-run] [--force] [--live] [--open]
  overthink check --adapter <file|url> [--job customer-service]
  overthink run   --adapter <file|url> [--days 30] [--runs 10] [--size demo|standard]
                  [--job customer-service|operations|sales] [--channels web_chat,email,phone,text]
                  [--out overthink-report] [--first-seed 1] [--max-tokens 2000000] [--no-cache] [--rules]
  overthink view  [--run overthink-report] [--port ${VIEW_PORT}] [--json <record id>] [--seed N] [--arm with|without]
  overthink reset [--out overthink-report] [--yes]

  run also takes: [--audience customers|staff|businesses|suppliers|public] [--access ${ACCESS_NAMES.join('|')}]
                  [--panel ${DEFAULT_PANEL_SIZE}] [--live] [--live-port ${LIVE_PORT}] [--open]
                  [--compare <adapterA> <adapterB>]   (an adapter may be file.ts#exportName@access_level)`;

/** The default token cap for the people model: enough for a default run on a small model, and a firm stop. */
const DEFAULT_MAX_TOKENS = 2_000_000;

/** Shown when a run has no people model. */
const NEED_MODEL = `Overthink needs a model to voice the customers. Any OpenAI-compatible endpoint works, a local one too:

  export OVERTHINK_BASE_URL=http://localhost:11434/v1   # Ollama (LM Studio: http://localhost:1234/v1)
  export OVERTHINK_API_KEY=ollama                       # any text for a local server
  export OVERTHINK_MODEL=llama3.2

Or the Anthropic API: OVERTHINK_PROVIDER=anthropic, OVERTHINK_MODEL and OVERTHINK_API_KEY.
To run without a model, add --rules: customers are then played by scripted rules. That is free and fast, but
weaker: scripted people do not improvise, so the product meets fewer surprises. The report says which was used.`;

/** The flags of `overthink run`. */
interface RunFlags {
  days: string;
  runs: string;
  size: 'demo' | 'standard';
  job: string;
  out: string;
  'first-seed': string;
  'max-tokens': string;
  'no-cache': boolean;
  rules: boolean;
  /** Empty: the audiences decide the job. */
  job_given?: boolean;
  live?: boolean;
  'live-port'?: string;
  panel?: string;
  open?: boolean;
}

async function main(argv: string[]): Promise<number> {
  // WHY before parseArgs: `act` takes each action's own fields, which a fixed list of options cannot know.
  if (argv[0] === 'act') return act(argv.slice(1));
  if (argv[0] === 'up') return upCommand(argv.slice(1));
  const {values: v, positionals} = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      adapter: {type: 'string'},
      days: {type: 'string', default: '30'},
      runs: {type: 'string', default: '10'},
      size: {type: 'string', default: 'demo'},
      job: {type: 'string'},
      audience: {type: 'string'},
      access: {type: 'string'},
      compare: {type: 'boolean', default: false},
      live: {type: 'boolean', default: false},
      'live-port': {type: 'string', default: String(LIVE_PORT)},
      panel: {type: 'string', default: String(DEFAULT_PANEL_SIZE)},
      open: {type: 'boolean', default: false},
      channels: {type: 'string'},
      out: {type: 'string', default: 'overthink-report'},
      'first-seed': {type: 'string', default: '1'},
      'max-tokens': {type: 'string', default: String(DEFAULT_MAX_TOKENS)},
      'no-cache': {type: 'boolean', default: false},
      rules: {type: 'boolean', default: false},
      run: {type: 'string', default: 'overthink-report'},
      port: {type: 'string', default: String(VIEW_PORT)},
      json: {type: 'string'},
      seed: {type: 'string'},
      arm: {type: 'string', default: 'with'},
      url: {type: 'string'},
      command: {type: 'string'},
      model: {type: 'string'},
      name: {type: 'string'},
      version: {type: 'string'},
      yes: {type: 'boolean', short: 'y', default: false},
      'no-run': {type: 'boolean', default: false},
      force: {type: 'boolean', default: false},
      help: {type: 'boolean', short: 'h', default: false},
    },
  });
  const command = positionals[0];
  if (v.help || !['run', 'check', 'view', 'init', 'reset'].includes(command ?? '')) {
    console.log(USAGE);
    return v.help ? 0 : 2;
  }
  if (command === 'view') return view(v);
  if (command === 'init') return init(v);
  if (command === 'reset') return reset(v.out, v.yes);
  const size = sizeOf(v.size);
  buildWorld(size);
  const configure = async (spec: string): Promise<LoadedAdapter> => {
    const a = await loadAdapter(v.access !== undefined ? `${spec}@${v.access}` : spec);
    if (v.audience !== undefined) a.config.audience = checkAudience(v.audience.split(',')) ?? [];
    if (v.channels !== undefined) a.config.channels = checkChannels(v.channels.split(','));
    else if (v.audience !== undefined) a.config.channels = channelsOf(a.config.audience ?? []);
    return a;
  };
  const flags = {...v, size, job: v.job ?? '', job_given: v.job !== undefined};
  if (command === 'run' && v.compare) {
    const [a, b] = [positionals[1], positionals[2]];
    if (a === undefined || b === undefined)
      throw new Error(
        '--compare needs two adapters: overthink run --compare <adapterA> <adapterB>.',
      );
    return compare(await configure(a), await configure(b), flags);
  }
  if (v.adapter === undefined) throw new Error('Say which product to test: --adapter <file|url>.');
  const adapter = await configure(v.adapter);
  if (command === 'check') return (await check(adapter, jobName(adapter, flags), true)) ? 0 : 1;
  return run(adapter, flags);
}

/** The job: `--job` if given, else the one the adapter's audiences need. */
function jobName(a: LoadedAdapter, v: {job: string; job_given?: boolean}): string {
  return v.job_given === true && v.job !== '' ? v.job : jobOf(audiencesOf(a.config));
}

/** Opens the live stream (and its server with --live) for a run writing into `out`. */
async function openLive(
  out: string,
  v: {live?: boolean; 'live-port'?: string; open?: boolean},
): Promise<{stream: LiveStream; close(): Promise<void>; keepOpen: boolean}> {
  const stream = openLiveStream({file: path.join(path.resolve(out), 'live.jsonl')});
  if (v.live !== true)
    return {
      stream,
      close: () => {
        stream.close();
        return Promise.resolve();
      },
      keepOpen: false,
    };
  const server = await startLiveServer(
    stream,
    positiveInt(v['live-port'] ?? String(LIVE_PORT), '--live-port'),
  );
  console.error(`Watch it in Rummage, the company's search: ${server.url}/`);
  console.error(
    `Live: ${server.url}/ (the front door), events at ${server.url}/live/events (docs/live-events.md)`,
  );
  if (v.open === true) openBrowser(`${server.url}/`);
  return {
    stream,
    keepOpen: true,
    close: async () => {
      stream.close();
      await server.close();
    },
  };
}

/** Opens a page in the default browser, if there is one. Never fails the run. */
function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, {stdio: 'ignore', detached: true})
      .on('error', () => undefined)
      .unref();
  } catch {
    // No browser here (a server, a container): the URL is printed anyway.
  }
}

/** `overthink up`: a live sandbox, optionally with the product deployed on its channels. */
async function upCommand(argv: string[]): Promise<number> {
  const {values: v} = parseArgs({
    args: argv,
    options: {
      port: {type: 'string', default: String(UP_PORT)},
      size: {type: 'string', default: 'demo'},
      adapter: {type: 'string'},
      job: {type: 'string'},
      channels: {type: 'string'},
      access: {type: 'string'},
      open: {type: 'boolean', default: false},
    },
  });
  const size = sizeOf(v.size);
  buildWorld(size);
  let adapter: LoadedAdapter | null = null;
  if (v.adapter !== undefined) {
    adapter = await loadAdapter(v.access !== undefined ? `${v.adapter}@${v.access}` : v.adapter);
    if (v.channels !== undefined) adapter.config.channels = checkChannels(v.channels.split(','));
  }
  return up({
    port: positiveInt(v.port, '--port'),
    size,
    adapter,
    job: v.job ?? (adapter === null ? 'customer-service' : jobOf(audiencesOf(adapter.config))),
    onReady: (url) => {
      if (v.open) openBrowser(url);
    },
  });
}

/** `overthink reset`: puts a running sandbox back to its start, and deletes this project's runs, cache and saved worlds. */
async function reset(out: string, yes: boolean): Promise<number> {
  const session = readSession();
  if (session !== null) {
    const r = await new ActivityClient(session).perform('reset');
    console.log(
      r.ok
        ? `The sandbox at ${session.url} is back to its start.`
        : `The running sandbox was not reset: ${r.error.message}`,
    );
  }
  // The session file stays while its sandbox runs, so `overthink act` keeps working after a reset.
  const keep = session === null ? [] : [path.resolve('.overthink', 'sandbox.json')];
  const targets = [
    ...(fs.existsSync(path.resolve('.overthink'))
      ? fs
          .readdirSync(path.resolve('.overthink'))
          .map((f) => path.resolve('.overthink', f))
          .filter((f) => !keep.includes(f))
      : []),
    path.resolve(out),
  ].filter((p) => fs.existsSync(p));
  if (targets.length === 0) {
    console.log(
      session === null
        ? 'Nothing to reset: no .overthink folder or run folder here.'
        : 'No runs or cache to delete.',
    );
    return 0;
  }
  console.log(`This deletes:\n${targets.map((t) => `  ${t}`).join('\n')}`);
  if (!yes) {
    if (!process.stdin.isTTY) {
      console.error('Add --yes to confirm (no terminal to ask on).');
      return 2;
    }
    const term = terminalAsk();
    const answer = (await term.ask('Delete them? [y/N] ')).trim().toLowerCase();
    term.close();
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Nothing deleted.');
      return 1;
    }
  }
  for (const t of targets) fs.rmSync(t, {recursive: true, force: true});
  console.log('Reset: the next run starts from a fresh business, with no cached people.');
  return 0;
}

/** `overthink run --compare`: both variants on the same seeds and people. */
async function compare(a: LoadedAdapter, b: LoadedAdapter, v: RunFlags): Promise<number> {
  const job = jobName(a, v);
  if (job !== jobName(b, v))
    throw new Error('The two variants need the same job: give --job, or the same audience.');
  const provider = providerFromEnv();
  if (provider === null && !v.rules) {
    console.error(NEED_MODEL);
    return 2;
  }
  for (const x of [a, b])
    if (!(await check(x, job, false))) {
      console.error(`${adapterLabel(x)} did not pass its check, so nothing was run.`);
      return 1;
    }
  const out = path.resolve(v.out);
  const live = await openLive(out, v);
  live.stream.emit({
    type: 'run.started',
    summary: `Comparing ${adapterLabel(a)} with ${adapterLabel(b)}`,
    data: {
      variants: [a, b].map((x, i) => ({
        id: i === 0 ? 'A' : 'B',
        adapter: adapterLabel(x),
        access: x.config.access ?? null,
      })),
      days: v.days,
      size: v.size,
      job,
    },
  });
  const {
    compare: c,
    raws,
    results,
  } = await runCompare(a, b, {
    days: positiveInt(v.days, '--days'),
    runs: positiveInt(v.runs, '--runs'),
    size: v.size,
    job,
    firstSeed: positiveInt(v['first-seed'], '--first-seed'),
    provider,
    cacheDir: v['no-cache'] ? null : defaultCacheDir(),
    tokenCap: positiveInt(v['max-tokens'], '--max-tokens'),
    panelSize: positiveInt(v.panel ?? String(DEFAULT_PANEL_SIZE), '--panel'),
    live: live.stream,
    log: (l) => {
      console.error(l);
    },
  });
  for (const [i, id] of (['A', 'B'] as const).entries())
    writeReport(
      path.join(out, id),
      results[i] as (typeof results)[number],
      (raws[i] as (typeof raws)[number]).seeds.map((s) => s.bundle),
    );
  fs.writeFileSync(path.join(out, 'compare.json'), JSON.stringify(c, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'compare.md'), compareMarkdown(c));
  live.stream.emit({
    type: 'run.finished',
    summary: 'Compare finished',
    data: {results: path.join(out, 'compare.json'), headline: null},
  });
  console.log(compareMarkdown(c));
  console.log(
    `Wrote ${path.join(out, 'compare.json')}, compare.md, and each variant's report in A/ and B/.`,
  );
  if (!live.keepOpen) await live.close();
  return 0;
}

/** `overthink check`: one turn, printed. Returns whether it passed. */
async function check(adapter: LoadedAdapter, jobName: string, print: boolean): Promise<boolean> {
  const job = jobFor(jobName);
  const transport = openTransport(adapter);
  try {
    const r = await checkAdapter({
      transport,
      role: job.role,
      instructions: job.instructions,
      scope: adapter.config.scope ?? null,
    });
    if (print || !r.ok) {
      console.log(`Adapter: ${adapterLabel(adapter)} (${adapter.config.transport})`);
      console.log(`Deployed on: ${adapter.config.channels?.join(', ') ?? 'every channel'}`);
      console.log(`Sent: ${r.message}`);
      console.log(`Tools offered: ${r.toolsOffered} (role ${job.role})`);
      for (const c of r.calls)
        console.log(
          `  ${c.ok ? 'ok     ' : c.refused ? 'refused' : 'failed '} ${c.name} ${JSON.stringify(c.arguments)}${c.code !== null ? ` (${c.code})` : ''}`,
        );
      console.log(`Reply: ${r.reply ?? '(none)'}`);
      console.log(
        r.ok ? `Check passed in ${r.milliseconds} ms.` : `Check failed: ${r.error ?? 'unknown'}`,
      );
    }
    return r.ok;
  } finally {
    await transport.close();
  }
}

/** `overthink run`. */
async function run(adapter: LoadedAdapter, v: RunFlags): Promise<number> {
  const jobKey = jobName(adapter, v);
  const job = jobFor(jobKey);
  const days = positiveInt(v.days, '--days');
  const runs = positiveInt(v.runs, '--runs');
  const provider = providerFromEnv();
  if (provider === null && !v.rules) {
    console.error(NEED_MODEL);
    return 2;
  }
  // WHY: a run against a product that cannot answer costs minutes (and model tokens) and proves nothing. Check first.
  if (!(await check(adapter, jobKey, false))) {
    console.error(
      'The product did not pass its check, so nothing was run. Fix the adapter and try again.',
    );
    return 1;
  }
  const audiences = audiencesOf(adapter.config);
  const where = adapter.config.channels?.join(', ') ?? 'every channel';
  console.error(
    `Running ${adapterLabel(adapter)} as ${job.label.toLowerCase()} for ${audiences.join(', ')} on ${where}: ` +
      `${runs} paired runs of ${days} days (${v.size} world). ` +
      `People: ${provider === null ? 'scripted rules (--rules; weaker than a model)' : `${provider.kind}:${provider.model}`}.`,
  );
  const live = await openLive(v.out, v);
  live.stream.emit({
    type: 'run.started',
    summary: `Testing ${adapterLabel(adapter)} (${job.label.toLowerCase()})`,
    data: {
      adapter: adapterLabel(adapter),
      variants: [{id: null, adapter: adapterLabel(adapter), access: adapter.config.access ?? null}],
      days,
      size: v.size,
      job: jobKey,
      audience: audiences,
      channels: adapter.config.channels ?? null,
      people: provider === null ? 'rules' : `${provider.kind}:${provider.model}`,
    },
  });
  const raw = await runOverthink({
    adapter,
    days,
    runs,
    size: v.size,
    job: jobKey,
    live: live.stream,
    panelSize: positiveInt(v.panel ?? String(DEFAULT_PANEL_SIZE), '--panel'),
    firstSeed: positiveInt(v['first-seed'], '--first-seed'),
    provider,
    cacheDir: v['no-cache'] ? null : defaultCacheDir(),
    tokenCap: positiveInt(v['max-tokens'], '--max-tokens'),
    log: (l) => {
      console.error(l);
    },
  });
  const results = buildResults(raw, v.out);
  const files = writeReport(
    path.resolve(v.out),
    results,
    raw.seeds.map((s) => s.bundle),
  );
  live.stream.emit({
    type: 'run.finished',
    summary: results.headline,
    data: {results: files.results, headline: results.headline},
  });
  console.log(summaryMarkdown(results));
  console.log(
    `Wrote ${files.results}\n      ${files.summary}\n      ${files.html}\n      ${path.join(path.resolve(v.out), 'live.jsonl')}`,
  );
  console.log(`Open the business it ran in: overthink view --run ${v.out}`);
  if (live.keepOpen)
    console.error('The live stream stays up so a page can replay it. Press Ctrl+C to stop.');
  else await live.close();
  return 0;
}

/** `overthink view`: serves the apps on the run's worlds, or prints one record as JSON. */
async function view(v: {
  run: string;
  port: string;
  json?: string | undefined;
  seed?: string | undefined;
  arm: string;
}): Promise<number> {
  const dir = path.resolve(v.run);
  if (v.json !== undefined) {
    const worlds = openRun(dir);
    const seed = v.seed !== undefined ? positiveInt(v.seed, '--seed') : (worlds.seeds[0] ?? 1);
    const arm = v.arm === 'without' ? 'without' : 'with';
    const opened = worlds.open(seed, arm);
    const found = findRecord(opened.sandbox.world.state, v.json);
    if (found === null) {
      console.error(`No record ${v.json} in seed ${seed} (${arm} the product).`);
      return 1;
    }
    const marks = opened.marks.filter((m) => m.id === v.json);
    console.log(JSON.stringify({seed, arm, ...found, marks}, null, 2));
    return 0;
  }
  const {url, run: worlds} = await startViewServer(dir, positiveInt(v.port, '--port'));
  const first = worlds.open(worlds.seeds[0] ?? 1, 'with');
  console.log(`Rummage, the company's search, at the end of the run (read-only): ${url}/`);
  console.log(
    `Runs (seeds): ${worlds.seeds.join(', ')}. Your AI's records are badged; switch to "Without your AI" at the bottom.`,
  );
  console.log(
    `For a coding agent: MCP at ${url}/mcp?key=${first.token} (read-only), or GET ${url}/view/record/<id>.`,
  );
  console.log('Press Ctrl+C to stop.');
  // The server keeps the process alive until it is stopped.
  return 0;
}

/** `overthink init`: writes the connector, checks it, makes a short first run and says how to look at it. */
async function init(v: {
  audience?: string | undefined;
  live?: boolean;
  'live-port'?: string;
  open?: boolean;
  url?: string | undefined;
  command?: string | undefined;
  model?: string | undefined;
  channels?: string | undefined;
  name?: string | undefined;
  version?: string | undefined;
  yes: boolean;
  'no-run': boolean;
  force: boolean;
}): Promise<number> {
  const interactive = process.stdin.isTTY && !v.yes;
  const term = interactive ? terminalAsk() : null;
  let answers: InitAnswers;
  try {
    answers = await gatherAnswers(
      {
        ...(v.url !== undefined ? {url: v.url} : {}),
        ...(v.command !== undefined ? {command: v.command} : {}),
        ...(v.model !== undefined ? {model: v.model} : {}),
        ...(v.channels !== undefined ? {channels: v.channels} : {}),
        ...(v.audience !== undefined ? {audience: v.audience} : {}),
        ...(v.name !== undefined ? {name: v.name} : {}),
        ...(v.version !== undefined ? {version: v.version} : {}),
        yes: !interactive,
      },
      process.cwd(),
      term !== null ? {ask: term.ask} : {},
    );
  } finally {
    term?.close();
  }
  const written = writeAdapter(process.cwd(), answers, v.force);
  console.log(
    `Wrote ${written.join(', ')} (${answers.transport}, for ${answers.audience.join(', ')}, deployed on ${answers.channels.join(', ')}).`,
  );
  const adapter = await loadAdapter(written[0] ?? 'overthink.adapter.ts');
  buildWorld('demo');
  const jobKey = jobOf(audiencesOf(adapter.config));
  if (!(await check(adapter, jobKey, true))) {
    console.log(
      'Fix what the check says (is the product running?), then: overthink check --adapter overthink.adapter.ts',
    );
    return 1;
  }
  if (v['no-run']) {
    console.log(
      'Next: overthink up --adapter overthink.adapter.ts, then overthink act --help (or overthink run for the ready-made twin run)',
    );
    return 0;
  }
  const rules = providerFromEnv() === null;
  if (rules)
    console.log(
      'No people model is set, so this first run uses scripted people (--rules). Set one for the real thing (AGENTS.md).',
    );
  const code = await run(adapter, {
    days: '7',
    runs: '3',
    size: 'demo',
    job: jobKey,
    job_given: true,
    live: v.live ?? false,
    'live-port': v['live-port'] ?? String(LIVE_PORT),
    open: v.open ?? false,
    out: 'overthink-report',
    'first-seed': '1',
    'max-tokens': String(DEFAULT_MAX_TOKENS),
    'no-cache': false,
    rules,
  });
  if (code === 0) console.log('Look over its shoulder: overthink view --run overthink-report');
  return code;
}

function sizeOf(x: string): 'demo' | 'standard' {
  if (x === 'demo' || x === 'standard') return x;
  throw new Error('--size must be demo or standard.');
}

function buildWorld(size: string): void {
  if (
    !ensureWorlds({
      sizes: [size],
      log: (l) => {
        console.error(l);
      },
    })
  )
    throw new Error('The world could not be built.');
}

function positiveInt(x: string, flag: string): number {
  const n = Number(x);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a whole number above 0.`);
  return n;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(`overthink: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  },
);
