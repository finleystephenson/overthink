# business

Overthought & Co. as data: everything that makes it this business and not another.

| Folder | What it is |
| --- | --- |
| `data/` | Products, staff, policies, procedures, costs, jobs, the population with real-world circumstances, the event library, and the seed records. Every guessed rate has its reason beside it. `data/world*/` is built from these on first run (git-ignored). |
| `builder/` | Builds five years of history into `data/world*/` and checks it: `node business/builder/build-world.mjs --size demo`, `node business/builder/validate.mjs --size demo`. `builder/world/` holds the history generators. |
| `site/` | The public shop website, built separately (`node business/site/build.mjs`); `site/img/` holds the product pictures the apps also use. |
| `backoffice/` | An older admin view of the business, built from the data (`node business/backoffice/build.mjs`). |
| `brand/` | The mark and the brand kit. The names and logos are not licensed as marks: see `TRADEMARKS.md`. |
