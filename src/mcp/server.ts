/**
 * MCP server — JSON-RPC 2.0 over stdio.
 *
 * Implements the Model Context Protocol for ra11y:
 *   - initialize / initialized
 *   - tools/list
 *   - tools/call
 *   - prompts/list
 *   - prompts/get
 *   - resources/list
 *   - resources/read
 *
 * Zero dependencies. Reads newline-delimited JSON from stdin, writes
 * JSON responses to stdout. Logs go to stderr via the logger.
 */

import { createInterface } from "node:readline";
import { logger } from "../utils/logger.ts";
import {
  type CompletionArgument,
  type CompletionRef,
  complete,
  emptyCompletion,
} from "./completions.ts";
import {
  LOG_LEVELS,
  type LogEmitter,
  type LogLevel,
  type LogNotification,
  makeLogEmitter,
} from "./logging.ts";
import { createOutbound } from "./outbound.ts";
import { BUILTIN_PROMPTS } from "./prompts/index.ts";
import {
  loadKbResources,
  RESOURCE_NOT_FOUND,
  ResourceError,
  readKbResource,
} from "./resources/index.ts";
import { McpSession, type SessionRoot } from "./session.ts";
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

/** Typed view of the prompts/get params. Arguments are always string-valued per spec. */
interface PromptGetParams {
  readonly name: string | undefined;
  readonly arguments: Record<string, unknown> | undefined;
}

/** Typed view of the resources/read params. */
interface ResourcesReadParams {
  readonly uri: string | undefined;
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
const LOGGER_SCAN = "ra11y.scan";

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
  "",
  "Field semantics worth remembering so responses can stay terse:",
  "  - `activeNativeWrappers`: component names treated as native-element wrappers for the scan — rules that fire on bare `<div onClick>` skip instances of these components. Configure via `ra11y.config.ts` `nativeWrappers` or the `configure` tool.",
  "  - `limitations` (when present on a clean scan): runtime-only checks the static scanner can't perform; don't claim a11y conformance on the strength of this tool alone.",
].join("\n");

// ─── Tool index ─────────────────────────────────────────────────────────────

const TOOL_BY_NAME = new Map(MCP_TOOLS.map((t) => [t.def.name, t]));
const PROMPT_BY_NAME = new Map(BUILTIN_PROMPTS.map((p) => [p.name, p]));

// ─── Server ─────────────────────────────────────────────────────────────────

/**
 * Starts the MCP server on stdio. Resolves when stdin closes.
 */
export async function startMcpServer(): Promise<void> {
  const session = new McpSession();
  const emitLog: LogEmitter = makeLogEmitter(
    session.logging,
    (n: LogNotification) => writeNotification(n),
    () => process.cwd(),
  );

  const outbound = createOutbound(
    (line) => process.stdout.write(line),
    (id) => logger.debug(`MCP received response for unknown id: ${String(id)}`),
  );
  session.sendRequest = outbound.sendRequest;

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

    // Inbound *response* — correlates with a server-initiated request.
    // Must come before the request guard because responses have an
    // `id` without a `method`, which `isJsonRpcRequest` rightly rejects.
    if (outbound.tryRouteResponse(parsed)) continue;

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
      handleNotification(request, session);
      continue;
    }

    const response = await dispatch(request, session, emitLog);
    writeResponse(response);
  }
}

/**
 * Notifications carry no id, so we never reply — but some of them
 * carry state the session needs. `notifications/roots/list_changed`
 * is the canonical example: the host flipped project boundaries and
 * we need to re-query. We also record `initialized` for diagnostics.
 */
function handleNotification(request: JsonRpcRequest, session: McpSession): void {
  if (request.method === "notifications/initialized") {
    logger.debug("MCP client sent initialized notification");
    return;
  }
  if (request.method === "notifications/roots/list_changed") {
    // Host is telling us roots changed; we can't synchronously query
    // them back (that requires the host to answer a request), so we
    // just log and let the next tool call re-read session.roots.
    // When an `initialize` result carries roots directly, that path
    // populates the list.
    logger.debug("MCP client changed roots list");
    return;
  }
  if (request.method === "notifications/roots") {
    // Non-spec but some hosts push `{ roots: [...] }` alongside the
    // list_changed notification to avoid a second round-trip. We
    // accept it defensively.
    const roots = extractRootsFromParams(request.params ?? {});
    if (roots !== null) session.setRoots(roots);
    return;
  }
}

/**
 * Parse the `roots` array an MCP client may send either in
 * `initialize.params` or on `notifications/roots`. The canonical
 * shape is `Array<{ uri: string, name?: string }>`. Anything else
 * returns null so the caller knows not to mutate session state.
 */
function extractRootsFromParams(params: Record<string, unknown>): SessionRoot[] | null {
  const raw = params["roots"];
  if (!Array.isArray(raw)) return null;
  const out: SessionRoot[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as { uri?: unknown; name?: unknown };
    if (typeof r.uri !== "string" || r.uri.length === 0) continue;
    out.push({
      uri: r.uri,
      ...(typeof r.name === "string" ? { name: r.name } : {}),
    });
  }
  return out;
}

async function handleToolsCall(
  id: string | number | null,
  rawParams: Record<string, unknown>,
  session: McpSession,
  emitLog: LogEmitter,
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
  // Scan-family tools get a pair of log-notification bookends so
  // hosts with `logging` enabled see start/finish telemetry without
  // us splattering log calls inside each rule. Gated by the session's
  // current log level — default `warning` keeps the channel silent
  // until the host explicitly opts in via `logging/setLevel`.
  const isScan = toolName === "scan" || toolName === "scan_project" || toolName === "scan_file";
  if (isScan) {
    emitLog("debug", `${toolName}: starting`, { tool: toolName }, LOGGER_SCAN);
  }
  const t0 = performance.now();
  const toolResult = await tool.handler(callParams.arguments ?? {}, session);
  if (isScan) {
    const elapsedMs = Math.round(performance.now() - t0);
    const counts = extractScanCounts(toolResult);
    emitLog(
      "info",
      `${toolName}: complete in ${elapsedMs}ms`,
      { tool: toolName, elapsedMs, ...counts },
      LOGGER_SCAN,
    );
  }
  return { jsonrpc: "2.0", id, result: toolResult };
}

/**
 * Pull counts out of a tool result's JSON text payload so the `info`
 * completion log line carries useful scalar telemetry without us
 * deserializing the whole response shape. Returns an empty object
 * on any parse failure — logging is telemetry, not correctness.
 */
function extractScanCounts(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") return {};
  const shape = result as { content?: Array<{ text?: unknown }> };
  const first = shape.content?.[0];
  const text = first?.text;
  if (typeof text !== "string") return {};
  try {
    const parsed = JSON.parse(text) as {
      plan?: { violations?: number; notes?: number; totalFindings?: number };
      meta?: { filesScanned?: number };
    };
    const out: Record<string, unknown> = {};
    if (typeof parsed.plan?.totalFindings === "number")
      out["totalFindings"] = parsed.plan.totalFindings;
    if (typeof parsed.plan?.violations === "number") out["violations"] = parsed.plan.violations;
    if (typeof parsed.plan?.notes === "number") out["notes"] = parsed.plan.notes;
    if (typeof parsed.meta?.filesScanned === "number")
      out["filesScanned"] = parsed.meta.filesScanned;
    return out;
  } catch {
    return {};
  }
}

async function dispatch(
  request: JsonRpcRequest,
  session: McpSession,
  emitLog: LogEmitter,
): Promise<JsonRpcResponse> {
  const id = request.id ?? null;
  try {
    return await route(request, id, session, emitLog);
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
  emitLog: LogEmitter,
): Promise<JsonRpcResponse> | JsonRpcResponse {
  if (request.method === "initialize") return initializeResponse(id, request.params ?? {}, session);
  if (request.method === "tools/list") return toolsListResponse(id);
  if (request.method === "tools/call") {
    return handleToolsCall(id, request.params ?? {}, session, emitLog);
  }
  if (request.method === "prompts/list") return promptsListResponse(id);
  if (request.method === "prompts/get") {
    return handlePromptsGet(id, request.params ?? {});
  }
  if (request.method === "resources/list") return handleResourcesList(id);
  if (request.method === "resources/read") {
    return handleResourcesRead(id, request.params ?? {});
  }
  if (request.method === "logging/setLevel") {
    return handleLoggingSetLevel(id, request.params ?? {}, session);
  }
  if (request.method === "completion/complete") {
    return handleCompletion(id, request.params ?? {});
  }
  return {
    jsonrpc: "2.0",
    id,
    error: { code: METHOD_NOT_FOUND, message: `Method not found: ${request.method}` },
  };
}

/**
 * `completion/complete` — dispatch to the completions module.
 * Unknown refs degrade to the empty-completion shape (spec contract)
 * rather than erroring; only malformed request shapes produce a
 * JSON-RPC error.
 */
async function handleCompletion(
  id: string | number | null,
  rawParams: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const ref = rawParams["ref"];
  const argument = rawParams["argument"];
  if (!ref || typeof ref !== "object") {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: INVALID_PARAMS, message: "Missing or invalid `ref` on completion/complete." },
    };
  }
  if (!argument || typeof argument !== "object") {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: INVALID_PARAMS,
        message: "Missing or invalid `argument` on completion/complete.",
      },
    };
  }
  const argShape = argument as { name?: unknown; value?: unknown };
  if (typeof argShape.name !== "string") {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: INVALID_PARAMS, message: "`argument.name` must be a string." },
    };
  }
  const refShape = ref as CompletionRef;
  const typed: CompletionArgument = {
    name: argShape.name,
    value: typeof argShape.value === "string" ? argShape.value : "",
  };
  if (typeof refShape.type !== "string") {
    // Non-string ref.type: empty-completion shape is the spec's
    // unknown-ref contract, so honor that instead of erroring.
    return { jsonrpc: "2.0", id, result: emptyCompletion() };
  }
  const result = await complete(refShape, typed, process.cwd());
  return { jsonrpc: "2.0", id, result };
}

/**
 * `logging/setLevel` — host tunes the threshold. Unknown levels
 * return JSON-RPC invalid-params (not a tool error).
 */
function handleLoggingSetLevel(
  id: string | number | null,
  rawParams: Record<string, unknown>,
  session: McpSession,
): JsonRpcResponse {
  const level = rawParams["level"];
  if (typeof level !== "string" || !LOG_LEVELS.includes(level as LogLevel)) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: INVALID_PARAMS,
        message: `Invalid log level. Expected one of: ${LOG_LEVELS.join(", ")}.`,
      },
    };
  }
  session.logging.setLevel(level as LogLevel);
  // Spec: result is an empty object on success.
  return { jsonrpc: "2.0", id, result: {} };
}

function initializeResponse(
  id: string | number | null,
  rawParams: Record<string, unknown>,
  session: McpSession,
): JsonRpcResponse {
  // Host may declare `roots` up-front in `initialize.params.roots`
  // (some clients send them inline, others push via a notification
  // after handshake). Accept either path defensively so we have a
  // scan-scope hint before any tool call.
  const declaredRoots = extractRootsFromParams(rawParams);
  if (declaredRoots !== null) session.setRoots(declaredRoots);

  // Record which client capabilities the host declared. The presence
  // of `sampling` gates whether our sampling-backed tools call
  // `sampling/createMessage` or degrade to returning the prompt for
  // the agent to run inline.
  session.setHostCapabilities(rawParams["capabilities"]);

  return {
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: PROTOCOL_VERSION,
      // `listChanged: false` tells the host we won't emit
      // `notifications/prompts/list_changed` — prompt inventory is
      // baked in at build time. Tools ship the same guarantee.
      // Resources are file-backed (`docs/kb/**`), so changes do happen
      // at dev time; the flag still says `false` because we don't push
      // notifications to the host — agents call `resources/list` on
      // demand.
      capabilities: {
        tools: {},
        prompts: { listChanged: false },
        resources: { listChanged: false },
        // `logging: {}` opts us into `notifications/message` +
        // `logging/setLevel`. Default threshold is `warning` so hosts
        // that never tune stay silent; call `logging/setLevel` with
        // `info` to see scan start/finish telemetry.
        logging: {},
        // `completions: {}` opts into `completion/complete` — we
        // suggest criterion IDs for the ra11y/vpat-narrative prompt
        // and KB resource URIs for `ra11y-kb://` refs. Unknown
        // refs return the empty-completion shape per spec.
        completions: {},
      },
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

function promptsListResponse(id: string | number | null): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      prompts: BUILTIN_PROMPTS.map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments.map((a) => ({
          name: a.name,
          description: a.description,
          required: a.required,
        })),
      })),
    },
  };
}

function handlePromptsGet(
  id: string | number | null,
  rawParams: Record<string, unknown>,
): JsonRpcResponse {
  const params = rawParams as unknown as PromptGetParams;
  const name = params.name;
  if (typeof name !== "string") {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: INVALID_PARAMS, message: "Missing or invalid prompt name." },
    };
  }
  const prompt = PROMPT_BY_NAME.get(name);
  if (!prompt) {
    // Spec parity with tools/call: unknown prompt → method-not-found
    // on the name, not invalid-params. Matches how clients (incl.
    // Claude Code) discriminate "registry miss" from "bad argument".
    return {
      jsonrpc: "2.0",
      id,
      error: { code: METHOD_NOT_FOUND, message: `Unknown prompt: ${name}` },
    };
  }
  const stringArgs = coercePromptArgs(params.arguments ?? {});
  const messages = prompt.render(stringArgs);
  return {
    jsonrpc: "2.0",
    id,
    result: {
      description: prompt.description,
      messages,
    },
  };
}

async function handleResourcesList(id: string | number | null): Promise<JsonRpcResponse> {
  const resources = await loadKbResources(process.cwd());
  return {
    jsonrpc: "2.0",
    id,
    result: { resources },
  };
}

async function handleResourcesRead(
  id: string | number | null,
  rawParams: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const params = rawParams as unknown as ResourcesReadParams;
  const uri = params.uri;
  if (typeof uri !== "string") {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: INVALID_PARAMS, message: "Missing or invalid resource uri." },
    };
  }
  try {
    const content = await readKbResource(process.cwd(), uri);
    return {
      jsonrpc: "2.0",
      id,
      result: { contents: [content] },
    };
  } catch (err: unknown) {
    if (err instanceof ResourceError) {
      // Separate shape so agents can distinguish "scheme/path rejected"
      // (client bug) from "file genuinely missing" (stale inventory).
      const code = err.code === RESOURCE_NOT_FOUND ? RESOURCE_NOT_FOUND : INVALID_PARAMS;
      return {
        jsonrpc: "2.0",
        id,
        error: { code, message: err.message },
      };
    }
    throw err;
  }
}

/**
 * MCP prompt arguments are spec'd as `{ [name]: string }`. Hosts
 * occasionally pass numbers or booleans by mistake; coerce to string
 * so template rendering stays deterministic and non-string values
 * don't leak into substitution sites.
 */
function coercePromptArgs(raw: Record<string, unknown>): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      out[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
    }
  }
  return out;
}

// ─── I/O helpers ────────────────────────────────────────────────────────────

function writeResponse(response: JsonRpcResponse): void {
  const json = JSON.stringify(response);
  process.stdout.write(`${json}\n`);
}

/**
 * Write a notification (id-less JSON-RPC message) to stdout. Shares
 * the response lane because MCP uses one stream for everything;
 * ordering relative to replies is controlled by the async loop.
 */
function writeNotification(notification: LogNotification): void {
  const json = JSON.stringify(notification);
  process.stdout.write(`${json}\n`);
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as { jsonrpc?: unknown; method?: unknown };
  return obj.jsonrpc === "2.0" && typeof obj.method === "string";
}
