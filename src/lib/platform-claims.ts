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

/** Shared by the home page and public agent documentation. */
export const PLATFORM_AVAILABILITY =
  'Hosting and PR previews are generally available. MCP hosting and isolated runs are in preview.';
