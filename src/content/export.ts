/**
 * Export the live (verified, non-retired) bank with the display text the app needs.
 * The engine metadata and the display text come from the same files in one pass,
 * so the app can never show a question the engine does not know, or the reverse.
 *
 *   npx tsx src/content/export.ts [outFile]
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Blueprint, ItemMeta } from "../engine/types";
import type { SourceRecord, TopicFile } from "./schema";
import { validateContent } from "./validate";

const root = fileURLToPath(new URL("../../content", import.meta.url));

export interface DisplayItem extends ItemMeta {
  id: string;
  stem: string;
  options: string[];
  answer: number;
  explanation: string;
}

export interface DisplayFact {
  statement: string;
  citation: string;
  quote: string;
  /** symmetric: if A lists B, B lists A */
  contrasts: string[];
}

export interface ExportedBank {
  exam: string;
  blueprint: Blueprint;
  topicNames: Record<string, string>;
  items: DisplayItem[];
  facts: Record<string, DisplayFact>;
}

export function exportBank(exam = "nj-life"): ExportedBank {
  const blueprint = JSON.parse(readFileSync(join(root, "exams", exam, "blueprint.json"), "utf8")) as Blueprint;
  const manifest = JSON.parse(readFileSync(join(root, "sources", "manifest.json"), "utf8")) as { sources: SourceRecord[] };
  const citation = new Map(manifest.sources.map((s) => [s.id, s.citation]));
  const verified = new Set(validateContent(root).verified);
  const topicNames: Record<string, string> = {};
  for (const s of blueprint.sections) for (const t of s.topics) topicNames[t.code] = t.name;

  const items: DisplayItem[] = [];
  const facts: Record<string, DisplayFact> = {};
  const dir = join(root, "exams", exam, "topics");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const t = JSON.parse(readFileSync(join(dir, f), "utf8")) as TopicFile;
    for (const fact of t.facts) {
      const live = fact.items.filter((it) => !it.retired && verified.has(it.id));
      facts[fact.id] = {
        statement: fact.statement,
        citation: citation.get(fact.source) ?? fact.source,
        quote: fact.quote,
        contrasts: [...(fact.contrasts ?? [])],
      };
      for (const it of live) {
        items.push({
          key: `${it.id}@${it.version}`,
          id: it.id,
          factId: fact.id,
          topic: t.topic,
          b: it.difficulty,
          group: it.group,
          enemies: it.enemies,
          stem: it.stem,
          options: [...it.options],
          answer: it.answer,
          explanation: it.explanation,
        });
      }
    }
  }
  // Contrasts are declared on one side only; make them symmetric for display.
  for (const [id, f] of Object.entries(facts))
    for (const c of f.contrasts) if (facts[c] && !facts[c].contrasts.includes(id)) facts[c].contrasts.push(id);
  // Keep only facts that have a live item, or are a contrast of one.
  const liveFacts = new Set(items.map((i) => i.factId));
  for (const id of Object.keys(facts)) {
    if (liveFacts.has(id)) continue;
    if (![...liveFacts].some((l) => facts[l]!.contrasts.includes(id))) delete facts[id];
  }
  return { exam, blueprint, topicNames, items, facts };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2] ?? fileURLToPath(new URL("../../web/data/bank.json", import.meta.url));
  const b = exportBank();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(b));
  console.log(`exported ${b.items.length} live items, ${Object.keys(b.facts).length} facts -> ${out}`);
}
