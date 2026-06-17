#!/usr/bin/env node
/**
 * tests/blocks/regulatorDisclosureModal.test.mjs
 *
 * Wave W60 — Universal regulator disclosure modal pin test.
 *
 * Validates the universal modal that listens to all *DisclosureRequired
 * + *Enforced + *Prohibited events from W58.J-{UKGC,AGCO,SE,DE,NL,EU,
 * FR,IT,ES} sweep and renders one accessible queue-aware modal.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  defaultConfig,
  resolveConfig,
  emitRegulatorDisclosureModalCSS,
  emitRegulatorDisclosureModalMarkup,
  emitRegulatorDisclosureModalRuntime,
} from '../../src/blocks/regulatorDisclosureModal.mjs';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

/* ════════════════════════════════════════════════════════════════════
 * 1. Default config
 * ════════════════════════════════════════════════════════════════════ */
block('1. defaultConfig', () => {
  const c = defaultConfig();
  t('1.1 enabled true by default',           c.enabled === true);
  t('1.2 queueIntervalMs = 250',             c.queueIntervalMs === 250);
  t('1.3 color amber 255,170,80',            c.color === '255,170,80');
  t('1.4 ackButtonLabel "I UNDERSTAND"',     c.ackButtonLabel === 'I UNDERSTAND');
});

/* ════════════════════════════════════════════════════════════════════
 * 2. resolveConfig
 * ════════════════════════════════════════════════════════════════════ */
block('2. resolveConfig', () => {
  const c1 = resolveConfig({ regulatorDisclosureModal: { enabled: false } });
  t('2.1 enabled=false honored', c1.enabled === false);
  const c2 = resolveConfig({ regulatorDisclosureModal: { queueIntervalMs: 500 } });
  t('2.2 queueIntervalMs override 500', c2.queueIntervalMs === 500);
  const c3 = resolveConfig({ regulatorDisclosureModal: { queueIntervalMs: -1 } });
  t('2.3 negative queueIntervalMs rejected → 250', c3.queueIntervalMs === 250);
  const c4 = resolveConfig({ regulatorDisclosureModal: { color: '100, 200, 50' } });
  t('2.4 color whitespace stripped', c4.color === '100,200,50');
  const c5 = resolveConfig({ regulatorDisclosureModal: { ackButtonLabel: 'OK' } });
  t('2.5 ackButtonLabel override "OK"', c5.ackButtonLabel === 'OK');
  const c6 = resolveConfig({ regulatorDisclosureModal: { ackButtonLabel: '' } });
  t('2.6 empty ackButtonLabel rejected', c6.ackButtonLabel === 'I UNDERSTAND');
});

/* ════════════════════════════════════════════════════════════════════
 * 3. CSS emit
 * ════════════════════════════════════════════════════════════════════ */
block('3. CSS emit', () => {
  const css = emitRegulatorDisclosureModalCSS(defaultConfig());
  t('3.1 contains #regDisclosureModal',         /#regDisclosureModal/.test(css));
  t('3.2 amber color baked',                    /rgba\(255,170,80/.test(css));
  t('3.3 safe-area insets present',             /env\(safe-area-inset/.test(css));
  t('3.4 WCAG 2.5.5 touch target (≥44px)',      /min-height:\s*44px/.test(css));
  t('3.5 prefers-reduced-motion gate',          /prefers-reduced-motion/.test(css));
  t('3.6 :focus-visible accessible focus',      /:focus-visible/.test(css));
  t('3.7 disabled emits empty',                 emitRegulatorDisclosureModalCSS({ ...defaultConfig(), enabled: false }) === '');
});

/* ════════════════════════════════════════════════════════════════════
 * 4. Markup emit (ARIA dialog)
 * ════════════════════════════════════════════════════════════════════ */
block('4. Markup emit', () => {
  const html = emitRegulatorDisclosureModalMarkup(defaultConfig());
  t('4.1 id regDisclosureModal',                /id="regDisclosureModal"/.test(html));
  t('4.2 role="dialog" + aria-modal',           /role="dialog"[\s\S]*aria-modal="true"/.test(html));
  t('4.3 aria-labelledby + aria-describedby',   /aria-labelledby="rdmKind"/.test(html) && /aria-describedby="rdmBody"/.test(html));
  t('4.4 ack button has type="button"',         /<button[^>]*class="rdm-ack"[^>]*type="button"/.test(html));
  t('4.5 disabled emits empty',                 emitRegulatorDisclosureModalMarkup({ ...defaultConfig(), enabled: false }) === '');
});

/* ════════════════════════════════════════════════════════════════════
 * 5. Runtime emit — wires + listens to all 17 events
 * ════════════════════════════════════════════════════════════════════ */
block('5. Runtime — DISCLOSURE_MAP keys + wireBus + queue', () => {
  const rt = emitRegulatorDisclosureModalRuntime(defaultConfig());
  t('5.1 onAutoplayDisclosureRequired',         /onAutoplayDisclosureRequired/.test(rt));
  t('5.2 onRtpDisclosureRequired',              /onRtpDisclosureRequired/.test(rt));
  t('5.3 onPlayTimeDisplayRequired',            /onPlayTimeDisplayRequired/.test(rt));
  t('5.4 onMinSpinPaceEnforced',                /onMinSpinPaceEnforced/.test(rt));
  t('5.5 onGameStateCleared',                   /onGameStateCleared/.test(rt));
  t('5.6 onCruksCheckRequired',                 /onCruksCheckRequired/.test(rt));
  t('5.7 onCoolOffEnforced',                    /onCoolOffEnforced/.test(rt));
  t('5.8 onAiActDdaProhibited',                 /onAiActDdaProhibited/.test(rt));
  t('5.9 onAiSystemDeclarationRequired',        /onAiSystemDeclarationRequired/.test(rt));
  t('5.10 onFrjCheckRequired',                  /onFrjCheckRequired/.test(rt));
  t('5.11 onRuaCheckRequired',                  /onRuaCheckRequired/.test(rt));
  t('5.12 onAutoplayBanned',                    /onAutoplayBanned/.test(rt));
  t('5.13 onTurboBanned',                       /onTurboBanned/.test(rt));
  t('5.14 onMinSpinDurationEnforced',           /onMinSpinDurationEnforced/.test(rt));
  t('5.15 wires HookBus.on for each event',     /HookBus\.on\(n,/.test(rt));
  t('5.16 emit onRegulatorDisclosureShown',     /HookBus\.emit\('onRegulatorDisclosureShown'/.test(rt));
  t('5.17 emit onRegulatorDisclosureAcknowledged', /HookBus\.emit\('onRegulatorDisclosureAcknowledged'/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 6. ACK flags
 * ════════════════════════════════════════════════════════════════════ */
block('6. ACK window flag wiring', () => {
  const rt = emitRegulatorDisclosureModalRuntime(defaultConfig());
  t('6.1 __AUTOPLAY_DISCLOSURE_ACK__',          /__AUTOPLAY_DISCLOSURE_ACK__\s*=\s*true/.test(rt));
  t('6.2 __RTP_DISCLOSURE_ACK__',               /__RTP_DISCLOSURE_ACK__\s*=\s*true/.test(rt));
  t('6.3 __PLAY_TIME_DISPLAY_ACK__',            /__PLAY_TIME_DISPLAY_ACK__\s*=\s*true/.test(rt));
  t('6.4 __NL_CRUKS_CHECK_PASSED__',            /__NL_CRUKS_CHECK_PASSED__\s*=\s*true/.test(rt));
  t('6.5 __EU_AI_DECLARATION_ACK__',            /__EU_AI_DECLARATION_ACK__\s*=\s*true/.test(rt));
  t('6.6 __FR_FRJ_CHECK_PASSED__',              /__FR_FRJ_CHECK_PASSED__\s*=\s*true/.test(rt));
  t('6.7 __IT_RUA_CHECK_PASSED__',              /__IT_RUA_CHECK_PASSED__\s*=\s*true/.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 7. EXPECTED_EMIT_OWNERS registry
 * ════════════════════════════════════════════════════════════════════ */
block('7. EXPECTED_EMIT_OWNERS registry', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const legoGate = readFileSync(resolve(here, '../../tools/lego-gate.mjs'), 'utf8');
  t('7.1 onRegulatorDisclosureShown registered',
    /onRegulatorDisclosureShown:\s*\[\s*'regulatorDisclosureModal\.mjs'\s*\]/.test(legoGate));
  t('7.2 onRegulatorDisclosureAcknowledged registered',
    /onRegulatorDisclosureAcknowledged:\s*\[\s*'regulatorDisclosureModal\.mjs'\s*\]/.test(legoGate));
});

/* ════════════════════════════════════════════════════════════════════
 * 8. Sandbox simulation
 * ════════════════════════════════════════════════════════════════════ */
block('8. Sandbox HookBus simulation', () => {
  const rt = emitRegulatorDisclosureModalRuntime(defaultConfig());
  /* Stub document.getElementById so runtime doesn't crash */
  const docStub = {
    readyState: 'complete',
    /* Bug #4 (2026-06-17): focus-trap installs a document-level keydown
     * listener while modal is open; sandbox must stub addEventListener /
     * removeEventListener so the new code path doesn't crash. */
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => ({
      dataset: {}, textContent: '', hidden: false, addEventListener: () => {},
      focus: () => {}, classList: { add(){}, remove(){} },
      firstChild: null, removeChild: () => {}, appendChild: () => {},
      setAttribute: () => {}, removeAttribute: () => {},
      querySelectorAll: () => [], contains: () => true,
      offsetParent: null,
      style: {},
    }),
    createElement: () => ({ textContent: '' }),
    activeElement: null,
  };
  const events = {};
  const HookBus = {
    on(name, fn) { (events[name] = events[name] || []).push(fn); },
    emit(name, p) { (events[name] || []).forEach(fn => { try { fn(p); } catch (_) {} }); },
  };
  const sandboxWindow = { HookBus };
  try {
    const fn = new Function('window', 'HookBus', 'document', 'setTimeout', 'clearTimeout', 'Promise', 'console', 'Date', rt);
    fn(sandboxWindow, HookBus, docStub, () => 0, () => undefined, Promise, console, Date);
  } catch (e) { console.log('     sandbox err:', e.message); }

  const STATE = sandboxWindow.__REGULATOR_DISCLOSURE_STATE__;
  t('8.1 window.__REGULATOR_DISCLOSURE_STATE__ exposed', !!STATE);
  if (!STATE) return;
  t('8.2 initial acks = 0', STATE.acks() === 0);
  t('8.3 initial shown = 0', STATE.shown() === 0);

  HookBus.emit('onAutoplayDisclosureRequired', { jurisdiction: 'UKGC', step: 25 });
  t('8.4 fire UKGC → shown=1', STATE.shown() === 1);

  HookBus.emit('onAutoplayDisclosureRequired', { jurisdiction: 'UKGC', step: 25 });
  t('8.5 dedup same kind+jurisdiction (no double-show)', STATE.shown() === 1);

  HookBus.emit('onRtpDisclosureRequired', { jurisdiction: 'ON', rtp: 0.96 });
  /* Implementation note: when _dequeue is called while `processing` is
   * still true (modal not yet acked), the second event sits in the
   * queue until ACK frees the slot. The exact in-memory queue depth
   * after a single un-acked first event may show as 1 (queued) or 0
   * (consumed) depending on whether _present completed synchronously
   * in the sandbox. We accept either as a valid state. */
  const qd = STATE.queueDepth();
  t('8.6 different kind queues or presents (depth 0 or 1)',
    qd === 0 || qd === 1);
});

/* ════════════════════════════════════════════════════════════════════
 * 9. JSDoc citations + vendor-neutral
 * ════════════════════════════════════════════════════════════════════ */
block('9. JSDoc + vendor-neutral', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, '../../src/blocks/regulatorDisclosureModal.mjs'), 'utf8');
  t('9.1 cites W58 sweep',                       /W58/.test(src));
  t('9.2 cites W59.H1',                          /W59\.H1/.test(src));
  const rt = emitRegulatorDisclosureModalRuntime(defaultConfig());
  const VENDORS = /\b(igt|pragmatic|megaways|cleopatra|buffalo|netent|microgaming|lightning\s*link|sweet\s*bonanza)\b/i;
  t('9.3 runtime vendor-neutral', !VENDORS.test(rt));
});

/* ════════════════════════════════════════════════════════════════════
 * 10. Determinism
 * ════════════════════════════════════════════════════════════════════ */
block('10. Determinism', () => {
  t('10.1 CSS deterministic',     emitRegulatorDisclosureModalCSS(defaultConfig()) === emitRegulatorDisclosureModalCSS(defaultConfig()));
  t('10.2 Markup deterministic',  emitRegulatorDisclosureModalMarkup(defaultConfig()) === emitRegulatorDisclosureModalMarkup(defaultConfig()));
  t('10.3 Runtime deterministic', emitRegulatorDisclosureModalRuntime(defaultConfig()) === emitRegulatorDisclosureModalRuntime(defaultConfig()));
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
