#!/usr/bin/env node
/**
 * Env completeness check — two explicit modes (plan Task 4 Step 5, review §7).
 *
 *   --manifest  Parse .env.production.example (names only, no values) and
 *               fail if any REQUIRED_KEYS entry is missing from the manifest.
 *               Runs on every PR — needs no secrets.
 *
 *   --runtime   Fail if any REQUIRED key in the manifest is absent from the
 *               CURRENT environment. Runs ONLY inside the promotion job,
 *               which executes in the `production` GitHub Environment and
 *               therefore sees the real vars. Never run this where
 *               production values don't exist — it can only fail there.
 *
 * Manifest conventions:
 *   KEY=     → required in production
 *   # KEY=   → optional (env-gated feature, no-ops when absent)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MANIFEST_PATH = resolve(process.cwd(), '.env.production.example');

/**
 * Keys the application code genuinely requires in production. The manifest
 * must contain every one of these — this catches "someone added a required
 * env var in code but forgot the manifest".
 */
const REQUIRED_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SITE_URL',
  'ENCRYPTION_KEY',
  'META_APP_ID',
  'META_APP_SECRET',
  'CRON_SECRET',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
];

function parseManifest() {
  const text = readFileSync(MANIFEST_PATH, 'utf8');
  const required = new Set();
  const optional = new Set();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const requiredMatch = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (requiredMatch) {
      required.add(requiredMatch[1]);
      continue;
    }
    const optionalMatch = /^#\s*([A-Z][A-Z0-9_]*)=/.exec(line);
    if (optionalMatch) optional.add(optionalMatch[1]);
  }
  return { required, optional };
}

function fail(message) {
  console.error(`✖ env-completeness: ${message}`);
  process.exit(1);
}

const mode = process.argv[2];
if (mode !== '--manifest' && mode !== '--runtime') {
  fail('usage: check-env-completeness.mjs --manifest | --runtime');
}

const { required, optional } = parseManifest();

if (mode === '--manifest') {
  const missing = REQUIRED_KEYS.filter(
    (k) => !required.has(k) && !optional.has(k)
  );
  if (missing.length > 0) {
    fail(`manifest is missing required key name(s): ${missing.join(', ')}`);
  }
  const demoted = REQUIRED_KEYS.filter((k) => optional.has(k));
  if (demoted.length > 0) {
    fail(`required key(s) are marked optional in the manifest: ${demoted.join(', ')}`);
  }
  console.log(
    `✓ env manifest OK — ${required.size} required, ${optional.size} optional key names declared.`
  );
} else {
  const missing = [...required].filter(
    (k) => !process.env[k] || process.env[k] === ''
  );
  if (missing.length > 0) {
    // Print NAMES only — never values.
    fail(`environment is missing required var(s): ${missing.join(', ')}`);
  }
  console.log(`✓ runtime environment complete — ${required.size} required vars present.`);
}
