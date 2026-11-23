/**
 * @fileoverview Rummage, the company's search engine (applications/home/), on any local Overthink server: `/` opens it and
 * `/apps/*` serves the company's pages. `overthink view` has its own copy of these routes (observability/view/server.ts); the
 * live run's server (observability/live/server.ts) mounts this one, so a run started with `--live --open` opens Rummage and its
 * live line follows the run from the same address.
 */
import {readFile} from 'node:fs/promises';
import type http from 'node:http';
import path from 'node:path';
import {pageCsp, resolveStatic} from '../../infrastructure/server/http.mjs';

/** The front door's address. */
export const FRONT_DOOR = '/apps/home/';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** Answers `/` and the apps' files. Returns false for anything else, so the caller can answer it. */
export async function serveFrontDoor(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (url.pathname === '/') {
    res.writeHead(302, {Location: FRONT_DOOR}).end();
    return true;
  }
  if (!url.pathname.startsWith('/apps/')) return false;
  const file = await resolveStatic(url.pathname);
  if (file === null) return false;
  // A folder address without its slash would break the page's relative links.
  if (
    file.endsWith(`${path.sep}index.html`) &&
    !url.pathname.endsWith('/') &&
    !url.pathname.endsWith('.html')
  ) {
    res.writeHead(301, {Location: `${url.pathname}/`}).end();
    return true;
  }
  const body = await readFile(file);
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...(type.startsWith('text/html')
      ? {'Content-Security-Policy': pageCsp(body.toString('utf8'))}
      : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
