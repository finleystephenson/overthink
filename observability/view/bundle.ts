/**
 * @fileoverview What a run keeps so `overthink view` can open the business afterwards: for each seed, the world at
 * the end of each arm, the product's calls and its marks. One gzipped JSON file per seed in `<out>/view/`.
 *
 * WHY a delta: a whole world is about 2 MB of JSON. Every arm starts from the same fresh world (fixed "now", fixed
 * data), so only the top-level parts of the state that changed are stored, about a quarter of it, and gzip does the
 * rest: roughly 100 KB per arm. The start is rebuilt on load and checked against its hash.
 */
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync, gzipSync} from 'node:zlib';
import type {TraceEntry} from '../../infrastructure/server/sandboxes.mjs';
import type {Mark} from './marks.ts';

/** The format version of a bundle file. */
export const BUNDLE_VERSION = 1;

/** One arm's world, as the parts of the state that differ from the start. */
export interface ArmWorld {
  changed: Record<string, unknown>;
  marks: Mark[];
}

/** Everything kept for one seed. */
export interface SeedBundle {
  version: number;
  seed: number;
  size: string;
  /** sha256 of the starting state, so a changed world is caught instead of shown wrongly. */
  start_hash: string;
  /** The simulated date at the end. */
  now: string;
  with: ArmWorld;
  without: ArmWorld;
  /** The product's calls (results shortened), for the apps' activity views and for checking marks. */
  trace: TraceEntry[];
}

/** The most of one tool result kept in a bundle. */
const MAX_RESULT_CHARS = 2000;

/** The top-level parts of `end` that differ from `start`. */
export function deltaOf(
  start: Record<string, unknown>,
  end: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(end))
    if (JSON.stringify(v) !== JSON.stringify(start[k])) out[k] = v;
  return out;
}

/** The end state: the start with the delta laid over it. */
export function applyDelta(
  start: Record<string, unknown>,
  changed: Record<string, unknown>,
): Record<string, unknown> {
  return {...start, ...changed};
}

/** A short hash of a state's JSON. */
export function stateHash(json: string): string {
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

/** Trace entries as kept: results over the limit are replaced by a note. */
export function slimTrace(trace: readonly TraceEntry[]): TraceEntry[] {
  return trace.map((e) => {
    const r = JSON.stringify(e['result'] ?? null);
    return r.length <= MAX_RESULT_CHARS ? e : {...e, result: {truncated: true, chars: r.length}};
  });
}

/** The file for one seed. */
export function bundlePath(outDir: string, seed: number): string {
  return path.join(outDir, 'view', `seed-${seed}.json.gz`);
}

/** Writes one seed's bundle. */
export function writeBundle(outDir: string, b: SeedBundle): string {
  const file = bundlePath(outDir, b.seed);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, gzipSync(JSON.stringify(b)));
  return file;
}

/** Reads one seed's bundle, or throws saying how to make one. */
export function readBundle(outDir: string, seed: number): SeedBundle {
  const file = bundlePath(outDir, seed);
  if (!fs.existsSync(file))
    throw new Error(
      `No saved world for seed ${seed} in ${outDir}. Run "overthink run" first (it writes ${file}).`,
    );
  const b = JSON.parse(gunzipSync(fs.readFileSync(file)).toString('utf8')) as SeedBundle;
  if (b.version !== BUNDLE_VERSION)
    throw new Error(`${file} was written by another version of Overthink. Run again.`);
  return b;
}

/** The seeds a report folder has worlds for. */
export function savedSeeds(outDir: string): number[] {
  const dir = path.join(outDir, 'view');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => /^seed-(\d+)\.json\.gz$/.exec(f)?.[1])
    .filter((x): x is string => x !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}
