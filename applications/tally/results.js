// "What your changes did": for Megaphone and Rota. Reads the server's impact (the business against the same
// business where nothing was done) and, for each change made, shows how orders, takings and profit moved in the
// days after it. WHY a time window and not a cause: effects overlap and linger, so the words say "in the days after".
import { esc, money, num, shortDate } from "../lib/ui.js";

/**
 * The changes made with the given tools, newest first, each with what moved after it.
 * @param {object} world the client
 * @param {Array<string>} tools tool names worth showing on this screen
 * @return {Promise<Array<object>>} [] when the server cannot compare yet
 */
export async function changesMade(world, tools) {
  const imp = await world.impact().catch(() => null);
  if (!imp?.available || !Array.isArray(imp.actions)) return [];
  return imp.actions.filter((a) => tools.includes(a.tool)).reverse();
}

/** A signed figure in words: "+4 orders", "−£28 profit". */
function figure(v, kind) {
  if (!Number.isFinite(v) || Math.abs(v) < (kind === "money" ? 0.5 : 0.05)) return null;
  const sign = v > 0 ? "+" : "−";
  const abs = Math.abs(v);
  return `${sign}${kind === "money" ? money(abs).replace("−", "") : num(Math.round(abs * 10) / 10)}`;
}

/**
 * One change as a card: what was done, when, and what moved after it (or that time has not moved yet).
 * @param {object} a an impact action
 * @param {string} what plain words for what was done
 * @param {Array<{key: string, label: string, kind?: string, goodWhenUp?: boolean}>} measures
 * @return {string} HTML
 */
export function changeCard(a, what, measures) {
  const days = Array.isArray(a.days) ? a.days : null;
  const diff = a.difference || {};
  const shown = measures.map((m) => ({ ...m, text: figure(diff[m.key], m.kind) })).filter((m) => m.text);
  const when = a.sim_time ? shortDate(a.sim_time) : "";
  const span = days ? (days[1] - days[0] + 1) : 0;
  let result;
  if (!days) result = `<p class="rs-wait">Move time on to see what it did.</p>`;
  else if (span < 1) result = `<p class="rs-wait">Another change came straight after, so this one cannot be told apart.</p>`;
  else if (!shown.length) result = `<p class="rs-wait">No difference yet, over ${span === 1 ? "one day" : `${num(span)} days`}.</p>`;
  else {
    result = `<ul class="rs-figs">${shown.map((m) => {
      const up = diff[m.key] > 0;
      const good = m.goodWhenUp === false ? !up : up;
      return `<li class="${good ? "good" : "bad"}"><b>${esc(m.text)}</b><span>${esc(m.label)}</span></li>`;
    }).join("")}</ul><p class="rs-note">In the ${span === 1 ? "day" : `${num(span)} days`} after, against doing nothing.</p>`;
  }
  return `<li class="rs-card"><p class="rs-what"><span class="rs-when">${esc(when)}</span>${esc(what)}</p>${result}</li>`;
}

/** The usual figures to show for a change. */
export const MONEY_MEASURES = [
  { key: "orders", label: "orders" },
  { key: "revenue", label: "taken", kind: "money" },
  { key: "net_profit", label: "profit", kind: "money" },
];
