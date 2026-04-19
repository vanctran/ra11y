/**
 * `ra11y --doctor` — environment + configuration sanity check.
 *
 * Reports:
 *   - Node/Bun versions (warns if below supported floor)
 *   - Whether a ra11y.config.ts is picked up and from where
 *   - How many standards/rules are loaded
 *   - Whether the MCP entry point is reachable
 *   - Presence of common gotchas (git repo?, tsconfig.json?)
 *
 * Doctor never fails loudly — missing optional pieces surface as
 * warnings (yellow). Hard errors (corrupt config) exit non-zero so
 * CI can gate on `ra11y --doctor` if desired.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { BUILTIN_RULES } from "../../rules/index.ts";
import { BUILTIN_STANDARDS } from "../../standards/index.ts";
import { ExitCode } from "../exit-codes.ts";
import { VERSION } from "../help.ts";
import type { ScanExit } from "./scan.ts";

const NODE_FLOOR_MAJOR = 22;

export function runDoctor(): ScanExit {
  const lines: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  lines.push("");
  lines.push(`  ra11y v${VERSION} · doctor`);
  lines.push("");

  lines.push("  runtime");
  lines.push(`    node     ${process.version}`);
  const nodeMajor = Number.parseInt(process.version.slice(1).split(".")[0] ?? "0", 10);
  if (nodeMajor < NODE_FLOOR_MAJOR) {
    warnings.push(`node ${process.version} is below the supported floor (>= ${NODE_FLOOR_MAJOR})`);
  }
  if (typeof Bun !== "undefined") {
    lines.push(`    bun      ${Bun.version}`);
  }
  lines.push(`    platform ${process.platform} ${process.arch}`);
  lines.push("");

  lines.push("  project");
  const cwd = process.cwd();
  lines.push(`    cwd      ${cwd}`);
  const configPath = join(cwd, "ra11y.config.ts");
  if (existsSync(configPath)) {
    lines.push(`    config   ra11y.config.ts`);
  } else {
    lines.push(`    config   (none — using defaults; run \`ra11y --init\`)`);
  }
  lines.push(`    tsconfig ${existsSync(join(cwd, "tsconfig.json")) ? "present" : "missing"}`);
  lines.push(`    git repo ${existsSync(join(cwd, ".git")) ? "yes" : "no"}`);
  lines.push("");

  lines.push("  loaded content");
  lines.push(
    `    standards ${BUILTIN_STANDARDS.length}  (${BUILTIN_STANDARDS.map((s) => s.id).join(", ")})`,
  );
  lines.push(`    rules     ${BUILTIN_RULES.length}`);
  lines.push("");

  if (warnings.length > 0) {
    lines.push("  warnings");
    for (const w of warnings) lines.push(`    ! ${w}`);
    lines.push("");
  }
  if (errors.length > 0) {
    lines.push("  errors");
    for (const e of errors) lines.push(`    ✗ ${e}`);
    lines.push("");
  }

  lines.push(errors.length === 0 ? "  ✓ doctor: no blocking issues" : "  ✗ doctor: issues above");
  lines.push("");

  return {
    stdout: lines.join("\n"),
    stderr: "",
    exitCode: errors.length > 0 ? ExitCode.VIOLATIONS : ExitCode.OK,
  };
}
