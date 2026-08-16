import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Vendored minified opus-recorder encoder worker (served statically).
    'public/opus/**',
    // Agent skill packs and the memory system. These are vendored authoring
    // tools (CommonJS helper scripts, p5.js templates) that never enter the
    // app build. Linting them as app source produced ~40 spurious
    // no-require-imports/no-unused-vars failures and made `pnpm check` red
    // for reasons unrelated to the product.
    '.agents/skills/**',
    'v0_memories/**',
  ]),
  {
    rules: {
      // Enterprise convention: a leading underscore marks an intentionally
      // unused variable/argument (e.g. destructuring to omit a field).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Vendored third-party components (kept intentionally close to their
    // upstream source, see file headers). Don't hold them to our strictest
    // React Compiler rules — fixing these locally would fork upstream.
    files: ['src/components/tremor/**'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);

export default eslintConfig;
