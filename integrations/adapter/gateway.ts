/**
 * @fileoverview The business tools a product may use, and the one door their calls go through.
 *
 * Calls run in the engine with the product's role (so the engine's own rules apply: verification, refund limits,
 * who may do what) and are written to the sandbox trace with the conversation's session id, which is how the
 * simulator later judges the contact from records. A scope narrows the role further; a call outside it is refused
 * with `out_of_scope` before the engine sees it, and is recorded like any other call.
 */
import {allowed} from '../../simulation/lab/scope.mjs';
import type {Scope} from '../../simulation/lab/scope.mjs';
import type {
  EngineToolInfo,
  Principal,
  Sandbox,
  SandboxStore,
} from '../../infrastructure/server/sandboxes.mjs';
import type {ToolSchema} from './contract.ts';

/** What one tool call did. `code` is the engine's error code when it failed. */
export interface ToolOutcome {
  ok: boolean;
  data?: unknown;
  error?: {code: string; message: string};
}

/** The tools a product may use, and how to call them. */
export interface ToolGateway {
  readonly role: string;
  readonly schemas: readonly ToolSchema[];
  call(session: string, name: string, args: Record<string, unknown>): ToolOutcome;
}

/** Refusal codes that mean "the rules said no", as opposed to "that order does not exist". */
export const REFUSAL_CODES: ReadonlySet<string> = new Set([
  'forbidden',
  'rule_violation',
  'out_of_scope',
]);

/**
 * Returns the engine's tools as OpenAI function schemas, keeping only those the role may use and the scope allows.
 */
export function schemasFor(
  tools: readonly EngineToolInfo[],
  role: string,
  scope: Scope | null,
): ToolSchema[] {
  return tools
    .filter((t) => t.roles.includes(role) && (scope === null || allowed(scope, t.name).ok))
    .map((t) => ({
      type: 'function',
      function: {name: t.name, description: t.description, parameters: t.input_schema},
    }));
}

/** Makes a gateway over a sandbox from infrastructure/server/sandboxes.mjs. */
export function sandboxGateway(o: {
  store: SandboxStore;
  sandbox: Sandbox;
  role: string;
  scope?: Scope | null;
  label?: string;
}): ToolGateway {
  const scope = o.scope ?? null;
  const minted = o.store.mintRoleToken(o.sandbox, {
    role: o.role,
    label: o.label ?? 'overthink product',
  });
  const principal: Principal | undefined = o.sandbox.tokens.find((t) => t.id === minted.id);
  if (principal === undefined) throw new Error('the sandbox lost the token it just made');
  return {
    role: o.role,
    schemas: schemasFor(o.sandbox.world.tools, o.role, scope),
    call(session, name, args) {
      const verdict = scope === null ? null : allowed(scope, name);
      if (verdict !== null && !verdict.ok) {
        const error = {
          code: 'out_of_scope',
          message: verdict.why ?? `${name} is outside this product's scope.`,
        };
        o.store.record(o.sandbox, {
          kind: 'tool',
          via: 'overthink',
          actor: {token: principal.id, role: o.role, session},
          tool: name,
          input: args,
          ok: false,
          error,
          changes: [],
        });
        return {ok: false, error};
      }
      const r = o.store.call(
        o.sandbox,
        principal,
        {role: o.role, session, via: 'overthink'},
        name,
        args,
      );
      return r.ok ? {ok: true, data: r.data} : {ok: false, error: r.error};
    },
  };
}
