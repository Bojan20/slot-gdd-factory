#!/usr/bin/env node
/**
 * CORTI W205-SECURITY — secrets sweep.
 *
 * Scans every git-tracked file for accidental secret commits using a
 * curated regex set (trufflehog-style). Emits JSON + Markdown into
 * reports/security/.
 *
 * Usage:
 *   node scripts/secrets-sweep.mjs            # scan + write reports
 *   node scripts/secrets-sweep.mjs --json     # JSON dump to stdout
 *
 * Exit code:
 *   0 = clean
 *   1 = at least one secret detected
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** Patterns inspired by trufflehog + GitGuardian rule packs. */
export const SECRET_PATTERNS = [
  { id: 'aws-access-key',   severity: 'Critical', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'aws-secret-key',   severity: 'Critical', re: /aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/i },
  { id: 'github-token',     severity: 'Critical', re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { id: 'github-pat',       severity: 'Critical', re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { id: 'gitlab-token',     severity: 'High',     re: /\bglpat-[A-Za-z0-9_-]{20}\b/ },
  { id: 'openai-key',       severity: 'Critical', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { id: 'slack-token',      severity: 'High',     re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'stripe-secret',    severity: 'Critical', re: /\b(sk|rk)_live_[A-Za-z0-9]{24,}\b/ },
  { id: 'stripe-test',      severity: 'Medium',   re: /\b(sk|rk)_test_[A-Za-z0-9]{24,}\b/ },
  { id: 'jwt-token',        severity: 'Medium',   re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ },
  { id: 'pem-private-key',  severity: 'Critical', re: /-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/ },
  { id: 'pgp-private-key',  severity: 'Critical', re: /-----BEGIN PGP PRIVATE KEY BLOCK-----/ },
  { id: 'password-literal', severity: 'High',     re: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"\s]{6,}['"]/i },
  { id: 'db-conn-postgres', severity: 'High',     re: /\bpostgres(?:ql)?:\/\/[^\s'"]+:[^\s'"]+@[^\s'"\/]+\/\w+/ },
  { id: 'db-conn-mysql',    severity: 'High',     re: /\bmysql:\/\/[^\s'"]+:[^\s'"]+@[^\s'"\/]+\/\w+/ },
  { id: 'db-conn-mongo',    severity: 'High',     re: /\bmongodb(?:\+srv)?:\/\/[^\s'"]+:[^\s'"]+@[^\s'"\/]+/ },
  { id: 'generic-api-key',  severity: 'Medium',   re: /\b(?:api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{32,}['"]/i },
];

/** Files/extensions to skip (binary or generated). */
const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf',
  '.zip', '.gz', '.tgz', '.tar', '.lock', '.wasm',
  '.ttf', '.woff', '.woff2',
]);
const SKIP_FILES = new Set([
  'package-lock.json', // huge; SHA registry strings yield false positives
]);
/** Substrings: any path containing these is skipped. */
const SKIP_PATH_SUB = [
  'node_modules/', 'dist/', '/target/', 'reports/', 'out/', '/coverage/',
  '.git/', 'rust-sim/target/',
];

export function gitListTrackedFiles(cwd = ROOT, exec = execSync) {
  try {
    const out = exec('git ls-files -z', { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return out.split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

export function shouldScanFile(relPath) {
  if (SKIP_FILES.has(relPath.split('/').pop() ?? '')) return false;
  if (SKIP_EXT.has(extname(relPath).toLowerCase())) return false;
  for (const sub of SKIP_PATH_SUB) {
    if (relPath.includes(sub)) return false;
  }
  return true;
}

/** Returns true when a hit is a known-safe dev placeholder we want to allowlist. */
export function isAllowlistedPlaceholder(rule, line, filePath) {
  // Docker-compose dev placeholders with internal hostnames + dev user/pass.
  if (rule === 'db-conn-postgres' || rule === 'db-conn-mysql' || rule === 'db-conn-mongo') {
    if (/docker-compose(\.[a-z]+)?\.ya?ml$/.test(filePath)
      && /(postgres:postgres@postgres|root:root@mysql|admin:admin@mongo|@localhost|@127\.0\.0\.1|@db:)/.test(line)) {
      return true;
    }
  }
  return false;
}

export function scanContent(content, filePath = '?') {
  const hits = [];
  // Cap file size to avoid huge JSON dumps eating memory.
  const MAX_BYTES = 2 * 1024 * 1024;
  const truncated = content.length > MAX_BYTES;
  const body = truncated ? content.slice(0, MAX_BYTES) : content;
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pat of SECRET_PATTERNS) {
      const m = pat.re.exec(line);
      if (m) {
        if (isAllowlistedPlaceholder(pat.id, line, filePath)) {
          pat.re.lastIndex = 0;
          continue;
        }
        hits.push({
          id: pat.id, severity: pat.severity,
          file: filePath, line: i + 1,
          // Redacted excerpt — show 8 chars head + length.
          excerpt: redact(m[0]),
        });
      }
      // Reset lastIndex for global regexes (none currently, but safe-guard).
      pat.re.lastIndex = 0;
    }
  }
  return { hits, truncated };
}

export function redact(s) {
  if (s.length <= 8) return '***';
  return `${s.slice(0, 4)}…${s.slice(-2)} (len=${s.length})`;
}

export function emptyCounts() {
  return { Critical: 0, High: 0, Medium: 0, Low: 0 };
}

export function aggregateHits(hits) {
  const c = emptyCounts();
  for (const h of hits) {
    if (c[h.severity] !== undefined) c[h.severity]++;
  }
  return c;
}

export function renderMarkdown(report, date) {
  const lines = [];
  lines.push(`# Secrets Sweep — ${date}`);
  lines.push('');
  lines.push(`**Files scanned:** ${report.scannedCount}`);
  lines.push(`**Counts:** Critical=${report.counts.Critical} High=${report.counts.High} Medium=${report.counts.Medium} Low=${report.counts.Low}`);
  lines.push('');
  if (report.hits.length === 0) {
    lines.push('No secrets detected.');
    return lines.join('\n');
  }
  lines.push('## Findings');
  lines.push('');
  lines.push('| Severity | Rule | File:line | Excerpt |');
  lines.push('|---|---|---|---|');
  for (const h of report.hits) {
    lines.push(`| ${h.severity} | \`${h.id}\` | \`${h.file}:${h.line}\` | \`${h.excerpt}\` |`);
  }
  return lines.join('\n');
}

export function runSweep(opts = {}) {
  const cwd = opts.cwd ?? ROOT;
  const files = (opts.files ?? gitListTrackedFiles(cwd));
  const hits = [];
  let scanned = 0;
  for (const rel of files) {
    if (!shouldScanFile(rel)) continue;
    const abs = join(cwd, rel);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (!st.isFile()) continue;
    if (st.size > 4 * 1024 * 1024) continue; // skip huge files
    let content;
    try { content = readFileSync(abs, 'utf8'); } catch { continue; }
    scanned++;
    const { hits: fileHits } = scanContent(content, rel);
    hits.push(...fileHits);
  }
  return { scannedCount: scanned, hits, counts: aggregateHits(hits) };
}

/** Ensure suggested env files are in .gitignore if found tracked. */
export function ensureGitignoreEntries(gitignorePath, suggested = ['.env.local', '.env.production']) {
  const exists = existsSync(gitignorePath);
  const cur = exists ? readFileSync(gitignorePath, 'utf8') : '';
  let updated = cur;
  let changed = false;
  for (const entry of suggested) {
    if (!cur.split(/\r?\n/).some((l) => l.trim() === entry)) {
      updated += (updated.endsWith('\n') ? '' : '\n') + entry + '\n';
      changed = true;
    }
  }
  if (changed) writeFileSync(gitignorePath, updated);
  return { changed, added: suggested.filter((e) => !cur.includes(e)) };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function main() {
  const report = runSweep();
  const date = todayIso();
  const dir = join(ROOT, 'reports/security');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `SECRETS_SWEEP_${date}.json`), JSON.stringify({ date, ...report }, null, 2));
  writeFileSync(join(dir, `SECRETS_SWEEP_${date}.md`), renderMarkdown(report, date));
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ date, ...report }, null, 2) + '\n');
  } else {
    // eslint-disable-next-line no-console
    console.log(`[secrets-sweep] ${date} scanned=${report.scannedCount} ${JSON.stringify(report.counts)}`);
    // eslint-disable-next-line no-console
    console.log(`  reports/security/SECRETS_SWEEP_${date}.{json,md}`);
  }
  // Auto-add .env.local etc to gitignore if missing
  ensureGitignoreEntries(join(ROOT, '.gitignore'));
  if (report.counts.Critical > 0 || report.counts.High > 0) process.exit(1);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('secrets-sweep.mjs');
if (isMain) main();
