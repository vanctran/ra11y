/**
 * Process primitive validation + normalization tests.
 *
 * The `processes` field is how users declare explicit, ordered page
 * sets for process-level WCAG criteria (3.2.3, 3.2.4, 2.4.5). These
 * criteria cannot be evaluated from a single page in isolation — the
 * config primitive is the deterministic evidence source downstream
 * finders and the conformance-statement generator consume.
 *
 * The loader policy on malformed config (stderr warn + fall back to
 * DEFAULT_CONFIG) applies here too: invalid `processes` declarations
 * do not crash ra11y; they make the loader emit an error message to
 * stderr and return defaults (`processes: []`), which in turn makes
 * process-level criteria report as `absent` rather than silently
 * clean. Tests capture stderr to assert the specific rejection
 * message while verifying the fall-back shape the rest of the scanner
 * receives.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_CONFIG } from "../../../src/config/defaults.ts";
import { loadConfig } from "../../../src/config/loader.ts";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "ra11y-config-processes-"));
}

interface StderrCapture {
  readonly restore: () => void;
  readonly output: () => string;
}

function captureStderr(): StderrCapture {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  // biome-ignore lint/suspicious/noExplicitAny: test-only stderr monkeypatch
  (process.stderr as any).write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  return {
    restore: () => {
      // biome-ignore lint/suspicious/noExplicitAny: test-only stderr monkeypatch
      (process.stderr as any).write = original;
    },
    output: () => chunks.join(""),
  };
}

describe("loadConfig processes primitive", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults processes to [] when the field is absent", async () => {
    writeFileSync(join(dir, "ra11y.config.json"), JSON.stringify({}));
    const loaded = await loadConfig({ cwd: dir });
    expect(loaded.processes).toEqual([]);
  });

  it("uses DEFAULT_CONFIG.processes ([]) when no config file exists", async () => {
    const loaded = await loadConfig({ cwd: dir });
    expect(loaded.processes).toEqual([]);
    expect(DEFAULT_CONFIG.processes).toEqual([]);
  });

  it("accepts an explicit empty processes: [] without error", async () => {
    const cap = captureStderr();
    try {
      writeFileSync(join(dir, "ra11y.config.json"), JSON.stringify({ processes: [] }));
      const loaded = await loadConfig({ cwd: dir });
      expect(loaded.processes).toEqual([]);
      // Empty array is a valid shape — no stderr diagnostic should fire.
      expect(cap.output()).not.toContain("processes");
    } finally {
      cap.restore();
    }
  });

  it("round-trips a valid single-process declaration verbatim", async () => {
    const pages = [
      "src/pages/checkout/cart.tsx",
      "src/pages/checkout/shipping.tsx",
      "src/pages/checkout/confirm.tsx",
    ];
    writeFileSync(
      join(dir, "ra11y.config.json"),
      JSON.stringify({ processes: [{ name: "checkout", pages }] }),
    );
    const loaded = await loadConfig({ cwd: dir });
    expect(loaded.processes.length).toBe(1);
    const checkout = loaded.processes[0];
    expect(checkout).toBeDefined();
    if (checkout === undefined) return;
    expect(checkout.name).toBe("checkout");
    expect([...checkout.pages]).toEqual(pages);
  });

  it("preserves the order of pages exactly as declared", async () => {
    // Explicit order is load-bearing — alphabetical order is not
    // navigation order. See ADR 0016.
    const pages = ["src/c.tsx", "src/a.tsx", "src/b.tsx"];
    writeFileSync(
      join(dir, "ra11y.config.json"),
      JSON.stringify({ processes: [{ name: "signup", pages }] }),
    );
    const loaded = await loadConfig({ cwd: dir });
    const entry = loaded.processes[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect([...entry.pages]).toEqual(pages);
  });

  it("accepts multiple distinct processes", async () => {
    writeFileSync(
      join(dir, "ra11y.config.json"),
      JSON.stringify({
        processes: [
          { name: "checkout", pages: ["src/pages/checkout/cart.tsx"] },
          { name: "account", pages: ["src/pages/account/profile.tsx"] },
        ],
      }),
    );
    const loaded = await loadConfig({ cwd: dir });
    expect(loaded.processes.map((p) => p.name)).toEqual(["checkout", "account"]);
  });

  it("rejects duplicate process names with a clear stderr diagnostic", async () => {
    const cap = captureStderr();
    try {
      writeFileSync(
        join(dir, "ra11y.config.json"),
        JSON.stringify({
          processes: [
            { name: "checkout", pages: ["a.tsx"] },
            { name: "checkout", pages: ["b.tsx"] },
          ],
        }),
      );
      const loaded = await loadConfig({ cwd: dir });
      expect(loaded.processes).toEqual([]);
      const err = cap.output();
      expect(err).toContain("processes[1].name");
      expect(err).toContain("duplicates");
      expect(err).toContain("checkout");
    } finally {
      cap.restore();
    }
  });

  it("rejects an empty pages array with a clear stderr diagnostic", async () => {
    const cap = captureStderr();
    try {
      writeFileSync(
        join(dir, "ra11y.config.json"),
        JSON.stringify({ processes: [{ name: "checkout", pages: [] }] }),
      );
      const loaded = await loadConfig({ cwd: dir });
      expect(loaded.processes).toEqual([]);
      const err = cap.output();
      expect(err).toContain("processes[0].pages");
      expect(err).toContain("empty");
    } finally {
      cap.restore();
    }
  });

  it("rejects an empty name with a clear stderr diagnostic", async () => {
    const cap = captureStderr();
    try {
      writeFileSync(
        join(dir, "ra11y.config.json"),
        JSON.stringify({ processes: [{ name: "", pages: ["a.tsx"] }] }),
      );
      const loaded = await loadConfig({ cwd: dir });
      expect(loaded.processes).toEqual([]);
      const err = cap.output();
      expect(err).toContain("processes[0].name");
      expect(err).toContain("non-empty");
    } finally {
      cap.restore();
    }
  });

  it("rejects a non-string page entry with a clear stderr diagnostic", async () => {
    const cap = captureStderr();
    try {
      writeFileSync(
        join(dir, "ra11y.config.json"),
        JSON.stringify({
          processes: [{ name: "checkout", pages: ["a.tsx", 42, "b.tsx"] }],
        }),
      );
      const loaded = await loadConfig({ cwd: dir });
      expect(loaded.processes).toEqual([]);
      const err = cap.output();
      expect(err).toContain("processes[0].pages[1]");
      expect(err).toContain("non-empty string");
    } finally {
      cap.restore();
    }
  });

  it("rejects an empty-string page entry with a clear stderr diagnostic", async () => {
    const cap = captureStderr();
    try {
      writeFileSync(
        join(dir, "ra11y.config.json"),
        JSON.stringify({
          processes: [{ name: "checkout", pages: ["a.tsx", ""] }],
        }),
      );
      const loaded = await loadConfig({ cwd: dir });
      expect(loaded.processes).toEqual([]);
      const err = cap.output();
      expect(err).toContain("processes[0].pages[1]");
    } finally {
      cap.restore();
    }
  });

  it("rejects a non-array processes value with a clear stderr diagnostic", async () => {
    const cap = captureStderr();
    try {
      writeFileSync(
        join(dir, "ra11y.config.json"),
        JSON.stringify({ processes: { name: "oops", pages: ["a.tsx"] } }),
      );
      const loaded = await loadConfig({ cwd: dir });
      expect(loaded.processes).toEqual([]);
      expect(cap.output()).toContain("processes must be an array");
    } finally {
      cap.restore();
    }
  });

  it("rejects a non-object process entry with a clear stderr diagnostic", async () => {
    const cap = captureStderr();
    try {
      writeFileSync(join(dir, "ra11y.config.json"), JSON.stringify({ processes: ["checkout"] }));
      const loaded = await loadConfig({ cwd: dir });
      expect(loaded.processes).toEqual([]);
      expect(cap.output()).toContain("processes[0]");
    } finally {
      cap.restore();
    }
  });
});
