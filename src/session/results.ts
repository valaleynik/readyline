/**
 * Real exam results, reported by the learner. These are the only ground truth for the
 * pass chance. Append-only: a correction is a new report, and the latest one for an
 * exam day wins. What the app predicted is not stored; it is rebuilt from the log.
 */
import type { Bank } from "../engine/bank";
import type { AnswerEvent } from "../engine/types";
import type { BaselineSettings } from "./baseline";
import { passChance, type PassChance } from "./passchance";

export interface ExamResult {
  /** client-made unique id, so a retried upload can never double-count */
  id: string;
  /** when the exam was taken (epoch ms) */
  takenAt: number;
  passed: boolean;
  /** score as printed on the report, 0 to 100, if the learner gave one */
  score?: number;
  reportedAt: number;
}

export interface ResultSettings extends BaselineSettings {
  /** how many times the learner chose "ask me later" for the current exam date */
  resultPromptSkips?: number;
  resultPromptSkippedAt?: number;
}

/** Stop asking after this many "later"s; the "I took the exam" link stays. */
export const MAX_PROMPT_SKIPS = 3;
/** Ask from this hour on exam day: most people have taken it by late afternoon. */
export const ASK_FROM_HOUR = 17;

const startOfDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
export const sameDay = (a: number, b: number) => startOfDay(a) === startOfDay(b);

/** The result reported for a given exam day, latest report wins. */
export function resultFor(results: ExamResult[], day: number): ExamResult | null {
  return results.filter((r) => sameDay(r.takenAt, day)).sort((a, b) => b.reportedAt - a.reportedAt)[0] ?? null;
}

/** The learner's latest exam result of any day. */
export function latestResult(results: ExamResult[]): ExamResult | null {
  return [...results].sort((a, b) => b.takenAt - a.takenAt || b.reportedAt - a.reportedAt)[0] ?? null;
}

/** Should home ask "How did the exam go?" right now? */
export function shouldAskResult(settings: ResultSettings, results: ExamResult[], now: number): boolean {
  const at = settings.examAt;
  if (!at) return false;
  if (now < startOfDay(at) + ASK_FROM_HOUR * 3_600_000) return false;
  if (resultFor(results, at)) return false;
  if ((settings.resultPromptSkips ?? 0) >= MAX_PROMPT_SKIPS) return false;
  if (settings.resultPromptSkippedAt && sameDay(settings.resultPromptSkippedAt, now)) return false;
  return true;
}

/** "Ask me later": counts toward the limit and hides the prompt for the rest of today. */
export function skipResultPrompt(settings: ResultSettings, now: number): ResultSettings {
  return { ...settings, resultPromptSkips: (settings.resultPromptSkips ?? 0) + 1, resultPromptSkippedAt: now };
}

/**
 * Settings after a report. A pass keeps the date (the app shows the result). A fail clears
 * the date so the learner sets a retake date; studying continues from the same log.
 */
export function settingsAfterResult(settings: ResultSettings, r: ExamResult): ResultSettings {
  const { resultPromptSkips: _s, resultPromptSkippedAt: _a, ...rest } = settings;
  return r.passed ? rest : { ...rest, examAt: undefined };
}

/** What the app would have shown the night before: only answers given before the exam count. */
export function predictionBefore(events: AnswerEvent[], bank: Bank, r: ExamResult): PassChance {
  const day = startOfDay(r.takenAt);
  return passChance(
    events.filter((e) => e.at < day),
    bank,
    day - 1,
    r.takenAt,
  );
}

export function newResult(takenAt: number, passed: boolean, score: number | undefined, now: number, id?: string): ExamResult {
  if (score !== undefined && !(Number.isInteger(score) && score >= 0 && score <= 100)) {
    throw new Error("score must be a whole number from 0 to 100");
  }
  return {
    id: id ?? globalThis.crypto.randomUUID(),
    takenAt,
    passed,
    ...(score !== undefined ? { score } : {}),
    reportedAt: now,
  };
}
