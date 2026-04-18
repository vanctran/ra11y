/**
 * Unit tests for the `conformance_statement` MCP tool.
 *
 * End-to-end against a real scratch project: write a fixture file,
 * optionally seed `.ra11y/attestations.jsonl`, then call the tool
 * and inspect the `blockers[]` plus the rendered Markdown.
 */

import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpSession } from "../../../src/mcp/session.ts";
import { conformanceStatementTool } from "../../../src/mcp/tool-conformance-statement.ts";

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-conform-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function call(
  session: McpSession,
  params: Record<string, unknown>,
): Promise<{ readonly isError: boolean; readonly body: Record<string, unknown> }> {
  const result = await conformanceStatementTool.handler(params, session);
  const body = JSON.parse(result.content[0]?.text ?? "");
  return { isError: result.isError === true, body };
}

async function seedAttestations(cwd: string, records: readonly Record<string, unknown>[]) {
  await mkdir(join(cwd, ".ra11y"), { recursive: true });
  await writeFile(
    join(cwd, ".ra11y", "attestations.jsonl"),
    `${records.map((r) => JSON.stringify(r)).join("\n")}\n`,
    "utf8",
  );
}

describe("conformance_statement: refusal path", () => {
  it("emits conformant: false with blockers when evidence is missing", async () => {
    await withScratch(async (cwd) => {
      // Minimal scan target — a single TSX file with no obvious
      // violations. The statement should still refuse because
      // automatable criteria have no non-candidate sources.
      await writeFile(join(cwd, "app.tsx"), "export const App = () => null;\n");
      const session = new McpSession();
      const { isError, body } = await call(session, {
        standard: "wcag22",
        level: "AA",
        cwd,
      });
      expect(isError).toBe(false);
      expect(body["conformant"]).toBe(false);
      expect(Array.isArray(body["blockers"])).toBe(true);
      expect((body["blockers"] as unknown[]).length).toBeGreaterThan(0);
      expect(typeof body["markdown"]).toBe("string");
      expect(body["markdown"]).toContain("NOT CONFORMANT");
    });
  });
});

describe("conformance_statement: profile validation", () => {
  it("accepts level=base", async () => {
    await withScratch(async (cwd) => {
      await writeFile(join(cwd, "app.tsx"), "export const App = () => null;\n");
      const session = new McpSession();
      const { isError, body } = await call(session, {
        standard: "wcag22",
        level: "base",
        cwd,
      });
      expect(isError).toBe(false);
      expect((body["profile"] as Record<string, unknown>)["level"]).toBe("base");
    });
  });

  it("rejects an unknown standard with standard-not-found", async () => {
    await withScratch(async (cwd) => {
      const session = new McpSession();
      const { isError, body } = await call(session, {
        standard: "nonexistent",
        cwd,
      });
      expect(isError).toBe(true);
      expect(body["code"]).toBe("standard-not-found");
    });
  });
});

describe("conformance_statement: durable attestations clear blockers", () => {
  it("picks up attestations from .ra11y/attestations.jsonl", async () => {
    await withScratch(async (cwd) => {
      // Seed an attestation for one AA criterion so it clears that
      // specific blocker. Other criteria remain blockers but the
      // count goes down.
      await writeFile(join(cwd, "app.tsx"), "export const App = () => null;\n");
      await seedAttestations(cwd, [
        {
          criterionId: "wcag22:2.4.7",
          by: "test",
          reason: "keyboard focus verified manually on 2026-04-18",
          attestedAt: "2026-04-18T00:00:00.000Z",
        },
      ]);
      const session = new McpSession();
      const { isError, body } = await call(session, {
        standard: "wcag22",
        level: "AA",
        cwd,
      });
      expect(isError).toBe(false);
      const blockerIds = (body["blockers"] as { criterionId: string }[]).map((b) => b.criterionId);
      expect(blockerIds).not.toContain("wcag22:2.4.7");
    });
  });
});
