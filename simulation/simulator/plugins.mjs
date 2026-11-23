// Finds the simulator plug-ins that exist in this copy of the project and returns them ready to use.
// Two are being written alongside the simulator; either may be missing, so each is loaded in a try/catch and a missing
// one is simply left out (with a note saying why). The plug-in shape is in docs/environment-design.md.
//
//   events  infrastructure/engine/events.js exports `eventsPlugin` (world events change demand, costs and deliveries)
//   audience simulation/simulator/audience.mjs: what posts, marketing mail and replies made through the tools do (needs the
//           business files' audience rates, biz.audience, and the catalogue)
//   comms   business/builder/world/comms.mjs exports `deriveComms(state, { from, to, seed, data })`: mail, chat and social
//           records for those dates. Adapted here into a plug-in whose afterDay adds that day's records.
//           Its `data` is its own (the template banks from loadCommsData in business/builder/world/comms-data.mjs), not the
//           simulator's business files, so the adapter carries it and ignores the `data` the simulator passes.
//
// Browser-safe apart from one thing: loading the comms banks from disk (loadCommsData) needs Node. In a browser, pass
// `commsData` yourself.

/**
 * Turns a comms deriver into a plug-in. The deriver returns new records; they are appended to the state lists of the
 * same name. It accepts either { emails: [...], chat_messages: [...] } or a flat list of { kind, record } entries.
 * @param {function(object, object): (object|Array<object>)} deriveComms
 * @param {object} commsData The deriver's own data (loadCommsData's result).
 * @return {object} A plug-in: { name: "comms", afterDay }.
 */
export function commsPlugin(deriveComms, commsData) {
  return {
    name: "comms",
    commsData,
    afterDay({ state, date, seed }) {
      appendRecords(state, deriveComms(state, { from: date, to: date, seed, data: commsData }));
    },
  };
}

/** Adds derived records to the state's lists. WHY only adds: a deriver never changes commerce records. */
export function appendRecords(state, out) {
  if (!out) return;
  if (Array.isArray(out)) {
    for (const x of out) if (x && typeof x.kind === "string" && x.record) (state[x.kind] ||= []).push(x.record);
    return;
  }
  for (const [kind, records] of Object.entries(out)) {
    if (!Array.isArray(records) || !records.length) continue;
    const list = (state[kind] ||= []);
    for (const r of records) list.push(r);
  }
}

/**
 * Loads every plug-in that exists. Never throws: a missing or broken plug-in is reported in `skipped`.
 * @param {{only?: Array<string>, dataDir?: string, commsData?: object, biz?: object, products?: Array<object>}=} opts
 *     `only` limits to these names ("events", "comms", "world", "audience", "team"). The comms plug-in needs its template banks:
 *     `commsData`, or `dataDir` to read them from (Node only). The audience plug-in needs `biz.audience` and `products`.
 *     Order matters and is fixed: events, comms, world, audience (the audience adds to the day comms has written), team.
 * @return {Promise<{ plugins: Array<object>, skipped: Array<{name: string, why: string}> }>}
 */
export async function loadPlugins({ only = null, dataDir = null, commsData = null, biz = null, products = null } = {}) {
  const plugins = [], skipped = [];
  const want = (n) => !only || only.includes(n);
  if (want("events")) {
    try {
      const m = await import("../../infrastructure/engine/events.js");
      if (m.eventsPlugin && (m.eventsPlugin.modifiers || m.eventsPlugin.afterDay)) plugins.push(m.eventsPlugin);
      else skipped.push({ name: "events", why: "infrastructure/engine/events.js has no eventsPlugin export with modifiers or afterDay" });
    } catch (e) { skipped.push({ name: "events", why: missing(e, "infrastructure/engine/events.js") }); }
  }
  if (want("comms")) {
    try {
      const m = await import("../../business/builder/world/comms.mjs");
      const bank = commsData || (dataDir ? (await import("../../business/builder/world/comms-data.mjs")).loadCommsData(dataDir) : null);
      if (typeof m.deriveComms !== "function") skipped.push({ name: "comms", why: "business/builder/world/comms.mjs has no deriveComms function" });
      else if (!bank) skipped.push({ name: "comms", why: "no comms template banks: pass dataDir or commsData" });
      else plugins.push(commsPlugin(m.deriveComms, bank));
    } catch (e) { skipped.push({ name: "comms", why: missing(e, "business/builder/world/comms.mjs") }); }
  }
  if (want("world")) {
    // The wider world (simulation/world/plugins.mjs): economy, trends and opinion, competitors, supplier limits, consumer shifts.
    // Several plug-ins under one name, so `only: ["world"]` turns them all on or off together.
    try {
      const m = await import("../world/plugins.mjs");
      plugins.push(...m.worldPlugins({ products }));
    } catch (e) { skipped.push({ name: "world", why: missing(e, "simulation/world/plugins.mjs") }); }
  }
  if (want("audience")) {
    if (!biz?.audience || !products) skipped.push({ name: "audience", why: "needs biz.audience (business/data/audience.json) and the catalogue" });
    else {
      const { audiencePlugin } = await import("./audience.mjs");
      const comms = plugins.find((p) => p.name === "comms");
      plugins.push(audiencePlugin({ rates: biz.audience, products, commsData: comms ? comms.commsData : commsData }));
    }
  }
  if (want("team")) {
    // Staff chat that lives (simulation/simulator/team-chat.mjs): the team talks about the day and answers what people post. Last, so
    // it sees what comms wrote and does not say the same thing twice.
    try {
      const { teamChatPlugin } = await import("./team-chat.mjs");
      plugins.push(teamChatPlugin({ products: products || [] }));
    } catch (e) { skipped.push({ name: "team", why: missing(e, "simulation/simulator/team-chat.mjs") }); }
  }
  return { plugins, skipped };
}

function missing(e, file) {
  return /Cannot find module|ERR_MODULE_NOT_FOUND|Failed to fetch/.test(String(e?.code || e?.message)) ? `${file} does not exist yet` : `${file} failed to load: ${e.message}`;
}
