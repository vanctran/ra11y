/**
 * `ra11y attestations <action>` — subcommand namespace for managing
 * the on-disk attestation ledger at `.ra11y/attestations.jsonl`.
 *
 * Today only `prune` lives here (drops records pinned to files that
 * no longer exist). Mirrors the `ra11y baseline prune` pattern: pure
 * function with an injectable `fileExists` predicate in the store
 * module, thin CLI wrapper here that calls it with `fs.existsSync`
 * and writes the result through the store's rewrite primitive.
 */

import { existsSync } from "node:fs";
import { relative } from "node:path";
import {
  ATTESTATION_STORE_RELATIVE_PATH,
  pruneAttestations,
  readAttestations,
  resolveAttestationStorePath,
  rewriteAttestations,
} from "../../config/attestation-store.ts";
import type { AttestationRecord } from "../../types/evidence.ts";
import type { CliOptions } from "../args.ts";
import { ExitCode } from "../exit-codes.ts";
import type { ScanExit } from "./scan.ts";

/** Routes `ra11y attestations <action>` to the matching handler. */
export function runAttestationsCommand(options: CliOptions): Promise<ScanExit> {
  if (options.attestationsAction === "prune") return runAttestationsPrune(options);
  return Promise.resolve({
    stdout: "",
    stderr: `ra11y: unknown attestations action '${options.attestationsAction ?? ""}'. Supported: prune.\n`,
    exitCode: ExitCode.USER_ERROR,
  });
}

/**
 * `ra11y attestations prune` — drops records pinned to deleted files
 * and rewrites `.ra11y/attestations.jsonl`. With `--dry-run`, reports
 * without mutating. Exit 0 on success (including zero-stale); exit 2
 * when the store is missing or any line is malformed beyond the
 * lenient read path's tolerance.
 */
async function runAttestationsPrune(options: CliOptions): Promise<ScanExit> {
  const cwd = process.cwd();
  const path = resolveAttestationStorePath(cwd);
  const displayPath = relative(cwd, path) || path;

  if (!existsSync(path)) {
    return {
      stdout: "",
      stderr: `ra11y: attestation store not found at ${displayPath}. Run \`ra11y attest\` (or the \`attest\` MCP tool) to create entries first.\n`,
      exitCode: ExitCode.USER_ERROR,
    };
  }

  let records: readonly AttestationRecord[];
  try {
    records = await readAttestations(cwd);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      stdout: "",
      stderr: `ra11y: failed to read attestation store at ${displayPath}: ${message}\n`,
      exitCode: ExitCode.USER_ERROR,
    };
  }

  const { kept, dropped } = pruneAttestations(records, existsSync);
  if (!options.attestationsDryRun && dropped.length > 0) {
    await rewriteAttestations(cwd, kept);
  }

  return {
    stdout: renderPruneReport(kept, dropped, displayPath, options.attestationsDryRun),
    stderr: "",
    exitCode: ExitCode.OK,
  };
}

function renderPruneReport(
  kept: readonly AttestationRecord[],
  dropped: readonly AttestationRecord[],
  displayPath: string,
  dryRun: boolean,
): string {
  const prefix = dryRun ? "ra11y attestations prune (dry-run):" : "ra11y attestations prune:";
  const verb = dropped.length === 0 ? "dropped" : dryRun ? "would drop" : "dropped";
  const lines = [
    `${prefix} ${verb} ${dropped.length} dead records (${kept.length} still live) in ${displayPath}`,
  ];
  for (const record of dropped) {
    const pinned = record.location?.filePath ?? "<no location>";
    lines.push(`  - ${pinned}  ${record.criterionId}`);
  }
  return `${lines.join("\n")}\n`;
}

// Re-export the constant so future callers that import the CLI
// module keep a single source of truth for the path layout.
export { ATTESTATION_STORE_RELATIVE_PATH };
