export interface BlueprintTopic {
  code: string;
  name: string;
}

export interface BlueprintSection {
  code: string;
  name: string;
  items: number;
  topics: BlueprintTopic[];
}

export interface Blueprint {
  /** minutes allowed on the real exam */
  timeMinutes: number;
  code: string;
  name: string;
  scoredItems: number;
  passPercent: number;
  optionsPerItem: number;
  sections: BlueprintSection[];
}

/** What the engine needs to know about a live item. Content lives in the database. */
export interface ItemMeta {
  /** Stable key: `${id}@${version}` */
  key: string;
  factId: string;
  topic: string;
  /** IRT difficulty on the logit scale (calibrated, or the generator prior). */
  b: number;
  /** items in the same enemy group cue each other and never share a form */
  group?: string;
  /** item ids (without version) that must never share a form with this one */
  enemies?: string[];
}

export interface AnswerEvent {
  id: number;
  itemKey: string;
  correct: boolean;
  /** epoch milliseconds when the learner answered */
  at: number;
  /** learner's self-rating before answering. Recorded for calibration; the engine does not use it yet. */
  confidence?: "sure" | "guess";
  /** where the answer was given. The engine treats every answer the same way. */
  context?: "baseline" | "session" | "mock";
}

export interface Gaussian {
  mean: number;
  var: number;
}

export interface TopicAbility extends Gaussian {
  n: number;
  correct: number;
}

export interface FactMemory {
  stability: number;
  difficulty: number;
  lastReview: number;
  reps: number;
  lapses: number;
  /** was the most recent answer on this fact correct */
  lastCorrect?: boolean;
  /** learner's answer count when this fact was last answered */
  lastAnswerNo?: number;
}

export interface LearnerState {
  engineVersion: string;
  /** general ability */
  g: Gaussian;
  /** topic offsets from general ability */
  topics: Record<string, TopicAbility>;
  facts: Record<string, FactMemory>;
  /** itemKey -> last answered at */
  lastSeen: Record<string, number>;
  /** most recent item keys, newest last */
  recent: string[];
  answers: number;
  lastEventId: number;
  lastAt: number;
  /** events whose item was not in the bank (retired or unknown) */
  skipped: number;
}

export interface EngineConfig {
  /** prior on general ability */
  gPrior: Gaussian;
  /** prior on topic offsets */
  topicPrior: Gaussian;
  /** retention target used for review scheduling */
  targetRetention: number;
  /** how many recent items are excluded from selection */
  recentWindow: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  gPrior: { mean: 0, var: 1 },
  topicPrior: { mean: 0, var: 0.25 },
  targetRetention: 0.9,
  recentWindow: 25,
};

export const ENGINE_VERSION = "0.1.0";
