"use client";

import * as React from "react";
import { Cpu, Globe, Keyboard, MousePointer2, AppWindow, ShieldAlert } from "lucide-react";
import { Badge, Card, PanelHeader, Segmented, SectionLabel } from "@/components/ui";
import { LiveConsole } from "@/components/shell";
import { BrowserControlPanel, KeyboardControlPanel, MouseControlPanel } from "@/components/panels";
import { DesktopControlPanel } from "@/components/desktop-panel";
import { useDevices, useDesktop, useUi } from "@/lib/client";

type Tab = "mouse" | "keyboard" | "browser" | "desktop";

export default function AutomationPage() {
  const [tab, setTab] = React.useState<Tab>("mouse");
  const status = useUi((s) => s.status) as { agent?: { kind?: string; state?: string } } | null;
  const device = useDevices((s) => s.devices).find((d) => d.id === useDevices((s) => s.activeId));
  const kind = status?.agent?.kind ?? device?.kind ?? "SIMULATED";

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-signal-400/10 text-signal-300"><Cpu className="size-5" /></span>
          <div>
            <p className="font-display text-[1.05rem] font-semibold">Automation console</p>
            <p className="text-[0.74rem] text-mist-500">
              One-off commands, straight to the agent. {kind === "WINDOWS_AGENT" ? "This device runs a real Windows agent — commands act on your OS." : "This device is the simulated workstation, so nothing touches your real OS."}
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Badge tone={kind === "WINDOWS_AGENT" ? "success" : "info"} dot>{kind === "WINDOWS_AGENT" ? "windows agent" : "simulated"}</Badge>
          <Badge tone="warn">dry run default</Badge>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "mouse", label: "Mouse", icon: <MousePointer2 className="size-3.5" /> },
                { value: "keyboard", label: "Keyboard", icon: <Keyboard className="size-3.5" /> },
                { value: "browser", label: "Browser", icon: <Globe className="size-3.5" /> },
                { value: "desktop", label: "Desktop", icon: <AppWindow className="size-3.5" /> },
              ]}
            />
            <span className="ml-auto text-[0.7rem] text-mist-500">every command is audited</span>
          </div>
          {tab === "mouse" ? <MouseControlPanel /> : null}
          {tab === "keyboard" ? <KeyboardControlPanel /> : null}
          {tab === "browser" ? <BrowserControlPanel /> : null}
          {tab === "desktop" ? <DesktopControlPanel /> : null}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <PanelHeader title="Agent link" subtitle="Commands are rejected while this is offline" icon={<ShieldAlert className="size-4" />} />
            <dl className="grid grid-cols-2 gap-2.5 text-[0.78rem]">
              <Row label="Device" value={device?.name ?? "—"} />
              <Row label="Status" value={device?.connected ? "online" : "offline"} tone={device?.connected ? "ok" : "warn"} />
              <Row label="Platform" value={device?.platform ?? "—"} />
              <Row label="Agent" value={device?.agentVersion ?? "—"} />
              <Row label="Automation" value={useDesktop((s) => s.automation)} />
              <Row label="Capabilities" value={(device?.capabilities ?? []).join(", ") || "—"} />
            </dl>
          </Card>
          <Card className="overflow-hidden p-0">
            <div className="px-4 py-3"><SectionLabel>Console</SectionLabel></div>
            <LiveConsole className="rounded-none border-0 shadow-none" height="h-96" />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <dt className="mono-label">{label}</dt>
      <dd className={`mt-0.5 truncate font-mono text-[0.76rem] ${tone === "ok" ? "text-signal-300" : tone === "warn" ? "text-amber-glow" : "text-mist-300"}`}>{value}</dd>
    </div>
  );
}
