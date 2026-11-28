import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "../styles/tokens.css";
import "../styles/components.css";
import "../styles/base.css";
import "../components/study.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: { default: "Readyline: NJ Life Producer exam prep", template: "%s · Readyline" },
  description: "Adaptive prep for the New Jersey Life Producer exam, built on New Jersey insurance law. Know when you're ready to pass.",
  metadataBase: new URL("https://www.readylineprep.com"),
};

export const viewport: Viewport = {
  // Light only for now (decided 2026-11-27); dark tokens are kept in the design system for later.
  themeColor: "#FFFFFF",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
