# applications/: the company computer

The screens of Overthought & Co.: a home screen, one app per job (mail, help desk, staff chat, social, news, shop, stock, accounts...), and the Control Room, which runs the simulator. Static files only: HTML, CSS and plain ES modules. No framework, no build step, no dependencies.

```bash
node applications/dev.mjs            # http://127.0.0.1:8790/apps/   (--port to change it)
```

The real server (`infrastructure/server/main.mjs`) serves the apps (`/apps/`), the pictures (`/img/`), the web API and MCP from one port. `dev.mjs` is a thin wrapper that starts it with the defaults the apps are built against (port 8790, `--plugins events`); any other `infrastructure/server/main.mjs` option passes straight through. Opening `/` in a browser goes to Rummage, the company's search engine (`applications/home/`).

## How it fits together

```
applications/
  apps.json            every app: id, name, description, accent, icon, status, roles. Names live ONLY here.
  home/                Rummage, the company's search engine and front door (served at /): search across every tool,
                       the tools grid, and your AI's actions and their effect, live during `overthink run --live`
  index.html           sends old links on to home/
  control-room/        the simulator's app: clock, try something (price, marketing, hours, event), impact, the business now,
                       every action, connect your AI, start again (app.js, try.js, impact-panel.js)
  soon/                the placeholder for apps whose status is "soon"
  _template/           a small working app to copy
  lib/
    client.js          the one way an app reaches a world (see below)
    ui.css             the design system: tokens (light and dark), type, parts, the top bar, motion
    ui.js              helpers and parts: html``, money(), avatar(), pill(), toast(), slideOver(), countTo(), startApp()...
    topbar.js          the slim bar on every app: Rummage (home), the app's name, and what a run brings
    live.js            reads a run's live events (docs/live-events.md) into plain lines, for Rummage and the bar
    icons.js           app icons (one drawing per app) and small interface icons
    days.js            turns the simulator's day lines into figures and words (bar, Home, Control Room)
    impact.js          reads the impact (live against the shadow twin): measures, good or bad, the headline
    people.js          who you can be: the team from get_levers, with a fallback copy until it answers
    mark.svg           the spiral mark (favicon)
  dev.mjs              the one-command server
```

### The client (`lib/client.js`)

Apps never call the server themselves. `startApp()` hands every app the page's shared client:

| Call | What it does |
|---|---|
| `call(tool, input, { role, screen })` | Calls an engine tool. Acts as the current role unless `role` is given. Resolves to the engine's answer, `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. A refusal is an answer, not an exception: show it. Pass `screen: true` for reads a screen makes only to draw itself, so the record of actions leaves them out. |
| `clock()` | `{ now, sandbox, size, scenario, calls, day, started }` (`day` from `GET /sandboxes/:id/clock`) |
| `advance(days)` | Moves time on through `POST /sandboxes/:id/advance` (up to a year a request). `{ now, days: [{ ...engine lists, summary }], clock }`. Each `summary` is the simulator's line for the day (orders, revenue, net, contacts, csat, lost_sales, notes...). Apps normally use the top bar's runner instead (below). |
| `impact()` | `{ available, days_compared, from, to, note, measures: { key: { label, live, shadow, difference } }, series }`. `lib/impact.js` says which way is good for each measure and writes the headline. |
| `activity({ since })` | Trace entries after `since`: `{ entries, last }`. |
| `onChange(fn)` | Calls `fn({ entries, now, previousNow, reset, source })` whenever something new happens (polls every two seconds, so an outside AI's actions show up live). Returns a function that stops listening. |
| `reset()` | Puts the business back exactly as it began. |
| `tools({ role })` | The tool list (names, descriptions, input schemas). |
| `connectInfo()` | `{ apiUrl, mcpUrl, openapiUrl, sandboxId, token, ownerTokenId }` for the "connect your AI" panel. |
| `mintToken(role)` | A key that can only act as one role: the safe thing to give an AI. |
| `eventLibrary()` | Ready-made world events that `add_world_event` can start by `template` id, from the engine tool `list_event_templates` when it exists; `[]` until then (the Control Room then offers "make one up"). |
| `role`, `setRole(role)` | Who is at the computer. Remembered across apps. |

The sandbox (its id and owner token) is kept in `sessionStorage`, so every app opened in one tab shares one world. If the sandbox has gone (the server restarted, or two idle hours passed), the client makes a new one and carries on.

Behind the client is a small back end object (`httpBackend`): `ensure, describe, call, advance, impact, trace, reset, tools, mintToken, eventLibrary, info`. To run the engine inside the browser later, write a second object with the same methods and pass it as `createClient({ backend })`. No app changes.

### Events every app can listen to

- `ot:day` on `document`: time moved. `detail: { now, previousNow, days, partial }`; each day has a `summary` (or is one, when it came from the record). During a long run it fires per step with `partial: true`. Redraw figures here and let them tick with `countTo()`.
- `ot:role` on `document`: the person at the computer changed. Redraw what they are allowed to see.
- `world.onChange(fn)`: anything new in the world, including an outside AI's actions.

### The top bar

`startApp({ id })` puts it on the page: slim and calm. On the left, Rummage's mark (home, `/`) and the open app with its plain word ("Letterbox · Email"). On the right, only what a run brings: during `overthink run --live`, the one live line of what your AI is doing (it opens that record); on `overthink view`, the switch between "Your AI" and "Without your AI". Nothing here sets up, connects or controls a test: that happens in the terminal or a coding agent. Time still moves underneath, and the bar tells open screens with `ot:day`; the returned `bar` keeps `runDays(n)`, `play()`, `pause()`, `busy()` and `now()` for apps that move time themselves.

## Add a new app

1. **Copy the template.** `cp -r applications/_template applications/<id>`, where `<id>` is the app's id in `apps.json` (for example `letterbox`, `front-desk`, `kettle`, `squint`, `mutter`, `daily-overthinker`).
2. **Set the id.** In `applications/<id>/app.js` change `APP_ID` to `<id>`. The name, accent and icon come from `apps.json`; never type the app's name anywhere else.
3. **Mark it ready.** In `apps.json` set its `"status": "ready"`. Home and the switcher now open `applications/<id>/` instead of the placeholder.
4. **Build the screen** in `app.js` and `app.css`:
   - Read with `world.call(tool, input, { screen: true })`; act with `world.call(tool, input)`.
   - Show a refusal (`res.ok === false`) as a calm empty state with `res.error.message`.
   - Use the parts in `lib/ui.js` and `lib/ui.css` (cards, lists, avatars, pills, `emptyState`, `skeleton`, `toast`, `slideOver`, `countTo`, `stagger`). Your `app.css` should mostly be layout.
   - The app's accent is `var(--app)`. Titles and big numbers use `.h1 .h2 .h3 .big-num` (Anybody).
   - Listen to `ot:day`, `ot:role` and `world.onChange` so the screen stays live.
5. **Badges on Home** (optional): add one line to `paintBadges()` or `paintMail()` in `home.js` if your app has unread or new things.
6. **Check it** at 1440 and 390 wide, light and dark, with no console errors and no sideways scroll.

Rules: familiar layouts with our own names and look; never a real product's name, logo, colours or exact layout. Plain English in everything a person reads. Few words; let movement show what a label would say. Respect `prefers-reduced-motion` (the shared CSS already does). Google JavaScript style: small named functions, JSDoc on exports, comments say why.

### A new icon

Add a drawing to `GLYPHS` in `lib/icons.js` under the `icon` name used in `apps.json`: a 48-unit drawing in thick round strokes (the svg sets `stroke-width 3.4`, round caps), with `fill="${P}"` for paper-white areas. Put the part that should move on hover in a `<g class="g-...">` and add one hover rule next to the others in `lib/ui.css`.

## What the engine could add (outside `applications/`)

- `list_event_templates` (manager) in `infrastructure/engine/events.js`: the library's non-calendar events as `{ id, family, title, headline }`, optional `family` filter. The Control Room's event cards appear as soon as it exists.
