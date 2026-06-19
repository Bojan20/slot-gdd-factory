#!/usr/bin/env node
/**
 * tests/blocks/_blockPairBrowserProbe.test.mjs
 *
 * D-2b wrapper test — pins the block-pair real-browser probe report
 * shape and asserts zero pair-failure.
 *
 * Depends on D-2a (`tests/blocks/_perBlockBrowserProbe.test.mjs`) having
 * produced `reports/per-block-real/summary.json` first. If absent, the
 * pair probe self-exits 2; this test treats that as a soft skip.
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
const probePath = joinPath(repo, 'tools/_ultimate-block-pair-browser-probe.mjs');
const perBlockReport = joinPath(repo, 'reports/per-block-real/summary.json');
const pairReport = joinPath(repo, 'reports/per-block-real/pair-summary.json');

console.log('\n— D-2b block-pair real-browser probe wrapper —');

if (!existsSync(perBlockReport)) {
  console.log('  ⚠ skipping — D-2a per-block report not present (run _perBlockBrowserProbe first)');
  process.exit(0);
}

block('1. Pair probe spawn + exit code', () => {
  const r = spawnSync('node', [probePath, '--pairs=30', '--seed=1'], {
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,  /* 30 pairs × ~5s = ~2.5 min; 10 min ceiling */
  });
  t('1.1 spawn succeeded', r.status !== null);
  t('1.2 exit code 0', r.status === 0,
    r.status !== 0 ? `exit ${r.status}\n${(r.stdout || '').slice(-1500)}\n${(r.stderr || '').slice(-500)}` : null);
  t('1.3 stdout reports D-2b header', /D-2b ULTIMATE BLOCK-PAIR/.test(r.stdout || ''));
});

block('2. Pair report shape', () => {
  t('2.1 pair-summary.json exists', existsSync(pairReport));
  if (!existsSync(pairReport)) return;
  const json = JSON.parse(readFileSync(pairReport, 'utf8'));
  t('2.2 has pairs number', typeof json.pairs === 'number' && json.pairs > 0);
  t('2.3 has seed number', typeof json.seed === 'number');
  t('2.4 has pass/fail counters',
    typeof json.pass === 'number' && typeof json.fail === 'number');
  t('2.5 has results array sized == pairs',
    Array.isArray(json.results) && json.results.length === json.pairs);
});

block('3. Quality gate — zero pair FAIL', () => {
  if (!existsSync(pairReport)) { t('3.0 report exists', false); return; }
  const json = JSON.parse(readFileSync(pairReport, 'utf8'));
  t('3.1 zero FAIL pairs', json.fail === 0,
    json.fail > 0
      ? `${json.fail} pair failures: ` +
        json.results.filter(r => r.status === 'FAIL').slice(0, 3)
          .map(r => `${r.pair} (${r.reasons.join(',')})`).join('; ')
      : null);
});

console.log(`\nResult: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
