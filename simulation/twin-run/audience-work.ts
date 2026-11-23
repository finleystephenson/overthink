/**
 * @fileoverview The audiences at work during an arm: what the product is asked to do for staff, the public, buyers
 * and suppliers, and how those people respond (activity-generation/people/audiences.ts).
 *
 * Customers reach the product through the simulator's contacts (simulation/twin-run/client.ts). The other audiences reach it here:
 *   - publishing: once a day the product may publish (a post, a newsletter, a product page); a persona panel reads
 *     each new item and the audience plug-in (simulation/simulator/audience.mjs) plays the scaled response out as demand;
 *   - internal: staff with work the tool could help with ask it, in their own role; each use is measured, and each
 *     person gives feedback at the end of the arm;
 *   - outreach: the simulator sends the day's prospecting to the product (simulation/twin-run/client.ts); here each buyer reads
 *     what it sent and decides (the simulator's `outreachJudge`);
 *   - supplier mail: the simulator sends it (simulation/twin-run/client.ts); here the suppliers' answers to what the product
 *     wrote are read from the records at the end.
 *
 * WHY none of this draws from the simulator's random streams: every choice here is a hash or a model answer, so the
 * arm without the product is untouched and the twins stay paired.
 */
import type {OutreachJudgeInput, OutreachVerdict} from '../simulator/core.d.mts';
import type {AudiencePlan, AudiencePlugin, AudienceRates} from '../simulator/audience.d.mts';
import type {Sandbox, SandboxStore} from '../../infrastructure/server/sandboxes.mjs';
import type {Scope} from '../lab/scope.mjs';
import {sandboxGateway} from '../../integrations/adapter/gateway.ts';
import type {ToolGateway} from '../../integrations/adapter/gateway.ts';
import {runProductTurn} from '../../integrations/adapter/loop.ts';
import type {Transport} from '../../integrations/adapter/transports.ts';
import {clip, emitCalls} from '../../observability/live/events.ts';
import type {LiveEmitter} from '../../observability/live/events.ts';
import type {PeopleModel} from '../../activity-generation/people/ask.ts';
import {
  buyerPersona,
  loadPopulation,
  publicPool,
} from '../../activity-generation/people/audiences.ts';
import type {
  AudienceKind,
  ProspectRecord,
  StaffMember,
} from '../../activity-generation/people/audiences.ts';
import {buyerReads, verdictForSim} from '../../activity-generation/people/buyers.ts';
import type {BuyerVerdict} from '../../activity-generation/people/buyers.ts';
import {
  DEFAULT_PANEL_SIZE,
  contentHash,
  drawPanel,
  panelReading,
  zero,
} from '../../activity-generation/people/panel.ts';
import type {Content, Decision, PanelReading} from '../../activity-generation/people/panel.ts';
import {unit} from '../../activity-generation/people/personas.ts';
import {
  measureUse,
  staffFeedback,
  staffRequestFor,
} from '../../activity-generation/people/staff.ts';
import type {StaffFeedback, StaffUse} from '../../activity-generation/people/staff.ts';
import type {Job} from './jobs.ts';

/** One item the product published, and how people took it. */
export interface PublishedItem {
  kind: Content['kind'];
  recordId: string;
  network: string | null;
  date: string;
  text: string;
  contentHash: string;
  /** "panel" when a persona panel read it; "rules" when simulation/simulator/audience.mjs planned it (`--rules`). */
  source: 'panel' | 'rules';
  /** Everyone it reached (posts), opened it (newsletters) or viewed the page (product pages). */
  reach: number;
  /** The panel's own decisions (null with rules). */
  panel: {size: number; counts: Record<Decision, number>; replies: string[]} | null;
  /** Expected counts across everyone reached. */
  scaled: Record<string, number>;
}

/** A supplier's answer to something the product wrote. */
export interface SupplierReply {
  supplier: string;
  request: string;
  decision: string;
  emailId: string | null;
}

/** What the audiences did in one arm with the product. */
export interface AudienceReport {
  published: PublishedItem[];
  staffUses: StaffUse[];
  staffFeedback: StaffFeedback[];
  buyers: BuyerVerdict[];
  suppliers: SupplierReply[];
}

/** Working minutes per staff member and date in the twin without the product. */
export type Workload = ReadonlyMap<string, number>;

/** Minutes each member worked on each date, from the records of an arm (`${staffId}|${date}`). */
export function workloadOf(
  state: Sandbox['world']['state'],
  staff: readonly StaffMember[],
): Map<string, number> {
  const byRoleDate = new Map<string, number>();
  for (const c of state.contacts) {
    if (c.handled_by === null || c.resolve_minutes === null) continue;
    const k = `${c.handled_by}|${c.at.slice(0, 10)}`;
    byRoleDate.set(k, (byRoleDate.get(k) ?? 0) + c.resolve_minutes);
  }
  const perRole = new Map<string, number>();
  for (const m of staff) perRole.set(m.role, (perRole.get(m.role) ?? 0) + 1);
  const out = new Map<string, number>();
  const dates = new Set(state.contacts.map((c) => c.at.slice(0, 10)));
  for (const m of staff)
    for (const d of dates) {
      const recorded =
        m.fixedDailyMinutes + (byRoleDate.get(`${m.role}|${d}`) ?? 0) / (perRole.get(m.role) ?? 1);
      out.set(`${m.id}|${d}`, recorded > 0 ? recorded : contractedDay(m));
    }
  return out;
}

/**
 * A working day by contract: weekly hours over five days. WHY a fallback: some work (buying, the books) leaves no
 * contact records to time, and a share of zero minutes would say nothing.
 */
export function contractedDay(m: StaffMember): number {
  return (m.weeklyHours * 60) / 5;
}

/** The audiences' side of an arm with the product. */
export interface AudienceWork {
  readonly report: AudienceReport;
  /** Runs after each simulated day: publishing and staff requests. */
  endOfDay(date: string): Promise<void>;
  /** For simulation/simulator/core.mjs: buyers decide on the product's outreach. Null without a people model (rules decide). */
  readonly outreachJudge: ((x: OutreachJudgeInput) => Promise<OutreachVerdict | null>) | null;
  /** Reads what is only known at the end: staff feedback and suppliers' answers. */
  finish(): Promise<void>;
}

/** Everything the audiences need. */
export interface AudienceWorkOptions {
  store: SandboxStore;
  sandbox: Sandbox;
  transport: Transport;
  job: Job;
  scope: Scope | null;
  /** Where the product is deployed; null is everywhere. */
  channels: readonly string[] | null;
  model: PeopleModel | null;
  seed: number;
  staff: readonly StaffMember[];
  workload: Workload;
  plugin: AudiencePlugin | null;
  rates: AudienceRates | null;
  demand: {base_orders_per_day: number; product_weights: Record<string, number>} | null;
  live: LiveEmitter;
  /** The audiences the product is pointed at: only their work is sent to it. */
  audiences: readonly AudienceKind[];
  panelSize?: number;
  maxSteps?: number;
}

/** The days staff work (business/data/staff.json "days"), by getUTCDay. */
const WORKDAYS = new Set([1, 2, 3, 4, 5]);

/** Sets up the audiences for one arm with the product. */
export function audienceWork(o: AudienceWorkOptions): AudienceWork {
  const report: AudienceReport = {
    published: [],
    staffUses: [],
    staffFeedback: [],
    buyers: [],
    suppliers: [],
  };
  const on = (ch: string): boolean => o.channels === null || o.channels.includes(ch);
  const state = (): Sandbox['world']['state'] => o.sandbox.world.state;
  const gateways = new Map<string, ToolGateway>();
  const gatewayFor = (role: string): ToolGateway => {
    let g = gateways.get(role);
    if (g === undefined) {
      g = sandboxGateway({store: o.store, sandbox: o.sandbox, role, scope: o.scope});
      gateways.set(role, g);
    }
    return g;
  };
  const business = (role: string): {name: string; role: string; instructions: string} => ({
    name: o.sandbox.world.business.name ?? 'Overthought & Co.',
    role,
    instructions: o.job.instructions,
  });
  const steps = o.maxSteps !== undefined ? {maxSteps: o.maxSteps} : {};
  const seenAt = {
    social: lengthOf(state()['social_posts']),
    emails: lengthOf(state()['emails']),
    pages: lengthOf(state()['product_pages']),
  };

  async function publishingDay(date: string): Promise<void> {
    const session = `publish-${date}`;
    const live = o.live.scoped({
      audience: 'public',
      channel: 'publishing',
      session,
      sim_time: state().now,
    });
    const r = await runProductTurn(
      {
        transport: o.transport,
        gateway: gatewayFor(o.job.role),
        sessionId: session,
        who: {kind: 'work', name: 'Publishing', channel: 'publishing'},
        now: state().now,
        business: business(o.job.role),
        ...steps,
      },
      [{role: 'user', content: PUBLISH_BRIEF(date)}],
    );
    emitCalls(live, r.calls, {});
    await readNewContent(date);
  }

  /** Finds what the product published since the last look, and has people read it. */
  async function readNewContent(date: string): Promise<void> {
    const st = state();
    const items: {content: Content; rec: Record<string, unknown>}[] = [];
    const posts = (st['social_posts'] ?? []) as Record<string, unknown>[];
    for (const p of posts.slice(seenAt.social))
      if (isTool(p) && p['kind'] === 'post' && isRecordOf(p['author'], 'company'))
        items.push({
          content: postContent(p, productName(o.sandbox, linkOf(p, 'product_id'))),
          rec: p,
        });
    seenAt.social = posts.length;
    const emails = (st['emails'] ?? []) as Record<string, unknown>[];
    for (const e of emails.slice(seenAt.emails))
      if (isTool(e) && e['folder'] === 'sent' && recipients(e, st).length >= 3)
        items.push({content: mailContent(e), rec: e});
    seenAt.emails = emails.length;
    const pages = (st['product_pages'] ?? []) as Record<string, unknown>[];
    for (const pg of pages.slice(seenAt.pages))
      items.push({content: pageContent(pg, o.sandbox), rec: pg});
    seenAt.pages = pages.length;
    if (items.length === 0) return;
    // The rules plan first: it decides reach (who saw it) exactly as without a panel, and is the panel's prior.
    o.plugin?.plan(st, o.seed);
    for (const it of items) await reactTo(it.content, it.rec, date);
  }

  async function reactTo(c: Content, rec: Record<string, unknown>, date: string): Promise<void> {
    const app = c.kind === 'post' ? c.network : c.kind === 'newsletter' ? 'megaphone' : 'till';
    const live = o.live.scoped({
      audience: 'public',
      channel: 'publishing',
      app,
      record: c.recordId,
      sim_time: state().now,
    });
    const hash = contentHash(c);
    live.emit({
      type: 'product.published',
      summary: `Published a ${c.kind.replace('_', ' ')}${c.network !== null ? ` on ${c.network}` : ''}`,
      data: {kind: c.kind, network: c.network, text: clip(c.text), content_hash: hash},
    });
    const plan = (rec['audience'] ?? null) as AudiencePlan | null;
    if (o.model === null || o.rates === null) {
      const item: PublishedItem = {
        kind: c.kind,
        recordId: c.recordId,
        network: c.network,
        date,
        text: c.text,
        contentHash: hash,
        source: 'rules',
        reach: plan?.plan['reach'] ?? plan?.plan['opens'] ?? 0,
        panel: null,
        scaled: {...(plan?.plan ?? {})},
      };
      report.published.push(item);
      live.emit({
        type: 'person.reacted',
        summary: `The audience rules planned the response (${c.kind.replace('_', ' ')})`,
        data: {
          kind: 'panel',
          content_hash: hash,
          panel_size: 0,
          decisions: null,
          scaled: item.scaled,
          replies: [],
        },
      });
      return;
    }
    const st = state();
    const pool =
      c.kind === 'newsletter'
        ? publicPool(loadPopulation(), st.customers, {onlyCustomers: recipients(rec, st)})
        : publicPool(loadPopulation(), st.customers);
    const panel = drawPanel(
      pool,
      o.panelSize ?? DEFAULT_PANEL_SIZE,
      `panel|${o.seed}|${c.kind}|${c.network ?? '-'}`,
    );
    const reach = reachOf(c, plan, o.rates, o.demand, recipients(rec, st).length, o.sandbox);
    const reading = await panelReading({
      model: o.model,
      panel,
      content: c,
      prior: priorFor(c, o.rates),
      reach,
    });
    const replies = writeReplies(st, c, rec, reading, panel);
    applyReading(c, rec, plan, reading, reach, o.rates, o.sandbox, date);
    report.published.push({
      kind: c.kind,
      recordId: c.recordId,
      network: c.network,
      date,
      text: c.text,
      contentHash: hash,
      source: 'panel',
      reach: Math.round(reach * 10) / 10,
      panel: {size: reading.size, counts: reading.counts, replies},
      scaled: reading.scaled,
    });
    live.emit({
      type: 'person.reacted',
      summary: `${reading.size} people read it: ${summaryOf(reading.counts)}`,
      data: {
        kind: 'panel',
        content_hash: hash,
        panel_size: reading.size,
        decisions: reading.counts,
        scaled: reading.scaled,
        replies,
      },
    });
  }

  async function staffDay(date: string): Promise<void> {
    if (!WORKDAYS.has(new Date(`${date}T00:00:00Z`).getUTCDay())) return;
    const st = state();
    for (const m of o.staff) {
      const req = staffRequestFor(m, st, date);
      if (req === null) continue;
      const session = `staff-${m.id}-${date}`;
      const live = o.live.scoped({
        audience: 'staff',
        channel: 'internal',
        app: 'kettle',
        session,
        sim_time: st.now,
      });
      live.emit({
        type: 'contact.raised',
        summary: `${m.name} (${m.job}) asked the tool for help`,
        data: {who: {kind: 'staff', name: m.name}, topic: m.role, situation: null},
      });
      const r = await runProductTurn(
        {
          transport: o.transport,
          gateway: gatewayFor(m.role),
          sessionId: session,
          who: {kind: 'staff', name: m.name, channel: 'internal'},
          now: st.now,
          business: business(m.role),
          ...steps,
        },
        [{role: 'user', content: req.ask}],
      );
      emitCalls(live, r.calls, {});
      if (r.reply !== null)
        live.emit({
          type: 'product.replied',
          summary: `Answered ${m.name}`,
          data: {text: clip(r.reply), to: {kind: 'staff', name: m.name}},
        });
      report.staffUses.push(
        measureUse(req, r.reply, r.calls, o.workload.get(`${m.id}|${date}`) ?? contractedDay(m)),
      );
    }
  }

  const outreachJudge =
    o.model === null || !on('outreach')
      ? null
      : async (x: OutreachJudgeInput): Promise<OutreachVerdict | null> => {
          const model = o.model;
          if (model === null) return null;
          const p = x.prospect as unknown as ProspectRecord;
          const buyer = buyerPersona(p, unit);
          const v = await buyerReads(model, buyer, {
            id: x.outreach.id,
            message: x.outreach.message,
            channel: x.outreach.channel,
            offer: x.outreach.offer,
            contactN: x.contactN,
          });
          writeOutreachMail(state(), x, v, buyer.name, buyer.email);
          report.buyers.push(v);
          o.live.emit({
            type: 'person.reacted',
            audience: 'businesses',
            channel: 'outreach',
            app: 'letterbox',
            record: x.outreach.id,
            sim_time: state().now,
            summary: `${buyer.company}'s buyer decided: ${v.decision}`,
            data: {
              kind: 'buyer',
              prospect: p.id,
              decision: v.decision,
              text: v.text,
              clamped: v.clamped,
            },
          });
          return verdictForSim(v.decision);
        };

  return {
    report,
    outreachJudge,
    async endOfDay(date) {
      if (o.audiences.includes('public') && on('publishing')) await publishingDay(date);
      if (o.audiences.includes('staff') && on('internal')) await staffDay(date);
    },
    async finish() {
      for (const m of o.staff) {
        const uses = report.staffUses.filter((u) => u.staffId === m.id);
        if (uses.length === 0) continue;
        const f = await staffFeedback(o.model, m, uses);
        report.staffFeedback.push(f);
        o.live.emit({
          type: 'person.reacted',
          audience: 'staff',
          channel: 'internal',
          app: 'kettle',
          summary: `${m.name}: ${f.worked} of ${f.uses} uses worked, ${f.minutesSaved} minutes saved`,
          data: {
            kind: 'staff',
            staff_id: m.id,
            role: m.role,
            used: true,
            worked: f.workedLines,
            didnt: f.didntLines,
            minutes_saved: f.minutesSaved,
            share_of_workload: f.shareOfWorkload,
          },
        });
      }
      report.suppliers.push(...supplierReplies(state()));
      for (const s of report.suppliers)
        o.live.emit({
          type: 'person.reacted',
          audience: 'suppliers',
          channel: 'supplier_mail',
          app: 'letterbox',
          record: s.emailId,
          summary: `${s.supplier} ${s.decision} (${s.request})`,
          data: {kind: 'supplier', supplier: s.supplier, decision: s.decision, text: null},
        });
    },
  };
}

const PUBLISH_BRIEF = (date: string): string =>
  `It is ${date}. You publish for Overthought & Co. You may post on Mutter (create_social_post with network "mutter", ` +
  'up to 280 characters) or Squint (network "squint", needs a product picture from list_post_pictures), email a ' +
  'newsletter to customers who agreed to hear from the shop (send_email to several customers; list_customers finds ' +
  'them), or rewrite a product page (update_product_page). Publish only what you think helps. Doing nothing is fine.';

// ---------------------------------------------------------------- reading records

function lengthOf(x: unknown): number {
  return Array.isArray(x) ? x.length : 0;
}

function isTool(r: Record<string, unknown>): boolean {
  return typeof r['key'] === 'string' && r['key'].startsWith('tool|');
}

function isRecordOf(x: unknown, kind: string): boolean {
  return typeof x === 'object' && x !== null && (x as {kind?: unknown}).kind === kind;
}

function linkOf(r: Record<string, unknown>, k: string): string | null {
  const l = r['links'];
  if (typeof l !== 'object' || l === null) return null;
  const v = (l as Record<string, unknown>)[k];
  return typeof v === 'string' ? v : null;
}

function productName(sb: Sandbox, id: string | null): string | null {
  if (id === null) return null;
  const p = (sb.world as unknown as {index: {byId?: Record<string, {name: string} | undefined>}})
    .index.byId?.[id];
  return p?.name ?? null;
}

function postContent(p: Record<string, unknown>, product: string | null): Content {
  return {
    kind: 'post',
    recordId: String(p['id']),
    network: p['network'] === 'squint' ? 'squint' : 'mutter',
    text: str(p['text'], ''),
    image: typeof p['image'] === 'string' ? p['image'] : null,
    productName: product,
    price: null,
  };
}

function mailContent(e: Record<string, unknown>): Content {
  return {
    kind: 'newsletter',
    recordId: String(e['id']),
    network: null,
    text: `Subject: ${str(e['subject'], '')}\n\n${str(e['body'], '')}`,
    image: null,
    productName: null,
    price: null,
  };
}

function pageContent(pg: Record<string, unknown>, sb: Sandbox): Content {
  const id = String(pg['product_id']);
  const p = (
    sb.world as unknown as {
      index: {byId?: Record<string, {name: string; variants?: {price: number}[]} | undefined>};
    }
  ).index.byId?.[id];
  return {
    kind: 'product_page',
    recordId: String(pg['id']),
    network: null,
    text: `${str(pg['headline'], p?.name ?? '')}\n\n${str(pg['description'], '')}`,
    image: null,
    productName: p?.name ?? id,
    price: p?.variants?.[0]?.price ?? null,
  };
}

/** The customer ids an email went to. */
function recipients(e: Record<string, unknown>, st: Sandbox['world']['state']): string[] {
  const to = [
    ...((e['to'] ?? []) as {address?: string}[]),
    ...((e['cc'] ?? []) as {address?: string}[]),
  ];
  const byMail = new Map(
    (st.customers as {id: string; email?: string}[]).map((c) => [
      (c.email ?? '').toLowerCase(),
      c.id,
    ]),
  );
  return to
    .map((t) => byMail.get((t.address ?? '').toLowerCase()))
    .filter((x): x is string => x !== undefined);
}

// ---------------------------------------------------------------- the maths (docs/audiences.md)

/** The rules' rate per person reached for each decision: the panel's prior. */
export function priorFor(c: Content, r: AudienceRates): Record<Decision, number> {
  const p = zero();
  if (c.kind === 'post') {
    const n = c.network ?? 'mutter';
    p.like = r.social.like_rate[n] ?? 0.03;
    p.reply = p.like * r.social.comments_per_like;
    p.share = r.social.repost_rate[n] ?? 0.003;
    p.visit = r.social.visit_rate[n] ?? 0.015;
    p.buy = p.visit * r.shop.conversion;
    p.complain = 0.0005;
  } else if (c.kind === 'newsletter') {
    // Per reader (an opened email): clicks, orders and unsubscribes as the rules have them per open.
    p.visit = r.email.click_rate;
    p.buy = r.email.click_rate * r.shop.conversion;
    p.unsubscribe = r.email.unsubscribe_rate / r.email.open_rate;
    p.reply = 0.002;
    p.share = 0.002;
    p.complain = 0.0005;
  } else {
    // Per page view: buying is the shop's conversion; "visit" is looking further round the shop. Assumption.
    p.buy = r.shop.conversion;
    p.visit = 0.2;
    p.complain = 0.0005;
  }
  return p;
}

/** Everyone the item reached: from the rules plan (posts, newsletters), or a week of the page's ordinary views. */
function reachOf(
  c: Content,
  plan: AudiencePlan | null,
  r: AudienceRates,
  demand: AudienceWorkOptions['demand'],
  recipientsN: number,
  sb: Sandbox,
): number {
  if (c.kind === 'post') return plan?.plan['reach'] ?? 0;
  if (c.kind === 'newsletter') return plan?.plan['opens'] ?? recipientsN * r.email.open_rate;
  if (demand === null) return 0;
  const id = productIdOf(c, sb);
  const weights = Object.values(demand.product_weights);
  const share =
    (demand.product_weights[id] ??
      weights.reduce((a, b) => a + b, 0) / Math.max(1, weights.length)) /
    weights.reduce((a, b) => a + b, 0);
  // WHY a week: the audience plug-in plays a page change out over seven days, like a post's window.
  return (7 * demand.base_orders_per_day * share) / r.shop.conversion;
}

function productIdOf(c: Content, sb: Sandbox): string {
  const byId =
    (sb.world as unknown as {index: {byId?: Record<string, {name: string} | undefined>}}).index
      .byId ?? {};
  return Object.entries(byId).find(([, p]) => p?.name === c.productName)?.[0] ?? '';
}

/** Replaces what the rules said people do with what the panel did, on the record the audience plug-in plays out. */
function applyReading(
  c: Content,
  rec: Record<string, unknown>,
  plan: AudiencePlan | null,
  reading: PanelReading,
  reach: number,
  r: AudienceRates,
  sb: Sandbox,
  date: string,
): void {
  const s = reading.scaled;
  const price = c.price ?? r.shop.average_order_value;
  const panelNote = {
    source: 'panel',
    panel_size: reading.size,
    counts: reading.counts,
    rates: reading.rates,
    content_hash: reading.contentHash,
  };
  if (c.kind === 'post' && plan !== null) {
    const reached = reach + (s.share - (plan.plan['reposts'] ?? 0)) * r.social.reach_per_repost;
    plan['rules_plan'] = {...plan.plan};
    plan.plan = {
      ...plan.plan,
      reach: Math.max(0, reached),
      likes: s.like,
      comments: s.reply,
      reposts: s.share,
      visits: s.visit,
      orders: s.buy,
      revenue: s.buy * price,
    };
    plan['panel'] = panelNote;
  } else if (c.kind === 'newsletter' && plan !== null) {
    plan['rules_plan'] = {...plan.plan};
    plan.plan = {
      ...plan.plan,
      clicks: s.visit,
      visits: s.visit,
      orders: s.buy,
      revenue: s.buy * r.shop.average_order_value,
    };
    plan['panel'] = {
      ...panelNote,
      unsubscribed_expected: s.unsubscribe,
      complaints_expected: s.complain,
    };
  } else if (c.kind === 'product_page') {
    const prior = r.shop.conversion;
    // Extra orders against an ordinary page over the same views; negative when the new page sells less.
    const extra = reading.rates.buy * reach - prior * reach;
    const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
    rec['audience'] = {
      kind: 'product_page',
      first_day: day + 1,
      tau: 3,
      window: 7,
      product_id: productIdOf(c, sb) || null,
      plan: {views: reach, visits: s.visit, orders: extra, revenue: extra * price},
      so_far: {},
      shown: {},
      panel: panelNote,
      estimated:
        'Orders are the change against an ordinary page over a week of views (expected values).',
    };
  }
}

/** Panel members who replied or complained get a real record: a comment on the post, or an email to hello@. */
function writeReplies(
  st: Record<string, unknown>,
  c: Content,
  rec: Record<string, unknown>,
  reading: PanelReading,
  panel: ReturnType<typeof drawPanel>,
): string[] {
  const ids: string[] = [];
  const bySlot = new Map(panel.map((m) => [m.slot, m.person]));
  const at = String(st['now'] ?? rec['at']);
  for (const v of reading.verdicts) {
    if (v.reply === null) continue;
    const who = bySlot.get(v.slot);
    if (who === undefined) continue;
    if (c.kind === 'post') {
      const list = (st['social_posts'] ??= []) as Record<string, unknown>[];
      const id = nextId(list, 'SP', 6);
      list.push({
        id,
        key: `panel|${c.recordId}|${v.slot}`,
        network: c.network,
        author: {
          kind: who.customerId !== null ? 'customer' : 'public',
          name: who.name,
          handle: who.name.toLowerCase().replace(/[^a-z]+/g, ''),
          customer_id: who.customerId,
        },
        kind: 'comment',
        text: v.reply,
        image: null,
        at,
        likes: 0,
        reposts: 0,
        parent: c.recordId,
        parent_key: rec['key'],
        thread: null,
        by: null,
        mentions_shop: v.decision === 'complain',
        links: {
          ...(rec['links'] as object),
          ...(who.customerId !== null ? {customer_id: who.customerId} : {}),
        },
      });
      ids.push(id);
    } else if (c.kind === 'newsletter' && who.email !== null) {
      const list = (st['emails'] ??= []) as Record<string, unknown>[];
      const id = nextId(list, 'EM', 6);
      list.push({
        id,
        key: `panel|${c.recordId}|${v.slot}`,
        thread_id: c.recordId,
        mailbox: 'hello',
        folder: 'inbox',
        from: {name: who.name, address: who.email},
        to: [{name: 'Overthought & Co.', address: 'hello@overthought.example'}],
        cc: [],
        subject: `${v.decision === 'complain' ? 'Complaint: ' : 'Re: '}${str(rec['subject'], 'your email')}`,
        body: v.reply,
        at,
        read: false,
        by: null,
        links: {customer_id: who.customerId ?? undefined, reply_to: c.recordId},
      });
      ids.push(id);
    }
  }
  return ids;
}

/** The outreach as an email in the sales mailbox, and the buyer's answer in its inbox, so Letterbox shows both. */
function writeOutreachMail(
  st: Record<string, unknown>,
  x: OutreachJudgeInput,
  v: BuyerVerdict,
  name: string,
  address: string,
): void {
  const list = (st['emails'] ??= []) as Record<string, unknown>[];
  const thread = `outreach-${x.outreach.id}`;
  if (x.outreach.channel === 'email')
    list.push({
      id: nextId(list, 'EM', 6),
      key: `outreach|${x.outreach.id}|out`,
      thread_id: thread,
      mailbox: 'toad',
      folder: 'sent',
      from: {name: 'Overthought & Co.', address: 'toad@overthought.example'},
      to: [{name, address}],
      cc: [],
      subject: `Supplies for ${x.prospect.name}`,
      body: x.outreach.message,
      at: x.outreach.at,
      read: true,
      by: null,
      links: {prospect_id: x.prospect.id, outreach_id: x.outreach.id},
    });
  if (v.text !== null)
    list.push({
      id: nextId(list, 'EM', 6),
      key: `outreach|${x.outreach.id}|reply`,
      thread_id: thread,
      mailbox: 'toad',
      folder: 'inbox',
      from: {name, address},
      to: [{name: 'Overthought & Co.', address: 'toad@overthought.example'}],
      cc: [],
      subject: `${v.decision === 'complain' ? 'Please stop: ' : 'Re: '}Supplies for ${x.prospect.name}`,
      body: v.text,
      at: x.outreach.at,
      read: false,
      by: null,
      links: {prospect_id: x.prospect.id, outreach_id: x.outreach.id, decision: v.decision},
    });
}

/** What suppliers decided about email the product sent them (simulation/world/supplier-side.mjs records each). */
function supplierReplies(st: Record<string, unknown>): SupplierReply[] {
  const emails = (st['emails'] ?? []) as Record<string, unknown>[];
  const mine = new Set(
    emails.filter((e) => isTool(e) && e['folder'] === 'sent').map((e) => String(e['id'])),
  );
  const reqs = (st['supplier_requests'] ?? []) as Record<string, unknown>[];
  const sups = (st['suppliers'] ?? []) as {id: string; name: string}[];
  return reqs
    .filter((r) => typeof r['email_id'] === 'string' && mine.has(r['email_id']))
    .map((r) => ({
      supplier: sups.find((s) => s.id === r['supplier_id'])?.name ?? String(r['supplier_id']),
      request: str(r['kind'], 'email'),
      decision: str(r['decision'], 'answered'),
      emailId: typeof r['reply_id'] === 'string' ? r['reply_id'] : null,
    }));
}

function nextId(list: readonly Record<string, unknown>[], prefix: string, width: number): string {
  let max = 0;
  for (const r of list) {
    const m = /(\d+)$/.exec(str(r['id'], ''));
    if (m !== null) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(width, '0')}`;
}

function summaryOf(counts: Record<Decision, number>): string {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([d, n]) => `${n} ${d}`)
    .join(', ');
}

/** A record field as text: strings as they are, anything else as `fallback`. */
function str(x: unknown, fallback: string): string {
  return typeof x === 'string' ? x : typeof x === 'number' ? String(x) : fallback;
}
