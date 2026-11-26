# Readyline engine simulation report

Engine 0.1.0. Seed 20261126. Exam: New Jersey Life Producer Examination (83 items, pass 59).

## Content quality (phase A: 500 learners on generator difficulty estimates)

| Metric | Value |
|---|---|
| Items in bank | 900 |
| Items never shown | 305 |
| Exposure per item (p10 / median / p90 / max) | 0 / 20 / 254 / 466 |
| Seeded miskeyed items | 22 |
| Miskeyed items caught, among those with 30+ responses | 11 / 11 |
| Miskeyed items caught | 11 / 22 (50.0%) |
| Good items wrongly flagged | 5 |
| Mean abs error of item difficulty, before calibration | 0.479 |
| Mean abs error of item difficulty, after calibration | 0.390 |

## Pass prediction (phase B: 1500 new learners, calibrated bank)

| Metric | Value | Target |
|---|---|---|
| Brier score | 0.104 | below baseline 0.232 |
| Expected calibration error | 0.033 | < 0.05 |
| Expected vs real score, mean abs error | 4.26 items | |
| Real pass rate | 36.5% | |

### Calibration by predicted bucket

| Predicted P(pass) | Learners | Mean predicted | Actually passed |
|---|---|---|---|
| 0-10% | 540 | 2.5% | 1.9% |
| 10-20% | 133 | 14.8% | 8.3% |
| 20-30% | 94 | 25.0% | 21.3% |
| 30-40% | 79 | 34.9% | 30.4% |
| 40-50% | 81 | 44.7% | 48.1% |
| 50-60% | 70 | 54.6% | 44.3% |
| 60-70% | 90 | 64.9% | 62.2% |
| 70-80% | 84 | 75.1% | 70.2% |
| 80-90% | 76 | 85.0% | 71.1% |
| 90-100% | 253 | 97.2% | 96.0% |

## Ability recovery (correlation of estimated vs true blueprint-weighted ability)

| Answers given | Learners | r | Target |
|---|---|---|---|
| 25-75 | 354 | 0.876 | |
| 75-150 | 577 | 0.947 | > 0.85 from 100 |
| 150-226 | 569 | 0.968 | > 0.85 |
