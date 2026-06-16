#!/usr/bin/env node
/**
 * tests/blocks/_realityCheckW52.test.mjs
 *
 * Wave W52 — realityCheck wire-up za W50 (LDW) + W51 (winCap) metrics.
 *
 * UKGC LCCP 8.3.1 + MGA Player Protection Directive §5 zahtevaju da
 * Reality Check modal pokaže session-cumulative činjenice koje player
 * može da koristi za samoprocenu. W52 integrira W50 (LDW suppressed
 * count + net) i W51 (winCap hits + jurisdiction) u stats payload i
 * STATE expose, tako da downstream consumer-i (telemetry, audit log)
 * mogu da prate player-protection signal.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  defaultConfig,
  resolveConfig,
  emitRealityCheckRuntime,
} from '../../src/blocks/realityCheck.mjs';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

const cfg = { ...defaultConfig(), enabled: true };
const rt = emitRealityCheckRuntime(cfg);

/* ════════════════════════════════════════════════════════════════════
 * 1. STATE bag — W52 fields exist + initialize to 0
 * ════════════════════════════════════════════════════════════════════ */
block('1. STATE.ldw* and STATE.winCap* counters declared', () => {
  t('1.1 STATE.ldwCount declared with initial 0',
    /STATE\s*=\s*\{[\s\S]*?ldwCount:\s*0/.test(rt));
  t('1.2 STATE.ldwAwardSum declared with initial 0',
    /STATE\s*=\s*\{[\s\S]*?ldwAwardSum:\s*0/.test(rt));
  t('1.3 STATE.ldwBetSum declared with initial 0',
    /STATE\s*=\s*\{[\s\S]*?ldwBetSum:\s*0/.test(rt));
  t('1.4 STATE.winCapHits declared with initial 0',
    /STATE\s*=\s*\{[\s\S]*?winCapHits:\s*0/.test(rt));
  t('1.5 STATE.winCapLastJurisdiction declared with initial empty string',
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
  t('2.3 onLdwSuppressed handler increments STATE.ldwCount',
    /onLdwSuppressed[\s\S]{0,400}STATE\.ldwCount\s*\+=\s*1/.test(rt));
  t('2.4 onLdwSuppressed handler accumulates award sum from payload',
    /onLdwSuppressed[\s\S]{0,600}STATE\.ldwAwardSum\s*\+=\s*p\.award/.test(rt));
  t('2.5 onLdwSuppressed handler accumulates bet sum from payload',
    /onLdwSuppressed[\s\S]{0,600}STATE\.ldwBetSum\s*\+=\s*p\.bet/.test(rt));
  t('2.6 onWinCapTriggered handler increments STATE.winCapHits',
    /onWinCapTriggered[\s\S]{0,400}STATE\.winCapHits\s*\+=\s*1/.test(rt));
  t('2.7 onWinCapTriggered handler captures jurisdiction from payload',
    /onWinCapTriggered[\s\S]{0,500}STATE\.winCapLastJurisdiction\s*=\s*p\.jurisdiction/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 3. Stats payload augmentation — W52 fields in onRealityCheckShown
 * ════════════════════════════════════════════════════════════════════ */
block('3. onRealityCheckShown stats payload contains W52 metrics', () => {
  t('3.1 stats.ldwCount in onRealityCheckShown payload',
    /onRealityCheckShown[\s\S]{0,800}ldwCount:\s*STATE\.ldwCount/.test(rt));
  t('3.2 stats.ldwAwardSum in onRealityCheckShown payload',
    /onRealityCheckShown[\s\S]{0,800}ldwAwardSum:\s*STATE\.ldwAwardSum/.test(rt));
  t('3.3 stats.ldwBetSum in onRealityCheckShown payload',
    /onRealityCheckShown[\s\S]{0,800}ldwBetSum:\s*STATE\.ldwBetSum/.test(rt));
  t('3.4 stats.ldwNet computed (awardSum - betSum)',
    /onRealityCheckShown[\s\S]{0,1000}ldwNet:\s*STATE\.ldwAwardSum\s*-\s*STATE\.ldwBetSum/.test(rt));
  t('3.5 stats.winCapHits in onRealityCheckShown payload',
    /onRealityCheckShown[\s\S]{0,1000}winCapHits:\s*STATE\.winCapHits/.test(rt));
  t('3.6 stats.winCapLastJurisdiction in onRealityCheckShown payload',
    /onRealityCheckShown[\s\S]{0,1200}winCapLastJurisdiction:\s*STATE\.winCapLastJurisdiction/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 4. Stats payload augmentation — W52 fields in onRealityCheckQuit
 * ════════════════════════════════════════════════════════════════════ */
block('4. _quit stats payload contains W52 metrics', () => {
  /* _quit builds a stats const object before emit */
  t('4.1 quit stats.ldwCount',
    /var stats\s*=\s*\{[\s\S]{0,800}ldwCount:\s*STATE\.ldwCount/.test(rt));
  t('4.2 quit stats.ldwAwardSum',
    /var stats\s*=\s*\{[\s\S]{0,800}ldwAwardSum:\s*STATE\.ldwAwardSum/.test(rt));
  t('4.3 quit stats.ldwBetSum',
    /var stats\s*=\s*\{[\s\S]{0,800}ldwBetSum:\s*STATE\.ldwBetSum/.test(rt));
  t('4.4 quit stats.ldwNet computed',
    /var stats\s*=\s*\{[\s\S]{0,1000}ldwNet:\s*STATE\.ldwAwardSum\s*-\s*STATE\.ldwBetSum/.test(rt));
  t('4.5 quit stats.winCapHits',
    /var stats\s*=\s*\{[\s\S]{0,1000}winCapHits:\s*STATE\.winCapHits/.test(rt));
  t('4.6 quit stats.winCapLastJurisdiction',
    /var stats\s*=\s*\{[\s\S]{0,1200}winCapLastJurisdiction:\s*STATE\.winCapLastJurisdiction/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 5. Session reset — W52 counters cleared on rcResetSession
 * ════════════════════════════════════════════════════════════════════ */
block('5. rcResetSession clears W52 counters', () => {
  t('5.1 rcResetSession resets STATE.ldwCount = 0',
    /rcResetSession[\s\S]{0,800}STATE\.ldwCount\s*=\s*0/.test(rt));
  t('5.2 rcResetSession resets STATE.ldwAwardSum = 0',
    /rcResetSession[\s\S]{0,800}STATE\.ldwAwardSum\s*=\s*0/.test(rt));
  t('5.3 rcResetSession resets STATE.ldwBetSum = 0',
    /rcResetSession[\s\S]{0,800}STATE\.ldwBetSum\s*=\s*0/.test(rt));
  t('5.4 rcResetSession resets STATE.winCapHits = 0',
    /rcResetSession[\s\S]{0,1000}STATE\.winCapHits\s*=\s*0/.test(rt));
  t('5.5 rcResetSession resets STATE.winCapLastJurisdiction = ""',
    /rcResetSession[\s\S]{0,1200}STATE\.winCapLastJurisdiction\s*=\s*['"]['"]/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 6. Sandbox simulation — fire events + verify STATE accumulates
 * ════════════════════════════════════════════════════════════════════ */
block('6. Sandbox HookBus simulation', () => {
  /* Build a mini HookBus + window globals + evaluate the runtime emit
   * inside a fresh scope so we can fire events and observe STATE bag. */
  const sandbox = {
    window: {},
    document: undefined,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    Promise,
    console,
  };
  const events = {};
  const HookBus = {
    on(name, fn) { (events[name] = events[name] || []).push(fn); },
    emit(name, p) { (events[name] || []).forEach(fn => { try { fn(p); } catch (_) {} }); },
  };
  sandbox.window.HookBus = HookBus;

  /* Wrap the IIFE runtime in a Function so it executes with our sandbox */
  try {
    const fn = new Function('window', 'HookBus', 'document', 'setTimeout', 'clearTimeout', 'Promise', 'console', rt);
    fn(sandbox.window, HookBus, undefined, () => 0, () => undefined, Promise, console);
  } catch (e) {
    /* DOM dependencies are stubbed — runtime tries to mount but the
     * listeners install first. STATE bag still expose-uje. */
  }

  const STATE = sandbox.window.RC_STATE;
  t('6.1 RC_STATE exposed on window after emit eval', !!STATE);
  if (!STATE) return;

  t('6.2 initial ldwCount = 0', STATE.ldwCount === 0);
  t('6.3 initial winCapHits = 0', STATE.winCapHits === 0);

  /* Fire 3 LDW suppressions */
  HookBus.emit('onLdwSuppressed', { award: 10, bet: 20 });
  HookBus.emit('onLdwSuppressed', { award:  5, bet: 20 });
  HookBus.emit('onLdwSuppressed', { award:  0, bet: 20, source: 'post-fs' });
  t('6.4 after 3 LDW emits ldwCount = 3', STATE.ldwCount === 3);
  t('6.5 ldwAwardSum = 10 + 5 + 0 = 15', STATE.ldwAwardSum === 15);
  t('6.6 ldwBetSum = 20 + 20 + 20 = 60', STATE.ldwBetSum === 60);
  t('6.7 derived ldwNet (award - bet) = 15 − 60 = -45', (STATE.ldwAwardSum - STATE.ldwBetSum) === -45);

  /* Fire 2 winCap triggers */
  HookBus.emit('onWinCapTriggered', { jurisdiction: 'UKGC', ceiling: 100000, hitAt: 100000, mode: 'round' });
  HookBus.emit('onWinCapTriggered', { jurisdiction: 'MGA',  ceiling: 500000, hitAt: 500001, mode: 'round' });
  t('6.8 after 2 winCap triggers winCapHits = 2', STATE.winCapHits === 2);
  t('6.9 winCapLastJurisdiction is last (MGA)', STATE.winCapLastJurisdiction === 'MGA');

  /* Verify resetSession clears (rcResetSession calls _renderStats which
   * touches DOM — swallow the expected TypeError; state mutation runs
   * BEFORE the render call so STATE is still cleared). */
  if (typeof sandbox.window.rcResetSession === 'function') {
    try { sandbox.window.rcResetSession(); } catch (_) {}
    t('6.10 rcResetSession clears ldwCount → 0', STATE.ldwCount === 0);
    t('6.11 rcResetSession clears winCapHits → 0', STATE.winCapHits === 0);
    t('6.12 rcResetSession clears winCapLastJurisdiction → ""', STATE.winCapLastJurisdiction === '');
  } else {
    t('6.10 rcResetSession exposed', false, 'function missing');
  }
});

/* ════════════════════════════════════════════════════════════════════
 * 7. JSDoc + comment citations — UKGC LCCP 8.3.1 + MGA PP §5
 * ════════════════════════════════════════════════════════════════════ */
block('7. JSDoc + inline comment citations', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, '../../src/blocks/realityCheck.mjs'), 'utf8');
  t('7.1 cites UKGC LCCP 8.3.1',  /UKGC[^.]*LCCP[^.]*8\.3\.1/i.test(src));
  t('7.2 cites MGA Player Protection (Directive §5 or PP §5)',
    /MGA[^.]*Player Protection/i.test(src));
  t('7.3 cites W50 LDW dependency',  /W50/.test(src));
  t('7.4 cites W51 winCap dependency', /W51/.test(src));
});

/* ════════════════════════════════════════════════════════════════════
 * 8. Vendor-neutrality
 * ════════════════════════════════════════════════════════════════════ */
block('8. Vendor-neutrality (HARD RULE #1)', () => {
  const VENDORS = /\b(igt|pragmatic|megaways|cleopatra|buffalo|wolf[- ]run|cash[- ]eruption|netent|microgaming|light\s*&?\s*wonder|scientific\s*games|lightning\s*link|sweet\s*bonanza)\b/i;
  t('8.1 runtime vendor-neutral', !VENDORS.test(rt));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
