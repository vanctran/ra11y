/**
 * Integration tests for the `apply_fix` MCP tool. Drives the tool
 * through the JSON-RPC round-trip so session state (the `allowWrite`
 * flag) behaves the way a real agent sees it, and asserts every
 * load-bearing invariant from the tool spec:
 *
 *   - `allowWrite: false` gates the call. The default-off posture is
 *     the whole point; a regression here silently unlocks source
 *     mutation for every host.
 *   - `dryRun: true` never writes. Verified by comparing on-disk
 *     contents before/after.
 *   - `dryRun: false` writes. Verified by reading the post-call file
 *     and checking the delta comes back populated.
 *   - Path traversal (`../../etc/hosts`) is rejected before any
 *     resolve → escape sequence can take the edit outside cwd.
 *   - Missing `oldText` doesn't silently misapply — the agent gets a
 *     structured error with enough context to retry.
 *   - Post-edit parse errors abort the write so the file doesn't land
 *     in a broken state even with `dryRun: false`.
 *   - A real fix (img → img+alt) produces `delta.resolvedViolations`
 *     with the pre-existing violation's ruleId.
 *
 * These all need the full MCP round-trip because the session's
 * `allowWrite` flag is the thing being tested. A direct handler
 * invocation would skip the `configure` → `apply_fix` sequencing
 * that's actually the product.
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");

type JsonRpcResponse = Record<string, unknown>;

async function mcpSession(
  messages: readonly Record<string, unknown>[],
): Promise<JsonRpcResponse[]> {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", "--mcp"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: PROJECT_ROOT,
  });

  const payload = `${messages.map((m) => JSON.stringify(m)).join("\n")}\n`;
  proc.stdin.write(payload);
  proc.stdin.end();

  const text = await new Response(proc.stdout).text();
  proc.kill();

  return text
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as JsonRpcResponse);
}

function initMsg(id: number): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-agent", version: "1.0" },
    },
  };
}

function toolCall(
  id: number,
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

function bodyOf(response: JsonRpcResponse): Record<string, unknown> {
  const result = response.result as { content: Array<{ text: string }> };
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function isError(response: JsonRpcResponse): boolean {
  const result = response.result as { isError?: boolean } | undefined;
  return result?.isError === true;
}

/**
 * Writes a fixture file with a missing-alt <img> and returns the scratch
 * dir + the file path. The bad-alt HTML rule produces at least one
 * violation against this shape, so the apply_fix round-trip can show
 * resolvedViolations after the edit lands.
 */
async function scratchBadImg(): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-apply-fix-"));
  const file = join(dir, "page.html");
  await writeFile(file, '<html><body><img src="/logo.png"></body></html>\n');
  return { dir, file };
}

describe("MCP apply_fix tool: write-gated fix-verify loop", () => {
  it("rejects the call when allowWrite is false (default)", async () => {
    const { dir, file } = await scratchBadImg();
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "apply_fix", {
          filePath: file,
          edit: { oldText: '<img src="/logo.png">', newText: '<img src="/logo.png" alt="Acme">' },
          cwd: dir,
          dryRun: false,
        }),
      ]);
      expect(isError(responses[1])).toBe(true);
      const body = bodyOf(responses[1]) as { error: string };
      expect(body.error).toMatch(/allowwrite/i);
      expect(body.error).toContain("configure");
      // The file must remain untouched.
      const contents = await readFile(file, "utf8");
      expect(contents).toContain('<img src="/logo.png">');
      expect(contents).not.toContain('alt="Acme"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("dryRun: true never writes to disk even with allowWrite set", async () => {
    const { dir, file } = await scratchBadImg();
    try {
      const before = await readFile(file, "utf8");
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "configure", { allowWrite: true }),
        toolCall(3, "apply_fix", {
          filePath: file,
          edit: { oldText: '<img src="/logo.png">', newText: '<img src="/logo.png" alt="Acme">' },
          cwd: dir,
          dryRun: true,
        }),
      ]);
      const body = bodyOf(responses[2]) as {
        applied: boolean;
        dryRun: boolean;
        filePath: string;
        delta: { resolvedViolations: unknown[]; newViolations: unknown[] };
      };
      expect(body.applied).toBe(false);
      expect(body.dryRun).toBe(true);
      expect(body.filePath).toBe(file);
      const after = await readFile(file, "utf8");
      expect(after).toBe(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("dryRun: false writes the edit and reports delta.resolvedViolations", async () => {
    const { dir, file } = await scratchBadImg();
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "configure", { allowWrite: true }),
        toolCall(3, "apply_fix", {
          filePath: file,
          edit: { oldText: '<img src="/logo.png">', newText: '<img src="/logo.png" alt="Acme">' },
          cwd: dir,
          dryRun: false,
        }),
      ]);
      const body = bodyOf(responses[2]) as {
        applied: boolean;
        dryRun: boolean;
        delta: {
          resolvedViolations: Array<{ ruleId: string }>;
          newViolations: Array<{ ruleId: string }>;
        };
      };
      expect(body.applied).toBe(true);
      expect(body.dryRun).toBe(false);
      expect(body.delta.resolvedViolations.length).toBeGreaterThan(0);
      expect(body.delta.resolvedViolations.some((v) => v.ruleId.startsWith("media/"))).toBe(true);
      const after = await readFile(file, "utf8");
      expect(after).toContain('alt="Acme"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects path traversal attempts that escape cwd", async () => {
    const { dir, file } = await scratchBadImg();
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "configure", { allowWrite: true }),
        toolCall(3, "apply_fix", {
          filePath: "../../../etc/hosts",
          edit: { oldText: "localhost", newText: "evil.example.com" },
          cwd: dir,
          dryRun: false,
        }),
      ]);
      expect(isError(responses[2])).toBe(true);
      const body = bodyOf(responses[2]) as { error: string };
      expect(body.error).toMatch(/escapes cwd/i);
      // And the original fixture file is untouched.
      const contents = await readFile(file, "utf8");
      expect(contents).toContain('<img src="/logo.png">');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns a structured error when oldText is missing from the file", async () => {
    const { dir, file } = await scratchBadImg();
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "configure", { allowWrite: true }),
        toolCall(3, "apply_fix", {
          filePath: file,
          edit: { oldText: "this text does not exist", newText: "irrelevant" },
          cwd: dir,
          dryRun: false,
        }),
      ]);
      expect(isError(responses[2])).toBe(true);
      const body = bodyOf(responses[2]) as { error: string };
      expect(body.error).toMatch(/not found/i);
      // File untouched.
      const after = await readFile(file, "utf8");
      expect(after).toContain('<img src="/logo.png">');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects edits that introduce parse errors and leaves the file unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra11y-apply-fix-"));
    const file = join(dir, "broken.tsx");
    const before = 'const x = <button aria-label="hi">click</button>;\n';
    await writeFile(file, before);
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "configure", { allowWrite: true }),
        toolCall(3, "apply_fix", {
          filePath: file,
          edit: {
            // Drop the closing tag — parser should flag an unclosed JSX element.
            oldText: '<button aria-label="hi">click</button>',
            newText: '<button aria-label="hi">click',
          },
          cwd: dir,
          dryRun: false,
        }),
      ]);
      expect(isError(responses[2])).toBe(true);
      const body = bodyOf(responses[2]) as { error: string };
      expect(body.error).toMatch(/parse errors/i);
      const after = await readFile(file, "utf8");
      expect(after).toBe(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects edits whose oldText matches multiple locations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra11y-apply-fix-"));
    const file = join(dir, "dup.html");
    // Two identical <img> tags — oldText matches twice.
    const before = '<html><body><img src="/a.png"><img src="/a.png"></body></html>\n';
    await writeFile(file, before);
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "configure", { allowWrite: true }),
        toolCall(3, "apply_fix", {
          filePath: file,
          edit: { oldText: '<img src="/a.png">', newText: '<img src="/a.png" alt="A">' },
          cwd: dir,
          dryRun: true,
        }),
      ]);
      expect(isError(responses[2])).toBe(true);
      const body = bodyOf(responses[2]) as { error: string };
      expect(body.error).toMatch(/matches 2 locations/i);
      const after = await readFile(file, "utf8");
      expect(after).toBe(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("surfaces newViolations when an edit introduces a new rule-level finding", async () => {
    // Start with a clean file. The edit will introduce a <img> without
    // alt, so the post-scan should produce a new violation that wasn't
    // in the pre-scan.
    const dir = await mkdtemp(join(tmpdir(), "ra11y-apply-fix-"));
    const file = join(dir, "clean.html");
    const before = "<html><body><p>hello</p></body></html>\n";
    await writeFile(file, before);
    try {
      const responses = await mcpSession([
        initMsg(1),
        toolCall(2, "configure", { allowWrite: true }),
        toolCall(3, "apply_fix", {
          filePath: file,
          edit: {
            oldText: "<p>hello</p>",
            newText: '<p>hello</p><img src="/x.png">',
          },
          cwd: dir,
          dryRun: true,
        }),
      ]);
      const body = bodyOf(responses[2]) as {
        delta: {
          resolvedViolations: Array<{ ruleId: string }>;
          newViolations: Array<{ ruleId: string }>;
        };
        nextStep: string;
      };
      expect(body.delta.resolvedViolations).toEqual([]);
      expect(body.delta.newViolations.length).toBeGreaterThan(0);
      expect(body.nextStep).toMatch(/new violation/i);
      // dryRun so file must remain untouched.
      const after = await readFile(file, "utf8");
      expect(after).toBe(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
