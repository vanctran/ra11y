/**
 * Unit tests for the review/consistent-navigation finder (wcag22:3.2.3).
 *
 * The finder is cross-file — it runs via the scanner's `afterProject`
 * hook and compares navs between parsed files. These tests drive it
 * through `runScan` with multiple ParsedFiles so the actual group+
 * divergence logic is exercised end-to-end.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ParsedFile, runScan } from "../../../../src/engine/scanner.ts";
import { parseHtml, parseTsx } from "../../../../src/input/parsers/index.ts";
import { finder } from "../../../../src/review/finders/consistent-navigation.ts";
import { wcag22 } from "../../../../src/standards/wcag22/standard.ts";
import type { Process } from "../../../../src/types/config.ts";
import type { ReviewCandidate } from "../../../../src/types/review.ts";

const FIXTURE_ROOT = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "fixtures",
  "review",
  "consistent-navigation",
);

function fixtureHtml(kind: "good" | "bad", name: string): ParsedFile {
  const filePath = join(FIXTURE_ROOT, kind, name);
  const source = readFileSync(filePath, "utf8");
  const r = parseHtml(source);
  return { filePath, source, ast: { language: "html", root: r.root, errors: r.errors } };
}

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
  return report.candidates ?? [];
}

describe("review/consistent-navigation (positive — should flag)", () => {
  // Guards the core 3.2.3 failure mode: the same set of links appearing
  // in a reordered sequence across two repeated navigational
  // mechanisms. This is the canonical shape of a Consistent Navigation
  // violation the finder must not miss.
  it("flags two HTML navs with the same link set emitted in a different order", () => {
    const candidates = runWith([
      fixtureHtml("bad", "divergent-home.html"),
      fixtureHtml("bad", "divergent-contact.html"),
    ]);
    const wcagOnly = candidates.filter((c) => c.criterionId === "wcag22:3.2.3");
    expect(wcagOnly.length).toBe(2);
    const paths = wcagOnly.map((c) => c.location.filePath).sort();
    expect(paths[0]).toContain("divergent-contact.html");
    expect(paths[1]).toContain("divergent-home.html");
  });

  // Guards that the reason text points the agent at a counterpart
  // file:line — the "where's the other nav" answer is load-bearing for
  // single-read triage. Without it the agent has to Grep for navs.
  it("names the counterpart file:line in each candidate's reason", () => {
    const candidates = runWith([
      fixtureHtml("bad", "divergent-home.html"),
      fixtureHtml("bad", "divergent-contact.html"),
    ]).filter((c) => c.criterionId === "wcag22:3.2.3");
    for (const c of candidates) {
      expect(c.reason).toMatch(/<nav> link order diverges from .+:\d+/);
      expect(c.reason).toContain("verify");
    }
    // Cross-pointers: home's candidate should cite contact's path, and
    // contact's candidate should cite home's path.
    const forHome = candidates.find((c) => c.location.filePath.endsWith("divergent-home.html"));
    const forContact = candidates.find((c) =>
      c.location.filePath.endsWith("divergent-contact.html"),
    );
    expect(forHome?.reason).toContain("divergent-contact.html");
    expect(forContact?.reason).toContain("divergent-home.html");
  });

  // Guards that detection isn't tethered to HTML — JSX navs (React
  // Router `<NavLink to>`, Next.js `<Link>`, plain `<a href>`) all
  // participate in the cross-file comparison.
  it("flags JSX navs whose `<a href>` links are in a different order than an HTML nav with the same set", () => {
    const html = htmlFile(
      "/p/index.html",
      `<html><body><nav><a href="/">Home</a><a href="/docs">Docs</a><a href="/blog">Blog</a></nav></body></html>`,
    );
    const jsx = tsxFile(
      "/p/Header.tsx",
      `export const Header = () => (
         <nav>
           <a href="/blog">Blog</a>
           <a href="/docs">Docs</a>
           <a href="/">Home</a>
         </nav>
       );`,
    );
    const candidates = runWith([html, jsx]).filter((c) => c.criterionId === "wcag22:3.2.3");
    expect(candidates.length).toBe(2);
    const paths = new Set(candidates.map((c) => c.location.filePath));
    expect(paths.has("/p/index.html")).toBe(true);
    expect(paths.has("/p/Header.tsx")).toBe(true);
  });

  // Guards that the cross-standard criterion IDs (wcag21, section508,
  // en301549) all get emitted so VPAT coverage reports surface the
  // candidate under every framework that references SC 3.2.3.
  it("emits one candidate per matching criterion id across standards", () => {
    const candidates = runWith([
      fixtureHtml("bad", "divergent-home.html"),
      fixtureHtml("bad", "divergent-contact.html"),
    ]);
    const ids = new Set(candidates.map((c) => c.criterionId));
    expect(ids.has("wcag22:3.2.3")).toBe(true);
    expect(ids.has("wcag21:3.2.3")).toBe(true);
    expect(ids.has("section508:3.2.3")).toBe(true);
    expect(ids.has("en301549:9.3.2.3")).toBe(true);
  });

  // Guards that `role="navigation"` counts as a nav container even
  // when the element isn't literally `<nav>` — accessibility tree
  // equivalence is what 3.2.3 is measured against, not the tag name.
  it("treats role='navigation' containers as nav containers for cross-file comparison", () => {
    const a = htmlFile(
      "/p/a.html",
      `<html><body><div role="navigation"><a href="/">Home</a><a href="/about">About</a></div></body></html>`,
    );
    const b = htmlFile(
      "/p/b.html",
      `<html><body><nav><a href="/about">About</a><a href="/">Home</a></nav></body></html>`,
    );
    const candidates = runWith([a, b]).filter((c) => c.criterionId === "wcag22:3.2.3");
    expect(candidates.length).toBe(2);
  });
});

describe("review/consistent-navigation (negative — should NOT flag)", () => {
  // Guards against the most common false positive: two routes with an
  // identically-ordered nav. If the finder fires here the whole
  // concept collapses — this is the default good shape.
  it("does not flag two HTML navs with identical link order", () => {
    const candidates = runWith([
      fixtureHtml("good", "consistent-home.html"),
      fixtureHtml("good", "consistent-about.html"),
    ]);
    expect(candidates).toEqual([]);
  });

  // Guards that a single scanned file with a single nav produces no
  // candidates — cross-file comparison needs a counterpart, and a
  // lone nav has nothing to diverge from.
  it("does not flag when only one nav exists across all scanned files", () => {
    const only = htmlFile(
      "/p/only.html",
      `<html><body><nav><a href="/">Home</a><a href="/about">About</a></nav></body></html>`,
    );
    expect(runWith([only])).toEqual([]);
  });

  // Guards that navs with disjoint link sets (home+about vs
  // docs+blog) never get grouped. WCAG 3.2.3 is about a *repeated*
  // mechanism reordered, not unrelated menus. Grouping disjoint sets
  // would flag the whole site whenever pages have different menus.
  it("does not flag navs with disjoint link sets across files", () => {
    const marketing = htmlFile(
      "/p/marketing.html",
      `<html><body><nav><a href="/">Home</a><a href="/pricing">Pricing</a></nav></body></html>`,
    );
    const docs = htmlFile(
      "/p/docs.html",
      `<html><body><nav><a href="/docs">Docs</a><a href="/api">API</a></nav></body></html>`,
    );
    expect(runWith([marketing, docs])).toEqual([]);
  });

  // Guards that two navs with overlapping but non-equal link sets
  // stay out of the same group — one nav having a subset of the
  // other's links is not a 3.2.3 reorder; it's just a different menu
  // (e.g. footer vs header).
  it("does not flag when one nav is a strict subset of the other's links", () => {
    const full = htmlFile(
      "/p/full.html",
      `<html><body><nav><a href="/">Home</a><a href="/about">About</a><a href="/contact">Contact</a></nav></body></html>`,
    );
    const footer = htmlFile(
      "/p/footer.html",
      `<html><body><nav><a href="/">Home</a><a href="/about">About</a></nav></body></html>`,
    );
    expect(runWith([full, footer]).filter((c) => c.criterionId === "wcag22:3.2.3")).toEqual([]);
  });

  // Guards against whitespace / casing noise in link text producing
  // phantom divergences. `"  Home  "` and `"home"` normalize to the
  // same label, so the two navs share an ordering and don't flag.
  it("does not flag when label differences are only whitespace or case", () => {
    const a = htmlFile(
      "/p/a.html",
      `<html><body><nav><a href="/">  Home  </a><a href="/about">About</a></nav></body></html>`,
    );
    const b = htmlFile(
      "/p/b.html",
      `<html><body><nav><a href="/">home</a><a href="/about">ABOUT</a></nav></body></html>`,
    );
    expect(runWith([a, b]).filter((c) => c.criterionId === "wcag22:3.2.3")).toEqual([]);
  });
});

describe("review/consistent-navigation (edge cases)", () => {
  // Guards the three-file case: one file matches two others on link
  // set but orders them differently from both. The finder must flag
  // every divergent member of the group, not just the first two. This
  // is the shape that arises when a third route got shuffled during a
  // refactor.
  it("flags every member of a three-file group when orderings disagree", () => {
    const home = htmlFile(
      "/p/home.html",
      `<html><body><nav><a href="/">A</a><a href="/b">B</a><a href="/c">C</a></nav></body></html>`,
    );
    const about = htmlFile(
      "/p/about.html",
      `<html><body><nav><a href="/b">B</a><a href="/">A</a><a href="/c">C</a></nav></body></html>`,
    );
    const contact = htmlFile(
      "/p/contact.html",
      `<html><body><nav><a href="/c">C</a><a href="/">A</a><a href="/b">B</a></nav></body></html>`,
    );
    const candidates = runWith([home, about, contact]).filter(
      (c) => c.criterionId === "wcag22:3.2.3",
    );
    expect(candidates.length).toBe(3);
    const paths = new Set(candidates.map((c) => c.location.filePath));
    expect(paths.has("/p/home.html")).toBe(true);
    expect(paths.has("/p/about.html")).toBe(true);
    expect(paths.has("/p/contact.html")).toBe(true);
  });

  // Guards the icon-only-link case: anchors with no visible text but
  // different hrefs should still participate via href fallback. If we
  // dropped unlabeled anchors, a nav of `<a href><img></a>` items
  // would look empty to the finder and never group.
  it("falls back to href when an anchor has no visible text", () => {
    const a = htmlFile(
      "/p/a.html",
      `<html><body><nav><a href="/one"><img alt=""></a><a href="/two"><img alt=""></a></nav></body></html>`,
    );
    const b = htmlFile(
      "/p/b.html",
      `<html><body><nav><a href="/two"><img alt=""></a><a href="/one"><img alt=""></a></nav></body></html>`,
    );
    const candidates = runWith([a, b]).filter((c) => c.criterionId === "wcag22:3.2.3");
    expect(candidates.length).toBe(2);
  });

  // Guards the process-aware path's invariant that a `processes`
  // config with two pages whose navs match exactly produces zero
  // candidates. This is the canonical clean shape — config is
  // declared, evidence is deterministic, and the landmarks agree.
  it("process-aware: zero candidates when two process pages share an identical nav", () => {
    const cart = htmlFile(
      "/p/cart.html",
      `<html><body><nav><a href="/">Home</a><a href="/cart">Cart</a><a href="/pay">Pay</a></nav></body></html>`,
    );
    const pay = htmlFile(
      "/p/pay.html",
      `<html><body><nav><a href="/">Home</a><a href="/cart">Cart</a><a href="/pay">Pay</a></nav></body></html>`,
    );
    const processes: readonly Process[] = [
      { name: "checkout", pages: ["/p/cart.html", "/p/pay.html"] },
    ];
    expect(runWith([cart, pay], processes)).toEqual([]);
  });

  // Guards the core process-aware flag shape: two pages whose primary
  // nav differs in ordered link labels emits exactly one candidate on
  // the diverging page, scoped to the process name.
  it("process-aware: flags the divergent page when two process pages disagree on nav link labels", () => {
    const cart = htmlFile(
      "/p/cart.html",
      `<html><body><nav><a href="/">Home</a><a href="/cart">Cart</a><a href="/pay">Pay</a></nav></body></html>`,
    );
    const pay = htmlFile(
      "/p/pay.html",
      `<html><body><nav><a href="/cart">Cart</a><a href="/">Home</a><a href="/pay">Pay</a></nav></body></html>`,
    );
    const processes: readonly Process[] = [
      { name: "checkout", pages: ["/p/cart.html", "/p/pay.html"] },
    ];
    const candidates = runWith([cart, pay], processes).filter(
      (c) => c.criterionId === "wcag22:3.2.3",
    );
    // First-seen signature (cart.html) is modal; pay.html diverges.
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.location.filePath).toBe("/p/pay.html");
    expect(candidates[0]?.reason).toContain("checkout");
    expect(candidates[0]?.reason).toContain("process-modal order");
  });

  // Guards the outlier-in-three case: two pages agree on the nav,
  // one dissents. The modal is the pair's shared signature and the
  // finder must flag only the outlier — the two agreeing pages are
  // consistent with each other and consistent with the process
  // modal.
  it("process-aware: flags only the outlier when 2/3 process pages agree", () => {
    const home = htmlFile(
      "/p/home.html",
      `<html><body><nav><a href="/">Home</a><a href="/shop">Shop</a><a href="/about">About</a></nav></body></html>`,
    );
    const shop = htmlFile(
      "/p/shop.html",
      `<html><body><nav><a href="/">Home</a><a href="/shop">Shop</a><a href="/about">About</a></nav></body></html>`,
    );
    const about = htmlFile(
      "/p/about.html",
      `<html><body><nav><a href="/about">About</a><a href="/shop">Shop</a><a href="/">Home</a></nav></body></html>`,
    );
    const processes: readonly Process[] = [
      { name: "browse", pages: ["/p/home.html", "/p/shop.html", "/p/about.html"] },
    ];
    const candidates = runWith([home, shop, about], processes).filter(
      (c) => c.criterionId === "wcag22:3.2.3",
    );
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.location.filePath).toBe("/p/about.html");
  });

  // Guards the link-count divergence path: same labels intersect but
  // one page drops a link. Same-named landmark but different link
  // count is a 3.2.3 question too, and the reason text calls out the
  // count mismatch explicitly.
  it("process-aware: flags when a process page's nav has a different link count", () => {
    const a = htmlFile(
      "/p/a.html",
      `<html><body><nav><a href="/">Home</a><a href="/shop">Shop</a><a href="/help">Help</a></nav></body></html>`,
    );
    const b = htmlFile(
      "/p/b.html",
      `<html><body><nav><a href="/">Home</a><a href="/shop">Shop</a></nav></body></html>`,
    );
    const processes: readonly Process[] = [{ name: "browse", pages: ["/p/a.html", "/p/b.html"] }];
    const candidates = runWith([a, b], processes).filter((c) => c.criterionId === "wcag22:3.2.3");
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.location.filePath).toBe("/p/b.html");
    expect(candidates[0]?.reason).toContain("link count");
  });

  // Guards the empty-landmark case: a page with no `<nav>` and no
  // `role="navigation"` contributes nothing to the process group,
  // so the finder has nothing to compare and stays silent. Without
  // this guard, an agent auditing a partially-built app would get
  // noise on every un-navved landing page.
  it("process-aware: stays silent when a process page has no nav landmark", () => {
    const a = htmlFile(
      "/p/a.html",
      `<html><body><nav><a href="/">Home</a><a href="/about">About</a></nav></body></html>`,
    );
    const b = htmlFile("/p/b.html", `<html><body><main>No nav here</main></body></html>`);
    const processes: readonly Process[] = [{ name: "browse", pages: ["/p/a.html", "/p/b.html"] }];
    expect(runWith([a, b], processes)).toEqual([]);
  });

  // Guards the `{ role, accessibleName }` keying: a page with both a
  // "primary" nav (matching the other page) and a "footer" nav
  // (singleton) must not flag the footer just because it is the only
  // one of its kind. The process-aware path only compares landmarks
  // that share role + accessible name across pages.
  it("process-aware: separates primary and footer navs by accessible name", () => {
    const a = htmlFile(
      "/p/a.html",
      `<html><body>
         <nav aria-label="Primary"><a href="/">Home</a><a href="/shop">Shop</a></nav>
         <nav aria-label="Footer"><a href="/terms">Terms</a></nav>
       </body></html>`,
    );
    const b = htmlFile(
      "/p/b.html",
      `<html><body>
         <nav aria-label="Primary"><a href="/">Home</a><a href="/shop">Shop</a></nav>
       </body></html>`,
    );
    const processes: readonly Process[] = [{ name: "browse", pages: ["/p/a.html", "/p/b.html"] }];
    expect(runWith([a, b], processes)).toEqual([]);
  });

  // Guards the heuristic-fallback reason text: when no `processes`
  // config is declared the finder keeps firing (existing behavior)
  // but the reason names the config-upgrade path so an agent can
  // tell the caller how to anchor the check deterministically.
  it("fallback: reason text points at the `processes` config upgrade", () => {
    const a = htmlFile(
      "/p/a.html",
      `<html><body><nav><a href="/">Home</a><a href="/about">About</a></nav></body></html>`,
    );
    const b = htmlFile(
      "/p/b.html",
      `<html><body><nav><a href="/about">About</a><a href="/">Home</a></nav></body></html>`,
    );
    const candidates = runWith([a, b]).filter((c) => c.criterionId === "wcag22:3.2.3");
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.reason).toContain("processes: [...]");
      expect(c.reason).toContain("ra11y.config.ts");
    }
  });

  // Guards the empty-processes case: an empty `processes` list is
  // treated identically to "unset," so the heuristic fallback fires.
  // This mirrors the doctrine in `ProjectCandidateContext.processes`
  // that both `undefined` and `[]` mean "no process evidence."
  it("fallback: empty processes list falls through to heuristic path", () => {
    const a = htmlFile(
      "/p/a.html",
      `<html><body><nav><a href="/">Home</a><a href="/about">About</a></nav></body></html>`,
    );
    const b = htmlFile(
      "/p/b.html",
      `<html><body><nav><a href="/about">About</a><a href="/">Home</a></nav></body></html>`,
    );
    const candidates = runWith([a, b], []).filter((c) => c.criterionId === "wcag22:3.2.3");
    expect(candidates.length).toBeGreaterThan(0);
  });

  // Guards the inline-disable pragma path: an agent that reviewed a
  // divergent nav and decided the reorder is user-initiated (per the
  // spec carve-out) uses `<!-- ra11y-disable wcag22:3.2.3 -->` on the
  // nav's line to suppress the candidate. The scanner applies that
  // filter to afterProject emissions too.
  it("respects `<!-- ra11y-disable wcag22:3.2.3 -->` on the nav's line", async () => {
    const { parseInlineDisables } = await import("../../../../src/config/inline-disables.ts");
    const sourceA = [
      "<html><body>",
      "<!-- ra11y-disable wcag22:3.2.3 -->",
      '<nav><a href="/">Home</a><a href="/about">About</a></nav>',
      "</body></html>",
    ].join("\n");
    const sourceB =
      '<html><body><nav><a href="/about">About</a><a href="/">Home</a></nav></body></html>';
    const parsedA = parseHtml(sourceA);
    const parsedB = parseHtml(sourceB);
    const fileA: ParsedFile = {
      filePath: "/p/a.html",
      source: sourceA,
      ast: { language: "html", root: parsedA.root, errors: parsedA.errors },
      disableMap: parseInlineDisables(sourceA),
    };
    const fileB: ParsedFile = {
      filePath: "/p/b.html",
      source: sourceB,
      ast: { language: "html", root: parsedB.root, errors: parsedB.errors },
    };
    const candidates = runWith([fileA, fileB]).filter((c) => c.criterionId === "wcag22:3.2.3");
    // A is silenced by the pragma; B still surfaces (the agent needs
    // to verify B independently — disabling on A doesn't silence the
    // whole group).
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.location.filePath).toBe("/p/b.html");
  });
});
