// The second customer list: more out-of-copyright characters, read from tools/world/extra/*.txt.
// Rights rule (UK): the author died before 1 Jan 1956, or the story is anonymous and traditional.
// Left out on purpose: Peter Pan, Milne, Tolkien, Lewis, Christie, Wodehouse, Blyton, Dahl, and anything from a film or television studio.
// File format:  "# Work | Author | year"  starts a source;  "@ Place / Street"  sets the town and street;
// a line with "|" is one character: Name | address | kind letter;  any other line is a comma-separated list of names.
// Kind letters (g gift, r regular, x returns a lot, c complains, b business) as in characters.mjs; no letter gives a fixed hash of the name.
// Every new place gets its own postcode district under an invented area that is not a real UK area.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHARACTERS, CHARACTER_AREAS, REAL_UK_AREAS } from "./characters.mjs";
import { hashString } from "./rng.mjs";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "extra");
const KINDS = { g: "gift", r: "regular", x: "returns_a_lot", c: "complains", b: "business" };
const DEFAULT_KINDS = [["gift", 0.58], ["regular", 0.38], ["returns_a_lot", 0.04]];
const LETTERS = "ABDEFGHJLNPQRSTUWXYZ";
const kindOf = (name) => {
  let r = (hashString("kind|" + name) % 10000) / 10000;
  for (const [k, s] of DEFAULT_KINDS) { if (r < s) return k; r -= s; }
  return "gift";
};

/** Free invented postcode areas, never a real one and never one a first-list place already uses. */
function freeAreas() {
  const taken = new Set([...CHARACTER_AREAS, "MH", "QQ", "ZZ", "HI"]);
  const out = [];
  for (const a of "ABDEFGHJLNPQRSTUWXYZ") for (const b of "ABDEFGHJLNPQRSTUWXYZ") {
    const code = a + b;
    if (!REAL_UK_AREAS.has(code) && !taken.has(code)) out.push(code);
  }
  return out;
}

export function buildExtra() {
  const have = new Set(CHARACTERS.map((c) => c.name));
  const areas = freeAreas();
  const out = [], dropped = [], places = new Map();
  let nextSlot = 0, source = { work: "", author: "", year: 0 }, place = "", street = "", counter = 0;
  const slot = (p) => {
    if (!places.has(p)) { const i = nextSlot++; places.set(p, { area: areas[Math.floor(i / 9)], district: 1 + (i % 9) }); }
    return places.get(p);
  };
  const add = (name, address, letter) => {
    name = name.trim();
    if (!name) return;
    if (have.has(name)) { dropped.push(name); return; }
    have.add(name);
    const { area, district } = slot(place);
    if (!area) throw new Error("Out of postcode areas");
    const line = address || `${3 + (counter++ % 60) * 2} ${street}`;
    const h = hashString("postcode|" + name);
    out.push({
      name, from: source.work, home: `${line}, ${place}`, postcode: `${area}${district} ${1 + (h % 9)}${LETTERS[(h >>> 4) % LETTERS.length]}${LETTERS[(h >>> 9) % LETTERS.length]}`,
      address_line: line, town: place, kind: KINDS[letter] || kindOf(name), source_author: source.author, source_year: source.year,
    });
  };
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort()) {
    for (const raw of fs.readFileSync(path.join(DIR, file), "utf8").split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("# ")) { const [work, author, year] = line.slice(2).split("|").map((s) => s.trim()); source = { work, author, year: Number(year) }; continue; }
      if (line.startsWith("@ ")) { [place, street] = line.slice(2).split(" / ").map((s) => s.trim()); counter = 0; continue; }
      if (line.includes("|")) { const [n, a, k] = line.split("|").map((s) => s.trim()); add(n, a, k); continue; }
      for (const n of line.split(",")) add(n);
    }
  }
  return { characters: out, dropped, areas: [...new Set([...places.values()].map((p) => p.area))] };
}
