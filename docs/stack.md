# Current stack (as of 2026-04-11)

Pinned tool versions and spec references for ra11y. Before upgrading any row, invoke `/research-latest <package>` and update this file with a new "as of" date at the top.

| Tool           | Version   | Source                                                                   |
|----------------|-----------|--------------------------------------------------------------------------|
| TypeScript     | 6.0.x     | https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/     |
| Bun            | 1.3.11    | https://github.com/oven-sh/bun/releases                                  |
| Node LTS       | 24.x (active), 22.x (maintenance) | https://nodejs.org/en/about/previous-releases  |
| Biome          | 2.4.11    | https://www.npmjs.com/package/@biomejs/biome                             |
| WCAG           | 2.2 (W3C Rec, 2023-10-05; update 2024-12-12; ISO/IEC 40500:2025) | https://www.w3.org/TR/WCAG22/ |
| WCAG           | 2.1 (W3C Rec, still referenced by many legal frameworks) | https://www.w3.org/TR/WCAG21/ |
| Section 508    | 2017 refresh (references WCAG 2.0) | https://www.access-board.gov/ict/        |
| EN 301 549     | v3.2.1 (references WCAG 2.1) | https://www.etsi.org/deliver/etsi_en/301500_301599/301549/ |
| SARIF          | 2.1.0     | https://docs.oasis-open.org/sarif/sarif/v2.1.0/                          |

## Notes

**Never assume a version from memory.** Treat any row older than a few months as stale; re-run `/research-latest` before acting on it.

**TypeScript 6.0 is the last release on the current JS codebase.** TypeScript 7 will be the Go rewrite. Treat 6.0 as stable; hold off on 7 until its ecosystem settles. We target TS 6.0 as the peer and devDependency, but the scanner's public API must remain callable from any TS ≥5.4 consumer (per `peerDependencies`).
