/**
 * MCP sampling client — the "request a model call from the host"
 * side of the protocol. When a tool needs an LLM to read a component
 * source, verdict a review candidate, or draft VPAT narrative text,
 * it calls `createMessage` here. The server issues
 * `sampling/createMessage` as an outbound JSON-RPC request, the host
 * (Claude Code, Cursor, …) supplies the model and the API key, and
 * the result comes back through the bidirectional read loop.
 *
 * Zero-dep invariant (ADR 0001) holds: ra11y never imports the
 * Anthropic SDK. "Network isolation" holds too — the outbound bytes
 * are JSON-RPC over stdio; the host makes the upstream HTTP call.
 *
 * See `docs/adr/0005-in-house-mcp-server.md` for the shipping
 * decision and `docs/kb/architecture/mcp-sampling.md` for the runtime
 * walkthrough.
 */

import type { McpSession } from "./session.ts";

/** One turn of a sampling conversation. Per MCP spec. */
export interface SamplingMessage {
  readonly role: "user" | "assistant";
  readonly content: SamplingContent;
}

/**
 * MCP's `TextContent` is the only shape we emit. The spec also
 * defines image/audio content, but ra11y prompts are text-only — we
 * never send binary payloads to the host.
 */
export interface SamplingContent {
  readonly type: "text";
  readonly text: string;
}

/**
 * Hints the host can use to pick a model. Purely advisory — the host
 * decides; we never name a specific model to avoid ADR 0005's
 * "bit-rots across model generations" failure mode.
 */
export interface ModelPreferences {
  readonly hints?: ReadonlyArray<{ readonly name?: string }>;
  readonly costPriority?: number;
  readonly speedPriority?: number;
  readonly intelligencePriority?: number;
}

export interface SamplingRequest {
  readonly messages: readonly SamplingMessage[];
  readonly maxTokens: number;
  readonly systemPrompt?: string;
  readonly temperature?: number;
  readonly stopSequences?: readonly string[];
  readonly modelPreferences?: ModelPreferences;
  readonly includeContext?: "none" | "thisServer" | "allServers";
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SamplingResult {
  readonly role: "assistant";
  readonly content: SamplingContent;
  readonly model: string;
  readonly stopReason?: string;
}

/**
 * Default per-call timeout. Sampling calls roundtrip through the host
 * to a real model — generous but bounded. Callers can override.
 */
export const DEFAULT_SAMPLING_TIMEOUT_MS = 60_000;

/**
 * Thrown when a tool tries to sample on a host that did not declare
 * the `sampling` capability in its `initialize` handshake. Tools
 * catching this should degrade to returning the prompt string so the
 * agent can run the model call itself (per ADR 0005 §Costs).
 */
export class SamplingNotSupportedError extends Error {
  constructor() {
    super(
      "Host did not declare `sampling` capability. Return the prompt for the agent to run inline instead.",
    );
    this.name = "SamplingNotSupportedError";
  }
}

/**
 * Thrown when the host declared `sampling` but has no transport wired
 * (e.g. unit tests that instantiate `McpSession` directly). Distinct
 * from `SamplingNotSupportedError` because the caller usually wants a
 * different fallback — "degrade for the user" vs "we have a bug".
 */
export class SamplingTransportUnavailableError extends Error {
  constructor() {
    super(
      "Sampling transport not wired on this session. `startMcpServer` must run before tools call `sample`.",
    );
    this.name = "SamplingTransportUnavailableError";
  }
}

/**
 * Request a model turn from the host. Returns the host's reply shape
 * verbatim (per MCP spec) so callers can inspect `stopReason` and
 * model identity alongside the text.
 *
 * The two failure modes the spec forces us to separate:
 *   - Host did not declare sampling → throws `SamplingNotSupportedError`.
 *     Callers should catch and degrade to "run the prompt yourself".
 *   - Host declared it but the transport isn't connected →
 *     `SamplingTransportUnavailableError`. That's a ra11y bug or a
 *     misused unit test; treat it as programmer error, not host gap.
 *
 * @param session the MCP session carrying host capabilities + transport
 * @param request the sampling parameters (messages, maxTokens, …)
 * @param timeoutMs per-call timeout override; defaults to
 *   {@link DEFAULT_SAMPLING_TIMEOUT_MS}
 */
export async function sample(
  session: McpSession,
  request: SamplingRequest,
  timeoutMs: number = DEFAULT_SAMPLING_TIMEOUT_MS,
): Promise<SamplingResult> {
  if (!session.hostCapabilities.sampling) throw new SamplingNotSupportedError();
  if (session.sendRequest === null) throw new SamplingTransportUnavailableError();

  const raw = await session.sendRequest("sampling/createMessage", request, timeoutMs);
  return coerceResult(raw);
}

/**
 * Narrow the host's response to `SamplingResult`. Hosts that follow
 * the spec send exactly this shape; hosts that don't get a typed
 * error rather than silent `undefined` access later. We trust the
 * primitive fields and surface a clear message on divergence.
 */
function coerceResult(raw: unknown): SamplingResult {
  if (!raw || typeof raw !== "object") {
    throw new Error(
      `sampling/createMessage: host returned ${raw === null ? "null" : typeof raw} instead of a result object. Spec: https://modelcontextprotocol.io/specification — host must return { role: "assistant", content, model, stopReason? }. If the host does not support sampling, it should decline the capability during initialize instead of returning a non-object.`,
    );
  }
  const r = raw as {
    role?: unknown;
    content?: unknown;
    model?: unknown;
    stopReason?: unknown;
  };
  if (r.role !== "assistant") {
    throw new Error(`sampling/createMessage: expected role "assistant", got ${String(r.role)}`);
  }
  if (!r.content || typeof r.content !== "object") {
    throw new Error("sampling/createMessage: response missing `content` object");
  }
  const c = r.content as { type?: unknown; text?: unknown };
  if (c.type !== "text" || typeof c.text !== "string") {
    throw new Error("sampling/createMessage: response content must be { type: 'text', text }");
  }
  if (typeof r.model !== "string") {
    throw new Error("sampling/createMessage: response missing `model` string");
  }
  return {
    role: "assistant",
    content: { type: "text", text: c.text },
    model: r.model,
    ...(typeof r.stopReason === "string" ? { stopReason: r.stopReason } : {}),
  };
}
