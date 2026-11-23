/**
 * @fileoverview report.html: one self-contained file (no CDN, no scripts) that a developer can open, attach to a
 * pull request or send on. The headline, the figures with their intervals, how the product did, and the same
 * customers side by side with and without it.
 */
import type {Transcript, TranscriptLine} from '../../simulation/twin-run/conversation.ts';
import type {MeasureResult, Results, TracePair} from './results.ts';
import {PASS_K, signedMoney} from './results.ts';

/** Returns the report as one HTML document. */
export function reportHtml(r: Results): string {
  const n = r.reproducibility.seeds.length;
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Overthink report</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header class="top">
  <p class="eyebrow">Overthink report · ${esc(r.config.job)} · ${esc(r.config.size)} world</p>
  <h1>${esc(r.headline)}</h1>
  <p class="meta">${esc(r.config.adapter)} · ${r.config.days} simulated days · ${n} paired ${n === 1 ? 'run' : 'runs'} · people voiced by ${esc(r.reproducibility.people_model)}</p>
  ${r.stopped !== null ? `<p class="warn">Stopped early: ${esc(r.stopped)}.</p>` : ''}
</header>

<section>
  <h2>Money</h2>
  <p class="lede">Each run plays the same business twice, with the same customers and the same luck: once with the product, once without. Each figure is the average of the per-run differences, with a 95% bootstrap interval. Dots are single runs.</p>
  <div class="measures">${groupOf(r, MONEY)
    .map((m) => measureCard(m, n))
    .join('')}</div>
</section>

<section>
  <h2>Customers and the team</h2>
  <div class="measures">${r.measures
    .filter((m) => !MONEY.includes(m.key))
    .map((m) => measureCard(m, n))
    .join('')}</div>
  <h3 class="sub">How the product did${r.config.channels !== null ? ` on ${esc(r.config.channels.join(', '))}` : ''}</h3>
  ${productBlock(r)}
</section>

<section id="failures">
  <h2>What went wrong</h2>
  ${failuresBlock(r)}
</section>

<section id="security">
  <h2>Security</h2>
  ${securityBlock(r)}
</section>

<section>
  <h2>Who came in</h2>
  <p class="lede">Every customer had a persona: their circumstances, their history with the shop and a situation, at the assumed rates in <code>business/data/overthink/situations.json</code>, spread over the run so rare cases are met.</p>
  ${situationsBlock(r)}
</section>

<section>
  <h2>The same customers, with and without</h2>
  <p class="lede">The customer’s first words are the same in both. Without the product, staff answer in their own time; with it, every message and tool call is shown. Whether a contact was sorted is read from the records, not from what anyone said.</p>
  ${r.traces.length === 0 ? '<p class="muted">No conversations were recorded.</p>' : r.traces.map((p, i) => tracePair(p, i === 0)).join('')}
</section>

<footer>
  <p class="caveat">${esc(r.caveat)}</p>
  <dl class="repro">
    <dt>Seeds</dt><dd>${esc(r.reproducibility.seeds.join(', ') || 'none')} (population seed ${r.reproducibility.pop_seed})</dd>
    <dt>World</dt><dd><code>${esc(r.reproducibility.world_hash)}</code></dd>
    <dt>Product</dt><dd>${esc(r.config.adapter)} over ${esc(r.config.transport)}, version ${esc(r.reproducibility.adapter_version)}</dd>
    <dt>People</dt><dd>${esc(r.reproducibility.people_model)}${r.reproducibility.people_endpoint !== null ? ` at ${esc(r.reproducibility.people_endpoint)}` : ''}</dd>
    <dt>Tokens</dt><dd>${r.tokens.input.toLocaleString('en-GB')} in, ${r.tokens.output.toLocaleString('en-GB')} out, ${r.tokens.calls} calls, ${r.tokens.cached_calls} from cache${r.tokens.cap !== null ? `, cap ${r.tokens.cap.toLocaleString('en-GB')}` : ''}</dd>
    <dt>Overthink</dt><dd>${esc(r.reproducibility.overthink_version)} on Node ${esc(r.reproducibility.node)}, ${esc(r.reproducibility.started_at)}, ${r.seconds}s</dd>
  </dl>
</footer>
</main>
</body>
</html>
`;
}

/** The money measures, shown first. */
const MONEY: readonly string[] = ['net_profit', 'revenue', 'refunds', 'staff_task_cost'];

function groupOf(r: Results, keys: readonly string[]): MeasureResult[] {
  return keys.flatMap((k) => r.measures.filter((m) => m.key === k));
}

/** A link into the company's apps, on the `overthink view` server. */
function appLink(r: Results, link: string | null, text: string): string {
  if (link === null) return '';
  return `<a class="open" href="${esc(r.view.base + link)}">${esc(text)}</a>`;
}

function failuresBlock(r: Results): string {
  if (r.failures.length === 0)
    return '<p class="muted">Nothing the checks look for went wrong. Look at the conversations below anyway: the checks only find what they know to look for.</p>';
  const counts = r.failureCounts
    .map((c) => `<li><a href="#k-${esc(c.kind)}"><b>${c.n}</b> ${esc(c.label)}</a></li>`)
    .join('');
  const seen = new Set<string>();
  const cards = r.failures
    .map((f) => {
      const anchor = seen.has(f.kind) ? '' : ` id="k-${esc(f.kind)}"`;
      seen.add(f.kind);
      const life = [...f.persona.life, ...(f.persona.history !== null ? [f.persona.history] : [])];
      return `<details class="trace fail"${anchor}>
<summary><span class="fid">${esc(f.id)}</span> <span class="who">${esc(f.label)}</span> <span class="topic">${esc(f.customer)} · ${esc(topicLabel(f.topic))} · ${esc(f.channel)} · ${esc(f.date)} · seed ${f.seed}</span> <span class="badge bad">${esc(f.persona.label)}</span></summary>
<div class="why"><p><b>Why:</b> ${esc(f.why)}.</p>${life.length > 0 ? `<p class="small">Persona: ${esc(life.join('; '))}.</p>` : ''}${appLink(r, f.link, 'Open this conversation in the company’s apps')}</div>
<div class="col">${f.conversation.map(line).join('')}</div>
</details>`;
    })
    .join('');
  return `<p class="lede">Found by code from the records and the product’s own calls and words. Each one has the persona, the whole conversation with every tool call, why it counts as a failure, and a link that opens it in the company’s apps (start <code>${esc(r.view.command)}</code> first).</p>
<ul class="counts">${counts}</ul>${cards}`;
}

function securityBlock(r: Results): string {
  const s = r.security;
  if (s.attempts === 0)
    return '<p class="muted">No one tried to break the product in this run. A run with more contacts (more days or runs) will include attempts.</p>';
  const rows = s.findings
    .map(
      (f) =>
        `<tr class="${f.held === 'broke' ? 'bad' : ''}"><td>${esc(f.label)}</td><td>${esc(f.attempt.slice(0, 160))}</td><td>${esc(f.calls.map((c) => `${c.name}${c.ok ? '' : ` (${c.code ?? 'failed'})`}`).join(', ') || 'no calls')}</td><td>${esc(heldText(f.held))}${f.failures.length > 0 ? `<br><span class="small">${esc(f.failures.join(', '))}</span>` : ''}</td><td>${appLink(r, f.link, 'open')}</td></tr>`,
    )
    .join('');
  return `<div class="stats">
  <div class="stat"><span class="num">${s.attempts}</span><span class="lbl">attempts</span></div>
  <div class="stat"><span class="num">${s.held}</span><span class="lbl">held</span></div>
  <div class="stat"><span class="num">${s.heldByRules}</span><span class="lbl">held only by the shop’s rules</span><span class="note">the product tried; the engine refused</span></div>
  <div class="stat"><span class="num">${s.broke}</span><span class="lbl">broke</span></div>
</div>
<table class="passk sec"><thead><tr><th>Attempt</th><th>What they said</th><th>What the product did</th><th>Result</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function heldText(h: string): string {
  return h === 'broke' ? 'Broke' : h === 'held_by_rules' ? 'Held by the rules' : 'Held';
}

function situationsBlock(r: Results): string {
  const rows = r.situations
    .map(
      (x) =>
        `<tr><td>${esc(x.label)}</td><td>${esc(x.kind)}</td><td class="n">${x.id === 'plain' ? '–' : `${Math.round(x.rate * 100)}%`}</td><td class="n">${x.contacts}</td><td class="n">${x.withFailures}</td></tr>`,
    )
    .join('');
  return `<table class="passk"><thead><tr><th>Situation</th><th>Kind</th><th class="n">Assumed rate</th><th class="n">Contacts</th><th class="n">With a failure</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function measureCard(m: MeasureResult, n: number): string {
  const d = m.difference;
  const tone =
    d.mean === null || !d.clear ? 'flat' : d.mean > 0 === (m.better === 'up') ? 'good' : 'bad';
  const interval =
    d.interval95 === null
      ? 'one run: no interval'
      : `${fmt(m, d.interval95[0])} to ${fmt(m, d.interval95[1])}`;
  return `<article class="measure ${tone}">
  <h3>${esc(m.label)}</h3>
  <p class="big">${d.mean === null ? '–' : fmt(m, d.mean)}</p>
  <p class="small">95% interval ${esc(interval)}</p>
  ${strip(m)}
  <p class="small">Better in ${d.betterIn} of ${n} · without ${plain(m, m.without)} · with ${plain(m, m.with)}${m.worstSeed !== null ? ` · worst seed ${m.worstSeed.seed}` : ''}</p>
</article>`;
}

/** A strip plot of per-run differences around zero, with the interval as a band. Inline SVG, no script. */
function strip(m: MeasureResult): string {
  const xs = m.perSeed.map((p) => p.difference);
  const band = m.difference.interval95;
  const all = [0, ...xs, ...(band ?? [])];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const w = 240;
  const x = (v: number): number => 8 + ((v - lo) / span) * (w - 16);
  const dots = m.perSeed
    .map(
      (p, i) =>
        `<circle cx="${x(p.difference).toFixed(1)}" cy="${(14 + ((i * 7) % 9) - 4).toFixed(1)}" r="3"><title>seed ${p.seed}: ${esc(fmt(m, p.difference))}</title></circle>`,
    )
    .join('');
  const bandRect =
    band === null
      ? ''
      : `<rect class="band" x="${x(band[0]).toFixed(1)}" y="4" width="${Math.max(2, x(band[1]) - x(band[0])).toFixed(1)}" height="20" rx="3"/>`;
  return `<svg class="strip" viewBox="0 0 ${w} 28" role="img" aria-label="Per-run differences for ${esc(m.label)}">${bandRect}<line class="zero" x1="${x(0).toFixed(1)}" x2="${x(0).toFixed(1)}" y1="2" y2="26"/>${dots}</svg>`;
}

function productBlock(r: Results): string {
  const p = r.product;
  const cell = (label: string, value: number, note = ''): string =>
    `<div class="stat"><span class="num">${value}</span><span class="lbl">${esc(label)}</span>${note !== '' ? `<span class="note">${esc(note)}</span>` : ''}</div>`;
  const rows = p.passK
    .map(
      (x) =>
        `<tr><td>${esc(topicLabel(x.topic))}</td><td class="n">${x.n}</td><td class="n">${pct(x.pass1)}</td><td class="n">${pct(x.passK)}</td></tr>`,
    )
    .join('');
  return `<div class="stats">
  ${cell('contacts handled', p.contacts)}
  ${cell('sorted by the product alone', p.resolvedAlone)}
  ${cell('handed to a person', p.handedOver)}
  ${cell('customers who gave up', p.customersGaveUp)}
  ${cell('wrong actions', p.wrongActions, 'changed what nobody asked for')}
  ${cell('calls refused by the rules', p.refusedCalls, 'role, scope or policy')}
  ${cell('product errors', p.productErrors)}
  ${cell('customers overruled by the records', p.overruledCustomers, 'said it was sorted when it was not')}
</div>
${rows === '' ? '' : `<table class="passk"><caption>Reliability by kind of contact. pass^${PASS_K} is the chance that ${PASS_K} such contacts in a row are all sorted (resolved or properly handed over, and the customer stayed).</caption><thead><tr><th>Kind</th><th class="n">Contacts</th><th class="n">pass^1</th><th class="n">pass^${PASS_K}</th></tr></thead><tbody>${rows}</tbody></table>`}`;
}

function tracePair(p: TracePair, open: boolean): string {
  const w = p.with;
  const badge = (t: Transcript): string =>
    `<span class="badge ${outcomeTone(t)}">${esc(outcomeText(t))}</span>`;
  const withoutCol =
    p.without === null
      ? '<p class="muted">This contact did not happen without the product (the runs had drifted apart by then).</p>'
      : `${p.without.lines.map(line).join('')}${staffNote(p.without)}`;
  return `<details class="trace"${open ? ' open' : ''}>
<summary><span class="who">${esc(p.customer)}</span> <span class="topic">${esc(topicLabel(p.topic))} · ${esc(w.channel)} · ${esc(w.date)} · seed ${p.seed}</span> ${badge(w)}</summary>
<div class="cols">
  <div class="col"><h4>Without the product</h4>${withoutCol}</div>
  <div class="col"><h4>With the product</h4>${w.lines.map(line).join('')}${staffNote(w)}</div>
</div>
</details>`;
}

function line(l: TranscriptLine): string {
  if (l.from === 'tool' && l.call !== undefined) {
    const c = l.call;
    const state = c.ok ? 'ok' : c.refused ? 'refused' : 'failed';
    return `<div class="call ${state}"><code>${esc(c.name)}(${esc(JSON.stringify(c.arguments))})</code><span class="state">${c.ok ? 'ok' : esc(c.code ?? 'failed')}</span>${l.text !== '' ? `<pre>${esc(l.text)}</pre>` : ''}</div>`;
  }
  if (l.from === 'note') return `<p class="note-line">${esc(l.text)}</p>`;
  const clamp =
    (l.clamped?.length ?? 0) > 0
      ? `<span class="clamp" title="${esc((l.clamped ?? []).join('; '))}">code adjusted</span>`
      : '';
  return `<div class="msg ${l.from}"><p>${esc(l.text)}</p>${l.tone !== undefined ? `<span class="tone">${esc(l.tone)}</span>` : ''}${clamp}</div>`;
}

function staffNote(t: Transcript): string {
  if (t.staff === null) return '';
  const s = t.staff;
  const when =
    s.first_reply_minutes !== null
      ? `, first reply after ${Math.round(s.first_reply_minutes)} working minutes`
      : '';
  return `<p class="note-line">Record: ${esc(s.outcome.replaceAll('_', ' '))}${s.handled_by !== null ? ` by ${esc(s.handled_by)}` : ''}${esc(when)}.</p>`;
}

function outcomeText(t: Transcript): string {
  if (t.ending === 'product_error') return 'product error';
  if (t.verdict === 'wrong_action') return 'wrong action';
  if (t.ending === 'gave_up') return 'customer gave up';
  if (t.verdict === 'resolved') return 'sorted';
  if (t.verdict === 'handed_over') return 'handed over';
  return t.verdict ?? t.ending;
}

function outcomeTone(t: Transcript): string {
  if (t.ending === 'product_error' || t.verdict === 'wrong_action' || t.ending === 'gave_up')
    return 'bad';
  return t.verdict === 'resolved' || t.verdict === 'handed_over' ? 'good' : 'flat';
}

function topicLabel(topic: string): string {
  const s = topic.replaceAll('_', ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmt(m: MeasureResult, v: number): string {
  if (m.unit === '£') return signedMoney(v);
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±';
  const abs = Math.abs(v);
  if (m.unit === 'share') return `${sign}${(abs * 100).toFixed(1)} pts`;
  const digits = m.unit === '/5' || m.key === 'reputation' ? 2 : 1;
  return `${sign}${abs.toFixed(digits)}${m.unit === 'h' ? ' h' : m.unit === 'min' ? ' min' : ''}`;
}

function plain(m: MeasureResult, v: number | null): string {
  if (v === null) return '–';
  if (m.unit === '£') return `£${Math.round(v).toLocaleString('en-GB')}`;
  if (m.unit === 'share') return `${(v * 100).toFixed(0)}%`;
  return `${Number(v.toFixed(2)).toLocaleString('en-GB')}${m.unit === '/5' ? '/5' : m.unit === 'h' ? ' h' : m.unit === 'min' ? ' min' : ''}`;
}

function pct(x: number | null): string {
  return x === null ? '–' : `${Math.round(x * 100)}%`;
}

/** Escapes text for HTML content and attribute values. */
export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c] ?? c,
  );
}

const CSS = `
:root{--bg:#f7f5f0;--paper:#fffdf8;--ink:#1d1b17;--muted:#6b665c;--line:#e3ded3;--good:#1f7a4d;--good-bg:#e6f3ec;--bad:#b3412e;--bad-bg:#f8e7e3;--flat:#6b665c;--flat-bg:#efece5;--accent:#2f4bd8;--band:rgba(47,75,216,.14);--cust:#eef0fb;--prod:#fffdf8}
@media (prefers-color-scheme:dark){:root{--bg:#141311;--paper:#1c1a17;--ink:#ece8df;--muted:#a39d91;--line:#34302a;--good:#6fd3a0;--good-bg:#1b2c23;--bad:#f0907d;--bad-bg:#3a201b;--flat:#a39d91;--flat-bg:#26231f;--accent:#8fa2ff;--band:rgba(143,162,255,.18);--cust:#1f2233;--prod:#1c1a17}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1080px;margin:0 auto;padding:56px 24px 80px}
h1,h2,h3{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;font-weight:600;letter-spacing:-.01em}
h1{font-size:clamp(26px,3.2vw,38px);line-height:1.15;margin:.2em 0 .4em;max-width:30ch}
h2{font-size:26px;margin:0 0 .3em}
h3{font-size:15px;font-family:inherit;font-weight:600;margin:0;color:var(--muted)}
section{margin-top:64px}
.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:12px;color:var(--muted);margin:0}
.meta,.lede,.muted,.small{color:var(--muted)}
.lede{max-width:68ch;margin:0 0 24px}
.small{font-size:13px;margin:4px 0 0}
.warn{background:var(--bad-bg);color:var(--bad);padding:8px 12px;border-radius:8px;display:inline-block}
.measures{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.measure{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px}
.big{font:600 30px/1.1 "Iowan Old Style",Georgia,serif;margin:8px 0 0;font-variant-numeric:tabular-nums}
.measure.good .big{color:var(--good)}.measure.bad .big{color:var(--bad)}.measure.flat .big{color:var(--ink)}
.strip{width:100%;height:28px;margin-top:8px;display:block}
.strip circle{fill:var(--accent)}.strip .zero{stroke:var(--muted);stroke-dasharray:2 2}.strip .band{fill:var(--band)}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
.stat{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column}
.num{font:600 28px/1.1 "Iowan Old Style",Georgia,serif;font-variant-numeric:tabular-nums}
.lbl{font-size:14px}.note{font-size:12px;color:var(--muted)}
table.passk{margin-top:24px;border-collapse:collapse;width:100%;max-width:640px;font-variant-numeric:tabular-nums}
.passk caption{text-align:left;color:var(--muted);font-size:13px;padding-bottom:8px}
.passk th,.passk td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left}.passk .n{text-align:right}
.trace{background:var(--paper);border:1px solid var(--line);border-radius:12px;margin:10px 0;overflow:hidden}
.trace summary{cursor:pointer;padding:14px 16px;display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
.who{font-weight:600}.topic{color:var(--muted);font-size:14px}
.badge{margin-left:auto;font-size:12px;padding:2px 8px;border-radius:99px}
.badge.good{background:var(--good-bg);color:var(--good)}.badge.bad{background:var(--bad-bg);color:var(--bad)}.badge.flat{background:var(--flat-bg);color:var(--flat)}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid var(--line)}
.col{padding:16px;min-width:0}.col+.col{border-left:1px solid var(--line)}
h4{margin:0 0 12px;font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}
.msg{border-radius:12px;padding:10px 12px;margin:8px 0;border:1px solid var(--line);position:relative}
.msg p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.msg.customer{background:var(--cust);margin-right:12%}
.msg.product{background:var(--prod);margin-left:12%}
.tone,.clamp{font-size:11px;color:var(--muted);margin-right:8px}
.clamp{color:var(--accent);cursor:help}
.call{font-size:12px;margin:6px 0 6px 12%;padding:6px 10px;border-left:3px solid var(--good);background:var(--flat-bg);border-radius:4px}
.call.refused{border-color:var(--bad)}.call.failed{border-color:var(--muted)}
.call code{word-break:break-all}.call .state{float:right;color:var(--muted)}
.call pre{margin:4px 0 0;white-space:pre-wrap;word-break:break-all;color:var(--muted);max-height:6em;overflow:auto}
.note-line{font-size:13px;color:var(--muted);font-style:italic;margin:8px 0}
footer{margin-top:72px;border-top:1px solid var(--line);padding-top:24px}
.caveat{font-family:"Iowan Old Style",Georgia,serif;font-size:20px;margin:0 0 16px}
.repro{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;font-size:13px;color:var(--muted);margin:0}
.repro dt{font-weight:600}.repro dd{margin:0}
h3.sub{margin:28px 0 12px}
.counts{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}
.counts a{display:inline-block;background:var(--bad-bg);color:var(--bad);padding:4px 10px;border-radius:99px;text-decoration:none;font-size:14px}
.fid{font:600 12px ui-monospace,monospace;color:var(--muted)}
.why{padding:0 16px 8px;border-top:1px solid var(--line)}.why p{margin:10px 0 4px}
.open{display:inline-block;margin:6px 0 4px;color:var(--accent);font-weight:600}
.sec td{vertical-align:top;font-size:14px}.sec tr.bad td{color:var(--bad)}
@media (max-width:720px){main{padding:32px 16px 64px}.cols{grid-template-columns:1fr}.col+.col{border-left:0;border-top:1px solid var(--line)}.msg.customer{margin-right:0}.msg.product{margin-left:0}.call{margin-left:0}}
`;
