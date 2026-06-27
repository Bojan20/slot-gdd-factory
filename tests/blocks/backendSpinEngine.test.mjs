/**
 * tests/blocks/backendSpinEngine.test.mjs
 *
 * QA-3d · Boki 2026-06-27 — block test parity za backendSpinEngine.
 * Pure Node tests koji vežbaju exportovani API contract.
 */
import {
  defaultConfig,
  resolveConfig,
  emitBackendSpinEngineRuntime,
} from '../../src/blocks/backendSpinEngine.mjs';

let pass = 0, fail = 0;
function t(name, ok) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n=== backendSpinEngine block ===');

const d = defaultConfig();
t('returns object', typeof d === 'object' && d !== null);
t('frozen (immutable default)', Object.isFrozen(d));
t('exposes enabled flag', 'enabled' in d);

const r = resolveConfig({});
t('resolveConfig({}) returns object', typeof r === 'object' && r !== null);
t('resolveConfig({}) has enabled', 'enabled' in r);

const runtime = emitBackendSpinEngineRuntime(d, {});
t('runtime emit returns string', typeof runtime === 'string');
t('runtime non-empty when enabled', d.enabled ? runtime.length > 0 : runtime.length >= 0);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
