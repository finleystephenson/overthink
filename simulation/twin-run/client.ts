/**
 * @fileoverview The seam between the simulator and the product: an in-process "tool client" for simulation/simulator/core.mjs.
 *
 * The simulator hands each piece of work (a customer contact, a stock alert, a prospecting day) to its tool client
 * and judges the result from the records. This client plays the work out through the adapter (with tools run in
 * the sandbox under the job's role) and voices the customer. The observer client is its twin for the arm without
 * the product: it only records the customer's first words and passes, so staff handle everything exactly as if no
 * client were there.
 */
import type {ContactItem, ToolCallContext, ToolClient, ToolPayload} from '../simulator/core.d.mts';
import type {Sandbox} from '../../infrastructure/server/sandboxes.mjs';
import type {Scope} from '../lab/scope.mjs';
import {runProductTurn} from '../../integrations/adapter/loop.ts';
import {sandboxGateway} from '../../integrations/adapter/gateway.ts';
import type {Transport} from '../../integrations/adapter/transports.ts';
import type {SandboxStore} from '../../infrastructure/server/sandboxes.mjs';
import type {CustomerVoice} from '../../activity-generation/people/voice.ts';
import {contactKey} from './cast.ts';
import type {Cast} from './cast.ts';
import {PASSED, observeContact, playContact} from './conversation.ts';
import type {Transcript} from './conversation.ts';
import type {Job} from './jobs.ts';
import {clip, emitCalls, NO_LIVE} from '../../observability/live/events.ts';
import type {LiveEmitter} from '../../observability/live/events.ts';

/**
 * Work the simulator sends that has people on the other end, by the channel it comes in on. A product is sent it only
 * where it is deployed. Other work (a stock alert) is part of its job wherever it is deployed.
 */
const WORK_CHANNEL: Readonly<
  Record<string, {channel: string; kind: 'supplier' | 'business'; name: string}>
> = {
  supplier_mail: {channel: 'supplier_mail', kind: 'supplier', name: 'Suppliers'},
  prospects: {channel: 'outreach', kind: 'business', name: 'Prospects'},
};

/**
 * Whether the product is deployed where this work comes in. WHY the legacy rule: an adapter written before work had
 * channels lists only contact channels, and its sales or operations work must still reach it.
 */
export function deployedFor(channels: readonly string[] | null, channel: string): boolean {
  if (channels === null || channels.includes(channel)) return true;
  const workChannels = Object.values(WORK_CHANNEL).map((w) => w.channel);
  return !channels.some((c) => workChannels.includes(c) || c === 'publishing' || c === 'internal');
}

/** A tool client that also keeps what happened. */
export interface RecordingClient extends ToolClient {
  readonly transcripts: Transcript[];
  /** Work items that were not customer contacts (stock alerts, prospecting days). */
  readonly otherWork: {
    kind: string;
    date: string;
    reply: string | null;
    calls: number;
    error: string | null;
  }[];
  /** Reads staff outcomes from the contact records; called at the end of each simulated day. */
  afterDay(): void;
}

/** The client for the arm with the product. */
export function productClient(o: {
  store: SandboxStore;
  sandbox: Sandbox;
  transport: Transport;
  voice: CustomerVoice;
  job: Job;
  scope: Scope | null;
  cast: Cast;
  /** The channels the product is deployed on; contacts on others go to staff. Null means every channel. */
  channels: readonly string[] | null;
  maxSteps?: number;
  /** Where live events go (docs/live-events.md). */
  live?: LiveEmitter;
}): RecordingClient {
  const liveRoot = o.live ?? NO_LIVE;
  const gateway = sandboxGateway({
    store: o.store,
    sandbox: o.sandbox,
    role: o.job.role,
    scope: o.scope,
  });
  const recorder = makeRecorder(o.sandbox);
  const business = {
    name: o.sandbox.world.business.name ?? 'Overthought & Co.',
    role: o.job.role,
    instructions: o.job.instructions,
  };
  return {
    ...recorder.client,
    async call(payload: ToolPayload, context?: ToolCallContext) {
      const turn = {
        transport: o.transport,
        gateway,
        sessionId: payload.session_id,
        now: o.sandbox.world.state.now,
        business,
        ...(o.maxSteps !== undefined ? {maxSteps: o.maxSteps} : {}),
      };
      const item = context?.item ?? null;
      if (payload.sim.kind !== 'contact' || item === null) {
        const w = WORK_CHANNEL[payload.sim.kind];
        if (w !== undefined && !deployedFor(o.channels, w.channel)) return {error: PASSED};
        const who =
          w !== undefined
            ? {kind: w.kind, name: w.name, channel: w.channel}
            : {kind: 'work' as const, name: payload.sim.kind, channel: 'internal'};
        const live = liveRoot.scoped({
          audience:
            w?.kind === 'supplier' ? 'suppliers' : w?.kind === 'business' ? 'businesses' : null,
          channel: who.channel,
          session: payload.session_id,
          sim_time: o.sandbox.world.state.now,
        });
        const r = await runProductTurn({...turn, who}, [{role: 'user', content: payload.message}]);
        emitCalls(live, r.calls, {});
        recorder.client.otherWork.push({
          kind: payload.sim.kind,
          date: payload.sim.date,
          reply: r.reply,
          calls: r.calls.length,
          error: r.error,
        });
        return r.error !== null ? {error: r.error} : {reply: r.reply ?? ''};
      }
      // WHY: a product deployed on the website chat never sees the hello@ inbox, exactly as in the real shop.
      if (o.channels !== null && !o.channels.includes(item.channel)) return {error: PASSED};
      const live = liveRoot.scoped({
        audience: 'customers',
        channel: item.channel,
        session: payload.session_id,
        sim_time: o.sandbox.world.state.now,
        app: appForChannel(item.channel),
        record: item.contactId ?? null,
      });
      const brief = o.cast.briefFor(item, payload, productNameOf(o.sandbox, item));
      live.emit({
        type: 'contact.raised',
        summary: `${brief.name} wrote in by ${item.channel.replace('_', ' ')} (${item.topic.replace(/_/g, ' ')})`,
        data: {
          who: {kind: 'customer', name: brief.name},
          topic: item.topic,
          situation: brief.persona.situation,
        },
      });
      const res = await playContact({
        brief,
        rulesText: item.text,
        voice: o.voice,
        turn,
        key: contactKey(item, payload),
        date: payload.sim.date,
        contactId: item.contactId ?? null,
      });
      recorder.add(res.transcript, item);
      emitTranscript(live, res.transcript, brief.name);
      return res.error !== null ? {error: res.error} : {reply: res.reply ?? ''};
    },
  };
}

/** The client for the arm without the product: records the opening, then passes every piece of work to staff. */
export function observerClient(o: {
  sandbox: Sandbox;
  voice: CustomerVoice;
  cast: Cast;
}): RecordingClient {
  const recorder = makeRecorder(o.sandbox);
  return {
    ...recorder.client,
    async call(payload: ToolPayload, context?: ToolCallContext) {
      const item = context?.item ?? null;
      if (payload.sim.kind === 'contact' && item !== null) {
        // WHY write the opening here too: with a people model, the with-product arm then gets the same words from
        // the cache, so both arms start every conversation identically.
        const t = await observeContact({
          brief: o.cast.briefFor(item, payload, productNameOf(o.sandbox, item)),
          rulesText: item.text,
          voice: o.voice,
          key: contactKey(item, payload),
          session: payload.session_id,
          date: payload.sim.date,
          contactId: item.contactId ?? null,
        });
        recorder.add(t, item);
      }
      return {error: PASSED};
    },
  };
}

/**
 * The client for the planning pass: passes everything (so the arm is exactly the arm without the product) and only
 * notes each contact's key, topic and channel, so situations can be planned over the whole run before it starts.
 */
export function collectorClient(): ToolClient & {
  readonly contacts: {key: string; topic: string; channel: string}[];
} {
  const contacts: {key: string; topic: string; channel: string}[] = [];
  return {
    contacts,
    call(payload: ToolPayload, context?: ToolCallContext) {
      const item = context?.item ?? null;
      if (payload.sim.kind === 'contact' && item !== null)
        contacts.push({key: contactKey(item, payload), topic: item.topic, channel: item.channel});
      return Promise.resolve({error: PASSED});
    },
    close: () => Promise.resolve(),
  };
}

function productNameOf(sb: Sandbox, item: ContactItem): string | null {
  if (item.sku === undefined) return null;
  return sb.world.index.skus[item.sku]?.product.name ?? null;
}

/** Keeps transcripts and fills in what staff did with each contact once the day is over. */
function makeRecorder(sb: Sandbox): {
  client: Omit<RecordingClient, 'call'>;
  add(t: Transcript, item: ContactItem): void;
} {
  const transcripts: Transcript[] = [];
  const pending = new Map<string, Transcript>();
  const client: Omit<RecordingClient, 'call'> = {
    transcripts,
    otherWork: [],
    afterDay() {
      if (pending.size === 0) return;
      for (const rec of sb.world.state.contacts) {
        const t = pending.get(rec.id);
        if (t === undefined) continue;
        t.staff = {
          outcome: rec.outcome,
          handled_by: rec.handled_by,
          first_reply_minutes: rec.first_reply_minutes,
        };
        if (rec.outcome !== 'waiting') pending.delete(rec.id);
      }
    },
    close: () => Promise.resolve(),
  };
  return {
    client,
    add(t, item) {
      transcripts.push(t);
      if (item.contactId !== undefined) pending.set(item.contactId, t);
    },
  };
}

/** The app a contact channel lives in. */
function appForChannel(channel: string): string {
  if (channel === 'email') return 'letterbox';
  if (channel === 'mutter_dm' || channel === 'mutter_mention') return 'mutter';
  if (channel === 'squint_dm') return 'squint';
  return 'front-desk';
}

/** A finished conversation as live events: each call, each reply, and how the customer left. */
function emitTranscript(live: LiveEmitter, t: Transcript, name: string): void {
  for (const l of t.lines) {
    if (l.from === 'tool' && l.call !== undefined) emitCalls(live, [l.call], {});
    else if (l.from === 'product')
      live.emit({
        type: 'product.replied',
        summary: `Replied to ${name}`,
        data: {text: clip(l.text), to: {kind: 'customer', name}},
      });
  }
  const last = [...t.lines].reverse().find((l) => l.from === 'customer');
  live.emit({
    type: 'person.reacted',
    summary: `${name}: ${t.ending.replace(/_/g, ' ')}${t.verdict !== null ? ` (${t.verdict.replace(/_/g, ' ')})` : ''}`,
    data: {
      kind: 'customer',
      ending: t.ending,
      sorted: t.verdict === 'resolved',
      text: last !== undefined ? clip(last.text) : null,
    },
  });
}
