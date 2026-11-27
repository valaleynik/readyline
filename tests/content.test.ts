import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { validateContent } from "../src/content/validate";
import { rebalance } from "../src/content/rebalance";
import type { ItemDraft, TopicFile } from "../src/content/schema";

const root = fileURLToPath(new URL("../content", import.meta.url));

describe("content bank", () => {
  const report = validateContent(root);

  it("has no validation errors", () => {
    expect(report.findings.filter((f) => f.level === "error")).toEqual([]);
  });

  it("keeps key positions between 15% and 35%", () => {
    const total = report.answerPositions.reduce((a, b) => a + b, 0);
    for (const p of report.answerPositions) {
      expect(p / total).toBeGreaterThan(0.15);
      expect(p / total).toBeLessThan(0.35);
    }
  });
});

function item(id: string, answer: 0 | 1 | 2 | 3, options = ["w", "x", "y", "z"]): ItemDraft {
  return {
    id,
    version: 1,
    kind: "recall",
    stem: "?",
    options: options as ItemDraft["options"],
    answer,
    explanation: "",
    difficulty: 0,
  };
}

describe("rebalance", () => {
  const file = (items: ItemDraft[]): { path: string; data: TopicFile } => ({
    path: "x",
    data: { exam: "X", topic: "T", facts: [{ id: "f", statement: "", source: "s", quote: "", items }] },
  });

  it("evens out key positions and keeps the key text", () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`i${i}`, 0, [`key${i}`, "b", "c", "d"]));
    rebalance([file(items)]);
    const counts = [0, 0, 0, 0];
    for (const it of items) {
      counts[it.answer]!++;
      expect(it.options[it.answer]).toMatch(/^key/);
    }
    expect(counts).toEqual([2, 2, 2, 2]);
  });

  it("never moves a reviewed or pending item", () => {
    const frozen = item("frozen", 0, ["key", "b", "c", "d"]);
    const items = [frozen, ...Array.from({ length: 7 }, (_, i) => item(`i${i}`, 0, [`k${i}`, "b", "c", "d"]))];
    rebalance([file(items)], new Set(["frozen@1"]));
    expect(frozen.answer).toBe(0);
    expect(frozen.options).toEqual(["key", "b", "c", "d"]);
  });

  it("never reorders naturally ordered options", () => {
    const nums = item("n", 0, ["10 days", "30 days", "60 days", "90 days"]);
    rebalance([file([nums, item("a", 0), item("b", 0), item("c", 0)])]);
    expect(nums.options).toEqual(["10 days", "30 days", "60 days", "90 days"]);
  });
});
