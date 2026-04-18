/**
 * Unit tests for the review/flashing-content finder (wcag22:2.3.1 +
 * wcag21:2.3.1 — Three Flashes or Below Threshold).
 *
 * Four signal classes are exercised:
 *   - <video autoplay> in HTML and JSX
 *   - requestAnimationFrame() in JS/TS
 *   - short-cycle CSS @keyframes animations (≤333ms) without a
 *     prefers-reduced-motion guard, mutating opacity/transform/colour
 *   - legacy <marquee> / <blink> tags
 *
 * Fixtures under tests/fixtures/review/flashing-content/ cover larger
 * HTML and CSS shapes; inline snippets exercise narrower edge cases.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { finder } from "../../../../src/review/finders/flashing-content.ts";
import type { ReviewCandidate } from "../../../../src/types/review.ts";
import { runFinder } from "../../../helpers/run-finder.ts";

const FIXTURE_ROOT = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "fixtures",
  "review",
  "flashing-content",
);

function loadFixture(kind: "good" | "bad" | "edge", name: string): string {
  return readFileSync(join(FIXTURE_ROOT, kind, name), "utf8");
}

function reasons(candidates: readonly ReviewCandidate[]): readonly string[] {
  return candidates.map((c) => c.reason);
}

describe("review/flashing-content — <video autoplay>", () => {
  it("flags an HTML <video autoplay> as a 2.3.1 review candidate", () => {
    const source = loadFixture("bad", "autoplay-video.html");
    const out = runFinder(finder, source, { filePath: "hero.html" });
    expect(out.length).toBeGreaterThan(0);
    const videoCandidates = out.filter((c) => c.reason.includes("<video autoplay>"));
    expect(videoCandidates.length).toBe(2); // wcag22 + wcag21
    expect(videoCandidates.map((c) => c.criterionId).sort()).toEqual([
      "wcag21:2.3.1",
      "wcag22:2.3.1",
    ]);
    expect(videoCandidates[0]?.confidence).toBe("medium");
  });

  it("flags a JSX <video autoPlay /> (camelCase React form)", () => {
    const source = `
      export function Hero() {
        return <video autoPlay muted loop src="hero.mp4" />;
      }
    `;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("<video autoplay>");
  });

  it("flags JSX <video autoPlay={shouldPlay} /> (dynamic expression, conservative truthy)", () => {
    const source = `
      export function Hero({ shouldPlay }: { shouldPlay: boolean }) {
        return <video autoPlay={shouldPlay} muted />;
      }
    `;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
  });

  it("does NOT flag JSX <video autoPlay={false} /> (explicit off)", () => {
    const source = `
      export function Hero() {
        return <video autoPlay={false} controls />;
      }
    `;
    const out = runFinder(finder, source);
    // No autoplay flash signal — no candidate.
    expect(out.filter((c) => c.reason.includes("<video autoplay>"))).toEqual([]);
  });

  it("does not flag a <video> without autoplay (user-initiated playback)", () => {
    const source = loadFixture("good", "static-hero.html");
    const out = runFinder(finder, source, { filePath: "hero.html" });
    expect(out).toEqual([]);
  });
});

describe("review/flashing-content — legacy <marquee> / <blink>", () => {
  it("flags <marquee> and <blink> in HTML as 2.3.1 candidates", () => {
    const source = loadFixture("bad", "legacy-tags.html");
    const out = runFinder(finder, source, { filePath: "legacy.html" });
    const marquee = out.filter((c) => c.reason.includes("<marquee>"));
    const blink = out.filter((c) => c.reason.includes("<blink>"));
    expect(marquee.length).toBe(2); // wcag22 + wcag21
    expect(blink.length).toBe(2);
    expect(marquee[0]?.confidence).toBe("high");
    expect(blink[0]?.confidence).toBe("high");
  });

  it("flags lowercase <marquee> in JSX (React passes unknown tags through to HTML)", () => {
    const source = `
      export function Legacy() {
        return <marquee>scroll</marquee>;
      }
    `;
    const out = runFinder(finder, source);
    expect(reasons(out).some((r) => r.includes("<marquee>"))).toBe(true);
  });
});

describe("review/flashing-content — requestAnimationFrame", () => {
  it("flags a requestAnimationFrame() call and notes no reduced-motion check is seen", () => {
    const source = `
      function draw() {
        requestAnimationFrame(draw);
        ctx.fillRect(0, 0, 100, 100);
      }
      draw();
    `;
    const out = runFinder(finder, source);
    expect(out.length).toBeGreaterThan(0);
    const rafCandidates = out.filter((c) => c.reason.includes("requestAnimationFrame"));
    expect(rafCandidates.length).toBe(2);
    expect(rafCandidates[0]?.reason).toContain(
      "no matchMedia('prefers-reduced-motion: reduce') check seen",
    );
    expect(rafCandidates[0]?.confidence).toBe("medium");
  });

  it("still flags rAF when matchMedia('prefers-reduced-motion') appears — just changes the reason note", () => {
    const source = `
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduce) requestAnimationFrame(paint);
    `;
    const out = runFinder(finder, source);
    const rafCandidates = out.filter((c) => c.reason.includes("requestAnimationFrame"));
    expect(rafCandidates.length).toBeGreaterThan(0);
    // Per doctrine: surface anyway; encode the observed signal as additive
    // context. A matchMedia check can be present and wrong (inverted, or
    // not guarding the actual rAF loop) — the agent verifies.
    expect(rafCandidates[0]?.reason).toContain(
      "matchMedia('prefers-reduced-motion: reduce') check appears",
    );
    expect(rafCandidates[0]?.reason).toContain("confirm the animation loop actually honours it");
  });

  it("deduplicates offsets when the same rAF call appears once", () => {
    const source = `requestAnimationFrame(step);`;
    const out = runFinder(finder, source, { filePath: "input.js" });
    const rafCandidates = out.filter((c) => c.reason.includes("requestAnimationFrame"));
    expect(rafCandidates.length).toBe(2); // one location × two criteria
  });

  it("does NOT flag a file with no rAF / no autoplay video / no marquee", () => {
    const source = `
      export function Button({ onClick }: { onClick: () => void }) {
        return <button onClick={onClick}>Click me</button>;
      }
    `;
    const out = runFinder(finder, source);
    expect(out).toEqual([]);
  });
});

describe("review/flashing-content — CSS @keyframes short cycle", () => {
  it("flags a 250ms opacity pulse not guarded by prefers-reduced-motion", () => {
    const source = loadFixture("bad", "fast-opacity-pulse.css");
    const out = runFinder(finder, source, { filePath: "styles.css" });
    expect(out.length).toBeGreaterThan(0);
    const reason = out[0]?.reason ?? "";
    expect(reason).toContain("'.alert-banner'");
    expect(reason).toContain("animation 'pulse'");
    expect(reason).toContain("opacity");
    expect(reason).toContain("250ms");
    expect(reason).toContain("4.0 cycles/s");
    expect(out[0]?.confidence).toBe("medium");
  });

  it("flags an animation-duration: 200ms declaration (sibling-decl shorthand)", () => {
    const source = `
      @keyframes strobe {
        0% { opacity: 1; }
        100% { opacity: 0; }
      }
      .warn {
        animation-name: strobe;
        animation-duration: 200ms;
      }
    `;
    const out = runFinder(finder, source, { filePath: "styles.css" });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("200ms");
  });

  it("flags a 0.3s transform keyframe animation (converts to 300ms; ≤333ms threshold)", () => {
    const source = `
      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        50% { transform: translateX(8px); }
      }
      .shake { animation: shake 0.3s infinite; }
    `;
    const out = runFinder(finder, source, { filePath: "styles.css" });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("transform");
    expect(out[0]?.reason).toContain("300ms");
  });

  it("does NOT flag animations inside @media (prefers-reduced-motion: reduce)", () => {
    const source = `
      @keyframes pulse { 0% { opacity: 1; } 100% { opacity: 0; } }
      @media (prefers-reduced-motion: reduce) {
        .alert { animation: pulse 200ms infinite; }
      }
    `;
    const out = runFinder(finder, source, { filePath: "styles.css" });
    expect(out).toEqual([]);
  });

  it("does NOT flag animations inside @media (prefers-reduced-motion: no-preference) either — guard intent is present", () => {
    const source = loadFixture("good", "guarded-fast-pulse.css");
    const out = runFinder(finder, source, { filePath: "styles.css" });
    expect(out).toEqual([]);
  });

  it("does NOT flag a slow animation (2s cycle = 0.5Hz, well under the ≤333ms threshold)", () => {
    const source = loadFixture("good", "slow-fade.css");
    const out = runFinder(finder, source, { filePath: "styles.css" });
    expect(out).toEqual([]);
  });

  it("does NOT flag a short animation whose keyframes only mutate non-flash properties (e.g. width)", () => {
    const source = `
      @keyframes grow {
        0% { width: 10px; }
        100% { width: 200px; }
      }
      .bar { animation: grow 200ms linear; }
    `;
    const out = runFinder(finder, source, { filePath: "styles.css" });
    // Pure width/geometry animation has no flash-perception signal —
    // finder skips when the referenced @keyframes mutates only
    // non-flash properties it can verify.
    expect(out).toEqual([]);
  });

  it("surfaces an animation whose keyframes are not in this file (unknown-name edge case)", () => {
    const source = loadFixture("edge", "unknown-keyframe-name.css");
    const out = runFinder(finder, source, { filePath: "styles.css" });
    // Per doctrine: surface when evidence is thin but points at real
    // code — the reviewer opens the file; we do not suppress on missing
    // keyframe info. Confidence is still medium; reason names the
    // duration so the reviewer can verify the physical rate.
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toContain("200ms");
  });
});

describe("review/flashing-content — emission discipline", () => {
  it("cites BOTH wcag22:2.3.1 and wcag21:2.3.1 on every candidate", () => {
    const source = `<marquee>news</marquee>`;
    const out = runFinder(finder, source, { filePath: "x.html" });
    const ids = new Set(out.map((c) => c.criterionId));
    expect(ids.has("wcag22:2.3.1")).toBe(true);
    expect(ids.has("wcag21:2.3.1")).toBe(true);
  });

  it("points every candidate at a file:line:column that exists", () => {
    const source = [
      "<!doctype html>",
      "<html><body>",
      "  <marquee>scroll</marquee>",
      "</body></html>",
    ].join("\n");
    const out = runFinder(finder, source, { filePath: "page.html" });
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      expect(c.location.filePath).toBe("page.html");
      expect(c.location.line).toBeGreaterThan(0);
      expect(c.location.column).toBeGreaterThan(0);
    }
  });

  it("declares scope 'node' and applies to the expected file extensions", () => {
    expect(finder.scope).toBe("node");
    expect(finder.appliesTo?.fileExtensions).toContain(".html");
    expect(finder.appliesTo?.fileExtensions).toContain(".css");
    expect(finder.appliesTo?.fileExtensions).toContain(".tsx");
    expect(finder.appliesTo?.fileExtensions).toContain(".jsx");
    expect(finder.appliesTo?.fileExtensions).toContain(".ts");
    expect(finder.appliesTo?.fileExtensions).toContain(".js");
  });

  it("lists both criterion IDs on the finder metadata", () => {
    expect(finder.criterionIds).toContain("wcag22:2.3.1");
    expect(finder.criterionIds).toContain("wcag21:2.3.1");
  });
});
