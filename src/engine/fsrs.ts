import type { FactMemory } from "./types";

/** FSRS 4.5 default parameters. */
export const W = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072,
  0.0793, 0.3246, 1.587, 0.2272, 2.8755,
] as const;

const w = (i: number) => W[i] as number;
const DECAY = -0.5;
const FACTOR = 19 / 81;
const DAY = 86_400_000;

export type Grade = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

const clampD = (d: number) => Math.min(10, Math.max(1, d));

export function retrievability(elapsedDays: number, stability: number): number {
  if (elapsedDays <= 0) return 1;
  return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);
}

export function retrievabilityAt(m: FactMemory, at: number): number {
  return retrievability((at - m.lastReview) / DAY, m.stability);
}

/** Days until retrievability falls to the target. */
export function intervalDays(stability: number, target: number): number {
  return (stability / FACTOR) * (Math.pow(target, 1 / DECAY) - 1);
}

const initDifficulty = (g: Grade) => clampD(w(4) - (g - 3) * w(5));

export function firstReview(grade: Grade, at: number): FactMemory {
  return {
    stability: w(grade - 1),
    difficulty: initDifficulty(grade),
    lastReview: at,
    reps: 1,
    lapses: grade === 1 ? 1 : 0,
  };
}

export function review(m: FactMemory, grade: Grade, at: number): FactMemory {
  const elapsed = (at - m.lastReview) / DAY;
  // Same-day repeats do not change long-term memory in FSRS 4.5.
  if (elapsed < 0.5) {
    return { ...m, reps: m.reps + 1, lapses: m.lapses + (grade === 1 ? 1 : 0) };
  }
  const r = retrievability(elapsed, m.stability);
  const d = m.difficulty;

  let stability: number;
  if (grade === 1) {
    stability =
      w(11) * Math.pow(d, -w(12)) * (Math.pow(m.stability + 1, w(13)) - 1) * Math.exp(w(14) * (1 - r));
    stability = Math.min(stability, m.stability);
  } else {
    const hard = grade === 2 ? w(15) : 1;
    const easy = grade === 4 ? w(16) : 1;
    stability =
      m.stability *
      (1 + Math.exp(w(8)) * (11 - d) * Math.pow(m.stability, -w(9)) * (Math.exp(w(10) * (1 - r)) - 1) * hard * easy);
  }

  const dNext = d - w(6) * (grade - 3);
  const difficulty = clampD(w(7) * initDifficulty(4) + (1 - w(7)) * dNext);

  return {
    stability: Math.max(0.01, stability),
    difficulty,
    lastReview: at,
    reps: m.reps + 1,
    lapses: m.lapses + (grade === 1 ? 1 : 0),
  };
}
