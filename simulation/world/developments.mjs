// World developments beyond the economy: a regulator changes a rule, a partner adopts a new technology, the labour
// market tightens, the council digs up a road. The possible ones are listed in business/data/organisations.json "developments"
// with their institution, chance, length, news and effects (in the simulator's own keys).
//
// On Mondays each may happen with a seeded chance (rngFor keyed by the date and the development's id), at most once
// every three years. It is recorded in state.world_developments, makes the news on its first day, and its effects act
// every day it lasts, each with a plain "why". world_settings.developments ([{ id, from, to }]) makes one happen.
import { rngFor } from "../../business/builder/world/rng.mjs";
import { activeSettings, addDays, nextStateId, publishNews } from "./common.mjs";
import { findOrg } from "./organisations.mjs";

const GAP_DAYS = 3 * 365;

/** Mondays: new developments; any set in world_settings recorded once; news for each on its first day. */
export function developmentsAfterDay(defs, state, date, seed) {
  const list = defs.developments?.list || [];
  state.world_developments = state.world_developments || [];
  const record = (d, from, to, set) => {
    const inst = findOrg(defs, d.institution);
    const rec = { id: nextStateId(state, "WD", "world_developments"), development: d.id, kind: d.kind, institution: d.institution,
      institution_name: inst?.name || d.institution, from, to, headline: d.headline, story: d.story, effects: d.effects, why: d.why, ...(set ? { set_in_settings: true } : {}) };
    const news = publishNews(state, { date, headline: d.headline, story: d.story, section: d.section || "Business", source: `development:${rec.id}` });
    if (news) rec.news_id = news.id;
    state.world_developments.push(rec);
  };
  if (new Date(`${date}T00:00:00Z`).getUTCDay() === 1) {
    for (const d of list) {
      const recent = state.world_developments.some((w) => w.development === d.id && !w.set_in_settings && w.from > addDays(date, -GAP_DAYS));
      if (recent || !rngFor(seed, "development", date, d.id).chance(d.chance_per_year / 52)) continue;
      record(d, date, addDays(date, d.length_days - 1), false);
    }
  }
  (state.world_settings?.developments || []).forEach((s, i) => {
    const d = list.find((x) => x.id === s?.id);
    if (!d || (s.from && s.from > date) || (s.to && s.to < date)) return;
    if (state.world_developments.some((w) => w.settings_key === `${i}|${s.id}|${s.from || ""}`)) return;
    record(d, s.from || date, s.to || addDays(date, d.length_days - 1), true);
    state.world_developments.at(-1).settings_key = `${i}|${s.id}|${s.from || ""}`;
  });
}

/**
 * The effects of every development in force on a date, combined, with reasons.
 * WHY settings are read directly as well: removing a setting stops its effect at once, without touching records.
 */
export function developmentEffects(defs, state, date) {
  const list = defs.developments?.list || [];
  const active = (state.world_developments || []).filter((w) => !w.set_in_settings && w.from <= date && w.to >= date)
    .map((w) => ({ effects: w.effects, why: w.why, name: w.institution_name, headline: w.headline }));
  for (const s of activeSettings(state, "developments", date)) {
    const d = list.find((x) => x.id === s.id);
    if (d) active.push({ effects: d.effects, why: d.why, name: findOrg(defs, d.institution)?.name || d.institution, headline: d.headline, set: true });
  }
  return active.map((a) => ({ ...a.effects, why: [{ source: "developments", effect: a.headline, size: 1,
    because: `${a.why}${a.set ? " (set in the world settings)" : ""}` }] }));
}
