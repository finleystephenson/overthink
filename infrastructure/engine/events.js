// World events and news: record types, tools and the simulator plug-in. The pure rules are in events-core.js.
// Extension to the commerce engine (see docs/environment-design.md, "Extensions").
import { extend, kit } from "./engine.js";
import library from "../../business/data/events/library.json" with { type: "json" };
import {
  activeEffects, checkEffects, describeEffects, instantiate, newsFor, regionShare, statusOn, addDays,
} from "./events-core.js";

const { fail, nextId, dateOf, ms, schema: { str, obj }, roles } = kit;

const TEMPLATES = library.events;
const BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
const ID_WIDTH = 5;
/** How far back list_world_events looks for events that are over. WHY: staff need recent context, not five years of it. */
const RECENT_DAYS = 90;
const MAX_LIMIT = 100;

const integer = { type: "integer" };
const anyObject = { type: "object" };
const anyList = { type: "array" };

const today = (ctx) => dateOf(ms(ctx.now));

// ---------------------------------------------------------------- shared helpers

/** The next id for a record kind, for code that has the state but no tool context (the plug-in's afterDay). */
function nextStateId(state, prefix, key) {
  state.counters = state.counters || {};
  if (state.counters[prefix] === undefined) {
    state.counters[prefix] = Math.max(0, ...(state[key] || []).map((r) => Number(String(r.id).match(/(\d+)$/)?.[1] || 0)));
  }
  state.counters[prefix] += 1;
  return `${prefix}-${String(state.counters[prefix]).padStart(ID_WIDTH, "0")}`;
}

/** Writes the news item for an event, once. Returns the item, or null if it was already published. */
function publishNews(state, occ, date, at = `${date}T07:00:00Z`) {
  if ((state.news || []).some((n) => n.event === occ.id)) return null;
  const item = { id: nextStateId(state, "NW", "news"), ...newsFor([occ], occ.start)[0], at };
  state.news.push(item);
  return item;
}

/** What a manager or staff member sees of an occurrence: the record plus its effects in plain words. */
function describe(occ, date) {
  return {
    id: occ.id, template: occ.template, title: occ.title, headline: occ.headline, family: occ.family, status: statusOn(occ, date),
    start: occ.start, end: occ.end, origin: occ.origin, region: occ.region || null, ramp: occ.ramp,
    story: occ.story, effects: occ.effects, effects_in_words: describeEffects(occ.effects),
  };
}

const findEvent = (ctx, id) => (ctx.st.world_events || []).find((e) => e.id === id) || fail("not_found", `No world event ${id}.`);

/** Scheduled events are the future; only the manager may see or change them. */
function canSee(ctx, occ) {
  return statusOn(occ, today(ctx)) !== "scheduled" || ctx.role === "manager";
}

/** Normalises a region given as a list of town names, or { towns, areas }. */
function normaliseRegion(input) {
  if (input === undefined || input === null) return null;
  const region = Array.isArray(input) ? { towns: input } : input;
  const towns = (region.towns || []).map(String);
  const areas = (region.areas || []).map(String);
  if (!towns.length && !areas.length) fail("invalid_input", "region needs at least one town or postcode area.");
  return { ...(towns.length ? { towns } : {}), ...(areas.length ? { areas } : {}) };
}

function checkEventEffects(ctx, effects) {
  const productIds = ctx.world.products.map((p) => p.id);
  const categories = [...new Set(ctx.world.products.map((p) => p.category))];
  const problem = checkEffects(effects, { productIds, categories });
  if (problem) fail("invalid_input", problem);
}

/** Share of customers in a region, from this world's customers, else a small default. */
const shareFor = (ctx, region) => regionShare(region, ctx.st.customers) ?? 0.05;

// ---------------------------------------------------------------- tools

const NEWS_TOOLS = [
  {
    name: "list_news", roles: roles.ALL,
    description: "The newspaper: published news items, newest first. Optional limit (default 20, at most 100), before (a date or timestamp; only older items) and section (for example Weather, Delivery, Money, Business, Trends, Diary, Local).",
    input_schema: obj({ limit: integer, before: str, section: str }),
    // WHY: news is public. Anyone, including a customer's assistant, can read what the whole country can read.
    run(ctx, i) {
      const limit = Math.min(MAX_LIMIT, i.limit || 20);
      const list = (ctx.st.news || [])
        .filter((n) => n.at <= ctx.now && (!i.before || n.at < i.before) && (!i.section || n.section === i.section))
        .sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
      return { total: list.length, news: list.slice(0, limit) };
    },
  },
  {
    name: "get_news_item", roles: roles.ALL,
    description: "One news item with its full story.",
    input_schema: obj({ id: str }, ["id"]),
    run(ctx, i) {
      const n = (ctx.st.news || []).find((x) => x.id === i.id && x.at <= ctx.now);
      return n || fail("not_found", `No news item ${i.id}.`);
    },
  },
];

const EVENT_READ_TOOLS = [
  {
    name: "list_world_events", roles: roles.INTERNAL,
    description: "World events that are happening now or ended in the last 90 days, newest first, with what each does in plain words. Optional status (active, over; the manager may also ask for scheduled) and limit (default 20, at most 100).",
    input_schema: obj({ status: str, limit: integer }),
    // WHY: staff should know what is going on in the world, but not what is about to happen; future events are the manager's to see.
    run(ctx, i) {
      const date = today(ctx);
      if (i.status === "scheduled" && ctx.role !== "manager") fail("forbidden", "Only the manager can see events that have not started.");
      const cutoff = addDays(date, -RECENT_DAYS);
      const list = (ctx.st.world_events || [])
        .map((e) => ({ e, status: statusOn(e, date) }))
        .filter(({ e, status }) => (i.status ? status === i.status : status === "active" || (status === "over" && e.end >= cutoff)))
        .sort((a, b) => (a.e.start < b.e.start ? 1 : -1));
      const limit = Math.min(MAX_LIMIT, i.limit || 20);
      return { total: list.length, events: list.slice(0, limit).map(({ e }) => describe(e, date)) };
    },
  },
  {
    name: "get_world_event", roles: roles.INTERNAL,
    description: "One world event: its dates, story, the effects it has on the business (as numbers and in plain words) and where it came from (seeded or added).",
    input_schema: obj({ id: str }, ["id"]),
    run(ctx, i) {
      const occ = findEvent(ctx, i.id);
      if (!canSee(ctx, occ)) fail("forbidden", "Only the manager can see events that have not started.");
      return describe(occ, today(ctx));
    },
  },
];

/** Builds a new occurrence from a library template or from custom fields. Throws a Fail on bad input. */
function buildOccurrence(ctx, i) {
  const date = today(ctx);
  const start = i.start || date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) fail("invalid_input", "start must be a date, YYYY-MM-DD.");
  if (start < date) fail("rule_violation", "An event cannot start in the past. Use today or a later date.");
  let occ;
  if (i.template) {
    const tpl = BY_ID[i.template] || fail("not_found", `No event template ${i.template}. See business/data/events/library.json.`);
    const length = i.duration_days || tpl.fixed?.length_days || Math.round((tpl.duration_days[0] + tpl.duration_days[1]) / 2);
    occ = instantiate(tpl, start, length);
  } else {
    for (const k of ["title", "story", "effects"]) if (!i[k]) fail("invalid_input", `A custom event needs "${k}" (or give a template id).`);
    const length = i.duration_days || 7;
    occ = instantiate({ id: null, family: "custom", title: i.title, headline: i.headline || i.title, story: i.story, section: "Business", effects: i.effects, ramp: "flat" }, start, length);
    occ.template = null;
  }
  if (i.end) {
    if (i.end < start) fail("invalid_input", "end must not be before start.");
    occ.end = i.end;
  }
  for (const k of ["title", "headline", "story"]) if (i[k]) occ[k] = i[k];
  if (i.effects) occ.effects = structuredClone(i.effects);
  if (i.ramp) occ.ramp = i.ramp;
  if (i.region !== undefined) {
    occ.region = normaliseRegion(i.region);
    occ.region_share = shareFor(ctx, occ.region);
  }
  checkEventEffects(ctx, occ.effects);
  return occ;
}

const EVENT_WRITE_TOOLS = [
  {
    name: "list_event_templates", roles: ["manager"],
    description: "The event library: every kind of event that can happen, for choosing one to cause with add_world_event. Optional family (calendar, real-style, storybook), search (words in the id, title, headline, story or tags), limit (default 20, at most 100) and offset. Manager only: it shows what could happen, not what will.",
    input_schema: obj({ family: str, search: str, limit: integer, offset: integer }),
    run(ctx, i) {
      const words = String(i.search || "").toLowerCase().split(/\s+/).filter(Boolean);
      const list = TEMPLATES.filter((t) => {
        if (i.family && t.family !== i.family) return false;
        const text = `${t.id} ${t.title} ${t.headline} ${t.story} ${(t.tags || []).join(" ")}`.toLowerCase();
        return words.every((w) => text.includes(w));
      });
      const offset = Math.max(0, i.offset || 0);
      const limit = Math.min(MAX_LIMIT, i.limit || 20);
      const templates = list.slice(offset, offset + limit).map((t) => ({
        id: t.id, family: t.family, title: t.title, headline: t.headline, story: t.story, source: t.source,
        when: t.fixed ? { fixed: t.fixed } : { rate_per_year: t.rate_per_year, months: t.months, duration_days: t.duration_days },
        region: t.region || null, ramp: t.ramp, effects_in_words: describeEffects(t.effects),
        effects: t.effects, why: t.why, chatter: t.chatter, tags: t.tags,
      }));
      return { total: list.length, offset, templates };
    },
  },

  {
    name: "add_world_event", roles: ["manager"],
    description: "Causes a world event. Either give a template id from the event library (optionally with start, duration_days, end or your own effects), or a custom event: title, story, effects, and start with duration_days or end. effects uses the simulator's keys: demand { all, products, categories }, visits, contact_rate, carrier_delay_days, supplier_late_chance, costs { carrier, goods, card_fee }. It cannot start in the past. Its news is published on the start date.",
    input_schema: obj({ template: str, start: str, duration_days: integer, end: str, title: str, headline: str, story: str, effects: anyObject, region: anyObject, ramp: str }),
    // WHY: people play with the world by adding events; this is the one door, so an added event is marked and recorded like any other action.
    run(ctx, i) {
      const occ = buildOccurrence(ctx, i);
      occ.id = nextId(ctx, "WE", ID_WIDTH);
      occ.origin = "added";
      const date = today(ctx);
      occ.status = occ.start <= date ? "active" : "scheduled";
      ctx.st.world_events.push(occ);
      const news = occ.start <= date ? publishNews(ctx.st, occ, date, ctx.now) : null;
      ctx.changes.push(`world event ${occ.id} added: ${occ.title} (${occ.start} to ${occ.end})`);
      if (news) ctx.changes.push(`news ${news.id} published: ${news.headline}`);
      return { ...describe(occ, date), news_id: news ? news.id : null };
    },
  },
  {
    name: "edit_world_event", roles: ["manager"],
    description: "Changes a world event that has not finished: title, headline, story, end, effects, region or ramp, and (only if it has not started) start. Days already simulated are not redone. Published news is not rewritten.",
    input_schema: obj({ id: str, title: str, headline: str, story: str, start: str, end: str, effects: anyObject, region: anyObject, ramp: str }, ["id"]),
    run(ctx, i) {
      const occ = findEvent(ctx, i.id);
      const date = today(ctx);
      const status = statusOn(occ, date);
      if (status === "cancelled" || status === "over") fail("rule_violation", `${occ.id} is ${status}; only scheduled or active events can be edited.`);
      const before = JSON.stringify(occ);
      if (i.start !== undefined) {
        if (status === "active") fail("rule_violation", "An event that has started cannot be moved. Change its end, or cancel it.");
        if (i.start < date) fail("rule_violation", "An event cannot start in the past.");
        const length = Math.round((Date.parse(occ.end) - Date.parse(occ.start)) / 86400000);
        occ.start = i.start;
        if (i.end === undefined) occ.end = addDays(i.start, length);
      }
      if (i.end !== undefined) {
        if (i.end < occ.start) fail("invalid_input", "end must not be before start.");
        if (i.end < date) fail("rule_violation", "An event cannot end in the past; cancel it instead.");
        occ.end = i.end;
      }
      for (const k of ["title", "headline", "story", "ramp"]) if (i[k] !== undefined) occ[k] = i[k];
      if (i.effects !== undefined) { checkEventEffects(ctx, i.effects); occ.effects = structuredClone(i.effects); }
      if (i.region !== undefined) { occ.region = normaliseRegion(i.region); occ.region_share = shareFor(ctx, occ.region); }
      if (JSON.stringify(occ) === before) fail("rule_violation", "Nothing to change.");
      occ.status = status;
      ctx.changes.push(`world event ${occ.id} edited`);
      return describe(occ, date);
    },
  },
  {
    name: "cancel_world_event", roles: ["manager"],
    description: "Cancels a world event that has not finished. It stops acting on the business from today. News already published stays.",
    input_schema: obj({ id: str, reason: str }, ["id"]),
    run(ctx, i) {
      const occ = findEvent(ctx, i.id);
      const status = statusOn(occ, today(ctx));
      if (status === "cancelled" || status === "over") fail("rule_violation", `${occ.id} is ${status}; only scheduled or active events can be cancelled.`);
      occ.status = "cancelled";
      occ.cancelled_at = ctx.now;
      if (i.reason) occ.cancel_reason = i.reason;
      ctx.changes.push(`world event ${occ.id} cancelled${i.reason ? `: ${i.reason}` : ""}`);
      return describe(occ, today(ctx));
    },
  },
];

extend({
  state: ["world_events", "news"],
  counters: [["WE", "world_events", "id"], ["NW", "news", "id"]],
  tools: [...NEWS_TOOLS, ...EVENT_READ_TOOLS, ...EVENT_WRITE_TOOLS],
});

// ---------------------------------------------------------------- the simulator plug-in

/**
 * The plug-in the live simulator calls (contract: docs/environment-design.md, "Simulator plug-ins").
 * modifiers: the combined effect of every event active on the date, as the multiply-together shape.
 * afterDay: end of day. Publishes the news for events that have begun and moves statuses along.
 */
export const eventsPlugin = {
  name: "events",
  modifiers({ state, date, data }) {
    return activeEffects(state.world_events || [], date, { defaultRegionShare: data?.default_region_share });
  },
  afterDay({ state, date }) {
    state.news = state.news || [];
    for (const occ of state.world_events || []) {
      if (occ.status === "cancelled") continue;
      // WHY: an event already under way on the first simulated day (Black Friday week, say) never had its start-day news; publish it once, now.
      // Events that ended before today are not back-filled, so a world that starts mid-history is not flooded with old stories.
      if (occ.start <= date && occ.end >= date) publishNews(state, occ, date);
      occ.status = statusOn(occ, date, { endOfDay: true });
    }
  },
};
