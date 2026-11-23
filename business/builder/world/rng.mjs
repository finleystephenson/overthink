// Seeded random numbers of our own, so the same seed always builds the same world.
// No Math.random and no clock anywhere in the generator.

/** FNV-1a: turns a string into a 32-bit number. Used to give every record its own random stream. */
export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: a small, well-known generator. Good enough for simulation, not for security. */
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (p) => next() < p,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    between: (lo, hi) => lo + next() * (hi - lo),
    pick: (list) => list[Math.floor(next() * list.length)],
    /** pairs: [[value, weight], ...] */
    weighted(pairs) {
      const total = pairs.reduce((n, [, w]) => n + w, 0);
      let r = next() * total;
      for (const [value, w] of pairs) {
        r -= w;
        if (r < 0) return value;
      }
      return pairs[pairs.length - 1][0];
    },
  };
}

/**
 * A random stream for one thing (a customer, an order, a purchase order).
 * WHY: each record draws from its own stream, so changing one part of the world
 * (for example a smaller delivery) does not reshuffle every record after it.
 */
export const rngFor = (seed, ...keys) => makeRng(hashString(`${seed}|${keys.join("|")}`));
