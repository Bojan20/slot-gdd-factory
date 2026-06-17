/**
 * tests/blocks/collectableSymbol.test.mjs — Wave H19 contract test.
 */
import {
  defaultConfig,
  resolveConfig,
  emitCollectableSymbolCSS,
  emitCollectableSymbolMarkup,
  emitCollectableSymbolRuntime,
} from '../../src/blocks/collectableSymbol.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/collectableSymbol.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('collectableSymbol block contract');

const def = defaultConfig();
t('defaultConfig frozen',                Object.isFrozen(def));
t('default enabled = false',             def.enabled === false);
t('default symbol = COIN',               def.symbol === 'COIN');
t('default threshold = 6',               def.threshold === 6);
t('default resetOn = fsEnd',             def.resetOn === 'fsEnd');
t('default position = bottom-right',     def.position === 'bottom-right');
t('default labelTemplate = {S} {N}/{M}', def.labelTemplate === '{S} {N}/{M}');
t('defaultConfig returns fresh object',  defaultConfig() !== defaultConfig());

t('auto-enable when GDD declares block', resolveConfig({ collectableSymbol: {} }).enabled === true);
t('no key → disabled',                   resolveConfig({}).enabled === false);

const r1 = resolveConfig({ collectableSymbol: { threshold: 99999 } });
t('threshold clamped to 999 ceiling',    r1.threshold === 999);
const r2 = resolveConfig({ collectableSymbol: { threshold: 0 } });
t('threshold clamped to 1 floor',        r2.threshold === 1);
const r3 = resolveConfig({ collectableSymbol: { resetOn: 'lifetime' } });
t('resetOn whitelist rejects bogus',     r3.resetOn === 'fsEnd');
const r4 = resolveConfig({ collectableSymbol: { resetOn: 'spin' } });
t('resetOn spin accepted',               r4.resetOn === 'spin');
const r5 = resolveConfig({ collectableSymbol: { resetOn: 'never' } });
t('resetOn never accepted',              r5.resetOn === 'never');
const r6 = resolveConfig({ collectableSymbol: { symbol: '<X>COIN' } });
t('symbol XSS chars stripped',           !r6.symbol.includes('<'));
const r7 = resolveConfig({ collectableSymbol: { position: 'middle' } });
t('position whitelist rejects bogus',    r7.position === 'bottom-right');

const cssDis = emitCollectableSymbolCSS({ ...def, enabled: false });
t('CSS disabled = empty',                cssDis === '');
const css = emitCollectableSymbolCSS({ ...def, enabled: true });
t('CSS .collect-badge selector',         css.includes('.collect-badge'));
t('CSS @keyframes collect-pulse',        css.includes('@keyframes collect-pulse'));
t('CSS prefers-reduced-motion gate',     css.includes('prefers-reduced-motion'));

const mDis = emitCollectableSymbolMarkup({ ...def, enabled: false });
t('markup disabled = empty',             mDis === '');
const mk = emitCollectableSymbolMarkup({ ...def, enabled: true });
t('markup #collectBadge present',        mk.includes('id="collectBadge"'));
t('markup role=status',                  mk.includes('role="status"'));
t('markup aria-live=polite',             mk.includes('aria-live="polite"'));
t('markup initial COIN 0/6',             mk.includes('COIN 0/6'));

const rtDis = emitCollectableSymbolRuntime({ ...def, enabled: false });
t('runtime disabled = empty',            rtDis === '');
const rt = emitCollectableSymbolRuntime({ ...def, enabled: true });
t('runtime listens postSpin',            rt.includes("HookBus.on('postSpin'"));
t('runtime listens onTumbleStep',        rt.includes("HookBus.on('onTumbleStep'"));
t('runtime listens onFsSpinResult',      rt.includes("HookBus.on('onFsSpinResult'"));
t('runtime listens preSpin',             rt.includes("HookBus.on('preSpin'"));
t('runtime listens onFsTrigger',         rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsEnd',             rt.includes("HookBus.on('onFsEnd'"));
t('runtime emits onSymbolCollected',     rt.includes("HookBus.emit('onSymbolCollected'"));
t('runtime emits onCollectionFull',      rt.includes("HookBus.emit('onCollectionFull'"));
t('runtime emits onCollectionReset',     rt.includes("HookBus.emit('onCollectionReset'"));
t('runtime exposes collectableSymbolBump',  rt.includes('window.collectableSymbolBump'));
t('runtime exposes collectableSymbolReset', rt.includes('window.collectableSymbolReset'));
t('runtime exposes collectableSymbolGet',   rt.includes('window.collectableSymbolGet'));

/* --- Sandbox --- */
function makeSb(symbols) {
  const listeners = {};
  const emits = [];
  const badge = {
    _attrs: {}, textContent: '',
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : null; },
  };
  const cells = (symbols || []).map(s => ({
    _attrs: { 'data-sym': s },
    getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : null; },
  }));
  const document = {
    getElementById(id) { return id === 'collectBadge' ? badge : null; },
    querySelectorAll(sel) { return sel === '.symbol-cell' ? cells : []; },
  };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, badge, cells };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', 'setTimeout', emitCollectableSymbolRuntime(cfg));
  fn(sb.window, sb.document, () => 1);
}

const sb1 = makeSb(['COIN', 'H1', 'COIN', 'M1']);
runRt({ ...def, enabled: true, threshold: 3 }, sb1);
t('sandbox: listeners registered',         !!sb1.listeners.postSpin);

sb1.listeners.postSpin[0]();
const collect1 = sb1.emits.filter(e => e.ev === 'onSymbolCollected');
t('sandbox: 2 COINs collected on postSpin', collect1.length === 1 && collect1[0].p.count === 2);
t('sandbox: not yet full at 2/3',          sb1.emits.filter(e => e.ev === 'onCollectionFull').length === 0);

/* second spin → reach threshold */
sb1.listeners.postSpin[0]();
t('sandbox: 4 COINs total after 2nd spin', sb1.window.collectableSymbolGet().count === 4);
const full = sb1.emits.filter(e => e.ev === 'onCollectionFull');
t('sandbox: onCollectionFull fired',       full.length === 1 && full[0].p.threshold === 3);

/* full event only fires ONCE */
sb1.listeners.postSpin[0]();
t('sandbox: onCollectionFull single-shot', sb1.emits.filter(e => e.ev === 'onCollectionFull').length === 1);

/* reset on fsEnd (default) */
sb1.emits.length = 0;
sb1.listeners.onFsEnd[0]();
const reset1 = sb1.emits.filter(e => e.ev === 'onCollectionReset');
t('sandbox: fsEnd resets meter',           reset1.length === 1 && sb1.window.collectableSymbolGet().count === 0);

/* resetOn=spin */
const sb2 = makeSb(['COIN']);
runRt({ ...def, enabled: true, threshold: 5, resetOn: 'spin' }, sb2);
sb2.listeners.postSpin[0]();
sb2.emits.length = 0;
sb2.listeners.preSpin[0]();
t('sandbox: preSpin resets when resetOn=spin', sb2.emits.filter(e => e.ev === 'onCollectionReset').length === 1);

/* resetOn=never */
const sb3 = makeSb(['COIN', 'COIN']);
runRt({ ...def, enabled: true, threshold: 5, resetOn: 'never' }, sb3);
sb3.listeners.postSpin[0]();
sb3.emits.length = 0;
sb3.listeners.preSpin[0]();
sb3.listeners.onFsTrigger[0]();
sb3.listeners.onFsEnd[0]();
t('sandbox: resetOn=never never resets',   sb3.emits.filter(e => e.ev === 'onCollectionReset').length === 0);
t('sandbox: meter survives FS round',      sb3.window.collectableSymbolGet().count === 2);

/* API bump */
const sb4 = makeSb([]);
runRt({ ...def, enabled: true, threshold: 4 }, sb4);
sb4.window.collectableSymbolBump(2);
t('sandbox: bump API count=2',             sb4.window.collectableSymbolGet().count === 2);
sb4.window.collectableSymbolBump(2);
const apiFull = sb4.emits.filter(e => e.ev === 'onCollectionFull');
t('sandbox: bump API triggers full',       apiFull.length === 1);

/* onTumbleStep counts cells */
const sb5 = makeSb(['COIN']);
runRt({ ...def, enabled: true, threshold: 10 }, sb5);
sb5.listeners.onTumbleStep[0]();
t('sandbox: onTumbleStep counts COIN',     sb5.window.collectableSymbolGet().count === 1);

/* onFsSpinResult counts cells */
const sb6 = makeSb(['COIN', 'COIN']);
runRt({ ...def, enabled: true, threshold: 10 }, sb6);
sb6.listeners.onFsSpinResult[0]();
t('sandbox: onFsSpinResult counts',         sb6.window.collectableSymbolGet().count === 2);

/* no COIN cell → no event */
const sb7 = makeSb(['H1', 'M1']);
runRt({ ...def, enabled: true, threshold: 3 }, sb7);
sb7.listeners.postSpin[0]();
t('sandbox: no COIN → no emit',             sb7.emits.filter(e => e.ev === 'onSymbolCollected').length === 0);

/* manual reset */
const sb8 = makeSb(['COIN']);
runRt({ ...def, enabled: true, threshold: 5 }, sb8);
sb8.listeners.postSpin[0]();
sb8.emits.length = 0;
sb8.window.collectableSymbolReset();
t('sandbox: manual reset emits',            sb8.emits.filter(e => e.ev === 'onCollectionReset').length === 1);
t('sandbox: manual reset zeroes count',     sb8.window.collectableSymbolGet().count === 0);

const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(\bIGT\b|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic|mega moolah)/i;
t('source: vendor-neutral',                 !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
