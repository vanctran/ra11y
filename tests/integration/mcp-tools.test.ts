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
      plan: { totalFindings: number };
      meta: { scanMode: string; scannedRoot: string };
    };
    expect(body.meta.scannedRoot).toBe(BAD_ALT_DIR);
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
    const result = responses[1].result as {
      isError?: boolean;
      content: { text: string }[];
      structuredContent?: { code?: string; details?: { requested?: string } };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe("standard-not-found");
    expect(result.structuredContent?.details?.requested).toBe("not-a-standard");
    const body = JSON.parse(result.content[0].text) as { error: string; code: string };
    expect(body.code).toBe("standard-not-found");
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

  it("suggest_fix with an unknown rule returns a tool-level error envelope with code rule-not-found", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "suggest_fix", {
        ruleId: "nonsense/rule",
        file: BAD_ALT_FILE,
        line: 1,
      }),
    ]);
    const result = responses[1].result as {
      isError?: boolean;
      content: { text: string }[];
      structuredContent?: { code?: string; details?: { requested?: string } };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe("rule-not-found");
    expect(result.structuredContent?.details?.requested).toBe("nonsense/rule");
  });

  it("coverage returns automated pass-rate counts for the session standard", async () => {
    const responses = await mcpSession([initMsg(1), toolCall(2, "coverage", { cwd: BAD_ALT_DIR })]);
    const body = bodyOf(responses[1]) as {
      standardId: string;
      criteriaTotal: number;
      automatedCriteriaPassRate: number;
      manualUntargetedCount: number;
      manualUntargeted?: unknown;
    };
    expect(body.standardId).toBe("wcag22");
    expect(body.criteriaTotal).toBeGreaterThan(0);
    expect(typeof body.automatedCriteriaPassRate).toBe("number");
    // Count always present; list gated behind showUntargeted (mirrors
    // checklist tool so default responses stay compact).
    expect(typeof body.manualUntargetedCount).toBe("number");
    expect(body.manualUntargeted).toBeUndefined();
  });

  it("coverage emits manualUntargeted list only when showUntargeted is true", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "coverage", { cwd: BAD_ALT_DIR, showUntargeted: true }),
    ]);
    const body = bodyOf(responses[1]) as {
      manualUntargeted?: readonly unknown[];
      manualUntargetedCount: number;
    };
    expect(Array.isArray(body.manualUntargeted)).toBe(true);
    expect(body.manualUntargeted?.length).toBe(body.manualUntargetedCount);
  });

  it("clean scan surfaces limitations as a structured field (not buried in prose)", async () => {
    // Agents skimming a clean response for the next action can miss a
    // "don't claim a11y clean" caveat tucked into nextStep. Surface
    // it as a structured field so the signal is harder to drop.
    const goodDir = join(PROJECT_ROOT, "tests", "fixtures", "good", "alt-text-missing");
    const responses = await mcpSession([initMsg(1), toolCall(2, "scan", { paths: [goodDir] })]);
    const body = bodyOf(responses[1]) as {
      plan: {
        totalFindings: number;
        violations: number;
        limitations?: readonly string[];
      };
    };
    expect(body.plan.violations).toBe(0);
    expect(Array.isArray(body.plan.limitations)).toBe(true);
    expect(body.plan.limitations?.some((l) => /runtime/i.test(l))).toBe(true);
    expect(body.plan.limitations?.some((l) => /conformance|sufficient/i.test(l))).toBe(true);
  });

  it("scan omits limitations when there are real findings to act on", async () => {
    // No need to re-emphasize the caveat when the scan already has
    // work to do — limitations only surfaces on clean results.
    const responses = await mcpSession([initMsg(1), toolCall(2, "scan", { paths: [BAD_ALT_DIR] })]);
    const body = bodyOf(responses[1]) as {
      plan: { violations: number; limitations?: unknown };
    };
    expect(body.plan.violations).toBeGreaterThan(0);
    expect(body.plan.limitations).toBeUndefined();
  });

  it("analysisCoverage reports opaque custom components and template directives", async () => {
    // Honest telemetry about what static analysis didn't reach. Not a
    // heuristic — structural gaps the agent needs to calibrate
    // "automated clean" against.
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: joinPath } = await import("node:path");
    const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-coverage-"));
    await writeFile(
      joinPath(dir, "app.tsx"),
      "export const App = () => <><CustomButton/><FancyInput/></>;\n",
    );
    await writeFile(
      joinPath(dir, "page.html"),
      "<html><body>{% extends 'base.html' %}<main>hi</main></body></html>\n",
    );

    const responses = await mcpSession([initMsg(1), toolCall(2, "scan", { paths: [dir] })]);
    const body = bodyOf(responses[1]) as {
      meta: {
        analysisCoverage?: {
          opaqueCustomComponents?: number;
          templateDirectivesFound?: readonly string[];
        };
      };
    };
    expect(body.meta.analysisCoverage?.opaqueCustomComponents).toBeGreaterThanOrEqual(2);
    expect(body.meta.analysisCoverage?.templateDirectivesFound).toContain("jinja-or-liquid");
  });

  it("activeNativeWrappersNote is no longer repeated in every response", async () => {
    // Regression: the 60-word prose note was context tax on every
    // scan. Semantics moved to the MCP server instructions block
    // once per session; per-response only the field itself remains.
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "configure", { nativeWrappers: ["Button"] }),
      toolCall(3, "scan", { paths: [BAD_ALT_DIR] }),
    ]);
    const body = bodyOf(responses[2]) as {
      meta: { activeNativeWrappers?: readonly string[]; activeNativeWrappersNote?: unknown };
    };
    expect(body.meta.activeNativeWrappers).toContain("Button");
    expect(body.meta.activeNativeWrappersNote).toBeUndefined();
  });

  it("checklist returns actionable items and omits untargeted by default", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "checklist", { paths: [BAD_ALT_DIR] }),
    ]);
    const body = bodyOf(responses[1]) as {
      items: Array<{
        criterionId: string;
        candidates: unknown[];
        principle?: { number: number; name: string };
      }>;
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
    // WCAG principle is spec-defined data derived from criterionId;
    // surfacing it lets the agent sort beyond level without us
    // inventing a priority ranking.
    for (const item of body.items) {
      if (!item.criterionId.startsWith("wcag")) continue;
      const expectedPrincipleNumber = Number(item.criterionId.split(":")[1]?.split(".")[0]);
      expect(item.principle?.number).toBe(expectedPrincipleNumber);
      expect(["Perceivable", "Operable", "Understandable", "Robust"]).toContain(
        item.principle?.name,
      );
    }
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

  it("review_candidates populates snippet with de-indented ±3-line context under the 300-char cap", async () => {
    // consistent-navigation surfaces wcag22:3.2.3 candidates on
    // divergent route files — a reliable source of review candidates
    // grounded in real file:line, which is what the snippet path
    // needs to populate.
    const fixtureDir = join(
      PROJECT_ROOT,
      "tests",
      "fixtures",
      "review",
      "consistent-navigation",
      "bad",
    );
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "review_candidates", { paths: [fixtureDir] }),
    ]);
    const body = bodyOf(responses[1]) as {
      candidateCount: number;
      candidates: Array<{
        criterionId: string;
        location: { filePath: string; line: number };
        snippet?: string;
      }>;
    };
    expect(body.candidateCount).toBeGreaterThan(0);
    const withFileLine = body.candidates.filter((c) => c.location.filePath && c.location.line > 0);
    // Every grounded candidate should now carry a snippet.
    expect(withFileLine.length).toBeGreaterThan(0);
    for (const c of withFileLine) {
      expect(typeof c.snippet).toBe("string");
      expect((c.snippet ?? "").length).toBeGreaterThan(0);
      // Hard cap — 300 chars total including any newlines.
      expect((c.snippet ?? "").length).toBeLessThanOrEqual(300);
      // Dishonest shapes forbidden — a candidate with a real file:line
      // must not have snippet === "" (that would be indistinguishable
      // from "file was blank there").
      expect(c.snippet).not.toBe("");
    }
  });

  it("checklist candidate entries carry snippet with the same shape", async () => {
    const fixtureDir = join(
      PROJECT_ROOT,
      "tests",
      "fixtures",
      "review",
      "consistent-navigation",
      "bad",
    );
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "checklist", { paths: [fixtureDir] }),
    ]);
    const body = bodyOf(responses[1]) as {
      items: Array<{
        criterionId: string;
        candidates: Array<{ path: string; line: number; snippet?: string }>;
      }>;
    };
    const allCandidates = body.items.flatMap((i) => i.candidates);
    expect(allCandidates.length).toBeGreaterThan(0);
    for (const c of allCandidates) {
      if (c.path && c.line > 0) {
        expect(typeof c.snippet).toBe("string");
        expect((c.snippet ?? "").length).toBeGreaterThan(0);
        expect((c.snippet ?? "").length).toBeLessThanOrEqual(300);
      }
    }
  });
});

describe("MCP tools/call: missing-required-param error envelopes", () => {
  it("scan without paths returns a structured missing-required-param envelope", async () => {
    const responses = await mcpSession([initMsg(1), toolCall(2, "scan", {})]);
    const result = responses[1].result as {
      isError?: boolean;
      content: { text: string }[];
      structuredContent?: { code?: string; details?: { param?: string } };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe("missing-required-param");
    expect(result.structuredContent?.details?.param).toBe("paths");
    const body = JSON.parse(result.content[0].text) as { error: string; code: string };
    expect(body.code).toBe("missing-required-param");
    expect(body.error).toContain("paths");
  });

  it("scan_file without path returns a structured missing-required-param envelope", async () => {
    const responses = await mcpSession([initMsg(1), toolCall(2, "scan_file", {})]);
    const result = responses[1].result as {
      isError?: boolean;
      structuredContent?: { code?: string; details?: { param?: string } };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe("missing-required-param");
    expect(result.structuredContent?.details?.param).toBe("path");
  });

  it("explain_rule without ruleId returns a structured missing-required-param envelope", async () => {
    const responses = await mcpSession([initMsg(1), toolCall(2, "explain_rule", {})]);
    const result = responses[1].result as {
      isError?: boolean;
      structuredContent?: { code?: string; details?: { param?: string } };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe("missing-required-param");
    expect(result.structuredContent?.details?.param).toBe("ruleId");
  });

  it("suggest_fix missing file/line returns a structured missing-required-param envelope naming the gaps", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "suggest_fix", { ruleId: "media/alt-text-missing" }),
    ]);
    const result = responses[1].result as {
      isError?: boolean;
      structuredContent?: { code?: string; details?: { missing?: readonly string[] } };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe("missing-required-param");
    const missing = result.structuredContent?.details?.missing ?? [];
    expect(missing).toContain("file");
    expect(missing).toContain("line");
  });

  it("list_rules with an unknown standard returns a standard-not-found envelope", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "list_rules", { standard: "not-a-standard" }),
    ]);
    const result = responses[1].result as {
      isError?: boolean;
      structuredContent?: { code?: string; details?: { requested?: string; loaded?: string[] } };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe("standard-not-found");
    expect(result.structuredContent?.details?.requested).toBe("not-a-standard");
    expect(Array.isArray(result.structuredContent?.details?.loaded)).toBe(true);
  });

  it("coverage with an unknown standard returns a standard-not-found envelope", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "coverage", { standard: "not-a-standard" }),
    ]);
    const result = responses[1].result as {
      isError?: boolean;
      structuredContent?: { code?: string; details?: { requested?: string } };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe("standard-not-found");
    expect(result.structuredContent?.details?.requested).toBe("not-a-standard");
  });

  it("checklist with an unknown standard returns a standard-not-found envelope", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "checklist", { standard: "not-a-standard" }),
    ]);
    const result = responses[1].result as {
      isError?: boolean;
      structuredContent?: { code?: string; details?: { requested?: string } };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe("standard-not-found");
    expect(result.structuredContent?.details?.requested).toBe("not-a-standard");
  });

  it("review_candidates with an unknown criterionId returns a criterion-not-found envelope", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "review_candidates", { criterionId: "wcag22:9.9.9" }),
    ]);
    const result = responses[1].result as {
      isError?: boolean;
      structuredContent?: { code?: string; details?: { requested?: string } };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe("criterion-not-found");
    expect(result.structuredContent?.details?.requested).toBe("wcag22:9.9.9");
  });
});
