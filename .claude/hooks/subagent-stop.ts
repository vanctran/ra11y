#!/usr/bin/env bun
// SubagentStop hook. Validates that subagent output follows ra11y's
// invariants before the parent session consumes it. For rule-implementer
// this means: the rule file header cites WCAG, satisfies[] is non-empty,
// and tests pass. For dependency-auditor we check package.json is still
// zero-dep. Failures exit 2 to force the parent to retry.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { audit } from "./lib/audit.ts";
import { readHookInput } from "./lib/input.ts";
import { block, ok } from "./lib/output.ts";
import type { SubagentStopInput } from "./lib/types.ts";

const input = await readHookInput<SubagentStopInput>();
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;

// Universal guard: package.json must have empty `dependencies` no matter
// which subagent ran. This is the zero-dep invariant.
const pkgPath = join(projectDir, "package.json");
if (existsSync(pkgPath)) {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const depCount = pkg.dependencies ? Object.keys(pkg.dependencies).length : 0;
    if (depCount > 0) {
      audit({
        event: "SubagentStop",
        agent: input.agent_type,
        action: "block:dep-invariant",
        detail: { depCount },
      });
      block(
        `zero-dep invariant violated: package.json.dependencies has ${depCount} entries. ra11y ships with zero runtime dependencies. Remove them and write the utility in src/utils/.`,
      );
    }
  } catch {
    // Unreadable package.json is not this hook's problem.
  }
}

// Agent-specific guards.
if (input.agent_type === "rule-implementer") {
  // Inspect the last commit's diff for rule files that are missing a
  // WCAG citation in their header. The subagent should have committed
  // before stopping (see commit discipline in CLAUDE.md section 11).
  const touchedRules = safeExec(projectDir, "git diff --name-only HEAD~1 HEAD -- src/rules/");
  const ruleFiles = touchedRules
    ?.split("\n")
    .filter((f) => f.endsWith(".ts") && !f.endsWith("index.ts"));
  if (ruleFiles) {
    const failures: string[] = [];
    for (const file of ruleFiles) {
      const abs = join(projectDir, file);
      if (!existsSync(abs)) continue;
      const content = readFileSync(abs, "utf8");
      if (!/wcag(\d+)?:\d+\.\d+/i.test(content)) {
        failures.push(`${file}: missing WCAG SC citation (wcagNN:X.Y.Z) in header or satisfies`);
      }
      if (!/https:\/\/www\.w3\.org\/TR\/WCAG/.test(content)) {
        failures.push(`${file}: missing spec URL (https://www.w3.org/TR/WCAG…) in header`);
      }
    }
    if (failures.length > 0) {
      audit({
        event: "SubagentStop",
        agent: "rule-implementer",
        action: "block:missing-citation",
        detail: { failures },
      });
      block(
        `rule-implementer output failed validation — every rule file must cite WCAG SCs and spec URLs:\n\n${failures.join("\n")}`,
      );
    }
  }
}

audit({ event: "SubagentStop", agent: input.agent_type, action: "allow" });
ok();

function safeExec(cwd: string, cmd: string): string | null {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
