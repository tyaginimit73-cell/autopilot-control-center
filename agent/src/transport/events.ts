/**
 * Agent-side Server-Sent Events consumer for GET /api/agent/events.
 *
 * Implemented on Node's built-in `fetch` + stream readers — no EventSource
 * dependency is needed because, unlike a browser, we can set the
 * `Authorization` header directly (and therefore never use `?token=`).
 */

export interface SseEvent {
  event: string;
  data: string;
  id: string | null;
}

export interface SseHandlers {
  onHello: (payload: Record<string, unknown>) => void;
  onCommand: (payload: unknown) => void;
  onEmergencyStop: (payload: Record<string, unknown>) => void;
  onRecorder: (active: boolean) => void;
  onStateRequest: () => void;
}

const DEFAULT_EVENT = "message";

/**
 * Incremental SSE frame parser (spec-compatible subset: id/event/data/retry +
 * comment keepalives). Exported so unit tests can drive it without a socket.
 */
export class SseParser {
  private buffer = "";
  private pending: { event: string; data: string[]; id: string | null } | null = null;

  lastEventId: string | null = null;
  retryMs: number | null = null;

  push(chunk: string): SseEvent[] {
    const out: SseEvent[] = [];
    this.buffer += chunk;
    let boundary = this.buffer.indexOf("\n");
    while (boundary !== -1) {
      let line = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const completed = this.pushLine(line);
      if (completed) out.push(completed);
      boundary = this.buffer.indexOf("\n");
    }
    return out;
  }

  private pushLine(line: string): SseEvent | null {
    if (line === "") {
      // Blank line dispatches the pending event (if it has any data).
      const pending = this.pending;
      this.pending = null;
      if (pending && pending.data.length > 0) {
        if (pending.id !== null) this.lastEventId = pending.id;
        return { event: pending.event, data: pending.data.join("\n"), id: pending.id };
      }
      return null;
    }
    if (line.startsWith(":")) return null; // comment / keepalive
    const ensure = () => (this.pending ??= { event: DEFAULT_EVENT, data: [], id: null });
    if (line.startsWith("data:")) {
      const value = line.slice(5).startsWith(" ") ? line.slice(6) : line.slice(5);
      ensure().data.push(value);
      return null;
    }
    if (line.startsWith("event:")) {
      const value = line.slice(6).startsWith(" ") ? line.slice(7) : line.slice(6);
      ensure().event = value || DEFAULT_EVENT;
      return null;
    }
    if (line.startsWith("id:")) {
      const value = line.slice(3).startsWith(" ") ? line.slice(4) : line.slice(3);
      if (!value.includes("\0")) ensure().id = value;
      return null;
    }
    if (line.startsWith("retry:")) {
      const parsed = Number.parseInt(line.slice(6).trim(), 10);
      if (Number.isFinite(parsed) && parsed >= 0) this.retryMs = parsed;
      return null;
    }
    // Unknown field names are ignored per the SSE spec.
    return null;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("ABORTED"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error("ABORTED"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export interface SseConnectionOptions {
  baseUrl: string;
  getToken: () => string | null;
  handlers: SseHandlers;
  log?: (message: string) => void;
  /** base delay before the first reconnect (doubles each attempt) */
  baseDelayMs?: number;
  /** ceiling for the backoff delay */
  maxDelayMs?: number;
}

export class SseConnection {
  private readonly opts: Required<Pick<SseConnectionOptions, "baseDelayMs" | "maxDelayMs">> & SseConnectionOptions;
  private aborter: AbortController | null = null;
  private runPromise: Promise<void> | null = null;
  private failures = 0;

  constructor(opts: SseConnectionOptions) {
    this.opts = { baseDelayMs: 1000, maxDelayMs: 30_000, ...opts };
  }

  get running(): boolean {
    return this.runPromise !== null;
  }

  /** Start the (single) connection loop. Idempotent — never opens two streams. */
  start() {
    if (this.runPromise) return;
    this.aborter = new AbortController();
    this.runPromise = this.loop(this.aborter.signal).finally(() => {
      this.runPromise = null;
    });
  }

  async stop() {
    this.aborter?.abort();
    await this.runPromise?.catch(() => undefined);
  }

  private async loop(signal: AbortSignal) {
    const log = this.opts.log ?? (() => undefined);
    // One parser per connection attempt keeps Last-Event-ID resume correct.
    let lastEventId: string | null = null;
    while (!signal.aborted) {
      try {
        await this.streamOnce(signal, lastEventId, (id) => {
          lastEventId = id;
        });
        // A clean server-side close is still a disconnect: back off and retry.
        if (!signal.aborted) {
          this.failures += 1;
          log(`[agent] event stream closed by server — reconnecting (attempt ${this.failures})`);
        }
      } catch (error) {
        if (signal.aborted || (error as Error).message === "ABORTED") return;
        this.failures += 1;
        log(`[agent] event stream error: ${(error as Error).message} — reconnecting (attempt ${this.failures})`);
      }
      if (signal.aborted) return;
      const delay = Math.min(this.opts.maxDelayMs, this.opts.baseDelayMs * 2 ** Math.min(this.failures - 1, 6));
      const jitter = Math.round(delay * (0.5 + Math.random() * 0.5));
      try {
        await sleep(jitter, signal);
      } catch {
        return;
      }
    }
  }

  private async streamOnce(signal: AbortSignal, resumeId: string | null, onId: (id: string | null) => void) {
    const log = this.opts.log ?? (() => undefined);
    const token = this.opts.getToken();
    if (!token) throw new Error("missing device token — pair this agent first");
    const headers: Record<string, string> = { Accept: "text/event-stream", Authorization: `Bearer ${token}` };
    if (resumeId) headers["Last-Event-ID"] = resumeId;

    const res = await fetch(`${this.opts.baseUrl}/api/agent/events`, { headers, signal });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "").then((t) => t.slice(0, 200));
      throw new Error(`event stream rejected (HTTP ${res.status})${body ? `: ${body}` : ""}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      log(`[agent] warning: unexpected event-stream content type "${contentType}"`);
    }

    this.failures = 0;
    const parser = new SseParser();
    parser.lastEventId = resumeId;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        const events = parser.push(decoder.decode(value, { stream: true }));
        onId(parser.lastEventId);
        for (const frame of events) this.dispatch(frame);
      }
    } finally {
      reader.releaseLock();
      await res.body.cancel().catch(() => undefined);
    }
  }

  private dispatch(frame: SseEvent) {
    const log = this.opts.log ?? (() => undefined);
    const { handlers } = this.opts;
    let payload: unknown = null;
    if (frame.data) {
      try {
        payload = JSON.parse(frame.data) as unknown;
      } catch {
        log(`[agent] ignoring malformed ${frame.event || "message"} frame (invalid JSON)`);
        return;
      }
    }
    const record = (payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}) as Record<string, unknown>;
    switch (frame.event) {
      case "hello":
        handlers.onHello(record);
        return;
      case "command":
        handlers.onCommand(payload);
        return;
      case "emergency-stop":
        handlers.onEmergencyStop(record);
        return;
      case "recorder:start":
        handlers.onRecorder(true);
        return;
      case "recorder:stop":
        handlers.onRecorder(false);
        return;
      case "state:request":
        handlers.onStateRequest();
        return;
      default:
        log(`[agent] ignoring unknown event "${frame.event}"`);
    }
  }
}
