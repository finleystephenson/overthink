# The sandbox: design rules

The sandbox is Expanza's environment for testing AI on a realistic business. Inside it sits the business being tested: today, Overthought & Co. Every screen shows both layers, and the difference should need no explaining.

| Layer | Whose | Owns | Looks like |
|---|---|---|---|
| **The sandbox** (the frame) | Expanza | The clock, connecting an AI, jobs, tests, the result against the same business left alone, start again. The first screen (`index.html` + `home-b/`) and Control Room are its views. | The Expanza site: cool paper, navy ink, hairlines, Bricolage Grotesque, Geist, Geist Mono, pill buttons. |
| **The business** (inside) | Overthought & Co. | Its twelve tools (`layer: "business"` in `apps.json`). | The same calm frame. Only the business's own things carry its brand: the spiral, the name in Anybody, product photos, its posts, its newspaper. |

## Files

| File | What it is |
|---|---|
| `lib/bar.css` | The sandbox bar, its menus and the day card. Self-contained (own `--sb-*` tokens, fonts, dark mode). Imported by both stylesheets below. |
| `lib/topbar.js` | Draws the bar on every screen (`startApp()` calls it). Same API as before: `runDays`, `play`, `pause`, `busy`, `now`. |
| `lib/premium.css` | **The new base.** Tokens, type ladder, buttons, inputs, chips, cards, rows, avatars, pills, empty and loading states, toasts, slide-over, menus, records, chart colours, focus, motion. An app that has moved loads this **instead of** `lib/ui.css`. |
| `lib/ui.css` | The old base. Still loaded by apps not yet moved. Do not add to it. |
| `lib/icons.js` | App icons (`appIcon`) and interface icons (`icon`). |
| `lib/expanza.js`, `lib/connect.js` | Expanza's wordmark and star; making a key and its ready-to-paste settings. |
| `apps.json` | Each app's `name`, `plain` (what it is in plain words), `layer` (`business` or `sandbox`), `accent`, `icon`. |

## Hard rules (with numbers)

**Colour**
1. A screen uses ink, paper and greys, plus at most **two** signal colours: the spark `#FF653C` (only for "this does something" or "this is new") and good/bad (only for results). Count them: three or more colours on one screen is a fail.
2. App accents appear **only** inside app icons. Never as backgrounds, buttons, headings, sidebars or chart fills.
3. Text contrast is at least **4.5:1** for text under 18px, **3:1** above. Grey labels use `--x-ink-2` (`#55607A` on paper), never lighter.
4. Badges and pills move background and text together (`--x-bad-bg` with `--x-bad`). One coloured pill per row at most.

**Type**
5. Two families on a screen: **Bricolage Grotesque** (titles, big numbers) and **Geist** (everything else), plus **Geist Mono** for small labels, times and figures in tables. Anybody 900 is for the business's name only.
6. The ladder, and nothing in between: **display** 40–80px (one per screen), **title** 24px, **heading** 19px, **body** 15px (14.5px in dense lists), **small** 13.5px, **label** 12.5px mono. Line height 1.5 for body, 1.0–1.15 for titles.
7. Weights **400 to 600** only. Bricolage 600 for titles, Geist 400 for text, 500 for emphasis. Never 700+.
8. Numbers in tables, timers and money use tabular figures. Money is right-aligned. The biggest number on an app screen is **28–34px** (not 60, not 90).
9. Sentence case. No uppercase labels, no letter-spaced headings.

**Shape and space**
10. Three radii: **6–8px** (rows, inputs, chips, small cards), **12–14px** (cards, panels, menus, popovers), **99px** (pill buttons and segmented controls).
11. Rows: **44px** for one line, **56–64px** for two lines. Never three lines in a list row.
12. Spacing on a 4px grid. Card padding 14–20px; page gutter `clamp(16px, 4.6vw, 72px)`; gaps between cards 8–12px.
13. Separate rows with hairlines (`1px var(--x-rule-soft)`), not boxes. Cards are a 1px ring, no fill change.
14. **Shadows only on things that float**: menus, popovers, the day card, toasts, the slide-over. Never on buttons, cards or tiles.

**Behaviour**
15. One primary action per view (an ink pill). Everything else is an outline pill or a link.
16. Every list works by keyboard: Up/Down (or J/K) move, Enter opens, Escape closes, single letters act on the selected item (for example R reply, E archive). Focus is always visible: a 2px spark ring drawn with `box-shadow` so it follows the radius.
17. Respond within **100ms**: change the screen first (optimistic), then confirm; on failure, put it back and say why next to what was touched.
18. Feedback sits beside what you touched: "Copied" on the copy button, an error under the field, "Sent" where the message was. Toasts only for things that happen away from the pointer (time moved, an AI acted).
19. Empty states are one quiet line of text (and the next thing to do, if there is one). No illustrations.
20. Motion: **150–250ms** with `--x-ease`, no bounce. No animation on frequent actions (moving a day, selecting a row, typing). One moment per screen may move more: on the first screen, the Run. Respect `prefers-reduced-motion` (premium.css already stops everything).

**Words**
21. Plain English a 12-year-old can follow. Short sentences, one idea each.
22. An app's name never stands alone: "Kettle · Staff chat" (`plainName(app)` in `topbar.js`, or `app.plain`).
23. No codes (ORD-, CT-, EM-...) anywhere a person reads: use `lib/plain.js`. Technical words (MCP, key, API, token) only inside "Connect your AI".
24. Results are always "against the same business left alone", with the difference as the headline figure.

## Tokens (`lib/premium.css`, on `:root`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--x-paper` | `#F4F6FA` | `#070D1C` | page |
| `--x-card` | `#FFFFFF` | `#0E1830` | cards, inputs |
| `--x-tint` | `#E7ECF5` | `#142041` | hover, selected row, code, quiet fills |
| `--x-ink` | `#0B1730` | `#EAF0FA` | text, marks, primary pills |
| `--x-ink-2` | `#55607A` | `#9AA9C6` | secondary text, labels |
| `--x-rule` / `--x-rule-soft` | `#CFD7E6` / `#E1E7F0` | 16% / 9% white | lines you see / row dividers, card rings |
| `--x-night` | `#0A1226` | `#111D3A` | the one dark surface (toasts, day card) |
| `--x-spark` | `#FF653C` | same | "this does something" / "new" |
| `--x-good`, `--x-bad` (+ `-bg`) | `#1F7A4D`, `#B8401B` | `#6FD3A0`, `#FF9A78` | results only |
| `--chart-you`, `--chart-alone` | ink, ink-2 dashed | | the two lines of any comparison |
| `--x-display`, `--x-text`, `--x-mono` | Bricolage, Geist, Geist Mono | | |
| `--x-ease` | `cubic-bezier(.2, .75, .2, 1)` | | every transition |

The old token names (`--page`, `--ink`, `--panel`, `--line`...) are mapped onto these, so shared parts keep working.

## Components (class names; the same names `lib/ui.js` already writes)

`.btn` (outline pill) · `.btn.primary` (ink pill) · `.btn.small` · `.btn.ghost` · `.input` `.select` `.textarea` · `.field` · `.pm-chip` (one choice among a few) · `.card` · `.list` · `.pm-row` (selectable row, 44px, tint when selected) · `.avatar` (one tint, no rainbow) · `.pill` (status, 22px, square-ish) · `.empty` (one line) · `.skel` · `.toast` · `.over` (slide-over) · `.menu` · `.rec-*` (records) · `.pm-label` (mono label) · `.pm-h1` `.pm-h2` `.pm-h3` · `.pm-pill` (`.line`, `.small`) · `.pm-code` (connect panel only) · `.pm-app-name` ("Kettle · Staff chat").

## Icons

- One mark per app on a 24-unit grid, live area 3–21, built from one idea anyone knows. Two weights only: solid ink shapes and 2-unit round strokes; detail is cut out of the ink (1.2–1.5 units).
- At most one touch of the app's colour, and it means something (the unread dot, the bell's button, the strike through the tally).
- Plain tile: paper (night in dark mode), 1px ring, radius 27% of size. No gradients, no gloss, no shadow. Sizes: 24 (bar), 28 (menus), 40 (lists). Check new marks at 28px on paper and night: `/apps/home-a/icons.html`.

## Every app screen

```
┌ expanza✳ Sandbox │ Business ◎ Overthought & Co. / [icon] Kettle · Staff chat     [Mon 23 Nov 2026 10:00 ▶ 1× Day Week]  +£10 against left alone  Connect your AI  ⋯ ┐
│                                                                                                                                                                 │
│  the app: a familiar layout (a mail app looks like a mail app), calm, in the rules above                                                                       │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The bar comes from `startApp({ id })`; the app draws nothing of its own above its content except, if it needs one, a single 24px title. A page can quiet the bar: `data-quiet-days` on `<body>` hides the day card (for screens that show the days themselves), `data-quiet-reset` stops the "back where it started" message.

## Patterns to copy (from Letterbox, the template)

Letterbox (`letterbox/app.css`, `letterbox/app.js`) is the first app moved to `premium.css`. Copy these exactly.

**Panes.** Three columns that each scroll on their own, under the bar: rail 232px (paper), list 320–400px (card white), reader the rest (paper). Height `calc(100dvh - var(--sb-h))`, `body { overflow: hidden }`. Panes are separated by one `1px var(--x-rule-soft)` line, never by shadows or fills. Below 860px: one pane at a time (`data-view="list" | "read"`), the rail slides in from the left over a scrim.

**Rail.** One ink pill at the top for the main action ("New message"), full width, 40px. Section labels in mono 12.5px ink-2, sentence case ("Shared", "People"). Rows 34px, radius 8, 14.5px text, an 18px grey icon or a 22px grey tile; the selected row is `--x-tint` with weight 500. Counts are mono 12.5px, right-aligned, hidden at zero. No coloured tiles: every box wears the same grey tile and its name says which it is.

**List.** A 22px Bricolage title and a mono 12.5px line under it ("hello@" / "Inbox"). Search: 36px, radius 8, paper fill, 1px ring, ink ring on focus, `/` focuses it. Rows: **60px, two lines, no avatar.** Line 1: who (14.5px) and when (mono 12.5px, right). Line 2: subject in ink, then " · " and the opening words in ink-2, one line, ellipsis. Unread is weight 600 on who and subject, and the time turns ink: no dot, no colour. Selection is `--x-tint`; hover is `--hover`. Record chips (order, case) are not in rows; they belong to the open item.

**Reader.** A 52px action bar: the primary action as an ink pill (Reply), the rest as quiet text buttons with 16px icons (below 1180px, icons only, with their names as labels). Content column max 720px. Title Bricolage 600 24px. Record chips under the title (`lib/records.js`). Each message: 32px avatar, name 500 15px, address and "to" in ink-2 13px, time mono 12.5px right, body 15px/1.6 at max 66ch, indented 44px. Older messages fold to one line with a grey preview.

**Composer.** In place for replies: a 48px "Reply to …" line opens into a ringed box with a textarea (min 140px), an ink "Send", a quiet "Save draft", and the shortcut shown as `<kbd>⌘</kbd> <kbd>Enter</kbd> sends`. New messages: a sheet fixed bottom right, 540px, radius 12, the floating shadow, fields as 42px lines with mono labels, body 15px/1.6.

**Empty and loading.** Empty list: one line from `emptyState({ title, text })` with no `art`. Nothing open: one centred line and the keys that work ("<kbd>J</kbd> and <kbd>K</kbd> move…"). Loading: `skeleton(n)` grey bars, no shimmer colours.

**Keyboard.** One `keydown` listener on `document`, ignored while typing in a field (Escape leaves the field). J/K or Up/Down move and open; R reply; F forward; E archive; U unread; # or Delete to the bin; / search; N or C new; Escape back. Actions press the real buttons (`[data-act]`) so a key and a click do exactly the same thing.

**Feedback.** Each action changes the list first (the row leaves in 180ms), then confirms with a short toast ("Sent.", "Filed in the archive."). Where a sheet sits bottom right, toasts move bottom left (`.toasts { left: 20px; right: auto }`) so they never cover what you are working on. A new item arriving gets a 600ms `--x-wash` fade; nothing else animates.

## How to re-skin an app (checklist)

1. In its `index.html`: replace `../lib/ui.css` with `../lib/premium.css`; load the fonts link from `index.html` (Bricolage, Geist, Geist Mono; Anybody only if it shows the business's name).
2. Open it at 1440, 1024 and 390, light and dark. Fix only layout in `app.css`; parts come from `premium.css`.
3. Delete from `app.css` everything on the list below.
4. Rows to 44px (one line) or 56–64px (two). Two text weights in a row at most.
5. Biggest number 28–34px. Money right-aligned, tabular.
6. Keyboard: Up/Down, Enter, Escape, one letter per main action, a visible focus ring.
7. Every action: optimistic change, inline feedback beside it, rollback on failure.
8. Every name of an app with its plain words; no codes; no technical words.
9. Screenshot, compare with Letterbox (the template), fix, repeat.
10. Build the new version in a scratch copy (`applications/<id>-next/`, same `APP_ID`), test it, then copy it over the app and delete the copy, so nobody watching sees a half-done screen.

## Delete from the old look

- Anybody 900 headings (`.h1` `.h2` in Anybody, `font-stretch: 125%`, weights 800–900) anywhere except the business's name.
- Candy colours: coloured sidebars, coloured composer outlines, pastel tiles, `--app` as a background, coloured avatars (`colourFor`).
- Glossy or gradient app tiles; gradient rings; gradient chart fills and progress bars.
- Cartoon empty-state illustrations (envelope, bell, kettle drawings).
- Shadows on buttons and cards (`box-shadow` with blur on anything that does not float).
- Oversized numbers (60–90px figures), stat tiles that repeat what a list already says.
- Stacked chips (more than one coloured chip per row), notification dots that duplicate a count.
- Bouncy motion (`--spring`), animations on frequent actions, the flip-clock date.

## Learned re-skinning Kettle, Squint, Mutter, The Daily Overthinker, Filing Cabinet, Control Room (22 Nov)

- **Build beside, swap whole.** `apps/_next-<id>/` works unchanged (imports are `../lib/...`); copy its files over the app when finished, then delete the folder. Delete retired files by hand (`control-room/impact-panel.js` is gone).
- **Social parts live in `lib/social.css`** (new): like/repost controls, "Written by", stand-ins, the "What this post did" table and the account charts. Squint and Mutter load it after `premium.css`. `lib/social.js` now draws "What this post did" as a ruled table (people who saw it, likes, reposts, comments, visits, orders, "heading for N", why in plain words, whether the writing was scored), pass `now` so a post the simulator made says "only likes and comments are counted" instead of "move on a day". `burst()` is now a no-op; customers' stand-ins are one tint with ink initials.
- **The business's own identity sits inside the frame, small and exact:** its spiral in a ringed circle and its name in Anybody 900 at 22–28px on its own accounts; its pictures shown whole on a backdrop sampled from the picture's own corner (Squint's viewer).
- **Tabs on an account page** are words with a 2px ink underline and the waiting count in mono beside the word: no icons, no dots.
- **A newspaper may have its own voice** (Newsreader serif for masthead, headlines and story text) but every control around it, the trade effects and the editor's desk stay in the frame's type. No drawn spot art: a story prints without a picture rather than with a cartoon. Variables a panel needs (`--serif`) go on `:root`, because slide-overs and desks are appended to `<body>`, outside the page.
- **Two presses for anything destructive** (call an event off, stop a job, start again): the button's own words change to "Press again to …" for a few seconds. No hold-to-confirm rings.
- **Answers beside the button**, in a `…-said` line that turns good or bad (the desk, the levers, a key made, start again). Toasts only for things that happen elsewhere (an AI acted, a new paper is out).
- **Control Room** reads job routes as the owner (`/sandboxes/:id/jobs`, `/jobs/:job/result?voices=all`, `/stop`) and reuses `home-b/run.js` (`drawChart`, `profitPoints`), `home-a/business.js` (`didWords`) and `lib/impact.js` (`GROUPS`, `headline`).
- The sandbox bar's Day button is `.sbar-next` (was `.ctl-next`); `lib/social.js`'s "Move on a day" now looks for both.
