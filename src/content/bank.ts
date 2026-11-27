/**
 * Bridge from the content files to the engine. Only verified items become live:
 * the engine never sees a question that has not passed every check.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Bank } from "../engine/bank";
import type { Blueprint, ItemMeta } from "../engine/types";
import type { TopicFile } from "./schema";
import { validateContent } from "./validate";

const root = fileURLToPath(new URL("../../content", import.meta.url));

export function loadLiveBank(exam = "nj-life"): { bank: Bank; blueprint: Blueprint; live: ItemMeta[]; drafts: number } {
  const blueprint = JSON.parse(readFileSync(join(root, "exams", exam, "blueprint.json"), "utf8")) as Blueprint;
  const verified = new Set(validateContent(root).verified);
  const dir = join(root, "exams", exam, "topics");
  const live: ItemMeta[] = [];
  let drafts = 0;
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const t = JSON.parse(readFileSync(join(dir, f), "utf8")) as TopicFile;
      for (const fact of t.facts)
        for (const it of fact.items) {
          if (it.retired) continue;
          if (!verified.has(it.id)) {
            drafts++;
            continue;
          }
          live.push({ key: `${it.id}@${it.version}`, factId: fact.id, topic: t.topic, b: it.difficulty, group: it.group });
        }
    }
  }
  return { bank: new Bank(blueprint, live), blueprint, live, drafts };
}

/** How far the live bank is from filling the blueprint. */
export function coverage(exam = "nj-life") {
  const { bank, blueprint, live, drafts } = loadLiveBank(exam);
  const rows = blueprint.sections.map((s) => {
    const topics = s.topics.map((t) => ({
      code: t.code,
      name: t.name,
      items: bank.byTopic.get(t.code)?.length ?? 0,
      facts: bank.factsByTopic.get(t.code)?.length ?? 0,
    }));
    const items = topics.reduce((a, t) => a + t.items, 0);
    // Rule of thumb for a usable section: 5 live items per scored exam item, so
    // practice and several mock forms can run without heavy repetition.
    const target = s.items * 5;
    return { code: s.code, name: s.name, examItems: s.items, live: items, target, topics };
  });
  return { rows, live: live.length, drafts };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const c = coverage();
  console.log(`Live items: ${c.live}   Drafts awaiting review: ${c.drafts}\n`);
  console.log("Section".padEnd(6), "Exam".padStart(5), "Live".padStart(6), "Target".padStart(7), "  Topics with live items");
  for (const r of c.rows) {
    const covered = r.topics.filter((t) => t.items > 0).map((t) => `${t.code}(${t.items})`).join(" ") || "none";
    console.log(r.code.padEnd(6), String(r.examItems).padStart(5), String(r.live).padStart(6), String(r.target).padStart(7), " ", covered);
  }
}
