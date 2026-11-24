// The sandbox desktop's window manager, without the page: which windows are open, where, in what order, and what
// to remember. No DOM here, so it can be tested in Node (wm-core.test.mjs); applications/desktop/windows.js draws it.
//
// One window per app (an app is "open" or not, like a dock). A window is { app, url, x, y, w, h, z, min, max }.
// Positions are remembered per app in localStorage, through a guard: storage can be missing, blocked or full, and
// what it holds can be stale or nonsense (an older version, a bigger screen), so every value is checked and clamped.

/** The smallest a window can be made. */
export const MIN_W = 360;
export const MIN_H = 240;
/** How far each new window sits from the last, down and right. */
export const CASCADE = 28;
/** Always leave this much of a window's title bar on screen, so it can be dragged back. */
const KEEP = 96;
const STORE_KEY = "ot-desktop-windows";
const VERSION = 1;

/**
 * A guarded store: never throws, and reads back null for anything that is not valid JSON.
 * @param {?Storage} storage
 */
export function guardStorage(storage) {
  return {
    read(key) {
      try {
        const raw = storage?.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    write(key, value) {
      try {
        storage?.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;  // blocked or full: the desktop keeps working, it just forgets on reload
      }
    },
  };
}

const finite = (n) => typeof n === "number" && Number.isFinite(n);

/**
 * Keeps a rectangle usable inside the work area: at least the minimum size, no bigger than the area, and with
 * enough of the title bar on screen to grab.
 * @param {{x: number, y: number, w: number, h: number}} r
 * @param {{w: number, h: number, top: number, bottom: number}} area top: under the menu bar; bottom: above the dock
 */
export function clampRect(r, area) {
  const maxW = Math.max(MIN_W, area.w);
  const maxH = Math.max(MIN_H, area.bottom - area.top);
  const w = Math.round(Math.min(Math.max(r.w, MIN_W), maxW));
  const h = Math.round(Math.min(Math.max(r.h, MIN_H), maxH));
  const x = Math.round(Math.min(Math.max(r.x, KEEP - w), area.w - KEEP));
  const y = Math.round(Math.min(Math.max(r.y, area.top), area.bottom - 40));
  return { x, y, w, h };
}

/**
 * Like clampRect, and also brings the whole window onto the screen when it fits: for windows placed from memory or
 * after the screen changed size (a drag may still leave a window partly off screen on purpose).
 */
export function fitRect(r, area) {
  const c = clampRect(r, area);
  if (c.x + c.w > area.w) c.x = Math.max(0, area.w - c.w);
  if (c.y + c.h > area.bottom) c.y = Math.max(area.top, area.bottom - c.h);
  if (c.x < 0 && c.w <= area.w) c.x = 0;
  return c;
}

/**
 * The window manager's state.
 * @param {{storage?: ?Storage, area: {w: number, h: number, top: number, bottom: number}}} o
 */
export function createWindows({ storage = null, area }) {
  const store = guardStorage(storage);
  const wins = new Map();   // app id -> window
  const listeners = new Set();
  let z = 0;
  let work = { ...area };
  let opened = 0;           // windows opened this session, for the cascade

  const saved = readSaved();

  function readSaved() {
    const s = store.read(STORE_KEY);
    if (!s || s.v !== VERSION || typeof s.apps !== "object" || s.apps === null) return { apps: {}, open: [] };
    const apps = {};
    for (const [id, r] of Object.entries(s.apps)) {
      if (r && finite(r.x) && finite(r.y) && finite(r.w) && finite(r.h)) apps[id] = { x: r.x, y: r.y, w: r.w, h: r.h, max: r.max === true };
    }
    const open = Array.isArray(s.open) ? s.open.filter((id) => typeof id === "string").slice(0, 12) : [];
    return { apps, open };
  }

  function save() {
    for (const w of wins.values()) saved.apps[w.app] = { x: w.x, y: w.y, w: w.w, h: w.h, max: w.max };
    saved.open = list().filter((w) => !w.min).map((w) => w.app);
    store.write(STORE_KEY, { v: VERSION, apps: saved.apps, open: saved.open });
  }

  function emit(what, win) {
    for (const fn of listeners) fn(what, win);
  }

  /** Where a new window goes: its remembered place, else the next step of the cascade. */
  function placeFor(app) {
    const r = saved.apps[app];
    if (r) return { ...fitRect(r, work), max: r.max };
    const w = Math.min(1180, Math.round(work.w * 0.72));
    const h = Math.min(800, Math.round((work.bottom - work.top) * 0.8));
    const step = opened % 8;
    const x = Math.round((work.w - w) / 2 - 3.5 * CASCADE + step * CASCADE);
    const y = work.top + 20 + step * CASCADE;
    return { ...clampRect({ x, y, w, h }, work), max: false };
  }

  /** The windows from back to front. */
  function list() {
    return [...wins.values()].sort((a, b) => a.z - b.z);
  }

  /** The window in front that is not minimised, or null. */
  function focused() {
    const v = list().filter((w) => !w.min);
    return v.at(-1) || null;
  }

  return {
    /**
     * Opens an app's window, or brings it back and forward if it is open. A new url replaces the old one.
     * @param {string} app
     * @param {{url?: string}=} o
     */
    open(app, { url } = {}) {
      let w = wins.get(app);
      if (w) {
        w.min = false;
        if (url) w.url = url;
        w.z = ++z;
        emit("focus", w);
        save();
        return w;
      }
      w = { app, url: url || null, ...placeFor(app), z: ++z, min: false };
      opened++;
      wins.set(app, w);
      emit("open", w);
      save();
      return w;
    },
    focus(app) {
      const w = wins.get(app);
      if (!w) return null;
      if (w.min) w.min = false;
      if (w.z !== z) w.z = ++z;
      emit("focus", w);
      return w;
    },
    close(app) {
      const w = wins.get(app);
      if (!w) return false;
      saved.apps[app] = { x: w.x, y: w.y, w: w.w, h: w.h, max: w.max };
      wins.delete(app);
      emit("close", w);
      save();
      return true;
    },
    minimise(app) {
      const w = wins.get(app);
      if (!w || w.min) return null;
      w.min = true;
      emit("minimise", w);
      save();
      return w;
    },
    /** Maximised fills the work area; again puts it back where it was. */
    toggleMax(app) {
      const w = wins.get(app);
      if (!w) return null;
      w.max = !w.max;
      w.z = ++z;
      emit("max", w);
      save();
      return w;
    },
    /** Moves and/or resizes. Leaving maximised is implied: a dragged window is a normal window again. */
    setRect(app, r, { persist = true } = {}) {
      const w = wins.get(app);
      if (!w) return null;
      Object.assign(w, clampRect({ x: r.x ?? w.x, y: r.y ?? w.y, w: r.w ?? w.w, h: r.h ?? w.h }, work), { max: r.max ?? false });
      emit("rect", w);
      if (persist) save();
      return w;
    },
    /**
     * Brings the next window forward, as Cmd+` does: the one at the back comes to the front (dir 1), or the front
     * one goes to the back (dir -1).
     */
    cycle(dir = 1) {
      const v = list().filter((w) => !w.min);
      if (v.length < 2) return v[0] || null;
      if (dir > 0) {
        const back = v[0];
        back.z = ++z;
        emit("focus", back);
        return back;
      }
      const front = v.at(-1);
      const low = Math.min(...v.map((w) => w.z));
      front.z = low - 1;
      const next = list().filter((w) => !w.min).at(-1);
      emit("focus", next);
      return next;
    },
    /** The screen changed size: keep every window reachable. */
    setArea(a) {
      work = { ...a };
      for (const w of wins.values()) Object.assign(w, fitRect(w, work));
      emit("area", null);
    },
    get(app) {
      return wins.get(app) || null;
    },
    list,
    focused,
    area: () => ({ ...work }),
    /** The apps that were open when the page was last left, back to front. */
    restorable: () => [...saved.open],
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
