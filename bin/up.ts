/**
 * @fileoverview `overthink up`: a live sandbox of Overthought & Co. for the developer's agent to work in.
 *
 * One local server, one sandbox. It serves the company's apps (the sandbox desktop at /), the business tools a product uses
 * (web API and /mcp), and the activity toolset the agent uses to create people and activity, move time, observe
 * and reset (/mcp/activity, /sandboxes/{id}/activity). With --adapter the product is deployed on its channels and
 * answers the activity that reaches them. The address and the owner key go to .overthink/sandbox.json, where
 * `overthink act` finds them. It runs until Ctrl+C.
 */
import type {AddressInfo} from 'node:net';
import {SandboxStore} from '../infrastructure/server/sandboxes.mjs';
import {createApp} from '../infrastructure/server/http.mjs';
import {clearSession, writeSession} from '../infrastructure/session.ts';
import {openActivity} from '../activity-generation/api.ts';
import {deployProduct} from '../integrations/deploy.ts';
import type {LoadedAdapter} from '../integrations/adapter/load.ts';
import {adapterLabel, openTransport} from '../integrations/adapter/load.ts';
import {jobFor} from '../simulation/twin-run/jobs.ts';

/** The default port: the one `npm start` uses too, since only one of them runs at a time. */
export const UP_PORT = 4747;

/** What `up` needs. */
export interface UpOptions {
  port: number;
  size: 'demo' | 'standard';
  adapter: LoadedAdapter | null;
  /** The job the product does (its role and instructions), when an adapter is given. */
  job: string;
  onReady?: (url: string) => void;
}

/** Starts the sandbox and resolves when Ctrl+C stops it. */
export async function up(o: UpOptions): Promise<number> {
  const store = new SandboxStore({maxSandboxes: 4});
  const {sandbox, token} = store.create({size: o.size});
  // Scheduled activity must run even if the agent only ever moves time through the plain advance route.
  openActivity(store, sandbox, {via: 'cli'});
  const transport = o.adapter === null ? null : openTransport(o.adapter);
  if (o.adapter !== null && transport !== null) {
    const job = jobFor(o.job);
    deployProduct({
      store,
      sandbox,
      transport,
      channels: o.adapter.config.channels ?? ['email', 'web_chat'],
      role: job.role,
      scope: o.adapter.config.scope ?? null,
      instructions: job.instructions,
      ...(o.adapter.config.maxSteps === undefined ? {} : {maxSteps: o.adapter.config.maxSteps}),
    });
  }
  const server = createApp({
    store,
    allowedHosts: ['127.0.0.1', 'localhost', '[::1]'],
    rateLimit: 6000,
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, '127.0.0.1', () => {
      resolve();
    });
  }).catch((e: unknown) => {
    const code = (e as {code?: string}).code;
    throw new Error(
      code === 'EADDRINUSE' ? `Port ${o.port} is busy. Try --port ${o.port + 1}.` : String(e),
    );
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const file = writeSession({
    url,
    sandbox: sandbox.id,
    key: token,
    pid: process.pid,
    started_at: new Date().toISOString(),
  });
  // WHY the key in the fragment: a browser never sends it to a server, so it stays out of logs; the apps read it
  // once, keep it for the tab, and remove it from the address bar.
  const open = `${url}/#sandbox=${sandbox.id}&key=${token}`;
  console.log(`Overthought & Co. is running in a sandbox (${o.size}, id ${sandbox.id}).

  The sandbox desktop:           ${open}
  Activity, for your agent:      claude mcp add --transport http overthink-activity ${url}/mcp/activity --header "Authorization: Bearer ${token}"
                                 or: overthink act <action> ...   (overthink act --help)
  The business, for a product:   ${url}/mcp and ${url}/tools/{name}   (docs/connect.md)
${o.adapter === null ? '' : `  Deployed:                      ${adapterLabel(o.adapter)} on ${(o.adapter.config.channels ?? ['email', 'web_chat']).join(', ')}\n`}
  Saved for overthink act: ${file}
  Stop: Ctrl+C.`);
  o.onReady?.(open);
  return new Promise<number>((resolve) => {
    const stop = (): void => {
      clearSession(process.pid);
      void transport?.close();
      server.close(() => {
        resolve(0);
      });
      server.closeAllConnections();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
