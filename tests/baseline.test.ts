import { describe, expect, it } from "vitest";
import { loadLiveBank } from "../src/content/bank";
import { applyAnswer, initState, type AnswerEvent } from "../src/engine";
import { BASELINE_LENGTH, baselinePick, baselineResult, baselineStatus, sectionQuotas } from "../src/session/baseline";

const { bank } = loadLiveBank();
const now = new Date(2026, 10, 27, 10).getTime();
const DAY = 86_400_000;

function takeBaseline(knows: (topic: string) => boolean) {
  let state = initState(bank);
  const events: AnswerEvent[] = [];
  for (let i = 0; i < 100; i++) {
    const p = baselinePick(state, bank, events, now + i, "u");
    if (!p) break;
    const ev: AnswerEvent = { id: events.length + 1, itemKey: p.item.key, correct: knows(p.item.topic), at: now + i, context: "baseline" };
    events.push(ev);
    state = applyAnswer(state, bank, ev);
  }
  return { state, events };
}

describe("baseline test", () => {
  it("is offered to a brand-new learner, not to one already studying or with an exam days away", () => {
    const s0 = initState(bank);
    expect(baselineStatus(s0, bank, [], {}, now)).toBe("needed");
    expect(baselineStatus(s0, bank, [], { examAt: now + 3 * DAY }, now)).toBe("not_offered");
    expect(baselineStatus(s0, bank, [], { baselineSkipped: true }, now)).toBe("skipped");
    const studying: AnswerEvent[] = [{ id: 1, itemKey: [...bank.items.keys()][0]!, correct: true, at: now, context: "session" }];
    expect(baselineStatus(s0, bank, studying, {}, now)).toBe("not_offered");
  });

  it("asks exactly the baseline length, one question per fact, across every section", () => {
    const { events } = takeBaseline(() => true);
    expect(events.length).toBe(BASELINE_LENGTH);
    const facts = events.map((e) => bank.items.get(e.itemKey)!.factId);
    expect(new Set(facts).size).toBe(facts.length);
    const sections = new Set(events.map((e) => bank.topicSection.get(bank.items.get(e.itemKey)!.topic)));
    expect(sections.size).toBe(bank.blueprint.sections.length);
    expect(baselineStatus(initState(bank), bank, events, {}, now)).toBe("done");
  });

  it("splits the baseline by each section's share of the exam", () => {
    const q = sectionQuotas(bank);
    expect([...q.values()].reduce((a, b) => a + b, 0)).toBe(BASELINE_LENGTH);
    const total = bank.blueprint.sections.reduce((a, s) => a + s.items, 0);
    for (const sec of bank.blueprint.sections) {
      expect(q.get(sec.code)!).toBeGreaterThanOrEqual(1);
      expect(Math.abs(q.get(sec.code)! - (BASELINE_LENGTH * sec.items) / total)).toBeLessThan(1.5);
    }
  });

  it("finds a learner's weak section", () => {
    const weak = "IV";
    const { state, events } = takeBaseline((t) => bank.topicSection.get(t) !== weak);
    const r = baselineResult(state, bank, events);
    expect(r.weakest[0]).toBe(weak);
    expect(r.range[0]).toBeLessThanOrEqual(r.range[1]);
    expect(r.sections.reduce((a, s) => a + s.asked, 0)).toBe(BASELINE_LENGTH);
  });
});
