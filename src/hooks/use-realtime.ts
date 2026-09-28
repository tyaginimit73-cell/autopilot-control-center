"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  api,
  endpoints,
  useAuth,
  useBrowser,
  useDesktop,
  useDevices,
  useExecutions,
  usePointer,
  useUi,
  useWorkflows,
} from "@/lib/client";
import type { ActivityLog } from "@autopilot/shared";

/**
 * Single realtime subscription for the whole dashboard.
 *
 * Event names mirror the Socket.IO contract (agent:*, workflow:*, action:*,
 * mouse:position, browser:updated, window:updated, log:created). High-frequency
 * pointer samples are written to a dedicated store so the shell, sidebar and
 * workflow editor never re-render on cursor movement.
 */
export function useRealtime(enabled = true) {
  const sourceRef = useRef<EventSource | null>(null);
  const retryRef = useRef(0);
  const { setStatus, setConnection, pushLog, setEmergency, toast } = useUi.getState();
  const refreshTimer = useRef<NodeJS.Timeout | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const data = await api.get<Record<string, unknown>>(endpoints.status);
      setStatus(data);
    } catch {
      setConnection({ backend: "offline" });
    }
  }, [setStatus, setConnection]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      const source = new EventSource("/api/stream", { withCredentials: true });
      sourceRef.current = source;
      source.addEventListener("open", () => {
        retryRef.current = 0;
        setConnection({ socket: "online" });
      });
      source.onerror = () => {
        setConnection({ socket: "offline" });
        source.close();
        if (disposed) return;
        const delay = Math.min(12_000, 700 * 2 ** retryRef.current);
        retryRef.current += 1;
        setTimeout(connect, delay);
      };

      const on = <T,>(name: string, handler: (data: T) => void) =>
        source.addEventListener(name, (event) => {
          try {
            handler(JSON.parse((event as MessageEvent).data) as T);
          } catch {
            /* ignore malformed frames */
          }
        });

      on("stream:ready", (data: { agentOnline?: boolean; automation?: string; mouse?: { x: number; y: number; screenW: number; screenH: number } }) => {
        if (data.mouse) usePointer.getState().setMouse(data.mouse);
        setConnection({ socket: "online", agent: data.agentOnline ? "connected" : "disconnected" });
        void refreshStatus();
      });

      on("log:created", (data: ActivityLog) => pushLog(data));

      on("mouse:position", (data: { x: number; y: number; screenW: number; screenH: number; at: number }) => {
        usePointer.getState().setMouse({ x: data.x, y: data.y, screenW: data.screenW, screenH: data.screenH, at: data.at });
      });

      on("browser:updated", (data: { tabs: never[]; activeTabId: string | null; browserConnected: boolean; browserName: string }) => {
        useBrowser.getState().apply(data as never);
        setConnection({ browser: data.browserConnected ? "connected" : "disconnected" });
      });

      on("window:updated", (data: { windows: never[]; activeWindow: { application: string; title: string } | null }) => {
        useDesktop.getState().applyWindows(data as never);
      });

      on("state:automation", (data: { automation: "RUNNING" | "IDLE" | "PAUSED" }) => {
        useDesktop.setState({ automation: data.automation });
      });

      on("agent:connected", () => {
        setConnection({ agent: "connected" });
        void useDevices.getState().load();
        toast({ tone: "success", title: "Agent connected", message: "Real OS automation is available on this device" });
      });
      on("agent:disconnected", () => {
        setConnection({ agent: "disconnected" });
        void useDevices.getState().load();
      });
      on("agent:heartbeat", () => setConnection({ agent: "connected" }));

      on("workflow:started", (data: { executionId: string; workflowName: string }) => {
        useExecutions.getState().setLive({ executionId: data.executionId, workflowName: data.workflowName, status: "RUNNING", index: 0, total: 0, actionType: null, message: "started" });
      });
      on("workflow:paused", () => useExecutions.getState().setLive({ status: "PAUSED" }));
      on("workflow:resumed", () => useExecutions.getState().setLive({ status: "RUNNING" }));
      on("workflow:stopping", () => useExecutions.getState().setLive({ status: "STOPPING" }));
      on("workflow:completed", (data: { workflowName: string }) => {
        useExecutions.getState().setLive(null);
        useUi.getState().toast({ tone: "success", title: "Workflow completed", message: data.workflowName });
        void useExecutions.getState().loadHistory();
      });
      on("workflow:failed", (data: { message?: string; workflowName: string }) => {
        useExecutions.getState().setLive(null);
        useUi.getState().toast({ tone: "error", title: "Workflow failed", message: data.message ?? data.workflowName });
        void useExecutions.getState().loadHistory();
      });
      on("workflow:stopped", () => {
        useExecutions.getState().setLive(null);
        setEmergency(false);
        void useExecutions.getState().loadHistory();
      });

      on("action:started", (data: { index: number; total: number; actionType: string }) => {
        useExecutions.getState().setLive({ index: data.index, total: data.total, actionType: data.actionType, status: "RUNNING" });
      });
      on("action:failed", (data: { message: string }) => {
        useUi.getState().toast({ tone: "warn" as never, title: "Action failed", message: data.message });
      });

      on("recorder:started", () => useUi.getState().toast({ tone: "warn", title: "Recording started", message: "Agent input hooks are being captured" }));
      on("recorder:stopped", () => void useWorkflows.getState().load());
      on("settings:updated", () => void useUi.getState().loadSettings());
      on("system:emergency-stop", () => {
        setEmergency(false);
        useUi.getState().toast({ tone: "error", title: "Emergency stop", message: "All automations cancelled" });
      });
    };

    connect();
    refreshTimer.current = setInterval(() => void refreshStatus(), 6000);
    return () => {
      disposed = true;
      sourceRef.current?.close();
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [enabled, pushLog, refreshStatus, setConnection, setEmergency, setStatus, toast]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = () => {
      if (!cancelled && document.visibilityState === "visible") void refreshStatus();
    };
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, refreshStatus]);
}

/** Global emergency shortcut (configurable in Settings → Emergency stop). */
export function useEmergencyShortcut() {
  const shortcut = useUi((s) => s.settings?.emergencyShortcut ?? "Ctrl+Shift+Esc");
  useEffect(() => {
    const expected = normalise(shortcut);
    const onKey = async (event: KeyboardEvent) => {
      if (event.repeat) return;
      const combo = `${event.ctrlKey ? "ctrl+" : ""}${event.altKey ? "alt+" : ""}${event.shiftKey ? "shift+" : ""}${event.metaKey ? "meta+" : ""}${event.key.toLowerCase()}`;
      if (normalise(combo) !== expected) return;
      event.preventDefault();
      await triggerEmergencyStop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);
}

function normalise(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace("control", "ctrl")
    .replace("cmd", "meta")
    .replace("escape", "esc");
}

export async function triggerEmergencyStop() {
  const { setEmergency, toast } = useUi.getState();
  setEmergency(true);
  try {
    const data = await api.post<{ stopped: number }>(endpoints.emergency, {});
    toast({ tone: "error", title: "Automation halted", message: `${data.stopped} execution(s) cancelled and the agent queue flushed` });
  } catch (error) {
    toast({ tone: "error", title: "Emergency stop failed", message: (error as Error).message });
  } finally {
    setTimeout(() => useUi.getState().setEmergency(false), 1400);
  }
}

/** Session bootstrap: auth gate + first data load. */
export function useBootstrap() {
  const load = useAuth((s) => s.load);
  const status = useAuth((s) => s.status);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (status !== "ready") return;
    void useDevices.getState().load();
    void useDevices.getState().loadApplications();
    void useWorkflows.getState().load();
    void useExecutions.getState().loadHistory();
    void useUi.getState().loadSettings();
    void useUi.getState().loadSchedules();
    void api
      .get<{ logs: ActivityLog[] }>(`${endpoints.logs}?limit=80`)
      .then((data) => useUi.getState().replaceLogs(data.logs))
      .catch(() => undefined);
  }, [status]);
  return status;
}
