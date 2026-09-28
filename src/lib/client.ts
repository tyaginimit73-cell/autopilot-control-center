"use client";

import { create } from "zustand";
import type {
  ActivityLog,
  ApplicationProfile,
  AutomationSettings,
  BrowserTab,
  DesktopWindow,
  Device,
  ExecutionStatus,
  MousePosition,
  Schedule,
  Workflow,
  WorkflowAction,
} from "@autopilot/shared";

/** ── typed API client ────────────────────────────────────────────────────── */
export class ApiClientError extends Error {
  status: number;
  code?: string;
  details?: { path: string; message: string }[];
  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details as never;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    throw new ApiClientError(res.status, String(data.error ?? res.statusText), data.code as string, data.details);
  }
  return data as T;
}

export const api = {
  get: <T,>(path: string) => request<T>("GET", path),
  post: <T,>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T,>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T,>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  del: <T,>(path: string) => request<T>("DELETE", path),
};

export const endpoints = {
  me: "/api/auth/me",
  login: "/api/auth/login",
  register: "/api/auth/register",
  logout: "/api/auth/logout",
  devices: "/api/devices",
  pair: "/api/devices/pair",
  applications: "/api/applications",
  workflows: "/api/workflows",
  executions: "/api/executions",
  schedules: "/api/schedules",
  tabs: "/api/browser/tabs",
  windows: "/api/desktop/windows",
  status: "/api/system/status",
  stats: "/api/system/stats",
  logs: "/api/logs",
  settings: "/api/settings",
  recorder: "/api/recorder",
  emergency: "/api/system/emergency-stop",
};

/* ── stores: server state ─────────────────────────────────────────────────── */

interface AuthState {
  user: { id: string; name: string; email: string; role: "USER" | "ADMIN"; createdAt?: string } | null;
  status: "idle" | "loading" | "ready" | "anon";
  load: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: "idle",
  async load() {
    set({ status: "loading" });
    try {
      const data = await api.get<{ user: AuthState["user"] }>(endpoints.me);
      set({ user: data.user, status: data.user ? "ready" : "anon" });
    } catch {
      set({ user: null, status: "anon" });
    }
  },
  async login(email, password) {
    const data = await api.post<{ user: AuthState["user"] }>(endpoints.login, { email, password });
    set({ user: data.user, status: "ready" });
  },
  async register(name, email, password) {
    const data = await api.post<{ user: AuthState["user"] }>(endpoints.register, { name, email, password });
    set({ user: data.user, status: "ready" });
  },
  async logout() {
    await api.post(endpoints.logout);
    set({ user: null, status: "anon" });
  },
}));

export interface DeviceView extends Device {
  connected?: boolean;
  pairingCode?: string | null;
  pairingExpiresAt?: string | null;
  hasPairingCode?: boolean;
}

interface DeviceState {
  devices: DeviceView[];
  activeId: string | null;
  applications: ApplicationProfile[];
  loading: boolean;
  load: () => Promise<void>;
  loadApplications: () => Promise<void>;
  addPairing: (name: string, platform: string) => Promise<{ code: string; expiresAt: string; deviceId: string }>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rotate: (id: string) => Promise<string>;
  addApplication: (input: Omit<ApplicationProfile, "id" | "userId" | "createdAt" | "updatedAt">) => Promise<void>;
  toggleApplication: (id: string, enabled: boolean) => Promise<void>;
  removeApplication: (id: string) => Promise<void>;
  setActive: (id: string) => void;
}

export const useDevices = create<DeviceState>((set, get) => ({
  devices: [],
  activeId: null,
  applications: [],
  loading: false,
  async load() {
    set({ loading: true });
    try {
      const data = await api.get<{ devices: DeviceView[] }>(endpoints.devices);
      const current = get().activeId;
      set({
        devices: data.devices,
        activeId: current && data.devices.some((d) => d.id === current) ? current : (data.devices.find((d) => d.connected) ?? data.devices[0])?.id ?? null,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },
  async loadApplications() {
    const data = await api.get<{ applications: ApplicationProfile[] }>(endpoints.applications);
    set({ applications: data.applications });
  },
  async addPairing(name, platform) {
    const data = await api.post<{ code: string; expiresAt: string; deviceId: string }>(endpoints.pair, { name, platform });
    await get().load();
    return data;
  },
  async rename(id, name) {
    await api.patch(`/api/devices/${id}`, { name });
    await get().load();
  },
  async remove(id) {
    await api.del(`/api/devices/${id}`);
    await get().load();
  },
  async rotate(id) {
    const data = await api.post<{ deviceToken: string }>(`/api/devices/${id}/rotate`);
    return data.deviceToken;
  },
  async addApplication(input) {
    await api.post(endpoints.applications, input);
    await get().loadApplications();
  },
  async toggleApplication(id, enabled) {
    await api.patch(`/api/applications/${id}`, { enabled });
    await get().loadApplications();
  },
  async removeApplication(id) {
    await api.del(`/api/applications/${id}`);
    await get().loadApplications();
  },
  setActive(id) {
    set({ activeId: id });
  },
}));

interface WorkflowState {
  workflows: (Workflow & { lastRun?: { id: string; status: ExecutionStatus; startedAt: string; durationMs: number | null; dryRun: boolean } | null })[];
  current: Workflow | null;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  load: () => Promise<void>;
  loadOne: (id: string) => Promise<void>;
  create: (input: { name: string; description: string; actions: WorkflowAction[]; status: Workflow["status"]; isDryRun: boolean }) => Promise<Workflow>;
  save: (id: string, input: { name: string; description: string; actions: WorkflowAction[]; status: Workflow["status"]; isDryRun: boolean }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  patchActions: (updater: (actions: WorkflowAction[]) => WorkflowAction[]) => void;
  patchMeta: (patch: Partial<Pick<Workflow, "name" | "description" | "status" | "isDryRun">>) => void;
  reset: () => void;
}

export const useWorkflows = create<WorkflowState>((set, get) => ({
  workflows: [],
  current: null,
  loading: false,
  saving: false,
  dirty: false,
  async load() {
    set({ loading: true });
    try {
      const data = await api.get<{ workflows: WorkflowState["workflows"] }>(endpoints.workflows);
      set({ workflows: data.workflows, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  async loadOne(id) {
    set({ loading: true });
    try {
      const data = await api.get<{ workflow: Workflow }>(`${endpoints.workflows}/${id}`);
      set({ current: data.workflow, loading: false, dirty: false });
    } catch {
      set({ loading: false });
    }
  },
  async create(input) {
    const data = await api.post<{ workflow: Workflow }>(endpoints.workflows, input);
    await get().load();
    return data.workflow;
  },
  async save(id, input) {
    set({ saving: true });
    try {
      const data = await api.put<{ workflow: Workflow }>(`${endpoints.workflows}/${id}`, input);
      set({ current: data.workflow, saving: false, dirty: false });
      await get().load();
    } catch (error) {
      set({ saving: false });
      throw error;
    }
  },
  async remove(id) {
    await api.del(`${endpoints.workflows}/${id}`);
    await get().load();
  },
  async duplicate(id) {
    await api.post(`${endpoints.workflows}/duplicate`, { workflowId: id });
    await get().load();
  },
  patchActions(updater) {
    const current = get().current;
    if (!current) return;
    set({ current: { ...current, actions: updater(current.actions ?? []) }, dirty: true });
  },
  patchMeta(patch) {
    const current = get().current;
    if (!current) return;
    set({ current: { ...current, ...patch }, dirty: true });
  },
  reset() {
    set({ current: null, dirty: false });
  },
}));

export interface ExecutionView {
  id: string;
  workflowId: string | null;
  workflowName: string;
  deviceId: string | null;
  status: ExecutionStatus;
  trigger: "MANUAL" | "SCHEDULE" | "RECORDING" | "API";
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  currentActionIndex: number;
  totalActions: number;
  error: string | null;
  steps: {
    index: number;
    actionType: string;
    status: string;
    message: string;
    attempt: number;
  }[];
}

interface ExecutionState {
  live: { executionId: string; workflowName: string; index: number; total: number; status: ExecutionStatus; actionType: string | null; message: string } | null;
  history: ExecutionView[];
  detail: { execution: ExecutionView; logs: ActivityLog[] } | null;
  loading: boolean;
  loadHistory: (filters?: { limit?: number }) => Promise<void>;
  loadDetail: (id: string) => Promise<void>;
  start: (workflowId: string, deviceId?: string, dryRun?: boolean) => Promise<{ executionId: string; dryRun: boolean }>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  setLive: (patch: Partial<NonNullable<ExecutionState["live"]>> | null) => void;
}

export const useExecutions = create<ExecutionState>((set, get) => ({
  live: null,
  history: [],
  detail: null,
  loading: false,
  async loadHistory(filters) {
    set({ loading: true });
    try {
      const data = await api.get<{ executions: ExecutionView[] }>(`${endpoints.executions}?limit=${filters?.limit ?? 60}`);
      set({ history: data.executions, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  async loadDetail(id) {
    set({ loading: true });
    try {
      const data = await api.get<{ execution: ExecutionView; logs: ActivityLog[] }>(`${endpoints.executions}/${id}`);
      set({ detail: { execution: data.execution, logs: data.logs }, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  async start(workflowId, deviceId, dryRun) {
    const data = await api.post<{ executionId: string; dryRun: boolean; actionCount: number }>(`${endpoints.workflows}/${workflowId}/start`, {
      deviceId,
      dryRun,
    });
    set({
      live: { executionId: data.executionId, workflowName: "Starting…", index: 0, total: 0, status: "RUNNING", actionType: null, message: "" },
    });
    return data;
  },
  async pause(id) {
    await api.post(`${endpoints.executions}/${id}/pause`);
  },
  async resume(id) {
    await api.post(`${endpoints.executions}/${id}/resume`);
  },
  async stop(id) {
    await api.post(`${endpoints.executions}/${id}/stop`);
  },
  setLive(patch) {
    if (patch === null) return set({ live: null });
    set({ live: { ...(get().live as NonNullable<ExecutionState["live"]>), ...patch } });
  },
}));

interface BrowserState {
  tabs: BrowserTab[];
  activeTabId: string | null;
  connected: boolean;
  browserName: string;
  loading: boolean;
  load: (deviceId?: string) => Promise<void>;
  open: (url: string, newTab?: boolean) => Promise<void>;
  switchTo: (tabId: string) => Promise<void>;
  close: (tabId?: string) => Promise<void>;
  act: (action: "reload" | "close" | "activate", tabId?: string) => Promise<void>;
  element: (input: { kind: "click" | "fill" | "waitFor"; selectorType: string; selector?: string; name?: string; value?: string }) => Promise<void>;
  apply: (payload: { tabs: BrowserTab[]; activeTabId: string | null; browserConnected: boolean; browserName: string }) => void;
}

export const useBrowser = create<BrowserState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  connected: false,
  browserName: "Chromium",
  loading: false,
  async load(deviceId) {
    set({ loading: true });
    try {
      const data = await api.get<{
        tabs: BrowserTab[];
        activeTabId: string | null;
        browserConnected: boolean;
        browserName: string;
      }>(`${endpoints.tabs}${deviceId ? `?deviceId=${deviceId}` : ""}`);
      set({ ...data, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  async open(url, newTab = false) {
    await api.post("/api/browser/open", { url, newTab, deviceId: useDevices.getState().activeId ?? undefined });
    await get().load();
  },
  async switchTo(tabId) {
    await api.post("/api/browser/switch", { tabId, deviceId: useDevices.getState().activeId ?? undefined });
    await get().load();
  },
  async close(tabId) {
    await api.post("/api/browser/close", { tabId, confirm: true, deviceId: useDevices.getState().activeId ?? undefined });
    await get().load();
  },
  async act(action, tabId) {
    await api.post("/api/browser/act", { action, tabId, confirm: true, deviceId: useDevices.getState().activeId ?? undefined });
    await get().load();
  },
  async element(input) {
    await api.post("/api/browser/element", { ...input, deviceId: useDevices.getState().activeId ?? undefined });
    await get().load();
  },
  apply(payload) {
    set({ tabs: payload.tabs, activeTabId: payload.activeTabId, connected: payload.browserConnected, browserName: payload.browserName });
  },
}));

interface DesktopState {
  windows: DesktopWindow[];
  activeWindow: DesktopWindow | null;
  automation: "RUNNING" | "IDLE" | "PAUSED";
  agentConnected: boolean;
  kind: Device["kind"];
  loading: boolean;
  load: (deviceId?: string) => Promise<void>;
  focus: (windowId: string, operation: "focus" | "minimize" | "maximize" | "close") => Promise<void>;
  launch: (applicationId: string) => Promise<void>;
  applyWindows: (payload: { windows: DesktopWindow[]; activeWindow: DesktopWindow | null }) => void;
}

export const useDesktop = create<DesktopState>((set, get) => ({
  windows: [],
  activeWindow: null,
  automation: "IDLE",
  agentConnected: false,
  kind: "SIMULATED",
  loading: false,
  async load(deviceId) {
    set({ loading: true });
    try {
      const data = await api.get<{
        windows: DesktopWindow[];
        activeWindow: DesktopWindow | null;
        automation: DesktopState["automation"];
        agentConnected: boolean;
        kind: Device["kind"];
      }>(`${endpoints.windows}${deviceId ? `?deviceId=${deviceId}` : ""}`);
      set({ ...data, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  async focus(windowId, operation) {
    await api.post("/api/desktop/focus", { windowId, operation, confirm: true, deviceId: useDevices.getState().activeId ?? undefined });
    await get().load();
  },
  async launch(applicationId) {
    await api.post("/api/desktop/open-application", { applicationId, deviceId: useDevices.getState().activeId ?? undefined });
    await get().load();
  },
  applyWindows(payload) {
    set({ windows: payload.windows, activeWindow: payload.activeWindow });
  },
}));

/** Pointer telemetry lives in its own store: mouse updates never re-render the app shell. */
interface PointerState {
  mouse: MousePosition;
  typedBuffer: string;
  setMouse: (mouse: Partial<MousePosition>) => void;
  setTyped: (value: string) => void;
}

export const usePointer = create<PointerState>((set) => ({
  mouse: { x: 0, y: 0, screenW: 1920, screenH: 1080, at: 0 },
  typedBuffer: "",
  setMouse(mouse) {
    set((state) => ({ mouse: { ...state.mouse, ...mouse } }));
  },
  setTyped(value) {
    set({ typedBuffer: value });
  },
}));

export interface Toast {
  id: string;
  title: string;
  message?: string;
  tone: "info" | "success" | "warn" | "error";
}

interface UiState {
  logs: ActivityLog[];
  paused: boolean;
  toasts: Toast[];
  connection: { backend: "online" | "offline"; socket: "online" | "offline" | "connecting"; agent: "connected" | "disconnected"; browser: "connected" | "disconnected" };
  status: Record<string, unknown> | null;
  sidebarOpen: boolean;
  emergencyActive: boolean;
  settings: AutomationSettings | null;
  schedules: Schedule[];
  pushLog: (log: ActivityLog) => void;
  replaceLogs: (logs: ActivityLog[]) => void;
  togglePaused: () => void;
  toast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
  setConnection: (patch: Partial<UiState["connection"]>) => void;
  setStatus: (status: Record<string, unknown> | null) => void;
  setSidebar: (open: boolean) => void;
  setEmergency: (active: boolean) => void;
  loadSettings: () => Promise<void>;
  saveSettings: (patch: Partial<AutomationSettings>) => Promise<void>;
  loadSchedules: () => Promise<void>;
  setScheduleBusy: (id: string, busy: boolean) => void;
  scheduleBusy: Record<string, boolean>;
}

export const useUi = create<UiState>((set, get) => ({
  logs: [],
  paused: false,
  toasts: [],
  scheduleBusy: {},
  connection: { backend: "online", socket: "connecting", agent: "disconnected", browser: "disconnected" },
  status: null,
  sidebarOpen: true,
  emergencyActive: false,
  settings: null,
  schedules: [],
  pushLog(entry) {
    if (get().paused) return;
    set({ logs: [...get().logs.slice(-380), entry] });
  },
  replaceLogs(logs) {
    set({ logs });
  },
  togglePaused() {
    set({ paused: !get().paused });
  },
  toast(toast) {
    const id = crypto.randomUUID();
    set({ toasts: [...get().toasts, { ...toast, id }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 5200);
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  setConnection(patch) {
    set({ connection: { ...get().connection, ...patch } });
  },
  setStatus(status) {
    set({ status: status as never });
    const agent = (status as { agent?: { state?: string } })?.agent?.state;
    const browser = (status as { browser?: { state?: string } })?.browser?.state;
    set({
      connection: {
        ...get().connection,
        backend: "online",
        agent: agent === "connected" ? "connected" : "disconnected",
        browser: browser === "connected" ? "connected" : "disconnected",
      },
    });
  },
  setSidebar(open) {
    set({ sidebarOpen: open });
  },
  setEmergency(active) {
    set({ emergencyActive: active });
  },
  async loadSettings() {
    try {
      const data = await api.get<{ settings: AutomationSettings }>(endpoints.settings);
      set({ settings: data.settings });
    } catch {
      /* settings are optional for the UI to function */
    }
  },
  async saveSettings(patch) {
    const merged = { ...(get().settings as AutomationSettings), ...patch };
    await api.put(endpoints.settings, merged);
    set({ settings: merged });
  },
  async loadSchedules() {
    const data = await api.get<{ schedules: Schedule[] }>(endpoints.schedules);
    set({ schedules: data.schedules });
  },
  setScheduleBusy(id, busy) {
    set({ scheduleBusy: { ...get().scheduleBusy, [id]: busy } });
  },
}));
