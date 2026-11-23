# Simulation report: example-30d-30seeds

**It lost money: net profit down £73 on average (95% interval -£99 to -£46), over 30 seeds. It has not paid for itself in cash within 30 days. Separately it freed 11.19 staff hours (worth £181 at pay: capacity, not cash, because wages are paid either way).**

30 days compared, 30 seeds, size standard, scale 0.2, default customers. Tool role: assistant. Tool cost: £150 a month.

## Cash: the money that changed
- Net profit -£73 on average (median -£71; 10th to 90th -£164 to +£20; 95% interval -£99 to -£46).
- Gross profit -£72 (95% interval -£101 to -£42); revenue +£5; refunds +£120.
- Tool cost over the run: £148. Net profit change after tool cost: -£221 (95% interval -£247 to -£194).
- Return on investment (cash only): -1.49 (95% interval -1.669 to -1.311). ROI = (change in net profit - tool cost) / tool cost, per seed, then summarised. Staff time saved is shown separately, not counted.
- It has not paid for itself in cash within 30 days.
- The 95% interval for net profit does not include zero.

## Time freed: capacity, not cash
- 11.19 staff task hours saved over the run (95% interval 10.7 to 11.69), worth £181 at pay.
- Capacity, not cash: staff are paid for their contracted hours whether or not the tool saves them time. It is not counted in the return or payback (use --count-time-saved to count it).
- Overtime hours: -0.06 per run.

## Baseline against with-tool (mean over seeds)
The differences are paired: with-tool minus baseline for the same seed, then summarised. "10th to 90th" is the range of the middle 80% of seeds.

| Measure | Baseline | With tool | Mean difference | Median | 10th to 90th | 95% interval |
|---|---|---|---|---|---|---|
| Revenue | £18,494 | £18,498 | +£5 | £0 | -£4 to +£1 | -£5 to £14 |
| Gross profit | £10,435 | £10,364 | -£72 | -£77 | -£175 to +£40 | -£101 to -£42 |
| Net profit | £4,179 | £4,106 | -£73 | -£71 | -£164 to +£20 | -£99 to -£46 |
| Refunds | £247 | £367 | +£120 | +£110 | -£29 to +£329 | £71 to £169 |
| Customer satisfaction (1 to 5) | 3.84 | 4.16 | +0.32 | +0.33 | +0.18 to +0.45 | 0.28 to 0.36 |
| First response, median minutes | 88.97 | 1 | -87.97 | -51 | -167 to -39 | -116.25 to -59.68 |
| Resolution rate | 0.88 | 0.97 | +0.09 | +0.08 | +0.06 to +0.12 | 0.08 to 0.1 |
| Staff task hours | 53.02 | 41.83 | -11.19 | -11.08 | -12.7 to -9.55 | -11.69 to -10.7 |
| Complaints | 8.87 | 8.6 | -0.27 | 0 | -1 to 0 | -0.56 to 0.03 |
| Reviews of 1 or 2 stars | | | -0.23 | 0 | -1 to 0 | -0.39 to -0.07 |
| New business won from prospects (revenue) | | | +£0 | +£0 | +£0 to +£0 | +£0 to +£0 |
| Prospects won | | | 0 | 0 | 0 to 0 | 0 to 0 |

Customer satisfaction is worked out from outcomes: each contact scores 1 to 5 (resolved 4.5, handed over properly 3.9, resolved by staff 4.3, partly 3.0, failed 1.8, wrong action 1.3, never answered 1.0), minus a penalty for a slow first reply and for each extra day waiting. See sim/README.md.

## Moments that mattered
**Biggest effects** (ranked by money; service effects without a money figure come last)
- Refunds up £120 per run. Mostly on "change_order" contacts (£233 refunded with the tool, £75 by staff alone): customers asked to cancel and the tool did it at once, while the parcel was still unpacked; staff replied hours later, when many parcels had already gone, so fewer cancellations went through. (-£120)
- 1 and 2 star reviews -0.23 per run (valued at £25 each in lost future sales: an assumption). (+£6, estimated)
- 2 tool calls per run were refused by the rules, nearly all report_problem (rule_violation) on "fault" contacts (2) and report_problem (rule_violation) on "damaged" contacts (0).
- Customer satisfaction +0.32 on the 1 to 5 scale (-19 points more customers satisfied).
- Median first response -87.97 minutes.

**Single events: biggest wins**
- None recorded.

**Single events: worst mistakes**
- None recorded.

## Per seed
| Seed | Net profit difference | Hours saved | ROI | Paid back after |
|---|---|---|---|---|
| 1 | -£48 | 10.85 | -1.328 | never |
| 2 | -£60 | 10.98 | -1.402 | 3 days |
| 3 | -£5 | 11.18 | -1.034 | never |
| 4 | -£199 | 12.62 | -2.343 | never |
| 5 | -£47 | 10.89 | -1.318 | never |
| 6 | -£135 | 12.95 | -1.913 | never |
| 7 | -£55 | 10.42 | -1.37 | never |
| 8 | -£150 | 11.18 | -2.012 | never |
| 9 | -£55 | 10.53 | -1.373 | never |
| 10 | -£174 | 12.57 | -2.176 | never |
| 11 | +£43 | 12.04 | -0.709 | never |
| 12 | -£33 | 10.34 | -1.225 | never |
| 13 | -£13 | 9.59 | -1.089 | never |
| 14 | +£19 | 8.33 | -0.873 | never |
| 15 | -£92 | 11.97 | -1.619 | 2 days |
| 16 | -£7 | 10.35 | -1.046 | never |
| 17 | -£193 | 10.66 | -2.302 | never |
| 18 | -£145 | 14.3 | -1.98 | 4 days |
| 19 | -£80 | 12.67 | -1.537 | never |
| 20 | -£119 | 11.13 | -1.806 | 1 day |
| 21 | -£67 | 11.91 | -1.455 | never |
| 22 | -£46 | 10.32 | -1.314 | never |
| 23 | -£153 | 12.4 | -2.031 | never |
| 24 | +£27 | 11.26 | -0.82 | never |
| 25 | -£77 | 11.03 | -1.522 | never |
| 26 | -£81 | 11.2 | -1.547 | never |
| 27 | +£85 | 9.18 | -0.425 | 14 days |
| 28 | -£162 | 13.19 | -2.097 | never |
| 29 | -£74 | 10.97 | -1.503 | never |
| 30 | -£77 | 8.81 | -1.523 | never |


## Next actions
1. Stop the tool making the calls the rules refuse (listed under biggest effects); each one is counted as a rule break.
2. It has not paid back in cash: widen what it handles, or lower its cost.
