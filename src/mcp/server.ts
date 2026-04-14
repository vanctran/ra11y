/**
 * MCP server — JSON-RPC 2.0 over stdio.
 *
 * Implements the Model Context Protocol for ra11y:
 *   - initialize / initialized
 *   - tools/list
 *   - tools/call
 *
 * Zero dependencies. Reads newline-delimited JSON from stdin, writes
 * JSON responses to stdout. Logs go to stderr via the logger.
 */

import { createInterface } from "node:readline";
import { logger } from "../utils/logger.ts";
import { McpSession } from "./session.ts";
import { MCP_TOOLS } from "./tools.ts";

// ─── JSON-RPC types ─────────────────────────────────────────────────────────

interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

/** Typed view of the tools/call params so dot access satisfies both TS and Biome. */
interface ToolCallParams {
  readonly name: string | undefined;
  readonly arguments: Record<string, unknown> | undefined;
}

// ─── JSON-RPC error codes ───────────────────────────────────────────────────

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

// ─── Protocol constants ─────────────────────────────────────────────────────

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "ra11y";
const SERVER_VERSION = "0.1.0";

const SERVER_INSTRUCTIONS = [
  "Workflow:",
  "  1. `scan_project` for a project-wide audit, or `scan` / `scan_file` / `--changed` for narrower passes.",
  "  2. If automated is clean, call `checklist` for the manual-review half (grounded candidates with file:line).",
  "  3. For each candidate, read the cited file and decide — don't post-hoc filter or downgrade candidates in your own output; the tool already prunes by likelyIrrelevant and uniquePerCriterion.",
  "  4. Dismiss by reading. Suppress at the source only when genuinely N/A via `<!-- ra11y-disable -->` / `{/* ra11y-disable */}` (accepts rule IDs like `keyboard/handler-missing` and criterion IDs like `wcag22:2.4.5`).",
  "",
  "Out of scope: runtime checks (live regions, focus traps, ARIA state, post-render contrast) live in your Playwright/Vitest suite via axe-core. Automated clean here ≠ WCAG compliant.",
  "",
  "Consumption tips: verbose `meta` fields (configSource, activeNativeWrappers, rulesEvaluated, filesByExtension) are scan-confidence telemetry — pass them through when explaining a result. `nextStep` on each response tells you the canonical next call.",
].join("\n");

// ─── Tool index ─────────────────────────────────────────────────────────────

const TOOL_BY_NAME = new Map(MCP_TOOLS.map((t) => [t.def.name, t]));

// ─── Server ─────────────────────────────────────────────────────────────────

/**
 * Starts the MCP server on stdio. Resolves when stdin closes.
 */
export async function startMcpServer(): Promise<void> {
  const session = new McpSession();

  const rl = createInterface({ input: process.stdin, terminal: false });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      writeResponse({
        jsonrpc: "2.0",
        id: null,
        error: { code: PARSE_ERROR, message: "Parse error" },
      });
      continue;
    }

    if (!isJsonRpcRequest(parsed)) {
      writeResponse({
        jsonrpc: "2.0",
        id: null,
        error: { code: INVALID_REQUEST, message: "Invalid Request" },
      });
      continue;
    }

    const request = parsed;

    // Notifications (no id) don't get responses.
    if (request.id === undefined || request.id === null) {
      // "initialized" is the only notification we expect.
      if (request.method === "notifications/initialized") {
        logger.debug("MCP client sent initialized notification");
      }
      continue;
    }

    const response = await dispatch(request, session);
    writeResponse(response);
  }
}

async function handleToolsCall(
  id: string | number | null,
  rawParams: Record<string, unknown>,
  session: McpSession,
): Promise<JsonRpcResponse> {
  const callParams = rawParams as unknown as ToolCallParams;
  const toolName = callParams.name;
  if (typeof toolName !== "string") {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: INVALID_PARAMS, message: "Missing or invalid tool name." },
    };
  }
  const tool = TOOL_BY_NAME.get(toolName);
  if (!tool) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: METHOD_NOT_FOUND, message: `Unknown tool: ${toolName}` },
    };
  }
  const toolResult = await tool.handler(callParams.arguments ?? {}, session);
  return { jsonrpc: "2.0", id, result: toolResult };
}

async function dispatch(request: JsonRpcRequest, session: McpSession): Promise<JsonRpcResponse> {
  const id = request.id ?? null;
  try {
    return await route(request, id, session);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`MCP dispatch error: ${message}`);
    return {
      jsonrpc: "2.0",
      id,
      error: { code: INTERNAL_ERROR, message: `Internal error: ${message}` },
    };
  }
}

function route(
  request: JsonRpcRequest,
  id: string | number | null,
  session: McpSession,
): Promise<JsonRpcResponse> | JsonRpcResponse {
  if (request.method === "initialize") return initializeResponse(id);
  if (request.method === "tools/list") return toolsListResponse(id);
  if (request.method === "tools/call") {
    return handleToolsCall(id, request.params ?? {}, session);
  }
  return {
    jsonrpc: "2.0",
    id,
    error: { code: METHOD_NOT_FOUND, message: `Method not found: ${request.method}` },
  };
}

function initializeResponse(id: string | number | null): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: SERVER_INSTRUCTIONS,
    },
  };
}

function toolsListResponse(id: string | number | null): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      tools: MCP_TOOLS.map((t) => ({
        name: t.def.name,
        description: t.def.description,
        inputSchema: t.def.inputSchema,
        annotations: t.def.annotations,
      })),
    },
  };
}

// ─── I/O helpers ────────────────────────────────────────────────────────────

function writeResponse(response: JsonRpcResponse): void {
  const json = JSON.stringify(response);
  process.stdout.write(`${json}\n`);
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as { jsonrpc?: unknown; method?: unknown };
  return obj.jsonrpc === "2.0" && typeof obj.method === "string";
}
