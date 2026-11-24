// "Your AI": one treatment for everything the AI touched, the same in every app and on the desktop.
//
//   the badge      a small pill, a spark dot and the words "Your AI" (aiBadge())
//   the highlight  a record the AI created or changed: a spark edge, a faint wash and a spark dot in its corner;
//                  pointing at it puts the badge there (a real button, so it never hides the app's own text for long)
//   the cursor     the AI's pointer, which glides to a record and taps it when the desktop shows what it did
//   the story      press the badge: what the AI did, the conversation that started it, everything else it changed
//                  for that conversation, and what happened afterwards, each opening in its own app
//
// Every app gets it from startApp() (lib/ui.js); Rummage starts it itself. An app needs nothing else: records are
// found by the record ids the apps already put in data-* attributes (the same list view.js used), plus an explicit
// data-ot-ai-id for anything else. Where the facts come from:
//   - a finished run (`overthink view`): /view/marks, the records the product changed (observability/view/marks.ts);
//   - a live sandbox (`overthink up`): the sandbox's own record of calls (GET /sandboxes/:id/trace), read once and
//     then followed through world.onChange. The AI is whatever called the business without being this browser: the
//     product through Overthink's gateway, over MCP, or with a key made for one role.
// The pure parts (readTrace, createStory, hrefFor) have no DOM and are tested in your-ai.test.mjs.

import { plainRef } from "./plain.js";

export const AI_LABEL = "Your AI";
const REVEAL_KEY = "ot-reveal";

/** The data-* attributes apps put record ids in. A key like "ct:CT-00012" holds the id after the colon. */
export const ID_ATTRS = ["data-ot-ai-id", "data-id", "data-email", "data-thread", "data-order", "data-key", "data-po",
  "data-msg", "data-open", "data-post", "data-reply", "data-ref", "data-doc", "data-row", "data-settle", "data-case",
  "data-contact", "data-open-rec", "data-story", "data-review", "data-task"];

const ID = /\b(?:ORD|CASE|RET|REP|EM|CH|SP|CT|CONV|PO|TASK|REV|FIX|BKG|REG|SHP|TH|LED|EV|DOC|CMP|C)-[\w]+\b/g;

/** Every record id in a value (a change line, an input, a list of them). */
export function idsIn(v) {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return [...new Set(s.match(ID) || [])];
}

// ------------------------------------------------------------------ words

/** What a call did, the way a person would say it. */
const DID = {
  send_email: "Sent an email", reply_email: "Answered an email", open_case: "Opened a case", add_case_note: "Added a note to a case",
  close_case: "Closed a case", update_case: "Updated a case", issue_refund: "Gave a refund", refund_order: "Gave a refund",
  create_return: "Started a return", approve_return: "Approved a return", cancel_order: "Cancelled an order",
  send_replacement: "Sent a replacement", hand_over: "Passed it to a person", escalate_case: "Passed it to a person",
  verify_customer: "Checked who the customer was", update_order: "Changed an order", apply_discount: "Gave a discount",
  post_social: "Posted", reply_social: "Replied on social media", send_social_message: "Sent a private message",
  send_newsletter: "Sent the newsletter", set_price: "Changed a price", create_purchase_order: "Ordered stock",
  post_message: "Wrote in team chat", create_task: "Made a task", reply_review: "Answered a review", goodwill_credit: "Gave goodwill credit",
  send_chat_message: "Wrote in team chat", create_social_post: "Posted", reply_social_post: "Replied to a post", reply_to_review: "Answered a review",
  add_goodwill_credit: "Gave goodwill credit", resolve_case: "Closed a case", draft_email: "Drafted an email", forward_email: "Forwarded an email",
  change_price: "Changed a price", create_campaign: "Started a campaign", approve_purchase_order: "Approved a stock order",
  update_task: "Updated a task", complete_task: "Finished a task", save_document: "Saved a document", create_event: "Put something in the calendar",
  update_contact_card: "Updated a contact", like_social_post: "Liked a post", repost_social_post: "Shared a post",
};

/** A tool's name as words, for one not in the list. */
export function didWords(tool, { read = false } = {}) {
  if (DID[tool]) return DID[tool];
  const t = String(tool || "").replace(/_/g, " ");
  if (read) return `Looked at ${t.replace(/^(get|list|search|check|read) /, "")}`;
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Did something";
}

/** A record, said in words: "Order 10442", "the conversation", "a ledger line". */
export function recordWords(id) {
  const said = plainRef(id);
  if (said) return said;
  const p = String(id).split("-")[0];
  return { CT: "The conversation", CONV: "The conversation", EM: "An email", TH: "An email thread", LED: "A ledger line",
    SP: "A post", CH: "A team message", BKG: "A booking", REG: "A registration", SHP: "A delivery", EV: "A calendar event",
    DOC: "A document", CMP: "A campaign" }[p] || "A record";
}

/** The app a record lives in. */
export function appOfId(id) {
  const p = String(id).split("-")[0];
  return { ORD: "till", SHP: "till", CASE: "front-desk", RET: "front-desk", CT: "front-desk", CONV: "front-desk", REV: "front-desk",
    FIX: "front-desk", BKG: "front-desk", REG: "front-desk", C: "front-desk", EM: "letterbox", TH: "letterbox", CH: "kettle",
    TASK: "kettle", SP: "mutter", PO: "stockroom", LED: "tally", EV: "calendar", DOC: "files", CMP: "megaphone" }[p] || null;
}

/**
 * The page that shows a record, from any app.
 * @param {string} id
 * @return {?string} a path under /apps/
 */
export function hrefFor(id) {
  const e = encodeURIComponent(id);
  const p = String(id).split("-")[0];
  switch (p) {
    case "ORD": return `/apps/till/#orders/${e}`;
    case "CASE": return `/apps/front-desk/?case=${e}`;
    case "CT": case "CONV": return `/apps/front-desk/?contact=${e}`;
    case "C": return `/apps/front-desk/?customer=${e}`;
    case "REV": return `/apps/front-desk/?review=${e}`;
    case "EM": return `/apps/letterbox/?email=${e}`;
    case "TH": return `/apps/letterbox/?thread=${e}`;
    case "PO": return `/apps/stockroom/#orders/${e}`;
    case "TASK": return `/apps/kettle/?task=${e}`;
    case "LED": return "/apps/tally/#ledger";
    case "EV": return `/apps/calendar/?event=${e}`;
    case "DOC": return `/apps/files/?doc=${e}`;
    case "CMP": return "/apps/megaphone/#campaigns";
    default: return appOfId(id) ? `/apps/${appOfId(id)}/` : null;
  }
}

// ------------------------------------------------------------------ the facts

const READ = /^(list|get|search|check|read|compare)(_|$)/;

/**
 * The sandbox's record of calls as the AI's actions and what happened around them.
 * @param {Array<object>} entries trace entries (GET /sandboxes/:id/trace)
 * @param {{owner?: ?string}=} o the owner token's id: calls with it over http are this browser, not the AI
 * @return {Array<{seq: number, at: ?string, ai: boolean, read: boolean, what: string, tool: ?string, session: ?string, ids: Array<string>, text?: string}>}
 */
export function readTrace(entries, { owner = "tok_1" } = {}) {
  const out = [];
  for (const t of entries || []) {
    if (!t || t.actor?.session === "screen") continue;
    const at = t.sim_time || t.now || t.at || null;
    if (t.kind === "reply") {
      const session = String(t.actor?.session || t.contact_id || "") || null;
      out.push({ seq: t.seq, at, ai: true, read: false, what: "Replied", tool: null, session, ids: idsIn([t.contact_id, session]), text: t.reply || "" });
    } else if (t.kind === "tool") {
      const ai = t.via !== "http" || Boolean(t.actor?.token && owner && t.actor.token !== owner);
      const read = READ.test(t.tool || "");
      if (!ai && read) continue;  // this browser looking: not part of anyone's story
      if (t.ok === false && !ai) continue;
      const ids = read ? idsIn(t.input) : idsIn([t.changes, t.input]);
      const what = t.ok === false ? `Tried to ${String(t.tool || "do something").replace(/_/g, " ")}, and was stopped`
        : read && ids[0] && plainRef(ids[0]) ? `Looked at ${plainRef(ids[0], { lower: true })}` : didWords(t.tool, { read });
      out.push({ seq: t.seq, at, ai, read, what,
        tool: t.tool, session: t.actor?.session && t.actor.session !== "default" ? t.actor.session : null, ids, failed: t.ok === false });
    } else if (t.kind === "activity" && t.ok !== false) {
      out.push({ seq: t.seq, at, ai: false, read: false, what: activityWords(t.action), tool: t.action, session: null, ids: idsIn([t.result, t.input]) });
    }
  }
  return out;
}

function activityWords(action) {
  return { send_email: "Someone emailed", send_message: "Someone wrote in", post: "Someone posted", place_order: "Someone ordered",
    change_order: "An order was changed", cancel_order: "An order was cancelled", return_order: "Something was sent back",
    leave_review: "A review was written", supplier_event: "A supplier was in touch", staff_event: "Something happened with the team",
    world_event: "Something happened in the world" }[action] || "Something happened";
}

/** /view/marks (a finished run) as the same actions. Marks say what the product did; they carry no outside events. */
export function readMarks(marks) {
  const bySeq = new Map();
  for (const m of marks || []) {
    const key = m.seq ?? `${m.session}:${m.kind}:${m.id}`;
    const a = bySeq.get(key) || { seq: typeof m.seq === "number" ? m.seq : 0, at: null, ai: true, read: false, what: m.what || "Changed this",
      tool: m.tool || null, session: m.session || null, ids: [] };
    if (!a.ids.includes(m.id)) a.ids.push(m.id);
    bySeq.set(key, a);
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * Who did what to which record, connected: by record, and by the conversation (session) the AI was working on.
 * A record is marked when the AI changed it (reads never mark), or when it is the conversation the AI worked in.
 */
export function createStory() {
  const acts = [];
  const byId = new Map();     // id -> indexes into acts
  const marked = new Map();   // id -> how many AI actions changed it
  return {
    add(list) {
      for (const a of list) {
        const i = acts.push(a) - 1;
        const ids = [...a.ids, ...(a.session && /^(CT|CONV)-/.test(a.session) ? [a.session] : [])];
        for (const id of new Set(ids)) {
          if (!byId.has(id)) byId.set(id, []);
          byId.get(id).push(i);
          if (a.ai && !a.read && !a.failed) marked.set(id, (marked.get(id) || 0) + 1);
        }
      }
    },
    isMarked: (id) => marked.has(id),
    marked: () => [...marked.keys()],
    get size() { return acts.length; },
    /**
     * Everything connected to one record.
     * @return {?{id: string, did: Array<object>, cause: ?string, thread: Array<object>, related: Array<string>, after: Array<object>}}
     *   did: the AI's actions on it; cause: the conversation that started them; thread: all the AI did in that
     *   conversation, in order; related: the other records it changed there; after: what happened to them since.
     */
    of(id) {
      const mine = (byId.get(id) || []).map((i) => acts[i]);
      const did = mine.filter((a) => a.ai);
      if (!did.length) return null;
      const sessions = new Set(did.map((a) => a.session).filter(Boolean));
      const thread = acts.filter((a) => a.ai && a.session && sessions.has(a.session));
      const steps = thread.length ? thread : did;
      const cause = [...sessions].find((s) => /^(CT|CONV|EM|TH)-/.test(s)) || null;
      const related = new Set();
      for (const a of steps) if (!a.read && !a.failed) for (const r of a.ids) if (r !== id && r !== cause) related.add(r);
      const first = Math.min(...steps.map((a) => a.seq));
      const near = new Set([id, ...related]);
      const after = acts.filter((a) => !a.ai && a.seq > first && a.ids.some((r) => near.has(r))).slice(0, 6);
      return { id, did, cause, thread: steps, related: [...related], after };
    },
  };
}

// ------------------------------------------------------------------ the look

const STYLE = `
:root{--yai-spark:#FF653C;--yai-ink:#BF3F19;--yai-wash:#FFE8DF;--yai-card:#fff;--yai-text:#0B1730;--yai-text-2:#55607A;--yai-rule:#E1E7F0;--yai-hover:rgb(11 23 48/.05)}
:root[data-theme="dark"]{--yai-ink:#FFB59C;--yai-wash:rgb(255 101 60/.16);--yai-card:#0E1830;--yai-text:#EAF0FA;--yai-text-2:#9AA9C6;--yai-rule:rgb(234 240 250/.1);--yai-hover:rgb(234 240 250/.06)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--yai-ink:#FFB59C;--yai-wash:rgb(255 101 60/.16);--yai-card:#0E1830;--yai-text:#EAF0FA;--yai-text-2:#9AA9C6;--yai-rule:rgb(234 240 250/.1);--yai-hover:rgb(234 240 250/.06)}}
.yai-badge{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px 0 7px;border-radius:99px;background:var(--yai-wash);color:var(--yai-ink);
  font:500 11.5px/1 Geist,"Hanken Grotesk",system-ui,sans-serif;letter-spacing:0;white-space:nowrap;vertical-align:middle;flex:none}
.yai-badge::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--yai-spark)}
button.yai-badge{border:0;cursor:pointer}button.yai-badge:hover{filter:brightness(.97)}
[data-ot-ai]{box-shadow:inset 2px 0 0 var(--yai-spark);background-image:linear-gradient(90deg,var(--yai-wash),transparent 46%)}
[data-ot-ai]::after{content:"";position:absolute;top:5px;right:5px;z-index:2;pointer-events:none;width:7px;height:7px;border-radius:50%;
  background:var(--yai-spark);box-shadow:0 0 0 2px var(--yai-card)}
[data-ot-ai].yai-hover::after{visibility:hidden}
[data-ot-ai][data-ot-ai-small]{box-shadow:inset 0 -2px 0 var(--yai-spark);background-image:none;background-color:var(--yai-wash);border-radius:4px}
[data-ot-ai][data-ot-ai-small]::after{display:none}
tr[data-ot-ai]::after{display:none}
[data-ot-ai-new]{animation:yai-new 1.6s ease-out}
@keyframes yai-new{0%{box-shadow:inset 2px 0 0 var(--yai-spark),0 0 0 3px rgb(255 101 60/.45)}100%{box-shadow:inset 2px 0 0 var(--yai-spark),0 0 0 0 rgb(255 101 60/0)}}
.yai-float{position:fixed;z-index:2147483600;display:none;background:color-mix(in srgb,var(--yai-spark) 18%,var(--yai-card));box-shadow:0 0 0 2px var(--yai-card),0 4px 12px -4px rgb(11 23 48/.35)}
.yai-float.on{display:inline-flex}
.yai-cursor{position:fixed;left:0;top:0;z-index:2147483601;pointer-events:none;display:flex;align-items:flex-start;gap:2px;opacity:0;
  transform:translate(var(--cx,50vw),var(--cy,50vh));transition:transform .7s cubic-bezier(.2,.75,.2,1),opacity .25s}
.yai-cursor.on{opacity:1}
.yai-cursor svg{width:22px;height:22px;fill:var(--yai-text);stroke:var(--yai-card);stroke-width:1.6;stroke-linejoin:round;filter:drop-shadow(0 2px 3px rgb(11 23 48/.3))}
.yai-cursor span{margin-top:14px;padding:3px 8px;border-radius:99px;background:var(--yai-spark);color:#fff;font:500 12px/1.2 Geist,system-ui,sans-serif;white-space:nowrap;box-shadow:0 4px 12px -4px rgb(255 101 60/.6)}
.yai-cursor.tap::after{content:"";position:absolute;left:-9px;top:-9px;width:22px;height:22px;border-radius:50%;border:2px solid var(--yai-spark);animation:yai-tap .6s ease-out forwards}
@keyframes yai-tap{from{transform:scale(.4);opacity:1}to{transform:scale(1.8);opacity:0}}
.yai-pop{position:fixed;z-index:2147483602;width:min(380px,calc(100vw - 24px));max-height:min(70vh,560px);overflow:auto;padding:14px 14px 10px;border-radius:14px;
  background:var(--yai-card);color:var(--yai-text);box-shadow:0 0 0 .5px rgb(11 23 48/.14),0 24px 60px -18px rgb(11 23 48/.4);
  font:400 13.5px/1.4 Geist,"Hanken Grotesk",system-ui,sans-serif;animation:yai-in .18s cubic-bezier(.2,.75,.2,1);text-align:left}
@keyframes yai-in{from{opacity:0;transform:translateY(-4px)}}
.yai-pop header{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.yai-pop header b{font:600 16px/1.2 "Bricolage Grotesque",Geist,system-ui,sans-serif;margin-right:auto}
.yai-pop .x{width:28px;height:28px;border:0;border-radius:99px;background:none;color:var(--yai-text-2);cursor:pointer;font-size:18px;line-height:1}
.yai-pop .x:hover{background:var(--yai-hover)}
.yai-pop h4{margin:12px 0 4px;font:400 12px "Geist Mono",ui-monospace,monospace;color:var(--yai-text-2)}
.yai-pop ol,.yai-pop ul{list-style:none;margin:0;padding:0}
.yai-step{display:grid;grid-template-columns:44px 1fr;gap:8px;padding:4px 0;font-size:13.5px}
.yai-step time{font:12px "Geist Mono",ui-monospace,monospace;color:var(--yai-text-2);padding-top:1px}
.yai-step.read{color:var(--yai-text-2)}
.yai-step.here b{font-weight:600}
.yai-step q{display:block;color:var(--yai-text-2);font-size:13px;margin-top:2px;quotes:"“" "”";display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.yai-link{display:flex;align-items:center;gap:10px;width:100%;min-height:40px;padding:6px 8px;margin:0 -8px;border:0;border-radius:9px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;box-sizing:content-box}
.yai-link:hover,.yai-link:focus-visible{background:var(--yai-hover);outline:none}
.yai-link .ot-icon{flex:none;display:inline-grid;place-items:center;width:var(--size,26px);height:var(--size,26px)}
.yai-link span{flex:1;min-width:0}.yai-link small{display:block;color:var(--yai-text-2);font-size:12.5px}
.yai-link::after{content:"›";color:var(--yai-text-2);font-size:18px}
@media (max-width:640px){.yai-pop{left:8px!important;right:8px;top:auto!important;bottom:8px;width:auto;max-height:72vh}}
@media (prefers-reduced-motion:reduce){.yai-cursor{transition:none}[data-ot-ai-new],.yai-pop{animation:none}}`;

/** The AI's pointer, as drawn everywhere. */
export const CURSOR_HTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5 19 11l-6.2 1.6L9.6 19Z"/></svg><span>${AI_LABEL}</span>`;

/** Puts the treatment's styles on a page once. */
export function ensureStyle(doc = document) {
  if (doc.getElementById("yai-style")) return;
  const s = doc.createElement("style");
  s.id = "yai-style";
  s.textContent = STYLE;
  doc.head.append(s);
}

/** The badge, as HTML, for an app's own markup. With an id it is a button that opens the story. */
export function aiBadge(id = null) {
  return id ? `<button type="button" class="yai-badge" data-yai-story="${String(id).replace(/[&<>"']/g, "")}">${AI_LABEL}</button>`
    : `<span class="yai-badge">${AI_LABEL}</span>`;
}

// ------------------------------------------------------------------ opening things where they live

/** Whether this page is a window on the sandbox desktop. */
function onDesktop() {
  try { return window.parent !== window && Boolean(window.parent.document.querySelector('meta[name="ot-desktop"]')); } catch { return false; }
}

/**
 * Opens a record in its app: on the desktop, in that app's own window; alone, in this tab. The record is revealed
 * (scrolled to, highlighted, tapped by the cursor) when the app has drawn it.
 * @param {string} href a path under /apps/
 * @param {?string=} reveal the record id to reveal
 */
export function openRecord(href, reveal = null) {
  if (!href) return;
  if (onDesktop()) {
    window.parent.postMessage({ type: "ot:open", href, reveal }, location.origin);
    return;
  }
  try { if (reveal) sessionStorage.setItem(REVEAL_KEY, reveal); } catch { /* storage blocked: it just opens */ }
  const here = location.pathname.split("/")[2];
  const there = href.split("/")[2];
  const url = new URL(href, location.origin);
  if (new URLSearchParams(location.search).get("embed") === "1") url.searchParams.set("embed", "1");
  if (here === there && url.pathname === location.pathname && url.search === location.search) {
    if (url.hash !== location.hash) location.hash = url.hash;
    if (reveal) api?.reveal(reveal);
    return;
  }
  location.assign(url.pathname + url.search + url.hash);
}

// ------------------------------------------------------------------ on a page

let api = null;

/**
 * Starts the treatment on this page: marks what the AI touched, keeps marking as the app redraws and as the AI acts,
 * and opens the story from any badge.
 * @param {{world?: ?object, apps?: ?Array<object>, icon?: ?function(object, object): string}} o
 *   world: the page's client (lib/client.js); apps and icon draw the app icons in the story
 * @return {{reveal: function(string): void, story: object}}
 */
export function startYourAi({ world = null, apps = [], icon = null } = {}) {
  if (api) return api;
  ensureStyle();
  const story = createStory();
  const appById = new Map((apps || []).map((a) => [a.id, a]));
  let queued = false;

  function paint() {
    queued = false;
    if (!story.size) return;
    for (const attr of ID_ATTRS) {
      for (const el of document.querySelectorAll(`[${attr}]`)) {
        if (el.closest(".yai-pop")) continue;
        const id = el.getAttribute(attr).replace(/^[a-z]+:/, "");
        if (!story.isMarked(id)) continue;
        // A small control (an "Open" button, a reference chip) stands for the row it sits in: mark the row.
        let el2 = el;
        const r0 = el.getBoundingClientRect();
        if (r0.width < 160 || r0.height < 26) {
          const row = el.closest('[role="row"], li, article, tr');
          if (row && row.getBoundingClientRect().width >= 160) el2 = row;
        }
        if (el2.getAttribute("data-ot-ai") === id) continue;
        el2.setAttribute("data-ot-ai", id);
        el2.title ||= `${AI_LABEL}: press the badge to see what it did`;
        // The corner dot needs a positioned box; one already positioned (a hit area laid over a card) keeps its own.
        if (getComputedStyle(el2).position === "static") el2.style.position = "relative";
        const r = el2.getBoundingClientRect();
        const d = getComputedStyle(el2).display;
        // Still small or inline: the wash and an underline say it instead of a corner dot.
        if ((d.startsWith("inline") && !/block|flex|grid/.test(d)) || r.width < 160 || r.height < 26) el2.setAttribute("data-ot-ai-small", "");
      }
    }
  }
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });

  // The real button that sits over the drawn badge of whichever record the pointer is on.
  const float = document.createElement("button");
  float.type = "button";
  float.className = "yai-badge yai-float";
  float.textContent = AI_LABEL;
  float.setAttribute("aria-label", "What your AI did here");
  document.body.append(float);
  let hovered = null;
  document.addEventListener("pointerover", (e) => {
    const el = e.target.closest?.("[data-ot-ai]");
    if (e.target === float || el === hovered) return;
    hovered?.classList.remove("yai-hover");
    hovered = el;
    if (!el || el.tagName === "TR" || el.hasAttribute("data-ot-ai-small")) { float.classList.remove("on"); if (el) { float.dataset.yaiStory = el.getAttribute("data-ot-ai"); } return; }
    const r = el.getBoundingClientRect();
    float.style.left = `${r.right - 6 - 68}px`;
    float.style.top = `${r.top + 4}px`;
    float.classList.add("on");
    requestAnimationFrame(() => { float.style.left = `${r.right - 6 - float.offsetWidth}px`; });
    el.classList.add("yai-hover");
    float.dataset.yaiStory = el.getAttribute("data-ot-ai");
  }, { passive: true });
  document.addEventListener("scroll", () => { float.classList.remove("on"); hovered?.classList.remove("yai-hover"); hovered = null; }, { capture: true, passive: true });
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-yai-story]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    showStory(b.dataset.yaiStory, b);
  }, true);
  // Keyboard: Alt+A on a focused marked record opens its story.
  document.addEventListener("keydown", (e) => {
    if (!(e.altKey && e.code === "KeyA")) return;
    const el = document.activeElement?.closest?.("[data-ot-ai]");
    if (el) { e.preventDefault(); showStory(el.getAttribute("data-ot-ai"), el); }
  });

  let pop = null;
  function closeStory() { pop?.remove(); pop = null; }
  document.addEventListener("pointerdown", (e) => { if (pop && !pop.contains(e.target) && !e.target.closest?.("[data-yai-story]")) closeStory(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && pop) { e.stopPropagation(); closeStory(); } }, true);

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const hhmm = (iso) => (iso && /T\d\d:\d\d/.test(iso) ? iso.slice(11, 16) : "");
  const appIcon = (id) => (icon && appById.get(appOfId(id)) ? icon(appById.get(appOfId(id)), { size: 26 }) : "");
  const appName = (id) => appById.get(appOfId(id))?.name || "";
  const link = (id, sub, label = null) => {
    const href = hrefFor(id);
    return href ? `<li><button type="button" class="yai-link" data-href="${esc(href)}" data-rid="${esc(id)}">${appIcon(id)}<span>${esc(label || names.get(id) || recordWords(id))}<small>${esc(sub || appName(id))}</small></span></button></li>` : "";
  };
  // Conversations have no words of their own ("CT-00222"): the person and what it was about, read once.
  const names = new Map();
  let named = null;
  function nameConversations() {
    named ||= (world?.call ? world.call("list_contacts", {}, { screen: true }).then((r) => {
      for (const c of r?.data?.contacts || []) names.set(c.id, [c.customer_name, c.summary || c.about].filter(Boolean).join(" · "));
    }).catch(() => {}) : Promise.resolve());
    return named;
  }

  function showStory(id, anchor) {
    closeStory();
    const cause = story.of(id)?.cause;
    if (cause && !names.has(cause) && world?.call) { nameConversations().then(() => { if (pop && names.has(cause)) showStory(id, anchor); }); }
    const s = story.of(id);
    pop = document.createElement("section");
    pop.className = "yai-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "What your AI did");
    if (!s) {
      pop.innerHTML = `<header>${aiBadge()}<b>${esc(recordWords(id))}</b><button class="x" type="button" aria-label="Close">×</button></header><p>Your AI changed this.</p>`;
    } else {
      const steps = s.thread.slice(-14).map((a) => `<li class="yai-step${a.read ? " read" : ""}${a.ids.includes(id) ? " here" : ""}"><time>${esc(hhmm(a.at))}</time><span>${a.ids.includes(id) && !a.read ? `<b>${esc(a.what)}</b>` : esc(a.what)}${a.text ? `<q>${esc(a.text.slice(0, 240))}</q>` : ""}</span></li>`).join("");
      const cause = s.cause && s.cause !== id ? `<h4>Started by</h4><ul>${link(s.cause, `Conversation · ${appName(s.cause) || "Front Desk"}`)}</ul>` : "";
      const related = s.related.filter((r) => hrefFor(r)).slice(0, 8).map((r) => link(r)).join("");
      const after = s.after.map((a) => { const r = a.ids.find((x) => hrefFor(x)); return r ? link(r, `${a.what}${hhmm(a.at) ? ` · ${hhmm(a.at)}` : ""}`) : ""; }).join("");
      pop.innerHTML = `<header>${aiBadge()}<b>${esc(s.did.filter((a) => !a.read).at(-1)?.what || s.did.at(-1).what)}</b><button class="x" type="button" aria-label="Close">×</button></header>
        <p style="margin:0;color:var(--yai-text-2)">${esc(recordWords(id))}${appName(id) ? ` · ${esc(appName(id))}` : ""}</p>
        ${cause}
        <h4>${s.thread.length > s.did.length ? "Everything it did for this conversation" : "What it did"}</h4><ol>${steps}</ol>
        ${related ? `<h4>It also changed</h4><ul>${related}</ul>` : ""}
        ${after ? `<h4>What happened next</h4><ul>${after}</ul>` : ""}`;
    }
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
    pop.style.top = `${r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
    pop.querySelector(".x").addEventListener("click", closeStory);
    pop.addEventListener("click", (e) => {
      const b = e.target.closest(".yai-link");
      if (!b) return;
      closeStory();
      openRecord(b.dataset.href, b.dataset.rid);
    });
    pop.querySelector(".yai-link, .x")?.focus();
  }

  // ---------------------------------------------------------------- the cursor and revealing a record

  let cursor = null;
  /**
   * Scrolls to a record, highlights it and has the AI's cursor tap it. Waits up to five seconds for the app to draw it.
   * @param {string} id
   */
  function reveal(id) {
    const started = Date.now();
    const find = () => {
      for (const attr of ID_ATTRS) {
        for (const el of document.querySelectorAll(`[${attr}]`)) if (el.getAttribute(attr).replace(/^[a-z]+:/, "") === id) return el;
      }
      return null;
    };
    const go = () => {
      const el = find();
      if (!el) { if (Date.now() - started < 5000) setTimeout(go, 250); return; }
      el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      el.removeAttribute("data-ot-ai-new");
      void el.offsetWidth;
      el.setAttribute("data-ot-ai-new", "");
      setTimeout(() => el.removeAttribute("data-ot-ai-new"), 1700);
      if (!cursor) { cursor = document.createElement("div"); cursor.className = "yai-cursor"; cursor.innerHTML = CURSOR_HTML; document.body.append(cursor); }
      setTimeout(() => {
        const r = el.getBoundingClientRect();
        cursor.style.setProperty("--cx", `${innerWidth - 40}px`);
        cursor.style.setProperty("--cy", `${Math.max(10, r.top - 60)}px`);
        cursor.classList.add("on");
        requestAnimationFrame(() => {
          cursor.style.setProperty("--cx", `${Math.min(innerWidth - 90, r.left + Math.min(r.width * 0.6, 260))}px`);
          cursor.style.setProperty("--cy", `${r.top + Math.min(r.height / 2, 22)}px`);
        });
        setTimeout(() => { cursor.classList.add("tap"); setTimeout(() => cursor.classList.remove("tap"), 650); }, 720);
        setTimeout(() => cursor.classList.remove("on"), 2600);
      }, 380);
    };
    go();
  }

  try {
    const want = sessionStorage.getItem(REVEAL_KEY);
    if (want) { sessionStorage.removeItem(REVEAL_KEY); setTimeout(() => reveal(want), 300); }
  } catch { /* storage blocked */ }

  // ---------------------------------------------------------------- the facts

  async function load() {
    const view = await fetch("/view/marks", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (view?.ok) {
      if (view.data.arm !== "without") story.add(readMarks(view.data.marks));
      schedule();
      return;
    }
    if (!world?.activity) return;
    const owner = (await world.connectInfo?.().catch(() => null))?.ownerTokenId || "tok_1";
    const { entries } = await world.activity({ since: 0 }).catch(() => ({ entries: [] }));
    story.add(readTrace(entries, { owner }));
    schedule();
    world.onChange?.((c) => {
      if (c.reset) return location.reload();
      if (c.entries?.length) { story.add(readTrace(c.entries, { owner })); schedule(); }
    });
  }
  load().catch(() => { /* no facts: no marks */ });

  api = { reveal, story, show: showStory };
  window.otYourAi = api;
  return api;
}
