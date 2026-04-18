/**
 * Unit tests for the `list_suppressions` MCP tool (Q2-LISTSUPP).
 *
 * Guards the pragma-enumeration shape promised by the doctool: empty
 * tree surfaces an empty array (not omitted), bare pragmas omit the
 * `reason` field entirely (not `""` or `null`), reasoned pragmas
 * populate it, wildcard pragmas set both ID fields to null with
 * `wildcard: true`, and entries are emitted in deterministic order
 * (file asc, line asc, token asc).
 *
 * Tests drive the handler directly with a scratch filesystem fixture
 * rather than through the MCP protocol — the integration test
 * (`tests/integration/mcp-list-suppressions.test.ts`) covers
 * JSON-RPC end-to-end.
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpSession } from "../../../src/mcp/session.ts";
import { listSuppressionsTool } from "../../../src/mcp/tool-list-suppressions.ts";

interface SuppressionResponse {
  readonly suppressions: readonly {
    readonly file: string;
    readonly line: number;
    readonly ruleId: string | null;
    readonly criterionId: string | null;
    readonly reason?: string;
    readonly wildcard: boolean;
  }[];
  readonly meta: {
    readonly cwd: string;
    readonly configSource: string | null;
    readonly filesScanned: number;
    readonly rulesEvaluated: number;
    readonly activeNativeWrappers?: ReadonlyArray<{
      readonly name: string;
      readonly source: "config" | "autoDetect" | "session";
      readonly confirmed?: boolean;
    }>;
  };
  readonly nextStep: string;
}

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-list-suppressions-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function callTool(dir: string): Promise<SuppressionResponse> {
  const session = new McpSession();
  const result = await listSuppressionsTool.handler({ cwd: dir }, session);
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0]?.text ?? "") as SuppressionResponse;
}

describe("list_suppressions: empty tree", () => {
  // Guards the affirmative-empty contract: an empty array IS the
  // answer when no pragmas exist in the tree, not a sign the tool
  // never ran. Per CLAUDE.md §1 "Surface, don't suppress" — a pragma-
  // free tree is a fact worth surfacing.
  it("returns suppressions: [] when no pragmas exist anywhere", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "index.html"),
        '<html><body><img src="/x.png" alt="ok"></body></html>\n',
      );
      const body = await callTool(dir);
      expect(body.suppressions).toEqual([]);
      expect(body.nextStep).toContain("No ra11y-disable pragmas");
      expect(body.meta.cwd).toBe(dir);
      expect(body.meta.filesScanned).toBe(1);
      expect(body.meta.rulesEvaluated).toBeGreaterThan(0);
    });
  });
});

describe("list_suppressions: bare pragma shape", () => {
  // Guards the field-omission rule: a bare pragma must OMIT `reason`
  // entirely, never emit `reason: ""` or `reason: null`. Per CLAUDE.md
  // §1 "Ambiguous field shapes are dishonest."
  it("omits the reason field when a pragma is bare", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "page.html"),
        "<!-- ra11y-disable-next-line media/alt-text-missing -->\n" + '<img src="/hero.jpg">\n',
      );
      const body = await callTool(dir);
      expect(body.suppressions.length).toBe(1);
      const entry = body.suppressions[0];
      if (!entry) throw new Error("missing entry");
      // `reason` must be absent from the JSON shape, not `undefined` /
      // `null` / `""`. Using `in` rather than `entry.reason === undefined`
      // because JSON.parse preserves key presence.
      expect("reason" in entry).toBe(false);
      expect(entry.ruleId).toBe("media/alt-text-missing");
      expect(entry.criterionId).toBeNull();
      expect(entry.wildcard).toBe(false);
      expect(entry.line).toBe(1);
      expect(entry.file).toBe(join(dir, "page.html"));
      // nextStep must call out the bare pragma for follow-up.
      expect(body.nextStep).toContain("missing a reason");
      expect(body.nextStep).toContain("review_candidates");
    });
  });
});

describe("list_suppressions: reasoned pragma shape", () => {
  // Guards the positive-path: reasons captured after `:` or `--` must
  // populate the `reason` field verbatim. The nextStep must NOT route
  // the agent back to review_candidates when every pragma is audited.
  it("populates reason when the pragma carries one, via colon separator", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "page.html"),
        "<!-- ra11y-disable-next-line media/alt-text-missing: decorative divider -->\n" +
          '<img src="/divider.png">\n',
      );
      const body = await callTool(dir);
      expect(body.suppressions.length).toBe(1);
      expect(body.suppressions[0]?.reason).toBe("decorative divider");
      expect(body.nextStep).toContain("All suppressions have reason");
    });
  });

  // Guards the alternate `--` separator — both shapes are first-class
  // in the pragma grammar; parity matters for audit consistency.
  it("populates reason when the pragma uses the -- separator", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "page.html"),
        "<!-- ra11y-disable-next-line media/alt-text-missing -- legacy asset -->\n" +
          '<img src="/legacy.png">\n',
      );
      const body = await callTool(dir);
      expect(body.suppressions.length).toBe(1);
      expect(body.suppressions[0]?.reason).toBe("legacy asset");
    });
  });
});

describe("list_suppressions: wildcard pragma", () => {
  // Guards the wildcard case: a pragma with no tokens
  // (`<!-- ra11y-disable -->`) must set BOTH `ruleId` and `criterionId`
  // to null and `wildcard: true`. An agent filtering by ID should be
  // able to branch on `wildcard` without grepping the reason text.
  it("emits one entry with both ID fields null and wildcard: true", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "page.html"),
        "<!-- ra11y-disable-next-line -->\n" + '<img src="/x.png">\n',
      );
      const body = await callTool(dir);
      expect(body.suppressions.length).toBe(1);
      const entry = body.suppressions[0];
      if (!entry) throw new Error("missing entry");
      expect(entry.ruleId).toBeNull();
      expect(entry.criterionId).toBeNull();
      expect(entry.wildcard).toBe(true);
    });
  });
});

describe("list_suppressions: criterion vs rule classification", () => {
  // Guards the ID classifier: a token with `:` (e.g. wcag22:1.4.3) is
  // a criterion ID; a token without is a rule ID. The pragma parser
  // preserves the distinction verbatim so audit consumers can branch
  // on either field independently.
  it("routes criterion-ID tokens into criterionId and rule tokens into ruleId", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "page.html"),
        "<!-- ra11y-disable-next-line wcag22:1.4.3 -->\n" + '<img src="/x.png">\n',
      );
      const body = await callTool(dir);
      expect(body.suppressions.length).toBe(1);
      const entry = body.suppressions[0];
      if (!entry) throw new Error("missing entry");
      expect(entry.criterionId).toBe("wcag22:1.4.3");
      expect(entry.ruleId).toBeNull();
      expect(entry.wildcard).toBe(false);
    });
  });
});

describe("list_suppressions: deterministic ordering", () => {
  // Guards the ordering contract: entries must be emitted file asc,
  // line asc, token asc. An agent paginating or diffing the response
  // needs stable output for the same input.
  it("orders entries file asc, then line asc", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "z-second.html"),
        "<!-- ra11y-disable-next-line keyboard/handler-missing -->\n" +
          '<div onclick="x()">b</div>\n',
      );
      await writeFile(
        join(dir, "a-first.html"),
        "<!-- ra11y-disable-next-line media/alt-text-missing: logo brand mark -->\n" +
          '<img src="/logo.png">\n' +
          "<!-- ra11y-disable-next-line contrast/minimum -->\n" +
          '<p style="color:#ccc">faint</p>\n',
      );
      const body = await callTool(dir);
      expect(body.suppressions.length).toBe(3);
      expect(body.suppressions[0]?.file).toBe(join(dir, "a-first.html"));
      expect(body.suppressions[0]?.line).toBe(1);
      expect(body.suppressions[1]?.file).toBe(join(dir, "a-first.html"));
      expect(body.suppressions[1]?.line).toBe(3);
      expect(body.suppressions[2]?.file).toBe(join(dir, "z-second.html"));
    });
  });
});
