/**
 * tests/blocks/ambientBackgroundWheel.test.mjs — Wave H9 contract test.
 */
import {
  defaultConfig,
  resolveConfig,
  emitAmbientBackgroundWheelCSS,
  emitAmbientBackgroundWheelMarkup,
  emitAmbientBackgroundWheelRuntime,
} from '../../src/blocks/ambientBackgroundWheel.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/ambientBackgroundWheel.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('ambientBackgroundWheel block contract');

const def = defaultConfig();
t('defaultConfig frozen',                  Object.isFrozen(def));
t('default enabled = false (opt-in)',      def.enabled === false);
t('default idleDurationSec = 60',          def.idleDurationSec === 60);
t('default spinDurationSec = 6',           def.spinDurationSec === 6);
t('default winPulseMs = 1500',             def.winPulseMs === 1500);
t('default opacity = 0.18',                def.opacity === 0.18);
t('default zIndex within bounds',          def.zIndex >= 1 && def.zIndex <= 9);

t('auto-enable when GDD declares block',   resolveConfig({ ambientBackgroundWheel: {} }).enabled === true);
const r1 = resolveConfig({ ambientBackgroundWheel: { opacity: 5 } });
t('opacity clamped to 1.0 ceiling',        r1.opacity === 1.0);
const r2 = resolveConfig({ ambientBackgroundWheel: { idleDurationSec: 0.5 } });
t('idleDurationSec clamped to 10 floor',   r2.idleDurationSec === 10);
const r3 = resolveConfig({ ambientBackgroundWheel: { color: '<script>' } });
t('color XSS chars stripped',              !r3.color.includes('<'));
const r4 = resolveConfig({ ambientBackgroundWheel: { autoOnPreSpin: false } });
t('autoOnPreSpin=false honoured',          r4.autoOnPreSpin === false);

const cssDis = emitAmbientBackgroundWheelCSS({ ...def, enabled: false });
t('CSS disabled = empty',                  cssDis === '');
const css = emitAmbientBackgroundWheelCSS({ ...def, enabled: true });
t('CSS .ambient-bg-wheel selector',        css.includes('.ambient-bg-wheel'));
t('CSS @keyframes ambient-rotate',         css.includes('@keyframes ambient-rotate'));
t('CSS data-phase="spinning" rule',        css.includes('.ambient-bg-wheel[data-phase="spinning"]'));
t('CSS data-phase="win" rule',             css.includes('.ambient-bg-wheel[data-phase="win"]'));
t('CSS prefers-reduced-motion gate',       css.includes('prefers-reduced-motion'));
t('CSS embedded svg data URI present',     css.includes('data:image/svg+xml'));

const mDis = emitAmbientBackgroundWheelMarkup({ ...def, enabled: false });
t('markup disabled = empty',               mDis === '');
const m = emitAmbientBackgroundWheelMarkup({ ...def, enabled: true });
t('markup has id=ambientBackgroundWheel',  m.includes('id="ambientBackgroundWheel"'));
t('markup aria-hidden=true (decoration)',  m.includes('aria-hidden="true"'));
t('markup default data-phase=idle',        m.includes('data-phase="idle"'));

const rt = emitAmbientBackgroundWheelRuntime({ ...def, enabled: true });
t('runtime listens preSpin',               rt.includes("HookBus.on('preSpin'"));
t('runtime listens postSpin',              rt.includes("HookBus.on('postSpin'"));
t('runtime listens onBigWinTierEntered',   rt.includes("HookBus.on('onBigWinTierEntered'"));
t('runtime listens onFsTrigger',           rt.includes("HookBus.on('onFsTrigger'"));
t('runtime emits onAmbientPhase literal',  rt.includes("HookBus.emit('onAmbientPhase'"));
t('runtime exposes ambientSetPhase API',   rt.includes('window.ambientSetPhase'));

/* Sandbox */
function makeSb() {
  const listeners = {};
  const emits = [];
  const host = { _attrs: { 'data-phase': 'idle' },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
  };
  const document = { getElementById: (id) => id === 'ambientBackgroundWheel' ? host : null };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, host, listeners, emits };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', 'setTimeout', 'clearTimeout', emitAmbientBackgroundWheelRuntime(cfg));
  fn(sb.window, sb.document, (cb) => 0, () => {});
}

const sb1 = makeSb();
runRt({ ...def, enabled: true }, sb1);
t('sandbox: listeners registered',        !!sb1.listeners.preSpin);
sb1.listeners.preSpin[0]();
t('sandbox: preSpin → host data-phase=spinning', sb1.host.getAttribute('data-phase') === 'spinning');
const phase1 = sb1.emits.filter(e => e.ev === 'onAmbientPhase');
t('sandbox: emit onAmbientPhase spinning',       phase1[0].p.phase === 'spinning');

sb1.listeners.postSpin[0]();
t('sandbox: postSpin → host data-phase=idle',    sb1.host.getAttribute('data-phase') === 'idle');

sb1.listeners.onBigWinTierEntered[0]();
t('sandbox: onBigWinTierEntered → phase=win',    sb1.host.getAttribute('data-phase') === 'win');

// External API
sb1.window.ambientSetPhase('idle');
t('sandbox: ambientSetPhase API works',          sb1.host.getAttribute('data-phase') === 'idle');

// Invalid phase rejected
sb1.window.ambientSetPhase('wonky');
t('sandbox: invalid phase rejected (no flip)',   sb1.host.getAttribute('data-phase') === 'idle');

// AutoOnPreSpin=false → no listener
const sb2 = makeSb();
runRt({ ...def, enabled: true, autoOnPreSpin: false }, sb2);
t('sandbox: autoOnPreSpin=false → no preSpin listener', !sb2.listeners.preSpin);

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(IGT|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral',                !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
