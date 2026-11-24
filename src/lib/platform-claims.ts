/**
 * Public copy with one home.
 *
 * Each constant here was restated by hand in more than one place and drifted
 * at least once. `src/lib/platform-claims.test.ts` scans the tree for a second
 * copy, so a new surface imports from here rather than retyping the words.
 */

/** Keep the statistic and measured boundary together in every public claim. */
export const RESTORE_TARGET = 'SSD platform-only snapshot-restore p95 target: below 350 ms';
export const RESTORE_CONTEXT =
  'Public request latency also includes network transit and can be higher. A fresh cold boot is a separate path.';
export const RESTORE_DOC_SLUG = 'scale-to-zero';

/**
 * Every CLI release so far is a prerelease, published under npm's `rc` tag.
 * The bare package name resolves `latest`, which can lag the beta channel by
 * several builds (faas-web#120). Switching the recommendation to `latest` is a
 * deliberate change for after the first stable release, not a cleanup.
 */
export const INSTALL_COMMAND = 'npm install -g gregale@rc';
export const INSTALL_DOC_SLUG = 'install';

export const START_FREE_CTA = 'Start free';

/**
 * The idle ladder's billing effect (faas ADR-20261107122928; docs
 * cold-wake.md "Paused between requests"): a request-serving instance pauses
 * about a second after its last request and paused seconds are not billed.
 * Live for every account since 2026-11-22.
 */
export const IDLE_BILLING_CLAIM = 'Billing stops about a second after each request.';
export const IDLE_BILLING_DOC_SLUG = 'scale-to-zero';

/**
 * Shared by the home page and public agent documentation. Each capability's
 * word follows faas's catalog (apps, pr-previews, mcp-hosting,
 * disposable-runs); `platform-claims.test.ts` fails when a pull moves one.
 */
export const PLATFORM_AVAILABILITY =
  'Hosting and PR previews are generally available. MCP hosting is in beta. Isolated runs are in preview.';
