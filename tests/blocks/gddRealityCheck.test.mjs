#!/usr/bin/env node
/**
 * tests/blocks/gddRealityCheck.test.mjs
 *
 * D-18 — GDD reality check (declared vs emitted) test.
 */

import {
  defaultConfig,
  resolveConfig,
  computeReality,
  emitGddRealityCheckCSS,
  emitGddRealityCheckRuntime,
} from '../../src/blocks/gddRealityCheck.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../src/blocks/gddRealityCheck.mjs');

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('— gddRealityCheck block —');

/* 1. defaults */
const dflt = defaultConfig();
t('default enabled=false', dflt.enabled === false);
t('default sampleWindowMs=60000', dflt.sampleWindowMs === 60000);
t('default showDevHud=false', dflt.showDevHud === false);
t('default featureToEvents has freeSpins', Array.isArray(dflt.featureToEvents.freeSpins));
t('default featureToEvents has D-17 patternWin',
  Array.isArray(dflt.featureToEvents.patternWin));
t('default role=status', dflt.role === 'status');

/* 2. resolveConfig — enabled + bounds */
t('resolveConfig honors enabled=true',
  resolveConfig({ gddRealityCheck: { enabled: true } }).enabled === true);
t('resolveConfig honors sampleWindowMs=10000',
  resolveConfig({ gddRealityCheck: { sampleWindowMs: 10000 } }).sampleWindowMs === 10000);
t('resolveConfig rejects sampleWindowMs=100 (below bounds)',
  resolveConfig({ gddRealityCheck: { sampleWindowMs: 100 } }).sampleWindowMs === 60000);
t('resolveConfig rejects sampleWindowMs=999999 (above bounds)',
  resolveConfig({ gddRealityCheck: { sampleWindowMs: 999999 } }).sampleWindowMs === 60000);

/* 3. resolveConfig — featureToEvents partial override merges */
const cust = resolveConfig({ gddRealityCheck: {
  featureToEvents: { customFeature: ['onCustom'] },
}});
t('resolveConfig merges custom featureToEvents with defaults',
  Array.isArray(cust.featureToEvents.customFeature) &&
  Array.isArray(cust.featureToEvents.freeSpins));

/* 4. computeReality — all verified case */
const r1 = computeReality(
  [{ kind: 'freeSpins' }, { kind: 'holdAndWin' }],
  new Set(['onFsEnter', 'onHoldAndWinTrigger']),
  defaultConfig()
);
t('computeReality 2 declared, 2 verified → 100% compliance',
  r1.compliance === 1.0 && r1.verified.length === 2 && r1.dead.length === 0);

/* 5. computeReality — partial dead case */
const r2 = computeReality(
  [{ kind: 'freeSpins' }, { kind: 'holdAndWin' }, { kind: 'wheelBonus' }],
  new Set(['onFsEnter']),
  defaultConfig()
);
t('computeReality 3 declared, 1 verified → ~33%',
  Math.abs(r2.compliance - 1/3) < 0.001);
t('computeReality reports dead features',
  r2.dead.includes('holdAndWin') && r2.dead.includes('wheelBonus'));

/* 6. computeReality — spurious case */
const r3 = computeReality(
  [{ kind: 'freeSpins' }],
  new Set(['onFsEnter', 'onWheelBonusReady', 'onLightningStrike']),
  defaultConfig()
);
t('computeReality reports spurious events',
  r3.spurious.length === 2 &&
  r3.spurious.some(s => s.ownerKind === 'wheelBonus') &&
  r3.spurious.some(s => s.ownerKind === 'lightning'));

/* 7. computeReality — unknown event ignored from spurious */
const r4 = computeReality(
  [{ kind: 'freeSpins' }],
  new Set(['onFsEnter', 'someUnmappedEvent']),
  defaultConfig()
);
t('computeReality ignores unmapped events from spurious',
  r4.spurious.length === 0);

/* 8. computeReality — empty declared = 100% (nothing to fail) */
const r5 = computeReality([], new Set(), defaultConfig());
t('computeReality empty declared → 100% compliance (degenerate ok)',
  r5.compliance === 1.0);

/* 9. computeReality — accepts array instead of Set */
const r6 = computeReality(
  [{ kind: 'freeSpins' }],
  ['onFsEnter'],
  defaultConfig()
);
t('computeReality accepts emitted as array',
  r6.compliance === 1.0 && r6.verified.includes('freeSpins'));

/* 10. CSS emit — disabled */
t('emitCSS(disabled) → empty', emitGddRealityCheckCSS(defaultConfig()) === '');

/* 11. CSS emit — hidden status only (no HUD) */
const cssHidden = emitGddRealityCheckCSS({ ...defaultConfig(), enabled: true });
t('emitCSS with showDevHud=false includes .grc-status only',
  cssHidden.includes('.grc-status') && !cssHidden.includes('.grc-hud'));

/* 12. CSS emit — with dev HUD */
const cssHud = emitGddRealityCheckCSS({ ...defaultConfig(), enabled: true, showDevHud: true });
t('emitCSS with showDevHud=true includes .grc-hud',
  cssHud.includes('.grc-hud') && cssHud.includes('.grc-hud-row'));
t('emitCSS includes prefers-reduced-motion guard',
  cssHud.includes('prefers-reduced-motion'));

/* 13. Runtime emit — disabled */
t('emitRuntime(disabled) → empty', emitGddRealityCheckRuntime(defaultConfig()) === '');

/* 14. Runtime emit — enabled wires HookBus + global hook */
const rt = emitGddRealityCheckRuntime({ ...defaultConfig(), enabled: true });
t('runtime non-empty', rt.length > 500);
t('runtime instruments HookBus.emit (wraps)',
  rt.includes('window.HookBus.emit ='));
t('runtime emits onGddRealityReport',
  rt.includes("HookBus.emit('onGddRealityReport'"));
t('runtime exposes window.gddRealityCheckReport getter',
  rt.includes('window.gddRealityCheckReport'));
t('runtime exposes window.gddRealityCheckForceReport',
  rt.includes('window.gddRealityCheckForceReport'));
t('runtime schedules report via setTimeout with sampleWindowMs',
  rt.includes('setTimeout(report, CFG.sampleWindowMs)'));
t('runtime DOMContentLoaded fallback',
  rt.includes('DOMContentLoaded'));
t('runtime reads window.__SLOT_MODEL__ for declared list',
  rt.includes('window.__SLOT_MODEL__'));
t('runtime carries role="status" aria-live="polite" a11y',
  rt.includes('role="status"') && rt.includes('aria-live="polite"'));

/* 15. Source — vendor-neutral */
const src = readFileSync(SRC, 'utf-8');
const banned = ['cash eruption','wrath of olympus','huff','starlight'];
const lower = src.toLowerCase();
for (const b of banned) {
  t('source vendor-neutral (no "' + b + '")', !lower.includes(b));
}

/* 16. determinism */
const c1 = emitGddRealityCheckCSS({ ...defaultConfig(), enabled: true });
const c2 = emitGddRealityCheckCSS({ ...defaultConfig(), enabled: true });
t('determinism: same config → byte-identical CSS', c1 === c2);
const r1d = emitGddRealityCheckRuntime({ ...defaultConfig(), enabled: true });
const r2d = emitGddRealityCheckRuntime({ ...defaultConfig(), enabled: true });
t('determinism: same config → byte-identical runtime', r1d === r2d);

console.log('');
console.log('  ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
