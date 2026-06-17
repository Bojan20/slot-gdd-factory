/**
 * tests/blocks/retriggerMeter.test.mjs — Wave H20 contract test.
 */
import {
  defaultConfig,
  resolveConfig,
  emitRetriggerMeterCSS,
  emitRetriggerMeterMarkup,
  emitRetriggerMeterRuntime,
} from '../../src/blocks/retriggerMeter.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = resolvePath(__dirname, '../../src/blocks/retriggerMeter.mjs');

let pass = 0, fail = 0;
const t = (label, cond) => {
  if (cond) { console.log('  ✓', label); pass++; }
  else      { console.log('  ✗', label); fail++; }
};

console.log('retriggerMeter block contract');

const def = defaultConfig();
t('defaultConfig frozen',                Object.isFrozen(def));
t('default enabled = false',             def.enabled === false);
t('default scatterSymbol = S',           def.scatterSymbol === 'S');
t('default scatterPerRetrigger = 3',     def.scatterPerRetrigger === 3);
t('default fsPerRetrigger = 5',          def.fsPerRetrigger === 5);
t('default position = top-left',         def.position === 'top-left');
t('defaultConfig returns fresh object',  defaultConfig() !== defaultConfig());

t('auto-enable when GDD declares block', resolveConfig({ retriggerMeter: {} }).enabled === true);
t('no key → disabled',                   resolveConfig({}).enabled === false);

const r1 = resolveConfig({ retriggerMeter: { scatterPerRetrigger: 999 } });
t('scatterPerRetrigger clamped to 12',   r1.scatterPerRetrigger === 12);
const r2 = resolveConfig({ retriggerMeter: { fsPerRetrigger: 9999 } });
t('fsPerRetrigger clamped to 100',       r2.fsPerRetrigger === 100);
const r3 = resolveConfig({ retriggerMeter: { fsPerRetrigger: 0 } });
t('fsPerRetrigger clamped to 1 floor',   r3.fsPerRetrigger === 1);
const r4 = resolveConfig({ retriggerMeter: { position: 'middle' } });
t('position whitelist rejects bogus',    r4.position === 'top-left');
const r5 = resolveConfig({ retriggerMeter: { scatterSymbol: '<X>S' } });
t('scatterSymbol XSS chars stripped',    !r5.scatterSymbol.includes('<'));
const r6 = resolveConfig({ retriggerMeter: { barFill: '"injected' } });
t('barFill XSS guard',                   !r6.barFill.includes('"'));

const cssDis = emitRetriggerMeterCSS({ ...def, enabled: false });
t('CSS disabled = empty',                cssDis === '');
const css = emitRetriggerMeterCSS({ ...def, enabled: true });
t('CSS .rtmeter selector',               css.includes('.rtmeter'));
t('CSS .rtmeter-fill selector',          css.includes('.rtmeter-fill'));
t('CSS .rtmeter-pop selector',           css.includes('.rtmeter-pop'));
t('CSS @keyframes rtmeter-pop',          css.includes('@keyframes rtmeter-pop'));
t('CSS prefers-reduced-motion gate',     css.includes('prefers-reduced-motion'));

const mDis = emitRetriggerMeterMarkup({ ...def, enabled: false });
t('markup disabled = empty',             mDis === '');
const mk = emitRetriggerMeterMarkup({ ...def, enabled: true });
t('markup #rtMeter present',             mk.includes('id="rtMeter"'));
t('markup #rtMeterPop present',          mk.includes('id="rtMeterPop"'));
t('markup role=progressbar',             mk.includes('role="progressbar"'));
t('markup aria-valuemax = threshold',    mk.includes(`aria-valuemax="${def.scatterPerRetrigger}"`));
t('markup aria-live=polite on pop',      mk.includes('aria-live="polite"'));
t('markup default +5 FS pop label',      mk.includes('+5 FS'));

const rtDis = emitRetriggerMeterRuntime({ ...def, enabled: false });
t('runtime disabled = empty',            rtDis === '');
const rt = emitRetriggerMeterRuntime({ ...def, enabled: true });
t('runtime listens onFsTrigger',         rt.includes("HookBus.on('onFsTrigger'"));
t('runtime listens onFsSpinResult',      rt.includes("HookBus.on('onFsSpinResult'"));
t('runtime listens onFsRetrigger',       rt.includes("HookBus.on('onFsRetrigger'"));
t('runtime listens onFsEnd',             rt.includes("HookBus.on('onFsEnd'"));
t('runtime emits onRetriggerMeterTick',  rt.includes("HookBus.emit('onRetriggerMeterTick'"));
t('runtime emits onRetriggerMeterCommit',rt.includes("HookBus.emit('onRetriggerMeterCommit'"));
t('runtime emits onRetriggerMeterReset', rt.includes("HookBus.emit('onRetriggerMeterReset'"));
t('runtime does NOT emit onFsRetrigger', !rt.includes("HookBus.emit('onFsRetrigger'"));
t('runtime exposes retriggerMeterTick',  rt.includes('window.retriggerMeterTick'));
t('runtime exposes retriggerMeterCommit',rt.includes('window.retriggerMeterCommit'));
t('runtime exposes retriggerMeterReset', rt.includes('window.retriggerMeterReset'));
t('runtime exposes retriggerMeterGet',   rt.includes('window.retriggerMeterGet'));

/* --- Sandbox --- */
function makeSb(scatterCount) {
  const listeners = {};
  const emits = [];
  function mkEl() {
    return {
      _attrs: {}, textContent: '',
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : null; },
    };
  }
  const meter = mkEl();
  const count = mkEl();
  const fill = mkEl();
  const pop = mkEl();
  const cells = [];
  for (let i = 0; i < (scatterCount || 0); i++) cells.push({
    _attrs: { 'data-sym': 'S' },
    getAttribute(k) { return this._attrs[k]; },
  });
  const document = {
    getElementById(id) {
      if (id === 'rtMeter') return meter;
      if (id === 'rtMeterCount') return count;
      if (id === 'rtMeterFill') return fill;
      if (id === 'rtMeterPop') return pop;
      return null;
    },
    querySelectorAll(sel) { return sel === '.symbol-cell' ? cells : []; },
  };
  const window = {
    HookBus: {
      on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
      emit(ev, p) { emits.push({ ev, p }); (listeners[ev] || []).forEach(fn => fn(p)); },
    },
  };
  return { window, document, listeners, emits, meter, count, fill, pop };
}
function runRt(cfg, sb) {
  const fn = new Function('window', 'document', 'setTimeout', emitRetriggerMeterRuntime(cfg));
  fn(sb.window, sb.document, () => 1);
}

const sb1 = makeSb(0);
runRt({ ...def, enabled: true }, sb1);
t('sandbox: listeners registered',         !!sb1.listeners.onFsTrigger);

/* onFsTrigger shows meter */
sb1.listeners.onFsTrigger[0]();
t('sandbox: onFsTrigger reveals meter',    sb1.meter.getAttribute('data-visible') === 'true');

/* onFsSpinResult counts scatters via payload */
sb1.emits.length = 0;
sb1.listeners.onFsSpinResult[0]({ scattersThisSpin: 2 });
const tick1 = sb1.emits.filter(e => e.ev === 'onRetriggerMeterTick');
t('sandbox: tick after 2 scatters',        tick1.length === 1 && tick1[0].p.scattersTotal === 2);

/* onFsRetrigger emits Commit, NOT onFsRetrigger from this block */
sb1.emits.length = 0;
sb1.listeners.onFsRetrigger[0]({ addedCount: 5, newTotalFs: 15 });
const commits = sb1.emits.filter(e => e.ev === 'onRetriggerMeterCommit');
const noRetrig = sb1.emits.filter(e => e.ev === 'onFsRetrigger' && e.p && e.p.source);
t('sandbox: onRetriggerMeterCommit fired', commits.length === 1 && commits[0].p.addedCount === 5);
t('sandbox: does NOT re-emit onFsRetrigger', sb1.emits.filter(e => e.ev === 'onFsRetrigger' && e.p && (e.p.source === 'onFsRetrigger' || e.p.source === 'api')).length === 0);
t('sandbox: pop element popping flag set', sb1.pop.getAttribute('data-popping') === 'true');
t('sandbox: pop text +5 FS',               sb1.pop.textContent === '+5 FS');

/* onFsEnd hides meter + emits reset */
sb1.emits.length = 0;
sb1.listeners.onFsEnd[0]();
const resets = sb1.emits.filter(e => e.ev === 'onRetriggerMeterReset');
t('sandbox: onFsEnd hides meter',          sb1.meter.getAttribute('data-visible') === 'false');
t('sandbox: onFsEnd emits reset',          resets.length === 1);

/* Outside FS: onFsSpinResult ignored */
const sb2 = makeSb(2);
runRt({ ...def, enabled: true }, sb2);
sb2.listeners.onFsSpinResult[0]({ scattersThisSpin: 2 });
t('sandbox: onFsSpinResult ignored outside FS', sb2.emits.filter(e => e.ev === 'onRetriggerMeterTick').length === 0);

/* Grid scan fallback when no payload.cells */
const sb3 = makeSb(2);
runRt({ ...def, enabled: true }, sb3);
sb3.listeners.onFsTrigger[0]();
sb3.emits.length = 0;
sb3.listeners.onFsSpinResult[0]({});
t('sandbox: grid scan fallback counts',    sb3.emits.filter(e => e.ev === 'onRetriggerMeterTick').length === 1);

/* payload.cells path */
const sb4 = makeSb(0);
runRt({ ...def, enabled: true }, sb4);
sb4.listeners.onFsTrigger[0]();
sb4.emits.length = 0;
sb4.listeners.onFsSpinResult[0]({ cells: [{ sym: 'S' }, { sym: 'H1' }, { sym: 'S' }] });
const cellTick = sb4.emits.filter(e => e.ev === 'onRetriggerMeterTick');
t('sandbox: payload.cells path counts 2',  cellTick.length === 1 && cellTick[0].p.scattersThisSpin === 2);

/* API tick + commit */
const sb5 = makeSb(0);
runRt({ ...def, enabled: true }, sb5);
sb5.listeners.onFsTrigger[0]();
sb5.window.retriggerMeterTick(1);
sb5.window.retriggerMeterCommit(3, 13);
const apiCommit = sb5.emits.filter(e => e.ev === 'onRetriggerMeterCommit');
t('sandbox: API commit fires',             apiCommit.length === 1 && apiCommit[0].p.newTotalFs === 13);

/* Get snapshot */
const snap = sb5.window.retriggerMeterGet();
t('sandbox: get returns snapshot',         snap && snap.inFs === true && snap.scattersTotal === 1);

/* Reset via API */
sb5.emits.length = 0;
sb5.window.retriggerMeterReset();
t('sandbox: reset API emits',              sb5.emits.filter(e => e.ev === 'onRetriggerMeterReset').length === 1);
t('sandbox: reset hides meter',            sb5.meter.getAttribute('data-visible') === 'false');

const src = readFileSync(SRC_PATH, 'utf8');
const VENDORS = /(\bIGT\b|pragmatic|megaways|netent|microgaming|reactoonz|olympus|wrath|cleopatra|buffalo|sugar rush|sweet bonanza|wolf run|cash eruption|playson|hacksaw|nolimit|btg|wazdan|playngo|yggdrasil|relax gaming|push gaming|stakelogic|madame destiny)/i;
t('source: vendor-neutral',                !VENDORS.test(src));

console.log('--- summary ---');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) process.exit(1);
