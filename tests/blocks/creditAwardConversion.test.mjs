#!/usr/bin/env node
/**
 * tests/blocks/creditAwardConversion.test.mjs
 *
 * D-17.8 — Credit award SSOT conversion test.
 */

import {
  defaultConfig,
  resolveConfig,
  deriveCoinValue,
  convertCredits,
  emitCreditAwardConversionCSS,
  emitCreditAwardConversionRuntime,
} from '../../src/blocks/creditAwardConversion.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../src/blocks/creditAwardConversion.mjs');

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('— creditAwardConversion block —');

/* 1. defaults */
const dflt = defaultConfig();
t('default enabled=false', dflt.enabled === false);
t('default fixedCoinCount=20', dflt.fixedCoinCount === 20);
t('default defaultBet=1.0', dflt.defaultBet === 1.0);
t('default emitOnBoot=true', dflt.emitOnBoot === true);
t('default bodyAttrName="data-award-unit"', dflt.bodyAttrName === 'data-award-unit');
t('default bodyAttrValue=credits', dflt.bodyAttrValue === 'credits');

/* 2. default payTypeModes */
t('default payTypeModes.line=xCoin', dflt.payTypeModes.line === 'xCoin');
t('default payTypeModes.scatter=xTotalBet', dflt.payTypeModes.scatter === 'xTotalBet');
t('default payTypeModes.pattern=xTotalBet', dflt.payTypeModes.pattern === 'xTotalBet');
t('default payTypeModes.pot=credits', dflt.payTypeModes.pot === 'credits');
t('default payTypeModes.holdAndWin=credits', dflt.payTypeModes.holdAndWin === 'credits');
t('default payTypeModes.wheel=xTotalBet', dflt.payTypeModes.wheel === 'xTotalBet');

/* 3. fresh payTypeModes per call */
dflt.payTypeModes.line = 'BOGUS';
const dflt2 = defaultConfig();
t('defaults returns fresh payTypeModes object',
  dflt2.payTypeModes.line === 'xCoin');

/* 4. resolveConfig — enabled */
t('resolveConfig honors enabled=true',
  resolveConfig({ creditAwardConversion: { enabled: true } }).enabled === true);

/* 5. resolveConfig — fixedCoinCount bounds */
const fc = resolveConfig({ creditAwardConversion: { fixedCoinCount: 25 } });
t('resolveConfig honors fixedCoinCount=25', fc.fixedCoinCount === 25);
const fcOut = resolveConfig({ creditAwardConversion: { fixedCoinCount: 9999 } });
t('resolveConfig rejects fixedCoinCount=9999 (above bounds)',
  fcOut.fixedCoinCount === 20);
const fcZero = resolveConfig({ creditAwardConversion: { fixedCoinCount: 0 } });
t('resolveConfig rejects fixedCoinCount=0', fcZero.fixedCoinCount === 20);

/* 6. resolveConfig — defaultBet */
t('resolveConfig honors defaultBet=2.5',
  resolveConfig({ creditAwardConversion: { defaultBet: 2.5 } }).defaultBet === 2.5);
t('resolveConfig rejects defaultBet=0',
  resolveConfig({ creditAwardConversion: { defaultBet: 0 } }).defaultBet === 1.0);
t('resolveConfig rejects negative defaultBet',
  resolveConfig({ creditAwardConversion: { defaultBet: -1 } }).defaultBet === 1.0);

/* 7. resolveConfig — partial payTypeModes override */
const partial = resolveConfig({ creditAwardConversion: {
  payTypeModes: { line: 'credits' },
}});
t('resolveConfig overrides line mode', partial.payTypeModes.line === 'credits');
t('resolveConfig preserves unchanged modes',
  partial.payTypeModes.pot === 'credits' &&
  partial.payTypeModes.scatter === 'xTotalBet');

/* 8. resolveConfig — invalid mode rejected */
const invMode = resolveConfig({ creditAwardConversion: {
  payTypeModes: { line: 'magic' },
}});
t('resolveConfig rejects unknown mode (fallback to defaults)',
  invMode.payTypeModes.line === 'xCoin');

/* 9. resolveConfig — emitOnBoot toggle */
t('resolveConfig honors emitOnBoot=false',
  resolveConfig({ creditAwardConversion: { emitOnBoot: false } }).emitOnBoot === false);

/* 10. resolveConfig — bodyAttr safe-chars */
const safeAttr = resolveConfig({ creditAwardConversion: {
  bodyAttrName: 'data-foundry-unit', bodyAttrValue: 'money',
}});
t('resolveConfig honors safe bodyAttrName', safeAttr.bodyAttrName === 'data-foundry-unit');
t('resolveConfig honors safe bodyAttrValue', safeAttr.bodyAttrValue === 'money');

/* 11. deriveCoinValue — canonical Foundry math */
t('deriveCoinValue 1.0 / 20 = 0.05',
  Math.abs(deriveCoinValue(1.0, defaultConfig()) - 0.05) < 1e-9);
t('deriveCoinValue 10.0 / 20 = 0.5',
  Math.abs(deriveCoinValue(10.0, defaultConfig()) - 0.5) < 1e-9);
t('deriveCoinValue 40.0 / 20 = 2.0',
  Math.abs(deriveCoinValue(40.0, defaultConfig()) - 2.0) < 1e-9);

/* 12. deriveCoinValue — invalid inputs → 0 */
t('deriveCoinValue 0 → 0',     deriveCoinValue(0, defaultConfig()) === 0);
t('deriveCoinValue -1 → 0',    deriveCoinValue(-1, defaultConfig()) === 0);
t('deriveCoinValue NaN → 0',   deriveCoinValue(NaN, defaultConfig()) === 0);
t('deriveCoinValue "abc" → 0', deriveCoinValue('abc', defaultConfig()) === 0);

/* 13. convertCredits — line (xCoin) */
const c = { ...defaultConfig(), enabled: true };
const ctx = { totalBet: 1.0 };
t('convertCredits line 250 credits at bet 1.0 = 250 * 0.05 = 12.5',
  Math.abs(convertCredits(250, 'line', ctx, c) - 12.5) < 1e-9);

/* 14. convertCredits — scatter/pattern (xTotalBet) */
t('convertCredits scatter 100 (= 100x total bet) at bet 1.0 = 100',
  Math.abs(convertCredits(100, 'scatter', ctx, c) - 100) < 1e-9);
t('convertCredits pattern 1000 (= 1000x total bet) at bet 1.0 = 1000',
  Math.abs(convertCredits(1000, 'pattern', ctx, c) - 1000) < 1e-9);

/* 15. convertCredits — pot/holdAndWin (credits via coin_value) */
t('convertCredits pot 100 credits at bet 1.0 = 5.0',
  Math.abs(convertCredits(100, 'pot', ctx, c) - 5.0) < 1e-9);
t('convertCredits holdAndWin 1000000 at bet 1.0 = 50000',
  Math.abs(convertCredits(1000000, 'holdAndWin', ctx, c) - 50000) < 1e-9);

/* 16. convertCredits — bet scaling preserves multiple invariant */
const ctxMax = { totalBet: 40.0 };
t('convertCredits holdAndWin 1M at bet 40 = 2M (constant 50000x bet)',
  Math.abs(convertCredits(1000000, 'holdAndWin', ctxMax, c) - 2000000) < 1e-9);
const grandMin = convertCredits(1000000, 'holdAndWin', { totalBet: 0.20 }, c);
t('convertCredits holdAndWin 1M at bet 0.20 = 10000 money (= 50000x bet)',
  Math.abs(grandMin - 10000) < 1e-9);

/* 17. convertCredits — invalid inputs → 0 */
t('convertCredits negative credits → 0',
  convertCredits(-100, 'pot', ctx, c) === 0);
t('convertCredits NaN credits → 0',
  convertCredits(NaN, 'pot', ctx, c) === 0);
t('convertCredits unknown payType → 0',
  convertCredits(100, 'unknown', ctx, c) === 0);
t('convertCredits non-string payType → 0',
  convertCredits(100, 42, ctx, c) === 0);

/* 18. convertCredits — context falls back to cfg.defaultBet */
t('convertCredits with no ctx falls back to defaultBet',
  Math.abs(convertCredits(100, 'pot', null, c) - 5.0) < 1e-9);

/* 19. CSS emit */
t('emitCSS(disabled) → empty', emitCreditAwardConversionCSS(defaultConfig()) === '');
const css = emitCreditAwardConversionCSS({ ...defaultConfig(), enabled: true });
t('emitCSS includes [data-award-unit] selector', css.includes('[data-award-unit]'));
t('emitCSS includes prefers-reduced-motion guard', css.includes('prefers-reduced-motion'));

/* 20. Runtime */
t('emitRuntime(disabled) → empty', emitCreditAwardConversionRuntime(defaultConfig()) === '');
const rt = emitCreditAwardConversionRuntime({ ...defaultConfig(), enabled: true });
t('runtime non-empty', rt.length > 500);
t('runtime registers onBetChanged listener',
  rt.includes("HookBus.on('onBetChanged'"));
t('runtime emits onAwardConverted',
  rt.includes("HookBus.emit('onAwardConverted'"));
t('runtime emits onCoinValueChanged',
  rt.includes("HookBus.emit('onCoinValueChanged'"));
t('runtime exposes window.creditAwardConvert',
  rt.includes('window.creditAwardConvert'));
t('runtime exposes window.creditAwardCoinValue',
  rt.includes('window.creditAwardCoinValue'));
t('runtime exposes window.creditAwardSetBet',
  rt.includes('window.creditAwardSetBet'));
t('runtime exposes window.creditAwardPayTypeMode',
  rt.includes('window.creditAwardPayTypeMode'));
t('runtime sets body data-award-unit on boot',
  rt.includes("setAttribute(CFG.bodyAttrName"));
t('runtime DOMContentLoaded fallback present',
  rt.includes('DOMContentLoaded'));

/* 21. Source — vendor-neutral */
const src = readFileSync(SRC, 'utf-8');
const banned = ['cash eruption','wrath of olympus','huff','starlight'];
const lower = src.toLowerCase();
for (const b of banned) {
  t('source vendor-neutral (no "' + b + '")', !lower.includes(b));
}

/* 22. determinism */
const a1 = emitCreditAwardConversionCSS({ ...defaultConfig(), enabled: true });
const a2 = emitCreditAwardConversionCSS({ ...defaultConfig(), enabled: true });
t('determinism: same config → byte-identical CSS', a1 === a2);
const r1 = emitCreditAwardConversionRuntime({ ...defaultConfig(), enabled: true });
const r2 = emitCreditAwardConversionRuntime({ ...defaultConfig(), enabled: true });
t('determinism: same config → byte-identical runtime', r1 === r2);

console.log('');
console.log('  ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
