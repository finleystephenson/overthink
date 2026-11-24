/**
 * @fileoverview `overthink view`: the company's own apps, opened on the world a run left behind, read-only.
 *
 * The apps talk to the same web API as always (infrastructure/server/http.mjs). This server puts three things in front of it:
 *
 * 1. The worlds. Each seed's two arms are rebuilt from the run's saved bundle (observability/view/bundle.ts) into sandboxes,
 *    on first use. Which one a browser tab sees is the `ot-view` cookie (`<seed>.<with|without>`), set by
 *    applications/lib/view.js from the address bar, so a report link opens exactly the right world.
 * 2. Read-only, twice over. Requests that could change anything are refused at the door (only reads, tool calls and
 *    MCP pass), and the store itself runs only reading tools, rolls back the one line of audit a read writes, and
 *    puts the world back if a call changed it anyway. Nothing here can change a world; there is a test for it.
 * 3. The view's own pages and data: the front door at / (the sandbox desktop, applications/desktop/), the run summary at /apps/view/, the
 *    report at /report, the marks at /view/marks, any record at /view/record/<id>, and the run's live events at
 *    /live/* (observability/view/live.ts).
 *    Every app page gets applications/lib/view.js added, which badges "Your AI" on every marked record and adds the switch to
 *    the same moment without the product.
 *
 * MCP clients (Claude Code and others) can browse the same worlds read-only at /mcp with the key the start line
 * prints.
 */
import fs from 'node:fs';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {createApp, pageCsp, resolveStatic} from '../../infrastructure/server/http.mjs';
import {SandboxStore} from '../../infrastructure/server/sandboxes.mjs';
import type {Principal, Sandbox} from '../../infrastructure/server/sandboxes.mjs';
import {worldFromState} from '../../infrastructure/server/world-data.mjs';
import {applyDelta, readBundle, savedSeeds, stateHash} from './bundle.ts';
import type {SeedBundle} from './bundle.ts';
import {FRONT_DOOR} from './front-door.ts';
import {eventsFromWorlds, handleLive, liveSourceFor} from './live.ts';
import type {Mark} from './marks.ts';

/** Which arm of a seed. */
export type Arm = 'with' | 'without';

/** Tools that only read: by name, plus the few reads whose names do not say so. */
const READ_PREFIX = /^(get|list|search|compare|check|read)_/;
const READ_NAMES: ReadonlySet<string> = new Set([
  'delivery_options',
  'payment_methods',
  'stock_history',
  'ledger_search',
  'web_sessions',
  'price_history',
  'social_stats',
  'business_snapshot',
  'verify_customer',
  'score_content',
]);

/** True for a tool view mode lets through. Anything else is refused before the engine sees it. */
export function isReadTool(name: string): boolean {
  return READ_PREFIX.test(name) || READ_NAMES.has(name);
}

/** The refusal every attempt to change a world gets. */
const READ_ONLY = {
  code: 'read_only',
  message:
    'This is a finished run, opened read-only. Nothing here can be changed. Run again to try something else.',
};

/**
 * A sandbox store that can only read. Tool calls outside {@link isReadTool} are refused; a read leaves no audit line
 * and no trace entry (the trace stays exactly the product's calls); a call that changed something anyway is undone.
 */
export class ReadOnlyStore extends SandboxStore {
  /** The state each sandbox was opened with, to put back if anything ever changes it. */
  readonly pristine = new Map<string, string>();

  override call(
    sb: Sandbox,
    principal: Principal,
    actor: {role: string; session: string; via: string},
    tool: string,
    input: unknown,
  ): ReturnType<SandboxStore['call']> {
    if (!isReadTool(tool)) return {ok: false, error: READ_ONLY};
    const audit = sb.world.state['audit'] as {changes?: unknown[]}[];
    const before = audit.length;
    const seq = sb.seq;
    const r = super.call(sb, principal, actor, tool, input);
    const line = audit[before];
    audit.length = before;
    const added = sb.trace.findIndex((e) => e.seq > seq);
    if (added >= 0) sb.trace.splice(added);
    sb.seq = seq;
    if ((line?.changes?.length ?? 0) > 0) {
      const saved = this.pristine.get(sb.id);
      if (saved !== undefined) sb.world = worldFromState(sb.size, saved);
      return {ok: false, error: READ_ONLY};
    }
    return r;
  }

  /** Read by activity-generation/actions.ts: activity is refused on a finished run's world. */
  readonly readOnly = true;

  override advance(): Promise<never> {
    return Promise.reject(
      Object.assign(new Error(READ_ONLY.message), {code: 'forbidden', status: 403}),
    );
  }

  override reset(): void {
    throw Object.assign(new Error(READ_ONLY.message), {code: 'forbidden', status: 403});
  }
}

/** One opened arm. */
interface OpenArm {
  sandbox: Sandbox;
  token: string;
  marks: Mark[];
}

/** The worlds of one run folder, opened on demand. */
export interface RunWorlds {
  readonly dir: string;
  readonly seeds: readonly number[];
  readonly store: ReadOnlyStore;
  open(seed: number, arm: Arm): OpenArm;
  bundle(seed: number): SeedBundle;
}

/** Opens a run folder (the `--out` of `overthink run`). Throws if it has no saved worlds. */
export function openRun(dir: string): RunWorlds {
  const seeds = savedSeeds(dir);
  if (seeds.length === 0)
    throw new Error(`No saved worlds in ${dir}/view. Run "overthink run --out ${dir}" first.`);
  const store = new ReadOnlyStore({
    maxSandboxes: seeds.length * 2 + 2,
    idleMs: 2 ** 31,
    plugins: [],
  });
  const arms = new Map<string, OpenArm>();
  const bundles = new Map<number, SeedBundle>();
  const bundle = (seed: number): SeedBundle => {
    let b = bundles.get(seed);
    if (b === undefined) {
      b = readBundle(dir, seed);
      bundles.set(seed, b);
    }
    return b;
  };
  return {
    dir,
    seeds,
    store,
    bundle,
    open(seed, arm) {
      const key = `${seed}.${arm}`;
      const hit = arms.get(key);
      if (hit !== undefined) return hit;
      const b = bundle(seed);
      const {sandbox, token} = store.create({size: b.size, scenario: 'normal'});
      if (stateHash(sandbox.start.state) !== b.start_hash)
        throw new Error(
          `The world files changed since this run (seed ${seed}), so its saved world cannot be rebuilt. Run again.`,
        );
      const state = applyDelta(
        JSON.parse(sandbox.start.state) as Record<string, unknown>,
        b[arm].changed,
      );
      const json = JSON.stringify(state);
      sandbox.world = worldFromState(b.size, json);
      store.pristine.set(sandbox.id, json);
      // The product's calls are the trace of the arm with it; the arm without it has none.
      sandbox.trace = arm === 'with' ? b.trace.map((e) => ({...e})) : [];
      sandbox.seq = sandbox.trace.at(-1)?.seq ?? 0;
      sandbox.inbox = inboxOf(state);
      const opened = {sandbox, token, marks: b[arm].marks};
      arms.set(key, opened);
      return opened;
    },
  };
}

/**
 * The run's chats as the server's inbox (infrastructure/server/inbox.mjs shapes), which is where Front Desk reads chat lines from:
 * each customer line, answered by the next line from the shop. Only conversations the run raised (they carry a
 * contact id); the scripted messages a fresh sandbox starts with were never part of the run.
 */
export function inboxOf(state: Record<string, unknown>): Sandbox['inbox'] {
  const inbox: Sandbox['inbox'] = {seq: 0, messages: []};
  const conversations = (state['conversations'] ?? []) as {
    id: string;
    customer_id: string | null;
    channel: string;
    case_number?: string | null;
    contact_id?: string;
    messages: {from: string; at: string; text: string; overthink?: unknown}[];
  }[];
  for (const c of conversations) {
    if (c.contact_id === undefined) continue;
    c.messages.forEach((m, i) => {
      if (m.from !== 'customer') return;
      const next = c.messages[i + 1];
      const answer = next !== undefined && next.from !== 'customer' ? next : null;
      inbox.messages.push({
        id: `MSG-${String(++inbox.seq).padStart(4, '0')}`,
        at: m.at,
        channel: c.channel,
        customer_id: c.customer_id,
        conversation_id: c.id,
        case_number: c.case_number ?? null,
        text: m.text,
        source: 'world',
        status: answer === null ? 'waiting' : 'replied',
        reply:
          answer === null
            ? null
            : {
                at: answer.at,
                text: answer.text,
                role: answer.from === 'staff' ? 'support_agent' : 'assistant',
              },
        followups: [],
      });
    });
  }
  return inbox;
}

/** Looks a record up by id anywhere in a world's state, with the emails of its thread when it has one. */
export function findRecord(
  state: Record<string, unknown>,
  id: string,
): {collection: string; record: unknown; thread?: unknown[]} | null {
  for (const [collection, value] of Object.entries(state)) {
    if (!Array.isArray(value)) continue;
    const record = (value as Record<string, unknown>[]).find(
      (x) => typeof x === 'object' && (x['id'] === id || x['number'] === id),
    );
    if (record === undefined) continue;
    const emails = (state['emails'] ?? []) as {thread_id?: string}[];
    const thread = emails.filter((e) => e.thread_id === id);
    return {collection, record, ...(thread.length > 0 ? {thread} : {})};
  }
  return null;
}

/** Reads `ot-view=<seed>.<arm>` from a request's cookies; falls back to the first seed, with the product. */
export function viewOf(
  req: http.IncomingMessage,
  seeds: readonly number[],
): {seed: number; arm: Arm} {
  const m = /(?:^|;\s*)ot-view=(\d+)\.(without|with)/.exec(req.headers.cookie ?? '');
  const seed = m !== null && seeds.includes(Number(m[1])) ? Number(m[1]) : (seeds[0] ?? 1);
  return {seed, arm: m?.[2] === 'without' ? 'without' : 'with'};
}

/** Builds the view server over a run folder. */
export function createViewServer(run: RunWorlds): http.Server {
  const inner = createApp({
    store: run.store,
    allowedHosts: ['127.0.0.1', 'localhost'],
    rateLimit: 6000,
  });
  const resultsFile = path.join(run.dir, 'results.json');
  const results = (): unknown =>
    fs.existsSync(resultsFile)
      ? (JSON.parse(fs.readFileSync(resultsFile, 'utf8')) as unknown)
      : null;
  // The feed: the run's live.jsonl, or the product's part of the run rebuilt from the saved worlds.
  const live = liveSourceFor(run.dir, () =>
    eventsFromWorlds(
      path.basename(run.dir),
      run.seeds.map((seed) => {
        const opened = run.open(seed, 'with');
        const callTimes = new Map(
          opened.sandbox.trace.map((e) => [
            e.seq,
            typeof e['sim_time'] === 'string' ? e['sim_time'] : '',
          ]),
        );
        return {seed, state: opened.sandbox.world.state, marks: opened.marks, callTimes};
      }),
    ),
  );
  const send = (res: http.ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(body));
  };
  return http.createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      const err = e as {code?: string; status?: number; message?: string};
      if (!res.headersSent)
        send(res, err.status ?? 500, {
          ok: false,
          error: {code: err.code ?? 'internal', message: err.message ?? 'error'},
        });
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    const view = viewOf(req, run.seeds);
    if (method === 'GET' && url.pathname === '/') {
      res.writeHead(302, {Location: FRONT_DOOR}).end();
      return;
    }
    if (method === 'GET' && url.pathname.startsWith('/live/') && handleLive(req, res, url, live))
      return;
    if (method === 'GET' && url.pathname === '/report') {
      const report = path.join(run.dir, 'report.html');
      if (!fs.existsSync(report)) {
        res.writeHead(302, {Location: '/apps/view/'}).end();
        return;
      }
      // WHY its own CSP: the report is one self-contained page Overthink wrote; it may run only its own inline code.
      const html = await readFile(report, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': pageCsp(html),
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(html);
      return;
    }
    if (method === 'GET' && url.pathname === '/view/run') {
      send(res, 200, {ok: true, data: {seeds: run.seeds, view, results: results()}});
      return;
    }
    if (method === 'GET' && url.pathname === '/view/marks') {
      const seed = Number(url.searchParams.get('seed') ?? view.seed);
      const arm = url.searchParams.get('arm') === 'without' ? 'without' : view.arm;
      if (!run.seeds.includes(seed)) {
        send(res, 404, {ok: false, error: {code: 'not_found', message: `No seed ${seed}.`}});
        return;
      }
      send(res, 200, {ok: true, data: {seed, arm, marks: run.open(seed, arm).marks}});
      return;
    }
    const rec = /^\/view\/record\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (method === 'GET' && rec?.[1] !== undefined) {
      const opened = run.open(view.seed, view.arm);
      const found = findRecord(opened.sandbox.world.state, rec[1]);
      const marks = opened.marks.filter((m) => m.id === rec[1]);
      send(
        res,
        found === null ? 404 : 200,
        found === null
          ? {ok: false, error: {code: 'not_found', message: `No record ${rec[1]}.`}}
          : {ok: true, data: {...view, ...found, marks}},
      );
      return;
    }
    if (method === 'POST' && url.pathname === '/sandboxes') {
      // WHY no new sandbox: the apps ask for one on first use; here they get the world the cookie names.
      const opened = run.open(view.seed, view.arm);
      send(res, 201, {
        ok: true,
        data: {...run.store.describe(opened.sandbox), token: opened.token, view},
      });
      return;
    }
    const allowed =
      method === 'GET' ||
      method === 'HEAD' ||
      method === 'OPTIONS' ||
      (method === 'POST' && (/^\/tools\/[a-z_]+$/.test(url.pathname) || url.pathname === '/mcp')) ||
      (method === 'DELETE' && url.pathname === '/mcp');
    if (!allowed) {
      send(res, 403, {ok: false, error: READ_ONLY});
      return;
    }
    const tool = /^\/tools\/([a-z_]+)$/.exec(url.pathname)?.[1];
    if (method === 'POST' && tool !== undefined && !isReadTool(tool)) {
      // A business refusal, as the apps expect: HTTP 200 with ok false, so a screen shows it instead of failing.
      send(res, 200, {ok: false, error: READ_ONLY});
      return;
    }
    if (
      method === 'GET' &&
      url.pathname.startsWith('/apps/') &&
      (await servePage(url.pathname, res))
    )
      return;
    inner.emit('request', req, res);
  }
}

/** Serves an app page with applications/lib/view.js added, so every app knows it is showing a finished run. */
async function servePage(pathname: string, res: http.ServerResponse): Promise<boolean> {
  const file = await resolveStatic(pathname);
  if (file === null || !file.endsWith('.html')) return false;
  const html = (await readFile(file, 'utf8')).replace(
    /<\/head>/i,
    '<script type="module" src="/apps/lib/view.js"></script>\n</head>',
  );
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': pageCsp(html),
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(html);
  return true;
}

/** Starts the view server on 127.0.0.1. */
export async function startViewServer(
  dir: string,
  port: number,
): Promise<{server: http.Server; url: string; run: RunWorlds}> {
  const run = openRun(dir);
  const server = createViewServer(run);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  const actual = typeof address === 'object' && address !== null ? address.port : port;
  return {server, url: `http://127.0.0.1:${actual}`, run};
}
