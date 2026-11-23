// Hand-drawn SVG charts. Thin marks, recessive axes, one y-axis, direct labels where they help,
// and a hover layer on every chart (crosshair and tooltip for lines, per-bar tooltip for bars).
// Colours come from CSS variables (--s1…--s6, --s-prev), validated in the README.
import { esc, showTip, hideTip } from "./core.js";

const niceStep = (span, n) => { const raw = span / n, mag = 10 ** Math.floor(Math.log10(raw || 1)); const r = raw / mag; return (r >= 5 ? 10 : r >= 2 ? 5 : r >= 1 ? 2 : 1) * mag; };
function ticks(lo, hi, n = 4) {
  if (lo === hi) hi = lo + 1;
  const step = niceStep(hi - lo, n);
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
  const out = []; for (let v = a; v <= b + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
const width = (el) => Math.max(260, Math.floor(el.clientWidth || el.parentElement?.clientWidth || 600));
const legend = (series) => (series.length < 2 ? "" : `<div class="legend">${series.map((s) => `<span><i class="${s.dash ? "dash" : ""}" style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>`);
const row = (color, name, val, dash) => `<div class="r"><span><i class="dot" style="background:${dash ? "transparent;border:1.5px dashed " + color : color}"></i>${esc(name)}</span><b style="display:inline;margin:0">${esc(val)}</b></div>`;

// A one-line headline worked out from the data, shown above the chart. Two series: the first against the second over the
// points both have. One series: the peak and the latest. Callers can pass their own text, or false for none.
const pctWord = (a, b) => { const c = b ? (a / b - 1) * 100 : 0; return Math.abs(c) < 1 ? "level with" : `${c > 0 ? "up" : "down"} ${Math.round(Math.abs(c))}% on`; };
function headlineFor(h, series, labels, fmt, xFmt, auto) {
  if (h === false) return "";
  if (typeof h === "string") return `<p class="chart-head">${esc(h)}</p>`;
  if (!auto) return "";
  const [a, b] = series;
  if (series.length === 2 && b.values.some((v) => v != null)) {
    const idx = a.values.map((v, i) => i).filter((i) => a.values[i] != null && b.values[i] != null);
    const sa = idx.reduce((n, i) => n + a.values[i], 0), sb = idx.reduce((n, i) => n + b.values[i], 0);
    return idx.length && sb > 0 ? `<p class="chart-head">${esc(a.name)} is ${esc(pctWord(sa, sb))} ${esc(b.name)}</p>` : "";
  }
  if (series.length !== 1) return "";
  const v = a.values, li = v.findLastIndex((x) => x != null), pk = v.reduce((m, x, i) => (x != null && (m < 0 || x > v[m]) ? i : m), -1);
  return pk < 0 ? "" : `<p class="chart-head">Peak ${esc(fmt(v[pk]))} in ${esc(xFmt(labels[pk], pk, true))}, latest ${esc(fmt(v[li]))}</p>`;
}

/** Lines over time. series: [{ name, values, color, dash, area }]. labels: one per point. */
export function lineChart(el, { labels, series, fmt = String, tickFmt, height = 220, xTicks = 6, xFmt = (l) => l, endLabel = true, zero = true, title, headline }) {
  const W = width(el), H = height, L = 12, R = endLabel ? 64 : 14, T = 26, Bm = 24;
  const all = series.flatMap((s) => s.values.filter((v) => v != null));
  const lo = zero ? Math.min(0, ...all) : Math.min(...all); let hi = Math.max(...all, lo); if (hi === lo) hi = lo + 1;
  const ys = ticks(lo, hi);
  const y0 = ys[0], y1 = ys.at(-1);
  const X = (i) => L + (labels.length < 2 ? 0 : (i / (labels.length - 1)) * (W - L - R));
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - Bm);
  const tf = tickFmt || fmt;
  const step = Math.max(1, Math.ceil(labels.length / xTicks));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title || series.map((x) => x.name).join(", "))}">`;
  // no gridlines or value axis: only the peak and the latest point carry a number
  s += `<line class="base" x1="${L}" x2="${W - R}" y1="${Y(Math.max(0, y0))}" y2="${Y(Math.max(0, y0))}"/>`;
  for (let i = 0; i < labels.length; i += step) s += `<text class="ax" x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : "middle"}">${esc(xFmt(labels[i], i))}</text>`;
  for (const se of [...series].reverse()) {
    const pts = se.values.map((v, i) => (v == null ? null : [X(i), Y(v)]));
    let d = "", pen = false;
    for (const p of pts) { if (!p) { pen = false; continue; } d += (pen ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); pen = true; }
    if (se.area) { const f = pts.filter(Boolean); s += `<path d="${d} L${f.at(-1)[0]} ${Y(Math.max(0, y0))} L${f[0][0]} ${Y(Math.max(0, y0))}Z" fill="${se.color}" opacity=".08"/>`; }
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se === series[0] ? 3 : 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (se === series[0] && series.length <= 2) { // the peak of the current period, labelled once
      const pk = se.values.reduce((m, v, i) => (v != null && (m < 0 || v > se.values[m]) ? i : m), -1), li0 = se.values.findLastIndex((v) => v != null);
      if (pk >= 0 && pk !== li0 && pk > 0) s += `<circle cx="${X(pk)}" cy="${Y(se.values[pk])}" r="3.5" fill="${se.color}"/><text class="lbl peak" x="${X(pk)}" y="${Y(se.values[pk]) - 10}" text-anchor="middle">${esc(fmt(se.values[pk]))}</text>`;
    }
    if (endLabel && !se.dash && (se === series[0] || series.length > 2)) { const li = se.values.findLastIndex((v) => v != null); if (li >= 0) s += `<circle cx="${X(li)}" cy="${Y(se.values[li])}" r="3.5" fill="${se.color}" stroke="var(--panel)" stroke-width="2"/><text class="lbl" x="${X(li) + 8}" y="${Y(se.values[li]) + 4}">${esc(fmt(se.values[li]))}</text>`; }
  }
  s += `<line class="xhair" x1="0" x2="0" y1="${T}" y2="${H - Bm}" visibility="hidden"/><g class="dots"></g><rect class="hit" x="${L}" y="0" width="${W - L - R}" height="${H}"/></svg>`;
  el.innerHTML = headlineFor(headline, series, labels, fmt, xFmt, true) + legend(series) + `<div class="chart">${s}</div>`;
  const svg = el.querySelector("svg"), xh = svg.querySelector(".xhair"), dots = svg.querySelector(".dots");
  const move = (e) => {
    const r = svg.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(labels.length - 1, Math.round(((x - L) / (W - L - R)) * (labels.length - 1))));
    xh.setAttribute("x1", X(i)); xh.setAttribute("x2", X(i)); xh.setAttribute("visibility", "visible");
    dots.innerHTML = series.map((se) => (se.values[i] == null ? "" : `<circle cx="${X(i)}" cy="${Y(se.values[i])}" r="4" fill="${se.color}" stroke="var(--panel)" stroke-width="2"/>`)).join("");
    showTip(e, `<b>${esc(xFmt(labels[i], i, true))}</b>${series.map((se) => (se.values[i] == null ? "" : row(se.color, se.tipName ? se.tipName(i) : se.name, fmt(se.values[i]), se.dash))).join("")}`);
  };
  svg.querySelector(".hit").addEventListener("pointermove", move);
  svg.querySelector(".hit").addEventListener("pointerleave", () => { xh.setAttribute("visibility", "hidden"); dots.innerHTML = ""; hideTip(); });
}

/** Vertical bars, one series, optional ghost bars for the previous period. Handles negative values. */
export function barChart(el, { labels, values, prev, color = "var(--s1)", fmt = String, tickFmt, height = 200, xFmt = (l) => l, xTicks = 12, labelBars = false, name = "", prevName = "Previous period", title, onBar, headline }) {
  const W = width(el), H = height, L = 8, R = 8, T = 24, Bm = 24;
  const all = [...values, ...(prev || [])].filter((v) => v != null);
  const ys = ticks(Math.min(0, ...all), Math.max(0, ...all));
  const y0 = ys[0], y1 = ys.at(-1);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - Bm);
  const n = values.length, slot = (W - L - R) / n, bw = Math.max(2, Math.min(42, slot * (prev ? 0.62 : 0.7)));
  const tf = tickFmt || fmt;
  const peakI = values.reduce((m, v, i) => (v != null && (m < 0 || v > values[m]) ? i : m), -1);
  const step = Math.max(1, Math.ceil(n / xTicks));
  const bar = (x, v, w, fill, op = 1) => { const top = Math.min(Y(v), Y(0)), h = Math.max(1, Math.abs(Y(v) - Y(0))), r = Math.min(4, w / 2, h); return v >= 0 ? `<path d="M${x} ${top + h}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + w - r}Q${x + w} ${top} ${x + w} ${top + r}V${top + h}Z" fill="${fill}" opacity="${op}"/>` : `<path d="M${x} ${top}V${top + h - r}Q${x} ${top + h} ${x + r} ${top + h}H${x + w - r}Q${x + w} ${top + h} ${x + w} ${top + h - r}V${top}Z" fill="${fill}" opacity="${op}"/>`; };
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title || name)}">`;
  s += `<line class="base" x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  values.forEach((v, i) => {
    const cx = L + slot * i + slot / 2;
    if (prev && prev[i] != null) s += bar(cx - bw / 2 - bw * 0.18, prev[i], bw, "var(--s-prev)", 0.7);
    if (v != null) s += bar(cx - bw / 2 + (prev ? bw * 0.18 : 0), v, bw, typeof color === "function" ? color(v, i) : color);
    if (v != null && (labelBars || i === peakI || i === n - 1)) // label only the peak and the latest bar
      s += `<text class="lbl" x="${cx}" y="${(v >= 0 ? Y(v) - 5 : Y(v) + 13)}" text-anchor="middle">${esc(fmt(v))}</text>`;
    if (i % step === 0 || n <= xTicks) s += `<text class="ax" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(xFmt(labels[i], i))}</text>`;
    s += `<rect class="hit" data-i="${i}" x="${L + slot * i}" y="0" width="${slot}" height="${H}"/>`;
  });
  s += "</svg>";
  el.innerHTML = (typeof headline === "string" || headline === false ? headlineFor(headline) : prev ? headlineFor(null, [{ name: name || "This period", values }, { name: prevName, values: prev }], labels, fmt, xFmt, true) : headlineFor(null, [{ name: name || "Value", values }], labels, fmt, xFmt, true)) + (prev ? legend([{ name, color: typeof color === "string" ? color : "var(--s1)" }, { name: prevName, color: "var(--s-prev)" }]) : "") + `<div class="chart">${s}</div>`;
  el.querySelectorAll(".hit").forEach((h) => {
    h.addEventListener("pointermove", (e) => { const i = +h.dataset.i; showTip(e, `<b>${esc(xFmt(labels[i], i, true))}</b>${row(typeof color === "string" ? color : "var(--s1)", name || "Value", fmt(values[i]))}${prev && prev[i] != null ? row("var(--s-prev)", prevName, fmt(prev[i])) : ""}`); });
    h.addEventListener("pointerleave", hideTip);
    if (onBar) { h.style.cursor = "pointer"; h.addEventListener("click", () => onBar(+h.dataset.i)); }
  });
}

/** Horizontal bars as HTML rows: name, track, value. Best for ranked lists with long names. */
export function hbars(items, { fmt = String, color = "var(--s1)", max } = {}) {
  const m = max ?? Math.max(...items.map((x) => x.value), 1);
  return `<div class="bars">${items.map((x) => `<${x.href ? `a href="${esc(x.href)}"` : "div"} class="bar-row" title="${esc(x.title || `${x.name}: ${fmt(x.value)}`)}"><span class="name">${x.label || esc(x.name)}</span><span class="track"><span class="fill" style="display:block;width:${Math.max(0.5, (x.value / m) * 100)}%;background:${x.color || color}"></span></span><span class="val">${esc(fmt(x.value))}</span></${x.href ? "a" : "div"}>`).join("")}</div>`;
}

/** One bar split into parts that add up to a whole, with a legend. parts: [{ name, value, color }] */
export function meter(parts, { fmt = String } = {}) {
  const total = parts.reduce((n, p) => n + p.value, 0) || 1;
  return `<div class="meter" role="img" aria-label="${esc(parts.map((p) => `${p.name} ${fmt(p.value)}`).join(", "))}">${parts.filter((p) => p.value > 0).map((p) => `<i style="width:${(p.value / total) * 100}%;background:${p.color}" title="${esc(p.name)}: ${esc(fmt(p.value))}"></i>`).join("")}</div><div class="legend" style="margin:8px 0 0">${parts.filter((p) => p.value > 0).map((p) => `<span><i class="sq" style="background:${p.color}"></i>${esc(p.name)} <b class="tab">${esc(fmt(p.value))}</b></span>`).join("")}</div>`;
}

export const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)"];
