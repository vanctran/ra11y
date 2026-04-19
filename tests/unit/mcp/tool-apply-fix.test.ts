/**
 * Unit tests for the `apply_fix` MCP tool — core write-gate +
 * happy-path coverage.
 *
 * Drives the handler directly so every guard branch gets line
 * coverage in-process; the existing integration test spawns a
 * subprocess so its coverage doesn't flow back to the instrumented
 * source. Tests hit real files under `os.tmpdir()` so the write path
 * is actually exercised; no `fs` mocks.
 *
 * This file covers the load-bearing invariants (write gate, happy
 * dry-run + write paths, anchor uniqueness, parse-error guardrail,
 * deprecated-alias warning, no-delta nextStep). Shape-validation edge
 * cases (path escape, malformed `edit`, unsupported extensions) live
 * in `tool-apply-fix-edges.test.ts`.
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpSession } from "../../../src/mcp/session.ts";
import { applyFixTool } from "../../../src/mcp/tool-apply-fix.ts";

interface ErrorBody {
  readonly error: string;
  readonly code: string;
  readonly details?: Record<string, unknown>;
}

interface SuccessBody {
  readonly applied: boolean;
  readonly dryRun: boolean;
  readonly file: string;
  readonly filePath: string;
  readonly delta: {
    readonly resolvedViolations: Array<{ ruleId: string }>;
    readonly newViolations: Array<{ ruleId: string }>;
    readonly resolvedCandidates: unknown[];
    readonly newCandidates: unknown[];
  };
  readonly meta: {
    readonly cwd: string;
    readonly relativeFilePath: string;
    readonly standards: readonly string[];
    readonly rulesEvaluated: number;
    readonly parseErrorsBefore: number;
    readonly parseErrorsAfter: number;
  };
  readonly warnings?: readonly string[];
  readonly nextStep: string;
}

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-apply-fix-core-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function allowWriteSession(): McpSession {
  const s = new McpSession();
  s.configure({ allowWrite: true });
  return s;
}

async function call(
  session: McpSession,
  params: Record<string, unknown>,
): Promise<{ isError: boolean; body: SuccessBody | ErrorBody; code: string | undefined }> {
  const result = await applyFixTool.handler(params, session);
  const body = JSON.parse(result.content[0]?.text ?? "") as SuccessBody | ErrorBody;
  const code =
    (result.structuredContent as { code?: string } | undefined)?.code ?? (body as ErrorBody).code;
  return { isError: result.isError === true, body, code };
}

async function writeBadImg(dir: string): Promise<string> {
  const file = join(dir, "page.html");
  await writeFile(file, '<html><body><img src="/logo.png"></body></html>\n');
  return file;
}

describe("apply_fix: write gate", () => {
  it("rejects the call with `allow-write-disabled` when the session flag is off", async () => {
    await withScratch(async (dir) => {
      const file = await writeBadImg(dir);
      const session = new McpSession();
      const { isError, code } = await call(session, {
        file,
        edit: { oldText: '<img src="/logo.png">', newText: '<img src="/logo.png" alt="Acme">' },
        cwd: dir,
      });
      expect(isError).toBe(true);
      expect(code).toBe("allow-write-disabled");
      const after = await readFile(file, "utf8");
      expect(after).toContain('<img src="/logo.png">');
    });
  });
});

describe("apply_fix: deprecated filePath alias", () => {
  it("emits `deprecated_param_filepath` warning when the deprecated `filePath` alias is used", async () => {
    await withScratch(async (dir) => {
      const file = await writeBadImg(dir);
      const { isError, body } = await call(allowWriteSession(), {
        filePath: file,
        edit: { oldText: '<img src="/logo.png">', newText: '<img src="/logo.png" alt="Acme">' },
        cwd: dir,
        dryRun: true,
      });
      expect(isError).toBe(false);
      const success = body as SuccessBody;
      expect(success.warnings).toEqual(["deprecated_param_filepath"]);
      expect(success.file).toBe(file);
    });
  });

  it("omits `warnings` on the canonical `file` param path", async () => {
    await withScratch(async (dir) => {
      const file = await writeBadImg(dir);
      const { body } = await call(allowWriteSession(), {
        file,
        edit: { oldText: '<img src="/logo.png">', newText: '<img src="/logo.png" alt="A">' },
        cwd: dir,
        dryRun: true,
      });
      const success = body as SuccessBody;
      expect(success.warnings).toBeUndefined();
    });
  });

  it("rejects `conflicting-file-params` when both `file` and `filePath` are supplied", async () => {
    await withScratch(async (dir) => {
      const file = await writeBadImg(dir);
      const { isError, code } = await call(allowWriteSession(), {
        file,
        filePath: file,
        edit: { oldText: '<img src="/logo.png">', newText: '<img src="/logo.png" alt="A">' },
        cwd: dir,
      });
      expect(isError).toBe(true);
      expect(code).toBe("conflicting-file-params");
    });
  });
});

describe("apply_fix: anchor uniqueness", () => {
  it("rejects `edit-no-match` when `oldText` is not found in the source", async () => {
    await withScratch(async (dir) => {
      const file = await writeBadImg(dir);
      const { isError, code, body } = await call(allowWriteSession(), {
        file,
        edit: { oldText: "text that absolutely does not exist", newText: "anything" },
        cwd: dir,
      });
      expect(isError).toBe(true);
      expect(code).toBe("edit-no-match");
      expect((body as ErrorBody).details?.["matchCount"]).toBe(0);
    });
  });

  it("rejects `edit-multiple-matches` with the match count when `oldText` appears multiple times", async () => {
    await withScratch(async (dir) => {
      const file = join(dir, "dup.html");
      await writeFile(file, '<html><body><img src="/a.png"><img src="/a.png"></body></html>\n');
      const { isError, code, body } = await call(allowWriteSession(), {
        file,
        edit: { oldText: '<img src="/a.png">', newText: '<img src="/a.png" alt="A">' },
        cwd: dir,
      });
      expect(isError).toBe(true);
      expect(code).toBe("edit-multiple-matches");
      expect((body as ErrorBody).details?.["matchCount"]).toBe(2);
    });
  });
});

describe("apply_fix: parse-error guardrail", () => {
  it("rejects `edit-introduces-parse-errors` when the post-edit source fails to parse, leaving the file untouched", async () => {
    await withScratch(async (dir) => {
      const file = join(dir, "broken.tsx");
      const before = 'const x = <button aria-label="hi">click</button>;\n';
      await writeFile(file, before);
      const { isError, code, body } = await call(allowWriteSession(), {
        file,
        edit: {
          oldText: '<button aria-label="hi">click</button>',
          newText: '<button aria-label="hi">click',
        },
        cwd: dir,
        dryRun: false,
      });
      expect(isError).toBe(true);
      expect(code).toBe("edit-introduces-parse-errors");
      expect((body as ErrorBody).details?.["firstNewError"]).toBeTruthy();
      const after = await readFile(file, "utf8");
      expect(after).toBe(before);
    });
  });
});

describe("apply_fix: dryRun happy path", () => {
  it("computes the delta without touching disk when dryRun defaults to true", async () => {
    await withScratch(async (dir) => {
      const file = await writeBadImg(dir);
      const before = await readFile(file, "utf8");
      const { isError, body } = await call(allowWriteSession(), {
        file,
        edit: { oldText: '<img src="/logo.png">', newText: '<img src="/logo.png" alt="Acme">' },
        cwd: dir,
      });
      expect(isError).toBe(false);
      const success = body as SuccessBody;
      expect(success.applied).toBe(false);
      expect(success.dryRun).toBe(true);
      expect(success.delta.resolvedViolations.length).toBeGreaterThan(0);
      const after = await readFile(file, "utf8");
      expect(after).toBe(before);
    });
  });

  it("nextStep describes the dry-run outcome when violations would resolve", async () => {
    await withScratch(async (dir) => {
      const file = await writeBadImg(dir);
      const { body } = await call(allowWriteSession(), {
        file,
        edit: { oldText: '<img src="/logo.png">', newText: '<img src="/logo.png" alt="Acme">' },
        cwd: dir,
        dryRun: true,
      });
      const success = body as SuccessBody;
      expect(success.nextStep).toMatch(/dry run/i);
      expect(success.nextStep).toMatch(/would resolve/i);
    });
  });
});

describe("apply_fix: write-and-rescan happy path", () => {
  it("writes the edit to disk and reports `applied: true` with resolved violations when dryRun is false", async () => {
    await withScratch(async (dir) => {
      const file = await writeBadImg(dir);
      const { isError, body } = await call(allowWriteSession(), {
        file,
        edit: { oldText: '<img src="/logo.png">', newText: '<img src="/logo.png" alt="Acme">' },
        cwd: dir,
        dryRun: false,
      });
      expect(isError).toBe(false);
      const success = body as SuccessBody;
      expect(success.applied).toBe(true);
      expect(success.dryRun).toBe(false);
      expect(success.delta.resolvedViolations.length).toBeGreaterThan(0);
      const onDisk = await readFile(file, "utf8");
      expect(onDisk).toContain('alt="Acme"');
    });
  });

  it("nextStep describes the write outcome when violations resolve", async () => {
    await withScratch(async (dir) => {
      const file = await writeBadImg(dir);
      const { body } = await call(allowWriteSession(), {
        file,
        edit: { oldText: '<img src="/logo.png">', newText: '<img src="/logo.png" alt="Acme">' },
        cwd: dir,
        dryRun: false,
      });
      const success = body as SuccessBody;
      expect(success.nextStep).toMatch(/Edit written/i);
      expect(success.nextStep).toMatch(/resolved/i);
    });
  });

  it("surfaces `newViolations` when the edit regresses a clean file", async () => {
    await withScratch(async (dir) => {
      const file = join(dir, "clean.html");
      const original = "<html><body><p>hello</p></body></html>\n";
      await writeFile(file, original);
      const { body } = await call(allowWriteSession(), {
        file,
        edit: { oldText: "<p>hello</p>", newText: '<p>hello</p><img src="/x.png">' },
        cwd: dir,
        dryRun: true,
      });
      const success = body as SuccessBody;
      expect(success.delta.resolvedViolations).toEqual([]);
      expect(success.delta.newViolations.length).toBeGreaterThan(0);
      expect(success.nextStep).toMatch(/new violation/i);
    });
  });
});

describe("apply_fix: meta + no-delta nextStep", () => {
  it("populates `meta.relativeFilePath`, standards, and parse-error counts", async () => {
    await withScratch(async (dir) => {
      const file = await writeBadImg(dir);
      const { body } = await call(allowWriteSession(), {
        file,
        edit: { oldText: '<img src="/logo.png">', newText: '<img src="/logo.png" alt="Acme">' },
        cwd: dir,
        dryRun: true,
      });
      const success = body as SuccessBody;
      expect(success.meta.relativeFilePath).toBe("page.html");
      expect(success.meta.standards.length).toBeGreaterThan(0);
      expect(success.meta.rulesEvaluated).toBeGreaterThan(0);
      expect(success.meta.parseErrorsBefore).toBe(0);
      expect(success.meta.parseErrorsAfter).toBe(0);
    });
  });

  it("nextStep reports no-delta outcome when the edit doesn't resolve any rule-level finding", async () => {
    await withScratch(async (dir) => {
      const file = join(dir, "neutral.html");
      await writeFile(file, "<html><body><p>hello</p></body></html>\n");
      const { body } = await call(allowWriteSession(), {
        file,
        edit: { oldText: "hello", newText: "world" },
        cwd: dir,
        dryRun: true,
      });
      const success = body as SuccessBody;
      expect(success.delta.resolvedViolations).toEqual([]);
      expect(success.delta.newViolations).toEqual([]);
      expect(success.nextStep).toMatch(/no violation delta/i);
    });
  });
});
