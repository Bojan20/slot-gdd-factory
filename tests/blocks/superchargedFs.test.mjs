/**
 * tests/blocks/superchargedFs.test.mjs — Wave H14 contract test.
 */
import {
  defaultConfig, resolveConfig,
  emitSuperchargedFsCSS, emitSuperchargedFsMarkup, emitSuperchargedFsRuntime,
} from '../../src/blocks/superchargedFs.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/superchargedFs.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => { if (cond) { console.log('  ✓', label); pass++; } else { console.log('  ✗', label); fail++; } };

console.log('superchargedFs block contract');

const def = defaultConfig();
t('defaultConfig frozen', Object.isFrozen(def));
t('default enabled = false', def.enabled === false);
t('default ladder = [1,2,3,5,10]', JSON.stringify(def.ladder) === '[1,2,3,5,10]');
t('default position = top-left', def.position === 'top-left');

t('auto-enable on GDD declare', resolveConfig({ superchargedFs: {} }).enabled === true);
const r1 = resolveConfig({ superchargedFs: { ladder: [1, 5, 2, 10] } });
t('ladder monotonic enforce drops bad entries', r1.ladder.length === 3 /* 1, 5, 10 */);
const r2 = resolveConfig({ superchargedFs: { ladder: [1] } });
t('ladder too short → default kept', JSON.stringify(r2.ladder) === '[1,2,3,5,10]');
const r3 = resolveConfig({ superchargedFs: { labelTemplate: '<X>FS' } });
t('labelTemplate XSS stripped', !r3.labelTemplate.includes('<'));

t('CSS disabled empty', emitSuperchargedFsCSS({ ...def, enabled: false }) === '');
const css = emitSuperchargedFsCSS({ ...def, enabled: true });
t('CSS .sfs-badge selector',           css.includes('.sfs-badge'));
t('CSS @keyframes sfs-pulse',          css.includes('@keyframes sfs-pulse'));
t('CSS prefers-reduced-motion gate',   css.includes('prefers-reduced-motion'));

const m = emitSuperchargedFsMarkup({ ...def, enabled: true });
t('markup id=sfsBadge',                m.includes('id="sfsBadge"'));
t('markup role=status',                m.includes('role="status"'));
t('markup aria-live=polite',           m.includes('aria-live="polite"'));

t('runtime disabled empty', emitSuperchargedFsRuntime({ ...def, enabled: false }) === '');
const rt = emitSuperchargedFsRuntime({ ...def, enabled: true });
t('runtime listens onFsTrigger',       rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsRetrigger',     rt.includes("HookBus.on('onFsRetrigger'"));
t('runtime listens onFsEnd',           rt.includes("HookBus.on('onFsEnd'"));
t('runtime emits onFsMultiplierEscalated', rt.includes("HookBus.emit('onFsMultiplierEscalated'"));
t('runtime emits onFsSuperchargeReset',    rt.includes("HookBus.emit('onFsSuperchargeReset'"));
t('runtime exposes superchargedFsStep API', rt.includes('window.superchargedFsStep'));

/* Sandbox */
function makeSb() {
  const listeners = {};
  const emits = [];
  const badge = { _attrs: { 'data-visible': 'false', 'data-escalating': 'false', 'data-mult': '1' }, textContent: 'FS MULT ×1',
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
  };
  const document = { getElementById(id) { return id === 'sfsBadge' ? badge : null; } };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, badge };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', 'setTimeout', emitSuperchargedFsRuntime(cfg));
  fn(sb.window, sb.document, (cb) => 0);
}

const sb1 = makeSb();
runRt({ ...def, enabled: true }, sb1);
t('sandbox: listeners registered', !!sb1.listeners.onFsTrigger);

sb1.listeners.onFsTrigger[0]();
t('sandbox: onFsTrigger inits mult=1', sb1.badge.getAttribute('data-mult') === '1');

sb1.listeners.onFsRetrigger[0]();
t('sandbox: 1st retrigger → mult=2', sb1.badge.getAttribute('data-mult') === '2');
const esc = sb1.emits.filter(e => e.ev === 'onFsMultiplierEscalated');
t('sandbox: onFsMultiplierEscalated emitted', esc.length === 1 && esc[0].p.from === 1 && esc[0].p.to === 2);

sb1.listeners.onFsRetrigger[0]();
sb1.listeners.onFsRetrigger[0]();
t('sandbox: 3rd retrigger → mult=5', sb1.badge.getAttribute('data-mult') === '5');

// Cap at ladder end
sb1.listeners.onFsRetrigger[0]();
sb1.listeners.onFsRetrigger[0]();
sb1.listeners.onFsRetrigger[0]();
t('sandbox: retrigger past end caps at 10', sb1.badge.getAttribute('data-mult') === '10');

sb1.listeners.onFsEnd[0]();
const resets = sb1.emits.filter(e => e.ev === 'onFsSuperchargeReset');
t('sandbox: onFsEnd emits reset', resets.length === 1);

const state = sb1.window.superchargedFsGet();
t('sandbox: API get → mult=1 after reset', state.mult === 1 && state.retriggers === 0);

/* Vendor neutrality */
const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(industry standard|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic)/i;
t('source: vendor-neutral', !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
