#!/usr/bin/env node
/**
 * tests/blocks/simultaneousFsHoldAndWinPriority.test.mjs
 *
 * D-17.7 — Cross-feature priority arbiter test.
 */

import {
  defaultConfig,
  resolveConfig,
  shouldDefer,
  emitSimultaneousFsHoldAndWinPriorityCSS,
  emitSimultaneousFsHoldAndWinPriorityRuntime,
} from '../../src/blocks/simultaneousFsHoldAndWinPriority.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../src/blocks/simultaneousFsHoldAndWinPriority.mjs');

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('— simultaneousFsHoldAndWinPriority block —');

/* 1. defaults */
const dflt = defaultConfig();
t('default enabled=false', dflt.enabled === false);
t('default primaryFeature=holdAndWin', dflt.primaryFeature === 'holdAndWin');
t('default secondaryFeature=freeSpins', dflt.secondaryFeature === 'freeSpins');
t('default order=primaryThenSecondary', dflt.order === 'primaryThenSecondary');
t('default showStatusText=true', dflt.showStatusText === true);
t('default role=status', dflt.role === 'status');

/* 2. resolveConfig — enabled */
t('resolveConfig honors enabled=true',
  resolveConfig({ simultaneousFsHoldAndWinPriority: { enabled: true } }).enabled === true);

/* 3. resolveConfig — primaryFeature whitelist */
t('resolveConfig honors primaryFeature=wheelBonus',
  resolveConfig({ simultaneousFsHoldAndWinPriority: { primaryFeature: 'wheelBonus' } }).primaryFeature === 'wheelBonus');
t('resolveConfig rejects unknown primaryFeature',
  resolveConfig({ simultaneousFsHoldAndWinPriority: { primaryFeature: 'foo' } }).primaryFeature === 'holdAndWin');

/* 4. resolveConfig — secondaryFeature whitelist */
t('resolveConfig honors secondaryFeature=bonusPick',
  resolveConfig({ simultaneousFsHoldAndWinPriority: { secondaryFeature: 'bonusPick' } }).secondaryFeature === 'bonusPick');

/* 5. resolveConfig — same primary/secondary → reset to defaults */
const same = resolveConfig({ simultaneousFsHoldAndWinPriority: {
  primaryFeature: 'freeSpins', secondaryFeature: 'freeSpins',
}});
t('resolveConfig falls back when primary==secondary',
  same.primaryFeature === 'holdAndWin' && same.secondaryFeature === 'freeSpins');

/* 6. resolveConfig — order whitelist */
t('resolveConfig honors order=secondaryThenPrimary',
  resolveConfig({ simultaneousFsHoldAndWinPriority: { order: 'secondaryThenPrimary' } }).order === 'secondaryThenPrimary');
t('resolveConfig rejects unknown order',
  resolveConfig({ simultaneousFsHoldAndWinPriority: { order: 'foo' } }).order === 'primaryThenSecondary');

/* 7. resolveConfig — showStatusText + ARIA */
t('resolveConfig honors showStatusText=false',
  resolveConfig({ simultaneousFsHoldAndWinPriority: { showStatusText: false } }).showStatusText === false);
t('resolveConfig honors ariaLabelPrefix',
  resolveConfig({ simultaneousFsHoldAndWinPriority: { ariaLabelPrefix: 'Priority arbiter' } }).ariaLabelPrefix === 'Priority arbiter');

/* 8. resolveConfig — themeClass strip */
const themeBad = resolveConfig({ simultaneousFsHoldAndWinPriority: { themeClass: 'foo<x>bar' } });
t('resolveConfig strips unsafe chars from themeClass',
  themeBad.themeClass === 'fooxbar' || themeBad.themeClass === 'foobar');

/* 9. shouldDefer — primary active */
const en = { ...defaultConfig(), enabled: true };
t('shouldDefer true when primaryActive + no pending',
  shouldDefer({ primaryActive: true, deferredPending: false }, en) === true);

/* 10. shouldDefer — primary inactive */
t('shouldDefer false when primaryActive=false',
  shouldDefer({ primaryActive: false, deferredPending: false }, en) === false);

/* 11. shouldDefer — already pending */
t('shouldDefer false when already deferredPending',
  shouldDefer({ primaryActive: true, deferredPending: true }, en) === false);

/* 12. shouldDefer — disabled */
t('shouldDefer false when disabled',
  shouldDefer({ primaryActive: true }, defaultConfig()) === false);

/* 13. shouldDefer — null state */
t('shouldDefer false on null state', shouldDefer(null, en) === false);
t('shouldDefer false on non-object state', shouldDefer('bad', en) === false);

/* 14. shouldDefer — inverted order */
const inv = { ...defaultConfig(), enabled: true, order: 'secondaryThenPrimary' };
t('shouldDefer false on inverted order (secondaryThenPrimary)',
  shouldDefer({ primaryActive: true }, inv) === false);

/* 15. CSS emit */
t('emitCSS(disabled) → empty',
  emitSimultaneousFsHoldAndWinPriorityCSS(defaultConfig()) === '');
const css = emitSimultaneousFsHoldAndWinPriorityCSS({ ...defaultConfig(), enabled: true });
t('emitCSS includes .sfhp-status', css.includes('.sfhp-status'));
t('emitCSS includes [data-feature-deferred] selector',
  css.includes('[data-feature-deferred'));
t('emitCSS includes prefers-reduced-motion guard',
  css.includes('prefers-reduced-motion'));

/* 16. Runtime */
t('emitRuntime(disabled) → empty',
  emitSimultaneousFsHoldAndWinPriorityRuntime(defaultConfig()) === '');
const rt = emitSimultaneousFsHoldAndWinPriorityRuntime({ ...defaultConfig(), enabled: true });
t('runtime non-empty', rt.length > 400);
t('runtime registers onHoldAndWinTrigger listener',
  rt.includes("HookBus.on('onHoldAndWinTrigger'"));
t('runtime registers onHoldAndWinEnd listener',
  rt.includes("HookBus.on('onHoldAndWinEnd'"));
t('runtime registers onGrandReleased listener',
  rt.includes("HookBus.on('onGrandReleased'"));
t('runtime registers onFsTriggerArmed listener',
  rt.includes("HookBus.on('onFsTriggerArmed'"));
t('runtime registers onFsEnter listener (re-defer guard)',
  rt.includes("HookBus.on('onFsEnter'"));
t('runtime emits onFeaturePriorityDeferred',
  rt.includes("HookBus.emit('onFeaturePriorityDeferred'"));
t('runtime emits onFeaturePriorityResumed',
  rt.includes("HookBus.emit('onFeaturePriorityResumed'"));
t('runtime does NOT re-emit onFsEnter (sole-owner contract preserved)',
  !rt.includes("HookBus.emit('onFsEnter'"));
t('runtime exposes window.simultaneousFsHoldAndWinPriorityForce',
  rt.includes('window.simultaneousFsHoldAndWinPriorityForce'));
t('runtime exposes window.simultaneousFsHoldAndWinPriorityGet getter',
  rt.includes('window.simultaneousFsHoldAndWinPriorityGet'));
t('runtime sets __FORCE_SIMULTANEOUS_FS_HW__ flag',
  rt.includes('window.__FORCE_SIMULTANEOUS_FS_HW__'));
t('runtime sets __FS_TRIGGER_DEFERRED__ flag for upstream consumer',
  rt.includes('__FS_TRIGGER_DEFERRED__'));
t('runtime routes force chip through runOneBaseSpin',
  rt.includes('window.runOneBaseSpin()'));
t('runtime carries role="status" aria-live="polite" a11y',
  rt.includes('role="status"') && rt.includes('aria-live="polite"'));

/* 17. Source — vendor-neutral */
const src = readFileSync(SRC, 'utf-8');
const banned = ['cash eruption','wrath of olympus','huff','starlight'];
const lower = src.toLowerCase();
for (const b of banned) {
  t('source vendor-neutral (no "' + b + '")', !lower.includes(b));
}

/* 18. determinism */
const a1 = emitSimultaneousFsHoldAndWinPriorityCSS({ ...defaultConfig(), enabled: true });
const a2 = emitSimultaneousFsHoldAndWinPriorityCSS({ ...defaultConfig(), enabled: true });
t('determinism: same config → byte-identical CSS', a1 === a2);
const r1 = emitSimultaneousFsHoldAndWinPriorityRuntime({ ...defaultConfig(), enabled: true });
const r2 = emitSimultaneousFsHoldAndWinPriorityRuntime({ ...defaultConfig(), enabled: true });
t('determinism: same config → byte-identical runtime', r1 === r2);

console.log('');
console.log('  ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
