/**
 * MCP logging capability — `notifications/message` emitter plus level
 * gating via `logging/setLevel`.
 *
 * The MCP `logging` capability lets the server push structured log
 * records to the client between requests. Levels follow RFC 5424
 * (syslog): debug, info, notice, warning, error, critical, alert,
 * emergency. Hosts tune verbosity with `logging/setLevel`; we keep a
 * per-session threshold and drop messages below it without allocating.
 *
 * Scope is deliberately narrow: one `emitLog` helper wired into the
 * scan entry point (one debug on start, one info on completion with
 * counts). This is polish for scan-confidence telemetry, not a
 * general-purpose logger — use `src/utils/logger.ts` for stderr
 * diagnostics instead. Surgical so the channel stays valuable.
 */

// RFC 5424 severities in ascending order. Exported for tests.
export const LOG_LEVELS = [
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
  "alert",
  "emergency",
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** Ordinal used for threshold comparison. Lower = chattier. */
function levelRank(level: LogLevel): number {
  return LOG_LEVELS.indexOf(level);
}

/**
 * Per-session logging threshold. Default is `warning` so a host that
 * advertises interest in the capability but never calls `setLevel`
 * doesn't get flooded with info-level bookends — and existing clients
 * whose response-parsing assumes one reply per request stay
 * correct until they opt in. Hosts raise or lower via
 * `logging/setLevel`; `debug` surfaces scan start/finish telemetry.
 */
export class LoggingState {
  private level: LogLevel = "warning";

  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Spec: unknown level → JSON-RPC invalid-params at the handler. The
   * state object itself only accepts the typed enum; the handler
   * validates before calling this.
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /** True when a message at `messageLevel` would be delivered. */
  shouldEmit(messageLevel: LogLevel): boolean {
    return levelRank(messageLevel) >= levelRank(this.level);
  }
}

/**
 * The `notifications/message` payload. `data` is freeform JSON-
 * serializable context the host can render alongside `message`.
 * `logger` is an optional subsystem tag — we use `"ra11y.scan"` for
 * scan telemetry so hosts can route by source.
 */
export interface LogNotification {
  readonly jsonrpc: "2.0";
  readonly method: "notifications/message";
  readonly params: {
    readonly level: LogLevel;
    readonly logger?: string;
    readonly message: string;
    readonly data?: Record<string, unknown>;
  };
}

/** Signature the server exposes so emitters don't import stdio. */
export type LogEmitter = (
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
  loggerName?: string,
) => void;

/**
 * Builds an emitter bound to a session's logging state and a low-level
 * notification writer. Messages below the current threshold are
 * dropped without touching the writer. Absolute paths under `cwd` are
 * rewritten to project-relative so log output never leaks
 * filesystem layout beyond the scanned root — this is a compliance
 * tool; users trust it to be quiet.
 */
export function makeLogEmitter(
  state: LoggingState,
  writeNotification: (n: LogNotification) => void,
  cwd: () => string,
): LogEmitter {
  return (level, message, data, loggerName) => {
    if (!state.shouldEmit(level)) return;
    const root = cwd();
    const safeMessage = sanitizePath(message, root);
    const safeData = data ? sanitizeData(data, root) : undefined;
    writeNotification({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: {
        level,
        ...(loggerName ? { logger: loggerName } : {}),
        message: safeMessage,
        ...(safeData ? { data: safeData } : {}),
      },
    });
  };
}

/**
 * No-op emitter for the case where the host never called
 * `initialize` or the session lacks a live writer yet. Keeping the
 * same shape means callers don't branch on `emitter ?? noop`.
 */
export const NOOP_LOG_EMITTER: LogEmitter = () => {
  /* discard */
};

function sanitizePath(text: string, root: string): string {
  if (root.length === 0) return text;
  // Replace occurrences of the absolute cwd with `.` so any path that
  // logged its full form becomes project-relative.
  return text.split(root).join(".");
}

function sanitizeData(data: Record<string, unknown>, root: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string") out[k] = sanitizePath(v, root);
    else out[k] = v;
  }
  return out;
}
