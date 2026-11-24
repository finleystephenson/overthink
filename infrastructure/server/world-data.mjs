// Reads business/data/ once per world size and keeps it, so a new sandbox costs one createWorld call, not a disk read.
// createWorld clones everything it is given, so sharing this cache between sandboxes is safe.
// WHY infrastructure/engine/all.js and not engine.js: extensions (mail, chat, events, levers) add their tools and record types when
// imported; going through all.js gives every sandbox every tool.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadData } from "../engine/load.ts";
import { createWorld, loadState } from "../engine/all.js";
import { attachPlan } from "../engine/levers.js";
import { loadBusiness } from "../../simulation/simulator/data.mjs";
import { listPictures } from "../../business/builder/world/comms-data.mjs";

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "business", "data");
export const SIZES = ["demo", "standard"];

const cache = new Map();
let business = null;
let pictures = null;

/**
 * The data for one world. The plain world (business/data/world/<size>) is the business as it is; `bench: true` gives the
 * benchmark's story world (business/data/world-bench/<size>), which the story-based scenarios and situations rely on.
 */
export function dataFor(size, { bench = false } = {}) {
  if (!SIZES.includes(size)) throw Object.assign(new Error(`size must be one of: ${SIZES.join(", ")}`), { code: "invalid_input" });
  const key = `${size}|${bench}`;
  if (!cache.has(key)) cache.set(key, loadData(DATA_DIR, { world: size, bench }));
  return cache.get(key);
}

/** The simulator's business files (business/data/sim.json, staff.json, costs.json, characters.json), read once. */
export function businessData() {
  if (!business) business = loadBusiness(DATA_DIR);
  return business;
}

/**
 * Attaches the plan the levers compare against: the team and the marketing budget at the world's own size.
 * @param {object} world
 * @return {object} The same world.
 */
function withPlan(world) {
  // WHY: list_post_pictures and create_social_post may only offer pictures that exist; read them once, share them.
  world.pictures = pictures ||= listPictures(DATA_DIR);
  const biz = businessData();
  const scale = world.state.company?.scale > 0 ? world.state.company.scale : 1;
  return attachPlan(world, { staff: biz.staff.staff, marketing_per_month: Math.round(biz.costs.marketing_per_month * scale * 100) / 100, on_cost_rate: biz.costs.on_cost_rate, days_per_month: biz.costs.days_per_month, work_days: biz.staff.days, day_start: biz.staff.day_start });
}

/** A fresh world at the fixed simulated "now" (business.sim.anchor_now), so every sandbox starts identical. */
export const freshWorld = (size, { bench = false } = {}) => withPlan(createWorld(dataFor(size, { bench })));

/** A world of this size holding a saved state (JSON string or object): for reset, persistence and the shadow twin. */
export const worldFromState = (size, state, { bench = false } = {}) => withPlan(loadState(createWorld(dataFor(size, { bench })), state));

/** The roles in business.json, in its order. The engine checks the same list when a session is made. */
export const ROLES = Object.keys(dataFor("demo").business.roles).filter((k) => !k.startsWith("_"));
