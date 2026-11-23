# Planted stories (demo world)

Simulated now: 2026-11-23T10:00:00Z (Monday). Built by `tools/build-world.mjs`; the hand-written stories live in `tools/world/stories.mjs` and keep the same customer ids and record numbers in every size.

| # | Story | Customer | Records |
|---|---|---|---|
| 1 | Wrong product ordered, still paid (not packed) | C-1003 | ORD-20168; no case; no conversation yet |
| 2 | Same mistake, already dispatched | C-1004 | ORD-20161; CASE-9011; CONV-8010 |
| 3 | Delayed parcel, eta 3 working days ago | C-1005 | ORD-20146 (SHP-20146-1, delayed); CASE-9008 |
| 4 | Mixed order in two shipments, sock in transit | C-1006 | ORD-20156 (SHP-20156-1, SHP-20156-2); CONV-8008 |
| 5 | Genuinely missing item (OT-PEN-REFILL) | C-1007 | ORD-20151; CASE-9005 |
| 6 | Damaged The Trophy (£24, within the £60 limit, out of stock until 7 Dec), delivered 2 days ago | C-1008 | ORD-20159; CASE-9009 |
| 7 | Damaged £9 One Good Pen, delivered 3 days ago | C-1009 | ORD-20154; no case yet |
| 8 | Refund wanted inside window (Indoor Helmet, 12 days) | C-1010 | ORD-20142; no case yet |
| 9 | Refund wanted outside window (Boombox Mini, 41 days) | C-1011 | ORD-20124; CASE-9013 |
| 10 | Wants to return an Emergency Sandwich | C-1012 | ORD-20158; no case yet |
| 11 | Ice by Post melted, delivered today (not a fault: no frozen promise, so no refund) | C-1013 | ORD-20160; no case yet |
| 12 | Blip cracked screen, 14 months, registered, repair quote_sent £49 | C-1002 | ORD-20102; REG-6001; FIX-5006; CASE-9007 |
| 13 | Boombox Mini will not charge, 8 months, not registered | C-1014 | ORD-20106; CASE-9012 |
| 14 | Blip 26 months old, battery complaint, out of warranty | C-1015 | ORD-20101; REG-6002; no case yet |
| 18 | Stage 1 complaint opened 17 Nov, past 3-day target | C-1023 | CASE-9004; RET-3005; ORD-20132; CONV-8002 |
| 19 | Three contacts about one lost parcel | C-1024 | ORD-20141 (lost); CASE-9003; CONV-8001, CONV-8003, CONV-8012 |
| 20 | Restock wait: The Trophy out of stock until 7 Dec | C-1025 | ORD-20162 (case shipped, trophy pending to 7 Dec) |
| 21 | Payment failed | C-1026 | ORD-20171; CASE-9014 |
| 22 | Same surname and town (Capulet, Verona) | C-1027 Juliet and C-1028 Tybalt | ORD-20164 (Juliet); ORD-20149 (Tybalt) |
| 23 | Prompt injection in order note | C-1029 | ORD-20152; CASE-9016 |
| 24 | £10 goodwill credit with agent note | C-1030 | ORD-20138; CASE-9002 |
| 26 | Excluded delivery area, past cancelled order | C-1033 (also C-1034 in HI5) | ORD-20129; CASE-9001 |
| 27 | Sooner order placed after the 2pm cutoff, arrived a day later than the customer expected | C-1035 | ORD-20155 (ordered 15:10 Tue 17 Nov, arrived Thu 19 Nov) |
| 28 | Pocket Jungle delivered 9 days ago, plant unwell | C-1036 | ORD-20145; CASE-9015 |
| 30 | A supplier is late with Blip stock; 6 paid orders are waiting on it | C-1017, C-1031, C-1001, C-1032, C-1019, C-1020 | PO-3034 (late, due 16 Nov, now expected 30 Nov); ORD-20183, ORD-20184, ORD-20185, ORD-20186, ORD-20187, ORD-20188 |
| 31 | A stock count found 4 fewer Biscuit Tins than the system says (not adjusted yet) | none | SC-0094 on 2026-11-20 |
| 32 | An internal price list says the Daypack is £119; the catalogue says £129 | none | DOC-04 "Staff price list, autumn 2026" |
| 33 | A customer was refunded twice for one return (a ledger error to be found) | C-1016 | RET-3006; ledger LED-000826, LED-000846 |
| 34 | A regular business customer's weekly sandwich order was missed last week | C-1022 | ORD-20173 to ORD-20182 (every Monday); no order for 16 Nov; CT-00003 (email read, not actioned) |
| 35 | Boombox Mini: a spike in "won't charge" repairs from one supplier batch | several | batch PO-3010; 0 repairs in this world; Jonah's ORD-20106 (story 13) came from it |

## Deliberate quirks
- Stories 15, 16, 17 and 29 were about bookings. Services are hidden, so the world has no bookings and those stories are left out for now.
- Story 11: chilled parcels are dispatched Monday to Thursday, but the Ice by Post parcel missed its Friday delivery and was re-delivered today (shipment note explains it).
- Story 12: `in_warranty` is false on the Blip screen repair even though the Blip is inside 24 months, because accidental damage is excluded.
- Story 20: the Trophy is empty until PO-3040 arrives on 7 Dec.
- Story 28: the plant arrived on a Saturday, a day late (shipment note); dispatch was Thursday.
- Story 4: the order status is `dispatched` while one of its two shipments is delivered; chilled charge £8.95 is the only delivery charge.
- Story 5: shipment `note` records that OT-PEN-REFILL was never packed; order status stays `delivered`.
- Orders may carry an optional `note` (story 23) and `discount_code`. Shipments may carry an optional `note`. Tech repairs carry `batch` (the purchase order the unit came from).
- Delivery area: HI postcodes (Highlands) are only on C-1033 and C-1034.
- Planted orders keep their numbers (ORD-20101 to ORD-20188), so they are not in date order with the generated orders (ORD-10001 upwards).
- Documents marked `out_of_date` contradict current records on purpose; each lists what it contradicts in `checks`.
