// Screenshots of sign-in (needs a build with Supabase env on :3102) and onboarding (local-only build on :3101).
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
const out = process.argv[2] ?? "shots"; mkdirSync(out, { recursive: true });
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"], headless: "new" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function page(url, width) {
  const p = await b.newPage();
  await p.setViewport({ width, height: width < 600 ? 844 : 860 });
  await p.goto(url, { waitUntil: "networkidle0" });
  await p.evaluate(() => localStorage.clear());
  await p.goto(url, { waitUntil: "networkidle0" });
  return p;
}
const clickText = (p, t) => p.evaluate((t) => { const e=[...document.querySelectorAll("button,label")].find(x=>x.textContent.trim().startsWith(t)); e.click(); }, t);
const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png` });
for (const [w, tag] of [[1280, "desktop"], [390, "phone"]]) {
  let p = await page("http://localhost:3102/", w); await shot(p, `1-signin-${tag}`);
  await p.type('input[type="email"]', "val@example.com");
  await p.goto("http://localhost:3102/#error=access_denied&error_code=otp_expired", { waitUntil: "networkidle0" }); await sleep(200); await shot(p, `2-signin-expired-${tag}`); await p.close();
  p = await page("http://localhost:3101/", w); await sleep(200); await shot(p, `3-date-${tag}`);
  const d = new Date(Date.now() + 45 * 864e5); const v = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  await p.evaluate((v) => { const i=document.querySelector('input[type="date"]'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; set.call(i,v); i.dispatchEvent(new Event("input",{bubbles:true})); }, v);
  await sleep(200); await shot(p, `4-date-picked-${tag}`);
  await clickText(p, "Continue"); await sleep(200); await shot(p, `5-start-${tag}`); await p.close();
}
await b.close(); console.log("done");
