#!/usr/bin/env node
/**
 * tests/blocks/_eventCanonicalization.test.mjs
 *
 * Wave W57.A7 — Colon/dot event name canonicalization.
 *
 * Canonical event names follow on<PascalCase>; colon/dot legacy shapes
 * (`anteBet:changed`, `bonus.buy.requested`) are blocked for NEW events
 * via lego-gate.mjs §7. Pre-W57 survivors are explicitly whitelisted
 * (see COLON_DOT_LEGACY_WHITELIST in tools/lego-gate.mjs) and pinned
 * here so a future broad rename can shrink the whitelist atomically.
 *
 * Pattern source: slot-sage-v2 W57 audit (LEGO invariant scope).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

const here = dirname(fileURLToPath(import.meta.url));
const anteSrc     = readFileSync(resolve(here, '../../src/blocks/anteBet.mjs'), 'utf8');
const bonusBuySrc = readFileSync(resolve(here, '../../src/blocks/bonusBuy.mjs'), 'utf8');
const legoSrc     = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

/* ════════════════════════════════════════════════════════════════════
 * 1. anteBet.mjs rename: 'anteBet:changed' → 'onAnteBetChanged'
 * ════════════════════════════════════════════════════════════════════ */
block('1. anteBet.mjs canonical event rename', () => {
  t('1.1 W57.A7 marker comment present in anteBet.mjs',
    /W57\.A7/.test(anteSrc));
  t('1.2 Canonical onAnteBetChanged emit present',
    /HookBus\.emit\(\s*['"]onAnteBetChanged['"]/.test(anteSrc));
  t('1.3 Legacy anteBet:changed emit REMOVED',
    !/HookBus\.emit\(\s*['"]anteBet:changed['"]/.test(anteSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. bonusBuy.mjs rename: 'bonus.buy.requested' → 'onBonusBuyRequested'
 * ════════════════════════════════════════════════════════════════════ */
block('2. bonusBuy.mjs canonical event rename', () => {
  t('2.1 W57.A7 marker comment present in bonusBuy.mjs',
    /W57\.A7/.test(bonusBuySrc));
  t('2.2 Canonical onBonusBuyRequested emit present',
    /HookBus\.emit\(\s*['"]onBonusBuyRequested['"]/.test(bonusBuySrc));
  t('2.3 Legacy bonus.buy.requested emit REMOVED',
    !/HookBus\.emit\(\s*['"]bonus\.buy\.requested['"]/.test(bonusBuySrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 3. lego-gate.mjs §7 — colon/dot canonicalization gate
 * ════════════════════════════════════════════════════════════════════ */
block('3. LEGO §7 colon/dot canonicalization gate', () => {
  t('3.1 checkColonDotEventNames function exported',
    /async function checkColonDotEventNames/.test(legoSrc));
  t('3.2 Function wired into the checks array',
    /await checkColonDotEventNames\(\)/.test(legoSrc));
  t('3.3 EVENT_NAME_RE captures colon/dot events',
    /HookBus\\\.\(\?:emit\|on\)\\\([\s\S]{0,20}[:.]/m.test(legoSrc) ||
    /HookBus\\.\(\?:emit\|on\)\\.*[:.]/m.test(legoSrc) ||
    /\[\:.\]/.test(legoSrc));
  t('3.4 Whitelist Set declared',
    /COLON_DOT_LEGACY_WHITELIST\s*=\s*new\s+Set\(/.test(legoSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 4. Whitelist shape pinning — explicit list locks the legacy set
 * ════════════════════════════════════════════════════════════════════ */
block('4. Legacy whitelist shape pin (shrinks-only policy)', () => {
  const expectedLegacy = [
    'expandingWild:applied',
    'expandingWild:cleared',
    'reels:stopped',
    'clusterPays:evaluated',
    'wheelBonus.open',
    'wheelBonus.close',
    'wheelBonus.request',
    'wheelBonus.spin',
    'wheelBonus.complete',
    'wheelBonus.result',
    'feature:bonusPick:trigger',
  ];
  for (const name of expectedLegacy) {
    /* Each legacy event must appear inside the whitelist set declaration. */
    const re = new RegExp(`COLON_DOT_LEGACY_WHITELIST[\\s\\S]{0,2000}['"]${name.replace(/[.:]/g, '\\$&')}['"]`);
    t(`4.${name} whitelisted in lego-gate.mjs`, re.test(legoSrc));
  }
});

/* ════════════════════════════════════════════════════════════════════
 * 5. EXPECTED_EMIT_OWNERS catches up — new canonical events declared
 * ════════════════════════════════════════════════════════════════════ */
block('5. Canonical events have single-owner declarations', () => {
  t('5.1 onAnteBetChanged owner: anteBet.mjs',
    /onAnteBetChanged:\s*\[\s*['"]anteBet\.mjs['"]/.test(legoSrc));
  t('5.2 onBonusBuyRequested owner: bonusBuy.mjs',
    /onBonusBuyRequested:\s*\[\s*['"]bonusBuy\.mjs['"]/.test(legoSrc));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
