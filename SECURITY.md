# Security policy

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities. Report them privately via [GitHub's private vulnerability reporting](https://github.com/vanctran/ra11y/security/advisories/new) with:

- A description of the vulnerability
- Steps to reproduce
- The version of ra11y affected
- Your assessment of the impact

We will acknowledge receipt within 72 hours and work with you on a coordinated disclosure timeline. If the issue is accepted, you will be credited in the advisory and release notes (unless you prefer to remain anonymous).

## Supported versions

During v0.x, only the latest minor version receives security fixes. After v1.0, the previous minor line will also receive critical fixes for a transition period announced in the release notes.

## Supply chain

ra11y is designed to minimize supply-chain risk:

- **Zero runtime dependencies.** The `dependencies` field in `package.json` is empty. CI fails any PR that adds to it.
- **Narrow devDependencies.** Only TypeScript, Bun types, Biome, and a small set of documentation tools (typedoc, mermaid-cli, markdownlint-cli2).
- **Lockfile integrity.** CI fails if `bun.lock` changed without a corresponding `package.json` change.
- **Provenance.** npm publishes use `--provenance` so every published version has cryptographic attestation linking it to its source commit.
- **Two-factor authentication** is required on the npm account.
- **Minimal release permissions.** The GitHub Actions release workflow has only `id-token: write` and `contents: read`.

## Network isolation

ra11y is a local, offline-first tool. The scanner **never makes network calls** during a scan. No telemetry. No phone-home. No analytics. No remote rule updates. No version-check pings.

This is enforced by `scripts/check-network-isolation.ts`, which greps `src/` for `fetch`, `node:http`, `node:https`, `node:net`, `node:dns`, and `Bun.fetch`. Any occurrence outside an explicitly whitelisted location fails the build.

If telemetry is ever added, it will be **opt-in** via an explicit config flag and documented in a `PRIVACY.md` at the repo root.

The `ra11y doctor` command reports "network calls: none" so users can verify at runtime.

## Plugin trust model

**Plugins are code.** Installing a ra11y plugin from a third party is equivalent to installing a dev dependency — review the source before trusting it.

Plugins run with full Node.js permissions. A malicious plugin has full filesystem and network access. **ra11y does not sandbox plugin execution** in v0.1.0.

If you need sandboxed execution (e.g., for evaluating untrusted plugins), run ra11y inside a Docker container with `--network=none` and a read-only mount of your source:

```sh
docker run --rm --network=none \
  -v "$PWD:/workspace:ro" \
  -w /workspace \
  node:22-alpine \
  npx @ra11y/core src/
```

A capability-based plugin API may land in a future major version; it is not in scope for v0.1.0.
