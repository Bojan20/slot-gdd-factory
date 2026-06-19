/**
 * tests/blocks/coinCollect.test.mjs
 * Wave LEGO-COLLECT (B-4 · 1/3)
 */
import {
  defaultConfig, resolveConfig,
  emitCoinCollectCSS, emitCoinCollectMarkup, emitCoinCollectRuntime,
} from '../../src/blocks/coinCollect.mjs';

let pass = 0, fail = 0;
function t(name, ok) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else    { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n=== coinCollect block (LEGO-COLLECT B-4 · 1/3) ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default coinSymbolId COIN', d.coinSymbolId === 'COIN');
t('default coinValue 1', d.defaultCoinValue === 1);
t('default pauseDuringFs false', d.pauseDuringFs === false);
t('default resetOnFsEnd false', d.resetOnFsEnd === false);

const r1 = resolveConfig({ features: [{ kind: 'coin_collect' }] });
t('auto-enable coin_collect', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'token_collect' }] });
t('auto-enable token_collect alias', r1b.enabled === true);

const r2 = resolveConfig({
  coinCollect: { enabled: true, coinSymbolId: 'GOLD_ORB', defaultCoinValue: 5, pauseDuringFs: true, resetOnFsEnd: true },
});
t('explicit enable honored', r2.enabled === true);
t('override coinSymbolId', r2.coinSymbolId === 'GOLD_ORB');
t('override defaultCoinValue', r2.defaultCoinValue === 5);
t('override pauseDuringFs', r2.pauseDuringFs === true);
t('override resetOnFsEnd', r2.resetOnFsEnd === true);

const rBad = resolveConfig({ coinCollect: { enabled: true, coinSymbolId: 'lower_case_invalid', defaultCoinValue: 99999999 } });
t('reject invalid coinSymbolId pattern', rBad.coinSymbolId === 'COIN');
t('clamp defaultCoinValue ≤ 1M', rBad.defaultCoinValue === 1000000);

const cssOff = emitCoinCollectCSS(defaultConfig());
t('CSS empty when disabled', cssOff === '');
const css = emitCoinCollectCSS(r1);
t('CSS has .cell.is-coin', css.includes('.cell.is-coin'));
t('CSS has data-coin-value selector', css.includes('[data-coin-value]'));
t('CSS has live region sr-only', css.includes('.coin-collect-live'));

const markupOff = emitCoinCollectMarkup(defaultConfig());
t('markup empty when disabled', markupOff === '');
const markup = emitCoinCollectMarkup(r1);
t('markup has live region', markup.includes('id="coinCollectLive"'));
t('markup has role=status', markup.includes('role="status"'));
t('markup has aria-live=polite', markup.includes('aria-live="polite"'));

const rtOff = emitCoinCollectRuntime(defaultConfig());
t('runtime stub disabled', rtOff.includes('disabled'));
const rt = emitCoinCollectRuntime(r1);
t('runtime declares CC_COIN_SYMBOL', rt.includes('CC_COIN_SYMBOL'));
t('runtime declares CC_DEFAULT_VALUE', rt.includes('CC_DEFAULT_VALUE'));
t('runtime declares CC_PAUSE_FS', rt.includes('CC_PAUSE_FS'));
t('runtime declares CC_RESET_FS_END', rt.includes('CC_RESET_FS_END'));
t('runtime exposes __COIN_COLLECT__', rt.includes('__COIN_COLLECT__'));
t('runtime has scanGrid function', rt.includes('function scanGrid'));
t('runtime has tally function', rt.includes('function tally'));
t('runtime emits onCoinCollected', rt.includes('onCoinCollected'));
t('runtime listens onSpinResult', rt.includes("HookBus.on('onSpinResult'"));
t('runtime listens onFsTrigger', rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd', rt.includes("HookBus.on('onFsEnd'"));
t('runtime announces via live region', rt.includes('live.textContent'));

console.log(`\nResult: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
