#!/usr/bin/env node
/**
 * Env completeness check — three explicit modes (plan Task 4 Step 5, review §7).
 *
 *   --manifest  Parse .env.production.example (names only, no values) and
 *               fail if any REQUIRED_KEYS entry is missing from the manifest.
 *               Runs on every PR — needs no secrets.
 *
 *   --contract  Static analysis of the environment *contract*: prove that
 *               legacy alias names appear only inside src/lib/env.ts, that
 *               every env var the code reads is documented in a manifest,
 *               that no server secret hides behind a NEXT_PUBLIC_ prefix,
 *               and that no manifest entry is dead. Needs no secrets.
 *
 *   --runtime   Fail if any REQUIRED key in the manifest is absent from the
 *               CURRENT environment. Runs ONLY inside the promotion job,
 *               which executes in the `production` GitHub Environment and
 *               therefore sees the real vars. Never run this where
 *               production values don't exist — it can only fail there.
 *
 * WHY --contract EXISTS
 * `src/lib/env.ts` centralized four spellings of the service-role key and
 * three of the database URL. Centralizing once is easy; *staying*
 * centralized is the hard part — the drift it fixed accumulated one
 * innocent `process.env.SUPABASE_SECRET_KEY ?? …` at a time, each added
 * by someone debugging a single broken deployment. Code review does not
 * reliably catch the second copy of a fallback chain. This does.
 *
 * Manifest conventions:
 *   KEY=     → required in production
 *   # KEY=   → optional (env-gated feature, no-ops when absent)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const MANIFEST_PATH = resolve(process.cwd(), '.env.production.example');
const LOCAL_MANIFEST_PATH = resolve(process.cwd(), '.env.local.example');
const ENV_MODULE_PATH = resolve(process.cwd(), 'src/lib/env.ts');

/**
 * Keys the application code genuinely requires in production. The manifest
 * must contain every one of these — this catches "someone added a required
 * env var in code but forgot the manifest".
 *
 * META_APP_ID / META_APP_SECRET are deliberately NOT here. Provider
 * credentials are configured in-app and stored encrypted per tenant
 * (`src/lib/crypto/secrets.ts`); these two are app-level Meta identifiers
 * that only the WhatsApp Cloud paths need. Listing them as required made
 * promotion impossible before a Meta app existed, for a product whose
 * other channels work without one. Absent, webhook signature
 * verification fails closed and image-header template submission returns
 * a clear error — nothing else is affected.
 */
const REQUIRED_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SITE_URL',
  'ENCRYPTION_KEY',
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

/** Every KEY= / # KEY= name declared in a manifest file. */
function parseManifestNames(path) {
  const names = new Set();
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const match = /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(raw.trim());
    if (match) names.add(match[1]);
  }
  return names;
}

/**
 * The alias registry, read out of `src/lib/env.ts` itself rather than
 * duplicated here — a second list would be one more thing to keep in
 * sync, which is the exact failure mode this check exists to prevent.
 *
 * Every `const FOO_NAMES = [...] as const` block in that file is a
 * resolution chain: element 0 is canonical, the rest are aliases.
 */
function parseAliasRegistry() {
  const text = readFileSync(ENV_MODULE_PATH, 'utf8');
  const aliases = new Set();
  const canonical = new Set();
  const chains = [];
  const blockRe = /const\s+[A-Z0-9_]*_NAMES\s*=\s*\[([^\]]*)\]/g;
  let match;
  while ((match = blockRe.exec(text)) !== null) {
    const names = [...match[1].matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)].map(
      (m) => m[1]
    );
    if (names.length === 0) continue;
    chains.push(names);
    canonical.add(names[0]);
    for (const alias of names.slice(1)) aliases.add(alias);
  }
  if (aliases.size === 0) {
    fail(
      'could not parse any alias chain out of src/lib/env.ts — the *_NAMES ' +
        'convention changed, so this check is silently passing. Fix parseAliasRegistry().'
    );
  }
  return { aliases, canonical, chains };
}

/** Every tracked source file under the given roots. */
function collectSources(roots, extensions) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (extensions.some((ext) => entry.endsWith(ext))) files.push(full);
    }
  };
  for (const root of roots) {
    try {
      walk(resolve(process.cwd(), root));
    } catch {
      // Root absent in this checkout — nothing to scan.
    }
  }
  return files;
}

/**
 * Files permitted to spell a legacy alias.
 *
 * `next.config.ts` is here because Next inlines `NEXT_PUBLIC_*` by
 * matching literal `process.env.X` text at build time and cannot import
 * from `src/`, so its resolution chain has to be written out. Its own
 * header explains the duty to mirror `src/lib/env.ts` exactly.
 */
const ALIAS_ALLOWLIST = [
  'src/lib/env.ts',
  'src/lib/env.test.ts',
  'next.config.ts',
  'scripts/check-env-completeness.mjs',
  'scripts/lib/db-url.mjs',
];

/**
 * `NEXT_PUBLIC_` marks a value Next.js inlines into the client bundle.
 * These substrings mark a value that must never be inlined. `KEY` and
 * `TOKEN` alone are NOT on the list: `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
 * `NEXT_PUBLIC_CF_ANALYTICS_TOKEN` are both public by design.
 */
const SECRET_MARKERS = ['SECRET', 'SERVICE_ROLE', 'PASSWORD', 'PRIVATE'];

/**
 * `next.config.ts` re-implements two alias chains because Next inlines
 * `NEXT_PUBLIC_*` by literal text match and cannot import from `src/`.
 * A copy is tolerable; a copy that DRIFTS is not — the two files
 * disagreeing means a server render and a browser render can resolve to
 * different Supabase projects, which surfaces as intermittent "invalid
 * API key" long after the deploy that caused it.
 *
 * This compares the chains name-for-name, in order.
 */
function checkMirrorParity(chains) {
  const problems = [];
  const text = readFileSync(resolve(process.cwd(), 'next.config.ts'), 'utf8');

  // The `env: { … }` block: each entry maps a canonical name to a
  // `??`-chain of raw env reads, most-canonical first.
  const envBlock = /env:\s*\{([\s\S]*?)\n {2}\},/.exec(text);
  if (!envBlock) {
    return ['next.config.ts: could not locate the `env: { … }` block to verify.'];
  }

  const entryRe = /([A-Z][A-Z0-9_]*):\s*((?:\s*process\.env\.[A-Za-z0-9_]+\s*\??\??)+)/g;
  for (const entry of envBlock[1].matchAll(entryRe)) {
    const canonical = entry[1];
    const mirrored = [...entry[2].matchAll(/process\.env\.([A-Za-z0-9_]+)/g)].map(
      (m) => m[1]
    );
    const expected = chains.find((chain) => chain[0] === canonical);
    if (!expected) {
      problems.push(
        `next.config.ts mirrors '${canonical}', which has no matching ` +
          `*_NAMES chain in src/lib/env.ts.`
      );
      continue;
    }
    if (mirrored.join(' -> ') !== expected.join(' -> ')) {
      problems.push(
        `next.config.ts resolves ${canonical} as [${mirrored.join(', ')}] but ` +
          `src/lib/env.ts resolves it as [${expected.join(', ')}]. The two ` +
          `must match exactly, in order.`
      );
    }
  }
  return problems;
}

function checkContract() {
  const { aliases, chains } = parseAliasRegistry();
  const documented = new Set([
    ...parseManifestNames(MANIFEST_PATH),
    ...parseManifestNames(LOCAL_MANIFEST_PATH),
  ]);
  // `mcp-server/` is deliberately out of scope: it is a separate
  // deployable with its own manifest (mcp-server/.env.example) and its own
  // WACRM_* variables, none of which the web app reads.
  const sources = collectSources(
    ['src', 'scripts'],
    ['.ts', '.tsx', '.mjs', '.js']
  ).concat(resolve(process.cwd(), 'next.config.ts'));

  const violations = [...checkMirrorParity(chains)];
  const referenced = new Set();

  for (const file of sources) {
    const rel = relative(process.cwd(), file);
    const text = readFileSync(file, 'utf8');

    // 1. Alias containment. Word-boundary-guarded so that
    //    NEXT_PUBLIC_SUPABASE_URL does not match the SUPABASE_URL alias.
    if (!ALIAS_ALLOWLIST.includes(rel)) {
      for (const alias of aliases) {
        const hit = new RegExp(`(?<![A-Za-z0-9_])${alias}(?![A-Za-z0-9_])`).test(
          text
        );
        if (hit) {
          violations.push(
            `${rel}: references legacy env alias '${alias}'. Aliases are ` +
              `resolved only in src/lib/env.ts — ask it for a value instead.`
          );
        }
      }
    }

    // 2. Collect every env var the code actually reads.
    for (const m of text.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      referenced.add(m[1]);
    }
    for (const m of text.matchAll(
      /process\.env\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]/g
    )) {
      referenced.add(m[1]);
    }
  }

  // 3. No server secret behind a public prefix.
  for (const name of referenced) {
    if (!name.startsWith('NEXT_PUBLIC_')) continue;
    if (SECRET_MARKERS.some((marker) => name.includes(marker))) {
      violations.push(
        `${name}: a server secret must not carry the NEXT_PUBLIC_ prefix — ` +
          `Next.js inlines those into the browser bundle.`
      );
    }
  }

  // 4. Every referenced var is documented, and every documented var is
  //    live. Both directions matter: an undocumented var is a deploy that
  //    silently loses a feature, a dead one is a secret an operator keeps
  //    rotating for no reason.
  const IGNORED = new Set([
    'NODE_ENV',
    'CI',
    'VITEST',
    'PORT',
    'TZ',
    // Platform-injected: present without an operator setting them.
    'VERCEL_URL',
    'VERCEL_PROJECT_PRODUCTION_URL',
    'VERCEL_ENV',
    'CF_PAGES',
    'npm_lifecycle_event',
    // Illustrative placeholders in prose (`process.env.NEXT_PUBLIC_FOO`,
    // the `KEY=` legend in the manifest header). Not real variables.
    'NEXT_PUBLIC_FOO',
    'FOO',
    'KEY',
    'X',
  ]);

  // Legacy aliases are intentionally absent from the manifests: the
  // manifests document what an operator should SET, and an alias is
  // something the app merely still ACCEPTS. src/lib/env.ts is their
  // documentation, and rule 1 above already proves they live only there.
  const undocumented = [...referenced]
    .filter((n) => !documented.has(n) && !IGNORED.has(n) && !aliases.has(n))
    .sort();
  for (const name of undocumented) {
    violations.push(
      `${name}: read by the code but declared in no manifest. Add it to ` +
        `.env.production.example (or .env.local.example if dev-only).`
    );
  }

  const dead = [...documented]
    .filter((n) => !referenced.has(n) && !IGNORED.has(n))
    .sort();
  for (const name of dead) {
    violations.push(
      `${name}: declared in a manifest but read nowhere. Remove it — a ` +
        `variable nobody reads is a variable operators set for nothing.`
    );
  }

  if (violations.length > 0) {
    console.error('✖ env-contract: the environment contract has drifted.\n');
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      `\n${violations.length} violation(s). See the header of src/lib/env.ts.`
    );
    process.exit(1);
  }

  console.log(
    `✓ env contract OK — ${referenced.size} variables read, all documented; ` +
      `${aliases.size} legacy aliases contained in src/lib/env.ts.`
  );
}

function fail(message) {
  console.error(`✖ env-completeness: ${message}`);
  process.exit(1);
}

const mode = process.argv[2];
if (mode !== '--manifest' && mode !== '--runtime' && mode !== '--contract') {
  fail('usage: check-env-completeness.mjs --manifest | --contract | --runtime');
}

if (mode === '--contract') {
  checkContract();
  process.exit(0);
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
