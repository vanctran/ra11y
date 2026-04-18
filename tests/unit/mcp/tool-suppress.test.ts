/**
 * Unit tests for the `suppress` MCP tool.
 *
 * Happy-path invariants per extension and every structured error
 * envelope the tool can emit. Tests drive the handler directly; the
 * session's `allowWrite` flag is set in-process because spinning up
 * the full JSON-RPC loop for each error branch would bury the intent.
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpSession } from "../../../src/mcp/session.ts";
import { suppressTool } from "../../../src/mcp/tool-suppress.ts";

interface SuccessBody {
  readonly applied: boolean;
  readonly file: string;
  readonly line: number;
  readonly pragma: string;
  readonly commentKind: "jsx" | "line" | "html" | "block";
  readonly meta: {
    readonly cwd: string;
    readonly relativeFilePath: string;
    readonly ruleId: string;
    readonly reason: string;
  };
  readonly nextStep: string;
}

interface ErrorBody {
  readonly error: string;
  readonly code: string;
  readonly details?: Record<string, unknown>;
}

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-suppress-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function allowWriteSession(): McpSession {
  const session = new McpSession();
  session.configure({ allowWrite: true });
  return session;
}

async function call(
  session: McpSession,
  params: Record<string, unknown>,
): Promise<{ readonly isError: boolean; readonly body: SuccessBody | ErrorBody }> {
  const result = await suppressTool.handler(params, session);
  const body = JSON.parse(result.content[0]?.text ?? "");
  return { isError: result.isError === true, body };
}

describe("suppress: TSX inserts JSX-comment pragma with indentation", () => {
  it("writes `{/* ra11y-disable-next-line … */}` above the indented target line", async () => {
    await withScratch(async (dir) => {
      const filePath = join(dir, "Button.tsx");
      const original = [
        "export function Button() {",
        "  return (",
        "    <div onClick={go}>click</div>",
        "  );",
        "}",
        "",
      ].join("\n");
      await writeFile(filePath, original);

      const session = allowWriteSession();
      const { isError, body } = await call(session, {
        file: filePath,
        line: 3,
        ruleId: "keyboard/handler-missing",
        reason: "wrapper provides keyboard handling via onKeyDown",
        cwd: dir,
      });

      expect(isError).toBe(false);
      const success = body as SuccessBody;
      expect(success.commentKind).toBe("jsx");
      expect(success.pragma).toBe(
        "{/* ra11y-disable-next-line keyboard/handler-missing: wrapper provides keyboard handling via onKeyDown */}",
      );
      const updated = await readFile(filePath, "utf8");
      const lines = updated.split("\n");
      expect(lines[2]).toBe(`    ${success.pragma}`);
      expect(lines[3]).toBe("    <div onClick={go}>click</div>");
    });
  });
});

describe("suppress: TS emits line-comment pragma", () => {
  it("writes `// ra11y-disable-next-line …` on its own line", async () => {
    await withScratch(async (dir) => {
      const filePath = join(dir, "helpers.ts");
      await writeFile(filePath, ["const x = 1;", "const y = 2;", ""].join("\n"));

      const session = allowWriteSession();
      const { isError, body } = await call(session, {
        file: filePath,
        line: 2,
        ruleId: "wcag22:2.4.5",
        reason: "helper is internal-only; not navigable surface",
        cwd: dir,
      });

      expect(isError).toBe(false);
      const success = body as SuccessBody;
      expect(success.commentKind).toBe("line");
      expect(success.pragma).toBe(
        "// ra11y-disable-next-line wcag22:2.4.5: helper is internal-only; not navigable surface",
      );
      const updated = await readFile(filePath, "utf8");
      const lines = updated.split("\n");
      expect(lines[1]).toBe(success.pragma);
      expect(lines[2]).toBe("const y = 2;");
    });
  });
});

describe("suppress: HTML emits block-comment pragma", () => {
  it("writes `<!-- ra11y-disable-next-line … -->` above the target tag", async () => {
    await withScratch(async (dir) => {
      const filePath = join(dir, "index.html");
      const original = [
        "<!doctype html>",
        "<html>",
        "  <body>",
        '    <img src="/hero.png">',
        "  </body>",
        "</html>",
        "",
      ].join("\n");
      await writeFile(filePath, original);

      const session = allowWriteSession();
      const { isError, body } = await call(session, {
        file: filePath,
        line: 4,
        ruleId: "media/alt-text-missing",
        reason: "decorative hero image; empty alt intended",
        cwd: dir,
      });

      expect(isError).toBe(false);
      const success = body as SuccessBody;
      expect(success.commentKind).toBe("html");
      expect(success.pragma).toBe(
        "<!-- ra11y-disable-next-line media/alt-text-missing: decorative hero image; empty alt intended -->",
      );
      const updated = await readFile(filePath, "utf8");
      const lines = updated.split("\n");
      expect(lines[3]).toBe(`    ${success.pragma}`);
      expect(lines[4]).toBe('    <img src="/hero.png">');
    });
  });
});

describe("suppress: CSS emits CSS-comment pragma", () => {
  it("writes `/* ra11y-disable-next-line … */` above the target rule", async () => {
    await withScratch(async (dir) => {
      const filePath = join(dir, "style.css");
      await writeFile(
        filePath,
        [".banner {", "  color: #ccc;", "  background: #ddd;", "}", ""].join("\n"),
      );

      const session = allowWriteSession();
      const { isError, body } = await call(session, {
        file: filePath,
        line: 2,
        ruleId: "contrast/minimum",
        reason: "gradient-backed banner; contrast verified against image",
        cwd: dir,
      });

      expect(isError).toBe(false);
      const success = body as SuccessBody;
      expect(success.commentKind).toBe("block");
      expect(success.pragma).toBe(
        "/* ra11y-disable-next-line contrast/minimum: gradient-backed banner; contrast verified against image */",
      );
      const updated = await readFile(filePath, "utf8");
      const lines = updated.split("\n");
      expect(lines[1]).toBe(`  ${success.pragma}`);
      expect(lines[2]).toBe("  color: #ccc;");
    });
  });
});

describe("suppress: allowWrite gate", () => {
  it("rejects with `allow-write-disabled` when the session flag is off, and never touches the file", async () => {
    await withScratch(async (dir) => {
      const filePath = join(dir, "Button.tsx");
      const original = "export const Button = () => <div onClick={go}/>;\n";
      await writeFile(filePath, original);

      const session = new McpSession();
      const { isError, body } = await call(session, {
        file: filePath,
        line: 1,
        ruleId: "keyboard/handler-missing",
        reason: "wrapper is aliased onto a real button downstream",
        cwd: dir,
      });

      expect(isError).toBe(true);
      const err = body as ErrorBody;
      expect(err.code).toBe("allow-write-disabled");
      expect(await readFile(filePath, "utf8")).toBe(original);
    });
  });
});

describe("suppress: required reason", () => {
  it("rejects a missing reason with `reason-required`", async () => {
    await withScratch(async (dir) => {
      const filePath = join(dir, "Button.tsx");
      const original = "export const Button = () => <div onClick={go}/>;\n";
      await writeFile(filePath, original);

      const session = allowWriteSession();
      const { isError, body } = await call(session, {
        file: filePath,
        line: 1,
        ruleId: "keyboard/handler-missing",
        cwd: dir,
      });

      expect(isError).toBe(true);
      const err = body as ErrorBody;
      expect(err.code).toBe("reason-required");
      expect(await readFile(filePath, "utf8")).toBe(original);
    });
  });

  it("rejects a whitespace-only reason with `reason-required` (no silent bare pragma)", async () => {
    await withScratch(async (dir) => {
      const filePath = join(dir, "Button.tsx");
      const original = "export const Button = () => <div onClick={go}/>;\n";
      await writeFile(filePath, original);

      const session = allowWriteSession();
      const { isError, body } = await call(session, {
        file: filePath,
        line: 1,
        ruleId: "keyboard/handler-missing",
        reason: "   ",
        cwd: dir,
      });

      expect(isError).toBe(true);
      const err = body as ErrorBody;
      expect(err.code).toBe("reason-required");
      expect(await readFile(filePath, "utf8")).toBe(original);
    });
  });
});

describe("suppress: file-not-found", () => {
  it("rejects with `file-not-found` when the path does not resolve", async () => {
    await withScratch(async (dir) => {
      const session = allowWriteSession();
      const { isError, body } = await call(session, {
        file: "does-not-exist.tsx",
        line: 1,
        ruleId: "keyboard/handler-missing",
        reason: "placeholder",
        cwd: dir,
      });

      expect(isError).toBe(true);
      const err = body as ErrorBody;
      expect(err.code).toBe("file-not-found");
    });
  });
});

describe("suppress: line-out-of-range", () => {
  it("rejects when line is past EOF", async () => {
    await withScratch(async (dir) => {
      const filePath = join(dir, "short.tsx");
      const original = "export const X = 1;\n";
      await writeFile(filePath, original);

      const session = allowWriteSession();
      const { isError, body } = await call(session, {
        file: filePath,
        line: 99,
        ruleId: "keyboard/handler-missing",
        reason: "placeholder",
        cwd: dir,
      });

      expect(isError).toBe(true);
      const err = body as ErrorBody;
      expect(err.code).toBe("line-out-of-range");
      expect(await readFile(filePath, "utf8")).toBe(original);
    });
  });

  it("rejects line 0 as `invalid-param` (1-based contract)", async () => {
    await withScratch(async (dir) => {
      const filePath = join(dir, "ok.tsx");
      await writeFile(filePath, "export const X = 1;\n");

      const session = allowWriteSession();
      const { isError, body } = await call(session, {
        file: filePath,
        line: 0,
        ruleId: "keyboard/handler-missing",
        reason: "placeholder",
        cwd: dir,
      });

      expect(isError).toBe(true);
      const err = body as ErrorBody;
      expect(err.code).toBe("invalid-param");
    });
  });
});

describe("suppress: unsupported extension", () => {
  it("rejects with `file-unsupported` for unknown file types", async () => {
    await withScratch(async (dir) => {
      const filePath = join(dir, "data.json");
      const original = '{"k":"v"}\n';
      await writeFile(filePath, original);

      const session = allowWriteSession();
      const { isError, body } = await call(session, {
        file: filePath,
        line: 1,
        ruleId: "keyboard/handler-missing",
        reason: "placeholder",
        cwd: dir,
      });

      expect(isError).toBe(true);
      const err = body as ErrorBody;
      expect(err.code).toBe("file-unsupported");
      expect(await readFile(filePath, "utf8")).toBe(original);
    });
  });
});

describe("suppress: round-trip through the pragma parser", () => {
  it("produces a pragma that parseInlineDisables recognises (TSX)", async () => {
    const { parseInlineDisablesDetailed } = await import("../../../src/config/inline-disables.ts");
    await withScratch(async (dir) => {
      const filePath = join(dir, "App.tsx");
      await writeFile(
        filePath,
        ["export function App() {", "  return <div onClick={go}/>;", "}", ""].join("\n"),
      );
      const session = allowWriteSession();
      await call(session, {
        file: filePath,
        line: 2,
        ruleId: "keyboard/handler-missing",
        reason: "design-system wrapper",
        cwd: dir,
      });
      const updated = await readFile(filePath, "utf8");
      const { declarations, disableMap } = parseInlineDisablesDetailed(updated);
      expect(declarations.length).toBe(1);
      const [decl] = declarations;
      if (!decl) throw new Error("missing decl");
      expect(decl.kind).toBe("disable-next-line");
      expect([...decl.ruleIds]).toEqual(["keyboard/handler-missing"]);
      expect(decl.reason).toBe("design-system wrapper");
      const targeted = disableMap.get(3);
      expect(targeted?.has("keyboard/handler-missing")).toBe(true);
    });
  });
});
