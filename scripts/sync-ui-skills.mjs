#!/usr/bin/env node
/**
 * Sync every skill published on ui-skills.com into `.agents/skills/`.
 *
 * ui-skills.com is a catalogue: each skill page exposes a canonical install
 * command of the form
 *
 *   npx skills add https://github.com/<owner>/<repo> --skill <name>
 *
 * We parse those commands, clone each unique upstream repo once (shallow +
 * blobless + sparse, so huge repos like vercel/next.js stay cheap), then copy
 * each skill directory into `.agents/skills/<name>/`.
 *
 * Every installed skill gets a `.ui-skills-source` marker recording its
 * upstream, and `.agents/skills/ui-skills-index.json` records the full mapping
 * so re-runs are idempotent and auditable.
 *
 * Usage:
 *   node scripts/sync-ui-skills.mjs            # sync everything
 *   node scripts/sync-ui-skills.mjs --dry-run  # only report what would change
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const exec = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, '..');
const SKILLS_DIR = path.join(ROOT, '.agents', 'skills');
const INDEX_FILE = path.join(SKILLS_DIR, 'ui-skills-index.json');
const WORK_DIR = path.join(os.tmpdir(), 'ui-skills-clones');
const CATALOGUE = 'https://www.ui-skills.com/skills';
const CONCURRENCY = 8;
const DRY_RUN = process.argv.includes('--dry-run');

const log = (...args) => console.log(...args);

async function mapLimit(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function getText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'wacrm-skill-sync', accept: 'text/html' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

/** Scrape the catalogue index for every `/skills/<owner>/<slug>` page. */
async function listCataloguePages() {
  const html = await getText(CATALOGUE);
  const slugs = new Set();
  for (const match of html.matchAll(/\/skills\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)/g)) {
    slugs.add(`/skills/${match[1]}/${match[2]}`);
  }
  return [...slugs].sort();
}

/** Pull the `npx skills add <repo> --skill <name>` install command off a page. */
async function readInstallTarget(page) {
  const html = await getText(`https://www.ui-skills.com${page}`);
  const match = html.match(
    /npx skills add https:\/\/github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+?)(?:\.git)?(?:\\?["'&<\s]|&quot;)[^]]*?--skill ([a-zA-Z0-9._-]+)/,
  );
  const loose =
    match ??
    html.match(
      /npx skills add https:\/\/github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)[\s\S]{0,80}?--skill ([a-zA-Z0-9._-]+)/,
    );
  if (!loose) return null;
  return {
    page,
    owner: loose[1],
    repo: loose[2].replace(/\.git$/, ''),
    skill: loose[3],
  };
}

/** Shallow, blobless, sparse clone limited to directories that hold a SKILL.md. */
async function cloneRepo(owner, repo) {
  const dir = path.join(WORK_DIR, `${owner}__${repo}`);
  try {
    await fs.access(path.join(dir, '.git'));
    return dir;
  } catch {
    /* not cloned yet */
  }
  await fs.rm(dir, { recursive: true, force: true });
  await exec('git', [
    'clone',
    '--depth',
    '1',
    '--filter=blob:none',
    '--no-checkout',
    '--sparse',
    `https://github.com/${owner}/${repo}.git`,
    dir,
  ]);
  const { stdout } = await exec('git', ['-C', dir, 'ls-tree', '-r', 'HEAD', '--name-only'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const skillFiles = stdout.split('\n').filter((line) => /(^|\/)SKILL\.md$/i.test(line.trim()));
  if (skillFiles.length === 0) throw new Error(`no SKILL.md in ${owner}/${repo}`);
  const patterns = [
    ...new Set(
      skillFiles.map((file) => {
        const dirname = path.posix.dirname(file.trim());
        return dirname === '.' ? '/*' : `/${dirname}/*`;
      }),
    ),
  ];
  await exec('git', ['-C', dir, 'sparse-checkout', 'set', '--no-cone', ...patterns]);
  await exec('git', ['-C', dir, 'checkout']);
  return dir;
}

async function findSkillDirs(root) {
  const found = [];
  async function walk(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/^SKILL\.md$/i.test(entry.name)) found.push(current);
    }
  }
  await walk(root);
  return found;
}

const normalize = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/skills?$/, '');

const tokens = (value) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !['skill', 'skills'].includes(token));

/**
 * Repos routinely mirror the same skill into `.claude/skills`,
 * `.cursor/skills`, `.gemini/skills`… Keep one copy per skill name and
 * prefer the canonical agent-neutral locations.
 */
function dedupeMirrors(dirs) {
  const rank = (dir) =>
    dir.includes(`${path.sep}.agents${path.sep}`)
      ? 0
      : dir.includes(`${path.sep}skills${path.sep}`) && !dir.includes(`${path.sep}.`)
        ? 1
        : 2;
  const best = new Map();
  for (const dir of dirs) {
    const key = path.basename(dir);
    const current = best.get(key);
    if (!current || rank(dir) < rank(current)) best.set(key, dir);
  }
  return [...best.values()];
}

const HEAVY_EXTENSIONS = /\.(mp3|mp4|mov|webm|wav|zip|tgz|psd|sketch|fig|woff2?|ttf|otf)$/i;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const IMAGE_BUDGET = 250 * 1024;

/**
 * Skills are instructions, not asset bundles. Demo videos, music beds and
 * multi-megabyte screenshots add ~100MB to the repo without helping any
 * agent read the guidance, so drop them and keep the prose, references
 * and scripts.
 */
async function stripHeavyMedia(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await stripHeavyMedia(full);
      const remaining = await fs.readdir(full).catch(() => ['keep']);
      if (remaining.length === 0) await fs.rm(full, { recursive: true, force: true });
      continue;
    }
    if (HEAVY_EXTENSIONS.test(entry.name)) {
      await fs.rm(full, { force: true });
      continue;
    }
    if (IMAGE_EXTENSIONS.test(entry.name)) {
      const stat = await fs.stat(full).catch(() => null);
      if (stat && stat.size > IMAGE_BUDGET) await fs.rm(full, { force: true });
    }
  }
}

async function readSkillName(dir) {
  try {
    const raw = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8');
    return raw.match(/^\s*---[\s\S]*?\bname:\s*["']?([^"'\n]+)/)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * ui-skills.com slugs drift from upstream directory names
 * (`vercel-react-best-practices` → `react-best-practices`,
 * `gpt-taste` → `gpt-tasteskill`), so resolve in cascading order:
 * exact dir → frontmatter name → containment → shared token → sole skill.
 */
function resolveSkillDir(requested, candidates) {
  const want = normalize(requested);
  const exact = candidates.find((c) => c.dirName === requested);
  if (exact) return exact;

  const byFrontmatter = candidates.find((c) => c.frontmatter === requested);
  if (byFrontmatter) return byFrontmatter;

  const normalized = candidates.filter(
    (c) => normalize(c.dirName) === want || (c.frontmatter && normalize(c.frontmatter) === want),
  );
  if (normalized.length === 1) return normalized[0];

  const contained = candidates
    .filter((c) => {
      const have = normalize(c.dirName);
      return have.length >= 4 && (have.includes(want) || want.includes(have));
    })
    .sort((a, b) => normalize(a.dirName).length - normalize(b.dirName).length);
  if (contained.length > 0) return contained[0];

  const wantTokens = tokens(requested);
  const scored = candidates
    .map((c) => ({
      candidate: c,
      score: tokens(c.dirName).filter((token) => wantTokens.includes(token)).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length > 0) return scored[0].candidate;

  return candidates.length === 1 ? candidates[0] : null;
}

async function main() {
  await fs.mkdir(SKILLS_DIR, { recursive: true });
  await fs.mkdir(WORK_DIR, { recursive: true });

  let index = {};
  try {
    index = JSON.parse(await fs.readFile(INDEX_FILE, 'utf8'));
  } catch {
    index = {};
  }

  log('Reading ui-skills.com catalogue…');
  const pages = await listCataloguePages();
  log(`  ${pages.length} skill pages listed`);

  const targets = (await mapLimit(pages, CONCURRENCY, async (page) => {
    try {
      return await readInstallTarget(page);
    } catch (error) {
      log(`  ! ${page}: ${error.message}`);
      return null;
    }
  })).filter(Boolean);
  log(`  ${targets.length} install commands resolved`);

  const repos = [...new Set(targets.map((t) => `${t.owner}/${t.repo}`))];
  log(`Cloning ${repos.length} upstream repositories…`);

  const clones = new Map();
  await mapLimit(repos, 6, async (slug) => {
    const [owner, repo] = slug.split('/');
    try {
      clones.set(slug, await cloneRepo(owner, repo));
    } catch (error) {
      log(`  ! ${slug}: ${error.message.split('\n')[0]}`);
    }
  });

  const skillDirCache = new Map();
  const installed = [];
  const skipped = [];

  for (const target of targets) {
    const slug = `${target.owner}/${target.repo}`;
    const clone = clones.get(slug);
    if (!clone) {
      skipped.push({ ...target, reason: 'clone failed' });
      continue;
    }
    if (!skillDirCache.has(slug)) {
      const dirs = dedupeMirrors(await findSkillDirs(clone));
      skillDirCache.set(
        slug,
        await Promise.all(
          dirs.map(async (dir) => ({
            dir,
            dirName: path.basename(dir),
            frontmatter: await readSkillName(dir),
          })),
        ),
      );
    }
    const match = resolveSkillDir(target.skill, skillDirCache.get(slug));
    if (!match) {
      skipped.push({ ...target, reason: 'skill directory not found' });
      continue;
    }
    const source = match.dir;

    // Keep pre-existing hand-authored skills; namespace collisions by owner.
    // Install under the upstream directory name so catalogue entries that
    // are really sub-commands of one skill (all 18 `impeccable/*` pages)
    // collapse into a single install instead of 18 identical copies.
    let name = match.dirName;
    let dest = path.join(SKILLS_DIR, name);
    const ownedByUs = index[name]?.source === slug;
    let exists = true;
    try {
      await fs.access(dest);
    } catch {
      exists = false;
    }
    if (exists && !ownedByUs) {
      let markerOwned = false;
      try {
        await fs.access(path.join(dest, '.ui-skills-source'));
        markerOwned = true;
      } catch {
        markerOwned = false;
      }
      if (!markerOwned) {
        name = `${target.owner.toLowerCase()}-${target.skill}`;
        dest = path.join(SKILLS_DIR, name);
      }
    }

    if (DRY_RUN) {
      installed.push({ name, source: slug, skill: target.skill, page: target.page });
      continue;
    }

    await fs.rm(dest, { recursive: true, force: true });
    await fs.cp(source, dest, { recursive: true });
    await fs.rm(path.join(dest, '.git'), { recursive: true, force: true });
    await stripHeavyMedia(dest);
    await fs.writeFile(
      path.join(dest, '.ui-skills-source'),
      `https://github.com/${slug} (skill: ${target.skill})\nhttps://www.ui-skills.com${target.page}\n`,
      'utf8',
    );
    index[name] = {
      name,
      skill: target.skill,
      source: slug,
      catalogue: `https://www.ui-skills.com${target.page}`,
    };
    installed.push({ name, source: slug, skill: target.skill, page: target.page });
  }

  if (!DRY_RUN) {
    // Prune skills this script installed under a name the catalogue no
    // longer resolves to (upstream renames, earlier naming schemes).
    // Hand-authored skills have no `.ui-skills-source` marker and are left
    // untouched.
    const live = new Set(installed.map((item) => item.name));
    for (const entry of await fs.readdir(SKILLS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || live.has(entry.name)) continue;
      const dir = path.join(SKILLS_DIR, entry.name);
      try {
        await fs.access(path.join(dir, '.ui-skills-source'));
      } catch {
        continue;
      }
      await fs.rm(dir, { recursive: true, force: true });
      delete index[entry.name];
      log(`  pruned stale ${entry.name}`);
    }

    const sorted = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
    await fs.writeFile(INDEX_FILE, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  }

  log(`\n${DRY_RUN ? 'Would install' : 'Installed'}: ${installed.length} skills`);
  if (skipped.length) {
    log(`Skipped: ${skipped.length}`);
    for (const item of skipped) log(`  - ${item.owner}/${item.repo} ${item.skill} (${item.reason})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
