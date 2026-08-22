/**
 * Architecture boundary checker.
 *
 * Enforces the layering rules of this codebase without requiring barrel
 * files (which would create runtime circular imports between features
 * that legitimately collaborate, e.g. whatsapp <-> channels):
 *
 *   1. LAYERING — `src/features/**` must never import from `@/app`;
 *      shared layers (`src/lib`, `src/components`, `src/hooks`) must not
 *      import from `@/features` unless the file is explicitly baselined
 *      in `scripts/architecture/feature-graph.json` (`sharedExceptions`).
 *   2. NO RELATIVE ESCAPES — imports inside a feature must not use
 *      `../` paths that leave the feature directory; cross-boundary
 *      imports always go through the `@/` alias so they are auditable.
 *   3. DECLARED FEATURE GRAPH — every feature -> feature dependency must
 *      be declared in `feature-graph.json` (`allowedEdges`). Adding a new
 *      cross-feature dependency is a deliberate, reviewed act: update the
 *      graph in the same PR and justify it in review.
 *
 * Usage:  node scripts/check-boundaries.mjs [--update]
 *   --update  Regenerate feature-graph.json from the current codebase
 *             (use after an approved dependency change).
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const GRAPH_PATH = join(ROOT, 'scripts', 'architecture', 'feature-graph.json');
const BASELINE_PATH = join(ROOT, 'scripts', 'boundaries-baseline.json');
const UPDATE = process.argv.includes('--update');

// ---------------------------------------------------------------------------
// Rule 5: SUPABASE SDK BOUNDARY (ADR-002 Phase 0 — Anti-Corruption Layer)
//
// `@supabase/*` and `@/lib/supabase` may be imported ONLY by the adapter
// layer. Everything else goes through the facades:
//   data       → @/lib/db (sql / withTransaction)  [repositories]
//   sessions   → @/lib/auth-provider
//   realtime   → @/lib/realtime
//   storage    → @/lib/storage
//
// Existing violations are baselined in scripts/boundaries-baseline.json and
// WARN; NEW violations FAIL. The baseline shrinks as ADR-002 Phase 1
// converts call sites — the count is printed on every run so shrinkage is
// visible in CI.
// ---------------------------------------------------------------------------

const SUPABASE_IMPORT_RE = /^(@supabase\/|@\/lib\/supabase)/;
const SUPABASE_ALLOWLIST = [
  'src/lib/db/',
  'src/lib/auth-provider/',
  'src/lib/realtime/',
  'src/lib/storage/',
  'src/lib/supabase/',
  'src/lib/supabase',
];

function isSupabaseAllowlisted(rel) {
  return SUPABASE_ALLOWLIST.some(
    (prefix) => rel.startsWith(prefix) || rel === prefix.replace(/\/$/, '.ts')
  );
}

// ---------------------------------------------------------------------------
// Collect source files
// ---------------------------------------------------------------------------

/** @returns {string[]} absolute paths of all .ts/.tsx files under dir */
function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(p));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const files = collectFiles(SRC);

// ---------------------------------------------------------------------------
// Parse imports
// ---------------------------------------------------------------------------

const IMPORT_RE =
  /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * True when an import statement contributes NOTHING to the runtime graph.
 *
 * `import type { X } from 'pkg'` and `import { type X } from 'pkg'` are
 * erased by TypeScript before emit: no `require`, no bundle edge, no
 * chance of calling into the module. Rule 5 exists to stop the supabase
 * SDK being *used* outside the adapter layer (its own header calls itself
 * an Anti-Corruption Layer), so a vanished import cannot violate it —
 * flagging one is a false positive of the regex, not a finding.
 *
 * Deliberately conservative: a statement counts as type-only when it is
 * declared `import type ...`, or when EVERY named specifier carries its
 * own `type` prefix. A single value specifier (`import { type A, b }`)
 * makes the whole statement runtime, which is the correct answer.
 *
 * This is scoped to Rule 5 only. The layering rules (1-3) intentionally
 * still count type imports, because depending on `@/app`'s *types* from a
 * feature is a real design inversion even with no runtime edge.
 */
function isTypeOnlyImport(statement) {
  if (/^(?:import|export)\s+type\s/.test(statement)) return true;
  const named = statement.match(/\{([^}]*)\}/);
  if (!named) return false;
  const specifiers = named[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    specifiers.length > 0 && specifiers.every((s) => /^type\s+\S/.test(s))
  );
}

/** @returns {{ file: string, spec: string, typeOnly: boolean }[]} */
function importsOf(file) {
  const content = readFileSync(file, 'utf8');
  const specs = [];
  for (const m of content.matchAll(IMPORT_RE)) {
    specs.push({
      file,
      spec: m[1] ?? m[2],
      // `m[0]` is the whole statement, so the `type` keyword is still
      // visible here; by the time we have only the specifier it is gone.
      typeOnly: isTypeOnlyImport(m[0]),
    });
  }
  return specs;
}

/**
 * Named-binding imports: `import { a, b as c } from 'spec'`.
 *
 * The negated class spans newlines, so multi-line clauses (the common
 * formatting for several send primitives) are matched as one.
 */
const NAMED_IMPORT_RE =
  /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/** Namespace imports: `import * as meta from 'spec'` — grants the whole module. */
const NAMESPACE_IMPORT_RE =
  /import\s+(?:type\s+)?\*\s*as\s+\w+\s*from\s*['"]([^'"]+)['"]/g;

/**
 * @returns {{ spec: string, names: string[], namespace: boolean }[]}
 *   One entry per import statement that could pull a restricted symbol.
 */
function bindingsOf(content) {
  const out = [];
  for (const m of content.matchAll(NAMED_IMPORT_RE)) {
    const names = m[1]
      .split(',')
      // `orig as alias` — the restriction is on what is imported, not the
      // local name, so key off the original.
      .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    out.push({ spec: m[2], names, namespace: false });
  }
  for (const m of content.matchAll(NAMESPACE_IMPORT_RE)) {
    out.push({ spec: m[1], names: [], namespace: true });
  }
  return out;
}

/** Feature name if the file lives inside src/features, else null. */
function featureOf(file) {
  const rel = file.slice(SRC.length + 1).split(sep);
  return rel[0] === 'features' ? rel[1] : null;
}

/** Shared-layer name (lib/components/hooks) if applicable, else null. */
function sharedLayerOf(file) {
  const rel = file.slice(SRC.length + 1).split(sep);
  return ['lib', 'components', 'hooks'].includes(rel[0]) ? rel[0] : null;
}

const relPath = (file) => file.slice(ROOT.length + 1).replaceAll(sep, '/');

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const violations = [];
/** @type {Set<string>} "from -> to" feature edges found in the code */
const foundEdges = new Set();
/** @type {Set<string>} shared-layer files importing features */
const foundSharedImporters = new Set();
/** @type {Set<string>} files importing supabase outside the adapter layer (Rule 5) */
const foundSupabaseImporters = new Set();

for (const file of files) {
  const feature = featureOf(file);
  const sharedLayer = sharedLayerOf(file);

  for (const { spec, typeOnly } of importsOf(file)) {
    // Rule 5: supabase SDK imports outside the adapter layer. Type-only
    // imports are erased before emit and so cannot reach the SDK at
    // runtime — see isTypeOnlyImport().
    if (
      SUPABASE_IMPORT_RE.test(spec) &&
      !typeOnly &&
      !isSupabaseAllowlisted(relPath(file))
    ) {
      foundSupabaseImporters.add(relPath(file));
    }
    // Rule 1a: nothing outside src/app imports from @/app.
    if (spec.startsWith('@/app')) {
      const rel = file.slice(SRC.length + 1).split(sep)[0];
      if (rel !== 'app') {
        violations.push(
          `${relPath(file)}: imports "${spec}" — the app layer is the top of the stack; nothing may depend on it.`
        );
      }
      continue;
    }

    // Rule 2: relative imports must not escape the feature directory.
    if (feature && spec.startsWith('..')) {
      const target = resolve(dirname(file), spec);
      const featureDir = join(SRC, 'features', feature);
      if (!target.startsWith(featureDir + sep) && target !== featureDir) {
        violations.push(
          `${relPath(file)}: relative import "${spec}" escapes the "${feature}" feature — use the @/ alias for cross-boundary imports.`
        );
      }
      continue;
    }

    // Feature -> feature edges (Rule 3).
    const featMatch = spec.match(/^@\/features\/([^/]+)/);
    if (featMatch) {
      const target = featMatch[1];
      if (feature && target !== feature) {
        foundEdges.add(`${feature} -> ${target}`);
      } else if (sharedLayer) {
        foundSharedImporters.add(relPath(file));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Compare against the declared graph (or regenerate it)
// ---------------------------------------------------------------------------

if (UPDATE) {
  // `restrictedSymbols` is hand-authored policy (ADR-006 D13), not something
  // derived from the code — regenerating from the current tree would happily
  // "discover" a new bypass and bless it. Carry it through untouched so
  // --update can never quietly widen the send boundary.
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(GRAPH_PATH, 'utf8'));
  } catch {
    // First generation — nothing to preserve.
  }

  const graph = {
    $comment:
      'Declared architecture graph — regenerate with `node scripts/check-boundaries.mjs --update` after an APPROVED dependency change. New edges must be justified in code review.',
    allowedEdges: [...foundEdges].sort(),
    ...(existing.restrictedSymbols
      ? { restrictedSymbols: existing.restrictedSymbols }
      : {}),
    sharedExceptions: [...foundSharedImporters].sort(),
  };
  writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2) + '\n');
  console.log(
    `feature-graph.json updated: ${foundEdges.size} edges, ${foundSharedImporters.size} shared exceptions. ` +
      `restrictedSymbols preserved (${(existing.restrictedSymbols ?? []).length} rule(s)).`
  );

  // Rule 5 baseline: --update may only SHRINK it (drop files that no longer
  // violate); it never adds new violators — those must be converted to the
  // facades, not blessed.
  let prevBaseline = [];
  try {
    prevBaseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
      .supabaseImports;
  } catch {
    // First generation — baseline everything currently violating.
    prevBaseline = [...foundSupabaseImporters];
  }
  const nextBaseline = prevBaseline
    .filter((f) => foundSupabaseImporters.has(f))
    .sort();
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        $comment:
          'ADR-002 Phase 0 baseline of pre-existing direct supabase imports outside src/lib adapters. This list may only shrink (Phase 1 converts call sites to @/lib/db, @/lib/auth-provider, @/lib/realtime, @/lib/storage). NEW files must never be added here.',
        supabaseImports: nextBaseline,
      },
      null,
      2
    ) + '\n'
  );
  console.log(
    `boundaries-baseline.json updated: ${nextBaseline.length} baselined supabase importer(s).`
  );
  process.exit(0);
}

let graph;
try {
  graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8'));
} catch {
  console.error(
    'Missing scripts/architecture/feature-graph.json — run `node scripts/check-boundaries.mjs --update` to generate it.'
  );
  process.exit(1);
}

const allowedEdges = new Set(graph.allowedEdges);
const sharedExceptions = new Set(graph.sharedExceptions);

for (const edge of foundEdges) {
  if (!allowedEdges.has(edge)) {
    violations.push(
      `Undeclared feature dependency "${edge}" — if intentional, add it to scripts/architecture/feature-graph.json and justify it in review.`
    );
  }
}
for (const file of foundSharedImporters) {
  if (!sharedExceptions.has(file)) {
    violations.push(
      `${file}: shared layer imports from @/features — shared code must not depend on features. If unavoidable, baseline it in feature-graph.json.`
    );
  }
}

// ---------------------------------------------------------------------------
// Rule 4: RESTRICTED SYMBOLS (ADR-006 D13)
//
// Layering rules constrain which *modules* may talk. They cannot express
// "this one function is a policy choke point", which is exactly the shape
// of the outbound send boundary: `@/features/whatsapp/lib/meta-api` is
// legitimately imported for template CRUD and media download by code that
// must never reach the send primitives. So the pin is per-symbol, and the
// importer allowlist is a map whose values are the justification.
// ---------------------------------------------------------------------------

for (const rule of graph.restrictedSymbols ?? []) {
  const restricted = new Set(rule.symbols);
  const allowed = rule.allowedImporters ?? {};

  for (const file of files) {
    const rel = relPath(file);
    if (Object.hasOwn(allowed, rel)) continue;

    for (const { spec, names, namespace } of bindingsOf(
      readFileSync(file, 'utf8')
    )) {
      if (spec !== rule.module) continue;

      // A namespace import hands over every export, including the pinned
      // ones, so it defeats the check by construction.
      if (namespace) {
        violations.push(
          `${rel}: namespace-imports "${rule.module}" — that grants the restricted send primitives (${rule.symbols.join(', ')}). Import the specific non-restricted symbols you need instead.`
        );
        continue;
      }

      const hits = names.filter((n) => restricted.has(n));
      if (hits.length > 0) {
        violations.push(
          `${rel}: imports restricted symbol(s) ${hits.join(', ')} from "${rule.module}". These are provider send primitives that bypass the ADR-006 consent + 24-hour-window boundary. Route the send through sendChannelMessage() (src/features/channels/lib/orchestration/outbound.ts), or — if this is a reviewed bulk path — add this file to restrictedSymbols.allowedImporters in scripts/architecture/feature-graph.json with a justification.`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 5 enforcement: baselined supabase importers warn; new ones fail.
// ---------------------------------------------------------------------------

let supabaseBaseline = new Set();
try {
  supabaseBaseline = new Set(
    JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).supabaseImports
  );
} catch {
  console.error(
    'Missing scripts/boundaries-baseline.json — run `node scripts/check-boundaries.mjs --update` to generate it.'
  );
  process.exit(1);
}

const baselinedSupabase = [];
for (const file of [...foundSupabaseImporters].sort()) {
  if (supabaseBaseline.has(file)) {
    baselinedSupabase.push(file);
  } else {
    violations.push(
      `${file}: imports supabase directly (@supabase/* or @/lib/supabase) outside the adapter layer. New code must use the facades: @/lib/db for data, @/lib/auth-provider for sessions, @/lib/realtime for subscriptions, @/lib/storage for files (ADR-002 Phase 0).`
    );
  }
}

// Report stale entries (kept as info, not failures, so deletions don't block).
const staleEdges = [...allowedEdges].filter((e) => !foundEdges.has(e));
const staleShared = [...sharedExceptions].filter(
  (f) => !foundSharedImporters.has(f)
);

if (violations.length > 0) {
  console.error(`Architecture boundary violations (${violations.length}):\n`);
  for (const v of violations) console.error(`  ✗ ${v}`);
  process.exit(1);
}

console.log(
  `Boundaries OK — ${foundEdges.size} declared feature edges, ${foundSharedImporters.size} shared exceptions, ${files.length} files scanned.`
);
console.log(
  `ADR-002 baseline: ${baselinedSupabase.length}/${supabaseBaseline.size} baselined direct supabase importer(s) remain — target 0 by end of Phase 1.`
);
if (baselinedSupabase.length < supabaseBaseline.size) {
  console.log(
    `Info: ${supabaseBaseline.size - baselinedSupabase.length} baseline entries no longer violate — run with --update to shrink the baseline.`
  );
}
if (staleEdges.length || staleShared.length) {
  console.log(
    `Info: ${staleEdges.length + staleShared.length} stale graph entries — run with --update to prune.`
  );
}
