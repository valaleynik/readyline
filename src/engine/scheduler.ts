import type { Bank } from "./bank";
import { retrievabilityAt } from "./fsrs";
import { information, pCorrect } from "./irt";
import { topicTheta } from "./learner";
import { createRng, hashSeed } from "./rng";
import { DEFAULT_CONFIG, type EngineConfig, type ItemMeta, type LearnerState } from "./types";

export type Mode = "diagnostic" | "practice" | "review";

export type PickReason = "diagnostic" | "new_material" | "relearn" | "due_review" | "extra_practice";

export interface Pick {
  item: ItemMeta;
  reason: PickReason;
  topic: string;
  factId: string;
  value: number;
}

/** Answers that must pass before a missed fact is asked again (short-term spacing). */
const RELEARN_GAP = 8;
/**
 * The no-repeat window only covers recent answers. A fact answered days ago is not
 * "recent" even if it is still in the last N answers, or a learner who returns after
 * a break would have their due reviews hidden.
 */
const RECENT_MS = 6 * 3_600_000;
/** Randomise among the K best items so the bank is used evenly across learners. */
const EXPOSURE_K = 5;

/**
 * Choose which item to show for a fact: an unseen wording first, otherwise the
 * one seen least recently. Never an item in the recent window.
 */
function itemForFact(state: LearnerState, bank: Bank, factId: string, exclude: Set<string>, rand: () => number) {
  const items = (bank.byFact.get(factId) ?? []).filter((i) => !exclude.has(i.key));
  if (!items.length) return null;
  const unseen = items.filter((i) => state.lastSeen[i.key] === undefined);
  if (unseen.length) return unseen[Math.floor(rand() * unseen.length)]!;
  return [...items].sort((a, b) => state.lastSeen[a.key]! - state.lastSeen[b.key]!)[0]!;
}

function topicAccuracy(state: LearnerState, bank: Bank, topic: string): number {
  const pool = bank.byTopic.get(topic) ?? [];
  const meanB = pool.length ? pool.reduce((s, i) => s + i.b, 0) / pool.length : 0;
  return pCorrect(topicTheta(state, topic).mean, meanB, bank.guess);
}

/** Diagnostic: spend each question where ability is most uncertain, weighted by exam share. */
function diagnosticPick(state: LearnerState, bank: Bank, exclude: Set<string>, rand: () => number): Pick | null {
  let best: { topic: string; value: number } | null = null;
  for (const t of bank.topics()) {
    const value = bank.topicWeight.get(t)! * Math.sqrt(topicTheta(state, t).var);
    if (!best || value > best.value) best = { topic: t, value };
  }
  if (!best) return null;
  const th = topicTheta(state, best.topic).mean;
  const pool = (bank.byTopic.get(best.topic) ?? []).filter((i) => !exclude.has(i.key) && !state.facts[i.factId]);
  const ranked = (pool.length ? pool : (bank.byTopic.get(best.topic) ?? []).filter((i) => !exclude.has(i.key)))
    .map((item) => ({ item, info: information(th, item.b, bank.guess) }))
    .sort((a, b) => b.info - a.info || (a.item.key < b.item.key ? -1 : 1))
    .slice(0, EXPOSURE_K);
  if (!ranked.length) return null;
  const item = ranked[Math.floor(rand() * ranked.length)]!.item;
  return { item, reason: "diagnostic", topic: best.topic, factId: item.factId, value: best.value };
}

/**
 * The one scheduler every mode uses.
 *
 * Practice ranks facts by expected value for the exam. A fact's base value is
 * its share of the exam (topic weight / facts in topic):
 *   - new fact:     base * (1 - expected topic accuracy) + uncertainty bonus
 *   - relearn:      base * 1.5, once RELEARN_GAP answers have passed since a miss
 *   - due review:   base * (1 - R) / (1 - target), capped at 1.5, once R < target
 * Every studied fact leaves the "new" pool, so no topic can absorb the session.
 */
export function nextItem(
  state: LearnerState,
  bank: Bank,
  mode: Mode,
  now: number,
  config: EngineConfig = DEFAULT_CONFIG,
  /** stable per-learner key (user id) so picks are reproducible but differ across learners */
  seedKey = "",
): Pick | null {
  const exclude = new Set(state.recent.filter((k) => now - (state.lastSeen[k] ?? 0) < RECENT_MS));
  const rng = createRng(hashSeed(`${seedKey}:${state.lastEventId}:${state.answers}`));
  if (mode === "diagnostic") return diagnosticPick(state, bank, exclude, rng.next);

  const recentFacts = new Set([...exclude].map((k) => bank.items.get(k)?.factId));
  const candidates: { factId: string; topic: string; value: number; reason: PickReason; jitter: number }[] = [];

  for (const topic of bank.topics()) {
    const facts = bank.factsByTopic.get(topic) ?? [];
    if (!facts.length) continue;
    const base = bank.topicWeight.get(topic)! / facts.length;
    const acc = topicAccuracy(state, bank, topic);
    const sd = Math.sqrt(topicTheta(state, topic).var);

    for (const factId of facts) {
      if (recentFacts.has(factId)) continue;
      const mem = state.facts[factId];
      let value: number;
      let reason: PickReason;
      if (!mem) {
        if (mode === "review") continue;
        value = base * (1 - acc + 0.3 * sd);
        reason = "new_material";
      } else if (mem.lastCorrect === false) {
        // Repeated misses widen the gap and lower the value, so a struggling
        // learner moves on to new material instead of looping on a few facts.
        const lapses = Math.max(1, mem.lapses);
        if (state.answers - (mem.lastAnswerNo ?? 0) < RELEARN_GAP * lapses) continue;
        value = (base * 1.5) / lapses;
        reason = "relearn";
      } else {
        const r = retrievabilityAt(mem, now);
        if (r >= config.targetRetention) continue;
        value = base * Math.min(1.5, (1 - r) / (1 - config.targetRetention));
        reason = "due_review";
      }
      candidates.push({ factId, topic, value, reason, jitter: rng.next() });
    }
  }

  // Ties (common among new facts in one topic) break randomly for even bank use.
  candidates.sort((a, b) => b.value - a.value || a.jitter - b.jitter);
  for (const c of candidates) {
    const item = itemForFact(state, bank, c.factId, exclude, rng.next);
    if (item) return { item, reason: c.reason, topic: c.topic, factId: c.factId, value: c.value };
  }
  if (mode === "review") return null;

  // Everything studied and nothing due: extra practice on the weakest facts by memory strength.
  const studied = Object.entries(state.facts)
    .filter(([f]) => bank.factTopic.has(f) && !recentFacts.has(f))
    .sort((a, b) => a[1].stability - b[1].stability);
  for (const [factId] of studied) {
    const item = itemForFact(state, bank, factId, exclude, rng.next);
    if (item) return { item, reason: "extra_practice", topic: bank.factTopic.get(factId)!, factId, value: 0 };
  }
  return null;
}

/**
 * A blueprint-matched mock exam form. Prefers one item per fact; if a section's
 * bank is too thin, falls back to a second wording of an already used fact.
 * Throws if the bank cannot fill a section at all, so a short mock is never served.
 */
export function mockForm(bank: Bank, seed: number, attempts = 50): ItemMeta[] {
  // Randomized greedy assembly with deterministic restarts: enemy constraints can
  // dead-end one ordering while another fills every section.
  let last: unknown;
  for (let k = 0; k < attempts; k++) {
    try {
      return assembleForm(bank, seed + k * 7919);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

function assembleForm(bank: Bank, seed: number): ItemMeta[] {
  const rng = createRng(seed);
  const form: ItemMeta[] = [];
  const usedFacts = new Set<string>();
  const usedItems = new Set<string>();
  const usedGroups = new Set<string>();
  const idOf = (k: string) => k.split("@")[0]!;
  const usedIds = new Set<string>();
  const enemyOfUsed = new Set<string>();
  const free = (x: ItemMeta) =>
    !usedItems.has(x.key) &&
    !(x.group && usedGroups.has(x.group)) &&
    !enemyOfUsed.has(idOf(x.key)) &&
    !(x.enemies ?? []).some((e) => usedIds.has(e));
  for (const sec of bank.blueprint.sections) {
    const pool = sec.topics.flatMap((t) => bank.byTopic.get(t.code) ?? []);
    for (let i = 0; i < sec.items; i++) {
      let candidates = pool.filter((x) => free(x) && !usedFacts.has(x.factId));
      if (!candidates.length) candidates = pool.filter(free);
      if (!candidates.length) {
        throw new Error(`bank cannot fill section ${sec.code}: needs ${sec.items}, has ${pool.length} items`);
      }
      const pick = candidates[rng.int(candidates.length)]!;
      usedFacts.add(pick.factId);
      usedItems.add(pick.key);
      if (pick.group) usedGroups.add(pick.group);
      usedIds.add(idOf(pick.key));
      for (const e of pick.enemies ?? []) enemyOfUsed.add(e);
      form.push(pick);
    }
  }
  return form;
}
