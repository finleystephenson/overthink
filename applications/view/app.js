// The first screen of `overthink view`: the run in a few figures, what went wrong (each with a link to where it
// happened), and the company's apps to walk into. Everything comes from the run's results.json via /view/run.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (x) => `${x < 0 ? "−" : "+"}£${Math.abs(x).toLocaleString("en-GB", { minimumFractionDigits: Math.abs(x) < 100 ? 2 : 0, maximumFractionDigits: Math.abs(x) < 100 ? 2 : 0 })}`;

async function main() {
  const [run, apps] = await Promise.all([
    fetch("/view/run").then((r) => r.json()).then((j) => j.data),
    fetch("/apps/apps.json").then((r) => r.json()).then((j) => j.apps),
  ]);
  const r = run.results;
  if (!r) {
    $("headline").textContent = "This run has no results.json.";
    return;
  }
  $("headline").textContent = r.headline;
  $("meta").textContent = `${r.config.adapter} · ${r.config.days} days · ${r.reproducibility.seeds.length} paired runs · people voiced by ${r.reproducibility.people_model}`;
  $("money").innerHTML = r.measures.filter((m) => m.unit === "£").map((m) => {
    const d = m.difference.mean;
    const tone = d === null || !m.difference.clear ? "" : (d > 0) === (m.better === "up") ? "good" : "bad";
    return `<div class="card ${tone}"><span>${esc(m.label)}</span><b>${d === null ? "–" : money(d)}</b><span>per run, with minus without</span></div>`;
  }).join("");
  $("fails").innerHTML = r.failures.length === 0
    ? "<li>Nothing the checks look for went wrong.</li>"
    : r.failures.slice(0, 25).map((f) => `<li><span class="k">${esc(f.id)} · ${esc(f.label)}</span> <span class="w">${esc(f.persona.label)} · ${esc(f.customer)} · ${esc(f.topic.replaceAll("_", " "))} · run ${f.seed}</span><br>${esc(f.why)}.${f.link ? ` <a href="${esc(f.link)}">Open it</a>` : ""}</li>`).join("");
  const s = r.security;
  $("security").textContent = s.attempts === 0
    ? "Nobody tried to break your AI in this run."
    : `${s.attempts} attempts to break it: held ${s.held}, held only by the shop’s rules ${s.heldByRules}, broke ${s.broke}.`;
  $("apps").innerHTML = apps.filter((a) => a.layer === "business" && a.status === "ready").map((a) =>
    `<li><a href="/apps/${esc(a.id)}/" style="--c:${esc(a.accent)}"><b>${esc(a.name)}</b><span>${esc(a.plain)}</span></a></li>`).join("");
}

main().catch((e) => { $("headline").textContent = `Could not load the run: ${e.message}`; });
