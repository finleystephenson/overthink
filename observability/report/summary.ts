/**
 * @fileoverview summary.md: about ten lines a coding agent can paste into chat.
 */
import type {MeasureResult, Results} from './results.ts';
import {CAVEAT, PASS_K, signedMoney} from './results.ts';
import {audienceLines} from './audiences.ts';

/** Returns the summary as Markdown. */
export function summaryMarkdown(r: Results): string {
  const n = r.reproducibility.seeds.length;
  const m = (k: string): MeasureResult | undefined => r.measures.find((x) => x.key === k);
  const lines = [
    `# Overthink: ${r.config.adapter} (${r.config.job}, ${r.config.days} days, ${n} ${n === 1 ? 'run' : 'runs'})`,
    '',
    r.headline,
    '',
  ];
  if (r.stopped !== null) lines.push(`- **Stopped early:** ${r.stopped}.`);
  for (const key of ['net_profit', 'refunds', 'staff_task_cost', 'customer_satisfaction']) {
    const x = m(key);
    if (x !== undefined) lines.push(`- ${measureLine(x, n)}`);
  }
  const p = r.product;
  lines.push(
    `- Product: handled ${p.contacts} contacts; sorted alone ${p.resolvedAlone}, handed to a person ${p.handedOver}, ` +
      `customers gave up ${p.customersGaveUp}, wrong actions ${p.wrongActions}, calls refused by the rules ${p.refusedCalls}, errors ${p.productErrors}.`,
  );
  const total = r.failureCounts.reduce((a, c) => a + c.n, 0);
  lines.push(
    total === 0
      ? '- What went wrong: nothing the checks look for.'
      : `- What went wrong (${total}): ${r.failureCounts
          .slice(0, 4)
          .map((c) => `${c.label.toLowerCase()} ${c.n}`)
          .join('; ')}. Details: results.json "failures".`,
  );
  const sec = r.security;
  lines.push(
    `- Security: ${sec.attempts} attempts to break it; held ${sec.held}, held only by the shop’s rules ${sec.heldByRules}, broke ${sec.broke}.`,
  );
  const weakest = p.passK
    .filter((x) => x.passK !== null)
    .sort((a, b) => (a.passK ?? 0) - (b.passK ?? 0))[0];
  if (weakest !== undefined) {
    lines.push(
      `- Least reliable: "${weakest.topic}", pass^${PASS_K} ${pct(weakest.passK)} (pass^1 ${pct(weakest.pass1)}, ${weakest.n} contacts).`,
    );
  }
  lines.push(...audienceLines(r.audiences));
  const t = r.tokens;
  lines.push(
    `- People voiced by ${r.reproducibility.people_model}: ${t.input + t.output} tokens (${t.calls} calls, ${t.cached_calls} from cache).`,
  );
  lines.push(
    `- Reproduce: seeds ${r.reproducibility.seeds.join(', ') || 'none'}, world ${r.reproducibility.world_hash}, adapter ${r.reproducibility.adapter_version}.`,
  );
  lines.push(`- Look over its shoulder: \`${r.view.command}\`, then open ${r.view.base}.`);
  lines.push('', CAVEAT, '');
  return lines.join('\n');
}

function measureLine(x: MeasureResult, n: number): string {
  const d = x.difference;
  if (d.mean === null) return `${x.label}: no data.`;
  const fmt = (v: number): string =>
    x.unit === '£'
      ? signedMoney(v)
      : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}${unitSuffix(x.unit)}`;
  const interval =
    d.interval95 === null
      ? 'no interval with one run'
      : `95% interval ${fmt(d.interval95[0])} to ${fmt(d.interval95[1])}`;
  return `${x.label}: ${fmt(d.mean)} per run (${interval}); better in ${d.betterIn} of ${n} runs.`;
}

function unitSuffix(unit: string): string {
  return unit === 'h' ? ' h' : unit === 'min' ? ' min' : '';
}

function pct(x: number | null): string {
  return x === null ? 'n/a' : `${Math.round(x * 100)}%`;
}
