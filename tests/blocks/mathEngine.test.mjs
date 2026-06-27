/**
 * tests/blocks/mathEngine.test.mjs
 *
 * QA-3d · Boki 2026-06-27 — block test parity za mathEngine.
 * Vežbamo exportovani API surface: WASM loader, kind getter, kernel helpers.
 */
import {
  getEngineKind,
  buyFeatureRtp,
  bothWaysRtp,
  payAnywhereExpectedPay,
  binomialPmfGe,
} from '../../src/blocks/mathEngine.mjs';

let pass = 0, fail = 0;
function t(name, ok) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n=== mathEngine block ===');

const kind = getEngineKind();
t('getEngineKind returns string', typeof kind === 'string');

/* buyFeatureRtp uses WASM if available, fallback to JS analytics. */
const rtp = await buyFeatureRtp(100, 50);
t('buyFeatureRtp returns number', typeof rtp === 'number');
t('buyFeatureRtp = bonusAvgPay/buyCost = 2', Math.abs(rtp - 2.0) < 1e-9);

const rtp2 = await buyFeatureRtp(0, 50);
t('buyFeatureRtp(0, X) = 0', rtp2 === 0);

const bw = await bothWaysRtp(96, 0.6);
t('bothWaysRtp returns number', typeof bw === 'number');
t('bothWaysRtp > base RTP', bw > 96);

const ep = await payAnywhereExpectedPay(15, 0.1, { 3: 1, 4: 5, 5: 25 });
t('payAnywhereExpectedPay returns finite number', Number.isFinite(ep));

const pmf = await binomialPmfGe(10, 0.5, 5);
t('binomialPmfGe in [0,1]', pmf >= 0 && pmf <= 1);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
