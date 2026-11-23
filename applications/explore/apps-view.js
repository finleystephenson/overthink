// The business's own apps, opened in place. They share this tab's world (the same sandbox), so whatever you do in
// one shows on the map, the timeline and every page here. Always "Name · Plain name".
import { esc, loadApps } from "../lib/ui.js";
import { appIcon } from "../lib/icons.js";

export async function renderApps(main, id) {
  const apps = (await loadApps()).filter((a) => a.status === "ready");
  if (!id) {
    main.innerHTML = `
      <section class="xpage">
        <h1 class="xh1">The apps</h1>
        <p class="xsub">The tools the business runs on. They work on the same world you are exploring.</p>
        <ul class="appgrid">${apps.map((a) => `<li><a class="appcard" href="#/apps/${esc(a.id)}">${appIcon(a, { size: 40 })}<span class="pm-app-name"><b>${esc(a.name)}</b><span>${esc(a.plain)}</span></span><span class="appcard-d">${esc(a.description)}</span></a></li>`).join("")}</ul>
      </section>`;
    return null;
  }
  const a = apps.find((x) => x.id === id);
  if (!a) throw new Error("There is no app by that name.");
  main.innerHTML = `
    <section class="appin">
      <header class="appin-h">
        <a href="#/apps" class="appin-back">← All apps</a>
        ${appIcon(a, { size: 24 })}<span class="pm-app-name"><b>${esc(a.name)}</b><span>${esc(a.plain)}</span></span>
        <a class="appin-own" href="../${esc(a.id)}/" target="_blank" rel="noopener">Open on its own ↗</a>
      </header>
      <iframe class="appin-f" src="../${esc(a.id)}/?embed=1" title="${esc(a.name)} · ${esc(a.plain)}"></iframe>
    </section>`;
  return null;
}
