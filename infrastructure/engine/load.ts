/**
 * @fileoverview Reads business/data/ and returns what createWorld needs. Node only (it reads files).
 *
 * Missing files or folders give empty values, so the engine can run on a half-built data folder.
 *
 * The first module moved from JavaScript to TypeScript (docs/typescript-migration.md): small, used by the server,
 * the builder, the benchmark and the tests, with no imports of its own beyond Node.
 */
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

/** A policy, procedure or other Markdown file: its front matter as fields, and the text after it as `body`. */
export interface FrontMatter {
  body: string;
  [field: string]: string | string[];
}

/** What a data folder holds, ready for createWorld. Records are plain JSON, typed loosely on purpose. */
export interface BusinessData {
  business: unknown;
  products: unknown[];
  services: unknown[];
  policies: ({id: string} & FrontMatter)[];
  help: unknown;
  /** Every record list, by name (customers, orders, suppliers ...), from the seed or a built world. */
  seed: Record<string, unknown>;
}

/** Which records to read: the seed (default), a built world of one size, or that world with the stories laid over. */
export interface LoadOptions {
  world?: string;
  bench?: boolean;
}

function readJson(file: string, fallback: unknown): unknown {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as unknown) : fallback;
}

function listFiles(dir: string, ext: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(ext))
        .sort()
    : [];
}

/**
 * Splits "---\nkey: value\n---\nbody" into the front matter's fields plus `body`. Values are plain strings, or
 * lists when written as [a, b]. Text without front matter comes back as `{body: text}`.
 */
export function parseFrontMatter(text: string): FrontMatter {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (m === null) return {body: text};
  const meta: Record<string, string | string[]> = {};
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv?.[1] === undefined) continue;
    const raw = (kv[2] ?? '').trim();
    // WHY strip one layer of quotes: front matter is hand-written, and "Returns" and Returns mean the same.
    meta[kv[1]] = /^\[.*\]$/.test(raw)
      ? raw
          .slice(1, -1)
          .split(',')
          .map((x) => x.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      : raw.replace(/^["']|["']$/g, '');
  }
  return {...meta, body: m[2] ?? ''};
}

/**
 * Reads a data folder. With `{world: "demo" | "standard"}` the records come from business/data/world/<size>/ (every
 * collection, including suppliers, ledger and the rest) instead of business/data/seed/. With `{bench: true}` they
 * come from business/data/world-bench/<size>/: the same business with the hand-written stories laid over it, which
 * the benchmark scenarios rely on.
 * @throws Error naming the build command when the asked-for world has not been built.
 */
export function loadData(dir: string, {world, bench = false}: LoadOptions = {}): BusinessData {
  const business = readJson(join(dir, 'business.json'), null);
  const products = listFiles(join(dir, 'products'), '.json').map((f) =>
    readJson(join(dir, 'products', f), null),
  );
  const services = listFiles(join(dir, 'services'), '.json').map((f) =>
    readJson(join(dir, 'services', f), null),
  );
  const policies = listFiles(join(dir, 'policies'), '.md').map((f) => ({
    id: f.replace(/\.md$/, ''),
    ...parseFrontMatter(readFileSync(join(dir, 'policies', f), 'utf8')),
  }));
  const help = readJson(join(dir, 'help.json'), []);
  const seedDir = world ? join(dir, bench ? 'world-bench' : 'world', world) : join(dir, 'seed');
  if (world && !existsSync(seedDir))
    throw new Error(
      `No world at ${seedDir}. Build it: node business/builder/build-world.mjs --size ${world}${bench ? ' --stories' : ''}`,
    );
  const seed: Record<string, unknown> = {};
  for (const f of listFiles(seedDir, '.json'))
    seed[f.replace(/\.json$/, '')] = readJson(join(seedDir, f), null);
  return {business, products, services, policies, help, seed};
}
