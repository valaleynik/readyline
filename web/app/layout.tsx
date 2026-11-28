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
import { themeScript } from "../components/brand";

export const metadata: Metadata = {
  title: { default: "Readyline: NJ Life Producer exam prep", template: "%s · Readyline" },
  description: "Adaptive prep for the New Jersey Life Producer exam, built on New Jersey insurance law. Know when you're ready to pass.",
  metadataBase: new URL("https://www.readylineprep.com"),
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8FAFC" },
    { media: "(prefers-color-scheme: dark)", color: "#0F172A" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
