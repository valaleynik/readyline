import { describe, expect, it } from "vitest";
import { loadLiveBank } from "../src/content/bank";
import { applyAnswer, initState, type AnswerEvent, type LearnerState } from "../src/engine";
import { retrievabilityAt } from "../src/engine/fsrs";
import { sigmoid } from "../src/engine/irt";
import { createRng } from "../src/engine/rng";
import { sessionPick } from "../src/session/daily";
import { passChance } from "../src/session/passchance";

const { bank } = loadLiveBank();
const DAY = 86_400_000;
const t0 = new Date(2026, 10, 1, 9).getTime();

/** A learner who behaves the way the model assumes: fixed ability per topic, FSRS forgetting. */
function study(days: number, seed = 3, g = 0.8) {
  const rng = createRng(seed);
  const truth = new Map(bank.topics().map((t) => [t, g + 0.5 * rng.normal()]));
  let st: LearnerState = initState(bank);
  const events: AnswerEvent[] = [];
  for (let d = 0; d < days; d++) {
    const day = t0 + d * DAY;
    const start = { startAnswers: st.answers, startedAt: day };
    for (let i = 0; i < 60; i++) {
      const at = day + i * 30_000;
      const p = sessionPick(st, bank, events, start, at, "t");
      if (!p) break;
      const m = st.facts[p.item.factId];
      const pr = bank.guess + (1 - bank.guess) * sigmoid(truth.get(p.item.topic)! - p.item.b) * (m ? retrievabilityAt(m, at) : 1);
      const ev: AnswerEvent = { id: events.length + 1, itemKey: p.item.key, correct: rng.next() < pr, at, context: "session" };
      events.push(ev);
      st = applyAnswer(st, bank, ev);
    }
  }
  return { events, lastDay: t0 + (days - 1) * DAY };
}

describe("pass chance gate", () => {
  it("stays hidden for a new learner and says what is left", () => {
    const pc = passChance([], bank, t0);
    expect(pc.show).toBe(false);
    expect(pc.chance).toBeNull();
    const { events, lastDay } = study(1);
    const one = passChance(events, bank, lastDay + 3_600_000);
    expect(one.show).toBe(false);
    expect(one.needMore).toBeGreaterThan(0);
    expect(one.focus).not.toBeNull();
  });

  it("unlocks for a learner the model fits, as a rounded, capped number with a score range", () => {
    const { events, lastDay } = study(10);
    const pc = passChance(events, bank, lastDay + 3_600_000);
    expect(pc.show).toBe(true);
    expect(pc.chance! * 100 % 5).toBeCloseTo(0);
    expect(pc.chance).toBeGreaterThanOrEqual(0.05);
    expect(pc.chance).toBeLessThanOrEqual(0.95);
    expect(pc.scoreRange![0]).toBeLessThanOrEqual(pc.scoreRange![1]);
  });

  it("hides again when the learner's results stop matching the model's predictions", () => {
    const { events, lastDay } = study(10);
    const day = lastDay + DAY;
    const wrong: AnswerEvent[] = [...events];
    let st = events.reduce((s, e) => applyAnswer(s, bank, e), initState(bank));
    const start = { startAnswers: st.answers, startedAt: day };
    for (let i = 0; i < 60; i++) {
      const at = day + i * 30_000;
      const p = sessionPick(st, bank, wrong, start, at, "t");
      if (!p) break;
      const ev: AnswerEvent = { id: wrong.length + 1, itemKey: p.item.key, correct: false, at, context: "session" };
      wrong.push(ev);
      st = applyAnswer(st, bank, ev);
    }
    const pc = passChance(wrong, bank, day + 3_600_000);
    expect(pc.show).toBe(false);
    expect(pc.checks.find((c) => c.name === "selfCheck")!.ok).toBe(false);
  });

  it("once unlocked, survives a short break but not a long one", () => {
    const { events, lastDay } = study(10);
    expect(passChance(events, bank, lastDay + 8 * DAY).show).toBe(true);
    expect(passChance(events, bank, lastDay + 11 * DAY).show).toBe(false);
  });
});
