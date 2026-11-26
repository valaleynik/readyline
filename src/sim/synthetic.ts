import { Bank } from "../engine/bank";
import { sigmoid } from "../engine/irt";
import type { Rng } from "../engine/rng";
import type { Blueprint, ItemMeta } from "../engine/types";

/** A synthetic item: what the engine sees (meta) plus hidden truth. */
export interface SimItem {
  meta: ItemMeta;
  trueB: number;
  miskeyed: boolean;
}

export interface SimLearner {
  id: string;
  g: number;
  d: Map<string, number>;
}

export function buildBank(
  bp: Blueprint,
  rng: Rng,
  opts = { factsPerTopic: 10, itemsPerFact: 3, priorNoise: 0.6, miskeyRate: 0.03 },
): SimItem[] {
  const out: SimItem[] = [];
  for (const sec of bp.sections) {
    for (const t of sec.topics) {
      for (let f = 0; f < opts.factsPerTopic; f++) {
        const factId = `${t.code}-f${f}`;
        const factB = rng.normal();
        for (let v = 0; v < opts.itemsPerFact; v++) {
          const trueB = factB + 0.2 * rng.normal();
          out.push({
            meta: {
              key: `${factId}-i${v}@1`,
              factId,
              topic: t.code,
              b: trueB + opts.priorNoise * rng.normal(),
            },
            trueB,
            miskeyed: rng.next() < opts.miskeyRate,
          });
        }
      }
    }
  }
  return out;
}

export function makeLearner(id: string, bank: Bank, rng: Rng): SimLearner {
  const d = new Map<string, number>();
  for (const t of bank.topics()) d.set(t, 0.45 * rng.normal());
  return { id, g: 0.2 + 0.9 * rng.normal(), d };
}

/** Probability the learner's answer is graded correct against the stored key. */
export function trueP(l: SimLearner, item: SimItem, c: number): number {
  const s = sigmoid(l.g + l.d.get(item.meta.topic)! - item.trueB);
  if (item.miskeyed) return (1 - s) * c; // knowing the real answer gets marked wrong
  return c + (1 - c) * s;
}

/** True blueprint-weighted ability, for checking ability recovery. */
export function trueWeightedTheta(l: SimLearner, bank: Bank): number {
  let s = 0;
  for (const [t, w] of bank.topicWeight) s += w * (l.g + l.d.get(t)!);
  return s;
}

/** Simulate the real exam: fresh items drawn from the same difficulty distribution. */
export function takeRealExam(l: SimLearner, bank: Bank, rng: Rng): number {
  let score = 0;
  for (const sec of bank.blueprint.sections) {
    for (let i = 0; i < sec.items; i++) {
      const topic = sec.topics[rng.int(sec.topics.length)]!.code;
      const b = rng.normal();
      const p = bank.guess + (1 - bank.guess) * sigmoid(l.g + l.d.get(topic)! - b);
      if (rng.next() < p) score++;
    }
  }
  return score;
}
