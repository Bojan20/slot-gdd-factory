/**
 * tests/blocks/batchSimulatorPanel.test.mjs
 *
 * QA-3d · Boki 2026-06-27 — block test parity za batchSimulatorPanel.
 */
import {
  defaultConfig,
  resolveConfig,
  emitBatchSimulatorPanelCSS,
  emitBatchSimulatorPanelMarkup,
  emitBatchSimulatorPanelRuntime,
} from '../../src/blocks/batchSimulatorPanel.mjs';

let pass = 0, fail = 0;
function t(name, ok) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n=== batchSimulatorPanel block ===');

const d = defaultConfig();
t('returns frozen object', Object.isFrozen(d));
t('default enabled true', d.enabled === true);
t('exposes backendBase URL', /^https?:\/\//.test(d.backendBase));
t('presets is array', Array.isArray(d.presets));
t('presets includes 1M tier', d.presets.some(p => p.label === '1M'));

const r1 = resolveConfig({ batchSimulatorPanel: { enabled: false } });
t('resolveConfig respects enabled:false', r1.enabled === false);

const r2 = resolveConfig({ batchSimulatorPanel: { backendBase: 'http://10.0.0.1:9999' } });
t('resolveConfig accepts custom backendBase', r2.backendBase === 'http://10.0.0.1:9999');

const r3 = resolveConfig({ batchSimulatorPanel: { backendBase: 'javascript:alert(1)' } });
t('resolveConfig rejects non-http backendBase', r3.backendBase === d.backendBase);

const css = emitBatchSimulatorPanelCSS(d);
t('CSS emit non-empty string', typeof css === 'string' && css.length > 0);

const markup = emitBatchSimulatorPanelMarkup(d);
t('markup emit non-empty string', typeof markup === 'string' && markup.length > 0);

const runtime = emitBatchSimulatorPanelRuntime(d, {});
t('runtime emit non-empty string', typeof runtime === 'string' && runtime.length > 0);

const cssOff = emitBatchSimulatorPanelCSS({ ...d, enabled: false });
t('CSS empty when disabled', cssOff === '');

/* BLOCK-4 profile UI assertions */
t('profiles is frozen array', Array.isArray(d.profiles) && Object.isFrozen(d.profiles));
t('profiles has 4 entries', d.profiles.length === 4);
t('profiles includes quick', d.profiles.some(p => p.key === 'quick'));
t('profiles includes standard', d.profiles.some(p => p.key === 'standard'));
t('profiles includes strict', d.profiles.some(p => p.key === 'strict'));
t('profiles includes regulator', d.profiles.some(p => p.key === 'regulator'));
t('markup renders profile buttons', /data-profile="quick"/.test(markup) && /data-profile="regulator"/.test(markup));
t('markup includes bsp-profile-btn class', /bsp-profile-btn/.test(markup));
t('CSS styles strict profile gold', /bsp-profile-btn--strict/.test(css));
t('CSS styles regulator profile red', /bsp-profile-btn--regulator/.test(css));
t('runtime registers profile click handler', /bsp-profile-btn/.test(runtime) && /data-profile|btn\.dataset\.profile/.test(runtime));
t('runtime POSTs /batch with profile in body', /profile:\s*prof/.test(runtime) && /\/batch/.test(runtime));
t('runtime renders multi-tier ladder', /j\.rounds/.test(runtime) && /pass-row|fail-row/.test(runtime));

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
