// The other side of a phone call or a web chat: what the customer says next, by rules, never by a model.
//
// The simulator writes each customer's first words in their own manner (simulation/simulator/customers.mjs richText: tone, whether
// they are vague, whether they give their order number). This reads that manner back from the words alone, so nothing
// hidden leaks, and answers the receptionist turn by turn from scripted branches:
//   - asked for the order number or postcode, and had not given it: gives it;
//   - asked which product, and was vague: names it;
//   - got a reply that addresses the problem: thanks them and hangs up (a complaint also wants it recorded);
//   - got a reply that does not: says so once, in their tone, and asks for a person if they are blunt; then gives up.
// What it cannot simulate: real speech, interruptions, people changing their story, or anything outside these
// branches. A caller says at most four things.

import { rngFor } from "../../business/builder/world/rng.mjs";

export const MAX_CALLER_TURNS = 4;
/**
 * Share of customers who will not deal with an automated helper at all and ask for a person at once. An assumption
 * (surveys put people who always prefer a human for service at roughly one in ten); drawn once per customer, so the same
 * person asks every time.
 */
export const PREFERS_PERSON_SHARE = 0.08;

/** Whether this customer asks for a person straight away. Keyed by the customer, never by a running count. */
export const prefersPerson = (customerId) => !!customerId && rngFor(1, "prefers-person", customerId).next() < PREFERS_PERSON_SHARE;

const ASKS_REF = /\b(order (number|reference)|reference|postcode|post code|email address on)\b/i;
const ASKS_WHICH = /\b(which (product|item|one)|what (did you|item|product)|what was it)\b/i;
const ADDRESSES = /\b(sorry|apolog|refund|replace|replacement|track|tracking|deliver|delivery|dispatch|order|send|sent|return|fix|arrive|today|tomorrow|case|colleague|team|pass (this|it) on|call you back|get back to you|in stock|price)\w*/i;
const RECORDED = /\b(case|complaint|recorded|logged|colleague|team|person|someone)\b/i;
const PROBLEM = {
  where_is_my_order: "where my order is", late_parcel: "my late parcel", damaged: "the damaged item", missing: "the missing item",
  fault: "the fault", return_question: "sending it back", change_order: "changing my order", refund_chase: "my refund",
  complaint: "my complaint", product_question: "my question about the product", presale: "my question before I buy",
};

/**
 * The caller's manner, read from their first words.
 * @param {string} opening
 * @return {{tone: string, omits: boolean, vague: boolean}}
 */
export function mannerOf(opening) {
  const tone = /^Hello, this is /.test(opening) ? "polite" : /^Hi, .+ here\./.test(opening) ? "plain" : "blunt";
  return { tone, omits: !/\bORD-\d+\b/.test(opening), vague: /thing I ordered/.test(opening) };
}

/**
 * What the caller says next, or null when they hang up.
 * @param {object} o
 * @param {string} o.topic The contact's topic.
 * @param {string} o.opening Their first words.
 * @param {string} o.reply What the receptionist just said.
 * @param {object} o.state Carried between turns (start with {}): what they have already said.
 * @param {?string} o.order Their order number, if the call is about an order.
 * @param {?string} o.postcode The postcode on that order.
 * @param {?string} o.product The product's name.
 * @return {?string}
 */
export function nextCallerTurn({ topic, opening, reply, state, order = null, postcode = null, product = null, customerId = null }) {
  state.said = (state.said || 1) + 1;
  if (state.said > MAX_CALLER_TURNS || state.done) return null;
  const m = mannerOf(opening);
  const text = String(reply || "").trim();
  if (prefersPerson(customerId)) {
    if (!state.askedPerson) { state.askedPerson = true; return m.tone === "blunt" ? "I want to speak to a person." : "I'd rather speak to a person, please."; }
    // Answered by a hand-over: content. Anything else: they hang up.
    state.done = true;
    if (RECORDED.test(text)) { state.handedOver = true; return { polite: "Thank you. I'll wait to hear.", plain: "Right. Thanks.", blunt: "Fine." }[m.tone]; }
    state.gaveUp = true;
    return null;
  }
  if (order && m.omits && !state.gaveRef && ASKS_REF.test(text)) {
    state.gaveRef = true;
    return `It's ${order}${postcode ? `, and the postcode is ${postcode}` : ""}.`;
  }
  if (product && m.vague && !state.gaveProduct && ASKS_WHICH.test(text)) {
    state.gaveProduct = true;
    return `It's the ${product}.`;
  }
  if (text.length >= 25 && ADDRESSES.test(text)) {
    if (topic === "complaint" && !RECORDED.test(text) && !state.askedRecord) {
      state.askedRecord = true;
      return m.tone === "blunt" ? "I want this recorded as a complaint." : "Could you make sure this is recorded as a complaint, please?";
    }
    state.done = true;
    return { polite: "That's helpful, thank you. Goodbye.", plain: "Right, thanks. Bye.", blunt: "Fine." }[m.tone];
  }
  if (state.nudged) { state.gaveUp = true; return null; } // said it once; they give up and hang up
  state.nudged = true;
  const about = PROBLEM[topic] || "my question";
  return { polite: `Sorry, I'm not sure that answers it. I was asking about ${about}.`, plain: `That doesn't really answer it. It's about ${about}.`,
    blunt: `That doesn't help. Can I speak to a person about ${about}?` }[m.tone];
}
