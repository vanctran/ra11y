/**
 * Scripted MCP host for offline prompt + sampling evals.
 *
 * An `McpSession` preconfigured with the `sampling` capability and a
 * `sendRequest` slot that records every outbound call and returns a
 * queued canned response. Reusable by future sampling-backed
 * integration tests — no real stdio, network, or LLM.
 */

import {
  SamplingNotSupportedError,
  type SamplingRequest,
  type SamplingResult,
} from "../../src/mcp/sampling.ts";
import { McpSession } from "../../src/mcp/session.ts";

/** One recorded outbound call. `params` is the raw object the tool passed. */
export interface RecordedCall {
  readonly method: string;
  readonly params: unknown;
  readonly timeoutMs: number;
}

/** Queued response. Supply a `result` (resolves) or an `error` (rejects). */
export type CannedResponse =
  | { readonly kind: "result"; readonly result: SamplingResult }
  | { readonly kind: "error"; readonly error: Error };

/** Most calls want a plain assistant text reply; this builds one. */
export function cannedText(text: string, model = "scripted-model"): CannedResponse {
  return {
    kind: "result",
    result: { role: "assistant", content: { type: "text", text }, model, stopReason: "endTurn" },
  };
}

export interface ScriptedHost {
  readonly session: McpSession;
  readonly calls: readonly RecordedCall[];
  enqueue(response: CannedResponse): void;
  enqueueText(text: string, model?: string): void;
  /** Build a fresh session the host never declared `sampling` on. */
  withoutSampling(): McpSession;
  pendingResponseCount(): number;
}

/**
 * Build a scripted host. Calls consume responses FIFO; an unqueued
 * call rejects loudly rather than hanging, so tests fail fast when
 * they forget to enqueue.
 */
export function createScriptedHost(): ScriptedHost {
  const calls: RecordedCall[] = [];
  const queue: CannedResponse[] = [];
  const session = new McpSession();
  session.setHostCapabilities({ sampling: {} });
  session.sendRequest = (method, params, timeoutMs) => {
    calls.push({ method, params, timeoutMs });
    const next = queue.shift();
    if (!next) {
      return Promise.reject(
        new Error(`scripted-host: no canned response queued for ${method} call #${calls.length}`),
      );
    }
    if (next.kind === "error") return Promise.reject(next.error);
    return Promise.resolve(next.result);
  };
  return {
    session,
    get calls() {
      return calls;
    },
    enqueue(r) {
      queue.push(r);
    },
    enqueueText(t, m) {
      queue.push(cannedText(t, m));
    },
    withoutSampling() {
      return new McpSession();
    },
    pendingResponseCount() {
      return queue.length;
    },
  };
}

/** Convert rendered prompt messages into a `SamplingRequest`. */
export function promptToSamplingRequest(
  messages: readonly {
    readonly role: "user" | "assistant";
    readonly content: { readonly type: "text"; readonly text: string };
  }[],
  maxTokens = 1024,
): SamplingRequest {
  return {
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    maxTokens,
  };
}

export { SamplingNotSupportedError };
