// Watching the AI at any speed, without the page: how fast things are happening, whether the desktop should show
// each action in its window (normal) or switch to the calm notification panel, how actions group and count, what
// the panel shows at each playback speed, and the timeline to step back through. Tested in watch.test.mjs.
//
// Events are the run's live events (docs/live-events.md, `overthink.live/1`). On `overthink up` there is no live
// stream, so fromTrace() turns the sandbox's own record of calls into the same shape.

import { hrefFor } from "../lib/your-ai.js";

/** The defaults. `enterRate` is events a second; `?calm=<n>` on the desktop's address changes it. */
export const WATCH = {
  enterRate: 1,     // at or above this, calm mode
  exitRate: 0.4,    // and back to normal only below this ...
  holdMs: 6000,     // ... for this long (so a burst with pauses does not flip the screen back and forth)
  windowMs: 4000,   // the rate is measured over this much time
  slowMs: 650,      // "slow" shows one line this often
  backlog: 4000,    // the most lines "slow" or "paused" keeps waiting
};

/** The types the desktop watches. Everything else (arm and day markers) only moves the clock. */
const WATCHED = new Set(["contact.raised", "product.read", "product.acted", "product.replied", "product.published",
  "person.reacted", "activity"]);

/** Whether an event is something to show (the twin "without" arm never is). */
export function isWatched(e) {
  return Boolean(e) && e.arm !== "without" && WATCHED.has(e.type);
}

/** Whether an event is the AI itself acting (not reading, not people). */
export function isAiAction(e) {
  return e.type === "product.acted" || e.type === "product.replied" || e.type === "product.published";
}

// ------------------------------------------------------------------ rate

/**
 * Events a second over a sliding window. Counts go in 100ms buckets so thousands a second cost nothing.
 * @param {number=} windowMs
 */
export function createRate(windowMs = WATCH.windowMs) {
  const SLOT = 100;
  const slots = new Map();  // slot number -> count
  function trim(now) {
    const oldest = Math.floor((now - windowMs) / SLOT);
    for (const k of slots.keys()) if (k <= oldest) slots.delete(k);
  }
  return {
    add(now, n = 1) {
      const k = Math.floor(now / SLOT);
      slots.set(k, (slots.get(k) || 0) + n);
      if (slots.size > windowMs / SLOT + 4) trim(now);
    },
    /** Events a second, now. */
    rate(now) {
      trim(now);
      let n = 0;
      for (const c of slots.values()) n += c;
      return n / (windowMs / 1000);
    },
  };
}

/**
 * Normal or calm, with hysteresis: calm as soon as the rate reaches `enterRate`; normal again only after the rate
 * has stayed under `exitRate` for `holdMs`.
 * @param {{enterRate?: number, exitRate?: number, holdMs?: number}=} o
 */
export function createModeSwitch(o = {}) {
  const enter = o.enterRate ?? WATCH.enterRate;
  const exit = Math.min(o.exitRate ?? WATCH.exitRate, enter);
  const hold = o.holdMs ?? WATCH.holdMs;
  let mode = "normal";
  let quietSince = null;
  return {
    /** @return {"normal"|"calm"} */
    update(rate, now) {
      if (mode === "normal") {
        if (rate >= enter) { mode = "calm"; quietSince = null; }
      } else if (rate < exit) {
        quietSince ??= now;
        if (now - quietSince >= hold) { mode = "normal"; quietSince = null; }
      } else {
        quietSince = null;
      }
      return mode;
    },
    get mode() { return mode; },
  };
}

// ------------------------------------------------------------------ what happened, in a word

/** Tool names in a word or two, for the counts. Anything else is the tool's own name, spaced out. */
const ACTION = {
  send_email: "Sent emails", reply_email: "Answered emails", open_case: "Opened cases", add_case_note: "Added notes",
  close_case: "Closed cases", update_case: "Updated cases", issue_refund: "Gave refunds", refund_order: "Gave refunds",
  create_return: "Started returns", approve_return: "Approved returns", cancel_order: "Cancelled orders",
  send_replacement: "Sent replacements", hand_over: "Passed to a person", escalate_case: "Passed to a person",
  verify_customer: "Checked identity", update_order: "Changed orders", apply_discount: "Gave discounts",
  post_social: "Posted", reply_social: "Replied on social", send_social_message: "Sent messages",
  send_newsletter: "Sent newsletters", set_price: "Changed prices", create_purchase_order: "Ordered stock",
  post_message: "Wrote in team chat", create_task: "Made tasks", send_chat_message: "Wrote in team chat",
  create_social_post: "Posted", reply_social_post: "Replied on social", reply_to_review: "Answered reviews",
  add_goodwill_credit: "Gave goodwill credit", resolve_case: "Closed cases", change_price: "Changed prices",
};

const spaced = (s) => {
  const t = String(s || "").replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
};

/**
 * What an event is, in a word or two, for grouping and counting ("Replied", "Read", "Wrote in").
 * @param {object} e
 * @return {string}
 */
export function actionOf(e) {
  const d = e.data || {};
  switch (e.type) {
    case "product.read": return "Looked things up";
    case "product.acted": return d.refused ? "Was stopped" : d.ok === false ? "Tried and failed" : ACTION[d.tool] || spaced(d.tool) || "Acted";
    case "product.replied": return "Replied";
    case "product.published": return d.kind === "newsletter" ? "Sent newsletters" : d.kind === "product_page" ? "Wrote product pages" : "Posted";
    case "contact.raised": return "Wrote in";
    case "person.reacted": return d.kind === "panel" ? "Reacted to posts" : d.kind === "staff" ? "Staff tried it" : "Answered back";
    case "activity": return spaced(d.action) || "Something happened";
    default: return spaced(e.type);
  }
}

/** Who did it: "ai" (your AI), "people" (customers, staff, the world). */
export function whoOf(e) {
  return e.type.startsWith("product.") ? "ai" : "people";
}

/** The conversation or piece of work an event belongs to, for "follow one thread". */
export function threadOf(e) {
  return e.session || e.record || null;
}

/** The app an event happened in, or "other". */
export function appOf(e) {
  return e.app || "other";
}

/** Running counts per app, and per app and action. */
export function createGroups() {
  const apps = new Map();     // app -> { app, count, ai, last }
  const actions = new Map();  // app|action -> { app, action, who, count, last }
  let total = 0;
  return {
    add(e) {
      const app = appOf(e);
      const action = actionOf(e);
      const who = whoOf(e);
      total++;
      const a = apps.get(app) || { app, count: 0, ai: 0, last: null };
      a.count++;
      if (who === "ai") a.ai++;
      a.last = e;
      apps.set(app, a);
      const key = `${app}|${action}`;
      const g = actions.get(key) || { key, app, action, who, count: 0, last: null };
      g.count++;
      g.last = e;
      actions.set(key, g);
    },
    get total() { return total; },
    /** Apps, busiest first. */
    apps: () => [...apps.values()].sort((a, b) => b.count - a.count),
    /** Actions, busiest first; only one app's with `app`. */
    actions: (app = null) => [...actions.values()].filter((g) => !app || g.app === app).sort((a, b) => b.count - a.count),
    clear() { apps.clear(); actions.clear(); total = 0; },
  };
}

// ------------------------------------------------------------------ playback speed

/**
 * What the panel's stream shows at each speed. Every event goes in; take() says which to draw now.
 *   live    the newest lines, as fast as they come (older ones scroll away unseen; the counts keep them)
 *   slow    one line every `slowMs`, oldest first, from a backlog (so a person can read along)
 *   paused  nothing new is drawn; `waiting` says how many lines are held
 * @param {{slowMs?: number, backlog?: number, live?: number}=} o live: the most lines live mode draws at once
 */
export function createPlayback(o = {}) {
  const slowMs = o.slowMs ?? WATCH.slowMs;
  const cap = o.backlog ?? WATCH.backlog;
  const liveMax = o.live ?? 40;
  let speed = "live";
  let queue = [];
  let lastShown = -Infinity;
  let dropped = 0;
  return {
    push(e) {
      queue.push(e);
      if (queue.length > cap) { dropped += queue.length - cap; queue = queue.slice(-cap); }
    },
    /** @return {{show: Array<object>, waiting: number, dropped: number}} */
    take(now) {
      let show = [];
      if (speed === "live") {
        show = queue.slice(-liveMax);
        queue = [];
      } else if (speed === "slow" && queue.length && now - lastShown >= slowMs) {
        show = [queue.shift()];
        lastShown = now;
      }
      const out = { show, waiting: queue.length, dropped };
      dropped = 0;
      return out;
    },
    setSpeed(s) {
      if (s !== "live" && s !== "slow" && s !== "paused") return;
      // Back to live from a held queue: jump to now rather than flooding the stream with what was held.
      if (s === "live" && speed !== "live") queue = queue.slice(-liveMax);
      speed = s;
    },
    get speed() { return speed; },
    get waiting() { return queue.length; },
  };
}

// ------------------------------------------------------------------ the timeline

/** When an event happened, in milliseconds: its own wall-clock time, else when it arrived. */
export function timeOf(e, arrived = 0) {
  const t = Date.parse(e.at || "");
  return Number.isFinite(t) ? t : arrived;
}

/**
 * Every event so far, in order, to step back through. Keeps the newest `cap`.
 * @param {{cap?: number}=} o
 */
export function createTimeline({ cap = 200000 } = {}) {
  let items = [];   // { e, t }
  let first = 0;    // how many were let go from the front
  return {
    push(e, arrived = Date.now()) {
      const prev = items.at(-1)?.t ?? -Infinity;
      // Times never go backwards on the axis, so a search by time stays a binary search.
      items.push({ e, t: Math.max(timeOf(e, arrived), prev) });
      if (items.length > cap * 1.1) { const cut = items.length - cap; items = items.slice(cut); first += cut; }
    },
    get size() { return items.length; },
    get dropped() { return first; },
    get(i) { return items[i]?.e ?? null; },
    timeAt(i) { return items[i]?.t ?? null; },
    range() {
      return items.length ? { from: items[0].t, to: items.at(-1).t } : null;
    },
    /** The index of the last event at or before time t (0 when t is before them all). */
    indexAt(t) {
      let lo = 0, hi = items.length - 1, ans = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (items[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return ans;
    },
    /** How many events fall in each of n equal slices of time, for the density strip above the scrubber. */
    bins(n) {
      const out = new Array(n).fill(0);
      const r = this.range();
      if (!r) return out;
      const span = Math.max(1, r.to - r.from);
      for (const it of items) out[Math.min(n - 1, Math.floor(((it.t - r.from) / span) * n))]++;
      return out;
    },
    /** The events of one thread, in order. */
    thread(id) {
      return items.filter((it) => threadOf(it.e) === id).map((it) => it.e);
    },
    /** Events matching some words, newest first. */
    find(words, n = 6, text = (e) => e.summary || "") {
      const ws = String(words).toLowerCase().split(/\s+/).filter(Boolean);
      const out = [];
      for (let i = items.length - 1; i >= 0 && out.length < n; i--) {
        const s = text(items[i].e).toLowerCase();
        if (ws.every((w) => s.includes(w))) out.push(items[i].e);
      }
      return out;
    },
    clear() { items = []; first = 0; },
  };
}

// ------------------------------------------------------------------ where to open it

/** Tools by the app their records live in, first match wins. The same table as observability/live/events.ts, with Files and Calendar. */
const APP_OF = [
  [/email|mailbox|draft/, "letterbox"],
  [/social|post/, "mutter"],
  [/campaign|marketing|newsletter/, "megaphone"],
  [/chat_message|channel|direct_messages|task|workload|org_chart/, "kettle"],
  [/stock|purchase_order|supplier/, "stockroom"],
  [/ledger|pay_later|monthly_summary/, "tally"],
  [/document|knowledge|policy/, "files"],
  [/world_event/, "daily-overthinker"],
  [/^(create|update|cancel|list|get)_events?$|calendar/, "calendar"],
  [/case|escalate|contact|conversation|verify_customer|review/, "front-desk"],
  [/prospect|outreach/, "letterbox"],
  [/order|refund|return|product|price|catalogue|goodwill/, "till"],
];

/** The app a tool's records live in, or null. */
export function appForTool(tool) {
  for (const [re, app] of APP_OF) if (re.test(String(tool || ""))) return app;
  return null;
}

/** Where a person's activity lands: their email in Letterbox, their order in Till... */
const ACTIVITY_APP = {
  send_email: "letterbox", send_message: "front-desk", post: "mutter", place_order: "till", change_order: "till",
  cancel_order: "till", return_order: "till", leave_review: "front-desk", supplier_event: "stockroom",
  staff_event: "kettle", world_event: "daily-overthinker", create_person: null,
};

const CHANNEL_APP = { email: "letterbox", web_chat: "front-desk", phone: "front-desk", text: "front-desk",
  mutter_dm: "mutter", squint_dm: "squint", mutter_mention: "mutter", internal: "kettle", supplier_mail: "letterbox",
  outreach: "letterbox", publishing: "mutter" };

const ID = /\b(?:ORD|CASE|PO|CT|CONV|EM|TH|TASK|REV|CUST|C)-[\w-]+/;

/** The first record id in some value (an input, a result, a list of change lines). */
function findId(v) {
  const m = ID.exec(typeof v === "string" ? v : JSON.stringify(v ?? ""));
  return m ? m[0] : null;
}

/**
 * One entry of a sandbox's own record (GET /sandboxes/:id/trace) as a live event, or null for what is not worth
 * showing (screen reads, this desktop's own clicks, time moves).
 * WHY these rules: the browser calls as the sandbox's owner over http; a product calls through Overthink's gateway
 * ("overthink"), over MCP, or with a key made for one role (a token that is not the owner's).
 * @param {object} t a trace entry
 * @param {{owner?: ?string}=} o the owner token's id
 */
export function fromTrace(t, { owner = "tok_1" } = {}) {
  if (!t || typeof t !== "object") return null;
  const base = { schema: "overthink.live/1", seq: t.seq, at: t.at, run: "sandbox", arm: "with", variant: null, seed: null,
    sim_time: t.sim_time || t.now || null, audience: null, channel: t.channel || null, link: null, data: {} };
  if (t.kind === "reply") {
    return { ...base, type: "product.replied", session: String(t.actor?.session || t.contact_id || ""), app: CHANNEL_APP[t.channel] || "front-desk",
      record: t.contact_id || null, summary: "Replied", data: { text: t.reply || "", to: null } };
  }
  if (t.kind === "activity") {
    const record = findId(t.result) || findId(t.input);
    return { ...base, type: "activity", session: record, app: ACTIVITY_APP[t.action] ?? null, record,
      audience: "customers", summary: spaced(t.action), data: { action: t.action, ok: t.ok } };
  }
  if (t.kind !== "tool" || t.actor?.session === "screen") return null;
  const ai = t.via !== "http" || (t.actor?.token && owner && t.actor.token !== owner);
  if (!ai) return null;
  const read = /^(list|get|search|check|read|compare)(_|$)/.test(t.tool);
  return { ...base, type: read ? "product.read" : "product.acted", session: t.actor?.session || null,
    app: appForTool(t.tool), record: findId(t.changes) || findId(t.input),
    summary: `${read ? "Read" : t.ok ? "Did" : "Failed"}: ${t.tool}`,
    data: { tool: t.tool, arguments: t.input, ok: t.ok !== false, code: t.error?.code || null, refused: t.error?.code === "forbidden" } };
}

/**
 * The address that opens an event's record in its app, embedded. A live event's own `link` wins (it is the view
 * server's path, and the same apps live at the same paths everywhere); else the record's id says which screen.
 * @param {object} e
 * @return {?string} a path under /apps/, or null when there is no app
 */
export function recordHref(e) {
  if (e.link && /^\/apps\//.test(e.link)) return e.link;
  const app = e.app;
  if (!app) return null;
  // The record's own page, from the one table every app shares (lib/your-ai.js), when it lives in this app.
  const own = e.record ? hrefFor(e.record) : null;
  if (own && own.startsWith(`/apps/${app}/`)) return own;
  return `/apps/${app}/`;
}

/** Adds ?embed=1 to an app address (before any #fragment), so the app's own bar stays hidden in a window. */
export function embedded(href) {
  const [path, hash = ""] = String(href).split("#");
  const sep = path.includes("?") ? "&" : "?";
  const out = /[?&]embed=1(&|$)/.test(path) ? path : `${path}${sep}embed=1`;
  return hash ? `${out}#${hash}` : out;
}
