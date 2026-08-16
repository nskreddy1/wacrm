#!/usr/bin/env node
/**
 * Keeps `docs/architecture/` a faithful mirror of `.agents/context/`.
 *
 * WHY THIS EXISTS
 * The agent context pack is the working copy that agents read. It is also
 * published under `docs/architecture/` so humans browsing `docs/` find the
 * same architecture material without knowing about `.agents/`.
 *
 * Two copies of ~6,700 lines is a standing drift hazard: the last audit of
 * this repo found a deleted Express API still documented in 12 places. So the
 * mirror is mechanical and verified in CI rather than maintained by hand.
 *
 * `.agents/context/` is ALWAYS the source of truth. Never edit
 * `docs/architecture/` directly — `--check` will fail and `--write` will
 * overwrite it.
 *
 *   node scripts/sync-context-docs.mjs --check   # CI: exit 1 on drift
 *   node scripts/sync-context-docs.mjs --write   # regenerate the mirror
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = '.agents/context';
const DEST = 'docs/architecture';

const mode = process.argv.includes('--write')
  ? 'write'
  : process.argv.includes('--check')
    ? 'check'
    : null;

if (!mode) {
  console.error('Usage: node scripts/sync-context-docs.mjs --check | --write');
  process.exit(2);
}

if (!existsSync(SRC)) {
  console.error(`✗ Source directory ${SRC} is missing.`);
  process.exit(1);
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const markdown = (dir) => readdirSync(dir).filter((f) => f.endsWith('.md')).sort();

const sources = markdown(SRC);
const existing = existsSync(DEST) ? markdown(DEST) : [];

const drift = { missing: [], stale: [], orphaned: [] };

for (const file of sources) {
  const target = join(DEST, file);
  if (!existsSync(target)) {
    drift.missing.push(file);
  } else if (sha(readFileSync(join(SRC, file))) !== sha(readFileSync(target))) {
    drift.stale.push(file);
  }
}

// Files under docs/architecture/ with no counterpart in the context pack are
// orphans: either the source was renamed/deleted, or someone authored a new
// doc in the mirror instead of in the source of truth.
for (const file of existing) {
  if (!sources.includes(file)) drift.orphaned.push(file);
}

const total = drift.missing.length + drift.stale.length + drift.orphaned.length;

if (mode === 'check') {
  if (total === 0) {
    console.log(`✓ docs/architecture/ is in sync with ${SRC} (${sources.length} files).`);
    process.exit(0);
  }

  console.error(`✗ docs/architecture/ has drifted from ${SRC}:\n`);
  for (const f of drift.missing) console.error(`  missing   ${f}  (in ${SRC}, not published)`);
  for (const f of drift.stale) console.error(`  stale     ${f}  (contents differ)`);
  for (const f of drift.orphaned) console.error(`  orphaned  ${f}  (no longer in ${SRC})`);
  console.error(`\nFix with:  pnpm docs:sync`);
  console.error(`Remember ${SRC} is the source of truth — edit there, never in ${DEST}.`);
  process.exit(1);
}

mkdirSync(DEST, { recursive: true });
for (const file of [...drift.missing, ...drift.stale]) {
  writeFileSync(join(DEST, file), readFileSync(join(SRC, file)));
}
for (const file of drift.orphaned) {
  rmSync(join(DEST, file));
}

console.log(
  total === 0
    ? `✓ Already in sync (${sources.length} files).`
    : `✓ Synced ${DEST}: ${drift.missing.length} added, ${drift.stale.length} updated, ${drift.orphaned.length} removed.`,
);
