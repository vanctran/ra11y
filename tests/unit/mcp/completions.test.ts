/**
 * Unit tests for `src/mcp/completions.ts` — the `completion/complete`
 * handler that backs ra11y's two completion sources:
 *   - `ref/prompt` / `ra11y/vpat-narrative` / `criterionId` → every
 *     loaded criterion ID whose prefix matches the typed value.
 *   - `ref/resource` / any `ra11y-kb://` URI → KB URIs whose path
 *     contains the substring the agent is typing.
 *
 * Unknown refs return `emptyCompletion()` rather than erroring — the
 * spec's contract means a host blanket-asking for every argument never
 * sees red boxes. KB completions are exercised against a scratch
 * directory so the filesystem walk is real (no mocks).
 */

import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { complete, emptyCompletion } from "../../../src/mcp/completions.ts";

async function makeKb(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-completions-"));
  const kb = join(dir, "docs", "kb", "wcag");
  await mkdir(kb, { recursive: true });
  await writeFile(join(kb, "1-4-3.md"), "# Contrast\n", "utf8");
  await writeFile(join(kb, "1-4-11.md"), "# Non-text contrast\n", "utf8");
  await writeFile(join(kb, "2-4-5.md"), "# Multiple ways\n", "utf8");
  return dir;
}

describe("emptyCompletion", () => {
  it("returns the canonical { values: [], hasMore: false, total: 0 } shape", () => {
    expect(emptyCompletion()).toEqual({
      completion: { values: [], hasMore: false, total: 0 },
    });
  });
});

describe("complete — ref/prompt", () => {
  it("returns the full criterion list (capped) when the value is empty", async () => {
    const res = await complete(
      { type: "ref/prompt", name: "ra11y/vpat-narrative" },
      { name: "criterionId", value: "" },
      "/irrelevant",
    );
    expect(res.completion.values.length).toBeGreaterThan(0);
    expect(res.completion.values.length).toBeLessThanOrEqual(100);
    expect(res.completion.total).toBeGreaterThan(0);
  });

  it("prefix-filters criterion IDs so `wcag22:1.4` returns the 1.4.x family", async () => {
    const res = await complete(
      { type: "ref/prompt", name: "ra11y/vpat-narrative" },
      { name: "criterionId", value: "wcag22:1.4" },
      "/irrelevant",
    );
    expect(res.completion.total).toBeGreaterThan(0);
    for (const id of res.completion.values) {
      expect(id.startsWith("wcag22:1.4")).toBe(true);
    }
  });

  it("sorts criterion IDs stably so agents can cache the first page", async () => {
    const res = await complete(
      { type: "ref/prompt", name: "ra11y/vpat-narrative" },
      { name: "criterionId", value: "wcag22:1." },
      "/irrelevant",
    );
    const sorted = [...res.completion.values].sort();
    expect([...res.completion.values]).toEqual(sorted);
  });

  it("returns empty for an unrecognized prompt name", async () => {
    const res = await complete(
      { type: "ref/prompt", name: "ra11y/nope" },
      { name: "criterionId", value: "" },
      "/irrelevant",
    );
    expect(res).toEqual(emptyCompletion());
  });

  it("returns empty for a prompt argument we don't enumerate", async () => {
    const res = await complete(
      { type: "ref/prompt", name: "ra11y/vpat-narrative" },
      { name: "somethingElse", value: "" },
      "/irrelevant",
    );
    expect(res).toEqual(emptyCompletion());
  });

  it("treats a missing value as empty-prefix (no crash on undefined)", async () => {
    const res = await complete(
      { type: "ref/prompt", name: "ra11y/vpat-narrative" },
      { name: "criterionId", value: undefined as unknown as string },
      "/irrelevant",
    );
    expect(res.completion.total).toBeGreaterThan(0);
  });
});

describe("complete — ref/resource", () => {
  it("returns every KB URI when the typed value is empty", async () => {
    const dir = await makeKb();
    try {
      const res = await complete(
        { type: "ref/resource", uri: "ra11y-kb://" },
        { name: "uri", value: "" },
        dir,
      );
      expect(res.completion.total).toBe(3);
      expect(res.completion.values).toEqual([
        "ra11y-kb://wcag/1-4-11.md",
        "ra11y-kb://wcag/1-4-3.md",
        "ra11y-kb://wcag/2-4-5.md",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("substring-matches on the slug so `1-4-3` finds `ra11y-kb://wcag/1-4-3.md`", async () => {
    const dir = await makeKb();
    try {
      const res = await complete(
        { type: "ref/resource", uri: "ra11y-kb://" },
        { name: "uri", value: "1-4-3" },
        dir,
      );
      expect(res.completion.values).toEqual(["ra11y-kb://wcag/1-4-3.md"]);
      expect(res.completion.total).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns empty for non-ra11y URI schemes (file://, https://)", async () => {
    const dir = await makeKb();
    try {
      const res = await complete(
        { type: "ref/resource", uri: "file:///etc/passwd" },
        { name: "uri", value: "" },
        dir,
      );
      expect(res).toEqual(emptyCompletion());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("works when ref.uri is omitted (host passes only the value)", async () => {
    const dir = await makeKb();
    try {
      const res = await complete({ type: "ref/resource" }, { name: "uri", value: "wcag" }, dir);
      expect(res.completion.total).toBe(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("complete — unknown ref types", () => {
  it("returns empty-completion rather than erroring on ref types the spec adds later", async () => {
    const res = await complete({ type: "ref/future" }, { name: "x", value: "" }, "/irrelevant");
    expect(res).toEqual(emptyCompletion());
  });
});
