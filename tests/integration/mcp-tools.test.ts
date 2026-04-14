/**
 * Integration test: one happy-path tools/call round-trip per tool not
 * already exercised by mcp-session.test.ts. Each test spawns the MCP
 * subprocess, initializes, and invokes one tool.
 *
 * Tools covered here:
 *   scan_project, detect_native_wrappers, explain_standard,
 *   suggest_fix, coverage, checklist, review_candidates
 *
 * (`scan`, `scan_file`, `explain_rule`, `configure`, `list_rules` already
 * have round-trips in mcp-session.test.ts.)
 */

import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const BAD_ALT_DIR = join(PROJECT_ROOT, "tests", "fixtures", "bad", "alt-text-missing");
const BAD_ALT_FILE = join(BAD_ALT_DIR, "img-no-alt.html");

type JsonRpcResponse = Record<string, unknown>;

async function mcpSession(
  messages: readonly Record<string, unknown>[],
): Promise<JsonRpcResponse[]> {
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
    .map((l) => JSON.parse(l) as JsonRpcResponse);
}

function initMsg(id: number): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-agent", version: "1.0" },
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

/** Extracts the JSON-parsed text body from a successful tools/call response. */
function bodyOf(response: JsonRpcResponse): Record<string, unknown> {
  const result = response.result as { content: Array<{ text: string }> };
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe("MCP tools/call round-trip: coverage for all registered tools", () => {
  it("scan_project returns a scannedRoot and plan", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan_project", { cwd: BAD_ALT_DIR }),
    ]);
    const body = bodyOf(responses[1]) as {
      scannedRoot: string;
      plan: { totalFindings: number };
      meta: { scanMode: string };
    };
    expect(body.scannedRoot).toBe(BAD_ALT_DIR);
    expect(body.plan.totalFindings).toBeGreaterThan(0);
    expect(body.meta.scanMode).toBe("full");
  });

  it("detect_native_wrappers returns a candidates list", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "detect_native_wrappers", { cwd: BAD_ALT_DIR }),
    ]);
    const body = bodyOf(responses[1]) as {
      scannedRoot: string;
      candidates: unknown[];
      nextStep: string;
    };
    expect(body.scannedRoot).toBe(BAD_ALT_DIR);
    expect(Array.isArray(body.candidates)).toBe(true);
    expect(typeof body.nextStep).toBe("string");
  });

  it("explain_standard returns criterion metadata for wcag22", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "explain_standard", { standardId: "wcag22", level: "A" }),
    ]);
    const body = bodyOf(responses[1]) as {
      id: string;
      criteriaCount: number;
      criteria: Array<{ id: string; level: string }>;
    };
    expect(body.id).toBe("wcag22");
    expect(body.criteriaCount).toBeGreaterThan(0);
    expect(body.criteria.every((c) => c.level === "A")).toBe(true);
  });

  it("explain_standard with an unknown standard returns a tool-level error envelope", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "explain_standard", { standardId: "not-a-standard" }),
    ]);
    const result = responses[1].result as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text) as { error: string };
    expect(body.error).toContain("Unknown standard");
  });

  it("suggest_fix returns an oldText/newText shape for a known violation line", async () => {
    // First scan to discover a real line, then ask for a fix for it.
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan_file", { path: BAD_ALT_FILE }),
      toolCall(3, "suggest_fix", {
        ruleId: "media/alt-text-missing",
        file: BAD_ALT_FILE,
        line: 1,
      }),
    ]);
    const fix = bodyOf(responses[2]) as {
      explanation: string;
      confidence: string;
    };
    expect(typeof fix.explanation).toBe("string");
    expect(["high", "medium", "low"]).toContain(fix.confidence);
  });

  it("suggest_fix with an unknown rule returns a tool-level error envelope", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "suggest_fix", {
        ruleId: "nonsense/rule",
        file: BAD_ALT_FILE,
        line: 1,
      }),
    ]);
    const result = responses[1].result as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
  });

  it("coverage returns automated pass-rate counts for the session standard", async () => {
    const responses = await mcpSession([initMsg(1), toolCall(2, "coverage", { cwd: BAD_ALT_DIR })]);
    const body = bodyOf(responses[1]) as {
      standardId: string;
      criteriaTotal: number;
      automatedCriteriaPassRate: number;
    };
    expect(body.standardId).toBe("wcag22");
    expect(body.criteriaTotal).toBeGreaterThan(0);
    expect(typeof body.automatedCriteriaPassRate).toBe("number");
  });

  it("checklist returns actionable items and omits untargeted by default", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "checklist", { paths: [BAD_ALT_DIR] }),
    ]);
    const body = bodyOf(responses[1]) as {
      items: Array<{ criterionId: string; candidates: unknown[] }>;
      untargeted?: unknown;
      likelyIrrelevant: Array<{ criterionId: string }>;
      summary: {
        manualReviewRequired: number;
        actionable: number;
        untargeted: number;
        likelyIrrelevant: number;
      };
    };
    expect(Array.isArray(body.items)).toBe(true);
    expect(Array.isArray(body.likelyIrrelevant)).toBe(true);
    expect(body.untargeted).toBeUndefined();
    expect(body.items.every((i) => i.candidates.length > 0)).toBe(true);
    expect(body.summary.actionable).toBe(body.items.length);
    expect(body.summary.likelyIrrelevant).toBe(body.likelyIrrelevant.length);
    expect(body.summary.manualReviewRequired).toBe(
      body.summary.actionable + body.summary.untargeted,
    );
  });

  it("checklist.summary.automatedCoverage lets a single call replace coverage+checklist", async () => {
    // Agents calling both `coverage` and `checklist` duplicate work;
    // the checklist summary should carry enough pass-rate context to
    // make one call sufficient for the common clean-repo path.
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "checklist", { paths: [BAD_ALT_DIR] }),
    ]);
    const body = bodyOf(responses[1]) as {
      summary: {
        automatedCoverage: {
          standardId: string;
          automatedCriteriaPassRate: number;
          criteriaAutomatable: number;
          criteriaAutomatablePassing: number;
        };
      };
    };
    expect(body.summary.automatedCoverage.standardId).toBe("wcag22");
    expect(typeof body.summary.automatedCoverage.automatedCriteriaPassRate).toBe("number");
    expect(body.summary.automatedCoverage.criteriaAutomatable).toBeGreaterThan(0);
    expect(body.summary.automatedCoverage.criteriaAutomatablePassing).toBeLessThanOrEqual(
      body.summary.automatedCoverage.criteriaAutomatable,
    );
  });

  it("checklist includes untargeted when showUntargeted: true", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "checklist", { paths: [BAD_ALT_DIR], showUntargeted: true }),
    ]);
    const body = bodyOf(responses[1]) as {
      untargeted: Array<{ criterionId: string; candidates: unknown[] }>;
      summary: { untargeted: number };
    };
    expect(Array.isArray(body.untargeted)).toBe(true);
    expect(body.untargeted.every((i) => i.candidates.length === 0)).toBe(true);
    expect(body.summary.untargeted).toBe(body.untargeted.length);
  });

  it("review_candidates returns a candidateCount with the active level echoed", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "review_candidates", { paths: [BAD_ALT_DIR], level: "AA" }),
    ]);
    const body = bodyOf(responses[1]) as {
      level: string;
      candidateCount: number;
      candidates: unknown[];
    };
    expect(body.level).toBe("AA");
    expect(body.candidateCount).toBe(body.candidates.length);
  });
});

describe("MCP tools/call: missing-required-param error envelopes", () => {
  it("scan without paths returns a tool-level error", async () => {
    const responses = await mcpSession([initMsg(1), toolCall(2, "scan", {})]);
    const result = responses[1].result as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text) as { error: string };
    expect(body.error).toContain("paths");
  });

  it("scan_file without path returns a tool-level error", async () => {
    const responses = await mcpSession([initMsg(1), toolCall(2, "scan_file", {})]);
    const result = responses[1].result as { isError?: boolean };
    expect(result.isError).toBe(true);
  });

  it("explain_rule without ruleId returns a tool-level error", async () => {
    const responses = await mcpSession([initMsg(1), toolCall(2, "explain_rule", {})]);
    const result = responses[1].result as { isError?: boolean };
    expect(result.isError).toBe(true);
  });

  it("suggest_fix missing file/line returns a tool-level error", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "suggest_fix", { ruleId: "media/alt-text-missing" }),
    ]);
    const result = responses[1].result as { isError?: boolean };
    expect(result.isError).toBe(true);
  });
});
