#!/usr/bin/env node
/**
 * tests/blocks/perTriggerVolatilitySet.test.mjs
 *
 * D-17.4 — Per-trigger volatility set classifier + lock test.
 */

import {
  defaultConfig,
  resolveConfig,
  normalizeTier,
  emitPerTriggerVolatilitySetCSS,
  emitPerTriggerVolatilitySetRuntime,
} from '../../src/blocks/perTriggerVolatilitySet.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../src/blocks/perTriggerVolatilitySet.mjs');

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('— perTriggerVolatilitySet block —');

/* 1. defaults */
const dflt = defaultConfig();
t('default enabled=false', dflt.enabled === false);
t('default tiers=[Low,Med,High]',
  JSON.stringify(dflt.tiers) === '["Low","Med","High"]');
t('default defaultTier=Med', dflt.defaultTier === 'Med');
t('default weights=null', dflt.weights === null);
t('default lockOnTrigger=true', dflt.lockOnTrigger === true);
t('default showStatusText=true', dflt.showStatusText === true);
t('default role=status', dflt.role === 'status');
t('default ariaLabelPrefix="Volatility set"',
  dflt.ariaLabelPrefix === 'Volatility set');

/* 2. fresh tiers array */
dflt.tiers.push('X');
const dflt2 = defaultConfig();
t('defaults returns fresh tiers array',
  JSON.stringify(dflt2.tiers) === '["Low","Med","High"]');

/* 3. resolveConfig — enabled */
t('resolveConfig honors enabled=true',
  resolveConfig({ perTriggerVolatilitySet: { enabled: true } }).enabled === true);

/* 4. resolveConfig — custom tiers */
const custom = resolveConfig({ perTriggerVolatilitySet: {
  tiers: ['Calm', 'Volatile', 'Eruption']
}});
t('resolveConfig honors custom tiers',
  JSON.stringify(custom.tiers) === '["Calm","Volatile","Eruption"]');

/* 5. resolveConfig — defaultTier inside whitelist */
const dtCfg = resolveConfig({ perTriggerVolatilitySet: {
  tiers: ['Calm', 'Volatile', 'Eruption'],
  defaultTier: 'Eruption',
}});
t('resolveConfig honors defaultTier in whitelist', dtCfg.defaultTier === 'Eruption');

/* 6. resolveConfig — defaultTier fallback to middle when invalid */
const dtBad = resolveConfig({ perTriggerVolatilitySet: {
  tiers: ['Calm', 'Volatile', 'Eruption'],
  defaultTier: 'NotAValidTier',
}});
t('resolveConfig falls back to middle tier when defaultTier invalid',
  dtBad.defaultTier === 'Volatile');

/* 7. resolveConfig — weights */
const wCfg = resolveConfig({ perTriggerVolatilitySet: {
  weights: { Low: 0.5, Med: 0.35, High: 0.15 },
}});
t('resolveConfig honors weights object',
  wCfg.weights && wCfg.weights.Low === 0.5 && wCfg.weights.High === 0.15);
const wBad = resolveConfig({ perTriggerVolatilitySet: {
  weights: { Low: 'bad', Med: -1, High: 1e9 },
}});
t('resolveConfig rejects all-bad weights → null',
  wBad.weights === null);

/* 8. resolveConfig — tiers sanitize (dedupe + skip empty + non-string) */
const tDirty = resolveConfig({ perTriggerVolatilitySet: {
  tiers: ['Low', 'Low', '', 42, 'Med', 'Med', 'High'],
}});
t('resolveConfig dedupes + drops bad tiers',
  JSON.stringify(tDirty.tiers) === '["Low","Med","High"]');

/* 9. resolveConfig — lockOnTrigger + showStatusText */
t('resolveConfig honors lockOnTrigger=false',
  resolveConfig({ perTriggerVolatilitySet: { lockOnTrigger: false } }).lockOnTrigger === false);
t('resolveConfig honors showStatusText=false',
  resolveConfig({ perTriggerVolatilitySet: { showStatusText: false } }).showStatusText === false);

/* 10. resolveConfig — themeClass + ARIA safe-chars */
const themeCfg = resolveConfig({ perTriggerVolatilitySet: { themeClass: 'foundry-theme_1' } });
t('resolveConfig honors safe themeClass', themeCfg.themeClass === 'foundry-theme_1');
const themeBad = resolveConfig({ perTriggerVolatilitySet: { themeClass: 'foo<x>bar' } });
t('resolveConfig strips unsafe chars from themeClass',
  themeBad.themeClass === 'fooxbar' || themeBad.themeClass === 'foobar');

/* 11. normalizeTier — direct match */
t('normalizeTier direct match "Low"',
  normalizeTier('Low', ['Low','Med','High']) === 'Low');
t('normalizeTier case-insensitive "low"',
  normalizeTier('low', ['Low','Med','High']) === 'Low');
t('normalizeTier case-insensitive "HIGH"',
  normalizeTier('HIGH', ['Low','Med','High']) === 'High');

/* 12. normalizeTier — synonyms */
t('normalizeTier synonym "medium" → "Med"',
  normalizeTier('medium', ['Low','Med','High']) === 'Med');
t('normalizeTier synonym "mid" → "Med"',
  normalizeTier('mid', ['Low','Med','High']) === 'Med');
t('normalizeTier synonym "hi" → "High"',
  normalizeTier('hi', ['Low','Med','High']) === 'High');
t('normalizeTier synonym "l" → "Low"',
  normalizeTier('l', ['Low','Med','High']) === 'Low');

/* 13. normalizeTier — null cases */
t('normalizeTier null on unknown', normalizeTier('Garbage', ['Low','Med','High']) === null);
t('normalizeTier null on empty string', normalizeTier('', ['Low','Med','High']) === null);
t('normalizeTier null on non-string', normalizeTier(42, ['Low','Med','High']) === null);
t('normalizeTier null on empty allowed list', normalizeTier('Low', []) === null);
t('normalizeTier null on null allowed list', normalizeTier('Low', null) === null);

/* 14. normalizeTier — non-standard tiers don't get synonym map */
t('normalizeTier custom tier "Calm" matches "calm"',
  normalizeTier('calm', ['Calm','Volatile','Eruption']) === 'Calm');
t('normalizeTier custom tier "Volatile" matches case',
  normalizeTier('VOLATILE', ['Calm','Volatile','Eruption']) === 'Volatile');
t('normalizeTier custom tiers ignore Low/Med/High synonym map',
  normalizeTier('low', ['Calm','Volatile','Eruption']) === null);

/* 15. CSS emit — disabled */
t('emitCSS(disabled) → empty',
  emitPerTriggerVolatilitySetCSS(defaultConfig()) === '');

/* 16. CSS emit — enabled */
const css = emitPerTriggerVolatilitySetCSS({ ...defaultConfig(), enabled: true });
t('emitCSS includes .ptv-status', css.includes('.ptv-status'));
t('emitCSS includes [data-volatility-tier] hook selector',
  css.includes('[data-volatility-tier]'));
t('emitCSS includes prefers-reduced-motion guard',
  css.includes('prefers-reduced-motion'));

/* 17. Runtime — disabled */
t('emitRuntime(disabled) → empty',
  emitPerTriggerVolatilitySetRuntime(defaultConfig()) === '');

/* 18. Runtime — enabled wires HookBus */
const rt = emitPerTriggerVolatilitySetRuntime({ ...defaultConfig(), enabled: true });
t('runtime non-empty', rt.length > 400);
t('runtime registers onHoldAndWinTrigger listener',
  rt.includes("HookBus.on('onHoldAndWinTrigger'"));
t('runtime registers onHoldAndWinEnd listener',
  rt.includes("HookBus.on('onHoldAndWinEnd'"));
t('runtime registers onFsEnd listener',
  rt.includes("HookBus.on('onFsEnd'"));
t('runtime emits onVolatilitySetLocked',
  rt.includes("HookBus.emit('onVolatilitySetLocked'"));
t('runtime emits onVolatilitySetExpired',
  rt.includes("HookBus.emit('onVolatilitySetExpired'"));
t('runtime exposes window.perTriggerVolatilitySetForce',
  rt.includes('window.perTriggerVolatilitySetForce'));
t('runtime exposes window.perTriggerVolatilitySetGet getter',
  rt.includes('window.perTriggerVolatilitySetGet'));
t('runtime sets __FORCE_VOLATILITY_TIER__ flag',
  rt.includes('window.__FORCE_VOLATILITY_TIER__'));
t('runtime routes force chip through runOneBaseSpin',
  rt.includes('window.runOneBaseSpin()'));
t('runtime tags body[data-volatility-tier]',
  rt.includes("setAttribute('data-volatility-tier'"));
t('runtime carries role="status" aria-live="polite" a11y',
  rt.includes('role="status"') && rt.includes('aria-live="polite"'));

/* 19. Source — vendor-neutral */
const src = readFileSync(SRC, 'utf-8');
const banned = ['cash eruption','wrath of olympus','huff','starlight'];
const lower = src.toLowerCase();
for (const b of banned) {
  t('source vendor-neutral (no "' + b + '")', !lower.includes(b));
}

/* 20. determinism */
const a1 = emitPerTriggerVolatilitySetCSS({ ...defaultConfig(), enabled: true });
const a2 = emitPerTriggerVolatilitySetCSS({ ...defaultConfig(), enabled: true });
t('determinism: same config → byte-identical CSS', a1 === a2);
const r1 = emitPerTriggerVolatilitySetRuntime({ ...defaultConfig(), enabled: true });
const r2 = emitPerTriggerVolatilitySetRuntime({ ...defaultConfig(), enabled: true });
t('determinism: same config → byte-identical runtime', r1 === r2);

console.log('');
console.log('  ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
