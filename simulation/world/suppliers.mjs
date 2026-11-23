// Limits on the shop's own suppliers: how much each can make in a week, and the odd week when something goes wrong.
//
// The suppliers themselves are the world's (business/data/world/<size>/suppliers.json); their limits are in
// business/data/organisations.json "supplier_constraints", keyed by supplier id. Two things act on purchase orders:
//   - capacity: a supplier can make about capacity_multiple times the shop's usual order from it in a week; an order
//     bigger than that takes an extra week for each extra week's worth. WHY measured in usual orders, not units: the
//     same world runs at different sizes (company.scale and the simulator's own scale), and an order's size relative
//     to what the supplier is used to is what strains it;
//   - disruption: a seeded chance each Monday (disruptions_per_year / 52) that something goes wrong there for one to
//     three weeks; while it lasts capacity halves and new orders take extra days (up to lead_time_spread_days).
// A disruption can also be set in world_settings.supplier_disruptions. Each purchase order is looked at once, at the
// end of the day it was raised, and its due date moved if needed, with the reason written on it.
import { rngFor } from "../../business/builder/world/rng.mjs";
import { activeSettings, addDays, nextStateId, publishNews } from "./common.mjs";

/** Disruptions (natural and set) in force for a supplier on a date. */
export function disruptionsOn(state, supplierId, date) {
  const natural = (state.supplier_disruptions || []).filter((d) => d.supplier === supplierId && d.from <= date && d.to >= date);
  const set = activeSettings(state, "supplier_disruptions", date).filter((s) => s.supplier === supplierId)
    .map((s) => ({ supplier: s.supplier, capacity_factor: s.capacity_factor ?? 1, extra_lead_days: s.extra_lead_days ?? 0, reason: "set in the world settings (an experiment)" }));
  return [...natural, ...set];
}

/** Mondays: each supplier may run into trouble. Recorded in state.supplier_disruptions and reported as local news. */
function newDisruptions(constraints, state, date, seed) {
  if (new Date(`${date}T00:00:00Z`).getUTCDay() !== 1) return;
  state.supplier_disruptions = state.supplier_disruptions || [];
  for (const [id, c] of Object.entries(constraints)) {
    if (id.startsWith("_") || disruptionsOn(state, id, date).length) continue;
    const r = rngFor(seed, "supplier-disruption", date, id);
    if (!r.chance(c.disruptions_per_year / 52)) continue;
    const sup = (state.suppliers || []).find((s) => s.id === id);
    const days = r.int(7, 21);
    const rec = { id: nextStateId(state, "SD", "supplier_disruptions"), supplier: id, supplier_name: sup?.name || id, from: date, to: addDays(date, days - 1),
      capacity_factor: 0.5, extra_lead_days: r.int(1, Math.max(1, c.lead_time_spread_days)), reason: c.disruption };
    const news = publishNews(state, { date, section: "Local", source: `supplier:${rec.id}`,
      headline: `${rec.supplier_name}: ${c.disruption}`,
      story: `${rec.supplier_name}${sup?.town ? ` in ${sup.town}` : ""} says ${c.disruption}. Orders will take a little longer for the next few weeks.` });
    if (news) rec.news_id = news.id;
    state.supplier_disruptions.push(rec);
  }
}

/**
 * End of a day: new disruptions (Mondays), then today's new purchase orders checked against capacity and disruptions.
 * @param {object} constraints supplier_constraints from orgsFor(state).
 * @return {Array<{po: string, days: number}>} Orders whose due date moved.
 */
export function suppliersAfterDay(constraints, state, date, seed) {
  newDisruptions(constraints, state, date, seed);
  const moved = [];
  for (const po of state.purchase_orders || []) {
    if (po.world_checked || !po.ordered_at || po.ordered_at.slice(0, 10) !== date || !["ordered", "awaiting_approval", "draft"].includes(po.status)) continue;
    po.world_checked = true;
    const c = constraints[po.supplier_id];
    if (!c) continue;
    const ds = disruptionsOn(state, po.supplier_id, date);
    const capFactor = ds.reduce((n, d) => n * d.capacity_factor, 1);
    const qty = po.lines.reduce((n, l) => n + l.qty, 0);
    const weeks = qty / Math.max(1, usualOrder(state, po) * c.capacity_multiple * capFactor);
    const capDays = weeks > 1 ? Math.ceil(weeks - 1) * 7 : 0;
    const disDays = ds.reduce((n, d) => n + d.extra_lead_days, 0);
    const days = capDays + disDays;
    if (!days || !po.due_at) continue;
    po.due_at = addDays(po.due_at, days);
    const why = [capDays ? "the order is bigger than the supplier can make in a week" : null, ...ds.map((d) => d.reason)].filter(Boolean).join("; ");
    po.world_delay = { days, because: why };
    moved.push({ po: po.number, days });
  }
  return moved;
}

/** The median size (units) of the last ten earlier orders from the same supplier; the order itself if there are none. */
export function usualOrder(state, po) {
  const sizes = [];
  const list = state.purchase_orders || [];
  for (let i = list.length - 1; i >= 0 && sizes.length < 10; i--) {
    const p = list[i];
    if (p === po || p.supplier_id !== po.supplier_id || !p.ordered_at || p.ordered_at >= po.ordered_at) continue;
    sizes.push(p.lines.reduce((n, l) => n + l.qty, 0));
  }
  if (!sizes.length) return po.lines.reduce((n, l) => n + l.qty, 0);
  sizes.sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)];
}

/** "why" lines for disruptions in force. */
export function supplierWhy(constraints, state, date) {
  const out = [];
  for (const id of Object.keys(constraints)) {
    for (const d of disruptionsOn(state, id, date)) {
      const name = (state.suppliers || []).find((s) => s.id === id)?.name || id;
      out.push({ source: "suppliers", effect: `New orders from ${name} take ${d.extra_lead_days} more days`, size: d.extra_lead_days,
        because: `${name}: ${d.reason}${d.capacity_factor < 1 ? `; it can make only ${Math.round(d.capacity_factor * 100)}% of its usual amount` : ""}.` });
    }
  }
  return out;
}
