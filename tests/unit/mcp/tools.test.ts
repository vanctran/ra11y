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

  it("omits verbose arrays by default and surfaces them under verboseMeta", async () => {
    const tool = findTool("scan");
    const session = new McpSession();
    const terse = await tool.handler({ paths: [BAD_ALT] }, session);
    const terseData = JSON.parse(terse.content[0].text) as {
      meta: { analysisCoverage?: Record<string, unknown> };
    };
    const terseCov = terseData.meta.analysisCoverage ?? {};
    expect(terseCov.parseErrorFiles).toBeUndefined();
    expect(terseCov.opaqueCustomComponentNames).toBeUndefined();
    expect(terseCov.rulesByExtension).toBeUndefined();

    const verbose = await tool.handler({ paths: [BAD_ALT], verboseMeta: true }, session);
    const verboseData = JSON.parse(verbose.content[0].text) as {
      meta: { analysisCoverage?: Record<string, unknown> };
    };
    const cov = verboseData.meta.analysisCoverage ?? {};
    // BAD_ALT is a .html fixture — expect rulesByExtension to include .html.
    expect(cov.rulesByExtension).toBeDefined();
    const byExt = cov.rulesByExtension as Record<string, string[]>;
    expect(Array.isArray(byExt[".html"])).toBe(true);
    expect(byExt[".html"].length).toBeGreaterThan(0);
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
      plan: { totalFindings: number };
      meta: { filesScanned: number; scannedRoot: string };
      scannedRoot?: string;
    };
    // scannedRoot lives inside meta only — the top-level duplicate was
    // removed. Assert the top-level field is gone so the shape stays
    // de-duplicated.
    expect(data.scannedRoot).toBeUndefined();
    expect(data.meta.scannedRoot).toBe(fixtureDir);
    expect(data.meta.filesScanned).toBeGreaterThan(0);
  });

  describe("directive nextStep", () => {
    it("on a fixture with violations, names the first file:line and the recommended tool", async () => {
      const tool = findTool("scan_project");
      const session = new McpSession();
      const fixtureDir = BAD_ALT.replace(/\/[^/]+$/, "");
      const result = await tool.handler({ cwd: fixtureDir }, session);
      const data = JSON.parse(result.content[0].text) as {
        plan: {
          violations?: number;
          mechanicalEditsAvailable?: number;
          guidanceFixesAvailable?: number;
        };
        meta: { nextStep: string };
      };
      // The fixture at tests/fixtures/bad/alt-text-missing/ has violations.
      expect(data.plan.violations).toBeGreaterThan(0);
      // Directive guidance: calls out suggest_fix or explain_rule, names a file:line.
      expect(data.meta.nextStep).toMatch(/suggest_fix|explain_rule/);
      expect(data.meta.nextStep).toMatch(/\.html:\d+|\.tsx:\d+|\.jsx:\d+/);
    });

    it("on a clean directory, points at checklist for the manual-review half", async () => {
      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join: joinPath } = await import("node:path");

      const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-clean-"));
      await writeFile(joinPath(dir, "app.tsx"), "export const App = () => <div />;");

      const tool = findTool("scan_project");
      const session = new McpSession();
      const result = await tool.handler({ cwd: dir }, session);
      const data = JSON.parse(result.content[0].text) as { meta: { nextStep: string } };
      expect(data.meta.nextStep).toContain("checklist");
    });
  });

  describe("autoDetectWrappers", () => {
    it("registers PascalCase-with-onClick components inline and surfaces them in meta", async () => {
      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join: joinPath } = await import("node:path");

      const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-auto-detect-"));
      await writeFile(
        joinPath(dir, "app.tsx"),
        [
          "export function App() {",
          "  return (",
          "    <>",
          "      <ActionButton onClick={a} />",
          "      <ActionButton onClick={b} />",
          "      <Card onClick={c} />",
          "    </>",
          "  );",
          "}",
        ].join("\n"),
      );

      const tool = findTool("scan_project");
      const session = new McpSession();
      const result = await tool.handler({ cwd: dir, autoDetectWrappers: true }, session);
      const data = JSON.parse(result.content[0].text) as {
        meta: {
          autoDetectedWrappers?: string[];
          autoDetectedWrappersNote?: string;
        };
      };
      expect(data.meta.autoDetectedWrappers).toEqual(["ActionButton", "Card"]);
      // Note spells out the concrete defineConfig shape so the agent
      // can compose the ra11y.config.ts edit in one Read+Edit pass.
      expect(data.meta.autoDetectedWrappersNote).toContain("defineConfig");
      expect(data.meta.autoDetectedWrappersNote).toContain('"ActionButton"');
      expect(data.meta.autoDetectedWrappersNote).toContain('"Card"');
    });

    it("omits the meta fields entirely when the flag is off", async () => {
      const tool = findTool("scan_project");
      const session = new McpSession();
      const fixtureDir = BAD_ALT.replace(/\/[^/]+$/, "");
      const result = await tool.handler({ cwd: fixtureDir }, session);
      const data = JSON.parse(result.content[0].text) as {
        meta: Record<string, unknown>;
      };
      expect(data.meta["autoDetectedWrappers"]).toBeUndefined();
      expect(data.meta["autoDetectedWrappersNote"]).toBeUndefined();
    });

    it("surfaces wrapper candidates as suggestions (not registrations) when config is missing and the flag is off", async () => {
      // Onboarding signal: the agent should see what a nativeWrappers
      // list would look like before writing ra11y.config.ts, without
      // implicitly registering anything. Silent onboarding was the
      // most common field-report friction.
      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join: joinPath } = await import("node:path");

      const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-config-miss-hint-"));
      await writeFile(
        joinPath(dir, "app.tsx"),
        [
          "export function App() {",
          "  return (",
          "    <>",
          "      <ActionButton onClick={a} />",
          "      <Card onClick={c} />",
          "    </>",
          "  );",
          "}",
        ].join("\n"),
      );

      const tool = findTool("scan_project");
      const session = new McpSession();
      const result = await tool.handler({ cwd: dir }, session);
      const data = JSON.parse(result.content[0].text) as {
        meta: {
          configSource: string | null;
          autoDetectedWrappers?: string[];
          suggestedNativeWrappers?: string[];
          suggestedNativeWrappersNote?: string;
        };
      };
      expect(data.meta.configSource).toBeNull();
      expect(data.meta.autoDetectedWrappers).toBeUndefined();
      expect(data.meta.suggestedNativeWrappers).toEqual(["ActionButton", "Card"]);
      expect(data.meta.suggestedNativeWrappersNote).toContain("Not yet registered");
      expect(data.meta.suggestedNativeWrappersNote).toContain("autoDetectWrappers: true");
    });

    it("keeps session config pristine — detected wrappers are scan-scoped only", async () => {
      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join: joinPath } = await import("node:path");

      const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-auto-detect-scope-"));
      await writeFile(joinPath(dir, "app.tsx"), "export const App = () => <Widget onClick={x} />;");

      const tool = findTool("scan_project");
      const session = new McpSession();
      await tool.handler({ cwd: dir, autoDetectWrappers: true }, session);
      expect(session.config.nativeWrappers).not.toContain("Widget");
    });

    it("does NOT mis-attribute auto-detected wrappers to sessionNativeWrappers", async () => {
      // Regression: prior impl dumped detected names into fromSession so
      // the sessionOverridesNote falsely warned that configure() had
      // added them. The audit should stay pristine when the agent only
      // used autoDetectWrappers.
      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join: joinPath } = await import("node:path");

      const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-auto-detect-attrib-"));
      await writeFile(
        joinPath(dir, "app.tsx"),
        [
          "export function App() {",
          "  return (",
          "    <>",
          "      <DesignSystemButton onClick={a} />",
          "      <DesignSystemCard onClick={b} />",
          "    </>",
          "  );",
          "}",
        ].join("\n"),
      );

      const tool = findTool("scan_project");
      const session = new McpSession();
      const result = await tool.handler({ cwd: dir, autoDetectWrappers: true }, session);
      const data = JSON.parse(result.content[0].text) as {
        meta: {
          autoDetectedWrappers?: string[];
          sessionNativeWrappers?: string[];
          sessionOverridesNote?: string;
        };
      };
      expect(data.meta.autoDetectedWrappers).toEqual(["DesignSystemButton", "DesignSystemCard"]);
      expect(data.meta.sessionNativeWrappers).toBeUndefined();
      expect(data.meta.sessionOverridesNote).toBeUndefined();
    });

    it("attributes activeNativeWrappers to their source (config / session / autoDetect)", async () => {
      // Debugging "why is X active?" needs the source per wrapper.
      // configure() contributes session names, autoDetect contributes
      // scan-scoped names, and ra11y.config.ts contributes config names.
      // bySource shows all three.
      //
      // autoDetect names are split into `{confirmed, assumed}` by the
      // one-hop AST probe (P1-F). This test adds a defining
      // `ActionButton.tsx` whose root is a native <button>, so the
      // detector promotes it to `confirmed` — the path that flows into
      // the active allowlist.
      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join: joinPath } = await import("node:path");

      const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-wrapper-provenance-"));
      await writeFile(
        joinPath(dir, "app.tsx"),
        [
          "export function App() {",
          "  return (",
          "    <>",
          "      <ActionButton onClick={a} />",
          "    </>",
          "  );",
          "}",
        ].join("\n"),
      );
      await writeFile(
        joinPath(dir, "ActionButton.tsx"),
        "export function ActionButton(p) { return <button {...p} />; }",
      );

      const tool = findTool("scan_project");
      const session = new McpSession();
      // Simulate a prior configure() call contributing a wrapper that
      // isn't present in this scan's source — so fromSession and
      // fromAutoDetect stay cleanly non-overlapping.
      session.config = { ...session.config, nativeWrappers: ["SessionOnlyWidget"] };
      const result = await tool.handler({ cwd: dir, autoDetectWrappers: true }, session);
      const data = JSON.parse(result.content[0].text) as {
        meta: {
          activeNativeWrappers?: string[];
          activeNativeWrappersBySource?: {
            fromConfig?: string[];
            fromSession?: string[];
            fromAutoDetect?: { confirmed?: string[]; assumed?: string[] };
          };
        };
      };
      expect(data.meta.activeNativeWrappers).toEqual(
        expect.arrayContaining(["ActionButton", "SessionOnlyWidget"]),
      );
      expect(data.meta.activeNativeWrappersBySource?.fromConfig).toBeUndefined();
      expect(data.meta.activeNativeWrappersBySource?.fromSession).toEqual(["SessionOnlyWidget"]);
      expect(data.meta.activeNativeWrappersBySource?.fromAutoDetect).toEqual({
        confirmed: ["ActionButton"],
      });
    });

    it("splits auto-detected wrappers into confirmed vs assumed via the one-hop AST probe (P1-F)", async () => {
      // The core P1-F behavior: an auto-detected wrapper whose
      // defining file renders a native <button> is `confirmed` and
      // silences findings; one whose defining file renders <div> is
      // `assumed` and stays opaque (rules fire as if the name were
      // NOT in the wrapper list). See CLAUDE.md §1 "No heuristic
      // suppression" — only structural evidence earns confirmation.
      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join: joinPath } = await import("node:path");

      const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-autodetect-split-"));
      // The real <button> wrapper — confirms.
      await writeFile(
        joinPath(dir, "Button.tsx"),
        "export function Button(p) { return <button {...p} />; }",
      );
      // A PascalCase wrapper whose root is a bare <div> — assumed.
      // This is the canonical silent-silencing risk P1-F closes: if
      // this wrapper reached `activeNativeWrappers`, findings on it
      // would disappear even though the <div> underneath might be a
      // real keyboard-operability bug.
      await writeFile(
        joinPath(dir, "BeliefSubmitButton.tsx"),
        "export function BeliefSubmitButton(p) { return <div {...p}>submit</div>; }",
      );
      await writeFile(
        joinPath(dir, "app.tsx"),
        [
          "export function App() {",
          "  return (",
          "    <>",
          "      <Button onClick={a} />",
          "      <BeliefSubmitButton onClick={b} />",
          "    </>",
          "  );",
          "}",
        ].join("\n"),
      );

      const tool = findTool("scan_project");
      const session = new McpSession();
      const result = await tool.handler({ cwd: dir, autoDetectWrappers: true }, session);
      const data = JSON.parse(result.content[0].text) as {
        meta: {
          activeNativeWrappers?: string[];
          activeNativeWrappersBySource?: {
            fromAutoDetect?: { confirmed?: string[]; assumed?: string[] };
          };
        };
      };
      // Only the confirmed wrapper reaches the active list; the
      // assumed one is surfaced in the provenance block but NOT
      // silenced.
      expect(data.meta.activeNativeWrappers).toEqual(["Button"]);
      expect(data.meta.activeNativeWrappersBySource?.fromAutoDetect).toEqual({
        confirmed: ["Button"],
        assumed: ["BeliefSubmitButton"],
      });
    });

    it("leaves assumed wrappers opaque — findings on them are NOT silenced", async () => {
      // Acceptance criterion (v) from the P1-F brief, observed at the
      // MCP filter layer: when a wrapper is assumed (not confirmed),
      // the scanner's wrapper-noise filter must not drop findings
      // carrying that component's name.
      //
      // The invariant is encoded at the effective-allowlist layer: if
      // an assumed name is NOT in `activeNativeWrappers`, then
      // `dropWrapperNoise` (keyed on that list) cannot silence findings
      // whose message starts with `<AssumedName>`. This test proves
      // the list exclusion; the downstream filter is transitively
      // correct.
      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join: joinPath } = await import("node:path");

      const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-assumed-opaque-"));
      await writeFile(
        joinPath(dir, "PerceptionSlider.tsx"),
        // <div role='slider'> is the P1-F motivating example — looks
        // like a native wrapper by name, is a real bug underneath.
        "export function PerceptionSlider(p) { return <div role='slider' {...p} />; }",
      );
      await writeFile(
        joinPath(dir, "app.tsx"),
        "export const App = () => <PerceptionSlider onClick={x} />;",
      );
      const tool = findTool("scan_project");
      const session = new McpSession();
      const result = await tool.handler({ cwd: dir, autoDetectWrappers: true }, session);
      const data = JSON.parse(result.content[0].text) as {
        meta: {
          activeNativeWrappers?: string[];
          activeNativeWrappersBySource?: {
            fromAutoDetect?: { confirmed?: string[]; assumed?: string[] };
          };
        };
      };
      expect(data.meta.activeNativeWrappers).toBeUndefined();
      expect(data.meta.activeNativeWrappersBySource?.fromAutoDetect).toEqual({
        assumed: ["PerceptionSlider"],
      });
    });

    it("reports zero-detection plainly when no candidates are found", async () => {
      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join: joinPath } = await import("node:path");

      const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-auto-detect-empty-"));
      await writeFile(joinPath(dir, "app.ts"), "export const x = 1;");

      const tool = findTool("scan_project");
      const session = new McpSession();
      const result = await tool.handler({ cwd: dir, autoDetectWrappers: true }, session);
      const data = JSON.parse(result.content[0].text) as {
        meta: { autoDetectedWrappers?: string[]; autoDetectedWrappersNote?: string };
      };
      expect(data.meta.autoDetectedWrappers).toEqual([]);
      expect(data.meta.autoDetectedWrappersNote).toContain("found no");
    });

    it("detects input-shaped wrappers (value + onChange) alongside button-shaped ones", async () => {
      // The React controlled-input signal: PascalCase + value + onChange.
      // Before this, only onClick components were registered and Input
      // wrappers stayed in opaqueCustomComponents forever.
      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join: joinPath } = await import("node:path");

      const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-input-wrapper-"));
      await writeFile(
        joinPath(dir, "app.tsx"),
        [
          "export function App() {",
          "  return (",
          "    <>",
          "      <Input value={v} onChange={setV} />",
          "      <Checkbox checked={c} onChange={setC} />",
          "      <Textarea defaultValue={t} onChange={setT} />",
          "      <SubmitButton onClick={go} />",
          "    </>",
          "  );",
          "}",
        ].join("\n"),
      );

      const tool = findTool("scan_project");
      const session = new McpSession();
      const result = await tool.handler({ cwd: dir, autoDetectWrappers: true }, session);
      const data = JSON.parse(result.content[0].text) as {
        meta: { autoDetectedWrappers?: string[] };
      };
      expect(data.meta.autoDetectedWrappers).toEqual([
        "Checkbox",
        "Input",
        "SubmitButton",
        "Textarea",
      ]);
    });
  });

  describe("additionalPaths", () => {
    it("scans a gitignored dist directory when listed explicitly", async () => {
      const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join: joinPath } = await import("node:path");

      const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-extra-"));
      await writeFile(joinPath(dir, ".gitignore"), "dist/\n");
      await writeFile(joinPath(dir, "app.tsx"), "export const App = () => <div />;");
      await mkdir(joinPath(dir, "dist", "assets"), { recursive: true });
      await writeFile(
        joinPath(dir, "dist", "assets", "main.css"),
        ".foo { color: #eee; background: #fff; }",
      );

      const tool = findTool("scan_project");
      const session = new McpSession();
      const result = await tool.handler({ cwd: dir, additionalPaths: ["dist/assets"] }, session);
      const data = JSON.parse(result.content[0].text) as {
        meta: {
          additionalPathsScanned?: { filesAdded: number; paths: string[]; note: string };
        };
      };
      expect(data.meta.additionalPathsScanned).toBeDefined();
      expect(data.meta.additionalPathsScanned?.filesAdded).toBe(1);
      expect(data.meta.additionalPathsScanned?.paths).toEqual(["dist/assets"]);
    });

    it("omits the additionalPathsScanned meta block when the param is absent", async () => {
      const tool = findTool("scan_project");
      const session = new McpSession();
      const fixtureDir = BAD_ALT.replace(/\/[^/]+$/, "");
      const result = await tool.handler({ cwd: fixtureDir }, session);
      const data = JSON.parse(result.content[0].text) as { meta: Record<string, unknown> };
      expect(data.meta["additionalPathsScanned"]).toBeUndefined();
    });

    it("reports 0 filesAdded when every additional file is already in the base tree", async () => {
      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join: joinPath } = await import("node:path");

      const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-extra-dup-"));
      await writeFile(joinPath(dir, "app.tsx"), "export const App = () => <div />;");

      const tool = findTool("scan_project");
      const session = new McpSession();
      const result = await tool.handler({ cwd: dir, additionalPaths: ["."] }, session);
      const data = JSON.parse(result.content[0].text) as {
        meta: {
          additionalPathsScanned?: { filesAdded: number };
        };
      };
      expect(data.meta.additionalPathsScanned?.filesAdded).toBe(0);
    });
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

describe("MCP tool: detect_native_wrappers", () => {
  it("groups info-level keyboard/handler-missing findings by component name", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: joinPath } = await import("node:path");

    const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-detect-"));
    // Two occurrences of ActionButton, one of Card, and a real <div onClick>.
    // The tool should surface the first two as candidates and skip the div.
    const fixture = joinPath(dir, "app.tsx");
    await writeFile(
      fixture,
      [
        "export function App() {",
        "  return (",
        "    <>",
        "      <ActionButton onClick={a} />",
        "      <ActionButton onClick={b} />",
        "      <Card onClick={c} />",
        "      <div onClick={d}>native</div>",
        "    </>",
        "  );",
        "}",
      ].join("\n"),
    );

    const tool = findTool("detect_native_wrappers");
    const session = new McpSession();
    const result = await tool.handler({ cwd: dir }, session);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text) as {
      candidates: Array<{ component: string; occurrences: number }>;
      nextStep: string;
    };
    const names = data.candidates.map((c) => c.component).sort();
    expect(names).toEqual(["ActionButton", "Card"]);
    const action = data.candidates.find((c) => c.component === "ActionButton");
    expect(action?.occurrences).toBe(2);
    expect(data.nextStep).toContain("nativeWrappers");
  });

  it("returns empty candidates when no PascalCase onClick is present", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: joinPath } = await import("node:path");

    const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-detect-empty-"));
    await writeFile(joinPath(dir, "app.tsx"), "export const x = 1;");

    const tool = findTool("detect_native_wrappers");
    const session = new McpSession();
    const result = await tool.handler({ cwd: dir }, session);

    const data = JSON.parse(result.content[0].text) as {
      candidates: unknown[];
      nextStep: string;
    };
    expect(data.candidates).toEqual([]);
    expect(data.nextStep).toContain("No PascalCase");
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

  it("keyboard/handler-missing trusts PascalCase and still errors on <div onClick>", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: joinPath } = await import("node:path");

    const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-native-wrappers-"));
    // Custom components are assumed keyboard-operable — "can't see through
    // the component" is not a finding. A bare <div onClick> remains an
    // error because the DOM surface is visible and broken.
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
    const session = new McpSession();
    const result = await scanTool.handler({ paths: [fixture], cwd: dir }, session);

    const data = JSON.parse(result.content[0].text) as {
      files: Array<{ findings: Array<{ ruleId: string; message: string; severity: string }> }>;
    };
    const khm = data.files.flatMap((f) =>
      f.findings.filter((v) => v.ruleId === "keyboard/handler-missing"),
    );
    expect(khm.some((v) => v.message.includes("ActionButton"))).toBe(false);
    expect(khm.some((v) => v.message.includes("OtherWidget"))).toBe(false);
    expect(khm.some((v) => v.severity === "error")).toBe(true);
  });

  it("unusedNativeWrappers ignores wrappers that are used via JSX (no suppressed violation)", async () => {
    // Regression: unusedNativeWrappers previously relied on suppressed
    // keyboard/handler-missing info violations to learn which wrappers
    // were "seen." A wrapper used correctly (no violation ever fires)
    // was wrongly reported unused — pushing users to delete valid
    // ra11y.config.ts entries. Now we scan the JSX directly.
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: joinPath } = await import("node:path");

    const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-unused-wrappers-"));
    await writeFile(
      joinPath(dir, "ra11y.config.ts"),
      `export default { nativeWrappers: ["ActionButton", "GhostWrapper"] };\n`,
    );
    // ActionButton is used with valid props (no onClick → no noise to
    // suppress), GhostWrapper never appears. Only GhostWrapper should
    // surface as unused.
    await writeFile(
      joinPath(dir, "app.tsx"),
      ["export function App() {", '  return <ActionButton label="Save" />;', "}"].join("\n"),
    );

    const scanTool = findTool("scan");
    const session = new McpSession();
    const result = await scanTool.handler({ paths: [dir], cwd: dir }, session);

    const data = JSON.parse(result.content[0].text) as {
      meta: { unusedNativeWrappers?: string[] };
    };
    expect(data.meta.unusedNativeWrappers).toEqual(["GhostWrapper"]);
  });

  it("unusedNativeWrappers widens detection into excluded paths (stories, dev-tools)", async () => {
    // Regression for Leela feedback: ActionButton was only referenced
    // from dev-tools/ and *.stories.*, both default-excluded. The
    // narrow AST-only detector marked it unused even though the real
    // code used it — just not in files ra11y scans by default.
    const { mkdir, mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: joinPath } = await import("node:path");

    const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-wrapper-widen-"));
    await writeFile(
      joinPath(dir, "ra11y.config.ts"),
      `export default { nativeWrappers: ["ActionButton", "TrulyGhost"] };\n`,
    );
    // No in-scope usage — ActionButton lives only in dev-tools/.
    const devToolsDir = joinPath(dir, "dev-tools");
    await mkdir(devToolsDir);
    await writeFile(
      joinPath(devToolsDir, "panel.tsx"),
      `export const Panel = () => <ActionButton label="Reload" />;\n`,
    );
    // Keep an in-scope .tsx file so the scan has something to parse.
    await writeFile(joinPath(dir, "app.tsx"), `export const App = () => <div />;\n`);

    const scanTool = findTool("scan");
    const session = new McpSession();
    const result = await scanTool.handler({ paths: [dir], cwd: dir }, session);

    const data = JSON.parse(result.content[0].text) as {
      meta: { unusedNativeWrappers?: string[] };
    };
    // ActionButton present in excluded dev-tools/ → not unused.
    // TrulyGhost present nowhere → still unused.
    expect(data.meta.unusedNativeWrappers).toEqual(["TrulyGhost"]);
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
      automatedCriteriaPassRate: number;
      criteriaTotal: number;
      criteriaAutomatable: number;
      criteriaManualReviewRequired: number;
      summary: string;
    };
    expect(data.standardId).toBe("wcag22");
    expect(typeof data.automatedCriteriaPassRate).toBe("number");
    expect(data.criteriaTotal).toBeGreaterThan(0);
    expect(data.criteriaAutomatable).toBeLessThanOrEqual(data.criteriaTotal);
    expect(data.criteriaManualReviewRequired).toBeGreaterThan(0);
    expect(data.summary).toContain("manual");
    // Must NOT expose overallAutomatedCoverage — that ratio reads as failure
    // ("54%") when it actually measures a property of the rule library.
    expect((data as Record<string, unknown>).overallAutomatedCoverage).toBeUndefined();
  });
});

describe("MCP tool: audit", () => {
  it("returns { scan, coverage, checklist, nextStep } in one round-trip", async () => {
    const tool = findTool("audit");
    const session = new McpSession();
    const result = await tool.handler(
      { cwd: join(FIXTURE_DIR, "good", "alt-text-missing") },
      session,
    );

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text) as {
      scan: unknown;
      coverage: unknown;
      checklist: unknown;
      nextStep: unknown;
    };
    expect(typeof data.nextStep).toBe("string");
    expect(data.scan).toBeTruthy();
    expect(data.coverage).toBeTruthy();
    expect(data.checklist).toBeTruthy();
    const checklist = data.checklist as { summary: { actionable: number } };
    expect(typeof checklist.summary.actionable).toBe("number");
  });

  it("forwards scan-only parameters to the scan leg", async () => {
    // autoDetectWrappers is a scan_project-only flag; verify audit
    // doesn't choke when a union-of-params is passed and that the
    // checklist/coverage legs still complete.
    const tool = findTool("audit");
    const session = new McpSession();
    const result = await tool.handler(
      { cwd: join(FIXTURE_DIR, "good", "alt-text-missing"), autoDetectWrappers: true },
      session,
    );

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text) as {
      scan: { meta: { autoDetectedWrappers?: unknown } };
    };
    expect(Array.isArray(data.scan.meta.autoDetectedWrappers)).toBe(true);
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

  it("surfaces structured primary + alternatives for rules that emit fixPaths", async () => {
    // label-in-name emits ranked fix paths; the agent should see
    // labeled primary + alternatives, not concatenated prose.
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: joinPath } = await import("node:path");

    const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-suggest-fix-paths-"));
    const file = joinPath(dir, "index.html");
    await writeFile(file, `<button aria-label="Submit form">Send</button>`);

    const tool = findTool("suggest_fix");
    const session = new McpSession();
    const result = await tool.handler(
      { ruleId: "semantics/label-in-name", file, line: 1 },
      session,
    );
    const data = JSON.parse(result.content[0].text) as {
      kind: string;
      primary?: { label: string };
      alternatives?: Array<{ label: string }>;
      explanation: string;
    };
    expect(data.kind).toBe("guidance");
    expect(data.primary?.label).toBeTruthy();
    expect(data.alternatives).toHaveLength(2);
    expect(data.alternatives?.every((a) => a.label.length > 0)).toBe(true);
  });

  it("returns kind: 'none' when no violation matches at the given line", async () => {
    const tool = findTool("suggest_fix");
    const session = new McpSession();
    const result = await tool.handler(
      { ruleId: "media/alt-text-missing", file: BAD_ALT, line: 9999 },
      session,
    );
    const data = JSON.parse(result.content[0].text) as { kind: string };
    expect(data.kind).toBe("none");
  });
});
