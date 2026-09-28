"use client";

import * as React from "react";
import { Boxes, CheckCircle2, Clipboard, KeyRound, Monitor, Plus, Terminal, Usb } from "lucide-react";
import { api, endpoints, useDevices, useUi } from "@/lib/client";
import { Badge, Button, Card, Code, ConfirmDialog, EmptyState, Field, IconButton, Input, Modal, PanelHeader, SectionLabel, Select, StatusDot, cn } from "@/components/ui";
import { DeviceCard } from "@/components/panels";
import { LiveConsole } from "@/components/shell";

export default function DevicesPage() {
  const { devices, load, loadApplications, addPairing, remove, rename, rotate, applications, addApplication, toggleApplication, removeApplication } = useDevices();
  const toast = useUi((s) => s.toast);
  const [pairing, setPairing] = React.useState<{ code: string; deviceId: string; expiresAt: string } | null>(null);
  const [newDevice, setNewDevice] = React.useState({ open: false, name: "My Windows PC", platform: "win32" });
  const [token, setToken] = React.useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ id: string; name: string } | null>(null);
  const [profile, setProfile] = React.useState({ name: "", executablePath: "", arguments: "", category: "General", enabled: true });
  const [showProfile, setShowProfile] = React.useState(false);

  React.useEffect(() => {
    void load();
    void loadApplications();
  }, [load, loadApplications]);

  const online = devices.filter((d) => d.connected).length;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-signal-400/10 text-signal-300"><Usb className="size-5" /></span>
          <div>
            <p className="font-display text-[1.05rem] font-semibold">Devices</p>
            <p className="text-[0.74rem] text-mist-500">{online} of {devices.length} connected · heartbeat 5s · offline after 16s</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setNewDevice({ ...newDevice, open: true })}>
            Add device
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-3">
          {devices.length ? (
            devices.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                onRotate={async () => {
                  try {
                    const value = await rotate(device.id);
                    setToken(value);
                  } catch (error) {
                    toast({ tone: "error", title: "Rotation failed", message: (error as Error).message });
                  }
                }}
                onRemove={() => setConfirmRemove(device.id)}
                onRename={() => setEditing({ id: device.id, name: device.name })}
              />
            ))
          ) : (
            <EmptyState icon={<Boxes className="size-5" />} title="No devices yet" message="Pair the Windows machine you want to automate. Until then, workflows run against the built-in simulated workstation." />
          )}
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <PanelHeader title="Pair the local agent" subtitle="Codes are single-use and expire after 10 minutes" icon={<Monitor className="size-4" />} />
            <ol className="space-y-3 text-[0.78rem] leading-relaxed text-mist-300">
              {[
                { title: "Install agent dependencies", body: "cd agent\nnpm.cmd install\nnpm.cmd run build" },
                { title: "Pair with a code", body: "npm.cmd start -- --pair PAIR-XXXX-XXXX" },
                { title: "Persist the token", body: 'npm.cmd run save-token -- "<token printed by the agent>"' },
                { title: "Run it as a service", body: "npm.cmd start\n# or: nssm install AutoPilotAgent …" },
              ].map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-white/[0.05] font-mono text-[0.66rem] text-signal-300">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-mist-100">{step.title}</span>
                    <pre className="mt-1 overflow-x-auto rounded-lg border border-white/[0.06] bg-ink-950/70 p-2 font-mono text-[0.68rem] text-mist-300">{step.body}</pre>
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[0.72rem] leading-relaxed text-mist-500">
              <KeyRound className="mt-0.5 size-3.5 shrink-0 text-amber-glow" />
              The agent never receives a shell endpoint. Pairing exchanges a one-time code for a device token; the server keeps only its SHA-256 digest.
            </p>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="px-4 py-3"><SectionLabel>Device events</SectionLabel></div>
            <LiveConsole className="rounded-none border-0 shadow-none" height="h-64" />
          </Card>
        </div>
      </div>

      {/* application profiles */}
      <Card className="p-5">
        <PanelHeader
          title="Application profiles"
          subtitle="OPEN_APPLICATION may only reference one of these — user-configured paths, never a raw command"
          action={
            <Button size="sm" variant="subtle" icon={<Plus className="size-3.5" />} onClick={() => setShowProfile((v) => !v)}>
              {showProfile ? "Close" : "Add profile"}
            </Button>
          }
        />
        {showProfile ? (
          <div className="mb-3 grid gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Name"><Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="Figma" /></Field>
            <Field label="Executable path" className="lg:col-span-2">
              <Input value={profile.executablePath} onChange={(e) => setProfile({ ...profile, executablePath: e.target.value })} placeholder="C:\Program Files\Figma\Figma.exe" className="font-mono text-[0.74rem]" />
            </Field>
            <Field label="Arguments"><Input value={profile.arguments} onChange={(e) => setProfile({ ...profile, arguments: e.target.value })} placeholder="--url https://figma.com" className="font-mono text-[0.74rem]" /></Field>
            <Field label="Category">
              <Select value={profile.category} onChange={(e) => setProfile({ ...profile, category: e.target.value })}>
                {["General", "Browser", "Development", "Utilities", "Office", "Design"].map((option) => <option key={option} value={option}>{option}</option>)}
              </Select>
            </Field>
            <div className="sm:col-span-2 lg:col-span-5 lg:col-start-1">
              <Button
                variant="primary"
                size="sm"
                onClick={async () => {
                  try {
                    await addApplication({ name: profile.name, executablePath: profile.executablePath, arguments: profile.arguments.split(/\s+/).filter(Boolean), enabled: profile.enabled, category: profile.category });
                    setProfile({ name: "", executablePath: "", arguments: "", category: "General", enabled: true });
                    setShowProfile(false);
                    toast({ tone: "success", title: "Profile saved", message: "Available to workflows on every device you own" });
                  } catch (error) {
                    toast({ tone: "error", title: "Profile rejected", message: (error as Error).message });
                  }
                }}
              >
                Save profile
              </Button>
            </div>
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-left text-[0.8rem]">
            <thead>
              <tr className="text-mist-500">
                {["Name", "Executable", "Arguments", "Enabled", ""].map((header) => <th key={header} className="mono-label px-2 pb-2 font-normal">{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => (
                <tr key={app.id} className="border-t border-white/[0.05]">
                  <td className="px-2 py-2.5 text-mist-100">{app.name}</td>
                  <td className="px-2 py-2.5 font-mono text-[0.72rem] text-mist-300">{app.executablePath}</td>
                  <td className="px-2 py-2.5 font-mono text-[0.7rem] text-mist-500">{app.arguments?.join(" ") || "—"}</td>
                  <td className="px-2 py-2.5">
                    <button type="button" onClick={() => void toggleApplication(app.id, !app.enabled)} className={cn("relative h-5 w-9 rounded-full transition", app.enabled ? "bg-signal-400" : "bg-ink-600")} aria-label={`Toggle ${app.name}`}>
                      <span className={cn("absolute top-0.5 size-4 rounded-full bg-ink-950 transition-all", app.enabled ? "left-4.5" : "left-0.5")} />
                    </button>
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <IconButton label={`Remove ${app.name}`} className="hover:border-alert-500/50 hover:text-alert-400" onClick={() => void removeApplication(app.id)}>
                      <Clipboard className="size-3.5 rotate-90" />
                    </IconButton>
                  </td>
                </tr>
              ))}
              {!applications.length ? <tr><td colSpan={5} className="px-2 py-6 text-center text-[0.76rem] text-mist-500">No profiles yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>

      {/* add device modal */}
      <Modal
        open={newDevice.open}
        onClose={() => setNewDevice({ ...newDevice, open: false })}
        title="Add a Windows device"
        subtitle="Name the machine, then start the agent with the generated code"
        width="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewDevice({ ...newDevice, open: false })}>Close</Button>
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  const data = await addPairing(newDevice.name, newDevice.platform);
                  setPairing(data);
                  setNewDevice({ ...newDevice, open: false });
                } catch (error) {
                  toast({ tone: "error", title: "Could not generate a code", message: (error as Error).message });
                }
              }}
            >
              Generate pairing code
            </Button>
          </>
        }
      >
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Device name"><Input autoFocus value={newDevice.name} onChange={(e) => setNewDevice({ ...newDevice, name: e.target.value })} /></Field>
          <Field label="Platform" hint="Only Windows agents ship today; macOS/Linux drivers are stubs.">
            <Select value={newDevice.platform} onChange={(e) => setNewDevice({ ...newDevice, platform: e.target.value })}>
              {["win32", "windows-11", "windows-10", "linux-x11 (experimental)"].map((option) => <option key={option} value={option}>{option}</option>)}
            </Select>
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(pairing)}
        onClose={() => setPairing(null)}
        title="Pairing code ready"
        subtitle="Enter it on the Windows machine. It is valid for 10 minutes and single-use."
        width="max-w-xl"
        footer={<Button variant="primary" onClick={() => setPairing(null)}>Done</Button>}
      >
        {pairing ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-signal-400/25 bg-signal-400/[0.06] px-4 py-3.5">
              <span className="font-mono text-[1.35rem] tracking-[0.2em] text-signal-200">{pairing.code}</span>
              <IconButton label="Copy pairing code" className="ml-auto" onClick={() => void navigator.clipboard?.writeText(pairing.code)}>
                <Clipboard className="size-4" />
              </IconButton>
            </div>
            <p className="flex items-center gap-2 text-[0.74rem] text-mist-500">
              <CheckCircle2 className="size-3.5 text-signal-300" /> expires {new Date(pairing.expiresAt).toLocaleTimeString("en-GB")} · device{" "}
              <span className="font-mono">{pairing.deviceId.slice(0, 8)}</span>
            </p>
            <Code
              title="PowerShell"
              body={[
                "cd agent",
                "npm.cmd install",
                "npm.cmd start -- --pair " + pairing.code,
              ].join("\n")}
            />
            <p className="text-[0.74rem] leading-relaxed text-mist-500">
              On success the agent prints <span className="font-mono text-mist-300">DEVICE_TOKEN=…</span> once. Store it in <span className="font-mono text-mist-300">agent/.env</span>;
              this dashboard shows only that the device is online — never the credential.
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal open={Boolean(token)} onClose={() => setToken(null)} title="New device token" subtitle="Shown once. Update agent/.env and restart the agent." width="max-w-lg"
        footer={<Button variant="primary" onClick={() => setToken(null)}>I stored it</Button>}>
        <div className="flex items-center gap-3 rounded-xl border border-amber-glow/25 bg-amber-glow/[0.06] p-3">
          <code className="min-w-0 flex-1 break-all font-mono text-[0.76rem] text-amber-glow">{token}</code>
          <IconButton label="Copy token" onClick={() => void navigator.clipboard?.writeText(token ?? "")}><Clipboard className="size-4" /></IconButton>
        </div>
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Rename device" width="max-w-md"
        footer={
          <Button variant="primary" onClick={async () => { if (editing) { await rename(editing.id, editing.name); await load(); } setEditing(null); }}>Save</Button>
        }
      >
        <Field label="Name"><Input value={editing?.name ?? ""} onChange={(e) => setEditing((state) => (state ? { ...state, name: e.target.value } : state))} /></Field>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmRemove)}
        title="Unpair this device"
        message="The agent will be unable to reconnect with its current token. Its execution history stays in the audit log."
        confirmLabel="Unpair"
        onCancel={() => setConfirmRemove(null)}
        onConfirm={async () => { if (confirmRemove) await remove(confirmRemove); setConfirmRemove(null); }}
      />
    </div>
  );
}
