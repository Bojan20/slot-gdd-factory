/**
 * tests/blocks/spinHistoryReplay.test.mjs · LEGO-REPLAY (B-2 · 1/2)
 */
import {
  defaultConfig, resolveConfig,
  emitSpinHistoryReplayCSS, emitSpinHistoryReplayMarkup, emitSpinHistoryReplayRuntime,
} from '../../src/blocks/spinHistoryReplay.mjs';

let pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('\n=== spinHistoryReplay (LEGO-REPLAY B-2 · 1/2) ===');

const d = defaultConfig();
t('disabled by default', d.enabled === false);
t('default label REPLAY', d.label === 'REPLAY');
t('default maxBuffer 10', d.maxBuffer === 10);
t('default captureFs false', d.captureFs === false);

const r1 = resolveConfig({ features: [{ kind: 'spin_replay' }] });
t('auto-enable spin_replay', r1.enabled === true);
const r1b = resolveConfig({ features: [{ kind: 'spin_history' }] });
t('auto-enable spin_history alias', r1b.enabled === true);

const r2 = resolveConfig({ spinHistoryReplay: { enabled: true, maxBuffer: 20, captureFs: true, label: 'HISTORY' } });
t('explicit enable honored', r2.enabled === true);
t('override maxBuffer', r2.maxBuffer === 20);
t('override captureFs', r2.captureFs === true);
t('override label', r2.label === 'HISTORY');

const rClamp = resolveConfig({ spinHistoryReplay: { enabled: true, maxBuffer: 99999 } });
t('clamp maxBuffer ≤ 100', rClamp.maxBuffer === 100);

const cssOff = emitSpinHistoryReplayCSS(defaultConfig());
t('CSS empty when disabled', cssOff === '');
const css = emitSpinHistoryReplayCSS(r1);
t('CSS has banner class', css.includes('.spin-replay-banner'));
t('CSS has reduced-motion media', css.includes('prefers-reduced-motion'));

const markup = emitSpinHistoryReplayMarkup(r1);
t('markup empty when disabled', emitSpinHistoryReplayMarkup(defaultConfig()) === '');
t('markup has banner id', markup.includes('id="spinReplayBanner"'));
t('markup has role=region', markup.includes('role="region"'));

const rt = emitSpinHistoryReplayRuntime(r1);
t('runtime stub when disabled', emitSpinHistoryReplayRuntime(defaultConfig()).includes('disabled'));
t('runtime declares SHR_MAX_BUFFER', rt.includes('SHR_MAX_BUFFER'));
t('runtime declares SHR_CAPTURE_FS', rt.includes('SHR_CAPTURE_FS'));
t('runtime exposes __SPIN_HISTORY__', rt.includes('__SPIN_HISTORY__'));
t('runtime has captureFrame', rt.includes('function captureFrame'));
t('runtime has replay function', rt.includes('function replay'));
t('runtime has stop function', rt.includes('function stop'));
t('runtime has step function', rt.includes('function step'));
t('runtime emits onSpinReplayStart', rt.includes('onSpinReplayStart'));
t('runtime emits onSpinReplayEnd', rt.includes('onSpinReplayEnd'));
t('runtime emits onSpinReplayPaused', rt.includes('onSpinReplayPaused'));
t('runtime listens onSpinResult', rt.includes("HookBus.on('onSpinResult'"));
t('runtime listens onFsTrigger', rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd', rt.includes("HookBus.on('onFsEnd'"));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
