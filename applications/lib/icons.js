// Drawings for Overthought & Co.'s apps: calm, exact, ink first.
//  - app icons: one simple mark per app on a 24-unit grid, drawn in solid ink with fine cuts, on a plain paper tile
//    with a hairline ring. Each mark carries at most one small touch of its app's own colour, and that touch always
//    means something (the unread dot, the bell's button, the strike through the tally). No gradients, no gloss.
//    The tile is styled inline so the new look holds in every app before the shared CSS is re-skinned; a page
//    restyles it through --ot-icon-tile, --ot-icon-ink, --ot-icon-ring and --ot-icon-cut (see lib/premium.css).
//  - small interface icons: 24-unit, 1.75 stroke, no fills, for buttons.

/** The spiral "O" from business/brand/mark.svg, as a path on a 24-unit grid. */
export const SPIRAL_PATH = "M12 2C12.49 2.11 14.02 2.3 14.93 2.65C15.84 3.01 16.73 3.52 17.47 4.12C18.22 4.72 18.9 5.47 19.42 6.25C19.94 7.03 20.35 7.92 20.61 8.8C20.87 9.68 20.98 10.63 20.97 11.53C20.95 12.43 20.78 13.35 20.5 14.18C20.22 15.01 19.79 15.82 19.28 16.52C18.78 17.21 18.14 17.84 17.47 18.33C16.79 18.83 16.01 19.23 15.24 19.49C14.47 19.75 13.63 19.9 12.83 19.91C12.04 19.93 11.21 19.82 10.47 19.6C9.72 19.38 8.99 19.04 8.36 18.62C7.73 18.2 7.16 17.66 6.7 17.08C6.24 16.51 5.86 15.84 5.6 15.18C5.34 14.51 5.19 13.78 5.15 13.09C5.1 12.39 5.18 11.67 5.34 11.02C5.5 10.36 5.78 9.72 6.12 9.16C6.46 8.6 6.91 8.09 7.39 7.67C7.87 7.26 8.43 6.91 9 6.67C9.56 6.42 10.18 6.27 10.77 6.21C11.36 6.15 11.98 6.19 12.54 6.31C13.1 6.43 13.65 6.65 14.13 6.92C14.62 7.19 15.06 7.56 15.42 7.95C15.79 8.34 16.16 9.05 16.31 9.27";

/** The spiral mark as an inline SVG. */
export function spiral({ size = 28, cls = "" } = {}) {
  return `<svg class="spiral ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${SPIRAL_PATH}" fill="none" stroke="currentColor" stroke-width="3.3" stroke-linecap="round"/></svg>`;
}

/** Cuts: negative space in the tile's own colour, so a mark reads as one shape with lines carved into it. */
const CUT = "var(--ot-icon-cut, var(--ot-icon-tile, #fff))";
/** The app's own colour: the one small touch each mark is allowed. */
const TOUCH = "var(--accent)";
const INK = 'fill="currentColor" stroke="none"';

/**
 * The marks. Grid: 24 units, live area 3 to 21. Two weights only: solid shapes, and 2-unit round strokes.
 * Cuts are 1.2 to 1.5 units. Every mark is built from one idea a stranger already knows.
 */
const GLYPHS = {
  // An envelope with the unread dot.
  letterbox: `
    <rect x="3" y="6" width="18" height="13" rx="2.6" ${INK}/>
    <path d="M5.6 8.6 12 13.1l6.4-4.5" stroke="${CUT}" stroke-width="1.5"/>
    <circle cx="19.4" cy="6.4" r="3.1" fill="${TOUCH}" stroke="${CUT}" stroke-width="1.5"/>`,

  // A counter bell; its button is the touch of colour.
  "front-desk": `
    <circle cx="12" cy="6.6" r="1.9" fill="${TOUCH}" stroke="none"/>
    <path d="M12 8.4v1.4" stroke-width="1.8"/>
    <path d="M4.4 16.8a7.6 7.6 0 0 1 15.2 0Z" ${INK}/>
    <rect x="3" y="17.8" width="18" height="2.4" rx="1.2" ${INK}/>`,

  // A kettle; its steam is a speech bubble.
  kettle: `
    <path d="M7.6 11h8.8l2.4 8.6a.8.8 0 0 1-.8 1H6a.8.8 0 0 1-.8-1Z" ${INK}/>
    <path d="M8.8 11.2a3.2 3.2 0 0 1 6.4 0" stroke-width="1.8"/>
    <path d="M17.6 13.6h1.2a1.6 1.6 0 0 1 1.6 1.6v.4a1.6 1.6 0 0 1-1.6 1.6h-.4" stroke-width="1.6"/>
    <path d="M6.4 13.6 3.6 11.4" stroke-width="1.8"/>
    <path d="M16.2 2.4h3.8a1.3 1.3 0 0 1 1.3 1.3v1.9a1.3 1.3 0 0 1-1.3 1.3h-1.4l-1.9 1.5V6.9h-.5a1.3 1.3 0 0 1-1.3-1.3V3.7a1.3 1.3 0 0 1 1.3-1.3Z" fill="${TOUCH}" stroke="none"/>`,

  // A camera lens; the glass is the touch of colour.
  squint: `
    <rect x="14.6" y="3" width="5.4" height="3" rx="1.2" ${INK}/>
    <circle cx="12" cy="13" r="8.4" ${INK}/>
    <circle cx="12" cy="13" r="4.6" fill="${TOUCH}" stroke="${CUT}" stroke-width="1.5"/>
    <circle cx="13.6" cy="11.4" r="1.1" fill="${CUT}" stroke="none"/>`,

  // A speech bubble with a mumble in it.
  mutter: `
    <path d="M6 4.5h12a3 3 0 0 1 3 3v6.2a3 3 0 0 1-3 3h-6.6l-4.6 3.6v-3.6H6a3 3 0 0 1-3-3V7.5a3 3 0 0 1 3-3Z" ${INK}/>
    <path d="M6.8 10.6c1.1-1.6 2.1-1.6 3.1 0s2.1 1.6 3.1 0 2.1-1.6 3.1 0" stroke="${TOUCH}" stroke-width="1.6"/>`,

  // A newspaper: headline, picture, columns.
  news: `
    <rect x="3.5" y="3" width="17" height="18" rx="2.2" ${INK}/>
    <path d="M6.5 6.8h11" stroke="${CUT}" stroke-width="2.2" stroke-linecap="butt"/>
    <rect x="6.2" y="10" width="5.4" height="4.6" rx=".8" fill="${TOUCH}" stroke="none"/>
    <path d="M14 10.8h3.6M14 13.8h3.6M6.6 17.6h11" stroke="${CUT}" stroke-width="1.2"/>`,

  // A price tag; the hole is the touch of colour.
  till: `
    <path d="M11.4 3.2h6.6a2.8 2.8 0 0 1 2.8 2.8v6.6a1.4 1.4 0 0 1-.4 1l-8 8a1.8 1.8 0 0 1-2.6 0l-6.4-6.4a1.8 1.8 0 0 1 0-2.6l8-8a1.4 1.4 0 0 1 1-.4Z" ${INK}/>
    <circle cx="16.4" cy="7.6" r="1.9" fill="${TOUCH}" stroke="${CUT}" stroke-width="1.2"/>`,

  // Boxes on boxes; the top box's tape is the touch of colour.
  stockroom: `
    <rect x="3" y="12.6" width="8.6" height="8" rx="1.4" ${INK}/>
    <rect x="12.4" y="12.6" width="8.6" height="8" rx="1.4" ${INK}/>
    <rect x="7.7" y="3.6" width="8.6" height="8" rx="1.4" ${INK}/>
    <path d="M12 3.6v3.2" stroke="${TOUCH}" stroke-width="1.8" stroke-linecap="butt"/>
    <path d="M7.3 12.6v2.6M16.7 12.6v2.6" stroke="${CUT}" stroke-width="1.4" stroke-linecap="butt"/>`,

  // Four marks and a strike: the oldest kind of accounts.
  tally: `
    <path d="M5.6 4.5v15M10 4.5v15M14.4 4.5v15M18.8 4.5v15" stroke-width="2.2"/>
    <path d="M3 16.4 21 7.6" stroke="${CUT}" stroke-width="4.6"/>
    <path d="M3 16.4 21 7.6" stroke="${TOUCH}" stroke-width="2.2"/>`,

  // A loudhailer; the sound is the touch of colour.
  megaphone: `
    <path d="M3.6 9.8 13 5.6v12.8l-9.4-4.2Z" ${INK} stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <rect x="12.2" y="4" width="3" height="16" rx="1.5" ${INK}/>
    <path d="M6.4 14.6 7.6 19" stroke-width="1.8"/>
    <path d="M18.2 9.4a3.6 3.6 0 0 1 0 5.2M20.4 7.2a6.8 6.8 0 0 1 0 9.6" stroke="${TOUCH}" stroke-width="1.6"/>`,

  // The team: three people, the one in front in colour.
  rota: `
    <circle cx="6" cy="9.4" r="2.4" ${INK}/>
    <path d="M1.8 19.6a4.2 4.2 0 0 1 8.4 0Z" ${INK}/>
    <circle cx="18" cy="9.4" r="2.4" ${INK}/>
    <path d="M13.8 19.6a4.2 4.2 0 0 1 8.4 0Z" ${INK}/>
    <circle cx="12" cy="7.4" r="3.2" fill="${TOUCH}" stroke="${CUT}" stroke-width="1.4"/>
    <path d="M6.4 20.6a5.6 5.6 0 0 1 11.2 0Z" ${INK} stroke="${CUT}" stroke-width="1.4"/>`,

  // A cabinet with a file standing up in the top drawer.
  filing: `
    <path d="M7.4 9V4.4a1 1 0 0 1 1-1h2.8l1.2 1.4h3.2a1 1 0 0 1 1 1V9Z" fill="${TOUCH}" stroke="none"/>
    <rect x="4.5" y="7.4" width="15" height="13.6" rx="2" ${INK}/>
    <path d="M4.5 14.2h15" stroke="${CUT}" stroke-width="1.2"/>
    <path d="M10 10.8h4M10 17.6h4" stroke="${CUT}" stroke-width="1.6"/>`,

  // Rummage, the search engine: a magnifying glass dipped into a crate. The glass is the touch of colour.
  rummage: `
    <path d="M3.5 12.2h17v7a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8Z" ${INK}/>
    <path d="M9.4 16.4h5.2" stroke="${CUT}" stroke-width="1.6"/>
    <path d="M13.4 10.4 16.6 13.6" stroke-width="2.6"/>
    <circle cx="10.2" cy="7.2" r="4.3" fill="${TOUCH}" stroke="currentColor" stroke-width="2"/>`,

  // A stopwatch; the time that has passed is the touch of colour (the spark, because Control Room's accent is ink).
  control: `
    <rect x="9.6" y="1.6" width="4.8" height="2.4" rx="1.2" ${INK}/>
    <path d="M12 4v1.6M18.2 6.2l1.3-1.3" stroke-width="1.8"/>
    <circle cx="12" cy="13.2" r="8.2" ${INK}/>
    <path d="M12 13.2V7.6a5.6 5.6 0 0 1 4.85 8.4Z" fill="#FF653C" stroke="none"/>
    <circle cx="12" cy="13.2" r="1.3" fill="${CUT}" stroke="none"/>`,
};

/**
 * An app's icon: its mark on a plain tile.
 * @param {{icon: string, accent: string, id?: string}} app an entry from apps.json
 * @param {{size?: number}=} options
 * @return {string} HTML
 */
export function appIcon(app, { size = 64 } = {}) {
  // WHY inline styles: they override the old glossy tile in lib/ui.css without editing it, so every app shows
  // the same icons today. The variables let a page set the tile for dark mode (lib/premium.css does).
  const tile = `--accent:${app.accent};--size:${size}px;color:var(--ot-icon-ink,#0B1730);`
    + "background:var(--ot-icon-tile,#fff);box-shadow:inset 0 0 0 1px var(--ot-icon-ring,#CFD7E6);border-radius:calc(var(--size) * .27)";
  return `<span class="app-icon ot-icon" data-icon="${String(app.icon).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}" style="${tile}" aria-hidden="true">
    <svg viewBox="0 0 24 24" style="width:64%;height:64%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[app.icon] || GLYPHS.filing}</svg>
  </span>`;
}

const UI = {
  play: '<path d="M8 5.5v13l10.5-6.5Z" fill="currentColor" stroke-linejoin="round"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="2.6"/>',
  next: '<path d="M6 6l7 6-7 6Z" fill="currentColor"/><path d="M17 6v12" stroke-width="2.2"/>',
  week: '<path d="M4 6l6 6-6 6Z M11 6l6 6-6 6Z" fill="currentColor"/><path d="M20 6v12" stroke-width="2.2"/>',
  grid: '<circle cx="6" cy="6" r="1.6" fill="currentColor"/><circle cx="12" cy="6" r="1.6" fill="currentColor"/><circle cx="18" cy="6" r="1.6" fill="currentColor"/><circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/><circle cx="6" cy="18" r="1.6" fill="currentColor"/><circle cx="12" cy="18" r="1.6" fill="currentColor"/><circle cx="18" cy="18" r="1.6" fill="currentColor"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  plug: '<path d="M9 3.5v4M15 3.5v4M6.5 7.5h11V11a5.5 5.5 0 0 1-11 0Z"/><path d="M12 16.5v4"/>',
  bolt: '<path d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12Z"/>',
  home: '<path d="M4 11 12 4.5 20 11v8.5H4Z"/><path d="M10 19.5v-5h4v5"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
};

/**
 * A small interface icon.
 * @param {string} name one of the keys in UI
 * @param {{size?: number}=} options
 * @return {string} HTML
 */
export function icon(name, { size = 18 } = {}) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI[name] || ""}</svg>`;
}
