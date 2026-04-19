# attest-lighthouse

Guards the Lighthouse accessibility audit → attest bridge pattern (V1-FIXTURE-ATTEST, 2026-04-19).

## Failure mode this locks in

The bridge pattern instructs agents to map Lighthouse accessibility audit results to `attest`
calls. This fixture ensures the TypeScript pattern the doc teaches is valid code — no parse
errors, no spurious violations fired on non-JSX TypeScript.

## Which assertion locks it in

`zero-parse-errors` — if the agent-bridge.ts pattern becomes invalid TypeScript, this
fails immediately. `no-violation` — guards against rules over-firing on non-JSX code.
`meta-field { filesByExtension.".ts": 1 }` — confirms the JSON report is correctly
excluded from scanner parsing (scanner skips `.json`).

## Sources

- `lighthouse-report.json` — synthetic Lighthouse 11.4.0 output with 3 failing audits
  (color-contrast, image-alt, label) and 3 passing audits (document-title, html-has-lang,
  link-name). Not parsed by the scanner; present as an illustrative artifact.
- `agent-bridge.ts` — the canonical bridge implementation the doc teaches. Parsed by
  the scanner; must compile cleanly.

## Sanitization

All URLs, selectors, and content are synthetic. No real project identifiers.
