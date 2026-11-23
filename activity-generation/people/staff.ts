/**
 * @fileoverview Staff as an audience: the team uses an internal tool in their real work and says what it did.
 *
 * On a working day, a member of staff who has the kind of work the tool could help with asks it, through the adapter
 * contract, with their own role's tools (a support agent asks which contacts are still open; the buyer asks what is
 * running low). Code measures each use from the records and the calls: whether it worked, and the minutes it saved or
 * cost against doing the same thing by hand. At the end of the arm each person gives feedback in their own words
 * (from the people model, or from rules), held to what the measurements show.
 *
 * WHY minutes are measured by code and never by the person: people-model staff, like customers, are too kind. A
 * person may say a tool "saves loads of time"; the record of what it returned and what they then had to check is
 * what counts.
 */
import type {CallRecord} from '../../integrations/adapter/loop.ts';
import {ask, factLines, firstJson, tidyText} from './ask.ts';
import type {PeopleModel} from './ask.ts';
import type {StaffMember} from './audiences.ts';
import {isReadTool} from '../../observability/live/events.ts';

/** Reading speed for an answer, words a minute. A common figure for reading on screen at work. */
const READ_WPM = 200;

/** Minutes to check an answer against the records: careful staff check twice as long. Assumption. */
const CHECK_MINUTES = {careful: 3, practical: 1.5};

/** Minutes to find and undo a change nobody asked for. Assumption. */
const UNDO_MINUTES = 10;

/** One thing a member of staff asks the tool. */
export interface StaffRequest {
  member: StaffMember;
  date: string;
  ask: string;
  /** Any one of these tools, used successfully, is needed for a real answer. */
  expects: readonly string[];
  /** The request only asks for information: a change in reply is a change nobody asked for. */
  readOnly: boolean;
  /** How long it takes them by hand. */
  manualMinutes: number;
}

/** The records a request is built from. Only these fields are read. */
export interface StaffWorldView {
  contacts: readonly {at: string; outcome: string}[];
}

/** What the member of staff needs today, or null when the tool has nothing to offer them today. */
export function staffRequestFor(
  m: StaffMember,
  state: StaffWorldView,
  date: string,
): StaffRequest | null {
  const base = {member: m, date};
  const task = (k: string, d: number): number => m.tasks[k] ?? d;
  switch (m.role) {
    case 'support_agent':
    case 'support_lead': {
      const open = state.contacts.filter((c) => c.outcome === 'waiting').length;
      if (open === 0) return null;
      return {
        ...base,
        ask: `Which customer contacts are still waiting for an answer, oldest first, and what does each one need? There are about ${open}.`,
        expects: ['list_contacts'],
        readOnly: true,
        // WHY two minutes a contact: opening each one in Front Desk and reading it, the way they triage by hand.
        manualMinutes: Math.max(5, 2 * open),
      };
    }
    case 'manager':
      return {
        ...base,
        ask: 'Give me today in a few lines: orders, refunds, complaints, and anything waiting for my approval.',
        expects: [
          'get_monthly_summary',
          'list_all_orders',
          'list_purchase_orders',
          'ledger_search',
          'list_contacts',
        ],
        readOnly: true,
        manualMinutes: Math.round(task('weekly_review', 90) / 5),
      };
    case 'finance':
      return {
        ...base,
        ask: 'List the refunds and goodwill credits that went out today, with their order numbers, for the books.',
        expects: ['ledger_search'],
        readOnly: true,
        manualMinutes: task('reconcile_books', 20),
      };
    case 'buyer':
      return {
        ...base,
        ask: 'Which products are running low, and what should I order from whom?',
        expects: ['check_stock', 'list_suppliers', 'list_purchase_orders', 'stock_history'],
        readOnly: true,
        manualMinutes: task('check_stock', 20),
      };
    case 'warehouse':
      return {
        ...base,
        ask: 'Which orders are waiting to be packed or sent, oldest first?',
        expects: ['list_all_orders'],
        readOnly: true,
        manualMinutes: 10,
      };
    case 'marketing':
      return {
        ...base,
        ask: 'How did our posts do on Mutter and Squint this week?',
        expects: ['social_stats', 'list_social_posts'],
        readOnly: true,
        manualMinutes: 15,
      };
    default:
      return null;
  }
}

/** One use of the tool, measured. */
export interface StaffUse {
  staffId: string;
  role: string;
  date: string;
  ask: string;
  reply: string | null;
  calls: CallRecord[];
  worked: boolean;
  /** Why it did not work, when it did not. */
  why: string | null;
  manualMinutes: number;
  /** Minutes saved against doing it by hand; negative when it cost time. */
  minutesSaved: number;
  /** Their working minutes that day in the twin without the product. */
  workloadMinutes: number;
}

/** Measures one use from the reply and the calls. Pure. */
export function measureUse(
  req: StaffRequest,
  reply: string | null,
  calls: readonly CallRecord[],
  workloadMinutes: number,
): StaffUse {
  const used = calls.some((c) => c.ok && req.expects.includes(c.name));
  const unasked = req.readOnly && calls.some((c) => c.ok && !isReadTool(c.name));
  const words = (reply ?? '').split(/\s+/).filter(Boolean).length;
  let why: string | null = null;
  if (reply === null || words < 8) why = 'no real answer';
  else if (!used) why = `did not look at the records (${req.expects.join(' or ')})`;
  if (unasked) why = `${why !== null ? `${why}; ` : ''}changed something nobody asked it to`;
  const worked = why === null;
  const read = words / READ_WPM;
  const check = req.member.style.startsWith('careful')
    ? CHECK_MINUTES.careful
    : CHECK_MINUTES.practical;
  // A failed answer is read and checked, then the work is done by hand anyway: it costs the read and the check.
  const saved = (worked ? req.manualMinutes : 0) - read - check - (unasked ? UNDO_MINUTES : 0);
  return {
    staffId: req.member.id,
    role: req.member.role,
    date: req.date,
    ask: req.ask,
    reply,
    calls: [...calls],
    worked,
    why,
    manualMinutes: req.manualMinutes,
    minutesSaved: Math.round(saved * 10) / 10,
    workloadMinutes,
  };
}

/** What a member of staff says about the tool at the end of the arm. */
export interface StaffFeedback {
  staffId: string;
  name: string;
  role: string;
  uses: number;
  worked: number;
  minutesSaved: number;
  workloadMinutes: number;
  /** Minutes saved as a share of their working minutes on the days they used it. */
  shareOfWorkload: number | null;
  workedLines: string[];
  didntLines: string[];
  wouldUseAgain: boolean;
  source: 'model' | 'rules';
  clamped: string[];
}

/** Each person's feedback over their uses: in their words with a model, from the measurements without one. */
export async function staffFeedback(
  model: PeopleModel | null,
  m: StaffMember,
  uses: readonly StaffUse[],
): Promise<StaffFeedback> {
  const worked = uses.filter((u) => u.worked);
  const saved = Math.round(uses.reduce((s, u) => s + u.minutesSaved, 0) * 10) / 10;
  const workload = uses.reduce((s, u) => s + u.workloadMinutes, 0);
  const facts = {
    staffId: m.id,
    name: m.name,
    role: m.role,
    uses: uses.length,
    worked: worked.length,
    minutesSaved: saved,
    workloadMinutes: workload,
    shareOfWorkload: workload > 0 ? Math.round((saved / workload) * 1000) / 1000 : null,
  };
  const rules = {
    workedLines: worked
      .slice(0, 3)
      .map((u) => `${short(u.ask)}: answered (${u.minutesSaved} min saved)`),
    didntLines: uses
      .filter((u) => !u.worked)
      .slice(0, 3)
      .map((u) => `${short(u.ask)}: ${u.why ?? 'did not work'}`),
    wouldUseAgain: saved > 0,
  };
  if (model === null || uses.length === 0)
    return {...facts, ...rules, source: 'rules', clamped: []};
  const text = await ask(model, {
    purpose: 'staff',
    system: [
      'You are a member of staff at Overthought & Co., a small online shop, described below. You are not an assistant.',
      'You tried a new internal tool in your work. Say plainly what worked and what did not, as you would to your manager.',
      '',
      factLines([
        ['job', m.job],
        ['role', m.role],
        ['weekly_hours', String(m.weeklyHours)],
        ['how_you_work', m.style],
        ['times_you_used_it', String(uses.length)],
        ['code_says_it_worked', worked.length * 2 >= uses.length ? 'yes' : 'no'],
        ['minutes_it_saved_you_in_total', String(saved)],
      ]),
      '',
      'Answer with one JSON object and nothing else:',
      '{"worked": ["short lines"], "didnt": ["short lines"], "would_use_again": true|false}',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: uses
          .slice(0, 6)
          .map(
            (u, i) =>
              `${i + 1}. You asked: ${u.ask}\nIt answered: ${tidyText(u.reply ?? '(nothing)', 400)}\nMeasured: ${u.worked ? 'it worked' : `it did not work (${u.why ?? ''})`}, ${u.minutesSaved} minutes saved.`,
          )
          .join('\n\n'),
      },
    ],
    maxTokens: 220,
    temperature: 0.5,
    json: true,
  });
  const raw = firstJson(text);
  const clamped: string[] = [];
  const lines = (x: unknown): string[] =>
    Array.isArray(x)
      ? x
          .map((l) => tidyText(l, 160))
          .filter((l) => l !== '')
          .slice(0, 4)
      : [];
  let workedLines = lines(raw?.['worked']);
  let didntLines = lines(raw?.['didnt']);
  let again = raw?.['would_use_again'] === true;
  if (raw === null) {
    clamped.push('the model’s answer was not readable JSON; rules feedback used');
    workedLines = rules.workedLines;
    didntLines = rules.didntLines;
    again = rules.wouldUseAgain;
  }
  // Held to the measurements: nobody praises a tool that never worked, or wants more of one that cost them time.
  if (worked.length === 0 && workedLines.length > 0) {
    clamped.push('said parts worked, but no use worked by the records');
    workedLines = [];
  }
  if (worked.length < uses.length && didntLines.length === 0) {
    clamped.push('said nothing failed, but some uses did not work');
    didntLines = rules.didntLines;
  }
  if (again && saved < 0) {
    clamped.push('would use it again, but it cost them time');
    again = false;
  }
  return {...facts, workedLines, didntLines, wouldUseAgain: again, source: 'model', clamped};
}

function short(s: string): string {
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}
