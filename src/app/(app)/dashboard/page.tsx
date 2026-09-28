"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Activity, Boxes, CheckCircle2, CircleSlash, Cpu, GitBranch, Globe, MousePointer2, Pause, Play, Radio, Square, Timer, XCircle, Zap } from "lucide-react";
import { api, endpoints, useAuth, useDevices, useExecutions, usePointer, useUi, useWorkflows } from "@/lib/client";
import { Badge, Button, Card, Field, PanelHeader, ProgressBar, SectionLabel, Stat, StatusDot, cn } from "@/components/ui";
import { EmergencyStopButton, LiveConsole } from "@/components/shell";
import { PointerMap } from "@/components/panels";
import { ACTION_CATALOG, describeAction } from "@autopilot/shared";
import { ActionIcon } from "@/components/ui";

type Status = {
  agent: { state: string; deviceName: string; kind: string; lastSeen: string; capabilities: string[]; platform: string; agentVersion: string };
  browser: { state: string; name: string; tabs: number; activeTab: string | null };
  automation: { state: string; currentAction: string | null };
  device: { name: string; platform: string; os: string };
  mouse: { x: number; y: number; screenW: number; screenH: number };
  activeWindow: { application: string; title: string } | null;
  typedBuffer: string;
  runningExecutions: number;
};

export default function DashboardPage() {
  const status = useUi((s) => s.status) as Status | null;
  const live = useExecutions((s) => s.live);
  const history = useExecutions((s) => s.history);
  const start = useExecutions((s) => s.start);
  const pause = useExecutions((s) => s.pause);
  const resume = useExecutions((s) => s.resume);
  const stop = useExecutions((s) => s.stop);
  const workflows = useWorkflows((s) => s.workflows);
  const devices = useDevices((s) => s.devices);
  const activeId = useDevices((s) => s.activeId);
  const user = useAuth((s) => s.user);
  const pointer = usePointer((s) => s.mouse);
  const [stats, setStats] = React.useState<{ workflows: number; executions: number; successful: number; failed: number; devices: number; onlineDevices: number } | null>(null);

  React.useEffect(() => {
    void api.get<{ stats: NonNullable<typeof stats> }>(endpoints.stats).then((data) => setStats(data.stats)).catch(() => undefined);
  }, [live, history.length]);

  const agentOnline = status?.agent?.state === "connected";
  const currentWorkflow = live?.workflowName ?? workflows.find((w) => w.id === live?.executionId)?.name ?? null;

  return (
    <div className="space-y-5">
      {/* status strip */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Agent", value: agentOnline ? "Connected" : "Disconnected", tone: agentOnline ? "online" : "warn", icon: <Cpu className="size-4" />, hint: status ? `${status.agent.deviceName} · ${status.agent.agentVersion}` : "awaiting status" },
          { label: "Browser", value: status?.browser?.state === "connected" ? "Connected" : "Idle", tone: status?.browser?.state === "connected" ? "online" : "offline", icon: <Globe className="size-4" />, hint: status ? `${status.browser.name} · ${status.browser.tabs} tabs` : "—" },
          { label: "Automation", value: (status?.automation?.state ?? "idle").toUpperCase(), tone: status?.automation?.state === "running" ? "busy" : "online", icon: <Activity className="size-4" />, hint: status?.runningExecutions ? `${status.runningExecutions} execution(s) active` : "engine ready" },
          { label: "Device", value: status?.device?.name ?? "Windows PC", tone: agentOnline ? "online" : "offline", icon: <Boxes className="size-4" />, hint: status?.device?.platform ?? "—" },
        ].map((tile, index) => (
          <motion.div key={tile.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <SectionLabel>{tile.label}</SectionLabel>
                <span className="text-mist-500">{tile.icon}</span>
              </div>
              <p className="mt-2 flex items-center gap-2 font-display text-[1.15rem] font-semibold">
                <StatusDot state={tile.tone as never} size={8} />
                {tile.value}
              </p>
              <p className="mt-1 truncate text-[0.72rem] text-mist-500">{tile.hint}</p>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        {/* current action + pointer */}
        <Card className="p-5">
          <PanelHeader
            title="Current action"
            subtitle={live ? `Step ${live.index + 1} of ${live.total || "—"}` : "Engine idle — nothing is being driven right now"}
            icon={<MousePointer2 className="size-4" />}
            action={currentWorkflow ? <Badge tone={live?.status === "PAUSED" ? "warn" : "success"} dot>{live?.status?.toLowerCase()}</Badge> : <Badge tone="neutral">idle</Badge>}
          />
          <div className="grid gap-4 lg:grid-cols-[1fr_1.05fr]">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="panel-flat px-3 py-2.5">
                  <SectionLabel>X</SectionLabel>
                  <p className="mt-1 font-mono text-[1.35rem] tabular-nums text-signal-300">{pointer.x}</p>
                </div>
                <div className="panel-flat px-3 py-2.5">
                  <SectionLabel>Y</SectionLabel>
                  <p className="mt-1 font-mono text-[1.35rem] tabular-nums text-signal-300">{pointer.y}</p>
                </div>
              </div>
              <div className="panel-flat p-3">
                <SectionLabel className="mb-1.5">{live ? "executing" : "last executed"}</SectionLabel>
                <p className="font-mono text-[0.82rem] leading-relaxed text-mist-100">
                  {live?.actionType
                    ? `${status?.automation?.state === "idle" ? "" : "Moving mouse… "}· ${live.actionType}`
                    : status?.typedBuffer
                      ? `buffer · ${status.typedBuffer.slice(-64)}`
                      : "no command in flight"}
                </p>
                {live?.actionType ? (
                  <p className="mt-1 flex items-center gap-1.5 text-[0.72rem] text-mist-500">
                    <ActionIcon name={ACTION_CATALOG[live.actionType as keyof typeof ACTION_CATALOG]?.icon ?? "globe"} />
                    {ACTION_CATALOG[live.actionType as keyof typeof ACTION_CATALOG]?.label ?? live.actionType}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="panel-flat p-3">
                  <SectionLabel>Current application</SectionLabel>
                  <p className="mt-1 truncate text-[0.88rem] text-mist-100">{status?.activeWindow?.application ?? "—"}</p>
                  <p className="truncate text-[0.7rem] text-mist-500">{status?.activeWindow?.title ?? "no focused window reported"}</p>
                </div>
                <div className="panel-flat p-3">
                  <SectionLabel>Current browser tab</SectionLabel>
                  <p className="mt-1 truncate text-[0.88rem] text-mist-100">{status?.browser?.activeTab ?? "—"}</p>
                  <p className="truncate text-[0.7rem] text-mist-500">{status?.browser?.name ?? "Chromium"}</p>
                </div>
              </div>
              <div className="panel-flat p-3">
                <div className="flex items-center gap-2">
                  <SectionLabel>Current workflow</SectionLabel>
                  <span className="ml-auto font-mono text-[0.68rem] text-mist-500">{live?.executionId?.slice(0, 8) ?? "none"}</span>
                </div>
                <p className="mt-1 truncate text-[0.88rem] text-mist-100">{currentWorkflow ?? "Daily Research Routine"}</p>
                <ProgressBar className="mt-2" value={live && live.total ? (live.index + 1) / live.total : 0} tone={live?.status === "PAUSED" ? "warn" : "signal"} />
                <p className="mt-1.5 text-[0.7rem] text-mist-500">
                  {live ? `${live.index + 1}/${live.total} actions · ${live.message || "running"}` : "Pick a workflow below to start one"}
                </p>
                {live ? (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {live.status === "PAUSED" ? (
                      <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} onClick={() => void resume(live.executionId)}>Resume</Button>
                    ) : (
                      <Button size="sm" variant="outline" icon={<Pause className="size-3.5" />} onClick={() => void pause(live.executionId)}>Pause</Button>
                    )}
                    <Button size="sm" variant="danger" icon={<Square className="size-3.5" />} onClick={() => void stop(live.executionId)}>Stop</Button>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="space-y-2">
              <PointerMap interactive={false} />
              <p className="text-[0.7rem] leading-relaxed text-mist-500">
                This map mirrors the agent&apos;s display: pointer telemetry is throttled to 250ms and rendered from a dedicated store, so the rest of the
                dashboard never re-renders while the cursor moves.
              </p>
            </div>
          </div>
        </Card>

        {/* quick runs + stats */}
        <div className="space-y-4">
          <Card className="p-5">
            <PanelHeader title="Statistics" subtitle="Live counters from the control plane" icon={<Timer className="size-4" />} />
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Workflows" value={stats?.workflows ?? workflows.length} icon={<GitBranch className="size-4" />} />
              <Stat label="Executions" value={stats?.executions ?? history.length} icon={<Radio className="size-4" />} />
              <Stat label="Successful" value={stats?.successful ?? 0} tone="signal" icon={<CheckCircle2 className="size-4" />} />
              <Stat label="Failed" value={stats?.failed ?? 0} tone={stats?.failed ? "error" : undefined} icon={<XCircle className="size-4" />} />
              <Stat label="Active devices" value={devices.filter((d) => d.connected).length} hint={`${devices.length} paired`} icon={<Boxes className="size-4" />} />
              <Stat label="Agent" value={agentOnline ? "Online" : "Offline"} tone={agentOnline ? "signal" : "warn"} hint={status?.agent?.platform ?? "win32"} icon={<Cpu className="size-4" />} />
            </div>
          </Card>

          <Card className="p-5">
            <PanelHeader
              title="Run a workflow"
              subtitle={`Signed in as ${user?.email ?? "operator"} · target ${devices.find((d) => d.id === activeId)?.name ?? "auto"}`}
              icon={<Zap className="size-4" />}
              action={<Link href="/workflows" className="text-[0.72rem] text-signal-300 hover:underline">library →</Link>}
            />
            <div className="space-y-1.5">
              {workflows.slice(0, 4).map((workflow) => (
                <div key={workflow.id} className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 transition hover:border-signal-400/25">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.82rem] text-mist-100">{workflow.name}</span>
                    <span className="block truncate font-mono text-[0.66rem] text-mist-500">{(workflow.actions ?? []).slice(0, 2).map((a) => describeAction(a)).join(" → ")}</span>
                  </span>
                  <Badge tone={workflow.isDryRun ? "warn" : "error"}>{workflow.isDryRun ? "dry" : "live"}</Badge>
                  <Button
                    size="sm"
                    variant="subtle"
                    icon={<Play className="size-3" />}
                    onClick={() => void start(workflow.id, activeId ?? undefined).catch((error: Error) => useUi.getState().toast({ tone: "error", title: "Cannot start", message: error.message }))}
                  >
                    Run
                  </Button>
                </div>
              ))}
              {!workflows.length ? <p className="py-6 text-center text-[0.75rem] text-mist-500">No workflows yet — create one in the library.</p> : null}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-2 px-4 py-3">
            <SectionLabel>Live activity</SectionLabel>
            <span className="inline-flex items-center gap-1.5 text-[0.7rem] text-mist-500">
              <StatusDot state="online" size={6} /> streaming
            </span>
            <Link href="/history" className={cn("ml-auto text-[0.72rem] text-signal-300 hover:underline")}>execution history →</Link>
          </div>
          <LiveConsole className="rounded-none border-0 bg-transparent shadow-none" height="h-72" />
        </Card>

        <Card className="p-5">
          <PanelHeader title="Safety" subtitle="Cancellation is cooperative between actions and immediate for queued input" icon={<CircleSlash className="size-4" />} />
          <div className="space-y-2.5">
            <div className="rounded-lg border border-alert-500/25 bg-alert-500/[0.06] p-3">
              <p className="text-[0.8rem] text-mist-100">Global stop</p>
              <p className="mt-1 text-[0.72rem] leading-relaxed text-mist-500">
                Cancels every execution on every device you own, flushes the agent queue and writes an audit entry. Shortcut:{" "}
                <kbd className="rounded border border-white/12 bg-ink-800 px-1.5 py-0.5 font-mono text-[0.66rem]">{useUi.getState().settings?.emergencyShortcut ?? "Ctrl+Shift+Esc"}</kbd>
              </p>
              <div className="mt-2.5"><EmergencyStopButton size="sm" /></div>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="text-[0.8rem] text-mist-100">Dry run is the default</p>
              <p className="mt-1 text-[0.72rem] leading-relaxed text-mist-500">
                Steps validate, log and advance, but no click or keystroke is committed. Toggle per workflow, per command or globally in Settings.
              </p>
              <Link href="/settings" className="mt-2 inline-block text-[0.72rem] text-signal-300 hover:underline">automation defaults →</Link>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="text-[0.8rem] text-mist-100">Recent runs</p>
              <ul className="mt-2 space-y-1.5">
                {history.slice(0, 4).map((execution) => (
                  <li key={execution.id}>
                    <Link href={`/history/${execution.id}`} className="flex items-center gap-2 text-[0.74rem] text-mist-300 transition hover:text-mist-100">
                      <StatusDot state={execution.status === "COMPLETED" ? "online" : execution.status === "FAILED" ? "warn" : "busy"} size={6} />
                      <span className="min-w-0 flex-1 truncate">{execution.workflowName}</span>
                      <span className="font-mono text-[0.64rem] text-mist-500">{execution.durationMs ? `${(execution.durationMs / 1000).toFixed(1)}s` : execution.status.toLowerCase()}</span>
                    </Link>
                  </li>
                ))}
                {!history.length ? <li className="text-[0.74rem] text-mist-500">No executions recorded yet.</li> : null}
              </ul>
            </div>
          </div>
        </Card>
      </div>

      <p className="sr-only">{`Agent ${agentOnline ? "connected" : "disconnected"}. Automation ${(status?.automation?.state ?? "idle")}.`}</p>
      <span className="hidden">{ACTION_CATALOG.MOVE_MOUSE.label}</span>
    </div>
  );
}
