/**
 * @fileoverview The audiences part of results.json: what staff, the public, buyers and suppliers did, over all seeds.
 * Facts only, as counted; no advice.
 */
import type {RawRun} from '../../simulation/twin-run/run.ts';
import type {PublishedItem} from '../../simulation/twin-run/audience-work.ts';
import type {StaffFeedback} from '../../activity-generation/people/staff.ts';
import {DECISIONS} from '../../activity-generation/people/panel.ts';
import {BUYER_DECISIONS} from '../../activity-generation/people/buyers.ts';

/** The `audiences` field of results.json. */
export interface AudienceResults {
  /** Who the product was pointed at. */
  audience: string[];
  public: {
    /** "panel" when persona panels read the content, "rules" with --rules, null when nothing was published. */
    source: 'panel' | 'rules' | null;
    items: number;
    /** The panels' own decisions, added over every item. */
    panelCounts: Record<string, number>;
    /** Expected counts across everyone reached, added over every item. */
    scaled: Record<string, number>;
    /** Records written for panel members' replies and complaints. */
    repliesWritten: number;
    /** Up to 20 items, newest seed last. */
    published: (PublishedItem & {seed: number})[];
  };
  staff: {
    uses: number;
    worked: number;
    minutesSaved: number;
    /** Minutes saved against the twin's working minutes on the days the tool was used. */
    shareOfWorkload: number | null;
    /** Each person's feedback, per seed. */
    feedback: (StaffFeedback & {seed: number})[];
  };
  businesses: {
    decisions: Record<string, number>;
    /** Up to 30 decisions with the buyer's words. */
    verdicts: {
      seed: number;
      prospect: string;
      decision: string;
      text: string | null;
      clamped: string[];
    }[];
  };
  suppliers: {replies: number; decisions: Record<string, number>};
}

/** Builds the audiences section from a raw run. */
export function audienceResults(raw: RawRun): AudienceResults {
  const items = raw.seeds.flatMap((s) => s.audience.published.map((p) => ({...p, seed: s.seed})));
  const panelCounts = Object.fromEntries(DECISIONS.map((d) => [d, 0])) as Record<string, number>;
  const scaled: Record<string, number> = {};
  let replies = 0;
  for (const it of items) {
    for (const [k, v] of Object.entries(it.panel?.counts ?? {}))
      panelCounts[k] = (panelCounts[k] ?? 0) + v;
    for (const [k, v] of Object.entries(it.scaled)) scaled[k] = round1((scaled[k] ?? 0) + v);
    replies += it.panel?.replies.length ?? 0;
  }
  const uses = raw.seeds.flatMap((s) => s.audience.staffUses);
  const saved = uses.reduce((n, u) => n + u.minutesSaved, 0);
  const workload = uses.reduce((n, u) => n + u.workloadMinutes, 0);
  const decisions = Object.fromEntries(BUYER_DECISIONS.map((d) => [d, 0])) as Record<
    string,
    number
  >;
  const verdicts: AudienceResults['businesses']['verdicts'] = [];
  for (const s of raw.seeds)
    for (const v of s.audience.buyers) {
      decisions[v.decision] = (decisions[v.decision] ?? 0) + 1;
      if (verdicts.length < 30)
        verdicts.push({
          seed: s.seed,
          prospect: v.prospectId,
          decision: v.decision,
          text: v.text,
          clamped: v.clamped,
        });
    }
  const sup: Record<string, number> = {};
  const supReplies = raw.seeds.flatMap((s) => s.audience.suppliers);
  for (const r of supReplies) sup[r.decision] = (sup[r.decision] ?? 0) + 1;
  return {
    audience: raw.options.audience,
    public: {
      source: items[0]?.source ?? null,
      items: items.length,
      panelCounts,
      scaled,
      repliesWritten: replies,
      published: items.slice(-20),
    },
    staff: {
      uses: uses.length,
      worked: uses.filter((u) => u.worked).length,
      minutesSaved: round1(saved),
      shareOfWorkload: workload > 0 ? Math.round((saved / workload) * 1000) / 1000 : null,
      feedback: raw.seeds.flatMap((s) =>
        s.audience.staffFeedback.map((f) => ({...f, seed: s.seed})),
      ),
    },
    businesses: {decisions, verdicts},
    suppliers: {replies: supReplies.length, decisions: sup},
  };
}

/** Lines for summary.md, only for audiences that had something happen. */
export function audienceLines(a: AudienceResults): string[] {
  const out: string[] = [];
  if (a.public.items > 0)
    out.push(
      `- The public (${a.public.source ?? 'rules'}): ${a.public.items} items published; ` +
        (a.public.source === 'panel'
          ? `panels decided ${Object.entries(a.public.panelCounts)
              .filter(([, n]) => n > 0)
              .map(([d, n]) => `${d} ${n}`)
              .join(', ')}; ${a.public.repliesWritten} replies written.`
          : 'reactions planned by the audience rules.'),
    );
  if (a.staff.uses > 0)
    out.push(
      `- Staff: ${a.staff.uses} uses, ${a.staff.worked} worked by the records, ${a.staff.minutesSaved} minutes saved in total` +
        `${a.staff.shareOfWorkload !== null ? ` (${(a.staff.shareOfWorkload * 100).toFixed(1)}% of their working minutes those days)` : ''}.`,
    );
  const bought = Object.values(a.businesses.decisions).reduce((x, y) => x + y, 0);
  if (bought > 0)
    out.push(
      `- Buyers: ${Object.entries(a.businesses.decisions)
        .filter(([, n]) => n > 0)
        .map(([d, n]) => `${d} ${n}`)
        .join(', ')}.`,
    );
  if (a.suppliers.replies > 0)
    out.push(
      `- Suppliers answered ${a.suppliers.replies} emails: ${Object.entries(a.suppliers.decisions)
        .map(([d, n]) => `${d} ${n}`)
        .join(', ')}.`,
    );
  return out;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
