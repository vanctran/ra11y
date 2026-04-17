/**
 * Tiny MCP JSON-RPC client for the VS Code extension.
 *
 * Spawns `ra11y --mcp` as a child process, speaks newline-delimited
 * JSON-RPC 2.0 over stdio, and keeps the session alive across calls.
 * Zero runtime deps — everything uses the Node builtins that ship with
 * VS Code's extension host.
 *
 * Scope (intentionally small):
 *   - initialize + initialized handshake
 *   - tools/call for scan_project
 *   - request/response correlation by numeric id
 *   - line-buffered stdout parser
 *   - optional verbose logging to the passed-in channel
 *
 * NOT handled yet (see README): batch requests, notifications from the
 * server (logging/message), resources/prompts, graceful shutdown
 * sequencing, reconnection after crashes. Those can land incrementally
 * as the extension grows past "prove the wiring works."
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as vscode from "vscode";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpToolCallResult,
  Ra11yScanResponse,
} from "./types";

const PROTOCOL_VERSION = "2024-11-05";
const CLIENT_NAME = "ra11y-vscode";
const CLIENT_VERSION = "0.0.1";
const REQUEST_TIMEOUT_MS = 30_000;

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export interface McpClientOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly output: vscode.OutputChannel;
}

export class Ra11yMcpClient {
  private readonly command: string;
  private readonly args: readonly string[];
  private readonly cwd: string;
  private readonly output: vscode.OutputChannel;

  private child: ChildProcessWithoutNullStreams | null = null;
  private initialized = false;
  private nextId = 1;
  private stdoutBuffer = "";
  private readonly pending = new Map<number, PendingRequest>();

  constructor(opts: McpClientOptions) {
    this.command = opts.command;
    this.args = opts.args ?? ["--mcp"];
    this.cwd = opts.cwd;
    this.output = opts.output;
  }

  /**
   * Ensures the child is running and the initialize handshake has
   * completed. Safe to call repeatedly — subsequent calls are no-ops
   * once the session is live.
   */
  async ensureReady(): Promise<void> {
    if (this.initialized && this.child !== null && !this.child.killed) return;
    await this.spawnChild();
    await this.initialize();
  }

  /** Terminates the child process and drops all pending requests. */
  dispose(): void {
    for (const [id, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error(`ra11y MCP client disposed before response (id=${id})`));
    }
    this.pending.clear();
    this.initialized = false;
    const child = this.child;
    this.child = null;
    if (child !== null && !child.killed) {
      child.kill("SIGTERM");
    }
  }

  /**
   * Calls `scan_project` on the live MCP session. Extension-facing
   * entry point — returns the parsed Ra11yScanResponse JSON embedded in
   * `content[0].text`, or throws on protocol / tool errors.
   */
  async scanProject(args: {
    readonly cwd: string;
    readonly standard?: string;
    readonly level?: "A" | "AA" | "AAA";
    readonly minSeverity?: "error" | "warning" | "info";
    readonly additionalPaths?: readonly string[];
  }): Promise<Ra11yScanResponse> {
    await this.ensureReady();
    const result = (await this.sendRequest("tools/call", {
      name: "scan_project",
      arguments: { ...args },
    })) as McpToolCallResult;
    if (result.isError === true) {
      const text = result.content[0]?.text ?? "<no error text>";
      throw new Error(`ra11y scan_project returned error: ${text}`);
    }
    const text = result.content[0]?.text;
    if (typeof text !== "string") {
      throw new Error("ra11y scan_project response had no text content");
    }
    return JSON.parse(text) as Ra11yScanResponse;
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private spawnChild(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.output.appendLine(
        `[ra11y] spawning: ${this.command} ${this.args.join(" ")} (cwd=${this.cwd})`,
      );
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.command, [...this.args], {
          cwd: this.cwd,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
        });
      } catch (err) {
        reject(asError(err));
        return;
      }
      this.child = child;

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        this.output.append(`[ra11y:stderr] ${chunk}`);
      });
      child.on("error", (err) => {
        this.output.appendLine(`[ra11y] child error: ${err.message}`);
        this.failAllPending(err);
      });
      child.on("exit", (code, signal) => {
        this.output.appendLine(`[ra11y] child exited (code=${code}, signal=${signal ?? "none"})`);
        this.initialized = false;
        this.child = null;
        this.failAllPending(new Error(`ra11y MCP child exited (code=${code ?? "null"})`));
      });

      // child_process.spawn resolves sync — if we got here without throwing,
      // the ChildProcess object exists. The "error" handler above will
      // fire if the binary wasn't actually found.
      resolve();
    });
  }

  private async initialize(): Promise<void> {
    const result = (await this.sendRequest("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
    })) as { serverInfo?: { name?: string; version?: string } };
    this.sendNotification("notifications/initialized", {});
    this.initialized = true;
    const name = result.serverInfo?.name ?? "ra11y";
    const version = result.serverInfo?.version ?? "?";
    this.output.appendLine(`[ra11y] initialized (${name} ${version})`);
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const child = this.child;
    if (child === null) {
      return Promise.reject(new Error("ra11y MCP child is not running"));
    }
    const id = this.nextId++;
    const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ra11y MCP request '${method}' timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify(payload)}\n`, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    const child = this.child;
    if (child === null) return;
    const payload = { jsonrpc: "2.0", method, params };
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIdx = this.stdoutBuffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
      if (line.length > 0) this.handleLine(line);
      newlineIdx = this.stdoutBuffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(line) as JsonRpcResponse;
    } catch (err) {
      this.output.appendLine(`[ra11y] dropped non-JSON stdout line: ${line.slice(0, 200)}`);
      void err;
      return;
    }
    // Only responses carry numeric ids we issued. Notifications from
    // the server (logging/message, etc.) have no id match — skipped
    // silently for now; a future revision can surface them.
    if (typeof msg.id !== "number") return;
    const pending = this.pending.get(msg.id);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    this.pending.delete(msg.id);
    if (msg.error !== undefined) {
      pending.reject(new Error(`ra11y MCP error ${msg.error.code}: ${msg.error.message}`));
      return;
    }
    pending.resolve(msg.result);
  }

  private failAllPending(err: Error): void {
    for (const [id, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(err);
      this.pending.delete(id);
    }
  }
}

function asError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err));
}
