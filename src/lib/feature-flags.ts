/**
 * Build-time feature flags.
 *
 * The reason this exists: the console is regularly built ahead of `apid`. A
 * screen whose endpoint ships next week still has to live on `main` without
 * reaching customers, and a long-lived branch is the worse answer — it drifts
 * until the work it carries is silently obsolete.
 *
 * Vite inlines `import.meta.env.VITE_*` at build time, so a flag is a
 * compile-time constant: changing one takes a rebuild and a redeploy, not a
 * toggle. Values are public client configuration — never put a secret behind
 * one.
 *
 * Everything fails closed. Only the exact strings "1" and "true" enable a flag,
 * whitespace is not trimmed, and an unset variable is omitted from the inlined
 * object entirely rather than set empty. A typo, a missing Vercel value, or a
 * stray space therefore lands on the shipped behaviour, never the half-built
 * one.
 *
 * **Why each flag is written out longhand, and why nothing here is frozen.**
 * Both a lookup table (`env[FLAGS[key]]`) and an `Object.freeze` wrapper defeat
 * Rollup's constant folding, and the difference is not cosmetic: with either
 * one, the code behind a disabled flag is still emitted into the production
 * bundle, where anyone can read an unreleased feature in devtools. Written as a
 * literal property over a literal `import.meta.env` access, the comparison
 * folds to `false` and the whole branch is eliminated. The registry is
 * immutable through its type instead — which is where mutation would be caught
 * anyway. Verified in both directions; see `feature-flags.test.ts`.
 */

/**
 * The one place a flag string is interpreted.
 *
 * Exported for its tests: this is the whole of the semantics, so it is what the
 * suite pins, rather than whichever flags happen to be live this week.
 */
export function enabled(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

/**
 * Every flag. **One entry per flag** — read them from here, never from
 * `import.meta.env` directly (`feature-flags.test.ts` enforces that and names
 * the offending file).
 *
 * Keep the access literal. `enabled(import.meta.env.VITE_FEATURE_X)` folds at
 * build time; anything indirect does not.
 */
export const featureFlags = {
  /** Reference flag. Gates nothing; proves the wiring and shows the shape. */
  example: enabled(import.meta.env.VITE_FEATURE_EXAMPLE),
} as const;

export type FeatureFlags = typeof featureFlags;
export type FlagName = keyof FeatureFlags;
