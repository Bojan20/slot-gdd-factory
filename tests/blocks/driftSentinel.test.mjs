/**
 * tests/blocks/driftSentinel.test.mjs
 *
 * QA-3d · Boki 2026-06-27 — block test parity za driftSentinel.
 */
import {
  defaultConfig,
  resolveConfig,
  emitDriftSentinelCSS,
  emitDriftSentinelMarkup,
  emitDriftSentinelRuntime,
} from '../../src/blocks/driftSentinel.mjs';

let pass = 0, fail = 0;
function t(name, ok) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n=== driftSentinel block ===');

const d = defaultConfig();
t('returns object', typeof d === 'object' && d !== null);

const r = resolveConfig({});
t('resolveConfig({}) returns object', typeof r === 'object' && r !== null);

const css = emitDriftSentinelCSS(d);
t('CSS emit returns string', typeof css === 'string');

const markup = emitDriftSentinelMarkup(d);
t('markup emit returns string', typeof markup === 'string');

const runtime = emitDriftSentinelRuntime(d);
t('runtime emit returns string', typeof runtime === 'string');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
