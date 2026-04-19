/**
 * Unit tests for the `bootstrap` MCP meta-tool.
 *
 * Covers:
 *   - Happy path: composition surfaces wrappers, proposedConfig, scan
 *     subset, ciSnippet, and nextStep on a real fixture tree with
 *     writeBaseline defaulting to false (no file written).
 *   - writeBaseline opt-in: `.ra11y-baseline.json` lands on disk at
 *     the scan root; the response's `baseline` field reports the
 *     path + entriesWritten.
 *   - Partial failure: when a sub-handler rejects (monkey-patched),
 *     the tool still returns the other legs and emits a
 *     `bootstrap_<leg>_failed` warning code.
 *   - Empty project: zero parseable files propagate the scan's
 *     `scanned_zero_files` warning through the bootstrap response.
 *   - cwd-not-found hard-errors before any sub-handler runs.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpSession } from "../../../src/mcp/session.ts";
import { bootstrapTool } from "../../../src/mcp/tool-bootstrap.ts";
import { detectNativeWrappersTool } from "../../../src/mcp/tool-detect-wrappers.ts";

interface BootstrapResponse {
  readonly wrappers: { readonly candidates: readonly unknown[] };
  readonly proposedConfig?: string;
  readonly scan: {
    readonly filesScanned: number;
    readonly totalFindings: number;
    readonly scanMode?: string;
  };
  readonly baseline: { readonly written: boolean; readonly path: string } | null;
  readonly ciSnippet: string;
  readonly nextStep: string;
  readonly nextStepStructured: { readonly tool: string; readonly args: Record<string, unknown> };
  readonly meta: { readonly scannedRoot: string; readonly writeBaseline: boolean };
  readonly warnings?: readonly string[];
}

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-bootstrap-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function callBootstrap(
  params: Record<string, unknown>,
): Promise<{ response: BootstrapResponse; isError: boolean | undefined }> {
  const session = new McpSession();
  const result = await bootstrapTool.handler(params, session);
  return {
    isError: result.isError,
    response: JSON.parse(result.content[0]?.text ?? "") as BootstrapResponse,
  };
}

describe("bootstrap: happy path (writeBaseline default false)", () => {
  // Composition invariant: every top-level key the spec promises
  // must land, even on a clean codebase. Dry-run writes nothing — the
  // baseline file must NOT appear on disk when the flag is omitted.
  it("returns wrappers, proposedConfig, scan, baseline:null, ciSnippet on a clean codebase", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "index.html"),
        '<!DOCTYPE html><html lang="en"><head><title>Hello</title></head><body><p>content</p></body></html>\n',
      );
      const { response, isError } = await callBootstrap({ cwd: dir });
      expect(isError).toBeUndefined();
      expect(response.wrappers).toBeTruthy();
      expect(Array.isArray(response.wrappers.candidates)).toBe(true);
      expect(typeof response.proposedConfig).toBe("string");
      expect(response.proposedConfig).toContain('import { defineConfig } from "@ra11y/core";');
      expect(response.scan.filesScanned).toBeGreaterThan(0);
      expect(response.scan.totalFindings).toBe(0);
      expect(response.baseline).toBeNull();
      expect(response.ciSnippet).toContain("ra11y");
      expect(response.ciSnippet).toContain("baseline check");
      expect(response.meta.scannedRoot).toBe(dir);
      expect(response.meta.writeBaseline).toBe(false);
      expect(existsSync(join(dir, ".ra11y-baseline.json"))).toBe(false);
    });
  });

  // The nextStepStructured contract routes agents at the right follow-up
  // call. On a dirty, dry-run response, the hint must point back at
  // bootstrap with writeBaseline: true so the agent can land the
  // grandfathered file without re-deriving the call shape.
  it("suggests rerun with writeBaseline:true when findings exist in dry-run mode", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "a.html"),
        '<!DOCTYPE html><html><head></head><body><img src="/a.png"></body></html>\n',
      );
      const { response } = await callBootstrap({ cwd: dir });
      expect(response.scan.totalFindings).toBeGreaterThan(0);
      expect(response.baseline).toBeNull();
      expect(response.nextStepStructured.tool).toBe("bootstrap");
      expect(response.nextStepStructured.args.writeBaseline).toBe(true);
      expect(response.nextStep).toContain("writeBaseline: true");
    });
  });
});

describe("bootstrap: writeBaseline opt-in", () => {
  // The on-disk artifact is the contract here: `.ra11y-baseline.json`
  // must exist at the scan root after a writeBaseline:true call. The
  // response must report the path + written:true so an agent can
  // commit the file without re-probing disk.
  it("writes .ra11y-baseline.json at the scan root and reports the path", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "a.html"),
        '<!DOCTYPE html><html><head></head><body><img src="/a.png"></body></html>\n',
      );
      const { response, isError } = await callBootstrap({ cwd: dir, writeBaseline: true });
      expect(isError).toBeUndefined();
      expect(response.baseline).not.toBeNull();
      expect(response.baseline?.written).toBe(true);
      expect(response.baseline?.path).toContain(".ra11y-baseline.json");
      expect(existsSync(join(dir, ".ra11y-baseline.json"))).toBe(true);
      expect(response.meta.writeBaseline).toBe(true);
      // After a successful baseline write, the next-step routes to
      // `baseline check` — the canonical verify-in-CI move.
      expect(response.nextStepStructured.tool).toBe("baseline");
      expect(response.nextStepStructured.args.mode).toBe("check");
    });
  });
});

describe("bootstrap: partial failure (sub-handler rejects)", () => {
  // Monkey-patch one sub-handler to throw so we can assert the
  // allSettled contract: the OTHER legs still compose, and the
  // response carries a `bootstrap_<leg>_failed` warning code naming
  // the failed step. Mirrors the audit meta-tool's partial-failure
  // pattern (commit 048dfcc).
  const originalDetect = detectNativeWrappersTool.handler;

  beforeEach(() => {
    (detectNativeWrappersTool as { handler: unknown }).handler = () => {
      throw new Error("forced-detect-failure");
    };
  });

  afterEach(() => {
    (detectNativeWrappersTool as { handler: unknown }).handler = originalDetect;
  });

  it("returns scan + proposedConfig and emits bootstrap_detect_failed warning when detect rejects", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "index.html"),
        '<!DOCTYPE html><html lang="en"><head><title>t</title></head><body></body></html>\n',
      );
      const { response, isError } = await callBootstrap({ cwd: dir });
      expect(isError).toBeUndefined();
      expect(response.wrappers.candidates).toEqual([]);
      expect(typeof response.proposedConfig).toBe("string");
      expect(response.scan.filesScanned).toBeGreaterThan(0);
      expect(response.warnings).toBeDefined();
      expect(response.warnings).toContain("bootstrap_detect_failed");
      expect(response.nextStep).toContain("Degraded legs");
    });
  });
});

describe("bootstrap: empty project edge case", () => {
  // Zero parseable files is the canonical ambiguity-risk CLAUDE.md §1
  // warns against. The scan leg emits `scanned_zero_files`; the
  // bootstrap response must propagate that code verbatim so an agent
  // reading the warnings can't mistake "tool never ran" for "clean
  // codebase."
  it("propagates scanned_zero_files when the scan parses nothing", async () => {
    await withScratch(async (dir) => {
      // Scratch directory with no parseable files — a README alone
      // doesn't match any of the HTML/CSS/JSX/TSX extensions.
      await writeFile(join(dir, "README.md"), "# nothing to scan\n");
      const { response, isError } = await callBootstrap({ cwd: dir });
      expect(isError).toBeUndefined();
      expect(response.scan.filesScanned).toBe(0);
      expect(response.warnings).toBeDefined();
      expect(response.warnings).toContain("scanned_zero_files");
      expect(response.baseline).toBeNull();
      expect(response.nextStep.toLowerCase()).toContain("zero files");
    });
  });
});

describe("bootstrap: cwd-not-found hard-errors", () => {
  // Matches the propose_config + scan_project cwd-not-found envelope
  // — nonexistent cwd must be a structured error, not a silent
  // zero-output success. Same guard the other tools install at entry.
  it("returns structured error with code cwd-not-found when cwd is missing", async () => {
    const session = new McpSession();
    const result = await bootstrapTool.handler(
      { cwd: "/nonexistent/path/that/does/not/exist-xyz789" },
      session,
    );
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0]?.text ?? "{}") as { code?: string };
    expect(body.code).toBe("cwd-not-found");
  });
});

describe("bootstrap: registered on tools/list", () => {
  // Canonical tools/list inventory is the spec contract for agents
  // discovering available MCP tools — a handler that isn't registered
  // is unreachable regardless of implementation. Guards against
  // silently forgetting to wire the new tool.
  it("appears in the MCP_TOOLS export", async () => {
    const { MCP_TOOLS } = await import("../../../src/mcp/tools.ts");
    const names = MCP_TOOLS.map((t) => t.def.name);
    expect(names).toContain("bootstrap");
  });
});
