/**
 * What home says about today, and the activity grid. Derived from the log; nothing stored.
 */
import type { Bank } from "../engine/bank";
import type { AnswerEvent, LearnerState } from "../engine/types";
import { dueFacts, sessionPick, startOfDay, type SessionStart } from "./daily";
import { studyPlan, type StudySettings } from "./plan";

/** Rough seconds per question including feedback, for "about N minutes". */
export const SECONDS_PER_QUESTION = 45;

export interface Today {
  /** new facts still allowed today */
  newLeft: number;
  /** studied facts due now */
  due: number;
  answeredToday: number;
  /** nothing left to do today */
  done: boolean;
  /** about how long today's list takes */
  minutes: number;
  /** the session start to use if the learner starts now */
  start: SessionStart;
  quota: number;
}

export function today(state: LearnerState, bank: Bank, events: AnswerEvent[], settings: StudySettings, now: number, seedKey = ""): Today {
  const day = startOfDay(now);
  const quota = studyPlan(state, bank, settings, now).newPerDay;
  const start: SessionStart = { startAnswers: state.answers, startedAt: now, dayStartedAt: day };
  const before = new Set<string>();
  const fresh = new Set<string>();
  let answeredToday = 0;
  for (const e of events) {
    const f = bank.items.get(e.itemKey)?.factId;
    if (e.at >= day) answeredToday++;
    if (!f) continue;
    if (e.at < day) before.add(f);
    else if (!before.has(f)) fresh.add(f);
  }
  const newLeft = Math.max(0, quota - fresh.size);
  const due = dueFacts(state, bank, now).length;
  const done = sessionPick(state, bank, events, start, now, seedKey, quota) === null;
  const minutes = done ? 0 : Math.max(1, Math.round(((newLeft + due) * SECONDS_PER_QUESTION) / 60));
  return { newLeft, due, answeredToday, done, minutes, start, quota };
}

export interface DayCell {
  /** local midnight */
  day: number;
  count: number;
  /** 0 none, 1 to 4 more */
  level: 0 | 1 | 2 | 3 | 4;
  isToday: boolean;
  future: boolean;
  isExam: boolean;
}

export interface Activity {
  /** columns of 7 days, Sunday first */
  weeks: DayCell[][];
  daysStudied: number;
  /** consecutive study days ending today, or yesterday if today has none yet */
  currentRun: number;
  longestRun: number;
}

export const LEVELS = [1, 10, 20, 40];
const level = (n: number): DayCell["level"] => (n >= LEVELS[3]! ? 4 : n >= LEVELS[2]! ? 3 : n >= LEVELS[1]! ? 2 : n >= LEVELS[0]! ? 1 : 0);

const addDays = (t: number, n: number) => {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
};

/**
 * The grid: from the first answer (at most `pastWeeks` back) through the exam date when it is
 * set and within `futureWeeks`, otherwise through the end of this week.
 */
export function activity(events: AnswerEvent[], now: number, examAt?: number, pastWeeks = 16, futureWeeks = 16, minWeeks = 22): Activity {
  const today0 = startOfDay(now);
  const counts = new Map<number, number>();
  for (const e of events) counts.set(startOfDay(e.at), (counts.get(startOfDay(e.at)) ?? 0) + 1);
  const studiedDays = [...counts.keys()].sort((a, b) => a - b);

  const earliest = studiedDays[0] ?? today0;
  let from = Math.max(earliest, addDays(today0, -7 * pastWeeks));
  from = addDays(startOfDay(from), -new Date(from).getDay());
  const exam0 = examAt ? startOfDay(examAt) : null;
  let to = exam0 && exam0 >= today0 && exam0 <= addDays(today0, 7 * futureWeeks) ? exam0 : today0;
  to = addDays(to, 6 - new Date(to).getDay());
  // fill to a full row: with an exam the grid ends on exam week and grows into the past;
  // without one it grows into the weeks ahead
  while ((to - from) / 86_400_000 + 1 < 7 * minWeeks) {
    if (exam0 !== null && to >= exam0) from = addDays(from, -7);
    else to = addDays(to, 7);
  }

  const weeks: DayCell[][] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (new Date(d).getDay() === 0 || weeks.length === 0) weeks.push([]);
    const count = counts.get(d) ?? 0;
    weeks.at(-1)!.push({ day: d, count, level: level(count), isToday: d === today0, future: d > today0, isExam: d === exam0 });
  }

  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of studiedDays) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  let current = 0;
  let cursor = counts.has(today0) ? today0 : addDays(today0, -1);
  while (counts.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { weeks, daysStudied: studiedDays.length, currentRun: current, longestRun: longest };
}
