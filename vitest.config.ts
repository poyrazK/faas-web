import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Separate from `vite.config.ts` on purpose: the app config runs the TanStack
 * router plugin, which regenerates `routeTree.gen.ts` as a side effect. A test
 * run should not rewrite source files, so this config carries only what the
 * tests need — React, and the `@` alias.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // jsdom for everything: the pure-logic suites do not need it, but a single
    // environment keeps the config honest and the cost is milliseconds.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'mock/**/*.test.{ts,tsx}'],
  },
});
