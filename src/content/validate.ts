import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Blueprint } from "../engine/types";
import type { ReviewRecord, SourceRecord, TopicFile } from "./schema";

export interface Finding {
  level: "error" | "warn";
  where: string;
  message: string;
}

export interface ValidationReport {
  findings: Finding[];
  facts: number;
  items: number;
  /** items whose every automated check has a passing review */
  verified: string[];
  answerPositions: [number, number, number, number];
}

const BANNED_OPTIONS = /\b(all of the above|none of the above|both [a-d] and [a-d]|a and b|b and c)\b/i;
const ABSOLUTE_CUES = /\b(always|never)\b/i;
const REQUIRED_CHECKS = ["blind_solve", "distractor", "ambiguity", "citation", "dedupe"] as const;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string) => new Set(norm(s).split(" ").filter((t) => t.length > 2));
function jaccard(a: Set<string>, b: Set<string>) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

export function validateContent(root: string): ValidationReport {
  const findings: Finding[] = [];
  const err = (where: string, message: string) => findings.push({ level: "error", where, message });
  const warn = (where: string, message: string) => findings.push({ level: "warn", where, message });

  // ---- sources: every file must exist and match its recorded hash ----
  const manifest = JSON.parse(readFileSync(join(root, "sources/manifest.json"), "utf8")) as { sources: SourceRecord[] };
  const sourceText = new Map<string, string>();
  for (const s of manifest.sources) {
    const path = join(root, "sources", `${s.id}.txt`);
    if (!existsSync(path)) {
      err(s.id, "source file missing");
      continue;
    }
    const text = readFileSync(path, "utf8");
    const hash = createHash("sha256").update(text).digest("hex");
    if (hash !== s.sha256) err(s.id, `source text changed since retrieval (hash ${hash.slice(0, 12)} != ${s.sha256.slice(0, 12)})`);
    sourceText.set(s.id, text);
  }

  // ---- topic files ----
  let facts = 0;
  let items = 0;
  const positions: [number, number, number, number] = [0, 0, 0, 0];
  const ids = new Set<string>();
  const stems: { id: string; t: Set<string> }[] = [];
  const allItems: { id: string; version: number }[] = [];

  for (const exam of readdirSync(join(root, "exams"))) {
    const bp = JSON.parse(readFileSync(join(root, "exams", exam, "blueprint.json"), "utf8")) as Blueprint;
    const topics = new Set(bp.sections.flatMap((s) => s.topics.map((t) => t.code)));
    const topicDir = join(root, "exams", exam, "topics");
    if (!existsSync(topicDir)) continue;

    for (const file of readdirSync(topicDir).filter((f) => f.endsWith(".json"))) {
      const tf = JSON.parse(readFileSync(join(topicDir, file), "utf8")) as TopicFile;
      if (!topics.has(tf.topic)) err(file, `topic ${tf.topic} is not in the ${exam} blueprint`);

      for (const fact of tf.facts) {
        facts++;
        const where = `${file}:${fact.id}`;
        if (ids.has(fact.id)) err(where, "duplicate fact id");
        ids.add(fact.id);
        const src = sourceText.get(fact.source);
        if (!src) err(where, `unknown source ${fact.source}`);
        else if (!src.includes(fact.quote)) err(where, "quote is not an exact substring of the source text");
        if (fact.quote.length < 15) err(where, "quote too short to prove anything");
        if (!fact.items.length) err(where, "fact has no items");

        for (const item of fact.items) {
          if (item.retired) {
            if (ids.has(item.id)) err(`${file}:${item.id}`, "duplicate item id");
            ids.add(item.id);
            continue;
          }
          items++;
          const w = `${file}:${item.id}`;
          if (ids.has(item.id)) err(w, "duplicate item id");
          ids.add(item.id);
          allItems.push({ id: item.id, version: item.version });

          if (item.options.length !== 4) err(w, "must have exactly 4 options");
          if (!(item.answer >= 0 && item.answer <= 3)) err(w, "answer index out of range");
          positions[item.answer]++;

          const opts = item.options.map(norm);
          if (new Set(opts).size !== opts.length) err(w, "duplicate options");
          item.options.forEach((o, i) => {
            if (BANNED_OPTIONS.test(o)) err(w, `option ${i} uses a combination or catch-all answer`);
            if (!o.trim()) err(w, `option ${i} is empty`);
          });

          // test-wise cues: the key should not stand out by length or absolutes
          const lens = item.options.map((o) => o.length);
          const keyLen = lens[item.answer]!;
          const others = lens.filter((_, i) => i !== item.answer);
          const maxOther = Math.max(...others);
          if (keyLen > 1.5 * maxOther && keyLen - maxOther > 25) warn(w, "correct option is much longer than every distractor");
          item.options.forEach((o, i) => {
            if (i !== item.answer && ABSOLUTE_CUES.test(o) && !ABSOLUTE_CUES.test(item.options[item.answer]!))
              warn(w, `distractor ${i} uses "always/never", a test-wise giveaway`);
          });

          // Test-wiseness: the key should not be the only option that echoes the source wording.
          const qt = tokens(fact.quote);
          const echo = (o: string) => {
            const t = tokens(o);
            if (!t.size) return 0;
            let hit = 0;
            for (const x of t) if (qt.has(x)) hit++;
            return hit / t.size;
          };
          const keyEcho = echo(item.options[item.answer]!);
          const maxDistractorEcho = Math.max(...item.options.filter((_, i) => i !== item.answer).map(echo));
          // Category items (options are names of practices or factors) naturally share the statute's term.
          const numeric = item.options.every((o) => /^\$?\d/.test(o.trim()));
          if (item.optionStyle === undefined && !numeric && keyEcho - maxDistractorEcho > 0.4)
            warn(w, `key echoes the source wording far more than any distractor (${keyEcho.toFixed(2)} vs ${maxDistractorEcho.toFixed(2)})`);

          if (!item.stem.trim().endsWith("?") && !item.stem.includes("_____") && !/:$/.test(item.stem.trim()))
            warn(w, "stem should be a question or completion");
          if (!item.explanation.includes(manifest.sources.find((s) => s.id === fact.source)?.citation ?? "@@"))
            err(w, "explanation must cite the source");

          const t = tokens(item.stem);
          for (const s of stems) if (jaccard(t, s.t) > 0.8) err(w, `stem nearly duplicates ${s.id}`);
          stems.push({ id: item.id, t });
        }
      }
    }
  }

  const allIds = new Set(allItems.map((i) => i.id));
  for (const exam of readdirSync(join(root, "exams"))) {
    const topicDir = join(root, "exams", exam, "topics");
    if (!existsSync(topicDir)) continue;
    for (const file of readdirSync(topicDir).filter((f) => f.endsWith(".json"))) {
      const tf = JSON.parse(readFileSync(join(topicDir, file), "utf8")) as TopicFile;
      for (const fact of tf.facts)
        for (const it of fact.items)
          for (const e of it.enemies ?? []) if (!allIds.has(e) && !it.retired) err(`${file}:${it.id}`, `enemy ${e} is not an active item`);
    }
  }

  const total = positions.reduce((a, b) => a + b, 0);
  positions.forEach((p, i) => {
    if (total >= 20 && (p / total < 0.15 || p / total > 0.35))
      warn("bank", `answer position ${"ABCD"[i]} is ${(100 * p / total).toFixed(0)}% of keys`);
  });

  // ---- reviews ----
  const verified: string[] = [];
  const reviewDir = join(root, "reviews");
  const reviews: ReviewRecord[] = existsSync(reviewDir)
    ? readdirSync(reviewDir)
        .filter((f) => f.endsWith(".json"))
        .flatMap((f) => JSON.parse(readFileSync(join(reviewDir, f), "utf8")) as ReviewRecord[])
    : [];
  for (const it of allItems) {
    const mine = reviews.filter((r) => r.itemId === it.id && r.version === it.version);
    const failed = mine.filter((r) => !r.passed);
    if (failed.length) for (const f of failed) warn(it.id, `review ${f.check} failed: ${f.detail}`);
    // An item with an open quality warning is not verified, even if every review passed.
    const warned = findings.some((f) => f.where.endsWith(`:${it.id}`));
    if (!failed.length && !warned && REQUIRED_CHECKS.every((c) => mine.some((r) => r.check === c && r.passed))) verified.push(it.id);
  }

  return { findings, facts, items, verified, answerPositions: positions };
}
