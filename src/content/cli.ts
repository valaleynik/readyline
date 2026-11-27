import { fileURLToPath } from "node:url";
import { validateContent } from "./validate";

const root = fileURLToPath(new URL("../../content", import.meta.url));
const r = validateContent(root);
const errors = r.findings.filter((f) => f.level === "error");
const warns = r.findings.filter((f) => f.level === "warn");

for (const f of [...errors, ...warns]) console.log(`${f.level.toUpperCase().padEnd(5)} ${f.where}  ${f.message}`);
console.log(
  `\n${r.facts} facts, ${r.items} items, ${r.verified.length} verified. Key positions A/B/C/D: ${r.answerPositions.join("/")}. ` +
    `${errors.length} errors, ${warns.length} warnings.`,
);
process.exit(errors.length ? 1 : 0);
