import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { applicationProfiles } from "@/db/schema";
import { log, publish } from "@/lib/events";
import { captureAction, ensureDeviceRuntime, type DeviceLink, type DeviceRuntime } from "@/lib/runtime/host";
import { ACTION_CATALOG, ERROR_MESSAGES, type ActionParams, type AgentCommand, type AgentCommandResult, type BrowserTab, type DesktopWindow } from "@autopilot/shared";

/**
 * Simulated workstation.
 *
 * This is a *real* agent runtime — it implements the exact same DeviceLink
 * interface, the same command allowlist and the same result protocol as the
 * standalone Windows agent in /agent. The difference is the driver behind it:
 * instead of moving the physical pointer it drives a virtual display, a virtual
 * window manager and a virtual DOM. That is what makes the whole platform
 * (engine, pause/resume/stop, retries, history, scheduling, recorder) verifiable
 * inside a browser sandbox, while a Windows PC can take the same device slot and
 * perform the same commands on the real OS.
 *
 * DRY RUN is honoured here too: with `dryRun: true` nothing mutates the virtual
 * input layer state that a user would notice as "committed" (typing / clicking),
 * and the log lines are prefixed with [DRY RUN].
 */

interface VirtualElement {
  selector: string;
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  kind: "button" | "input" | "link" | "heading";
  value?: string;
  navigatesTo?: { url: string; title: string };
}

interface SiteSpec {
  host: string;
  title: string;
  elements: VirtualElement[];
}

const SITES: Record<string, SiteSpec> = {
  "example.com": {
    host: "example.com",
    title: "Example Domain",
    elements: [
      { selector: "h1", role: "heading", name: "Example Domain", kind: "heading" },
      { selector: "a", role: "link", name: "More information...", kind: "link", navigatesTo: { url: "https://www.iana.org/help/example-domains", title: "Example Domains IANA" } },
    ],
  },
  "youtube.com": {
    host: "youtube.com",
    title: "YouTube",
    elements: [
      { selector: "#search", kind: "input", placeholder: "Search", label: "Search" },
      { selector: "button[data-testid=search-button]", role: "button", name: "Search", kind: "button", navigatesTo: { url: "https://www.youtube.com/results", title: "YouTube Results" } },
      { selector: "button[aria-label=Subscribe]", role: "button", name: "Subscribe", kind: "button" },
    ],
  },
  "google.com": {
    host: "google.com",
    title: "Google",
    elements: [
      { selector: "#APjFqb", role: "combobox", name: "Search", kind: "input", label: "Search" },
      { selector: "button[jsname=gBCfke]", role: "button", name: "Google Search", kind: "button", navigatesTo: { url: "https://www.google.com/search", title: "Google Search Results" } },
    ],
  },
  "github.com": {
    host: "github.com",
    title: "GitHub",
    elements: [
      { selector: 'button[data-testid="login"]', role: "button", name: "Sign in", kind: "button" },
      { selector: "#login_field", kind: "input", label: "Username or email address" },
      { selector: "#password", kind: "input", label: "Password" },
    ],
  },
  "autopilot.dev/inbox": {
    host: "autopilot.dev/inbox",
    title: "Inbox — AutoPilot",
    elements: [
      { selector: "#compose", role: "button", name: "New message", kind: "button" },
      { selector: "#subject", kind: "input", label: "Subject" },
    ],
  },
};

const DEMO_WINDOWS: Omit<DesktopWindow, "isFocused">[] = [
  { id: "win-chrome", application: "Chrome", title: "YouTube — Google Chrome", processName: "chrome.exe", state: "normal" },
  { id: "win-vscode", application: "Visual Studio Code", title: "automation.ts — autopilot-control-center", processName: "Code.exe", state: "normal" },
  { id: "win-terminal", application: "Windows Terminal", title: "Agent — powershell", processName: "WindowsTerminal.exe", state: "normal" },
  { id: "win-notepad", application: "Notepad", title: "runbook.txt - Notepad", processName: "notepad.exe", state: "minimized" },
  { id: "win-explorer", application: "File Explorer", title: "Downloads", processName: "explorer.exe", state: "normal" },
];

export class SimulatedWorkstation implements DeviceLink {
  readonly kind = "SIMULATED" as const;
  readonly deviceId: string;
  private runtime: DeviceRuntime;
  private userId: string;
  private animTimer: NodeJS.Timeout | null = null;
  private ambientTimer: NodeJS.Timeout | null = null;
  private busy = false;
  private recorderActive = false;

  constructor(deviceId: string, userId: string) {
    this.deviceId = deviceId;
    this.userId = userId;
    this.runtime = ensureDeviceRuntime(deviceId, userId, "SIMULATED");
    this.resetState();
    this.ambient();
  }

  private resetState() {
    const [w, h] = [1920, 1080];
    const tabs: BrowserTab[] = [
      { id: "tab-1", title: "YouTube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", active: true, index: 0, status: "idle" },
      { id: "tab-2", title: "Inbox — AutoPilot", url: "https://autopilot.dev/inbox", active: false, index: 1, status: "idle" },
      { id: "tab-3", title: "GitHub", url: "https://github.com/login", active: false, index: 2, status: "idle" },
    ];
    const windows: DesktopWindow[] = DEMO_WINDOWS.map((win, i) => ({ ...win, isFocused: i === 0 }));
    this.runtime.state = {
      deviceId: this.runtime.deviceId,
      mouse: { x: 960, y: 540, screenW: w, screenH: h, at: Date.now() },
      activeWindow: windows[0] ?? null,
      windows,
      tabs,
      activeTabId: "tab-1",
      browserConnected: true,
      browserName: "Chromium (Playwright)",
      automation: "IDLE",
      typedBuffer: "",
    };
    this.runtime.capabilities = ["mouse", "keyboard", "windows", "browser", "recorder"];
  }

  get state() {
    return this.runtime.state;
  }

  private emitMouse() {
    publish("mouse:position", { deviceId: this.runtime.deviceId, ...this.runtime.state.mouse }, this.userId);
  }

  private emitWindows() {
    publish(
      "window:updated",
      { deviceId: this.runtime.deviceId, windows: this.state.windows, activeWindow: this.state.activeWindow },
      this.userId,
    );
  }

  private emitBrowser() {
    publish(
      "browser:updated",
      {
        deviceId: this.runtime.deviceId,
        tabs: this.state.tabs,
        activeTabId: this.state.activeTabId,
        browserConnected: this.state.browserConnected,
        browserName: this.state.browserName,
      },
      this.userId,
    );
  }

  /** subtle idle drift so the live pointer read-out reflects a running machine */
  private ambient() {
    if (this.ambientTimer) clearInterval(this.ambientTimer);
    this.ambientTimer = setInterval(() => {
      if (this.busy) return;
      const m = this.state.mouse;
      const nx = clamp(Math.round(m.x + (Math.random() * 14 - 7)), 8, m.screenW - 8);
      const ny = clamp(Math.round(m.y + (Math.random() * 14 - 7)), 8, m.screenH - 8);
      if (nx === m.x && ny === m.y) return;
      this.state.mouse = { ...m, x: nx, y: ny, at: Date.now() };
      this.emitMouse();
    }, 1600);
    this.ambientTimer.unref?.();
  }

  private animateTo(x: number, y: number, durationMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (this.animTimer) clearInterval(this.animTimer);
      const start = { ...this.state.mouse };
      const steps = Math.max(1, Math.round(durationMs / 45));
      let i = 0;
      this.animTimer = setInterval(() => {
        i += 1;
        const t = Math.min(1, i / steps);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        this.state.mouse = {
          ...start,
          x: Math.round(start.x + (x - start.x) * eased),
          y: Math.round(start.y + (y - start.y) * eased),
          at: Date.now(),
        };
        this.emitMouse();
        if (t >= 1 || signal?.aborted) {
          if (this.animTimer) clearInterval(this.animTimer);
          this.animTimer = null;
          resolve();
        }
      }, 45);
      this.animTimer.unref?.();
    });
  }

  emergencyStop() {
    if (this.animTimer) clearInterval(this.animTimer);
    this.animTimer = null;
    this.busy = false;
    this.state.automation = "IDLE";
  }

  setRecorder(active: boolean) {
    this.recorderActive = active;
  }

  close() {
    if (this.animTimer) clearInterval(this.animTimer);
    if (this.ambientTimer) clearInterval(this.ambientTimer);
    this.animTimer = null;
    this.ambientTimer = null;
  }

  async send(command: AgentCommand): Promise<AgentCommandResult> {
    const started = Date.now();
    const p = command.parameters ?? {};
    const dry = command.dryRun;
    const fail = (message: string) => ({ commandId: command.id, ok: false, message, durationMs: Date.now() - started });
    const ok = (message: string, data?: Record<string, unknown>) => ({
      commandId: command.id,
      ok: true,
      message: dry ? `[DRY RUN] ${message}` : message,
      durationMs: Date.now() - started,
      data,
    });

    if (!ACTION_CATALOG[command.type]) return fail(`Command "${command.type}" is not in the agent allowlist`);

    // Virtual pointer/keyboard input is skipped entirely in dry-run mode; the
    // result is reported so the engine keeps the run moving and the console shows
    // exactly what *would* have happened.
    const skipInput = dry;

    try {
      this.busy = true;
      switch (command.type) {
        case "MOVE_MOUSE": {
          const x = num(p.x, 0);
          const y = num(p.y, 0);
          if (x < 0 || y < 0 || x > this.state.mouse.screenW || y > this.state.mouse.screenH) {
            return fail(ERROR_MESSAGES.INVALID_COORDINATE);
          }
          if (!skipInput) await this.animateTo(x, y, num(p.durationMs, 500));
          return ok(`Move mouse → ${x},${y} in ${num(p.durationMs, 500)}ms`, { x, y });
        }
        case "CLICK_MOUSE":
        case "DOUBLE_CLICK_MOUSE":
        case "RIGHT_CLICK_MOUSE": {
          const button = command.type === "RIGHT_CLICK_MOUSE" ? "right" : (p.button ?? "left");
          if (p.x !== undefined && p.y !== undefined && !skipInput) await this.animateTo(num(p.x, 0), num(p.y, 0), 220);
          if (!skipInput) this.recordClick();
          return ok(`${command.type === "DOUBLE_CLICK_MOUSE" ? "Double" : command.type === "RIGHT_CLICK_MOUSE" ? "Right" : "Left"} click → ${this.state.mouse.x},${this.state.mouse.y}`);
        }
        case "SCROLL_MOUSE": {
          const dir = p.direction ?? "down";
          const amount = num(p.amount, 3);
          if (!skipInput) {
            this.state.mouse = { ...this.state.mouse, y: clamp(this.state.mouse.y + (dir === "down" ? amount * 24 : -amount * 24), 0, this.state.mouse.screenH), at: Date.now() };
            this.emitMouse();
          }
          return ok(`Scroll ${dir} ×${amount}`);
        }
        case "DRAG_MOUSE": {
          const from = { x: num(p.x, 0), y: num(p.y, 0) };
          const to = { x: num(p.toX, 0), y: num(p.toY, 0) };
          if (!skipInput) {
            await this.animateTo(from.x, from.y, num(p.durationMs, 500) / 2);
            await this.animateTo(to.x, to.y, num(p.durationMs, 500) / 2);
          }
          return ok(`Drag (${from.x},${from.y}) → (${to.x},${to.y})`);
        }
        case "TYPE_TEXT": {
          const text = String(p.text ?? "");
          if (!text) return fail("Nothing to type");
          if (!skipInput) {
            this.state.typedBuffer = (this.state.typedBuffer + text).slice(-160);
            const focused = this.state.tabs.find((t) => t.id === this.state.activeTabId);
            if (focused) {
              const field = this.findField(focused, (el) => el.kind === "input");
              if (field) field.value = (field.value ?? "") + text;
            }
          }
          return ok(`Typed ${text.length} character${text.length === 1 ? "" : "s"}`, { length: text.length });
        }
        case "PRESS_KEY":
        case "HOTKEY": {
          const key = String(p.key ?? "ENTER");
          const mods = (p.modifiers ?? []).length ? `${(p.modifiers ?? []).join("+")}+${key}` : key;
          if (mods.includes("Alt") || mods.includes("ALT")) this.cycleFocus();
          return ok(`Pressed ${mods}`);
        }
        case "OPEN_URL": {
          const url = String(p.url ?? "");
          const parsed = safeUrl(url);
          if (!parsed) return fail(ERROR_MESSAGES.INVALID_SELECTOR);
          if (dry) return ok(`Open URL → ${url}`);
          const tab = p.newTab ? this.newTab(url, parsed.title) : this.navigateActive(url, parsed.title);
          this.emitBrowser();
          return ok(`Navigated to ${url}`, { tabId: tab.id });
        }
        case "NEW_TAB": {
          const url = String(p.url ?? "about:blank");
          const parsed = safeUrl(url);
          const tab = this.newTab(url, parsed?.title ?? "New tab");
          this.emitBrowser();
          return ok(`Opened tab ${tab.id}`, { tabId: tab.id });
        }
        case "SWITCH_BROWSER_TAB": {
          const ref = String(p.tabId ?? "0");
          const tab = this.resolveTab(ref);
          if (!tab) return fail(`No browser tab matching "${ref}"`);
          this.state.tabs = this.state.tabs.map((t) => ({ ...t, active: t.id === tab.id }));
          this.state.activeTabId = tab.id;
          this.emitBrowser();
          return ok(`Switched to ${tab.title}`);
        }
        case "RELOAD_TAB": {
          const tab = this.activeTab();
          if (!tab) return fail(ERROR_MESSAGES.BROWSER_UNAVAILABLE);
          this.state.tabs = this.state.tabs.map((t) => (t.id === tab.id ? { ...t, status: "loading" } : t));
          this.emitBrowser();
          if (!skipInput) {
            await delay(420);
            this.state.tabs = this.state.tabs.map((t) => (t.id === tab.id ? { ...t, status: "idle" } : t));
            this.emitBrowser();
          }
          return ok(`Reloaded ${tab.title}`);
        }
        case "CLOSE_TAB": {
          const tab = this.resolveTab(String(p.tabId ?? "")) ?? this.activeTab();
          if (!tab) return fail("There is no tab to close");
          if (this.state.tabs.length <= 1) return fail("Refusing to close the last remaining tab");
          const remaining = this.state.tabs.filter((t) => t.id !== tab.id);
          this.state.tabs = remaining.map((t, i) => ({ ...t, index: i, active: i === 0 }));
          this.state.activeTabId = remaining[0]?.id ?? null;
          this.emitBrowser();
          return ok(`Closed ${tab.title}`);
        }
        case "WAIT_FOR_PAGE": {
          const tab = this.activeTab();
          if (!tab) return fail(ERROR_MESSAGES.BROWSER_UNAVAILABLE);
          return ok(`Page ready (${p.value ?? "load"})`);
        }
        case "WAIT_FOR_SELECTOR":
        case "CLICK_ELEMENT":
        case "FILL_INPUT": {
          const tab = this.activeTab();
          if (!tab) return fail(ERROR_MESSAGES.BROWSER_UNAVAILABLE);
          const el = this.findElement(tab, p);
          if (!el) {
            return { ...fail(`${ERROR_MESSAGES.ELEMENT_NOT_FOUND} (${describeLocator(p)})`), durationMs: Date.now() - started };
          }
          if (command.type === "FILL_INPUT") {
            if (!skipInput) el.value = String(p.value ?? "");
            return ok(`Filled ${describeLocator(p)}`);
          }
          if (command.type === "CLICK_ELEMENT") {
            if (el.navigatesTo) {
              const target = el.navigatesTo;
              const parsed = safeUrl(target.url, target.title);
              if (!skipInput) this.navigateActive(target.url, parsed?.title ?? target.title);
              this.emitBrowser();
              return ok(`Clicked ${describeLocator(p)} → ${target.url}`);
            }
            return ok(`Clicked ${describeLocator(p)}`);
          }
          return ok(`Found ${describeLocator(p)}`);
        }
        case "OPEN_APPLICATION": {
          const profile = await this.resolveProfile(String(p.applicationId ?? ""));
          if (!profile) return fail(ERROR_MESSAGES.APP_UNAVAILABLE);
          if (!skipInput) this.launchWindow(profile.name, profile.executablePath);
          return ok(`Launched ${profile.name}`, { executable: profile.executablePath });
        }
        case "FOCUS_WINDOW":
        case "MINIMIZE_WINDOW":
        case "MAXIMIZE_WINDOW":
        case "CLOSE_WINDOW": {
          const target = this.state.windows.find((w) => w.id === p.windowId) ?? this.state.windows.find((w) => w.isFocused);
          if (!target) return fail("No matching window on this device");
          if (command.type === "CLOSE_WINDOW") {
            this.state.windows = this.state.windows.filter((w) => w.id !== target.id);
            if (target.isFocused) this.focusFirstWindow();
            this.emitWindows();
            return ok(`Closed ${target.application}`);
          }
          if (!skipInput) {
            this.state.windows = this.state.windows.map((w) =>
              w.id === target.id
                ? { ...w, state: command.type === "MINIMIZE_WINDOW" ? "minimized" : command.type === "MAXIMIZE_WINDOW" ? "maximized" : "normal", isFocused: command.type === "FOCUS_WINDOW" }
                : command.type === "FOCUS_WINDOW"
                  ? { ...w, isFocused: false }
                  : w,
            );
            if (command.type === "FOCUS_WINDOW") this.state.activeWindow = { ...target, isFocused: true };
            else if (target.isFocused) this.focusFirstWindow();
            this.emitWindows();
          }
          return ok(`${command.type.split("_")[0]} → ${target.application}`);
        }
        default:
          return fail(`Command "${command.type}" is handled by the workflow engine, not the device`);
      }
    } catch (error) {
      return fail((error as Error).message || "Device reported a failure");
    } finally {
      this.busy = false;
      if (this.recorderActive && !ACTION_CATALOG[command.type]?.control) {
        captureAction(this.runtime.deviceId, command.type, command.parameters, 0.4);
      }
    }
  }

  /* ── virtual machine internals ───────────────────────────────────────── */

  private activeTab(): BrowserTab | null {
    return this.state.tabs.find((t) => t.id === this.state.activeTabId) ?? this.state.tabs[0] ?? null;
  }

  private resolveTab(ref: string): BrowserTab | null {
    if (!ref) return this.activeTab();
    const byIndex = Number.parseInt(ref.replace(/^tab-?/i, ""), 10);
    if (!Number.isNaN(byIndex) && this.state.tabs[byIndex]) return this.state.tabs[byIndex];
    return this.state.tabs.find((t) => t.id === ref) ?? null;
  }

  private navigateActive(url: string, title: string): BrowserTab {
    const active = this.activeTab();
    const site = SITES[hostnameOf(url)];
    const next: BrowserTab = {
      id: active?.id ?? "tab-1",
      title: site ? `${site.title}` : title,
      url,
      active: true,
      index: active?.index ?? 0,
      status: "idle",
    };
    const others = this.state.tabs.filter((t) => t.id !== next.id).map((t) => ({ ...t, active: false }));
    this.state.tabs = [next, ...others].map((t, i) => ({ ...t, index: i }));
    this.state.activeTabId = next.id;
    const chrome = this.state.windows.find((w) => w.processName === "chrome.exe");
    if (chrome) {
      this.state.windows = this.state.windows.map((w) => (w.id === chrome.id ? { ...w, title: `${next.title} — Google Chrome`, isFocused: true } : { ...w, isFocused: false }));
      this.state.activeWindow = { ...chrome, title: `${next.title} — Google Chrome`, isFocused: true };
      this.emitWindows();
    }
    return next;
  }

  private newTab(url: string, title: string): BrowserTab {
    const tab: BrowserTab = { id: `tab-${this.runtime.seq + this.state.tabs.length + 1}`, title, url, active: true, index: this.state.tabs.length, status: "idle" };
    this.runtime.seq += 1;
    this.state.tabs = [...this.state.tabs.map((t) => ({ ...t, active: false })), tab].map((t, i) => ({ ...t, index: i }));
    this.state.activeTabId = tab.id;
    return tab;
  }

  private recordClick() {
    const tab = this.activeTab();
    if (!tab) return;
    const el = this.findField(tab, () => true);
    if (el) el.value = el.value ?? "";
  }

  private findField(tab: BrowserTab, predicate: (el: VirtualElement) => boolean): VirtualElement | null {
    const site = SITES[hostnameOf(tab.url)];
    if (!site) {
      const fallback: VirtualElement = { selector: "body", kind: "heading" };
      return fallback;
    }
    return site.elements.find(predicate) ?? null;
  }

  private findElement(tab: BrowserTab, p: ActionParams): VirtualElement | null {
    const site = SITES[hostnameOf(tab.url)];
    const elements = site?.elements ?? [];
    const type = p.selectorType ?? "css";
    if (type === "role") {
      const role = (p.value ?? p.selector ?? "button").toLowerCase();
      const name = (p.name ?? "").toLowerCase();
      return elements.find((e) => (e.role ?? "").toLowerCase() === role && (!name || (e.name ?? "").toLowerCase().includes(name))) ?? null;
    }
    if (type === "label") {
      const needle = (p.name ?? p.selector ?? "").toLowerCase();
      return elements.find((e) => (e.label ?? "").toLowerCase().includes(needle)) ?? null;
    }
    if (type === "placeholder") {
      const needle = (p.selector ?? p.name ?? "").toLowerCase();
      return elements.find((e) => (e.placeholder ?? "").toLowerCase().includes(needle)) ?? null;
    }
    if (type === "text") {
      const needle = (p.selector ?? p.name ?? "").toLowerCase();
      return elements.find((e) => (e.name ?? "").toLowerCase() === needle) ?? null;
    }
    const sel = (p.selector ?? "").trim();
    return elements.find((e) => e.selector.toLowerCase() === sel.toLowerCase()) ?? null;
  }

  private cycleFocus() {
    const order = this.state.windows.filter((w) => w.state !== "minimized");
    if (!order.length) return;
    const idx = order.findIndex((w) => w.isFocused);
    const next = order[(idx + 1) % order.length];
    this.state.windows = this.state.windows.map((w) => ({ ...w, isFocused: w.id === next.id }));
    this.state.activeWindow = { ...next, isFocused: true };
    this.emitWindows();
  }

  private focusFirstWindow() {
    const first = this.state.windows.find((w) => w.state !== "minimized") ?? null;
    this.state.windows = this.state.windows.map((w) => ({ ...w, isFocused: first ? w.id === first.id : false }));
    this.state.activeWindow = first ? { ...first, isFocused: true } : null;
  }

  private launchWindow(application: string, executable: string) {
    const processName = executable.split(/[\\/]/).pop() ?? `${application}.exe`;
    const existing = this.state.windows.find((w) => w.processName.toLowerCase() === processName.toLowerCase());
    if (existing) {
      this.state.windows = this.state.windows.map((w) => ({ ...w, isFocused: w.id === existing.id, state: w.id === existing.id && w.state === "minimized" ? "normal" : w.state }));
      this.state.activeWindow = { ...existing, isFocused: true, state: "normal" };
    } else {
      const win: DesktopWindow = {
        id: `win-${processName.replace(/\D/g, "") || "app"}-${this.runtime.seq++}`,
        application,
        title: application,
        processName,
        isFocused: true,
        state: "normal",
      };
      this.state.windows = [...this.state.windows.map((w) => ({ ...w, isFocused: false })), win];
      this.state.activeWindow = win;
    }
    this.emitWindows();
    void log({ userId: this.userId, deviceId: this.runtime.deviceId, level: "SUCCESS", message: `${application} is in the foreground` });
  }

  private async resolveProfile(applicationId: string) {
    if (!applicationId) return null;
    const rows = await db
      .select()
      .from(applicationProfiles)
      .where(and(eq(applicationProfiles.userId, this.userId), eq(applicationProfiles.enabled, true)));
    return (
      rows.find((r) => r.id === applicationId || r.name.toLowerCase() === applicationId.toLowerCase() || r.category === applicationId) ?? null
    );
  }
}

function num(value: number | string | undefined, fallback: number) {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isFinite(parsed) ? (parsed as number) : fallback;
}
function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}
function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function hostnameOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
function safeUrl(url: string, fallbackTitle = "New tab") {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return { url: parsed.toString(), title: SITES[parsed.hostname.replace(/^www\./, "")]?.title ?? fallbackTitle };
  } catch {
    return null;
  }
}
export function describeLocator(p: ActionParams) {
  if ((p.selectorType ?? "css") === "role") return `role=${p.value ?? "button"} name="${p.name ?? ""}"`;
  return `${p.selectorType ?? "css"} ${p.selector ?? p.name ?? ""}`.trim();
}
