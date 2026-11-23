// Small parts every view of the explorer shares: plain words, dates, a link row, and hearing when time moves.
import { esc } from "../lib/ui.js";

const SAY = { ORD: "order", PO: "purchase order", CASE: "case", FIX: "repair", RET: "return", REV: "review" };

/** Text from the records, never with codes in it (the server's text is already plain; this is the safety net). */
export const clean = (s) => String(s ?? "")
  .replace(/\b(ORD|PO|CASE|FIX|RET|REV)-(\d+)\b/g, (m, k, n) => `${SAY[k]} ${n}`)
  .replace(/\b(?:C|S|SUP|CT|EM|SP|CH|CONV|WE|NW|LED|MV|SC|SHP|REG|INV|MSG|OT)-[\w-]+\b/g, "")
  .replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();

/** "Mon 23 Nov 2026" from an ISO date or time (the simulated clock is UTC). */
export function dateWords(iso, { year = true, weekday = false } = {}) {
  if (!iso) return "";
  const d = new Date(String(iso).length <= 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(+d)) return String(iso);
  return d.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), ...(weekday ? { weekday: "short" } : {}) });
}

/** The address of anything in the world. */
export function hrefFor(r) {
  if (!r) return "#/look";
  if (r.kind === "ring") return "#/look";
  if (r.kind === "app") return `#/apps/${encodeURIComponent(r.id)}`;
  return `#/e/${encodeURIComponent(r.kind)}/${encodeURIComponent(r.id)}`;
}

/** A link row to anything in the world: its title, and a quiet note. */
export function refRow(r) {
  return `<li><a class="xr" href="${esc(hrefFor(r))}"><span class="xr-t">${esc(clean(r.title))}</span>${r.note ? `<span class="xr-n">${esc(clean(r.note))}</span>` : ""}<span class="xr-go" aria-hidden="true">→</span></a></li>`;
}

const moved = new Set();
/** Views call this to hear when time moves: fn({ since, now, days }). Returns a function that stops listening. */
export function onMoved(fn) { moved.add(fn); return () => moved.delete(fn); }
export function emitMoved(change) { for (const fn of moved) { try { fn(change); } catch (e) { console.error(e); } } }

/** Filled in by app.js: move the clock, repaint "against the world left alone", re-read the clock. */
export const hooks = { advance: async () => false, paintImpact: async () => {}, readClock: async () => {} };
