// What world events do to the business on a given day, for the history builder.
// A thin, cached wrapper round activeEffects in infrastructure/engine/events-core.js, so a five-year build asks
// for each day (and each town) once, not once per order.
import { activeEffects, neutralModifiers } from "../../../infrastructure/engine/events-core.js";
import { dateOf } from "./calendar.mjs";

/**
 * Builds a lookup of event modifiers by day and, optionally, by town.
 * With no events (or events switched off) every answer is neutral, so the generator behaves as before.
 * A regional event with a `reach` also lifts demand outside its region (activeEffects applies it).
 * @param {object[]} worldEvents Records from buildEventHistory (world_events.json).
 * @returns {{at: function(number, string=): object, demandFor: function(number, string, string, string=): number}}
 */
export function makeEffects(worldEvents = []) {
  const neutral = neutralModifiers();
  const cache = new Map();
  // WHY: only events that are not cancelled can act; an empty list short-cuts every lookup.
  const live = worldEvents.filter((e) => e.status !== "cancelled");

  /** Modifiers on the day of time t. With a town, regional events act in full there and not elsewhere. */
  const at = (t, town = "") => {
    if (!live.length) return neutral;
    const date = dateOf(t);
    const key = date + "|" + town;
    let mod = cache.get(key);
    if (!mod) {
      mod = activeEffects(live, date, town ? { town } : {});
      cache.set(key, mod);
    }
    return mod;
  };

  /** How much an event lifts or cuts demand for one product (by id and category) on a day, in a town. */
  const demandFor = (t, productId, category, town = "") => {
    const d = at(t, town).demand;
    return (d.products[productId] ?? 1) * (d.categories[category] ?? 1);
  };

  return { at, demandFor };
}

