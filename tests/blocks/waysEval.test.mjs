/**
 * tests/blocks/waysEval.test.mjs — Wave M2
 */
import {
  defaultConfig, resolveConfig, emitWaysEvalRuntime,
} from '../../src/blocks/waysEval.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== waysEval block ===');
const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default waysCount=243', d.waysCount === 243);
t('default minRun=3', d.minRun === 3);
t('default direction=ltr', d.direction === 'ltr');

const r = resolveConfig({ features: [{ kind: 'ways' }] });
t('auto-enable from feature', r.enabled === true);

const r2 = resolveConfig({ topology: { evaluation: 'ways', ways_count: 1024 } });
t('auto-enable from ways topology', r2.enabled === true);
t('waysCount from topology=1024', r2.waysCount === 1024);

const r3 = resolveConfig({
  features: [{ kind: 'ways' }],
  waysEval: { waysCount: 117649, minRun: 4, direction: 'both', maxEvents: 16 },
});
t('override waysCount 117649-ways', r3.waysCount === 117649);
t('override minRun', r3.minRun === 4);
t('override direction=both', r3.direction === 'both');
t('override maxEvents', r3.maxEvents === 16);

t('runtime stub when disabled', emitWaysEvalRuntime(defaultConfig()).includes('disabled'));
const rt = emitWaysEvalRuntime(r);
t('runtime exposes detectWaysWins', rt.includes('window.detectWaysWins'));
t('runtime bakes WAYS_COUNT', rt.includes('WAYS_COUNT      = 243'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
