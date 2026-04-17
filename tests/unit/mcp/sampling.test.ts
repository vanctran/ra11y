/**
 * Unit tests for the MCP sampling client helper.
 *
 * Covers the invariants that don't require a real stdio roundtrip:
 *   - Capability gating — hosts that didn't declare `sampling` raise
 *     a distinct error from hosts that did but have no transport.
 *   - Request shape — the method name and params flow through to the
 *     session's `sendRequest` verbatim (no silent reshape).
 *   - Response coercion — valid shapes pass through; the missing-field
 *     and wrong-role cases raise clear errors so callers aren't fed
 *     `undefined` downstream.
 *   - Timeout override — the caller's value reaches `sendRequest`.
 *
 * The bidirectional stdio roundtrip is exercised in
 * `tests/integration/mcp-sampling.test.ts`.
 */

import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SAMPLING_TIMEOUT_MS,
  SamplingNotSupportedError,
  type SamplingRequest,
  type SamplingResult,
  SamplingTransportUnavailableError,
  sample,
} from "../../../src/mcp/sampling.ts";
import { McpSession } from "../../../src/mcp/session.ts";

function makeReq(): SamplingRequest {
  return {
    messages: [{ role: "user", content: { type: "text", text: "hello" } }],
    maxTokens: 256,
  };
}

function validResult(): SamplingResult {
  return {
    role: "assistant",
    content: { type: "text", text: "hi back" },
    model: "claude-opus-4-7",
    stopReason: "endTurn",
  };
}

describe("sampling capability gating", () => {
  it("raises SamplingNotSupportedError when the host did not declare `sampling` in initialize", async () => {
    const session = new McpSession();
    // No capability set → default is { sampling: false }.
    await expect(sample(session, makeReq())).rejects.toBeInstanceOf(SamplingNotSupportedError);
  });

  it("raises SamplingTransportUnavailableError when capability is present but transport is not wired", async () => {
    const session = new McpSession();
    session.setHostCapabilities({ sampling: {} });
    // sendRequest remains null — no server loop ever ran.
    await expect(sample(session, makeReq())).rejects.toBeInstanceOf(
      SamplingTransportUnavailableError,
    );
  });

  it("treats a non-object `capabilities` value from the host as no-capability (not a crash)", () => {
    const session = new McpSession();
    session.setHostCapabilities("not-an-object");
    expect(session.hostCapabilities.sampling).toBe(false);
  });

  it("records `roots` and `elicitation` alongside `sampling` so other host-initiated methods can gate the same way", () => {
    const session = new McpSession();
    session.setHostCapabilities({ sampling: {}, roots: { listChanged: true }, elicitation: {} });
    expect(session.hostCapabilities).toEqual({
      sampling: true,
      roots: true,
      elicitation: true,
    });
  });
});

describe("sampling request/response flow", () => {
  it("forwards method name, params, and default timeout to sendRequest and returns the coerced result", async () => {
    const session = new McpSession();
    session.setHostCapabilities({ sampling: {} });
    const calls: Array<{ method: string; params: unknown; timeoutMs: number }> = [];
    session.sendRequest = (method, params, timeoutMs) => {
      calls.push({ method, params, timeoutMs });
      return Promise.resolve(validResult());
    };

    const req = makeReq();
    const out = await sample(session, req);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("sampling/createMessage");
    expect(calls[0]?.params).toBe(req); // Identity — no silent reshape.
    expect(calls[0]?.timeoutMs).toBe(DEFAULT_SAMPLING_TIMEOUT_MS);
    expect(out.role).toBe("assistant");
    expect(out.content).toEqual({ type: "text", text: "hi back" });
    expect(out.model).toBe("claude-opus-4-7");
    expect(out.stopReason).toBe("endTurn");
  });

  it("passes a caller-supplied timeout through to sendRequest", async () => {
    const session = new McpSession();
    session.setHostCapabilities({ sampling: {} });
    let seen = 0;
    session.sendRequest = (_method, _params, timeoutMs) => {
      seen = timeoutMs;
      return Promise.resolve(validResult());
    };

    await sample(session, makeReq(), 12_345);
    expect(seen).toBe(12_345);
  });

  it("omits `stopReason` from the result when the host response doesn't include one", async () => {
    const session = new McpSession();
    session.setHostCapabilities({ sampling: {} });
    session.sendRequest = () =>
      Promise.resolve({
        role: "assistant",
        content: { type: "text", text: "ok" },
        model: "some-model",
      });
    const out = await sample(session, makeReq());
    expect(out.stopReason).toBeUndefined();
    expect(out.model).toBe("some-model");
  });

  it("rejects a host response whose role is not `assistant`", async () => {
    const session = new McpSession();
    session.setHostCapabilities({ sampling: {} });
    session.sendRequest = () =>
      Promise.resolve({
        role: "user",
        content: { type: "text", text: "oops" },
        model: "x",
      });
    await expect(sample(session, makeReq())).rejects.toThrow(/role "assistant"/);
  });

  it("rejects a host response missing the `content` object", async () => {
    const session = new McpSession();
    session.setHostCapabilities({ sampling: {} });
    session.sendRequest = () => Promise.resolve({ role: "assistant", model: "x" });
    await expect(sample(session, makeReq())).rejects.toThrow(/missing `content`/);
  });

  it("rejects a non-text content type (image/audio) — ra11y only handles text", async () => {
    const session = new McpSession();
    session.setHostCapabilities({ sampling: {} });
    session.sendRequest = () =>
      Promise.resolve({
        role: "assistant",
        content: { type: "image", data: "…" },
        model: "x",
      });
    await expect(sample(session, makeReq())).rejects.toThrow(/type: 'text'/);
  });

  it("rejects a host response missing the `model` identifier", async () => {
    const session = new McpSession();
    session.setHostCapabilities({ sampling: {} });
    session.sendRequest = () =>
      Promise.resolve({
        role: "assistant",
        content: { type: "text", text: "ok" },
      });
    await expect(sample(session, makeReq())).rejects.toThrow(/`model` string/);
  });

  it("propagates rejections from the transport (timeouts, host errors)", async () => {
    const session = new McpSession();
    session.setHostCapabilities({ sampling: {} });
    session.sendRequest = () =>
      Promise.reject(new Error("sampling/createMessage request timed out after 100ms"));
    await expect(sample(session, makeReq())).rejects.toThrow(/timed out/);
  });
});
