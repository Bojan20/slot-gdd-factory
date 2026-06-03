/**
 * tests/blocks/payAnywhereEval.test.mjs
 * Wave K1 — pure Node tests for payAnywhereEval block.
 */
import {
  defaultConfig,
  resolveConfig,
  emitPayAnywhereEvalRuntime,
} from '../../src/blocks/payAnywhereEval.mjs';

let pass = 0, fail = 0;
function t(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('\n=== payAnywhereEval block ===');

/* defaults */
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default minWin=8', d.minWin === 8);
t('default bucketEdges=[10,12]', JSON.stringify(d.bucketEdges) === '[10,12]');
t('default maxEvents=9', d.maxEvents === 9);

/* auto-enable from topology */
const r1 = resolveConfig({ topology: { evaluation: 'pay_anywhere' } });
t('auto-enable when topology=pay_anywhere', r1.enabled === true);

const r2 = resolveConfig({ topology: { evaluation: 'lines' } });
t('stays disabled for lines evaluation', r2.enabled === false);

/* override */
const r3 = resolveConfig({
  topology: { evaluation: 'pay_anywhere' },
  payAnywhereEval: {
    minWin: 6,
    bucketEdges: [8, 11, 14],
    paytable: { Z: [5, 10, 25, 100] },
    maxEvents: 12,
  },
});
t('override minWin', r3.minWin === 6);
t('override bucketEdges sorted', JSON.stringify(r3.bucketEdges) === '[8,11,14]');
t('override paytable', r3.paytable.Z[3] === 100);
t('override maxEvents', r3.maxEvents === 12);

/* clamps */
const r4 = resolveConfig({
  topology: { evaluation: 'pay_anywhere' },
  payAnywhereEval: { minWin: 999, maxEvents: -5 },
});
t('clamp minWin <=30', r4.minWin === 30);
t('clamp maxEvents >=1', r4.maxEvents === 1);

/* emit stub when disabled */
const stub = emitPayAnywhereEvalRuntime(defaultConfig());
t('stub emits no-op function', stub.includes('function detectPayAnywhereWins()') && stub.includes('return []'));

/* emit runtime when enabled — literal bake */
const enabled = resolveConfig({
  topology: { evaluation: 'pay_anywhere' },
  payAnywhereEval: {
    minWin: 8,
    bucketEdges: [10, 12],
    paytable: { Z: [10, 25, 50] },
    maxEvents: 9,
  },
});
const rt = emitPayAnywhereEvalRuntime(enabled);
t('runtime bakes MIN_WIN literal', rt.includes('PAY_ANYWHERE_MIN_WIN = 8'));
t('runtime bakes bucketEdges literal', rt.includes('PAY_ANYWHERE_BUCKETS = [10,12]'));
t('runtime bakes paytable literal', rt.includes('"Z":[10,25,50]'));
t('runtime declares detectPayAnywhereWins', rt.includes('function detectPayAnywhereWins'));
t('runtime exposes on window', rt.includes('window.detectPayAnywhereWins'));

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
