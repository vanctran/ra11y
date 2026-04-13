/**
 * Config loader precedence + discovery tests. The loader is the
 * single gate every config-related feature sits behind, so the
 * precedence order (explicit > env > walk > defaults) gets a
 * golden test per branch.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_CONFIG } from "../../../src/config/defaults.ts";
import { loadConfig } from "../../../src/config/loader.ts";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "ra11y-config-"));
}

describe("loadConfig precedence", () => {
  let dir: string;
  const savedEnv = process.env["RA11Y_CONFIG"];

  beforeEach(() => {
    dir = makeTmpDir();
    delete process.env["RA11Y_CONFIG"];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedEnv === undefined) {
      delete process.env["RA11Y_CONFIG"];
    } else {
      process.env["RA11Y_CONFIG"] = savedEnv;
    }
  });

  it("returns DEFAULT_CONFIG when no config exists and skip is true", async () => {
    const loaded = await loadConfig({ skip: true });
    expect(loaded).toEqual(DEFAULT_CONFIG);
  });

  it("returns DEFAULT_CONFIG-shaped result when no config file is found", async () => {
    const loaded = await loadConfig({ cwd: dir });
    // Discovery failure returns defaults; sourcePath may be null
    // (explicit "we looked and found none") or undefined.
    expect(loaded.sourcePath ?? null).toBe(null);
    expect(loaded.level).toBe(DEFAULT_CONFIG.level);
  });

  it("loads a ra11y.config.json in cwd", async () => {
    writeFileSync(
      join(dir, "ra11y.config.json"),
      JSON.stringify({ standards: ["wcag21"], level: "AA" }),
    );
    const loaded = await loadConfig({ cwd: dir });
    expect(loaded.sourcePath).toContain("ra11y.config.json");
    expect(loaded.standards).toEqual(["wcag21"]);
  });

  it("walks up the directory tree to find a config", async () => {
    writeFileSync(
      join(dir, "ra11y.config.json"),
      JSON.stringify({ standards: ["wcag22"], level: "AAA" }),
    );
    const nested = join(dir, "packages", "app");
    mkdirSync(nested, { recursive: true });
    const loaded = await loadConfig({ cwd: nested });
    expect(loaded.level).toBe("AAA");
  });

  it("explicit configPath wins over the walk-up result", async () => {
    writeFileSync(
      join(dir, "ra11y.config.json"),
      JSON.stringify({ standards: ["wcag22"], level: "A" }),
    );
    const explicit = join(dir, "other.json");
    writeFileSync(explicit, JSON.stringify({ standards: ["wcag21"], level: "AAA" }));
    const loaded = await loadConfig({ cwd: dir, configPath: explicit });
    expect(loaded.level).toBe("AAA");
    expect(loaded.standards).toEqual(["wcag21"]);
  });

  it("RA11Y_CONFIG env var wins over walk-up", async () => {
    writeFileSync(
      join(dir, "ra11y.config.json"),
      JSON.stringify({ standards: ["wcag22"], level: "A" }),
    );
    const alt = join(dir, "env.json");
    writeFileSync(alt, JSON.stringify({ standards: ["wcag21"], level: "AA" }));
    process.env["RA11Y_CONFIG"] = alt;
    const loaded = await loadConfig({ cwd: dir });
    expect(loaded.level).toBe("AA");
    expect(loaded.standards).toEqual(["wcag21"]);
  });

  it("explicit configPath wins over RA11Y_CONFIG", async () => {
    const envPath = join(dir, "env.json");
    const explicitPath = join(dir, "explicit.json");
    writeFileSync(envPath, JSON.stringify({ level: "A" }));
    writeFileSync(explicitPath, JSON.stringify({ level: "AAA" }));
    process.env["RA11Y_CONFIG"] = envPath;
    const loaded = await loadConfig({ cwd: dir, configPath: explicitPath });
    expect(loaded.level).toBe("AAA");
  });

  it("falls back to defaults when config file is malformed", async () => {
    writeFileSync(join(dir, "ra11y.config.json"), "{ not valid json");
    const loaded = await loadConfig({ cwd: dir });
    // sourcePath is set even on parse failure — signals "we tried".
    expect(loaded.sourcePath).toContain("ra11y.config.json");
    expect(loaded.level).toBe(DEFAULT_CONFIG.level);
  });
});
