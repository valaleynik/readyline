/**
 * Study plan from an exam date. A pure function of the learner state, the bank and
 * one setting (the exam date). It stores nothing; the session reads it to set the
 * day's new-fact quota, and readiness reads the same date to measure exam day.
 */
import type { Bank } from "../engine/bank";
import type { LearnerState } from "../engine/types";
import { NEW_PER_DAY } from "./daily";

const DAY = 86_400_000;
/** The last days before the exam are for review only: no new material. */
export const REVIEW_DAYS = 2;
/** New facts a day a learner can keep up with alongside reviews. */
export const SUSTAINABLE_NEW = 25;
/** Floor so a far-off exam still moves forward every day. */
export const MIN_NEW = 5;
/** Ceiling so a cram schedule never buries the learner. */
export const MAX_NEW = 40;

export interface StudySettings {
  /** epoch ms of the exam; absent means no date set */
  examAt?: number;
}

export interface StudyPlan {
  hasDate: boolean;
  /** whole days from today until the exam (0 = exam is today) */
  daysLeft: number | null;
  factsTotal: number;
  factsSeen: number;
  factsRemaining: number;
  /** new facts to introduce today */
  newPerDay: number;
  status: "no_date" | "on_track" | "behind" | "review_only" | "past";
  /** extra days the learner would need at a sustainable pace (0 if on track) */
  daysBehind: number;
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function studyPlan(state: LearnerState, bank: Bank, settings: StudySettings, now: number): StudyPlan {
  const factsTotal = bank.factTopic.size;
  const factsSeen = Object.keys(state.facts).filter((f) => bank.factTopic.has(f)).length;
  const factsRemaining = Math.max(0, factsTotal - factsSeen);
  const base = { factsTotal, factsSeen, factsRemaining };

  if (settings.examAt === undefined) {
    return { ...base, hasDate: false, daysLeft: null, newPerDay: NEW_PER_DAY, status: "no_date", daysBehind: 0 };
  }
  const daysLeft = Math.round((startOfDay(settings.examAt) - startOfDay(now)) / DAY);
  if (daysLeft < 0) return { ...base, hasDate: true, daysLeft, newPerDay: NEW_PER_DAY, status: "past", daysBehind: 0 };

  // Days that can still take new material, counting today.
  const learningDays = Math.max(0, daysLeft - REVIEW_DAYS + 1);
  if (factsRemaining === 0) {
    return { ...base, hasDate: true, daysLeft, newPerDay: 0, status: "on_track", daysBehind: 0 };
  }
  if (learningDays === 0) {
    return { ...base, hasDate: true, daysLeft, newPerDay: 0, status: "review_only", daysBehind: Math.ceil(factsRemaining / SUSTAINABLE_NEW) };
  }
  const needed = Math.ceil(factsRemaining / learningDays);
  const newPerDay = Math.min(MAX_NEW, Math.max(MIN_NEW, needed));
  const daysBehind = needed > SUSTAINABLE_NEW ? Math.ceil(factsRemaining / SUSTAINABLE_NEW) - learningDays : 0;
  return { ...base, hasDate: true, daysLeft, newPerDay, status: daysBehind > 0 ? "behind" : "on_track", daysBehind };
}
