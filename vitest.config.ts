import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
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
