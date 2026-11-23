// Benchmark runner. See examples/benchmark/README.md and docs/benchmark.md.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createWorld } from "../../infrastructure/engine/all.js";
import { loadData } from "../../infrastructure/engine/load.js";
import { scoreCode, combine, consistency } from "./score.mjs";
import { judge } from "./judge.mjs";
import { stepsOf, flatten } from "./steps.mjs";
import { passMetrics } from "./passk.mjs";
import { anthropicAgent, httpAgent, cmdAgent, callsFromTrace, newUsage } from "./adapters.mjs";
import { scriptedCustomer, fakeCustomer, anthropicCustomer, converseWith } from "./customers.mjs";
import { SandboxStore } from "../../infrastructure/server/sandboxes.mjs";
import { createApp } from "../../infrastructure/server/http.mjs";

// ---- EDIT ME: US dollars per million tokens. These are estimates, check the current price list. ----
export const PRICES = {
  "claude-sonnet-5-5": { in: 3, out: 15 },
  "claude-opus-5-5": { in: 5, out: 25 },
};
const FALLBACK_PRICE = { in: 3, out: 15 };
// Cache reads cost 0.1x input, cache writes 1.25x input.

const TEMPTATIONS = ["issue_refund", "add_goodwill_credit"]; // staff tools: the engine refuses them, trying is a policy failure
const DRY_REPLY = "I don't know. I can pass this to a person.";

// ---------------------------------------------------------------- args

export function parseArgs(argv) {
  const o = { filter: null, model: "claude-sonnet-5-5", judge: "claude-opus-5-5", runs: 1, label: "run", noJudge: false, concurrency: 4, file: null, dry: false,
    size: "demo", httpUrl: null, cmd: null, customerModel: null, maxCustomerTurns: 6 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model") o.model = argv[++i];
    else if (a === "--judge") o.judge = argv[++i];
    else if (a === "--runs") o.runs = Number(argv[++i]);
    else if (a === "--label") o.label = argv[++i];
    else if (a === "--concurrency") o.concurrency = Number(argv[++i]);
    else if (a === "--file") o.file = argv[++i];
    else if (a === "--no-judge") o.noJudge = true;
    else if (a === "--dry") o.dry = true;
    else if (a === "--size") o.size = argv[++i];
    else if (a === "--http-url") o.httpUrl = argv[++i];
    else if (a === "--cmd") o.cmd = argv[++i];
    else if (a === "--customer-model") o.customerModel = argv[++i];
    else if (a === "--max-customer-turns") o.maxCustomerTurns = Number(argv[++i]);
    else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
    else o.filter = a;
  }
  if (!(o.runs >= 1) || !(o.concurrency >= 1)) throw new Error("--runs and --concurrency must be 1 or more");
  if (!["demo", "standard"].includes(o.size)) throw new Error("--size must be demo or standard");
  if (o.httpUrl && o.cmd) throw new Error("Use --http-url or --cmd, not both");
  o.agent = o.httpUrl ? "http" : o.cmd ? "cmd" : "anthropic";
  return o;
}

function loadScenarios({ file, filter }) {
  const files = file ? [file] : readdirSync("examples/benchmark/scenarios").filter((f) => /^\d.*\.json$/.test(f)).sort().map((f) => join("examples/benchmark/scenarios", f));
  const all = files.flatMap((f) => JSON.parse(readFileSync(f, "utf8")));
  return filter ? all.filter((s) => s.id.includes(filter) || s.category.includes(filter)) : all;
}

// ---------------------------------------------------------------- cost

export function costOf(model, u) {
  if (!u) return 0;
  const p = PRICES[model] || FALLBACK_PRICE;
  const inTok = (u.input_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + 1.25 * (u.cache_creation_input_tokens || 0);
  return (inTok * p.in + (u.output_tokens || 0) * p.out) / 1e6;
}


// ---------------------------------------------------------------- the assistant side

/** Stand-in for the API in --dry: says it doesn't know and never calls a tool. */
const dryClient = { messages: { create: async () => ({ content: [{ type: "text", text: DRY_REPLY }], stop_reason: "end_turn", usage: newUsage() }) } };

function fillPrompt(template, world, scenario) {
  const now = new Date(world.state.now).toUTCString();
  return template.replaceAll("{{now}}", now).replaceAll("{{channel}}", scenario.channel || "web");
}

/** Tools for the role. For the customer assistant, plus the two staff tools exposed as temptations. */
function buildTools(world, role) {
  const picked = world.tools.filter((t) => t.roles.includes(role) || (role === "assistant" && TEMPTATIONS.includes(t.name)));
  const tools = picked.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  tools[tools.length - 1].cache_control = { type: "ephemeral" };   // caches the whole tool list
  return tools;
}

/**
 * One conversation set-up. A "rig" holds the live world, the agent, and how to read back what the agent did.
 *  direct: the runner runs the model's tool calls itself (Anthropic adapter).
 *  web:    an in-process sandbox server; the agent calls the tools over HTTP with a role token (http and cmd adapters).
 */
async function makeRig({ scenario, opts, ctx, role, system }) {
  if (opts.agent === "anthropic") {
    const world = createWorld({ ...ctx.data, now: ctx.data.business.sim.anchor_now });
    const manager = world.session({ role: "manager" });
    const agent = anthropicAgent({ client: ctx.client, model: opts.model, system, tools: buildTools(world, role), session: world.session({ role }) });
    return {
      world, agent, calls: () => agent.calls, usage: () => agent.usage, hitLimit: () => agent.hitLimit,
      advance: (n) => { for (let d = 0; d < n; d++) manager.call("advance_day", {}); }, close: async () => {},
    };
  }
  // web rig: a fresh sandbox the agent talks to like any developer would
  const { sandbox: sb, token } = ctx.store.create({ size: opts.size });
  const owner = ctx.store.authenticate(token).principal;
  const minted = ctx.store.mintRoleToken(sb, { role, label: "bench agent" });
  const session = `bench-${sb.id}`;
  const base = { protocol: 1, session_id: session, channel: scenario.channel || "web", role, api_url: ctx.apiUrl, token: minted.token, system_prompt: system[0].text };
  const agent = opts.agent === "http" ? httpAgent({ url: opts.httpUrl, base }) : cmdAgent({ command: opts.cmd, base });
  return {
    world: sb.world, agent, calls: () => callsFromTrace(sb.trace, { role, session }), usage: () => newUsage(), hitLimit: () => false,
    advance: (n) => { for (let d = 0; d < n; d++) ctx.store.call(sb, owner, { role: "manager", session: "clock" }, "advance_day", {}); },
    close: async () => { ctx.store.remove(sb.id); },
  };
}

// ---------------------------------------------------------------- one scenario, one run

async function runOne({ scenario, run, opts, ctx }) {
  const t0 = Date.now();
  const role = scenario.role || "assistant";
  const fail = (e) => ({ id: scenario.id, category: scenario.category, run, pass: false, error: e.message, scores: {}, reasons: [`run crashed: ${e.message}`], audit: [], calls: [], transcript: [], cost: 0, latency_ms: Date.now() - t0 });
  let rig;
  try {
    const probe = createWorld({ ...ctx.data, now: ctx.data.business.sim.anchor_now });
    const template = role === "assistant" ? ctx.promptTemplate : ctx.opsPrompt;
    rig = await makeRig({ scenario, opts, ctx, role, system: [{ type: "text", text: fillPrompt(template, probe, scenario), cache_control: { type: "ephemeral" } }] });
  } catch (e) { return fail(e); }

  try {
    const world = rig.world;
    // The tools in tool-use order stay as the agent made them; the starting state is copied before anything happens.
    const initial = structuredClone(world.state);
    const transcript = [];
    const snapshots = [];
    const customerUsage = [];
    for (const step of stepsOf(scenario)) {
      if (step.advance_days) rig.advance(step.advance_days);
      const customer = opts.customerModel
        ? (opts.dry ? fakeCustomer(step.turns) : anthropicCustomer({ client: ctx.client, model: opts.customerModel, scenario, turns: step.turns }))
        : scriptedCustomer(step.turns);
      const { added, usage } = await converseWith({ customer, agent: rig.agent, history: transcript, maxTurns: opts.customerModel ? opts.maxCustomerTurns : step.turns.length });
      transcript.push(...added);
      customerUsage.push(...usage);
      snapshots.push(structuredClone(world.state));
    }
    const final = world.state;
    const calls = rig.calls();
    // Only this agent's own audit lines count: the clock moving on is not the agent's doing.
    const audit = final.audit.filter((a) => a.role === role);
    const flat = flatten(scenario);
    const code = scoreCode({ scenario: flat, calls, audit, initial, final, snapshots });
    let verdict = null, judgeUsage = null;
    if (!opts.noJudge && !opts.dry) {
      ({ verdict, usage: judgeUsage } = await judge({ client: ctx.client, model: opts.judge, scenario: flat, transcript, audit, state: final }));
    }
    const scores = combine(code, verdict);
    if (rig.hitLimit()) scores.reasons.push("hit the tool-round limit");
    const usage = rig.usage();
    const customerCost = customerUsage.reduce((n, u) => n + costOf(opts.customerModel, u), 0);
    return {
      id: scenario.id, category: scenario.category, run, pass: scores.pass, scores, reasons: scores.reasons, verdict,
      transcript, calls, audit, usage, days: snapshots.length > 1 ? snapshots.length : undefined,
      cost: costOf(opts.model, usage) + costOf(opts.judge, judgeUsage) + customerCost, latency_ms: Date.now() - t0,
    };
  } catch (e) { return fail(e); }
  finally { await rig.close(); }
}

/** Run `tasks` (functions returning promises) with at most `limit` in flight. */
async function pool(tasks, limit) {
  const out = new Array(tasks.length);
  let next = 0;
  const worker = async () => { while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); } };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

// ---------------------------------------------------------------- report

const avg = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (x) => (x === null ? "  n/a" : `${(x * 100).toFixed(0)}%`.padStart(5));

export function summarise(results, runs) {
  const byScenario = {};
  for (const r of results) (byScenario[r.id] ||= []).push(r);
  const scenarios = Object.fromEntries(Object.entries(byScenario).map(([id, rs]) => [id, {
    category: rs[0].category, runs: rs.length, passes: rs.filter((r) => r.pass).length, consistency: consistency(rs),
  }]));
  const categories = {};
  for (const r of results) { const c = (categories[r.category] ||= { runs: 0, passes: 0 }); c.runs++; c.passes += r.pass ? 1 : 0; }
  const keys = ["accuracy", "completion", "policy", "tool_use", "action", "escalation"];
  const averages = Object.fromEntries(keys.map((k) => [k, avg(results.map((r) => r.scores[k] ?? null))]));
  averages.consistency = avg(Object.values(scenarios).map((s) => s.consistency));
  return {
    runs, pass_k: passMetrics(results), total: results.length, passes: results.filter((r) => r.pass).length, categories, scenarios, averages,
    cost: results.reduce((a, r) => a + r.cost, 0), median_latency_ms: median(results.map((r) => r.latency_ms)),
  };
}

function printReport(s, results, meta) {
  console.log(`\nAgent ${meta.agent === "anthropic" ? meta.model : meta.agent} | size ${meta.size} | judge ${meta.noJudge ? "off" : meta.judge} | ${s.total} conversations | label ${meta.label}\n`);
  console.log("Pass rate by category");
  for (const [c, v] of Object.entries(s.categories)) console.log(`  ${c.padEnd(34)} ${pct(v.passes / v.runs)}  (${v.passes}/${v.runs})`);
  console.log(`  ${"OVERALL".padEnd(34)} ${pct(s.passes / s.total)}  (${s.passes}/${s.total})\n`);
  if (s.runs > 1) {
    console.log(`pass@1 and pass^${s.runs} (passed all ${s.runs} runs) by category`);
    for (const [c, v] of Object.entries(s.pass_k.categories)) console.log(`  ${c.padEnd(34)} ${pct(v.pass_at_1)}  ${pct(v.pass_hat_k)}`);
    console.log(`  ${"OVERALL".padEnd(34)} ${pct(s.pass_k.overall.pass_at_1)}  ${pct(s.pass_k.overall.pass_hat_k)}\n`);
  }
  console.log("Averages");
  for (const [k, v] of Object.entries(s.averages)) console.log(`  ${k.padEnd(12)} ${v === null ? "n/a" : v.toFixed(2)}`);
  console.log(`\nCost $${s.cost.toFixed(4)} | median latency ${(s.median_latency_ms / 1000).toFixed(1)}s`);
  const failed = results.filter((r) => !r.pass);
  if (failed.length) console.log("\nFailures");
  for (const r of failed) console.log(`  ${r.id} (run ${r.run + 1}): ${r.reasons.join(" | ") || "no reason recorded"}`);
}

// ---------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const usesApi = opts.agent === "anthropic" || opts.customerModel || !opts.noJudge;
  if (!opts.dry && usesApi && !process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key, or use --dry. An http or cmd agent with --no-judge needs no key.");
    process.exit(1);
  }
  const scenarios = loadScenarios(opts);
  if (!scenarios.length) { console.error("No scenarios matched."); process.exit(1); }

  // WHY imported here: the SDK is an optional dependency, needed only for a real (paid) run against Anthropic models.
  const client = opts.dry || !usesApi ? dryClient : new (await import("@anthropic-ai/sdk")).default({ maxRetries: 4 });
  const ctx = {
    client, data: loadData("business/data", { world: opts.size, bench: true }),
    promptTemplate: readFileSync("examples/benchmark/prompt.md", "utf8"), opsPrompt: readFileSync("examples/benchmark/prompt-ops.md", "utf8"),
  };
  // External agents call the shop's tools over the web API, so the runner hosts the sandbox server itself.
  let server = null;
  if (opts.agent !== "anthropic") {
    ctx.store = new SandboxStore({ maxSandboxes: opts.concurrency + 2 });
    server = createApp({ store: ctx.store, rateLimit: 1e7 });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    ctx.apiUrl = `http://127.0.0.1:${server.address().port}`;
  }
  const tasks = scenarios.flatMap((scenario) =>
    Array.from({ length: opts.runs }, (_, run) => () => runOne({ scenario, run, opts, ctx })));
  console.log(`Running ${tasks.length} conversations (${scenarios.length} scenarios x ${opts.runs})${opts.dry ? " in --dry mode" : ""}, agent: ${opts.agent}, world: ${opts.size}...`);
  const results = await pool(tasks, opts.concurrency);
  server?.closeAllConnections?.(); server?.close();

  const summary = summarise(results, opts.runs);
  const version = existsSync("examples/benchmark/scenarios/VERSION") ? readFileSync("examples/benchmark/scenarios/VERSION", "utf8").trim() : null;
  const meta = { label: opts.label, agent: opts.agent, model: opts.model, judge: opts.judge, customer_model: opts.customerModel, size: opts.size, noJudge: opts.noJudge || opts.dry || !usesApi, dry: opts.dry, scenarios_version: version, at: new Date().toISOString() };
  mkdirSync("examples/benchmark/results", { recursive: true });
  const path = `examples/benchmark/results/${meta.at.replace(/[:.]/g, "-")}-${opts.label}.json`;
  writeFileSync(path, JSON.stringify({ meta, summary, results }, null, 2));
  printReport(summary, results, meta);
  console.log(`\nSaved ${path}`);
  process.exit(0);   // do not wait for agent child processes or open sockets
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
