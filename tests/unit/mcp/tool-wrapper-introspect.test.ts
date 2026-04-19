/**
 * Unit tests for the `wrapper_introspect` MCP tool.
 *
 * Covers the three confidence classifications the ADR names:
 *
 *   - `confirmed`: basename probe matches a file AND its first JSX
 *     root is a native-interactive element (`button`, `a`, `input`,
 *     `textarea`, `select`).
 *   - `assumed`: basename probe matches but the root is non-native
 *     (`div` → `observedRoot: "div"`, another component →
 *     `observedRoot: "opaque"`, no JSX root at all →
 *     `observedRoot: "unknown"` + `confidence: "assumed"` because the
 *     file WAS located).
 *   - `unresolved`: basename probe finds no file in the scan set;
 *     `observedRoot: "unknown"` + `definitionFile: null`.
 *
 * Plus cache behaviour (hit on repeated call with unchanged file,
 * miss after content change) and shape discipline (nextStep +
 * nextStepStructured emitted as a pair, `definitionFile` is the
 * actual path or `null` — never `""`).
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpSession } from "../../../src/mcp/session.ts";
import { wrapperIntrospectTool } from "../../../src/mcp/tool-wrapper-introspect.ts";
import {
  clearWrapperIntrospectCache,
  wrapperIntrospectCacheSize,
} from "../../../src/mcp/wrapper-introspect-cache.ts";

interface IntrospectRecord {
  readonly name: string;
  readonly definitionFile: string | null;
  readonly observedRoot: "button" | "a" | "input" | "div" | "opaque" | "unknown";
  readonly confidence: "confirmed" | "assumed" | "unresolved";
}

interface IntrospectResponse {
  readonly records: readonly IntrospectRecord[];
  readonly meta: {
    readonly scannedRoot: string;
    readonly filesScanned: number;
    readonly namesIntrospected: number;
    readonly cacheHits: number;
    readonly cacheMisses: number;
  };
  readonly nextStep: string;
  readonly nextStepStructured: { readonly tool: string; readonly args: Record<string, unknown> };
}

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-wrapper-introspect-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function callTool(
  session: McpSession,
  params: Record<string, unknown>,
): Promise<IntrospectResponse> {
  const result = await wrapperIntrospectTool.handler(params, session);
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0]?.text ?? "") as IntrospectResponse;
}

describe("wrapper_introspect: classification by observedRoot", () => {
  // Five files under one root exercise every branch in one call so the
  // tool's deterministic ordering + cache-miss tallies are observable
  // together. Each file's name maps to one classification the ADR
  // enumerates.
  it("classifies confirmed / assumed / opaque / unknown / unresolved in a single call", async () => {
    await withScratch(async (dir) => {
      // Confirmed: native <button> root.
      await writeFile(
        join(dir, "ButtonWrap.tsx"),
        "export const ButtonWrap = (p: { onClick: () => void }) => " +
          "<button onClick={p.onClick}>hi</button>;\n",
      );
      // Confirmed: native <a> root.
      await writeFile(
        join(dir, "LinkWrap.tsx"),
        "export const LinkWrap = (p: { href: string }) => <a href={p.href}>text</a>;\n",
      );
      // Confirmed: <input> root (form-control bucket collapses onto
      // `observedRoot: "input"`).
      await writeFile(
        join(dir, "TextField.tsx"),
        "export const TextField = (p: { value: string; onChange: (v: string) => void }) => " +
          "<input value={p.value} onChange={(e) => p.onChange(e.target.value)} />;\n",
      );
      // Assumed + div: the file exists, renders a <div>. Real DOM
      // element, just not interactive.
      await writeFile(
        join(dir, "DivWrap.tsx"),
        "export const DivWrap = (p: { onClick: () => void }) => " +
          "<div onClick={p.onClick}>fake button</div>;\n",
      );
      // Assumed + opaque: root is another PascalCase component. One-
      // hop discipline — we DO NOT follow through.
      await writeFile(
        join(dir, "OpaqueWrap.tsx"),
        "export const OpaqueWrap = (p: { children: unknown }) => " +
          "<ButtonWrap onClick={() => {}}>{p.children}</ButtonWrap>;\n",
      );

      const session = new McpSession();
      const body = await callTool(session, {
        cwd: dir,
        names: ["ButtonWrap", "LinkWrap", "TextField", "DivWrap", "OpaqueWrap", "MissingWrap"],
      });

      const byName = new Map(body.records.map((r) => [r.name, r]));

      expect(byName.get("ButtonWrap")).toEqual({
        name: "ButtonWrap",
        definitionFile: join(dir, "ButtonWrap.tsx"),
        observedRoot: "button",
        confidence: "confirmed",
      });
      expect(byName.get("LinkWrap")).toEqual({
        name: "LinkWrap",
        definitionFile: join(dir, "LinkWrap.tsx"),
        observedRoot: "a",
        confidence: "confirmed",
      });
      expect(byName.get("TextField")).toEqual({
        name: "TextField",
        definitionFile: join(dir, "TextField.tsx"),
        observedRoot: "input",
        confidence: "confirmed",
      });
      expect(byName.get("DivWrap")).toEqual({
        name: "DivWrap",
        definitionFile: join(dir, "DivWrap.tsx"),
        observedRoot: "div",
        confidence: "assumed",
      });
      expect(byName.get("OpaqueWrap")).toEqual({
        name: "OpaqueWrap",
        definitionFile: join(dir, "OpaqueWrap.tsx"),
        observedRoot: "opaque",
        confidence: "assumed",
      });
      // Unresolved: no file matches; `definitionFile: null` per the
      // ADR (honest "no evidence," NOT `""`).
      expect(byName.get("MissingWrap")).toEqual({
        name: "MissingWrap",
        definitionFile: null,
        observedRoot: "unknown",
        confidence: "unresolved",
      });
    });
  });

  // Guards the distinction between `unknown` (file exists but no JSX
  // root) and `opaque` (file exists, root IS JSX but not a native
  // tag). Both land on `confidence: "assumed"` but the downstream
  // signal differs — an agent routing fix work branches on
  // `observedRoot`.
  it("classifies a file with no JSX root as observedRoot: 'unknown', confidence: 'assumed'", async () => {
    await withScratch(async (dir) => {
      await writeFile(join(dir, "NoRender.tsx"), "export function NoRender() { return null; }\n");
      const session = new McpSession();
      const body = await callTool(session, { cwd: dir, names: ["NoRender"] });
      expect(body.records).toEqual([
        {
          name: "NoRender",
          definitionFile: join(dir, "NoRender.tsx"),
          observedRoot: "unknown",
          confidence: "assumed",
        },
      ]);
    });
  });

  // Guards auto-discovery: when `names` is omitted, every PascalCase
  // basename file in the scanned tree gets a record. Alphabetical
  // order for determinism.
  it("introspects every basename-matched file when `names` is omitted", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "Alpha.tsx"),
        "export const Alpha = () => <button>alpha</button>;\n",
      );
      await writeFile(join(dir, "Beta.tsx"), "export const Beta = () => <div>beta</div>;\n");
      const session = new McpSession();
      const body = await callTool(session, { cwd: dir });
      expect(body.records.map((r) => r.name)).toEqual(["Alpha", "Beta"]);
      expect(body.meta.namesIntrospected).toBe(2);
    });
  });
});

describe("wrapper_introspect: per-file-hash cache", () => {
  // Guards the cache hit path. Two back-to-back calls on the same
  // session with the same file contents: second call reports every
  // probe as a hit. The cache key is `sha256(filePath + contents)`
  // truncated to 16 hex chars (per ADR 0012).
  it("returns cached records for repeated calls on unchanged files", async () => {
    await withScratch(async (dir) => {
      await writeFile(
        join(dir, "ButtonWrap.tsx"),
        "export const ButtonWrap = () => <button>ok</button>;\n",
      );
      const session = new McpSession();
      const first = await callTool(session, { cwd: dir, names: ["ButtonWrap"] });
      const second = await callTool(session, { cwd: dir, names: ["ButtonWrap"] });

      // First call: all misses.
      expect(first.meta.cacheHits).toBe(0);
      expect(first.meta.cacheMisses).toBe(1);
      // Second call: all hits.
      expect(second.meta.cacheHits).toBe(1);
      expect(second.meta.cacheMisses).toBe(0);
      // Records identical by value.
      expect(second.records).toEqual(first.records);
      // Cache population reflects exactly one entry (one file, one
      // content-hash).
      expect(wrapperIntrospectCacheSize(session)).toBe(1);
    });
  });

  // Guards the cache miss path on content change. Same path, changed
  // contents → different hash → fresh compute. Clear the session AST
  // cache so the MCP session's parseFile re-reads from disk; the
  // introspection cache's hash check is what we're actually testing,
  // but we need the AST layer to reflect the new content first.
  it("re-computes after file contents change (natural hash invalidation)", async () => {
    await withScratch(async (dir) => {
      const filePath = join(dir, "Flipper.tsx");
      // First content: native button root.
      await writeFile(filePath, "export const Flipper = () => <button>v1</button>;\n");
      const session = new McpSession();
      const first = await callTool(session, { cwd: dir, names: ["Flipper"] });
      expect(first.records[0]?.observedRoot).toBe("button");
      expect(first.records[0]?.confidence).toBe("confirmed");
      expect(first.meta.cacheMisses).toBe(1);

      // Mutate the file — different rendered root. Sleep ~10ms to
      // ensure the mtime bumps on filesystems with second-resolution
      // timestamps (macOS HFS+ / some network FS), otherwise
      // McpSession.parseFile's mtime-keyed AST cache serves stale
      // AST and the introspection cache sees the old hash.
      await new Promise((r) => setTimeout(r, 15));
      await writeFile(filePath, "export const Flipper = () => <div>v2</div>;\n");

      const second = await callTool(session, { cwd: dir, names: ["Flipper"] });
      // Content changed → introspection cache misses → fresh compute.
      expect(second.meta.cacheMisses).toBe(1);
      expect(second.meta.cacheHits).toBe(0);
      expect(second.records[0]?.observedRoot).toBe("div");
      expect(second.records[0]?.confidence).toBe("assumed");
      // Two distinct hashes populated for the same filePath — v1
      // and v2 both cached for the session duration (no eviction).
      expect(wrapperIntrospectCacheSize(session)).toBe(2);
    });
  });

  // Guards the cache key scoping: clearing the introspection cache
  // for one session does NOT leak into the next call on a FRESH
  // session. The WeakMap-keyed store is the invariant.
  it("scopes cache entries per session — a fresh session has an empty cache", async () => {
    await withScratch(async (dir) => {
      await writeFile(join(dir, "Alpha.tsx"), "export const Alpha = () => <button>a</button>;\n");
      const sessionA = new McpSession();
      await callTool(sessionA, { cwd: dir, names: ["Alpha"] });
      expect(wrapperIntrospectCacheSize(sessionA)).toBe(1);

      const sessionB = new McpSession();
      expect(wrapperIntrospectCacheSize(sessionB)).toBe(0);
      const body = await callTool(sessionB, { cwd: dir, names: ["Alpha"] });
      // Fresh session: every record counts as a miss on first call.
      expect(body.meta.cacheMisses).toBe(1);
      expect(body.meta.cacheHits).toBe(0);

      // Defensive sanity: clearing sessionA does not affect sessionB.
      clearWrapperIntrospectCache(sessionA);
      expect(wrapperIntrospectCacheSize(sessionA)).toBe(0);
      expect(wrapperIntrospectCacheSize(sessionB)).toBe(1);
    });
  });
});

describe("wrapper_introspect: response shape discipline", () => {
  // Guards the nextStep pair: prose + structured emit together, never
  // alone. Every code path in `buildNextStep` must set both.
  it("emits nextStep and nextStepStructured as a pair on every response", async () => {
    await withScratch(async (dir) => {
      await writeFile(join(dir, "Alpha.tsx"), "export const Alpha = () => <button>a</button>;\n");
      const session = new McpSession();
      const body = await callTool(session, { cwd: dir, names: ["Alpha"] });
      expect(typeof body.nextStep).toBe("string");
      expect(body.nextStep.length).toBeGreaterThan(0);
      expect(typeof body.nextStepStructured.tool).toBe("string");
      expect(body.nextStepStructured.tool.length).toBeGreaterThan(0);
    });
  });

  // Guards the "all confirmed" nextStep branch → `propose_config`.
  it("routes to propose_config when every record is confirmed", async () => {
    await withScratch(async (dir) => {
      await writeFile(join(dir, "Alpha.tsx"), "export const Alpha = () => <button>a</button>;\n");
      const session = new McpSession();
      const body = await callTool(session, { cwd: dir, names: ["Alpha"] });
      expect(body.nextStepStructured.tool).toBe("propose_config");
      expect(body.nextStep).toContain("propose_config");
    });
  });

  // Guards the "mixed" nextStep branch → `detect_native_wrappers`.
  it("routes to detect_native_wrappers when confidence is mixed", async () => {
    await withScratch(async (dir) => {
      await writeFile(join(dir, "Alpha.tsx"), "export const Alpha = () => <button>a</button>;\n");
      await writeFile(join(dir, "Beta.tsx"), "export const Beta = () => <div>b</div>;\n");
      const session = new McpSession();
      const body = await callTool(session, {
        cwd: dir,
        names: ["Alpha", "Beta"],
      });
      expect(body.nextStepStructured.tool).toBe("detect_native_wrappers");
    });
  });

  // Guards the `definitionFile: null` invariant on unresolved — no
  // `""` sentinel, no missing field, just honest null.
  it("emits definitionFile: null (not '') for unresolved names", async () => {
    await withScratch(async (dir) => {
      const session = new McpSession();
      const body = await callTool(session, {
        cwd: dir,
        names: ["NowhereToBeFound"],
      });
      expect(body.records[0]?.definitionFile).toBeNull();
      // Guard against the regression where `""` slips in as a sentinel.
      expect(body.records[0]?.definitionFile).not.toBe("");
    });
  });

  // Guards the cwd-not-found error envelope — distinct from a
  // successful zero-files response (which would be the silent-failure
  // shape CLAUDE.md §1 warns against).
  it("hard-errors with code cwd-not-found when cwd does not exist", async () => {
    const session = new McpSession();
    const result = await wrapperIntrospectTool.handler(
      { cwd: "/nonexistent/ra11y-wrapper-introspect/does-not-exist-xyz" },
      session,
    );
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      readonly code?: string;
    };
    expect(payload.code).toBe("cwd-not-found");
  });
});
