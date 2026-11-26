import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Bank } from "../engine/bank";
import { calibrateItems } from "../engine/calibrate";
import { applyAnswer, initState, topicTheta } from "../engine/learner";
import { readiness } from "../engine/readiness";
import { createRng } from "../engine/rng";
import { nextItem } from "../engine/scheduler";
import type { AnswerEvent, Blueprint, LearnerState } from "../engine/types";
import { buildBank, makeLearner, takeRealExam, trueP, trueWeightedTheta, type SimItem } from "./synthetic";

const bp = JSON.parse(readFileSync(new URL("../../content/exams/nj-life/blueprint.json", import.meta.url), "utf8")) as Blueprint;
const rng = createRng(20261126);
const simItems = buildBank(bp, rng);
const truth = new Map(simItems.map((s) => [s.meta.key, s]));

const START = Date.UTC(2026, 0, 5);
const exposure = new Map<string, number>();
const STEP = 30_000;

interface Run {
  state: LearnerState;
  events: AnswerEvent[];
}

function study(learner: ReturnType<typeof makeLearner>, bank: Bank, practice: number): Run {
  let state = initState(bank);
  const events: AnswerEvent[] = [];
  let t = START;
  for (let k = 0; k < 25 + practice; k++) {
    const mode = k < 25 ? "diagnostic" : "practice";
    const pick = nextItem(state, bank, mode, t, undefined, learner.id);
    exposure.set(pick?.item.key ?? "", (exposure.get(pick?.item.key ?? "") ?? 0) + 1);
    if (!pick) break;
    const sim = truth.get(pick.item.key) as SimItem;
    const ev = { id: k + 1, itemKey: pick.item.key, correct: rng.next() < trueP(learner, sim, bank.guess), at: t };
    events.push(ev);
    state = applyAnswer(state, bank, ev);
    t += STEP;
  }
  return { state, events };
}

const corr = (x: number[], y: number[]) => {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
};

// ---------- Phase A: launch cohort on generator difficulty estimates ----------
const bankA = new Bank(bp, simItems.map((s) => s.meta));
const cohortA = 500;
const eventsByUser = new Map<string, AnswerEvent[]>();
for (let i = 0; i < cohortA; i++) {
  const l = makeLearner(`a${i}`, bankA, rng);
  eventsByUser.set(l.id, study(l, bankA, 50 + rng.int(150)).events);
}

const expCounts = [...bankA.items.keys()].map((k) => exposure.get(k) ?? 0).sort((a, b) => a - b);
const pct = (q: number) => expCounts[Math.floor(q * (expCounts.length - 1))]!;
const neverShown = expCounts.filter((x) => x === 0).length;
const cal = calibrateItems(bankA, eventsByUser);
const statByKey = new Map(cal.stats.map((s) => [s.key, s]));
const flagged = new Set(cal.stats.filter((s) => s.flag).map((s) => s.key));
const bad = simItems.filter((s) => s.miskeyed).map((s) => s.meta.key);
const caught = bad.filter((k) => flagged.has(k)).length;
const badEligible = bad.filter((k) => statByKey.get(k)!.n >= 30);
const caughtEligible = badEligible.filter((k) => flagged.has(k)).length;
const falseFlags = [...flagged].filter((k) => !truth.get(k)!.miskeyed).length;

const goodKeys = simItems.filter((s) => !s.miskeyed);
const bErrBefore = goodKeys.reduce((s, x) => s + Math.abs(x.meta.b - x.trueB), 0) / goodKeys.length;
const calB = new Map(cal.items.map((i) => [i.key, i.b]));
const bErrAfter = goodKeys.reduce((s, x) => s + Math.abs(calB.get(x.meta.key)! - x.trueB), 0) / goodKeys.length;

// ---------- Phase B: calibrated bank, bad items quarantined ----------
const bankB = new Bank(bp, cal.items.filter((i) => !flagged.has(i.key)));
const cohortB = 1500;
const rows: { practice: number; pred: number; passed: number; trueTheta: number; estTheta: number; expScore: number; realScore: number }[] = [];
for (let i = 0; i < cohortB; i++) {
  const l = makeLearner(`b${i}`, bankB, rng);
  const practice = rng.int(201);
  const { state } = study(l, bankB, practice);
  const r = readiness(state, bankB, { draws: 1000 });
  const real = takeRealExam(l, bankB, rng);
  let est = 0;
  for (const [t, w] of bankB.topicWeight) est += w * topicTheta(state, t).mean;
  rows.push({
    practice: 25 + practice,
    pred: r.pPass,
    passed: real >= bankB.passScore ? 1 : 0,
    trueTheta: trueWeightedTheta(l, bankB),
    estTheta: est,
    expScore: r.expectedScore,
    realScore: real,
  });
}

const brier = rows.reduce((s, r) => s + (r.pred - r.passed) ** 2, 0) / rows.length;
const baseRate = rows.reduce((s, r) => s + r.passed, 0) / rows.length;
const brierBaseline = baseRate * (1 - baseRate);
const bins = Array.from({ length: 10 }, (_, i) => rows.filter((r) => Math.min(9, Math.floor(r.pred * 10)) === i));
const ece = bins.reduce((s, b) => {
  if (!b.length) return s;
  const p = b.reduce((a, r) => a + r.pred, 0) / b.length;
  const o = b.reduce((a, r) => a + r.passed, 0) / b.length;
  return s + (b.length / rows.length) * Math.abs(p - o);
}, 0);

const byLength = (lo: number, hi: number) => rows.filter((r) => r.practice >= lo && r.practice < hi);
const recovery = (rs: typeof rows) => corr(rs.map((r) => r.trueTheta), rs.map((r) => r.estTheta));
const scoreMae = rows.reduce((s, r) => s + Math.abs(r.expScore - r.realScore), 0) / rows.length;

const fmt = (x: number, d = 3) => x.toFixed(d);
const report = `# Readyline engine simulation report

Engine ${initState(bankB).engineVersion}. Seed 20261126. Exam: ${bp.name} (${bp.scoredItems} items, pass ${bankB.passScore}).

## Content quality (phase A: ${cohortA} learners on generator difficulty estimates)

| Metric | Value |
|---|---|
| Items in bank | ${simItems.length} |
| Items never shown | ${neverShown} |
| Exposure per item (p10 / median / p90 / max) | ${pct(0.1)} / ${pct(0.5)} / ${pct(0.9)} / ${expCounts[expCounts.length - 1]} |
| Seeded miskeyed items | ${bad.length} |
| Miskeyed items caught, among those with 30+ responses | ${caughtEligible} / ${badEligible.length} |
| Miskeyed items caught | ${caught} / ${bad.length} (${fmt((100 * caught) / Math.max(1, bad.length), 1)}%) |
| Good items wrongly flagged | ${falseFlags} |
| Mean abs error of item difficulty, before calibration | ${fmt(bErrBefore)} |
| Mean abs error of item difficulty, after calibration | ${fmt(bErrAfter)} |

## Pass prediction (phase B: ${cohortB} new learners, calibrated bank)

| Metric | Value | Target |
|---|---|---|
| Brier score | ${fmt(brier)} | below baseline ${fmt(brierBaseline)} |
| Expected calibration error | ${fmt(ece)} | < 0.05 |
| Expected vs real score, mean abs error | ${fmt(scoreMae, 2)} items | |
| Real pass rate | ${fmt(100 * baseRate, 1)}% | |

### Calibration by predicted bucket

| Predicted P(pass) | Learners | Mean predicted | Actually passed |
|---|---|---|---|
${bins
  .map((b, i) => {
    if (!b.length) return `| ${i * 10}-${i * 10 + 10}% | 0 | | |`;
    const p = b.reduce((a, r) => a + r.pred, 0) / b.length;
    const o = b.reduce((a, r) => a + r.passed, 0) / b.length;
    return `| ${i * 10}-${i * 10 + 10}% | ${b.length} | ${fmt(100 * p, 1)}% | ${fmt(100 * o, 1)}% |`;
  })
  .join("\n")}

## Ability recovery (correlation of estimated vs true blueprint-weighted ability)

| Answers given | Learners | r | Target |
|---|---|---|---|
| 25-75 | ${byLength(25, 75).length} | ${fmt(recovery(byLength(25, 75)))} | |
| 75-150 | ${byLength(75, 150).length} | ${fmt(recovery(byLength(75, 150)))} | > 0.85 from 100 |
| 150-226 | ${byLength(150, 226).length} | ${fmt(recovery(byLength(150, 226)))} | > 0.85 |
`;

mkdirSync(new URL("../../reports/", import.meta.url), { recursive: true });
writeFileSync(new URL("../../reports/simulation.md", import.meta.url), report);
console.log(report);
