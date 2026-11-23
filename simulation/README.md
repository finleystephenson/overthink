# simulation

Time, the wider world, and experiments.

| Folder | What it is |
| --- | --- |
| `simulator/` | The day loop: the simulator's own customers order and write in, staff work their queues, parcels and money move. `live.mjs` keeps a shadow twin where nothing outside is done, so `impact` is a fair difference. See `simulator/README.md`. |
| `world/` | The wider world: the population, rival shops, partners and institutions, the economy, trends, suppliers that write back. See `docs/world.md`. |
| `lab/` | Experiments on the business itself: interventions as data, branches from one snapshot, repeats over seeds, a "why" trace. See `docs/lab.md`. |
| `twin-run/` | `overthink run`, the optional ready-made twin run of a product against model-voiced customers. See `docs/run.md`. |
