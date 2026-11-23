/**
 * @fileoverview The cast: turns each contact the simulator raises into a briefed customer with a persona.
 *
 * Everything a persona is built from is the same in both arms of a twin run: the contact itself (drawn from common
 * random numbers), the situation plan for the run, the population's circumstances, and the business as it was at the
 * start (for the customer's history and for "someone else" in the situations that need one). So the same contact gets
 * the same brief, and with a people model, the same words from the cache.
 */
import type {ContactItem, ToolPayload} from '../simulator/core.d.mts';
import {traitsFor} from '../world/population.mjs';
import {briefFor} from '../../activity-generation/people/brief.ts';
import type {CustomerBrief} from '../../activity-generation/people/brief.ts';
import {
  PLAIN,
  buildPersona,
  drawSituation,
  unit,
} from '../../activity-generation/people/personas.ts';
import type {OtherPerson} from '../../activity-generation/people/personas.ts';

/** The business at the start of an arm: only what personas read. */
export interface StartRecords {
  customers: readonly {id: string; name: string; email?: string}[];
  orders: readonly {
    number: string;
    customer_id: string;
    delivery?: {address?: {postcode?: string; line1?: string}};
  }[];
}

/** Briefs customers for one seed. */
export interface Cast {
  briefFor(item: ContactItem, payload: ToolPayload, productName: string | null): CustomerBrief;
}

/** The same contact in both arms: its arrival time, customer and topic (all drawn from common random numbers). */
export function contactKey(item: ContactItem, payload: ToolPayload): string {
  return `${item.at ?? payload.sim.date}|${item.cid ?? item.name}|${item.topic}`;
}

/** The key a contact has in the run's situation plan. */
export function planKey(seed: number, key: string): string {
  return `${seed}|${key}`;
}

/** Makes the cast for one seed. `plan` maps plan keys to situation ids; contacts it lacks get an independent draw. */
export function makeCast(o: {
  seed: number;
  plan: ReadonlyMap<string, string> | null;
  population: unknown;
  start: StartRecords;
}): Cast {
  const ordersBy = new Map<string, StartRecords['orders'][number][]>();
  for (const ord of o.start.orders) {
    const list = ordersBy.get(ord.customer_id) ?? [];
    list.push(ord);
    ordersBy.set(ord.customer_id, list);
  }
  const withOrders = o.start.customers.filter((c) => ordersBy.has(c.id));
  const otherFor = (key: string, self: string | null): OtherPerson | null => {
    const pool = withOrders.filter((c) => c.id !== self);
    const c = pool[Math.floor(unit(`other|${key}`) * pool.length)];
    if (c === undefined) return null;
    const ord = ordersBy.get(c.id)?.at(-1);
    return {
      name: c.name,
      email: c.email ?? null,
      postcode: ord?.delivery?.address?.postcode ?? null,
      line1: ord?.delivery?.address?.line1 ?? null,
      order: ord?.number ?? null,
    };
  };
  return {
    briefFor(item, payload, productName) {
      const key = planKey(o.seed, contactKey(item, payload));
      const situation =
        o.plan?.get(key) ??
        (o.plan === null
          ? PLAIN.id
          : drawSituation({key, topic: item.topic, channel: item.channel}));
      const c = item.customer;
      const persona = buildPersona({
        key,
        situation,
        topic: item.topic,
        name: c.name,
        order: item.order,
        postcode: item.postcode,
        product: productName,
        circumstances: o.population === null ? null : traitsFor(c, o.population),
        pastOrders: c.id != null ? (ordersBy.get(c.id)?.length ?? 0) : null,
        memory: c.memo?.bad === true ? c.memo.text : null,
        other: otherFor(key, c.id ?? null),
      });
      return briefFor(item, productName, persona);
    },
  };
}
