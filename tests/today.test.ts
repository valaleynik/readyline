import { describe, expect, it } from "vitest";
import { loadLiveBank } from "../src/content/bank";
import { applyAnswer, initState, type AnswerEvent, type LearnerState } from "../src/engine";
import { sessionPick, startOfDay } from "../src/session/daily";
import { activity, today } from "../src/session/today";

const { bank } = loadLiveBank();
const D = 86_400_000;
const day = new Date(2026, 10, 27, 9).getTime();

function sit(state: LearnerState, events: AnswerEvent[], startedAt: number, n: number, dayStartedAt?: number) {
  const start = { startAnswers: state.answers, startedAt, dayStartedAt };
  for (let i = 0; i < n; i++) {
    const at = startedAt + i * 30_000;
    const p = sessionPick(state, bank, events, start, at, "t", 12);
    if (!p) break;
    const ev: AnswerEvent = { id: events.length + 1, itemKey: p.item.key, correct: true, at, context: "session" };
    events.push(ev);
    state = applyAnswer(state, bank, ev);
  }
  return state;
}
const newFacts = (events: AnswerEvent[], from: number) => {
  const seen = new Set<string>(); const fresh = new Set<string>();
  for (const e of events) { const f = bank.items.get(e.itemKey)!.factId; if (e.at < from) seen.add(f); else if (!seen.has(f)) fresh.add(f); }
  return fresh.size;
};

describe("today", () => {
  it("the new-fact quota is per day: a second sitting the same day gets no fresh quota", () => {
    const ev: AnswerEvent[] = [];
    let st = sit(initState(bank), ev, day, 60, startOfDay(day));
    st = sit(st, ev, day + 3 * 3_600_000, 60, startOfDay(day));
    expect(newFacts(ev, startOfDay(day))).toBe(12);
    // without a day start (old behavior) a second sitting would add more
    const ev2: AnswerEvent[] = [];
    let s2 = sit(initState(bank), ev2, day, 60);
    s2 = sit(s2, ev2, day + 3 * 3_600_000, 60);
    expect(newFacts(ev2, startOfDay(day))).toBeGreaterThan(12);
  });

  it("says what's left, how long it takes, and when today is done", () => {
    const s0 = initState(bank);
    const t0 = today(s0, bank, [], {}, day);
    expect(t0.newLeft).toBe(12);
    expect(t0.done).toBe(false);
    expect(t0.minutes).toBe(9); // 12 x 45s
    const ev: AnswerEvent[] = [];
    const st = sit(s0, ev, day, 60, startOfDay(day));
    const t1 = today(st, bank, ev, {}, day + 3_600_000);
    expect(t1.newLeft).toBe(0);
    expect(t1.answeredToday).toBe(ev.length);
    expect(t1.done).toBe(true);
    expect(t1.minutes).toBe(0);
    // next morning there is new work again
    expect(today(st, bank, ev, {}, day + D).done).toBe(false);
  });
});

describe("activity grid", () => {
  const at = (daysAgo: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: 0, itemKey: "x", correct: true, at: day - daysAgo * D + i * 1000 }));

  it("counts days, shades by volume, and finds runs (a gap ends a run without erasing history)", () => {
    const ev = [...at(9, 5), ...at(8, 12), ...at(7, 25), ...at(2, 45), ...at(1, 3), ...at(0, 1)];
    const a = activity(ev, day);
    const cells = a.weeks.flat();
    expect(a.weeks.every((w) => w.length === 7)).toBe(true);
    expect(cells.filter((c) => c.isToday).length).toBe(1);
    const lv = (daysAgo: number) => cells.find((c) => c.day === startOfDay(day - daysAgo * D))!.level;
    expect([lv(9), lv(8), lv(7), lv(2), lv(5)]).toEqual([1, 2, 3, 4, 0]);
    expect(a.daysStudied).toBe(6);
    expect(a.currentRun).toBe(3);
    expect(a.longestRun).toBe(3);
  });

  it("today not studied yet keeps yesterday's run alive", () => {
    expect(activity([...at(2, 1), ...at(1, 1)], day).currentRun).toBe(2);
    expect(activity([...at(3, 1)], day).currentRun).toBe(0);
  });

  it("runs toward the exam: future days to the exam date, the exam marked", () => {
    const exam = day + 30 * D;
    const a = activity(at(0, 5), day, exam);
    const cells = a.weeks.flat();
    expect(cells.find((c) => c.isExam)!.day).toBe(startOfDay(exam));
    expect(cells.filter((c) => c.future).length).toBeGreaterThanOrEqual(30);
    // a new learner still sees a full-width grid
    expect(activity([], day).weeks.length).toBeGreaterThanOrEqual(8);
    // an exam too far out isn't drawn
    expect(activity([], day, day + 400 * D).weeks.flat().some((c) => c.isExam)).toBe(false);
  });
});
