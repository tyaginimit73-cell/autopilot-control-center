"use client";

import * as React from "react";
import { AppWindow, Ban, Cpu } from "lucide-react";
import { Badge, Card, PanelHeader, SectionLabel } from "@/components/ui";
import { DesktopControlPanel } from "@/components/desktop-panel";
import { KeyboardControlPanel, MouseControlPanel } from "@/components/panels";
import { LiveConsole } from "@/components/shell";
import { useDevices, useUi } from "@/lib/client";

export default function DesktopControlPage() {
  const devices = useDevices((s) => s.devices);
  const activeId = useDevices((s) => s.activeId);
  const device = devices.find((d) => d.id === activeId);
  const status = useUi((s) => s.status) as { agent?: { capabilities?: string[] } } | null;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-amber-glow/10 text-amber-glow"><AppWindow className="size-5" /></span>
          <div>
            <p className="font-display text-[1.05rem] font-semibold">Desktop control</p>
            <p className="text-[0.74rem] text-mist-500">
              {device?.kind === "WINDOWS_AGENT"
                ? "Real OS control through the connected agent"
                : "Simulated window manager — pair a Windows agent to control the real desktop"}
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {(status?.agent?.capabilities ?? ["mouse", "keyboard", "windows", "browser"]).map((capability) => (
            <Badge key={capability} tone={capability === "windows" ? "success" : "neutral"}>{capability}</Badge>
          ))}
          <Badge tone="warn" dot>destructive actions confirmed</Badge>
        </div>
      </Card>

      {device?.kind !== "WINDOWS_AGENT" ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-glow/25 bg-amber-glow/[0.06] p-4">
          <Ban className="mt-0.5 size-4 shrink-0 text-amber-glow" />
          <p className="text-[0.78rem] leading-relaxed text-mist-300">
            A browser page cannot move your real cursor. Everything on this page is dispatched to the agent runtime, which either drives the virtual display
            (current mode) or your actual Windows desktop once an agent is paired. Nothing here is faked in the frontend.
          </p>
        </div>
      ) : null}

      <Card className="p-5">
        <PanelHeader title="Windows & applications" subtitle="Enumerated by the agent; focus, minimise and maximise are confirmed actions" icon={<Cpu className="size-4" />} />
        <DesktopControlPanel />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <PanelHeader title="Mouse" subtitle="Absolute moves with easing, validated against the reported resolution" />
          <MouseControlPanel />
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <PanelHeader title="Keyboard" subtitle="Allowlisted keys, modifier sets and typed text" />
            <KeyboardControlPanel />
          </Card>
          <Card className="overflow-hidden p-0">
            <div className="px-4 py-3"><SectionLabel>Console</SectionLabel></div>
            <LiveConsole className="rounded-none border-0 shadow-none" height="h-64" />
          </Card>
        </div>
      </div>
    </div>
  );
}
