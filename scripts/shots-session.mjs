// Screenshots of the study session (local-only build on :3101): question, feedback (wrong, with "don't confuse"), +1, end.
import puppeteer from "puppeteer-core";
import { mkdirSync, readFileSync } from "node:fs";
const out = process.argv[2] ?? "shots"; mkdirSync(out, { recursive: true });
const bank = JSON.parse(readFileSync("web/data/bank.json", "utf8"));
const byStem = new Map(bank.items.map((i) => [i.stem, i]));
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: "new" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (p, t) => p.evaluate((t) => [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(t)).click(), t);
async function currentItem(p) { const stem = await p.$eval("#ss-stem", (e) => e.textContent); return byStem.get(stem); }
for (const [w, tag] of [[1280, "desktop"], [390, "phone"]]) {
  const p = await b.newPage(); await p.setViewport({ width: w, height: w < 600 ? 844 : 900 });
  await p.goto("http://localhost:3101/", { waitUntil: "networkidle0" });
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem("readyline.settings.v1", JSON.stringify({ onboardedAt: 1, baselineSkipped: true })); });
  await p.reload({ waitUntil: "networkidle0" });
  await click(p, "Start today's session"); await sleep(200);
  // answer a few, then find one whose fact has a contrast and miss it
  for (let i = 0; i < 25; i++) {
    const it = await currentItem(p);
    const hasContrast = (bank.facts[it.factId]?.contrasts ?? []).length > 0;
    const pick = hasContrast && i > 2 ? (it.answer + 1) % 4 : it.answer;
    await p.$$eval("button.rl-option", (els, k) => els[k].click(), pick); await sleep(80);
    if (i === 2) await p.screenshot({ path: `${out}/question-${tag}.png` });
    await click(p, "I'm sure"); await sleep(120);
    if (i === 1) await p.screenshot({ path: `${out}/plus-one-${tag}.png` });
    if (pick !== it.answer) { await sleep(900); await p.screenshot({ path: `${out}/feedback-wrong-${tag}.png`, fullPage: true }); break; }
    await click(p, "Next question"); await sleep(120);
  }
  // finish the session
  for (let i = 0; i < 80; i++) {
    const done = await p.evaluate(() => !!document.querySelector(".sd"));
    if (done) break;
    const next = await p.evaluate(() => !![...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Next question"));
    if (next) { await click(p, "Next question"); await sleep(60); continue; }
    await p.$$eval("button.rl-option", (els) => els[0].click()); await click(p, "I'm sure"); await sleep(60);
  }
  await sleep(300); await p.screenshot({ path: `${out}/done-${tag}.png`, fullPage: true });
  await p.close();
}
await b.close(); console.log("done");
