// Small hand-drawn SVG charts for Tally, Megaphone and Rota: columns over time, a filled line, a sparkline.
// Thin marks, no gridlines, one baseline, a number only where it helps, and a hover read-out on every chart.
// WHY here and not in lib/: the shared folder is owned by another builder; these three apps import this file.
// Colours are CSS colours (usually var(--...)), so the charts follow light and dark without redrawing.
import { esc, reducedMotion } from "../lib/ui.js";

/** A round step for an axis: 1, 2 or 5 times a power of ten. */
function niceStep(span, n) {
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const r = raw / mag;
  return (r >= 5 ? 10 : r >= 2 ? 5 : r >= 1 ? 2 : 1) * mag;
}

/** Low and high ends of an axis that includes zero and lands on round numbers. */
function bounds(values, { zero = true } = {}) {
  const all = values.filter((v) => Number.isFinite(v));
  let lo = zero ? Math.min(0, ...all) : Math.min(...all);
  let hi = zero ? Math.max(0, ...all) : Math.max(...all);
  if (!all.length) { lo = 0; hi = 1; }
  if (hi === lo) hi = lo + 1;
  const step = niceStep(hi - lo, 4);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

/** The chart's width: its box, never narrower than a phone. */
function widthOf(el) {
  return Math.max(280, Math.floor(el.clientWidth || el.parentElement?.clientWidth || 600));
}

/**
 * Puts a hover read-out on a chart: pointing (or tabbing) at a column shows its label and values.
 * @param {Element} el the chart box
 * @param {number} count how many columns
 * @param {function(number): number} xOf centre of column i, in svg units
 * @param {function(number): string} tipOf trusted HTML for column i
 * @param {number} svgWidth
 */
function hover(el, count, xOf, tipOf, svgWidth) {
  const tip = document.createElement("div");
  tip.className = "ch-tip";
  tip.hidden = true;
  const guide = el.querySelector(".ch-guide");
  el.append(tip);
  const svg = el.querySelector("svg");
  function show(i) {
    if (i < 0 || i >= count) { hide(); return; }
    tip.innerHTML = tipOf(i);
    tip.hidden = false;
    const scale = svg.getBoundingClientRect().width / svgWidth;
    const x = xOf(i) * scale;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(el.clientWidth - w, x - w / 2))}px`;
    if (guide) { guide.setAttribute("x1", xOf(i)); guide.setAttribute("x2", xOf(i)); guide.style.opacity = "1"; }
    el.querySelectorAll("[data-i]").forEach((b) => b.classList.toggle("is-hot", Number(b.dataset.i) === i));
  }
  function hide() {
    tip.hidden = true;
    if (guide) guide.style.opacity = "0";
    el.querySelectorAll(".is-hot").forEach((b) => b.classList.remove("is-hot"));
  }
  function nearest(clientX) {
    const r = svg.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * svgWidth;
    let best = 0;
    for (let i = 1; i < count; i++) if (Math.abs(xOf(i) - x) < Math.abs(xOf(best) - x)) best = i;
    return best;
  }
  svg.addEventListener("pointermove", (e) => show(nearest(e.clientX)));
  svg.addEventListener("pointerleave", hide);
  // Keyboard: the chart is one stop; arrows walk the columns.
  let at = count - 1;
  svg.setAttribute("tabindex", "0");
  svg.addEventListener("focus", () => show(at));
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") at = Math.max(0, at - 1);
    else if (e.key === "ArrowRight") at = Math.min(count - 1, at + 1);
    else return;
    e.preventDefault();
    show(at);
  });
}

/**
 * Columns over time, with an optional line on top. Negative columns hang below the baseline.
 * @param {Element} el
 * @param {{labels: Array<string>, columns: Array<{name: string, values: Array<number>, color: string, negColor?: string}>,
 *   line?: {name: string, values: Array<number>, color: string}, fmt: function(number): string,
 *   xFmt?: function(string, number): string, tip?: function(number): string, height?: number, title: string, stack?: boolean}} spec
 *   stack: the columns sit on top of each other (parts of one whole, such as visits by channel), all positive.
 */
export function columns(el, spec) {
  const { labels, columns: cols, line, fmt, xFmt = (l) => l, height = 260, title, stack = false } = spec;
  const W = widthOf(el), H = height, L = 8, R = 8, T = 18, B = 26;
  const totals = labels.map((_, i) => cols.reduce((n, c) => n + (c.values[i] || 0), 0));
  const values = [...(stack ? totals : cols.flatMap((c) => c.values)), ...(line ? line.values : [])];
  const [lo, hi] = bounds(values);
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const n = labels.length;
  const slot = (W - L - R) / Math.max(1, n);
  const X = (i) => L + slot * (i + 0.5);
  const gap = Math.min(10, slot * 0.28);
  const bw = Math.max(2, (slot - gap) / (stack ? 1 : cols.length));
  const under = labels.map(() => 0);  // what is already stacked under each column
  const animate = !reducedMotion();
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
  s += `<line class="ch-guide" x1="0" x2="0" y1="${T - 6}" y2="${H - B}" />`;
  cols.forEach((c, k) => {
    c.values.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      const x = X(i) - (slot - gap) / 2 + (stack ? 0 : k * bw);
      const b0 = stack ? under[i] : 0;
      if (stack) under[i] += v;
      const y = Math.min(Y(b0 + v), Y(b0));
      const h = Math.max(v === 0 ? 0 : 1.5, Math.abs(Y(b0 + v) - Y(b0)) - (stack && v ? 1 : 0));
      const fill = v < 0 && c.negColor ? c.negColor : c.color;
      const delay = animate ? ` style="animation-delay:${Math.min(600, i * 14)}ms"` : "";
      s += `<rect class="ch-col${v < 0 ? " is-neg" : ""}" data-i="${i}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - (cols.length > 1 && !stack ? 1.5 : 0)).toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(stack ? 2 : 4, bw / 3).toFixed(1)}" fill="${fill}"${delay}/>`;
    });
  });
  s += `<line class="ch-base" x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  if (line) {
    const d = line.values.map((v, i) => (Number.isFinite(v) ? `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}` : "")).join("");
    s += `<path class="ch-line" d="${d}" stroke="${line.color}"/>`;
    const li = line.values.length - 1;
    if (li >= 0) s += `<circle cx="${X(li)}" cy="${Y(line.values[li])}" r="4" fill="${line.color}" class="ch-end"/>`;
  }
  const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 74))));
  for (let i = 0; i < n; i += every) s += `<text class="ch-ax" x="${X(i)}" y="${H - 7}" text-anchor="middle">${esc(xFmt(labels[i], i))}</text>`;
  s += `<text class="ch-ax ch-top" x="${W - R}" y="${T - 6}" text-anchor="end">${esc(fmt(hi))}</text>`;
  s += "</svg>";
  el.innerHTML = s;
  el.classList.add("ch");
  const tip = spec.tip || ((i) => `<b>${esc(xFmt(labels[i], i, true))}</b>${cols.map((c) => row(c.name, fmt(c.values[i]), c.values[i] < 0 && c.negColor ? c.negColor : c.color)).join("")}${line ? row(line.name, fmt(line.values[i]), line.color) : ""}${stack ? row("In all", fmt(totals[i]), "transparent") : ""}`);
  hover(el, n, X, tip, W);
}

/**
 * A filled line over time (cash, followers). The last point is marked and labelled.
 * @param {Element} el
 * @param {{labels: Array<string>, values: Array<number>, color: string, fmt: function(number): string,
 *   xFmt?: function(string, number, boolean=): string, height?: number, title: string, zero?: boolean, name?: string}} spec
 */
export function area(el, spec) {
  const { labels, values, color, fmt, xFmt = (l) => l, height = 200, title, zero = true, name = "" } = spec;
  const W = widthOf(el), H = height, L = 8, R = 8, T = 22, B = 26;
  const [lo, hi] = bounds(values, { zero });
  const n = values.length;
  const X = (i) => L + (n < 2 ? 0 : (i / (n - 1)) * (W - L - R));
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const pts = values.map((v, i) => [X(i), Y(v)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
  const base = Y(Math.max(lo, 0));
  const gid = `g${Math.random().toString(36).slice(2, 8)}`;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
  s += `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".32"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`;
  s += `<line class="ch-guide" x1="0" x2="0" y1="${T - 8}" y2="${H - B}" />`;
  if (n) s += `<path d="${d}L${pts.at(-1)[0]} ${base}L${pts[0][0]} ${base}Z" fill="url(#${gid})"/>`;
  s += `<line class="ch-base" x1="${L}" x2="${W - R}" y1="${base}" y2="${base}"/>`;
  s += `<path class="ch-line ch-draw" d="${d}" stroke="${color}" pathLength="1"/>`;
  if (n) s += `<circle class="ch-end" cx="${pts.at(-1)[0]}" cy="${pts.at(-1)[1]}" r="4.5" fill="${color}"/>`;
  if (lo < 0) s += `<text class="ch-ax" x="${L}" y="${Y(lo) - 4}">${esc(fmt(lo))}</text>`;
  s += `<text class="ch-ax ch-top" x="${W - R}" y="${T - 10}" text-anchor="end">${esc(fmt(hi))}</text>`;
  const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 80))));
  for (let i = 0; i < n; i += every) s += `<text class="ch-ax" x="${X(i)}" y="${H - 7}" text-anchor="${i === 0 ? "start" : "middle"}">${esc(xFmt(labels[i], i))}</text>`;
  s += "</svg>";
  el.innerHTML = s;
  el.classList.add("ch");
  hover(el, n, X, (i) => `<b>${esc(xFmt(labels[i], i, true))}</b>${row(name, fmt(values[i]), color)}`, W);
}

/**
 * A tiny line with no axes, for a number's recent shape.
 * @param {Array<number>} values
 * @param {{color?: string, width?: number, height?: number}=} options
 * @return {string} svg markup
 */
export function spark(values, { color = "currentColor", width = 120, height = 34 } = {}) {
  if (values.length < 2) return "";
  const lo = Math.min(...values), hi = Math.max(...values);
  const X = (i) => 2 + (i / (values.length - 1)) * (width - 4);
  const Y = (v) => 3 + (1 - (v - lo) / (hi - lo || 1)) * (height - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${X(values.length - 1)}" cy="${Y(values.at(-1))}" r="3" fill="${color}"/></svg>`;
}

/** One line of a hover read-out. */
function row(name, value, color) {
  return `<span class="ch-row"><i style="background:${color}"></i>${esc(name)}<b>${esc(value)}</b></span>`;
}
