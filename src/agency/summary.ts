/**
 * What an agency manager sees about one learner. Computed on the server from the learner's
 * own log with the same engine the learner's app uses, so the two can never disagree.
 * No question-level detail leaves this function.
 */
import { Bank } from "../engine/bank";
import { replay } from "../engine/learner";
import type { AnswerEvent } from "../engine/types";
import type { ExportedBank } from "../content/export";
import { mockResult, type MockSettings } from "../session/mock";
import { passChance } from "../session/passchance";
import { studyPlan, type StudyPlan } from "../session/plan";
import { latestResult, type ExamResult } from "../session/results";

export interface LearnerSummary {
  userId: string;
  email: string | null;
  joinedAt: string;
  examAt: number | null;
  daysLeft: number | null;
  planStatus: StudyPlan["status"];
  factsSeen: number;
  factsTotal: number;
  answers: number;
  /** answers in the last 7 days */
  answersThisWeek: number;
  lastActive: number | null;
  /** shown only when the learner's own app would show it */
  passChance: number | null;
  passChanceNeed: number | null;
  mocks: { at: number; score: number; total: number }[];
  result: { takenAt: number; passed: boolean; score: number | null } | null;
}

const WEEK = 7 * 86_400_000;

export function learnerSummary(
  data: ExportedBank,
  bank: Bank,
  m: { userId: string; email: string | null; joinedAt: string },
  events: AnswerEvent[],
  settings: MockSettings,
  results: ExamResult[],
  now: number,
): LearnerSummary {
  const state = replay(events, bank);
  const plan = studyPlan(state, bank, settings, now);
  const pc = passChance(events, bank, now, settings.examAt);
  const key = new Map(data.items.map((i) => [i.key, i.answer]));
  const last = latestResult(results);
  return {
    userId: m.userId,
    email: m.email,
    joinedAt: m.joinedAt,
    examAt: settings.examAt ?? null,
    daysLeft: plan.daysLeft,
    planStatus: plan.status,
    factsSeen: plan.factsSeen,
    factsTotal: plan.factsTotal,
    answers: events.length,
    answersThisWeek: events.filter((e) => now - e.at < WEEK).length,
    lastActive: events.length ? Math.max(...events.map((e) => e.at)) : null,
    passChance: pc.show ? pc.chance : null,
    passChanceNeed: pc.show ? null : pc.needMore,
    mocks: (settings.mocks ?? [])
      .filter((x) => x.submittedAt)
      .map((x) => {
        const r = mockResult(bank, events, x, (k) => key.get(k)!);
        return { at: x.submittedAt!, score: r.correct, total: r.total };
      }),
    result: last ? { takenAt: last.takenAt, passed: last.passed, score: last.score ?? null } : null,
  };
}

export const bankFrom = (data: ExportedBank) => new Bank(data.blueprint, data.items);
