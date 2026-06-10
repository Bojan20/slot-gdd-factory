#!/usr/bin/env node
/**
 * tools/_analyze-fleet-report.mjs
 *
 * Read fleet-report.json + aggregate failures by:
 *   - grid kind  (from filename GRID-XXX)
 *   - feature combo  (from filename pattern segment)
 *   - per-check failure pivot
 *
 * Output: human-readable summary so Boki + Corti can identify which
 * combinations cluster around which engine/parser/block bug.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const REPORT = resolve(REPO, 'tools/_eyes/fleet/fleet-report.json');

if (!existsSync(REPORT)) {
  console.error(`Missing report: ${REPORT}`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(REPORT, 'utf8'));
console.log(`\nFleet report — ${data.total} PDFs · ✓ ${data.pass} · ✗ ${data.fail}\n`);

if (data.fail === 0) {
  console.log('🎉 0 failing — perfect.');
  process.exit(0);
}

/* Parse filename: NNN__GRID-XXX__FeatList[_+N]__density.pdf */
function parseFile(name) {
  const m = name.match(/^\d+__([^_]+)__([^.]+?)(__min|__max)?\.pdf$/);
  if (!m) return { grid: '?', pattern: name, density: 'std' };
  return { grid: m[1], pattern: m[2], density: (m[3] || 'std').replace(/_/g, '') || 'std' };
}

const byGrid = {};
const byPattern = {};
const failCheckByGrid = {};
for (const r of data.failing || []) {
  const p = parseFile(r.pdf);
  byGrid[p.grid]       = (byGrid[p.grid]       || 0) + 1;
  byPattern[p.pattern] = (byPattern[p.pattern] || 0) + 1;
  const failedChecks = Object.entries(r.checks || {}).filter(([_, v]) => v === false).map(([k]) => k);
  if (r.fatal) failedChecks.push('FATAL');
  failCheckByGrid[p.grid] = failCheckByGrid[p.grid] || {};
  for (const c of failedChecks) {
    failCheckByGrid[p.grid][c] = (failCheckByGrid[p.grid][c] || 0) + 1;
  }
}

console.log('Fail count by GRID:');
const grids = Object.entries(byGrid).sort((a, b) => b[1] - a[1]);
for (const [g, n] of grids) console.log(`  ${String(n).padStart(4)}  ${g}`);

console.log('\nFail count by PATTERN (top 20):');
const patterns = Object.entries(byPattern).sort((a, b) => b[1] - a[1]).slice(0, 20);
for (const [p, n] of patterns) console.log(`  ${String(n).padStart(4)}  ${p}`);

console.log('\nPer-GRID failed-check breakdown:');
for (const [g, checks] of Object.entries(failCheckByGrid)) {
  const entries = Object.entries(checks).sort((a, b) => b[1] - a[1]);
  console.log(`  ${g}: ${entries.map(([k, v]) => `${k}=${v}`).join(', ')}`);
}

console.log('\nGlobal per-check histogram:');
const histo = data.histogram || {};
const sorted = Object.entries(histo).sort((a, b) => b[1] - a[1]);
for (const [k, v] of sorted) console.log(`  ${String(v).padStart(4)}  ${k}`);

console.log('\nFirst 30 failing PDFs:');
for (const r of (data.failing || []).slice(0, 30)) {
  const fails = r.fatal ? `FATAL` : Object.entries(r.checks).filter(([_, v]) => v === false).map(([k]) => k).join(',');
  console.log(`  ${r.pdf}  ::  ${fails}`);
}
