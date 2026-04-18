/**
 * Implicit ARIA roles for native HTML elements.
 *
 * Every native HTML element maps to zero or more implicit ARIA roles
 * in the browser's accessibility tree. Setting `role="X"` on an
 * element whose implicit role is different — and incompatible with X
 * — is a real WCAG 4.1.2 failure: assistive tech announces one thing
 * while the browser behaves like another.
 *
 * This module exposes two primitives consumed by `aria/conflicting-role`
 * (and potentially future ARIA rules):
 *
 * 1. {@link implicitRoleFor} — returns the implicit ARIA role(s) for a
 *    given tag (plus, for `<input>` and `<a>`, the attributes that
 *    disambiguate between role variants).
 * 2. {@link isRoleConflict} — given an implicit role and an explicit
 *    role author set, returns `true` when the pair is a hard conflict,
 *    `false` when it is OK (redundant, AMBIGUOUS, or a documented
 *    override pattern like `role="presentation"` on a decorative
 *    `<img>`).
 *
 * The conflict table is deliberately narrow: we only fire on pairs
 * where the mismatch is unambiguous from static evidence alone. Ties,
 * author-intent guesses, and "author is re-labeling a styled
 * non-semantic anchor" cases return OK — the agent reading the file
 * is a better arbiter than a heuristic.
 *
 * Sources:
 * - ARIA in HTML: https://www.w3.org/TR/html-aria/
 * - WAI-ARIA 1.2 role definitions:
 *   https://www.w3.org/TR/wai-aria-1.2/#role_definitions
 */

// ---------------------------------------------------------------------------
// Implicit role resolution
// ---------------------------------------------------------------------------

/**
 * Attributes a caller may supply to resolve implicit role for tags
 * whose role depends on attributes (`<a>` needs `href`; `<input>` needs
 * `type`). Undefined values mean "not present on the element."
 */
export interface ImplicitRoleAttributes {
  readonly href?: string | null;
  readonly type?: string | null;
  readonly scope?: string | null;
  readonly list?: string | null;
  readonly multiple?: string | null;
  readonly size?: string | null;
}

/**
 * Returns the implicit ARIA role for a native HTML tag, or `null` if
 * the tag has no mapped implicit role (e.g. `<div>`, `<span>`). Tag
 * names are compared case-insensitively.
 *
 * For tags whose role depends on attributes (`<a>` vs `<a href>`,
 * `<input type="checkbox">`, `<th scope="row">`), the caller passes the
 * relevant attributes via {@link ImplicitRoleAttributes}.
 */
export function implicitRoleFor(
  tagName: string,
  attrs: ImplicitRoleAttributes = {},
): string | null {
  const tag = tagName.toLowerCase();

  // Landmark + document-structure tags — unambiguous.
  switch (tag) {
    case "article":
      return "article";
    case "aside":
      return "complementary";
    case "main":
      return "main";
    case "nav":
      return "navigation";
    case "footer":
      // Implicit role depends on ancestry: `contentinfo` only when the
      // nearest landmark ancestor is `<body>`. Without a full tree walk
      // we return `contentinfo` as the canonical case — this is how
      // ARIA-in-HTML documents it and the ancestry exception is rare.
      return "contentinfo";
    case "header":
      // Same ancestry story as <footer> — canonical case is `banner`.
      return "banner";
    case "section":
      // `<section>` is region only when it has an accessible name; we
      // can't cheaply detect that here, so we treat it as unmapped.
      return null;
    case "form":
      // form→form only with accessible name; treat as unmapped.
      return null;
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading";
    case "button":
      return "button";
    case "a":
    case "area":
      // Only <a href> is a link; <a> without href is a placeholder.
      return attrs.href == null ? null : "link";
    case "img":
      // `<img alt="">` is intentionally decorative — caller checks the
      // role itself for the documented override patterns (`none`,
      // `presentation`). We report the default `img` role here.
      return "img";
    case "table":
      return "table";
    case "th":
      // scope="row" → rowheader, scope="col" (or absent) → columnheader.
      return attrs.scope === "row" ? "rowheader" : "columnheader";
    case "td":
      return "cell";
    case "tr":
      return "row";
    case "ul":
    case "ol":
    case "menu":
      return "list";
    case "li":
      return "listitem";
    case "dialog":
      return "dialog";
    case "output":
      return "status";
    case "progress":
      return "progressbar";
    case "select":
      // <select multiple> or size > 1 → listbox; otherwise combobox.
      if (attrs.multiple != null) return "listbox";
      if (attrs.size != null && Number(attrs.size) > 1) return "listbox";
      return "combobox";
    case "textarea":
      return "textbox";
    case "input":
      return inputImplicitRole(attrs.type ?? "text", attrs.list ?? null);
    default:
      return null;
  }
}

/** Maps `<input type="...">` to its implicit role. */
function inputImplicitRole(type: string, list: string | null): string | null {
  const t = type.toLowerCase();
  switch (t) {
    case "button":
    case "image":
    case "reset":
    case "submit":
      return "button";
    case "checkbox":
      return "checkbox";
    case "radio":
      return "radio";
    case "range":
      return "slider";
    case "number":
      return "spinbutton";
    case "search":
      return list == null ? "searchbox" : "combobox";
    case "email":
    case "tel":
    case "text":
    case "url":
      return list == null ? "textbox" : "combobox";
    // password, hidden, file, date, color, … have no mapped implicit
    // role per ARIA-in-HTML; return null so `conflicting-role` stays
    // quiet rather than firing on author additions.
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Conflict matrix
// ---------------------------------------------------------------------------

/**
 * Pairs of (implicitRole, explicitRole) that are hard conflicts —
 * different interaction models or landmark semantics that will cause
 * AT to announce something the browser does not behave like.
 *
 * The matrix is intentionally narrow: only pairs where the conflict is
 * unambiguous from static evidence alone. Pairs not listed here are
 * treated as OK (redundant) or AMBIGUOUS (let the agent decide).
 */
const CONFLICT_PAIRS: ReadonlySet<string> = new Set([
  // button vs link — different activation (Enter-only vs Enter+click-through).
  "button|link",
  "link|button",

  // Landmark-to-landmark mismatches — each landmark has a distinct
  // meaning and AT exposes them separately in the landmarks list.
  "main|navigation",
  "main|complementary",
  "main|banner",
  "main|contentinfo",
  "main|article",
  "main|region",
  "navigation|main",
  "navigation|banner",
  "navigation|contentinfo",
  "navigation|complementary",
  "navigation|article",
  "banner|main",
  "banner|navigation",
  "banner|contentinfo",
  "banner|complementary",
  "contentinfo|main",
  "contentinfo|navigation",
  "contentinfo|banner",
  "contentinfo|complementary",
  "complementary|main",
  "complementary|navigation",
  "complementary|banner",
  "complementary|contentinfo",

  // Heading → interactive widget. Headings are document structure; a
  // button or link disguised as a heading breaks the outline AT
  // exposes via the rotor.
  "heading|button",
  "heading|link",
  "heading|tab",
  "heading|menuitem",

  // List / list-item vs interactive widget — likewise breaks the
  // list-navigation shortcut AT users rely on.
  "list|button",
  "list|link",
  "listitem|button",
  "listitem|link",

  // Table semantics — swapping a table cell for a button/link loses
  // row/column navigation.
  "cell|button",
  "cell|link",
  "columnheader|button",
  "columnheader|link",
  "rowheader|button",
  "rowheader|link",

  // Interactive widget → landmark. A button re-labeled as a landmark
  // is a category error.
  "button|main",
  "button|navigation",
  "button|banner",
  "button|contentinfo",
  "button|complementary",
  "button|article",
  "link|main",
  "link|navigation",
  "link|banner",
  "link|contentinfo",
  "link|complementary",
]);

/**
 * Returns `true` when the (implicit, explicit) pair is a hard
 * conflict. Returns `false` otherwise — including redundant pairs
 * (`a` + `link`) which are out of scope for `aria/conflicting-role`
 * and the documented override patterns (`img` + `presentation`/`none`)
 * which are honored.
 */
export function isRoleConflict(implicitRole: string, explicitRole: string): boolean {
  const impl = implicitRole.toLowerCase();
  const expl = explicitRole.toLowerCase();
  if (impl === expl) return false;
  // `role="none"` / `role="presentation"` are documented overrides
  // honored across many elements (decorative images, styled divs acting
  // as containers). A separate rule owns flagging them on interactive
  // elements; here we keep quiet.
  if (expl === "none" || expl === "presentation") return false;
  return CONFLICT_PAIRS.has(`${impl}|${expl}`);
}
