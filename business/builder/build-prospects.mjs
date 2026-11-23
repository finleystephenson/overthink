// Builds business/data/prospects.json from business/builder/prospects-source.txt. node business/builder/build-prospects.mjs
// Each prospect is a business or institution from classic fiction, with a decision maker taken from the same story
// (so the decision maker must be in business/data/characters.json; the address comes from that character).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashString } from "./world/rng.mjs";
import { slug } from "./world/characters.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CODES = {
  SAND3: ["emergency-sandwich", "OT-SAND-HAM-3"], TROF: ["trophy", "OT-TROF"], UMBR: ["other-umbrella", "OT-UMBR"], BISC: ["biscuit-tin", "OT-BISC-24"],
  WRAP: ["bubble-wrap", "OT-WRAP"], SOCK: ["spare-sock", "OT-SOCK"], PLAN5: ["paper-aeroplane", "OT-PLAN-5"], PEN: ["one-good-pen", "OT-PEN"],
  HELM: ["indoor-helmet", "OT-HELM"], PACK: ["daypack", "OT-PACK"], ICE: ["ice-by-post", "OT-ICE"], JUNG: ["pocket-jungle", "OT-JUNG"],
  PUDL: ["starter-puddle", "OT-PUDL"], STON: ["skimming-stones", "OT-STON-SKP-5"], BOOM: ["boombox-mini", "OT-BOOM"], BLIP: ["blip", "OT-BLIP"],
};
const EVERY = { w: "week", m: "month", q: "quarter", o: "once" };
const BANDS = { micro: [20, 100], small: [100, 500], medium: [500, 2000], large: [2000, 10000] };
const chars = JSON.parse(fs.readFileSync(path.join(ROOT, "business/data/characters.json"), "utf8"));
const byName = new Map(chars.map((c) => [c.name, c]));
const prices = {};
for (const f of fs.readdirSync(path.join(ROOT, "business/data/products"))) {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, "business/data/products", f), "utf8"));
  for (const x of [...p.variants, ...(p.accessories || [])]) prices[x.sku] = x.price;
}
const missing = [], out = [];
let n = 0;
for (const raw of fs.readFileSync(path.join(ROOT, "business/builder/prospects-source.txt"), "utf8").split("\n")) {
  if (!raw.trim() || raw.startsWith("#")) continue;
  const [name, sector, staff, dm, needsText, band, propensity, channel] = raw.split("|").map((s) => s.trim());
  const who = byName.get(dm);
  if (!who) { missing.push(`${name}: ${dm}`); continue; }
  const needs = needsText.split(",").map((t) => {
    const m = t.trim().match(/^([A-Z0-9]+)\s*x\s*(\d+)\s*\/\s*([wmqo])$/);
    if (!m || !CODES[m[1]]) throw new Error(`Bad need "${t}" in ${name}`);
    const [product, sku] = CODES[m[1]];
    return { product, sku, qty: Number(m[2]), every: EVERY[m[3]], unit_price: prices[sku] };
  });
  // Monthly value of the needs at list price (once-only needs counted over a year).
  const perMonth = { week: 4.33, month: 1, quarter: 1 / 3, once: 1 / 12 };
  const value = needs.reduce((s, x) => s + x.qty * x.unit_price * perMonth[x.every], 0);
  const [lo, hi] = BANDS[band];
  // WHY: a tiny jitter from the name, so budgets are not all the same round number.
  const jitter = 0.9 + (hashString("budget|" + name) % 21) / 100;
  const monthly_budget = Math.round(Math.min(hi, Math.max(lo, value * 1.15 * jitter)));
  out.push({
    id: "PR-" + String(++n).padStart(3, "0"), name, sector, staff: Number(staff),
    location: { address_line: who.address_line, town: who.town, postcode: who.postcode },
    needs, budget_band: band, monthly_budget,
    decision_maker: { name: dm, from: who.from, email: `${slug(dm)}.${"pr-" + String(n).padStart(3, "0")}@example.com` },
    preferred_channel: channel, status: "new", last_contacted: null, notes: "",
    // Only the simulator reads `private`; the engine never shows it to a tool.
    private: { reply_propensity: Number(propensity) },
  });
}
if (missing.length) { console.error("Decision maker not in business/data/characters.json:\n" + missing.join("\n")); process.exit(1); }
fs.writeFileSync(path.join(ROOT, "business/data/prospects.json"), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify({ prospects: out.length, sectors: [...new Set(out.map((p) => p.sector))].length }));
