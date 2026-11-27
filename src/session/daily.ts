/**
 * The daily study session. Pure functions over the learner's event log and the
 * engine: no storage, no UI. The session never keeps its own copy of what the
 * learner knows; it reads the one learner state every other view reads.
 */
import { nextItem, type Pick } from "../engine/scheduler";
import { retrievabilityAt } from "../engine/fsrs";
import type { Bank } from "../engine/bank";
import { DEFAULT_CONFIG, type AnswerEvent, type LearnerState } from "../engine/types";

/** New facts introduced per day before the session switches to review only. */
export const NEW_PER_DAY = 12;
/** Hard cap on questions in one session, so a session can never loop forever. */
export const MAX_PER_SESSION = 60;

export interface SessionStart {
  /** learner.answers when the session began */
  startAnswers: number;
  startedAt: number;
}

export interface SessionProgress {
  answered: number;
  correct: number;
  newIntroduced: number;
  /** studied facts that are due (forgotten or missed) right now */
  dueRemaining: number;
  done: boolean;
  doneReason?: "cleared" | "cap";
}

/** Studied facts that need attention now: missed last time, or memory below target. */
export function dueFacts(state: LearnerState, bank: Bank, now: number): string[] {
  const out: string[] = [];
  for (const [factId, mem] of Object.entries(state.facts)) {
    if (!bank.factTopic.has(factId)) continue;
    if (mem.lastCorrect === false || retrievabilityAt(mem, now) < DEFAULT_CONFIG.targetRetention) out.push(factId);
  }
  return out.sort();
}

function sessionEvents(events: AnswerEvent[], start: SessionStart): AnswerEvent[] {
  return events.filter((e) => e.at >= start.startedAt);
}

/** Facts first answered during this session. */
function newFactsThisSession(events: AnswerEvent[], bank: Bank, start: SessionStart): number {
  const before = new Set<string>();
  const fresh = new Set<string>();
  for (const e of events) {
    const f = bank.items.get(e.itemKey)?.factId;
    if (!f) continue;
    if (e.at < start.startedAt) before.add(f);
    else if (!before.has(f)) fresh.add(f);
  }
  return fresh.size;
}

export function progress(
  state: LearnerState,
  bank: Bank,
  events: AnswerEvent[],
  start: SessionStart,
  now: number,
  seedKey = "",
  newPerDay = NEW_PER_DAY,
): SessionProgress {
  const mine = sessionEvents(events, start);
  const answered = mine.length;
  const correct = mine.filter((e) => e.correct).length;
  const newIntroduced = newFactsThisSession(events, bank, start);
  const dueRemaining = dueFacts(state, bank, now).length;
  if (answered >= MAX_PER_SESSION) return { answered, correct, newIntroduced, dueRemaining, done: true, doneReason: "cap" };
  const pick = sessionPick(state, bank, events, start, now, seedKey, newPerDay);
  return { answered, correct, newIntroduced, dueRemaining, done: pick === null, doneReason: pick === null ? "cleared" : undefined };
}

/**
 * Next question for the session, or null when today's work is cleared.
 * Uses the engine scheduler; only the new-material quota is a session rule.
 */
export function sessionPick(
  state: LearnerState,
  bank: Bank,
  events: AnswerEvent[],
  start: SessionStart,
  now: number,
  seedKey = "",
  /** today's new-fact quota; the study plan sets it from the exam date */
  newPerDay = NEW_PER_DAY,
): Pick | null {
  if (sessionEvents(events, start).length >= MAX_PER_SESSION) return null;
  const quotaLeft = newFactsThisSession(events, bank, start) < newPerDay;
  if (quotaLeft) {
    const p = nextItem(state, bank, "practice", now, DEFAULT_CONFIG, seedKey);
    // Extra practice means nothing is due and nothing new is worth more: the day is cleared.
    if (p && p.reason !== "extra_practice") return p;
    return null;
  }
  const review = nextItem(state, bank, "review", now, DEFAULT_CONFIG, seedKey);
  if (review) return review;
  return missedFallback(state, bank);
}

/**
 * Once the new quota is spent, a missed fact can be stuck behind the relearn gap
 * (counted in answers) with nothing else left to answer. Successive relearning
 * means the day is not cleared until each miss is retrieved once, so serve it,
 * keeping only a small buffer from the learner's last answers.
 */
const FALLBACK_BUFFER = 2;
function missedFallback(state: LearnerState, bank: Bank): Pick | null {
  const lastFacts = new Set(state.recent.slice(-FALLBACK_BUFFER).map((k) => bank.items.get(k)?.factId));
  const missed = Object.entries(state.facts)
    .filter(([f, m]) => m.lastCorrect === false && bank.factTopic.has(f) && !lastFacts.has(f))
    .sort((a, b) => (a[1].lastAnswerNo ?? 0) - (b[1].lastAnswerNo ?? 0));
  for (const [factId] of missed) {
    const items = [...(bank.byFact.get(factId) ?? [])].sort(
      (a, b) => (state.lastSeen[a.key] ?? -1) - (state.lastSeen[b.key] ?? -1),
    );
    const item = items[0];
    if (item) return { item, reason: "relearn", topic: item.topic, factId, value: 0 };
  }
  return null;
}

/** Confidence versus correctness, for the calibration grid. */
export interface Calibration {
  sureRight: number;
  sureWrong: number;
  guessRight: number;
  guessWrong: number;
}

export function calibration(events: AnswerEvent[]): Calibration {
  const c: Calibration = { sureRight: 0, sureWrong: 0, guessRight: 0, guessWrong: 0 };
  for (const e of events) {
    if (!e.confidence) continue;
    if (e.confidence === "sure") e.correct ? c.sureRight++ : c.sureWrong++;
    else e.correct ? c.guessRight++ : c.guessWrong++;
  }
  return c;
}
