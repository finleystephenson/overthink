// Sandboxes: each developer's private, in-memory copy of the business.
// A sandbox holds one engine world, its starting snapshot (for reset and diff), its tokens, its inbox and its trace.
// Every tool call goes through world.session(...).call(...), so the engine's role rules always apply.
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { freshWorld, worldFromState, businessData, dataFor, DATA_DIR, ROLES, SIZES } from "./world-data.mjs";
import { createLive, restoreLive } from "../../simulation/simulator/live.mjs";
import { loadPlugins } from "../../simulation/simulator/plugins.mjs";
import { applyScenario } from "./scenarios.mjs";
import { buildInbox } from "./inbox.mjs";
import { diffStates } from "./diff.mjs";
import { deliverDay } from "./deliver.mjs";

const hasServiceJobs = (sb) => Object.values(sb.jobs || {}).some((t) => t.url && !t.stopped_at);
/** Per-day hooks (activity-generation/env.ts): scheduled activity before a day, a deployed product after it. */
const dayHooks = (sb) => ({ before: sb.hooks?.beforeDay || [], after: sb.hooks?.afterDay || [] });

const fail = (code, message, status) => { throw Object.assign(new Error(message), { code, status }); };
const sha = (s) => createHash("sha256").update(s).digest();
const MAX_SESSIONS = 500;   // engine sessions per sandbox; the oldest is dropped first
const MAX_TRACE = 20000;    // trace entries per sandbox, so a runaway client cannot eat the memory
const MAX_AUDIT = 20000;    // the engine's own audit log, trimmed oldest first for the same reason (the simulator trims it too)
export const MAX_ADVANCE_DAYS = 366; // days per advance request: a year at most, so one request cannot hold the server for long

/** Tokens look like ot_<sandbox id>_<secret>. Only a SHA-256 of the secret is kept. */
function mintToken(sb, { owner, role = null, customer_id = null, label = null, job = null, can_advance = false }) {
  const secret = randomBytes(32).toString("base64url");
  // `job` and `can_advance` come from taking a ready job (infrastructure/server/jobs.mjs): the key knows its job and may move time.
  const principal = { id: `tok_${sb.tokens.length + 1}`, hash: sha(secret), owner, role, customer_id, label, ...(job ? { job, can_advance: !!can_advance } : {}) };
  sb.tokens.push(principal);
  return { token: `ot_${sb.id}_${secret}`, principal };
}

export class SandboxStore {
  /**
   * @param {object=} o
   * @param {?Promise<Array<object>>|Array<object>=} o.plugins Simulator plug-ins for live sandboxes. Default: whichever
   *     of events and comms exist (simulation/simulator/plugins.mjs), loaded once.
   */
  constructor({ maxSandboxes = 20, idleMs = 2 * 3600 * 1000, maxAgeMs = null, maxAdvanceDays = MAX_ADVANCE_DAYS, clock = () => Date.now(), persistDir = null, plugins = null } = {}) {
    // maxAgeMs: a sandbox goes this long after it was made, however busy (retention on a shared server); null = never.
    // maxAdvanceDays: the most days one request may move time (a shared server sets fewer, so one call cannot hog it).
    Object.assign(this, { maxSandboxes, idleMs, maxAgeMs, maxAdvanceDays: Math.min(maxAdvanceDays, MAX_ADVANCE_DAYS), clock, persistDir });
    this.plugins = plugins;
    this.sandboxes = new Map();
    this.listeners = new Set();  // told when a sandbox goes, so MCP connections to it can close
    if (persistDir) this.#loadPersisted();
  }

  create({ size = "demo", scenario = "normal", seed = 1, bench = false } = {}) {
    if (!SIZES.includes(size)) fail("invalid_input", `"size" must be one of: ${SIZES.join(", ")}.`);
    if (typeof bench !== "boolean") fail("invalid_input", '"bench" must be true or false.');
    if (!Number.isInteger(seed) || seed < 0) fail("invalid_input", '"seed" must be a whole number, 0 or more.');
    this.sweep();
    if (this.sandboxes.size >= this.maxSandboxes) fail("unavailable", `The server already holds ${this.maxSandboxes} sandboxes. Delete one or wait for an idle one to expire.`, 503);
    // WHY: the plain world is the business as it is; the bench world adds the hand-written stories the benchmark uses.
    const world = freshWorld(size, { bench });
    applyScenario(world, scenario, { bench });
    const inbox = buildInbox(world.state, scenario, { bench });
    const start = { state: JSON.stringify(world.state), inbox: JSON.stringify(inbox) };
    const id = randomBytes(8).toString("hex");
    const sb = { id, size, bench, scenario, seed, created_at: new Date(this.clock()).toISOString(), lastUsed: this.clock(), world, inbox, start, tokens: [], sessions: new Map(), trace: [], seq: 0, live: null, liveSaved: null };
    const { token } = mintToken(sb, { owner: true, label: "owner" });
    this.sandboxes.set(id, sb);
    this.save(sb);
    return { sandbox: sb, token };
  }

  /** A token that can only ever act as one role. A customer token is tied to one customer. */
  mintRoleToken(sb, { role, customer_id = null, label = null, job = null, can_advance = false } = {}) {
    if (!ROLES.includes(role)) fail("invalid_input", `"role" must be one of: ${ROLES.join(", ")}.`);
    if (role === "customer" && !sb.world.state.customers.some((c) => c.id === customer_id)) fail("invalid_input", 'A customer token needs a real "customer_id".');
    // WHY: an assistant must verify the person itself; a pre-set customer would skip the engine's verification rule.
    if (role !== "customer" && customer_id) fail("invalid_input", '"customer_id" is only for the customer role. The assistant verifies people with verify_customer.');
    const r = mintToken(sb, { owner: false, role, customer_id, label: typeof label === "string" ? label.slice(0, 60) : null, job, can_advance });
    this.save(sb);
    return { token: r.token, id: r.principal.id, role, customer_id };
  }

  /** Token string → { sandbox, principal }, or null. Comparison is constant-time over the hashes. */
  authenticate(token) {
    const m = typeof token === "string" && token.match(/^ot_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/);
    if (!m) return null;
    const sb = this.sandboxes.get(m[1]);
    if (!sb) return null;
    const h = sha(m[2]);
    let found = null;
    for (const p of sb.tokens) if (timingSafeEqual(p.hash, h)) found = p;
    if (!found || found.revoked) return null; // a stopped job's keys stop working
    if (this.expired(sb)) { this.remove(sb.id); return null; }
    sb.lastUsed = this.clock();
    return { sandbox: sb, principal: found };
  }

  /** Which role a request acts as. Role tokens are fixed; the owner must name one. */
  actAs(principal, { role, customer_id } = {}) {
    if (!principal.owner) {
      if (role && role !== principal.role) fail("forbidden", `This token can only act as ${principal.role}.`, 403);
      return { role: principal.role, customer_id: principal.customer_id };
    }
    if (!role) fail("invalid_input", "Say which role to act as: the X-Role header (or ?role=). Role tokens do not need it.");
    if (!ROLES.includes(role)) fail("invalid_input", `Unknown role "${role}". Roles: ${ROLES.join(", ")}.`);
    if (role === "customer" && !customer_id) fail("invalid_input", "Acting as a customer needs X-Customer-Id.");
    return { role, customer_id: role === "customer" ? customer_id : null };
  }

  /**
   * Call an engine tool and record it in the trace. One engine session per token, role and session key,
   * so an assistant's verification lasts across HTTP requests and separate conversations stay separate.
   */
  call(sb, principal, { role, customer_id = null, session = "default", via = "http" }, tool, input) {
    const key = `${principal.id}|${role}|${customer_id || ""}|${session}`;
    let sess = sb.sessions.get(key);
    if (!sess) {
      sess = sb.world.session({ role, customer_id });
      sb.sessions.set(key, sess);
      if (sb.sessions.size > MAX_SESSIONS) sb.sessions.delete(sb.sessions.keys().next().value);
    }
    const audit0 = sb.world.state.audit;
    if (audit0.length >= MAX_AUDIT) audit0.splice(0, audit0.length - MAX_AUDIT + 1);
    const auditBefore = audit0.length;
    // WHY: once a sandbox is live, time moves only through advance (the business and its shadow twin together).
    // A bare advance_day would move this world's clock without customers or staff, and leave the twin behind.
    const result = tool === "advance_day" && sb.live?.started()
      ? { ok: false, error: { code: "rule_violation", message: "This sandbox is live: move time with POST /sandboxes/{id}/advance (or the advance_time MCP tool), so the business and its comparison twin move together." } }
      : sess.call(tool, input);
    const audit = sb.world.state.audit[auditBefore];
    this.record(sb, {
      kind: "tool", via, actor: { token: principal.id, role, session }, tool, input: audit?.input ?? input,
      ok: result.ok, ...(result.ok ? { result: result.data } : { error: result.error }), changes: audit?.changes ?? [],
    });
    return result;
  }

  record(sb, entry) {
    if (sb.trace.length >= MAX_TRACE) sb.trace.shift();
    sb.trace.push({ seq: ++sb.seq, at: new Date(this.clock()).toISOString(), sim_time: sb.world.state.now, ...entry });
    this.save(sb);
  }

  reset(sb) {
    // A fresh world, then the saved starting state: exactly as it began, byte for byte.
    sb.world = worldFromState(sb.size, sb.start.state, { bench: sb.bench === true });
    sb.inbox = JSON.parse(sb.start.inbox);
    sb.live = null; // the simulator and its shadow start again from the starting state on the next advance
    sb.liveSaved = null;
    sb.sessions.clear();
    sb.trace = [];
    sb.seq = 0;
    this.save(sb);
  }

  diff(sb) {
    const start = JSON.parse(sb.start.state);
    return { from: start.now, now: sb.world.state.now, ...diffStates(start, sb.world.state) };
  }

  remove(id) {
    if (!this.sandboxes.delete(id)) return false;
    for (const fn of this.listeners) fn(id);
    if (this.persistDir) rmSync(join(this.persistDir, `${id}.json`), { force: true });
    return true;
  }

  sweep() {
    for (const sb of [...this.sandboxes.values()]) if (this.expired(sb)) this.remove(sb.id);
  }

  /** Idle too long, or (with maxAgeMs) simply too old. */
  expired(sb) {
    const now = this.clock();
    return now - sb.lastUsed > this.idleMs || (this.maxAgeMs != null && now - Date.parse(sb.created_at) > this.maxAgeMs);
  }

  // ---- the live business: time moves for this world and its shadow twin together (simulation/simulator/live.mjs).

  /** The sandbox's live simulation, made (or brought back from disk) on first use. */
  async liveFor(sb) {
    if (sb.live) return sb.live;
    if (this.plugins === null) this.plugins = loadPlugins({ dataDir: DATA_DIR, biz: businessData(), products: dataFor("demo").products }).then((r) => r.plugins);
    const plugins = await this.plugins;
    if (sb.live) return sb.live; // another request made it while the plug-ins loaded
    const ctx = { world: sb.world, biz: businessData(), plugins, makeWorld: (state) => worldFromState(sb.size, state, { bench: sb.bench === true }) };
    sb.live = sb.liveSaved ? restoreLive(sb.liveSaved, ctx) : createLive({ ...ctx, seed: sb.seed ?? 1, startState: sb.start.state });
    sb.liveSaved = null;
    return sb.live;
  }

  /**
   * Moves the business (and its shadow) on by `days` simulated days, and records it in the trace.
   * @return {Promise<{now: string, days: Array<object>}>} Each day: the engine's advance_day result plus `summary`.
   */
  async advance(sb, principal, days, via = "http") {
    if (!Number.isInteger(days) || days < 1 || days > this.maxAdvanceDays) fail("invalid_input", `"days" must be a whole number from 1 to ${this.maxAdvanceDays}.`);
    const world = sb.world;
    const live = await this.liveFor(sb);
    let out;
    const hooks = dayHooks(sb);
    if (!hasServiceJobs(sb) && !hooks.before.length && !hooks.after.length) out = await live.advance(days);
    else {
      // A job taken with a web address gets each day's work as it happens, and scheduled activity arrives on its day:
      // one day at a time, then deliver.
      out = { now: null, days: [] };
      for (let i = 0; i < days; i++) {
        for (const h of hooks.before) await h(sb);
        if (sb.world !== world) break;
        const one = await live.advance(1);
        out.days.push(...one.days);
        if (sb.world !== world) break;
        await deliverDay(this, sb, one.days[0]?.summary);
        for (const h of hooks.after) await h(sb);
        out.now = sb.world.state.now;
      }
    }
    if (sb.world !== world) fail("unavailable", "The sandbox was reset while time was moving. Try again.", 409);
    this.record(sb, { kind: "advance", via, actor: { token: principal.id, role: principal.owner ? "owner" : principal.role }, days, now: out.now,
      summary: out.days.map((d) => d.summary) });
    return out;
  }

  /** The simulated date, day number and seed. Does not start the simulation. (Not `clock`: that is the wall clock.) */
  simClock(sb) {
    if (sb.live) return sb.live.clock();
    return { now: sb.world.state.now, date: sb.world.state.now.slice(0, 10), day: sb.liveSaved?.live?.day ?? 0, seed: sb.seed ?? 1, started: !!sb.liveSaved?.live };
  }

  /**
   * Live minus shadow so far (zeros before the first advance), plus `actions`: each outside action from the trace with
   * the difference the business moved by between it and the next action. WHY by time window: effects overlap and
   * linger, so this says "what changed while this was the latest thing done", not a proof of cause.
   */
  async impact(sb) {
    const live = await this.liveFor(sb);
    const out = live.impact();
    out.actions = live.started() ? this.actionWindows(sb, live) : [];
    return out;
  }

  actionWindows(sb, live) {
    const clock = live.clock();
    const startDay = Date.parse(`${clock.date}T00:00:00Z`) / 86400000 - clock.day; // day number of "day 0"
    const acts = sb.trace.filter((t) => t.kind === "tool" && t.ok && (t.changes || []).length && t.tool !== "advance_day");
    return acts.map((t, i) => {
      const at = Math.max(0, Math.round(Date.parse(`${t.sim_time.slice(0, 10)}T00:00:00Z`) / 86400000 - startDay));
      const next = acts[i + 1];
      const until = next ? Math.max(at, Math.round(Date.parse(`${next.sim_time.slice(0, 10)}T00:00:00Z`) / 86400000 - startDay)) : clock.day;
      return { seq: t.seq, tool: t.tool, role: t.actor?.role, sim_time: t.sim_time, changes: t.changes.slice(0, 3), days: [at + 1, until], difference: until > at ? live.between(at, until) : null };
    });
  }

  describe(sb) {
    return {
      id: sb.id, size: sb.size, bench: sb.bench === true, scenario: sb.scenario, seed: sb.seed ?? 1, created_at: sb.created_at, now: sb.world.state.now,
      expires_after_idle_minutes: Math.round(this.idleMs / 60000),
      ...(this.maxAgeMs != null ? { expires_at: new Date(Date.parse(sb.created_at) + this.maxAgeMs).toISOString() } : {}), calls: sb.seq,
      tokens: sb.tokens.map(({ id, owner, role, customer_id, label, job, revoked }) => ({ id, owner, role, customer_id, label, ...(job ? { job } : {}), ...(revoked ? { revoked } : {}) })),
    };
  }

  // ---- optional persistence (--persist <dir>): the only thing that ever writes to disk.

  save(sb) {
    if (!this.persistDir || sb.saveTimer) return;
    // Debounced: a burst of calls writes once.
    sb.saveTimer = setTimeout(() => {
      sb.saveTimer = null;
      if (!this.sandboxes.has(sb.id)) return;
      mkdirSync(this.persistDir, { recursive: true });
      const { world, sessions, saveTimer, tokens, live, liveSaved, hooks, ...rest } = sb;
      const out = { ...rest, state: world.state, tokens: tokens.map((t) => ({ ...t, hash: t.hash.toString("hex") })),
        live: live?.started() ? live.snapshot() : liveSaved };
      writeFileSync(join(this.persistDir, `${sb.id}.json`), JSON.stringify(out));
    }, 500);
    sb.saveTimer.unref?.();
  }

  #loadPersisted() {
    if (!existsSync(this.persistDir)) return;
    for (const f of readdirSync(this.persistDir).filter((x) => /^[0-9a-f]{16}\.json$/.test(x))) {
      const s = JSON.parse(readFileSync(join(this.persistDir, f), "utf8"));
      const world = worldFromState(s.size, s.state, { bench: s.bench === true });
      const { state, live, ...rest } = s;
      // The simulator is brought back on first use (liveFor), once the plug-ins have loaded.
      this.sandboxes.set(s.id, { ...rest, world, live: null, liveSaved: live || null, lastUsed: this.clock(), sessions: new Map(), tokens: s.tokens.map((t) => ({ ...t, hash: Buffer.from(t.hash, "hex") })) });
    }
  }
}
