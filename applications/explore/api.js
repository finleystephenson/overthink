// How the explorer reaches the world. Everything goes through applications/lib/client.js (the one way a screen reaches a
// world) plus the explorer's own read-only routes (infrastructure/server/explore.mjs), sent with this tab's owner token.
// Extra worlds for a what-if's repeats and alternatives are made and thrown away here too, through the same web API.
import { getClient } from "../lib/client.js";

export const world = getClient();

/** True when the server says the sandbox has gone (restarted or idle), so the client should heal and retry. */
const gone = (status, json) => status === 401 || (status === 404 && /^No sandbox/.test(json?.error?.message || ""));

async function getJson(url, token) {
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

/**
 * One of the explorer's reads: graph, search, entity/<kind>/<id>, timeline, pulses, compare, starts.
 * @param {string} path
 * @param {Object<string, *>=} params
 */
export async function ex(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "")).toString();
  for (let attempt = 0; attempt < 2; attempt++) {
    const info = await world.connectInfo();
    const { res, json } = await getJson(`/sandboxes/${info.sandboxId}/explore/${path}${qs ? `?${qs}` : ""}`, info.token);
    if (res.ok && json.ok !== false) return json.data;
    // A sandbox that went away heals through the client (it makes a new one), then the read is tried once more.
    if (attempt === 0 && gone(res.status, json)) { await world.clock(); continue; }
    throw Object.assign(new Error(json.error?.message || "The world did not answer."), { status: res.status });
  }
}

/** The world this tab looks at, as a handle a what-if can drive. */
export function mainHandle() {
  return {
    main: true,
    call: async (tool, input) => world.call(tool, input),
    advance: (days) => world.advance(days),
    impact: () => world.impact(),
    compare: () => ex("compare"),
    clock: () => world.clock(),
  };
}

/**
 * A separate, private copy of the world (for a repeat or an alternative). Thrown away with remove().
 * @param {{size: string, scenario?: string, seed: number}} o
 */
export async function extraWorld({ size, scenario = "normal", seed }) {
  const res = await fetch("/sandboxes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ size, scenario, seed }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || "Could not make another copy of the world.");
  const { id, token } = json.data;
  const send = async (method, path, body, role) => {
    const r = await fetch(path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(role ? { "X-Role": role } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `The copy answered ${r.status}.`);
    return j;
  };
  return {
    main: false, id, token,
    call: (tool, input) => send("POST", `/tools/${tool}`, input || {}, "manager"),
    advance: async (days) => (await send("POST", `/sandboxes/${id}/advance`, { days })).data,
    impact: async () => ({ available: true, ...(await send("GET", `/sandboxes/${id}/impact`)).data }),
    compare: async () => (await send("GET", `/sandboxes/${id}/explore/compare`)).data,
    clock: async () => (await send("GET", `/sandboxes/${id}/clock`)).data,
    remove: () => send("DELETE", `/sandboxes/${id}`).catch(() => null),
  };
}

let labProbe = null;
/**
 * The lab's routes (simulation/lab/routes.mjs), when this server has them. Null until then: the what-if runs on the live
 * sandbox instead. Looked up once, from /openapi.json and a direct probe.
 */
export function lab() {
  labProbe ||= (async () => {
    for (const path of ["/lab/interventions", "/lab"]) {
      try {
        const r = await fetch(path, { headers: { Accept: "application/json" } });
        if (!r.ok) continue;
        const j = await r.json().catch(() => null);
        if (j && j.ok !== false) return { base: "/lab", root: j.data ?? j };
      } catch { /* no lab here */ }
    }
    return null;
  })();
  return labProbe;
}

/** The server's ready jobs (GET /jobs), or [] when it has none. */
export async function serverJobs() {
  try { const r = await fetch("/jobs"); const j = await r.json(); return Array.isArray(j.data) ? j.data : []; } catch { return []; }
}

/** A call to one of this world's own routes as its owner: /sandboxes/:id/<path>. */
export async function ownerRoute(method, path, body) {
  const info = await world.connectInfo();
  const res = await fetch(`/sandboxes/${info.sandboxId}/${path}`, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${info.token}` }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error?.message || "The world did not answer.");
  return json.data;
}
