#!/usr/bin/env node
/**
 * tests/blocks/_perBlockBrowserProbe.test.mjs
 *
 * D-2 wrapper test — pins the per-block real-browser probe report shape
 * and asserts a healthy global pass-rate.
 *
 * Pins:
 *   • Probe exit code 0
 *   • Report file exists at reports/per-block-real/summary.json
 *   • Report has pass/warn/fail counters
 *   • Per-block results array sized == totalBlocks
 *   • Every result has {name, status, reasons} shape
 *   • Global PASS rate >= 95% (allow some WARN on environmental flakes)
 *   • Zero FAIL — any FAIL means a real block is broken end-to-end
 *
 * This test runs --quick (1 spin per block) so it stays under ~12 min.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as joinPath } from 'node:path';
import { spawnSync } from 'node:child_process';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

const here = dirname(fileURLToPath(import.meta.url));
const repo = joinPath(here, '../..');
const probePath = joinPath(repo, 'tools/_ultimate-per-block-browser-probe.mjs');
const reportPath = joinPath(repo, 'reports/per-block-real/summary.json');

console.log('\n— D-2 per-block real-browser probe wrapper —');

/* ════════════════════════════════════════════════════════════════════
 * 1. Probe runs and exits 0
 * ════════════════════════════════════════════════════════════════════ */
block('1. Probe spawn + exit code', () => {
  const r = spawnSync('node', [probePath, '--quick'], {
    encoding: 'utf8',
    timeout: 25 * 60 * 1000,  /* 25 min ceiling — full run typically 10-15 min */
  });
  t('1.1 spawn succeeded', r.status !== null,
    r.error ? `spawn error: ${r.error.message}` : null);
  t('1.2 exit code 0', r.status === 0,
    r.status !== 0 ? `exit ${r.status}\n${(r.stdout || '').slice(-2000)}\n${(r.stderr || '').slice(-500)}` : null);
  t('1.3 stdout reports D-2 header', /D-2 ULTIMATE PER-BLOCK BROWSER PROBE/.test(r.stdout || ''));
  t('1.4 stdout reports Summary section', /— Summary —/.test(r.stdout || ''));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. Report shape
 * ════════════════════════════════════════════════════════════════════ */
block('2. Report file shape', () => {
  t('2.1 report file written', existsSync(reportPath));
  if (!existsSync(reportPath)) { console.log(''); return; }

  const raw = readFileSync(reportPath, 'utf8');
  let json = null;
  try { json = JSON.parse(raw); } catch (e) { t('2.2 report parses as JSON', false, e.message); return; }
  t('2.2 report parses as JSON', !!json);

  t('2.3 has generatedAt ISO timestamp',
    typeof json.generatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(json.generatedAt));
  t('2.4 has totalBlocks number > 100', typeof json.totalBlocks === 'number' && json.totalBlocks > 100);
  t('2.5 has pass/warn/fail counters',
    typeof json.pass === 'number' &&
    typeof json.warn === 'number' &&
    typeof json.fail === 'number');
  t('2.6 has spinsPerBlock number', typeof json.spinsPerBlock === 'number' && json.spinsPerBlock >= 1);
  t('2.7 has wallMs number', typeof json.wallMs === 'number' && json.wallMs > 0);
  t('2.8 has results array sized == totalBlocks',
    Array.isArray(json.results) && json.results.length === json.totalBlocks);
});

/* ════════════════════════════════════════════════════════════════════
 * 3. Per-result shape
 * ════════════════════════════════════════════════════════════════════ */
block('3. Per-result shape (every entry)', () => {
  if (!existsSync(reportPath)) { t('3.1 report exists', false); return; }
  const json = JSON.parse(readFileSync(reportPath, 'utf8'));
  let allShape = true, allStatus = true, allName = true;
  for (const r of json.results) {
    if (typeof r.name !== 'string' || r.name.length === 0) allName = false;
    if (!['PASS', 'WARN', 'FAIL'].includes(r.status)) allStatus = false;
    if (!Array.isArray(r.reasons)) allShape = false;
  }
  t('3.1 every result has non-empty name', allName);
  t('3.2 every result has valid status', allStatus);
  t('3.3 every result has reasons array', allShape);
});

/* ════════════════════════════════════════════════════════════════════
 * 4. Quality gate — zero FAIL, high PASS rate
 * ════════════════════════════════════════════════════════════════════ */
block('4. Quality gate', () => {
  if (!existsSync(reportPath)) { t('4.0 report exists', false); return; }
  const json = JSON.parse(readFileSync(reportPath, 'utf8'));
  const total = json.totalBlocks;
  const passRate = total > 0 ? json.pass / total : 0;

  t('4.1 zero FAIL (no block end-to-end broken)', json.fail === 0,
    json.fail > 0
      ? `${json.fail} failures: ` +
        json.results.filter(r => r.status === 'FAIL').slice(0, 5)
          .map(r => `${r.name}(${r.reasons.join(',')})`).join('; ')
      : null);
  t('4.2 PASS rate >= 95%', passRate >= 0.95,
    passRate < 0.95 ? `actual ${(passRate * 100).toFixed(1)}%` : null);
});

console.log(`\nResult: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
