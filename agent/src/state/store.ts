/**
 * Local agent state. Phase 1 tracks connection/session bookkeeping only — no
 * pointer position, no window list, no tabs, and NEVER any keystroke buffers.
 * Those arrive with the real drivers in later phases.
 */

export type AutomationState = "RUNNING" | "IDLE" | "PAUSED";

export interface HelloInfo {
  deviceId: string;
  protocol: string;
  heartbeatSeconds: number;
  receivedAt: string;
}

export interface AgentStats {
  commandsReceived: number;
  commandsCompleted: number;
  commandsRejected: number;
  duplicatesIgnored: number;
  emergencyStops: number;
  reconnects: number;
}

const MAX_SEEN_IDS = 2000;

export class AgentStore {
  automation: AutomationState = "IDLE";
  halted = false;
  haltedAt: string | null = null;
  haltReason: string | null = null;
  connectedAt: string | null = null;
  hello: HelloInfo | null = null;
  lastHeartbeatAt: string | null = null;
  lastStateAt: string | null = null;
  lastCommandAt: string | null = null;
  readonly stats: AgentStats = {
    commandsReceived: 0,
    commandsCompleted: 0,
    commandsRejected: 0,
    duplicatesIgnored: 0,
    emergencyStops: 0,
    reconnects: 0,
  };

  private seenIds = new Map<string, number>();

  /**
   * Record a command id. Returns false when the id was already seen, so the
   * transport never executes (or double-reports) a redelivered command.
   */
  markSeen(commandId: string): boolean {
    if (this.seenIds.has(commandId)) {
      this.stats.duplicatesIgnored += 1;
      return false;
    }
    this.seenIds.set(commandId, Date.now());
    if (this.seenIds.size > MAX_SEEN_IDS) {
      const oldest = this.seenIds.keys().next().value as string | undefined;
      if (oldest) this.seenIds.delete(oldest);
    }
    return true;
  }

  onHello(info: HelloInfo) {
    this.hello = info;
    this.connectedAt = info.receivedAt;
    // A fresh hello means a fresh server-side session: clear any Phase-1 halt so
    // reconnects restore normal operation (criterion J).
    if (this.halted) {
      this.halted = false;
      this.haltReason = null;
    }
  }

  onEmergencyStop(reason: string) {
    this.halted = true;
    this.haltedAt = new Date().toISOString();
    this.haltReason = reason;
    this.stats.emergencyStops += 1;
    this.automation = "IDLE";
  }

  snapshot() {
    return {
      automation: this.automation,
      halted: this.halted,
      haltReason: this.haltReason,
      connectedAt: this.connectedAt,
      hello: this.hello,
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastStateAt: this.lastStateAt,
      lastCommandAt: this.lastCommandAt,
      stats: { ...this.stats },
    };
  }
}
