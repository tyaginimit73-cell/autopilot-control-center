"use client";

import * as React from "react";
import { AppWindow, ExternalLink, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api, useDesktop, useDevices, useUi } from "@/lib/client";
import { Badge, Button, Card, ConfirmDialog, Field, IconButton, Input, PanelHeader, Select, StatusDot, Toggle, cn } from "@/components/ui";
import { ApplicationGrid, PointerMap, WindowCard } from "@/components/panels";

/** Desktop control surface: live windows, launching configured profiles, pointer map. */
export function DesktopControlPanel() {
  const { windows, activeWindow, load, focus, kind } = useDesktop();
  const [closing, setClosing] = React.useState<string | null>(null);
  const devices = useDevices((s) => s.devices);
  const applications = useDevices((s) => s.applications);
  const activeId = useDevices((s) => s.activeId);
  const toggleApplication = useDevices((s) => s.toggleApplication);
  const removeApplication = useDevices((s) => s.removeApplication);
  const addApplication = useDevices((s) => s.addApplication);
  const toast = useUi((s) => s.toast);
  const [form, setForm] = React.useState({ name: "", executablePath: "", arguments: "", enabled: true, category: "General" });
  const [showForm, setShowForm] = React.useState(false);

  React.useEffect(() => {
    void load(activeId ?? undefined);
  }, [activeId, load]);

  const device = devices.find((d) => d.id === activeId);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <StatusDot state={device?.connected ? "online" : "warn"} size={7} />
            <p className="mono-label">visible windows {kind === "WINDOWS_AGENT" ? "(enumerated by the agent)" : "(virtual window manager)"}</p>
            <IconButton label="Refresh windows" className="ml-auto" onClick={() => void load(activeId ?? undefined)}>
              <RefreshCw className="size-3.5" />
            </IconButton>
          </div>
          <div className="space-y-2">
            {windows.map((win) => (
              <WindowCard
                key={win.id}
                window={win}
                onClose={(id) => setClosing(id)}
              />
            ))}
            {!windows.length ? (
              <p className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-[0.75rem] text-mist-500">
                No windows reported. On Windows the agent refreshes this list every 4 seconds.
              </p>
            ) : null}
          </div>
          {activeWindow ? (
            <p className="rounded-lg border border-signal-400/20 bg-signal-400/[0.05] px-3 py-2 text-[0.74rem] text-signal-200">
              Foreground: <span className="font-medium">{activeWindow.application}</span> — {activeWindow.title}
            </p>
          ) : null}
        </div>

        <div className="space-y-3">
          <PointerMap
            onPick={async (x, y) => {
              try {
                await api.post("/api/desktop/mouse", { type: "MOVE_MOUSE", parameters: { x, y, durationMs: 500 } });
                await load(activeId ?? undefined);
              } catch (error) {
                toast({ tone: "error", title: "Move rejected", message: (error as Error).message });
              }
            }}
          />
          <p className="text-[0.7rem] leading-relaxed text-mist-500">
            Click anywhere on the map to aim the pointer, then use the mouse controls. Closing a window always asks for confirmation first.
          </p>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2">
          <p className="mono-label">application profiles</p>
          <Button size="sm" variant="subtle" className="ml-auto" icon={<Plus className="size-3.5" />} onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Hide" : "Add profile"}
          </Button>
        </div>
        {showForm ? (
          <Card className="mb-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Display name" hint="Referenced by OPEN_APPLICATION actions">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Chrome" />
              </Field>
              <Field label="Executable path" hint="Full path (C:\\Program Files\\…\\app.exe) or a bare name on PATH">
                <Input value={form.executablePath} onChange={(e) => setForm({ ...form, executablePath: e.target.value })} placeholder="chrome.exe" className="font-mono text-[0.78rem]" />
              </Field>
              <Field label="Arguments" hint="Space separated, max 12">
                <Input value={form.arguments} onChange={(e) => setForm({ ...form, arguments: e.target.value })} placeholder="--new-window --app=https://linear.app" className="font-mono text-[0.78rem]" />
              </Field>
              <Field label="Category">
                <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {["General", "Browser", "Development", "Utilities", "Office"].map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Toggle checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} label="Enabled" />
              <Button
                variant="primary"
                className="ml-auto"
                onClick={async () => {
                  try {
                    await addApplication({
                      name: form.name,
                      executablePath: form.executablePath,
                      arguments: form.arguments.split(" ").filter(Boolean),
                      enabled: form.enabled,
                      category: form.category,
                    });
                    toast({ tone: "success", title: "Profile added", message: `${form.name} can now be launched by workflows` });
                    setForm({ name: "", executablePath: "", arguments: "", enabled: true, category: "General" });
                    setShowForm(false);
                  } catch (error) {
                    toast({ tone: "error", title: "Profile rejected", message: (error as Error).message });
                  }
                }}
              >
                Save profile
              </Button>
            </div>
          </Card>
        ) : null}

        <div className="grid gap-2 lg:grid-cols-2">
          {applications.map((profile) => (
            <div key={profile.id} className={cn("panel-flat flex items-center gap-3 p-3", !profile.enabled && "opacity-60")}>
              <span className="grid size-8 place-items-center rounded-lg bg-amber-glow/10 text-amber-glow"><AppWindow className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.82rem] text-mist-100">{profile.name}</p>
                <p className="truncate font-mono text-[0.66rem] text-mist-500">{profile.executablePath}{profile.arguments?.length ? ` ${profile.arguments.join(" ")}` : ""}</p>
              </div>
              <Badge tone={profile.enabled ? "success" : "neutral"}>{profile.enabled ? "enabled" : "off"}</Badge>
              <IconButton label="Toggle profile" onClick={() => void toggleApplication(profile.id, !profile.enabled)}>
                <span className={cn("block h-3.5 w-3.5 rounded-sm border", profile.enabled ? "border-signal-400 bg-signal-400/40" : "border-white/25")} />
              </IconButton>
              <IconButton label="Remove profile" className="hover:border-alert-500/50 hover:text-alert-400" onClick={() => void removeApplication(profile.id)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          ))}
          {!applications.length ? <p className="text-[0.74rem] text-mist-500">No profiles yet — add one so workflows can launch applications by id.</p> : null}
        </div>
      </div>

      <div>
        <PanelHeader title="Launch" subtitle="Only allowlisted profiles can be started — never an arbitrary path from the browser" icon={<ExternalLink className="size-4" />} />
        <ApplicationGrid
          profiles={applications.filter((p) => p.enabled)}
          onLaunch={async (id) => {
            try {
              await api.post("/api/desktop/open-application", { applicationId: id, deviceId: activeId ?? undefined });
              await load(activeId ?? undefined);
            } catch (error) {
              toast({ tone: "error", title: "Launch failed", message: (error as Error).message });
            }
          }}
        />
      </div>

      <ConfirmDialog
        open={Boolean(closing)}
        title="Close this window?"
        message="The agent will ask the application to close. Unsaved work can be lost — this confirmation is required whenever “confirm disruptive actions” is enabled in Settings."
        confirmLabel="Close window"
        onCancel={() => setClosing(null)}
        onConfirm={async () => {
          if (closing) await focus(closing, "close");
          setClosing(null);
        }}
      />
    </div>
  );
}
