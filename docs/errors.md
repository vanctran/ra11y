# ra11y error reference

Canonical index of every error an agent can surface from ra11y: MCP structured errors and CLI exit codes.

MCP tools return errors as a `structuredContent` envelope with `isError: true`. Agents branch on the `code` field — never on the English `message`. The `remediation` field, when present, states what to call next.

CLI exit codes are written to the process exit status. stderr carries a plain-text description when the exit is non-zero.

---

## MCP structured errors

Each row below lists the code, the tools that emit it, the condition that fires it, and the recovery action.

Two codes — `reason-required` and `line-out-of-range` — are local to the `suppress` tool. They are cast through `StructuredErrorCode` at the call site and serialise identically over the wire; the central registry in `src/mcp/tools-helpers.ts` does not enumerate them.

### Parameter validation

| Code | Tools | Fires when | Recovery |
|------|-------|-----------|----------|
| `missing-required-param` | `scan`, `scan_file`, `scan_process`, `suggest_fix`, `apply_fix`, `attest`, `suppress`, `explain_standard` | A required parameter is absent or empty. `details.param` names the missing field. | Re-call with the parameter present and non-empty. |
| `invalid-param` | `suppress`, `attest`, `conformance_statement` | A parameter is present but its value is semantically invalid (wrong type, out-of-range enum, empty array where non-empty is required). `details` carries the received value. | Inspect `details` and correct the value before retrying. |
| `mode-invalid` | `baseline` | The `mode` parameter is not one of `create`, `check`, `update`. | Pass `mode` as `"create"`, `"check"`, or `"update"`. |
| `conflicting-file-params` | `apply_fix`, `suggest_fix` | Both the canonical `file` and the deprecated `filePath` alias were supplied. | Drop `filePath`; use only `file`. |

### Registry lookups

| Code | Tools | Fires when | Recovery |
|------|-------|-----------|----------|
| `rule-not-found` | `suggest_fix`, `rule_info` (via `tools.ts`) | The supplied `ruleId` does not match any loaded rule. | Call `list_rules` to enumerate valid IDs. |
| `standard-not-found` | `coverage`, `list_rules`, `review_candidates`, `checklist`, `conformance_statement`, `explain_standard` | The supplied `standard` (or `standardId`) does not match any loaded standard. `details.loaded` lists the valid IDs. | Pass one of the IDs from `details.loaded`. |
| `criterion-not-found` | `review_candidates`, `attest` | The `criterionId` does not match any criterion in any loaded standard. | Use the form `<standardId>:<localId>` (e.g. `wcag22:2.4.7`). Call `explain_standard` to browse criteria. |
| `rule-not-under-criterion` | `attest` | One or more `ruleIds` entries exist in the registry but do not satisfy the requested `criterionId`. An attestation of those rules would not contribute to that criterion's coverage. `details.satisfyingRules` lists the IDs that do satisfy it. | Drop the non-matching IDs or choose a different `criterionId`. |

### Scan target / path errors

| Code | Tools | Fires when | Recovery |
|------|-------|-----------|----------|
| `cwd-not-found` | `scan_project`, `bootstrap`, `propose_config`, `propose_baseline`, `wrapper_introspect` | The explicit `cwd` parameter names a directory that does not exist on disk. | Pass an existing directory. Omit `cwd` to fall back to the server's spawn directory. |
| `scan-paths-not-found` | `scan` | Every path in the `paths` array is missing on disk. (Zero parseable files in a real directory is a soft warning, not this error.) | Verify paths exist before calling. Relative paths resolve against `cwd`. |
| `path-escapes-cwd` | `apply_fix`, `suppress` | The resolved file path is outside the session `cwd` tree (directory traversal attempt). | Pass a path inside the project root. |
| `file-not-found` | `suppress` | The target file does not exist at the given path. | Verify the file exists before calling. |
| `file-unsupported` | `scan_file`, `suggest_fix`, `apply_fix`, `suppress` | The file extension is not `.tsx`, `.jsx`, `.ts`, `.js`, `.html`, `.htm`, or `.css`; or the file exists but cannot be parsed. | Pass a supported file type. |
| `file-read-failed` | `apply_fix`, `suppress` | The file exists and has a supported extension, but reading or parsing it raised an I/O or parse error. `details.cause` carries the underlying message. | Inspect `details.cause`; fix permissions or encoding issues, then retry. |
| `file-write-failed` | `apply_fix`, `attest`, `suppress` | A disk write failed after all pre-checks passed. `details.cause` carries the underlying message. | Check disk space and file permissions, then retry. |

### Baseline lifecycle

| Code | Tools | Fires when | Recovery |
|------|-------|-----------|----------|
| `baseline-not-found` | `baseline`, `scan_diff` | The baseline file does not exist at the resolved path. | Run `baseline` with `mode: "create"` first, or pass the correct `baselinePath`. |
| `baseline-load-failed` | `baseline`, `scan_diff` | The baseline file exists but cannot be parsed (malformed JSON or version mismatch). `details.cause` carries the parse error. | Regenerate with `baseline` `mode: "create"`. |

### Write guard

| Code | Tools | Fires when | Recovery |
|------|-------|-----------|----------|
| `allow-write-disabled` | `apply_fix`, `attest`, `suppress` | The tool attempted a disk write but the session was started without `allowWrite: true`. | Restart the MCP session with `allowWrite: true` set in the session configuration. |

### Git-aware scope

| Code | Tools | Fires when | Recovery |
|------|-------|-----------|----------|
| `no-staged-files` | `scan_project` | `changedOnly: true` was set but `git diff --cached` returns no files. The scan would otherwise silently run against the full tree. | Stage the files to scan (`git add <path>`), or drop `changedOnly` for a full scan. |
| `not-a-git-repo` | `scan_diff` | `hunksOnly` mode requires a git repository but the `cwd` is not inside one. (`scan_project` with `changedOnly` or `since` in a non-git directory falls back to a full scan rather than erroring.) | Run from inside a git checkout, or drop `hunksOnly` to use baseline mode. |
| `unknown-ref` | `scan_diff` | The `comparisonRef` does not resolve in the local git repository. | Pass an existing ref (`main`, `HEAD~1`, a commit SHA). Fetch the remote if comparing against an origin branch. |

### Edit safety gates

| Code | Tools | Fires when | Recovery |
|------|-------|-----------|----------|
| `edit-shape-invalid` | `apply_fix` | An edit object in the `edits` array has an unrecognised `kind` or is missing required fields. `details` names the bad edit. | Inspect `details` and correct the edit shape. Valid `kind` values: `edit`, `insert-before`, `insert-after`. |
| `edit-no-match` | `apply_fix` | The `oldText` for an edit was not found in the file. The file may have changed since `suggest_fix` was called. | Re-call `suggest_fix` to get a fresh suggestion, then re-apply. |
| `edit-multiple-matches` | `apply_fix` | The `oldText` for an edit matched more than one location in the file. The match is ambiguous. | Widen `oldText` to include enough surrounding context to be unique, then retry. |
| `edit-introduces-parse-errors` | `apply_fix` | The edit would produce source that the ra11y parser cannot parse. The file is not written. `details.errors` lists the parse errors. | Revise the edit to produce valid syntax. |

### Suppress-specific

These two codes are emitted only by `suppress` and are not in the central `StructuredErrorCode` union; they are cast through it and serialise identically.

| Code | Fires when | Recovery |
|------|-----------|----------|
| `reason-required` | `reason` is absent or empty. A suppression without a stated reason is rejected by design. | Re-call with a non-empty `reason` that explains why the finding is a false positive, intentional, or out-of-scope. |
| `line-out-of-range` | The `line` number is past the end of the file. `details.totalLines` gives the actual file length. | Pass a valid line number (1–`totalLines`). |

### Meta-tool errors

| Code | Tools | Fires when | Recovery |
|------|-------|-----------|----------|
| `audit-sub-tool-threw` | `audit`, `bootstrap` | An internal sub-tool handler threw an exception rather than returning an `McpToolResult`. | Report the `details.cause` as a bug. |
| `audit-sub-tool-unparseable` | `audit`, `bootstrap` | An internal sub-tool returned a result whose `structuredContent` could not be parsed. | Report the `details` as a bug. |

---

## CLI exit codes

| Code | Meaning | Emitting commands |
|-----:|---------|-------------------|
| `0` | Success. Scan clean, or `--fail-on never`, or `--baseline check` with no new violations, or a read-only command completed normally. | All commands |
| `1` | Violations found at or above the `--fail-on` threshold; or `--init` declined to overwrite an existing config; or `--doctor` found hard errors in the environment. | `scan`, `init`, `doctor` |
| `2` | User error: bad config, unknown standard or profile, missing baseline or attestation file, unknown rule ID, unrecognised command argument. | `scan`, `explain`, `baseline`, `attestations` |
| `3` | `--baseline check` detected new violations not present in the baseline. | `scan --baseline check` |

Exit code `3` is specific to `scan --baseline check`. No other command uses it. The distinction from `1` lets CI pipelines treat "new violations" differently from "violations above threshold."

All non-zero exits write a plain-text description to stderr. The description is for human reading; scripts should branch on the exit code, not the text.
