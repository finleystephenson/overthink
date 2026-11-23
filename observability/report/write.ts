/**
 * @fileoverview Writes a run's three files: results.json (the truth), summary.md (for chat) and report.html (to
 * open and share).
 */
import fs from 'node:fs';
import path from 'node:path';
import {writeBundle} from '../view/bundle.ts';
import type {SeedBundle} from '../view/bundle.ts';
import {reportHtml} from './html.ts';
import type {Results} from './results.ts';
import {summaryMarkdown} from './summary.ts';

/** Where the files went. */
export interface WrittenReport {
  results: string;
  summary: string;
  html: string;
  /** The saved worlds for `overthink view`, one per seed. */
  worlds: string[];
}

/** Writes the three files into `dir` (created if needed), and each seed's saved world under `dir/view`. */
export function writeReport(
  dir: string,
  results: Results,
  bundles: readonly SeedBundle[] = [],
): WrittenReport {
  fs.mkdirSync(dir, {recursive: true});
  const out: WrittenReport = {
    results: path.join(dir, 'results.json'),
    summary: path.join(dir, 'summary.md'),
    html: path.join(dir, 'report.html'),
    worlds: [],
  };
  // WHY clear first: a folder reused for a shorter run must not offer seeds from the last one.
  fs.rmSync(path.join(dir, 'view'), {recursive: true, force: true});
  for (const b of bundles) out.worlds.push(writeBundle(dir, b));
  fs.writeFileSync(out.results, JSON.stringify(results, null, 2) + '\n');
  fs.writeFileSync(out.summary, summaryMarkdown(results));
  fs.writeFileSync(out.html, reportHtml(results));
  return out;
}
