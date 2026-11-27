import { describe, expect, it } from "vitest";
import { loadLiveBank } from "../src/content/bank";
import { applyAnswer, initState, readiness, type AnswerEvent } from "../src/engine";
import { progress, sessionPick, NEW_PER_DAY } from "../src/session/daily";
import { studyPlan, MAX_NEW, SUSTAINABLE_NEW } from "../src/session/plan";

const { bank } = loadLiveBank();
const DAY = 86_400_000;
const now = new Date(2026, 10, 27, 10).getTime();
const at = (days: number) => new Date(2026, 10, 27 + days, 9).getTime();
const fresh = initState(bank);
const total = bank.factTopic.size;

describe("study plan from the exam date", () => {
  it("with no date, keeps the steady default", () => {
    const p = studyPlan(fresh, bank, {}, now);
    expect(p).toMatchObject({ hasDate: false, status: "no_date", newPerDay: NEW_PER_DAY });
  });

  it("spreads the remaining facts over the days before the review buffer", () => {
    const p = studyPlan(fresh, bank, { examAt: at(30) }, now);
    expect(p.daysLeft).toBe(30);
    expect(p.newPerDay).toBe(Math.ceil(total / 29));
    expect(p.status).toBe("on_track");
  });

  it("flags a learner who cannot finish at a sustainable pace, and caps the cram", () => {
    const p = studyPlan(fresh, bank, { examAt: at(7) }, now);
    expect(p.status).toBe("behind");
    expect(p.newPerDay).toBe(MAX_NEW);
    expect(p.daysBehind).toBe(Math.ceil(total / SUSTAINABLE_NEW) - 6);
  });

  it("goes review-only in the last days and handles a past date", () => {
    expect(studyPlan(fresh, bank, { examAt: at(1) }, now).status).toBe("review_only");
    expect(studyPlan(fresh, bank, { examAt: at(1) }, now).newPerDay).toBe(0);
    expect(studyPlan(fresh, bank, { examAt: at(-3) }, now).status).toBe("past");
  });

  it("the session introduces exactly the plan's quota of new facts", () => {
    let state = fresh;
    const events: AnswerEvent[] = [];
    const s = { startAnswers: 0, startedAt: now };
    for (let i = 0; i < 100; i++) {
      const p = sessionPick(state, bank, events, s, now + i * 30_000, "u", 5);
      if (!p) break;
      const ev = { id: events.length + 1, itemKey: p.item.key, correct: true, at: now + i * 30_000 };
      events.push(ev);
      state = applyAnswer(state, bank, ev);
    }
    expect(progress(state, bank, events, s, now + DAY / 2, "u", 5).newIntroduced).toBe(5);
  });

  it("readiness measured on a distant exam day is lower than today, because of forgetting", () => {
    let state = fresh;
    const items = [...bank.items.values()].slice(0, 120);
    items.forEach((it, i) => (state = applyAnswer(state, bank, { id: i + 1, itemKey: it.key, correct: true, at: now + i })));
    const today = readiness(state, bank, { draws: 3000, seed: 1 });
    const later = readiness(state, bank, { draws: 3000, seed: 1, examAt: now + 60 * DAY });
    expect(later.expectedScore).toBeLessThan(today.expectedScore);
  });
});
