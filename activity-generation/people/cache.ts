/**
 * @fileoverview A content-addressed cache for people-model calls, on disk.
 *
 * The key is a hash of everything that shapes the answer (model, prompt, conversation so far, settings). So in a
 * twin run the "with" and "without" arms share identical customer text for as long as their conversations are
 * identical, and a rerun of the same run costs nothing and gives the same words. Once the product says something
 * different, the key changes and the customer answers afresh, which is right.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {ChatResult} from './provider.ts';

/** Hits and misses so far, for the report. */
export interface CacheStats {
  hits: number;
  misses: number;
}

/** A cache of model answers by request key. */
export interface ResponseCache {
  get(key: string): ChatResult | null;
  set(key: string, value: ChatResult): void;
  readonly stats: CacheStats;
}

/**
 * Opens a cache in `dir` (created on first write), or an in-memory one when `dir` is null. Entries are one small
 * JSON file each, fanned out by the first two hex digits so no folder grows huge.
 */
export function openCache(dir: string | null): ResponseCache {
  const memory = new Map<string, ChatResult>();
  const stats: CacheStats = {hits: 0, misses: 0};
  const fileFor = (key: string): string | null =>
    dir === null ? null : path.join(dir, key.slice(0, 2), `${key}.json`);
  return {
    stats,
    get(key) {
      let hit = memory.get(key) ?? null;
      const file = fileFor(key);
      if (hit === null && file !== null && fs.existsSync(file)) {
        hit = JSON.parse(fs.readFileSync(file, 'utf8')) as ChatResult;
        memory.set(key, hit);
      }
      if (hit === null) stats.misses++;
      else stats.hits++;
      return hit;
    },
    set(key, value) {
      memory.set(key, value);
      const file = fileFor(key);
      if (file === null) return;
      fs.mkdirSync(path.dirname(file), {recursive: true});
      // Write then rename, so a run stopped mid-write never leaves half a file that a rerun would trust.
      const tmp = `${file}.${String(process.pid)}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(value));
      fs.renameSync(tmp, file);
    },
  };
}
