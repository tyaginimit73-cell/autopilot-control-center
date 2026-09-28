import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AutoPilot Control Center — desktop & browser automation",
    template: "%s · AutoPilot",
  },
  description:
    "Automate your browser, desktop and repetitive workflows from one intelligent control center. A local Windows agent performs every OS-level action.",
  applicationName: "AutoPilot Control Center",
  keywords: ["desktop automation", "browser automation", "playwright", "workflow automation", "windows agent", "rpa"],
  openGraph: {
    title: "AutoPilot Control Center",
    description: "Control your digital workspace: mouse, keyboard, browser, apps, workflows, recorder and scheduler.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#05070c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-ink-950 font-body text-mist-100 antialiased">{children}</body>
    </html>
  );
}
