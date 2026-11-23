/**
 * @fileoverview `overthink act`: the activity actions from a terminal, against the sandbox `overthink up` started.
 *
 *   overthink act --help                                   every action and its fields
 *   overthink act create-person --count 5
 *   overthink act send-email --person C-1263 --subject "Where is my order?" --body "It was due Monday."
 *   overthink act place-order --person C-1263 --items '[{"sku": "OT-BISC-24"}]'
 *   overthink act advance-time --days 3
 *   overthink act batch --file plan.json                    {"actions": [{"action": "...", "input": {...}}]}
 *
 * Fields are the action's input with dashes for underscores. Objects and lists are JSON; --json '{...}' gives the
 * whole input at once. The result is printed as JSON; a refusal exits 1, with the reason.
 */
import fs from 'node:fs';
import {readSession} from '../infrastructure/session.ts';
import {ACTIONS, actionNamed} from './actions.ts';
import type {ActionDef} from './actions.ts';
import {ActivityClient} from './api.ts';

/** The help text, made from the actions so it is always complete. */
export function actHelp(): string {
  const lines = ACTIONS.map((a) => {
    const fields = Object.keys(a.input.properties).map((k) => {
      const required = a.input.required?.includes(k) === true;
      return required ? `--${k.replace(/_/g, '-')}` : `[--${k.replace(/_/g, '-')}]`;
    });
    return `  ${a.name.replace(/_/g, '-').padEnd(20)} ${a.title}\n  ${''.padEnd(20)} ${fields.join(' ')}`;
  });
  return `Usage: overthink act <action> [--field value ...] [--json '{...}'] [--file input.json]

Creates activity in the sandbox that \`overthink up\` is running (found in .overthink/sandbox.json).
Objects and lists are JSON. Full descriptions: activity-generation/README.md.

${lines.join('\n')}`;
}

/** Turns `--field value` pairs into an action's input, using its schema to read numbers, booleans and JSON. */
export function parseActArgs(def: ActionDef, args: readonly string[]): Record<string, unknown> {
  let input: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i] ?? '';
    if (!flag.startsWith('--')) throw new Error(`Expected a --field, got "${flag}".`);
    const name = flag.slice(2).replace(/-/g, '_');
    const next = args[i + 1];
    const type = def.input.properties[name]?.['type'];
    if (type === 'boolean' && (next === undefined || next.startsWith('--'))) {
      input[name] = true;
      continue;
    }
    if (next === undefined) throw new Error(`${flag} needs a value.`);
    i++;
    if (name === 'json') input = {...input, ...(JSON.parse(next) as Record<string, unknown>)};
    else if (name === 'file')
      input = {...input, ...(JSON.parse(fs.readFileSync(next, 'utf8')) as Record<string, unknown>)};
    else if (type === undefined)
      throw new Error(`${def.name} has no field "${name}". See: overthink act --help`);
    else input[name] = read(next, type, flag);
  }
  return input;
}

function read(raw: string, type: unknown, flag: string): unknown {
  if (type === 'integer' || type === 'number') {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(`${flag} must be a number.`);
    return n;
  }
  if (type === 'boolean') return raw === 'true' || raw === 'yes';
  if (type === 'object' || type === 'array') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new Error(
        `${flag} must be JSON, e.g. ${type === 'array' ? '\'[{"sku": "..."}]\'' : '\'{"key": "value"}\''}.`,
      );
    }
  }
  return raw;
}

/** Runs `overthink act ...`. Returns the exit code. */
export async function act(args: readonly string[], dir = process.cwd()): Promise<number> {
  const [first, ...rest] = args;
  if (first === undefined || first === '--help' || first === '-h' || first === 'help') {
    console.log(actHelp());
    return first === undefined ? 2 : 0;
  }
  const def = actionNamed(first.replace(/-/g, '_'));
  if (def === undefined) {
    console.error(`There is no action "${first}". See: overthink act --help`);
    return 2;
  }
  const session = readSession(dir);
  if (session === null) {
    console.error(
      'No sandbox is running for this folder. Start one in another terminal: overthink up',
    );
    return 2;
  }
  const input = parseActArgs(def, rest);
  const r = await new ActivityClient(session).perform(def.name, input);
  console.log(JSON.stringify(r.ok ? r.data : {error: r.error}, null, 2));
  return r.ok ? 0 : 1;
}
