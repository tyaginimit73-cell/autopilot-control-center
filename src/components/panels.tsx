"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Circle,
  Clipboard,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  Keyboard,
  Maximize,
  Minimize,
  MousePointer2,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Scan,
  Square,
  Target,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { api, endpoints, useBrowser, useDesktop, useDevices, useExecutions, usePointer, useUi, useWorkflows } from "@/lib/client";
import { ActionIcon, Badge, Button, ConfirmDialog, Field, IconButton, Input, ProgressBar, Select, StatusDot, Tooltip, Toggle, cn } from "@/components/ui";
import type { ActivityLog, ApplicationProfile, BrowserTab, DesktopWindow, ExecutionStatus, Schedule, WorkflowAction } from "@autopilot/shared";
import { ACTION_CATALOG, describeAction } from "@autopilot/shared";

async function post(path: string, body: Record<string, unknown> = {}) {
  const deviceId = useDevices.getState().activeId;
  try {
    await api.post(path, { ...(deviceId ? { deviceId } : {}), ...body });
    await Promise.all([useDesktop.getState().load(deviceId ?? undefined), useBrowser.getState().load(deviceId ?? undefined)]);
  } catch (error) {
    useUi.getState().toast({ tone: "error", title: "Command rejected", message: (error as Error).message });
    throw error;
  }
}

/* ── pointer map: live view of the agent display ──────────────────────────── */
export function PointerMap({ onPick, interactive = true }: { onPick?: (x: number, y: number) => void; interactive?: boolean }) {
  const mouse = usePointer((s) => s.mouse);
  const ref = React.useRef<HTMLDivElement>(null);
  const [ripple, setRipple] = React.useState<{ x: number; y: number; id: number } | null>(null);
  const pctX = (mouse.x / (mouse.screenW || 1920)) * 100;
  const pctY = (mouse.y / (mouse.screenH || 1080)) * 100;

  const click = (event: React.MouseEvent) => {
    if (!interactive || !onPick) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.round(((event.clientX - rect.left) / rect.width) * (mouse.screenW || 1920));
    const y = Math.round(((event.clientY - rect.top) / rect.height) * (mouse.screenH || 1080));
    onPick(x, y);
    setRipple({ x: event.clientX - rect.left, y: event.clientY - rect.top, id: Date.now() });
  };

  return (
    <div
      ref={ref}
      onClick={click}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? "Click on the virtual display to set a pointer target" : undefined}
      onKeyDown={(event) => {
        if (event.key === "Enter" && interactive) onPick?.(mouse.x, mouse.y);
      }}
      className={cn(
        "relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-white/[0.07] bg-ink-950/80 grid-field",
        interactive && "cursor-crosshair",
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(63,220,182,0.09),transparent_65%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-signal-400/[0.06] to-transparent" />
      <div className="pointer-events-none absolute left-3 top-3 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-mist-500">
        {mouse.screenW}×{mouse.screenH} · agent display
      </div>
      <AnimatePresence>
        {ripple ? (
          <motion.span
            key={ripple.id}
            initial={{ scale: 0.3, opacity: 0.85 }}
            animate={{ scale: 2.4, opacity: 0 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute size-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-signal-400"
            style={{ left: ripple.x, top: ripple.y }}
          />
        ) : null}
      </AnimatePresence>
      <motion.div
        className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
        animate={{ left: `${pctX}%`, top: `${pctY}%` }}
        transition={{ type: "spring", stiffness: 90, damping: 18, mass: 0.6 }}
      >
        <MousePointer2 className="size-5 fill-signal-400 text-signal-200 drop-shadow-[0_0_10px_rgba(63,220,182,0.85)]" />
        <span className="absolute left-4 top-4 whitespace-nowrap rounded bg-ink-950/80 px-1.5 py-0.5 font-mono text-[0.6rem] text-signal-200">
          {mouse.x},{mouse.y}
        </span>
      </motion.div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between border-t border-white/[0.06] bg-ink-950/70 px-3 py-1.5 font-mono text-[0.62rem] text-mist-500">
        <span>pointer {pctX.toFixed(1)}% / {pctY.toFixed(1)}%</span>
        <span>{interactive ? "click to aim" : "read-only"}</span>
      </div>
    </div>
  );
}

/* ── mouse ───────────────────────────────────────────────────────────────── */
export function MouseControlPanel() {
  const mouse = usePointer((s) => s.mouse);
  const [x, setX] = React.useState(800);
  const [y, setY] = React.useState(500);
  const [duration, setDuration] = React.useState(600);
  const [dryRun, setDryRun] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);

  const send = async (label: string, type: string, parameters: Record<string, unknown> = {}) => {
    setBusy(label);
    try {
      await post("/api/desktop/mouse", { type, parameters, dryRun });
    } catch {
      /* toast already shown */
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <PointerMap onPick={(px, py) => { setX(px); setY(py); }} />
      <div className="grid grid-cols-3 gap-3">
        <Field label="X">
          <Input type="number" min={0} max={mouse.screenW} value={x} onChange={(e) => setX(Number(e.target.value))} />
        </Field>
        <Field label="Y">
          <Input type="number" min={0} max={mouse.screenH} value={y} onChange={(e) => setY(Number(e.target.value))} />
        </Field>
        <Field label="Duration (ms)" hint="0 teleports the pointer">
          <Input type="number" min={0} max={15000} step={50} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={<Target className="size-4" />} loading={busy === "move"} onClick={() => void send("move", "MOVE_MOUSE", { x, y, durationMs: duration })}>
          Move
        </Button>
        <Button icon={<MousePointer2 className="size-4" />} loading={busy === "left"} onClick={() => void send("left", "CLICK_MOUSE", { button: "left" })}>
          Left click
        </Button>
        <Button icon={<Circle className="size-4" />} loading={busy === "right"} onClick={() => void send("right", "RIGHT_CLICK_MOUSE", {})}>
          Right click
        </Button>
        <Button icon={<Scan className="size-4" />} loading={busy === "double"} onClick={() => void send("double", "DOUBLE_CLICK_MOUSE", {})}>
          Double click
        </Button>
        <span className="flex items-center gap-1">
          <IconButton label="Scroll up" onClick={() => void send("up", "SCROLL_MOUSE", { direction: "up", amount: 3 })}>
            <ArrowUp className="size-4" />
          </IconButton>
          <IconButton label="Scroll down" onClick={() => void send("down", "SCROLL_MOUSE", { direction: "down", amount: 3 })}>
            <ArrowDown className="size-4" />
          </IconButton>
        </span>
        <label className="ml-auto flex items-center gap-2 text-[0.72rem] text-mist-500">
          <button type="button" role="switch" aria-checked={dryRun} onClick={() => setDryRun(!dryRun)} className={cn("relative h-5 w-9 rounded-full transition", dryRun ? "bg-signal-400" : "bg-ink-600")}>
            <span className={cn("absolute top-0.5 size-4 rounded-full bg-ink-950 transition-all", dryRun ? "left-4.5" : "left-0.5")} />
          </button>
          Dry run
        </label>
      </div>
      <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[0.72rem] leading-relaxed text-mist-500">
        Live position: <span className="font-mono text-mist-300">{mouse.x}, {mouse.y}</span>. With dry run on, the command is validated, logged and
        executed against the device input layer without committing clicks — exactly what the agent does on Windows.
      </p>
    </div>
  );
}

/* ── keyboard ────────────────────────────────────────────────────────────── */
const QUICK_KEYS = ["ENTER", "TAB", "ESCAPE", "BACKSPACE", "SPACE", "F5", "PAGEUP", "PAGEDOWN"];
const MODIFIER_SETS: { label: string; value: string[] }[] = [
  { label: "CTRL", value: ["CTRL"] },
  { label: "CTRL+ALT", value: ["CTRL", "ALT"] },
  { label: "CTRL+SHIFT", value: ["CTRL", "SHIFT"] },
  { label: "ALT", value: ["ALT"] },
  { label: "META", value: ["META"] },
];

export function KeyboardControlPanel() {
  const [text, setText] = React.useState("AutoPilot control center");
  const [modifiers, setModifiers] = React.useState<string[]>(["CTRL"]);
  const [key, setKey] = React.useState("C");
  const [dryRun, setDryRun] = React.useState(true);
  const typedBuffer = usePointer((s) => s.typedBuffer);

  return (
    <div className="space-y-4">
      <Field label="Text to type" hint="Sent as one TYPE_TEXT command. Password-like strings are masked if captured by the recorder.">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 800))}
          rows={3}
          className="w-full resize-y rounded-lg border border-white/[0.08] bg-ink-900/70 px-3 py-2 font-mono text-[0.8rem] text-mist-100 focus:border-signal-400/50 focus:outline-none"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          icon={<Keyboard className="size-4" />}
          onClick={() => void post("/api/desktop/keyboard", { type: "TYPE_TEXT", parameters: { text, delayMs: 18 }, dryRun })}
        >
          Type text
        </Button>
        <div className="flex items-center gap-1">
          {QUICK_KEYS.map((quick) => (
            <button
              key={quick}
              type="button"
              onClick={() => void post("/api/desktop/keyboard", { type: "PRESS_KEY", parameters: { key: quick }, dryRun })}
              className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 font-mono text-[0.68rem] text-mist-300 transition hover:border-signal-400/40 hover:text-mist-100"
            >
              {quick}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-[0.72rem] text-mist-500">
          <button type="button" role="switch" aria-checked={dryRun} onClick={() => setDryRun(!dryRun)} className={cn("relative h-5 w-9 rounded-full transition", dryRun ? "bg-signal-400" : "bg-ink-600")}>
            <span className={cn("absolute top-0.5 size-4 rounded-full bg-ink-950 transition-all", dryRun ? "left-4.5" : "left-0.5")} />
          </button>
          Dry run
        </label>
      </div>

      <div className="panel-flat p-3.5">
        <p className="mono-label mb-2.5">Hotkey composer</p>
        <div className="flex flex-wrap items-center gap-2">
          {MODIFIER_SETS.map((set) => (
            <button
              key={set.label}
              type="button"
              onClick={() => setModifiers(set.value)}
              className={cn(
                "rounded-md border px-2.5 py-1 font-mono text-[0.68rem] transition",
                modifiers.join("+") === set.value.join("+") ? "border-violet-soft/50 bg-violet-soft/12 text-violet-soft" : "border-white/[0.08] text-mist-400 hover:text-mist-100",
              )}
            >
              {set.label}
            </button>
          ))}
          <span className="text-mist-500">+</span>
          <Select value={key} onChange={(e) => setKey(e.target.value)} className="h-9 w-32 text-[0.78rem]">
            {["A", "C", "V", "X", "Y", "Z", "F", "N", "P", "R", "S", "T", "W", "TAB", "ENTER", "ESCAPE", "F5"].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
          <Button
            icon={<Zap className="size-4" />}
            onClick={() => void post("/api/desktop/keyboard", { type: "HOTKEY", parameters: { modifiers, key }, dryRun })}
          >
            Send hotkey
          </Button>
        </div>
        <p className="mt-2.5 text-[0.7rem] leading-relaxed text-mist-500">
          Keys and modifiers come from a fixed allowlist — the API never accepts raw key codes, scanned codes or shell input.
        </p>
      </div>

      {typedBuffer ? (
        <div className="rounded-lg border border-white/[0.06] bg-ink-950/60 px-3 py-2 font-mono text-[0.72rem] text-mist-300">
          <span className="text-mist-500">focused field buffer › </span>
          {typedBuffer}
        </div>
      ) : null}
    </div>
  );
}

/* ── windows ─────────────────────────────────────────────────────────────── */
export function WindowCard({ window: win, onClose }: { window: DesktopWindow; onClose: (id: string) => void }) {
  const focus = useDesktop((s) => s.focus);
  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn("panel-flat p-3", win.isFocused && "border-signal-400/30 bg-signal-400/[0.05]")}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 grid size-8 place-items-center rounded-lg", win.isFocused ? "bg-signal-400/15 text-signal-300" : "bg-white/[0.04] text-mist-500")}>
          <AppGlyph name={win.processName} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[0.85rem] font-medium text-mist-100">{win.application}</p>
            {win.isFocused ? <Badge tone="success" dot>focused</Badge> : null}
            {win.state !== "normal" ? <Badge tone="neutral">{win.state}</Badge> : null}
          </div>
          <p className="truncate text-[0.72rem] text-mist-500">{win.title}</p>
          <p className="mt-0.5 font-mono text-[0.62rem] text-mist-500/70">{win.processName} · {win.id}</p>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        <Button size="sm" variant="subtle" icon={<Eye className="size-3.5" />} onClick={() => void focus(win.id, "focus")}>
          Focus
        </Button>
        <IconButton label="Minimise window" onClick={() => void focus(win.id, "minimize")}>
          <Minimize className="size-3.5" />
        </IconButton>
        <IconButton label="Maximise window" onClick={() => void focus(win.id, "maximize")}>
          <Maximize className="size-3.5" />
        </IconButton>
        <IconButton label="Close window" className="ml-auto hover:border-alert-500/50 hover:text-alert-400" onClick={() => onClose(win.id)}>
          <X className="size-3.5" />
        </IconButton>
      </div>
    </motion.div>
  );
}

function AppGlyph({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.includes("chrome") || lower.includes("edge") || lower.includes("firefox")) return <ExternalLink className="size-4" />;
  if (lower.includes("code")) return <Copy className="size-4" />;
  if (lower.includes("terminal") || lower.includes("powershell") || lower.includes("cmd")) return <Square className="size-4" />;
  if (lower.includes("explorer")) return <Plus className="size-4" />;
  return <Square className="size-4" />;
}

/* ── browser tabs ────────────────────────────────────────────────────────── */
export function BrowserTabCard({ tab, onActivate, onClose }: { tab: BrowserTab; onActivate: () => void; onClose: () => void }) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn("group flex items-center gap-3 rounded-lg border px-3 py-2.5 transition", tab.active ? "border-emerald-400/30 bg-emerald-400/[0.06]" : "border-white/[0.07] bg-white/[0.02] hover:border-white/15")}>
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white/[0.05] text-[0.65rem] font-mono text-mist-500">{tab.index + 1}</span>
      <button type="button" onClick={onActivate} className="min-w-0 flex-1 text-left">
        <p className="truncate text-[0.82rem] text-mist-100">{tab.title}</p>
        <p className="truncate font-mono text-[0.68rem] text-mist-500">{tab.url}</p>
      </button>
      {tab.status === "loading" ? <Badge tone="warn" dot>loading</Badge> : tab.active ? <Badge tone="success" dot>active</Badge> : null}
      <IconButton label={`Close ${tab.title}`} className="opacity-0 transition group-hover:opacity-100" onClick={onClose}>
        <X className="size-3.5" />
      </IconButton>
    </motion.div>
  );
}

export function BrowserControlPanel() {
  const { tabs, activeTabId, connected, browserName, load, open, switchTo, close, act, element } = useBrowser();
  const [url, setUrl] = React.useState("https://example.com");
  const [newTab, setNewTab] = React.useState(true);
  const [selectorType, setSelectorType] = React.useState("css");
  const [selector, setSelector] = React.useState('a');
  const [value, setValue] = React.useState("");
  const deviceId = useDevices((s) => s.activeId);

  React.useEffect(() => {
    void load(deviceId ?? undefined);
  }, [deviceId, load]);

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      useUi.getState().toast({ tone: "error", title: "Browser action failed", message: (error as Error).message });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5">
        <span className="flex items-center gap-2 pl-1 pr-2">
          <StatusDot state={connected ? "online" : "warn"} size={7} />
          <span className="text-[0.75rem] text-mist-300">{browserName}</span>
        </span>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} className="h-9 min-w-52 flex-1 font-mono text-[0.78rem]" placeholder="https://" />
        <Button size="sm" variant="primary" icon={<ExternalLink className="size-3.5" />} onClick={() => void run(() => open(url, newTab))}>
          Open
        </Button>
        <Toggle checked={newTab} onChange={setNewTab} label="New tab" />
        <IconButton label="Reload active tab" onClick={() => void run(() => act("reload"))}>
          <RotateCw className="size-4" />
        </IconButton>
        <IconButton label="Refresh tab list" onClick={() => void load(deviceId ?? undefined)}>
          <RefreshCw className="size-4" />
        </IconButton>
      </div>

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {tabs.map((tab) => (
            <BrowserTabCard key={tab.id} tab={tab} onActivate={() => void run(() => switchTo(tab.id))} onClose={() => void run(() => close(tab.id))} />
          ))}
        </AnimatePresence>
        {!tabs.length ? <p className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-[0.75rem] text-mist-500">No tabs — open a URL to attach the browser session.</p> : null}
      </div>

      <div className="panel-flat p-3.5">
        <p className="mono-label mb-2.5">DOM actions (preferred over pixels)</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Locator" className="w-36">
            <Select value={selectorType} onChange={(e) => setSelectorType(e.target.value)} className="h-9 text-[0.78rem]">
              {["css", "text", "role", "label", "placeholder"].map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </Select>
          </Field>
          <Field label="Selector / name" className="min-w-40 flex-1">
            <Input value={selector} onChange={(e) => setSelector(e.target.value)} className="h-9 font-mono text-[0.76rem]" />
          </Field>
          <Field label="Value (fill)" className="min-w-32 flex-1">
            <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-9 text-[0.78rem]" placeholder="search text" />
          </Field>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void run(() => element({ kind: "waitFor", selectorType, selector, name: selector }))}>Wait for</Button>
          <Button size="sm" onClick={() => void run(() => element({ kind: "click", selectorType, selector, name: selector }))}>Click</Button>
          <Button size="sm" variant="primary" onClick={() => void run(() => element({ kind: "fill", selectorType, selector, value }))}>Fill</Button>
          <span className="self-center text-[0.68rem] text-mist-500">active tab: {tabs.find((t) => t.id === activeTabId)?.title ?? "none"}</span>
        </div>
      </div>
    </div>
  );
}

/* ── applications ────────────────────────────────────────────────────────── */
export function ApplicationGrid({ profiles, onLaunch }: { profiles: ApplicationProfile[]; onLaunch: (id: string) => void }) {
  if (!profiles.length) {
    return <p className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-[0.75rem] text-mist-500">No application profiles yet — add one in Devices → Application profiles.</p>;
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {profiles.map((profile) => (
        <div key={profile.id} className="panel-flat flex items-center gap-3 p-3">
          <span className="grid size-8 place-items-center rounded-lg bg-amber-glow/12 text-amber-glow">
            <AppGlyph name={profile.executablePath} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.82rem] text-mist-100">{profile.name}</p>
            <p className="truncate font-mono text-[0.65rem] text-mist-500">{profile.executablePath}</p>
          </div>
          <Button size="sm" variant="subtle" icon={<Play className="size-3" />} onClick={() => onLaunch(profile.id)}>
            Launch
          </Button>
        </div>
      ))}
    </div>
  );
}

/* ── devices ──────────────────────────────────────────────────────────────── */
export function DeviceCard({ device, onRemove, onRotate, onRename }: { device: ReturnType<typeof useDevices.getState>["devices"][number]; onRemove: () => void; onRotate: () => void; onRename?: () => void }) {
  const [menu, setMenu] = React.useState(false);
  const active = device.id === useDevices((s) => s.activeId);
  return (
    <motion.div layout className={cn("panel p-4", active && "border-signal-400/25")}>
      <div className="flex items-start gap-3">
        <span className={cn("grid size-10 place-items-center rounded-xl", device.connected ? "bg-signal-400/12 text-signal-300" : "bg-white/[0.04] text-mist-500")}>
          <CpuIcon />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[0.9rem] font-medium text-mist-100">{device.name}</p>
            <Badge tone={device.connected ? "success" : device.status === "PAIRING" ? "info" : "warn"} dot>
              {device.connected ? "online" : device.status.toLowerCase()}
            </Badge>
          </div>
          <p className="mt-0.5 text-[0.72rem] text-mist-500">
            {device.platform} · agent {device.agentVersion} · {device.displayResolution ?? "resolution unknown"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {device.capabilities.length ? (
              device.capabilities.map((capability) => <Badge key={capability} tone="neutral">{capability}</Badge>)
            ) : (
              <Badge tone="neutral">awaiting agent</Badge>
            )}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[0.7rem] text-mist-500">
            <Clock className="size-3" /> last seen {device.lastSeen ? new Date(device.lastSeen).toLocaleTimeString("en-GB") : "never"}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant={active ? "primary" : "subtle"} onClick={() => useDevices.getState().setActive(device.id)}>
          {active ? "Target device" : "Set as target"}
        </Button>
        <Tooltip content="Issue a new device token (shown once)">
          <Button size="sm" variant="ghost" icon={<Clipboard className="size-3.5" />} onClick={onRotate}>
            Rotate
          </Button>
        </Tooltip>
        {onRename ? (
          <Tooltip content="Rename this device">
            <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={onRename}>
              Rename
            </Button>
          </Tooltip>
        ) : null}
        <Tooltip content="Unpair this device">
          <Button size="sm" variant="ghost" className="ml-auto text-[#ffb4b7]" icon={<Trash2 className="size-3.5" />} onClick={onRemove} disabled={device.kind === "SIMULATED"}>
            Remove
          </Button>
        </Tooltip>
      </div>
      {device.hasPairingCode && device.pairingCode ? (
        <div className="mt-3 rounded-lg border border-signal-400/20 bg-signal-400/[0.05] p-2.5">
          <p className="mono-label mb-1">pairing code</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-[0.85rem] tracking-widest text-signal-200">{device.pairingCode}</code>
            <IconButton label="Copy pairing code" onClick={() => void navigator.clipboard?.writeText(device.pairingCode ?? "")}>
              <Clipboard className="size-3.5" />
            </IconButton>
          </div>
          <p className="mt-1 text-[0.68rem] text-mist-500">
            Expires {device.pairingExpiresAt ? new Date(device.pairingExpiresAt).toLocaleTimeString("en-GB") : "—"}. Enter it in the agent: <code className="font-mono">npm start -- --pair {device.pairingCode}</code>
          </p>
        </div>
      ) : null}
      {menu ? <span className="sr-only">menu</span> : null}
    </motion.div>
  );
}

function CpuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-5" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </svg>
  );
}

/* ── workflows / schedules ───────────────────────────────────────────────── */
export function WorkflowCard({ workflow, onRun, onOpen }: { workflow: ReturnType<typeof useWorkflows.getState>["workflows"][number]; onRun: () => void; onOpen: () => void }) {
  const enabled = (workflow.actions ?? []).filter((a) => a.enabled).length;
  const running = useExecutions((s) => s.live?.executionId && useExecutions.getState().live?.workflowName === workflow.name);
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="panel group flex flex-col p-4 transition hover:border-signal-400/25">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[0.92rem] font-medium text-mist-100">{workflow.name}</p>
          <p className="mt-1 line-clamp-2 text-[0.74rem] leading-relaxed text-mist-500">{workflow.description || "No description"}</p>
        </button>
        <Badge tone={workflow.status === "ACTIVE" ? "success" : workflow.status === "DRAFT" ? "info" : "neutral"}>{workflow.status.toLowerCase()}</Badge>
      </div>

      <div className="mt-3 space-y-1">
        {(workflow.actions ?? []).slice(0, 3).map((action, index) => (
          <div key={action.id} className="flex items-center gap-2 text-[0.72rem] text-mist-300">
            <span className="w-4 shrink-0 text-right font-mono text-mist-500">{index + 1}</span>
            <ActionIcon name={ACTION_CATALOG[action.type]?.icon ?? "globe"} />
            <span className="truncate">{describeAction(action)}</span>
          </div>
        ))}
        {enabled > 3 ? <p className="pl-6 text-[0.7rem] text-mist-500">+ {enabled - 3} more actions</p> : null}
      </div>

      <div className="mt-3 flex items-center gap-2 hairline-t pt-3">
        <Badge tone={workflow.isDryRun ? "warn" : "error"}>{workflow.isDryRun ? "dry run" : "live"}</Badge>
        <span className="text-[0.7rem] text-mist-500">{enabled} actions</span>
        {workflow.lastRun ? (
          <span className="text-[0.7rem] text-mist-500">· last: <StatusGlyph status={workflow.lastRun.status} /></span>
        ) : (
          <span className="text-[0.7rem] text-mist-500">· never run</span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <IconButton label="Duplicate workflow" onClick={() => void useWorkflows.getState().duplicate(workflow.id)}>
            <Copy className="size-3.5" />
          </IconButton>
          <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} loading={Boolean(running)} onClick={onRun}>
            Run
          </Button>
        </span>
      </div>
    </motion.div>
  );
}

function StatusGlyph({ status }: { status: ExecutionStatus }) {
  const tone = status === "COMPLETED" ? "text-signal-300" : status === "FAILED" ? "text-alert-400" : status === "RUNNING" ? "text-amber-glow" : "text-mist-500";
  return <span className={cn("font-mono text-[0.68rem] uppercase", tone)}>{status}</span>;
}

export function ScheduleCard({ schedule, onToggle, onDelete, onRunNow }: { schedule: Schedule; onToggle: () => void; onDelete: () => void; onRunNow: () => void }) {
  const frequency =
    schedule.frequency === "DAILY"
      ? `Every day at ${schedule.timeOfDay}`
      : schedule.frequency === "WEEKLY"
        ? `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][schedule.dayOfWeek ?? 1]} at ${schedule.timeOfDay}`
        : schedule.frequency === "INTERVAL"
          ? `Every ${schedule.intervalMinutes} min`
          : schedule.frequency === "CRON"
            ? `cron ${schedule.cron}`
            : `Once at ${schedule.runAt ? new Date(schedule.runAt).toLocaleString("en-GB") : "—"}`;
  return (
    <motion.div layout className="panel-flat flex flex-wrap items-center gap-3 p-3.5">
      <span className={cn("grid size-9 place-items-center rounded-lg", schedule.enabled ? "bg-signal-400/12 text-signal-300" : "bg-white/[0.04] text-mist-500")}>
        <Clock className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.85rem] text-mist-100">{schedule.name}</p>
        <p className="truncate text-[0.72rem] text-mist-500">
          {schedule.workflowName} · {frequency} · {schedule.dryRun ? "dry run" : "live"} · if offline: {schedule.misfirePolicy.toLowerCase()}
        </p>
      </div>
      <div className="text-right">
        <p className="mono-label">next run</p>
        <p className="font-mono text-[0.72rem] text-mist-300">{schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString("en-GB", { hour12: false }) : "—"}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <IconButton label={schedule.enabled ? "Pause schedule" : "Enable schedule"} onClick={onToggle}>
          {schedule.enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </IconButton>
        <Tooltip content="Run this schedule now">
          <IconButton label="Run now" onClick={onRunNow}>
            <Zap className="size-3.5" />
          </IconButton>
        </Tooltip>
        <IconButton label="Delete schedule" className="hover:border-alert-500/50 hover:text-alert-400" onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
    </motion.div>
  );
}

/* ── recorder ────────────────────────────────────────────────────────────── */
export function RecorderPanel() {
  const [recording, setRecording] = React.useState(false);
  const [captured, setCaptured] = React.useState<WorkflowAction[]>([]);
  const [elapsed, setElapsed] = React.useState(0);
  const [name, setName] = React.useState("");
  const [mask, setMask] = React.useState(true);
  const deviceId = useDevices((s) => s.activeId);
  const router = useRouterLike();

  React.useEffect(() => {
    void api.get<{ recording: boolean; captured: WorkflowAction[] }>(`${endpoints.recorder}/state`).then((data) => {
      setRecording(data.recording);
      setCaptured(data.captured ?? []);
    }).catch(() => undefined);
  }, []);

  React.useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      setElapsed(Math.round((Date.now() - started) / 1000));
      const data = await api.get<{ captured: WorkflowAction[] }>(`${endpoints.recorder}/state`).catch(() => null);
      if (data?.captured) setCaptured(data.captured);
    }, 1000);
    return () => clearInterval(timer);
  }, [recording]);

  const start = async () => {
    try {
      await api.post(`${endpoints.recorder}/start`, { deviceId, maskSensitive: mask });
      setRecording(true);
      setCaptured([]);
      setElapsed(0);
    } catch (error) {
      useUi.getState().toast({ tone: "error", title: "Cannot start recording", message: (error as Error).message });
    }
  };

  const stop = async (createWorkflow: boolean) => {
    try {
      const data = await api.post<{ workflow: { id: string; name: string } | null; message?: string }>(`${endpoints.recorder}/stop`, { deviceId, createWorkflow, name: name || undefined });
      setRecording(false);
      if (data.workflow && createWorkflow) {
        useUi.getState().toast({ tone: "success", title: "Workflow generated", message: `${data.workflow.name} — edit it before replaying` });
        router.push(`/workflows/${data.workflow.id}`);
      } else if (data.message) {
        useUi.getState().toast({ tone: "warn", title: "Nothing captured", message: data.message });
      }
      setCaptured([]);
    } catch (error) {
      useUi.getState().toast({ tone: "error", title: "Recorder error", message: (error as Error).message });
    }
  };

  return (
    <div className="space-y-4">
      <div className={cn("relative overflow-hidden rounded-xl border p-4 transition", recording ? "border-alert-500/40 bg-alert-500/[0.06]" : "border-white/[0.07] bg-white/[0.02]")}>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-2.5">
            <span className={cn("relative grid size-10 place-items-center rounded-full", recording ? "bg-alert-500/20 text-alert-400" : "bg-white/[0.05] text-mist-500")}>
              {recording ? <span className="size-3 animate-ping rounded-full bg-alert-400/70" /> : <Scan className="size-4" />}
              <span className="absolute inset-0 grid place-items-center">{recording ? <span className="size-2 rounded-full bg-alert-400" /> : null}</span>
            </span>
            <span>
              <p className="text-[0.9rem] font-medium text-mist-100">{recording ? "Recording agent activity" : "Recorder idle"}</p>
              <p className="font-mono text-[0.7rem] text-mist-500">
                {recording ? `${elapsed}s · ${captured.length} action(s) captured` : "Start, then drive the device from any panel or workflow"}
              </p>
            </span>
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Workflow name (optional)" className="h-9 w-52 text-[0.78rem]" />
            <label className="flex items-center gap-2 text-[0.72rem] text-mist-500">
              <input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} className="size-3.5 accent-[#3fdcb6]" /> mask sensitive input
            </label>
            {!recording ? (
              <Button variant="danger" icon={<Scan className="size-4" />} onClick={() => void start()}>
                Start recording
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => void stop(false)}>Stop & review</Button>
                <Button variant="primary" icon={<Check className="size-4" />} onClick={() => void stop(true)}>Stop & save</Button>
              </>
            )}
          </span>
        </div>
        {recording ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden"><span className="block h-px w-1/3 bg-alert-400/70 animate-sweep" /></div> : null}
      </div>

      <div className="panel-flat p-3">
        <p className="mono-label mb-2">captured timeline</p>
        {captured.length ? (
          <ol className="space-y-1">
            {captured.map((action, index) => (
              <li key={action.id} className="flex items-center gap-2 text-[0.76rem] text-mist-300">
                <span className="w-5 text-right font-mono text-mist-500">{index + 1}</span>
                <ActionIcon name={ACTION_CATALOG[action.type]?.icon ?? "globe"} />
                <span className="truncate">{describeAction(action)}</span>
                <span className="ml-auto font-mono text-[0.65rem] text-mist-500">+{action.delay}ms</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-6 text-center text-[0.75rem] text-mist-500">
            Nothing captured yet. Move the pointer, type, or drive the browser while recording — every action routed to the agent becomes a workflow step.
          </p>
        )}
      </div>
    </div>
  );
}

function useRouterLike() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const push = React.useCallback((href: string) => { window.location.href = href; }, []);
  return { push };
}

/* ── execution timeline ──────────────────────────────────────────────────── */
export function ExecutionTimeline({
  steps,
  live,
  logs,
}: {
  steps: { index: number; actionType: string; status: string; message: string; attempt: number }[];
  live?: { index: number; total: number } | null;
  logs?: ActivityLog[];
}) {
  if (!steps.length) return <p className="text-[0.75rem] text-mist-500">No step data for this execution.</p>;
  return (
    <div className="relative">
      <span className="absolute left-[0.72rem] top-2 bottom-2 w-px bg-white/[0.08]" aria-hidden />
      <ol className="space-y-1.5">
        {steps.map((step, index) => {
          const tone =
            step.status === "COMPLETED" ? "text-signal-300" : step.status === "FAILED" ? "text-[#ff8f93]" : step.status === "RUNNING" ? "text-amber-glow" : "text-mist-500";
          const isActive = live?.index === index;
          return (
            <li key={`${step.index}-${step.actionType}`} className={cn("relative flex items-start gap-3 rounded-lg px-1 py-1.5 transition", isActive && "bg-white/[0.04]")}>
              <span className={cn("z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border bg-ink-950 text-[0.6rem] font-mono", tone, isActive && "border-amber-glow/50")}>
                {step.status === "COMPLETED" ? "✓" : step.status === "FAILED" ? "!" : step.index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[0.72rem] text-mist-100">{step.actionType}</span>
                  <span className={cn("text-[0.66rem] uppercase tracking-wide", tone)}>{step.status}</span>
                  {step.attempt > 1 ? <Badge tone="warn">retry {step.attempt}</Badge> : null}
                </span>
                {step.message ? <span className="mt-0.5 block break-words text-[0.72rem] text-mist-500">{step.message}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {logs?.length ? (
        <details className="mt-3 rounded-lg border border-white/[0.06] bg-ink-950/50 p-2.5">
          <summary className="cursor-pointer text-[0.72rem] text-mist-300">{logs.length} log line(s)</summary>
          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto font-mono text-[0.68rem] leading-relaxed">
            {logs.map((entry) => (
              <p key={entry.id} className={cn("break-words", levelText(entry.level))}>
                {new Date(entry.createdAt).toLocaleTimeString("en-GB")} · {entry.message}
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function levelText(level: string) {
  return level === "ERROR" ? "text-[#ff8f93]" : level === "SUCCESS" ? "text-signal-300" : level === "WARN" ? "text-amber-glow" : "text-mist-400";
}

/* ── confirm hook used by destructive device actions ─────────────────────── */
export function useConfirm() {
  const [state, setState] = React.useState<{ open: boolean; title: string; message: string; action: null | (() => void) }>({ open: false, title: "", message: "", action: null });
  const confirm = React.useCallback((title: string, message: string, action: () => void) => setState({ open: true, title, message, action }), []);
  const dialog = (
    <ConfirmDialog
      open={state.open}
      title={state.title}
      message={state.message}
      confirmLabel="Yes, do it"
      onCancel={() => setState((s) => ({ ...s, open: false }))}
      onConfirm={() => {
        state.action?.();
        setState((s) => ({ ...s, open: false }));
      }}
    />
  );
  return { confirm, dialog };
}

export { Pencil, Plus, ProgressBar, Square };
