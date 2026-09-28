"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, Boxes, Globe, Keyboard, KeyRound, Palette, Save, ShieldCheck, SlidersHorizontal, User as UserIcon } from "lucide-react";
import { api, endpoints, useAuth, useDevices, useUi } from "@/lib/client";
import { Badge, Button, Card, Code, Field, Input, PanelHeader, SectionLabel, Select, Toggle, cn } from "@/components/ui";
import { triggerEmergencyStop } from "@/hooks/use-realtime";
import type { AutomationSettings } from "@autopilot/shared";

export default function SettingsPage() {
  const user = useAuth((s) => s.user);
  const login = useAuth((s) => s.login);
  const settings = useUi((s) => s.settings);
  const saveSettings = useUi((s) => s.saveSettings);
  const loadSettings = useUi((s) => s.loadSettings);
  const toast = useUi((s) => s.toast);
  const devices = useDevices((s) => s.devices);
  const [draft, setDraft] = React.useState<AutomationSettings | null>(settings);
  const [capturing, setCapturing] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  React.useEffect(() => {
    void loadSettings();
  }, [loadSettings]);
  React.useEffect(() => {
    setDraft(settings);
  }, [settings]);

  // theme is applied by overriding the two darkest base tokens
  React.useEffect(() => {
    const root = document.documentElement;
    if (settings?.theme === "GRAPHITE") {
      root.style.setProperty("--color-ink-950", "#0b0d11");
      root.style.setProperty("--color-ink-900", "#12151b");
    } else {
      root.style.removeProperty("--color-ink-950");
      root.style.removeProperty("--color-ink-900");
    }
  }, [settings?.theme]);

  React.useEffect(() => {
    if (!capturing) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      const combo = [
        event.ctrlKey ? "Ctrl" : "",
        event.altKey ? "Alt" : "",
        event.shiftKey ? "Shift" : "",
        event.metaKey ? "Meta" : "",
        event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key[0]?.toUpperCase() + event.key.slice(1),
      ]
        .filter(Boolean)
        .join("+");
      if (event.key === "Escape" && combo === "Esc") {
        setCapturing(false);
        return;
      }
      setDraft((state) => (state ? { ...state, emergencyShortcut: combo } : state));
      setCapturing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capturing]);

  const save = async () => {
    if (!draft) return;
    try {
      await saveSettings(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      toast({ tone: "success", title: "Settings saved", message: "Applied to the engine, the agent and the recorder defaults" });
    } catch (error) {
      toast({ tone: "error", title: "Save failed", message: (error as Error).message });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* profile */}
        <Card className="p-5">
          <PanelHeader title="Profile" subtitle="Identity used for auditing every automation" icon={<UserIcon className="size-4" />} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input defaultValue={user?.name} readOnly className="cursor-not-allowed opacity-70" /></Field>
            <Field label="Email"><Input defaultValue={user?.email} readOnly className="cursor-not-allowed opacity-70" /></Field>
            <Field label="Role" hint="ADMIN accounts can also manage other users' devices via the API">
              <Input value={user?.role ?? "USER"} readOnly className="cursor-not-allowed opacity-70" />
            </Field>
            <Field label="Member since"><Input value={user?.createdAt ? new Date(user.createdAt).toLocaleDateString("en-GB") : "—"} readOnly className="cursor-not-allowed opacity-70" /></Field>
          </div>
          <p className="mt-3 text-[0.73rem] leading-relaxed text-mist-500">
            Profile edits and password changes are issued by re-authenticating: sign out and register again, or use the CLI task below.
          </p>
          <div className="mt-3">
            <Code title="change password (server CLI)" body={"node -e \"import('./src/lib/auth.ts').then(async ({hashPassword}) => console.log(await hashPassword(process.env.NEW_PASSWORD)))\""} />
          </div>
        </Card>

        {/* security */}
        <Card className="p-5">
          <PanelHeader title="Security" subtitle="What the control plane enforces regardless of this page" icon={<ShieldCheck className="size-4" />} />
          <ul className="space-y-2 text-[0.78rem] leading-relaxed text-mist-300">
            {[
              "Password hashing with bcrypt (cost 11); hashes are never returned by an endpoint.",
              "JWT sessions in httpOnly, SameSite=Lax cookies; 7 day expiry.",
              "Zod validation on every request body and query; 1 MB request cap.",
              "Helmet security headers and an explicit CORS allowlist (CORS_ORIGIN).",
              "Per-bucket rate limits: 12 auth attempts / 10 min, 240 automation commands / min.",
              "Device tokens stored as SHA-256 digests; pairing codes single-use, 10 minute TTL.",
              "Socket/SSE authentication per user — no cross-user event leakage.",
            ].map((item) => (
              <li key={item} className="flex gap-2.5 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-signal-400" />
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Field label="Rotate a device token">
              <Link href="/devices" className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/12 bg-white/[0.03] px-3 text-[0.8rem] text-mist-100 transition hover:border-signal-400/40">
                <Boxes className="size-4" /> {devices.length} device(s)
              </Link>
            </Field>
            <Field label="Re-authenticate to apply account changes">
              <div className="flex gap-2">
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" className="h-10 text-[0.78rem]" />
                <Input value={password} type="password" onChange={(e) => setPassword(e.target.value)} placeholder="password" className="h-10 w-28 text-[0.78rem]" />
                <Button
                  size="sm"
                  className="h-10"
                  onClick={async () => {
                    try {
                      await login(email, password);
                      toast({ tone: "success", title: "Re-authenticated", message: "A fresh session cookie was issued" });
                      setEmail(""); setPassword("");
                    } catch (error) {
                      toast({ tone: "error", title: "Re-auth failed", message: (error as Error).message });
                    }
                  }}
                >
                  <KeyRound className="size-3.5" />
                </Button>
              </div>
            </Field>
          </div>
        </Card>
      </div>

      {/* automation defaults */}
      <Card className="p-5">
        <PanelHeader title="Automation defaults" subtitle="Applied to newly created actions and ad-hoc commands" icon={<SlidersHorizontal className="size-4" />} action={<Badge tone={saved ? "success" : "neutral"} dot>{saved ? "saved" : "unsaved changes tracked locally"}</Badge>} />
        {draft ? (
          <div className="grid gap-3.5 md:grid-cols-3">
            <Field label="Default action delay (ms)" hint="Inserted before each action">
              <Input type="number" min={0} max={120000} step={10} value={draft.defaultActionDelayMs} onChange={(e) => setDraft({ ...draft, defaultActionDelayMs: Number(e.target.value) })} />
            </Field>
            <Field label="Default timeout (ms)" hint="Per-action ceiling before it is marked failed">
              <Input type="number" min={500} max={300000} step={500} value={draft.defaultActionTimeoutMs} onChange={(e) => setDraft({ ...draft, defaultActionTimeoutMs: Number(e.target.value) })} />
            </Field>
            <Field label="Default retries" hint="Failed actions re-run after 400ms">
              <Select value={String(draft.defaultRetries)} onChange={(e) => setDraft({ ...draft, defaultRetries: Number(e.target.value) })}>
                {[0, 1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </Field>
            <Toggle checked={draft.dryRunByDefault} onChange={(dryRunByDefault) => setDraft({ ...draft, dryRunByDefault })} label="Dry run by default" description="The safest development mode: the engine steps through without committing input" />
            <Toggle checked={draft.confirmDestructive} onChange={(confirmDestructive) => setDraft({ ...draft, confirmDestructive })} label="Confirm disruptive actions" description="Closing tabs or windows requires an explicit confirmation" />
            <Field label="Pointer report interval (ms)" hint="Throttle for mouse:position telemetry">
              <Input type="number" min={80} max={5000} step={20} value={draft.mouseReportIntervalMs} onChange={(e) => setDraft({ ...draft, mouseReportIntervalMs: Number(e.target.value) })} />
            </Field>
          </div>
        ) : (
          <p className="text-[0.78rem] text-mist-500">Loading settings…</p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <PanelHeader title="Keyboard shortcuts" subtitle="Only the emergency stop is bound globally" icon={<Keyboard className="size-4" />} />
          <div className="flex items-center gap-2">
            <Input readOnly value={draft?.emergencyShortcut ?? "Ctrl+Shift+Esc"} className="font-mono text-[0.78rem]" />
            <Button size="sm" variant={capturing ? "danger" : "outline"} onClick={() => setCapturing(true)}>{capturing ? "Listening…" : "Record"}</Button>
          </div>
          <p className="mt-2 text-[0.72rem] leading-relaxed text-mist-500">
            Press any modifier combination — capture stops when you press a complete combo, or <kbd className="rounded border border-white/12 bg-ink-800 px-1 font-mono text-[0.64rem]">Esc</kbd> alone to cancel.
          </p>
          <div className="mt-3 space-y-2">
            <Toggle checked={draft?.notifyOnComplete ?? true} onChange={(notifyOnComplete) => draft && setDraft({ ...draft, notifyOnComplete })} label="Toast on completion" />
            <Toggle checked={draft?.notifyOnFailure ?? true} onChange={(notifyOnFailure) => draft && setDraft({ ...draft, notifyOnFailure })} label="Toast on failure" />
          </div>
        </Card>

        <Card className="p-5">
          <PanelHeader title="Emergency stop" subtitle="Configurable + mirrored inside the agent" icon={<Bell className="size-4" />} />
          <p className="text-[0.76rem] leading-relaxed text-mist-500">
            The dashboard shortcut cancels every execution you own. The agent also watches the same combo locally, so a runaway workflow can be halted even if
            the socket is down.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="danger" onClick={() => void triggerEmergencyStop()}>Test stop now</Button>
            <Badge tone="warn">current: {draft?.emergencyShortcut ?? "Ctrl+Shift+Esc"}</Badge>
          </div>
        </Card>

        <Card className="p-5">
          <PanelHeader title="Appearance" subtitle="Dark-first, tuned for long sessions" icon={<Palette className="size-4" />} />
          <Field label="Theme">
            <Select value={draft?.theme ?? "MIDNIGHT"} onChange={(e) => draft && setDraft({ ...draft, theme: e.target.value as AutomationSettings["theme"] })}>
              <option value="MIDNIGHT">Midnight</option>
              <option value="GRAPHITE">Graphite</option>
            </Select>
          </Field>
          <p className="mt-2 text-[0.72rem] leading-relaxed text-mist-500">Motion respects <code className="font-mono text-mist-300">prefers-reduced-motion</code>; live regions use <code className="font-mono text-mist-300">aria-live</code>.</p>
        </Card>
      </div>

      <Card className="p-5">
        <PanelHeader title="Browser & agent runtime" subtitle="Environment variables the agent reads — the dashboard never sees them" icon={<Globe className="size-4" />} />
        <div className="grid gap-3 lg:grid-cols-2">
          <Code title="agent/.env" body={`SERVER_URL=${typeof window !== "undefined" ? window.location.origin.replace("5173", "4000") : "http://localhost:4000"}\nDEVICE_TOKEN=<shown once after pairing>\nDEVICE_ID=<id printed after pairing>\nDRY_RUN=1\nHEADLESS=0\nBROWSER_CDP_URL=\nEMERGENCY_SHORTCODE=Ctrl+Shift+Esc`} />
          <div className="space-y-2.5">
            <p className="text-[0.76rem] leading-relaxed text-mist-500">
              <span className="text-mist-300">DRY_RUN=1</span> keeps the agent in safe mode even if a caller requests a live command — the reverse is never true:
              a dry-run request is never upgraded.
            </p>
            <p className="text-[0.76rem] leading-relaxed text-mist-500">
              <span className="text-mist-300">BROWSER_CDP_URL</span> attaches to an already-running Chromium-family browser
              (<code className="font-mono text-mist-300">chrome.exe --remote-debugging-port=9222</code>). Leave it empty to let Playwright own an isolated profile.
            </p>
            <p className={cn("rounded-lg border px-3 py-2 text-[0.74rem]", devices.some((d) => d.connected) ? "border-signal-400/25 bg-signal-400/[0.05] text-signal-200" : "border-white/[0.06] bg-white/[0.02] text-mist-500")}>
              {devices.filter((d) => d.connected).length} device(s) currently connected · {devices.length} paired
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 hairline-t pt-4">
          <Button variant="primary" icon={<Save className="size-4" />} onClick={() => void save()}>Save settings</Button>
          <Button variant="ghost" onClick={() => setDraft(settings)}>Revert</Button>
          <span className="ml-auto text-[0.72rem] text-mist-500">Persisted per account in Postgres · <code className="font-mono">PUT {endpoints.settings}</code></span>
        </div>
      </Card>
    </div>
  );
}
