export interface Scope {
  read: string[];
  act: string[];
}
/** Checks a scope as given; throws in plain words. */
export function checkScope(s: unknown): Scope | null;
export function isRead(tool: string): boolean;
export function allowed(scope: Scope, tool: string): {ok: boolean; need: 'read' | 'act'; why: string | null};
