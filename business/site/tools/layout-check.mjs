// Layout check: loads every built page in headless Chrome at 15 widths (and zoomed at 125% and 150%), with a 5-item bag
// in the bag and checkout, and reports text that overlaps, is clipped, pokes out of its card or off the page, sits on a
// picture, or hides under a sticky panel. Exits 1 when it finds problems.
// Usage: node business/site/tools/layout-check.mjs [folder, default business/site/dist] [--hero (home hero only)] [--only index.html,bag.html] [--shot page.html@390[@1.25]] [--hero-shots dir]
import { createServer } from "node:http";
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const only = flag("--only")?.split(",");
const shot = flag("--shot");
const heroShots = resolve(flag("--hero-shots") || join(tmpdir(), "ot-hero-shots"));
const heroOnly = args.includes("--hero"); if (heroOnly) args.splice(args.indexOf("--hero"), 1);
const dir = resolve(args[0] || join(here, "..", "dist"));
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Widths with a typical screen height for each, then zoomed desktop browsers (CSS width = window width / zoom).
const HEIGHTS = { 320: 568, 360: 740, 390: 844, 414: 896, 600: 960, 768: 1024, 820: 1180, 1024: 768, 1180: 820, 1280: 800, 1366: 768, 1440: 900, 1536: 864, 1728: 1117, 1920: 1080 };
const VIEWS = [...Object.entries(HEIGHTS).map(([w, h]) => ({ w: +w, h, z: 1 })), ...[1280, 1440].flatMap((w) => [1.25, 1.5].map((z) => ({ w, h: HEIGHTS[w], z })))];
const viewName = (v) => (v.z === 1 ? `${v.w}` : `${v.w}@${v.z * 100}%`);

// ---------- a tiny static server for the folder ----------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".txt": "text/plain" };
const server = createServer((req, res) => {
  const p = join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (!p.startsWith(dir) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" }); res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// ---------- Chrome over the DevTools protocol ----------
const profile = mkdtempSync(join(tmpdir(), "ot-layout-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--force-color-profile=srgb", "about:blank"], { stdio: "ignore" });
let port;
for (let i = 0; i < 100 && !port; i++) { await new Promise((r) => setTimeout(r, 100)); try { port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch {} }
const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let nextId = 0; const waiting = new Map(), listeners = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { const { ok, bad } = waiting.get(m.id); waiting.delete(m.id); m.error ? bad(new Error(m.error.message)) : ok(m.result); }
  else listeners.forEach((f) => f(m));
});
const send = (method, params = {}, sessionId) => new Promise((ok, bad) => { const id = ++nextId; waiting.set(id, { ok, bad }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const cmd = (m, p) => send(m, p, S);
await cmd("Page.enable"); await cmd("Runtime.enable"); await cmd("Log.enable");
const consoleErrors = [];
listeners.push((m) => {
  if (m.sessionId !== S) return;
  if (m.method === "Runtime.exceptionThrown") consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error" && !/favicon|fonts\.g/.test(m.params.entry.url || "")) consoleErrors.push(`${m.params.entry.text} ${m.params.entry.url || ""}`);
});
const evaluate = async (expr) => { const r = await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const frames = () => evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
const setView = async (v) => { await cmd("Emulation.setDeviceMetricsOverride", { width: Math.round(v.w / v.z), height: Math.round(v.h / v.z), deviceScaleFactor: v.z, mobile: false }); await frames(); };
async function load(url, still = true) {
  const loaded = new Promise((r) => { const f = (m) => { if (m.sessionId === S && m.method === "Page.loadEventFired") { listeners.splice(listeners.indexOf(f), 1); r(); } }; listeners.push(f); });
  await cmd("Page.navigate", { url: BASE + url }); await loaded;
  // Still the page: no motion, everything that rises in is shown, fonts loaded.
  if (!still) { await evaluate("document.fonts.ready.then(() => 1)"); return frames(); }
  await evaluate(`(async () => { const s = document.createElement("style"); s.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important} [data-rise]{opacity:1!important;transform:none!important} [data-tilt]{transform:none!important}"; document.head.append(s); await document.fonts.ready; return document.fonts.check('900 40px Anybody'); })()`) || consoleErrors.push(`${url}: the Anybody font did not load`);
  await frames();
}

// ---------- the check that runs inside the page ----------
const CHECK = String(() => {
  scrollTo(0, 0); // measure the page as it lays out, not with the sticky header moved down over it
  const W = innerWidth, H = innerHeight, out = [];
  const name = (el) => { let s = el.tagName.toLowerCase(); if (el.classList.length) s += "." + [...el.classList].slice(0, 2).join("."); const t = (el.innerText || el.value || el.placeholder || "").trim().replace(/\s+/g, " ").slice(0, 36); return t ? `${s} "${t}"` : s; };
  const where = (el) => { const p = el.parentElement?.closest("[class]:not(.wrap)"); return p && p !== document.body ? `${name(el)} in ${p.tagName.toLowerCase()}.${p.classList[0]}` : name(el); };
  const vis = new Map();
  const shown = (el) => {
    if (vis.has(el)) return vis.get(el);
    let ok = true; const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity < 0.05 || cs.clip !== "auto" || el.classList.contains("vh") || el.classList.contains("hero-art")) ok = false;
    else if (el.parentElement?.tagName === "DETAILS" && !el.parentElement.open && el.tagName !== "SUMMARY") ok = false; // inside a closed fold
    else if (el.parentElement && el.parentElement !== document.documentElement) ok = shown(el.parentElement);
    vis.set(el, ok); return ok;
  };
  const R = (r) => ({ l: r.left, t: r.top + scrollY, r: r.right, b: r.bottom + scrollY });
  const inset = (r, f) => { const d = (r.b - r.t) * f; return { ...r, t: r.t + d, b: r.b - d }; };
  const hit = (a, b, tol = 2) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > tol && Math.min(a.b, b.b) - Math.max(a.t, b.t) > tol;
  const outside = (a, box, tol = 1.5) => a.l < box.l - tol || a.r > box.r + tol || a.t < box.t - tol || a.b > box.b + tol;
  const add = (kind, el, extra = "") => out.push(`${kind}: ${where(el)}${extra ? " " + extra : ""}`);

  // Every visible line of text, and every control.
  const items = [];
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = tw.nextNode());) {
    const el = n.parentElement;
    if (!n.data.trim() || !el || /^(SCRIPT|STYLE|NOSCRIPT|OPTION)$/.test(el.tagName) || !shown(el)) continue;
    const rg = document.createRange(); rg.selectNodeContents(n);
    for (const r of rg.getClientRects()) if (r.width > 0.5 && r.height > 0.5 && r.right > 0) items.push({ el, r: inset(R(r), 0.2), text: true });
    if (+getComputedStyle(el).fontSize.replace("px", "") < 11) add("text smaller than 11px", el);
  }
  for (const el of document.querySelectorAll("a[href], button, input:not([type=radio]):not([type=checkbox]), select, textarea, .brand, .chip, .confetti i")) {
    const deco = el.matches(".confetti i"); // decorative circles: only text must keep clear of them
    if (deco ? !el.getClientRects().length : !shown(el)) continue; const r = el.getBoundingClientRect();
    if (r.width > 1 && r.height > 1 && r.right > 0) items.push({ el, r: R(r), text: false, deco });
  }
  // Pictures: the part a product actually fills (the render is 16:9, shown "contain", with space around the cut-out).
  const pics = [];
  for (const img of document.querySelectorAll("img")) {
    if (!shown(img) || img.closest(".thumb, .mini, .bagline")) continue;
    const r = img.getBoundingClientRect(); if (r.width < 40) continue;
    const ar = (img.naturalWidth && img.naturalHeight) ? img.naturalWidth / img.naturalHeight : 16 / 9;
    let w = r.width, h = r.height; if (img.classList.contains("cut") || getComputedStyle(img).objectFit === "contain") { if (w / h > ar) w = h * ar; else h = w / ar; }
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2 + scrollY, k = img.classList.contains("cut") ? 0.36 : 0.5;
    pics.push({ el: img, r: { l: cx - w * k, r: cx + w * k, t: cy - h * k, b: cy + h * k } });
  }

  const scroller = (cs) => /auto|scroll/.test(cs.overflowX + cs.overflowY);
  const BOX = ".card, .acard, .panel, .choice, .brand, .mtile, .who, .fact, .fold, .topic, .action, .paycard, .list > li, .extras > li, .sendto, .parcels, .placed, .payerr, .outcome, .steps li, .chip, .btn, .stock, .sticker, .order-pick, .later, .acct, .phone, .alert, .policy-index a, .doc aside, .thumb, .label-tile, .pending-card, .qty, .stepper, .bigsearch, .head .wrap";
  const seen = new Set();
  const once = (k) => (seen.has(k) ? false : seen.add(k));
  const marks = new WeakMap(); // one report per element and kind
  const onceEl = (kind, el) => { let s = marks.get(el); if (!s) marks.set(el, (s = new Set())); return s.has(kind) ? false : !!s.add(kind); };
  for (const it of items) {
    const { el, r } = it; if (it.deco) continue;
    // Off the side of the screen (the page clips sideways, so it would simply be cut off).
    if ((r.r > W + 1 || r.l < -1) && !el.closest(".scroll") && onceEl("page", el)) { add("off the screen edge", el, `(${Math.round(r.l)}–${Math.round(r.r)} of ${W})`); continue; }
    // Clipped by a box that hides its overflow.
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      if (scroller(cs)) break;
      const box = R(a.getBoundingClientRect());
      if (outside(r, box) && onceEl("clip", el)) add("cut off by its box", el, `(box ${name(a).split(" ")[0]})`);
      break;
    }
    // Sticking out of its card, button or panel.
    const own = it.text ? el : el.parentElement; const card = own?.closest(BOX);
    if (card && card !== el) { const box = R(card.getBoundingClientRect()); if (outside(r, box) && onceEl("card", el)) add("sticks out of its card", el, `(card ${name(card).split(" ")[0]})`); }
  }
  // A word split across two lines (the wide face in a column too narrow for it).
  const tw2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = tw2.nextNode());) {
    const el = n.parentElement; if (!el || !n.data.trim() || !shown(el) || el.closest(".scroll")) continue;
    for (const m of n.data.matchAll(/[^\s-]{4,}/g)) {
      const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
      const tops = new Set([...rg.getClientRects()].filter((r) => r.width > 0.5).map((r) => Math.round(r.top)));
      if (tops.size > 1 && onceEl("split", el)) add("word split across lines", el, `("${m[0]}")`);
    }
  }
  // Truncation: an ellipsis or a line clamp that is hiding words.
  for (const el of document.querySelectorAll("body *")) {
    if (!shown(el) || !el.firstChild) continue;
    const cs = getComputedStyle(el);
    if (cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) add("text cut short with …", el);
    if (cs.webkitLineClamp && cs.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 1) add("text cut short by a line limit", el);
    if (cs.position === "sticky" && el.offsetHeight > 0) {
      const top = parseFloat(cs.top) || 0, room = H - top, parentH = el.parentElement.getBoundingClientRect().height;
      if (el.offsetHeight > room + 4 && parentH > el.offsetHeight + 40) add("sticky panel taller than the screen (its bottom is hidden while scrolling)", el, `(${el.offsetHeight}px tall, ${Math.round(room)}px of room)`);
    }
  }
  // Overlaps between things that are not inside one another.
  const all = items.slice().sort((a, b) => a.r.t - b.r.t);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length && all[j].r.t < all[i].r.b; j++) {
    const a = all[i], b = all[j];
    if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el) || !hit(a.r, b.r)) continue;
    if ((a.deco || b.deco) && !(a.deco ? b.text : a.text)) continue;
    if (once("ov" + name(a.el) + name(b.el))) add("overlaps", a.el, `↔ ${where(b.el)}`);
  }
  for (const it of items) if (it.text && !it.el.closest(".sticker")) for (const p of pics) if (!p.el.closest("a, button")?.contains(it.el) && hit(it.r, p.r, 4) && once("pic" + name(it.el) + p.el.src)) add("text on a product picture", it.el, `↔ ${where(p.el)}`);
  for (const p of pics) if ((p.r.r > W + 1 || p.r.l < -1) && !p.el.closest(".scroll") && once("picoff" + p.el.src)) add("picture cut off at the screen edge", p.el);
  return out;
});

// ---------- the home hero, at laptop sizes, zooms and moments of the stage ----------
// The owner saw the headline overlap the picture on a laptop, so the hero gets its own close check: every laptop shape,
// short windows, windows that aren't maximised, four zoom levels, every product on the stage at several moments of its
// change, and with the web fonts blocked (the fallback font). Screenshots of the first screen go to a folder.
const HERO_SIZES = [[1280, 720], [1280, 800], [1366, 768], [1440, 900], [1470, 956], [1512, 982], [1536, 864], [1680, 1050], [1728, 1117], [1920, 1080],
  [1280, 600], [1366, 650], [1440, 700], [1536, 750], [1728, 680], [1000, 700], [1100, 750], [1180, 680], [1250, 720], [1250, 600]];
const HERO_ZOOMS = [1, 1.1, 1.25, 1.5];
const HERO_CHECK = String((label) => {
  scrollTo(0, 0);
  const out = [], GAP = 8, hero = document.querySelector(".hero");
  const R = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  const gapHit = (a, b, g) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > -g && Math.min(a.b, b.b) - Math.max(a.t, b.t) > -g;
  const textRects = (el) => { const rs = []; if (!el) return rs; const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n; (n = tw.nextNode());) { if (!n.data.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(n); for (const r of rg.getClientRects()) if (r.width > 0.5) { const d = r.height * 0.08; rs.push({ l: r.left, r: r.right, t: r.top + d, b: r.bottom - d }); } } return rs; };
  const seen = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity < 0.05) return false; } return true; };
  // Where a picture's product really is: the opaque pixels of the cut-out, mapped onto the picture as drawn now.
  window.__ink ||= new Map();
  const inkOf = (img) => {
    const key = img.currentSrc || img.src;
    if (!window.__ink.has(key)) {
      let f = { l: 0, t: 0, r: 1, b: 1 };
      try { const c = document.createElement("canvas"); c.width = 192; c.height = 108; const x = c.getContext("2d"); x.drawImage(img, 0, 0, 192, 108); const d = x.getImageData(0, 0, 192, 108).data; let l = 192, t = 108, r = -1, b = -1;
        for (let y = 0; y < 108; y++) for (let X = 0; X < 192; X++) if (d[(y * 192 + X) * 4 + 3] > 40) { if (X < l) l = X; if (X > r) r = X; if (y < t) t = y; if (y > b) b = y; }
        if (r >= 0) f = { l: l / 192, t: t / 108, r: (r + 1) / 192, b: (b + 1) / 108 }; } catch {}
      window.__ink.set(key, f);
    }
    const f = window.__ink.get(key), rect = img.getBoundingClientRect(), ar = (img.naturalWidth / img.naturalHeight) || 16 / 9;
    let w = rect.width, h = rect.height; if (w / h > ar) w = h * ar; else h = w / ar;
    const x0 = rect.left + (rect.width - w) / 2, y0 = rect.top + (rect.height - h) / 2;
    return { l: x0 + f.l * w, r: x0 + f.r * w, t: y0 + f.t * h, b: y0 + f.b * h };
  };
  const h1 = textRects(hero.querySelector("h1")), sub = textRects(hero.querySelector(".sub")), btn = [...hero.querySelectorAll(".ctas .btn")].map((e) => R(e.getBoundingClientRect()));
  const cap = [...hero.querySelectorAll(".cap")].filter(seen).flatMap(textRects), dots = R(hero.querySelector(".dots").getBoundingClientRect());
  const inks = [...hero.querySelectorAll(".slide img")].filter(seen).filter((i) => i.complete && i.naturalWidth).map(inkOf);
  const confetti = [...hero.querySelectorAll(".confetti i")].filter(seen).map((e) => R(e.getBoundingClientRect()));
  const head = document.querySelector(".head").getBoundingClientRect().bottom, copy = R(hero.querySelector(".hero-copy").getBoundingClientRect());
  { const h = hero.querySelector("h1"), tw = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode());) for (const m of n.data.matchAll(/\S+/g)) { const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length); if (new Set([...rg.getClientRects()].map((r) => Math.round(r.top))).size > 1) out.push(`headline word split across lines ("${m[0]}")`); } }
  const any = (A, B, g) => A.some((a) => B.some((b) => gapHit(a, b, g)));
  if (any(h1, inks, GAP)) out.push("headline touches or overlaps the product picture");
  if (any(sub, inks, GAP)) out.push("sub-line touches or overlaps the product picture");
  if (any(btn, inks, 0)) out.push("button overlaps the product picture");
  if (any(h1, [...cap, dots], GAP)) out.push("headline touches the product caption or dots");
  if (any(cap, inks, 0)) out.push("product picture overlaps its caption");
  if (any([...h1, ...sub, ...btn], confetti, 0)) out.push("a decorative circle sits on the headline, sub-line or button");
  if (any(h1, sub, 0) || any(h1, btn, 0) || any(sub, btn, 0)) out.push("headline, sub-line and button overlap each other");
  if (h1.some((r) => r.r > copy.r + 1.5 || r.l < copy.l - 1.5)) out.push("headline wider than its column");
  if (h1.some((r) => r.r > innerWidth || r.l < 0)) out.push("headline off the screen edge");
  if (inks.some((k) => k.t < head - 2)) out.push("product picture runs up under the header");
  // Side by side (laptops), the headline, sub-line and button should all be on the first screen.
  const twoCol = getComputedStyle(hero.querySelector(".hero-in")).gridTemplateColumns.split(" ").length > 1;
  if (twoCol && hero.querySelector(".ctas .btn").getBoundingClientRect().bottom > innerHeight) out.push("button below the first screen");
  return out;
});
async function heroCheck(shotDir) {
  const res = new Map(); const add = (list, at) => { for (const p of list) { if (!res.has(p)) res.set(p, []); res.get(p).push(at); } };
  const n = await (async () => { await setView({ w: 1440, h: 900, z: 1 }); await load("index.html", false); return evaluate("document.querySelectorAll('.hero .dots button').length"); })();
  for (const fonts of ["web fonts", "fallback font"]) {
    if (fonts === "fallback font") { await cmd("Network.enable"); await cmd("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*"] }); }
    for (const z of fonts === "web fonts" ? HERO_ZOOMS : [1, 1.25]) for (const [w, h] of HERO_SIZES) {
      const v = { w, h, z }, at = `${w}×${h}${z === 1 ? "" : ` @${Math.round(z * 100)}%`}${fonts === "web fonts" ? "" : " (fallback font)"}`;
      await setView(v); await load("index.html", false);
      for (let i = 0; i < n; i++) {
        // Change product, freeze the motion, and look at several moments of the change (and of the float).
        await evaluate(`document.querySelectorAll(".hero .dots button")[${(i + 1) % n}].click()`);
        for (const t of [0, 120, 260, 400, 600, 900, 1400, 3000]) add(await evaluate(`(() => { document.getAnimations().forEach((a) => { a.pause(); a.currentTime = ${t}; }); return (${HERO_CHECK})(); })()`), `${at} product ${((i + 1) % n) + 1} at ${t}ms`);
        // HERO_ALL=1: also a screenshot of every product, 900ms into its change.
        if (process.env.HERO_ALL && shotDir && fonts === "web fonts" && z === 1) { await evaluate(`document.getAnimations().forEach((a) => { a.currentTime = 900; })`); const { data } = await cmd("Page.captureScreenshot", { format: "png" }); writeFileSync(join(shotDir, `hero-${w}x${h}-p${((i + 1) % n) + 1}.png`), Buffer.from(data, "base64")); }
        await evaluate(`document.getAnimations().forEach((a) => { try { a.finish(); } catch { a.play(); } })`);
      }
      if (shotDir && fonts === "web fonts") { await evaluate(`document.querySelectorAll(".hero .dots button")[0].click(); document.getAnimations().forEach((a) => { try { a.finish(); } catch {} })`); await frames(); const { data } = await cmd("Page.captureScreenshot", { format: "png" }); writeFileSync(join(shotDir, `hero-${w}x${h}${z === 1 ? "" : "-" + Math.round(z * 100)}.png`), Buffer.from(data, "base64")); }
    }
  }
  await cmd("Network.setBlockedURLs", { urls: [] });
  return res;
}

// ---------- run ----------
const files = readdirSync(dir).filter((f) => f.endsWith(".html") && (!only || only.includes(f.split("?")[0])));
// Long bag: the five items with the longest names, one per product, mixed quantities (chilled and ordinary, so two parcels).
async function fillBag() {
  await evaluate(`(() => { const seen = new Set(); const pick = Object.entries(OT_DATA.items).sort((a, b) => (b[1].name + b[1].sub).length - (a[1].name + a[1].sub).length).filter(([, v]) => !v.pre && !seen.has(v.name) && seen.add(v.name)).slice(0, 5); localStorage.setItem("ot:bag", JSON.stringify(pick.map(([sku], i) => ({ sku, qty: [1, 2, 1, 3, 1][i] })))); })()`);
}
const found = new Map(); // problem → views
const note = (page, view, list) => { for (const p of list) { const k = `${page} · ${p}`; if (!found.has(k)) found.set(k, []); if (!found.get(k).includes(view)) found.get(k).push(view); } };
async function checkAll(page, states = [""]) {
  for (const v of VIEWS) {
    await setView(v);
    note(page, viewName(v), await evaluate(`(${CHECK})()`));
    // Then with every fold open (questions, facts, "Choose exactly what happens").
    const opened = await evaluate(`[...document.querySelectorAll("details:not([open])")].map((d) => (d.open = true, 1)).length`);
    if (opened) { await frames(); note(page + " (folds open)", viewName(v), await evaluate(`(${CHECK})()`)); await evaluate(`document.querySelectorAll("details").forEach((d) => d.open = false)`); }
  }
}

if (shot) {
  const [page, w, z = 1, part] = shot.split("@"); // part "top": the first screen only
  await setView({ w: +w, h: HEIGHTS[w] || 900, z: +z });
  await load("index.html"); if (/bag|checkout/.test(page)) await fillBag();
  await load(page);
  const { data } = await cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.round(w / z), height: part === "top" ? Math.round((HEIGHTS[w] || 900) / z) : await evaluate("document.documentElement.scrollHeight"), scale: 1 } });
  const file = join(tmpdir(), `ot-shot-${page.replace(/\W+/g, "-")}-${w}${z == 1 ? "" : "-" + z}.png`);
  writeFileSync(file, Buffer.from(data, "base64")); console.log(file);
} else {
  // The home hero first (it is where the owner saw the overlap).
  if (!only || only.includes("index.html")) {
    mkdirSync(heroShots, { recursive: true });
    for (const [p, at] of await heroCheck(heroShots)) found.set(`index.html hero · ${p}`, at);
  }
}
if (!shot && !heroOnly) {
  await setView(VIEWS[0]);
  await load("index.html"); await evaluate("localStorage.clear()");
  for (const f of files.filter((f) => !/^(bag|checkout|order)\.html$/.test(f))) { await load(f); await checkAll(f); }
  // The bag and checkout with five things in the bag.
  if (!only || only.includes("bag.html")) { await fillBag(); await load("bag.html"); await checkAll("bag.html (5 items)"); }
  if (!only || only.some((f) => /checkout|order/.test(f))) {
    await fillBag(); await load("checkout.html"); await checkAll("checkout.html (5 items)");
    // A card chosen, and a payment that didn't go through (an exact failing outcome).
    await evaluate(`(async () => { document.querySelector("details.exact").open = true; document.querySelector(".outcome.k-declined")?.click(); await new Promise((r) => setTimeout(r, 50)); document.querySelector("[data-submit]").click(); await new Promise((r) => setTimeout(r, 1200)); })()`);
    await checkAll("checkout.html (payment failed)");
    // Then a real order: choose Visa, place it, and check the order page it lands on.
    await evaluate(`(async () => { document.querySelector("[data-act=normal]")?.click(); document.querySelector("[data-act=brand]").click(); document.querySelector("[data-submit]").click(); })()`);
    let url = ""; for (let i = 0; i < 40 && !/order\.html/.test(url); i++) { await new Promise((r) => setTimeout(r, 150)); url = await evaluate("location.href").catch(() => ""); }
    if (!/order\.html\?n=/.test(url)) consoleErrors.push("checkout: placing an order with Visa did not reach the order page");
    else { await load(url.replace(BASE, "")); await checkAll("order.html (just placed)"); }
  }
}

ws.close(); server.close();
await new Promise((r) => { chrome.once("exit", r); chrome.kill(); setTimeout(r, 3000); });
try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* a temp folder left behind is harmless */ }
if (shot) process.exit(0);
const lines = [...found].map(([k, v]) => `${k}  [${v.length === VIEWS.length ? "all widths" : v.length > 12 ? `${v.slice(0, 12).join(", ")} … and ${v.length - 12} more` : v.join(", ")}]`);
for (const l of lines) console.log(l);
for (const e of [...new Set(consoleErrors)]) console.log(`console: ${e}`);
if (!only || only.includes("index.html")) console.log(`Home hero screenshots: ${heroShots}`);
console.log(`\n${lines.length} layout problem${lines.length === 1 ? "" : "s"}, ${new Set(consoleErrors).size} console error${new Set(consoleErrors).size === 1 ? "" : "s"}, ${files.length} pages × ${VIEWS.length} views.`);
process.exit(lines.length || consoleErrors.length ? 1 : 0);
