/**
 * tests/blocks/respinCharge.test.mjs — Wave H18 contract test.
 */
import {
  defaultConfig, resolveConfig,
  emitRespinChargeCSS, emitRespinChargeMarkup, emitRespinChargeRuntime,
} from '../../src/blocks/respinCharge.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/respinCharge.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => { if (cond) { console.log('  ✓', label); pass++; } else { console.log('  ✗', label); fail++; } };

console.log('respinCharge block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
t('default enabled = false', def.enabled === false);
t('default capacity = 5', def.capacity === 5);
t('default trigger = loss', def.trigger === 'loss');

t('auto-enable on GDD declare', resolveConfig({ respinCharge: {} }).enabled === true);
const r1 = resolveConfig({ respinCharge: { trigger: 'bogus' } });
t('trigger whitelist rejects bogus', r1.trigger === 'loss');
const r2 = resolveConfig({ respinCharge: { trigger: 'spin' } });
t('trigger spin accepted', r2.trigger === 'spin');
const r3 = resolveConfig({ respinCharge: { position: 'middle' } });
t('position whitelist rejects middle', r3.position === 'bottom');

const css = emitRespinChargeCSS({ ...def, enabled: true });
t('CSS .respin-charge selector', css.includes('.respin-charge'));
t('CSS prefers-reduced-motion gate', css.includes('prefers-reduced-motion'));

const m = emitRespinChargeMarkup({ ...def, enabled: true });
t('markup id=respinCharge', m.includes('id="respinCharge"'));
t('markup role=progressbar',  m.includes('role="progressbar"'));

const rt = emitRespinChargeRuntime({ ...def, enabled: true });
t('runtime listens onSpinResult',   rt.includes("HookBus.on('onSpinResult'"));
t('runtime listens onTumbleStep',   rt.includes("HookBus.on('onTumbleStep'"));
t('runtime listens onFsEnd',        rt.includes("HookBus.on('onFsEnd'"));
t('runtime listens onRespinChargeTick', rt.includes("HookBus.on('onRespinChargeTick'"));
t('runtime emits onRespinChargeBump',   rt.includes("HookBus.emit('onRespinChargeBump'"));
t('runtime emits onRespinChargeFull',   rt.includes("HookBus.emit('onRespinChargeFull'"));
t('runtime emits onRespinChargeReset',  rt.includes("HookBus.emit('onRespinChargeReset'"));

/* Sandbox */
function makeSb() {
  const listeners = {};
  const emits = [];
  const host = { _attrs: {}, _children: [],
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    querySelector(sel) {
      if (sel === '.rc-label') return { textContent: '' };
      if (sel === '.rc-fill')  return { style: {} };
      return null;
    },
  };
  const document = { getElementById(id) { return id === 'respinCharge' ? host : null; } };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, host };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', 'setTimeout', emitRespinChargeRuntime(cfg));
  fn(sb.window, sb.document, (cb) => 0);
}

const sb1 = makeSb();
runRt({ ...def, enabled: true }, sb1);
t('sandbox: listeners registered', !!sb1.listeners.onSpinResult);

// Loss bump
sb1.listeners.onSpinResult[0]({ award: 0 });
const bumps = sb1.emits.filter(e => e.ev === 'onRespinChargeBump');
t('sandbox: loss bumps charge', bumps.length === 1 && bumps[0].p.to === 1);

// Win does NOT bump (trigger=loss default)
sb1.emits.length = 0;
sb1.listeners.onSpinResult[0]({ award: 100 });
const winBumps = sb1.emits.filter(e => e.ev === 'onRespinChargeBump');
t('sandbox: win does NOT bump (trigger=loss)', winBumps.length === 0);

// Reach full → onRespinChargeFull
const sb2 = makeSb();
runRt({ ...def, enabled: true }, sb2);
for (let i = 0; i < 5; i++) sb2.listeners.onSpinResult[0]({ award: 0 });
const fulls = sb2.emits.filter(e => e.ev === 'onRespinChargeFull');
t('sandbox: reaching capacity fires onRespinChargeFull', fulls.length === 1);

// API
const sb3 = makeSb();
runRt({ ...def, enabled: true }, sb3);
sb3.window.respinChargeBump(3);
t('sandbox: API bump emits',
  sb3.emits.some(e => e.ev === 'onRespinChargeBump' && e.p.to === 3));
sb3.window.respinChargeReset();
t('sandbox: API reset emits',
  sb3.emits.some(e => e.ev === 'onRespinChargeReset'));

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(industry standard|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral', !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
