/**
 * Integration test: opt-in `metaMode: "delta"` end-to-end through a
 * real MCP subprocess.
 *
 * Three round-trip invariants:
 *
 *  1. Legacy callers (no `metaMode`) see unchanged `meta` shape —
 *     no `sessionRef`, no `metaMode` field, no cache side effects.
 *  2. First call with `metaMode: "delta"` returns full `meta` plus a
 *     `sessionRef` + `metaMode: "full"` marker so the agent has a
 *     baseline to merge subsequent deltas against.
 *  3. A second call with the same signature collapses `meta` to
 *     `{ sessionRef, metaMode: "delta", delta, removedFields? }`. A
 *     different-signature call issues a fresh `sessionRef` and ships
 *     full `meta` again.
 */

import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const BAD_ALT = join(
  PROJECT_ROOT,
  "tests",
  "fixtures",
  "bad",
  "alt-text-missing",
  "img-no-alt.html",
);
const FIXTURES_DIR = join(PROJECT_ROOT, "tests", "fixtures", "bad", "alt-text-missing");

async function mcpSession(
  messages: readonly Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", "--mcp"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: PROJECT_ROOT,
  });

  const payload = `${messages.map((m) => JSON.stringify(m)).join("\n")}\n`;
  proc.stdin.write(payload);
  proc.stdin.end();

  const text = await new Response(proc.stdout).text();
  proc.kill();

  return text
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function toolCall(
  id: number,
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

function parseScanPayload(response: Record<string, unknown>): Record<string, unknown> {
  const result = response.result as { content: Array<{ text: string }> };
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function metaOf(payload: Record<string, unknown>): Record<string, unknown> {
  return payload.meta as Record<string, unknown>;
}

describe("MCP meta-cache: opt-in delta mode", () => {
  it("legacy callers (no metaMode) see unchanged response shape", async () => {
    const responses = await mcpSession([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      toolCall(2, "scan", { paths: [BAD_ALT] }),
      toolCall(3, "scan", { paths: [BAD_ALT] }),
    ]);

    expect(responses.length).toBe(3);
    const firstMeta = metaOf(parseScanPayload(responses[1]!));
    const secondMeta = metaOf(parseScanPayload(responses[2]!));

    // No meta-cache fields leak when the caller never opted in.
    expect("sessionRef" in firstMeta).toBe(false);
    expect("metaMode" in firstMeta).toBe(false);
    expect("sessionRef" in secondMeta).toBe(false);
    expect("metaMode" in secondMeta).toBe(false);

    // Full meta telemetry is present on both responses as before.
    expect(typeof firstMeta.filesScanned).toBe("number");
    expect(typeof secondMeta.rulesEvaluated).toBe("number");
  });

  it("first delta-mode call returns full meta + sessionRef; repeat collapses to delta", async () => {
    const responses = await mcpSession([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      toolCall(2, "scan", { paths: [BAD_ALT], metaMode: "delta" }),
      toolCall(3, "scan", { paths: [BAD_ALT], metaMode: "delta" }),
      // A different-signature call issues a FRESH sessionRef and ships
      // full meta again. This is the eviction/replacement contract.
      toolCall(4, "scan", { paths: [FIXTURES_DIR], metaMode: "delta" }),
    ]);

    const first = metaOf(parseScanPayload(responses[1]!));
    const second = metaOf(parseScanPayload(responses[2]!));
    const third = metaOf(parseScanPayload(responses[3]!));

    // First call: full meta + sessionRef + metaMode: "full"
    expect(first["metaMode"]).toBe("full");
    expect(typeof first["sessionRef"]).toBe("string");
    expect(first["sessionRef"] as string).toMatch(/^scan-[0-9a-f]{8}$/);
    expect(typeof first["filesScanned"]).toBe("number");
    expect(typeof first["rulesEvaluated"]).toBe("number");
    const firstRef = first["sessionRef"] as string;

    // Second call under same signature: delta-shape, same sessionRef.
    expect(second["metaMode"]).toBe("delta");
    expect(second["sessionRef"]).toBe(firstRef);
    expect("delta" in second).toBe(true);
    // The load-bearing contract: unchanged fields are IMPLICIT. A
    // response that collapses to a (possibly empty) delta is NOT
    // confusable with "tool never ran" — metaMode labels the shape
    // explicitly.
    expect("filesScanned" in second).toBe(false);
    expect("rulesEvaluated" in second).toBe(false);

    // Third call with different paths: fresh sessionRef, full meta.
    expect(third["metaMode"]).toBe("full");
    expect(typeof third["sessionRef"]).toBe("string");
    expect(third["sessionRef"]).not.toBe(firstRef);
    expect(typeof third["filesScanned"]).toBe("number");
  });

  it("delta shape surfaces only changed fields when nothing else drifted", async () => {
    // Two identical scans back-to-back: the only field that can
    // realistically differ is `durationMs` (and possibly the per-scan
    // `nextStep` prose if it varies). Everything else — filesScanned,
    // rulesEvaluated, standards, filesByExtension — must be stable.
    // This exercises the shape guarantee under the "same inputs, same
    // outputs" assumption the cache is built on.
    const responses = await mcpSession([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      toolCall(2, "scan_file", { path: BAD_ALT, metaMode: "delta" }),
      toolCall(3, "scan_file", { path: BAD_ALT, metaMode: "delta" }),
    ]);

    const second = metaOf(parseScanPayload(responses[2]!));
    expect(second["metaMode"]).toBe("delta");
    const delta = second["delta"] as Record<string, unknown>;

    // Stable meta telemetry MUST NOT appear in the delta (unchanged
    // fields are implicit). If this asserts fail, the hash is too
    // narrow or jsonEqual is wrong.
    expect("filesScanned" in delta).toBe(false);
    expect("rulesEvaluated" in delta).toBe(false);
    expect("scannedFile" in delta).toBe(false);
    expect("configSource" in delta).toBe(false);
    expect("standards" in delta).toBe(false);
    expect("filesByExtension" in delta).toBe(false);
  });
});
