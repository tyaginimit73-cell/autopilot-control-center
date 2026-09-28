"use client";

import * as React from "react";
import { CircleDot, Gauge, Link2, MousePointer2 } from "lucide-react";
import { Badge, Card, PanelHeader, SectionLabel } from "@/components/ui";
import { BrowserControlPanel } from "@/components/panels";
import { LiveConsole } from "@/components/shell";
import { useBrowser, useDevices } from "@/lib/client";

export default function BrowserControlPage() {
  const tabs = useBrowser((s) => s.tabs);
  const connected = useBrowser((s) => s.connected);
  const browserName = useBrowser((s) => s.browserName);
  const device = useDevices((s) => s.devices).find((d) => d.id === useDevices.getState().activeId);

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300"><CircleDot className="size-5" /></span>
          <div>
            <p className="font-display text-[1.05rem] font-semibold">Browser control</p>
            <p className="text-[0.74rem] text-mist-500">Playwright-driven Chromium on {device?.name ?? "your device"} · DOM locators first</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Badge tone={connected ? "success" : "warn"} dot>{connected ? `${browserName} attached` : "browser not attached"}</Badge>
          <Badge tone="neutral">{tabs.length} tabs</Badge>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card className="p-5">
          <PanelHeader title="Session" subtitle="Open, switch, create, reload and close tabs; then act on the DOM" icon={<Link2 className="size-4" />} />
          <BrowserControlPanel />
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <PanelHeader title="Locator strategy" subtitle="Why coordinates are a last resort" icon={<Gauge className="size-4" />} />
            <div className="space-y-2 text-[0.76rem] leading-relaxed text-mist-500">
              <p><span className="text-mist-100">1 · role + accessible name</span> — survives markup changes and matches what a user sees.</p>
              <p><span className="text-mist-100">2 · data-testid / CSS</span> — stable when your app ships test hooks.</p>
              <p><span className="text-mist-100">3 · label / placeholder</span> — great for forms.</p>
              <p><span className="text-mist-100">4 · absolute coordinates</span> — only for canvas-like UIs; fragile at other resolutions.</p>
            </div>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-white/[0.06] bg-ink-950/70 p-3 font-mono text-[0.68rem] leading-relaxed text-mist-300">{`CLICK_ELEMENT
{
  "selectorType": "role",
  "value": "button",
  "name": "Submit",
  "timeout": 15000,
  "retries": 1
}`}</pre>
          </Card>
          <Card className="overflow-hidden p-0">
            <div className="px-4 py-3"><SectionLabel>Browser stream</SectionLabel></div>
            <LiveConsole className="rounded-none border-0 shadow-none" height="h-72" />
          </Card>
          <p className="flex items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[0.72rem] leading-relaxed text-mist-500">
            <MousePointer2 className="mt-0.5 size-3.5 shrink-0 text-signal-300" />
            Attaching to your everyday Chrome is opt-in: start it with <code className="font-mono text-mist-300">--remote-debugging-port=9222</code> and set
            <code className="font-mono text-mist-300"> BROWSER_CDP_URL</code> for the agent. Otherwise the agent launches an isolated profile it owns.
          </p>
        </div>
      </div>
    </div>
  );
}
