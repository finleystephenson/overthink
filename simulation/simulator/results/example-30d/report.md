# Simulation report: example-30d

**With 3 seeds we can't yet tell whether it made money: net profit changed by -£38 on average (95% interval -£109 to +£34). It has not paid for itself in cash within 30 days. Separately it freed 11 staff hours (worth £177 at pay: capacity, not cash, because wages are paid either way).**

30 days compared, 3 seeds, size standard, scale 0.2, default customers. Tool role: assistant. Tool cost: £150 a month.

## Cash: the money that changed
- Net profit -£38 on average (median -£48; 10th to 90th -£57 to -£14; 95% interval -£109 to +£34).
- Gross profit -£32 (95% interval -£110 to +£46); revenue +£0; refunds +£30.
- Tool cost over the run: £148. Net profit change after tool cost: -£186 (95% interval -£257 to -£114).
- Return on investment (cash only): -1.255 (95% interval -1.738 to -0.771). ROI = (change in net profit - tool cost) / tool cost, per seed, then summarised. Staff time saved is shown separately, not counted.
- It has not paid for itself in cash within 30 days.
- The 95% interval for net profit is still wide (includes zero). Run more seeds for a firmer answer.

## Time freed: capacity, not cash
- 11 staff task hours saved over the run (95% interval 10.59 to 11.42), worth £177 at pay.
- Capacity, not cash: staff are paid for their contracted hours whether or not the tool saves them time. It is not counted in the return or payback (use --count-time-saved to count it).
- Overtime hours: +0.01 per run.

## Baseline against with-tool (mean over seeds)
The differences are paired: with-tool minus baseline for the same seed, then summarised. "10th to 90th" is the range of the middle 80% of seeds.

| Measure | Baseline | With tool | Mean difference | Median | 10th to 90th | 95% interval |
|---|---|---|---|---|---|---|
| Revenue | £16,887 | £16,887 | £0 | £0 | £0 to £0 | £0 to £0 |
| Gross profit | £9,648 | £9,616 | -£32 | -£48 | -£51 to -£6 | -£110 to £46 |
| Net profit | £3,563 | £3,526 | -£38 | -£48 | -£57 to -£14 | -£109 to £34 |
| Refunds | £280 | £310 | +£30 | +£48 | -£6 to +£60 | -£80 to £140 |
| Customer satisfaction (1 to 5) | 3.86 | 4.15 | +0.28 | +0.23 | +0.19 to +0.4 | -0.06 to 0.63 |
| First response, median minutes | 143.33 | 1 | -142.33 | -144 | -200 to -84 | -322.48 to 37.82 |
| Resolution rate | 0.88 | 0.95 | +0.08 | +0.07 | +0.05 to +0.1 | 0 to 0.15 |
| Staff task hours | 50.28 | 39.28 | -11 | -10.98 | -11.14 to -10.88 | -11.42 to -10.59 |
| Complaints | 10 | 9.67 | -0.33 | 0 | -0.8 to 0 | -1.77 to 1.1 |
| Reviews of 1 or 2 stars | | | 0 | 0 | 0 to 0 | 0 to 0 |
| New business won from prospects (revenue) | | | +£0 | +£0 | +£0 to +£0 | +£0 to +£0 |
| Prospects won | | | 0 | 0 | 0 to 0 | 0 to 0 |

Customer satisfaction is worked out from outcomes: each contact scores 1 to 5 (resolved 4.5, handed over properly 3.9, resolved by staff 4.3, partly 3.0, failed 1.8, wrong action 1.3, never answered 1.0), minus a penalty for a slow first reply and for each extra day waiting. See sim/README.md.

## Moments that mattered
**Biggest effects** (ranked by money; service effects without a money figure come last)
- Refunds up £30 per run. Mostly on "change_order" contacts (£257 refunded with the tool, £174 by staff alone): customers asked to cancel and the tool did it at once, while the parcel was still unpacked; staff replied hours later, when many parcels had already gone, so fewer cancellations went through. (-£30)
- 1 tool calls per run were refused by the rules, nearly all report_problem (rule_violation) on "fault" contacts (1).
- Customer satisfaction +0.28 on the 1 to 5 scale (-19 points more customers satisfied).
- Median first response -142.33 minutes.

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


## Next actions
1. Run more seeds (try --seeds 30): with 3 the intervals are wide.
2. Stop the tool making the calls the rules refuse (listed under biggest effects); each one is counted as a rule break.
3. It has not paid back in cash: widen what it handles, or lower its cost.
