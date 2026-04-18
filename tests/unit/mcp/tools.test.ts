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
      // Directive guidance: names either a `suggest_fix` / `explain_rule`
      // hop (mixed or guidance-lane fixture) or, under the Q2R2-FIX-DEDUPE
      // trim, the inline mechanical `primary.edit` path (fixture is
      // all-mechanical — alt-text-missing is fixClass: "mechanical"). The
      // match covers both shapes so the test keeps asserting "the
      // response points somewhere concrete" without locking in one
      // specific lane. When the round-trip nudge is present, we keep
      // the stricter file:line assertion; when the dedupe trims it, the
      // inline-fix prose doesn't name a file:line (the agent reads the
      // finding instead).
      if (/suggest_fix|explain_rule/.test(data.meta.nextStep)) {
        expect(data.meta.nextStep).toMatch(/\.html:\d+|\.tsx:\d+|\.jsx:\d+/);
      } else {
        expect(data.meta.nextStep).toContain("primary.edit");
      }
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

    it("does NOT mis-attribute auto-detected wrappers to session provenance", async () => {
      // Regression: prior impl dumped detected names into fromSession so
      // the sessionOverridesNote falsely warned that configure() had
      // added them. Under the unified tagged list, the invariant is
      // that no entry carries `source: "session"` and
      // sessionOverridesNote stays absent when the agent only used
      // autoDetectWrappers.
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
          activeNativeWrappers?: Array<{ name: string; source: string; confirmed?: boolean }>;
          sessionOverridesNote?: string;
        };
      };
      expect(data.meta.autoDetectedWrappers).toEqual(["DesignSystemButton", "DesignSystemCard"]);
      const sessionTagged = (data.meta.activeNativeWrappers ?? []).filter(
        (e) => e.source === "session",
      );
      expect(sessionTagged).toEqual([]);
      expect(data.meta.sessionOverridesNote).toBeUndefined();
    });

    it("tags each activeNativeWrappers entry with its source (config / session / autoDetect)", async () => {
      // Debugging "why is X active?" needs the source per wrapper.
      // configure() contributes `source: "session"`, autoDetect
      // contributes `source: "autoDetect"` (with a `confirmed` flag),
      // and ra11y.config.ts contributes `source: "config"`. The
      // unified tagged list shows all three in one field.
      //
      // autoDetect names are split by the one-hop AST probe (P1-F).
      // This test adds a defining `ActionButton.tsx` whose root is a
      // native <button>, so the detector promotes it to
      // `confirmed: true` — the path that flows into the active
      // allowlist and silences findings.
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
      // isn't present in this scan's source — so the session and
      // autoDetect channels stay cleanly non-overlapping.
      session.config.nativeWrappers = ["SessionOnlyWidget"];
      const result = await tool.handler({ cwd: dir, autoDetectWrappers: true }, session);
      const data = JSON.parse(result.content[0].text) as {
        meta: {
          activeNativeWrappers?: Array<{ name: string; source: string; confirmed?: boolean }>;
        };
      };
      const entries = data.meta.activeNativeWrappers ?? [];
      expect(entries).toEqual(
        expect.arrayContaining([
          { name: "ActionButton", source: "autoDetect", confirmed: true },
          { name: "SessionOnlyWidget", source: "session" },
        ]),
      );
      // No config-sourced entries because no ra11y.config.ts lives
      // under the temp dir.
      expect(entries.some((e) => e.source === "config")).toBe(false);
    });

    it("splits auto-detected wrappers into confirmed vs assumed via the one-hop AST probe (P1-F)", async () => {
      // The core P1-F behavior: an auto-detected wrapper whose
      // defining file renders a native <button> is `confirmed: true`
      // and silences findings; one whose defining file renders <div>
      // is `confirmed: false` (assumed) and stays opaque (rules fire
      // as if the name were NOT in the wrapper list). See CLAUDE.md
      // §1 "No heuristic suppression" — only structural evidence
      // earns confirmation.
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
      // this wrapper reached the effective allowlist, findings on it
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
          activeNativeWrappers?: Array<{ name: string; source: string; confirmed?: boolean }>;
        };
      };
      // Both names surface as tagged entries; only the confirmed one
      // carries `confirmed: true`, the assumed one carries
      // `confirmed: false` and is left out of the effective allowlist.
      const entries = data.meta.activeNativeWrappers ?? [];
      expect(entries).toEqual([
        { name: "Button", source: "autoDetect", confirmed: true },
        { name: "BeliefSubmitButton", source: "autoDetect", confirmed: false },
      ]);
    });

    it("leaves assumed wrappers opaque — findings on them are NOT silenced", async () => {
      // Acceptance criterion (v) from the P1-F brief, observed at the
      // MCP filter layer: when a wrapper is assumed (confirmed: false),
      // the scanner's wrapper-noise filter must not drop findings
      // carrying that component's name.
      //
      // Under the unified tagged list, the invariant is that an
      // assumed entry is still emitted (so the agent sees it), but
      // `dropWrapperNoise` is keyed on the confirmed-only effective
      // allowlist — so findings on assumed names stay live.
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
          activeNativeWrappers?: Array<{ name: string; source: string; confirmed?: boolean }>;
        };
      };
      expect(data.meta.activeNativeWrappers).toEqual([
        { name: "PerceptionSlider", source: "autoDetect", confirmed: false },
      ]);
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

  it("emits suggestedConfigSnippet as a structured field when candidates are found", async () => {
    // Q2R2-CFG-SNIPPET: agents previously had to parse the English
    // `nextStep` prose to extract a usable config fragment. The
    // structured twin is a `defineConfig`-compatible string they can
    // paste directly into ra11y.config.ts. Array form here because
    // `collectWrapperCandidates` does not carry per-candidate native
    // element mappings.
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: joinPath } = await import("node:path");

    const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-detect-snippet-"));
    await writeFile(
      joinPath(dir, "app.tsx"),
      [
        "export function App() {",
        "  return (",
        "    <>",
        "      <Link onClick={x} />",
        "      <Button onClick={y} />",
        "    </>",
        "  );",
        "}",
      ].join("\n"),
    );

    const tool = findTool("detect_native_wrappers");
    const session = new McpSession();
    const result = await tool.handler({ cwd: dir }, session);

    const data = JSON.parse(result.content[0].text) as {
      candidates: Array<{ component: string }>;
      suggestedConfigSnippet?: string;
      nextStep: string;
    };
    expect(data.candidates.length).toBeGreaterThan(0);
    expect(typeof data.suggestedConfigSnippet).toBe("string");
    // defineConfig-compatible; names sorted lexicographically.
    expect(data.suggestedConfigSnippet).toBe(
      ["defineConfig({", "  nativeWrappers: [", '    "Button",', '    "Link",', "  ],", "});"].join(
        "\n",
      ),
    );
    // nextStep prose stays unchanged — agents using either surface
    // keep working (Q2R2-CFG-SNIPPET is additive, not a replacement).
    expect(data.nextStep).toContain("nativeWrappers");
  });

  it("omits suggestedConfigSnippet entirely when zero candidates are produced", async () => {
    // Per CLAUDE.md §1 "Ambiguous field shapes are dishonest," the
    // response omits the field via conditional spread rather than
    // shipping `""` or `null`. A caller checking `typeof` sees
    // `undefined` and knows there's nothing to paste.
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: joinPath } = await import("node:path");

    const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-detect-snippet-empty-"));
    await writeFile(joinPath(dir, "app.tsx"), "export const x = 1;");

    const tool = findTool("detect_native_wrappers");
    const session = new McpSession();
    const result = await tool.handler({ cwd: dir }, session);

    const raw = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(raw.candidates).toEqual([]);
    expect("suggestedConfigSnippet" in raw).toBe(false);
  });

  it("is idempotent on re-call — same cwd returns byte-identical snippet", async () => {
    // Re-calling the tool on an unchanged project must yield the same
    // snippet. Load-bearing for agents that diff scans across calls;
    // a flapping snippet would look like a config change.
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: joinPath } = await import("node:path");

    const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-detect-snippet-idem-"));
    await writeFile(joinPath(dir, "app.tsx"), "export const App = () => <Button onClick={x} />;");

    const tool = findTool("detect_native_wrappers");
    const session = new McpSession();
    const first = await tool.handler({ cwd: dir }, session);
    const second = await tool.handler({ cwd: dir }, session);

    const a = JSON.parse(first.content[0].text) as { suggestedConfigSnippet?: string };
    const b = JSON.parse(second.content[0].text) as { suggestedConfigSnippet?: string };
    expect(a.suggestedConfigSnippet).toBeDefined();
    expect(a.suggestedConfigSnippet).toBe(b.suggestedConfigSnippet);
  });
});

describe("MCP tool: sessionConfigure", () => {
  it("sets session defaults and returns active config", async () => {
    const tool = findTool("sessionConfigure");
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
    const configureTool = findTool("sessionConfigure");
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

  it("nativeWrappers glob patterns silence findings for every matching component", async () => {
    // A design-system root can register `*Button` once instead of
    // enumerating every Icon/Action/Submit/Ghost variant. Each variant
    // is silenced by `dropWrapperNoise` via the glob match — no need
    // to keep the config list in lockstep with component renames.
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: joinPath } = await import("node:path");

    const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-wrapper-glob-"));
    await writeFile(
      joinPath(dir, "ra11y.config.ts"),
      `export default { nativeWrappers: ["*Button", "Icon*"] };\n`,
    );
    await writeFile(
      joinPath(dir, "app.tsx"),
      [
        "export function App() {",
        "  return (",
        "    <>",
        "      <ActionButton onClick={a} />",
        "      <IconBadge onClick={b} />",
        "      <div onClick={c}>bare</div>",
        "    </>",
        "  );",
        "}",
      ].join("\n"),
    );

    const scanTool = findTool("scan");
    const session = new McpSession();
    const result = await scanTool.handler({ paths: [dir], cwd: dir }, session);
    const data = JSON.parse(result.content[0].text) as {
      files: Array<{ findings: Array<{ ruleId: string; message: string; severity: string }> }>;
    };
    const khm = data.files.flatMap((f) =>
      f.findings.filter((v) => v.ruleId === "keyboard/handler-missing"),
    );
    expect(khm.some((v) => v.message.includes("ActionButton"))).toBe(false);
    expect(khm.some((v) => v.message.includes("IconBadge"))).toBe(false);
    // Bare `<div onClick>` still errors — wrapper globs only silence
    // PascalCase component names.
    expect(khm.some((v) => v.severity === "error")).toBe(true);
  });

  it("unusedNativeWrappers reports glob patterns that matched nothing in scope", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join: joinPath } = await import("node:path");

    const dir = await mkdtemp(joinPath(tmpdir(), "ra11y-wrapper-glob-unused-"));
    await writeFile(
      joinPath(dir, "ra11y.config.ts"),
      `export default { nativeWrappers: ["*Button", "Ghost*"] };\n`,
    );
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
    // `*Button` matched ActionButton — "used." `Ghost*` matched
    // nothing — surfaces as unused.
    expect(data.meta.unusedNativeWrappers).toEqual(["Ghost*"]);
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
