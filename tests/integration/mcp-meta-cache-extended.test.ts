/**
 * Integration test: opt-in `metaMode: "delta"` across the checklist,
 * coverage, and list_suppressions tools. Mirrors the scan-family
 * contract proven by `mcp-meta-cache.test.ts`:
 *
 *   1. Legacy callers (no `metaMode`) see unchanged response shape —
 *      no `meta` block appears for tools that did not historically
 *      emit one (checklist, coverage), and list_suppressions' existing
 *      `meta` block carries no `sessionRef`/`metaMode` leak.
 *   2. First call with `metaMode: "delta"` returns full meta plus a
 *      `sessionRef` + `metaMode: "full"` marker so the agent has a
 *      baseline to merge subsequent deltas against.
 *   3. Repeat call with the same signature collapses `meta` to
 *      `{ sessionRef, metaMode: "delta", delta, removedFields? }`.
 *      Different-signature call issues a fresh `sessionRef` and ships
 *      full meta again.
 *
 * `list_rules` is intentionally NOT wired — the tool's response is
 * pure enumeration data with no scan-confidence telemetry; caching
 * per-session would be trivial ({ standard?: string }) and the
 * payload itself (`rules`) isn't a meta-cache candidate. See the
 * backlog entry marked "deferred" for rationale.
 */

import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const FIXTURES_DIR = join(PROJECT_ROOT, "tests", "fixtures", "bad", "alt-text-missing");
const FIXTURES_DIR_SINGLE = join(PROJECT_ROOT, "tests", "fixtures", "bad", "alt-text-missing");
const ALT_HTML = join(FIXTURES_DIR, "img-no-alt.html");

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

function initMsg(id: number): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0" },
    },
  };
}

function toolCall(
  id: number,
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

function bodyOf(response: Record<string, unknown>): Record<string, unknown> {
  const result = response.result as { content: Array<{ text: string }> };
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe("MCP meta-cache: opt-in delta mode on checklist / coverage / list_suppressions", () => {
  it("checklist: legacy (no metaMode) emits no meta block; delta mode adds sessionRef baseline and collapses on repeat", async () => {
    const responses = await mcpSession([
      initMsg(1),
      { jsonrpc: "2.0", method: "notifications/initialized" },
      // Legacy caller — must see no `meta` field at all.
      toolCall(2, "checklist", { paths: [FIXTURES_DIR] }),
      // First delta-mode call — full meta + sessionRef baseline.
      toolCall(3, "checklist", { paths: [FIXTURES_DIR], metaMode: "delta" }),
      // Repeat same signature — delta shape.
      toolCall(4, "checklist", { paths: [FIXTURES_DIR], metaMode: "delta" }),
      // Different signature (different paths) — fresh sessionRef.
      toolCall(5, "checklist", { paths: [ALT_HTML], metaMode: "delta" }),
    ]);

    const legacy = bodyOf(responses.find((r) => r.id === 2)!);
    // Legacy shape preserved: checklist had no `meta` historically.
    expect("meta" in legacy).toBe(false);

    const first = bodyOf(responses.find((r) => r.id === 3)!);
    const firstMeta = first.meta as Record<string, unknown>;
    expect(firstMeta["metaMode"]).toBe("full");
    expect(typeof firstMeta["sessionRef"]).toBe("string");
    expect(firstMeta["sessionRef"] as string).toMatch(/^checklist-[0-9a-f]{8}$/);
    // Scan-confidence telemetry rides the baseline.
    expect(typeof firstMeta["filesScanned"]).toBe("number");
    expect(typeof firstMeta["rulesEvaluated"]).toBe("number");
    const firstRef = firstMeta["sessionRef"] as string;

    const second = bodyOf(responses.find((r) => r.id === 4)!);
    const secondMeta = second.meta as Record<string, unknown>;
    expect(secondMeta["metaMode"]).toBe("delta");
    expect(secondMeta["sessionRef"]).toBe(firstRef);
    // Stable telemetry is IMPLICIT under delta — absent from the delta.
    expect("filesScanned" in secondMeta).toBe(false);
    expect("rulesEvaluated" in secondMeta).toBe(false);
    expect("delta" in secondMeta).toBe(true);

    const third = bodyOf(responses.find((r) => r.id === 5)!);
    const thirdMeta = third.meta as Record<string, unknown>;
    expect(thirdMeta["metaMode"]).toBe("full");
    expect(typeof thirdMeta["sessionRef"]).toBe("string");
    expect(thirdMeta["sessionRef"]).not.toBe(firstRef);
  });

  it("coverage: legacy (no metaMode) emits no meta block; delta mode adds sessionRef baseline and collapses on repeat", async () => {
    const responses = await mcpSession([
      initMsg(1),
      { jsonrpc: "2.0", method: "notifications/initialized" },
      toolCall(2, "coverage", { paths: [FIXTURES_DIR] }),
      toolCall(3, "coverage", { paths: [FIXTURES_DIR], metaMode: "delta" }),
      toolCall(4, "coverage", { paths: [FIXTURES_DIR], metaMode: "delta" }),
      toolCall(5, "coverage", { paths: [ALT_HTML], metaMode: "delta" }),
    ]);

    const legacy = bodyOf(responses.find((r) => r.id === 2)!);
    // Legacy shape preserved: coverage had no `meta` historically.
    expect("meta" in legacy).toBe(false);

    const first = bodyOf(responses.find((r) => r.id === 3)!);
    const firstMeta = first.meta as Record<string, unknown>;
    expect(firstMeta["metaMode"]).toBe("full");
    expect(typeof firstMeta["sessionRef"]).toBe("string");
    expect(firstMeta["sessionRef"] as string).toMatch(/^coverage-[0-9a-f]{8}$/);
    expect(typeof firstMeta["filesScanned"]).toBe("number");
    expect(typeof firstMeta["rulesEvaluated"]).toBe("number");
    const firstRef = firstMeta["sessionRef"] as string;

    const second = bodyOf(responses.find((r) => r.id === 4)!);
    const secondMeta = second.meta as Record<string, unknown>;
    expect(secondMeta["metaMode"]).toBe("delta");
    expect(secondMeta["sessionRef"]).toBe(firstRef);
    expect("filesScanned" in secondMeta).toBe(false);
    expect("rulesEvaluated" in secondMeta).toBe(false);

    const third = bodyOf(responses.find((r) => r.id === 5)!);
    const thirdMeta = third.meta as Record<string, unknown>;
    expect(thirdMeta["metaMode"]).toBe("full");
    expect(thirdMeta["sessionRef"]).not.toBe(firstRef);
  });

  it("list_suppressions: legacy meta carries no sessionRef leak; delta mode wraps the existing meta block", async () => {
    // list_suppressions uses the MCP server root (cwd defaulted from
    // spawn). That's good enough here — we just need any path the
    // server can enumerate. Using the fixtures dir keeps the response
    // small and deterministic across runs.
    const responses = await mcpSession([
      initMsg(1),
      { jsonrpc: "2.0", method: "notifications/initialized" },
      toolCall(2, "list_suppressions", { cwd: FIXTURES_DIR_SINGLE }),
      toolCall(3, "list_suppressions", { cwd: FIXTURES_DIR_SINGLE, metaMode: "delta" }),
      toolCall(4, "list_suppressions", { cwd: FIXTURES_DIR_SINGLE, metaMode: "delta" }),
      toolCall(5, "list_suppressions", { cwd: PROJECT_ROOT, metaMode: "delta" }),
    ]);

    const legacy = bodyOf(responses.find((r) => r.id === 2)!);
    const legacyMeta = legacy.meta as Record<string, unknown>;
    // Legacy meta stays — no sessionRef / metaMode leak.
    expect(typeof legacyMeta["filesScanned"]).toBe("number");
    expect("sessionRef" in legacyMeta).toBe(false);
    expect("metaMode" in legacyMeta).toBe(false);

    const first = bodyOf(responses.find((r) => r.id === 3)!);
    const firstMeta = first.meta as Record<string, unknown>;
    expect(firstMeta["metaMode"]).toBe("full");
    expect(typeof firstMeta["sessionRef"]).toBe("string");
    expect(firstMeta["sessionRef"] as string).toMatch(/^list_suppressions-[0-9a-f]{8}$/);
    expect(typeof firstMeta["filesScanned"]).toBe("number");
    expect(typeof firstMeta["rulesEvaluated"]).toBe("number");
    const firstRef = firstMeta["sessionRef"] as string;

    const second = bodyOf(responses.find((r) => r.id === 4)!);
    const secondMeta = second.meta as Record<string, unknown>;
    expect(secondMeta["metaMode"]).toBe("delta");
    expect(secondMeta["sessionRef"]).toBe(firstRef);
    expect("filesScanned" in secondMeta).toBe(false);
    expect("rulesEvaluated" in secondMeta).toBe(false);

    const third = bodyOf(responses.find((r) => r.id === 5)!);
    const thirdMeta = third.meta as Record<string, unknown>;
    expect(thirdMeta["metaMode"]).toBe("full");
    expect(thirdMeta["sessionRef"]).not.toBe(firstRef);
  });
});
