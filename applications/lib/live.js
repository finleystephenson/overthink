// Your AI's part in a run: what it did, and how people reacted. Read by Rummage (applications/home/) and the top bar's live line.
// It reads one shape, the run's live events (docs/live-events.md, `overthink.live/1`), from the server this page came
// from: /live/events (server-sent, while a run is going) or /live/events.jsonl (a finished run, all at once). The
// plain sandbox server has neither, and then there is simply no "Your AI".
// Each event becomes one plain line (phrase), which opens the record where it happened.

import { esc, timeParts } from "./ui.js";

/** Every event type the page shows or uses. EventSource only hands over the names it is listening for. */
const TYPES = ["run.started", "arm.started", "contact.raised", "product.read", "product.acted", "product.replied",
  "product.published", "person.reacted", "day.ended", "arm.finished", "run.finished", "run.stopped"];

/** Where things happened, in plain words. */
const CHANNELS = {
  web_chat: "on website chat", email: "by email", phone: "by phone", text: "by text", mutter_dm: "on Mutter",
  squint_dm: "on Squint", mutter_mention: "on Mutter", internal: "on Kettle", supplier_mail: "by email",
  outreach: "by email",
};

/** What a tool call did, said the way a person would. Anything not here falls back to the event's own summary. */
const DID = {
  send_email: "sent an email", reply_email: "answered an email", open_case: "opened a case",
  add_case_note: "added a note to a case", close_case: "closed a case", update_case: "updated a case",
  issue_refund: "gave a refund", refund_order: "gave a refund", create_return: "started a return",
  approve_return: "approved a return", cancel_order: "cancelled an order", send_replacement: "sent a replacement",
  hand_over: "passed it to a person", verify_customer: "checked who the customer was", escalate_case: "passed it to a person", update_order: "changed an order",
  apply_discount: "gave a discount", post_social: "posted", reply_social: "replied on social media",
  send_social_message: "sent a private message", send_newsletter: "sent the newsletter", set_price: "changed a price",
  create_purchase_order: "ordered stock", post_message: "wrote in Kettle", create_task: "made a task",
};

/** Plain words for the record numbers the engine writes. */
export function plainIds(text) {
  return String(text ?? "")
    .replace(/\bORD-(\d+)/g, "order $1").replace(/\bCASE-(\d+)/g, "case $1").replace(/\bPO-(\d+)/g, "order $1")
    .replace(/\bINV-(\d+)/g, "invoice $1").replace(/\b(?:EM|CT|CONV|TH|SP|CH|RET|TASK|REV)-[\w-]+/g, "")
    .replace(/\s*\([a-z_]+\)/g, "").replace(/\s{2,}/g, " ").trim();
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const name = (who) => (who && who.name) || "Someone";

/**
 * One event as a feed line, or null for events the feed does not show as a line (reads, day ends, arm boundaries).
 * @return {?{ai: boolean, text: string, quote: string, divider: boolean, refused: boolean}} text is HTML.
 */
export function phrase(e) {
  const d = e.data || {};
  const where = CHANNELS[e.channel] ? ` ${CHANNELS[e.channel]}` : "";
  switch (e.type) {
    case "run.started": return { divider: true, text: "The run started" };
    case "run.finished": return { divider: true, text: "The run finished" };
    case "run.stopped": return { divider: true, text: "The run stopped early" };
    case "contact.raised":
      return { text: `<b>${esc(name(d.who))}</b> wrote in${esc(where)}`, quote: d.text || "" };
    case "product.replied":
      return { ai: true, text: `replied to <b>${esc(name(d.to))}</b>${esc(where)}`, quote: d.text || "" };
    case "product.published": {
      const what = d.kind === "newsletter" ? "sent the newsletter" : d.kind === "product_page" ? "wrote a product page"
        : `posted${d.network ? ` on ${d.network === "mutter" ? "Mutter" : "Squint"}` : ""}`;
      return { ai: true, text: esc(what), quote: d.text || "" };
    }
    case "product.acted": {
      // A summary that only names the tool ("Did: verify_customer") says less than the tool's own words.
      const said = /[a-z]+_[a-z_]+/.test(e.summary || "") ? "" : lowerFirst(plainIds(e.summary));
      const did = DID[d.tool] || said || `used ${String(d.tool || "a tool").replace(/_/g, " ")}`;
      // WHY the tool's own words: a refused call did nothing, so there is no result to describe.
      if (d.refused) return { ai: true, refused: true, text: `tried to ${esc(String(d.tool || "do something").replace(/_/g, " "))} and was stopped` };
      if (d.ok === false) return null;
      return { ai: true, text: esc(did) };
    }
    case "person.reacted": return reacted(e, d);
    default: return null;
  }
}

/** How people reacted, in one line: a count when a panel decided, a name when one person did. */
function reacted(e, d) {
  if (d.kind === "panel") {
    const n = d.scaled || d.decisions || {};
    const top = ["buy", "like", "share", "reply", "visit", "complain", "unsubscribe"].find((k) => (n[k] || 0) > 0);
    const VERB = { buy: "bought after it", like: "liked it", share: "shared it", reply: "replied to it", visit: "visited the shop", complain: "complained", unsubscribe: "unsubscribed" };
    if (!top) return { text: esc(plainIds(e.summary) || "Nobody took any notice") };
    const count = Math.round(n[top]);
    return { text: `<b>${count.toLocaleString("en-GB")} ${count === 1 ? "person" : "people"}</b> ${VERB[top]}` };
  }
  if (d.kind === "customer") {
    // The event names the person only in its summary ("Name: gave up (failed)" or "Name wrote back").
    const who = (e.summary || "").split(":")[0].replace(/ wrote back$/, "").trim() || "The customer";
    const END = { satisfied: "was happy with that", gave_up: "gave up", out_of_turns: "gave up", passed: "was passed to a person", product_error: "got an error" };
    return { text: `<b>${esc(who)}</b> ${END[d.ending] || "wrote back"}`, quote: d.text || "" };
  }
  if (d.kind === "buyer") {
    const SAID = { ask: "asked a question", reply: "replied", meet: "agreed to meet", buy: "said yes", ignore: "didn't answer", unsubscribe: "asked to be left alone", complain: "complained" };
    return { text: `A buyer ${esc(SAID[d.decision] || "answered")}`, quote: d.text || "" };
  }
  if (d.kind === "supplier") return { text: `<b>${esc(d.supplier || "A supplier")}</b> ${esc(d.decision === "agreed" ? "agreed" : d.decision === "refused" ? "said no" : "answered")}`, quote: d.text || "" };
  return { text: esc(plainIds(e.summary)) };
}

/** "Sun 29 Nov, 16:38" on the business's own clock. */
export function when(iso) {
  if (!iso) return "";
  const p = timeParts(iso);
  return `${p.weekday.slice(0, 3)} ${p.day} ${p.monthShort}, ${p.time}`;
}

/**
 * Connects to the run's events on this server. Returns null when this server has none (the plain sandbox).
 * @param {{onEvent: function(object): void, onState: function(string): void}} p
 * @return {Promise<?{state: string, close: function(): void}>}
 */
export async function connectLive({ onEvent, onState }) {
  let status;
  try {
    const r = await fetch("/live/status", { cache: "no-store" });
    status = r.ok ? await r.json() : null;
  } catch {
    status = null;
  }
  if (!status?.schema) return null;
  if (status.state !== "running") {
    // A finished run: everything at once, no open connection to keep.
    const text = await fetch("/live/events.jsonl", { cache: "no-store" }).then((r) => r.text()).catch(() => "");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try { onEvent(JSON.parse(line), { replay: true }); } catch { /* a broken line is skipped, as the rules say */ }
    }
    onState(status.state);
    return { state: status.state, close() {} };
  }
  const source = new EventSource("/live/events");
  const take = (m) => {
    try {
      const e = JSON.parse(m.data);
      onEvent(e, { replay: false });
      if (e.type === "run.finished" || e.type === "run.stopped") { onState("finished"); source.close(); }
    } catch { /* ignore what cannot be read */ }
  };
  for (const t of TYPES) source.addEventListener(t, take);
  onState("running");
  return { state: "running", close: () => source.close() };
}

/** What a reading call is doing, said while it happens. */
const READING = {
  get_order: "Looking up an order", list_orders: "Looking through orders", get_customer: "Looking up a customer",
  verify_customer: "Checking who someone is", get_email_thread: "Reading an email", list_emails: "Going through the inbox",
  get_policy: "Checking a policy", search_documents: "Searching the documents", get_document: "Reading a document",
  search_catalogue: "Looking at the products", get_product: "Looking at a product", get_case: "Reading a case",
  list_social_posts: "Reading the posts", get_social_post: "Reading a post",
};

/**
 * The one line the home shows while a run is going: what the AI is doing right now, in the app where it happens.
 * Reads count here ("Reading an email in Letterbox…"), though the results leave them out.
 * @param {object} e an event
 * @param {?string} appName
 * @return {?string} plain text, or null when the event says nothing worth a line
 */
export function nowLine(e, appName) {
  if (e.arm === "without") return null;
  const where = appName ? ` in ${appName}` : "";
  if (e.type === "product.read") {
    const tool = e.data?.tool;
    return `${READING[tool] || `Looking at ${String(tool || "the records").replace(/^(get|list|search)_/, "").replace(/_/g, " ")}`}${where}…`;
  }
  const p = phrase(e);
  if (!p || p.divider) return p?.divider ? p.text : null;
  const text = p.text.replace(/<[^>]+>/g, "");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${where}`;
}
