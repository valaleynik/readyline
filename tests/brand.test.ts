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

  it("every text pair meets WCAG AA (4.5:1) in both themes", () => {
    const text: [string, string][] = [
      ["ink", "canvas"], ["ink", "surface"], ["ink-muted", "canvas"], ["ink-muted", "surface"],
      ["on-action", "action"], ["on-action", "action-hover"],
      ["ontrack-ink", "ontrack-tint"], ["behind-ink", "behind-tint"], ["ink-muted", "neutral-tint"],
    ];
    for (const theme of ["light", "dark"] as const)
      for (const [fg, bg] of text) expect(ratio(hex(fg, theme), hex(bg, theme)), `${fg} on ${bg} (${theme})`).toBeGreaterThanOrEqual(4.5);
  });

  it("controls and focus meet 3:1, and white never sits on copper", () => {
    for (const theme of ["light", "dark"] as const) {
      expect(ratio(hex("control-border", theme), hex("surface", theme))).toBeGreaterThanOrEqual(3);
      expect(ratio(hex("action", theme), hex("canvas", theme))).toBeGreaterThanOrEqual(3);
    }
    expect(ratio("#FFFFFF", hex("action", "light"))).toBeLessThan(4.5); // the reason on-action is dark
    expect(hex("on-action", "light")).not.toBe("#FFFFFF");
  });

  it("the site serves the same logo files as the brand folder", () => {
    for (const f of ["readyline-logo.svg", "readyline-logo-dark.svg", "readyline-mark.svg", "readyline-mark-dark.svg", "readyline-app-icon.svg"])
      expect(readFileSync(`web/public/brand/${f}`, "utf8")).toBe(readFileSync(`brand/${f}`, "utf8"));
  });
});
