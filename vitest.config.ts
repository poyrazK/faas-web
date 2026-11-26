import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { apiReference } from './src/lib/api-reference/plugin';

/**
 * Pure `.test.ts` files that touch browser globals (`window`, `document`,
 * `localStorage`, DOM APIs, or `@testing-library/*`) still run in `jsdom`
 * with `./src/test/setup.ts`. All other `.test.ts` suites run directly in
 * `node` so they do not pay per-worker `jsdom` startup overhead.
 */
const DOM_TS_TESTS = [
  'src/components/dashboard/app-overview-words.test.ts',
  'src/lib/api/client.test.ts',
  'src/lib/api/log-drain-capabilities.test.ts',
  'src/lib/api/logout.test.ts',
  'src/lib/api/password.test.ts',
  'src/lib/api/status.test.ts',
  'src/lib/auth.test.ts',
  'src/lib/environment-scope.test.ts',
  'src/lib/error-reporting.test.ts',
  'src/lib/image-operation.test.ts',
  'src/lib/mock-spec-drift.test.ts',
  'src/lib/moved-route.test.ts',
  'src/lib/onboarding-draft.test.ts',
  'src/lib/onboarding-events.test.ts',
  'src/lib/queue-binding-operation.test.ts',
  'src/lib/queue-binding-write.test.ts',
  'src/lib/queue-workload-attempt.test.ts',
  'src/lib/restore-attempt.test.ts',
  'src/lib/workspace.test.ts',
];

/**
 * Separate from `vite.config.ts` on purpose: the app config runs the TanStack
 * router plugin, which regenerates `routeTree.gen.ts` as a side effect. A test
 * run should not rewrite source files, so this config carries only what the
 * tests need — React, and the `@` alias.
 */
export default defineConfig({
  plugins: [react(), apiReference()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    pool: 'forks',
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          globals: true,
          include: ['src/**/*.test.ts', 'mock/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...DOM_TS_TESTS],
          setupFiles: [],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.tsx', 'mock/**/*.test.tsx', ...DOM_TS_TESTS],
        },
      },
    ],
  },
});
