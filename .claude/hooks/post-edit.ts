#!/usr/bin/env bun
// PostToolUse hook for Edit|Write. Format + typecheck + targeted test
// for the file that just changed. We never block here — PostToolUse
// happens after the tool has run — but we surface errors via
// additionalContext so Claude sees them in the next turn.

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { audit } from "./lib/audit.ts";
import { readHookInput } from "./lib/input.ts";
import { ok } from "./lib/output.ts";
import type { PostToolUseInput } from "./lib/types.ts";

interface TestStatus {
  passing: number;
  failing: number;
  durationMs: number;
  timestamp: string;
}

const input = await readHookInput<PostToolUseInput>();
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
const rawPath = String(input.tool_input.file_path ?? "");
if (!rawPath) ok();

const relPath = rawPath.startsWith("/") ? relative(projectDir, rawPath) : rawPath;
const isTs = relPath.endsWith(".ts") || relPath.endsWith(".tsx");
const isUnderWatched =
  relPath.startsWith("src/") ||
  relPath.startsWith("tests/") ||
  relPath.startsWith("scripts/") ||
  relPath.startsWith(".claude/hooks/");

if (!(isTs && isUnderWatched)) ok();
if (!existsSync(join(projectDir, "node_modules"))) ok();

const errors: string[] = [];

const format = spawnSync(`bunx --bun biome format --write "${relPath}"`, {
  cwd: projectDir,
  shell: true,
  encoding: "utf8",
});
if (format.status !== 0) {
  errors.push(`biome format failed:\n${format.stderr?.trim() ?? ""}`);
}

if (relPath.startsWith("src/") && existsSync(join(projectDir, "tsconfig.json"))) {
  const tsc = spawnSync("bunx tsc --noEmit", {
    cwd: projectDir,
    shell: true,
    encoding: "utf8",
  });
  if (tsc.status !== 0) {
    errors.push(`tsc --noEmit reported errors:\n${tsc.stdout?.trim() ?? ""}`);
  }
}

// Run the targeted unit test if the file is a rule or its test.
const testMatch = /^src\/rules\/([^/]+)\/([^/]+)\.ts$/.exec(relPath);
if (testMatch) {
  const [, domain, slug] = testMatch;
  const testFile = `tests/unit/rules/${domain}/${slug}.test.ts`;
  if (existsSync(join(projectDir, testFile))) {
    const test = spawnSync(`bun test "${testFile}"`, {
      cwd: projectDir,
      shell: true,
      encoding: "utf8",
    });
    writeTestStatus(projectDir, test.status === 0);
    if (test.status !== 0) {
      errors.push(`bun test ${testFile} failed:\n${test.stdout?.trim() ?? ""}`);
    }
  }
} else if (relPath.startsWith("tests/") && relPath.endsWith(".test.ts")) {
  const test = spawnSync(`bun test "${relPath}"`, {
    cwd: projectDir,
    shell: true,
    encoding: "utf8",
  });
  writeTestStatus(projectDir, test.status === 0);
  if (test.status !== 0) {
    errors.push(`bun test ${relPath} failed:\n${test.stdout?.trim() ?? ""}`);
  }
}

audit({
  event: "PostToolUse:Edit|Write",
  action: errors.length > 0 ? "errors" : "clean",
  detail: { file: relPath, errorCount: errors.length },
});

if (errors.length > 0) {
  ok({
    systemMessage: errors.join("\n\n"),
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `post-edit checks failed for ${relPath} — fix before next commit:\n\n${errors.join("\n\n")}`,
    },
  });
}

ok();

function writeTestStatus(dir: string, passing: boolean): void {
  const status: TestStatus = {
    passing: passing ? 1 : 0,
    failing: passing ? 0 : 1,
    durationMs: 0,
    timestamp: new Date().toISOString(),
  };
  try {
    writeFileSync(join(dir, ".claude", "test-status.json"), JSON.stringify(status, null, 2));
  } catch {
    // Best-effort.
  }
}
