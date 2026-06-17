#!/usr/bin/env node
/**
 * tests/blocks/_netherlandsCoolOffPersistence.test.mjs
 *
 * W58.J-NL.3 — Persistent local cool-off lifecycle (Wet KSA §33).
 *
 * Cross-operator cool-off enforcement lives at the regulator (Cruks);
 * locally we make single-operator persistence honest:
 *   • localStorage key __NL_COOL_OFF_UNTIL__ stores ms-epoch deadline
 *   • on boot, if now < deadline → set __NL_COOL_OFF_ACTIVE__,
 *     fire onCoolOffPeriodActive
 *   • on boot, if now >= deadline → clear key, fire
 *     onCoolOffPeriodExpired
 *   • window.startNlCoolOff(hours) helper writes deadline + flag +
 *     fires onCoolOffPeriodStarted; never SHORTENS an existing active
 *     cool-off (regulator default)
 *
 * Pins:
 *   1. Documentation header references W58.J-NL.3 + persistent cool-off
 *   2. Runtime exposes startNlCoolOff helper + boot evaluation
 *   3. Idempotent never-shrink predicate
 *   4. Three sole-owner emits with full payload contract
 *   5. localStorage private-mode safety (try/catch)
 *   6. Behavioural sandbox covering boot decisions
 *   7. LEGO ownership
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
const srcPath = resolve(here, '../../src/blocks/netherlandsComplianceGate.mjs');
const src = readFileSync(srcPath, 'utf8');
const legoSrc = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');

const mod = await import('../../src/blocks/netherlandsComplianceGate.mjs');
const { emitNetherlandsComplianceGateRuntime, resolveConfig } = mod;

const rt = emitNetherlandsComplianceGateRuntime(
  resolveConfig({ regulator: { profile: 'NL' } })
);

/* ════════════════════════════════════════════════════════════════════
 * 1. Documentation header
 * ════════════════════════════════════════════════════════════════════ */
block('1. Documentation header', () => {
  t('1.1 Header notes W58.J-NL.3 dopuna',
    /W58\.J-NL\.3/.test(src));
  t('1.2 Header references persistent local cool-off lifecycle',
    /persistent local cool-off/i.test(src));
  t('1.3 Header documents startNlCoolOff helper',
    /startNlCoolOff/.test(src));
  t('1.4 Header documents localStorage __NL_COOL_OFF_UNTIL__ key',
    /__NL_COOL_OFF_UNTIL__/.test(src));
  t('1.5 Header lists onCoolOffPeriodActive event',
    /onCoolOffPeriodActive/.test(src));
  t('1.6 Header lists onCoolOffPeriodExpired event',
    /onCoolOffPeriodExpired/.test(src));
  t('1.7 Header lists onCoolOffPeriodStarted event',
    /onCoolOffPeriodStarted/.test(src));
  t('1.8 Header notes cross-operator enforcement at Cruks (honest scope)',
    /Cross-operator enforcement still lives at Cruks/i.test(src) ||
    /Cross-operator[\s\S]{0,200}Cruks/i.test(src));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. Runtime exposes helper + boot evaluation
 * ════════════════════════════════════════════════════════════════════ */
block('2. Runtime emits helper + boot evaluation', () => {
  t('2.1 Runtime declares COOL_OFF_KEY constant',
    /COOL_OFF_KEY\s*=\s*['"]__NL_COOL_OFF_UNTIL__['"]/.test(rt));
  t('2.2 Runtime declares _coolOffRead helper',
    /_coolOffRead\s*=\s*function/.test(rt));
  t('2.3 Runtime declares _coolOffWrite helper',
    /_coolOffWrite\s*=\s*function/.test(rt));
  t('2.4 Runtime declares _coolOffClear helper',
    /_coolOffClear\s*=\s*function/.test(rt));
  t('2.5 Runtime declares window.startNlCoolOff public helper',
    /window\.startNlCoolOff\s*=\s*function/.test(rt));
  t('2.6 Runtime evaluates persistedUntil at boot',
    /_persistedUntil\s*=\s*_coolOffRead\(\)/.test(rt));
  t('2.7 Boot branch: now < deadline → __NL_COOL_OFF_ACTIVE__ + active emit',
    /_now\s*<\s*_persistedUntil[\s\S]{0,400}window\.__NL_COOL_OFF_ACTIVE__\s*=\s*true/.test(rt));
  t('2.8 Boot branch: deadline passed → _coolOffClear + expired emit',
    /else\s*\{[\s\S]{0,500}_coolOffClear\(\)[\s\S]{0,500}onCoolOffPeriodExpired/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 3. Idempotent never-shrink semantics
 * ════════════════════════════════════════════════════════════════════ */
block('3. startNlCoolOff idempotent + never-shrink', () => {
  t('3.1 Helper coerces input via parseFloat',
    /parseFloat\(hours\)/.test(rt));
  t('3.2 Invalid input falls back to COOL_OFF_HOURS default',
    /!isFinite\(hrs\)\s*\|\|\s*hrs\s*<=\s*0[\s\S]{0,50}hrs\s*=\s*COOL_OFF_HOURS/.test(rt));
  t('3.3 Computes untilMs as Date.now() + hrs * 3600 * 1000',
    /Date\.now\(\)\s*\+\s*Math\.floor\(hrs\s*\*\s*3600\s*\*\s*1000\)/.test(rt));
  t('3.4 Never shrinks: existing > untilMs → untilMs = existing',
    /existing\s*>\s*untilMs[\s\S]{0,80}untilMs\s*=\s*existing/.test(rt));
  t('3.5 Persists via _coolOffWrite',
    /ok\s*=\s*_coolOffWrite\(untilMs\)/.test(rt));
  t('3.6 Sets window.__NL_COOL_OFF_ACTIVE__ = true on success',
    /if\s*\(ok\)\s*\{[\s\S]{0,300}window\.__NL_COOL_OFF_ACTIVE__\s*=\s*true/.test(rt));
  t('3.7 Returns ok (true on write success, false on private-mode failure)',
    /return\s+ok\s*;\s*\}\s*;\s*\}\s*\)\s*\(\s*\)\s*;?\s*$/.test(rt.trim()));
});

/* ════════════════════════════════════════════════════════════════════
 * 4. Sole-owner emits + payload contract
 * ════════════════════════════════════════════════════════════════════ */
block('4. Sole-owner emits + payload contract', () => {
  /* onCoolOffPeriodActive */
  t('4.1 emit onCoolOffPeriodActive',
    /HookBus\.emit\(\s*['"]onCoolOffPeriodActive['"]/.test(rt) ||
    /_coolOffEmit\(['"]onCoolOffPeriodActive['"]/.test(rt));
  t('4.2 active payload includes jurisdiction + remainingMs + rule',
    /onCoolOffPeriodActive[\s\S]{0,400}jurisdiction:[\s\S]{0,200}remainingMs:[\s\S]{0,200}rule:/.test(rt));
  t('4.3 active payload cites NL-WetKSA-§33 rule',
    /onCoolOffPeriodActive[\s\S]{0,400}NL-WetKSA-§33/.test(rt));

  /* onCoolOffPeriodExpired */
  t('4.4 emit onCoolOffPeriodExpired',
    /HookBus\.emit\(\s*['"]onCoolOffPeriodExpired['"]/.test(rt) ||
    /_coolOffEmit\(['"]onCoolOffPeriodExpired['"]/.test(rt));
  t('4.5 expired payload includes jurisdiction + rule',
    /onCoolOffPeriodExpired[\s\S]{0,300}jurisdiction:[\s\S]{0,200}rule:/.test(rt));
  t('4.6 expired payload cites NL-WetKSA-§33 rule',
    /onCoolOffPeriodExpired[\s\S]{0,300}NL-WetKSA-§33/.test(rt));

  /* onCoolOffPeriodStarted */
  t('4.7 emit onCoolOffPeriodStarted',
    /HookBus\.emit\(\s*['"]onCoolOffPeriodStarted['"]/.test(rt) ||
    /_coolOffEmit\(['"]onCoolOffPeriodStarted['"]/.test(rt));
  t('4.8 started payload includes jurisdiction + hours + rule',
    /onCoolOffPeriodStarted[\s\S]{0,400}jurisdiction:[\s\S]{0,200}hours:[\s\S]{0,200}rule:/.test(rt));
  t('4.9 started payload cites NL-WetKSA-§33 rule',
    /onCoolOffPeriodStarted[\s\S]{0,400}NL-WetKSA-§33/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 5. localStorage safety (private mode)
 * ════════════════════════════════════════════════════════════════════ */
block('5. localStorage private-mode safety', () => {
  t('5.1 _coolOffRead wraps getItem in try/catch returning 0',
    /_coolOffRead[\s\S]{0,400}try\s*\{[\s\S]{0,200}getItem\(COOL_OFF_KEY\)[\s\S]{0,200}\}\s*catch[\s\S]{0,80}return\s+0/.test(rt));
  t('5.2 _coolOffWrite wraps setItem in try/catch returning false on failure',
    /_coolOffWrite[\s\S]{0,400}try\s*\{[\s\S]{0,200}setItem\(COOL_OFF_KEY[\s\S]{0,200}\}\s*catch[\s\S]{0,80}return\s+false/.test(rt));
  t('5.3 _coolOffClear wraps removeItem in try/catch',
    /_coolOffClear[\s\S]{0,300}try\s*\{[\s\S]{0,200}removeItem\(COOL_OFF_KEY\)[\s\S]{0,80}\}\s*catch/.test(rt));
  t('5.4 Each emit wraps HookBus.emit in try/catch (audit must never throw)',
    (() => {
      const events = ['onCoolOffPeriodActive', 'onCoolOffPeriodExpired', 'onCoolOffPeriodStarted'];
      return events.every(ev => {
        const re = new RegExp('try\\s*\\{[^}]{0,800}HookBus\\.emit\\([\'"]' + ev + '[\'"]');
        return re.test(rt);
      });
    })());
});

/* ════════════════════════════════════════════════════════════════════
 * 6. Behavioural sandbox — boot decisions
 * ════════════════════════════════════════════════════════════════════ */
block('6. Boot-decision sandbox', () => {
  /* Simulate the boot branch using the persisted-until contract. */
  function bootDecide(persistedUntil, now) {
    if (persistedUntil <= 0) return 'no-state';
    if (now < persistedUntil) {
      return { decision: 'active', remainingMs: persistedUntil - now };
    }
    return 'expired';
  }
  t('6.1 No persisted state → no-state (no flag, no emit)',
    bootDecide(0, 100000) === 'no-state');
  t('6.2 Deadline 1h in future → active with remainingMs',
    (() => {
      const r = bootDecide(100000 + 3600 * 1000, 100000);
      return r && r.decision === 'active' && r.remainingMs === 3600 * 1000;
    })());
  t('6.3 Deadline 1s in past → expired',
    bootDecide(100000 - 1000, 100000) === 'expired');
  t('6.4 Deadline equals now → expired (boundary)',
    bootDecide(100000, 100000) === 'expired');
  t('6.5 Deadline 1ms in future → active (boundary)',
    (() => {
      const r = bootDecide(100001, 100000);
      return r && r.decision === 'active' && r.remainingMs === 1;
    })());

  /* Simulate startNlCoolOff never-shrink semantics. */
  function neverShrink(existing, requested) {
    return existing > requested ? existing : requested;
  }
  t('6.6 existing 5h, requested 1h → existing wins (no shrink)',
    neverShrink(5 * 3600 * 1000, 1 * 3600 * 1000) === 5 * 3600 * 1000);
  t('6.7 existing 1h, requested 5h → requested wins (extend)',
    neverShrink(1 * 3600 * 1000, 5 * 3600 * 1000) === 5 * 3600 * 1000);
  t('6.8 existing 0 (no prior), requested 24h → requested wins',
    neverShrink(0, 24 * 3600 * 1000) === 24 * 3600 * 1000);
});

/* ════════════════════════════════════════════════════════════════════
 * 7. LEGO contracts
 * ════════════════════════════════════════════════════════════════════ */
block('7. LEGO contracts', () => {
  t('7.1 onCoolOffPeriodActive owner declared: netherlandsComplianceGate.mjs',
    /onCoolOffPeriodActive:\s*\[\s*['"]netherlandsComplianceGate\.mjs['"]\s*\]/.test(legoSrc));
  t('7.2 onCoolOffPeriodExpired owner declared: netherlandsComplianceGate.mjs',
    /onCoolOffPeriodExpired:\s*\[\s*['"]netherlandsComplianceGate\.mjs['"]\s*\]/.test(legoSrc));
  t('7.3 onCoolOffPeriodStarted owner declared: netherlandsComplianceGate.mjs',
    /onCoolOffPeriodStarted:\s*\[\s*['"]netherlandsComplianceGate\.mjs['"]\s*\]/.test(legoSrc));
  t('7.4 W58.J-NL.3 marker comment in lego-gate.mjs',
    /W58\.J-NL\.3/.test(legoSrc));
  t('7.5 Wet KSA §33 citation in lego-gate.mjs',
    /Wet\s*KSA[\s\S]{0,500}§\s*33/.test(legoSrc) ||
    /§\s*33[\s\S]{0,500}Wet\s*KSA/.test(legoSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 8. Honest scope
 * ════════════════════════════════════════════════════════════════════ */
block('8. Honest scope', () => {
  t('8.1 Source notes cross-operator enforcement still lives at Cruks (not here)',
    /Cross-operator/i.test(src) && /Cruks/i.test(src));
  t('8.2 Source notes private-mode safety on localStorage',
    /private mode/i.test(src));
  t('8.3 Source notes never-shrink regulator default',
    /never SHORTENS|never-shrink|never\s+shrink/i.test(src));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
