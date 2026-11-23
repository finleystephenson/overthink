/** POST/GET to an address someone gave us, with the SSRF rules of infrastructure/server/net-guard.mjs. */
export function guardedFetch(
  url: string,
  init?: {method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal},
  o?: {maxBytes?: number},
): Promise<{ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown>}>;
export function checkOutboundUrl(url: string): URL;
export function setOutboundPolicy(p: {allowPrivate: boolean}): void;
