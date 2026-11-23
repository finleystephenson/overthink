// This world against the same world left alone: what was done, what moved, and who and what was affected, by name.
// Read from the live sandbox (its shadow twin) through client.impact() and the explorer's compare route.
import { esc } from "../lib/ui.js";
import { MEASURES, formatMeasure, toneOf, headline, isSame } from "../lib/impact.js";
import { world, ex } from "./api.js";
import { refRow, dateWords, onMoved } from "./parts.js";

const SHOW = ["net_profit", "revenue", "orders", "customer_satisfaction", "complaints", "first_response_minutes", "lost_sales", "refunds", "social_reach", "followers", "staff_task_hours"];

export async function renderChanged(main) {
  const paint = async () => {
    const [imp, cmp] = await Promise.all([world.impact(), ex("compare")]);
    const same = !imp.available || !imp.days_compared || isSame(imp);
    const h = imp.available ? headline(imp) : { text: "This server cannot compare yet." };
    const rows = SHOW.filter((k) => imp.measures?.[k] && Math.abs(imp.measures[k].difference || 0) >= 0.005);
    main.innerHTML = `
      <section class="xpage ch">
        <p class="pm-label">Against the world left alone${cmp.started ? ` · ${esc(dateWords(cmp.from))} to ${esc(dateWords(cmp.to))}` : ""}</p>
        <h1 class="xh1">${same ? "Nothing here differs from the world left alone yet." : esc(h.text)}</h1>
        <p class="xsub">Your world runs beside a twin: the same start and the same luck, with nothing changed. Anything different comes from what was done.</p>
        ${same ? `<p><a class="pm-pill small" href="#/whatif">Try a what-if</a></p>` : ""}
        ${rows.length ? `<table class="figs"><thead><tr><th scope="col">Measure</th><th scope="col">Your world</th><th scope="col">Left alone</th><th scope="col">Difference</th></tr></thead><tbody>
          ${rows.map((k) => { const m = imp.measures[k]; const d = m.difference; return `<tr class="is-${toneOf(k, d)}"><th scope="row">${esc(MEASURES[k]?.label || k)}</th><td>${esc(formatMeasure(k, m.live))}</td><td>${esc(formatMeasure(k, m.shadow))}</td><td>${d > 0 ? "+" : "−"}${esc(formatMeasure(k, Math.abs(d)))}</td></tr>`; }).join("")}</tbody></table>` : ""}
        <div class="wi-cols">
          <section><h2 class="xh2">What was done</h2>
            ${cmp.changes?.length ? `<ul class="xrows">${cmp.changes.map(refRow).join("")}</ul>` : `<p class="xempty">Nothing yet.</p>`}
            ${cmp.events?.length ? `<h3 class="xh3">Events only in your world</h3><ul class="xrows">${cmp.events.map(refRow).join("")}</ul>` : ""}
            ${cmp.why?.length ? `<h3 class="xh3">What the world says moved it</h3><ul class="plain-list">${cmp.why.map((w) => `<li>${esc(w.because)} <span class="pm-mono">${w.days} days</span></li>`).join("")}</ul>` : ""}
            ${cmp.products?.length ? `<h3 class="xh3">Products</h3><ul class="xrows">${cmp.products.map(refRow).join("")}</ul>` : ""}
          </section>
          <section><h2 class="xh2">Who was affected</h2>
            ${cmp.people?.length ? `<p class="xsub">${cmp.people_affected} customers did something different from their twin in the world left alone.</p><ul class="xrows">${cmp.people.map((p) => (p.kind ? refRow(p) : `<li><span class="xr"><span class="xr-t">${esc(p.title)}</span><span class="xr-n">${esc(p.note)}</span></span></li>`)).join("")}</ul>` : `<p class="xempty">${cmp.started ? "Nobody yet." : "Move the clock on to see."}</p>`}
          </section>
        </div>
      </section>`;
  };
  await paint();
  return { destroy: onMoved(() => paint().catch(() => {})) };
}
