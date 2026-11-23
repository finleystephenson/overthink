// pass@1 and pass^k. Pure functions, no I/O.
//  pass@1 : the average chance one run passes (passes / runs, over every conversation).
//  pass^k : the share of scenarios that passed ALL k of their runs. It is the harsh one: it shows what you can rely on.
// With one run per scenario the two are equal.

const share = (a, b) => (b ? a / b : null);

/** results: [{ id, category, pass }]. Returns overall and per-category numbers. */
export function passMetrics(results) {
  const byScenario = new Map();
  for (const r of results) {
    if (!byScenario.has(r.id)) byScenario.set(r.id, { category: r.category, runs: 0, passes: 0 });
    const s = byScenario.get(r.id);
    s.runs++;
    s.passes += r.pass ? 1 : 0;
  }
  const rows = [...byScenario.values()];
  const k = Math.min(...rows.map((s) => s.runs));            // scenarios are all run the same number of times
  const bucket = (list) => ({
    scenarios: list.length,
    pass_at_1: share(list.reduce((n, s) => n + s.passes, 0), list.reduce((n, s) => n + s.runs, 0)),
    pass_hat_k: share(list.filter((s) => s.passes === s.runs).length, list.length),
  });
  const categories = {};
  for (const c of new Set(rows.map((s) => s.category))) categories[c] = bucket(rows.filter((s) => s.category === c));
  return { k: rows.length ? k : 0, overall: bucket(rows), categories };
}
