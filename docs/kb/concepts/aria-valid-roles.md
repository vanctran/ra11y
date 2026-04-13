---
title: "Valid ARIA roles"
topic: concept
audience: agents, contributors
---

# Valid ARIA roles

An ARIA role is a promise: "this element behaves like a {button, link, tab, menu, …}." Setting `role` incorrectly — typos, non-existent roles, conflicting role patterns — silently breaks assistive tech. Rules that validate roles are one of the highest-signal checks ra11y runs.

## The role catalog

ARIA defines roles across several categories:

- **Widget roles**: `button`, `checkbox`, `gridcell`, `link`, `menuitem`, `menuitemcheckbox`, `menuitemradio`, `option`, `progressbar`, `radio`, `scrollbar`, `searchbox`, `separator`, `slider`, `spinbutton`, `switch`, `tab`, `tabpanel`, `textbox`, `treeitem`
- **Composite roles**: `combobox`, `grid`, `listbox`, `menu`, `menubar`, `radiogroup`, `tablist`, `tree`, `treegrid`
- **Document structure roles**: `application`, `article`, `blockquote`, `caption`, `cell`, `columnheader`, `definition`, `deletion`, `directory`, `document`, `emphasis`, `feed`, `figure`, `generic`, `group`, `heading`, `img`, `insertion`, `list`, `listitem`, `math`, `meter`, `none`, `note`, `paragraph`, `presentation`, `row`, `rowgroup`, `rowheader`, `separator`, `strong`, `subscript`, `superscript`, `table`, `term`, `time`, `toolbar`, `tooltip`
- **Landmark roles**: `banner`, `complementary`, `contentinfo`, `form`, `main`, `navigation`, `region`, `search`
- **Live region roles**: `alert`, `log`, `marquee`, `status`, `timer`
- **Window roles**: `alertdialog`, `dialog`

The authoritative list is in the ARIA 1.2 spec. ra11y ships the catalog in `src/rules/aria/valid-roles-data.ts` (or similar) and checks it in `aria/invalid-role`.

## Role categories ra11y checks

- **`aria/invalid-role`** — flags roles that are not in the catalog. Typos like `role="botton"` and mistaken names like `role="hyperlink"`.
- **`aria/required-attrs`** — roles have required accompanying attributes. `role="slider"` requires `aria-valuenow`, `aria-valuemin`, `aria-valuemax`. `role="combobox"` requires `aria-expanded`.
- **`aria/valid-attr`** — attributes must be spelled correctly. `aria-describeddby` is a bug; should be `aria-describedby`.

## Presentation vs none

`role="presentation"` and `role="none"` both strip an element's semantics from the accessibility tree. `none` is the newer, preferred spelling; `presentation` remains for compatibility. Neither should be set on an interactive element — the browser ignores the directive when it would break interactivity.

## `role="img"` on decorative SVG

Common mistake: decorative SVGs get `role="img"` plus no `aria-label`, producing an accessible-name-less img in the tree. Screen readers announce "image" with no further info. If decorative, use `role="presentation"` or `aria-hidden="true"`. If meaningful, give it an `aria-label`.

## Abstract roles

Some roles are abstract — part of the ARIA taxonomy for grouping purposes but not usable in markup. `widget`, `composite`, `input`, `landmark`, `section`, `sectionhead`, `structure`, `window`, `range`, `roletype`. Setting any of these breaks AT. The `aria/invalid-role` rule flags them as hard errors.

## Implicit roles

Native HTML elements have implicit roles:
- `<button>` → `button`
- `<a href>` → `link`
- `<input type="checkbox">` → `checkbox`
- `<h1>` → `heading`
- `<main>` → `main`
- `<nav>` → `navigation`

Setting the implicit role explicitly is redundant but harmless (`<button role="button">`). Setting a conflicting role (`<button role="link">`) breaks the contract — AT announces one thing, the browser behaves like another. The `aria/valid-role` rule flags common conflicts.

## See also

- [ARIA 1.2 spec — Definition of Roles](https://www.w3.org/TR/wai-aria-1.2/#role_definitions) — the authoritative catalog.
- [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/) — canonical patterns using these roles.
- `src/rules/aria/invalid-role.ts`, `aria/required-attrs.ts`, `aria/valid-attr.ts` — the ra11y rules that enforce this.
