/**
 * In-process harness for the MCP stdio server.
 *
 * The MCP server in `src/mcp/server.ts` reads newline-delimited JSON
 * from `process.stdin` and writes replies to `process.stdout`. The
 * production CLI wires those to real OS streams; the subprocess-based
 * integration tests exercise the transport end-to-end. This harness
 * instead drives the server in-process so unit tests can assert on
 * dispatch behavior with real line-coverage credit — the subprocess
 * tests' coverage doesn't flow back to the instrumented source.
 *
 * Use shape:
 *
 *   const harness = startMcpHarness();
 *   harness.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
 *   const reply = await harness.waitForReply(1);
 *   await harness.end();
 *
 * The stdio swap is reversed in `end()`; each test should create its
 * own harness in `beforeEach` and close it in `afterEach` so no
 * cross-test state leaks through the `process` object.
 */

import { PassThrough } from "node:stream";
import { startMcpServer } from "../../src/mcp/server.ts";

export interface JsonRpcLike {
  readonly jsonrpc?: string;
  readonly id?: string | number | null;
  readonly method?: string;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
  readonly params?: Record<string, unknown>;
}

export interface McpHarness {
  /** Send a JSON-RPC message (stringified + newline-terminated). */
  readonly send: (message: Record<string, unknown>) => void;
  /** Send raw bytes — useful for PARSE_ERROR / whitespace coverage. */
  readonly sendRaw: (raw: string) => void;
  /** Resolve with the first reply matching the given id. */
  readonly waitForReply: (id: string | number) => Promise<JsonRpcLike>;
  /** Resolve with the first notification matching the given method. */
  readonly waitForNotification: (method: string) => Promise<JsonRpcLike>;
  /** Resolve with the first captured line that satisfies `predicate`. */
  readonly waitForPredicate: (predicate: (m: JsonRpcLike) => boolean) => Promise<JsonRpcLike>;
  /** Every line captured from stdout, in order, in full. */
  readonly lines: JsonRpcLike[];
  /** Close stdin and await the server's graceful exit. */
  readonly end: () => Promise<void>;
}

/**
 * Spin up `startMcpServer` in-process. Restoring the original
 * `process.stdin` and `process.stdout.write` is the caller's
 * responsibility via `end()`.
 */
export function startMcpHarness(): McpHarness {
  const input = new PassThrough();
  const originalStdin = process.stdin;
  const originalWrite = process.stdout.write.bind(process.stdout);

  Object.defineProperty(process, "stdin", {
    value: input,
    configurable: true,
    writable: false,
  });

  const lines: JsonRpcLike[] = [];
  const waiters: Array<{
    readonly predicate: (m: JsonRpcLike) => boolean;
    readonly resolve: (m: JsonRpcLike) => void;
  }> = [];

  const deliver = (parsed: JsonRpcLike): void => {
    lines.push(parsed);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i];
      if (waiter?.predicate(parsed)) {
        waiters.splice(i, 1);
        waiter.resolve(parsed);
      }
    }
  };

  const parseLine = (raw: string): JsonRpcLike | null => {
    if (raw.trim().length === 0) return null;
    try {
      return JSON.parse(raw) as JsonRpcLike;
    } catch {
      return null;
    }
  };

  // biome-ignore lint/suspicious/noExplicitAny: stdout.write overload
  (process.stdout as any).write = (chunk: string | Uint8Array) => {
    const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    for (const raw of text.split("\n")) {
      const parsed = parseLine(raw);
      if (parsed) deliver(parsed);
    }
    return true;
  };

  const done = startMcpServer();

  const send = (message: Record<string, unknown>): void => {
    input.write(`${JSON.stringify(message)}\n`);
  };

  const sendRaw = (raw: string): void => {
    input.write(raw);
  };

  const waitFor = (predicate: (m: JsonRpcLike) => boolean): Promise<JsonRpcLike> => {
    for (const line of lines) {
      if (predicate(line)) return Promise.resolve(line);
    }
    return new Promise((resolve) => {
      waiters.push({ predicate, resolve });
    });
  };

  const end = async (): Promise<void> => {
    input.end();
    await done;
    Object.defineProperty(process, "stdin", {
      value: originalStdin,
      configurable: true,
      writable: false,
    });
    // biome-ignore lint/suspicious/noExplicitAny: restore write
    (process.stdout as any).write = originalWrite;
  };

  return {
    send,
    sendRaw,
    waitForReply: (id) => waitFor((m) => m.id === id && (m.result !== undefined || !!m.error)),
    waitForNotification: (method) =>
      waitFor((m) => m.method === method && (m.id === undefined || m.id === null)),
    waitForPredicate: (predicate) => waitFor(predicate),
    lines,
    end,
  };
}
