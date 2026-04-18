/**
 * Minimal types mirroring the subset of ra11y's MCP response shapes
 * the extension consumes. These are intentionally narrower than the
 * canonical types in `src/types/violation.ts` and
 * `src/mcp/tools-helpers.ts` — only the fields this extension reads
 * to build VS Code diagnostics belong here. If the wire format widens
 * with new optional fields, unknown keys are simply ignored.
 *
 * Keeping the types local means the extension compiles in isolation,
 * without importing from ra11y's source tree (which would drag in
 * Bun-only tooling and the package's devDeps).
 */

/** Severity as emitted by the scanner. Maps to vscode.DiagnosticSeverity. */
export type Ra11ySeverity = "error" | "warning" | "info";

/**
 * A single finding as returned under `files[].findings[]` by the MCP
 * `scan_project` tool. Built by `buildAgentFinding` in
 * `src/output/agent-response/build-finding.ts` (the shared builder
 * consumed by every MCP tool and the CLI agent formatter). `line` /
 * `column` are 1-based.
 */
export interface Ra11yFinding {
  readonly ruleId: string;
  readonly severity: Ra11ySeverity;
  readonly confidence?: "high" | "medium" | "low";
  readonly line: number;
  readonly column: number;
  readonly message: string;
  /** Fix suggestion string when the rule produced one. */
  readonly fix?: string;
  readonly criteria: readonly string[];
  readonly suppressWith?: string;
  readonly suppressPlacement?: string;
}

/** Per-file grouping under `files[]` in the MCP scan response. */
export interface Ra11yFileEntry {
  readonly path: string;
  readonly findings: readonly Ra11yFinding[];
}

/**
 * The shape returned by `scan_project` (after JSON.parse of the
 * `content[0].text` payload). Only fields the extension touches are
 * modelled; `meta` is kept as an opaque bag because the extension
 * currently only surfaces its existence, not its contents.
 */
export interface Ra11yScanResponse {
  readonly plan: {
    readonly totalFindings?: number;
    readonly violations?: number;
    readonly notes?: number;
    readonly summary?: string;
  };
  readonly files: readonly Ra11yFileEntry[];
  readonly meta: Record<string, unknown>;
}

// ─── MCP JSON-RPC shapes (client side) ──────────────────────────────────────

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: number | string | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

/** The content envelope every tool returns. Text-first per MCP 2024-11-05. */
export interface McpToolCallResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly structuredContent?: Record<string, unknown>;
  readonly isError?: boolean;
}
