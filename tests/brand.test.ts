import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error plain JS module
import { tokensCss } from "../scripts/build-tokens.mjs";

const tokens = JSON.parse(readFileSync("brand/tokens.json", "utf8"));

function hex(name: string, theme: "light" | "dark"): string {
  const t = tokens.color.tokens.find((c: { name: string }) => c.name === name);
  if (!t) throw new Error(`no token ${name}`);
  const v: string = typeof t.value === "string" ? t.value : (t.value[theme] ?? t.value.light);
  return v.startsWith("{") ? hex(v.slice(1, -1), theme) : v;
}
function lum(h: string) {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

describe("brand", () => {
  it("the generated stylesheets match the tokens (run: npm run tokens)", () => {
    expect(readFileSync("web/styles/tokens.css", "utf8")).toBe(tokensCss(tokens));
    expect(readFileSync("web/styles/components.css", "utf8")).toContain(readFileSync("brand/components.css", "utf8"));
  });

  it("every text pair meets WCAG AA (4.5:1)", () => {
    const text: [string, string][] = [
      ["ink", "canvas"], ["ink", "surface"], ["ink-muted", "canvas"], ["ink-muted", "surface"],
      ["on-action", "action"], ["on-action", "action-hover"], ["action-ink", "action-tint"],
      ["ontrack-ink", "ontrack-tint"], ["ontrack-ink", "canvas"], ["behind-ink", "behind-tint"], ["behind-ink", "canvas"],
      ["ink-muted", "neutral-tint"], ["ink-inverse-muted", "brand-midnight"], ["ink-inverse", "brand-midnight"],
    ];
    for (const [fg, bg] of text) expect(ratio(hex(fg, "light"), hex(bg, "light")), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it("controls and the action color meet 3:1 against where they sit", () => {
    expect(ratio(hex("control-border", "light"), hex("surface", "light"))).toBeGreaterThanOrEqual(3);
    expect(ratio(hex("control-border", "light"), hex("field", "light"))).toBeGreaterThanOrEqual(3);
    expect(ratio(hex("action", "light"), hex("canvas", "light"))).toBeGreaterThanOrEqual(3);
    expect(ratio(hex("action", "light"), hex("surface", "light"))).toBeGreaterThanOrEqual(3);
  });

  it("the site serves the same logo files as the brand folder", () => {
    for (const f of ["readyline-logo.svg", "readyline-logo-dark.svg", "readyline-mark.svg", "readyline-mark-dark.svg", "readyline-app-icon.svg"])
      expect(readFileSync(`web/public/brand/${f}`, "utf8")).toBe(readFileSync(`brand/${f}`, "utf8"));
  });
});
