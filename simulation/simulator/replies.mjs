// Judges a reply a person or an AI sent to a customer, from the records alone (as simulation/simulator/judge.mjs judges a tool's
// calls): how fast it came after the customer's own message, and whether it addressed them (long enough, and about
// their order or their problem). No AI: rules only. Rates: business/data/audience.json "replies".
const COMPLAINT = /\b(late|never|broken|damaged|refund|disappoint|complain|missing|wrong|still waiting|not arrived|rubbish|awful)\w*/i;
const HELPFUL = /\b(sorry|apolog|refund|replace|replacement|track|tracking|deliver|delivery|order|send|sent|return|fix|arrive|today|tomorrow|help)\w*/i;
const ORDER_NO = /\bORD-\d+\b/;
const SCAN_BACK = 3000; // records to look back through for the customer's own message

/**
 * @param {string} kind "social" (a reply or private message), "email" or "review" (rec is then the review, with its reply).
 * @param {object} rec The company's record (key "tool|...").
 * @param {object} state World state.
 * @param {object} A audienceRates(business/data/audience.json).
 * @return {?{customer_id: string, points: number, reputation: number, csat: number, memo: object, why: string}}
 *     Null when the record is not a reply to a customer (for example marketing mail, or a post).
 */
export function judgeOutsideReply(kind, rec, state, A) {
  const found = kind === "email" ? emailContext(rec, state, A) : kind === "review" ? reviewContext(rec) : socialContext(rec, state);
  if (!found) return null;
  const R = A.replies;
  const text = kind === "email" ? `${rec.subject || ""} ${rec.body || ""}` : kind === "review" ? rec.reply.text || "" : rec.text || "";
  const at = kind === "review" ? rec.reply.at : rec.at;
  const hours = Math.max(0, (Date.parse(at) - Date.parse(found.asked.at)) / 3600000);
  const complaint = COMPLAINT.test(found.askedText) || (kind === "review" && rec.rating <= 2);
  const helpful = text.trim().length >= R.min_helpful_chars && (ORDER_NO.test(text) || HELPFUL.test(text) || !complaint);
  const fast = hours <= R.fast_hours;
  const points = !helpful ? R.points_unhelpful : fast ? R.points_fast : hours <= R.slow_hours ? R.points_slow : R.points_slow / 2;
  // WHY reviews get two days: people read a review's answer whenever they read the review, not as it happens.
  const inTime = fast || (kind === "review" && hours <= R.slow_hours);
  const reputation = found.isPublic && complaint && inTime && helpful ? R.public_complaint_reputation : 0;
  const csat = !helpful ? R.email_csat.unhelpful : fast ? R.email_csat.fast_helpful : R.email_csat.slow_helpful;
  const memo = { order: null, bad: !helpful || hours > R.slow_hours, text: !helpful ? "your answer did not help" : fast ? "you answered me quickly" : `you took ${Math.round(hours)} hours to answer` };
  return { customer_id: found.customer_id, points, reputation, csat, memo, why: `${helpful ? "helpful" : "not helpful"}, ${Math.round(hours * 10) / 10} hours after the customer${complaint ? " complained" : " wrote"}` };
}

/**
 * A review is the customer's public word; the shop's reply sits under it. WHY counted as public: everyone who reads
 * the review reads the answer, so a helpful answer to a poor review is the same as a public answer to a complaint.
 * Reviews are dated, not timed, so the customer "asked" at noon that day.
 */
function reviewContext(r) {
  if (!r?.reply || !r.customer_id) return null;
  return { customer_id: r.customer_id, asked: { at: `${r.date}T12:00:00Z` }, askedText: r.text || "", isPublic: true };
}

function socialContext(rec, state) {
  const posts = state.social_posts || [];
  if (rec.kind === "reply") {
    const parent = findBack(posts, (p) => p.id === rec.parent);
    if (!parent || parent.author?.kind !== "customer") return null;
    const customer_id = parent.author.customer_id || parent.links?.customer_id;
    return customer_id ? { customer_id, asked: parent, askedText: parent.text || "", isPublic: true } : null;
  }
  if (rec.kind === "dm") {
    const customer_id = rec.links?.customer_id || (/^dm-[a-z]+-(C-\d+)-/.exec(rec.thread || "") || [])[1];
    const asked = findBack(posts, (p) => p.kind === "dm" && p.thread === rec.thread && p.author?.kind === "customer" && p.at <= rec.at);
    return customer_id && asked ? { customer_id, asked, askedText: asked.text || "", isPublic: false } : null;
  }
  return null;
}

function emailContext(rec, state, A) {
  const customers = (state.customers || []);
  const addresses = [...(rec.to || []), ...(rec.cc || [])].map((x) => String(x.address).toLowerCase());
  const who = customers.filter((c) => addresses.includes(String(c.email).toLowerCase()));
  // Several customers at once is marketing mail: the audience plug-in scores that.
  if (!who.length || who.length >= A.email.min_customer_recipients) return null;
  const c = who[0], addr = String(c.email).toLowerCase();
  const asked = findBack(state.emails || [], (e) => e.folder === "inbox" && String(e.from?.address).toLowerCase() === addr && e.at <= rec.at);
  return asked ? { customer_id: c.id, asked, askedText: `${asked.subject || ""} ${asked.body || ""}`, isPublic: false } : null;
}

function findBack(list, test) {
  for (let i = list.length - 1, n = 0; i >= 0 && n < SCAN_BACK; i--, n++) if (test(list[i])) return list[i];
  return null;
}
