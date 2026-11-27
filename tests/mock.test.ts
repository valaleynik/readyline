import { describe, expect, it } from "vitest";
import bankJson from "../web/data/bank.json";
import type { ExportedBank } from "../src/content/export";
import { Bank, applyAnswer, initState, type AnswerEvent } from "../src/engine";
import { sessionPick } from "../src/session/daily";
import {
  OVERLAP_WARN,
  activeMock,
  mockAdvice,
  mockDeadline,
  mockItems,
  mockResult,
  startMock,
  submitMock,
  updateMock,
  type MockSettings,
} from "../src/session/mock";

const data = bankJson as unknown as ExportedBank;
const bank = new Bank(data.blueprint, data.items);
const key = new Map(data.items.map((i) => [i.key, i.answer]));
const answerKey = (k: string) => key.get(k)!;
const D = 86_400_000;
const t0 = new Date(2026, 10, 1, 9).getTime();

function study(days: number) {
  let st = initState(bank);
  const events: AnswerEvent[] = [];
  for (let d = 0; d < days; d++) {
    const day = t0 + d * D;
    const start = { startAnswers: st.answers, startedAt: day };
    for (let i = 0; i < 60; i++) {
      const at = day + i * 30_000;
      const p = sessionPick(st, bank, events, start, at, "m");
      if (!p) break;
      const ev: AnswerEvent = { id: events.length + 1, itemKey: p.item.key, correct: i % 3 !== 0, at, context: "session" };
      events.push(ev);
      st = applyAnswer(st, bank, ev);
    }
  }
  return { st, events, now: t0 + days * D };
}

describe("mock exam", () => {
  it("builds a full exam-shaped form, the same on every device", () => {
    const { events, now } = study(3);
    const s = startMock({}, now, "mock-1");
    const m = activeMock(s)!;
    const form = mockItems(bank, events, m);
    expect(form.length).toBe(bank.blueprint.scoredItems);
    for (const sec of bank.blueprint.sections) {
      const codes = new Set(sec.topics.map((t) => t.code));
      expect(form.filter((i) => codes.has(i.topic)).length).toBe(sec.items);
    }
    expect(new Set(form.map((i) => i.factId)).size).toBe(form.length);
    // answers logged after the start don't change the form
    const later = [...events, { id: events.length + 1, itemKey: form[0]!.key, correct: true, at: now + 1000 }];
    expect(mockItems(bank, later, m).map((i) => i.key)).toEqual(form.map((i) => i.key));
    expect(mockDeadline(bank, m)).toBe(now + 210 * 60_000);
  });

  it("prefers questions the learner has not seen", () => {
    const { st, events, now } = study(3);
    const form = mockItems(bank, events, { startedAt: now, seed: 1 });
    const seen = form.filter((i) => st.lastSeen[i.key] !== undefined).length;
    const unseenAvailable = data.items.filter((i) => st.lastSeen[i.key] === undefined).length;
    expect(unseenAvailable).toBeGreaterThan(form.length);
    expect(seen).toBe(0);
  });

  it("submits drafts as mock events, scores unanswered as wrong, and reports by section", () => {
    const { events, now } = study(2);
    let s: MockSettings = startMock({ examAt: now + 20 * D }, now, "m1");
    const m = activeMock(s)!;
    const form = mockItems(bank, events, m);
    // answer all but the last 3: first 50 right, rest wrong
    form.slice(0, -3).forEach((it, i) => {
      s = updateMock(s, m.id, (x) => ({ ...x, answers: { ...x.answers, [it.key]: i < 50 ? answerKey(it.key) : (answerKey(it.key) + 1) % 4 } }));
    });
    const { settings, newEvents } = submitMock(bank, events, s, m.id, now + 90 * 60_000, answerKey);
    expect(newEvents.length).toBe(form.length - 3);
    expect(newEvents.every((e) => e.context === "mock")).toBe(true);
    expect(newEvents[0]!.id).toBe(events.length + 1);
    expect(newEvents.filter((e) => e.correct).length).toBe(50);
    expect(activeMock(settings)).toBeNull();
    const done = settings.mocks![0]!;
    const r = mockResult(bank, [...events, ...newEvents], done, answerKey);
    expect(r.correct).toBe(50);
    expect(r.total).toBe(83);
    expect(r.unanswered.length).toBe(3);
    expect(r.missed.length).toBe(30);
    expect(r.passed).toBe(false);
    expect(r.minutes).toBe(90);
    expect(r.range[0]).toBeLessThan(50);
    expect(r.range[1]).toBeGreaterThan(50);
    expect(r.sections.reduce((a, x) => a + x.asked, 0)).toBe(83);
    // submitting twice does nothing
    expect(submitMock(bank, [...events, ...newEvents], settings, m.id, now + D, answerKey).newEvents).toEqual([]);
  });

  it("time runs out: submission is stamped at the deadline", () => {
    const { events, now } = study(1);
    const s = startMock({}, now, "m2");
    const m = activeMock(s)!;
    const { settings } = submitMock(bank, events, s, m.id, now + 5 * 3_600_000, answerKey);
    expect(settings.mocks![0]!.submittedAt).toBe(mockDeadline(bank, m));
  });

  it("a second mock right after the first avoids its questions, and repeats are counted", () => {
    const { events, now } = study(2);
    let s = startMock({}, now, "a");
    const a = activeMock(s)!;
    const formA = mockItems(bank, events, a);
    for (const it of formA) s = updateMock(s, a.id, (x) => ({ ...x, answers: { ...x.answers, [it.key]: answerKey(it.key) } }));
    const sub = submitMock(bank, events, s, a.id, now + 3_600_000, answerKey);
    const all = [...events, ...sub.newEvents];
    const s2 = startMock(sub.settings, now + 2 * 3_600_000, "b");
    const b = activeMock(s2)!;
    const formB = mockItems(bank, all, b);
    const overlap = formB.filter((i) => formA.some((x) => x.key === i.key)).length;
    expect(overlap).toBe(0);
    const rB = mockResult(bank, all, b, answerKey);
    expect(rB.repeats / rB.total).toBeLessThan(1);
    expect(OVERLAP_WARN).toBeGreaterThan(0);
  });

  it("suggests a mock once enough is studied and again a few days out, not right after one", () => {
    const fresh = initState(bank);
    expect(mockAdvice(fresh, bank, {}, t0)).toBeNull();
    const { st, now } = study(14);
    expect(mockAdvice(st, bank, {}, now)).toBe("first");
    expect(mockAdvice(st, bank, { examAt: now + 4 * D }, now)).toBe("final");
    const recent: MockSettings = { examAt: now + 4 * D, mocks: [{ id: "x", startedAt: now - D, seed: 1, answers: {}, submittedAt: now - D }] };
    expect(mockAdvice(st, bank, recent, now)).toBeNull();
  });
});
