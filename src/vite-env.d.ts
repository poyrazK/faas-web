/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Feature flags (`VITE_FEATURE_*`) are deliberately not declared here. They
   * are declared once, as data, in `src/lib/feature-flags.ts` — adding one
   * should be a single line, not a line plus a type. Vite's own
   * `ImportMetaEnv` carries an index signature, so the registry reads them
   * without a cast. Read flags from that module, never from here.
   */

  /**
   * Absolute API origin. Leave unset — the console is served from the same
   * origin as `apid`, so requests are relative and the session cookie works.
   * Setting this points the console at another box, which then has to send
   * CORS headers; the production one does not. See `src/lib/api/client.ts`.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
