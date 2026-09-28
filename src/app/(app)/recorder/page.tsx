"use client";

import * as React from "react";
import Link from "next/link";
import { EyeOff, Keyboard, MousePointer2, Scan, ShieldQuestion, Waves } from "lucide-react";
import { RecorderPanel } from "@/components/panels";
import { Badge, Card, PanelHeader, SectionLabel } from "@/components/ui";
import { LiveConsole } from "@/components/shell";
import { useDevices } from "@/lib/client";

const CAPTURED = [
  { icon: <MousePointer2 className="size-3.5" />, title: "Pointer activity", body: "Moves that end in a click, double-clicks, right-clicks, drags and scroll notches. Raw movement is summarised into the final target so replays stay fast." },
  { icon: <Keyboard className="size-3.5" />, title: "Keyboard activity", body: "Typed strings and named keys/hotkeys. Text typed into a password field is replaced with a masked placeholder." },
  { icon: <Waves className="size-3.5" />, title: "Browser activity", body: "Navigations, new tabs, tab switches, reloads and DOM click/fill targets captured through the Playwright context." },
  { icon: <EyeOff className="size-3.5" />, title: "Deliberately not captured", body: "Clipboard contents, other applications' text fields, screenshots, and anything that looks like a credential or token." },
];

export default function RecorderPage() {
  const devices = useDevices((s) => s.devices);
  const activeId = useDevices((s) => s.activeId);
  const device = devices.find((d) => d.id === activeId);
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <PanelHeader
          title="Record a workflow by doing it"
          subtitle={`Capture target: ${device?.name ?? "your device"} · ${device?.kind === "WINDOWS_AGENT" ? "OS-level input hooks + routed actions" : "routed actions (the simulated device has no global hooks)"}`}
          icon={<Scan className="size-4" />}
          action={<Badge tone="warn" dot>recording edits stay local until saved</Badge>}
        />
        <RecorderPanel />
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="p-5">
          <PanelHeader title="What the recorder captures" subtitle="The same action types as the builder, so anything recorded is editable and replayable" icon={<ShieldQuestion className="size-4" />} />
          <div className="grid gap-2 sm:grid-cols-2">
            {CAPTURED.map((item) => (
              <div key={item.title} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="flex items-center gap-2 text-[0.82rem] text-mist-100">
                  <span className="grid size-7 place-items-center rounded-md bg-signal-400/10 text-signal-300">{item.icon}</span>
                  {item.title}
                </p>
                <p className="mt-1.5 text-[0.73rem] leading-relaxed text-mist-500">{item.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[0.74rem] leading-relaxed text-mist-500">
            After you stop, the capture becomes a <span className="text-mist-300">draft workflow</span> — review the parameter values, delete the noise,
            add waits, then replay it. <Link className="text-signal-300 hover:underline" href="/workflows">Open the library →</Link>
          </p>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="px-4 py-3"><SectionLabel>Recorder stream</SectionLabel></div>
          <LiveConsole className="rounded-none border-0 shadow-none" height="h-[21.5rem]" />
        </Card>
      </div>
    </div>
  );
}
