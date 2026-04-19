# Configuration

ra11y works out of the box with no configuration — `ra11y src/` runs WCAG 2.2 AA against your files and exits. Most projects reach for a config when they want to:

- Enable multiple standards at once (WCAG 2.2 + Section 508)
- Downgrade specific rules from error to warning
- Turn a rule off entirely
- Apply different rules to different directories (`src/legacy/` vs `src/new/`)
- Exclude specific paths beyond the defaults

## File resolution

ra11y walks up from `cwd` looking for, in order:

1. `ra11y.config.ts`
2. `ra11y.config.js`
3. `ra11y.config.mjs`
4. `ra11y.config.json`

The search stops at the first match, at the nearest `.git` directory, or at the filesystem root — whichever comes first. Override the auto-discovery with `--config <path>` on the CLI or `RA11Y_CONFIG=<path>` in the environment.

If no config file is found, ra11y uses [`DEFAULT_CONFIG`](https://github.com/vanctran/ra11y/blob/main/src/config/defaults.ts) — WCAG 2.2 AA, no rule overrides, no excludes beyond the built-in ignored directories.

## Example: TypeScript config

```ts
// ra11y.config.ts
import { defineConfig } from "@ra11y/core";

export default defineConfig({
  standards: ["wcag22", "section508"],
  level: "AA",
  exclude: ["**/*.test.tsx", "vendor/"],
  rules: {
    "contrast/minimum": "warn",
    "parsing/duplicate-id": "off",
  },
  overrides: [
    {
      files: ["src/legacy/**/*.tsx"],
      rules: {
        "contrast/minimum": "off",
        "keyboard/handler-missing": "warn",
      },
    },
  ],
});
```

## Example: JSON config

```json
{
  "standards": ["wcag22"],
  "level": "AA",
  "rules": {
    "contrast/minimum": "error",
    "parsing/duplicate-id": "off"
  }
}
```

JSON configs don't support the `defineConfig` helper (it's a TS identity function) or plugin imports, so they're best for simple setups. Use `.ts`/`.js` for anything beyond trivial.

## Full field reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `standards` | `(string \| Standard)[]` | `["wcag22"]` | Standard IDs to enforce. Built-in: `wcag22`, `wcag21`, `section508`, `en301549`. Can also pass a `defineStandard()` result for plugin standards. |
| `level` | `"A" \| "AA" \| "AAA"` | `"AA"` | Conformance level within WCAG-derived standards. |
| `rules` | `Record<string, RuleSetting>` | `{}` | Per-rule severity overrides. See below. |
| `exclude` | `string[]` | `[]` | Path substrings to skip. Concatenated with CLI `--exclude`. |
| `overrides` | `ConfigOverride[]` | `[]` | Per-directory rule overrides. Last match wins. |
| `projects` | `ProjectConfig[]` | `[]` | Monorepo / workspace sub-projects. v0.1.0 preview — full support in v0.2.0. |

## Rule settings

Each entry in `rules` maps a rule ID to a `RuleSetting`:

| Setting | Behavior |
|---------|----------|
| `"error"` | Rule fires at `error` severity (contributes to `--fail-on error`) |
| `"warning"` | Rule fires at `warning` severity |
| `"info"` | Rule fires at `info` severity |
| `"off"` | Rule is not loaded at all |

Rule IDs match the `id` field in the rule file — run `ra11y --list-rules` to see the full list. Examples:

- `"contrast/minimum"`
- `"media/alt-text-missing"`
- `"navigation/link-descriptive-text"`
- `"parsing/duplicate-id"`
- `"keyboard/handler-missing"`

## Per-directory overrides

The `overrides` array lets you scope rule settings to subsets of files. Each entry is:

```ts
{
  files: readonly string[];            // glob-like patterns, matched as substrings for now
  rules?: Record<string, RuleSetting>;
}
```

Overrides are evaluated in order; later matches take precedence over earlier ones. Rules not mentioned in an override inherit the top-level `rules` setting (or the default severity if not listed anywhere).

```ts
overrides: [
  // Legacy code: relax everything to warn, we'll fix it as we touch it.
  {
    files: ["src/legacy/"],
    rules: {
      "contrast/minimum": "warn",
      "keyboard/handler-missing": "warn",
      "forms/labels-required": "warn",
    },
  },
  // Public-facing landing: be strict, this is the user's first impression.
  {
    files: ["src/pages/public/"],
    rules: {
      "contrast/minimum": "error",
      "navigation/link-descriptive-text": "error",
    },
  },
],
```

## Precedence

CLI flags always win over config-file values. The full precedence (highest to lowest):

1. **CLI flags** — `--standard wcag21,wcag22`, `--level AAA`, `--exclude foo`, etc.
2. **Environment variables** — `RA11Y_STANDARD`, `RA11Y_LEVEL`, `RA11Y_CONFIG`
3. **Config file** — `ra11y.config.ts` walking up from cwd
4. **Built-in defaults** — `DEFAULT_CONFIG`

The CLI vs. config-file merge rule is "CLI value wins unless it's the default." A future release will improve this by tracking explicit vs. default values in the args parser so the merge becomes unambiguous; for now, passing a flag explicitly always takes precedence over the config file.

## Inline disables

Beyond the config file, individual violations can be suppressed via comment pragmas:

```tsx
// ra11y-disable-next-line contrast/minimum
<div className="text-gray-300 bg-white">Muted note</div>

/* ra11y-disable contrast/minimum */
<LegacyBanner />
<LegacyCard />
/* ra11y-enable contrast/minimum */
```

Supported comment styles: `//`, `/* */`, `<!-- -->`, `{/* */}`. Rule lists can be comma- or space-separated. Omit the rule list to suppress all rules on the target line. Trailing `-- reason:` text is parsed as a human note and not as more rule IDs:

```tsx
// ra11y-disable-next-line contrast/minimum -- legacy, will fix in #1234
```

### JSDoc `@ra11y-intentional` tag

A JSDoc block attached to a function/class/variable declaration can carry an `@ra11y-intentional <reason>` tag. The tag is functionally a file-scoped `ra11y-disable *` pragma limited to the decorated declaration's body (brace-balanced), intended for Storybook-style "intentionally bad example" components where the demo must keep its violation on-screen:

```tsx
/** @ra11y-intentional demo of missing alt attribute */
export function BadImageExample() {
  return <img src="/teaching/chart.png" />;
}
```

The reason slot is required: a bare `@ra11y-intentional` (no reason text) is **not** honored — the decorated declaration is scanned normally and a `suppression/no-reason` review candidate surfaces so the author adds the justification. Same grammar as the inline pragmas above; see `src/config/inline-disables.ts`.

## Plugin standards and rules

Standards and rules are both pluggable. Import them directly in `ra11y.config.ts`:

```ts
import { defineConfig } from "@ra11y/core";
import customRule from "./lint/ra11y-no-placeholder-as-label.ts";
import acmeStandard from "./lint/ra11y-standard-acme.ts";

export default defineConfig({
  standards: ["wcag22", acmeStandard],
  rules: {
    [customRule.id]: "error",
  },
});
```

See `examples/plugin-rule/` and `examples/plugin-standard/` for templates. Full plugin-loader wiring (the `plugins: { rules: [...], standards: [...] }` field) lands in v0.2.0; for v0.1.0 you import the plugin object and reference it directly.
