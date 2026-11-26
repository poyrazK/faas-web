import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Flat config, deliberately narrow.
 *
 * TypeScript already carries type safety here — `strict`, `noUnusedLocals`,
 * and `noUnusedParameters` are all on — so ESLint is scoped to the one class
 * of bug the compiler cannot see: hook misuse. A lint run that reports things
 * nobody intends to fix gets ignored wholesale, so anything that only ever
 * produced noise in this codebase is off rather than merely downgraded.
 */
export default tseslint.config(
  { ignores: ['dist', 'dist-ssr', 'src/routeTree.gen.ts', 'src/lib/api/schema.d.ts'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // `rules-of-hooks` and `exhaustive-deps` stay errors — they catch real,
      // silent bugs, and the stale-closure kind is exactly what this codebase
      // is exposed to with its timers and animation loops.

      /* --- React Compiler rules, downgraded ---------------------------------
         v7 of the plugin ships the compiler's own analyses. They are correct
         in the abstract, but they flag the deliberate "latest ref" pattern
         (`ref.current = prop` during render) that `store.tsx`, `build-log`,
         and the shader hooks all use on purpose to avoid re-subscribing an
         effect on every render. That pattern is load-bearing here, and each
         site is already commented explaining why. Warnings, so a genuinely
         new instance is still visible without failing the run.
         -------------------------------------------------------------------- */
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',

      // Duplicates `noUnusedLocals` / `noUnusedParameters`, which already fail
      // the build — a second underline for the same problem.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  }
);
