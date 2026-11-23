// The living map: the company at the centre, rings of the world around it, ink lines on paper. When days run, a
// small spark travels along a real link for each real thing that happened (an order, a parcel, a story).
// On a narrow screen it becomes the same rings as a stacked list. With reduced motion there are no pulses.
import { esc } from "../lib/ui.js";
import { SPIRAL_PATH } from "../lib/icons.js";

const NS = "http://www.w3.org/2000/svg";
const SIZE = 1000;
const C = SIZE / 2;
// Ring radii, inside out: team, customers and communities, suppliers and partners, competitors, institutions, forces.
const RADII = { team: 118, customers: 212, suppliers: 300, competitors: 372, institutions: 428, forces: 478 };
const OFFSET = { team: 0, customers: 0, suppliers: 0, competitors: 0, institutions: 0, forces: 0 };
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export const hrefOf = (n) => (n.kind === "ring" ? "#/look" : `#/e/${encodeURIComponent(n.kind)}/${encodeURIComponent(n.id)}`);

/**
 * Draws the map into `el`. Returns { pulse(list), update(graph), destroy() }.
 * @param {HTMLElement} el
 * @param {object} graph from /explore/graph
 * @param {{compact?: boolean, onCaption?: function(object): void}} o compact: labels only for the big things
 */
export function drawMap(el, full, { compact = false, onCaption = null } = {}) {
  // On the first screen the busy inner rings are grouped (the team, suppliers, carriers), each a named cluster with
  // its count, so the whole picture reads without hovering. Pulses for a member land on its group.
  const { graph, alias } = compact ? grouped(full) : { graph: full, alias: new Map() };
  el.classList.add("map");
  el.innerHTML = "";
  const pos = new Map(); // "kind:id" -> [x, y]
  const key = (n) => `${n.kind}:${n.id}`;
  pos.set("company:overthought", [C, C]);

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", "The world around Overthought & Co.: the team, customers, suppliers, competitors, institutions and outside forces");
  const gRings = g("map-rings"), gLinks = g("map-links"), gPulses = g("map-pulses"), gNodes = g("map-nodes");
  svg.append(gRings, gLinks, gPulses, gNodes);

  const maxCount = Math.max(1, ...graph.links.map((l) => l.count || 0));
  for (const ring of graph.rings) {
    const r = RADII[ring.id];
    const circle = el_("circle", { cx: C, cy: C, r, class: "map-ring" });
    gRings.append(circle);
    // The ring's name, set on the ring at the top, a little to the left.
    const label = el_("text", { x: C, y: C - r + 4, class: "map-ring-label", "text-anchor": "middle" });
    // The ring says what its dots are and how many, so nothing needs a hover to be understood.
    const n0 = ring.nodes.reduce((n, x) => n + (x.kind === "group" ? x.count : 1), 0);
    label.textContent = ring.id === "customers" ? `${ring.label} · ${(graph.totals.customers || 0).toLocaleString("en-GB")} people` : ring.id === "forces" ? ring.label : `${ring.label} · ${n0}`;
    gRings.append(label);
    const n = ring.nodes.length;
    const spacing = (2 * Math.PI * r) / Math.max(1, n);
    ring.nodes.forEach((node, i) => {
      // Nodes share the circle except a gap at the top, where the ring's name sits.
      const GAP = 26;
      const a = ((-90 + GAP / 2 + ((i + 0.5) * (360 - GAP)) / n + (OFFSET[ring.id] + 90) * 0) * Math.PI) / 180;
      const x = C + r * Math.cos(a), y = C + r * Math.sin(a);
      pos.set(key(node), [x, y]);
      const link = graph.links.find((l) => l.from.kind === "company" && l.to.kind === node.kind && l.to.id === node.id);
      const w = link?.count ? 0.6 + 2.4 * Math.sqrt(link.count / maxCount) : 0.6;
      gLinks.append(el_("line", { x1: C, y1: C, x2: x, y2: y, class: "map-link", "stroke-width": w.toFixed(2) }));
      const dot = node.count ? 4 + Math.min(16, Math.sqrt(node.count) * 0.9) : 5;
      const a_ = document.createElementNS(NS, "a");
      a_.setAttribute("href", hrefOf(node));
      a_.setAttribute("class", `map-node is-${ring.id}${node.cluster ? " is-cluster" : ""}`);
      a_.setAttribute("aria-label", `${node.title}${node.count != null ? `, ${node.count.toLocaleString("en-GB")}` : ""}${node.note ? `, ${node.note}` : ""}`);
      a_.dataset.key = key(node);
      a_.append(el_("circle", { cx: x, cy: y, r: dot + 10, class: "map-hit" }), el_("circle", { cx: x, cy: y, r: dot, class: "map-dot" }));
      // Labels where there is room; elsewhere they show on hover and focus.
      // Always named: the communities, the outside forces and the competitors (few, and the story is there).
      // The rest show their names on hover and focus, so the picture stays calm.
      const room = (node.cluster || ["competitors", "institutions"].includes(ring.id) || (!compact && ring.id === "suppliers")) && spacing > (compact ? 100 : 84);
      const right = Math.cos(a) >= -0.05;
      const t = el_("text", { x: x + (right ? dot + 7 : -dot - 7), y: y + 4.5, class: `map-label${room ? "" : " is-hover"}`, "text-anchor": right ? "start" : "end" });
      t.textContent = shorten(node.title, compact ? 22 : 30);
      if (node.count != null && node.cluster) {
        const c = document.createElementNS(NS, "tspan");
        c.setAttribute("class", "map-count");
        c.textContent = `  ${node.count.toLocaleString("en-GB")}`;
        t.append(c);
      }
      a_.append(t);
      gNodes.append(a_);
    });
  }
  // The company: the spiral in a ringed circle.
  const centre = document.createElementNS(NS, "a");
  centre.setAttribute("href", "#/e/company/overthought");
  centre.setAttribute("class", "map-centre");
  centre.setAttribute("aria-label", "Overthought & Co., the business");
  centre.append(el_("circle", { cx: C, cy: C, r: 38, class: "map-centre-ring" }));
  const spiral = el_("path", { d: SPIRAL_PATH, class: "map-spiral", transform: `translate(${C - 24} ${C - 24}) scale(2)` });
  centre.append(spiral);
  const name = el_("text", { x: C, y: C + 62, class: "map-centre-name", "text-anchor": "middle" });
  name.textContent = graph.centre.title;
  centre.append(name);
  gNodes.append(centre);
  el.append(svg);

  // The phone version: the same rings, as lists.
  const list = document.createElement("div");
  list.className = "map-list";
  list.innerHTML = graph.rings.map((r) => `<section><h3 class="map-list-h">${esc(r.label)}</h3><ul>${r.nodes.map((n) => `<li><a href="${esc(hrefOf(n))}"><span>${esc(n.title)}</span>${n.count != null ? `<span class="pm-mono">${n.count.toLocaleString("en-GB")}</span>` : n.note ? `<span class="pm-mono">${esc(n.note)}</span>` : ""}</a></li>`).join("")}</ul></section>`).join("");
  el.append(list);

  let alive = true;
  let queue = [];
  let timer = null;

  /** Where a pulse starts or ends: a node, or (for "the customers") a community chosen by the pulse's own text. */
  function at(n, seed) {
    if (n.kind === "ring") {
      const ring = graph.rings.find((r) => r.id === n.id);
      const pick = ring?.nodes[Math.abs(hash(seed)) % Math.max(1, ring.nodes.length)];
      return pick ? pos.get(key(pick)) : null;
    }
    return pos.get(alias.get(key(n)) || key(n));
  }

  function fly(p) {
    const a = at(p.from, p.text), b = at(p.to, p.text);
    if (!a || !b || !alive) return;
    const dot = el_("circle", { cx: a[0], cy: a[1], r: 4.5, class: `map-pulse is-${p.kind}` });
    gPulses.append(dot);
    // Through the centre when neither end is the company: everything here goes through the business.
    const via = p.from.kind !== "company" && p.to.kind !== "company" && p.from.kind !== "force" ? [[C, C]] : [];
    const pts = [a, ...via, b];
    const ms = 1100 + 300 * via.length;
    const t0 = performance.now();
    const step = (now) => {
      if (!alive) return dot.remove();
      const k = Math.min(1, (now - t0) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const seg = e * (pts.length - 1);
      const i = Math.min(pts.length - 2, Math.floor(seg));
      const f = seg - i;
      dot.setAttribute("cx", pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f);
      dot.setAttribute("cy", pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f);
      dot.setAttribute("opacity", String(k > 0.85 ? (1 - k) / 0.15 : 1));
      if (k < 1) requestAnimationFrame(step);
      else {
        dot.remove();
        const target = gNodes.querySelector(`[data-key="${CSS.escape(key(p.to.kind === "ring" ? { kind: "x", id: "x" } : p.to))}"]`);
        target?.classList.add("is-lit");
        setTimeout(() => target?.classList.remove("is-lit"), 600);
      }
    };
    requestAnimationFrame(step);
  }

  return {
    /** Sends real things that happened along their links, spread over about `ms` milliseconds. */
    pulse(list, ms = 1600) {
      if (!list?.length) return;
      if (onCaption) onCaption(list.at(-1), list.length);
      if (reduced()) return;
      queue = queue.concat(list.slice(-40));
      if (timer) return;
      const gap = Math.max(40, ms / Math.max(1, queue.length));
      timer = setInterval(() => {
        const p = queue.shift();
        if (!p || !alive) { clearInterval(timer); timer = null; return; }
        fly(p);
      }, gap);
    },
    destroy() { alive = false; clearInterval(timer); },
  };
}

/** The graph with the team, suppliers and partners grouped into a few named clusters. */
function grouped(graph) {
  const alias = new Map();
  const group = (id, title, members) => {
    for (const m of members) alias.set(`${m.kind}:${m.id}`, `group:${id}`);
    return { kind: "group", id, title, count: members.length, cluster: true };
  };
  const rings = graph.rings.map((r) => {
    if (r.id === "team") return { ...r, nodes: [group("team", "The team", r.nodes)] };
    if (r.id === "suppliers") {
      const sup = r.nodes.filter((n) => n.kind === "supplier");
      const car = r.nodes.filter((n) => n.kind === "org" && n.note === "carrier");
      const rest = r.nodes.filter((n) => n.kind === "org" && n.note !== "carrier");
      return { ...r, nodes: [group("suppliers", "Suppliers", sup), group("carriers", "Carriers", car), group("partners", "Payments, marketplace and ads", rest)].filter((n) => n.count) };
    }
    return r;
  });
  const links = graph.links.map((l) => ({ ...l, to: alias.has(`${l.to.kind}:${l.to.id}`) ? { kind: "group", id: alias.get(`${l.to.kind}:${l.to.id}`).slice(6) } : l.to }));
  const merged = new Map();
  for (const l of links) { const k = `${l.from.kind}:${l.from.id}>${l.to.kind}:${l.to.id}`; const m = merged.get(k); if (m) m.count += l.count; else merged.set(k, { ...l }); }
  return { graph: { ...graph, rings, links: [...merged.values()] }, alias };
}

function g(cls) { const x = document.createElementNS(NS, "g"); x.setAttribute("class", cls); return x; }
function el_(tag, attrs) { const x = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v); return x; }
function shorten(s, n) { return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; }
function hash(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }
