/**
 * Unit tests for `src/mcp/outbound.ts` — the server → host JSON-RPC
 * plumbing that handles server-initiated requests (e.g. `sampling/createMessage`)
 * and correlates their replies back to the pending promise.
 *
 * The rail is exercised with a recorder `write` callback so we can inspect
 * the exact JSON lines emitted, and with manual `tryRouteResponse` calls
 * mirroring what the server's read loop does per inbound message. No
 * transport / stdio.
 */

import { describe, expect, it } from "bun:test";
import { createOutbound } from "../../../src/mcp/outbound.ts";

function parseLine(line: string): {
  readonly jsonrpc: string;
  readonly id: number;
  readonly method: string;
  readonly params: unknown;
} {
  return JSON.parse(line.trim()) as {
    readonly jsonrpc: string;
    readonly id: number;
    readonly method: string;
    readonly params: unknown;
  };
}

const noopWrite = (_line: string): void => {
  // discard — tests that don't inspect the wire bytes
};
const noopUnknownId = (_id: string | number): void => {
  // discard — tests that don't exercise the unknown-id path
};

describe("createOutbound", () => {
  describe("sendRequest", () => {
    it("writes a JSON-RPC request with a monotonically increasing numeric id", () => {
      const written: string[] = [];
      const rail = createOutbound((line) => written.push(line), noopUnknownId);
      void rail.sendRequest("sampling/createMessage", { a: 1 }, 10_000);
      void rail.sendRequest("roots/list", null, 10_000);
      expect(written).toHaveLength(2);
      expect(parseLine(written[0] ?? "")).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        method: "sampling/createMessage",
      });
      expect(parseLine(written[1] ?? "").id).toBe(2);
    });

    it("resolves with the `result` field when a matching response is routed", async () => {
      const written: string[] = [];
      const rail = createOutbound((line) => written.push(line), noopUnknownId);
      const pending = rail.sendRequest("sampling/createMessage", {}, 10_000);
      const id = parseLine(written[0] ?? "").id;
      const routed = rail.tryRouteResponse({ jsonrpc: "2.0", id, result: { content: "ok" } });
      expect(routed).toBe(true);
      await expect(pending).resolves.toEqual({ content: "ok" });
    });

    it("rejects with an Error carrying the host's error message when the response is an error envelope", async () => {
      const written: string[] = [];
      const rail = createOutbound((line) => written.push(line), noopUnknownId);
      const pending = rail.sendRequest("sampling/createMessage", {}, 10_000);
      const id = parseLine(written[0] ?? "").id;
      rail.tryRouteResponse({ jsonrpc: "2.0", id, error: { message: "host declined" } });
      await expect(pending).rejects.toThrow("host declined");
    });

    it("rejects with a timeout error when no response is routed within timeoutMs", async () => {
      const rail = createOutbound(noopWrite, noopUnknownId);
      const pending = rail.sendRequest("sampling/createMessage", {}, 5);
      await expect(pending).rejects.toThrow(/timed out after 5ms/);
    });
  });

  describe("tryRouteResponse", () => {
    it("returns false for a new inbound request (has `method`), letting the caller dispatch it", () => {
      const rail = createOutbound(noopWrite, noopUnknownId);
      const routed = rail.tryRouteResponse({ jsonrpc: "2.0", id: 7, method: "tools/call" });
      expect(routed).toBe(false);
    });

    it("returns false when the shape is not a JSON-RPC 2.0 envelope", () => {
      const rail = createOutbound(noopWrite, noopUnknownId);
      expect(rail.tryRouteResponse(null)).toBe(false);
      expect(rail.tryRouteResponse("oops")).toBe(false);
      expect(rail.tryRouteResponse({ jsonrpc: "1.0", id: 1, result: {} })).toBe(false);
      expect(rail.tryRouteResponse({ jsonrpc: "2.0" })).toBe(false);
    });

    it("swallows string-id responses (our outbound ids are numeric) without dispatching", () => {
      const seen: (string | number)[] = [];
      const rail = createOutbound(noopWrite, (id) => seen.push(id));
      const routed = rail.tryRouteResponse({ jsonrpc: "2.0", id: "not-ours", result: {} });
      expect(routed).toBe(true);
      expect(seen).toEqual([]);
    });

    it("reports unknown numeric ids via onUnknownId and returns true (never reply to a reply)", () => {
      const seen: (string | number)[] = [];
      const rail = createOutbound(noopWrite, (id) => seen.push(id));
      const routed = rail.tryRouteResponse({ jsonrpc: "2.0", id: 999, result: {} });
      expect(routed).toBe(true);
      expect(seen).toEqual([999]);
    });

    it("clears the pending entry so a late duplicate response is treated as unknown", async () => {
      const written: string[] = [];
      const seen: (string | number)[] = [];
      const rail = createOutbound(
        (line) => written.push(line),
        (id) => seen.push(id),
      );
      const pending = rail.sendRequest("sampling/createMessage", {}, 10_000);
      const id = parseLine(written[0] ?? "").id;
      rail.tryRouteResponse({ jsonrpc: "2.0", id, result: { done: true } });
      await pending;
      rail.tryRouteResponse({ jsonrpc: "2.0", id, result: { done: "again" } });
      expect(seen).toEqual([id]);
    });
  });
});
