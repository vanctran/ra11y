# template-directives

**Guards:** commit `a554d27` (feat(mcp): actionable hints and explicit template-directive handling).

## What this fixture guards

When the HTML parser encounters Jinja/Liquid control directives (`{% extends %}`, `{% block %}`, `{% if %}`, `{% for %}`) or mustache-style interpolation (`{{ value }}`), it treats them as literal text — it does not render or execute the directives. The scanner's static analysis therefore runs against the template source, not any rendered output.

Commit `a554d27` surfaced this behavior explicitly via `meta.analysisCoverage.templateDirectiveHandling`, replacing the silent `templateDirectivesFound` array that told agents _that_ directives were seen but not _what the scanner did with them_. Agents use this field to calibrate scan confidence: if it ever silently disappears or changes wording to imply rendered analysis, the fixture fails.

## Why existing tools miss this

axe-core and Pa11y operate on rendered DOM; they never encounter raw template syntax. jsx-a11y is JSX-only. None of them expose scan-confidence telemetry about how template directives were handled. Ra11y is the only tool that both parses these files and emits an honest `templateDirectiveHandling` note agents can act on.

## Source files

- `base.jinja.html` — Jinja control directives (`{% extends %}`, `{% block %}`, `{% if %}`, `{% for %}`) plus `{{ }}` interpolation. Detected as `jinja-or-liquid`.
- `partial.html` — Mustache-style `{{ }}` interpolation only, no control directives. Detected as `handlebars-or-mustache`.

## Sanitization

Generic placeholder content throughout. No brand names, product copy, or real usernames.
