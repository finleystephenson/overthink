// Builds the Overthought & Co. website from the records in ../data.
// Nothing about a product, service or policy is typed in this file: change the data, run the build, and every page follows.
// Output is plain HTML in ./dist so it works on any static host. The working parts (bag, checkout, orders, tracking)
// are run in the browser by assets/app.js, which uses the same business engine as the AI tools.
// assets/fx.js adds the motion (stage, rise-in, tilt, logo turn, picture swaps). assets/site.css is the one stylesheet.
// Run: node business/site/build.mjs

import { readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync, existsSync, rmSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
// Output folder: business/site/dist, or another folder for previews (node business/site/build.mjs --out /tmp/ot-preview), so work in
// progress never shows on a page someone is looking at.
const outArg = process.argv.indexOf("--out");
const out = outArg > 0 && process.argv[outArg + 1] ? resolve(process.argv[outArg + 1]) : join(here, "dist");
if (out.split(/[\\/]/).filter(Boolean).length < 2) throw new Error(`Refusing to build into ${out}: pick a folder of its own.`);
const json = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const dir = (p) => (existsSync(join(root, p)) ? readdirSync(join(root, p)).sort() : []);
const optional = (p, fallback) => (existsSync(join(root, p)) ? json(p) : fallback);

// ---------- load the records ----------
const B = json("business/data/business.json");
// The site's public address: business.json `site_url` when set. The sitemap, canonical links and share pictures follow.
const SITE_URL = B.site_url || "https://expanza.co.uk/overthought";
const abs = (path = "") => `${SITE_URL.replace(/\/$/, "")}/${String(path).replace(/^\//, "")}`;
// Expanza's Project 00 page, which explains this demonstration company. Linked from "demonstration company" in the footer.
const EXPANZA_PROJECT_URL = process.env.EXPANZA_PROJECT_URL || "https://expanza.co.uk/project-00/";
const products = dir("business/data/products").filter((f) => f.endsWith(".json")).map((f) => json("business/data/products/" + f));
const services = dir("business/data/services").filter((f) => f.endsWith(".json")).map((f) => json("business/data/services/" + f));
const helpAll = optional("business/data/help.json", []);
const seed = Object.fromEntries(dir("business/data/seed").filter((f) => f.endsWith(".json")).map((f) => [f.replace(".json", ""), json("business/data/seed/" + f)]));

// Policies and procedures are markdown with a small front-matter block.
function readDoc(path) {
  const raw = readFileSync(join(root, path), "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  if (m) for (const line of m[1].split("\n")) { const i = line.indexOf(":"); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return { ...meta, id: meta.id || path.split("/").pop().replace(".md", ""), body: (m ? m[2] : raw).replace(/^# .*\n/, "").trim() };
}
const policiesAll = dir("business/data/policies").filter((f) => f.endsWith(".md")).map((f) => readDoc("business/data/policies/" + f));

const byId = Object.fromEntries(products.map((p) => [p.id, p]));
const svcById = Object.fromEntries(services.map((s) => [s.id, s]));

// Products only for now. Services are built in the data and switched on here when they are ready to show.
const SHOW_SERVICES = false;
// Help answers and policies about service bookings only make sense when services are on.
const SERVICE_POLICIES = ["bookings", "hire-and-borrowing", "service-cancellation"];
// Which ways to pay the website's checkout offers (ids from business.payments.methods). Card only for now: the other
// methods stay in the data and the engine (developers can still use them through the API); add their ids here to show them.
const SITE_PAYMENT_METHODS = ["card"];
// Gift cards are not offered for now, so questions about them are left out.
const help = helpAll.filter((h) => (SHOW_SERVICES || h.topic !== "bookings") && !/gift card/i.test(h.q));
const policies = policiesAll.filter((p) => SHOW_SERVICES || !SERVICE_POLICIES.includes(p.id));
const policyById = Object.fromEntries(policies.map((p) => [p.id, p]));

// The order things appear in. Lead products first (see docs/catalogue.md); they also take turns on the home stage.
const LEAD = ["emergency-sandwich", "blip", "trophy", "spare-sock", "boombox-mini", "bubble-wrap", "ice-by-post"];
const ORDER = [...LEAD, "skimming-stones", "paper-aeroplane", "indoor-helmet", "starter-puddle", "pocket-jungle", "daypack", "other-umbrella", "one-good-pen", "biscuit-tin"];
const rank = (id) => (ORDER.includes(id) ? ORDER.indexOf(id) : 99);
products.sort((a, b) => rank(a.id) - rank(b.id));
const NEW = ["trophy", "other-umbrella", "one-good-pen", "biscuit-tin"];
const SERVICE_ORDER = ["someone-to-queue", "someone-to-hold", "someone-to-wait-in", "someone-to-clap", "borrow-box", "fix-club"];

// ---------- pictures ----------
// Branded renders (img/branded/<id>.jpg) carry the logo and lettering, so they come first.
// A few older stand-ins still match their product and are used until the full set is made. Anything else
// gets a typeset label, never a wrong picture and never a broken one.
// Every picture is a 16:9 render on its own backdrop colour (its "ground"). The page shows it whole, on that colour.
const GROUNDS = existsSync(join(here, "img/branded/grounds.json")) ? JSON.parse(readFileSync(join(here, "img/branded/grounds.json"), "utf8")) : {};
const OLD_OK = { "spare-sock": "#f5e9bd", "boombox-mini": "#d9d2ea", daypack: "#dedcd9", "ice-by-post": "#ccd4f4", "borrow-box": "#f0e0b7", "fix-club": "#d0dbe7" };
const has = (rel) => !!rel && existsSync(join(here, rel));
const picFile = (x) => (has(`img/branded/${x.id}.jpg`) ? `img/branded/${x.id}.jpg` : OLD_OK[x.id] && has(`img/${x.id}.jpg`) ? `img/${x.id}.jpg` : null);
const hasPic = (x) => !!picFile(x);
// With original renders, the colour is measured from the picture itself, so its box matches its backdrop exactly.
const ground = (x) => (!USE_CUTOUTS && hasPic(x) ? groundOf(picFile(x), GROUNDS[x.id] || "#E9E6E0") : GROUNDS[x.id] || (hasPic(x) && OLD_OK[x.id]) || x.image?.sweep || "#E9E6E0");

// The backdrop colour of any picture: grounds.json first, then measured from the picture's border (macOS sips),
// so a new variant or accessory picture always sits on its own colour with no seam.
const sampled = {};
function groundOf(rel, fallback) {
  if (!rel) return fallback;
  const key = basename(rel).replace(/\.[a-z]+$/i, "");
  if (USE_CUTOUTS && GROUNDS[key]) return GROUNDS[key];
  if (key in sampled) return sampled[key] || fallback;
  sampled[key] = null;
  try {
    const tmp = join(tmpdir(), `ot-ground-${process.pid}.bmp`);
    execFileSync("sips", ["-s", "format", "bmp", "-z", "12", "20", join(here, rel), "--out", tmp], { stdio: "ignore" });
    const b = readFileSync(tmp), off = b.readUInt32LE(10), w = b.readInt32LE(18), h = Math.abs(b.readInt32LE(22)), px = b.readUInt16LE(28) / 8;
    const row = Math.ceil((w * px) / 4) * 4; let r = 0, g = 0, bl = 0, n = 0;
    const at = (x, y) => { const i = off + y * row + x * px; bl += b[i]; g += b[i + 1]; r += b[i + 2]; n++; };
    for (let x = 0; x < w; x++) { at(x, 0); at(x, h - 1); }
    for (let y = 1; y < h - 1; y++) { at(0, y); at(w - 1, y); }
    sampled[key] = "#" + [r, g, bl].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("").toUpperCase();
  } catch { /* no sips or an unreadable file: use the fallback */ }
  return sampled[key] || fallback;
}

// What the page shows for a picture. Every studio render has a cut-out with a transparent background (img/cut/<name>.png,
// made by business/builder/prepare-pictures.py), so the product stands straight on the page's flat colour with a soft shadow
// (site.css img.cut) and nothing has an edge. Web versions (img/web/<name>-1280.webp and -640.webp) come first, then the
// cut-out PNG, then the original JPG. A few close-ups are cropped by their own frame, so a cut-out would show a hard
// straight edge: those stay as the JPG in a rounded frame (site.css img.framed).
const FRAMED = new Set(["bubble-wrap-2", "trophy-2"]);
// The owner prefers the original studio renders: their own backdrop, light and shadow look better than the
// cut-outs. So by default every picture is the original JPG, shown on a box of its own backdrop colour with
// softened edges (site.css img.framed), and the box itself carries that colour. Set to true to go back to cut-outs.
const USE_CUTOUTS = false;
function art(rel) {
  if (!rel) return null;
  const name = basename(rel).replace(/\.[a-z]+$/i, "");
  if (!USE_CUTOUTS) {
    const small = `img/web/${name}-640.jpg`;
    return has(small) ? { jpg: rel, src: rel, srcset: `${small} 640w, ${rel} 1280w`, small, cut: false } : { jpg: rel, src: rel, srcset: "", small: rel, cut: false };
  }
  if (!FRAMED.has(name) && has(`img/cut/${name}.png`)) {
    const big = `img/web/${name}-1280.webp`, small = `img/web/${name}-640.webp`;
    if (has(big) && has(small)) return { jpg: rel, src: big, srcset: `${small} 640w, ${big} 1280w`, small, cut: true };
    return { jpg: rel, src: `img/cut/${name}.png`, srcset: "", small: `img/cut/${name}.png`, cut: true };
  }
  return { jpg: rel, src: rel, srcset: "", small: rel, cut: false };
}
// One picture as an <img>: the small version for phones and thumbnails (srcset), the class that gives it its shadow or frame.
function imgTag(a, { alt = "", sizes = "100vw", lazy = true, high = false } = {}) {
  return `<img class="${a.cut ? "cut" : "framed"}" src="${a.src}"${a.srcset ? ` srcset="${a.srcset}" sizes="${sizes}"` : ""} alt="${esc(alt)}" width="1280" height="720"${lazy ? ' loading="lazy"' : ""}${high ? ' fetchpriority="high"' : ""}>`;
}
// A picture with its page colour, for the product page, its gallery and its option pictures.
const shot = (rel, fallbackGround) => { const a = art(rel); return a && { ...a, ground: groundOf(rel, fallbackGround) }; };

// More than one picture: the record's `gallery` list, then any file that follows the naming convention
// img/branded/<name>-2.jpg, -3.jpg ... (<name> is the product id, or acc-<slug> for an accessory), so a new
// picture appears without touching the data. The main picture always comes first; missing files are skipped.
function galleryOf(main, listed, name, fallbackGround) {
  const auto = [];
  for (let n = 2; n <= 9; n++) if (has(`img/branded/${name}-${n}.jpg`)) auto.push(`img/branded/${name}-${n}.jpg`);
  const files = [...new Set([main, ...(Array.isArray(listed) ? listed : []), ...auto].filter(has))];
  return files.map((src) => shot(src, fallbackGround));
}

// Pictures that change with a choice (the sandwich by filling). Missing files fall back to the product's own picture.
function variantPics(p) {
  const vi = p.variant_images;
  if (!vi || !vi.images || !p.options?.some((o) => o.name === vi.option)) return null;
  const images = {};
  for (const [val, src] of Object.entries(vi.images)) {
    const file = has(src) ? src : picFile(p);
    if (file) { const { src, srcset, cut, ground: g } = shot(file, ground(p)); images[val] = { src, srcset, cut, ground: g }; }
  }
  return Object.keys(images).length ? { option: vi.option, images } : null;
}
// The picture for one variant (bag, checkout and order thumbnails use its small version).
function firstPicFor(p, variant) {
  const vi = p.variant_images, val = vi && variant?.options?.[vi.option], file = val && has(vi.images?.[val]) ? vi.images[val] : picFile(p);
  return file ? shot(file, ground(p)) : null;
}

// ---------- small helpers ----------
const esc = (s = "") => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const t = (s) => esc(s).replace(/[¹²³]/g, ""); // the footnote device is retired: drop any stray marks
const money = (n) => "£" + (Number.isInteger(n) ? n : Number(n).toFixed(2));
const niceDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
const priceRange = (p) => { const v = p.variants.map((x) => x.price); const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? money(lo) : `From ${money(lo)}`; };
const paras = (s) => String(s).split(/\n{2,}/).map((x) => `<p>${t(x)}</p>`).join("");
// Split copy into sentences, so long record text can show its first sentence and tuck the rest away.
const sentences = (s) => String(s || "").trim().split(/(?<=[.!?])\s+(?=[A-Z0-9£"])/).filter(Boolean);
// ["A", "B", "C"] → "A, b or c." (names come from the data)
const listOr = (names) => names.map((n, i) => (i ? n[0].toLowerCase() + n.slice(1) : n)).join(", ").replace(/, ([^,]*)$/, " or $1");
const listAnd = (names) => names.join(", ").replace(/, ([^,]*)$/, " and $1");
const slugify = (s) => String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Names in the wide display face: a hyphenated word never splits across lines ("Pre-Popped" stays whole).
const nameHtml = (s) => esc(s).split(" ").map((w) => (w.includes("-") ? `<span class="nb">${w}</span>` : w)).join(" ");
const isLong = (s) => String(s).length > 14;
// Code-like text never reaches a customer: drop SKUs from record copy.
const noCodes = (s) => String(s || "").replace(/\s*\(?\bOT-[A-Z0-9-]+\)?,?/g, "").replace(/\s{2,}/g, " ").trim();

// ---------- search and AI helpers ----------
const plain = (s) => String(s || "").replace(/[¹²³]/g, "").replace(/\s+/g, " ").trim();
const firstSentence = (s) => sentences(s)[0] || "";
const noStop = (s) => plain(s).replace(/[.!?]+$/, "");
const BUILD_DATE = new Date().toISOString().slice(0, 10);
const DEMO = "Overthought & Co. is a demonstration company, built for testing AI products on a realistic business. Nothing here is really for sale.";
const SHORT_DEMO = "A demonstration company: nothing here is really for sale.";
// A meta description of up to 155 characters: parts are added in order while they still fit.
const fitDesc = (parts, max = 155) => { let d = ""; for (const x of parts.map(plain).filter(Boolean)) { const n = d ? `${d} ${x}` : x; if (n.length <= max) d = n; } return d || plain(parts[0]).slice(0, max); };
// A title of about 50-60 characters with the brand: "Name: line" when it fits, else the name alone.
const fitTitle = (name, line, room = 40) => { const l = noStop(line); return l && `${name}: ${l}`.length <= room ? `${name}: ${l}` : name; };
// What a picture shows, from the record's own description of the thing (not the photo brief).
const lowerFirst = (s) => (/^[A-Z][a-z ]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const altFor = (x) => { const d = noStop(sentences(x.physical?.form || noCodes(x.description || x.tagline || ""))[0] || ""); return d ? `${x.name}, ${lowerFirst(d)}` : x.name; };
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
const crumbList = (items) => ({ "@type": "BreadcrumbList", itemListElement: items.map(([name, file], i) => ({ "@type": "ListItem", position: i + 1, name, item: abs(file === "index.html" ? "" : file) })) });
const faqLd = (items) => (items.length ? { "@type": "FAQPage", mainEntity: items.map(({ q, a }) => ({ "@type": "Question", name: plain(q), acceptedAnswer: { "@type": "Answer", text: plain(noCodes(a)) } })) } : null);
const ORG_ID = abs("#organization"), SITE_ID = abs("#website");
// Organization and WebSite go on every page. No Offer, price or rating markup anywhere: nothing here is really for sale.
const baseLd = [
  { "@type": "Organization", "@id": ORG_ID, name: B.name, url: abs(), logo: { "@type": "ImageObject", url: abs("favicon.svg") }, description: DEMO },
  { "@type": "WebSite", "@id": SITE_ID, name: B.name, url: abs(), description: `${B.tagline} ${DEMO}`, inLanguage: "en-GB", publisher: { "@id": ORG_ID } },
];

// Enough markdown for policies: headings, lists, tables, bold, links, paragraphs.
function md(src) {
  const inline = (s) => t(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>').replace(/`(.+?)`/g, "<code>$1</code>");
  const outp = []; const lines = src.split("\n"); let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { outp.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); i++; continue; }
    if (/^\s*[-*]\s+/.test(l)) { const items = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`), i++; outp.push(`<ul>${items.join("")}</ul>`); continue; }
    if (/^\s*\d+\.\s+/.test(l)) { const items = []; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) items.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`), i++; outp.push(`<ol>${items.join("")}</ol>`); continue; }
    if (l.trim().startsWith("|")) {
      const rows = []; while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())), i++;
      const body = rows.filter((r) => !r.every((c) => /^:?-+:?$/.test(c)));
      outp.push(`<div class="scroll"><table><thead><tr>${body[0].map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.slice(1).map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const buf = []; while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*[-*]\s|\s*\d+\.\s|\|)/.test(lines[i])) buf.push(lines[i]), i++;
    outp.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  // Links to pages that are not built (service policies while services are off) become plain text.
  return outp.join("\n").replace(/<a href="policy-([a-z-]+)\.html">(.*?)<\/a>/g, (m, id, txt) => (policyById[id] ? m : txt));
}

// ---------- graphics ----------
// The spiral O: the mark that goes round once more than it needs to.
const MARK_D = "M12 2c.49.11 2.02.3 2.93.65.91.36 1.8.87 2.54 1.47.75.6 1.43 1.35 1.95 2.13.52.78.93 1.67 1.19 2.55.26.88.37 1.83.36 2.73-.02.9-.19 1.82-.47 2.65-.28.83-.71 1.64-1.22 2.34-.5.69-1.14 1.32-1.81 1.81-.68.5-1.46.9-2.23 1.16-.77.26-1.61.41-2.41.42-.79.02-1.62-.09-2.36-.31-.75-.22-1.48-.56-2.11-.98-.63-.42-1.2-.96-1.66-1.54-.46-.57-.84-1.24-1.1-1.9-.26-.67-.41-1.4-.45-2.09-.05-.7.03-1.42.19-2.07.16-.66.44-1.3.78-1.86.34-.56.79-1.07 1.27-1.49.48-.41 1.04-.76 1.61-1 .56-.25 1.18-.4 1.77-.46.59-.06 1.21-.02 1.77.1.56.12 1.11.34 1.59.61.49.27.93.64 1.29 1.03.37.39.74 1.1.89 1.32";
const MARK_PATH = `<path d="${MARK_D}" fill="none" stroke="currentColor" stroke-width="3.3" stroke-linecap="round"/>`;
const mark = (cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${MARK_PATH}</svg>`;
// The favicon: the spiral in ink on paper.
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#F8F7F3"/><g transform="translate(4 4)"><path d="${MARK_D}" fill="none" stroke="#1D1E3C" stroke-width="3.3" stroke-linecap="round"/></g></svg>`;
// Line icons, 24px grid, drawn with currentColor.
const ICON = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/>',
  bag: '<path d="M5 8.5h14l-1.2 11.5H6.2L5 8.5z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
  tick: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  truck: '<path d="M2.5 6.5h11v10h-11z"/><path d="M13.5 10h4.2l3 3.2v3.3h-7.2"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  back: '<path d="M8.5 5L4 9.5 8.5 14"/><path d="M4 9.5h10.5a5.5 5.5 0 0 1 0 11H10"/>',
  box: '<path d="M4 7.8l8-4 8 4v8.7l-8 4-8-4z"/><path d="M4 7.8l8 4 8-4M12 11.8v8.7"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 1 5.1-1.1l-2.9 2.9.6 2.4 2.4.6 2.9-2.9a4 4 0 0 1-5.6 4.6l-8.4 8.4a2 2 0 0 1-2.8-2.8l8.4-8.4a4 4 0 0 1 .3-3.7z"/>',
  card: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 9.5h19M6.5 14.5h4"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.2"/>',
  pin: '<path d="M12 21s-6.5-5.8-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.3"/>',
  tag: '<path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z"/><circle cx="8.5" cy="8.5" r="1.6"/>',
  user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  chat: '<path d="M4 5.5h16v10H9l-5 4z"/>',
};
const icon = (n, cls = "ico") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[n] || ICON.arrow}</svg>`;
// A row of brand dots with the mark in the middle: used as a divider between sections.
const divider = () => `<div class="divider" aria-hidden="true"><i></i><i></i><i></i>${mark("divider-mark")}<i></i><i></i><i></i></div>`;
// Soft round shapes that drift behind a hero. Positions and colours live in the CSS.
const confetti = (n = 5) => `<div class="confetti" aria-hidden="true">${Array.from({ length: n }, () => "<i></i>").join("")}</div>`;
// The Add button: its label slides away and a tick draws itself (site.css: .add.is-added).
const TICK = `<svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const addBtn = (label, attrs = "", cls = "") => `<button type="button" class="btn add ${cls}" ${attrs}><span class="add-lbl">${label}</span><span class="add-done" aria-hidden="true">${TICK}Added</span></button>`;

// ---------- accessories ----------
// Each product's accessories, gathered once with a page name, a picture and what they fit.
const accessories = [];
{
  const seen = new Set(), slugs = new Set();
  for (const p of products) for (const a of p.accessories || []) {
    if (!a?.sku || seen.has(a.sku)) continue;
    seen.add(a.sku);
    let slug = a.image ? basename(a.image).replace(/\.[a-z]+$/i, "").replace(/^acc-/, "") : slugify(a.name);
    if (slugs.has(slug)) slug = `${slug}-${p.id}`;
    slugs.add(slug);
    const img = has(a.image) ? a.image : null;
    accessories.push({ ...a, parent: p, slug, file: `acc-${slug}.html`, img, ground: img ? groundOf(img, ground(p)) : ground(p) });
  }
}
// What an accessory fits, as products (with an optional note naming the variants).
function fitsOf(a) {
  const f = a.fits;
  if (Array.isArray(f) && f.length) return f.map((id) => byId[id]).filter(Boolean).map((p) => ({ p, note: "" }));
  if (typeof f === "string" && f.trim() && f.trim() !== "all") {
    const skus = f.split(/[,\s]+/).filter(Boolean);
    const names = a.parent.variants.filter((v) => skus.includes(v.sku)).map((v) => v.name.split(",")[0]);
    return [{ p: a.parent, note: names.length && names.length < a.parent.variants.length ? listAnd(names) : "" }];
  }
  return [{ p: a.parent, note: "" }];
}
const fitsText = (a) => listAnd(fitsOf(a).map(({ p, note }) => (note ? `${p.name} (${note})` : p.name)));
const accLine = (a) => a.tagline || sentences(noCodes(a.description))[0] || "";
// Everything that goes with a product: its own accessories, then other products' accessories that fit it.
const goesWith = (p) => accessories.filter((a) => a.parent === p || fitsOf(a).some((f) => f.p === p));
function accPic(a, cls = "") {
  if (a.img) return imgTag(art(a.img), { alt: altFor(a), sizes: "(max-width: 640px) 50vw, 320px" });
  return labelTile(a.name, cls);
}
// Until an accessory has its own picture: a neat label tile on the parent's colour, the spiral and the name.
const labelTile = (name, cls = "") => `<div class="label-tile ${cls}"><span class="label-disc">${mark()}</span><b>${nameHtml(name)}</b></div>`;
// An accessory card: picture, name, one line, price and an Add button that ticks.
const acard = (a, i = 0, small = false) => `<article class="acard${small ? " small" : ""}" style="--c:${a.ground};--d:${(i % 4) * 70}ms" data-rise>
    <a class="acard-pic" href="${a.file}" tabindex="-1" aria-hidden="true">${accPic(a)}</a>
    <div class="acard-txt"><h3><a href="${a.file}">${nameHtml(a.name)}</a></h3>${!small && accLine(a) ? `<p>${t(accLine(a))}</p>` : ""}
      <div class="acard-foot"><span class="price">${money(a.price)}</span>${addBtn("Add", `data-add-sku="${esc(a.sku)}" aria-label="Add ${esc(a.name)} to bag"`, "small")}</div></div></article>`;

// ---------- product pictures and cards ----------
function pic(x, cls = "", file = picFile(x), c = ground(x)) {
  if (file) return `<div class="pic ${cls}" style="--c:${c}">${imgTag(art(file), { alt: altFor(x), sizes: "(max-width: 900px) 100vw, 55vw", lazy: false, high: true })}</div>`;
  return `<div class="pic pending ${cls}" style="--c:${c}"><div class="pending-card">${mark()}<b>${nameHtml(x.name)}</b></div></div>`;
}
const soldOut = (p) => p.status !== "preorder" && p.variants.every((v) => !(v.stock > 0));
// The product card: big picture on the product's own colour, then name, line and price.
// Cards are laid out in a rhythm of wide and narrow (see .cards in site.css).
function card(p, i = 0) {
  const sticker = p.status === "preorder" ? "Pre-order" : soldOut(p) ? "Back soon" : NEW.includes(p.id) ? "New" : "";
  const img = hasPic(p) ? imgTag(art(picFile(p)), { alt: altFor(p), sizes: "(max-width: 640px) 100vw, (max-width: 900px) 50vw, 760px" }) : `<div class="pending-card">${mark()}<b>${nameHtml(p.name)}</b></div>`;
  return `<a class="card" href="${p.id}.html" style="--c:${ground(p)};--d:${(i % 2) * 90}ms" data-rise>
    <div class="card-pic">${img}</div>${sticker ? `<span class="sticker">${sticker}</span>` : ""}
    <div class="card-txt"><h3>${nameHtml(p.name)}</h3>${p.tagline ? `<p>${t(p.tagline)}</p>` : ""}
      <div class="card-foot"><span class="price">${priceRange(p)}</span><span class="go">${icon("arrow")}</span></div></div></a>`;
}
const cards = (list) => `<div class="cards">${list.map(card).join("")}</div>`;

// ---------- page frame ----------
const PDP_SIZES = "(max-width: 900px) 100vw, 55vw";
const NAV = [["shop.html", "Shop"], ...(SHOW_SERVICES ? [["services.html", "Services"]] : []), ["help.html", "Help"]];
const logo = (big = false) => `<a class="mark${big ? " big" : ""}" href="index.html" aria-label="Overthought &amp; Co. home">${mark("spin")}<span>Overthought &amp; Co.</span></a>`;
const header = (active) => `<a class="skip" href="#main">Skip to content</a>
<header class="head"><div class="wrap">
  ${logo()}
  <nav class="nav" aria-label="Main">${NAV.map(([h, n]) => `<a href="${h}"${active === n ? ' aria-current="page"' : ""}>${n}</a>`).join("")}<a class="bagbtn" href="bag.html"${active === "Bag" ? ' aria-current="page"' : ""}>${icon("bag")}<span>Bag</span><span class="count" data-bag-count>0</span></a></nav>
</div></header>`;
const FOOT_POLICIES = ["delivery", "returns-and-refunds", "warranty", "privacy", "terms", "accessibility"].filter((id) => policyById[id]);
const footer = () => `<footer class="foot"><div class="wrap">
  <div class="foot-top">${logo(true)}
    <nav aria-label="Footer"><a href="shop.html">Shop</a><a href="help.html">Help</a>${FOOT_POLICIES.map((id) => `<a href="policy-${id}.html">${esc(policyById[id].title.replace(/ policy$/i, ""))}</a>`).join("")}<a href="policies.html">All policies</a></nav></div>
  <div class="foot-dots" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
  <p class="small">Overthought &amp; Co. is a <a href="${EXPANZA_PROJECT_URL}">demonstration company</a>, built for testing AI products on a realistic business. Nothing here is really for sale.</p>
</div></footer>`;

const HERO_P = byId[LEAD.find((id) => byId[id] && hasPic(byId[id]))] || {};
const HERO_PIC = picFile(HERO_P) || "";
const pages = [];
// `preload` is the picture on the first screen (fetched early); `index: false` keeps working pages out of search and the sitemap.
const sitemap = [];
function page({ file, title, desc = B.tagline, body, bg = "", active = "", view = "", image = HERO_PIC, imageAlt = HERO_P.name ? altFor(HERO_P) : B.name, full = false, preload = "", index = true, ld = [], crumbs = null }) {
  pages.push(file);
  if (index) sitemap.push(file);
  const name = full ? title : `${title} · Overthought & Co.`;
  const url = abs(file === "index.html" ? "" : file);
  writeFileSync(join(out, file), `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">${index ? "" : `<meta name="robots" content="noindex">`}
<meta property="og:site_name" content="Overthought &amp; Co."><meta property="og:type" content="website"><meta property="og:url" content="${url}"><meta property="og:title" content="${esc(name)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:locale" content="en_GB">${image ? `<meta property="og:image" content="${abs(image)}"><meta property="og:image:width" content="1280"><meta property="og:image:height" content="720"><meta property="og:image:alt" content="${esc(imageAlt)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(name)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${abs(image)}"><meta name="twitter:image:alt" content="${esc(imageAlt)}">` : ""}
<meta name="theme-color" content="${bg || "#F8F7F3"}">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anybody:wdth,wght@50..150,100..900&family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/site.css">${preload?.src ? `\n<link rel="preload" as="image" href="${preload.src}"${preload.srcset ? ` imagesrcset="${preload.srcset}" imagesizes="${preload.sizes || PDP_SIZES}"` : ""} fetchpriority="high">` : ""}
${jsonLd({ "@context": "https://schema.org", "@graph": [...baseLd, ...ld.filter(Boolean), ...(crumbs ? [crumbList(crumbs)] : [])] })}
<script defer src="assets/data.js"></script><script type="module" src="assets/app.js"></script><script type="module" src="assets/fx.js"></script>
</head><body${bg ? ` style="--ground:${bg}"` : ""}${view ? ` data-view="${view}"` : ""}>
${header(active)}
<main id="main">${body}</main>
${footer()}
</body></html>`);
}
const titleBlock = (h, p = "", label = "") => `<div class="wrap page-title" data-rise>${label ? `<span class="label">${label}</span>` : ""}<h1>${t(h)}</h1>${p ? `<p>${t(p)}</p>` : ""}</div>`;
// The three steps of buying, shown on the bag and checkout pages.
const steps = (n) => `<div class="wrap"><ol class="steps" aria-label="Steps to buy">${["Bag", "Details and payment", "Done"].map((s, i) => `<li${i === n ? ' aria-current="step"' : i < n ? ' class="done"' : ""}><i>${i < n ? icon("tick") : i + 1}</i><span>${s}</span></li>`).join("")}</ol></div>`;

// Empty the folder rather than deleting it, so a preview server started inside it keeps working.
for (const f of existsSync(out) ? readdirSync(out) : []) rmSync(join(out, f), { recursive: true, force: true });
mkdirSync(join(out, "assets"), { recursive: true });
writeFileSync(join(out, "favicon.svg"), FAVICON);

// ---------- home: hero stage, every product, footer ----------
const STAGE_SIZES = "(max-width: 900px) 100vw, 62vw";
{
  const stage = LEAD.map((id) => byId[id]).filter((p) => p && hasPic(p));
  page({
    file: "index.html", title: "Overthought & Co. · Ordinary things, properly thought through", full: true, bg: ground(stage[0]), view: "home", preload: { ...art(picFile(stage[0])), sizes: STAGE_SIZES },
    desc: `${B.tagline || "Ordinary things, properly thought through."} ${products.length} products, from The Emergency Sandwich to Blip. A demonstration company: nothing here is really for sale.`,
    body: `<section class="hero" data-stage>
      <div class="hero-art" aria-hidden="true">${mark("hero-mark")}${confetti(5)}</div>
      <div class="wrap hero-in">
        <div class="hero-copy"><h1>Ordinary things, properly thought through.</h1>
          <p class="sub">Things you didn't think you needed.</p>
          <div class="ctas"><a class="btn" href="#all">See all ${products.length} products ${icon("arrow")}</a></div></div>
        <div class="stage">
          <div class="stage-pics" data-tilt>${stage.map((p, i) => `<a class="slide${i ? "" : " on"}" href="${p.id}.html" data-ground="${ground(p)}"${i ? ' tabindex="-1" aria-hidden="true"' : ""}>${imgTag(art(picFile(p)), { alt: altFor(p), sizes: STAGE_SIZES, lazy: !!i, high: !i })}</a>`).join("")}</div>
          <div class="stage-bar">
            <div class="caps">${stage.map((p, i) => `<a class="cap${i ? "" : " on"}" href="${p.id}.html"${i ? ' tabindex="-1" aria-hidden="true"' : ""}><b>${esc(p.name)}</b><span>${priceRange(p)}</span></a>`).join("")}</div>
            <div class="dots" role="group" aria-label="Choose a product to show">${stage.map((p, i) => `<button type="button" aria-label="Show ${esc(p.name)}" aria-pressed="${!i}"${i ? "" : ' class="on"'}><i></i></button>`).join("")}</div>
          </div>
        </div>
      </div>
    </section>
    ${divider()}
    <section class="sec" id="all" aria-label="Everything we make"><div class="wrap">
      <div class="sechead" data-rise><h2>Everything we make.</h2></div>
      ${cards(products)}
    </div></section>
    ${SHOW_SERVICES ? `<section class="sec"><div class="wrap"><div class="sechead"><h2>Someone to do it for you.</h2><a href="services.html">All services</a></div>${cards(SERVICE_ORDER.map((id) => svcById[id]).filter(Boolean))}</div></section>` : ""}`,
  });
}

// ---------- shop: one page of everything, then the extras ----------
page({
  file: "shop.html", title: `Shop: all ${products.length} products and extras`, active: "Shop", view: "shop", desc: fitDesc([`All ${products.length} products from Overthought & Co., from The Emergency Sandwich to Blip, and the ${accessories.length} extras that go with them.`, "Prices are shown for demonstration."]),
  crumbs: [["Home", "index.html"], ["Shop", "shop.html"]],
  ld: [{ "@type": "ItemList", name: `All ${products.length} products`, numberOfItems: products.length, itemListElement: products.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: abs(`${p.id}.html`), name: p.name })) }],
  body: `<section class="shop-hero"><div class="hero-art" aria-hidden="true">${confetti(4)}</div>${titleBlock("Everything we make.")}</section>
  <div class="wrap">${cards(products)}</div>
  ${accessories.length ? `${divider()}<section class="sec" id="extras"><div class="wrap"><div class="sechead" data-rise><h2>Extras.</h2></div><div class="acards small">${accessories.map((a, i) => acard(a, i, true)).join("")}</div></div></section>` : ""}`,
});

// ---------- product pages ----------
// A plain fact: the first sentence, with the rest behind "More".
function fact(k, text, who = "") {
  const [first, ...rest] = sentences(text);
  if (!first) return "";
  return rest.length
    ? `<details class="fact"><summary><b>${k}</b><span>${t(first)} <em class="more-link">More${who ? `<span class="vh"> about ${k.toLowerCase()} for ${esc(who)}</span>` : ""}</em></span></summary><p>${t(rest.join(" "))}</p></details>`
    : `<div class="fact"><b>${k}</b><span>${t(first)}</span></div>`;
}
const block = (id, title, inner, cls = "") => (inner ? `<section class="more ${cls}" id="${id}" data-rise><h2>${title}</h2><div class="prose">${inner}</div></section>` : "");
const fold = (summary, inner) => `<details class="fold"><summary>${summary}</summary><div>${inner}</div></details>`;
// Specifications: short and friendly, never codes.
// Size and details: every product and accessory's `specs` rows ([label, value]), in plain words, never codes.
const specList = (x) => (Array.isArray(x.specs) ? x.specs : []).filter((r) => Array.isArray(r) && r[0] && r[1] && !/sku|prefix|code|concept/i.test(r[0]) && !/concept|OT-[A-Z]/.test(String(r[1])));
function specRows(x) {
  const rows = specList(x);
  return rows.length ? `<dl class="specs">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${t(noCodes(v))}</dd></div>`).join("")}</dl>` : "";
}

// The picture area of a product or accessory page: the main picture and, when there is more than one, a row of
// thumbnails under it (fx.js swaps them with the same cross-fade as option pictures; arrows and swipes work too).
function viewer(x, gallery, fallbackPic) {
  const main = gallery[0];
  const frame = main ? `<div class="pic" style="--c:${main.ground}">${imgTag(main, { alt: altFor(x), sizes: PDP_SIZES, lazy: false, high: true })}</div>` : fallbackPic;
  const thumbs = gallery.length > 1
    ? `<div class="thumbs" role="group" aria-label="Pictures of ${esc(x.name)}">${gallery.map((g, i) => `<button type="button" class="thumb${i ? "" : " on"}" style="--c:${g.ground}" data-src="${g.src}" data-srcset="${g.srcset}" data-cut="${g.cut}" data-ground="${g.ground}" aria-label="Picture ${i + 1} of ${gallery.length}" aria-pressed="${!i}">${imgTag({ ...g, src: g.small, srcset: "" })}</button>`).join("")}</div>`
    : "";
  return `<div class="pdp-pic"${gallery.length > 1 ? ` data-gallery` : ""}><div class="pdp-frame" data-tilt>${frame}</div>${thumbs}</div>`;
}
// Feature lines: full sentences read as a comfortable list; a set of very short lines (Blip's) stays big.
const knowList = (f) => (f.every((x) => String(x).length <= 24) ? `<ul class="does">${f.map((x) => `<li>${t(x)}</li>`).join("")}</ul>` : `<ul class="know">${f.map((x) => `<li>${t(noCodes(x))}</li>`).join("")}</ul>`);
const arrivesHtml = (a) => { const s = (Array.isArray(a) ? a.join(" ") : String(a || "")).trim(); return s ? paras(noCodes(s)) : ""; };

function deliveryOf(p) {
  const methods = (p.delivery?.methods || []).map((id) => B.delivery.methods.find((m) => m.id === id)).filter(Boolean).map((m) => `${m.name} (${String(m.time).replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())})`).join(" or ");
  return [methods && `${methods}.`, (p.delivery?.note || "").replace(/^(Soon|Sooner|Cold)[^.]*\.\s*/, "")].filter(Boolean).join(" ");
}
const catName = (id) => (B.categories.find((c) => c.id === id) || {}).name;
const introOf = (p) => (p.page?.intro && p.page.intro !== p.tagline ? p.page.intro : p.tagline);
const faqOf = (p) => p.faq || [];

for (const p of products) {
  const first = p.variants.find((v) => v.stock > 0) || p.variants[0];
  // "Soon" and "Sooner" mean nothing on their own, so the first line always says how long each takes.
  const deliveryText = deliveryOf(p);
  const pre = p.status === "preorder";
  const vp = variantPics(p);
  const lead0 = firstPicFor(p, first);
  const gallery = lead0 ? galleryOf(lead0.jpg, p.gallery, p.id, ground(p)) : galleryOf(null, p.gallery, p.id, ground(p));
  const lead = gallery[0] || lead0;
  const options = (p.options || []).map((o) => `<div class="opt"><span class="label" id="opt-${slugify(o.name)}">${esc(o.name)}</span><div class="chips" role="group" aria-labelledby="opt-${slugify(o.name)}" data-option="${esc(o.name)}">${[...new Set(p.variants.map((v) => v.options[o.name]))].map((val) => `<button type="button" class="chip" data-value="${esc(val)}" aria-pressed="${first.options[o.name] === val}">${esc(val)}</button>`).join("")}</div></div>`).join("");
  const goes = goesWith(p);
  const related = (p.related || []).map((id) => byId[id]).filter(Boolean);
  page({
    file: `${p.id}.html`, title: fitTitle(p.name, p.tagline), imageAlt: altFor(p),
    desc: fitDesc([p.tagline, firstSentence(p.summary), `${priceRange(p)}.`, p.warranty?.months && `${p.warranty.months}-month warranty.`, p.returnable?.ok && "30-day returns.", sentences(p.summary)[1], SHORT_DEMO]),
    crumbs: [["Home", "index.html"], ["Shop", "shop.html"], [p.name, `${p.id}.html`]],
    ld: [{ "@type": "Product", "@id": abs(`${p.id}.html#product`), name: p.name, url: abs(`${p.id}.html`), description: plain(introOf(p)), image: gallery.map((g) => abs(g.jpg)), brand: { "@type": "Brand", name: B.name }, category: catName(p.category), ...(specList(p).length ? { additionalProperty: specList(p).map(([k, v]) => ({ "@type": "PropertyValue", name: plain(k), value: plain(v) })) } : {}) }, faqLd(faqOf(p))],
    bg: lead?.ground || ground(p), active: "Shop", view: "product", image: lead?.jpg || HERO_PIC, preload: lead || "",
    body: `<section class="pdp"><div class="hero-art" aria-hidden="true">${mark("pdp-mark")}</div><div class="wrap pdp-in">
      ${viewer(p, gallery, pic(p, "", null, ground(p)))}
      <div class="pdp-buy" data-product="${p.id}"${vp ? ` data-variant-images="${esc(JSON.stringify(vp))}"` : ""}>
        <h1${isLong(p.name) ? ' class="long"' : ""}>${nameHtml(p.name)}</h1>
        ${p.tagline ? `<p class="tagline">${t(p.tagline)}</p>` : ""}
        <div class="priceline"><span class="big" data-price>${money(first.price)}</span><span class="stock" data-stock></span></div>
        ${options}
        <div class="buyrow">
          <div class="qty"><button type="button" data-step="-1" aria-label="One fewer">−</button><input type="number" min="1" max="20" value="1" data-qty aria-label="Quantity" inputmode="numeric"><button type="button" data-step="1" aria-label="One more">+</button></div>
          ${addBtn(pre ? "Pre-order" : "Add to bag", "data-add")}
        </div>
        <div class="facts">
          ${deliveryText ? fact("Delivery", deliveryText, p.name) : ""}
          ${p.returnable ? fact("Returns", p.returnable.note || (p.returnable.ok ? "30 days, unused." : "Not returnable."), p.name) : ""}
          ${p.warranty?.summary ? fact("Warranty", p.warranty.summary, p.name) : ""}
        </div>
      </div></div></section>
    <div class="wrap pdp-more">
      ${block("about", "About it", `${p.page?.intro && p.page.intro !== p.tagline ? `<p class="lead">${t(p.page.intro)}</p>` : ""}${(p.page?.sections || []).map((s) => `<h3>${t(s.title)}</h3>${paras(s.body)}`).join("")}`)}
      ${block("know", "Good to know", (p.features || []).length ? knowList(p.features) : "")}
      ${block("box", "What's in the box", (p.in_the_box || []).length ? `<ul class="ticks">${p.in_the_box.map((x) => `<li>${icon("tick")}${t(noCodes(x))}</li>`).join("")}</ul>${p.packaging ? `<p class="muted">${t(noCodes(p.packaging))}</p>` : ""}` : "")}
      ${block("arrives", "How it arrives", arrivesHtml(p.arrives))}
      ${block("specs", "Size and details", specRows(p))}
      ${goes.length ? `<section class="more wide" id="goes" data-rise><h2>Goes with it</h2><div class="acards">${goes.map((a, i) => acard(a, i)).join("")}</div></section>` : ""}
      ${block("questions", "Questions", faqOf(p).map((f) => fold(t(f.q), `<p>${t(noCodes(f.a))}</p>`)).join(""))}
      ${block("problems", "If something isn't right", (p.troubleshooting || []).length ? (p.troubleshooting || []).map((x) => fold(t(x.problem), `<ol>${(x.steps || []).map((s) => `<li>${t(s)}</li>`).join("")}</ol>${x.if_unresolved ? `<p><strong>Still not right?</strong> ${t(x.if_unresolved)}</p>` : ""}`)).join("") + `<p class="muted">Bought it already? <a href="account.html#orders">Open your order</a> to return it or report a problem.</p>` : "")}
    </div>
    ${related.length ? `${divider()}<section class="sec"><div class="wrap"><div class="sechead" data-rise><h2>You might also like.</h2></div>${cards(related)}</div></section>` : ""}`,
  });
}

// ---------- accessory pages ----------
for (const a of accessories) {
  const p = a.parent, fits = fitsOf(a);
  // Its own pictures (a.image, a.gallery, acc-<slug>-2.jpg ...). With none yet, a label tile on the parent's colour.
  const gallery = galleryOf(a.img, a.gallery, `acc-${a.slug}`, ground(p));
  const c = gallery[0]?.ground || ground(p);
  page({
    file: a.file, title: fitTitle(a.name, `an extra for ${p.name}`), imageAlt: altFor(a), crumbs: [["Home", "index.html"], ["Shop", "shop.html"], [p.name, `${p.id}.html`], [a.name, a.file]],
    desc: fitDesc([accLine(a), `Fits ${fitsText(a)}.`, `${money(a.price)}.`, "An extra from Overthought & Co.", SHORT_DEMO]),
    ld: [{ "@type": "Product", "@id": abs(`${a.file}#product`), name: a.name, url: abs(a.file), description: plain(accLine(a)), ...(gallery[0] ? { image: gallery.map((g) => abs(g.jpg)) } : {}), brand: { "@type": "Brand", name: B.name }, category: "Spares & add-ons", ...(specList(a).length ? { additionalProperty: specList(a).map(([k, v]) => ({ "@type": "PropertyValue", name: plain(k), value: plain(v) })) } : {}), isAccessoryOrSparePartFor: fitsOf(a).map(({ p: f }) => ({ "@type": "Product", name: f.name, url: abs(`${f.id}.html`) })) }],
    bg: c, active: "Shop", view: "product", image: gallery[0]?.jpg || picFile(p) || HERO_PIC, preload: gallery[0] || "",
    body: `<section class="pdp"><div class="hero-art" aria-hidden="true">${mark("pdp-mark")}</div><div class="wrap pdp-in">
      ${viewer(a, gallery, `<div class="pic tile" style="--c:${c}">${labelTile(a.name)}</div>`)}
      <div class="pdp-buy" data-acc="${esc(a.sku)}">
        <h1${isLong(a.name) ? ' class="long"' : ""}>${nameHtml(a.name)}</h1>
        ${accLine(a) ? `<p class="tagline">${t(accLine(a))}</p>` : ""}
        <div class="priceline"><span class="big">${money(a.price)}</span><span class="stock" data-acc-stock></span></div>
        <div class="buyrow">${addBtn("Add to bag", `data-add-sku="${esc(a.sku)}"`)}</div>
        <div class="facts">
          <div class="fact"><b>Fits</b><span>${fits.map(({ p: f, note }) => `<a href="${f.id}.html">${esc(f.name)}</a>${note ? ` (${esc(note)})` : ""}`).join(", ").replace(/, ([^,]*)$/, " and $1")}</span></div>
          ${a.description && noCodes(a.description) !== accLine(a) ? `<div class="fact"><b>About</b><span>${t(noCodes(a.description))}</span></div>` : ""}
        </div>
        <p class="backlink"><a class="btn ghost small" href="${p.id}.html">${icon("back")} Back to ${esc(p.name)}</a></p>
      </div></div></section>
    ${specList(a).length ? `<div class="wrap pdp-more">${block("specs", "Size and details", specRows(a))}</div>` : ""}
    ${goesWith(p).length > 1 ? `${divider()}<section class="sec"><div class="wrap"><div class="sechead" data-rise><h2>Also goes with ${esc(p.name)}.</h2></div><div class="acards">${goesWith(p).filter((x) => x !== a).map((x, i) => acard(x, i)).join("")}</div></div></section>` : ""}`,
  });
}

// ---------- services (only built when SHOW_SERVICES is on; gift cards are not offered) ----------
if (SHOW_SERVICES) {
  const rulesList = (obj) => `<table class="spec"><tbody>${Object.entries(obj).filter(([k]) => !k.startsWith("_")).map(([k, v]) => `<tr><th>${esc(k.replace(/_/g, " "))}</th><td>${t(Array.isArray(v) ? v.join("; ") : typeof v === "object" ? Object.entries(v).map(([a, b]) => `${a.replace(/_/g, " ")}: ${b}`).join("; ") : String(v))}</td></tr>`).join("")}</tbody></table>`;
  page({ file: "services.html", title: "Services", active: "Services", body: `${titleBlock("Someone to do it for you.")}<div class="wrap">${cards(SERVICE_ORDER.map((id) => svcById[id]).filter(Boolean).map((s) => ({ ...s, variants: s.variants || [{ price: s.packages?.[0]?.price ?? s.items?.[0]?.price_weekend ?? 0 }] })))}</div>` });
  for (const s of services.filter((x) => x.id !== "gift-cards")) {
    let catalogue = "";
    if (s.id === "borrow-box") catalogue = `<ul class="extras">${s.items.map((i) => `<li><div class="grow"><b>${esc(i.name)}</b><p>${t(i.note || (i.includes || []).join(", "))}</p><span class="muted">Deposit ${money(i.deposit)}</span></div><span class="price">${money(i.price_weekend)} weekend · ${money(i.price_week)} week</span></li>`).join("")}</ul>`;
    if (s.id === "someone-to-clap") catalogue = `<ul class="extras">${s.packages.map((k) => `<li><div class="grow"><b>${esc(k.name)}</b><p>${k.clappers} clappers, ${k.minutes} minutes</p></div><span class="price">${money(k.price)}</span></li>`).join("")}${s.add_ons.map((a) => `<li><div class="grow">${esc(a.name)} <span class="status">Add-on</span></div><span class="price">${money(a.price)}</span></li>`).join("")}</ul>`;
    if (!catalogue && s.packages) catalogue = `<ul class="extras">${s.packages.map((k) => `<li><div class="grow"><b>${esc(k.name)}</b>${k.note ? `<p>${t(k.note)}</p>` : ""}</div><span class="price">${money(k.price)}</span></li>`).join("")}</ul>`;
    if (s.id === "fix-club") catalogue = `<table class="spec"><tbody>${products.filter((p) => p.fix_club?.eligible).flatMap((p) => (p.fix_club.repairs.length ? p.fix_club.repairs : [{ name: "Any repair", price: null }]).map((r) => `<tr><th><a href="${p.id}.html">${esc(p.name)}</a></th><td>${esc(r.name)}</td><td>${r.price == null ? "Quoted after assessment" : money(r.price)}</td></tr>`)).join("")}</tbody></table>`;
    const rules = B.services[s.id] ? rulesList(B.services[s.id]) : "";
    const bookable = ["borrow-box", "someone-to-clap", "someone-to-queue", "someone-to-hold", "someone-to-wait-in", "fix-club"].includes(s.id);
    page({
      file: `${s.id}.html`, title: s.name, desc: s.summary, bg: ground(s), active: "Services", view: "service",
      body: `<section class="pdp"><div class="wrap pdp-in"><div class="pdp-pic">${pic(s)}</div><div class="pdp-buy"><h1>${nameHtml(s.name)}</h1><p class="tagline">${t(s.tagline)}</p><p>${t(s.page.intro)}</p>
        ${bookable ? `<p><a class="btn" href="#book">${s.id === "fix-club" ? "Request a repair" : "Check availability and book"}</a></p>` : ""}</div></div></section>
      <div class="wrap pdp-more">
        ${block("how", "How it works", `<ol>${(s.how_it_works || []).map((x) => `<li>${t(typeof x === "string" ? x : x.text || x.title || "")}</li>`).join("")}</ol>`)}
        ${block("offer", s.id === "fix-club" ? "Price list" : "What's on offer", catalogue)}
        ${bookable ? `<section class="more" id="book"><h2>${s.id === "fix-club" ? "Request a repair" : "Book"}</h2><div data-book="${s.id}"><p class="muted">The booking form needs JavaScript.</p></div></section>` : ""}
        ${block("more-details", "The details", s.page.sections.map((x) => `<h3>${t(x.title)}</h3>${paras(x.body)}`).join(""))}
        ${block("rules", "The rules", rules)}
        ${block("faq", "Questions", (s.faq || []).map((f) => fold(t(f.q), `<p>${t(f.a)}</p>`)).join(""))}
      </div>`,
    });
  }
}

// ---------- help ----------
// Topic tiles filter the answers; the search box filters as you type (assets/app.js). Without either, answers show grouped by topic.
const TOPICS = [["delivery", "Delivery", "truck"], ["returns", "Returns", "back"], ["orders", "Orders", "box"], ["products", "Products", "tag"], ["repairs", "Repairs", "wrench"], ["payments", "Payments", "card"], ["account", "Your account", "user"], ["complaints", "Complaints", "chat"], ...(SHOW_SERVICES ? [["bookings", "Bookings", "pin"]] : [])];
const helpTopics = [...TOPICS.filter(([id]) => help.some((h) => h.topic === id)), ...[...new Set(help.map((h) => h.topic))].filter((id) => !TOPICS.some(([x]) => x === id)).map((id) => [id, id[0].toUpperCase() + id.slice(1).replace(/[-_]/g, " "), "alert"])];
const ACTIONS = [
  ["track.html", "pin", "Track an order", "Pick or paste your order number."],
  ["account.html#orders", "back", "Return something", "Open the order, pick the item, choose Return."],
  ["account.html#orders", "alert", "Something's wrong with my order", "Open the order, pick the item, choose Report a problem."],
];
const helpItem = (h) => `<details class="fold" data-help data-topic="${esc(h.topic)}" data-text="${esc((h.q + " " + h.a).toLowerCase())}"><summary>${t(h.q)}</summary><div><p>${t(noCodes(h.a))}</p>${h.policy && policyById[h.policy] ? `<p><a href="policy-${h.policy}.html">Read the ${esc(policyById[h.policy].title.replace(/ policy$/i, "").replace(/^the /i, "").toLowerCase())} policy</a></p>` : ""}</div></details>`;
page({
  file: "help.html", title: "Help: delivery, returns and repairs", active: "Help", view: "help", bg: "#ECE6FB", desc: `${help.length} plain answers about delivery, returns, orders, repairs and payments, plus quick ways to track or return an order.`,
  crumbs: [["Home", "index.html"], ["Help", "help.html"]], ld: [faqLd(help.map((h) => ({ q: h.q, a: h.a })))],
  body: `<section class="help-hero"><div class="hero-art" aria-hidden="true">${mark("hero-mark small")}${confetti(4)}</div><div class="wrap">
    <h1 data-rise>How can we help?</h1>
    <label class="bigsearch" data-rise>${icon("search")}<span class="vh">Search help</span><input type="search" data-help-search placeholder="Search, for example: return" autocomplete="off" enterkeyhint="search"></label>
    <div class="topics" role="group" aria-label="Topics" data-rise>${helpTopics.map(([id, name, ic]) => `<button type="button" class="topic" data-topic-btn="${id}" aria-pressed="false">${icon(ic)}<b>${name}</b><span>${((n) => `${n} answer${n === 1 ? "" : "s"}`)(help.filter((h) => h.topic === id).length)}</span></button>`).join("")}</div>
  </div></section>
  <div class="wrap help-body">
    <div class="answers">
      <div class="answers-bar"><p class="answers-head" data-help-count aria-live="polite">All answers</p><button type="button" class="linkbtn" data-help-reset hidden>Show everything</button></div>
      <div data-help-products></div>
      <div data-help-list>${helpTopics.map(([id, name]) => `<section class="help-group" data-group="${id}"><h2>${name}</h2>${help.filter((h) => h.topic === id).map(helpItem).join("")}</section>`).join("")}</div>
      <div class="empty small" data-help-empty hidden>${icon("search")}<p><strong>Nothing matches that.</strong></p><p class="muted">Try one word, like “delivery” or “refund”, or use one of the actions on this page.</p></div>
    </div>
    <aside class="help-side">
      <h2>Do something</h2>
      <div class="actions">${ACTIONS.map(([href, ic, name, sub]) => `<a class="action" href="${href}">${icon(ic)}<span><b>${name}</b><small>${sub}</small></span>${icon("arrow", "ico go")}</a>`).join("")}</div>
      <h2>Policies</h2>
      <ul class="plain">${["delivery", "returns-and-refunds", "warranty", "cancellation", "damage-and-loss"].filter((id) => policyById[id]).map((id) => `<li><a href="policy-${id}.html">${esc(policyById[id].title)}</a></li>`).join("")}<li><a href="policies.html">All ${policies.length} policies</a></li></ul>
    </aside>
  </div>`,
});

// ---------- policies ----------
page({
  file: "policies.html", title: "All policies in plain English", active: "Help", desc: `All ${policies.length} policies from Overthought & Co.: delivery, returns, warranty, privacy, terms and the rest, written in plain English.`,
  crumbs: [["Home", "index.html"], ["Policies", "policies.html"]],
  body: `${titleBlock("Policies.")}<div class="wrap"><ul class="policy-index">${policies.map((p) => `<li data-rise><a href="policy-${p.id}.html"><b>${esc(p.title)}</b>${p.summary ? `<span>${t(p.summary)}</span>` : ""}${icon("arrow", "ico go")}</a></li>`).join("")}</ul></div>`,
});
for (const p of policies) {
  const rel = String(p.related || "").replace(/[\[\]]/g, "").split(",").map((x) => x.trim()).filter((x) => policyById[x] && x !== p.id);
  page({
    file: `policy-${p.id}.html`, title: fitTitle(p.title, p.summary), desc: fitDesc([p.summary || p.title, `Part of the ${policies.length} plain-English policies from Overthought & Co.`, SHORT_DEMO]), active: "Help",
    crumbs: [["Home", "index.html"], ["Policies", "policies.html"], [p.title, `policy-${p.id}.html`]],
    body: `${titleBlock(p.title + ".", p.summary || "", "Policy")}<div class="wrap doc"><article class="prose policy-body">${md(p.body.replace(/^#{1,3}\s+(.+)\n/, (m, h) => (h.trim().toLowerCase().replace(/ policy$/, "") === p.title.toLowerCase().replace(/ policy$/, "") ? "" : m)))}</article><aside><span class="label">Related</span><ul class="plain">${rel.map((id) => `<li><a href="policy-${id}.html">${esc(policyById[id].title)}</a></li>`).join("")}<li><a href="help.html">Help</a></li><li><a href="policies.html">All policies</a></li></ul></aside></div>`,
  });
}

// ---------- working pages: the frames only. assets/app.js fills them using the business engine. ----------
const shell = (file, title, h, view, sub = "", extra = {}) => page({ file, title, view, ...extra, body: `${extra.top || ""}${titleBlock(h, sub)}<div class="wrap"><div data-app="${view}"><p class="muted">This page needs JavaScript.</p></div></div>` });
shell("bag.html", "Bag", "Your bag.", "bag", "", { active: "Bag", top: steps(0), desc: "What's in your bag.", index: false });
shell("checkout.html", "Checkout", "Checkout.", "checkout", "", { top: steps(1), desc: "Your details, delivery and payment.", index: false });
shell("order.html", "Your order", "Your order.", "order", "", { desc: "The details of one order: items, parcels and what you can do next.", index: false });
shell("track.html", "Track an order", "Track an order.", "track", "Pick one of your orders, or paste an order number.", { active: "Help", desc: "Track an order from Overthought & Co.: pick one of your orders or a demo order, or paste an order number. Orders here are simulated." });
shell("account.html", "Your orders", "Your orders.", "account", "", { active: "Help", desc: "Your orders, returns and repairs.", index: false });

// ---------- 404 ----------
page({
  file: "404.html", title: "Page not found", desc: "That page isn't here.", view: "missing", bg: "#ECE6FB", index: false,
  body: `<section class="lost"><div class="hero-art" aria-hidden="true">${mark("hero-mark small")}${confetti(4)}</div><div class="wrap">
    <h1 data-rise>We've looked everywhere.</h1><p class="sub" data-rise>That page isn't here. It may have moved, or the link has a typo.</p>
    <div class="ctas" data-rise><a class="btn" href="shop.html">Go to the shop ${icon("arrow")}</a><a class="btn ghost" href="help.html">Get help</a></div></div></section>`,
});

// ---------- assets ----------
cpSync(join(here, "assets"), join(out, "assets"), { recursive: true });
// The big cut-out PNGs only go out when a picture has no web version yet (they are the fallback, not the default).
cpSync(join(here, "img"), join(out, "img"), { recursive: true, filter: (src) => {
  const m = src.match(/[\\/]img[\\/]cut[\\/]([^\\/]+)\.png$/);
  return !m || !has(`img/web/${m[1]}-1280.webp`) || !has(`img/web/${m[1]}-640.webp`);
} });
if (existsSync(join(root, "infrastructure/engine/engine.js"))) cpSync(join(root, "infrastructure/engine/engine.js"), join(out, "assets/engine.js"));
// Everything the browser needs, as one script so pages also work when opened straight from disk.
// `items` is display-only (names and pictures for the bag, checkout and orders); the engine never reads it.
const items = {};
for (const p of products) for (const v of p.variants) {
  const pc = firstPicFor(p, v);
  items[v.sku] = { name: p.name, sub: p.variants.length > 1 ? v.name : "", src: pc?.small || "", cut: !!pc?.cut, ground: pc?.ground || ground(p), href: `${p.id}.html`, pre: p.status === "preorder" };
}
for (const a of accessories) { const pc = art(a.img || picFile(a.parent)); items[a.sku] = { name: a.name, sub: "", fits: `For ${fitsText(a)}`, src: pc?.small || "", cut: !!pc?.cut, ground: a.img ? a.ground : ground(a.parent), href: a.file }; }
const policyData = policiesAll.map(({ id, title, summary, body }) => ({ id, title, summary, body }));
writeFileSync(join(out, "assets/data.js"), "window.OT_DATA=" + JSON.stringify({ business: B, products, services, policies: policyData, help: helpAll, seed, items, flags: { services: SHOW_SERVICES, payment_methods: SITE_PAYMENT_METHODS } }) + ";");

// robots.txt and sitemap.xml, from the same SITE_URL as the canonical links.
// The AI crawlers named here are the ones their owners publish (OpenAI, Anthropic, Perplexity); see docs/seo-notes.md.
const AI_BOTS = ["OAI-SearchBot", "ChatGPT-User", "GPTBot", "Claude-SearchBot", "Claude-User", "ClaudeBot", "PerplexityBot", "Perplexity-User"];
writeFileSync(join(out, "robots.txt"), `User-agent: *\nAllow: /\n\n${AI_BOTS.map((b) => `User-agent: ${b}\nAllow: /\n`).join("\n")}\nSitemap: ${abs("sitemap.xml")}\n`);
writeFileSync(join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.map((f) => `  <url><loc>${abs(f === "index.html" ? "" : f)}</loc><lastmod>${BUILD_DATE}</lastmod></url>`).join("\n")}\n</urlset>\n`);

// llms.txt (llmstxt.org format) and llms-full.txt: standalone plain-text files for AI assistants, from the same records.
const polName = (p) => p.title;
writeFileSync(join(out, "llms.txt"), `# ${B.name}

> ${B.name} is a fictional shop whose motto is "${B.tagline}" It sells ${products.length} ordinary things that have been properly thought through, such as The Emergency Sandwich, The Spare Sock and Blip, a very small phone. It is a demonstration company, built for testing AI products on a realistic business: nothing here is really for sale, and orders are simulated. The complete text of every product and policy is in ${abs("llms-full.txt")}.

## Products

${products.map((p) => `- [${p.name}](${abs(`${p.id}.html`)}): ${plain(p.tagline || p.summary)}`).join("\n")}

## Policies

${policies.map((p) => `- [${polName(p)}](${abs(`policy-${p.id}.html`)}): ${plain(p.summary || p.title)}`).join("\n")}

## Help

- [Help](${abs("help.html")}): ${help.length} answers about delivery, returns, orders, repairs and payments.
- [Track an order](${abs("track.html")}): Look up an order by picking it or pasting its number.

## Optional

- [Shop](${abs("shop.html")}): All products and extras on one page.
- [All policies](${abs("policies.html")}): Index of every policy.
- [Full text of the site](${abs("llms-full.txt")}): Every product and policy in one Markdown file.
`);
const policyMd = (p) => p.body.replace(/^#{1,3}\s+(.+)\n/, (m, h) => (h.trim().toLowerCase().replace(/ policy$/, "") === p.title.toLowerCase().replace(/ policy$/, "") ? "" : m))
  .replace(/^(#{1,3})\s/gm, (m, h) => "#".repeat(h.length + 3) + " ")
  .replace(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g, (m, u) => { const id = (u.match(/^policy-([a-z-]+)\.html/) || [])[1]; return id && !policyById[id] ? "](" + abs("policies.html") + ")" : `](${abs(u)})`; });
const productMd = (p) => {
  const sec = (h, lines) => (lines.length ? `\n#### ${h}\n\n${lines.join("\n")}\n` : "");
  const list = (a) => a.map((x) => `- ${plain(noCodes(x))}`);
  const price = p.variants.length > 1 ? p.variants.map((v) => `${v.name}: ${money(v.price)}`).join("; ") : money(p.variants[0].price);
  return `### ${p.name}

URL: ${abs(`${p.id}.html`)}
${plain(p.tagline)}
Price shown on the site (for demonstration only, not really for sale): ${price}.
${sec("About", [plain(introOf(p)), ...(p.page?.sections || []).map((s) => `**${plain(s.title)}.** ${plain(s.body)}`)].filter(Boolean))}${sec("Good to know", list(p.features || []))}${sec("What's in the box", [...list(p.in_the_box || []), ...(p.packaging ? [plain(noCodes(p.packaging))] : [])])}${sec("How it arrives", [plain(noCodes(Array.isArray(p.arrives) ? p.arrives.join(" ") : p.arrives || ""))].filter(Boolean))}${sec("Delivery", [deliveryOf(p)].filter(Boolean))}${sec("Returns", p.returnable ? [plain(p.returnable.note || (p.returnable.ok ? "30 days, unused." : "Not returnable."))] : [])}${sec("Warranty", p.warranty?.summary ? [plain(p.warranty.summary)] : [])}${sec("Questions", faqOf(p).map((f) => `**${plain(f.q)}** ${plain(noCodes(f.a))}`))}`;
};
writeFileSync(join(out, "llms-full.txt"), `# ${B.name}: full text

> ${DEMO} ${B.tagline} This file holds the full text of every product and policy on ${abs()}. Prices are shown on the site for demonstration only.

## Products

${products.map(productMd).join("\n")}
## Policies

${policies.map((p) => `### ${p.title}\n\nURL: ${abs(`policy-${p.id}.html`)}\n\n${policyMd(p)}\n`).join("\n")}`);

const missing = accessories.filter((a) => !a.img).length;
console.log(`Built ${pages.length} pages into ${out.startsWith(here) ? "business/site/" + out.slice(here.length + 1) : out}${missing ? ` (${missing} accessories still without a picture)` : ""}`);
