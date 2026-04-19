/**
 * Unit tests for the `scan_process` MCP tool.
 *
 * Guards the process-orchestration contract:
 *
 *   - Config with a process whose pages all exist → every page scanned,
 *     per-page results aggregated, `totalFindings` summed honestly.
 *   - Unknown `processName` → `warnings: ["process_not_found"]`, empty
 *     results, `resolvedProcess: null` (distinct shape from a matched
 *     empty scan).
 *   - One declared page missing from disk → `warnings:
 *     ["process_has_missing_pages"]`, `meta.missingPages` enumerates the
 *     absent path, remaining pages scan normally.
 *   - No `processes` declared → `warnings: ["no_processes_configured"]`
 *     (distinct code from `process_not_found` — remediation differs).
 *   - Multiple processes declared → scan resolves only the named one;
 *     pages in sibling processes stay unscanned.
 *   - `processLevelCandidates` is always `[]` in this phase — the field
 *     is part of the shape so future process-level finders slot in
 *     without breaking consumers.
 *
 * Tests drive the handler directly with scratch config files rather
 * than through JSON-RPC — the protocol layer is covered by the MCP
 * server test.
 */

import { describe, expect, it } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpSession } from "../../../src/mcp/session.ts";
import { type ScanProcessResponse, scanProcessTool } from "../../../src/mcp/tool-scan-process.ts";

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  // Canonicalize so the config-resolver's walk-up sees the same path
  // shape the tests assert against.
  const raw = await mkdtemp(join(tmpdir(), "ra11y-scan-process-"));
  const dir = realpathSync(raw);
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Writes a JSON ra11y.config.json in `dir`. */
async function writeConfig(dir: string, config: Record<string, unknown>): Promise<void> {
  await writeFile(join(dir, "ra11y.config.json"), JSON.stringify(config));
}

/** Writes an HTML page with the given body at `dir/<relPath>`. */
async function writeHtmlPage(dir: string, relPath: string, body: string): Promise<void> {
  const abs = join(dir, relPath);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(
    abs,
    `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`,
  );
}

/** Invokes the handler and returns the parsed response body. */
async function callTool(
  cwd: string,
  params: Record<string, unknown>,
): Promise<ScanProcessResponse> {
  const session = new McpSession();
  const result = await scanProcessTool.handler({ cwd, ...params }, session);
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0]?.text ?? "") as ScanProcessResponse;
}

describe("scan_process: happy path — every declared page exists", () => {
  // A matched process with all pages present scans each page and
  // aggregates per-page results. `totalFindings` sums the per-page
  // violation counts; `pagesScanned` preserves declared order (not
  // alphabetical). `resolvedProcess` round-trips the matched entry
  // verbatim so the agent can confirm which declaration drove the
  // scan.
  it("scans every page of the matched process in declared order", async () => {
    await withScratch(async (dir) => {
      // Three pages, one with a findable violation (img without alt)
      // so totalFindings is non-zero and the aggregation is observable.
      await writeHtmlPage(dir, "cart.html", "<p>Cart</p>");
      await writeHtmlPage(dir, "shipping.html", "<img src='x.png'>");
      await writeHtmlPage(dir, "confirm.html", "<p>Thanks</p>");
      await writeConfig(dir, {
        processes: [
          {
            name: "checkout",
            // Declared order: cart → shipping → confirm.
            pages: ["cart.html", "shipping.html", "confirm.html"],
          },
        ],
      });

      const body = await callTool(dir, { processName: "checkout" });

      expect(body.processName).toBe("checkout");
      expect(body.pagesScanned.length).toBe(3);
      expect(body.pagesScanned.map((p) => p.path)).toEqual([
        "cart.html",
        "shipping.html",
        "confirm.html",
      ]);
      expect(body.perPageResults.length).toBe(3);
      // Total findings sums per-page violation counts.
      const summed = body.pagesScanned.reduce((n, p) => n + p.findings, 0);
      expect(body.meta.totalFindings).toBe(summed);
      // resolvedProcess round-trips verbatim.
      expect(body.meta.resolvedProcess).not.toBeNull();
      expect(body.meta.resolvedProcess?.name).toBe("checkout");
      expect([...(body.meta.resolvedProcess?.pages ?? [])]).toEqual([
        "cart.html",
        "shipping.html",
        "confirm.html",
      ]);
      // processLevelCandidates always present with a concrete array
      // shape — may populate with 2.4.5 multiple-ways candidates from
      // the heuristic fallback when a process page has no <nav>.
      expect(Array.isArray(body.processLevelCandidates)).toBe(true);
      // No warnings on the all-present happy path.
      expect(body.warnings).toBeUndefined();
      expect(body.meta.missingPages).toBeUndefined();
    });
  });
});

describe("scan_process: unknown processName", () => {
  // Guards the `process_not_found` envelope: the matched process is
  // absent from the config's `processes` list, so the tool surfaces
  // an honest empty result rather than silently scanning nothing.
  it("surfaces process_not_found and an empty result when the name is missing", async () => {
    await withScratch(async (dir) => {
      await writeHtmlPage(dir, "a.html", "<p>a</p>");
      await writeConfig(dir, {
        processes: [{ name: "checkout", pages: ["a.html"] }],
      });

      const body = await callTool(dir, { processName: "signup" });

      expect(body.warnings).toEqual(["process_not_found"]);
      expect(body.pagesScanned).toEqual([]);
      expect(body.perPageResults).toEqual([]);
      expect(body.processLevelCandidates).toEqual([]);
      expect(body.meta.totalFindings).toBe(0);
      expect(body.meta.resolvedProcess).toBeNull();
      expect(body.nextStep).toContain("not declared");
      expect(body.nextStep).toContain("checkout");
    });
  });
});

describe("scan_process: missing pages on disk", () => {
  // Guards partial-evidence scans: declared pages that don't exist on
  // disk are surfaced via `warnings: ["process_has_missing_pages"]`
  // plus `meta.missingPages`, and the scan still runs across the pages
  // that do exist.
  it("surfaces process_has_missing_pages and scans the present pages", async () => {
    await withScratch(async (dir) => {
      await writeHtmlPage(dir, "cart.html", "<p>Cart</p>");
      // shipping.html deliberately NOT written — the page is declared
      // but missing from disk.
      await writeHtmlPage(dir, "confirm.html", "<p>Thanks</p>");
      await writeConfig(dir, {
        processes: [
          {
            name: "checkout",
            pages: ["cart.html", "shipping.html", "confirm.html"],
          },
        ],
      });

      const body = await callTool(dir, { processName: "checkout" });

      expect(body.warnings).toEqual(["process_has_missing_pages"]);
      expect(body.meta.missingPages).toEqual(["shipping.html"]);
      // Two pages actually scanned; missing one does not contribute.
      expect(body.pagesScanned.length).toBe(2);
      expect(body.pagesScanned.map((p) => p.path)).toEqual(["cart.html", "confirm.html"]);
      expect(body.perPageResults.length).toBe(2);
      // `resolvedProcess` still reflects the declaration verbatim —
      // the primitive is intact; only the disk state drifted.
      expect(body.meta.resolvedProcess?.pages.length).toBe(3);
    });
  });
});

describe("scan_process: no processes declared at all", () => {
  // Guards the `no_processes_configured` envelope, which is distinct
  // from `process_not_found` because the remediation differs — the
  // user needs to declare the primitive, not pick a different name.
  it("surfaces no_processes_configured when config.processes is unset or empty", async () => {
    await withScratch(async (dir) => {
      // Config exists but declares no processes.
      await writeConfig(dir, {});
      await writeHtmlPage(dir, "a.html", "<p>a</p>");

      const body = await callTool(dir, { processName: "checkout" });

      expect(body.warnings).toEqual(["no_processes_configured"]);
      expect(body.pagesScanned).toEqual([]);
      expect(body.perPageResults).toEqual([]);
      expect(body.processLevelCandidates).toEqual([]);
      expect(body.meta.resolvedProcess).toBeNull();
      expect(body.nextStep).toContain("No `processes` declared");
    });
  });
});

describe("scan_process: multiple processes, only the named one scans", () => {
  // Guards scope discipline: when the config declares several
  // processes, `scan_process` resolves exactly the one named in
  // `processName`. Sibling processes' pages do NOT appear in
  // `pagesScanned` even when they are valid, parseable files.
  it("scans only the pages of the named process", async () => {
    await withScratch(async (dir) => {
      await writeHtmlPage(dir, "cart.html", "<p>Cart</p>");
      await writeHtmlPage(dir, "confirm.html", "<p>Thanks</p>");
      await writeHtmlPage(dir, "profile.html", "<p>Profile</p>");
      await writeHtmlPage(dir, "settings.html", "<p>Settings</p>");
      await writeConfig(dir, {
        processes: [
          { name: "checkout", pages: ["cart.html", "confirm.html"] },
          { name: "account", pages: ["profile.html", "settings.html"] },
        ],
      });

      const body = await callTool(dir, { processName: "account" });

      expect(body.processName).toBe("account");
      expect(body.warnings).toBeUndefined();
      expect(body.pagesScanned.map((p) => p.path)).toEqual(["profile.html", "settings.html"]);
      // resolvedProcess is the account process, not checkout — the
      // agent can confirm it drove the scan.
      expect(body.meta.resolvedProcess?.name).toBe("account");
      expect([...(body.meta.resolvedProcess?.pages ?? [])]).toEqual([
        "profile.html",
        "settings.html",
      ]);
    });
  });
});
