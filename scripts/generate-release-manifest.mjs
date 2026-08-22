#!/usr/bin/env node
/**
 * Release manifest generator (plan Task 7, ADR-003 §6).
 *
 * Emits the immutable identity of a production release as JSON:
 * everything needed to answer "what exactly is running?" and to
 * re-verify the artifact on rollback. Attached to the GitHub Release
 * by promote-to-prod.yml; read back by rollback-production.yml.
 *
 * Usage:
 *   node scripts/generate-release-manifest.mjs \
 *     --git-sha <sha> --artifact-sha256 <sha256> \
 *     --infra-ref <workflow ref> [--output <path>]
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function fail(msg) {
  console.error(`✖ generate-release-manifest: ${msg}`);
  process.exit(1);
}

const gitSha = arg('git-sha');
const artifactSha256 = arg('artifact-sha256');
const infraRef = arg('infra-ref') ?? 'self-contained (pre Task 8)';
const output = arg('output') ?? 'release-manifest.json';

if (!gitSha || !/^[0-9a-f]{7,40}$/.test(gitSha)) fail('--git-sha missing or malformed');
if (!artifactSha256 || !/^[0-9a-f]{64}$/.test(artifactSha256))
  fail('--artifact-sha256 missing or malformed (need 64 hex chars)');

const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

// migration_version = the lexically last migration filename — the same
// ordering scripts/push-supabase-schema.mjs applies them in.
const migrations = readdirSync(resolve(root, 'supabase', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();
const migrationVersion = migrations.at(-1) ?? 'none';

const openNextVersion =
  pkg.devDependencies?.['@opennextjs/cloudflare'] ??
  pkg.dependencies?.['@opennextjs/cloudflare'] ??
  'unknown';

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

const manifest = {
  git_sha: gitSha,
  artifact_sha256: artifactSha256,
  migration_version: migrationVersion,
  open_next_version: openNextVersion,
  node_version: process.version,
  pnpm_version: sh('pnpm --version'),
  app_version: pkg.version,
  infra_workflow_ref: infraRef,
  generated_at: new Date().toISOString(),
};

writeFileSync(resolve(root, output), JSON.stringify(manifest, null, 2) + '\n');
console.log(`✓ release manifest written to ${output}`);
