// Event history: which world events happened in the five trading years, and which are already scheduled for the next twelve months.
// Pure and repeatable: the same library, seed and dates always give the same records. See infrastructure/engine/events-core.js for the rules.
import { readFileSync } from "node:fs";
import { scheduleEvents, newsFor, statusOn, addDays } from "../../../infrastructure/engine/events-core.js";

const ID_WIDTH = 5;
const LIBRARY_URL = new URL("../../data/events/library.json", import.meta.url);

/** Reads the event library from business/data/events/library.json. */
export function loadEventLibrary() {
  return JSON.parse(readFileSync(LIBRARY_URL, "utf8"));
}

const pad = (prefix, n) => `${prefix}-${String(n).padStart(ID_WIDTH, "0")}`;

/**
 * Builds the event records for a world.
 * from/to: the first and last day of history ("to" is today). Events that start after `to`, up to a year ahead,
 * are written as status "scheduled" with no news yet; the live simulator publishes their news when their day comes.
 * products: [{ id, name, launched }], so nothing happens about a product before it is on sale.
 * Returns { world_events, news } ready to save as business/data/world/<size>/world_events.json and news.json.
 */
export function buildEventHistory(library, { seed, from, to, products = [] }) {
  const horizon = addDays(to, 365);
  const occurrences = scheduleEvents(library, { seed, from, to: horizon, products });
  const world_events = occurrences.map((o, i) => {
    const { key, ...record } = o;
    return { id: pad("WE", i + 1), ...record, status: statusOn(o, to), origin: "seeded" };
  });
  // WHY: news is dated by the day an event starts; events already under way when history begins have no story in the window.
  const published = world_events.filter((e) => e.start >= from && e.start <= to);
  const items = published.flatMap((e) => newsFor([e], e.start));
  items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.event < b.event ? -1 : 1));
  const news = items.map((n, i) => ({ id: pad("NW", i + 1), ...n }));
  return { world_events, news };
}
