/**
 * Invariants for the `propose_baseline` MCP tool — contracts the tool
 * must uphold across every call shape: precedence, read-only, counts
 * sum, routing, stable IDs, meta-telemetry, error envelope.
 *
 * Split from the per-reason tests to keep each file reviewable.
 */

import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpSession } from "../../../src/mcp/session.ts";
import { proposeBaselineTool } from "../../../src/mcp/tool-propose-baseline.ts";

interface ProposeBaselineResponse {
  readonly proposed: readonly {
    readonly filePath: string;
    readonly ruleId: string;
    readonly findingId: string;
    readonly reason: string;
    readonly rationale: string;
  }[];
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
  const dir = await mkdtemp(join(tmpdir(), "ra11y-propose-baseline-inv-"));
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

describe("propose_baseline: precedence + invariants", () => {
  it("applies legacy-route precedence over design-system-internal", async () => {
    await withScratch(async (dir) => {
      const p = join(dir, "shared", "widget");
      await mkdir(p, { recursive: true });
      await writeFile(
        join(p, "item.html"),
        '<!DOCTYPE html><html><head></head><body><img src="/a.png"></body></html>\n',
      );
      const body = await callTool(dir, {
        legacyRoutes: ["shared/**"],
        designSystemPaths: ["shared/**"],
      });
      expect(body.counts.legacyRoute).toBeGreaterThan(0);
      expect(body.counts.designSystemInternal).toBe(0);
    });
  });

  it("keeps `proposed.length` equal to the sum of per-reason counts", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "a.html"),
        '<!DOCTYPE html><html><head></head><body><img src="/a.png"></body></html>\n',
      );
      await writeFile(
        join(dir, "bundle.min.js"),
        'var x = 1; document.body.innerHTML = "<img>";\n',
      );
      const body = await callTool(dir);
      const sum =
        body.counts.wrapperUndetected +
        body.counts.thirdPartyHtml +
        body.counts.legacyRoute +
        body.counts.designSystemInternal +
        body.counts.unclassified;
      expect(sum).toBe(body.proposed.length);
    });
  });

  it("does NOT write .ra11y-baseline.json or any other file to disk", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "page.html"),
        '<!DOCTYPE html><html><head></head><body><img src="/a.png"></body></html>\n',
      );
      await callTool(dir);
      expect(existsSync(join(dir, ".ra11y-baseline.json"))).toBe(false);
    });
  });

  it("routes to `baseline` with mode: create via nextStepStructured", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "page.html"),
        '<!DOCTYPE html><html><head></head><body><img src="/a.png"></body></html>\n',
      );
      const body = await callTool(dir);
      expect(body.nextStepStructured.tool).toBe("baseline");
      expect(body.nextStepStructured.args.mode).toBe("create");
    });
  });

  it("populates a non-empty findingId on every proposed entry", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "page.html"),
        '<!DOCTYPE html><html><head></head><body><img src="/a.png"></body></html>\n',
      );
      const body = await callTool(dir);
      expect(body.proposed.length).toBeGreaterThan(0);
      for (const entry of body.proposed) {
        expect(typeof entry.findingId).toBe("string");
        expect(entry.findingId.length).toBeGreaterThan(0);
      }
    });
  });

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

  it("hard-errors with code cwd-not-found when cwd does not exist on disk", async () => {
    const session = new McpSession();
    const result = await proposeBaselineTool.handler(
      { cwd: "/nonexistent/path/that/does/not/exist-xyz123" },
      session,
    );
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as { code?: string };
    expect(payload.code).toBe("cwd-not-found");
  });
});
