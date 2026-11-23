/**
 * @fileoverview `overthink init`: writes a starter connector (overthink.adapter.ts) from three answers, so a
 * developer, or their coding agent, goes from nothing to a first run in one command.
 *
 *   1. How does the product take a message? A web address, a command, or an OpenAI-compatible endpoint (a web
 *      address that answers GET /models is detected as one).
 *   2. Who is it for? Customers, staff, other businesses, suppliers or the public (activity-generation/people/audiences.ts).
 *   3. Where is it deployed? The website chat, the hello@ inbox, social messages, staff chat, publishing ...
 *   4. What is it called, and which version?
 *
 * Every answer can also be a flag, so a coding agent never has to type into a prompt.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {CHANNELS, CHANNEL_NAMES, checkChannels} from '../adapter/channels.ts';
import {
  AUDIENCES,
  AUDIENCE_KINDS,
  channelsOf,
  checkAudience,
} from '../../activity-generation/people/audiences.ts';
import type {AudienceKind} from '../../activity-generation/people/audiences.ts';

/** What the connector needs. */
export interface InitAnswers {
  transport: 'http' | 'command' | 'openai';
  /** The product's address (http), or the endpoint's base URL (openai). */
  url?: string;
  command?: string;
  model?: string;
  channels: string[];
  audience: AudienceKind[];
  name: string;
  version: string;
}

/** The default channels: where a small shop's first assistant usually goes. */
export const DEFAULT_CHANNELS: readonly string[] = ['web_chat', 'email'];

/** The connector file's source, ready to write. */
export function adapterSource(a: InitAnswers): string {
  const lines = [
    '// Written by `overthink init`. How Overthink reaches this product; see AGENTS.md in the Overthink repo.',
    '// Change anything here and run `overthink check --adapter overthink.adapter.ts` again.',
    'export const adapter = {',
    `  name: ${JSON.stringify(a.name)},`,
    `  version: ${JSON.stringify(a.version)},`,
    `  transport: ${JSON.stringify(a.transport)},`,
  ];
  if (a.transport === 'http') lines.push(`  url: ${JSON.stringify(a.url ?? '')},`);
  if (a.transport === 'command') lines.push(`  command: ${JSON.stringify(a.command ?? '')},`);
  if (a.transport === 'openai') {
    lines.push(
      `  baseUrl: ${JSON.stringify(a.url ?? '')},`,
      `  model: ${JSON.stringify(a.model ?? '')},`,
      "  systemPromptFile: 'overthink.prompt.txt',",
      "  // apiKeyEnv: 'MY_PRODUCT_API_KEY', // the name of the variable holding its key, never the key",
    );
  }
  lines.push(
    `  // Who it is for: ${AUDIENCE_KINDS.join(', ')}.`,
    `  audience: ${JSON.stringify(a.audience)},`,
    `  // Where it is deployed in the shop: ${CHANNEL_NAMES.join(', ')}.`,
    `  channels: ${JSON.stringify(a.channels)},`,
    '};',
    '',
  );
  return lines.join('\n');
}

/**
 * Whether a web address is an OpenAI-compatible endpoint: it (or its /v1) answers GET /models with a model list.
 * Returns the base URL and the first model, or null.
 */
export async function detectOpenAi(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{baseUrl: string; model: string | null} | null> {
  const trimmed = url.replace(/\/+$/, '');
  for (const base of trimmed.endsWith('/v1') ? [trimmed] : [`${trimmed}/v1`, trimmed]) {
    try {
      const res = await fetchImpl(`${base}/models`, {signal: AbortSignal.timeout(2000)});
      if (!res.ok) continue;
      const body = (await res.json()) as {data?: {id?: unknown}[]};
      if (!Array.isArray(body.data)) continue;
      const first = body.data.find((m) => typeof m.id === 'string');
      return {baseUrl: base, model: typeof first?.id === 'string' ? first.id : null};
    } catch {
      // Not an OpenAI-compatible endpoint (or not reachable): treated as a plain web address.
    }
  }
  return null;
}

/** Flags `overthink init` takes; anything missing is asked (or defaulted with --yes). */
export interface InitFlags {
  url?: string;
  command?: string;
  model?: string;
  channels?: string;
  audience?: string;
  name?: string;
  version?: string;
  yes: boolean;
}

/** Works out the answers from flags, asking for whatever is missing when there is someone to ask. */
export async function gatherAnswers(
  flags: InitFlags,
  cwd: string,
  o: {ask?: (q: string) => Promise<string>; fetchImpl?: typeof fetch} = {},
): Promise<InitAnswers> {
  const ask = flags.yes ? null : (o.ask ?? null);
  const pkg = readPackage(cwd);
  let where = flags.url ?? flags.command;
  if (where === undefined) {
    if (ask === null)
      throw new Error('Say how to reach the product: --url <address> or --command "<command>".');
    where = (
      await ask(
        '1/3 How does your product take a message? A web address (http://...), an OpenAI-compatible endpoint, or a command: ',
      )
    ).trim();
  }
  let answers: Pick<InitAnswers, 'transport' | 'url' | 'command' | 'model'>;
  if (flags.command !== undefined || !/^https?:\/\//i.test(where)) {
    answers = {transport: 'command', command: where};
  } else {
    const ai = await detectOpenAi(where, o.fetchImpl);
    if (ai !== null) {
      const model =
        flags.model ?? ai.model ?? (ask !== null ? (await ask('Which model? ')).trim() : '');
      answers = {transport: 'openai', url: ai.baseUrl, model};
    } else {
      answers = {transport: 'http', url: where};
    }
  }
  let audienceText = flags.audience;
  if (audienceText === undefined && ask !== null) {
    const menu = AUDIENCE_KINDS.map((k) => `   ${k}: ${AUDIENCES[k].who}`).join('\n');
    audienceText = (await ask(`2/4 Who is it for?\n${menu}\n   [customers]: `)).trim();
  }
  const audience = checkAudience(
    audienceText === undefined || audienceText === ''
      ? ['customers']
      : audienceText.split(',').map((a) => a.trim()),
  ) ?? ['customers'];
  const defaults =
    audience.length === 1 && audience[0] === 'customers'
      ? [...DEFAULT_CHANNELS]
      : channelsOf(audience);
  let channels = flags.channels;
  if (channels === undefined && ask !== null) {
    const menu = CHANNEL_NAMES.map((c) => `   ${c}: ${CHANNELS[c] ?? ''}`).join('\n');
    channels = (
      await ask(
        `3/4 Where is it deployed in the shop?\n${menu}\n   Comma-separated [${defaults.join(',')}]: `,
      )
    ).trim();
  }
  const list =
    channels === undefined || channels === '' ? defaults : channels.split(',').map((c) => c.trim());
  let name = flags.name;
  if (name === undefined && ask !== null)
    name = (await ask(`4/4 What is it called? [${pkg.name ?? 'my product'}]: `)).trim();
  return {
    ...answers,
    channels: checkChannels(list),
    audience,
    name: name !== undefined && name !== '' ? name : (pkg.name ?? 'my product'),
    version: flags.version ?? pkg.version ?? 'unversioned',
  };
}

/** Writes the connector (and a starter prompt file for an OpenAI-compatible product). Refuses to overwrite. */
export function writeAdapter(dir: string, a: InitAnswers, force = false): string[] {
  const file = path.join(dir, 'overthink.adapter.ts');
  if (fs.existsSync(file) && !force)
    throw new Error(`${file} already exists. Delete it or pass --force to write a new one.`);
  fs.writeFileSync(file, adapterSource(a));
  const written = [file];
  const prompt = path.join(dir, 'overthink.prompt.txt');
  if (a.transport === 'openai' && !fs.existsSync(prompt)) {
    fs.writeFileSync(
      prompt,
      'You are the customer service assistant for Overthought & Co. Replace this with your product’s own system prompt.\n',
    );
    written.push(prompt);
  }
  return written;
}

/** Asks questions on the terminal. */
export function terminalAsk(): {ask: (q: string) => Promise<string>; close(): void} {
  const rl = createInterface({input: process.stdin, output: process.stderr});
  return {
    ask: (q) => rl.question(q),
    close: () => {
      rl.close();
    },
  };
}

function readPackage(dir: string): {name?: string; version?: string} {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      name?: string;
      version?: string;
    };
  } catch {
    return {}; // no package.json: the defaults stand
  }
}
