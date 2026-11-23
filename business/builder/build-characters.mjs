// Writes business/data/characters.json: the first 1,010 characters unchanged and in order, then the extra ones.
// node business/builder/build-characters.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHARACTERS } from "./world/characters.mjs";
import { buildExtra } from "./world/characters-extra.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const first = CHARACTERS.map(({ name, from, home, postcode, address_line, town, kind }) => ({ name, from, home, postcode, address_line, town, kind }));
const { characters, dropped, areas } = buildExtra();
fs.writeFileSync(path.join(ROOT, "business/data/characters.json"), JSON.stringify([...first, ...characters], null, 1) + "\n");
console.log(JSON.stringify({ first: first.length, added: characters.length, total: first.length + characters.length, duplicates_skipped: dropped.length, new_areas: areas.length }));
