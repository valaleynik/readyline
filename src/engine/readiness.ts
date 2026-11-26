import type { Bank } from "./bank";
import { retrievabilityAt } from "./fsrs";
import { pCorrect, sigmoid } from "./irt";
import { createRng, hashSeed } from "./rng";
import type { LearnerState } from "./types";

export interface SectionReadiness {
  code: string;
  items: number;
  expectedAccuracy: number;
}

export interface Readiness {
  pPass: number;
  expectedScore: number;
  /** 10th and 90th percentile of the simulated score */
  scoreInterval: [number, number];
  passScore: number;
  scoredItems: number;
  sections: SectionReadiness[];
  /** how much memory decay before exam day reduces expected score */
  decayPenalty: number;
  draws: number;
}

export interface ReadinessOptions {
  /** epoch ms of the exam; defaults to the last answer (no decay) */
  examAt?: number;
  draws?: number;
  seed?: number;
}

/**
 * Share of knowledge in a topic that survives until exam day.
 * Facts the learner has studied decay by FSRS; unstudied facts are
 * represented only by ability and do not decay.
 */
function retention(state: LearnerState, bank: Bank, topic: string, examAt: number): number {
  const facts = bank.factsByTopic.get(topic) ?? [];
  if (facts.length === 0) return 1;
  let sum = 0;
  for (const f of facts) {
    const m = state.facts[f];
    if (!m) {
      sum += 1;
      continue;
    }
    const now = retrievabilityAt(m, state.lastAt);
    const later = retrievabilityAt(m, examAt);
    sum += now > 0 ? Math.min(1, later / now) : 1;
  }
  return sum / facts.length;
}

/** Monte Carlo simulation of the real exam from the learner's posterior. */
export function readiness(state: LearnerState, bank: Bank, opts: ReadinessOptions = {}): Readiness {
  const draws = opts.draws ?? 4000;
  const examAt = Math.max(opts.examAt ?? state.lastAt, state.lastAt);
  const rng = createRng(opts.seed ?? hashSeed(`${state.lastEventId}:${state.answers}`));
  const c = bank.guess;
  const topics = bank.topics();

  const keep = new Map(topics.map((t) => [t, retention(state, bank, t, examAt)]));
  const bs = new Map(
    topics.map((t) => [t, (bank.byTopic.get(t) ?? []).map((i) => i.b)]),
  );

  const sections = bank.blueprint.sections;
  const scores = new Int32Array(draws);
  const sectionHits = new Float64Array(sections.length);
  let passes = 0;
  let noDecayTotal = 0;

  for (let k = 0; k < draws; k++) {
    const g = state.g.mean + Math.sqrt(state.g.var) * rng.normal();
    const theta = new Map<string, number>();
    for (const t of topics) {
      const d = state.topics[t]!;
      theta.set(t, g + d.mean + Math.sqrt(d.var) * rng.normal());
    }

    let score = 0;
    sections.forEach((sec, si) => {
      for (let i = 0; i < sec.items; i++) {
        const topic = sec.topics[rng.int(sec.topics.length)]!.code;
        const pool = bs.get(topic)!;
        const b = pool.length > 0 ? pool[rng.int(pool.length)]! : rng.normal();
        const th = theta.get(topic)!;
        const known = sigmoid(th - b);
        const p = c + (1 - c) * known * keep.get(topic)!;
        noDecayTotal += pCorrect(th, b, c);
        if (rng.next() < p) {
          score++;
          sectionHits[si]! += 1;
        }
      }
    });
    scores[k] = score;
    if (score >= bank.passScore) passes++;
  }

  const sorted = Array.from(scores).sort((a, b) => a - b);
  const expectedScore = sorted.reduce((s, x) => s + x, 0) / draws;
  const q = (p: number) => sorted[Math.min(draws - 1, Math.floor(p * draws))]!;

  return {
    pPass: passes / draws,
    expectedScore,
    scoreInterval: [q(0.1), q(0.9)],
    passScore: bank.passScore,
    scoredItems: bank.blueprint.scoredItems,
    sections: sections.map((sec, si) => ({
      code: sec.code,
      items: sec.items,
      expectedAccuracy: sectionHits[si]! / (draws * sec.items),
    })),
    decayPenalty: noDecayTotal / draws - expectedScore,
    draws,
  };
}
