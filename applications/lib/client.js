// The one way an app reaches a world.
// Apps call createClient() (or getClient() for the shared one) and never talk to the server themselves.
// WHY a back end object: today the world lives in a sandbox on the local server; later it will run inside
// the browser for the public demo. Both only have to provide the small set of methods in httpBackend below.

const SANDBOX_KEY = "ot-sandbox";
const POLL_MS = 2000;
const MAX_DAYS_PER_CALL = 366;  // the server takes at most a year per request

/** The engine session name for reads a screen makes to draw itself. Exported so apps can filter the record. */
export const SCREEN_SESSION = "screen";

/** True for a trace entry a screen made only to draw itself (not something a person or an AI did). */
export function isScreenRead(entry) {
  return entry?.actor?.session === SCREEN_SESSION;
}

/** A failed request to the back end. `code` follows the server's error codes (unauthorized, not_found, ...). */
export class ClientError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number=} status HTTP status, when there was one.
   */
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Reads and writes small values without ever throwing. Private windows and blocked storage
 * make storage throw, and the apps must still work then (they just forget between pages).
 * @param {Storage|undefined} store
 */
function safeStore(store) {
  return {
    get(key) {
      try { return JSON.parse(store.getItem(key)); } catch { return null; }
    },
    set(key, value) {
      try { store.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: keep going */ }
    },
    remove(key) {
      try { store.removeItem(key); } catch { /* storage blocked: keep going */ }
    },
  };
}

/**
 * A sandbox handed over in the address, as `overthink up` prints it: #sandbox=<id>&key=<owner key>. Kept for this
 * tab, then taken out of the address bar. WHY the fragment: browsers never send it to a server, so the key stays
 * out of logs and the Referer header.
 * @param {{set: function(string, *): void}} saved
 */
function adoptFromAddress(saved) {
  try {
    const params = new URLSearchParams(String(globalThis.location?.hash || "").slice(1));
    const id = params.get("sandbox"), key = params.get("key");
    if (!id || !key) return;
    // The owner key is always the sandbox's first token (infrastructure/server/sandboxes.mjs create).
    saved.set(SANDBOX_KEY, { id, token: key, ownerTokenId: "tok_1" });
    globalThis.history?.replaceState(null, "", globalThis.location.pathname + globalThis.location.search);
  } catch { /* not a browser, or no history: keep going */ }
}

/**
 * The web API back end: one sandbox on the local server, created on first use.
 * The owner token is kept in sessionStorage so every app opened in this tab shares the same world.
 * @param {{baseUrl: string, storage?: Storage}} options
 */
export function httpBackend({ baseUrl, storage = globalThis.sessionStorage }) {
  const saved = safeStore(storage);
  adoptFromAddress(saved);
  let sandbox = saved.get(SANDBOX_KEY);  // { id, token, ownerTokenId }
  let creating = null;
  let impactRoute = null;  // whether the server has GET /sandboxes/:id/impact, read once from /openapi.json

  // The server says "No sandbox <id>." when a sandbox has gone; any other 404 is a missing route.
  const gone = (e) => e.status === 401 || (e.status === 404 && /^No sandbox/.test(e.message));

  async function request(method, path, { body, token, role, session } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (role) headers["X-Role"] = role;
    if (session) headers["X-Session-Id"] = session;
    let res;
    try {
      res = await fetch(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ClientError("offline", "The business could not be reached. Is the server running?");
    }
    const json = await res.json().catch(() => ({}));
    // HTTP errors are problems with the request itself. A business refusal is HTTP 200 with ok: false,
    // and is handed back to the app as an answer, not thrown.
    if (!res.ok) throw new ClientError(json.error?.code || "http", json.error?.message || `The server answered ${res.status}.`, res.status);
    return json;
  }

  async function create() {
    // The standard world: busy enough that a job has real work in a week (the demo world gets two contacts a week).
    const json = await request("POST", "/sandboxes", { body: { size: "standard", scenario: "normal" } });
    const owner = json.data.tokens.find((t) => t.owner);
    sandbox = { id: json.data.id, token: json.data.token, ownerTokenId: owner?.id ?? null };
    saved.set(SANDBOX_KEY, sandbox);
    return sandbox;
  }

  let checking = null;  // one check of a saved sandbox, shared by every call made while it runs

  /**
   * The sandbox, made on first use. Two apps asking at once share one creation.
   * WHY the check: a sandbox saved in this tab may have gone (the server restarted). Checking it once, before the
   * page's first burst of calls, heals with one failed request instead of one per call.
   */
  async function ensure() {
    if (sandbox && !checking) {
      const sb = sandbox;
      checking = request("GET", `/sandboxes/${sb.id}/clock`, { token: sb.token }).then(() => true).catch((e) => {
        if (gone(e) && sandbox === sb) { sandbox = null; saved.remove(SANDBOX_KEY); }
        return true;
      });
    }
    if (checking) await checking;
    if (sandbox) return sandbox;
    creating ||= create().finally(() => { creating = null; });
    return creating;
  }

  /**
   * Runs a request against the sandbox. If the sandbox has gone (server restarted, or idle for two hours),
   * makes a new one once and tries again, so a stale tab heals itself instead of showing an error.
   */
  async function withSandbox(fn) {
    const sb = await ensure();
    try {
      return await fn(sb);
    } catch (e) {
      if (!gone(e)) throw e;
      sandbox = null;
      saved.remove(SANDBOX_KEY);
      return fn(await ensure());
    }
  }

  return {
    kind: "http",
    ensure,
    /** The simulator's clock: { now, date, day, seed, scale, started }. Null on a server without the route. */
    async simClock() {
      return withSandbox(async (sb) => {
        try {
          return (await request("GET", `/sandboxes/${sb.id}/clock`, { token: sb.token })).data;
        } catch (e) {
          if (e.status === 404 && !gone(e)) return null;
          throw e;
        }
      });
    },
    async describe() {
      return withSandbox(async (sb) => (await request("GET", `/sandboxes/${sb.id}`, { token: sb.token })).data);
    },
    async call(tool, input, role, session) {
      return withSandbox((sb) => request("POST", `/tools/${encodeURIComponent(tool)}`, { token: sb.token, role, session, body: input || {} }));
    },
    async advance(days) {
      return withSandbox(async (sb) => {
        try {
          const json = await request("POST", `/sandboxes/${sb.id}/advance`, { token: sb.token, body: { days } });
          return json.data;
        } catch (e) {
          // Only a server with no advance route at all falls back to the engine's advance_day. A live sandbox
          // refuses advance_day once its simulator has started, so this never runs where the route exists.
          if (e.status !== 404 || gone(e)) throw e;
          const out = [];
          for (let d = 0; d < days; d++) {
            const r = await request("POST", "/tools/advance_day", { token: sb.token, role: "manager", body: {} });
            out.push(r.ok ? r.data : r.error);
          }
          return { now: out.at(-1)?.now, days: out };
        }
      });
    },
    async impact() {
      // Asking a route that does not exist would log a 404 in the console on every check, so look it up first.
      impactRoute ??= request("GET", "/openapi.json").then((j) => Object.keys(j.paths || {}).some((p) => /\/impact$/.test(p))).catch(() => false);
      if (!(await impactRoute)) return { available: false };
      return withSandbox(async (sb) => {
        try {
          const json = await request("GET", `/sandboxes/${sb.id}/impact`, { token: sb.token });
          return { available: true, ...json.data };
        } catch (e) {
          if (e.status === 404 && !gone(e)) return { available: false };
          throw e;
        }
      });
    },
    async trace(since) {
      return withSandbox(async (sb) => (await request("GET", `/sandboxes/${sb.id}/trace?since=${since}`, { token: sb.token })).data.calls);
    },
    async reset() {
      return withSandbox(async (sb) => (await request("POST", `/sandboxes/${sb.id}/reset`, { token: sb.token })).data);
    },
    async tools(role) {
      return withSandbox(async (sb) => (await request("GET", "/tools", { token: sb.token, role })).data.tools);
    },
    async mintToken(role) {
      return withSandbox(async (sb) => (await request("POST", `/sandboxes/${sb.id}/tokens`, { token: sb.token, body: { role, label: "my AI" } })).data);
    },
    async inbox(status) {
      return withSandbox(async (sb) => (await request("GET", `/sandboxes/${sb.id}/inbox?status=${encodeURIComponent(status)}`, { token: sb.token })).data);
    },
    async inboxReply(messageId, text, role) {
      return withSandbox((sb) => request("POST", `/sandboxes/${sb.id}/inbox/${encodeURIComponent(messageId)}/reply`, { token: sb.token, role, body: { text } }));
    },
    async info() {
      const sb = await ensure();
      return { baseUrl, sandboxId: sb.id, token: sb.token, ownerTokenId: sb.ownerTokenId };
    },
  };
}

/**
 * The client every app uses.
 *
 * @param {{baseUrl?: string, backend?: object, storage?: Storage}=} options
 *   baseUrl: where the web API is (defaults to this page's own address, because applications/dev.mjs serves both).
 *   backend: anything with httpBackend's methods, for example an in-browser engine later.
 * @return {{
 *   call: function(string, object=, {role?: string, screen?: boolean}=): Promise<{ok: boolean, data?: *, error?: {code: string, message: string}}>,
 *   clock: function(): Promise<{now: string, sandbox: string, size: string, scenario: string, calls: number, day: ?number, started: ?boolean}>,
 *   advance: function(number): Promise<{now: string, days: Array<object>, clock: ?object}>,
 *   impact: function(): Promise<{available: boolean, days_compared?: number, measures?: object, series?: object}>,
 *   activity: function({since?: number}=): Promise<{entries: Array<object>, last: number}>,
 *   onChange: function(function(object)): function(),
 *   reset: function(): Promise<object>,
 *   tools: function({role?: string}=): Promise<Array<object>>,
 *   connectInfo: function(): Promise<object>,
 *   mintToken: function(string): Promise<object>,
 *   eventLibrary: function(): Promise<Array<object>>,
 *   inbox: function({status?: string}=): Promise<Array<object>>,
 *   inboxReply: function(string, string, {role?: string}=): Promise<{ok: boolean, data?: object, error?: object}>,
 *   roleFor: function(string): Promise<string>,
 * }}
 */
export function createClient({ baseUrl = defaultBaseUrl(), backend = null, storage } = {}) {
  const be = backend || httpBackend({ baseUrl, storage });
  const listeners = new Set();
  // Nobody is "at the computer": the person looking can do everything. Each tool is called as a job that is
  // allowed to use it, chosen here once per tool (the manager when allowed). Roles stay only for outside AI keys.
  const role = "manager";
  let toolRoles = null;  // promise of Map tool name -> allowed roles
  let poll = { timer: null, lastSeq: null, lastNow: null, busy: false };

  const PREFERRED = ["manager", "support_lead", "support_agent", "finance", "buyer", "warehouse", "marketing", "technician", "coordinator", "operations_assistant", "assistant"];

  /** The job to call a tool as. Read from the tool list once; a failed read falls back to the manager. */
  async function roleFor(tool) {
    toolRoles ||= be.tools(undefined).then((list) => new Map(list.map((t) => [t.name, t.roles || []]))).catch(() => {
      toolRoles = null;
      return new Map();
    });
    const allowed = (await toolRoles).get(tool) || [];
    if (!allowed.length || allowed.includes(role)) return role;
    return PREFERRED.find((r) => allowed.includes(r)) || allowed[0];
  }

  function emit(change) {
    for (const fn of listeners) {
      try { fn(change); } catch (e) { console.error(e); }
    }
  }

  /**
   * One look at the world: has the clock moved, was it reset, are there new actions?
   * WHY polling: the server has no push channel, and an outside AI may act at any moment.
   */
  async function check() {
    if (poll.busy || document.hidden) return;
    poll.busy = true;
    try {
      const d = await be.describe();
      const wasReset = poll.lastSeq != null && d.calls < poll.lastSeq;
      if (poll.lastSeq == null || wasReset) poll.lastSeq = wasReset ? 0 : d.calls;
      const entries = d.calls > poll.lastSeq ? await be.trace(poll.lastSeq) : [];
      if (entries.length) poll.lastSeq = entries.at(-1).seq;
      const moved = poll.lastNow != null && d.now !== poll.lastNow;
      if (entries.length || moved || wasReset) emit({ entries, now: d.now, previousNow: poll.lastNow, reset: wasReset, source: "poll" });
      poll.lastNow = d.now;
    } catch (e) {
      if (e.code !== "offline") console.warn(e.message);
    } finally {
      poll.busy = false;
    }
  }

  const client = {
    /** Kept for old callers: the job used when a tool allows the manager. Not something a person chooses. */
    get role() { return role; },
    /** Kept so old callers do not break. Does nothing: there is no "who is at the computer" any more. */
    setRole() {},
    /**
     * Calls a tool as the current role (or `role`). `screen: true` marks a call the screen makes only to show
     * figures: it is still traced, but in the "screen" session, so the record can leave it out.
     */
    async call(tool, input = {}, { role: as, screen = false } = {}) {
      return be.call(tool, input, as || await roleFor(tool), screen ? SCREEN_SESSION : undefined);
    },
    /** The job a tool is called as when no sender is named: the manager if allowed, else the first staff job that is. */
    roleFor: (tool) => roleFor(tool),
    /** Where the simulated clock is, and (when the server has it) the simulator's own day count. */
    async clock() {
      const [d, sim] = await Promise.all([be.describe(), be.simClock ? be.simClock().catch(() => null) : null]);
      return { now: d.now, sandbox: d.id, size: d.size, scenario: d.scenario, calls: d.calls, day: sim?.day ?? null, started: sim?.started ?? null, seed: sim?.seed ?? null };
    },
    /** Moves time on. Splits long runs because the server takes at most 60 days per request. */
    async advance(days = 1) {
      const all = [];
      let now = null;
      let clock = null;
      for (let left = days; left > 0; left -= MAX_DAYS_PER_CALL) {
        const r = await be.advance(Math.min(left, MAX_DAYS_PER_CALL));
        all.push(...r.days);
        now = r.now;
        clock = r.clock || null;
      }
      poll.lastNow = now;  // the caller shows this move itself, so the poller should not report it again
      return { now, days: all, clock };
    },
    async impact() {
      return be.impact();
    },
    async activity({ since = 0 } = {}) {
      const entries = await be.trace(since);
      return { entries, last: entries.at(-1)?.seq ?? since };
    },
    /** Calls `fn` whenever something new happens in the world. Returns a function that stops listening. */
    onChange(fn) {
      listeners.add(fn);
      if (!poll.timer) {
        check();
        poll.timer = setInterval(check, POLL_MS);
      }
      return () => {
        listeners.delete(fn);
        if (!listeners.size) {
          clearInterval(poll.timer);
          poll.timer = null;
        }
      };
    },
    async reset() {
      const d = await be.reset();
      poll.lastSeq = 0;
      poll.lastNow = d.now;
      emit({ entries: [], now: d.now, previousNow: null, reset: true, source: "reset" });
      return d;
    },
    /** Every tool the business has (the person looking may use them all). `role` lists one job's tools, for AI keys. */
    async tools({ only } = {}) {
      return be.tools(only);
    },
    /** Everything the "connect your AI" panel shows. */
    async connectInfo() {
      const i = await be.info();
      return { ...i, mcpUrl: `${i.baseUrl}/mcp`, apiUrl: i.baseUrl, openapiUrl: `${i.baseUrl}/openapi.json` };
    },
    /**
     * Ready-made world events (postal strike, heatwave...) that add_world_event can start by template id.
     * Read through the engine tool list_event_templates when it exists; [] until then.
     */
    async eventLibrary() {
      // WHY page through: the library is a few hundred templates and one answer holds at most 100.
      const all = [];
      for (let offset = 0; offset < 2000;) {
        const r = await be.call("list_event_templates", { limit: 100, offset }, "manager", SCREEN_SESSION).catch(() => null);
        if (!r?.ok) break;
        const page = Array.isArray(r.data) ? r.data : r.data.templates || r.data.events || [];
        all.push(...page);
        offset += page.length;
        if (!page.length || Array.isArray(r.data) || offset >= (r.data.total ?? 0)) break;
      }
      return all;
    },
    /**
     * Customers waiting for an answer (the server's inbox, not an engine tool): messages, newest last.
     * Never throws: an unreachable server or a missing route reads as an empty inbox.
     * @param {{status?: string}=} options waiting (default), replied or all
     */
    async inbox({ status = "waiting" } = {}) {
      if (!be.inbox) return [];
      try { return await be.inbox(status); } catch (e) { if (e.code !== "offline") console.warn(e.message); return []; }
    },
    /**
     * Answers one waiting inbox message as the current role (or `role`). Resolves like call():
     * `{ ok: true, data: { replied, next } }` or `{ ok: false, error }`, never throws for a refusal.
     */
    async inboxReply(messageId, text, { role: as } = {}) {
      if (!be.inboxReply) return { ok: false, error: { code: "unavailable", message: "This business has no inbox." } };
      try { return await be.inboxReply(messageId, text, as || role); } catch (e) { return { ok: false, error: { code: e.code, message: e.message } }; }
    },
    /** Makes a key that can only ever act as one role: the safe thing to give an outside AI. */
    async mintToken(asRole) {
      return be.mintToken(asRole);
    },
    /** Tells other parts of this page that this page moved the clock, with what happened. */
    announce(change) {
      emit({ entries: [], reset: false, source: "local", ...change });
    },
  };
  return client;
}

/** The API lives on the same address as the apps (applications/dev.mjs serves both). */
function defaultBaseUrl() {
  return globalThis.location ? globalThis.location.origin : "http://127.0.0.1:8790";
}

let shared = null;

/** The one client shared by everything on this page (top bar and app), so they see the same world. */
export function getClient() {
  shared ||= createClient();
  return shared;
}
