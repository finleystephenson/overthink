// Internal documents and the company description. Some documents are deliberately out of date;
// each carries `checks` that say exactly which current record it contradicts, so the validator can prove it.
import { oldPrice, PRICE_RISE } from "./catalogue.mjs";
import { openingCash } from "./money.mjs";

const gbp = (n) => "£" + (Number.isInteger(n) ? n : n.toFixed(2));

/**
 * The internal documents. With stories on, four documents belong to planted stories (a wrong line in a current
 * price list, a late Blip delivery, the Christmas trophies, the bad Boombox batch). Without stories the price list
 * is right, the supplier emails are left out and the Fix Club notes say nothing about a batch.
 * Old documents that are simply out of date (an old price list, an old returns note) stay in both: every business
 * has them, and each says in `checks` exactly what it contradicts.
 */
export function buildDocuments({ cat, suppliers, blipPO, trophyPO, badBatch, stories = true, history = null }) {
  const s = cat.skus;
  const sup = Object.fromEntries(suppliers.map((x) => [x.id, x]));
  const priceRows = (price) => Object.values(s).filter((x) => !x.accessory).map((x) => `| ${x.name} | ${gbp(price(x))} |`).join("\n");
  const docs = [
    { title: "How a normal day runs", kind: "guide", written_at: "2025-02-03", status: "current", body:
`# How a normal day runs
1. 07:30 Chilled deliveries from the bakery and the ice supplier arrive. Check them against the day's purchase orders.
2. 08:00 Pack chilled parcels first. They must leave by 09:00 (Monday to Thursday only).
3. 09:00 Swiftway collects the ordinary parcels packed since yesterday afternoon.
4. 09:00 to 17:30 Answer the support inbox and phone. The assistant answers web chat and hands over anything it cannot do.
5. 14:00 Sooner orders placed before 2pm are packed for the 15:00 collection.
6. 16:00 Book in supplier deliveries and returns. Returns are inspected the day they arrive.
7. 17:30 The buyer checks stock against reorder points and raises purchase orders.` },
    { title: "Packing guide", kind: "guide", written_at: "2024-05-13", status: "current", body:
`# Packing guide
- Chilled items always travel on their own, in an insulated box with ice packs. Never mix them with other items.
- Pocket Jungle goes by Sooner only, Monday to Thursday, upright, with the "this way up" label.
- Scan every line into the parcel. If a line will not scan, stop and tell the warehouse lead. Do not send the parcel short.
- Tech (Blip, Boombox Mini) goes in a padded mailer inside the box.` },
    { title: "Price list 2023", kind: "price list", written_at: "2023-03-01", status: "out_of_date",
      checks: PRICE_RISE.skus.map((sku) => ({ kind: "price", sku, says: oldPrice(sku, s) })),
      body: `# Price list 2023\nFor phone orders and wholesale enquiries.\n\n| Product | Price |\n|---|---|\n${priceRows((x) => (PRICE_RISE.skus.includes(x.sku) ? oldPrice(x.sku, s) : x.price))}\n\nPrices checked March 2023.` },
    stories ? { title: "Staff price list, autumn 2026", kind: "price list", written_at: "2026-09-01", status: "current",
      // Planted story: one wrong line in a list everyone thinks is current.
      checks: [{ kind: "price", sku: "OT-PACK", says: 119, planted: true }],
      body: `# Staff price list, autumn 2026\nUse this for phone orders.\n\n| Product | Price |\n|---|---|\n${priceRows((x) => (x.sku === "OT-PACK" ? 119 : x.price))}` }
      : { title: "Staff price list, autumn 2026", kind: "price list", written_at: "2026-09-01", status: "current",
        body: `# Staff price list, autumn 2026\nUse this for phone orders.\n\n| Product | Price |\n|---|---|\n${priceRows((x) => x.price)}` },
    { title: "Returns: what to tell customers (2022)", kind: "note", written_at: "2022-01-10", status: "out_of_date",
      checks: [{ kind: "returns_window", says: 14 }],
      body: "# Returns: what to tell customers\nCustomers have 14 days from delivery to send something back. Postage is free for faulty items. Food cannot be returned." },
    { title: "Spec sheet: The Trophy", kind: "guide", written_at: "2023-10-16", status: "out_of_date",
      checks: [{ kind: "variant_count", product: "trophy", says: 4 }, { kind: "product_text", product: "trophy", says: "silver" }],
      body: "# Spec sheet: The Trophy\nTwo sizes, 15 cm and 30 cm, each in gold or silver. Engraved \"Well done.\" Cast zinc cup on an ash base.\n\nSKUs: small gold, small silver, large gold, large silver." },
    { title: "Email from Marrowfield Devices: lead times", kind: "supplier email", written_at: "2024-02-20", status: "out_of_date",
      checks: [{ kind: "lead_time", supplier: "SUP-05", says: 10 }],
      body: "# From: Marrowfield Devices\nThanks for the first Blip order. Our lead time is 10 days from your purchase order to delivery. Payment 30 days from delivery." },
    stories && { title: "Email from Marrowfield Devices: Blip delivery delayed", kind: "supplier email", written_at: "2026-11-18", status: "current",
      body: `# From: Marrowfield Devices\nSorry, ${blipPO} will not arrive on 16 November. A component is late. We now expect to deliver on 30 November.` },
    stories && { title: "Email from Ashgrove Workshop: Christmas trophies", kind: "supplier email", written_at: "2026-11-10", status: "current",
      body: `# From: Ashgrove Workshop\nGot ${trophyPO}. Lead time is 28 days, so the trophies arrive on 7 December.` },
    stories ? { title: "Fix Club weekly notes", kind: "meeting note", written_at: "2026-11-20", status: "current",
      body: `# Fix Club weekly notes\n- Bench is busy. More Boombox Minis than usual this autumn.\n- Most say "will not charge". Not yet checked which delivery they came from${badBatch ? " (batch numbers are on each repair)" : ""}.\n- Blip screen quotes: £49, fixed price.` }
      : { title: "Fix Club weekly notes", kind: "meeting note", written_at: "2026-11-20", status: "current",
        body: "# Fix Club weekly notes\n- Bench work as usual: batteries, zips and straps.\n- Every repair records which delivery (batch) a tech unit came from.\n- Blip screen quotes: £49, fixed price." },
    { title: "Christmas planning 2026", kind: "meeting note", written_at: "2026-10-05", status: "current",
      body: "# Christmas planning 2026\n- Trophy sells out every December. Order the Christmas batch early.\n- Gift guide email goes out mid-November with a 10% code.\n- No new products until January." },
    { title: "Weekly office sandwich orders", kind: "guide", written_at: "2026-09-04", status: "current",
      body: "# Weekly office sandwich orders\nSome offices email every Monday morning for their team's sandwiches. Place the order the same morning, before 11:00, so it is baked for Tuesday. Check the inbox for them first thing." },
    { title: "Supplier list", kind: "guide", written_at: "2026-09-15", status: "current",
      body: "# Supplier list\n| Supplier | Supplies | Lead time |\n|---|---|---|\n" + suppliers.map((x) => `| ${x.name} | ${x.products.join(", ")} | ${x.lead_time_days} days |`).join("\n") },
  ];
  if (history) docs.push(...historyDocuments(history));
  return docs.filter(Boolean).map((d, i) => ({ id: "DOC-" + String(i + 1).padStart(2, "0"), ...d, checks: d.checks || [] }));
}

/**
 * The company history (business/data/history/, written by hand) as company documents: the story, the timeline and the
 * team's joining dates. Each part is optional; whatever exists is added.
 * @param {{story?: string, timeline?: object, staff?: object}} history
 */
function historyDocuments({ story, timeline, staff }) {
  const docs = [];
  const written = "2026-11-22";
  if (story) docs.push({ title: "How we got here", kind: "company history", written_at: written, status: "current", body: story.trim() });
  if (timeline?.entries?.length) {
    const rows = timeline.entries.map((e) => `- **${e.date}, ${e.title}.** ${e.text}`).join("\n");
    docs.push({ title: "Company timeline", kind: "company history", written_at: written, status: "current", body: `# Company timeline\n\n${rows}` });
  }
  if (staff?.staff?.length) {
    const rows = staff.staff.map((p) => `| ${p.name} | ${p.joined} | ${p.first_job || ""} | ${p.since || ""} |`).join("\n");
    docs.push({ title: "Who joined when", kind: "company history", written_at: written, status: "current",
      body: `# Who joined when\n\n| Name | Joined | First job | Now |\n|---|---|---|---|\n${rows}` });
  }
  return docs;
}

export function buildCompany(cat, scale, opening = openingCash(scale)) {
  const b = cat.business;
  const roles = Object.fromEntries(Object.entries(b.roles).filter(([k]) => k !== "_note").map(([k, v]) => [k, { description: v.description, can: v.can || [] }]));
  return {
    name: b.name,
    what_we_do: "We design ordinary things properly and sell them online from one small warehouse: everyday objects, food that travels chilled, a little technology, and repairs through The Fix Club.",
    founded: "2021-11-22",
    roles,
    working_hours: b.contact.hours,
    tools_used: [
      "An online shop platform for the catalogue, checkout and orders",
      "A card payment provider that takes payments and sends refunds",
      "A shared support inbox, a phone line and web chat answered by the assistant",
      "A stock spreadsheet the buyer uses for reorder points and purchase orders",
      "Courier accounts with Swiftway Parcels (ordinary parcels) and Coldline Couriers (chilled)",
      "Simple bookkeeping software for the ledger and month-end figures",
    ],
    normal_day: ["Chilled stock arrives and chilled parcels go out first", "Ordinary parcels are collected at 09:00", "Support answers questions all day", "Sooner orders are packed for the 15:00 collection", "Deliveries and returns are booked in", "The buyer raises purchase orders at 17:30"],
    opening_cash: opening,
    size_note: `This world is built at scale ${scale} (customers / 500). Costs, marketing spend and supplier minimum orders scale with it.`,
  };
}
