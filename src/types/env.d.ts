/**
 * Ambient declaration of the environment variables ra11y reads.
 *
 * TypeScript's `noPropertyAccessFromIndexSignature: true` rejects
 * `process.env.NO_COLOR` because `ProcessEnv` is an index signature
 * `{ [key: string]: string | undefined }`. Biome's `useLiteralKeys`,
 * conversely, rejects `process.env["NO_COLOR"]`. The two rules
 * contradict unless the env var is a DECLARED property — which it
 * becomes via this augmentation.
 *
 * Every env var ra11y reads goes here. Unknown env vars still fall
 * through to the base index signature (string | undefined), so this
 * is additive — we don't lose typing for arbitrary lookups.
 */

declare namespace NodeJS {
  interface ProcessEnv {
    /** Disable ANSI colors regardless of TTY. https://no-color.org */
    readonly NO_COLOR?: string;
    /** Force ANSI colors on (1,2,3 = color level) or off (0). */
    readonly FORCE_COLOR?: string;
    /** Plain "dumb" terminal detection. */
    readonly TERM?: string;
    /** Promote logger to debug level when `"1"` or `"true"`. */
    readonly RA11Y_DEBUG?: string;
    /** Pre-commit hook passes the pending commit message here. */
    readonly RA11Y_COMMIT_MESSAGE?: string;
    /** VPAT snapshot-test timestamp override for deterministic output. */
    readonly RA11Y_FIXED_TIMESTAMP?: string;
    /** Path to a user config file override. */
    readonly RA11Y_CONFIG?: string;
    /** Default standard override from the environment. */
    readonly RA11Y_STANDARD?: string;
    /** Default level override from the environment. */
    readonly RA11Y_LEVEL?: string;
    /** Claude Code hook: the project root for hook scripts. */
    readonly CLAUDE_PROJECT_DIR?: string;
  }
}
