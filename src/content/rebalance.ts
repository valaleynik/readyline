/**
 * Moves correct answers so key positions stay near 25% each, without touching
 * items whose options have a natural order (numbers, durations). Distractors keep
 * their relative order. Run after authoring, before review: reordering options
 * changes the item, so it must happen before any review record exists.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ItemDraft, TopicFile } from "./schema";

const ordered = (opts: string[]) => opts.every((o) => /^\$?\d/.test(o.trim()));

export function rebalance(files: { path: string; data: TopicFile }[], reviewed: Set<string> = new Set()) {
  const all = files.flatMap((f) => f.data.facts.flatMap((fact) => fact.items));
  // Reviewed items are frozen: moving their options would silently invalidate the review.
  const frozen = (it: ItemDraft) => ordered(it.options) || it.optionStyle === "ordered" || reviewed.has(`${it.id}@${it.version}`);
  const counts = [0, 0, 0, 0];
  for (const it of all) if (frozen(it)) counts[it.answer]!++;

  let moved = 0;
  for (const it of all) {
    if (frozen(it)) continue;
    const target = counts.indexOf(Math.min(...counts)) as ItemDraft["answer"];
    counts[target]!++;
    if (target === it.answer) continue;
    const key = it.options[it.answer]!;
    const rest = it.options.filter((_, i) => i !== it.answer);
    rest.splice(target, 0, key);
    it.options = rest as ItemDraft["options"];
    it.answer = target;
    moved++;
  }
  return { moved, counts };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = fileURLToPath(new URL(`../../content/exams/${process.argv[2] ?? "nj-life"}/topics`, import.meta.url));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ path: join(dir, f), data: JSON.parse(readFileSync(join(dir, f), "utf8")) as TopicFile }));
  const reviewDir = fileURLToPath(new URL("../../content/reviews", import.meta.url));
  const reviewed = new Set(
    readdirSync(reviewDir)
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => JSON.parse(readFileSync(join(reviewDir, f), "utf8")) as { itemId: string; version: number }[])
      .map((r) => `${r.itemId}@${r.version}`),
  );
  // Items sent out for review but not yet recorded are frozen too.
  const pendingDir = join(reviewDir, "pending");
  try {
    for (const f of readdirSync(pendingDir).filter((x) => x.endsWith(".json")))
      for (const k of JSON.parse(readFileSync(join(pendingDir, f), "utf8")) as string[]) reviewed.add(k);
  } catch {}
  const r = rebalance(files, reviewed);
  for (const f of files) writeFileSync(f.path, JSON.stringify(f.data, null, 2) + "\n");
  console.log(`moved ${r.moved} keys; positions A/B/C/D now ${r.counts.join("/")}`);
}
