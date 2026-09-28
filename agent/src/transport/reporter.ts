import type { AgentStore } from "../state/store.js";
import { ControlPlaneClient } from "./client.js";

/**
 * Upstream telemetry: heartbeats keep the device ONLINE, state reports keep the
 * dashboard honest. Phase 1 reports connection health only — no pointer, no
 * windows, no tabs, and never any keystroke/typed content.
 */

export interface ReporterOptions {
  client: ControlPlaneClient;
  store: AgentStore;
  heartbeatMs: number;
  stateMs: number;
  log?: (message: string) => void;
}

export class Reporter {
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private stateTimer: NodeJS.Timeout | null = null;
  private heartbeatInFlight = false;
  private stateInFlight = false;

  constructor(private readonly opts: ReporterOptions) {}

  start() {
    this.stop();
    // Report immediately so a fresh agent shows up without waiting a full tick.
    void this.heartbeatOnce();
    void this.stateOnce();
    this.heartbeatTimer = setInterval(() => void this.heartbeatOnce(), this.opts.heartbeatMs);
    this.stateTimer = setInterval(() => void this.stateOnce(), this.opts.stateMs);
    this.heartbeatTimer.unref?.();
    this.stateTimer.unref?.();
  }

  stop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.stateTimer) clearInterval(this.stateTimer);
    this.heartbeatTimer = null;
    this.stateTimer = null;
  }

  /** Push fresh state on demand (e.g. after `state:request`). */
  pushStateNow() {
    void this.stateOnce();
  }

  private async heartbeatOnce() {
    if (this.heartbeatInFlight) return;
    this.heartbeatInFlight = true;
    try {
      await this.opts.client.post("/api/agent/heartbeat", { status: "ONLINE" });
      this.opts.store.lastHeartbeatAt = new Date().toISOString();
    } catch (error) {
      this.opts.log?.(`[agent] heartbeat failed: ${(error as Error).message}`);
    } finally {
      this.heartbeatInFlight = false;
    }
  }

  private async stateOnce() {
    if (this.stateInFlight) return;
    this.stateInFlight = true;
    try {
      await this.opts.client.post("/api/agent/state", {
        windows: [],
        tabs: [],
        activeTabId: null,
        browserConnected: false,
        browserName: "none (phase-1 dry-run agent)",
        automation: this.opts.store.automation,
      });
      this.opts.store.lastStateAt = new Date().toISOString();
    } catch (error) {
      this.opts.log?.(`[agent] state report failed: ${(error as Error).message}`);
    } finally {
      this.stateInFlight = false;
    }
  }
}
