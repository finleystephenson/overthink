// The desktop's window manager without a page: open, focus, z-order, minimise, cycle, clamping and the storage guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CASCADE, MIN_H, MIN_W, clampRect, createWindows, guardStorage } from "./wm-core.js";

const AREA = { w: 1440, h: 900, top: 32, bottom: 808 };

/** A Storage stand-in that keeps values in a Map. */
function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test("opening an app makes one window, in front, and opening it again reuses it", () => {
  const wm = createWindows({ area: AREA });
  const a = wm.open("letterbox");
  const b = wm.open("till");
  assert.equal(wm.focused(), b);
  assert.equal(wm.list().length, 2);
  const again = wm.open("letterbox");
  assert.equal(again, a);
  assert.equal(wm.list().length, 2);
  assert.equal(wm.focused().app, "letterbox");
});

test("new windows cascade down and to the right", () => {
  const wm = createWindows({ area: AREA });
  const a = wm.open("a");
  const b = wm.open("b");
  assert.equal(b.x - a.x, CASCADE);
  assert.equal(b.y - a.y, CASCADE);
});

test("focus brings a window to the front; z-order is back to front", () => {
  const wm = createWindows({ area: AREA });
  wm.open("a");
  wm.open("b");
  wm.open("c");
  wm.focus("a");
  assert.deepEqual(wm.list().map((w) => w.app), ["b", "c", "a"]);
  assert.equal(wm.focused().app, "a");
});

test("minimised windows are never the focused one; focusing restores them", () => {
  const wm = createWindows({ area: AREA });
  wm.open("a");
  wm.open("b");
  wm.minimise("b");
  assert.equal(wm.focused().app, "a");
  wm.minimise("a");
  assert.equal(wm.focused(), null);
  wm.focus("b");
  assert.equal(wm.get("b").min, false);
  assert.equal(wm.focused().app, "b");
});

test("close forgets the window but remembers where it was", () => {
  const store = memory();
  const wm = createWindows({ storage: store, area: AREA });
  wm.open("a");
  wm.setRect("a", { x: 200, y: 100, w: 700, h: 500 });
  assert.equal(wm.close("a"), true);
  assert.equal(wm.get("a"), null);
  const back = wm.open("a");
  assert.deepEqual([back.x, back.y, back.w, back.h], [200, 100, 700, 500]);
});

test("cycle brings the back window forward, and backwards sends the front one back", () => {
  const wm = createWindows({ area: AREA });
  wm.open("a");
  wm.open("b");
  wm.open("c");
  assert.equal(wm.cycle(1).app, "a");
  assert.deepEqual(wm.list().map((w) => w.app), ["b", "c", "a"]);
  assert.equal(wm.cycle(-1).app, "c");
  assert.equal(wm.list()[0].app, "a");
});

test("toggleMax flips and a moved window is no longer maximised", () => {
  const wm = createWindows({ area: AREA });
  wm.open("a");
  assert.equal(wm.toggleMax("a").max, true);
  wm.setRect("a", { x: 10, y: 50 });
  assert.equal(wm.get("a").max, false);
});

test("positions persist per app and come back in a new session", () => {
  const store = memory();
  const one = createWindows({ storage: store, area: AREA });
  one.open("letterbox");
  one.setRect("letterbox", { x: 300, y: 120, w: 800, h: 600 });
  one.open("till");
  const two = createWindows({ storage: store, area: AREA });
  assert.deepEqual(two.restorable(), ["letterbox", "till"]);
  const w = two.open("letterbox");
  assert.deepEqual([w.x, w.y, w.w, w.h], [300, 120, 800, 600]);
});

test("the storage guard survives blocked, full and nonsense storage", () => {
  const throws = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } };
  const g = guardStorage(throws);
  assert.equal(g.read("x"), null);
  assert.equal(g.write("x", 1), false);
  assert.equal(guardStorage(null).read("x"), null);
  const junk = memory();
  junk.setItem("ot-desktop-windows", "{not json");
  const wm = createWindows({ storage: junk, area: AREA });
  assert.deepEqual(wm.restorable(), []);
  assert.ok(wm.open("a"));
  const old = memory();
  old.setItem("ot-desktop-windows", JSON.stringify({ v: 1, apps: { a: { x: "left", y: 1, w: 2, h: 3 }, b: { x: 1e9, y: -1e9, w: 99999, h: 5 } }, open: ["b", 4] }));
  const wm2 = createWindows({ storage: old, area: AREA });
  assert.deepEqual(wm2.restorable(), ["b"]);
  const a = wm2.open("a");  // its saved place was not numbers: a fresh place
  assert.ok(Number.isFinite(a.x));
  const b = wm2.open("b");  // saved off screen and too big: pulled back and cut down
  assert.ok(b.x <= AREA.w - 96 && b.y >= AREA.top && b.w <= AREA.w && b.h >= MIN_H);
});

test("clampRect keeps the minimum size and a title bar on screen", () => {
  const r = clampRect({ x: -5000, y: -10, w: 10, h: 10 }, AREA);
  assert.equal(r.w, MIN_W);
  assert.equal(r.h, MIN_H);
  assert.equal(r.y, AREA.top);
  assert.ok(r.x + r.w >= 96);
});

test("a smaller screen pulls every window back into reach", () => {
  const wm = createWindows({ area: AREA });
  wm.open("a");
  wm.setRect("a", { x: 1300, y: 700, w: 500, h: 400 });
  wm.setArea({ w: 800, h: 600, top: 32, bottom: 520 });
  const a = wm.get("a");
  assert.ok(a.x <= 800 - 96 && a.y <= 520 - 40);
});
