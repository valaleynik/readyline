/**
 * Gate for the pass chance. The number is shown only when the model has earned it
 * for this learner; until then the learner sees what is left to unlock it.
 * Everything here is derived from the event log: nothing new is stored.
 */
import type { Bank } from "../engine/bank";
import { retrievabilityAt } from "../engine/fsrs";
import { sigmoid } from "../engine/irt";
import { applyAnswer, initState, topicTheta } from "../engine/learner";
import { readiness, type Readiness } from "../engine/readiness";
import type { AnswerEvent, LearnerState } from "../engine/types";

const DAY = 86_400_000;

export interface GateRules {
  /** answers needed in every section */
  minPerSection: number;
  /** share of exam weight whose topics have at least 2 answers */
  coverage: number;
  /** widest allowed model-uncertainty band on expected percent correct */
  maxWidth: number;
  /** answers the self-check needs before it can pass */
  minChecked: number;
  /** largest allowed gap between predicted and actual results, in standard errors */
  maxZ: number;
  /** most recent answer must be this fresh */
  recentDays: number;
}

/** To unlock the number. */
export const UNLOCK: GateRules = { minPerSection: 5, coverage: 0.6, maxWidth: 0.1, minChecked: 60, maxZ: 2, recentDays: 7 };
/** To keep it once it was unlocked before today (so it does not flicker). */
export const KEEP: GateRules = { minPerSection: 5, coverage: 0.5, maxWidth: 0.13, minChecked: 60, maxZ: 2.5, recentDays: 10 };
/** The self-check looks at this many most recent answers. */
export const CHECK_WINDOW = 100;

/**
 * Probability the engine gives, before the answer, that this learner gets this item right:
 * ability against difficulty, times memory for facts already studied. The same two parts
 * drive the exam forecast, so checking these predictions checks the forecast's inputs.
 */
export function predictCorrect(state: LearnerState, bank: Bank, ev: AnswerEvent): number | null {
  const item = bank.items.get(ev.itemKey);
  if (!item) return null;
  const th = topicTheta(state, item.topic).mean;
  const m = state.facts[item.factId];
  const keep = m ? retrievabilityAt(m, ev.at) : 1;
  return bank.guess + (1 - bank.guess) * sigmoid(th - item.b) * keep;
}

export interface SelfCheck {
  checked: number;
  predicted: number;
  actual: number;
  /** (actual - predicted) in standard errors */
  z: number;
}

/** Replay the log, scoring each answer against the prediction made just before it. */
export function selfCheck(events: AnswerEvent[], bank: Bank, window = CHECK_WINDOW): { state: LearnerState; check: SelfCheck } {
  let state = initState(bank);
  const preds: { p: number; y: number }[] = [];
  for (const ev of [...events].sort((a, b) => a.id - b.id)) {
    const p = predictCorrect(state, bank, ev);
    if (p !== null) preds.push({ p, y: ev.correct ? 1 : 0 });
    state = applyAnswer(state, bank, ev);
  }
  const w = preds.slice(-window);
  const predicted = w.reduce((a, x) => a + x.p, 0);
  const actual = w.reduce((a, x) => a + x.y, 0);
  const se = Math.sqrt(w.reduce((a, x) => a + x.p * (1 - x.p), 0)) || 1;
  return {
    state,
    check: {
      checked: w.length,
      predicted: w.length ? predicted / w.length : 0,
      actual: w.length ? actual / w.length : 0,
      z: (actual - predicted) / se,
    },
  };
}

export type CheckName = "coverage" | "certainty" | "selfCheck" | "recency";

export interface GateCheck {
  name: CheckName;
  ok: boolean;
  /** rough answers still needed for this check; null when more answers alone won't fix it */
  need: number | null;
}

export interface PassChance {
  show: boolean;
  checks: GateCheck[];
  /** rough answers still needed to unlock, when that can be estimated */
  needMore: number | null;
  /** section to work on to unlock it soonest */
  focus: string | null;
  /** chance of passing, rounded to 5s and kept between 5% and 95% (only when shown) */
  chance: number | null;
  /** likely score range on the exam, in items (only when shown) */
  scoreRange: [number, number] | null;
  passScore: number;
  scoredItems: number;
  /** what the model was checked against, for an honest "how we know" line */
  check: SelfCheck;
}

function evaluate(state: LearnerState, bank: Bank, check: SelfCheck, r: Readiness, now: number, rules: GateRules) {
  const secs = bank.blueprint.sections;
  const perSection = new Map(secs.map((s) => [s.code, 0]));
  for (const [t, d] of Object.entries(state.topics)) {
    const sec = bank.topicSection.get(t);
    if (sec) perSection.set(sec, perSection.get(sec)! + d.n);
  }

  // coverage
  const sectionGap = secs.map((s) => ({ code: s.code, gap: Math.max(0, rules.minPerSection - perSection.get(s.code)!) }));
  let covered = 0;
  const thin: { t: string; w: number; need: number }[] = [];
  for (const [t, w] of bank.topicWeight) {
    const n = state.topics[t]?.n ?? 0;
    if (n >= 2) covered += w;
    else thin.push({ t, w, need: 2 - n });
  }
  thin.sort((a, b) => b.w - a.w || a.t.localeCompare(b.t));
  let topicNeed = 0;
  let c = covered;
  const focusTopics: string[] = [];
  for (const x of thin) {
    if (c >= rules.coverage) break;
    c += x.w;
    topicNeed += x.need;
    focusTopics.push(x.t);
  }
  const sectionNeed = sectionGap.reduce((a, s) => a + s.gap, 0);
  const coverageOk = sectionNeed === 0 && covered >= rules.coverage;

  // certainty: width of the model-uncertainty band, as a share of the exam
  const n = bank.blueprint.scoredItems;
  const width = (r.abilityInterval[1] - r.abilityInterval[0]) / n;
  const certaintyOk = width <= rules.maxWidth;
  // band shrinks roughly with the square root of the evidence
  const certaintyNeed = certaintyOk ? 0 : Math.ceil(state.answers * ((width / rules.maxWidth) ** 2 - 1)) || 1;

  // self-check
  const enough = check.checked >= rules.minChecked;
  const selfOk = enough && Math.abs(check.z) <= rules.maxZ;
  const selfNeed = selfOk ? 0 : enough ? null : rules.minChecked - check.checked;

  const recencyOk = state.answers > 0 && now - state.lastAt <= rules.recentDays * DAY;

  const checks: GateCheck[] = [
    { name: "coverage", ok: coverageOk, need: coverageOk ? 0 : Math.max(sectionNeed, topicNeed) },
    { name: "certainty", ok: certaintyOk, need: certaintyNeed },
    { name: "selfCheck", ok: selfOk, need: selfNeed },
    { name: "recency", ok: recencyOk, need: recencyOk ? 0 : 1 },
  ];

  // focus: the section furthest below its minimum, else the one holding the most-needed topic
  const worstGap = [...sectionGap].sort((a, b) => b.gap - a.gap)[0]!;
  const focus = !coverageOk
    ? worstGap.gap > 0
      ? worstGap.code
      : (bank.topicSection.get(focusTopics[0] ?? "") ?? null)
    : !certaintyOk
      ? [...secs].sort((a, b) => sectionVar(state, bank, b.code) * b.items - sectionVar(state, bank, a.code) * a.items)[0]!.code
      : null;

  return { checks, focus };
}

function sectionVar(state: LearnerState, bank: Bank, code: string): number {
  const sec = bank.blueprint.sections.find((s) => s.code === code)!;
  return sec.topics.reduce((a, t) => a + topicTheta(state, t.code).var, 0) / sec.topics.length;
}

function readinessFor(state: LearnerState, bank: Bank, examAt: number | undefined, now: number): Readiness {
  return readiness(state, bank, { draws: 2000, seed: 1, examAt: examAt && examAt > now ? examAt : undefined });
}

const startOfDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export function passChance(events: AnswerEvent[], bank: Bank, now: number, examAt?: number): PassChance {
  const { state, check } = selfCheck(events, bank);
  const r = readinessFor(state, bank, examAt, now);

  // Was it already unlocked before today? Then hold it to the looser keep rules.
  const before = events.filter((e) => e.at < startOfDay(now));
  let rules = UNLOCK;
  if (before.length > 0 && before.length < events.length) {
    const prev = selfCheck(before, bank);
    const pr = readinessFor(prev.state, bank, examAt, startOfDay(now));
    if (evaluate(prev.state, bank, prev.check, pr, startOfDay(now), UNLOCK).checks.every((c) => c.ok)) rules = KEEP;
  } else if (before.length === events.length && events.length > 0) {
    // Nothing answered today: unlocked-before-today is the same as unlocked now under UNLOCK
    // except for recency, which should use the keep window.
    const e = evaluate(state, bank, check, r, now, UNLOCK);
    if (e.checks.filter((c) => c.name !== "recency").every((c) => c.ok)) rules = KEEP;
  }

  const { checks, focus } = evaluate(state, bank, check, r, now, rules);
  const show = checks.every((c) => c.ok);
  const needs = checks.filter((c) => !c.ok).map((c) => c.need);
  const needMore = show ? 0 : needs.some((x) => x === null) ? null : Math.max(...(needs as number[]));
  return {
    show,
    checks,
    needMore,
    focus: show ? null : focus,
    chance: show ? Math.min(95, Math.max(5, Math.round((r.pPass * 100) / 5) * 5)) / 100 : null,
    scoreRange: show ? r.scoreInterval : null,
    passScore: bank.passScore,
    scoredItems: bank.blueprint.scoredItems,
    check,
  };
}
