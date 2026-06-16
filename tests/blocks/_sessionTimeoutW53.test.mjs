#!/usr/bin/env node
/**
 * tests/blocks/_sessionTimeoutW53.test.mjs
 *
 * Wave W53 — sessionTimeout paritetni W50 (LDW) + W51 (winCap) wire-up.
 *
 * AGCO Standard 4.07 + UKGC LCCP 8.3.1 zahtevaju da session-cap modal
 * pokaže iste session-cumulative metrike kao realityCheck (W52) — LDW
 * suppressed count + net + winCap hits + jurisdiction — uz elapsed
 * sessionMs, tako da player ima isti audit-trail kroz oba regulator
 * gate-a.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  defaultConfig,
  emitSessionTimeoutRuntime,
} from '../../src/blocks/sessionTimeout.mjs';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

const cfg = { ...defaultConfig(), enabled: true };
const rt = emitSessionTimeoutRuntime(cfg);

/* ════════════════════════════════════════════════════════════════════
 * 1. STATE bag — W53 fields declared with initial values
 * ════════════════════════════════════════════════════════════════════ */
block('1. STATE.ldw* + STATE.winCap* counters declared', () => {
  t('1.1 STATE.ldwCount declared with initial 0',
    /STATE\s*=\s*\{[\s\S]*?ldwCount:\s*0/.test(rt));
  t('1.2 STATE.ldwAwardSum declared with initial 0',
    /STATE\s*=\s*\{[\s\S]*?ldwAwardSum:\s*0/.test(rt));
  t('1.3 STATE.ldwBetSum declared with initial 0',
    /STATE\s*=\s*\{[\s\S]*?ldwBetSum:\s*0/.test(rt));
  t('1.4 STATE.winCapHits declared with initial 0',
    /STATE\s*=\s*\{[\s\S]*?winCapHits:\s*0/.test(rt));
  t('1.5 STATE.winCapLastJurisdiction declared with empty string',
    /STATE\s*=\s*\{[\s\S]*?winCapLastJurisdiction:\s*['"]['"]/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. HookBus listeners — onLdwSuppressed + onWinCapTriggered
 * ════════════════════════════════════════════════════════════════════ */
block('2. HookBus listeners for W50 + W51 audit signals', () => {
  t('2.1 listens to onLdwSuppressed (W50 audit)',
    /HookBus\.on\(\s*['"]onLdwSuppressed['"]/.test(rt));
  t('2.2 listens to onWinCapTriggered (W51 audit)',
    /HookBus\.on\(\s*['"]onWinCapTriggered['"]/.test(rt));
  t('2.3 onLdwSuppressed increments STATE.ldwCount',
    /onLdwSuppressed[\s\S]{0,400}STATE\.ldwCount\s*\+=\s*1/.test(rt));
  t('2.4 onLdwSuppressed accumulates award sum',
    /onLdwSuppressed[\s\S]{0,600}STATE\.ldwAwardSum\s*\+=\s*p\.award/.test(rt));
  t('2.5 onLdwSuppressed accumulates bet sum',
    /onLdwSuppressed[\s\S]{0,600}STATE\.ldwBetSum\s*\+=\s*p\.bet/.test(rt));
  t('2.6 onWinCapTriggered increments STATE.winCapHits',
    /onWinCapTriggered[\s\S]{0,400}STATE\.winCapHits\s*\+=\s*1/.test(rt));
  t('2.7 onWinCapTriggered captures jurisdiction',
    /onWinCapTriggered[\s\S]{0,500}STATE\.winCapLastJurisdiction\s*=\s*p\.jurisdiction/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 3. onSessionWarningShown payload augmentation
 * ════════════════════════════════════════════════════════════════════ */
block('3. onSessionWarningShown payload contains W53 metrics', () => {
  t('3.1 includes ldwCount',
    /onSessionWarningShown[\s\S]{0,1000}ldwCount:\s*STATE\.ldwCount/.test(rt));
  t('3.2 includes ldwAwardSum',
    /onSessionWarningShown[\s\S]{0,1000}ldwAwardSum:\s*STATE\.ldwAwardSum/.test(rt));
  t('3.3 includes ldwBetSum',
    /onSessionWarningShown[\s\S]{0,1000}ldwBetSum:\s*STATE\.ldwBetSum/.test(rt));
  t('3.4 includes ldwNet derived',
    /onSessionWarningShown[\s\S]{0,1200}ldwNet:\s*STATE\.ldwAwardSum\s*-\s*STATE\.ldwBetSum/.test(rt));
  t('3.5 includes winCapHits',
    /onSessionWarningShown[\s\S]{0,1200}winCapHits:\s*STATE\.winCapHits/.test(rt));
  t('3.6 includes winCapLastJurisdiction',
    /onSessionWarningShown[\s\S]{0,1400}winCapLastJurisdiction:\s*STATE\.winCapLastJurisdiction/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 4. onSessionTimeoutFired payload augmentation
 * ════════════════════════════════════════════════════════════════════ */
block('4. onSessionTimeoutFired payload contains W53 metrics', () => {
  t('4.1 includes ldwCount',
    /onSessionTimeoutFired[\s\S]{0,1000}ldwCount:\s*STATE\.ldwCount/.test(rt));
  t('4.2 includes ldwAwardSum',
    /onSessionTimeoutFired[\s\S]{0,1000}ldwAwardSum:\s*STATE\.ldwAwardSum/.test(rt));
  t('4.3 includes ldwBetSum',
    /onSessionTimeoutFired[\s\S]{0,1000}ldwBetSum:\s*STATE\.ldwBetSum/.test(rt));
  t('4.4 includes ldwNet derived',
    /onSessionTimeoutFired[\s\S]{0,1200}ldwNet:\s*STATE\.ldwAwardSum\s*-\s*STATE\.ldwBetSum/.test(rt));
  t('4.5 includes winCapHits',
    /onSessionTimeoutFired[\s\S]{0,1200}winCapHits:\s*STATE\.winCapHits/.test(rt));
  t('4.6 includes winCapLastJurisdiction',
    /onSessionTimeoutFired[\s\S]{0,1400}winCapLastJurisdiction:\s*STATE\.winCapLastJurisdiction/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 5. onSessionLogoutRequested payload augmentation
 * ════════════════════════════════════════════════════════════════════ */
block('5. onSessionLogoutRequested stats contains W53 metrics', () => {
  t('5.1 _logout stats include ldwCount',
    /var stats\s*=\s*\{[\s\S]{0,800}ldwCount:\s*STATE\.ldwCount/.test(rt));
  t('5.2 _logout stats include ldwAwardSum',
    /var stats\s*=\s*\{[\s\S]{0,800}ldwAwardSum:\s*STATE\.ldwAwardSum/.test(rt));
  t('5.3 _logout stats include ldwBetSum',
    /var stats\s*=\s*\{[\s\S]{0,800}ldwBetSum:\s*STATE\.ldwBetSum/.test(rt));
  t('5.4 _logout stats include ldwNet derived',
    /var stats\s*=\s*\{[\s\S]{0,1000}ldwNet:\s*STATE\.ldwAwardSum\s*-\s*STATE\.ldwBetSum/.test(rt));
  t('5.5 _logout stats include winCapHits',
    /var stats\s*=\s*\{[\s\S]{0,1000}winCapHits:\s*STATE\.winCapHits/.test(rt));
  t('5.6 _logout stats include winCapLastJurisdiction',
    /var stats\s*=\s*\{[\s\S]{0,1200}winCapLastJurisdiction:\s*STATE\.winCapLastJurisdiction/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 6. stResetSession clears W53 metrics
 * ════════════════════════════════════════════════════════════════════ */
block('6. stResetSession clears W53 counters', () => {
  t('6.1 stResetSession resets STATE.ldwCount = 0',
    /stResetSession[\s\S]{0,800}STATE\.ldwCount\s*=\s*0/.test(rt));
  t('6.2 stResetSession resets STATE.ldwAwardSum = 0',
    /stResetSession[\s\S]{0,800}STATE\.ldwAwardSum\s*=\s*0/.test(rt));
  t('6.3 stResetSession resets STATE.ldwBetSum = 0',
    /stResetSession[\s\S]{0,800}STATE\.ldwBetSum\s*=\s*0/.test(rt));
  t('6.4 stResetSession resets STATE.winCapHits = 0',
    /stResetSession[\s\S]{0,1000}STATE\.winCapHits\s*=\s*0/.test(rt));
  t('6.5 stResetSession resets STATE.winCapLastJurisdiction = ""',
    /stResetSession[\s\S]{0,1200}STATE\.winCapLastJurisdiction\s*=\s*['"]['"]/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 7. Sandbox event simulation — fire events + verify STATE
 * ════════════════════════════════════════════════════════════════════ */
block('7. Sandbox HookBus simulation', () => {
  const sandbox = { window: {} };
  const events = {};
  const HookBus = {
    on(name, fn) { (events[name] = events[name] || []).push(fn); },
    emit(name, p) { (events[name] || []).forEach(fn => { try { fn(p); } catch (_) {} }); },
  };
  sandbox.window.HookBus = HookBus;

  try {
    const fn = new Function('window', 'HookBus', 'document', 'setTimeout', 'clearTimeout', 'Promise', 'console', rt);
    fn(sandbox.window, HookBus, undefined, () => 0, () => undefined, Promise, console);
  } catch (_) { /* DOM dependencies stubbed */ }

  const STATE = sandbox.window.ST_STATE;
  t('7.1 ST_STATE exposed on window', !!STATE);
  if (!STATE) return;

  t('7.2 initial ldwCount = 0', STATE.ldwCount === 0);
  t('7.3 initial winCapHits = 0', STATE.winCapHits === 0);

  HookBus.emit('onLdwSuppressed', { award: 5, bet: 10 });
  HookBus.emit('onLdwSuppressed', { award: 8, bet: 10 });
  t('7.4 ldwCount = 2 after 2 emits', STATE.ldwCount === 2);
  t('7.5 ldwAwardSum = 13', STATE.ldwAwardSum === 13);
  t('7.6 ldwBetSum = 20', STATE.ldwBetSum === 20);
  t('7.7 derived ldwNet = -7', (STATE.ldwAwardSum - STATE.ldwBetSum) === -7);

  HookBus.emit('onWinCapTriggered', { jurisdiction: 'DE', ceiling: 100000, hitAt: 100000, mode: 'round' });
  t('7.8 winCapHits = 1', STATE.winCapHits === 1);
  t('7.9 winCapLastJurisdiction = DE', STATE.winCapLastJurisdiction === 'DE');

  HookBus.emit('onWinCapTriggered', { jurisdiction: 'ON', ceiling: 250000, hitAt: 250100, mode: 'round' });
  t('7.10 winCapHits = 2', STATE.winCapHits === 2);
  t('7.11 last jurisdiction overwrites to ON', STATE.winCapLastJurisdiction === 'ON');
});

/* ════════════════════════════════════════════════════════════════════
 * 8. JSDoc + comment citations
 * ════════════════════════════════════════════════════════════════════ */
block('8. JSDoc + comment citations', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, '../../src/blocks/sessionTimeout.mjs'), 'utf8');
  t('8.1 cites AGCO 4.07',           /AGCO[^.]*4\.07/i.test(src));
  t('8.2 cites UKGC LCCP 8.3.1',     /UKGC[^.]*LCCP[^.]*8\.3\.1/i.test(src));
  t('8.3 cites W50 LDW dependency',  /W50/.test(src));
  t('8.4 cites W51 winCap dependency', /W51/.test(src));
});

/* ════════════════════════════════════════════════════════════════════
 * 9. Vendor-neutrality
 * ════════════════════════════════════════════════════════════════════ */
block('9. Vendor-neutrality (HARD RULE #1)', () => {
  const VENDORS = /\b(igt|pragmatic|megaways|cleopatra|buffalo|wolf[- ]run|cash[- ]eruption|netent|microgaming|light\s*&?\s*wonder|scientific\s*games|lightning\s*link|sweet\s*bonanza)\b/i;
  t('9.1 runtime vendor-neutral', !VENDORS.test(rt));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
