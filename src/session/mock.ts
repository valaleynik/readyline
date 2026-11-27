/**
 * Mock exam: a full rehearsal of the real test. 83 questions in the exam's section mix,
 * 210 minutes, no feedback until it is submitted.
 *
 * Nothing about the form is stored. A mock is { id, startedAt, seed } plus draft answers;
 * the 83 questions are rebuilt from the answers logged before it started, so every device
 * sees the same form. Draft answers live in settings (they can change until submit). On
 * submit they become ordinary answer events tagged "mock", which feed the model like any
 * other answer.
 */
import type { Bank } from "../engine/bank";
import { applyAnswer, initState } from "../engine/learner";
import { readiness } from "../engine/readiness";
import { mockForm } from "../engine/scheduler";
import { hashSeed } from "../engine/rng";
import type { AnswerEvent, ItemMeta, LearnerState } from "../engine/types";
import type { ResultSettings } from "./results";
import { studyPlan } from "./plan";

const DAY = 86_400_000;

export interface MockRecord {
  id: string;
  startedAt: number;
  seed: number;
  /** item key -> chosen option, editable until submit */
  answers: Record<string, number>;
  flagged?: string[];
  submittedAt?: number;
}

export interface MockSettings extends ResultSettings {
  mocks?: MockRecord[];
}

/** Share of a form that may repeat earlier questions before the score gets a warning. */
export const OVERLAP_WARN = 0.15;

function stateBefore(bank: Bank, events: AnswerEvent[], t: number): LearnerState {
  return [...events]
    .filter((e) => e.at < t)
    .sort((a, b) => a.id - b.id)
    .reduce((s, e) => applyAnswer(s, bank, e), initState(bank));
}

/**
 * The form for a mock: the exam's section mix, preferring questions the learner has never
 * seen, then questions on facts they have not met, then the ones seen longest ago.
 */
export function mockItems(bank: Bank, events: AnswerEvent[], mock: Pick<MockRecord, "startedAt" | "seed">): ItemMeta[] {
  const st = stateBefore(bank, events, mock.startedAt);
  const cost = (x: ItemMeta) => {
    const seen = st.lastSeen[x.key];
    if (seen !== undefined) return 2 + seen / 1e15; // older first
    return st.facts[x.factId] ? 1 : 0;
  };
  return mockForm(bank, mock.seed, 50, cost);
}

export const mockDeadline = (bank: Bank, m: MockRecord) => m.startedAt + bank.blueprint.timeMinutes * 60_000;

export function activeMock(settings: MockSettings): MockRecord | null {
  return (settings.mocks ?? []).find((m) => !m.submittedAt) ?? null;
}

export function startMock(settings: MockSettings, now: number, id: string): MockSettings {
  if (activeMock(settings)) return settings;
  const mock: MockRecord = { id, startedAt: now, seed: hashSeed(id), answers: {} };
  return { ...settings, mocks: [...(settings.mocks ?? []), mock] };
}

export function updateMock(settings: MockSettings, id: string, f: (m: MockRecord) => MockRecord): MockSettings {
  return { ...settings, mocks: (settings.mocks ?? []).map((m) => (m.id === id && !m.submittedAt ? f(m) : m)) };
}

/**
 * Submit (by the learner, or by the clock once time is up). Answered questions become
 * events in form order; unanswered ones are not logged (the learner never committed to
 * an answer) but count as wrong in the score, as on the real exam.
 */
export function submitMock(
  bank: Bank,
  events: AnswerEvent[],
  settings: MockSettings,
  id: string,
  now: number,
  answerKey: (key: string) => number,
): { settings: MockSettings; newEvents: AnswerEvent[] } {
  const m = (settings.mocks ?? []).find((x) => x.id === id);
  if (!m || m.submittedAt) return { settings, newEvents: [] };
  const at = Math.min(now, mockDeadline(bank, m));
  const form = mockItems(bank, events, m);
  const lastId = events.reduce((a, e) => Math.max(a, e.id), 0);
  const lastAt = events.reduce((a, e) => Math.max(a, e.at), 0);
  const base = Math.max(at, lastAt + 1);
  const newEvents: AnswerEvent[] = form
    .filter((it) => m.answers[it.key] !== undefined)
    .map((it, i) => ({
      id: lastId + i + 1,
      itemKey: it.key,
      correct: m.answers[it.key] === answerKey(it.key),
      at: base + i,
      context: "mock" as const,
    }));
  return { settings: updateMock(settings, id, (x) => ({ ...x, submittedAt: at })), newEvents };
}

export interface MockResult {
  answered: number;
  correct: number;
  total: number;
  passScore: number;
  passed: boolean;
  /** rough 80% range for the learner's true score, from one form's worth of luck */
  range: [number, number];
  sections: { code: string; name: string; asked: number; correct: number }[];
  /** form questions the learner had answered before this mock */
  repeats: number;
  /** what the model expected on a full exam just before the mock */
  expectedBefore: number;
  missed: string[];
  unanswered: string[];
  minutes: number;
}

export function mockResult(bank: Bank, events: AnswerEvent[], m: MockRecord, answerKey: (key: string) => number): MockResult {
  const form = mockItems(bank, events, m);
  const before = stateBefore(bank, events, m.startedAt);
  const total = form.length;
  const right = (it: ItemMeta) => m.answers[it.key] === answerKey(it.key);
  const correct = form.filter(right).length;
  const p = correct / total;
  const half = 1.2816 * Math.sqrt((p * (1 - p)) / total) * total;
  const sections = bank.blueprint.sections.map((s) => {
    const codes = new Set(s.topics.map((t) => t.code));
    const here = form.filter((it) => codes.has(it.topic));
    return { code: s.code, name: s.name, asked: here.length, correct: here.filter(right).length };
  });
  return {
    answered: form.filter((it) => m.answers[it.key] !== undefined).length,
    correct,
    total,
    passScore: bank.passScore,
    passed: correct >= bank.passScore,
    range: [Math.max(0, Math.round(correct - half)), Math.min(total, Math.round(correct + half))],
    sections,
    repeats: form.filter((it) => before.lastSeen[it.key] !== undefined).length,
    expectedBefore: before.answers ? readiness(before, bank, { draws: 2000, seed: 1 }).expectedScore : NaN,
    missed: form.filter((it) => m.answers[it.key] !== undefined && !right(it)).map((it) => it.key),
    unanswered: form.filter((it) => m.answers[it.key] === undefined).map((it) => it.key),
    minutes: Math.round(((m.submittedAt ?? m.startedAt) - m.startedAt) / 60_000),
  };
}

/**
 * When to suggest a mock (it is always available). Once enough is studied to make a
 * score meaningful, then again a few days before the exam. Never as a substitute for
 * the daily session, never more than once in 3 days.
 */
export function mockAdvice(
  state: LearnerState,
  bank: Bank,
  settings: MockSettings,
  now: number,
): "first" | "final" | null {
  const done = (settings.mocks ?? []).filter((m) => m.submittedAt);
  if (activeMock(settings)) return null;
  if (done.some((m) => now - m.submittedAt! < 3 * DAY)) return null;
  const plan = studyPlan(state, bank, settings, now);
  if (plan.hasDate && plan.daysLeft !== null && plan.daysLeft >= 2 && plan.daysLeft <= 5) return "final";
  if (done.length === 0 && plan.factsSeen >= 0.4 * plan.factsTotal) return "first";
  return null;
}
