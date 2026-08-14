import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `server-only` is a build-time guard with no Node entry point, so
      // importing any module that uses it (e.g. src/lib/email/mailer.ts)
      // throws "Cannot find package" under Vitest. Alias it to an empty
      // stub so server modules are unit-testable; the real package is
      // still resolved by the Next.js client build, so the guard against
      // importing server code into a client bundle is unaffected.
      'server-only': new URL(
        './src/lib/test/server-only-stub.ts',
        import.meta.url
      ).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Dummy secrets — encryption.ts / webhook-signature.ts read these
    // at module load. Tests never hit a real Meta/Supabase service, so
    // any 32-byte hex / non-empty string will do; keep them lexically
    // identical to the CI build env so behaviour matches.
    env: {
      ENCRYPTION_KEY:
        '0000000000000000000000000000000000000000000000000000000000000000',
      META_APP_SECRET: 'test-meta-app-secret',
      // Blank out Upstash credentials so the rate limiter always uses
      // its in-memory fallback in unit tests. The dev VM has REAL
      // Upstash env vars; without this, tests hit live Redis where
      // counters persist across runs (shared 60s windows) and fail
      // nondeterministically. Tests that exercise the Redis path stub
      // these back in explicitly.
      KV_REST_API_URL: '',
      KV_REST_API_TOKEN: '',
    },
    clearMocks: true,
  },
});
