// Engine extension: the WORLD LENS on people. Shows traits a real business would never know (age, income,
// household, circumstances, who knows whom), so it is for the explorer and the lab, not for a connected AI.
// Callable by the `world` lens (engine LENSES) and, for now, the manager too.
// Registration: import "./people.js" in infrastructure/engine/all.js.
import { extend, kit } from "../../infrastructure/engine/engine.js";
import { personKey } from "./population.mjs";

const { fail, schema: { str, num, obj } } = kit;
const FILE = new URL("../../business/data/population.json", import.meta.url);
let cache; // undefined = not tried yet, null = no file

/** The population file, read once (Node only; returns null anywhere without files, or before it is built). */
function population() {
  if (cache !== undefined) return cache;
  try {
    const fs = globalThis.process?.getBuiltinModule?.("node:fs");
    cache = fs && fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : null;
  } catch { cache = null; }
  return cache;
}

function need() {
  const p = population();
  if (!p) fail("not_found", "No population has been built yet. Run: node simulation/world/build-population.mjs");
  return p;
}

/** One person as the tools show them: traits plus the names of the people they know. */
function view(p, key) {
  const t = p.people[key];
  const { ties, ...traits } = t;
  return { key, ...traits, knows: ties.map(([k, type]) => ({ key: k, name: p.people[k]?.name, how: type })) };
}

extend({
  tools: [
    {
      name: "get_person", roles: ["world"],
      description: "World lens: everything the simulated world holds about one customer, including traits a business would not know (age band, household, income fifth, employment, area, online shopping habit, preferred channel, circumstances) and the people they know (household, neighbour, friend). Say who by name or key.",
      input_schema: obj({ name: str, key: str }),
      run(ctx, i) {
        const p = need();
        const key = i.key || (i.name ? personKey(i.name) : "");
        if (!p.people[key]) fail("not_found", `No one called "${i.name || i.key}" is in the population.`);
        return view(p, key);
      },
    },
    {
      name: "list_people", roles: ["world"],
      description: "World lens: finds customers by their traits. Filters (all optional, all must match): trait as 'name=value' such as 'income=Q1' or 'employment=retired', circumstance such as 'carer', book, town, limit (default 25, at most 200). Returns the total that match and a page of them.",
      input_schema: obj({ trait: str, circumstance: str, book: str, town: str, limit: num }),
      run(ctx, i) {
        const p = need();
        let [tn, tv] = String(i.trait || "").split("=");
        if (i.trait && !tv) fail("invalid_input", "trait must look like name=value, for example income=Q1.");
        const low = (s) => String(s ?? "").toLowerCase();
        const hits = Object.entries(p.people).filter(([, t]) =>
          (!i.trait || t[tn] === tv) &&
          (!i.circumstance || t.circumstances.includes(i.circumstance)) &&
          (!i.book || low(t.book) === low(i.book)) &&
          (!i.town || low(t.town) === low(i.town)));
        const limit = Math.min(200, Math.max(1, Math.floor(i.limit || 25)));
        return { total: hits.length, shown: Math.min(limit, hits.length), people: hits.slice(0, limit).map(([key, t]) => ({ key, name: t.name, book: t.book, age: t.age, employment: t.employment, income: t.income, circumstances: t.circumstances })) };
      },
    },
  ],
});
