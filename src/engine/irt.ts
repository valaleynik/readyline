import type { Gaussian } from "./types";

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** P(correct) with a fixed guessing floor c = 1 / options. */
export function pCorrect(theta: number, b: number, c: number): number {
  return c + (1 - c) * sigmoid(theta - b);
}

/** Fisher information of one item at ability theta. */
export function information(theta: number, b: number, c: number): number {
  const s = sigmoid(theta - b);
  const p = c + (1 - c) * s;
  const dp = (1 - c) * s * (1 - s);
  return (dp * dp) / (p * (1 - p));
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Online Bayesian update of (general, topic offset) after one response.
 * theta = g + d. Uses an extended Kalman step on the logistic likelihood,
 * which splits credit between general ability and the topic offset in
 * proportion to how uncertain each one is.
 */
export function updateAbility(
  g: Gaussian,
  d: Gaussian,
  b: number,
  correct: boolean,
  c: number,
): { g: Gaussian; d: Gaussian } {
  const theta = g.mean + d.mean;
  const s = sigmoid(theta - b);
  const p = c + (1 - c) * s;
  const dp = (1 - c) * s * (1 - s);
  const y = correct ? 1 : 0;
  const grad = ((y - p) / (p * (1 - p))) * dp;
  const info = (dp * dp) / (p * (1 - p));
  if (info < 1e-9) return { g, d };

  const r = 1 / info;
  const innovation = grad / info;
  const denom = g.var + d.var + r;
  const kg = g.var / denom;
  const kd = d.var / denom;

  return {
    g: { mean: clamp(g.mean + kg * innovation, -6, 6), var: g.var * (1 - kg) },
    d: { mean: clamp(d.mean + kd * innovation, -6, 6), var: d.var * (1 - kd) },
  };
}
