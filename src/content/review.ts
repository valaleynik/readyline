/**
 * Blind review workflow.
 *
 *   tsx src/content/review.ts pack <round> <outDir> [itemId ...]
 *     Writes questions (no keys) plus source texts to <outDir>, and records the exact
 *     option layout each reviewer will see in content/reviews/pending/<round>.json.
 *     With no ids, packs every item that is not verified.
 *
 *   tsx src/content/review.ts ingest <round> <resultsJson> <reviewer>
 *     Scores results against the pending snapshot by option TEXT, never by letter,
 *     so a later reordering cannot corrupt a review. Writes content/reviews/<round>.json
 *     and clears the pending snapshot.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ItemDraft, ReviewRecord, TopicFile } from "./schema";
import { validateContent } from "./validate";

const root = fileURLToPath(new URL("../../content", import.meta.url));
const pendingDir = join(root, "reviews", "pending");

interface Snapshot {
  itemId: string;
  version: number;
  source: string;
  stem: string;
  options: string[];
  key: string;
}

function allItems(): { item: ItemDraft; source: string }[] {
  const out: { item: ItemDraft; source: string }[] = [];
  for (const exam of readdirSync(join(root, "exams"))) {
    const dir = join(root, "exams", exam, "topics");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const t = JSON.parse(readFileSync(join(dir, f), "utf8")) as TopicFile;
      for (const fact of t.facts) for (const item of fact.items) if (!item.retired) out.push({ item, source: fact.source });
    }
  }
  return out;
}

function pack(round: string, outDir: string, ids: string[]) {
  const report = validateContent(root);
  const errors = report.findings.filter((f) => f.level === "error");
  if (errors.length) {
    for (const e of errors) console.error(`ERROR ${e.where}  ${e.message}`);
    throw new Error(`refusing to pack with ${errors.length} validation errors`);
  }
  const verified = new Set(report.verified);
  // Never pack an item version that is already out for review in another round.
  const pending = new Set<string>();
  if (existsSync(pendingDir))
    for (const f of readdirSync(pendingDir).filter((x) => x.endsWith(".json") && !x.endsWith(".snapshot.json")))
      if (f !== `${round}.json`) for (const k of JSON.parse(readFileSync(join(pendingDir, f), "utf8")) as string[]) pending.add(k);
  const chosen = allItems().filter(
    ({ item }) => (ids.length ? ids.includes(item.id) : !verified.has(item.id)) && !pending.has(`${item.id}@${item.version}`),
  );
  const snaps: Snapshot[] = chosen.map(({ item, source }) => ({
    itemId: item.id,
    version: item.version,
    source,
    stem: item.stem,
    options: [...item.options],
    key: item.options[item.answer]!,
  }));
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "sources"), { recursive: true });
  for (const f of readdirSync(join(root, "sources")).filter((x) => x.endsWith(".txt")))
    copyFileSync(join(root, "sources", f), join(outDir, "sources", f));
  const questions = snaps.map((s) => ({
    id: s.itemId,
    source_file: `${s.source}.txt`,
    stem: s.stem,
    options: Object.fromEntries(s.options.map((o, i) => ["ABCD"[i], o])),
  }));
  writeFileSync(join(outDir, "questions.json"), JSON.stringify(questions, null, 2));
  mkdirSync(pendingDir, { recursive: true });
  writeFileSync(join(pendingDir, `${round}.json`), JSON.stringify(snaps.map((s) => `${s.itemId}@${s.version}`)));
  writeFileSync(join(pendingDir, `${round}.snapshot.json`), JSON.stringify(snaps, null, 2));
  console.log(`packed ${snaps.length} items for round ${round} into ${outDir}`);
}

interface Result {
  id: string;
  blind_answer: string;
  ambiguity: boolean;
  ambiguity_reason?: string;
  distractors_clearly_wrong: boolean;
  distractor_issue?: string;
  testwise?: boolean;
  testwise_reason?: string;
}

function ingest(round: string, resultsPath: string, reviewer: string) {
  const snaps = JSON.parse(readFileSync(join(pendingDir, `${round}.snapshot.json`), "utf8")) as Snapshot[];
  const results = new Map((JSON.parse(readFileSync(resultsPath, "utf8")) as Result[]).map((r) => [r.id, r]));
  const at = new Date().toISOString().slice(0, 10);
  const records: ReviewRecord[] = [];
  // Refuse to score an item that changed after it was packed: the review would not describe it.
  const current = new Map(allItems().map(({ item }) => [item.id, item]));
  let agree = 0;
  let skipped = 0;
  for (const s of snaps) {
    const now = current.get(s.itemId);
    if (!now || now.version !== s.version || now.stem !== s.stem || [...now.options].sort().join("|") !== [...s.options].sort().join("|")) {
      console.warn(`skipping ${s.itemId}@${s.version}: changed after packing, so this review does not describe the current item`);
      skipped++;
      continue;
    }
    const r = results.get(s.itemId);
    if (!r) throw new Error(`no result for ${s.itemId}`);
    const picked = s.options["ABCD".indexOf(r.blind_answer)];
    const ok = picked === s.key;
    if (ok) agree++;
    const rec = (check: ReviewRecord["check"], passed: boolean, detail: string, who = reviewer) =>
      records.push({ itemId: s.itemId, version: s.version, check, passed, reviewer: who, detail, at });
    rec("blind_solve", ok, `picked "${picked ?? r.blind_answer}"${ok ? "" : `, key "${s.key}"`}`);
    rec("ambiguity", !r.ambiguity, r.ambiguity_reason || "no second defensible option");
    rec("distractor", r.distractors_clearly_wrong, r.distractor_issue || "all distractors clearly wrong");
    if (r.testwise !== undefined) rec("testwise", !r.testwise, r.testwise_reason || "key not identifiable from form");
    rec("citation", true, "exact source quote and cited explanation", "validator");
    rec("dedupe", true, "no stem above 0.8 similarity", "validator");
  }
  writeFileSync(join(root, "reviews", `${round}.json`), JSON.stringify(records, null, 2));
  rmSync(join(pendingDir, `${round}.json`), { force: true });
  rmSync(join(pendingDir, `${round}.snapshot.json`), { force: true });
  console.log(`round ${round}: ${agree}/${snaps.length - skipped} blind answers matched the key${skipped ? ` (${skipped} stale items skipped)` : ""}`);
}

const [cmd, round, a, ...rest] = process.argv.slice(2);
if (cmd === "pack" && round && a) pack(round, a, rest);
else if (cmd === "ingest" && round && a && rest[0]) ingest(round, a, rest[0]);
else {
  console.error("usage: review.ts pack <round> <outDir> [ids...] | ingest <round> <results.json> <reviewer>");
  process.exit(1);
}
