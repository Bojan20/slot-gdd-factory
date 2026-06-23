#!/usr/bin/env node
/**
 * tools/anti-vendor-lint.mjs
 *
 * P3 (2026-06-23) — Anti-vendor leakage lint. Continuous gate that
 * verifies NO vendor names appear in public-facing artifacts (rendered
 * slot HTML body text, regulator MD reports, sales one-pagers, PAR
 * sheet emissions). Internal slugs in file paths + dev infra are
 * allowed (back-compat with pre-tracked baselines).
 *
 * Why
 *   Per HARD RULE: vendor names ZABRANJENE u public output. Jednokratan
 *   purge urađen, ali bez continuous gate-a sledeći leak prolazi tiho.
 *   Ovaj tool je that gate.
 *
 * USAGE
 *   node tools/anti-vendor-lint.mjs                     # default scan
 *   node tools/anti-vendor-lint.mjs --json              # JSON only
 *   node tools/anti-vendor-lint.mjs --strict            # exit 1 if any finding
 *   node tools/anti-vendor-lint.mjs --paths a,b,c       # custom scan paths
 *
 * SCAN TARGETS (default)
 *   dist/real-games/<slug>/slot.html           — rendered playable output
 *   reports/par-sheets-*.md                     — par sheet markdown
 *   reports/par-sheets-*.csv                    — par sheet CSV
 *   reports/declared-vs-measured-audit.json     — operator audit
 *   reports/portfolio-report.json               — portfolio dashboard
 *   reports/audit-summary.json                  — total rollup
 *
 * ALLOWLIST (paths NEVER scanned)
 *   samples/                                    — internal GDD fixtures
 *   dist/real-games/<slug>/model.json           — internal parser output
 *   tools/_wave-v-cache/                        — internal V6 cache
 *   tests/fixtures/                             — test fixtures
 *   CLAUDE.md, MASTER_TODO.md                   — Corti memory + backlog
 *   tools/anti-vendor-lint.mjs                  — this tool's source
 *
 * EXIT
 *   0 — no findings (or --strict not set + findings exist)
 *   1 — --strict + findings > 0
 *   2 — config / IO error
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const OUT_DIR    = join(REPO, 'reports');

const args = process.argv.slice(2);
const jsonOnly = args.includes('--json');
const strict   = args.includes('--strict');
const pathsArg = (() => {
  const i = args.findIndex(a => a === '--paths' || a.startsWith('--paths='));
  if (i === -1) return null;
  return args[i].includes('=') ? args[i].split('=')[1] : args[i + 1];
})();

/* ── Vendor patterns ─────────────────────────────────────────────────── */

/**
 * Vendor-leak patterns. Case-insensitive, word-boundary-aware where
 * possible. Multi-word vendors expressed as RegExp.
 */
const VENDOR_PATTERNS = [
  { pattern: /\bIGT\b/i,                  label: 'IGT' },
  { pattern: /\bpragmatic\s+play\b/i,     label: 'Pragmatic Play' },
  { pattern: /\bmegaways\b/i,             label: 'Megaways' },
  { pattern: /\bcash[\s-]eruption\b/i,    label: 'Cash Eruption' },
  { pattern: /\bwolf[\s-]run\b/i,         label: 'Wolf Run' },
  { pattern: /\bcleopatra\b/i,            label: 'Cleopatra' },
  { pattern: /\bbuffalo\s+(king|gold)\b/i, label: 'Buffalo King/Gold' },
  { pattern: /\bnetent\b/i,               label: 'NetEnt' },
  { pattern: /\bmicrogaming\b/i,          label: 'Microgaming' },
  { pattern: /\bscientific\s+games\b/i,   label: 'Scientific Games' },
  { pattern: /\bL&W\b/,                   label: 'L&W' },
  { pattern: /\blight\s*&\s*wonder\b/i,   label: 'Light & Wonder' },
  { pattern: /\bplay\s*'?n\s*go\b/i,      label: "Play'n Go" },
  { pattern: /\bnovomatic\b/i,            label: 'Novomatic' },
];

/* ── Default scan targets ────────────────────────────────────────────── */

const DEFAULT_TARGETS = [
  'dist/real-games/*/slot.html',
  'reports/par-sheets-*.md',
  'reports/par-sheets-*.csv',
  'reports/declared-vs-measured-audit.json',
  'reports/portfolio-report.json',
  'reports/audit-summary.json',
];

/* Paths that are NEVER scanned. Substring match against POSIX-style
 * repo-relative path. Order: most-specific first. */
const ALLOWLIST_PATTERNS = [
  /^samples\//,
  /\/model\.json$/,                          // parser internal output
  /^tools\/_wave-v-cache\//,
  /^tests\/fixtures\//,
  /^CLAUDE\.md$/,
  /^MASTER_TODO\.md$/,
  /^tools\/anti-vendor-lint\.mjs$/,          // this tool
  /^tests\/contracts\/anti-vendor-lint/,     // its tests
  /^reports\/agent-calibration-/,            // dev telemetry
  /^reports\/_/,                             // internal probe dirs
];

function isAllowlisted(relPath) {
  return ALLOWLIST_PATTERNS.some(rx => rx.test(relPath));
}

/* ── Glob expansion (minimal — no full glob lib) ─────────────────────── */

function expandGlob(pattern) {
  /* Pattern format: a/b/<star>/c.md or a/<star>-suffix.csv. */
  const absRoot = REPO;
  const parts = pattern.split('/');
  let candidates = [absRoot];
  for (const seg of parts) {
    const next = [];
    for (const c of candidates) {
      if (!existsSync(c)) continue;
      const stat = statSync(c);
      if (!stat.isDirectory()) continue;
      const entries = readdirSync(c);
      if (seg === '*') {
        for (const e of entries) next.push(join(c, e));
      } else if (seg.includes('*')) {
        const rx = new RegExp('^' + seg.replace(/\*/g, '.*') + '$');
        for (const e of entries) {
          if (rx.test(e)) next.push(join(c, e));
        }
      } else {
        next.push(join(c, seg));
      }
    }
    candidates = next;
  }
  return candidates.filter(p => existsSync(p) && statSync(p).isFile());
}

/* ── Scanner ─────────────────────────────────────────────────────────── */

/* Severity classifier:
 *   HIGH   = vendor mention in non-fixture path (regulator/sales/par-sheet output)
 *   MEDIUM = internal slug leak in report JSON (informational, slug is identifier)
 *   LOW    = vendor mention in synth fixture HTML title (test fixture, gameplay UX)
 * --strict gate blocks HIGH only. */
function classifySeverity(filePath, line, match) {
  const isReportJson = /^reports\/.+\.json$/.test(filePath);
  const isSlotHtml   = /^dist\/real-games\/.+\/slot\.html$/.test(filePath);
  /* MEDIUM: slug key in report JSON e.g. "slug": "cash-eruption-foundry-gdd". */
  if (isReportJson && /["']slug["']\s*:\s*["'][^"']*-gdd["']/.test(line)) return 'MEDIUM';
  if (isReportJson && /["'][a-z0-9-]+-gdd["']/.test(line)) return 'MEDIUM';
  /* LOW: rendered slot HTML title/h1/__MODEL_NAME__ — test fixture surface text. */
  if (isSlotHtml && /(<title>|class="title"|__MODEL_NAME__|GDD_INFO|SPECIALS)/.test(line)) return 'LOW';
  /* Default: HIGH (true public artifact leak). */
  return 'HIGH';
}

/**
 * Scan single file content for vendor patterns. Returns array of
 * { line, lineNumber, match, label, severity } findings.
 */
function scanContent(content, filePath) {
  const findings = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { pattern, label } of VENDOR_PATTERNS) {
      const m = pattern.exec(line);
      if (m) {
        findings.push({
          file: filePath,
          lineNumber: i + 1,
          match: m[0],
          label,
          severity: classifySeverity(filePath, line, m[0]),
          context: line.length > 120 ? line.slice(0, 117) + '…' : line,
        });
      }
    }
  }
  return findings;
}

function runLint(targets) {
  const expanded = [];
  for (const t of targets) expanded.push(...expandGlob(t));
  const findings = [];
  let scanned = 0;
  for (const file of expanded) {
    const rel = relative(REPO, file);
    if (isAllowlisted(rel)) continue;
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch { continue; }
    scanned++;
    findings.push(...scanContent(content, rel));
  }
  return { scanned, findings };
}

/* ── ASCII renderer ──────────────────────────────────────────────────── */

function renderLint(result) {
  const lines = [];
  lines.push(`Anti-vendor lint — scanned ${result.scanned} file(s)`);
  lines.push('');
  if (result.findings.length === 0) {
    lines.push('  ✓ NO VENDOR LEAKAGE DETECTED');
    lines.push('');
    return lines.join('\n');
  }
  const sevCounts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of result.findings) sevCounts[f.severity]++;
  lines.push(`  Findings: ${result.findings.length} total · HIGH=${sevCounts.HIGH}  MEDIUM=${sevCounts.MEDIUM}  LOW=${sevCounts.LOW}`);
  lines.push('  HIGH = public artifact leak (strict-gate blocking)');
  lines.push('  MEDIUM = internal slug in report JSON (informational)');
  lines.push('  LOW = test fixture HTML title (gameplay UX)');
  lines.push('');
  /* Group by severity then vendor label. */
  for (const sev of ['HIGH', 'MEDIUM', 'LOW']) {
    const sevFindings = result.findings.filter(f => f.severity === sev);
    if (sevFindings.length === 0) continue;
    lines.push(`  [${sev}] ${sevFindings.length} finding(s):`);
    const byLabel = {};
    for (const f of sevFindings) {
      byLabel[f.label] ||= [];
      byLabel[f.label].push(f);
    }
    for (const [label, items] of Object.entries(byLabel)) {
      lines.push(`    ▸ ${label} (${items.length}):`);
      for (const f of items.slice(0, 3)) {
        lines.push(`        ${f.file}:${f.lineNumber}  "${f.match}"`);
      }
      if (items.length > 3) lines.push(`        … +${items.length - 3} more`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('anti-vendor-lint.mjs')) {
  const targets = pathsArg
    ? pathsArg.split(',').map(s => s.trim())
    : DEFAULT_TARGETS;
  const result = runLint(targets);
  if (!jsonOnly) {
    console.log(renderLint(result));
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const out = {
    generatedAt: new Date().toISOString(),
    tool: 'tools/anti-vendor-lint.mjs',
    targets,
    scanned: result.scanned,
    findingsCount: result.findings.length,
    findings: result.findings,
  };
  const outPath = join(OUT_DIR, 'anti-vendor-lint.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  if (jsonOnly) console.log(JSON.stringify(out, null, 2));
  else console.log(`Report: ${outPath}`);
  const highCount = result.findings.filter(f => f.severity === 'HIGH').length;
  if (strict && highCount > 0) {
    console.error(`▸ STRICT FAIL: ${highCount} HIGH-severity vendor-leakage finding(s)`);
    process.exit(1);
  }
  process.exit(0);
}

export {
  VENDOR_PATTERNS, ALLOWLIST_PATTERNS,
  scanContent, runLint, renderLint, isAllowlisted,
};
