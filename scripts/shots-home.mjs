// Screenshots of home (local-only build on :3101): new learner, a learner with 6 weeks of history mid-day, done for today.
import puppeteer from "puppeteer-core";
import { mkdirSync, readFileSync } from "node:fs";
const out = process.argv[2] ?? "shots"; mkdirSync(out, { recursive: true });
const bank = JSON.parse(readFileSync("web/data/bank.json", "utf8"));
const DAY = 86_400_000, now = Date.now();
function history(todayCount) {
  const ev = []; let id = 1; const items = bank.items;
  for (let d = 42; d >= 0; d--) {
    const skip = d > 0 && (d % 7 === 3 || d % 11 === 0 || (d > 30 && d % 2));
    if (skip) continue;
    const n = d === 0 ? todayCount : 5 + ((d * 37) % 40);
    const t0 = new Date(now - d * DAY); t0.setHours(9, 0, 0, 0);
    for (let k = 0; k < n; k++) {
      const it = items[(id * 7) % items.length];
      ev.push({ id: id++, itemKey: it.key, correct: (id % 4) !== 0, at: Math.min(now - 1000, t0.getTime() + k * 40_000), confidence: "sure", context: "session" });
    }
  }
  return ev;
}
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: "new" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exam = new Date(now + 40 * DAY); exam.setHours(12, 0, 0, 0);
const cases = {
  new: { events: [], settings: { onboardedAt: 1, baselineSkipped: true } },
  history: { events: history(8), settings: { onboardedAt: 1, baselineSkipped: true, examAt: exam.getTime() } },
  baseline: { events: [], settings: { onboardedAt: 1 } },
};
for (const [w, tag] of [[1280, "desktop"], [390, "phone"]]) {
  for (const [name, c] of Object.entries(cases)) {
    const p = await b.newPage(); await p.setViewport({ width: w, height: w < 600 ? 844 : 900 });
    await p.goto("http://localhost:3101/", { waitUntil: "networkidle0" });
    await p.evaluate((c) => { localStorage.clear(); localStorage.setItem("readyline.events.v1", JSON.stringify(c.events)); localStorage.setItem("readyline.settings.v1", JSON.stringify(c.settings)); }, c);
    await p.reload({ waitUntil: "networkidle0" }); await sleep(400);
    if (name === "history" && tag === "desktop") {
      await p.evaluate(() => document.querySelector(".hm-sections")?.setAttribute("open", ""));
    }
    await p.screenshot({ path: `${out}/home-${name}-${tag}.png`, fullPage: true });
    await p.close();
  }
}
await b.close(); console.log("done");
