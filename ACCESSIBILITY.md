# Accessibility statement for ra11y

A tool helping people build accessible software must be accessible itself.

## Scope

This statement covers ra11y's own surfaces:

- The terminal output produced by the CLI (all six formatters)
- The HTML report formatter output
- This repository's documentation (`README.md`, `docs/`)
- The project website (when published)

## Conformance target

ra11y aims for **WCAG 2.2 Level AA** conformance across every surface listed above. We run the tool on its own fixtures and documentation as part of CI.

## Known limitations

- **Terminal box-drawing characters** in the default formatter rely on Unicode symbols that some screen readers verbalize as "line", "line", "line". If this is disruptive:
  - Use `--format plain` for a flat, screen-reader-friendly output.
  - Use `--no-decorations` to disable box-drawing while keeping color in terminal mode.
- **Color-only information.** Severity is conveyed by both color and a leading glyph (`✗` error, `⚠` warning, `ℹ` info). `--no-color` preserves the glyphs so severity is never color-only.
- **Animated output.** There is none. Progress is reported as discrete lines; no spinners or reflow.

## Accessible output mode

`--format plain` emits one violation per line in `<file>:<line>:<col> <severity> <ruleId> <message>` format with no Unicode box-drawing, no ANSI colors, and no progress indicators. This is the fully accessible baseline.

Auto-detection: the following environment variables or conditions switch ra11y to plain format automatically:

- `VOICE_OVER=1` (macOS)
- `NVDA=1` (Windows)
- `ORCA=1` (Linux)
- `TERM=dumb`

## Reporting accessibility issues

Accessibility bug reports are **prioritized over feature requests**. Please open an issue with the `a11y` label at `https://github.com/vanctran/ra11y/issues/new?labels=a11y`.

When reporting, please include:

- The surface affected (CLI output, HTML report, README, docs website)
- The assistive technology you're using and its version
- What you expected to hear/see and what actually happened
- Any output ra11y's `--format plain` and `--format json` produce, if relevant

We will acknowledge within 72 hours and aim to have a fix out in the next patch release.
