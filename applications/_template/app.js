// A small working app to copy. It lists the shop's suppliers, opens one in a slide-over, and redraws itself
// when a day passes or an outside AI changes something. Copy the folder, change APP_ID, change the tool.
import { startApp, esc, avatar, emptyState, skeleton, slideOver, stagger, toast, plural } from "../lib/ui.js";
import { isScreenRead } from "../lib/client.js";
import { personFor } from "../lib/people.js";

// The id of this app in applications/apps.json. Its name, colour and icon all come from there.
const APP_ID = "_template";

const { world, app } = await startApp({ id: APP_ID });
document.title = `${app.name} · Overthought & Co.`;
document.getElementById("title").textContent = app.name;
document.getElementById("lede").textContent = app.description || "Everyone who sells to the shop. Pick one to see the details.";

/** Draws the list. `screen: true` because this read only draws the screen; it is left out of the record. */
async function paint() {
  const list = document.getElementById("list");
  if (!list.children.length) list.innerHTML = `<li>${skeleton(4)}</li>`;
  const res = await world.call("list_suppliers", {}, { screen: true });
  if (!res.ok) {
    // A refusal is an answer, not a crash: the person at the computer may not be allowed to see this.
    // The engine's own message names tools and roles; a person reads a plain sentence instead.
    const who = personFor(world.role).name;
    list.innerHTML = `<li class="tpl-empty">${emptyState({ title: "Not for this desk.", text: `${who} cannot see this. That is the rules, not a fault.` })}</li>`;
    return;
  }
  const suppliers = res.data.suppliers || [];
  list.innerHTML = suppliers.length
    ? suppliers.map((s) => `<li><button class="tpl-row" data-id="${esc(s.id)}">
        ${avatar(s.name, { size: 38 })}
        <span class="tpl-text"><b>${esc(s.name)}</b><small>${esc(s.town)}, ${esc(plural(s.lead_time_days, "day"))} to deliver</small></span>
      </button></li>`).join("")
    : `<li class="tpl-empty">${emptyState({ title: "No suppliers yet.", text: "The shop is buying from nobody, which is cheaper but limiting." })}</li>`;
  stagger(list);
  list.querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", () => open(suppliers.find((s) => s.id === b.dataset.id))));
}

/** One supplier in a slide-over. */
function open(s) {
  slideOver({
    title: s.name,
    body: `<ul class="list">
      <li><span class="grow muted">Where</span><b>${esc(s.town)}, ${esc(s.country)}</b></li>
      <li><span class="grow muted">Delivery takes</span><b>${esc(plural(s.lead_time_days, "day"))}</b></li>
      <li><span class="grow muted">Smallest order</span><b>${esc(s.min_order_qty)}</b></li>
      <li><span class="grow muted">Things they make for us</span><b>${esc((s.skus || []).length)}</b></li>
    </ul>`,
  });
}

await paint();

// Stay live: redraw when time moves, when you change who you are, and when anyone (you elsewhere, or an AI) changes something.
document.addEventListener("ot:day", () => paint());
document.addEventListener("ot:role", () => { paint(); toast("This screen now shows what that person can see."); });
world.onChange((change) => { if (change.reset || change.entries.some((e) => !isScreenRead(e))) paint(); });
