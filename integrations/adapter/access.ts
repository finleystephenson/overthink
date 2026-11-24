/**
 * @fileoverview Access levels: what the product may read and act on, as named presets over simulation/lab/scope.mjs scopes.
 *
 * Access is something to test, not only to configure: the same product with read-only access and with full access
 * can behave very differently. A preset is a scope (`{read, act}`); `full` means no scope, so the job's role alone
 * decides. Compare two levels with `overthink run --compare product.ts@read_only product.ts@full`.
 */
import type {Scope} from '../../simulation/lab/scope.mjs';

/** The named access levels. */
export const ACCESS_PRESETS: Readonly<Record<string, {scope: Scope | null; what: string}>> = {
  full: {scope: null, what: 'everything the job’s role allows'},
  read_only: {
    scope: {read: ['*'], act: []},
    what: 'reads anything the role can read; changes nothing',
  },
  reply_only: {
    scope: {
      read: ['*'],
      act: [
        'send_email',
        'reply_social_post',
        'send_social_message',
        'send_chat_message',
        'verify_customer',
      ],
    },
    what: 'reads anything; may only write messages (no refunds, orders or records)',
  },
  no_money: {
    scope: {
      read: ['*'],
      act: [
        'email',
        'orders',
        'customers',
        'returns',
        'cases',
        'social',
        'catalogue',
        'stock',
        'knowledge',
        'marketing',
        'calendar',
        'contacts',
      ],
    },
    what: 'everything except refunds, goodwill and the books',
  },
};

/** The preset names, in order. */
export const ACCESS_NAMES: readonly string[] = Object.keys(ACCESS_PRESETS);

/** The scope for a preset name, or throws naming the choices. */
export function accessScope(name: string): Scope | null {
  const p = ACCESS_PRESETS[name];
  if (p === undefined)
    throw new Error(`Unknown access level "${name}". Levels: ${ACCESS_NAMES.join(', ')}.`);
  return p.scope;
}
