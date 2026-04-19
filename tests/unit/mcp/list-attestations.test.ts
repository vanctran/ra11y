/**
 * Unit tests for the `list_attestations` MCP tool.
 *
 * Guards the enumerate-only shape the tool promises:
 *
 *   - An empty ledger surfaces `attestations: []` and `totalCount: 0`
 *     (affirmative empty — CLAUDE.md §1 "Surface, don't suppress").
 *   - Fresh attestations (no files changed since the stamp commit)
 *     surface the record but OMIT `stale` (present-when-meaningful).
 *   - Stale attestations (scoped file changed since the stamp) surface
 *     `stale: true` plus a `staleCount` in meta.
 *   - Outside a git repo, the probe is unavailable: the response
 *     surfaces `meta.staleProbeUnavailable: true` and omits
 *     `staleCount` entirely (reporting 0 would be a lie). No record
 *     carries `stale`.
 *   - File-scope attestations stay stale-neutral when only unrelated
 *     files change — the probe answers `false` because the scoped
 *     file wasn't touched.
 *
 * Tests drive the handler directly with scratch git repos rather than
 * through JSON-RPC — the protocol layer is covered by the MCP server
 * test.
 */

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAttestation } from "../../../src/config/attestation-store.ts";
import { McpSession } from "../../../src/mcp/session.ts";
import {
  type AttestationOut,
  listAttestationsTool,
} from "../../../src/mcp/tool-list-attestations.ts";

interface ListAttestationsResponse {
  readonly attestations: readonly AttestationOut[];
  readonly meta: {
    readonly cwd: string;
    readonly storePath: string;
    readonly totalCount: number;
    readonly staleCount?: number;
    readonly staleProbeUnavailable?: true;
  };
  readonly nextStep?: string;
}

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  // Canonicalize the scratch dir before handing it to tests.
  // `mkdtemp` returns the symlinked macOS tmp path (`/var/folders/...`),
  // but `git rev-parse --show-toplevel` canonicalizes to
  // `/private/var/folders/...` — and the staleness probe joins
  // changed-file paths against the canonical root, so scoped record
  // paths have to live in the same space or set-membership fails.
  const raw = await mkdtemp(join(tmpdir(), "ra11y-list-attestations-"));
  const dir = realpathSync(raw);
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function git(cwd: string, args: readonly string[], env?: Record<string, string>): void {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: env === undefined ? process.env : { ...process.env, ...env },
  });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  }
}

/**
 * Initializes a git repo with a stable identity so commits are
 * deterministic. The identity values are scoped to this repo only
 * (git config without --global) — no interaction with the user's
 * global git config.
 */
function initRepo(cwd: string): void {
  git(cwd, ["init", "--quiet", "-b", "main"]);
  git(cwd, ["config", "user.email", "test@ra11y.local"]);
  git(cwd, ["config", "user.name", "ra11y test"]);
  git(cwd, ["config", "commit.gpgsign", "false"]);
}

/**
 * Commit every staged + working-tree change with explicit author and
 * committer dates. `git rev-list --before=<ts>` reads committer-date,
 * so pinning both timestamps makes stamp resolution deterministic
 * across machines regardless of wall-clock precision.
 */
function commit(cwd: string, message: string, isoDate: string): void {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "--quiet", "--allow-empty", "--date", isoDate, "-m", message], {
    GIT_AUTHOR_DATE: isoDate,
    GIT_COMMITTER_DATE: isoDate,
  });
}

async function callTool(cwd: string): Promise<ListAttestationsResponse> {
  const session = new McpSession();
  const result = await listAttestationsTool.handler({ cwd }, session);
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0]?.text ?? "") as ListAttestationsResponse;
}

// Fixed timeline shared across tests. Commits authored at T0 and T2,
// attestations stamped at T1 (strictly between). Explicit dates make
// `git rev-list --before=<ts>` resolution deterministic regardless of
// the test host's wall-clock precision.
const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-02-01T00:00:00.000Z";
const T2 = "2026-03-01T00:00:00.000Z";

describe("list_attestations: empty ledger", () => {
  // Guards the affirmative-empty contract: an empty ledger surfaces
  // `attestations: []` and `totalCount: 0` — not a sign the tool never
  // ran. Per CLAUDE.md §1 "Surface, don't suppress."
  it("returns an empty list and totalCount: 0 when no ledger file exists", async () => {
    await withScratch(async (dir) => {
      initRepo(dir);
      await writeFile(join(dir, "README.md"), "# scratch\n");
      commit(dir, "initial", T0);
      const body = await callTool(dir);
      expect(body.attestations).toEqual([]);
      expect(body.meta.totalCount).toBe(0);
      expect(body.meta.staleCount).toBe(0);
      expect(body.meta.staleProbeUnavailable).toBeUndefined();
      expect(body.nextStep).toContain("Ledger is empty");
    });
  });
});

describe("list_attestations: fresh attestation", () => {
  // Fresh = stamp commit === HEAD, so NOTHING has changed since. The
  // record must surface, but `stale` must be absent (present-when-
  // meaningful) and `staleCount` must be 0.
  it("surfaces the record with no `stale` flag when the tree is untouched since the stamp", async () => {
    await withScratch(async (dir) => {
      initRepo(dir);
      await writeFile(join(dir, "README.md"), "# scratch\n");
      commit(dir, "initial", T0);

      // Stamp the attestation at T1 (> T0, no commits after). The
      // probe resolves stamp → initial commit === HEAD → fresh.
      await appendAttestation(dir, {
        criterionId: "wcag22:2.4.7",
        by: "ci-bot",
        reason: "axe-core run 2026-04-18 reported pass for focus-visible",
        attestedAt: T1,
        verdict: "pass",
        scope: "project",
      });

      const body = await callTool(dir);
      expect(body.attestations.length).toBe(1);
      const entry = body.attestations[0];
      if (!entry) throw new Error("missing entry");
      expect(entry.criterionId).toBe("wcag22:2.4.7");
      expect(entry.verdict).toBe("pass");
      expect(entry.scope).toBe("project");
      expect(entry.by).toBe("ci-bot");
      // `stale` must be absent entirely — key presence, not truthiness.
      expect("stale" in entry).toBe(false);
      expect(body.meta.totalCount).toBe(1);
      expect(body.meta.staleCount).toBe(0);
      expect(body.meta.staleProbeUnavailable).toBeUndefined();
      // No stale records means no re-attest / prune prompt.
      expect(body.nextStep).toBeUndefined();
    });
  });
});

describe("list_attestations: stale attestation", () => {
  // Guards the stale-surface path: an attestation pinned at scope
  // "file" goes stale when the scoped file is in the changed-set
  // between its stamp commit and HEAD. The response must carry
  // `stale: true` on the record AND `staleCount: 1` in meta.
  it("surfaces stale: true when a file-scoped record's file changed since the stamp", async () => {
    await withScratch(async (dir) => {
      initRepo(dir);
      const targetFile = join(dir, "src", "Button.tsx");
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(targetFile, "export function Button() { return null; }\n");
      commit(dir, "initial", T0);

      // Stamp the attestation at T1 — after the initial commit but
      // before any further commits. `git rev-list --before=T1` picks
      // the initial commit as the stamp, while HEAD will advance to
      // the second commit below.
      await appendAttestation(dir, {
        criterionId: "wcag22:2.4.7",
        by: "alice",
        reason: "manual keyboard traversal confirmed for Button",
        attestedAt: T1,
        verdict: "pass",
        scope: "file",
        location: { filePath: targetFile, line: 1, column: 1 },
      });

      // Mutate the scoped file and commit at T2 so the probe sees a
      // non-empty `changedFilesBetween(stamp, HEAD)` containing the
      // scoped Button.tsx path.
      await writeFile(
        targetFile,
        "export function Button() { return <button type='button' />; }\n",
      );
      commit(dir, "update Button", T2);

      const body = await callTool(dir);
      expect(body.attestations.length).toBe(1);
      const entry = body.attestations[0];
      if (!entry) throw new Error("missing entry");
      expect(entry.stale).toBe(true);
      expect(body.meta.staleCount).toBe(1);
      expect(body.meta.staleProbeUnavailable).toBeUndefined();
      expect(body.nextStep).toContain("stale");
    });
  });
});

describe("list_attestations: probe unavailable", () => {
  // Guards the honest-unknown shape when the probe can't answer:
  // `cwd` is not inside a git repo, so `headSha` returns null,
  // `createGitStalenessProbe` returns undefined, and the response
  // must surface `staleProbeUnavailable: true` WITHOUT a `staleCount`
  // (which would be a lie — we don't know how many are stale).
  it("omits staleCount and surfaces staleProbeUnavailable: true outside a git repo", async () => {
    await withScratch(async (dir) => {
      // Deliberately NO `git init` — this directory is not a repo.
      await appendAttestation(dir, {
        criterionId: "wcag22:2.4.7",
        by: "ci-bot",
        reason: "axe-core run reported pass for focus-visible",
        attestedAt: "2026-04-18T00:00:00.000Z",
        verdict: "pass",
        scope: "project",
      });

      const body = await callTool(dir);
      expect(body.attestations.length).toBe(1);
      const entry = body.attestations[0];
      if (!entry) throw new Error("missing entry");
      // Every record must have `stale` absent when the probe is
      // unavailable — staleness is indeterminate, and guessing is
      // the silent-miss failure mode CLAUDE.md §1 warns against.
      expect("stale" in entry).toBe(false);
      expect(body.meta.staleProbeUnavailable).toBe(true);
      // staleCount must be absent entirely — key presence, not a
      // sentinel 0. Consumers branch on presence.
      expect("staleCount" in body.meta).toBe(false);
      expect(body.nextStep).toContain("not inside a git repo");
    });
  });
});

describe("list_attestations: file-scope with unrelated changes", () => {
  // Guards the file-scope stale-neutral path: when the scoped file
  // is untouched and only unrelated files changed, the probe must
  // return `false` for that record, not `true`. Without this, a
  // component-level attestation would go stale every time anyone
  // commits anywhere in the tree — noise the agent has to re-verify
  // for no good reason.
  it("keeps stale absent when only unrelated files change (file scope)", async () => {
    await withScratch(async (dir) => {
      initRepo(dir);
      await mkdir(join(dir, "src"), { recursive: true });
      const scopedFile = join(dir, "src", "Button.tsx");
      const unrelatedFile = join(dir, "src", "Icon.tsx");
      await writeFile(scopedFile, "export const Button = () => null;\n");
      await writeFile(unrelatedFile, "export const Icon = () => null;\n");
      commit(dir, "initial", T0);

      await appendAttestation(dir, {
        criterionId: "wcag22:2.4.7",
        by: "alice",
        reason: "manual keyboard traversal confirmed for Button",
        attestedAt: T1,
        verdict: "pass",
        scope: "file",
        location: { filePath: scopedFile, line: 1, column: 1 },
      });

      // Change ONLY the unrelated file, then commit at T2. The probe
      // reads changedFilesBetween(stamp, HEAD) and sees just
      // Icon.tsx — the scoped Button.tsx is absent, so the record
      // stays fresh.
      await writeFile(unrelatedFile, "export const Icon = () => <svg />;\n");
      commit(dir, "update Icon", T2);

      const body = await callTool(dir);
      expect(body.attestations.length).toBe(1);
      const entry = body.attestations[0];
      if (!entry) throw new Error("missing entry");
      expect("stale" in entry).toBe(false);
      expect(body.meta.staleCount).toBe(0);
      expect(body.nextStep).toBeUndefined();
    });
  });
});
