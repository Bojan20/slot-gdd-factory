#!/usr/bin/env node
/**
 * tests/blocks/grandInterruptionLock.test.mjs
 *
 * D-17.6 — GRAND interruption-lock + handpay route test.
 */

import {
  defaultConfig,
  resolveConfig,
  shouldLock,
  requiresHandpay,
  emitGrandInterruptionLockCSS,
  emitGrandInterruptionLockRuntime,
} from '../../src/blocks/grandInterruptionLock.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../src/blocks/grandInterruptionLock.mjs');

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('— grandInterruptionLock block —');

/* 1. defaults */
const dflt = defaultConfig();
t('default enabled=false', dflt.enabled === false);
t('default grandThresholdCredits=1000000', dflt.grandThresholdCredits === 1000000);
t('default celebrationDurationMs=6000', dflt.celebrationDurationMs === 6000);
t('default handpayJurisdictions=[US,CA]',
  JSON.stringify(dflt.handpayJurisdictions) === '["US","CA"]');
t('default jurisdiction=""', dflt.jurisdiction === '');
t('default interceptControls includes spin/autoplay/slam/quickspin/maxbet',
  dflt.interceptControls.indexOf('spin') >= 0 &&
  dflt.interceptControls.indexOf('autoplay') >= 0 &&
  dflt.interceptControls.indexOf('slam') >= 0 &&
  dflt.interceptControls.indexOf('quickspin') >= 0 &&
  dflt.interceptControls.indexOf('maxbet') >= 0);
t('default role=alert', dflt.role === 'alert');
t('default bannerLabel=GRAND', dflt.bannerLabel === 'GRAND');

/* 2. fresh arrays per call */
dflt.handpayJurisdictions.push('XX');
dflt.interceptControls.push('YY');
const dflt2 = defaultConfig();
t('defaults returns fresh handpayJurisdictions',
  JSON.stringify(dflt2.handpayJurisdictions) === '["US","CA"]');
t('defaults returns fresh interceptControls',
  dflt2.interceptControls.indexOf('YY') < 0);

/* 3. resolveConfig — enabled */
t('resolveConfig honors enabled=true',
  resolveConfig({ grandInterruptionLock: { enabled: true } }).enabled === true);

/* 4. resolveConfig — threshold bounds */
const th = resolveConfig({ grandInterruptionLock: { grandThresholdCredits: 500000 } });
t('resolveConfig honors threshold=500000', th.grandThresholdCredits === 500000);
const thOut = resolveConfig({ grandInterruptionLock: { grandThresholdCredits: 100 } });
t('resolveConfig rejects threshold=100 (below bounds)',
  thOut.grandThresholdCredits === 1000000);
const thHuge = resolveConfig({ grandInterruptionLock: { grandThresholdCredits: 1e20 } });
t('resolveConfig rejects threshold=1e20', thHuge.grandThresholdCredits === 1000000);

/* 5. resolveConfig — celebrationDurationMs bounds */
const dur = resolveConfig({ grandInterruptionLock: { celebrationDurationMs: 9000 } });
t('resolveConfig honors celebrationDurationMs=9000', dur.celebrationDurationMs === 9000);
const durLow = resolveConfig({ grandInterruptionLock: { celebrationDurationMs: 500 } });
t('resolveConfig rejects celebrationDurationMs=500',
  durLow.celebrationDurationMs === 6000);

/* 6. resolveConfig — handpayJurisdictions uppercase + dedupe */
const hj = resolveConfig({ grandInterruptionLock: {
  handpayJurisdictions: ['us', 'ca', 'US', 'CA', 'de'],
}});
t('resolveConfig dedupes + uppercases handpayJurisdictions',
  JSON.stringify(hj.handpayJurisdictions) === '["US","CA","DE"]');

/* 7. resolveConfig — interceptControls whitelist */
const ic = resolveConfig({ grandInterruptionLock: {
  interceptControls: ['spin', 'unknown', 'AUTOPLAY', 'foo'],
}});
t('resolveConfig drops unknown controls + lowercases',
  ic.interceptControls.indexOf('spin') >= 0 &&
  ic.interceptControls.indexOf('autoplay') >= 0 &&
  ic.interceptControls.indexOf('unknown') < 0);

/* 8. resolveConfig — jurisdiction uppercase + strip */
const jur = resolveConfig({ grandInterruptionLock: { jurisdiction: 'us' } });
t('resolveConfig uppercases jurisdiction', jur.jurisdiction === 'US');

/* 9. resolveConfig — themeClass + role + bannerLabel sanitize */
const safe = resolveConfig({ grandInterruptionLock: {
  themeClass: 'foundry_1', role: 'status', bannerLabel: 'JACKPOT WIN',
}});
t('resolveConfig honors safe themeClass', safe.themeClass === 'foundry_1');
t('resolveConfig honors safe role',       safe.role === 'status');
t('resolveConfig honors safe bannerLabel', safe.bannerLabel === 'JACKPOT WIN');

/* 10. shouldLock */
const enabledCfg = { ...defaultConfig(), enabled: true };
t('shouldLock true when amount >= threshold',
  shouldLock(1000000, enabledCfg) === true);
t('shouldLock true when amount > threshold',
  shouldLock(2000000, enabledCfg) === true);
t('shouldLock false when amount < threshold',
  shouldLock(999999, enabledCfg) === false);
t('shouldLock false when disabled',
  shouldLock(2000000, defaultConfig()) === false);
t('shouldLock false on non-number amount',
  shouldLock('huge', enabledCfg) === false);
t('shouldLock false on NaN',
  shouldLock(NaN, enabledCfg) === false);
t('shouldLock false on negative amount',
  shouldLock(-100, enabledCfg) === false);

/* 11. requiresHandpay */
t('requiresHandpay true for US (default list)',
  requiresHandpay('US', defaultConfig()) === true);
t('requiresHandpay true for "us" (case-insens)',
  requiresHandpay('us', defaultConfig()) === true);
t('requiresHandpay true for CA',
  requiresHandpay('CA', defaultConfig()) === true);
t('requiresHandpay false for DE',
  requiresHandpay('DE', defaultConfig()) === false);
t('requiresHandpay false on empty jurisdiction',
  requiresHandpay('', defaultConfig()) === false);
t('requiresHandpay false on non-string',
  requiresHandpay(42, defaultConfig()) === false);
t('requiresHandpay false when handpayJurisdictions empty',
  requiresHandpay('US', { ...defaultConfig(), handpayJurisdictions: [] }) === false);
t('requiresHandpay true for custom jurisdiction',
  requiresHandpay('DE', { ...defaultConfig(), handpayJurisdictions: ['DE'] }) === true);

/* 12. CSS emit — disabled */
t('emitCSS(disabled) → empty', emitGrandInterruptionLockCSS(defaultConfig()) === '');

/* 13. CSS emit — enabled */
const css = emitGrandInterruptionLockCSS({ ...defaultConfig(), enabled: true });
t('emitCSS includes .gil-overlay', css.includes('.gil-overlay'));
t('emitCSS includes .gil-banner',  css.includes('.gil-banner'));
t('emitCSS includes [data-grand-lock] selector',
  css.includes('[data-grand-lock'));
t('emitCSS includes prefers-reduced-motion guard',
  css.includes('prefers-reduced-motion'));

/* 14. Runtime — disabled */
t('emitRuntime(disabled) → empty',
  emitGrandInterruptionLockRuntime(defaultConfig()) === '');

/* 15. Runtime — enabled wires HookBus */
const rt = emitGrandInterruptionLockRuntime({ ...defaultConfig(), enabled: true });
t('runtime non-empty', rt.length > 500);
t('runtime registers onPotSymbolCollected listener',
  rt.includes("HookBus.on('onPotSymbolCollected'"));
t('runtime registers onHoldAndWinEnd listener',
  rt.includes("HookBus.on('onHoldAndWinEnd'"));
t('runtime registers onFeaturePayout listener (generic)',
  rt.includes("HookBus.on('onFeaturePayout'"));
t('runtime emits onGrandLock',
  rt.includes("HookBus.emit('onGrandLock'"));
t('runtime emits onGrandReleased',
  rt.includes("HookBus.emit('onGrandReleased'"));
t('runtime emits onHandpayRequested',
  rt.includes("HookBus.emit('onHandpayRequested'"));
t('runtime exposes window.grandInterruptionLockForce',
  rt.includes('window.grandInterruptionLockForce'));
t('runtime exposes window.grandInterruptionLockIsActive',
  rt.includes('window.grandInterruptionLockIsActive'));
t('runtime sets __FORCE_GRAND_AWARD__ flag',
  rt.includes('window.__FORCE_GRAND_AWARD__'));
t('runtime sets __SLOT_GRAND_LOCK_ACTIVE__ flag',
  rt.includes('__SLOT_GRAND_LOCK_ACTIVE__'));
t('runtime routes force chip through runOneBaseSpin',
  rt.includes('window.runOneBaseSpin()'));
t('runtime tags body[data-grand-lock]',
  rt.includes("setAttribute('data-grand-lock'"));
t('runtime carries role="alert" + aria-live="assertive" a11y',
  rt.includes('role="alert"') && rt.includes('aria-live="assertive"'));

/* 16. Source — vendor-neutral */
const src = readFileSync(SRC, 'utf-8');
const banned = ['cash eruption','wrath of olympus','huff','starlight'];
const lower = src.toLowerCase();
for (const b of banned) {
  t('source vendor-neutral (no "' + b + '")', !lower.includes(b));
}

/* 17. determinism */
const a1 = emitGrandInterruptionLockCSS({ ...defaultConfig(), enabled: true });
const a2 = emitGrandInterruptionLockCSS({ ...defaultConfig(), enabled: true });
t('determinism: same config → byte-identical CSS', a1 === a2);
const r1 = emitGrandInterruptionLockRuntime({ ...defaultConfig(), enabled: true });
const r2 = emitGrandInterruptionLockRuntime({ ...defaultConfig(), enabled: true });
t('determinism: same config → byte-identical runtime', r1 === r2);

console.log('');
console.log('  ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
