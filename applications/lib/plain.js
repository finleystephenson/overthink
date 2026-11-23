// Plain words, never codes. The business's records carry ids such as ORD-10442 or CT-00218; a person reads
// "Order 10442", a customer's name, or nothing at all. Every screen writes references and data-written text
// (chat lines, emails, notes) through these two helpers.
//
//   plainRef("ORD-10442")             -> "Order 10442"
//   plainText("ORD-20145 reached Mowgli late (CT-00218).") -> "Order 20145 reached Mowgli late."
//   rememberName("C-1002", "Mowgli")  -> later plainRef("C-1002") is "Mowgli"
import { TEAM, PEOPLE } from "./people.js";

/** Codes a person can say out loud: the word, and whether the number is worth keeping. */
const SAYABLE = [
  [/^ORD-(\d+)$/i, "order"],
  [/^PO-(\d+)$/i, "purchase order"],
  [/^CASE-(\d+)$/i, "case"],
  [/^FIX-(\d+)$/i, "repair"],
  [/^RET-(\d+)$/i, "return"],
  [/^REP-(\d+)$/i, "replacement"],
  [/^INV-(\d+)$/i, "invoice"],
  [/^REV-(\d+)$/i, "review"],
];

/** Codes that mean nothing to a person: never shown. */
const HIDDEN = /^(CT|EM|SP|CH|CONV|WE|NW|LED|MV|MSG|TH|TR|EV|AC|SC|tok)[-_]/i;

const names = new Map();  // customer or supplier id -> name, learned as screens read records

/**
 * Remembers what an id is called, so it can be said by name from then on (customers, suppliers, products).
 * @param {string} id
 * @param {string} name
 */
export function rememberName(id, name) {
  if (id && name) names.set(String(id), String(name));
}

/**
 * A reference as a person says it: "Order 10442", "Purchase order 3289", a customer's or person's name.
 * Returns "" for a code that should never be shown.
 * @param {string} code
 * @param {{lower?: boolean}=} options lower: "order 10442", for the middle of a sentence
 */
export function plainRef(code, { lower = false } = {}) {
  const c = String(code ?? "").trim();
  if (!c) return "";
  for (const [re, word] of SAYABLE) {
    const m = c.match(re);
    if (m) return `${lower ? word : word[0].toUpperCase() + word.slice(1)} ${m[1]}`;
  }
  if (names.has(c)) return names.get(c);
  if (/^S-\d+$/i.test(c)) return TEAM.find((p) => p.id === c)?.name || PEOPLE.find((p) => p.id === c)?.name || "someone on the team";
  if (/^C-\d+$/i.test(c)) return lower ? "a customer" : "A customer";
  if (/^SUP-\d+$/i.test(c)) return lower ? "a supplier" : "A supplier";
  if (HIDDEN.test(c)) return "";
  return c;
}

// One pattern for every code that can turn up inside text: letters, a dash or underscore, then digits.
const CODE = /\b(ORD|PO|CASE|FIX|RET|REP|INV|REV|C|S|SUP|CT|EM|SP|CH|CONV|WE|NW|LED|MV|MSG|TH|TR|EV|AC|SC)-\d+\b/g;

/**
 * Text written by the data, with every code made plain: sayable codes become words, names replace customer
 * and staff ids, and codes that mean nothing are taken out (with the brackets or "#" around them).
 * @param {string} text
 * @return {string}
 */
export function plainText(text) {
  if (!text) return "";
  return String(text)
    // A hidden code in brackets, or after "#", "no." or "ref", goes with its wrapping.
    .replace(/\s*\((?:ref\.?\s*|no\.?\s*|#)?((?:CT|EM|SP|CH|CONV|WE|NW|LED|MV|MSG|TH|TR|EV|AC|SC)-\d+)\)/gi, "")
    .replace(CODE, (code, _p, offset, whole) => {
      const startOfSentence = offset === 0 || /[.!?:]\s*$|\n\s*$/.test(whole.slice(0, offset));
      return plainRef(code, { lower: !startOfSentence });
    })
    // "order order 10442" or "the Order 10442" read badly once codes are words.
    .replace(/\b(order|purchase order|case|repair|return)\s+(?:no\.?\s*|number\s*|#\s*)?\1 (\d+)/gi, "$1 $2")
    .replace(/\b(the|your|my|our)\s+(Order|Purchase order|Case|Repair|Return) (\d+)/g, (m, a, w, n) => `${a} ${w.toLowerCase()} ${n}`)
    .replace(/#\s*(?=\s|$)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}
