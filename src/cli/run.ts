/**
 * CLI entry point called from src/cli.ts. Parses argv, dispatches to
 * the matching command, writes stdout/stderr, and returns the exit code.
 */

import { setColorEnabled } from "../utils/ansi.ts";
import { setLogLevel } from "../utils/logger.ts";
import { parseCliArgs } from "./args.ts";
import { runCertification } from "./commands/certification.ts";
import { runChecklist } from "./commands/checklist.ts";
import { runCoverage } from "./commands/coverage.ts";
import { runExplain } from "./commands/explain.ts";
import { runListRules } from "./commands/list-rules.ts";
import { runListStandards } from "./commands/list-standards.ts";
import { runScanCommand, type ScanExit } from "./commands/scan.ts";
import { runVpat } from "./commands/vpat.ts";
import { renderHelp, VERSION } from "./help.ts";

// biome-ignore lint/suspicious/useAwait: dispatcher returns command promises directly; adding await would be a no-op
export async function runCli(argv: readonly string[]): Promise<ScanExit> {
  const options = parseCliArgs(argv);

  if (options.noColor) setColorEnabled(false);
  if (options.debug) setLogLevel("debug");

  switch (options.command) {
    case "help":
      return { stdout: renderHelp(), stderr: "", exitCode: 0 };
    case "version":
      return { stdout: `ra11y v${VERSION}\n`, stderr: "", exitCode: 0 };
    case "list-rules":
      return runListRules();
    case "list-standards":
      return runListStandards();
    case "explain":
      return runExplain(options.ruleId ?? "");
    case "coverage":
      return runCoverage(options);
    case "checklist":
      return runChecklist(options);
    case "vpat":
      return runVpat(options);
    case "certification":
      return runCertification(options);
    case "scan":
      return runScanCommand(options);
  }
}
