/**
 * @fileoverview The live event stream of a run: `overthink.live/1` (docs/live-events.md is the contract).
 *
 * A run emits small facts as they happen (what the product read, did and said, and how people reacted). Every event
 * goes to `<out>/live.jsonl` and to anyone listening (the server-sent-events endpoint in observability/live/server.ts).
 *
 * WHY a stream object passed down rather than a global: two runs in one process (tests, `--compare`) must never mix
 * their events, and a run with no listener must pay almost nothing.
 */
import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {CallRecord} from '../../integrations/adapter/loop.ts';

/** The schema every event carries. */
export const LIVE_SCHEMA = 'overthink.live/1';

/** The event types in docs/live-events.md. */
export type LiveType =
  | 'run.started'
  | 'arm.started'
  | 'contact.raised'
  | 'product.read'
  | 'product.acted'
  | 'product.replied'
  | 'product.published'
  | 'person.reacted'
  | 'day.ended'
  | 'arm.finished'
  | 'run.finished'
  | 'run.stopped';

/** One event, as written. */
export interface LiveEvent {
  schema: typeof LIVE_SCHEMA;
  seq: number;
  at: string;
  run: string;
  type: LiveType;
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

/** What a caller gives; the stream fills in the envelope. */
export type LiveInput = Partial<Omit<LiveEvent, 'schema' | 'seq' | 'at' | 'run'>> & {
  type: LiveType;
  summary: string;
};

/** Where a run's events go. */
export interface LiveStream {
  readonly run: string;
  /** Every event so far (kept for replay; a default run has a few thousand). */
  readonly events: readonly LiveEvent[];
  state: 'running' | 'finished' | 'stopped';
  emit(e: LiveInput): LiveEvent;
  /** Calls `fn` for every new event; returns a function that stops it. */
  subscribe(fn: (e: LiveEvent) => void): () => void;
  /** A view of the stream with some envelope fields fixed (an arm, a seed, a variant). */
  scoped(fixed: Partial<LiveInput>): LiveEmitter;
  close(): void;
}

/** Anything that can emit: the stream or a scoped view of it. */
export interface LiveEmitter {
  emit(e: LiveInput): LiveEvent | null;
  scoped(fixed: Partial<LiveInput>): LiveEmitter;
}

/** An emitter that drops everything, for code run without a stream. */
export const NO_LIVE: LiveEmitter = {
  emit: () => null,
  scoped: () => NO_LIVE,
};

/** The most characters of free text kept in an event. Keeps a feed line and the JSONL file small. */
const MAX_TEXT = 2000;

/** Opens a stream. With `file`, every event is appended to it as one JSON line (the file is replaced first). */
export function openLiveStream(o: {file?: string | null; now?: () => Date} = {}): LiveStream {
  const now = o.now ?? (() => new Date());
  const run = `r-${randomBytes(4).toString('hex')}`;
  const events: LiveEvent[] = [];
  const listeners = new Set<(e: LiveEvent) => void>();
  let fd: number | null = null;
  if (o.file != null) {
    fs.mkdirSync(path.dirname(o.file), {recursive: true});
    fd = fs.openSync(o.file, 'w');
  }
  const stream: LiveStream = {
    run,
    events,
    state: 'running',
    emit(e) {
      const ev: LiveEvent = {
        schema: LIVE_SCHEMA,
        seq: events.length + 1,
        at: now().toISOString(),
        run,
        type: e.type,
        arm: e.arm ?? null,
        variant: e.variant ?? null,
        seed: e.seed ?? null,
        sim_time: e.sim_time ?? null,
        audience: e.audience ?? null,
        channel: e.channel ?? null,
        session: e.session ?? null,
        app: e.app ?? null,
        record: e.record ?? null,
        link: e.link ?? null,
        summary: e.summary,
        data: e.data ?? {},
      };
      if (e.type === 'run.finished') stream.state = 'finished';
      if (e.type === 'run.stopped') stream.state = 'stopped';
      events.push(ev);
      // WHY synchronous appends: the file must hold every event even if the process is killed mid-run.
      if (fd !== null) fs.writeSync(fd, JSON.stringify(ev) + '\n');
      for (const fn of listeners) fn(ev);
      return ev;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    scoped(fixed) {
      return scopedEmitter(stream, fixed);
    },
    close() {
      if (fd !== null) fs.closeSync(fd);
      fd = null;
    },
  };
  return stream;
}

function scopedEmitter(
  target: {emit(e: LiveInput): LiveEvent | null},
  fixed: Partial<LiveInput>,
): LiveEmitter {
  return {
    emit: (e) => target.emit({...fixed, ...e}),
    scoped: (more) => scopedEmitter(target, {...fixed, ...more}),
  };
}

/** Cuts free text to the size an event keeps. */
export function clip(text: string | null | undefined): string {
  const t = text ?? '';
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
}

/** Tools by the company app their records live in. First match wins. */
const APP_OF: readonly [RegExp, string][] = [
  [/email|mailbox|draft/, 'letterbox'],
  [/social|post/, 'mutter'],
  [/campaign|marketing|newsletter/, 'megaphone'],
  [/chat_message|channel|direct_messages|task|workload|org_chart/, 'kettle'],
  [/stock|purchase_order|supplier/, 'stockroom'],
  [/ledger|pay_later|monthly_summary/, 'tally'],
  [/document|knowledge|policy/, 'filing-cabinet'],
  [/case|escalate|contact|conversation|verify_customer/, 'front-desk'],
  [/prospect|outreach/, 'letterbox'],
  [/order|refund|return|product|price|catalogue|goodwill/, 'till'],
];

/** The app a tool's records live in, or null. */
export function appForTool(tool: string): string | null {
  for (const [re, app] of APP_OF) if (re.test(tool)) return app;
  return null;
}

/** Whether a tool only reads, by the same naming rule as the MCP server's read-only hint. */
export function isReadTool(tool: string): boolean {
  return /^(list|get|search|check|read|compare|stock_history|price_history|ledger_search|social_stats|web_sessions|payment_methods|delivery_options)(_|$)/.test(
    tool,
  );
}

/** The id of the record a tool call made or touched, when its result names one. */
export function recordOf(call: CallRecord): string | null {
  const r = call.result;
  if (typeof r !== 'object' || r === null) return null;
  const o = r as Record<string, unknown>;
  for (const k of ['id', 'number', 'thread', 'case_number']) {
    const v = o[k];
    if (typeof v === 'string' && v !== '') return v;
  }
  return null;
}

/** Emits one `product.read` or `product.acted` event per call. */
export function emitCalls(
  live: LiveEmitter,
  calls: readonly CallRecord[],
  base: Partial<LiveInput>,
): void {
  for (const c of calls) {
    const read = isReadTool(c.name);
    live.emit({
      ...base,
      type: read ? 'product.read' : 'product.acted',
      app: appForTool(c.name),
      record: recordOf(c),
      summary: `${read ? 'Read' : c.ok ? 'Did' : c.refused ? 'Was refused' : 'Failed'}: ${c.name}`,
      data: {
        tool: c.name,
        arguments: c.arguments,
        ok: c.ok,
        code: c.code,
        ...(read ? {} : {refused: c.refused}),
      },
    });
  }
}
