/**
 * @fileoverview The live feed on the `overthink view` server: a run's events (docs/live-events.md) at /live/*.
 *
 * The front door (applications/home/) reads one shape only, `overthink.live/1`, wherever it comes from:
 *
 * - `<out>/live.jsonl` when the run wrote one. While the run is still writing it, /live/events follows the file, so
 *   the feed moves as the run moves.
 * - Otherwise (a run made before live events existed), the product's part of the story is rebuilt from the saved
 *   worlds: who wrote in, what the product said back, what it changed, and what the person said next. Every event
 *   points at a record the product touched, so nothing here is invented.
 */
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import type {Mark} from './marks.ts';

/** The schema every event carries. */
export const LIVE_SCHEMA = 'overthink.live/1';

/** One event, as docs/live-events.md defines it. Readers ignore fields they do not know. */
export interface LiveEvent {
  schema: string;
  seq: number;
  at: string;
  run: string;
  type: string;
  arm: 'with' | 'without' | null;
  variant: string | null;
  seed: number | null;
  sim_time: string | null;
  audience: string | null;
  channel: string | null;
  session: string | null;
  app: string | null;
  record: string | null;
  link: string | null;
  summary: string;
  data: Record<string, unknown>;
}

/** Where the feed comes from: the events so far, and whether more may come. */
export interface LiveSource {
  events(): readonly LiveEvent[];
  state(): 'running' | 'finished';
}

/** How often a growing live.jsonl is read again, in milliseconds. */
const FOLLOW_MS = 1000;
/** A comment line this often keeps proxies from closing the stream (as the run's own server does). */
const PING_MS = 15_000;

/** Reads `<dir>/live.jsonl`, or null when the run did not write one. A half-written last line is skipped. */
export function readLiveFile(dir: string): LiveEvent[] | null {
  const file = path.join(dir, 'live.jsonl');
  if (!fs.existsSync(file)) return null;
  const events: LiveEvent[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      events.push(JSON.parse(line) as LiveEvent);
    } catch {
      // WHY skip: the run may be in the middle of writing this line; the next read gets it whole.
    }
  }
  return events;
}

/** A message in a conversation, from the customer or the product, as the saved world holds it. */
interface Line {
  from: 'customer' | 'product' | 'other';
  at: string;
  text: string;
  record: string;
}

/** The parts of a saved world this file reads. */
interface WorldState {
  customers?: {id: string; name: string}[];
  contacts?: {id: string; at: string; customer_id: string | null; channel: string}[];
  emails?: {
    id: string;
    thread_id?: string;
    at: string;
    body?: string;
    folder?: string;
    overthink?: {by: string};
  }[];
  conversations?: {
    id: string;
    contact_id?: string;
    messages: {from: string; at: string; text: string; overthink?: {by: string}}[];
  }[];
}

/** One seed's world with the product in it, as {@link eventsFromWorlds} needs it. */
export interface SeedWorld {
  seed: number;
  state: Record<string, unknown>;
  marks: readonly Mark[];
  /** The simulated time of each of the product's calls, by trace seq, to place its actions in the story. */
  callTimes: ReadonlyMap<number, string>;
}

/** The path on the view server that opens a record in its app. */
export function linkFor(app: string, record: string, seed: number, channel?: string): string {
  const q = `seed=${seed}&arm=with`;
  if (app === 'letterbox' || channel === 'email')
    return `/apps/letterbox/?mailbox=hello&${record.startsWith('EM-') ? 'email' : 'thread'}=${record}&${q}`;
  if (record.startsWith('ORD-')) return `/apps/till/?${q}#orders/${record}`;
  if (record.startsWith('PO-')) return `/apps/stockroom/?${q}`;
  if (record.startsWith('CASE-')) return `/apps/front-desk/?case=${record}&${q}`;
  if (record.startsWith('CT-')) return `/apps/front-desk/?contact=${record}&${q}`;
  return `/apps/${app}/?${q}`;
}

/** Shortens what someone said to one feed-sized line. */
function clip(text: string, n = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n - 1).trimEnd()}…` : flat;
}

/**
 * Rebuilds the product's part of a run from its saved worlds, in the live-event shape: for each contact it answered,
 * the person writing in, each reply, what they said next; and each record its calls changed.
 */
export function eventsFromWorlds(runId: string, seeds: readonly SeedWorld[]): LiveEvent[] {
  const out: Omit<LiveEvent, 'seq'>[] = [];
  const base = (
    seed: number,
    at: string,
  ): Omit<LiveEvent, 'seq' | 'type' | 'summary' | 'data'> => ({
    schema: LIVE_SCHEMA,
    at,
    run: runId,
    arm: 'with',
    variant: null,
    seed,
    sim_time: at,
    audience: 'customers',
    channel: null,
    session: null,
    app: null,
    record: null,
    link: null,
  });
  for (const {seed, state: raw, marks, callTimes} of seeds) {
    const state = raw as WorldState;
    const names = new Map((state.customers ?? []).map((c) => [c.id, c.name]));
    const contacts = new Map((state.contacts ?? []).map((c) => [c.id, c]));
    const done = new Set<string>();
    for (const mark of marks) {
      if (mark.kind === 'action') {
        const at = callTimes.get(mark.seq ?? -1) ?? '';
        out.push({
          ...base(seed, at),
          type: 'product.acted',
          session: mark.session,
          app: mark.app,
          record: mark.id.startsWith('call-') ? null : mark.id,
          link: mark.id.startsWith('call-') ? null : linkFor(mark.app, mark.id, seed),
          summary: mark.what.replace(/^[a-z_]+: /, ''),
          data: {tool: mark.tool ?? null, ok: true, code: null, refused: false},
        });
        continue;
      }
      const contact = contacts.get(mark.id);
      if (contact === undefined || done.has(contact.id)) continue;
      done.add(contact.id);
      const who = {kind: 'customer', name: names.get(contact.customer_id ?? '') ?? 'A customer'};
      const lines = linesOf(state, contact.id);
      const email = contact.channel === 'email';
      const app = email ? 'letterbox' : 'front-desk';
      let replied = false;
      for (const line of lines) {
        const shared = {
          ...base(seed, line.at),
          channel: contact.channel,
          session: mark.session,
          app,
          record: email ? line.record : contact.id,
          link: linkFor(app, contact.id, seed, contact.channel),
        };
        if (line.from === 'product') {
          replied = true;
          out.push({
            ...shared,
            type: 'product.replied',
            summary: `Replied to ${who.name}`,
            data: {text: clip(line.text, 2000), to: who},
          });
        } else if (line.from === 'customer' && !replied) {
          if (out.some((e) => e.type === 'contact.raised' && e.record === shared.record)) continue;
          out.push({
            ...shared,
            type: 'contact.raised',
            summary: `${who.name} wrote in`,
            data: {who, topic: null, situation: null, text: clip(line.text)},
          });
        } else if (line.from === 'customer') {
          out.push({
            ...shared,
            type: 'person.reacted',
            summary: `${who.name} wrote back`,
            data: {kind: 'customer', ending: null, sorted: null, text: clip(line.text)},
          });
        }
      }
    }
  }
  // WHY sort by the business's clock: seeds are separate worlds, so this reads as "what happened, in order".
  out.sort(
    (a, b) => (a.sim_time ?? '').localeCompare(b.sim_time ?? '') || (a.seed ?? 0) - (b.seed ?? 0),
  );
  return out.map((e, i) => ({...e, seq: i + 1}));
}

/** The lines of one contact's conversation, oldest first: the email thread, or the chat. */
function linesOf(state: WorldState, contactId: string): Line[] {
  const emails = (state.emails ?? []).filter((e) => e.thread_id === contactId);
  if (emails.length > 0)
    return emails
      .map((e) => ({
        from:
          e.overthink?.by === 'product'
            ? ('product' as const)
            : e.folder === 'inbox'
              ? ('customer' as const)
              : ('other' as const),
        at: e.at,
        text: e.body ?? '',
        record: e.id,
      }))
      .sort((a, b) => a.at.localeCompare(b.at));
  const conv = (state.conversations ?? []).find((c) => c.contact_id === contactId);
  return (conv?.messages ?? []).map((m) => ({
    from:
      m.overthink?.by === 'product'
        ? 'product'
        : m.from === 'customer'
          ? 'customer'
          : ('other' as const),
    at: m.at,
    text: m.text,
    record: conv?.id ?? contactId,
  }));
}

/**
 * Answers /live/status, /live/events.jsonl and /live/events (server-sent events, following new events while the
 * run is still writing). Returns false for any other path.
 */
export function handleLive(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  source: LiveSource,
): boolean {
  const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
  if (url.pathname === '/live/status') {
    const events = source.events();
    res.writeHead(200, {...headers, 'Content-Type': 'application/json; charset=utf-8'});
    res.end(
      JSON.stringify({
        schema: LIVE_SCHEMA,
        run: events[0]?.run ?? null,
        state: source.state(),
        events: events.length,
        last_seq: events.at(-1)?.seq ?? 0,
      }),
    );
    return true;
  }
  if (url.pathname === '/live/events.jsonl') {
    res.writeHead(200, {...headers, 'Content-Type': 'application/x-ndjson; charset=utf-8'});
    res.end(
      source
        .events()
        .map((e) => `${JSON.stringify(e)}\n`)
        .join(''),
    );
    return true;
  }
  if (url.pathname !== '/live/events') return false;
  const since = Number(req.headers['last-event-id'] ?? url.searchParams.get('since') ?? 0) || 0;
  res.writeHead(200, {
    ...headers,
    'Content-Type': 'text/event-stream; charset=utf-8',
    Connection: 'keep-alive',
  });
  let sent = since;
  const flush = (): void => {
    for (const e of source.events()) {
      if (e.seq <= sent) continue;
      res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      sent = e.seq;
    }
  };
  flush();
  // WHY flush before checking the state: the line that finishes the run must still be sent.
  const follow = setInterval(() => {
    flush();
    if (source.state() !== 'running') clearInterval(follow);
  }, FOLLOW_MS);
  const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
  req.on('close', () => {
    clearInterval(follow);
    clearInterval(ping);
  });
  return true;
}

/**
 * The feed of a run folder: live.jsonl when there is one (read again whenever it grows), else the events rebuilt
 * from the saved worlds by `rebuild`, made once on first use.
 */
export function liveSourceFor(dir: string, rebuild: () => LiveEvent[]): LiveSource {
  const file = path.join(dir, 'live.jsonl');
  let cache: {size: number; events: LiveEvent[]} | null = null;
  let rebuilt: LiveEvent[] | null = null;
  const read = (): LiveEvent[] | null => {
    const size = fs.existsSync(file) ? fs.statSync(file).size : -1;
    if (size < 0) return null;
    if (cache?.size !== size) cache = {size, events: readLiveFile(dir) ?? []};
    return cache.events;
  };
  return {
    events() {
      return read() ?? (rebuilt ??= rebuild());
    },
    state() {
      const events = read();
      if (events === null) return 'finished';
      const last = events.at(-1)?.type;
      return last === 'run.finished' || last === 'run.stopped' ? 'finished' : 'running';
    },
  };
}
