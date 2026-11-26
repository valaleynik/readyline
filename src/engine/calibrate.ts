import { Bank } from "./bank";
import { pCorrect, sigmoid } from "./irt";
import { replay, topicTheta } from "./learner";
import type { AnswerEvent, ItemMeta } from "./types";

export interface ItemStat {
  key: string;
  n: number;
  pCorrect: number;
  b: number;
  pointBiserial: number;
  /** accuracy among the strongest third of learners who saw the item */
  topThirdAccuracy: number;
  /** log-likelihood ratio, miskeyed model vs correctly keyed model */
  llr: number;
  flag: null | "negative_discrimination" | "suspect_key";
}

export interface CalibrationResult {
  items: ItemMeta[];
  stats: ItemStat[];
}

/** log-likelihood ratio needed to call a key suspect (about 150:1 odds) */
const LLR_THRESHOLD = 5;

const B_GRID = Array.from({ length: 41 }, (_, i) => -5 + i * 0.25);

function bestLogLik(rs: { theta: number; y: number }[], p: (theta: number, b: number) => number): number {
  let best = -Infinity;
  for (const b of B_GRID) {
    let ll = 0;
    for (const r of rs) {
      const q = Math.min(1 - 1e-6, Math.max(1e-6, p(r.theta, b)));
      ll += r.y ? Math.log(q) : Math.log(1 - q);
    }
    if (ll > best) best = ll;
  }
  return best;
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/**
 * Re-estimate item difficulty from all learners' responses, then flag bad items.
 * Alternates: learner abilities from replay, then a MAP Newton step per item with
 * the generator estimate as prior. Item b values are never edited by hand.
 */
export function calibrateItems(
  bank: Bank,
  eventsByUser: Map<string, AnswerEvent[]>,
  opts: { iterations?: number; priorVar?: number; minN?: number } = {},
): CalibrationResult {
  const iterations = opts.iterations ?? 4;
  const priorVar = opts.priorVar ?? 0.5;
  const minN = opts.minN ?? 30;
  const c = bank.guess;
  const prior = new Map([...bank.items.values()].map((i) => [i.key, i.b]));
  let current = bank;

  let responses = new Map<string, { theta: number; g: number; y: number }[]>();

  for (let it = 0; it < iterations; it++) {
    responses = new Map();
    for (const events of eventsByUser.values()) {
      const s = replay(events, current);
      for (const ev of events) {
        const item = current.items.get(ev.itemKey);
        if (!item) continue;
        const th = topicTheta(s, item.topic).mean;
        const list = responses.get(item.key) ?? [];
        list.push({ theta: th, g: s.g.mean, y: ev.correct ? 1 : 0 });
        responses.set(item.key, list);
      }
    }

    const next: ItemMeta[] = [];
    for (const item of current.items.values()) {
      const rs = responses.get(item.key) ?? [];
      let b = item.b;
      const b0 = prior.get(item.key)!;
      for (let step = 0; step < 8; step++) {
        let grad = -(b - b0) / priorVar;
        let hess = -1 / priorVar;
        for (const r of rs) {
          const s = sigmoid(r.theta - b);
          const p = c + (1 - c) * s;
          const dpdb = -(1 - c) * s * (1 - s);
          grad += ((r.y - p) / (p * (1 - p))) * dpdb;
          hess -= (dpdb * dpdb) / (p * (1 - p));
        }
        const delta = -grad / hess;
        b = Math.max(-5, Math.min(5, b + delta));
        if (Math.abs(delta) < 1e-4) break;
      }
      next.push({ ...item, b });
    }
    current = new Bank(bank.blueprint, next);
  }

  const stats: ItemStat[] = [];
  for (const item of current.items.values()) {
    const rs = responses.get(item.key) ?? [];
    const n = rs.length;
    const p = n ? rs.reduce((s, r) => s + r.y, 0) / n : NaN;
    const pb = pearson(
      rs.map((r) => r.y),
      rs.map((r) => r.g),
    );
    const sorted = [...rs].sort((a, b) => b.g - a.g).slice(0, Math.max(1, Math.floor(n / 3)));
    const top = sorted.length ? sorted.reduce((s, r) => s + r.y, 0) / sorted.length : NaN;

    // Likelihood ratio: does "the stored key is wrong" explain the responses
    // better than "the item is just hard"? Under a wrong key, a learner who
    // knows the material picks the true answer and is marked wrong, so
    // P(marked correct) = c * (1 - sigmoid(theta - b)). Both models get their
    // best-fitting difficulty.
    const llKeyed = bestLogLik(rs, (th, b) => pCorrect(th, b, c));
    const llMiskey = bestLogLik(rs, (th, b) => c * (1 - sigmoid(th - b)));
    const llr = llMiskey - llKeyed;

    let flag: ItemStat["flag"] = null;
    if (n >= minN) {
      if (llr > LLR_THRESHOLD) flag = "suspect_key";
      else if (pb < -0.05) flag = "negative_discrimination";
    }
    stats.push({ key: item.key, n, pCorrect: p, b: item.b, pointBiserial: pb, topThirdAccuracy: top, llr, flag });
  }

  return { items: [...current.items.values()], stats };
}
