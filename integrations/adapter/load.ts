/**
 * @fileoverview Reading an adapter description and opening its transport.
 *
 * An adapter is a small object, usually in `overthink.adapter.ts` in the developer's repo:
 *
 *     export const adapter = {
 *       name: 'Acme support bot',
 *       version: '1.4.0',
 *       transport: 'http',
 *       url: 'http://localhost:3000/overthink',
 *     };
 *
 * `--adapter` also takes a bare `http(s)://` address, or a `.json` file holding the same object.
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkScope} from '../../simulation/lab/scope.mjs';
import type {Scope} from '../../simulation/lab/scope.mjs';
import {checkAudience} from '../../activity-generation/people/audiences.ts';
import type {AudienceKind} from '../../activity-generation/people/audiences.ts';
import {accessScope} from './access.ts';
import {checkChannels} from './channels.ts';
import {isRecord} from './contract.ts';
import {commandTransport, httpTransport, openAiTransport} from './transports.ts';
import type {Transport} from './transports.ts';

/** Settings every adapter may have. */
export interface AdapterCommon {
  /** A plain name for the report. */
  name?: string;
  /** The product's version, recorded so a result can be traced to the code that produced it. */
  version?: string;
  /** Narrows the job's role: which tools or apps the product may read and act on. See simulation/lab/scope.mjs. */
  scope?: Scope;
  /**
   * Where the product is deployed: any of web_chat, email, phone, text (integrations/adapter/channels.ts). Contacts on other
   * channels go to staff. Default: every channel.
   */
  channels?: string[];
  /**
   * Who the product is pointed at: customers, staff, businesses, suppliers or public (activity-generation/people/audiences.ts), one
   * or a list. Default: the audiences its channels reach, else customers.
   */
  audience?: AudienceKind[];
  /** An access level by name (integrations/adapter/access.ts): full, read_only, reply_only, no_money. Sets `scope`. */
  access?: string;
  timeoutMs?: number;
  maxSteps?: number;
}

/** A product run as a command: one JSON turn per line on stdin, one JSON answer per line on stdout. */
export interface CommandAdapter extends AdapterCommon {
  transport: 'command';
  command: string;
  cwd?: string;
}

/** A product reached by HTTP POST. */
export interface HttpAdapter extends AdapterCommon {
  transport: 'http';
  url: string;
  headers?: Record<string, string>;
}

/** A product that is an OpenAI-compatible model plus a system prompt. */
export interface OpenAiAdapter extends AdapterCommon {
  transport: 'openai';
  baseUrl: string;
  model: string;
  /** A text file with the product's system prompt, relative to the adapter file. */
  systemPromptFile: string;
  /** The name of the environment variable holding the key (never the key itself). */
  apiKeyEnv?: string;
}

/** Any adapter. */
export type AdapterConfig = CommandAdapter | HttpAdapter | OpenAiAdapter;

/** An adapter plus where it was read from (for relative paths). */
export interface LoadedAdapter {
  config: AdapterConfig;
  /** The folder relative paths in the config are read from. */
  baseDir: string;
  /** Where it came from, for messages and the report. */
  source: string;
}

/** The adapter description is missing or wrong. The message says how to fix it. */
export class AdapterError extends Error {
  override readonly name = 'AdapterError';
}

/**
 * Reads `--adapter`: a URL, a .json file, or a .ts/.mjs/.js module exporting `adapter`. Two suffixes make versions
 * and access levels easy to compare: `file.ts#other` reads the export `other` instead of `adapter`, and `...@read_only`
 * sets the access level (integrations/adapter/access.ts), overriding the file's.
 */
export async function loadAdapter(spec: string, cwd = process.cwd()): Promise<LoadedAdapter> {
  const at = /@([a-z_]+)$/.exec(spec);
  const base = at !== null ? spec.slice(0, at.index) : spec;
  const loaded = await loadBase(base, cwd, spec);
  if (at?.[1] !== undefined) {
    loaded.config.access = at[1];
    applyAccess(loaded.config, spec);
  }
  return loaded;
}

async function loadBase(spec: string, cwd: string, label: string): Promise<LoadedAdapter> {
  if (/^https?:\/\//i.test(spec)) {
    return {config: {transport: 'http', url: spec}, baseDir: cwd, source: label};
  }
  const hash = /#([A-Za-z_$][\w$]*)$/.exec(spec);
  const exportName = hash?.[1] ?? 'adapter';
  if (hash !== null) spec = spec.slice(0, hash.index);
  const file = path.resolve(cwd, spec);
  if (!fs.existsSync(file)) {
    throw new AdapterError(`No adapter at ${file}. Pass a file (overthink.adapter.ts) or a URL.`);
  }
  let raw: unknown;
  if (file.endsWith('.json')) {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else if (/\.(ts|mts|mjs|js)$/.test(file)) {
    const mod: unknown = await import(pathToFileURL(file).href);
    raw = isRecord(mod) ? mod[exportName] : undefined;
    if (raw === undefined)
      throw new AdapterError(`${spec} must export a named \`${exportName}\` object.`);
  } else {
    throw new AdapterError(`${spec}: use a .ts, .mjs, .js or .json file, or a URL.`);
  }
  return {config: checkAdapter(raw, label), baseDir: path.dirname(file), source: label};
}

/** Turns `access` into `scope`. Throws {@link AdapterError} for an unknown level. */
function applyAccess(c: AdapterCommon, where: string): void {
  if (c.access === undefined) return;
  try {
    const scope = accessScope(c.access);
    if (scope === null) delete c.scope;
    else c.scope = scope;
  } catch (e) {
    throw new AdapterError(`${where}: ${(e as Error).message}`);
  }
}

/** Checks an adapter object and returns it typed, or throws {@link AdapterError} naming the problem. */
export function checkAdapter(raw: unknown, where = 'adapter'): AdapterConfig {
  if (!isRecord(raw)) throw new AdapterError(`${where}: the adapter must be an object.`);
  const str = (key: string, required: boolean): string | undefined => {
    const v = raw[key];
    if (v === undefined && !required) return undefined;
    if (typeof v !== 'string' || v.trim() === '') {
      throw new AdapterError(`${where}: "${key}" must be a non-empty string.`);
    }
    return v;
  };
  const num = (key: string): number | undefined => {
    const v = raw[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'number' || !(v > 0))
      throw new AdapterError(`${where}: "${key}" must be a positive number.`);
    return v;
  };
  const common: AdapterCommon = {};
  const name = str('name', false);
  const version = str('version', false);
  const scope = checkScope(raw['scope']);
  const timeoutMs = num('timeoutMs');
  const maxSteps = num('maxSteps');
  if (name !== undefined) common.name = name;
  if (version !== undefined) common.version = version;
  if (scope !== null) common.scope = scope;
  if (timeoutMs !== undefined) common.timeoutMs = timeoutMs;
  if (maxSteps !== undefined) common.maxSteps = maxSteps;
  try {
    const audience = checkAudience(raw['audience'], `${where}: "audience"`);
    if (audience !== null) common.audience = audience;
  } catch (e) {
    throw new AdapterError((e as Error).message);
  }
  const access = str('access', false);
  if (access !== undefined) {
    if (raw['scope'] !== undefined)
      throw new AdapterError(`${where}: give "access" or "scope", not both.`);
    common.access = access;
    applyAccess(common, where);
  }
  const channels = raw['channels'];
  if (channels !== undefined) {
    if (
      !Array.isArray(channels) ||
      !channels.every((c) => typeof c === 'string') ||
      channels.length === 0
    )
      throw new AdapterError(`${where}: "channels" must be a non-empty list of channel names.`);
    try {
      common.channels = checkChannels(channels, `${where}: "channels"`);
    } catch (e) {
      throw new AdapterError((e as Error).message);
    }
  }
  switch (raw['transport']) {
    case 'command': {
      const cwd = str('cwd', false);
      return {
        ...common,
        transport: 'command',
        command: str('command', true) ?? '',
        ...(cwd !== undefined ? {cwd} : {}),
      };
    }
    case 'http': {
      const url = str('url', true) ?? '';
      if (!/^https?:\/\//.test(url))
        throw new AdapterError(`${where}: "url" must start with http:// or https://.`);
      const headers = raw['headers'];
      if (headers !== undefined && !isStringMap(headers)) {
        throw new AdapterError(`${where}: "headers" must map names to strings.`);
      }
      return {...common, transport: 'http', url, ...(headers !== undefined ? {headers} : {})};
    }
    case 'openai': {
      const apiKeyEnv = str('apiKeyEnv', false);
      return {
        ...common,
        transport: 'openai',
        baseUrl: str('baseUrl', true) ?? '',
        model: str('model', true) ?? '',
        systemPromptFile: str('systemPromptFile', true) ?? '',
        ...(apiKeyEnv !== undefined ? {apiKeyEnv} : {}),
      };
    }
    default:
      throw new AdapterError(`${where}: "transport" must be "command", "http" or "openai".`);
  }
}

/** Opens the transport an adapter describes. The caller closes it. */
export function openTransport(a: LoadedAdapter, env: NodeJS.ProcessEnv = process.env): Transport {
  const c = a.config;
  const timeout = c.timeoutMs !== undefined ? {timeoutMs: c.timeoutMs} : {};
  switch (c.transport) {
    case 'command':
      return commandTransport({
        command: c.command,
        cwd: path.resolve(a.baseDir, c.cwd ?? '.'),
        ...timeout,
      });
    case 'http':
      return httpTransport({
        url: c.url,
        ...(c.headers !== undefined ? {headers: c.headers} : {}),
        ...timeout,
      });
    case 'openai': {
      const promptFile = path.resolve(a.baseDir, c.systemPromptFile);
      if (!fs.existsSync(promptFile))
        throw new AdapterError(`The system prompt file ${promptFile} does not exist.`);
      const apiKey = c.apiKeyEnv !== undefined ? env[c.apiKeyEnv] : undefined;
      if (c.apiKeyEnv !== undefined && apiKey === undefined) {
        throw new AdapterError(`The adapter reads its key from $${c.apiKeyEnv}, which is not set.`);
      }
      return openAiTransport({
        baseUrl: c.baseUrl,
        model: c.model,
        systemPrompt: fs.readFileSync(promptFile, 'utf8'),
        ...(apiKey !== undefined ? {apiKey} : {}),
        ...timeout,
      });
    }
  }
}

/** A label for the report: the adapter's name and version, or where it came from. */
export function adapterLabel(a: LoadedAdapter): string {
  const access = a.config.access !== undefined ? ` (${a.config.access})` : '';
  return `${a.config.name ?? a.source}${a.config.version !== undefined ? ` ${a.config.version}` : ''}${access}`;
}

function isStringMap(x: unknown): x is Record<string, string> {
  return isRecord(x) && Object.values(x).every((v) => typeof v === 'string');
}
