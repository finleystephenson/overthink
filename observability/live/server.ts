/**
 * @fileoverview The live endpoint: server-sent events over a run's {@link LiveStream} (docs/live-events.md).
 *
 * WHY server-sent events rather than WebSockets: the feed only flows one way, browsers reconnect by themselves and
 * resend `Last-Event-ID`, and it needs nothing but `node:http`.
 */
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import type {LiveEvent, LiveStream} from './events.ts';
import {LIVE_SCHEMA} from './events.ts';
import {serveFrontDoor} from '../view/front-door.ts';

/** The default port, one above `overthink view`'s. */
export const LIVE_PORT = 8741;

/** How often an idle connection gets a comment line, so proxies and browsers keep it open. */
const PING_MS = 15_000;

/** A running live server. */
export interface LiveServer {
  url: string;
  close(): Promise<void>;
}

/** Serves `stream` on 127.0.0.1. Port 0 picks a free one (tests). */
export async function startLiveServer(stream: LiveStream, port = LIVE_PORT): Promise<LiveServer> {
  const open = new Set<http.ServerResponse>();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    // Read-only data on the loopback interface, so any local page may read it.
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method !== 'GET') {
      res.writeHead(405, {Allow: 'GET'}).end();
      return;
    }
    if (url.pathname === '/live/status') {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(
        JSON.stringify({
          schema: LIVE_SCHEMA,
          run: stream.run,
          state: stream.state,
          events: stream.events.length,
          last_seq: stream.events.at(-1)?.seq ?? 0,
        }),
      );
      return;
    }
    if (url.pathname === '/live/events.jsonl') {
      res.writeHead(200, {'Content-Type': 'application/x-ndjson'});
      res.end(stream.events.map((e) => JSON.stringify(e) + '\n').join(''));
      return;
    }
    if (url.pathname !== '/live/events') {
      // The sandbox desktop opens at / and follows this run from the same address.
      void serveFrontDoor(req, res, url).then((served) => {
        if (!served)
          res.writeHead(404, {'Content-Type': 'text/plain'}).end('Not found. Try /live/events');
      });
      return;
    }
    const since = Number(req.headers['last-event-id'] ?? url.searchParams.get('since') ?? 0) || 0;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (e: LiveEvent): void => {
      res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    for (const e of stream.events) if (e.seq > since) send(e);
    const stop = stream.subscribe(send);
    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
    open.add(res);
    req.on('close', () => {
      stop();
      clearInterval(ping);
      open.delete(res);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const r of open) r.end();
        server.close(() => {
          resolve();
        });
      }),
  };
}
