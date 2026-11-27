import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Bank, applyAnswer, initState, nextItem, readiness, replay, mockForm, fsrs } from "../src/engine";
import { updateAbility, pCorrect } from "../src/engine/irt";
import type { AnswerEvent, Blueprint, ItemMeta } from "../src/engine";

const bp = JSON.parse(
  readFileSync(new URL("../content/exams/nj-life/blueprint.json", import.meta.url), "utf8"),
) as Blueprint;

function makeItems(): ItemMeta[] {
  const items: ItemMeta[] = [];
  for (const s of bp.sections)
    for (const t of s.topics)
      for (let f = 0; f < 6; f++)
        for (let v = 0; v < 2; v++)
          items.push({ key: `${t.code}-f${f}-v${v}@1`, factId: `${t.code}-f${f}`, topic: t.code, b: (f - 2.5) / 2 });
  return items;
}

const bank = new Bank(bp, makeItems());
const MIN = 60_000;
const DAY = 86_400_000;

describe("blueprint", () => {
  it("adds up to 83 scored items and pass score 59", () => {
    expect(bp.sections.reduce((s, x) => s + x.items, 0)).toBe(83);
    expect(bank.passScore).toBe(59);
    const total = [...bank.topicWeight.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("rejects items whose topic is not in the blueprint", () => {
    expect(() => new Bank(bp, [{ key: "x@1", factId: "x", topic: "IX.9", b: 0 }])).toThrow();
  });
});

describe("ability model", () => {
  it("correct answers raise ability and shrink uncertainty", () => {
    const g = { mean: 0, var: 1 };
    const d = { mean: 0, var: 0.25 };
    const up = updateAbility(g, d, 0, true, 0.25);
    const down = updateAbility(g, d, 0, false, 0.25);
    expect(up.g.mean).toBeGreaterThan(0);
    expect(down.g.mean).toBeLessThan(0);
    expect(up.g.var).toBeLessThan(1);
    expect(up.d.var).toBeLessThan(0.25);
  });

  it("credits general ability more than the topic when general is more uncertain", () => {
    const r = updateAbility({ mean: 0, var: 1 }, { mean: 0, var: 0.25 }, 0, true, 0.25);
    expect(r.g.mean).toBeGreaterThan(r.d.mean);
  });

  it("respects the guessing floor", () => {
    expect(pCorrect(-20, 0, 0.25)).toBeCloseTo(0.25, 5);
    expect(pCorrect(20, 0, 0.25)).toBeCloseTo(1, 5);
  });
});

describe("FSRS memory", () => {
  it("retrievability is 0.9 after one stability interval", () => {
    expect(fsrs.retrievability(10, 10)).toBeCloseTo(0.9, 3);
    expect(fsrs.intervalDays(10, 0.9)).toBeCloseTo(10, 3);
  });

  it("success grows stability, failure shrinks it", () => {
    const m = fsrs.firstReview(3, 0);
    const good = fsrs.review(m, 3, 3 * DAY);
    const again = fsrs.review(good, 1, 10 * DAY);
    expect(good.stability).toBeGreaterThan(m.stability);
    expect(again.stability).toBeLessThan(good.stability);
    expect(again.lapses).toBe(1);
  });

  it("same day repeats do not change stability", () => {
    const m = fsrs.firstReview(3, 0);
    expect(fsrs.review(m, 3, 5 * MIN).stability).toBe(m.stability);
  });
});

describe("event log replay", () => {
  const events: AnswerEvent[] = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    itemKey: [...bank.items.keys()][(i * 7) % bank.items.size]!,
    correct: i % 3 !== 0,
    at: i * MIN,
  }));

  it("is deterministic and order independent on input", () => {
    const a = replay(events, bank);
    const b = replay([...events].reverse(), bank);
    expect(b).toEqual(a);
  });

  it("refuses out of order application", () => {
    const s = applyAnswer(initState(bank), bank, events[5]!);
    expect(() => applyAnswer(s, bank, events[2]!)).toThrow();
  });

  it("skips events for items no longer in the bank without corrupting state", () => {
    const s = replay([{ id: 1, itemKey: "retired@1", correct: true, at: 0 }, ...events.slice(1)], bank);
    expect(s.skipped).toBe(1);
    expect(s.answers).toBe(events.length - 1);
  });
});

describe("scheduler", () => {
  function session(n: number, correct: (i: number) => boolean, mode: "practice" | "diagnostic" = "practice") {
    let s = initState(bank);
    const picks = [];
    for (let i = 0; i < n; i++) {
      const p = nextItem(s, bank, mode, i * MIN, undefined, "u1")!;
      picks.push(p);
      s = applyAnswer(s, bank, { id: i + 1, itemKey: p.item.key, correct: correct(i), at: i * MIN });
    }
    return { s, picks };
  }

  it("never repeats an item inside the recent window", () => {
    const { picks } = session(120, (i) => i % 2 === 0);
    for (let i = 0; i < picks.length; i++) {
      const window = picks.slice(Math.max(0, i - 25), i).map((p) => p.item.key);
      expect(window).not.toContain(picks[i]!.item.key);
    }
  });

  it("brings back a missed fact after the relearn gap, not before", () => {
    const { picks } = session(60, (i) => i !== 0);
    const missed = picks[0]!.factId;
    const back = picks.findIndex((p, i) => i > 0 && p.factId === missed);
    expect(back).toBeGreaterThanOrEqual(8);
    expect(picks[back]!.reason).toBe("relearn");
  });

  it("covers many facts instead of drilling one topic", () => {
    const { picks } = session(100, () => false);
    const topics = new Set(picks.map((p) => p.topic));
    expect(topics.size).toBeGreaterThanOrEqual(8);
  });

  it("serves due reviews once memory decays", () => {
    const { s } = session(30, () => true);
    const later = nextItem(s, bank, "review", s.lastAt + 30 * DAY, undefined, "u1");
    expect(later?.reason).toBe("due_review");
  });

  it("is reproducible for the same learner and state", () => {
    const s = initState(bank);
    expect(nextItem(s, bank, "practice", 0, undefined, "u1")).toEqual(nextItem(s, bank, "practice", 0, undefined, "u1"));
  });
});

describe("readiness", () => {
  it("is deterministic for the same state", () => {
    const s = initState(bank);
    expect(readiness(s, bank, { draws: 500 })).toEqual(readiness(s, bank, { draws: 500 }));
  });

  it("rises with correct answers and falls with misses", () => {
    let hi = initState(bank);
    let lo = initState(bank);
    const keys = [...bank.items.keys()];
    for (let i = 0; i < 60; i++) {
      hi = applyAnswer(hi, bank, { id: i + 1, itemKey: keys[i * 5]!, correct: true, at: i * MIN });
      lo = applyAnswer(lo, bank, { id: i + 1, itemKey: keys[i * 5]!, correct: false, at: i * MIN });
    }
    expect(readiness(hi, bank, { draws: 800 }).pPass).toBeGreaterThan(0.9);
    expect(readiness(lo, bank, { draws: 800 }).pPass).toBeLessThan(0.05);
  });

  it("penalises a far exam date through memory decay", () => {
    let s = initState(bank);
    const keys = [...bank.items.keys()];
    for (let i = 0; i < 120; i++) s = applyAnswer(s, bank, { id: i + 1, itemKey: keys[i]!, correct: true, at: i * MIN });
    const now = readiness(s, bank, { draws: 800, seed: 1 });
    const later = readiness(s, bank, { draws: 800, seed: 1, examAt: s.lastAt + 60 * DAY });
    expect(later.expectedScore).toBeLessThan(now.expectedScore);
    expect(later.decayPenalty).toBeGreaterThan(0);
  });
});

describe("mock exam", () => {
  it("matches the blueprint exactly with no repeated item", () => {
    const form = mockForm(bank, 7);
    expect(form.length).toBe(83);
    expect(new Set(form.map((i) => i.key)).size).toBe(83);
    for (const sec of bp.sections) {
      const codes = new Set(sec.topics.map((t) => t.code));
      expect(form.filter((i) => codes.has(i.topic)).length).toBe(sec.items);
    }
  });

  it("uses one item per fact when the bank is deep enough", () => {
    const deep = new Bank(
      bp,
      makeItems().flatMap((i) => [i, { ...i, key: i.key.replace("@1", "x@1"), factId: i.factId + "x" }]),
    );
    const form = mockForm(deep, 7);
    expect(new Set(form.map((i) => i.factId)).size).toBe(83);
  });

  it("never puts two items from the same enemy group on one form", () => {
    const grouped = new Bank(
      bp,
      makeItems().flatMap((i) => [i, { ...i, key: i.key.replace("@1", "x@1"), factId: i.factId + "x" }]).map((i, n) => ({ ...i, group: n % 4 === 0 ? `g${Math.floor(n / 8)}` : undefined })),
    );
    for (let seed = 1; seed <= 20; seed++) {
      const groups = mockForm(grouped, seed).map((i) => i.group).filter(Boolean);
      expect(new Set(groups).size).toBe(groups.length);
    }
  });

  it("refuses to build a short mock", () => {
    const thin = new Bank(bp, makeItems().filter((i) => !i.topic.startsWith("II.")));
    expect(() => mockForm(thin, 1)).toThrow(/section II/);
  });
});
