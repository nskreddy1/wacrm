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
const UPDATE = process.argv.includes('--update');

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

/** @returns {{ file: string, spec: string }[]} */
function importsOf(file) {
  const content = readFileSync(file, 'utf8');
  const specs = [];
  for (const m of content.matchAll(IMPORT_RE)) {
    specs.push({ file, spec: m[1] ?? m[2] });
  }
  return specs;
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

for (const file of files) {
  const feature = featureOf(file);
  const sharedLayer = sharedLayerOf(file);

  for (const { spec } of importsOf(file)) {
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
  const graph = {
    $comment:
      'Declared architecture graph — regenerate with `node scripts/check-boundaries.mjs --update` after an APPROVED dependency change. New edges must be justified in code review.',
    allowedEdges: [...foundEdges].sort(),
    sharedExceptions: [...foundSharedImporters].sort(),
  };
  writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2) + '\n');
  console.log(
    `feature-graph.json updated: ${foundEdges.size} edges, ${foundSharedImporters.size} shared exceptions.`
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
if (staleEdges.length || staleShared.length) {
  console.log(
    `Info: ${staleEdges.length + staleShared.length} stale graph entries — run with --update to prune.`
  );
}
