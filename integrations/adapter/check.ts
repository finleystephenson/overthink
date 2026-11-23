/**
 * @fileoverview `overthink check`: one customer message, one product turn, on a fresh copy of the business.
 * Proves the adapter is wired before a full run: the product is reachable, its answer fits the contract, and its
 * tool calls reach the business with the job's permissions.
 */
import {SandboxStore} from '../../infrastructure/server/sandboxes.mjs';
import type {Scope} from '../../simulation/lab/scope.mjs';
import {sandboxGateway} from './gateway.ts';
import {runProductTurn} from './loop.ts';
import type {CallRecord} from './loop.ts';
import type {Transport} from './transports.ts';

/** What the smoke test found. `ok` is true when the product answered within the contract. */
export interface CheckResult {
  ok: boolean;
  message: string;
  reply: string | null;
  calls: CallRecord[];
  toolsOffered: number;
  error: string | null;
  milliseconds: number;
}

/** Sends one "where is my order?" message from a real customer of the demo world and reports what came back. */
export async function checkAdapter(o: {
  transport: Transport;
  role: string;
  instructions: string;
  scope: Scope | null;
}): Promise<CheckResult> {
  const store = new SandboxStore({maxSandboxes: 1, plugins: []});
  const {sandbox} = store.create({size: 'demo', scenario: 'normal'});
  try {
    const st = sandbox.world.state;
    const order = [...st.orders]
      .reverse()
      .find((x) => x.status === 'dispatched' || x.status === 'delivered');
    const customer =
      order === undefined ? undefined : st.customers.find((c) => c.id === order.customer_id);
    const name = customer?.name ?? 'Mr Toad';
    const message =
      order === undefined
        ? `Hello, this is ${name}. Where is my order?`
        : `Hello, this is ${name}. Where is my order? My order is ${order.number} and my postcode is ${order.delivery.address.postcode}.`;
    const gateway = sandboxGateway({
      store,
      sandbox,
      role: o.role,
      scope: o.scope,
      label: 'overthink check',
    });
    const t0 = performance.now();
    const r = await runProductTurn(
      {
        transport: o.transport,
        gateway,
        sessionId: 'check-1',
        who: {kind: 'customer', name, channel: 'web_chat'},
        now: st.now,
        business: {
          name: sandbox.world.business.name ?? 'Overthought & Co.',
          role: o.role,
          instructions: o.instructions,
        },
      },
      [{role: 'user', content: message}],
    );
    const ok = r.error === null && (r.reply !== null || r.calls.length > 0);
    return {
      ok,
      message,
      reply: r.reply,
      calls: r.calls,
      toolsOffered: gateway.schemas.length,
      error: r.error ?? (ok ? null : 'the product answered with no reply and no tool calls'),
      milliseconds: Math.round(performance.now() - t0),
    };
  } finally {
    store.remove(sandbox.id);
  }
}
