// Screenshots of study screens in light and dark, phone and desktop, from a local-only build (no Supabase env).
// Usage: next start -p 3101 in web/, then: node scripts/screenshots.mjs <outdir>
import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: "new" });
const out = process.argv[2] ?? "/home/claude/shots";
const shots = [];
async function run(name, width, theme, steps) {
  const p = await b.newPage();
  await p.setViewport({ width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1 });
  await p.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  await p.goto(process.env.BASE ?? "http://localhost:3101/", { waitUntil: "networkidle0" });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: "networkidle0" });
  for (const s of steps) await s(p);
  await new Promise((r) => setTimeout(r, 300));
  const f = `${out}/${name}.png`; await p.screenshot({ path: f }); shots.push(f); await p.close();
}
const click = (text) => async (p) => {
  const ok = await p.evaluate((t) => { const el=[...document.querySelectorAll("button,a")].find(e=>e.textContent.trim().startsWith(t)); if(el){el.click();return true} return false }, text);
  if (!ok) throw new Error("no button " + text);
  await new Promise((r) => setTimeout(r, 250));
};
const pick = async (p) => { await p.evaluate(() => document.querySelector(".option").click()); await new Promise((r) => setTimeout(r, 150)); };
import { mkdirSync } from "node:fs"; mkdirSync(out, { recursive: true });
await run("home-desktop-light", 1280, "light", []);
await run("home-phone-light", 390, "light", []);
await run("question-phone-light", 390, "light", [click("Skip it"), click("Start first session"), pick]);
await run("feedback-desktop-light", 1280, "light", [click("Skip it"), click("Start first session"), pick, click("I'm sure")]);
await b.close();
console.log(shots.join("\n"));
