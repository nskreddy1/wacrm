/**
 * Architecture fitness checker — executable governance (ADR-003 §7).
 *
 * Validates the ARCH-001 … ARCH-010 invariants from the production
 * infrastructure plan (docs/superpowers/plans/2026-08-22-production-
 * infrastructure.md, addendum §E). Rules are CI-enforced here, never
 * Markdown-enforced.
 *
 *   ARCH-001  Domain/application code cannot import infrastructure SDKs
 *   ARCH-002  Feature code cannot import @supabase/*
 *             → DELEGATED to scripts/check-boundaries.mjs (Rule 5), which
 *               owns the supabase baseline. Not re-checked here.
 *   ARCH-003  Feature code cannot import the Redis SDK directly
 *   ARCH-004  Feature code cannot import Sentry/Langfuse/Loki/pino directly
 *   ARCH-005  SQL adapter (@/lib/db) imported only by repositories/data layer
 *   ARCH-006  Account-scoped data-layer files reference account_id (heuristic,
 *             WARN-ONLY — never fails the build)
 *   ARCH-007  The WhatsApp webhook enforces idempotency (event dedupe present)
 *   ARCH-008  External provider hosts appear only inside adapter modules
 *   ARCH-009  Workflow `uses:` refs never point at mutable branches
 *   ARCH-010  Production DB secret names never appear in app code
 *
 * Enforcement mode (plan Task 10 Step 2): baseline-aware warn mode.
 * Violations listed in scripts/architecture-baseline.json WARN; anything
 * new FAILS. The baseline may only shrink — `--update` drops entries that
 * no longer violate but never adds new ones.
 *
 * Usage:  node scripts/check-architecture.mjs [--update]
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const WORKFLOWS = join(ROOT, '.github', 'workflows');
const BASELINE_PATH = join(ROOT, 'scripts', 'architecture-baseline.json');
const UPDATE = process.argv.includes('--update');

// ---------------------------------------------------------------------------
// File collection + import parsing (same conventions as check-boundaries.mjs)
// ---------------------------------------------------------------------------

function collectFiles(dir, pattern = /\.(ts|tsx)$/) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(p, pattern));
    else if (pattern.test(entry.name)) out.push(p);
  }
  return out;
}

const IMPORT_RE =
  /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function importsOf(content) {
  const specs = [];
  for (const m of content.matchAll(IMPORT_RE)) specs.push(m[1] ?? m[2]);
  return specs;
}

const relPath = (file) => file.slice(ROOT.length + 1).replaceAll(sep, '/');
const files = collectFiles(SRC);
const contents = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

/**
 * Vendor SDK → adapter allowlist. A file outside the allowlist importing a
 * matching module violates ARCH-001/003/004. Allowlist entries are prefixes
 * against the repo-relative path.
 */
const SDK_RULES = [
  {
    id: 'ARCH-003',
    label: 'Redis SDK (@upstash/*)',
    match: (spec) => spec.startsWith('@upstash/'),
    allow: [
      'src/lib/cache/',
      'src/lib/concurrency-guard.ts',
      'src/lib/rate-limit.ts',
      'src/lib/quotas/',
    ],
    hint: 'Use @/lib/cache (read-through cache), @/lib/concurrency-guard (bulkhead) or @/lib/rate-limit instead of the Redis SDK.',
  },
  {
    id: 'ARCH-004',
    label: 'Observability SDK (pino/@sentry/langfuse/loki)',
    match: (spec) =>
      spec === 'pino' ||
      spec.startsWith('pino/') ||
      spec.startsWith('@sentry/') ||
      spec === 'langfuse' ||
      spec.startsWith('langfuse/') ||
      spec.includes('loki'),
    allow: ['src/lib/observability/'],
    hint: 'Use @/lib/observability (logger, captureError, decorators) — feature code never imports observability SDKs.',
  },
  {
    id: 'ARCH-001',
    label: 'Postgres driver / platform SDK',
    match: (spec) =>
      spec === 'postgres' ||
      spec.startsWith('@opennextjs/') ||
      spec === 'wrangler' ||
      spec.startsWith('@cloudflare/'),
    allow: ['src/lib/db/'],
    hint: 'Connection management lives in @/lib/db only (Dependency Rule, addendum §A).',
  },
];

/**
 * ARCH-005: the SQL adapter is imported only by the data layer.
 * The readiness endpoint is deliberately allowlisted: its whole job is a
 * dependency probe (SELECT 1), not a business query.
 */
const DB_ADAPTER_ALLOW = [
  'src/lib/db/',
  'src/lib/data/',
  'src/app/api/health/dependencies/route.ts',
];
const REPOSITORY_DIR_RE = /^src\/features\/[^/]+\/repositories\//;

/**
 * ARCH-008: external provider hostnames may appear only inside adapters.
 */
const PROVIDER_HOST_RE =
  /graph\.facebook\.com|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com/;
const PROVIDER_HOST_ALLOW = [
  'src/features/whatsapp/lib/',
  'src/features/channels/lib/adapters/',
  'src/features/assistant/lib/ai/',
  'src/lib/observability/',
];

/** ARCH-010: production-only secret names must never appear under src/. */
const PROD_SECRET_RE = /SUPABASE_DB_URL|CLOUDFLARE_API_TOKEN|CF_API_TOKEN/;

/** ARCH-009: mutable git refs that must never be used in `uses:`. */
const MUTABLE_REF_RE = /^(main|master|dev|develop|latest|HEAD)$/i;
const IMMUTABLE_REF_RE = /^(v\d[\w.-]*|[0-9a-f]{7,40})$/i;

/** ARCH-007: webhook idempotency markers. */
const WEBHOOK_ROUTE = 'src/app/api/whatsapp/webhook/route.ts';
const IDEMPOTENCY_MARKER_RE = /webhook_events|ON CONFLICT/;

const allowed = (rel, prefixes) => prefixes.some((p) => rel.startsWith(p));

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

/** @type {{ id: string, detail: string }[]} */
const findings = [];
/** @type {string[]} warn-only notes (ARCH-006) */
const warnings = [];

for (const file of files) {
  const rel = relPath(file);
  const content = contents.get(file);
  const isTest = /\.test\.(ts|tsx)$/.test(rel);

  // ARCH-001 / 003 / 004 — vendor SDK import boundaries.
  for (const spec of importsOf(content)) {
    for (const rule of SDK_RULES) {
      if (rule.match(spec) && !allowed(rel, rule.allow)) {
        findings.push({
          id: rule.id,
          detail: `${rel}: imports "${spec}" (${rule.label}). ${rule.hint}`,
        });
      }
    }
    // ARCH-005 — SQL adapter importers.
    if (
      (spec === '@/lib/db' || spec.startsWith('@/lib/db/')) &&
      !allowed(rel, DB_ADAPTER_ALLOW) &&
      !REPOSITORY_DIR_RE.test(rel)
    ) {
      findings.push({
        id: 'ARCH-005',
        detail: `${rel}: imports the SQL adapter "${spec}" outside repositories/the data layer. SQL belongs in src/features/<domain>/repositories/ or src/lib/data/ (addendum §A).`,
      });
    }
  }

  // ARCH-008 — provider hosts outside adapters (tests exempt: they assert URLs).
  if (
    !isTest &&
    PROVIDER_HOST_RE.test(content) &&
    !allowed(rel, PROVIDER_HOST_ALLOW)
  ) {
    findings.push({
      id: 'ARCH-008',
      detail: `${rel}: references an external provider host directly. Provider calls go through the adapter modules (whatsapp/lib, channels/lib/adapters, assistant/lib/ai).`,
    });
  }

  // ARCH-010 — production secret names in app code.
  if (PROD_SECRET_RE.test(content)) {
    findings.push({
      id: 'ARCH-010',
      detail: `${rel}: mentions a production-only secret name (SUPABASE_DB_URL / CLOUDFLARE_API_TOKEN). Only .github/workflows may reference these (NFR-007, ADR-003 §5.3).`,
    });
  }
}

// ARCH-006 — account_id heuristic on the shared data layer (WARN-ONLY).
const dataDir = join(SRC, 'lib', 'data');
if (existsSync(dataDir)) {
  for (const file of collectFiles(dataDir)) {
    const rel = relPath(file);
    if (/\.test\.(ts|tsx)$/.test(rel)) continue;
    const content = contents.get(file) ?? readFileSync(file, 'utf8');
    const queries = /\.from\(|sql`/.test(content);
    if (queries && !/account_id|accountId/.test(content)) {
      warnings.push(
        `ARCH-006 (warn): ${rel} runs queries but never references account_id/accountId — verify tenant scoping.`
      );
    }
  }
}

// ARCH-007 — webhook idempotency present.
{
  const p = join(ROOT, WEBHOOK_ROUTE);
  if (!existsSync(p)) {
    findings.push({
      id: 'ARCH-007',
      detail: `${WEBHOOK_ROUTE}: file not found — the idempotency check cannot verify the webhook.`,
    });
  } else if (!IDEMPOTENCY_MARKER_RE.test(readFileSync(p, 'utf8'))) {
    findings.push({
      id: 'ARCH-007',
      detail: `${WEBHOOK_ROUTE}: no webhook_events / ON CONFLICT idempotency claim found. Meta redelivers events; dedupe is mandatory (NFR-008).`,
    });
  }
}

// ARCH-009 — workflow `uses:` refs.
if (existsSync(WORKFLOWS)) {
  for (const file of collectFiles(WORKFLOWS, /\.ya?ml$/)) {
    const rel = relPath(file);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/);
      if (!m) return;
      const ref = m[1];
      if (ref.startsWith('./')) return; // local reusable workflow — same repo, same SHA
      const at = ref.lastIndexOf('@');
      if (at === -1) {
        findings.push({
          id: 'ARCH-009',
          detail: `${rel}:${i + 1}: "uses: ${ref}" has no ref — pin to a tag or commit SHA.`,
        });
        return;
      }
      const version = ref.slice(at + 1);
      if (MUTABLE_REF_RE.test(version) || !IMMUTABLE_REF_RE.test(version)) {
        findings.push({
          id: 'ARCH-009',
          detail: `${rel}:${i + 1}: "uses: ${ref}" points at a mutable ref ("${version}"). Pin to an immutable tag (vN…) or full commit SHA (ADR-003 §6).`,
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Baseline: existing violations warn; new ones fail; --update only shrinks.
// ---------------------------------------------------------------------------

const findingKeys = findings.map((f) => `${f.id} ${f.detail.split(':')[0]}`);

let baseline = [];
if (existsSync(BASELINE_PATH)) {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).violations;
} else if (!UPDATE) {
  console.error(
    'Missing scripts/architecture-baseline.json — run `node scripts/check-architecture.mjs --update` to generate it.'
  );
  process.exit(1);
}

if (UPDATE) {
  const seeded = existsSync(BASELINE_PATH)
    ? baseline.filter((k) => findingKeys.includes(k)) // shrink only
    : [...new Set(findingKeys)].sort(); // first generation: baseline everything
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        $comment:
          'ARCH-001..010 baseline of pre-existing violations (plan Task 10 Step 2: warn mode first). Keys are "<RULE-ID> <file>". This list may only shrink — new violations must be fixed, never baselined.',
        violations: seeded,
      },
      null,
      2
    ) + '\n'
  );
  console.log(
    `architecture-baseline.json updated: ${seeded.length} baselined violation(s).`
  );
  process.exit(0);
}

const baselineSet = new Set(baseline);
const newFindings = [];
const baselinedFindings = [];
findings.forEach((f, i) => {
  (baselineSet.has(findingKeys[i]) ? baselinedFindings : newFindings).push(f);
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const f of baselinedFindings)
  console.log(`  ⚠ [baselined] ${f.id}: ${f.detail}`);

if (newFindings.length > 0) {
  console.error(`\nArchitecture violations (${newFindings.length} new):\n`);
  for (const f of newFindings) console.error(`  ✗ ${f.id}: ${f.detail}`);
  console.error(
    '\nSee docs/superpowers/plans/2026-08-22-production-infrastructure.md addendum §E for the rule definitions.'
  );
  process.exit(1);
}

console.log(
  `Architecture OK — ARCH-001..010 validated across ${files.length} source files + ${existsSync(WORKFLOWS) ? readdirSync(WORKFLOWS).length : 0} workflows. ` +
    `Baseline: ${baselinedFindings.length}/${baseline.length} entries remain (target 0). ` +
    `ARCH-002 (supabase boundary) enforced by check-boundaries.mjs.`
);
