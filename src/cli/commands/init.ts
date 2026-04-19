/**
 * `ra11y --init` — writes a starter `ra11y.config.ts` into the
 * current directory. Idempotent: if the file exists, refuses to
 * overwrite and points the user at the existing path.
 *
 * The emitted config covers the knobs teams usually want in their
 * first commit: `standards`, `level`, `exclude`, and the
 * `nativeWrappers` array for React codebases that wrap native
 * interactives in PascalCase components.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import type { CliOptions } from "../args.ts";
import { ExitCode } from "../exit-codes.ts";
import type { ScanExit } from "./scan.ts";

const TEMPLATE = `import { defineConfig } from "@ra11y/core/plugin";

/**
 * ra11y configuration.
 *
 * See https://github.com/vanctran/ra11y for the full option
 * reference. Every field here is optional — the defaults match
 * WCAG 2.2 AA against src/.
 */
export default defineConfig({
  standards: ["wcag22"],
  level: "AA",
  exclude: ["node_modules", "dist", "build", ".next", "coverage"],
  // PascalCase wrappers that render a native interactive element.
  // Add entries here to quiet false positives from rules like
  // keyboard/handler-missing on your design-system primitives.
  nativeWrappers: [
    // "Button",
    // "Link",
  ],
});
`;

export function runInit(_options: CliOptions): ScanExit {
  const cwd = process.cwd();
  const target = join(cwd, "ra11y.config.ts");
  const rel = relative(cwd, target) || "ra11y.config.ts";

  if (existsSync(target)) {
    return {
      stdout: "",
      stderr: `ra11y: ${rel} already exists — not overwriting\n`,
      exitCode: ExitCode.VIOLATIONS,
    };
  }

  writeFileSync(target, TEMPLATE);
  const lines = [
    "",
    `  ✓ wrote ${rel}`,
    "",
    "  Next:",
    "    - edit standards / level / exclude to match your project",
    "    - run `ra11y src/` to scan",
    "    - run `ra11y --detect-native-wrappers src/` from an MCP agent",
    "      to auto-populate the nativeWrappers list",
    "",
  ];
  return { stdout: lines.join("\n"), stderr: "", exitCode: ExitCode.OK };
}
