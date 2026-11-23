// Branches: many copies of one simulated business, all started from a single snapshot.
//
//   const start = await makeStart({ size: "standard" });   // one world, one simulator set-up, one snapshot
//   const b = openBranch(start, { seed: 3 });               // a private copy: its own world and simulator
//   await b.sim.step();                                     // moves only this copy on a day
//
// WHY one snapshot and restoreSim, not a fresh world per branch: the simulator's set-up (customer population, opening
// stock, recent orders) is made once and carried into every branch, and every chance in a day is keyed by business
// facts (simulation/simulator/core.mjs, common random numbers). So two branches given the same seed and no different actions stay
// identical record for record; whatever differs was caused by what was done in one of them. This is the same
// mechanism simulation/simulator/live.mjs uses for a live world and its shadow twin, applied to any number of copies.
import { freshWorld, worldFromState, businessData, dataFor, DATA_DIR } from "../../infrastructure/server/world-data.mjs";
import { createSim, restoreSim } from "../simulator/core.mjs";
import { loadPlugins } from "../simulator/plugins.mjs";

export const SIZES = ["demo", "standard"];
const pluginCache = new Map();

/**
 * Every simulator plug-in that exists in this copy of the project (events, comms, audience, and the wider world once
 * it is registered in simulation/simulator/plugins.mjs), loaded once per world size.
 * @param {string} size
 * @param {?Array<string>=} only Limit to these plug-in names.
 * @return {Promise<{plugins: Array<object>, skipped: Array<object>}>}
 */
export function pluginsFor(size, only = null) {
  const key = `${size}|${only ? only.join(",") : "*"}`;
  if (!pluginCache.has(key)) {
    pluginCache.set(key, loadPlugins({ only, dataDir: DATA_DIR, biz: businessData(), products: dataFor(size).products }));
  }
  return pluginCache.get(key);
}

/**
 * Builds the starting business once and takes the snapshot every branch is restored from.
 * @param {object=} o
 * @param {string=} o.size "demo" (a market stall, fast) or "standard" (default).
 * @param {number=} o.popSeed Seed for the customer population (default 1).
 * @param {?number=} o.customers Population size (default: the simulator's own).
 * @param {?Array<string>=} o.plugins Plug-in names to use (default: all that exist).
 * @return {Promise<Start>}
 */
export async function makeStart({ size = "standard", popSeed = 1, customers = null, plugins: only = null } = {}) {
  if (!SIZES.includes(size)) throw Object.assign(new Error(`"size" must be one of: ${SIZES.join(", ")}.`), { code: "invalid_input" });
  const biz = businessData();
  const { plugins, skipped } = await pluginsFor(size, only);
  const world = freshWorld(size);
  // compact: false keeps every business record (as a live sandbox does), so "what changed" and "who was affected" can
  // be read from the records afterwards. rich: customers with hidden traits and memories (simulation/simulator/customers.mjs).
  const sim = createSim({ world, biz, seed: 1, popSeed, customers, plugins, compact: false, customerModel: "rich" });
  return {
    size, biz, plugins, skipped, popSeed,
    state: JSON.stringify(world.state),
    sim: sim.snapshot(),
    startDate: world.state.now.slice(0, 10),
    makeWorld: (state) => worldFromState(size, state),
  };
}

/**
 * @typedef {object} Start
 * @property {string} size
 * @property {object} biz The business files.
 * @property {Array<object>} plugins The plug-ins every branch runs with.
 * @property {Array<object>} skipped Plug-ins that could not be loaded, and why.
 * @property {string} state The starting world state (JSON).
 * @property {object} sim The simulator snapshot taken on that state.
 * @property {string} startDate
 * @property {function(string): object} makeWorld
 */

/**
 * A private copy of the starting business, ready to step.
 * @param {Start} start
 * @param {object} o
 * @param {number} o.seed The run seed (the same for every arm of one repeat).
 * @param {?object=} o.world A world already made from start.state (when it had to exist first, e.g. to host an AI).
 * @param {?object=} o.toolClient An AI or tool under test (see simulation/lab/client.mjs). Null: staff only.
 * @param {?object=} o.tracer, o.toolEnv, o.role What the simulator needs to give the tool its work (simulation/simulator/core.mjs).
 * @return {{world: object, sim: object}}
 */
export function openBranch(start, { seed, world = null, toolClient = null, tracer = null, toolEnv = {}, role = "assistant" }) {
  world ||= start.makeWorld(start.state);
  const sim = restoreSim(start.sim, { world, biz: start.biz, plugins: start.plugins, seed, toolClient, tracer, toolEnv, role });
  return { world, sim };
}

/**
 * Writes one wider-world setting (state.world_settings, see docs/open-world.md). Plain JSON, saved with snapshots.
 * @param {object} world
 * @param {string} path Dotted path inside world_settings, e.g. "economy.inflation".
 * @param {*} value
 * @return {{path: string, before: *, after: *}}
 */
export function setWorldSetting(world, path, value) {
  const parts = checkPath(path);
  const root = (world.state.world_settings ||= {});
  let node = root;
  for (const p of parts.slice(0, -1)) {
    if (typeof node[p] !== "object" || node[p] === null) node[p] = {};
    node = node[p];
  }
  const last = parts[parts.length - 1];
  const before = node[last] === undefined ? null : structuredClone(node[last]);
  node[last] = structuredClone(value);
  return { path, before, after: value };
}

/**
 * Makes this world's engine follow the policy values the lab has written into world_settings.policies.
 * WHY: no engine tool changes a policy, and every world holds its own copy of the business rules (engine createWorld
 * clones them), so the record of the change lives in world_settings (saved, visible, the same in every view) and this
 * copies it onto the branch's private rules. Nothing outside the branch is touched.
 * @param {object} world
 * @return {Array<{path: string, before: *, after: *}>}
 */
export function applyPolicySettings(world) {
  const out = [];
  for (const [path, value] of Object.entries(world.state.world_settings?.policies || {})) {
    const parts = checkPath(path);
    const node = ruleParent(world, parts);
    const last = parts[parts.length - 1];
    if (!node) throw Object.assign(new Error(`There is no business rule "${path}".`), { code: "invalid_input" });
    out.push({ path, before: node[last], after: value });
    node[last] = value;
  }
  return out;
}

/** Reads a business rule by dotted path (e.g. "returns.window_days"), or undefined. */
export function policyValue(world, path) {
  const parts = checkPath(path);
  return ruleParent(world, parts)?.[parts[parts.length - 1]];
}

/**
 * The object holding the rule at `parts`, or null. Only the rules' own data is followed: never an inherited name
 * (toString, hasOwnProperty), never a function, and never an array's length (setting it to four billion would make
 * every later loop over that list run for ever).
 * WHY: the path comes from an experiment anyone can send.
 */
function ruleParent(world, parts) {
  let node = world.business;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!node || typeof node !== "object" || !Object.hasOwn(node, p) || (Array.isArray(node) && !/^\d+$/.test(p))) return null;
    if (i === parts.length - 1) return node;
    node = node[p];
  }
  return null;
}

function checkPath(path) {
  if (typeof path !== "string" || !/^[a-z0-9_]+(\.[a-z0-9_]+)*$/i.test(path) || path.length > 120) {
    throw Object.assign(new Error('A setting path is words joined by dots, such as "returns.window_days".'), { code: "invalid_input" });
  }
  const parts = path.split(".");
  if (parts.some((p) => ["__proto__", "prototype", "constructor"].includes(p))) throw Object.assign(new Error("That path is not allowed."), { code: "invalid_input" });
  return parts;
}

/**
 * A local web door onto branch worlds, so a connected AI can call the shop's tools (the same server the sandboxes use).
 * One per run; each branch with an AI gets its own sandbox whose world is that branch's world.
 * @return {Promise<Host>}
 */
export async function startHost() {
  const { SandboxStore } = await import("../../infrastructure/server/sandboxes.mjs");
  const { createApp } = await import("../../infrastructure/server/http.mjs");
  const { allowed } = await import("./scope.mjs");
  /**
   * The sandbox store with one addition: a sandbox may carry a scope (simulation/lab/scope.mjs), and a call outside it is
   * refused before the engine sees it, and written in the trace like any other refused call. WHY here and not in the
   * engine: the scope belongs to the product under test, not to the role; the engine's own role rules still apply on
   * top. The owner key (the lab itself) is never limited.
   */
  class LabStore extends SandboxStore {
    call(sb, principal, actor, tool, input) {
      if (sb.scope && !principal.owner) {
        const v = allowed(sb.scope, tool);
        if (!v.ok) {
          const error = { code: "out_of_scope", message: v.why };
          this.record(sb, { kind: "tool", via: actor.via || "http", actor: { token: principal.id, role: actor.role, session: actor.session || "default" }, tool, input, ok: false, error, changes: [], scope_need: v.need });
          return { ok: false, error };
        }
      }
      return super.call(sb, principal, actor, tool, input);
    }
  }
  const store = new LabStore({ maxSandboxes: 200, idleMs: 24 * 3600 * 1000 });
  // WHY allowedHosts: this door listens on 127.0.0.1, so the same DNS-rebinding guard as the main server applies.
  const server = createApp({ store, rateLimit: 1e9, allowedHosts: ["127.0.0.1", "localhost", "[::1]"] });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    apiUrl,
    store,
    /**
     * Puts a world behind a sandbox and returns a key for one role, and a reader for what that key did.
     * @param {object} world
     * @param {string} size
     * @param {string} role
     * @param {?object=} scope What the product may read and act on (simulation/lab/scope.mjs); null = the role's own rules.
     */
    attach(world, size, role, scope = null) {
      const { sandbox: sb } = store.create({ size });
      // WHY swap the world in: the sandbox store calls tools on sb.world, so the AI acts on this branch, under the
      // engine's role rules, and every call lands in the sandbox trace the scorecard reads.
      sb.world = world;
      sb.scope = scope;
      const { token } = store.mintRoleToken(sb, { role, label: "lab" });
      const tracer = {
        mark: () => sb.seq,
        callsSince: (seq, session) => sb.trace.filter((e) => e.seq > seq && e.kind === "tool" && e.actor?.session === session),
      };
      return { sb, token, tracer, toolEnv: { api_url: apiUrl, token } };
    },
    detach(sb) { store.remove(sb.id); },
    async close() { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); },
  };
}

/** A fresh world of this size (for situations that do not need the simulator). */
export const fresh = (size) => freshWorld(size);
