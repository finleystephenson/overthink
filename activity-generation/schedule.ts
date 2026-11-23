/**
 * @fileoverview Activity planned for later in simulated time.
 *
 * A scheduled action waits in the world's state (`activity_schedule`) until time reaches its day, then runs before
 * that day is simulated. WHY in the state: a reset puts it back with everything else, and a saved sandbox keeps it.
 * It runs when time moves through the sandbox (advance_time, POST /sandboxes/{id}/advance), because that is where
 * the per-day hook sits (infrastructure/server/sandboxes.mjs).
 */
import type {Sandbox} from '../infrastructure/server/sandboxes.mjs';
import type {ActivityEnv} from './env.ts';
import {hooksOf, refuse} from './env.ts';

/** One scheduled action. */
export interface ScheduledAction {
  id: string;
  /** When it runs: the simulated time it is due (ISO). */
  at: string;
  action: string;
  input: Record<string, unknown>;
  status: 'waiting' | 'done' | 'failed';
  /** What it did, once run. */
  result?: unknown;
}

const MAX_WAITING = 5000;

function scheduleOf(sb: Sandbox): ScheduledAction[] {
  const st = sb.world.state;
  if (!Array.isArray(st['activity_schedule'])) st['activity_schedule'] = [];
  return st['activity_schedule'] as ScheduledAction[];
}

/** Adds an action to the schedule. `at` is a date or time; `in_days` counts from the simulated now. */
export function addToSchedule(env: ActivityEnv, i: Record<string, unknown>): ScheduledAction {
  const list = scheduleOf(env.sandbox);
  if (list.filter((x) => x.status === 'waiting').length >= MAX_WAITING)
    refuse('rule_violation', `At most ${MAX_WAITING} actions can wait at once.`);
  const now = env.sandbox.world.state.now;
  let at: string;
  if (typeof i['at'] === 'string') {
    const t = Date.parse(i['at'].length === 10 ? `${i['at']}T09:00:00Z` : i['at']);
    if (Number.isNaN(t))
      refuse('invalid_input', '"at" must be a date (YYYY-MM-DD) or an ISO time.');
    at = new Date(t).toISOString();
  } else if (
    typeof i['in_days'] === 'number' &&
    Number.isInteger(i['in_days']) &&
    i['in_days'] >= 0
  ) {
    at = new Date(Date.parse(now) + i['in_days'] * 86400000).toISOString();
  } else
    refuse('invalid_input', 'Say when: "at" (a date) or "in_days" (a whole number, 0 or more).');
  if (at < now)
    refuse(
      'invalid_input',
      `${at.slice(0, 10)} is in the past: the business is at ${now.slice(0, 10)}.`,
    );
  if (typeof i['action'] !== 'string') refuse('invalid_input', 'Say which "action" to run.');
  const item: ScheduledAction = {
    id: `SCH-${String(list.length + 1).padStart(4, '0')}`,
    at,
    action: i['action'],
    input: (i['input'] ?? {}) as Record<string, unknown>,
    status: 'waiting',
  };
  list.push(item);
  return item;
}

/** The schedule, waiting first. */
export function listSchedule(env: ActivityEnv): {
  waiting: ScheduledAction[];
  finished: ScheduledAction[];
} {
  const list = scheduleOf(env.sandbox);
  return {
    waiting: list.filter((x) => x.status === 'waiting'),
    finished: list.filter((x) => x.status !== 'waiting'),
  };
}

/**
 * Makes scheduled actions run as time moves: before each simulated day, everything due by the end of that day, in
 * time order. `run` performs one action (actions.ts perform; passed in to keep the modules acyclic). Safe to call
 * more than once for a sandbox.
 */
export function attachSchedule(
  env: ActivityEnv,
  run: (env: ActivityEnv, name: string, input: Record<string, unknown>) => Promise<{ok: boolean}>,
): void {
  const hooks = hooksOf(env.sandbox);
  if (hooks.beforeDay.some((h) => (h as {schedule?: boolean}).schedule === true)) return;
  const hook = Object.assign(
    async (sb: Sandbox): Promise<void> => {
      const end = `${sb.world.state.now.slice(0, 10)}T23:59:59.999Z`;
      const due = scheduleOf(sb)
        .filter((x) => x.status === 'waiting' && x.at <= end)
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      for (const item of due) {
        const r = await run({...env, via: 'schedule'}, item.action, item.input);
        item.status = r.ok ? 'done' : 'failed';
        item.result = r;
      }
    },
    {schedule: true},
  );
  hooks.beforeDay.push(hook);
}
