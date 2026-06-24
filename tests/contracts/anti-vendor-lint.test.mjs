#!/usr/bin/env node
/**
 * tests/contracts/anti-vendor-lint.test.mjs
 *
 * P3 (2026-06-23) — Anti-vendor lint contract.
 *
 * Verifies tools/anti-vendor-lint.mjs:
 *   - VENDOR_PATTERNS detect known vendors (positive cases)
 *   - Clean text yields zero findings
 *   - scanContent emits {file, line, match, label, severity, context}
 *   - Severity classifier: report JSON slug → MEDIUM, slot.html title → LOW,
 *     plain MD → HIGH
 *   - isAllowlisted skips known internal paths
 *   - Live lint of repo yields HIGH=0 (current state baseline)
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

import {
  VENDOR_PATTERNS, ALLOWLIST_PATTERNS,
  scanContent, runLint, renderLint, isAllowlisted,
} from '../../tools/anti-vendor-lint.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('ANTI-VENDOR LINT contract · test suite');

test('VENDOR_PATTERNS detects known vendors (positive)', () => {
  const samples = [
    'Powered by IGT engine',
    'Pragmatic Play title',
    'Megaways mechanic',
    'cash eruption variant',
    'cash-eruption-foundry',
    'NetEnt classic',
    'Microgaming legacy',
    'Light & Wonder title',
  ];
  for (const s of samples) {
    const findings = scanContent(s, 'test.md');
    assert(findings.length > 0, `should detect vendor in: ${s}`);
  }
});

test('Clean industry-neutral text yields zero findings', () => {
  const clean = [
    'Industry-standard 5×3 reel grid.',
    'Reference benchmark rectangular topology.',
    'Standard pay-anywhere evaluator.',
    'Cluster pays with flood-fill detection.',
    'Tumble cascade with multiplier orbs.',
  ];
  for (const s of clean) {
    const findings = scanContent(s, 'test.md');
    assert(findings.length === 0, `false positive on clean: ${s} → ${JSON.stringify(findings)}`);
  }
});

test('scanContent emits expected fields per finding', () => {
  const findings = scanContent('Title: Cash Eruption Slot', 'reports/par-sheet.md');
  assert(findings.length === 1, '1 finding');
  const f = findings[0];
  assert(f.file === 'reports/par-sheet.md', 'file field');
  assert(f.lineNumber === 1, 'lineNumber 1');
  assert(f.match.toLowerCase().includes('cash eruption'), 'match contains vendor');
  assert(f.label === 'Cash Eruption', 'label correct');
  assert(['HIGH', 'MEDIUM', 'LOW'].includes(f.severity), `severity ladder, got ${f.severity}`);
  assert(typeof f.context === 'string', 'context string');
});

test('Severity: report JSON slug → MEDIUM', () => {
  const line = '  "slug": "cash-eruption-foundry-gdd",';
  const findings = scanContent(line, 'reports/portfolio-report.json');
  assert(findings.length === 1, '1 finding');
  assert(findings[0].severity === 'MEDIUM', `MEDIUM for slug in report JSON, got ${findings[0].severity}`);
});

test('Severity: slot.html title → LOW', () => {
  const line = '<title>Cash Eruption · Base Game</title>';
  const findings = scanContent(line, 'dist/real-games/cash-eruption-foundry-gdd/slot.html');
  assert(findings.length === 1, '1 finding');
  assert(findings[0].severity === 'LOW', `LOW for slot.html title, got ${findings[0].severity}`);
});

test('Severity: plain MD report → HIGH', () => {
  const line = 'This slot is similar to IGT Cleopatra.';
  const findings = scanContent(line, 'reports/regulator-one-pager.md');
  /* IGT match should be HIGH (plain report MD, no fixture markers). */
  const igtFinding = findings.find(f => f.label === 'industry standard');
  assert(igtFinding, 'IGT detected');
  assert(igtFinding.severity === 'HIGH', `HIGH for plain MD, got ${igtFinding.severity}`);
});

test('isAllowlisted skips internal paths', () => {
  assert(isAllowlisted('samples/CASH_ERUPTION.md'), 'samples/ allowed');
  assert(isAllowlisted('CLAUDE.md'), 'CLAUDE.md allowed');
  assert(isAllowlisted('MASTER_TODO.md'), 'MASTER_TODO.md allowed');
  assert(isAllowlisted('tools/anti-vendor-lint.mjs'), 'tool self allowed');
  assert(isAllowlisted('dist/real-games/cash-eruption-foundry-gdd/model.json'), 'model.json allowed');
  assert(isAllowlisted('tools/_wave-v-cache/cache.json'), '_wave-v-cache allowed');
  /* NOT allowed: */
  assert(!isAllowlisted('reports/regulator.md'), 'regulator MD NOT allowed');
  assert(!isAllowlisted('dist/real-games/foo/slot.html'), 'slot.html NOT allowed');
});

test('Live lint of repo yields HIGH=0 (clean public artifacts)', () => {
  const result = runLint([
    'dist/real-games/*/slot.html',
    'reports/par-sheets-*.md',
    'reports/par-sheets-*.csv',
    'reports/declared-vs-measured-audit.json',
    'reports/portfolio-report.json',
    'reports/audit-summary.json',
  ]);
  const high = result.findings.filter(f => f.severity === 'HIGH');
  assert(high.length === 0,
    `HIGH=0 contract violated: ${high.length} findings:\n${high.map(f => `  ${f.file}:${f.lineNumber} ${f.label}`).join('\n')}`);
});

test('renderLint produces clean ASCII with severity breakdown', () => {
  const result = runLint([
    'reports/portfolio-report.json',
    'reports/audit-summary.json',
  ]);
  const out = renderLint(result);
  assert(typeof out === 'string', 'string output');
  assert(out.includes('Anti-vendor lint'), 'has header');
  if (result.findings.length > 0) {
    assert(out.includes('HIGH=') || out.includes('MEDIUM=') || out.includes('LOW='),
      'has severity counts');
  } else {
    assert(out.includes('NO VENDOR LEAKAGE'), 'clean message');
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
