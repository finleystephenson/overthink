// The lab over HTTP. Handlers in the server's own shape ([method, pattern, handler(req, url, params) → [status, body]]),
// mounted by infrastructure/server/http.mjs. No account is needed (explore without an account); limits keep a public server safe:
// days, seeds, arms, interventions and total work per experiment, runs at once, experiments kept, and no shell commands
// from the web unless the server's owner allows them (LAB_ALLOW_COMMANDS=1).
//
//   GET  /lab/interventions                     the catalogue, with parameters (for a form)
//   GET  /lab/library                           built-in experiments
//   POST /lab/plan            { idea }          idea → reviewable plan (nothing runs)
//   POST /lab/experiments     { experiment } or { library: "raise-prices-10" }   → 202 { id }; runs in the background
//   GET  /lab/experiments                       every experiment kept, with status and progress
//   GET  /lab/experiments/:id                   status, progress (0 to 1), error, timings
//   GET  /lab/experiments/:id/results           paired results and verdicts
//   GET  /lab/experiments/:id/explain/:arm      how and why, people affected
//   GET  /lab/experiments/:id/scorecard/:arm    scorecard for an arm with a connected AI
//   GET  /lab/experiments/:id/follow?arm=&order=ORD-1 | &action=12   follow one order or one AI action (first seed)
//   GET  /lab/experiments/:id/repro             state fingerprint, seeds, interventions, settings
//   POST /lab/overthink       { connection, role?, repeats?, days?, seeds?, cost_per_month?, scope?, only? } → 202 { id }
//   GET  /lab/overthink/:id                     status, then scorecards and situations
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runExperiment, checkExperiment, DEFAULT_LIMITS } from "./experiment.mjs";
import { buildResults } from "./results.mjs";
import { explainArm, followOrder, followAction } from "./explain.mjs";
import { buildScorecard } from "./scorecard.mjs";
import { listInterventions } from "./interventions.mjs";
import { planFromIdea } from "./plan.mjs";
import { overthink } from "./overthink.mjs";
import { checkScope } from "./scope.mjs";
import { checkConnection } from "./client.mjs";

const LIBRARY = path.join(path.dirname(fileURLToPath(import.meta.url)), "library");
const fail = (code, message, status) => { throw Object.assign(new Error(message), { code, status }); };
const envNum = (k, d) => (Number.isFinite(Number(process.env[k])) && process.env[k] !== undefined ? Number(process.env[k]) : d);

/** Limits for the web. Each can be set by the server's owner with an environment variable (LAB_MAX_DAYS, ...). */
export function webLimits(over = {}) {
  return {
    maxDays: envNum("LAB_MAX_DAYS", 120), maxSeeds: envNum("LAB_MAX_SEEDS", 10), maxArms: envNum("LAB_MAX_ARMS", 4),
    maxInterventions: envNum("LAB_MAX_INTERVENTIONS", 20), maxWork: envNum("LAB_MAX_WORK", 2400), // arm-days of simulation per request
    maxConcurrent: envNum("LAB_MAX_CONCURRENT", 2), maxStored: envNum("LAB_MAX_STORED", 30), maxKept: envNum("LAB_MAX_KEPT", 2),
    allowCommands: process.env.LAB_ALLOW_COMMANDS === "1", allowAi: true,
    // Finished experiments are forgotten this many hours after they end (and all of them when the server restarts).
    retentionHours: envNum("LAB_RETENTION_HOURS", 24),
    // GET /lab/experiments lists every experiment; a shared server turns this off so nobody browses other people's.
    listAll: process.env.LAB_LIST_ALL !== "0",
    ...over,
  };
}

/** Commands anyone may run from the web: the lab's own reference responders. */
const SAFE_COMMANDS = new Set(["node simulation/simulator/examples/simple-responder.mjs", "node simulation/simulator/examples/do-nothing.mjs"]);

/**
 * The lab's routes.
 * @param {{readJson: function(object): Promise<object>, limits?: object}} o readJson reads a request body (the server's, with its size limit).
 * @return {Array<Array>}
 */
export function labRoutes({ readJson, limits = webLimits() }) {
  const jobs = new Map(); // id → { kind, status, progress, created, raw?, results?, run?, error? }
  let running = 0;
  const id = () => randomBytes(6).toString("hex");
  const need = (jid, kind) => { forgetOld(); const j = jobs.get(jid); if (!j || j.kind !== kind) fail("not_found", `No ${kind} ${jid}. They are kept in memory until the server restarts (at most ${limits.maxStored}).`); return j; };
  const ready = (j) => { if (j.status !== "done") fail("unavailable", j.status === "failed" ? `It failed: ${j.error}` : `Still running (${Math.round(j.progress * 100)}%). Try again shortly.`, j.status === "failed" ? 409 : 409); return j; };

  /** Data retention: a finished experiment goes retentionHours after it ended. */
  function forgetOld() {
    const cutoff = Date.now() - limits.retentionHours * 3600000;
    for (const j of [...jobs.values()]) if (j.status !== "running" && j.finished && j.finished < cutoff) jobs.delete(j.id);
  }

  function admit() {
    forgetOld();
    if (running >= limits.maxConcurrent) fail("unavailable", `The lab is already running ${running} experiments, the most this server allows at once. Try again when one finishes.`, 503);
    // Keep only the newest experiments; let the oldest finished ones go.
    const done = [...jobs.values()].filter((j) => j.status !== "running").sort((a, b) => a.created - b.created);
    while (jobs.size >= limits.maxStored && done.length) jobs.delete(done.shift().id);
    for (const j of [...jobs.values()].filter((x) => x.raw).sort((a, b) => b.created - a.created).slice(limits.maxKept)) for (const a of Object.values(j.raw.arms)) delete a.kept;
  }

  /** Commands from the web would run on this machine: only the lab's own, unless the owner allows more. */
  function checkCommands(exp) {
    for (const arm of exp.arms) for (const iv of arm.interventions) {
      const c = iv.type === "connect_ai" ? iv.params.connection : null;
      if (c?.kind === "cmd" && !limits.allowCommands && !SAFE_COMMANDS.has(c.cmd)) fail("forbidden", "This server does not run commands sent over the web. Connect your AI by web address ({ \"kind\": \"http\", \"url\": ... }), or run the lab on your own machine (node simulation/lab/cli.mjs).", 403);
    }
  }

  function start(kind, fn, extra = {}) {
    admit();
    const j = { id: id(), kind, status: "running", progress: 0, created: Date.now(), ...extra };
    jobs.set(j.id, j);
    running++;
    fn(j).then(() => { j.status = "done"; j.progress = 1; }, (e) => { j.status = "failed"; j.error = e.code === "invalid_input" ? e.message : "Something went wrong while it ran."; if (e.code !== "invalid_input") console.error(e); })
      .finally(() => { running--; j.finished = Date.now(); });
    return j;
  }

  const libraryList = () => fs.readdirSync(LIBRARY).filter((f) => f.endsWith(".json")).map((f) => ({ id: f.replace(/\.json$/, ""), ...JSON.parse(fs.readFileSync(path.join(LIBRARY, f), "utf8")) }));

  return [
    ["GET", /^\/lab\/interventions$/, () => [200, { ok: true, data: listInterventions() }]],
    ["GET", /^\/lab\/library$/, () => [200, { ok: true, data: libraryList() }]],
    ["POST", /^\/lab\/plan$/, async (req) => [200, { ok: true, data: await planFromIdea((await readJson(req)).idea) }]],
    ["GET", /^\/lab\/limits$/, () => [200, { ok: true, data: limits }]],

    ["POST", /^\/lab\/experiments$/, async (req) => {
      const b = await readJson(req);
      let spec = b.experiment;
      if (!spec && b.library) spec = libraryList().find((x) => x.id === b.library) || fail("not_found", `No library experiment "${b.library}".`);
      if (!spec) fail("invalid_input", 'Send { "experiment": { ... } } or { "library": "raise-prices-10" }.');
      const exp = checkExperiment(spec, limits);
      const work = exp.days * exp.seeds * exp.arms.length;
      if (work > limits.maxWork) fail("invalid_input", `That is ${work} arm-days of simulation; this server allows ${limits.maxWork} per experiment (days × seeds × arms, the baseline included).`);
      checkCommands(exp);
      const j = start("experiment", async (job) => {
        job.raw = await runExperiment(spec, { limits, keepFirstSeed: true, onProgress: (p) => { job.progress = p.done; } });
        job.results = buildResults(job.raw);
      }, { title: exp.title });
      return [202, { ok: true, data: { id: j.id, status: j.status, poll: `/lab/experiments/${j.id}`, results: `/lab/experiments/${j.id}/results` } }];
    }],
    ["GET", /^\/lab\/experiments$/, () => {
      if (!limits.listAll) fail("forbidden", "This shared server does not list experiments. Keep the id you were given when you started yours.");
      forgetOld();
      return [200, { ok: true, data: [...jobs.values()].filter((j) => j.kind === "experiment").map(summary) }];
    }],
    ["GET", /^\/lab\/experiments\/([0-9a-f]{12})$/, (req, url, [jid]) => [200, { ok: true, data: summary(need(jid, "experiment")) }]],
    ["GET", /^\/lab\/experiments\/([0-9a-f]{12})\/results$/, (req, url, [jid]) => [200, { ok: true, data: ready(need(jid, "experiment")).results }]],
    ["GET", /^\/lab\/experiments\/([0-9a-f]{12})\/repro$/, (req, url, [jid]) => [200, { ok: true, data: ready(need(jid, "experiment")).raw.repro }]],
    ["GET", /^\/lab\/experiments\/([0-9a-f]{12})\/explain\/([a-z0-9_-]+)$/i, (req, url, [jid, arm]) => [200, { ok: true, data: explainArm(ready(need(jid, "experiment")).raw, arm) }]],
    ["GET", /^\/lab\/experiments\/([0-9a-f]{12})\/scorecard\/([a-z0-9_-]+)$/i, (req, url, [jid, arm]) => {
      const j = ready(need(jid, "experiment"));
      const a = j.raw.arms[arm] || fail("not_found", `No arm "${arm}".`);
      if (!a.ai) fail("invalid_input", `Arm "${arm}" has no connected AI; a scorecard is for an AI or tool under test.`);
      // The scorecard reads the AI arm as "ai": give it a view of this experiment with that arm under that name.
      const view = { ...j.raw, arms: { baseline: j.raw.arms.baseline, ai: a } };
      const results = { ...j.results, arms: { ai: j.results.arms[arm] } };
      return [200, { ok: true, data: buildScorecard({ label: a.label, stretch: view, results, costPerMonth: a.ai.cost_per_month, declared: a.ai.declared }) }];
    }],
    ["GET", /^\/lab\/experiments\/([0-9a-f]{12})\/follow$/, (req, url, [jid]) => {
      const j = ready(need(jid, "experiment"));
      const arm = j.raw.arms[url.searchParams.get("arm") || "baseline"] || fail("not_found", "No such arm.");
      if (!arm.kept) fail("unavailable", "This experiment's worlds are no longer kept (only the newest few are). Run it again to follow a chain.", 409);
      const order = url.searchParams.get("order"), action = url.searchParams.get("action");
      if (order) return [200, { ok: true, data: followOrder(arm.kept.state, order, arm.kept.trace) }];
      if (action) return [200, { ok: true, data: followAction(arm.kept.state, arm.kept.trace, Number(action)) }];
      // No target: offer some, so a person can pick.
      const orders = arm.kept.state.orders.slice(-10).map((o) => o.number);
      const actions = arm.kept.trace.filter((t) => t.kind === "tool" && (t.changes || []).length).slice(-10).map((t) => ({ seq: t.seq, tool: t.tool }));
      return [200, { ok: true, data: { note: "Add ?order=<order number> or ?action=<number>.", recent_orders: orders, recent_actions: actions } }];
    }],

    ["POST", /^\/lab\/overthink$/, async (req) => {
      const b = await readJson(req);
      const conn = b.connection || fail("invalid_input", 'Send { "connection": { "kind": "http", "url": "https://..." } } (or "reference_only": true).');
      // Checked now, not when the run starts, so a refused address (e.g. a private one on a shared server) is a 400.
      const products = b.reference_only ? [] : [checkConnection(conn)];
      if (!b.reference_only && conn.kind === "cmd" && !limits.allowCommands && !SAFE_COMMANDS.has(conn.cmd)) fail("forbidden", "This server does not run commands sent over the web. Give your AI's web address instead.", 403);
      const days = b.days ?? 14, seeds = b.seeds ?? 3, repeats = b.repeats ?? 2;
      if (!Number.isInteger(days) || days < 0 || days > limits.maxDays) fail("invalid_input", `"days" must be 0 to ${limits.maxDays}.`);
      if (!Number.isInteger(seeds) || seeds < 1 || seeds > limits.maxSeeds) fail("invalid_input", `"seeds" must be 1 to ${limits.maxSeeds}.`);
      if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) fail("invalid_input", '"repeats" must be 1 to 5.');
      const scope = checkScope(b.scope);
      const j = start("overthink", async (job) => {
        job.run = await overthink({ products, role: b.role || "assistant", size: "demo", repeats, days, seeds, costPerMonth: Number(b.cost_per_month) || 0, scope, only: Array.isArray(b.only) ? b.only : null });
      });
      return [202, { ok: true, data: { id: j.id, status: j.status, poll: `/lab/overthink/${j.id}` } }];
    }],
    ["GET", /^\/lab\/overthink\/([0-9a-f]{12})$/, (req, url, [jid]) => {
      const j = need(jid, "overthink");
      return [200, { ok: true, data: j.status === "done" ? { ...summary(j), ...j.run } : summary(j) }];
    }],
  ];
}

function summary(j) {
  return { id: j.id, kind: j.kind, title: j.title ?? null, status: j.status, progress: Math.round(j.progress * 1000) / 1000, error: j.error ?? null,
    created_at: new Date(j.created).toISOString(), took_seconds: j.finished ? Math.round((j.finished - j.created) / 100) / 10 : null };
}
