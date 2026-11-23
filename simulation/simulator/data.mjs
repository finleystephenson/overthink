// Reads the business definition for the simulator: business/data/sim.json, business/data/staff.json, business/data/costs.json and the prospects.
// To describe another kind of business, point --data at a folder holding the same files; nothing else is read from code.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { audienceRates } from "./audience.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));

export function loadBusiness(dir = path.join(ROOT, "business", "data")) {
  const characters = fs.existsSync(path.join(dir, "characters.json")) ? read(dir, "characters.json") : [];
  // audience.json: how the outside world answers posts, mail, replies and catalogue changes (simulation/simulator/audience.mjs).
  const audience = fs.existsSync(path.join(dir, "audience.json")) ? audienceRates(read(dir, "audience.json")) : null;
  const sim = read(dir, "sim.json");
  // population.json: real-world circumstances for the customers (simulation/world/build-population.mjs). Optional: without it the
  // customer model is exactly as before. Attached as a non-enumerable property so it never lands in saved settings.
  if (fs.existsSync(path.join(dir, "population.json")) && sim.customer_model) {
    Object.defineProperty(sim.customer_model, "population", { value: read(dir, "population.json"), enumerable: false });
  }
  return { dir, sim, staff: read(dir, "staff.json"), costs: read(dir, "costs.json"), characters, audience };
}
