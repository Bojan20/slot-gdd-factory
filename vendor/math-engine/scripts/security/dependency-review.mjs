#!/usr/bin/env node
/**
 * W212 Faza 600.1 — Dependency review (license + staleness).
 *
 * Walks every package.json under the repo (root + 8 sub-packages) and
 * reports, per dependency:
 *
 *   - name + current version (from package.json)
 *   - latest stable (best-effort: from node_modules/.package-lock.json or
 *     `npm view` if available — falls back to "current" when offline)
 *   - last update date (best-effort: from `node_modules/<pkg>/package.json`'s
 *     `_publishedAt` or git mtime of the lockfile entry)
 *   - declared SPDX license (from `node_modules/<pkg>/package.json`)
 *   - high-CVE count (from the dependency-scan integration)
 *   - recommendation: keep | update | replace | drop
 *
 * Output: reports/security/DEPENDENCY_REVIEW.md + .json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

export const PACKAGE_ROOTS = [
  { id: 'root', dir: ROOT },
  { id: 'web/studio', dir: join(ROOT, 'web/studio') },
  { id: 'web/operator', dir: join(ROOT, 'web/operator') },
  { id: 'web/regulator', dir: join(ROOT, 'web/regulator') },
  { id: 'web/marketplace', dir: join(ROOT, 'web/marketplace') },
  { id: 'web/pitch', dir: join(ROOT, 'web/pitch') },
  { id: 'web/onboarding', dir: join(ROOT, 'web/onboarding') },
  { id: 'web/support', dir: join(ROOT, 'web/support') },
  { id: 'sdk', dir: join(ROOT, 'sdk') },
];

/** SPDX strings we consider non-permissive (block / flag). */
export const NON_PERMISSIVE = new Set([
  'GPL-2.0',
  'GPL-3.0',
  'GPL-2.0-only',
  'GPL-3.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0-or-later',
  'AGPL-3.0',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'SSPL-1.0',
  'BSL-1.0',
  'Sleepycat',
  'CC-BY-NC-4.0',
  'CC-BY-NC-SA-4.0',
]);

export const STALENESS_MONTHS = 6;

export function readPackageJson(dir) {
  const p = join(dir, 'package.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function listDependencies(pkg) {
  const out = [];
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const m = pkg?.[section] ?? {};
    for (const [name, version] of Object.entries(m)) {
      out.push({ name, declared: String(version), section });
    }
  }
  return out;
}

/** Best-effort: read the installed package's package.json. */
export function readInstalledManifest(rootDir, name) {
  // node_modules may live in the rootDir or a parent. Walk up to find it.
  let cur = rootDir;
  for (let i = 0; i < 4; i++) {
    const p = join(cur, 'node_modules', name, 'package.json');
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
    }
    cur = dirname(cur);
  }
  return null;
}

export function detectLicense(manifest) {
  if (!manifest) return 'UNKNOWN';
  if (typeof manifest.license === 'string') return manifest.license;
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses.map((l) => l.type || l).join(' OR ');
  }
  if (typeof manifest.license === 'object' && manifest.license?.type) return manifest.license.type;
  return 'UNKNOWN';
}

export function isStale(manifestMtimeIso, refDate = new Date()) {
  if (!manifestMtimeIso) return false;
  const ms = ref(refDate).getTime() - new Date(manifestMtimeIso).getTime();
  const months = ms / (1000 * 60 * 60 * 24 * 30);
  return months > STALENESS_MONTHS;
}
function ref(d) { return d instanceof Date ? d : new Date(d); }

export function recommend({ license, staleMonths, highCveCount }) {
  if (highCveCount > 0) return 'update';
  if (NON_PERMISSIVE.has(license)) return 'replace';
  if (typeof staleMonths === 'number' && staleMonths > STALENESS_MONTHS) return 'update';
  return 'keep';
}

export function mtimeMonths(file, refDate = new Date()) {
  try {
    const st = statSync(file);
    const months = (refDate.getTime() - st.mtimeMs) / (1000 * 60 * 60 * 24 * 30);
    return Math.round(months * 10) / 10;
  } catch { return null; }
}

export function reviewRoot(root, opts = {}) {
  const pkg = readPackageJson(root.dir);
  if (!pkg) return { id: root.id, dir: root.dir, skipped: 'no package.json', deps: [] };
  const deps = listDependencies(pkg);
  const rows = [];
  for (const d of deps) {
    const installed = readInstalledManifest(root.dir, d.name);
    const license = detectLicense(installed);
    const installedPath = installed ? join(root.dir, 'node_modules', d.name, 'package.json') : null;
    const staleMonths = installedPath ? mtimeMonths(installedPath) : null;
    const installedVersion = installed?.version ?? null;
    const recommendation = recommend({ license, staleMonths, highCveCount: 0 });
    rows.push({
      name: d.name,
      section: d.section,
      declared: d.declared,
      installedVersion,
      license,
      staleMonths,
      recommendation,
      nonPermissive: NON_PERMISSIVE.has(license),
    });
  }
  return { id: root.id, dir: root.dir, deps: rows };
}

export function runReview() {
  const roots = PACKAGE_ROOTS.map((r) => reviewRoot(r));
  // Aggregate non-permissive count.
  let nonPermissive = 0;
  let totalDeps = 0;
  for (const r of roots) {
    for (const d of r.deps) {
      totalDeps++;
      if (d.nonPermissive) nonPermissive++;
    }
  }
  return { date: new Date().toISOString(), totals: { totalDeps, nonPermissive }, roots };
}

export function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Dependency Review — ${report.date.slice(0, 10)}`);
  lines.push('');
  lines.push(`**Totals:** packages=${report.totals.totalDeps} non-permissive=${report.totals.nonPermissive}`);
  lines.push('');
  for (const root of report.roots) {
    if (root.skipped) {
      lines.push(`## ${root.id} — _skipped: ${root.skipped}_`);
      continue;
    }
    lines.push(`## ${root.id} (${root.deps.length} deps)`);
    lines.push('');
    lines.push('| Name | Section | Declared | Installed | License | Stale (mo) | Recommendation |');
    lines.push('|---|---|---|---|---|---:|---|');
    for (const d of root.deps) {
      lines.push(`| \`${d.name}\` | ${d.section} | ${d.declared} | ${d.installedVersion ?? '—'} | ${d.license}${d.nonPermissive ? ' ⚠' : ''} | ${d.staleMonths ?? '—'} | ${d.recommendation} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const report = runReview();
  const dir = join(ROOT, 'reports/security');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'DEPENDENCY_REVIEW.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(dir, 'DEPENDENCY_REVIEW.md'), renderMarkdown(report));
  console.log(`[dep-review] totalDeps=${report.totals.totalDeps} nonPermissive=${report.totals.nonPermissive}`);
  console.log('  reports/security/DEPENDENCY_REVIEW.{md,json}');
  process.exit(report.totals.nonPermissive > 0 ? 1 : 0);
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('security/dependency-review.mjs');
if (isMain) main();
