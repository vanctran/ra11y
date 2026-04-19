/**
 * Edge-case unit tests for the `apply_fix` MCP tool — shape
 * validation the core test file deliberately split off so the main
 * file stayed under the reviewable-size cap.
 *
 * Covers: path-escape guards (relative + absolute forms), malformed
 * `edit` object, unsupported extensions, missing files, missing
 * `file` param, and the CSS / TSX extension branches of the
 * per-extension parser switch. `level: "AAA"` exercises the
 * sessionLevel override branch of `resolveLevelParam`.
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
  readonly meta: {
    readonly relativeFilePath: string;
    readonly parseErrorsBefore: number;
    readonly parseErrorsAfter: number;
  };
}

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-apply-fix-edges-"));
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

describe("apply_fix: missing file param", () => {
  it("rejects `missing-required-param` when neither `file` nor `filePath` is supplied", async () => {
    await withScratch(async (dir) => {
      const { isError, code } = await call(allowWriteSession(), {
        edit: { oldText: "x", newText: "y" },
        cwd: dir,
      });
      expect(isError).toBe(true);
      expect(code).toBe("missing-required-param");
    });
  });

  it("rejects `missing-required-param` when `file` is an empty string", async () => {
    await withScratch(async (dir) => {
      const { isError, code } = await call(allowWriteSession(), {
        file: "",
        edit: { oldText: "x", newText: "y" },
        cwd: dir,
      });
      expect(isError).toBe(true);
      expect(code).toBe("missing-required-param");
    });
  });
});

describe("apply_fix: path-escape guard", () => {
  it("rejects `path-escapes-cwd` when a relative path climbs above cwd via `..`", async () => {
    await withScratch(async (dir) => {
      const { isError, code, body } = await call(allowWriteSession(), {
        file: "../../../etc/hosts",
        edit: { oldText: "localhost", newText: "evil.example.com" },
        cwd: dir,
      });
      expect(isError).toBe(true);
      expect(code).toBe("path-escapes-cwd");
      expect((body as ErrorBody).error).toMatch(/escapes cwd/i);
    });
  });

  it("rejects absolute paths outside cwd with `path-escapes-cwd`", async () => {
    await withScratch(async (dir) => {
      const outside = await mkdtemp(join(tmpdir(), "ra11y-apply-fix-outside-"));
      try {
        const file = join(outside, "x.html");
        await writeFile(file, "<p>x</p>");
        const { isError, code } = await call(allowWriteSession(), {
          file,
          edit: { oldText: "x", newText: "y" },
          cwd: dir,
        });
        expect(isError).toBe(true);
        expect(code).toBe("path-escapes-cwd");
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });
});

describe("apply_fix: edit-shape validation", () => {
  it("rejects `edit-shape-invalid` when `edit` is missing", async () => {
    await withScratch(async (dir) => {
      const file = join(dir, "a.html");
      await writeFile(file, "<p>x</p>");
      const { isError, code } = await call(allowWriteSession(), { file, cwd: dir });
      expect(isError).toBe(true);
      expect(code).toBe("edit-shape-invalid");
    });
  });

  it("rejects `edit-shape-invalid` when `oldText` is empty", async () => {
    await withScratch(async (dir) => {
      const file = join(dir, "a.html");
      await writeFile(file, "<p>x</p>");
      const { isError, code } = await call(allowWriteSession(), {
        file,
        edit: { oldText: "", newText: "whatever" },
        cwd: dir,
      });
      expect(isError).toBe(true);
      expect(code).toBe("edit-shape-invalid");
    });
  });

  it("rejects `edit-shape-invalid` when `newText` is not a string", async () => {
    await withScratch(async (dir) => {
      const file = join(dir, "a.html");
      await writeFile(file, "<p>x</p>");
      const { isError, code } = await call(allowWriteSession(), {
        file,
        edit: { oldText: "<p", newText: 42 },
        cwd: dir,
      });
      expect(isError).toBe(true);
      expect(code).toBe("edit-shape-invalid");
    });
  });
});

describe("apply_fix: file existence + extension", () => {
  it("rejects unsupported extensions with `file-unsupported`", async () => {
    await withScratch(async (dir) => {
      const file = join(dir, "data.json");
      await writeFile(file, "{}");
      const { isError, code } = await call(allowWriteSession(), {
        file,
        edit: { oldText: "{", newText: "{ " },
        cwd: dir,
      });
      expect(isError).toBe(true);
      expect(code).toBe("file-unsupported");
    });
  });

  it("rejects a missing file with `file-read-failed`", async () => {
    await withScratch(async (dir) => {
      const ghost = join(dir, "does-not-exist.html");
      const { isError, code } = await call(allowWriteSession(), {
        file: ghost,
        edit: { oldText: "x", newText: "y" },
        cwd: dir,
      });
      expect(isError).toBe(true);
      expect(code).toBe("file-read-failed");
    });
  });
});

describe("apply_fix: per-extension parse branches", () => {
  it("applies a CSS edit through the CSS parser branch", async () => {
    await withScratch(async (dir) => {
      const file = join(dir, "styles.css");
      await writeFile(file, ".x { color: red; }\n");
      const { isError, body } = await call(allowWriteSession(), {
        file,
        edit: { oldText: "color: red;", newText: "color: blue;" },
        cwd: dir,
        dryRun: false,
      });
      expect(isError).toBe(false);
      expect((body as SuccessBody).applied).toBe(true);
      expect((await readFile(file, "utf8")).includes("color: blue")).toBe(true);
    });
  });

  it("applies a TSX edit through the tsx parser branch without introducing parse errors", async () => {
    await withScratch(async (dir) => {
      const file = join(dir, "App.tsx");
      await writeFile(file, 'export const App = () => <button aria-label="hi">click</button>;\n');
      const { isError, body } = await call(allowWriteSession(), {
        file,
        edit: { oldText: 'aria-label="hi"', newText: 'aria-label="greet"' },
        cwd: dir,
        dryRun: false,
      });
      expect(isError).toBe(false);
      const success = body as SuccessBody;
      expect(success.applied).toBe(true);
      expect(success.meta.parseErrorsAfter).toBe(0);
    });
  });
});

describe("apply_fix: explicit level override", () => {
  it("accepts an explicit `level` override (AAA) and runs the scan on that level", async () => {
    await withScratch(async (dir) => {
      const file = join(dir, "page.html");
      await writeFile(file, '<html><body><img src="/logo.png"></body></html>\n');
      const { isError, body } = await call(allowWriteSession(), {
        file,
        edit: { oldText: '<img src="/logo.png">', newText: '<img src="/logo.png" alt="A">' },
        cwd: dir,
        level: "AAA",
        dryRun: true,
      });
      expect(isError).toBe(false);
      expect((body as SuccessBody).dryRun).toBe(true);
    });
  });
});
