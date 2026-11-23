// Small hand-drawn SVG charts shared by Till, Stockroom, Tally, Megaphone and Rota (moved here from till/chart.js
// and tally/charts.js so there is one copy). The look follows DESIGN.md: marks in ink, a second series in grey,
// the spark only on the point that matters (the latest), no gradients, no gridlines, one baseline, numbers only
// where they help. Every chart reads out any day on hover, touch or the arrow keys. Styles: lib/charts.css.
import { esc } from "./ui.js";

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

/** One line of a hover read-out. */
function row(name, value, color) {
  return `<span class="ch-row"><i style="background:${color}"></i>${esc(name)}<b>${esc(value)}</b></span>`;
}

/**
 * Puts a hover read-out on a chart: pointing (or tabbing) at a point shows its label and values.
 * @param {Element} el the chart box
 * @param {number} count how many points
 * @param {function(number): number} xOf centre of point i, in svg units
 * @param {function(number): string} tipOf trusted HTML for point i
 * @param {number} svgWidth
 * @param {function(number): number=} yOf height of point i, for the dot that follows the pointer
 */
function hover(el, count, xOf, tipOf, svgWidth, yOf) {
  const tip = document.createElement("div");
  tip.className = "ch-tip";
  tip.hidden = true;
  el.append(tip);
  const svg = el.querySelector("svg");
  const guide = svg.querySelector(".ch-guide");
  const dot = svg.querySelector(".ch-dot");
  function show(i) {
    if (i < 0 || i >= count) { hide(); return; }
    tip.innerHTML = tipOf(i);
    tip.hidden = false;
    const scale = svg.getBoundingClientRect().width / svgWidth;
    const x = xOf(i) * scale;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(el.clientWidth - w, x - w / 2))}px`;
    if (guide) { guide.setAttribute("x1", xOf(i)); guide.setAttribute("x2", xOf(i)); guide.style.opacity = "1"; }
    if (dot && yOf) { dot.setAttribute("cx", xOf(i)); dot.setAttribute("cy", yOf(i)); dot.style.opacity = "1"; }
    el.querySelectorAll("[data-i]").forEach((b) => b.classList.toggle("is-hot", Number(b.dataset.i) === i));
  }
  function hide() {
    tip.hidden = true;
    if (guide) guide.style.opacity = "0";
    if (dot) dot.style.opacity = "0";
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
  // Keyboard: the chart is one stop; arrows walk the points.
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
 * One value per day as a thin ink line, the latest point marked with the spark and labelled, the peak labelled.
 * (The old version had a gradient area under it; DESIGN.md rule: no gradient fills.)
 * @param {Element} el where the chart goes (its width sets the drawing's width)
 * @param {{values: Array<number>, labels: Array<string>, fmt?: function(number): string,
 *   tip?: function(number): string, height?: number}} p
 */
export function lineArea(el, { values, labels, fmt = String, tip, height = 200 }) {
  const W = widthOf(el), H = height, L = 4, R = 64, T = 26, B = 26;
  const hi = Math.max(1, ...values);
  const n = values.length;
  const X = (i) => L + (n < 2 ? 0 : (i / (n - 1)) * (W - L - R));
  const Y = (v) => T + (1 - v / hi) * (H - T - B);
  const d = values.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
  const last = n - 1;
  const peak = values.reduce((m, v, i) => (v > values[m] ? i : m), 0);
  const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 90))));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(labels[0] || "")} to ${esc(labels[last] || "")}">`;
  s += `<line class="ch-base" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  s += `<line class="ch-guide" x1="0" x2="0" y1="${T - 8}" y2="${H - B}"/>`;
  s += `<path class="ch-line" d="${d}"/>`;
  for (let i = 0; i < n; i += every) s += `<text class="ch-ax" x="${X(i)}" y="${H - 7}" text-anchor="${i === 0 ? "start" : "middle"}">${esc(labels[i])}</text>`;
  if (peak !== last && values[peak] > 0) s += `<circle class="ch-pt" cx="${X(peak)}" cy="${Y(values[peak])}" r="3"/><text class="ch-lbl" x="${X(peak)}" y="${Y(values[peak]) - 9}" text-anchor="middle">${esc(fmt(values[peak]))}</text>`;
  if (n) s += `<circle class="ch-now" cx="${X(last)}" cy="${Y(values[last])}" r="4"/><text class="ch-lbl" x="${X(last) + 10}" y="${Y(values[last]) + 4}">${esc(fmt(values[last]))}</text>`;
  s += `<circle class="ch-dot" r="4" cx="0" cy="0"/></svg>`;
  el.innerHTML = s;
  el.classList.add("ch");
  hover(el, n, X, tip || ((i) => `<b>${esc(labels[i])}</b>${esc(fmt(values[i]))}`), W, (i) => Y(values[i]));
}

/**
 * Columns over time, with an optional line on top. Negative columns hang below the baseline.
 * Colours: pass CSS colours; use var(--chart-you) (ink) for the main series and var(--chart-alone) (grey) for a second.
 * @param {Element} el
 * @param {{labels: Array<string>, columns: Array<{name: string, values: Array<number>, color: string, negColor?: string}>,
 *   line?: {name: string, values: Array<number>, color: string}, fmt: function(number): string,
 *   xFmt?: function(string, number): string, tip?: function(number): string, height?: number, title: string, stack?: boolean}} spec
 *   stack: the columns sit on top of each other (parts of one whole), all positive.
 */
export function columns(el, spec) {
  const { labels, columns: cols, line, fmt, xFmt = (l) => l, height = 240, title, stack = false } = spec;
  const W = widthOf(el), H = height, L = 4, R = 4, T = 18, B = 26;
  const totals = labels.map((_, i) => cols.reduce((n, c) => n + (c.values[i] || 0), 0));
  const values = [...(stack ? totals : cols.flatMap((c) => c.values)), ...(line ? line.values : [])];
  const [lo, hi] = bounds(values);
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const n = labels.length;
  const slot = (W - L - R) / Math.max(1, n);
  const X = (i) => L + slot * (i + 0.5);
  const gap = Math.min(8, slot * 0.3);
  const bw = Math.max(2, (slot - gap) / (stack ? 1 : cols.length));
  const under = labels.map(() => 0);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
  s += `<line class="ch-guide" x1="0" x2="0" y1="${T - 6}" y2="${H - B}"/>`;
  cols.forEach((c, k) => {
    c.values.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      const x = X(i) - (slot - gap) / 2 + (stack ? 0 : k * bw);
      const b0 = stack ? under[i] : 0;
      if (stack) under[i] += v;
      const y = Math.min(Y(b0 + v), Y(b0));
      const h = Math.max(v === 0 ? 0 : 1.5, Math.abs(Y(b0 + v) - Y(b0)) - (stack && v ? 1 : 0));
      const fill = v < 0 && c.negColor ? c.negColor : c.color;
      s += `<rect class="ch-col" data-i="${i}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - (cols.length > 1 && !stack ? 1.5 : 0)).toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(2, bw / 3).toFixed(1)}" fill="${fill}"/>`;
    });
  });
  s += `<line class="ch-base" x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  if (line) {
    const d = line.values.map((v, i) => (Number.isFinite(v) ? `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}` : "")).join("");
    s += `<path class="ch-line is-thin" d="${d}" style="stroke:${line.color}"/>`;
  }
  const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 74))));
  for (let i = 0; i < n; i += every) s += `<text class="ch-ax" x="${X(i)}" y="${H - 7}" text-anchor="middle">${esc(xFmt(labels[i], i))}</text>`;
  s += `<text class="ch-ax" x="${W - R}" y="${T - 6}" text-anchor="end">${esc(fmt(hi))}</text>`;
  s += "</svg>";
  el.innerHTML = s;
  el.classList.add("ch");
  const tip = spec.tip || ((i) => `<b>${esc(xFmt(labels[i], i, true))}</b>${cols.map((c) => row(c.name, fmt(c.values[i]), c.values[i] < 0 && c.negColor ? c.negColor : c.color)).join("")}${line ? row(line.name, fmt(line.values[i]), line.color) : ""}${stack ? row("In all", fmt(totals[i]), "transparent") : ""}`);
  hover(el, n, X, tip, W);
}

/**
 * A line over time (cash, followers): ink, no fill. The last point is marked with the spark and labelled.
 * @param {Element} el
 * @param {{labels: Array<string>, values: Array<number>, fmt: function(number): string, color?: string,
 *   xFmt?: function(string, number, boolean=): string, height?: number, title: string, zero?: boolean, name?: string}} spec
 */
export function area(el, spec) {
  const { labels, values, fmt, xFmt = (l) => l, height = 200, title, zero = true, name = "" } = spec;
  const W = widthOf(el), H = height, L = 4, R = 4, T = 22, B = 26;
  const [lo, hi] = bounds(values, { zero });
  const n = values.length;
  const X = (i) => L + (n < 2 ? 0 : (i / (n - 1)) * (W - L - R));
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const d = values.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
  const base = Y(Math.max(lo, 0));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
  s += `<line class="ch-guide" x1="0" x2="0" y1="${T - 8}" y2="${H - B}"/>`;
  s += `<line class="ch-base" x1="${L}" x2="${W - R}" y1="${base}" y2="${base}"/>`;
  s += `<path class="ch-line" d="${d}"/>`;
  if (n) s += `<circle class="ch-now" cx="${X(n - 1)}" cy="${Y(values[n - 1])}" r="4"/>`;
  if (lo < 0) s += `<text class="ch-ax" x="${L}" y="${Y(lo) - 4}">${esc(fmt(lo))}</text>`;
  s += `<text class="ch-ax" x="${W - R}" y="${T - 10}" text-anchor="end">${esc(fmt(hi))}</text>`;
  const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 80))));
  for (let i = 0; i < n; i += every) s += `<text class="ch-ax" x="${X(i)}" y="${H - 7}" text-anchor="${i === 0 ? "start" : "middle"}">${esc(xFmt(labels[i], i))}</text>`;
  s += `<circle class="ch-dot" r="4" cx="0" cy="0"/></svg>`;
  el.innerHTML = s;
  el.classList.add("ch");
  hover(el, n, X, (i) => `<b>${esc(xFmt(labels[i], i, true))}</b>${row(name, fmt(values[i]), "var(--x-on-night)")}`, W, (i) => Y(values[i]));
}

/**
 * A tiny line with no axes, for a number's recent shape: ink, the last point in the spark.
 * @param {Array<number>} values
 * @param {{width?: number, height?: number, w?: number, h?: number}=} options
 * @return {string} svg markup
 */
export function spark(values, { width, height, w, h } = {}) {
  const W = width || w || 120, H = height || h || 32;
  if (values.length < 2) return "";
  const lo = Math.min(...values), hi = Math.max(...values);
  const X = (i) => 3 + (i / (values.length - 1)) * (W - 6);
  const Y = (v) => 3 + (1 - (v - lo) / (hi - lo || 1)) * (H - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${d}"/><circle cx="${X(values.length - 1)}" cy="${Y(values.at(-1))}" r="2.5"/></svg>`;
}
