// "Give us your AI's web address": the business sends work to an outside AI service, turn by turn, and uses its answers.
//
// The message format is the batch simulator's tool protocol (simulation/simulator/README.md "The tool protocol", simulation/simulator/tool.mjs): one JSON
// message POSTed in, {"reply": "..."} back. Each message carries a session_id (one per customer contact), the turn, the
// channel, the conversation so far (`history`, added here so a service need not keep memory), a key and the API
// address so the service can look things up and act through the same tools as everyone else.
//
// When it happens: after each simulated day, for each job taken with a web address. Customer contacts on the job's
// channels wait for the service (support cover), are sent one by one, and the service's words become the reply (an
// email from hello@, or the shop's side of a chat or a call). The business clock is set to just after the contact
// arrived while it is handled, because a service answers as the message comes in, not next morning. A service that is
// slow or down leaves the customer waiting; staff pick it up after their usual wait. No model runs here.
import { makeToolClient } from "../../simulation/simulator/tool.mjs";
import { needJob, whatsWaiting, instructionsFor, handover } from "./jobs.mjs";
import { mannerOf, nextCallerTurn } from "./callers.mjs";
import { checkOutboundUrl, guardedFetch } from "./net-guard.mjs";

export const DEFAULT_TIMEOUT_SECONDS = 15;
export const MAX_TIMEOUT_SECONDS = 60;
const PER_DAY = 40;          // contacts sent to one service in one simulated day; the rest go to staff
const GIVE_UP_AFTER = 3;     // failures in a row before the rest of the day goes to staff

const isoPlus = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60000).toISOString().replace(".000Z", "Z");

/**
 * Checks a service address: http or https, and on a shared server a public one.
 * @param {*} url
 * @return {string}
 */
export function checkServiceUrl(url) {
  try {
    // WHY the shared guard: on a hosted server this also refuses private and local addresses (infrastructure/server/net-guard.mjs).
    return checkOutboundUrl(url).toString();
  } catch (e) {
    throw Object.assign(new Error(`"url" must be your AI's web address. ${e.message}`), { code: "invalid_input" });
  }
}

/** One message to a service, timed. Returns { reply?, error?, ms }. */
async function send(client, payload) {
  const t0 = Date.now();
  const r = await client.call(payload);
  return { ...r, ms: Date.now() - t0 };
}

/** The opening words of a contact and where to write the answer. */
function openingOf(st, contact) {
  if (contact.channel === "email") {
    const e = (st.emails || []).find((x) => x.links?.contact_id === contact.id && x.folder === "inbox");
    return e ? { text: e.body, emailId: e.id } : null;
  }
  const conv = (st.conversations || []).find((x) => x.contact_id === contact.id);
  return conv ? { text: conv.messages[0]?.text || "", conv } : null;
}

/**
 * Sends a test message to a service and returns what came back, without touching the business.
 * @return {Promise<{reply: ?string, error: ?string, ms: number}>}
 */
export async function testService({ url, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS, message, channel = "phone", role = "support_agent", apiUrl = null, token = null }) {
  const client = makeToolClient({ http: checkServiceUrl(url), timeoutMs: timeoutSeconds * 1000, fetchImpl: guardedFetch });
  const r = await send(client, { protocol: 1, session_id: `test-${Date.now()}`, turn: 0, message: message || "Hello, this is Mr Toad. Do you sell umbrellas, and how much is delivery?", history: [],
    channel, role, api_url: apiUrl, token, system_prompt: "This is a test message from Overthought & Co. Nothing you do now changes the business.", sim: { kind: "test" } });
  return { reply: r.reply ?? null, error: r.error ?? null, ms: r.ms };
}

/**
 * After a simulated day: sends the day's work to every job taken with a web address.
 * @param {SandboxStore} store
 * @param {object} sb
 * @param {{date?: string}} day The day just simulated (its summary).
 */
export async function deliverDay(store, sb, day) {
  for (const t of Object.values(sb.jobs || {})) {
    if (t.stopped_at || !t.url) continue;
    const job = needJob(t.job);
    const principal = sb.tokens.find((p) => t.token_ids.includes(p.id) && !p.revoked);
    if (!principal) continue;
    const client = makeToolClient({ http: t.url, timeoutMs: (t.timeout_seconds || DEFAULT_TIMEOUT_SECONDS) * 1000, fetchImpl: guardedFetch });
    const env = { store, sb, t, job, principal, client, date: day?.date || sb.world.state.now.slice(0, 10),
      system: `${instructionsFor({ world: sb.world, role: job.role, jobId: job.id, canMoveTime: false })}\n\n${handover(job)}` };
    if (job.result === "contacts") await sendContacts(env);
    else await sendDaily(env);
  }
}

/** Customer contacts on the job's channels that nobody has answered, oldest first. */
async function sendContacts(env) {
  const { sb, t } = env;
  const channels = t.cover?.channels || [];
  const waiting = (sb.world.state.contacts || []).filter((c) => c.outcome === "waiting" && c.first_reply_minutes == null && !c.handled_by && channels.includes(c.channel) && c.at >= t.started_sim);
  let failures = 0, sent = 0;
  for (const contact of waiting) {
    if (sent >= PER_DAY || failures >= GIVE_UP_AFTER) break;
    const ok = await converse(env, contact);
    sent++;
    failures = ok ? 0 : failures + 1;
  }
  if (failures >= GIVE_UP_AFTER) env.store.record(sb, { kind: "delivery", job: t.job, ok: false, note: `Your AI's address did not answer ${GIVE_UP_AFTER} times in a row; the rest of the day's customers wait for staff.` });
}

/**
 * One contact, turn by turn. Email is one turn (a reply to the email); a chat or a call goes on until the customer
 * hangs up (infrastructure/server/callers.mjs). Returns false when the service did not answer at all.
 */
async function converse({ store, sb, t, job, principal, client, date, system }, contact) {
  const st = sb.world.state;
  const opening = openingOf(st, contact);
  if (!opening) return true;
  const order = contact.order ? st.orders.find((o) => o.number === contact.order) : null;
  const facts = { topic: contact.topic, opening: opening.text, order: order?.number ?? null, postcode: order?.delivery?.address?.postcode ?? null, product: order?.items?.[0]?.name?.split(",")[0] ?? null };
  const history = [{ from: "customer", text: opening.text }];
  const wasNow = st.now;
  const session = contact.id;
  const callerState = {};
  let message = opening.text, turns = 0, answered = false, error = null, ms = 0;
  try {
    for (let turn = 0; turn < 8; turn++) {
      // The service answers as the customer writes or calls: a minute after they arrive, a minute per turn.
      sb.world.setNow(isoPlus(contact.at, 1 + turn));
      const r = await send(client, { protocol: 1, session_id: session, turn, message, history: history.slice(0, -1), channel: contact.channel, role: job.role,
        api_url: t.api_url, token: t.delivery_token, system_prompt: system, sim: { kind: "contact", job: job.id, date, contact_id: contact.id, channel: contact.channel } });
      ms += r.ms;
      if (r.error || !r.reply?.trim()) { error = r.error || "empty reply"; break; }
      turns++;
      answered = true;
      history.push({ from: "shop", text: r.reply });
      if (contact.channel === "email") {
        const sent = store.call(sb, principal, { role: job.role, session, via: "delivery" }, "send_email", { mailbox: "hello", reply_to_id: opening.emailId, body: r.reply });
        if (!sent.ok) error = `the reply could not be sent: ${sent.error.message}`;
        break;
      }
      opening.conv.messages.push({ from: "assistant", at: st.now, text: r.reply });
      const next = nextCallerTurn({ ...facts, customerId: contact.customer_id, reply: r.reply, state: callerState });
      if (!next) break;
      history.push({ from: "customer", text: next });
      opening.conv.messages.push({ from: "customer", at: isoPlus(contact.at, 1 + turn), text: next });
      if (callerState.done) break; // "Thank you, goodbye": nothing left for the service to answer
      message = next;
    }
    // A chat or call answered by the service: its first answer came a minute after the customer arrived.
    if (answered && contact.channel !== "email" && contact.first_reply_minutes == null) contact.first_reply_minutes = 1;
  } finally {
    sb.world.setNow(wasNow);
  }
  store.record(sb, { kind: "delivery", via: "delivery", actor: { token: principal.id, role: job.role, session }, job: job.id, contact_id: contact.id, channel: contact.channel,
    topic: contact.topic, ok: answered && !error, turns, ms, ...(error ? { error } : {}), transcript: history,
    caller: { asked_person: !!callerState.askedPerson, handed_over: !!callerState.handedOver, gave_up: !!callerState.gaveUp } });
  // The caller's reaction is on the record too, so the job's result can count who wanted a person and who gave up.
  if (contact.channel !== "email") contact.caller = { asked_person: !!callerState.askedPerson, handed_over: !!callerState.handedOver, gave_up: !!callerState.gaveUp };
  return answered;
}

/** Jobs without customer contacts get one message a day: what is waiting, as whats_waiting gives it. */
async function sendDaily({ store, sb, t, job, principal, client, date, system }) {
  const waiting = whatsWaiting(sb.world, job.id, job.role);
  const kind = { stock: "alerts", prospects: "prospects" }[job.id] || "daily";
  const r = await send(client, { protocol: 1, session_id: `${job.id}-${date}`, turn: 0, message: `Your day at Overthought & Co., ${date}. ${waiting.summary} Act through the tools at api_url with your token.`, history: [],
    channel: "work", role: job.role, api_url: t.api_url, token: t.delivery_token, system_prompt: system, sim: { kind, job: job.id, date, data: waiting } });
  store.record(sb, { kind: "delivery", via: "delivery", actor: { token: principal.id, role: job.role, session: `${job.id}-${date}` }, job: job.id, ok: !r.error, ms: r.ms,
    ...(r.error ? { error: r.error } : { reply: r.reply }) });
}
