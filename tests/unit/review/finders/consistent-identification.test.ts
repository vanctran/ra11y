/**
 * Unit tests for the review/consistent-identification finder
 * (wcag22:3.2.4).
 *
 * The finder is process-aware from the start — it reads
 * `ProjectCandidateContext.processes` threaded through `ScanInputs` and
 * emits zero candidates when no `processes` config is declared (ADR
 * 0016). These tests drive the finder through `runScan` with multiple
 * ParsedFiles + an explicit `processes` list so the cross-page
 * divergence logic is exercised end-to-end.
 */

import { describe, expect, it } from "bun:test";
import { type ParsedFile, runScan } from "../../../../src/engine/scanner.ts";
import { parseHtml, parseTsx } from "../../../../src/input/parsers/index.ts";
import { finder } from "../../../../src/review/finders/consistent-identification.ts";
import { wcag22 } from "../../../../src/standards/wcag22/standard.ts";
import type { Process } from "../../../../src/types/config.ts";
import type { ReviewCandidate } from "../../../../src/types/review.ts";

function htmlFile(filePath: string, source: string): ParsedFile {
  const r = parseHtml(source);
  return { filePath, source, ast: { language: "html", root: r.root, errors: r.errors } };
}

function tsxFile(filePath: string, source: string): ParsedFile {
  const r = parseTsx(source);
  return { filePath, source, ast: { language: "tsx", root: r.root, errors: r.errors } };
}

function runWith(
  files: readonly ParsedFile[],
  processes?: readonly Process[],
): readonly ReviewCandidate[] {
  const { report } = runScan({
    standards: [wcag22],
    rules: [],
    enabled: ["wcag22"],
    files,
    finders: [finder],
    ...(processes === undefined ? {} : { processes }),
  });
  return (report.candidates ?? []).filter((c) => c.criterionId === "wcag22:3.2.4");
}

describe("review/consistent-identification (no processes config)", () => {
  // Guards the ADR 0016 "honest failure" invariant: without a declared
  // `processes` config the finder has no deterministic page set to
  // evaluate across, and the AI-first doctrine rejects heuristic
  // fallback (path patterns are a guess, not evidence). Zero candidates
  // is the honest output; the conformance-statement layer converts
  // that absence into an `absent` verdict, not silent `pass`.
  it("emits zero candidates when no processes config is provided", () => {
    const a = htmlFile(
      "/p/cart.html",
      `<html><body><button aria-label="Submit payment">Submit</button></body></html>`,
    );
    const b = htmlFile(
      "/p/payment.html",
      `<html><body><button aria-label="Submit payment">Send</button></body></html>`,
    );
    // No `processes` passed — the finder must not fall back to pattern
    // discovery across the file tree.
    expect(runWith([a, b])).toEqual([]);
  });

  // Guards the same invariant when the config primitive is present but
  // structurally empty — `[]` is treated identically to "unset," per
  // the `ProjectCandidateContext.processes` doctrine.
  it("emits zero candidates when processes is an empty list", () => {
    const a = htmlFile(
      "/p/cart.html",
      `<html><body><button aria-label="Submit payment">Submit</button></body></html>`,
    );
    const b = htmlFile(
      "/p/payment.html",
      `<html><body><button aria-label="Submit payment">Send</button></body></html>`,
    );
    expect(runWith([a, b], [])).toEqual([]);
  });
});

describe("review/consistent-identification (positive — should flag)", () => {
  // Guards the core 3.2.4 failure mode: same identifier (aria-label)
  // across two process pages, divergent visible labels. This is the
  // canonical shape the finder must not miss.
  it("flags two pages with matching aria-label and divergent visible text", () => {
    const a = htmlFile(
      "/p/cart.html",
      `<html><body><button aria-label="Submit payment">Submit</button></body></html>`,
    );
    const b = htmlFile(
      "/p/payment.html",
      `<html><body><button aria-label="Submit payment">Pay now</button></body></html>`,
    );
    const processes: readonly Process[] = [
      { name: "checkout", pages: ["/p/cart.html", "/p/payment.html"] },
    ];
    const candidates = runWith([a, b], processes);
    expect(candidates.length).toBe(1);
    const [c] = candidates;
    expect(c?.location.filePath).toBe("/p/cart.html");
    expect(c?.reason).toContain("`submit`");
    expect(c?.reason).toContain("`pay now`");
    expect(c?.reason).toContain("checkout");
    expect(c?.reason).toContain("aria-label");
  });

  // Guards that the cross-standard criterion IDs (wcag21, section508,
  // en301549) all get emitted so VPAT coverage reports surface the
  // candidate under every framework that references SC 3.2.4.
  it("emits one candidate per matching criterion id across standards", () => {
    const a = htmlFile(
      "/p/cart.html",
      `<html><body><button aria-label="Submit payment">Submit</button></body></html>`,
    );
    const b = htmlFile(
      "/p/payment.html",
      `<html><body><button aria-label="Submit payment">Pay now</button></body></html>`,
    );
    const processes: readonly Process[] = [
      { name: "checkout", pages: ["/p/cart.html", "/p/payment.html"] },
    ];
    const { report } = runScan({
      standards: [wcag22],
      rules: [],
      enabled: ["wcag22"],
      files: [a, b],
      finders: [finder],
      processes,
    });
    const ids = new Set((report.candidates ?? []).map((c) => c.criterionId));
    expect(ids.has("wcag22:3.2.4")).toBe(true);
    expect(ids.has("wcag21:3.2.4")).toBe(true);
    expect(ids.has("section508:3.2.4")).toBe(true);
    expect(ids.has("en301549:9.3.2.4")).toBe(true);
  });

  // Guards the 3-page A/A/B case: when two pages agree and a third
  // diverges, the finder must still fire and the reason must cite all
  // three occurrences so the agent sees which page is the outlier
  // without having to re-read the other two.
  it("flags a 3-page process with A/A/B labels and names each occurrence", () => {
    const a = htmlFile(
      "/p/a.html",
      `<html><body><button aria-label="Send money">Send</button></body></html>`,
    );
    const b = htmlFile(
      "/p/b.html",
      `<html><body><button aria-label="Send money">Send</button></body></html>`,
    );
    const c = htmlFile(
      "/p/c.html",
      `<html><body><button aria-label="Send money">Transfer</button></body></html>`,
    );
    const processes: readonly Process[] = [
      { name: "transfer", pages: ["/p/a.html", "/p/b.html", "/p/c.html"] },
    ];
    const candidates = runWith([a, b, c], processes);
    expect(candidates.length).toBe(1);
    const [cand] = candidates;
    expect(cand?.reason).toContain("/p/a.html");
    expect(cand?.reason).toContain("/p/b.html");
    expect(cand?.reason).toContain("/p/c.html");
    expect(cand?.reason).toContain("`transfer`");
    expect(cand?.reason).toContain("`send`");
  });

  // Guards that aria-label is preferred over visible text when keying:
  // two buttons whose aria-labels match but whose visible text differs
  // must group under the aria-label key and surface as divergent. If
  // the finder keyed by visible text, different text would split them
  // into different buckets and the divergence would go silent.
  it("uses aria-label (not visible text) as the cross-page identifier", () => {
    const a = tsxFile(
      "/p/Cart.tsx",
      `export const Cart = () => (
         <div><button aria-label="Confirm order">Proceed</button></div>
       );`,
    );
    const b = tsxFile(
      "/p/Confirm.tsx",
      `export const Confirm = () => (
         <div><button aria-label="Confirm order">Place order</button></div>
       );`,
    );
    const processes: readonly Process[] = [
      { name: "checkout", pages: ["/p/Cart.tsx", "/p/Confirm.tsx"] },
    ];
    const candidates = runWith([a, b], processes);
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.reason).toContain("aria-label");
    expect(candidates[0]?.reason).toContain("confirm order");
  });

  // Guards the data-testid key path: in component libraries without
  // consistent aria-label usage, `data-testid` is often the only
  // author-provided stable handle. Two buttons with the same testid
  // but divergent visible text are as much a 3.2.4 concern as the
  // aria-label variant.
  it("uses data-testid as the identifier when aria-label is absent", () => {
    const a = tsxFile(
      "/p/Cart.tsx",
      `export const Cart = () => (
         <div><button data-testid="checkout-cta">Submit</button></div>
       );`,
    );
    const b = tsxFile(
      "/p/Review.tsx",
      `export const Review = () => (
         <div><button data-testid="checkout-cta">Send</button></div>
       );`,
    );
    const processes: readonly Process[] = [
      { name: "checkout", pages: ["/p/Cart.tsx", "/p/Review.tsx"] },
    ];
    const candidates = runWith([a, b], processes);
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.reason).toContain("data-testid");
  });

  // Guards that anchors and submit/button inputs also participate —
  // 3.2.4 is about components with the same functionality, and
  // navigation links or form-submit inputs have the same cross-page
  // identification requirement as buttons.
  it('flags divergent `<a>` labels and `<input type="submit">` values', () => {
    const a = htmlFile(
      "/p/a.html",
      `<html><body><a href="/help" aria-label="Get help">Help</a></body></html>`,
    );
    const b = htmlFile(
      "/p/b.html",
      `<html><body><a href="/help" aria-label="Get help">Support</a></body></html>`,
    );
    const processes: readonly Process[] = [{ name: "account", pages: ["/p/a.html", "/p/b.html"] }];
    const candidates = runWith([a, b], processes);
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.reason).toContain("<a>");
  });
});

describe("review/consistent-identification (negative — should NOT flag)", () => {
  // Guards against the default good shape: same identifier, same
  // visible label across two pages. If the finder fires here the
  // concept collapses.
  it("does not flag when identifier and label match across pages", () => {
    const a = htmlFile(
      "/p/cart.html",
      `<html><body><button aria-label="Submit payment">Submit</button></body></html>`,
    );
    const b = htmlFile(
      "/p/payment.html",
      `<html><body><button aria-label="Submit payment">Submit</button></body></html>`,
    );
    const processes: readonly Process[] = [
      { name: "checkout", pages: ["/p/cart.html", "/p/payment.html"] },
    ];
    expect(runWith([a, b], processes)).toEqual([]);
  });

  // Guards that case / whitespace normalization doesn't produce
  // phantom divergences — "  Submit  " and "submit" should normalize
  // to the same label and not flag.
  it("does not flag when label differences are only whitespace or case", () => {
    const a = htmlFile(
      "/p/cart.html",
      `<html><body><button aria-label="Submit payment">  Submit  </button></body></html>`,
    );
    const b = htmlFile(
      "/p/payment.html",
      `<html><body><button aria-label="Submit payment">submit</button></body></html>`,
    );
    const processes: readonly Process[] = [
      { name: "checkout", pages: ["/p/cart.html", "/p/payment.html"] },
    ];
    expect(runWith([a, b], processes)).toEqual([]);
  });

  // Guards that a button with no identifier at all (no aria-label, no
  // data-testid, no visible text — e.g. icon-only button) is skipped
  // rather than matched against another identifier-less button on a
  // different page. Two pure-positional buttons can't be proven to
  // represent the same action from static evidence alone.
  it("skips pure-positional buttons (no aria-label, no testid, no text)", () => {
    const a = tsxFile(
      "/p/Cart.tsx",
      `export const Cart = () => (
         <div><button><Icon /></button></div>
       );`,
    );
    const b = tsxFile(
      "/p/Review.tsx",
      `export const Review = () => (
         <div><button><Icon /></button></div>
       );`,
    );
    const processes: readonly Process[] = [
      { name: "checkout", pages: ["/p/Cart.tsx", "/p/Review.tsx"] },
    ];
    expect(runWith([a, b], processes)).toEqual([]);
  });

  // Guards that a single occurrence in a single process page never
  // flags — 3.2.4 is cross-page; one occurrence has nothing to diverge
  // from.
  it("does not flag when only one occurrence exists across the process", () => {
    const only = htmlFile(
      "/p/cart.html",
      `<html><body><button aria-label="Submit payment">Submit</button></body></html>`,
    );
    const processes: readonly Process[] = [{ name: "checkout", pages: ["/p/cart.html"] }];
    expect(runWith([only], processes)).toEqual([]);
  });

  // Guards that two processes are evaluated independently: a divergence
  // that spans different processes does NOT flag, because the spec
  // scopes "set of Web pages" to one process.
  it("does not correlate instances across two different processes", () => {
    const cart = htmlFile(
      "/p/cart.html",
      `<html><body><button aria-label="Submit payment">Submit</button></body></html>`,
    );
    const profile = htmlFile(
      "/p/profile.html",
      `<html><body><button aria-label="Submit payment">Send</button></body></html>`,
    );
    const processes: readonly Process[] = [
      { name: "checkout", pages: ["/p/cart.html"] },
      { name: "account", pages: ["/p/profile.html"] },
    ];
    // Each process has only one page → no within-process divergence.
    expect(runWith([cart, profile], processes)).toEqual([]);
  });
});

describe("review/consistent-identification (edge cases)", () => {
  // Guards that multiple identifier-only buttons on the same page with
  // the same aria-label contribute a single label for that page — not
  // a within-page phantom divergence — because 3.2.4 is cross-page,
  // not within-page.
  it("treats multiple same-key instances on one page as one label", () => {
    const a = htmlFile(
      "/p/cart.html",
      `<html><body>
         <button aria-label="Submit payment">Submit</button>
         <button aria-label="Submit payment">Submit</button>
       </body></html>`,
    );
    const b = htmlFile(
      "/p/payment.html",
      `<html><body><button aria-label="Submit payment">Submit</button></body></html>`,
    );
    const processes: readonly Process[] = [
      { name: "checkout", pages: ["/p/cart.html", "/p/payment.html"] },
    ];
    expect(runWith([a, b], processes)).toEqual([]);
  });

  // Guards the missing-page path: a declared page that isn't in the
  // parsed-file set is silently skipped (scan_process emits the
  // `process_has_missing_pages` warning separately). The remaining
  // pages still get compared so the agent sees partial evidence.
  it("skips pages that aren't in the parsed-file set", () => {
    const a = htmlFile(
      "/p/cart.html",
      `<html><body><button aria-label="Submit payment">Submit</button></body></html>`,
    );
    const b = htmlFile(
      "/p/payment.html",
      `<html><body><button aria-label="Submit payment">Pay</button></body></html>`,
    );
    const processes: readonly Process[] = [
      {
        name: "checkout",
        pages: ["/p/cart.html", "/p/missing.html", "/p/payment.html"],
      },
    ];
    const candidates = runWith([a, b], processes);
    expect(candidates.length).toBe(1);
  });

  // Guards that unrelated files (not in any process's pages list) do
  // not contribute instances to the index — the process primitive is
  // the scope boundary, and bringing in extra files would re-introduce
  // the heuristic-discovery failure mode the ADR rejects.
  it("ignores files that aren't listed in any process", () => {
    const cart = htmlFile(
      "/p/cart.html",
      `<html><body><button aria-label="Submit payment">Submit</button></body></html>`,
    );
    const payment = htmlFile(
      "/p/payment.html",
      `<html><body><button aria-label="Submit payment">Submit</button></body></html>`,
    );
    // This file has a divergent label but isn't in the process page
    // list — it must not pull the group into "divergent" status.
    const stray = htmlFile(
      "/p/unrelated.html",
      `<html><body><button aria-label="Submit payment">Send</button></body></html>`,
    );
    const processes: readonly Process[] = [
      { name: "checkout", pages: ["/p/cart.html", "/p/payment.html"] },
    ];
    expect(runWith([cart, payment, stray], processes)).toEqual([]);
  });
});
