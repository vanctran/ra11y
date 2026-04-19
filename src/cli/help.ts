/**
 * Help text for `--help` and `--version`.
 */

export const VERSION = "0.0.0";

export function renderHelp(): string {
  return `ra11y v${VERSION} — multi-standard accessibility scanner

USAGE
  ra11y [paths...] [options]

INPUT
  <paths>                Files or directories to scan (default: current dir)
  --ignore <pattern>     Substring patterns to exclude (repeatable)
  --exclude <pattern>    Alias for --ignore

OUTPUT
  -f, --format <type>    terminal | plain | json | sarif | junit | markdown
                         (default: terminal)
  --no-color             Disable ANSI colors
  --verbose              Show all violations with context
  --quiet                Errors only

STANDARDS
  --standard <list>      Comma-separated standard IDs (default: wcag22)
  --level <level>        A | AA | AAA (default: AA)
  --list-standards       List loaded standards with criterion counts

RULES
  --list-rules           List loaded rules
  --explain <rule>       Print rule detail (spec, examples, rationale)

BEHAVIOR
  --fail-on <level>      error (default) | warning | any | never

BASELINE
  --baseline <mode>      create | check | update (grandfather existing violations)
  --baseline-file <path> Override baseline path (default: .ra11y-baseline.json)
  ra11y baseline prune [--dry-run]
                         Remove baseline entries pointing at deleted files

ATTESTATIONS
  ra11y attestations prune [--dry-run]
                         Drop attestations pinned to deleted files

META
  -h, --help             Show this help
  -v, --version          Print version

EXAMPLES
  ra11y src/
  ra11y --standard wcag22,wcag21 --level AA src/
  ra11y --format json src/ > report.json
  ra11y --list-rules

DOCS
  https://github.com/vanctran/ra11y
`;
}
