/**
 * Unit tests for MCP tool handlers.
 *
 * Each tool is tested with synthetic inputs against the real scanner.
 * Tests use the fixture files from tests/fixtures/ to get deterministic
 * scan results.
 */

import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { McpSession } from "../../../src/mcp/session.ts";
import { MCP_TOOLS } from "../../../src/mcp/tools.ts";

const FIXTURE_DIR = join(import.meta.dir, "..", "..", "fixtures");
const BAD_ALT = join(FIXTURE_DIR, "bad", "alt-text-missing", "img-no-alt.html");
const GOOD_ALT = join(FIXTURE_DIR, "good", "alt-text-missing", "img-with-alt.html");

function findTool(name: string) {
  const tool = MCP_TOOLS.find((t) => t.def.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

describe("MCP tool: list_rules", () => {
  it("returns all built-in rules", async () => {
    const tool = findTool("list_rules");
    const session = new McpSession();
    const result = await tool.handler({}, session);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text) as { rules: unknown[] };
    expect(data.rules.length).toBeGreaterThan(0);

    const first = data.rules[0] as Record<string, unknown>;
    expect(typeof first.id).toBe("string");
    expect(typeof first.description).toBe("string");
    expect(typeof first.severity).toBe("string");
    expect(Array.isArray(first.satisfies)).toBe(true);
  });

  it("filters by standard", async () => {
    const tool = findTool("list_rules");
    const session = new McpSession();
    const all = await tool.handler({}, session);
    const wcag21 = await tool.handler({ standard: "wcag21" }, session);

    const allRules = JSON.parse(all.content[0].text) as { rules: unknown[] };
    const filteredRules = JSON.parse(wcag21.content[0].text) as { rules: unknown[] };

    // wcag21 filter should return fewer or equal rules.
    expect(filteredRules.rules.length).toBeLessThanOrEqual(allRules.rules.length);
    expect(filteredRules.rules.length).toBeGreaterThan(0);
  });
});

describe("MCP tool: explain_rule", () => {
  it("returns full rule metadata", async () => {
    const tool = findTool("explain_rule");
    const session = new McpSession();
    const result = await tool.handler({ ruleId: "media/alt-text-missing" }, session);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(data.id).toBe("media/alt-text-missing");
    expect(typeof data.description).toBe("string");
    expect(typeof data.rationale).toBe("string");
    expect(typeof data.goodExample).toBe("string");
    expect(typeof data.badExample).toBe("string");
    expect(Array.isArray(data.satisfies)).toBe(true);
    expect(Array.isArray(data.references)).toBe(true);
  });

  it("returns error for unknown rule", async () => {
    const tool = findTool("explain_rule");
    const session = new McpSession();
    const result = await tool.handler({ ruleId: "nonexistent/rule" }, session);

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text) as { error: string };
    expect(data.error).toContain("not found");
  });

  it("returns error when ruleId is missing", async () => {
    const tool = findTool("explain_rule");
    const session = new McpSession();
    const result = await tool.handler({}, session);

    expect(result.isError).toBe(true);
  });
});

describe("MCP tool: scan", () => {
  it("finds violations in bad fixture", async () => {
    const tool = findTool("scan");
    const session = new McpSession();
    const result = await tool.handler({ paths: [BAD_ALT] }, session);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text) as {
      plan: { totalFindings: number };
      files: Array<{ path: string; findings: unknown[] }>;
      meta: { filesScanned: number };
    };
    expect(data.plan.totalFindings).toBeGreaterThan(0);
    expect(data.files.length).toBeGreaterThan(0);
    expect(data.meta.filesScanned).toBe(1);
  });

  it("returns clean scan for good fixture", async () => {
    const tool = findTool("scan");
    const session = new McpSession();
    const result = await tool.handler({ paths: [GOOD_ALT] }, session);

    // Good fixture may still have document-level findings (like missing title),
    // but should have zero alt-text findings.
    const filesData = JSON.parse(result.content[0].text) as {
      files: Array<{ findings: Array<{ ruleId: string }> }>;
    };
    const altFindings = filesData.files.flatMap((f) =>
      f.findings.filter((v) => v.ruleId === "media/alt-text-missing"),
    );
    expect(altFindings.length).toBe(0);
  });

  it("returns error for empty paths", async () => {
    const tool = findTool("scan");
    const session = new McpSession();
    const result = await tool.handler({ paths: [] }, session);
    expect(result.isError).toBe(true);
  });
});

describe("MCP tool: scan_project", () => {
  it("scans the provided cwd as a single root and reports scannedRoot", async () => {
    const tool = findTool("scan_project");
    const session = new McpSession();
    const fixtureDir = BAD_ALT.replace(/\/[^/]+$/, "");
    const result = await tool.handler({ cwd: fixtureDir }, session);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text) as {
      scannedRoot: string;
      plan: { totalFindings: number };
      meta: { filesScanned: number; scannedRoot: string };
    };
    expect(data.scannedRoot).toBe(fixtureDir);
    expect(data.meta.scannedRoot).toBe(fixtureDir);
    expect(data.meta.filesScanned).toBeGreaterThan(0);
  });
});

describe("MCP tool: scan_file", () => {
  it("scans a single file", async () => {
    const tool = findTool("scan_file");
    const session = new McpSession();
    const result = await tool.handler({ path: BAD_ALT }, session);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text) as {
      findings: Array<{ ruleId: string }>;
    };
    expect(data.findings.length).toBeGreaterThan(0);
  });

  it("returns error for missing path", async () => {
    const tool = findTool("scan_file");
    const session = new McpSession();
    const result = await tool.handler({}, session);
    expect(result.isError).toBe(true);
  });
});

describe("MCP tool: configure", () => {
  it("sets session defaults and returns active config", async () => {
    const tool = findTool("configure");
    const session = new McpSession();
    const result = await tool.handler({ standard: "wcag21", level: "A" }, session);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text) as {
      active: { standard: string; level: string; ruleCount: number };
    };
    expect(data.active.standard).toBe("wcag21");
    expect(data.active.level).toBe("A");
    expect(data.active.ruleCount).toBeGreaterThan(0);

    // Session state persists.
    expect(session.config.standard).toBe("wcag21");
    expect(session.config.level).toBe("A");
  });

  it("applies per-rule severity overrides to subsequent scans", async () => {
    const configureTool = findTool("configure");
    const scanFileTool = findTool("scan_file");
    const session = new McpSession();

    // First, scan without overrides to confirm alt-text-missing fires.
    const before = await scanFileTool.handler({ path: BAD_ALT }, session);
    const beforeData = JSON.parse(before.content[0].text) as {
      findings: Array<{ ruleId: string }>;
    };
    const hadAltFinding = beforeData.findings.some((f) => f.ruleId === "media/alt-text-missing");
    expect(hadAltFinding).toBe(true);

    // Disable the rule via configure, then re-scan.
    await configureTool.handler({ rules: { "media/alt-text-missing": "off" } }, session);
    const after = await scanFileTool.handler({ path: BAD_ALT }, session);
    const afterData = JSON.parse(after.content[0].text) as {
      findings: Array<{ ruleId: string }>;
    };
    const stillFires = afterData.findings.some((f) => f.ruleId === "media/alt-text-missing");
    expect(stillFires).toBe(false);
  });

  it("respects ra11y.config.ts rule settings in the caller's cwd", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: joinPath } = await import("node:path");

    const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-mcp-config-"));
    await writeFile(
      joinPath(dir, "ra11y.config.ts"),
      `export default { rules: { "media/alt-text-missing": "off" } };\n`,
    );
    // Fixture file inside the temp dir so cwd-scoped discovery picks it up.
    const fixture = joinPath(dir, "bad.html");
    await writeFile(fixture, `<img src="x.png">\n`);

    const scanTool = findTool("scan");
    const session = new McpSession();
    const result = await scanTool.handler({ paths: [fixture], cwd: dir }, session);

    const data = JSON.parse(result.content[0].text) as {
      meta: { configSource: string | null };
      files: Array<{ findings: Array<{ ruleId: string }> }>;
    };
    // ra11y.config.ts was discovered
    expect(data.meta.configSource).toContain("ra11y.config.ts");
    // And its "off" for media/alt-text-missing silenced the finding
    const fires = data.files.some((f) =>
      f.findings.some((v) => v.ruleId === "media/alt-text-missing"),
    );
    expect(fires).toBe(false);
  });

  it("re-reads ra11y.config.ts on each scan (no stale cache)", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: joinPath } = await import("node:path");

    const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-stale-cache-"));
    const fixture = joinPath(dir, "bad.html");
    await writeFile(fixture, `<img src="x.png">\n`);

    const scanTool = findTool("scan");
    const session = new McpSession();

    // First scan: no config file yet, configSource should be null.
    const before = await scanTool.handler({ paths: [fixture], cwd: dir }, session);
    const beforeData = JSON.parse(before.content[0].text) as {
      meta: { configSource: string | null };
      files: Array<{ findings: Array<{ ruleId: string }> }>;
    };
    expect(beforeData.meta.configSource).toBeNull();
    expect(
      beforeData.files.some((f) => f.findings.some((v) => v.ruleId === "media/alt-text-missing")),
    ).toBe(true);

    // Create the config partway through the session — the next scan must pick it up.
    await writeFile(
      joinPath(dir, "ra11y.config.ts"),
      `export default { rules: { "media/alt-text-missing": "off" } };\n`,
    );

    const after = await scanTool.handler({ paths: [fixture], cwd: dir }, session);
    const afterData = JSON.parse(after.content[0].text) as {
      meta: { configSource: string | null };
      files: Array<{ findings: Array<{ ruleId: string }> }>;
    };
    expect(afterData.meta.configSource).toContain("ra11y.config.ts");
    expect(
      afterData.files.some((f) => f.findings.some((v) => v.ruleId === "media/alt-text-missing")),
    ).toBe(false);
  });

  it("nativeWrappers suppresses info keyboard/handler-missing on listed components", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: joinPath } = await import("node:path");

    const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-native-wrappers-"));
    // JSX with two PascalCase wrappers + one real <div onClick> bug so we
    // can see the allowlist only silences the wrapper, not real violations.
    const fixture = joinPath(dir, "app.tsx");
    await writeFile(
      fixture,
      [
        "export function App() {",
        "  return (",
        "    <>",
        "      <ActionButton onClick={a} />",
        "      <OtherWidget onClick={b} />",
        "      <div onClick={c}>click</div>",
        "    </>",
        "  );",
        "}",
      ].join("\n"),
    );

    const scanTool = findTool("scan");
    const configureTool = findTool("configure");
    const session = new McpSession();
    await configureTool.handler({ nativeWrappers: ["ActionButton"] }, session);
    const result = await scanTool.handler({ paths: [fixture], cwd: dir }, session);

    const data = JSON.parse(result.content[0].text) as {
      files: Array<{ findings: Array<{ ruleId: string; message: string; severity: string }> }>;
    };
    const khm = data.files.flatMap((f) =>
      f.findings.filter((v) => v.ruleId === "keyboard/handler-missing"),
    );
    // ActionButton suppressed; OtherWidget still emits (info); <div> still an error.
    expect(khm.some((v) => v.message.includes("ActionButton"))).toBe(false);
    expect(khm.some((v) => v.message.includes("OtherWidget"))).toBe(true);
    expect(khm.some((v) => v.severity === "error")).toBe(true);
  });
});

describe("MCP tool: coverage", () => {
  it("returns coverage data", async () => {
    const tool = findTool("coverage");
    const session = new McpSession();
    const result = await tool.handler({ paths: [BAD_ALT] }, session);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text) as {
      standardId: string;
      automatedPassRate: number;
      criteriaTotal: number;
      criteriaAutomatable: number;
      criteriaManualReviewRequired: number;
      summary: string;
    };
    expect(data.standardId).toBe("wcag22");
    expect(typeof data.automatedPassRate).toBe("number");
    expect(data.criteriaTotal).toBeGreaterThan(0);
    expect(data.criteriaAutomatable).toBeLessThanOrEqual(data.criteriaTotal);
    expect(data.criteriaManualReviewRequired).toBeGreaterThan(0);
    expect(data.summary).toContain("manual");
    // Must NOT expose overallAutomatedCoverage — that ratio reads as failure
    // ("54%") when it actually measures a property of the rule library.
    expect((data as Record<string, unknown>).overallAutomatedCoverage).toBeUndefined();
  });
});

describe("MCP tool: suggest_fix", () => {
  it("returns fix suggestion for a known violation", async () => {
    const tool = findTool("suggest_fix");
    const session = new McpSession();

    // First scan to find a violation line.
    const scanTool = findTool("scan_file");
    const scanResult = await scanTool.handler({ path: BAD_ALT }, session);
    const scanData = JSON.parse(scanResult.content[0].text) as {
      findings: Array<{ ruleId: string; line: number }>;
    };

    const altFinding = scanData.findings.find((f) => f.ruleId === "media/alt-text-missing");
    if (!altFinding) {
      // If no alt-text finding, skip test gracefully.
      return;
    }

    const result = await tool.handler(
      { ruleId: altFinding.ruleId, file: BAD_ALT, line: altFinding.line },
      session,
    );

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text) as {
      explanation: string;
      confidence: string;
    };
    expect(typeof data.explanation).toBe("string");
    expect(data.explanation.length).toBeGreaterThan(0);
  });

  it("returns error for missing params", async () => {
    const tool = findTool("suggest_fix");
    const session = new McpSession();
    const result = await tool.handler({ ruleId: "media/alt-text-missing" }, session);
    expect(result.isError).toBe(true);
  });
});
