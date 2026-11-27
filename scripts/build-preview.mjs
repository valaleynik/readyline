// Single-file preview build of the study loop (same component as the Next app).
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const r = await build({
  entryPoints: ["web/preview/main.tsx"], bundle: true, minify: true, write: false, format: "iife",
  jsx: "automatic", loader: { ".json": "json" }, define: { "process.env.NODE_ENV": '"production"' }, target: "es2020",
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = readFileSync("web/components/study.css", "utf8");
const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Readyline study loop</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Spectral:wght@500;600&display=swap" rel="stylesheet">
<style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
mkdirSync("dist/preview", { recursive: true });
writeFileSync("dist/preview/index.html", html);
console.log(`dist/preview/index.html ${(html.length / 1024).toFixed(0)} KB`);
