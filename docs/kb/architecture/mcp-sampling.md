---
title: "MCP sampling architecture"
description: "How ra11y requests host-side model calls via sampling/createMessage — bidirectional loop, capability gating, error model, and usage pattern."
tags: [mcp, sampling, architecture]
topic: architecture
audience: agents, contributors
last_updated: 2026-04-17
---

# MCP sampling architecture

MCP sampling is the server-initiated half of the bidirectional protocol: ra11y's server sends `sampling/createMessage` to the host, the host runs the completion on its own model and key, and the result comes back through the same stdio channel. ra11y never holds an API key or imports the Anthropic SDK. See [ADR 0005](../../adr/0005-in-house-mcp-server.md) for the decision rationale; this page is the runtime walkthrough.

## Why sampling instead of a bundled LLM client

Three hard constraints rule out a bundled client:

- **Zero runtime dependencies** (ADR 0001). Importing `@anthropic-ai/sdk` or any HTTP client breaks this invariant; `dependencies: {}` is enforced by CI.
- **Network isolation**. `src/` may not reference `fetch`, `node:http`, or `Bun.fetch`. Compliance users running ra11y against proprietary source must trust the tool is offline.
- **No API-key surface**. A tool that reads proprietary source and sends it to a third-party endpoint creates a data-handling concern. The host — Claude Code, Cursor, Zed, Continue — already holds the user's key and already sends their code to the model. ra11y delegates the call, not the secret.

The tradeoff: if the host does not declare the `sampling` capability, sampling-backed tools must degrade. The degradation path (return the prompt for the agent to run inline) is treated as first-class design, not a fallback afterthought.

## Files

| File | Role |
|------|------|
| `src/mcp/sampling.ts` | Public surface: `sample()`, `SamplingRequest`, `SamplingResult`, error classes, `DEFAULT_SAMPLING_TIMEOUT_MS`. |
| `src/mcp/outbound.ts` | Transport: `createOutbound()` — pending-map, per-call timeout, `tryRouteResponse()`. |
| `src/mcp/session.ts` | State: `hostCapabilities.sampling`, `sendRequest: SendRequest \| null`. |
| `src/mcp/server.ts` | Wiring: reads `initialize.params.capabilities`, sets `session.sendRequest`, calls `outbound.tryRouteResponse(parsed)` before the inbound-request guard. |

## The bidirectional stdio loop

MCP is bidirectional over one pair of streams. The server normally answers requests from the host; sampling inverts that for one method. On a single `sampling/createMessage` roundtrip:

```
ra11y server                         Host (Claude Code, Cursor, …)
     │                                          │
     │── { jsonrpc:"2.0", id:1,                 │
     │     method:"sampling/createMessage",      │
     │     params: { messages, maxTokens, … } }─▶│
     │                                          │
     │                                          │  runs model call
     │                                          │  with its own key
     │◀─ { jsonrpc:"2.0", id:1,                 │
     │     result: { role:"assistant",           │
     │       content:{ type:"text", text:"…" },  │
     │       model:"claude-…" } }               │
```

**The server holds pending state; the host does not.** `createOutbound()` (`src/mcp/outbound.ts:44`) maintains a `Map<number, PendingOutbound>` keyed by the request's integer `id`. The ID is auto-incremented (`nextId = 1`; `src/mcp/outbound.ts:49`) so every outbound call gets a unique key. When the host's reply arrives on stdin, `tryRouteResponse()` (`src/mcp/outbound.ts:63`) checks whether the parsed message is a JSON-RPC response (has `id`, has `result` or `error`, no `method`) and resolves or rejects the matching promise. If no entry exists for the ID the response is silently dropped and reported via the `onUnknownId` callback.

The read loop in `server.ts` (line 152) calls `outbound.tryRouteResponse(parsed)` **before** the inbound-request guard — responses lack a `method` field and would fail `isJsonRpcRequest`, so the order is required for correctness.

## Capability gating

The host declares its client capabilities in `initialize.params.capabilities`. `server.ts` passes the raw value to `session.setHostCapabilities()` (`src/mcp/session.ts:114`):

```ts
// session.ts:114–122
setHostCapabilities(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const obj = raw as Record<string, unknown>;
  this.hostCaps = {
    sampling: "sampling" in obj,
    roots:    "roots"    in obj,
    elicitation: "elicitation" in obj,
  };
}
```

Presence of the key is the only signal per spec; values are reserved for future use. `session.hostCapabilities.sampling` is `boolean`.

`sample()` (`src/mcp/sampling.ts:125–126`) checks both guards before touching the transport:

```ts
if (!session.hostCapabilities.sampling) throw new SamplingNotSupportedError();
if (session.sendRequest === null)        throw new SamplingTransportUnavailableError();
```

`session.sendRequest` is `null` at construction time and is wired by `startMcpServer()` (`src/mcp/server.ts:129`) to `outbound.sendRequest` immediately after the outbound rail is created. In unit tests that construct `McpSession` directly without a running server, `sendRequest` stays `null`.

## The two error classes

`src/mcp/sampling.ts` exports two distinct error classes with different expected caller responses:

**`SamplingNotSupportedError`** — host did not declare `sampling` in its `initialize` capabilities. Expected fallback: return the prompt string to the agent to run the model call inline. This is a user-configuration gap, not a ra11y bug.

**`SamplingTransportUnavailableError`** — host declared `sampling` but `session.sendRequest` is null. This indicates a programmer error: either `startMcpServer` was not called before a tool tried to sample, or a unit test that directly instantiates `McpSession` is exercising a sampling-backed tool path. The correct fix is a missing `startMcpServer` call, not a user-facing degradation path.

Callers must `catch` these separately:

```ts
try {
  const result = await sample(session, request);
  // use result.content.text
} catch (err) {
  if (err instanceof SamplingNotSupportedError) {
    // degrade: return promptText to caller so agent runs inline
    return { promptText };
  }
  throw err; // SamplingTransportUnavailableError and unknown errors propagate
}
```

## Request/response coercion

The host's reply is `unknown` from the transport's perspective — `sendRequest` returns `Promise<unknown>`. `coerceResult()` (`src/mcp/sampling.ts:138–167`) narrows the value to `SamplingResult` with explicit throws on each field:

- Not an object → `"response was not an object"`
- `role !== "assistant"` → role mismatch message
- Missing or non-object `content` → `"response missing content object"`
- `content.type !== "text"` or non-string `text` → type mismatch message
- Non-string `model` → `"response missing model string"`

`stopReason` is optional and is conditionally spread (`...(typeof r.stopReason === "string" ? { stopReason: r.stopReason } : {})`), following the project's ambiguous-field rule: omit when absent rather than emitting `stopReason: undefined`.

The motivation: a bad host payload that slips through as `undefined` causes a silent runtime error deep in the caller's logic (e.g. `result.content.text` throws `Cannot read properties of undefined`). A typed throw at the boundary surfaces the contract violation immediately with a clear message and a clean stack.

## Timeout model

`DEFAULT_SAMPLING_TIMEOUT_MS = 60_000` (`src/mcp/sampling.ts:71`). Sampling roundtrips through the host to a real model — the default is generous but bounded.

`sample()` accepts an optional `timeoutMs` override as a third parameter (`src/mcp/sampling.ts:123`). The timeout is set via `setTimeout` inside `createOutbound().sendRequest` (`src/mcp/outbound.ts:54–57`): when it fires, the pending entry is deleted and the promise rejects with `"${method} request timed out after ${timeoutMs}ms"`. The error bubbles through `sample()` as a plain `Error` — not one of the two typed classes.

Callers that want to distinguish timeout from host error should inspect `err.message` for the `"timed out"` suffix, or wrap with a short label on the caller side.

## How a sampling-backed tool should call this

Minimal pattern with graceful degradation:

```ts
import { sample, SamplingNotSupportedError } from "../sampling.ts";
import type { McpSession } from "../session.ts";

async function verdictCandidate(
  session: McpSession,
  snippetText: string,
): Promise<{ verdict: string } | { promptText: string }> {
  const promptText = buildVerdict Prompt(snippetText); // your prompt builder

  try {
    const result = await sample(session, {
      messages: [{ role: "user", content: { type: "text", text: promptText } }],
      maxTokens: 512,
      systemPrompt: "You are an accessibility expert reviewing a code snippet.",
    });
    return { verdict: result.content.text };
  } catch (err) {
    if (err instanceof SamplingNotSupportedError) {
      // Agent will run the prompt itself. Return it as data.
      return { promptText };
    }
    throw err;
  }
}
```

Tool response shape rule: when degrading, include `promptText` (the string to run) in the response so the agent can act without a second round-trip. Do not include `verdict` when degraded — ambiguous fields with conditional population violate the project's field-shape policy.

`ModelPreferences` (`src/mcp/sampling.ts:42–47`) lets you hint at cost/speed/intelligence tradeoffs and optional model name hints, but keep hints advisory — the host chooses. Do not name a specific model version to avoid the "bit-rots across model generations" failure mode (ADR 0005).

## Integration test coverage

`tests/integration/mcp-protocol.test.ts` contains the bidirectional-loop guard at the protocol level:

```ts
it("silently drops an unsolicited JSON-RPC response (no method) and keeps serving subsequent requests", async () => {
  const responses = await mcpSession([
    { jsonrpc: "2.0", id: 99999, result: { role: "assistant" } },
    initMsg(1),
  ]);
  expect(responses.length).toBe(1);   // unsolicited dropped
  expect(responses[0].id).toBe(1);    // initialize answered correctly
});
```

This guards the `tryRouteResponse → continue` path for unknown-ID responses.

End-to-end roundtrip coverage (`tests/integration/mcp-sampling.test.ts`) lands once the first sampling-backed tool ships (planned: `verdict_candidate`). That test will spawn the server, inject a synthetic host-side reply on stdin, and assert the tool result carries the model's text.

## See also

- [ADR 0005](../../adr/0005-in-house-mcp-server.md) — shipping decision: in-house server + sampling over API-key client.
- [MCP server architecture](./mcp-server.md) — overall server shape, tool list, session lifecycle.
- [`src/mcp/sampling.ts`](../../../src/mcp/sampling.ts) — `sample()`, error classes, `SamplingRequest`/`SamplingResult` types.
- [`src/mcp/outbound.ts`](../../../src/mcp/outbound.ts) — `createOutbound()`, pending map, `tryRouteResponse()`.
- [`src/mcp/session.ts`](../../../src/mcp/session.ts) — `hostCapabilities`, `sendRequest`, `HostCapabilities` interface.
