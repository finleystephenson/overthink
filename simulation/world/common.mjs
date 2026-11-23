// Small helpers the wider-world modules share: dates, settings, news.
// Browser-safe: no Node APIs, no clock, no Math.random (chance comes from rngFor in business/builder/world/rng.mjs).

const DAY = 86400000;

/** A date (YYYY-MM-DD) n days after another. */
export function addDays(date, n) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** "2026-11" for a date. */
export const monthOf = (date) => date.slice(0, 7);

/** The month after "2026-11". */
export function nextMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "7 December" for 2026-12-07: how a person writes a date in a post or a story. */
export const dateWords = (date) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;

/** "a, b and c". */
export function listWords(items) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const round = (x, dp = 2) => Math.round(x * 10 ** dp) / 10 ** dp;
export const percentWords = (m) => (m >= 1 ? `up ${Math.round((m - 1) * 100)}%` : `down ${Math.round((1 - m) * 100)}%`);

/**
 * The entries of one world_settings list that apply on a date (from <= date <= to; either end may be left out).
 * WHY read every day: the lab changes the world only by editing state.world_settings, so nothing is cached.
 * @param {object} state The engine state.
 * @param {string} key A world_settings list name, e.g. "economy_shocks".
 * @param {string} date YYYY-MM-DD.
 * @return {Array<object>}
 */
export function activeSettings(state, key, date) {
  const list = state?.world_settings?.[key];
  if (!Array.isArray(list)) return [];
  return list.filter((s) => s && typeof s === "object" && (!s.from || s.from <= date) && (!s.to || s.to >= date));
}

/** The next id for a kind of record, carrying on from the highest already there (same rule as infrastructure/engine/events.js). */
export function nextStateId(state, prefix, key, width = 5) {
  state.counters = state.counters || {};
  if (state.counters[prefix] === undefined) {
    state.counters[prefix] = Math.max(0, ...(state[key] || []).map((r) => Number(String(r.id).match(/(\d+)$/)?.[1] || 0)));
  }
  state.counters[prefix] += 1;
  return `${prefix}-${String(state.counters[prefix]).padStart(width, "0")}`;
}

/**
 * Publishes a news item in the same shape infrastructure/engine/events.js uses ({ id, at, headline, story, section, ... }).
 * `source` ties it to the record it reports, so the same thing is never reported twice.
 * @return {?object} The item, or null if that source was already reported.
 */
export function publishNews(state, { date, headline, story, section, source, hour = "07:30" }) {
  state.news = state.news || [];
  if (source && state.news.some((n) => n.source === source)) return null;
  const item = { id: nextStateId(state, "NW", "news"), at: `${date}T${hour}:00Z`, headline, story, section, source };
  state.news.push(item);
  return item;
}
