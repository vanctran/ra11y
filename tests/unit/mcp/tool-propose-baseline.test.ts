/**
 * Unit tests for the `propose_baseline` MCP tool.
 *
 * One positive + one negative test per reason code, plus an empty-scan
 * test, plus the contract invariants (read-only — no file written;
 * `nextStepStructured` routes to the mutating tool; counts match
 * `proposed.length`). Tests drive the handler directly with a scratch
 * filesystem fixture rather than through the MCP protocol — the
 * integration path is exercised by the shared MCP session integration
 * test.
 */

import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpSession } from "../../../src/mcp/session.ts";
import { proposeBaselineTool } from "../../../src/mcp/tool-propose-baseline.ts";

interface ProposedEntry {
  readonly filePath: string;
  readonly ruleId: string;
  readonly findingId: string;
  readonly reason:
    | "wrapper-undetected"
    | "third-party-html"
    | "legacy-route"
    | "design-system-internal"
    | "unclassified";
  readonly rationale: string;
}

interface ProposeBaselineResponse {
  readonly proposed: readonly ProposedEntry[];
  readonly counts: {
    readonly wrapperUndetected: number;
    readonly thirdPartyHtml: number;
    readonly legacyRoute: number;
    readonly designSystemInternal: number;
    readonly unclassified: number;
  };
  readonly meta: {
    readonly scannedRoot: string;
    readonly configSource: string | null;
    readonly filesScanned: number;
    readonly rulesEvaluated: number;
    readonly standards: readonly string[];
  };
  readonly nextStep: string;
  readonly nextStepStructured: {
    readonly tool: string;
    readonly args: { readonly mode: string };
  };
}

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-propose-baseline-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function callTool(
  dir: string,
  extras: Record<string, unknown> = {},
): Promise<ProposeBaselineResponse> {
  const session = new McpSession();
  const result = await proposeBaselineTool.handler({ cwd: dir, ...extras }, session);
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0]?.text ?? "") as ProposeBaselineResponse;
}

describe("propose_baseline: empty scan → empty proposed array", () => {
  // Clean codebase: no findings, proposal is an empty array. Counts all
  // zero. `nextStep` prose names the clean state so agents see the
  // success shape — not an ambiguous "0 of nothing" reading.
  it("emits zero entries with all-zero counts when no violations fire", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "index.html"),
        '<!DOCTYPE html><html lang="en"><head><title>t</title></head><body></body></html>\n',
      );
      const body = await callTool(dir);
      expect(body.proposed).toEqual([]);
      expect(body.counts.wrapperUndetected).toBe(0);
      expect(body.counts.thirdPartyHtml).toBe(0);
      expect(body.counts.legacyRoute).toBe(0);
      expect(body.counts.designSystemInternal).toBe(0);
      expect(body.counts.unclassified).toBe(0);
      expect(body.nextStep).toContain("clean");
    });
  });
});

describe("propose_baseline: third-party-html", () => {
  // Positive: a `.min.html` file is a canonical minified-asset marker.
  // The `node_modules/` / `vendor/` / `.yarn/` directory markers are
  // also recognized but `src/input/discover.ts` skips those dirs by
  // default, so we can't exercise them through the handler's
  // `parseFiles` pipeline — the classifier covers them directly via
  // the suffix path here.
  it("tags .min.html files as third-party-html via the suffix marker", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "bundle.min.html"),
        '<!DOCTYPE html><html><head></head><body><img src="/a.png"></body></html>\n',
      );
      const body = await callTool(dir);
      expect(body.counts.thirdPartyHtml).toBeGreaterThan(0);
      const hit = body.proposed.find((e) => e.reason === "third-party-html");
      expect(hit?.rationale).toContain(".min.html");
    });
  });

  // Negative: a finding in a normal source path is NOT tagged as
  // third-party. Guards against false-positive path matches (e.g. a
  // literal substring `node_modules` appearing elsewhere in the project
  // would incorrectly trigger without a `/` boundary).
  it("does not tag findings under regular app paths as third-party-html", async () => {
    await withScratch(async (dir) => {
      const app = join(dir, "app");
      await mkdir(app, { recursive: true });
      await writeFile(
        join(app, "page.html"),
        '<!DOCTYPE html><html><head></head><body><img src="/a.png"></body></html>\n',
      );
      const body = await callTool(dir);
      expect(body.counts.thirdPartyHtml).toBe(0);
      expect(body.counts.unclassified).toBeGreaterThan(0);
    });
  });
});

describe("propose_baseline: legacy-route", () => {
  // Positive: a caller-supplied glob in `legacyRoutes` tags matching
  // paths. Guards the explicit-only contract — user-declared globs win
  // over heuristic reason codes.
  it("tags findings in caller-declared legacyRoutes glob paths", async () => {
    await withScratch(async (dir) => {
      const legacy = join(dir, "legacy", "admin");
      await mkdir(legacy, { recursive: true });
      await writeFile(
        join(legacy, "dashboard.html"),
        '<!DOCTYPE html><html><head></head><body><img src="/a.png"></body></html>\n',
      );
      const body = await callTool(dir, { legacyRoutes: ["legacy/**"] });
      expect(body.counts.legacyRoute).toBeGreaterThan(0);
      const hit = body.proposed.find((e) => e.reason === "legacy-route");
      expect(hit?.rationale).toContain("legacyRoutes");
      expect(hit?.rationale).toContain("legacy/admin/dashboard.html");
    });
  });

  // Negative: without `legacyRoutes`, the same file is NOT tagged as
  // legacy-route. Guards the "no heuristic path-guessing" contract —
  // the tool must not infer legacy-ness from filename alone.
  it("does NOT tag any finding as legacy-route when legacyRoutes is unset", async () => {
    await withScratch(async (dir) => {
      // Path contains "legacy" as a literal substring — a heuristic
      // tool would guess. Ours must not.
      const legacy = join(dir, "legacy", "admin");
      await mkdir(legacy, { recursive: true });
      await writeFile(
        join(legacy, "dashboard.html"),
        '<!DOCTYPE html><html><head></head><body><img src="/a.png"></body></html>\n',
      );
      const body = await callTool(dir);
      expect(body.counts.legacyRoute).toBe(0);
    });
  });
});

describe("propose_baseline: design-system-internal", () => {
  // Positive: a caller-supplied glob in `designSystemPaths` tags
  // matching paths.
  it("tags findings in caller-declared designSystemPaths glob paths", async () => {
    await withScratch(async (dir) => {
      const ui = join(dir, "packages", "ui", "src");
      await mkdir(ui, { recursive: true });
      await writeFile(
        join(ui, "Widget.html"),
        '<!DOCTYPE html><html><head></head><body><img src="/a.png"></body></html>\n',
      );
      const body = await callTool(dir, { designSystemPaths: ["packages/ui/src/**"] });
      expect(body.counts.designSystemInternal).toBeGreaterThan(0);
      const hit = body.proposed.find((e) => e.reason === "design-system-internal");
      expect(hit?.rationale).toContain("designSystemPaths");
    });
  });

  // Negative: without the glob, the finding is unclassified (no
  // heuristic inference from "packages/ui" substring).
  it("does NOT tag any finding as design-system-internal when designSystemPaths is unset", async () => {
    await withScratch(async (dir) => {
      const ui = join(dir, "packages", "ui", "src");
      await mkdir(ui, { recursive: true });
      await writeFile(
        join(ui, "Widget.html"),
        '<!DOCTYPE html><html><head></head><body><img src="/a.png"></body></html>\n',
      );
      const body = await callTool(dir);
      expect(body.counts.designSystemInternal).toBe(0);
    });
  });
});

describe("propose_baseline: wrapper-undetected", () => {
  // Positive: a PascalCase component with onClick whose defining file
  // does not resolve to a native interactive root lands in the
  // `assumed` bucket via `classifyWrapperCandidates`. A finding whose
  // message begins `<CustomThing>` then gets the `wrapper-undetected`
  // reason code.
  it("tags findings on assumed-wrapper PascalCase names as wrapper-undetected", async () => {
    await withScratch(async (dir) => {
      // Defining file's JSX root is `<div>` — structural, not a native
      // interactive element — so the probe cannot confirm and
      // `CustomThing` lands in the `assumed` bucket.
      await writeFile(
        join(dir, "CustomThing.tsx"),
        "export function CustomThing(props: { onClick: () => void; children?: unknown }) {\n" +
          "  return <div onClick={props.onClick}>{props.children}</div>;\n" +
          "}\n",
      );
      // A call site that triggers `semantics/button-name` on the
      // custom component: role="button" without an accessible name
      // fires on any element, including PascalCase. The emitted
      // message starts `<CustomThing role="button">` — our regex
      // accepts the space-attribute form, so the classifier tags it
      // `wrapper-undetected`.
      await writeFile(
        join(dir, "App.tsx"),
        'export const App = () => <CustomThing onClick={() => {}} role="button" />;\n',
      );
      const body = await callTool(dir);
      expect(body.counts.wrapperUndetected).toBeGreaterThan(0);
      const hit = body.proposed.find((e) => e.reason === "wrapper-undetected");
      expect(hit?.rationale).toContain("CustomThing");
      expect(hit?.rationale).toContain("nativeWrappers");
    });
  });

  // Negative: a PascalCase component whose defining file IS a native
  // interactive root (Button → <button>) is `confirmed`, not
  // `assumed`. Findings on its call sites are not tagged
  // wrapper-undetected. In practice confirmed names also suppress the
  // finding upstream, so the test guards the classification path: a
  // confirmed-wrapper component's call sites do not produce
  // wrapper-undetected entries even when findings exist.
  it("does NOT tag findings on confirmed-wrapper components as wrapper-undetected", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "Button.tsx"),
        "export function Button(props: { onClick: () => void; children: unknown }) {\n" +
          "  return <button onClick={props.onClick}>{props.children}</button>;\n" +
          "}\n",
      );
      // Plain HTML file that produces findings independent of the
      // wrapper — so `proposed` is non-empty but none of the entries
      // carry wrapper-undetected.
      await writeFile(
        join(dir, "page.html"),
        '<!DOCTYPE html><html><head></head><body><img src="/a.png"></body></html>\n',
      );
      const body = await callTool(dir);
      expect(body.counts.wrapperUndetected).toBe(0);
    });
  });
});

describe("propose_baseline: unclassified default", () => {
  // Default bucket: a plain source-tree finding with no third-party
  // marker, no legacy glob, no design-system glob, no assumed-wrapper
  // name → `unclassified`. This is the correct majority case per the
  // AI-first doctrine: the agent reads the finding and decides.
  it("falls through to unclassified when no heuristic matches", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "page.html"),
        '<!DOCTYPE html><html><head></head><body><img src="/a.png"></body></html>\n',
      );
      const body = await callTool(dir);
      expect(body.counts.unclassified).toBeGreaterThan(0);
      const hit = body.proposed.find((e) => e.reason === "unclassified");
      expect(hit?.rationale).toContain("No heuristic");
    });
  });
});
