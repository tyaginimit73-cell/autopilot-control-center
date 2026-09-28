"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertOctagon,
  ArrowLeft,
  Bell,
  Boxes,
  ChevronRight,
  CircleDot,
  Clock,
  Cpu,
  Eraser,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Menu,
  MousePointer2,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Settings2,
  SquareTerminal,
  Terminal,
  User as UserIcon,
  Video,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { api, endpoints, useAuth, useDevices, useExecutions, useUi } from "@/lib/client";
import { cn, Badge, Button, Dropdown, IconButton, MenuItem, StatusDot, Toaster, Tooltip } from "@/components/ui";
import { triggerEmergencyStop, useEmergencyShortcut, useRealtime } from "@/hooks/use-realtime";
import type { ActivityLog } from "@autopilot/shared";

export const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/automation", label: "Automation", icon: Cpu },
  { href: "/workflows", label: "Workflows", icon: GitBranch },
  { href: "/recorder", label: "Recorder", icon: Video },
  { href: "/browser-control", label: "Browser Control", icon: CircleDot },
  { href: "/desktop-control", label: "Desktop Control", icon: MousePointer2 },
  { href: "/schedules", label: "Schedules", icon: Clock },
  { href: "/history", label: "Execution History", icon: SquareTerminal },
  { href: "/devices", label: "Devices", icon: Boxes },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

const TITLES: Record<string, string> = {
  "/dashboard": "Mission control",
  "/automation": "Automation console",
  "/workflows": "Workflow library",
  "/recorder": "Recorder",
  "/browser-control": "Browser control",
  "/desktop-control": "Desktop control",
  "/schedules": "Schedules",
  "/history": "Execution history",
  "/devices": "Devices & pairing",
  "/settings": "Settings",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const { sidebarOpen, setSidebar } = useUi();
  useRealtime(status === "ready");
  useEmergencyShortcut();

  React.useEffect(() => {
    if (status === "anon") window.location.href = "/login?next=" + encodeURIComponent(pathname || "/dashboard");
  }, [status, pathname]);

  const title = TITLES[pathname] ?? "AutoPilot";

  return (
    <div className="relative flex min-h-dvh bg-ink-950 text-mist-100">
      <div className="pointer-events-none fixed inset-0 -z-10 grid-field opacity-[0.5] radial-fade" aria-hidden />
      <div className="pointer-events-none fixed -top-40 left-1/3 -z-10 h-96 w-[46rem] rounded-full bg-signal-500/10 blur-[130px]" aria-hidden />

      <Sidebar pathname={pathname} open={sidebarOpen} onClose={() => setSidebar(false)} />

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[16.5rem]">
        <Topbar title={title} onMenu={() => setSidebar(true)} userName={user?.name ?? "Operator"} />
        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto w-full max-w-[100rem] flex-1 px-4 py-6 sm:px-6 lg:px-8"
        >
          {status === "ready" ? children : <Booting />}
        </motion.main>
        <footer className="mx-auto flex w-full max-w-[100rem] items-center justify-between gap-4 px-4 pb-6 text-[0.7rem] text-mist-500 sm:px-6 lg:px-8">
          <span>AutoPilot Control Center — local-first automation. The agent on your Windows PC performs every OS-level action.</span>
          <span className="hidden font-mono sm:inline">{pathname}</span>
        </footer>
      </div>
      <Toaster />
    </div>
  );
}

function Booting() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <div className="flex items-center gap-3 text-sm text-mist-500">
        <RefreshCw className="size-4 animate-spin" />
        Connecting to the control plane…
      </div>
    </div>
  );
}

function Sidebar({ pathname, open, onClose }: { pathname: string; open: boolean; onClose: () => void }) {
  const connection = useUi((s) => s.connection);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const devices = useDevices((s) => s.devices);
  const activeId = useDevices((s) => s.activeId);
  const setActive = useDevices((s) => s.setActive);
  const router = useRouter();

  const content = (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link href="/" className="group flex items-center gap-2.5 px-1 pt-1" aria-label="AutoPilot home">
        <span className="relative grid size-9 place-items-center rounded-xl bg-signal-400/12 ring-1 ring-signal-400/25">
          <Activity className="size-4.5 text-signal-300" />
          <span className="absolute inset-0 rounded-xl bg-signal-400/10 opacity-0 blur transition group-hover:opacity-100" />
        </span>
        <span className="leading-tight">
          <span className="block font-display text-[0.95rem] font-semibold tracking-tight">AutoPilot</span>
          <span className="block font-mono text-[0.6rem] uppercase tracking-[0.2em] text-mist-500">control center</span>
        </span>
      </Link>

      <nav aria-label="Primary" className="relative flex-1">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "relative flex items-center gap-3 rounded-lg px-3 py-2 text-[0.83rem] transition",
                    active ? "text-mist-100" : "text-mist-500 hover:bg-white/[0.04] hover:text-mist-300",
                  )}
                >
                  {active ? (
                    <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg border border-white/[0.07] bg-white/[0.05]" transition={{ type: "spring", stiffness: 340, damping: 30 }} />
                  ) : null}
                  <Icon className={cn("relative z-10 size-4", active && "text-signal-300")} />
                  <span className="relative z-10">{item.label}</span>
                  {active ? <ChevronRight className="relative z-10 ml-auto size-3.5 text-signal-300/70" /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="space-y-3">
        {devices.length > 1 ? (
          <div className="panel-flat p-2.5">
            <p className="mono-label mb-1.5 px-1">Target device</p>
            <div className="space-y-0.5">
              {devices.map((device) => (
                <button
                  key={device.id}
                  type="button"
                  onClick={() => setActive(device.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.75rem] transition",
                    device.id === activeId ? "bg-signal-400/10 text-mist-100" : "text-mist-500 hover:bg-white/[0.04]",
                  )}
                >
                  <StatusDot state={device.connected ? "online" : "offline"} size={7} />
                  <span className="truncate">{device.name}</span>
                  {device.kind === "SIMULATED" ? <Badge tone="info" className="ml-auto">sim</Badge> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <ConnectionPill connection={connection} />

        <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-soft/12 text-[0.7rem] font-semibold text-violet-soft">
            {(user?.name ?? "OP").slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.78rem] text-mist-100">{user?.name ?? "Signed out"}</span>
            <span className="block truncate text-[0.68rem] text-mist-500">{user?.role ?? "USER"}</span>
          </span>
          <IconButton
            label="Sign out"
            onClick={async () => {
              await logout();
              router.push("/login");
            }}
          >
            <LogOut className="size-3.5" />
          </IconButton>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-[16.5rem] border-r border-white/[0.06] bg-ink-900/70 backdrop-blur-xl lg:block">{content}</aside>
      <AnimatePresence>
        {open ? (
          <motion.div className="fixed inset-0 z-70 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} aria-hidden />
            <motion.aside
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="absolute inset-y-0 left-0 w-[17rem] border-r border-white/[0.08] bg-ink-900"
            >
              <div className="absolute right-3 top-3">
                <IconButton label="Close navigation" onClick={onClose}>
                  <X className="size-4" />
                </IconButton>
              </div>
              {content}
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function ConnectionPill({ connection }: { connection: ReturnType<typeof useUi.getState>["connection"] }) {
  const online = connection.socket === "online" && connection.agent === "connected";
  return (
    <Link
      href="/devices"
      className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[0.72rem] text-mist-300 transition hover:border-signal-400/30"
    >
      {online ? <Wifi className="size-3.5 text-signal-300" /> : <WifiOff className="size-3.5 text-amber-glow" />}
      <StatusDot state={online ? "online" : "warn"} size={7} />
      <span>{online ? "All systems linked" : "Agent attention needed"}</span>
    </Link>
  );
}

function Topbar({ title, onMenu, userName }: { title: string; onMenu: () => void; userName: string }) {
  const live = useExecutions((s) => s.live);
  const desktop = useDevices((s) => s.devices).find((d) => d.id === useDevices((s) => s.activeId));
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/72 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[100rem] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <IconButton label="Open navigation" className="lg:hidden" onClick={onMenu}>
          <Menu className="size-4" />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[1.05rem] font-semibold tracking-tight">{title}</h1>
          <p className="truncate text-[0.72rem] text-mist-500">
            {desktop ? `${desktop.name} · ${desktop.platform} · agent ${desktop.agentVersion}` : "No device selected"}
          </p>
        </div>

        <ExecutionTicker live={live} />
        <ConnectionPopover />
        <EmergencyStopButton />
        <Dropdown
          trigger={
            <span className="hidden size-9 cursor-pointer place-items-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-mist-300 transition hover:text-mist-100 sm:grid">
              <Bell className="size-4" />
            </span>
          }
        >
          <div className="px-2.5 py-2">
            <p className="mono-label mb-1">Session</p>
            <p className="text-[0.78rem] text-mist-300">Signed in as {userName}</p>
            <p className="mt-1 text-[0.7rem] leading-relaxed text-mist-500">Notifications for completed and failed runs are enabled per account in Settings.</p>
          </div>
        </Dropdown>
        <Link href="/" className="hidden md:block">
          <Tooltip content="Back to the product landing page">
            <span className="grid size-9 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-mist-300 transition hover:text-mist-100">
              <ArrowLeft className="size-4" />
            </span>
          </Tooltip>
        </Link>
      </div>
    </header>
  );
}

function ExecutionTicker({ live }: { live: ReturnType<typeof useExecutions.getState>["live"] }) {
  return (
    <AnimatePresence mode="wait">
      {live ? (
        <motion.div
          key={live.executionId}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="hidden items-center gap-2.5 rounded-lg border border-signal-400/25 bg-signal-400/[0.07] px-3 py-1.5 md:flex"
        >
          <Radio className="size-3.5 animate-pulse text-signal-300" />
          <span className="text-[0.74rem] text-mist-100">{live.workflowName}</span>
          <span className="font-mono text-[0.68rem] text-mist-500">
            {live.total ? `${live.index + 1}/${live.total}` : "…"} {live.actionType ? `· ${live.actionType}` : ""}
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function ConnectionPopover() {
  const connection = useUi((s) => s.connection);
  const status = useUi((s) => s.status) as {
    backend?: { state?: string; uptimeSeconds?: number };
    agent?: { state?: string; deviceName?: string; kind?: string };
    browser?: { state?: string; name?: string; tabs?: number };
  } | null;
  const rows = [
    { label: "Backend", value: status?.backend?.state === "offline" ? "Offline" : "Connected", ok: true, hint: `${Math.round((status?.backend?.uptimeSeconds ?? 0) / 60)} min uptime` },
    { label: "Socket stream", value: connection.socket === "online" ? "Live" : "Reconnecting", ok: connection.socket === "online", hint: "SSE · same-origin" },
    { label: "Agent", value: connection.agent === "connected" ? "Connected" : "Disconnected", ok: connection.agent === "connected", hint: status?.agent?.deviceName ?? "no device" },
    { label: status?.agent?.kind === "WINDOWS_AGENT" ? "Browser (Playwright)" : "Browser (virtual)", value: connection.browser === "connected" ? `Connected · ${status?.browser?.tabs ?? 0} tabs` : "Idle", ok: connection.browser === "connected", hint: status?.browser?.name ?? "Chromium" },
  ];
  const allGood = connection.socket === "online" && connection.agent === "connected";
  return (
    <Dropdown
      trigger={
        <span className="inline-flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[0.74rem] text-mist-300 transition hover:border-signal-400/30">
          <StatusDot state={allGood ? "online" : "warn"} size={7} />
          {allGood ? "Connected" : "Degraded"}
        </span>
      }
    >
      <div className="min-w-72 p-2">
        <p className="mono-label mb-2 px-1">Link status</p>
        <div className="space-y-1.5">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center gap-2.5 rounded-md bg-white/[0.02] px-2.5 py-2">
              <StatusDot state={row.ok ? "online" : "warn"} size={7} pulse={row.ok} />
              <span className="text-[0.78rem] text-mist-300">{row.label}</span>
              <span className="ml-auto text-right">
                <span className="block text-[0.78rem] text-mist-100">{row.value}</span>
                <span className="block font-mono text-[0.62rem] text-mist-500">{row.hint}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2.5 px-1 text-[0.68rem] leading-relaxed text-mist-500">
          Desktop and browser actions are executed by the agent on your machine. If the agent is offline, commands are rejected instead of being simulated.
        </p>
      </div>
    </Dropdown>
  );
}

export function EmergencyStopButton({ size = "md" }: { size?: "sm" | "md" }) {
  const active = useUi((s) => s.emergencyActive);
  const shortcut = useUi((s) => s.settings?.emergencyShortcut ?? "Ctrl+Shift+Esc");
  const live = useExecutions((s) => s.live);
  return (
    <Tooltip content={`Cancel everything and flush the agent queue · ${shortcut}`}>
      <button
        type="button"
        onClick={() => void triggerEmergencyStop()}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border font-semibold transition",
          size === "md" ? "px-3 py-2 text-[0.74rem]" : "px-2.5 py-1.5 text-[0.7rem]",
          active
            ? "animate-alert-ring border-alert-400/60 bg-alert-500/25 text-white"
            : "border-alert-500/35 bg-alert-500/12 text-[#ffb4b7] hover:border-alert-400/70 hover:bg-alert-500/20",
          live ? "shadow-[0_0_0_1px_rgba(255,90,95,0.35)]" : "",
        )}
      >
        <AlertOctagon className={cn("size-4", live && "animate-pulse")} />
        STOP ALL
      </button>
    </Tooltip>
  );
}

/* ── live console ────────────────────────────────────────────────────────── */

const levelStyle: Record<string, string> = {
  INFO: "text-mist-300",
  DEBUG: "text-mist-500",
  SUCCESS: "text-signal-300",
  WARN: "text-amber-glow",
  ERROR: "text-[#ff8f93]",
};

export function LiveConsole({ logs, className, height = "h-80", showControls = true }: { logs?: ActivityLog[]; className?: string; height?: string; showControls?: boolean }) {
  const storeLogs = useUi((s) => s.logs);
  const paused = useUi((s) => s.paused);
  const togglePaused = useUi((s) => s.togglePaused);
  const items = (logs ?? storeLogs).slice(-260);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const [filter, setFilter] = React.useState<"ALL" | "ERROR" | "SUCCESS">("ALL");

  React.useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [items.length, paused]);

  const visible = items.filter((entry) => (filter === "ALL" ? true : filter === "ERROR" ? entry.level === "ERROR" || entry.level === "WARN" : entry.level === "SUCCESS" || entry.level === "INFO"));

  return (
    <div className={cn("panel overflow-hidden", className)}>
      <div className="flex items-center gap-3 border-b border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5">
        <Terminal className="size-3.5 text-signal-300" />
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-mist-500">live execution stream</span>
        <span className="ml-auto flex items-center gap-1.5">
          {(["ALL", "ERROR", "SUCCESS"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className={cn("rounded-md px-2 py-1 font-mono text-[0.62rem] transition", filter === option ? "bg-white/[0.08] text-mist-100" : "text-mist-500 hover:text-mist-300")}
            >
              {option}
            </button>
          ))}
        </span>
        {showControls ? (
          <span className="flex items-center gap-1.5">
            <IconButton label={paused ? "Resume following" : "Pause following"} onClick={togglePaused}>
              {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            </IconButton>
            <IconButton
              label="Clear console"
              onClick={() => {
                useUi.setState({ logs: [] });
                void api.del(endpoints.logs).catch(() => undefined);
              }}
            >
              <Eraser className="size-3.5" />
            </IconButton>
            <IconButton label="Emergency stop" onClick={() => void triggerEmergencyStop()}>
              <AlertOctagon className="size-3.5 text-alert-400" />
            </IconButton>
          </span>
        ) : null}
      </div>
      <div className={cn("overflow-y-auto bg-ink-950/60 p-3 font-mono text-[0.74rem] leading-relaxed", height)} role="log" aria-live="polite">
        {visible.length === 0 ? (
          <p className="text-mist-500">Waiting for agent activity…</p>
        ) : (
          visible.map((entry) => (
            <div key={entry.id} className="flex gap-3 py-0.5">
              <span className="shrink-0 text-mist-500/80">{new Date(entry.createdAt).toLocaleTimeString("en-GB")}</span>
              <span className={cn("shrink-0", levelStyle[entry.level])}>{entry.actionType ? `[${entry.actionType}]` : ""}</span>
              <span className={cn("min-w-0 break-words", levelStyle[entry.level])}>{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      {paused ? (
        <div className="flex items-center justify-center gap-2 border-t border-white/[0.06] bg-amber-glow/[0.07] py-1.5 text-[0.68rem] text-amber-glow">
          <Pause className="size-3" /> output paused — new lines are buffered
        </div>
      ) : null}
    </div>
  );
}

export function UserAvatarMini() {
  const user = useAuth((s) => s.user);
  return (
    <span className="grid size-8 place-items-center rounded-lg bg-white/[0.05] text-mist-300">
      <UserIcon className="size-4" />
      <span className="sr-only">{user?.email}</span>
    </span>
  );
}

export function StartStopControls({ executionId, state }: { executionId: string | null; state: "RUNNING" | "PAUSED" | "STOPPING" | null }) {
  const pause = useExecutions((s) => s.pause);
  const resume = useExecutions((s) => s.resume);
  const stop = useExecutions((s) => s.stop);
  if (!executionId) return null;
  return (
    <div className="flex items-center gap-2">
      {state === "PAUSED" ? (
        <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} onClick={() => void resume(executionId)}>
          Resume
        </Button>
      ) : (
        <Button size="sm" variant="outline" icon={<Pause className="size-3.5" />} onClick={() => void pause(executionId)}>
          Pause
        </Button>
      )}
      <Button size="sm" variant="danger" icon={<SquareTerminal className="size-3.5" />} onClick={() => void stop(executionId)}>
        Stop
      </Button>
    </div>
  );
}
