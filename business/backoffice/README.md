# The back office

The admin side of Overthought & Co., the made-up shop: what is happening today and what needs doing, then every order, customer, conversation, parcel, stock movement, purchase order, ledger entry and campaign, plus a developer's view of the systems underneath (roles and permissions, rules, documents, a data dictionary, every engine tool with a real example call, how to connect, the situations, the planted problems and what gets recorded).

Plain HTML, CSS and ES modules with hand-drawn SVG charts. No framework, no server, no dependencies beyond Node.

    node business/backoffice/build.mjs --size standard          # reads business/data/, writes business/backoffice/dist/
    python3 -m http.server 8893 -d business/backoffice/dist      # then open http://localhost:8893

## How it is built

`build.mjs` reads `business/data/world/<size>/`, `business/data/business.json`, the product, policy and procedure files, `docs/data-model.md`, and imports the engine and the server code. It never writes outside `business/backoffice/dist/`. It splits the world into small JSON files in `dist/data/` so each page loads only what it needs: `meta.json` (23 KB) and `overview.json` (31 KB) open the first screen; orders, ledger and stock movements load a year at a time; customer records live in 32 buckets.

Nothing is typed in by hand. Read at build time:

- **Tools reference.** Every engine tool is called for real against a fresh copy of the world, as a role allowed to call it (the assistant verifies a customer first), and once as a role that is refused. Inputs are picked from the data (a recent delivered order, a returnable item found by asking `check_return_eligibility`, a late purchase order).
- **Connect.** The endpoint list comes from `infrastructure/server/openapi.mjs`, run on the real tool list.
- **Situations.** Each one is applied with `infrastructure/server/scenarios.mjs` and compared with the normal state using `infrastructure/server/diff.mjs`.
- **How results are judged.** A short run (an assistant asks before verifying, verifies, opens a case, tries a refund it may not give) is made through `infrastructure/server/sandboxes.mjs`; its trace and diff are shown as recorded.
- **Data dictionary.** Fields, types and examples are worked out from the records; descriptions come from `docs/data-model.md`; links between record types are found from the id patterns in the values (plus the discount code, monthly sums and page-view keys, which link by value).
- **Things that need someone** and **Worth a look** are rules over the records, each stated on the page.

If the engine or server cannot be imported, the build still finishes and those pages say what is missing.

## Source (`src/`)

| File | What it holds |
|---|---|
| `index.html`, `app.css` | The shell and the one design system: tokens (light first, dark as its own steps), shell, tables, pills, timelines, drawer, palette, charts, responsive rules |
| `core.js` | Safe HTML, data loading, formatting, the status vocabulary (one meaning per colour everywhere), record links, permissions from the engine's tool table, icons, the table and list components (sort, page, filter chips, saved views, keyboard), the drawer |
| `charts.js` | Line, bar, ranked-bar and part-of-whole charts with hover tooltips and previous-period comparison |
| `app.js` | Navigation, routing, breadcrumbs, the command palette (Ctrl/Cmd-K or /), View as, spoilers, theme |
| `v-overview.js` | Company overview |
| `v-commerce.js` | Orders, products and product pages, payments, deliveries, returns and refunds |
| `v-customers.js` | Customer directory and segments |
| `v-records.js` | One page per record at `#/r/<id>` (orders, customers, cases, conversations, repairs, parcels, purchase orders, suppliers, ledger entries, stock counts and movements, documents, campaigns, reviews, registrations, returns), also used by the side drawer |
| `v-service.js` | Service desk inbox, cases, complaints and deadlines, the Fix Club board, what customers ask |
| `v-ops.js` | Stock, movements and counts, suppliers, purchase orders, stockouts |
| `v-finance.js` | Profit and loss, cash, margins, the ledger, anomalies |
| `v-marketing.js` | Campaigns, visitors and the funnel, repeat buying and best sellers |
| `v-systems.js` | Company systems and data (the developer's view) |

Every record has a deep link (`#/r/ORD-…`, `#/r/C-…`, `#/r/PO-…`); a list row opens it in a side drawer and adds `?open=<id>` to the address, so that view can be shared too. Saved views and the theme are kept in the viewer's own browser.

## Rules it keeps

- **Counts say what they count.** "Paid orders" means payment not declined, the validator's definition. The overview's year table and the profit and loss match `node business/builder/validate.mjs --size standard` (revenue, profit, paid orders by year, cash now, stockouts, lost parcels). Figures that differ in scope say so: "arrived late, last 12 months" on Deliveries is not the validator's all-time late rate; "sales lost" on Stockouts is marked as an estimate (lost baskets × that month's average order).
- **View as** hides what a role may not see, using the same tool table the engine checks. The customer and the AI assistant see one customer only (the planted-story customer with the most records), as if signed in or verified.
- **Spoilers** are off by default. With them on, record pages say which planted story they belong to.
- Chart colours are brand hues stepped for contrast and checked with the dataviz palette validator (light: `#2489C4 #F0612A #7A5CCB #5E8F12 #D63F8C #B88300` on `#FCFCFB`; dark: `#2F95CF #E8602A #8D74E3 #6A9F22 #DE5499 #B98A14` on `#15161F`; all checks pass). Status colours are separate and always come with a label.

## Checked

Every section at 1440 and 1024 wide and at phone width (390, no sideways scroll), light and dark, headless Chrome with no console errors. Clicked through: overview → an alert → the case → its customer → a conversation; an order row → the drawer; the palette (search "mary", Enter); a data-dictionary sample → its record page; View as AI assistant (one customer, the ledger locked); every record type by id.
