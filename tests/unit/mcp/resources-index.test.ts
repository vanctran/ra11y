/**
 * Unit tests for `src/mcp/resources/index.ts` — the `ra11y-kb://` resource
 * surface: `loadKbResources` walks `docs/kb/**` under the given cwd, and
 * `readKbResource` resolves a URI back to disk with path-traversal
 * defences.
 *
 * Tests touch a scratch directory so the filesystem walk is real. The
 * frontmatter / heading / paragraph extraction invariants are validated
 * via the listed resource metadata, and the scheme / dotdot / escape /
 * not-found error modes each get a dedicated case driving the real
 * `readKbResource` path.
 */

import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  INVALID_RESOURCE_URI,
  loadKbResources,
  RESOURCE_NOT_FOUND,
  ResourceError,
  readKbResource,
} from "../../../src/mcp/resources/index.ts";

async function makeKb(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ra11y-resources-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, "docs", "kb", rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, body, "utf8");
  }
  return dir;
}

describe("loadKbResources", () => {
  it("returns an empty list when docs/kb does not exist under cwd (fresh repo)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra11y-resources-"));
    try {
      const resources = await loadKbResources(dir);
      expect(resources).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("advertises every markdown file with a stable ra11y-kb:// URI sorted by URI", async () => {
    const dir = await makeKb({
      "wcag/1-4-3.md": "# Contrast (minimum)\n\nText must stand out.\n",
      "wcag/1-1-1.md": "# Non-text content\n",
      "rules/media.md": "# Media rules\n",
    });
    try {
      const resources = await loadKbResources(dir);
      expect(resources.map((r) => r.uri)).toEqual([
        "ra11y-kb://rules/media.md",
        "ra11y-kb://wcag/1-1-1.md",
        "ra11y-kb://wcag/1-4-3.md",
      ]);
      expect(resources[0]?.mimeType).toBe("text/markdown");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("derives `name` from the first `# ` heading and `description` from the following paragraph", async () => {
    const dir = await makeKb({
      "wcag/1-4-3.md": "\n# Contrast\n\nText must have a 4.5:1 ratio.\n",
    });
    try {
      const resources = await loadKbResources(dir);
      expect(resources[0]?.name).toBe("Contrast");
      expect(resources[0]?.description).toBe("Text must have a 4.5:1 ratio.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("prefers frontmatter `title` and `description` over the body heading when both exist", async () => {
    const dir = await makeKb({
      "entry.md":
        '---\ntitle: "Frontmatter wins"\ndescription: "from fm"\n---\n\n# Body heading\n\nBody paragraph.\n',
    });
    try {
      const [resource] = await loadKbResources(dir);
      expect(resource?.name).toBe("Frontmatter wins");
      expect(resource?.description).toBe("from fm");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the basename when neither frontmatter title nor a body heading is present", async () => {
    const dir = await makeKb({ "loose/no-heading.md": "Just a paragraph.\n" });
    try {
      const [resource] = await loadKbResources(dir);
      expect(resource?.name).toBe("no-heading");
      expect(resource?.description).toBe("Just a paragraph.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("omits `description` when no usable text can be derived (present-when-meaningful)", async () => {
    const dir = await makeKb({ "empty.md": "# Title only\n" });
    try {
      const [resource] = await loadKbResources(dir);
      expect(resource?.description).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("strips inline markdown (backticks, emphasis, links) from `name` and `description`", async () => {
    const dir = await makeKb({
      "styled.md": "# `code` and *emphasis*\n\nSee [spec](https://example.com/) for details.\n",
    });
    try {
      const [resource] = await loadKbResources(dir);
      expect(resource?.name).toBe("code and emphasis");
      expect(resource?.description).toBe("See spec for details.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips bullet lists when searching for the first paragraph (not a real sentence fallback)", async () => {
    const dir = await makeKb({
      "bullets.md": "# Title\n\n- item one\n- item two\n\nActual paragraph here.\n",
    });
    try {
      const [resource] = await loadKbResources(dir);
      expect(resource?.description).toBe("Actual paragraph here.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores malformed frontmatter (no closing fence) and treats the file as plain markdown", async () => {
    const dir = await makeKb({
      "broken.md": "---\ntitle: unclosed\n\n# Real heading\n\nbody\n",
    });
    try {
      const [resource] = await loadKbResources(dir);
      expect(resource?.name).not.toBe("unclosed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("readKbResource", () => {
  it("returns the file contents plus the URI and mimeType for a valid ra11y-kb:// URI", async () => {
    const dir = await makeKb({ "wcag/1-4-3.md": "# Contrast\n\nBody." });
    try {
      const content = await readKbResource(dir, "ra11y-kb://wcag/1-4-3.md");
      expect(content.uri).toBe("ra11y-kb://wcag/1-4-3.md");
      expect(content.mimeType).toBe("text/markdown");
      expect(content.text).toContain("# Contrast");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws ResourceError(INVALID_RESOURCE_URI) for non-ra11y schemes", async () => {
    try {
      await readKbResource("/proj", "file:///etc/passwd");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ResourceError);
      expect((err as ResourceError).code).toBe(INVALID_RESOURCE_URI);
    }
  });

  it("throws ResourceError(INVALID_RESOURCE_URI) for an empty path", async () => {
    try {
      await readKbResource("/proj", "ra11y-kb://");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as ResourceError).code).toBe(INVALID_RESOURCE_URI);
      expect((err as ResourceError).message).toContain("Empty resource path");
    }
  });

  it("throws ResourceError(INVALID_RESOURCE_URI) for URIs with a .. segment", async () => {
    try {
      await readKbResource("/proj", "ra11y-kb://wcag/../../etc/passwd");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as ResourceError).code).toBe(INVALID_RESOURCE_URI);
      expect((err as ResourceError).message).toContain("Path traversal rejected");
    }
  });

  it("throws ResourceError for a non-string uri (defensive against host misuse)", async () => {
    try {
      await readKbResource("/proj", 123 as unknown as string);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as ResourceError).code).toBe(INVALID_RESOURCE_URI);
    }
  });

  it("throws ResourceError(RESOURCE_NOT_FOUND) when the URI points at a missing file", async () => {
    const dir = await makeKb({ "exists.md": "# A\n" });
    try {
      try {
        await readKbResource(dir, "ra11y-kb://missing.md");
        throw new Error("expected throw");
      } catch (err) {
        expect((err as ResourceError).code).toBe(RESOURCE_NOT_FOUND);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("ResourceError", () => {
  it("carries both a JSON-RPC-compatible code and a human-readable message", () => {
    const err = new ResourceError(INVALID_RESOURCE_URI, "bad uri");
    expect(err.name).toBe("ResourceError");
    expect(err.code).toBe(INVALID_RESOURCE_URI);
    expect(err.message).toBe("bad uri");
    expect(err).toBeInstanceOf(Error);
  });
});
