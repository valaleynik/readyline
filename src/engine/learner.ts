import type { Bank } from "./bank";
import { firstReview, review } from "./fsrs";
import { updateAbility } from "./irt";
import {
  DEFAULT_CONFIG,
  ENGINE_VERSION,
  type AnswerEvent,
  type EngineConfig,
  type LearnerState,
  type TopicAbility,
} from "./types";

export function initState(bank: Bank, config: EngineConfig = DEFAULT_CONFIG): LearnerState {
  const topics: Record<string, TopicAbility> = {};
  for (const t of bank.topics()) topics[t] = { ...config.topicPrior, n: 0, correct: 0 };
  return {
    engineVersion: ENGINE_VERSION,
    g: { ...config.gPrior },
    topics,
    facts: {},
    lastSeen: {},
    recent: [],
    answers: 0,
    lastEventId: 0,
    lastAt: 0,
    skipped: 0,
  };
}

/** Apply one answer. Returns a new state; the input is not mutated. */
export function applyAnswer(
  state: LearnerState,
  bank: Bank,
  ev: AnswerEvent,
  config: EngineConfig = DEFAULT_CONFIG,
): LearnerState {
  if (ev.id <= state.lastEventId) {
    throw new Error(`events must be applied in order: got ${ev.id} after ${state.lastEventId}`);
  }
  const item = bank.items.get(ev.itemKey);
  if (!item) return { ...state, lastEventId: ev.id, skipped: state.skipped + 1 };

  const topic = state.topics[item.topic]!;
  const upd = updateAbility(state.g, topic, item.b, ev.correct, bank.guess);

  const grade = ev.correct ? 3 : 1;
  const prev = state.facts[item.factId];
  const mem = {
    ...(prev ? review(prev, grade, ev.at) : firstReview(grade, ev.at)),
    lastCorrect: ev.correct,
    lastAnswerNo: state.answers + 1,
  };

  const recent = [...state.recent, item.key];
  if (recent.length > config.recentWindow) recent.splice(0, recent.length - config.recentWindow);

  return {
    ...state,
    g: upd.g,
    topics: {
      ...state.topics,
      [item.topic]: {
        mean: upd.d.mean,
        var: upd.d.var,
        n: topic.n + 1,
        correct: topic.correct + (ev.correct ? 1 : 0),
      },
    },
    facts: { ...state.facts, [item.factId]: mem },
    lastSeen: { ...state.lastSeen, [item.key]: ev.at },
    recent,
    answers: state.answers + 1,
    lastEventId: ev.id,
    lastAt: ev.at,
  };
}

/** Rebuild learner state from the full event log. The log is the only truth. */
export function replay(events: AnswerEvent[], bank: Bank, config: EngineConfig = DEFAULT_CONFIG): LearnerState {
  const sorted = [...events].sort((a, b) => a.id - b.id);
  let s = initState(bank, config);
  for (const ev of sorted) s = applyAnswer(s, bank, ev, config);
  return s;
}

/** Current ability estimate for a topic (mean and variance of g + d). */
export function topicTheta(state: LearnerState, topic: string): { mean: number; var: number } {
  const d = state.topics[topic]!;
  return { mean: state.g.mean + d.mean, var: state.g.var + d.var };
}
