// What customers made of the AI: their opinions in their own voice, whether they keep using it, and the knock-on
// effects on the business. All from the records and the simulator's totals, against the same business left alone.
// Words come from a written bank (infrastructure/server/voice-bank.json), picked by what happened and seeded by the contact, so the
// same run always gives the same words. No model is called.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rngFor } from "../../business/builder/world/rng.mjs";
import { DATA_DIR } from "./world-data.mjs";
import { mannerOf } from "./callers.mjs";

const BANK = JSON.parse(readFileSync(new URL("./voice-bank.json", import.meta.url), "utf8"));
const CHARACTERS = new Map(JSON.parse(readFileSync(join(DATA_DIR, "characters.json"), "utf8")).map((c) => [c.name, c]));
const FAST_MINUTES = 60;   // a first answer within the hour counts as fast for an opinion
const RATING = { fast_solved: 5, slow_solved: 4, handed_over: 3, not_solved: 2, wrong_action: 1, gave_up: 1, asked_person: 3 };
const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;

/** The customer's first words and where the conversation can be read, for a contact. */
function threadOf(state, c) {
  if (c.channel === "email") {
    const e = (state.emails || []).find((x) => x.links?.contact_id === c.id && x.folder === "inbox");
    return e ? { opening: e.body, link: { app: "letterbox", mailbox: "hello", thread_id: e.thread_id, email_id: e.id } } : null;
  }
  const conv = (state.conversations || []).find((x) => x.contact_id === c.id);
  return conv ? { opening: conv.messages[0]?.text || "", link: { app: "front-desk", conversation_id: conv.id } } : null;
}

/** What happened to a customer, in the bank's terms; null while the AI's answer has not been judged yet. */
function outcomeOf(c) {
  if (c.caller?.asked_person) return "asked_person";
  if (c.caller?.gave_up || c.outcome === "abandoned") return "gave_up";
  const fast = c.first_reply_minutes != null && c.first_reply_minutes <= FAST_MINUTES;
  return { resolved: fast ? "fast_solved" : "slow_solved", handed_over: "handed_over", partial: "not_solved", failed: "not_solved", wrong_action: "wrong_action" }[c.outside_verdict] || null;
}

/**
 * One opinion per contact the AI dealt with, in the customer's voice.
 * @param {object} state The live world's state.
 * @param {Array<object>} contacts The job's contacts (its channels, since it started).
 * @param {Set<string>} touched Contact ids the AI answered.
 * @return {Array<object>}
 */
export function customerVoices(state, contacts, touched) {
  const customers = new Map(state.customers.map((c) => [c.id, c]));
  const used = new Map(); // pool → indices already said in this result: no two customers share a line until it runs out
  const fresh = (r, pool, list) => {
    const seen = used.get(pool) || new Set();
    if (seen.size >= list.length) seen.clear();
    const open = list.map((_, i) => i).filter((i) => !seen.has(i));
    const i = open[Math.floor(r.next() * open.length)];
    seen.add(i);
    used.set(pool, seen);
    return list[i];
  };
  const out = [];
  for (const c of [...contacts].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))) {
    if (!touched.has(c.id) && !c.caller) continue;
    const outcome = outcomeOf(c);
    const thread = threadOf(state, c);
    if (!outcome || !thread) continue;
    const who = customers.get(c.customer_id);
    const ch = CHARACTERS.get(who?.name);
    const m = mannerOf(thread.opening.replace(/\s+$/, ""));
    const r = rngFor(1, "voice", c.id);
    const fast = c.first_reply_minutes != null && c.first_reply_minutes <= FAST_MINUTES;
    const speedPool = `${BANK.speed[c.channel] ? c.channel : "email"}.${fast ? "fast" : "slow"}`;
    const parts = {
      repeat: /second time|already written|written about this/i.test(thread.opening) ? fresh(r, "repeat", BANK.repeat) : null,
      speed: ["gave_up", "asked_person"].includes(outcome) ? null : fresh(r, speedPool, BANK.speed[c.channel]?.[fast ? "fast" : "slow"] || BANK.speed.email[fast ? "fast" : "slow"]),
      core: fresh(r, outcome, BANK.outcomes[outcome]).replace("{order}", c.order || "my order").replace("{handled}", r.pick(BANK.handled[c.caller?.handed_over ? "yes" : "no"])),
      tail: r.pick(BANK.tone[m.tone] || [""]),
    };
    let rating = RATING[outcome] + (outcome === "handed_over" && fast ? 1 : 0) - (parts.repeat ? 1 : 0) - (outcome === "asked_person" && !c.caller?.handed_over ? 2 : 0);
    rating = Math.max(1, Math.min(5, rating));
    const town = who?.addresses?.[0]?.town || ch?.town || null;
    const v = { contact_id: c.id, customer_id: c.customer_id, name: who?.name || "A customer", town, book: ch?.from || null, channel: c.channel, topic: c.topic,
      outcome, rating, said: "", quote: "", shape: null, at: c.at, conversation: thread.link };
    // WHY not enumerable: the parts are only for re-shaping the sample; the screen gets the finished words.
    Object.defineProperty(v, "parts", { value: parts, enumerable: false });
    render(v, SHAPES[Math.floor(r.next() * SHAPES.length)]);
    out.push(v);
  }
  return out;
}

/** Three ways to put an opinion together, so opinions side by side do not all open alike. */
const SHAPES = ["speed_first", "speed_last", "plain"];
function render(v, shape) {
  const { repeat, speed, core, tail } = v.parts;
  const body = !speed || shape === "plain" ? [core] : shape === "speed_first" ? [speed, core] : [core, speed];
  v.shape = shape;
  v.said = [repeat, ...body, tail].filter(Boolean).join(" ");
  v.quote = `${v.name}${v.town ? `, ${v.town}` : ""}: ${v.said}`;
}

/** Best, worst and a typical opinion (the middle one by rating), without repeats, each put together differently. */
export function sampleVoices(voices) {
  if (!voices.length) return [];
  const sorted = [...voices].sort((a, b) => b.rating - a.rating || a.at.localeCompare(b.at));
  const picks = [["best", sorted[0]], ["worst", sorted.at(-1)], ["typical", sorted[Math.floor(sorted.length / 2)]]];
  const seen = new Set();
  const chosen = picks.filter(([, v]) => !seen.has(v.contact_id) && seen.add(v.contact_id));
  // The same objects are in the full list, so re-shaping here keeps both views saying the same words.
  chosen.forEach(([, v], i) => render(v, SHAPES[i]));
  return chosen.map(([kind, v]) => ({ kind, ...v }));
}

/** Orders a set of customers placed after a time, and their value. */
function ordersAfter(state, ids, since) {
  let n = 0, value = 0;
  for (let i = state.orders.length - 1; i >= 0 && state.orders[i].placed_at > since; i--) {
    const o = state.orders[i];
    if (ids.has(o.customer_id) && o.status !== "cancelled") { n++; value += o.totals.total; }
  }
  return { orders: n, value: round2(value) };
}

/**
 * Do customers use it? Per channel: who met the AI, who came back to it, who asked for a person, who gave up, and
 * whether those who had a good or a bad time bought again (here and in the business left alone).
 */
export function adoption(state, shadowState, voices, since) {
  const byChannel = {};
  for (const v of voices) (byChannel[v.channel] ||= []).push(v);
  const out = {};
  for (const [channel, list] of Object.entries(byChannel)) {
    const per = new Map();
    for (const v of list) per.set(v.customer_id, (per.get(v.customer_id) || 0) + 1);
    const good = new Set(list.filter((v) => v.rating >= 4).map((v) => v.customer_id));
    const bad = new Set(list.filter((v) => v.rating <= 2).map((v) => v.customer_id));
    const again = (ids) => ({ customers: ids.size, with_ai: ordersAfter(state, ids, since), left_alone: shadowState ? ordersAfter(shadowState, ids, since) : null });
    out[channel] = {
      customers_met_it: per.size,
      came_back_to_it: [...per.values()].filter((n) => n > 1).length,
      asked_for_a_person: list.filter((v) => v.outcome === "asked_person").length,
      gave_up: list.filter((v) => v.outcome === "gave_up").length,
      average_rating: round1(list.reduce((n, v) => n + v.rating, 0) / list.length),
      bought_again_after_a_good_time: again(good),
      bought_again_after_a_bad_time: again(bad),
    };
  }
  return out;
}

// ---------------------------------------------------------------- knock-on effects

/** Whole numbers as they are; small fractions (estimated orders) to one decimal. */
const amount = (x) => { const a = Math.abs(x); return Number.isInteger(a) ? String(a) : a >= 10 ? String(Math.round(a)) : a.toFixed(1); };
/** Money: whole pounds above £20, pence below. */
const money = (x) => { const a = Math.abs(x); return a > 20 ? `£${Math.round(a).toLocaleString("en-GB")}` : `£${a.toFixed(2)}`; };
/** Minutes: whole minutes up to 90, then hours to one decimal. */
const minutes = (x) => { const a = Math.abs(x); return a > 90 ? `${round1(a / 60)} hours` : `${Math.round(a)} minutes`; };
const moreFewer = (x, noun) => `${amount(x)} ${x > 0 ? "more" : "fewer"} ${noun}`;

/**
 * Step kinds: how to say a difference, and which sign is better for the business. `good` is +1 when more is better
 * and -1 when less is better. A difference that rounds to nothing is "same", and a chain stops there.
 */
const STEPS = {
  wait_hours: { good: -1, say: (x) => `answers came ${minutes(x * 60)} ${x < 0 ? "sooner" : "later"}`, tiny: 0.05 },
  satisfied: { good: 1, say: (x) => `${moreFewer(x, "customers")} rated their contact 4 or 5`, tiny: 0.5 },
  good_reviews: { good: 1, say: (x) => `${moreFewer(x, "good reviews")} (4 or 5 stars)`, tiny: 0.5 },
  orders_after: { good: 1, say: (x, n) => `the ${n} customers your AI dealt with placed ${moreFewer(x, x === 1 || x === -1 ? "order" : "orders")} afterwards`, tiny: 0.05 },
  money_after: { good: 1, say: (x) => `${money(x)} ${x > 0 ? "more" : "less"} spent with the shop`, tiny: 0.5 },
  staff_hours: { good: -1, say: (x) => `staff spent ${minutes(x * 60)} ${x < 0 ? "less" : "more"} on tasks`, tiny: 0.05 },
  repeat_contacts: { good: -1, say: (x) => `${moreFewer(x, "customers")} had to get in touch again`, tiny: 0.5 },
  first_response: { good: -1, say: (x) => `first answers on every channel came ${minutes(x)} ${x < 0 ? "sooner" : "later"}`, tiny: 0.5 },
  visits: { good: 1, say: (x) => `${moreFewer(x, "shop visits")} came from what your AI sent or posted`, tiny: 0.05 },
  content_orders: { good: 1, say: (x) => `${moreFewer(x, "orders")} came from them`, tiny: 0.05 },
  revenue: { good: 1, say: (x) => `revenue was ${money(x)} ${x > 0 ? "higher" : "lower"}`, tiny: 0.5 },
  gross_profit: { good: 1, say: (x) => `gross profit was ${money(x)} ${x > 0 ? "higher" : "lower"}`, tiny: 0.5 },
  orders: { good: 1, say: (x) => moreFewer(x, "orders"), tiny: 0.05 },
  stockouts: { good: -1, say: (x) => `${moreFewer(x, "product-days")} out of stock`, tiny: 0.05 },
  lost_sales: { good: -1, say: (x) => `${moreFewer(x, "sales")} lost to empty shelves`, tiny: 0.05 },
};

/** A step with its words and direction, or null when the figure is missing. */
function makeStep(kind, difference, source, extra) {
  if (difference === null || difference === undefined || Number.isNaN(difference)) return null;
  const k = STEPS[kind];
  const direction = Math.abs(difference) < k.tiny ? "same" : Math.sign(difference) === k.good ? "better" : "worse";
  return { kind, label: direction === "same" ? null : k.say(difference, extra), difference: round2(difference), direction, source };
}

/**
 * A chain from its steps: stops before the first step that did not change (so it never shows "→ 0 ..."), and is only
 * kept with at least two steps that moved. The sentence links each step to the last with "so" when they point the same
 * way and "but" when they do not, so bad news reads as bad news.
 */
function chainOf(steps) {
  if (steps.some((st) => st === null)) return null;
  const moved = [];
  for (const st of steps) { if (st.direction === "same") break; moved.push(st); }
  if (moved.length < 2) return null;
  const text = moved.map((st, i) => (i === 0 ? st.label : `${st.direction === moved[i - 1].direction ? "so" : "but"} ${st.label}`)).join(", ");
  const bad = moved.at(-1).direction === "worse";
  return { steps: moved.map(({ kind, label, difference, direction, source }) => ({ kind, label, difference, direction, source })),
    sentence: `${text[0].toUpperCase()}${text.slice(1)}.`, ends: bad ? "worse" : "better", measured_against: "the same business left alone" };
}

/**
 * Knock-on effects: chains of figures the records support, each step measured against the business left alone and
 * marked `count` (from the records) or `simulator` (from the simulator's rules and assumptions). Nothing claims one step
 * caused the next beyond the simulator's own rules.
 */
export function knockOn({ job, totals, contacts, impact, state, shadowState, since, voices }) {
  const d = (k) => impact.measures[k]?.difference ?? null;
  const chains = [];
  if (contacts?.with_ai && contacts.left_alone && totals) {
    const a = contacts.with_ai.average_wait_hours, b = contacts.left_alone.average_wait_hours;
    const goodReviews = (s) => (s.reviews || []).filter((r) => r.date >= since.slice(0, 10) && r.rating >= 4).length;
    chains.push(chainOf([
      makeStep("wait_hours", a !== null && b !== null ? a - b : null, "count"),
      makeStep("satisfied", totals.live.satisfied_n - totals.shadow.satisfied_n, "simulator"),
      makeStep("good_reviews", shadowState ? goodReviews(state) - goodReviews(shadowState) : null, "count"),
    ]));
    const ids = new Set(voices.map((v) => v.customer_id).filter(Boolean));
    if (ids.size && shadowState) {
      const x = ordersAfter(state, ids, since), y = ordersAfter(shadowState, ids, since);
      chains.push(chainOf([makeStep("orders_after", x.orders - y.orders, "simulator", ids.size), makeStep("money_after", x.value - y.value, "count")]));
    }
    chains.push(chainOf([
      makeStep("staff_hours", d("staff_task_hours"), "simulator"),
      makeStep("repeat_contacts", totals.live.repeat_contacts - totals.shadow.repeat_contacts, "simulator"),
    ]));
    chains.push(chainOf([makeStep("staff_hours", d("staff_task_hours"), "simulator"), makeStep("first_response", d("first_response_minutes"), "count")]));
  } else if (["email-marketing", "social"].includes(job.id)) {
    chains.push(chainOf([makeStep("visits", d("content_visits"), "simulator"), makeStep("content_orders", d("content_orders"), "simulator"), makeStep("revenue", d("revenue"), "count")]));
  } else if (job.id === "stock" || job.id === "manager") {
    chains.push(chainOf([makeStep("stockouts", d("stockouts"), "count"), makeStep("lost_sales", d("lost_sales"), "simulator"), makeStep("revenue", d("revenue"), "count")]));
  } else if (job.id === "pricing") {
    chains.push(chainOf([makeStep("orders", d("orders"), "simulator"), makeStep("revenue", d("revenue"), "count"), makeStep("gross_profit", d("gross_profit"), "count")]));
  }
  return chains.filter(Boolean);
}
