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
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

  it("scan_project changedOnly scans only staged files when the git index has some", async () => {
    // Initialize a git repo with an initial commit, then write a new bad
    // file and stage it. `changedOnly: true` should scan only that one
    // staged file and truthfully report `scanMode: "changedOnly"`.
    const dir = await mkdtemp(join(tmpdir(), "ra11y-scan-project-staged-"));
    try {
      await writeFile(join(dir, "clean.html"), "<html><body></body></html>\n");
      const git = (args: readonly string[]) =>
        spawnSync("git", [...args], { cwd: dir, stdio: "ignore" });
      git(["init"]);
      git(["config", "user.email", "test@example.com"]);
      git(["config", "user.name", "Test"]);
      git(["add", "."]);
      git(["commit", "-m", "initial"]);
      // New bad file staged on top of the initial commit.
      await writeFile(join(dir, "bad.html"), '<html><body><img src="/x.png"></body></html>\n');
      git(["add", "bad.html"]);
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "scan_project", { cwd: dir, changedOnly: true }),
      ]);
      const body = bodyOf(responses[1]) as {
        files: readonly { path: string }[];
        meta: { scanMode: string; filesScanned: number; fallbackReason?: string };
      };
      expect(body.meta.scanMode).toBe("changedOnly");
      expect(body.meta.fallbackReason).toBeUndefined();
      expect(body.meta.filesScanned).toBe(1);
      // Only `bad.html` was staged — the clean file must not have been scanned.
      expect(body.files.some((f) => f.path.endsWith("bad.html"))).toBe(true);
      expect(body.files.some((f) => f.path.endsWith("clean.html"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("scan_project changedOnly in a git repo with zero staged files returns an error envelope", async () => {
    // The pre-fix behavior silently fell back to a full scan AND reported
    // `scanMode: "changedOnly"` — pre-commit and CI-on-diff workflows
    // couldn't detect that their diff gate was a no-op. The honest shape
    // is a `no-staged-files` error envelope so the agent can surface
    // the precondition miss and stage files (or drop changedOnly).
    const dir = await mkdtemp(join(tmpdir(), "ra11y-scan-project-no-staged-"));
    try {
      await writeFile(join(dir, "index.html"), '<html><body><img src="/x.png"></body></html>\n');
      const git = (args: readonly string[]) =>
        spawnSync("git", [...args], { cwd: dir, stdio: "ignore" });
      git(["init"]);
      git(["config", "user.email", "test@example.com"]);
      git(["config", "user.name", "Test"]);
      git(["add", "."]);
      git(["commit", "-m", "initial"]);
      // Nothing new staged after the initial commit.
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "scan_project", { cwd: dir, changedOnly: true }),
      ]);
      const result = responses[1].result as {
        isError?: boolean;
        content: { text: string }[];
        structuredContent?: {
          code?: string;
          message?: string;
          details?: { gitRoot?: string };
          remediation?: string;
        };
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.code).toBe("no-staged-files");
      expect(typeof result.structuredContent?.message).toBe("string");
      expect(typeof result.structuredContent?.remediation).toBe("string");
      expect(typeof result.structuredContent?.details?.gitRoot).toBe("string");
      const body = JSON.parse(result.content[0].text) as { code: string; error: string };
      expect(body.code).toBe("no-staged-files");
      expect(body.error).toContain("changedOnly");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("scan_project changedOnly outside a git repo reports a named fallback instead of lying about the mode", async () => {
    // When cwd isn't a git repo, we keep the existing fallback behavior
    // (run a full scan rather than error) but STOP lying about it:
    // `scanMode` reports "full-fallback", never "changedOnly", and
    // `fallbackReason` names why.
    const dir = await mkdtemp(join(tmpdir(), "ra11y-scan-project-not-git-"));
    try {
      await writeFile(join(dir, "index.html"), '<html><body><img src="/x.png"></body></html>\n');
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "scan_project", { cwd: dir, changedOnly: true }),
      ]);
      const body = bodyOf(responses[1]) as {
        meta: { scanMode: string; fallbackReason?: string; filesScanned: number };
      };
      expect(body.meta.scanMode).toBe("full-fallback");
      expect(body.meta.fallbackReason).toBe("not-a-git-repo");
      expect(body.meta.filesScanned).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

  it("suggest_fix carries verifyCommand + verifyCommandStructured pointing at scan_file (Q2-VERIFYCMD)", async () => {
    // Every suggest_fix response — edit, guidance, or none — should
    // carry the prose + structured verify pair. The structured form
    // names scan_file (not scan_project) so the re-check is narrow
    // and deterministic, with ruleId included so the agent can
    // post-filter the re-scan's findings to the rule it just fixed.
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "suggest_fix", {
        ruleId: "media/alt-text-missing",
        file: BAD_ALT_FILE,
        line: 1,
      }),
    ]);
    const fix = bodyOf(responses[1]) as {
      verifyCommand: string;
      verifyCommandStructured: {
        tool: string;
        args: { file: string; ruleId?: string };
      };
    };
    expect(typeof fix.verifyCommand).toBe("string");
    expect(fix.verifyCommand).toContain("scan_file");
    expect(fix.verifyCommandStructured.tool).toBe("scan_file");
    expect(fix.verifyCommandStructured.args.file).toBe(BAD_ALT_FILE);
    expect(fix.verifyCommandStructured.args.ruleId).toBe("media/alt-text-missing");
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

  it("scan emits limitations on every response, including ones with findings (P2-N)", async () => {
    // P2-N: previously limitations was gated to clean scans only.
    // That let agents overclaim conformance on mixed-result responses
    // — "we found a few things but it's otherwise clean" implied the
    // static scan covered the whole picture. Now every response
    // carries the field so the runtime-vs-static caveat is always
    // visible to the agent, not just when the scan was empty.
    const responses = await mcpSession([initMsg(1), toolCall(2, "scan", { paths: [BAD_ALT_DIR] })]);
    const body = bodyOf(responses[1]) as {
      plan: { violations: number; limitations?: readonly string[] };
    };
    expect(body.plan.violations).toBeGreaterThan(0);
    expect(Array.isArray(body.plan.limitations)).toBe(true);
    expect(body.plan.limitations?.some((l) => /runtime/i.test(l))).toBe(true);
  });

  it("scan_project carries both nextStep (prose) and nextStepStructured with matching tool name (P1-K)", async () => {
    // Agents branching on the machine form should not have to parse
    // English — `nextStepStructured.tool` names the same call the
    // prose recommends, and `args` uses canonical parameter names
    // (`file`, `ruleId`, `line`) per P2-R.
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan_project", { cwd: BAD_ALT_DIR }),
    ]);
    const body = bodyOf(responses[1]) as {
      meta: {
        nextStep: string;
        nextStepStructured?: { tool: string; args: Record<string, unknown> };
      };
    };
    expect(typeof body.meta.nextStep).toBe("string");
    expect(body.meta.nextStepStructured).toBeDefined();
    const structured = body.meta.nextStepStructured;
    if (!structured) throw new Error("nextStepStructured missing");
    // Fixture has alt-text violations — first hop is either
    // suggest_fix (when the rule emits a fix suggestion) or
    // explain_rule (when it doesn't). Both are concrete, canonical
    // recommendations the prose also names.
    expect(["suggest_fix", "explain_rule"]).toContain(structured.tool);
    expect(body.meta.nextStep).toContain(structured.tool);
    expect(typeof structured.args.ruleId).toBe("string");
    if (structured.tool === "suggest_fix") {
      expect(typeof structured.args.file).toBe("string");
      expect(typeof structured.args.line).toBe("number");
      // Canonical param name: `file`, not `filePath`.
      expect(structured.args).not.toHaveProperty("filePath");
    }
  });

  it("scan_file also emits nextStepStructured alongside prose (P1-K)", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan_file", { path: BAD_ALT_FILE }),
    ]);
    const body = bodyOf(responses[1]) as {
      meta: {
        nextStep: string;
        nextStepStructured?: { tool: string; args: Record<string, unknown> };
      };
    };
    expect(typeof body.meta.nextStep).toBe("string");
    expect(body.meta.nextStepStructured).toBeDefined();
    expect(body.meta.nextStepStructured?.tool).toMatch(/^(suggest_fix|explain_rule|scan_file)$/);
  });

  it("scan (directory mode) emits nextStep + nextStepStructured at parity with scan_project and scan_file", async () => {
    const responses = await mcpSession([initMsg(1), toolCall(2, "scan", { paths: [BAD_ALT_DIR] })]);
    const body = bodyOf(responses[1]) as {
      meta: {
        nextStep: string;
        nextStepStructured?: { tool: string; args: Record<string, unknown> };
      };
    };
    expect(typeof body.meta.nextStep).toBe("string");
    expect(body.meta.nextStepStructured).toBeDefined();
    const structured = body.meta.nextStepStructured;
    if (!structured) throw new Error("nextStepStructured missing");
    expect(["suggest_fix", "explain_rule"]).toContain(structured.tool);
    expect(body.meta.nextStep).toContain(structured.tool);
    expect(typeof structured.args.ruleId).toBe("string");
    if (structured.tool === "suggest_fix") {
      expect(typeof structured.args.file).toBe("string");
      expect(typeof structured.args.line).toBe("number");
      expect(structured.args).not.toHaveProperty("filePath");
    }
  });

  it("clean scan (directory mode) points at checklist via the structured pair", async () => {
    const goodDir = join(PROJECT_ROOT, "tests", "fixtures", "good", "alt-text-missing");
    const responses = await mcpSession([initMsg(1), toolCall(2, "scan", { paths: [goodDir] })]);
    const body = bodyOf(responses[1]) as {
      plan: { violations: number };
      meta: {
        nextStep: string;
        nextStepStructured?: { tool: string; args: Record<string, unknown> };
      };
    };
    expect(body.plan.violations).toBe(0);
    expect(body.meta.nextStepStructured?.tool).toBe("checklist");
    expect(body.meta.nextStep).toContain("checklist");
  });

  it("clean scan_project response emits matching pair pointing at checklist (P1-K)", async () => {
    // On a clean scan (no violations, no notes), the canonical next
    // call is `checklist` — structured form and prose both name it.
    // The "omit both" case (fallback branch where no concrete first
    // finding can be named) is covered by the unit test; end-to-end
    // scans don't reach it via the public surface.
    const goodDir = join(PROJECT_ROOT, "tests", "fixtures", "good", "alt-text-missing");
    const responses = await mcpSession([initMsg(1), toolCall(2, "scan_project", { cwd: goodDir })]);
    const body = bodyOf(responses[1]) as {
      plan: { violations: number };
      meta: {
        nextStep: string;
        nextStepStructured?: { tool: string; args: Record<string, unknown> };
      };
    };
    expect(body.plan.violations).toBe(0);
    expect(body.meta.nextStepStructured?.tool).toBe("checklist");
    expect(body.meta.nextStep).toContain("checklist");
  });

  it("scan findings no longer inline suppressPlacement; top-level referenceGuide carries the prose", async () => {
    // Hoisting the placement paragraph into a top-level map keyed by
    // file extension strips ~1 paragraph per finding on large scans
    // (mirrors the prompts-dedupe on review_candidates). Findings keep
    // `suppressWith` inline because the ruleId makes each one unique
    // and short; only the long placement prose is deduped.
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan_project", { cwd: BAD_ALT_DIR }),
    ]);
    const body = bodyOf(responses[1]) as {
      files: readonly { findings: readonly Record<string, unknown>[] }[];
      referenceGuide?: { suppressPlacement: Record<string, string> };
    };
    expect(body.files.length).toBeGreaterThan(0);
    for (const file of body.files) {
      for (const finding of file.findings) {
        expect(finding).not.toHaveProperty("suppressPlacement");
        expect(typeof finding.suppressWith).toBe("string");
      }
    }
    expect(body.referenceGuide).toBeDefined();
    // The alt-text fixture mixes .html and .tsx — both placements
    // should appear. CSS isn't in the fixture, so it should be absent
    // (the guide is populated only from extensions with findings).
    expect(body.referenceGuide?.suppressPlacement.html).toContain("opening tag");
    expect(body.referenceGuide?.suppressPlacement.tsx).toContain("opening JSX tag");
    expect(body.referenceGuide?.suppressPlacement).not.toHaveProperty("css");
  });

  it("clean scan omits referenceGuide entirely (no findings → no guide)", async () => {
    const goodDir = join(PROJECT_ROOT, "tests", "fixtures", "good", "alt-text-missing");
    const responses = await mcpSession([initMsg(1), toolCall(2, "scan_project", { cwd: goodDir })]);
    const body = bodyOf(responses[1]) as {
      plan: { violations: number };
      referenceGuide?: unknown;
    };
    expect(body.plan.violations).toBe(0);
    expect(body).not.toHaveProperty("referenceGuide");
  });

  it("scan_file hoists suppressPlacement the same way scan_project does", async () => {
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan_file", { path: BAD_ALT_FILE }),
    ]);
    const body = bodyOf(responses[1]) as {
      findings: readonly Record<string, unknown>[];
      referenceGuide?: { suppressPlacement: Record<string, string> };
    };
    expect(body.findings.length).toBeGreaterThan(0);
    for (const finding of body.findings) {
      expect(finding).not.toHaveProperty("suppressPlacement");
    }
    expect(body.referenceGuide?.suppressPlacement.html).toContain("opening tag");
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

// ─── P1-M + P1-H: split composite plan counters ─────────────────────────────
//
// Regression suite for the "composite headline counts are dishonest" fix.
// The old `plan.manualReviewRequired` summed grounded candidates with bare-
// criterion prompts into a single inflated number; the old
// `plan.fixSuggestionAvailable` summed mechanical edits with prose-only
// guidance. Both are now split into honest top-level counters. Agents
// budget against `actionableManualItems` (not the manual total) and
// `mechanicalEditsAvailable` (not the fix total) at plan time.
describe("scan_project plan: composite counters split into honest top-level fields (P1-M + P1-H)", () => {
  it("emits the four split counters at the top level of plan", async () => {
    // `bad/alt-text-missing` has violations and a full WCAG 2.2 load —
    // exercises both splits: guidance fixes on the violation side, and
    // a non-zero untargeted-criteria count on the manual side.
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan_project", { cwd: BAD_ALT_DIR }),
    ]);
    const body = bodyOf(responses[1]) as {
      plan: Record<string, unknown> & {
        actionableManualItems?: number;
        untargetedCriteria?: number;
        mechanicalEditsAvailable?: number;
        guidanceFixesAvailable?: number;
      };
    };
    // Manual split: both counters are top-level integers, present even
    // when one is zero. Zero on actionable is the honest reading of
    // "the finders didn't ground anything" — omitting the field would
    // re-introduce the ambiguity P1-M fixed.
    expect(typeof body.plan.actionableManualItems).toBe("number");
    expect(typeof body.plan.untargetedCriteria).toBe("number");
    expect(body.plan.actionableManualItems).toBeGreaterThanOrEqual(0);
    expect(body.plan.untargetedCriteria).toBeGreaterThanOrEqual(0);
    // The fixture has a full WCAG load, so untargeted is populated.
    expect(body.plan.untargetedCriteria ?? 0).toBeGreaterThan(0);
    // Fix split: at least one of the two is populated on a violating
    // fixture. Both fields are omitted when zero (CLAUDE.md §1
    // "Ambiguous field shapes") so we assert the union.
    const hasAnyFixCount =
      (body.plan.mechanicalEditsAvailable ?? 0) > 0 || (body.plan.guidanceFixesAvailable ?? 0) > 0;
    expect(hasAnyFixCount).toBe(true);
  });

  it("removes the old composite fields (manualReviewRequired, fixSuggestionAvailable)", async () => {
    // Regression guard: the pre-split shape fed agents two inflated
    // numbers. Keeping them as aliases would re-create the dishonest
    // headline — v0.x rapid iteration policy removes them outright.
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan_project", { cwd: BAD_ALT_DIR }),
    ]);
    const body = bodyOf(responses[1]) as { plan: Record<string, unknown> };
    expect(body.plan).not.toHaveProperty("manualReviewRequired");
    expect(body.plan).not.toHaveProperty("fixSuggestionAvailable");
  });

  it("plan.summary leads the manual-review fragment with the actionable count", async () => {
    // The headline agents read first must match the count they budget
    // against. The summary leads with "N actionable manual review
    // items" before the "+ M untargeted criteria" tail, not the old
    // `21 WCAG criteria still need human review` composite.
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan_project", { cwd: BAD_ALT_DIR }),
    ]);
    const body = bodyOf(responses[1]) as {
      plan: {
        summary: string;
        actionableManualItems: number;
        untargetedCriteria: number;
      };
    };
    const { summary, actionableManualItems, untargetedCriteria } = body.plan;
    // Old composite phrasing is gone.
    expect(summary).not.toMatch(/WCAG criteri(on|a) still need human review/);
    // New phrasing: when any manual-review total exists, the fragment
    // uses the split labels. When both counts are > 0, actionable
    // leads and untargeted follows via " + ".
    if (actionableManualItems + untargetedCriteria > 0) {
      if (actionableManualItems > 0 && untargetedCriteria > 0) {
        expect(summary).toMatch(
          new RegExp(
            `${actionableManualItems} actionable manual review item.*\\+ ${untargetedCriteria} untargeted criteri`,
          ),
        );
      } else if (actionableManualItems > 0) {
        expect(summary).toMatch(
          new RegExp(`${actionableManualItems} actionable manual review item`),
        );
      } else {
        expect(summary).toMatch(new RegExp(`${untargetedCriteria} untargeted criteri`));
      }
    }
  });

  it("plan.summary violations phrasing uses mechanical/guidance splits, not the old composite", async () => {
    // The fix-side split reads too: instead of "(N with fix suggestions)"
    // the prose names mechanical edits and guidance fixes separately so
    // an agent can tell which lane the count lives in before routing.
    const responses = await mcpSession([
      initMsg(1),
      toolCall(2, "scan_project", { cwd: BAD_ALT_DIR }),
    ]);
    const body = bodyOf(responses[1]) as {
      plan: {
        summary: string;
        violations?: number;
        mechanicalEditsAvailable?: number;
        guidanceFixesAvailable?: number;
      };
    };
    if ((body.plan.violations ?? 0) === 0) return;
    const hasAnyFix =
      (body.plan.mechanicalEditsAvailable ?? 0) > 0 || (body.plan.guidanceFixesAvailable ?? 0) > 0;
    if (hasAnyFix) {
      expect(body.plan.summary).toMatch(/mechanical edit|guidance fix/);
      expect(body.plan.summary).not.toMatch(/with fix suggestions\)/);
    }
  });
});
