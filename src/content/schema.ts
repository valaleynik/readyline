/** Content files are the reviewable, version-controlled source of the item bank. */

export interface SourceRecord {
  id: string;
  kind: "statute" | "regulation" | "blueprint" | "model_law" | "manual" | "other";
  citation: string;
  title: string;
  url: string;
  retrievedAt: string;
  sha256: string;
  verifiedAgainstOfficial: boolean;
}

export interface ItemDraft {
  id: string;
  version: number;
  kind: "recall" | "scenario" | "application";
  stem: string;
  options: [string, string, string, string];
  answer: 0 | 1 | 2 | 3;
  explanation: string;
  /** "ordered": options have a natural order and must not be shuffled. "category": options are names of practices, lines or factors, so the key may share the statute's term */
  optionStyle?: "category" | "ordered";
  /** set when the item is withdrawn; the reason is kept for the audit trail */
  retired?: string;
  /** items sharing a group cue each other and must never appear on the same form.
   *  Use only when one item's stem or key reveals the other's answer: over-grouping starves mock forms. */
  group?: string;
  /** ids of specific items this one cues (or is cued by); never placed on the same form */
  enemies?: string[];
  /** generator's estimate of IRT difficulty: about -1 easy, 0 medium, +1 hard */
  difficulty: number;
}

export interface FactDraft {
  id: string;
  statement: string;
  source: string;
  /** exact substring of the source text that proves the statement */
  quote: string;
  items: ItemDraft[];
}

export interface TopicFile {
  exam: string;
  topic: string;
  facts: FactDraft[];
}

export type CheckKind = "blind_solve" | "distractor" | "ambiguity" | "testwise" | "citation" | "dedupe" | "human";

export interface ReviewRecord {
  itemId: string;
  version: number;
  check: CheckKind;
  passed: boolean;
  reviewer: string;
  detail: string;
  at: string;
}
