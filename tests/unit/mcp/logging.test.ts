/**
 * Unit tests for `src/mcp/logging.ts` — the MCP `notifications/message`
 * emitter plus `logging/setLevel` threshold state.
 *
 * Three invariants this module must uphold:
 *   1. Default threshold is `warning`; messages below are dropped without
 *      touching the notification writer.
 *   2. Absolute paths under `cwd` are rewritten to project-relative so
 *      the log channel never leaks filesystem layout (compliance tool).
 *   3. The `data` map propagates with string fields sanitized but
 *      non-string values passed through unchanged.
 */

import { describe, expect, it } from "bun:test";
import {
  LOG_LEVELS,
  LoggingState,
  type LogNotification,
  makeLogEmitter,
  NOOP_LOG_EMITTER,
} from "../../../src/mcp/logging.ts";

describe("LOG_LEVELS", () => {
  it("lists RFC 5424 severities in ascending order", () => {
    expect(LOG_LEVELS).toEqual([
      "debug",
      "info",
      "notice",
      "warning",
      "error",
      "critical",
      "alert",
      "emergency",
    ]);
  });
});

describe("LoggingState", () => {
  it("defaults to `warning` so info-bookends do not flood hosts that never call setLevel", () => {
    const state = new LoggingState();
    expect(state.getLevel()).toBe("warning");
    expect(state.shouldEmit("info")).toBe(false);
    expect(state.shouldEmit("warning")).toBe(true);
  });

  it("setLevel lowers the threshold so debug frames start flowing", () => {
    const state = new LoggingState();
    state.setLevel("debug");
    expect(state.getLevel()).toBe("debug");
    expect(state.shouldEmit("debug")).toBe(true);
    expect(state.shouldEmit("info")).toBe(true);
  });

  it("setLevel raises the threshold so warning frames get dropped in error-only mode", () => {
    const state = new LoggingState();
    state.setLevel("error");
    expect(state.shouldEmit("warning")).toBe(false);
    expect(state.shouldEmit("error")).toBe(true);
    expect(state.shouldEmit("emergency")).toBe(true);
  });
});

describe("makeLogEmitter", () => {
  it("drops messages below the current threshold without invoking the writer", () => {
    const state = new LoggingState();
    const captured: LogNotification[] = [];
    const emit = makeLogEmitter(
      state,
      (n) => captured.push(n),
      () => "/proj",
    );
    emit("debug", "scan start");
    emit("info", "step 1");
    expect(captured).toEqual([]);
  });

  it("forwards messages at or above the threshold as JSON-RPC notifications/message frames", () => {
    const state = new LoggingState();
    state.setLevel("debug");
    const captured: LogNotification[] = [];
    const emit = makeLogEmitter(
      state,
      (n) => captured.push(n),
      () => "/proj",
    );
    emit("info", "hello");
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { level: "info", message: "hello" },
    });
  });

  it("rewrites cwd-rooted absolute paths in the message text to project-relative `.` prefix", () => {
    const state = new LoggingState();
    state.setLevel("debug");
    const captured: LogNotification[] = [];
    const emit = makeLogEmitter(
      state,
      (n) => captured.push(n),
      () => "/proj",
    );
    emit("info", "scanning /proj/src/app.tsx");
    expect(captured[0]?.params.message).toBe("scanning ./src/app.tsx");
  });

  it("includes `logger` and `data` only when the caller supplied them (present-when-meaningful)", () => {
    const state = new LoggingState();
    state.setLevel("debug");
    const captured: LogNotification[] = [];
    const emit = makeLogEmitter(
      state,
      (n) => captured.push(n),
      () => "/proj",
    );
    emit("info", "bare");
    emit("info", "tagged", { count: 3 }, "ra11y.scan");
    expect(captured[0]?.params).not.toHaveProperty("logger");
    expect(captured[0]?.params).not.toHaveProperty("data");
    expect(captured[1]?.params.logger).toBe("ra11y.scan");
    expect(captured[1]?.params.data).toEqual({ count: 3 });
  });

  it("sanitizes string fields inside data but leaves non-string values intact", () => {
    const state = new LoggingState();
    state.setLevel("debug");
    const captured: LogNotification[] = [];
    const emit = makeLogEmitter(
      state,
      (n) => captured.push(n),
      () => "/proj",
    );
    emit("info", "m", { path: "/proj/src/a.tsx", count: 7, flag: true });
    expect(captured[0]?.params.data).toEqual({
      path: "./src/a.tsx",
      count: 7,
      flag: true,
    });
  });

  it("skips path sanitization when cwd is empty (treat root-less sessions as pre-initialize)", () => {
    const state = new LoggingState();
    state.setLevel("debug");
    const captured: LogNotification[] = [];
    const emit = makeLogEmitter(
      state,
      (n) => captured.push(n),
      () => "",
    );
    emit("info", "raw /abs/path stays");
    expect(captured[0]?.params.message).toBe("raw /abs/path stays");
  });

  it("reads cwd lazily on each emit so mid-session root changes take effect", () => {
    const state = new LoggingState();
    state.setLevel("debug");
    const captured: LogNotification[] = [];
    let root = "/old";
    const emit = makeLogEmitter(
      state,
      (n) => captured.push(n),
      () => root,
    );
    emit("info", "hit /old/a.tsx");
    root = "/new";
    emit("info", "hit /new/b.tsx");
    expect(captured[0]?.params.message).toBe("hit ./a.tsx");
    expect(captured[1]?.params.message).toBe("hit ./b.tsx");
  });
});

describe("NOOP_LOG_EMITTER", () => {
  it("is a discarding emitter — callers that branch on `emitter ?? noop` can call it safely", () => {
    expect(() => NOOP_LOG_EMITTER("info", "hi")).not.toThrow();
    expect(NOOP_LOG_EMITTER("error", "boom", { k: 1 }, "logger")).toBeUndefined();
  });
});
