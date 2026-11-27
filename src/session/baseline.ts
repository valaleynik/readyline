/**
 * The baseline test: a short placement round at signup. It uses the engine's
 * diagnostic mode (spend each question where ability is least certain, weighted by
 * exam share) and its answers go into the same event log as everything else.
 * The only difference from studying is the label on the events and the screen.
 */
import type { Bank } from "../engine/bank";
import type { Pick } from "../engine/scheduler";
import { information } from "../engine/irt";
import { topicTheta } from "../engine/learner";
import { createRng, hashSeed } from "../engine/rng";
import { readiness } from "../engine/readiness";
import type { AnswerEvent, LearnerState } from "../engine/types";
import { studyPlan, type StudySettings } from "./plan";

export const BASELINE_LENGTH = 20;
/** With this many days or fewer before the exam, the baseline is skipped: time goes to learning. */
export const BASELINE_SKIP_DAYS = 5;

export interface BaselineSettings extends StudySettings {
  /** the learner chose to skip the baseline */
  baselineSkipped?: boolean;
}

export type BaselineStatus = "needed" | "in_progress" | "done" | "skipped" | "not_offered";

export function baselineStatus(
  state: LearnerState,
  bank: Bank,
  events: AnswerEvent[],
  settings: BaselineSettings,
  now: number,
): BaselineStatus {
  const taken = events.filter((e) => e.context === "baseline").length;
  if (taken >= BASELINE_LENGTH) return "done";
  if (settings.baselineSkipped) return "skipped";
  if (taken > 0) return "in_progress";
  // Already studying without a baseline: never interrupt them with one.
  if (events.length > 0) return "not_offered";
  const plan = studyPlan(state, bank, settings, now);
  if (plan.hasDate && plan.daysLeft !== null && plan.daysLeft <= BASELINE_SKIP_DAYS) return "not_offered";
  return "needed";
}

/**
 * Baseline questions per section, proportional to the section's share of the exam,
 * with at least one per section (largest-remainder rounding).
 */
export function sectionQuotas(bank: Bank, total = BASELINE_LENGTH): Map<string, number> {
  const secs = bank.blueprint.sections;
  const sum = secs.reduce((a, s) => a + s.items, 0);
  const q = new Map(secs.map((s) => [s.code, 1]));
  let left = total - secs.length;
  const raw = secs.map((s) => ({ code: s.code, want: (left * s.items) / sum }));
  for (const r of raw) {
    const f = Math.floor(r.want);
    q.set(r.code, q.get(r.code)! + f);
    left -= f;
  }
  for (const r of [...raw].sort((a, b) => (b.want % 1) - (a.want % 1)).slice(0, left)) q.set(r.code, q.get(r.code)! + 1);
  return q;
}

/**
 * Next baseline question, or null when the baseline is complete.
 * Fills the section furthest below its quota; within it, the topic whose ability is
 * least certain; within that, an unseen fact's item that is most informative at the
 * learner's current estimate (random among the top few, so learners see different items).
 */
export function baselinePick(state: LearnerState, bank: Bank, events: AnswerEvent[], _now: number, seedKey = ""): Pick | null {
  const mine = events.filter((e) => e.context === "baseline");
  if (mine.length >= BASELINE_LENGTH) return null;
  const rng = createRng(hashSeed(`${seedKey}:baseline:${mine.length}`));
  const asked = new Map<string, number>();
  for (const e of mine) {
    const sec = bank.topicSection.get(bank.items.get(e.itemKey)?.topic ?? "");
    if (sec) asked.set(sec, (asked.get(sec) ?? 0) + 1);
  }
  const quotas = sectionQuotas(bank);
  const order = bank.blueprint.sections
    .map((s) => ({ s, gap: quotas.get(s.code)! - (asked.get(s.code) ?? 0) }))
    .filter((x) => x.gap > 0)
    .sort((a, b) => b.gap - a.gap || a.s.code.localeCompare(b.s.code));
  for (const { s } of order) {
    const topics = s.topics
      .map((t) => t.code)
      .filter((t) => (bank.byTopic.get(t) ?? []).some((i) => !state.facts[i.factId]))
      .sort((a, b) => topicTheta(state, b).var - topicTheta(state, a).var || a.localeCompare(b));
    const topic = topics[0];
    if (!topic) continue;
    const th = topicTheta(state, topic).mean;
    const ranked = (bank.byTopic.get(topic) ?? [])
      .filter((i) => !state.facts[i.factId])
      .map((item) => ({ item, info: information(th, item.b, bank.guess) }))
      .sort((a, b) => b.info - a.info || (a.item.key < b.item.key ? -1 : 1))
      .slice(0, 5);
    const item = ranked[rng.int(ranked.length)]!.item;
    return { item, reason: "diagnostic", topic, factId: item.factId, value: 0 };
  }
  return null;
}

export interface BaselineSection {
  code: string;
  name: string;
  asked: number;
  correct: number;
  /** model estimate of accuracy on this section of the real exam */
  estimate: number;
}

export interface BaselineResult {
  answered: number;
  correct: number;
  sections: BaselineSection[];
  /** likely range of percent correct on the exam today (10th to 90th percentile) */
  range: [number, number];
  /** sections ordered weakest first, for "start here" */
  weakest: string[];
}

export function baselineResult(state: LearnerState, bank: Bank, events: AnswerEvent[]): BaselineResult {
  const mine = events.filter((e) => e.context === "baseline");
  const r = readiness(state, bank, { draws: 3000, seed: 1 });
  const sections = bank.blueprint.sections.map((sec, i) => {
    const codes = new Set(sec.topics.map((t) => t.code));
    const here = mine.filter((e) => codes.has(bank.items.get(e.itemKey)?.topic ?? ""));
    return {
      code: sec.code,
      name: sec.name,
      asked: here.length,
      correct: here.filter((e) => e.correct).length,
      estimate: r.sections[i]!.expectedAccuracy,
    };
  });
  const n = bank.blueprint.scoredItems;
  return {
    answered: mine.length,
    correct: mine.filter((e) => e.correct).length,
    sections,
    range: [r.scoreInterval[0] / n, r.scoreInterval[1] / n],
    weakest: [...sections].sort((a, b) => a.estimate - b.estimate).map((s) => s.code),
  };
}
