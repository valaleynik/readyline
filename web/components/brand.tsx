"use client";
import type React from "react";
/**
 * Brand pieces every page shares: the logo (light and dark files, swapped by CSS so the
 * right one shows before any script runs) and the theme switch.
 */
import { useEffect, useState } from "react";

/** The wordmark. `height` sets size; below ~96px wide use <Mark /> instead. */
export function Logo({ height = 28, href = "/" }: { height?: number; href?: string | null }) {
  const width = Math.round((573 / 126) * height);
  const imgs = (
    <>
      <img className="rl-logo rl-logo--light" src="/brand/readyline-logo.svg" alt="Readyline" width={width} height={height} />
      <img className="rl-logo rl-logo--dark" src="/brand/readyline-logo-dark.svg" alt="Readyline" width={width} height={height} />
    </>
  );
  return href ? (
    <a className="rl-logoLink" href={href} aria-label="Readyline home">
      {imgs}
    </a>
  ) : (
    <span className="rl-logoLink">{imgs}</span>
  );
}

export function Mark({ size = 24 }: { size?: number }) {
  return (
    <>
      <img className="rl-logo rl-logo--light" src="/brand/readyline-mark.svg" alt="Readyline" width={size} height={size} />
      <img className="rl-logo rl-logo--dark" src="/brand/readyline-mark-dark.svg" alt="Readyline" width={size} height={size} />
    </>
  );
}

export type ThemeChoice = "system" | "light" | "dark";
export const THEME_KEY = "readyline.theme";

/** Runs in <head> before paint so a chosen theme never flashes the other one. */
export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export function applyTheme(t: ThemeChoice) {
  const el = document.documentElement;
  if (t === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", t);
  try {
    if (t === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    /* private mode: still applies for this visit */
  }
}

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<ThemeChoice, string> = { system: "Auto", light: "Light", dark: "Dark" };

export function ThemeToggle() {
  const [t, setT] = useState<ThemeChoice>("system");
  useEffect(() => {
    try {
      const s = localStorage.getItem(THEME_KEY);
      if (s === "light" || s === "dark") setT(s);
    } catch {
      /* default */
    }
  }, []);
  return (
    <button
      className="rl-btn rl-btn--ghost rl-btn--sm"
      aria-label={`Theme: ${LABEL[t]}. Switch to ${LABEL[NEXT[t]]}.`}
      onClick={() => {
        const n = NEXT[t];
        applyTheme(n);
        setT(n);
      }}
    >
      {LABEL[t]}
    </button>
  );
}

/** The header on every page: logo left; page actions, then the theme switch, right. */
export function SiteHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="rl-header">
      <div className="rl-header__in">
        <Logo height={24} />
        <nav className="rl-header__nav">
          {children}
        </nav>
      </div>
    </header>
  );
}
