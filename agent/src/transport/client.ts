/**
 * Minimal control-plane HTTP client. Header-based Bearer auth only — the agent
 * never puts its device token in a query string.
 */

export interface PairInput {
  pairingCode: string;
  deviceName: string;
  platform: string;
  agentVersion: string;
  capabilities: string[];
  displayResolution?: string;
}

export interface PairResult {
  deviceId: string;
  deviceToken: string;
  userId: string;
}

export class ControlPlaneError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ControlPlaneError";
    this.status = status;
  }
}

function serverMessage(status: number, body: unknown): string {
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return `Control plane responded with HTTP ${status}`;
}

export class ControlPlaneClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
  ) {}

  /** Unauthenticated pairing handshake (POST /api/agent/pair). */
  async pair(input: PairInput, timeoutMs = 15_000): Promise<PairResult> {
    const res = await this.request("/api/agent/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      timeoutMs,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new ControlPlaneError(res.status, serverMessage(res.status, body));
    if (typeof body.deviceId !== "string" || typeof body.deviceToken !== "string") {
      throw new ControlPlaneError(res.status, "Pairing response was missing device credentials");
    }
    return { deviceId: body.deviceId, deviceToken: body.deviceToken, userId: String(body.userId ?? "") };
  }

  /** Authenticated JSON POST (heartbeat / result / state / recorder-event). */
  async post<T>(path: string, payload: unknown, timeoutMs = 15_000): Promise<T> {
    const token = this.getToken();
    if (!token) throw new ControlPlaneError(0, "No device token configured — pair this agent first");
    const res = await this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      timeoutMs,
    });
    const body = (await res.json().catch(() => ({}))) as T & Record<string, unknown>;
    if (!res.ok) {
      const message = serverMessage(res.status, body);
      // Never let an Authorization header value leak through an error string.
      throw new ControlPlaneError(res.status, message.replace(token, "[redacted]"));
    }
    return body;
  }

  private async request(path: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new ControlPlaneError(0, `Request to ${path} timed out after ${init.timeoutMs}ms`);
      }
      throw new ControlPlaneError(0, `Cannot reach ${this.baseUrl}${path} (${(error as Error).message})`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Mask a device token for logs: `apd_1a2b3c…` — never the full credential. */
export function maskToken(token: string | null | undefined): string {
  if (!token) return "(none)";
  if (token.length <= 12) return `${token.slice(0, 4)}…`;
  return `${token.slice(0, 12)}…`;
}
