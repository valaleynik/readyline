import type { Blueprint, ItemMeta } from "./types";

/** Read-only index over the live item bank plus the exam blueprint. */
export class Bank {
  readonly items = new Map<string, ItemMeta>();
  readonly byTopic = new Map<string, ItemMeta[]>();
  readonly byFact = new Map<string, ItemMeta[]>();
  readonly factTopic = new Map<string, string>();
  readonly factsByTopic = new Map<string, string[]>();
  /** share of the scored exam each topic represents (sums to 1) */
  readonly topicWeight = new Map<string, number>();
  readonly topicSection = new Map<string, string>();
  readonly guess: number;
  readonly passScore: number;

  constructor(readonly blueprint: Blueprint, items: ItemMeta[]) {
    this.guess = 1 / blueprint.optionsPerItem;
    this.passScore = Math.ceil((blueprint.scoredItems * blueprint.passPercent) / 100);

    const total = blueprint.sections.reduce((s, x) => s + x.items, 0);
    for (const section of blueprint.sections) {
      for (const t of section.topics) {
        this.topicWeight.set(t.code, section.items / section.topics.length / total);
        this.topicSection.set(t.code, section.code);
        this.byTopic.set(t.code, []);
        this.factsByTopic.set(t.code, []);
      }
    }

    for (const item of [...items].sort((a, b) => (a.key < b.key ? -1 : 1))) {
      if (!this.topicWeight.has(item.topic)) {
        throw new Error(`item ${item.key} has topic ${item.topic} which is not in the blueprint`);
      }
      this.items.set(item.key, item);
      this.byTopic.get(item.topic)!.push(item);
      if (!this.byFact.has(item.factId)) {
        this.byFact.set(item.factId, []);
        this.factTopic.set(item.factId, item.topic);
        this.factsByTopic.get(item.topic)!.push(item.factId);
      }
      this.byFact.get(item.factId)!.push(item);
    }
  }

  topics(): string[] {
    return [...this.topicWeight.keys()];
  }
}
