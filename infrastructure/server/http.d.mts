// Types for the parts of infrastructure/server/http.mjs that the TypeScript code uses.
import type {Server} from 'node:http';
import type {SandboxStore} from './sandboxes.mjs';

export function createApp(o: {store: SandboxStore; allowedHosts?: string[] | null; rateLimit?: number}): Server;
/** The file for a static address (/apps/..., /img/...), or null. */
export function resolveStatic(pathname: string): Promise<string | null>;
/** The Content-Security-Policy for one page. */
export function pageCsp(html: string, frameAncestors?: string[]): string;
