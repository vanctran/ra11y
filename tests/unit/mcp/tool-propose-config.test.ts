/**
 * Unit tests for the `propose_config` MCP tool.
 *
 * Five scenarios covering the four cases the config builder
 * recognises (clean scan → minimal, wrappers only, wrappers +
 * build-artifact excludes, wrappers + findings → commented rules
 * stub), plus one zero-findings-zero-wrappers case that proves the
 * honest-empty shape is a syntactically complete `defineConfig({})`
 * with a comment rather than an empty string.
 *
 * Tests drive the handler directly with a scratch filesystem fixture
 * rather than through the MCP protocol — the integration path is
 * exercised by the shared `mcp-tools` integration test.
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpSession } from "../../../src/mcp/session.ts";
import { proposeConfigTool } from "../../../src/mcp/tool-propose-config.ts";

interface ProposeConfigResponse {
  readonly suggestedConfig: string;
  readonly meta: {
    readonly scannedRoot: string;
    readonly configSource: string | null;
    readonly filesScanned: number;
    readonly rulesEvaluated: number;
    readonly wrappersIncluded: number;
    readonly buildArtifactsIncluded: number;
    readonly topRulesIncluded: number;
  };
  readonly nextStep: string;
}

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-propose-config-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function callTool(dir: string): Promise<ProposeConfigResponse> {
  const session = new McpSession();
  const result = await proposeConfigTool.handler({ cwd: dir }, session);
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0]?.text ?? "") as ProposeConfigResponse;
}

describe("propose_config: clean scan → minimal config", () => {
  // Guards the zero-findings-zero-wrappers case: the proposal must be
  // a syntactically complete `defineConfig({})` with a comment
  // naming why it's empty, NOT an empty string. Per CLAUDE.md §1
  // "Zero-output success is ambiguous failure" — an empty
  // `suggestedConfig` would read as "tool never ran" to an agent.
  it("emits defineConfig({}) with a clean-scan comment when nothing fires", async () => {
    await withScratch(async (dir) => {
      // A file that produces no findings — a proper <html> with lang,
      // title, and a labeled image. Using a minimal but compliant page
      // so no rule trips.
      await writeFile(
        join(dir, "index.html"),
        '<!DOCTYPE html><html lang="en"><head><title>Hello</title></head><body><p>content</p></body></html>\n',
      );
      const body = await callTool(dir);
      expect(body.suggestedConfig).toContain('import { defineConfig } from "@ra11y/core";');
      expect(body.suggestedConfig).toContain("No overrides needed — scan was clean.");
      expect(body.suggestedConfig).toContain("export default defineConfig({});");
      expect(body.suggestedConfig).not.toContain("nativeWrappers");
      expect(body.suggestedConfig).not.toContain("exclude");
      expect(body.suggestedConfig).not.toContain("rules:");
      expect(body.meta.wrappersIncluded).toBe(0);
      expect(body.meta.buildArtifactsIncluded).toBe(0);
      expect(body.meta.topRulesIncluded).toBe(0);
      expect(body.nextStep).toContain("clean");
      // Trailing newline — paste-ready file content, not a fragment.
      expect(body.suggestedConfig.endsWith("\n")).toBe(true);
    });
  });
});

describe("propose_config: wrappers only", () => {
  // A Button.tsx whose JSX root is a native <button> — the one-hop
  // probe confirms it — and call sites elsewhere. No build artifacts,
  // and the call sites are suppressed by the wrapper so no findings
  // fire either. Proposal carries ONLY the nativeWrappers field.
  it("emits nativeWrappers with only confirmed auto-detected components", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "Button.tsx"),
        "export function Button(props: { onClick: () => void; children: unknown }) {\n" +
          "  return <button onClick={props.onClick}>{props.children}</button>;\n" +
          "}\n",
      );
      await writeFile(
        join(dir, "App.tsx"),
        "import { Button } from './Button';\n" +
          "export const App = () => <Button onClick={() => {}}>hi</Button>;\n",
      );
      const body = await callTool(dir);
      expect(body.meta.wrappersIncluded).toBe(1);
      expect(body.meta.buildArtifactsIncluded).toBe(0);
      expect(body.suggestedConfig).toContain("nativeWrappers: [");
      expect(body.suggestedConfig).toContain('"Button"');
      expect(body.suggestedConfig).not.toContain("exclude:");
      // Shape invariant: array form (all names, no mappings), matching
      // the shared buildNativeWrappersBody output.
      expect(body.suggestedConfig).toMatch(/nativeWrappers: \[\s+"Button",\s+\],/);
      expect(body.nextStep).toContain("1 confirmed wrapper");
    });
  });
});

describe("propose_config: wrappers + build-artifact excludes", () => {
  // Guards the exclude branch: a compiled-CSS file under dist/ is
  // labeled by `collectBuildArtifacts` and surfaces in the proposed
  // `exclude` array. Paths appear verbatim (no normalization) so the
  // agent pasting the config gets the same string the scanner
  // produced.
  it("emits exclude entries for every labeled build artifact", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "Button.tsx"),
        "export function Button(props: { onClick: () => void; children: unknown }) {\n" +
          "  return <button onClick={props.onClick}>{props.children}</button>;\n" +
          "}\n",
      );
      // Canonical Tailwind-JIT escape-bracket selector in a non-dist
      // path — `dist/` is in the default-excluded discovery set so a
      // file there never reaches the labeler. The escaped-selector
      // signal is the deterministic "this came from Tailwind's
      // compiler" probe; agents onboarding Tailwind projects keep the
      // compiled CSS somewhere the scanner CAN read (e.g.
      // `public/` or `static/`), then add it to `exclude` via this
      // proposal.
      await writeFile(
        join(dir, "compiled.css"),
        ".w-\\[400px\\] { width: 400px; }\n.h-\\[2rem\\] { height: 2rem; }\n",
      );
      const body = await callTool(dir);
      expect(body.meta.buildArtifactsIncluded).toBeGreaterThanOrEqual(1);
      expect(body.suggestedConfig).toContain("exclude: [");
      expect(body.suggestedConfig).toContain("compiled.css");
      expect(body.nextStep).toContain("build-artifact path");
    });
  });
});

describe("propose_config: wrappers + findings → commented rules stub", () => {
  // Guards the commented-out rules stub: a file that fires several
  // rules must produce the top-3 block, commented out (so paste does
  // not change behavior), with each entry carrying its default
  // severity. Per CLAUDE.md §1 "Surface, don't suppress" — we don't
  // ship auto-downgrades; we ship a paste-ready tuning point.
  it("commented rules stub lists the top-3 most-fired rules with default severity", async () => {
    await withScratch(async (dir) => {
      // A page that deliberately trips multiple rules:
      //   - html-has-lang: <html> without lang
      //   - page-titled: no <title>
      //   - alt-text-missing: multiple <img> without alt
      await writeFile(
        join(dir, "a.html"),
        "<!DOCTYPE html><html><head></head><body>" +
          '<img src="/a.png"><img src="/b.png"><img src="/c.png">' +
          "</body></html>\n",
      );
      const body = await callTool(dir);
      expect(body.meta.topRulesIncluded).toBeGreaterThan(0);
      expect(body.meta.topRulesIncluded).toBeLessThanOrEqual(3);
      // Commented block preamble + closing brace must both land.
      expect(body.suggestedConfig).toContain("// rules: {");
      expect(body.suggestedConfig).toContain("// },");
      // Top-fired rule (alt-text-missing — 3 findings, beats the
      // single-firing title/lang rules) must appear with its default
      // severity and a findings comment.
      expect(body.suggestedConfig).toContain("// ");
      expect(body.suggestedConfig).toMatch(
        /"media\/alt-text-missing":\s*"error",\s*\/\/ 3 findings/,
      );
      // Tuning-guidance comment — paste-ready hint, not prose
      // masquerading as code.
      expect(body.suggestedConfig).toContain("Uncomment + adjust the severity");
      // Every line inside the stub block must be commented so pasting
      // the proposal into ra11y.config.ts does NOT silently change
      // scanner behavior.
      const lines = body.suggestedConfig.split("\n");
      const start = lines.findIndex((l) => l.includes("// rules: {"));
      const end = lines.findIndex((l, i) => i > start && l.includes("// },"));
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      for (let i = start; i <= end; i += 1) {
        const line = lines[i] ?? "";
        // Allow blank lines; non-blank lines inside the block must be
        // commented.
        if (line.trim().length === 0) continue;
        expect(line.trimStart().startsWith("//")).toBe(true);
      }
    });
  });

  // Guards the tie-break contract: when two rules fire the same
  // number of times, they're ordered by rule ID ascending. Deterministic
  // output is load-bearing for review workflows that diff proposals.
  it("breaks ties between equally-fired rules by rule ID ascending", async () => {
    await withScratch(async (dir) => {
      // Two pages, each firing one rule exactly once: one missing the
      // lang attribute (`document/lang-attribute`), one missing a
      // title (`document/page-titled`). Both tally to 1, so the tie-
      // break rule — rule ID ascending — orders
      // `document/lang-attribute` before `document/page-titled`.
      await writeFile(
        join(dir, "a.html"),
        '<!DOCTYPE html><html lang="en"><head></head><body><p>no title</p></body></html>\n',
      );
      await writeFile(
        join(dir, "b.html"),
        "<!DOCTYPE html><html><head><title>x</title></head><body><p>no lang</p></body></html>\n",
      );
      const body = await callTool(dir);
      const langIdx = body.suggestedConfig.indexOf('"document/lang-attribute"');
      const titleIdx = body.suggestedConfig.indexOf('"document/page-titled"');
      // Both rules must appear — a vacuous pass (either index -1)
      // would silently accept a regression that dropped one of them.
      expect(langIdx).toBeGreaterThan(-1);
      expect(titleIdx).toBeGreaterThan(-1);
      // `document/lang-attribute` < `document/page-titled` lexically,
      // so it must appear first in the commented stub.
      expect(langIdx).toBeLessThan(titleIdx);
    });
  });
});

describe("propose_config: zero wrappers, zero build artifacts, zero findings", () => {
  // Guards the honest-empty shape in the presence of a real-but-
  // compliant codebase. Distinct from the "clean scan" test at the top
  // in that this case ships a SOURCE file (not just HTML) so the
  // auto-detect scan ran with teeth — parsing happened, rules
  // evaluated, and none of them fired. The proposal is still a
  // minimal defineConfig({}) because nothing warrants an override.
  it("still emits defineConfig({}) with the clean-scan comment on a real-source clean repo", async () => {
    await withScratch(async (dir) => {
      // A tsx module with no JSX at all — parses, contributes to the
      // scan count, produces no findings and no wrapper candidates.
      await writeFile(
        join(dir, "util.ts"),
        "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
      );
      const body = await callTool(dir);
      expect(body.meta.filesScanned).toBeGreaterThan(0);
      expect(body.meta.wrappersIncluded).toBe(0);
      expect(body.meta.buildArtifactsIncluded).toBe(0);
      expect(body.meta.topRulesIncluded).toBe(0);
      expect(body.suggestedConfig).toContain("No overrides needed — scan was clean.");
      expect(body.suggestedConfig).toContain("export default defineConfig({});");
    });
  });
});

describe("propose_config: meta telemetry", () => {
  // Guards the scan-confidence telemetry contract: every response
  // carries scannedRoot, configSource, filesScanned, rulesEvaluated
  // so the agent can cross-check against scan_project without a
  // second round-trip. Per CLAUDE.md §1 "Verbose meta is signal."
  it("populates scannedRoot, filesScanned, and rulesEvaluated on every response", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "index.html"),
        '<!DOCTYPE html><html lang="en"><head><title>t</title></head><body></body></html>\n',
      );
      const body = await callTool(dir);
      expect(body.meta.scannedRoot).toBe(dir);
      expect(body.meta.configSource).toBeNull();
      expect(body.meta.filesScanned).toBe(1);
      expect(body.meta.rulesEvaluated).toBeGreaterThan(0);
    });
  });

  // Guards the cwd existence gate: a nonexistent cwd must hard-error
  // rather than silently return a clean-scan proposal (the zero-
  // output-success-is-ambiguous-failure pattern CLAUDE.md §1 warns
  // against).
  it("hard-errors with code cwd-not-found when cwd does not exist on disk", async () => {
    const session = new McpSession();
    const result = await proposeConfigTool.handler(
      { cwd: "/nonexistent/path/that/does/not/exist-xyz123" },
      session,
    );
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as { code?: string };
    expect(payload.code).toBe("cwd-not-found");
  });
});
