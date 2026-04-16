/**
 * Unit tests for the review/images-of-text finder (wcag22:1.4.5).
 */

import { describe, expect, it } from "bun:test";
import { finder } from "../../../src/review/finders/images-of-text.ts";
import { runFinder } from "../../helpers/run-finder.ts";

describe("review/images-of-text", () => {
  it("flags HTML img whose short alt text is repeated in surrounding text", () => {
    const source = `<a href="/sale"><img alt="Summer Sale" src="/promo.png"><span>Summer Sale</span></a>`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("surrounding text");
  });

  it("flags HTML img whose src filename suggests text artwork", () => {
    const source = `<img src="/assets/site-header-banner.png" alt="Hero">`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("src filename");
  });

  it("flags JSX img whose className suggests logo artwork", () => {
    const source = `const x = <img className="wordmark-logo" src="/brand.png" alt="Acme" />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain('class suggests "logo"');
  });

  it("flags JSX img with quoted-expression src containing a heading hint", () => {
    const source = `const x = <img src={"/images/page-heading.png"} alt="Pricing" />;`;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain('src filename suggests "heading"');
  });

  it("does not flag long alt text echoed nearby", () => {
    const source = `
      <div>
        <img alt="This banner contains more than five words" src="/hero-art.png">
        This banner contains more than five words
      </div>
    `;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });

  it("does not flag unrelated surrounding text", () => {
    const source = `<div><img alt="Download" src="/cta.png">Upload</div>`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });

  it("does not flag ordinary photos without text hints", () => {
    const source = `<img src="/photos/mountains.jpg" alt="Mountains at sunset">`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    expect(out).toEqual([]);
  });

  it("does not flag non-img JSX components", () => {
    const source = `const x = <Image className="site-logo" src="/brand.png" alt="Acme" />;`;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });

  it("emits one candidate per matching cross-standard criterion id", () => {
    const source = `<img src="/assets/site-logo.png" alt="Acme">`;
    const out = runFinder(finder, source, { filePath: "input.html" });
    const ids = new Set(out.map((candidate) => candidate.criterionId));
    expect(ids.has("wcag22:1.4.5")).toBe(true);
    expect(ids.has("wcag21:1.4.5")).toBe(true);
    expect(ids.has("section508:1.4.5")).toBe(true);
    expect(ids.has("en301549:9.1.4.5")).toBe(true);
    // 1.4.9 (AAA "no exception") shares detection with 1.4.5.
    expect(ids.has("wcag22:1.4.9")).toBe(true);
    expect(ids.has("wcag21:1.4.9")).toBe(true);
    expect(out.length).toBe(6);
  });

  describe("logotype exemption annotation", () => {
    // Per CLAUDE.md § 1 we never suppress on a spec carve-out — logos
    // are the canonical blocked example. The finder still emits the
    // candidate; the reason text carries the exemption hint so the
    // agent can verify in one read.
    it("annotates 1.4.5 (AA) with the logotype exemption hint when class=logo fires", () => {
      const out = runFinder(
        finder,
        `const x = <img className="site-logo" src="/b.png" alt="Acme" />;`,
      );
      const hit = out.find((c) => c.criterionId === "wcag22:1.4.5");
      expect(hit?.reason).toContain("logotype exemption");
    });

    it("annotates when the src filename signals a logo", () => {
      const out = runFinder(finder, `<img src="/brand-logo.svg" alt="Acme">`, {
        filePath: "x.html",
      });
      const hit = out.find((c) => c.criterionId === "wcag22:1.4.5");
      expect(hit?.reason).toContain("logotype exemption");
    });

    it("does NOT annotate 1.4.9 (AAA no-exception variant) — logos still apply at AAA", () => {
      const out = runFinder(
        finder,
        `const x = <img className="site-logo" src="/b.png" alt="Acme" />;`,
      );
      const aaa = out.find((c) => c.criterionId === "wcag22:1.4.9");
      expect(aaa?.reason).not.toContain("logotype exemption");
    });

    it("does NOT annotate when the keyword is banner/heading/title/header", () => {
      const out = runFinder(finder, `<img src="/site-banner.png" alt="Hero">`, {
        filePath: "x.html",
      });
      const hit = out.find((c) => c.criterionId === "wcag22:1.4.5");
      expect(hit?.reason).not.toContain("logotype exemption");
    });

    it("does not suppress the candidate — every logo hit still surfaces", () => {
      const out = runFinder(finder, `<img src="/brand-logo.svg" alt="Acme">`, {
        filePath: "x.html",
      });
      expect(out.length).toBeGreaterThan(0);
    });
  });
});
