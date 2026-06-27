#!/usr/bin/env node
/**
 * CORTI W205-SECURITY — dependency vulnerability scan.
 *
 * Runs `npm audit --json` at each manifest in the repo and aggregates
 * the findings by severity. Emits JSON + Markdown into
 * reports/security/.
 *
 * Manifest roots checked:
 *   - /                       (engine + acceptance scripts)
 *   - /web/studio, operator, regulator, marketplace, cabinet
 *   - /sdk
 *
 * Usage:
 *   node scripts/dependency-scan.mjs            # scan only
 *   node scripts/dependency-scan.mjs --fix      # run npm audit fix where Critical/High exist
 *   node scripts/dependency-scan.mjs --json     # dump JSON to stdout
 *
 * Exit code:
 *   0 = no Critical CVEs
 *   1 = Critical CVE found
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

export const MANIFEST_ROOTS = [
  { id: 'root', dir: ROOT },
  { id: 'web/studio', dir: join(ROOT, 'web/studio') },
  { id: 'web/operator', dir: join(ROOT, 'web/operator') },
  { id: 'web/regulator', dir: join(ROOT, 'web/regulator') },
  { id: 'web/marketplace', dir: join(ROOT, 'web/marketplace') },
  { id: 'web/cabinet', dir: join(ROOT, 'web/cabinet') },
  { id: 'sdk', dir: join(ROOT, 'sdk') },
];

/** Severity buckets surfaced by npm audit. */
export const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'];

export function emptyBuckets() {
  return { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
}

/** Run `npm audit --json` in `dir`; return parsed JSON or { error }. */
export function runAuditAt(dir, exec = execSync) {
  if (!existsSync(join(dir, 'package.json'))) {
    return { skipped: true, reason: 'no_package_json' };
  }
  try {
    const out = exec('npm audit --json', {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(out);
  } catch (err) {
    // npm audit exits non-zero when vulns are present — stdout still has JSON
    const stdout = err && err.stdout ? err.stdout.toString() : '';
    if (stdout && stdout.trim().startsWith('{')) {
      try { return JSON.parse(stdout); } catch { /* fallthrough */ }
    }
    return { error: err?.message ?? 'audit_failed' };
  }
}

export function summariseAudit(auditJson) {
  if (auditJson?.skipped || auditJson?.error) {
    return {
      buckets: emptyBuckets(),
      total: 0,
      cves: [],
      ...(auditJson.skipped ? { skipped: true, reason: auditJson.reason } : {}),
      ...(auditJson.error ? { error: auditJson.error } : {}),
    };
  }
  const buckets = emptyBuckets();
  const cves = [];
  // npm audit v2 schema: metadata.vulnerabilities + vulnerabilities map
  const meta = auditJson?.metadata?.vulnerabilities ?? null;
  if (meta) {
    for (const k of Object.keys(meta)) {
      if (k in buckets) buckets[k] = meta[k];
    }
  }
  const vulns = auditJson?.vulnerabilities ?? {};
  for (const [name, v] of Object.entries(vulns)) {
    const viaTitles = (Array.isArray(v.via) ? v.via : [])
      .map((x) => (typeof x === 'object' && x.title ? `${x.title}` : (typeof x === 'string' ? x : null)))
      .filter(Boolean);
    cves.push({
      name,
      severity: v.severity,
      range: v.range,
      via: viaTitles,
      fixAvailable: typeof v.fixAvailable === 'object'
        ? { name: v.fixAvailable.name, version: v.fixAvailable.version, semverMajor: !!v.fixAvailable.isSemVerMajor }
        : !!v.fixAvailable,
    });
  }
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  return { buckets, total, cves };
}

export function aggregate(results) {
  const totals = emptyBuckets();
  for (const r of Object.values(results)) {
    if (!r.summary) continue;
    for (const k of SEVERITIES) totals[k] += (r.summary.buckets[k] ?? 0);
  }
  return totals;
}

export function renderMarkdown(report, date) {
  const lines = [];
  lines.push(`# Dependency Vulnerability Scan — ${date}`);
  lines.push('');
  lines.push(`**Totals:** critical=${report.totals.critical} high=${report.totals.high} moderate=${report.totals.moderate} low=${report.totals.low} info=${report.totals.info}`);
  lines.push('');
  lines.push('## Per-manifest summary');
  lines.push('');
  lines.push('| Manifest | Critical | High | Moderate | Low | Info | Status |');
  lines.push('|---|---:|---:|---:|---:|---:|---|');
  for (const [id, r] of Object.entries(report.perManifest)) {
    if (r.summary?.skipped) {
      lines.push(`| \`${id}\` | — | — | — | — | — | skipped (${r.summary.reason}) |`);
      continue;
    }
    if (r.summary?.error) {
      lines.push(`| \`${id}\` | — | — | — | — | — | error: ${r.summary.error} |`);
      continue;
    }
    const b = r.summary.buckets;
    lines.push(`| \`${id}\` | ${b.critical} | ${b.high} | ${b.moderate} | ${b.low} | ${b.info} | ${b.critical + b.high > 0 ? 'ATTENTION' : 'ok'} |`);
  }
  lines.push('');
  lines.push('## CVEs (Critical/High)');
  lines.push('');
  let any = false;
  for (const [id, r] of Object.entries(report.perManifest)) {
    if (!r.summary?.cves) continue;
    const ch = r.summary.cves.filter((c) => c.severity === 'critical' || c.severity === 'high');
    if (ch.length === 0) continue;
    any = true;
    lines.push(`### ${id}`);
    for (const c of ch) {
      lines.push(`- **[${c.severity}]** \`${c.name}\` ${c.range ?? ''} — via: ${c.via.join('; ') || 'n/a'}.`);
      if (c.fixAvailable && typeof c.fixAvailable === 'object') {
        lines.push(`  - Fix: upgrade \`${c.fixAvailable.name}\` to \`${c.fixAvailable.version}\` (semver-major: ${c.fixAvailable.semverMajor}).`);
      } else if (c.fixAvailable === true) {
        lines.push(`  - Fix: run \`npm audit fix\` (auto-fix available).`);
      }
    }
    lines.push('');
  }
  if (!any) lines.push('_None._');
  lines.push('');
  return lines.join('\n');
}

export function buildReport(perManifest) {
  return { totals: aggregate(perManifest), perManifest };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function main() {
  const perManifest = {};
  for (const m of MANIFEST_ROOTS) {
    const audit = runAuditAt(m.dir);
    perManifest[m.id] = { dir: relative(ROOT, m.dir) || '.', summary: summariseAudit(audit) };
  }
  const report = buildReport(perManifest);
  const date = todayIso();
  const dir = join(ROOT, 'reports/security');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `DEPENDENCIES_${date}.json`), JSON.stringify({ date, ...report }, null, 2));
  writeFileSync(join(dir, `DEPENDENCIES_${date}.md`), renderMarkdown(report, date));

  if (process.argv.includes('--fix')) {
    for (const [id, r] of Object.entries(perManifest)) {
      const b = r.summary?.buckets;
      if (!b || (b.critical === 0 && b.high === 0)) continue;
      const dir = MANIFEST_ROOTS.find((x) => x.id === id)?.dir;
      if (!dir) continue;
      try {
        execSync('npm audit fix --no-audit --no-fund', { cwd: dir, stdio: 'inherit' });
      } catch { /* npm audit fix can exit nonzero; tolerated */ }
    }
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ date, ...report }, null, 2) + '\n');
  } else {
    // eslint-disable-next-line no-console
    console.log(`[dependency-scan] ${date} totals: ${JSON.stringify(report.totals)}`);
    // eslint-disable-next-line no-console
    console.log(`  reports/security/DEPENDENCIES_${date}.{json,md}`);
  }
  if (report.totals.critical > 0) process.exit(1);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('dependency-scan.mjs');
if (isMain) main();
