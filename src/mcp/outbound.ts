/**
 * Server-to-host JSON-RPC plumbing. MCP is bidirectional: the server
 * mostly answers requests, but it can also *initiate* requests (e.g.
 * `sampling/createMessage`) and await a correlated reply. This module
 * owns that half of the read loop so `server.ts` doesn't bulge.
 *
 * Contract: call {@link createOutbound} once per server lifetime. The
 * returned `sendRequest` is wired onto the session so tool handlers
 * can invoke sampling without knowing about the transport. The
 * returned `tryRouteResponse` gets first look at every inbound
 * message — if it matches a pending outbound id, the method returns
 * `true` and the read loop moves on instead of dispatching the
 * message as a new request.
 */

import type { SendRequest } from "./session.ts";

/** Shape of a pending server-initiated request. */
interface PendingOutbound {
  readonly resolve: (value: unknown) => void;
  readonly reject: (err: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly method: string;
}

export interface OutboundRail {
  /**
   * Send a JSON-RPC request from server → host and return a promise
   * that resolves with the host's `result` or rejects on error or
   * timeout.
   */
  readonly sendRequest: SendRequest;
  /**
   * Inspect an inbound message: if it's a response correlating with
   * a pending outbound id, resolve/reject the promise and return
   * `true`. Otherwise return `false` so the caller can dispatch it
   * as a normal request. Unknown-id responses are silently dropped
   * and reported via `onUnknownId` (so the caller can log under
   * their own logger) — we never reply to a reply.
   */
  tryRouteResponse(message: unknown): boolean;
}

export function createOutbound(
  write: (line: string) => void,
  onUnknownId: (id: string | number) => void,
): OutboundRail {
  const pending = new Map<number, PendingOutbound>();
  let nextId = 1;

  function sendRequest(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeout, method });
      write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  function tryRouteResponse(message: unknown): boolean {
    if (!isJsonRpcResponse(message)) return false;
    const id = message.id;
    if (typeof id !== "number") return true; // drop — our outbound ids are always numeric
    const entry = pending.get(id);
    if (!entry) {
      onUnknownId(id);
      return true;
    }
    clearTimeout(entry.timeout);
    pending.delete(id);
    if (message.error) {
      entry.reject(new Error(message.error.message));
    } else {
      entry.resolve(message.result);
    }
    return true;
  }

  return { sendRequest, tryRouteResponse };
}

/** Narrow shape of an inbound JSON-RPC response. */
interface JsonRpcResponseLite {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly message: string };
}

/**
 * A JSON-RPC *response* carries an `id` and either `result` or
 * `error` but never a `method`. Distinguishes replies to our
 * server-initiated requests from new inbound requests the host is
 * making of us.
 */
function isJsonRpcResponse(value: unknown): value is JsonRpcResponseLite {
  if (!value || typeof value !== "object") return false;
  const obj = value as {
    jsonrpc?: unknown;
    id?: unknown;
    method?: unknown;
    result?: unknown;
    error?: unknown;
  };
  if (obj.jsonrpc !== "2.0") return false;
  if (obj.method !== undefined) return false;
  if (obj.id === undefined) return false;
  return obj.result !== undefined || obj.error !== undefined;
}
