import { describe, expect, it } from "vitest";
import { loadLiveBank } from "../src/content/bank";
import { exportBank } from "../src/content/export";
import { applyAnswer, initState } from "../src/engine";
import type { AnswerEvent } from "../src/engine";
import { MAX_PER_SESSION, NEW_PER_DAY, calibration, progress, sessionPick } from "../src/session/daily";

const { bank } = loadLiveBank();
const DAY = 86_400_000;

function run(correctRate: number, start: number, seed: number, prior: AnswerEvent[] = []) {
  let state = initState(bank);
  for (const e of prior) state = applyAnswer(state, bank, e);
  const events = [...prior];
  const s = { startAnswers: state.answers, startedAt: start };
  let rnd = seed;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  let t = start;
  for (let i = 0; i < 500; i++) {
    const p = sessionPick(state, bank, events, s, t, "u1");
    if (!p) break;
    const ev: AnswerEvent = { id: events.length + 1, itemKey: p.item.key, correct: rand() < correctRate, at: t, confidence: rand() < 0.5 ? "sure" : "guess" };
    events.push(ev);
    state = applyAnswer(state, bank, ev);
    t += 30_000;
  }
  return { state, events, s, t };
}

describe("daily session", () => {
  it("export and engine see exactly the same live items", () => {
    const exported = new Set(exportBank().items.map((i) => i.key));
    expect(exported).toEqual(new Set(bank.items.keys()));
  });

  it("the app's bundled bank.json is current (run: npx tsx src/content/export.ts)", async () => {
    const { readFileSync } = await import("node:fs");
    const bundled = JSON.parse(readFileSync(new URL("../web/data/bank.json", import.meta.url), "utf8"));
    expect(bundled).toEqual(JSON.parse(JSON.stringify(exportBank())));
  });

  it("a strong learner's first day stops after the new-fact quota, with nothing due", () => {
    const { state, events, s, t } = run(1, 0, 7);
    const p = progress(state, bank, events, s, t, "u1");
    expect(p.done).toBe(true);
    expect(p.doneReason).toBe("cleared");
    expect(p.newIntroduced).toBe(NEW_PER_DAY);
    expect(p.answered).toBeLessThan(MAX_PER_SESSION);
  });

  it("a struggling learner never exceeds the session cap", () => {
    const { events } = run(0.3, 0, 11);
    expect(events.length).toBeLessThanOrEqual(MAX_PER_SESSION);
  });

  it("the next day brings back due facts before anything else is required", () => {
    const day1 = run(0.8, 0, 3);
    const day2 = run(0.8, 10 * DAY, 5, day1.events);
    const fresh = day2.events.slice(day1.events.length);
    expect(fresh.length).toBeGreaterThan(0);
    const seenDay1 = new Set(day1.events.map((e) => bank.items.get(e.itemKey)!.factId));
    expect(fresh.some((e) => seenDay1.has(bank.items.get(e.itemKey)!.factId))).toBe(true);
  });

  it("a returning learner clears every due fact, even ones answered in their last session", () => {
    const day1 = run(1, 0, 3);
    const day2 = run(1, 10 * DAY, 5, day1.events);
    const p = progress(day2.state, bank, day2.events, day2.s, day2.t, "u1");
    expect(p.done).toBe(true);
    expect(p.dueRemaining).toBe(0);
  });

  it("calibration counts each confidence and outcome pair", () => {
    const c = calibration([
      { id: 1, itemKey: "x", correct: true, at: 0, confidence: "sure" },
      { id: 2, itemKey: "x", correct: false, at: 0, confidence: "sure" },
      { id: 3, itemKey: "x", correct: true, at: 0, confidence: "guess" },
      { id: 4, itemKey: "x", correct: true, at: 0 },
    ]);
    expect(c).toEqual({ sureRight: 1, sureWrong: 1, guessRight: 1, guessWrong: 0 });
  });
});

describe("session progress for the screen", () => {
  it("estimates what's left, and reports when the next reviews fall due", async () => {
    const { remainingEstimate, nextDueAt } = await import("../src/session/daily");
    const { loadLiveBank } = await import("../src/content/bank");
    const { initState, applyAnswer } = await import("../src/engine");
    const { bank } = loadLiveBank();
    expect(remainingEstimate({ answered: 3, correct: 2, newIntroduced: 3, dueRemaining: 1, done: false }, 12)).toBe(10);
    expect(remainingEstimate({ answered: 59, correct: 2, newIntroduced: 3, dueRemaining: 9, done: false }, 12)).toBe(1);
    expect(remainingEstimate({ answered: 5, correct: 5, newIntroduced: 12, dueRemaining: 0, done: false }, 12)).toBe(1);
    expect(remainingEstimate({ answered: 5, correct: 5, newIntroduced: 12, dueRemaining: 0, done: true }, 12)).toBe(0);
    const s0 = initState(bank);
    expect(nextDueAt(s0, bank)).toBeNull();
    const key = [...bank.items.keys()][0]!;
    const t = Date.UTC(2026, 10, 1);
    const right = applyAnswer(s0, bank, { id: 1, itemKey: key, correct: true, at: t });
    expect(nextDueAt(right, bank)!).toBeGreaterThan(t);
    const wrong = applyAnswer(s0, bank, { id: 1, itemKey: key, correct: false, at: t });
    expect(nextDueAt(wrong, bank)).toBe(t);
  });
});
